/* eslint-disable import/first -- Router and service boundaries must be mocked before importing the hook. */
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

const record = jest.fn();

jest.mock("expo-router", () => ({ useFocusEffect: undefined }));
jest.mock("@tanstack/react-query", () => ({
  QueryClientContext: jest.requireActual("react").createContext(null),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
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
import { useBusinessRecentStore } from "../../store/businessRecentStore";

function Host(): null {
  useSuccessfulBusinessRecentOpen({
    brandId: "brand-a",
    entityType: "venue",
    entityId: "27940000-0000-4000-8000-000000000001",
    ready: true,
    title: "Loaded venue",
    status: "published",
  });
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  useBusinessRecentStore.getState().reset();
  record.mockResolvedValue({
    acceptedOpenedAt: "2026-08-29T12:00:00.000Z",
    retained: true,
  });
});

test("a router without focus capability records once on mount and cleans up on unmount", async () => {
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<Host />);
    await Promise.resolve();
  });
  expect(record).toHaveBeenCalledTimes(1);

  await act(async () => {
    tree.update(<Host />);
    await Promise.resolve();
  });
  expect(record).toHaveBeenCalledTimes(1);

  await act(async () => tree.unmount());
  expect(record).toHaveBeenCalledTimes(1);
});
