/* eslint-disable import/first */
/**
 * ORCH-1062 — implementor happy-path regression test for the brand-delete
 * "Maximum update depth exceeded" render-loop fix.
 *
 * Root cause (proven on the iOS sim 2026-06-02): deleting the CURRENTLY-selected
 * brand crashed RootLayoutInner with "Maximum update depth exceeded". The old
 * `useSoftDeleteBrand.onSuccess` only INVALIDATED `brandKeys.list`, so React
 * Query kept serving the STALE list (still containing the just-deleted brand)
 * during the background refetch. In that window `useCurrentBrandRecovery`
 * re-resolved the deleted brand (from the stale list / stale default_brand_id)
 * while `useCurrentBrand` cleared currentBrandId to null — the two hooks
 * ping-ponged synchronously past React's nested-update cap.
 *
 * Fix: onSuccess SYNCHRONOUSLY evicts the deleted brand from the list cache and
 * clears a stale default_brand_id pointer, so the resolver immediately sees
 * fresh data and lands on a valid brand.
 *
 * This test exercises the real onSuccess against a real QueryClient.
 * Fails-on-revert: with the old (invalidate-only) onSuccess the list cache still
 * contains the deleted brand synchronously, so the first assertion fails.
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
// usePublicEvents transitively imports the @mingla/offering-rendering workspace
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

const mkBrand = (id: string, name: string): unknown => ({
  id,
  displayName: name,
  slug: name.toLowerCase(),
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

const registerHook = (): void => {
  softDeleteConfig = null;
  // Calling the hook outside a renderer is safe: it only calls the (mocked)
  // useQueryClient + useMutation — no useState/useEffect/useRef.
  useSoftDeleteBrand();
  if (softDeleteConfig === null) throw new Error("mutation config not captured");
};

describe("ORCH-1062 — soft-delete evicts the deleted brand from the list cache", () => {
  beforeEach(() => {
    queryClient.clear();
    registerHook();
  });

  test("onSuccess synchronously removes the deleted brand from brandKeys.list", () => {
    queryClient.setQueryData(brandKeys.list("acc-1"), [
      mkBrand("brand-A", "Alpha"),
      mkBrand("brand-B", "Beta"),
    ]);

    softDeleteConfig!.onSuccess(
      { rejected: false, brandId: "brand-A" },
      { brandId: "brand-A", accountId: "acc-1" },
    );

    const list = queryClient.getQueryData(brandKeys.list("acc-1")) as Array<{
      id: string;
    }>;
    expect(list.map((b) => b.id)).toEqual(["brand-B"]);
  });

  test("onSuccess clears default_brand_id when it pointed at the deleted brand", () => {
    queryClient.setQueryData(creatorAccountKeys.byId("acc-1"), mkAccount("brand-A"));

    softDeleteConfig!.onSuccess(
      { rejected: false, brandId: "brand-A" },
      { brandId: "brand-A", accountId: "acc-1" },
    );

    const account = queryClient.getQueryData(
      creatorAccountKeys.byId("acc-1"),
    ) as { default_brand_id: string | null };
    expect(account.default_brand_id).toBeNull();
  });
});
