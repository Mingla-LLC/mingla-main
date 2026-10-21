import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string): Promise<string> =>
  Deno.readTextFile(new URL(path, root));

Deno.test(
  "#4037 consumer capture remains cookieless and aggregate-only",
  async () => {
    const source = await read("services/offeringEngagementService.ts");
    assertStringIncludes(source, '"app_impression" | "app_open"');
    assertStringIncludes(
      source,
      'surface: Platform.OS === "ios" ? "consumer_ios" : "consumer_android"',
    );
    for (const forbidden of [
      "AsyncStorage",
      "localStorage",
      "cookie",
      "postHogService",
      "mixpanelService",
    ]) {
      assert(
        !source.includes(forbidden),
        `capture service must not use ${forbidden}`,
      );
    }
  },
);

Deno.test(
  "#4037 Discover cards require 50 percent for one second",
  async () => {
    const [stays, trips, events, deck] = await Promise.all([
      read("components/discover/StaysContent.tsx"),
      read("components/discover/TripsContent.tsx"),
      read("components/DiscoverScreen.tsx"),
      read("components/SwipeableCards.tsx"),
    ]);
    for (const source of [stays, trips]) {
      assertStringIncludes(source, "itemVisiblePercentThreshold: 50");
      assertStringIncludes(source, "minimumViewTime: 1_000");
      assertStringIncludes(source, '"app_impression"');
      assertStringIncludes(source, '"app_open"');
    }
    assertStringIncludes(events, "visible >= layout.height * 0.5");
    assertStringIncludes(events, "}, 1_000);");
    assertStringIncludes(events, 'entityType: "event"');
    assertStringIncludes(deck, "currentRec as Recommendation");
    assertStringIncludes(deck, "}, 1_000);");
    assertStringIncludes(deck, "entityType: 'experience'");
    assertEquals(
      (events.match(/captureConsumerOfferingEngagement/g) ?? []).length >= 3,
      true,
    );
  },
);
