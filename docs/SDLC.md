# SDLC discipline and the improvement loop

> SDLC is one declared process among several. The framework that carries it, and
> how to declare another process (research, deck, migrations), is in
> [docs/PROCESSES.md](PROCESSES.md); the gate sequence below is the `sdlc`
> process specifically.

The repository already had a process. It was not enforced, so it drifted. This
document describes how the harness now enforces the process that exists, and how
the enforcement itself is measured and corrected.

## Where the gates come from

Nothing here is a new opinion about how software should be built.

| Source | What is reused |
| --- | --- |
| `gate-protocol` convention (G0-G11) | the gate sequence, the review council at G8, the spec-first rule at G3/G4 |
| `harness-slos` convention | the harness has measurable objectives, so "the trigger is too lenient" is a measurement |
| `fitness-functions` convention | static checks belong in CI, where silence is visible |
| repository `harness.yaml` | sensors and the project's own gate commands |
| `.github/gate-thresholds.yml` | weighted gate aggregation with blocking gates and an overall threshold |

The gate identifiers in the code are therefore the ones people already cite
(`G5` is "run the repository gates", `G8` is the council), not a parallel
vocabulary invented by a tool.

## The gate model

Each gate declares its stage, how it is enforced, the actions it guards, the
evidence that satisfies it, why it exists, and where it came from. A gate with
no observable evidence (commit subject hygiene, for example) is *advisory*:
reported, never demanded, because a detector that cannot see the thing would
only produce noise.

Three enforcement levels:

- `block` - the action is refused and the refusal carries the instruction, which
  the model reads. For a gated action, a block *is* the nudge.
- `nudge` - the instruction is appended to the next tool result, so it arrives in
  the same turn, where acting on it is still cheap.
- `off` - not enforced here.

## The monitor

The monitor answers one question at the moment it matters: the agent is about
to commit, push, open a pull request, or merge, and the repository says a gate
must have fired. Is there evidence it did?

Evidence is concrete: a read of `AGENTS.md`, a write under `specs/**` or
`docs/**/reviews/`, a successful run of a gate command. A *failed* gate command
is not evidence. Test discipline is evaluated from the same activity log:
implementation written with no test file touched is reported as a claim without
a check.

## The telemetry

Every gate evaluation, nudge, fire, promotion, and rollback is appended to
`.lifecycle-guard/sdlc-ledger.jsonl`. This is the substrate for the whole
loop, because from inside a session two very different situations look the same:

- a discipline that is habitual, so its trigger correctly stays quiet, and
- a trigger that is too lenient to fire at all.

The ledger separates them with four numbers per gate: fires, misses, nudges, and
nudges answered inside a compliance window.

## The improvement loop

`lifecycle-guard sdlc report` reads the ledger; `sdlc propose` turns the findings
into bounded proposals; `sdlc apply <id> --confirm` changes one field of the
policy and records the value it replaced; `sdlc rollback <gate-id>` restores it.

The mechanics follow the shared discipline of the self-improvement literature
rather than its scale:

- Reflexion (Shinn et al., 2023) and Self-Refine (Madaan et al., 2023) showed
  that an agent can correct itself from outcome feedback, in words, without
  retraining. The ledger is that feedback, made durable.
- CRITIC (Gou et al., 2023) added tool-grounded critique: verify with something
  outside the model. Here that is the gate command and the CI check, not the
  agent's own summary.
- The 2025 line moves from prompting to mechanisms. The Darwin Godel Machine
  (Zhang et al., 2025) evolves an agent's own code behind an archive and a
  safety gate; SEAL (Zweiger et al., 2025) trains on self-generated feedback
  signals; AlphaEvolve (Novikov et al., 2025) runs an evolutionary search over
  candidate programs with automated evaluation. What is borrowed is what they
  agree on: bounded edits, evaluation before promotion, an archive of attempts,
  and a way back.

What is deliberately **not** borrowed is unbounded self-modification. A proposal
may move one gate by one step. A change that would rewrite several gates is a
redesign, and a redesign belongs in review, not in a maintenance job. Every
promotion is audited, and every promotion is reversible.

## The review side

The repository-side loop was the weakest part: pull requests were opened and
nothing checked whether they cleared *every* gate, and review findings had no
path back into the code.

- `review gates --pr N` reports the checks, the review decision, and the open
  findings, and exits non-zero when the pull request is not complete. It exists
  because "CI is green" and "the gate protocol was satisfied" are different
  claims, and only the second one is worth merging on.
- `review council --pr N` emits the council brief: rounds, the rule that a
  minority objection blocks the merge until answered in writing, and the record
  that must be produced under `docs/**/reviews/`.
- `review loop` classifies findings into fix, human decision, and skipped, so a
  finding ends as fixed, deferred with a tracked task, or rejected with a
  reason. Silence is not an outcome.

## Configuration

```json
{
  "sdlc": {
    "enabled": true,
    "nudgeTolerance": 3,
    "gateCommands": ["verify_ui.sh", "pytest"],
    "gates": {
      "G1": { "enforcement": "block" },
      "G9": { "enforcement": "off" }
    },
    "tdd": {
      "implementationGlobs": ["src/**", "packages/**/src/**"],
      "testGlobs": ["test/**", "tests/**", "**/*.test.ts", "**/*_test.py"]
    }
  }
}
```

A repository overrides what it disagrees with; the rest stays on, because the
failure being corrected was not over-enforcement.

## What is not claimed

- The monitor sees tool calls, not intent. An agent that writes a test file with
  no test in it satisfies the letter of the TDD check.
- The ledger measures the harness, not the work. A gate that fires on a command
  that verified nothing looks the same as a real verification; the gate command
  owning its own honesty (exit codes, coverage output) is what makes it evidence.
- Promotions are proposals, not proofs. The tolerance is three observations, and
  a promotion that makes the loop worse is visible as a falling compliance rate
  and one `rollback` away from being undone.
