/**
 * Issue #1735 — growthToolsKeys factory shapes (P-33/P-42).
 *
 * Fails-on-revert anchors: keys are BRAND-FIRST (brand-prefix invalidation
 * composes) and `subjectRead` EXTENDS the `subject` leaf (prefix-invalidating
 * the leaf must hit both the `latest` and `with-previous` reads — the
 * useIntelRun invalidation contract).
 */

import { growthToolsKeys } from "../growthToolsKeys";

describe("issue #1735 growthToolsKeys", () => {
  it("is brand-first everywhere", () => {
    expect(growthToolsKeys.all).toEqual(["growth-tools"]);
    expect(growthToolsKeys.brand("b1")).toEqual(["growth-tools", "b1"]);
    expect(growthToolsKeys.run("b1", "venues", "hash1")).toEqual([
      "growth-tools",
      "b1",
      "run",
      "venues",
      "hash1",
    ]);
    expect(growthToolsKeys.subject("b1", "venues", "venue:v1")).toEqual([
      "growth-tools",
      "b1",
      "subject",
      "venues",
      "venue:v1",
    ]);
    expect(growthToolsKeys.watch("b1", "v1")).toEqual([
      "growth-tools",
      "b1",
      "watch",
      "v1",
    ]);
    expect(growthToolsKeys.search("b1", "riv", "London")).toEqual([
      "growth-tools",
      "b1",
      "search",
      "riv",
      "London",
    ]);
  });

  it("subjectRead extends the subject leaf (prefix invalidation hits both variants)", () => {
    const leaf = growthToolsKeys.subject("b1", "venues", "competitor:c1");
    const latest = growthToolsKeys.subjectRead("b1", "venues", "competitor:c1", false);
    const withPrevious = growthToolsKeys.subjectRead(
      "b1",
      "venues",
      "competitor:c1",
      true,
    );
    expect(latest.slice(0, leaf.length)).toEqual([...leaf]);
    expect(withPrevious.slice(0, leaf.length)).toEqual([...leaf]);
    expect(latest.at(-1)).toBe("latest");
    expect(withPrevious.at(-1)).toBe("with-previous");
  });
});
