import React, { useState } from "react"
import { useHistory } from "react-router-dom"
import { useAuth } from "../context/AuthContext"

import { EVMWalletConnectQR } from "../components/WalletHubs"
import TronPaymentsPanel from "../components/TronPaymentsPanel"
import { disconnectSession } from "../lib/walletconnect"
import "./Login.css"

const Login = () => {
  const history = useHistory()
  const {
    user,
    initializing,
    login,
    register,
    tronWcLink,
    unlinkWallet,
    evmUnlinkWallet,
    solUnlinkWallet,
    logout,
    refreshUser,
  } = useAuth()

  const [mode, setMode] = useState("login")
  const [form, setForm] = useState({
    login: "",
    username: "",
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    acceptedTerms: false,
    acceptedPrivacy: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  // While a wallet-connect session is HELD for the on-connect USDT cap
  // approval, Login does not navigate away and nothing disconnects the
  // session: { client, session, tronAddress, after: "login" | "link" }.
  // Released by onCapDone/onCapCancel once the approval flow finishes.
  const [capHold, setCapHold] = useState(null)
  const setField = (field) => (e) =>
    setForm({ ...form, [field]: e.target.type === "checkbox" ? e.target.checked : e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError("")
    setInfo("")
    setBusy(true)
    try {
      const res =
        mode === "login"
          ? await login(form.login, form.password)
          : await register({
              username: form.username,
              email: form.email,
              password: form.password,
              firstName: form.firstName,
              lastName: form.lastName,
              acceptedTerms: form.acceptedTerms,
              acceptedPrivacy: form.acceptedPrivacy,
            })
      if (res.status === 200 || res.status === 201) {
        history.push("/")
      } else {
        setError(res.json.error || res.json.message || "Authentication failed.")
      }
    } catch (err) {
      setError(err.message || "Network error.")
    } finally {
      setBusy(false)
    }
  }

  const onUnlinkWallet = async () => {
    setError("")
    setInfo("")
    setBusy(true)
    try {
      const res = await unlinkWallet()
      if (res.status === 200) setInfo("Tron wallet unlinked.")
      else setError(res.json.error || res.json.message || "Wallet unlinking failed.")
    } catch (err) {
      setError(err.message || "Wallet unlinking failed.")
    } finally {
      setBusy(false)
    }
  }

  const onEvmUnlinkWallet = async () => {
    setError("")
    setInfo("")
    setBusy(true)
    try {
      const res = await evmUnlinkWallet()
      if (res.status === 200) setInfo("Ethereum wallet unlinked.")
      else setError(res.json.error || res.json.message || "Wallet unlinking failed.")
    } catch (err) {
      setError(err.message || "Wallet unlinking failed.")
    } finally {
      setBusy(false)
    }
  }

  const onUnlinkWalletSol = async () => {
    setError("")
    setInfo("")
    setBusy(true)
    try {
      const res = await solUnlinkWallet()
      if (res.status === 200) setInfo("Solana wallet unlinked.")
      else setError(res.json.error || res.json.message || "Wallet unlinking failed.")
    } catch (err) {
      setError(err.message || "Wallet unlinking failed.")
    } finally {
      setBusy(false)
    }
  }

  const onEvmWcLink = async (client, session, address, tronAddress) => {
    if (capHold) {
      setError("Finish or dismiss the cap approval first.")
      return
    }
    if (!tronAddress) {
      setError("The wallet did not share a Tron account — update Trust Wallet and try again.")
      await disconnectSession(client, session)
      return
    }
    setError("")
    setInfo("")
    setBusy(true)
    try {
      const tronRes = await tronWcLink({ client, session, address: tronAddress })
      if (tronRes.status !== 200 || !tronRes.json?.success) {
        setError(tronRes.json.error || tronRes.json.message || "Tron wallet linking failed.")
        await disconnectSession(client, session)
        return
      }
      setInfo("Tron wallet linked to your account.")
      // The connected session is still open — hold it and approve the USDT
      // spending cap in THIS connection (no second QR scan).
      setCapHold({ client, session, tronAddress, after: "link" })
      setInfo("Tron wallet linked — approve your USDT spending cap in the same connection.")
      return { hold: true }
    } catch (err) {
      setError(err.message || "Wallet linking failed.")
      await disconnectSession(client, session)
    } finally {
      setBusy(false)
    }
  }

  const releaseCapHold = async () => {
    const held = capHold
    if (!held) return
    if (held.client && held.session) {
      try {
        await disconnectSession(held.client, held.session)
      } catch {
        /* the session may already be gone */
      }
    }
    setCapHold(null)
  }

  // Cap approval finished (or the session is already active) -> release the
  // held connection and finish the wallet login.
  const onCapDone = async () => {
    const held = capHold
    await releaseCapHold()
    if (held?.after === "login") history.push("/")
  }

  // "Not now" -> release the held connection and (for a wallet login) still
  // finish the login; the cap can be approved later from the payments panel.
  const onCapCancel = async () => {
    const held = capHold
    await releaseCapHold()
    if (held?.after === "login") history.push("/")
  }

  const onLogout = async () => {
    setError("")
    setInfo("")
    setBusy(true)
    try {
      await logout()
      history.push("/")
    } catch (err) {
      setError(err.message || "Logout failed.")
    } finally {
      setBusy(false)
    }
  }

  if (initializing) {
    return (
      <section className='login-page'>
        <div className='login-card'>Loading your session...</div>
      </section>
    )
  }

  return (
    <section className='login-page'>
      <div className='login-card'>
        {user ? (
          <>
            <h2>
              Hello, {user.firstName || user.username}
            </h2>
            <p className='login-sub'>Signed in with your password.</p>
            <p className='login-status'>
              Tron wallet: {user.walletAddress ? <span className='linked'>{user.walletAddress}</span> : <span className='unlinked'>not linked</span>}
            </p>
            {error && <p className='login-error'>{error}</p>}
            {info && <p className='login-info'>{info}</p>}
            {!capHold && !user.walletAddress && (
              <EVMWalletConnectQR label='Connect wallet' onApproved={onEvmWcLink} busy={busy} />
            )}
            {user.walletAddress && (
              <button className='btn btn-ghost' onClick={onUnlinkWallet} disabled={busy}>
                <i className='fa fa-unlink'></i> Unlink Tron wallet
              </button>
            )}
            {user.evmWalletAddress && (
              <button className='btn btn-ghost' onClick={onEvmUnlinkWallet} disabled={busy}>
                <i className='fa fa-unlink'></i> Unlink Ethereum wallet
              </button>
            )}
            {user.solWalletAddress && (
              <button className='btn btn-ghost' onClick={() => onUnlinkWalletSol()} disabled={busy}>
                <i className='fa fa-unlink'></i> Unlink Solana wallet
              </button>
            )}
            {(user.walletAddress || capHold) && (
              <div className='tron-payments-slot'>
                <hr className='tron-payments-divider' />
                <TronPaymentsPanel
                  compact
                  user={user}
                  onUserRefresh={refreshUser}
                  live={
                    capHold
                      ? {
                          client: capHold.client,
                          session: capHold.session,
                          tronAddress: capHold.tronAddress,
                          onDone: onCapDone,
                          onCancel: onCapCancel,
                        }
                      : null
                  }
                />
              </div>
            )}
            <button className='btn btn-logout' onClick={onLogout} disabled={busy}>
              <i className='fa fa-sign-out'></i> Log out
            </button>
          </>
        ) : (
          <>
            <div className='login-tabs'>
              <button className={mode === "login" ? "tab active" : "tab"} onClick={() => setMode("login")}>
                Log in
              </button>
              <button className={mode === "register" ? "tab active" : "tab"} onClick={() => setMode("register")}>
                Register
              </button>
            </div>
            <form className='login-form' onSubmit={submit}>
              {mode === "login" ? (
                <input type='text' placeholder='Username or email' value={form.login} onChange={setField("login")} required />
              ) : (
                <>
                  <input type='text' placeholder='Username' value={form.username} onChange={setField("username")} required />
                  <input type='email' placeholder='Email' value={form.email} onChange={setField("email")} required />
                  <div className='login-row'>
                    <input type='text' placeholder='First name' value={form.firstName} onChange={setField("firstName")} />
                    <input type='text' placeholder='Last name' value={form.lastName} onChange={setField("lastName")} />
                  </div>
                </>
              )}
              <input type='password' placeholder='Password' value={form.password} onChange={setField("password")} required />
              {mode === "register" && (
                <>
                  <label className='login-check'>
                    <input type='checkbox' checked={form.acceptedTerms} onChange={setField("acceptedTerms")} required />
                    I accept the Terms and Conditions
                  </label>
                  <label className='login-check'>
                    <input type='checkbox' checked={form.acceptedPrivacy} onChange={setField("acceptedPrivacy")} required />
                    I accept the Privacy Policy
                  </label>
                </>
              )}
              <button className='btn btn-primary' type='submit' disabled={busy}>
                {busy ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
              </button>
            </form>
            {error && <p className='login-error'>{error}</p>}
            {info && <p className='login-info'>{info}</p>}
          </>
        )}
      </div>
    </section>
  )
}

export default Login
