/**
 * brandPayoutLedgerService — READ-ONLY ledger reader for the #1180 payout UI.
 *
 * K adds NO backend. The master spec assumed brand-facing read RPCs (the
 * "orch-1274 read-RPC pattern") — they were never built by B–H (all payout
 * RPCs are service_role-only). Instead K reads the ledger TABLES DIRECTLY via
 * supabase-js `.select()`; RLS already grants `authenticated` SELECT gated at
 * `finance_manager` rank on every table (migration 0001 :239-299). No RPC, no
 * migration → honors #1180's no-backend boundary.
 *
 * Below `finance_manager` rank, RLS returns ZERO rows indistinguishably from
 * "no data" — the caller (useBrandPayoutLedger / BrandPayoutBreakdown) reads
 * the caller's rank via useCurrentBrandRole and renders the distinct
 * "limited access" empty state, never "no payouts yet" (SPEC §4.1).
 *
 * Constitution #3 — every query throws on error; nothing returns [] on failure.
 */

import { supabase } from "./supabase";
import type {
  BrandPayoutLedger,
  BrandPayoutReleaseDTO,
  OrganiserPayoutDebtDTO,
  PayoutAdjustmentKind,
  PayoutLedgerAdjustmentDTO,
  PayoutReleaseStatus,
  PayoutTransferLegDTO,
} from "../utils/payoutBreakdown";

// snake_case row shapes as returned by supabase-js from the ledger tables.
interface ReleaseRow {
  id: string;
  brand_id: string;
  event_id: string | null;
  provider: "stripe" | "paystack";
  currency: string;
  status: PayoutReleaseStatus;
  anchor_end_at: string;
  releasable_at: string;
  released_at: string | null;
  gross_cents: number;
  refunded_cents: number;
  disputed_cents: number;
  mingla_fee_cents: number;
  partner_share_cents: number;
  provider_fee_cents: number;
  permanent_debt_withheld_cents: number;
  temporary_debt_withheld_cents: number;
  maturity_recredit_cents: number;
  net_release_cents: number;
  organiser_cash_delivered_cents: number;
  created_at: string;
}

interface LegRow {
  id: string;
  release_id: string;
  kind: "organiser" | "partner";
  principal_cents: number;
  estimated_fee_cents: number;
  stamp_duty_cents: number;
  actual_fee_cents: number | null;
  actual_stamp_duty_cents: number | null;
  fee_variance_cents: number | null;
  status: string;
}

interface AdjustmentRow {
  id: string;
  release_id: string | null;
  brand_id: string;
  currency: string;
  kind: PayoutAdjustmentKind;
  amount_cents: number;
  created_at: string;
}

interface DebtRow {
  id: string;
  brand_id: string;
  currency: string;
  kind: string;
  principal_cents: number;
  recovered_cents: number;
  status: string;
  opened_at: string;
}

const RELEASE_COLUMNS =
  "id,brand_id,event_id,provider,currency,status,anchor_end_at,releasable_at," +
  "released_at,gross_cents,refunded_cents,disputed_cents,mingla_fee_cents," +
  "partner_share_cents,provider_fee_cents,permanent_debt_withheld_cents," +
  "temporary_debt_withheld_cents,maturity_recredit_cents,net_release_cents," +
  "organiser_cash_delivered_cents,created_at";

const LEG_COLUMNS =
  "id,release_id,kind,principal_cents,estimated_fee_cents,stamp_duty_cents," +
  "actual_fee_cents,actual_stamp_duty_cents,fee_variance_cents,status";

const ADJUSTMENT_COLUMNS =
  "id,release_id,brand_id,currency,kind,amount_cents,created_at";

const DEBT_COLUMNS =
  "id,brand_id,currency,kind,principal_cents,recovered_cents,status,opened_at";

const mapRelease = (row: ReleaseRow): BrandPayoutReleaseDTO => ({
  id: row.id,
  brandId: row.brand_id,
  eventId: row.event_id,
  provider: row.provider,
  currency: row.currency,
  status: row.status,
  anchorEndAt: row.anchor_end_at,
  releasableAt: row.releasable_at,
  releasedAt: row.released_at,
  grossCents: row.gross_cents,
  refundedCents: row.refunded_cents,
  disputedCents: row.disputed_cents,
  minglaFeeCents: row.mingla_fee_cents,
  partnerShareCents: row.partner_share_cents,
  providerFeeCents: row.provider_fee_cents,
  permanentDebtWithheldCents: row.permanent_debt_withheld_cents,
  temporaryDebtWithheldCents: row.temporary_debt_withheld_cents,
  maturityRecreditCents: row.maturity_recredit_cents,
  netReleaseCents: row.net_release_cents,
  organiserCashDeliveredCents: row.organiser_cash_delivered_cents,
  createdAt: row.created_at,
});

const mapLeg = (row: LegRow): PayoutTransferLegDTO => ({
  id: row.id,
  releaseId: row.release_id,
  kind: row.kind,
  principalCents: row.principal_cents,
  estimatedFeeCents: row.estimated_fee_cents,
  stampDutyCents: row.stamp_duty_cents,
  actualFeeCents: row.actual_fee_cents,
  actualStampDutyCents: row.actual_stamp_duty_cents,
  feeVarianceCents: row.fee_variance_cents,
  status: row.status,
});

const mapAdjustment = (row: AdjustmentRow): PayoutLedgerAdjustmentDTO => ({
  id: row.id,
  releaseId: row.release_id,
  brandId: row.brand_id,
  currency: row.currency,
  kind: row.kind,
  amountCents: row.amount_cents,
  createdAt: row.created_at,
});

const mapDebt = (row: DebtRow): OrganiserPayoutDebtDTO => ({
  id: row.id,
  brandId: row.brand_id,
  currency: row.currency,
  kind: row.kind,
  principalCents: row.principal_cents,
  recoveredCents: row.recovered_cents,
  status: row.status,
  openedAt: row.opened_at,
});

/**
 * Fetch the full payout ledger for one brand. Newest-first releases; legs
 * grouped by release_id; refund/adjustment + open-debt history alongside.
 * RLS scopes rows to finance_manager+ callers — below that rank every read
 * returns zero rows (a real UX branch, handled by the caller).
 */
export async function fetchBrandPayoutLedger(
  brandId: string,
): Promise<BrandPayoutLedger> {
  const releasesRes = await supabase
    .from("brand_payout_releases")
    .select(RELEASE_COLUMNS)
    .eq("brand_id", brandId)
    .order("releasable_at", { ascending: false })
    .returns<ReleaseRow[]>();
  if (releasesRes.error) throw releasesRes.error;
  const releases = (releasesRes.data ?? []).map(mapRelease);

  const legsByRelease: Record<string, PayoutTransferLegDTO[]> = {};
  const releaseIds = releases.map((r) => r.id);
  if (releaseIds.length > 0) {
    const legsRes = await supabase
      .from("payout_transfer_legs")
      .select(LEG_COLUMNS)
      .in("release_id", releaseIds)
      .returns<LegRow[]>();
    if (legsRes.error) throw legsRes.error;
    for (const legRow of legsRes.data ?? []) {
      const leg = mapLeg(legRow);
      (legsByRelease[leg.releaseId] ??= []).push(leg);
    }
  }

  const adjustmentsRes = await supabase
    .from("payout_ledger_adjustments")
    .select(ADJUSTMENT_COLUMNS)
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .returns<AdjustmentRow[]>();
  if (adjustmentsRes.error) throw adjustmentsRes.error;
  const adjustments = (adjustmentsRes.data ?? []).map(mapAdjustment);

  const debtsRes = await supabase
    .from("organiser_payout_debts")
    .select(DEBT_COLUMNS)
    .eq("brand_id", brandId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .returns<DebtRow[]>();
  if (debtsRes.error) throw debtsRes.error;
  const openDebts = (debtsRes.data ?? []).map(mapDebt);

  return { releases, legsByRelease, adjustments, openDebts };
}
