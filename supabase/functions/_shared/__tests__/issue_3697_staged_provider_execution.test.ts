import {
  assert,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
);

Deno.test("#3697 all three paid-social branches execute reviewed stages", () => {
  for (const platform of ["meta", "snapchat", "tiktok"]) {
    assertMatch(
      source,
      new RegExp(
        `preparePaidSocialStages\\(supabase, \\{[\\s\\S]{0,500}platform: ["']${platform}["']`,
      ),
    );
  }
  assert(
    (source.match(/createStagedCampaignAtomic\(/g) ?? []).length >= 3,
    "Meta, Snapchat and TikTok must each use the staged atomic creator",
  );
  assertMatch(source, /persistStageSnapshots\([\s\S]*?"meta"/);
  assertMatch(source, /persistStageSnapshots\([\s\S]*?"snapchat"/);
  assertMatch(source, /persistStageSnapshots\([\s\S]*?"tiktok"/);
});

Deno.test("#3697 staged execution uses server-owned audiences and creative ids", () => {
  assertMatch(source, /from\("ad_audiences"\)/);
  assertMatch(source, /boundCanonicalPlan/);
  assertMatch(source, /stage_creative_ids/);
  assertMatch(source, /stage_budget_below_platform_minimum/);
});
