# CI: local first, GitHub for the attested subset

Pull requests in these repositories need approval, and an asynchronous agent
runs reviews, so a failing check on the forge is expensive: it costs a push, a
wait, and someone's attention. The cheap failures belong on the machine doing
the work.

The split is declared in the policy, not in the workflow files, so "why is this
on GitHub and not local" has one answer in one place:

```json
{
  "ci": {
    "local": {
      "runner": "act",
      "stages": ["guard-diff", "ascii", "unit"],
      "requireBeforePush": true,
      "image": "catthehacker/ubuntu:act-latest",
      "platform": "linux/amd64",
      "secretsFile": ".act.secrets",
      "workflow": ".github/workflows/lifecycle-gates.yml",
      "job": "gates"
    },
    "github": {
      "stages": ["guard-diff", "ascii"],
      "workflow": ".github/workflows/lifecycle-gates.yml"
    },
    "stages": {
      "guard-diff": { "command": "lifecycle-guard guard diff --base origin/HEAD", "reason": "..." },
      "ladder": { "command": "bash scripts/verify_ui.sh", "long": true, "reason": "..." }
    }
  }
}
```

```bash
lifecycle-guard ci plan          # what runs where, and why
lifecycle-guard ci doctor        # is this machine ready (act, docker, workflow, pre-push)
lifecycle-guard ci generate      # write the workflow, the local runner, .actrc
lifecycle-guard ci local         # run the local subset
lifecycle-guard ci local ascii   # one stage
```

## One definition, two runners

`ci generate` writes **one** workflow file. `act` executes it locally in a
container; GitHub executes the same file for the subset the policy marks as
attested. That is the point: a local pass and a forge pass run the same steps, so
"it worked locally" and "it worked in CI" stop being different claims.

The generated `scripts/ci/local.sh` never commits to a runner. It tries `act`
and, when act is missing or absent from the machine that runs it, runs the same
stage commands directly and *says so*. A silent fallback would make a local pass
a weaker claim than it looks, which is the failure mode this whole layer exists
to avoid.

## What belongs on GitHub

The subset that has to be authoritative rather than convenient:

- anything a **branch rule** should require, because a status only exists if the
  forge produced it;
- scans whose result must not depend on the author's environment;
- the **gate-completeness report** (`review gates --pr N`), because it reads the
  pull request's checks and review decision.

Everything else runs locally first. A long ladder is marked `"long": true` so it
can stay out of the pre-push set while remaining available on demand.

## A stage that does not apply

A stage exits **77** to report that it does not apply on this machine (the
convention automake uses for a skipped test). The generated runner counts it,
says so, and keeps going:

```text
== Dependency audit
   skipped: the stage reported that it does not apply here
...
local CI: complete: 6 stage(s) ran, 1 skipped
```

A stage that cannot run is a different fact from one that failed, and a runner
that conflates them trains people to ignore it. Only 77 is treated this way: any
other non-zero status stops the run, prints the status, and suppresses the
summary line, so a truncated run cannot be mistaken for a complete one.

Two details matter to whoever writes a stage. The runner captures the real exit
code with `"$@" || status=$?`, because inside `if ! "$@"; then` the status is the
negation (0 or 1) and 77 would never be seen. And a run in which every stage
skipped is a clean run by design: it prints `0 stage(s) ran, N skipped` and exits
zero, which is the honest answer for a repository whose stages do not apply to
the machine running them.

## The pre-push hook

`requireBeforePush` decides whether the local set gates a push. With it on, the
generated hook runs `scripts/ci/local.sh` and refuses a push whose local set
fails; the hook is installed by `guard install-hooks` or the setup interview, and
it refuses to repoint `core.hooksPath` when a repository already has hooks.

## act on this machine

`ci doctor` reports readiness rather than assuming it. If `act` is not installed
and Docker is, `ci local` runs the stages directly and prints which path it
took. Installing act (`github.com/nektos/act`) is what upgrades the local run
to container parity:

```bash
act --version
cp .act.secrets.example .act.secrets   # gitignored; act reads it, GitHub never sees it
```

## Cost, honestly

- A container run is slower than a direct run. The win is parity with the
  workflow, not speed; for a fast inner loop, `ci local` with no argument runs
  every local stage, and naming one runs that one.
- Local runs are not attestation. They are evidence for the author, not for a
  reviewer, and `review gates` still asks the forge what actually ran.
- A policy that puts everything on GitHub is not corrected by this tooling; it
  is only made visible in the plan.
