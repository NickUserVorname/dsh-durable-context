# Invariants

1. Incremental checkpointing does not independently grant prune authority.

2. `protocol_committed_through_seq` and `prune_safe_through_seq` represent different claims.

3. Uncertain semantic coverage fails closed.

4. Critical continuation state must survive bounded projection.

5. Failed hypotheses and do-not-repeat knowledge are first-class investigative state.

6. A bounded model-facing projection is not the canonical durable state.

7. Irreversible reclamation authority belongs to the host/runtime layer rather than transient model context.

8. Relevant session, source and state identity must be rechecked before reclamation commit.

9. An audit computed over a stale basis must not authorize reclamation against a changed basis.

10. Recent conversation may remain as ordinary visible history while older audited context is reclaimed.

11. Raw or historical evidence should remain independently auditable where practical.

12. Native DSH context transport is distinct from the custom durable-state and reclamation policy built above it.

13. A successful test or checkpoint is not automatically equivalent to user acceptance or semantic completeness.

14. Historical artifacts must not be silently presented as the current implementation.
