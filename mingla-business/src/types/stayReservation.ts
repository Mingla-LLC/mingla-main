export type StayReservationAction =
  | "quote"
  | "create_group"
  | "approve_request"
  | "decline_request"
  | "get_group"
  | "list_staff_groups"
  | "get_staff_group"
  | "cancel_preview"
  | "cancel";

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
  allocations: {
    ordinal: number;
    adults: number;
    children: number;
    namedUnitPreference: string | null;
  }[];
  fees: {
    name: string;
    kind: "mandatory_fee" | "tax";
    amountMinor: string;
    includedInBase: boolean;
    refundTreatment: "refundable" | "nonrefundable" | "same_as_line";
  }[];
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
  events: {
    eventType: string;
    actorType: "guest" | "staff" | "admin" | "service";
    metadata: Record<string, unknown>;
    createdAt: string;
  }[];
  lines: {
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
  }[];
};

export type StayStaffPermissions = {
  canView: boolean;
  canRespond: boolean;
  canCancel: boolean;
  canViewFinance: boolean;
};

export type StayStaffReservationSummary = {
  groupId: string;
  publicReference: string;
  venueId: string;
  brandId: string;
  currencyCode: string;
  mode: "instant" | "request";
  state: StayReservationGroup["state"];
  guest: StayGuestInput;
  totalMinor: string;
  lineCount: number;
  roomCount: number;
  placeCount: number;
  requestDeadline: string | null;
  paymentDeadline: string | null;
  paymentState: string | null;
  refundState: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type StayStaffReservationList = {
  permissions: StayStaffPermissions;
  groups: StayStaffReservationSummary[];
};

export type StayStaffReservationGroup = Omit<StayReservationGroup, "lines"> & {
  permissions: StayStaffPermissions;
  payment: {
    state: string;
    provider: "stripe" | "paystack";
    amountMinor: string;
    applicationFeeMinor: string | null;
    succeededAt: string | null;
    updatedAt: string;
  } | null;
  refunds: {
    refundId: string;
    state: string;
    amountMinor: string;
    reason: string;
    requestedByType: "guest" | "staff" | "admin" | "system";
    createdAt: string;
    updatedAt: string;
  }[];
  lines: (StayReservationGroup["lines"][number] & {
      schedule: Record<string, unknown>;
      allocations: {
        ordinal: number;
        adults: number;
        children: number;
        namedUnitPreference: string | null;
      }[];
      fees: {
        name: string;
        kind: "mandatory_fee" | "tax";
        amountMinor: string;
        includedInBase: boolean;
        refundTreatment: "refundable" | "nonrefundable" | "same_as_line";
      }[];
    })[];
};

export type StayCancelPreview = {
  previewId: string;
  previewHash: string;
  groupId: string;
  groupVersion: number;
  selectedLineIds: string[];
  amountMinor: string;
  retainedAmountMinor: string;
  currencyCode: string;
  expiresAt: string;
  allocations: (Record<string, unknown> & {
      reservationLineId: string;
      amountMinor: string;
    })[];
  inventoryRelease: {
    lineCount: number;
    commitmentCount: number;
    roomNightQuantity: number;
    placeQuantity: number;
  };
  payoutEffect: {
    applicationFeeReversalMinor: string;
    organizerLiabilityMinor: string;
    alreadyReleasedMinor: string;
    payoutReversalMinor: string;
    futureReleaseReductionMinor: string;
    requiresPayoutReversal: boolean;
  };
};

export type StayReservationEnvelope<T> =
  | { kind: "success"; data: T; requestId: string }
  | {
      kind: "error";
      code: string;
      message: string;
      requestId: string;
    };
