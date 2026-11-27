/**
 * Fluid and heat connection points of a prototype, read from the dump.
 * See docs/spec/03-game-assets.md § Connection-aware sprites.
 *
 * A connection sits on one tile of the entity (`position`, relative to the
 * entity centre, for the north-facing entity) and points out of it in
 * `direction` (16-way). Two entities connect when each one's connection
 * points at the other's connection tile. Pipe-to-ground underground and
 * linked connections are left out: they never join a neighbouring tile.
 */

export interface ConnectionPoint {
  position: [number, number]
  /** 16-way direction the connection points to, for the north-facing entity. */
  direction: number
  /** Per-facing positions (N, E, S, W) instead of rotating `position` (pumpjack). */
  positions?: [number, number][]
  /** Only active for a recipe with fluid in this role (`fluid_boxes_off_when_no_fluid_recipe`). */
  production?: 'input' | 'output'
  /** `connection_category` when not `["default"]`; connections must share one to join. */
  categories?: string[]
}

export interface EntityConnections {
  fluid?: ConnectionPoint[]
  heat?: ConnectionPoint[]
}

type Raw = Record<string, unknown>

export function entityConnections(proto: Raw): EntityConnections | undefined {
  const offWithoutRecipe = proto['fluid_boxes_off_when_no_fluid_recipe'] === true
  const fluid: ConnectionPoint[] = []
  for (const box of fluidBoxes(proto)) {
    const production = box['production_type']
    const role =
      offWithoutRecipe && (production === 'input' || production === 'output')
        ? production
        : undefined
    const list = box['pipe_connections']
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (!isRecord(raw)) continue
      const type = raw['connection_type']
      if (type === 'underground' || type === 'linked') continue
      const point = connectionPoint(raw)
      if (!point) continue
      const categories = raw['connection_category']
      const list = typeof categories === 'string' ? [categories] : categories
      if (
        Array.isArray(list) &&
        list.every((c) => typeof c === 'string') &&
        !(list.length === 1 && list[0] === 'default')
      )
        point.categories = list
      if (role) point.production = role
      fluid.push(point)
    }
  }

  const heat: ConnectionPoint[] = []
  const energy = proto['energy_source']
  const heatLists = [
    isRecord(proto['heat_buffer']) ? proto['heat_buffer']['connections'] : undefined,
    isRecord(energy) && energy['type'] === 'heat' ? energy['connections'] : undefined
  ]
  for (const list of heatLists) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const point = isRecord(raw) ? connectionPoint(raw) : null
      if (point) heat.push(point)
    }
  }

  if (!fluid.length && !heat.length) return undefined
  return { ...(fluid.length ? { fluid } : {}), ...(heat.length ? { heat } : {}) }
}

/** Every FluidBox of a prototype: any property holding one or a list of them, plus the energy source's. */
function fluidBoxes(proto: Raw): Raw[] {
  const out: Raw[] = []
  const add = (value: unknown): void => {
    if (isRecord(value) && Array.isArray(value['pipe_connections'])) out.push(value)
  }
  for (const value of Object.values(proto)) {
    if (Array.isArray(value)) value.forEach(add)
    else add(value)
  }
  const energy = proto['energy_source']
  if (isRecord(energy)) add(energy['fluid_box'])
  return out
}

function connectionPoint(raw: Raw): ConnectionPoint | null {
  const direction = raw['direction']
  if (typeof direction !== 'number') return null
  const positions = Array.isArray(raw['positions'])
    ? raw['positions'].map(vector).filter((v): v is [number, number] => v !== undefined)
    : undefined
  const position = vector(raw['position']) ?? positions?.[0]
  if (!position) return null
  return {
    position,
    direction: direction % 16,
    ...(positions && positions.length === 4 ? { positions } : {})
  }
}

/**
 * Where a connection is for an entity facing `facing` (16-way, rounded to 4-way):
 * the tile offset from the entity centre and the direction it points.
 */
export function placeConnection(
  point: ConnectionPoint,
  facing: number
): { position: [number, number]; direction: number } {
  const turns = Math.round(facing / 4) % 4
  let position = point.positions?.[turns]
  if (!position) {
    let [x, y] = point.position
    for (let i = 0; i < turns; i++) [x, y] = [-y, x]
    position = [x, y]
  }
  return { position, direction: (point.direction + turns * 4) % 16 }
}

function vector(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number')
    return [value[0], value[1]]
  if (isRecord(value) && typeof value['x'] === 'number' && typeof value['y'] === 'number')
    return [value['x'], value['y']]
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
