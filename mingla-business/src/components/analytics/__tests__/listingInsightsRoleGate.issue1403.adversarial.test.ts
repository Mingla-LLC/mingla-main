import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "../../../..");
const readRoute = (relativePath: string): string =>
  fs.readFileSync(path.join(businessRoot, relativePath), "utf8");

const roleSuccessGate =
  /const canShowListingInsights\s*=\s*!currentBrandRole\.isLoading\s*&&\s*!currentBrandRole\.isError\s*&&\s*currentBrandRole\.role !== null\s*&&\s*!isScannerOnlyRank\s*\(\s*currentBrandRole\.rank\s*\)/;

describe("issue #1403 role resolution fails closed on every Insights entry", () => {
  test.each([
    ["event", "app/event/[id]/index.tsx", "manual"],
    ["rsvp", "app/rsvp/[id]/index.tsx", "manual"],
    ["trip", "app/trip/[id]/index.tsx", "composed"],
    ["experience", "app/experience/[id]/index.tsx", "composed"],
  ] as const)(
    "%s hides Insights while role loading/errors and for scanner-only roles",
    (_kind, relativePath, mode) => {
      const source = readRoute(relativePath);
      expect(source).toMatch(roleSuccessGate);
      if (mode === "manual") {
        expect(source).toMatch(
          /\{\s*canShowListingInsights\s*\?\s*\(\s*<ActionTile[\s\S]*?label="Insights"/,
        );
      } else {
        expect(source).toMatch(
          /tile\.key === "insights"\s*&&\s*!canShowListingInsights/,
        );
      }
    },
  );

  it("gates direct-load reads on hydration and makes role request errors retryable", () => {
    const source = readRoute("app/insights/[id].tsx");
    expect(source).toMatch(
      /const hasCurrentBrandHydrated = useCurrentBrandHasHydrated\(\)/,
    );
    expect(source).toMatch(
      /const rankSettled =\s*hasCurrentBrandHydrated\s*&&\s*currentBrand !== null\s*&&\s*!role\.isLoading\s*&&\s*!role\.isError\s*&&\s*role\.role !== null/,
    );
    expect(source).toMatch(
      /enabled:\s*isAuthReady\s*&&\s*rankSettled\s*&&\s*!scannerDenied\s*&&\s*id !== null/,
    );
    expect(source).toMatch(/accessError=\{\s*hasCurrentBrandHydrated[\s\S]*role\.isError/);
    expect(source).toMatch(/onRetryAccess=\{\(\) => \{[\s\S]*role\.refetch\(\)/);
    expect(source).toMatch(
      /const membershipDenied\s*=[\s\S]*role\.role === null[\s\S]*forceUnavailable=\{[\s\S]*membershipDenied/,
    );
    expect(source).not.toMatch(/forceUnavailable=\{\s*role\.isError/);
  });

  it.each([
    ["missing", undefined],
    ["array", ["550e8400-e29b-41d4-a716-446655440000"]],
    ["forged non-UUID", "not-a-uuid"],
  ] as const)("rejects a %s route ID before any query can enable", (_case, value) => {
    const source = readRoute("app/insights/[id].tsx");
    const literal = source.match(/const CANONICAL_UUID =\s*\/(.+)\/i;/);
    expect(literal).not.toBeNull();
    const canonicalUuid = new RegExp(literal![1], "i");
    const parsed =
      typeof value === "string" && canonicalUuid.test(value) ? value : null;
    expect(parsed).toBeNull();
    expect(source).toMatch(/const CANONICAL_UUID\s*=/);
    expect(source).toMatch(
      /typeof value === "string" && CANONICAL_UUID\.test\(value\) \? value : null/,
    );
    expect(source).toMatch(/id === null \|\|/);
    expect(source).toMatch(/id !== null/);
  });
});
