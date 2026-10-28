import {
  assert,
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../", import.meta.url);
const read = (relative: string) => Deno.readTextFileSync(new URL(relative, root));

Deno.test("#3720 Support gets a read-only Feature Guide while Admin keeps evidence controls", () => {
  const page = read("pages/CommunitySupportPage.jsx");
  const access = read("lib/communitySupportAccess.js");
  const panel = read("components/community/FeatureGuidePanel.jsx");
  // #4130 Wave 6: the tab lists live in lib/supportCommunityTabs.js.
  assertStringIncludes(read("lib/supportCommunityTabs.js"), '{ id: "feature-guide", label: "Feature guide" }');
  assertStringIncludes(access, 'allowed.add("feature-guide")');
  assertStringIncludes(page, "<FeatureGuidePanel canManage={capabilities.isAdmin} />");
  assertStringIncludes(panel, "{canManage && <Button");
  assertStringIncludes(panel, ">New capability</Button>}");
  assertMatch(panel, /Missing, expired, or conflicting proof is shown as Needs review/);
});

Deno.test("#3720 Feature Guide browser writes use guarded RPCs only", () => {
  const service = read("services/featureGuideService.js");
  for (const rpc of [
    "issue_3720_list_feature_guide",
    "issue_3720_save_feature_capability",
    "issue_3720_record_feature_evidence",
  ]) assertStringIncludes(service, rpc);
  assertNotMatch(service, /\.from\s*\(/);
  assertNotMatch(service, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
});

Deno.test("#3720 Support answers display citations and last verification", () => {
  const panel = read("components/community/FeatureGuidePanel.jsx");
  assertStringIncludes(panel, "Approved Support wording");
  assertStringIncludes(panel, "Last fully verified:");
  assertStringIncludes(panel, "Current evidence");
  assertMatch(panel, /href=\{item\.url\}/);
  assertMatch(panel, /item\.verdict === "verified"/);
});

Deno.test("#3720 Product Truth stays deterministic with no embedded model path", () => {
  const source = [
    read("components/community/FeatureGuidePanel.jsx"),
    read("services/featureGuideService.js"),
  ].join("\n");
  assertNotMatch(source, /openai|anthropic|gemini|claude|embedding|vector[_-]?store/i);
  assert(!/fetch\s*\(|invokeWithRefresh/.test(source));
});
