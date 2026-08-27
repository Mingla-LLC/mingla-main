/**
 * TOOL LEADS PAGE — ISSUE-1354 [Admin: see all free-tool submissions]
 *
 * Read-only list of EVERY submission the 4 marketing free tools funnel into
 * public.tool_leads (anonymous runs + email-captured leads). Filterable by tool
 * and by has-email, with a per-row detail modal showing the visitor's `input`
 * and the generated `report`. Mirrors BetaLeadsPage structure/styling exactly
 * (same primitives, mounted-ref guard, useToast).
 *
 * Reads via two SECURITY DEFINER RPCs (EXECUTE gated to authenticated + a
 * DB-level is_admin_user() guard; anon revoked) —
 *   admin_tool_leads_list(p_tool, p_has_email, p_search, p_limit, p_offset, p_lane)
 *   admin_tool_lead_get(p_id)
 * The table itself denies anon SELECT (RLS deny-all). The list RPC never returns
 * `report` / `report_token` / `ip_hash`; the detail RPC returns `report` +
 * `report_token` (for the tokenized report link) but never `ip_hash`.
 *
 * ISSUE-1734 (ADM-1734-LANE, D-S1a resolved): rows now carry a `lane` badge
 * (Web = anonymous marketing funnel; App = signed-in Business app runs) and an
 * All/Web/App filter (default All — p_lane null). The detail modal shows
 * lane + brand_id/user_id/subject_ref when present (app rows). App runs are
 * product usage, NOT leads — filter lane=web for clean lead metrics.
 *
 * v1 is read-only: no edit/delete/status workflow/CSV export.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Wrench, Inbox, Mail, ExternalLink } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Skeleton } from "../components/ui/Skeleton";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { SearchInput } from "../components/ui/SearchInput";
import { Tabs } from "../components/ui/Tabs";
import { useToast } from "../context/ToastContext";
import { supabase } from "../lib/supabase";

const PAGE_SIZE = 100;

// Stored tool value → human product name (mirror the marketing tool names +
// the founder-notify builder in growth-tools-gate).
const TOOL_LABELS = {
  venues: "Venue Website Grader",
  events: "Event Turnout Predictor",
  trips: "Quote Any Trip",
  experiences: "Undercharging Audit",
};

// Tool-filter dropdown options (null = all tools).
const TOOL_OPTIONS = [
  { value: "", label: "All tools" },
  { value: "venues", label: TOOL_LABELS.venues },
  { value: "events", label: TOOL_LABELS.events },
  { value: "trips", label: TOOL_LABELS.trips },
  { value: "experiences", label: TOOL_LABELS.experiences },
];

// has-email 3-way filter → p_has_email (null / true / false).
const HAS_EMAIL_OPTIONS = [
  { value: "all", label: "All leads" },
  { value: "yes", label: "Has email" },
  { value: "no", label: "Anonymous" },
];

// ISSUE-1734 lane filter → p_lane (null / 'web' / 'app'). Default All (D-S1a).
const LANE_OPTIONS = [
  { value: "", label: "All lanes" },
  { value: "web", label: "Web" },
  { value: "app", label: "App" },
];

// Lane badge variant/label. Legacy rows (pre-migration reads) default to Web.
const LANE_BADGE = {
  web: { variant: "default", label: "Web" },
  app: { variant: "info", label: "App" },
};

// Stored status value → { variant, label } for the status badge.
const STATUS = {
  created: { variant: "default", label: "Created" },
  report_ready: { variant: "info", label: "Report ready" },
  gated_email: { variant: "brand", label: "Email captured" },
  emailed: { variant: "success", label: "Emailed" },
  failed: { variant: "error", label: "Failed" },
};

// tool → the public report path (mirror growth-tools-gate reportPath map).
const REPORT_PATH = {
  venues: "/tools/venues/report",
  events: "/tools/events/report",
  trips: "/tools/trips/report",
  experiences: "/tools/pricing/report",
};

// The exact tokenized report link the visitor received (only when a token
// exists — the list RPC never carries the token, so this is detail-only).
function reportLinkFor(row) {
  const path = REPORT_PATH[row?.tool] || REPORT_PATH.venues;
  if (!row?.id || !row?.report_token) return null;
  return `https://usemingla.com${path}?id=${encodeURIComponent(row.id)}&t=${encodeURIComponent(row.report_token)}`;
}

// Business/subject label pulled defensively from the input jsonb.
function subjectOf(input) {
  if (!input || typeof input !== "object") return null;
  return input.name || input.title || null;
}

// Relative-time formatter ("2h ago", "3d ago", "just now").
function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

// ─── Summary metric chip (mirror BetaLeadsPage SummaryChip) ───────────────────
function SummaryChip({ icon: Icon, label, value, accent = "muted" }) {
  const bubbleBg = accent === "brand" ? "bg-[var(--color-brand-50)]" : "bg-[var(--gray-100)]";
  const iconColor = accent === "brand" ? "text-[var(--color-brand-500)]" : "text-[var(--gray-500)]";
  return (
    <div className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-4 py-3 shadow-[var(--shadow-sm)]">
      <span className={`flex h-9 w-9 items-center justify-center rounded-full ${bubbleBg}`}>
        {Icon && <Icon className={`h-[18px] w-[18px] ${iconColor}`} />}
      </span>
      <div className="leading-tight">
        <p className="text-[20px] font-bold tabular-nums text-[var(--color-text-primary)]">{value}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      </div>
    </div>
  );
}

const SELECT_CLASS =
  "rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]";

// ─── Page ─────────────────────────────────────────────────────────────────────
export function ToolLeadsPage() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [rows, setRows] = useState([]);
  const [activeTab, setActiveTab] = useState("leads");
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Filters. toolFilter "" = all; hasEmail "all"|"yes"|"no"; laneFilter "" =
  // all lanes (ISSUE-1734); search debounced.
  const [toolFilter, setToolFilter] = useState("");
  const [hasEmail, setHasEmail] = useState("all");
  const [laneFilter, setLaneFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Debounce the search box → `search` (the RPC param).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Changing a filter resets to page 0.
  const onToolChange = useCallback((v) => { setToolFilter(v); setPage(0); }, []);
  const onHasEmailChange = useCallback((v) => { setHasEmail(v); setPage(0); }, []);
  const onLaneChange = useCallback((v) => { setLaneFilter(v); setPage(0); }, []);

  const pHasEmail = hasEmail === "yes" ? true : hasEmail === "no" ? false : null;

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc("admin_tool_leads_list", {
        p_tool: toolFilter || null,
        p_has_email: pHasEmail,
        p_search: search || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        // ISSUE-1734: null = All (D-S1a default); 'web'/'app' filter exactly.
        p_lane: laneFilter || null,
      });
      if (error) throw error;
      if (mountedRef.current) {
        setRows(data || []);
        setTotalCount(Number(data?.[0]?.total_count ?? 0));
      }
    } catch (err) {
      if (mountedRef.current) {
        setLoadError(err.message || "Failed to load tool leads");
        addToast({ variant: "error", title: "Couldn't load tool leads", description: err.message });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [toolFilter, pHasEmail, laneFilter, search, page, addToast]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const withEmail = useMemo(() => rows.filter((r) => r.email).length, [rows]);

  // ── Detail modal (admin_tool_lead_get) ─────────────────────────────────────
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const openDetail = useCallback(async (row) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_tool_lead_get", { p_id: row.id });
      if (error) throw error;
      if (mountedRef.current) setDetail(Array.isArray(data) ? data[0] ?? null : data ?? null);
    } catch (err) {
      if (mountedRef.current) {
        setDetailError(err.message || "Failed to load lead detail");
        addToast({ variant: "error", title: "Couldn't load lead detail", description: err.message });
      }
    } finally {
      if (mountedRef.current) setDetailLoading(false);
    }
  }, [addToast]);

  const closeDetail = useCallback(() => setDetailOpen(false), []);

  const handleCopyEmail = useCallback(async (emailValue) => {
    try {
      await navigator.clipboard.writeText(emailValue);
      addToast({ variant: "success", title: "Email copied" });
    } catch {
      addToast({ variant: "error", title: "Couldn't copy email" });
    }
  }, [addToast]);

  const columns = useMemo(() => [
    {
      key: "tool",
      label: "Tool",
      width: "180px",
      render: (_v, row) => (
        <Badge variant="outline">{TOOL_LABELS[row.tool] || row.tool}</Badge>
      ),
    },
    {
      key: "lane",
      label: "Lane",
      width: "90px",
      render: (_v, row) => {
        const l = LANE_BADGE[row.lane] || LANE_BADGE.web;
        return <Badge variant={l.variant}>{l.label}</Badge>;
      },
    },
    {
      key: "subject",
      label: "Business / subject",
      render: (_v, row) => {
        const subj = subjectOf(row.input);
        return (
          <span className="text-[var(--color-text-primary)] truncate">
            {subj || <span className="text-[var(--color-text-muted)]">—</span>}
          </span>
        );
      },
    },
    {
      key: "email",
      label: "Email",
      render: (_v, row) => (
        row.email ? (
          <button
            type="button"
            onClick={() => handleCopyEmail(row.email)}
            aria-label={`Copy ${row.email}`}
            className="font-mono text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer truncate"
          >
            {row.email}
          </button>
        ) : (
          <span className="text-[var(--color-text-muted)] italic">Anonymous</span>
        )
      ),
    },
    {
      key: "status",
      label: "Status",
      width: "140px",
      render: (_v, row) => {
        const s = STATUS[row.status] || { variant: "default", label: row.status };
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      key: "attribution",
      label: "Attribution",
      width: "160px",
      render: (_v, row) => {
        const src = row.utm && typeof row.utm === "object" ? row.utm.source : null;
        if (!row.pid && !src) return <span className="text-[var(--color-text-muted)]">—</span>;
        return (
          <span className="text-xs text-[var(--color-text-secondary)] truncate">
            {row.pid || "—"}{src ? ` · ${src}` : ""}
          </span>
        );
      },
    },
    {
      key: "created_at",
      label: "Received",
      width: "130px",
      cellClassName: "tabular-nums",
      render: (_v, row) => (
        <span
          className="text-[var(--color-text-secondary)] tabular-nums"
          title={new Date(row.created_at).toISOString()}
        >
          {relativeTime(row.created_at)}
        </span>
      ),
    },
    {
      key: "view",
      label: "",
      width: "90px",
      render: (_v, row) => (
        <Button variant="secondary" size="sm" onClick={() => openDetail(row)}>
          View
        </Button>
      ),
    },
  ], [handleCopyEmail, openDetail]);

  const detailLink = detail ? reportLinkFor(detail) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Tool Leads</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Every submission from the free marketing tools — anonymous runs and email-captured leads.
          </p>
        </div>
        {loading ? (
          <Skeleton width={72} height={22} rounded="full" className="mt-1 shrink-0" />
        ) : (
          <Badge variant="brand" dot className="mt-1 shrink-0">
            {totalCount} leads
          </Badge>
        )}
      </div>

      <Tabs
        tabs={[{ id: "leads", label: "Tool leads" }, { id: "competitor-ops", label: "Competitor Ops" }]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "leads" ? <div id="tabpanel-tool-leads" role="tabpanel" className="contents">

      {/* Load error */}
      {loadError && (
        <AlertCard
          variant="error"
          title="Couldn't load tool leads"
          action={<Button variant="secondary" size="sm" onClick={fetchLeads}>Retry</Button>}
        >
          {loadError}
        </AlertCard>
      )}

      {/* Summary strip */}
      {loading ? (
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton width={160} height={62} style={{ borderRadius: 12 }} />
          <Skeleton width={160} height={62} style={{ borderRadius: 12 }} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <SummaryChip icon={Inbox} label="Total leads" value={totalCount} accent="brand" />
          <SummaryChip icon={Mail} label="With email (this page)" value={withEmail} accent="muted" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={toolFilter}
          onChange={(e) => onToolChange(e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by tool"
        >
          {TOOL_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={hasEmail}
          onChange={(e) => onHasEmailChange(e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by email presence"
        >
          {HAS_EMAIL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={laneFilter}
          onChange={(e) => onLaneChange(e.target.value)}
          className={SELECT_CLASS}
          aria-label="Filter by lane"
        >
          {LANE_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>{o.label}</option>
          ))}
        </select>
        <SearchInput
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onClear={() => setSearchInput("")}
          placeholder="Search email or business…"
          className="w-full sm:w-[280px] sm:ml-auto"
        />
      </div>

      {/* List */}
      <SectionCard title="Tool leads" subtitle={`${totalCount} total`} noPadding>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          striped
          emptyIcon={Wrench}
          emptyMessage="No tool leads match this filter."
          getRowId={(r) => r.id}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: totalCount,
            from: totalCount === 0 ? 0 : page * PAGE_SIZE + 1,
            to: page * PAGE_SIZE + rows.length,
            onChange: setPage,
          }}
        />
      </SectionCard>

      {/* Detail modal */}
      <Modal open={detailOpen} onClose={closeDetail} title="Lead detail" size="lg">
        <ModalBody>
          {detailLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton width="60%" height={20} />
              <Skeleton width="100%" height={120} style={{ borderRadius: 8 }} />
              <Skeleton width="100%" height={180} style={{ borderRadius: 8 }} />
            </div>
          ) : detailError ? (
            <AlertCard variant="error" title="Couldn't load lead detail">
              {detailError}
            </AlertCard>
          ) : detail ? (
            <div className="flex flex-col gap-4">
              {/* Header row */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{TOOL_LABELS[detail.tool] || detail.tool}</Badge>
                <Badge variant={(LANE_BADGE[detail.lane] || LANE_BADGE.web).variant}>
                  {(LANE_BADGE[detail.lane] || LANE_BADGE.web).label}
                </Badge>
                <Badge variant={(STATUS[detail.status] || { variant: "default" }).variant}>
                  {(STATUS[detail.status] || { label: detail.status }).label}
                </Badge>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {new Date(detail.created_at).toLocaleString()}
                </span>
              </div>

              {/* ISSUE-1734: app-run identity (present on lane='app' rows only) */}
              {(detail.brand_id || detail.user_id || detail.subject_ref) && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">App run</p>
                  <div className="flex flex-col gap-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
                    {detail.brand_id && <span>brand: {detail.brand_id}</span>}
                    {detail.user_id && <span>user: {detail.user_id}</span>}
                    {detail.subject_ref && <span>subject: {detail.subject_ref}</span>}
                  </div>
                </div>
              )}

              {/* Lead email */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">Email</p>
                <p className="font-mono text-sm text-[var(--color-text-primary)]">
                  {detail.email || <span className="italic text-[var(--color-text-muted)]">Anonymous</span>}
                </p>
              </div>

              {/* Report link */}
              {detailLink && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">Report link (the visitor's tokenized link)</p>
                  <a
                    href={detailLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[var(--color-brand-600)] hover:underline break-all"
                  >
                    Open report <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                </div>
              )}

              {/* Input */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">Input</p>
                <pre className="overflow-x-auto rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] p-3 text-xs text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
                  {JSON.stringify(detail.input ?? {}, null, 2)}
                </pre>
              </div>

              {/* Report */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">Report</p>
                {detail.report ? (
                  <pre className="max-h-[320px] overflow-auto rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] p-3 text-xs text-[var(--color-text-primary)] whitespace-pre-wrap break-words">
                    {JSON.stringify(detail.report, null, 2)}
                  </pre>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)] italic">No report generated yet.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No detail available.</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={closeDetail}>Close</Button>
        </ModalFooter>
      </Modal>
      </div> : <CompetitorOpsPanel addToast={addToast} />}
    </div>
  );
}

const OPS_STATES = ["", "due", "leased", "retry_wait", "succeeded", "partial", "no_change", "failed_terminal", "budget_deferred", "cancelled"];

function CompetitorOpsPanel({ addToast }) {
  const [data, setData] = useState({ capabilities: [], jobs: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState(null);
  const [provider, setProvider] = useState(""); const [state, setState] = useState(""); const [due, setDue] = useState("any"); const [brand, setBrand] = useState(""); const [safeError, setSafeError] = useState("");
  const [providerModal, setProviderModal] = useState(null); const [retryJob, setRetryJob] = useState(null); const [reason, setReason] = useState(""); const [mutationError, setMutationError] = useState(null); const [pending, setPending] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(null); const { data: result, error: rpcError } = await supabase.rpc("admin_competitor_intel_list", { p_provider: provider || null, p_state: state || null, p_due: due, p_brand: brand || null, p_error: safeError || null }); if (rpcError) setError(rpcError.message); else setData(result || { capabilities: [], jobs: [] }); setLoading(false); }, [provider, state, due, brand, safeError]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const action = useCallback(async () => { const target = providerModal?.kind || retryJob?.id; if (!target) return; if (!reason.trim()) { setMutationError("Add a reason before continuing."); return; } setPending(true); setMutationError(null); const pAction = providerModal ? (providerModal.enabled ? "pause_provider" : "resume_provider") : "retry_job"; const { error: rpcError } = await supabase.rpc("admin_competitor_intel_action", { p_action: pAction, p_target: target, p_expected_generation: providerModal?.generation ?? null, p_reason: reason.trim() }); if (rpcError) setMutationError(rpcError.message.includes("generation") ? "Provider state changed. Reload before trying again." : rpcError.message.includes("retry") ? "This job can’t be retried now. Refresh the table." : `Couldn't ${providerModal ? "update provider" : "queue the retry"} — try again.`); else { addToast({ variant: "success", title: providerModal ? `${providerModal.kind} checking ${providerModal.enabled ? "paused" : "resumed"}.` : "Retry queued." }); setProviderModal(null); setRetryJob(null); setReason(""); await load(); } setPending(false); }, [providerModal, retryJob, reason, addToast, load]);
  const columns = useMemo(() => [
    { key: "state", label: "State", render: (v) => <Badge variant={v === "failed_terminal" ? "error" : v === "succeeded" ? "success" : "default"}>{String(v).replaceAll("_", " ")}</Badge> },
    { key: "provider", label: "Provider" }, { key: "watch_id", label: "Watch ID" }, { key: "brand_id", label: "Brand ID" }, { key: "attempts", label: "Attempts" },
    { key: "last_attempt", label: "Last attempt", render: (v) => v ? relativeTime(v) : "—" }, { key: "last_success", label: "Last success", render: (v) => v ? relativeTime(v) : "—" }, { key: "next_due", label: "Next due", render: (v) => v ? relativeTime(v) : "—" },
    { key: "budget", label: "Budget reserved / actual", render: (_v, row) => `${row.budget_reserved ?? 0} / ${row.budget_actual ?? "—"}` }, { key: "safe_reason", label: "Safe reason", render: (v) => v || "—" },
    { key: "action", label: "", render: (_v, row) => row.state === "failed_terminal" && row.admin_retry_count < 1 ? <Button variant="secondary" size="sm" onClick={() => { setRetryJob(row); setReason(""); }} data-testid={`competitor-ops-job-${row.id}-retry`}>Retry once</Button> : null },
  ], []);
  return <div id="tabpanel-competitor-ops" role="tabpanel" aria-labelledby="tool-leads-tab-competitor-ops" className="flex flex-col gap-6">
    {error ? <AlertCard variant="error" title="Couldn't load competitor operations" action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>}>{error}</AlertCard> : null}
    <div className="flex flex-wrap gap-3">{loading ? [0, 1].map((i) => <Skeleton key={i} width={240} height={110} />) : data.capabilities.map((cap) => <SectionCard key={cap.kind} title={cap.kind} data-testid={`competitor-ops-provider-${cap.kind}`}><Badge variant={cap.enabled ? "success" : "default"}>{cap.enabled ? "Enabled" : "Paused"}</Badge><p className="text-sm text-[var(--color-text-secondary)]">Generation {cap.generation}</p>{cap.safe_reason ? <p className="text-sm text-[var(--color-text-secondary)]">{cap.safe_reason}</p> : null}<Button variant="secondary" size="sm" onClick={() => { setProviderModal(cap); setReason(""); }}>{cap.enabled ? `Pause ${cap.kind}` : `Resume ${cap.kind}`}</Button></SectionCard>)}</div>
    <p className="text-sm text-[var(--color-text-secondary)]">TikTok is link only and cannot be enabled here.</p>
    <div className="flex flex-wrap gap-3"><select value={provider} onChange={(e) => setProvider(e.target.value)} className={SELECT_CLASS} data-testid="competitor-ops-filter-provider"><option value="">All providers</option><option value="website">Website</option><option value="instagram">Instagram</option></select><select value={state} onChange={(e) => setState(e.target.value)} className={SELECT_CLASS} data-testid="competitor-ops-filter-state">{OPS_STATES.map((v) => <option key={v || "all"} value={v}>{v ? v.replaceAll("_", " ") : "All states"}</option>)}</select><select value={due} onChange={(e) => setDue(e.target.value)} className={SELECT_CLASS} data-testid="competitor-ops-filter-due"><option value="any">Any due time</option><option value="due">Due now</option><option value="overdue">Overdue</option></select><SearchInput value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand internal id" data-testid="competitor-ops-filter-brand" /><SearchInput value={safeError} onChange={(e) => setSafeError(e.target.value)} placeholder="Safe error" data-testid="competitor-ops-filter-error" /></div>
    <SectionCard title="Competitor jobs" noPadding><DataTable columns={columns} rows={data.jobs} loading={loading} emptyMessage="No competitor jobs match these filters." getRowId={(row) => row.id} data-testid="competitor-ops-table" /></SectionCard>
    <Modal open={providerModal !== null} onClose={() => setProviderModal(null)} title={`${providerModal?.enabled ? "Pause" : "Resume"} ${providerModal?.kind ?? "provider"} checking?`} size="md"><ModalBody><p className="text-sm text-[var(--color-text-secondary)]">{providerModal?.enabled ? "New checks will stop. Existing venue briefs stay visible and affected watches will show the source as paused." : "Eligible watches will be queued once under the new provider generation."}</p><label className="text-sm font-semibold">Reason</label><SearchInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you changing this provider?" />{mutationError ? <p className="text-sm text-[var(--color-error-700)]">{mutationError}</p> : null}</ModalBody><ModalFooter><Button variant="secondary" size="sm" onClick={() => setProviderModal(null)}>Cancel</Button><Button size="sm" loading={pending} onClick={action}>{providerModal?.enabled ? "Pause checking" : "Resume checking"}</Button></ModalFooter></Modal>
    <Modal open={retryJob !== null} onClose={() => setRetryJob(null)} title="Retry this failed competitor job?" size="md"><ModalBody><p className="text-sm text-[var(--color-text-secondary)]">This uses the scheduled budget and can run once. It does not use the venue's manual refresh allowance.</p><label className="text-sm font-semibold">Reason</label><SearchInput value={reason} onChange={(e) => setReason(e.target.value)} />{mutationError ? <p className="text-sm text-[var(--color-error-700)]">{mutationError}</p> : null}</ModalBody><ModalFooter><Button variant="secondary" size="sm" onClick={() => setRetryJob(null)}>Cancel</Button><Button size="sm" loading={pending} onClick={action}>Retry once</Button></ModalFooter></Modal>
  </div>;
}
