// Issue #4130 (Wave 2a) — Mingla money (#/mingla-money).
//
// What went through Mingla, what Mingla kept, what it cost, and what reached
// hosts. Each currency keeps its own column; nothing is added across
// currencies. Every figure also shows in US dollars at the rate of its own
// day, so past revenue never moves when rates change. One read:
// admin_mingla_money_summary (services/adminMoneyService.js); the tables are
// shaped in lib/minglaMoney.js.
//
// States: loading (skeletons), error (LoadError + Retry, never zeros), empty
// period (says what will appear), populated. A figure with no stored exchange
// rate for its day reads "not converted", never a guessed dollar amount.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { getMinglaMoneySummary } from "../services/adminMoneyService";
import { formatMoneyMinor, joinMoneyAmounts, signedMoney } from "../lib/moneyFormat";
import { formatDate } from "../lib/formatters";
import {
  PERIODS,
  exceptionItems,
  headline,
  hostTable,
  madeTable,
  periodRange,
  pricingTable,
  summaryCurrencies,
  transferCostsRecorded,
  weeklySeries,
} from "../lib/minglaMoney";

const usd = (cents) => (cents == null ? "not converted" : formatMoneyMinor(cents, "USD"));

const signed = signedMoney;

function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-9 rounded-md px-3 text-sm font-medium ${value === o.id ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, note, tone }) {
  return (
    <div className="flex min-h-[92px] min-w-0 flex-col justify-center rounded-xl border border-[var(--gray-200)] border-l-[3px] border-l-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-4">
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      <span className={`text-[26px] font-bold leading-tight tabular-nums ${tone === "bad" ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]"}`}>{value}</span>
      {note ? <span className="mt-1 text-xs text-[var(--color-text-tertiary)]">{note}</span> : null}
    </div>
  );
}

// #4130: "₦150.00 − $0.01", never "₦150.00 + -$0.01" (lib/moneyFormat.js).
function nativeParts(row, currencies, sign = 1) {
  const parts = currencies
    .filter((c) => row.byCurrency[c]?.cents)
    .map((c) => {
      const cents = row.byCurrency[c].cents;
      return { cents: sign < 0 ? -Math.abs(cents) : cents, currency: c };
    });
  return joinMoneyAmounts(parts) || formatMoneyMinor(0, currencies[0] || "USD");
}

/** A per-currency table with a "Total in USD" column. */
function CurrencyTable({ caption, currencies, rows, emptyNote }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--gray-200)] text-left text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
            <th scope="col" className="py-2 pr-3 font-semibold"><span className="sr-only">Line</span></th>
            {currencies.map((c) => <th key={c} scope="col" className="py-2 px-3 text-right font-semibold">{c}</th>)}
            <th scope="col" className="py-2 pl-3 text-right font-semibold">Total in USD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.kind} className="border-b border-[var(--gray-100)] last:border-b-0">
              <th scope="row" className={`py-2.5 pr-3 text-left font-normal ${row.strong ? "font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}>
                {row.label}
                {row.note ? <span className="ml-2"><Badge variant="outline">{row.note}</Badge></span> : null}
              </th>
              {currencies.map((c) => (
                <td key={c} className={`py-2.5 px-3 text-right tabular-nums ${row.strong ? "font-semibold" : ""}`}>
                  {signed(row.byCurrency[c]?.cents ?? 0, c, row.sign ?? 1)}
                </td>
              ))}
              <td className={`py-2.5 pl-3 text-right tabular-nums ${row.strong ? "font-semibold" : ""}`}>
                {row.usdTotal == null ? <span className="text-[var(--color-text-tertiary)]">not converted</span> : signed(row.usdTotal, "USD", row.sign ?? 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {emptyNote ? <p className="mt-3 text-sm text-[var(--color-text-tertiary)]">{emptyNote}</p> : null}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading Mingla money">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={92} rounded="xl" />)}
      </div>
      <Skeleton height={280} rounded="xl" />
      <Skeleton height={220} rounded="xl" />
    </div>
  );
}

export function MinglaMoneyPage() {
  const [period, setPeriod] = useState("all");
  const [mode, setMode] = useState("live");
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartCurrency, setChartCurrency] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [from, to] = periodRange(period);
      setSummary(await getMinglaMoneySummary(from, to));
    } catch (err) {
      setSummary(null);
      setError(err?.message || null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const currencies = useMemo(() => summaryCurrencies(summary), [summary]);
  const made = useMemo(() => madeTable(summary), [summary]);
  const host = useMemo(() => hostTable(summary), [summary]);
  const head = useMemo(() => headline(summary), [summary]);
  const pricing = useMemo(() => pricingTable(summary), [summary]);
  const needs = useMemo(() => exceptionItems(summary), [summary]);
  const recorded = transferCostsRecorded(summary);
  const activeChartCurrency = chartCurrency && currencies.includes(chartCurrency) ? chartCurrency : currencies[0] || null;
  const weekly = useMemo(() => (activeChartCurrency ? weeklySeries(summary, activeChartCurrency) : []), [summary, activeChartCurrency]);

  const madeRows = made.rows
    .filter((r) => !["refunds", "disputes"].includes(r.kind) || Object.values(r.byCurrency).some((v) => v.cents))
    .map((r) => (r.kind === "transfer_costs" && !recorded ? { ...r, note: "not recorded" } : r));
  const hostRows = host.rows.filter((r) =>
    ["host_paid_all_time", "host_never_in_payout", "host_owes_back", "host_late_on_mingla", "host_waiting_for_bank"].includes(r.kind)
    || Object.values(r.byCurrency).some((v) => v.cents));
  const empty = summary && currencies.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Mingla money"
        description="What went through Mingla, what Mingla kept, what it cost, and what reached hosts. Each currency stays in its own column; nothing is added across currencies."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />
        <Segmented
          label="Live or test money"
          options={[{ id: "live", label: "Live money" }, { id: "test", label: "Test money" }]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === "test" ? (
        <AlertCard variant="info" title="Test money is not recorded yet">
          No money table marks a sale as live or test today, so these figures cannot be split. Every figure on this page is everything recorded.
        </AlertCard>
      ) : null}

      {loading && !summary ? <PageSkeleton /> : null}
      {error ? <LoadError title="Couldn't load Mingla money" message={error} onRetry={load} retrying={loading} /> : null}

      {summary && !error ? (
        <>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Dollar totals convert each sale at that day&apos;s rate from Mingla&apos;s daily exchange-rate table, so past revenue never moves when the rate changes.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Headline figures">
            <Tile label="Total revenue (USD)" value={usd(head.revenue.usdTotal)} note={nativeParts(head.revenue, currencies)} />
            <Tile
              label="Total profit (USD)"
              value={usd(head.profit.usdTotal)}
              note={nativeParts(head.profit, currencies)}
              tone={head.profit.usdTotal != null && head.profit.usdTotal < 0 ? "bad" : undefined}
            />
            <Tile label="Paid by buyers (USD)" value={usd(head.paid.usdTotal)} note={nativeParts(head.paid, currencies)} />
            <Tile
              label="Profit on 4.5% pricing"
              value={head.currentPricing ? `${head.currentPricing.sharePercent.toFixed(1)}%` : "No sales yet"}
              note={head.currentPricing
                ? `of the fee kept${head.currentPricing.since ? `, since ${formatDate(head.currentPricing.since)}` : ""}`
                : "No sale on the 4.5% pricing in this period"}
            />
          </div>

          {empty ? (
            <SectionCard>
              <p className="text-sm text-[var(--color-text-secondary)]">
                No money moved in this period. Sales, fees, processing costs and payouts appear here as soon as they happen.
              </p>
            </SectionCard>
          ) : (
            <>
              <SectionCard title="What Mingla made" subtitle="per currency, with the total in USD">
                <CurrencyTable caption="What Mingla made" currencies={made.currencies} rows={madeRows} />
                <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
                  Source: payout items and fee records on both Stripe and Paystack, and orders for what buyers paid.
                  {!recorded ? " The providers' actual transfer fees and stamp duty are not recorded yet, so profit may be overstated." : ""}
                </p>
              </SectionCard>

              <SectionCard title="By pricing" subtitle="4.5% on the ticket since the new pricing, and the older pricing">
                {pricing.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">No sales in this period yet. Each sale appears under the pricing it was sold on.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="border-b border-[var(--gray-200)] text-left text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                          <th scope="col" className="py-2 pr-3 font-semibold">Pricing</th>
                          <th scope="col" className="py-2 px-3 text-right font-semibold">Fee</th>
                          <th scope="col" className="py-2 px-3 text-right font-semibold">Processing</th>
                          <th scope="col" className="py-2 pl-3 text-right font-semibold">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pricing.map((p) => (
                          <tr key={`${p.period}-${p.currency}`} className="border-b border-[var(--gray-100)] last:border-b-0">
                            <th scope="row" className="py-2.5 pr-3 text-left font-normal text-[var(--color-text-secondary)]">
                              {p.period === "current" ? "4.5% on the ticket" : "Older pricing"} ({p.currency})
                            </th>
                            <td className="py-2.5 px-3 text-right tabular-nums">{formatMoneyMinor(p.fee, p.currency)}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{signed(p.processing, p.currency, -1)}</td>
                            <td className={`py-2.5 pl-3 text-right tabular-nums font-semibold ${p.profit < 0 ? "text-[var(--color-error-700)]" : ""}`}>
                              {p.profit < 0 ? `−${formatMoneyMinor(-p.profit, p.currency)}` : formatMoneyMinor(p.profit, p.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Host money" subtitle="what reached hosts and what is still held">
                <CurrencyTable caption="Host money" currencies={host.currencies} rows={hostRows} />
                <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
                  Paid to hosts includes the older payouts table as well as the payout ledger. Held amounts are as of now, whatever the period.
                  {" "}<a className="text-[var(--color-brand-600)] underline" href="#/business-money-ledger?tab=payouts">Open payouts</a>
                </p>
              </SectionCard>

              <SectionCard
                title="Paid by buyers per week"
                subtitle={activeChartCurrency ? `${activeChartCurrency}, with the Mingla fee` : undefined}
                action={currencies.length > 1 ? (
                  <Segmented
                    label="Chart currency"
                    options={currencies.map((c) => ({ id: c, label: c }))}
                    value={activeChartCurrency}
                    onChange={setChartCurrency}
                  />
                ) : null}
              >
                {weekly.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">No sales in this period yet. Each week&apos;s sales appear here.</p>
                ) : (
                  <div className="h-64 w-full" aria-label={`Paid by buyers and Mingla fee per week in ${activeChartCurrency}`} role="img">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                        <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDate(v)} />
                        <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => formatMoneyMinor(Math.round(v * 100), activeChartCurrency)} />
                        <Tooltip
                          formatter={(v, name) => [formatMoneyMinor(Math.round(Number(v) * 100), activeChartCurrency), name]}
                          labelFormatter={(v) => `Week of ${formatDate(v)}`}
                        />
                        <Legend />
                        <Bar dataKey="paid" name="Paid by buyers" fill="var(--color-brand-500)" isAnimationActive={false} />
                        <Bar dataKey="fee" name="Mingla fee" fill="var(--color-success-500)" isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </SectionCard>
            </>
          )}

          <SectionCard title="Needs a look" subtitle="exceptions the ledger found">
            {needs.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">All clear. Late payouts, unpaid-out sales, loss-making sales and unrecorded transfer fees appear here when they happen.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--gray-100)]">
                {needs.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="min-w-[2.5rem] text-xl font-bold tabular-nums text-[var(--color-text-primary)]">{item.count}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</span>
                      <span className="block text-xs text-[var(--color-text-secondary)]">
                        {item.detail}
                        {item.id === "never_in_payout" && summary.exceptions?.never_in_payout?.by_currency
                          ? ` ${Object.entries(summary.exceptions.never_in_payout.by_currency).map(([c, v]) => formatMoneyMinor(v, c)).join(" · ")}.`
                          : ""}
                      </span>
                    </span>
                    <a href={item.href} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] hover:underline">
                      Open <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Matches the providers?" subtitle="nightly check against Stripe and Paystack">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Not built yet. A nightly check will compare this ledger with what Stripe and Paystack report and list any difference here.
            </p>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
