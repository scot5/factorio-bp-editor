import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { castDraft } from 'immer'
import {
  decode,
  DecodeError,
  rootKind,
  rootPayload,
  type BlueprintEnvelope,
  type RootKind
} from '@core/codec'
import { migrate1to2, type MigrationNote } from '@core/migrate'
import { defaultPath, validateEnvelope, type BookPath, type ValidationIssue } from '@core/model'
import { richTextToPlain } from '@core/richtext'

/**
 * Open documents and view state. See docs/spec/05-editing.md § Document model.
 * M2 is read-only: the envelope is never changed after import.
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
}

export type SelectionMode = 'replace' | 'add' | 'toggle'

interface DocumentState {
  documents: OpenDocument[]
  activeId: string | null
  /** Indexes into the active blueprint's `entities`. */
  selection: number[]
  importString(text: string, fileName?: string): { ok: true } | { ok: false; message: string }
  closeDocument(id: string): void
  setActiveDocument(id: string): void
  setActivePath(path: BookPath): void
  select(indexes: number[], mode?: SelectionMode): void
  clearSelection(): void
}

let nextId = 1

export const useDocuments = create<DocumentState>()(
  immer((set) => ({
    documents: [],
    activeId: null,
    selection: [],

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
      const payload = rootPayload(envelope)
      const label = typeof payload['label'] === 'string' ? richTextToPlain(payload['label']) : ''
      const kind = rootKind(envelope)
      const doc: OpenDocument = {
        id: `doc-${nextId++}`,
        title: label || fileName?.replace(/\.txt$/i, '') || defaultTitle(kind),
        kind,
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
        }
      }
      set((state) => {
        state.documents.push(castDraft(doc))
        state.activeId = doc.id
        state.selection = []
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
        }
      })
    },

    setActiveDocument(id) {
      set((state) => {
        if (state.activeId !== id) {
          state.activeId = id
          state.selection = []
        }
      })
    },

    setActivePath(path) {
      set((state) => {
        const doc = state.documents.find((d) => d.id === state.activeId)
        if (!doc) return
        doc.activePath = [...path]
        state.selection = []
      })
    },

    select(indexes, mode = 'replace') {
      set((state) => {
        if (mode === 'replace') {
          state.selection = [...new Set(indexes)]
          return
        }
        const current = new Set(state.selection)
        for (const i of indexes) {
          if (mode === 'toggle' && current.has(i)) current.delete(i)
          else current.add(i)
        }
        state.selection = [...current]
      })
    },

    clearSelection() {
      set((state) => {
        state.selection = []
      })
    }
  }))
)

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
