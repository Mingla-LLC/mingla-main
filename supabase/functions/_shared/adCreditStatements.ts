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
  /** #4238 W6c: the ad this row belongs to, by name (null when none/unknown). */
  ad_name: string | null;
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

/** The key a ledger row's ad is known by: its plan, else its campaign. */
export function adKeyOfRow(row: LedgerRow): string | null {
  const planId = (row.metadata as { plan_id?: unknown } | null)?.plan_id;
  if (typeof planId === "string" && planId) return planId;
  return row.campaign_id ? String(row.campaign_id) : null;
}

/** ad key -> the ad's name (event title, else campaign name). */
export type AdNames = ReadonlyMap<string, string>;

export function buildAdCreditReceipt(
  row: LedgerRow,
  names?: AdNames,
): AdCreditReceipt {
  const key = adKeyOfRow(row);
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
    ad_name: key ? (names?.get(key) ?? null) : null,
    refunded_cents: row.entry_kind === "withdraw"
      ? num(row.refund_cents)
      : null,
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
  spend_by_ad: {
    ad_key: string;
    /** #4238 W6c: the ad's name; null when it cannot be found. */
    ad_name: string | null;
    held_cents: number;
    returned_cents: number;
    net_cents: number;
  }[];
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
  names?: AdNames;
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
      ad_name: input.names?.get(ad_key) ?? null,
      held_cents: entry.held,
      returned_cents: entry.returned,
      net_cents: entry.held - entry.returned,
    })),
    returns_cents: returns,
    withdrawals_cents: withdrawals,
    closing_balance_cents: rows.length > 0
      ? rows[rows.length - 1].balance_after_cents
      : opening,
    lines: rows.map((row) => buildAdCreditReceipt(row, input.names)),
    vat: "not_shown_pending_decision",
  };
}

/** One `select columns from table where column in values` read. */
export type NameQuery = (
  table: string,
  columns: string,
  column: string,
  values: string[],
) => PromiseLike<unknown[] | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #4238 W6c: names for the ads in these ledger rows, so statements and
 * receipts never say "Ad 1…n". Name = the event the ad promotes, else the
 * campaign name. A lookup failure yields fewer names (the row shows null),
 * never a failed statement: the money lines come from the ledger alone.
 */
export async function loadAdNames(
  query: NameQuery,
  rows: readonly LedgerRow[],
): Promise<AdNames> {
  const keys = [
    ...new Set(rows.map(adKeyOfRow).filter((k): k is string => !!k)),
  ].filter((k) => UUID.test(k));
  const names = new Map<string, string>();
  if (keys.length === 0) return names;
  try {
    type Camp = {
      id: string;
      name: string | null;
      plan_version_id: string | null;
      dest_event_id: string | null;
    };
    const cols = "id, name, plan_version_id, dest_event_id";
    const [byIdRaw, versionsRaw] = await Promise.all([
      query("ad_campaigns", cols, "id", keys),
      query("ad_plan_versions", "id, plan_id", "plan_id", keys),
    ]);
    const byId = (byIdRaw ?? []) as unknown[];
    const versions = (versionsRaw ?? []) as unknown[];
    const versionPlan = new Map<string, string>(
      ((versions) as { id: string; plan_id: string }[]).map((
        v,
      ) => [v.id, v.plan_id]),
    );
    const byVersion = versionPlan.size > 0
      ? (await query("ad_campaigns", cols, "plan_version_id", [
        ...versionPlan.keys(),
      ])) ?? []
      : [];
    const camps = [...byId, ...byVersion] as Camp[];
    const eventIds = [
      ...new Set(
        camps.map((c) => c.dest_event_id).filter((v): v is string => !!v),
      ),
    ];
    const titles = new Map<string, string>();
    if (eventIds.length > 0) {
      const events = await query("events", "id, title", "id", eventIds);
      for (const e of (events ?? []) as { id: string; title: string | null }[]) {
        if (e.title?.trim()) titles.set(e.id, e.title.trim());
      }
    }
    for (const c of camps) {
      const label = (c.dest_event_id ? titles.get(c.dest_event_id) : null) ??
        (c.name?.trim() || null);
      if (!label) continue;
      if (!names.has(c.id)) names.set(c.id, label);
      const plan = c.plan_version_id ? versionPlan.get(c.plan_version_id) : null;
      if (plan && !names.has(plan)) names.set(plan, label);
    }
  } catch (error) {
    console.error(
      "[ad-credit] ad name lookup failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
  return names;
}
