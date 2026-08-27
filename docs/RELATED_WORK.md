# Related Work

This project does not claim to invent persistent agent memory, hierarchical memory, context compaction, host-managed state or cross-session continuation.

Individual components have prior art.

The narrower question is whether prior work matches the exact composition used here, especially the separation between incremental durable investigative-state transfer and separately authorized coverage-gated reclamation of old active context.

## Prior-art review snapshot

Review snapshot date: 2026-08-27.

### MemGPT

MemGPT introduced virtual context management and memory tiers for extended context and multi-session agents.

Reference:

https://arxiv.org/abs/2310.08560

### Active Context Compression / Focus

Focus gives an agent a persistent Knowledge block and lets it autonomously consolidate and prune raw interaction history.

This is close to the consolidate-then-prune pattern.

Reference:

https://arxiv.org/abs/2601.07190

### Parallel Context Compaction

Parallel Context Compaction studies lossy summarization and operator control over compaction for long-horizon agent serving.

Reference:

https://arxiv.org/abs/2605.23296

### MEMTIER

MEMTIER uses tiered structured memory, retrieval and consolidation for long-running autonomous agents.

Reference:

https://arxiv.org/abs/2605.03675

### State-Aware Runtime for Long-Horizon LLM Agents

State-Aware Runtime describes canonical state, bounded state views, validation, commits, rollback/compensation, handoff and audit as a runtime-governance problem.

Version 4 was posted on 2026-08-17.

Reference:

https://doi.org/10.33774/coe-2026-vt9t2-v4

### Governed Persistent Memory

Governed Persistent Memory focuses on source-bound state semantics and fail-closed release of memory-supported claims.

Reference:

https://arxiv.org/abs/2608.12476

### The Compaction Cliff

The Compaction Cliff studies cumulative safety-rule loss under repeated compaction and proposes type-aware retention policies.

Reference:

https://arxiv.org/abs/2608.22752

## Current positioning

Among the sources reviewed in this snapshot, no public system was identified that matches the exact composition used in this repository, particularly:

```text
incremental durable investigative state
        !=
prune authorization

old active candidate
        +
surviving state
        |
        v
semantic evacuation
        |
        v
coverage audit
        |
        v
host basis recheck
        |
        v
explicit prune-safe boundary
        |
        v
active-context reclamation
```

This is not a claim of proven global novelty.

The defensible claim is narrower:

> Individual components have prior art. Among the sources reviewed in the current snapshot, no public system was identified that matches this exact composition, especially the authorization semantics applied before reclaiming old active context.

## Claim discipline

Do not describe the project as:

- the first persistent-memory system;
- the first context-compaction system;
- the first cross-session agent memory;
- proven globally novel.

Describe it as an engineering/research prototype with a specific composition and preserved live evidence.

For the actual protocol see [COMPACTION_PROTOCOL.md](COMPACTION_PROTOCOL.md).

