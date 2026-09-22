# Reviewer integration

Two review systems feed the same queue, and one dispatcher consumes it.

```text
Gemini Code Assist review comments --+
human review comments (opt-in)     ---+--> review-queue.json --> dispatch
Jules session output (polling)     --+                          +-- jules: new session, AUTO_CREATE_PR
                                                                +-- local: prompt for this session
```

## Gemini Code Assist

Repository configuration lives in `.gemini/`:

- `config.yaml` controls behaviour. The schema includes
  `code_review.comment_severity_threshold`, `max_review_comments`,
  `pull_request_opened.{help,summary,code_review,include_drafts}`, and
  `ignore_patterns`.
- `styleguide.md` is the review rulebook. The shipped default asks for
  unswallowed errors, handled failure paths, declared behaviour on truncated
  input, credential handling, a test per behaviour change, deterministic tests,
  ASCII-only files, and small modules.

Commands in a pull request conversation: `/gemini review`, `/gemini summary`,
`/gemini help`. The bot posts a summary plus per-hunk comments carrying a
severity label and, where possible, a suggested patch that can be committed
from the web UI. This plugin ingests the per-hunk comments and parses the
severity label and the suggestion block.

### Setup steps that need a human

1. Install the Gemini Code Assist GitHub app on the organization and grant it
   access to this repository.
2. Link a Google Cloud project with billing enabled, per Google's setup guide.
3. Open a pull request; the bot should appear as
   `gemini-code-assist[bot]` and post an initial review.

`lifecycle-guard review init` writes the two config files. It cannot install the
app for you, and it says so instead of pretending otherwise.

### Threshold choice

The shipped `comment_severity_threshold` is `LOW`, which is noisier but gives
the queue more to work with. Teams that want signal only should raise it to
`HIGH` and keep `max_review_comments` at `-1`, then rely on
`review list --min-severity` for local gating.

## Two dispatch paths

### Label-driven (default, no API key)

This is the path that works out of the box, and the one to reach for first,
because Jules is driven by the GitHub app rather than by the REST API:

1. `review dispatch --via issue` files an issue labeled `jules` (plus
   `automated-task`) whose body is a task contract: objective, findings table,
   constraints, acceptance criteria.
2. The generated `jules-triage.yml` workflow validates the body and adds
   `ready-for-jules` when the contract is complete.
3. Jules checks out `jules/issue-<n>`, implements the task, runs the repository
   verification command, and opens a pull request from that branch.
4. The generated `jules-critique.yml` workflow fires on any `jules/*` branch,
   runs `npm run verify`, and posts the outcome. A failure is written as a
   self-healing directive: reproduce, fix the cause (never weaken a test),
   re-run, push.

Required repository setup:

```bash
lifecycle-guard review init      # workflows, issue template, styleguide
lifecycle-guard review labels    # create jules / ready-for-jules / automated-task
```

And one thing only a human can do: confirm the Jules app has access to this
repository (GitHub -> Settings -> Applications -> Jules -> Configure). A
repository the app cannot see never receives the task, no matter how the issue
is labeled. The plugin therefore reports the issue URL and says what it is
waiting for instead of claiming success.

`review:fix` runs the whole loop from CI: intake the review comments, then
file the dispatch issue.

### REST API (optional)

When a `JULES_API_KEY` is present, `review dispatch --via api` creates a Jules
session directly. It is useful for accounts that automate outside GitHub, but
it is not required and not the default.

The API is `v1alpha`. The key is created at
`https://jules.google.com/settings#api` and sent as the `x-goog-api-key`
header. Endpoints used:

| Purpose | Call |
| --- | --- |
| list connected sources | `GET /sources` |
| create a session | `POST /sessions` with `prompt`, `sourceContext`, `automationMode`, `title` |
| read a session | `GET /sessions/{id}` |
| list activity | `GET /sessions/{id}/activities?pageSize=N` |
| continue the work | `POST /sessions/{id}:sendMessage` |
| approve a plan | `POST /sessions/{id}:approvePlan` |

Useful request fields: `automationMode: "AUTO_CREATE_PR"` makes Jules open a
pull request when it is done, and `requirePlanApproval: true` stops it before
execution so a human can read the plan.

### Local dispatch

`review dispatch --via local` writes the remediation prompt to
`.lifecycle-guard/dispatch-prompt.md` and marks the findings dispatched, for
sessions that will do the work themselves.

### Remediation prompt

`buildRemediationPrompt` enumerates each finding with severity, location, and
the suggested patch, then appends constraints:

- keep the diff scoped to the findings;
- every behaviour change needs a test that fails before it;
- do not edit CI workflows, the verification ladder, or the rule register;
- do not disable, skip, or weaken an existing test;
- report the exact commands and their results.

Findings that touch a protected path are removed from the dispatch set and
reported as `needsHuman`, because the fix itself would invalidate the audit.

### Workflow trigger

`.github/workflows/jules-remediation.yml` (written by `review init`) runs when a
comment contains `/jules fix-review` or when a `jules:fix` label is added. It
requires the `JULES_API_KEY` repository secret. The workflow collects findings,
dispatches them at severity `high` or above, and prints the queue state.

### Setup steps that need a human

1. Install the Jules GitHub app and connect the repository as a source.
2. Create the API key and store it as the `JULES_API_KEY` repository secret.
3. Decide whether sessions require plan approval; the CLI defaults to
   auto-approve from the API so an unattended workflow can finish.

## When automation cannot live on the default branch

GitHub only runs a workflow for `issues` events when the file exists on the
repository's **default branch**, and for `pull_request` events when the file
exists on the pull request's **base branch**. A repository whose default branch
is deployed on every push may not want automation commits landing there, and
then:

| Capability | Works without the default branch? |
| --- | --- |
| Dispatch (issue carries the `jules` label) | yes: the app reacts to the label, not to Actions |
| Contract validation | yes: `review task` validates locally and applies `ready-for-jules` itself |
| Triage comment | no, that is the workflow |
| Automatic critique on agent pull requests | only when the workflow exists on the pull request's base branch |
| On-demand critique | yes: `review critique --pr <n> --run` runs the gates and posts the same comment |

`review prs` reports which open pull requests CI can actually gate, so an
ungated agent pull request is visible instead of assumed.

### Steering the base branch

`baseBranch` in `.lifecycle-guard/review.json` is written into the task
contract. It is an instruction to the agent, not a guarantee: if the agent
opens against the default branch anyway, `review prs` shows it as ungated and
the on-demand critique covers it.

### Enabling the automatic path later

Either land the two workflow files on the default branch (a push to it may
trigger deployment, so batch it deliberately), or make the working branch the
default branch. Nothing else in this setup depends on which branch is default.

## Human review comments

`review intake --include-human` also collects comments from non-bot reviewers
and tags them `source: human` at severity `medium`. This is off by default
because human comments are often discussion rather than change requests.

## Review intake

`review intake --pr N` records the bot's per-hunk comments. `review critique`
posts the gate verdict and the open findings back to a pull request, which is
what the CI workflow calls; run it locally with `--run` to execute the gates
first and `--dry-run` to read the comment before posting it.

Pull requests opened by Jules are recognised by the `jules/` branch prefix, so
`review critique` can find the newest one without being told the number.

## Queue state

```text
lifecycle-guard review status          # queue summary and Jules readiness
lifecycle-guard review list --json     # machine-readable findings
```

Queue states in use today are `open`, `dispatched`, and `fixed`. `triaged` and
`wontfix` are reserved in the schema and no command sets them, so a finding
deferred to a human stays `open` until someone edits
`.lifecycle-guard/review-queue.json`. Re-intake refreshes the body of an
existing finding and preserves its state, so a dispatch is never silently reset
by a new review round.
