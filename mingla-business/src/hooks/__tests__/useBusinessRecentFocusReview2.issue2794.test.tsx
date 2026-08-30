/* eslint-disable import/first -- Focus and service boundaries must be mocked before importing the hook. */
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

let focusCallback: (() => void | (() => void)) | null = null;
let focusCleanup: (() => void) | null = null;
const record = jest.fn();
const invalidate = jest.fn(() => Promise.resolve());

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
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useQuery: jest.fn(),
  useQueries: jest.fn(),
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
    entityId: "27940000-0000-4000-8000-000000000001",
    ready: true,
    title: "Loaded",
    status: "scheduled",
  });
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  focusCallback = null;
  focusCleanup = null;
  useBusinessRecentStore.getState().reset();
  record.mockResolvedValue({
    acceptedOpenedAt: "2026-08-29T12:00:00.000Z",
    retained: true,
  });
});

test("a true blur then refocus records exactly one new successful open", async () => {
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<Host />);
    await Promise.resolve();
  });
  expect(record).toHaveBeenCalledTimes(1);

  await act(async () => {
    focusCleanup?.();
    focusCleanup = null;
  });
  await act(async () => {
    const cleanup = focusCallback?.();
    focusCleanup = typeof cleanup === "function" ? cleanup : null;
    await Promise.resolve();
  });
  expect(record).toHaveBeenCalledTimes(2);
  tree.unmount();
});

test("recent_entity_forbidden evicts only the optimistic target", async () => {
  const scope = recentScopeKey("user-a", "brand-a");
  useBusinessRecentStore.getState().upsert(scope, {
    entityType: "venue",
    entityId: "other-authorized",
    lastOpenedAt: "2026-08-29T11:00:00.000Z",
    operationId: "other-op",
    pendingSync: false,
    localDraft: false,
  });
  record.mockRejectedValue(new Error("recent_entity_forbidden"));
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<Host />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(
    useBusinessRecentStore.getState().scopes[scope]?.map((row) => row.entityId),
  ).toEqual(["other-authorized"]);
  tree.unmount();
});
