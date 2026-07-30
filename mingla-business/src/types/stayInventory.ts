export type StayOfferingKind = "room" | "place";
export type StayBookingMode = "request" | "instant";
export type StayOfferingStatus = "draft" | "live" | "paused" | "archived";
export type StayAccessScope = "public" | "overnight_guests_only";
export type StayInventoryBasis =
  "pooled_units" | "exclusive_units" | "shared_capacity";
export type StayUnitNamingMode = "interchangeable" | "named";
export type StayPlacePricingBasis = "per_booking" | "per_unit" | "per_guest";
export type StayPropertyKind =
  | "hotel"
  | "resort"
  | "guest_house"
  | "lodge"
  | "serviced_apartment"
  | "short_stay_apartment"
  | "other";

export interface StayMediaInput {
  storageObjectId: string;
  altText?: string;
  checksumSha256?: string;
  isCover?: boolean;
}

export interface StayUnitInput {
  name: string;
  externalReference?: string;
}

export interface StayPriceInput {
  amountMinor: number;
  currencyCode: string;
}

export interface StayFeeInput {
  feeKey: string;
  label: string;
  feeKind?: "mandatory_fee" | "tax";
  calculation:
    | "fixed_per_group"
    | "fixed_per_room_night"
    | "fixed_per_place_booking"
    | "fixed_per_place_unit"
    | "fixed_per_place_guest"
    | "percentage_of_line_base";
  amountMinor?: number;
  basisPoints?: number;
  currencyCode?: string;
  displayMode: "included" | "separate";
  refundTreatment?: "refundable" | "nonrefundable" | "same_as_line";
}

export interface CreateStayOfferingInput {
  kind: StayOfferingKind;
  name: string;
  summary?: string;
  description?: string;
  confirmationMode?: StayBookingMode;
  inventoryBasis: StayInventoryBasis;
  unitNamingMode?: StayUnitNamingMode;
  quantity?: number;
  capacity?: number;
  minGuests?: number;
  maxGuests?: number;
  maxAdults?: number;
  maxChildren?: number;
  placePricingBasis?: StayPlacePricingBasis;
  minNoticeMinutes?: number;
  maxAdvanceDays?: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  amenities?: string[];
  safetyRules?: string[];
  accessibilityFeatures?: string[];
  accessScope?: StayAccessScope;
  units?: StayUnitInput[];
  media?: StayMediaInput[];
  policy?: {
    cancellationPolicy: string;
    freeCancelCutoffMinutes?: number;
    lateRefundBasisPoints?: number;
    noShowRefundBasisPoints?: number;
    operatorCancelRefundBasisPoints?: number;
    requestTerms?: string;
    houseRules?: string;
    terms?: Record<string, unknown>;
  };
  price?: StayPriceInput;
  fees?: StayFeeInput[];
}

export interface StaySettingsInput {
  propertyKind?: StayPropertyKind | null;
  timezone: string;
  defaultBookingMode: StayBookingMode;
  checkInTime: string;
  checkOutTime: string;
  instantPaymentHoldMinutes?: number;
  requestResponseHours?: number;
  approvedPaymentMinutes?: number;
  bookingHorizonDays?: number;
  bookingState?: "draft" | "review" | "active" | "paused";
  houseRules?: string | null;
}

export type StayInventoryAction =
  | "get"
  | "save_settings"
  | "create_offering"
  | "update_offering"
  | "replace_units"
  | "change_status"
  | "set_policy"
  | "set_price"
  | "replace_fees"
  | "attach_media"
  | "reorder_media"
  | "remove_media"
  | "bulk_create"
  | "upsert_room_nights"
  | "upsert_place_schedule"
  | "materialize_place_windows"
  | "upsert_place_windows"
  | "resolve_currency_reconciliation";

export interface StayInventorySnapshot {
  venue: {
    id: string;
    brandId: string;
    name: string;
    category: "stay";
  };
  settings: Record<string, unknown> | null;
  offerings: Array<Record<string, unknown>>;
}

export interface StayBulkJobResult {
  job: {
    id: string;
    status: "running" | "completed" | "completed_with_errors" | "failed";
    requested_count: number;
    succeeded_count: number;
    failed_count: number;
  };
  items: Array<Record<string, unknown>>;
  replayed: boolean;
}

export interface StayCurrencyReconciliationInput {
  reconciliationId: string;
  decision: "convert" | "reenter" | "accept_no_ranges";
  fxSnapshotId?: string | null;
  ranges?: Array<Record<string, unknown>>;
  stayItems?: Array<Record<string, unknown>>;
}
