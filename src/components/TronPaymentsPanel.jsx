import React, { useCallback, useEffect, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { api } from "../lib/api"
import {
  approveSession,
  connectPairing,
  disconnectSession,
  signTronTransaction,
} from "../lib/walletconnect"


// ---------------------------------------------------------------------------
// Tron USDT (TRC-20) session-key payment panel — backend-held spender custody.
//
// Two modes:
//
// 1. Normal (panel inside the account area): the backend holds the session
//    (spender) key; the panel fetches the UNSIGNED approve(spender, cap)
//    transaction (from setup or rebuilt on demand by GET /session, so a page
//    refresh can't strand the flow), connects once over WalletConnect QR,
//    signs it with tron_signTransaction in Trust Wallet and confirms. The
//    backend broadcasts and re-reads the ON-CHAIN allowance before activating.
//
// 2. Live ("on-connect"): Login has just connected the wallet and hands us the
//    STILL-OPEN WalletConnect {client, session} via the `live` prop — so the
//    cap approval can be pushed straight into the wallet with NO second QR
//    scan. QR pairing remains available as a fallback ("Approve by QR
//    instead"). When the flow finishes (or the session is no longer awaiting
//    approval) `live.onDone()` is called so Login can navigate away; "Not now"
//    calls `live.onCancel()` and Login releases the held session.
//
// Cap policy (user-approved): allowed cap = max(10 000 USDT, live wallet
// balance), further bounded by the backend PAYMENT_TRON_MAX_CAP_USDT. The
// "Max" button picks exactly that value from the balance endpoint.
// ---------------------------------------------------------------------------
// The backend answers 400 { code: "TRON_WALLET_NOT_LINKED" } when the authed
// account has no linked Tron wallet (e.g. it was unlinked in another tab or
// device while this panel still renders, or the link never persisted). The
// panel must stop the cap flow and show actionable copy instead of a raw
// failure — detected by the stable code, message text as a fallback.
const WALLET_NOT_LINKED_MSG =
  "Your Tron wallet is not linked to this account. Link it with one QR scan above, then approve your USDT cap."
const isWalletNotLinked = (res) =>
  res?.json?.code === "TRON_WALLET_NOT_LINKED" || /No Tron wallet is linked/i.test(res?.json?.message || "")
const STATUS_LABEL = {
  pending_approval: "Pending approval — sign in your wallet",
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
}

export const TronPaymentsPanel = ({ user, live, onUserRefresh, compact = false }) => {
  const walletAddress = live?.tronAddress || user?.walletAddress

  const [balance, setBalance] = useState(null)
  const [session, setSession] = useState(null)
  const [approvalTxid, setApprovalTxid] = useState(null)
  const [amount, setAmount] = useState("")
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [qrUri, setQrUri] = useState("")
  const [qrFallback, setQrFallback] = useState(false)
  const [hasTronLinkExt, setHasTronLinkExt] = useState(false)
  const [walletNotLinked, setWalletNotLinked] = useState(false)
  const clientRef = useRef(null)
  const sessionRef = useRef(null)

  // Desktop fallback #1 (best): the TronLink BROWSER EXTENSION signs the
  // approve() directly — no WalletConnect, no QR at all. Shown only when the
  // extension is actually injected (TronLink injects window.tronLink; matching
  // the detection to the signer avoids dead buttons from stale tronWeb
  // injections by other wallets).
  useEffect(() => {
    // Desktop: the TronLink extension injects window.tronLink. Trust's mobile
    // dApp browser injects its Tron provider at window.trustwallet.tronLink
    // (sometimes ALSO aliasing window.tronLink) — accept both so the no-QR
    // injected signer works inside Trust's browser too.
    setHasTronLinkExt(Boolean(window.tronLink || window.trustwallet?.tronLink))
  }, [])

  const load = useCallback(async () => {
    if (!walletAddress) return
    setLoading(true)
    setError("")
    try {
      const res = await api.tronPaymentBalance()
      if (res.ok) {
        setWalletNotLinked(false)
        setBalance(res.json)
        setSession(res.json.session || null)
      } else if (isWalletNotLinked(res)) {
        setWalletNotLinked(true)
        setSession(null)
        setError(WALLET_NOT_LINKED_MSG)
        // The account lost its Tron link (stale client state vs DB) — refresh
        // the user so the panel hides in normal mode once the UI catches up.
        onUserRefresh?.()
      } else {
        setError(res.json?.message || "Failed to load payment balance.")
      }
    } catch (err) {
      setError(err.message || "Failed to load payment balance.")
    } finally {
      setLoading(false)
    }
  }, [walletAddress, onUserRefresh])

  useEffect(() => {
    if (walletAddress) load()
  }, [walletAddress, load])

  // Live mode: prefill the cap with the allowed maximum once the balance loads
  // (user policy: max = max(10 000 USDT, wallet balance)); never overwrite a
  // value the user typed.
  useEffect(() => {
    if (live && balance?.allowedMaxUsdt && !amount) setAmount(String(balance.allowedMaxUsdt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, balance])

  // Live mode: push the approval prompt into the wallet AUTOMATICALLY as soon
  // as the cap is prefilled — the user should not have to tap anything. Fires
  // once per mount; if the wallet rejects the request (e.g. Trust's error 5201
  // "Unknown method(s) requested") the error state blocks re-firing and the
  // buttons / QR fallback stay available for a manual retry.
  const autoTriedRef = useRef(false)
  useEffect(() => {
    if (!live || !balance || !amount || loading || connecting || error || walletNotLinked || session?.status === "active" || session?.approveTxid || approvalTxid) return
    if (autoTriedRef.current) return
    autoTriedRef.current = true
    onApproveNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, balance, amount, loading, connecting, error, walletNotLinked])

  // Normal mode (Trust dApp browser / TronLink extension): push the approval
  // prompt into the wallet AUTOMATICALLY as soon as the wallet is linked and
  // the balance is known — the injected provider signs with no QR and no extra
  // tap (user directive: approve the cap as soon as the wallet connects).
  // Fires once per mount when NO usable cap session exists; a pending session
  // is left to the manual buttons (it may be stale from another device), and
  // an active cap means there is nothing to approve.
  const normalAutoTriedRef = useRef(false)
  useEffect(() => {
    if (live || !hasTronLinkExt || walletNotLinked) return
    if (!balance || loading || connecting || error) return
    if (session && ["pending_approval", "active"].includes(session.status)) return
    if (normalAutoTriedRef.current) return
    normalAutoTriedRef.current = true
    onApproveWithExtension(maxUsdt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, hasTronLinkExt, balance, session, loading, connecting, error, walletNotLinked])

  // Verify submitted approvals sequentially; never request another signature.
  const [checking, setChecking] = useState(false)
  const [pollAttempt, setPollAttempt] = useState(0)
  const [verificationFailed, setVerificationFailed] = useState(false)
  useEffect(() => {
    if (!(approvalTxid || session?.approveTxid) || session?.status === "active" || loading || connecting || verificationFailed) return
    let cancelled = false
    let timer
    let delay = 3000
    const poll = async () => {
      setChecking(true)
      try {
        const res = await api.tronPaymentConfirm({ check: true })
        if (cancelled) return
        if (res.ok && res.json?.session?.status === "active") {
          setSession(res.json.session)
          setError("")
          setInfo("")
          return
        }
        if (res.json?.code === "TX_REVERTED" || res.json?.code === "CAP_VIOLATION") {
          setError(res.json.message)
          setVerificationFailed(true)
          return
        }
        setError(res.json?.code === "TX_PENDING" ? "" : (res.json?.message || "Status unavailable. Retrying automatically…"))
      } catch {
        if (!cancelled) setError("Connection interrupted. Retrying approval status automatically…")
      } finally { if (!cancelled) setChecking(false) }
      if (!cancelled) {
        timer = setTimeout(poll, delay)
        delay = Math.min(delay * 2, 30000)
      }
    }
    timer = setTimeout(poll, 1000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [approvalTxid, session?.approveTxid, session?.status, loading, connecting, pollAttempt, verificationFailed])
  // Live-mode safety net: once we hold session data that is no longer awaiting
  // approval (already active, or just confirmed via tap/QR), the on-connect
  // flow is over — hand control back so Login can finish the navigation.
  // Deliberately NOT called while loading, so the initial balance load can
  // settle before any decision is made.
  useEffect(() => {
    if (!live || !session || loading) return
    if (session.status === "active") live.onDone()
  }, [live, session, loading])

  const maxUsdt = balance?.allowedMaxUsdt || balance?.capFloorUsdt || "10000"

  const onSetup = async () => {
    setError("")
    setInfo("")
    if (!amount || Number(amount) <= 0) {
      setError("Enter the session cap in USDT.")
      return
    }
    setLoading(true)
    try {
      const res = await api.tronPaymentSetup(amount)
      if (!res.ok) {
        if (isWalletNotLinked(res)) {
          setWalletNotLinked(true)
          setSession(null)
          setError(WALLET_NOT_LINKED_MSG)
          onUserRefresh?.()
        } else {
          setError(res.json?.message || "Failed to create the session.")
        }
        return
      }
      setSession(res.json.session || null)
      setAmount("")
      setInfo("Session created. Approve it in your wallet to activate payments.")
      // Zero-tap handoff: with an injected provider (TronLink extension or the
      // Trust dApp browser) pop the approval prompt right away — the user
      // should not have to find a second button after creating the session.
      if (hasTronLinkExt) onApproveWithExtension()
      load()
    } catch (err) {
      setError(err.message || "Failed to create the session.")
    } finally {
      setLoading(false)
    }
  }

  const onRevoke = async () => {
    setError("")
    setInfo("")
    setLoading(true)
    try {
      const res = await api.tronPaymentRevoke(session?.id)
      if (!res.ok) {
        setError(res.json?.message || "Revoke failed.")
        return
      }
      setInfo(res.json.message || "Session revoked.")
      load()
    } catch (err) {
      setError(err.message || "Revoke failed.")
    } finally {
      setLoading(false)
    }
  }

  const cleanupPairing = async () => {
    if (clientRef.current && sessionRef.current) {
      await disconnectSession(clientRef.current, sessionRef.current)
    }
    clientRef.current = null
    sessionRef.current = null
    setQrUri("")
  }

  // Shared prelude for signing: reuse a pending approval transaction if the
  // session already exists (refresh-safe, rebuilt by GET /session), otherwise
  // create one for the current cap amount. Returns {session,
  // unsignedTransaction} or {error}.
  const getOrCreatePending = async (capAmount = amount) => {
    const sessionRes = await api.tronPaymentSession()
    if (sessionRes.ok && sessionRes.json.session?.status === "pending_approval") {
      setSession(sessionRes.json.session)
      if (sessionRes.json.session.approveTxid) return { error: "An approval was already submitted. Use Check approval status." }
    }
    if (!sessionRes.ok && isWalletNotLinked(sessionRes)) {
      // The account has no linked Tron wallet — do not fall through to setup
      // (it would fail the same way); surface the actionable error instead.
      setWalletNotLinked(true)
      setSession(null)
      setError(WALLET_NOT_LINKED_MSG)
      onUserRefresh?.()
      return { error: WALLET_NOT_LINKED_MSG }
    }
    // A cap amount is only needed on the CREATE leg (reusing a pending session
    // signs its already-built transaction). Validating here lets the no-QR
    // resume path work with an empty input as long as a session is pending.
    if (!capAmount || Number(capAmount) <= 0) return { error: "Enter the session cap in USDT." }
    const setup = await api.tronPaymentSetup(capAmount)
    if (!setup.ok) {
      if (isWalletNotLinked(setup)) {
        setWalletNotLinked(true)
        setSession(null)
        setError(WALLET_NOT_LINKED_MSG)
        onUserRefresh?.()
      }
      return { error: setup.json?.message || "Failed to create the session." }
    }
    setSession(setup.json.session || null)
    const unsignedTransaction = setup.json.unsignedTransaction || null
    if (!unsignedTransaction) return { error: "The approval transaction is unavailable — please try again." }
    return { session: setup.json.session, unsignedTransaction }
  }

  const checkApprovalStatus = async () => {
    setLoading(true)
    setError("")
    setInfo("")
    try {
      const res = await api.tronPaymentConfirm({ check: true })
      if (res.json?.txid) setApprovalTxid(res.json.txid)
      if (!res.ok) { setError(res.json?.message || "Could not check approval status."); return }
      setSession(res.json.session)
      setInfo("USDT spending cap confirmed.")
    } catch (err) { setError(err.message || "Could not check approval status.") }
    finally { setLoading(false) }
  }

  const trackedTxid = approvalTxid || session?.approveTxid
  const approvalRecovery = session?.status !== "active" && (
    <div className='login-status'>
      {trackedTxid && <p style={{ overflowWrap: "anywhere" }}>Approval transaction: <a href={`https://tronscan.org/#/transaction/${encodeURIComponent(trackedTxid)}`} target='_blank' rel='noreferrer'>{trackedTxid}</a></p>}
      <button className='btn btn-ghost' onClick={checkApprovalStatus} disabled={loading || connecting}>Check approval status</button>
      <p>Checking status does not request a signature or payment. Energy rental is separate from USDT approval.</p>
    </div>
  )

  // Some wallets (notably Trust Wallet over WalletConnect) do not execute
  // tron_signTransaction requests from a dapp browser session — they answer
  // error 5201 "Unknown method(s) requested" without ever showing a prompt, or
  // sign + broadcast on their own and return an EMPTY signature array. In both
  // cases nothing comes back for the backend to broadcast, so ask the backend
  // to VERIFY the on-chain allowance instead: if the wallet really did broadcast
  // the approval, the session still activates (min(allowance, cap), CAP_VIOLATION
  // guard unchanged). Returns true when the session is active.
  const verifyOnChain = async () => {
    const confirm = await api.tronPaymentConfirm({ verify: true })
    if (confirm.ok) {
      setSession(confirm.json.session || null)
      setAmount("")
      setInfo(`Cap approved — ${confirm.json.session?.approvedUsdt || "—"} USDT ready to pay.`)
      load()
      return true
    }
    if (confirm.json?.code === "ALLOWANCE_ZERO") {
      // The backend auto-revoked the pending row (on-chain allowance is still
      // 0 — the approval never made it to the chain). Drop the stale session
      // so the panel cannot keep rendering a fake "Pending approval" session
      // alongside the error.
      setSession(null)
    }
    return false
  }

  // Sign the unsigned approve() with the TronLink EXTENSION (window.tronLink),
  // then hand the signed transaction to the backend for broadcast + on-chain
  // verification. The extension must be on the same Tron address as the linked
  // wallet.
  const signWithTronLinkExtension = async (unsignedTransaction) => {
    // TronLink extension (desktop) and Trust dApp browser (mobile) both speak
    // the tronLink provider API — Trust exposes it at window.trustwallet.tronLink.
    const tronLink = window.tronLink || window.trustwallet?.tronLink
    if (!tronLink) throw new Error("No Tron wallet provider (TronLink extension / Trust dApp browser) is available.")
    try {
      await tronLink.request({ method: "tron_requestAccounts" })
    } catch {
      /* already unlocked / connected */
    }
    const extensionAddress = window.tronWeb?.defaultAddress?.base58 || null
    if (extensionAddress && extensionAddress !== walletAddress) {
      throw new Error(
        `TronLink is on ${extensionAddress} but the linked wallet is ${walletAddress} — switch accounts in TronLink.`
      )
    }
    let res = null
    try {
      res = await tronLink.request({ method: "tron_signTransaction", params: [{ ...unsignedTransaction }] })
    } catch (reqErr) {
      // The extension itself threw (popup rejected, popup closed, request
      // timed out). This is NOT a Trust-session 5201 rejection — carry a
      // tagged error so the failure handler shows the accurate copy and does
      // not revoke the session or force the QR fallback.
      const msg = reqErr?.message || "The TronLink extension request failed."
      const extErr = new Error(msg)
      extErr.extension = true
      throw extErr
    }
    // TronLink response shapes (documented + observed):
    //   { result: true, data: <signedTransaction> }   (success)
    //   { result: false, data: <error>, message? }    (explicit failure)
    //   <signedTransaction> directly                  (some builds)
    if (res && res.result === false) {
      const extErr = new Error(res.message || "The approval was rejected in the TronLink extension.")
      extErr.extension = true
      throw extErr
    }
    const signed = res?.result ? res.data : res?.data || res
    if (!signed || typeof signed !== "object") {
      const extErr = new Error("TronLink did not return a signed transaction.")
      extErr.extension = true
      throw extErr
    }
    const signatures = signed.signature || signed.signatures || null
    if (!Array.isArray(signatures) || signatures.length === 0) {
      const extErr = new Error("TronLink returned a transaction without a signature.")
      extErr.extension = true
      throw extErr
    }
    return signed
  }

  // Approve via the injected Tron provider — TronLink extension (desktop) or
  // Trust's dApp browser (mobile: window.trustwallet.tronLink). No QR, no
  // WalletConnect. Works in BOTH modes: live (held QR pairing) and normal
  // (linked wallet inside the dApp browser / with the desktop extension).
  const onApproveWithExtension = async (capOverride = null) => {
    setError("")
    setInfo("")
    setLoading(true)
    try {
      const pending = await getOrCreatePending(capOverride || amount)
      if (pending.error) {
        setError(pending.error)
        return
      }
      setInfo("Confirm the approval in your wallet…")
      const signedTx = await signWithTronLinkExtension(pending.unsignedTransaction)
      setApprovalTxid(signedTx.txID)
      const confirm = await api.tronPaymentConfirm({ signedTransaction: signedTx })
      if (!confirm.ok) {
        setError(confirm.json?.message || "Approval confirmation failed.")
        return
      }
      setSession(confirm.json.session || null)
      setAmount("")
      setInfo(`Cap approved — ${confirm.json.session?.approvedUsdt || "—"} USDT ready to pay.`)
      load()
    } catch (err) {
      // Extension-path failures must NOT be confused with Trust-session 5201
      // rejections: the on-chain verify / auto-revoke / QR-fallback cascade
      // only makes sense for the held WalletConnect session.
      if (err?.extension) {
        setInfo("")
        setError(`${err.message} The session cap was NOT approved — nothing was recorded on-chain. Confirm the request in your wallet (make sure the linked account ${walletAddress} is selected) and retry.`)
        return
      }
      await handleSignFailure(err)
    } finally {
      setLoading(false)
    }
  }

  // Map wallet-side failures through an on-chain verification attempt, then
  // collapse to a clear error + QR fallback. Order matters: the reload after a
  // failed verify REFRESHES the real session state (the row was auto-revoked,
  // so the balance endpoint returns no session) and clears any stale error
  // before the permanent one is shown — otherwise the panel keeps rendering
  // the old "Pending approval" session forever.
  // NOTE: extension failures are tagged (err.extension) and short-circuit
  // before handleSignFailure — this cascade is Trust-session-only.
  const handleSignFailure = async (err) => {
    const msg = err?.message || ""
    // Pairing/session expired on the wallet or bridge side (e.g. "Approval
    // request expired" / "Session has ended"). The backend session row is
    // untouched, so NO on-chain verify / auto-revoke: clear the stale info and
    // point the user at a fresh QR. Tested BEFORE the 5201 regex — "expired"
    // and friends are wallet-side timeouts, not session rejections.
    if (/expired|timed?\s?out|timeout/i.test(msg)) {
      await load()
      setInfo("")
      setError(
        live
          ? "The pairing QR expired — tap 'Approve by QR instead' to generate a fresh QR, then scan it with Trust's in-app scanner."
          : "The pairing QR expired — tap 'Approve in wallet (QR)' again to generate a fresh QR, then scan it with Trust's in-app scanner."
      )
      return
    }
    if (/unknown method|5201|without a signature|did not return/i.test(msg)) {
      setInfo("Your wallet signs Tron approvals its own way — checking the chain for your approval…")
      if (await verifyOnChain()) return
      await load() // refreshes balance + session; session becomes null (auto-revoked)
      setInfo("")
      // Mode-aware: live mode shows a fresh QR below the error (qrFallback),
      // normal mode does NOT (the pending-session area is gone after the
      // auto-revoke) — the only way forward there is a fresh setup.
      setError(
        live
          ? "No approval was recorded on-chain, so the session was closed. Your wallet can't sign Tron approvals inside this session (it blocked the request). Scan the QR below with your wallet, or update your wallet app and retry — each retry creates a fresh session."
          : "No approval was recorded on-chain, so the session was closed. Update the Trust app, then tap 'Set up payment session' and try again — each setup creates a fresh session."
      )
      setQrFallback(live)
      return
    }
    setInfo("")
    setError(msg || "Cap approval failed.")
  }

  // Live mode: tap-to-approve over the ALREADY-OPEN WalletConnect session from
  // the login/link QR — the wallet prompts once and the cap is set. No second
  // QR scan. Fired automatically on mount (see the auto-approve effect); the
  // button stays as a manual retry.
  const onApproveNow = async () => {
    if (!live) return
    setError("")
    setInfo("")
    if (!amount || Number(amount) <= 0) {
      setError("Enter the session cap in USDT.")
      return
    }
    setLoading(true)
    try {
      const pending = await getOrCreatePending()
      if (pending.error) {
        setError(pending.error)
        return
      }
      setInfo("Check your wallet and approve the USDT spending cap.")
      const signedTx = await signTronTransaction(
        live.client,
        live.session,
        pending.unsignedTransaction,
        live.tronAddress
      )
      setApprovalTxid(signedTx.txID)
      const confirm = await api.tronPaymentConfirm({ signedTransaction: signedTx })
      if (!confirm.ok) {
        setError(confirm.json?.message || "Approval confirmation failed.")
        return
      }
      setSession(confirm.json.session || null)
      setAmount("")
      setInfo(`Cap approved — ${confirm.json.session?.approvedUsdt || "—"} USDT ready to pay.`)
      load()
      // The live safety-net effect hands control back (live.onDone) once the
      // session reads as active.
    } catch (err) {
      await handleSignFailure(err)
    } finally {
      setLoading(false)
    }
  }

  // WalletConnect QR flow: show QR -> wallet approves the session (tron
  // namespace, already advertised) -> sign the unsigned approve() held by the
  // backend -> confirm. The transaction is fetched fresh (and in live mode
  // created on demand), so this works even after a page refresh mid-flow.
  const onApproveWithQr = async () => {
    setError("")
    setInfo("")
    setConnecting(true)
    try {
      let pendingTask
      if (live) {
        pendingTask = await getOrCreatePending()
        if (pendingTask.error) {
          setError(pendingTask.error)
          return
        }
      } else {
        const sessionRes = await api.tronPaymentSession()
        if (sessionRes.ok && sessionRes.json.session?.approveTxid) {
          setSession(sessionRes.json.session)
          setError("An approval was already submitted. Use Check approval status.")
          return
        }
        if (!sessionRes.ok || !sessionRes.json.session || sessionRes.json.session.status !== "pending_approval") {
          setError(
            "No pending approval to sign — the previous attempt was closed (no approval was recorded on-chain). Set the cap and create the session again."
          )
          return
        }
        pendingTask = await getOrCreatePending(amount || maxUsdt)
        if (pendingTask.error) { setError(pendingTask.error); return }
      }
      const unsignedTransaction = pendingTask.unsignedTransaction
      // Tron-only pairing (user directive): QR fallback connects the Tron
      // account alone — EVM/Solana namespaces are not requested.
      const { client, uri, approval } = await connectPairing()
      clientRef.current = client
      setQrUri(uri)
      setInfo("Waiting for the scan — open Trust's in-app scanner and scan this QR (not the phone camera).")
      const approved = await approveSession(approval)
      sessionRef.current = approved.session
      if (!approved.tronAddress) {
        setError("The wallet did not share a Tron account — update Trust Wallet and try again.")
        await disconnectSession(client, approved.session)
        return
      }
      if (approved.tronAddress !== walletAddress) {
        setError(
          `Wallet ${approved.tronAddress} differs from the linked wallet ${walletAddress} — scan with the linked wallet.`
        )
        return
      }
      setQrUri("")
      setInfo("Pairing approved — wait for the approval prompt in your wallet…")

      const signedTx = await signTronTransaction(client, approved.session, unsignedTransaction, approved.tronAddress)
      setApprovalTxid(signedTx.txID)
      const confirm = await api.tronPaymentConfirm({ signedTransaction: signedTx })
      if (!confirm.ok) {
        setError(confirm.json?.message || "Approval confirmation failed.")
        return
      }
      setSession(confirm.json.session || null)
      setInfo(`Session approved — ${confirm.json.session?.approvedUsdt || "—"} USDT ready to pay.`)
      await load()
      if (live) setQrFallback(false)
      // In live mode the safety-net effect hands control back (live.onDone);
      // in normal mode the panel simply updates in place.
    } catch (err) {
      // BOTH modes route through the shared failure handler: it clears the
      // stale "Wait for the approval prompt…" info, tries the on-chain verify
      // path (wallets that sign+broadcast themselves), and otherwise shows a
      // clear error. (qrFallback state is live-only and inert here.)
      await handleSignFailure(err)
    } finally {
      await cleanupPairing()
      setConnecting(false)
    }
  }

  // When the guided fallback opens, generate the pairing QR automatically —
  // the user should not have to tap "Show QR" on top of everything else. Once
  // per fallback entry (reset by the Back button).
  const autoQrTriedRef = useRef(false)
  useEffect(() => {
    if (!live || !qrFallback || connecting || qrUri) return
    if (autoQrTriedRef.current) return
    autoQrTriedRef.current = true
    onApproveWithQr()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, qrFallback, connecting, qrUri])

  // Live (on-connect) card: cap input prefilled with the allowed maximum,
  // tap-to-approve over the held session, QR pairing as fallback.
  if (compact) {
    const ready = session?.status === "active"
    const submitted = Boolean(trackedTxid)
    const label = ready ? "✓ Wallet ready" : verificationFailed ? "Approval failed" : submitted
      ? (error ? "Retry status check" : "Confirming approval…")
      : "Active wallet"
    return (
      <div aria-live='polite'>
        {!ready && session?.approvedUsdt && <p className='login-status'>Requested spending cap: {session.approvedUsdt} USDT</p>}
        <button className='btn btn-primary'
          disabled={ready || loading || connecting || checking || verificationFailed}
          onClick={async () => {
            if (submitted) { setError(""); setPollAttempt(value => value + 1) }
            else if (live) onApproveNow()
            else if (hasTronLinkExt) onApproveWithExtension(maxUsdt)
            else {
              setLoading(true)
              try {
                const pending = await getOrCreatePending(amount || maxUsdt)
                if (pending.error) { setError(pending.error); return }
                await onApproveWithQr()
              } catch (err) { setError(err.message || "Could not prepare approval.") }
              finally { setLoading(false) }
            }
          }}>{label}</button>
        {qrUri && <QRCodeSVG value={qrUri} size={208} />}
        {error && <p className='login-error'>{error}</p>}
      </div>
    )
  }
  if (live) {
    return (
      <div className='tron-payments tron-payments-live'>
        <h3 className='tron-payments-title'>
          <i className='fa fa-check-circle'></i> Approve your USDT spending cap
        </h3>
        <p className='tron-payments-sub'>
          Your wallet is connected. Approve the cap once and the site pays from your USDT balance without asking you
          to sign every order — no need to scan again.
        </p>

        {walletNotLinked ? (
          <>
            <p className='login-error'>{error || WALLET_NOT_LINKED_MSG}</p>
            <button className='btn btn-ghost' onClick={live.onCancel}>
              <i className='fa fa-times'></i> Close
            </button>
          </>
        ) : (
          <>
            {error && <p className='login-error'>{error}</p>}{approvalRecovery}
        {info && <p className='login-info'>{info}</p>}

        {loading && <p className='qr-hint'>Checking your wallet…</p>}

        {balance && !loading && (
          <p className='login-status'>
            Tron wallet: <span className='linked'>{walletAddress}</span>
            <br />
            USDT balance: <span className='linked'>{balance.balanceUsdt} USDT</span>
            <br />
            Max cap: <span className='linked'>{balance.allowedMaxUsdt} USDT</span>
          </p>
        )}

        {!qrFallback ? (
          <>
            <div className='login-row'>
              <input
                type='text'
                inputMode='decimal'
                placeholder='Spending cap (USDT)'
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}
              />
              <button
                className='btn btn-ghost'
                type='button'
                onClick={() => setAmount(maxUsdt)}
                disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}
                title="Max = 10 000 USDT or your wallet balance, whichever is higher"
              >
                Max
              </button>
            </div>
            <button className='btn btn-primary' onClick={onApproveNow} disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}>
              <i className='fa fa-mobile'></i> {loading ? "Check your wallet…" : "Approve cap now"}
            </button>
            {hasTronLinkExt && (
              <button className='btn btn-primary' onClick={onApproveWithExtension} disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}>
                <i className='fa fa-chrome'></i> Sign in wallet (no QR)
              </button>
            )}
            <button className='btn btn-ghost' onClick={() => setQrFallback(true)} disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}>
              <i className='fa fa-qrcode'></i> Approve by QR instead
            </button>
            <button className='btn btn-ghost' onClick={live.onCancel} disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}>
              <i className='fa fa-times'></i> Not now
            </button>
          </>
        ) : (
          <>
            <p className='qr-hint'>
              Fallback: some wallets (older Trust builds) refuse to sign Tron approvals inside the login session — scan
              with Trust's in-app scanner to finish the approval.
            </p>
            {hasTronLinkExt && (
              <button className='btn btn-primary' onClick={onApproveWithExtension} disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}>
                <i className='fa fa-chrome'></i> Sign in wallet (no QR)
              </button>
            )}
            <div className='qr-panel'>
              {qrUri ? (
                <div className='qr-box'>
                  <QRCodeSVG value={qrUri} size={208} level='M' includeMargin />
                  <p className='qr-hint'>Scan with Trust's in-app scanner (linked account {walletAddress}).</p>
                </div>
              ) : connecting ? (
                <p className='qr-hint'>Generating approval QR…</p>
              ) : (
                <button className='btn btn-wallet-qr' onClick={onApproveWithQr} disabled={connecting}>
                  <i className='fa fa-qrcode'></i> Show QR
                </button>
              )}
            </div>
            <button
              className='btn btn-ghost'
              onClick={() => {
                autoQrTriedRef.current = false
                setQrFallback(false)
              }}
              disabled={connecting}
            >
              <i className='fa fa-arrow-left'></i> Back
            </button>
          </>
        )}
          </>
        )}
      </div>
    )
  }

  if (!walletAddress) return null

  const pending = session?.status === "pending_approval"
  const done = session?.status === "active"

  return (
    <div className='tron-payments'>
      <h3 className='tron-payments-title'>
        <i className='fa fa-credit-card'></i> Tron USDT payments
      </h3>
      <p className='tron-payments-sub'>
        Approve a spending cap once; the site pays from your USDT balance without asking you to sign every order.
      </p>

      {error && <p className='login-error'>{error}</p>}{approvalRecovery}
      {info && <p className='login-info'>{info}</p>}

      {loading && <p className='qr-hint'>Checking balance…</p>}

      {balance && !loading && (
        <p className='login-status'>
          Tron wallet: <span className='linked'>{walletAddress}</span>
          <br />
          USDT balance: <span className='linked'>{balance.balanceUsdt} USDT</span>
          <br />
          Max cap: <span className='linked'>{balance.allowedMaxUsdt} USDT</span>
        </p>
      )}

      {session && (
        <p className='login-status'>
          Session: <span className={done ? "linked" : "unlinked"}>{STATUS_LABEL[session.status] || session.status}</span>
          {done && (
            <>
              <br />
              Approved: {session.approvedUsdt} USDT · Remaining: {session.remainingUsdt} USDT
              <br />
              Expires: {session.expiryAt ? new Date(String(session.expiryAt).replace(" ", "T") + "Z").toLocaleString() : "—"}
            </>
          )}
          {pending && (
            <>
              <br />
              Cap to approve: {session.approvedUsdt} USDT
            </>
          )}
        </p>
      )}

      <div className='login-row'>
        <input
          type='text'
          inputMode='decimal'
          placeholder='Session cap (USDT)'
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={loading || connecting || pending}
        />
        <button
          className='btn btn-ghost'
          type='button'
          onClick={() => setAmount(maxUsdt)}
          disabled={loading || connecting || pending}
          title="Max = 10 000 USDT or your wallet balance, whichever is higher"
        >
          Max
        </button>
      </div>

      {pending ? (
        <>
          {hasTronLinkExt && (
            <button className='btn btn-primary' onClick={() => onApproveWithExtension()} disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}>
              <i className='fa fa-chrome'></i> Sign approval in wallet (no QR)
            </button>
          )}
          <div className='qr-panel'>
            {qrUri ? (
              <div className='qr-box'>
                <QRCodeSVG value={qrUri} size={208} level='M' includeMargin />
                <p className='qr-hint'>Scan with Trust's in-app scanner (linked account {walletAddress}).</p>
              </div>
            ) : (
              <button className='btn btn-wallet-qr' onClick={onApproveWithQr} disabled={connecting}>
                <i className='fa fa-qrcode'></i> {connecting ? "Waiting for wallet…" : "Approve in wallet (QR)"}
              </button>
            )}
          </div>
          <button className='btn btn-ghost' onClick={onRevoke} disabled={loading || connecting || (Boolean(trackedTxid) && session?.status !== "active")}>
            <i className='fa fa-unlink'></i> Cancel session
          </button>
        </>
      ) : (
        <>
          {done ? (
            <button className='btn btn-ghost' onClick={onRevoke} disabled={loading}>
              <i className='fa fa-unlink'></i> Revoke session
            </button>
          ) : (
            <button className='btn btn-primary' onClick={onSetup} disabled={loading || connecting || !balance}>
              <i className='fa fa-play'></i> Set up payment session
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default TronPaymentsPanel

