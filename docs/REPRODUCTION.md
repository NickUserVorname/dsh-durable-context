# Reproduction and Qualification

This document separates general reproduction steps from claims already demonstrated in the preserved live corpus.

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

## Positive reclamation canary

This is the strongest missing deliberately constructed end-to-end positive test.

1. Place a unique canary fact X only in older active history.
2. Verify X is not already represented in canonical durable state.
3. Run compaction audit / evacuation.
4. Verify X is transferred into canonical state.
5. Verify coverage succeeds against the exact audit basis.
6. Verify `prune_safe_through_seq` advances only after host rechecks.
7. Verify the old active span containing the original X disappears from the model-facing surface.
8. Continue the investigation.
9. Verify the agent correctly uses X without re-reading the old raw span.

Expected trace:

```text
old span contains X
        |
        v
X transferred into canonical state
        |
        v
coverage audit succeeds
        |
        v
prune-safe boundary advances
        |
        v
old active origin is reclaimed
        |
        v
later turn correctly uses X
```

## Negative reclamation canary

This is the strongest missing deliberately constructed fail-closed semantic test.

1. Place a unique canary fact X in older active history.
2. Construct the survivor basis so X is not sufficiently represented.
3. Run the audit path.
4. Verify the audit reports uncovered / uncertain semantics.
5. Verify prune authority does not advance.
6. Verify the old active span remains present.

Expected trace:

```text
old span contains X
        |
        v
X is not sufficiently represented
        |
        v
audit detects the gap
        |
        v
prune-safe boundary does not advance
        |
        v
old active span is retained
```

## Already preserved live evidence

The current corpus already demonstrates:

- investigative checkpointing with prune authority still unset;
- later durable-state reinjection;
- successful coverage-audited `/compress`;
- real active-surface reduction;
- repeated compaction after hotfix;
- compaction unavailable when validated prune authority is absent.

The current corpus does not yet demonstrate both canary tests above as deliberately constructed end-to-end traces.

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

For current evidence locations see [../evidence/](../evidence/).
