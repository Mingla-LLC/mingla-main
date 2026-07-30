export type StayConfirmationMode = "instant" | "request";
export type StayOfferingKind = "room" | "place";

export interface PublicStayMedia {
  url: string;
  mimeType: string;
  altText: string | null;
  isCover: boolean;
  sortOrder: number;
}

export interface PublicStayPlaceWindow {
  id: string;
  localDate: string;
  startsAt: string;
  endsAt: string;
  sellableUnits: number | null;
  sellableCapacity: number | null;
  priceOverrideMinor: string | null;
  currencyCode: string | null;
}

export interface PublicStayPrice {
  amountMinor: string;
  currencyCode: string;
  pricingUnit:
    | "room_night"
    | "place_booking"
    | "place_unit"
    | "place_guest";
}

export interface PublicStayOffering {
  id: string;
  kind: StayOfferingKind;
  name: string;
  summary: string;
  description: string;
  confirmationMode: StayConfirmationMode;
  inventoryBasis:
    | "pooled_units"
    | "exclusive_units"
    | "shared_capacity";
  unitNamingMode: "interchangeable" | "named";
  quantity: number | null;
  capacity: number | null;
  minGuests: number;
  maxGuests: number;
  maxAdults: number | null;
  maxChildren: number | null;
  placePricingBasis: "per_booking" | "per_unit" | "per_guest" | null;
  minNoticeMinutes: number;
  maxAdvanceDays: number | null;
  amenities: string[];
  safetyRules: string[];
  accessibilityFeatures: string[];
  accessScope: "public" | "overnight_guests_only";
  price: PublicStayPrice;
  fees: Array<{
    label: string;
    kind: "mandatory_fee" | "tax";
    calculation: string;
    amountMinor: string | null;
    basisPoints: number | null;
    currencyCode: string | null;
    displayMode: "included" | "separate";
  }>;
  policy: {
    cancellationPolicy: string;
    freeCancelCutoffMinutes: number;
    requestTerms: string | null;
    houseRules: string | null;
  };
  media: PublicStayMedia[];
  placeWindows: PublicStayPlaceWindow[];
}

export interface PublicStayDetail {
  venueId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  venueSlug: string;
  venueName: string;
  propertyKind: string | null;
  timezone: string;
  defaultBookingMode: StayConfirmationMode;
  checkInTime: string;
  checkOutTime: string;
  bookingHorizonDays: number;
  houseRules: string | null;
  offerings: PublicStayOffering[];
}

export interface StayRoomCartLineInput {
  kind: "room";
  offeringId: string;
  checkIn: string;
  checkOut: string;
  quantity: number;
  allocations: Array<{
    adults: number;
    children: number;
    namedUnitPreference?: string;
  }>;
}

export interface StayPlaceCartLineInput {
  kind: "place";
  offeringId: string;
  placeWindowId: string;
  units?: number;
  guests: number;
  adults?: number;
  children?: number;
  namedUnitPreferences?: string[];
}

export type StayGuestCartLineInput =
  | StayRoomCartLineInput
  | StayPlaceCartLineInput;

export interface StayGuestCheckoutInput {
  lines: StayGuestCartLineInput[];
  guest: {
    name: string;
    email?: string;
    phone?: string;
  };
}

export interface StayQuote {
  quoteId: string;
  venueId: string;
  brandId: string;
  currencyCode: string;
  mode: StayConfirmationMode;
  status: "active" | "expired" | "consumed";
  expiresAt: string;
  version: number;
  sourceSubtotalMinor: string;
  feeTotalMinor: string;
  taxTotalMinor: string;
  totalMinor: string;
  lines: Array<Record<string, unknown> & {
    lineId: string;
    offeringId: string;
    kind: StayOfferingKind;
    totalMinor: string;
  }>;
}

export interface StayReservationGroup {
  groupId: string;
  publicReference: string;
  quoteId: string;
  venueId: string;
  brandId: string;
  currencyCode: string;
  mode: StayConfirmationMode;
  state:
    | "instant_payment_pending"
    | "request_pending"
    | "declined"
    | "request_expired"
    | "approved_payment_required"
    | "finalizing"
    | "confirmed"
    | "partially_cancelled"
    | "cancelled"
    | "reconciliation_required";
  requestDeadline: string | null;
  paymentDeadline: string | null;
  guest: { name: string; email?: string; phone?: string };
  sourceSubtotalMinor: string;
  feeTotalMinor: string;
  taxTotalMinor: string;
  totalMinor: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  hold: {
    state: string;
    expiresAt: string;
    version: number;
  } | null;
  lines: Array<{
    lineId: string;
    offeringId: string;
    kind: StayOfferingKind;
    state: string;
    roomCheckIn: string | null;
    roomCheckOut: string | null;
    roomQuantity: number | null;
    placeWindowId: string | null;
    placeUnits: number | null;
    placeGuests: number | null;
    adults: number;
    children: number;
    baseMinor: string;
    feeMinor: string;
    taxMinor: string;
    totalMinor: string;
    dependencyRoomLineId: string | null;
    offering: Record<string, unknown>;
    price: Record<string, unknown>;
    policy: Record<string, unknown>;
  }>;
  events: Array<{
    eventType: string;
    actorType: "guest" | "staff" | "admin" | "service";
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
}

export type StayPaymentSession =
  | {
      kind: "requires_payment";
      provider: "stripe";
      attemptId: string;
      providerPaymentRef: string;
      clientSecret: string;
      publishableKey: string;
      stripeAccountId: string;
      amountMinor: string;
      currencyCode: string;
    }
  | {
      kind: "requires_redirect";
      provider: "paystack";
      attemptId: string;
      providerPaymentRef: string;
      authorizationUrl: string;
      amountMinor: string;
      currencyCode: string;
    };

export interface StayCancelPreview {
  previewId: string;
  previewHash: string;
  groupId: string;
  groupVersion: number;
  selectedLineIds: string[];
  amountMinor: string;
  currencyCode: string;
  allocations: Array<Record<string, unknown>>;
  expiresAt: string;
}

export interface MyStayReservationGroup {
  groupId: string;
  publicReference: string;
  venueId: string;
  venueName: string;
  venueSlug: string;
  brandId: string;
  brandName: string;
  brandSlug: string;
  currencyCode: string;
  mode: StayConfirmationMode;
  state: StayReservationGroup["state"];
  requestDeadline: string | null;
  paymentDeadline: string | null;
  totalMinor: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  lines: Array<{
    lineId: string;
    kind: StayOfferingKind;
    state: string;
    name: string;
    roomCheckIn: string | null;
    roomCheckOut: string | null;
    roomQuantity: number | null;
    placeStartsAt: string | null;
    placeEndsAt: string | null;
    placeGuests: number | null;
    totalMinor: string;
  }>;
}

export { stayGuestKeys } from "./stayGuestKeys";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidStayDateRange(
  checkIn: string,
  checkOut: string,
): boolean {
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) return false;
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function buildStayRoomAllocations(input: {
  quantity: number;
  adults: number;
  children: number;
  maxAdults: number;
  maxChildren: number;
  minGuests?: number;
  maxGuests?: number;
}): Array<{ adults: number; children: number }> | null {
  const {
    quantity,
    adults,
    children,
    maxAdults,
    maxChildren,
    minGuests = 1,
    maxGuests = maxAdults + maxChildren,
  } = input;
  if (
    !Number.isInteger(quantity) ||
    !Number.isInteger(adults) ||
    !Number.isInteger(children) ||
    quantity < 1 ||
    adults < 0 ||
    children < 0 ||
    minGuests < 1 ||
    maxGuests < minGuests ||
    adults + children < minGuests * quantity ||
    adults + children > maxGuests * quantity ||
    adults > maxAdults * quantity ||
    children > maxChildren * quantity
  ) {
    return null;
  }
  const allocations = Array.from({ length: quantity }, () => ({
    adults: 0,
    children: 0,
  }));
  for (let index = 0; index < adults; index += 1) {
    allocations[index % quantity].adults += 1;
  }
  for (let index = 0; index < children; index += 1) {
    allocations[(adults + index) % quantity].children += 1;
  }
  if (
    allocations.some(
      (allocation) =>
        allocation.adults + allocation.children < minGuests ||
        allocation.adults + allocation.children > maxGuests ||
        allocation.adults > maxAdults ||
        allocation.children > maxChildren,
    )
  ) {
    return null;
  }
  return allocations;
}

export function buildStayRoomCartAllocations(input: {
  rooms: Array<{
    offeringId: string;
    quantity: number;
    minGuests: number;
    maxGuests: number;
    maxAdults: number;
    maxChildren: number;
  }>;
  adults: number;
  children: number;
}): Record<string, Array<{ adults: number; children: number }>> | null {
  if (
    input.rooms.some((room) =>
      !room.offeringId ||
      !Number.isInteger(room.quantity) ||
      room.quantity < 1 ||
      !Number.isInteger(room.minGuests) ||
      !Number.isInteger(room.maxGuests) ||
      !Number.isInteger(room.maxAdults) ||
      !Number.isInteger(room.maxChildren) ||
      room.minGuests < 1 ||
      room.maxGuests < room.minGuests ||
      room.maxAdults < 0 ||
      room.maxChildren < 0
    )
  ) {
    return null;
  }
  const slots = input.rooms.flatMap((room) =>
    Array.from({ length: room.quantity }, () => ({
      offeringId: room.offeringId,
      minGuests: room.minGuests,
      maxGuests: room.maxGuests,
      maxAdults: room.maxAdults,
      maxChildren: room.maxChildren,
    }))
  );
  if (slots.length === 0) return {};
  if (
    !Number.isInteger(input.adults) ||
    !Number.isInteger(input.children) ||
    input.adults < 0 ||
    input.children < 0
  ) {
    return null;
  }

  const memo = new Set<string>();
  const solve = (
    index: number,
    adults: number,
    children: number,
  ): Array<{ adults: number; children: number }> | null => {
    if (index === slots.length) {
      return adults === 0 && children === 0 ? [] : null;
    }
    const key = `${index}:${adults}:${children}`;
    if (memo.has(key)) return null;
    const slot = slots[index];
    const remaining = slots.slice(index + 1);
    const remainingMin = remaining.reduce(
      (sum, item) => sum + item.minGuests,
      0,
    );
    const remainingMax = remaining.reduce(
      (sum, item) => sum + item.maxGuests,
      0,
    );
    for (
      let slotGuests = slot.minGuests;
      slotGuests <= slot.maxGuests;
      slotGuests += 1
    ) {
      const guestsAfter = adults + children - slotGuests;
      if (guestsAfter < remainingMin || guestsAfter > remainingMax) continue;
      for (
        let slotAdults = Math.min(slot.maxAdults, adults, slotGuests);
        slotAdults >= 0;
        slotAdults -= 1
      ) {
        const slotChildren = slotGuests - slotAdults;
        if (
          slotChildren > children ||
          slotChildren > slot.maxChildren
        ) {
          continue;
        }
        const tail = solve(
          index + 1,
          adults - slotAdults,
          children - slotChildren,
        );
        if (tail !== null) {
          return [{ adults: slotAdults, children: slotChildren }, ...tail];
        }
      }
    }
    memo.add(key);
    return null;
  };

  const allocations = solve(0, input.adults, input.children);
  if (allocations === null) return null;
  const grouped: Record<
    string,
    Array<{ adults: number; children: number }>
  > = {};
  slots.forEach((slot, index) => {
    grouped[slot.offeringId] = [
      ...(grouped[slot.offeringId] ?? []),
      allocations[index],
    ];
  });
  return grouped;
}

export function validateStayGuestCart(input: {
  detail: PublicStayDetail;
  lines: StayGuestCartLineInput[];
}): string | null {
  const { detail, lines } = input;
  if (lines.length === 0) return "Choose at least one Room or Place.";
  const offerings = new Map(detail.offerings.map((item) => [item.id, item]));
  const roomOfferingIds = new Set(
    lines.filter((line) => line.kind === "room").map((line) => line.offeringId),
  );
  const seen = new Set<string>();
  for (const line of lines) {
    const offering = offerings.get(line.offeringId);
    if (!offering || offering.kind !== line.kind) {
      return "One of your selections is no longer available.";
    }
    const key =
      line.kind === "room"
        ? `room:${line.offeringId}`
        : `place:${line.offeringId}:${line.placeWindowId}`;
    if (seen.has(key)) return "A Room or Place was added more than once.";
    seen.add(key);
    if (
      line.kind === "room" &&
      (!isValidStayDateRange(line.checkIn, line.checkOut) ||
        line.quantity < 1 ||
        line.allocations.length !== line.quantity)
    ) {
      return "Check the dates, room count, and guests for each Room.";
    }
    if (
      line.kind === "place" &&
      (line.guests < offering.minGuests ||
        line.guests > offering.maxGuests ||
        !offering.placeWindows.some((window) => window.id === line.placeWindowId))
    ) {
      return "Check the time and guest count for each Place.";
    }
    if (
      offering.accessScope === "overnight_guests_only" &&
      roomOfferingIds.size === 0
    ) {
      return `${offering.name} is for overnight guests. Add a Room first.`;
    }
  }
  return null;
}

export { formatStayMoney } from "./stayGuestMoney";

export function stayCheckoutMode(
  detail: PublicStayDetail,
  lines: StayGuestCartLineInput[],
): StayConfirmationMode {
  const modes = new Map(
    detail.offerings.map((offering) => [
      offering.id,
      offering.confirmationMode,
    ]),
  );
  return lines.some((line) => modes.get(line.offeringId) === "request")
    ? "request"
    : "instant";
}

export function parsePublicStayDetail(
  value: unknown,
  resolveMediaUrl: (path: string) => string,
): PublicStayDetail | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("stay_public_payload_invalid");
  }
  const source = value as Record<string, unknown>;
  if (
    typeof source.venueId !== "string" ||
    typeof source.brandId !== "string" ||
    typeof source.brandSlug !== "string" ||
    typeof source.brandName !== "string" ||
    typeof source.venueSlug !== "string" ||
    typeof source.venueName !== "string" ||
    typeof source.timezone !== "string" ||
    (source.defaultBookingMode !== "instant" &&
      source.defaultBookingMode !== "request") ||
    !Array.isArray(source.offerings)
  ) {
    throw new Error("stay_public_payload_invalid");
  }
  const offerings = source.offerings.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("stay_public_offering_invalid");
    }
    const offering = raw as Record<string, unknown>;
    const price =
      typeof offering.price === "object" &&
        offering.price !== null &&
        !Array.isArray(offering.price)
        ? (offering.price as Record<string, unknown>)
        : null;
    if (
      typeof offering.id !== "string" ||
      (offering.kind !== "room" && offering.kind !== "place") ||
      typeof offering.name !== "string" ||
      (offering.confirmationMode !== "instant" &&
        offering.confirmationMode !== "request") ||
      price === null ||
      typeof price.amountMinor !== "string" ||
      typeof price.currencyCode !== "string"
    ) {
      throw new Error("stay_public_offering_invalid");
    }
    const media = Array.isArray(offering.media)
      ? offering.media.flatMap((rawMedia) => {
          if (
            typeof rawMedia !== "object" ||
            rawMedia === null ||
            Array.isArray(rawMedia)
          ) {
            return [];
          }
          const item = rawMedia as Record<string, unknown>;
          if (typeof item.path !== "string" || typeof item.mimeType !== "string") {
            return [];
          }
          return [{
            url: resolveMediaUrl(item.path),
            mimeType: item.mimeType,
            altText: typeof item.altText === "string" ? item.altText : null,
            isCover: item.isCover === true,
            sortOrder:
              typeof item.sortOrder === "number" ? item.sortOrder : 0,
          }];
        })
      : [];
    return {
      id: offering.id,
      kind: offering.kind,
      name: offering.name,
      confirmationMode: offering.confirmationMode,
      inventoryBasis:
        offering.inventoryBasis === "shared_capacity" ||
          offering.inventoryBasis === "exclusive_units"
          ? offering.inventoryBasis
          : "pooled_units",
      unitNamingMode:
        offering.unitNamingMode === "named" ? "named" : "interchangeable",
      placePricingBasis:
        offering.placePricingBasis === "per_booking" ||
          offering.placePricingBasis === "per_unit" ||
          offering.placePricingBasis === "per_guest"
          ? offering.placePricingBasis
          : null,
      accessScope:
        offering.accessScope === "overnight_guests_only"
          ? "overnight_guests_only"
          : "public",
      summary: typeof offering.summary === "string" ? offering.summary : "",
      description:
        typeof offering.description === "string" ? offering.description : "",
      quantity: typeof offering.quantity === "number" ? offering.quantity : null,
      capacity: typeof offering.capacity === "number" ? offering.capacity : null,
      minGuests:
        typeof offering.minGuests === "number" ? offering.minGuests : 1,
      maxGuests:
        typeof offering.maxGuests === "number" ? offering.maxGuests : 1,
      maxAdults:
        typeof offering.maxAdults === "number" ? offering.maxAdults : null,
      maxChildren:
        typeof offering.maxChildren === "number" ? offering.maxChildren : null,
      minNoticeMinutes:
        typeof offering.minNoticeMinutes === "number"
          ? offering.minNoticeMinutes
          : 0,
      maxAdvanceDays:
        typeof offering.maxAdvanceDays === "number"
          ? offering.maxAdvanceDays
          : null,
      amenities: Array.isArray(offering.amenities)
        ? offering.amenities.filter((item): item is string => typeof item === "string")
        : [],
      safetyRules: Array.isArray(offering.safetyRules)
        ? offering.safetyRules.filter((item): item is string => typeof item === "string")
        : [],
      accessibilityFeatures: Array.isArray(offering.accessibilityFeatures)
        ? offering.accessibilityFeatures.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      fees: Array.isArray(offering.fees)
        ? offering.fees as PublicStayOffering["fees"]
        : [],
      media,
      placeWindows: Array.isArray(offering.placeWindows)
        ? offering.placeWindows as PublicStayPlaceWindow[]
        : [],
      policy:
        typeof offering.policy === "object" &&
          offering.policy !== null &&
          !Array.isArray(offering.policy)
          ? offering.policy as PublicStayOffering["policy"]
          : {
              cancellationPolicy: "See Stay policy at checkout.",
              freeCancelCutoffMinutes: 0,
              requestTerms: null,
              houseRules: null,
            },
      price: price as unknown as PublicStayPrice,
    } satisfies PublicStayOffering;
  });
  return {
    venueId: source.venueId,
    brandId: source.brandId,
    brandSlug: source.brandSlug,
    brandName: source.brandName,
    venueSlug: source.venueSlug,
    venueName: source.venueName,
    propertyKind:
      typeof source.propertyKind === "string" ? source.propertyKind : null,
    timezone: source.timezone,
    defaultBookingMode: source.defaultBookingMode,
    checkInTime:
      typeof source.checkInTime === "string" ? source.checkInTime : "15:00:00",
    checkOutTime:
      typeof source.checkOutTime === "string" ? source.checkOutTime : "11:00:00",
    bookingHorizonDays:
      typeof source.bookingHorizonDays === "number"
        ? source.bookingHorizonDays
        : 365,
    houseRules: typeof source.houseRules === "string" ? source.houseRules : null,
    offerings,
  };
}
