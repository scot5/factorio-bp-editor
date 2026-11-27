import clsx from 'clsx'
import { useState } from 'react'
import type { JsonObject } from '@core/codec'
import { bookSlots, rootNode, type BookPath, type EnvelopeNode } from '@core/model'
import { KindBadge } from '../components/KindBadge'
import { RichText } from '../components/RichText'
import { useDocuments, type OpenDocument } from '../store/documents'

/**
 * Book tree (docs/spec/04-visualization.md § Layout). Slots are shown by their
 * in-game index; empty slots of sparse books are simply absent.
 */
export function BookTree({ doc }: { doc: OpenDocument }): React.JSX.Element {
  const setActivePath = useDocuments((s) => s.setActivePath)
  const root = rootNode(doc.envelope)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div
      role="tree"
      aria-label="Book contents"
      className="py-1 text-[12px]"
      data-testid="book-tree"
    >
      <TreeNode
        node={root}
        depth={0}
        activePath={doc.activePath}
        collapsed={collapsed}
        onToggle={toggle}
        onSelect={setActivePath}
      />
    </div>
  )
}

interface NodeProps {
  node: EnvelopeNode
  slotIndex?: number
  depth: number
  activePath: BookPath
  collapsed: Set<string>
  onToggle(key: string): void
  onSelect(path: BookPath): void
}

function TreeNode(props: NodeProps): React.JSX.Element {
  const { node, slotIndex, depth, activePath, collapsed, onToggle, onSelect } = props
  const key = node.path.join('/')
  const isBook = node.kind === 'blueprint_book'
  const open = isBook && !collapsed.has(key)
  const active = key === activePath.join('/')
  const label = typeof node.payload['label'] === 'string' ? node.payload['label'] : ''
  const entities = Array.isArray(node.payload['entities']) ? node.payload['entities'].length : null
  const slots = isBook ? bookSlots(node.payload) : []

  return (
    <div role="treeitem" aria-expanded={isBook ? open : undefined} aria-selected={active}>
      <button
        type="button"
        className={clsx(
          'flex w-full items-center gap-1.5 py-[3px] pr-2 text-left hover:bg-white/5',
          active && 'bg-accent/15 text-ink shadow-[inset_2px_0_0_var(--color-accent)]'
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onSelect(node.path)}
        onDoubleClick={() => isBook && onToggle(key)}
      >
        <span
          className={clsx('w-3 shrink-0 text-ink-muted', !isBook && 'invisible')}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(key)
          }}
        >
          {open ? '▾' : '▸'}
        </span>
        <KindBadge kind={node.kind} />
        {slotIndex !== undefined && (
          <span
            className="w-5 shrink-0 text-right font-mono text-[10px] text-ink-muted"
            title="Slot index"
          >
            {slotIndex}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {label ? (
            <RichText text={label} />
          ) : (
            <span className="text-ink-muted italic">{untitled(node)}</span>
          )}
        </span>
        {entities !== null && (
          <span className="shrink-0 text-[10px] text-ink-muted">{entities}</span>
        )}
        {isBook && <span className="shrink-0 text-[10px] text-ink-muted">{slots.length}</span>}
      </button>
      {open &&
        slots.map((slot) => (
          <TreeNode
            key={slot.index}
            {...props}
            node={{
              kind: slot.kind,
              payload: slot.payload as JsonObject,
              path: [...node.path, slot.index]
            }}
            slotIndex={slot.index}
            depth={depth + 1}
          />
        ))}
    </div>
  )
}

function untitled(node: EnvelopeNode): string {
  switch (node.kind) {
    case 'blueprint':
      return 'Untitled blueprint'
    case 'blueprint_book':
      return 'Untitled book'
    case 'deconstruction_planner':
      return 'Deconstruction planner'
    case 'upgrade_planner':
      return 'Upgrade planner'
  }
}
