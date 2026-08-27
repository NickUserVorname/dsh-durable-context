# Memory Architecture

## Canonical durable state

The durable unit is not an individual injected message.

Material investigative findings are accumulated into project-level canonical working state.

A model-facing memory injection is a bounded projection of that surviving state, not the authoritative storage unit itself.

The durable state can carry fields such as:

- known facts;
- constraints;
- decisions;
- evidence;
- failed hypotheses;
- do-not-repeat items;
- open acceptance conditions;
- next actions.

## Incremental investigative state path

Conversation and tool activity can produce material findings.

When a finding is useful for continuing the same investigation after older visible history is gone, it can be transferred through an investigative checkpoint into durable state.

Later turns can receive a bounded projection of the accumulated state.

A normal investigative checkpoint records continuation state. It does not independently authorize removal of older active context.

## Reclamation path

Context reclamation is deliberately separate:

1. select an old completed-turn candidate span;
2. compare it with surviving canonical state;
3. identify live semantics not yet represented;
4. transfer missing material when possible;
5. audit semantic coverage;
6. recheck relevant session/source/state identity;
7. authorize a prune-safe boundary only after those checks;
8. replace the audited active surface.

If semantic coverage is uncertain or incomplete, reclamation fails closed.

## Two different progress markers

`protocol_committed_through_seq` means protocol/state progress has been recorded.

`prune_safe_through_seq` means the host has separately authorized reclamation up to a sequence boundary.

They are not equivalent.

A live investigative checkpoint has been observed with protocol progress committed while `prune_safe_through_seq` remained unset.

## Projection is not storage

The model-facing projection may be bounded under context pressure.

The complete canonical state remains separately available.

Critical continuation fields should survive projection even when bulk fields are reduced.

## Native DSH boundary

DSH already provides runtime/session infrastructure and host-level context transport.

The custom layer described here concerns durable investigative-state semantics, bounded projection, coverage audit and reclamation authority above those primitives.

See:

- [Compaction protocol](COMPACTION_PROTOCOL.md)
- [Invariants](INVARIANTS.md)
- [Reproduction](REPRODUCTION.md)
