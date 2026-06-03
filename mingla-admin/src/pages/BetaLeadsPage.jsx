/**
 * BETA LEADS PAGE — ORCH-1045 [Business "Get Beta Access" lead-capture]
 *
 * Read-only list of leads captured by the organiser marketing site's 3-step
 * "Get Beta Access" form. Mirrors the LaunchCitiesPage pattern exactly (same
 * primitives, same states, mounted-ref guard, useToast).
 *
 * Reads via the SECURITY DEFINER `admin_beta_leads_list()` RPC (EXECUTE gated to
 * authenticated; anon revoked) — mirroring admin_launch_city_list(). The table
 * itself denies anon SELECT (no RLS policy); rows are never readable by the
 * public anon key (I-1045-ANON-NO-SELECT).
 *
 * Spec:   Mingla_Artifacts/specs/SPEC_ORCH-1045_BUSINESS_GET_BETA_ACCESS.md §3.5
 * Design: Mingla_Artifacts/specs/DESIGN_ORCH-1045_GET_BETA_ACCESS.md §8
 *
 * v1 is read-only (NG-6): no edit/delete/status workflow/CSV export.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Inbox, CalendarClock } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { supabase } from "../lib/supabase";

// Stored brand_type value → human label (mirror the form chips).
const BRAND_TYPE_LABELS = {
  restaurant: "Restaurant",
  cafe_bar: "Café / Bar",
  club_nightlife: "Club / Nightlife",
  event_organiser: "Event organiser",
  experience_tour: "Experience / Tour",
  venue_space: "Venue / Space",
  other: "Other",
};

// Stored source value → short label.
const SOURCE_LABELS = {
  organiser_marketing_hero: "Hero",
  organiser_marketing_nav: "Nav",
  organiser_marketing: "Site",
};

// ─── Summary metric chip (mirror LaunchCitiesPage SummaryChip) ────────────────
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export function BetaLeadsPage() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc("admin_beta_leads_list");
      if (error) throw error;
      if (mountedRef.current) setRows(data || []);
    } catch (err) {
      if (mountedRef.current) {
        setLoadError(err.message || "Failed to load beta leads");
        addToast({ variant: "error", title: "Couldn't load beta leads", description: err.message });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const total = rows.length;
  const thisWeek = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rows.filter((r) => new Date(r.created_at).getTime() >= cutoff).length;
  }, [rows]);

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
      key: "business",
      label: "Business",
      render: (_v, row) => (
        <div className="min-w-0">
          <p className="font-semibold text-[var(--color-text-primary)] truncate">{row.brand_name}</p>
          <div className="mt-1">
            <Badge variant="default">
              {BRAND_TYPE_LABELS[row.brand_type] || row.brand_type}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      key: "contact_name",
      label: "Contact",
      width: "160px",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)] truncate">{row.contact_name}</span>
      ),
    },
    {
      key: "city",
      label: "City",
      width: "140px",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)] truncate">{row.city}</span>
      ),
    },
    {
      key: "email",
      label: "Email",
      render: (_v, row) => (
        <button
          type="button"
          onClick={() => handleCopyEmail(row.email)}
          aria-label={`Copy ${row.email}`}
          className="font-mono text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer truncate"
        >
          {row.email}
        </button>
      ),
    },
    {
      key: "source",
      label: "Source",
      width: "120px",
      render: (_v, row) => (
        <Badge variant="outline">{SOURCE_LABELS[row.source] || row.source}</Badge>
      ),
    },
    {
      key: "created_at",
      label: "Received",
      width: "150px",
      sortable: true,
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
  ], [handleCopyEmail]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Beta Leads</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Everyone who asked for early access from the business site.
          </p>
        </div>
        {loading ? (
          <Skeleton width={72} height={22} rounded="full" className="mt-1 shrink-0" />
        ) : (
          <Badge variant="brand" dot className="mt-1 shrink-0">
            {total} leads
          </Badge>
        )}
      </div>

      {/* Load error */}
      {loadError && (
        <AlertCard
          variant="error"
          title="Couldn't load beta leads"
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
          <SummaryChip icon={Inbox} label="Total leads" value={total} accent="brand" />
          <SummaryChip icon={CalendarClock} label="This week" value={thisWeek} accent="muted" />
        </div>
      )}

      {/* List */}
      <SectionCard title="Beta leads" subtitle={`${total} total`} noPadding>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          striped
          emptyIcon={Inbox}
          emptyMessage="No beta leads yet."
          getRowId={(r) => r.id}
        />
      </SectionCard>
    </div>
  );
}
