# DSH Durable Context

Research prototype and preservation repository for durable investigative state and coverage-gated context reclamation in long-running DeepSeek Harness agents.

The project separates two operations that are often conflated:

1. incremental transfer of durable investigative state;
2. authorization to reclaim old active context.

A successful state checkpoint does not by itself make older context safe to remove. Context reclamation is handled separately through semantic evacuation, coverage auditing, host-side consistency checks, and explicit prune-safe authority.

## Status

Current preserved implementation artifact:

`live / pre-canonical-v0.9 development state`

The preserved implementation is experimental and comes from a live development lineage rather than a polished stable release.

Architecture evolved through v0.1, v0.2.x, v0.7.x, v0.8.x and later live qualification work.

v1.0 is under active development.

The preserved memory/context artifact is a live-derived subsystem extraction rather than a byte-for-byte copy of the complete installed control package.

Its preserved module bodies come from a live-installed freeze, while the thin standalone extraction entrypoint was assembled from later live integration hooks. See the preserved [artifact provenance](memory-stack/live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/PROVENANCE.md).

It is not:

- a complete v0.8 -> v0.9 changelog;
- a record of every live fix made to the surrounding control/runtime stack;
- a claim of production readiness;
- a claim that every designed behavior has already been demonstrated live.

## What this is

The durable unit is project-level canonical working state rather than a sequence of individual injected memory messages.

Material findings from troubleshooting, research, testing, experiments or iterative construction can be accumulated into durable state and later projected back into model context.

Context reclamation follows a separate path.

```text
conversation / tools
        |
        v
material investigative finding
        |
        v
canonical durable state
        |
        v
bounded later projection
```

is one mechanism.

```text
old active context
        |
        v
semantic evacuation
        |
        v
coverage audit
        |
        v
host validation
        |
        v
prune authorization
        |
        v
active-context reclamation
```

is another.

They are deliberately not treated as the same operation.

## Why this exists

The architecture emerged from repeated long-horizon failures observed during real agent-assisted engineering work.

Recurring classes included:

- useful findings remaining only in transient conversation;
- prompt feedback failing to become durable constraints;
- repeated failed hypotheses or failed actions;
- tests passing while user acceptance still failed;
- model self-report being treated as authority;
- context compaction losing unique constraints or evidence;
- repeated compaction accumulating information loss;
- stale source or project state surviving into later actions;
- runtime, host, tool and model failures being confused with one another;
- partial state or compaction operations leaving authority and visible context out of sync.

The design progressively moved durable conclusions and irreversible authority out of transient model context and into host-managed state.

## Core mechanism

The central question is not only:

> How should old context be summarized?

The stronger question is:

> Which old active context do we now have sufficient surviving representation to reclaim?

Conceptually:

```text
old active candidate span
        +
surviving durable state
        +
current canonical project state
        |
        v
semantic evacuation
        |
        v
identify missing live semantics
        |
        v
transfer missing material when needed
        |
        v
coverage audit
        |
        v
host-side revision and fingerprint checks
        |
        +---- uncertain / incomplete ----> retain old context
        |
        `---- sufficient coverage
                  |
                  v
          advance prune-safe authority
                  |
                  v
          replace audited active surface
```

Incremental investigative checkpoints do not independently advance prune-safe authority.

This mechanism is described as coverage-gated or audited context reclamation.

It is not presented as a formal mathematical proof of zero semantic loss. Semantic coverage remains model-assisted while irreversible reclamation authority remains host-controlled.

## Beyond agent memory

This project is not only concerned with:

> What does the agent remember?

It also treats context reclamation as a versioned and auditable state transition.

Relevant questions include:

- Which version of canonical state was used as the decision basis?
- Which protocol/checkpoint state had already been committed?
- Which session revision participated in the audit?
- Which source revision participated in the audit?
- Did relevant state change between audit and reclamation?
- Did the canonical or working-state fingerprint change?
- Up to which sequence boundary is irreversible active-context reclamation authorized?

The implementation therefore distinguishes:

```text
investigative state committed
        |
        v
protocol progress recorded
        |
        v
coverage evaluated against a specific state basis
        |
        v
revision and fingerprint basis rechecked
        |
        v
prune-safe authority may advance
        |
        v
audited active context may be reclaimed
```

`protocol_committed_through_seq` and `prune_safe_through_seq` represent different claims.

A normal checkpoint may advance durable protocol state while `prune_safe_through_seq` remains unset.

This prevents:

`a checkpoint happened`

from being interpreted as:

`everything before this point is now safe to forget`

## Live evidence

Primary runtime evidence is kept separate from retrospective reports.

- [Live qualification video](https://youtu.be/DNd-Tkx-Uec)
- [Runtime troubleshooting logs](evidence/live-logs/)
- [Captured durable state](evidence/memory-injections/WORKING_STATE.json)
- [Provider usage dashboard](evidence/serverless-usage-2026-08-21.png)
- [Redacted provider usage records](evidence/usage-2026-08-19.redacted.csv)
- [Artifact manifest](evidence/provenance/ARTIFACT_MANIFEST.md)
- [SHA-256 records](evidence/provenance/SHA256SUMS.txt)

Usage evidence demonstrates workload volume, not architectural correctness.

Runtime behavior is supported separately by preserved implementation, live logs, captured state, runtime outputs and video evidence.

The public usage CSV is explicitly a redacted derivative.

## Reclamation qualification status

The preserved live corpus demonstrates:

- durable investigative checkpointing;
- an investigative checkpoint with `prune_safe_through_seq` remaining unset;
- later reinjection of committed investigative state;
- successful coverage-audited `/compress`;
- audited active-surface reduction from approximately 25,582 to 18,312 tokens;
- repeated compaction after a live hotfix;
- fail-closed unavailability of compaction when validated prune authority is absent.

One successful live reclamation trace reports that the candidate span already had sufficient surviving representation and concludes:

`No transfer needed; safe to prune.`

The currently preserved live corpus does not yet provide a deliberately constructed end-to-end semantic canary demonstrating both:

1. a previously unrepresented fact transferred during evacuation, followed by reclamation and later successful reuse;
2. an intentionally uncovered semantic gap causing explicit semantic reclamation refusal while the old span remains active.

Those are further qualification targets, not claims already established by the preserved evidence.

### Known compaction transaction weakness

Live qualification also exposed an earlier partial-commit path in which audit/state commit passed but active-surface replacement failed.

The old surface remained present, so the observed failure did not delete the source data. However, prune authority had already advanced before replacement completed.

This is retained as evidence of a transaction-ordering / atomicity weakness rather than described as fully atomic behavior.

## Reading order

For a technical review, read in this order:

1. [README.md](README.md) - scope, status, claims and evidence map
2. [Memory architecture](docs/MEMORY_ARCHITECTURE.md)
3. [Compaction protocol](docs/COMPACTION_PROTOCOL.md)
4. [Invariants](docs/INVARIANTS.md)
5. [Failure model](docs/FAILURE_MODEL.md)
6. [Reproduction and qualification](docs/REPRODUCTION.md)
7. [Preserved implementation](memory-stack/)
8. [Primary evidence](evidence/)
9. [Version lineage](evidence/provenance/VERSION_LINEAGE.md)
10. [Engineering reports](reports/)
11. [Historical packages](historical/)

For automated readers:

- treat `docs/` as design and interpretation;
- treat `memory-stack/` as preserved implementation;
- treat `evidence/` as primary runtime/provenance evidence;
- treat `reports/` as retrospective analysis;
- treat `historical/` as development-lineage material, not automatically current behavior;
- do not infer current behavior solely from old filenames or frozen packages;
- do not treat retrospective reports as stronger evidence than primary runtime traces.

The root README is the canonical navigation surface for both human and automated readers.

## Evidence semantics

### DESIGN

Architecture, requirements or intended behavior. Design material is not runtime proof by itself.

### IMPLEMENTATION

Preserved code demonstrating that a mechanism existed in a specific implementation state. Implementation does not prove that every path was exercised successfully in the installed runtime.

### LIVE EVIDENCE

Observed runtime logs, captured state, recordings, outputs or other behavior from a running system.

### REPORT / ANALYSIS

Retrospective interpretation of implementation and evidence. Useful for causal history and design rationale, but not primary runtime evidence.

### HISTORICAL

Older frozen development material. Useful for lineage and failure analysis; not automatically representative of current behavior.

### EXTERNAL / THIRD-PARTY

DeepSeek Harness, dependencies, donor material and other externally authored software. Their presence does not imply authorship or relicensing by this project.

## Development lineage

```text
v0.1
  |
  | early project/control pack
  v
v0.2.x
  |
  | host governance
  | task/source authority
  | mutation boundaries
  | review / acceptance
  | anti-runaway controls
  v
v0.7.x
  |
  | durable commit
  | context pressure
  | structured compaction
  | universal checkpoint experiments
  v
v0.8.x
  |
  | ordinary answers separated from memory protocol
  | investigative state becomes event-driven
  | reclamation becomes a separate audited path
  v
live / pre-v0.9
  |
  | live qualification
  | runtime integration fixes
  | preserved memory/context subsystem extract
  v
v1.0
  |
  `- active development
```

These are development stages, not Git branches.

The repository uses `main`.

Frozen packages belong under [historical/](historical/). Detailed relationships are documented in [VERSION_LINEAGE.md](evidence/provenance/VERSION_LINEAGE.md).

## Native DSH vs custom control layer

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) already provides runtime/session infrastructure and host-level context injection mechanisms.

This project does not claim those transport primitives as original work.

The custom layer concerns durable investigative-state management and reclamation semantics above those primitives, including:

- canonical durable investigative state;
- incremental investigative checkpoints;
- bounded state projection and reinjection;
- cross-session restoration;
- semantic evacuation;
- coverage auditing;
- host-side consistency checks;
- explicit prune-safe authority;
- separation of protocol progress from reclamation authority.

## Scope and non-claims

This project does not claim to invent persistent agent memory, hierarchical memory, context compaction, host-managed state, cross-session continuation, runtime context injection or checkpoints as individual concepts.

Individual components have prior art.

The narrower architectural interest is the composition used here, especially the separation between incremental durable investigative-state transfer and separately authorized coverage-gated context reclamation.

Among the sources reviewed in the current prior-art snapshot, no public system was identified that matches this exact composition. This is not a claim of proven global novelty.

See [RELATED_WORK.md](docs/RELATED_WORK.md).

## Engineering process

This was an AI-assisted engineering project.

It is not presented as a claim that every implementation line was manually authored.

The contribution includes system architecture, invariants, authority boundaries, failure analysis, requirements, adversarial qualification, iterative specification, acceptance criteria, runtime diagnosis, AI-assisted implementation and live validation.

Historical versions represent coupled evolution of architecture, implementation, tests, benchmarks and runtime findings. They are not a clean fixed-spec experiment.

See [Engineering reports](reports/).

## Repository map

```text
memory-stack/
    Primary preserved memory/context subsystem.

docs/
    Architecture, invariants, compaction protocol,
    failure model, related work and reproduction.

evidence/
    Primary runtime and provenance evidence.

reports/
    Retrospective engineering reports and case-study analysis.

historical/
    Frozen historical packages. Historical does not mean current.

implementation/
    Placeholder for a selected broader local-dsh-v4-control publication.
    The current primary preserved implementation is under memory-stack/.

full-environment/
    Provenance placeholder for an externally hosted frozen environment.
    No public full-environment archive is implied unless a link and hash
    are explicitly recorded there.
```

## Primary preserved artifact

The main preserved implementation artifact is:

[`memory-stack/DSH_MEMORY_V09_LIVE_EXTRACT.zip`](memory-stack/DSH_MEMORY_V09_LIVE_EXTRACT.zip)

A browsable extracted representation is available under:

[`memory-stack/live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/`](memory-stack/live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/)

The ZIP is retained as the preservation artifact. The extracted tree exists for source browsing.

## Provenance

Important preserved artifacts are identified with SHA-256 where practical.

Primary evidence should remain byte-for-byte unchanged where practical.

If publication requires redaction, retain the untouched original privately and label the public artifact as a derivative.

Filesystem timestamps are auxiliary provenance. Hashes and documented artifact relationships are the primary identity mechanism used by this repository.

## License

Original project code and documentation are licensed under the Apache License 2.0 unless explicitly stated otherwise.

DeepSeek Harness, third-party software, dependencies, donor material, externally authored code, bundled runtime material and historical artifacts retain their original licenses and terms.

The repository-level Apache-2.0 license does not automatically relicense third-party material.

See [LICENSING.md](LICENSING.md).


