import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flag, Eye, CheckCircle, XCircle, AlertCircle, User } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ListItemSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { STATUS_COLORS } from "../lib/constants";

const FILTER_OPTIONS = ["all", "pending", "reviewed", "resolved", "dismissed"];

export function ReportsPage() {
  const { addToast } = useToast();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    supabase
      .from("user_reports")
      .select("id,reason,details,status,created_at,reporter_id,reported_user_id")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error: queryError }) => {
        if (!mounted) return;
        if (queryError) {
          setError(queryError.message);
          addToast({ variant: "error", title: "Failed to load reports", description: queryError.message });
        }
        setReports(data || []);
        setLoading(false);
      });

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const refetchReports = () => setFetchKey((k) => k + 1);

  const updateStatus = useCallback(async (id, status) => {
    setUpdatingId(id);
    try {
      const { error: updateError } = await supabase
        .from("user_reports")
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (updateError) throw updateError;
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      addToast({ variant: "success", title: `Report ${status}` });
    } catch (err) {
      addToast({ variant: "error", title: "Update failed", description: err.message });
    } finally {
      setUpdatingId(null);
    }
  }, [addToast]);

  const statusCounts = useMemo(() => {
    const counts = { all: reports.length, pending: 0, reviewed: 0, resolved: 0, dismissed: 0 };
    for (const r of reports) {
      if (counts[r.status] !== undefined) counts[r.status]++;
    }
    return counts;
  }, [reports]);

  const filteredReports = useMemo(() => {
    if (activeFilter === "all") return reports;
    return reports.filter((r) => r.status === activeFilter);
  }, [reports, activeFilter]);

  return (
    <div className="flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">User Reports</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Review and manage user-submitted reports
          </p>
        </div>
        <Badge variant="outline">{reports.length} total</Badge>
      </div>

      {/* Filter Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTER_OPTIONS.map((status) => {
          const isActive = activeFilter === status;
          const count = statusCounts[status];
          return (
            <button
              key={status}
              onClick={() => setActiveFilter(status)}
              aria-pressed={isActive}
              className={[
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                "cursor-pointer transition-all duration-150 border",
                isActive
                  ? "bg-[#f97316] text-white border-[#f97316]"
                  : "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-200)] hover:border-[var(--gray-300)]",
              ].join(" ")}
            >
              <span className="capitalize">{status}</span>
              <span
                className={[
                  "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold",
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]",
                ].join(" ")}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Reports List */}
      <SectionCard noPadding>
        {loading ? (
          <div className="p-6">
            {Array.from({ length: 5 }).map((_, i) => <ListItemSkeleton key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Failed to load reports</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{error}</p>
            <Button variant="link" onClick={refetchReports}>Try again</Button>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Flag className="h-10 w-10 text-[var(--gray-300)]" />
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {activeFilter === "all" ? "No reports to review" : `No ${activeFilter} reports`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--gray-200)]">
            <AnimatePresence initial={false}>
              {filteredReports.map((report) => {
                const isUpdating = updatingId === report.id;
                return (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-start gap-4 px-6 py-4">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--gray-100)] text-[var(--color-text-tertiary)] shrink-0 mt-0.5">
                        <User className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-sm font-medium text-[var(--color-text-primary)]">{report.reason}</h4>
                          <Badge variant={STATUS_COLORS[report.status] || "default"} dot>
                            {report.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--color-text-tertiary)] line-clamp-2">
                          {report.details || "No details provided"}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--color-text-muted)]">
                          <span>{new Date(report.created_at).toLocaleString()}</span>
                          {report.reporter_id && (
                            <span className="font-mono" title={report.reporter_id}>
                              Reporter: {report.reporter_id.slice(0, 8)}...
                            </span>
                          )}
                        </div>
                      </div>

                      {report.status === "pending" && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button variant="ghost" size="sm" icon={Eye} loading={isUpdating} onClick={() => updateStatus(report.id, "reviewed")}>
                            Review
                          </Button>
                          <Button variant="ghost" size="sm" icon={CheckCircle} loading={isUpdating} onClick={() => updateStatus(report.id, "resolved")}>
                            Resolve
                          </Button>
                          <Button variant="ghost" size="sm" icon={XCircle} loading={isUpdating} onClick={() => updateStatus(report.id, "dismissed")}>
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
