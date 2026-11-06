// Issue #4276 U1: the Pipeline tab of Place pool, laid out as the approved design
// (pipeline-design/project/Main.dc.html), in the admin's tokens.
//
//   Health      providers as pills, database against its 7 GB pause line and storage
//               against its 85 GB guard; the place list refresh under them.
//   Spend       recorded spend to date, by provider. Serper stays unpriced until a
//               rate is set (the rate lives in the Run plan).
//   Tiles       what is still missing, in five numbers.
//   Gaps        what each city is missing, stage by stage, counted on the server, with
//               a Show filter, a legend and an "All gaps" row. Picking a city opens its
//               setup under its own row (geo box, completeness) and its run on the
//               right.
//   Run plan    the picked city's run (plan, cost, limits, start, progress, pause,
//               resume, cancel) and the Serper rate, beside the table.
//   Thumbnails, no-city places, Scoring tools (collapsed), Intelligence coverage and
//   the hand tools follow under the table.
//
// Intelligence coverage loads after the health card and the gaps table have answered,
// and its first read is retried once (fix d): it used to start with them and time out.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { useToast } from "../../context/ToastContext";
import { EmbeddedPageContext } from "../layout/embeddedPage";
import { supabase } from "../../lib/supabase";
import {
  fetchPipelineFunnel,
  fetchPipelineRuns,
  fetchSpendTotals,
  pipeline,
  seeding,
} from "../../services/cityPipelineService";
import {
  MATRIX_COLUMNS,
  MATRIX_FILTERS,
  boxSizeText,
  cellCost,
  cityStatusLine,
  count,
  filterChipCount,
  loadedCount,
  matrixTotalCosts,
  neededFirst,
  pickable,
  planLines,
  wholeRow,
  plural,
  formatGb,
  matrixCells,
  matrixFilter,
  matrixTotals,
  perThousand,
  ratePerRequestFrom,
  runStatusWord,
  sharePct,
  spendTotalsLine,
} from "../../lib/cityPipeline";
import { CityRunPanel } from "./CityRunPanel";
import { CityBoxPanel } from "./CityBoxPanel";
import { ScoringTools } from "./ScoringTools";
import { ChipGroup, StatTile } from "./PoolUi";
import { ActiveRunsControlTower } from "../placeIntelligenceTrial/ActiveRunsControlTower";
import { IntelligenceOverviewTab } from "../placeIntelligenceTrial/IntelligenceOverviewTab";
import { AddCityModal, PlacePoolManagementPage } from "../../pages/PlacePoolManagementPage";

const STORAGE_GUARD_BYTES = 85 * 1024 ** 3;
const PLAN_DB_BYTES = 8 * 1024 ** 3;
const PLAN_STORAGE_BYTES = 100 * 1024 ** 3;

// The legend's colours, from the theme tokens.
const CELL_TONE = {
  picked: "border-[var(--color-brand-600)] bg-[var(--color-brand-500)] text-white",
  needed: "border-dashed border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-800)]",
  missing: "border-[var(--color-warning-100)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  check: "border-[var(--color-error-100)] bg-[var(--color-error-50)] text-[var(--color-error-700)]",
  redo: "border-[var(--color-info-100)] bg-[var(--color-info-50)] text-[var(--color-info-700)]",
  follows: "border-dashed border-[var(--gray-400)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)]",
};

const LEGEND = [
  { kind: "missing", label: "Missing" },
  { kind: "redo", label: "Optional redo" },
  { kind: "check", label: "Check this box" },
  { kind: "picked", label: "You picked" },
  { kind: "needed", label: "Needed first, added for you" },
  { kind: "follows", label: "Follows automatically" },
];

function Meter({ label, value, limit, pauseAt, pauseLabel }) {
  const pct = sharePct(value, limit);
  const over = value != null && pauseAt != null && Number(value) >= Number(pauseAt);
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
      <div className="flex justify-between gap-3 text-[13px] tabular-nums text-[var(--color-text-primary)]">
        <span>{label}</span>
        <span>{formatGb(value)} of {formatGb(limit)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--gray-100)]" role="img" aria-label={`${label}: ${formatGb(value)} of ${formatGb(limit)}`}>
        <div className={`h-full rounded-full ${over ? "bg-[var(--color-error-500)]" : "bg-[var(--color-brand-500)]"}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="text-[11px] text-[var(--color-text-tertiary)]">{pauseLabel}</span>
    </div>
  );
}

const PROVIDER_LABEL = { google_places: "Google", gemini: "Gemini", serper: "Serper" };

function Pill({ tone, children }) {
  const tones = {
    ok: "bg-[var(--color-success-50)] text-[var(--color-success-700)]",
    bad: "bg-[var(--color-error-50)] text-[var(--color-error-700)]",
    unknown: "bg-[var(--gray-100)] text-[var(--color-text-secondary)]",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-medium ${tones[tone]}`}>{children}</span>;
}

function refreshLine(mv) {
  if (mv.max_seconds == null) return "Place list refresh: no run recorded in the last day";
  if (mv.interval_seconds == null) return `Place list refresh: longest ${mv.max_seconds} s in the last day; its schedule couldn't be read, so its slot is unknown`;
  const near = Number(mv.max_seconds) > Number(mv.interval_seconds) * 0.5;
  return `Place list refresh: longest ${mv.max_seconds} s of its ${mv.interval_seconds} s slot in the last day${near ? ", over half" : ""}`;
}

function HealthCard({ health, error, onReload }) {
  if (error) return <AlertCard variant="error" title="Couldn't read provider and space health" action={<Button size="sm" variant="secondary" onClick={onReload}>Try again</Button>}>{error}</AlertCard>;
  if (!health) return <div className="flex justify-center rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] py-5"><Spinner /></div>;
  const unhealthy = new Set((health.unhealthy ?? []).map((u) => u.provider));
  const mv = health.mv_refresh ?? {};
  const mvNear = mv.max_seconds != null && mv.interval_seconds && Number(mv.max_seconds) > Number(mv.interval_seconds) * 0.5;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-5 py-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {["google_places", "gemini", "serper"].map((p) => {
            const st = health.providers?.[p]?.status ?? "unknown";
            const bad = unhealthy.has(p);
            const http = health.providers?.[p]?.http_status;
            return (
              <Pill key={p} tone={bad ? "bad" : st === "unknown" ? "unknown" : "ok"}>
                {PROVIDER_LABEL[p]} {bad ? `failing${http ? ` (HTTP ${http})` : ""}` : st === "unknown" ? "not checked" : "working"}
              </Pill>
            );
          })}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-6">
          <Meter label="Database" value={health.db_bytes} limit={PLAN_DB_BYTES} pauseAt={health.db_pause_bytes} pauseLabel={`Runs pause at ${formatGb(health.db_pause_bytes)}`} />
          <Meter label="Storage" value={health.storage_total_bytes} limit={PLAN_STORAGE_BYTES} pauseAt={STORAGE_GUARD_BYTES}
            pauseLabel={health.storage_measured_at ? `Runs pause at 85 GB · measured ${new Date(health.storage_measured_at).toLocaleString()}` : "Runs pause at 85 GB · not measured yet"} />
        </div>
      </div>
      <p className={`text-xs ${mvNear ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-tertiary)]"}`}>{refreshLine(mv)}</p>
    </div>
  );
}

function SpendStrip({ spend, error }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-5 py-3 text-[13px] shadow-[var(--shadow-sm)]">
      <b className="font-semibold text-[var(--color-text-primary)]">Recorded spend to date</b>
      {error ? (
        <span className="text-[var(--color-error-700)]">Couldn't read spend: {error}</span>
      ) : !spend ? (
        <Spinner size="sm" />
      ) : (
        <>
          <span className="tabular-nums text-[var(--color-text-secondary)]">{spendTotalsLine(spend)}</span>
          {spend.serper_usd_per_request == null && <span className="text-[var(--color-error-700)]">Serper not priced: set its rate in the Run plan</span>}
        </>
      )}
    </div>
  );
}

function SerperRate({ health, onSaved }) {
  const { addToast } = useToast();
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  // A server read; its state changes happen when it answers.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setRate(perThousand(health?.serper_usd_per_request)); }, [health?.serper_usd_per_request]);
  if (!health) return null;
  const saveRate = async () => {
    const parsed = ratePerRequestFrom(rate);
    if (!parsed.ok) { addToast({ variant: "error", title: parsed.error }); return; }
    setSaving(true);
    try {
      await pipeline("settings", { serperUsdPerRequest: parsed.value });
      addToast({ variant: "success", title: parsed.value === null ? "Serper rate cleared: cost shows as unknown" : "Serper rate saved" });
      onSaved();
    } catch (err) {
      addToast({ variant: "error", title: "The rate was not saved", description: err.message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--gray-200)] pt-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-[var(--color-text-secondary)]">
        Serper, USD per 1,000 requests
        <span className="flex gap-2">
          <input className="h-11 w-full min-w-0 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm tabular-nums text-[var(--color-text-primary)]"
            inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Not set" />
          <Button variant="secondary" className="shrink-0 whitespace-nowrap" onClick={saveRate} loading={saving} disabled={rate === perThousand(health.serper_usd_per_request)}>Save rate</Button>
        </span>
      </label>
      <span className="text-xs text-[var(--color-text-tertiary)]">
        {health.serper_usd_per_request == null ? "Serper is counted by request; its cost shows as unknown until a rate is set." : "Serper cost is priced from this rate."}
      </span>
    </div>
  );
}

function NoCityRow({ noCity, onAssigned }) {
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
      addToast({ variant: "success", title: `${plural(res.assigned, "place")} given a city` });
      setConfirm(false);
      await load();
      onAssigned();
    } catch (err) {
      addToast({ variant: "error", title: "Places were not assigned", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const active = Number(noCity?.active ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-xs text-[var(--color-text-secondary)]">
      <span className="min-w-0 flex-1">
        {plural(active, "active place")} {active === 1 ? "has" : "have"} no city and {active === 1 ? "sits" : "sit"} outside this table.
        {error ? ` Couldn't read where they are: ${error}`
          : report ? ` ${count(report.in_one_box)} inside one city's box, ${count(report.in_several_boxes)} inside several, ${count(report.in_no_box)} inside none.` : ""}
      </span>
      {report && Number(report.in_one_box) > 0 && (
        <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>{Number(report.in_one_box) === 1 ? "Give 1 place its city" : `Give ${count(report.in_one_box)} places their city`}</Button>
      )}
      <Modal open={confirm} onClose={busy ? () => {} : () => setConfirm(false)} title="Give these places a city?">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">Only places inside exactly one city's box are assigned. The rest stay outside the table. Assigning doesn't show them to Explorers; they still need the checks.</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirm(false)} disabled={busy}>Keep as is</Button>
          <Button onClick={assign} loading={busy}>Assign</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// The geo box cell says the box's size, and how many places sit outside it when any do.
function boxCell(cell, size) {
  if (cell.gap) return { ...cell, text: `${cell.text} outside`, sub: size };
  return { ...cell, text: size || cell.text };
}

function GapCell({ cell, cost, state, onToggle, cityName, label }) {
  if (!cell.gap) {
    return <span className="flex min-h-11 items-center px-1 text-[12px] text-[var(--color-text-tertiary)]">{cell.text}</span>;
  }
  const tone = CELL_TONE[state] ?? CELL_TONE[cell.kind] ?? CELL_TONE.missing;
  const body = (
    <>
      <span className="block truncate text-[12px] font-semibold tabular-nums">{cell.text}</span>
      {cell.sub && <span className="block truncate text-[10.5px] font-normal">{cell.sub}</span>}
      {cost?.text && <span className="block truncate text-[10.5px] font-normal tabular-nums opacity-90">{cost.text}</span>}
    </>
  );
  const cls = `flex min-h-11 w-full min-w-0 flex-col items-start justify-center rounded-md border px-1.5 py-1 text-left ${tone}`;
  if (!onToggle) return <span className={cls}>{body}</span>;
  return (
    <button type="button" className={`${cls} cursor-pointer hover:brightness-95`} aria-pressed={state === "picked"}
      aria-label={`${cityName}, ${label}: ${cell.text}${cost?.text ? `, ${cost.text}` : ""}${state === "needed" ? ", needed first" : ""}`}
      onClick={onToggle}>
      {body}
    </button>
  );
}

export function PipelineSection() {
  const { addToast } = useToast();
  const [funnel, setFunnel] = useState(null);
  const [funnelError, setFunnelError] = useState(null);
  const [search, setSearch] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [outside, setOutside] = useState(null);
  const [boxes, setBoxes] = useState({});
  const [runs, setRuns] = useState({});
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [spend, setSpend] = useState(null);
  const [spendError, setSpendError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  // The gaps picked for the selected city's run (one city at a time), and Gemini's
  // per-place rate once the Intelligence coverage has read it.
  const [picked, setPicked] = useState([]);
  const [costModel, setCostModel] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  // The city setup opens under its row but is as wide as the visible part of the table,
  // so its two panels are never cut off by the table's sideways scroll.
  const scrollRef = useRef(null);
  const [visibleWidth, setVisibleWidth] = useState(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setVisibleWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [funnel]);

  const loadHealth = useCallback(async () => {
    setHealthError(null);
    try { setHealth(await pipeline("health")); } catch (err) { setHealthError(err.message); }
  }, []);

  const loadSpend = useCallback(async () => {
    setSpendError(null);
    try { setSpend(await fetchSpendTotals()); } catch (err) { setSpendError(err.message); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, s, o, r, b] = await Promise.allSettled([
      fetchPipelineFunnel(null),
      seeding("cities_search_status"),
      seeding("places_outside_box"),
      fetchPipelineRuns(),
      supabase.from("seeding_cities").select("id, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng"),
    ]);
    if (f.status === "fulfilled") { setFunnel(f.value); setFunnelError(null); } else setFunnelError(f.reason.message);
    if (s.status === "fulfilled") {
      setSearch(Object.fromEntries((s.value.cities ?? []).map((c) => [c.cityId, c])));
      setSearchError(null);
    } else setSearchError(s.reason.message);
    setOutside(o.status === "fulfilled" ? Object.fromEntries((o.value.report ?? []).map((c) => [c.city_id, c])) : null);
    if (r.status === "fulfilled") setRuns(r.value);
    if (b.status === "fulfilled" && !b.value.error) setBoxes(Object.fromEntries((b.value.data ?? []).map((c) => [c.id, c])));
    setLoading(false);
  }, []);

  // Server reads; their state changes happen when they answer.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); loadHealth(); loadSpend(); }, [load, loadHealth, loadSpend]);

  const allCities = useMemo(() => (funnel?.cities ?? []).filter((c) => c.city_id), [funnel]);
  const noCity = useMemo(() => (funnel?.cities ?? []).find((c) => !c.city_id), [funnel]);
  const rows = useMemo(() => allCities.map((c) => {
    const cells = matrixCells(c, search?.[c.city_id], outside ? outside[c.city_id] ?? { outside_active: 0 } : null);
    return { city: c, cells, status: cityStatusLine(c, cells) };
  }), [allCities, search, outside]);
  const shown = useMemo(() => rows.filter((r) => matrixFilter(r.city, filter)), [rows, filter]);
  const totals = useMemo(() => matrixTotals(shown.map((r) => r.cells)), [shown]);
  const filterCounts = useMemo(() => Object.fromEntries(MATRIX_FILTERS.map((f) => [f.id, rows.filter((r) => matrixFilter(r.city, f.id)).length])), [rows]);
  const selected = allCities.find((c) => c.city_id === selectedId) ?? null;
  const t = funnel?.totals;
  const rates = { serperUsdPerRequest: health?.serper_usd_per_request ?? null, geminiPerPlaceUsd: costModel?.perPlaceCostUsd ?? null };
  const totalCosts = matrixTotalCosts(shown.map((r) => r.cells), rates);
  const selectedRow = rows.find((r) => r.city.city_id === selectedId) ?? null;
  const needed = selectedRow ? neededFirst(picked, selectedRow.cells) : new Set();
  const picks = selectedRow && picked.length ? planLines(selectedRow.cells, picked, rates) : null;
  // The table's state for counts that depend on it: loading, failed or answered.
  const tableState = { loading: !funnel && !funnelError, error: funnelError };

  // Tap a number: that gap joins the selected city's plan (a gap in another city
  // starts a new plan there). Tap a city name: pick its whole row, or close it.
  const toggleCell = (cityId, id) => {
    if (cityId !== selectedId) { setSelectedId(cityId); setPicked([id]); return; }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const pickCity = (row) => {
    if (row.city.city_id === selectedId) { setSelectedId(null); setPicked([]); return; }
    setSelectedId(row.city.city_id);
    setPicked(wholeRow(row.cells));
  };

  const unfinishedCities = rows.filter((r) => r.cells.some((c) => c.gap && c.kind === "missing")).length;
  // Null until the search status has answered, so a count still loading never reads 0.
  const sum = (key) => {
    if (!search) return null;
    const vals = Object.values(search).filter((v) => !v.error).map((v) => Number(v[key] ?? 0));
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const capped = sum("cappedOpen");
  const unsearched = searchError || !search ? null : (sum("uncoveredTiles") ?? 0) + (sum("unfinishedSearches") ?? 0);
  // Intelligence coverage waits for the health card and the gaps table (fix d).
  const tableSettled = (funnel !== null || funnelError !== null) && (health !== null || healthError !== null);

  // While the table loads the chips show "–"; when it failed they show no count at all.
  const filterOptions = MATRIX_FILTERS.map((f) => ({ ...f, count: filterChipCount(filterCounts[f.id], tableState) }));
  const reloadAll = () => { load(); loadHealth(); loadSpend(); };

  return (
    <section aria-label="Pipeline" className="flex min-w-0 flex-col gap-6">
      <HealthCard health={health} error={healthError} onReload={loadHealth} />
      <SpendStrip spend={spend} error={spendError} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Cities not finished" value={loadedCount(funnel ? unfinishedCities : null, tableState)}
          tone={funnelError ? "error" : "default"}
          note={funnelError ? `Couldn't count: ${funnelError}` : funnel ? `${count(filterCounts.drafts)} draft, ${count(rows.filter((r) => r.status.includes("Not started")).length)} not started` : "Counting…"} />
        <StatTile label="Servable, no Intelligence" value={loadedCount(t?.rules_only, tableState)} note="Scored by rules only." />
        <StatTile label="Intelligence ran with no reviews" value={loadedCount(t?.intelligence_without_reviews, tableState)} note="Can be redone once Serper works. Changes live decks." />
        <StatTile label="Searches at Google's 20 cap" value={searchError ? "?" : capped === null ? "–" : count(capped)} note="Each repeats as 4 smaller searches, with your OK." />
        <StatTile label="Areas and searches never run" value={searchError ? "?" : unsearched === null ? "–" : count(unsearched)} note="Inside a box, never searched or failed." />
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">What each city is missing</h2>
              <p className="mt-1 max-w-[80ch] text-[13px] leading-5 text-[var(--color-text-secondary)]">
                Tap a number to add that gap to the city's run; a city name takes its whole row. Its geo box opens under the row and the plan on the right.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" icon={RefreshCw} onClick={reloadAll} loading={loading} aria-label="Count again" />
              <Button icon={Plus} onClick={() => setAddOpen(true)}>Add a city</Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Show</span>
              <ChipGroup label="Show cities" options={filterOptions} value={filter} onChange={setFilter} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]" aria-label="Legend">
              {LEGEND.map((l) => (
                <span key={l.kind} className="inline-flex items-center gap-1.5">
                  <i aria-hidden="true" className={`inline-block h-3 w-3 rounded-[3px] border ${CELL_TONE[l.kind]}`} />{l.label}
                </span>
              ))}
            </div>
            {selectedRow && (
              <div className="flex flex-wrap items-center gap-2" aria-label="Quick plan">
                <Button size="sm" variant="secondary" onClick={() => setPicked(wholeRow(selectedRow.cells))}>Finish {selectedRow.city.city_name}</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked([])} disabled={picked.length === 0}>Clear</Button>
              </div>
            )}
            {searchError && <AlertCard variant="warning" title="Search gaps couldn't be read">{searchError} Unsearched and capped show "?".</AlertCard>}
          </div>

          {funnelError ? (
            <div className="px-5 pb-5"><AlertCard variant="error" title="Couldn't count the pipeline" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{funnelError}</AlertCard></div>
          ) : !funnel ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <>
              <div ref={scrollRef} className="overflow-x-auto border-t border-[var(--gray-200)]">
                <table className="w-full table-fixed border-collapse text-sm" aria-label="Pipeline gaps by city and stage">
                  <colgroup>
                    <col style={{ width: "96px" }} />
                    {MATRIX_COLUMNS.map((c) => <col key={c.id} />)}
                  </colgroup>
                  <thead>
                    <tr className="text-left align-bottom">
                      <th scope="col" className="sticky left-0 z-[1] bg-[var(--color-background-primary)] px-2 py-2 text-[11px] font-medium text-[var(--color-text-secondary)]">City</th>
                      {MATRIX_COLUMNS.map((c) => (
                        <th key={c.id} scope="col" className="px-0.5 py-2 align-bottom">
                          <span className="block text-[10.5px] font-semibold leading-[13px] tracking-[-0.01em] text-[var(--color-text-primary)]">{c.label}</span>
                          <span className="block text-[10px] font-normal leading-[12px] text-[var(--color-text-tertiary)]">{c.sub}</span>
                        </th>
                      ))}
                    </tr>
                    <tr className="border-y border-[var(--gray-200)] bg-[var(--gray-50)] align-top">
                      <th scope="row" className="sticky left-0 z-[1] bg-[var(--gray-50)] px-2 py-2 text-left text-[12px] font-semibold">All gaps</th>
                      {totals.map((c, i) => (
                        <td key={c.id} className="px-0.5 py-2 tabular-nums">
                          <span className={`block truncate text-[12px] ${c.gap ? "font-semibold text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]"}`}>{c.text}</span>
                          {totalCosts[i].text && <span className="block truncate text-[10.5px] text-[var(--color-text-secondary)]">{totalCosts[i].text}</span>}
                        </td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => {
                      const { city: c, cells, status } = row;
                      const run = runs[c.city_id];
                      const word = run ? runStatusWord(run.status) : null;
                      const isSel = c.city_id === selectedId;
                      const size = boxSizeText(boxes[c.city_id]);
                      return (
                        <Fragment key={c.city_id}>
                          <tr className={`border-b border-[var(--gray-100)] ${isSel ? "bg-[var(--color-brand-50)]" : ""}`}>
                            <th scope="row" className={`sticky left-0 z-[1] px-1 py-1 text-left font-normal ${isSel ? "bg-[var(--color-brand-50)]" : "bg-[var(--color-background-primary)]"}`}>
                              <button type="button" className="flex min-h-11 w-full min-w-0 cursor-pointer flex-col items-start justify-center rounded-lg px-1 text-left hover:bg-[var(--gray-50)]"
                                aria-expanded={isSel} onClick={() => pickCity(row)}>
                                <b className="block w-full break-words text-[12px] font-semibold leading-[15px] text-[var(--color-text-primary)]">{c.city_name}</b>
                                <span className="text-[10.5px] leading-[13px] text-[var(--color-text-secondary)]">{status}{word ? ` · run ${word.label.toLowerCase()}` : ""}</span>
                              </button>
                            </th>
                            {cells.map((cell, i) => {
                              const shownCell = cell.id === "box" ? boxCell(cell, size) : cell;
                              const state = isSel && picked.includes(cell.id) ? "picked" : isSel && needed.has(cell.id) ? "needed" : null;
                              return (
                                <td key={cell.id} className="px-0.5 py-1">
                                  <GapCell cell={shownCell} cost={cellCost(cell, rates)} state={state}
                                    cityName={c.city_name} label={MATRIX_COLUMNS[i].label}
                                    onToggle={pickable(cell) ? () => toggleCell(c.city_id, cell.id) : null} />
                                </td>
                              );
                            })}
                          </tr>
                          {isSel && (
                            <tr className="border-b border-[var(--gray-200)] bg-[var(--gray-50)]">
                              <td colSpan={MATRIX_COLUMNS.length + 1} className="p-0">
                                <div className="sticky left-0 flex flex-col gap-3 p-4" style={{ width: visibleWidth ?? undefined }} aria-label={`${c.city_name} setup`}>
                                  <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{c.city_name}: geo box and coverage</h3>
                                    <Button size="sm" variant="ghost" icon={X} onClick={() => { setSelectedId(null); setPicked([]); }}>Close</Button>
                                  </div>
                                  <CityBoxPanel city={c} onChanged={load} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {shown.length === 0 && (
                      <tr><td colSpan={MATRIX_COLUMNS.length + 1} className="px-5 py-6 text-sm text-[var(--color-text-secondary)]">No cities in this view.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-[var(--gray-200)]">
                <NoCityRow noCity={noCity} onAssigned={load} />
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--gray-200)] px-5 py-3 text-[13px] text-[var(--color-text-secondary)]">
                <span className="min-w-0 flex-1"><b className="font-semibold text-[var(--color-text-primary)]">Thumbnails</b> run on their own after the final check, because they only cover servable places. A run makes them for its own places.</span>
                <Button size="sm" variant="secondary" onClick={() => setToolsOpen(true)}>Open thumbnail tools</Button>
              </div>
              <div className="border-t border-[var(--gray-200)] px-5 py-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                Estimated: costs under each number use the rates a run uses (Google $0.032 a search, $0.007 a photo, Gemini at the server's per-place rate, Serper at your rate). The run checks the server's own cost before anything is spent. Counted {funnel.counted_at ? new Date(funnel.counted_at).toLocaleTimeString() : "just now"}.
              </div>
            </>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4" aria-label="Run plan">
          {selected ? (
            <CityRunPanel city={selected} latestRun={runs[selected.city_id] ?? null} serperRate={health?.serper_usd_per_request ?? null} onChanged={load} picks={picks}
              footer={<SerperRate health={health} onSaved={() => { loadHealth(); loadSpend(); }} />} />
          ) : (
            <SectionCard title="Run plan">
              <div className="flex flex-col gap-4">
                <p className="text-sm text-[var(--color-text-secondary)]">Pick a city on the left. You will see what a run would do, its cost and its limits here before anything starts.</p>
                <SerperRate health={health} onSaved={() => { loadHealth(); loadSpend(); }} />
              </div>
            </SectionCard>
          )}
        </aside>
      </div>

      <ScoringTools cityId={selected?.city_id ?? null} cityName={selected?.city_name ?? null} />

      <SectionCard title="Intelligence" subtitle="Reviews and Gemini per city. Runs here score their own places; nothing releases older held scores.">
        {tableSettled ? (
          <div className="flex flex-col gap-4">
            <ActiveRunsControlTower />
            <IntelligenceOverviewTab onCostModel={setCostModel} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]"><Spinner size="sm" /> Waiting for the gaps table first…</div>
        )}
      </SectionCard>

      <details open={toolsOpen} onToggle={(e) => setToolsOpen(e.currentTarget.open)} className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">Hand tools: seed chosen categories, refresh, photos, thumbnails</summary>
        {toolsOpen && (
          <div className="mt-4">
            <EmbeddedPageContext.Provider value={true}>
              <PlacePoolManagementPage key="pipeline" section="pipeline" />
            </EmbeddedPageContext.Provider>
          </div>
        )}
      </details>

      <AddCityModal open={addOpen} onClose={() => setAddOpen(false)} onSave={(city) => {
        setAddOpen(false);
        addToast({ variant: "success", title: `${city?.name ?? "City"} added`, description: "It stays hidden from Explorers until you switch it live on Cities." });
        reloadAll();
      }} />
    </section>
  );
}
