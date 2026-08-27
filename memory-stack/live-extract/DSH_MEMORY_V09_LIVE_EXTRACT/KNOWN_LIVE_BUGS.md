# Known live bugs retained in this extraction

## P0 — checkpoint owns turn termination

`lib/universal-commit.js` still calls `exec.concludeTurn()` after a successful `state_checkpoint`.
Observed live failure modes in the supplied logs:

1. successful checkpoint followed by `Cannot read properties of undefined (reading 'aborted')`;
2. successful checkpoint with `concludes_turn: true` but no visible assistant reply delivered to the user.

The memory data model/persistence should be preserved; turn termination should be decoupled in the cleaned implementation.

## Compaction transaction ordering

A prior live run demonstrated state/audit commit succeeding before active-surface replacement failed. The cleaned implementation should be retry-safe/two-phase and advance the prune-safe boundary only after successful surface replacement.

## Legacy coupling

The memory subsystem still uses the old project runtime and role-budget infrastructure. This extraction keeps those dependencies for fidelity. The next refactor should replace them with a small memory store/runtime adapter rather than dragging STRICT task lifecycle state into normal memory operation.
