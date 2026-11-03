import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ARI_RENDITION_BLOCK_TYPES,
  AriUiCapabilitiesV2,
  buildToolReadRendition,
} from "../ariRendition.ts";

const CAPABILITIES: AriUiCapabilitiesV2 = {
  protocol_version: 2,
  max_schema_version: 2,
  block_version: 1,
  action_version: 1,
  block_types: [...ARI_RENDITION_BLOCK_TYPES],
  graphic_types: ["event", "media", "site", "research", "social"],
  platform: "web",
  app_version: "1.1.6",
  runtime_version: "1.1.6",
};

const BRAND_ID = "14fee35b-73e6-465f-a50b-6b9517313a83";
const RAW_CODES =
  /not_set_up|not_available|brand_admin_or_owner|create_site_draft|Can Create From Chat|Setup Role|Website State/;

// The exact shape get_brand_site returns for a brand with no website.
const NOT_SET_UP = {
  website_state: "not_set_up",
  brand_id: BRAND_ID,
  can_create_from_chat: true,
  create_tool: "create_site_draft",
  setup_role: "brand_admin_or_owner",
  setup_screen: {
    name: "Website",
    location: "Brand profile → Website",
    route: `/brand/${BRAND_ID}/website`,
  },
};

Deno.test("#2830 a brand with no website reads in plain words, never internal codes", () => {
  const rendition = buildToolReadRendition({
    toolName: "get_brand_site",
    result: NOT_SET_UP,
    capabilities: CAPABILITIES,
    envValue: "true",
  });
  assert(rendition);
  assertEquals(rendition.title, "Your website isn't set up yet");
  const text = JSON.stringify(rendition);
  assert(!RAW_CODES.test(text), `raw code leaked: ${text}`);
  assert(text.includes("Brand owners and admins"));
  assert(!text.includes(BRAND_ID));
});

Deno.test("#2830 websites not available for a brand also read in plain words", () => {
  const rendition = buildToolReadRendition({
    toolName: "get_brand_site",
    result: {
      website_state: "not_available",
      brand_id: BRAND_ID,
      can_create_from_chat: false,
      interest_recorded: true,
      setup_role: null,
      setup_screen: null,
    },
    capabilities: CAPABILITIES,
    envValue: "true",
  });
  assert(rendition);
  assertEquals(rendition.title, "Websites aren't available for this brand yet");
  assert(!RAW_CODES.test(JSON.stringify(rendition)));
});

Deno.test("#2830 other tools keep the generic card", () => {
  const rendition = buildToolReadRendition({
    toolName: "get_sales_summary",
    result: { website_state: "not_set_up" },
    capabilities: CAPABILITIES,
    envValue: "true",
  });
  assert(rendition);
  assertEquals(rendition.title, "From your Mingla workspace");
});
