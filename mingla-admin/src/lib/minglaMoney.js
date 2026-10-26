// Issue #4130 (Wave 2a) — turn admin_mingla_money_summary into the Mingla
// money page's tables. Pure: no React, no Supabase.
//
// The server returns one line per (kind, currency) with native minor units
// (`cents`) and US cents at each line's own-day rate (`usd_cents`, null when a
// day had no stored rate). Rules kept here:
//   - currencies are never added together; the only cross-currency figure is
//     the sum of usd_cents, and only when every currency in it has one
//     (otherwise the total is null and the page says "not converted");
//   - a kind with no line in a currency is 0 for that currency (the server
//     only omits kinds that had nothing), never a guess.

export const PERIODS = Object.freeze([
  { id: "all", label: "All time" },
  { id: "month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "90d", label: "Last 90 days" },
]);

/** [from, to] ISO strings for a period id, relative to `now`. "all" is [null, null]. */
export function periodRange(id, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (id === "month") return [new Date(Date.UTC(y, m, 1)).toISOString(), null];
  if (id === "last_month") {
    return [new Date(Date.UTC(y, m - 1, 1)).toISOString(), new Date(Date.UTC(y, m, 1)).toISOString()];
  }
  if (id === "90d") return [new Date(now.getTime() - 90 * 86400000).toISOString(), null];
  return [null, null];
}

/** Currencies present in the summary, NGN and USD first, then A–Z. */
export function summaryCurrencies(summary) {
  const set = new Set();
  for (const line of summary?.lines ?? []) if (line?.currency) set.add(line.currency);
  const order = { NGN: 0, USD: 1 };
  return [...set].sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9) || a.localeCompare(b));
}

function lineFor(summary, kind, currency) {
  return (summary?.lines ?? []).find((l) => l.kind === kind && l.currency === currency) ?? null;
}

/**
 * One table row: { kind, byCurrency: { NGN: { cents, usdCents } }, usdTotal }.
 * usdTotal is null when any currency with money in this row has no USD figure.
 */
export function moneyRow(summary, kind, currencies = summaryCurrencies(summary)) {
  const byCurrency = {};
  let usdTotal = 0;
  let complete = true;
  for (const cur of currencies) {
    const line = lineFor(summary, kind, cur);
    const cents = line ? Number(line.cents) : 0;
    const usdCents = line ? (line.usd_cents == null ? null : Number(line.usd_cents)) : 0;
    byCurrency[cur] = { cents, usdCents };
    if (usdCents == null) complete = false;
    else usdTotal += usdCents;
  }
  return { kind, byCurrency, usdTotal: complete ? usdTotal : null };
}

/** "What Mingla made": the waterfall, each row per currency plus a USD total. */
export const MADE_ROWS = Object.freeze([
  { kind: "buyers_paid", label: "Paid by buyers", sign: 1 },
  { kind: "refunds", label: "Refunds", sign: -1 },
  { kind: "disputes", label: "Disputes", sign: -1 },
  { kind: "fee", label: "Revenue · Mingla fee collected", sign: 1, strong: true },
  { kind: "processing", label: "Card processing Mingla paid", sign: -1 },
  { kind: "transfer_costs", label: "Transfer fees and stamp duty Mingla paid", sign: -1 },
  { kind: "profit", label: "Profit", sign: 1, strong: true },
]);

export const HOST_ROWS = Object.freeze([
  { kind: "host_paid_all_time", label: "Paid to hosts, all time" },
  { kind: "host_paid_in_period", label: "Paid to hosts in this period" },
  { kind: "host_paid_last_24h", label: "Paid in the last 24 hours" },
  { kind: "host_scheduled", label: "Scheduled to send" },
  { kind: "host_waiting_for_bank", label: "Waiting for host bank" },
  { kind: "host_late_on_mingla", label: "Late on Mingla" },
  { kind: "host_held_other", label: "Held for review or paused" },
  { kind: "host_never_in_payout", label: "Never put into a payout" },
  { kind: "host_owes_back", label: "Mingla owes hosts back" },
]);

export function madeTable(summary) {
  const currencies = summaryCurrencies(summary);
  return { currencies, rows: MADE_ROWS.map((r) => ({ ...r, ...moneyRow(summary, r.kind, currencies) })) };
}

export function hostTable(summary) {
  const currencies = summaryCurrencies(summary);
  return { currencies, rows: HOST_ROWS.map((r) => ({ ...r, ...moneyRow(summary, r.kind, currencies) })) };
}

/** Whether actual transfer costs were ever recorded (all zero means "not recorded"). */
export function transferCostsRecorded(summary) {
  return (summary?.lines ?? []).some((l) => l.kind === "transfer_costs" && Number(l.cents) !== 0);
}

/** Headline tiles: total revenue, total profit, paid by buyers (USD) and share of fee kept on current pricing. */
export function headline(summary) {
  const currencies = summaryCurrencies(summary);
  const revenue = moneyRow(summary, "fee", currencies);
  const profit = moneyRow(summary, "profit", currencies);
  const paid = moneyRow(summary, "buyers_paid", currencies);
  const pricing = summary?.pricing?.rows ?? [];
  let fee = 0;
  let kept = 0;
  let complete = true;
  for (const row of pricing) {
    if (row.period !== "current") continue;
    if (row.usd_cents == null) complete = false;
    if (row.kind === "fee") fee += Number(row.usd_cents ?? 0);
    if (row.kind === "profit") kept += Number(row.usd_cents ?? 0);
  }
  const since = Object.values(summary?.pricing?.current_since ?? {}).sort()[0] ?? null;
  return {
    revenue,
    profit,
    paid,
    currentPricing: fee > 0 && complete ? { sharePercent: (kept / fee) * 100, since } : null,
  };
}

/** By-pricing table rows: one per (currency, period) with fee, processing, profit. */
export function pricingTable(summary) {
  const rows = summary?.pricing?.rows ?? [];
  const keys = new Map();
  for (const r of rows) {
    const key = `${r.period}:${r.currency}`;
    if (!keys.has(key)) keys.set(key, { period: r.period, currency: r.currency, fee: 0, processing: 0, profit: 0 });
    const entry = keys.get(key);
    if (r.kind === "fee") entry.fee = Number(r.cents);
    if (r.kind === "processing") entry.processing = Number(r.cents);
    if (r.kind === "profit") entry.profit = Number(r.cents);
  }
  const order = { current: 0, older: 1 };
  return [...keys.values()].sort(
    (a, b) => (order[a.period] ?? 9) - (order[b.period] ?? 9) || a.currency.localeCompare(b.currency),
  );
}

/** Weekly chart rows for one currency: [{ week, paid, fee }] in major units. */
export function weeklySeries(summary, currency) {
  return (summary?.weekly ?? [])
    .filter((w) => w.currency === currency)
    .map((w) => ({
      week: String(w.week_start).slice(0, 10),
      paid: Number(w.buyers_paid_cents) / 100,
      fee: Number(w.fee_cents) / 100,
    }));
}

/**
 * "Needs a look": the exceptions with a count above zero, most urgent first.
 * Each item names where to open the rows.
 */
export function exceptionItems(summary) {
  const ex = summary?.exceptions ?? {};
  const items = [
    {
      id: "late_on_mingla",
      count: Number(ex.late_on_mingla?.count ?? 0),
      title: "Payouts late on Mingla",
      detail: "Mingla missed the promised send time. Hosts are waiting on us.",
      href: "#/business-money-ledger?tab=payouts&status=late_on_us",
    },
    {
      id: "never_in_payout",
      count: Number(ex.never_in_payout?.count ?? 0),
      title: "Paid sales never put into a payout",
      detail: "Those hosts are owed money with no payout row.",
      href: "#/business-orders?status=host_not_paid",
    },
    {
      id: "processing_over_fee",
      count: Number(ex.processing_over_fee?.count ?? 0),
      title: "Sales where processing cost more than Mingla's fee",
      detail: "Mingla lost money on these sales.",
      href: "#/business-orders?status=paid",
    },
    {
      id: "transfer_fee_not_recorded",
      count: Number(ex.transfer_fee_not_recorded?.count ?? 0),
      title: "Transfers with no real fee recorded",
      detail: "The provider's actual transfer fee and stamp duty read 0, so profit may be overstated.",
      href: "#/business-money-ledger?tab=payouts&status=paid",
    },
    {
      id: "owes_back_open",
      count: Number(ex.owes_back_open?.count ?? 0),
      title: "Transfer fees Mingla owes hosts back",
      detail: "Mark them settled on Money ledger once repaid.",
      href: "#/business-money-ledger?tab=payouts",
    },
  ];
  return items.filter((i) => i.count > 0);
}

/**
 * Mingla's fee as a share of the TICKET price (not of what the buyer paid,
 * which includes the fee and made 4.5% read as 4.31%). Below 4% is the older
 * pricing, the same split the server uses. Null when there is no ticket price.
 */
export function feeShareOfTicket(feeCents, ticketCents) {
  const fee = Number(feeCents);
  const ticket = Number(ticketCents);
  if (!Number.isFinite(fee) || !Number.isFinite(ticket) || ticket <= 0) return null;
  const percent = (fee / ticket) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return { percent, label: `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`, older: percent < 4 };
}
