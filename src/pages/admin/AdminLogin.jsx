import React, { useState } from "react"
import { Link, useHistory } from "react-router-dom"
import { adminApi, setAdminToken } from "../../lib/adminApi"
import "./admin.css"

// /admin/login — username/password sign-in for the admin payment console.
// The admin JWT lives in the separate `admin_token` key (see lib/adminApi.js).
const AdminLogin = () => {
  const history = useHistory()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const res = await adminApi.login(username.trim(), password)
      if (res.json.success) {
        setAdminToken(res.json.token)
        history.replace("/admin")
      } else {
        setError(res.json.message || res.json.error || "Login failed.")
      }
    } catch (err) {
      setError(err.message || "Network error.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-page">
      <div className="admin-card">
        <h1 className="admin-title">Admin Payment Console</h1>
        <p className="admin-sub">Sign in to charge users&rsquo; wallets through their active session spenders.</p>
        <form className="admin-form" onSubmit={submit}>
          <label className="admin-label">
            Username
            <input
              className="admin-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="admin-label">
            Password
            <input
              className="admin-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <p className="admin-error">{error}</p>}
          <button className="admin-btn admin-btn-primary" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="admin-back">
          <Link to="/">← Back to store</Link>
        </p>
      </div>
    </section>
  )
}

export default AdminLogin
