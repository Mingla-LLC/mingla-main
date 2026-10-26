// ORCH-1273 [Admin Offerings console — READ-ONLY] — Offerings console.
// Issue #4130 (Wave 3) — rebuilt list: opens on "On sale and upcoming" (not
// far-future drafts), one state per row, sold / going counts, a KPI row, and
// offerings of deleted or staff/test brands hidden unless asked for. Served by
// the admin-only admin_offerings_summary + admin_list_offerings_board RPCs.
//
// Row click → the type-aware OfferingDetailView (#/business-offerings?offeringId=<id>).
// READ-ONLY list: no edit or mutation here; offering actions live in the detail.

import { useState, useEffect, useCallback } from "react";
import { CalendarDays } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { Badge } from "../components/ui/Badge";
import { LoadError } from "../components/ui/LoadError";
import { StatTileSkeleton } from "../components/crm/home/StatTile";
import { listOfferingsBoard, getOfferingsSummary } from "../services/offeringsService";
import { OfferingDetailView } from "./OfferingDetailView";
import { formatDateTime } from "../lib/formatters";
import { PageHeader } from "../components/ui/PageHeader";
import {
  OFFERING_VIEWS,
  offeringState,
  offeringTypeLabel,
  offeringViewFor,
  soldOrGoing,
} from "../lib/peopleSegments";

const muted = (text) => <span className="text-[var(--color-text-muted)]">{text}</span>;

const COLUMNS = [
  {
    key: "title",
    label: "Offering",
    render: (val, row) => (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="truncate font-medium text-[var(--color-text-primary)]">{val || "Untitled"}</span>
        {row.hidden && <Badge variant="default">Deleted or test brand</Badge>}
      </span>
    ),
  },
  { key: "brand_name", label: "Brand", render: (val) => val || muted("No brand") },
  { key: "event_type", label: "Type", render: (val) => offeringTypeLabel(val) },
  { key: "start_at", label: "When", sortable: true, render: (val) => (val ? formatDateTime(val) : muted("No date yet")) },
  {
    key: "state",
    label: "State",
    render: (val) => {
      const st = offeringState(val);
      return <Badge variant={st.variant} dot>{st.label}</Badge>;
    },
  },
  { key: "sold", label: "Sold / going", render: (_val, row) => <span className="tabular-nums">{soldOrGoing(row)}</span> },
  { key: "city", label: "City", render: (val) => val || muted("–") },
];

const FILTERS = [
  {
    key: "event_type",
    label: "Any type",
    options: [
      { value: "event", label: "Event" },
      { value: "experience", label: "Experience" },
      { value: "trip", label: "Trip" },
      { value: "rsvp", label: "RSVP" },
    ],
  },
  { key: "show", label: "Live brands only", options: [{ value: "all", label: "Include deleted and test brands" }] },
];

const CSV = {
  columns: [
    { key: "id", label: "ID" },
    { key: "title", label: "Offering" },
    { key: "brand_name", label: "Brand" },
    { key: "event_type", label: "Type" },
    { key: "start_at", label: "Starts" },
    { key: "state", label: "State" },
    { key: "sold", label: "Sold" },
    { key: "going", label: "Going" },
    { key: "city", label: "City" },
    { key: "currency", label: "Currency" },
    { key: "created_at", label: "Created" },
  ],
  filename: "offerings",
};

const EMPTY = {
  on_sale: "Nothing on sale right now. Published offerings that haven't ended appear here.",
  drafts: "No drafts. Offerings hosts start but haven't published appear here.",
  past: "Nothing has ended yet. Offerings appear here once they're over.",
  cancelled: "Nothing cancelled.",
};

// ── Hash helpers ──────────────────────────────────────────────────────────────

function hashParams() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "");
}

function offeringIdFromHash() {
  return hashParams().get("offeringId");
}

function viewFromHash() {
  return offeringViewFor(hashParams().get("view")).id;
}

function Kpi({ value, label, note }) {
  return (
    <div className="flex min-h-[92px] min-w-0 flex-col justify-center rounded-xl border border-[var(--gray-200)] border-l-[3px] border-l-[var(--color-brand-500)] bg-[var(--color-background-primary)] p-4">
      <span className="text-[28px] font-bold leading-tight tabular-nums text-[var(--color-text-primary)]">{value}</span>
      <span className="text-[13px] text-[var(--color-text-secondary)]">{label}</span>
      {note ? <span className="mt-1 text-xs text-[var(--color-text-tertiary)]">{note}</span> : null}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OfferingsConsolePage() {
  const [selectedId, setSelectedId] = useState(() => offeringIdFromHash());
  const [view, setView] = useState(viewFromHash);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  useEffect(() => {
    const sync = () => {
      setSelectedId(offeringIdFromHash());
      setView(viewFromHash());
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await getOfferingsSummary());
    } catch (err) {
      setSummary(null);
      setSummaryError(err?.message || "Couldn't load the offering counts.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
    loadSummary();
  }, [loadSummary]);

  const fetchPage = useCallback((query) => listOfferingsBoard(view, query), [view]);

  const openOffering = useCallback((id) => {
    window.location.hash = `#/business-offerings?offeringId=${id}`;
    setSelectedId(id);
  }, []);

  const backToList = useCallback(() => {
    window.location.hash = `#/business-offerings?view=${view}`;
    setSelectedId(null);
  }, [view]);

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <div>
        <OfferingDetailView eventId={selectedId} onBack={backToList} />
      </div>
    );
  }

  const n = (key) => Number(summary?.[key] ?? 0).toLocaleString();

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Offerings"
        description="Events, experiences, trips and RSVPs across all brands. Opens on what is on sale now; offerings of deleted and staff/test brands are hidden unless you include them."
      />

      {summaryError ? (
        <LoadError title="Couldn't load the offering counts" message={summaryError} onRetry={loadSummary} retrying={summaryLoading} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Offerings at a glance">
          {summaryLoading || !summary ? (
            [0, 1, 2, 3].map((i) => <StatTileSkeleton key={i} />)
          ) : (
            <>
              <Kpi value={n("on_sale_public")} label="On sale and public" />
              <Kpi value={n("starting_14_days")} label="Starting in 14 days" />
              <Kpi value={n("drafts_never_published")} label="Drafts" note="never published" />
              <Kpi value={n("sold_7_days")} label="Sold, last 7 days" note="tickets on paid orders" />
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Which offerings">
        {OFFERING_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={view === v.id}
            onClick={() => {
              window.location.hash = `#/business-offerings?view=${v.id}`;
            }}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${view === v.id ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]" : "border-[var(--gray-200)] bg-white text-[var(--color-text-secondary)]"}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <EntityListView
        key={view}
        columns={COLUMNS}
        fetchPage={fetchPage}
        serverSort
        searchPlaceholder="Title, brand or city"
        filters={FILTERS}
        onRowClick={(row) => openOffering(row.id)}
        csv={{ ...CSV, filename: `offerings_${view}` }}
        emptyMessage={EMPTY[view]}
        emptyIcon={CalendarDays}
      />
    </div>
  );
}
