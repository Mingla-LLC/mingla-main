/**
 * tripToLiveEvent — META-ORCH-1059 [experiences-business-parity] Pass 2.
 *
 * Adapts a `Trip` (from tripsService / useTrip) into the minimal `LiveEvent`
 * shape the SHARED event sub-screens (scanner, scanners, orders, guests,
 * reconciliation) read. This is the chokepoint that lets the offering-agnostic
 * event sub-screens resolve a TRIP id without forking five screens or relaxing
 * the locked `fetchBusinessEventById` trip-rejection probe (ORCH-0859 — single-
 * event DETAIL is event-only; this adapter is dashboard-route resolution, a
 * different path).
 *
 * Only the fields the sub-screens actually consume are meaningful (id,
 * brandId, brandSlug, eventSlug, name, currency, status, tickets, lifecycle
 * timestamps). Everything else is filled with type-safe inert defaults — these
 * screens never render trip hero/format/vibe fields.
 *
 * Trips are events-table rows that issue the same ticket_types-backed tickets,
 * so orders read by event_id resolve identically; this adapter only supplies
 * the display/identity scaffold the screens need around that data.
 */

import type { Trip, TripPricingTier } from "../services/tripsService";
import type { LiveEvent, LiveEventStatus } from "../store/liveEventStore";
import type { TicketStub } from "../store/draftEventStore";

function tierToTicketStub(tier: TripPricingTier, index: number): TicketStub {
  return {
    id: tier.ticketTypeId,
    name: tier.tierName,
    priceGbp: tier.priceCents / 100,
    currency: tier.currency,
    capacity: tier.quantityTotal,
    isFree: tier.priceCents === 0,
    isUnlimited: tier.isUnlimited,
    visibility: "public",
    displayOrder: index,
    approvalRequired: false,
    passwordProtected: false,
    password: null,
    waitlistEnabled: false,
    minPurchaseQty: 1,
    maxPurchaseQty: null,
    allowTransfers: true,
    description: null,
    saleStartAt: null,
    saleEndAt: null,
    availableAt: "both",
  };
}

function normalizeStatus(status: Trip["status"]): LiveEventStatus {
  switch (status) {
    case "scheduled":
    case "live":
    case "ended":
    case "cancelled":
      return status;
    case "draft":
    default:
      // LiveEventStatus has no "draft" member; the sub-screens that consume
      // this scaffold are published-only surfaces. A draft trip has no orders,
      // so mapping to "scheduled" is inert for those screens.
      return "scheduled";
  }
}

function normalizeCoverType(value: string | null): LiveEvent["coverMediaType"] {
  return value === "image" || value === "video" || value === "gif"
    ? value
    : null;
}

function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

/**
 * Build the LiveEvent scaffold a shared event sub-screen needs from a Trip.
 * Returns null when the trip is null (caller passes through).
 */
export function tripToLiveEvent(trip: Trip | null): LiveEvent | null {
  if (trip === null) return null;
  return {
    id: trip.id,
    serverEventId: trip.id,
    brandId: trip.brandId,
    brandSlug: trip.brandSlug ?? "",
    eventSlug: trip.slug,
    status: normalizeStatus(trip.status),
    publishedAt: trip.publishedAt ?? trip.createdAt,
    cancelledAt: trip.status === "cancelled" ? trip.updatedAt : null,
    endedAt: trip.status === "ended" ? trip.updatedAt : null,
    event_type: "trip",
    name: trip.title,
    description: trip.description ?? "",
    format: "in_person",
    category: null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    city: null,
    locationGeo: null,
    whenMode: "single",
    date: trip.businessTrip.startAt,
    doorsOpen: null,
    endsAt: trip.businessTrip.endAt,
    masterStartAtUtc: trip.businessTrip.startAt,
    masterEndAtUtc: trip.businessTrip.endAt,
    timezone: trip.timezone,
    recurrenceRule: null,
    multiDates: null,
    venueName: trip.businessTrip.destinationLocationText,
    address: trip.businessTrip.destinationLocationText,
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: hueFromId(trip.id),
    coverMediaUrl: trip.coverMediaUrl,
    coverMediaType: normalizeCoverType(trip.coverMediaType),
    currency: trip.pricingTiers[0]?.currency ?? trip.revenueCurrency ?? "USD",
    pricingSwitches: trip.pricingSwitches,
    themeOverrides: null,
    tickets: trip.pricingTiers.map((tier, index) =>
      tierToTicketStub(tier, index),
    ),
    visibility: trip.visibility === "public" ? "public" : "private",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    orders: [],
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
  };
}
