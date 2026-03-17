import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Users, Sparkles, Layers, Handshake, LayoutDashboard, Star,
  MessageSquare, Flag, AlertCircle, RefreshCw, TrendingUp, TrendingDown,
  Minus, AlertTriangle, ArrowRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { STAT_CARDS } from "../lib/constants";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { StatCardSkeleton, ListItemSkeleton } from "../components/ui/Skeleton";
import { Button } from "../components/ui/Button";
import { timeAgo, formatDate, formatDateTime, truncate, escapeLike } from "../lib/formatters";
import { logAdminAction, ACTION_LABELS } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";

const ICON_MAP = { Users, Sparkles, Layers, Handshake, LayoutDashboard, Star, MessageSquare, Flag };

const DAY_MS = 24 * 60 * 60 * 1000;

function useStatCounts() {
  const [counts, setCounts] = useState({});
  const [trends, setTrends] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchCounts() {
      try {
        const results = {};
        const trendResults = {};
        const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();
        const fourteenDaysAgo = new Date(Date.now() - 14 * DAY_MS).toISOString();

        await Promise.all(
          STAT_CARDS.map(async (card) => {
            try {
              // Total count
              const { count, error: queryError } = await supabase
                .from(card.table)
                .select("*", { count: "exact", head: true });
              if (queryError) throw queryError;
              results[card.table] = count ?? 0;

              // Last 7 days
              const { count: recent7 } = await supabase
                .from(card.table)
                .select("*", { count: "exact", head: true })
                .gte("created_at", sevenDaysAgo);

              // Previous 7 days (7-14 days ago)
              const { count: prev7 } = await supabase
                .from(card.table)
                .select("*", { count: "exact", head: true })
                .gte("created_at", fourteenDaysAgo)
                .lt("created_at", sevenDaysAgo);

              const r7 = recent7 ?? 0;
              const p7 = prev7 ?? 0;
              if (p7 === 0 && r7 === 0) trendResults[card.table] = { direction: "flat", label: "No change" };
              else if (p7 === 0) trendResults[card.table] = { direction: "up", label: `+${r7} this week` };
              else {
                const pctChange = Math.round(((r7 - p7) / p7) * 100);
                if (pctChange > 0) trendResults[card.table] = { direction: "up", label: `+${pctChange}% vs prev week` };
                else if (pctChange < 0) trendResults[card.table] = { direction: "down", label: `${pctChange}% vs prev week` };
                else trendResults[card.table] = { direction: "flat", label: "No change" };
              }
            } catch (err) {
              console.error(`[Stats] Failed to count ${card.table}:`, err?.message || err);
              results[card.table] = 0;
              trendResults[card.table] = { direction: "flat", label: "" };
            }
          })
        );
        if (!cancelled && mountedRef.current) {
          setCounts(results);
          setTrends(trendResults);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled && mountedRef.current) { setError(e.message || "Failed to load stats"); setLoading(false); }
      }
    }

    fetchCounts();
    return () => { cancelled = true; };
  }, [fetchKey]);

  return { counts, trends, loading, error, refetch: () => setFetchKey((k) => k + 1) };
}

function useAlerts() {
  const [alerts, setAlerts] = useState({ pendingReports: 0, expiredCaches: 0, expiringOverrides: 0 });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    async function fetch() {
      try {
        const [reportsRes, cachesRes, overridesRes] = await Promise.all([
          supabase.from("user_reports").select("*", { count: "exact", head: true }).eq("status", "pending"),
          supabase.from("curated_places_cache").select("*", { count: "exact", head: true }).lt("created_at", new Date(Date.now() - 7 * DAY_MS).toISOString()),
          supabase.from("admin_subscription_overrides").select("*", { count: "exact", head: true }).eq("is_active", true).lt("expires_at", new Date(Date.now() + 3 * DAY_MS).toISOString()),
        ]);
        if (!mountedRef.current) return;
        setAlerts({
          pendingReports: reportsRes.count ?? 0,
          expiredCaches: cachesRes.count ?? 0,
          expiringOverrides: overridesRes.count ?? 0,
        });
      } catch {
        // Non-critical — ignore
      }
    }
    fetch();
  }, []);

  return alerts;
}

function useRecentActivity() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [useAuditLog, setUseAuditLog] = useState(true);
  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetch() {
      if (useAuditLog) {
        const { data: auditData, error: auditError } = await supabase
          .from("admin_audit_log")
          .select("id, admin_email, action, target_type, target_id, metadata, created_at")
          .order("created_at", { ascending: false })
          .limit(20);

        if (!cancelled && mountedRef.current) {
          if (auditError) {
            // Table probably doesn't exist — fall back to recent users
            setUseAuditLog(false);
          } else {
            setData(auditData || []);
            setLoading(false);
            return;
          }
        }
      }

      // Fallback: recent users
      const { data: users, error: usersError } = await supabase
        .from("profiles")
        .select("id, display_name, email, created_at, has_completed_onboarding")
        .order("created_at", { ascending: false })
        .limit(20);

      if (!cancelled && mountedRef.current) {
        if (usersError) setError(usersError.message);
        else setData(users || []);
        setLoading(false);
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, [useAuditLog, fetchKey]);

  return { data, loading, error, useAuditLog, refetch: () => setFetchKey((k) => k + 1) };
}

function useRecentFeedback() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from("app_feedback")
      .select("id,rating,message,category,platform,created_at")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data: rows, error: queryError }) => {
        if (cancelled || !mountedRef.current) return;
        if (queryError) setError(queryError.message);
        else setData(rows || []);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [fetchKey]);

  return { data, loading, error, refetch: () => setFetchKey((k) => k + 1) };
}

function StarRating({ rating }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < rating ? "text-[#f59e0b]" : "text-[var(--gray-300)]"}>
          &#9733;
        </span>
      ))}
    </span>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <div className="w-12 h-12 rounded-full bg-[var(--color-error-50)] flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-[#ef4444]" />
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] text-center">{message}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <p className="text-sm text-[var(--color-text-tertiary)] py-8 text-center">{message}</p>
  );
}

export function OverviewPage({ onTabChange }) {
  const { counts, trends, loading: statsLoading, error: statsError, refetch: refetchStats } = useStatCounts();
  const alerts = useAlerts();
  const { data: recentActivity, loading: activityLoading, error: activityError, useAuditLog, refetch: refetchActivity } = useRecentActivity();
  const { data: recentFeedback, loading: feedbackLoading, error: feedbackError, refetch: refetchFeedback } = useRecentFeedback();

  const hasAlerts = alerts.pendingReports > 0 || alerts.expiredCaches > 0 || alerts.expiringOverrides > 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Dashboard</h1>
      </div>

      {/* Alerts Bar */}
      {hasAlerts && (
        <div className="flex flex-wrap gap-3">
          {alerts.pendingReports > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-warning-50,#fffbeb)] border border-[var(--color-warning-200,#fde68a)]">
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning-600)]" />
              <span className="text-sm text-[var(--color-text-primary)]">{alerts.pendingReports} pending report{alerts.pendingReports > 1 ? "s" : ""}</span>
              {onTabChange && (
                <Button variant="link" size="sm" onClick={() => onTabChange("reports")}>
                  Review <ArrowRight className="w-3 h-3 ml-1 inline" />
                </Button>
              )}
            </div>
          )}
          {alerts.expiredCaches > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-info-50,#eff6ff)] border border-[var(--color-info-200,#bfdbfe)]">
              <AlertCircle className="w-4 h-4 text-[#3b82f6]" />
              <span className="text-sm text-[var(--color-text-primary)]">{alerts.expiredCaches} expired cache{alerts.expiredCaches > 1 ? "s" : ""}</span>
            </div>
          )}
          {alerts.expiringOverrides > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-warning-50,#fffbeb)] border border-[var(--color-warning-200,#fde68a)]">
              <AlertTriangle className="w-4 h-4 text-[var(--color-warning-600)]" />
              <span className="text-sm text-[var(--color-text-primary)]">{alerts.expiringOverrides} override{alerts.expiringOverrides > 1 ? "s" : ""} expiring soon</span>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      {onTabChange && (
        <div className="flex gap-3 flex-wrap">
          <Button variant="secondary" size="sm" icon={Flag} onClick={() => onTabChange("reports")}>
            Review Reports
          </Button>
          <Button variant="secondary" size="sm" icon={Layers} onClick={() => onTabChange("content")}>
            Moderate Content
          </Button>
          <Button variant="secondary" size="sm" icon={MessageSquare} onClick={() => onTabChange("feedback")}>
            Check Feedback
          </Button>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statsLoading
          ? STAT_CARDS.map((_, i) => <StatCardSkeleton key={i} />)
          : statsError
            ? (
                <div className="col-span-full">
                  <ErrorState message={statsError} onRetry={refetchStats} />
                </div>
              )
            : STAT_CARDS.map((card, i) => {
                const Icon = ICON_MAP[card.icon];
                const trend = trends[card.table];
                const TrendIcon = trend?.direction === "up" ? TrendingUp : trend?.direction === "down" ? TrendingDown : Minus;
                return (
                  <motion.div
                    key={card.table}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.3, ease: "easeOut" }}
                  >
                    <StatCard
                      icon={Icon}
                      label={card.label}
                      value={(counts[card.table] ?? 0).toLocaleString()}
                      trend={trend?.label || ""}
                    />
                  </motion.div>
                );
              })}
      </div>

      {/* Recent Activity + Recent Feedback */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Activity (audit log or fallback to recent users) */}
        <SectionCard
          title={useAuditLog ? "Recent Activity" : "Recent Users"}
          badge={!activityLoading && !activityError && recentActivity.length > 0 ? (
            <Badge variant="brand">{recentActivity.length}</Badge>
          ) : undefined}
        >
          {activityLoading ? (
            Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)
          ) : activityError ? (
            <ErrorState message={activityError} onRetry={refetchActivity} />
          ) : recentActivity.length === 0 ? (
            <EmptyState message={useAuditLog ? "No recent activity" : "No users yet"} />
          ) : useAuditLog ? (
            <div className="flex flex-col divide-y divide-[var(--gray-200)]">
              {recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="w-8 h-8 rounded-full bg-[var(--gray-100)] flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {ACTION_LABELS[entry.action] || entry.action}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                      {entry.admin_email} · {timeAgo(entry.created_at)}
                    </p>
                  </div>
                  {entry.target_type && (
                    <Badge variant="outline">{entry.target_type}</Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-[var(--gray-200)]">
              {recentActivity.map((u) => (
                <div key={u.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar name={u.display_name || u.email} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {u.display_name || u.email}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={u.has_completed_onboarding ? "success" : "warning"} dot>
                      {u.has_completed_onboarding ? "Onboarded" : "Pending"}
                    </Badge>
                    <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Recent Feedback */}
        <SectionCard
          title="Recent Feedback"
          badge={!feedbackLoading && !feedbackError && recentFeedback.length > 0 ? (
            <Badge variant="brand">{recentFeedback.length}</Badge>
          ) : undefined}
        >
          {feedbackLoading ? (
            Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)
          ) : feedbackError ? (
            <ErrorState message={feedbackError} onRetry={refetchFeedback} />
          ) : recentFeedback.length === 0 ? (
            <EmptyState message="No feedback yet" />
          ) : (
            <div className="flex flex-col divide-y divide-[var(--gray-200)]">
              {recentFeedback.map((f) => (
                <div key={f.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StarRating rating={f.rating || 0} />
                      {f.category && <Badge variant="default">{f.category}</Badge>}
                    </div>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate">
                      {f.message?.slice(0, 80) || "No message"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end shrink-0 ml-3">
                    {f.platform && <Badge variant="outline">{f.platform}</Badge>}
                    <span className="text-[10px] text-[var(--color-text-muted)] mt-1">
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
