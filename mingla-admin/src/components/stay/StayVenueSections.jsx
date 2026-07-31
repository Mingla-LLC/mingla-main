import { Badge } from "../ui/Badge";
import { StaySnapshotStatus } from "./StaySnapshotStatus";

function field(label, value, render) {
  return { label, value, render };
}

function muted(value) {
  return <span className="text-[var(--color-text-muted)]">{value}</span>;
}

function boolBadge(value) {
  return <Badge variant={value ? "success" : "warning"} dot>{value ? "Ready" : "Not ready"}</Badge>;
}

function money(minor, currency) {
  if (minor == null || !currency) return "—";
  const amount = Number(minor) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function offeringStatusVariant(status) {
  if (status === "live") return "success";
  if (status === "paused") return "warning";
  if (status === "archived") return "default";
  return "info";
}

function offeringFields(offering, currencyCode, onPause) {
  const price = offering.price;
  const fees = Array.isArray(offering.fees) ? offering.fees : [];
  const media = Array.isArray(offering.media) ? offering.media : [];
  const cover = media.find((item) => item.isCover && item.status === "ready") || media.find((item) => item.status === "ready");
  return [
    field("Status", null, () => <Badge variant={offeringStatusVariant(offering.status)} dot>{offering.status}</Badge>),
    field("Kind", offering.kind === "room" ? "Room" : "Place"),
    field("Summary", offering.summary),
    field("Confirmation", offering.confirmationMode),
    field("Inventory", offering.inventoryBasis?.replaceAll("_", " ")),
    field("Units / capacity", offering.quantity ?? offering.capacity),
    field("Guest range", `${offering.minGuests ?? 1}–${offering.maxGuests ?? "—"}`),
    field("Price", price ? `${money(price.amountMinor, price.currencyCode)} · ${price.pricingUnit?.replaceAll("_", " ")}` : "No current price"),
    field("Price revision", price?.versionNumber),
    field("Fees", fees.length ? fees.map((fee) => `${fee.label}: ${fee.amountMinor == null ? `${fee.basisPoints ?? 0} bps` : money(fee.amountMinor, fee.currencyCode || currencyCode)} (${fee.displayMode})`).join(" · ") : "None"),
    field("Policy", offering.policy?.cancellationPolicy),
    field("Policy revision", offering.policy?.versionNumber),
    field("Availability", `${offering.availability?.roomNightCount ?? 0} room nights · ${offering.availability?.placeWindowCount ?? 0} place windows`),
    field("Stopped", `${offering.availability?.roomNightStopSellCount ?? 0} room nights · ${offering.availability?.placeWindowStopSellCount ?? 0} place windows`),
    field("Named units", Array.isArray(offering.units) && offering.units.length ? offering.units.map((unit) => `${unit.name} (${unit.status})`).join(" · ") : "None"),
    field("Amenities", Array.isArray(offering.amenities) && offering.amenities.length ? offering.amenities.join(" · ") : "None"),
    field("Photos", null, () => (
      <div className="flex items-center gap-3">
        {cover ? (
          <img
            src={cover.publicUrl}
            alt={cover.altText || `${offering.name} photo`}
            className="h-20 w-28 rounded-lg object-cover border border-[var(--gray-200)]"
          />
        ) : muted("No ready photo")}
        <span className="text-xs text-[var(--color-text-tertiary)]">{media.length} total</span>
      </div>
    )),
    ...(offering.status === "live" && onPause ? [field("Support action", null, () => (
      <button
        type="button"
        className="min-h-11 px-2 inline-flex items-center text-xs underline text-[var(--color-brand-500)]"
        onClick={() => onPause(offering)}
      >
        Pause this offering
      </button>
    ))] : []),
  ];
}

export function buildStayVenueSections(bundle, { onPause } = {}) {
  const venue = bundle?.venue || {};
  const brand = bundle?.brand || {};
  const settings = bundle?.settings;
  const flags = bundle?.flags || {};
  const offerings = Array.isArray(bundle?.offerings) ? bundle.offerings : [];
  const failures = Array.isArray(bundle?.bulkFailures) ? bundle.bulkFailures : [];
  const sections = [
    {
      label: "Stay property and readiness",
      fields: [
        field("Property", venue.name),
        field("Property kind", settings?.propertyKind?.replaceAll("_", " ") || "Not set"),
        field("Brand", brand.name),
        field("Approval", venue.claimStatus, (value) => <Badge variant={value === "verified" ? "success" : "warning"} dot>{value || "not reviewed"}</Badge>),
        field("Booking state", settings?.bookingState, (value) => <Badge variant={value === "active" ? "success" : "warning"} dot>{value || "not configured"}</Badge>),
        field("Bank rail", null, () => boolBadge(brand.bankReady)),
        field("Provider", brand.paymentProvider || "Not connected"),
        field("Brand currency", brand.currencyCode || "Not set"),
        field("Provisional currency", brand.provisionalCurrencyCode || "Not set"),
        field("Currency reconciliation", brand.currencyReconciliationPending ? "Pending" : "Clear", (value) => <Badge variant={brand.currencyReconciliationPending ? "error" : "success"}>{value}</Badge>),
        field("Booking mode", settings?.bookingMode),
        field("Check-in / check-out", settings ? `${settings.checkInTime} / ${settings.checkOutTime}` : null),
        field("Timezone", settings?.timezone),
        field("Settings version", settings?.version),
        field("Snapshot health", null, () => <StaySnapshotStatus snapshotAt={bundle?.snapshotAt} />),
      ],
    },
    {
      label: "Stay launch controls (read-only)",
      fields: Object.entries(flags).map(([key, enabled]) => field(key, null, () => (
        <Badge variant={enabled ? "success" : "default"} dot>{enabled ? "On" : "Off"}</Badge>
      ))),
    },
    ...offerings.map((offering) => ({
      label: `${offering.kind === "room" ? "Room" : "Place"} · ${offering.name}`,
      fields: offeringFields(offering, brand.currencyCode, onPause),
    })),
    {
      label: `Bulk creation failures (${failures.length})`,
      fields: failures.length ? failures.map((job) => field(job.jobId, `${job.failedCount} failed of ${job.requestedCount} · ${job.status}`)) : [field("Status", "No failed bulk jobs")],
    },
  ];
  if (offerings.length === 0) {
    sections.splice(2, 0, {
      label: "Rooms & Places",
      fields: [field("Inventory", "No Rooms or Places have been added.")],
    });
  }
  return sections;
}
