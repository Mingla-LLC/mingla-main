import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import { resolveBrandListStatus } from "../../utils/brandListState";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const base = {
  authStatus: "signed_in_ready",
  hasUser: true,
  isError: false,
  isFetched: true,
  isFetching: false,
  isLoading: false,
  itemCount: 1,
};

describe("brand list state honesty", () => {
  test("does not collapse auth loading into true empty brands", () => {
    expect(
      resolveBrandListStatus({
        ...base,
        authStatus: "bootstrapping",
        itemCount: 0,
      }),
    ).toBe("auth_loading");
    expect(
      resolveBrandListStatus({
        ...base,
        authStatus: "refreshing",
        itemCount: 0,
      }),
    ).toBe("auth_loading");
  });

  test("distinguishes disabled, loading, error, ready, and true empty", () => {
    expect(resolveBrandListStatus({ ...base, hasUser: false })).toBe(
      "query_disabled",
    );
    expect(resolveBrandListStatus({ ...base, isFetched: false })).toBe(
      "query_loading",
    );
    expect(resolveBrandListStatus({ ...base, isError: true })).toBe("error");
    expect(resolveBrandListStatus(base)).toBe("ready");
    expect(resolveBrandListStatus({ ...base, itemCount: 0 })).toBe("empty");
  });

  // ORCH-1136 F-4 fails-on-revert gate: a populated, already-fetched list that
  // is merely background-refetching must resolve to "ready"/"empty" — NOT
  // "query_loading". This FAILS if line 34's predicate is reverted to
  // `if (isLoading || isFetching || !isFetched) return "query_loading"`.
  test("does not downgrade a fetched non-empty list during a background refetch", () => {
    expect(
      resolveBrandListStatus({
        ...base,
        isFetching: true,
        isFetched: true,
        itemCount: 3,
      }),
    ).toBe("ready");
    expect(
      resolveBrandListStatus({
        ...base,
        isFetching: true,
        isFetched: true,
        itemCount: 0,
      }),
    ).toBe("empty");
    // First-load (`!isFetched`) STILL loads even while fetching (cold-boot
    // must never flash an empty "no brands" state).
    expect(
      resolveBrandListStatus({
        ...base,
        isFetching: true,
        isFetched: false,
        itemCount: 0,
      }),
    ).toBe("query_loading");
  });

  test("account and current-brand surfaces use stateful brand/auth guards", () => {
    const accountSource = repoFile("app/(tabs)/account.tsx");
    const currentBrandSource = repoFile("src/hooks/useCurrentBrand.ts");
    const recoverySource = repoFile("src/hooks/useCurrentBrandRecovery.ts");

    expect(accountSource).toContain("useBrandListState");
    expect(accountSource).toContain("Loading your brands");
    expect(accountSource).toContain("brandList.status === \"empty\"");
    expect(currentBrandSource).toContain("isAuthReady ? currentBrandId : null");
    expect(currentBrandSource).toContain("!isError && brand === null");
    expect(recoverySource).toContain("isAuthReady &&");
    expect(recoverySource).toContain("!brandsQuery.isError");
    expect(recoverySource).toContain("!creatorAccount.isError");
  });
});
