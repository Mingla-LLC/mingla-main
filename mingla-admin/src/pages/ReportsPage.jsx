import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flag, Eye, CheckCircle, XCircle, AlertCircle, User, Search,
  ChevronLeft, ChevronRight, X, Download, RotateCcw,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { ListItemSkeleton } from "../components/ui/Skeleton";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { STATUS_COLORS } from "../lib/constants";
import { timeAgo, formatDate, formatDateTime, truncate, escapeLike } from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

const STATUS_OPTIONS = ["all", "pending", "reviewed", "resolved", "dismissed"];
const SEVERITY_OPTIONS = ["all", "low", "medium", "high", "critical"];

export function ReportsPage() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [reports, setReports] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [fetchKey, setFetchKey] = useState(0);

  // Search
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef(null);

  // Sorting
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  // Detail modal
  const [detailReport, setDetailReport] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Debounce search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  // Fetch reports with pagination, filters, search, sorting
  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("user_reports")
        .select(
          "id, reason, details, status, severity, created_at, reviewed_at, reporter_id, reported_user_id, reporter:profiles!user_reports_reporter_id_fkey(display_name, email), reported:profiles!user_reports_reported_user_id_fkey(display_name, email)",
          { count: "exact" }
        )
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      // Filters
      if (activeFilter !== "all") query = query.eq("status", activeFilter);
      if (severityFilter !== "all") query = query.eq("severity", severityFilter);

      // Search
      if (debouncedSearch) {
        const safe = escapeLike(debouncedSearch);
        query = query.or(`reason.ilike.%${safe}%,details.ilike.%${safe}%`);
      }

      // Sort
      const ascending = sortDir === "asc";
      query = query.order(sortKey || "created_at", { ascending });

      const { data, count, error: queryError } = await query;
      if (!mountedRef.current) return;
      if (queryError) {
        // FK join might fail — fallback without joins
        const fallbackQuery = supabase
          .from("user_reports")
          .select("id, reason, details, status, severity, created_at, reviewed_at, reporter_id, reported_user_id", { count: "exact" })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        if (activeFilter !== "all") fallbackQuery.eq("status", activeFilter);
        if (severityFilter !== "all") fallbackQuery.eq("severity", severityFilter);
        if (debouncedSearch) {
          const safe = escapeLike(debouncedSearch);
          fallbackQuery.or(`reason.ilike.%${safe}%,details.ilike.%${safe}%`);
        }
        fallbackQuery.order(sortKey || "created_at", { ascending });
        const fb = await fallbackQuery;
        if (!mountedRef.current) return;
        if (fb.error) throw fb.error;
        setReports(fb.data || []);
        setTotalCount(fb.count ?? 0);
        setLoading(false);
        return;
      }
      setReports(data || []);
      setTotalCount(count ?? 0);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.message);
      addToast({ variant: "error", title: "Failed to load reports", description: err.message });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [page, activeFilter, severityFilter, debouncedSearch, sortKey, sortDir, addToast]);

  useEffect(() => { fetchReports(); }, [fetchReports, fetchKey]);

  const refetchReports = () => setFetchKey((k) => k + 1);

  // Status update
  const updateStatus = useCallback(async (id, status) => {
    setUpdatingId(id);
    try {
      const { error: updateError } = await supabase
        .from("user_reports")
        .update({ status, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (updateError) throw updateError;
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      if (detailReport?.id === id) setDetailReport((prev) => prev ? { ...prev, status } : prev);
      addToast({ variant: "success", title: `Report ${status}` });
      logAdminAction("report.update_status", "user_report", id, { new_status: status });
    } catch (err) {
      addToast({ variant: "error", title: "Update failed", description: err.message });
    } finally {
      if (mountedRef.current) setUpdatingId(null);
    }
  }, [addToast, detailReport]);

  // Severity update (from detail modal)
  const updateSeverity = useCallback(async (id, severity) => {
    try {
      const { error: updateError } = await supabase
        .from("user_reports")
        .update({ severity })
        .eq("id", id);
      if (updateError) throw updateError;
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, severity } : r)));
      if (detailReport?.id === id) setDetailReport((prev) => prev ? { ...prev, severity } : prev);
      addToast({ variant: "success", title: `Severity set to ${severity}` });
      logAdminAction("report.update_status", "user_report", id, { severity });
    } catch (err) {
      addToast({ variant: "error", title: "Update failed", description: err.message });
    }
  }, [addToast, detailReport]);

  // Status counts (from current loaded data — approximate)
  const statusCounts = useMemo(() => {
    return { all: totalCount };
  }, [totalCount]);

  // Sort handler (server-side)
  const handleSort = useCallback((key, dir) => {
    setSortKey(key);
    setSortDir(dir || "desc");
    setPage(0);
  }, []);

  // Open detail modal
  const openDetail = useCallback((report) => {
    setDetailReport(report);
  }, []);

  // Export
  const handleExport = useCallback(() => {
    const cols = [
      { key: "id", label: "ID" },
      { key: "reason", label: "Reason" },
      { key: "details", label: "Details" },
      { key: "status", label: "Status" },
      { key: "severity", label: "Severity" },
      { key: "reporter_id", label: "Reporter ID" },
      { key: "reported_user_id", label: "Reported User ID" },
      { key: "created_at", label: "Created" },
    ];
    const { exported, capped } = exportCsv(cols, reports, "reports");
    addToast({ variant: "success", title: `Exported ${exported} reports${capped ? " (capped at 10k)" : ""}` });
  }, [reports, addToast]);

  // Table columns
  const columns = useMemo(() => [
    {
      key: "reason",
      label: "Reason",
      render: (_v, row) => (
        <button
          className="text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-brand-500)] transition-colors cursor-pointer text-left"
          onClick={() => openDetail(row)}
        >
          {truncate(row.reason, 50)}
        </button>
      ),
    },
    {
      key: "reporter",
      label: "Reporter",
      render: (_v, row) => (
        <span className="text-xs text-[var(--color-text-secondary)]">
          {row.reporter?.display_name || row.reporter?.email || (row.reporter_id ? row.reporter_id.slice(0, 8) + "..." : "—")}
        </span>
      ),
    },
    {
      key: "reported",
      label: "Reported",
      render: (_v, row) => (
        <span className="text-xs text-[var(--color-text-secondary)]">
          {row.reported?.display_name || row.reported?.email || (row.reported_user_id ? row.reported_user_id.slice(0, 8) + "..." : "—")}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (_v, row) => (
        <Badge variant={STATUS_COLORS[row.status] || "default"} dot>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "severity",
      label: "Severity",
      sortable: true,
      render: (_v, row) => {
        const sevVariant = { low: "default", medium: "warning", high: "error", critical: "error" };
        return row.severity ? (
          <Badge variant={sevVariant[row.severity] || "default"}>{row.severity}</Badge>
        ) : (
          <span className="text-[var(--color-text-muted)]">—</span>
        );
      },
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      render: (_v, row) => (
        <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(row.created_at)}</span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (_v, row) => (
        <Button variant="ghost" size="sm" icon={Eye} onClick={() => openDetail(row)}>
          View
        </Button>
      ),
    },
  ], [openDetail]);

  const from = totalCount > 0 ? page * PAGE_SIZE + 1 : 0;
  const to = Math.min((page + 1) * PAGE_SIZE, totalCount);

  // Reporter/reported display for detail modal
  const reporterName = detailReport?.reporter?.display_name || detailReport?.reporter?.email || detailReport?.reporter_id || "—";
  const reportedName = detailReport?.reported?.display_name || detailReport?.reported?.email || detailReport?.reported_user_id || "—";

  return (
    <div className="flex flex-col gap-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Reports</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={Download} onClick={handleExport}>
            Export
          </Button>
          <Badge variant="outline">{totalCount} total</Badge>
        </div>
      </div>

      {/* Search */}
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch("")}
        placeholder="Search reason or details..."
        className="w-full sm:w-80"
      />

      {/* Status Filter Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--color-text-tertiary)] mr-1">Status:</span>
        {STATUS_OPTIONS.map((status) => {
          const isActive = activeFilter === status;
          return (
            <button
              key={status}
              onClick={() => { setActiveFilter(status); setPage(0); }}
              aria-pressed={isActive}
              className={[
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                "cursor-pointer transition-all duration-150 border",
                isActive
                  ? "bg-[var(--color-brand-500)] text-white border-[var(--color-brand-500)]"
                  : "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-200)] hover:border-[var(--gray-300)]",
              ].join(" ")}
            >
              <span className="capitalize">{status}</span>
            </button>
          );
        })}

        <span className="text-xs text-[var(--color-text-tertiary)] ml-4 mr-1">Severity:</span>
        {SEVERITY_OPTIONS.map((sev) => {
          const isActive = severityFilter === sev;
          return (
            <button
              key={sev}
              onClick={() => { setSeverityFilter(sev); setPage(0); }}
              aria-pressed={isActive}
              className={[
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                "cursor-pointer transition-all duration-150 border",
                isActive
                  ? "bg-[var(--color-brand-500)] text-white border-[var(--color-brand-500)]"
                  : "bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] border-[var(--gray-200)] hover:border-[var(--gray-300)]",
              ].join(" ")}
            >
              <span className="capitalize">{sev}</span>
            </button>
          );
        })}
      </div>

      {/* Reports Table */}
      <SectionCard noPadding>
        {error && !loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Failed to load reports</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{error}</p>
            <Button variant="link" onClick={refetchReports}>Try again</Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={reports}
            loading={loading}
            emptyIcon={Flag}
            emptyMessage={activeFilter === "all" && severityFilter === "all" && !debouncedSearch
              ? "All clear — no reports to review."
              : "No matching reports"
            }
            sortKey={sortKey}
            sortDirection={sortDir}
            onSort={handleSort}
            pagination={{
              page,
              pageSize: PAGE_SIZE,
              total: totalCount,
              from,
              to,
              onChange: setPage,
            }}
          />
        )}
      </SectionCard>

      {/* Detail Modal */}
      <Modal
        open={!!detailReport}
        onClose={() => setDetailReport(null)}
        title="Report Details"
        size="lg"
      >
        {detailReport && (
          <>
            <ModalBody>
              <div className="space-y-5">
                {/* Report info */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_COLORS[detailReport.status] || "default"} dot>
                      {detailReport.status}
                    </Badge>
                    {detailReport.severity && (
                      <Badge variant={detailReport.severity === "critical" || detailReport.severity === "high" ? "error" : detailReport.severity === "medium" ? "warning" : "default"}>
                        {detailReport.severity}
                      </Badge>
                    )}
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">Reason</h4>
                    <p className="text-sm text-[var(--color-text-secondary)]">{detailReport.reason || "—"}</p>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">Details</h4>
                    <p className="text-sm text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)] rounded-lg p-3">
                      {detailReport.details || "No details provided"}
                    </p>
                  </div>

                  <div className="text-xs text-[var(--color-text-tertiary)]">
                    Created {formatDateTime(detailReport.created_at)}
                    {detailReport.reviewed_at && <> · Reviewed {formatDateTime(detailReport.reviewed_at)}</>}
                  </div>
                </div>

                {/* Profiles */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-[var(--color-background-secondary)]">
                    <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase mb-1">Reporter</h4>
                    <p className="text-sm text-[var(--color-text-primary)]">{reporterName}</p>
                    {detailReport.reporter_id && (
                      <button
                        className="text-xs text-[var(--color-brand-500)] hover:underline mt-1 cursor-pointer"
                        onClick={() => {
                          setDetailReport(null);
                          window.location.hash = `#/users?userId=${detailReport.reporter_id}`;
                        }}
                      >
                        View User Profile →
                      </button>
                    )}
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--color-background-secondary)]">
                    <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase mb-1">Reported User</h4>
                    <p className="text-sm text-[var(--color-text-primary)]">{reportedName}</p>
                    {detailReport.reported_user_id && (
                      <button
                        className="text-xs text-[var(--color-brand-500)] hover:underline mt-1 cursor-pointer"
                        onClick={() => {
                          setDetailReport(null);
                          window.location.hash = `#/users?userId=${detailReport.reported_user_id}`;
                        }}
                      >
                        View User Profile →
                      </button>
                    )}
                  </div>
                </div>

                {/* Severity selector */}
                <div>
                  <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase mb-2">Set Severity</h4>
                  <div className="flex gap-2">
                    {["low", "medium", "high", "critical"].map((sev) => (
                      <button
                        key={sev}
                        onClick={() => updateSeverity(detailReport.id, sev)}
                        className={[
                          "px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all",
                          detailReport.severity === sev
                            ? "bg-[var(--color-brand-500)] text-white"
                            : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
                        ].join(" ")}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" size="sm" icon={RotateCcw} loading={updatingId === detailReport.id} onClick={() => updateStatus(detailReport.id, "pending")}>
                Reopen
              </Button>
              <Button variant="ghost" size="sm" icon={Eye} loading={updatingId === detailReport.id} onClick={() => updateStatus(detailReport.id, "reviewed")}>
                Mark Reviewed
              </Button>
              <Button variant="ghost" size="sm" icon={CheckCircle} loading={updatingId === detailReport.id} onClick={() => updateStatus(detailReport.id, "resolved")}>
                Resolve
              </Button>
              <Button variant="ghost" size="sm" icon={XCircle} loading={updatingId === detailReport.id} onClick={() => updateStatus(detailReport.id, "dismissed")}>
                Dismiss
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
