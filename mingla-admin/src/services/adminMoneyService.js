/**
 * ORCH-1274 [Admin Money console — READ-ONLY] — money read service.
 *
 * The SINGLE data authority for the Payments / Orders / Money-ledger consoles +
 * the subscriber-context card. READ-ONLY by contract: it exposes zero
 * .update / .insert / .delete and takes NO direct .from(<money table>) read —
 * every money read flows through an `admin_*` SECURITY DEFINER RPC gated on
 * is_admin_user() (I-PROPOSED-1274-MONEY-READ-VIA-DEFINER-RPC). Money is integer
 * cents + a currency code — this service never formats currency (the pages do,
 * client-side). Wave-2 act-RPCs (refund / Connect refresh / dispute resolve) are
 * deferred and ride the ORCH-1271 adminWriteService, not this file.
 *
 * Contract per the EntityListView / EntityDetailView shells:
 *   - list fns map fetchPage({search,filters,page,pageSize}) → RPC params and
 *     return { rows, total } (throwing on error so EntityListView renders the
 *     error+retry state; default { rows:[], total:0 } on a null payload).
 *   - detail fns return the raw supabase.rpc { data, error } so the page can
 *     branch on error.message ('not_authorized' | 'not_found' | network).
 */

import { supabase } from "../lib/supabase";

// ── Connect status (Payments) ─────────────────────────────────────────────────

/** Per-brand Stripe Connect status list. Filters: status, provider. */
export async function listBrandStripeStatus({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_brand_stripe_status", {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_provider_filter: filters.provider || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load payment status.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/** Full Connect-status bundle for one brand (requirements jsonb + external accounts). */
export async function getBrandStripeStatus(brandId) {
  return supabase.rpc("admin_get_brand_stripe_status", { p_brand_id: brandId });
}

// ── Orders ────────────────────────────────────────────────────────────────────

/** Orders list. Filters: status (payment_status), brandId. */
export async function listOrders({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_orders", {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_brand_id: filters.brandId || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load orders.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/** Full order detail bundle (event + brand + line items + installments + refunds + split). */
export async function getOrder(orderId) {
  return supabase.rpc("admin_get_order", { p_order_id: orderId });
}

// ── Refunds / disputes / payouts / platform revenue (Money ledger) ─────────────

/** Refunds list. Filters: status. */
export async function listRefunds({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_refunds", {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load refunds.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/** Disputes list (soonest-evidence-due first). Filters: status. */
export async function listDisputes({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_disputes", {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load disputes.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/** Full dispute detail bundle (linked order + brand + raw event). */
export async function getDispute(disputeId) {
  return supabase.rpc("admin_get_dispute", { p_dispute_id: disputeId });
}

/** Payouts list. Filters: status, brandId. */
export async function listPayouts({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_payouts", {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_brand_id: filters.brandId || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load payouts.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/** Platform application-fee revenue log. */
export async function listRevenueLog({ search, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_revenue_log", {
    p_search: search || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load platform revenue.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

// ── Subscription support context ──────────────────────────────────────────────

/** One user's tier / effective tier / active override / override history bundle. */
export async function getSubscriptionDetail(userId) {
  return supabase.rpc("admin_get_subscription_detail", { p_user_id: userId });
}
