import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";

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
    kind: "video",
    creativeLibraryId: "10000000-0000-4000-8000-000000000001",
  },
  copy: { primary: "Friday night", platformCtas: { tiktok: "Get ticket now" } },
  requestId: "20000000-0000-4000-8000-000000000002",
};

describe("#3697 TikTok placement control", () => {
  it("defaults narrowly to TikTok and only broadens to Pangle explicitly", () => {
    assert.equal(buildCreatePayload("tiktok", base).tiktok_placement, "tiktok");
    assert.equal(
      buildCreatePayload("tiktok", {
        ...base,
        creative: { ...base.creative, tiktokPlacement: "tiktok_pangle" },
      }).tiktok_placement,
      "tiktok_pangle",
    );
    assert.equal(
      buildCreatePayload("tiktok", {
        ...base,
        creative: { ...base.creative, tiktokPlacement: "invented" },
      }).tiktok_placement,
      "tiktok",
    );
  });

  it("surfaces both choices and blocks TikTok-only image progress", () => {
    const step = readFileSync(
      new URL("../components/campaign-builder/StepCreative.jsx", import.meta.url),
      "utf8",
    );
    const page = readFileSync(
      new URL("../pages/CampaignBuilderPage.jsx", import.meta.url),
      "utf8",
    );
    assert.match(step, /TikTok only/);
    assert.match(step, /TikTok \+ Pangle/);
    assert.match(step, /tiktokPlacement: option\.value/);
    assert.match(page, /creative\.tiktokPlacement !== "tiktok_pangle"/);
    assert.match(page, /TikTok-only needs a video/);
  });
});
