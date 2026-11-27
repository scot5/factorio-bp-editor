/**
 * Standard base64 (RFC 4648, `+` and `/`, with padding).
 * Implemented here because src/core may not use `Buffer` (Node) or `atob` (DOM).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const DECODE = new Int16Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  let chunk = ''
  const len = bytes.length
  let i = 0
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    chunk +=
      ALPHABET[(n >> 18) & 63]! +
      ALPHABET[(n >> 12) & 63]! +
      ALPHABET[(n >> 6) & 63]! +
      ALPHABET[n & 63]!
    if (chunk.length >= 16384) {
      parts.push(chunk)
      chunk = ''
    }
  }
  const rest = len - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    chunk += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    chunk += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + '='
  }
  parts.push(chunk)
  return parts.join('')
}

/**
 * Decodes base64. Returns `null` for invalid input (bad characters, bad length,
 * padding in the wrong place). Missing trailing padding is tolerated.
 * The caller removes whitespace first.
 */
export function decodeBase64(text: string): Uint8Array | null {
  let end = text.length
  let padding = 0
  while (end > 0 && text.charCodeAt(end - 1) === 61 /* = */ && padding < 2) {
    end--
    padding++
  }
  if (padding > 0 && text.length % 4 !== 0) return null
  if (end % 4 === 1) return null

  const out = new Uint8Array(Math.floor((end * 3) / 4))
  let o = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i)
    const v = c < 128 ? DECODE[c]! : -1
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return o === out.length ? out : out.subarray(0, o)
}
