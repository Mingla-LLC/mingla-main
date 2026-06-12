/**
 * ORCH-1119 [trip-day-media-gallery] — regression: per-day media MUST persist on
 * BOTH write paths, and the change-summary diff MUST be media-aware (additive).
 *
 * §9 fails-on-revert contract:
 *   - Reverting the upsertTripDays INSERT `media` key → P1 (the draft path
 *     silently drops galleries). This test reads the SOURCE of tripsService.ts
 *     and asserts the INSERT row object carries `media`.
 *   - Reverting the biz_update_live_trip §5b migration `media = EXCLUDED.media`
 *     → P1 (published-edit silently drops galleries). This test reads the
 *     migration SOURCE and asserts it carries `media = EXCLUDED.media` +
 *     `media)` in the INSERT column list.
 *   - Reverting computeTripDayDiffs media-awareness → a media-only edit produces
 *     NO diff. This test asserts a media-only change yields one `modified` diff
 *     with `mediaChanged:true`.
 *
 * Structural (source-grep) assertions are intentional: tripsService.ts imports
 * the native supabase client, so a behavioral round-trip can't run in this
 * node-env jest harness. The live DB round-trip is proven separately in the
 * implementation report's live-DB self-check.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { computeTripDayDiffs } from "../../utils/tripAdapter";
import type { TripDay, TripDayInput } from "../tripsService";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const read = (rel: string): string =>
  readFileSync(join(REPO_ROOT, rel), "utf8");

describe("ORCH-1119 — trip-day media persistence (draft path)", () => {
  test("upsertTripDays INSERT row object includes a media key", () => {
    const src = read("mingla-business/src/services/tripsService.ts");
    // The INSERT-row map literal in upsertTripDays must carry media. Reverting
    // this to the prior `stops: []`-only literal removes the `media:` key and
    // fails this assertion.
    const upsertIdx = src.indexOf("export async function upsertTripDays");
    expect(upsertIdx).toBeGreaterThan(-1);
    const upsertBody = src.slice(upsertIdx, upsertIdx + 1200);
    expect(upsertBody).toMatch(/media:\s*d\.media\s*\?\?\s*\[\]/);
  });
});

describe("ORCH-1119 — trip-day media persistence (published-edit RPC)", () => {
  test("biz_update_live_trip §5b migration upserts media", () => {
    const sql = read(
      "supabase/migrations/20260928000001_orch_1119_live_trip_media.sql",
    );
    // Column list must include media; conflict update must set media.
    expect(sql).toContain(
      "INSERT INTO public.trip_days (event_id, ordinal, title, narrative, media)",
    );
    expect(sql).toContain("media = EXCLUDED.media");
    // And it must still GRANT + reload (function tail intact).
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text)",
    );
  });
});

describe("ORCH-1119 — upload service rejects over-cap + unsupported (SC-3)", () => {
  const svc = read("mingla-business/src/services/tripDayMediaService.ts");
  test("25 MB byte cap is enforced before upload (no silent failure)", () => {
    expect(svc).toContain("TRIP_DAY_MEDIA_MAX_BYTES = 25 * 1024 * 1024");
    // A friendly file_too_large reject must precede any storage.upload call.
    const capIdx = svc.indexOf("file_too_large");
    const uploadIdx = svc.indexOf(".upload(");
    expect(capIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(capIdx).toBeLessThan(uploadIdx);
    expect(svc).toMatch(/under 25 MB/);
  });
  test("unsupported MIME is rejected with friendly copy", () => {
    expect(svc).toContain("unsupported_type");
    expect(svc).toMatch(/JPEG, PNG, WebP, GIF, MP4, MOV, or WebM/);
  });
  test("uploads to the event_covers bucket under trip-day-media/", () => {
    expect(svc).toContain('TRIP_DAY_MEDIA_BUCKET = "event_covers"');
    expect(svc).toContain("/trip-day-media/");
  });
  test("every returned item carries an explicit image|video type", () => {
    // The renderer never auto-detects (ORCH-1069/0978).
    expect(svc).toMatch(/type:\s*isVideoMime\(contentType\)\s*\?\s*"video"\s*:\s*"image"/);
  });
});

describe("ORCH-1119 — change-summary is media-aware (additive)", () => {
  const baseOldDay = (
    media: TripDay["media"],
  ): TripDay => ({
    id: "d1",
    eventId: "e1",
    ordinal: 1,
    title: "Arrival",
    narrative: "Settle in",
    date: null,
    stops: [],
    media,
  });

  test("media-only change yields one modified diff with mediaChanged:true", () => {
    const old: TripDay[] = [baseOldDay([])];
    const next: TripDayInput[] = [
      {
        ordinal: 1,
        title: "Arrival",
        narrative: "Settle in",
        media: [{ url: "https://x/v.mp4", type: "video" }],
      },
    ];
    const diffs = computeTripDayDiffs(old, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("modified");
    expect(diffs[0].mediaChanged).toBe(true);
    expect(diffs[0].oldMediaCount).toBe(0);
    expect(diffs[0].newMediaCount).toBe(1);
  });

  test("identical media + identical text yields NO diff", () => {
    const same = [{ url: "https://x/a.jpg", type: "image" as const }];
    const old: TripDay[] = [baseOldDay(same)];
    const next: TripDayInput[] = [
      { ordinal: 1, title: "Arrival", narrative: "Settle in", media: [...same] },
    ];
    expect(computeTripDayDiffs(old, next)).toHaveLength(0);
  });

  test("reorder is detected as a media change", () => {
    const a = { url: "https://x/a.jpg", type: "image" as const };
    const b = { url: "https://x/b.mp4", type: "video" as const };
    const old: TripDay[] = [baseOldDay([a, b])];
    const next: TripDayInput[] = [
      { ordinal: 1, title: "Arrival", narrative: "Settle in", media: [b, a] },
    ];
    const diffs = computeTripDayDiffs(old, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].mediaChanged).toBe(true);
  });
});
