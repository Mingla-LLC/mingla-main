import {
  isStaySettingsComplete,
  isStaySettingsFormValid,
} from "../staySettingsReadiness";
import type { StaySettingsRecord } from "../../../types/stayInventory";

const settings = (
  overrides: Partial<StaySettingsRecord> = {},
): StaySettingsRecord => ({
  venue_id: "00000000-1424-4000-8000-000000000001",
  brand_id: "00000000-1424-4000-8000-000000000002",
  property_kind: null,
  summary: "A complete Stay with an optional property type.",
  amenities: [],
  accessibility_features: [],
  arrival_instructions: null,
  timezone: "Africa/Lagos",
  default_booking_mode: "request",
  check_in_time: "15:00:00",
  check_out_time: "11:00:00",
  instant_payment_hold_minutes: 15,
  request_response_hours: 24,
  approved_payment_minutes: 30,
  booking_horizon_days: 365,
  booking_state: "review",
  house_rules: null,
  version: 1,
  ...overrides,
});

describe("Issue #1424 Stay business authoring", () => {
  test("a complete Stay remains ready when property kind is not selected", () => {
    expect(isStaySettingsComplete(settings())).toBe(true);
    expect(
      isStaySettingsFormValid({
        summary: "A complete Stay with no descriptive property type.",
        timezone: "Africa/Lagos",
        checkIn: "15:00",
        checkOut: "11:00",
      }),
    ).toBe(true);
  });

  test("real readiness requirements still block incomplete Stay settings", () => {
    expect(isStaySettingsComplete(null)).toBe(false);
    expect(isStaySettingsComplete(settings({ summary: "Too short" }))).toBe(
      false,
    );
    expect(isStaySettingsComplete(settings({ timezone: "" }))).toBe(false);
    expect(
      isStaySettingsFormValid({
        summary: "A complete Stay with valid descriptive information.",
        timezone: "Africa/Lagos",
        checkIn: "15:00",
        checkOut: "15:00",
      }),
    ).toBe(false);
  });
});
