import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("../../utils/liveEventConverter", () => ({
  __esModule: true,
  convertDraftToLiveEvent: () => null,
}));

jest.mock("../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true }),
}));

jest.mock("../../services/eventDrafts", () => ({
  __esModule: true,
  autosaveServerDraft: jest.fn(),
  createServerDraft: jest.fn(),
  discardServerDraft: jest.fn(),
  fetchDraftById: jest.fn(),
  fetchDraftsForBrand: jest.fn(),
  isServerDraftLifecycleError: () => false,
}));

// Jest module factories must be registered before the hook/store imports.
// eslint-disable-next-line import/first
import {
  eventDraftKeys,
  reconcilePublishedEventDrafts,
} from "../useServerDraftEvents";
// eslint-disable-next-line import/first
import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../store/draftEventStore";

const BRAND_ID = "ca6926ad-6dd7-4e3e-871d-3168d9031179";
const LIVE_EVENT_ID = "3014ea7e-f3e0-40d0-b112-a51f4e37e964";

describe("issue #2396 tester — persisted UUID draft reconciliation", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    useDraftEventStore.getState().reset();
    queryClient = new QueryClient();
  });

  test("a matching same-brand UUID draft is retired even when legacy persistence left serverSlug null", () => {
    const staleUuidDraft: DraftEvent = {
      ...buildDraftEvent(
        BRAND_ID,
        LIVE_EVENT_ID,
        "2026-08-21T12:00:00.000Z",
      ),
      serverSlug: null,
      name: "We Go Again Exhibition",
    };

    useDraftEventStore.getState().upsertDraft(staleUuidDraft);
    queryClient.setQueryData(eventDraftKeys.list(BRAND_ID), [staleUuidDraft]);
    queryClient.setQueryData(
      eventDraftKeys.detail(LIVE_EVENT_ID),
      staleUuidDraft,
    );

    const removed = reconcilePublishedEventDrafts(
      queryClient,
      BRAND_ID,
      [{ id: LIVE_EVENT_ID }],
      useDraftEventStore.getState().drafts,
      useDraftEventStore.getState().deleteDraft,
    );

    expect(removed).toEqual([LIVE_EVENT_ID]);
    expect(useDraftEventStore.getState().getDraft(LIVE_EVENT_ID)).toBeNull();
    expect(
      queryClient.getQueryData(eventDraftKeys.detail(LIVE_EVENT_ID)),
    ).toBeUndefined();
    expect(queryClient.getQueryData(eventDraftKeys.list(BRAND_ID))).toEqual([]);
  });
});
