import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The runtime is already a test dependency; this repository intentionally
// does not carry the optional @types/react-test-renderer package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const mockIsFollowing = jest.fn();
const mockFollowBrand = jest.fn();
const mockUnfollowBrand = jest.fn();

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("../../services/brandFollowsService", () => ({
  brandFollowsService: {
    isFollowing: mockIsFollowing,
    followBrand: mockFollowBrand,
    unfollowBrand: mockUnfollowBrand,
  },
}));

import { brandFollowKeys, useBrandFollow } from "../useBrandFollow";

const userId = "10000000-0000-4000-8000-000000000001";
const brandId = "20000000-0000-4000-8000-000000000002";

describe("#3682 buyer follower count optimistic updates", () => {
  let client: QueryClient;
  let latest: ReturnType<typeof useBrandFollow>;
  let tree: { unmount(): void } | null;

  function Probe(): null {
    latest = useBrandFollow(userId, brandId);
    return null;
  }

  beforeEach(async () => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    tree = null;
    mockIsFollowing.mockReset().mockResolvedValue(false);
    mockFollowBrand.mockReset();
    mockUnfollowBrand.mockReset();
    await act(async () => {
      tree = TestRenderer.create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
      await Promise.resolve();
    });
    client.setQueryData(brandFollowKeys.followerCount(brandId), 1204);
    client.setQueryData(brandFollowKeys.followerCounts([brandId]), {
      [brandId]: 1204,
    });
  });

  afterEach(() => {
    act(() => tree?.unmount());
    client.clear();
  });

  test("increments before success and invalidates both count caches", async () => {
    let resolve!: () => void;
    mockFollowBrand.mockImplementation(
      () => new Promise<void>((done) => { resolve = done; }),
    );
    let result!: Promise<void>;
    await act(async () => {
      result = latest.follow();
      await Promise.resolve();
    });
    expect(client.getQueryData(brandFollowKeys.followerCount(brandId))).toBe(1205);
    await act(async () => {
      resolve();
      await result;
    });
    expect(
      client.getQueryState(brandFollowKeys.followerCount(brandId))?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(brandFollowKeys.followerCounts([brandId]))?.isInvalidated,
    ).toBe(true);
  });

  test("rolls back after server failure", async () => {
    mockFollowBrand.mockRejectedValue(new Error("forced"));
    await act(async () => {
      await expect(latest.follow()).rejects.toThrow("forced");
    });
    expect(client.getQueryData(brandFollowKeys.followerCount(brandId))).toBe(1204);
  });

  test("never decrements below zero and restores zero after a failed unfollow", async () => {
    await act(async () => {
      client.setQueryData(brandFollowKeys.status(brandId, userId), true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    client.setQueryData(brandFollowKeys.followerCount(brandId), 0);
    mockUnfollowBrand.mockRejectedValue(new Error("forced"));
    expect(latest.isFollowing).toBe(true);
    await act(async () => {
      await expect(latest.unfollow()).rejects.toThrow("forced");
    });

    expect(client.getQueryData(brandFollowKeys.followerCount(brandId))).toBe(0);
  });
});
