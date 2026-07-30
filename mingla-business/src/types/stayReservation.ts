export type StayReservationAction =
  | "quote"
  | "create_group"
  | "approve_request"
  | "decline_request"
  | "get_group";

export type StayRoomAllocationInput = {
  adults: number;
  children: number;
  namedUnitPreference?: string;
};

export type StayRoomCartLineInput = {
  kind: "room";
  offeringId: string;
  checkIn: string;
  checkOut: string;
  quantity: number;
  allocations: StayRoomAllocationInput[];
};

export type StayPlaceCartLineInput = {
  kind: "place";
  offeringId: string;
  placeWindowId: string;
  units?: number;
  guests: number;
  adults?: number;
  children?: number;
  namedUnitPreferences?: string[];
};

export type StayCartLineInput = StayRoomCartLineInput | StayPlaceCartLineInput;

export type StayQuoteInput = {
  venueId: string;
  idempotencyKey: string;
  lines: StayCartLineInput[];
};

export type StayGuestInput = {
  name: string;
  email?: string;
  phone?: string;
};

export type StayQuoteLine = {
  lineId: string;
  offeringId: string;
  kind: "room" | "place";
  confirmationMode: "instant" | "request";
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
  offering: Record<string, unknown>;
  price: Record<string, unknown>;
  policy: Record<string, unknown>;
  allocations: Array<{
    ordinal: number;
    adults: number;
    children: number;
    namedUnitPreference: string | null;
  }>;
  fees: Array<{
    name: string;
    kind: "mandatory_fee" | "tax";
    amountMinor: string;
    includedInBase: boolean;
    refundTreatment: "refundable" | "nonrefundable" | "same_as_line";
  }>;
};

export type StayQuote = {
  quoteId: string;
  venueId: string;
  brandId: string;
  currencyCode: string;
  mode: "instant" | "request";
  status: "active" | "expired" | "consumed";
  expiresAt: string;
  version: number;
  sourceSubtotalMinor: string;
  feeTotalMinor: string;
  taxTotalMinor: string;
  totalMinor: string;
  lines: StayQuoteLine[];
};

export type StayReservationGroup = {
  groupId: string;
  publicReference: string;
  quoteId: string;
  venueId: string;
  brandId: string;
  currencyCode: string;
  mode: "instant" | "request";
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
  guest: StayGuestInput;
  sourceSubtotalMinor: string;
  feeTotalMinor: string;
  taxTotalMinor: string;
  totalMinor: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  hold: {
    state:
      | "active"
      | "converted"
      | "released"
      | "expired"
      | "reconciliation_required";
    expiresAt: string;
    version: number;
  };
  events: Array<{
    eventType: string;
    actorType: "guest" | "staff" | "admin" | "service";
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  lines: Array<{
    lineId: string;
    offeringId: string;
    kind: "room" | "place";
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
};

export type StayReservationEnvelope<T> =
  | { kind: "success"; data: T; requestId: string }
  | {
      kind: "error";
      code: string;
      message: string;
      requestId: string;
    };
