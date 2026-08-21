import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>();
const fromMock = jest.fn<(table: string) => unknown>();
const invokeMock = jest.fn(() => Promise.resolve({ data: null, error: null }));

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => fromMock(table),
    functions: { invoke: invokeMock },
  },
}));

// Jest module factories must be registered before these service imports.
// eslint-disable-next-line import/first
import {
  cancelBusinessEvent,
  endBusinessEventTicketSales,
  eventFromPublishResponse,
  fetchBusinessEventById,
  publishBusinessEventDraft,
  type PublishRpcResponse,
} from "../businessEvents";
// eslint-disable-next-line import/first
import { publishRsvpDraft } from "../rsvpEvents";
// eslint-disable-next-line import/first
import type { DraftEvent } from "../../store/draftEventStore";

const EVENT_ID = "3014ea7e-f3e0-40d0-b112-a51f4e37e964";
const BRAND_ID = "ca6926ad-6dd7-4e3e-871d-3168d9031179";

const freeResponse = (
  status: "scheduled" | "cancelled" | "ended" = "scheduled",
): PublishRpcResponse => ({
  event: {
    id: EVENT_ID,
    brand_id: BRAND_ID,
    created_by: "00000000-0000-4000-8000-000000000003",
    title: "We Go Again Exhibition",
    description: "A two-day free exhibition.",
    slug: "we-go-again-exhibition",
    location_text: "Didi Museum",
    online_url: null,
    is_online: false,
    is_recurring: false,
    is_multi_date: true,
    recurrence_rules: null,
    cover_media_url: null,
    cover_media_type: null,
    currency: null,
    visibility: "public",
    status,
    published_at: "2026-08-21T12:27:02.000Z",
    timezone: "Africa/Lagos",
    created_at: "2026-08-21T11:00:00.000Z",
    updated_at: "2026-08-21T12:27:02.000Z",
    theme: {
      business_event: {
        format: "in_person",
        whenMode: "multi_date",
        location: { venueName: "Didi Museum", address: "Lagos" },
        settings: {},
      },
    },
    city: "Lagos",
  },
  brand: {
    id: BRAND_ID,
    slug: "wegoagainexhibition",
    name: "We Go Again Exhibition",
  },
  tickets: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      event_id: EVENT_ID,
      name: "Free admission",
      description: null,
      price_cents: 0,
      currency: null,
      quantity_total: 600,
      is_unlimited: false,
      is_free: true,
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
    },
  ],
  eventDates: [
    {
      id: "00000000-0000-4000-8000-000000000005",
      event_id: EVENT_ID,
      start_at: "2026-08-29T09:00:00.000Z",
      end_at: "2026-08-30T17:00:00.000Z",
      timezone: "Africa/Lagos",
      is_master: true,
    },
  ],
  client_revision: 7,
});

const freeDraft = (isRsvp = false): DraftEvent => ({
  id: EVENT_ID,
  brandId: BRAND_ID,
  serverSlug: "draft-we-go-again",
  name: "We Go Again Exhibition",
  description: "A two-day free exhibition.",
  format: "in_person",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  whenMode: "multi_date",
  date: null,
  doorsOpen: null,
  endsAt: null,
  endsAtUtc: null,
  timezone: "Africa/Lagos",
  recurrenceRule: null,
  multiDates: [],
  multiDatePricingMode: "per_day",
  venueName: "Didi Museum",
  address: "Lagos",
  city: "Lagos",
  locationGeo: null,
  coordinatePrecision: null,
  onlineUrl: null,
  hideAddressUntilTicket: true,
  coverHue: 25,
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
  coverGallery: [],
  currency: null,
  tickets: isRsvp
    ? []
    : [
        {
          id: "free-ticket",
          name: "Free admission",
          priceGbp: null,
          capacity: 600,
          isFree: true,
          isUnlimited: false,
          visibility: "public",
          displayOrder: 0,
          approvalRequired: false,
          passwordProtected: false,
          password: null,
          waitlistEnabled: false,
          minPurchaseQty: 1,
          maxPurchaseQty: null,
          allowTransfers: true,
          description: null,
          saleStartAt: null,
          saleEndAt: null,
          availableAt: "online",
        },
      ],
  visibility: "public",
  requireApproval: false,
  allowTransfers: true,
  hideRemainingCount: false,
  passwordProtected: false,
  themeOverrides: null,
  privateGuestList: false,
  inPersonPaymentsEnabled: false,
  isRsvp,
  rsvpCapacity: null,
  rsvpAllowPlusOnes: false,
  rsvpPlusOnesMax: 0,
  rsvpWaitlistEnabled: false,
  rsvpApprovalMode: "auto",
  rsvpDiscoverable: false,
  rsvpContributionEnabled: false,
  rsvpContributionSuggestedCents: null,
  rsvpContributionMinCents: null,
  lastStepReached: 6,
  status: "draft",
  clientRevision: 7,
  createdAt: "2026-08-21T11:00:00.000Z",
  updatedAt: "2026-08-21T12:00:00.000Z",
});

const managementRow = () => {
  const response = freeResponse();
  return {
    ...response.event,
    brand_slug: response.brand.slug,
    brand_name: response.brand.name,
    brand_profile_photo_url: null,
    brand_display_attendee_count: false,
    title: response.event.title,
    slug: response.event.slug,
    management_theme: response.event.theme,
    show_on_discover: true,
    master_start_at: response.eventDates?.[0]?.start_at ?? null,
    master_end_at: response.eventDates?.[0]?.end_at ?? null,
    master_timezone: "Africa/Lagos",
    master_event_date_id: response.eventDates?.[0]?.id ?? null,
  };
};

describe("issue #2396 — null-currency free event client contract", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    invokeMock.mockClear();
  });

  test("a free publish response maps successfully without fabricating currency", () => {
    const published = eventFromPublishResponse(freeResponse());

    expect(published.event.currency).toBeUndefined();
    expect(published.tickets[0]?.currency).toBeUndefined();
    expect(published.event.status).toBe("scheduled");
  });

  test("standard and RSVP publish return successfully after their committed RPCs", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: freeResponse(), error: null })
      .mockResolvedValueOnce({ data: freeResponse(), error: null });

    await expect(publishBusinessEventDraft(freeDraft())).resolves.toMatchObject({
      event: { id: EVENT_ID, currency: undefined },
    });
    await expect(publishRsvpDraft(freeDraft(true))).resolves.toMatchObject({
      event: { id: EVENT_ID, currency: undefined },
    });
  });

  test("cancel and end-sales lifecycle consumers accept a free null-currency response", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: freeResponse("cancelled"), error: null })
      .mockResolvedValueOnce({ data: freeResponse("ended"), error: null });

    await expect(cancelBusinessEvent(EVENT_ID)).resolves.toMatchObject({
      event: { status: "cancelled", currency: undefined },
    });
    await expect(endBusinessEventTicketSales(EVENT_ID)).resolves.toMatchObject({
      event: { status: "ended", currency: undefined },
    });
  });

  test("a malformed paid response still fails closed when no ISO currency source exists", () => {
    const response = freeResponse();
    response.tickets[0] = {
      ...response.tickets[0],
      price_cents: 2500,
      is_free: false,
      currency: null,
    };

    expect(() => eventFromPublishResponse(response)).toThrow(
      "event_currency_required",
    );
  });

  test("the published-detail mapper hydrates a free null-currency event for editing", async () => {
    fromMock.mockImplementation((table) => {
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: EVENT_ID,
                    event_type: "event",
                    pass_tax: null,
                    pass_mingla_fee: null,
                    pass_service_fee: null,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "business_management_events_view") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: managementRow(), error: null }),
            }),
          }),
        };
      }
      if (table === "ticket_types") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () =>
                  Promise.resolve({ data: freeResponse().tickets, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(fetchBusinessEventById(EVENT_ID)).resolves.toMatchObject({
      event: { id: EVENT_ID, currency: undefined },
    });
  });
});
