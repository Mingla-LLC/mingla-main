/**
 * #4238 W6b — the ad detail and Promote home rules, pure (no React, no
 * network, no words) so every number and every reason is unit-tested.
 *
 * ONE unit on screen: what the Host PAYS (the 15% Mingla fee inside). The
 * server keeps budgets, holds, spend and the wallet in Ads credit (what the
 * apps spend), so every credit amount is shown through hostAdPayFromCredit,
 * and an amount the Host types goes back through hostAdCreditFromPay.
 * Server amounts already in pay terms (`*_pay_cents`) are shown as they are.
 */
import {
  hostAdCreditFromPay,
  hostAdPayFromCredit,
  hostAdPlanBudget,
  type HostAdGoal,
} from "./hostAdBuilderModel";

// ── True stop reasons (I-4238-TRUE-PAUSE-REASON, client side) ───────────

/** Why an ad is not running, in the Host's terms. Never "ended or isn't public". */
export type HostAdStopReason =
  | "soldOut"
  | "eventPassed"
  | "budgetUsed"
  | "youEnded"
  | "youPaused"
  | "creditOut"
  | "notOnSale"
  | "bookingsClosed"
  | "notPublic"
  | "endDate"
  | "checkFailed"
  | "spendUnreadable"
  | "cancelled";

/**
 * The server's stored reason (ad_status_events.provider_response.reason, the
 * list's pause_reason) → the true reason. Unknown codes return null so the
 * caller shows the plain status instead of guessing.
 */
export function hostAdReasonFromCode(code: string | null | undefined): HostAdStopReason | null {
  switch ((code ?? "").trim()) {
    case "sold_out":
      return "soldOut";
    case "event_ended":
      return "eventPassed";
    case "end_date_passed":
      return "endDate";
    case "cap_reached":
    case "cap_98_percent":
    case "budget_used":
      return "budgetUsed";
    case "credit_out":
      return "creditOut";
    case "host_paused":
      return "youPaused";
    case "host_ended":
    case "host_end":
      return "youEnded";
    case "not_on_sale":
      return "notOnSale";
    case "bookings_closed":
      return "bookingsClosed";
    case "destination_unavailable":
    case "destination_not_public":
    case "not_public":
      return "notPublic";
    case "destination_check_failed":
      return "checkFailed";
    case "spend_fetch_failed":
    case "provider_currency_unresolved":
    case "provider_cap_unresolved":
      return "spendUnreadable";
    default:
      return null;
  }
}

export type HostAdTimelineEvent = {
  action: string;
  provider_response: Record<string, unknown> | null;
  created_at: string;
  actor_kind?: unknown;
};

/** The newest pause/end/stop event's stored reason code, if it has one. */
export function hostAdLatestStopCode(timeline: readonly HostAdTimelineEvent[]): string | null {
  const rows = [...timeline]
    .filter((row) => ["pause", "end", "stop", "cancel"].includes(row.action))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  for (const row of rows) {
    const reason = row.provider_response?.reason;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }
  return null;
}

/**
 * The one true reason an ad stopped. Order: a deleted (cancelled) ad, then
 * the server's stored reason, then budget used (spend reached 98% of the
 * total), then a Host-made end. Running ads return null.
 */
export function hostAdTrueStopReason(input: {
  state: "running" | "paused" | "ended" | "review" | "other";
  deleted: boolean;
  code: string | null;
  spentCredit: number | null;
  capCredit: number;
  hostEnded: boolean;
}): HostAdStopReason | null {
  if (input.state === "running" || input.state === "review" || input.state === "other") return null;
  if (input.deleted) return "cancelled";
  const fromCode = hostAdReasonFromCode(input.code);
  if (fromCode) return fromCode;
  if (
    input.spentCredit !== null &&
    input.capCredit > 0 &&
    input.spentCredit >= Math.floor(input.capCredit * 0.98)
  ) {
    return "budgetUsed";
  }
  if (input.state === "ended" && input.hostEnded) return "youEnded";
  if (input.state === "paused" && input.hostEnded) return "youPaused";
  return null;
}

/** A pause the Host can lift themselves (Resume works). */
export function hostAdHostCanResume(reason: HostAdStopReason | null): boolean {
  return reason === null || reason === "youPaused";
}

// ── Goal and results ─────────────────────────────────────────────────────

/** The goal behind the counted result ("tickets", "rsvp_registrations"…). */
export function hostAdGoalFromResult(result: string | null | undefined): HostAdGoal {
  const value = (result ?? "").toLowerCase();
  if (/sign|lead|rsvp|regist|join/.test(value)) return "signups";
  if (/ticket|purchase|order|sale|book/.test(value)) return "sales";
  return "visits";
}

export type HostAdResults = {
  goal: HostAdGoal;
  /** What the Host paid for what was spent (pay terms). */
  spentPay: number;
  /** What reached the apps (credit terms). */
  spentCredit: number;
  count: number;
  /** Pay terms per result, rounded; null with no results. */
  eachPay: number | null;
  /** Ticket sales value in the brand's currency, when known. */
  salesValue: number | null;
  /** Sales ÷ pay spent, one decimal; null without both. */
  returnX: number | null;
};

/**
 * Results in pay terms. Counts come from Mingla (7-day tap window, one order
 * once): tickets for sales, sign-ups for sign-ups, 7-day clicks for visits.
 */
export function hostAdResults(input: {
  goal: HostAdGoal;
  spentCredit: number | null;
  tickets?: number | null;
  signUps?: number | null;
  clicks7d?: number | null;
  conversions?: number | null;
  salesValue?: number | null;
}): HostAdResults {
  const spentCredit = Math.max(0, Math.trunc(input.spentCredit ?? 0));
  const spentPay = hostAdPayFromCredit(spentCredit);
  const pick = (value: number | null | undefined): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  const count =
    input.goal === "sales"
      ? pick(input.tickets) ?? pick(input.conversions) ?? 0
      : input.goal === "signups"
        ? pick(input.signUps) ?? pick(input.conversions) ?? 0
        : pick(input.clicks7d) ?? 0;
  const salesValue = input.goal === "sales" ? pick(input.salesValue) : null;
  return {
    goal: input.goal,
    spentPay,
    spentCredit,
    count,
    eachPay: count > 0 && spentPay > 0 ? Math.round(spentPay / count) : null,
    salesValue,
    returnX:
      salesValue !== null && salesValue > 0 && spentPay > 0
        ? Math.round((salesValue / spentPay) * 10) / 10
        : null,
  };
}

// ── Budget card ──────────────────────────────────────────────────────────

/** The budget card: what the Host pays a day, and what is still held. */
export function hostAdBudgetCard(input: {
  dailyCredit: number;
  capCredit: number;
  spentCredit: number | null;
}): { dailyPay: number; dailyToAds: number; stillHeldPay: number; totalPay: number } {
  const daily = Math.max(0, Math.trunc(input.dailyCredit));
  const held = Math.max(0, Math.trunc(input.capCredit) - Math.max(0, Math.trunc(input.spentCredit ?? 0)));
  return {
    dailyPay: hostAdPayFromCredit(daily),
    dailyToAds: daily,
    stillHeldPay: hostAdPayFromCredit(held),
    totalPay: hostAdPayFromCredit(Math.max(0, Math.trunc(input.capCredit))),
  };
}

// ── Edit budget sheet ────────────────────────────────────────────────────

/** One step of the − / + buttons: 5% of the total, at least one major unit. */
export function hostAdEditStep(totalPay: number, minorPerMajor = 100): number {
  const raw = Math.max(minorPerMajor, Math.round(totalPay * 0.05));
  return Math.ceil(raw / minorPerMajor) * minorPerMajor;
}

export type HostAdEditMoney = {
  /** The new total in credit terms (what the server receives). */
  newCredit: number;
  stillHeldPay: number;
  heldAfterPay: number;
  /** > 0: more is set aside now; < 0: that much comes back (pay terms). */
  changePay: number;
  freePay: number;
  /** Pay terms the Host must add first; 0 when free credit covers it. */
  topUpPay: number;
  /** The lowest total the sheet allows (already spent + one step). */
  minimumPay: number;
  /** Over 20% during learning: the server asks for the restart confirm. */
  restartsLearning: boolean;
};

/**
 * Every figure on the edit sheet, in pay terms. The extra hold comes out of
 * free credit; when free credit is short, the top-up is the gap rounded up
 * to the step, never less than the gap.
 */
export function hostAdEditMoney(input: {
  newTotalPay: number;
  /** W6c: the new total in credit when the Host stepped the daily amount. */
  newCreditOverride?: number;
  capCredit: number;
  spentCredit: number | null;
  walletCredit: number | null;
  learning: boolean;
  step: number;
}): HostAdEditMoney {
  const cap = Math.max(0, Math.trunc(input.capCredit));
  const spent = Math.max(0, Math.trunc(input.spentCredit ?? 0));
  const newCredit =
    input.newCreditOverride !== undefined
      ? Math.max(0, Math.trunc(input.newCreditOverride))
      : hostAdCreditFromPay(Math.max(0, Math.trunc(input.newTotalPay)));
  const extraCredit = newCredit - cap;
  const freeCredit = Math.max(0, Math.trunc(input.walletCredit ?? 0));
  const shortCredit = Math.max(0, extraCredit - freeCredit);
  const shortPay = hostAdPayFromCredit(shortCredit);
  const step = Math.max(1, Math.trunc(input.step));
  const changePct = cap > 0 ? Math.abs(newCredit - cap) / cap : 0;
  return {
    newCredit,
    stillHeldPay: hostAdPayFromCredit(Math.max(0, cap - spent)),
    heldAfterPay: hostAdPayFromCredit(Math.max(0, newCredit - spent)),
    changePay:
      extraCredit === 0
        ? 0
        : extraCredit > 0
          ? hostAdPayFromCredit(extraCredit)
          : -hostAdPayFromCredit(-extraCredit),
    freePay: hostAdPayFromCredit(freeCredit),
    topUpPay: shortPay > 0 ? Math.ceil(shortPay / step) * step : 0,
    minimumPay: hostAdPayFromCredit(spent) + step,
    restartsLearning: input.learning && changePct > 0.2,
  };
}

/** "tiktok:790500" (credit a day) from the server → the app and its pay minimum. */
export function hostAdAppMinimumFromDetail(detail: string | null | undefined): {
  platform: string;
  dailyPay: number;
} | null {
  const [platform, cents] = (detail ?? "").split(":");
  const value = Number(cents);
  if (!platform || !Number.isSafeInteger(value) || value <= 0) return null;
  return { platform, dailyPay: hostAdPayFromCredit(value) };
}

// ── Ari's suggestion ─────────────────────────────────────────────────────

export type HostAdSuggestionMoneyIn = {
  current_total_pay_cents: number;
  new_total_pay_cents: number;
  change_pay_cents: number;
  change_fee_cents: number;
};

/**
 * The confirm sheet's money, straight from the server's suggestion (pay
 * terms; never recomputed here): pays now, pays after, the signed change and
 * the 15% fee inside a raise. A lower gives the change back (no fee line).
 */
export function hostAdSuggestionMoneyRows(money: HostAdSuggestionMoneyIn | null | undefined): {
  nowPay: number;
  afterPay: number;
  changePay: number;
  feePay: number;
  direction: "raise" | "lower" | "none";
} | null {
  if (!money) return null;
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
  if (!ok(money.current_total_pay_cents) || !ok(money.new_total_pay_cents) || !ok(money.change_pay_cents)) {
    return null;
  }
  const change = money.change_pay_cents;
  return {
    nowPay: money.current_total_pay_cents,
    afterPay: money.new_total_pay_cents,
    changePay: change,
    feePay: change > 0 && ok(money.change_fee_cents) ? Math.max(0, money.change_fee_cents) : 0,
    direction: change > 0 ? "raise" : change < 0 ? "lower" : "none",
  };
}

// ── Promote home credit card ─────────────────────────────────────────────

/**
 * The Ads credit card. The wallet balance is FREE credit (a launch moves the
 * budget out of it into a hold); held = what running and paused ads still
 * have set aside (their total minus what they spent). All in pay terms.
 */
export function hostAdCreditCard(input: {
  walletCredit: number | null;
  ads: readonly { ended: boolean; capCredit: number | null; spentCredit: number | null }[];
}): { totalPay: number; heldPay: number; freePay: number; toAdsCredit: number } {
  const freeCredit = Math.max(0, Math.trunc(input.walletCredit ?? 0));
  const heldCredit = input.ads.reduce((sum, ad) => {
    if (ad.ended || ad.capCredit === null) return sum;
    return sum + Math.max(0, Math.trunc(ad.capCredit) - Math.max(0, Math.trunc(ad.spentCredit ?? 0)));
  }, 0);
  const freePay = hostAdPayFromCredit(freeCredit);
  const heldPay = hostAdPayFromCredit(heldCredit);
  return { totalPay: freePay + heldPay, heldPay, freePay, toAdsCredit: freeCredit + heldCredit };
}

/**
 * Withdraw: the server's quote (refund_cents back to how the Host paid,
 * with fee_returned_cents of Mingla's fee inside it). The fee comes back on
 * a withdraw only; it never comes back when an ad spends.
 */
export function hostAdWithdrawLines(quote: {
  credit_cents: number;
  refund_cents: number;
  fee_returned_cents: number;
} | null): { backPay: number; feeBack: number; creditOut: number } | null {
  if (!quote) return null;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);
  return { backPay: n(quote.refund_cents), feeBack: n(quote.fee_returned_cents), creditOut: n(quote.credit_cents) };
}

// ── Roles ────────────────────────────────────────────────────────────────

export type HostAdRoleAction = "pause" | "end" | "change_live" | "top_up" | "withdraw" | "launch" | "plan";

/**
 * Why a button is off for this teammate: null when allowed. The server's
 * capabilities (W4b) win; the app's role check is the fallback.
 */
export function hostAdRoleBlock(input: {
  action: HostAdRoleAction;
  allowedByRole: boolean;
  capabilities?: Partial<Record<string, { allowed: boolean; ask_name?: string }>> | null;
}): { blocked: false } | { blocked: true; askName: string | null } {
  const answer = input.capabilities?.[input.action];
  const allowed = answer ? answer.allowed : input.allowedByRole;
  if (allowed) return { blocked: false };
  const name = typeof answer?.ask_name === "string" && answer.ask_name.trim() ? answer.ask_name.trim() : null;
  return { blocked: true, askName: name };
}

// ── Rejections (mirror of _shared/hostAdRejectionReasons.ts) ─────────────

export type HostAdRejectionClass =
  | "text_heavy"
  | "alcohol"
  | "personal_attributes"
  | "misleading"
  | "landing_page"
  | "low_quality"
  | "identity"
  | "prohibited";

const REJECTION_RULES: readonly { cls: HostAdRejectionClass; match: RegExp }[] = [
  { cls: "text_heavy", match: /too much text|text[ _-]?(heavy|overlay|in image)|20 ?% text|excessive text/i },
  { cls: "alcohol", match: /alcohol|liquor|beer|wine|spirits/i },
  { cls: "personal_attributes", match: /personal (attribute|health|characteristic)|implies? .*(age|race|religion|health)/i },
  { cls: "misleading", match: /mislead|deceptive|false claim|unrealistic|exaggerat|sensational|clickbait/i },
  { cls: "landing_page", match: /landing page|destination|non[ -]?functional|broken link|mismatch|url/i },
  { cls: "low_quality", match: /low[ -]?quality|blurry|pixelat|resolution|poor quality|image quality|video quality/i },
  { cls: "identity", match: /identity|permission|authori[sz]|trademark|copyright|intellectual property|impersonat/i },
  { cls: "prohibited", match: /prohibited|restricted|weapon|drug|tobacco|adult|sexual|violen|gambling/i },
];

function detailText(detail: unknown, depth = 0): string {
  if (depth > 3 || detail === null || detail === undefined) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => detailText(item, depth + 1)).join(" ");
  if (typeof detail === "object") {
    return Object.values(detail as Record<string, unknown>).map((item) => detailText(item, depth + 1)).join(" ");
  }
  return "";
}

/** The plain class of an app's review text, or null (show the general line). */
export function hostAdRejectionClass(detail: unknown): HostAdRejectionClass | null {
  const text = detailText(detail);
  if (!text) return null;
  return REJECTION_RULES.find((rule) => rule.match.test(text))?.cls ?? null;
}

const REJECTED = /DISAPPROVED|REJECT|NOT_APPROVED|DENIED/i;

export function hostAdCreativeRejected(row: { review_status?: string | null; status?: string | null }): boolean {
  return REJECTED.test(String(row.review_status ?? "")) || REJECTED.test(String(row.status ?? ""));
}

// ── Compare ──────────────────────────────────────────────────────────────

export type HostAdCompareRow = {
  id: string;
  name: string;
  goal: HostAdGoal;
  spentPay: number;
  count: number;
  eachPay: number | null;
};

/** Ads that spent, cheapest result first; the same counting on every ad. */
export function hostAdCompareRows(
  ads: readonly { id: string; name: string; result: string; spentCredit: number | null; count: number }[],
): HostAdCompareRow[] {
  return ads
    .filter((ad) => (ad.spentCredit ?? 0) > 0)
    .map((ad) => {
      const spentPay = hostAdPayFromCredit(Math.trunc(ad.spentCredit ?? 0));
      const count = Math.max(0, Math.trunc(ad.count));
      return {
        id: ad.id,
        name: ad.name,
        goal: hostAdGoalFromResult(ad.result),
        spentPay,
        count,
        eachPay: count > 0 ? Math.round(spentPay / count) : null,
      };
    })
    .sort((a, b) => (a.eachPay ?? Number.MAX_SAFE_INTEGER) - (b.eachPay ?? Number.MAX_SAFE_INTEGER));
}

/** "2026-11" for the statement of the month `iso` falls in (UTC, as the server reads it). */
export function hostAdStatementMonth(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Edit budget sheet, in the DAILY amount the Host pays (W6c) ───────────

/** The days a live ad's cap covers: cap ÷ daily, at least 1. */
export function hostAdRunDaysFromBudget(capCredit: number, dailyCredit: number): number {
  if (!(capCredit > 0) || !(dailyCredit > 0)) return 1;
  return Math.max(1, Math.round(capCredit / dailyCredit));
}

/**
 * The daily amount the sheet steps (pay terms, 15% fee inside) and every
 * number under it. The server still receives a TOTAL in credit: the new
 * daily pay goes through `hostAdPlanBudget` (the one pay→credit conversion)
 * for the run's days. An untouched daily amount sends nothing, so rounding
 * never edits a budget the Host did not change.
 */
export function hostAdEditDailyMoney(input: {
  dailyPay: number;
  startDailyPay: number;
  runDays: number;
  capCredit: number;
  spentCredit: number | null;
  walletCredit: number | null;
  learning: boolean;
  step: number;
}): HostAdEditMoney & { runTotalPay: number; dailyChanged: boolean } {
  const dailyChanged = input.dailyPay !== input.startDailyPay;
  const plan = hostAdPlanBudget({ dailyPayCents: input.dailyPay, runDays: input.runDays });
  const base = hostAdEditMoney({
    newTotalPay: 0,
    newCreditOverride: dailyChanged ? plan.capCreditCents : Math.max(0, Math.trunc(input.capCredit)),
    capCredit: input.capCredit,
    spentCredit: input.spentCredit,
    walletCredit: input.walletCredit,
    learning: input.learning,
    step: input.step,
  });
  return { ...base, runTotalPay: plan.holdPayCents, dailyChanged };
}

/**
 * The lowest daily amount the sheet lets the Host pick (pay terms): never
 * below the apps' one-ad-set minimum, never so low that the run's total
 * falls under what is already spent. Unknown minimum: one step.
 */
export function hostAdEditMinDailyPay(input: {
  appsMinimumDailyPay: number | null;
  spentCredit: number | null;
  runDays: number;
  step: number;
}): number {
  const spentPay = hostAdPayFromCredit(Math.max(0, Math.trunc(input.spentCredit ?? 0)));
  const bySpend = Math.ceil(spentPay / Math.max(1, input.runDays));
  const floor = input.appsMinimumDailyPay !== null && input.appsMinimumDailyPay > 0 ? input.appsMinimumDailyPay : input.step;
  return Math.max(floor, bySpend);
}

// ── An ad notice that belongs to another brand (W6c) ─────────────────────

export type HostAdBrandLinkDecision = "stay" | "wait" | "switch" | "notMember";

/**
 * A notice names its brand. Same brand (or no brand named): stay. Another
 * brand the person is on: switch to it, then open the ad. Another brand they
 * are not on: say so (never "Ad not found"). The list still loading: wait.
 */
export function hostAdBrandLinkDecision(input: {
  linkBrandId: string | null;
  currentBrandId: string | null;
  memberBrandIds: readonly string[];
  listStatus: "loading" | "ready" | "error";
}): HostAdBrandLinkDecision {
  if (!input.linkBrandId || input.linkBrandId === input.currentBrandId) return "stay";
  if (input.memberBrandIds.includes(input.linkBrandId)) return "switch";
  if (input.listStatus === "loading") return "wait";
  return input.listStatus === "ready" ? "notMember" : "stay";
}
