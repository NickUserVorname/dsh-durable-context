# Provenance

This directory records identity and lineage for preserved artifacts.

## Files

[ARTIFACT_MANIFEST.md](ARTIFACT_MANIFEST.md)

Human-readable roles, identities and provenance notes for primary preserved artifacts and live evidence.

[SHA256SUMS.txt](SHA256SUMS.txt)

SHA-256 records for preserved repository artifacts.

[VERSION_LINEAGE.md](VERSION_LINEAGE.md)

High-level development lineage and the distinction between frozen versions, live/pre-v0.9 state and future v1.0 work.

## Rule

Hashes and documented artifact relationships are the primary identity mechanism used by this repository.

Filesystem timestamps are auxiliary provenance.

A hash proves byte identity, not architectural correctness.

For runtime behavior see:

[`../`](../)
