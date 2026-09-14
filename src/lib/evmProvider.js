// EIP-1193 injected-provider helpers for EVM networks (Ethereum, BNB Chain,
// Polygon and every other EVM chain share ONE 0x address per wallet).
//
// Used inside Trust Wallet's DApp browser, where Trust injects
// window.trustwallet.ethereum (and announces itself via EIP-6963). The same
// helpers work for any EIP-1193 browser wallet (MetaMask etc.).
//
// The backend EVM endpoints (walletEvmVerify / walletEvmLink) verify the
// signature with ethers.verifyMessage(), i.e. EIP-191 personal_sign.

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const EVM_SIG_RE = /^0x[0-9a-fA-F]+$/

const utf8ToHex = (text) => {
  let hex = "0x"
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(2, "0")
  }
  return hex
}

// Returns { name, provider } for the first usable EIP-1193 provider, or null.
// Priority: Trust Wallet (DApp browser) > EIP-6963 announced > window.ethereum.
export const detectEvmProvider = () => {
  if (typeof window === "undefined") return null

  if (window.trustwallet && window.trustwallet.ethereum) {
    return { name: "Trust Wallet", provider: window.trustwallet.ethereum }
  }

  const announced = []
  const handler = (e) => announced.push(e.detail)
  window.addEventListener("eip6963:announceProvider", handler)
  try {
    window.dispatchEvent(new Event("eip6963:requestProvider"))
  } catch {
    /* EIP-6963 not supported */
  }
  setTimeout(() => window.removeEventListener("eip6963:announceProvider", handler), 500)

  if (announced.length) {
    const trust = announced.find((d) => String(d.info?.rdns || "").includes("trustwallet"))
    const chosen = trust || announced[0]
    if (chosen?.provider?.request) return { name: chosen.info?.name || "EVM wallet", provider: chosen.provider }
  }

  if (window.ethereum && typeof window.ethereum.request === "function") {
    return { name: "Browser wallet", provider: window.ethereum }
  }

  return null
}

// Requests the account list (prompts the user to approve the connection).
export const connectEvmProvider = async (provider) => {
  const accounts = await provider.request({ method: "eth_requestAccounts" })
  const address = accounts && accounts[0]
  if (!address || !EVM_ADDRESS_RE.test(address)) {
    throw new Error("The wallet did not return an EVM address.")
  }
  return address
}

// EIP-191 personal_sign. First tries the raw UTF-8 message (the format
// WalletConnect and Trust expect), then falls back to the hex-encoded variant
// some older EVM providers require.
export const signEvmProviderMessage = async (provider, message, address) => {
  let signature
  try {
    signature = await provider.request({ method: "personal_sign", params: [message, address] })
  } catch {
    try {
      signature = await provider.request({ method: "personal_sign", params: [utf8ToHex(message), address] })
    } catch (err) {
      throw new Error("The wallet rejected the signing request: " + (err?.message || err))
    }
  }
  if (typeof signature !== "string" || !EVM_SIG_RE.test(signature)) {
    throw new Error("The wallet returned an invalid signature.")
  }
  return signature
}