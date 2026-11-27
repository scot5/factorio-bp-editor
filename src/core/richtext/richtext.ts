/**
 * Factorio rich text (labels, descriptions, train stop names).
 * See docs/spec/04-visualization.md § Rich text.
 *
 * Produces plain data for the UI to render with normal text nodes. Never
 * produces HTML, so blueprint text cannot inject markup.
 */

export type RichTextNode =
  | { type: 'text'; text: string; color?: string; bold?: boolean }
  | { type: 'icon'; kind: IconKind; name: string; quality?: string; color?: string }

/** Tags that show a prototype icon. */
export const ICON_KINDS = [
  'item',
  'entity',
  'recipe',
  'fluid',
  'virtual-signal',
  'technology',
  'tile',
  'planet',
  'space-location',
  'quality',
  'item-group',
  'achievement',
  'equipment'
] as const

export type IconKind = (typeof ICON_KINDS)[number] | 'img'

const NAMED_COLORS: Record<string, string> = {
  default: '#ffffff',
  white: '#ffffff',
  black: '#000000',
  red: '#ff2a2a',
  green: '#2aff2a',
  blue: '#2a6aff',
  orange: '#ff9f1c',
  yellow: '#ffe62a',
  pink: '#ff6fd8',
  purple: '#b02aff',
  gray: '#808080',
  grey: '#808080',
  brown: '#8b5a2b',
  cyan: '#2affff',
  acid: '#a6ff2a'
}

/** Factorio colour: a name, `#rrggbb[aa]`, or `r,g,b[,a]` in 0–1 or 0–255. Returns CSS or `null`. */
export function parseRichTextColor(value: string): string | null {
  const v = value.trim().toLowerCase()
  if (NAMED_COLORS[v]) return NAMED_COLORS[v]
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v.slice(0, 7)
  const parts = v.split(',').map((p) => Number(p.trim()))
  if (
    (parts.length === 3 || parts.length === 4) &&
    parts.every((n) => Number.isFinite(n) && n >= 0)
  ) {
    const [r, g, b] = parts as [number, number, number]
    const scale = r > 1 || g > 1 || b > 1 ? 1 : 255
    const hex = (n: number): string =>
      Math.round(Math.min(255, n * scale))
        .toString(16)
        .padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  return null
}

const TAG = /\[(\/?)([a-z-]+)(?:=([^\]]*))?\]/g

export function parseRichText(input: string): RichTextNode[] {
  const nodes: RichTextNode[] = []
  const colors: string[] = []
  const fonts: boolean[] = [] // true = bold

  const style = (): { color?: string; bold?: boolean } => ({
    ...(colors.length ? { color: colors[colors.length - 1]! } : {}),
    ...(fonts.includes(true) ? { bold: true } : {})
  })

  const pushText = (text: string): void => {
    if (!text) return
    const s = style()
    const last = nodes[nodes.length - 1]
    if (last && last.type === 'text' && last.color === s.color && last.bold === s.bold) {
      last.text += text
    } else {
      nodes.push({ type: 'text', text, ...s })
    }
  }

  let cursor = 0
  for (const match of input.matchAll(TAG)) {
    const [raw, closing, tag, value] = match as unknown as [
      string,
      string,
      string,
      string | undefined
    ]
    const start = match.index
    pushText(input.slice(cursor, start))
    cursor = start + raw.length

    if (closing) {
      if (tag === 'color' && colors.length) colors.pop()
      else if (tag === 'font' && fonts.length) fonts.pop()
      else pushText(raw)
      continue
    }

    if (tag === 'color' && value !== undefined) {
      const color = parseRichTextColor(value)
      if (color) {
        colors.push(color)
        continue
      }
    } else if (tag === 'font' && value !== undefined) {
      // Only boldness is representable outside the game's fonts.
      fonts.push(/bold/.test(value))
      continue
    } else if (
      value !== undefined &&
      ((ICON_KINDS as readonly string[]).includes(tag) || tag === 'img')
    ) {
      const icon = parseIcon(tag as IconKind, value)
      if (icon) {
        const s = style()
        nodes.push({ ...icon, ...(s.color ? { color: s.color } : {}) })
        continue
      }
    }
    pushText(raw) // unknown tag: show as text
  }
  pushText(input.slice(cursor))
  return nodes
}

function parseIcon(kind: IconKind, value: string): RichTextNode | null {
  // `[item=iron-plate]`, `[item=iron-plate,quality=rare]`, `[img=item/iron-plate]`
  const [first, ...rest] = value.split(',')
  if (!first) return null
  let name = first.trim()
  let actualKind = kind
  if (kind === 'img') {
    const slash = name.indexOf('/')
    if (slash > 0) {
      const prefix = name.slice(0, slash)
      if ((ICON_KINDS as readonly string[]).includes(prefix)) actualKind = prefix as IconKind
      name = name.slice(slash + 1)
    }
  }
  if (!name) return null
  const quality = rest
    .map((part) => part.split('='))
    .find(([k]) => k?.trim() === 'quality')?.[1]
    ?.trim()
  return { type: 'icon', kind: actualKind, name, ...(quality ? { quality } : {}) }
}

/** Plain text with tags removed and icons replaced by their names (for search and tooltips). */
export function richTextToPlain(input: string): string {
  return parseRichText(input)
    .map((n) => (n.type === 'text' ? n.text : n.name))
    .join('')
}
