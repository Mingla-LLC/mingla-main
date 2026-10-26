// Issue #3872 — the one browser caller for the Programs pages (Creators, Gigs,
// Mingla Locals, Disputes, budget ranges). Every call returns data or throws;
// a write that answers {ok:false, error} is thrown as a failure so a page can
// never show a success for it.

import { supabase } from "../lib/supabase";

export class ProgramWriteError extends Error {
  constructor(result) {
    super(typeof result?.error === "string" ? result.error : "write_failed");
    this.error = result?.error ?? "write_failed";
    this.field = result?.field ?? null;
    this.result = result;
  }
}

async function read(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}

async function write(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  if (data && typeof data === "object" && data.ok === false) throw new ProgramWriteError(data);
  return data;
}

// ── Creators ────────────────────────────────────────────────────────────────

export async function listCreatorQueue(status = "needs_person") {
  const rows = await read("admin_creator_queue", { p_status: status });
  return Array.isArray(rows) ? rows : [];
}

export function decideCreator(creatorId, decision, note) {
  return write("admin_creator_decide", {
    p_creator_id: creatorId,
    p_decision: decision,
    p_note: note && note.trim() ? note.trim() : null,
  });
}

// ── Gigs ────────────────────────────────────────────────────────────────────

// Not in the #3872 walkthrough contract: the read-only gigs list needs an
// admin-wide list of contracts. Until the server ships it the page says so.
export async function listGigContracts() {
  const rows = await read("admin_gig_list");
  return Array.isArray(rows) ? rows : Array.isArray(rows?.rows) ? rows.rows : [];
}

export function getContractWorkspace(contractId) {
  return read("gig_contract_workspace", { p_contract_id: contractId });
}

export async function getGigQueue() {
  const data = await read("admin_gig_queue");
  return { disputes: data?.disputes ?? [], creator_reviews: data?.creator_reviews ?? [] };
}

/**
 * Decide an escalated dispute. The edge function records the decision through
 * gig_dispute_admin_decide and then moves the money (release or refund).
 */
export async function decideDispute({ disputeId, outcome, refundBps, note }) {
  const { data, error } = await supabase.functions.invoke("gig-dispute-resolve", {
    body: {
      dispute_id: disputeId,
      outcome,
      refund_bps: outcome === "partial_refund" ? refundBps : null,
      note: note && note.trim() ? note.trim() : null,
    },
  });
  if (error) {
    let body = null;
    try { body = await error.context?.json?.(); } catch { body = null; }
    throw new ProgramWriteError({ error: body?.detail ?? body?.error ?? "write_failed" });
  }
  if (data && data.ok === false) throw new ProgramWriteError(data);
  return data;
}

// ── Budget ranges ───────────────────────────────────────────────────────────

export async function listBudgetBands() {
  const { data, error } = await supabase
    .from("gig_budget_bands")
    .select("currency,band,min_minor,max_minor,updated_at")
    .order("currency")
    .order("band");
  if (error) throw error;
  return data ?? [];
}

export function saveBudgetBand({ currency, band, minMinor, maxMinor }) {
  return write("admin_budget_band_save", {
    p_currency: currency,
    p_band: band,
    p_min_minor: minMinor,
    p_max_minor: maxMinor,
  });
}

// ── Mingla Locals ───────────────────────────────────────────────────────────

export async function getLocalQueue() {
  const data = await read("admin_local_queue");
  return {
    cities: data?.cities ?? [],
    programs: data?.programs ?? [],
    applications: data?.applications ?? [],
    picks: data?.picks ?? [],
    reviews: data?.reviews ?? [],
    payouts: data?.payouts ?? [],
  };
}

export function saveCityProgram({ cityId, seats, isOpen, monthlyRateMinor, payoutCurrency }) {
  return write("local_city_program_save", {
    p_city_id: cityId,
    p_seats: Number(seats),
    p_is_open: Boolean(isOpen),
    p_monthly_rate_minor: monthlyRateMinor,
    p_payout_currency: payoutCurrency,
  });
}

export function decideLocalApplication(applicationId, status, agreementVersion) {
  return write("local_application_decide", {
    p_application_id: applicationId,
    p_status: status,
    p_agreement_version: status === "accepted" ? agreementVersion.trim() : null,
  });
}

export function decideLocalReview(localMonthId, decision, reasons) {
  return write("local_review_decide", {
    p_local_month_id: localMonthId,
    p_decision: decision,
    p_reasons: decision === "changes_requested" ? reasons : [],
  });
}

export function voidLocalMonth(localMonthId, reason) {
  return write("local_month_void", { p_local_month_id: localMonthId, p_reason: reason.trim() });
}

export async function prepareLocalPayout(localMonthId) {
  const { data, error } = await supabase.functions.invoke("local-payout", { body: { local_month_id: localMonthId } });
  if (error) throw new ProgramWriteError({ error: "write_failed" });
  if (data && data.ok === false) throw new ProgramWriteError(data);
  return data;
}
