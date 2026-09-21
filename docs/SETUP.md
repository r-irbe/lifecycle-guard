# Setup

The shipped policy is generic on purpose. Protected paths exist only where a
project has the thing being protected, so `tools/**` means nothing in a service
that has no `tools/`, and a gate command copied from another repository verifies
nothing here. Setup is how a repository gets a policy about itself.

## Two ways to run it

**From a host-harness session** (the intended path): ask for it, and the setup
skill runs the interview, explains each question, applies the answers, and
reads the effective settings back.

```text
set up the lifecycle guard for this repository
lifecycle-guard setup                                 # detection and the question set
lifecycle-guard setup /tmp/guard-answers.json         # apply answers
```

**From a shell**, which is also what the skill calls:

```bash
lifecycle-guard setup --detect                 # what this repository looks like
lifecycle-guard setup --questions              # what to ask, and why each answer matters
lifecycle-guard setup --answers a.json --dry-run
lifecycle-guard setup --answers a.json
```

## What detection answers for you

| Detected | Used for |
| --- | --- |
| `package.json` scripts, `scripts/verify*.sh`, `Makefile`, `pytest`, `cargo`, `go` | gate candidates, most specific first |
| lockfile and packaging files | CI install commands |
| `.github/workflows/` | warning before a generated workflow collides with an existing one |
| `.git/hooks` and `core.hooksPath` (resolved from the git directory, not the cwd) | whether hook installation is safe at all |
| paths that exist: `scripts/verify_ui.sh`, `tools/`, `.agents/rules/`, `infra/`, `terraform/`, `k8s/`, migrations | protected-path candidates, each with the evidence |
| whether the guard is available on the CI image | whether the protected-path check is possible in CI |

## The questions

| id | Question | What it changes |
| --- | --- | --- |
| `gate` | Which command decides a change is done? | review config, the critique and CI workflows |
| `runtime` | What must CI install to run it? | workflow setup steps |
| `escalation` | When nobody can approve, fail or warn? | `policy.json` `escalation.noApprover` |
| `protected` | Which paths must a human touch? | `policy.json` `protectedPaths` |
| `rules` | Which rule families are active? | `policy.json` `rules` |
| `reviewers` | Which review providers to wire? | which files are generated |
| `bridge` | How does CI get the guard? | review config `bridgeCommand`, `protectedPathCheck` |
| `baseBranch` | Which branch should agent work start from? | review config, the task contract, CI reachability |
| `protectedBranches` | Which branches need review? | `policy.json` |
| `hooks` | Install git hooks? | git hooks path, `core.hooksPath` |
| `commitConvention` | Enforce commit subject rules? | `policy.json` (advisory only) |

## What it will not do

- **Overwrite an existing policy or answer file without `--force`.** It reports
  what it left alone instead.
- **Repoint existing git hooks.** When `.git/hooks` holds hooks or
  `core.hooksPath` is set, installation is skipped and the reason is printed.
  Setting `core.hooksPath` disables everything in `.git/hooks`, which is how a
  repository quietly loses its own checks.
- **Pretend CI gates what it cannot reach.** A `pull_request` workflow runs only
  when it exists on the pull request's base branch, and an issue workflow only
  from the default branch. When `baseBranch` is not the default branch, the plan
  warns and review status shows which pull requests are ungated.
- **Enable a protected-path check with no guard in CI.** If the package is not
  vendored and no registry copy is reachable, the check is dropped and the
  warning says so, rather than failing every job for the wrong reason.

## Answers file

Any subset works; unanswered questions take their detected default.

```json
{
  "gate": "bash scripts/verify_ui.sh",
  "runtime": "python",
  "escalation": "warn",
  "protected": ["scripts/verify_ui.sh", "tools/**", "**/.env*"],
  "rules": ["git-destructive", "branch-protection", "secrets-path"],
  "reviewers": ["gemini-code-assist", "jules-label"],
  "bridge": "vendored",
  "baseBranch": "dev",
  "protectedBranches": "main, release/*",
  "hooks": false,
  "commitConvention": true
}
```

## After applying

```bash
lifecycle-guard policy check        # effective rules, protected paths, escalation reason
lifecycle-guard review config       # gate, runtime, base branch, checks
lifecycle-guard review labels --repo <owner/name>
```

Policy and review configuration are written under `.lifecycle-guard/`. They are
short, they are the effective settings, and they are what a reviewer will
consult when the guard blocks something.

Fail-closed when unattended: if `escalation.noApprover` is left at its default
(`fail`), hooks and CI refuse escalations rather than waiting for a prompt.
