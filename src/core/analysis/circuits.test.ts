import { describe, expect, it } from 'vitest'
import { layoutBlueprint, type Blueprint } from '../model'
import type { PrototypeLookup } from '../prototypes'
import { circuits, circuitSignal, conditionText, signalTag, type CircuitReport } from './circuits'

const TYPES: Record<string, string> = {
  'decider-combinator': 'decider-combinator',
  'arithmetic-combinator': 'arithmetic-combinator',
  'selector-combinator': 'selector-combinator',
  'constant-combinator': 'constant-combinator',
  'small-electric-pole': 'electric-pole',
  'iron-chest': 'container',
  'requester-chest': 'logistic-container',
  accumulator: 'accumulator',
  'storage-tank': 'storage-tank',
  inserter: 'inserter',
  'transport-belt': 'transport-belt',
  'small-lamp': 'lamp',
  'train-stop': 'train-stop',
  'rail-signal': 'rail-signal',
  'programmable-speaker': 'programmable-speaker',
  'display-panel': 'display-panel',
  splitter: 'splitter',
  roboport: 'roboport'
}

const lookup: PrototypeLookup = (name) =>
  TYPES[name] ? { type: TYPES[name], width: 1, height: 1 } : undefined

type EntitySpec = { name: string } & Record<string, unknown>

/** Entities numbered from 1 in a row; wires as `[a, connector, b, connector]`. */
function report(
  entities: EntitySpec[],
  wires: [number, number, number, number][] = []
): CircuitReport {
  const blueprint: Blueprint = {
    item: 'blueprint',
    version: 562954250027018,
    entities: entities.map((e, i) => ({
      entity_number: i + 1,
      position: { x: i * 2 + 0.5, y: 0.5 },
      ...e
    })),
    wires
  }
  return circuits(layoutBlueprint(blueprint, lookup), lookup)
}

const linesOf = (r: CircuitReport, name: string): string[] =>
  r.entities.filter((e) => e.name === name).flatMap((e) => e.lines)

const A = { type: 'virtual', name: 'signal-A' }
const B = { type: 'virtual', name: 'signal-B' }
const IRON = { name: 'iron-plate' }

describe('signals and conditions', () => {
  it('reads a SignalID with the item default', () => {
    expect(circuitSignal({ name: 'iron-plate' })).toEqual({ type: 'item', name: 'iron-plate' })
    expect(circuitSignal({ type: 'fluid', name: 'water', quality: 'rare' })).toEqual({
      type: 'fluid',
      name: 'water',
      quality: 'rare'
    })
    expect(circuitSignal({ type: 'virtual' })).toBeUndefined()
    expect(circuitSignal(null)).toBeUndefined()
  })

  it('writes rich text tags, with quality other than normal', () => {
    expect(signalTag({ type: 'virtual', name: 'signal-A' })).toBe('[virtual-signal=signal-A]')
    expect(signalTag({ type: 'item', name: 'iron-plate', quality: 'rare' })).toBe(
      '[item=iron-plate,quality=rare]'
    )
    expect(signalTag({ type: 'item', name: 'iron-plate', quality: 'normal' })).toBe(
      '[item=iron-plate]'
    )
    expect(signalTag(undefined)).toBe('(none)')
  })

  it('never lets a name break out of its tag', () => {
    expect(signalTag({ type: 'item', name: 'x][color=red' })).toBe('x][color=red')
    expect(signalTag({ type: 'asteroid-chunk', name: 'metallic-asteroid-chunk' })).toBe(
      'metallic-asteroid-chunk'
    )
  })

  it('uses the defaults: comparator < and constant 0', () => {
    expect(conditionText({ first_signal: A })).toBe('[virtual-signal=signal-A] < 0')
    expect(conditionText({ first_signal: A, comparator: '>=', constant: 5 })).toBe(
      '[virtual-signal=signal-A] ≥ 5'
    )
    expect(conditionText({ first_signal: A, second_signal: B, comparator: '!=' })).toBe(
      '[virtual-signal=signal-A] ≠ [virtual-signal=signal-B]'
    )
    expect(conditionText({})).toBe('(none) < 0')
  })

  it('names the wire colour when a signal is read from one network only', () => {
    expect(
      conditionText({
        first_signal: A,
        first_signal_networks: { red: false, green: true },
        second_signal: B,
        second_signal_networks: { red: true, green: false },
        comparator: '='
      })
    ).toBe('[virtual-signal=signal-A] (green) = [virtual-signal=signal-B] (red)')
  })
})

describe('combinator settings', () => {
  it('groups decider conditions: and binds tighter than or', () => {
    const r = report([
      {
        name: 'decider-combinator',
        control_behavior: {
          decider_conditions: {
            conditions: [
              { first_signal: A, comparator: '>', constant: 1 },
              { first_signal: B, comparator: '=', constant: 2, compare_type: 'and' },
              { first_signal: IRON, constant: 3, compare_type: 'or' },
              { first_signal: A, compare_type: 'and' }
            ],
            outputs: [{ signal: A }, { signal: B, copy_count_from_input: false }],
            else_outputs: [{ signal: IRON, copy_count_from_input: false, constant: 7 }]
          }
        }
      }
    ])
    expect(linesOf(r, 'decider-combinator')).toEqual([
      'if [virtual-signal=signal-A] > 1 and [virtual-signal=signal-B] = 2 or [item=iron-plate] < 3 and [virtual-signal=signal-A] < 0 then [virtual-signal=signal-A] (input count), [virtual-signal=signal-B] = 1',
      'else [item=iron-plate] = 7'
    ])
  })

  it('names the input network an output copies from', () => {
    const r = report([
      {
        name: 'decider-combinator',
        control_behavior: {
          decider_conditions: {
            conditions: [],
            outputs: [{ signal: A, networks: { red: true, green: false } }],
            else_outputs: []
          }
        }
      }
    ])
    expect(linesOf(r, 'decider-combinator')).toEqual([
      'if always then [virtual-signal=signal-A] (input count from red)'
    ])
  })

  it('writes arithmetic with the default operation × and constants', () => {
    const r = report([
      {
        name: 'arithmetic-combinator',
        control_behavior: { arithmetic_conditions: { first_signal: A, output_signal: B } }
      },
      {
        name: 'arithmetic-combinator',
        control_behavior: {
          arithmetic_conditions: {
            first_constant: 79,
            second_signal: IRON,
            second_signal_networks: { red: true, green: false },
            operation: '-',
            output_signal: IRON
          }
        }
      }
    ])
    expect(linesOf(r, 'arithmetic-combinator').sort()).toEqual([
      '79 - [item=iron-plate] (red) → [item=iron-plate]',
      '[virtual-signal=signal-A] × 0 → [virtual-signal=signal-B]'
    ])
  })

  it('describes selector operations', () => {
    const ops = [
      [{}, 'select the largest input at index 0'],
      [
        { select_max: false, index_signal: A },
        'select the smallest input at index [virtual-signal=signal-A]'
      ],
      [{ operation: 'count', count_signal: B }, 'count input signals → [virtual-signal=signal-B]'],
      [{ operation: 'random', random_update_interval: 60 }, 'random input every 60 ticks'],
      [{ operation: 'stack-size' }, 'stack sizes of input items'],
      [
        { operation: 'quality-filter', quality_filter: { quality: 'rare', comparator: '>=' } },
        'pass inputs with quality ≥ rare'
      ],
      [
        {
          operation: 'quality-transfer',
          quality_source_static: { name: 'epic' },
          quality_destination_signal: A
        },
        'quality from epic → [virtual-signal=signal-A]'
      ]
    ] as const
    for (const [cb, text] of ops)
      expect(
        linesOf(
          report([{ name: 'selector-combinator', control_behavior: cb }]),
          'selector-combinator'
        )
      ).toEqual([text])
  })

  it('lists constant combinator signals of active sections', () => {
    const sections = {
      sections: [
        {
          index: 1,
          filters: [
            { index: 1, ...A, count: 20 },
            { index: 2, ...IRON, count: -5 }
          ]
        },
        { index: 2, active: false, filters: [{ index: 1, ...B, count: 1 }] }
      ]
    }
    expect(
      linesOf(
        report([{ name: 'constant-combinator', control_behavior: { sections } }]),
        'constant-combinator'
      )
    ).toEqual(['[virtual-signal=signal-A] = 20, [item=iron-plate] = -5'])
    expect(
      linesOf(
        report([{ name: 'constant-combinator', control_behavior: { sections, is_on: false } }]),
        'constant-combinator'
      )
    ).toEqual(['switched off'])
    expect(linesOf(report([{ name: 'constant-combinator' }]), 'constant-combinator')).toEqual([
      'no signals'
    ])
  })

  it('groups identical settings and lists combinators first', () => {
    const decider = {
      name: 'decider-combinator',
      control_behavior: {
        decider_conditions: {
          conditions: [{ first_signal: A }],
          outputs: [{ signal: A }],
          else_outputs: []
        }
      }
    }
    const r = report(
      [{ name: 'accumulator' }, decider, decider, { name: 'small-electric-pole' }],
      [[1, 1, 4, 1]]
    )
    expect(r.entities.map((e) => [e.name, e.count, e.indexes])).toEqual([
      ['decider-combinator', 2, [1, 2]],
      ['accumulator', 1, [0]]
    ])
  })
})

describe('entity settings', () => {
  const wired = (e: EntitySpec): CircuitReport =>
    report([e, { name: 'small-electric-pole' }], [[1, 1, 2, 1]])

  it('shows conditions only when enabled', () => {
    const condition = { first_signal: A, constant: 3, comparator: '=' }
    expect(
      linesOf(
        wired({ name: 'inserter', control_behavior: { circuit_condition: condition } }),
        'inserter'
      )
    ).toEqual([])
    expect(
      linesOf(
        wired({
          name: 'inserter',
          control_behavior: {
            circuit_enabled: true,
            circuit_condition: condition,
            circuit_read_hand_contents: true
          }
        }),
        'inserter'
      )
    ).toEqual(['enabled when [virtual-signal=signal-A] = 3', 'outputs hand contents'])
    expect(
      linesOf(
        wired({ name: 'transport-belt', control_behavior: { circuit_read_hand_contents: true } }),
        'transport-belt'
      )
    ).toEqual(['outputs belt contents'])
  })

  it('reads container contents and accumulator charge by default', () => {
    expect(linesOf(wired({ name: 'iron-chest' }), 'iron-chest')).toEqual(['outputs contents'])
    expect(
      linesOf(
        wired({ name: 'iron-chest', control_behavior: { read_contents: false } }),
        'iron-chest'
      )
    ).toEqual([])
    expect(
      linesOf(wired({ name: 'accumulator', control_behavior: { output_signal: A } }), 'accumulator')
    ).toEqual(['outputs charge as [virtual-signal=signal-A]'])
    expect(linesOf(wired({ name: 'storage-tank' }), 'storage-tank')).toEqual(['outputs contents'])
  })

  it('describes train stops, rail signals, speakers, splitters and display panels', () => {
    expect(
      linesOf(
        wired({
          name: 'train-stop',
          control_behavior: {
            read_from_train: true,
            read_stopped_train: true,
            train_stopped_signal: { type: 'virtual', name: 'signal-T' },
            set_trains_limit: true,
            trains_limit_signal: B
          }
        }),
        'train-stop'
      )
    ).toEqual([
      'sets the train limit from [virtual-signal=signal-B]',
      'outputs train contents',
      'outputs stopped train as [virtual-signal=signal-T]'
    ])
    expect(
      linesOf(
        wired({
          name: 'rail-signal',
          control_behavior: {
            circuit_close_signal: true,
            circuit_condition: { first_signal: A, comparator: '>' },
            circuit_read_signal: true,
            red_output_signal: { type: 'virtual', name: 'signal-red' },
            orange_output_signal: null
          }
        }),
        'rail-signal'
      )
    ).toEqual([
      'closes when [virtual-signal=signal-A] > 0',
      'outputs signal state as [virtual-signal=signal-red]'
    ])
    expect(
      linesOf(
        wired({
          name: 'programmable-speaker',
          control_behavior: { circuit_condition: { first_signal: A } }
        }),
        'programmable-speaker'
      )
    ).toEqual(['plays when [virtual-signal=signal-A] < 0'])
    expect(
      linesOf(
        wired({
          name: 'splitter',
          control_behavior: {
            set_output_side: true,
            output_left_condition: { first_signal: A, comparator: '>' },
            output_right_condition: { first_signal: B, comparator: '>' }
          }
        }),
        'splitter'
      )
    ).toEqual([
      'output priority left when [virtual-signal=signal-A] > 0, right when [virtual-signal=signal-B] > 0'
    ])
    expect(
      linesOf(
        wired({
          name: 'display-panel',
          control_behavior: {
            parameters: [
              { condition: { first_signal: A, constant: 2, comparator: '>' }, icon: B, text: 'Low' }
            ]
          }
        }),
        'display-panel'
      )
    ).toEqual(['shows [virtual-signal=signal-B] Low when [virtual-signal=signal-A] > 2'])
  })

  it('describes unwired entities only by their logistic condition', () => {
    const r = report([
      {
        name: 'inserter',
        control_behavior: {
          connect_to_logistic_network: true,
          logistic_condition: { first_signal: IRON, constant: 200 },
          circuit_read_hand_contents: true
        }
      },
      { name: 'iron-chest' }
    ])
    expect(r.entities).toEqual([
      {
        name: 'inserter',
        lines: ['enabled when the logistic network has [item=iron-plate] < 200'],
        count: 1,
        indexes: [0]
      }
    ])
    expect(r.networks).toEqual([])
  })

  it('works for unknown prototypes (no type)', () => {
    const r = wired({
      name: 'modded-thing',
      control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: A } }
    })
    expect(linesOf(r, 'modded-thing')).toEqual(['enabled when [virtual-signal=signal-A] < 0'])
  })
})

describe('networks', () => {
  const constant = (filters: object[], extra: object = {}): EntitySpec => ({
    name: 'constant-combinator',
    control_behavior: {
      sections: {
        sections: [{ index: 1, filters: filters.map((f, i) => ({ index: i + 1, ...f })) }]
      },
      ...extra
    }
  })

  it('keeps red and green apart and lists their members, readers and wires', () => {
    const r = report(
      [
        constant([{ ...A, count: 5 }]),
        {
          name: 'small-lamp',
          control_behavior: { circuit_enabled: true, circuit_condition: { first_signal: A } }
        },
        { name: 'small-electric-pole' }
      ],
      [
        [1, 1, 3, 1],
        [3, 1, 2, 1],
        [1, 2, 2, 2],
        [3, 5, 2, 5]
      ]
    )
    expect(r.networks).toEqual([
      {
        color: 'red',
        id: 1,
        members: [0, 1, 2],
        readers: [1],
        wires: [0, 1],
        signals: [{ signal: { type: 'virtual', name: 'signal-A' }, count: 5, sources: [0] }]
      },
      {
        color: 'green',
        id: 1,
        members: [0, 1],
        readers: [1],
        wires: [2],
        signals: [{ signal: { type: 'virtual', name: 'signal-A' }, count: 5, sources: [0] }]
      }
    ])
  })

  it('sums constants, and drops the count once another entity sends the signal', () => {
    const decider: EntitySpec = {
      name: 'decider-combinator',
      control_behavior: {
        decider_conditions: { conditions: [], outputs: [{ signal: B }], else_outputs: [] }
      }
    }
    const r = report(
      [
        constant([{ ...A, count: 5 }]),
        constant([
          { ...A, count: 2 },
          { ...B, count: 1 }
        ]),
        decider
      ],
      [
        [1, 1, 2, 1],
        [2, 1, 3, 3]
      ]
    )
    expect(r.networks[0]!.signals).toEqual([
      { signal: { type: 'virtual', name: 'signal-A' }, count: 7, sources: [0, 1] },
      { signal: { type: 'virtual', name: 'signal-B' }, sources: [1, 2] }
    ])
  })

  it('treats normal quality as no quality when merging', () => {
    const r = report(
      [constant([{ ...A, quality: 'normal', count: 5 }]), constant([{ ...A, count: 2 }])],
      [[1, 1, 2, 1]]
    )
    expect(r.networks[0]!.signals).toEqual([
      {
        signal: { type: 'virtual', name: 'signal-A', quality: 'normal' },
        count: 7,
        sources: [0, 1]
      }
    ])
  })

  it('separates a combinator input network from its output network', () => {
    const arithmetic: EntitySpec = {
      name: 'arithmetic-combinator',
      control_behavior: {
        arithmetic_conditions: {
          first_signal: { type: 'virtual', name: 'signal-each' },
          output_signal: { type: 'virtual', name: 'signal-each' }
        }
      }
    }
    const r = report(
      [constant([{ ...A, count: 1 }]), arithmetic, { name: 'iron-chest' }, { name: 'small-lamp' }],
      [
        [1, 1, 2, 1], // constant → arithmetic input
        [2, 3, 4, 1] // arithmetic output → lamp
      ]
    )
    const [input, output] = r.networks.sort((a, b) => a.members[0]! - b.members[0]!)
    expect(input).toMatchObject({ members: [0, 1], readers: [1] })
    expect(input!.signals.map((s) => s.signal?.name ?? s.label)).toEqual(['signal-A'])
    expect(output).toMatchObject({ members: [1, 3], readers: [] })
    expect(output!.signals).toEqual([{ label: 'input signals', sources: [1] }])
  })

  it('honours output_networks and lists readings after named signals', () => {
    const r = report(
      [
        { name: 'iron-chest' },
        { name: 'iron-chest', control_behavior: { output_networks: { red: false, green: true } } },
        constant([{ ...B, count: 1 }])
      ],
      [
        [1, 1, 2, 1],
        [2, 1, 3, 1]
      ]
    )
    expect(r.networks[0]!.signals).toEqual([
      { signal: { type: 'virtual', name: 'signal-B' }, count: 1, sources: [2] },
      { label: 'contents', sources: [0] }
    ])
  })

  it('sorts networks by size and numbers them per colour', () => {
    const r = report(
      [
        { name: 'iron-chest' },
        { name: 'iron-chest' },
        { name: 'iron-chest' },
        { name: 'iron-chest' },
        { name: 'iron-chest' }
      ],
      [
        [1, 1, 2, 1],
        [3, 1, 4, 1],
        [4, 1, 5, 1]
      ]
    )
    expect(r.networks.map((n) => [n.color, n.id, n.members])).toEqual([
      ['red', 1, [2, 3, 4]],
      ['red', 2, [0, 1]]
    ])
  })

  it('ignores copper wires and wires to missing entities', () => {
    const r = report(
      [{ name: 'small-electric-pole' }, { name: 'small-electric-pole' }],
      [
        [1, 5, 2, 5],
        [1, 1, 9, 1]
      ]
    )
    expect(r.networks).toEqual([
      { color: 'red', id: 1, members: [0], readers: [], wires: [1], signals: [] }
    ])
  })
})
