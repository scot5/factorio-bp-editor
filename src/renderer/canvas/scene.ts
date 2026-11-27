import 'pixi.js/unsafe-eval' // Pixi without eval, so the strict CSP stays in place
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { directionVector, SpatialIndex, type Box, type Position } from '@core/geometry'
import type { BlueprintLayout, EntityLayout } from '@core/model'
import type { EntityCategory } from '@core/prototypes'
import { visibleBox, type Camera } from './camera'
import {
  BACKGROUND,
  BOX_SELECT_COLOR,
  CATEGORY_COLORS,
  CHUNK_COLOR,
  GRID_COLOR,
  HOVER_COLOR,
  SELECTION_COLOR,
  TILE_COLOR
} from './colors'

/**
 * Imperative PixiJS scene for one blueprint. React owns the data and calls
 * `setLayout`, `setCamera`, `setSelection`, `setHover`; the scene renders on
 * demand (no continuous ticker). See docs/spec/04-visualization.md.
 *
 * Layers (bottom to top): grid, tiles, entities, direction arrows, selection,
 * hover, box-select rectangle, labels (screen space).
 */

const INSET = 0.06 // gap between neighbouring footprints, in tiles
const ARROW_MIN_SCALE = 16 // px/tile: below this, arrows are skipped (LOD)
const LABEL_MIN_SCALE = 48
const MAX_LABELS = 400

export class Scene {
  readonly app = new Application()
  private readonly world = new Container()
  private readonly grid = new Graphics()
  private readonly tiles = new Graphics()
  private readonly entities = new Graphics()
  private readonly arrows = new Graphics()
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
      this.entities,
      this.arrows,
      this.selectionLayer,
      this.hoverLayer,
      this.boxSelect
    )
    host.appendChild(this.app.canvas)
    this.app.renderer.on('resize', () => this.invalidate())
    this.ready = true
    this.invalidate()
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.frame)
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
    this.index = new SpatialIndex<EntityLayout>()
    for (const e of layout?.entities ?? []) this.index.insert(e.box, e)
    this.drawTiles()
    this.drawEntities()
    this.drawSelection()
    this.drawHover()
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
      this.arrows.visible = scale >= ARROW_MIN_SCALE
      this.drawGrid()
      this.drawLabels()
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
    for (const [category, list] of byCategory) {
      for (const e of list) {
        const b = e.box
        body.rect(
          b.left + INSET,
          b.top + INSET,
          b.right - b.left - 2 * INSET,
          b.bottom - b.top - 2 * INSET
        )
      }
      body.fill({ color: CATEGORY_COLORS[category], alpha: category === 'unknown' ? 0.8 : 0.9 })
    }

    for (const e of layout.entities) {
      if (!e.directional) continue
      const { x, y } = directionVector(e.direction)
      const cx = (e.box.left + e.box.right) / 2
      const cy = (e.box.top + e.box.bottom) / 2
      const r = Math.min(e.box.right - e.box.left, e.box.bottom - e.box.top) * 0.3
      // Triangle pointing along the direction.
      const px = -y
      const py = x
      arrows
        .moveTo(cx + x * r, cy + y * r)
        .lineTo(cx - x * r * 0.6 + px * r * 0.7, cy - y * r * 0.6 + py * r * 0.7)
        .lineTo(cx - x * r * 0.6 - px * r * 0.7, cy - y * r * 0.6 - py * r * 0.7)
        .closePath()
    }
    arrows.fill({ color: 0x000000, alpha: 0.45 })
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

  private drawLabels(): void {
    const { scale } = this.camera
    let used = 0
    if (this.layout && scale >= LABEL_MIN_SCALE) {
      const visible = this.index.query(visibleBox(this.camera, this.width, this.height))
      if (visible.length <= MAX_LABELS) {
        for (const e of visible) {
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

function shortName(name: string): string {
  return name.replace(/-/g, ' ')
}
