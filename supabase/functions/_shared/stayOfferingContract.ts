/**
 * Issue #3355 P9 (audit D-22) — the typed Stay offering an Ari create may
 * send through manage_stay_inventory's create_offering.
 *
 * It mirrors the Host's `CreateStayOfferingInput`
 * (mingla-business/src/types/stayInventory.ts) and the stay_offerings CHECKs
 * (a room has a count, adults and children and no place pricing; a place has
 * per-booking/unit/guest pricing and a count or a shared capacity). Anything
 * else — an unknown key, a wrong type, a missing required field — is refused
 * before the Stay owner is called, so an untyped payload never reaches it.
 * The Stay owner (biz_manage_stay_inventory) keeps every rule it has.
 */

const OFFERING_KEYS = new Set([
  "kind",
  "name",
  "summary",
  "description",
  "confirmationMode",
  "inventoryBasis",
  "unitNamingMode",
  "quantity",
  "capacity",
  "minGuests",
  "maxGuests",
  "maxAdults",
  "maxChildren",
  "placePricingBasis",
  "minNoticeMinutes",
  "maxAdvanceDays",
  "bufferBeforeMinutes",
  "bufferAfterMinutes",
  "amenities",
  "safetyRules",
  "accessibilityFeatures",
  "accessScope",
  "units",
  "media",
  "policy",
  "price",
  "fees",
]);

const POLICY_KEYS = new Set([
  "cancellationPolicy",
  "freeCancelCutoffMinutes",
  "lateRefundBasisPoints",
  "noShowRefundBasisPoints",
  "operatorCancelRefundBasisPoints",
  "requestTerms",
  "houseRules",
  "terms",
]);

const FEE_KEYS = new Set([
  "feeKey",
  "label",
  "feeKind",
  "calculation",
  "amountMinor",
  "basisPoints",
  "currencyCode",
  "displayMode",
  "refundTreatment",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function intIn(value: unknown, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= min &&
    (value as number) <= max;
}

function text(value: unknown, max: number, min = 0): boolean {
  return typeof value === "string" && value.trim().length >= min &&
    value.length <= max;
}

function textList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 50 &&
    value.every((item) => text(item, 200, 1));
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

/**
 * The plain problem with a create_offering payload, or null when it is a
 * well-typed CreateStayOfferingInput.
 */
export function stayOfferingPayloadProblem(payload: unknown): string | null {
  if (!isObject(payload)) return "payload must be a Stay offering object";
  const unknown = Object.keys(payload).filter((key) => !OFFERING_KEYS.has(key));
  if (unknown.length > 0) {
    return `payload has fields a Stay offering doesn't take: ${unknown.join(", ")}`;
  }
  const p = payload;
  if (!oneOf(p.kind, ["room", "place"])) return "kind must be room or place";
  if (!text(p.name, 120, 1)) return "name is required (1-120 characters)";
  if (!oneOf(p.inventoryBasis, ["pooled_units", "exclusive_units", "shared_capacity"])) {
    return "inventoryBasis must be pooled_units, exclusive_units or shared_capacity";
  }
  for (const [key, max] of [["summary", 300], ["description", 5000]] as const) {
    if (p[key] !== undefined && !text(p[key], max)) return `${key} must be text`;
  }
  if (
    p.confirmationMode !== undefined &&
    !oneOf(p.confirmationMode, ["request", "instant"])
  ) return "confirmationMode must be request or instant";
  if (
    p.unitNamingMode !== undefined &&
    !oneOf(p.unitNamingMode, ["interchangeable", "named"])
  ) return "unitNamingMode must be interchangeable or named";
  if (p.quantity !== undefined && !intIn(p.quantity, 1, 10000)) {
    return "quantity must be a whole number from 1 to 10000";
  }
  if (p.capacity !== undefined && !intIn(p.capacity, 1, 100000)) {
    return "capacity must be a whole number from 1 to 100000";
  }
  for (const key of ["minGuests", "maxGuests", "maxAdults"] as const) {
    if (p[key] !== undefined && !intIn(p[key], 1, 1000)) {
      return `${key} must be a whole number from 1 to 1000`;
    }
  }
  if (p.maxChildren !== undefined && !intIn(p.maxChildren, 0, 1000)) {
    return "maxChildren must be a whole number from 0 to 1000";
  }
  if (!intIn(p.maxGuests, 1, 1000)) return "maxGuests is required";
  if (
    p.minGuests !== undefined && (p.minGuests as number) > (p.maxGuests as number)
  ) return "minGuests can't be more than maxGuests";
  for (
    const [key, max] of [
      ["minNoticeMinutes", 525600],
      ["bufferBeforeMinutes", 1440],
      ["bufferAfterMinutes", 1440],
    ] as const
  ) {
    if (p[key] !== undefined && !intIn(p[key], 0, max)) {
      return `${key} must be a whole number of minutes`;
    }
  }
  if (p.maxAdvanceDays !== undefined && !intIn(p.maxAdvanceDays, 1, 730)) {
    return "maxAdvanceDays must be a whole number from 1 to 730";
  }
  for (const key of ["amenities", "safetyRules", "accessibilityFeatures"] as const) {
    if (p[key] !== undefined && !textList(p[key])) return `${key} must be a list of words`;
  }
  if (
    p.accessScope !== undefined &&
    !oneOf(p.accessScope, ["public", "overnight_guests_only"])
  ) return "accessScope must be public or overnight_guests_only";
  if (p.kind === "room") {
    if (p.inventoryBasis === "shared_capacity") {
      return "a room is counted in units, not shared capacity";
    }
    if (p.quantity === undefined) return "a room needs quantity";
    if (p.maxAdults === undefined || p.maxChildren === undefined) {
      return "a room needs maxAdults and maxChildren";
    }
    if (p.placePricingBasis !== undefined) {
      return "a room has no placePricingBasis";
    }
    if (p.capacity !== undefined) return "a room has no capacity";
  } else {
    if (!oneOf(p.placePricingBasis, ["per_booking", "per_unit", "per_guest"])) {
      return "a place needs placePricingBasis per_booking, per_unit or per_guest";
    }
    if (p.maxAdults !== undefined || p.maxChildren !== undefined) {
      return "a place has no maxAdults or maxChildren";
    }
    if (p.inventoryBasis === "pooled_units") {
      return "a place is exclusive_units or shared_capacity";
    }
    if (p.inventoryBasis === "exclusive_units" && p.quantity === undefined) {
      return "a place counted in units needs quantity";
    }
    if (
      p.inventoryBasis === "shared_capacity" &&
      (p.capacity === undefined || p.quantity !== undefined)
    ) return "a shared-capacity place needs capacity and no quantity";
  }
  if (p.units !== undefined) {
    if (
      !Array.isArray(p.units) || p.units.length > 10000 ||
      !p.units.every((unit) =>
        isObject(unit) && text(unit.name, 120, 1) &&
        Object.keys(unit).every((key) =>
          key === "name" || key === "externalReference"
        )
      )
    ) return "units must be a list of { name }";
  }
  if (p.media !== undefined) {
    if (
      !Array.isArray(p.media) || p.media.length > 20 ||
      !p.media.every((item) =>
        isObject(item) && typeof item.storageObjectId === "string" &&
        Object.keys(item).every((key) =>
          ["storageObjectId", "altText", "checksumSha256", "isCover"].includes(key)
        )
      )
    ) return "media must be uploaded objects only";
  }
  if (p.price !== undefined) {
    if (
      !isObject(p.price) ||
      Object.keys(p.price).some((key) =>
        key !== "amountMinor" && key !== "currencyCode"
      ) ||
      !intIn(p.price.amountMinor, 1, Number.MAX_SAFE_INTEGER) ||
      typeof p.price.currencyCode !== "string" ||
      !/^[A-Z]{3}$/.test(p.price.currencyCode)
    ) return "price must be { amountMinor, currencyCode }";
  }
  if (p.policy !== undefined) {
    if (
      !isObject(p.policy) ||
      Object.keys(p.policy).some((key) => !POLICY_KEYS.has(key)) ||
      !text(p.policy.cancellationPolicy, 5000, 1)
    ) return "policy needs a cancellationPolicy";
  }
  if (p.fees !== undefined) {
    if (
      !Array.isArray(p.fees) ||
      !p.fees.every((fee) =>
        isObject(fee) && Object.keys(fee).every((key) => FEE_KEYS.has(key)) &&
        text(fee.feeKey, 80, 1) && text(fee.label, 120, 1)
      )
    ) return "fees must be a list of typed fees";
  }
  return null;
}
