// Issue #3493 — the PR links Feature Guide gate treats a project's scripts/ci/
// as CI tooling: the bundle-baseline ratchet PRs (which only touch
// mingla-business/scripts/ci/) pass with "Feature Guide: none", while shipped
// source beside it still needs a capability key.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  featureGuideImpactVerdict,
  isFeatureGuideProductPath,
  parseFeatureGuide,
} from "../../../../.github/scripts/release-records/lib.mjs";

Deno.test("#3493 scripts/ci under a product project is CI tooling, not product code", () => {
  assertEquals(isFeatureGuideProductPath("mingla-business/scripts/ci/bundle-baseline-pr-handoff.mjs"), false);
  assertEquals(isFeatureGuideProductPath("app-mobile/scripts/ci/issue-1639-orch1016-fixc-guard.mjs"), false);
  assertEquals(isFeatureGuideProductPath("mingla-business/src/app/index.tsx"), true, "shipped source stays product code");
  assertEquals(isFeatureGuideProductPath("mingla-business/src/scripts/ci/x.ts"), true, "only a project-root scripts/ci/ is exempt");
  assertEquals(isFeatureGuideProductPath("supabase/functions/scripts/ci/x.ts"), true, "an edge function named scripts is still product code");
});

Deno.test("#3493 a ratchet-style PR passes with Feature Guide: none; product source beside it does not", () => {
  const guide = parseFeatureGuide("Feature Guide: none — CI automation text only, no user-facing change");
  const empty = new Map<string, string[]>();
  const ratchet = featureGuideImpactVerdict({
    guide,
    paths: ["mingla-business/scripts/ci/bundle-baseline-pr-handoff.mjs", "mingla-business/scripts/ci/__tests__/x.test.mjs"],
    baseCatalog: empty,
    prCatalog: empty,
  });
  assertEquals(ratchet.ok, true, ratchet.problems.join("; "));
  const mixed = featureGuideImpactVerdict({
    guide,
    paths: ["mingla-business/scripts/ci/bundle-baseline-pr-handoff.mjs", "mingla-business/src/app/index.tsx"],
    baseCatalog: empty,
    prCatalog: empty,
  });
  assertEquals(mixed.ok, false);
  assertEquals(mixed.productPaths, ["mingla-business/src/app/index.tsx"]);
});
