import { keccak_256 } from "js-sha3"

// EIP-55 checksummed EVM address (the form Trust Wallet / MetaMask display).
// Trust's WalletConnect sessions hand out all-lowercase accounts, so the UI
// must re-derive the checksum locally to match what the wallet shows.
// Returns the input unchanged (lowercased) when it isn't a 20-byte hex address.
export const toEip55 = (address) => {
  const value = String(address || "").trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase()
  const lower = value.toLowerCase().slice(2)
  const hash = keccak_256(lower)
  let out = "0x"
  for (let i = 0; i < 40; i += 1) {
    const nibble = parseInt(hash[i], 16)
    out += nibble >= 8 ? lower[i].toUpperCase() : lower[i]
  }
  return out
}