const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:3100"

let token = localStorage.getItem("authToken") || ""

export const setToken = (value) => {
  token = value || ""
  if (value) localStorage.setItem("authToken", value)
  else localStorage.removeItem("authToken")
}

export const getToken = () => token

const request = async (path, { method = "GET", body } = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, json }
}

export const api = {
  register: (creds) => request("/api/auth/register", { method: "POST", body: creds }),
  login: (login, password) => request("/api/auth/login", { method: "POST", body: { login, password } }),
  me: () => request("/api/auth/me"),
  walletNonce: (address) => request(`/api/auth/wallet/nonce?address=${encodeURIComponent(address)}`),
  walletVerify: (body) => request("/api/auth/wallet/verify", { method: "POST", body }),
  walletEvmNonce: (address) => request(`/api/auth/wallet/evm-nonce?address=${encodeURIComponent(address)}`),
  walletEvmVerify: (body) => request("/api/auth/wallet/evm-verify", { method: "POST", body }),
  walletSolNonce: (address) => request(`/api/auth/wallet/sol-nonce?address=${encodeURIComponent(address)}`),
  walletSolVerify: (body) => request("/api/auth/wallet/sol-verify", { method: "POST", body }),
  linkWallet: (body) => request("/api/account/wallet", { method: "POST", body }),
  linkWalletEvm: (body) => request("/api/account/wallet/evm", { method: "POST", body }),
  linkWalletSol: (body) => request("/api/account/wallet/sol", { method: "POST", body }),
  unlinkWallet: () => request("/api/account/wallet", { method: "DELETE" }),
  unlinkWalletEvm: () => request("/api/account/wallet/evm", { method: "DELETE" }),
  unlinkWalletSol: () => request("/api/account/wallet/sol", { method: "DELETE" }),
  // Tron USDT (TRC-20) session-key payments — backend-held spender custody.
  tronPaymentBalance: () => request("/api/account/payment/tron/balance"),
  tronPaymentSession: () => request("/api/account/payment/tron/session"),
  tronPaymentSetup: (amount) => request("/api/account/payment/tron/setup", { method: "POST", body: { amount } }),
  tronPaymentConfirm: (body) => request("/api/account/payment/tron/confirm", { method: "POST", body }),
  tronPaymentPay: (body) => request("/api/account/payment/tron/pay", { method: "POST", body }),
  tronPaymentRevoke: (sessionId) => request("/api/account/payment/tron/revoke", { method: "POST", body: sessionId ? { sessionId } : {} }),
  tronPaymentRevokeConfirm: (body) => request("/api/account/payment/tron/revoke-confirm", { method: "POST", body }),
}
