import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";

const postIds = ["7462384762384762384", "7462384762384762385"];
const base = {
  lane: "consumer",
  name: "Friday",
  goal: { platforms: { tiktok: { objective: "TRAFFIC" } } },
  destination: {
    page_type: "event",
    brand_slug: "room-27",
    entity_slug: "friday",
  },
  audience: { countries: ["NG"], ageMin: 18, ageMax: 45, gender: "all" },
  budget: { dailyCentsForChannel: 5000 },
  creative: {
    kind: "image",
    tiktokCreativeSource: "spark",
    tiktokSparkPostIds: postIds,
    tiktokPlacement: "tiktok_pangle",
  },
  copy: { primary: "", platformCtas: { tiktok: "Get ticket now" } },
  requestId: "20000000-0000-4000-8000-000000000002",
};

describe("#3697 @usemingla TikTok Spark Ads", () => {
  it("freezes reviewed post ids and never broadens Spark delivery to Pangle", () => {
    const payload = buildCreatePayload("tiktok", base);
    assert.deepEqual(payload.tiktok_spark_post_ids, postIds);
    assert.equal(payload.tiktok_placement, "tiktok");
  });

  it("lets Spark-only plans skip duplicate media and copy while retaining rights and CTA controls", () => {
    const page = readFileSync(
      new URL("../pages/CampaignBuilderPage.jsx", import.meta.url),
      "utf8",
    );
    const creative = readFileSync(
      new URL(
        "../components/campaign-builder/StepCreative.jsx",
        import.meta.url,
      ),
      "utf8",
    );
    const copy = readFileSync(
      new URL("../components/campaign-builder/StepCopy.jsx", import.meta.url),
      "utf8",
    );

    assert.match(page, /!sparkOnly && !creative\.creativeRow/);
    assert.match(page, /funded\.length === 0 \|\| copy\.primary/);
    assert.match(creative, /Choose existing @usemingla posts below/);
    assert.match(creative, /usesTikTokSpark \|\| mediaReady/);
    assert.match(copy, /original caption/);
    assert.match(copy, /allPlatforms\.some/);
  });
});
