// #4490 07-L tester adversarial: copy_venue_cover runs with the service role,
// so it must only ever copy the brand's own venue cover object
// (brand_covers/<brand>/...). A venue cover URL is host-supplied text
// (biz_create_venue_listing only checks https), so a URL naming a private
// bucket or another brand's folder must be refused before any download.
// Seen 20 Nov on the local stack: a cover URL of
// https://evil.example/storage/v1/object/public/support-attachments/<path>
// made the edge copy a private support attachment into public event_covers.
// Fails until the copy is limited to brand_covers/<event brand>/.
import { assert, assertEquals } from "jsr:@std/assert@1";

import { storageObjectOf, venueCoverRefusal } from "./index.ts";

const event = { brand_id: "b1", venue_id: "v1", event_type: "event", deleted_at: null };
const base = "https://evil.example/storage/v1/object/public/";
const refusalFor = (url: string, type = "image", poster: string | null = null) =>
  venueCoverRefusal({
    rank: 40,
    managerRank: 40,
    event,
    venue: { brand_id: "b1", cover_media_url: url, cover_media_type: type, cover_media_poster_url: poster ?? url },
    venueId: "v1",
  });
// The copy is allowed only when the refusal is null AND the object parses into brand_covers/b1/.
const copyAllowed = (url: string, type = "image", poster: string | null = null) => {
  if (refusalFor(url, type, poster) !== null) return false;
  const o = storageObjectOf(url);
  const p = storageObjectOf(poster ?? url);
  return o !== null && p !== null;
};

Deno.test("07-L adv: the brand's own venue cover can still be copied", () => {
  assertEquals(copyAllowed(`${base}brand_covers/b1/v1/cover.jpg`), true);
});

for (const bucket of ["support-attachments", "career-cvs", "ticket-pdfs", "brand-people-exports", "team-files"]) {
  Deno.test(`07-L adv: a cover URL naming the private bucket ${bucket} is refused`, () => {
    assert(!copyAllowed(`${base}${bucket}/someone/file.png`), `${bucket} object would be copied into public event_covers`);
  });
}

Deno.test("07-L adv: another brand's folder in brand_covers is refused", () => {
  assert(!copyAllowed(`${base}brand_covers/b2/v9/cover.jpg`), "another brand's cover object would be copied");
});

Deno.test("07-L adv: a GIF whose poster names a private bucket is refused", () => {
  assert(!copyAllowed(`${base}brand_covers/b1/v1/cover.gif`, "gif", `${base}support-attachments/x/poster.png`));
});
