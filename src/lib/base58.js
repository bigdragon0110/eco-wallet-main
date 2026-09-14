/* global BigInt */
// Minimal base58 (Bitcoin alphabet) encode/decode for Solana integration.
// Solana addresses, WalletConnect solana_signMessage messages and signatures
// are all base58 strings. Dependency-free (no Buffer — plain Uint8Array math)
// so the CRA bundle stays lean and works in any browser.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const INDEX = new Map([...ALPHABET].map((ch, i) => [ch, BigInt(i)]))

export const base58Encode = (bytes) => {
  const arr = Uint8Array.from(bytes)
  let leading = 0
  while (leading < arr.length && arr[leading] === 0) leading += 1
  let num = 0n
  for (let i = 0; i < arr.length; i += 1) num = num * 256n + BigInt(arr[i])
  let out = ""
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out
    num /= 58n
  }
  return "1".repeat(leading) + out
}

export const base58Decode = (value) => {
  const str = String(value || "").trim()
  if (!str) return new Uint8Array(0)
  let num = 0n
  for (const ch of str) {
    const digit = INDEX.get(ch)
    if (digit === undefined) throw new Error(`Invalid base58 character: ${ch}`)
    num = num * 58n + digit
  }
  const bytes = []
  while (num > 0n) {
    bytes.unshift(Number(num % 256n))
    num /= 256n
  }
  let leading = 0
  while (leading < str.length && str[leading] === "1") {
    bytes.unshift(0)
    leading += 1
  }
  return Uint8Array.from(bytes)
}