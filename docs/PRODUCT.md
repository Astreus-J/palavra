# Product rules

The rules the bot implements for **authorship**, **completion**, **amendment vs. new commitment**,
**deadlines** and **timezone**. Every rule has an ID and at least one example with an input and the
exact expected output, so it can become a unit test or an eval case.

Related: [DESIGN.md](DESIGN.md) §4 and §6, [FACT-MODEL.md](FACT-MODEL.md),
[STATE-RESOLVER.md](STATE-RESOLVER.md). Portuguese samples of the same phrases live in
`eval/fixtures/extraction-cases.json`; Portuguese phrasing follows exactly the same rules.

## Conventions used in the examples

- The group timezone is `America/Sao_Paulo` (UTC-3, no daylight saving time since 2019).
- Unless stated otherwise, **today is Thursday, 2026-09-24** in the group timezone.
- Group members: Maria, Pedro and Lucas are regular members; Ana is a group admin.
- "Proposal" means the confirmation message with inline buttons that the bot shows before writing.
  Nothing is written to the ledger or Walrus before a proposal is confirmed (DESIGN.md §4).
- `c_budget` and similar ids are shorthand for real fact ids.

---

## 1. Authorship and permissions

### A1. Who the owner is

The `owner` of a commitment is the person responsible for it, stored as a name.
A Telegram user **is the owner** when one of these matches the owner name, compared case-insensitively,
accent-insensitively and after trimming: the first token of their first name, their full name, or their
`@username` (without the `@`).
When the author commits for themselves ("I will..."), `owner` is the author's Telegram first name.

| Input | Expected |
|---|---|
| Maria (first name "Maria") writes "I'll send the budget by Friday" | proposal with `owner=Maria` |
| Commitment has `owner=zoe`; user with first name "Zoë" writes "Done, the logo is sent" | user is treated as the owner |
| Commitment has `owner=Pedro`; user `@pedro_dev` with first name "Pedro Henrique" | user is treated as the owner (the first token of the first name, "Pedro", matches) |

> If two members of the same group match the same owner name, the bot treats neither as the owner
> and asks an admin to confirm (see A4).

### A2. Anyone can record a decision or a commitment

Any group member can record a `DECISION`, a `COMMITMENT` for themselves, or a `COMMITMENT` for someone
else. The fact stores `author` (who wrote it) and `owner` (who is responsible). A commitment made for
someone else mentions the owner in the receipt so they can see it.

| Input | Expected |
|---|---|
| Lucas: "Pedro will finish the backend by the 30th" | proposal `COMMITMENT owner=Pedro due=2026-09-30 author=tg:<Lucas>`; after ✅ the receipt reads "Recorded for Pedro (by Lucas)" |
| Maria: "We agreed the launch is on October 12" | proposal `DECISION due=2026-10-12` |

### A3. Who can press the buttons of a proposal

Only the **author of the message** that created the proposal, or a **group admin**, can press
✅ / ✏️ / ➕ / ✖. Anyone else gets a short notice and nothing changes.

| Input | Expected |
|---|---|
| Proposal created from Maria's message; Pedro presses ✅ | toast "Only Maria or an admin can confirm this"; proposal unchanged |
| Same proposal; Ana (admin) presses ✅ | fact is written |

### A4. Who can complete a commitment

A `COMPLETION` is written right after ✅ when the sender is **the owner** (A1) or **a group admin**.
When anyone else reports it, the bot asks the owner to confirm; the fact is written only after
**the owner or an admin** presses ✅. The written fact keeps the reporter as `author`.

| Input | Expected |
|---|---|
| Pedro (owner of `c_backend`): "I finished the backend" → ✅ | `COMPLETION supersedes=c_backend author=tg:<Pedro>`; item becomes `completed` |
| Ana (admin): "Pedro finished the backend" → ✅ | `COMPLETION supersedes=c_backend author=tg:<Ana>` |
| Lucas: "Pedro finished the backend" | bot: "Pedro, Lucas says *backend* is done. Confirm? [✅ Yes] [✖ No]"; **nothing written** |
| … then Pedro presses ✅ | `COMPLETION supersedes=c_backend author=tg:<Lucas>`, text ends with "Confirmed by Pedro." |
| … Maria presses ✅ instead | toast "Only Pedro or an admin can confirm this"; nothing written |

### A5. Who can amend

The same rule as A4 applies to an `AMENDMENT` of a commitment (new due date, new owner or new
wording): written directly when the sender is the owner or an admin, otherwise only after the owner
or an admin confirms. An amendment of a `DECISION` can be proposed by any member and is written when
the **author of the decision** or an admin confirms.

| Input | Expected |
|---|---|
| Maria (owner of `c_budget`, due Fri 2026-09-25): "Actually I'll send it Saturday" → ✅ | `AMENDMENT supersedes=c_budget due=2026-09-26` |
| Lucas: "Maria's budget moved to Monday" | owner confirmation requested; nothing written until Maria or Ana presses ✅ |
| Maria: "Pedro takes over the budget" → ✅ | `AMENDMENT supersedes=c_budget owner=Pedro`; `/pending` lists it under Pedro |

### A6. Proposals expire

A proposal that nobody confirms within **24 hours** expires: its buttons stop working and nothing is
written. The same applies to owner-confirmation requests (A4, A5).

| Input | Expected |
|---|---|
| Proposal sent 2026-09-24 10:00 local; ✅ pressed 2026-09-25 10:01 local | toast "This proposal expired, please send it again"; nothing written |

---

## 2. Amendment vs. new commitment

### M1. What an amendment is

An `AMENDMENT` changes **the same deliverable** of an existing commitment: its due date, its owner or
its wording. A message is treated as a possible amendment when the extractor returns type `AMENDMENT`
(typical cues: "actually", "postponed", "moved to", "changed", "instead").

| Input | Expected |
|---|---|
| Open: `c_budget` (Maria, budget, 2026-09-25). Maria: "Actually I'll send it Saturday" | proposal `Update "budget — 2026-09-25" → 2026-09-26?  [✅ Yes] [➕ It's another one] [✖]` |

### M2. What a new commitment is

A **different deliverable** is always a new `COMMITMENT`, even with the same owner and the same date.

| Input | Expected |
|---|---|
| Open: `c_budget` (Maria). Maria: "I'll also send the invoice by Friday" | proposal `COMMITMENT owner=Maria due=2026-09-25`, not an amendment of `c_budget` |

### M3. Candidates for an amendment or a completion

Code builds the candidate list; the LLM only chooses among it (or answers "none").
Candidates are the **open or overdue commitments of the stated owner** (or of the author, when no
owner is stated). Completed commitments are never candidates. For an amendment of a decision, the
candidates are the active decisions.

| Situation | Expected |
|---|---|
| Maria has `c_budget` and `c_invoice` open; Maria: "Postponed the invoice to Monday" | candidates `[c_budget, c_invoice]`; LLM picks `c_invoice`; proposal `Update "invoice — 2026-09-25" → 2026-09-28?` |
| Maria has exactly one open commitment | that one is proposed |
| Maria has none open; Maria: "Actually I'll send it Saturday" | no amendment is possible; bot: "I found no open commitment for Maria. Record it as a new commitment? [✅ Yes] [✖]" |
| Maria's only commitment `c_budget` is completed; Maria: "Actually I'll send it Monday" | same as above: completed items are not candidates |

### M4. "It's another one" records a new commitment

Pressing **➕ It's another one** on an amendment proposal turns it into a new `COMMITMENT` with the
extracted owner, task and due date. It never supersedes anything.

| Input | Expected |
|---|---|
| Proposal `Update "budget" → 2026-09-26?`; author presses ➕ | `COMMITMENT owner=Maria due=2026-09-26 supersedes=-` |

### M5. A completion with no candidate is not recorded

| Input | Expected |
|---|---|
| Pedro has no open commitment; Pedro: "Done with the backend" | bot: "I found no open commitment for Pedro." Nothing written |

### M6. Decisions never complete

A `COMPLETION` never targets a `DECISION`. A decision changes only through an `AMENDMENT` (A5).

| Input | Expected |
|---|---|
| Active decision `d_launch` (2026-10-12); Lucas: "The launch is done" | decisions are not candidates; if no commitment matches, M5 applies |
| Lucas: "The launch moved to October 15" → author of `d_launch` confirms | `AMENDMENT supersedes=d_launch due=2026-10-15` |

---

## 3. Deadlines

All relative expressions are resolved against **the date of the message in the group timezone**
(section 4), not against the time the proposal is confirmed. The result is always an ISO date
`YYYY-MM-DD` in the fact header; the time of day is not stored in `due`.

### D1. Today, tomorrow, day after tomorrow, in N days/weeks

| Input (today Thu 2026-09-24) | `due` |
|---|---|
| "today" | 2026-09-24 |
| "tomorrow" | 2026-09-25 |
| "the day after tomorrow" | 2026-09-26 |
| "in 3 days" | 2026-09-27 |
| "in 2 weeks" | 2026-10-08 |

### D2. A bare weekday is its next occurrence, today included

"Friday" means the nearest Friday **on or after today**. Said on a Friday, it means that same day.

| Input | `due` |
|---|---|
| "by Friday" (today Thu 2026-09-24) | 2026-09-25 |
| "on Monday" (today Thu 2026-09-24) | 2026-09-28 |
| "by Thursday" (today Thu 2026-09-24) | 2026-09-24 |
| "by Friday" (today Fri 2026-09-25) | 2026-09-25 |

### D3. "Next week" + weekday is that weekday in the following calendar week

Calendar weeks run Monday to Sunday. "Next Friday" and "Friday next week" mean the Friday of the
**following** week, never the nearest one.

| Input (today Thu 2026-09-24) | `due` |
|---|---|
| "next week, Monday" | 2026-09-28 |
| "next Friday" | 2026-10-02 |
| "Friday next week" | 2026-10-02 |

### D4. A day of the month alone is its next occurrence

"By the 30th" means the next date with that day number **on or after today**. Months without that day
are skipped.

| Input | `due` |
|---|---|
| "by the 30th" (today 2026-09-24) | 2026-09-30 |
| "on the 3rd" (today 2026-09-24) | 2026-10-03 |
| "by the 24th" (today 2026-09-24) | 2026-09-24 |
| "by the 20th" (today 2026-09-24) | 2026-10-20 |
| "by the 30th" (today 2027-02-10) | 2027-03-30 |

### D5. Numeric dates are day/month; a missing year is the next occurrence

Numeric dates are read as `DD/MM` or `DD/MM/YYYY` (Brazilian order), never `MM/DD`.
Written months ("October 12", "12 October") are also accepted. Without a year, the date is in the
current year when it is on or after today, otherwise in the next year.

| Input (today 2026-09-24) | `due` |
|---|---|
| "deadline 02/10" | 2026-10-02 |
| "delivery on 30/09" | 2026-09-30 |
| "October 12" | 2026-10-12 |
| "by 15/01" | 2027-01-15 |
| "by 05/10/2026" | 2026-10-05 |

### D6. End of the month

| Input | `due` |
|---|---|
| "by the end of the month" (today 2026-09-24) | 2026-09-30 |
| "by the end of the month" (today 2027-02-10) | 2027-02-28 |

### D7. The time of day is kept in the text, not in `due`

| Input | Expected |
|---|---|
| "Meeting on Monday at 10am" | `DECISION due=2026-09-28`; the text keeps "at 10am" |

### D8. Vague or missing deadlines are stored as no deadline

"Soon", "later", "next week" (without a weekday), "asap" or no date at all give `due=-`.
The proposal says "no deadline" so the author can set one with ✏️. A commitment without a deadline
is never `overdue`.

| Input | Expected |
|---|---|
| "I'll send the logo soon" | proposal `COMMITMENT owner=<author> due=-`, text "no deadline" |
| "I'll look into it next week" | `due=-` |

### D9. Dates in the past are flagged

If the resolved due date of a `COMMITMENT` or `AMENDMENT` is before today, the proposal shows a
warning and still lets the author confirm. The item is then `overdue` immediately.

| Input (today 2026-09-24) | Expected |
|---|---|
| "I'll send the report by 20/09/2026" | proposal with "⚠️ This date is in the past"; after ✅ `/pending` lists it as overdue |

### D10. When a commitment becomes overdue

A commitment is `overdue` when its due date is **before** today in the group timezone. On the due
date itself it is still `open` (STATE-RESOLVER.md rule 2).

| Commitment `due` | Now (UTC) | Local time | Status |
|---|---|---|---|
| 2026-09-25 | 2026-09-26T02:59:59Z | 2026-09-25 23:59:59 | `open` |
| 2026-09-25 | 2026-09-26T03:00:00Z | 2026-09-26 00:00:00 | `overdue` |

---

## 4. Timezone

### T1. One timezone per group, default America/Sao_Paulo

Each group has an IANA timezone. In P0 every group uses `DEFAULT_TIMEZONE` from the environment,
which defaults to `America/Sao_Paulo`. An invalid timezone stops the bot at startup.

| Input | Expected |
|---|---|
| `DEFAULT_TIMEZONE` unset | groups use `America/Sao_Paulo` |
| `DEFAULT_TIMEZONE=Mars/Olympus` | startup fails with a configuration error |

### T2. "Today" comes from the message timestamp in the group timezone

Relative dates use the Telegram message time (`date`, UTC), converted to the group timezone. The
UTC calendar date does not matter.

| Message time (UTC) | Local time | Input | `due` |
|---|---|---|---|
| 2026-09-25T02:30:00Z | Thu 2026-09-24 23:30 | "tomorrow" | 2026-09-25 |
| 2026-09-25T03:30:00Z | Fri 2026-09-25 00:30 | "tomorrow" | 2026-09-26 |

### T3. Late confirmation does not move the date

The deadline is anchored to the message, not to the ✅ press.

| Input | Expected |
|---|---|
| Message "tomorrow" at Thu 2026-09-24 22:00 local; ✅ pressed Fri 2026-09-25 08:00 local | `due=2026-09-25` |

### T4. Dates shown to users are in the group timezone

Receipts, `/pending`, `/history` and reminders show dates in the group timezone with the weekday.

| Input | Expected |
|---|---|
| `/pending` with `c_budget` due 2026-09-25 | line contains "Fri, Sep 25" |

---

## Open points for review

1. **Owner identity (A1).** Matching by name is fragile. Suggestion for after P0: store the owner's
   Telegram id (`owner_id=tg:<id>`) when the owner is the author or is @mentioned. This changes the
   fact model, so it needs a decision (D-xx).
2. **Bare weekday said on the same weekday (D2).** "By Friday" on a Friday resolves to today. If the
   team prefers the following Friday, change D2 and its examples together.
3. **Admins (A3–A5).** In small groups everybody may be an admin, which removes the confirmation step.
   Accepted for P0.
