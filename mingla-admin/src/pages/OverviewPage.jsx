import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Sparkles,
  Layers,
  Handshake,
  LayoutDashboard,
  Star,
  MessageSquare,
  Flag,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { STAT_CARDS } from "../lib/constants";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Avatar } from "../components/ui/Avatar";
import { StatCardSkeleton, ListItemSkeleton } from "../components/ui/Skeleton";
import { Button } from "../components/ui/Button";

const ICON_MAP = { Users, Sparkles, Layers, Handshake, LayoutDashboard, Star, MessageSquare, Flag };

function useStatCounts() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    async function fetchCounts() {
      try {
        const results = {};
        await Promise.all(
          STAT_CARDS.map(async (card) => {
            try {
              const { count, error: queryError } = await supabase
                .from(card.table)
                .select("*", { count: "exact", head: true });
              if (queryError) throw queryError;
              results[card.table] = count ?? 0;
            } catch (err) {
              console.error(`[Stats] Failed to count ${card.table}:`, err?.message || err);
              results[card.table] = 0;
            }
          })
        );
        if (mounted) { setCounts(results); setLoading(false); }
      } catch (e) {
        if (mounted) { setError(e.message || "Failed to load stats"); setLoading(false); }
      }
    }

    fetchCounts();
    return () => { mounted = false; };
  }, [fetchKey]);

  return { counts, loading, error, refetch: () => setFetchKey((k) => k + 1) };
}

function useRecentData(table, selectFields, limit = 5) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    supabase
      .from(table)
      .select(selectFields)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data: rows, error: queryError }) => {
        if (!mounted) return;
        if (queryError) setError(queryError.message);
        else setData(rows || []);
        setLoading(false);
      });

    return () => { mounted = false; };
  }, [table, selectFields, limit, fetchKey]);

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

export function OverviewPage() {
  const { counts, loading: statsLoading, error: statsError, refetch: refetchStats } = useStatCounts();
  const { data: recentUsers, loading: usersLoading, error: usersError, refetch: refetchUsers } = useRecentData(
    "profiles",
    "id,display_name,email,created_at,has_completed_onboarding"
  );
  const { data: recentFeedback, loading: feedbackLoading, error: feedbackError, refetch: refetchFeedback } = useRecentData(
    "app_feedback",
    "id,rating,message,category,platform,created_at"
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Dashboard</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Overview of your Mingla platform metrics
        </p>
      </div>

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
                    />
                  </motion.div>
                );
              })}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Users */}
        <SectionCard
          title="Recent Users"
          badge={!usersLoading && !usersError && recentUsers.length > 0 ? (
            <Badge variant="brand">{recentUsers.length}</Badge>
          ) : undefined}
        >
          {usersLoading ? (
            Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)
          ) : usersError ? (
            <ErrorState message={usersError} onRetry={refetchUsers} />
          ) : recentUsers.length === 0 ? (
            <EmptyState message="No users yet" />
          ) : (
            <div className="flex flex-col divide-y divide-[var(--gray-200)]">
              {recentUsers.map((u) => (
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
