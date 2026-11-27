import { Unzlib, strFromU8, strToU8, zlibSync } from 'fflate'
import { decodeBase64, encodeBase64 } from './base64'
import { isRootKind, type BlueprintEnvelope } from './envelope'
import { DecodeError } from './errors'
import { isJsonObject, type JsonValue } from './json'

/**
 * Blueprint string codec: `0` + base64(zlib(JSON)).
 * See docs/spec/02-blueprint-format.md § Encoding.
 */

/** The only string format version Factorio has used so far. */
export const STRING_VERSION_BYTE = '0'

/** Default limit on the inflated JSON size (guards against zip bombs). */
export const DEFAULT_MAX_INFLATED_BYTES = 64 * 1024 * 1024

/** Input is fed to the inflater in chunks this size, so the size cap is checked as it grows. */
const INFLATE_CHUNK = 16 * 1024

export interface DecodeOptions {
  maxInflatedBytes?: number
}

export interface EncodeOptions {
  /** zlib compression level, 0 to 9. The game uses 9. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
}

export function decode(text: string, options: DecodeOptions = {}): BlueprintEnvelope {
  const json = decodeToJson(text, options)
  return parseEnvelope(json)
}

/** Decodes a blueprint string to its raw JSON text without parsing it. */
export function decodeToJson(text: string, options: DecodeOptions = {}): string {
  // Users paste from forums, chat and files: ignore all whitespace.
  const compact = text.replace(/\s+/g, '')
  if (compact.length === 0) throw new DecodeError('empty')
  if (compact[0] !== STRING_VERSION_BYTE) {
    throw new DecodeError('bad-version-byte', `starts with ${JSON.stringify(compact[0])}`)
  }

  const compressed = decodeBase64(compact.slice(1))
  if (compressed === null || compressed.length === 0) throw new DecodeError('bad-base64')

  const inflated = inflateCapped(compressed, options.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES)
  return strFromU8(inflated)
}

export function encode(envelope: BlueprintEnvelope, options: EncodeOptions = {}): string {
  return encodeJson(JSON.stringify(envelope), options)
}

/** Encodes raw JSON text as a blueprint string. The JSON is not validated. */
export function encodeJson(json: string, options: EncodeOptions = {}): string {
  const compressed = zlibSync(strToU8(json), { level: options.level ?? 9 })
  return STRING_VERSION_BYTE + encodeBase64(compressed)
}

/** Parses decoded JSON text and checks that it is a valid envelope. */
export function parseEnvelope(json: string): BlueprintEnvelope {
  let value: JsonValue
  try {
    value = JSON.parse(json) as JsonValue
  } catch (error) {
    throw new DecodeError('bad-json', error instanceof Error ? error.message : undefined)
  }
  if (!isJsonObject(value)) throw new DecodeError('bad-json', 'root is not an object')

  const keys = Object.keys(value)
  const key = keys[0]
  if (keys.length !== 1 || key === undefined || !isRootKind(key)) {
    throw new DecodeError('unknown-root', `root keys: ${keys.join(', ') || '(none)'}`)
  }
  const payload = value[key]
  if (!isJsonObject(payload)) throw new DecodeError('bad-json', `${key} is not an object`)

  // Version must be exact as a JS number (true for any game major < 32).
  const version = payload['version']
  if (version !== undefined && (typeof version !== 'number' || !Number.isSafeInteger(version))) {
    throw new DecodeError('unsafe-version', String(version))
  }

  return value as BlueprintEnvelope
}

function inflateCapped(compressed: Uint8Array, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  let finished = false

  const inflater = new Unzlib((data, final) => {
    total += data.length
    if (total > maxBytes) throw new DecodeError('too-large', `over ${maxBytes} bytes`)
    chunks.push(data)
    if (final) finished = true
  })

  try {
    for (let i = 0; i < compressed.length; i += INFLATE_CHUNK) {
      const end = Math.min(i + INFLATE_CHUNK, compressed.length)
      inflater.push(compressed.subarray(i, end), end === compressed.length)
    }
  } catch (error) {
    if (error instanceof DecodeError) throw error
    throw new DecodeError('bad-zlib', error instanceof Error ? error.message : undefined)
  }
  if (!finished) throw new DecodeError('bad-zlib', 'unexpected end of data')

  if (chunks.length === 1) return chunks[0]!
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
