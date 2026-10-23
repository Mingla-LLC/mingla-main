import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

const mockGetFollowStatus = jest.fn();
const mockFollowBrand = jest.fn();
const mockUnfollowBrand = jest.fn();

jest.doMock("../../services/brandFollowsService", () => ({
  brandFollowIsMuted: () => false,
  brandFollowsService: {
    getFollowStatus: mockGetFollowStatus,
    followBrand: mockFollowBrand,
    unfollowBrand: mockUnfollowBrand,
    muteBrand: jest.fn(),
    unmuteBrand: jest.fn(),
  },
}));

const { brandFollowKeys, useBrandFollow } =
  require("../useBrandFollow") as typeof import("../useBrandFollow");

const userId = "36820000-0000-4000-8000-000000000201";
const brandId = "36820000-0000-4000-8000-000000000202";

describe("#3682 consumer follower-count optimism", () => {
  let client: QueryClient;
  let latest: ReturnType<typeof useBrandFollow>;
  let tree: import("react-test-renderer").ReactTestRenderer | null;

  function Probe(): null {
    latest = useBrandFollow(userId, brandId);
    return null;
  }

  beforeEach(async () => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    tree = null;
    mockGetFollowStatus.mockReset().mockResolvedValue({
      following: false,
      mutedUntil: null,
    });
    mockFollowBrand.mockReset();
    mockUnfollowBrand.mockReset();
    await TestRenderer.act(async () => {
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
    TestRenderer.act(() => tree?.unmount());
    client.clear();
  });

  test("increments before success and invalidates scalar and batch count caches", async () => {
    let resolve!: () => void;
    mockFollowBrand.mockImplementation(
      () => new Promise<void>((done) => { resolve = done; }),
    );

    let result!: Promise<void>;
    await TestRenderer.act(async () => {
      result = latest.follow();
      await Promise.resolve();
    });
    expect(client.getQueryData(brandFollowKeys.followerCount(brandId))).toBe(1205);

    await TestRenderer.act(async () => {
      resolve();
      await result;
    });
    expect(
      client.getQueryState(brandFollowKeys.followerCount(brandId))?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(brandFollowKeys.followerCounts([brandId]))
        ?.isInvalidated,
    ).toBe(true);
  });

  test("restores the exact server count after a failed follow", async () => {
    mockFollowBrand.mockRejectedValue(new Error("forced"));
    await TestRenderer.act(async () => {
      await expect(latest.follow()).rejects.toThrow("forced");
    });
    expect(client.getQueryData(brandFollowKeys.followerCount(brandId))).toBe(1204);
  });

  test("never decrements below zero and restores zero after a failed unfollow", async () => {
    await TestRenderer.act(async () => {
      client.setQueryData(brandFollowKeys.status(brandId, userId), {
        following: true,
        mutedUntil: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    client.setQueryData(brandFollowKeys.followerCount(brandId), 0);
    mockUnfollowBrand.mockRejectedValue(new Error("forced"));
    expect(latest.isFollowing).toBe(true);
    await TestRenderer.act(async () => {
      await expect(latest.unfollow()).rejects.toThrow("forced");
    });

    expect(client.getQueryData(brandFollowKeys.followerCount(brandId))).toBe(0);
  });
});
