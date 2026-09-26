# Eval and QA scenarios

Test scenarios for the **3-arm eval** (DESIGN.md §7, task HACKATONSU-25) and for the **manual QA**
before real use (HACKATONSU-27). Every scenario states its input messages, the question, and the
exact expected answer. Product rules referenced as `A1`, `D2`, etc. are defined in
[docs/PRODUCT.md](../docs/PRODUCT.md).

## Part 1 — Eval (automated, 3 arms)

### How a scenario runs

1. **Session 1** writes the listed facts, in order, at the listed instants. Only confirmed facts are
   listed: the eval tests memory, not the confirmation UI.
2. The process is restarted: **session 2** has no conversation context.
3. The question is asked in session 2 at `ask_at`, and each arm answers it:

| Arm | What the LLM receives |
|---|---|
| `no-recall` | only the question |
| `recall` | the question + `recall(question, sort: "recent")` results |
| `resolver` | the question + the State Resolver output for the group + the same recall results |

### How an answer is graded

An answer is a **hit** when all of these hold, otherwise a **miss**:

- it contains every value in `must_include` (case-insensitive);
- it contains every date in `dates`, written in any of these forms: `2026-09-25`, `Sep 25`,
  `September 25`, `25/09`;
- it contains none of the values in `must_not_include` and none of the dates in `wrong_dates`
  (same accepted forms).

`answer` is the canonical reply: the exact text the `resolver` arm is expected to produce with the
bot's templates. It is used in the report and in snapshot tests. Grading uses the fields above, so a
correct answer phrased differently by the LLM is still a hit.

`expected` is the prediction per arm from DESIGN.md §7. The eval measures it; it does not assume it.

### Shared setup

- Group timezone `America/Sao_Paulo` (UTC-3). One group per scenario, namespace `grp:eval-<id>`.
- Session 1 runs on **Thu 2026-09-24**, starting at 10:00 local (`13:00:00Z`).
- Fact text is the sentence the bot would write; the header fields are the ones listed.
- Fact ids in the YAML (`c_budget`, `a_budget1`, ...) are **aliases**, not valid fact ids (the fact
  model requires `<d|c|a|k>_<8 hex>`). The runner assigns real ids with `newFactId(type)` and maps
  each alias, including in `supersedes`, to the real id.

---

### S01 — Recover a recorded commitment

Covers: *recover a commitment*.

```yaml
id: S01
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: COMMITMENT, id: c_budget, owner: Maria, due: 2026-09-25,
      text: "Maria committed to sending the budget by Friday, 2026-09-25." }
ask_at: "2026-09-25T12:00:00Z"   # Fri 09:00 local
question: "When is Maria's budget due?"
answer: "Maria's budget is due Fri, Sep 25."
must_include: [Maria, budget]
dates: [2026-09-25]
expected: { no-recall: miss, recall: hit, resolver: hit }
```

### S02 — Commitment amended once

Covers: *amended once*.

```yaml
id: S02
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: COMMITMENT, id: c_budget, owner: Maria, due: 2026-09-25,
      text: "Maria committed to sending the budget by Friday, 2026-09-25." }
  - { at: "2026-09-24T13:05:00.000Z", type: AMENDMENT, id: a_budget1, supersedes: c_budget, due: 2026-09-26,
      text: "Maria moved the budget to Saturday, 2026-09-26." }
ask_at: "2026-09-25T12:00:00Z"
question: "When is Maria's budget due?"
answer: "Maria's budget is due Sat, Sep 26 (changed from Fri, Sep 25)."
must_include: [Maria, budget]
dates: [2026-09-26]
must_not_include: ["due Fri", "due Friday"]
expected: { no-recall: miss, recall: unstable, resolver: hit }
```

> The canonical answer mentions the old date as history, so `2026-09-25` is not in `wrong_dates`;
> stating it as the current due date is caught by `must_not_include`.

### S03 — Amended twice with close timestamps

Covers: *amended twice with close timestamps*. Both amendments fall in the same second, which is
where recall ordering was reported to be unstable.

```yaml
id: S03
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: COMMITMENT, id: c_budget, owner: Maria, due: 2026-09-25,
      text: "Maria committed to sending the budget by Friday, 2026-09-25." }
  - { at: "2026-09-24T13:10:00.100Z", type: AMENDMENT, id: a_budget1, supersedes: c_budget, due: 2026-09-26,
      text: "Maria moved the budget to Saturday, 2026-09-26." }
  - { at: "2026-09-24T13:10:00.900Z", type: AMENDMENT, id: a_budget2, supersedes: a_budget1, due: 2026-09-28,
      text: "Maria moved the budget to Monday, 2026-09-28." }
ask_at: "2026-09-25T12:00:00Z"
question: "When is Maria's budget due?"
answer: "Maria's budget is due Mon, Sep 28 (changed twice: Fri, Sep 25 → Sat, Sep 26 → Mon, Sep 28)."
must_include: [Maria, budget]
dates: [2026-09-28]
must_not_include: ["due Fri", "due Friday", "due Sat", "due Saturday"]
expected: { no-recall: miss, recall: unstable, resolver: hit }
```

### S04 — Completed commitment is not pending

Covers: *completed absent from pending*.

```yaml
id: S04
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: COMMITMENT, id: c_backend, owner: Pedro, due: 2026-09-30,
      text: "Pedro committed to finishing the backend by 2026-09-30." }
  - { at: "2026-09-24T13:01:00.000Z", type: COMMITMENT, id: c_identity, owner: Joao, due: 2026-09-25,
      text: "Joao committed to delivering the visual identity by 2026-09-25." }
  - { at: "2026-09-24T15:00:00.000Z", type: COMPLETION, id: k_identity, supersedes: c_identity,
      text: "Joao delivered the visual identity." }
ask_at: "2026-09-25T12:00:00Z"
question: "What is still pending?"
answer: "Pending (1):\n• Pedro — finish the backend — due Wed, Sep 30"
must_include: [Pedro, backend]
dates: [2026-09-30]
must_not_include: ["visual identity", Joao]
expected: { no-recall: miss, recall: miss, resolver: hit }
```

### S05 — Empty recall right after a write

Covers: *empty recall after a write*. The question comes 2 seconds after the write, before the
Walrus job reaches `done`. The runner must force this: in `MemWalMock`, delay indexing; on mainnet,
ask before `rememberAndWait` returns.

```yaml
id: S05
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: DECISION, id: d_launch, due: 2026-10-12,
      text: "The group decided the launch is on Monday, 2026-10-12." }
recall_state: not_indexed        # recall returns no results for this fact
ask_at: "2026-09-24T13:00:02Z"   # same session is fine: the ledger already has the fact
question: "When is the launch?"
answer: "The launch is on Mon, Oct 12."
must_include: [launch]
dates: [2026-10-12]
expected: { no-recall: miss, recall: miss, resolver: hit }
```

### S06 — Overdue commitment

A commitment whose due date passed must be reported as overdue (D10).

```yaml
id: S06
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: COMMITMENT, id: c_backend, owner: Pedro, due: 2026-09-25,
      text: "Pedro committed to finishing the backend by Friday, 2026-09-25." }
ask_at: "2026-09-26T13:00:00Z"   # Sat 10:00 local
question: "Is anything overdue?"
answer: "Overdue (1):\n• Pedro — finish the backend — was due Fri, Sep 25"
must_include: [Pedro, backend, overdue]
dates: [2026-09-25]
expected: { no-recall: miss, recall: unstable, resolver: hit }
```

### S07 — Same owner, only one commitment amended

Two commitments of the same owner; the amendment targets only the invoice (M3).
Recall tends to mix them up.

```yaml
id: S07
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: COMMITMENT, id: c_budget, owner: Maria, due: 2026-09-25,
      text: "Maria committed to sending the budget by Friday, 2026-09-25." }
  - { at: "2026-09-24T13:01:00.000Z", type: COMMITMENT, id: c_invoice, owner: Maria, due: 2026-09-25,
      text: "Maria committed to sending the invoice by Friday, 2026-09-25." }
  - { at: "2026-09-24T13:02:00.000Z", type: AMENDMENT, id: a_invoice1, supersedes: c_invoice, due: 2026-09-28,
      text: "Maria moved the invoice to Monday, 2026-09-28." }
ask_at: "2026-09-25T12:00:00Z"
question: "When is Maria's budget due?"
answer: "Maria's budget is due Fri, Sep 25."
must_include: [Maria, budget]
dates: [2026-09-25]
wrong_dates: [2026-09-28]
expected: { no-recall: miss, recall: unstable, resolver: hit }
```

### S08 — Owner handed over

The budget moves from Maria to Pedro (A5). The answer must name the current owner.

```yaml
id: S08
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: COMMITMENT, id: c_budget, owner: Maria, due: 2026-09-25,
      text: "Maria committed to sending the budget by Friday, 2026-09-25." }
  - { at: "2026-09-24T14:00:00.000Z", type: AMENDMENT, id: a_budget1, supersedes: c_budget, owner: Pedro,
      text: "Pedro took over the budget from Maria." }
ask_at: "2026-09-25T12:00:00Z"
question: "Who is responsible for the budget?"
answer: "Pedro is responsible for the budget (taken over from Maria), due Fri, Sep 25."
must_include: [Pedro, budget]
dates: [2026-09-25]
must_not_include: ["Maria is responsible"]
expected: { no-recall: miss, recall: unstable, resolver: hit }
```

### S09 — Amended decision

A decision changes through an amendment (M6).

```yaml
id: S09
facts:
  - { at: "2026-09-24T13:00:00.000Z", type: DECISION, id: d_launch, due: 2026-10-12,
      text: "The group decided the launch is on Monday, 2026-10-12." }
  - { at: "2026-09-24T16:00:00.000Z", type: AMENDMENT, id: a_launch1, supersedes: d_launch, due: 2026-10-15,
      text: "The launch moved to Thursday, 2026-10-15." }
ask_at: "2026-09-25T12:00:00Z"
question: "When is the launch?"
answer: "The launch is on Thu, Oct 15 (changed from Mon, Oct 12)."
must_include: [launch]
dates: [2026-10-15]
must_not_include: ["launch is on Mon", "launch is on Monday"]
expected: { no-recall: miss, recall: unstable, resolver: hit }
```

### S10 — Timezone boundary

Due today in Sao Paulo is still open even though the UTC date has already moved on (D10, T2).

```yaml
id: S10
facts:
  - { at: "2026-09-25T02:30:00.000Z", type: COMMITMENT, id: c_logo, owner: Ana, due: 2026-09-25,
      text: "Ana committed to sending the logo tomorrow, 2026-09-25." }   # sent Thu 23:30 local
ask_at: "2026-09-26T02:30:00Z"   # Fri 23:30 local, already Sat in UTC
question: "Is Ana's logo overdue?"
answer: "No. Ana's logo is due today, Fri, Sep 25."
must_include: [Ana, logo]
dates: [2026-09-25]
must_not_include: ["is overdue", "was due"]
expected: { no-recall: miss, recall: unstable, resolver: hit }
```

### Coverage

| Required case (HACKATONSU-26) | Scenario |
|---|---|
| Recover a commitment | S01 |
| Amended once | S02 |
| Amended twice with close timestamps | S03 |
| Completed absent from pending | S04 |
| Empty recall right after a write | S05 |
| Extra: overdue, same-owner confusion, owner handover, amended decision, timezone | S06–S10 |

---

## Part 2 — QA (manual, Telegram test group)

Run in the test group with 3 accounts: **Maria** (member), **Pedro** (member), **Ana** (admin).
Use `MEMWAL_MODE=real` (Walrus mainnet). Mark each case pass or fail; every failure becomes a Plane
task with the steps below. Replies are in English (D-08); exact wording is owned by HACKATONSU-23, so
check the **content** listed, not the phrasing.

| ID | Steps | Expected | Rule |
|---|---|---|---|
| Q01 | Ana sends `/start` | notice that records go to Walrus and cannot be deleted | DESIGN §6 |
| Q02 | Maria: `/palavra I'll send the budget by Friday` → ✅ | proposal shows owner Maria, due Fri; after ✅ a ⏳ receipt, then 🔗 with a Walruscan link that opens | A2, D2 |
| Q03 | Maria: `@<bot> actually I'll send it Saturday` → ✅ | proposal "Update budget → Sat"; after ✅ `/pending` shows the budget due Sat | M1, A5 |
| Q04 | Pedro presses ✅ on a proposal created by Maria | toast "Only Maria or an admin can confirm this"; nothing written | A3 |
| Q05 | Pedro: `/palavra Maria finished the budget` | bot asks Maria to confirm; `/pending` still lists the budget | A4 |
| Q06 | Maria presses ✅ on the request from Q05 | budget leaves `/pending`; `/history budget` shows commitment → amendment → completion | A4 |
| Q07 | Pedro: `/palavra done with the backend` (Pedro has nothing open) | "I found no open commitment for Pedro"; nothing written | M5 |
| Q08 | Maria: `/palavra I'll send the logo soon` → ✅ | proposal says "no deadline"; the item never shows as overdue | D8 |
| Q09 | Commitment due yesterday (set `due` in the past, D9) then wait for the reminder tick | one reminder for the overdue item, naming the owner | D10 |
| Q10 | Free question: `@<bot> when is the budget due?` | answer with the current date and at least one Walruscan receipt | DESIGN §5 |
| Q11 | Stop the bot, delete the SQLite file, run restore, start the bot | `/pending` and `/history budget` match what they showed before | D-01 |
| Q12 | Leave a proposal unconfirmed for 24 h, then press ✅ | "This proposal expired"; nothing written | A6 |
