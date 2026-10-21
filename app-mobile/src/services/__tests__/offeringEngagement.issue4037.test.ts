import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string): string =>
  readFileSync(join(process.cwd(), "src", path), "utf8");

describe("#4037 consumer aggregate capture", () => {
  it("remains cookieless and aggregate-only", () => {
    const source = read("services/offeringEngagementService.ts");
    assert.match(source, /"app_impression" \| "app_open"/);
    assert.ok(
      source.includes(
        'surface: Platform.OS === "ios" ? "consumer_ios" : "consumer_android"',
      ),
    );
    for (const forbidden of [
      "AsyncStorage",
      "localStorage",
      "cookie",
      "postHogService",
      "mixpanelService",
    ]) {
      assert.ok(
        !source.includes(forbidden),
        `capture service must not use ${forbidden}`,
      );
    }
  });

  it("requires 50 percent visibility for one second on Discover cards", () => {
    const [stays, trips, events, deck] = [
      read("components/discover/StaysContent.tsx"),
      read("components/discover/TripsContent.tsx"),
      read("components/DiscoverScreen.tsx"),
      read("components/SwipeableCards.tsx"),
    ];
    for (const source of [stays, trips]) {
      assert.ok(source.includes("itemVisiblePercentThreshold: 50"));
      assert.ok(source.includes("minimumViewTime: 1_000"));
      assert.ok(source.includes('"app_impression"'));
      assert.ok(source.includes('"app_open"'));
    }
    assert.ok(events.includes("visible >= layout.height * 0.5"));
    assert.ok(events.includes("}, 1_000);"));
    assert.ok(events.includes('entityType: "event"'));
    assert.ok(deck.includes("currentRec as Recommendation"));
    assert.ok(deck.includes("}, 1_000);"));
    assert.ok(deck.includes("entityType: 'experience'"));
    assert.ok(
      (events.match(/captureConsumerOfferingEngagement/g) ?? []).length >= 3,
    );
  });
});
