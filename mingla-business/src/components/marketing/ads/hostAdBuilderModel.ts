/**
 * #4238 W6a — the Promote builder's money and gating rules, pure (no React,
 * no network) so every number the Host sees is unit-tested.
 *
 * ONE unit on screen: what the Host PAYS, with the 15% Mingla fee inside.
 * The server keeps every budget in Ads credit (what the apps spend), so:
 *   - amounts the server returns in pay terms (`*_pay_cents`, guidance) are
 *     shown as they are;
 *   - amounts the Host picks (the slider) are pay terms and are converted to
 *     credit with `hostAdCreditFromPay` before `host_delivery_budget_cents`;
 *   - the wallet balance (credit) is shown as `hostAdPayFromCredit`.
 * HOST_AD_FEE_RATIO mirrors `HOST_FEE_RATIO` in
 * supabase/functions/_shared/adMoney.ts (parity test
 * issue_4238_w6a_builder_money.implementor.test.ts reads both files).
 */

export const HOST_AD_FEE_RATIO = 0.15;

export type HostAdGoal = "sales" | "signups" | "visits";
export type HostAdPlatformId = "meta" | "tiktok" | "snapchat" | "google" | "reddit";

/** The five apps in the order the builder lists them (design v9). */
export const HOST_AD_BUILDER_APPS: readonly HostAdPlatformId[] = [
  "meta",
  "tiktok",
  "google",
  "snapchat",
  "reddit",
];

/** Apps that take a photo as the ad (W4a: Meta and Snapchat). */
export const HOST_AD_PHOTO_APPS: readonly HostAdPlatformId[] = ["meta", "snapchat"];

/** Credit that reaches the apps from a payment (mirror of creditCentsFromPay). */
export function hostAdCreditFromPay(payCents: number): number {
  if (!Number.isInteger(payCents) || payCents <= 0) return 0;
  return Math.floor(payCents * (1 - HOST_AD_FEE_RATIO));
}

/** What the Host pays for a credit amount (mirror of hostMinimumPayCents). */
export function hostAdPayFromCredit(creditCents: number): number {
  if (!Number.isSafeInteger(creditCents) || creditCents <= 0) return 0;
  const keep = Math.round((1 - HOST_AD_FEE_RATIO) * 10_000);
  return Math.ceil((creditCents * 10_000) / keep);
}

/** The Mingla fee inside a payment. */
export function hostAdFeeOfPay(payCents: number): number {
  return payCents > 0 ? payCents - hostAdCreditFromPay(payCents) : 0;
}

export type HostAdMinimumRow = {
  platform: string;
  visits_daily_minimum_cents?: number;
  sales_daily_minimum_cents?: number;
  signups_daily_minimum_cents?: number;
  visits_daily_minimum_pay_cents?: number;
  sales_daily_minimum_pay_cents?: number;
  signups_daily_minimum_pay_cents?: number;
};

/**
 * The minimum the Host sees for one app and goal: the server's pay figure
 * (`<goal>_daily_minimum_pay_cents`), never the credit figure. Older servers
 * without the pay field get the same gross-up locally. Null = unknown (no
 * rate to the brand's money); the builder never guesses one.
 */
export function hostAdMinimumPayCents(
  rows: readonly HostAdMinimumRow[] | undefined,
  platform: string,
  goal: HostAdGoal,
): number | null {
  const row = (rows ?? []).find((item) => item.platform === platform);
  if (!row) return null;
  const pay = row[`${goal}_daily_minimum_pay_cents`];
  if (typeof pay === "number" && Number.isSafeInteger(pay) && pay > 0) return pay;
  const credit = row[`${goal}_daily_minimum_cents`];
  return typeof credit === "number" && credit > 0 ? hostAdPayFromCredit(credit) : null;
}

/** Same, in credit terms (what the split and the server check compare). */
export function hostAdMinimumCreditCents(
  rows: readonly HostAdMinimumRow[] | undefined,
  platform: string,
  goal: HostAdGoal,
): number | null {
  const row = (rows ?? []).find((item) => item.platform === platform);
  const credit = row?.[`${goal}_daily_minimum_cents`];
  return typeof credit === "number" && credit > 0 ? credit : null;
}

/** Whole major units, rounded up (the plain "top up" amount). */
export function hostAdCeilMajor(cents: number): number {
  if (cents <= 0) return 0;
  return Math.ceil(cents / 100) * 100;
}

/**
 * The top-up a launch needs: the plain difference between what the launch
 * holds and the credit there is, both in pay terms, rounded up to a whole
 * unit. 0 when the credit covers it.
 */
export function hostAdTopUpNeededCents(holdPayCents: number, walletCreditCents: number): number {
  const have = hostAdPayFromCredit(Math.max(0, walletCreditCents));
  return hostAdCeilMajor(Math.max(0, holdPayCents - have));
}

/**
 * What the launch holds, in pay terms: the daily pay × the days in the run
 * (total mode is entered as a daily amount to the end date).
 */
export function hostAdHoldPayCents(dailyPayCents: number, days: number | null): number {
  if (dailyPayCents <= 0) return 0;
  return dailyPayCents * Math.max(1, days ?? 1);
}

/** A slider step that keeps the number round in any currency. */
export function hostAdSliderStep(maxCents: number): number {
  const raw = Math.max(100, maxCents / 200);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].map((m) => m * magnitude).find((v) => v >= raw) ?? raw;
  return Math.max(100, Math.round(unit / 100) * 100);
}

/**
 * The slider's range: from half the smallest working amount (so "below every
 * minimum" can be reached and explained) to well past the recommendation.
 */
export function hostAdSliderRange(input: {
  minimumPayCents: number | null;
  recommendedPayCents: number | null;
}): { min: number; max: number; step: number } {
  const minimum = input.minimumPayCents && input.minimumPayCents > 0 ? input.minimumPayCents : 100_00;
  const recommended = Math.max(minimum, input.recommendedPayCents ?? 0);
  const max = Math.max(minimum * 20, recommended * 3);
  const step = hostAdSliderStep(max);
  const min = Math.max(step, Math.floor(minimum / 2 / step) * step);
  return { min, max: Math.ceil(max / step) * step, step };
}

/** Snap a dragged value to the step and range. */
export function hostAdSnap(value: number, range: { min: number; max: number; step: number }): number {
  const clamped = Math.min(range.max, Math.max(range.min, value));
  return Math.round(clamped / range.step) * range.step;
}

/**
 * The marks the slider crosses (a light haptic on each). Returns the mark
 * crossed between two values, or null.
 */
export function hostAdMarkCrossed(
  previous: number,
  next: number,
  marks: readonly number[],
): number | null {
  const lo = Math.min(previous, next);
  const hi = Math.max(previous, next);
  return marks.find((mark) => mark > lo && mark <= hi) ?? null;
}

export type HostAdCheckRow = {
  platform: string;
  state: "checking" | "ready" | "question" | "failed";
};

/**
 * Why Launch is off, in the order the Host must fix things. The first one is
 * pinned above the Launch button; `null` = Launch is on.
 */
export type HostAdLaunchBlocker =
  | { kind: "offline" }
  | { kind: "no_launch_access"; askName: string | null }
  | { kind: "no_fund_access"; askName: string | null }
  | { kind: "checking" }
  | { kind: "not_checked" }
  | { kind: "question"; platform: string }
  | { kind: "failed"; platform: string }
  | { kind: "rights" }
  | { kind: "top_up"; amountCents: number };

export function hostAdLaunchBlocker(input: {
  offline: boolean;
  canLaunch: boolean;
  canFund: boolean;
  askName: string | null;
  checks: readonly HostAdCheckRow[];
  checked: boolean;
  rightsConfirmed: boolean;
  topUpNeededCents: number;
}): HostAdLaunchBlocker | null {
  if (input.offline) return { kind: "offline" };
  if (!input.canLaunch) return { kind: "no_launch_access", askName: input.askName };
  if (!input.canFund) return { kind: "no_fund_access", askName: input.askName };
  if (input.checks.some((row) => row.state === "checking")) return { kind: "checking" };
  const question = input.checks.find((row) => row.state === "question");
  if (question) return { kind: "question", platform: question.platform };
  const failed = input.checks.find((row) => row.state === "failed");
  if (failed) return { kind: "failed", platform: failed.platform };
  if (!input.checked || input.checks.length === 0) return { kind: "not_checked" };
  if (!input.rightsConfirmed) return { kind: "rights" };
  if (input.topUpNeededCents > 0) return { kind: "top_up", amountCents: input.topUpNeededCents };
  return null;
}

/** The six builder steps (design v9). */
export const HOST_AD_BUILDER_STEPS = [
  "pick",
  "audience",
  "platforms",
  "budget",
  "creative",
  "review",
] as const;
export type HostAdBuilderStep = (typeof HOST_AD_BUILDER_STEPS)[number];

/** Old saved drafts used five step ids; map them onto the six. */
export function hostAdBuilderStepId(value: string | null | undefined): HostAdBuilderStep | null {
  if (value === "promote") return "pick";
  return (HOST_AD_BUILDER_STEPS as readonly string[]).includes(value ?? "")
    ? (value as HostAdBuilderStep)
    : null;
}

/** 1–5 creatives; photos only where every chosen app takes one. */
export function hostAdCreativeProblem(input: {
  picked: readonly { kind: "video" | "image" }[];
  apps: readonly string[];
}): { kind: "none" } | { kind: "too_many" } | { kind: "photo_app"; platform: string } | null {
  if (input.picked.length === 0) return { kind: "none" };
  if (input.picked.length > 5) return { kind: "too_many" };
  if (input.picked.some((item) => item.kind === "image")) {
    const videoOnly = input.apps.find(
      (app) => !(HOST_AD_PHOTO_APPS as readonly string[]).includes(app),
    );
    if (videoOnly) return { kind: "photo_app", platform: videoOnly };
  }
  return null;
}

/** Expected results a week, as the low/high the server returned. */
export function hostAdWeekRange(week: { low: number; high: number } | null | undefined): {
  low: number;
  high: number;
} | null {
  if (!week || !Number.isFinite(week.low) || !Number.isFinite(week.high)) return null;
  const low = Math.max(0, Math.floor(week.low));
  const high = Math.max(low, Math.floor(week.high));
  return high > 0 ? { low, high } : null;
}
