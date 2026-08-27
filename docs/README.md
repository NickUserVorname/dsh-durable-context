# Technical Documentation

This directory contains design, protocol and qualification documentation.

These documents describe architecture and intended/implemented semantics. They are not, by themselves, primary runtime evidence.

## Reading order

1. [Memory Architecture](MEMORY_ARCHITECTURE.md)
   - canonical durable state, bounded projection and the separate reclamation path.

2. [Compaction Protocol](COMPACTION_PROTOCOL.md)
   - semantic evacuation, coverage gating, basis rechecks and prune authority.

3. [Invariants](INVARIANTS.md)
   - compact list of architectural rules that should remain true across versions.

4. [Failure Model](FAILURE_MODEL.md)
   - recurring failure classes and the model/host responsibility split.

5. [Reproduction and Qualification](REPRODUCTION.md)
   - demonstrated behavior, missing semantic canaries and evidence to capture.

6. [Related Work](RELATED_WORK.md)
   - prior-art positioning and claim discipline.

## Evidence boundary

For behavior actually observed in a running system, prefer:

- [`../evidence/`](../evidence/)

For preserved implementation, see:

- [`../memory-stack/`](../memory-stack/)

For retrospective engineering analysis, see:

- [`../reports/`](../reports/)

For frozen version lineage, see:

- [`../historical/`](../historical/)

