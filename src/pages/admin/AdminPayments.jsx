import React, { useCallback, useEffect, useState } from "react"
import { Link, useHistory } from "react-router-dom"
import { adminApi, getAdminToken, setAdminToken } from "../../lib/adminApi"
import "./admin.css"

// /admin — payment console. Lists ACTIVE user payment sessions and lets an
// authenticated admin charge USDT from a user's wallet through the session
// spender (destination defaults to the merchant address; any other address
// must be in PAYMENT_TRON_DESTINATION_ALLOWLIST). Every charge is recorded in
// the tron_admin_charges ledger.
const AdminPayments = () => {
  const history = useHistory()
  const [booted, setBooted] = useState(false)
  const [me, setMe] = useState(null)
  const [sessions, setSessions] = useState([])
  const [charges, setCharges] = useState([])
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null) // { kind: "ok" | "error", text }
  const [form, setForm] = useState({}) // { [sessionId]: { amount, destination, note } }

  const kick = useCallback(() => {
    setAdminToken(null)
    history.replace("/admin/login")
  }, [history])

  const loadAll = useCallback(async () => {
    const [s, c] = await Promise.all([
      adminApi.sessions("ACTIVE"),
      adminApi.charges(100),
    ])
    if (s.status === 401 || c.status === 401) {
      kick()
      return
    }
    if (s.json.success) setSessions(s.json.sessions || [])
    if (c.json.success) setCharges(c.json.charges || [])
  }, [kick])

  useEffect(() => {
    let cancelled = false
    const boot = async () => {
      if (!getAdminToken()) {
        kick()
        return
      }
      const res = await adminApi.me()
      if (cancelled) return
      if (!res.json.success) {
        kick()
        return
      }
      setMe(res.json.admin)
      await loadAll()
      if (!cancelled) setBooted(true)
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [kick, loadAll])

  const setField = (sid) => (e) =>
    setForm((f) => ({ ...f, [sid]: { ...(f[sid] || {}), [e.target.name]: e.target.value } }))

  const submitCharge = async (sid, e) => {
    e.preventDefault()
    const f = form[sid] || {}
    const amount = Number(f.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setFlash({ kind: "error", text: "Enter a charge amount greater than zero." })
      return
    }
    setFlash(null)
    setBusy(true)
    try {
      const res = await adminApi.charge({
        sessionId: sid,
        amount: String(amount),
        ...(f.destination && f.destination.trim() ? { destination: f.destination.trim() } : {}),
        ...(f.note && f.note.trim() ? { note: f.note.trim() } : {}),
      })
      if (res.status === 401) {
        kick()
        return
      }
      if (res.json.success) {
        setFlash({ kind: "ok", text: res.json.message })
        setForm((prev) => ({ ...prev, [sid]: { amount: "", destination: "", note: "" } }))
        await loadAll()
      } else {
        setFlash({
          kind: "error",
          text: res.json.message || res.json.error || `Charge failed (HTTP ${res.status}).`,
        })
      }
    } catch (err) {
      setFlash({ kind: "error", text: err.message || "Network error." })
    } finally {
      setBusy(false)
    }
  }

  const onLogout = () => kick()

  if (!booted) {
    return (
      <section className="admin-page">
        <div className="admin-card admin-loading">Loading admin console...</div>
      </section>
    )
  }

  return (
    <section className="admin-page admin-console">
      <header className="admin-topbar">
        <div>
          <h1 className="admin-title">Admin Payment Console</h1>
          <p className="admin-sub">
            Signed in as <strong>{me?.username}</strong> ({me?.role})
          </p>
        </div>
        <div className="admin-topbar-actions">
          <Link className="admin-btn admin-btn-ghost" to="/">
            Back to store
          </Link>
          <button className="admin-btn admin-btn-ghost" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>

      {flash && (
        <div className={`admin-flash admin-flash-${flash.kind}`} role="status">
          {flash.text}
        </div>
      )}

      <h2 className="admin-section-title">Active sessions</h2>
      {sessions.length === 0 ? (
        <p className="admin-empty">No ACTIVE payment sessions right now.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>User</th>
                <th>Wallet</th>
                <th>Spender</th>
                <th>Approved</th>
                <th>Remaining</th>
                <th>Expires</th>
                <th>Charge</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>
                    {s.username || "user"} <span className="admin-muted">#{s.userId}</span>
                  </td>
                  <td className="admin-mono">{s.walletAddress}</td>
                  <td className="admin-mono">{s.sessionAddress}</td>
                  <td>{s.approvedUsdt} USDT</td>
                  <td>{s.remainingUsdt} USDT</td>
                  <td>{s.expiryAt ? new Date(s.expiryAt).toLocaleString() : "—"}</td>
                  <td>
                    <details className="admin-charge">
                      <summary className="admin-charge-summary">Charge USDT</summary>
                      <form className="admin-charge-form" onSubmit={(e) => submitCharge(s.id, e)}>
                        <label className="admin-label">
                          Amount (USDT)
                          <input
                            className="admin-input"
                            type="number"
                            name="amount"
                            min="0"
                            step="0.01"
                            placeholder="e.g. 1"
                            value={form[s.id]?.amount || ""}
                            onChange={setField(s.id)}
                            required
                          />
                        </label>
                        <label className="admin-label">
                          Destination <span className="admin-muted">(blank = merchant)</span>
                          <input
                            className="admin-input admin-mono"
                            type="text"
                            name="destination"
                            placeholder="T... (allowlist only)"
                            value={form[s.id]?.destination || ""}
                            onChange={setField(s.id)}
                          />
                        </label>
                        <label className="admin-label">
                          Note
                          <input
                            className="admin-input"
                            type="text"
                            name="note"
                            maxLength="255"
                            placeholder="optional"
                            value={form[s.id]?.note || ""}
                            onChange={setField(s.id)}
                          />
                        </label>
                        <button className="admin-btn admin-btn-primary" type="submit" disabled={busy}>
                          {busy ? "Charging..." : "Charge"}
                        </button>
                      </form>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="admin-section-title">Charge ledger</h2>
      {charges.length === 0 ? (
        <p className="admin-empty">No charges recorded yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>User</th>
                <th>Admin</th>
                <th>Amount</th>
                <th>Destination</th>
                <th>TxID</th>
                <th>Status</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {charges.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}</td>
                  <td>
                    {c.userUsername || "user"} <span className="admin-muted">#{c.userId}</span>
                  </td>
                  <td>{c.adminUsername || c.adminId}</td>
                  <td>{c.amountUsdt} USDT</td>
                  <td className="admin-mono">{c.destination}</td>
                  <td className="admin-mono admin-txid" title={c.txid}>
                    {c.txid ? c.txid.slice(0, 12) + "…" : "—"}
                  </td>
                  <td>
                    <span className={`admin-status admin-status-${(c.status || "").toLowerCase()}`}>{c.status}</span>
                  </td>
                  <td className="admin-muted">{c.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default AdminPayments
