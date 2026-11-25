// #4490 P2-7 — the Offerings console's "Venue offers" list: every venue offer
// across venues (entry first), its venue and brand, from-price and status, and
// one audited action per row: Pause (live) or Resume (paused). Both ask for a
// reason, which the server requires and writes to the admin audit log.
import { useCallback, useState } from "react";
import { Store } from "lucide-react";
import { EntityListView } from "../entity/EntityListView";
import { HighRiskActionModal } from "../entity/HighRiskActionModal";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import {
  listAdminVenueOffers,
  setAdminVenueOfferStatus,
} from "../../services/venueOffersAdminService";
import {
  venueOfferAction,
  venueOfferFromPrice,
  venueOfferKindLabel,
  venueOfferStatus,
} from "../../lib/venueOffersAdmin";
import { formatDateTime } from "../../lib/formatters";

const FILTERS = [
  {
    key: "status",
    label: "Any status",
    options: [
      { value: "live", label: "On sale" },
      { value: "paused", label: "Paused" },
      { value: "draft", label: "Draft" },
      { value: "archived", label: "Archived" },
    ],
  },
];

export function VenueOffersAdminList() {
  const [action, setAction] = useState(null);
  const [listKey, setListKey] = useState(0);

  const columns = [
    {
      key: "name",
      label: "Offer",
      render: (val, row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-[var(--color-text-primary)]">{val || "Untitled"}</span>
          <span className="text-xs text-[var(--color-text-tertiary)]">{venueOfferKindLabel(row.kind, row.entryStyle)}</span>
        </span>
      ),
    },
    {
      key: "venueName",
      label: "Venue",
      render: (val, row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{val || "–"}</span>
          <span className="text-xs text-[var(--color-text-tertiary)]">{row.brandName || "No brand"}</span>
        </span>
      ),
    },
    { key: "fromMinor", label: "Price", render: (val, row) => <span className="tabular-nums">{venueOfferFromPrice(val, row.currency)}</span> },
    {
      key: "status",
      label: "Status",
      render: (val) => {
        const st = venueOfferStatus(val);
        return <Badge variant={st.variant} dot>{st.label}</Badge>;
      },
    },
    { key: "updatedAt", label: "Updated", render: (val) => (val ? formatDateTime(val) : "–") },
    {
      key: "id",
      label: "",
      render: (_val, row) => {
        const next = venueOfferAction(row);
        if (!next && row.kind === "membership") {
          return <span className="text-xs text-[var(--color-text-tertiary)]">Run from the venue&apos;s plans</span>;
        }
        if (!next) return null;
        return (
          <Button
            variant={next.kind === "pause" ? "secondary" : "primary"}
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setAction({ ...next, row });
            }}
          >
            {next.label}
          </Button>
        );
      },
    },
  ];

  const fetchPage = useCallback((query) => listAdminVenueOffers(query), []);

  return (
    <>
      <EntityListView
        key={listKey}
        columns={columns}
        fetchPage={fetchPage}
        searchPlaceholder="Offer, venue or brand"
        filters={FILTERS}
        emptyMessage="No venue offers match. Offers hosts publish at their venues appear here."
        emptyIcon={Store}
      />
      <HighRiskActionModal
        open={action !== null}
        onClose={() => setAction(null)}
        title={action?.kind === "pause" ? `Pause ${action?.row?.name ?? "this offer"}` : `Resume ${action?.row?.name ?? "this offer"}`}
        description={
          action?.kind === "pause"
            ? `Stops new bookings for this offer at ${action?.row?.venueName ?? "the venue"}. Bookings already made stay valid. Your reason is saved in the audit log.`
            : `Puts this offer back on sale at ${action?.row?.venueName ?? "the venue"}. Your reason is saved in the audit log.`
        }
        confirmLabel={action?.kind === "pause" ? "Pause offer" : "Resume offer"}
        destructive={action?.kind === "pause"}
        successMessage={action?.kind === "pause" ? "Offer paused." : "Offer back on sale."}
        onConfirm={async ({ reason }) => {
          await setAdminVenueOfferStatus({ offeringId: action.row.id, status: action.next, reason: reason.trim() });
          setAction(null);
          setListKey((n) => n + 1);
        }}
      />
    </>
  );
}
