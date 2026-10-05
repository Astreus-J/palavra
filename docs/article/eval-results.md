# Eval results for the article

Full methodology and per-scenario answers: [`docs/evidence/eval-three-arms-2026-10-05.md`](../evidence/eval-three-arms-2026-10-05.md).
Scenario definitions: [`eval/scenarios.md`](../../eval/scenarios.md). Reproduce with `npm run eval`.

## The headline table

10 scenarios, one free OpenRouter model (`dots-studio/dots-3-note-preview:free`), the same
question asked three ways:

| Arm | What the model sees | Hit rate |
|---|---|---|
| **no-recall** | just the question | **0 / 10** |
| **recall** | the question + semantic search results | **6 / 10** |
| **resolver** | the question + the State Resolver's computed state + the same search results | **9 / 10** |

## Why this is the article's central figure

- **no-recall** is the baseline: an LLM with no memory at all gets nothing right. Expected, but it
  calibrates the other two numbers.
- **recall** alone is unstable, not useless: it gets a majority of questions right, but fails
  exactly where memory matters most — when a fact changed (an amendment superseded the original)
  or when the answer depends on combining several facts (what's still pending, is anything
  overdue). Semantic search finds *a* relevant memory, not necessarily *the current* one.
- **resolver** is deterministic, not because the model got smarter, but because the question it
  answers is different: it is handed the already-computed current state (open/overdue/completed,
  the winning side of every fork) instead of having to infer it from raw, possibly-conflicting
  memories.

## One honest miss, not swept under the rug

The single resolver miss (scenario S08, "Who is responsible for the budget?") named the right
owner (Pedro, correctly taken over from Maria) but left out the due date, which the grading rule
requires. That is model variance in how it phrases an answer from correct input, not a resolver
bug — a good, concrete example for the article of the difference between "the system knows the
right answer" and "the model said the right answer."

## One line for the article

> Across the same 10 questions, an LLM with no memory got 0 right, semantic recall alone got 6,
> and recall combined with a deterministic State Resolver got 9 — and the one miss was a phrasing
> issue, not a wrong fact.
