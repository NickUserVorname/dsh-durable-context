# DSH Durable Context

A failure-driven experimental control layer for preserving investigative state across long DeepSeek Harness sessions and reclaiming old context only after its relevant semantics have surviving representation.

The project separates three operations that are easy to conflate:

1. building durable investigative state;
2. projecting that state back into ordinary model context;
3. authorizing irreversible reclamation of old active context.

The central rule is:

> Saving state and proving that its conversational source is safe to remove are different transitions.

A successful checkpoint can advance durable project state without granting permission to prune the older conversation that produced it.

## Start here

The repository preserves live recordings, machine-readable qualification evidence, retrospective engineering reports, technical specifications, and a frozen implementation extract.

### Live qualification

#### Clean Git-root qualification

[Selective capture, late transfer and fresh-chat recovery](https://youtu.be/V3mXudvJZy4)

This is the cleanest end-to-end qualification run.

A newly initialized Git workspace starts without the previous project's durable injection. The run then shows:

- ordinary conversational material not automatically entering investigative durable state;
- analysis of 18 screenshots producing structured investigative state;
- the earlier admin fact `M7RK-5316` remaining absent from the initial investigative checkpoint;
- `/compress` later auditing the older source span and explicitly transferring `M7RK-5316`;
- the following host injection containing the transferred fact;
- a fresh chat recalling `M7RK-5316` without user repetition.

Machine-readable evidence from the same run is preserved as one qualification case:

[2026-08-28 selective capture and late transfer](evidence/qualification/2026-08-28-selective-capture-late-transfer/)

```text
pre-compress checkpoint
        |
        | M7RK-5316 absent
        v
/compress coverage audit
        |
        | M7RK-5316 explicitly transferred
        v
post-compress host injection
        |
        | M7RK-5316 present
        v
fresh-chat recall
```

#### Real-world multi-image analysis

[Long-running real-world qualification](https://youtu.be/7Jjz0XGB7zA)

This longer recording shows the system during messy iterative work rather than a constructed canary.

The run includes:

- analysis across multiple images;
- a tool path that failed to provide actual image pixels;
- an incorrect evidence interpretation;
- later correction after the image was actually read;
- preservation of the correction and related constraints in durable investigative state;
- continued work after the error;
- host-injected project state;
- continuation in a fresh chat.

The important part is not simply persistence.

It shows:

```text
failure
  -> correction
  -> durable constraint / evidence update
  -> later reuse
```

#### Non-Git project-boundary observations

[State persists after chat/UI reset and folder rename](https://youtu.be/sIKrtONfS_Y)

The previous durable context remains injected after:

- the previous DSH conversation is deleted;
- the workspace is removed from the DSH UI;
- the same non-Git folder is renamed;
- a fresh conversation is opened from the renamed folder.

[Previous state injected into a different new non-Git project](https://youtu.be/cNVDXxQAVok)

A different new non-Git folder is opened as a fresh DSH project, yet the previous project's durable investigative state is still injected into it.

Together, these recordings show that a different or renamed folder alone should not be assumed to establish durable project isolation in the observed non-Git setup.

The clean Git-root qualification provides the contrasting observation: after `git init`, the previous project state is no longer injected.

These recordings document observed current-runtime behavior, not a complete specification of DSH's internal project-identity algorithm.

#### Early baseline

[Same-workspace cross-chat injection](https://youtu.be/DNd-Tkx-Uec)

The earliest preserved recording shows the basic cross-chat path: durable project state from an existing DSH workspace is injected into a fresh chat opened in that same workspace.

Later qualification recordings progressively test harder cases.

### Machine-readable qualification

The clean `M7RK-5316` qualification is preserved as a single evidence chain:

[Qualification evidence](evidence/qualification/2026-08-28-selective-capture-late-transfer/)

It contains:

```text
01-pre-compress-state-checkpoint.raw.txt
02-compress-coverage-audit.raw.txt
03-post-compress-context-injection.raw.txt
README.md
```

The first artifact contains the developed screenshot-analysis state, including `known`, `constraints`, `decisions`, `evidence`, `do_not_repeat`, open items and next action, while `M7RK-5316` is not yet present.

The `/compress` artifact audits candidate surface `14..327` and explicitly reports:

```text
Transferred: the M7RK-5316 label fact and the user-changed approval policy.
```

The subsequent host-injected state contains `M7RK-5316` and exposes the bounded projection metadata, including:

```text
field_aware: true
soft_max_chars: 12000
full_state_path: .dsh/project/WORKING_STATE.json
```

The same injection explicitly states that raw hidden reasoning is not durable memory.

### Engineering sources

The main engineering trail is preserved in:

- [DSH/Qwen harness evolution report, v0.2-v0.8](reports/0ОТЧЕТ_DSH_Qwen_harness_v0.2-v0.8.md)
- [Cross-system failure analysis](reports/4-1ОТЧЕТHOWTOMAKEAIREVIEWOFTROUBLES.md)
- [Version lineage](evidence/provenance/VERSION_LINEAGE.md)
- [Failure model](docs/FAILURE_MODEL.md)
- [Invariants](docs/INVARIANTS.md)
- [Compaction protocol](docs/COMPACTION_PROTOCOL.md)
- [Memory architecture](docs/MEMORY_ARCHITECTURE.md)
- [Reproduction and qualification](docs/REPRODUCTION.md)
- [Related work](docs/RELATED_WORK.md)

The reports are retrospective engineering analysis. Runtime claims are supported separately by implementation and primary evidence.

## Architecture

### 1. Durable investigative state

The durable unit is project-level canonical working state rather than a stream of independent memory messages.

Material state can be retained from work such as:

- troubleshooting and debugging;
- testing and qualification;
- research;
- experiments;
- analytical investigation;
- multi-image analysis;
- iterative construction.

Ordinary conversation is not automatically treated as investigative durable state.

Typical working-state fields include:

- `known`
- `constraints`
- `decisions`
- `evidence`
- `failed_hypotheses`
- `do_not_repeat`
- `open_acceptance`
- `next_action`

This is continuation state, not a dump of raw hidden reasoning.

### 2. Host projection into ordinary model context

Durable state is not exposed through a separate model-side memory-query API.

The host renders a bounded, field-aware projection of project working state and injects that projection into the model's ordinary context.

The complete project state remains separately available at:

```text
.dsh/project/WORKING_STATE.json
```

The clean qualification captured a projection with:

```text
field_aware: true
soft_max_chars: 12000
```

and explicit preservation of critical fields including:

```text
constraints
failed_hypotheses
do_not_repeat
open_acceptance
next_action
```

Older injected snapshots may remain visible inside retained conversation history until that history is reclaimed.

The newest injection is therefore a current host projection of durable project state, not a replay of raw hidden reasoning.

### 3. Coverage-gated context reclamation

Creating durable state is not sufficient to establish that its original conversational source can safely disappear.

The reclamation path is:

```text
old active candidate span
        |
        v
semantic evacuation
        |
        v
identify missing live semantics
        |
        v
transfer missing material when required
        |
        v
coverage audit
        |
        v
host-side revision / fingerprint checks
        |
        +---- insufficient / uncertain ----> retain old context
        |
        `---- sufficient coverage
                  |
                  v
          advance prune-safe authority
                  |
                  v
          reclaim audited active surface
```

Semantic coverage remains model-assisted.

Irreversible reclamation authority remains host-controlled.

### 4. Authority boundaries

The implementation distinguishes:

```text
protocol_committed_through_seq
```

from:

```text
prune_safe_through_seq
```

These represent different claims.

`protocol_committed_through_seq` records durable protocol progress.

`prune_safe_through_seq` records the boundary through which irreversible active-context reclamation has been authorized.

A normal investigative checkpoint may therefore succeed while `prune_safe_through_seq` remains unset.

The system deliberately prevents:

```text
a checkpoint happened
```

from being interpreted as:

```text
everything before that checkpoint is safe to forget
```

## Why this exists

The architecture emerged from repeated long-horizon failures during real agent-assisted engineering work.

Recurring classes included:

- useful findings remaining only in transient conversation;
- important constraints surviving only as prompt history;
- rejected hypotheses being retried;
- failed actions being repeated;
- tests passing while user acceptance still failed;
- model self-report being treated as authority;
- context compaction losing unique constraints or evidence;
- repeated compaction accumulating information loss;
- stale source or project state surviving into later actions;
- runtime, host, parser, tool and model failures being confused with one another;
- partial state transitions leaving durable authority and visible context out of sync.

These failures pushed the design toward a clearer responsibility split.

The model remains responsible for semantic work such as:

- interpretation;
- hypotheses;
- implementation judgment;
- review;
- semantic coverage assessment.

The host remains responsible for authority-bearing operations such as:

- canonical revisions;
- durable state;
- task and source authority;
- budgets;
- mutation gates;
- state transitions;
- irreversible reclamation authority.

The failure model distinguishes attribution classes including:

- model;
- harness;
- runtime;
- provider;
- parser;
- tool protocol;
- context handling;
- project-state governance;
- unknown or mixed.

See [FAILURE_MODEL.md](docs/FAILURE_MODEL.md).

## How this architecture was derived

The project was not implemented once from a clean fixed specification.

It evolved through a repeated engineering loop:

```text
observed failure
        |
        v
retrospective analysis
        |
        v
cross-layer attribution
        |
        v
requirement / authority boundary
        |
        v
implementation revision
        |
        v
live qualification
        |
        v
newly observed failure
        |
        v
next iteration
```

The important step is attribution.

A failure observed in an agent session is not automatically a model failure.

It may instead belong to:

- model behavior;
- harness behavior;
- runtime integration;
- provider behavior;
- parser behavior;
- tool protocol;
- context handling;
- project-state governance;
- or several layers at once.

The reports preserve those failures and their retrospective analysis.

The implementation and qualification evidence preserve what happened after that analysis was turned into architectural requirements.

## Qualification status

| Behavior | Status | Primary evidence |
| --- | --- | --- |
| Same-workspace cross-chat injection | Demonstrated | [baseline video](https://youtu.be/DNd-Tkx-Uec) |
| Long-running multi-image analysis workflow | Demonstrated | [real-world video](https://youtu.be/7Jjz0XGB7zA) |
| Incorrect evidence interpretation corrected and carried forward | Demonstrated | [real-world video](https://youtu.be/7Jjz0XGB7zA) |
| Selective investigative-state capture | Demonstrated | [clean qualification](https://youtu.be/V3mXudvJZy4) |
| Positive late semantic transfer | Demonstrated | [video](https://youtu.be/V3mXudvJZy4), [machine-readable case](evidence/qualification/2026-08-28-selective-capture-late-transfer/) |
| Fresh-chat recovery after late transfer | Demonstrated | [clean qualification](https://youtu.be/V3mXudvJZy4) |
| Bounded field-aware host projection | Directly observed | [machine-readable case](evidence/qualification/2026-08-28-selective-capture-late-transfer/) |
| Coverage-audited successful reclamation | Demonstrated | [runtime evidence](evidence/live-logs/) |
| Active-surface reduction | Demonstrated | preserved approximately `25,582 -> 18,312` trace |
| Same non-Git workspace persistence across chat/UI reset and rename | Observed | [video](https://youtu.be/sIKrtONfS_Y) |
| Previous state appearing in a different new non-Git project | Observed | [video](https://youtu.be/cNVDXxQAVok) |
| Git-root project isolation | Demonstrated in current tested setup | [clean qualification](https://youtu.be/V3mXudvJZy4) |
| Deliberately constructed uncovered semantic-gap refusal | Pending | not claimed |

## Engineering evolution and reports

The qualification table above describes the current public evidence.

The version history below explains how the architecture moved toward that state.

### v0.2.x

The control layer moved more authority out of transient model behavior and into host governance.

Changes included:

- host-owned source authority;
- task lifecycle control;
- mutation boundaries;
- bounded goals and budgets;
- worktree isolation;
- separation of review from acceptance;
- anti-runaway controls.

The underlying lesson was that semantic capability and operational authority should not be treated as the same thing.

### v0.7.x

The system added mechanisms around longer-running state and context pressure:

- durable commit experiments;
- structured state accumulation;
- context-pressure handling;
- structured compaction;
- source hardening;
- transaction hardening.

Live use then exposed a new class of problems.

Making memory protocol too universal caused its own state pollution and response-finalization issues.

The attempt to preserve more state could itself interfere with ordinary work.

### v0.8.x

The architecture reacted by separating mechanisms that had previously been coupled.

Changes included:

- ordinary answers separated from mandatory memory protocol;
- investigative checkpointing made event-driven;
- durable-state progress separated from reclamation authority;
- semantic evacuation introduced before reclamation;
- coverage audit introduced;
- successful checkpointing no longer treated as equivalent to prune permission.

This is the stage where the distinction between:

```text
protocol_committed_through_seq
```

and:

```text
prune_safe_through_seq
```

became central.

### Primary retrospective sources

For the full reasoning and failure history:

- [DSH/Qwen harness evolution report, v0.2-v0.8](reports/0ОТЧЕТ_DSH_Qwen_harness_v0.2-v0.8.md)
- [Cross-system failure analysis](reports/4-1ОТЧЕТHOWTOMAKEAIREVIEWOFTROUBLES.md)
- [Version lineage](evidence/provenance/VERSION_LINEAGE.md)

These documents explain the architecture's evolution.

They should not be treated as stronger evidence of current runtime behavior than preserved implementation and live qualification artifacts.

## How this differs from typical long-term memory

Persistent memory, context injection, hierarchical state, session restoration and context compaction all have prior art.

This project does not claim those concepts individually as new.

The narrower architectural focus is the composition used here, especially the separation between:

1. incremental durable investigative-state commitment;
2. bounded projection of that state back into active model context;
3. separately authorized reclamation of the conversational source after semantic coverage and host-side consistency checks.

The project therefore focuses less on:

> How can an agent remember something later?

and more on:

> When does surviving state become sufficient to authorize removal of the active context that originally contained it?

That is also why durable progress and prune-safe authority have separate boundaries.

See [RELATED_WORK.md](docs/RELATED_WORK.md) for the current prior-art comparison.

## Detailed reclamation qualification

### Existing successful reclamation trace

The preserved live corpus includes a successful coverage-audited `/compress` trace where the candidate span already had sufficient surviving representation.

The audit concluded:

```text
No transfer needed; safe to prune.
```

That run reduced the active surface from approximately:

```text
25,582 tokens
```

to:

```text
18,312 tokens
```

This remains the project's explicit measured active-surface reduction example.

### Positive late-transfer qualification

The later `M7RK-5316` run exercises the complementary path where relevant material is missing from surviving state before reclamation.

The qualification sequence is:

1. `M7RK-5316` exists in older active conversation.
2. The investigative checkpoint already contains the substantive screenshot-analysis state but does not contain `M7RK-5316`.
3. `/compress` audits candidate surface `14..327`.
4. The runtime explicitly reports `M7RK-5316` as transferred.
5. The following host-injected durable state contains `M7RK-5316`.
6. A fresh chat recalls it without user repetition.

Full evidence chain:

[2026-08-28 selective capture and late transfer](evidence/qualification/2026-08-28-selective-capture-late-transfer/)

Video:

[Selective capture, late transfer and fresh-chat recovery](https://youtu.be/V3mXudvJZy4)

The `/compress` output from this run prints:

```text
Before estimated active surface: ~40232 tokens
After active surface estimate: ~40385 tokens
```

Those local estimates are not used as a compression-ratio claim.

This run is evidence for semantic evacuation, explicit late transfer and subsequent recovery.

The older `25,582 -> 18,312` trace remains the project's explicit active-surface reduction example.

### Pending semantic-gap qualification

A deliberately constructed end-to-end case in which important semantics remain uncovered and reclamation is explicitly refused is still pending.

The desired trace is:

```text
old span contains material fact X
        |
        v
surviving state does not sufficiently represent X
        |
        v
coverage audit detects the gap
        |
        v
prune-safe authority does not advance
        |
        v
old active span remains available
```

This behavior is not claimed as demonstrated by the current public corpus.

### Known transaction-ordering weakness

Live qualification also exposed an earlier partial-commit path in which audit/state commit passed but active-surface replacement failed.

The source surface remained present, so the observed failure did not delete the original context.

However, prune authority had already advanced before active-surface replacement completed.

This is preserved as evidence of a transaction-ordering / atomicity weakness rather than presented as fully atomic behavior.

## Observed project identity behavior

Qualification exposed a practical difference between tested non-Git and Git-root workspaces.

### Non-Git behavior

Two recordings show problematic isolation behavior.

[Same non-Git workspace after chat deletion, UI removal and rename](https://youtu.be/sIKrtONfS_Y)

The durable injection remained after the previous conversation was deleted, the workspace was removed from the DSH UI, the same folder was renamed, and a fresh conversation was opened.

[Previous durable state in a different new non-Git project](https://youtu.be/cNVDXxQAVok)

A different new non-Git project still received the previous project's durable state.

These observations mean that project isolation should not be inferred merely from opening a new or renamed folder in the tested non-Git setup.

### Git-root behavior

In the clean qualification:

```text
git init
```

was sufficient to establish a separate observed project boundary.

A fresh DSH session in that workspace no longer received the previous project's durable investigative injection.

The attempted initial Git commit failed because Git author identity had not been configured, so the observed separation did not depend on a successful commit or existing Git history.

For isolated qualification runs, see:

[REPRODUCTION.md](docs/REPRODUCTION.md)

This section documents current observed runtime behavior, not the complete internal identity algorithm used by DSH.

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
  | review vs acceptance
  | anti-runaway controls
  v
v0.7.x
  |
  | durable commit experiments
  | context-pressure handling
  | structured compaction
  | universal checkpoint experiments
  v
v0.8.x
  |
  | ordinary answers separated from memory protocol
  | event-driven investigative checkpointing
  | durable state separated from reclamation authority
  | semantic evacuation and coverage audit
  v
live / pre-canonical-v0.9
  |
  | live qualification
  | runtime integration fixes
  | preserved memory/context subsystem extract
  v
v1.0
  |
  `- active development
```

These labels describe development stages, not Git branches.

The repository uses `main`.

Detailed relationships are preserved in:

[VERSION_LINEAGE.md](evidence/provenance/VERSION_LINEAGE.md)

Frozen historical packages belong under:

[Historical packages](historical/)

## Evidence model

The repository distinguishes several evidence classes.

### DESIGN

Architecture, requirements and intended behavior.

Design material does not establish runtime success by itself.

### IMPLEMENTATION

Preserved code showing that a mechanism existed in a particular implementation state.

Implementation does not prove that every path was successfully exercised.

### LIVE EVIDENCE

Runtime traces, captured injections, state snapshots, recordings and observable runtime outputs.

These are the primary sources for claims about demonstrated behavior.

### REPORT / ANALYSIS

Retrospective interpretation of implementation and evidence.

Reports preserve causal reasoning, failure analysis and design rationale, but are not stronger than primary runtime evidence.

### HISTORICAL

Older frozen development material.

Historical artifacts are useful for lineage and failure analysis but should not automatically be interpreted as current-runtime behavior.

### EXTERNAL / THIRD-PARTY

DeepSeek Harness, dependencies, donor material and externally authored software.

Their inclusion does not imply authorship or relicensing by this repository.

## Native DSH vs custom control layer

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) already provides runtime/session infrastructure and host-level context-injection primitives.

This project does not claim those transport mechanisms as original work.

The custom layer concerns durable investigative-state management and reclamation semantics above those primitives, including:

- canonical durable investigative state;
- incremental investigative checkpoints;
- bounded state projection and reinjection;
- cross-chat restoration;
- semantic evacuation;
- coverage auditing;
- host-side consistency checks;
- explicit prune-safe authority;
- separation of protocol progress from reclamation authority.

## Scope and non-claims

This project does not claim to invent:

- persistent agent memory;
- hierarchical memory;
- context compaction;
- host-managed state;
- cross-session continuation;
- runtime context injection;
- checkpoints.

Those concepts have prior art.

The narrower architectural interest is the composition used here, especially the separation between durable investigative-state commitment and separately authorized coverage-gated reclamation of its conversational source.

See:

[RELATED_WORK.md](docs/RELATED_WORK.md)

The project is experimental.

A preserved historical failure is not automatically a defect in the current runtime.

A preserved implementation artifact is not automatically identical to the currently installed runtime.

A retrospective report is not primary runtime proof.

A successful semantic coverage audit is not presented as a mathematical proof of zero information loss.

## Repository map

```text
memory-stack/
    Primary preserved memory/context subsystem.

docs/
    Architecture, invariants, compaction protocol,
    failure model, related work and reproduction.

evidence/
    Primary runtime, qualification and provenance evidence.

    qualification/
        Complete evidence chains grouped by qualification case.

    live-logs/
        Standalone runtime traces and troubleshooting outputs.

    memory-injections/
        Standalone captured durable-state projections and reinjections.

    videos/
        Recording index and recording provenance.

    provenance/
        Version lineage, hashes and artifact relationships.

reports/
    Retrospective engineering reports and case-study analysis.

historical/
    Frozen historical development material.

implementation/
    Placeholder for selected broader control-layer publication.

full-environment/
    Provenance placeholder for an externally preserved environment.
```

## Primary preserved implementation

The primary preserved memory/context artifact is:

[Preserved implementation archive](memory-stack/DSH_MEMORY_V09_LIVE_EXTRACT.zip)

A browsable extracted representation is available under:

[Browsable implementation extract](memory-stack/live-extract/DSH_MEMORY_V09_LIVE_EXTRACT/)

The artifact represents a live-derived subsystem extraction rather than a byte-for-byte copy of the complete installed control package.

Its preserved module bodies come from a live-installed freeze, while the thin standalone extraction entrypoint was assembled from later live integration hooks.

See:

[Preserved implementation details](memory-stack/README.md)

Current preserved implementation state:

```text
live / pre-canonical-v0.9 development state
```

Architecture evolved through v0.1, v0.2.x, v0.7.x, v0.8.x and later live qualification work.

v1.0 is under active development.

## Provenance

Important preserved artifacts are identified with SHA-256 where practical.

Primary evidence should remain byte-for-byte unchanged where practical.

If publication requires redaction:

1. retain the untouched original privately;
2. publish a clearly labeled derivative;
3. preserve the relationship between original and derivative in provenance metadata.

Filesystem timestamps are auxiliary provenance.

Hashes and documented artifact relationships are the primary identity mechanism used by this repository.

See:

[Provenance records](evidence/provenance/)

## License

Original project code and documentation are licensed under the Apache License 2.0 unless explicitly stated otherwise.

DeepSeek Harness, third-party software, dependencies, donor material, externally authored code, bundled runtime material and historical artifacts retain their original licenses and terms.

The repository-level Apache-2.0 license does not automatically relicense third-party material.

See:

[LICENSING.md](LICENSING.md)
