# DSH memory v0.9 live extract

Preservation/extraction of the memory + context-compaction subsystem from the supplied live-patched `local-dsh-v4-control` lineage.

## What is here

The memory path is kept together in one package directory:

- `state_checkpoint` durable investigative working state
- automatic injection of durable working state into later top-level turns/sessions in the same controlled project
- work-mode policy injection
- Level-A lossless context hygiene (`identical contiguous exchange -> one exact exchange + xN`)
- `/context` pressure reporting
- `/compress` semantic evacuation, coverage audit and active-surface replacement
- structured compaction snapshot injection
- `WORKING_STATE.json` persistence/projection/hash/coverage metadata
- fresh `CONTEXT_COMPACTOR` role machinery used by semantic evacuation
- token/context measurement dependencies required by the live implementation

## Important

This is a **faithful extraction/preservation bundle**, not the final cleaned architecture.
The original memory modules are intentionally preserved. They still depend on parts of the legacy project runtime (`state`, `host-runtime`, role budget helpers). Those transitive modules are included so the extracted tree is complete and import-resolvable.

The known `state_checkpoint -> exec.concludeTurn()` P0 is also intentionally preserved in the source snapshot. See `KNOWN_LIVE_BUGS.md` before attempting to deploy this entrypoint.

## Main files

- `lib/context-memory.js` — durable semantic memory model, hashes, session/surface coverage, injected snapshots
- `lib/working-state.js` — field-aware working state merge/projection
- `lib/universal-commit.js` — `state_checkpoint`, later-session injection, pressure-triggered compaction
- `lib/context-hygiene.js` — lossless identical-exchange coalescing
- `lib/context-pressure.js` — headroom/pressure and structured compacted surface
- `lib/context-evacuation.js` — semantic evacuation + coverage audit + pruning workflow
- `lib/context-commands.js` — `/context`, `/compress`

`index.js` is a thin extraction entrypoint assembled from the current live integration hooks so the memory subsystem is visible as a standalone unit instead of being buried in the 900+ line control plugin.
