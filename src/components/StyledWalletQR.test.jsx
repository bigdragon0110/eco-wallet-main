import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QRCodeSVG } from "qrcode.react"
import { roundedModules } from "./StyledWalletQR"

test("styles all encoder modules for a WalletConnect-sized payload", () => {
  const html = renderToStaticMarkup(<QRCodeSVG value={`wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`} level='H' marginSize={4} />)
  const paths = [...html.matchAll(/ d="([^"]+)"/g)]
  const extent = Number(html.match(/viewBox="0 0 (\d+)/)[1])
  const styled = roundedModules(paths[1][1], extent)
  expect(styled).not.toBeNull()
  expect(styled.corners).toEqual([[4, 4], [extent - 11, 4], [4, extent - 11]])
  expect(styled.dots).toContain("a.5,.5")
})

test("retains the original QR for unrecognized encoder output", () => {
  expect(roundedModules("M0 0L1 1", 29)).toBeNull()
})
