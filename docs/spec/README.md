# Specification

This folder describes what the Factorio Blueprint Editor should do and how it is built. Each document covers one area. Requirements use **MUST / SHOULD / MAY** in the RFC 2119 sense.

| # | Document | Covers |
| --- | --- | --- |
| 00 | [Overview](00-overview.md) | Goals, non-goals, users, milestones |
| 01 | [Architecture](01-architecture.md) | Processes, modules, tech choices, security |
| 02 | [Blueprint format](02-blueprint-format.md) | String encoding, JSON schema, round-trip rules |
| 03 | [Game assets](03-game-assets.md) | Locating Factorio, prototype data, sprites, icons |
| 04 | [Visualisation](04-visualization.md) | Canvas, layers, overlays, interaction |
| 05 | [Editing](05-editing.md) | Edit operations, commands, undo/redo |
| 06 | [Analysis](06-analysis.md) | Counts, ratios, throughput, power, validation |
| 07 | [Agent integration (ACP)](07-agent-acp.md) | Claude via ACP, blueprint tools, permissions |

## Target game version

The baseline is **Factorio 2.1.x** (2.1.25 at the time of writing) with the **Space Age**, **Quality** and **Elevated Rails** expansions. Blueprints from 1.1 MUST still import (see [02](02-blueprint-format.md#version-handling)).
