# twine.rs documentation

Status: current
Owner: repository maintainers
Last verified: 2026-07-04
Source of truth: documentation map and lifecycle policy

Start here when deciding which document is authoritative. Documentation is
organized by the question it answers and by how its content changes over time.

## Reader paths

- **What exists now?** Read [`status/current.md`](./status/current.md).
- **How does the system work?** Start with
  [`architecture/overview.md`](./architecture/overview.md).
- **Why was an architectural choice made?** Read
  [`decisions/`](./decisions/README.md).
- **What should be built next?** Read [`roadmap/`](./roadmap/README.md).
- **How should the product behave?** Read [`product/`](./product/README.md).
- **How do I use the current product?** Start with
  [`user/README.md`](./user/README.md).
- **How are releases governed?** Read [`../RELEASING.md`](../RELEASING.md) and
  [`releases/`](./releases/README.md).
- **How do I run benchmarks?** Read
  [`../benchmarks/README.md`](../benchmarks/README.md).
- **How are the Rust crates organized?** Read
  [`../crates/README.md`](../crates/README.md).

## Documentation classes

| Class            | Meaning                                                | Update rule                                                      |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `architecture/`  | Current implementation and ownership boundaries        | Update with the code change                                      |
| `decisions/`     | Accepted architectural decisions                       | Do not rewrite history; supersede with another ADR               |
| `status/`        | Concise, dated capability and measurement snapshots    | Keep factual and link to evidence                                |
| `roadmap/`       | Unfinished outcomes only                               | Remove completed work instead of accumulating status annotations |
| `product/`       | Normative product behavior and vocabulary              | Avoid implementation chronology                                  |
| `releases/`      | Reviewed release decisions and generated-record schema | Add one plan per release; generate records in CI                 |
| `design-system/` | Design tokens, components, and visual source artifacts | Keep beside the artifacts                                        |
| `user/`          | twine.rs-specific user documentation                   | Describe shipped behavior only                                   |
| `upstream/`      | Material inherited from TwineJS                        | Never present it as twine.rs product truth                       |
| `archive/`       | Historical research and completed plans                | Preserve context; do not maintain as current                     |

Subsystem instructions stay close to their code. The root README, benchmark
README, crate README, and localization README are intentionally not duplicated
here.

## Required metadata

Every current architecture, status, roadmap, and product document begins with:

- `Status`
- `Owner`
- `Last verified`
- `Source of truth`

Archived documents instead begin with a historical warning and links to their
current replacements.

## Authoring rules

1. State each current fact in one authoritative document.
2. Put completion state only in `status/`, not in specifications or ADRs.
3. Keep roadmaps limited to incomplete work and measurable exit criteria.
4. Move superseded plans to `archive/`; do not continually edit their old
   assumptions.
5. Prefer links to subsystem READMEs and executable commands over copied
   instructions.
6. Keep upstream Twine behavior clearly distinguished from twine.rs behavior.
