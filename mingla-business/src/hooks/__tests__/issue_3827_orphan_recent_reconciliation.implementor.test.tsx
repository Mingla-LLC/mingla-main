/* eslint-disable import/first -- Query/cache boundaries are installed before the reader import. */
import React from "react";
import { AppState } from "react-native";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

const invalidate = jest.fn(() => Promise.resolve());
const saveCache = jest.fn((_scope: string, _rows: BusinessRecentPointer[]) =>
  Promise.resolve(),
);
const removeCache = jest.fn(
  (
    _scope: string,
    _entityType: BusinessRecentPointer["entityType"],
    _entityId: string,
  ) => Promise.resolve(),
);
let cachedRows: BusinessRecentPointer[] = [];
let latest: ReturnType<typeof useBusinessRecent> | null = null;

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual("react").useEffect(callback, [callback]),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useQuery: () => ({
    data: [],
    error: null,
    isSuccess: true,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: jest.fn(() => Promise.resolve()),
  }),
  useQueries: () => [],
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-3827" }, isAuthReady: true }),
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
    loadBusinessRecentCache: () => Promise.resolve(cachedRows),
    saveBusinessRecentCache: (scope: string, rows: BusinessRecentPointer[]) =>
      saveCache(scope, rows),
    removeBusinessRecentPresentationCache: (
      scope: string,
      entityType: BusinessRecentPointer["entityType"],
      entityId: string,
    ) => removeCache(scope, entityType, entityId),
    subscribeBusinessRecentPresentation: () => () => undefined,
  };
});

import { useBusinessRecent } from "../useBusinessRecentReader";
import {
  recentScopeKey,
  useBusinessRecentStore,
  type BusinessRecentPointer,
} from "../../store/businessRecentStoreCore";

const scope = recentScopeKey("user-3827", "brand-3827");
const pointer = (entityId: string): BusinessRecentPointer => ({
  entityType: entityId === "d_valid" ? "rsvp" : "event",
  entityId,
  lastOpenedAt: "2026-10-15T12:00:00.000Z",
  operationId: `op-${entityId}`,
  title: entityId === "d_valid" ? "Restorable draft" : "Title unavailable",
  status: "draft",
  destination: "edit",
  pendingSync: false,
  localDraft: true,
});

function Host({ keys }: { keys: ReadonlySet<string> | null }): null {
  latest = useBusinessRecent({
    brandId: "brand-3827",
    restorableLocalDraftKeys: keys,
  });
  return null;
}

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  latest = null;
  cachedRows = [pointer("d_orphan"), pointer("d_valid")];
  useBusinessRecentStore.getState().reset();
  for (const row of cachedRows) {
    useBusinessRecentStore.getState().upsert(scope, row);
  }
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => {
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("Home never paints an unverified local card, then keeps only the restorable draft", async () => {
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<Host keys={null} />);
  });
  await settle();
  expect(latest?.rows).toEqual([]);
  expect(latest?.state).toBe("loading");

  await act(async () => {
    tree.update(<Host keys={new Set(["rsvp:d_valid"])} />);
  });
  await settle();

  expect(latest?.rows.map((row) => row.entityId)).toEqual(["d_valid"]);
  expect(
    useBusinessRecentStore.getState().scopes[scope]?.map((row) => row.entityId),
  ).toEqual(["d_valid"]);
  expect(removeCache).toHaveBeenCalledWith(scope, "event", "d_orphan");
  expect(saveCache).toHaveBeenCalledWith(
    scope,
    expect.arrayContaining([expect.objectContaining({ entityId: "d_valid" })]),
  );
  tree.unmount();
});
