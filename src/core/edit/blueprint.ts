import type { BlueprintEnvelope } from '../codec'
import { getNode, type BookPath } from '../model'
import { CommandRejected, defineCommand } from './command'

/**
 * Blueprint and book commands (docs/spec/05-editing.md § Blueprint and book commands).
 * They apply to any item: blueprint, book or planner, addressed by its book path.
 */

export interface SetTextArgs {
  /** Book path of the item ([] = the root). */
  path: BookPath
  /** New text; empty removes the key, as the game does for an empty label. */
  text: string
}

function setText(draft: BlueprintEnvelope, args: SetTextArgs, key: 'label' | 'description'): void {
  const node = getNode(draft, args.path)
  if (!node) throw new CommandRejected('That book slot no longer exists.')
  if (args.text === '') {
    if (key in node.payload) delete node.payload[key]
  } else if (node.payload[key] !== args.text) {
    node.payload[key] = args.text
  }
}

export const setLabel = defineCommand<SetTextArgs>({
  name: 'setLabel',
  label: () => 'Set label',
  mergeKey: (args) => `setLabel:${args.path.join('/')}`,
  run: (draft, args) => setText(draft, args, 'label')
})

export const setDescription = defineCommand<SetTextArgs>({
  name: 'setDescription',
  label: () => 'Set description',
  mergeKey: (args) => `setDescription:${args.path.join('/')}`,
  run: (draft, args) => setText(draft, args, 'description')
})
