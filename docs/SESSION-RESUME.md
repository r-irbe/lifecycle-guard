# Session resume from another harness

Another harness may record a session as a SQLite database whose step payloads
are protobuf. The engine opens that store read-only, decodes what it can, and
writes a bounded continuation brief. Opaque or encrypted payloads are reported
as gaps rather than guessed.

The layout below was observed on a 27,288-step conversation (2026-09-21) from
an Antigravity CLI store. Other stores with the same shape (SQLite + protobuf
steps) are in scope; stores that are not that shape are out of scope.

## Store layout (Linux)

State lives under `~/.gemini/antigravity-cli/`:

| Path | Contents |
| --- | --- |
| `conversation_summaries.db` | one row per conversation: title, step count, workspace URIs, idle status, last user input |
| `conversations/<uuid>.db` | the transcript: a `steps` table with protobuf payloads |
| `brain/<uuid>/` | session artifacts (markdown reports, generated images, task logs) |
| `history.jsonl` | raw operator inputs with workspace and timestamp |

Everything is opened read-only. The decoder never writes to this directory.

## Step types

| `step_type` | Meaning | Decodable content |
| --- | --- | --- |
| 23 | user / session step | operator request text in top-level field 30 |
| 127 | user request card | the submitted tool request (for example `invoke_subagent`) |
| 132 | tool call | field 5.4 carries the framed invocation |
| 15 | model response | metadata only: model id, request id, token counters |
| 17, 101 | heartbeat | agent identity; no work content |
| 14 | session metadata | counters and timestamps |

## Tool call framing

Field 5.4 of a tool-call step holds a framed string:

```text
#<tool-use-id> <0x12> <len> <tool name> <0x1a> <len> <JSON arguments>
```

The two `len` values are protobuf varints. Decoding to a string first is
lossy, because a multi-byte varint is frequently not valid UTF-8; re-encoding
replaces those bytes with U+FFFD and every subsequent length shifts. The parser
therefore works on bytes (`parseInvocationBytes`) and only converts the name and
the argument JSON. This exact round trip was a shipped bug and is now covered by
a regression test.

## What is not recoverable

Model reasoning traces are encrypted at rest, and model response bodies are not
stored in the step payloads. The tool-call record, the operator inputs, the
error strings, and the brain artifacts are the decodable evidence. The brief
lists these gaps explicitly in its coverage block so a reader can tell the
difference between "nothing happened" and "nothing decodable here".

## The continuation brief

`buildResumeBrief` scans the trailing window (default 400 steps) and emits:

- **Pick up here** - bullets from the last operator request when that request
  is itself a continuation summary, otherwise the head of the last request.
- **Active goal** - the goal line from that summary.
- **Last tool actions** - index, tool, action label, command or path.
- **Unfinished scheduled work** - timers the harness scheduled but never
  resolved.
- **Blockers** - distinct error strings, with attempt counters and reset
  timers collapsed so ten quota retries read as one line.
- **Files in play** - paths from tool arguments and command strings, with
  workspace-absolute and relative forms folded together, ranked by recency.
- **Recent operator inputs** - the tail of `history.jsonl` for the workspace.
- **Session artifacts** - the brain directory listing.
- **Raw operator request** - verbatim head, bounded.
- **Coverage and gaps** - step-type counts for the whole conversation, decoded
  kind counts for the window, and every known gap.
- **Resume instruction** - the explicit next step for the receiving session.

Output is strict 7-bit ASCII (typographic characters are folded), because the
artifacts land in repositories that enforce an ASCII-only invariant.

## Usage

```bash
lifecycle-guard resume list --workspace /path/to/repo
lifecycle-guard resume show <session-id> --tail 200
lifecycle-guard resume brief <session-id> --out .lifecycle-guard/active-resume.md
```

When a brief is written to `.lifecycle-guard/active-resume.md`, the host-harness
plugin injects it into the next turn so the session does not have to re-derive
the context.
