import React, { useEffect, useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { connectPairing, approveSession, disconnectSession } from "../lib/walletconnect"
import { toEip55 } from "../lib/eip55"

// One 0x address covers every EVM network, so a single WalletConnect session
// spans Ethereum, BNB Chain, Polygon, Arbitrum, Optimism, Base, ...
export const EVM_CHAINS = [
  "eip155:1", // Ethereum
  "eip155:56", // BNB Smart Chain
  "eip155:137", // Polygon
  "eip155:42161", // Arbitrum One
  "eip155:10", // Optimism
  "eip155:8453", // Base
]

const short = (address, label) =>
  address ? `${label}: ${address.length > 20 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address}` : ""

// ---------------------------------------------------------------------------
// Panel shown inside Trust Wallet's DApp browser. ONE action only: the
// WalletConnect QR ("ONE QR scan") that connects the Tron (USDT · TRC-20)
// wallet in a single session. Already-linked addresses are displayed so the
// user can confirm the wallet after the scan.
// ---------------------------------------------------------------------------
export const TrustWalletHub = ({ mode = "signin", tronAddress, evmAddress, solAddress, qr = null }) => {
  const isLink = mode === "link"

  return (
    <div className='wallet-hub'>
      <p className='trust-banner-title'>
        <i className='fa fa-wallet'></i>{" "}
        {isLink ? "Link your wallets with ONE QR scan" : "Sign in with ONE QR scan"}
      </p>

      {(tronAddress || evmAddress || solAddress) && (
        <p className='login-status'>
          {tronAddress && <span className='linked'>{short(tronAddress, "Tron")}</span>}
          {evmAddress && <span className='linked'>{short(toEip55(evmAddress), "EVM")}</span>}
          {solAddress && <span className='linked'>{short(solAddress, "Solana")}</span>}
        </p>
      )}

      {qr}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WalletConnect v2 QR — THE one-scan connector. ONE scan connects the TRON
// (USDT · TRC-20) wallet in a single session (tron is a REQUIRED namespace —
// wallets without Tron support reject the pairing). Scan it with Trust
// Wallet's in-app QR scanner (it accepts wc: URIs) or with any
// WalletConnect-compatible wallet (TronLink).
export const EVMWalletConnectQR = ({ onApproved, busy, label = "Connect Ethereum (EVM) wallet with QR" }) => {
  const [open, setOpen] = useState(false)
  const [uri, setUri] = useState("")
  const [wcError, setWcError] = useState("")
  // When onApproved returns { hold: true } the caller keeps driving this same
  // WalletConnect session (e.g. to push the tron_signTransaction cap approval
  // straight into the phone with NO second QR scan). While held, this component
  // must NOT disconnect the session on unmount — the caller owns the cleanup.
  const heldRef = useRef(false)
  // Addresses the wallet returned for this session — shown immediately after
  // the scan so the Tron (T...) and EVM (0x...) accounts are visible even
  // while the sign-in/link requests are still in flight.
  const [sessionAddresses, setSessionAddresses] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let client = null
    let session = null
    setWcError("")
    setUri("")
    setSessionAddresses(null)

    connectPairing()
      .then(async ({ client: c, uri: u, approval }) => {
        if (cancelled) {
          await disconnectSession(c, null)
          return
        }
        client = c
        setUri(u)
        const approved = await approveSession(approval)
        if (cancelled) {
          await disconnectSession(c, approved.session)
          return
        }
        session = approved.session
        setUri("")
        setSessionAddresses({ tron: approved.tronAddress, evm: null, sol: null })
        const result = await onApproved(c, session, approved.address, approved.tronAddress, approved.solAddress)
        if (result && result.hold) heldRef.current = true
      })
      .catch((err) => {
        if (!cancelled) setWcError(err.message || "WalletConnect pairing failed.")
      })

    return () => {
      cancelled = true
      // Held sessions are released by the caller (cap approval finished or
      // cancelled) — this component only disconnects sessions it owns.
      if (client && !heldRef.current) disconnectSession(client, session)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) {
    return (
      <div className='qr-panel'>
        <button className='btn btn-wallet-qr btn-wallet-evm' onClick={() => setOpen(true)} disabled={busy}>
          <i className='fa fa-qrcode'></i> {label}
        </button>
      </div>
    )
  }

  return (
    <div className='qr-panel'>
      <div className='qr-box'>
        {uri ? (
          <QRCodeSVG value={uri} size={208} level='M' includeMargin />
        ) : (
          <p className='qr-hint'>Waiting for the wallet to approve the connection…</p>
        )}
        {sessionAddresses && (
          <p className='login-status'>
            <span className={sessionAddresses.tron ? "linked" : "unlinked"}>
              {sessionAddresses.tron
                ? short(sessionAddresses.tron, "Tron")
                : "Tron: not shared by the wallet (update Trust Wallet)"}
            </span>
          </p>
        )}
      </div>
      {wcError && <p className='qr-hint qr-hint-warn'>{wcError}</p>}
      <div className='qr-actions'>
        <button className='btn btn-ghost' onClick={() => setOpen(false)} disabled={busy}>
          <i className='fa fa-times'></i> Close
        </button>
        <button className='btn btn-ghost' onClick={() => setOpen(false) || setOpen(true)} disabled={busy}>
          <i className='fa fa-refresh'></i> New QR
        </button>
      </div>
    </div>
  )
}