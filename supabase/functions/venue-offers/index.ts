// #4490 venue-offers — buy a venue offer (entry first) with or without an
// account.
//
// POST { action, ... }. Signed-out guests send the project anon key only; a
// signed-in buyer sends their user JWT. Every database call is a service-role
// RPC; this function decides who the caller is:
//   * user   — a verified user JWT: actor `user:<uid>`, the booking's owner.
//   * guest  — no user: the browser's cart key (quote / hold) and then the
//              booking token returned by `hold` (pay, read, cancel). The
//              database stores only SHA-256 of the token.
//
// Actions: offer, availability, quote, hold, pay, confirm_return, get,
// hour_day (P5: the day line of a by-the-hour offer: opening hours, busy
// ranges and every start with the longest free booking; quote then takes
// `startsAt` + `minutes` instead of `windowId`),
// cancel_preview, cancel, change_preview, change (P3: more or fewer guests,
// another day, more extras), hire_options and withdraw (P4 private hire:
// which places are free for a session; the guest withdraws a request or an
// unpaid hold with the booking token).
// `offer` is the guest's read of one live offer (its named prices, the day
// rules and the refund terms). It is answered only for an offer the public
// venue page itself lists (pg_public_venue_page: verified venue, feature on,
// reads flag on, offer live), so it can never show more than the page does.
//
// #4490 P6 memberships: membership_join (a plan, signed out or in; returns
// the member token once), membership_get, membership_leave, membership_stay,
// membership_pause, membership_resume (the member token, or the member's own
// signed-in account). `quote` may carry `membership: {subscriptionId, token?,
// useCredits?}` for the member's price (included hours and entry, guest
// passes, the plan discount). Paying a month is venue-membership-pay-link.
//
// The payment return address comes from BUSINESS_WEB_ORIGIN (production by
// default; a loopback origin only when this function runs on a local stack).
// `confirm_return` asks the provider about the payment when the guest comes
// back and confirms it through the same finalize the webhook uses; the
// webhook stays the backstop.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createStayPaymentSession,
  type PreparedStayPayment,
} from "../_shared/stayPaymentProvider.ts";
import { handleStayPaystackChargeSuccess } from "../_shared/stayPaymentWebhook.ts";
import { paystackVerifyTransaction } from "../_shared/paystack.ts";
import {
  rememberPaymentPage,
  reusedPaymentPage,
} from "../_shared/venueOfferPaymentPage.ts";
import {
  isLocalSupabaseUrl,
  resolveVenueVisitOrigin,
} from "../_shared/venueOfferVisitLink.ts";
import {
  issueVenueOfferBookingToken,
  rederiveVenueOfferBookingToken,
  VENUE_OFFER_TOKEN_RE,
  venueOfferTokenHashHex,
} from "../_shared/venueOfferBookingToken.ts";
import {
  issueVenueMemberToken,
  rederiveVenueMemberToken,
  VENUE_MEMBER_TOKEN_RE,
} from "../_shared/venueMembershipToken.ts";
import type { ClaimLinkAdmin } from "../_shared/claimLink.ts";
import {
  NO_VENUE_CLAIM,
  passPepperFor,
  venueClaimFor,
  venueFlagOn,
  withClaim,
} from "../_shared/venueAppHandoff.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const CART_KEY = /^[A-Za-z0-9_-]{32,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ACTIONS = new Set([
  // #4490 Explorer W1: re-send the app link by text to the phone on file.
  "text_claim_link",
  "offer",
  "availability",
  "quote",
  "hold",
  "pay",
  "confirm_return",
  "get",
  "cancel_preview",
  "cancel",
  "change_preview",
  "change",
  "hire_options",
  "withdraw",
  "hour_day",
  "membership_join",
  "membership_get",
  "membership_leave",
  "membership_stay",
  "membership_pause",
  "membership_resume",
]);
const MEMBER_ACTIONS: Record<string, string> = {
  membership_leave: "leave",
  membership_stay: "stay",
  membership_pause: "pause",
  membership_resume: "resume",
};
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 120;
const windows = new Map<string, { count: number; resetAt: number }>();

// Codes the client may show (each maps to plain words on the guest side).
const SAFE_CODES = [
  "offer_not_found",
  "offer_window_unavailable",
  "offer_option_unavailable",
  "offer_wrong_weekday",
  "offer_wrong_time",
  "offer_guests_out_of_range",
  "offer_group_too_big",
  "offer_sold_out",
  "offer_day_closed",
  "offer_too_soon",
  "offer_too_far",
  "offer_amount_too_large",
  "offer_quote_not_found",
  "offer_quote_expired",
  "offer_changed",
  "offer_guest_invalid",
  "offer_guest_email_required",
  "offer_idempotency_conflict",
  "offer_booking_not_found",
  "claim_text_unavailable",
  "claim_text_no_phone",
  "claim_text_limit",
  "claim_text_not_confirmed",
  "offer_hold_expired",
  "offer_payment_already_pending",
  // #4490 06-W4 fix 1 (W4-N3): another device is paying this booking another way.
  "offer_payment_mode_conflict",
  "offer_payment_already_paid",
  "offer_invalid_transition",
  "offer_bank_not_ready",
  "offer_cancel_too_late",
  "offer_already_checked_in",
  "offer_cancel_preview_invalid",
  "offer_payment_details_rejected",
  "offer_invalid_payload",
  "offers_not_enabled",
  "stale_write",
  "availability_range_invalid",
  "not_authorized",
  "offer_answer_required",
  "offer_extra_unavailable",
  "offer_pay_mode_unavailable",
  "offer_nothing_to_pay",
  "offer_change_not_allowed",
  "offer_change_too_late",
  "offer_change_nothing",
  "offer_space_taken",
  "offer_overtime_unavailable",
  "offer_length_invalid",
  // #4490 P6 memberships.
  "plan_not_found",
  "plan_full",
  "membership_invalid",
  "membership_member_invalid",
  "membership_start_invalid",
  "membership_already_member",
  "membership_not_found",
  "membership_ended",
  "membership_already_leaving",
  "membership_not_leaving",
  "membership_cannot_pause",
  "membership_not_paused",
  "member_not_active",
  "member_wrong_venue",
  "member_credits_used_up",
];

type RpcError = { message?: string; code?: string; details?: string };
type RpcResult = { data: unknown; error: RpcError | null };
export type ServiceClient = {
  rpc: (name: string, params: Record<string, unknown>) => Promise<RpcResult>;
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  auth: {
    getUser: (
      jwt: string,
    ) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

export type VenueOffersDeps = {
  client?: () => ServiceClient;
  env?: (name: string) => string | undefined;
  createPaymentSession?: typeof createStayPaymentSession;
  verifyPaystack?: (reference: string) => Promise<Record<string, unknown>>;
  confirmPaystack?: typeof handleStayPaystackChargeSuccess;
  newGroupId?: () => string;
  issueToken?: typeof issueVenueOfferBookingToken;
  rederiveToken?: typeof rederiveVenueOfferBookingToken;
  newSubscriptionId?: () => string;
  issueMemberToken?: typeof issueVenueMemberToken;
  rederiveMemberToken?: typeof rederiveVenueMemberToken;
};

/**
 * #4490 P5 follow-up: the by-the-hour price rule, stated with the day line.
 * Per minute, pro rata to the hour price (half up); lengths in the offer's
 * step from the shortest booking.
 */
export function hourPricing(day: unknown): Json | null {
  if (!isJson(day) || !Number.isInteger(day.stepMinutes)) return null;
  const step = day.stepMinutes as number;
  const min = Number.isInteger(day.minMinutes)
    ? day.minMinutes as number
    : step;
  return {
    rule: "per_minute_pro_rata",
    formula: "pricePerHourMinor * minutes / 60, rounded half up",
    billableStepMinutes: step,
    minBillableMinutes: Math.max(min, step),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function safeCode(error: RpcError | null | undefined): string {
  const message = error?.message ?? "";
  return SAFE_CODES.find((code) => message === code) ??
    SAFE_CODES.find((code) => message.startsWith(code)) ??
    "offer_request_failed";
}

export function statusFor(error: RpcError | null | undefined): number {
  switch (error?.code) {
    case "22023":
      return 400;
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "PT409":
    case "23505":
      return 409;
    case "P0001":
      return 422;
    default:
      return 500;
  }
}

function rpcFailure(error: RpcError): Response {
  const code = safeCode(error);
  const body: Record<string, unknown> = { code };
  if (code === "offer_sold_out" && error.details) {
    try {
      const detail = JSON.parse(error.details);
      if (typeof detail?.remaining === "number") {
        body.remaining = detail.remaining;
      }
    } catch {
      // detail is optional
    }
  }
  if (code === "offer_group_too_big" && error.details) {
    try {
      const detail = JSON.parse(error.details);
      const layouts = new Set(["standing", "seated", "banquet", "theatre", "classroom", "cabaret", "boardroom"]);
      if (
        typeof detail?.placeName === "string" && detail.placeName.trim().length > 0 && detail.placeName.length <= 120 &&
        typeof detail?.capacity === "number" && Number.isInteger(detail.capacity) && detail.capacity >= 1 && detail.capacity <= 100000 &&
        typeof detail?.layout === "string" && layouts.has(detail.layout)
      ) {
        body.detail = { placeName: detail.placeName, capacity: detail.capacity, layout: detail.layout };
      }
    } catch {
      // Safe detail is optional; the client has generic refusal copy.
    }
  }
  return json(code === "offer_request_failed" ? 500 : statusFor(error), body);
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_PER_WINDOW;
}

export function resetVenueOffersRateLimitForTests(): void {
  windows.clear();
}

/** sha256 hex of text. */
async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isLocalSupabase(url: string): boolean {
  return isLocalSupabaseUrl(url);
}

/**
 * Where the guest returns after paying. Production unless BUSINESS_WEB_ORIGIN
 * names the production origin, a Vercel preview of the business app, or — only
 * when this function itself runs on a local stack — a loopback origin. One
 * rule with the email links (venueOfferVisitLink.ts).
 */
export function resolveReturnOrigin(
  env: (name: string) => string | undefined,
): string {
  return resolveVenueVisitOrigin(env);
}

/**
 * #4490 Explorer W4 — the return address for a `pay`. `channel: "app"` (the
 * Explorer app's native checkout) returns to the app's payment-return page
 * `/paid/visit/<groupId>`, which shows no booking data and sends the guest
 * back to the app; any other value, or none, keeps today's web return. The
 * origin is always the server's own (`resolveVenueVisitOrigin`): no client
 * URL is ever accepted, and the channel never changes what is charged or who
 * may pay.
 */
export function offerPayReturnUrl(
  env: (name: string) => string | undefined,
  groupId: string,
  channel: unknown,
): string {
  const origin = resolveReturnOrigin(env);
  return channel === "app"
    ? `${origin}/paid/visit/${groupId}`
    : `${origin}/visit/${groupId}?paid=1`;
}

export function qrPepper(
  env: (name: string) => string | undefined,
): string | null {
  const local = isLocalSupabase(env("SUPABASE_URL") ?? "");
  const pepper = (env("app.qr_token_pepper") ??
    (local ? env("LOCAL_QR_TOKEN_PEPPER") : undefined) ?? "").trim();
  return pepper.length >= 32 && pepper !== "local-ticket-pepper"
    ? pepper
    : null;
}

function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(
      atob(
        part.replace(/-/g, "+").replace(/_/g, "/").padEnd(
          Math.ceil(part.length / 4) * 4,
          "=",
        ),
      ),
    );
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

type Caller = { userId: string | null };

async function resolveCaller(
  req: Request,
  client: ServiceClient,
): Promise<Caller | "invalid"> {
  const token = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  if (!token || jwtRole(token) !== "authenticated") return { userId: null };
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.id) return "invalid";
  return { userId: data.user.id };
}

/**
 * True only when the booking exists, is a venue booking, and was bought by
 * this signed-in user (its user_id or booked_by_user_id). A booking bought
 * signed-out has neither, so no user id ever matches it.
 */
export async function callerOwnsBooking(
  client: ServiceClient,
  groupId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client.from("stay_reservation_groups")
    .select("user_id, booked_by_user_id, offer_kind")
    .eq("id", groupId)
    .maybeSingle();
  if (error || !data || !data.offer_kind) return false;
  return (typeof data.user_id === "string" && data.user_id === userId) ||
    (typeof data.booked_by_user_id === "string" &&
      data.booked_by_user_id === userId);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The offer row the public venue page lists, or null when it is not listed. */
export function publicOfferListing(
  page: unknown,
  offeringId: string,
): Json | null {
  if (!isJson(page) || !Array.isArray(page.offers)) return null;
  const row = page.offers.find((offer) =>
    isJson(offer) && offer.id === offeringId
  );
  return isJson(row) ? row : null;
}

/**
 * The guest-facing subset of an offer: what is sold, at what prices, on which
 * days, and the refund terms. Never the host's pool, readiness, versions of
 * prices or the operator refund rate.
 */
export function publicOfferDetail(
  projection: unknown,
  page: unknown,
): Json | null {
  if (!isJson(projection) || !isJson(page) || projection.status !== "live") {
    return null;
  }
  const venue = isJson(page.venue) ? page.venue : {};
  const options = Array.isArray(projection.options)
    ? projection.options.filter(isJson).map((option) => ({
      id: option.id,
      name: option.name,
      unit: option.unit,
      guestMin: option.guestMin,
      guestMax: option.guestMax,
      weekdays: option.weekdays ?? null,
      startTime: option.startTime ?? null,
      endTime: option.endTime ?? null,
      eligibility: isJson(option.eligibility)
        ? { label: option.eligibility.label ?? null }
        : null,
      priceMinor: option.priceMinor,
      passDays: option.passDays ?? null,
      passWindowDays: option.passWindowDays ?? null,
      sortOrder: option.sortOrder,
    }))
    : [];
  const policy = isJson(projection.policy) ? projection.policy : null;
  const schedule = isJson(projection.schedule) ? projection.schedule : null;
  return {
    id: projection.id,
    kind: projection.kind,
    entryStyle: projection.entryStyle ?? null,
    name: projection.name,
    summary: projection.summary ?? null,
    description: projection.description ?? null,
    minNoticeMinutes: projection.minNoticeMinutes ?? null,
    maxAdvanceDays: projection.maxAdvanceDays ?? null,
    options,
    policy: policy === null ? null : {
      text: policy.cancellationPolicy ?? null,
      refundLadder: Array.isArray(policy.refundLadder)
        ? policy.refundLadder
        : [],
      dateChangeRule: isJson(policy.dateChangeRule)
        ? policy.dateChangeRule
        : null,
    },
    schedule: schedule === null ? null : {
      mode: schedule.mode,
      weekdays: schedule.weekdays ?? null,
      startTime: schedule.startTime ?? null,
      endTime: schedule.endTime ?? null,
      sessionMinutes: schedule.sessionMinutes ?? null,
    },
    // Group packages: what is included, priced extras, the deposit, when it
    // starts and for how long (the venue's own words; no internal ids).
    inclusions: Array.isArray(projection.inclusions)
      ? projection.inclusions.filter(isJson).map((item) => ({
        kind: item.kind ?? "item",
        label: item.label ?? null,
        qtyPer: item.qtyPer ?? null,
        staffRatio: item.staffRatio ?? null,
        options: Array.isArray(item.options) ? item.options : null,
      }))
      : [],
    extras: Array.isArray(projection.extras)
      ? projection.extras.filter(isJson).map((extra) => ({
        id: extra.id,
        name: extra.name,
        priceMinor: extra.priceMinor,
        per: extra.per,
      }))
      : [],
    deposit: isJson(projection.deposit) ? projection.deposit : null,
    payModes: Array.isArray(projection.payModes)
      ? projection.payModes
      : ["full"],
    startTimes: Array.isArray(projection.startTimes)
      ? projection.startTimes
      : [],
    durationMinutes: projection.durationMinutes ?? null,
    hire: publicHireDetail(projection.hire),
    confirmationMode: projection.confirmationMode ?? "instant",
    currencyCode: page.currencyCode ?? null,
    minorUnitExponent: page.minorUnitExponent ?? 2,
    vat: isJson(page.vat) ? page.vat : null,
    venue: {
      id: venue.id ?? null,
      name: venue.name ?? null,
      slug: venue.slug ?? null,
      brandSlug: venue.brand_slug ?? null,
      brandName: venue.brand_name ?? null,
      address: venue.address ?? null,
      city: venue.city ?? null,
      countryCode: venue.country_code ?? null,
      timezone: venue.iana_timezone ?? schedule?.timezone ?? null,
    },
  };
}

/**
 * The guest-facing part of a private hire: the places and their price rows,
 * the sessions, the refundable damage deposit, the extra-guest price, extra
 * hours and how the venue answers. Never the setup / cleanup minutes (kept
 * from guests), internal ids of price versions or the pay-within timer.
 */
export function publicHireDetail(hire: unknown): Json | null {
  if (!isJson(hire)) return null;
  const list = (v: unknown) => Array.isArray(v) ? v.filter(isJson) : [];
  return {
    charge: hire.charge ?? "hire_fee",
    bookingMode: hire.bookingMode ?? "request",
    requestResponseHours: hire.requestResponseHours ?? null,
    damageDepositMinor: hire.damageDepositMinor ?? 0,
    minSpendMinor: hire.minSpendMinor ?? 0,
    extraGuestMinor: hire.extraGuestMinor ?? null,
    overtimeMinorPerHour: hire.overtimeMinorPerHour ?? null,
    layouts: Array.isArray(hire.layouts) ? hire.layouts : [],
    spaces: list(hire.spaces).map((s) => ({
      id: s.id,
      name: s.name,
      setting: s.setting ?? null,
      capacityStanding: s.capacityStanding ?? null,
      capacitySeated: s.capacitySeated ?? null,
    })),
    combinations: list(hire.combinations).map((c) => ({
      id: c.id,
      name: c.name,
      spaceIds: Array.isArray(c.spaceIds) ? c.spaceIds : [],
    })),
    rows: list(hire.rows).map((r) => ({
      optionId: r.optionId,
      name: r.name,
      unit: r.unit,
      spaceId: r.spaceId ?? null,
      combinationId: r.combinationId ?? null,
      placeName: r.placeName ?? null,
      capacity: r.capacity ?? null,
      layoutCapacities: isJson(r.layoutCapacities) ? r.layoutCapacities : {},
      guestMin: r.guestMin,
      guestMax: r.guestMax,
      weekdays: r.weekdays ?? null,
      priceMinor: r.priceMinor,
    })),
    sessions: list(hire.sessions).map((s) => ({
      label: s.label ?? null,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
      pastMidnight: s.pastMidnight === true,
      weekdays: s.weekdays ?? null,
    })),
    // #4490 P5 follow-up: "Hours you set" (the guest picks a start and a
    // length inside these hours). No internal rule id.
    hoursYouSet: isJson(hire.hoursYouSet)
      ? {
        weekdays: hire.hoursYouSet.weekdays ?? null,
        startTime: hire.hoursYouSet.startTime ?? null,
        endTime: hire.hoursYouSet.endTime ?? null,
        pastMidnight: hire.hoursYouSet.pastMidnight === true,
        minMinutes: hire.hoursYouSet.minMinutes ?? null,
        maxMinutes: hire.hoursYouSet.maxMinutes ?? null,
        stepMinutes: hire.hoursYouSet.stepMinutes ?? null,
      }
      : null,
  };
}

type PaystackVerify = (reference: string) => Promise<Record<string, unknown>>;

/**
 * The booking's latest pending Paystack payment, asked about at the provider:
 * "paid" (confirmed now through the webhook's finalize), "closed" (failed or
 * left unpaid; marked failed so a new payment may start), "in_flight", or
 * "none" (nothing we can settle here, e.g. a Stripe payment). A payment
 * closed here that the guest still completes later is confirmed by the
 * webhook as usual (or, when another payment already confirmed the booking,
 * recorded as refund due).
 */
export async function settleEarlierPayment(
  client: ServiceClient,
  groupId: string,
  deps: VenueOffersDeps,
): Promise<"paid" | "closed" | "in_flight" | "none"> {
  const { data: attempt } = await client.from("stay_payment_attempts")
    .select("id, provider, provider_payment_ref, state")
    .eq("group_id", groupId)
    .eq("state", "pending")
    .order("attempt_ordinal", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    !attempt || attempt.provider !== "paystack" ||
    typeof attempt.provider_payment_ref !== "string"
  ) return "none";
  const reference = String(attempt.provider_payment_ref);
  const verify: PaystackVerify = deps.verifyPaystack ??
    ((ref: string) => paystackVerifyTransaction(ref));
  let verified: Record<string, unknown>;
  try {
    verified = await verify(reference);
  } catch {
    return "in_flight";
  }
  const status = String(verified.status ?? "").toLowerCase();
  if (status === "success") {
    try {
      await (deps.confirmPaystack ?? handleStayPaystackChargeSuccess)(
        client,
        { reference },
        `return:${reference}`,
        (ref: string) =>
          ref === reference ? Promise.resolve(verified) : verify(ref),
      );
      return "paid";
    } catch {
      return "in_flight";
    }
  }
  if (["failed", "abandoned", "reversed"].includes(status)) {
    await client.rpc("issue_1389_record_payment_create_failure", {
      p_attempt_id: attempt.id,
      p_failure_code: status === "abandoned"
        ? "provider_abandoned"
        : "provider_failed",
      p_ambiguous: false,
    });
    return "closed";
  }
  return "in_flight";
}

/**
 * #4490 Explorer W1 (N155): true only when a text carrying this booking's app
 * link was actually queued ("Text me the link"). Venue offer confirmations
 * have no SMS leg, so the page may say "We also texted the link" only then.
 * A failed read is "not texted" (the card just leaves the line out).
 */
export async function claimTexted(
  client: ServiceClient,
  groupId: string,
): Promise<boolean> {
  return (await claimTextCount(client, groupId)) > 0;
}

/** N159: how many app-link texts were queued for this booking (cap 3). */
export async function claimTextCount(
  client: ServiceClient,
  groupId: string,
): Promise<number> {
  try {
    const { data, error } = await client.from("notification_outbox")
      .select("id")
      .like("idempotency_key", `venue-claim-text:${groupId}:%`)
      .limit(3);
    return !error && Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "BUSINESS_WEB_ORIGIN":
      return Deno.env.get("BUSINESS_WEB_ORIGIN");
    case "LOCAL_QR_TOKEN_PEPPER":
      return Deno.env.get("LOCAL_QR_TOKEN_PEPPER");
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    case "app.qr_token_pepper":
      return Deno.env.get("app.qr_token_pepper");
    default:
      return undefined;
  }
}

export function createVenueOffersHandler(deps: VenueOffersDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
    const body = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const action = str(body?.action);
    if (!body || !ACTIONS.has(action)) {
      return json(400, { code: "invalid_request" });
    }

    let client: ServiceClient;
    if (deps.client) {
      client = deps.client();
    } else {
      const url = env("SUPABASE_URL") ?? "";
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!url || !serviceKey) return json(500, { code: "unavailable" });
      client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as ServiceClient;
    }
    const caller = await resolveCaller(req, client);
    if (caller === "invalid") return json(401, { code: "auth_invalid" });

    const ip =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      "unknown";
    if (rateLimited(`${action}:${caller.userId ?? ip}`)) {
      return json(429, { code: "rate_limited" });
    }

    // ---- offer: one live offer's public detail (no identity needed) -------
    if (action === "offer") {
      const offeringId = str(body.offeringId);
      const brandSlug = str(body.brandSlug);
      const venueSlug = str(body.venueSlug);
      if (
        !UUID.test(offeringId) || !SLUG.test(brandSlug) || !SLUG.test(venueSlug)
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data: page, error: pageError } = await client.rpc(
        "pg_public_venue_page",
        { p_brand_slug: brandSlug, p_venue_slug: venueSlug },
      );
      if (pageError) return rpcFailure(pageError);
      const listed = publicOfferListing(page, offeringId);
      if (listed === null) return json(404, { code: "offer_not_found" });
      const { data: projection, error } = await client.rpc(
        "issue_4490_offer_projection",
        { p_offering_id: offeringId },
      );
      if (error) return rpcFailure(error);
      const detail = publicOfferDetail(projection, page);
      if (detail === null) return json(404, { code: "offer_not_found" });
      // "At the gate only": the venue cannot take this payment online today.
      detail.canCollectOnline = listed.canCollectOnline !== false;
      return json(200, { kind: "success", data: detail });
    }

    // ---- availability (no identity needed) --------------------------------
    if (action === "availability") {
      const offeringId = str(body.offeringId);
      const from = str(body.from);
      const to = str(body.to);
      const guests = body.guests;
      const option = body.priceOptionId;
      if (
        !UUID.test(offeringId) || !DATE.test(from) || !DATE.test(to) ||
        (guests !== undefined && guests !== null &&
          !Number.isInteger(guests)) ||
        (option !== undefined && option !== null && !UUID.test(str(option)))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("pg_venue_offer_availability", {
        p_offering_id: offeringId,
        p_from: from,
        p_to: to,
        p_guests: guests ?? null,
        p_price_option_id: option ?? null,
      });
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data: { days: data ?? [] } });
    }

    // ---- hire_options: the places for one hire session (no identity) -----
    if (action === "hire_options") {
      const offeringId = str(body.offeringId);
      const windowId = str(body.windowId);
      const guests = body.guests;
      if (
        !UUID.test(offeringId) || !UUID.test(windowId) ||
        (guests !== undefined && guests !== null && !Number.isInteger(guests))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("pg_venue_hire_options", {
        p_offering_id: offeringId,
        p_window_id: windowId,
        p_guests: guests ?? null,
      });
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data: { options: data ?? [] } });
    }

    // ---- hour_day: a flexible offer's day line (no identity needed) --------
    if (action === "hour_day") {
      const offeringId = str(body.offeringId);
      const date = str(body.date);
      const guests = body.guests;
      const option = body.priceOptionId;
      if (
        !UUID.test(offeringId) || !DATE.test(date) ||
        (guests !== undefined && guests !== null &&
          !Number.isInteger(guests)) ||
        (option !== undefined && option !== null && !UUID.test(str(option)))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("pg_venue_hour_day", {
        p_offering_id: offeringId,
        p_date: date,
        p_guests: guests ?? null,
        p_price_option_id: option ?? null,
      });
      if (error) return rpcFailure(error);
      if (data === null) return json(404, { code: "offer_not_found" });
      const pricing = hourPricing(data);
      return json(200, {
        kind: "success",
        data: pricing ? { ...(data as Json), pricing } : data,
      });
    }

    // ---- quote / hold: actor key = user, else the browser's cart key ------
    const cartKey = str(body.cartKey);
    const actorKey = caller.userId
      ? await sha256Hex(`user:${caller.userId}`)
      : CART_KEY.test(cartKey)
      ? await sha256Hex(`guest-cart:${cartKey}`)
      : null;

    if (action === "quote") {
      const offeringId = str(body.offeringId);
      let windowId = str(body.windowId);
      const key = str(body.idempotencyKey);
      // #4490 P5: a flexible booking (by the hour, "Hours you set") names its
      // start and length; its own window is made first.
      const flexible = !windowId && body.startsAt !== undefined;
      const startsAt = str(body.startsAt);
      if (
        !actorKey || !UUID.test(offeringId) ||
        (flexible
          ? Number.isNaN(Date.parse(startsAt)) ||
            !Number.isInteger(body.minutes) ||
            (body.minutes as number) < 15 || (body.minutes as number) > 1440
          : !UUID.test(windowId)) ||
        !KEY.test(key) || !Array.isArray(body.lines)
      ) {
        return json(400, { code: "invalid_request" });
      }
      if (flexible) {
        const { data: made, error: windowError } = await client.rpc(
          "issue_4490_flexible_window",
          {
            p_offering_id: offeringId,
            p_starts_at: new Date(startsAt).toISOString(),
            p_minutes: body.minutes,
          },
        );
        if (windowError) return rpcFailure(windowError);
        windowId = String(made ?? "");
      }
      const extras = body.extras ?? [];
      const answers = body.answers ?? {};
      if (!Array.isArray(extras) || !isJson(answers)) {
        return json(400, { code: "invalid_request" });
      }
      const membership = body.membership;
      if (
        membership !== undefined && membership !== null &&
        (!isJson(membership) || !UUID.test(str(membership.subscriptionId)) ||
          (membership.token !== undefined &&
            !VENUE_MEMBER_TOKEN_RE.test(str(membership.token))) ||
          (!caller.userId &&
            !VENUE_MEMBER_TOKEN_RE.test(str(membership.token))))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("issue_4490_quote_offer", {
        p_offering_id: offeringId,
        p_window_id: windowId,
        p_lines: body.lines,
        p_actor_key: actorKey,
        p_user_id: caller.userId,
        p_idempotency_key: key,
        p_extras: extras,
        p_answers: answers,
      });
      if (error) return rpcFailure(error);
      if (!isJson(membership)) return json(200, { kind: "success", data });
      // #4490 P6: the member's price on the same booking (a new quote; the
      // guests' price quote expires).
      const memberToken = str(membership.token);
      const { data: member, error: memberError } = await client.rpc(
        "issue_4490_member_quote",
        {
          p_quote_id: (data as Json).quoteId,
          p_subscription_id: membership.subscriptionId,
          p_token_hash: memberToken
            ? `\\x${await venueOfferTokenHashHex(memberToken)}`
            : null,
          p_user_id: memberToken ? null : caller.userId,
          p_actor_key: actorKey,
          p_use_credits: membership.useCredits !== false,
        },
      );
      if (memberError) return rpcFailure(memberError);
      return json(200, {
        kind: "success",
        data: { ...(data as Json), ...(member as Json) },
      });
    }

    if (action === "hold") {
      const quoteId = str(body.quoteId);
      const key = str(body.idempotencyKey);
      const guest = body.guest;
      if (
        !actorKey || !UUID.test(quoteId) || !KEY.test(key) ||
        !guest || typeof guest !== "object" || Array.isArray(guest)
      ) {
        return json(400, { code: "invalid_request" });
      }
      const groupId = (deps.newGroupId ?? (() => crypto.randomUUID()))();
      const issued = await (deps.issueToken ?? issueVenueOfferBookingToken)({
        groupId,
      });
      const { data, error } = await client.rpc(
        "issue_4490_create_offer_group",
        {
          p_group_id: groupId,
          p_quote_id: quoteId,
          p_guest: guest,
          p_actor_key: actorKey,
          p_user_id: caller.userId,
          p_buyer_token_hash: `\\x${await venueOfferTokenHashHex(
            issued.token,
          )}`,
          p_idempotency_key: key,
        },
      );
      if (error) return rpcFailure(error);
      const booking = data as Record<string, unknown>;
      let token: string | null = issued.token;
      if (booking.groupId !== groupId) {
        // A replay returned the booking made by the first call: rebuild its
        // token (derived tokens only); otherwise the first response had it.
        const { data: row } = await client.from("stay_reservation_groups")
          .select("buyer_token_hash").eq("id", booking.groupId).maybeSingle();
        token = await (deps.rederiveToken ?? rederiveVenueOfferBookingToken)({
          groupId: String(booking.groupId),
          storedHashHex: typeof row?.buyer_token_hash === "string"
            ? row.buyer_token_hash
            : null,
        });
      }
      return json(200, {
        kind: "success",
        data: {
          ...booking,
          bookingToken: token,
          visitPath: `/visit/${booking.groupId}`,
        },
      });
    }

    // ---- #4490 P6 memberships ---------------------------------------------
    if (action === "membership_join") {
      const planId = str(body.planId);
      const key = str(body.idempotencyKey);
      const member = body.member;
      const startOn = body.startOn;
      if (
        !actorKey || !UUID.test(planId) || !KEY.test(key) || !isJson(member) ||
        (startOn !== undefined && startOn !== null && !DATE.test(str(startOn)))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const subscriptionId = (deps.newSubscriptionId ?? (() =>
        crypto.randomUUID()))();
      const issued = await (deps.issueMemberToken ?? issueVenueMemberToken)({
        subscriptionId,
      });
      const { data, error } = await client.rpc("issue_4490_membership_join", {
        p_subscription_id: subscriptionId,
        p_plan_id: planId,
        p_member: {
          name: str(member.name),
          email: str(member.email),
          ...(member.phone ? { phone: str(member.phone) } : {}),
        },
        p_start_on: startOn ?? null,
        p_actor_key: actorKey,
        p_user_id: caller.userId,
        p_member_token_hash: `\\x${await venueOfferTokenHashHex(
          issued.token,
        )}`,
        p_idempotency_key: key,
      });
      if (error) return rpcFailure(error);
      const joined = data as Json;
      let token: string | null = issued.token;
      if (joined.subscriptionId !== subscriptionId) {
        // A replay returned the first join: rebuild its token (derived only).
        const { data: row } = await client.from(
          "venue_membership_subscriptions",
        ).select("member_token_hash").eq("id", joined.subscriptionId)
          .maybeSingle();
        token = await (deps.rederiveMemberToken ?? rederiveVenueMemberToken)({
          subscriptionId: String(joined.subscriptionId),
          storedHashHex: typeof row?.member_token_hash === "string"
            ? row.member_token_hash
            : null,
        });
      }
      return json(200, {
        kind: "success",
        data: {
          ...joined,
          memberToken: token,
          memberPath: `/visit/plan/${joined.subscriptionId}`,
        },
      });
    }

    if (action === "membership_get" || action in MEMBER_ACTIONS) {
      const subscriptionId = str(body.subscriptionId);
      const memberToken = str(body.token);
      if (!UUID.test(subscriptionId)) {
        return json(400, { code: "invalid_request" });
      }
      if (!caller.userId && !VENUE_MEMBER_TOKEN_RE.test(memberToken)) {
        return json(401, { code: "membership_token_required" });
      }
      const tokenHash = VENUE_MEMBER_TOKEN_RE.test(memberToken)
        ? `\\x${await venueOfferTokenHashHex(memberToken)}`
        : null;
      if (action === "membership_get") {
        const [appOnly, handoffOn] = await Promise.all([
          venueFlagOn(client, "VENUE_PASS_APP_ONLY"),
          venueFlagOn(client, "VENUE_APP_HANDOFF"),
        ]);
        const { data, error } = await client.rpc("issue_4490_membership_get", {
          p_subscription_id: subscriptionId,
          p_token_hash: tokenHash,
          p_user_id: tokenHash ? null : caller.userId,
          p_qr_pepper: passPepperFor(qrPepper(env), appOnly, caller, tokenHash),
        });
        if (error) return rpcFailure(error);
        const claim = data
          ? await venueClaimFor(
            client as unknown as ClaimLinkAdmin,
            handoffOn,
            "venue_membership",
            subscriptionId,
          )
          : NO_VENUE_CLAIM;
        return json(200, { kind: "success", data: withClaim(data, claim) });
      }
      const key = str(body.idempotencyKey);
      if (!KEY.test(key)) return json(400, { code: "invalid_request" });
      const { data, error } = await client.rpc(
        "issue_4490_membership_member_action",
        {
          p_subscription_id: subscriptionId,
          p_token_hash: tokenHash,
          p_user_id: tokenHash ? null : caller.userId,
          p_action: MEMBER_ACTIONS[action],
          p_idempotency_key: key,
        },
      );
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data });
    }

    // ---- everything else acts on one booking ------------------------------
    const groupId = str(body.groupId);
    const bookingToken = str(body.token);
    if (!UUID.test(groupId)) return json(400, { code: "invalid_request" });
    if (!caller.userId && !VENUE_OFFER_TOKEN_RE.test(bookingToken)) {
      return json(401, { code: "booking_token_required" });
    }
    const tokenHash = VENUE_OFFER_TOKEN_RE.test(bookingToken)
      ? `\\x${await venueOfferTokenHashHex(bookingToken)}`
      : null;
    // A signed-in caller without the booking token may act only on a booking
    // that is theirs (bought signed in). Everyone else needs the token. Staff
    // use the staff paths (venue-check-in, the Host RPCs), never this one.
    // The database checks the same rule again (issue_4490_booking_actor_ok).
    if (!tokenHash && caller.userId) {
      const owns = await callerOwnsBooking(client, groupId, caller.userId);
      if (!owns) return json(404, { code: "offer_booking_not_found" });
    }

    // #4490 Explorer W1 (design web:desk): "Text me the link". The booking
    // token (or the signed-in owner, checked above) is required; the text goes
    // only to the phone already on the booking, at most 3 times (SQL).
    if (action === "text_claim_link") {
      const { data, error } = await client.rpc("issue_4490_text_claim_link", {
        p_group_id: groupId,
        p_token_hash: tokenHash,
        p_user_id: tokenHash ? null : caller.userId,
      });
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data });
    }

    if (action === "get") {
      const [appOnly, handoffOn] = await Promise.all([
        venueFlagOn(client, "VENUE_PASS_APP_ONLY"),
        venueFlagOn(client, "VENUE_APP_HANDOFF"),
      ]);
      const { data, error } = await client.rpc("issue_4490_get_offer_booking", {
        p_group_id: groupId,
        p_token_hash: tokenHash,
        p_user_id: caller.userId,
        p_qr_pepper: passPepperFor(qrPepper(env), appOnly, caller, tokenHash),
      });
      if (error) return rpcFailure(error);
      const minted = data
        ? await venueClaimFor(
          client as unknown as ClaimLinkAdmin,
          handoffOn,
          "venue_booking",
          groupId,
        )
        : NO_VENUE_CLAIM;
      const texts = minted.shortUrl === null
        ? 0
        : await claimTextCount(client, groupId);
      const claim = minted.shortUrl === null
        ? minted
        : { ...minted, texted: texts > 0, textsLeft: Math.max(0, 3 - texts) };
      return json(200, { kind: "success", data: withClaim(data, claim) });
    }

    if (action === "pay") {
      const key = str(body.idempotencyKey);
      const expectedVersion = body.expectedVersion;
      if (
        !KEY.test(key) || !Number.isSafeInteger(expectedVersion) ||
        Number(expectedVersion) < 1
      ) {
        return json(400, { code: "invalid_request" });
      }
      const payMode = body.payMode ?? null;
      if (payMode !== null && payMode !== "deposit" && payMode !== "full") {
        return json(400, { code: "invalid_request" });
      }
      const prepare = () =>
        client.rpc("issue_4490_prepare_offer_payment", {
          p_group_id: groupId,
          p_token_hash: tokenHash,
          p_user_id: caller.userId,
          p_idempotency_key: key,
          p_expected_version: expectedVersion,
          p_pay_mode: payMode,
        });
      let { data: prepared, error } = await prepare();
      if (error && safeCode(error) === "offer_payment_already_pending") {
        // The guest left an earlier payment page without paying. Ask the
        // provider about it: closed or abandoned -> close it and start a
        // fresh payment; paid -> confirm it; still in flight -> say so.
        const earlier = await settleEarlierPayment(client, groupId, deps);
        if (earlier === "paid") {
          return json(409, { code: "offer_payment_already_paid" });
        }
        if (earlier === "closed") ({ data: prepared, error } = await prepare());
      }
      if (error) return rpcFailure(error);
      const callbackUrl = offerPayReturnUrl(env, groupId, body.channel);
      // #4490 06-W4 fix 1 (W4-N3): a payment of the same stage and amount is
      // already open for this booking: its own page again, never a second one.
      const reused = reusedPaymentPage(prepared);
      if (reused) {
        return json(200, {
          kind: "success",
          data: { ...reused, returnUrl: callbackUrl },
        });
      }
      try {
        const session = await (deps.createPaymentSession ??
          createStayPaymentSession)(
            prepared as PreparedStayPayment,
            key,
            {},
            { callbackUrl },
          );
        const { error: bindError } = await client.rpc(
          "issue_1389_bind_payment_attempt",
          {
            p_attempt_id: session.attemptId,
            p_provider_payment_ref: session.providerPaymentRef,
            p_provider_charge_ref: null,
            p_request_id: crypto.randomUUID(),
          },
        );
        if (bindError) {
          await client.rpc("issue_1389_record_payment_create_failure", {
            p_attempt_id: session.attemptId,
            p_failure_code: "provider_binding_ambiguous",
            p_ambiguous: true,
          });
          return json(502, { code: "offer_payment_ambiguous" });
        }
        await rememberPaymentPage(client, session);
        return json(200, {
          kind: "success",
          data: { ...session, returnUrl: callbackUrl },
        });
      } catch (providerError) {
        const providerCode = providerError instanceof Error
          ? providerError.message
          : String(providerError);
        if (providerCode === "stay_payment_already_pending") {
          return json(409, { code: "offer_payment_already_pending" });
        }
        // A 4xx from Paystack initialize means no transaction exists (for
        // example the provider refused the email): not ambiguous, nothing to
        // reconcile. Anything else may have reached the provider.
        const refused = /^Paystack initialize failed \(4\d\d\)/.test(
          providerCode,
        );
        const attemptId = str((prepared as Record<string, unknown>)?.attemptId);
        if (attemptId) {
          await client.rpc("issue_1389_record_payment_create_failure", {
            p_attempt_id: attemptId,
            p_failure_code: refused
              ? "provider_create_refused"
              : "provider_create_ambiguous",
            p_ambiguous: !refused,
          });
        }
        return refused
          ? json(422, { code: "offer_payment_details_rejected" })
          : json(502, { code: "offer_payment_unavailable" });
      }
    }

    if (action === "confirm_return") {
      // Who may ask: the booking's token holder or owner.
      const { data: booking, error } = await client.rpc(
        "issue_4490_get_offer_booking",
        {
          p_group_id: groupId,
          p_token_hash: tokenHash,
          p_user_id: caller.userId,
          p_qr_pepper: null,
        },
      );
      if (error) return rpcFailure(error);
      // The provider and reference come from our own attempt row, never the URL.
      const { data: attempt } = await client.from("stay_payment_attempts")
        .select("id, provider, provider_payment_ref, state")
        .eq("group_id", groupId)
        .in("state", ["pending", "succeeded"])
        .order("attempt_ordinal", { ascending: false })
        .limit(1)
        .maybeSingle();
      let outcome = "nothing_to_confirm";
      if (
        attempt?.provider === "paystack" && attempt.state === "pending" &&
        typeof attempt.provider_payment_ref === "string"
      ) {
        const reference = attempt.provider_payment_ref;
        const verify = deps.verifyPaystack ??
          ((ref: string) => paystackVerifyTransaction(ref));
        let verified: Record<string, unknown> | null = null;
        try {
          verified = await verify(reference);
        } catch {
          outcome = "pending";
        }
        if (verified) {
          const status = String(verified.status ?? "").toLowerCase();
          if (status === "success") {
            try {
              await (deps.confirmPaystack ?? handleStayPaystackChargeSuccess)(
                client,
                { reference },
                `return:${reference}`,
                (ref: string) =>
                  ref === reference ? Promise.resolve(verified!) : verify(ref),
              );
              outcome = "confirmed";
            } catch {
              outcome = "pending";
            }
          } else if (["failed", "abandoned", "reversed"].includes(status)) {
            // Nothing was taken: close this payment so the guest can pay
            // again at once (a late success still confirms through the
            // same finalize). "abandoned" = the page was left unpaid.
            await client.rpc("issue_1389_record_payment_create_failure", {
              p_attempt_id: attempt.id,
              p_failure_code: status === "abandoned"
                ? "provider_abandoned"
                : "provider_failed",
              p_ambiguous: false,
            });
            outcome = status === "abandoned" ? "not_paid" : "failed";
          } else {
            outcome = "pending";
          }
        }
      } else if (attempt?.state === "succeeded") {
        outcome = "confirmed";
      }
      const [appOnly, handoffOn] = await Promise.all([
        venueFlagOn(client, "VENUE_PASS_APP_ONLY"),
        venueFlagOn(client, "VENUE_APP_HANDOFF"),
      ]);
      const { data: fresh, error: readError } = await client.rpc(
        "issue_4490_get_offer_booking",
        {
          p_group_id: groupId,
          p_token_hash: tokenHash,
          p_user_id: caller.userId,
          p_qr_pepper: passPepperFor(qrPepper(env), appOnly, caller, tokenHash),
        },
      );
      if (readError) return rpcFailure(readError);
      const claim = await venueClaimFor(
        client as unknown as ClaimLinkAdmin,
        handoffOn,
        "venue_booking",
        groupId,
      );
      return json(200, {
        kind: "success",
        data: { outcome, booking: withClaim(fresh ?? booking, claim), claim },
      });
    }

    if (action === "cancel_preview") {
      const { data, error } = await client.rpc("issue_4490_cancel_preview", {
        p_group_id: groupId,
        p_token_hash: tokenHash,
        p_user_id: caller.userId,
      });
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data });
    }

    if (action === "withdraw") {
      const { data, error } = await client.rpc("issue_4490_withdraw_request", {
        p_group_id: groupId,
        p_token_hash: tokenHash,
        p_user_id: caller.userId,
      });
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data });
    }

    if (action === "change_preview" || action === "change") {
      const change = str(body.change);
      let payload = body.payload;
      const preview = action === "change_preview";
      const key = str(body.idempotencyKey);
      const expectedVersion = body.expectedVersion;
      if (
        !["change_guests", "move_date", "add_extras"].includes(change) ||
        !isJson(payload) ||
        (!preview &&
          (!KEY.test(key) || !Number.isSafeInteger(expectedVersion) ||
            Number(expectedVersion) < 1))
      ) {
        return json(400, { code: "invalid_request" });
      }
      // #4490 P5 follow-up (UI): a by-the-hour booking moves to a new start
      // and length. Its own window is made first (as for a flexible quote);
      // the database then checks the window belongs to the booking's offer.
      if (
        change === "move_date" && isJson(payload) && !payload.windowId &&
        payload.startsAt !== undefined
      ) {
        const startsAt = str(payload.startsAt);
        const minutes = payload.minutes;
        const offeringId = str(payload.offeringId);
        if (
          !UUID.test(offeringId) || Number.isNaN(Date.parse(startsAt)) ||
          !Number.isInteger(minutes) || (minutes as number) < 15 ||
          (minutes as number) > 1440
        ) {
          return json(400, { code: "invalid_request" });
        }
        const { data: made, error: windowError } = await client.rpc(
          "issue_4490_flexible_window",
          {
            p_offering_id: offeringId,
            p_starts_at: new Date(startsAt).toISOString(),
            p_minutes: minutes,
          },
        );
        if (windowError) return rpcFailure(windowError);
        payload = { windowId: String(made ?? "") };
      }
      const { data, error } = await client.rpc(
        "issue_4490_guest_change_booking",
        {
          p_group_id: groupId,
          p_token_hash: tokenHash,
          p_user_id: caller.userId,
          p_action: change,
          p_payload: payload,
          p_preview: preview,
          p_expected_version: preview ? null : expectedVersion,
          p_idempotency_key: preview ? null : key,
        },
      );
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data });
    }

    // cancel
    const previewIds = Array.isArray(body.previewIds) ? body.previewIds : [];
    const previewHash = str(body.previewHash);
    const key = str(body.idempotencyKey);
    const reason = str(body.reason) || "Cancelled by the guest";
    if (
      previewIds.length < 1 || previewIds.length > 20 ||
      !previewIds.every((id) => UUID.test(str(id))) ||
      !/^[a-f0-9]{64}$/.test(previewHash) || !KEY.test(key) ||
      reason.length < 3 || reason.length > 500
    ) {
      return json(400, { code: "invalid_request" });
    }
    const { data, error } = await client.rpc("issue_4490_cancel", {
      p_preview_ids: previewIds,
      p_preview_hash: previewHash,
      p_idempotency_key: key,
      p_reason: reason,
      p_token_hash: tokenHash,
      p_user_id: caller.userId,
    });
    if (error) return rpcFailure(error);
    return json(200, { kind: "success", data });
  };
}

if (import.meta.main) {
  serve(createVenueOffersHandler());
}
