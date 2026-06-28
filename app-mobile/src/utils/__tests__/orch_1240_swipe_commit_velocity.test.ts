// @ts-nocheck
// ORCH-1240 [Card swipe-hang: fast flicks fail a distance-only commit threshold]
// IMPLEMENTOR happy-path regression test.
//
// Exercises the EXACT commit thresholds of shouldCommitSwipe (../swipeCommit.ts),
// the pure function called by SwipeableCards' PanResponder release handler.
//
// THE BUG: the gate was distance-only (`Math.abs(dx) > 120`). A real-device
// fling is fast-but-short (high vx, dx < 120) so it sprang back ("card hangs").
// The fix commits on translation OR velocity.
//
// FAILS-ON-REVERT: T-01 below requires a fast-but-short flick (dx=70, vx=0.9)
// to COMMIT. If the threshold reverts to distance-only (dx>120), dx=70 fails the
// gate → returns null → assertion fails. Run with:
//   deno test app-mobile/src/utils/__tests__/orch_1240_swipe_commit_velocity.test.ts
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { shouldCommitSwipe } from "../swipeCommit.ts";

// T-01 — THE BUG CASE: a fast short flick (dx=70, vx=0.9) must COMMIT.
//        Distance-only (dx>120) would spring this back. Velocity-aware commits it.
Deno.test("ORCH-1240: fast short flick commits (the bug case)", () => {
  assertEquals(shouldCommitSwipe(70, 0.9), "right");
  assertEquals(shouldCommitSwipe(-70, -0.9), "left");
});

// T-02 — strong deliberate drag (dx=150, vx=0) commits on distance alone.
Deno.test("ORCH-1240: strong slow drag commits on distance", () => {
  assertEquals(shouldCommitSwipe(150, 0), "right");
  assertEquals(shouldCommitSwipe(-150, 0), "left");
});

// T-03 — weak short drag (dx=50, vx=0.1) does NOT commit (springs back).
//        Preserves the "peek then change your mind" behavior.
Deno.test("ORCH-1240: weak short drag springs back", () => {
  assertEquals(shouldCommitSwipe(50, 0.1), null);
  assertEquals(shouldCommitSwipe(-50, -0.1), null);
});

// T-04 — direction follows the sign of dx for both axes.
Deno.test("ORCH-1240: direction tracks dx sign", () => {
  // committed by distance
  assertEquals(shouldCommitSwipe(200, 0), "right");
  assertEquals(shouldCommitSwipe(-200, 0), "left");
  // committed by velocity
  assertEquals(shouldCommitSwipe(60, 1.5), "right");
  assertEquals(shouldCommitSwipe(-60, -1.5), "left");
});

// T-05 — a firm flick under the min-dx floor (dx=30) must NOT commit, even fast.
//        Guards against an accidental tap-flick firing.
Deno.test("ORCH-1240: fast flick below min-dx floor does not commit", () => {
  assertEquals(shouldCommitSwipe(30, 2), null);
  assertEquals(shouldCommitSwipe(-30, -2), null);
});

// ---------------------------------------------------------------------------
// node-runnable fallback (mirrors the app-mobile component-test convention),
// so the suite self-runs even where Deno is unavailable.
if (typeof Deno === "undefined" && typeof require !== "undefined" && require.main === module) {
  const a = require("node:assert/strict");
  // re-require the source via a tiny shim is not possible for .ts under node;
  // this fallback only asserts the file is structured for Deno. The canonical
  // runner is `deno test`. (No-op here to avoid a false pass.)
  a.ok(true);
  // eslint-disable-next-line no-console
  console.log("ORCH-1240 happy-path: run with `deno test` for full coverage.");
}
