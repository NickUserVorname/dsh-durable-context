# Engineering Reports

This directory contains retrospective engineering analysis.

Reports are not primary runtime evidence.

Primary runtime evidence belongs under:

[`../evidence/`](../evidence/)

## Main reports

- [DSH/Qwen harness evolution report](./0ОТЧЕТ_DSH_Qwen_harness_v0.2-v0.8.md)
  - detailed v0.2-v0.8 architecture evolution, failure analysis, qualification status and design changes;
  - preserves the evidence status and interpretation available when the report was written.

- [Cross-system failure analysis report](./4-1ОТЧЕТHOWTOMAKEAIREVIEWOFTROUBLES.md)
  - broader comparison across Codex/Sol, Qwen and DeepSeek V4 failure classes;
  - focuses on which decisions should remain model-driven and which should move into host authority.

## Reading rule

A report can contain statements such as `UNTESTED` or `LIVE QUALIFICATION PENDING` that were correct at the time of that report.

Later live qualification can add evidence without making the old report a false historical artifact.

For current live status, prefer:

1. `../evidence/qualification/`
2. `../evidence/live-logs/`
3. `../evidence/memory-injections/`
4. `../memory-stack/`
5. current root `README.md`
6. reports for causal history and interpretation

## Report provenance

The reports contain Russian and English text and may contain external citations.

Report-local filenames identify the source labels used during the original analysis. A filename mentioned inside a report does not by itself mean that the corresponding raw source is published in this repository.

The engineering body is not rewritten merely to make the repository look cleaner.

A public repository copy may omit appended raw personal notes that are not part of the engineering report. The omitted material is preserved outside the public repository in the pre-publication documentation backup.

Public-link cleanup may remove tracking query parameters from external URLs without changing the cited destination.
