import { describe, expect, it } from 'vitest'
import { parseRichText, parseRichTextColor, richTextToPlain } from './richtext'

describe('parseRichText', () => {
  it('returns plain text unchanged', () => {
    expect(parseRichText('Outpost Station V 1.9')).toEqual([
      { type: 'text', text: 'Outpost Station V 1.9' }
    ])
    expect(parseRichText('')).toEqual([])
  })

  it('parses icons, including quality and img/ prefixes', () => {
    expect(parseRichText('[item=requester-chest]Requester')).toEqual([
      { type: 'icon', kind: 'item', name: 'requester-chest' },
      { type: 'text', text: 'Requester' }
    ])
    expect(
      parseRichText('[item=assembling-machine-1] [virtual-signal=signal-any-quality]')
    ).toEqual([
      { type: 'icon', kind: 'item', name: 'assembling-machine-1' },
      { type: 'text', text: ' ' },
      { type: 'icon', kind: 'virtual-signal', name: 'signal-any-quality' }
    ])
    expect(parseRichText('[item=iron-plate,quality=legendary]')).toEqual([
      { type: 'icon', kind: 'item', name: 'iron-plate', quality: 'legendary' }
    ])
    expect(parseRichText('[img=fluid/water]')).toEqual([
      { type: 'icon', kind: 'fluid', name: 'water' }
    ])
  })

  it('applies nested colours and bold fonts', () => {
    expect(parseRichText('a[color=red]b[color=0,1,0]c[/color]d[/color]e')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b', color: '#ff2a2a' },
      { type: 'text', text: 'c', color: '#00ff00' },
      { type: 'text', text: 'd', color: '#ff2a2a' },
      { type: 'text', text: 'e' }
    ])
    expect(parseRichText('[font=default-bold]Bold[/font] x')).toEqual([
      { type: 'text', text: 'Bold', bold: true },
      { type: 'text', text: ' x' }
    ])
  })

  it('handles the nuclear corpus label (colour, emoji)', () => {
    const nodes = parseRichText('[color=124,252,0]☢️ Large - 2.4 GW Nuclear ☢️☢️☢☢[/color]')
    expect(nodes).toEqual([
      { type: 'text', text: '☢️ Large - 2.4 GW Nuclear ☢️☢️☢☢', color: '#7cfc00' }
    ])
  })

  it('colours icons inside a colour span', () => {
    expect(parseRichText('[color=blue][item=coal][/color]')).toEqual([
      { type: 'icon', kind: 'item', name: 'coal', color: '#2a6aff' }
    ])
  })

  it('keeps unknown, malformed and unbalanced tags as text', () => {
    expect(parseRichText('[gps=10,20] [color=nope]x[/color] [/font] [item=]')).toEqual([
      { type: 'text', text: '[gps=10,20] [color=nope]x[/color] [/font] [item=]' }
    ])
  })

  it('never produces markup: HTML stays literal text', () => {
    const evil = '<img src=x onerror=alert(1)>[color=red]<script>[/color]'
    const text = parseRichText(evil)
      .map((n) => (n.type === 'text' ? n.text : ''))
      .join('')
    expect(text).toBe('<img src=x onerror=alert(1)><script>')
  })
})

describe('parseRichTextColor', () => {
  it.each([
    ['red', '#ff2a2a'],
    ['#FF8800', '#ff8800'],
    ['#ff880080', '#ff8800'],
    ['1,0.5,0', '#ff8000'],
    ['255,128,0', '#ff8000'],
    ['255,128,0,0.5', '#ff8000'],
    ['nope', null],
    ['1,2', null]
  ])('%s → %s', (input, expected) => {
    expect(parseRichTextColor(input)).toBe(expected)
  })
})

describe('richTextToPlain', () => {
  it('strips tags and names icons', () => {
    expect(richTextToPlain('[item=requester-chest]Requester [color=red]!![/color]')).toBe(
      'requester-chestRequester !!'
    )
  })
})

describe('fonts', () => {
  it('keeps outer bold through a nested non-bold font', () => {
    expect(parseRichText('[font=default-bold]a[font=default-small]b[/font]c[/font]d')).toEqual([
      { type: 'text', text: 'abc', bold: true },
      { type: 'text', text: 'd' }
    ])
  })
})
