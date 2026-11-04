// #3682 wave 2 — a brand invite or campaign push opens the offering (or the
// brand page) in Explorer from the public slugs the push carries; a garbled
// payload lands on Home, never a dead tap.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { parseDeepLink, typeFallbackDestination } from "../deepLinkService.ts";

const ladder = (type: string, data: Record<string, unknown>) => {
  const link = typeof data.deepLink === "string" ? data.deepLink : null;
  return (link ? parseDeepLink(link) : null) ?? typeFallbackDestination(type, data);
};

Deno.test("#3682 brand invite push opens the offering page", () => {
  assertEquals(
    ladder("brand_offering_invite", {
      deepLink: "https://host.usemingla.com/e/harmattanclub/rooftop-night",
      brand_slug: "harmattanclub",
      event_slug: "rooftop-night",
    }),
    { kind: "route", path: "/e/harmattanclub/rooftop-night" },
  );
});

Deno.test("#3682 campaign push without an offering opens the brand page", () => {
  assertEquals(
    ladder("brand_campaign_push", { brand_slug: "harmattanclub" }),
    { kind: "route", path: "/b/harmattanclub" },
  );
});

Deno.test("#3682 a garbled slug falls back to Home", () => {
  assertEquals(
    ladder("brand_campaign_push", { brand_slug: "../../etc" }),
    { kind: "page", page: "home" },
  );
});
