import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  compileProviderTargeting,
  providerExecutionTargeting,
} from "../adTargetingCompiler.ts";

const intent = { countries: ["NG"] };
const refs = {
  includeAudienceIds: ["include-1", " include-1 ", "include-2"],
  excludeAudienceIds: ["buyer-1"],
};

Deno.test("#3697 Meta targeting compiles include/exclude ids and prospecting Advantage+", () => {
  const compiled = compileProviderTargeting("meta", intent, {
    ...refs,
    advantageAudience: true,
  });
  assertEquals(compiled.compiledTargeting.custom_audiences, [
    { id: "include-1" },
    { id: "include-2" },
  ]);
  assertEquals(compiled.compiledTargeting.excluded_custom_audiences, [
    { id: "buyer-1" },
  ]);
  assertEquals(compiled.compiledTargeting.targeting_automation, {
    advantage_audience: 1,
  });
  assertEquals(
    providerExecutionTargeting(
      "meta",
      compiled.audienceIntent,
      compiled.compiledTargeting,
    ).excluded_custom_audiences,
    [{ id: "buyer-1" }],
  );
});

Deno.test("#3697 Snap targeting compiles compact Segment include/exclude ids", () => {
  const compiled = compileProviderTargeting("snapchat", intent, refs);
  const execution = providerExecutionTargeting(
    "snapchat",
    compiled.audienceIntent,
    compiled.compiledTargeting,
  );
  assertEquals(execution.segment_include_ids, ["include-1", "include-2"]);
  assertEquals(execution.segment_exclude_ids, ["buyer-1"]);
});

Deno.test("#3697 TikTok targeting compiles audience_ids and excluded_audience_ids", () => {
  const compiled = compileProviderTargeting("tiktok", intent, refs);
  const execution = providerExecutionTargeting(
    "tiktok",
    compiled.audienceIntent,
    compiled.compiledTargeting,
  );
  assertEquals(execution.audience_ids, ["include-1", "include-2"]);
  assertEquals(execution.excluded_audience_ids, ["buyer-1"]);
});

Deno.test("#3697 caller-supplied ids in demographic intent are ignored", () => {
  const compiled = compileProviderTargeting("meta", {
    countries: ["NG"],
    custom_audiences: [{ id: "attacker-id" }],
    excluded_custom_audiences: [{ id: "attacker-exclude" }],
  } as unknown as { countries: string[] });
  assertEquals(compiled.compiledTargeting.custom_audiences, undefined);
  assertEquals(compiled.compiledTargeting.excluded_custom_audiences, undefined);
});
