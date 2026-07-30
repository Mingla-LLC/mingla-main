/**
 * ORCH-1066 — pure render rules for <DeckCardPreview>, extracted so they are
 * unit-testable via `node --test` (the JSX component imports these).
 *
 * Honest-data contract (Constitution #9 / SPEC §3.10):
 * - rating badge HIDDEN when rating is null or ≤ 0 (exact native rule)
 * - hero is a real photo OR an honest "No photo yet" placeholder — never faked;
 *   '__backfill_failed__' sentinel counts as no-photo
 * - distance / travel time are NEVER produced here (admin has no buyer geo)
 * - the live venue preview uses canonicalVenuePriceLabel exclusively
 */

export function priceLabel(placeData) {
  if (!placeData) return null;
  const tiers = placeData.price_tiers;
  if (Array.isArray(tiers) && tiers.length > 0) {
    const n = Math.max(1, Math.min(4, tiers.length));
    return "$".repeat(n);
  }
  const labels = {
    PRICE_LEVEL_FREE: "Free",
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return typeof placeData.price_level === "string"
    ? labels[placeData.price_level] ?? null
    : null;
}

/** Canonical minor-unit source range. Legacy Google ordinals are not money. */
export function canonicalVenuePriceLabel(placeData) {
  if (!placeData) return null;
  const min = placeData.source_min_minor;
  const max = placeData.source_max_minor;
  const code = placeData.source_currency_code;
  const exponent = placeData.source_minor_unit_exponent ?? 2;
  if (!Number.isSafeInteger(min) || min < 0 || typeof code !== "string") return null;
  if (max !== null && max !== undefined && (!Number.isSafeInteger(max) || max < min)) return null;
  if (min === 0 && max === 0) return "Free";
  const format = (minor) => new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minor / (10 ** exponent));
  return max === null || max === undefined
    ? `${format(min)}+`
    : `${format(min)}–${format(max)}`;
}

export function buildAdminDiscoveryRangeUpdate({
  place,
  editForm,
  requestId,
}) {
  const range = place?.place_discovery_price_ranges ?? null;
  const reason = String(editForm?.discovery_edit_reason ?? "").trim();
  if (reason.length < 3) {
    return {
      ok: false,
      code: "admin_reason_required",
      message: "Enter a human-readable audit reason before saving.",
    };
  }
  let minMinor = null;
  let maxMinor = null;
  if (range?.status === "active") {
    minMinor = Number(editForm.discovery_min_minor);
    maxMinor = String(editForm.discovery_max_minor ?? "").trim() === ""
      ? null
      : Number(editForm.discovery_max_minor);
    if (
      !Number.isSafeInteger(minMinor) ||
      minMinor < 0 ||
      (maxMinor !== null &&
        (!Number.isSafeInteger(maxMinor) || maxMinor < minMinor))
    ) {
      return {
        ok: false,
        code: "invalid_range",
        message: "Use non-negative integer minor units; max must be at least min.",
      };
    }
  }
  return {
    ok: true,
    params: {
      p_place_pool_id: place.id,
      p_name: editForm.name || null,
      p_price_tier: editForm.price_tiers?.[0] || null,
      p_price_tiers: editForm.price_tiers || [],
      p_is_active: editForm.is_active,
      p_ai_categories: editForm.ai_categories || [],
      p_source_min_minor: minMinor,
      p_source_max_minor: maxMinor,
      p_expected_version: range?.status === "active" ? range.version : null,
      p_actor_reason: reason,
      p_request_id: requestId,
    },
  };
}

export function adminDiscoveryRangeErrorMessage(error) {
  const raw = String(error?.message ?? "");
  if (raw.includes("range_version_conflict")) {
    return "This price range changed. Reload the place and review the latest revision.";
  }
  if (raw.includes("admin_reason_required")) {
    return "Enter a human-readable audit reason before saving.";
  }
  return raw || "The place could not be updated.";
}

/** Exact native rule: show rating only when it is a positive number. */
export function showRating(rating) {
  return typeof rating === "number" && rating > 0;
}

/** True when the first stored photo is a real, renderable hero. */
export function hasRealHero(storedPhotoUrls) {
  if (!Array.isArray(storedPhotoUrls) || storedPhotoUrls.length === 0) return false;
  const first = storedPhotoUrls[0];
  return typeof first === "string" && first.length > 0 && first !== "__backfill_failed__";
}
