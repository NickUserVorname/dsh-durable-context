# Version Lineage

This file records high-level development lineage.

It is not a complete changelog.

## v0.1

Role:

Early project/control-pack lineage.

Preserved under:

`historical/v0.1/`

## v0.2.x

Main architectural direction:

- host-owned source authority;
- task lifecycle;
- mutation boundaries;
- bounded goals and budgets;
- worktree isolation;
- review and acceptance separation;
- anti-runaway controls.

Preserved under:

`historical/v0.2.x/`

## v0.7.x

Main architectural direction:

- universal durable commit experiments;
- context pressure handling;
- structured compaction;
- source relationship and transaction hardening.

Live work revealed that mandatory memory protocol could pollute state and couple ordinary answers to a second finalization path.

Preserved under:

`historical/v0.7.x/`

## v0.8.x

Main architectural direction:

- ordinary answers separated from mandatory memory protocol;
- investigative checkpointing becomes event-driven;
- durable state and context reclamation become separate paths;
- semantic evacuation and coverage audit introduced for reclamation;
- incremental checkpoints do not independently grant prune authority.

Preserved under:

`historical/v0.8.x/`

The frozen v0.8.0 package predates later live qualification evidence. Do not rewrite its historical status based only on later results.

## live / pre-canonical-v0.9 development

This stage includes later live qualification and runtime integration fixes.

The primary preserved subsystem artifact is:

`memory-stack/DSH_MEMORY_V09_LIVE_EXTRACT.zip`

It is a live-derived subsystem extraction: preserved module bodies come from a live-installed freeze, while the thin standalone entrypoint was assembled from later live integration hooks.

It is not a complete record of every fix between v0.8 and v0.9.

Primary evolution evidence is under:

- `evidence/live-logs/`
- `evidence/memory-injections/`
- `evidence/provenance/`
- `reports/`

## v1.0

Status:

Active development.

Do not present v1.0 behavior as part of the preserved live/pre-v0.9 artifact until a separate v1.0 artifact is actually published.

## Git topology

The development lineage above is not represented as separate Git branches.

The public repository uses:

`main`

Frozen historical packages are kept under `historical/`.

## Reconstruction rule

Exact relationships should be reconstructed from frozen packages, hashes, provenance records, reports and live logs rather than inferred only from filenames.

