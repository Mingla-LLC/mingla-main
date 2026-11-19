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
// cancel_preview, cancel. (change_* arrive in P3, withdraw in P4.)
// `offer` is the guest's read of one live offer (its named prices, the day
// rules and the refund terms). It is answered only for an offer the public
// venue page itself lists (pg_public_venue_page: verified venue, feature on,
// reads flag on, offer live), so it can never show more than the page does.
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
  isLocalSupabaseUrl,
  resolveVenueVisitOrigin,
} from "../_shared/venueOfferVisitLink.ts";
import {
  issueVenueOfferBookingToken,
  rederiveVenueOfferBookingToken,
  VENUE_OFFER_TOKEN_RE,
  venueOfferTokenHashHex,
} from "../_shared/venueOfferBookingToken.ts";

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
  "offer",
  "availability",
  "quote",
  "hold",
  "pay",
  "confirm_return",
  "get",
  "cancel_preview",
  "cancel",
]);
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
  "offer_hold_expired",
  "offer_payment_already_pending",
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
};

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

function qrPepper(env: (name: string) => string | undefined): string | null {
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

export function createVenueOffersHandler(deps: VenueOffersDeps = {}) {
  const env = deps.env ?? ((name: string) => Deno.env.get(name));
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

    // ---- quote / hold: actor key = user, else the browser's cart key ------
    const cartKey = str(body.cartKey);
    const actorKey = caller.userId
      ? await sha256Hex(`user:${caller.userId}`)
      : CART_KEY.test(cartKey)
      ? await sha256Hex(`guest-cart:${cartKey}`)
      : null;

    if (action === "quote") {
      const offeringId = str(body.offeringId);
      const windowId = str(body.windowId);
      const key = str(body.idempotencyKey);
      if (
        !actorKey || !UUID.test(offeringId) || !UUID.test(windowId) ||
        !KEY.test(key) || !Array.isArray(body.lines)
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
      });
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data });
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

    if (action === "get") {
      const { data, error } = await client.rpc("issue_4490_get_offer_booking", {
        p_group_id: groupId,
        p_token_hash: tokenHash,
        p_user_id: caller.userId,
        p_qr_pepper: qrPepper(env),
      });
      if (error) return rpcFailure(error);
      return json(200, { kind: "success", data });
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
      const prepare = () =>
        client.rpc("issue_4490_prepare_offer_payment", {
          p_group_id: groupId,
          p_token_hash: tokenHash,
          p_user_id: caller.userId,
          p_idempotency_key: key,
          p_expected_version: expectedVersion,
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
      const callbackUrl = `${resolveReturnOrigin(env)}/visit/${groupId}?paid=1`;
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
      const { data: fresh, error: readError } = await client.rpc(
        "issue_4490_get_offer_booking",
        {
          p_group_id: groupId,
          p_token_hash: tokenHash,
          p_user_id: caller.userId,
          p_qr_pepper: qrPepper(env),
        },
      );
      if (readError) return rpcFailure(readError);
      return json(200, {
        kind: "success",
        data: { outcome, booking: fresh ?? booking },
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
