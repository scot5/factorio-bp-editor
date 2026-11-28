import type { BlueprintEnvelope } from '../codec'

/**
 * Edit commands. See docs/spec/05-editing.md § Principles.
 *
 * A command changes a draft of the whole envelope inside Immer `produce`. It
 * never returns a new envelope: the framework (history.ts) records the patches.
 * Commands are the only way the UI, shortcuts and the agent change a document.
 */

export interface CommandOutcome {
  /** Problems the edit leaves behind; the edit still applies (05 § Principles). */
  warnings?: string[]
}

export interface Command<A> {
  /** Stable id, e.g. `setLabel`. The agent (07) refers to commands by it. */
  readonly name: string
  /** Undo menu text, e.g. "Set label". */
  label(args: A): string
  /**
   * Consecutive edits with the same key, made close together, merge into one
   * undo step (typing into a field, dragging). `undefined` never merges.
   */
  mergeKey?(args: A): string | undefined
  /** Change `draft` in place. Throw `CommandRejected` to refuse the edit. */
  run(draft: BlueprintEnvelope, args: A): CommandOutcome | void
}

/**
 * Thrown by a command (or the framework's checks) for an edit that must not
 * apply: one that would make the export unreadable to the game (05 § Principles),
 * or one whose target does not exist.
 */
export class CommandRejected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandRejected'
  }
}

export function defineCommand<A>(command: Command<A>): Command<A> {
  return command
}
