# Article materials (task HACKATONSU-35)

Technical material for the article (task HACKATONSU-34): diagrams, commented code excerpts, and
the eval results table.

- [`architecture.svg`](architecture.svg) / [`architecture.png`](architecture.png) — the request
  flow, from a Telegram message to a Walrus blob and back for a free-form question. Rendered from
  the diagram already described in [`docs/DESIGN.md`](../DESIGN.md) §2, with the extractor
  relabeled from Gemini to OpenRouter (decision D-05).
- [`code-excerpts.md`](code-excerpts.md) — three short, commented snippets: the `Fact` shape, the
  State Resolver's chain walk, and how a fork between two amendments is broken.
- [`eval-results.md`](eval-results.md) — the 3-arm eval headline numbers (no-recall 0/10, recall
  6/10, resolver 9/10), why the comparison is the article's central figure, and one honest miss
  explained rather than hidden. Full data: [`docs/evidence/eval-three-arms-2026-10-05.md`](../evidence/eval-three-arms-2026-10-05.md).

## A note on the folder name

The task description said `docs/artigo/`. This repository is English-only (decision D-08,
`CONTRIBUTING.md`), so this is `docs/article/` instead — same content, name kept consistent with
the rest of the repo.
