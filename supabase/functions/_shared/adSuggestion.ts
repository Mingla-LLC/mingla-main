/**
 * #4238 item 8 (W5) — Ari's one suggestion on a running Host ad, and the
 * results it is judged on. Pure: the caller (host-ad-campaign) loads the
 * inputs; `get` shows the suggestion and `change_live` / `accept_last_tickets`
 * recompute it and refuse a stale id.
 *
 * Order (the first that applies wins; never two at once):
 *   1. raise_budget  +20% (pay terms) — out of learning, cost per result at or
 *      under the frozen guidance mid, stock above 30% left and enough to
 *      absorb the extra spend, credit in the wallet for the difference.
 *   2. extend_end    — the run ends before the last bookable moment.
 *   3. lower_budget  −20% — cost per result above 1.5 × the guidance high.
 *   4. accept_last_tickets — the last-tickets ad was offered (W4a 5c).
 *   5. new_video     — information only: no results in the last 3 days.
 * Nothing inside the first 7 days (the learning window), so a suggestion can
 * never trip the 6a learning-reset warning.
 *
 * MINGLA-INVARIANT: I-4238-ARI-RAISE-CAP | issue #4238 | A suggestion never moves a live budget more than 20% in pay terms (floor(pay × 0.8) ≤ new ≤ floor(pay × 1.2)); host-ad-campaign change_live recomputes it, ignores the client amount and refuses ad_suggestion_stale / ad_suggestion_over_cap / ad_suggestion_learning.
 */

import {
  creditCentsFromPay,
  HOST_FEE_RATIO,
  hostMinimumPayCents,
} from "./adMoney.ts";
import {
  HOST_LEARNING_WINDOW_DAYS,
  HOST_LIVE_EDIT_STATES,
} from "./adHostLiveEdit.ts";

export type HostAdSuggestionKind =
  | "raise_budget"
  | "extend_end"
  | "lower_budget"
  | "accept_last_tickets"
  | "new_video";

export type HostAdSuggestionInput = {
  planId: string;
  planState: string;
  nowMs: number;
  /** When the ad first went live (loadHostLiveSinceMs); null = not live. */
  liveSinceMs: number | null;
  lastEditAt: string | null;
  goal: "sales" | "signups" | "visits";
  currency: string;
  /** The plan's current total budget (the held amount, credit terms). */
  currentTotalCents: number;
  currentEndsAt: string | null;
  lastBookableAt: string | null;
  /** Spend so far in the brand's money (credit terms). */
  spendCents: number;
  /** Tickets (sales) or sign-ups (signups); clicks for visits. */
  results: number;
  resultsLast3Days: number;
  /** The plan's frozen guidance (create_version guidance_snapshot). */
  costPerResult: { midCents: number; highCents: number } | null;
  stock:
    | { remaining: number | null; total: number | null; unlimited: boolean }
    | null;
  walletCents: number | null;
  lastTicketsOffered: boolean;
  /**
   * #4238 rework 3 (tester P3-3): the latest pause/stop reason code on the
   * plan's campaigns (ad_status_events provider_response.reason), if any.
   */
  stopReason?: string | null;
};

/**
 * #4238 rework 3: stop reasons after which no budget or date change helps:
 * the tickets are gone or the event is over. Ari stays quiet on these.
 */
export const SUGGESTION_FINAL_STOP_REASONS: ReadonlySet<string> = new Set([
  "sold_out",
  "event_ended",
  "bookings_closed",
  "not_on_sale",
]);

export type HostAdSuggestionMoney = {
  currency: string;
  fee_ratio: number;
  current_total_cents: number;
  current_total_pay_cents: number;
  new_total_cents: number;
  new_total_pay_cents: number;
  /** Signed change in ad spend (credit) and in what the Host pays. */
  change_cents: number;
  change_pay_cents: number;
  /** Mingla's 15% share of the pay change (always ≥ 0). */
  change_fee_cents: number;
};

export type HostAdSuggestion = {
  suggestion_id: string;
  kind: HostAdSuggestionKind;
  /** The host-ad-campaign action that applies it; null = information only. */
  apply_action: "change_live" | "accept_last_tickets" | null;
  host_budget_cents?: number;
  ends_at?: string;
  money?: HostAdSuggestionMoney;
  days_live: number;
  basis: {
    results: number;
    cost_per_result_cents: number | null;
    guidance_mid_cents: number | null;
    guidance_high_cents: number | null;
    stock_left: number | null;
    /**
     * #4238 rework 3 (tester P3-2): the goal the results above were counted
     * for (tickets, sign-ups or clicks). The card names its unit from this,
     * never from a different goal source.
     */
    goal: "sales" | "signups" | "visits";
  };
};

export const SUGGESTION_RAISE_RATIO = 1.2;
export const SUGGESTION_LOWER_RATIO = 0.8;
export const SUGGESTION_LOWER_AT_HIGH = 1.5;
export const SUGGESTION_STOCK_LEFT_MIN = 0.3;
const DAY_MS = 86_400_000;

/** Pay terms: floor(pay × 0.8) ≤ newPay ≤ floor(pay × 1.2), integer maths. */
export function hostSuggestionWithinCap(
  currentCreditCents: number,
  newCreditCents: number,
): boolean {
  if (
    !Number.isSafeInteger(currentCreditCents) || currentCreditCents <= 0 ||
    !Number.isSafeInteger(newCreditCents) || newCreditCents <= 0
  ) return false;
  const pay = hostMinimumPayCents(currentCreditCents);
  const next = hostMinimumPayCents(newCreditCents);
  return Math.floor((pay * 8) / 10) <= next &&
    next <= Math.floor((pay * 12) / 10);
}

/** The largest credit total whose pay is at most floor(pay × 1.2). */
export function hostRaisedTotalCents(currentCreditCents: number): number {
  const pay = hostMinimumPayCents(currentCreditCents);
  let credit = creditCentsFromPay(Math.floor((pay * 12) / 10));
  while (
    credit > currentCreditCents &&
    !hostSuggestionWithinCap(currentCreditCents, credit)
  ) {
    credit -= 1;
  }
  return credit;
}

/** The smallest credit total whose pay is at least floor(pay × 0.8). */
export function hostLoweredTotalCents(currentCreditCents: number): number {
  const pay = hostMinimumPayCents(currentCreditCents);
  let credit = creditCentsFromPay(Math.ceil((pay * 8) / 10));
  while (
    credit < currentCreditCents &&
    !hostSuggestionWithinCap(currentCreditCents, credit)
  ) {
    credit += 1;
  }
  return credit;
}

function money(
  currency: string,
  current: number,
  next: number,
): HostAdSuggestionMoney {
  const currentPay = hostMinimumPayCents(current);
  const nextPay = hostMinimumPayCents(next);
  const changePay = nextPay - currentPay;
  const change = next - current;
  return {
    currency,
    fee_ratio: HOST_FEE_RATIO,
    current_total_cents: current,
    current_total_pay_cents: currentPay,
    new_total_cents: next,
    new_total_pay_cents: nextPay,
    change_cents: change,
    change_pay_cents: changePay,
    change_fee_cents: Math.max(0, Math.abs(changePay) - Math.abs(change)),
  };
}

async function suggestionId(parts: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(["4238-w5", ...parts]));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    .slice(0, 40);
}

/** The one suggestion for this plan right now, or null. */
export async function hostAdSuggestion(
  input: HostAdSuggestionInput,
): Promise<HostAdSuggestion | null> {
  if (!HOST_LIVE_EDIT_STATES.has(input.planState)) return null;
  // #4238 rework 3 (tester P3-3): never "run it longer" on an ad that
  // stopped because it sold out or the event is over.
  // Only while paused: a later resume (new stock) makes the ad live again.
  if (
    (input.planState === "paused" || input.planState === "pause_requested") &&
    input.stopReason && SUGGESTION_FINAL_STOP_REASONS.has(input.stopReason)
  ) {
    return null;
  }
  const since = input.liveSinceMs;
  if (since === null || !Number.isFinite(since)) return null;
  if (input.nowMs - since < HOST_LEARNING_WINDOW_DAYS * DAY_MS) return null;
  const current = input.currentTotalCents;
  if (!Number.isSafeInteger(current) || current <= 0) return null;
  const daysLive = Math.floor((input.nowMs - since) / DAY_MS) + 1;
  const editable = !input.lastEditAt ||
    input.nowMs - Date.parse(input.lastEditAt) >= DAY_MS;
  const results = Math.max(0, Math.floor(input.results));
  const spend = Math.max(0, input.spendCents);
  const cpr = results > 0 ? spend / results : null;
  const guide = input.costPerResult;
  const stock = input.stock;
  const stockLeft = stock && !stock.unlimited ? stock.remaining : null;
  const basis = {
    results,
    cost_per_result_cents: cpr === null ? null : Math.round(cpr),
    guidance_mid_cents: guide?.midCents ?? null,
    guidance_high_cents: guide?.highCents ?? null,
    stock_left: stockLeft,
    goal: input.goal,
  };
  const soldOut = stockLeft !== null && stockLeft <= 0;
  const build = async (
    kind: HostAdSuggestionKind,
    extra: { host_budget_cents?: number; ends_at?: string },
  ): Promise<HostAdSuggestion> => ({
    suggestion_id: await suggestionId([
      input.planId,
      kind,
      current,
      input.currentEndsAt,
      extra.host_budget_cents ?? null,
      extra.ends_at ?? null,
    ]),
    kind,
    apply_action: kind === "new_video"
      ? null
      : kind === "accept_last_tickets"
      ? "accept_last_tickets"
      : "change_live",
    ...extra,
    ...(extra.host_budget_cents !== undefined
      ? { money: money(input.currency, current, extra.host_budget_cents) }
      : {}),
    days_live: daysLive,
    basis,
  });

  if (editable && guide && cpr !== null && input.goal !== "visits") {
    // 1. Raise: cheap results, enough left to sell, credit to pay for it.
    const stockOk = stock !== null && (stock.unlimited ||
      (stockLeft !== null && stock.total !== null && stock.total > 0 &&
        stockLeft / stock.total > SUGGESTION_STOCK_LEFT_MIN));
    const raised = hostRaisedTotalCents(current);
    const extra = raised - current;
    const absorbs = stock?.unlimited === true ||
      (stockLeft !== null && extra / cpr <= stockLeft);
    if (
      cpr <= guide.midCents && stockOk && absorbs && extra > 0 &&
      input.walletCents !== null && input.walletCents >= extra &&
      hostSuggestionWithinCap(current, raised)
    ) {
      return await build("raise_budget", { host_budget_cents: raised });
    }
  }
  if (editable && !soldOut && input.currentEndsAt && input.lastBookableAt) {
    // 2. Extend: the ad stops before people can stop booking.
    const end = Date.parse(input.currentEndsAt);
    const last = Date.parse(input.lastBookableAt);
    if (
      Number.isFinite(end) && Number.isFinite(last) && last > input.nowMs &&
      last - end > 3_600_000
    ) {
      return await build("extend_end", {
        ends_at: new Date(last).toISOString(),
      });
    }
  }
  if (editable && guide && input.goal !== "visits") {
    // 3. Lower: results cost far more than similar events.
    const tooDear = cpr !== null
      ? cpr > SUGGESTION_LOWER_AT_HIGH * guide.highCents
      : spend > SUGGESTION_LOWER_AT_HIGH * guide.highCents;
    const lowered = hostLoweredTotalCents(current);
    if (
      tooDear && lowered < current && lowered > spend &&
      hostSuggestionWithinCap(current, lowered)
    ) {
      return await build("lower_budget", { host_budget_cents: lowered });
    }
  }
  if (input.lastTicketsOffered) return await build("accept_last_tickets", {});
  if (spend > 0 && input.resultsLast3Days === 0) {
    return await build("new_video", {});
  }
  return null;
}

/**
 * #4238 amendment B item 8 (W5): an edit carrying a suggestion_id is Ari's
 * (or the Host's one-tap) suggestion. The server recomputes it and
 *   1. refuses ad_suggestion_stale when it changed (or is gone);
 *   2. ignores the amount / end the client sent and applies the recomputed one;
 *   3. refuses ad_suggestion_over_cap outside floor(pay × 0.8)..floor(pay × 1.2);
 *   4. refuses ad_suggestion_learning inside the first 7 days, and never
 *      carries a learning-reset acknowledgement (the 6a guard still runs).
 */
export function resolveSuggestedEdit(
  body: Record<string, unknown>,
  suggestion: HostAdSuggestion | null,
  ctx: { currentTotalCents: number; liveSinceMs: number | null; nowMs: number },
):
  | {
    ok: true;
    change: {
      newHostBudgetCents: unknown;
      newEndsAt: unknown;
      acknowledgeLearningReset: boolean;
    };
  }
  | { ok: false; status: number; error: string } {
  if (!("suggestion_id" in body)) {
    return {
      ok: true,
      change: {
        newHostBudgetCents: body.new_budget_cents,
        newEndsAt: body.new_ends_at,
        acknowledgeLearningReset: body.acknowledge_learning_reset === true,
      },
    };
  }
  const since = ctx.liveSinceMs;
  if (
    since === null || ctx.nowMs - since < HOST_LEARNING_WINDOW_DAYS * 86_400_000
  ) {
    return { ok: false, status: 409, error: "ad_suggestion_learning" };
  }
  if (
    typeof body.suggestion_id !== "string" || !suggestion ||
    suggestion.apply_action !== "change_live" ||
    suggestion.suggestion_id !== body.suggestion_id
  ) {
    return { ok: false, status: 409, error: "ad_suggestion_stale" };
  }
  if (
    suggestion.host_budget_cents !== undefined &&
    !hostSuggestionWithinCap(
      ctx.currentTotalCents,
      suggestion.host_budget_cents,
    )
  ) {
    return { ok: false, status: 422, error: "ad_suggestion_over_cap" };
  }
  return {
    ok: true,
    change: {
      newHostBudgetCents: suggestion.host_budget_cents ?? null,
      newEndsAt: suggestion.ends_at ?? null,
      acknowledgeLearningReset: false,
    },
  };
}

/**
 * #4238 8a: results in tickets and sign-ups, not orders. Tickets are the
 * tickets issued on each counted conversion's order; a sign-up is the RSVP's
 * heads (1 + plus_count), or the free order's tickets.
 */
export function hostAdResultCounts(input: {
  conversions: readonly {
    event_type?: unknown;
    order_id?: unknown;
    event_id?: unknown;
  }[];
  ticketsByOrder: ReadonlyMap<string, number>;
  rsvpHeads: ReadonlyMap<string, number>;
}): { orders: number; tickets: number; sign_ups: number } {
  let orders = 0;
  let tickets = 0;
  let signUps = 0;
  for (const row of input.conversions) {
    const orderId = typeof row.order_id === "string" ? row.order_id : null;
    if (row.event_type === "purchase") {
      orders += 1;
      tickets += orderId
        ? Math.max(1, input.ticketsByOrder.get(orderId) ?? 1)
        : 1;
    } else if (row.event_type === "reservation") {
      if (orderId) {
        signUps += Math.max(1, input.ticketsByOrder.get(orderId) ?? 1);
      } else {
        const key = typeof row.event_id === "string" ? row.event_id : "";
        signUps += Math.max(1, input.rsvpHeads.get(key) ?? 1);
      }
    }
  }
  return { orders, tickets, sign_ups: signUps };
}
