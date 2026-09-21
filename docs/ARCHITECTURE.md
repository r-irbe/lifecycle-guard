# Architecture

This public tree ships the schemas and the design brief of the fail-closed
lifecycle guard. The notes below describe how the engine is structured.

## Module map

```text
engine/
  host-hook                 host-harness tool-call hook: commands, tools, guard events
  cli                       policy, guard, resume, review, audit
  session-store/
    protobuf reader         tolerant protobuf wire reader (no dependencies)
    sqlite access           read-only SQLite access + session inventory
    step classification     tool framing, error extraction
    resume brief            continuation brief builder
  safety/
    policy                  rule defaults, protected paths, merge/override
    engine                  verdict evaluation for commands, paths, content
    secrets                 vendor-anchored secret detection and masking
    audit                   hash-chained append-only decision log
  reviewers/
    finding                 ReviewFinding + queue persistence
    gemini                  Gemini Code Assist config and comment parsing
    intake                  GitHub ingestion through the gh CLI
    jules                   Jules REST client
    remediation             dispatch planning and prompt construction
  templates                 generated harness files (hooks, workflows, configs)
```

## Design decisions

**Zero runtime dependencies except `typebox`.** The package runs inside an
agent harness on a machine that may be offline, and every dependency is a
supply-chain surface. Protobuf decoding, YAML rendering, glob matching, and
arg parsing are small enough to own.

**Bytes in, struct out.** Session-store framing embeds varint length prefixes
that are frequently invalid UTF-8. Anything that decodes to a string first and
re-encodes later corrupts the structure, so the decoder API takes bytes and the
string form exists only as a heuristic fallback.

**Pure engine, thin adapters.** Verdict evaluation takes git state as an
argument rather than reading it, so the same request yields the same verdict in
tests, hooks, CI, and the agent loop. CLI and hook adapters contain no policy
logic; they translate API surfaces into engine calls.

**Fail closed where no human is present.** `escalate` renders as `block` in the
CLI, hooks, and CI. A UI flag decides whether the host-harness tool-call hook
may ask.

**Say what is missing.** The resume brief carries a coverage block listing step
types scanned, kinds decoded, and every known gap. The security policy states
the threat-model boundary. Review setup reports which steps it cannot perform.

**Audit without capture.** The audit log stores rule ids, verdicts, and
summaries. It does not store raw commands, and secret findings are masked at
the point of detection, so the record cannot become a new leak.

## Data flow

```text
tool_call (host harness)  --+
git hook                   -+--> evaluateGuard --> verdict --> block / confirm / warn
CLI guard                  -+                          |
                                                       +--> audit.jsonl (hash chain)

external SQLite + protobuf
  --> decodeStep[] --> buildResumeBrief --> markdown --> .lifecycle-guard/active-resume.md
                                                              |
                                                              +--> injected next turn

gh api / Jules  --> intakeReview --> ReviewFinding[] --> queue.json --> planDispatch
                                                                          |
                                                            protected path? -> needsHuman
                                                                          |
                                                                          +-> Jules / local
```

## Extension points

- New guard rule: append to the shipped defaults, or add an override in a
  repository policy file. Give it a stable `id` and a `source` naming the
  incident or register it came from.
- New secret pattern: append a masking-safe pattern with a regression test.
- New generated file: add a builder and include it in review init or hook
  installation.
- New review source: normalize into `ReviewFinding` and reuse the queue,
  dispatch planning, and reporting untouched.

## Testing strategy

Coverage focuses on the parts where a wrong answer is dangerous or silent:

- protobuf edge cases (truncation, mixed wire types, invalid UTF-8 framing);
- guard verdicts for every default block and escalate rule;
- secret detection and masking, including false-positive allowlisting;
- audit chain construction and tamper detection;
- queue state machine and protected-path deferral;
- Jules client request shape and error mapping against an injected fetch;
- an end-to-end resume run over a synthetic session store, asserting the
  brief's content and strict ASCII output.

The end-to-end test builds a real SQLite conversation database with real step
framing, so the decoder is exercised the way production exercises it rather
than through a hand-written fixture object.

Requires Node 22.5 or newer.
