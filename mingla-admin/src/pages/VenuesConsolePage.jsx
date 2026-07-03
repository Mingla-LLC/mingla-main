// ORCH-1273 [Admin Offerings console — READ-ONLY] — Venues console.
//
// Cross-brand list of venue_listings (RLS-direct; reuses "venue_listings admin
// can read") → the read-only VenueDetailView (core + reservation config stack +
// reservations rollup). Row click → #/business-venues?venueId=<id>.
//
// READ-ONLY (visibility-first). No venue edit / reservation override — Wave-2 (§6).

import { useState, useEffect, useCallback, useMemo } from "react";
import { Store } from "lucide-react";
import { EntityListView } from "../components/entity/EntityListView";
import { Badge } from "../components/ui/Badge";
import { listVenues, listVenueBrands } from "../services/venuesService";
import { VenueDetailView } from "./VenueDetailView";
import { timeAgo } from "../lib/formatters";

const CATEGORY_VARIANT = { restaurant: "info", play: "brand", creative_and_arts: "warning" };
const CLAIM_VARIANT = {
  verified: "success",
  pending_review: "warning",
  rejected: "error",
  suspended: "error",
  revoked: "error",
  none: "default",
};

const CATEGORY_OPTIONS = [
  { value: "restaurant", label: "Restaurant" },
  { value: "play", label: "Play" },
  { value: "creative_and_arts", label: "Creative & arts" },
];
const CLAIM_OPTIONS = [
  { value: "none", label: "None" },
  { value: "pending_review", label: "Pending review" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
  { value: "revoked", label: "Revoked" },
];

const COLUMNS = [
  {
    key: "name",
    label: "Name",
    sortable: true,
    render: (val, row) => (
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="font-medium text-[var(--color-text-primary)] truncate">{val || "—"}</span>
        {row.slug && <span className="text-xs text-[var(--color-text-muted)] truncate">/{row.slug}</span>}
      </div>
    ),
  },
  { key: "brand_name", label: "Brand", render: (val) => val || <span className="text-[var(--color-text-muted)]">—</span> },
  {
    key: "city",
    label: "Location",
    render: (val, row) =>
      val || row.country_code ? (
        <span className="text-sm">{[val, row.country_code].filter(Boolean).join(", ")}</span>
      ) : (
        <span className="text-[var(--color-text-muted)]">—</span>
      ),
  },
  {
    key: "venue_category",
    label: "Category",
    render: (val) => (val ? <Badge variant={CATEGORY_VARIANT[val] || "default"}>{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>),
  },
  {
    key: "claim_status",
    label: "Claim",
    render: (val) => (val ? <Badge variant={CLAIM_VARIANT[val] || "default"} dot>{val}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>),
  },
  {
    key: "contact_email",
    label: "Contact",
    render: (val, row) => (
      <span className="text-xs text-[var(--color-text-tertiary)]">{val || row.contact_phone || "—"}</span>
    ),
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
    { key: "name", label: "Name" },
    { key: "slug", label: "Slug" },
    { key: "brand_name", label: "Brand" },
    { key: "city", label: "City" },
    { key: "country_code", label: "Country" },
    { key: "venue_category", label: "Category" },
    { key: "claim_status", label: "Claim status" },
    { key: "contact_email", label: "Contact email" },
    { key: "contact_phone", label: "Contact phone" },
    { key: "created_at", label: "Created at" },
  ],
  filename: "venues",
};

function venueIdFromHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return params.get("venueId");
}

export function VenuesConsolePage() {
  const [selectedId, setSelectedId] = useState(() => venueIdFromHash());
  const [brandOptions, setBrandOptions] = useState([]);

  useEffect(() => {
    const sync = () => setSelectedId(venueIdFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    let alive = true;
    listVenueBrands().then((brands) => {
      if (alive) setBrandOptions(brands.map((b) => ({ value: b.id, label: b.name || b.id })));
    });
    return () => {
      alive = false;
    };
  }, []);

  const filters = useMemo(
    () => [
      { key: "venue_category", label: "Category", options: CATEGORY_OPTIONS },
      { key: "claim_status", label: "Claim status", options: CLAIM_OPTIONS },
      ...(brandOptions.length ? [{ key: "brand_id", label: "Brand", options: brandOptions }] : []),
    ],
    [brandOptions],
  );

  const openVenue = useCallback((id) => {
    window.location.hash = `#/business-venues?venueId=${id}`;
    setSelectedId(id);
  }, []);

  const backToList = useCallback(() => {
    window.location.hash = "#/business-venues";
    setSelectedId(null);
  }, []);

  if (selectedId) {
    return (
      <div className="py-8">
        <VenueDetailView venueId={selectedId} onBack={backToList} />
      </div>
    );
  }

  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Store className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Venues</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Every venue across all brands. Open one for the full record — profile, claim state,
            reservation config, tables, blackouts, waitlist, and reservations.
          </p>
        </div>
      </div>

      <EntityListView
        title="All venues"
        columns={COLUMNS}
        fetchPage={listVenues}
        searchPlaceholder="Search name, city, slug, or address…"
        filters={filters}
        onRowClick={(row) => openVenue(row.id)}
        csv={CSV}
        emptyMessage="No venues match these filters."
        emptyIcon={Store}
      />
    </div>
  );
}
