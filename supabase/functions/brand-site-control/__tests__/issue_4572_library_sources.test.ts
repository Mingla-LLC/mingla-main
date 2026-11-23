// #4572 item 3 (D3) — the brand's logo, cover still and event flyers for the
// website library: storage paths in brand_avatars|brand_covers|event_covers
// or a stream-CDN still; at most 11 flyers, newest first, 13 in all; anything
// else is left out. FAILS-ON-REVERT: without brandLibrarySources compose
// sends no library_sources.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brandLibrarySources } from "../sitePlan.ts";

const VIDEO = "0f5f3a0e-2b9c-4c1e-9d55-7a3f2c1b0e9d";
const S = "https://x.supabase.co/storage/v1/object/public";

Deno.test("#4572 logo, cover still and flyers, in order", () => {
  const sources = brandLibrarySources(
    { name: "Kolanut Gallery", profile_photo_url: `${S}/brand_avatars/b/logo.png`, cover_media_type: "video", cover_media_url: "https://vz-a.b-cdn.net/x.mp4", cover_media_poster_url: `https://vz-abc.b-cdn.net/${VIDEO}/thumbnail.jpg` },
    [
      { kind: "event", status: "scheduled", title: "Older", start_at: "2026-12-01T10:00:00Z", cover: { path: "event_covers/e/old.jpg", type: "image" } },
      { kind: "event", status: "scheduled", title: "Newer", start_at: "2026-12-06T10:00:00Z", cover: null, cover_stream_poster: { host: "vz-abc.b-cdn.net", video_id: VIDEO, file: "thumbnail_2.jpg" } },
      { kind: "event", status: "cancelled", title: "Gone", start_at: "2026-12-09T10:00:00Z", cover: { path: "event_covers/e/gone.jpg", type: "image" } },
      { kind: "trip", status: "scheduled", title: "Trip", start_at: "2026-12-10T10:00:00Z", cover: { path: "event_covers/t.jpg", type: "image" } },
    ],
  );
  assertEquals(sources.map((source) => source.kind), ["brand_logo", "brand_cover", "event_flyer", "event_flyer"]);
  assertEquals(sources[0], { kind: "brand_logo", label: "Logo - Kolanut Gallery", path: "brand_avatars/b/logo.png" });
  assertEquals(sources[1].stream_poster, { host: "vz-abc.b-cdn.net", video_id: VIDEO, file: "thumbnail.jpg" });
  assertEquals(sources[2].label, "Flyer - Newer");
  assertEquals(sources[3].path, "event_covers/e/old.jpg");
});

Deno.test("#4572 off-storage, dot-dot and foreign pictures are left out; at most 13", () => {
  const none = brandLibrarySources(
    { name: "X", profile_photo_url: "https://images.unsplash.com/a.jpg", cover_media_type: "image", cover_media_url: `${S}/brand_covers/../secret.jpg` },
    [{ kind: "event", status: "live", title: "Evil", cover_stream_poster: { host: "evil.example.com", video_id: VIDEO, file: "thumbnail.jpg" } }],
  );
  assertEquals(none, []);
  const many = brandLibrarySources({ name: "X", profile_photo_url: `${S}/brand_avatars/l.png`, cover_media_type: "image", cover_media_url: `${S}/brand_covers/c.jpg` },
    Array.from({ length: 20 }, (_, i) => ({ kind: "event", status: "scheduled", title: `E${i}`, start_at: `2026-12-${String(i + 1).padStart(2, "0")}T00:00:00Z`, cover: { path: `event_covers/e/${i}.jpg`, type: "image" } })));
  assertEquals(many.length, 13);
  assert(many.filter((source) => source.kind === "event_flyer").length === 11);
});
