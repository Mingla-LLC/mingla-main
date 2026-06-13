/**
 * [TEST-MOD-APPROVED ORCH-1119]
 *
 * TESTER ADVERSARIAL — ORCH-1119 [trip-day-media-gallery].
 *
 * Different angle than the implementor's two tests
 * (orch1119_trip_day_media_persistence.test.ts = persistence source-grep + diff
 *  happy-paths; orch1119_trip_day_media_gallery.test.tsx = consumer render + a
 *  hand-written REPLICA of coerceTripDayMedia).
 *
 * This test attacks the ACTUAL `coerceTripDayMedia` BOUNDARY by extracting the
 * REAL function bytes from tripsService.ts source and EXECUTING them (not a
 * replica). It is the data-integrity gate for the anon-readable `trip_days.media`
 * column (I-PROPOSED-TRIP-DAY-MEDIA-EXPLICIT-TYPE + Constitution #9): a poisoned
 * jsonb array stored in the DB MUST be sanitized to only well-formed
 * {url:string, type:"image"|"video"} items before any surface renders it.
 *
 * Hostile inputs the implementor did NOT cover:
 *   - `type` as a number / array / object / null / "Image"(wrong-case) /
 *     "gif"(unsupported, must be remapped to image UPSTREAM, never stored raw)
 *   - `url` as a String-wrapper object / number / empty string / whitespace-only
 *   - prototype-pollution attempt (`__proto__`) inside an item
 *   - deeply nested / array items / boolean items
 *   - a huge (10k) array — coercer must not throw and must drop all malformed
 *
 * FAILS-ON-REVERT: deleting the `type !== "image" && type !== "video"` guard OR
 * the `typeof url !== "string"` guard in the REAL tripsService.ts source makes
 * the extracted function let poisoned items through → these assertions FAIL.
 *
 * Why extract-and-eval rather than import: tripsService.ts imports the native
 * supabase client (cannot load in node-jest). Extracting the pure function's
 * source and eval-ing it executes the SAME bytes the app ships, so a revert in
 * source is reflected here — unlike a hand-copied replica.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

/** Extract the real coerceTripDayMedia source from tripsService.ts, strip the
 *  TS type annotations, and return an executable copy of the SHIPPED bytes. */
function loadRealCoercer(): (raw: unknown) => Array<{ url: string; type: string }> {
  const src = readFileSync(
    join(REPO_ROOT, "mingla-business/src/services/tripsService.ts"),
    "utf8",
  );
  const start = src.indexOf("export function coerceTripDayMedia");
  expect(start).toBeGreaterThan(-1);
  // Capture the function body up to and including its closing brace at col 0.
  const after = src.slice(start);
  const endMarker = "\n}\n";
  const end = after.indexOf(endMarker);
  expect(end).toBeGreaterThan(-1);
  let body = after.slice(0, end + endMarker.length);

  // Strip TS-only syntax so the body runs as plain JS (behavior unchanged):
  //  - `export function name(raw: unknown): TripDayMedia[] {` → `function name(raw) {`
  //  - `const out: TripDayMedia[] = []` → `const out = []`
  //  - `item as Record<string, unknown>` → `item`
  //  - `const next: TripDayMedia = {` → `const next = {`
  body = body
    .replace(/export\s+function/, "function")
    .replace(/coerceTripDayMedia\(raw:\s*unknown\):\s*TripDayMedia\[\]/, "coerceTripDayMedia(raw)")
    .replace(/const out:\s*TripDayMedia\[\]\s*=/, "const out =")
    .replace(/item as Record<string,\s*unknown>/, "item")
    .replace(/const next:\s*TripDayMedia\s*=/, "const next =");

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const factory = new Function(`${body}\nreturn coerceTripDayMedia;`);
  return factory() as (raw: unknown) => Array<{ url: string; type: string }>;
}

const coerce = loadRealCoercer();

describe("ORCH-1119 tester-adversarial — coerceTripDayMedia boundary (REAL bytes)", () => {
  test("type as non-string-literal (number/array/object/null/bool) is DROPPED", () => {
    const poison = [
      { url: "https://x/a.jpg", type: 1 },
      { url: "https://x/b.jpg", type: ["image"] },
      { url: "https://x/c.jpg", type: { kind: "image" } },
      { url: "https://x/d.jpg", type: null },
      { url: "https://x/e.jpg", type: true },
      { url: "https://x/f.jpg", type: "Image" }, // wrong case
      { url: "https://x/g.jpg", type: "gif" }, // unsupported raw type (must be image upstream)
      { url: "https://x/h.jpg", type: "video " }, // trailing space
    ];
    expect(coerce(poison)).toEqual([]);
  });

  test("url as non-string / empty / String-wrapper is DROPPED", () => {
    const poison = [
      { url: 123, type: "image" },
      { url: "", type: "image" },
      // eslint-disable-next-line no-new-wrappers
      { url: new String("https://x/wrap.jpg"), type: "video" }, // typeof === 'object'
      { url: null, type: "image" },
      { url: undefined, type: "video" },
      { url: ["https://x/arr.jpg"], type: "image" },
    ];
    expect(coerce(poison)).toEqual([]);
  });

  test("non-object items (string/number/array/bool/null) are DROPPED, never throw", () => {
    const poison = ["junk", 42, true, null, ["nested"], undefined];
    expect(coerce(poison)).toEqual([]);
  });

  test("prototype-pollution attempt is neutralized (no proto leak, item dropped)", () => {
    const before = ({} as Record<string, unknown>).polluted;
    const poison = JSON.parse(
      '[{"url":"https://x/p.jpg","type":"image","__proto__":{"polluted":"yes"}}]',
    );
    const out = coerce(poison);
    // The well-formed url+type survives, but no prototype pollution occurred.
    expect(out).toEqual([{ url: "https://x/p.jpg", type: "image" }]);
    expect(({} as Record<string, unknown>).polluted).toBe(before);
  });

  test("well-formed items survive with ONLY whitelisted fields (extra keys stripped)", () => {
    const out = coerce([
      {
        url: "https://x/ok.mp4",
        type: "video",
        provider: "library",
        width: 100,
        height: 50,
        evil: "drop-me",
        onLoad: "() => steal()",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      url: "https://x/ok.mp4",
      type: "video",
      provider: "library",
      width: 100,
      height: 50,
    });
    expect((out[0] as Record<string, unknown>).evil).toBeUndefined();
    expect((out[0] as Record<string, unknown>).onLoad).toBeUndefined();
  });

  test("a 10k mixed array does not throw and keeps ONLY the well-formed entries in order", () => {
    const big: unknown[] = [];
    for (let i = 0; i < 5000; i++) {
      big.push({ url: `https://x/good-${i}.jpg`, type: i % 2 === 0 ? "image" : "video" });
      big.push({ url: 42, type: "image" }); // poison interleaved
    }
    const out = coerce(big);
    expect(out).toHaveLength(5000);
    expect(out[0]).toEqual({ url: "https://x/good-0.jpg", type: "image" });
    expect(out[1]).toEqual({ url: "https://x/good-1.jpg", type: "video" });
    // every survivor carries an explicit valid type (the renderer never auto-detects)
    expect(out.every((m) => m.type === "image" || m.type === "video")).toBe(true);
  });

  test("non-array raw (object/string/null/number) returns []", () => {
    expect(coerce({ url: "https://x/x.jpg", type: "image" })).toEqual([]);
    expect(coerce("https://x/x.jpg")).toEqual([]);
    expect(coerce(null)).toEqual([]);
    expect(coerce(undefined)).toEqual([]);
    expect(coerce(7)).toEqual([]);
  });
});
