/**
 * AI VALIDATION PAGE (redesigned 2026-04-08)
 *
 * Phase 1: Command Center — dashboard with city attention cards,
 * category coverage heatmap, and recent runs.
 *
 * Phase 2 (TODO): Pipeline tab — configure + run validation with quality gates
 * Phase 3 (TODO): Review Queue tab — side-panel override workflow
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Globe, ShieldCheck, ShieldAlert, Shield, CheckCircle, XCircle,
  Zap, RefreshCw, Play, Pause, ChevronDown, ChevronRight, Clock,
  UtensilsCrossed, Wine, Coffee, Flower2, Film, Palette, TreePine,
  Gamepad2, ShoppingBag, Sparkles, AlertTriangle,
} from "lucide-react";
import { supabase, invokeWithRefresh } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { StatCard, SectionCard, AlertCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { CATEGORY_LABELS, CATEGORY_COLORS, ALL_CATEGORIES } from "../constants/categories";
import { RulesFilterTab } from "../components/rules-filter/RulesFilterTab";
import { isFlagEnabled } from "../lib/featureFlags";
// ORCH-0553 — Day-one dual-mount of SeedTab + RefreshTab on AI Validation page.
// Both tabs gate behind enable_refresh_tab admin_config flag.
import { SeedTab } from "../components/seeding/SeedTab";
import { RefreshTab } from "../components/seeding/RefreshTab";

// ── Constants ────────────────────────────────────────────────────────────────

// Short labels for the heatmap (space-constrained columns)
const CAT_SHORT_LABELS = {
  nature: "Nature", icebreakers: "Ice", drinks_and_music: "Drinks",
  brunch_lunch_casual: "Casual", upscale_fine_dining: "Fine",
  movies_theatre: "Movies", creative_arts: "Arts",
  play: "Play", flowers: "Flowers", groceries: "Grocery",
};

const CAT_ICONS = {
  brunch_lunch_casual: UtensilsCrossed, upscale_fine_dining: Sparkles,
  drinks_and_music: Wine, icebreakers: Coffee, flowers: Flower2,
  movies_theatre: Film, creative_arts: Palette, play: Gamepad2,
  nature: TreePine, groceries: ShoppingBag,
};

const STATUS_BADGE = {
  completed: "success", failed: "error", cancelled: "warning",
  running: "info", paused: "warning", ready: "default",
};

function fmt(n) { return n == null ? "—" : Number(n).toLocaleString(); }
function cost(n) { return n == null ? "$0.00" : `$${Number(n).toFixed(2)}`; }
function timeAgo(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function countryFlag(code) {
  if (!code || code.length !== 2) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// ── City Picker ─────────────────────────────────────────────────────────────

function CityPicker({ cities, selectedCityId, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const grouped = {};
  for (const c of (cities || [])) {
    const key = c.country_code || "??";
    if (!grouped[key]) grouped[key] = { countryName: c.country_name, countryCode: key, cities: [] };
    grouped[key].cities.push(c);
  }
  const groups = Object.values(grouped).sort((a, b) => a.countryName.localeCompare(b.countryName));

  const selected = selectedCityId ? cities.find((c) => c.city_id === selectedCityId) : null;
  const label = selected
    ? `${countryFlag(selected.country_code)} ${selected.city_name}`
    : "🌍 All Cities";

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] text-sm font-medium hover:border-[var(--color-brand-500)] transition-colors cursor-pointer">
        <span>{label}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-[9999] top-full mt-1 right-0 w-72 max-h-96 overflow-y-auto bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg shadow-lg">
          <button onClick={() => { onSelect(null); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-[var(--gray-100)] cursor-pointer ${!selectedCityId ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : ""}`}>
            🌍 All Cities
          </button>
          <div className="border-t border-[var(--gray-100)]" />
          {groups.map((group) => (
            <div key={group.countryCode}>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {countryFlag(group.countryCode)} {group.countryName}
              </div>
              {group.cities.map((c) => (
                <button key={c.city_id} onClick={() => { onSelect(c.city_id); setOpen(false); }}
                  className={`w-full text-left pl-7 pr-3 py-1.5 text-sm hover:bg-[var(--gray-100)] cursor-pointer flex justify-between ${selectedCityId === c.city_id ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-medium" : ""}`}>
                  <span>{c.city_name}</span>
                  <span className="text-xs text-[var(--color-text-tertiary)]">{(c.ai_approved_places || 0).toLocaleString()}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Coverage Heatmap ────────────────────────────────────────────────────────

function cellColor(count) {
  if (count === 0) return "var(--color-error-100)";
  if (count <= 5) return "var(--color-warning-100)";
  if (count <= 10) return "var(--color-warning-50)";
  if (count <= 20) return "var(--color-success-100)";
  return "var(--color-success-50)";
}

function cellTextColor(count) {
  if (count === 0) return "var(--color-error-700)";
  if (count <= 5) return "var(--color-warning-700)";
  if (count <= 20) return "var(--color-text-secondary)";
  return "var(--color-success-700)";
}

function CoverageHeatmap({ data, selectedCityId, cityStats }) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No coverage data yet. Seed and validate cities first.</p>;
  }

  // Group by city
  const cityMap = {};
  for (const row of data) {
    if (!cityMap[row.city_id]) {
      cityMap[row.city_id] = { city_id: row.city_id, city_name: row.city_name, country: row.country, cats: {} };
    }
    cityMap[row.city_id].cats[row.category] = { approved: row.approved_count };
  }

  let cities = Object.values(cityMap).sort((a, b) => a.city_name.localeCompare(b.city_name));
  if (selectedCityId) cities = cities.filter((c) => c.city_id === selectedCityId);

  // Column totals
  const colTotals = {};
  for (const cat of ALL_CATEGORIES) {
    colTotals[cat] = cities.reduce((sum, c) => sum + (c.cats[cat]?.approved || 0), 0);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left py-2 px-2 font-semibold text-[var(--color-text-secondary)] sticky left-0 bg-[var(--color-background-primary)] min-w-[120px]">City</th>
            {ALL_CATEGORIES.map((cat) => (
              <th key={cat} className="py-2 px-1 font-medium text-[var(--color-text-tertiary)] text-center min-w-[52px]" title={CATEGORY_LABELS[cat]}>
                {CAT_SHORT_LABELS[cat] || cat}
              </th>
            ))}
            <th className="py-2 px-2 font-semibold text-[var(--color-text-secondary)] text-center min-w-[52px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {cities.map((city) => {
            const rowTotal = ALL_CATEGORIES.reduce((sum, cat) => sum + (city.cats[cat]?.approved || 0), 0);
            // Get unvalidated count from cityStats RPC (accurate server-side data)
            const cityStatRow = (cityStats || []).find((s) => s.city_id === city.city_id);
            const unvalidatedCount = cityStatRow?.unvalidated || 0;
            return (
              <tr key={city.city_id} className="border-t border-[var(--gray-100)]">
                <td className="py-1.5 px-2 font-medium text-[var(--color-text-primary)] sticky left-0 bg-[var(--color-background-primary)]">
                  {city.city_name}
                  {unvalidatedCount > 0 && (
                    <span className="ml-1 text-[10px] text-[var(--color-warning-600)]">({unvalidatedCount.toLocaleString()} pending)</span>
                  )}
                </td>
                {ALL_CATEGORIES.map((cat) => {
                  const count = city.cats[cat]?.approved || 0;
                  return (
                    <td key={cat} className="py-1.5 px-1 text-center" title={`${city.city_name} × ${cat}: ${count} approved`}>
                      <span className="inline-block w-full rounded px-1 py-0.5 font-mono font-semibold text-[11px]"
                        style={{ backgroundColor: cellColor(count), color: cellTextColor(count) }}>
                        {count}
                      </span>
                    </td>
                  );
                })}
                <td className="py-1.5 px-2 text-center font-semibold text-[var(--color-text-primary)]">{rowTotal}</td>
              </tr>
            );
          })}
          {/* Column totals row */}
          <tr className="border-t-2 border-[var(--gray-300)]">
            <td className="py-2 px-2 font-bold text-[var(--color-text-primary)] sticky left-0 bg-[var(--color-background-primary)]">All Cities</td>
            {ALL_CATEGORIES.map((cat) => (
              <td key={cat} className="py-2 px-1 text-center font-bold text-[var(--color-text-primary)] text-[11px]">
                {colTotals[cat]}
              </td>
            ))}
            <td className="py-2 px-2 text-center font-bold text-[var(--color-text-primary)]">
              {Object.values(colTotals).reduce((a, b) => a + b, 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Needs Attention Cards ───────────────────────────────────────────────────

function NeedsAttentionCards({ cityStats, onValidateCity }) {
  if (!cityStats || cityStats.length === 0) return null;

  const cityAgg = {};
  for (const row of cityStats) {
    cityAgg[row.city_id] = row;
  }

  const citiesNeedingAttention = Object.values(cityAgg)
    .filter((c) => c.unvalidated > 0)
    .sort((a, b) => b.unvalidated - a.unvalidated);

  if (citiesNeedingAttention.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--color-success-50)] text-[var(--color-success-700)] text-sm">
        <CheckCircle className="w-4 h-4" />
        All cities fully validated
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {citiesNeedingAttention.map((city) => (
        <div key={city.city_id}
          className="rounded-lg border border-[var(--gray-200)] p-3 bg-[var(--color-background-primary)] hover:border-[var(--color-brand-300)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{city.city_name}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">{city.country}</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div>
              <p className="text-lg font-bold text-[var(--color-warning-700)]">{city.unvalidated}</p>
              <p className="text-[10px] text-[var(--color-text-tertiary)]">unvalidated</p>
            </div>
            <div>
              <p className="text-lg font-bold text-[var(--color-success-700)]">{city.approved}</p>
              <p className="text-[10px] text-[var(--color-text-tertiary)]">approved</p>
            </div>
          </div>
          <Button size="sm" variant="primary" icon={Zap} className="w-full"
            onClick={() => onValidateCity(city.city_id)}>
            Validate
          </Button>
        </div>
      ))}
    </div>
  );
}

// ── Command Center Tab ──────────────────────────────────────────────────────

function CommandCenterTab({ overview, cityOverview, coverageData, cityStats, recentRuns, selectedCityId, onValidateCity }) {
  // Use direct city query when city selected, global overview otherwise
  const stats = selectedCityId && cityOverview ? cityOverview : overview;

  const recentRunColumns = [
    { key: "created_at", label: "Date", render: (v) => <span className="text-xs">{timeAgo(v)}</span> },
    { key: "scope", label: "Scope", render: (v, r) => (
      <span className="text-xs">{r.city_filter || r.category_filter || v || "global"}</span>
    )},
    { key: "total_places", label: "Places", render: (v) => fmt(v) },
    { key: "approved", label: "Accepted", render: (v) => <span className="text-[var(--color-success-700)]">{fmt(v)}</span> },
    { key: "rejected", label: "Rejected", render: (v) => <span className="text-[var(--color-error-700)]">{fmt(v)}</span> },
    { key: "cost_usd", label: "Cost", render: (v) => <span className="font-mono">{cost(v)}</span> },
    { key: "status", label: "Status", render: (v) => <Badge variant={STATUS_BADGE[v] || "default"}>{v}</Badge> },
  ];

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon={Globe} label="Active Places" value={fmt(stats?.total_active)} />
        <StatCard icon={ShieldCheck} label="Validated" value={fmt(stats?.validated)} />
        <StatCard icon={ShieldAlert} label="Unvalidated" value={fmt(stats?.unvalidated)}
          className={stats?.unvalidated > 0 ? "border-l-4 border-l-[var(--color-warning-500)]" : ""} />
        <StatCard icon={CheckCircle} label="Approved" value={fmt(stats?.approved)} />
        <StatCard icon={XCircle} label="Rejected" value={fmt(stats?.rejected)} />
      </div>

      {/* Needs Attention */}
      <SectionCard title="Needs Attention" subtitle="Cities with unvalidated places">
        <NeedsAttentionCards cityStats={cityStats} onValidateCity={onValidateCity} />
      </SectionCard>

      {/* Coverage Heatmap */}
      <SectionCard title="Category Coverage" subtitle="Approved places per city × category">
        <CoverageHeatmap data={coverageData} selectedCityId={selectedCityId} cityStats={cityStats} />
      </SectionCard>

      {/* Recent Runs */}
      <SectionCard title="Recent Runs" subtitle="Last 5 pipeline runs">
        <DataTable columns={recentRunColumns} rows={recentRuns || []} loading={false}
          emptyMessage="No verification runs yet" emptyIcon={Clock} />
      </SectionCard>
    </div>
  );
}

// ── Placeholder Tabs ────────────────────────────────────────────────────────

// ── Pipeline Tab ────────────────────────────────────────────────────────────

const SCOPE_OPTIONS = [
  { value: "unvalidated", label: "Unvalidated only", desc: "Places not yet validated" },
  { value: "failed", label: "Failed only", desc: "Places where GPT errored — retry" },
  { value: "category", label: "Per category", desc: "Re-validate a specific category" },
  { value: "all", label: "All places", desc: "Re-validate everything (expensive)" },
];

const DECISION_ICON = {
  accept: { icon: CheckCircle, color: "text-[var(--color-success-600)]", bg: "bg-[var(--color-success-50)]" },
  reject: { icon: XCircle, color: "text-[var(--color-error-600)]", bg: "bg-[var(--color-error-50)]" },
  reclassify: { icon: RefreshCw, color: "text-[var(--color-info-600)]", bg: "bg-[var(--color-info-50)]" },
};

const CONF_BADGE = { high: "success", medium: "warning", low: "error" };
const DECISION_BADGE = { accept: "success", reclassify: "info", reject: "error" };

function PipelineTab({ invoke, selectedCityId, cities, toast, onRefresh, onSwitchTab }) {
  // Config state
  const [scope, setScope] = useState("unvalidated");
  const [category, setCategory] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  // Rules filter state
  const [rulesRunning, setRulesRunning] = useState(false);
  const [rulesResult, setRulesResult] = useState(null);

  // Run state
  const [activeRun, setActiveRun] = useState(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [feedItems, setFeedItems] = useState([]);
  const stopRef = useRef(false);
  const mountedRef = useRef(true);
  const feedPageRef = useRef(1);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; stopRef.current = true; }; }, []);

  // City name for display
  const cityName = selectedCityId
    ? (cities || []).find((c) => c.city_id === selectedCityId)?.city_name || "Selected City"
    : null;

  // Preview: auto-update on filter change
  useEffect(() => {
    if (!selectedCityId || !cityName) { setPreview(null); return; }
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const data = await invoke({
          action: "preview",
          scope,
          city: cityName,
          category: scope === "category" ? category : undefined,
          revalidate: scope === "all",
        });
        if (mountedRef.current) setPreview(data);
      } catch (err) {
        console.error("[Pipeline preview]", err);
      } finally {
        if (mountedRef.current) setPreviewLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [scope, category, selectedCityId, cityName, invoke]);

  // Check for active run on mount — auto-resume if running
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.rpc("admin_ai_recent_runs", { p_limit: 1 });
        if (data && data.length > 0 && ["ready", "running", "paused"].includes(data[0].status)) {
          const status = await invoke({ action: "run_status", run_id: data[0].id });
          if (mountedRef.current && status?.run) {
            setActiveRun(status.run);
            // Auto-resume the loop if the run is actively running
            if (status.run.status === "running") {
              startAutoRun(status.run.id);
            }
          }
        }
      } catch { /* ignore */ }
    })();
  }, [invoke]);

  const handleStart = async () => {
    if (!selectedCityId) { toast({ variant: "warning", title: "Select a city first" }); return; }
    if (scope === "all" && !confirm(`Re-validate ALL places in ${cityName}? This will re-process every place.`)) return;
    setStarting(true);
    try {
      const data = await invoke({
        action: "create_run",
        scope,
        city_id: selectedCityId,
        city: cityName,
        category: scope === "category" ? category : undefined,
        dry_run: dryRun,
        revalidate: scope === "all",
      });
      if (data.status === "already_active") {
        toast({ variant: "warning", title: "A run is already active" });
        const status = await invoke({ action: "run_status", run_id: data.run_id });
        if (status?.run) setActiveRun(status.run);
        return;
      }
      if (data.status === "nothing_to_do") {
        toast({ variant: "info", title: "No places to process with current filters" });
        return;
      }
      toast({ variant: "success", title: `Run started — ${fmt(data.total_places)} places queued` });
      const status = await invoke({ action: "run_status", run_id: data.run_id });
      setActiveRun(status?.run || { ...data, status: "ready" });
      setFeedItems([]);
      feedPageRef.current = 1;
      startAutoRun(data.run_id);
    } catch (err) {
      toast({ variant: "error", title: "Failed to start", description: err.message });
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const handleRunRulesFilter = async () => {
    if (!selectedCityId) { toast({ variant: "warning", title: "Select a city first" }); return; }
    setRulesRunning(true);
    setRulesResult(null);
    try {
      const data = await invoke({
        action: "run_rules_filter",
        scope: "all",
        city_id: selectedCityId,
        city: cityName,
        dry_run: dryRun,
      });
      if (data.status === "nothing_to_do") {
        toast({ variant: "info", title: "No places to process with current filters" });
        return;
      }
      setRulesResult(data);
      toast({
        variant: "success",
        title: `Rules filter complete — ${fmt(data.rejected)} rejected, ${fmt(data.modified)} modified, ${fmt(data.unchanged)} unchanged`,
      });
      if (onRefresh) onRefresh();
    } catch (err) {
      toast({ variant: "error", title: "Rules filter failed", description: err.message });
    } finally {
      if (mountedRef.current) setRulesRunning(false);
    }
  };

  const startAutoRun = async (runId) => {
    setAutoRunning(true);
    stopRef.current = false;

    while (!stopRef.current && mountedRef.current) {
      try {
        setRunningBatch(true);
        const data = await invoke({ action: "run_batch", run_id: runId });
        if (!mountedRef.current) break;
        setActiveRun(data.run_progress);

        // Fetch latest batch results for live feed (always page 1, dedup handles overlap)
        try {
          const results = await invoke({
            action: "get_results",
            job_id: runId,
            page: 1,
            page_size: 25,
          });
          if (results?.results?.length > 0 && mountedRef.current) {
            setFeedItems((prev) => {
              const existing = new Set(prev.map((r) => r.id));
              const newItems = (results.results || []).filter((r) => !existing.has(r.id));
              return [...newItems, ...prev];
            });
          }
        } catch { /* feed fetch failure is non-critical */ }

        if (data.done || data.auto_paused) {
          if (data.auto_paused) toast({ variant: "warning", title: "Run auto-paused — cost exceeded 2x estimate" });
          else toast({ variant: "success", title: `Verification complete! ${fmt(data.run_progress?.processed)} places processed` });
          break;
        }

        if (mountedRef.current) setRunningBatch(false);
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        if (mountedRef.current) {
          toast({ variant: "error", title: `Batch error: ${err.message}` });
          try {
            const status = await invoke({ action: "run_status", run_id: runId });
            setActiveRun(status?.run);
          } catch { /* ignore */ }
        }
        break;
      }
    }

    if (mountedRef.current) {
      setAutoRunning(false);
      setRunningBatch(false);
      onRefresh();
    }
  };

  const handlePause = async () => {
    stopRef.current = true;
    try {
      await invoke({ action: "pause_run", run_id: activeRun.id });
      setActiveRun((r) => ({ ...r, status: "paused" }));
      toast({ variant: "info", title: "Run paused" });
    } catch (err) { toast({ variant: "error", title: err.message }); }
  };

  const handleResume = async () => {
    try {
      await invoke({ action: "resume_run", run_id: activeRun.id });
      setActiveRun((r) => ({ ...r, status: "running" }));
      startAutoRun(activeRun.id);
    } catch (err) { toast({ variant: "error", title: err.message }); }
  };

  const handleStop = async () => {
    stopRef.current = true;
    try {
      const data = await invoke({ action: "stop_run", run_id: activeRun.id });
      setActiveRun(data.run_progress);
      toast({ variant: "info", title: "Run cancelled" });
      onRefresh();
    } catch (err) { toast({ variant: "error", title: err.message }); }
  };

  const resetRun = () => {
    setActiveRun(null);
    setFeedItems([]);
    feedPageRef.current = 1;
  };

  const isTerminal = activeRun && ["completed", "failed", "cancelled"].includes(activeRun.status);

  // ── No city selected ──
  if (!selectedCityId) {
    return (
      <div className="text-center py-16 space-y-3">
        <AlertTriangle className="w-10 h-10 mx-auto text-[var(--color-warning-500)]" />
        <p className="text-lg font-semibold text-[var(--color-text-primary)]">Select a city to run validation</p>
        <p className="text-sm text-[var(--color-text-secondary)]">Use the city picker in the header, or click "Validate" on a city card in the Command Center.</p>
      </div>
    );
  }

  // ── Active/completed run view ──
  if (activeRun) {
    const progress = activeRun.total_places ? (activeRun.processed / activeRun.total_places) * 100 : 0;
    const reviewCount = (activeRun.low_confidence || 0) + (activeRun.reclassified || 0);

    return (
      <div className="space-y-6">
        <SectionCard
          title={`AI Verification — ${cityName || "Run"}`}
          subtitle={`${fmt(activeRun.total_places)} places · Est. ${cost(activeRun.estimated_cost_usd)}`}
          badge={<Badge variant={STATUS_BADGE[activeRun.status] || "default"}>{activeRun.status}</Badge>}
        >
          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="font-semibold text-[var(--color-text-primary)]">{fmt(activeRun.processed)} / {fmt(activeRun.total_places)}</span>
              <span className="font-medium">{progress.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--gray-200)]">
              <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
            {[
              { label: "Accepted", value: activeRun.approved, color: "success" },
              { label: "Rejected", value: activeRun.rejected, color: "error" },
              { label: "Reclassified", value: activeRun.reclassified, color: "info" },
              { label: "Low Conf.", value: activeRun.low_confidence, color: "warning" },
              { label: "Failed", value: activeRun.failed, color: "error" },
              { label: "Cost", value: cost(activeRun.cost_usd), raw: true },
            ].map((s) => (
              <div key={s.label} className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg p-3 text-center">
                <p className={`text-xl font-bold ${s.color ? `text-[var(--color-${s.color}-700)]` : "text-[var(--color-text-primary)]"}`}>
                  {s.raw ? s.value : fmt(s.value)}
                </p>
                <p className="text-[11px] text-[var(--color-text-tertiary)]">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Run complete banner */}
          {isTerminal && (
            <AlertCard variant={activeRun.status === "completed" ? "success" : "warning"}
              title={activeRun.status === "completed" ? "Verification complete!" : `Run ${activeRun.status}`}>
              {fmt(activeRun.processed)} processed: {fmt(activeRun.approved)} accepted, {fmt(activeRun.rejected)} rejected, {fmt(activeRun.reclassified)} reclassified. Cost: {cost(activeRun.cost_usd)}
            </AlertCard>
          )}

          {/* What's Next (terminal only) */}
          {isTerminal && (
            <div className="space-y-2 mt-4">
              <p className="text-sm font-semibold text-[var(--color-text-secondary)]">What's next:</p>
              {reviewCount > 0 && (
                <Button variant="primary" className="w-full justify-start" icon={ShieldCheck}
                  onClick={() => onSwitchTab("review")}>
                  ① Review {fmt(reviewCount)} items needing attention
                </Button>
              )}
              <Button variant="secondary" className="w-full justify-start" icon={Zap}
                onClick={() => { window.location.hash = "#/place-pool"; }}>
                ② Generate cards for {cityName}
              </Button>
              <Button variant="secondary" className="w-full justify-start" icon={Globe}
                onClick={() => onSwitchTab("command")}>
                ③ Check category coverage
              </Button>
              <Button variant="ghost" className="w-full" onClick={resetRun}>
                Start New Run
              </Button>
            </div>
          )}

          {/* Controls (non-terminal) */}
          {!isTerminal && (
            <div className="flex justify-end gap-3 mt-4">
              {activeRun.status === "running" && autoRunning && (
                <>
                  <Button variant="secondary" icon={Pause} onClick={handlePause}>Pause</Button>
                  <Button variant="ghost" className="text-[var(--color-error-700)]" onClick={handleStop}>Stop Run</Button>
                </>
              )}
              {activeRun.status === "running" && !autoRunning && (
                <>
                  <Button variant="primary" icon={Play} onClick={() => startAutoRun(activeRun.id)}>Resume Processing</Button>
                  <Button variant="ghost" className="text-[var(--color-error-700)]" onClick={handleStop}>Stop Run</Button>
                </>
              )}
              {activeRun.status === "paused" && (
                <>
                  <Button variant="primary" icon={Play} onClick={handleResume}>Resume</Button>
                  <Button variant="ghost" className="text-[var(--color-error-700)]" onClick={handleStop}>Stop Run</Button>
                </>
              )}
            </div>
          )}
        </SectionCard>

        {/* Live Feed */}
        {feedItems.length > 0 && (
          <SectionCard title="Live Feed" subtitle={`${feedItems.length} results`}>
            <div className="max-h-[400px] overflow-y-auto space-y-1">
              {feedItems.map((item, i) => {
                const dec = DECISION_ICON[item.decision] || DECISION_ICON.accept;
                const DecIcon = dec.icon;
                return (
                  <div key={item.id || i} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${dec.bg} text-sm`}>
                    <DecIcon className={`w-4 h-4 shrink-0 ${dec.color}`} />
                    <span className="font-medium text-[var(--color-text-primary)] min-w-[180px] truncate">{item.place_name}</span>
                    <div className="flex gap-1 flex-wrap">
                      {(item.new_categories || []).map((cat) => (
                        <span key={cat} className="px-1.5 py-0.5 text-[10px] rounded-full font-medium text-white"
                          style={{ backgroundColor: CATEGORY_COLORS[cat] || "#6b7280" }}>
                          {CATEGORY_LABELS[cat] || cat}
                        </span>
                      ))}
                    </div>
                    <Badge variant={CONF_BADGE[item.confidence] || "default"} className="ml-auto text-[10px]">
                      {item.confidence}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}
      </div>
    );
  }

  // ── Configuration view ──
  return (
    <div className="space-y-6">
      <SectionCard title={`Configure Verification — ${cityName}`}>
        <div className="space-y-4">
          {/* Scope */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">Scope</label>
            <div className="grid grid-cols-2 gap-2">
              {SCOPE_OPTIONS.map((opt) => (
                <button key={opt.value} onClick={() => setScope(opt.value)}
                  className={[
                    "rounded-lg border p-3 text-left transition-all cursor-pointer",
                    scope === opt.value
                      ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-1 ring-[var(--color-brand-500)]"
                      : "border-[var(--gray-200)] hover:border-[var(--gray-300)]",
                  ].join(" ")}>
                  <p className={`text-sm font-semibold ${scope === opt.value ? "text-[var(--color-brand-700)]" : "text-[var(--color-text-primary)]"}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Category picker (when scope = category) */}
          {scope === "category" && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] text-sm">
                <option value="">All categories</option>
                {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
              </select>
            </div>
          )}

          {/* Preview */}
          <div className="bg-[var(--gray-50)] rounded-lg p-4">
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><Spinner size="sm" /> Calculating...</div>
            ) : preview ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-lg font-semibold text-[var(--color-text-primary)]">{fmt(preview.places_to_process)}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Places to process</p>
                </div>
                <div>
                  <p className="text-lg font-semibold font-mono text-[var(--color-text-primary)]">{cost(preview.estimated_cost_usd)}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Estimated cost</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-[var(--color-text-primary)]">~{preview.estimated_minutes} min</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Estimated time</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-tertiary)]">Select a scope to see preview</p>
            )}
          </div>

          {/* Dry run */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--gray-300)] text-[var(--color-brand-500)]" />
            <span className="text-[var(--color-text-primary)]">Dry run (preview without writing)</span>
          </label>

          {/* Rules Filter Button — always enabled when city selected (processes all places, not just unvalidated) */}
          <Button variant="secondary" icon={Shield} onClick={handleRunRulesFilter}
            disabled={rulesRunning || !selectedCityId}
            loading={rulesRunning}
            className="w-full">
            {rulesRunning
              ? "Running Rules Filter..."
              : "Run Rules Filter — Free"}
          </Button>
          <p className="text-xs text-[var(--color-text-tertiary)] -mt-2">
            Applies hardcoded rules only (blocked types, category corrections, fine dining promotion). No AI credits used.
          </p>

          {/* Rules Filter Progress */}
          {rulesRunning && (
            <div className="bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Spinner size="sm" />
                <div>
                  <p className="text-sm font-semibold text-[var(--color-brand-700)]">Processing all places in {cityName}...</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">Checking blocked types, category corrections, fine dining promotions. This takes 30-90 seconds for most cities. No credits used.</p>
                </div>
              </div>
            </div>
          )}

          {/* Rules Filter Results */}
          {rulesResult && !rulesRunning && (
            <div className="bg-[var(--color-success-50)] border border-[var(--color-success-200)] rounded-lg p-4">
              <p className="text-sm font-semibold text-[var(--color-success-700)] mb-2">Rules Filter Complete — {cityName}</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-lg font-semibold text-[var(--color-text-primary)]">{fmt(rulesResult.total_processed)}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Processed</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-[var(--color-error-600)]">{fmt(rulesResult.rejected)}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Rejected</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-[var(--color-info-600)]">{fmt(rulesResult.modified)}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Modified</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-[var(--color-text-tertiary)]">{fmt(rulesResult.unchanged)}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">Unchanged</p>
                </div>
              </div>
              {rulesResult.dry_run && (
                <p className="text-xs text-[var(--color-warning-600)] mt-2 font-medium">⚠ Dry run — no changes written</p>
              )}
            </div>
          )}

          {/* Start AI Verification */}
          <Button variant="primary" icon={Play} onClick={handleStart}
            disabled={starting || !preview?.places_to_process}
            loading={starting}
            className="w-full">
            {starting ? "Starting..." : `Start Verification (${fmt(preview?.places_to_process || 0)} places)`}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Review Queue Tab ────────────────────────────────────────────────────────

const REVIEW_FILTERS = [
  { id: "all", label: "All" },
  { id: "low_confidence", label: "Low Confidence" },
  { id: "reclassified", label: "Reclassified" },
  { id: "overridden", label: "Overridden" },
];

function ReviewQueueTab({ invoke, toast }) {
  const [filter, setFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("");
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [placeDetail, setPlaceDetail] = useState(null);
  const [overrideDecision, setOverrideDecision] = useState("");
  const [overrideCats, setOverrideCats] = useState(new Set());
  const [overrideReason, setOverrideReason] = useState("");
  const [saving, setSaving] = useState(false);
  const PAGE_SIZE = 20;

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke({
        action: "review_queue",
        filter,
        page: page + 1,
        page_size: PAGE_SIZE,
      });
      let results = data.items || [];
      // Client-side category filter
      if (catFilter) {
        results = results.filter((r) => (r.new_categories || []).includes(catFilter));
      }
      setItems(results);
      setTotalCount(catFilter ? results.length : (data.total_count || 0));
    } catch (err) {
      toast({ variant: "error", title: "Failed to load review queue", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [invoke, filter, catFilter, page, toast]);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => { setPage(0); setSelected(null); setPlaceDetail(null); }, [filter, catFilter]);

  const selectItem = async (item) => {
    setSelected(item);
    setPlaceDetail(null);
    setOverrideDecision("");
    setOverrideCats(new Set(item.new_categories || []));
    setOverrideReason("");
    // Fetch place metadata
    if (item.place_id) {
      const { data } = await supabase
        .from("place_pool")
        .select("rating, price_level, review_count, primary_type, website")
        .eq("id", item.place_id)
        .single();
      if (data) setPlaceDetail(data);
    }
  };

  const toggleCat = (cat) => {
    setOverrideCats((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const handleOverride = async () => {
    if (!selected || !overrideDecision) return;
    setSaving(true);
    try {
      const cats = overrideDecision === "reject" ? [] : Array.from(overrideCats);
      await invoke({
        action: "override",
        result_id: selected.id,
        decision: overrideDecision,
        categories: cats,
        reason: overrideReason || null,
      });
      toast({ variant: "success", title: `Override saved for "${selected.place_name}"` });
      // Move to next item
      const currentIdx = items.findIndex((i) => i.id === selected.id);
      const nextItem = items[currentIdx + 1] || items[currentIdx - 1] || null;
      loadQueue();
      if (nextItem) selectItem(nextItem); else setSelected(null);
    } catch (err) {
      toast({ variant: "error", title: "Override failed", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Empty state: no items at all
  if (!loading && items.length === 0 && page === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <CheckCircle className="w-12 h-12 mx-auto text-[var(--color-success-500)]" />
        <p className="text-lg font-semibold text-[var(--color-text-primary)]">
          {filter === "all" ? "No items need review" : `No ${filter.replace(/_/g, " ")} items`}
        </p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          All decisions are high-confidence. Run a validation to generate review items.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4" style={{ minHeight: "600px" }}>
      {/* Left Panel — Item List */}
      <div className="w-[340px] shrink-0 flex flex-col border border-[var(--gray-200)] rounded-xl bg-[var(--color-background-primary)] overflow-hidden">
        {/* Header */}
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-tertiary)]">Review Queue</p>
          <p className="text-[13px] text-[var(--color-text-secondary)]">{totalCount} items{catFilter ? ` · ${CATEGORY_LABELS[catFilter] || catFilter}` : ""}</p>
        </div>

        {/* Filter tabs — decision type */}
        <div className="flex border-b border-[var(--gray-200)] px-1 pb-1 gap-1">
          {REVIEW_FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                filter === f.id
                  ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  : "text-[var(--color-text-tertiary)] hover:bg-[var(--gray-50)]"
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div className="px-2 py-1.5 border-b border-[var(--gray-100)]">
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
            className="w-full px-2 py-1 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[12px] text-[var(--color-text-secondary)]">
            <option value="">All Categories</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
          </select>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Spinner size="sm" /></div>
          ) : (
            items.map((item) => {
              const dec = DECISION_ICON[item.decision] || DECISION_ICON.accept;
              const DecIcon = dec.icon;
              const isSelected = selected?.id === item.id;
              const primaryCat = (item.new_categories || [])[0];
              return (
                <button key={item.id} onClick={() => selectItem(item)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2.5 border-b border-[var(--gray-100)] transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[var(--color-brand-50)] border-l-[3px] border-l-[var(--color-brand-500)]"
                      : "hover:bg-[var(--gray-50)]"
                  }`}>
                  <DecIcon className={`w-4 h-4 shrink-0 ${dec.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{item.place_name}</p>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {primaryCat && (
                        <span className="px-1.5 py-0.5 text-[9px] rounded-full font-medium text-white shrink-0"
                          style={{ backgroundColor: CATEGORY_COLORS[primaryCat] || "#6b7280" }}>
                          {CATEGORY_LABELS[primaryCat] || primaryCat}
                        </span>
                      )}
                      <p className="text-[11px] text-[var(--color-text-tertiary)] truncate">{item.place_address}</p>
                    </div>
                  </div>
                  <Badge variant={CONF_BADGE[item.confidence] || "default"} className="text-[10px] shrink-0">
                    {item.confidence}
                  </Badge>
                </button>
              );
            })
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--gray-200)] text-[11px] text-[var(--color-text-tertiary)]">
          <span>{items.length > 0 ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, totalCount)}` : "0"} of {totalCount}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2 py-1 rounded hover:bg-[var(--gray-100)] disabled:opacity-30 cursor-pointer">←</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount}
              className="px-2 py-1 rounded hover:bg-[var(--gray-100)] disabled:opacity-30 cursor-pointer">→</button>
          </div>
        </div>
      </div>

      {/* Right Panel — Detail */}
      <div className="flex-1 border border-[var(--gray-200)] rounded-xl bg-[var(--color-background-primary)] overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-tertiary)]">
            Select a place from the list to see details
          </div>
        ) : (
          <>
            {/* Detail content — scrollable */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Identity Bar — dense, all key info */}
              <div className="border-b border-[var(--gray-200)] pb-4">
                <div className="flex items-start justify-between">
                  <h3 className="text-[18px] font-semibold text-[var(--color-text-primary)]">{selected.place_name}</h3>
                  {placeDetail && (
                    <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)] shrink-0 ml-3">
                      {placeDetail.rating && <span>★ {placeDetail.rating}</span>}
                      {placeDetail.price_level && <span>·</span>}
                      {placeDetail.price_level && <span>{placeDetail.price_level === "PRICE_LEVEL_INEXPENSIVE" ? "$" : placeDetail.price_level === "PRICE_LEVEL_MODERATE" ? "$$" : placeDetail.price_level === "PRICE_LEVEL_EXPENSIVE" ? "$$$" : placeDetail.price_level === "PRICE_LEVEL_VERY_EXPENSIVE" ? "$$$$" : placeDetail.price_level}</span>}
                      {placeDetail.review_count && <span>· {placeDetail.review_count} reviews</span>}
                    </div>
                  )}
                </div>
                <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5">{selected.place_address}</p>
                {placeDetail?.primary_type && (
                  <p className="text-[11px] font-mono text-[var(--color-text-tertiary)] mt-1">{placeDetail.primary_type}</p>
                )}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Badge variant={DECISION_BADGE[selected.decision] || "default"}>{selected.decision}</Badge>
                  <Badge variant={CONF_BADGE[selected.confidence] || "default"}>{selected.confidence}</Badge>
                  {(selected.new_categories || []).map((cat) => (
                    <span key={cat} className="px-2 py-0.5 text-[11px] rounded-full font-medium text-white"
                      style={{ backgroundColor: CATEGORY_COLORS[cat] || "#6b7280" }}>
                      {CATEGORY_LABELS[cat] || cat}
                    </span>
                  ))}
                </div>
              </div>

              {/* Primary Identity */}
              {selected.primary_identity && (
                <div className="bg-[var(--gray-50)] rounded-lg p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">Primary Identity</p>
                  <p className="text-sm text-[var(--color-text-primary)]">{selected.primary_identity}</p>
                </div>
              )}

              {/* AI Reasoning */}
              {selected.reason && (
                <div className="bg-[var(--gray-50)] rounded-lg p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">AI Reasoning</p>
                  <p className="text-sm text-[var(--color-text-primary)]">{selected.reason}</p>
                </div>
              )}

              {/* Evidence */}
              {selected.evidence && (
                <div className="bg-[var(--gray-50)] rounded-lg p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">Web Evidence</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">{selected.evidence}</p>
                </div>
              )}

              {/* Previous categories (if reclassified) */}
              {selected.decision === "reclassify" && selected.previous_categories?.length > 0 && (
                <div className="bg-[var(--color-info-50)] rounded-lg p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-info-700)] mb-1">Previous Categories</p>
                  <div className="flex gap-1 flex-wrap">
                    {selected.previous_categories.map((cat) => (
                      <span key={cat} className="px-2 py-0.5 text-[11px] rounded-full font-medium bg-[var(--gray-200)] text-[var(--color-text-secondary)]">
                        {CATEGORY_LABELS[cat] || cat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Already overridden notice */}
              {selected.overridden && (
                <div className="bg-[var(--color-warning-50)] rounded-lg p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-warning-700)] mb-1">Previously Overridden</p>
                  <p className="text-sm text-[var(--color-text-primary)]">
                    Decision: {selected.override_decision} · {selected.override_reason || "No reason given"}
                  </p>
                </div>
              )}
            </div>

            {/* Override Controls — pinned at bottom */}
            <div className="border-t border-[var(--gray-200)] p-4 space-y-3 bg-[var(--color-background-primary)]">
              <p className="text-xs font-semibold text-[var(--color-text-secondary)]">Override Decision</p>
              <div className="flex gap-2">
                {["accept", "reject", "reclassify"].map((d) => (
                  <button key={d} onClick={() => setOverrideDecision(d)}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                      overrideDecision === d
                        ? d === "accept" ? "bg-[var(--color-success-50)] border-[var(--color-success-500)] text-[var(--color-success-700)]"
                        : d === "reject" ? "bg-[var(--color-error-50)] border-[var(--color-error-500)] text-[var(--color-error-700)]"
                        : "bg-[var(--color-info-50)] border-[var(--color-info-500)] text-[var(--color-info-700)]"
                        : "border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:border-[var(--gray-300)]"
                    }`}>
                    {d === "accept" ? "✓ Accept" : d === "reject" ? "✗ Reject" : "↔ Edit Categories"}
                  </button>
                ))}
              </div>

              {/* Category pills (for accept/reclassify) */}
              {overrideDecision && overrideDecision !== "reject" && (
                <div>
                  <p className="text-[11px] text-[var(--color-text-tertiary)] mb-1.5">Categories</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_CATEGORIES.map((cat) => {
                      const active = overrideCats.has(cat);
                      return (
                        <button key={cat} onClick={() => toggleCat(cat)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                            active ? "text-white border-transparent" : "bg-transparent border-[var(--gray-300)] text-[var(--color-text-secondary)]"
                          }`}
                          style={active ? { backgroundColor: CATEGORY_COLORS[cat] } : {}}>
                          {CATEGORY_LABELS[cat] || cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Reason */}
              {overrideDecision && (
                <input type="text" placeholder="Reason (optional)"
                  value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm text-[var(--color-text-primary)]" />
              )}

              {/* Save */}
              <Button variant="primary" className="w-full" onClick={handleOverride}
                disabled={!overrideDecision || saving}
                loading={saving}>
                Save Override
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function AIValidationPage() {
  const { addToast } = useToast();
  const [tab, setTab] = useState("command");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Data
  const [overview, setOverview] = useState(null);
  const [cityOverview, setCityOverview] = useState(null);
  const [coverageData, setCoverageData] = useState([]);
  const [cityStats, setCityStats] = useState([]);
  const [recentRuns, setRecentRuns] = useState([]);
  const [cities, setCities] = useState([]);
  const [selectedCityId, setSelectedCityId] = useState(null);
  const [rulesTabFlagEnabled, setRulesTabFlagEnabled] = useState(false);
  // ORCH-0553 — gates BOTH the new "Seeding" and "Refresh" tabs on this page.
  const [refreshTabFlagEnabled, setRefreshTabFlagEnabled] = useState(false);

  // Edge function invoke helper — wrapped with session pre-refresh + 401 retry (ORCH-0541)
  const invoke = useCallback(async (body) => {
    const { data, error: fnErr } = await invokeWithRefresh("ai-verify-pipeline", { body });
    if (fnErr) {
      // Try to extract error message from response body (Supabase wraps it)
      const msg = data?.error || fnErr.message || "Edge function error";
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: ov }, { data: cov }, { data: rr }, { data: pickerCities }, { data: cs }] = await Promise.all([
        supabase.rpc("admin_ai_validation_overview"),
        supabase.rpc("admin_ai_city_category_coverage"),
        supabase.rpc("admin_ai_recent_runs", { p_limit: 5 }),
        supabase.rpc("admin_city_picker_data"),
        supabase.rpc("admin_ai_city_stats"),
      ]);
      setOverview(ov);
      setCoverageData(cov || []);
      setRecentRuns(rr || []);
      setCities(pickerCities || []);
      setCityStats(cs || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load city-specific stats when a city is selected (server-side RPC)
  useEffect(() => {
    if (!selectedCityId) { setCityOverview(null); return; }
    (async () => {
      const { data } = await supabase.rpc("admin_ai_city_overview", { p_city_id: selectedCityId });
      if (data) setCityOverview(data);
    })();
  }, [selectedCityId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    let alive = true;
    // ORCH-0553 — batch fetch both flags so we don't make two sequential RPC calls.
    Promise.all([
      isFlagEnabled('enable_rules_filter_tab'),
      isFlagEnabled('enable_refresh_tab'),
    ]).then(([rules, refresh]) => {
      if (alive) {
        setRulesTabFlagEnabled(rules);
        setRefreshTabFlagEnabled(refresh);
      }
    });
    return () => { alive = false; };
  }, []);

  const handleValidateCity = (cityId) => {
    setSelectedCityId(cityId);
    setTab("pipeline");
    // Pipeline tab will read selectedCityId to pre-scope the run (Phase 2)
  };

  const tabs = [
    { id: "command", label: "Command Center" },
    { id: "rules", label: "Rules Filter" },
    // ORCH-0553 — Seeding + Refresh tabs (both gated on enable_refresh_tab flag)
    { id: "seed", label: "Seeding" },
    { id: "refresh", label: "Refresh" },
    { id: "pipeline", label: "Pipeline" },
    { id: "review", label: "Review Queue" },
  ];

  if (loading) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-brand-50)] flex items-center justify-center">
            <Brain className="h-5 w-5 text-[var(--color-brand-500)]" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">AI Validation</h1>
        </div>
        <div className="grid grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-[var(--gray-100)] animate-pulse" />)}
        </div>
        <div className="h-64 rounded-xl bg-[var(--gray-100)] animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 space-y-6">
        <AlertCard variant="error" title="Couldn't load validation data" action={
          <Button size="sm" onClick={loadAll}>Try Again</Button>
        }>
          {error}
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-brand-50)] flex items-center justify-center">
            <Brain className="h-5 w-5 text-[var(--color-brand-500)]" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">AI Validation</h1>
        </div>
        <div className="flex items-center gap-2">
          <CityPicker cities={cities} selectedCityId={selectedCityId} onSelect={setSelectedCityId} />
          <Button variant="secondary" icon={RefreshCw} size="sm" onClick={loadAll}>Refresh</Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={tab} onChange={setTab} />

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {tab === "command" && (
            <CommandCenterTab
              overview={overview}
              cityOverview={cityOverview}
              coverageData={coverageData}
              cityStats={cityStats}
              recentRuns={recentRuns}
              selectedCityId={selectedCityId}
              onValidateCity={handleValidateCity}
            />
          )}
          {tab === "pipeline" && (
            <PipelineTab
              invoke={invoke}
              selectedCityId={selectedCityId}
              cities={cities}
              toast={addToast}
              onRefresh={loadAll}
              onSwitchTab={setTab}
            />
          )}
          {tab === "rules" && (
            <RulesFilterTab
              selectedCityId={selectedCityId}
              cityName={cities.find((c) => c.id === selectedCityId)?.name || null}
              cities={cities}
              invoke={invoke}
              toast={addToast}
              flagEnabled={rulesTabFlagEnabled}
            />
          )}
          {tab === "seed" && (
            // ORCH-0553 — SeedTab on AIValidation page (gated by enable_refresh_tab).
            // tiles=[] → SeedTab renders "Tile Grid: 0 tiles" header, which is correct
            // UX (admin must go to Place Pool to generate tiles before seeding here).
            refreshTabFlagEnabled ? (
              <SeedTab
                city={cities.find((c) => c.id === selectedCityId) || null}
                tiles={[]}
                onRefresh={loadAll}
                onDeleteCity={() => {}}
                onSeedingChange={() => {}}
              />
            ) : (
              <div className="text-center py-16 text-[var(--color-text-secondary)]">
                <div className="text-sm font-medium">Seeding tab — coming soon</div>
                <div className="text-xs mt-1">
                  Enable <code className="text-xs">enable_refresh_tab</code> in admin_config to use.
                </div>
              </div>
            )
          )}
          {tab === "refresh" && (
            <RefreshTab
              city={cities.find((c) => c.id === selectedCityId) || null}
              cities={cities}
              onRefresh={loadAll}
              onRefreshChange={() => {}}
              flagEnabled={refreshTabFlagEnabled}
            />
          )}
          {tab === "review" && <ReviewQueueTab invoke={invoke} toast={addToast} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
