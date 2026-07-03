// ORCH-1273 [Admin Offerings console — READ-ONLY] — Offerings console.
//
// ONE cross-brand list over public.events (event / rsvp / trip / experience),
// served by the guard-first admin_list_offerings RPC (server-computed lifecycle
// bucket + per-row child counts). MUST surface DRAFT / PRIVATE / cross-brand rows
// (the whole point of the console). Row click → the type-aware OfferingDetailView.
//
// READ-ONLY (visibility-first). No edit / mutation. Every wave-2 offering action
// (unpublish / cancel / close-bookings / price fix …) is deferred to a later ORCH
// via the ORCH-1271 audited-write primitive (SPEC §6).

import { useState, useEffect, useCallback, useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { Badge } from "../components/ui/Badge";
import { listOfferings, listOfferingBrands } from "../services/offeringsService";
import { OfferingDetailView } from "./OfferingDetailView";
import { formatDateTime, timeAgo } from "../lib/formatters";

// ── Badge maps ────────────────────────────────────────────────────────────────

const TYPE_VARIANT = { event: "info", rsvp: "brand", trip: "warning", experience: "success" };
const STATUS_VARIANT = { draft: "default", scheduled: "info", live: "success", ended: "default", cancelled: "error" };
const VISIBILITY_VARIANT = { public: "success", discover: "info", private: "warning", hidden: "default", draft: "default" };
const LIFECYCLE_VARIANT = { draft: "default", upcoming: "info", live: "success", past: "default", cancelled: "error" };

const TYPE_OPTIONS = [
  { value: "event", label: "Event" },
  { value: "rsvp", label: "RSVP" },
  { value: "trip", label: "Trip" },
  { value: "experience", label: "Experience" },
];
const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live" },
  { value: "ended", label: "Ended" },
  { value: "cancelled", label: "Cancelled" },
];
const VISIBILITY_OPTIONS = [
  { value: "public", label: "Public" },
  { value: "discover", label: "Discover" },
  { value: "private", label: "Private" },
  { value: "hidden", label: "Hidden" },
  { value: "draft", label: "Draft" },
];
const LIFECYCLE_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "upcoming", label: "Upcoming" },
  { value: "live", label: "Live" },
  { value: "past", label: "Past" },
  { value: "cancelled", label: "Cancelled" },
];
const DELETED_OPTIONS = [{ value: "include", label: "Include deleted" }];

// ── Columns ───────────────────────────────────────────────────────────────────

const COLUMNS = [
  {
    key: "title",
    label: "Title",
    sortable: true,
    render: (val, row) => (
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="font-medium text-[var(--color-text-primary)] truncate">{val || "Untitled"}</span>
        {row.slug && <span className="text-xs text-[var(--color-text-muted)] truncate">/{row.slug}</span>}
      </div>
    ),
  },
  { key: "brand_name", label: "Brand", render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span> },
  {
    key: "event_type",
    label: "Type",
    render: (val) => <Badge variant={TYPE_VARIANT[val] || "default"}>{val || "—"}</Badge>,
  },
  {
    key: "status",
    label: "Status",
    sortable: true,
    render: (val) => <Badge variant={STATUS_VARIANT[val] || "default"} dot>{val || "—"}</Badge>,
  },
  {
    key: "visibility",
    label: "Visibility",
    render: (val) => <Badge variant={VISIBILITY_VARIANT[val] || "default"}>{val || "—"}</Badge>,
  },
  {
    key: "lifecycle_bucket",
    label: "Lifecycle",
    render: (val) => <Badge variant={LIFECYCLE_VARIANT[val] || "default"} dot>{val || "—"}</Badge>,
  },
  { key: "city", label: "City", render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span> },
  {
    key: "master_start_at",
    label: "Starts",
    sortable: true,
    render: (val) => <span className="text-sm">{formatDateTime(val)}</span>,
  },
  {
    key: "created_at",
    label: "Created",
    sortable: true,
    render: (val) => <span className="text-xs text-[var(--color-text-tertiary)]">{timeAgo(val)}</span>,
  },
];

const CSV = {
  columns: [
    { key: "id", label: "ID" },
    { key: "title", label: "Title" },
    { key: "slug", label: "Slug" },
    { key: "event_type", label: "Type" },
    { key: "brand_name", label: "Brand" },
    { key: "status", label: "Status" },
    { key: "visibility", label: "Visibility" },
    { key: "lifecycle_bucket", label: "Lifecycle" },
    { key: "city", label: "City" },
    { key: "currency", label: "Currency" },
    { key: "master_start_at", label: "Starts" },
    { key: "attendee_count", label: "Attendees" },
    { key: "rsvp_going_count", label: "RSVP going" },
    { key: "created_at", label: "Created at" },
  ],
  filename: "offerings",
};

// ── Hash helper ───────────────────────────────────────────────────────────────

function offeringIdFromHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get("offeringId");
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OfferingsConsolePage() {
  const [selectedId, setSelectedId] = useState(() => offeringIdFromHash());
  const [brandOptions, setBrandOptions] = useState([]);

  useEffect(() => {
    const sync = () => setSelectedId(offeringIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Load the brand filter options once (best-effort; degrades to a name search).
  useEffect(() => {
    let alive = true;
    listOfferingBrands().then((brands) => {
      if (alive) setBrandOptions(brands.map((b) => ({ value: b.id, label: b.name || b.id })));
    });
    return () => {
      alive = false;
    };
  }, []);

  const filters = useMemo(
    () => [
      { key: "event_type", label: "Type", options: TYPE_OPTIONS },
      { key: "status", label: "Status", options: STATUS_OPTIONS },
      { key: "visibility", label: "Visibility", options: VISIBILITY_OPTIONS },
      { key: "lifecycle", label: "Lifecycle", options: LIFECYCLE_OPTIONS },
      ...(brandOptions.length ? [{ key: "brand_id", label: "Brand", options: brandOptions }] : []),
      { key: "deleted", label: "Deleted", options: DELETED_OPTIONS },
    ],
    [brandOptions],
  );

  const openOffering = useCallback((id) => {
    window.location.hash = `#/business-offerings?offeringId=${id}`;
    setSelectedId(id);
  }, []);

  const backToList = useCallback(() => {
    window.location.hash = "#/business-offerings";
    setSelectedId(null);
  }, []);

  // ── Detail view ───────────────────────────────────────────────────────────
  if (selectedId) {
    return (
      <div className="py-8">
        <OfferingDetailView eventId={selectedId} onBack={backToList} />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <CalendarDays className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Offerings</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Every event, RSVP, trip, and experience across all brands — including drafts, private, and
            deleted. Open one for the type-aware detail: tiers, orders, guest list, itinerary.
          </p>
        </div>
      </div>

      <EntityListView
        title="All offerings"
        columns={COLUMNS}
        fetchPage={listOfferings}
        searchPlaceholder="Search title, brand, city, or slug…"
        filters={filters}
        onRowClick={(row) => openOffering(row.id)}
        csv={CSV}
        emptyMessage="No offerings match these filters."
        emptyIcon={CalendarDays}
      />
    </div>
  );
}
