# Unicode policy and prompt-injection detectors

Two rules that had to change shape. A strict 7-bit ASCII invariant could not
be enforced on a mixed-language tree: a repo-wide scan found tens of millions
of non-ASCII characters, almost all of them in Lean 4 sources where
mathematical notation is the language's syntax rather than a formatting
choice. And there was no rule at all for the class of attack that hides
instructions in characters nobody sees.

## 1. The Unicode rule

Three modes, chosen per path, most specific glob wins:

| Mode | What it allows |
| --- | --- |
| `ascii` | 7-bit only: manifests, lockfiles, shell scripts |
| `typographic-free` | ASCII **plus** scripts, mathematics, and emoji; substitutions and invisibles banned |
| `unrestricted` | nothing enforced: vendored trees, build output |

**Banned everywhere: invisible carriers.** These are not content, they are
instruction carriers and review hazards:

| Range | What it is |
| --- | --- |
| U+E0000-U+E007F | Unicode tag block: invisible, and read by models |
| U+D800-U+DFFF | orphaned surrogates (they can be joined into a live tag character) |
| U+200B-U+200F, U+2060-U+2064 | zero-width and invisible-operator characters |
| U+202A-U+202E, U+2066-U+2069 | bidi controls (the Trojan Source class) |
| U+FEFF, U+180E, U+FE00-U+FE0F | zero-width no-break space, vowel separator, variation selectors |

**Banned in `typographic-free`: typographic substitutions.** Curly quotes, en and
em dashes, the ellipsis, and the space-like characters (no-break space, narrow
no-break space, figure/em/en/thin spaces). These are the characters the
anti-slop writing rule is actually about: a keyboard has an ASCII key for each of
them.

**Deliberately allowed: mathematics.** `<=`, `>=`, `->`, and `forall` have ASCII
spellings in prose, but in Lean, LaTeX, and mathematical writing the symbol *is*
the notation. Banning it would ban the language. The first draft of this rule
banned `<=` and the tests caught it.

**Allowed content ranges** cover Latin extensions, Greek, Cyrillic, Armenian,
Hebrew, Arabic, Devanagari, Thai, CJK, Hangul, mathematical operators
(U+2200-U+22FF and the supplemental blocks), letterlike symbols, emoji
(U+1F300-U+1FAFF), and regional indicators for flags.

**Density caps:** a file may not be more than 35% non-ASCII, and a line not more
than 120, but the ratio only applies above **500 code points**. A Chinese title,
a Cyrillic heading, or a one-line commit message in Korean is 100% non-ASCII and
perfectly fine; the cap exists for a page that is nothing but non-ASCII filler.

**Stripping is iterated to a fixed point.** A single pass over an UTF-16 string
can join two orphaned surrogates into a valid tag character, which is exactly the
bypass AWS documents. Removing one layer can expose another, so the pass repeats
until the text stops changing.

## 2. The injection detectors

Nine detectors, each citing where it comes from, each with a severity and an
action. They are **deterministic**, which is what makes them cheap and
explainable; they are not a classifier, and the literature is clear that no
pattern set is a defence on its own.

| Detector | Severity | Catches |
| --- | --- | --- |
| `invisible-carriers` | critical, block | tag block, zero-width, bidi, surrogates in text |
| `exfiltration-markup` | critical, block | `![x](https://host/?data=SECRET)`, `<img src=...?>` |
| `instruction-override` | high, warn | "ignore previous instructions", role reassignment, forged system turns |
| `encoded-payload` | high, warn | base64 and hex runs **decoded and then judged** |
| `hidden-markup` | high, warn | instructions in HTML comments, white LaTeX text |
| `typoglycemia` | medium, warn | "ignroe", "prevoius", "systme": first and last letter intact, middle scrambled |
| `homoglyph-swap` | medium, warn | a Cyrillic character inside a Latin word |
| `whitespace-injection` | medium, warn | no-break spaces and carriage returns inside a command |
| `prompt-extraction` | medium, warn | "repeat the text above", "reveal your system prompt" |

Two design choices matter:

- **Evidence is escaped, never propagated.** A finding carries `\x00`-style
  escapes and a truncation marker, because a report that quotes a live payload is
  itself a delivery mechanism.
- **Untrusted text is framed, not rewritten.** `frameUntrusted()` states the
  origin, strips the carriers, and lists what fired. Silently editing a document
  an agent was asked to reason about loses information and hides the attack from
  the human who should see it.

## 3. The golden road

The evidence says one layer is never enough: Best-of-N attacks reach **89%** on
GPT-4o given enough attempts (arXiv 2412.03556), and OWASP's cheat sheet says
plainly that pattern filters do not reliably catch indirect injection in
untrusted content. So the harness implements the layer that is deterministic and
leaves the rest to layers that belong elsewhere:

1. **Invisible characters are removed before anything reaches a prompt.** This is
   the highest-value deterministic step, because it is not a judgement call.
2. **Deterministic detectors run on tool inputs** (the last moment text is still
   text) and **on tool output** (fetched pages, review comments, file reads).
   Blocking detectors refuse the action; the rest are reported in the same turn.
3. **Untrusted content is framed as data**, with the framing saying so in words,
   and the operator sees the detector findings.
4. **Least privilege**: the guard refuses destructive and credential paths, so an
   injected instruction that gets through still has limits on what it can cause.
5. **Model-based guardrails are a layer, not a replacement** (Llama Guard,
   ShieldGemma, Granite Guardian, Prompt Guard, NeMo Guardrails). They catch
   paraphrases that patterns miss, and they are themselves injectable.
6. **The dual-LLM pattern is the architectural fix** (Simon Willison): a
   privileged model holding the tools never reads untrusted content; a quarantined
   model reads it and returns structured summaries. An instruction cannot travel
   through a path that never carries text.
7. **Telemetry closes the loop**: every detector firing is recorded, so a
   detector that never fires and a detector that fires constantly are both
   visible. That is the same ledger the process gates use.

## 4. Configuring it

```json
{
  "unicode": {
    "defaultMode": "typographic-free",
    "scopes": [
      { "glob": "**/*.lean", "mode": "typographic-free", "reason": "notation is syntax" },
      { "glob": "**/package.json", "mode": "ascii", "reason": "machine-read" }
    ],
    "maxNonAsciiRatio": 0.35,
    "minCodePointsForRatio": 500,
    "maxNonAsciiPerLine": 120
  },
  "injection": {
    "detectors": {
      "instruction-override": { "action": "block", "severity": "critical" },
      "typoglycemia": { "action": "warn" }
    },
    "disabled": ["homoglyph-swap"],
    "allowlist": ["lifecycle-guard:allowlist"],
    "maxScanChars": 200000,
    "decodeEncodedPayloads": true
  }
}
```

Flexibility, deliberately: a repository can change a detector's action, raise its
severity, switch it off, allowlist a document that legitimately discusses
attacks, add scopes with any mode, and extend the allowed ranges. Scopes resolve
by **specificity**, so a narrow exception cannot be overridden by a broad rule
written later.

Commands:

```bash
lifecycle-guard policy unicode [dir|file] [--mode M] [--limit N]
lifecycle-guard policy ascii [dir|file]        # alias for --mode ascii
lifecycle-guard policy injection [dir] [--code] [--text "string"]
```

## 5. What this does not claim

- **Not a classifier.** A paraphrased attack passes every pattern here. That is
  what layer 5 and layer 6 are for.
- **Not complete coverage of obfuscation.** Homoglyphs are caught in the
  mixed-script case; a fully confusable word in one script is not.
- **Not an output filter.** The detectors inspect input and tool output; a model
  that leaks its instructions in prose is caught by the leakage patterns only.
- **Not enforcement of taste.** The substitution set is narrow on purpose:
  em dashes in a quotation are still a violation, and a reviewer may reasonably
  allowlist one.

## Ignoring scratch, without hiding worktrees

A policy that scans scratch output produces findings about files nobody
committed, and those findings drown the ones that matter.

Two mechanisms, both reported in the scan's summary line:

* `unicode.ignore` -- an explicit list of globs, each with the reason it is
  exempt. Reviewable, and it works outside a repository.
* `unicode.respectGitignore` -- whatever git already ignores. One call to
  `git ls-files --others --ignored --exclude-standard --directory`, then a path
  is ignored when git lists it or lists a directory it sits under.

Neither can switch the scan off, and neither hides anything: the summary says how
many paths each mechanism removed, and when git cannot answer the run says
`git ignore filter unavailable` rather than reporting a smaller number as if it
were the whole story.

Three defects surfaced only by running it, each of which silently lost paths:

1. **Git C-quotes non-ASCII file names.** `core.quotePath` defaults to true, so a
   path with an em dash comes back escaped, which never equals the real path.
   Every file whose name carried the very character this policy exists to find
   escaped the filter.
2. **A large tree breaks a piped call.** `check-ignore --stdin` takes the path
   list on stdin; hundreds of thousands of paths overflow the pipe (`ENOBUFS`,
   then `EPIPE`). The fix is to ask from the other side -- git reports its
   ignored set, and nothing is piped to a child.
3. **A nested repository hides its own contents.** Without `--directory` only
   nested `.git` files were listed and tens of thousands of ignored files looked
   unignored. Naming the directory is what closes the gap.

### Worktrees are not scratch

The ignore mechanism treats a gitignored directory as absent from the
repository. That is right for scratch and wrong for a worktree: a gitignored
directory can still hold registered worktrees of the same repository, including
unmerged work. Ignoring it stopped scanning unlanded work, and did so without a
word.

`unicode.worktrees` is therefore its own decision:

| Value | Behaviour |
| --- | --- |
| `current` (default) | scan the checkout the scan started from; name every other worktree, its branch, whether that branch is merged, and how many files it holds |
| `all` | scan those worktrees too, overruling the ignore rule that hides their directory |

`--worktrees all` does the same for one run. The default reports skipped
worktrees with branch, merge status, and file count, so unmerged work is not
covered in silence.

## The act lifecycle

`ci act up | run | down | gc` (and the generated `scripts/ci/act-*.sh`) manage the
runner. act has no daemon, so the time-to-live applies to what a killed run
leaves behind: containers named `act-*` are reaped once they are older than
`ci.local.actTtlMinutes` (30 by default), before and after every invocation.
`gc --dry-run` says what it would remove; `status` says what it kept and why.

## References

- Amazon Web Services (n.d.). *Defending LLM applications against Unicode
  character smuggling*. AWS Security Blog. Tag blocks, orphaned surrogates, and
  the single-pass stripping bypass.
- Cloud Security Alliance (2026). *Research note: Unicode instruction injection
  in AI skills*.
- Hughes, J., et al. (2024). *Best-of-N jailbreaking*. arXiv:2412.03556. 89% on
  GPT-4o, 78% on Claude 3.5 Sonnet: why patterns are a layer, not the defence.
- Madaan, A., et al. (2023). *Self-Refine*. arXiv:2303.17651.
- Gou, Z., et al. (2023). *CRITIC*. arXiv:2305.11738. Tool-grounded critique.
- OWASP Foundation (2025). *LLM prompt injection prevention cheat sheet*. The
  attack taxonomy, the fuzzy-matching idea, the length cap, and the layered
  defence order used in section 3.
- Sadasivan, V. S., et al. (2024). *Typoglycemia attacks on large language
  models*. arXiv:2410.01677.
- Shinn, N., et al. (2023). Reflexion. NeurIPS 36.
- Trend Micro Research (2025). *Invisible prompt injection*.
- Microsoft Security (2026). *ASCII smuggling crosses over from AI prompt
  injection to phishing evasion*.
- Willison, S. (2023). *The dual LLM pattern*. The architectural half of the
  golden road.

An arXiv identifier is given where the bibliography entry carries one; the AWS
entry is undated on its own page, and is recorded as such rather than assigned a
date.
