# Factorio Blueprint Editor

A desktop application for **analysing, visualising and editing Factorio blueprints**, with an optional AI agent (Claude, via the Agent Client Protocol) that can help you understand and change them.

> Status: **pre-development**. This repository currently contains the README and the specification. See [`docs/spec`](docs/spec/README.md).

## What it does

- **Import / export** blueprint strings exactly as Factorio produces them (`0` + base64 + zlib + JSON). Supports blueprints, blueprint books, deconstruction planners and upgrade planners.
- **Visualise** blueprints on a zoomable, pannable canvas, using the real game sprites and icons from your local Factorio install.
- **Analyse**: entity and item counts, bill of materials, production rates and ratios, power usage, belt throughput, circuit networks, and validation warnings.
- **Edit**: place, move, rotate, mirror and delete entities. Change recipes, filters, circuit conditions and wires. Upgrade or downgrade tiers. Edit labels, icons and book structure. Full undo/redo.
- **Agent (optional)**: connect Claude through ACP to ask questions about a blueprint ("why is this smelter column starved?") or ask for edits ("swap all yellow belts for red and add beacons"). Edits come back as proposed changes for you to review, accept or reject.

## Tech stack

| Concern | Choice |
| --- | --- |
| Shell | Electron |
| UI | React + TypeScript, built with Vite (`electron-vite`) |
| Rendering | PixiJS (WebGL) |
| State | Zustand + Immer (patch-based undo/redo) |
| Agent | Agent Client Protocol (ACP) client, talking to the Claude Code ACP adapter |
| Tests | Vitest (unit), Playwright for Electron (end-to-end) |
| Package manager | pnpm |

**Why not Next.js?** Next.js can run inside Electron (e.g. Nextron), but only as a static export. Its server features (SSR, server components, API routes) do nothing in a desktop app; the Electron main process fills that role. Plain React with Vite starts faster, has simpler routing and a smaller build. The reasoning is in [`docs/spec/01-architecture.md`](docs/spec/01-architecture.md#why-react--vite-instead-of-nextjs).

## Factorio assets

The app does **not** ship any Factorio graphics. At runtime it reads sprites, icons and prototype data from your own installation (default detection covers Steam library folders, for example `D:\SteamLibrary\steamapps\common\Factorio`). The game path can be changed in settings. Without a Factorio install, the app falls back to simple shapes and labels.

See [`docs/spec/03-game-assets.md`](docs/spec/03-game-assets.md).

## Getting started

_Not yet implemented._ The planned workflow:

```sh
pnpm install
pnpm dev             # start Electron with hot reload
pnpm test            # unit tests
pnpm build           # package the app
```

## Documentation

- [Specification index](docs/spec/README.md)

## Legal

Factorio is a trademark of Wube Software Ltd. This project is not affiliated with or endorsed by Wube Software. Game assets are loaded from the user's own licensed copy and are never redistributed.
