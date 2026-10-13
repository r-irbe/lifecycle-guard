---
garden_schema_version: "0.1"
taxonomy_version: "0.1.0"
doc_id: tacitdoc:src-findings-engine
title: "Source Card: Findings Engine Specification"
slug: src-findings-engine
document_role: source-registry
lifecycle_state: active
disposition: adopt
evidence_strength: direct
confidence: high
source_family: "Loomdb Guard Campaign"
edition: "v0 (2026-10)"
doi_or_url: "https://github.com/r-irbe/loomdb"
primary_concepts:
  - "Weighted multi-finding adjudication"
  - "Two-gate disposition with abstain band"
  - "Judge trust as a category-specific Beta posterior"
  - "Panel model-role separation (judge vs generator)"
  - "Inert-class coverage checking"
downstream:
  - "docs/investigation-garden/inbox/engine/02_FORMAL_VERIFICATION_LEAN4_RULE_ENGINE.md"
parent_mocs:
  - "docs/investigation-garden/mocs/MOC-policy-corpora.md"
id: "src-findings-engine"
maturity: "seedling"
verification: "unverified"
sources:
  - "https://github.com/r-irbe/loomdb/tree/main/packages/orchestrator/lib/findings.cjs"
  - "https://github.com/r-irbe/loomdb/tree/main/docs/design/findings-engine.md"
indexed-by:
  - "MOC-policy-corpora"
related:
  - "MOC-policy-corpora"
---

# Findings Engine Specification

The escalation layer for a coding-agent guard. When the deterministic
policy engine returns `escalate`, the escalation layer weighs the decision
using independently operated judge models, producing a disposition that
is advisory to the operator and fully audited.

## Finding schema

```json
{
  "finding_id": "string",
  "judge_id": "string",
  "category": "string (from the sealed taxonomy)",
  "category_version": "integer",
  "severity": "integer 0-4",
  "confidence": "number 0-1",
  "evidence_refs": ["array of strings"],
  "created_at": "ISO 8601"
}
```

Judges never supply weights; weights are derived from severity,
confidence, trust, and evidence quality. The taxonomy is sealed: new
categories require recorded human approval.

## Weight model

```
weight = base(severity) x confidence x judge_trust x evidence_quality
```

Base weights are integer-scaled: sev 0 = 0, sev 1 = 10, sev 2 = 25,
sev 3 = 60, sev 4 = 100. The weight is rounded to an integer.

## Disposition (two gates + abstain band)

1. **Quota gate**: at least `minFindings` (default 2) findings, OR at least
   one finding at severity >= `minFindingsExceptionSeverity` (default 3).
   Quota unmet -> `needs_human`.
2. **Weight gate**: weighted sum >= `weightedSumThreshold` (default 120)
   -> `deny`; sum <= `abstainLow` (default 40) AND `triggers.autoAllow`
   AND no severity-4 finding -> `auto_allow`; otherwise -> `needs_human`.

Any severity-4 finding forbids `auto_allow`.

## Judge trust

Per-(judge, category) Beta posterior. Trust is a discount factor in (0, 1]:
an unknown judge starts at full trust 1.0, disagreements pull it down, and
exponential decay (~90-day half-life) returns stale records toward 1.0.
Trust is item-specific by category, not a model-level constant.

## Model-role separation

The judge and the generator must be different model families. A judge that
shares the generator's training can share its blind spots. The judge
classifies; a separate code-generation model authors policies. Neither
model runs in the tool-call path (the deterministic engine makes every
block/allow decision).
