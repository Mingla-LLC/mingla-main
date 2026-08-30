/* eslint-disable import/first -- Persistence, focus, auth, and service boundaries must be mocked before the hook import. */
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

let resolveHydration: ((value: string | null) => void) | null = null;
let focusCallback: (() => void | (() => void)) | null = null;
let focusCleanup: (() => void) | null = null;
let currentUser: { id: string } | null = { id: "user-a" };
const record = jest.fn();
const storageSetItem = jest.fn((_key: string, _value: string) =>
  Promise.resolve(),
);

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(
    () =>
      new Promise<string | null>((resolve) => {
        resolveHydration = resolve;
      }),
  ),
  setItem: (key: string, value: string) => storageSetItem(key, value),
  removeItem: jest.fn(() => Promise.resolve()),
  multiSet: jest.fn(() => Promise.resolve()),
  multiRemove: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    jest.requireActual("react").useEffect(() => {
      focusCallback = callback;
      const cleanup = callback();
      focusCleanup = typeof cleanup === "function" ? cleanup : null;
      return () => focusCleanup?.();
    }, [callback]);
  },
}));
jest.mock("@tanstack/react-query", () => ({
  QueryClientContext: jest.requireActual("react").createContext(null),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useQuery: jest.fn(),
  useQueries: jest.fn(),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: currentUser, isAuthReady: true }),
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
    recordBusinessRecentOpen: (...args: unknown[]) => record(...args),
  };
});

import { useSuccessfulBusinessRecentOpen } from "../useBusinessRecent";
import {
  recentScopeKey,
  useBusinessRecentStore,
} from "../../store/businessRecentStore";

function Host(): null {
  useSuccessfulBusinessRecentOpen({
    brandId: "brand-a",
    entityType: "event",
    entityId: "27940000-0000-4000-8000-000000000002",
    ready: true,
    title: "New session open",
    status: "scheduled",
  });
  return null;
}

test("deferred cold-start hydration merges persisted scopes before one fenced open", async () => {
  record.mockResolvedValue({
    acceptedOpenedAt: "2026-08-29T12:00:00.000Z",
    retained: true,
  });
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<Host />);
    await Promise.resolve();
  });
  expect(record).not.toHaveBeenCalled();

  await act(async () => {
    focusCleanup?.();
    currentUser = { id: "user-b" };
    tree.update(<Host />);
    resolveHydration?.(
      JSON.stringify({
        state: {
          scopes: {
            [recentScopeKey("user-b", "brand-a")]: [
              {
                entityType: "venue",
                entityId: "27940000-0000-4000-8000-000000000001",
                lastOpenedAt: "2026-08-29T10:00:00.000Z",
                operationId: "27940000-0000-4000-8000-000000000010",
                pendingSync: false,
                localDraft: false,
              },
            ],
          },
        },
        version: 1,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(record).not.toHaveBeenCalled();

  await act(async () => {
    const cleanup = focusCallback?.();
    focusCleanup = typeof cleanup === "function" ? cleanup : null;
    await Promise.resolve();
  });
  expect(record).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({ brandId: "brand-a" }),
  );
  expect(
    useBusinessRecentStore.getState().scopes[
      recentScopeKey("user-b", "brand-a")
    ]?.map((pointer) => pointer.entityId),
  ).toEqual([
    "27940000-0000-4000-8000-000000000002",
    "27940000-0000-4000-8000-000000000001",
  ]);
  expect(
    useBusinessRecentStore.getState().scopes[
      recentScopeKey("user-a", "brand-a")
    ],
  ).toBeUndefined();
  expect(storageSetItem).toHaveBeenCalled();
  tree.unmount();
});
