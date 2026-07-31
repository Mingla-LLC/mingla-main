import type { StayOfferingRecord } from "../../../types/stayInventory";
import {
  matchesStayInventoryFilter,
  stayOfferingReadinessErrors,
} from "../stayInventoryPresentation";

const readyRoom = (
  override: Partial<StayOfferingRecord> = {},
): StayOfferingRecord => ({
  id: "room-1",
  kind: "room",
  name: "Lagoon suite",
  description: "Private waterfront suite",
  confirmation_mode: "instant",
  inventory_basis: "pooled_units",
  unit_naming_mode: "interchangeable",
  quantity: 2,
  min_guests: 1,
  max_guests: 2,
  access_scope: "public",
  status: "draft",
  version: 1,
  currentPrice: {
    id: "price-1",
    amount_minor: 250_000,
    currency_code: "NGN",
    pricing_unit: "room_night",
    version_number: 1,
  },
  currentPolicy: {
    id: "policy-1",
    cancellation_policy: "48 hours",
    free_cancel_cutoff_minutes: 2880,
    late_refund_basis_points: 0,
    no_show_refund_basis_points: 0,
    operator_cancel_refund_basis_points: 10000,
    version_number: 1,
  },
  media: [
    {
      id: "media-1",
      storage_bucket_id: "brand_covers",
      storage_object_name: "brand-1/stays/venue-1/room.jpg",
      sort_order: 0,
      is_cover: true,
      status: "ready",
    },
  ],
  hasOpenAvailability: true,
  ...override,
});

describe("Issue #1425 inventory presentation", () => {
  it("reports every actionable readiness gap and never treats named units as pooled", () => {
    expect(
      stayOfferingReadinessErrors(
        readyRoom({
          description: "",
          media: [],
          currentPrice: null,
          currentPolicy: null,
          hasOpenAvailability: false,
          unit_naming_mode: "named",
          quantity: 2,
          units: [
            {
              id: "unit-1",
              name: "101",
              status: "active",
              version: 1,
            },
          ],
        }),
      ),
    ).toEqual([
      "Add a description",
      "Add a cover photo",
      "Set a price",
      "Add cancellation and no-show rules",
      "Open future availability",
      "Name every private unit",
    ]);
    expect(stayOfferingReadinessErrors(readyRoom())).toEqual([]);
  });

  it("keeps Room, Place, status and search filters independent", () => {
    const room = readyRoom();
    const place = readyRoom({
      id: "place-1",
      kind: "place",
      name: "Pool cabana",
      status: "paused",
      inventory_basis: "shared_capacity",
      capacity: 10,
    });
    expect(
      matchesStayInventoryFilter({
        offering: room,
        filter: "room",
        search: "",
      }),
    ).toBe(true);
    expect(
      matchesStayInventoryFilter({
        offering: place,
        filter: "room",
        search: "",
      }),
    ).toBe(false);
    expect(
      matchesStayInventoryFilter({
        offering: place,
        filter: "paused",
        search: "cab",
      }),
    ).toBe(true);
    expect(
      matchesStayInventoryFilter({
        offering: room,
        filter: "all",
        search: "cab",
      }),
    ).toBe(false);
  });
});
