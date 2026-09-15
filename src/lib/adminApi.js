// Admin payment console API client (Option A).
//
// Uses its own `admin_token` localStorage key so an admin session never
// collides with a storefront customer session (customer `authToken`).
const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:3100"

let adminToken = localStorage.getItem("admin_token") || ""

export const setAdminToken = (value) => {
  adminToken = value || ""
  if (value) localStorage.setItem("admin_token", value)
  else localStorage.removeItem("admin_token")
}

export const getAdminToken = () => adminToken

const request = async (path, { method = "GET", body } = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, json }
}

export const adminApi = {
  // Auth
  login: (username, password) => request("/api/admin/login", { method: "POST", body: { username, password } }),
  me: () => request("/api/admin/me"),
  // Payment console
  sessions: (status = "ACTIVE", limit = 100) =>
    request(`/api/admin/payments/sessions?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`),
  charge: (body) => request("/api/admin/payments/charge", { method: "POST", body }),
  charges: (limit = 100) => request(`/api/admin/payments/charges?limit=${encodeURIComponent(limit)}`),
}
