// Issue #4130 (Wave 4b) — Platform health: "is anything broken" on one page.
//
//   1. Problems first: anything down, a balance under its own alert line,
//      providers never checked, queue health missing or stalled, Stripe mode
//      not fully confirmed.
//   2. Providers: one table, problems on top, uptime, balance against each
//      provider's own warning line (Paystack and Stripe report in the smallest
//      unit, kobo and cents, and are shown in naira and dollars), last checked.
//   3. Stripe mode: "all checks agree" only when every check is confirmed.
//   4. Queue health: the old page, which says plainly when its database
//      function is not in production yet.
//
// Old addresses (#/api-health, #/stripe-mode, #/queue-health) land here with
// a tab naming their section, which is scrolled into view.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { Drawer } from "../components/ui/Drawer";
import { LoadError } from "../components/ui/LoadError";
import { EmbeddedPageContext } from "../components/layout/embeddedPage";
import { useToast } from "../context/ToastContext";
import { useHashTab } from "../hooks/useHashTab";
import { timeAgo, formatDateTime } from "../lib/formatters";
import {
  PLATFORM_HEALTH_SECTIONS,
  isMissingFunctionError,
  lastCheckedAt,
  platformProblems,
  providerBalance,
  providerStatus,
  sectionFor,
  sortProviders,
  stripeModeVerdict,
} from "../lib/systemPages";
import { VERCEL_SIGNAL, fetchBackendMode, probeBusinessWebClientPrefix } from "../lib/stripeModeSignals";
import { getApiHealth, getApiHealthIncidents } from "../services/apiHealthService";
import { getQueueHealth } from "../services/queueHealthService";
import { normalizeVerdict } from "../lib/queueHealthStatus";
import { QueueHealthPage } from "./QueueHealthPage";

// The old section ids the redirects use.
const OLD_SECTION = { providers: "providers", stripe: "stripe", queue: "queue" };

const TONE_BADGE = { error: "error", warning: "warning", info: "info", default: "default" };

function SignalLine({ label, signal }) {
  const confirmed = signal?.status === "ok";
  return (
    <li className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
        {signal?.detail && <p className="text-xs text-[var(--color-text-tertiary)]">{signal.detail}</p>}
      </div>
      <div className="flex items-center gap-2">
        {signal?.mode && <Badge variant={signal.mode === "live" ? "success" : "warning"}>{signal.mode === "live" ? "Live" : "Test"}</Badge>}
        <Badge variant={confirmed ? "success" : signal?.status === "error" ? "error" : "default"}>
          {confirmed ? "Confirmed" : signal?.status === "error" ? "Failed" : "Can't confirm from here"}
        </Badge>
      </div>
    </li>
  );
}

export function PlatformHealthPage() {
  const { addToast } = useToast();
  const [requested] = useHashTab("platform-health");
  const focus = sectionFor(PLATFORM_HEALTH_SECTIONS, OLD_SECTION[requested] || requested);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState(null); // { missing, error, stalled }
  const [stripe, setStripe] = useState(null); // { backend, web }
  const [incidents, setIncidents] = useState(null); // { svc, rows, loading }

  const load = useCallback(async () => {
    setLoading(true);
    setHealthError(null);
    const [h, q, backend, web] = await Promise.allSettled([
      getApiHealth(),
      getQueueHealth(72),
      fetchBackendMode(),
      probeBusinessWebClientPrefix(),
    ]);
    if (!mounted.current) return;
    if (h.status === "fulfilled") setHealth(h.value);
    else {
      setHealth(null);
      setHealthError(h.reason?.message || "Couldn't load provider health.");
    }
    if (q.status === "fulfilled") setQueue({ missing: false, error: false, stalled: normalizeVerdict(q.value?.verdict) === "stalled" });
    else setQueue({ missing: isMissingFunctionError(q.reason), error: !isMissingFunctionError(q.reason) });
    setStripe({
      backend: backend.status === "fulfilled" ? backend.value : { status: "error", detail: String(backend.reason) },
      web: web.status === "fulfilled" ? web.value : { status: "unverifiable" },
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    // The first server read; state changes happen inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Old addresses name a section: bring it into view once the page is drawn.
  useEffect(() => {
    if (!focus || loading) return;
    document.getElementById(`health-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focus, loading]);

  const services = useMemo(() => health?.services ?? [], [health]);
  const providers = useMemo(() => sortProviders(services), [services]);
  const verdict = useMemo(
    () => (stripe ? stripeModeVerdict([stripe.backend, stripe.web, VERCEL_SIGNAL]) : null),
    [stripe]
  );
  const problems = useMemo(
    () => (loading ? [] : platformProblems({ services, queue, stripe: verdict })),
    [loading, services, queue, verdict]
  );
  const attention = problems.filter((p) => p.tone === "error" || p.tone === "warning").length;
  const lastProbeAt = health?.last_probe_at ?? null;

  const openIncidents = async (svc) => {
    setIncidents({ svc, rows: null, loading: true });
    try {
      const rows = await getApiHealthIncidents(svc.service_key, 50);
      if (mounted.current) setIncidents({ svc, rows: rows || [], loading: false });
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't load incidents", description: err.message });
      if (mounted.current) setIncidents({ svc, rows: [], loading: false, error: true });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Platform health"
        description={
          loading
            ? "Providers, queues and Stripe mode on one page."
            : `${attention === 0 ? "Nothing needs attention." : `${attention} ${attention === 1 ? "thing needs" : "things need"} attention.`} Providers, queues and Stripe mode on one page.`
        }
        meta={lastProbeAt ? <Badge variant="outline">{`Last checked ${timeAgo(lastProbeAt)}`}</Badge> : null}
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={loading} onClick={load}>
            Refresh
          </Button>
        }
      />

      {/* 1. Problems first */}
      <section id="health-problems" aria-label="What needs attention">
        <SectionCard title="What needs attention">
          {loading ? (
            <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} height={18} />)}</div>
          ) : problems.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">Nothing. Every provider, the queue and Stripe mode look fine.</p>
          ) : (
            <ul className="divide-y divide-[var(--gray-100)]">
              {problems.map((p) => (
                <li key={p.key} className="flex min-w-0 items-start gap-3 py-2.5">
                  <Badge variant={TONE_BADGE[p.tone] || "default"} className="shrink-0">{p.badge}</Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{p.title}</p>
                    {p.detail && <p className="text-xs text-[var(--color-text-tertiary)]">{p.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </section>

      {/* 2. Providers */}
      <section id="health-providers" aria-label="Providers">
        {healthError ? (
          <LoadError title="Couldn't load provider health" message={healthError} onRetry={load} />
        ) : (
          <SectionCard title="Providers" subtitle="Problems first. Open a provider to see its recent incidents." noPadding>
            {loading ? (
              <div className="flex flex-col gap-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={18} />)}</div>
            ) : providers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                No providers are being watched yet. They appear here once the hourly check is set up.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--gray-200)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                      <th scope="col" className="px-5 py-2.5">Provider</th>
                      <th scope="col" className="px-3 py-2.5">Status</th>
                      <th scope="col" className="px-3 py-2.5 text-right">Uptime 24h</th>
                      <th scope="col" className="px-3 py-2.5">Balance vs alert line</th>
                      <th scope="col" className="px-3 py-2.5">Last checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((svc) => {
                      const status = providerStatus(svc);
                      const balance = providerBalance(svc);
                      const checked = lastCheckedAt(svc);
                      return (
                        <tr
                          key={svc.service_key}
                          className="cursor-pointer border-b border-[var(--gray-100)] last:border-b-0 hover:bg-[var(--color-background-secondary)]"
                          onClick={() => openIncidents(svc)}
                        >
                          <td className="px-5 py-2.5">
                            <button
                              type="button"
                              className="text-left font-medium text-[var(--color-text-primary)]"
                              onClick={(e) => { e.stopPropagation(); openIncidents(svc); }}
                            >
                              {svc.display_name || svc.service_key}
                            </button>
                          </td>
                          <td className="px-3 py-2.5"><Badge variant={status.variant}>{status.label}</Badge></td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{svc.uptime_24h_pct == null ? "–" : `${svc.uptime_24h_pct}%`}</td>
                          <td className={`px-3 py-2.5 tabular-nums ${balance?.low ? "font-medium text-[var(--color-warning-700)]" : "text-[var(--color-text-secondary)]"}`}>
                            {balance ? `${balance.text}${balance.line ? ` / ${balance.line}` : ""}` : "–"}
                          </td>
                          <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">{checked ? timeAgo(checked) : "Never"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        )}
      </section>

      {/* 3. Stripe mode */}
      <section id="health-stripe" aria-label="Stripe mode">
        <SectionCard
          title="Stripe mode"
          subtitle="Live and test keys must agree everywhere. It says they agree only when every check is confirmed."
          badge={verdict ? <Badge variant={verdict.state === "aligned" ? "success" : verdict.state === "unconfirmed" ? "info" : "error"}>{verdict.title}</Badge> : null}
        >
          {!stripe ? (
            <Skeleton height={18} />
          ) : (
            <ul className="divide-y divide-[var(--gray-100)]">
              <SignalLine label="Server (Supabase)" signal={stripe.backend} />
              <SignalLine label="Business web app" signal={stripe.web} />
              <SignalLine label="Vercel project settings" signal={VERCEL_SIGNAL} />
            </ul>
          )}
        </SectionCard>
      </section>

      {/* 4. Queue health */}
      <section id="health-queue" aria-label="Queue health" className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Queue health</h2>
        <EmbeddedPageContext.Provider value={true}>
          <QueueHealthPage />
        </EmbeddedPageContext.Provider>
      </section>

      <Drawer
        open={!!incidents}
        onClose={() => setIncidents(null)}
        title={incidents ? `${incidents.svc.display_name || incidents.svc.service_key}: recent incidents` : ""}
      >
        {incidents?.loading ? (
          <div className="flex flex-col gap-2"><Skeleton height={16} /><Skeleton height={16} width="80%" /></div>
        ) : incidents?.error ? (
          <LoadError title="Couldn't load incidents" onRetry={() => openIncidents(incidents.svc)} />
        ) : (incidents?.rows?.length ?? 0) === 0 ? (
          <p className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <Activity className="h-4 w-4 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            No slow or failed checks recently.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {incidents.rows.map((row, i) => (
              <li key={i} className="flex items-start gap-3 border-b border-[var(--gray-100)] pb-2 text-sm">
                <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${row.status === "down" ? "text-[#ef4444]" : "text-[#f59e0b]"}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-medium text-[var(--color-text-primary)]">
                    {row.status === "down" ? "Down" : "Slow or failing"}
                    {row.http_status ? ` · answered ${row.http_status}` : ""}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {formatDateTime(row.checked_at)}
                    {row.detail?.error ? ` · ${row.detail.error}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </div>
  );
}
