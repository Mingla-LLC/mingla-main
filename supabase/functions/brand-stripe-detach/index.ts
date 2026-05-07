import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeDetach, STRIPE_API_VERSION } from "../_shared/stripe.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  corsHeaders,
  dispatchNotification,
  getBrandPaymentManagerUserIds,
  isValidUuid,
  jsonResponse,
  requirePaymentsManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: { brand_id?: string; brandId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  const brandId = body.brand_id ?? body.brandId;
  if (!isValidUuid(brandId)) {
    return jsonResponse({ error: "validation_error", detail: "brand_id_invalid_uuid" }, 400);
  }

  const supabase = serviceRoleClient();
  const forbidden = await requirePaymentsManager(supabase, brandId, userId);
  if (forbidden) return forbidden;

  const { data: row, error: readError } = await supabase
    .from("stripe_connect_accounts")
    .select("id, stripe_account_id, detached_at")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (readError) {
    console.error("[brand-stripe-detach] read failed:", readError);
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
        idempotencyKey: generateIdempotencyKey(brandId, "detach_account"),
      });
    } catch (err) {
      stripeDeleteError = err instanceof Error ? err.message : String(err);
      console.warn("[brand-stripe-detach] Stripe account delete rejected:", stripeDeleteError);
    }
  }

  const detachedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("stripe_connect_accounts")
    .update({ detached_at: detachedAt, updated_at: detachedAt })
    .eq("brand_id", brandId);
  if (updateError) {
    console.error("[brand-stripe-detach] soft detach failed:", updateError);
    return jsonResponse({ error: "internal_error", detail: "local_detach_failed" }, 500);
  }

  const action = stripeDeleteError
    ? "stripe_connect.detach_local_success_stripe_rejected"
    : "stripe_connect.detach_completed";
  await writeAudit(supabase, {
    user_id: userId,
    brand_id: brandId,
    action,
    target_type: "stripe_connect_account",
    target_id: stripeAccountId,
    before: { detached_at: row.detached_at ?? null },
    after: { detached_at: detachedAt, stripe_delete_error: stripeDeleteError },
  });

  const userIds = await getBrandPaymentManagerUserIds(supabase, brandId);
  for (const managerId of userIds) {
    await dispatchNotification({
      userId: managerId,
      brandId,
      type: "stripe.detach_completed",
      title: "Stripe disconnected",
      body: "Stripe payouts have been disconnected for this brand.",
      relatedId: stripeAccountId,
      relatedType: "stripe_connect_account",
      idempotencyKey: `stripe.detach_completed:${stripeAccountId}:${managerId}`,
      deepLink: `mingla-business://brand/${brandId}/payments`,
    });
  }

  return jsonResponse({
    ok: true,
    status: "detached",
    stripe_delete_error: stripeDeleteError,
  });
});
