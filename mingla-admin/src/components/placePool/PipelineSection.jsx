// Issue #4276 U1: the pipeline, at the top of Place pool.
//
//   Health      providers, database against its 7 GB pause line, storage against its
//               85 GB guard, the Serper rate (unknown until set) and the view refresh.
//   Gaps        what each city is missing, stage by stage, counted on the server.
//   City        a picked city's run (plan, approve, pause, resume, cancel), its geo
//               box and whether we are missing places there.
//   Intelligence  the Intelligence runs and per-city coverage, reachable again (#4130
//               had left them unrouted).
//   Scoring     share of Explorers and top places per signal. No city-wide scoring.
//   No city     active places outside every city, and assigning them by location.
//   Hand tools  the existing seeding, refresh, photo and thumbnail tools.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Spinner } from "../ui/Spinner";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { useToast } from "../../context/ToastContext";
import { EmbeddedPageContext } from "../layout/embeddedPage";
import {
  fetchPipelineFunnel,
  fetchPipelineRuns,
  pipeline,
  seeding,
} from "../../services/cityPipelineService";
import {
  MATRIX_COLUMNS,
  count,
  formatGb,
  matrixCells,
  perThousand,
  ratePerRequestFrom,
  runStatusWord,
  sharePct,
} from "../../lib/cityPipeline";
import { CityRunPanel } from "./CityRunPanel";
import { CityBoxPanel } from "./CityBoxPanel";
import { ScoringTools } from "./ScoringTools";
import { ActiveRunsControlTower } from "../placeIntelligenceTrial/ActiveRunsControlTower";
import { IntelligenceOverviewTab } from "../placeIntelligenceTrial/IntelligenceOverviewTab";
import { PlacePoolManagementPage } from "../../pages/PlacePoolManagementPage";

const STORAGE_GUARD_BYTES = 85 * 1024 ** 3;
const PLAN_DB_BYTES = 8 * 1024 ** 3;
const PLAN_STORAGE_BYTES = 100 * 1024 ** 3;

function Meter({ label, value, limit, pauseAt, pauseLabel }) {
  const pct = sharePct(value, limit);
  const over = value != null && pauseAt != null && Number(value) >= Number(pauseAt);
  return (
    <div className="flex min-w-[170px] max-w-[280px] flex-1 flex-col gap-1">
      <div className="flex justify-between text-[13px] tabular-nums">
        <span>{label}</span>
        <span>{formatGb(value)} of {formatGb(limit)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--gray-100)]" aria-hidden="true">
        <div className={`h-full rounded-full ${over ? "bg-[var(--color-error-500,#ef4444)]" : "bg-[var(--color-brand-500)]"}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="text-[11px] text-[var(--color-text-tertiary)]">{pauseLabel}</span>
    </div>
  );
}

const PROVIDER_LABEL = { google_places: "Google", gemini: "Gemini", serper: "Serper" };

function HealthStrip({ health, error, onReload, onRateSaved }) {
  const { addToast } = useToast();
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRate(perThousand(health?.serper_usd_per_request)); }, [health?.serper_usd_per_request]);

  const saveRate = async () => {
    const parsed = ratePerRequestFrom(rate);
    if (!parsed.ok) { addToast({ variant: "error", title: parsed.error }); return; }
    setSaving(true);
    try {
      await pipeline("settings", { serperUsdPerRequest: parsed.value });
      addToast({ variant: "success", title: parsed.value === null ? "Serper rate cleared: cost shows as unknown" : "Serper rate saved" });
      onRateSaved();
    } catch (err) {
      addToast({ variant: "error", title: "The rate was not saved", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (error) return <AlertCard variant="error" title="Couldn't read provider and space health" action={<Button size="sm" variant="secondary" onClick={onReload}>Try again</Button>}>{error}</AlertCard>;
  if (!health) return <div className="flex justify-center py-4"><Spinner /></div>;

  const unhealthy = new Set((health.unhealthy ?? []).map((u) => u.provider));
  const mv = health.mv_refresh ?? {};
  const mvNear = mv.max_seconds != null && mv.interval_seconds && Number(mv.max_seconds) > Number(mv.interval_seconds) * 0.5;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-background-primary)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {["google_places", "gemini", "serper"].map((p) => {
          const st = health.providers?.[p]?.status ?? "unknown";
          const bad = unhealthy.has(p);
          return (
            <Badge key={p} variant={bad ? "error" : st === "unknown" ? "default" : "success"}>
              {PROVIDER_LABEL[p]}: {bad ? `failing${health.providers?.[p]?.http_status ? ` (HTTP ${health.providers[p].http_status})` : ""}` : st === "unknown" ? "not checked" : "working"}
            </Badge>
          );
        })}
      </div>
      <div className="flex flex-1 flex-wrap justify-end gap-5">
        <Meter label="Database" value={health.db_bytes} limit={PLAN_DB_BYTES} pauseAt={health.db_pause_bytes} pauseLabel={`Runs pause at ${formatGb(health.db_pause_bytes)}`} />
        <Meter label="Storage" value={health.storage_total_bytes} limit={PLAN_STORAGE_BYTES} pauseAt={STORAGE_GUARD_BYTES}
          pauseLabel={health.storage_measured_at ? `Runs pause at 85 GB · measured ${new Date(health.storage_measured_at).toLocaleString()}` : "Runs pause at 85 GB · not measured yet"} />
      </div>
      <div className="flex w-full flex-wrap items-end gap-3 border-t border-[var(--color-border)] pt-3 text-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
          Serper, USD per 1,000 requests
          <input className="h-10 w-40 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm tabular-nums text-[var(--color-text-primary)]"
            inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Not set" />
        </label>
        <Button size="sm" variant="secondary" onClick={saveRate} loading={saving} disabled={rate === perThousand(health.serper_usd_per_request)}>Save rate</Button>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {health.serper_usd_per_request == null ? "Serper is counted by request; its cost shows as unknown until a rate is set." : "Serper cost is priced from this rate."}
        </span>
        <span className={`ml-auto text-xs ${mvNear ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-tertiary)]"}`}>
          Place list refresh: longest {mv.max_seconds ?? "–"} s of its {mv.interval_seconds ?? 600} s slot in the last day{mvNear ? ", over half" : ""}
        </span>
      </div>
    </div>
  );
}

function NoCityPanel({ onAssigned }) {
  const { addToast } = useToast();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try { setReport(await pipeline("no_city_report")); } catch (err) { setError(err.message); }
  }, []);
  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    setBusy(true);
    try {
      const res = await pipeline("assign_no_city");
      addToast({ variant: "success", title: `${count(res.assigned)} places given a city` });
      setConfirm(false);
      await load();
      onAssigned();
    } catch (err) {
      addToast({ variant: "error", title: "Places were not assigned", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Places with no city" subtitle="City runs can't see these. A place inside exactly one city's box can be given that city.">
      {error ? <AlertCard variant="error" title="Couldn't read places with no city">{error}</AlertCard>
        : !report ? <div className="flex justify-center py-4"><Spinner /></div>
        : (
          <div className="flex flex-col gap-2 text-sm">
            <p className="tabular-nums">{count(report.total)} places ({count(report.active)} active, {count(report.unjudged)} never checked): {count(report.in_one_box)} inside one city's box, {count(report.in_several_boxes)} inside several, {count(report.in_no_box)} inside none.</p>
            {report.by_city?.length > 0 && (
              <p className="text-xs text-[var(--color-text-secondary)]">{report.by_city.map((c) => `${c.name} ${count(c.places)}`).join(" · ")}</p>
            )}
            <div>
              <Button size="sm" variant="secondary" disabled={!report.in_one_box} onClick={() => setConfirm(true)}>Give {count(report.in_one_box)} places their city</Button>
            </div>
          </div>
        )}
      <Modal open={confirm} onClose={busy ? () => {} : () => setConfirm(false)} title="Give these places a city?">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">Only places inside exactly one city's box are assigned. The rest stay on this report. Assigning doesn't show them to Explorers; they still need the checks.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Keep as is</Button>
          <Button onClick={assign} loading={busy}>Assign</Button>
        </ModalFooter>
      </Modal>
    </SectionCard>
  );
}

export function PipelineSection() {
  const [funnel, setFunnel] = useState(null);
  const [funnelError, setFunnelError] = useState(null);
  const [search, setSearch] = useState({});
  const [searchError, setSearchError] = useState(null);
  const [outside, setOutside] = useState(null);
  const [runs, setRuns] = useState({});
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthError(null);
    try { setHealth(await pipeline("health")); } catch (err) { setHealthError(err.message); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, s, o, r] = await Promise.allSettled([
      fetchPipelineFunnel(null),
      seeding("cities_search_status"),
      seeding("places_outside_box"),
      fetchPipelineRuns(),
    ]);
    if (f.status === "fulfilled") { setFunnel(f.value); setFunnelError(null); } else setFunnelError(f.reason.message);
    if (s.status === "fulfilled") {
      setSearch(Object.fromEntries((s.value.cities ?? []).map((c) => [c.cityId, c])));
      setSearchError(null);
    } else setSearchError(s.reason.message);
    setOutside(o.status === "fulfilled" ? Object.fromEntries((o.value.report ?? []).map((c) => [c.city_id, c])) : null);
    if (r.status === "fulfilled") setRuns(r.value);
    setLoading(false);
  }, []);

  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); loadHealth(); }, [load, loadHealth]);

  const cities = useMemo(() => (funnel?.cities ?? []).filter((c) => c.city_id), [funnel]);
  const noCity = useMemo(() => (funnel?.cities ?? []).find((c) => !c.city_id), [funnel]);
  const selected = cities.find((c) => c.city_id === selectedId) ?? null;

  return (
    <section aria-labelledby="pipeline-heading" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pipeline-heading" className="text-lg font-semibold text-[var(--color-text-primary)]">Pipeline</h2>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => { load(); loadHealth(); }} loading={loading}>Update</Button>
      </div>

      <HealthStrip health={health} error={healthError} onReload={loadHealth} onRateSaved={loadHealth} />

      <SectionCard
        title="What each city is missing"
        subtitle="Counted on the server. Pick a city to plan or follow its run, check its geo box and see what is still unsearched."
        noPadding
      >
        {funnelError ? (
          <div className="p-4"><AlertCard variant="error" title="Couldn't count the pipeline" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{funnelError}</AlertCard></div>
        ) : !funnel ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="flex flex-col gap-2">
            {searchError && <div className="px-4 pt-3"><AlertCard variant="warning" title="Search gaps couldn't be read">{searchError} Unsearched and capped show "?".</AlertCard></div>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-sm" aria-label="Pipeline gaps by city and stage">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left align-bottom">
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-[var(--color-text-tertiary)]">City</th>
                    {MATRIX_COLUMNS.map((c) => (
                      <th key={c.id} scope="col" className="px-2 py-2">
                        <span className="block text-[13px] font-semibold text-[var(--color-text-primary)]">{c.label}</span>
                        <span className="block text-[11px] font-normal text-[var(--color-text-tertiary)]">{c.sub}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cities.map((c) => {
                    const cells = matrixCells(c, search[c.city_id], outside ? outside[c.city_id] ?? { outside_active: 0 } : null);
                    const run = runs[c.city_id];
                    const word = run ? runStatusWord(run.status) : null;
                    const isSel = c.city_id === selectedId;
                    return (
                      <tr key={c.city_id} className={`border-b border-[var(--color-border)] ${isSel ? "bg-[var(--color-brand-50)]" : ""}`}>
                        <th scope="row" className="px-3 py-2 text-left font-normal">
                          <button type="button" className="flex min-h-11 w-full flex-col items-start justify-center rounded-lg px-1 text-left hover:bg-[var(--gray-50)]"
                            aria-pressed={isSel} onClick={() => setSelectedId(isSel ? null : c.city_id)}>
                            <b className="text-sm font-semibold">{c.city_name}</b>
                            <span className="text-[11px] text-[var(--color-text-secondary)]">
                              {c.is_live ? "Live" : c.status ?? "draft"} · {count(c.active)} active{word ? ` · run ${word.label.toLowerCase()}` : ""}
                            </span>
                          </button>
                        </th>
                        {cells.map((cell) => (
                          <td key={cell.id} className="px-2 py-2">
                            <span className={`inline-flex min-h-9 min-w-16 items-center rounded-lg px-2 tabular-nums ${cell.gap ? "border border-[#fde68a] bg-[#fffbeb] font-semibold text-[#92400e]" : "text-[var(--color-text-tertiary)]"}`}>
                              {cell.text}
                            </span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 pb-3 text-xs text-[var(--color-text-secondary)]">
              {noCity ? `${count(noCity.active)} active places have no city and sit outside this table. ` : ""}
              Counted {funnel.counted_at ? new Date(funnel.counted_at).toLocaleTimeString() : "just now"}.
            </p>
          </div>
        )}
      </SectionCard>

      {selected && (
        <div className="flex flex-col gap-4" aria-label={`${selected.city_name} pipeline`}>
          <CityRunPanel city={selected} latestRun={runs[selected.city_id] ?? null} serperRate={health?.serper_usd_per_request ?? null} onChanged={load} />
          <CityBoxPanel city={selected} onChanged={load} />
        </div>
      )}

      <SectionCard title="Intelligence" subtitle="Reviews and Gemini per city. Runs here score their own places; nothing releases older held scores.">
        <div className="flex flex-col gap-4">
          <ActiveRunsControlTower />
          <IntelligenceOverviewTab />
        </div>
      </SectionCard>

      <ScoringTools cityId={selected?.city_id ?? null} cityName={selected?.city_name ?? null} />

      <NoCityPanel onAssigned={load} />

      <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background-primary)] p-4">
        <summary className="cursor-pointer text-sm font-semibold">Hand tools: seed chosen categories, refresh, photos, thumbnails</summary>
        <div className="mt-4">
          <EmbeddedPageContext.Provider value={true}>
            <PlacePoolManagementPage key="pipeline" section="pipeline" />
          </EmbeddedPageContext.Provider>
        </div>
      </details>
    </section>
  );
}
