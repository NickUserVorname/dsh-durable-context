# Evidence

This directory contains primary runtime and provenance evidence.

It is intentionally separated from retrospective engineering reports.

## Categories

`live-logs/`

Runtime qualification and troubleshooting traces. These are primary evidence and should not be rewritten merely for readability.

`memory-injections/`

Captured durable-state and reinjection examples.

`videos/`

External-viewing information and original-recording metadata.

`provenance/`

Artifact manifests, hashes and development lineage.

## Usage evidence

`serverless-usage-2026-08-21.png`

Provider usage dashboard captured after the development/qualification workload.

`usage-2026-08-19.redacted.csv`

Public redacted derivative of provider usage records.

Usage evidence demonstrates workload volume. It does not by itself demonstrate architectural correctness.

## Evidence hierarchy

Prefer claims in this order:

1. primary live trace / captured runtime state;
2. preserved implementation;
3. deterministic tests and package validation;
4. retrospective report/analysis;
5. design intent.

Different evidence classes should not be silently conflated.

## Redaction

If a public version requires redaction:

- preserve the untouched original privately;
- label the public version as a derivative;
- do not claim the derivative is byte-identical to the private original.

## Preservation

Important evidence should be identified by SHA-256 where practical.

See:

- [Artifact manifest](provenance/ARTIFACT_MANIFEST.md)
- [SHA-256 records](provenance/SHA256SUMS.txt)
- [Version lineage](provenance/VERSION_LINEAGE.md)
