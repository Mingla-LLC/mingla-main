/**
 * ORCH-0889 [Marketing tab desktop-web fit-and-finish] — T-02 adversarial.
 *
 * Tester adversarial regression test (Step 0.5 of CLOSE protocol).
 *
 * # Different angle than T-01
 * The implementor's T-01 happy-path test inspects the Overview route's
 * loading guard. This adversarial test attacks a DIFFERENT angle:
 *
 *   - Different route — Marketing Audiences (`audiences/index.tsx`)
 *     instead of Overview. The bug class is identical (disabled-query
 *     mis-paint) but each route has its own hook + its own empty-state
 *     copy, so a fix to one does not automatically fix the others.
 *   - Different empty-state text — "No buyers yet." (Audiences) vs.
 *     "Couldn't load metrics" (Overview). The brittle guard surfaced
 *     this specific text during the auth-bootstrap window; this test
 *     ensures the route does NOT fall through to the false-empty branch
 *     during disabled-query state.
 *   - Different hook shape — `useAudienceList` returns `entries` (an
 *     array) and `reach` (a Map), not `data`. The fix must extend
 *     `useAudienceList` with `hasResolved` AND the route must consume
 *     it; both halves are asserted independently below.
 *   - Different code branch — Audiences uses three sequential `if`
 *     branches (skeleton / error / empty), where the brittle pattern
 *     fell into the third. The fix MUST put the disabled-query check
 *     BEFORE the empty-state check; this test enforces the ordering.
 *
 * # Why source-grep
 * Same rationale as T-01: repo's `jest.config.cjs` is
 * `testEnvironment: "node"` with no jsdom / RTL setup. The strict-grep
 * CI gate `orch-0889-disabled-query-loading-state.mjs` provides
 * repo-wide enforcement; this test provides route-specific +
 * hook-coupling assertions the gate cannot cleanly express.
 *
 * # fails-on-revert
 * Revert the audiences route's guard back to
 *   `if (listState.isLoading && listState.entries.length === 0)`
 * — this test fails on (T-02a) (correct pattern missing) and (T-02b)
 * (brittle pattern returns) and (T-02e) (hook coupling broken if the
 * type definition is also reverted).
 */

import fs from "node:fs";
import path from "node:path";

const AUDIENCES_ROUTE_PATH = path.resolve(__dirname, "..", "audiences", "index.tsx");
const USE_AUDIENCE_LIST_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "src",
  "hooks",
  "marketing",
  "useAudienceList.ts",
);

describe("ORCH-0889 — Marketing Audiences disabled-query guard (T-02 adversarial)", () => {
  let routeSource: string;
  let hookSource: string;

  beforeAll(() => {
    routeSource = fs.readFileSync(AUDIENCES_ROUTE_PATH, "utf8");
    hookSource = fs.readFileSync(USE_AUDIENCE_LIST_PATH, "utf8");
  });

  it("(T-02a) audiences route uses the disabled-query-safe pattern `!hasResolved && !isError`", () => {
    const pattern = /!\s*listState\.hasResolved\s*&&\s*!\s*listState\.isError/;
    expect(pattern.test(routeSource)).toBe(true);
  });

  it("(T-02b) audiences route does NOT fall through to 'No buyers yet.' during disabled-query state", () => {
    // The brittle pattern was:
    //   if (listState.isLoading && listState.entries.length === 0)
    // which mis-fired with isLoading=false during auth bootstrap and
    // landed in the 'No buyers yet.' branch. Confirm the brittle gate
    // is gone.
    const brittle =
      /listState\.isLoading\s*&&\s*listState\.entries\.length\s*===\s*0/;
    expect(brittle.test(routeSource)).toBe(false);
  });

  it("(T-02c) audiences skeleton branch is declared BEFORE the 'No buyers yet.' empty-state branch", () => {
    // Find the index of the new skeleton guard and the empty-state JSX
    // prop. The skeleton MUST come first in source order, otherwise the
    // disabled-query state still falls through to the empty-state. Match
    // on the JSX-prop form (`title="No buyers yet."`) so explanatory
    // comments that mention the bug do not pollute the index search.
    const skeletonIdx = routeSource.indexOf('testID="audiences-skeleton"');
    const emptyIdx = routeSource.indexOf('title="No buyers yet."');
    expect(skeletonIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(skeletonIdx).toBeLessThan(emptyIdx);
  });

  it("(T-02d) skeleton branch declares testID=\"audiences-skeleton\" for downstream tester targeting", () => {
    expect(routeSource.includes('testID="audiences-skeleton"')).toBe(true);
  });

  it("(T-02e) useAudienceList hook exposes `hasResolved` derived from `query.isFetched`", () => {
    // The route's guard depends on this contract. If the hook drops
    // `hasResolved`, the route's `listState.hasResolved` becomes
    // undefined (truthy in TS strict only if type is narrowed; falsy
    // at runtime), and `!undefined && !isError` = true forever ⇒
    // skeleton stuck on. Hook contract MUST stay in sync with route.
    expect(hookSource.includes("hasResolved: boolean")).toBe(true);
    expect(/hasResolved\s*:\s*query\.isFetched/.test(hookSource)).toBe(true);
  });

  it("(T-02f) audiences route still surfaces real errors and real empties (regression guard)", () => {
    // After the fix, the route MUST still:
    //   - show 'Couldn't load audiences' when isError === true
    //   - show 'No buyers yet.' when hasResolved && entries.length === 0
    // Confirm both literal strings remain present so the fix did not
    // accidentally remove valid terminal states.
    expect(routeSource.includes("Couldn't load audiences")).toBe(true);
    expect(routeSource.includes("No buyers yet.")).toBe(true);
  });
});
