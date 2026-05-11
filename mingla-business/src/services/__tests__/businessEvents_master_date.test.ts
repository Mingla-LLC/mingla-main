// ORCH-0792: businessEvents.ts sources event dates from event_dates via
// master_* columns on the view, not from theme.business_event.when JSON.
//
// These tests exercise the publish RPC adapter using fixtures that mirror
// the new RPC response shape (with eventDates array). They verify:
//   • Single-date publish: master row in eventDates → LiveEvent.date /
//     doorsOpen / endsAt populated from the timestamp, not from
//     theme.business_event.when.
//   • Recurring publish: master row in eventDates with first occurrence;
//     LiveEvent.date matches the master row.
//   • Multi-date publish: master row is the chronologically-earliest;
//     LiveEvent.date / doorsOpen / endsAt source from that row.
//   • Missing master row (transitional safety): LiveEvent.date is null
//     rather than fabricated from theme JSON.

import { describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>();

jest.mock("../supabase", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { publishBusinessEventDraft } from "../businessEvents";
import type { DraftEvent } from "../../store/draftEventStore";

const baseDraft = (
  overrides: Partial<DraftEvent> = {},
): DraftEvent => ({
  id: "00000000-0000-4000-8000-000000000001",
  brandId: "00000000-0000-4000-8000-000000000002",
  serverSlug: "draft-test",
  name: "Sunset Rooftop Social",
  description: "An evening on the rooftop.",
  format: "in_person",
  category: null,
  whenMode: "single",
  date: "2026-06-12",
  doorsOpen: "19:00",
  endsAt: "23:00",
  timezone: "America/New_York",
  recurrenceRule: null,
  multiDates: null,
  venueName: "Skyline Lounge",
  address: "100 High St",
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  currency: "USD",
  tickets: [
    {
      id: "t-1",
      name: "General Admission",
      description: null,
      priceGbp: 25,
      currency: "USD",
      isFree: false,
      isUnlimited: false,
      capacity: 100,
      visibility: "public",
      displayOrder: 0,
      approvalRequired: false,
      passwordProtected: false,
      password: null,
      allowTransfers: true,
      availableAt: "online",
      saleStartAt: null,
      saleEndAt: null,
      minPurchaseQty: 1,
      maxPurchaseQty: null,
      waitlistEnabled: false,
    },
  ],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  lastStepReached: 7,
  status: "draft",
  clientRevision: 1,
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z",
  ...overrides,
});

const baseEventRow = () => ({
  id: "00000000-0000-4000-8000-000000000001",
  brand_id: "00000000-0000-4000-8000-000000000002",
  created_by: "00000000-0000-4000-8000-000000000003",
  title: "Sunset Rooftop Social",
  description: "An evening on the rooftop.",
  slug: "sunset-rooftop-social",
  location_text: "Skyline Lounge",
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  cover_media_provider: null,
  cover_media_source_url: null,
  cover_media_credit: null,
  cover_media_credit_url: null,
  cover_media_alt: null,
  currency: "USD",
  visibility: "public",
  status: "scheduled",
  published_at: "2026-05-11T00:00:00.000Z",
  timezone: "America/New_York",
  created_at: "2026-05-11T00:00:00.000Z",
  updated_at: "2026-05-11T00:00:00.000Z",
  theme: {
    coverHue: 25,
    business_event: {
      format: "in_person",
      requestedVisibility: "public",
      coverHue: 25,
      whenMode: "single",
      // ORCH-0792 transition: theme.business_event.when JSON may still be
      // present (for back-compat). The adapter MUST ignore it post-publish
      // and source dates from eventDates / master_* instead.
      when: {
        date: "STALE-DATE-IGNORE",
        doorsOpen: "STALE-DOORS-IGNORE",
        endsAt: "STALE-ENDS-IGNORE",
        timezone: "Europe/London",
      },
      location: { venueName: "Skyline Lounge", address: "100 High St" },
      settings: {},
    },
  },
});

const baseTicketRow = () => ({
  id: "00000000-0000-4000-8000-000000000004",
  event_id: "00000000-0000-4000-8000-000000000001",
  name: "General Admission",
  description: null,
  price_cents: 2500,
  currency: "USD",
  quantity_total: 100,
  is_unlimited: false,
  is_free: false,
  sale_start_at: null,
  sale_end_at: null,
  min_purchase_qty: 1,
  max_purchase_qty: null,
  is_hidden: false,
  is_disabled: false,
  requires_approval: false,
  allow_transfers: true,
  password_protected: false,
  available_online: true,
  available_in_person: false,
  waitlist_enabled: false,
  display_order: 0,
});

describe("ORCH-0792 publish RPC adapter sources dates from event_dates", () => {
  test("single-date publish: LiveEvent.date / doorsOpen / endsAt come from master_start_at + master_end_at, not theme.when", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        event: baseEventRow(),
        brand: { id: "brand-1", slug: "skyline", name: "Skyline" },
        tickets: [baseTicketRow()],
        eventDates: [
          {
            id: "ed-1",
            event_id: "00000000-0000-4000-8000-000000000001",
            // 2026-06-12 19:00 America/New_York = 2026-06-12T23:00:00Z (EDT, UTC-4)
            start_at: "2026-06-12T23:00:00.000Z",
            end_at: "2026-06-13T03:00:00.000Z",
            timezone: "America/New_York",
            is_master: true,
          },
        ],
        client_revision: 1,
      },
      error: null,
    });

    const published = await publishBusinessEventDraft(baseDraft());
    expect(published.event.date).toBe("2026-06-12");
    expect(published.event.doorsOpen).toBe("19:00");
    expect(published.event.endsAt).toBe("23:00");
    expect(published.event.timezone).toBe("America/New_York");
    // Critical: NOT picking up the stale theme.when values.
    expect(published.event.date).not.toBe("STALE-DATE-IGNORE");
    expect(published.event.doorsOpen).not.toBe("STALE-DOORS-IGNORE");
  });

  test("multi-date publish: master row (is_master=true) is the chronologically-earliest and seeds date/doorsOpen/endsAt", async () => {
    const multiRow = baseEventRow();
    multiRow.is_multi_date = true;
    rpcMock.mockResolvedValueOnce({
      data: {
        event: multiRow,
        brand: { id: "brand-1", slug: "skyline", name: "Skyline" },
        tickets: [baseTicketRow()],
        eventDates: [
          // Three dates returned in arbitrary order; master should still
          // be the earliest (2026-06-12).
          {
            id: "ed-3",
            event_id: "00000000-0000-4000-8000-000000000001",
            start_at: "2026-06-26T23:00:00.000Z",
            end_at: "2026-06-27T03:00:00.000Z",
            timezone: "America/New_York",
            is_master: false,
          },
          {
            id: "ed-1",
            event_id: "00000000-0000-4000-8000-000000000001",
            start_at: "2026-06-12T23:00:00.000Z",
            end_at: "2026-06-13T03:00:00.000Z",
            timezone: "America/New_York",
            is_master: true,
          },
          {
            id: "ed-2",
            event_id: "00000000-0000-4000-8000-000000000001",
            start_at: "2026-06-19T23:00:00.000Z",
            end_at: "2026-06-20T03:00:00.000Z",
            timezone: "America/New_York",
            is_master: false,
          },
        ],
        client_revision: 1,
      },
      error: null,
    });

    const published = await publishBusinessEventDraft(
      baseDraft({ whenMode: "multi_date" }),
    );
    expect(published.event.date).toBe("2026-06-12");
    expect(published.event.doorsOpen).toBe("19:00");
    expect(published.event.endsAt).toBe("23:00");
  });

  test("recurring publish: master row encodes first occurrence; LiveEvent.date matches the master start_at", async () => {
    const recurringRow = baseEventRow();
    recurringRow.is_recurring = true;
    rpcMock.mockResolvedValueOnce({
      data: {
        event: recurringRow,
        brand: { id: "brand-1", slug: "skyline", name: "Skyline" },
        tickets: [baseTicketRow()],
        eventDates: [
          {
            id: "ed-1",
            event_id: "00000000-0000-4000-8000-000000000001",
            start_at: "2026-06-12T23:00:00.000Z",
            end_at: "2026-06-13T03:00:00.000Z",
            timezone: "America/New_York",
            is_master: true,
          },
        ],
        client_revision: 1,
      },
      error: null,
    });

    const published = await publishBusinessEventDraft(
      baseDraft({ whenMode: "recurring" }),
    );
    expect(published.event.date).toBe("2026-06-12");
    expect(published.event.timezone).toBe("America/New_York");
  });

  test("safety: when eventDates is missing/empty in response, LiveEvent.date falls to null rather than fabricating from stale theme JSON", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        event: baseEventRow(),
        brand: { id: "brand-1", slug: "skyline", name: "Skyline" },
        tickets: [baseTicketRow()],
        eventDates: [],
        client_revision: 1,
      },
      error: null,
    });

    const published = await publishBusinessEventDraft(baseDraft());
    expect(published.event.date).toBeNull();
    expect(published.event.doorsOpen).toBeNull();
    expect(published.event.endsAt).toBeNull();
    // Must NOT have fabricated a value from theme.business_event.when.
    expect(published.event.date).not.toBe("STALE-DATE-IGNORE");
  });
});
