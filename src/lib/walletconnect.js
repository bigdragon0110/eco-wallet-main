import SignClient from "@walletconnect/sign-client"
import { base58Encode } from "./base58"

const PROJECT_ID = process.env.REACT_APP_WALLETCONNECT_PROJECT_ID
const CHAIN_ID = "eip155:1"
// WalletConnect added official TRON support (Jan 2026) and Trust Wallet grants
// tron sessions. Mainnet chain id is the hex-encoded genesis hash prefix.
export const TRON_CHAIN = "tron:0x2b6653dc"
// Solana mainnet CAIP-2 chain id (first 32 chars of the base58 genesis hash).
export const SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"

let clientPromise = null

export const initSignClient = () => {
  if (!PROJECT_ID) {
    return Promise.reject(
      new Error(
        "WalletConnect project ID is missing. Set REACT_APP_WALLETCONNECT_PROJECT_ID (free key from https://cloud.reown.com) and restart the dev server."
      )
    )
  }
  clientPromise ||= SignClient.init({
    projectId: PROJECT_ID,
    metadata: {
      name: "Takoyaki Ecommerce",
      description: "Sign in to Takoyaki Ecommerce with Trust Wallet",
      url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      icons: [],
    },
  })
  return clientPromise
}

// Opens a WalletConnect v2 pairing: returns the QR URI and an approval promise
// that resolves once the mobile wallet scans and accepts the connection.
// TRON-ONLY for now (user directive): the tron namespace is REQUIRED — the
// session carries the Tron account for sign-in/link AND the
// tron_signTransaction USDT cap approval. EVM/Solana namespaces are not
// requested until their payment rails ship.
export const connectPairing = async () => {
  const client = await initSignClient()
  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      tron: {
        methods: ["tron_signMessage", "tron_signTransaction"],
        chains: [TRON_CHAIN],
        events: [],
      },
    },
  })
  return { client, uri, approval }
}

// Resolves the session and extracts the Tron address (required namespace,
// CAIP-10 form "tron:0x2b6653dc:T..."). `address` is kept as an alias of
// tronAddress so existing onApproved callers keep working; `solAddress` is
// always null while the pairing is Tron-only.
export const approveSession = async (approval) => {
  const session = await approval()
  const tronAccount = session?.namespaces?.tron?.accounts?.[0] || null
  if (!tronAccount) throw new Error("The wallet did not share a Tron account — update Trust Wallet and try again.")
  const tronAddress = tronAccount.split(":")[2] || null
  if (!tronAddress) throw new Error("The wallet returned an invalid Tron account.")
  return { session, address: tronAddress, tronAddress, solAddress: null }
}

// Requests tron_signTransaction from the connected wallet. The backend hands
// us the raw UNSIGNED approve(spender, cap) transaction; the wallet signs it
// (one confirm in Trust Wallet) and returns the raw signed transaction JSON,
// which the backend broadcasts and then verifies on-chain. Returns the full
// signed transaction object (with the signature array populated).
export const signTronTransaction = async (client, session, transaction, address) => {
  const namespace = session?.namespaces?.[TRON_CHAIN] || session?.namespaces?.tron
  if (!namespace?.methods?.includes("tron_signTransaction")) {
    throw new Error("This wallet connection does not support Tron transaction signing. Disconnect and reconnect Trust Wallet, then try again.")
  }
  if (!namespace.accounts?.includes(`${TRON_CHAIN}:${address}`)) {
    throw new Error("The connected wallet has not approved this Tron mainnet account. Reconnect the correct wallet before approving the cap.")
  }
  // WalletConnect's legacy Tron format wraps the raw transaction once more.
  // Only wallets advertising v1 accept the simplified, flat format.
  const walletTransaction = session.sessionProperties?.tron_method_version === "v1"
    ? transaction
    : { transaction }
  const signed = await client.request({
    topic: session.topic,
    chainId: TRON_CHAIN,
    request: {
      method: "tron_signTransaction",
      params: { address, transaction: walletTransaction },
    },
  })
  if (!signed || typeof signed !== "object") {
    throw new Error("The wallet did not return a signed transaction.")
  }
  const signatures = signed.signature || signed.signatures || null
  if (!Array.isArray(signatures) || signatures.length === 0) {
    throw new Error("The wallet returned a transaction without a signature — cannot confirm.")
  }
  return signed
}

// Requests tron_signMessage from the connected wallet (TronLink V2 signing
// scheme — the backend recovers the signer with verifyMessageV2). Some wallet
// builds return the signature as an object ({ signature }) instead of a plain
// string — both shapes are handled.
export const signTronMessage = async (client, session, message, address) => {
  let signature = await client.request({
    topic: session.topic,
    chainId: TRON_CHAIN,
    request: { method: "tron_signMessage", params: { address, message } },
  })
  if (signature && typeof signature === "object") {
    signature = signature.signature || signature.result || null
  }
  if (typeof signature !== "string" || signature.length < 32) {
    throw new Error("The wallet returned an invalid Tron signature.")
  }
  return signature
}

// Requests solana_signMessage from the connected wallet. Per the WalletConnect
// solana spec the message is base58 (of the UTF-8 bytes) and the wallet signs
// the raw decoded bytes with its ed25519 key; the response is base58 as
// { signature } — plain-string and base64 shapes are also tolerated. The
// backend rebuilds the public key from the (base58) address and verifies the
// detached signature with Node crypto.
export const signSolanaMessage = async (client, session, message, address) => {
  const payload = { message: base58Encode(new TextEncoder().encode(message)), pubkey: address }
  let result = await client.request({
    topic: session.topic,
    chainId: SOLANA_CHAIN,
    request: { method: "solana_signMessage", params: payload },
  })
  if (result && typeof result === "object") {
    result = result.signature || result.result || null
  }
  if (typeof result !== "string" || result.length < 40) {
    throw new Error("The wallet returned an invalid Solana signature.")
  }
  return result
}

// Requests personal_sign (EIP-191) from the connected wallet.
export const signEvmMessage = async (client, session, message, address) => {
  const signature = await client.request({
    topic: session.topic,
    chainId: CHAIN_ID,
    request: { method: "personal_sign", params: [message, address] },
  })
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error("The wallet returned an invalid signature.")
  }
  return signature
}

// Best-effort teardown of an approved session or a pending pairing.
export const disconnectSession = async (client, session) => {
  try {
    if (session) {
      await client.disconnect({ topic: session.topic, reason: { code: 5000, message: "User disconnected" } })
    } else if (client?.core?.pairing?.pairings) {
      for (const pairing of client.core.pairing.pairings.values()) {
        await client.core.pairing.pairings.delete(pairing.topic, { code: 5000, message: "User disconnected" })
      }
    }
  } catch {
    /* best-effort cleanup */
  }
}
