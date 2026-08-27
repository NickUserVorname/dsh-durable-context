# Memory Stack

This directory contains the primary preserved implementation artifact of `dsh-durable-context`.

## Preserved source artifact

[`DSH_MEMORY_V09_LIVE_EXTRACT.zip`](DSH_MEMORY_V09_LIVE_EXTRACT.zip)

The ZIP should remain unchanged as a preservation artifact.

Its contents are expanded under:

[`live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/`](live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/)

The extracted tree exists for convenient source browsing.

## Scope

The preserved subsystem contains code associated with:

- durable WORKING_STATE;
- investigative checkpointing;
- later state projection and injection;
- context-pressure measurement;
- deterministic context hygiene;
- `/context`;
- `/compress`;
- semantic evacuation;
- coverage auditing;
- structured compaction;
- prune-safety state;
- supporting runtime integration required by the extracted subsystem.

## Status

This is a live-derived preservation/extraction bundle.

The preserved module bodies come from a live-installed freeze. The thin standalone extraction entrypoint was assembled from later live integration hooks so the subsystem can be browsed as a coherent unit.

See:

[`live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/PROVENANCE.md`](live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/PROVENANCE.md)

It is not:

- a complete diff from v0.8 to v0.9;
- a complete changelog for `local-dsh-v4-control`;
- a polished production release;
- the future v1.0 implementation.

Broader development evidence belongs under:

- [`../evidence/live-logs/`](../evidence/live-logs/)
- [`../evidence/provenance/`](../evidence/provenance/)
- [`../reports/`](../reports/)
- [`../historical/`](../historical/)

## Evidence class

Treat this directory as IMPLEMENTATION.

Treat `evidence/` as the stronger source for claims about behavior actually observed live.

