# local-dsh-v4-control 0.8.0

Host-owned control bundle for the local Qwen3.8-27B DeepSeek Harness profile.

## v0.8 answer and memory path

Ordinary top-level turns are direct: `USER -> MAIN QWEN <-> tools -> ANSWER`. There is no mandatory commit-before-answer and no separate finalizer inference.

During investigative / iterative problem-solving (troubleshooting, debugging, research/OSINT, testing, experiments, analytical investigation, or iterative construction), MAIN may attach one optional `state_checkpoint` to the same assistant response when a material transferable finding was established. The tool commits only durable working-state semantics and calls DSH `concludeTurn()`, so no follow-up finalizer request is required. If no material state changed, the tool is omitted.

`state_checkpoint` preserves concrete diagnostic evidence when useful (exact log/output lines, values, file:line, fingerprints, reproduction conditions, counterexamples). Incremental checkpoints never authorize pruning by themselves.

## Context policy

- Level A, always-on: deterministic lossless hygiene collapses only identical contiguous tool exchanges to one exact exchange plus `xN`; the append-only raw session log is unchanged.
- Level B, rare: `/compress` runs a fresh `CONTEXT_COMPACTOR` only when explicitly requested / offered under pressure. It performs semantic evacuation from the old visible/tool span into surviving canonical/working state, returns a coverage audit, and fails closed on uncertainty. Only then may `prune_safe_through_seq` advance and the active surface prefix be replaced.
- Hidden reasoning is not a compaction target; the qualified llama profile uses `--no-reasoning-preserve`.

## Other hardening retained

Source authority, durable source conflicts, recoverable triage transactions, worktree mutation containment, ASK/AUTO execution policy, independent TEST/REVIEW/ACCEPT roles, dynamic remaining-validation reserve, token accounting, evidence publication, and fail-closed guards remain host-owned. Productive tool headroom is raised by about 20% in v0.8; protocol terminal tools do not consume productive-role tool budget.
