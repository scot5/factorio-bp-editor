import {
  deleteEntities,
  mirrorEntities,
  moveEntities,
  rotateEntities,
  selectionOnRailGrid,
  type Command,
  type EntitiesArgs,
  type MirrorAxis,
  type Turn
} from '@core/edit'
import { getNode, type Blueprint } from '@core/model'
import { useAssets } from './assets'
import { useDocuments, type CommandResult } from './documents'

/**
 * Entity commands on the canvas selection (docs/spec/05-editing.md § Tools).
 * The UI, shortcuts and later the agent all go through these commands.
 */

function selectionArgs(): EntitiesArgs | null {
  const { documents, activeId, selection } = useDocuments.getState()
  const doc = documents.find((d) => d.id === activeId)
  if (!doc || selection.length === 0) return null
  if (getNode(doc.envelope, doc.activePath)?.kind !== 'blueprint') return null
  return { path: doc.activePath, indexes: selection, lookup: useAssets.getState().lookup }
}

function run<A extends EntitiesArgs>(
  command: Command<A>,
  extra: Omit<A, keyof EntitiesArgs>
): CommandResult {
  const args = selectionArgs()
  if (!args) return { ok: true, warnings: [] }
  return useDocuments.getState().runCommand(command, { ...args, ...extra } as A)
}

export function moveSelection(dx: number, dy: number): CommandResult {
  return run(moveEntities, { dx, dy })
}

export function rotateSelection(turn: Turn): CommandResult {
  return run(rotateEntities, { turn })
}

export function mirrorSelection(axis: MirrorAxis): CommandResult {
  return run(mirrorEntities, { axis })
}

export function deleteSelection(): CommandResult {
  return run(deleteEntities, {})
}

/** Tiles per move step: 2 when the selection holds rails, train stops or other rail-grid entities. */
export function moveStep(blueprint: Blueprint | null, selection: readonly number[]): number {
  const entities = blueprint?.entities ?? []
  const selected = selection.map((i) => entities[i]).filter((e) => e !== undefined)
  return selectionOnRailGrid(selected, useAssets.getState().lookup) ? 2 : 1
}
