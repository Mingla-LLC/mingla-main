/* eslint-disable import/first -- Query/AppState boundaries must be controlled before importing the hook. */
import React from "react";
import { AppState, type AppStateStatus } from "react-native";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

const invalidate = jest.fn(() => Promise.resolve());
const indexRefetch = jest.fn(() => Promise.resolve());
const pageRefetch = jest.fn(() => Promise.resolve());
const loadCache = jest.fn((_scope: string) => Promise.resolve([]));
const saveCache = jest.fn(
  (_scope: string, _pointers: BusinessRecentPointer[]) => Promise.resolve(),
);
let appStateListener: ((state: AppStateStatus) => void) | null = null;
let indexResult: any;
let pageResults: any[];

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual("react").useEffect(callback, [callback]),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useQuery: () => indexResult,
  useQueries: () => pageResults,
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-a" }, isAuthReady: true }),
}));
jest.mock("../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => ({ isConnected: true }),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../services/businessRecentService", () => {
  const actual = jest.requireActual("../../services/businessRecentService");
  return {
    ...actual,
    loadBusinessRecentCache: (scope: string) => loadCache(scope),
    saveBusinessRecentCache: (
      scope: string,
      pointers: BusinessRecentPointer[],
    ) => saveCache(scope, pointers),
    removeBusinessRecentPresentationCache: jest.fn(() => Promise.resolve()),
    clearBusinessRecentCachedScope: jest.fn(() => Promise.resolve()),
    subscribeBusinessRecentPresentation: jest.fn(() => () => undefined),
  };
});

import { useBusinessRecent } from "../useBusinessRecent";
import {
  recentScopeKey,
  useBusinessRecentStore,
  type BusinessRecentPointer,
} from "../../store/businessRecentStore";

let latest: ReturnType<typeof useBusinessRecent> | null = null;

const indexRow = (id: string) => ({
  pointerId: `p-${id}`,
  entityType: "event" as const,
  entityId: id,
  lastOpenedAt: "2026-08-29T12:00:00.000Z",
  lifecycleStatus: "upcoming",
  rawStatus: "scheduled",
  startsAt: "2026-08-30T12:00:00.000Z",
  endsAt: null,
  endedAt: null,
});

const pointer = (
  id: string,
  overrides: Partial<BusinessRecentPointer> = {},
): BusinessRecentPointer => ({
  entityType: "event",
  entityId: id,
  lastOpenedAt: "2026-08-29T12:00:00.000Z",
  operationId: `op-${id}`,
  pendingSync: false,
  localDraft: false,
  ...overrides,
});

function Host({ pageCount = 1 }: { pageCount?: number }): null {
  latest = useBusinessRecent({ brandId: "brand-a", pageCount });
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  latest = null;
  appStateListener = null;
  useBusinessRecentStore.getState().reset();
  indexResult = {
    data: [],
    error: null,
    isSuccess: true,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: indexRefetch,
  };
  pageResults = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("first authoritative index hydration remains loading instead of flashing empty", async () => {
  indexResult = { ...indexResult, data: [indexRow("first")] };
  pageResults = [
    {
      data: undefined,
      error: null,
      isLoading: true,
      isPending: true,
      isFetching: true,
      isError: false,
      refetch: pageRefetch,
    },
  ];
  await act(async () => {
    TestRenderer.create(<Host />);
    await Promise.resolve();
  });
  expect(latest?.state).toBe("loading");
  expect(latest?.rows).toEqual([]);
});

test("successful index reconciliation removes settled stale queue state but preserves pending/local drafts", async () => {
  const scope = recentScopeKey("user-a", "brand-a");
  useBusinessRecentStore.getState().upsert(scope, pointer("revoked"));
  useBusinessRecentStore
    .getState()
    .upsert(scope, pointer("pending", { pendingSync: true }));
  useBusinessRecentStore
    .getState()
    .upsert(scope, pointer("d_local", { localDraft: true }));
  await act(async () => {
    TestRenderer.create(<Host />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(latest?.rows.map((row) => row.entityId)).toEqual([
    "pending",
    "d_local",
  ]);
  expect(
    useBusinessRecentStore.getState().scopes[scope]?.map((row) => row.entityId),
  ).toEqual(["pending", "d_local"]);
  expect(saveCache).toHaveBeenCalledWith(scope, []);
});

test("cached later-page failure exposes a real retry and truthful loading-more flags", async () => {
  const rows = Array.from({ length: 26 }, (_, index) => indexRow(String(index)));
  indexResult = { ...indexResult, data: rows };
  useBusinessRecentStore.getState().upsert(
    recentScopeKey("user-a", "brand-a"),
    pointer("0", { pendingSync: true }),
  );
  pageResults = [
    {
      data: { rows: [pointer("0")], omitted: 0 },
      error: null,
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(() => Promise.resolve()),
    },
    {
      data: undefined,
      error: new Error("later page failed"),
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: true,
      refetch: pageRefetch,
    },
  ];
  await act(async () => {
    TestRenderer.create(<Host pageCount={2} />);
    await Promise.resolve();
  });
  expect(latest?.state).toBe("error-cached");
  expect(latest?.hasPageError).toBe(true);
  expect(latest?.isLoadingMore).toBe(false);
  await act(async () => {
    await latest?.retry();
  });
  expect(pageRefetch).toHaveBeenCalledTimes(1);

  pageResults[1] = {
    ...pageResults[1],
    error: null,
    isError: false,
    isLoading: true,
    isFetching: true,
  };
  await act(async () => {
    TestRenderer.create(<Host pageCount={2} />);
  });
  expect(latest?.isLoadingMore).toBe(true);
});

test("background to active refreshes both Recent query families", async () => {
  await act(async () => {
    TestRenderer.create(<Host />);
    await Promise.resolve();
  });
  invalidate.mockClear();
  await act(async () => {
    appStateListener?.("background");
    appStateListener?.("active");
    await Promise.resolve();
  });
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["business-recent-index", "user-a", "brand-a"],
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["business-recent-page", "user-a", "brand-a"],
  });
});
