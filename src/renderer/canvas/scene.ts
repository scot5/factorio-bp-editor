import 'pixi.js/unsafe-eval' // Pixi without eval, so the strict CSP stays in place
import {
  AlphaFilter,
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture
} from 'pixi.js'
import { directionVector, SpatialIndex, type Box, type Position } from '@core/geometry'
import type { BlueprintLayout, EntityLayout, TileLayout } from '@core/model'
import type { EntityCategory } from '@core/prototypes'
import {
  DRAW_LAYERS,
  wireCurve,
  type DrawLayer,
  type SpriteLayer,
  type WireSegment
} from '@core/sprites'
import { visibleBox, type Camera } from './camera'
import {
  BACKGROUND,
  BOX_SELECT_COLOR,
  CATEGORY_COLORS,
  CHUNK_COLOR,
  GRID_COLOR,
  HOVER_COLOR,
  SELECTION_COLOR,
  TILE_COLOR,
  WIRE_COLORS
} from './colors'
import { TextureCache } from './textures'

/**
 * Imperative PixiJS scene for one blueprint. React owns the data and calls
 * `setLayout`, `setCamera`, `setSelection`, `setHover`; the scene renders on
 * demand (no continuous ticker). See docs/spec/04-visualization.md.
 *
 * Layers (bottom to top): grid, tile colours, tile sprites, footprints,
 * sprite passes (rail stone paths … rail metals, ground patches,
 * lower objects, shadows, the body passes by render layer, elevated rails,
 * elevated objects: see POOL_ORDER; each pass in entity y order), wires, icons,
 * direction arrows, selection, hover, box-select rectangle, labels (screen
 * space).
 *
 * Level of detail: from SPRITE_MIN_SCALE px/tile up, entities with game
 * graphics are drawn as sprites and the rest keep footprints and icons
 * (rebuilt per frame for the visible ones), and tiles get their sprites.
 * Below it, one static footprint path is drawn for all entities. Wires are
 * drawn from the same zoom up, in both modes.
 */

const INSET = 0.06 // gap between neighbouring footprints, in tiles
const ARROW_MIN_SCALE = 16 // px/tile: below this, arrows are skipped (LOD)
const LABEL_MIN_SCALE = 48
const MAX_LABELS = 400
const ICON_MIN_SCALE = 10 // px/tile
const MAX_ICONS = 4000
const SPRITE_MIN_SCALE = 16 // px/tile (spec 04: 1/4 zoom)
const MAX_SPRITE_ENTITIES = 6000
const MAX_TILE_SPRITES = 20000
const SPRITE_MARGIN = 3 // tiles: sprites overhang their footprint (tall poles, shadows)
const WIRE_MIN_SCALE = 16 // px/tile (spec 04: no wires below 1/4 zoom)
const WIRE_WIDTH = 1.5 // screen px, at least
const WIRE_WIDTH_PER_PX = 0.04 // wider when zoomed in: tiles (×px/tile), up to 4 px
const WIRE_SEGMENT_PX = 10 // screen px per straight piece of a sagging wire
const MAX_WIRES = 20000 // visible wires drawn per frame; more are skipped
const HIGHLIGHT_HALO = 0xffffff // behind highlighted wires
const HIGHLIGHT_HALO_PX = 3 // screen px of halo around a highlighted wire
const PX_PER_TILE_AT_SCALE_1 = 32 // Factorio sprites: 32 px per tile at scale 1
/**
 * Shadows are drawn as one group at this opacity, like the game's shadow pass,
 * so overlapping shadows do not get darker.
 */
const SHADOW_ALPHA = 0.5

/** Icon URL for an entity, or null when it has none. */
export type IconSource = (entity: EntityLayout) => string | null

/** Game graphics for a blueprint (null when there is no game data). */
export interface SpriteSource {
  /** Sprite layers for an entity, or null when it has no graphics (footprint fallback). */
  entity: (entity: EntityLayout) => readonly SpriteLayer[] | null
  /** The sprite for a tile, or null when it has none (flat colour). */
  tile: (tile: TileLayout) => SpriteLayer | null
}

interface SpritePool {
  container: Container
  sprites: Sprite[]
  used: number
}

const newPool = (): SpritePool => ({ container: new Container(), sprites: [], used: 0 })

/** Sprite passes, bottom to top: the draw layers with the shadow pass above `lower-object`. */
type PoolName = DrawLayer | 'shadow'
const POOL_ORDER: readonly PoolName[] = DRAW_LAYERS.flatMap((l): PoolName[] =>
  l === 'lower-object' ? [l, 'shadow'] : [l]
)

/** The pass a layer is drawn in. Shadows always go to the shadow pass. */
function poolOf(layer: SpriteLayer): PoolName {
  if (layer.layer) return layer.shadow ? 'shadow' : layer.layer
  return layer.ground ? 'ground' : layer.shadow ? 'shadow' : 'object'
}

export class Scene {
  readonly app = new Application()
  private readonly world = new Container()
  private readonly grid = new Graphics()
  private readonly tiles = new Graphics()
  private readonly entities = new Graphics()
  private readonly arrows = new Graphics()
  private readonly icons = new Container()
  private readonly iconPool: Sprite[] = []
  private readonly textures = new Map<string, Texture | 'loading' | 'failed'>()
  private iconSource: IconSource | null = null
  private spriteSource: SpriteSource | null = null
  private readonly spriteLayers = new Map<EntityLayout, readonly SpriteLayer[] | null>()
  private readonly spriteTextures = new TextureCache(() => this.invalidate())
  private readonly pools = new Map<PoolName, SpritePool>(POOL_ORDER.map((n) => [n, newPool()]))
  /** Tile sprites, above the flat tile colours (which show while sheets load). */
  private readonly tilePool = newPool()
  private readonly tileLayers = new Map<TileLayout, SpriteLayer | null>()
  private tileIndex = new SpatialIndex<TileLayout>()
  private readonly wireLayer = new Graphics()
  private wireIndex = new SpatialIndex<WireSegment>()
  private wiresByIndex = new Map<number, WireSegment>()
  /** A circuit network picked in the Analysis tab, drawn over everything at any zoom. */
  private readonly wireHighlightLayer = new Graphics()
  private wireHighlight: readonly number[] = []
  /** Per-frame footprints and arrows of visible entities not drawn as sprites. */
  private readonly detail = new Graphics()
  private readonly detailArrows = new Graphics()
  private readonly selectionLayer = new Graphics()
  private readonly hoverLayer = new Graphics()
  private readonly boxSelect = new Graphics()
  private readonly labels = new Container()
  private readonly labelPool: Text[] = []
  private readonly labelStyle = new TextStyle({
    fontFamily: 'system-ui, Segoe UI, sans-serif',
    fontSize: 11,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 3 },
    align: 'center'
  })

  private layout: BlueprintLayout | null = null
  private index = new SpatialIndex<EntityLayout>()
  private camera: Camera = { x: 0, y: 0, scale: 32 }
  private selection = new Set<number>()
  private hover: number | null = null
  private frame = 0
  private ready = false
  private destroyed = false

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: BACKGROUND,
      antialias: true,
      autoStart: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl'
    })
    if (this.destroyed) {
      this.app.destroy(true)
      return
    }
    this.app.stage.addChild(this.grid, this.world, this.labels)
    this.world.addChild(
      this.tiles,
      this.tilePool.container,
      this.entities,
      this.detail,
      ...[...this.pools.values()].map((p) => p.container),
      this.wireLayer,
      this.icons,
      this.arrows,
      this.detailArrows,
      this.selectionLayer,
      this.wireHighlightLayer,
      this.hoverLayer,
      this.boxSelect
    )
    this.pools.get('shadow')!.container.filters = [new AlphaFilter({ alpha: SHADOW_ALPHA })]
    host.appendChild(this.app.canvas)
    this.app.renderer.on('resize', () => this.invalidate())
    this.ready = true
    this.invalidate()
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.frame)
    for (const pool of [...this.pools.values(), this.tilePool])
      for (const sprite of pool.sprites) sprite.texture = Texture.EMPTY
    this.spriteTextures.destroy()
    if (this.ready) this.app.destroy(true, { children: true })
  }

  get width(): number {
    return this.ready ? this.app.renderer.width / this.app.renderer.resolution : 0
  }

  get height(): number {
    return this.ready ? this.app.renderer.height / this.app.renderer.resolution : 0
  }

  setLayout(layout: BlueprintLayout | null): void {
    this.layout = layout
    this.spriteLayers.clear()
    this.tileLayers.clear()
    this.index = new SpatialIndex<EntityLayout>()
    for (const e of layout?.entities ?? []) this.index.insert(e.box, e)
    this.tileIndex = new SpatialIndex<TileLayout>()
    for (const t of layout?.tiles ?? [])
      this.tileIndex.insert({ left: t.x, top: t.y, right: t.x + 1, bottom: t.y + 1 }, t)
    this.drawTiles()
    this.drawEntities()
    this.drawSelection()
    this.drawHover()
    this.invalidate()
  }

  /** Wires with their world end points (see `wireSegments`). */
  setWires(wires: readonly WireSegment[]): void {
    this.wireIndex = new SpatialIndex<WireSegment>()
    this.wiresByIndex = new Map()
    for (const w of wires) {
      this.wireIndex.insert(w.box, w)
      this.wiresByIndex.set(w.wire.index, w)
    }
    this.invalidate()
  }

  /** Wires to highlight, as indexes into the blueprint's `wires` (a circuit network). */
  setWireHighlight(indexes: readonly number[]): void {
    this.wireHighlight = indexes
    this.invalidate()
  }

  /** Where entity icons come from; null shows footprints only (no game data). */
  setIconSource(source: IconSource | null): void {
    this.iconSource = source
    this.invalidate()
  }

  /** Where entity sprites come from; null draws no sprites (no game data). */
  setSpriteSource(source: SpriteSource | null): void {
    this.spriteSource = source
    this.spriteLayers.clear()
    this.tileLayers.clear()
    this.invalidate()
  }

  setCamera(camera: Camera): void {
    this.camera = camera
    this.invalidate()
  }

  setSelection(indexes: readonly number[]): void {
    this.selection = new Set(indexes)
    this.drawSelection()
    this.invalidate()
  }

  setHover(index: number | null): void {
    if (index === this.hover) return
    this.hover = index
    this.drawHover()
    this.invalidate()
  }

  /** Box-select rectangle in world coordinates, or null to hide it. */
  setBoxSelect(box: Box | null): void {
    this.boxSelect.clear()
    if (box) {
      this.boxSelect
        .rect(box.left, box.top, box.right - box.left, box.bottom - box.top)
        .fill({ color: BOX_SELECT_COLOR, alpha: 0.12 })
        .stroke({ color: BOX_SELECT_COLOR, width: 1, pixelLine: true })
    }
    this.invalidate()
  }

  /** Topmost (smallest) entity at a world position. */
  hitTest(p: Position): EntityLayout | undefined {
    const hits = this.index.queryPoint(p)
    let best: EntityLayout | undefined
    for (const h of hits) {
      const area = (h.box.right - h.box.left) * (h.box.bottom - h.box.top)
      const bestArea = best
        ? (best.box.right - best.box.left) * (best.box.bottom - best.box.top)
        : Infinity
      if (area < bestArea) best = h
    }
    return best
  }

  /** Entities overlapping a world box. */
  queryBox(box: Box): EntityLayout[] {
    return this.index.query(box)
  }

  // -------------------------------------------------------------------------

  private invalidate(): void {
    if (!this.ready || this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.ready) return
      const { x, y, scale } = this.camera
      this.world.position.set(-x * scale, -y * scale)
      this.world.scale.set(scale)
      this.drawGrid()
      let withSprites = new Set<EntityLayout>()
      let spriteMode = false
      try {
        ;[spriteMode, withSprites] = this.drawSprites()
      } catch (error) {
        // A bad sprite must never stop the rest of the frame from rendering.
        console.error('Sprite rendering failed', error)
        this.spriteSource = null
        for (const pool of [...this.pools.values(), this.tilePool]) this.finishPool(pool, 0)
      }
      this.drawDetail(spriteMode, withSprites)
      this.drawWires()
      let withIcons = new Set<EntityLayout>()
      try {
        withIcons = this.drawIcons(withSprites)
      } catch (error) {
        // A bad icon must never stop the rest of the frame from rendering.
        console.error('Icon rendering failed', error)
        this.iconSource = null
        for (const sprite of this.iconPool) sprite.visible = false
      }
      this.drawLabels(withIcons, withSprites)
      this.app.render()
    })
  }

  private drawGrid(): void {
    const g = this.grid
    g.clear()
    const { scale } = this.camera
    const view = visibleBox(this.camera, this.width, this.height)
    const toScreen = (wx: number, wy: number): [number, number] => [
      (wx - this.camera.x) * scale,
      (wy - this.camera.y) * scale
    ]
    // Tile lines only when they are at least 8 px apart; chunk lines (32 tiles) always.
    const step = scale >= 8 ? 1 : 32
    for (const [color, every] of [
      [GRID_COLOR, step],
      [CHUNK_COLOR, 32]
    ] as const) {
      if (every === 1 && step !== 1) continue
      for (let x = Math.floor(view.left / every) * every; x <= view.right; x += every) {
        if (color === GRID_COLOR && x % 32 === 0) continue
        const [sx] = toScreen(x, 0)
        g.moveTo(sx, 0).lineTo(sx, this.height)
      }
      for (let y = Math.floor(view.top / every) * every; y <= view.bottom; y += every) {
        if (color === GRID_COLOR && y % 32 === 0) continue
        const [, sy] = toScreen(0, y)
        g.moveTo(0, sy).lineTo(this.width, sy)
      }
      g.stroke({ color, width: 1, pixelLine: true })
    }
  }

  private drawTiles(): void {
    const g = this.tiles
    g.clear()
    const tiles = this.layout?.tiles ?? []
    if (!tiles.length) return
    for (const t of tiles) g.rect(t.x, t.y, 1, 1)
    g.fill({ color: TILE_COLOR })
  }

  private drawEntities(): void {
    const body = this.entities
    const arrows = this.arrows
    body.clear()
    arrows.clear()
    const layout = this.layout
    if (!layout) return

    // One path per category: few draw calls even for 20k entities.
    const byCategory = new Map<EntityCategory, EntityLayout[]>()
    for (const e of layout.entities) {
      const list = byCategory.get(e.category)
      if (list) list.push(e)
      else byCategory.set(e.category, [e])
    }
    for (const [category, list] of byCategory) fillFootprints(body, category, list)
    strokeArrows(arrows, layout.entities)
  }

  /**
   * Draws sprites for visible entities that have graphics. Returns whether
   * sprite mode is active (zoomed in, not too many entities) and which
   * entities were drawn, so footprints, icons and labels skip them. An entity
   * whose sheets are still loading keeps its footprint until they arrive.
   */
  private drawSprites(): [boolean, Set<EntityLayout>] {
    const drawn = new Set<EntityLayout>()
    const pools = this.pools
    for (const pool of pools.values()) pool.used = 0
    const source = this.spriteSource
    let active = false
    if (source && this.layout && this.camera.scale >= SPRITE_MIN_SCALE) {
      const view = visibleBox(this.camera, this.width, this.height)
      const visible = this.index.query({
        left: view.left - SPRITE_MARGIN,
        top: view.top - SPRITE_MARGIN,
        right: view.right + SPRITE_MARGIN,
        bottom: view.bottom + SPRITE_MARGIN
      })
      if (visible.length <= MAX_SPRITE_ENTITIES) {
        active = true
        this.spriteTextures.beginFrame()
        this.drawTileSprites(source, view)
        // Bodies in y order, so entities lower on screen overlap the ones behind.
        visible.sort(
          (a, b) => a.box.top + a.box.bottom - (b.box.top + b.box.bottom) || a.index - b.index
        )
        for (const e of visible) {
          let layers = this.spriteLayers.get(e)
          if (layers === undefined) {
            layers = source.entity(e)
            this.spriteLayers.set(e, layers)
          }
          if (!layers || layers.length === 0) continue
          const textures = layers.map((l) => this.spriteTextures.frame(l.url, l.rect))
          if (textures.includes('loading')) continue
          const cx = (e.box.left + e.box.right) / 2
          const cy = (e.box.top + e.box.bottom) / 2
          let any = false
          layers.forEach((layer, i) => {
            const texture = textures[i]!
            if (texture === 'failed' || texture === 'loading') return
            const pool = pools.get(poolOf(layer))!
            const sprite = pool.sprites[pool.used] ?? this.createSprite(pool)
            pool.used++
            sprite.texture = texture
            sprite.position.set(cx + layer.shift[0], cy + layer.shift[1])
            const s = layer.scale / PX_PER_TILE_AT_SCALE_1
            sprite.scale.set(s, s * (layer.squash ?? 1))
            sprite.anchor.set(layer.anchor?.[0] ?? 0.5, layer.anchor?.[1] ?? 0.5)
            sprite.rotation = layer.rotation ?? 0
            sprite.tint = layer.tint ? rgb(layer.tint) : 0xffffff
            sprite.alpha = layer.tint ? layer.tint[3] : 1
            sprite.blendMode = layer.additive ? 'add' : 'normal'
            sprite.visible = true
            any = true
          })
          if (any) drawn.add(e)
        }
      }
    }
    for (const pool of pools.values()) this.finishPool(pool, pool.used)
    if (!active) this.tilePool.used = 0
    this.finishPool(this.tilePool, this.tilePool.used)
    return [active, drawn]
  }

  /** Tile sprites for the visible tiles, when there are not too many. */
  private drawTileSprites(source: SpriteSource, view: Box): void {
    const pool = this.tilePool
    pool.used = 0
    const visible = this.tileIndex.query(view)
    if (visible.length > MAX_TILE_SPRITES) return
    for (const t of visible) {
      let layer = this.tileLayers.get(t)
      if (layer === undefined) {
        layer = source.tile(t)
        this.tileLayers.set(t, layer)
      }
      if (!layer) continue
      const texture = this.spriteTextures.frame(layer.url, layer.rect)
      if (texture === 'loading' || texture === 'failed') continue
      const sprite = pool.sprites[pool.used] ?? this.createSprite(pool)
      pool.used++
      sprite.texture = texture
      sprite.position.set(t.x + 0.5, t.y + 0.5)
      sprite.scale.set(layer.scale / PX_PER_TILE_AT_SCALE_1)
      sprite.anchor.set(0.5)
      sprite.rotation = 0
      sprite.tint = 0xffffff
      sprite.alpha = 1
      sprite.blendMode = 'normal'
      sprite.visible = true
    }
  }

  /**
   * Wires whose curve box meets the view (a wire can cross it with both ends
   * outside), one path per colour, at a fixed screen width. The drawn count
   * is on the canvas as `data-wires`, for tests.
   */
  private drawWires(): void {
    const g = this.wireLayer
    g.clear()
    let drawn = 0
    const { scale } = this.camera
    const visible =
      scale >= WIRE_MIN_SCALE
        ? this.wireIndex.query(visibleBox(this.camera, this.width, this.height))
        : []
    if (visible.length <= MAX_WIRES)
      for (const color of ['copper', 'red', 'green'] as const)
        drawn += strokeWires(g, visible, color, scale)
    this.app.canvas.dataset['wires'] = String(drawn)
    this.drawWireHighlight()
  }

  /**
   * The highlighted wires with a light halo, wider than normal wires and at
   * any zoom (a network is worth seeing when zoomed out). The count is on the
   * canvas as `data-wire-highlight`, for tests.
   */
  private drawWireHighlight(): void {
    const g = this.wireHighlightLayer
    g.clear()
    const { scale } = this.camera
    const wires = this.wireHighlight
      .slice(0, MAX_WIRES)
      .map((i) => this.wiresByIndex.get(i))
      .filter((w) => w !== undefined)
    const width = Math.min(Math.max(WIRE_WIDTH, scale * WIRE_WIDTH_PER_PX), 4) / scale
    if (wires.length) {
      for (const w of wires) strokeWire(g, w, scale)
      const halo = width * 1.5 + HIGHLIGHT_HALO_PX / scale
      g.stroke({ color: HIGHLIGHT_HALO, alpha: 0.7, width: halo, cap: 'round', join: 'round' })
      for (const color of ['red', 'green', 'copper'] as const) {
        let any = false
        for (const w of wires)
          if (w.color === color) {
            strokeWire(g, w, scale)
            any = true
          }
        if (any)
          g.stroke({ color: WIRE_COLORS[color], width: width * 1.5, cap: 'round', join: 'round' })
      }
    }
    this.app.canvas.dataset['wireHighlight'] = String(wires.length)
  }

  private createSprite(pool: SpritePool): Sprite {
    const sprite = new Sprite()
    sprite.anchor.set(0.5)
    pool.container.addChild(sprite)
    pool.sprites.push(sprite)
    return sprite
  }

  /** Hides unused pool sprites and drops their textures (which may be evicted later). */
  private finishPool(pool: SpritePool, used: number): void {
    for (let i = used; i < pool.sprites.length; i++) {
      const sprite = pool.sprites[i]!
      if (!sprite.visible) continue
      sprite.visible = false
      sprite.texture = Texture.EMPTY
    }
  }

  /**
   * In sprite mode the static footprint path is hidden; footprints and arrows
   * are drawn here for the visible entities without a sprite.
   */
  private drawDetail(spriteMode: boolean, withSprites: ReadonlySet<EntityLayout>): void {
    const g = this.detail
    const arrows = this.detailArrows
    g.clear()
    arrows.clear()
    this.entities.visible = !spriteMode
    this.arrows.visible = !spriteMode && this.camera.scale >= ARROW_MIN_SCALE
    g.visible = spriteMode
    arrows.visible = spriteMode
    if (!spriteMode || !this.layout) return
    const visible = this.index.query(visibleBox(this.camera, this.width, this.height))
    const byCategory = new Map<EntityCategory, EntityLayout[]>()
    const withArrows: EntityLayout[] = []
    for (const e of visible) {
      if (withSprites.has(e)) continue
      const list = byCategory.get(e.category)
      if (list) list.push(e)
      else byCategory.set(e.category, [e])
      withArrows.push(e)
    }
    for (const [category, list] of byCategory) fillFootprints(g, category, list)
    strokeArrows(arrows, withArrows)
  }

  private drawSelection(): void {
    const g = this.selectionLayer
    g.clear()
    const entities = this.layout?.entities ?? []
    let any = false
    for (const i of this.selection) {
      const e = entities[i]
      if (!e) continue
      g.rect(e.box.left, e.box.top, e.box.right - e.box.left, e.box.bottom - e.box.top)
      any = true
    }
    if (any) {
      g.fill({ color: SELECTION_COLOR, alpha: 0.25 })
      g.stroke({ color: SELECTION_COLOR, width: 0.08, alignment: 1 }) // width in tiles
    }
  }

  private drawHover(): void {
    const g = this.hoverLayer
    g.clear()
    const e = this.hover === null ? undefined : this.layout?.entities[this.hover]
    if (!e) return
    g.rect(e.box.left, e.box.top, e.box.right - e.box.left, e.box.bottom - e.box.top).stroke({
      color: HOVER_COLOR,
      width: 1,
      pixelLine: true
    })
  }

  private drawLabels(
    withIcons: ReadonlySet<EntityLayout>,
    withSprites: ReadonlySet<EntityLayout>
  ): void {
    const { scale } = this.camera
    let used = 0
    if (this.layout && scale >= LABEL_MIN_SCALE) {
      const visible = this.index.query(visibleBox(this.camera, this.width, this.height))
      if (visible.length <= MAX_LABELS) {
        for (const e of visible) {
          if (withIcons.has(e) || withSprites.has(e)) continue // the picture says what it is
          const width = (e.box.right - e.box.left) * scale
          if (width < 40) continue // too small to hold text
          const label = this.labelPool[used] ?? this.createLabel()
          label.text = shortName(e.entity.name)
          label.style.wordWrapWidth = width - 4
          label.position.set(
            ((e.box.left + e.box.right) / 2 - this.camera.x) * scale,
            ((e.box.top + e.box.bottom) / 2 - this.camera.y) * scale
          )
          label.visible = true
          used++
        }
      }
    }
    for (let i = used; i < this.labelPool.length; i++) this.labelPool[i]!.visible = false
  }

  /** Draws icons for visible entities; returns the entities that got one. */
  private drawIcons(withSprites: ReadonlySet<EntityLayout>): Set<EntityLayout> {
    const drawn = new Set<EntityLayout>()
    const source = this.iconSource
    let used = 0
    if (source && this.layout && this.camera.scale >= ICON_MIN_SCALE) {
      const visible = this.index.query(visibleBox(this.camera, this.width, this.height))
      if (visible.length <= MAX_ICONS) {
        for (const e of visible) {
          if (withSprites.has(e)) continue
          const url = source(e)
          const texture = url ? this.texture(url) : null
          if (!texture) continue
          const sprite = this.iconPool[used] ?? this.createIcon()
          const w = e.box.right - e.box.left
          const h = e.box.bottom - e.box.top
          const size = Math.min(Math.min(w, h) * 0.72, 3)
          sprite.texture = texture
          sprite.width = size
          sprite.height = size
          sprite.position.set(e.box.left + w / 2, e.box.top + h / 2)
          sprite.visible = true
          drawn.add(e)
          used++
        }
      }
    }
    for (let i = used; i < this.iconPool.length; i++) this.iconPool[i]!.visible = false
    return drawn
  }

  private createIcon(): Sprite {
    const sprite = new Sprite()
    sprite.anchor.set(0.5)
    this.icons.addChild(sprite)
    this.iconPool.push(sprite)
    return sprite
  }

  /** Texture for an icon URL; starts loading on first use and returns null until ready. */
  private texture(url: string): Texture | null {
    const cached = this.textures.get(url)
    if (cached instanceof Texture) return cached
    if (cached) return null // loading or failed
    this.textures.set(url, 'loading')
    const image = new Image()
    image.crossOrigin = 'anonymous' // required for WebGL upload (protocol sends CORS headers)
    image.src = url
    image
      .decode()
      .then(() => {
        if (this.destroyed) return
        this.textures.set(url, Texture.from(image))
        this.invalidate()
      })
      .catch(() => this.textures.set(url, 'failed'))
    return null
  }

  private createLabel(): Text {
    const label = new Text({ text: '', style: this.labelStyle.clone() })
    label.style.wordWrap = true
    label.style.breakWords = true
    label.anchor.set(0.5)
    this.labels.addChild(label)
    this.labelPool.push(label)
    return label
  }
}

/** Strokes the wires of one colour as one path; returns how many there were. */
function strokeWires(
  g: Graphics,
  wires: readonly WireSegment[],
  color: WireSegment['color'],
  scale: number
): number {
  let count = 0
  for (const w of wires) {
    if (w.color !== color) continue
    strokeWire(g, w, scale)
    count++
  }
  if (count)
    g.stroke({
      color: WIRE_COLORS[color],
      width: Math.min(Math.max(WIRE_WIDTH, scale * WIRE_WIDTH_PER_PX), 4) / scale,
      cap: 'round',
      join: 'round'
    })
  return count
}

/**
 * A wire's sagging curve as straight pieces about WIRE_SEGMENT_PX long on
 * screen (Pixi's own Bézier tessellation is too coarse in tile units).
 */
function strokeWire(g: Graphics, w: WireSegment, scale: number): void {
  const [a, b] = [w.a, w.b]
  const [c1, c2] = wireCurve(a, b)
  g.moveTo(a[0], a[1])
  const sags = c1[0] !== a[0] + (b[0] - a[0]) / 5 || c1[1] !== a[1] + (b[1] - a[1]) / 5
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * scale
  const n = sags ? Math.min(Math.max(Math.ceil(length / WIRE_SEGMENT_PX), 2), 32) : 1
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    const k0 = u * u * u
    const k1 = 3 * u * u * t
    const k2 = 3 * u * t * t
    const k3 = t * t * t
    g.lineTo(
      k0 * a[0] + k1 * c1[0] + k2 * c2[0] + k3 * b[0],
      k0 * a[1] + k1 * c1[1] + k2 * c2[1] + k3 * b[1]
    )
  }
}

function rgb([r, g, b]: readonly number[]): number {
  return (Math.round(r! * 255) << 16) | (Math.round(g! * 255) << 8) | Math.round(b! * 255)
}

function fillFootprints(
  g: Graphics,
  category: EntityCategory,
  list: readonly EntityLayout[]
): void {
  for (const e of list) {
    const b = e.box
    g.rect(
      b.left + INSET,
      b.top + INSET,
      b.right - b.left - 2 * INSET,
      b.bottom - b.top - 2 * INSET
    )
  }
  g.fill({ color: CATEGORY_COLORS[category], alpha: category === 'unknown' ? 0.8 : 0.9 })
}

/**
 * Small arrows at the leading edge of each footprint, so they stay visible on
 * top of icons (which cover the centre). Light fill + dark outline reads on
 * every category colour, on icons and on sprites.
 */
function strokeArrows(g: Graphics, entities: readonly EntityLayout[]): void {
  let any = false
  for (const e of entities) {
    if (!e.directional) continue
    const { x, y } = directionVector(e.direction)
    const w = e.box.right - e.box.left
    const h = e.box.bottom - e.box.top
    const r = Math.min(w, h) * 0.16
    // Distance from the centre to the edge along the direction, minus a margin.
    const reach = Math.min(
      Math.abs(x) > 1e-9 ? w / 2 / Math.abs(x) : Infinity,
      Math.abs(y) > 1e-9 ? h / 2 / Math.abs(y) : Infinity
    )
    const tipDistance = reach - INSET - r * 0.25
    const cx = (e.box.left + e.box.right) / 2 + x * (tipDistance - r)
    const cy = (e.box.top + e.box.bottom) / 2 + y * (tipDistance - r)
    const px = -y
    const py = x
    g.moveTo(cx + x * r, cy + y * r)
      .lineTo(cx - x * r * 0.6 + px * r * 0.8, cy - y * r * 0.6 + py * r * 0.8)
      .lineTo(cx - x * r * 0.6 - px * r * 0.8, cy - y * r * 0.6 - py * r * 0.8)
      .closePath()
    any = true
  }
  if (!any) return
  g.fill({ color: 0xf2f2f2, alpha: 0.95 })
  g.stroke({ color: 0x000000, width: 1, pixelLine: true, alpha: 0.8 })
}

function shortName(name: string): string {
  return name.replace(/-/g, ' ')
}
