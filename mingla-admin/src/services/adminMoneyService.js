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
import { filterByReadiness, withReadiness } from "../lib/paymentReadiness";

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

// ── Payment readiness (Payments page; Brands page reuses it) — #4130 Wave 2a ──

/**
 * Every live brand with a payment setup or the Paystack provider, with the
 * facts admin_list_brand_payment_readiness returns AND the verdict from
 * lib/paymentReadiness.js attached as `row.readiness`. Search matches brand
 * name, slug, Stripe account id, Paystack subaccount or recipient code.
 * Throws on error (pages show LoadError, never an empty list).
 */
export async function fetchPaymentReadinessRows(search = null) {
  const { data, error } = await supabase.rpc("admin_list_brand_payment_readiness", {
    p_search: search || null,
  });
  if (error) throw new Error(error.message || "Failed to load payment readiness.");
  return withReadiness(data?.rows ?? []);
}

/** EntityListView fetchPage over the readiness rows: provider and readiness filters, client pages. */
export async function listBrandPaymentReadiness({ search, filters = {}, page = 0, pageSize = 25 }) {
  const rows = filterByReadiness(await fetchPaymentReadinessRows(search), {
    provider: filters.provider || "all",
    readiness: filters.readiness || "all",
  });
  return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length };
}

// ── Mingla money (#4130 Wave 2a) ──────────────────────────────────────────────

/** Mingla money summary for [from, to) (ISO strings or null = all time / now). */
export async function getMinglaMoneySummary(from = null, to = null) {
  const { data, error } = await supabase.rpc("admin_mingla_money_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message || "Failed to load Mingla money.");
  if (!data || typeof data !== "object") throw new Error("Mingla money came back empty.");
  return data;
}

/** Orders page cards: paid orders all time, discounts (discounted orders only), margin. */
export async function getOrdersOverview(from = null, to = null) {
  const { data, error } = await supabase.rpc("admin_orders_overview", { p_from: from, p_to: to });
  if (error) throw new Error(error.message || "Failed to load the order totals.");
  if (!data || typeof data !== "object") throw new Error("The order totals came back empty.");
  return data;
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

/** Read-only 30-day discount and margin rollup, grouped by currency. */
export async function getDiscountMarginSummary(from, to) {
  const { data, error } = await supabase.rpc("admin_discount_margin_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message || "Failed to load discount margins.");
  return Array.isArray(data) ? data : [];
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

/**
 * #4130 Wave 2a — Stripe and Paystack disputes in one list, evidence due
 * first. Both lists are read in full (up to DISPUTES_CAP each) and merged
 * here, so search, filters, paging and export cover both providers.
 * `filters.status` is "open" (anything not won, lost or resolved) or "closed".
 */
export const DISPUTES_CAP = 500;

function unifiedDispute(row, provider) {
  if (provider === "stripe") {
    return {
      ...row,
      provider,
      key: `stripe:${row.id}`,
      amount_cents: row.amount,
      reference: row.stripe_charge_id || row.stripe_dispute_id || null,
      due_at: row.evidence_due_by || null,
      state: row.status || null,
      closed: ["won", "lost", "charge_refunded", "warning_closed"].includes(row.status),
    };
  }
  return {
    ...row,
    provider,
    key: `paystack:${row.id}`,
    reference: row.transaction_reference || row.paystack_dispute_id || null,
    due_at: row.internal_deadline_at || row.response_due_by || null,
    state: row.evidence_state || row.status || null,
    closed: Boolean(row.is_resolved) || row.evidence_state === "resolved",
  };
}

export async function listAllDisputes({ search, filters = {}, page = 0, pageSize = 25 }) {
  const [stripe, paystack] = await Promise.all([
    listDisputes({ search, filters: {}, page: 0, pageSize: DISPUTES_CAP }),
    listPaystackDisputes({ search, filters: {}, page: 0, pageSize: DISPUTES_CAP }),
  ]);
  let rows = [
    ...stripe.rows.map((r) => unifiedDispute(r, "stripe")),
    ...paystack.rows.map((r) => unifiedDispute(r, "paystack")),
  ];
  if (filters.status === "open") rows = rows.filter((r) => !r.closed);
  if (filters.status === "closed") rows = rows.filter((r) => r.closed);
  if (filters.provider) rows = rows.filter((r) => r.provider === filters.provider);
  rows.sort((a, b) => {
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    const da = a.due_at ? new Date(a.due_at).getTime() : Infinity;
    const db = b.due_at ? new Date(b.due_at).getTime() : Infinity;
    return da - db;
  });
  return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length };
}

/** Full dispute detail bundle (linked order + brand + raw event). */
export async function getDispute(disputeId) {
  return supabase.rpc("admin_get_dispute", { p_dispute_id: disputeId });
}

/** #3645 — past-expiry Paystack (mingla_*) checkouts with no order yet. */
export async function listPaidWithoutTicket({ pageSize = 50 } = {}) {
  const { data, error } = await supabase.rpc("admin_list_paid_without_ticket", {
    p_limit: pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load paid-without-ticket rows.");
  return { rows: data ?? [], total: (data ?? []).length };
}

/**
 * Paystack disputes list (#3645 WS5; Paystack = Mingla MoR, so the evidence
 * clock is Mingla's). Soonest internal deadline first, resolved last. Filter
 * `status` matches the evidence state (needs_review | reviewed | exported |
 * submitted_stub | resolved) or the raw Paystack status.
 */
export async function listPaystackDisputes({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_paystack_disputes", {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load Paystack disputes.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/** Paystack dispute detail: dispute + brand + live evidence dossier + sha256 + evidence log. */
export async function getPaystackDispute(disputeId) {
  return supabase.rpc("admin_get_paystack_dispute", { p_dispute_id: disputeId });
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
  return { rows: data?.rows ?? [], total: data?.total ?? 0, summary: data?.summary ?? null };
}

/** Unified Stripe + Paystack payout console headline totals. */
export async function getPayoutSummary() {
  const { data, error } = await supabase.rpc("admin_list_payouts", {
    p_search: null,
    p_status_filter: null,
    p_brand_id: null,
    p_limit: 1,
    p_offset: 0,
  });
  if (error) throw new Error(error.message || "Failed to load payout summary.");
  return data?.summary ?? null;
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

/** #3872 R2 — referral-payee share, payout, debt and risk-hold ledger. */
export async function listPayeeLedger({ search, filters = {}, page = 0, pageSize = 25 }) {
  // #3872: every payee kind (referral, gig_fee, local_month). The kind filter
  // is sent as p_kind_filter only when one is chosen; a server without that
  // parameter is answered by filtering the returned page here instead.
  const base = {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_rail_filter: filters.rail || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  };
  const kind = filters.kind || null;
  let { data, error } = await supabase.rpc("admin_list_payee_ledger", kind ? { ...base, p_kind_filter: kind } : base);
  let filterHere = false;
  if (error && kind && (error.code === "PGRST202" || error.code === "42883")) {
    ({ data, error } = await supabase.rpc("admin_list_payee_ledger", base));
    filterHere = true;
  }
  if (error) throw new Error("Couldn't load the payee ledger. Try again.");
  const rows = data?.rows ?? [];
  if (!filterHere) return { rows, total: data?.total ?? 0 };
  const kept = rows.filter((row) => (row.payee_kind ?? "referral") === kind);
  return { rows: kept, total: kept.length };
}

// ── Organiser payout debts + per-brand payout console (#3645 PR9) ─────────────

/**
 * Organiser payout debt list (read-only). Filters: status (open|closed|converted),
 * brandId. Returns { rows, total } with integer cents + currency per row.
 */
export async function listOrganiserPayoutDebts({ search, filters = {}, page = 0, pageSize = 25 }) {
  const { data, error } = await supabase.rpc("admin_list_organiser_payout_debts", {
    p_search: search || null,
    p_status_filter: filters.status || null,
    p_brand_id: filters.brandId || null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) throw new Error(error.message || "Failed to load organiser debts.");
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/** Per-brand payout console bundle: pause state, balances, next payout, debts, history. */
export async function getBrandPayoutConsole(brandId) {
  const [legacy, unified] = await Promise.all([
    supabase.rpc("admin_get_brand_payout_console", { p_brand_id: brandId }),
    supabase.rpc("admin_list_payouts", {
      p_search: null,
      p_status_filter: null,
      p_brand_id: brandId,
      p_limit: 25,
      p_offset: 0,
    }),
  ]);
  if (legacy.error) return legacy;
  if (unified.error) return unified;
  return {
    data: {
      ...legacy.data,
      payout_screen_rows: unified.data?.rows ?? [],
      payout_screen_summary: unified.data?.summary ?? null,
    },
    error: null,
  };
}

// ── Subscription support context ──────────────────────────────────────────────

/** One user's tier / effective tier / active override / override history bundle. */
export async function getSubscriptionDetail(userId) {
  return supabase.rpc("admin_get_subscription_detail", { p_user_id: userId });
}
