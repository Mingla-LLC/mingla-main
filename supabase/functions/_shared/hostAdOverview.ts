/**
 * #4238 — the Host ad Overview: "is my ad working?".
 *
 * Pure maths for the `overview` block on `host-ad-campaign` `get`: the
 * verdict against the plan's frozen guidance, the run length, pace per app,
 * the best video and the started-checkout count. The edge function only
 * loads the inputs; the phone, Android and web only display the result, so
 * they can never disagree.
 *
 * Amounts are credit (ad-money) minor units in the plan currency, the same
 * terms as `guidance_snapshot`. Pace maths per app runs in that app's
 * provider-account minor units, so currencies are never mixed. Missing data
 * is null (hidden), never 0 (Constitution #9).
 */

import { BAND_LOW } from "./adResultBenchmarks.ts";
import { CAP_PAUSE_RATIO } from "./adMoney.ts";
import { type CampaignSpendTarget, providerCapCents } from "./adSpendSync.ts";
import { HOST_AD_CLICK_WINDOW_MS } from "./hostAdAttribution.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export type HostAdOverviewGoal = "sales" | "signups" | "visits";
export type HostAdVerdictState = "too_early" | "on_track" | "behind" | "ahead";
export type HostAdDropOff =
  | "not_tapping"
  | "not_reaching_page"
  | "not_buying"
  | "not_finishing"
  | "too_dear";

export type HostAdVerdict = {
  state: HostAdVerdictState;
  drop_off: HostAdDropOff | null;
  cost_per_result_cents: number | null;
  expected_cost_per_result_cents: number;
};

/** The server's coarse phase: only review and rejected change the overview. */
export type HostAdOverviewPhase = "live" | "paused" | "ended" | "review" | "rejected";

export type HostAdFunnelTotals = {
  shown: number | null;
  taps: number | null;
  visits: number | null;
  checkout: number | null;
  bought: number | null;
};

function positiveInteger(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function toMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The goal the guidance was frozen for (visits when unknown). */
export function hostAdOverviewGoal(
  snapshot: Record<string, unknown> | null | undefined,
): HostAdOverviewGoal {
  return snapshot?.goal === "sales" || snapshot?.goal === "signups"
    ? snapshot.goal
    : "visits";
}

/**
 * The server-side phase from the plan state and its campaigns, mirroring the
 * Host screen's own rule (a rejected creative is decided on the client too).
 */
export function hostAdOverviewPhase(input: {
  planState: string | null;
  campaigns: { status?: unknown }[];
}): HostAdOverviewPhase {
  const state = String(input.planState ?? "").toLowerCase();
  const statuses = input.campaigns.map((row) =>
    String(row.status ?? "").toUpperCase()
  );
  if (
    ["deleted", "ended", "settling", "stop_requested", "settlement_attention_required"]
      .includes(state) ||
    (statuses.length > 0 &&
      statuses.every((status) => status === "ARCHIVED" || status === "DELETED"))
  ) {
    return "ended";
  }
  if (["paused", "pause_requested"].includes(state)) return "paused";
  if (state === "platform_rejected") return "rejected";
  if (!statuses.includes("ACTIVE") && /review|scheduled|pending|ready/.test(state)) {
    return "review";
  }
  return "live";
}

function dropOff(
  goal: HostAdOverviewGoal,
  f: HostAdFunnelTotals,
): HostAdDropOff {
  const { shown: I, taps: C, visits: V, checkout: K, bought: B } = f;
  if (I !== null && C !== null && I > 0 && C === 0) return "not_tapping";
  if (C !== null && V !== null && C > 0 && V === 0) return "not_reaching_page";
  if (goal === "sales") {
    if (V !== null && K !== null && V > 0 && K === 0) return "not_buying";
    if (K !== null && B !== null && K > 0 && B === 0) return "not_finishing";
  } else if (V !== null && B !== null && V > 0 && B === 0) {
    return "not_buying";
  }
  return "too_dear";
}

/**
 * AC 1: the verdict against the plan's own frozen guidance. Null (no card)
 * whenever the guidance or the spend is unknown: a verdict is never invented.
 */
export function hostAdVerdict(input: {
  snapshot: Record<string, unknown> | null | undefined;
  /** host_spend_equivalent_cents (credit terms); null on an FX failure. */
  spendCredit: number | null;
  /** Counted tickets (sales) or sign-ups (signups). */
  results: number;
  liveSinceMs: number | null;
  earliestStartMs: number | null;
  nowMs: number;
  phase: HostAdOverviewPhase;
  hasPlan: boolean;
  funnel: HostAdFunnelTotals;
}): HostAdVerdict | null {
  const snapshot = input.snapshot ?? null;
  if (!input.hasPlan || snapshot === null || snapshot.known !== true) return null;
  const mid = positiveInteger(snapshot.cost_per_result_cents);
  const high = positiveInteger(snapshot.cost_per_result_high_cents);
  if (mid === null || high === null) return null;
  const goal = hostAdOverviewGoal(snapshot);
  if (goal === "visits") return null;
  const S = input.spendCredit;
  if (S === null || !Number.isFinite(S) || S < 0) return null;
  if (input.phase === "review" || input.phase === "rejected") return null;
  const R = Math.max(0, Math.floor(Number(input.results) || 0));
  const base = { expected_cost_per_result_cents: mid };
  const liveSince = input.liveSinceMs ?? input.earliestStartMs;
  if (S === 0 || (liveSince !== null && input.nowMs - liveSince < DAY_MS)) {
    return { state: "too_early", drop_off: null, cost_per_result_cents: null, ...base };
  }
  let state: HostAdVerdictState;
  let cpr: number | null = null;
  if (R > 0) {
    cpr = S / R;
    state = cpr < mid * BAND_LOW ? "ahead" : cpr > high ? "behind" : "on_track";
  } else {
    state = S > high ? "behind" : "on_track";
  }
  return {
    state,
    drop_off: state === "behind" ? dropOff(goal, input.funnel) : null,
    cost_per_result_cents: cpr === null ? null : Math.round(cpr),
    ...base,
  };
}

/** AC 6: the planned run length in whole days; null when there is no end. */
export function hostAdRunDays(
  starts: readonly unknown[],
  ends: readonly unknown[],
): number | null {
  const s = starts.map(toMs).filter((v): v is number => v !== null);
  const e = ends.map(toMs).filter((v): v is number => v !== null);
  if (s.length === 0 || e.length === 0) return null;
  return Math.max(1, Math.round((Math.max(...e) - Math.min(...s)) / DAY_MS));
}

/**
 * AC 7: the stalest sync time across the apps still running or paused, so
 * "Updated" is never fresher than the truth. Null when none qualify.
 */
export function hostAdSyncedAt(
  campaigns: { status?: unknown; status_synced_at?: unknown }[],
): string | null {
  const times = campaigns
    .filter((row) => ["ACTIVE", "PAUSED"].includes(String(row.status ?? "").toUpperCase()))
    .map((row) => ({ raw: row.status_synced_at, ms: toMs(row.status_synced_at) }))
    .filter((row): row is { raw: string; ms: number } => row.ms !== null);
  if (times.length === 0) return null;
  times.sort((a, b) => a.ms - b.ms);
  return new Date(times[0].ms).toISOString();
}

export type HostAdPaceCampaign = CampaignSpendTarget & {
  starts_at?: string | null;
  status_synced_at?: string | null;
  auto_pause_reason?: string | null;
  /** This app's spend in its provider-account minor units. */
  provider_spend_cents: number;
  /** This app's spend in plan-currency credit; null when FX failed. */
  spent_credit_cents: number | null;
  page_visits: number;
};

export type HostAdPaceApp = {
  platform: string;
  campaign_id: string;
  spent_credit_cents: number | null;
  page_visits: number;
  cost_per_visit_credit_cents: number | null;
  state: "on_pace" | "ends_early" | "stopped";
  stops_at: string | null;
};

export type HostAdPace = {
  total_credit_cents: number;
  spent_credit_cents: number;
  even_share: number | null;
  apps: HostAdPaceApp[];
};

/** One app's pace state, from its own provider cap and spend rate. */
export function hostAdPaceState(
  row: HostAdPaceCampaign,
  nowMs: number,
): { state: HostAdPaceApp["state"]; stops_at: string | null } {
  const cap = providerCapCents(row);
  const spend = Math.max(0, Number(row.provider_spend_cents) || 0);
  const pauseAt = cap === null ? null : Math.floor(cap * CAP_PAUSE_RATIO);
  if (
    String(row.status ?? "").toUpperCase() !== "ACTIVE" ||
    (typeof row.auto_pause_reason === "string" && row.auto_pause_reason.length > 0) ||
    (pauseAt !== null && spend >= pauseAt)
  ) {
    return { state: "stopped", stops_at: null };
  }
  const startsMs = toMs(row.starts_at);
  const endsMs = toMs(row.ends_at);
  const asOf = toMs(row.status_synced_at) ?? nowMs;
  if (pauseAt === null || startsMs === null || endsMs === null || spend <= 0) {
    return { state: "on_pace", stops_at: null };
  }
  const elapsed = asOf - startsMs;
  if (elapsed < 12 * HOUR_MS) return { state: "on_pace", stops_at: null };
  const rate = spend / elapsed;
  const stopsAt = asOf + (pauseAt - spend) / rate;
  if (stopsAt < endsMs - HOUR_MS) {
    return { state: "ends_early", stops_at: new Date(Math.round(stopsAt)).toISOString() };
  }
  return { state: "on_pace", stops_at: null };
}

/** AC 4: pace for the plan and each app. Null when it can't be shown. */
export function hostAdPace(input: {
  phase: HostAdOverviewPhase;
  currency: string | null;
  totalCreditCents: number | null;
  spentCreditCents: number | null;
  nowMs: number;
  campaigns: HostAdPaceCampaign[];
}): HostAdPace | null {
  if (input.phase !== "live" && input.phase !== "paused") return null;
  if (!input.currency || !/^[A-Z]{3}$/.test(input.currency)) return null;
  const total = positiveInteger(input.totalCreditCents);
  const spent = input.spentCreditCents;
  if (total === null || spent === null || !Number.isSafeInteger(spent) || spent < 0) {
    return null;
  }
  const starts = input.campaigns.map((row) => toMs(row.starts_at))
    .filter((v): v is number => v !== null);
  const ends = input.campaigns.map((row) => toMs(row.ends_at))
    .filter((v): v is number => v !== null);
  let evenShare: number | null = null;
  if (starts.length > 0 && ends.length > 0) {
    const from = Math.min(...starts);
    const to = Math.max(...ends);
    evenShare = to > from
      ? Math.min(1, Math.max(0, (input.nowMs - from) / (to - from)))
      : null;
  }
  return {
    total_credit_cents: total,
    spent_credit_cents: spent,
    even_share: evenShare,
    apps: input.campaigns.map((row) => {
      const credit = row.spent_credit_cents;
      const visits = Math.max(0, Math.floor(Number(row.page_visits) || 0));
      return {
        platform: String(row.platform),
        campaign_id: String(row.id),
        spent_credit_cents: credit,
        page_visits: visits,
        cost_per_visit_credit_cents: credit !== null && credit > 0 && visits > 0
          ? Math.round(credit / visits)
          : null,
        ...hostAdPaceState(row, input.nowMs),
      };
    }),
  };
}

export type HostAdVideo = {
  creative_id: string;
  name: string;
  taps: number;
  spend_per_tap_credit_cents: number;
};

export type HostAdCreativeMetricRow = {
  creative_id: string | null;
  platform: string;
  spend_cents: number | null;
  link_clicks: number | null;
  currency: string | null;
};

/** Converts one app's provider-currency amount into plan-currency credit. */
export type HostAdOverviewConvert = (input: {
  amount: number;
  platform: string;
  source: string;
}) => Promise<number | null>;

/**
 * AC 5: the cheapest and dearest video per tap. Null unless 2 or more videos
 * have a tap, every conversion worked, and both have a real name.
 */
export async function hostAdBestVideo(input: {
  rows: HostAdCreativeMetricRow[];
  hostCurrency: string | null;
  convert: HostAdOverviewConvert;
  names: ReadonlyMap<string, string>;
}): Promise<{ best: HostAdVideo; worst: HostAdVideo } | null> {
  if (!input.hostCurrency) return null;
  const host = input.hostCurrency.toUpperCase();
  const groups = new Map<
    string,
    { creative_id: string; platform: string; spend: number; taps: number; currencies: Set<string> }
  >();
  for (const row of input.rows) {
    if (typeof row.creative_id !== "string" || row.creative_id.length === 0) continue;
    const key = `${row.creative_id}|${row.platform}`;
    const group = groups.get(key) ??
      { creative_id: row.creative_id, platform: row.platform, spend: 0, taps: 0, currencies: new Set<string>() };
    group.spend += Math.max(0, Number(row.spend_cents) || 0);
    group.taps += Math.max(0, Math.floor(Number(row.link_clicks) || 0));
    if (row.currency) group.currencies.add(String(row.currency).toUpperCase());
    groups.set(key, group);
  }
  const perCreative = new Map<string, { spend: number; taps: number }>();
  for (const group of groups.values()) {
    let credit: number | null;
    if (group.spend === 0) credit = 0;
    else if (group.currencies.size !== 1) credit = null;
    else {
      const source = [...group.currencies][0];
      credit = source === host
        ? group.spend
        : await input.convert({ amount: group.spend, platform: group.platform, source });
    }
    if (credit === null || !Number.isSafeInteger(credit) || credit < 0) return null;
    const current = perCreative.get(group.creative_id) ?? { spend: 0, taps: 0 };
    current.spend += credit;
    current.taps += group.taps;
    perCreative.set(group.creative_id, current);
  }
  const eligible = [...perCreative.entries()]
    .filter(([, value]) => value.taps >= 1)
    .map(([creative_id, value]) => ({
      creative_id,
      taps: value.taps,
      spend_per_tap_credit_cents: Math.round(value.spend / value.taps),
    }));
  if (eligible.length < 2) return null;
  const tieBreak = (
    a: { taps: number; creative_id: string },
    b: { taps: number; creative_id: string },
  ) => b.taps - a.taps || (a.creative_id < b.creative_id ? -1 : a.creative_id > b.creative_id ? 1 : 0);
  const best = [...eligible].sort((a, b) =>
    a.spend_per_tap_credit_cents - b.spend_per_tap_credit_cents || tieBreak(a, b)
  )[0];
  const worst = [...eligible].sort((a, b) =>
    b.spend_per_tap_credit_cents - a.spend_per_tap_credit_cents || tieBreak(a, b)
  )[0];
  if (best.creative_id === worst.creative_id) return null;
  if (best.spend_per_tap_credit_cents === worst.spend_per_tap_credit_cents) return null;
  const bestName = input.names.get(best.creative_id);
  const worstName = input.names.get(worst.creative_id);
  if (!bestName || !worstName) return null;
  return {
    best: { ...best, name: bestName },
    worst: { ...worst, name: worstName },
  };
}

/**
 * AC 2/3: how many ad-tap visits (click ids) started checkout within 7 days
 * of the tap, unioned with the taps behind counted purchases (every buyer
 * started checkout). Never below `bought`.
 */
export function hostAdCheckoutStartedCount(input: {
  touches: { id: string; click_id: string | null; created_at: string | null }[];
  sessions: { attribution_click_id: string | null; created_at: string | null }[];
  purchaseTouchIds: readonly string[];
  bought: number;
}): number {
  const touchByClick = new Map<string, number[]>();
  const clickByTouch = new Map<string, string>();
  for (const touch of input.touches) {
    if (!touch.click_id) continue;
    clickByTouch.set(touch.id, touch.click_id);
    const ms = toMs(touch.created_at);
    if (ms === null) continue;
    const list = touchByClick.get(touch.click_id) ?? [];
    list.push(ms);
    touchByClick.set(touch.click_id, list);
  }
  const started = new Set<string>();
  for (const session of input.sessions) {
    if (!session.attribution_click_id) continue;
    const sessionMs = toMs(session.created_at);
    const tapTimes = touchByClick.get(session.attribution_click_id);
    if (sessionMs === null || !tapTimes) continue;
    if (tapTimes.some((tap) => sessionMs >= tap && sessionMs <= tap + HOST_AD_CLICK_WINDOW_MS)) {
      started.add(session.attribution_click_id);
    }
  }
  for (const touchId of input.purchaseTouchIds) {
    started.add(clickByTouch.get(touchId) ?? `touch:${touchId}`);
  }
  return Math.max(started.size, Math.max(0, Math.floor(Number(input.bought) || 0)));
}

/** A read of one page of rows: `{ data, error }` like supabase-js. */
export type HostAdPagedRead<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: unknown }>;

/** Reads every page (1000 rows each) so PostgREST's row cap never truncates. */
export async function hostAdReadAllPages<T>(
  read: HostAdPagedRead<T>,
  pageSize = 1000,
): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0;; from += pageSize) {
    const { data, error } = await read(from, from + pageSize - 1);
    if (error || !Array.isArray(data)) return null;
    out.push(...data);
    if (data.length < pageSize) return out;
  }
}

/**
 * Loads the started-checkout count for a plan's campaigns. Any read error
 * gives null (the step and tile hide).
 */
export async function loadHostAdCheckoutStarted(
  // deno-lint-ignore no-explicit-any
  db: any,
  input: { campaignIds: string[]; purchaseTouchIds: readonly string[]; bought: number },
): Promise<number | null> {
  if (input.campaignIds.length === 0) return null;
  const touches = await hostAdReadAllPages<
    { id: string; click_id: string | null; created_at: string | null }
  >((from, to) =>
    db.from("ad_attribution_touches").select("id, click_id, created_at")
      .in("campaign_id", input.campaignIds).order("id").range(from, to)
  );
  if (touches === null) return null;
  const clickIds = [
    ...new Set(touches.flatMap((row) => typeof row.click_id === "string" && row.click_id ? [row.click_id] : [])),
  ];
  const sessions: { attribution_click_id: string | null; created_at: string | null }[] = [];
  for (let i = 0; i < clickIds.length; i += 200) {
    const chunk = clickIds.slice(i, i + 200);
    const rows = await hostAdReadAllPages<
      { attribution_click_id: string | null; created_at: string | null }
    >((from, to) =>
      db.from("ticket_checkout_sessions").select("attribution_click_id, created_at")
        .in("attribution_click_id", chunk).order("created_at").range(from, to)
    );
    if (rows === null) return null;
    sessions.push(...rows);
  }
  return hostAdCheckoutStartedCount({
    touches,
    sessions,
    purchaseTouchIds: input.purchaseTouchIds,
    bought: input.bought,
  });
}
