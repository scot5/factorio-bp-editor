import { create } from 'zustand'
import { iconUrl } from '@core/assets'
import type { AssetStatus } from '@core/ipc'
import {
  dbPrototypeLookup,
  fallbackPrototypeLookup,
  iconCategoryFor,
  type IconCategory,
  type PrototypeDb,
  type PrototypeLookup
} from '@core/prototypes'

/**
 * Game data in the renderer: the main process's asset status, the prototype
 * database once loaded, and icon lookups. See docs/spec/03-game-assets.md.
 */
interface AssetsState {
  status: AssetStatus
  db: PrototypeDb | null
  lookup: PrototypeLookup
  /** Icon URL for a reference, or null when the icon is not available. */
  icon(kind: string | undefined, name: string): string | null
  init(): () => void
  load(): Promise<void>
  chooseGamePath(): Promise<boolean>
}

function iconResolver(db: PrototypeDb | null): AssetsState['icon'] {
  if (!db) return () => null
  const sets = new Map<IconCategory, Set<string>>()
  for (const [category, names] of Object.entries(db.icons)) {
    sets.set(category as IconCategory, new Set(names))
  }
  return (kind, name) => {
    const category = iconCategoryFor(kind)
    if (sets.get(category)?.has(name)) return iconUrl(category, name)
    // Items and entities usually share names; fall back to the other folder.
    const other: IconCategory | null =
      category === 'item' ? 'entity' : category === 'entity' ? 'item' : null
    return other && sets.get(other)?.has(name) ? iconUrl(other, name) : null
  }
}

export const useAssets = create<AssetsState>()((set, get) => {
  const applyStatus = async (status: AssetStatus): Promise<void> => {
    set({ status })
    if (status.state === 'ready' && !get().db) {
      const db = await window.api.assets.getDb()
      if (db) set({ db, lookup: dbPrototypeLookup(db), icon: iconResolver(db) })
    } else if (status.state !== 'ready' && get().db) {
      set({ db: null, lookup: fallbackPrototypeLookup, icon: iconResolver(null) })
    }
  }

  return {
    status: { state: 'detecting' },
    db: null,
    lookup: fallbackPrototypeLookup,
    icon: iconResolver(null),

    init() {
      const unsubscribe = window.api.assets.onStatus((status) => void applyStatus(status))
      void window.api.assets.getStatus().then(applyStatus)
      return unsubscribe
    },

    async load() {
      await applyStatus(await window.api.assets.load())
    },

    async chooseGamePath() {
      const ok = await window.api.assets.chooseGamePath()
      await applyStatus(await window.api.assets.getStatus())
      return ok
    }
  }
})
