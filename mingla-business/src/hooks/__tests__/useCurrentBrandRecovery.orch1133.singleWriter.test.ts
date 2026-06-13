/* eslint-disable import/first */
/**
 * ORCH-1133 — single-writer regression test for the mingla-business root-layout
 * "Maximum update depth exceeded" render loop.
 *
 * Root cause: useCurrentBrandRecovery is mounted in 5+ concurrent subscriber
 * trees (RootLayoutInner, TabsLayout, home, event/create, useBusinessTodos).
 * Every mount ran the WRITE effect that calls setCurrentBrandId on the shared
 * Zustand store — a one-owner-per-truth violation. Under auth/session flicker,
 * multiple mounts re-resolving + writing can ping-pong across commits, producing
 * the useSyncExternalStore "Maximum update depth exceeded" loop.
 *
 * Fix: the write body (`runBrandRecoveryWrite`) runs ONLY when
 * `authoritative === true`. The hook's default is read-only. EXACTLY ONE call
 * site (app/_layout.tsx) passes authoritative:true.
 *
 * TWO independent proofs:
 *  (A) Behavioral — exercise the REAL gated write body (`runBrandRecoveryWrite`,
 *      the exact function the hook's effect invokes) with a mocked store setter
 *      and assert:
 *        - authoritative:false => 0 setCurrentBrandId calls, no ref/error mutation
 *        - authoritative:true  => exactly 1 setCurrentBrandId call for a resolution
 *  (B) Structural invariant — only app/_layout.tsx passes authoritative:true;
 *      the other 4 mount sites must NOT, and exactly one site total passes it.
 *
 * Fails-on-revert: delete the `if (!authoritative) return false;` gate from
 * runBrandRecoveryWrite and (A)'s read-only assertion fails (the read-only call
 * writes again). Point authoritative:true at a 2nd site and (B) fails.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

// Importing the hook module transitively pulls in AuthContext (TSX/JSX) and the
// brand/creator-account hooks + Zustand store, which the default node/ts-jest
// config can't transform / load. runBrandRecoveryWrite itself uses NONE of them
// at runtime — stub them so the module evaluates. (Same pattern as the
// ORCH-1062 useSoftDeleteBrand tests.)
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ authStatus: "ready", isAuthReady: true, user: null }),
}));
jest.mock("../useBrands", () => ({
  useBrands: () => ({ data: [], isError: false, isFetched: true }),
}));
jest.mock("../useCreatorAccount", () => ({
  useCreatorAccount: () => ({
    data: { default_brand_id: null },
    isError: false,
    isFetched: true,
  }),
}));
jest.mock("../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (selector: (s: unknown) => unknown) =>
    selector({ currentBrandId: null, setCurrentBrandId: jest.fn() }),
}));

// setCreatorDefaultBrand is only hit on the "newest-brand" branch; stub so the
// authoritative path with a server default never touches the network. We use a
// "server-default" resolution below so this is not even invoked, but mock it to
// keep the unit hermetic.
jest.mock("../../services/creatorAccount", () => ({
  setCreatorDefaultBrand: jest.fn(() => Promise.resolve()),
}));

import {
  runBrandRecoveryWrite,
  type BrandRecoveryWriteInput,
} from "../useCurrentBrandRecovery";

const makeInput = (
  overrides: Partial<BrandRecoveryWriteInput>,
): BrandRecoveryWriteInput => {
  const setCurrentBrandId = jest.fn();
  const setErrorMessage = jest.fn();
  return {
    authoritative: false,
    isAuthReady: true,
    userId: "user-1",
    // a settled "server-default" resolution that differs from currentBrandId,
    // so an authoritative caller WILL write exactly once (and the network
    // default-write branch — "newest-brand" — is NOT taken).
    resolution: { brandId: "brand-A", reason: "server-default" },
    appliedKey: "user-1::null::brand-A::brand-A::server-default",
    appliedKeyRef: { current: null },
    currentBrandId: null,
    setCurrentBrandId,
    setErrorMessage,
    ...overrides,
  };
};

describe("ORCH-1133 (A) — behavioral single-writer gate (runBrandRecoveryWrite)", () => {
  test("authoritative:false NEVER writes setCurrentBrandId (read-only)", () => {
    const input = makeInput({ authoritative: false });
    const wrote = runBrandRecoveryWrite(input);
    expect(wrote).toBe(false);
    expect(input.setCurrentBrandId).not.toHaveBeenCalled();
    // read-only path must not mutate the dedupe ref or surface an error either
    expect(input.appliedKeyRef.current).toBeNull();
    expect(input.setErrorMessage).not.toHaveBeenCalled();
  });

  test("authoritative:true writes setCurrentBrandId exactly once for a resolution", () => {
    const input = makeInput({ authoritative: true });
    const wrote = runBrandRecoveryWrite(input);
    expect(wrote).toBe(true);
    expect(input.setCurrentBrandId).toHaveBeenCalledTimes(1);
    expect(input.setCurrentBrandId).toHaveBeenCalledWith("brand-A");
  });

  test("authoritative:true is idempotent — a re-run with the same appliedKey does NOT re-write", () => {
    const setCurrentBrandId = jest.fn();
    const ref = { current: null as string | null };
    const base = makeInput({ authoritative: true, setCurrentBrandId, appliedKeyRef: ref });
    runBrandRecoveryWrite(base);
    expect(setCurrentBrandId).toHaveBeenCalledTimes(1);
    // second commit, identical inputs (currentBrandId now reflects the write)
    runBrandRecoveryWrite(
      makeInput({
        authoritative: true,
        setCurrentBrandId,
        appliedKeyRef: ref,
        currentBrandId: "brand-A",
      }),
    );
    // appliedKeyRef dedupe + value-equality guard both hold → no second write
    expect(setCurrentBrandId).toHaveBeenCalledTimes(1);
  });
});

describe("ORCH-1133 (B) — structural invariant: exactly one authoritative owner", () => {
  // Repo root from this test file: src/hooks/__tests__ -> up 3 -> mingla-business
  const bizRoot = join(__dirname, "..", "..", "..");
  const callSites: { path: string; authoritative: boolean }[] = [
    { path: "app/_layout.tsx", authoritative: true },
    { path: "app/(tabs)/_layout.tsx", authoritative: false },
    { path: "app/(tabs)/home.tsx", authoritative: false },
    { path: "app/event/create.tsx", authoritative: false },
    { path: "src/hooks/useBusinessTodos.ts", authoritative: false },
  ];

  const callsAuthoritative = (src: string): boolean =>
    /useCurrentBrandRecovery\(\s*\{[^}]*authoritative:\s*true/.test(src);

  test.each(callSites)(
    "$path authoritative === $authoritative",
    ({ path, authoritative }) => {
      const src = readFileSync(join(bizRoot, path), "utf8");
      // every listed site must actually mount the hook
      expect(src).toContain("useCurrentBrandRecovery(");
      expect(callsAuthoritative(src)).toBe(authoritative);
    },
  );

  test("exactly ONE call site across the 5 passes authoritative:true", () => {
    const authoritativeCount = callSites.filter(({ path }) =>
      callsAuthoritative(readFileSync(join(bizRoot, path), "utf8")),
    ).length;
    expect(authoritativeCount).toBe(1);
  });
});
