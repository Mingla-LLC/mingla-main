// #4490 07-L: copy_venue_cover's checks and storage paths.
// Fails-on-revert: removing the `event.venue_id !== venueId` check lets a
// foreign venue through (the "event not at that venue" case fails).
import { assertEquals } from "jsr:@std/assert@1";

import { storageObjectOf, venueCoverRefusal } from "./index.ts";

const event = { brand_id: "b1", venue_id: "v1", event_type: "event", deleted_at: null };
const venue = { brand_id: "b1", cover_media_url: "https://x.supabase.co/storage/v1/object/public/brand_covers/b1/v1/cover.jpg", cover_media_type: "image", cover_media_poster_url: null };

Deno.test("07-L an event manager at the linked venue may copy its cover", () => {
  assertEquals(venueCoverRefusal({ rank: 40, managerRank: 40, event, venue, venueId: "v1" }), null);
});

Deno.test("07-L a foreign venue (event not at that venue) is refused", () => {
  assertEquals(venueCoverRefusal({ rank: 40, managerRank: 40, event, venue, venueId: "v2" }), "event_not_at_venue");
});

Deno.test("07-L another brand's venue is refused", () => {
  assertEquals(
    venueCoverRefusal({ rank: 40, managerRank: 40, event, venue: { ...venue, brand_id: "b2" }, venueId: "v1" }),
    "venue_not_found",
  );
});

Deno.test("07-L below event manager is refused; a missing event is not found", () => {
  assertEquals(venueCoverRefusal({ rank: 10, managerRank: 40, event, venue, venueId: "v1" }), "not_authorized");
  assertEquals(venueCoverRefusal({ rank: 40, managerRank: 40, event: null, venue, venueId: "v1" }), "event_not_found");
});

Deno.test("07-L a venue with no cover says so", () => {
  assertEquals(
    venueCoverRefusal({ rank: 40, managerRank: 40, event, venue: { ...venue, cover_media_url: null }, venueId: "v1" }),
    "venue_has_no_cover",
  );
});

Deno.test("07-L storage paths parse; traversal and foreign URLs do not", () => {
  assertEquals(storageObjectOf(venue.cover_media_url), { bucket: "brand_covers", path: "b1/v1/cover.jpg" });
  assertEquals(storageObjectOf("https://x.supabase.co/storage/v1/object/public/brand_covers/../event_covers/a.jpg"), null);
  assertEquals(storageObjectOf("https://images.pexels.com/photo.jpg"), null);
});
