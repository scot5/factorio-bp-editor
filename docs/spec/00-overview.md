# 00 — Overview

## Problem

Blueprint strings are opaque. Inside the game you can place them and look at them, but it is hard to answer questions like "what does this build need?", "what does it produce per minute?" or "where is the bottleneck?". Bulk edits are also hard, for example swapping every tier of an entity, re-targeting recipes or fixing circuit conditions. Web tools exist, but they use bundled or outdated assets and do little analysis.

## Goals

1. **Lossless import/export** of every blueprint-string type Factorio produces, including blueprint books.
2. **Faithful visualisation** using the user's own game assets, so the result looks like the game.
3. **Useful analysis**: materials, rates, power, throughput, networks, and problems.
4. **Practical editing** with undo/redo that covers the common in-game blueprint edits, plus bulk operations the game lacks.
5. **Optional AI assistance** through Claude over ACP. The agent reads and edits blueprints through tools. The user stays in control of every change.

## Non-goals (for now)

- Running or simulating the factory tick by tick. Analysis is steady-state math only.
- Reading or writing the game's binary `blueprint-storage-2.dat` library file. Strings only.
- Full fidelity rendering for every mod's custom graphics. Mods are supported on a best-effort basis through the data dump (see [03](03-game-assets.md)).
- Multiplayer or cloud sync.
- Mobile or web builds. Desktop (Windows first, then macOS and Linux) only.

## Users

- **Players** who collect blueprints and want to understand them before placing.
- **Designers** who build and tune production blueprints and want ratio and throughput checks.
- **Curious players** who want to ask an agent to explain or improve a design.

## Core user flows

1. Paste a string (or open a `.txt` file, or drop it on the window) → the blueprint renders → the analysis panel fills in.
2. Pick a blueprint inside a book from the book tree → view, analyse and edit it.
3. Make edits → **Export** copies the new string to the clipboard.
4. Open the agent panel → ask a question → the agent calls tools → the answer appears, possibly with a proposed change → the user previews the diff → Accept or Reject.

## Milestones

| M | Scope |
| --- | --- |
| **M1 — Codec** | Decode/encode library with round-trip tests against a corpus of real strings. CLI-free, pure TypeScript. |
| **M2 — Viewer** | Electron shell, paste/import, book tree, canvas with **icon-on-footprint** rendering (entity box + item icon), pan/zoom, entity inspector. |
| **M3 — Assets** | Factorio install detection, data dump, real sprite rendering for common entity types (machines, belts, inserters, pipes, poles, chests, rails). |
| **M4 — Analysis** | Counts, bill of materials, power, recipe rates, belt throughput, validation. |
| **M5 — Editor** | Selection, move/rotate/mirror/delete, palette placement, property editing, wires, undo/redo, export. |
| **M6 — Agent** | ACP client, MCP blueprint tool server, chat panel, proposed-change review. |
| **M7 — Polish** | Remaining sprite types, upgrade/deconstruction planners, blueprint diff view, settings, packaging and auto-update. |

M1 is the foundation for everything else. M6 depends only on M1, M4 and M5, so it can start before M7.

## Open questions

- Should the app keep a local **library** of imported blueprints (history, favourites)? Proposed: yes, a simple JSON store in Electron's `userData`, added after M5.
- Should we support **mod-aware rendering** from the start (run the data dump with the user's mod list) or base game plus expansions only? Proposed: use the user's active mods if the dump succeeds, otherwise the base game.
- Should the agent use the user's own Claude login (through the Claude Code ACP adapter) or an API key? See [07](07-agent-acp.md#authentication).
