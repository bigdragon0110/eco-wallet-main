import { TrustAdapter } from "@tronweb3/tronwallet-adapter-trust"
import { AdapterState } from "@tronweb3/tronwallet-abstract-adapter"

// ---------------------------------------------------------------------------
// Tron wallet access with a RAW-PROVIDER FALLBACK.
//
// Why: @tronweb3 TrustAdapter only recognises window.tronLink, and even then
// only after its own detection window. Inside Trust Wallet's DApp browser the
// provider may live at window.trustwallet.tronLink (or window.tronLink) and be
// injected LATE — the adapter then reports AdapterState.NotFound and every
// button throws "Trust Wallet is not installed". When that happens we talk to
// the injected provider directly (TronLink protocol):
//   tron_requestAccounts → permission popup
//   window.tronWeb.defaultAddress.base58 → current T... address
//   tronLink.signMessageV2(message) → signature for the login challenge
// ---------------------------------------------------------------------------
const rawProvider = () =>
  window.tronLink ||
  (window.trustwallet && window.trustwallet.tronLink) ||
  null

const rawWait = (ms = 3000) =>
  new Promise((resolve) => {
    if (rawProvider()) return resolve(true)
    const started = Date.now()
    const timer = setInterval(() => {
      if (rawProvider()) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - started >= ms) {
        clearInterval(timer)
        resolve(false)
      }
    }, 150)
  })

// Poll until the wallet fills window.tronWeb.defaultAddress — Trust only does
// this AFTER the user approves the connect popup, which can take seconds.
const rawAddressWait = (ms = 12000) =>
  new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const tronWeb = window.tronWeb || (rawProvider() && rawProvider().tronWeb) || null
      const address =
        (tronWeb && tronWeb.defaultAddress && tronWeb.defaultAddress.base58) || null
      if (address) {
        clearInterval(timer)
        resolve(address)
      } else if (Date.now() - started >= ms) {
        clearInterval(timer)
        resolve(null)
      }
    }, 250)
  })

const rawConnect = async () => {
  const ok = await rawWait()
  const provider = rawProvider()
  if (!ok || !provider) {
    throw new Error("Trust Wallet is not installed in this browser.")
  }
  // Request account access (shows Trust's connect popup if not yet granted).
  try {
    await provider.request({ method: "tron_requestAccounts" })
  } catch (err) {
    // Already-connected sessions may reject the repeat request — ignore only that.
    if (!/already/i.test(String(err && err.message))) throw err
  }
  // The address is NOT available synchronously: wait for the user to approve
  // the popup and the wallet to populate defaultAddress (up to 12 s).
  const address = await rawAddressWait(12000)
  if (!address) throw new Error("Trust Wallet did not return an address (approval popup was not completed or timed out).")
  return address
}

const rawSignMessage = async (message) => {
  const provider = rawProvider()
  if (!provider) throw new Error("Trust Wallet is not installed in this browser.")
  // Preferred: TronLink message-signing (recovers address, no tx broadcast).
  if (typeof provider.signMessageV2 === "function") {
    const signature = await provider.signMessageV2(message)
    if (signature) return signature
  }
  if (provider.request) {
    const signature = await provider.request({
      method: "tron_signMessage",
      params: { message },
    })
    if (signature) return typeof signature === "string" ? signature : signature.signature
  }
  const tronWeb = window.tronWeb || provider.tronWeb
  if (tronWeb && tronWeb.trx && typeof tronWeb.trx.sign === "function") {
    const signature = await tronWeb.trx.sign(message)
    if (signature) return signature
  }
  throw new Error("Trust Wallet did not return a signature.")
}

let singleton = null

export const createWallet = (config = {}) => {
  const adapter = new TrustAdapter({
    checkTimeout: 5000,
    openUrlWhenWalletNotFound: false,
    ...config,
  })

  const addressOf = () => adapter.address || null

  return {
    adapter,
    addressOf,
    isInstalled: () =>
      adapter.state !== AdapterState.NotFound || Boolean(rawProvider()),
    isConnected: () => Boolean(adapter.address) && adapter.state === AdapterState.Connected,
    connect: async () => {
      // Raw provider first: it is authoritative inside Trust's DApp browser and
      // works even when the adapter's window-based detection fails.
      if (rawProvider()) return rawConnect()
      if (adapter.state === AdapterState.NotFound) {
        throw new Error("Trust Wallet is not installed in this browser.")
      }
      if (adapter.address && adapter.state === AdapterState.Connected) {
        return adapter.address
      }
      await adapter.connect()
      const address = adapter.address
      if (!address) throw new Error("Trust Wallet did not return an address.")
      return address
    },
    signMessage: async (message) => {
      if (rawProvider()) return rawSignMessage(message)
      if (adapter.state === AdapterState.NotFound) {
        throw new Error("Trust Wallet is not installed in this browser.")
      }
      const signature = await adapter.signMessage(message)
      if (!signature) throw new Error("Trust Wallet did not return a signature.")
      return signature
    },
    disconnect: () => adapter.disconnect().catch(() => {}),
  }
}

export const getWallet = () => (singleton ||= createWallet())
