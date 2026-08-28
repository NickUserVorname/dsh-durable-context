# Reproduction and Qualification

This document separates general reproduction steps from claims already demonstrated in the preserved live corpus.

## Isolated qualification workspace

Current qualification evidence shows a practical difference between tested non-Git workspaces and a Git-root workspace.

Two recordings show previous durable state persisting or appearing across non-Git workspace changes:

- [State persists after chat/UI reset and folder rename](https://youtu.be/sIKrtONfS_Y)
- [Previous state injected into a different new non-Git project](https://youtu.be/cNVDXxQAVok)

For an isolated qualification run, initialize the test workspace as its own Git repository before beginning:

```powershell
git init
```

In the clean qualification, the previous project's durable investigative state was no longer injected after `git init`:

[Clean Git-root qualification](https://youtu.be/V3mXudvJZy4)

A successful commit was not required for the observed boundary. The attempted initial commit failed because Git author identity was not configured.

Before beginning an isolated qualification workload:

1. create or choose the test folder;
2. run `git init`;
3. open a fresh DSH session;
4. inspect the host context injection;
5. verify that unrelated durable state is absent;
6. begin the qualification workload.

This is an observed reproduction condition, not a complete specification of DSH's internal project-identity algorithm.

## Durable accumulation

1. Establish investigative finding A.
2. Commit the material finding into durable state.
3. Establish finding B.
4. Commit again.
5. Inspect canonical durable state.
6. Verify that relevant information from both stages survives according to merge semantics.

## Fresh-session restoration

1. Commit durable state in session A.
2. Open a fresh DSH session under the same project/workspace identity.
3. Before manually reconstructing the investigation, observe the host-projected investigative state.
4. Verify that continuation-relevant material from session A is available.

## Projection pressure

Increase bulk state fields beyond the normal model-facing projection budget.

Verify that critical fields survive while bulk fields may be bounded and the complete canonical state remains available separately.

## Demonstrated positive late-transfer qualification

The 2026-08-28 `M7RK-5316` case demonstrates the positive semantic-transfer path during successful `/compress`.

[Machine-readable qualification case](../evidence/qualification/2026-08-28-selective-capture-late-transfer/)

[Qualification video](https://youtu.be/V3mXudvJZy4)

Observed sequence:

1. `M7RK-5316` exists in older active conversation.
2. The pre-compress investigative checkpoint does not contain it.
3. `/compress` audits candidate surface `14..327`.
4. The runtime explicitly reports `M7RK-5316` as transferred.
5. The following host-injected durable state contains it.
6. A fresh chat recalls it without user repetition.

The local before/after token estimates printed in this run are not used as compression-ratio evidence.

## Fail-closed qualification boundary

The protocol is designed to refuse reclamation when semantic coverage cannot be established.

The demonstrated `M7RK-5316` qualification exercises the normal recoverable-gap path: relevant material was absent from the pre-compress durable state, semantic evacuation discovered it, and the material was transferred into surviving state.

If missing semantics remain available and recoverable, transfer is the intended behavior. A meaningful fail-closed qualification would instead require a realistic case where coverage remains unresolved after evacuation.

The current public corpus does not separately claim such a naturalistic unresolved-coverage refusal case.

## Already preserved live evidence

The current corpus demonstrates:

- investigative checkpointing with prune authority still unset;
- later durable-state reinjection;
- successful coverage-audited `/compress`;
- real active-surface reduction;
- repeated compaction after hotfix;
- compaction unavailable when validated prune authority is absent;
- positive late semantic transfer of `M7RK-5316`;
- subsequent host reinjection and fresh-chat recovery;
- observed Git-root isolation in the clean qualification;
- problematic non-Git isolation behavior in the recorded cases.

## Evidence to capture

Record where practical:

- package identity;
- runtime identity;
- checkpoint identity;
- state hash;
- session revision;
- source revision;
- canonical/working-state fingerprints;
- candidate sequence range;
- prune-safe boundary before and after;
- active-surface estimate before and after;
- exact audit result;
- exact runtime output.

For current evidence locations see [Evidence](../evidence/).
