/* eslint-disable import/first -- Hook dependencies must be mocked before the subject is imported. */
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

let user: { id: string } | null = { id: "user-a" };
let online = true;
const record = jest.fn();
const invalidate = jest.fn();

jest.mock("../../components/trip/TripDetailHeroStatusPill", () => ({
  deriveTripLifecycleStatus: (input: { status: string }) => input.status,
}));

jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    jest.requireActual("react").useEffect(effect, [effect]),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
  useQuery: () => ({
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user, isAuthReady: user !== null }),
}));
jest.mock("../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => ({ isConnected: online }),
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

function Host(props: { ready: boolean; title: string }): null {
  useSuccessfulBusinessRecentOpen({
    brandId: "brand-a",
    entityType: "event",
    entityId: "27940000-0000-4000-8000-000000000001",
    ready: props.ready,
    title: props.title,
    status: "live",
  });
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  user = { id: "user-a" };
  online = true;
  useBusinessRecentStore.getState().reset();
  record.mockResolvedValue({
    acceptedOpenedAt: "2026-08-29T12:00:00.000Z",
    retained: true,
  });
});

test("one focus waits for ready and records exactly once across rerenders", async () => {
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<Host ready={false} title="loading" />);
  });
  expect(record).not.toHaveBeenCalled();
  await act(async () => {
    tree!.update(<Host ready title="Loaded" />);
  });
  await act(async () => {
    tree!.update(<Host ready title="Changed status/title" />);
  });
  expect(record).toHaveBeenCalledTimes(1);
});

test("late record response cannot repopulate a reset namespace", async () => {
  let resolve!: (value: {
    acceptedOpenedAt: string;
    retained: boolean;
  }) => void;
  record.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => {
    TestRenderer.create(<Host ready title="Loaded" />);
  });
  useBusinessRecentStore.getState().reset();
  user = null;
  await act(async () => {
    resolve({ acceptedOpenedAt: "2026-08-29T12:00:00.000Z", retained: true });
    await Promise.resolve();
  });
  expect(useBusinessRecentStore.getState().scopes).toEqual({});
});
