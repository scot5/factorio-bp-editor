import clsx from 'clsx'
import type { CarriedSignal, CircuitEntityRow, CircuitNetwork, CircuitReport } from '@core/analysis'
import { displayName } from '@core/prototypes'
import { Icon } from '../components/Icon'
import { RichText } from '../components/RichText'
import { useAssets } from '../store/assets'
import { Section } from './Section'

interface Props {
  report: CircuitReport
  onSelect(indexes: number[]): void
  onSelectNetwork(indexes: number[], wires: number[]): void
}

const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** Header figure: networks per colour ("3 red · 1 green"), else the settings count. */
function circuitSummary(report: CircuitReport): string {
  const red = report.networks.filter((n) => n.color === 'red').length
  const green = report.networks.length - red
  if (red + green === 0)
    return report.entities.length
      ? count(report.entities.length, 'setting', 'settings')
      : 'no circuit wires'
  return [red ? `${red} red` : '', green ? `${green} green` : ''].filter(Boolean).join(' · ')
}

const MAX_SIGNALS = 16

const signalKey = (s: CarriedSignal): string =>
  s.signal ? `${s.signal.type}:${s.signal.name}:${s.signal.quality ?? ''}` : `~${s.label ?? ''}`

/** Circuit networks and settings (docs/spec/06-analysis.md § 5 Circuit networks). */
export function CircuitSection({
  report,
  onSelect,
  onSelectNetwork
}: Readonly<Props>): React.JSX.Element {
  const empty = report.networks.length + report.entities.length === 0
  return (
    <Section id="circuits" title="Circuits" level="report" summary={circuitSummary(report)}>
      <div data-testid="circuits">
        {empty && <p className="m-0 px-3 pb-2 text-ink-muted">No circuit wires or combinators.</p>}

        {report.networks.length > 0 && (
          <Section id="circuits.networks" title="Networks" summary={report.networks.length}>
            <ul className="m-0 list-none px-1 pb-2" data-testid="circuit-networks">
              {report.networks.map((n) => (
                <li key={`${n.color}-${n.id}`}>
                  <NetworkRow network={n} onSelect={onSelectNetwork} />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {report.entities.length > 0 && (
          <Section id="circuits.settings" title="Settings" summary={report.entities.length}>
            <ul className="m-0 list-none px-1 pb-2" data-testid="circuit-settings">
              {report.entities.map((row) => (
                <li key={`${row.name}\n${row.lines.join('\n')}`}>
                  <SettingsRow row={row} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </Section>
  )
}

function NetworkRow({
  network,
  onSelect
}: Readonly<{
  network: CircuitNetwork
  onSelect(indexes: number[], wires: number[]): void
}>): React.JSX.Element {
  const { color, id, members, readers, signals } = network
  const shown = signals.slice(0, MAX_SIGNALS)
  return (
    <button
      className="flex w-full flex-col gap-0.5 rounded px-2 py-1 text-left hover:bg-white/5"
      title={`${count(members.length, 'entity', 'entities')}, ${readers.length} reading the network`}
      onClick={() => onSelect(members, network.wires)}
      data-testid="circuit-networks-row"
    >
      <span className="flex w-full items-center gap-2">
        <span
          className={clsx(
            'size-2.5 shrink-0 rounded-full',
            color === 'red' ? 'bg-[#c83718]' : 'bg-[#588c38]'
          )}
        />
        <span className="flex-1">
          {color === 'red' ? 'Red' : 'Green'} {id}
        </span>
        <span className="text-ink-muted tabular-nums">
          {count(members.length, 'entity', 'entities')}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1 pl-4.5 text-[11px] text-ink-muted">
        {signals.length === 0 && <span>no signals sent</span>}
        {shown.map((s) => (
          <SignalChip key={signalKey(s)} s={s} />
        ))}
        {signals.length > MAX_SIGNALS && <span>+{signals.length - MAX_SIGNALS}</span>}
      </span>
    </button>
  )
}

function SignalChip({ s }: Readonly<{ s: CarriedSignal }>): React.JSX.Element {
  if (!s.signal) return <span className="rounded bg-white/5 px-1">{s.label}</span>
  const { type, name, quality } = s.signal
  const kind = type === 'virtual' ? 'virtual-signal' : type
  return (
    <span className="inline-flex items-center gap-0.5">
      <Icon kind={kind} name={name} quality={quality} size={16} />
      {s.count !== undefined && (
        <span className="tabular-nums">{s.count.toLocaleString('en')}</span>
      )}
    </span>
  )
}

function SettingsRow({
  row,
  onSelect
}: Readonly<{ row: CircuitEntityRow; onSelect(indexes: number[]): void }>): React.JSX.Element {
  const db = useAssets((s) => s.db)
  return (
    <button
      className="flex w-full items-start gap-2 rounded px-2 py-0.5 text-left hover:bg-white/5"
      title={row.name}
      onClick={() => onSelect(row.indexes)}
      data-testid="circuit-settings-row"
    >
      <span className="flex size-5 shrink-0 items-center">
        <Icon kind="entity" name={row.name} size={20} fallback="none" />
      </span>
      <span className="min-w-0 flex-1 break-words">
        <span className="text-ink-muted">
          {displayName(db, 'entity', row.name)}
          {row.count > 1 && ` × ${row.count.toLocaleString('en')}`}
        </span>
        {row.lines.map((line) => (
          <RichText key={line} text={line} className="block" />
        ))}
      </span>
    </button>
  )
}
