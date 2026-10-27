// Issue #4130 (Wave 4a) — the Dashboard: the founder's morning view.
//
//   - Five numbers: new sign-ups and paid tickets (7 days, coloured green when
//     up and red when down), Mingla profit in USD over 7 days (Wave 2a money
//     summary), hosts with a next event (and how many have none), and the Work
//     cards waiting on you.
//   - "Needs you today": Money, Platform health, Work, Support and Inbound
//     leads, plus failed announcement pushes for admins, in one list
//     (lib/dashboardToday.js). A source that failed to load
//     says so with Retry; it is never read as "nothing needs you".
//   - The last 8 weeks of sign-ups and paid tickets.
// Place stats moved to Place pool; the raw table counts and the buttons to
// pages that no longer exist are gone. Counts are read server-side
// (admin_dashboard_summary), so no per-user row security can shrink them.
import { useCallback } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { ArrowRight, RotateCcw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Skeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { getDashboardSummary } from "../services/dashboardService";
import { getMinglaMoneySummary } from "../services/adminMoneyService";
import { getApiHealth } from "../services/apiHealthService";
import { getQueueHealth } from "../services/queueHealthService";
import { listAnnouncementDeliveries } from "../services/communityService";
import { useAuth } from "../context/AuthContext";
import { AREA } from "../lib/access";
import { useReviewCount } from "../hooks/useReviewCount";
import { useServerRead } from "../hooks/useServerRead";
import { headline } from "../lib/minglaMoney";
import { formatMoneyMinor } from "../lib/moneyFormat";
import { formatDate } from "../lib/formatters";
import { trendTone, trendUpFromDirection } from "../lib/trendTone";
import { localToday } from "../lib/crmModel";
import { greeting, needsYouToday, weekTrend, weeklyRows } from "../lib/dashboardToday";

const DAY_MS = 86400000;
const TONE_BADGE = { error: "error", bad: "error", warn: "warning" };

function Kpi({ label, children, note, noteTone, action }) {
  return (
    <div className="flex min-h-[104px] min-w-0 flex-col justify-center rounded-xl border border-[var(--gray-200)] border-l-[3px] border-l-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-4">
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-[26px] font-bold leading-tight tabular-nums text-[var(--color-text-primary)]">{children}</span>
      {note ? <span className={`mt-1 text-xs font-medium ${noteTone || "text-[var(--color-text-tertiary)]"}`}>{note}</span> : null}
      {action ? <span className="mt-1.5">{action}</span> : null}
    </div>
  );
}

function KpiFailed({ label, onRetry }) {
  return (
    <div role="alert" className="flex min-h-[104px] min-w-0 flex-col justify-center gap-1.5 rounded-xl border border-[var(--color-error-200,#fecaca)] bg-[var(--color-background-primary)] p-4">
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-sm font-semibold text-[var(--color-error-700)]">Couldn&apos;t load</span>
      <Button variant="secondary" size="sm" icon={RotateCcw} className="w-fit" onClick={onRetry}>Retry</Button>
    </div>
  );
}

function TrendNote({ trend }) {
  if (!trend?.label) return null;
  const tone = trendTone(trendUpFromDirection(trend.direction));
  return <><span aria-hidden="true">{tone.arrow}</span> {trend.label}</>;
}

export function OverviewPage() {
  const today = localToday();
  const loadSummary = useCallback(() => getDashboardSummary(today), [today]);
  const loadProfit = useCallback(() => getMinglaMoneySummary(new Date(Date.now() - 7 * DAY_MS).toISOString(), null), []);
  const loadMoney = useCallback(() => getMinglaMoneySummary(null, null), []);
  const loadHealth = useCallback(() => getApiHealth(), []);
  const loadQueue = useCallback(() => getQueueHealth(), []);
  // #4130 (integration): failed announcement pushes, for admins only (the
  // delivery list is an admin RPC); nobody else's dashboard reads it.
  const { access } = useAuth();
  const isAdmin = Array.isArray(access?.areas) && access.areas.includes(AREA.ADMIN_CONSOLE);
  const loadPushes = useCallback(() => (isAdmin ? listAnnouncementDeliveries() : Promise.resolve(null)), [isAdmin]);

  const summary = useServerRead(loadSummary);
  const profit = useServerRead(loadProfit);
  const money = useServerRead(loadMoney);
  const health = useServerRead(loadHealth);
  const queue = useServerRead(loadQueue);
  const pushes = useServerRead(loadPushes);
  const review = useReviewCount();
  // #4130: a failed Work read is a "failed" item and a failed KPI, never a
  // skeleton forever and never 0.
  const work = review.cardsError ? { status: "error" } : review.cardsLoaded ? { status: "ready", data: { cards: review.cards } } : { status: "loading" };

  const s = summary.data;
  const signups = s ? weekTrend(s.signups?.last7, s.signups?.prev7) : null;
  const tickets = s ? weekTrend(s.paid_tickets?.last7, s.paid_tickets?.prev7) : null;
  const profitUsd = profit.data ? headline(profit.data).profit.usdTotal : null;
  const items = needsYouToday({ work, money, health, queue, summary, announcements: isAdmin ? pushes : undefined });
  const retryFor = { money: money.retry, health: health.retry, queue: queue.retry, summary: summary.retry, work: () => review.refetch?.(), announcements: pushes.retry };
  const weekly = s ? weeklyRows(s) : [];
  const stillChecking = [money, health, summary, work].some((x) => x.status === "loading");

  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={greeting()} description={`${date}. What moved in the last 7 days and what needs a person today.`} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {summary.status === "loading" ? (
          [0, 1].map((i) => <Skeleton key={i} height={104} rounded="xl" />)
        ) : summary.status === "error" ? (
          <>
            <KpiFailed label="New sign-ups" onRetry={summary.retry} />
            <KpiFailed label="Paid tickets" onRetry={summary.retry} />
          </>
        ) : (
          <>
            <Kpi label="New sign-ups" note={<TrendNote trend={signups} />} noteTone={trendTone(trendUpFromDirection(signups.direction)).className}>
              {Number(s.signups?.last7 || 0).toLocaleString()}
            </Kpi>
            <Kpi label="Paid tickets" note={<TrendNote trend={tickets} />} noteTone={trendTone(trendUpFromDirection(tickets.direction)).className}>
              {Number(s.paid_tickets?.last7 || 0).toLocaleString()}
            </Kpi>
          </>
        )}

        {profit.status === "loading" ? (
          <Skeleton height={104} rounded="xl" />
        ) : profit.status === "error" ? (
          <KpiFailed label="Mingla profit" onRetry={profit.retry} />
        ) : (
          <Kpi label="Mingla profit" note={profitUsd == null ? "Not converted: a day had no exchange rate" : "In USD, last 7 days"}>
            {profitUsd == null ? "–" : formatMoneyMinor(profitUsd, "USD")}
          </Kpi>
        )}

        {summary.status === "loading" ? (
          <Skeleton height={104} rounded="xl" />
        ) : summary.status === "error" ? (
          <KpiFailed label="Hosts with a next event" onRetry={summary.retry} />
        ) : (
          <Kpi
            label="Hosts with a next event"
            note={Number(s.hosts?.without_next || 0) > 0 ? `${s.hosts.without_next} ${Number(s.hosts.without_next) === 1 ? "host has" : "hosts have"} none` : "Every active host has one"}
            noteTone={Number(s.hosts?.without_next || 0) > 0 ? trendTone(false).className : trendTone(true).className}
          >
            {Number(s.hosts?.with_next || 0).toLocaleString()}
          </Kpi>
        )}

        {work.status === "loading" ? (
          <Skeleton height={104} rounded="xl" />
        ) : work.status === "error" ? (
          <KpiFailed label="Waiting on you" onRetry={() => review.refetch?.()} />
        ) : (
          <Kpi
            label="Waiting on you"
            action={<a href="#/work-board" className="inline-flex min-h-8 items-center gap-1 text-sm font-semibold text-[var(--color-brand-700)] hover:underline">Open Work <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></a>}
          >
            {Number(review.cards).toLocaleString()}
          </Kpi>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Needs you today" subtitle="From Work, Money, Platform health, Support and Inbound leads" noPadding>
          {items.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-text-secondary)]">
              {stillChecking ? "Checking…" : "Nothing needs you today. Late payouts, platform problems, waiting cards, unanswered tickets and quiet lead weeks show here."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--gray-200)]">
              {items.map((item) => (
                <li key={item.id} data-needs-you={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
                  <span className="mt-0.5 shrink-0"><Badge variant={TONE_BADGE[item.tone] || "default"}>{item.areaLabel}</Badge></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</span>
                    {item.detail && <span className="mt-0.5 block text-xs text-[var(--color-text-tertiary)]">{item.detail}</span>}
                  </span>
                  {item.retry ? (
                    <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => retryFor[item.retry]?.()}>Retry</Button>
                  ) : item.href ? (
                    <a href={item.href} className="inline-flex min-h-8 items-center rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)]">Open</a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Last 8 weeks" subtitle="New sign-ups and paid tickets per week">
          {summary.status === "error" ? (
            <LoadError title="Couldn’t load the weekly numbers" message={summary.error?.message} onRetry={summary.retry} />
          ) : summary.status === "loading" ? (
            <Skeleton height={256} rounded="xl" />
          ) : (
            <div className="h-64 w-full" role="img" aria-label="New sign-ups and paid tickets per week, last 8 weeks">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v) => formatDate(v)} />
                  <YAxis tick={{ fontSize: 11 }} width={36} allowDecimals={false} />
                  <Tooltip labelFormatter={(v) => `Week of ${formatDate(v)}`} />
                  <Legend />
                  <Bar dataKey="signups" name="Sign-ups" fill="var(--color-brand-500)" isAnimationActive={false} />
                  <Bar dataKey="paidTickets" name="Paid tickets" fill="var(--color-success-500)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
