// #4490 P6 venue-membership-pay-link — a member pays their month.
//
// POST { action, subscriptionId, token?, ... }. The member's link (the first
// month after joining, and every renewal email) opens the member page
// `/visit/plan/<id>#t=<token>`; that page calls this function. Signed-out
// members send the project anon key and their member token; a signed-in member
// may send their user JWT instead (their own membership only). The database
// stores only SHA-256 of the token and checks the same rule again.
//
//   get             { subscriptionId, token? } -> the member and what is due
//   pay             { subscriptionId, token?, idempotencyKey, channel? } -> the payment
//                   page for the open month (full amount; a month already
//                   paid owes nothing: membership_nothing_to_pay)
//   confirm_return  { subscriptionId, token? } -> asks the provider about the
//                   month's payment when the member comes back and confirms
//                   it through the same finalize the webhook uses
//
// No card is ever charged in the background: a month is paid only here (or
// marked paid at the venue by staff with money rights).
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
import { venueOfferTokenHashHex } from "../_shared/venueOfferBookingToken.ts";
import { VENUE_MEMBER_TOKEN_RE } from "../_shared/venueMembershipToken.ts";
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
const ACTIONS = new Set(["get", "pay", "confirm_return"]);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 60;
const windows = new Map<string, { count: number; resetAt: number }>();

// Codes the member page may show (each maps to plain words on the guest side).
const SAFE_CODES = [
  "membership_not_found",
  "membership_invalid",
  "membership_ended",
  "membership_nothing_to_pay",
  "plan_not_found",
  "offer_payment_already_pending",
  // #4490 06-W4 fix 1 (W4-N3): another device is paying this booking another way.
  "offer_payment_mode_conflict",
  "offer_payment_already_paid",
  "offer_hold_expired",
  "offer_bank_not_ready",
  "offer_amount_too_large",
  "offer_idempotency_conflict",
  "offers_not_enabled",
  "offer_invalid_transition",
];

type RpcError = { message?: string; code?: string; details?: string };
type RpcResult = { data: unknown; error: RpcError | null };
export type PayLinkClient = {
  rpc: (name: string, params: Record<string, unknown>) => Promise<RpcResult>;
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  auth: {
    getUser: (
      jwt: string,
    ) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

export type PayLinkDeps = {
  client?: () => PayLinkClient;
  env?: (name: string) => string | undefined;
  createPaymentSession?: typeof createStayPaymentSession;
  verifyPaystack?: (reference: string) => Promise<Record<string, unknown>>;
  confirmPaystack?: typeof handleStayPaystackChargeSuccess;
};

type Json = Record<string, unknown>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function safeCode(error: RpcError | null | undefined): string {
  const message = error?.message ?? "";
  return SAFE_CODES.find((code) => message === code) ??
    SAFE_CODES.find((code) => message.startsWith(code)) ??
    "membership_request_failed";
}

function statusFor(error: RpcError | null | undefined): number {
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
  return json(code === "membership_request_failed" ? 500 : statusFor(error), {
    code,
  });
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

export function resetPayLinkRateLimitForTests(): void {
  windows.clear();
}

function qrPepper(env: (name: string) => string | undefined): string | null {
  const local = isLocalSupabaseUrl(env("SUPABASE_URL") ?? "");
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

/**
 * The page the member comes back to (no token in it: it stays on the device).
 * #4490 Explorer W4: `channel: "app"` (the Explorer app's first payment)
 * returns to the app's payment-return page `/paid/plan/<subscriptionId>`; any
 * other value, or none, keeps today's address. The origin is always the
 * server's own; the channel never changes what is charged or who may pay.
 */
export function memberReturnUrl(
  env: (name: string) => string | undefined,
  subscriptionId: string,
  channel?: unknown,
): string {
  const origin = resolveVenueVisitOrigin(env);
  return channel === "app"
    ? `${origin}/paid/plan/${subscriptionId}`
    : `${origin}/visit/plan/${subscriptionId}?paid=1`;
}

/**
 * The month's latest pending Paystack payment, asked about at the provider:
 * "paid" (confirmed now through the webhook's finalize), "closed" (failed or
 * left unpaid; marked failed so a new payment may start), "in_flight" or
 * "none".
 */
async function settleEarlierPayment(
  client: PayLinkClient,
  groupId: string,
  deps: PayLinkDeps,
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
  const verify = deps.verifyPaystack ??
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

export function createPayLinkHandler(deps: PayLinkDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
    const body = await req.json().catch(() => null) as Json | null;
    const action = str(body?.action);
    if (!body || !ACTIONS.has(action)) {
      return json(400, { code: "invalid_request" });
    }
    let client: PayLinkClient;
    if (deps.client) {
      client = deps.client();
    } else {
      const url = env("SUPABASE_URL") ?? "";
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!url || !serviceKey) return json(500, { code: "unavailable" });
      client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as PayLinkClient;
    }
    // Who: a verified signed-in member, or the member token.
    const bearer = (req.headers.get("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    let userId: string | null = null;
    if (bearer && jwtRole(bearer) === "authenticated") {
      const { data, error } = await client.auth.getUser(bearer);
      if (error || !data?.user?.id) return json(401, { code: "auth_invalid" });
      userId = data.user.id;
    }
    const ip =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      "unknown";
    if (rateLimited(`${action}:${userId ?? ip}`)) {
      return json(429, { code: "rate_limited" });
    }
    const subscriptionId = str(body.subscriptionId);
    const token = str(body.token);
    if (!UUID.test(subscriptionId)) {
      return json(400, { code: "invalid_request" });
    }
    if (!userId && !VENUE_MEMBER_TOKEN_RE.test(token)) {
      return json(401, { code: "membership_token_required" });
    }
    const tokenHash = VENUE_MEMBER_TOKEN_RE.test(token)
      ? `\\x${await venueOfferTokenHashHex(token)}`
      : null;
    const who = { p_token_hash: tokenHash, p_user_id: tokenHash ? null : userId };

    // #4490 Explorer W1: one pepper rule (venueAppHandoff.ts passPepperFor).
    const [appOnly, handoffOn] = await Promise.all([
      venueFlagOn(client, "VENUE_PASS_APP_ONLY"),
      venueFlagOn(client, "VENUE_APP_HANDOFF"),
    ]);
    const pepper = passPepperFor(qrPepper(env), appOnly, { userId }, tokenHash);
    const read = () =>
      client.rpc("issue_4490_membership_get", {
        p_subscription_id: subscriptionId,
        ...who,
        p_qr_pepper: pepper,
      });

    if (action === "get") {
      const { data, error } = await read();
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

    if (action === "pay") {
      const key = str(body.idempotencyKey);
      if (!KEY.test(key)) return json(400, { code: "invalid_request" });
      const prepare = () =>
        client.rpc("issue_4490_membership_prepare_payment", {
          p_subscription_id: subscriptionId,
          ...who,
          p_idempotency_key: key,
        });
      let { data: prepared, error } = await prepare();
      if (error && safeCode(error) === "offer_payment_already_pending") {
        // The member left an earlier payment page: ask the provider about it.
        const { data: groupId } = await client.rpc(
          "issue_4490_membership_payment_group",
          { p_subscription_id: subscriptionId, ...who },
        );
        if (typeof groupId === "string") {
          const earlier = await settleEarlierPayment(client, groupId, deps);
          if (earlier === "paid") {
            return json(409, { code: "offer_payment_already_paid" });
          }
          if (earlier === "closed") ({ data: prepared, error } = await prepare());
        }
      }
      if (error) return rpcFailure(error);
      const returnUrl = memberReturnUrl(env, subscriptionId, body.channel);
      // #4490 06-W4 fix 1 (W4-N3): this period's payment is already open:
      // its own page again, never a second one.
      const reused = reusedPaymentPage(prepared);
      if (reused) {
        const p = prepared as Json;
        return json(200, {
          kind: "success",
          data: {
            ...reused,
            returnUrl,
            periodId: p.periodId ?? null,
            amountMinor: p.amountMinor ?? null,
            currencyCode: p.currencyCode ?? null,
          },
        });
      }
      try {
        const session = await (deps.createPaymentSession ??
          createStayPaymentSession)(
            prepared as PreparedStayPayment,
            key,
            {},
            { callbackUrl: returnUrl },
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
          return json(502, { code: "membership_payment_ambiguous" });
        }
        await rememberPaymentPage(client, session);
        const p = prepared as Json;
        return json(200, {
          kind: "success",
          data: {
            ...session,
            returnUrl,
            periodId: p.periodId ?? null,
            amountMinor: p.amountMinor ?? null,
            currencyCode: p.currencyCode ?? null,
          },
        });
      } catch (providerError) {
        const providerCode = providerError instanceof Error
          ? providerError.message
          : String(providerError);
        if (providerCode === "stay_payment_already_pending") {
          return json(409, { code: "offer_payment_already_pending" });
        }
        const refused = /^Paystack initialize failed \(4\d\d\)/.test(
          providerCode,
        );
        const attemptId = str((prepared as Json)?.attemptId);
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
          ? json(422, { code: "membership_payment_details_rejected" })
          : json(502, { code: "membership_payment_unavailable" });
      }
    }

    // confirm_return: who may ask = the member (checked by the read).
    const { error: readError } = await read();
    if (readError) return rpcFailure(readError);
    const { data: groupId } = await client.rpc(
      "issue_4490_membership_payment_group",
      { p_subscription_id: subscriptionId, ...who },
    );
    let outcome = "nothing_to_confirm";
    if (typeof groupId === "string") {
      // The provider and reference come from our own attempt row, never the URL.
      const { data: attempt } = await client.from("stay_payment_attempts")
        .select("id, provider, provider_payment_ref, state")
        .eq("group_id", groupId)
        .in("state", ["pending", "succeeded"])
        .order("attempt_ordinal", { ascending: false })
        .limit(1)
        .maybeSingle();
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
    }
    const { data: fresh, error: freshError } = await read();
    if (freshError) return rpcFailure(freshError);
    return json(200, { kind: "success", data: { outcome, member: fresh } });
  };
}

if (import.meta.main) {
  serve(createPayLinkHandler());
}
