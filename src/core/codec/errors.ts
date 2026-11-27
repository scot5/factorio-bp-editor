/** Why a blueprint string could not be decoded. See docs/spec/02-blueprint-format.md § Errors. */
export type DecodeErrorReason =
  | 'empty'
  | 'bad-version-byte'
  | 'bad-base64'
  | 'bad-zlib'
  | 'too-large'
  | 'bad-json'
  | 'unknown-root'
  | 'unsafe-version'

const MESSAGES: Record<DecodeErrorReason, string> = {
  empty: 'The text is empty. Paste a blueprint string.',
  'bad-version-byte': 'This is not a Factorio blueprint string (it should start with "0").',
  'bad-base64': 'The string is damaged: it contains characters that are not valid base64.',
  'bad-zlib': 'The string is damaged: its compressed data could not be unpacked.',
  'too-large': 'The blueprint is too large to open.',
  'bad-json': 'The string unpacked, but its contents are not valid blueprint data.',
  'unknown-root':
    'The string does not contain a blueprint, book, deconstruction planner or upgrade planner.',
  'unsafe-version': 'The blueprint has a game version number this app cannot read exactly.'
}

export class DecodeError extends Error {
  override readonly name = 'DecodeError'

  constructor(
    readonly reason: DecodeErrorReason,
    readonly detail?: string
  ) {
    super(detail ? `${MESSAGES[reason]} (${detail})` : MESSAGES[reason])
  }

  /** Message suitable for showing to the user. */
  get userMessage(): string {
    return MESSAGES[this.reason]
  }
}
