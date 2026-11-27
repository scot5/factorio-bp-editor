import { z } from 'zod'

/**
 * Zod schemas for blueprint JSON. See docs/spec/02-blueprint-format.md.
 *
 * - Every object schema is `looseObject`: unknown keys are allowed and typed as
 *   `unknown`, because the game adds fields over time and mods add their own.
 * - These schemas are used to VALIDATE decoded JSON (see validate.ts), never to
 *   replace it. Zod rebuilds objects when parsing, which could reorder keys;
 *   the decoded JSON stays the source of truth for lossless round-trip.
 * - Fields not confirmed from the corpus are kept loose (`unknown`) rather than
 *   guessed. Tighten them as the corpus shows their shape.
 */

const int = z.int()
const nonNegativeInt = z.int().nonnegative()

export const PositionSchema = z.looseObject({ x: z.number(), y: z.number() })

export const ColorSchema = z.looseObject({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number().optional()
})

/** Signal / item / entity reference, e.g. `{ type: 'virtual', name: 'signal-A' }`. Type absent = item. */
export const SignalIdSchema = z.looseObject({
  name: z.string(),
  type: z.string().optional(),
  quality: z.string().optional()
})

export const IconSchema = z.looseObject({ index: int, signal: SignalIdSchema })

/** 2.x insert plan (modules, fuel, ammo). Confirmed from the corpus. */
export const InsertPlanSchema = z.looseObject({
  id: z.looseObject({ name: z.string(), quality: z.string().optional() }),
  items: z.looseObject({
    in_inventory: z
      .array(z.looseObject({ inventory: int, stack: nonNegativeInt, count: int.optional() }))
      .optional(),
    grid_count: int.optional()
  })
})

/** 1.1 item requests: `{ "speed-module": 2 }`. Converted by the 1.1 migration (task 1.5). */
export const LegacyItemMapSchema = z.record(z.string(), z.number())

export const EntitySchema = z.looseObject({
  entity_number: z.int().positive(),
  name: z.string().min(1),
  position: PositionSchema,
  direction: z.int().min(0).max(15).optional(),
  orientation: z.number().optional(),
  mirror: z.boolean().optional(),
  quality: z.string().optional(),
  recipe: z.string().optional(),
  recipe_quality: z.string().optional(),
  items: z.union([z.array(InsertPlanSchema), LegacyItemMapSchema]).optional()
})

export const TileSchema = z.looseObject({ name: z.string().min(1), position: PositionSchema })

/** `[entity_a, connector_a, entity_b, connector_b]` (2.x). */
export const WireSchema = z.tuple([z.int().positive(), int, z.int().positive(), int])

export const StockConnectionSchema = z.looseObject({
  stock: z.int().positive(),
  front: z.int().positive().optional(),
  back: z.int().positive().optional()
})

const version = z.int().nonnegative()
const label = z.string().optional()
const description = z.string().optional()
const icons = z.array(IconSchema).optional()

export const BlueprintSchema = z.looseObject({
  item: z.literal('blueprint'),
  label,
  label_color: ColorSchema.optional(),
  description,
  icons,
  entities: z.array(EntitySchema).optional(),
  tiles: z.array(TileSchema).optional(),
  wires: z.array(WireSchema).optional(),
  schedules: z.array(z.unknown()).optional(),
  stock_connections: z.array(StockConnectionSchema).optional(),
  parameters: z.array(z.unknown()).optional(),
  'snap-to-grid': PositionSchema.optional(),
  'absolute-snapping': z.boolean().optional(),
  'position-relative-to-grid': PositionSchema.optional(),
  version
})

export const DeconstructionPlannerSchema = z.looseObject({
  item: z.literal('deconstruction-planner'),
  label,
  description,
  settings: z
    .looseObject({
      entity_filters: z.array(z.looseObject({ index: nonNegativeInt })).optional(),
      tile_filters: z.array(z.looseObject({ index: nonNegativeInt })).optional(),
      icons
    })
    .optional(),
  version
})

export const UpgradeMapperSchema = z.looseObject({
  index: nonNegativeInt,
  from: z.looseObject({ name: z.string().optional(), type: z.string().optional() }).optional(),
  to: z.looseObject({ name: z.string().optional(), type: z.string().optional() }).optional()
})

export const UpgradePlannerSchema = z.looseObject({
  item: z.literal('upgrade-planner'),
  label,
  description,
  settings: z.looseObject({ mappers: z.array(UpgradeMapperSchema).optional(), icons }).optional(),
  version
})

/**
 * One slot of a book. Exactly one of the four item keys must be present;
 * that is checked in validate.ts (it gives a clearer message than a Zod union).
 */
export const BookSlotSchema = z.looseObject({
  index: nonNegativeInt,
  blueprint: BlueprintSchema.optional(),
  get blueprint_book() {
    return BlueprintBookSchema.optional()
  },
  deconstruction_planner: DeconstructionPlannerSchema.optional(),
  upgrade_planner: UpgradePlannerSchema.optional()
})

export const BlueprintBookSchema = z.looseObject({
  item: z.literal('blueprint-book'),
  label,
  label_color: ColorSchema.optional(),
  description,
  icons,
  get blueprints() {
    return z.array(BookSlotSchema).optional()
  },
  active_index: nonNegativeInt.optional(),
  version
})

/** Schema per root key of the envelope. */
export const ROOT_SCHEMAS = {
  blueprint: BlueprintSchema,
  blueprint_book: BlueprintBookSchema,
  deconstruction_planner: DeconstructionPlannerSchema,
  upgrade_planner: UpgradePlannerSchema
} as const

export type Position = z.infer<typeof PositionSchema>
export type Color = z.infer<typeof ColorSchema>
export type SignalId = z.infer<typeof SignalIdSchema>
export type Icon = z.infer<typeof IconSchema>
export type InsertPlan = z.infer<typeof InsertPlanSchema>
export type BlueprintEntity = z.infer<typeof EntitySchema>
export type BlueprintTile = z.infer<typeof TileSchema>
export type WireTuple = z.infer<typeof WireSchema>
export type StockConnection = z.infer<typeof StockConnectionSchema>
export type Blueprint = z.infer<typeof BlueprintSchema>
export type DeconstructionPlanner = z.infer<typeof DeconstructionPlannerSchema>
export type UpgradePlanner = z.infer<typeof UpgradePlannerSchema>
export type BookSlot = z.infer<typeof BookSlotSchema>
export type BlueprintBook = z.infer<typeof BlueprintBookSchema>
