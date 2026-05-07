import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeBalances, STRIPE_API_VERSION } from "../_shared/stripe.ts";
import { generateIdempotencyKey } from "../_shared/idempotency.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  corsHeaders,
  isValidUuid,
  jsonResponse,
  requirePaymentsManager,
  requireUserId,
  serviceRoleClient,
} from "../_shared/stripeEdgeAuth.ts";

function sumCurrency(entries: Array<{ amount?: number; currency?: string }>, currency: string) {
  return entries
    .filter((entry) => entry.currency === currency)
    .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
}

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

  const { data: account, error: accountError } = await supabase
    .from("stripe_connect_accounts")
    .select("stripe_account_id, default_currency, detached_at")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (accountError) {
    console.error("[brand-stripe-balances] account read failed:", accountError);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!account || account.detached_at) {
    return jsonResponse({
      availableMinor: 0,
      pendingMinor: 0,
      currency: "GBP",
      allCurrencies: { available: [], pending: [] },
    });
  }

  const displayCurrency = String(account.default_currency ?? "GBP").trim().toLowerCase();
  let balance;
  try {
    const stripe = stripeBalances();
    // @ts-ignore — Stripe SDK request options support connected-account headers.
    balance = await stripe.balance.retrieve(
      {},
      {
        stripeAccount: account.stripe_account_id,
        apiVersion: STRIPE_API_VERSION,
        idempotencyKey: generateIdempotencyKey(brandId, "balance_retrieve"),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brand-stripe-balances] Stripe balance failed:", message);
    return jsonResponse({ error: "stripe_api_error", detail: message }, 502);
  }

  await writeAudit(supabase, {
    user_id: userId,
    brand_id: brandId,
    action: "stripe_connect.balance_retrieved",
    target_type: "stripe_connect_account",
    target_id: account.stripe_account_id,
    after: { display_currency: displayCurrency.toUpperCase() },
  });

  return jsonResponse({
    availableMinor: sumCurrency(balance.available ?? [], displayCurrency),
    pendingMinor: sumCurrency(balance.pending ?? [], displayCurrency),
    currency: displayCurrency.toUpperCase(),
    allCurrencies: {
      available: balance.available ?? [],
      pending: balance.pending ?? [],
    },
  });
});
