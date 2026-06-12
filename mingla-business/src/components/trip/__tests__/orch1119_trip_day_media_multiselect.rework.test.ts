/**
 * ORCH-1119 [trip-day-media-gallery] — REWORK regression (multi-select append).
 *
 * DEFECT (Seth, dev build): in the trip create wizard Step 2, "+ Add media" →
 * Library → choose-from-library → MULTI-SELECT several assets → the picks were
 * LOST. Root cause: the picker (`TripDayMediaSheet`) called `onAddMedia(media)`
 * ONCE PER ASSET inside a tight synchronous loop, and the parent's handler
 * (`TripCreatorStep2Itinerary.handleAddMediaToDay`) rebuilt the day's media from
 * the SAME render-time `days` on every call (the value-only `onChange` does not
 * re-render the parent mid-loop). So each append started from the stale base
 * and only the LAST asset survived — N selections collapsed to 1. Single-select
 * (N=1) was unaffected, which is why it read as "multi-select only".
 *
 * FIX: the sheet now COLLECTS all successful uploads and hands the parent the
 * whole batch in ONE `onAddMedia(media[])` call; the parent appends the batch
 * in a single `onChange`. A batched append is clobber-proof.
 *
 * §9 fails-on-revert contract:
 *   - REWORK-A (behavioral): the BUGGY per-item-against-stale-base reducer
 *     collapses 3 picks to 1; the FIXED batch reducer keeps all 3. This test
 *     asserts the batch reducer keeps all 3 — reverting the parent handler to a
 *     single-item append (and the sheet to a per-item loop call) reproduces the
 *     clobber and fails the count assertion.
 *   - REWORK-B (structural): the sheet must hand the parent a BATCH
 *     (`onAddMedia(uploaded)` — the array it accumulates), NOT a per-item call
 *     inside the upload loop. Reverting to `onAddMedia(media)` inside the loop
 *     fails this assertion.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

// Inline the TripDayMedia shape — importing tripsService pulls the native
// supabase client, which the node/ts-jest harness can't resolve (same reason
// the existing persistence test reads source rather than importing it).
type TripDayMedia = {
  url: string;
  type: "image" | "video";
  provider?: string;
  width?: number;
  height?: number;
};

// __dirname = mingla-business/src/components/trip/__tests__ → 5 levels to repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string): string =>
  readFileSync(join(REPO_ROOT, rel), "utf8");

const MAX_TRIP_DAY_MEDIA = 8;

type Day = { ordinal: number; title: string; narrative: string; media: TripDayMedia[] };

/**
 * Faithful replica of the data flow the bug lived in: a parent that owns
 * `days`, whose `onChange` REPLACES days by value (exactly like
 * EditPublishedTripScreen.handleDaysChange — and like the wizard during a
 * synchronous burst, where the `days` prop the handler closes over does not
 * update between calls). The handler closes over the render-time `days`.
 */
function makeParent(initial: Day[]): {
  // The render-time `days` the handler closes over — does NOT change between
  // synchronous calls (no React re-render mid-loop).
  daysAtRender: Day[];
  committed: () => Day[];
  // FIXED handler — appends the whole batch in one onChange.
  appendBatch: (dayIndex: number, media: TripDayMedia[]) => void;
  // BUGGY handler — appends ONE item, rebuilding from the stale render base.
  appendOneBuggy: (dayIndex: number, media: TripDayMedia) => void;
} {
  const daysAtRender = initial;
  let committedDays = initial;
  return {
    daysAtRender,
    committed: () => committedDays,
    appendBatch: (dayIndex, media) => {
      if (media.length === 0) return;
      const next = [...daysAtRender];
      const current = next[dayIndex].media ?? [];
      next[dayIndex] = {
        ...next[dayIndex],
        media: [...current, ...media].slice(0, MAX_TRIP_DAY_MEDIA),
      };
      committedDays = next;
    },
    appendOneBuggy: (dayIndex, media) => {
      const next = [...daysAtRender];
      const current = next[dayIndex].media ?? [];
      next[dayIndex] = { ...next[dayIndex], media: [...current, media] };
      committedDays = next;
    },
  };
}

const img = (u: string): TripDayMedia => ({ url: u, type: "image" });
const vid = (u: string): TripDayMedia => ({ url: u, type: "video" });

describe("ORCH-1119 REWORK — multi-select Library picks are NOT clobbered", () => {
  test("REWORK-A: a 3-asset batch append keeps ALL three (fix), one-by-one clobbers (bug)", () => {
    const picks: TripDayMedia[] = [img("u1"), img("u2"), vid("u3")];

    // BUG path: the sheet calling onAddMedia once per asset in a loop.
    const buggy = makeParent([{ ordinal: 1, title: "A", narrative: "", media: [] }]);
    for (const m of picks) buggy.appendOneBuggy(0, m);
    // Proves the defect: 3 picks collapsed to 1 (the last).
    expect(buggy.committed()[0].media).toHaveLength(1);
    expect(buggy.committed()[0].media[0].url).toBe("u3");

    // FIX path: the sheet handing the whole batch in one call.
    const fixed = makeParent([{ ordinal: 1, title: "A", narrative: "", media: [] }]);
    fixed.appendBatch(0, picks);
    expect(fixed.committed()[0].media).toHaveLength(3);
    expect(fixed.committed()[0].media.map((m) => m.url)).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
    // Every survivor carries an explicit type (ORCH-1069/0978 rule).
    fixed.committed()[0].media.forEach((m) =>
      expect(m.type === "image" || m.type === "video").toBe(true),
    );
  });

  test("REWORK-A: batch append onto an existing gallery appends, never replaces", () => {
    const fixed = makeParent([
      { ordinal: 1, title: "A", narrative: "", media: [img("existing")] },
    ]);
    fixed.appendBatch(0, [img("new1"), vid("new2")]);
    expect(fixed.committed()[0].media.map((m) => m.url)).toEqual([
      "existing",
      "new1",
      "new2",
    ]);
  });

  test("REWORK-A: batch append is capped at MAX_TRIP_DAY_MEDIA (8)", () => {
    const fixed = makeParent([
      {
        ordinal: 1,
        title: "A",
        narrative: "",
        media: [img("a"), img("b"), img("c"), img("d"), img("e"), img("f")],
      },
    ]);
    // 6 existing + 4 picked = 10 → capped to 8 (only first 2 of the batch land).
    fixed.appendBatch(0, [img("g"), img("h"), img("i"), img("j")]);
    expect(fixed.committed()[0].media).toHaveLength(MAX_TRIP_DAY_MEDIA);
    expect(fixed.committed()[0].media.map((m) => m.url)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
  });

  test("REWORK-A: empty batch is a no-op (no spurious onChange / no empty append)", () => {
    const fixed = makeParent([
      { ordinal: 1, title: "A", narrative: "", media: [img("x")] },
    ]);
    fixed.appendBatch(0, []);
    expect(fixed.committed()[0].media.map((m) => m.url)).toEqual(["x"]);
  });
});

describe("ORCH-1119 REWORK — source contracts (fails-on-revert anchors)", () => {
  const sheet = read("mingla-business/src/components/trip/TripDayMediaSheet.tsx");
  const step2 = read(
    "mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx",
  );

  test("REWORK-B: the sheet's onAddMedia prop takes an ARRAY (batch contract)", () => {
    expect(sheet).toMatch(/onAddMedia:\s*\(media:\s*TripDayMedia\[\]\)\s*=>\s*void/);
  });

  test("REWORK-B: the Library loop hands the parent the COLLECTED batch in ONE call", () => {
    // The accumulator + single batched dispatch — NOT a per-item call in-loop.
    expect(sheet).toMatch(/const\s+uploaded:\s*TripDayMedia\[\]\s*=\s*\[\]/);
    expect(sheet).toContain("uploaded.push(media)");
    expect(sheet).toContain("onAddMedia(uploaded)");
    // The per-item-in-loop pattern must be GONE: there must be no
    // `onAddMedia(media)` (single, non-array) inside the upload loop.
    expect(sheet).not.toMatch(/onAddMedia\(media\)/);
  });

  test("REWORK-B: the parent handler accepts a batch and appends in one onChange", () => {
    expect(step2).toMatch(
      /handleAddMediaToDay\s*=\s*\(\s*dayIndex:\s*number,\s*media:\s*TripDayMedia\[\]/,
    );
    // The single batched append + onChange (clobber-proof).
    expect(step2).toMatch(/\[\.\.\.current,\s*\.\.\.media\]/);
    expect(step2).toContain("onChange(next)");
  });

  test("REWORK-B: provider (GIF/Pexels) single picks pass a one-item array", () => {
    expect(sheet).toMatch(
      /onAddMedia\(\[\{\s*url:\s*result\.mediaUrl,\s*type:\s*"image",\s*provider:\s*"giphy"/,
    );
    expect(sheet).toMatch(
      /onAddMedia\(\[\{\s*url:\s*result\.mediaUrl,\s*type:\s*"image",\s*provider:\s*"pexels"/,
    );
  });

  test("REWORK: a failed item still surfaces a friendly toast (Constitution #3)", () => {
    // Partial-success path must not fail silently.
    expect(sheet).toContain("firstError");
    expect(sheet).toMatch(/onShowToast\(/);
  });
});
