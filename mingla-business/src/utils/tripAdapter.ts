/**
 * tripAdapter — diff utilities + severity classification + field labels
 * for trip published-edit flow (ORCH-0876).
 *
 * Mirrors `mingla-business/src/utils/liveEventAdapter.ts` shape with
 * trip-specific keys. Consumed by:
 *   - `EditPublishedTripScreen` for section diff computation
 *   - `ChangeSummaryModal` (generalized — receives tripDay/Inclusion/PricingTier diffs)
 *   - `tripChangeNotifier` for severity-driven channel flags
 *
 * Severity model (operator-locked Q11):
 *   MATERIAL (notify buyers banner + email + SMS-if-web-purchases):
 *     - theme.business_trip.{startAt, endAt, destinationLocationText}
 *     - ticket_types.quantity_total
 *     - days (when count add/remove)
 *     - inclusions (when items removed; additions are additive)
 *     - pricing_tiers (when tier price changes; name/metadata-only is additive)
 *   SAFE / ADDITIVE (banner + email only):
 *     - title, description
 *     - cover_media_* (all 7 keys)
 *     - day narrative tweaks (same ordinal count)
 *     - inclusion item rewording (same key, different text)
 *     - tier name change
 *
 * Note: pure `classifySeverity(changedKeys)` is a coarse pass; the
 * EditPublishedTripScreen also runs a sub-classifier that looks at WHICH
 * parts of days/inclusions/pricing_tiers changed to refine severity
 * (e.g., inclusions add-only is additive even though `inclusions` key
 * appears in the patch).
 */

import type {
  Trip,
  TripDay,
  TripInclusion,
  TripPricingTier,
  TripDayInput,
  TripInclusionInput,
  TripPricingTierInput,
} from "../services/tripsService";

export type TripEditSeverity = "additive" | "material";

// ============================================================
// FIELD_LABELS — human-readable copy per patch key
// ============================================================
export const FIELD_LABELS: Record<string, string> = {
  title: "Trip name",
  description: "Description",
  "theme.business_trip.startAt": "Start date",
  "theme.business_trip.endAt": "End date",
  "theme.business_trip.destinationLocationText": "Destination",
  "theme.business_trip.destinationPlaceId": "Destination place",
  "ticket_types.quantity_total": "Capacity",
  days: "Itinerary days",
  inclusions: "Inclusions",
  pricing_tiers: "Pricing tiers",
  cover_media_url: "Cover image",
  cover_media_type: "Cover media type",
  cover_media_provider: "Cover provider",
  cover_media_source_url: "Cover source",
  cover_media_credit: "Cover credit",
  cover_media_credit_url: "Cover credit URL",
  cover_media_alt: "Cover alt text",
};

// ============================================================
// MATERIAL_KEYS / SAFE_KEYS — drives severity classification + notification channels
// ============================================================

/** Material keys at the JSONB-patch top level. theme.business_trip nested
 *  keys are inspected separately by `classifyTripSeverity`. */
export const MATERIAL_KEYS: ReadonlyArray<string> = [
  "days",
  "inclusions",
  "pricing_tiers",
];

/** Material keys inside theme.business_trip (notify buyers when any changes). */
export const MATERIAL_BUSINESS_TRIP_KEYS: ReadonlyArray<string> = [
  "startAt",
  "endAt",
  "destinationLocationText",
  "capacity",
];

/** Safe keys at the patch top level (banner + email only). */
export const SAFE_KEYS: ReadonlyArray<string> = [
  "title",
  "description",
  "cover_media_url",
  "cover_media_type",
  "cover_media_provider",
  "cover_media_source_url",
  "cover_media_credit",
  "cover_media_credit_url",
  "cover_media_alt",
];

// ============================================================
// Diff result types
// ============================================================

export interface TripFieldDiff {
  fieldKey: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
  severity: TripEditSeverity;
}

export interface TripDayDiff {
  ordinal: number;
  oldTitle: string | null;
  newTitle: string | null;
  oldNarrative: string | null;
  newNarrative: string | null;
  status: "added" | "removed" | "modified";
}

export interface TripInclusionDiff {
  key: string; // "kind:item"
  oldKind: string | null;
  newKind: string | null;
  oldItem: string | null;
  newItem: string | null;
  status: "added" | "removed" | "modified";
}

export interface TripPricingTierDiff {
  ticketTypeId: string;
  oldName: string | null;
  newName: string | null;
  oldPriceCents: number | null;
  newPriceCents: number | null;
  status: "added" | "removed" | "modified";
}

// ============================================================
// classifyTripSeverity — coarse + sub-refined
// ============================================================

/**
 * Inspects WHICH parts of the patch changed to classify severity beyond
 * raw key-match. Returns 'material' if ANY change crosses the
 * buyer-protection threshold; 'additive' otherwise.
 */
export const classifyTripSeverity = (
  changedKeys: ReadonlyArray<string>,
  dropped: {
    dayOrdinals?: number[];
    inclusionKeys?: string[];
    tierPriceChangedTicketTypeIds?: string[];
  } = {},
): TripEditSeverity => {
  // Top-level keys
  for (const k of changedKeys) {
    if (k === "theme") {
      // Caller must signal business_trip changes via the dropped struct
      // OR by including theme.business_trip.* in changedKeys directly.
      // For safety we treat theme presence as MATERIAL by default.
      return "material";
    }
    if (k === "days") {
      // dropped ordinals → material; add-only / same-count narrative tweak → additive
      if ((dropped.dayOrdinals?.length ?? 0) > 0) return "material";
      // count unchanged + narrative-only is additive; caller infers via diff
      // shape — if `days` is in changedKeys with NO dropped ordinals AND we
      // got here, it's additive
      continue;
    }
    if (k === "inclusions") {
      if ((dropped.inclusionKeys?.length ?? 0) > 0) return "material";
      continue;
    }
    if (k === "pricing_tiers") {
      if ((dropped.tierPriceChangedTicketTypeIds?.length ?? 0) > 0) return "material";
      continue;
    }
    if (MATERIAL_KEYS.includes(k)) return "material";
  }
  return "additive";
};

// ============================================================
// Diff computers
// ============================================================

export const computeTripDayDiffs = (
  oldDays: TripDay[],
  newDays: TripDayInput[],
): TripDayDiff[] => {
  const out: TripDayDiff[] = [];
  const oldByOrdinal = new Map(oldDays.map((d) => [d.ordinal, d]));
  const newByOrdinal = new Map(newDays.map((d) => [d.ordinal, d]));

  // Modified or added
  for (const [ordinal, n] of newByOrdinal.entries()) {
    const o = oldByOrdinal.get(ordinal);
    if (o === undefined) {
      out.push({
        ordinal,
        oldTitle: null,
        newTitle: n.title,
        oldNarrative: null,
        newNarrative: n.narrative ?? null,
        status: "added",
      });
    } else if (
      o.title !== n.title ||
      (o.narrative ?? null) !== (n.narrative ?? null)
    ) {
      out.push({
        ordinal,
        oldTitle: o.title,
        newTitle: n.title,
        oldNarrative: o.narrative,
        newNarrative: n.narrative ?? null,
        status: "modified",
      });
    }
  }
  // Removed
  for (const [ordinal, o] of oldByOrdinal.entries()) {
    if (!newByOrdinal.has(ordinal)) {
      out.push({
        ordinal,
        oldTitle: o.title,
        newTitle: null,
        oldNarrative: o.narrative,
        newNarrative: null,
        status: "removed",
      });
    }
  }
  return out.sort((a, b) => a.ordinal - b.ordinal);
};

export const computeTripInclusionDiffs = (
  oldList: TripInclusion[],
  newList: TripInclusionInput[],
): TripInclusionDiff[] => {
  const out: TripInclusionDiff[] = [];
  const key = (kind: string, item: string): string => `${kind}:${item}`;
  const oldByKey = new Map(oldList.map((i) => [key(i.kind, i.item), i]));
  const newByKey = new Map(newList.map((i) => [key(i.kind, i.item), i]));

  for (const [k, n] of newByKey.entries()) {
    const o = oldByKey.get(k);
    if (o === undefined) {
      out.push({
        key: k,
        oldKind: null,
        newKind: n.kind,
        oldItem: null,
        newItem: n.item,
        status: "added",
      });
    }
    // Same-key items are byte-identical (key encodes kind+item); no modify path.
  }
  for (const [k, o] of oldByKey.entries()) {
    if (!newByKey.has(k)) {
      out.push({
        key: k,
        oldKind: o.kind,
        newKind: null,
        oldItem: o.item,
        newItem: null,
        status: "removed",
      });
    }
  }
  return out;
};

export const computeTripPricingTierDiffs = (
  oldTiers: TripPricingTier[],
  newTiers: TripPricingTierInput[],
): TripPricingTierDiff[] => {
  const out: TripPricingTierDiff[] = [];
  const oldByTicketTypeId = new Map(oldTiers.map((t) => [t.ticketTypeId, t]));
  const newByTicketTypeId = new Map(
    newTiers.map((t) => [t.ticket_type_id, t]),
  );

  for (const [id, n] of newByTicketTypeId.entries()) {
    const o = oldByTicketTypeId.get(id);
    if (o === undefined) {
      out.push({
        ticketTypeId: id,
        oldName: null,
        newName: n.tier_name ?? null,
        oldPriceCents: null,
        newPriceCents: n.price_cents ?? null,
        status: "added",
      });
    } else if (
      (n.tier_name !== undefined && n.tier_name !== o.tierName) ||
      (n.price_cents !== undefined && n.price_cents !== o.priceCents)
    ) {
      out.push({
        ticketTypeId: id,
        oldName: o.tierName,
        newName: n.tier_name ?? o.tierName,
        oldPriceCents: o.priceCents,
        newPriceCents: n.price_cents ?? o.priceCents,
        status: "modified",
      });
    }
  }
  for (const [id, o] of oldByTicketTypeId.entries()) {
    if (!newByTicketTypeId.has(id)) {
      out.push({
        ticketTypeId: id,
        oldName: o.tierName,
        newName: null,
        oldPriceCents: o.priceCents,
        newPriceCents: null,
        status: "removed",
      });
    }
  }
  return out;
};

// ============================================================
// computeRichTripFieldDiffs — top-level field diffs for ChangeSummaryModal
// ============================================================

/**
 * Produces a flat list of field-level diffs from old Trip → new LiveTripPatch.
 * `tickets` / `days` / `inclusions` collapse to a single header row in the
 * modal; the per-row detail is rendered by the dedicated sub-renderers.
 */
export const computeRichTripFieldDiffs = (
  oldTrip: Trip,
  patch: {
    title?: string;
    description?: string | null;
    theme?: { business_trip?: Partial<Trip["businessTrip"]> };
    days?: TripDayInput[];
    inclusions?: TripInclusionInput[];
    pricing_tiers?: TripPricingTierInput[];
    cover_media_url?: string | null;
    cover_media_type?: "image" | "video" | "gif" | null;
    cover_media_provider?: string | null;
    cover_media_source_url?: string | null;
    cover_media_credit?: string | null;
    cover_media_credit_url?: string | null;
    cover_media_alt?: string | null;
  },
  ctx: {
    droppedDayOrdinals: number[];
    droppedInclusionKeys: string[];
    tierPriceChangedTicketTypeIds: string[];
  },
): TripFieldDiff[] => {
  const out: TripFieldDiff[] = [];
  const labelOf = (k: string): string => FIELD_LABELS[k] ?? k;

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 57)}…` : v;
    return String(v);
  };

  if (patch.title !== undefined && patch.title !== oldTrip.title) {
    out.push({
      fieldKey: "title",
      fieldLabel: labelOf("title"),
      oldValue: fmt(oldTrip.title),
      newValue: fmt(patch.title),
      severity: "additive",
    });
  }
  if (patch.description !== undefined && (patch.description ?? null) !== oldTrip.description) {
    out.push({
      fieldKey: "description",
      fieldLabel: labelOf("description"),
      oldValue: fmt(oldTrip.description),
      newValue: fmt(patch.description),
      severity: "additive",
    });
  }
  if (patch.theme?.business_trip !== undefined) {
    const bt = patch.theme.business_trip;
    if (bt.startAt !== undefined && bt.startAt !== oldTrip.businessTrip.startAt) {
      out.push({
        fieldKey: "theme.business_trip.startAt",
        fieldLabel: labelOf("theme.business_trip.startAt"),
        oldValue: fmt(oldTrip.businessTrip.startAt),
        newValue: fmt(bt.startAt),
        severity: "material",
      });
    }
    if (bt.endAt !== undefined && bt.endAt !== oldTrip.businessTrip.endAt) {
      out.push({
        fieldKey: "theme.business_trip.endAt",
        fieldLabel: labelOf("theme.business_trip.endAt"),
        oldValue: fmt(oldTrip.businessTrip.endAt),
        newValue: fmt(bt.endAt),
        severity: "material",
      });
    }
    if (
      bt.destinationLocationText !== undefined &&
      bt.destinationLocationText !== oldTrip.businessTrip.destinationLocationText
    ) {
      out.push({
        fieldKey: "theme.business_trip.destinationLocationText",
        fieldLabel: labelOf("theme.business_trip.destinationLocationText"),
        oldValue: fmt(oldTrip.businessTrip.destinationLocationText),
        newValue: fmt(bt.destinationLocationText),
        severity: "material",
      });
    }
    if (bt.capacity !== undefined && bt.capacity !== oldTrip.businessTrip.capacity) {
      out.push({
        fieldKey: "ticket_types.quantity_total",
        fieldLabel: labelOf("ticket_types.quantity_total"),
        oldValue: fmt(oldTrip.businessTrip.capacity),
        newValue: fmt(bt.capacity),
        severity: "material",
      });
    }
  }
  if (patch.days !== undefined) {
    const isMaterial = ctx.droppedDayOrdinals.length > 0;
    const oldCount = oldTrip.days.length;
    const newCount = patch.days.length;
    out.push({
      fieldKey: "days",
      fieldLabel: labelOf("days"),
      oldValue: `${oldCount} day${oldCount === 1 ? "" : "s"}`,
      newValue: `${newCount} day${newCount === 1 ? "" : "s"}`,
      severity: isMaterial ? "material" : "additive",
    });
  }
  if (patch.inclusions !== undefined) {
    const isMaterial = ctx.droppedInclusionKeys.length > 0;
    const oldCount = oldTrip.inclusions.length;
    const newCount = patch.inclusions.length;
    out.push({
      fieldKey: "inclusions",
      fieldLabel: labelOf("inclusions"),
      oldValue: `${oldCount} item${oldCount === 1 ? "" : "s"}`,
      newValue: `${newCount} item${newCount === 1 ? "" : "s"}`,
      severity: isMaterial ? "material" : "additive",
    });
  }
  if (patch.pricing_tiers !== undefined) {
    const isMaterial = ctx.tierPriceChangedTicketTypeIds.length > 0;
    out.push({
      fieldKey: "pricing_tiers",
      fieldLabel: labelOf("pricing_tiers"),
      oldValue: `${oldTrip.pricingTiers.length} tier${oldTrip.pricingTiers.length === 1 ? "" : "s"}`,
      newValue: `${patch.pricing_tiers.length} tier${patch.pricing_tiers.length === 1 ? "" : "s"}`,
      severity: isMaterial ? "material" : "additive",
    });
  }
  // Cover changes
  const coverKeys: ReadonlyArray<keyof typeof patch> = [
    "cover_media_url",
    "cover_media_type",
    "cover_media_provider",
    "cover_media_source_url",
    "cover_media_credit",
    "cover_media_credit_url",
    "cover_media_alt",
  ];
  let coverChanged = false;
  for (const k of coverKeys) {
    if (patch[k] !== undefined) {
      coverChanged = true;
      break;
    }
  }
  if (coverChanged) {
    out.push({
      fieldKey: "cover_media_url",
      fieldLabel: labelOf("cover_media_url"),
      oldValue: fmt(oldTrip.coverMediaUrl),
      newValue: fmt(patch.cover_media_url ?? oldTrip.coverMediaUrl),
      severity: "additive",
    });
  }
  return out;
};
