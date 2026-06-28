// @ts-nocheck
// ORCH-1241 [Card swipe-hang] — TESTER adversarial / property sweep.
//
// Different angle from the happy-path's nominal cases: sweeps the full input
// grid dx in [-200,200] x vx in [-2,2] and asserts the commit decision is
// internally consistent, never sprung back a gesture that visually crossed the
// point of no return, and is direction-monotonic. Plus exact-boundary checks.
//
// FAILS-ON-REVERT: the "no visually-committed gesture springs back" invariant
// (P-01) requires that any firm flick past the floor commits. A distance-only
// revert (dx>120) sprays null for the whole fast-flick band (e.g. dx=70,vx=1.0)
// while `visuallyCommits` is true → assertion fails. Run with:
//   deno test app-mobile/src/utils/__tests__/orch_1241_swipe_commit_velocity.adversarial.test.ts
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  shouldCommitSwipe,
  SWIPE_COMMIT_DISTANCE,
  SWIPE_COMMIT_VELOCITY,
  SWIPE_COMMIT_MIN_DX,
} from "../swipeCommit.ts";

// Independent spec model (NOT the implementation) of what "visually commits".
function visuallyCommits(dx: number, vx: number): boolean {
  return (
    Math.abs(dx) > SWIPE_COMMIT_DISTANCE ||
    (Math.abs(vx) > SWIPE_COMMIT_VELOCITY && Math.abs(dx) > SWIPE_COMMIT_MIN_DX)
  );
}

// P-01 — Full grid sweep: every input that visually crosses (long drag OR firm
// flick past the floor) MUST commit; every input that does not MUST spring back.
// And whenever it commits, the direction must NEVER oppose the dominant signal.
Deno.test("ORCH-1241 adversarial: grid sweep — commit-iff-crossed + direction-consistent", () => {
  for (let dx = -200; dx <= 200; dx += 5) {
    for (let vxTenths = -20; vxTenths <= 20; vxTenths += 1) {
      const vx = vxTenths / 10; // -2.0 .. 2.0 in 0.1 steps
      const result = shouldCommitSwipe(dx, vx);
      const shouldCommit = visuallyCommits(dx, vx);

      // (a) no input that visually crosses is ever classified as spring-back,
      //     and nothing that doesn't cross is ever committed.
      assertEquals(
        result !== null,
        shouldCommit,
        `commit mismatch at dx=${dx}, vx=${vx}: got ${result}, expected commit=${shouldCommit}`
      );

      // (c) direction never opposes the sign of the dominant horizontal signal.
      if (result !== null) {
        const dominant = dx !== 0 ? dx : vx;
        const dir = dominant > 0 ? "right" : "left";
        assertEquals(
          result,
          dir,
          `direction opposes dominant signal at dx=${dx}, vx=${vx}: got ${result}`
        );
      }
    }
  }
});

// P-02 — Monotonicity in distance: fixing vx, once a |dx| commits, every larger
// |dx| (same sign) also commits. No commit "hole" as the gesture travels further.
Deno.test("ORCH-1241 adversarial: distance-monotonic (no commit holes)", () => {
  for (let vxTenths = -20; vxTenths <= 20; vxTenths += 1) {
    const vx = vxTenths / 10;
    let committedRight = false;
    for (let dx = 0; dx <= 200; dx += 1) {
      const r = shouldCommitSwipe(dx, vx);
      if (r === "right") committedRight = true;
      if (committedRight) {
        assert(
          shouldCommitSwipe(dx, vx) === "right",
          `commit hole (right) at dx=${dx}, vx=${vx}`
        );
      }
    }
    let committedLeft = false;
    for (let dx = 0; dx >= -200; dx -= 1) {
      const r = shouldCommitSwipe(dx, vx);
      if (r === "left") committedLeft = true;
      if (committedLeft) {
        assert(
          shouldCommitSwipe(dx, vx) === "left",
          `commit hole (left) at dx=${dx}, vx=${vx}`
        );
      }
    }
  }
});

// P-03 — Exact-boundary behavior (strict-greater semantics).
Deno.test("ORCH-1241 adversarial: exact boundaries behave per spec", () => {
  // dx exactly at the distance threshold (120) with zero velocity: NOT committed
  // (gate is strictly >). One px past commits.
  assertEquals(shouldCommitSwipe(120, 0), null);
  assertEquals(shouldCommitSwipe(121, 0), "right");
  assertEquals(shouldCommitSwipe(-120, 0), null);
  assertEquals(shouldCommitSwipe(-121, 0), "left");

  // vx exactly at the velocity threshold (0.5) with dx past the floor: NOT
  // committed (strictly >); just over commits.
  assertEquals(shouldCommitSwipe(50, 0.5), null);
  assertEquals(shouldCommitSwipe(50, 0.51), "right");
  assertEquals(shouldCommitSwipe(-50, -0.5), null);
  assertEquals(shouldCommitSwipe(-50, -0.51), "left");

  // dx exactly at the min-dx floor (40) with a firm flick: NOT committed
  // (gate is strictly >). One px past the floor commits.
  assertEquals(shouldCommitSwipe(40, 1.0), null);
  assertEquals(shouldCommitSwipe(41, 1.0), "right");
  assertEquals(shouldCommitSwipe(-40, -1.0), null);
  assertEquals(shouldCommitSwipe(-41, -1.0), "left");
});

// P-04 — Symmetry: the decision is odd under (dx,vx) -> (-dx,-vx) (mirrors
// left/right), and magnitude-only — sign of vx never flips a distance commit.
Deno.test("ORCH-1241 adversarial: left/right symmetry", () => {
  for (let dx = -200; dx <= 200; dx += 7) {
    for (let vxTenths = -20; vxTenths <= 20; vxTenths += 3) {
      const vx = vxTenths / 10;
      const a = shouldCommitSwipe(dx, vx);
      const b = shouldCommitSwipe(-dx, -vx);
      const mirror = a === null ? null : a === "right" ? "left" : "right";
      assertEquals(b, mirror, `asymmetry at dx=${dx}, vx=${vx}`);
    }
  }
});
