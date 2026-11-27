import { useMemo } from 'react'
import { formatVersion, unpackVersion, type JsonObject } from '@core/codec'
import {
  formatIssuePath,
  type BlueprintLayout,
  type EntityLayout,
  type EnvelopeNode
} from '@core/model'
import { CATEGORY_LABELS } from '../canvas/colors'
import { kindLabel } from '../components/kinds'
import { RichText } from '../components/RichText'
import type { OpenDocument } from '../store/documents'

const DIRECTION_NAMES = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW'
]

interface Props {
  doc: OpenDocument
  node: EnvelopeNode | undefined
  layout: BlueprintLayout | null
  selection: readonly number[]
}

/** Read-only inspector (docs/spec/04-visualization.md § Interaction). */
export function Inspector({ doc, node, layout, selection }: Props): React.JSX.Element {
  const selected = useMemo(
    () =>
      selection.map((i) => layout?.entities[i]).filter((e): e is EntityLayout => e !== undefined),
    [selection, layout]
  )

  if (selected.length === 1) return <EntityDetails entity={selected[0]!} />
  if (selected.length > 1) return <SelectionSummary entities={selected} />
  if (!node) return <p className="p-3 text-ink-muted">Nothing selected.</p>
  return <NodeDetails doc={doc} node={node} layout={layout} />
}

function EntityDetails({ entity: e }: { entity: EntityLayout }): React.JSX.Element {
  const raw = e.entity as JsonObject
  return (
    <div data-testid="inspector-entity">
      <div className="panel-title">Entity</div>
      <dl className="kv">
        <dt>Name</dt>
        <dd className="font-medium">{e.entity.name}</dd>
        <dt>Number</dt>
        <dd>{e.entity.entity_number}</dd>
        <dt>Position</dt>
        <dd className="font-mono">
          {e.entity.position.x}, {e.entity.position.y}
        </dd>
        <dt>Size</dt>
        <dd>
          {e.size.width}×{e.size.height}
          {!e.known && <span className="ml-1 text-danger">(unknown prototype)</span>}
        </dd>
        <dt>Category</dt>
        <dd>{CATEGORY_LABELS[e.category]}</dd>
        {e.directional && (
          <>
            <dt>Direction</dt>
            <dd>
              {DIRECTION_NAMES[e.direction]} ({e.direction})
            </dd>
          </>
        )}
        {e.entity.quality && (
          <>
            <dt>Quality</dt>
            <dd>{e.entity.quality}</dd>
          </>
        )}
        {e.entity.recipe && (
          <>
            <dt>Recipe</dt>
            <dd>
              {e.entity.recipe}
              {e.entity.recipe_quality &&
                e.entity.recipe_quality !== 'normal' &&
                ` (${e.entity.recipe_quality})`}
            </dd>
          </>
        )}
        {e.entity.mirror && (
          <>
            <dt>Mirrored</dt>
            <dd>yes</dd>
          </>
        )}
      </dl>
      <div className="panel-title mt-2">Raw JSON</div>
      <pre className="mx-3 mb-3 max-h-[50vh] overflow-auto rounded bg-panel-2 p-2 font-mono text-[11px] leading-snug">
        {JSON.stringify(raw, null, 2)}
      </pre>
    </div>
  )
}

function SelectionSummary({ entities }: { entities: EntityLayout[] }): React.JSX.Element {
  const counts = useMemo(() => countBy(entities.map((e) => e.entity.name)), [entities])
  return (
    <div data-testid="inspector-selection">
      <div className="panel-title">{entities.length} entities selected</div>
      <CountList counts={counts} />
    </div>
  )
}

function NodeDetails({
  doc,
  node,
  layout
}: {
  doc: OpenDocument
  node: EnvelopeNode
  layout: BlueprintLayout | null
}): React.JSX.Element {
  const p = node.payload
  const label = typeof p['label'] === 'string' ? p['label'] : ''
  const description = typeof p['description'] === 'string' ? p['description'] : ''
  const version =
    typeof p['version'] === 'number' ? formatVersion(unpackVersion(p['version'])) : '–'
  const counts = useMemo(
    () => (layout ? countBy(layout.entities.map((e) => e.entity.name)) : []),
    [layout]
  )
  const issues = doc.issues
  const wires = Array.isArray(p['wires']) ? p['wires'].length : 0
  const bounds = layout?.bounds

  return (
    <div data-testid="inspector-node">
      <div className="panel-title">{kindLabel(node.kind)}</div>
      <dl className="kv">
        <dt>Label</dt>
        <dd>{label ? <RichText text={label} /> : <span className="text-ink-muted">–</span>}</dd>
        <dt>Game version</dt>
        <dd>{version}</dd>
        {layout && (
          <>
            <dt>Entities</dt>
            <dd>{layout.entities.length}</dd>
            <dt>Tiles</dt>
            <dd>{layout.tiles.length}</dd>
            <dt>Wires</dt>
            <dd>{wires}</dd>
            {bounds && (
              <>
                <dt>Size</dt>
                <dd>
                  {Math.ceil(bounds.right - bounds.left)}×{Math.ceil(bounds.bottom - bounds.top)}{' '}
                  tiles
                </dd>
              </>
            )}
          </>
        )}
      </dl>
      {description && (
        <>
          <div className="panel-title mt-2">Description</div>
          <p className="mx-3 my-0 whitespace-pre-wrap text-[12px]">
            <RichText text={description} />
          </p>
        </>
      )}

      {doc.migration && (
        <>
          <div className="panel-title mt-2">
            Migrated from {formatVersion(unpackVersion(doc.migration.fromVersion))}
          </div>
          <ul className="mx-3 my-0 list-disc pl-4 text-[12px] text-ink-muted">
            <li>{doc.migration.renamedCount} renamed prototypes</li>
            {doc.migration.notes.map((n, i) => (
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        </>
      )}

      {layout && layout.unknownNames.length > 0 && (
        <>
          <div className="panel-title mt-2 text-danger">
            Unknown prototypes ({layout.unknownNames.length})
          </div>
          <p className="mx-3 my-0 text-[11px] break-words text-ink-muted">
            {layout.unknownNames.join(', ')}
          </p>
        </>
      )}

      {issues.length > 0 && (
        <>
          <div className="panel-title mt-2 text-danger">Problems ({issues.length})</div>
          <ul className="mx-3 my-0 space-y-1 pl-0 text-[11px]">
            {issues.slice(0, 50).map((issue, i) => (
              <li key={i} className="list-none">
                <span className={issue.severity === 'error' ? 'text-danger' : 'text-accent'}>
                  {issue.message}
                </span>
                <div className="font-mono text-[10px] break-all text-ink-muted">
                  {formatIssuePath(issue.path)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {counts.length > 0 && (
        <>
          <div className="panel-title mt-2">Entities by name</div>
          <CountList counts={counts} />
        </>
      )}

      {(node.kind === 'upgrade_planner' || node.kind === 'deconstruction_planner') && (
        <>
          <div className="panel-title mt-2">Settings</div>
          <pre className="mx-3 mb-3 max-h-[50vh] overflow-auto rounded bg-panel-2 p-2 font-mono text-[11px]">
            {JSON.stringify(p['settings'] ?? {}, null, 2)}
          </pre>
        </>
      )}
    </div>
  )
}

function CountList({ counts }: { counts: [string, number][] }): React.JSX.Element {
  return (
    <ul className="m-0 px-3 pb-3 text-[12px]">
      {counts.map(([name, count]) => (
        <li key={name} className="flex list-none justify-between gap-2 py-px">
          <span className="truncate">{name}</span>
          <span className="font-mono text-ink-muted">{count}</span>
        </li>
      ))}
    </ul>
  )
}

function countBy(names: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
