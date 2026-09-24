# Gemini model check (task HACKATONSU-9, decision D-05)

Script: `eval/gemini-extraction.ts` (20 fixtures, Portuguese and English, in `eval/fixtures/`).
Run it with `GEMINI_MODEL` and `GEMINI_API_KEY` set (see the README for the exact command).

## Results so far (2026-09-24)
Measured on the first 16 fixtures (Portuguese), before the SDK migration:

| Model | Valid JSON | Type | Owner | Due date | Notes |
|---|---|---|---|---|---|
| `gemini-2.5-flash-lite` | 16/16 (100%) | 16/16 (100%) | 10/10 (100%) | 7/9 (78%) | with retry and backoff, 7 retries, 62 s |
| `gemini-3.5-flash` | 12/16 (75%)* | 11/16 | 7/10 | 7/9 | *failures were 503s, not wrong answers |
| `gemini-3.1-flash-lite` | 11/16 (69%)* | 10/16 | 6/10 | 7/9 | *failures were 503s |
| `gemini-3.8-flash` | 0/16 | n/a | n/a | n/a | 403 "project denied access", later 503 |
| `gemini-3.7-flash` | 0/16 | n/a | n/a | n/a | 403, later 503 |

The runs marked with * had no retry logic at the time, so their numbers reflect availability, not quality.

After migrating to `@google/genai`, the check was re-run on `gemini-2.5-flash-lite`, but the
quota was exhausted (HTTP 429) after a few calls. The calls that did complete worked, and for one
case the model returned a datetime (`2026-09-28T10:00:00`) instead of a date.

**To do:** re-run all 20 fixtures once the quota is back or billing is enabled, and store the output here.

## Integration friction (material for the article and the feedback form)
- The models listing includes models that no longer accept new users: `gemini-2.5-flash` is listed but
  returns 404 "no longer available to new users".
- A project can list a model and still get 403 "project has been denied access".
- Newer models return 503 "high demand" repeatedly; retry with exponential backoff is mandatory.
- The free-tier quota is small (429), and free-tier prompts are used for training, which matters
  because the bot reads real group messages.
- `responseJsonSchema` with `responseMimeType: "application/json"` gives valid JSON, but the date
  format must be enforced in the prompt (the model may return a datetime).
