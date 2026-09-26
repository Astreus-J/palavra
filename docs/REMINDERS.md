# Deadline reminders

The bot warns the group about commitments that are late or due today. It is **deterministic**: the State
Resolver decides who is late, no LLM is involved. Code: [`src/reminders/scheduler.ts`](../src/reminders/scheduler.ts).

## Rules
| Situation | What happens |
|---|---|
| The due date is before today (group timezone) and the commitment is not completed | **one** "Overdue" reminder |
| The due date is today | **one** "Due today" reminder |
| A commitment has no deadline, or it is a decision | never reminded |
| The commitment is completed | no more reminders (also if it was completed after a reminder) |
| The deadline is amended | the old date is forgotten; the new date gets its own cycle (due today, then overdue) |
| A commitment was recorded with a date already in the past (D9) | it still gets its one overdue reminder (QA case Q09) |

- **Once, never in a loop.** Each reminder is remembered per group, commitment, due date and kind (SQLite table
  `reminders`), so ticking every minute and restarting the bot never repeats it.
- **From 09:00** in the group's timezone (`REMINDER_HOUR`, default 9). Before that hour nothing is sent; a bot that
  was down sends what is pending as soon as it is back and it is past that hour.
- **One message per group and run**, overdue first (oldest due date first), then due today. Lines look like `/pending`.
- **Delivery problems:** a passing failure (network) is retried on the next tick. A chat that can never receive it
  (bot kicked or blocked) is remembered as done so it does not loop.
- Only real Telegram chats are considered; demo namespaces such as `receipt-demo` are skipped.

## Configuration
`REMINDER_HOUR` (0-23, default 9) and `DEFAULT_TIMEZONE` in `.env`. The scheduler ticks every 60 seconds.

## Trying it without waiting for a date
`npm run reminder-demo -- --chat <telegram chat id>` posts a real message using a **simulated clock** and an
in-memory ledger: an overdue and a due-today commitment (one message), a second tick an hour later (nothing), and a
tick the next day after one was completed (one reminder, only for the other). Tests use the same idea:
the clock is a parameter, so no test waits for the real date.
