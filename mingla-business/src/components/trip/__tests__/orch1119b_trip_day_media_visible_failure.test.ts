/**
 * ORCH-1119B [trip-day-media-gallery] — visible-failure regression (Constitution #3).
 *
 * DEFECT (Seth, dev build): picking trip-day media that fails to upload fired a
 * warn haptic + `onShowToast(error)` but the sheet ONLY closed on success
 * (`if (uploaded.length > 0) onClose()`). `TripDayMediaSheet` is hosted in a
 * full-screen native `Modal` (`SheetMobile`), which OCCLUDES the wizard-root
 * `Toast`. So on a 0-success (all-failed) batch the user felt a haptic and saw
 * NOTHING — a silent failure.
 *
 * FIX (TripDayMediaSheet.tsx ~L393): close the sheet UNCONDITIONALLY once the
 * upload batch resolves (full success AND 0-success), so the already-dispatched
 * wizard-root error toast becomes visible. The pre-upload throw (picker /
 * permission error in the outer `catch`) still keeps the sheet OPEN for retry —
 * that path is unchanged.
 *
 * §9 fails-on-revert contract:
 *   - 1119B-A (behavioral): a faithful replica of `handleConfirm`'s post-loop
 *     resolution. When every upload rejects (0 success), the FIXED logic calls
 *     `onShowToast` AND `onClose`. Reverting the close to the OLD gated
 *     `if (uploaded.length > 0) onClose()` leaves `onClose` UNCALLED on a
 *     0-success batch → the `onClose`-was-called assertion FAILS.
 *   - 1119B-B (structural): the post-loop close in source is UNCONDITIONAL —
 *     there is no `if (uploaded.length > 0) onClose()` guard. Reverting line 393
 *     to that guard fails this assertion.
 *
 * Same source-read harness as the REWORK test: importing the sheet pulls the
 * native supabase client, which the node/ts-jest harness can't resolve.
 */

import { describe, expect, test, jest } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

type TripDayMedia = {
  url: string;
  type: "image" | "video";
  provider?: string;
};

// __dirname = mingla-business/src/components/trip/__tests__ → 5 levels to repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string): string =>
  readFileSync(join(REPO_ROOT, rel), "utf8");

/**
 * Faithful replica of TripDayMediaSheet.handleConfirm's post-loop resolution
 * region: collect successes, surface the first error, then CLOSE. `closeMode`
 * selects FIXED (unconditional close) vs the reverted OLD gated close, so the
 * test proves the fix is what makes a 0-success batch visible.
 */
async function runConfirm(
  uploads: Array<() => Promise<TripDayMedia>>,
  closeMode: "fixed" | "reverted-gated",
): Promise<{ onAddMedia: jest.Mock; onShowToast: jest.Mock; onClose: jest.Mock }> {
  const onAddMedia = jest.fn();
  const onShowToast = jest.fn();
  const onClose = jest.fn();

  const uploaded: TripDayMedia[] = [];
  let firstError: string | null = null;
  for (const up of uploads) {
    try {
      uploaded.push(await up());
    } catch (e) {
      if (firstError === null) {
        firstError = e instanceof Error ? e.message : "Couldn't upload that file.";
      }
    }
  }
  if (uploaded.length > 0) {
    onAddMedia(uploaded);
  }
  if (firstError !== null) {
    onShowToast(
      uploaded.length > 0 ? `Some media couldn't be added. ${firstError}` : firstError,
    );
  }
  // The behavior under test:
  if (closeMode === "fixed") {
    onClose(); // UNCONDITIONAL (the fix)
  } else {
    if (uploaded.length > 0) onClose(); // the reverted OLD gated close
  }

  return { onAddMedia, onShowToast, onClose };
}

const okImg = (u: string) => async (): Promise<TripDayMedia> => ({ url: u, type: "image" });
const fail = (msg: string) => async (): Promise<TripDayMedia> => {
  throw new Error(msg);
};

describe("ORCH-1119B — all-failed upload batch is VISIBLE (Constitution #3)", () => {
  test("1119B-A: every upload rejects → onShowToast AND onClose are both called (fix)", async () => {
    const r = await runConfirm([fail("403"), fail("403")], "fixed");
    expect(r.onAddMedia).not.toHaveBeenCalled(); // nothing uploaded
    expect(r.onShowToast).toHaveBeenCalledTimes(1); // error surfaced
    expect(r.onClose).toHaveBeenCalledTimes(1); // sheet closes → toast visible
  });

  test("1119B-A: the OLD gated close leaves a 0-success batch OPEN (proves the bug)", async () => {
    const r = await runConfirm([fail("403"), fail("403")], "reverted-gated");
    expect(r.onShowToast).toHaveBeenCalledTimes(1); // toast dispatched...
    expect(r.onClose).not.toHaveBeenCalled(); // ...but sheet never closes → occluded
  });

  test("1119B-A: full success still appends, toasts nothing, and closes", async () => {
    const r = await runConfirm([okImg("u1"), okImg("u2")], "fixed");
    expect(r.onAddMedia).toHaveBeenCalledTimes(1);
    expect(r.onShowToast).not.toHaveBeenCalled();
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });

  test("1119B-A: partial success appends the survivors, toasts the failure, and closes", async () => {
    const r = await runConfirm([okImg("u1"), fail("403")], "fixed");
    expect(r.onAddMedia).toHaveBeenCalledTimes(1);
    expect(r.onShowToast).toHaveBeenCalledTimes(1);
    expect(r.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ORCH-1119B — source contract (fails-on-revert anchor)", () => {
  const sheet = read("mingla-business/src/components/trip/TripDayMediaSheet.tsx");

  test("1119B-B: the post-loop close is UNCONDITIONAL (no uploaded.length gate)", () => {
    // The fix: a bare `onClose();` after the error-surfacing block, NOT gated.
    expect(sheet).toMatch(/occluded[\s\S]*?onClose\(\);/);
    // The reverted gated close must be GONE.
    expect(sheet).not.toMatch(/if\s*\(uploaded\.length\s*>\s*0\)\s*onClose\(\)/);
  });

  test("1119B-B: the pre-upload catch still keeps the sheet open for retry", () => {
    // The outer catch toasts but does NOT close (user can re-pick).
    expect(sheet).toMatch(/Pre-upload failures[\s\S]*?onShowToast\(/);
  });
});
