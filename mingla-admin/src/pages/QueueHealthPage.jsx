// #2879 / #2947 — Admin waiting-room / queue-health gauges.
// Read-only board over admin_get_queue_health. Constitutional rule 9: no
// signal ⇒ grey "No signal yet", never a fake green. Auto-refreshes every 60s.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { RefreshCw, Activity, AlertTriangle } from "lucide-react";

import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { PageHeader } from "../components/ui/PageHeader";
import { timeAgo, formatDateTime } from "../lib/formatters";
import { getQueueHealth } from "../services/queueHealthService";
import { isMissingFunctionError } from "../lib/systemPages";
import {
  gaugeNumber,
  observeFreshness,
  verdictBadgeVariant,
  verdictDotClass,
  verdictLabel,
  worstCrossSignal,
} from "../lib/queueHealthStatus";

function MetricCard({ label, value, hint, tone = "default" }) {
  const display = value == null ? "—" : String(value);
  const toneClass =
    tone === "danger"
      ? "text-[#ef4444]"
      : tone === "warn"
        ? "text-[#f59e0b]"
        : "text-[var(--color-text-primary)]";
  return (
    <div className="border border-[var(--gray-200)] rounded-xl p-4 flex flex-col gap-1 min-h-[108px]">
      <p className="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{display}</p>
      {hint ? <p className="text-xs text-[var(--color-text-secondary)]">{hint}</p> : null}
    </div>
  );
}

export function QueueHealthPage() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // #4130 (Wave 4b): the database function is not in production yet.
  const [notSetUp, setNotSetUp] = useState(false);
  const [data, setData] = useState(null);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setLoadError(null);
    try {
      const res = await getQueueHealth(72);
      if (!mountedRef.current) return;
      setData(res);
    } catch (err) {
      if (!mountedRef.current) return;
      if (isMissingFunctionError(err)) {
        setNotSetUp(true);
        setLoadError(null);
        return;
      }
      setLoadError(err.message || "Could not load queue health.");
    } finally {
      if (mountedRef.current && showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (notSetUp) return undefined;
    const id = setInterval(() => load(false), 60000);
    return () => clearInterval(id);
  }, [load, notSetUp]);

  const verdict = data?.verdict ?? null;
  const live = data?.live ?? null;
  const cross = data?.crossSignals ?? null;
  const latestRun = data?.latestRun ?? null;
  const recentRuns = Array.isArray(data?.recentRuns) ? data.recentRuns : [];

  const lastRunAt = latestRun?.observed_at ?? verdict?.lastRunAt ?? null;
  const freshness = useMemo(() => observeFreshness(lastRunAt), [lastRunAt]);
  const crossState = useMemo(
    () =>
      worstCrossSignal({
        orphanInfinityCount: live?.orphanInfinityCount,
        paidWithoutTicketCount: cross?.paidWithoutTicketCount,
      }),
    [live, cross],
  );

  const waiting = gaugeNumber(live?.waitingEntries);
  const eligible = gaugeNumber(live?.eligibleWaitingEntries);
  const orphans = gaugeNumber(live?.orphanInfinityCount);
  const armed = gaugeNumber(live?.armedTiers);
  const armedPresale = gaugeNumber(live?.armedPresaleTiers);
  const paidWithout = gaugeNumber(cross?.paidWithoutTicketCount);
  const admissions = gaugeNumber(verdict?.admissionsPerformed);
  const releases = gaugeNumber(verdict?.holdsReleased);
  const joins = gaugeNumber(verdict?.joinsPerformed);
  const invites = gaugeNumber(verdict?.waitlistInvitesSent);
  const windows = gaugeNumber(verdict?.queueWindowsObserved);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Queue health"
        description="Waiting-room gauges from the write-driven monitor. Never invents Gate 0 arming numbers."
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => load(true)}>
            Refresh
          </Button>
        }
      />

      {notSetUp ? (
        <AlertCard variant="warning" title="Queue health is not set up in production yet">
          The waiting-room gauges need a database update that hasn&apos;t been applied to production.
          Until it is, there is nothing to show here. Nothing else on this page is affected.
        </AlertCard>
      ) : null}

      {loadError ? (
        <AlertCard
          variant="error"
          title="Couldn't load queue health"
          action={
            <Button variant="secondary" size="sm" onClick={() => load(true)}>
              Retry
            </Button>
          }
        >
          {loadError}
        </AlertCard>
      ) : null}

      {freshness.state === "stale" ? (
        <AlertCard variant="warning" title="Monitor observe may be stalled">
          No monitor run in over 5 minutes
          {lastRunAt ? ` (last ${formatDateTime(lastRunAt)})` : ""}. Check the
          issue_2947_queue_admission_driver cron and that slice-7 monitor migrations are applied.
        </AlertCard>
      ) : null}

      {crossState === "orphaned" ? (
        <AlertCard variant="error" title="Orphan infinity holds">
          Persistent infinity checkout sessions lack a live queue entry. Investigate before arming any
          on-sale tier.
        </AlertCard>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="border border-[var(--gray-200)] rounded-xl p-4 flex flex-col gap-3">
              <Skeleton width="40%" height={12} />
              <Skeleton width="30%" height={28} />
              <Skeleton width="70%" height={12} />
            </div>
          ))}
        </div>
      ) : notSetUp ? null : !data && !loadError ? (
        <AlertCard variant="info" title="No signal yet">
          The queue-health RPC returned nothing. Confirm admin_get_queue_health is applied.
        </AlertCard>
      ) : data ? (
        <>
          <SectionCard title="Verdict">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-block w-3 h-3 rounded-full ${verdictDotClass(verdict)}`}
                aria-hidden
              />
              <Badge variant={verdictBadgeVariant(verdict)}>{verdictLabel(verdict)}</Badge>
              <span className="text-sm text-[var(--color-text-secondary)]">
                {windows == null ? "Event windows unknown" : `${windows} queue window(s) in view`}
                {lastRunAt ? ` · last run ${timeAgo(lastRunAt)}` : " · no observe run yet"}
              </span>
            </div>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              Stalled only when eligible waiting buyers saw zero admissions. Pre-sale waiting and a
              saturated live-hold ceiling stay clean.
            </p>
          </SectionCard>

          <SectionCard title="Live queue">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Queue depth"
                value={waiting}
                hint="Waiting entries (admitted_at / released_at null)"
                tone={waiting > 0 && eligible === 0 ? "warn" : "default"}
              />
              <MetricCard
                label="Eligible waiting"
                value={eligible}
                hint="Sale open + live-hold room"
                tone={eligible > 0 ? "warn" : "default"}
              />
              <MetricCard
                label="Armed tiers"
                value={armed}
                hint={
                  armedPresale != null && armedPresale > 0
                    ? `${armedPresale} still before sale_opens_at`
                    : "Currently armed (disarmed_at null)"
                }
              />
              <MetricCard
                label="Orphan infinity"
                value={orphans}
                hint="Past 2-minute grace, no live queue entry"
                tone={orphans > 0 ? "danger" : "default"}
              />
            </div>
          </SectionCard>

          <SectionCard title="72h rollup">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Joins" value={joins} hint="Write-driven join events" />
              <MetricCard label="Admissions" value={admissions} hint="Write-driven admission events" />
              <MetricCard label="Releases" value={releases} hint="Write-driven release events" />
              <MetricCard
                label="Waitlist invites"
                value={invites}
                hint="Write-driven waitlist invite events"
              />
            </div>
          </SectionCard>

          <SectionCard title="Cross signals">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <MetricCard
                label="Paid without ticket"
                value={paidWithout}
                hint="Past-expiry mingla_* checkouts with no order (#3645 finder)"
                tone={paidWithout > 0 ? "danger" : "default"}
              />
              <div className="border border-[var(--gray-200)] rounded-xl p-4 flex flex-col gap-2 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  Not yet wired (no eng store)
                </p>
                <p className="text-sm text-[var(--color-text-secondary)] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" />
                  Initialize/Verify failures, provider 429/5xx, p95 finalization, and remaining
                  inventory need Gate 0 provider limits plus a live signal store — they are not
                  invented here.
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Recent observe runs">
            {recentRuns.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] py-2">
                <Activity className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                No observe runs in the window — insufficient evidence until the admission driver
                ticks with queue opportunity.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--color-text-tertiary)] border-b border-[var(--gray-100)]">
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Windows</th>
                      <th className="py-2 pr-3 font-medium">Waiting</th>
                      <th className="py-2 pr-3 font-medium">Eligible</th>
                      <th className="py-2 pr-3 font-medium">Admits</th>
                      <th className="py-2 pr-3 font-medium">Releases</th>
                      <th className="py-2 font-medium">Orphans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRuns.slice(0, 24).map((run) => (
                      <tr key={run.id} className="border-b border-[var(--gray-50)]">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {run.observed_at ? timeAgo(run.observed_at) : "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{run.queue_windows_observed ?? "—"}</td>
                        <td className="py-2 pr-3 tabular-nums">{run.waiting_entries ?? "—"}</td>
                        <td className="py-2 pr-3 tabular-nums">{run.eligible_waiting_entries ?? "—"}</td>
                        <td className="py-2 pr-3 tabular-nums">{run.admissions_performed ?? "—"}</td>
                        <td className="py-2 pr-3 tabular-nums">{run.holds_released ?? "—"}</td>
                        <td className="py-2 tabular-nums">{run.orphan_infinity_count ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
