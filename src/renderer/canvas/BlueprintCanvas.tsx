import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Box, Position } from '@core/geometry'
import type { BlueprintLayout, EntityLayout } from '@core/model'
import type { WireSegment } from '@core/sprites'
import { fitBox, screenToWorld, zoomAt, type Camera } from './camera'
import { Scene, type DiffOverlay, type IconSource, type SpriteSource } from './scene'

export interface CanvasHover {
  entity: EntityLayout
  screen: Position
}

interface Props {
  layout: BlueprintLayout | null
  selection: readonly number[]
  /** Changes when a different blueprint is shown; the view is re-fitted. */
  viewKey: string
  onSelect(indexes: number[], mode: 'replace' | 'add' | 'toggle'): void
  /** Dragging the selection: whole-tile offset, a multiple of `moveStep`. */
  onMove(dx: number, dy: number): void
  /** Tiles per move step (2 with rail-grid entities selected). */
  moveStep: number
  onHover(hover: CanvasHover | null): void
  onCursor(tile: Position | null): void
  onZoom(scale: number): void
  /** Incremented by the toolbar to request "fit to blueprint". */
  fitRequest: number
  /** Entity icons from game data, or null for plain footprints. */
  iconSource: IconSource | null
  /** Entity sprites from game data, or null for footprints and icons only. */
  spriteSource: SpriteSource | null
  /** Wires to draw, with their world end points. */
  wires: readonly WireSegment[]
  /** Wires to highlight (indexes into the blueprint's `wires`). */
  wireHighlight: readonly number[]
  /** Diff overlay, or null when not comparing. */
  diff: DiffOverlay | null
}

interface MoveDrag {
  start: Position
  startWorld: Position
  offset: Position
}

const DRAG_THRESHOLD = 4 // px before a press becomes a drag
const PAN_STEP = 0.15 // fraction of the view per arrow key press

/**
 * Canvas viewport: left-drag box select (Shift adds, Ctrl toggles), click
 * select, dragging a selected entity moves the selection, middle/right-drag or
 * Space+drag pan, wheel zoom at cursor, arrow keys pan, F fits (when nothing is
 * selected; F mirrors a selection). See docs/spec/04-visualization.md
 * § Interaction and 05 § Tools.
 */
export function BlueprintCanvas(props: Props): React.JSX.Element {
  const {
    layout,
    selection,
    viewKey,
    fitRequest,
    iconSource,
    spriteSource,
    wires,
    wireHighlight,
    diff
  } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, scale: 32 })
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })
  const [ready, setReady] = useState(false)

  const setCamera = useCallback((camera: Camera) => {
    cameraRef.current = camera
    sceneRef.current?.setCamera(camera)
    propsRef.current.onZoom(camera.scale)
  }, [])

  const fit = useCallback(() => {
    const scene = sceneRef.current
    if (!scene) return
    setCamera(fitBox(propsRef.current.layout?.bounds ?? null, scene.width, scene.height))
  }, [setCamera])

  // Create / destroy the Pixi scene.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new Scene()
    sceneRef.current = scene
    void scene.init(host).then(() => {
      if (sceneRef.current === scene) setReady(true)
    })
    return () => {
      sceneRef.current = null
      scene.destroy()
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    sceneRef.current?.setLayout(layout)
  }, [ready, layout])

  // Re-fit when a different blueprint is shown or the toolbar asks for it.
  useEffect(() => {
    if (ready) fit()
  }, [ready, viewKey, fitRequest, fit])

  useEffect(() => {
    if (ready) sceneRef.current?.setSelection(selection)
  }, [ready, selection])

  useEffect(() => {
    if (ready) sceneRef.current?.setIconSource(iconSource)
  }, [ready, iconSource])

  useEffect(() => {
    if (ready) sceneRef.current?.setSpriteSource(spriteSource)
  }, [ready, spriteSource])

  useEffect(() => {
    if (ready) sceneRef.current?.setWires(wires)
  }, [ready, wires])

  useEffect(() => {
    if (ready) sceneRef.current?.setWireHighlight(wireHighlight)
  }, [ready, wireHighlight])

  useEffect(() => {
    if (ready) sceneRef.current?.setDiff(diff)
  }, [ready, diff])

  // ---------------------------------------------------------------------------
  // Pointer input

  const drag = useRef<
    | {
        kind: 'pending' | 'box'
        start: Position
        startWorld: Position
        mode: 'replace' | 'add' | 'toggle'
      }
    | { kind: 'pan'; last: Position }
    | (MoveDrag & { kind: 'pending-move' })
    | (MoveDrag & { kind: 'move' })
    | null
  >(null)
  const spaceDown = useRef(false)

  const local = (event: { clientX: number; clientY: number }): Position => {
    const rect = hostRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: React.PointerEvent): void => {
    hostRef.current?.focus()
    const p = local(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.button === 1 || event.button === 2 || (event.button === 0 && spaceDown.current)) {
      drag.current = { kind: 'pan', last: p }
      return
    }
    if (event.button !== 0) return
    const mode = event.shiftKey ? 'add' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace'
    const startWorld = screenToWorld(cameraRef.current, p.x, p.y)
    const hit = sceneRef.current?.hitTest(startWorld)
    if (mode === 'replace' && hit && propsRef.current.selection.includes(hit.index)) {
      drag.current = { kind: 'pending-move', start: p, startWorld, offset: { x: 0, y: 0 } }
      return
    }
    drag.current = {
      kind: 'pending',
      start: p,
      startWorld: screenToWorld(cameraRef.current, p.x, p.y),
      mode
    }
  }

  const onPointerMove = (event: React.PointerEvent): void => {
    const scene = sceneRef.current
    if (!scene) return
    const p = local(event)
    const world = screenToWorld(cameraRef.current, p.x, p.y)
    propsRef.current.onCursor({ x: Math.floor(world.x), y: Math.floor(world.y) })

    const d = drag.current
    if (d?.kind === 'pan') {
      const c = cameraRef.current
      setCamera({ ...c, x: c.x - (p.x - d.last.x) / c.scale, y: c.y - (p.y - d.last.y) / c.scale })
      d.last = p
      return
    }
    if (d?.kind === 'pending-move' || d?.kind === 'move') {
      if (
        d.kind === 'pending-move' &&
        Math.hypot(p.x - d.start.x, p.y - d.start.y) <= DRAG_THRESHOLD
      )
        return
      d.kind = 'move'
      const step = propsRef.current.moveStep
      const snap = (v: number): number => Math.round(v / step) * step + 0
      d.offset = { x: snap(world.x - d.startWorld.x), y: snap(world.y - d.startWorld.y) }
      scene.setMoveOffset(d.offset)
      scene.setHover(null)
      propsRef.current.onHover(null)
      return
    }
    if (d && (d.kind === 'box' || Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_THRESHOLD)) {
      d.kind = 'box'
      scene.setBoxSelect(boxOf(d.startWorld, world))
      scene.setHover(null)
      propsRef.current.onHover(null)
      return
    }
    const hit = scene.hitTest(world)
    scene.setHover(hit?.index ?? null)
    propsRef.current.onHover(hit ? { entity: hit, screen: p } : null)
  }

  const onPointerUp = (event: React.PointerEvent): void => {
    const scene = sceneRef.current
    const d = drag.current
    drag.current = null
    if (!scene || !d || d.kind === 'pan') return
    const p = local(event)
    const world = screenToWorld(cameraRef.current, p.x, p.y)
    if (d.kind === 'move' || d.kind === 'pending-move') {
      if (d.kind === 'move') {
        scene.setMoveOffset(null)
        if (d.offset.x !== 0 || d.offset.y !== 0) propsRef.current.onMove(d.offset.x, d.offset.y)
      } else {
        // A click on a selected entity selects just that one.
        const hit = scene.hitTest(world)
        propsRef.current.onSelect(hit ? [hit.index] : [], 'replace')
      }
      return
    }
    if (d.kind === 'box') {
      scene.setBoxSelect(null)
      const hits = scene.queryBox(boxOf(d.startWorld, world)).map((e) => e.index)
      propsRef.current.onSelect(hits, d.mode)
    } else {
      const hit = scene.hitTest(world)
      propsRef.current.onSelect(hit ? [hit.index] : [], hit ? d.mode : 'replace')
    }
  }

  const onPointerLeave = (): void => {
    sceneRef.current?.setHover(null)
    propsRef.current.onHover(null)
    propsRef.current.onCursor(null)
  }

  // Wheel needs a non-passive listener to prevent page zoom/scroll.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = host.getBoundingClientRect()
      const factor = Math.pow(1.0015, -event.deltaY)
      setCamera(
        zoomAt(cameraRef.current, factor, event.clientX - rect.left, event.clientY - rect.top)
      )
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [setCamera])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const scene = sceneRef.current
    if (!scene) return
    const c = cameraRef.current
    const dx = (scene.width / c.scale) * PAN_STEP
    const dy = (scene.height / c.scale) * PAN_STEP
    switch (event.key) {
      case ' ':
        spaceDown.current = true
        break
      case 'ArrowLeft':
        setCamera({ ...c, x: c.x - dx })
        break
      case 'ArrowRight':
        setCamera({ ...c, x: c.x + dx })
        break
      case 'ArrowUp':
        setCamera({ ...c, y: c.y - dy })
        break
      case 'ArrowDown':
        setCamera({ ...c, y: c.y + dy })
        break
      case 'f':
      case 'F':
        if (propsRef.current.selection.length > 0) return // mirrors the selection (App)
        fit()
        break
      case 'Escape':
        if (drag.current?.kind === 'move' || drag.current?.kind === 'pending-move') {
          drag.current = null
          scene.setMoveOffset(null)
        } else {
          propsRef.current.onSelect([], 'replace')
        }
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div
      ref={hostRef}
      data-testid="blueprint-canvas"
      className="absolute inset-0 overflow-hidden outline-none"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        if (e.key === ' ') spaceDown.current = false
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}

function boxOf(a: Position, b: Position): Box {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y)
  }
}
