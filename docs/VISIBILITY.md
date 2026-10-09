# Visibility manifests

Every artifact (code, prose, plans, reviews, scratch) carries exactly one
label from a TLP 2.0-derived vocabulary. TLP itself governs person-to-person
sharing; here the vocabulary is kept and the enforcement is defined by this
spec: intake assigns a default by path, and the label travels with the
artifact until the operator lowers it.

## Labels

| Label | Meaning | May reach |
| --- | --- | --- |
| `RED` | never leaves the machine | plane-local store only |
| `AMBER` (AMBER+STRICT) | trusted agents of the same operator only | labeled agents, private repositories |
| `GREEN` | shareable within the declared community or pack | domain packs, exports |
| `CLEAR` | public | any repository, any consumer |

## Rules

- **Auto-default by path.** A manifest ([`schemas/visibility.v1.json`](../schemas/visibility.v1.json))
  maps path globs to labels. A path matched by no rule keeps the manifest
  default. A typical start: `private/**` -> RED, `docs/research/**` -> AMBER,
  `README.md` -> CLEAR.
- **Agents may raise the restriction; only the operator lowers it.**
  Lowering is a signed manifest edit under the operator's git identity,
  never an agent action. No tool lowers a label automatically.
- **Crossing a boundary is a disclosure event.** Any artifact that crosses
  an agent boundary passes the redaction gate and is logged with the
  recipient; a model provider counts as a recipient.
- **Aggregation is permission-checked.** Combining artifacts requires every
  source manifest to permit the destination label.
- **Front-matter overrides may raise, never lower.** A file may carry a
  `visibility:` key, but the effective label is the stricter of the
  front-matter key and the manifest rule.

## Where enforcement happens

The manifest is data. The enforcement points belong to the host
implementation: intake labels new and written files; the boundary check
runs at every point where content would leave the machine or reach another
agent, and the redaction gate runs before it. A label check that finds
nothing to say is still a decision, and it is logged like any other.
