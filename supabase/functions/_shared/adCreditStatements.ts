/**
 * #4238 W4b (amendment B §10b): Host ad credit receipts and monthly
 * statements, built from ad_credit_ledger only (no new table).
 *
 * VAT: whether VAT is due on the 15% Mingla fee, and whether receipts must
 * show VAT and a tax ID, is Seth's or finance's decision (decision 10).
 * Until it is made, receipts carry NO VAT line: VAT_ON_AD_FEE is null and
 * every receipt says vat: "not_shown_pending_decision". The fee maths in
 * adMoney.ts is untouched.
 */

import { HOST_FEE_RATIO } from "./adMoney.ts";

/** null = not decided. Do not set without Seth's or finance's answer. */
export const VAT_ON_AD_FEE: null | { rate_bps: number; inclusive: boolean } =
  null;

export type LedgerRow = {
  id: string;
  entry_kind: string;
  amount_cents: number;
  fee_cents?: number | null;
  pay_cents?: number | null;
  refund_cents?: number | null;
  balance_after_cents: number;
  currency: string;
  campaign_id?: string | null;
  external_ref?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type AdCreditReceipt = {
  ledger_id: string;
  kind: string;
  date: string;
  reference: string;
  currency: string;
  /** What the Host paid (top-up) — pay terms. */
  you_paid_cents: number | null;
  mingla_fee_cents: number | null;
  mingla_fee_rate: number | null;
  ad_credit_cents: number;
  /** What went back to the Host's card or bank (withdrawal). */
  refunded_cents: number | null;
  balance_after_cents: number;
  vat: "not_shown_pending_decision";
};

const num = (value: unknown): number | null => {
  const n = Number(value);
  return value === null || value === undefined || !Number.isFinite(n)
    ? null
    : Math.trunc(n);
};

export function buildAdCreditReceipt(row: LedgerRow): AdCreditReceipt {
  const isTopUp = row.entry_kind === "top_up";
  return {
    ledger_id: row.id,
    kind: row.entry_kind,
    date: row.created_at,
    reference: row.external_ref?.trim() || row.id,
    currency: row.currency.trim().toUpperCase(),
    you_paid_cents: isTopUp ? num(row.pay_cents) : null,
    mingla_fee_cents: isTopUp ? (num(row.fee_cents) ?? 0) : null,
    mingla_fee_rate: isTopUp ? HOST_FEE_RATIO : null,
    ad_credit_cents: Math.abs(Math.trunc(row.amount_cents)),
    refunded_cents: row.entry_kind === "withdraw" ? num(row.refund_cents) : null,
    balance_after_cents: row.balance_after_cents,
    vat: "not_shown_pending_decision",
  };
}

export type AdCreditStatement = {
  month: string;
  currency: string | null;
  opening_balance_cents: number;
  top_ups_cents: number;
  fees_cents: number;
  spend_by_ad: { ad_key: string; held_cents: number; returned_cents: number; net_cents: number }[];
  returns_cents: number;
  withdrawals_cents: number;
  closing_balance_cents: number;
  lines: AdCreditReceipt[];
  vat: "not_shown_pending_decision";
};

/** "2026-11" → [start, end) ISO bounds, or null. */
export function statementMonthBounds(month: unknown): [string, string] | null {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return null;
  }
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 1));
  return [start.toISOString(), end.toISOString()];
}

/**
 * Opening = the balance after the last entry before the month (0 if none).
 * Closing = the balance after the month's last entry (= opening if none).
 * Every figure is read from the ledger; nothing is recomputed from fees.
 */
export function buildAdCreditStatement(input: {
  month: string;
  before: LedgerRow | null;
  rows: readonly LedgerRow[];
}): AdCreditStatement {
  const rows = [...input.rows].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  );
  const opening = input.before?.balance_after_cents ?? 0;
  let topUps = 0, fees = 0, returns = 0, withdrawals = 0;
  const byAd = new Map<string, { held: number; returned: number }>();
  const adKey = (row: LedgerRow) =>
    String(
      (row.metadata as { plan_id?: unknown } | null)?.plan_id ??
        row.campaign_id ?? "unknown",
    );
  for (const row of rows) {
    const amount = Math.trunc(row.amount_cents);
    if (row.entry_kind === "top_up") {
      topUps += amount;
      fees += num(row.fee_cents) ?? 0;
    } else if (row.entry_kind === "withdraw") {
      withdrawals += Math.abs(amount);
    } else if (row.entry_kind === "campaign_spend") {
      const entry = byAd.get(adKey(row)) ?? { held: 0, returned: 0 };
      entry.held += Math.abs(amount);
      byAd.set(adKey(row), entry);
    } else if (row.entry_kind === "unspend_return") {
      returns += amount;
      const entry = byAd.get(adKey(row)) ?? { held: 0, returned: 0 };
      entry.returned += amount;
      byAd.set(adKey(row), entry);
    }
  }
  return {
    month: input.month,
    currency: rows[0]?.currency ?? input.before?.currency ?? null,
    opening_balance_cents: opening,
    top_ups_cents: topUps,
    fees_cents: fees,
    spend_by_ad: [...byAd.entries()].map(([ad_key, entry]) => ({
      ad_key,
      held_cents: entry.held,
      returned_cents: entry.returned,
      net_cents: entry.held - entry.returned,
    })),
    returns_cents: returns,
    withdrawals_cents: withdrawals,
    closing_balance_cents: rows.length > 0
      ? rows[rows.length - 1].balance_after_cents
      : opening,
    lines: rows.map(buildAdCreditReceipt),
    vat: "not_shown_pending_decision",
  };
}
