# lifecycle-guard User Guide

`lifecycle-guard` is a fail-closed SDLC policy engine, schema contract suite, and CLI for governing coding-agent tool calls, protected paths, unicode hygiene, and verification gates.

## 1. Installation

Requires Node.js >= 22.0.0. Zero external runtime dependencies.

```bash
git clone https://github.com/r-irbe/lifecycle-guard.git
cd lifecycle-guard
npm test
```

## 2. CLI Commands

### `lifecycle-guard setup`

Detects the repository technology stack (`package.json`, `Cargo.toml`, `pyproject.toml`, `lakefile.lean`) and writes a tailored `.pi/harness-bridge/policy.json`:

```bash
lifecycle-guard setup --detect
lifecycle-guard setup --detect --template agent-fleet
lifecycle-guard setup --force
```

### `lifecycle-guard policy check`

Validates `.pi/harness-bridge/policy.json` (or `.lifecycle-guard/policy.json`) against `schemas/policy.schema.json` and audits workspace source files for banned invisible/bidi/tag Unicode codepoints:

```bash
lifecycle-guard policy check
lifecycle-guard policy check /path/to/repo
```

### `lifecycle-guard verify`

Executes all verification gate commands declared under `verification.runs` in `policy.json`:

```bash
lifecycle-guard verify
```

### `lifecycle-guard --help` / `--version`

Prints CLI usage or version information and exits 0.

## 3. Schemas

Canonical JSON Schemas live under `schemas/`:
- `schemas/policy.schema.json` / `schemas/sdlc-policy.v1.json`: SDLC policy rules, protected paths, escalation mode, and commit hygiene.
- `schemas/finding.v1.json`: Escalation judge finding contract.
- `schemas/lease.v1.json`: Multi-writer workspace lease contract.
- `schemas/resume-brief.v1.json`: Session continuation brief contract.
- `schemas/review-queue.v1.json`: Automated review finding queue contract.
- `schemas/visibility.v1.json`: TLP-derived repository visibility contract.
