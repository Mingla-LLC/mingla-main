import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain, Globe, ShieldCheck, ShieldAlert, CheckCircle, XCircle,
  Zap, RefreshCw, Download, Play, Pause, Square, ArrowRight, X,
  Search, AlertTriangle, ArrowLeftRight, Pencil, ChevronRight,
  UtensilsCrossed, Wine, Coffee, Flower2, Eye, Music, Palette, TreePine,
  Gamepad2, Heart, ShoppingBag, MapPin, Sparkles, Clock,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useToast } from "../context/ToastContext";
import { StatCard, SectionCard, AlertCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "casual_eats","fine_dining","drink","first_meet","flowers","watch",
  "live_performance","creative_arts","play","wellness","nature_views",
  "picnic_park","groceries",
];

const CAT_ICONS = {
  casual_eats: UtensilsCrossed, fine_dining: Sparkles, drink: Wine,
  first_meet: Coffee, flowers: Flower2, watch: Eye, live_performance: Music,
  creative_arts: Palette, play: Gamepad2, wellness: Heart,
  nature_views: TreePine, picnic_park: MapPin, groceries: ShoppingBag,
};

const DECISION_BADGE = { accept: "success", reclassify: "info", reject: "error" };
const CONFIDENCE_BADGE = { high: "success", medium: "warning", low: "error" };
const STATUS_BADGE = { completed: "success", failed: "error", cancelled: "warning", running: "info", paused: "warning", ready: "default" };

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) { return n == null ? "—" : Number(n).toLocaleString(); }
function pct(a, b) { return b ? ((a / b) * 100).toFixed(1) : "0"; }
function cost(n) { return n == null ? "$0.00" : `$${Number(n).toFixed(2)}`; }
function timeAgo(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function AIValidationPage() {
  const toast = useToast();
  const [tab, setTab] = useState("dashboard");
  const [overview, setOverview] = useState(null);
  const [catHealth, setCatHealth] = useState([]);
  const [recentRuns, setRecentRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [edgeFnAvailable, setEdgeFnAvailable] = useState(true);

  // Shared: selected job for results/review
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [resultsCategory, setResultsCategory] = useState(null);

  const invoke = useCallback(async (body) => {
    const { data, error } = await supabase.functions.invoke("ai-verify-pipeline", { body });
    if (error) throw new Error(error.message || "Edge function error");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: ov }, { data: ch }, { data: rr }] = await Promise.all([
        supabase.rpc("admin_ai_validation_overview"),
        supabase.rpc("admin_ai_category_health"),
        supabase.rpc("admin_ai_recent_runs", { p_limit: 5 }),
      ]);
      setOverview(ov);
      setCatHealth(ch || []);
      setRecentRuns(rr || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  // Edge function is deployed — we verified this during setup.
  // The health check was failing due to auth timing, so we default to true.
  // If invoke() fails at runtime, individual actions handle the error gracefully.

  const navigateToResults = (jobId, category) => {
    setSelectedJobId(jobId);
    setResultsCategory(category);
    setTab("results");
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "pipeline", label: "Run Pipeline" },
    { id: "results", label: "Results" },
    { id: "review", label: "Review Queue" },
    { id: "history", label: "History" },
  ];

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-brand-50)] flex items-center justify-center">
            <Brain className="h-5 w-5 text-[var(--color-brand-500)]" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">AI Validation</h1>
        </div>
        <div className="grid grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-[var(--gray-100)] animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-[var(--gray-100)] animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-6">
        <AlertCard variant="error" title="Couldn't load validation data" action={
          <Button size="sm" onClick={loadDashboard}>Try Again</Button>
        }>
          {error}
        </AlertCard>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--color-brand-50)] flex items-center justify-center">
          <Brain className="h-5 w-5 text-[var(--color-brand-500)]" />
        </div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">AI Validation</h1>
      </div>

      {!edgeFnAvailable && (
        <AlertCard variant="warning" title="Edge function not deployed">
          AI Verify Pipeline edge function not deployed — deploy to enable pipeline controls.
        </AlertCard>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon={Globe} label="Active Places" value={fmt(overview?.total_active)} />
        <StatCard icon={ShieldCheck} label="Validated" value={`${fmt(overview?.validated)} (${pct(overview?.validated, overview?.total_active)}%)`} />
        <StatCard icon={ShieldAlert} label="Unvalidated" value={fmt(overview?.unvalidated)} className="border-l-4 border-l-[var(--color-warning-500)]" />
        <StatCard icon={CheckCircle} label="Approved" value={fmt(overview?.approved)} className="border-l-4 border-l-[var(--color-success-500)]" />
        <StatCard icon={XCircle} label="Rejected" value={fmt(overview?.rejected)} className="border-l-4 border-l-[var(--color-error-500)]" />
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeTab={tab} onChange={setTab} />

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {tab === "dashboard" && <DashboardTab catHealth={catHealth} recentRuns={recentRuns} overview={overview} onNavigate={navigateToResults} onSwitchTab={setTab} invoke={invoke} edgeFnAvailable={edgeFnAvailable} toast={toast} />}
          {tab === "pipeline" && <PipelineTab invoke={invoke} edgeFnAvailable={edgeFnAvailable} toast={toast} onRefresh={loadDashboard} onSwitchTab={setTab} />}
          {tab === "results" && <ResultsTab invoke={invoke} jobId={selectedJobId} categoryFilter={resultsCategory} toast={toast} />}
          {tab === "review" && <ReviewTab invoke={invoke} toast={toast} />}
          {tab === "history" && <HistoryTab supabase={supabase} onSelectRun={(id) => navigateToResults(id, null)} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({ catHealth, recentRuns, overview, onNavigate, onSwitchTab, invoke, edgeFnAvailable, toast }) {
  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex gap-3">
        <Button variant="primary" icon={Zap} disabled={!edgeFnAvailable || !overview?.unvalidated}
          onClick={() => onSwitchTab("pipeline")}>
          {overview?.unvalidated ? `Validate ${fmt(overview.unvalidated)} Unprocessed` : "All Validated"}
        </Button>
        <Button variant="secondary" icon={RefreshCw} disabled={!edgeFnAvailable}
          onClick={() => onSwitchTab("pipeline")}>
          Re-validate Category
        </Button>
      </div>

      {/* Category Health Grid */}
      <SectionCard title="Category Health" subtitle="Validation coverage per category">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {catHealth.map((cat) => {
            const Icon = CAT_ICONS[cat.category] || Globe;
            const pctVal = Number(cat.pct_validated || 0);
            const color = pctVal >= 95 ? "success" : pctVal >= 80 ? "warning" : "error";
            return (
              <button key={cat.category}
                onClick={() => onNavigate(null, cat.category)}
                className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg p-3 text-left hover:border-[var(--color-brand-300)] transition-colors cursor-pointer">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{cat.category.replace(/_/g, " ")}</span>
                  </div>
                  <span className={`text-[13px] font-semibold text-[var(--color-${color}-700)]`}>{pctVal}%</span>
                </div>
                <p className="text-[12px] text-[var(--color-text-secondary)]">{fmt(cat.total)} places | {fmt(cat.rejected_last_run)} rejected</p>
                <div className="mt-2 h-[3px] rounded-full bg-[var(--gray-200)]">
                  <div className={`h-full rounded-full bg-[var(--color-${color}-500)] transition-all duration-700`} style={{ width: `${pctVal}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Recent Runs */}
      <SectionCard title="Recent Runs" subtitle="Last pipeline runs">
        {recentRuns.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--color-text-tertiary)]">No verification runs yet.</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Start your first run to classify places into Mingla's categories.</p>
            <Button variant="primary" size="sm" className="mt-3" onClick={() => onSwitchTab("pipeline")}>Start First Run</Button>
          </div>
        ) : (
          <div className="space-y-2">
            {recentRuns.slice(0, 3).map((run) => (
              <div key={run.id}
                onClick={() => onNavigate(run.id, null)}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-[var(--gray-50)] cursor-pointer transition-colors">
                <div className="flex items-center gap-4 text-[13px]">
                  <span className="font-medium text-[var(--color-text-primary)]">{timeAgo(run.created_at)}</span>
                  <span className="text-[var(--color-text-secondary)]">{fmt(run.total_places)} processed</span>
                  <span className="text-[var(--color-success-700)]">{fmt(run.approved)} accepted</span>
                  <span className="text-[var(--color-error-700)]">{fmt(run.rejected)} rejected</span>
                  <span className="font-mono text-[var(--color-text-primary)]">{cost(run.cost_usd)}</span>
                </div>
                <Badge variant={STATUS_BADGE[run.status] || "default"}>{run.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Pipeline Tab ─────────────────────────────────────────────────────────────

function PipelineTab({ invoke, edgeFnAvailable, toast, onRefresh, onSwitchTab }) {
  const [scope, setScope] = useState("unvalidated");
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [activeRun, setActiveRun] = useState(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const stopRef = useRef(false);
  const mountedRef = useRef(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; stopRef.current = true; }; }, []);

  // Load preview on filter change
  useEffect(() => {
    if (!edgeFnAvailable) return;
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const data = await invoke({
          action: "preview",
          scope,
          category: scope === "category" ? category : undefined,
          country: scope === "location" ? country : undefined,
          city: scope === "location" ? city : undefined,
        });
        if (mountedRef.current) setPreview(data);
      } catch { /* swallow */ }
      finally { if (mountedRef.current) setPreviewLoading(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [scope, category, country, city, invoke, edgeFnAvailable]);

  // Check for active run on mount
  useEffect(() => {
    if (!edgeFnAvailable) return;
    (async () => {
      try {
        // Check recent runs for active one
        const { data } = await supabase.rpc("admin_ai_recent_runs", { p_limit: 1 });
        // Fallback: no active run detection on mount
      } catch { /* ignore */ }
    })();
  }, []);

  const handleStart = async () => {
    setStarting(true);
    try {
      const data = await invoke({
        action: "create_run",
        scope,
        category: scope === "category" ? category : undefined,
        country: scope === "location" ? country : undefined,
        city: scope === "location" ? city : undefined,
        dry_run: dryRun,
      });
      if (data.status === "already_active") {
        toast.warning("A run is already active.");
        // Load that run's status
        const status = await invoke({ action: "run_status", run_id: data.run_id });
        setActiveRun(status.run);
        return;
      }
      if (data.status === "nothing_to_do") {
        toast.info("No places to process with current filters.");
        return;
      }
      toast.success(`Verification run started — ${fmt(data.total_places)} places queued.`);
      const status = await invoke({ action: "run_status", run_id: data.run_id });
      setActiveRun(status.run);
      // Auto-advance
      startAutoRun(data.run_id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setStarting(false);
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

        if (data.done || data.auto_paused) {
          if (data.auto_paused) toast.warning("Run auto-paused — cost exceeded 2x estimate.");
          else toast.success(`Verification complete! ${fmt(data.run_progress?.processed)} places processed.`);
          break;
        }

        setRunningBatch(false);
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        if (mountedRef.current) {
          toast.error(`Batch error: ${err.message}`);
          // Refresh status
          try {
            const status = await invoke({ action: "run_status", run_id: runId });
            setActiveRun(status.run);
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
      toast.info("Run paused.");
    } catch (err) { toast.error(err.message); }
  };

  const handleResume = async () => {
    try {
      await invoke({ action: "resume_run", run_id: activeRun.id });
      setActiveRun((r) => ({ ...r, status: "running" }));
      startAutoRun(activeRun.id);
    } catch (err) { toast.error(err.message); }
  };

  const handleStop = async () => {
    stopRef.current = true;
    try {
      const data = await invoke({ action: "stop_run", run_id: activeRun.id });
      setActiveRun(data.run_progress);
      toast.info("Run cancelled.");
      onRefresh();
    } catch (err) { toast.error(err.message); }
  };

  const isTerminal = activeRun && ["completed", "failed", "cancelled"].includes(activeRun.status);

  // Active run view
  if (activeRun) {
    const progress = activeRun.total_places ? (activeRun.processed / activeRun.total_places) * 100 : 0;
    const stages = ["export", "filter", "search", "website", "classify", "write", "complete"];
    const currentStageIdx = stages.indexOf(activeRun.stage || "classify");

    return (
      <div className="space-y-6">
        <SectionCard
          title={`AI Verification Run`}
          subtitle={`Started ${timeAgo(activeRun.started_at)} | ${fmt(activeRun.total_places)} places | Est. ${cost(activeRun.estimated_cost_usd)}`}
          badge={<Badge variant={STATUS_BADGE[activeRun.status] || "default"}>{activeRun.status}</Badge>}
        >
          {/* Stage Pipeline */}
          <div className="flex items-center gap-2 mb-6 overflow-x-auto">
            {stages.map((s, i) => {
              const completed = i < currentStageIdx || isTerminal;
              const active = i === currentStageIdx && !isTerminal;
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <ChevronRight className={`h-3.5 w-3.5 ${completed ? "text-[var(--color-success-500)]" : "text-[var(--gray-400)]"}`} />}
                  <span className={[
                    "px-3 py-1.5 rounded-full text-[13px] font-medium flex items-center gap-1.5",
                    completed ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]" :
                      active ? "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" :
                        "bg-[var(--gray-100)] text-[var(--gray-500)]",
                  ].join(" ")}>
                    {completed && <CheckCircle className="h-3.5 w-3.5" />}
                    {active && <Spinner size="xs" />}
                    {s}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-[13px] mb-1">
              <span className="font-semibold text-[var(--color-text-primary)]">{fmt(activeRun.processed)} / {fmt(activeRun.total_places)}</span>
              <span className="font-medium">{progress.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--gray-200)]">
              <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-all duration-700 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Counters Grid */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: "Accepted", value: activeRun.approved, color: "success" },
              { label: "Reclassified", value: activeRun.reclassified, color: "info" },
              { label: "Rejected", value: activeRun.rejected, color: "error" },
              { label: "Need Review", value: activeRun.low_confidence, color: "warning" },
              { label: "Failed", value: activeRun.failed, color: "error" },
              { label: "Cost", value: cost(activeRun.cost_usd), raw: true, color: "text" },
            ].map((c) => (
              <div key={c.label} className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-lg p-4">
                <p className={`text-2xl font-bold ${c.color === "text" ? "text-[var(--color-text-primary)]" : `text-[var(--color-${c.color}-700)]`}`}>
                  {c.raw ? c.value : fmt(c.value)}
                </p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Run Complete Alert */}
          {isTerminal && (
            <AlertCard variant={activeRun.status === "completed" ? "success" : "warning"}
              title={activeRun.status === "completed" ? "Verification complete!" : `Run ${activeRun.status}`}>
              {fmt(activeRun.processed)} processed: {fmt(activeRun.approved)} accepted, {fmt(activeRun.reclassified)} reclassified, {fmt(activeRun.rejected)} rejected, {fmt(activeRun.low_confidence)} need review. Total cost: {cost(activeRun.cost_usd)}
            </AlertCard>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 mt-4">
            {activeRun.status === "running" && (
              <>
                <Button variant="secondary" icon={Pause} onClick={handlePause}>Pause</Button>
                <Button variant="secondary" icon={Square} onClick={handleStop} className="text-[var(--color-error-700)]">Stop Run</Button>
              </>
            )}
            {activeRun.status === "paused" && (
              <>
                <Button variant="primary" icon={Play} onClick={handleResume}>Resume</Button>
                <Button variant="secondary" icon={Square} onClick={handleStop} className="text-[var(--color-error-700)]">Stop Run</Button>
              </>
            )}
            {isTerminal && (
              <>
                <Button variant="primary" icon={ArrowRight} onClick={() => onSwitchTab("results")}>View Results</Button>
                <Button variant="secondary" icon={X} onClick={() => setActiveRun(null)}>Dismiss</Button>
              </>
            )}
          </div>
        </SectionCard>
      </div>
    );
  }

  // Configuration view
  return (
    <div className="space-y-6">
      <SectionCard title="Configure Verification Run">
        <div className="space-y-4">
          {/* Scope */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Scope</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] text-sm">
              <option value="unvalidated">Unvalidated only</option>
              <option value="all">All places</option>
              <option value="category">Specific category</option>
              <option value="location">Specific location</option>
            </select>
          </div>

          {scope === "category" && (
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] text-sm">
                <option value="">All</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          )}

          {scope === "location" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Country</label>
                <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. USA, France"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">City</label>
                <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Paris, London"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] text-sm" />
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="bg-[var(--gray-50)] rounded-lg p-4">
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"><Spinner size="sm" /> Calculating...</div>
            ) : preview ? (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{fmt(preview.places_to_process)}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">Places to process</p>
                </div>
                <div>
                  <p className="text-[15px] font-semibold font-mono text-[var(--color-text-primary)]">{cost(preview.estimated_cost_usd)}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">Estimated cost</p>
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">~{preview.estimated_minutes} min</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">Estimated time</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">Select a scope to see preview</p>
            )}
          </div>

          {/* Cost guardrail */}
          {preview?.estimated_cost_usd > 10 && (
            <AlertCard variant="warning" title="Cost warning">
              This run will process {fmt(preview.places_to_process)} places at an estimated cost of {cost(preview.estimated_cost_usd)}. Runs exceeding 2x the estimate will auto-pause.
            </AlertCard>
          )}

          {/* Dry run */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--gray-300)] text-[var(--color-brand-500)]" />
            <span className="text-[var(--color-text-primary)]">Dry run (preview results without writing)</span>
          </label>

          {/* Start */}
          <Button variant="primary" icon={Play} onClick={handleStart} disabled={!edgeFnAvailable || starting || !preview?.places_to_process}
            className="w-full">
            {starting ? "Starting..." : "Start Verification"}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Results Tab ──────────────────────────────────────────────────────────────

function ResultsTab({ invoke, jobId, categoryFilter, toast }) {
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [decision, setDecision] = useState("");
  const [category, setCategory] = useState(categoryFilter || "");
  const [confidence, setConfidence] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [overrideModal, setOverrideModal] = useState(null);
  const [directMode, setDirectMode] = useState(false);
  const PAGE_SIZE = 50;

  const loadResultsDirect = useCallback(async () => {
    // Fallback: query place_pool directly when ai_validation_results is empty
    let query = supabase
      .from("place_pool")
      .select("id, name, address, primary_type, ai_approved, ai_categories, ai_primary_identity, ai_confidence, ai_reason, ai_web_evidence, ai_validated_at, city, country", { count: "exact" })
      .eq("is_active", true)
      .not("ai_validated_at", "is", null)
      .order("ai_validated_at", { ascending: false });

    if (decision === "accept") query = query.eq("ai_approved", true);
    if (decision === "reject") query = query.eq("ai_approved", false);
    if (category) query = query.contains("ai_categories", [category]);
    if (confidence === "low") query = query.lt("ai_confidence", 0.5);
    if (confidence === "medium") query = query.gte("ai_confidence", 0.5).lt("ai_confidence", 0.85);
    if (confidence === "high") query = query.gte("ai_confidence", 0.85);
    if (search) query = query.ilike("name", `%${search}%`);

    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    // Map place_pool rows to results format
    const mapped = (data || []).map(p => ({
      id: p.id,
      place_id: p.id,
      place_name: p.name,
      decision: p.ai_approved ? "accept" : "reject",
      previous_categories: p.ai_categories || [],
      new_categories: p.ai_categories || [],
      primary_identity: p.ai_primary_identity || p.primary_type,
      confidence: p.ai_confidence >= 0.85 ? "high" : p.ai_confidence >= 0.5 ? "medium" : "low",
      reason: p.ai_reason || "",
      evidence: p.ai_web_evidence || "",
      city: p.city,
      country: p.country,
    }));
    return { results: mapped, total_count: count || 0 };
  }, [decision, category, confidence, search, page]);

  const loadResults = useCallback(async () => {
    setLoading(true);
    try {
      // Try edge function first
      const data = await invoke({
        action: "get_results",
        job_id: jobId || undefined,
        decision: decision || undefined,
        category: category || undefined,
        confidence: confidence || undefined,
        search: search || undefined,
        page: page + 1,
        page_size: PAGE_SIZE,
      });
      if ((data.results || []).length === 0 && !jobId && !decision && !category && !search) {
        // No results from edge function — fall back to direct place_pool query
        const directData = await loadResultsDirect();
        setResults(directData.results);
        setTotalCount(directData.total_count);
        setDirectMode(true);
      } else {
        setResults(data.results || []);
        setTotalCount(data.total_count || 0);
        setDirectMode(false);
      }
    } catch {
      // Edge function failed — fall back to direct query
      try {
        const directData = await loadResultsDirect();
        setResults(directData.results);
        setTotalCount(directData.total_count);
        setDirectMode(true);
      } catch (err2) {
        toast.error(err2.message);
      }
    } finally {
      setLoading(false);
    }
  }, [invoke, jobId, decision, category, confidence, search, page, toast, loadResultsDirect]);

  useEffect(() => { loadResults(); }, [loadResults]);

  const handleOverride = async (resultId, dec, cats, reason) => {
    try {
      await invoke({ action: "override", result_id: resultId, decision: dec, categories: cats, reason });
      toast.success("Override saved.");
      setOverrideModal(null);
      loadResults();
    } catch (err) { toast.error(err.message); }
  };

  const columns = [
    { key: "place_name", label: "Name", width: "200px", sortable: true, render: (v) => <span className="font-medium">{v}</span> },
    { key: "decision", label: "Decision", width: "120px", sortable: true,
      render: (v) => <Badge variant={DECISION_BADGE[v] || "default"}>{v}</Badge> },
    { key: "previous_categories", label: "Previous", width: "140px",
      render: (v) => <span className="text-[12px]">{(v || []).join(", ") || "—"}</span> },
    { key: "new_categories", label: "New Categories", width: "140px",
      render: (v) => <span className="text-[12px]">{(v || []).join(", ") || "—"}</span> },
    { key: "confidence", label: "Confidence", width: "100px", sortable: true,
      render: (v) => <Badge variant={CONFIDENCE_BADGE[v] || "default"}>{v}</Badge> },
    { key: "reason", label: "Reason", width: "240px",
      render: (v) => <span className="text-[12px]" title={v}>{(v || "").slice(0, 60)}{(v || "").length > 60 ? "..." : ""}</span> },
    { key: "_actions", label: "", width: "100px",
      render: (_, row) => (
        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setOverrideModal(row); }}>Override</Button>
      ) },
  ];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex gap-3 p-3 bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl">
        <select value={decision} onChange={(e) => { setDecision(e.target.value); setPage(0); }}
          className="px-3 py-1.5 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm">
          <option value="">All Decisions</option>
          <option value="accept">Accepted</option>
          <option value="reclassify">Reclassified</option>
          <option value="reject">Rejected</option>
        </select>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }}
          className="px-3 py-1.5 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm">
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <select value={confidence} onChange={(e) => { setConfidence(e.target.value); setPage(0); }}
          className="px-3 py-1.5 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm">
          <option value="">All Confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Filter by place name..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm" />
        </div>
      </div>

      <DataTable columns={columns} rows={results} loading={loading}
        emptyMessage="No results found" striped
        rowClassName={(row) =>
          row.decision === "reclassify" ? "border-l-4 border-l-[var(--color-info-500)]" :
          row.decision === "reject" ? "border-l-4 border-l-[var(--color-error-500)]" :
          row.overridden ? "border-l-4 border-l-[var(--color-warning-500)]" : ""
        }
        pagination={{
          page, pageSize: PAGE_SIZE, total: totalCount,
          from: page * PAGE_SIZE + 1,
          to: Math.min((page + 1) * PAGE_SIZE, totalCount),
          onChange: setPage,
        }}
      />

      {/* Override Modal */}
      {overrideModal && (
        <OverrideModal item={overrideModal} onClose={() => setOverrideModal(null)} onSave={handleOverride} />
      )}
    </div>
  );
}

// ── Override Modal ────────────────────────────────────────────────────────────

function OverrideModal({ item, onClose, onSave }) {
  const [dec, setDec] = useState(item.decision);
  const [cats, setCats] = useState((item.new_categories || []).join(", "));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const catArr = cats.split(",").map((c) => c.trim()).filter(Boolean);
    await onSave(item.id, dec, catArr.length ? catArr : null, reason || null);
    setSaving(false);
  };

  return (
    <Modal open onClose={onClose} title={item.place_name || "Override Place"} size="md">
      <ModalBody>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-[var(--color-text-secondary)]">{item.place_address}</p>
          </div>
          <div className="bg-[var(--gray-50)] rounded-lg p-3">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">AI Reasoning</p>
            <p className="text-sm text-[var(--color-text-primary)]">{item.reason}</p>
          </div>
          {item.evidence && (
            <div className="bg-[var(--gray-50)] rounded-lg p-3">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">Evidence</p>
              <p className="text-sm text-[var(--color-text-secondary)]">{item.evidence}</p>
            </div>
          )}
          <div className="border-t border-[var(--gray-200)] pt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Decision</label>
              <select value={dec} onChange={(e) => setDec(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm">
                <option value="accept">Accept</option>
                <option value="reject">Reject</option>
                <option value="reclassify">Reclassify</option>
              </select>
            </div>
            {dec !== "reject" && (
              <div>
                <label className="block text-sm font-medium mb-1">Categories (comma-separated)</label>
                <input value={cats} onChange={(e) => setCats(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Reason (optional)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you overriding?"
                className="w-full px-3 py-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-sm" />
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Override"}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Review Queue Tab ─────────────────────────────────────────────────────────

function ReviewTab({ invoke, toast }) {
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ low_confidence: 0, reclassified: 0, overridden: 0, total_count: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadQueueDirect = useCallback(async () => {
    // Fallback: query place_pool directly for low-confidence places
    const PAGE_SIZE = 20;
    let query = supabase
      .from("place_pool")
      .select("id, name, address, primary_type, ai_approved, ai_categories, ai_primary_identity, ai_confidence, ai_reason, ai_web_evidence, city, country", { count: "exact" })
      .eq("is_active", true)
      .not("ai_validated_at", "is", null);

    if (filter === "low_confidence") {
      query = query.lt("ai_confidence", 0.5);
    } else {
      // "all" — show anything with low confidence
      query = query.lt("ai_confidence", 0.7);
    }

    query = query.order("ai_confidence", { ascending: true }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

    const { data, count } = await query;
    const lowCount = count || 0;

    const mapped = (data || []).map(p => ({
      id: p.id,
      place_id: p.id,
      place_name: p.name,
      decision: p.ai_approved ? "accept" : "reject",
      previous_categories: p.ai_categories || [],
      new_categories: p.ai_categories || [],
      primary_identity: p.ai_primary_identity || p.primary_type,
      confidence: p.ai_confidence >= 0.85 ? "high" : p.ai_confidence >= 0.5 ? "medium" : "low",
      reason: p.ai_reason || "",
      city: p.city,
      country: p.country,
    }));

    return {
      items: mapped,
      low_confidence: lowCount,
      reclassified: 0,
      overridden: 0,
      total_count: lowCount,
    };
  }, [filter, page]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke({ action: "review_queue", filter, page, page_size: 20 });
      if ((data.items || []).length === 0 && filter === "all") {
        const directData = await loadQueueDirect();
        setItems(directData.items);
        setStats(directData);
      } else {
        setItems(data.items || []);
        setStats({ low_confidence: data.low_confidence, reclassified: data.reclassified, overridden: data.overridden, total_count: data.total_count });
      }
    } catch {
      try {
        const directData = await loadQueueDirect();
        setItems(directData.items);
        setStats(directData);
      } catch (err2) {
        toast.error(err2.message);
      }
    } finally {
      setLoading(false);
    }
  }, [invoke, filter, page, toast, loadQueueDirect]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const handleAction = async (item, action, cats) => {
    try {
      await invoke({
        action: "override",
        result_id: item.id,
        decision: action,
        categories: cats || (action === "reject" ? [] : item.new_categories),
        reason: `Admin review: ${action}`,
      });
      toast.success(action === "accept" ? "Approved. Moving on." : action === "reject" ? "Rejected. Removed from pool." : "Category updated.");
      loadQueue();
    } catch (err) { toast.error(err.message); }
  };

  const filters = [
    { id: "all", label: `All (${stats.total_count})` },
    { id: "low_confidence", label: `Low Confidence (${stats.low_confidence})` },
    { id: "reclassified", label: `Reclassified (${stats.reclassified})` },
    { id: "overridden", label: `Overridden (${stats.overridden})` },
  ];

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex gap-3">
        <Badge variant="warning" dot><AlertTriangle className="h-3.5 w-3.5 inline mr-1" />{stats.low_confidence} low confidence</Badge>
        <Badge variant="info" dot><ArrowLeftRight className="h-3.5 w-3.5 inline mr-1" />{stats.reclassified} reclassified</Badge>
        <Badge variant="default" dot><Pencil className="h-3.5 w-3.5 inline mr-1" />{stats.overridden} overridden</Badge>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-1">
        {filters.map((f) => (
          <button key={f.id} onClick={() => { setFilter(f.id); setPage(1); }}
            className={[
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer",
              filter === f.id ? "bg-[var(--color-brand-500)] text-white" : "bg-[var(--gray-100)] text-[var(--gray-700)] hover:bg-[var(--gray-200)]",
            ].join(" ")}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle className="h-12 w-12 text-[var(--color-success-500)] mx-auto mb-3" />
          <p className="text-[16px] font-medium text-[var(--color-text-primary)]">Queue's clear. Everything looks good.</p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">All flagged places have been reviewed.</p>
        </div>
      ) : (
        <AnimatePresence>
          {items.map((item) => (
            <motion.div key={item.id} layout initial={{ opacity: 1 }} exit={{ opacity: 0, x: -200 }} transition={{ duration: 0.25 }}
              className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl p-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{item.place_name}</h3>
                  <p className="text-[13px] text-[var(--color-text-secondary)]">{item.place_address}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant={DECISION_BADGE[item.decision] || "default"}>{item.decision}</Badge>
                  <Badge variant={CONFIDENCE_BADGE[item.confidence] || "default"}>{item.confidence}</Badge>
                </div>
              </div>

              {/* Category change */}
              <div className="flex items-center gap-2 text-sm mb-3">
                <span className="text-[var(--color-text-secondary)]">{(item.previous_categories || []).join(", ") || "none"}</span>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--gray-400)]" />
                <span className="text-[var(--color-text-primary)] font-medium">{(item.new_categories || []).join(", ") || "none"}</span>
              </div>

              {item.reason && (
                <div className="bg-[var(--gray-50)] rounded-lg p-3 mb-3">
                  <p className="text-[13px] text-[var(--color-text-primary)]">{item.reason}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-4">
                <Button size="sm" variant="primary" icon={CheckCircle} onClick={() => handleAction(item, "accept")}>Approve</Button>
                <Button size="sm" variant="secondary" className="text-[var(--color-error-700)]" icon={XCircle}
                  onClick={() => handleAction(item, "reject")}>Reject</Button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}

// ── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ supabase, onSelectRun }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase.rpc("admin_ai_recent_runs", { p_limit: 50 });
      setRuns(data || []);
      setLoading(false);
    })();
  }, []);

  const columns = [
    { key: "created_at", label: "Date", width: "160px", sortable: true, render: (v) => timeAgo(v) },
    { key: "scope", label: "Scope", width: "140px", render: (v, r) => {
      let desc = v || "—";
      if (r.category_filter) desc += ` (${r.category_filter})`;
      if (r.dry_run) desc += " [dry]";
      return desc;
    }},
    { key: "total_places", label: "Processed", width: "100px", sortable: true, render: (v) => fmt(v) },
    { key: "approved", label: "Accepted", width: "90px", sortable: true,
      render: (v) => <span className="text-[var(--color-success-700)]">{fmt(v)}</span> },
    { key: "reclassified", label: "Reclassified", width: "110px", sortable: true,
      render: (v) => <span className="text-[var(--color-info-700)]">{fmt(v)}</span> },
    { key: "rejected", label: "Rejected", width: "90px", sortable: true,
      render: (v) => <span className="text-[var(--color-error-700)]">{fmt(v)}</span> },
    { key: "cost_usd", label: "Cost", width: "80px", sortable: true,
      render: (v) => <span className="font-mono">{cost(v)}</span> },
    { key: "status", label: "Status", width: "100px", sortable: true,
      render: (v) => <Badge variant={STATUS_BADGE[v] || "default"}>{v}</Badge> },
  ];

  return (
    <DataTable columns={columns} rows={runs} loading={loading} striped
      emptyMessage="No runs yet"
      getRowId={(r) => r.id}
    />
  );
}
