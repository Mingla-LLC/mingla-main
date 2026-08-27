// Issue #2097 — dry-run-first historical fee-refund reconciliation planner.
// Provider access is injected and MUST be read-only. This module cannot create,
// refund, update, or delete a Stripe object.

import { canonicalProviderInteger } from "../_shared/issue2097TicketRefundTruth.ts";

export type HistoricalClassification =
  | { status: "not_applicable"; amountText: "0"; feeRefundIds: readonly string[] }
  | { status: "succeeded_positive"; amountText: string; feeRefundIds: readonly string[] }
  | { status: "unknown_legacy" | "evidence_conflict"; amountText: null; feeRefundIds: readonly string[] };

export interface HistoricalProviderEvidence {
  provider: "stripe" | "paystack";
  exactNoFee: boolean;
  applicationFeeId: string | null;
  applicationFeeAmount: unknown;
  applicationFeeAmountRefunded: unknown;
  feeRefunds: readonly { id: string; fee: string; amount: unknown; currency: string }[];
  currency: string;
  complete: boolean;
  ambiguous: boolean;
}

export function classifyHistoricalFeeRefund(
  evidence: HistoricalProviderEvidence,
): HistoricalClassification {
  if (!evidence.complete || evidence.ambiguous) {
    return { status: evidence.ambiguous ? "evidence_conflict" : "unknown_legacy", amountText: null, feeRefundIds: [] };
  }
  if (evidence.provider === "paystack" || evidence.exactNoFee) {
    return { status: "not_applicable", amountText: "0", feeRefundIds: [] };
  }
  const original = canonicalProviderInteger(evidence.applicationFeeAmount);
  const cumulative = canonicalProviderInteger(evidence.applicationFeeAmountRefunded);
  if (!evidence.applicationFeeId || !original || !cumulative || BigInt(original) <= 0n) {
    return { status: "unknown_legacy", amountText: null, feeRefundIds: [] };
  }
  const ids = new Set<string>();
  let total = 0n;
  for (const row of evidence.feeRefunds) {
    const amount = canonicalProviderInteger(row.amount);
    if (!amount || BigInt(amount) <= 0n || row.fee !== evidence.applicationFeeId ||
      row.currency.toLowerCase() !== evidence.currency.toLowerCase() || ids.has(row.id)) {
      return { status: "evidence_conflict", amountText: null, feeRefundIds: [...ids] };
    }
    ids.add(row.id);
    total += BigInt(amount);
  }
  if (ids.size === 0 || total !== BigInt(cumulative) || total > BigInt(original)) {
    return { status: ids.size > 0 ? "evidence_conflict" : "unknown_legacy", amountText: null, feeRefundIds: [...ids] };
  }
  return { status: "succeeded_positive", amountText: total.toString(), feeRefundIds: [...ids].sort() };
}

export interface HistoricalRow { id: string; providerMode: "test" | "live" }
export interface HistoricalPlanRow extends HistoricalRow { classification: HistoricalClassification }

export async function buildHistoricalReconciliationPlan(input: {
  rows: readonly HistoricalRow[];
  mode: "test" | "live";
  resumeAfter?: string;
  limit: number;
  readEvidence: (row: HistoricalRow) => Promise<HistoricalProviderEvidence>;
}): Promise<{ dryRun: true; nextCursor: string | null; rows: HistoricalPlanRow[] }> {
  const selected = input.rows.filter((row) => row.providerMode === input.mode &&
    (!input.resumeAfter || row.id > input.resumeAfter)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, input.limit);
  const rows: HistoricalPlanRow[] = [];
  for (const row of selected) {
    rows.push({ ...row, classification: classifyHistoricalFeeRefund(await input.readEvidence(row)) });
  }
  return { dryRun: true, nextCursor: rows.at(-1)?.id ?? null, rows };
}

export async function applyApprovedHistoricalPlan(input: {
  plan: { dryRun: true; rows: readonly HistoricalPlanRow[] };
  approvedIds: ReadonlySet<string>;
  writeClassification: (row: HistoricalPlanRow) => Promise<void>;
}): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;
  for (const row of input.plan.rows) {
    if (!input.approvedIds.has(row.id) || row.classification.status === "unknown_legacy") {
      skipped += 1;
      continue;
    }
    await input.writeClassification(row);
    applied += 1;
  }
  return { applied, skipped };
}
