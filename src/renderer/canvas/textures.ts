import { Rectangle, Texture } from 'pixi.js'

/**
 * Lazily loaded sprite sheets with sub-textures per frame rectangle, and an
 * LRU eviction once the decoded size exceeds a memory budget. See
 * docs/spec/03-game-assets.md § Texture loading.
 *
 * Images come from `factorio-asset://` and must be loaded with
 * `crossOrigin = 'anonymous'`, or WebGL refuses to upload them.
 */

export type FrameResult = Texture | 'loading' | 'failed'

interface Entry {
  state: 'loading' | 'ready' | 'failed'
  texture?: Texture
  width: number
  height: number
  bytes: number
  lastUsed: number
  frames: Map<string, Texture>
}

const DEFAULT_BUDGET = 512 * 1024 * 1024 // decoded RGBA bytes

export class TextureCache {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  private tick = 0
  private destroyed = false

  constructor(
    private readonly onLoad: () => void,
    private readonly budget = DEFAULT_BUDGET
  ) {}

  /** Marks the start of a frame; textures used before the next call are not evicted. */
  beginFrame(): void {
    this.tick++
  }

  /** The sub-texture for a source rectangle; starts loading the image on first use. */
  frame(url: string, rect: { x: number; y: number; w: number; h: number }): FrameResult {
    let entry = this.entries.get(url)
    if (!entry) {
      entry = this.load(url)
    }
    entry.lastUsed = this.tick
    if (entry.state !== 'ready') return entry.state
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`
    const cached = entry.frames.get(key)
    if (cached) return cached
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > entry.width || rect.y + rect.h > entry.height)
      return 'failed' // a resolver bug or unexpected sheet layout: fall back, don't draw garbage
    const texture = new Texture({
      source: entry.texture!.source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h)
    })
    entry.frames.set(key, texture)
    return texture
  }

  get loadedBytes(): number {
    return this.bytes
  }

  destroy(): void {
    this.destroyed = true
    for (const entry of this.entries.values()) this.release(entry)
    this.entries.clear()
    this.bytes = 0
  }

  private load(url: string): Entry {
    const entry: Entry = {
      state: 'loading',
      width: 0,
      height: 0,
      bytes: 0,
      lastUsed: this.tick,
      frames: new Map()
    }
    this.entries.set(url, entry)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = url
    image
      .decode()
      .then(() => {
        if (this.destroyed || this.entries.get(url) !== entry) return
        entry.texture = Texture.from(image)
        entry.width = image.naturalWidth
        entry.height = image.naturalHeight
        entry.bytes = entry.width * entry.height * 4
        entry.state = 'ready'
        this.bytes += entry.bytes
        this.evict()
        this.onLoad()
      })
      .catch(() => {
        if (this.entries.get(url) === entry) entry.state = 'failed'
      })
    return entry
  }

  /** Drops least recently used sheets (not used this frame) until under 80 % of the budget. */
  private evict(): void {
    if (this.bytes <= this.budget) return
    const candidates = [...this.entries]
      .filter(([, e]) => e.state === 'ready' && e.lastUsed < this.tick)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [url, entry] of candidates) {
      if (this.bytes <= this.budget * 0.8) break
      this.release(entry)
      this.bytes -= entry.bytes
      this.entries.delete(url)
    }
  }

  private release(entry: Entry): void {
    for (const t of entry.frames.values()) t.destroy(false)
    entry.frames.clear()
    entry.texture?.destroy(true)
  }
}
