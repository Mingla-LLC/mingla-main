import { useState, useEffect, useCallback, useRef } from "react";
import {
  CreditCard, Crown, UserCheck, Shield, Clock, Search,
  ChevronLeft, ChevronRight, X, AlertTriangle, History, Gift,
  Ban, Check, RefreshCw, Download,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { StatCardSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { timeAgo, formatDate, formatDateTime, truncate, escapeLike } from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeRemaining(dateStr) {
  if (!dateStr) return "—";
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 30) return `${Math.floor(days / 30)}mo ${days % 30}d`;
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `${hours}h`;
}

const TIER_CONFIG = {
  free: { label: "Free", variant: "default", icon: UserCheck },
  mingla_plus: { label: "Mingla+", variant: "warning", icon: Crown },
};

function TierBadge({ tier }) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.free;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon className="h-3 w-3 mr-1 inline" />
      {config.label}
    </Badge>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SubscriptionManagementPage() {
  const { addToast } = useToast();
  const { session } = useAuth();

  // List state
  const [subscriptions, setSubscriptions] = useState([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tierFilter, setTierFilter] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // Stats
  const [stats, setStats] = useState({ total: 0, free: 0, mingla_plus: 0, overrides: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  // Expiring overrides alert
  const [expiringCount, setExpiringCount] = useState(0);

  // Grant modal
  const [grantModal, setGrantModal] = useState(false);
  const [grantTarget, setGrantTarget] = useState(null);
  const [grantForm, setGrantForm] = useState({ tier: "mingla_plus", reason: "", duration_days: 30 });
  const [granting, setGranting] = useState(false);

  // Revoke modal
  const [revokeModal, setRevokeModal] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  // History modal
  const [historyModal, setHistoryModal] = useState(false);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Setup state (if RPC doesn't exist)
  const [setupNeeded, setSetupNeeded] = useState(false);

  // Refs
  const searchTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Search debounce ────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  // ─── Fetch subscriptions via RPC ─────────────────────────────────────────────

  const fetchSubscriptions = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = {
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      };
      if (debouncedSearch) params.p_search = debouncedSearch;
      if (tierFilter) params.p_tier_filter = tierFilter;

      const { data, error } = await supabase.rpc("admin_list_subscriptions", params);
      if (error) {
        if (error.code === "PGRST202") {
          setSetupNeeded(true);
          return;
        }
        throw error;
      }
      if (!mountedRef.current) return;
      setSubscriptions(data || []);
      setSetupNeeded(false);
    } catch (err) {
      console.error("[Subscriptions] fetch error:", err.message, err.code, err.details, err.hint, err);
      if (mountedRef.current) {
        setListError(err.message);
        addToast({ variant: "error", title: "Failed to load subscriptions", description: err.message });
      }
    } finally {
      if (mountedRef.current) setListLoading(false);
    }
  }, [page, debouncedSearch, tierFilter, addToast]);

  // ─── Fetch stats via RPC ──────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    if (setupNeeded) { setStatsLoading(false); return; }
    setStatsLoading(true);
    try {
      // Try dedicated stats RPC first
      const { data: rpcStats, error: rpcErr } = await supabase.rpc("admin_subscription_stats");
      if (!rpcErr && rpcStats) {
        if (!mountedRef.current) return;
        // rpcStats may be a single row or array
        const s = Array.isArray(rpcStats) ? rpcStats[0] : rpcStats;
        if (s) {
          setStats({
            total: s.total ?? 0,
            free: s.free ?? 0,
            mingla_plus: s.mingla_plus ?? 0,
            overrides: s.overrides ?? 0,
          });
          setStatsLoading(false);
          return;
        }
      }

      // PGRST202 fallback: compute from full list
      if (rpcErr && rpcErr.code !== "PGRST202") throw rpcErr;

      const { data, error } = await supabase.rpc("admin_list_subscriptions", {
        p_limit: 10000,
        p_offset: 0,
      });
      if (error) {
        if (error.code === "PGRST202") {
          if (mountedRef.current) setSetupNeeded(true);
          return;
        }
        throw error;
      }
      if (!mountedRef.current) return;
      const all = data || [];
      setStats({
        total: all.length,
        free: all.filter(u => u.effective_tier === "free").length,
        mingla_plus: all.filter(u => u.effective_tier === "mingla_plus").length,
        overrides: all.filter(u => u.has_admin_override).length,
      });
    } catch (err) {
      console.error("[Subscriptions] stats error:", err);
    } finally {
      if (mountedRef.current) setStatsLoading(false);
    }
  }, [setupNeeded]);

  // ─── Fetch expiring overrides ─────────────────────────────────────────────────

  useEffect(() => {
    async function checkExpiring() {
      try {
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from("admin_subscription_overrides")
          .select("*", { count: "exact", head: true })
          .is("revoked_at", null)
          .lte("starts_at", new Date().toISOString())
          .gt("expires_at", new Date().toISOString())
          .lt("expires_at", threeDaysFromNow);
        if (mountedRef.current) setExpiringCount(count ?? 0);
      } catch { /* ignore */ }
    }
    checkExpiring();
  }, []);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ─── Grant Override ─────────────────────────────────────────────────────────

  const handleGrant = async () => {
    if (!grantTarget || !grantForm.reason.trim()) {
      addToast({ variant: "error", title: "Reason is required" });
      return;
    }
    setGranting(true);
    try {
      const { data, error } = await supabase.rpc("admin_grant_override", {
        p_user_id: grantTarget.user_id,
        p_tier: grantForm.tier,
        p_reason: grantForm.reason.trim(),
        p_granted_by: session.user.id,
        p_duration_days: parseInt(grantForm.duration_days, 10) || 30,
      });
      if (error) throw error;
      addToast({ variant: "success", title: "Override granted", description: `${grantForm.tier} tier for ${grantForm.duration_days} days` });
      logAdminAction("subscription.grant_override", "subscription", grantTarget.user_id, { tier: grantForm.tier, duration_days: grantForm.duration_days, reason: grantForm.reason.trim() });
      setGrantModal(false);
      setGrantForm({ tier: "mingla_plus", reason: "", duration_days: 30 });
      setGrantTarget(null);
      fetchSubscriptions();
      fetchStats();
    } catch (err) {
      console.error("[Subscriptions] grant error:", err);
      addToast({ variant: "error", title: "Failed to grant override", description: err.message });
    } finally {
      setGranting(false);
    }
  };

  // ─── Revoke Override ────────────────────────────────────────────────────────

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const { data: history, error: hErr } = await supabase.rpc("admin_get_override_history", {
        p_user_id: revokeTarget.user_id,
      });
      if (hErr) throw hErr;
      const active = (history || []).find(h => h.is_active);
      if (!active) {
        addToast({ variant: "warning", title: "No active override found" });
        setRevokeModal(false);
        return;
      }
      const { error } = await supabase.rpc("admin_revoke_override", {
        p_override_id: active.id,
        p_revoked_by: session.user.id,
      });
      if (error) throw error;
      addToast({ variant: "success", title: "Override revoked", description: `${revokeTarget.display_name}'s override has been revoked` });
      logAdminAction("subscription.revoke_override", "subscription", revokeTarget.user_id, { display_name: revokeTarget.display_name });
      setRevokeModal(false);
      setRevokeTarget(null);
      fetchSubscriptions();
      fetchStats();
    } catch (err) {
      console.error("[Subscriptions] revoke error:", err);
      addToast({ variant: "error", title: "Failed to revoke override", description: err.message });
    } finally {
      setRevoking(false);
    }
  };

  // ─── View History ───────────────────────────────────────────────────────────

  const openHistory = async (row) => {
    setHistoryTarget(row);
    setHistoryModal(true);
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_override_history", {
        p_user_id: row.user_id,
      });
      if (error) throw error;
      setHistoryData(data || []);
    } catch (err) {
      console.error("[Subscriptions] history error:", err);
      addToast({ variant: "error", title: "Failed to load history", description: err.message });
    } finally {
      setHistoryLoading(false);
    }
  };

  // ─── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const cols = [
      { key: "user_id", label: "User ID" },
      { key: "display_name", label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "effective_tier", label: "Effective Tier" },
      { key: "raw_tier", label: "RC Tier" },
      { key: "has_admin_override", label: "Has Override" },
      { key: "admin_override_tier", label: "Override Tier" },
      { key: "admin_override_expires_at", label: "Override Expires" },
      { key: "trial_ends_at", label: "Trial Ends" },
      { key: "created_at", label: "Joined" },
    ];
    const { exported, capped } = exportCsv(cols, subscriptions, "subscriptions");
    addToast({ variant: "success", title: `Exported ${exported} rows${capped ? " (capped at 10k)" : ""}` });
  }, [subscriptions, addToast]);

  // ─── Setup Screen ───────────────────────────────────────────────────────────

  if (setupNeeded) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Subscriptions</h1>
        </div>
        <SectionCard title="Setup Required" subtitle="Run the migration to enable subscription management">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg" style={{ backgroundColor: "var(--color-warning-50, #fffbeb)" }}>
              <AlertTriangle className="h-5 w-5 text-[var(--color-warning-600)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">Migration not applied</p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                  The subscription management RPC functions don't exist yet. Run the migration file in your Supabase SQL Editor:
                </p>
              </div>
            </div>
            <div className="relative">
              <pre className="p-4 rounded-lg text-xs font-mono overflow-x-auto" style={{ backgroundColor: "var(--color-background-secondary)", color: "var(--color-text-primary)" }}>
                {`-- File: supabase/migrations/20260317000001_create_admin_subscription_overrides.sql
-- Copy the full contents and run in Supabase SQL Editor
-- This creates:
--   admin_subscription_overrides table
--   Updated get_effective_tier() function
--   admin_list_subscriptions() RPC
--   admin_grant_override() RPC
--   admin_revoke_override() RPC
--   admin_get_override_history() RPC`}
              </pre>
              <Button
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => {
                  navigator.clipboard.writeText("See supabase/migrations/20260317000001_create_admin_subscription_overrides.sql");
                  addToast({ variant: "success", title: "Path copied" });
                }}
              >
                Copy path
              </Button>
            </div>
            <Button variant="primary" onClick={() => { setSetupNeeded(false); fetchSubscriptions(); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  // ─── Pagination ──────────────────────────────────────────────────────────────

  const hasMore = subscriptions.length === PAGE_SIZE;

  // ─── Table columns ──────────────────────────────────────────────────────────

  const columns = [
    {
      key: "display_name",
      label: "User",
      sortable: true,
      render: (_val, row) => (
        <div>
          <p className="font-medium text-[var(--color-text-primary)]">{row.display_name || "—"}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{row.phone || "No phone"}</p>
        </div>
      ),
    },
    {
      key: "effective_tier",
      label: "Effective Tier",
      sortable: true,
      render: (_val, row) => <TierBadge tier={row.effective_tier} />,
    },
    {
      key: "raw_tier",
      label: "RC Tier",
      render: (_val, row) => (
        <span className="text-sm text-[var(--color-text-secondary)]">
          {row.raw_tier || "free"}
        </span>
      ),
    },
    {
      key: "has_admin_override",
      label: "Override",
      render: (_val, row) => row.has_admin_override ? (
        <div>
          <Badge variant="brand">
            <Shield className="h-3 w-3 mr-1 inline" />
            {row.admin_override_tier}
          </Badge>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            Expires {timeRemaining(row.admin_override_expires_at)}
          </p>
        </div>
      ) : (
        <span className="text-xs text-[var(--color-text-tertiary)]">None</span>
      ),
    },
    {
      key: "trial_ends_at",
      label: "Trial",
      render: (_val, row) => row.trial_ends_at ? (
        <div>
          <p className="text-sm text-[var(--color-text-secondary)]">{formatDate(row.trial_ends_at)}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{timeRemaining(row.trial_ends_at)}</p>
        </div>
      ) : (
        <span className="text-xs text-[var(--color-text-tertiary)]">—</span>
      ),
    },
    {
      key: "created_at",
      label: "Joined",
      sortable: true,
      render: (_val, row) => (
        <span className="text-sm text-[var(--color-text-secondary)]">{formatDate(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (_val, row) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => {
            setGrantTarget({ user_id: row.user_id, display_name: row.display_name });
            setGrantForm({ tier: "mingla_plus", reason: "", duration_days: 30 });
            setGrantModal(true);
          }}>
            <Gift className="h-4 w-4" />
          </Button>
          {row.has_admin_override && (
            <Button variant="ghost" size="sm" onClick={() => {
              setRevokeTarget(row);
              setRevokeModal(true);
            }}>
              <Ban className="h-4 w-4 text-[var(--color-error-500)]" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => openHistory(row)}>
            <History className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Subscriptions</h1>
        </div>
        <Button variant="secondary" size="sm" icon={Download} onClick={handleExport}>
          Export
        </Button>
      </div>

      {/* Expiring overrides alert */}
      {expiringCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ backgroundColor: "var(--color-warning-50, #fffbeb)" }}>
          <AlertTriangle className="h-4 w-4 text-[var(--color-warning-600)]" />
          <span className="text-sm text-[var(--color-text-primary)]">{expiringCount} override{expiringCount > 1 ? "s" : ""} expiring within 3 days</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Total Users" value={stats.total} icon={UserCheck} />
            <StatCard label="Free" value={stats.free} icon={UserCheck} />
            <StatCard label="Mingla+" value={stats.mingla_plus} icon={Crown} />
            <StatCard label="Admin Overrides" value={stats.overrides} icon={Shield} />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SearchInput
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[null, "free", "mingla_plus"].map((tier) => (
            <button
              key={tier ?? "all"}
              onClick={() => { setTierFilter(tier); setPage(0); }}
              className={[
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                tierFilter === tier
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
              ].join(" ")}
            >
              {tier ? TIER_CONFIG[tier].label : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <SectionCard>
        {listError ? (
          <div className="text-center py-12">
            <AlertTriangle className="h-8 w-8 text-[var(--color-error-500)] mx-auto mb-3" />
            <p className="text-[var(--color-text-secondary)] mb-3">{listError}</p>
            <Button variant="secondary" onClick={fetchSubscriptions}>Retry</Button>
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={subscriptions}
              loading={listLoading}
              emptyMessage="No users found"
            />
            {/* Pagination */}
            {!listLoading && subscriptions.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  Page {page + 1}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!hasMore} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Grant Override Modal */}
      <Modal open={grantModal} onClose={() => setGrantModal(false)} title="Grant Tier Override">
        <ModalBody>
          <div className="space-y-4">
            <div className="p-3 rounded-lg" style={{ backgroundColor: "var(--color-background-secondary)" }}>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {grantTarget?.display_name || "Unknown User"}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 font-mono">
                {grantTarget?.user_id}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Tier</label>
              <div className="flex gap-2">
                {["free", "mingla_plus"].map((t) => {
                  const Icon = TIER_CONFIG[t].icon;
                  return (
                    <button
                      key={t}
                      onClick={() => setGrantForm(f => ({ ...f, tier: t }))}
                      className={[
                        "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                        grantForm.tier === t
                          ? "bg-[var(--color-brand-500)] text-white"
                          : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" />
                      {TIER_CONFIG[t].label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Input
              label="Duration (days)"
              type="number"
              value={grantForm.duration_days}
              onChange={(e) => setGrantForm(f => ({ ...f, duration_days: e.target.value }))}
              min={1}
              max={365}
            />

            <Input
              label="Reason (required)"
              value={grantForm.reason}
              onChange={(e) => setGrantForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g., Beta tester reward, influencer partnership..."
            />

            {grantForm.tier === "free" && (
              <div className="flex items-start gap-2 p-3 rounded-lg" style={{ backgroundColor: "var(--color-warning-50, #fffbeb)" }}>
                <AlertTriangle className="h-4 w-4 text-[var(--color-warning-600)] shrink-0 mt-0.5" />
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Setting tier to Free will override any active paid subscription. The user will lose access to Mingla+ features for the override duration.
                </p>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setGrantModal(false)} disabled={granting}>Cancel</Button>
          <Button variant="primary" onClick={handleGrant} loading={granting} disabled={!grantForm.reason.trim()}>
            <Gift className="h-4 w-4 mr-2" />
            Grant Override
          </Button>
        </ModalFooter>
      </Modal>

      {/* Revoke Override Modal */}
      <Modal open={revokeModal} onClose={() => setRevokeModal(false)} title="Revoke Override" destructive>
        <ModalBody>
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              Revoke the active override for <strong>{revokeTarget?.display_name}</strong>?
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              They will fall back to their underlying tier (RevenueCat / trial / referral / free).
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setRevokeModal(false)} disabled={revoking}>Cancel</Button>
          <Button variant="danger" onClick={handleRevoke} loading={revoking}>
            <Ban className="h-4 w-4 mr-2" />
            Revoke Override
          </Button>
        </ModalFooter>
      </Modal>

      {/* History Modal */}
      <Modal open={historyModal} onClose={() => { setHistoryModal(false); setHistoryData([]); }} title={`Override History — ${historyTarget?.display_name || ""}`} size="lg">
        <ModalBody>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : historyData.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] text-center py-8">No override history for this user.</p>
          ) : (
            <div className="space-y-3">
              {historyData.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-lg"
                  style={{
                    borderStyle: "solid",
                    borderWidth: 1,
                    borderColor: entry.is_active ? "var(--color-brand-500)" : "var(--color-border)",
                    backgroundColor: entry.is_active ? "var(--color-brand-50, #fff7ed)" : "var(--color-background-secondary)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <TierBadge tier={entry.tier} />
                      {entry.is_active && <Badge variant="success">Active</Badge>}
                      {entry.revoked_at && <Badge variant="error">Revoked</Badge>}
                      {!entry.is_active && !entry.revoked_at && <Badge variant="default">Expired</Badge>}
                    </div>
                  </div>
                  <p className="text-sm text-[var(--color-text-primary)]">{entry.reason}</p>
                  <div className="flex gap-4 mt-2 text-xs text-[var(--color-text-tertiary)]">
                    <span>From: {formatDate(entry.starts_at)}</span>
                    <span>To: {formatDate(entry.expires_at)}</span>
                    {entry.revoked_at && <span>Revoked: {formatDateTime(entry.revoked_at)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
      </Modal>
    </div>
  );
}
