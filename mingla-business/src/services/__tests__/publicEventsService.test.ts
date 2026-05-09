import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: {},
}));

import { publicEventViewRowToEvent } from "../publicEventsService";
import type { TicketStub } from "../../store/draftEventStore";

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-1",
  name: "General",
  priceGbp: null,
  capacity: null,
  isFree: true,
  isUnlimited: true,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "online",
  ...patch,
});

const row = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "event-1",
  brand_id: "brand-1",
  brand_slug: "test-stripe",
  brand_name: "Test Stripe",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: true,
  title: "Great Free Event",
  description: "A real public event.",
  slug: "great-free-event",
  location_text: "Fallback venue",
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2026-05-08T18:30:00.000Z",
  timezone: "Europe/London",
  created_at: "2026-05-08T18:00:00.000Z",
  updated_at: "2026-05-08T18:30:00.000Z",
  public_theme: {
    coverHue: 25,
    business_event: {
      format: "in_person",
      category: "music",
      whenMode: "single",
      when: {
        date: "2026-05-08",
        doorsOpen: "21:00",
        endsAt: "23:30",
        timezone: "Europe/Paris",
      },
      location: {
        venueName: "The Good Room",
        address: "1 Good Street",
      },
      settings: {
        requireApproval: true,
        allowTransfers: false,
        hideRemainingCount: true,
        passwordProtected: true,
        privateGuestList: true,
        inPersonPaymentsEnabled: true,
      },
    },
  },
  ...patch,
});

describe("public event view mapper", () => {
  test("maps runtime business_event.when into buyer-facing event dates", () => {
    const event = publicEventViewRowToEvent(row() as never, [ticket()]);

    expect(event).toMatchObject({
      date: "2026-05-08",
      doorsOpen: "21:00",
      endsAt: "23:30",
      timezone: "Europe/Paris",
      format: "in_person",
      category: "music",
      venueName: "The Good Room",
      address: "1 Good Street",
      requireApproval: true,
      allowTransfers: false,
      hideRemainingCount: true,
      passwordProtected: true,
      privateGuestList: true,
      inPersonPaymentsEnabled: true,
    });
  });

  test("brand cards and checkout details receive the same mapped date shape", () => {
    const brandEvent = publicEventViewRowToEvent(row() as never, [ticket()]);
    const checkoutEvent = publicEventViewRowToEvent(row() as never, [ticket()]);

    expect(brandEvent.date).toBe("2026-05-08");
    expect(brandEvent.doorsOpen).toBe("21:00");
    expect(checkoutEvent.date).toBe(brandEvent.date);
    expect(checkoutEvent.doorsOpen).toBe(brandEvent.doorsOpen);
  });

  test("preserves recurring and multi-date payloads", () => {
    const recurringRule = {
      frequency: "weekly",
      interval: 1,
      count: 4,
      byWeekday: ["FR"],
    };
    const multiDates = [
      { id: "date-1", date: "2026-05-08", startTime: "21:00" },
      { id: "date-2", date: "2026-05-09", startTime: "20:00" },
    ];

    const event = publicEventViewRowToEvent(
      row({
        is_recurring: true,
        is_multi_date: true,
        public_theme: {
          business_event: {
            whenMode: "multi_date",
            when: { date: "2026-05-08", timezone: "Europe/London" },
            recurrenceRule: recurringRule,
            multiDates,
          },
        },
      }) as never,
      [ticket()],
    );

    expect(event.whenMode).toBe("multi_date");
    expect(event.recurrenceRule).toEqual(recurringRule);
    expect(event.multiDates).toEqual(multiDates);
  });

  test("keeps Date TBD when the saved public payload lacks a valid date", () => {
    const event = publicEventViewRowToEvent(
      row({
        public_theme: {
          business_event: {
            whenMode: "single",
            when: { date: "not-a-date" },
          },
        },
      }) as never,
      [ticket()],
    );

    expect(event.date).toBeNull();
  });
});
