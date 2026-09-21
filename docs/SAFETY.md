# Safety rules

The guard is a policy engine with four verdicts. It runs at three points: the
host-harness tool-call hook, the git hooks, and CI.

## Verdicts

| Verdict | Meaning | Non-interactive callers |
| --- | --- | --- |
| `allow` | No rule matched. | Proceed. |
| `warn` | Proceed, record, report. | Proceed, log. |
| `escalate` | A human must approve. | Depends on `escalation.noApprover`. |
| `block` | Do not proceed; take another path. | Exit 1. |

Hooks and CI cannot prompt, so what an escalation means there is a policy
decision rather than a hidden default:

```json
{
  "escalation": {
    "noApprover": "fail",
    "note": "why this repository chose that"
  }
}
```

- `fail` (default) refuses the action, which is the right answer for a git hook
  and for any repository where a protected path should stop everything.
- `warn` reports the finding and continues, which suits a CI gate on a pull
  request: the change set is already under human review, so the escalation is a
  notice for that reviewer instead of a red mark they must override.

The setting applies to every unattended caller at once, hooks and CI alike. A
repository that wants CI to warn while its hooks still refuse can pass
`--escalate warn` on the workflow step instead of changing the policy.

A single run can override the policy with `--escalate fail|warn`, and the output
says which rule applied (`policy escalation.noApprover=warn` versus
`command line override`). `policy check` prints the effective setting and its
stated reason. **Blocks are unaffected by this setting**: credentials, the
frozen verification ladder, and destructive commands always fail the run.

## Blocked by default

| Rule | Scope | Source |
| --- | --- | --- |
| `no-force-push` | force push, force-with-lease | deny-patterns:git-push-force |
| `no-history-rewrite` | `reset --hard`, `filter-branch`, `filter-repo`, reflog expire, `gc --prune=now` | deny-patterns:git-reset-hard |
| `no-force-clean` | `git clean -f`, `rm -rf` | deny-patterns:rm-rf-path |
| `no-branch-force-delete` | `branch -D`, `push --delete`, `push --mirror` | deny-patterns |
| `no-hook-bypass` | `--no-verify`, `HUSKY=0`, `core.hooksPath` | deny-patterns |
| `no-network-egress-shell` | `curl ... | sh` | supply-chain |
| `no-secret-egress` | writes to `.env`, `id_rsa`, `*.pem`, `credentials.json` | deny-patterns |
| `no-destructive-sql` | `DROP DATABASE/TABLE/SCHEMA`, `TRUNCATE TABLE` | deny-patterns |
| `secret:*` | vendor token patterns in content or diffs | secret-detection |

## Requires human approval

`no-push-protected-branch`, `no-privilege-escalation`, `no-world-writable`,
`no-unreviewed-deploy` (terraform, kubectl, helm, docker push),
`no-peer-review-bypass` (`gh pr merge`, `gh pr close`), `no-cron-or-daemon`,
`no-global-config-write`, and edits that match a protected path.

## Protected paths

A protected path is protected against both doors. The write and edit tools are
checked directly, and a shell command that redirects into, copies over, moves,
or deletes the path is judged by the same action. Reads are untouched, so
`cat`, `grep`, and `git diff` on a protected path still pass.

| Glob | Action | Why |
| --- | --- | --- |
| `scripts/verify_ui.sh` | block | The verification ladder is frozen while a campaign is running. |
| `.github/gate-thresholds.yml` | block | Gate thresholds are part of the frozen ladder. |
| `tools/**` | escalate | Linters are the measurement instrument. |
| `.github/workflows/**` | escalate | CI changes redefine what counts as evidence. |
| `.agents/rules/**` | escalate | The rule register governs every agent. |
| `**/.env*`, `**/.ssh/**` | block | Credential material. |
| `**/package-lock.json` | warn | Regenerate with the package manager instead. |

## Known limits

The guard reads command text. It is not a shell parser and it is not a sandbox;
`SECURITY.md` states the same boundary. These limits were measured rather than
assumed, and they are listed because a guard whose gaps are undocumented is
read as stronger than it is.

| Form | Result | Note |
| --- | --- | --- |
| `git push --force` / `-f` / `"--force"` | block | plain, quoted, and short forms all match |
| `git push --for''ce` | escalate | the flag rule misses the concatenation, the protected-branch rule still fires |
| `g=git; $g push --force` | escalate | `no-indirect-force-push`; the rule cannot know the variable's value |
| `git push $(echo --force)` | not detected | command substitution is not resolved |
| a Python or Node one-liner writing a protected file | not detected | only shell operators are inspected; the write tool path is covered |
| an alias or sourced script | not detected | nothing is expanded |

What compensates for the gaps: the audit chain records every non-allow decision,
the critique workflow runs the repository gates on agent pull requests, and
branch protection plus review remain the real barrier. The guard exists to stop
the mistakes measured agent runs actually made, not a determined adversary.

## Commit hygiene

Conventional commit subjects, at most 72 characters, and no hook bypass.
Committing directly on a protected branch escalates.

## Secret scanning

Patterns are anchored on vendor-documented prefixes (GitHub, Slack, Stripe,
OpenAI, Anthropic, Google API keys, npm, PEM headers, GCP service-account
markers, JWTs, and connection strings with inline credentials). Entropy-only
detection is not used for verdicts: a false block costs an operator more than a
missed low-confidence match. Findings carry masked values and locations, and
the allowlist covers placeholders such as `EXAMPLE`, `REDACTED`, or
`PLACEHOLDER`.

### Fixture paths

Test suites for a scanner have to contain token-shaped strings, so findings
under `fixtureGlobs` (`**/*.test.ts`, `**/test/**`, `**/fixtures/**`, and
similar) take `fixtureAction` instead of `secrets.action`:

```json
{
  "secrets": {
    "action": "block",
    "fixtureGlobs": ["**/*.test.ts", "**/test/**"],
    "fixtureAction": "warn",
    "fixturePatterns": ["*"]
  }
}
```

`fixturePatterns: ["*"]` downgrades every pattern there; list specific pattern
ids to narrow it. The trade-off is deliberate: blocking a fixture pushes people
to disable the scanner entirely, while a notice still reaches the reviewer.
Outside fixture paths the configured action applies unchanged.

## Audit chain

Every non-allow decision is appended to `.lifecycle-guard/audit.jsonl` as a
JSON object whose `hash` is the SHA-256 of the entry with the previous entry's
`hash` as `prev`. `audit verify` walks the chain and reports the first broken
position. Raw command text is never stored; the record holds rule ids, the
verdict, and a summary.

## Tuning

Add `.lifecycle-guard/policy.json`:

```json
{
  "protectedBranches": ["main", "release/*"],
  "secrets": { "action": "escalate" },
  "rules": [
    {
      "id": "no-force-push",
      "scope": "destructive-git",
      "tool": "bash",
      "kind": "command",
      "pattern": "\\bgit\\s+push\\b",
      "action": "block",
      "reason": "this repository never pushes from an agent",
      "source": "local-override"
    }
  ]
}
```

Rules merge by id: an override replaces the shipped rule of the same id and
leaves the rest untouched. `policy check --json` prints the effective set, which
is what a reviewer should read before trusting a verdict.

### Optional rule: command-prefix convention

Repositories that require a command-rewriting prefix can add a `warn` rule so
unprefixed commands are visible without being blocked:

```json
{
  "rules": [
    {
      "id": "rtk-prefix-convention",
      "scope": "convention",
      "tool": "bash",
      "kind": "command",
      "pattern": "^(?!rtk\\b)(?!\\./)(git|grep|find|ls|cat|npm|pytest|python3)\\b",
      "action": "warn",
      "reason": "prefix shell commands to keep output compact",
      "source": "convention"
    }
  ]
}
```
