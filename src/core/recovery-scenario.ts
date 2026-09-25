import { newFactId, type Fact } from "./fact.js";
import { todayIn } from "./resolver.js";

/** A calendar date `days` away from today in the given timezone (YYYY-MM-DD). */
export function dateFromToday(now: Date, timeZone: string, days: number): string {
  const [y, m, d] = todayIn(now, timeZone).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The facts used by the recovery test: 8 facts that exercise everything the resolver does.
 *  - Maria: a commitment amended twice (open)
 *  - Pedro: a commitment left overdue
 *  - Joao: a commitment that gets completed
 *  - a decision that is amended
 * Dates are relative to `now`, so the pending list always has one overdue and one open commitment.
 */
export function buildScenario(now: Date, timeZone: string): Fact[] {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const due = (days: number) => dateFromToday(now, timeZone, days);
  const base = { author: "tg:restore-test", owner: null, due: null, topic: null, supersedes: null } as const;

  const budget = newFactId("COMMITMENT");
  const budgetV2 = newFactId("AMENDMENT");
  const budgetV3 = newFactId("AMENDMENT");
  const backend = newFactId("COMMITMENT");
  const identity = newFactId("COMMITMENT");
  const identityDone = newFactId("COMPLETION");
  const delivery = newFactId("DECISION");
  const deliveryV2 = newFactId("AMENDMENT");

  return [
    { ...base, id: budget, type: "COMMITMENT", owner: "Maria", due: due(-1), at: at(8), text: "Maria will send the budget." },
    { ...base, id: budgetV2, type: "AMENDMENT", supersedes: budget, due: due(3), at: at(7), text: "Maria moved the budget to later this week." },
    { ...base, id: budgetV3, type: "AMENDMENT", supersedes: budgetV2, due: due(5), at: at(6), text: "Maria moved the budget again, to next week." },
    { ...base, id: backend, type: "COMMITMENT", owner: "Pedro", due: due(-1), at: at(5), text: "Pedro will finish the backend." },
    { ...base, id: identity, type: "COMMITMENT", owner: "Joao", due: due(1), at: at(4), text: "Joao will deliver the visual identity." },
    { ...base, id: identityDone, type: "COMPLETION", supersedes: identity, at: at(3), text: "Joao delivered the visual identity." },
    { ...base, id: delivery, type: "DECISION", topic: "delivery", due: due(10), at: at(2), text: "The project delivery is in ten days." },
    { ...base, id: deliveryV2, type: "AMENDMENT", supersedes: delivery, due: due(12), at: at(1), text: "The project delivery moved by two days." },
  ];
}
