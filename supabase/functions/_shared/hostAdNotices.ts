/**
 * #4238 W4b (amendment B §1): Host ad notices on the existing Host rail.
 *
 * Pure deciders turn what a sweep or a Host action saw into notices; one
 * sender fans each notice out to the right brand roles through
 * notify-dispatch's legacy `type` path (in-app + push, per-type opt-outs,
 * quiet hours with an outbox retry). That rail has no email channel, so ad
 * notices are push + in-app only (decision 3).
 *
 * Once per recipient: every notice carries a stable idempotency key and the
 * sender suffixes it with the recipient id, so notify-dispatch's
 * notifications.idempotency_key check collapses repeat sweeps to one row.
 *
 * Copy is rendered here, in each recipient's profiles.preferred_language
 * (hostAdNoticeCopy.ts, 29 locales). Raw platform review text never goes in
 * a title or body; it is only kept, escaped, under data.details.
 *
 * Host lane only: callers pass Host plans (owner_kind = 'host').
 */

import {
  HOST_AD_NOTICE_COPY_KEYS,
  type HostAdNoticeCopyKey,
  hostAdNoticeLocale,
  hostAdNoticeText,
} from "./hostAdNoticeCopy.ts";
import { classifyHostAdRejection } from "./hostAdRejectionReasons.ts";
import { AD_CREDIT_TOP_UP_LIMITS_CENTS, HOST_FEE_RATIO } from "./adMoney.ts";
import { countedByMingla } from "./hostAdAttribution.ts";

export const HOST_AD_NOTICE_TYPES = [
  "business.ad_live",
  "business.ad_rejected",
  "business.ad_part_rejected",
  "business.ad_paused",
  "business.ad_credit_low",
  "business.ad_ended",
  "business.ad_slow_sales",
  "business.ad_creative_tired",
  "business.ad_last_tickets",
] as const;

export type HostAdNoticeType = typeof HOST_AD_NOTICE_TYPES[number];

/** N: the people who run ads. M: the people who can top up. */
export const HOST_AD_NOTICE_ROLES = {
  ads: ["brand_owner", "brand_admin", "marketing_manager"],
  money: ["brand_owner", "brand_admin", "finance_manager"],
} as const;

export type HostAdNoticeAudience = keyof typeof HOST_AD_NOTICE_ROLES;

export type HostAdNotice = {
  type: HostAdNoticeType;
  brandId: string;
  planId: string | null;
  idempotencyKey: string;
  audience: HostAdNoticeAudience;
  titleKey: HostAdNoticeCopyKey;
  /** Joined with a space, in order (e.g. reason, fix, suffix). */
  bodyKeys: HostAdNoticeCopyKey[];
  params: Record<string, string | number>;
  /** The plan's creator also receives it while still on the team. */
  creatorId?: string | null;
  /** The person who acted never gets their own notice. */
  actorId?: string | null;
  details?: Record<string, unknown>;
};

export type HostAdPlanRef = {
  planId: string;
  brandId: string;
  versionId?: string | null;
  creatorId?: string | null;
  eventTitle?: string | null;
};

const APP_NAMES: Record<string, string> = {
  meta: "Instagram and Facebook",
  snapchat: "Snapchat",
  tiktok: "TikTok",
  google: "Google",
  reddit: "Reddit",
};

export function hostAdAppName(platform: unknown): string {
  const key = typeof platform === "string" ? platform : "";
  return APP_NAMES[key] ?? "The app";
}

function eventName(plan: HostAdPlanRef): string {
  const title = typeof plan.eventTitle === "string"
    ? plan.eventTitle.trim()
    : "";
  return title || "Your event";
}

/** Plain text only: tags and control characters removed, length capped. */
export function escapeDetail(text: unknown): string {
  return String(text ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** A short, stable hash of a set of ids (FNV-1a, order-independent). */
export function idSetHash(ids: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const char of [...new Set(ids)].sort().join(",")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ── Review: live, rejected, part rejected ────────────────────────────────

export type HostAdReviewRow = {
  id: string;
  platform: string;
  review_status?: unknown;
  status?: unknown;
  review_detail?: unknown;
};

const REJECTED = /DISAPPROVED|REJECT|NOT_APPROVED|DENIED/i;
const APPROVED = /^(ACTIVE|APPROVED|ENABLED)$/i;
const IN_REVIEW = /PENDING|IN_PROCESS|REVIEW|PROCESSING/i;

function reviewState(
  row: HostAdReviewRow,
): "rejected" | "approved" | "review" | "other" {
  const review = String(row.review_status ?? "").trim();
  if (REJECTED.test(review)) return "rejected";
  if (APPROVED.test(review) || APPROVED.test(String(row.status ?? "").trim())) {
    return "approved";
  }
  if (IN_REVIEW.test(review)) return "review";
  return "other";
}

export function decideReviewNotices(input: {
  plan: HostAdPlanRef;
  ads: readonly HostAdReviewRow[];
}): HostAdNotice[] {
  const { plan, ads } = input;
  const notices: HostAdNotice[] = [];
  const rejected = ads.filter((row) => reviewState(row) === "rejected");
  const approved = ads.filter((row) => reviewState(row) === "approved");
  const inReview = ads.filter((row) => reviewState(row) === "review");
  const base = {
    brandId: plan.brandId,
    planId: plan.planId,
    audience: "ads" as const,
    creatorId: plan.creatorId ?? null,
  };
  if (approved.length > 0) {
    notices.push({
      ...base,
      type: "business.ad_live",
      idempotencyKey: `ad:${plan.planId}:live`,
      titleKey: "live_title",
      bodyKeys: ["live_body"],
      params: {
        event: eventName(plan),
        app: hostAdAppName(approved[0].platform),
      },
    });
  }
  if (rejected.length === 0) return notices;
  // The app with the most rejections names the notice; one notice per plan
  // however many ads were refused.
  const byApp = new Map<string, number>();
  for (const row of rejected) {
    byApp.set(row.platform, (byApp.get(row.platform) ?? 0) + 1);
  }
  const app = [...byApp.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const reason = rejected
    .map((row) => classifyHostAdRejection(row.review_detail))
    .find((entry) => entry !== null) ?? null;
  const partial = approved.length > 0 || inReview.length > 0;
  const params = {
    app: hostAdAppName(app),
    n: rejected.length,
    event: eventName(plan),
  };
  const bodyKeys: HostAdNoticeCopyKey[] = reason
    ? [
      reason.reason_key as HostAdNoticeCopyKey,
      reason.fix_key as HostAdNoticeCopyKey,
    ]
    : ["review_fallback"];
  if (partial && reason) bodyKeys.push("part_suffix");
  const details = {
    app: hostAdAppName(app),
    reason_class: reason?.cls ?? null,
    platform_text: rejected.slice(0, 5).map((row) => ({
      platform: row.platform,
      text: escapeDetail(
        typeof row.review_detail === "string"
          ? row.review_detail
          : JSON.stringify(row.review_detail ?? ""),
      ),
    })),
  };
  notices.push(
    partial
      ? {
        ...base,
        type: "business.ad_part_rejected",
        idempotencyKey: `ad:${plan.planId}:part:${
          idSetHash(rejected.map((row) => row.id))
        }`,
        titleKey: "part_rejected_title",
        bodyKeys,
        params,
        details,
      }
      : {
        ...base,
        type: "business.ad_rejected",
        idempotencyKey: `ad:${plan.planId}:rejected:${
          plan.versionId ?? "current"
        }`,
        titleKey: rejected.length > 1
          ? "part_rejected_title"
          : "rejected_title",
        bodyKeys,
        params,
        details,
      },
  );
  return notices;
}

// ── Pause ─────────────────────────────────────────────────────────────────

export type HostAdPauseClass =
  | "sold_out"
  | "credit_out"
  | "host_paused"
  | "event_ended"
  | "destination_not_public"
  | "spend_unreadable"
  | "unknown";

/** The stored pause reason (ad_status_events.provider_response.reason). */
export function hostAdPauseClass(reason: unknown): HostAdPauseClass {
  const value = typeof reason === "string" ? reason.trim() : "";
  if (value === "sold_out") return "sold_out";
  if (value === "cap_98_percent" || value === "credit_out") return "credit_out";
  if (value === "host_paused") return "host_paused";
  if (value === "event_ended" || value === "end_date_passed") {
    return "event_ended";
  }
  if (
    value === "destination_not_public" || value === "not_on_sale" ||
    value === "bookings_closed" || value === "destination_unavailable"
  ) return "destination_not_public";
  if (
    value === "spend_fetch_failed" ||
    value === "provider_currency_unresolved" ||
    value === "provider_cap_unresolved" || value === "destination_check_failed"
  ) return "spend_unreadable";
  return "unknown";
}

const PAUSE_BODY: Record<HostAdPauseClass, HostAdNoticeCopyKey> = {
  sold_out: "paused_sold_out",
  credit_out: "paused_credit_out",
  host_paused: "paused_host",
  event_ended: "paused_event_ended",
  destination_not_public: "paused_destination",
  spend_unreadable: "paused_safety",
  unknown: "paused_generic",
};

export function decidePauseNotice(input: {
  plan: HostAdPlanRef;
  reason: unknown;
  /** ad_status_events id, or another stable id for this one pause. */
  pauseRef: string;
  actorId?: string | null;
  actorName?: string | null;
}): HostAdNotice {
  const cls = hostAdPauseClass(input.reason);
  return {
    type: "business.ad_paused",
    brandId: input.plan.brandId,
    planId: input.plan.planId,
    idempotencyKey: `ad:${input.plan.planId}:paused:${input.pauseRef}`,
    audience: "ads",
    creatorId: input.plan.creatorId ?? null,
    actorId: input.actorId ?? null,
    titleKey: "paused_title",
    bodyKeys: [PAUSE_BODY[cls]],
    params: {
      event: eventName(input.plan),
      name: escapeDetail(input.actorName) || "A teammate",
    },
    details: { reason_class: cls },
  };
}

// ── Credit low ──────────────────────────────────────────────────────────────

export const CREDIT_LOW_RUNWAY_DAYS = 2;
const TOP_UP_STEP_CENTS: Record<string, number> = { NGN: 50_000 };
const DAY_MS = 86_400_000;

/**
 * #4238 W4c (conductor decision on the W4b review): Host ads are paid upfront
 * from held funds, so a low free balance never stops a running ad. The
 * warning is per running ad: it fires when the ad's REMAINING HELD budget
 * (cap − spent, the app's money) will run out MORE than 2 days before its
 * end date at the current rate (trailing 3-day average spend, else the
 * planned daily), AND the free Ads credit can't extend it to the end date.
 * The notice says the date it will stop and the top-up that keeps it running
 * to the end date, in pay terms (÷ (1 − fee), the 15% fee included), rounded
 * UP to the currency step and never below the minimum top-up. Keyed per ad
 * and latest top-up, so it fires again only after a new top-up.
 *
 * MINGLA-INVARIANT: I-4238-CREDIT-LOW-HELD-RUNWAY | issue #4238 | decideCreditLowNotice fires only when a running Host ad's remaining held budget runs out more than 2 days before ends_at and the free Ads credit (converted at the ad's own host/provider rate) is less than what reaching ends_at needs; the top-up is (need − free) ÷ (1 − HOST_FEE_RATIO), stepped up, at least the minimum top-up.
 */
export function decideCreditLowNotice(input: {
  brandId: string;
  planId: string | null;
  campaignId: string;
  /** The Host's money (the wallet's currency). */
  currency: string;
  /** Held budget left on the app: cap − spent, in the app's money. */
  remainingProviderCents: number;
  /** Daily spend, app money, newest last; only the last 3 are read. */
  dailySpendCents: readonly number[];
  /** The planned daily (app money) when there are fewer than 3 days. */
  plannedDailyCents: number;
  /** Host cents per app cent (the ad's own frozen rate). */
  hostPerProvider: number;
  endsAtMs: number;
  nowMs: number;
  /** Free (unheld) Ads credit, the Host's money. */
  freeCreditCents: number;
  latestTopUpLedgerId: string | null;
  minTopUpPayCents: number;
  formatMoney: (cents: number, currency: string) => string;
}): HostAdNotice | null {
  const lastThree = input.dailySpendCents.slice(-3).filter((value) =>
    Number.isFinite(value) && value >= 0
  );
  const daily = lastThree.length >= 3
    ? lastThree.reduce((sum, value) => sum + value, 0) / lastThree.length
    : input.plannedDailyCents;
  if (!Number.isFinite(daily) || daily <= 0) return null;
  const remaining = input.remainingProviderCents;
  if (!Number.isFinite(remaining)) return null;
  if (!Number.isFinite(input.endsAtMs) || !Number.isFinite(input.nowMs)) {
    return null;
  }
  if (!(input.hostPerProvider > 0) || !Number.isFinite(input.hostPerProvider)) {
    return null;
  }
  if (input.endsAtMs <= input.nowMs) return null;
  const runOutMs = input.nowMs + (Math.max(0, remaining) / daily) * DAY_MS;
  // Runs out at most 2 days early (or not at all): no warning.
  if (input.endsAtMs - runOutMs <= CREDIT_LOW_RUNWAY_DAYS * DAY_MS) return null;
  const daysToEnd = (input.endsAtMs - input.nowMs) / DAY_MS;
  const needProvider = Math.ceil(daily * daysToEnd - Math.max(0, remaining));
  if (needProvider <= 0) return null;
  const needHost = Math.ceil(needProvider * input.hostPerProvider);
  const free = Number.isFinite(input.freeCreditCents)
    ? Math.max(0, input.freeCreditCents)
    : 0;
  // Free Ads credit can extend it to the end date: no warning.
  if (free >= needHost) return null;
  const currency = input.currency.trim().toUpperCase();
  const step = TOP_UP_STEP_CENTS[currency] ?? 100;
  const needPay = Math.ceil((needHost - free) / (1 - HOST_FEE_RATIO));
  const suggested = Math.max(
    input.minTopUpPayCents,
    Math.ceil(needPay / step) * step,
  );
  const stopDate = new Date(runOutMs).toISOString().slice(0, 10);
  return {
    type: "business.ad_credit_low",
    brandId: input.brandId,
    planId: input.planId,
    idempotencyKey: `ad:${input.campaignId}:credit_low:${
      input.latestTopUpLedgerId ?? "none"
    }`,
    audience: "money",
    titleKey: "credit_low_title",
    bodyKeys: ["credit_low_body"],
    params: {
      date: stopDate,
      amount: input.formatMoney(suggested, currency),
    },
    details: {
      campaign_id: input.campaignId,
      stops_on: stopDate,
      ends_at: new Date(input.endsAtMs).toISOString(),
      daily_spend_cents: Math.round(daily),
      remaining_provider_cents: Math.max(0, Math.round(remaining)),
      need_host_cents: needHost,
      free_credit_cents: free,
      suggested_top_up_pay_cents: suggested,
      currency,
    },
  };
}

// ── Ended ─────────────────────────────────────────────────────────────────

/**
 * Only once the plan's funding hold is settled (the drain ran and its ledger
 * row, if any, exists). The amount back is the ledger's actual return; it is
 * never estimated.
 */
export function decideEndedNotice(input: {
  plan: HostAdPlanRef;
  hold: { state: unknown; amount_cents: unknown; currency: unknown } | null;
  release: { amount_cents: unknown; final_host_spend_cents?: unknown } | null;
  results: number;
  formatMoney: (cents: number, currency: string) => string;
}): HostAdNotice | null {
  if (!input.hold || input.hold.state !== "settled") return null;
  const currency = String(input.hold.currency ?? "").trim().toUpperCase();
  const held = Math.max(0, Math.floor(Number(input.hold.amount_cents) || 0));
  const returned = input.release
    ? Math.max(0, Math.floor(Number(input.release.amount_cents) || 0))
    : 0;
  const spentRaw = Number(input.release?.final_host_spend_cents);
  const spent = Number.isFinite(spentRaw) && spentRaw >= 0
    ? Math.floor(spentRaw)
    : Math.max(0, held - returned);
  return {
    type: "business.ad_ended",
    brandId: input.plan.brandId,
    planId: input.plan.planId,
    idempotencyKey: `ad:${input.plan.planId}:ended`,
    audience: "ads",
    creatorId: input.plan.creatorId ?? null,
    titleKey: "ended_title",
    bodyKeys: [returned > 0 ? "ended_returned" : "ended_nothing"],
    params: {
      spend: input.formatMoney(spent, currency),
      results: Math.max(0, Math.floor(input.results)),
      amount: input.formatMoney(returned, currency),
    },
    details: {
      spend_cents: spent,
      returned_cents: returned,
      results: input.results,
      currency,
    },
  };
}

// ── Signals: slow sales, tired creative, last tickets ────────────────────

const SIGNALS: Record<string, {
  type: HostAdNoticeType;
  title: HostAdNoticeCopyKey;
  body: HostAdNoticeCopyKey;
}> = {
  slow_sales_nudge: {
    type: "business.ad_slow_sales",
    title: "slow_title",
    body: "slow_body",
  },
  creative_fatigue: {
    type: "business.ad_creative_tired",
    title: "tired_title",
    body: "tired_body",
  },
  low_stock_copy: {
    type: "business.ad_last_tickets",
    title: "last_title",
    body: "last_body",
  },
};

export const HOST_AD_SIGNAL_KINDS = Object.keys(SIGNALS);

/** One notice per recorded ad_plan_automation_events row. */
export function decideSignalNotice(input: {
  plan: HostAdPlanRef;
  event: { id: string; kind: string; platform?: string | null };
}): HostAdNotice | null {
  const signal = SIGNALS[input.event.kind];
  if (!signal) return null;
  return {
    type: signal.type,
    brandId: input.plan.brandId,
    planId: input.plan.planId,
    idempotencyKey:
      `ad:${input.plan.planId}:${input.event.kind}:${input.event.id}`,
    audience: "ads",
    creatorId: input.plan.creatorId ?? null,
    titleKey: signal.title,
    bodyKeys: [signal.body],
    params: {
      event: eventName(input.plan),
      app: hostAdAppName(input.event.platform),
    },
  };
}

// ── Sender ────────────────────────────────────────────────────────────────

export type HostAdNoticeDispatch = (input: {
  userId: string;
  brandId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  relatedId: string | null;
  relatedType: string;
  idempotencyKey: string;
  deepLink: string;
}) => Promise<unknown>;

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Recipients: the audience's roles (accepted, not removed), the brand owner,
 * and the plan's creator while they are still the owner or on the team;
 * never the actor. A lookup error throws so a caller never treats a notice
 * as sent when nobody was looked up.
 */
export async function hostAdNoticeRecipients(
  db: Db,
  notice: HostAdNotice,
): Promise<string[]> {
  const roles = HOST_AD_NOTICE_ROLES[notice.audience] as readonly string[];
  const [
    { data: members, error: memberError },
    { data: brand, error: brandError },
  ] = await Promise.all([
    db.from("brand_team_members").select("user_id, role")
      .eq("brand_id", notice.brandId).is("removed_at", null)
      .not("accepted_at", "is", null),
    db.from("brands").select("account_id").eq("id", notice.brandId)
      .maybeSingle(),
  ]);
  if (memberError) throw new Error(`recipients: ${memberError.message}`);
  if (brandError) throw new Error(`recipients: ${brandError.message}`);
  const rows = (members ?? []) as { user_id: unknown; role: unknown }[];
  const onTeam = new Set(rows.map((row) => String(row.user_id)));
  const owner = typeof brand?.account_id === "string" ? brand.account_id : null;
  const ids = new Set(
    rows.filter((row) => roles.includes(String(row.role))).map((row) =>
      String(row.user_id)
    ),
  );
  if (owner && roles.includes("brand_owner")) ids.add(owner);
  if (
    notice.creatorId &&
    (onTeam.has(notice.creatorId) || notice.creatorId === owner)
  ) ids.add(notice.creatorId);
  if (notice.actorId) ids.delete(notice.actorId);
  return [...ids].sort();
}

/** Renders one notice in one recipient's language. */
export function renderHostAdNotice(
  notice: HostAdNotice,
  language: unknown,
): { title: string; body: string } {
  const locale = hostAdNoticeLocale(language);
  return {
    title: hostAdNoticeText(locale, notice.titleKey, notice.params),
    body: notice.bodyKeys.map((key) =>
      hostAdNoticeText(locale, key, notice.params)
    ).join(" "),
  };
}

export function hostAdNoticeDeepLink(notice: HostAdNotice): string {
  return notice.planId
    ? `mingla-business://brand/${notice.brandId}/ads/${notice.planId}`
    : `mingla-business://brand/${notice.brandId}/ads`;
}

/**
 * Sends each notice once per recipient. Never throws: a failure is logged and
 * counted, so the sweep or the Host action it rides on is never blocked.
 */
export async function sendHostAdNotices(
  db: Db,
  notices: readonly HostAdNotice[],
  dispatch: HostAdNoticeDispatch,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const notice of notices) {
    try {
      const recipients = await hostAdNoticeRecipients(db, notice);
      if (recipients.length === 0) continue;
      const { data: profiles } = await db.from("profiles")
        .select("id, preferred_language").in("id", recipients);
      const language = new Map(
        ((profiles ?? []) as { id: unknown; preferred_language: unknown }[])
          .map((row) => [String(row.id), row.preferred_language]),
      );
      for (const userId of recipients) {
        const copy = renderHostAdNotice(notice, language.get(userId));
        try {
          await dispatch({
            userId,
            brandId: notice.brandId,
            type: notice.type,
            title: copy.title,
            body: copy.body,
            data: {
              copy_key: notice.titleKey,
              body_keys: notice.bodyKeys,
              params: notice.params,
              plan_id: notice.planId,
              ...(notice.details ? { details: notice.details } : {}),
            },
            relatedId: notice.planId,
            relatedType: "ad_plan",
            idempotencyKey: `${notice.idempotencyKey}:${userId}`,
            deepLink: hostAdNoticeDeepLink(notice),
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          console.error("[hostAdNotices] dispatch failed", {
            type: notice.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      failed += 1;
      console.error("[hostAdNotices] notice failed", {
        type: notice.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { sent, failed };
}

/** Every copy key a notice can use exists (checked by the locale test). */
export const HOST_AD_NOTICE_USED_KEYS: readonly HostAdNoticeCopyKey[] =
  HOST_AD_NOTICE_COPY_KEYS;

// ── Loaders (IO, used by the sweeps and the Host actions) ────────────────

/**
 * The Host plan behind a campaign's plan version, or null (Admin lane,
 * unbound, or unreadable — never a guess).
 */
export async function loadHostAdPlanRef(
  db: Db,
  planVersionIdOrRef: unknown,
): Promise<HostAdPlanRef | null> {
  let planId: string | null = null;
  let planVersionId: string | null = null;
  if (
    planVersionIdOrRef && typeof planVersionIdOrRef === "object" &&
    typeof (planVersionIdOrRef as { planId?: unknown }).planId === "string"
  ) {
    planId = (planVersionIdOrRef as { planId: string }).planId;
  } else if (typeof planVersionIdOrRef === "string" && planVersionIdOrRef) {
    planVersionId = planVersionIdOrRef;
    const { data: version } = await db.from("ad_plan_versions")
      .select("id, plan_id").eq("id", planVersionId).maybeSingle();
    planId = typeof version?.plan_id === "string" ? version.plan_id : null;
  }
  if (!planId) return null;
  const { data: plan } = await db.from("ad_plans")
    .select("id, brand_id, owner_kind, created_by, current_version_id")
    .eq("id", planId).maybeSingle();
  if (
    !plan || plan.owner_kind !== "host" || typeof plan.brand_id !== "string"
  ) {
    return null;
  }
  planVersionId = planVersionId ??
    (typeof plan.current_version_id === "string"
      ? plan.current_version_id
      : null);
  if (!planVersionId) return null;
  const { data: campaign } = await db.from("ad_campaigns")
    .select("dest_event_id").eq("plan_version_id", planVersionId)
    .not("dest_event_id", "is", null).limit(1).maybeSingle();
  let eventTitle: string | null = null;
  if (typeof campaign?.dest_event_id === "string") {
    const { data: event } = await db.from("events").select("title")
      .eq("id", campaign.dest_event_id).maybeSingle();
    eventTitle = typeof event?.title === "string" ? event.title : null;
  }
  return {
    planId: plan.id,
    brandId: plan.brand_id,
    versionId: planVersionId,
    creatorId: typeof plan.created_by === "string" ? plan.created_by : null,
    eventTitle,
  };
}

/** Every ad of a plan version across its apps (for the review notices). */
export async function loadHostAdReviewRows(
  db: Db,
  planVersionId: string,
): Promise<HostAdReviewRow[]> {
  const { data: campaigns } = await db.from("ad_campaigns")
    .select("id, platform").eq("plan_version_id", planVersionId)
    .eq("owner_kind", "host");
  const platformByCampaign = new Map<string, string>(
    ((campaigns ?? []) as { id: unknown; platform: unknown }[]).map((row) => [
      String(row.id),
      String(row.platform),
    ]),
  );
  if (platformByCampaign.size === 0) return [];
  const { data: adSets } = await db.from("ad_sets").select("id, campaign_id")
    .in("campaign_id", [...platformByCampaign.keys()]);
  const campaignBySet = new Map<string, string>(
    ((adSets ?? []) as { id: unknown; campaign_id: unknown }[]).map((row) => [
      String(row.id),
      String(row.campaign_id),
    ]),
  );
  if (campaignBySet.size === 0) return [];
  const { data: ads } = await db.from("ads")
    .select("id, ad_set_id, status, review_status, review_detail")
    .in("ad_set_id", [...campaignBySet.keys()]);
  return ((ads ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    platform: platformByCampaign.get(
      campaignBySet.get(String(row.ad_set_id)) ?? "",
    ) ?? "",
    status: row.status,
    review_status: row.review_status,
    review_detail: row.review_detail,
  }));
}

/** Mingla's count (7-day window) over a plan's campaigns. */
export async function loadMinglaResultCount(
  db: Db,
  planVersionId: string,
  counted: (touchAt: unknown, conversionAt: unknown) => boolean,
): Promise<number> {
  const { data: campaigns } = await db.from("ad_campaigns").select("id")
    .eq("plan_version_id", planVersionId);
  const ids = ((campaigns ?? []) as { id: unknown }[]).map((row) =>
    String(row.id)
  );
  if (ids.length === 0) return 0;
  const { data: conversions } = await db.from("ad_conversions")
    .select("touch_id, created_at").in("campaign_id", ids);
  const rows = (conversions ?? []) as {
    touch_id: unknown;
    created_at: unknown;
  }[];
  const touchIds = [
    ...new Set(
      rows.flatMap((row) =>
        typeof row.touch_id === "string" ? [row.touch_id] : []
      ),
    ),
  ];
  if (touchIds.length === 0) return 0;
  const { data: touches } = await db.from("ad_attribution_touches")
    .select("id, created_at").in("id", touchIds);
  const at = new Map(
    ((touches ?? []) as { id: unknown; created_at: unknown }[]).map((row) => [
      String(row.id),
      row.created_at,
    ]),
  );
  return rows.filter((row) =>
    typeof row.touch_id === "string" &&
    counted(at.get(row.touch_id), row.created_at)
  ).length;
}

/**
 * Sends the pause notice for one paused Host campaign. The pause is keyed by
 * its ad_status_events row (the latest pause for the campaign); a Host's own
 * pause passes its request's idempotency key instead. Never throws.
 */
export async function notifyHostAdPause(
  db: Db,
  input: {
    /** A plan version id, or { planId } when only the plan is known. */
    planVersionId: unknown;
    campaignId: string;
    reason: string;
    pauseRef?: string | null;
    actorId?: string | null;
  },
  dispatch: HostAdNoticeDispatch,
): Promise<void> {
  try {
    const plan = await loadHostAdPlanRef(db, input.planVersionId);
    if (!plan) return;
    let pauseRef = input.pauseRef ?? null;
    if (!pauseRef) {
      const { data: event } = await db.from("ad_status_events").select("id")
        .eq("campaign_id", input.campaignId).eq("action", "pause")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      pauseRef = typeof event?.id === "string" ? event.id : null;
    }
    if (!pauseRef) return;
    let actorName: string | null = null;
    if (input.actorId) {
      const { data: account } = await db.from("creator_accounts")
        .select("display_name").eq("id", input.actorId).maybeSingle();
      actorName = typeof account?.display_name === "string"
        ? account.display_name
        : null;
    }
    await sendHostAdNotices(db, [
      decidePauseNotice({
        plan,
        reason: input.reason,
        pauseRef,
        actorId: input.actorId ?? null,
        actorName,
      }),
    ], dispatch);
  } catch (error) {
    console.error("[hostAdNotices] pause notice failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The ended notice, once the plan's funding hold is settled (the drain ran).
 * Spend and the amount back come from the hold's release ledger row; the
 * results are Mingla's 7-day count. Never throws.
 */
export async function notifyHostAdEnded(
  db: Db,
  input: { planId: string },
  dispatch: HostAdNoticeDispatch,
  formatMoney: (cents: number, currency: string) => string,
): Promise<void> {
  try {
    const plan = await loadHostAdPlanRef(db, { planId: input.planId });
    if (!plan || !plan.versionId) return;
    const { data: hold } = await db.from("ad_plan_funding_holds")
      .select("state, amount_cents, currency, release_ledger_id")
      .eq("plan_version_id", plan.versionId).maybeSingle();
    if (!hold || hold.state !== "settled") return;
    let release:
      | { amount_cents: unknown; final_host_spend_cents?: unknown }
      | null = null;
    if (typeof hold.release_ledger_id === "string") {
      const { data: ledger, error } = await db.from("ad_credit_ledger")
        .select("amount_cents, metadata").eq("id", hold.release_ledger_id)
        .maybeSingle();
      // The ledger row must be readable before the money outcome is stated.
      if (error || !ledger) return;
      const metadata = ledger.metadata && typeof ledger.metadata === "object"
        ? ledger.metadata as Record<string, unknown>
        : {};
      release = {
        amount_cents: ledger.amount_cents,
        final_host_spend_cents: metadata.final_host_spend_cents,
      };
    }
    const results = await loadMinglaResultCount(
      db,
      plan.versionId,
      countedByMingla,
    );
    const notice = decideEndedNotice({
      plan,
      hold,
      release,
      results,
      formatMoney,
    });
    if (notice) await sendHostAdNotices(db, [notice], dispatch);
  } catch (error) {
    console.error("[hostAdNotices] ended notice failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Slow sales, tired creative and last-tickets offers recorded recently. */
export async function notifyHostAdSignals(
  db: Db,
  input: { planId: string; sinceIso: string },
  dispatch: HostAdNoticeDispatch,
): Promise<void> {
  try {
    const plan = await loadHostAdPlanRef(db, { planId: input.planId });
    if (!plan) return;
    const { data: events } = await db.from("ad_plan_automation_events")
      .select("id, kind, platform").eq("plan_id", input.planId)
      .in("kind", HOST_AD_SIGNAL_KINDS).gte("created_at", input.sinceIso);
    const notices = ((events ?? []) as Record<string, unknown>[])
      .map((event) =>
        decideSignalNotice({
          plan,
          event: {
            id: String(event.id),
            kind: String(event.kind),
            platform: typeof event.platform === "string"
              ? event.platform
              : null,
          },
        })
      )
      .filter((notice): notice is HostAdNotice => notice !== null);
    if (notices.length > 0) await sendHostAdNotices(db, notices, dispatch);
  } catch (error) {
    console.error("[hostAdNotices] signal notice failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * #4238 W4c: credit low for one brand, per running Host ad
 * (decideCreditLowNotice). The remaining held budget is the ad's cap
 * (amended or original provider budget) minus its recorded spend in the
 * app's money; spend in another currency is left out, never guessed. The
 * free Ads credit is the wallet balance in the Host's money, compared at the
 * ad's own host/provider rate. Never throws.
 */
export async function notifyHostAdCreditLow(
  db: Db,
  input: { brandId: string; now: Date },
  dispatch: HostAdNoticeDispatch,
  formatMoney: (cents: number, currency: string) => string,
): Promise<void> {
  try {
    const { data: wallet } = await db.from("ad_credit_wallets")
      .select("balance_cents, currency").eq("brand_id", input.brandId)
      .maybeSingle();
    if (!wallet || typeof wallet.currency !== "string") return;
    const currency = wallet.currency.trim().toUpperCase();
    const limits = (AD_CREDIT_TOP_UP_LIMITS_CENTS as Record<
      string,
      { min_pay_cents: number }
    >)[currency];
    if (!limits) return;
    const { data: campaigns } = await db.from("ad_campaigns")
      .select(
        "id, currency, provider_currency, ends_at, host_budget_cents, provider_budget_cents, amended_provider_budget_cents, provider_delivery_budget_cents, amended_provider_delivery_budget_cents, daily_budget_cents, plan_version:ad_plan_versions(plan_id)",
      )
      .eq("brand_id", input.brandId)
      .eq("owner_kind", "host").eq("status", "ACTIVE");
    const live = ((campaigns ?? []) as Record<string, unknown>[]).filter((
      row,
    ) => String(row.currency ?? "").toUpperCase() === currency);
    if (live.length === 0) return;
    const { data: spend } = await db.from("ad_spend_daily")
      .select("campaign_id, spend_date, spend_cents, currency")
      .in("campaign_id", live.map((row) => String(row.id)));
    const { data: topUp } = await db.from("ad_credit_ledger").select("id")
      .eq("brand_id", input.brandId).eq("entry_kind", "top_up")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const days: string[] = [];
    for (let back = 3; back >= 1; back -= 1) {
      days.push(
        new Date(input.now.getTime() - back * 86_400_000).toISOString()
          .slice(0, 10),
      );
    }
    const notices: HostAdNotice[] = [];
    for (const row of live) {
      const providerCurrency = String(
        row.provider_currency ?? row.currency ?? "",
      )
        .toUpperCase();
      const mine = ((spend ?? []) as Record<string, unknown>[]).filter((item) =>
        item.campaign_id === row.id &&
        String(item.currency ?? "").toUpperCase() === providerCurrency
      );
      const spent = mine.reduce(
        (sum, item) => sum + Math.max(0, Number(item.spend_cents) || 0),
        0,
      );
      const byDay = new Map<string, number>();
      for (const item of mine) {
        const day = String(item.spend_date);
        byDay.set(day, (byDay.get(day) ?? 0) + (Number(item.spend_cents) || 0));
      }
      const cap = Number(
        row.amended_provider_budget_cents ?? row.provider_budget_cents,
      );
      const hostCap = Number(row.host_budget_cents);
      const providerCap = Number(row.provider_budget_cents);
      const hostPerProvider = providerCurrency === currency
        ? 1
        : hostCap > 0 && providerCap > 0
        ? hostCap / providerCap
        : NaN;
      const version = row.plan_version as Record<string, unknown> | null;
      const notice = decideCreditLowNotice({
        brandId: input.brandId,
        planId: typeof version?.plan_id === "string" ? version.plan_id : null,
        campaignId: String(row.id),
        currency,
        remainingProviderCents: cap - spent,
        dailySpendCents: days.filter((day) => byDay.has(day)).map((day) =>
          byDay.get(day) ?? 0
        ),
        plannedDailyCents: Math.max(
          0,
          Number(
            row.amended_provider_delivery_budget_cents ??
              row.provider_delivery_budget_cents ?? row.daily_budget_cents,
          ) || 0,
        ),
        hostPerProvider,
        endsAtMs: Date.parse(String(row.ends_at ?? "")),
        nowMs: input.now.getTime(),
        freeCreditCents: Number(wallet.balance_cents),
        latestTopUpLedgerId: typeof topUp?.id === "string" ? topUp.id : null,
        minTopUpPayCents: limits.min_pay_cents,
        formatMoney,
      });
      if (notice) notices.push(notice);
    }
    if (notices.length > 0) await sendHostAdNotices(db, notices, dispatch);
  } catch (error) {
    console.error("[hostAdNotices] credit-low notice failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
