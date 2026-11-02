// Issue #4238 wave 2 — Admin "Results over time" for one campaign (and its
// plan siblings). Recharts (already a dependency): daily spend bars with the
// cumulative line and the provider cap, results per day, spend per platform,
// and a shown → clicks → visits → results tile row. Missing data is hidden,
// never drawn as zero. No animation. A "Show as table" toggle renders the
// same rows as a table.
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCampaignMoney } from "../../lib/adSpendCap";

const SERIES = [
  "var(--color-brand-500)",
  "var(--color-info-500)",
  "var(--color-success-500)",
  "var(--color-warning-500)",
  "var(--color-error-500)",
  "var(--gray-500)",
];
const PLATFORM_LABEL = { meta: "Meta", snapchat: "Snapchat", tiktok: "TikTok", google: "Google", reddit: "Reddit" };
const TH = "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const TD = "px-3 py-2 text-[13px] tabular-nums";

const num = (value) => (value === null || value === undefined ? null : Number(value));

function shortDay(day) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** One row per day across the campaigns (provider currency), nulls kept. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper shared with its tests
export function buildAdminResultsSeries(rows) {
  const byDay = new Map();
  const byPlatform = new Map();
  const currencies = new Set();
  for (const row of rows ?? []) {
    const day = String(row.day);
    const current = byDay.get(day) ?? { day, spend: null, impressions: null, clicks: null, visits: 0, results: 0 };
    const spend = num(row.spend_cents);
    if (spend !== null) current.spend = (current.spend ?? 0) + spend;
    if (num(row.impressions) !== null) current.impressions = (current.impressions ?? 0) + num(row.impressions);
    if (num(row.clicks) !== null) current.clicks = (current.clicks ?? 0) + num(row.clicks);
    current.visits += num(row.page_visits) ?? 0;
    current.results += num(row.results) ?? 0;
    byDay.set(day, current);
    if (row.currency) currencies.add(String(row.currency).toUpperCase());
    const platform = String(row.platform ?? "unknown");
    const p = byPlatform.get(platform) ?? { platform, spend: 0, results: 0 };
    p.spend += spend ?? 0;
    p.results += num(row.results) ?? 0;
    byPlatform.set(platform, p);
  }
  let running = 0;
  const days = [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => {
      if (d.spend !== null) running += d.spend;
      return { ...d, label: shortDay(d.day), cumulative: d.spend === null ? null : running };
    });
  const sum = (key) => {
    const values = days.map((d) => d[key]).filter((v) => v !== null);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };
  const funnel = [
    { key: "shown", label: "Shown", value: sum("impressions") },
    { key: "clicks", label: "Clicks", value: sum("clicks") },
    { key: "visits", label: "Page visits", value: sum("visits") || null },
    { key: "results", label: "Results", value: sum("results") },
  ].filter((step) => step.value !== null);
  return {
    days,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    totalSpend: days.some((d) => d.spend !== null) ? running : null,
    // #4238 shared days rule (Admin and Host): "over N days" counts the days
    // whose own spend is above zero, as the Host's buildSpendSeries does.
    spendDays: days.filter((d) => d.spend !== null && d.spend > 0).length,
    totalResults: days.reduce((a, d) => a + d.results, 0),
    platforms: [...byPlatform.values()].sort((a, b) => b.spend - a.spend),
    funnel,
  };
}

export function AdResultsCharts({ rows, capCents, loading = false, error = null }) {
  const [asTable, setAsTable] = useState(false);
  if (loading) {
    return <p className="text-sm text-[var(--color-text-secondary)]">Loading results over time…</p>;
  }
  if (error) {
    return <p className="text-sm text-[var(--color-error-700)]">{error}</p>;
  }
  const series = buildAdminResultsSeries(rows);
  if (series.days.length === 0 || series.totalSpend === null) {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]" data-testid="results-over-time-empty">
        No spend synced yet. Charts appear after the first daily spend sync.
      </p>
    );
  }
  const money = (cents) => (cents === null ? "—" : formatCampaignMoney(series.currency, cents));
  return (
    <div className="space-y-4" data-testid="results-over-time">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">
          {money(series.totalSpend)} spent over {series.spendDays} {series.spendDays === 1 ? "day" : "days"}
          {capCents ? ` of a ${money(capCents)} cap` : ""} · {series.totalResults} results
        </p>
        <button
          type="button"
          className="min-h-9 rounded-lg border border-[var(--gray-300)] px-3 text-sm"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
        >
          {asTable ? "Show as charts" : "Show as table"}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-testid="results-over-time-table">
            <thead className="border-b border-[var(--gray-200)]">
              <tr>
                <th className={TH}>Day</th>
                <th className={TH}>Spend</th>
                <th className={TH}>Spent so far</th>
                <th className={TH}>Shown</th>
                <th className={TH}>Clicks</th>
                <th className={TH}>Page visits</th>
                <th className={TH}>Results</th>
              </tr>
            </thead>
            <tbody>
              {series.days.map((d) => (
                <tr key={d.day} className="border-b border-[var(--gray-100)]">
                  <td className={TD}>{d.label}</td>
                  <td className={TD}>{money(d.spend)}</td>
                  <td className={TD}>{money(d.cumulative)}</td>
                  <td className={TD}>{d.impressions === null ? "—" : d.impressions.toLocaleString()}</td>
                  <td className={TD}>{d.clicks === null ? "—" : d.clicks.toLocaleString()}</td>
                  <td className={TD}>{d.visits.toLocaleString()}</td>
                  <td className={TD}>{d.results.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <figure aria-label={`Daily spend and spend so far: ${money(series.totalSpend)} over ${series.spendDays} ${series.spendDays === 1 ? "day" : "days"}`}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={series.days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="4 5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="spend" name="Spend" fill={SERIES[0]} isAnimationActive={false} />
                <Line dataKey="cumulative" name="Spent so far" stroke={SERIES[1]} dot={false} isAnimationActive={false} />
                {capCents ? (
                  <ReferenceLine y={capCents} stroke="var(--color-warning-500)" strokeDasharray="4 5" label="Cap" />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </figure>
          {series.totalResults > 0 ? (
            <figure aria-label={`Results per day: ${series.totalResults} in total`}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={series.days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="4 5" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                  <Tooltip />
                  <Bar dataKey="results" name="Results" fill="var(--color-success-500)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No results counted yet for this campaign.
            </p>
          )}
          {series.platforms.length >= 2 ? (
            <figure aria-label="Spend per platform">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  layout="vertical"
                  data={series.platforms.map((p) => ({ ...p, name: PLATFORM_LABEL[p.platform] ?? p.platform }))}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip formatter={(value) => money(value)} />
                  <Bar dataKey="spend" name="Spend" fill={SERIES[2]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </figure>
          ) : null}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="results-over-time-funnel">
        {series.funnel.map((step) => (
          <div key={step.key} className="rounded-lg border border-[var(--gray-200)] p-3">
            <div className="text-xs uppercase text-[var(--color-text-tertiary)]">{step.label}</div>
            <div className="text-xl font-semibold tabular-nums">{step.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
