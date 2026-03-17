import { useState, useEffect, useCallback, useRef } from "react";
import {
  Camera, Image, MapPin, DollarSign, Clock, Search,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  AlertTriangle, RefreshCw, Download, Play, Check,
  X, Loader2, Eye, Grid3X3, BarChart3, Layers,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { StatCard, SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { StatCardSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { logAdminAction } from "../lib/auditLog";

// ─── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_NAMES = {
  nature: "Nature",
  first_meet: "First Meet",
  picnic_park: "Picnic & Park",
  drink: "Drink",
  casual_eats: "Casual Eats",
  fine_dining: "Fine Dining",
  watch: "Watch",
  creative_arts: "Creative Arts",
  play: "Play",
  wellness: "Wellness",
  groceries_flowers: "Groceries & Flowers",
  work_business: "Work & Business",
};

const CATEGORY_ICONS = {
  nature: "🌿", first_meet: "☕", picnic_park: "🌳", drink: "🍷",
  casual_eats: "🍔", fine_dining: "🍽️", watch: "🎬", creative_arts: "🎨",
  play: "🎮", wellness: "🧘", groceries_flowers: "🌸", work_business: "💼",
};

const HEALTH_COLORS = {
  green: { bg: "bg-[var(--color-success-50)]", border: "border-[var(--color-success-500)]", dot: "bg-[#22c55e]" },
  yellow: { bg: "bg-[var(--color-warning-50)]", border: "border-[var(--color-warning-500)]", dot: "bg-[#f59e0b]" },
  red: { bg: "bg-[var(--color-error-50)]", border: "border-[var(--color-error-500)]", dot: "bg-[#ef4444]" },
};

const STATUS_BADGE = {
  pending: { variant: "warning", label: "Pending" },
  running: { variant: "info", label: "Running" },
  completed: { variant: "success", label: "Completed" },
  failed: { variant: "error", label: "Failed" },
};

const TABS = [
  { id: "health", label: "Photo Health", icon: Camera },
  { id: "categories", label: "Categories", icon: Grid3X3 },
  { id: "locations", label: "Locations", icon: MapPin },
  { id: "refresh", label: "Place Refresh", icon: RefreshCw },
  { id: "costs", label: "Cost Monitor", icon: DollarSign },
  { id: "log", label: "Backfill Log", icon: Clock },
];

const LOG_PAGE_SIZE = 15;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatCurrency(val) {
  if (val == null) return "—";
  return `$${Number(val).toFixed(2)}`;
}

function pct(n, d) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function PhotoPoolManagementPage() {
  const { addToast } = useToast();
  const { session } = useAuth();

  // Dashboard data
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [setupNeeded, setSetupNeeded] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState("health");

  // Category drill-down
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categoryDetail, setCategoryDetail] = useState(null);
  const [categoryDetailLoading, setCategoryDetailLoading] = useState(false);

  // Missing places selection
  const [selectedPlaces, setSelectedPlaces] = useState(new Set());

  // Backfill state
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [activeBackfillId, setActiveBackfillId] = useState(null);
  const [backfillStatus, setBackfillStatus] = useState(null);

  // Fill category modal
  const [fillModal, setFillModal] = useState(false);
  const [fillTarget, setFillTarget] = useState({ category: "", lat: "", lng: "", radius_m: 5000, max_results: 60 });
  const [fillSubmitting, setFillSubmitting] = useState(false);

  // Refresh confirm modal (replaces window.confirm)
  const [refreshConfirm, setRefreshConfirm] = useState(null); // { mode, count, cost }

  // Backfill log
  const [logData, setLogData] = useState({ rows: [], total: 0 });
  const [logPage, setLogPage] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const [expandedLogRow, setExpandedLogRow] = useState(null);

  // Weekly costs for chart
  const [weeklyCosts, setWeeklyCosts] = useState([]);

  // Refs
  const mountedRef = useRef(true);
  const pollTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // ─── Fetch Overview ──────────────────────────────────────────────────────────

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_pool_stats_overview");
      if (rpcErr) {
        if (rpcErr.code === "PGRST202") { setSetupNeeded(true); return; }
        throw rpcErr;
      }
      if (!mountedRef.current) return;
      setOverview(data);
      setSetupNeeded(false);
    } catch (err) {
      console.error("[PhotoPool] overview error:", err);
      if (mountedRef.current) {
        setError(err.message);
        addToast({ variant: "error", title: "Failed to load pool stats", description: err.message });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  // ─── Fetch Category Detail ───────────────────────────────────────────────────

  const fetchCategoryDetail = useCallback(async (category) => {
    setCategoryDetailLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_pool_category_detail", {
        p_category: category,
      });
      if (rpcErr) throw rpcErr;
      if (!mountedRef.current) return;
      setCategoryDetail(data);
    } catch (err) {
      console.error("[PhotoPool] category detail error:", err);
      addToast({ variant: "error", title: "Failed to load category detail", description: err.message });
    } finally {
      if (mountedRef.current) setCategoryDetailLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (selectedCategory) fetchCategoryDetail(selectedCategory);
    else setCategoryDetail(null);
  }, [selectedCategory, fetchCategoryDetail]);

  // ─── Fetch Backfill Log ──────────────────────────────────────────────────────

  const fetchLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_backfill_log_list", {
        p_limit: LOG_PAGE_SIZE,
        p_offset: logPage * LOG_PAGE_SIZE,
      });
      if (rpcErr) throw rpcErr;
      if (!mountedRef.current) return;
      setLogData(data || { rows: [], total: 0 });
    } catch (err) {
      console.error("[PhotoPool] log error:", err);
    } finally {
      if (mountedRef.current) setLogLoading(false);
    }
  }, [logPage]);

  useEffect(() => {
    if (activeTab === "log") fetchLog();
  }, [activeTab, fetchLog]);

  // ─── Fetch Weekly Costs ──────────────────────────────────────────────────────

  const fetchWeeklyCosts = useCallback(async () => {
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_backfill_weekly_costs");
      if (rpcErr) throw rpcErr;
      if (mountedRef.current) setWeeklyCosts(data || []);
    } catch (err) {
      console.error("[PhotoPool] weekly costs error:", err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "costs") fetchWeeklyCosts();
  }, [activeTab, fetchWeeklyCosts]);

  // ─── Backfill Actions ────────────────────────────────────────────────────────

  const triggerBackfill = async (mode, placeIds = null) => {
    setBackfillRunning(true);
    try {
      const params = { p_mode: mode };
      if (placeIds) params.p_place_pool_ids = placeIds;

      const { data, error: rpcErr } = await supabase.rpc("admin_trigger_backfill", params);
      if (rpcErr) throw rpcErr;

      if (data.status === "already_running") {
        addToast({ variant: "warning", title: "Backfill already running", description: data.message });
        setActiveBackfillId(data.backfill_log_id);
        startPolling(data.backfill_log_id);
        return;
      }

      if (data.status === "nothing_to_do") {
        addToast({ variant: "info", title: "Nothing to backfill", description: data.message });
        setBackfillRunning(false);
        return;
      }

      addToast({
        variant: "success",
        title: "Backfill started",
        description: `${data.total_places} places, est. cost ${formatCurrency(data.estimated_cost_usd)}`,
      });
      setActiveBackfillId(data.backfill_log_id);
      startPolling(data.backfill_log_id);
      setSelectedPlaces(new Set());
    } catch (err) {
      console.error("[PhotoPool] backfill error:", err);
      addToast({ variant: "error", title: "Backfill failed", description: err.message });
      setBackfillRunning(false);
    }
  };

  const triggerCategoryFill = async () => {
    if (!fillTarget.category || !fillTarget.lat || !fillTarget.lng) {
      addToast({ variant: "error", title: "Missing fields", description: "Category, latitude, and longitude are required" });
      return;
    }
    setFillSubmitting(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_trigger_category_fill", {
        p_category: fillTarget.category,
        p_lat: parseFloat(fillTarget.lat),
        p_lng: parseFloat(fillTarget.lng),
        p_radius_m: parseInt(fillTarget.radius_m, 10) || 5000,
        p_max_results: parseInt(fillTarget.max_results, 10) || 60,
      });
      if (rpcErr) throw rpcErr;

      addToast({
        variant: "success",
        title: "Category fill started",
        description: `Est. ${data.estimated_api_calls} API calls, cost ${formatCurrency(data.estimated_cost_usd)}`,
      });
      setFillModal(false);
      setActiveBackfillId(data.backfill_log_id);
      startPolling(data.backfill_log_id);
    } catch (err) {
      console.error("[PhotoPool] category fill error:", err);
      addToast({ variant: "error", title: "Category fill failed", description: err.message });
    } finally {
      setFillSubmitting(false);
    }
  };

  // ─── Place Refresh ──────────────────────────────────────────────────────────

  const openRefreshConfirm = (mode) => {
    const rh = overview?.refresh_health || {};
    const count = mode === "recently_served" ? rh.recently_served_and_stale : rh.stale_7d;
    const cost = mode === "recently_served" ? rh.refresh_cost_recently_served_usd : rh.refresh_cost_all_stale_usd;
    setRefreshConfirm({ mode, count: count ?? 0, cost: cost ?? 0 });
  };

  const triggerPlaceRefresh = async (mode) => {
    setRefreshConfirm(null);
    setBackfillRunning(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc("admin_trigger_place_refresh", {
        p_mode: mode,
      });
      if (rpcErr) throw rpcErr;

      if (data.status === "already_running") {
        addToast({ variant: "warning", title: "Refresh already running", description: data.message });
        setActiveBackfillId(data.backfill_log_id);
        startPolling(data.backfill_log_id);
        return;
      }

      if (data.status === "nothing_to_do") {
        addToast({ variant: "info", title: "Nothing to refresh", description: data.message });
        setBackfillRunning(false);
        return;
      }

      addToast({
        variant: "success",
        title: "Place refresh started",
        description: `${data.total_places} places, est. cost ${formatCurrency(data.estimated_cost_usd)}`,
      });
      setActiveBackfillId(data.backfill_log_id);
      startPolling(data.backfill_log_id);
    } catch (err) {
      console.error("[PhotoPool] place refresh error:", err);
      addToast({ variant: "error", title: "Place refresh failed", description: err.message });
      setBackfillRunning(false);
    }
  };

  // ─── Polling ─────────────────────────────────────────────────────────────────

  const startPolling = (logId) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    let pollCount = 0;
    const MAX_POLLS = 60; // 60 polls × 3s = 3 minutes
    pollTimerRef.current = setInterval(async () => {
      pollCount++;
      try {
        const { data, error: rpcErr } = await supabase.rpc("admin_backfill_status", {
          p_backfill_log_id: logId,
        });
        if (rpcErr) throw rpcErr;
        if (!mountedRef.current) return;
        setBackfillStatus(data);

        if (data.status === "completed" || data.status === "failed") {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setBackfillRunning(false);
          addToast({
            variant: data.status === "completed" ? "success" : "error",
            title: `Backfill ${data.status}`,
            description: `${data.success_count} succeeded, ${data.failure_count} failed`,
          });
          fetchOverview();
          if (activeTab === "log") fetchLog();
        } else if (pollCount >= MAX_POLLS) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setBackfillRunning(false);
          addToast({
            variant: "info",
            title: "Polling stopped",
            description: `Backfill still ${data.status} after 3 minutes. Check the Backfill Log tab for updates.`,
          });
        }
      } catch (err) {
        console.error("[PhotoPool] poll error:", err);
      }
    }, 3000);
  };

  // ─── Setup Screen ────────────────────────────────────────────────────────────

  if (setupNeeded) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Photos</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Monitor photo storage and pool coverage</p>
        </div>
        <SectionCard title="Setup Required" subtitle="Run the migration to enable photo pool management">
          <div className="space-y-4">
            <AlertCard variant="warning" title="Migration not applied">
              <p>The photo pool management RPC functions don't exist yet. Run the migration file in your Supabase SQL Editor.</p>
            </AlertCard>
            <div className="relative">
              <pre className="p-4 rounded-lg text-xs font-mono overflow-x-auto" style={{ backgroundColor: "var(--color-background-secondary)", color: "var(--color-text-primary)" }}>
                {`-- File: supabase/migrations/20260317000002_admin_photo_pool_management.sql
-- This creates:
--   admin_backfill_log table
--   admin_config table
--   admin_pool_stats_overview() RPC
--   admin_pool_category_detail() RPC
--   admin_trigger_backfill() RPC
--   admin_trigger_category_fill() RPC
--   admin_backfill_status() RPC
--   admin_backfill_log_list() RPC
--   admin_backfill_weekly_costs() RPC`}
              </pre>
            </div>
            <Button variant="primary" onClick={() => { setSetupNeeded(false); fetchOverview(); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const ph = overview?.photo_health || {};
  const categories = overview?.categories || [];
  const locationBuckets = overview?.location_buckets || [];
  const costMonitor = overview?.cost_monitor || {};
  const missingPlaces = overview?.missing_places || [];
  const refreshHealth = overview?.refresh_health || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Photos</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Monitor photo storage, pool coverage, and backfill operations</p>
        </div>
        <Button variant="secondary" onClick={fetchOverview} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Total Places" value={ph.total_places ?? 0} icon={Layers} />
            <StatCard label="With Photos" value={ph.with_photos ?? 0} icon={Image} />
            <StatCard label="Missing Photos" value={ph.missing_photos ?? 0} icon={Camera} />
            <StatCard label="Coverage" value={`${ph.coverage_pct ?? 0}%`} icon={Check} />
            <StatCard label="Est. Monthly Cost" value={formatCurrency(ph.estimated_monthly_cost_usd)} icon={DollarSign} />
          </>
        )}
      </div>

      {/* Cost Alert */}
      {!loading && costMonitor.is_over_threshold && (
        <AlertCard variant="error" title="Cost Alert">
          Projected monthly cost ({formatCurrency(costMonitor.estimated_monthly_cost_usd)}) exceeds the alert threshold ({formatCurrency(costMonitor.alert_threshold_monthly_usd)}).
          Consider running a photo backfill to reduce Google API costs from on-demand photo fetching.
        </AlertCard>
      )}

      {/* Active Backfill Progress */}
      {backfillRunning && backfillStatus && (
        <SectionCard title="Backfill in Progress">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--color-brand-500)]" />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {backfillStatus.success_count + backfillStatus.failure_count} / {backfillStatus.total_places} places processed
              </span>
              <Badge variant={STATUS_BADGE[backfillStatus.status]?.variant || "default"}>
                {STATUS_BADGE[backfillStatus.status]?.label || backfillStatus.status}
              </Badge>
            </div>
            <div className="w-full h-2 bg-[var(--gray-200)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#f97316] rounded-full transition-all duration-300"
                style={{
                  width: `${backfillStatus.total_places > 0
                    ? ((backfillStatus.success_count + backfillStatus.failure_count) / backfillStatus.total_places * 100)
                    : 0}%`,
                }}
              />
            </div>
            {backfillStatus.failure_count > 0 && (
              <p className="text-xs text-[var(--color-error-600)]">{backfillStatus.failure_count} failures</p>
            )}
          </div>
        </SectionCard>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-lg bg-[var(--color-background-secondary)] overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-150 whitespace-nowrap cursor-pointer",
                activeTab === tab.id
                  ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {error && !loading ? (
        <SectionCard>
          <div className="text-center py-12">
            <AlertTriangle className="h-8 w-8 text-[var(--color-error-500)] mx-auto mb-3" />
            <p className="text-[var(--color-text-secondary)] mb-3">{error}</p>
            <Button variant="secondary" onClick={fetchOverview}>Retry</Button>
          </div>
        </SectionCard>
      ) : (
        <>
          {activeTab === "health" && (
            <HealthSection
              missingPlaces={missingPlaces}
              selectedPlaces={selectedPlaces}
              setSelectedPlaces={setSelectedPlaces}
              onBackfillSelected={() => triggerBackfill("selected", [...selectedPlaces])}
              onBackfillAll={() => triggerBackfill("all_missing")}
              backfillRunning={backfillRunning}
              loading={loading}
            />
          )}
          {activeTab === "categories" && (
            <CategoriesSection
              categories={categories}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              categoryDetail={categoryDetail}
              categoryDetailLoading={categoryDetailLoading}
              onFillCategory={(cat, lat, lng) => {
                setFillTarget({ category: cat, lat: lat ?? "", lng: lng ?? "", radius_m: 5000, max_results: 60 });
                setFillModal(true);
              }}
              loading={loading}
            />
          )}
          {activeTab === "locations" && (
            <LocationsSection locationBuckets={locationBuckets} loading={loading} />
          )}
          {activeTab === "refresh" && (
            <RefreshSection
              refreshHealth={refreshHealth}
              onRefreshRecentlyServed={() => openRefreshConfirm("recently_served")}
              onRefreshAllStale={() => openRefreshConfirm("all_stale")}
              backfillRunning={backfillRunning}
              loading={loading}
            />
          )}
          {activeTab === "costs" && (
            <CostsSection costMonitor={costMonitor} weeklyCosts={weeklyCosts} loading={loading} />
          )}
          {activeTab === "log" && (
            <LogSection
              logData={logData}
              logPage={logPage}
              setLogPage={setLogPage}
              logLoading={logLoading}
              expandedLogRow={expandedLogRow}
              setExpandedLogRow={setExpandedLogRow}
              onRefresh={fetchLog}
            />
          )}
        </>
      )}

      {/* Refresh Confirm Modal */}
      <Modal
        open={!!refreshConfirm}
        onClose={() => setRefreshConfirm(null)}
        title="Refresh Places"
        destructive
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This will make <strong>{refreshConfirm?.count}</strong> Google API calls.
            Estimated cost: <strong>${(refreshConfirm?.cost ?? 0).toFixed(2)}</strong>.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRefreshConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => triggerPlaceRefresh(refreshConfirm?.mode)}>Refresh</Button>
        </ModalFooter>
      </Modal>

      {/* Fill Category Modal */}
      <Modal open={fillModal} onClose={() => setFillModal(false)} title="Fill Category" size="md">
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Category</label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CATEGORY_NAMES).map(([slug, name]) => (
                  <button
                    key={slug}
                    onClick={() => setFillTarget(f => ({ ...f, category: slug }))}
                    className={[
                      "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                      fillTarget.category === slug
                        ? "bg-[var(--color-brand-500)] text-white"
                        : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
                    ].join(" ")}
                  >
                    {CATEGORY_ICONS[slug]} {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Latitude"
                type="number"
                step="any"
                value={fillTarget.lat}
                onChange={(e) => setFillTarget(f => ({ ...f, lat: e.target.value }))}
                placeholder="e.g., 40.7128"
              />
              <Input
                label="Longitude"
                type="number"
                step="any"
                value={fillTarget.lng}
                onChange={(e) => setFillTarget(f => ({ ...f, lng: e.target.value }))}
                placeholder="e.g., -74.0060"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Radius (meters)"
                type="number"
                value={fillTarget.radius_m}
                onChange={(e) => setFillTarget(f => ({ ...f, radius_m: e.target.value }))}
                min={100}
                max={50000}
              />
              <Input
                label="Max Results"
                type="number"
                value={fillTarget.max_results}
                onChange={(e) => setFillTarget(f => ({ ...f, max_results: e.target.value }))}
                min={1}
                max={200}
              />
            </div>

            {fillTarget.category && fillTarget.max_results && (
              <div className="p-3 rounded-lg bg-[var(--color-background-secondary)]">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">Cost Estimate</p>
                {(() => {
                  const maxRes = parseInt(fillTarget.max_results, 10) || 60;
                  const nearbyCalls = Math.ceil(maxRes / 20);
                  const detailCalls = maxRes;
                  const photoCalls = maxRes * 5;
                  const totalCalls = nearbyCalls + detailCalls + photoCalls;
                  const cost = (nearbyCalls * 0.032) + (detailCalls * 0.017) + (photoCalls * 0.007);
                  return (
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      ~{totalCalls} API calls, estimated cost: <strong>{formatCurrency(cost)}</strong>
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setFillModal(false)} disabled={fillSubmitting}>Cancel</Button>
          <Button
            variant="primary"
            onClick={triggerCategoryFill}
            loading={fillSubmitting}
            disabled={!fillTarget.category || !fillTarget.lat || !fillTarget.lng}
          >
            <Play className="h-4 w-4 mr-2" />
            Start Fill
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: Photo Health
// ═══════════════════════════════════════════════════════════════════════════════

function HealthSection({ missingPlaces, selectedPlaces, setSelectedPlaces, onBackfillSelected, onBackfillAll, backfillRunning, loading }) {
  const allSelected = missingPlaces.length > 0 && selectedPlaces.size === missingPlaces.length;

  const togglePlace = (id) => {
    setSelectedPlaces(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedPlaces(new Set());
    else setSelectedPlaces(new Set(missingPlaces.map(p => p.place_pool_id)));
  };

  if (loading) {
    return <SectionCard><div className="flex justify-center py-12"><Spinner /></div></SectionCard>;
  }

  const columns = [
    {
      key: "select",
      label: (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="rounded cursor-pointer"
        />
      ),
      width: "40px",
      render: (_val, row) => (
        <input
          type="checkbox"
          checked={selectedPlaces.has(row.place_pool_id)}
          onChange={() => togglePlace(row.place_pool_id)}
          className="rounded cursor-pointer"
        />
      ),
    },
    { key: "name", label: "Place Name" },
    { key: "primary_type", label: "Type" },
    {
      key: "photo_refs_count",
      label: "Photo Refs",
      render: (val) => <Badge variant="info">{val}</Badge>,
    },
    {
      key: "card_count",
      label: "Cards",
      render: (val) => val || 0,
    },
    {
      key: "total_impressions",
      label: "Impressions",
      render: (val) => (
        <span className={val > 0 ? "font-semibold text-[var(--color-warning-700)]" : ""}>
          {val || 0}
        </span>
      ),
    },
    {
      key: "google_place_id",
      label: "Place ID",
      render: (val) => (
        <span className="text-xs font-mono text-[var(--color-text-tertiary)] max-w-[140px] truncate block">
          {val}
        </span>
      ),
    },
  ];

  return (
    <SectionCard
      title="Places Missing Stored Photos"
      subtitle={`${missingPlaces.length} places (sorted by impression cost)`}
      action={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onBackfillSelected}
            disabled={selectedPlaces.size === 0 || backfillRunning}
          >
            <Download className="h-4 w-4 mr-1" />
            Backfill Selected ({selectedPlaces.size})
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onBackfillAll}
            disabled={missingPlaces.length === 0 || backfillRunning}
          >
            <Download className="h-4 w-4 mr-1" />
            Backfill All Missing
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        rows={missingPlaces}
        loading={false}
        emptyMessage="All active places have stored photos"
        striped
      />
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Category Coverage
// ═══════════════════════════════════════════════════════════════════════════════

function CategoriesSection({ categories, selectedCategory, setSelectedCategory, categoryDetail, categoryDetailLoading, onFillCategory, loading }) {
  if (loading) {
    return <SectionCard><div className="flex justify-center py-12"><Spinner /></div></SectionCard>;
  }

  return (
    <div className="space-y-4">
      {/* Category Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {categories.map((cat) => {
          const health = HEALTH_COLORS[cat.health] || HEALTH_COLORS.red;
          const isSelected = selectedCategory === cat.slug;
          return (
            <button
              key={cat.slug}
              onClick={() => setSelectedCategory(isSelected ? null : cat.slug)}
              className={[
                "text-left p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer",
                isSelected ? `${health.border} ${health.bg}` : "border-[var(--gray-200)] bg-[var(--color-background-primary)] hover:border-[var(--gray-300)]",
              ].join(" ")}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl">{CATEGORY_ICONS[cat.slug] || "📦"}</span>
                <span className={`w-3 h-3 rounded-full ${health.dot}`} title={`Health: ${cat.health}`} />
              </div>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                {CATEGORY_NAMES[cat.slug] || cat.slug}
              </p>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                  <span>Cards</span>
                  <span className="font-medium">{cat.total_cards}</span>
                </div>
                <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                  <span>With Photos</span>
                  <span className="font-medium">{cat.total_with_photos}</span>
                </div>
                <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                  <span>Locations</span>
                  <span className="font-medium">{cat.location_bucket_count}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Drill-down */}
      {selectedCategory && (
        <SectionCard
          title={`${CATEGORY_ICONS[selectedCategory]} ${CATEGORY_NAMES[selectedCategory] || selectedCategory} — Location Buckets`}
          action={
            <Button variant="primary" size="sm" onClick={() => onFillCategory(selectedCategory)}>
              <Play className="h-4 w-4 mr-1" />
              Fill Category
            </Button>
          }
        >
          {categoryDetailLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <DataTable
              columns={[
                { key: "lat_bucket", label: "Lat Bucket" },
                { key: "lng_bucket", label: "Lng Bucket" },
                { key: "card_count", label: "Cards" },
                {
                  key: "avg_rating",
                  label: "Avg Rating",
                  render: (val) => val != null ? `${val} ★` : "—",
                },
                {
                  key: "photo_coverage_pct",
                  label: "Photo Coverage",
                  render: (val) => (
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-[var(--gray-200)] rounded-full overflow-hidden">
                        <div className="h-full bg-[#22c55e] rounded-full" style={{ width: `${val}%` }} />
                      </div>
                      <span className="text-xs">{val}%</span>
                    </div>
                  ),
                },
                {
                  key: "actions",
                  label: "",
                  render: (_val, row) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFillCategory(selectedCategory, row.lat_bucket, row.lng_bucket);
                      }}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  ),
                },
              ]}
              rows={categoryDetail?.location_buckets || []}
              loading={false}
              emptyMessage="No location buckets for this category"
              striped
            />
          )}
        </SectionCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Location Coverage
// ═══════════════════════════════════════════════════════════════════════════════

function LocationsSection({ locationBuckets, loading }) {
  if (loading) {
    return <SectionCard><div className="flex justify-center py-12"><Spinner /></div></SectionCard>;
  }

  const columns = [
    { key: "lat_bucket", label: "Lat" },
    { key: "lng_bucket", label: "Lng" },
    {
      key: "total_cards",
      label: "Total Cards",
      render: (val) => (
        <span className={val < 10 ? "font-semibold text-[var(--color-error-600)]" : ""}>
          {val}
          {val < 10 && <span className="ml-1 text-xs">(cold spot)</span>}
        </span>
      ),
    },
    {
      key: "category_breakdown",
      label: "Categories",
      render: (val) => {
        if (!val || typeof val !== "object") return "—";
        const entries = Object.entries(val);
        if (entries.length === 0) return "—";
        return (
          <div className="flex flex-wrap gap-1">
            {entries.slice(0, 4).map(([slug, count]) => (
              <span key={slug} className="text-xs px-1.5 py-0.5 rounded bg-[var(--gray-100)] text-[var(--color-text-secondary)]">
                {CATEGORY_ICONS[slug] || slug} {count}
              </span>
            ))}
            {entries.length > 4 && (
              <span className="text-xs text-[var(--color-text-tertiary)]">+{entries.length - 4}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "photo_coverage_pct",
      label: "Photo Coverage",
      render: (val) => (
        <div className="flex items-center gap-2">
          <div className="w-16 h-1.5 bg-[var(--gray-200)] rounded-full overflow-hidden">
            <div className="h-full bg-[#22c55e] rounded-full" style={{ width: `${val}%` }} />
          </div>
          <span className="text-xs">{val}%</span>
        </div>
      ),
    },
  ];

  return (
    <SectionCard
      title="Location Coverage"
      subtitle={`${locationBuckets.length} location buckets (sorted by card count, cold spots first)`}
    >
      <DataTable
        columns={columns}
        rows={locationBuckets}
        loading={false}
        emptyMessage="No location data available"
        striped
      />
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Cost Monitor
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// Section: Place Data Refresh
// ═══════════════════════════════════════════════════════════════════════════════

function RefreshSection({ refreshHealth, onRefreshRecentlyServed, onRefreshAllStale, backfillRunning, loading }) {
  if (loading) {
    return <SectionCard><div className="flex justify-center py-12"><Spinner /></div></SectionCard>;
  }

  const rh = refreshHealth || {};
  const totalActive = rh.total_active_places ?? 0;
  const stale7d = rh.stale_7d ?? 0;
  const stale30d = rh.stale_30d ?? 0;
  const recentlyServedStale = rh.recently_served_and_stale ?? 0;
  const costRecentlyServed = rh.refresh_cost_recently_served_usd ?? 0;
  const costAllStale = rh.refresh_cost_all_stale_usd ?? 0;

  return (
    <div className="space-y-4">
      <SectionCard title="Place Data Refresh" subtitle="Manually refresh Google Place Details for stale places">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
            <p className="text-2xl font-bold text-[var(--color-text-primary)]">{totalActive}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">Total Active Places</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
            <p className="text-2xl font-bold text-[var(--color-warning-600)]">{stale7d}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">Stale ({">"}7 days)</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
            <p className="text-2xl font-bold text-[var(--color-error-600)]">{stale30d}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">Stale ({">"}30 days)</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-[var(--color-background-secondary)]">
            <p className="text-2xl font-bold text-[var(--color-brand-500)]">{recentlyServedStale}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">Recently Served & Stale</p>
          </div>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Refresh Recently Served */}
          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-primary)]">
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">Refresh Recently Served</h4>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3">
              {recentlyServedStale} places &middot; ${costRecentlyServed.toFixed(2)}
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={onRefreshRecentlyServed}
              disabled={backfillRunning || recentlyServedStale === 0}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          {/* Refresh All Stale */}
          <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-background-primary)]">
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">Refresh All Stale</h4>
            <p className="text-xs text-[var(--color-text-secondary)] mb-3">
              {stale7d} places &middot; ${costAllStale.toFixed(2)}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefreshAllStale}
              disabled={backfillRunning || stale7d === 0}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Recommendation note */}
        <AlertCard variant="info" title="Why &quot;Recently Served&quot; is recommended">
          Only refreshes places your users actually see. A place nobody views doesn't need fresh data. This saves money by targeting only the places that matter.
        </AlertCard>
      </SectionCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Cost Monitor
// ═══════════════════════════════════════════════════════════════════════════════

function CostsSection({ costMonitor, weeklyCosts, loading }) {
  if (loading) {
    return <SectionCard><div className="flex justify-center py-12"><Spinner /></div></SectionCard>;
  }

  const maxCost = Math.max(...weeklyCosts.map(w => Number(w.total_cost) || 0), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Est. Daily Cost" value={formatCurrency(costMonitor.estimated_daily_cost_usd)} icon={DollarSign} />
        <StatCard label="Est. Monthly Cost" value={formatCurrency(costMonitor.estimated_monthly_cost_usd)} icon={DollarSign} />
        <StatCard label="Recent Backfill Cost (30d)" value={formatCurrency(costMonitor.recent_backfill_cost_usd)} icon={DollarSign} />
        <StatCard label="Alert Threshold" value={formatCurrency(costMonitor.alert_threshold_monthly_usd)} icon={AlertTriangle} />
      </div>

      {/* Weekly costs bar chart */}
      {weeklyCosts.length > 0 && (
        <SectionCard title="Weekly Backfill Costs" subtitle="Last 12 weeks">
          <div className="flex items-end gap-2 h-40 overflow-x-auto min-w-0">
            {weeklyCosts.map((week, i) => {
              const cost = Number(week.total_cost) || 0;
              const height = maxCost > 0 ? (cost / maxCost) * 100 : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">{formatCurrency(cost)}</span>
                  <div className="w-full flex items-end" style={{ height: "120px" }}>
                    <div
                      className="w-full bg-[#f97316] rounded-t-sm transition-all duration-300"
                      style={{ height: `${Math.max(height, 2)}%` }}
                      title={`${formatDate(week.week_start)}: ${formatCurrency(cost)} (${week.operation_count} ops)`}
                    />
                  </div>
                  <span className="text-[9px] text-[var(--color-text-tertiary)] whitespace-nowrap">
                    {new Date(week.week_start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Backfill Log
// ═══════════════════════════════════════════════════════════════════════════════

function LogSection({ logData, logPage, setLogPage, logLoading, expandedLogRow, setExpandedLogRow, onRefresh }) {
  const rows = logData.rows || [];
  const total = logData.total || 0;
  const totalPages = Math.ceil(total / LOG_PAGE_SIZE);

  const columns = [
    {
      key: "operation_type",
      label: "Type",
      render: (val) => {
        const opLabel = val === "photo_backfill" ? "Photo Backfill" : val === "place_refresh" ? "Place Refresh" : "Category Fill";
        const opVariant = val === "photo_backfill" ? "info" : val === "place_refresh" ? "success" : "brand";
        return <Badge variant={opVariant}>{opLabel}</Badge>;
      },
    },
    { key: "triggered_by_name", label: "Triggered By" },
    {
      key: "status",
      label: "Status",
      render: (val) => {
        const cfg = STATUS_BADGE[val] || STATUS_BADGE.pending;
        return <Badge variant={cfg.variant} dot>{cfg.label}</Badge>;
      },
    },
    {
      key: "target_category",
      label: "Target",
      render: (val, row) => val ? (
        <span>{CATEGORY_ICONS[val]} {CATEGORY_NAMES[val] || val}</span>
      ) : (
        <span className="text-[var(--color-text-tertiary)]">All missing</span>
      ),
    },
    {
      key: "total_places",
      label: "Places",
      render: (val, row) => (
        <span>
          <span className="text-[#22c55e]">{row.success_count}</span>
          {row.failure_count > 0 && <span className="text-[#ef4444]"> / {row.failure_count} failed</span>}
          <span className="text-[var(--color-text-tertiary)]"> of {val}</span>
        </span>
      ),
    },
    {
      key: "estimated_cost_usd",
      label: "Est. Cost",
      render: (val) => formatCurrency(val),
    },
    {
      key: "started_at",
      label: "Started",
      render: (val) => formatDateTime(val),
    },
    {
      key: "expand",
      label: "",
      render: (_val, row) => {
        const hasErrors = row.error_details && Array.isArray(row.error_details) && row.error_details.length > 0;
        if (!hasErrors) return null;
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpandedLogRow(expandedLogRow === row.id ? null : row.id)}
          >
            {expandedLogRow === row.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        );
      },
    },
  ];

  return (
    <SectionCard
      title="Backfill Operations Log"
      subtitle={`${total} total operations`}
      action={
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        loading={logLoading}
        emptyMessage="No backfill operations yet"
        striped
      />

      {/* Expanded error details */}
      {expandedLogRow && (() => {
        const row = rows.find(r => r.id === expandedLogRow);
        if (!row || !row.error_details || row.error_details.length === 0) return null;
        return (
          <div className="px-4 py-3 bg-[var(--color-error-50)] border-t border-[var(--color-error-200)]">
            <p className="text-xs font-semibold text-[var(--color-error-700)] mb-2">Error Details</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {row.error_details.map((err, i) => (
                <div key={i} className="text-xs font-mono text-[var(--color-error-600)]">
                  {err.placeId}: {err.error}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Pagination */}
      {!logLoading && total > LOG_PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Page {logPage + 1} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={logPage === 0} onClick={() => setLogPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="sm" disabled={logPage >= totalPages - 1} onClick={() => setLogPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
