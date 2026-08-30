/* eslint-disable import/first -- Query, focus, and cache boundaries must be controlled before importing the hooks. */
import React from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

const mockInvalidate = jest.fn(() => Promise.resolve());
const mockIndexRefetch = jest.fn(() => Promise.resolve());
const mockPageRefetch = jest.fn(() => Promise.resolve());
const mockRecord = jest.fn();
const mockClearCache = jest.fn((scope: string) => {
  const actual = jest.requireActual(
    "../../services/businessRecentService",
  ) as typeof import("../../services/businessRecentService");
  return actual.clearBusinessRecentCachedScope(scope);
});
let mockIndexResult: any;
let mockPageResults: any[];

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual("react").useEffect(callback, [callback]),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  useQuery: () => mockIndexResult,
  useQueries: () => mockPageResults,
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
    recordBusinessRecentOpen: (...args: unknown[]) => mockRecord(...args),
    clearBusinessRecentCachedScope: (scope: string) => mockClearCache(scope),
  };
});

import {
  useBusinessRecent,
  useSuccessfulBusinessRecentOpen,
} from "../useBusinessRecent";
import {
  loadBusinessRecentCache,
  saveBusinessRecentCache,
} from "../../services/businessRecentService";
import {
  recentScopeKey,
  useBusinessRecentStore,
  type BusinessRecentPointer,
} from "../../store/businessRecentStore";

const scope = recentScopeKey("user-a", "brand-a");
let latestRecent: ReturnType<typeof useBusinessRecent> | null = null;

const pointer = (id: string): BusinessRecentPointer => ({
  entityType: "event",
  entityId: id,
  lastOpenedAt: "2026-08-29T12:00:00.000Z",
  operationId: `op-${id}`,
  title: "Private launch plan",
  coverUrl: "https://private.invalid/cover.jpg",
  pendingSync: false,
  localDraft: false,
});

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

function RecentHost(): null {
  latestRecent = useBusinessRecent({ brandId: "brand-a", pageCount: 1 });
  return null;
}

function OpenHost(): null {
  useSuccessfulBusinessRecentOpen({
    brandId: "brand-a",
    entityType: "event",
    entityId: "27940000-0000-4000-8000-000000000003",
    ready: true,
    title: "Private launch plan",
    coverUrl: "https://private.invalid/cover.jpg",
    status: "scheduled",
  });
  return null;
}

const settleEffects = async (): Promise<void> => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useBusinessRecentStore.getState().reset();
  latestRecent = null;
  mockIndexResult = {
    data: [],
    error: null,
    isSuccess: true,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: mockIndexRefetch,
  };
  mockPageResults = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => {
    return { remove: jest.fn() } as never;
  });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("offline replay brand denial clears Zustand and serialized presentation cache", async () => {
  const sensitive = pointer("pending-sensitive");
  await saveBusinessRecentCache(scope, [sensitive]);
  useBusinessRecentStore.getState().upsert(scope, {
    ...sensitive,
    pendingSync: true,
  });
  mockRecord.mockRejectedValue(new Error("recent_brand_forbidden"));

  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<RecentHost />);
  });
  await settleEffects();

  expect(mockClearCache).toHaveBeenCalledWith(scope);
  await mockClearCache.mock.results.at(-1)?.value;
  expect(useBusinessRecentStore.getState().scopes[scope]).toBeUndefined();
  expect(await loadBusinessRecentCache(scope)).toEqual([]);
  tree.unmount();
});

test("direct-open brand denial clears Zustand and serialized presentation cache while Recent is unmounted", async () => {
  await saveBusinessRecentCache(scope, [pointer("prior-sensitive")]);
  mockRecord.mockRejectedValue(new Error("recent_brand_forbidden"));

  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<OpenHost />);
  });
  await settleEffects();

  expect(mockClearCache).toHaveBeenCalledWith(scope);
  await mockClearCache.mock.results.at(-1)?.value;
  expect(useBusinessRecentStore.getState().scopes[scope]).toBeUndefined();
  expect(await loadBusinessRecentCache(scope)).toEqual([]);
  tree.unmount();
});

test("cached first-page refresh error keeps retry but never reports a later-page failure", async () => {
  const cached = pointer("first-page-cached");
  mockIndexResult = {
    ...mockIndexResult,
    data: [indexRow(cached.entityId)],
  };
  mockPageResults = [
    {
      data: { rows: [cached], omitted: 0 },
      error: new Error("first page refresh failed"),
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: true,
      refetch: mockPageRefetch,
    },
  ];

  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<RecentHost />);
  });
  await settleEffects();

  expect(latestRecent?.state).toBe("error-cached");
  expect(latestRecent?.hasPageError).toBe(false);
  await act(async () => {
    await latestRecent?.retry();
  });
  expect(mockPageRefetch).toHaveBeenCalledTimes(1);
  tree.unmount();
});
