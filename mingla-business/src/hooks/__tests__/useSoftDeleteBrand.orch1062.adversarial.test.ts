/* eslint-disable import/first */
/**
 * ORCH-1062 — tester ADVERSARIAL regression test for the brand-delete
 * render-loop fix. Attacks DIFFERENT angles than the implementor happy-path
 * (which proves the deleted brand is evicted from the list cache):
 *
 *  1. REJECTED delete (active events block it) must NOT mutate any cache —
 *     the brand was never deleted, so evicting it from the list would make a
 *     still-live brand vanish from the UI.
 *  2. PRECISION: default_brand_id is cleared ONLY when it equals the deleted
 *     brand. A default pointing at a DIFFERENT brand must be preserved
 *     (over-clearing would silently drop the user's chosen default).
 *  3. SAFETY: deleting a brand that is NOT in the cached list is a no-op on the
 *     surviving members (no throw, no corruption) — guards the cold-cache path.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

const queryClient = new QueryClient();
let softDeleteConfig: {
  onSuccess: (result: unknown, vars: unknown) => void;
} | null = null;

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock("../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
  },
}));
jest.mock("../../services/appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: null, authStatus: "ready" }),
}));
// usePublicEvents transitively imports the @mingla/event-rendering workspace
// package, which jest can't resolve in the worktree. useSoftDeleteBrand only
// needs the key factory — stub it.
jest.mock("../usePublicEvents", () => ({
  publicEventKeys: { brandBySlug: (slug: string) => ["public-brand", slug] },
}));
jest.mock("@tanstack/react-query", () => {
  const actual =
    jest.requireActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );
  return {
    ...actual,
    useQueryClient: () => queryClient,
    useMutation: (config: typeof softDeleteConfig) => {
      softDeleteConfig = config;
      return { mutateAsync: jest.fn(), isPending: false };
    },
    useQuery: () => ({
      data: undefined,
      isError: false,
      isFetched: false,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    }),
  };
});

import { useSoftDeleteBrand, brandKeys } from "../useBrands";
import { creatorAccountKeys } from "../useCreatorAccount";

const mkBrand = (id: string): unknown => ({
  id,
  displayName: id,
  slug: id,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
});
const mkAccount = (defaultBrandId: string | null): unknown => ({
  id: "acc-1",
  email: null,
  display_name: null,
  avatar_url: null,
  marketing_opt_in: false,
  default_brand_id: defaultBrandId,
  deleted_at: null,
});
const ids = (key: readonly unknown[]): string[] =>
  (queryClient.getQueryData(key) as Array<{ id: string }>).map((b) => b.id);

const registerHook = (): void => {
  softDeleteConfig = null;
  useSoftDeleteBrand();
  if (softDeleteConfig === null) throw new Error("mutation config not captured");
};

describe("ORCH-1062 adversarial — soft-delete cache mutation boundaries", () => {
  beforeEach(() => {
    queryClient.clear();
    registerHook();
  });

  test("REJECTED delete leaves the list cache untouched (brand stays visible)", () => {
    queryClient.setQueryData(brandKeys.list("acc-1"), [
      mkBrand("brand-A"),
      mkBrand("brand-B"),
    ]);

    softDeleteConfig!.onSuccess(
      { rejected: true, reason: "upcoming_events", upcomingEventCount: 3 },
      { brandId: "brand-A", accountId: "acc-1" },
    );

    expect(ids(brandKeys.list("acc-1"))).toEqual(["brand-A", "brand-B"]);
  });

  test("a default_brand_id pointing at a DIFFERENT brand is preserved", () => {
    queryClient.setQueryData(brandKeys.list("acc-1"), [
      mkBrand("brand-A"),
      mkBrand("brand-B"),
    ]);
    queryClient.setQueryData(creatorAccountKeys.byId("acc-1"), mkAccount("brand-B"));

    // Delete brand-A; default points at brand-B and must NOT be cleared.
    softDeleteConfig!.onSuccess(
      { rejected: false, brandId: "brand-A" },
      { brandId: "brand-A", accountId: "acc-1" },
    );

    const account = queryClient.getQueryData(
      creatorAccountKeys.byId("acc-1"),
    ) as { default_brand_id: string | null };
    expect(account.default_brand_id).toBe("brand-B");
    expect(ids(brandKeys.list("acc-1"))).toEqual(["brand-B"]);
  });

  test("deleting a brand absent from the cached list is a safe no-op", () => {
    queryClient.setQueryData(brandKeys.list("acc-1"), [
      mkBrand("brand-B"),
      mkBrand("brand-C"),
    ]);

    expect(() =>
      softDeleteConfig!.onSuccess(
        { rejected: false, brandId: "brand-A" },
        { brandId: "brand-A", accountId: "acc-1" },
      ),
    ).not.toThrow();

    expect(ids(brandKeys.list("acc-1"))).toEqual(["brand-B", "brand-C"]);
  });
});
