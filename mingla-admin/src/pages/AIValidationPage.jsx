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
  Brain, Globe, ShieldCheck, ShieldAlert, CheckCircle, XCircle,
  Zap, RefreshCw, Play, ChevronDown, ChevronRight, Clock,
  UtensilsCrossed, Wine, Coffee, Flower2, Eye, Music, Palette, TreePine,
  Gamepad2, Heart, ShoppingBag, MapPin, Sparkles, AlertTriangle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { StatCard, SectionCard, AlertCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "nature_views", "first_meet", "picnic_park", "drink", "casual_eats",
  "fine_dining", "watch", "live_performance", "creative_arts", "play",
  "wellness", "flowers", "groceries",
];

const CAT_LABELS = {
  nature_views: "Nature", first_meet: "1st Meet", picnic_park: "Picnic",
  drink: "Drink", casual_eats: "Casual", fine_dining: "Fine Din.",
  watch: "Watch", live_performance: "Live", creative_arts: "Arts",
  play: "Play", wellness: "Wellness", flowers: "Flowers", groceries: "Grocery",
};

const CAT_COLORS = {
  nature_views: "#22c55e", first_meet: "#f97316", picnic_park: "#84cc16",
  drink: "#a855f7", casual_eats: "#ef4444", fine_dining: "#dc2626",
  watch: "#3b82f6", live_performance: "#8b5cf6", creative_arts: "#ec4899",
  play: "#f59e0b", wellness: "#14b8a6", flowers: "#f472b6", groceries: "#6b7280",
};

const CAT_ICONS = {
  casual_eats: UtensilsCrossed, fine_dining: Sparkles, drink: Wine,
  first_meet: Coffee, flowers: Flower2, watch: Eye, live_performance: Music,
  creative_arts: Palette, play: Gamepad2, wellness: Heart,
  nature_views: TreePine, picnic_park: MapPin, groceries: ShoppingBag,
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
  for (const cat of CATEGORIES) {
    colTotals[cat] = cities.reduce((sum, c) => sum + (c.cats[cat]?.approved || 0), 0);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left py-2 px-2 font-semibold text-[var(--color-text-secondary)] sticky left-0 bg-[var(--color-background-primary)] min-w-[120px]">City</th>
            {CATEGORIES.map((cat) => (
              <th key={cat} className="py-2 px-1 font-medium text-[var(--color-text-tertiary)] text-center min-w-[52px]" title={cat}>
                {CAT_LABELS[cat]}
              </th>
            ))}
            <th className="py-2 px-2 font-semibold text-[var(--color-text-secondary)] text-center min-w-[52px]">Total</th>
          </tr>
        </thead>
        <tbody>
          {cities.map((city) => {
            const rowTotal = CATEGORIES.reduce((sum, cat) => sum + (city.cats[cat]?.approved || 0), 0);
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
                {CATEGORIES.map((cat) => {
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
            {CATEGORIES.map((cat) => (
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

function PipelinePlaceholder() {
  return (
    <div className="text-center py-16 space-y-3">
      <Play className="w-12 h-12 mx-auto text-[var(--color-text-tertiary)]" />
      <p className="text-lg font-semibold text-[var(--color-text-primary)]">Pipeline — Coming Soon</p>
      <p className="text-sm text-[var(--color-text-secondary)] max-w-md mx-auto">
        Configure and run AI validation with stage-by-stage quality gates, live progress feed, and full pipeline transparency.
      </p>
    </div>
  );
}

function ReviewQueuePlaceholder() {
  return (
    <div className="text-center py-16 space-y-3">
      <ShieldCheck className="w-12 h-12 mx-auto text-[var(--color-text-tertiary)]" />
      <p className="text-lg font-semibold text-[var(--color-text-primary)]">Review Queue — Coming Soon</p>
      <p className="text-sm text-[var(--color-text-secondary)] max-w-md mx-auto">
        Side-panel review for low-confidence decisions. See full pipeline trace, web search results, and override with one click.
      </p>
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

  const handleValidateCity = (cityId) => {
    setSelectedCityId(cityId);
    setTab("pipeline");
    // Pipeline tab will read selectedCityId to pre-scope the run (Phase 2)
  };

  const tabs = [
    { id: "command", label: "Command Center" },
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
          {tab === "pipeline" && <PipelinePlaceholder />}
          {tab === "review" && <ReviewQueuePlaceholder />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
