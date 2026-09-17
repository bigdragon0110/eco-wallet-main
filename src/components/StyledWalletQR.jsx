import React, { useLayoutEffect, useRef } from "react"
import { QRCodeSVG } from "qrcode.react"
import "./StyledWalletQR.css"

const logo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="white"/><rect x="6" y="6" width="36" height="36" rx="9" fill="#ef172c"/><path d="M14 13L36 18L23 37Z M14 13L25 23L36 18 M25 23L23 37" fill="none" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>')}`

// Style the encoder's modules without changing their positions or QR payload.
// If its SVG format changes, retain the original scannable square QR.
export function roundedModules(path, extent) {
  const runs = [...path.matchAll(/M(\d+)[ ,]+(\d+)\s*h(\d+)v1H\d+z/g)]
  if (!runs.length || runs.map(run => run[0]).join("") !== path.replace(/\s+(?=M)/g, "")) return null
  const corners = [[4, 4], [extent - 11, 4], [4, extent - 11]]
  let dots = ""
  for (const [, rawX, rawY, length] of runs) {
    const y = Number(rawY)
    for (let x = Number(rawX); x < Number(rawX) + Number(length); x++) {
      if (corners.some(([cx, cy]) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7)) continue
      dots += `M${x + 0.5},${y}a.5,.5 0 1,0 0,1a.5,.5 0 1,0 0,-1z`
    }
  }
  return { dots, corners }
}

export default function StyledWalletQR({ value }) {
  const container = useRef(null)
  useLayoutEffect(() => {
    const svg = container.current?.querySelector("svg")
    const foreground = svg?.querySelectorAll("path")[1]
    if (!foreground) return
    const original = foreground.getAttribute("d")
    const parsed = roundedModules(original, svg.viewBox.baseVal.width)
    if (!parsed) return
    foreground.setAttribute("d", parsed.dots)
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
    for (const [x, y] of parsed.corners) {
      for (const [offset, size, radius, fill] of [[0, 7, 2, "#111"], [1, 5, 1.4, "white"], [2, 3, 1, "#111"]]) {
        const rect = document.createElementNS(group.namespaceURI, "rect")
        Object.entries({ x: x + offset, y: y + offset, width: size, height: size, rx: radius, fill }).forEach(([key, val]) => rect.setAttribute(key, val))
        group.appendChild(rect)
      }
    }
    svg.appendChild(group)
    return () => { foreground.setAttribute("d", original); group.remove() }
  }, [value])
  return (
    <div className='styled-wallet-qr'>
      <div className='styled-wallet-qr-badge'><img src={logo} alt='' /> Tron</div>
      <div className='styled-wallet-qr-card' ref={container}>
        <QRCodeSVG value={value} size={320} level='H' marginSize={4} fgColor='#111'
          title='Scan with Trust Wallet to connect your TRON wallet'
          imageSettings={{ src: logo, width: 32, height: 32, excavate: true }} />
        <p>Scan with Trust Wallet to connect</p>
      </div>
    </div>
  )
}
