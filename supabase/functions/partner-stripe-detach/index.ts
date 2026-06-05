/**
 * partner-stripe-detach — soft-detaches the caller's partner Stripe account.
 *
 * Mirrors brand-stripe-detach but keyed on creator_accounts.id
 * (auth.uid()) + partner_stripe_connect_accounts (no brand_id, no
 * payments-manager gate — the row is self-owned).
 *
 * Effects:
 *   1. Attempts `accounts.del(stripe_account_id)` on the platform's behalf
 *      via STRIPE_RAK_DETACH. Errors are logged + reported in the response
 *      but DO NOT block the local detach (matches brand behavior).
 *   2. Sets partner_stripe_connect_accounts.detached_at = NOW().
 *   3. Writes an audit log.
 *   4. Dispatches a self-notification.
 *
 * The Stripe account itself isn't really deleted (Stripe v2 accounts can't
 * be fully deleted with money on them); the soft-detach unlinks Mingla
 * from it so the partner can re-onboard with a different country/account.
 *
 * Cites https://docs.stripe.com/api/accounts/delete.md.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeDetach, STRIPE_API_VERSION } from "../_shared/stripe.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  corsHeaders,
  dispatchNotification,
  jsonResponse,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  const supabase = serviceRoleClient();

  // Gate: must be a flagged partner. Mirrors partner-stripe-onboard /
  // partner-stripe-account-session entry checks.
  const { data: account, error: accountErr } = await supabase
    .from("creator_accounts")
    .select("id, partner_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (accountErr) {
    console.error("[partner-stripe-detach] account read failed:", accountErr);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!account || account.partner_enabled !== true) {
    return jsonResponse({ error: "forbidden", detail: "not_a_partner" }, 403);
  }

  const { data: row, error: readError } = await supabase
    .from("partner_stripe_connect_accounts")
    .select("id, stripe_account_id, detached_at")
    .eq("account_id", userId)
    .maybeSingle();
  if (readError) {
    console.error("[partner-stripe-detach] row read failed:", readError);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!row) {
    return jsonResponse({ ok: true, status: "not_connected" });
  }

  const stripeAccountId = row.stripe_account_id as string;
  let stripeDeleteError: string | null = null;
  if (!row.detached_at) {
    try {
      const stripe = stripeDetach();
      // @ts-ignore — Stripe SDK accounts namespace is runtime-provided.
      await stripe.accounts.del(stripeAccountId, {
        apiVersion: STRIPE_API_VERSION,
        idempotencyKey: generateIdempotencyKey(
          userId,
          `partner_detach_account:${stripeAccountId}`,
        ),
      });
    } catch (err) {
      stripeDeleteError = err instanceof Error ? err.message : String(err);
      console.warn(
        "[partner-stripe-detach] Stripe account delete rejected:",
        stripeDeleteError,
      );
    }
  }

  const detachedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("partner_stripe_connect_accounts")
    .update({ detached_at: detachedAt, updated_at: detachedAt })
    .eq("account_id", userId);
  if (updateError) {
    console.error("[partner-stripe-detach] soft detach failed:", updateError);
    return jsonResponse(
      { error: "internal_error", detail: "local_detach_failed" },
      500,
    );
  }

  const action = stripeDeleteError
    ? "partner_stripe_connect.detach_local_success_stripe_rejected"
    : "partner_stripe_connect.detach_completed";
  await writeAudit(supabase, {
    user_id: userId,
    brand_id: null,
    action,
    target_type: "partner_stripe_connect_account",
    target_id: stripeAccountId,
    before: { detached_at: row.detached_at ?? null },
    after: { detached_at: detachedAt, stripe_delete_error: stripeDeleteError },
  });

  // ORCH-1082 Gap 17: re-prefix the type from `partner_stripe.detach_completed`
  // to `stripe.partner_detach_completed` so notify-dispatch's resolveOneSignalApp
  // (push-utils.ts) routes it to the BUSINESS OneSignal app — a partner is a
  // business-app user, and the old `partner_stripe.` prefix matched neither
  // `business.` nor `stripe.`, so it fell to the consumer app and reached nobody.
  // There is no cross-app send in OneSignal.
  //   - https://documentation.onesignal.com/docs/keys-and-ids
  // The deep link is also corrected to the real route `/partner/earnings`
  // (mingla-business/app/partner/earnings.tsx); the prior account-tab partner
  // deep link had no route file + no parser head, so the tap fell to /(tabs)/account.
  await dispatchNotification({
    userId,
    brandId: null,
    type: "stripe.partner_detach_completed",
    title: "Stripe disconnected",
    body: "Your partner Stripe account is no longer linked. Reconnect anytime from Partner Earnings.",
    relatedId: stripeAccountId,
    relatedType: "partner_stripe_connect_account",
    idempotencyKey: `stripe.partner_detach_completed:${stripeAccountId}:${userId}`,
    deepLink: "mingla-business://partner/earnings",
  });

  return jsonResponse({
    ok: true,
    status: "detached",
    stripe_delete_error: stripeDeleteError,
  });
});
