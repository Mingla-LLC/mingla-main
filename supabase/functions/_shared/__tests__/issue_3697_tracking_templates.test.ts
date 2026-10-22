import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { META_URL_TAGS } from "../meta.ts";

const requiredMeta = [
  "utm_source=facebook",
  "utm_medium=paid",
  "utm_campaign={{campaign.name}}",
  "utm_content={{ad.name}}",
  "mc_id={{campaign.id}}",
  "campaign_id={{campaign.id}}",
  "adset_id={{adset.id}}",
  "ad_id={{ad.id}}",
];

Deno.test("#3697 Meta link template carries UTMs plus campaign, ad-set and ad ids", () => {
  for (const token of requiredMeta) {
    assert(META_URL_TAGS.includes(token), token);
  }
});

Deno.test("#3697 Snap link template carries UTMs plus campaign, squad and ad ids", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const match = /const snapTrackedDestUrlS = `([\s\S]*?)`;/m.exec(source);
  assert(match, "Snap tracked destination template missing");
  const template = match[1].replace(/\s+/g, "");
  for (
    const token of [
      "utm_source=snapchat",
      "utm_medium=paid_social",
      "utm_campaign={{campaign.id}}",
      "utm_content={{ad.id}}",
      "mc_id={{campaign.id}}",
      "campaign_id={{campaign.id}}",
      // Snap's WEB_VIEW creative contract names its squad macro `adSet.id`.
      "ad_squad_id={{adSet.id}}",
      "ad_id={{ad.id}}",
    ]
  ) assert(template.includes(token), token);
  // Snap documents automatic ScCid append. Until Seth resolves #3697's exact
  // authored-link choice, never emit a blank ScCid that can mask that value.
  assertNotMatch(template, /ScCid=(?:&|$)/i);
});

Deno.test("#3697 TikTok link template carries UTMs plus campaign, ad-group and ad ids", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  for (
    const entry of [
      '{ key: "utm_source", value: "tiktok" }',
      '{ key: "utm_medium", value: "paid" }',
      '{ key: "utm_campaign", value: "__CAMPAIGN_ID__" }',
      '{ key: "utm_content", value: "__CID__" }',
      '{ key: "mc_id", value: "__CAMPAIGN_ID__" }',
      '{ key: "campaign_id", value: "__CAMPAIGN_ID__" }',
      '{ key: "adset_id", value: "__AID__" }',
      '{ key: "ad_id", value: "__CID__" }',
    ]
  ) assert(source.includes(entry), entry);
});

Deno.test("#3697 landing capture accepts provider click ids without case loss", async () => {
  const business = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/analytics/webAnalytics.web.ts",
      import.meta.url,
    ),
  );
  const capture = await Deno.readTextFile(
    new URL("../../attribution-capture/index.ts", import.meta.url),
  );
  assertMatch(business, /fbclid/);
  assertMatch(business, /ttclid/);
  assertMatch(
    business,
    /params\.get\("sccid"\)\s*\?\?\s*params\.get\("ScCid"\)/,
  );
  assertMatch(capture, /external_click_id/);
  assertEquals(
    business.includes("const external = fbclid ?? ttclid ?? sccid"),
    true,
  );
});
