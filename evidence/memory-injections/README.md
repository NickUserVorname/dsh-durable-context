# Memory Injection Evidence

This directory contains captured examples of durable investigative state and later host projection.

Primary captured state:

[`WORKING_STATE.json`](WORKING_STATE.json)

Useful evidence classes include:

- canonical WORKING_STATE state;
- same-turn checkpoint output;
- checkpoint metadata;
- later host-projected investigative state;
- fresh-session restoration;
- cumulative merge behavior;
- bounded projection metadata.

A model-facing injection is not the canonical storage unit. It is a projection of surviving state.

A normal investigative checkpoint may commit material state while prune authority remains unset.

For the architecture see:

- [Memory architecture](../../docs/MEMORY_ARCHITECTURE.md)
- [Compaction protocol](../../docs/COMPACTION_PROTOCOL.md)
