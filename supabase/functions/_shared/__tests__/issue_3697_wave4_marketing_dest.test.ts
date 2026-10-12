/**
 * toward #3697 Wave 4 — marketing page type, usemingla.com allowlist, create gate.
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AD_DESTINATION_PAGE_TYPES,
  AdDestinationError,
  MARKETING_BRAND_SLUG,
  MARKETING_ROUTES,
  MARKETING_WEB_ORIGIN,
  canonicalAdDestinationUrl,
  marketingRouteBySlug,
  marketingSlugFromPathname,
  resolveAdDestination,
} from "../adDestination.ts";
import { destinationStillPublicLive } from "../adChannel.ts";

Deno.test("Wave 4: marketing is a destination page type", () => {
  assertEquals(AD_DESTINATION_PAGE_TYPES.includes("marketing"), true);
  assertEquals(MARKETING_BRAND_SLUG, "mingla");
  assertEquals(MARKETING_WEB_ORIGIN, "https://usemingla.com");
  assertEquals(MARKETING_ROUTES.length >= 5, true);
});

Deno.test("Wave 4: allowlist resolves host/download/tools to usemingla.com", async () => {
  const host = await resolveAdDestination({}, {
    page_type: "marketing",
    brand_slug: "mingla",
    entity_slug: "host",
  });
  assertEquals(host.canonical_url, "https://usemingla.com/host");
  assertEquals(host.result_kind, "installs");
  assertEquals(host.brand_slug, "mingla");

  const download = await resolveAdDestination({}, {
    page_type: "marketing",
    entity_slug: "download",
  });
  assertEquals(download.canonical_url, "https://usemingla.com/download");

  const tools = await resolveAdDestination({}, {
    page_type: "marketing",
    brand_slug: "mingla",
    entity_slug: "tools-events",
  });
  assertEquals(tools.canonical_url, "https://usemingla.com/tools/events");
  assertEquals(tools.result_kind, "clicks");

  assertEquals(
    canonicalAdDestinationUrl("marketing", "mingla", "explorer"),
    "https://usemingla.com/",
  );
});

Deno.test("Wave 4: unknown marketing slug and wrong brand are rejected", async () => {
  await assertRejects(
    () =>
      resolveAdDestination({}, {
        page_type: "marketing",
        brand_slug: "mingla",
        entity_slug: "not-a-real-landing",
      }),
    AdDestinationError,
  );
  await assertRejects(
    () =>
      resolveAdDestination({}, {
        page_type: "marketing",
        brand_slug: "acme",
        entity_slug: "host",
      }),
    AdDestinationError,
  );
});

Deno.test("Wave 4: pathname → slug helper matches allowlist", () => {
  assertEquals(marketingSlugFromPathname("/host"), "host");
  assertEquals(marketingSlugFromPathname("/host/"), "host");
  assertEquals(marketingSlugFromPathname("/"), "explorer");
  assertEquals(marketingSlugFromPathname("/tools/pricing"), "tools-pricing");
  assertEquals(marketingSlugFromPathname("/blog"), null);
  assertEquals(marketingRouteBySlug("host-download")?.path, "/host/download");
});

Deno.test("Wave 4: destinationStillPublicLive accepts marketing allowlist", async () => {
  assertEquals(
    await destinationStillPublicLive({} as never, {
      dest_page_type: "marketing",
      dest_brand_slug: "mingla",
      dest_entity_slug: "host",
    }),
    true,
  );
  assertEquals(
    await destinationStillPublicLive({} as never, {
      dest_page_type: "marketing",
      dest_brand_slug: "mingla",
      dest_entity_slug: "nope",
    }),
    false,
  );
});

Deno.test("Wave 4: migration widens CHECKs and wraps resolve", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270818003697_issue_3697_wave4_marketing_destinations.sql",
      import.meta.url,
    ),
  );
  assertEquals(sql.includes("'marketing'"), true);
  assertEquals(sql.includes("ad_destination_resolve_wave1"), true);
  assertEquals(sql.includes("ad_marketing_route_rows"), true);
  assertEquals(sql.includes("https://usemingla.com"), true);
  assertEquals(sql.includes("CREATE OR REPLACE FUNCTION public.ad_advertisable_pages"), true);
});

Deno.test("Wave 4: create-campaign allowlist includes marketing", async () => {
  const src = await Deno.readTextFile(
    new URL(
      "../../admin-ad-create-campaign/index.ts",
      import.meta.url,
    ),
  );
  const needle =
    '["event", "rsvp", "trip", "experience", "brand", "venue", "reservation", "site", "marketing"]';
  let count = 0;
  let from = 0;
  while (true) {
    const i = src.indexOf(needle, from);
    if (i < 0) break;
    count += 1;
    from = i + needle.length;
  }
  assertEquals(count, 6);
});
