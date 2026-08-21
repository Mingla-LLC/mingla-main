import { readFileSync } from "fs";
import path from "path";
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

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";
const PUBLISHED_ID = "3014ea7e-f3e0-40d0-b112-a51f4e37e964";
const CROSS_BRAND_LIVE_ID = "00000000-0000-4000-8000-000000000010";
const UNMATCHED_ID = "00000000-0000-4000-8000-000000000011";

const serverDraft = (brandId: string, id: string): DraftEvent => ({
  ...buildDraftEvent(brandId, id, "2026-08-21T12:00:00.000Z"),
  serverSlug: `draft-${id}`,
  name: id,
});

describe("issue #2396 — Hub stale published-draft reconciliation", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    useDraftEventStore.getState().reset();
    queryClient = new QueryClient();
  });

  test("only the exact same-brand server-backed live ID is removed from persistence and cache", () => {
    const stale = serverDraft(BRAND_A, PUBLISHED_ID);
    const localOnly = buildDraftEvent(
      BRAND_A,
      "d_local-only",
      "2026-08-21T12:00:01.000Z",
    );
    const crossBrand = serverDraft(BRAND_B, CROSS_BRAND_LIVE_ID);
    const unmatched = serverDraft(BRAND_A, UNMATCHED_ID);
    const allDrafts = [stale, localOnly, crossBrand, unmatched];

    useDraftEventStore.getState().upsertDrafts(allDrafts);
    queryClient.setQueryData(eventDraftKeys.list(BRAND_A), [
      stale,
      localOnly,
      unmatched,
    ]);
    queryClient.setQueryData(eventDraftKeys.detail(PUBLISHED_ID), stale);

    const removed = reconcilePublishedEventDrafts(
      queryClient,
      BRAND_A,
      [{ id: PUBLISHED_ID }, { id: CROSS_BRAND_LIVE_ID }],
      useDraftEventStore.getState().drafts,
      useDraftEventStore.getState().deleteDraft,
    );

    expect(removed).toEqual([PUBLISHED_ID]);
    expect(useDraftEventStore.getState().getDraft(PUBLISHED_ID)).toBeNull();
    expect(useDraftEventStore.getState().getDraft(localOnly.id)).not.toBeNull();
    expect(useDraftEventStore.getState().getDraft(CROSS_BRAND_LIVE_ID)).not.toBeNull();
    expect(useDraftEventStore.getState().getDraft(UNMATCHED_ID)).not.toBeNull();
    expect(queryClient.getQueryData(eventDraftKeys.detail(PUBLISHED_ID))).toBeUndefined();
    expect(
      queryClient
        .getQueryData<DraftEvent[]>(eventDraftKeys.list(BRAND_A))
        ?.map((draft) => draft.id),
    ).toEqual([localOnly.id, UNMATCHED_ID]);
  });

  test("the Hub runs reconciliation only from the authoritative business-event result", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/(tabs)/hub/events.tsx"),
      "utf8",
    );

    expect(source).toContain("useReconcilePublishedEventDrafts(");
    expect(source).toContain("businessEventsQuery.data,");
  });
});
