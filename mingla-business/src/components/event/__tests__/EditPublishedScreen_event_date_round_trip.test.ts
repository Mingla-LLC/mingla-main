import fs from "node:fs";
import path from "node:path";

import { QueryClient } from "@tanstack/react-query";

import type { BusinessEventDetail } from "../../../services/businessEvents";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { UpdateLiveEventResult } from "../../../store/liveEventStore";
import {
  LOCAL_SAVE_REJECTED_TOAST,
  surfaceLocalSaveRejection,
} from "../../../utils/localSaveRejectionSignal";
import { refreshPublishedEventWhenAfterSave } from "../../../utils/publishedEventWhenRefresh";

jest.mock("../../../services/businessEvents", () => ({
  fetchBusinessEventById: jest.fn(),
}));

jest.mock("../../../hooks/useBusinessEvents", () => ({
  businessEventKeys: {
    detail: (eventId: string) => ["business-events", "detail", eventId],
    list: (brandId: string) => ["business-events", "list", brandId],
  },
}));

const businessEventKeys = {
  detail: (eventId: string): readonly ["business-events", "detail", string] => [
    "business-events",
    "detail",
    eventId,
  ],
  list: (brandId: string): readonly ["business-events", "list", string] => [
    "business-events",
    "list",
    brandId,
  ],
};

const SCREEN_PATH = path.resolve(
  __dirname,
  "..",
  "EditPublishedScreen.tsx",
);

const liveEvent = (date: string): LiveEvent =>
  ({
    id: "event-1",
    serverEventId: "event-1",
    brandId: "brand-1",
    brandSlug: "leggo-this",
    eventSlug: "runtime-share-test",
    status: "scheduled",
    publishedAt: "2026-01-01T00:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "event",
    name: "Runtime Share Test",
    description: "QA event",
    format: "in_person",
    category: null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    city: "Raleigh",
    locationGeo: { lat: 35.7796, lng: -78.6382 },
    whenMode: "single",
    date,
    doorsOpen: "17:00",
    endsAt: "23:00",
    masterStartAtUtc: `${date}T22:00:00.000Z`,
    masterEndAtUtc: `${date}T04:00:00.000Z`,
    timezone: "America/New_York",
    recurrenceRule: null,
    multiDates: null,
    venueName: "The Venue",
    address: "700 Corporate Center Dr, Raleigh, NC 27607, USA",
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    currency: "USD",
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    orders: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as LiveEvent;

const detail = (event: LiveEvent): BusinessEventDetail =>
  ({
    event,
    brand: {
      id: event.brandId,
      slug: event.brandSlug,
      displayName: "Leggo This",
      address: null,
      coverHue: 25,
      role: "owner",
      stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
      currentLiveEvent: null,
    },
    tickets: [],
  }) as BusinessEventDetail;

describe("ORCH-0980 Step 0.5 — published event date save round-trip", () => {
  test("When RPC success is followed by canonical detail refresh before local success flow", () => {
    const src = fs.readFileSync(SCREEN_PATH, "utf8");
    const rpcIndex = src.indexOf("await patchPublishedEventWhen({");
    const refreshIndex = src.indexOf("await refreshPublishedEventWhenAfterSave({");
    const localStoreIndex = src.indexOf("const result = updateLiveEventFields(");

    expect(rpcIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(rpcIndex);
    expect(refreshIndex).toBeLessThan(localStoreIndex);
  });

  test("canonical server read replaces the stale date in detail and list caches", async () => {
    const queryClient = new QueryClient();
    const oldEvent = liveEvent("2026-11-09");
    const newEvent = liveEvent("2026-11-11");

    queryClient.setQueryData(
      businessEventKeys.detail(oldEvent.id),
      detail(oldEvent),
    );
    queryClient.setQueryData(businessEventKeys.list(oldEvent.brandId), [
      oldEvent,
    ]);

    await refreshPublishedEventWhenAfterSave({
      queryClient,
      eventId: oldEvent.id,
      brandId: oldEvent.brandId,
      fetchDetail: async () => detail(newEvent),
    });

    const cachedDetail = queryClient.getQueryData<BusinessEventDetail>(
      businessEventKeys.detail(oldEvent.id),
    );
    const cachedList = queryClient.getQueryData<LiveEvent[]>(
      businessEventKeys.list(oldEvent.brandId),
    );

    expect(cachedDetail?.event.date).toBe("2026-11-11");
    expect(cachedList?.[0]?.date).toBe("2026-11-11");
  });

  it("fires a toast when updateLiveEventFields rejects after the save chain falls through", () => {
    const rejected: Extract<UpdateLiveEventResult, { ok: false }> = {
      ok: false,
      reason: "multi_date_remove_with_sales",
      droppedDates: ["2026-11-09"],
      affectedOrderCount: 1,
    };
    const dialog = {
      title: "Refund first",
      body: "Refund before removing this date.",
      primaryLabel: "Open Orders",
      primaryAction: jest.fn(),
    };
    const showToast = jest.fn();
    const buildDialog = jest.fn(() => dialog);
    const setDialog = jest.fn();

    surfaceLocalSaveRejection(rejected, showToast, buildDialog, setDialog);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(LOCAL_SAVE_REJECTED_TOAST);
    expect(buildDialog).toHaveBeenCalledWith(rejected);
    expect(setDialog).toHaveBeenCalledWith(dialog);
  });
});
