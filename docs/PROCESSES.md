# Processes

SDLC is one process among several. A repository declares which processes are
active, what gates each one has, and how each gate is enforced. The code ships
defaults as data; the policy is the source of truth.

```bash
lifecycle-guard process list              # declared processes, gate counts, sources
lifecycle-guard process describe sdlc     # every gate, why it exists, where it came from
lifecycle-guard process status research   # which gates have recorded evidence
lifecycle-guard process report            # fires, misses, nudges, compliance per gate
lifecycle-guard process propose           # bounded proposals for lenient gates
lifecycle-guard process apply <id> --confirm
lifecycle-guard process rollback <gate-id>
```

`sdlc ...` remains an alias for `process ... sdlc`, because SDLC was the first
process and its commands should not disappear when the second one arrived.

## What a process is

```json
{
  "processes": {
    "enabled": ["sdlc", "research", "deck"],
    "definitions": {
      "sql-migrations": {
        "title": "Schema migrations",
        "source": "ADRs 12-14",
        "stages": ["draft", "review", "apply"],
        "gates": [
          {
            "id": "M1",
            "title": "A reversible down migration exists",
            "stage": "draft",
            "enforcement": "block",
            "requiredBefore": ["gh pr create", "git commit"],
            "evidence": { "paths": ["migrations/**"], "commands": ["migrate check"] },
            "why": "A migration without a down path is an outage waiting for a bad deploy.",
            "source": "ADR-12"
          }
        ],
        "settings": { "nudgeTolerance": 2, "gateCommands": ["migrate check"], "options": {} }
      }
    },
    "disabled": ["sdlc/G9"]
  }
}
```

Every field is data, and every gate carries the reason it exists and the rule it
comes from. A definition that names a built-in process id overrides it
gate-by-gate; an unknown id declares a new process.

## Enforcement levels

| Level | Effect |
| --- | --- |
| `block` | the gated action is refused, and the refusal carries the instruction |
| `nudge` | the instruction is appended to the next tool result, in the same turn |
| `off` | not enforced here (also `disabled` per gate id) |

Gates with nothing observable in a tool call (commit subject hygiene, for
example) are **advisory**: reported, never demanded. A gate whose evidence the
monitor cannot see would otherwise produce only noise.

## The built-in declarations

| Process | Gates | Source of the gates |
| --- | --- | --- |
| `sdlc` | G0-G11 | the gate-protocol convention: discover, spec-first, gates before commits, review council at G8, findings folded back at G11 |
| `research` | R1-R5 | investigation conventions: state the question, record sources, evidence keys, register what was rejected, link from the index |
| `deck` | D1-D3 | author through the generator, run the deck linter, trace claims to the primary source |

## Why this shape

The first version of this code put the SDLC gates in TypeScript. That made SDLC
the only process that could be enforced, and made every change to enforcement a
code change. Both are wrong for a repository that already runs several
disciplines, so the model is now: **declarations are data, the engine is
generic, and the policy decides**.

The property this buys is the one that was missing: enforcement can be inspected
and argued with in one file, next to the rules it enforces, by someone who is not
reading TypeScript.

## Telemetry and the loop

Every gate evaluation, nudge, fire, promotion and rollback is appended to
`.lifecycle-guard/sdlc-ledger.jsonl`, tagged with its process. `process report`
shows, per gate: fires, misses, nudges, and nudges answered. That is what
separates a discipline that is habitual from a trigger too lenient to fire, and
the distinction decides whether hardening a gate would help or only add noise.
`process propose` turns the difference into one bounded, reversible change.

See [docs/SDLC.md](SDLC.md) for the review council, the pull request gate
follow-up, and the literature the loop borrows from.

## Limits

- The engine reads tool calls, not intent. A process whose evidence lives outside
  a session (a human approval, a deployment window) can be declared but not
  verified; declare such gates advisory rather than pretending.
- One ledger per repository, not per process, so `process report` filters rather
  than isolates.
- Gate ids must be unique within a process; across processes they are prefixed by
  the process when reported, and the monitor keeps them separate.
