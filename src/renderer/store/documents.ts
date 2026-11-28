import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { castDraft, type Draft } from 'immer'
import {
  decode,
  DecodeError,
  rootKind,
  rootPayload,
  type BlueprintEnvelope,
  type RootKind
} from '@core/codec'
import {
  emptyHistory,
  execute,
  markClean,
  redo,
  undo,
  type Command,
  type History,
  type StepResult
} from '@core/edit'
import { migrate1to2, type MigrationNote } from '@core/migrate'
import {
  defaultPath,
  getNode,
  validateEnvelope,
  type BookPath,
  type ValidationIssue
} from '@core/model'
import { richTextToPlain } from '@core/richtext'

/**
 * Open documents and view state. See docs/spec/05-editing.md § Document model.
 * The envelope only changes through commands (`runCommand`, `undo`, `redo`).
 */

export interface MigrationInfo {
  fromVersion: number
  notes: MigrationNote[]
  renamedCount: number
}

export interface OpenDocument {
  id: string
  title: string
  kind: RootKind
  envelope: BlueprintEnvelope
  activePath: number[]
  issues: ValidationIssue[]
  migration: MigrationInfo | null
  source: { importedAt: string; fileName?: string; originalString: string }
  /** Undo/redo steps (05 § Undo history); `isDirty(history)` says whether it changed since saved. */
  history: History
}

export type CommandResult = { ok: true; warnings: string[] } | { ok: false; message: string }

export type SelectionMode = 'replace' | 'add' | 'toggle'

interface DocumentState {
  documents: OpenDocument[]
  activeId: string | null
  /** Indexes into the active blueprint's `entities`. */
  selection: number[]
  /** Wires drawn highlighted (indexes into the blueprint's `wires`): a circuit network picked in the Analysis tab. */
  wireHighlight: number[]
  importString(text: string, fileName?: string): { ok: true } | { ok: false; message: string }
  closeDocument(id: string): void
  setActiveDocument(id: string): void
  setActivePath(path: BookPath): void
  select(indexes: number[], mode?: SelectionMode): void
  /** Selects a network's entities and highlights its wires; any other selection change clears the wires. */
  selectNetwork(indexes: number[], wires: number[]): void
  clearSelection(): void
  /** Runs an edit command on the active document. */
  runCommand<A>(command: Command<A>, args: A): CommandResult
  undo(): void
  redo(): void
  /** Marks a document as saved (its whole envelope was exported). */
  markSaved(id: string): void
}

let nextId = 1

export const useDocuments = create<DocumentState>()(
  immer((set, get) => ({
    documents: [],
    activeId: null,
    selection: [],
    wireHighlight: [],

    importString(text, fileName) {
      let decoded: BlueprintEnvelope
      try {
        decoded = decode(text)
      } catch (error) {
        return {
          ok: false,
          message: error instanceof DecodeError ? error.userMessage : String(error)
        }
      }
      const result = migrate1to2(decoded)
      const envelope = result.envelope
      const doc: OpenDocument = {
        id: `doc-${nextId++}`,
        title: documentTitle(envelope, fileName),
        kind: rootKind(envelope),
        envelope,
        activePath: [...defaultPath(envelope)],
        issues: validateEnvelope(envelope),
        migration: result.migrated
          ? {
              fromVersion: result.fromVersion,
              notes: result.notes,
              renamedCount: [...result.renamed.values()].reduce((n, r) => n + r.count, 0)
            }
          : null,
        source: {
          importedAt: new Date().toISOString(),
          originalString: text.trim(),
          ...(fileName ? { fileName } : {})
        },
        history: emptyHistory()
      }
      set((state) => {
        state.documents.push(castDraft(doc))
        state.activeId = doc.id
        state.selection = []
        state.wireHighlight = []
      })
      return { ok: true }
    },

    closeDocument(id) {
      set((state) => {
        const index = state.documents.findIndex((d) => d.id === id)
        if (index < 0) return
        state.documents.splice(index, 1)
        if (state.activeId === id) {
          state.activeId = state.documents[Math.min(index, state.documents.length - 1)]?.id ?? null
          state.selection = []
          state.wireHighlight = []
        }
      })
    },

    setActiveDocument(id) {
      set((state) => {
        if (state.activeId !== id) {
          state.activeId = id
          state.selection = []
          state.wireHighlight = []
        }
      })
    },

    setActivePath(path) {
      set((state) => {
        const doc = state.documents.find((d) => d.id === state.activeId)
        if (!doc) return
        doc.activePath = [...path]
        state.selection = []
        state.wireHighlight = []
      })
    },

    select(indexes, mode = 'replace') {
      set((state) => {
        if (mode === 'replace') {
          state.selection = [...new Set(indexes)]
          state.wireHighlight = []
          return
        }
        const current = new Set(state.selection)
        for (const i of indexes) {
          if (mode === 'toggle' && current.has(i)) current.delete(i)
          else current.add(i)
        }
        state.selection = [...current]
        state.wireHighlight = []
      })
    },

    selectNetwork(indexes, wires) {
      set((state) => {
        state.selection = [...new Set(indexes)]
        state.wireHighlight = [...wires]
      })
    },

    clearSelection() {
      set((state) => {
        state.selection = []
        state.wireHighlight = []
      })
    },

    runCommand(command, args) {
      const doc = activeDocument(get())
      if (!doc) return { ok: false, message: 'No document is open.' }
      const result = execute(doc.envelope, doc.history, command, args, {
        activePath: doc.activePath
      })
      if (!result.ok) return result
      if (result.changed) {
        set((state) => {
          const target = state.documents.find((d) => d.id === doc.id)
          if (target) applyEnvelope(target, result.envelope, result.history)
        })
      }
      return { ok: true, warnings: result.warnings }
    },

    undo() {
      step(undo)
    },

    redo() {
      step(redo)
    },

    markSaved(id) {
      set((state) => {
        const doc = state.documents.find((d) => d.id === id)
        if (doc) doc.history = castDraft(markClean(doc.history as History))
      })
    }
  }))
)

/** Undo or redo on the active document, then show the blueprint the step was made on. */
function step(
  apply: (envelope: BlueprintEnvelope, history: History) => StepResult | undefined
): void {
  const doc = activeDocument(useDocuments.getState())
  const result = doc && apply(doc.envelope, doc.history)
  if (!result) return
  useDocuments.setState((state) => {
    const target = state.documents.find((d) => d.id === doc.id)
    if (!target) return
    applyEnvelope(target, result.envelope, result.history)
    const path = result.entry.activePath
    if (path.join('/') !== target.activePath.join('/') && getNode(result.envelope, path)) {
      target.activePath = [...path]
      state.selection = []
      state.wireHighlight = []
    }
  })
}

/** Stores an edited envelope and refreshes what is derived from it. */
function applyEnvelope(
  doc: Draft<OpenDocument>,
  envelope: BlueprintEnvelope,
  history: History
): void {
  doc.envelope = castDraft(envelope)
  doc.history = castDraft(history)
  doc.issues = validateEnvelope(envelope)
  doc.title = documentTitle(envelope, doc.source.fileName)
  if (!getNode(envelope, doc.activePath)) doc.activePath = [...defaultPath(envelope)]
}

function activeDocument(state: DocumentState): OpenDocument | undefined {
  return state.documents.find((d) => d.id === state.activeId)
}

/** The tab title: the root label, else the file name, else the kind. */
function documentTitle(envelope: BlueprintEnvelope, fileName: string | undefined): string {
  const payload = rootPayload(envelope)
  const label = typeof payload['label'] === 'string' ? richTextToPlain(payload['label']) : ''
  return label || fileName?.replace(/\.txt$/i, '') || defaultTitle(rootKind(envelope))
}

function defaultTitle(kind: RootKind): string {
  switch (kind) {
    case 'blueprint':
      return 'Blueprint'
    case 'blueprint_book':
      return 'Blueprint book'
    case 'deconstruction_planner':
      return 'Deconstruction planner'
    case 'upgrade_planner':
      return 'Upgrade planner'
  }
}

export function useActiveDocument(): OpenDocument | undefined {
  return useDocuments((s) => s.documents.find((d) => d.id === s.activeId))
}
