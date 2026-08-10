/**
 * Issue #1789 (#1767 Phase 1) — pure Spots-inventory logic (SPEC #1788 P-7,
 * P-7c, P-10, P-27).
 *
 * No React, no react-native, no network: everything here is a function of its
 * arguments so it can be proven under the default node/ts-jest config. The
 * Spots SHEET renders what these functions decide.
 *
 * The product rule this file encodes: ONE list per brand, grouped by venue,
 * rooms and tables side by side, one print button covering both (D-3 / D-3b).
 * The venue never manages two lists — a spot exists because a table or a named
 * room exists, and its identity is a printed code that survives every rename.
 */

export type QrSpotKind = "table" | "room_unit" | "zone" | "custom";

export interface QrSpot {
  id: string;
  brandId: string;
  /** The spot's physical home. */
  venueId: string;
  kind: QrSpotKind;
  venueTableId: string | null;
  stayUnitId: string | null;
  zone: string | null;
  label: string;
  /** The venue whose menu this spot orders from (D-3b). */
  servingVenueId: string;
  servingMenuId: string | null;
  /** Opaque, server-minted, immutable. Never derived from a name. */
  code: string;
  isActive: boolean;
  autoProvisioned: boolean;
  sortOrder: number;
  lastPrintedAt: string | null;
}

export interface VenueRef {
  id: string;
  name: string;
  slug: string;
}

export interface SpotVenueGroup {
  venueId: string;
  venueName: string;
  spots: QrSpot[];
  activeCount: number;
  needsAttentionCount: number;
}

/**
 * A room spot whose serving venue was never re-pointed is INERT by design: the
 * auto-provision trigger parks it inactive because a Stay venue has no menu of
 * its own, and printing it would laminate a dead link (SPEC P-7c). The Spots
 * list surfaces it as a to-do instead of hiding it.
 */
export function spotNeedsServingChoice(spot: QrSpot): boolean {
  return spot.kind === "room_unit" && spot.servingVenueId === spot.venueId;
}

export const SPOT_SERVING_TODO_LABEL = "Choose which kitchen serves this room";

/** Only ACTIVE spots are printable. A dead link must never reach a laminate. */
export function isPrintable(spot: QrSpot): boolean {
  return spot.isActive;
}

const KIND_LABEL: Record<QrSpotKind, string> = {
  table: "Table",
  room_unit: "Room",
  zone: "Zone",
  custom: "Spot",
};

export function spotKindLabel(kind: QrSpotKind): string {
  return KIND_LABEL[kind];
}

/**
 * The one-line fact string under a spot's label. Joined with " · ", exactly the
 * grammar VenueTablesModule already uses for a table's facts. Never fabricates:
 * a fact that is not known is simply absent.
 */
export function spotSubtitle(
  spot: QrSpot,
  ctx: { servingVenueName?: string | null; servingMenuName?: string | null },
): string {
  const parts: string[] = [spotKindLabel(spot.kind)];
  if (spot.zone !== null && spot.zone.length > 0) {
    parts.push(spot.zone.replace(/_/g, " "));
  }
  if (
    spot.servingVenueId !== spot.venueId &&
    ctx.servingVenueName !== undefined &&
    ctx.servingVenueName !== null &&
    ctx.servingVenueName.length > 0
  ) {
    parts.push(`Serving: ${ctx.servingVenueName}`);
  }
  if (
    ctx.servingMenuName !== undefined &&
    ctx.servingMenuName !== null &&
    ctx.servingMenuName.length > 0
  ) {
    parts.push(ctx.servingMenuName);
  }
  if (!spot.isActive) parts.push("Not printing");
  return parts.join(" · ");
}

/**
 * ONE brand list, grouped by venue, rooms and tables side by side (D-3b).
 * Venues are ordered by name so the grouping is stable across refetches; spots
 * inside a venue follow their sort order, then their label.
 */
export function groupSpotsByVenue(
  spots: QrSpot[],
  venues: VenueRef[],
): SpotVenueGroup[] {
  const nameById = new Map<string, string>();
  for (const v of venues) nameById.set(v.id, v.name);

  const byVenue = new Map<string, QrSpot[]>();
  for (const spot of spots) {
    const bucket = byVenue.get(spot.venueId);
    if (bucket === undefined) byVenue.set(spot.venueId, [spot]);
    else bucket.push(spot);
  }

  const groups: SpotVenueGroup[] = [];
  for (const [venueId, bucket] of byVenue) {
    const sorted = [...bucket].sort((a, b) =>
      a.sortOrder !== b.sortOrder
        ? a.sortOrder - b.sortOrder
        : a.label.localeCompare(b.label),
    );
    groups.push({
      venueId,
      venueName: nameById.get(venueId) ?? "This venue",
      spots: sorted,
      activeCount: sorted.filter(isPrintable).length,
      needsAttentionCount: sorted.filter(spotNeedsServingChoice).length,
    });
  }
  groups.sort((a, b) => a.venueName.localeCompare(b.venueName));
  return groups;
}

export interface PrintRequest {
  brandId: string;
  venueId?: string;
  spotIds?: string[];
  layout: "bulk" | "single";
}

/** Bulk: every ACTIVE spot in scope. `venueId` narrows it to one venue. */
export function bulkPrintRequest(
  brandId: string,
  venueId: string | null,
): PrintRequest {
  return venueId === null
    ? { brandId, layout: "bulk" }
    : { brandId, venueId, layout: "bulk" };
}

/** Single: a re-print of exactly one card, through the same builder. */
export function singlePrintRequest(
  brandId: string,
  spotId: string,
): PrintRequest {
  return { brandId, spotIds: [spotId], layout: "single" };
}

/**
 * The canonical printed URL (SPEC #1788 P-10), duplicated on the client ONLY so
 * an operator can preview or copy the exact link a guest will open. The PDF's
 * QR is always encoded server-side from the same shape
 * (`supabase/functions/venue-qr-sheet/qrSpotUrl.ts`).
 *
 * `servingVenueSlug` — not the physical home's — is what makes a room QR open
 * the kitchen's menu.
 */
export const BUSINESS_WEB_ORIGIN = "https://business.usemingla.com";

export function spotScanUrl(input: {
  brandSlug: string;
  servingVenueSlug: string;
  code: string;
}): string {
  const brand = encodeURIComponent(input.brandSlug);
  const venue = encodeURIComponent(input.servingVenueSlug);
  const code = encodeURIComponent(input.code);
  return `${BUSINESS_WEB_ORIGIN}/b/${brand}/v/${venue}?tab=menu&spot=${code}&src=qr`;
}
