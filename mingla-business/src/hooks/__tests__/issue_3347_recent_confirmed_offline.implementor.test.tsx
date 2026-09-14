/* eslint-disable import/first -- network, auth, focus and service boundaries must be mocked before the hook import. */
/**
 * issue #3347 — Business Home said "You're offline" after a cold launch while
 * the internet worked, until the app was relaunched.
 *
 * Root cause: Recent treated the device network status (`isConnected === false`)
 * as proof, disabled its own server reads, and so nothing could ever disprove a
 * wrong status. On iOS that status can start wrong after a cold boot and never
 * update (see `utils/recentOfflineConfirmation.ts`).
 *
 * OFFLINE IS SIMULATED IN CODE. The network hint is injected through the
 * `netinfoSafe` seam and a connection failure is a rejected service call. No
 * machine or simulator network is touched (never toggle host networking).
 *
 * WHAT IS REAL. `useBusinessRecent` (the Home reader) running on the REAL
 * `@tanstack/react-query` with the app's own QueryClient defaults; the real
 * Recent store. Injected: the network hint, auth, focus, analytics, and the two
 * server reads (index + page hydration), whose outcome is the state under test.
 *
 * FAILS ON REVERT (each mutation run against this file, see the PR):
 *   - the hint alone decides offline again           → C-1, C-5
 *   - reads disabled while the hint says offline     → C-1, C-2, C-5
 *   - no re-read when the hint changes               → C-3
 *   - retries kept while the hint says offline       → C-2
 *   - refresh gated on offline again                 → C-5
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): {
    update(element: React.ReactElement): void;
    unmount(): void;
  };
  act(callback: () => void | Promise<void>): Promise<void>;
};
const act = TestRenderer.act;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mockNetwork: { isConnected: boolean | null; isInternetReachable: boolean | null } | null = {
  isConnected: true,
  isInternetReachable: true,
};
const mockListIndex = jest.fn();
const mockHydrate = jest.fn();

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    jest.requireActual("react").useEffect(callback, [callback]);
  },
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-3347" }, isAuthReady: true }),
}));
jest.mock("../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => mockNetwork,
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../services/businessRecentService", () => {
  const actual = jest.requireActual("../../services/businessRecentService");
  return {
    ...actual,
    listBusinessRecentIndex: (...args: unknown[]) => mockListIndex(...args),
    hydrateBusinessRecent: (...args: unknown[]) => mockHydrate(...args),
    loadBusinessRecentCache: () => Promise.resolve([]),
    saveBusinessRecentCache: () => Promise.resolve(),
  };
});

import { useBusinessRecent } from "../useBusinessRecent";
import { useBusinessRecentStore } from "../../store/businessRecentStore";
import {
  isRecentOfflineConfirmed,
  recentOfflineHint,
} from "../../utils/recentOfflineConfirmation";

/** What React Native's fetch throws when there is genuinely no connection. */
const connectionFailure = (): Error =>
  new Error("TypeError: Network request failed");

let latestState = "";
let latestRefresh: (() => Promise<void>) | null = null;
const Host = (): null => {
  const recent = useBusinessRecent({ brandId: "brand-3347" });
  latestState = recent.state;
  latestRefresh = recent.refresh;
  return null;
};

/** Mirrors the app's QueryClient defaults (retry twice, 1s then 2s). */
const makeClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        retry: (failureCount) => failureCount < 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        refetchOnWindowFocus: false,
      },
    },
  });

const settle = async (rounds = 12): Promise<void> => {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const waitForState = async (
  wanted: string,
  timeoutMs = 1500,
): Promise<void> => {
  const started = Date.now();
  while (latestState !== wanted && Date.now() - started < timeoutMs) {
    await settle(1);
  }
};

let client: QueryClient;
let tree: { update(e: React.ReactElement): void; unmount(): void } | null = null;
const mount = async (): Promise<void> => {
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Host />
      </QueryClientProvider>,
    );
  });
  await settle();
};
const rerender = async (): Promise<void> => {
  await act(async () => {
    tree?.update(
      <QueryClientProvider client={client}>
        <Host />
      </QueryClientProvider>,
    );
  });
  await settle();
};

beforeEach(() => {
  jest.clearAllMocks();
  client = makeClient();
  latestState = "";
  latestRefresh = null;
  mockNetwork = { isConnected: true, isInternetReachable: true };
  useBusinessRecentStore.getState().reset();
  mockListIndex.mockResolvedValue([]);
  mockHydrate.mockResolvedValue({ pointers: [], omitted: [] });
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = null;
  client.clear();
});

describe("#3347 R — the confirmation rule", () => {
  test("R-1 a hint alone is not offline; a hint plus a connection failure is", () => {
    expect(isRecentOfflineConfirmed({ isConnected: false }, null)).toBe(false);
    expect(isRecentOfflineConfirmed({ isConnected: false }, "network")).toBe(true);
  });

  test("R-2 other failures, an online hint, or an unknown status never confirm", () => {
    expect(isRecentOfflineConfirmed({ isConnected: false }, "unknown")).toBe(false);
    expect(isRecentOfflineConfirmed({ isConnected: false }, "permission")).toBe(false);
    expect(isRecentOfflineConfirmed({ isConnected: true }, "network")).toBe(false);
    expect(isRecentOfflineConfirmed({ isConnected: null }, "network")).toBe(false);
    // #1758 — a binary without the native module reports null: assume online.
    expect(isRecentOfflineConfirmed(null, "network")).toBe(false);
    expect(recentOfflineHint(null)).toBe(false);
  });
});

describe("#3347 C — Recent on Home under a wrong or a right offline status", () => {
  test("C-1 THE BUG: status says offline after a cold launch, server answers → no offline banner", async () => {
    mockNetwork = { isConnected: false, isInternetReachable: false };
    await mount();
    await waitForState("empty");
    expect(mockListIndex).toHaveBeenCalled();
    expect(latestState).toBe("empty");
    expect(latestState.startsWith("offline")).toBe(false);
  });

  test("C-2 genuinely offline: status says offline and the read fails → offline, promptly", async () => {
    mockNetwork = { isConnected: false, isInternetReachable: false };
    mockListIndex.mockRejectedValue(connectionFailure());
    await mount();
    // No 1s + 2s retry wait: one failed attempt confirms it. With retries the
    // last attempt lands at ~3s, so this window and the call count both fail.
    await waitForState("offline-empty", 2500);
    expect(latestState).toBe("offline-empty");
    expect(mockListIndex).toHaveBeenCalledTimes(1);
  });

  test("C-3 the status changing either way asks the server again", async () => {
    mockNetwork = { isConnected: false, isInternetReachable: false };
    mockListIndex.mockRejectedValue(connectionFailure());
    await mount();
    await waitForState("offline-empty", 2500);
    const callsWhileOffline = mockListIndex.mock.calls.length;

    // Reconnect: the status flips and the server now answers.
    mockListIndex.mockResolvedValue([]);
    mockNetwork = { isConnected: true, isInternetReachable: true };
    await rerender();
    await waitForState("empty");
    expect(mockListIndex.mock.calls.length).toBeGreaterThan(callsWhileOffline);
    expect(latestState).toBe("empty");
  });

  test("C-4 a connection failure while the status says online stays an error, not offline", async () => {
    mockNetwork = { isConnected: true, isInternetReachable: true };
    mockListIndex.mockRejectedValue(connectionFailure());
    await mount();
    await waitForState("error-empty", 5000);
    expect(latestState).toBe("error-empty");
  });

  test("C-5 refresh is never blocked by an offline state, so a stale one can clear", async () => {
    mockNetwork = { isConnected: false, isInternetReachable: false };
    mockListIndex.mockRejectedValue(connectionFailure());
    await mount();
    await waitForState("offline-empty", 2500);
    const before = mockListIndex.mock.calls.length;
    mockListIndex.mockResolvedValue([]);
    await act(async () => {
      await latestRefresh?.();
    });
    await waitForState("empty");
    expect(mockListIndex.mock.calls.length).toBeGreaterThan(before);
    expect(latestState).toBe("empty");
  });
});
