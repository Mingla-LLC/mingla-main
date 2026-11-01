import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const root = new URL("../../../../../", import.meta.url);
const read = (path: string): string =>
  Deno.readTextFileSync(new URL(path, root));

const detail = read("app-mobile/app/purchases/[kind]/[id].tsx");

Deno.test("#4174 ticket cards render image and video cover thumbnails", () => {
  const service = read("app-mobile/src/services/purchasesService.ts");
  const timeline = read("app-mobile/src/utils/purchaseTimeline.ts");
  const purchases = read("app-mobile/src/components/purchases/PurchaseCard.tsx");
  const profile = read("app-mobile/src/components/profile/PurchasesCard.tsx");
  const calendar = read("app-mobile/src/components/activity/BusinessEventCalendarRow.tsx");

  assertStringIncludes(service, "cover_media_url, cover_media_type");
  assertStringIncludes(timeline, "coverMediaType: order.coverMediaType ?? null");
  for (const surface of [purchases, profile, calendar]) {
    assertStringIncludes(surface, "<EventCoverMedia");
    assertStringIncludes(surface, "playbackActive={false}");
  }
});

Deno.test("#4174 online access and the native event page are separate actions", () => {
  assertStringIncludes(detail, "Linking.openURL(order.onlineUrl as string)");
  assertStringIncludes(detail, 't("ticket.openLink")');
  assertStringIncludes(detail, 't("ticket.openEventPage")');
  assertStringIncludes(detail, "explorerOfferingPath(");
  assertStringIncludes(detail, 'captureQuietAction("event_page")');
});

Deno.test("#4174 physical tickets always navigate using their displayed address", () => {
  const maps = read("packages/offering-rendering/mapsDeepLink.ts");
  assertStringIncludes(detail, "<Text style={styles.venueText}>{order.locationText}</Text>");
  assertStringIncludes(detail, "useVenueMapsActions({");
  assertStringIncludes(detail, "openMapsTarget(target, { app })");
  assertStringIncludes(detail, "<MapsAppChooserDialog");
  assertStringIncludes(detail, "styles.venueMapsAction");
  assertStringIncludes(maps, 'apple: "Apple Maps"');
  assertStringIncludes(maps, 'google: "Google Maps"');
});

Deno.test("#4174 ticket help and a followed-brand tap open the native brand page", () => {
  assertStringIncludes(detail, "router.push(`/b/${encodeURIComponent(followedBrandSlug)}`");
  assertStringIncludes(detail, "if (brandFollow.isFollowing)");
  assertStringIncludes(detail, "handleOpenBrandPage();");
  assertStringIncludes(detail, "brandFollow.follow()");
  assert(!detail.includes("brandFollow.toggle()"));
  assert(!detail.includes("https://usemingla.com/help"));
});

Deno.test("#4174 earning card is absent without a live buyer offer", () => {
  const card = read("app-mobile/src/components/wallet/EarnBySharingCard.tsx");
  assertStringIncludes(card, "fetchBuyerReferralLink");
  assertStringIncludes(card, "if (!offer.data) return null");
  assertStringIncludes(card, "shareCanonicalFallback");
  assert(!card.includes("does not have an earning offer right now"));
});
