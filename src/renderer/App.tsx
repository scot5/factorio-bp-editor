import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { isDirty, type History } from '@core/edit'
import type { Position } from '@core/geometry'
import { getNode, layoutBlueprint, type Blueprint } from '@core/model'
import { wireSegments } from '@core/sprites'
import { BlueprintCanvas, type CanvasHover } from './canvas/BlueprintCanvas'
import type { DiffOverlay, IconSource } from './canvas/scene'
import { spriteResolverFor, spriteSourceFor } from './canvas/sprite-source'
import { GameDataStatus } from './components/GameDataStatus'
import { Icon } from './components/Icon'
import { PX_PER_TILE } from './canvas/camera'
import { ExportDialog } from './components/ExportDialog'
import { ImportDialog } from './components/ImportDialog'
import { KindBadge } from './components/KindBadge'
import { AnalysisPanel } from './panels/AnalysisPanel'
import { loadSections } from './store/sections'
import { BookTree } from './panels/BookTree'
import { Inspector } from './panels/Inspector'
import { useAnalysis } from './store/analysis'
import { useAssets } from './store/assets'
import { useDiff } from './store/diff'
import { useActiveDocument, useDocuments } from './store/documents'

const DIRECTIONS = [
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

export function App(): React.JSX.Element {
  const doc = useActiveDocument()
  const documents = useDocuments((s) => s.documents)
  const selection = useDocuments((s) => s.selection)
  const select = useDocuments((s) => s.select)
  const wireHighlight = useDocuments((s) => s.wireHighlight)
  const selectNetwork = useDocuments((s) => s.selectNetwork)
  const setActiveDocument = useDocuments((s) => s.setActiveDocument)
  const closeDocument = useDocuments((s) => s.closeDocument)

  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [hover, setHover] = useState<CanvasHover | null>(null)
  const [cursor, setCursor] = useState<Position | null>(null)
  const [scale, setScale] = useState(PX_PER_TILE)
  const [fitRequest, setFitRequest] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [sideTab, setSideTab] = useState<'inspector' | 'analysis'>('inspector')

  const lookup = useAssets((s) => s.lookup)
  const icon = useAssets((s) => s.icon)
  const db = useAssets((s) => s.db)
  const hasGameData = db !== null
  const spriteResolver = useMemo(() => (db ? spriteResolverFor(db) : null), [db])
  useEffect(() => useAssets.getState().init(), [])
  useEffect(() => void loadSections(), [])
  const iconSource = useMemo<IconSource | null>(
    () => (hasGameData ? (e) => (e.known ? icon('entity', e.entity.name) : null) : null),
    [hasGameData, icon]
  )

  const node = useMemo(() => (doc ? getNode(doc.envelope, doc.activePath) : undefined), [doc])
  const payload = node?.kind === 'blueprint' ? node.payload : undefined
  const layout = useMemo(
    () => (payload ? layoutBlueprint(payload as Blueprint, lookup) : null),
    [payload, lookup]
  )
  const spriteSource = useMemo(
    () => (spriteResolver ? spriteSourceFor(spriteResolver, layout) : null),
    [spriteResolver, layout]
  )
  const wires = useMemo(() => (layout ? wireSegments(db, layout) : []), [db, layout])

  // Analysis runs in a Web Worker whenever the blueprint or the game data changes.
  const blueprint = (payload as Blueprint | undefined) ?? null
  useEffect(() => useAnalysis.getState().run(blueprint, db), [blueprint, db])
  const analysedBlueprint = useAnalysis((s) => s.blueprint)

  // Compare: the blueprint on the canvas against another open blueprint (06 § 7).
  const diffTarget = useDiff((s) => s.target)
  const analysisSettings = useAnalysis((s) => s.settings)
  const before = useMemo(() => {
    if (!diffTarget || !doc) return null
    if (diffTarget.docId === doc.id && diffTarget.path.join('/') === doc.activePath.join('/'))
      return null
    const other = documents.find((d) => d.id === diffTarget.docId)
    const target = other ? getNode(other.envelope, diffTarget.path) : undefined
    return target?.kind === 'blueprint' ? (target.payload as Blueprint) : null
  }, [diffTarget, doc, documents])
  useEffect(
    () => useDiff.getState().run(before, blueprint, db, analysisSettings),
    [before, blueprint, db, analysisSettings]
  )
  const diffReport = useDiff((s) => s.report)
  const diffAfter = useDiff((s) => s.after)
  const diffOverlayOn = useDiff((s) => s.overlay)
  const diffOverlay = useMemo<DiffOverlay | null>(
    () =>
      before && diffOverlayOn && diffReport && blueprint && diffAfter === blueprint
        ? {
            added: diffReport.addedIndexes,
            changed: diffReport.changedIndexes,
            removed: diffReport.removedBoxes
          }
        : null,
    [before, diffOverlayOn, diffReport, blueprint, diffAfter]
  )

  const doImport = (text: string, fileName?: string): void => {
    const result = useDocuments.getState().importString(text, fileName)
    setToast(result.ok ? null : { kind: 'error', text: result.message })
  }

  // Paste anywhere (outside text fields) imports a string.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text.trim()) return
      event.preventDefault()
      const result = useDocuments.getState().importString(text)
      setToast(result.ok ? null : { kind: 'error', text: result.message })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Undo / redo shortcuts (05 § Tools). Text fields keep their own undo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (!event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const store = useDocuments.getState()
      if (key === 'z' && !event.shiftKey) store.undo()
      else if (key === 'y' || (key === 'z' && event.shiftKey)) store.redo()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Toasts disappear after a while.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const openFile = async (): Promise<void> => {
    try {
      const file = await window.api.files.openBlueprint()
      if (file) doImport(file.contents, file.name)
    } catch (error) {
      setToast({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  }

  const onDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    setDragging(false)
    const files = [...event.dataTransfer.files]
    if (files.length) {
      for (const file of files) doImport(await file.text(), file.name)
      return
    }
    const text = event.dataTransfer.getData('text/plain')
    if (text) doImport(text)
  }

  const viewKey = doc ? `${doc.id}:${doc.activePath.join('/')}` : 'none'

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {/* Toolbar */}
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge bg-panel px-2">
        <span className="mr-2 font-semibold text-accent">Blueprint Editor</span>
        <button className="btn" onClick={() => setImportOpen(true)} data-testid="import-button">
          Import
        </button>
        <button className="btn" onClick={() => void openFile()}>
          Open file…
        </button>
        <button
          className="btn"
          disabled={!doc}
          onClick={() => setExportOpen(true)}
          data-testid="export-button"
        >
          Export
        </button>
        <div className="mx-1 h-5 w-px bg-edge" />
        <UndoRedo history={doc?.history} />
        <div className="mx-1 h-5 w-px bg-edge" />
        <button
          className="btn"
          disabled={!layout}
          onClick={() => setFitRequest((n) => n + 1)}
          title="Fit (F)"
        >
          Fit
        </button>
        <nav className="ml-2 flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Open documents">
          {documents.map((d) => (
            <div
              key={d.id}
              className={clsx(
                'flex max-w-56 shrink-0 items-center gap-1.5 rounded border px-2 py-0.5',
                d.id === doc?.id
                  ? 'border-accent/70 bg-panel-3'
                  : 'border-transparent hover:bg-white/5'
              )}
            >
              <button
                className="flex min-w-0 items-center gap-1.5"
                onClick={() => setActiveDocument(d.id)}
              >
                <KindBadge kind={d.kind} />
                <span className="truncate">{d.title}</span>
                {isDirty(d.history) && (
                  <span
                    className="text-accent"
                    title="Changed since import or export"
                    data-testid="dirty"
                  >
                    ●
                  </span>
                )}
              </button>
              <button
                className="text-ink-muted hover:text-ink"
                aria-label={`Close ${d.title}`}
                onClick={() => closeDocument(d.id)}
              >
                ×
              </button>
            </div>
          ))}
        </nav>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: book tree */}
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-edge bg-panel">
          <div className="panel-title">Contents</div>
          {doc ? <BookTree doc={doc} /> : <p className="px-3 text-ink-muted">No document open.</p>}
        </aside>

        {/* Centre: canvas */}
        <main className="relative min-w-0 flex-1">
          <BlueprintCanvas
            layout={layout}
            selection={selection}
            viewKey={viewKey}
            fitRequest={fitRequest}
            iconSource={iconSource}
            spriteSource={spriteSource}
            wires={wires}
            wireHighlight={wireHighlight}
            diff={diffOverlay}
            onSelect={select}
            onHover={setHover}
            onCursor={setCursor}
            onZoom={setScale}
          />
          {!doc && (
            <EmptyState onImport={() => setImportOpen(true)} onOpen={() => void openFile()} />
          )}
          {doc && !layout && node && (
            <div className="pointer-events-none absolute inset-0 grid place-content-center text-ink-muted">
              {node.kind === 'blueprint_book'
                ? 'Select a blueprint in the book.'
                : 'Planners have no layout to show; see the inspector.'}
            </div>
          )}
          {hover && <HoverTooltip hover={hover} />}
          {dragging && (
            <div className="pointer-events-none absolute inset-2 grid place-content-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-[15px]">
              Drop a blueprint string or .txt file
            </div>
          )}
          {toast && (
            <div
              role="alert"
              data-testid="toast"
              className={clsx(
                'absolute top-3 left-1/2 max-w-[80%] -translate-x-1/2 rounded border px-3 py-2 shadow-lg',
                toast.kind === 'error' ? 'border-danger/60 bg-[#3a2220]' : 'border-edge bg-panel'
              )}
            >
              {toast.text}
            </div>
          )}
        </main>

        {/* Right: inspector */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-edge bg-panel">
          <div className="flex shrink-0 border-b border-edge" role="tablist">
            {(['inspector', 'analysis'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={sideTab === tab}
                className={clsx(
                  'flex-1 border-b-2 px-3 py-1.5 capitalize',
                  sideTab === tab
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
                )}
                onClick={() => setSideTab(tab)}
                data-testid={`tab-${tab}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!doc && <p className="p-3 text-ink-muted">Import a blueprint to inspect it.</p>}
            {doc && sideTab === 'inspector' && (
              <Inspector doc={doc} node={node} layout={layout} selection={selection} />
            )}
            {doc && sideTab === 'analysis' && (
              <AnalysisPanel
                current={blueprint !== null && analysedBlueprint === blueprint}
                onSelect={(indexes) => select(indexes)}
                onSelectNetwork={selectNetwork}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-edge bg-panel-2 px-3 text-[11px] text-ink-muted">
        <span className="w-24 font-mono">{cursor ? `${cursor.x}, ${cursor.y}` : '–'}</span>
        <span data-testid="entity-count">
          {layout ? `${layout.entities.length} entities` : 'no blueprint'}
        </span>
        {selection.length > 0 && (
          <span data-testid="selection-count">{selection.length} selected</span>
        )}
        {doc && doc.issues.length > 0 && (
          <span className="text-danger">{doc.issues.length} problems</span>
        )}
        {doc?.migration && <span className="text-accent">migrated from 1.1</span>}
        <span className="ml-auto">{Math.round((scale / PX_PER_TILE) * 100)}%</span>
        <GameDataStatus />
      </footer>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      {doc && <ExportDialog doc={doc} node={node} open={exportOpen} onOpenChange={setExportOpen} />}
    </div>
  )
}

function UndoRedo({ history }: Readonly<{ history: History | undefined }>): React.JSX.Element {
  const undoStep = history?.undo.at(-1)
  const redoStep = history?.redo.at(-1)
  return (
    <>
      <button
        className="btn"
        disabled={!undoStep}
        onClick={() => useDocuments.getState().undo()}
        title={undoStep ? `Undo ${undoStep.label.toLowerCase()} (Ctrl+Z)` : 'Nothing to undo'}
        data-testid="undo-button"
      >
        Undo
      </button>
      <button
        className="btn"
        disabled={!redoStep}
        onClick={() => useDocuments.getState().redo()}
        title={redoStep ? `Redo ${redoStep.label.toLowerCase()} (Ctrl+Y)` : 'Nothing to redo'}
        data-testid="redo-button"
      >
        Redo
      </button>
    </>
  )
}

function EmptyState({ onImport, onOpen }: { onImport(): void; onOpen(): void }): React.JSX.Element {
  return (
    <div
      className="absolute inset-0 grid place-content-center gap-3 text-center"
      data-testid="empty-state"
    >
      <h1 className="m-0 text-[20px] font-semibold text-accent">Factorio Blueprint Editor</h1>
      <p className="m-0 text-ink-muted">
        Paste a blueprint string anywhere (<kbd className="font-mono">Ctrl+V</kbd>), drop a file,
        or:
      </p>
      <div className="flex justify-center gap-2">
        <button className="btn btn-primary" onClick={onImport}>
          Import string
        </button>
        <button className="btn" onClick={onOpen}>
          Open file…
        </button>
      </div>
    </div>
  )
}

function HoverTooltip({ hover }: { hover: CanvasHover }): React.JSX.Element {
  const e = hover.entity
  return (
    <div
      className="pointer-events-none absolute z-10 rounded border border-edge bg-panel/95 px-2 py-1 text-[11px] shadow-lg"
      style={{ left: hover.screen.x + 14, top: hover.screen.y + 14 }}
      data-testid="hover-tooltip"
    >
      <div className="flex items-center gap-1.5 font-medium text-ink">
        <Icon
          kind="entity"
          name={e.entity.name}
          quality={e.entity.quality}
          size={20}
          fallback="none"
        />
        {e.entity.name}
        {e.entity.quality && e.entity.quality !== 'normal' && (
          <span className="ml-1 text-accent">({e.entity.quality})</span>
        )}
      </div>
      <div className="text-ink-muted">
        {e.entity.position.x}, {e.entity.position.y}
        {e.directional && ` · ${DIRECTIONS[e.direction]}`}
        {e.entity.recipe && ` · ${e.entity.recipe}`}
        {!e.known && <span className="text-danger"> · unknown prototype</span>}
      </div>
    </div>
  )
}
