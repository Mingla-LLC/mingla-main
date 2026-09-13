import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";

let auth = { isAuthReady: true, user: { id: "u1" } as { id: string } | null };
let flag = { data: true, isPending: false, isFetching: false, isError: false };
const list = jest.fn<(...args: unknown[]) => Promise<unknown>>();
let listener: ((state: AppStateStatus) => void) | null = null;
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => auth }));
jest.mock("../../useFeatureFlag", () => ({ useFeatureFlag: () => flag }));
jest.mock("../../../services/brandCircleReachService", () => {
  class E extends Error { constructor(public code: string, public retryable: boolean) { super(code); } }
  return { BrandCircleReachError: E, listBrandCircleReach: (...args: unknown[]) => list(...args) };
});
import { BrandCircleReachError } from "../../../services/brandCircleReachService";
import { marketingKeys } from "../marketingKeys";
import { useBrandCircleReach } from "../useBrandCircleReach";

const TR = require("react-test-renderer") as { create: (node: React.ReactElement) => { unmount: () => void }; act: (fn: () => void | Promise<void>) => void | Promise<void> };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ready = { schemaVersion: 1, state: "ready", snapshotVersion: 1, counts: { followers: 1, extended: 0, total: 1 }, availability: { followers: { state: "ready", reason: null, refreshedAt: "2099-01-01", expiresAt: "2099-01-02" }, extended: { state: "ready", reason: null, refreshedAt: "2099-01-01", expiresAt: "2099-01-02" } }, rows: [{ memberId: "m", ring: "follower", displayName: "Amina", avatarUrl: null, reasonCode: "follows_brand", reasonLabel: "Follows your brand." }], nextCursor: null };
let client: QueryClient;
let tree: { unmount: () => void } | null;
let latest: ReturnType<typeof useBrandCircleReach>;
function Probe({ brand = "b" }: { brand?: string }): null { latest = useBrandCircleReach(brand, "all", true, true, 20, true); return null; }
const flush = async (): Promise<void> => { await TR.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };

beforeEach(() => {
  auth = { isAuthReady: true, user: { id: "u1" } }; flag = { data: true, isPending: false, isFetching: false, isError: false }; list.mockReset(); listener = null;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, next) => { listener = next; return { remove: jest.fn() } as never; });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); tree = null;
});
afterEach(() => { if (tree) TR.act(() => tree?.unmount()); tree = null; client.clear(); jest.restoreAllMocks(); });

describe("#1777 tester adversarial hook lifecycle", () => {
  test("permission loss purges the exact brand/ring cache before a frame can reuse it", async () => {
    list.mockResolvedValueOnce(ready);
    TR.act(() => { tree = TR.create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); }); await flush();
    expect(latest.rows).toHaveLength(1);
    TR.act(() => { listener?.("background"); });
    expect(latest.rows).toEqual([]); expect(latest.counts).toBeUndefined();
    expect(client.getQueryData(marketingKeys.people.circle("b", "all"))).toBeUndefined();
  });

  test("non-retryable forbidden and cursor-stale errors do not retry as transient failures", async () => {
    list.mockRejectedValueOnce(new BrandCircleReachError("circle_forbidden", false));
    TR.act(() => { tree = TR.create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); }); await flush();
    expect(list).toHaveBeenCalledTimes(1); expect(latest.kind).toBe("forbidden"); expect(latest.rows).toEqual([]);
    TR.act(() => tree?.unmount()); tree = null; client.clear();
    list.mockClear();
    list.mockImplementation(() => Promise.reject(new BrandCircleReachError("circle_cursor_stale", true)));
    TR.act(() => { tree = TR.create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); }); await flush();
    expect(list).toHaveBeenCalledTimes(2); expect(latest.rows).toEqual([]); expect(latest.counts).toBeUndefined();
    expect(latest.currentPage).toBeUndefined(); expect(latest.safeAvailability).toBeUndefined(); expect(latest.hasCurrentTruth).toBe(false);
    await flush(); expect(list).toHaveBeenCalledTimes(2); expect(latest.kind).toBe("unavailable");
  });

  test("changing brand removes the previous brand cache and cannot flash its rows", async () => {
    list.mockResolvedValueOnce(ready);
    TR.act(() => { tree = TR.create(<QueryClientProvider client={client}><Probe brand="brand-a" /></QueryClientProvider>); }); await flush();
    expect(latest.rows[0].displayName).toBe("Amina");
    TR.act(() => { (tree as unknown as { update: (node: React.ReactElement) => void }).update(<QueryClientProvider client={client}><Probe brand="brand-b" /></QueryClientProvider>); });
    expect(latest.rows).toEqual([]); expect(client.getQueryData(marketingKeys.people.circle("brand-a", "all"))).toBeUndefined();
  });
});
