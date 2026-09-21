# lifecycle-guard

Fail-closed policy engine for agent tool calls.

An agent session writes files, runs shell commands, and opens pull requests
with the operator's credentials. This engine sits in front of those tool
calls and returns one of four verdicts before the action happens. It is an
accident-prevention layer, not a sandbox.

## Four verdicts

| Verdict | Meaning | When no human is present |
| --- | --- | --- |
| `allow` | No rule matched. | Proceed. |
| `warn` | Proceed, record, report. | Proceed, log. |
| `escalate` | A human must approve. | Fail closed (default). |
| `block` | Do not proceed; take another path. | Exit 1. |

Git hooks, CI, and other unattended callers cannot prompt. The policy field
`escalation.noApprover` is `fail` by default, so an escalation becomes a
block. A repository may set it to `warn` when the change set is already under
human review. **Blocks are never softened**: credentials, frozen verification
paths, and destructive commands still fail the run.

## Hooks and CI

The same engine runs at three points:

1. **Host-harness tool-call hook** — every bash call, file write, and commit
   message is evaluated before it happens.
2. **Git hooks** — pre-commit and pre-push run the engine on the staged diff
   and the push command.
3. **CI** — the same verdicts, with an optional `--escalate warn` override
   for pull-request gates.

Force pushes, history rewrites, hook bypasses, credential writes, and
destructive SQL are blocked. Deploys, merges, and CI edits require human
approval. Protected paths are checked on both the write/edit tools and on
shell redirections that would overwrite them.

Policy lives at `.lifecycle-guard/policy.json` and merges by rule id onto the
shipped defaults. The audit log is `.lifecycle-guard/audit.jsonl`: each
non-allow entry carries a SHA-256 `hash` chained to the previous entry's
`hash`. Raw command text is never stored; the record holds rule ids, the
verdict, and a summary.

## Session resume

Another harness may record a session as a SQLite database whose step payloads
are protobuf. The engine decodes that store and writes a bounded continuation
brief: last operator request, unfinished sub-tasks, trailing tool actions,
files in play, blockers, and a coverage block that states what was scanned
and what is not decodable. Opaque or encrypted payloads are reported as gaps
rather than guessed.

The brief is written to `.lifecycle-guard/active-resume.md` and can be
injected once per revision at the start of the next turn.

## Review-finding dispatch

Findings from Gemini Code Assist (or a human) are collected into a queue and
dispatched either to a Jules session that opens a pull request, or to the
current session as a prompt. Findings that touch protected paths — CI
workflows, the verification ladder, the rule register — are deferred to a
human, because automated edits to the measurement instrument invalidate the
evidence produced after them.

## Runtime

Requires Node 22.5 or newer (uses `node:sqlite` and native TypeScript
stripping). Fail-closed when unattended.

## Documentation

- [docs/SAFETY.md](docs/SAFETY.md) — rule table, verdicts, hooks, audit chain.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map and design decisions.
- [docs/SETUP.md](docs/SETUP.md) — designing a policy for a repository.
- [SECURITY.md](SECURITY.md) — reporting and threat-model boundary.

Schemas for the policy, resume brief, and review queue live in
[`schemas/`](schemas/).

## License

Apache-2.0.
