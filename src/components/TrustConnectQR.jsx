import React, { useState } from "react"
import { QRCodeSVG } from "qrcode.react"

// OPENER QR: opens the site inside Trust Wallet's DApp browser (Tron + EVM
// provider flows run there after the hub appears).
//
// NOTE: this QR does NOT connect a wallet by itself — scanning it only OPENS
// the site in Trust's browser, where the user taps a connect button in the
// wallet hub. The DIRECT one-scan connector is the WalletConnect QR
// (EVMWalletConnectQR), which since WalletConnect's Jan 2026 Tron support
// returns BOTH the Tron (T...) and EVM (0x...) addresses in one session.
//
// Trust DApp-browser deep link ("open_url"):
//
//   https://link.trustwallet.com/open_url?coin_id=195&url=<encoded site URL>
//
//   - Path must be /open_url (the bare /open route is not a documented Trust
//     endpoint and is rejected with "This QR code isn't supported").
//   - coin_id is the SLIP-44 coin index: 195 = TRON (USDT-TRC20 lives on the
//     Tron chain). 200007 is an internal Trust asset id, NOT a chain id, so
//     it must not be used here.
//
// Scanning the QR opens the site inside Trust Wallet's in-app browser, where
// the wallet hub appears and the user taps a Tron/EVM connect button (the
// TronLink-compatible injection links the TRC-20 address).
//
// If the QR scan still fails (Trust's scanner is picky with URL-only codes),
// the fallback is the visible direct URL below — open it on the phone or paste
// it into Trust Wallet's Browser/DApps tab.
//
// This component renders that QR. `publicBase` is the URL the phone must reach
// (REACT_APP_PUBLIC_URL, falling back to the origin the page was served from);
// set REACT_APP_PUBLIC_URL to your LAN address (e.g. http://192.168.2.12:3000)
// so the QR works over Wi-Fi instead of pointing at localhost.
const publicBase = process.env.REACT_APP_PUBLIC_URL || window.location.origin

const dappUrl = () => `${publicBase}/login?trusttron=1`

const deepLinkValue = () =>
  `https://link.trustwallet.com/open_url?coin_id=195&url=${encodeURIComponent(
    dappUrl()
  )}`

// True when rendered inside Trust Wallet's in-app browser.
//
// IMPORTANT: the open_url deep link is the ENTRY point, not a reliable signal —
// Trust normalizes the target URL (it can strip the ?trusttron=1 query) and its
// WebView user agent does not always mention "Trust". The reliable signal is the
// injected provider chain: Trust's DApp browser injects window.tronLink (Tron),
// window.trustwallet.tronLink and window.trustwallet.ethereum (EVM).
const hasInjectedProvider = () =>
  Boolean(
    window.tronLink ||
      (window.trustwallet && (window.trustwallet.tronLink || window.trustwallet.ethereum)) ||
      window.trustwallet
  )

export const inTrustBrowser = () =>
  hasInjectedProvider() ||
  window.location.search.includes("trusttron=1") ||
  (navigator.userAgent || "").toLowerCase().includes("trust")

// Providers are injected ASYNCHRONOUSLY by the DApp browser, often after the
// page has mounted. Poll briefly before concluding "not in Trust". Resolves
// true as soon as any Trust/Tron provider shows up, false after `ms`.
export const detectTrustBrowser = (ms = 2500) =>
  new Promise((resolve) => {
    if (inTrustBrowser()) return resolve(true)
    const started = Date.now()
    const timer = setInterval(() => {
      if (inTrustBrowser()) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - started >= ms) {
        clearInterval(timer)
        resolve(false)
      }
    }, 150)
  })

// The site must be reachable from the phone. Warn when the URL a scan would
// open is a loopback address (the classic "QR points at localhost" failure).
const publicBaseReachable = () => !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(publicBase)

const TrustConnectQR = () => {
  const [open, setOpen] = useState(false)
  const reachable = publicBaseReachable()
  const deepLink = deepLinkValue()
  const directUrl = dappUrl()

  if (!open) {
    return (
      <div className='qr-panel'>
        <button className='btn btn-wallet-qr' onClick={() => setOpen(true)}>
          <i className='fa fa-external-link'></i> Open site in Trust Wallet browser (QR)
        </button>
        {!reachable && (
          <p className='qr-hint qr-hint-warn'>
            QR targets localhost — set REACT_APP_PUBLIC_URL to your LAN address so the phone can
            reach this machine.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className='qr-panel'>
      <div className='qr-box'>
        <QRCodeSVG value={deepLink} size={208} level='M' includeMargin />
        <p className='qr-hint'>
          <strong>This QR only OPENS the site — it does not connect a wallet by itself.</strong>{" "}
          Scan with your phone's <strong>camera app</strong>; the site opens in Trust Wallet's
          browser and the <strong>wallet hub</strong> appears — tap a connect button there
          (Tron USDT · TRC-20, EVM, or ALL networks). To connect DIRECTLY with one scan, use the
          <strong> "Connect Tron (USDT) + EVM wallets with ONE QR scan"</strong> WalletConnect QR
          instead.
        </p>
      </div>
      <p className='qr-hint'>
        If the camera scan does not work, open this link directly on the phone (or paste it into
        Trust Wallet → Browser / DApps tab):
      </p>
      <p className='qr-link'>{directUrl}</p>
      {!reachable && (
        <p className='qr-hint qr-hint-warn'>
          Warning: the QR points at {publicBase}. On the phone that resolves to the phone itself —
          set REACT_APP_PUBLIC_URL to this machine's LAN IP (e.g. http://192.168.2.12:3000).
        </p>
      )}
      <div className='qr-actions'>
        <button className='btn btn-ghost' onClick={() => setOpen(false)}>
          <i className='fa fa-times'></i> Close
        </button>
        <button className='btn btn-ghost' onClick={() => setOpen(true)}>
          <i className='fa fa-refresh'></i> Refresh QR
        </button>
      </div>
    </div>
  )
}

export default TrustConnectQR