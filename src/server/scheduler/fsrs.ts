/** ts-fsrs 封装 + card_state 行的来回转换。 */
import { createEmptyCard, fsrs, generatorParameters, State, type Card, type Grade } from "ts-fsrs";
import { REQUEST_RETENTION } from "./policy.ts";

export const scheduler = fsrs(generatorParameters({ request_retention: REQUEST_RETENTION, enable_fuzz: false }));

export interface CardStateRow {
  item_id: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  archived: number;
  pass_streak: number;
  last_pass_session: number | null;
}

export interface CardState {
  itemId: string;
  card: Card;
  archived: boolean;
  passStreak: number;
  lastPassSession: number | null;
}

export function newCardState(itemId: string, now: Date): CardState {
  return { itemId, card: createEmptyCard(now), archived: false, passStreak: 0, lastPassSession: null };
}

export function review(card: Card, now: Date, grade: Grade): Card {
  return scheduler.next(card, now, grade).card;
}

export function retrievability(card: Card, now: Date): number {
  return card.state === State.New ? 0 : scheduler.get_retrievability(card, now, false);
}

export function toRow(s: CardState): CardStateRow {
  const c = s.card;
  return {
    item_id: s.itemId, due: c.due.toISOString(), stability: c.stability, difficulty: c.difficulty,
    elapsed_days: c.elapsed_days, scheduled_days: c.scheduled_days, learning_steps: c.learning_steps,
    reps: c.reps, lapses: c.lapses, state: c.state, last_review: c.last_review?.toISOString() ?? null,
    archived: s.archived ? 1 : 0, pass_streak: s.passStreak, last_pass_session: s.lastPassSession,
  };
}

export function fromRow(r: CardStateRow): CardState {
  return {
    itemId: r.item_id,
    card: {
      due: new Date(r.due), stability: r.stability, difficulty: r.difficulty, elapsed_days: r.elapsed_days,
      scheduled_days: r.scheduled_days, learning_steps: r.learning_steps, reps: r.reps, lapses: r.lapses,
      state: r.state as State, last_review: r.last_review ? new Date(r.last_review) : undefined,
    },
    archived: r.archived === 1,
    passStreak: r.pass_streak,
    lastPassSession: r.last_pass_session,
  };
}
