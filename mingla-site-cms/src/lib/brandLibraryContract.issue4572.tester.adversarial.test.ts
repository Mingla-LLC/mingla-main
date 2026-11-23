/*
 * #4572 item 3 (D3) — tester adversarial: the Core → Studio library contract.
 *
 * The implementor suites test each side alone (Core's brandLibrarySources in
 * Deno, Studio's parseLibrarySources here). This suite runs Core's real
 * builder and feeds its output to Studio's real parser, because the parser
 * refuses the WHOLE compose envelope on one bad entry: anything Core can emit
 * that Studio refuses breaks Build for that brand.
 *   C-1 ordinary brands and every hostile URL shape Core must drop round-trip.
 *   C-2 Core never emits more than Studio accepts (13), nor a label over 160.
 *   C-3 KNOWN DEFECT (QA FAIL on #4572): an event title or brand name with
 *       "<" or ">" ("Art <> Tech", "Love > Hate") makes Core emit a label
 *       Studio refuses, so compose returns VALIDATION_FAILED and Build fails.
 *       Written as it.fails so CI stays green while it is open: once Core
 *       (or Studio) strips/accepts those characters this turns RED, and the
 *       fix must flip it to it().
 */
import { describe, expect, it } from "vitest";
import { brandLibrarySources } from "../../../supabase/functions/brand-site-control/sitePlan.ts";
import { MAX_LIBRARY_SOURCES, parseLibrarySources } from "./brandLibrary";

const S = "https://abc.supabase.co/storage/v1/object/public";
const VIDEO = "0f5f3a0e-2b9c-4c1e-9d55-7a3f2c1b0e9d";

function event(i: number, title: string, extra: Record<string, unknown> = {}) {
  return { kind: "event", status: "scheduled", title, start_at: `2026-12-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`, cover: { path: `event_covers/e/${i}.jpg`, type: "image" }, ...extra };
}

describe("#4572 item 3 tester — what Core sends, Studio accepts", () => {
  it("C-1 an ordinary brand and hostile URL shapes round-trip (hostile ones are dropped by Core, never refused by Studio)", () => {
    const brand = {
      name: "Kolanut Gallery — Asokoro (Abuja) & Friends: \"Open\" 100%",
      profile_photo_url: `${S}/brand_avatars/b/logo.png?token=x#frag`,
      cover_media_type: "video",
      cover_media_poster_url: `https://vz-abc.b-cdn.net/${VIDEO}/thumbnail_480x.jpg`,
    };
    const offerings = [
      event(1, "Film club: 'Lagos at Night' — 18+ & free"),
      event(2, "Evil path", { cover: { path: "event_covers/../../etc/passwd", type: "image" } }),
      event(3, "Evil host", { cover: null, cover_stream_poster: { host: "evil.example.com", video_id: VIDEO, file: "thumbnail.jpg" } }),
      event(4, "Evil file", { cover: null, cover_stream_poster: { host: "vz-abc.b-cdn.net", video_id: VIDEO, file: "../thumbnail.jpg" } }),
      event(5, "Http still", { cover: null, cover_stream_poster: { host: "vz-abc.b-cdn.net", video_id: "not-a-uuid", file: "thumbnail.jpg" } }),
      event(6, "Other bucket", { cover: { path: "private_docs/e/6.jpg", type: "image" } }),
      { kind: "event", status: "scheduled", title: 42, cover: { path: "event_covers/e/7.jpg", type: "image" } },
    ];
    const sources = brandLibrarySources(brand, offerings);
    expect(parseLibrarySources(sources)).not.toBeNull();
    expect(sources.map((s) => s.kind)).toEqual(["brand_logo", "brand_cover", "event_flyer"]);
    // the logo URL had a query: Core's path rule reads the pathname only, the query never travels
    expect(sources.find((s) => s.kind === "brand_logo")).toEqual({ kind: "brand_logo", label: expect.stringMatching(/^Logo - /), path: "brand_avatars/b/logo.png" });
    // only the one clean flyer survives
    expect(sources.filter((s) => s.kind === "event_flyer").map((s) => s.label)).toEqual(["Flyer - Film club: 'Lagos at Night' — 18+ & free"]);
    for (const s of sources) {
      expect(JSON.stringify(s)).not.toMatch(/\.\.|evil|private_docs|token=/);
    }
  });

  it("C-2 Core never emits more than Studio accepts, and every label fits", () => {
    const long = "W".repeat(400);
    const sources = brandLibrarySources(
      { name: long, profile_photo_url: `${S}/brand_avatars/l.png`, cover_media_type: "image", cover_media_url: `${S}/brand_covers/c.jpg` },
      Array.from({ length: 40 }, (_, i) => event(i, `${long}${i}`)),
    );
    expect(sources.length).toBeLessThanOrEqual(MAX_LIBRARY_SOURCES);
    for (const s of sources) expect(s.label.length).toBeLessThanOrEqual(160);
    expect(parseLibrarySources(sources)).not.toBeNull();
    // one more than the cap is refused whole by Studio, so the cap on Core matters
    expect(parseLibrarySources([...sources, sources[0]])).toBeNull();
  });

  it.fails("C-3 KNOWN DEFECT: a '<' or '>' in an event title or brand name refuses the whole compose envelope", () => {
    for (const [name, title] of [["Gallery", "Art <> Tech night"], ["Love > Hate", "Opening"], ["A<b", "Talk"]]) {
      const sources = brandLibrarySources(
        { name, profile_photo_url: `${S}/brand_avatars/l.png`, cover_media_type: "image", cover_media_url: `${S}/brand_covers/c.jpg` },
        [event(1, title!)],
      );
      expect(parseLibrarySources(sources), `${name} / ${title}`).not.toBeNull();
    }
  });
});
