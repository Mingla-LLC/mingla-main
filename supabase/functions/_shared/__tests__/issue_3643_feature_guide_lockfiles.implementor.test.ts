// Issue #3643 — the PR links Feature Guide gate treats npm lockfiles as
// non-product paths, so a lockfile-only dependency security patch passes with
// "Feature Guide: none — <reason>". package.json stays product code (a range
// change can change behaviour), and real product source beside a lockfile
// still needs its catalog owner.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  featureGuideCatalogFromContract,
  featureGuideImpactVerdict,
  isFeatureGuideProductPath,
  parseFeatureGuide,
} from "../../../../.github/scripts/release-records/lib.mjs";

const empty = new Map<string, string[]>();
const none = parseFeatureGuide("Feature Guide: none — lockfile-only node-forge security patch");

Deno.test("#3643 package-lock.json in any directory is not a product path; package.json still is", () => {
  assertEquals(isFeatureGuideProductPath("app-mobile/package-lock.json"), false);
  assertEquals(isFeatureGuideProductPath("mingla-business/package-lock.json"), false);
  assertEquals(isFeatureGuideProductPath("packages/sharing/package-lock.json"), false);
  assertEquals(isFeatureGuideProductPath("mingla-business/package.json"), true, "package.json stays product code");
  assertEquals(isFeatureGuideProductPath("app-mobile/package.json"), true, "package.json stays product code");
  assertEquals(isFeatureGuideProductPath("app-mobile/src/package-lock.json.ts"), true, "only an exact lockfile name is exempt");
  assertEquals(isFeatureGuideProductPath("app-mobile/src/my-package-lock.json"), true, "only an exact lockfile name is exempt");
});

Deno.test("#3643 a lockfile-only PR passes with Feature Guide: none even when the catalog once named the lockfile", () => {
  const catalog = new Map([["door-pay", ["mingla-business/package-lock.json", "mingla-business/src/door.tsx"]]]);
  const verdict = featureGuideImpactVerdict({
    guide: none,
    paths: ["app-mobile/package-lock.json", "mingla-business/package-lock.json"],
    baseCatalog: catalog,
    prCatalog: empty,
  });
  assertEquals(verdict.ok, true, verdict.problems.join("; "));
  assertEquals(verdict.productPaths, []);
});

Deno.test("#3643 a lockfile beside real product source still needs that source's owner", () => {
  const catalog = new Map([["door-pay", ["mingla-business/src/door.tsx"]]]);
  const withNone = featureGuideImpactVerdict({
    guide: none,
    paths: ["mingla-business/package-lock.json", "mingla-business/src/door.tsx"],
    baseCatalog: catalog,
    prCatalog: empty,
  });
  assertEquals(withNone.ok, false);
  assertEquals(withNone.productPaths, ["mingla-business/src/door.tsx"]);
  assertEquals(withNone.expected, ["door-pay"]);
  const withKey = featureGuideImpactVerdict({
    guide: parseFeatureGuide("Feature Guide: door-pay"),
    paths: ["mingla-business/package-lock.json", "mingla-business/src/door.tsx"],
    baseCatalog: catalog,
    prCatalog: empty,
  });
  assertEquals(withKey.ok, true, withKey.problems.join("; "));
});

Deno.test("#3643 a package.json range change still fails with Feature Guide: none", () => {
  const verdict = featureGuideImpactVerdict({
    guide: none,
    paths: ["mingla-business/package.json", "mingla-business/package-lock.json"],
    baseCatalog: empty,
    prCatalog: empty,
  });
  assertEquals(verdict.ok, false);
  assertEquals(verdict.productPaths, ["mingla-business/package.json"]);
});

Deno.test("#3643 the impact contract names no lockfile and still parses", async () => {
  const root = new URL("../../../../", import.meta.url);
  const text = await Deno.readTextFile(new URL("docs/contracts/feature-guide-impact.json", root));
  const catalog = featureGuideCatalogFromContract(text);
  for (const [, paths] of catalog) {
    for (const path of paths) assert(!/(?:^|\/)package-lock[.]json$/.test(path), path);
  }
});
