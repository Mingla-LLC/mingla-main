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
  summary?: string | null;
  amenities?: string[];
  accessibilityFeatures?: string[];
  arrivalInstructions?: string | null;
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
  | "publish_stay"
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
  permissions: {
    canRead: boolean;
    canManageInventory: boolean;
    canManageFinance: boolean;
  };
  settings: StaySettingsRecord | null;
  offerings: StayOfferingRecord[];
}

export interface StaySettingsRecord {
  venue_id: string;
  brand_id: string;
  property_kind: StayPropertyKind | null;
  summary?: string | null;
  amenities?: string[];
  accessibility_features?: string[];
  arrival_instructions?: string | null;
  timezone: string;
  default_booking_mode: StayBookingMode;
  check_in_time: string;
  check_out_time: string;
  instant_payment_hold_minutes: number;
  request_response_hours: number;
  approved_payment_minutes: number;
  booking_horizon_days: number;
  booking_state: "draft" | "review" | "active" | "paused";
  house_rules: string | null;
  version: number;
}

export interface StayOfferingRecord {
  id: string;
  kind: StayOfferingKind;
  name: string;
  summary?: string | null;
  description: string;
  confirmation_mode: StayBookingMode;
  inventory_basis: StayInventoryBasis;
  unit_naming_mode: StayUnitNamingMode;
  quantity?: number | null;
  capacity?: number | null;
  min_guests: number;
  max_guests: number;
  max_adults?: number | null;
  max_children?: number | null;
  place_pricing_basis?: StayPlacePricingBasis | null;
  amenities?: string[];
  safety_rules?: string[];
  accessibility_features?: string[];
  access_scope: StayAccessScope;
  status: StayOfferingStatus;
  version: number;
  currentPrice?: StayPriceRecord | null;
  currentFees?: StayFeeRecord[];
  currentPolicy?: StayPolicyRecord | null;
  media?: StayMediaRecord[];
  units?: StayUnitRecord[];
  roomNights?: StayRoomNightRecord[];
  placeScheduleRules?: StayPlaceScheduleRuleRecord[];
  placeWindows?: StayPlaceWindowRecord[];
  nextAvailability?: string | null;
  hasOpenAvailability?: boolean;
  [key: string]: unknown;
}

export interface StayPriceRecord {
  id: string;
  amount_minor: number;
  currency_code: string;
  pricing_unit: string;
  version_number: number;
}

export interface StayFeeRecord {
  id: string;
  fee_key: string;
  label: string;
  fee_kind: "mandatory_fee" | "tax";
  calculation: StayFeeInput["calculation"];
  amount_minor?: number | null;
  basis_points?: number | null;
  currency_code?: string | null;
  display_mode: "included" | "separate";
  refund_treatment: "refundable" | "nonrefundable" | "same_as_line";
}

export interface StayPolicyRecord {
  id: string;
  cancellation_policy: string;
  free_cancel_cutoff_minutes: number;
  late_refund_basis_points: number;
  no_show_refund_basis_points: number;
  operator_cancel_refund_basis_points: number;
  request_terms?: string | null;
  house_rules?: string | null;
  version_number: number;
}

export interface StayMediaRecord {
  id: string;
  storage_bucket_id: "brand_covers";
  storage_object_name: string;
  alt_text?: string | null;
  sort_order: number;
  is_cover: boolean;
  status: "pending" | "ready" | "failed";
}

export interface StayUnitRecord {
  id: string;
  name: string;
  external_reference?: string | null;
  status: "active" | "paused" | "archived";
  version: number;
}

export interface StayRoomNightRecord {
  id: string;
  local_date: string;
  sellable_quantity: number;
  price_override_minor?: number | null;
  currency_code?: string | null;
  stop_sell: boolean;
  minimum_nights: number;
  maximum_nights?: number | null;
  version: number;
}

export interface StayPlaceScheduleRuleRecord {
  id: string;
  mode: "fixed_slots" | "repeating_windows" | "full_day";
  timezone: string;
  local_start_date: string;
  local_end_date?: string | null;
  weekdays: number[];
  local_start_time?: string | null;
  local_end_time?: string | null;
  slot_duration_minutes?: number | null;
  slot_interval_minutes?: number | null;
  full_day_start_time?: string | null;
  full_day_end_time?: string | null;
  active: boolean;
  version: number;
}

export interface StayPlaceWindowRecord {
  id: string;
  local_date: string;
  starts_at: string;
  ends_at: string;
  sellable_units?: number | null;
  sellable_capacity?: number | null;
  price_override_minor?: number | null;
  currency_code?: string | null;
  stop_sell: boolean;
  version: number;
}

export interface StayBulkJobResult {
  job: {
    id: string;
    status: "running" | "completed" | "completed_with_errors" | "failed";
    requested_count: number;
    succeeded_count: number;
    failed_count: number;
  };
  items: Record<string, unknown>[];
  replayed: boolean;
}

export interface StayCurrencyReconciliationInput {
  reconciliationId: string;
  decision: "convert" | "reenter" | "accept_no_ranges";
  fxSnapshotId?: string | null;
  ranges?: Record<string, unknown>[];
  stayItems?: Record<string, unknown>[];
}
