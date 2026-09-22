# Plan: gate timeouts and policy knobs

**Status**: implemented | **Date**: 2026-09-21
**Scope**: processes, SDLC monitor, capability verifier, policy schema

## Objective

Gate timing was hardcoded: evidence never expired (a plan written three
weeks ago still satisfied G1), and the capability verifier's spawn budget
was a silent 15 s constant. Those settings belong in the policy file.

## Design

Two customization points, both already shaped by the process framework:

1. **Evidence freshness** (the gate timeout). `ProcessGate` gains an
   optional `timeoutMinutes`; a process-wide default lives at
   `settings.options.evidenceTimeoutMinutes`. Resolution: the per-gate
   value wins, else the process default, else undefined (never expires —
   the historical behaviour). Only a positive number counts; zero,
   negative, absent, or a wrong type all mean "no expiry", so existing
   policies keep their semantics. `observeGates` filters events older
   than the resolved freshness against an injectable clock (`now`) so
   tests pin time instead of sleeping.

2. **Verifier spawn budget**. `CapabilityPolicy` gains `timeoutMs`
   (default 15 s, preserved as `DEFAULT_VERIFIER_TIMEOUT_MS`). It flows
   from the policy's `capability` section through `checkAccess` into the
   runner; non-positive values fall back to the default.

## Policy surface

```json
{
  "processes": {
    "definitions": {
      "sdlc": { "settings": { "options": { "evidenceTimeoutMinutes": 120 } } }
    }
  },
  "capability": { "timeoutMs": 30000 }
}
```

Per-gate override: `definitions.sdlc.gates: [{ "id": "G5", "timeoutMinutes": 60 }]`.

This tree ships `evidenceTimeoutMinutes: 0` (explicit no-expiry) in
`.lifecycle-guard/policy.json` so the knob is visible where the operator
expects to find it.

## Verification

- Ten tests covering fresh/stale filtering, freshness materialization,
  override precedence, type-safety of the options bag, runner budget
  pass-through, and the preserved default.
- Full package suite green after the change.
