import { useState, useEffect, useCallback, useRef } from "react";
import {
  Mic, MessageSquare, Bug, Lightbulb, AlertTriangle, HelpCircle,
  ChevronLeft, ChevronRight, Search, X, RefreshCw,
  Save, Clock, Smartphone, MapPin,
  CheckCircle, Eye, Archive, XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { StatCardSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;
const AUDIO_URL_EXPIRY_SECONDS = 3600;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  bug: { label: "Bug", variant: "error", icon: Bug },
  feature_request: { label: "Feature Request", variant: "brand", icon: Lightbulb },
  ux_issue: { label: "UX Issue", variant: "warning", icon: AlertTriangle },
  general: { label: "General", variant: "default", icon: HelpCircle },
};

const STATUS_CONFIG = {
  new: { label: "New", variant: "info", icon: MessageSquare },
  reviewed: { label: "Reviewed", variant: "warning", icon: Eye },
  actioned: { label: "Actioned", variant: "success", icon: CheckCircle },
  dismissed: { label: "Dismissed", variant: "default", icon: XCircle },
};

const STATUSES = ["new", "reviewed", "actioned", "dismissed"];
const CATEGORIES = ["bug", "feature_request", "ux_issue", "general"];

function formatRelativeTime(dateStr) {
  if (!dateStr) return "—";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatAbsoluteDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSessionDuration(ms) {
  if (!ms || ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function CategoryBadge({ category }) {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.general;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon className="h-3 w-3 mr-1 inline" />
      {config.label}
    </Badge>
  );
}

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

// ─── Audio Player Component ──────────────────────────────────────────────────

function AudioPlayer({ audioPath }) {
  const audioRef = useRef(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [error, setError] = useState(null);

  const fetchSignedUrl = useCallback(async () => {
    if (!audioPath) {
      setError("No audio file path");
      return;
    }
    setLoadingUrl(true);
    setError(null);
    try {
      const { data, error: storageError } = await supabase.storage
        .from("beta-feedback")
        .createSignedUrl(audioPath, AUDIO_URL_EXPIRY_SECONDS);
      if (storageError) throw storageError;
      if (!data?.signedUrl) throw new Error("No signed URL returned");
      setAudioUrl(data.signedUrl);
    } catch (err) {
      console.error("[BetaFeedback] audio URL error:", err);
      setError("Failed to load audio");
    } finally {
      setLoadingUrl(false);
    }
  }, [audioPath]);

  // Fetch URL on mount
  useEffect(() => {
    fetchSignedUrl();
  }, [fetchSignedUrl]);

  if (error) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-[var(--color-error-500)]">{error}</p>
        <Button variant="ghost" size="sm" onClick={fetchSignedUrl}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  if (loadingUrl) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
        <Spinner className="h-4 w-4" /> Loading audio…
      </div>
    );
  }

  if (!audioUrl) return null;

  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audioRef}
        src={audioUrl}
        controls
        preload="metadata"
        className="h-8 flex-1"
        style={{ minWidth: 200 }}
        onError={() => {
          setAudioUrl(null);
          setError("Audio expired — click refresh");
        }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BetaFeedbackPage() {
  const { addToast } = useToast();

  // List state
  const [feedback, setFeedback] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  // Stats
  const [stats, setStats] = useState({ total: 0, new: 0, reviewed: 0, actioned: 0, dismissed: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  // Detail modal
  const [detailModal, setDetailModal] = useState(false);
  const [detailItem, setDetailItem] = useState(null);

  // Notes editing
  const [editingNotes, setEditingNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState(null); // feedback_id being updated

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

  // ─── Fetch feedback list ──────────────────────────────────────────────────────

  const fetchFeedback = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      let query = supabase
        .from("beta_feedback")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      if (statusFilter) query = query.eq("status", statusFilter);
      if (categoryFilter) query = query.eq("category", categoryFilter);
      if (debouncedSearch) {
        query = query.or(
          `user_display_name.ilike.%${debouncedSearch}%,user_email.ilike.%${debouncedSearch}%`
        );
      }

      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;
      if (!mountedRef.current) return;
      setFeedback(data || []);
      setTotal(count ?? 0);
    } catch (err) {
      console.error("[BetaFeedback] fetch error:", err.message, err.code, err.details, err);
      if (mountedRef.current) {
        setListError(err.message);
        addToast({ variant: "error", title: "Failed to load feedback", description: err.message });
      }
    } finally {
      if (mountedRef.current) setListLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, categoryFilter, addToast]);

  // ─── Fetch stats ────────────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      // Fetch counts per status in parallel
      const [totalRes, newRes, reviewedRes, actionedRes, dismissedRes] = await Promise.all([
        supabase.from("beta_feedback").select("id", { count: "exact", head: true }),
        supabase.from("beta_feedback").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("beta_feedback").select("id", { count: "exact", head: true }).eq("status", "reviewed"),
        supabase.from("beta_feedback").select("id", { count: "exact", head: true }).eq("status", "actioned"),
        supabase.from("beta_feedback").select("id", { count: "exact", head: true }).eq("status", "dismissed"),
      ]);
      if (!mountedRef.current) return;
      setStats({
        total: totalRes.count ?? 0,
        new: newRes.count ?? 0,
        reviewed: reviewedRes.count ?? 0,
        actioned: actionedRes.count ?? 0,
        dismissed: dismissedRes.count ?? 0,
      });
    } catch (err) {
      console.error("[BetaFeedback] stats error:", err);
    } finally {
      if (mountedRef.current) setStatsLoading(false);
    }
  }, []);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ─── Update status ────────────────────────────────────────────────────────

  const handleStatusChange = async (feedbackId, newStatus) => {
    setUpdatingStatus(feedbackId);
    try {
      const { error } = await supabase
        .from("beta_feedback")
        .update({ status: newStatus })
        .eq("id", feedbackId);
      if (error) throw error;
      addToast({ variant: "success", title: "Status updated", description: `Changed to ${newStatus}` });
      // Update local state for immediate feedback
      setFeedback(prev => prev.map(f => f.id === feedbackId ? { ...f, status: newStatus } : f));
      if (detailItem?.id === feedbackId) {
        setDetailItem(prev => ({ ...prev, status: newStatus }));
      }
      fetchStats(); // Refresh counts
    } catch (err) {
      console.error("[BetaFeedback] status update error:", err);
      addToast({ variant: "error", title: "Failed to update status", description: err.message });
    } finally {
      setUpdatingStatus(null);
    }
  };

  // ─── Save admin notes ──────────────────────────────────────────────────────

  const handleSaveNotes = async () => {
    if (!detailItem) return;
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from("beta_feedback")
        .update({ admin_notes: editingNotes })
        .eq("id", detailItem.id);
      if (error) throw error;
      addToast({ variant: "success", title: "Notes saved" });
      setDetailItem(prev => ({ ...prev, admin_notes: editingNotes }));
      setFeedback(prev => prev.map(f => f.id === detailItem.id ? { ...f, admin_notes: editingNotes } : f));
    } catch (err) {
      console.error("[BetaFeedback] save notes error:", err);
      addToast({ variant: "error", title: "Failed to save notes", description: err.message });
    } finally {
      setSavingNotes(false);
    }
  };

  // ─── Open detail ──────────────────────────────────────────────────────────

  const openDetail = (item) => {
    setDetailItem(item);
    setEditingNotes(item.admin_notes || "");
    setDetailModal(true);
  };

  // ─── Pagination ────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasMore = (page + 1) * PAGE_SIZE < total;

  // ─── Derive audio path from full storage path ──────────────────────────────
  // audio_path stores: beta-feedback/{userId}/{filename}.m4a
  // createSignedUrl needs path relative to bucket, so strip the bucket prefix if present
  function getRelativeAudioPath(audioPath) {
    if (!audioPath) return null;
    // If the path starts with the bucket name, strip it
    if (audioPath.startsWith("beta-feedback/")) {
      return audioPath.slice("beta-feedback/".length);
    }
    return audioPath;
  }

  // ─── Table columns ──────────────────────────────────────────────────────────

  const columns = [
    {
      key: "created_at",
      header: "Date",
      render: (_val, row) => (
        <div title={formatAbsoluteDate(row.created_at)}>
          <p className="text-sm text-[var(--color-text-primary)]">{formatRelativeTime(row.created_at)}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{formatAbsoluteDate(row.created_at)}</p>
        </div>
      ),
    },
    {
      key: "user_display_name",
      header: "User",
      render: (_val, row) => (
        <div>
          <p className="font-medium text-[var(--color-text-primary)]">{row.user_display_name || "—"}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{row.user_email || "No email"}</p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (_val, row) => <CategoryBadge category={row.category} />,
    },
    {
      key: "audio_duration_ms",
      header: "Duration",
      render: (_val, row) => (
        <div className="flex items-center gap-1.5">
          <Mic className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">
            {formatDuration(row.audio_duration_ms)}
          </span>
        </div>
      ),
    },
    {
      key: "device",
      header: "Device",
      render: (_val, row) => (
        <div className="flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">
            {row.device_os ? `${row.device_os === "ios" ? "iOS" : "Android"} — ${row.device_model || "Unknown"}` : "—"}
          </span>
        </div>
      ),
    },
    {
      key: "app_version",
      header: "Version",
      render: (_val, row) => (
        <span className="text-sm text-[var(--color-text-secondary)]">{row.app_version || "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (_val, row) => (
        <select
          value={row.status || "new"}
          onChange={(e) => handleStatusChange(row.id, e.target.value)}
          disabled={updatingStatus === row.id}
          className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] px-2 py-1 cursor-pointer"
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (_val, row) => (
        <Button variant="ghost" size="sm" onClick={() => openDetail(row)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Beta Feedback</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Browse, play, and manage audio feedback from beta testers
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {statsLoading ? (
          Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Total Submissions" value={stats.total} icon={Mic} />
            <StatCard label="New" value={stats.new} icon={MessageSquare} />
            <StatCard label="Reviewed" value={stats.reviewed} icon={Eye} />
            <StatCard label="Actioned" value={stats.actioned} icon={CheckCircle} />
            <StatCard label="Dismissed" value={stats.dismissed} icon={XCircle} />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SearchInput
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Status filter */}
          {[null, ...STATUSES].map((s) => (
            <button
              key={s ?? "all"}
              onClick={() => { setStatusFilter(s); setPage(0); }}
              className={[
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                statusFilter === s
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
              ].join(" ")}
            >
              {s ? STATUS_CONFIG[s].label : "All"}
            </button>
          ))}
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        <span className="text-sm text-[var(--color-text-tertiary)] py-1.5">Category:</span>
        {[null, ...CATEGORIES].map((c) => (
          <button
            key={c ?? "all"}
            onClick={() => { setCategoryFilter(c); setPage(0); }}
            className={[
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
              categoryFilter === c
                ? "bg-[var(--color-brand-500)] text-white"
                : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
            ].join(" ")}
          >
            {c ? CATEGORY_CONFIG[c].label : "All"}
          </button>
        ))}
      </div>

      {/* Table */}
      <SectionCard>
        {listError ? (
          <div className="text-center py-12">
            <AlertTriangle className="h-8 w-8 text-[var(--color-error-500)] mx-auto mb-3" />
            <p className="text-[var(--color-text-secondary)] mb-3">{listError}</p>
            <Button variant="secondary" onClick={fetchFeedback}>Retry</Button>
          </div>
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={feedback}
              loading={listLoading}
              emptyMessage="No beta feedback found"
            />
            {/* Pagination */}
            {!listLoading && feedback.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
                <p className="text-sm text-[var(--color-text-tertiary)]">
                  {total === 0 ? "0" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)}`} of {total}
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

      {/* Detail Modal */}
      <Modal
        open={detailModal}
        onClose={() => { setDetailModal(false); setDetailItem(null); }}
        title="Feedback Details"
        size="lg"
      >
        <ModalBody>
          {detailItem && (
            <div className="space-y-6">
              {/* User Info */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">User Info</h4>
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg" style={{ backgroundColor: "var(--color-background-secondary)" }}>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Name</p>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">{detailItem.user_display_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Email</p>
                    <p className="text-sm text-[var(--color-text-primary)]">{detailItem.user_email || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Phone</p>
                    <p className="text-sm text-[var(--color-text-primary)]">{detailItem.user_phone || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Category</p>
                    <CategoryBadge category={detailItem.category} />
                  </div>
                </div>
              </div>

              {/* Device Info */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Device & Context</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg" style={{ backgroundColor: "var(--color-background-secondary)" }}>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Device</p>
                    <p className="text-sm text-[var(--color-text-primary)]">
                      {detailItem.device_os === "ios" ? "iOS" : detailItem.device_os === "android" ? "Android" : detailItem.device_os || "—"}
                      {detailItem.device_os_version ? ` ${detailItem.device_os_version}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Model</p>
                    <p className="text-sm text-[var(--color-text-primary)]">{detailItem.device_model || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">App Version</p>
                    <p className="text-sm text-[var(--color-text-primary)]">{detailItem.app_version || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Screen Before</p>
                    <p className="text-sm text-[var(--color-text-primary)]">{detailItem.screen_before || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-tertiary)]">Session Duration</p>
                    <p className="text-sm text-[var(--color-text-primary)]">{formatSessionDuration(detailItem.session_duration_ms)}</p>
                  </div>
                  {(detailItem.latitude != null && detailItem.longitude != null) && (
                    <div>
                      <p className="text-xs text-[var(--color-text-tertiary)]">Location</p>
                      <p className="text-sm text-[var(--color-text-primary)] flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {detailItem.latitude.toFixed(4)}, {detailItem.longitude.toFixed(4)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Audio Player */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">
                  Audio Recording ({formatDuration(detailItem.audio_duration_ms)})
                </h4>
                <div className="p-3 rounded-lg" style={{ backgroundColor: "var(--color-background-secondary)" }}>
                  <AudioPlayer
                    audioPath={getRelativeAudioPath(detailItem.audio_path)}
                  />
                </div>
              </div>

              {/* Admin Section */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider mb-2">Admin</h4>
                <div className="space-y-3">
                  {/* Status */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Status</label>
                    <select
                      value={detailItem.status || "new"}
                      onChange={(e) => handleStatusChange(detailItem.id, e.target.value)}
                      disabled={updatingStatus === detailItem.id}
                      className="w-full text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] px-3 py-2 cursor-pointer"
                    >
                      {STATUSES.map(s => (
                        <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">Admin Notes</label>
                    <textarea
                      value={editingNotes}
                      onChange={(e) => setEditingNotes(e.target.value)}
                      rows={3}
                      placeholder="Add notes about this feedback..."
                      className="w-full text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] px-3 py-2 resize-y"
                    />
                    <div className="flex justify-end mt-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveNotes}
                        loading={savingNotes}
                        disabled={editingNotes === (detailItem.admin_notes || "")}
                      >
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                        Save Notes
                      </Button>
                    </div>
                  </div>

                  {/* Timestamps */}
                  <div className="flex gap-4 text-xs text-[var(--color-text-tertiary)] pt-2 border-t border-[var(--color-border)]">
                    <span>Submitted: {formatAbsoluteDate(detailItem.created_at)}</span>
                    {detailItem.updated_at && detailItem.updated_at !== detailItem.created_at && (
                      <span>Updated: {formatAbsoluteDate(detailItem.updated_at)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </ModalBody>
      </Modal>
    </div>
  );
}
