// ORCH-1157 [rsvp-public-redesign] — TESTER adversarial regression (different
// angle than the implementor's happy-path / no-checkout / anon-only suite).
//
// This suite attacks the HONESTY + STATE-MACHINE edges, not the happy render:
//   (1) NO momentum sub-line in ANY derived state may leak a numeric waitlist /
//       maybe / attendee count — constitution rule 9 + spec SC-4/SC-7 (the only
//       digits allowed are in the "N spots left" scarcity line, which is a
//       capacity-derived spots-LEFT, never a private headcount).
//   (2) the FULL (capacity reached) state must read "Full · waitlist open" with a
//       100% meter and ZERO digits — proving no waitlist NUMBER is fabricated.
//   (3) the meter can NEVER exceed 100% even when goingCount overshoots capacity
//       (an over-subscribed event must not paint a >100% bar — a silent-overflow
//       guard the happy-path 38/50 case never exercises).
//   (4) the component's FULL+waitlist + hard-full decision paths must NOT include
//       the Maybe button (a Maybe on a full event is a dead-end promise) — a
//       state-machine edge the implementor suite does not assert.
//   (5) the kicker copy is the spec-locked "YOU'RE INVITED" (color inherits the
//       title) — guards against a future copy/regression drift.
//
// FAILS-ON-REVERT: verified by tester via true line-deletion of the
// `spotsLeft === 0` "Full · waitlist open" branch in rsvpMomentum.ts → case (2)
// FAILS (4 passed / 1 failed), restored → 5/5. (See QA report Step "Adversarial
// test added".) The meter-clamp + Maybe-exclusion cases are additional honesty /
// state-machine guards on the same surface.
//
// Append-only NEW file (tests-append-only.yml compliant). Deno-runnable: the
// derivation is pure + dep-free; the component edges are source-structure
// assertions (the package ships no react-native renderer — same constraint the
// implementor suite documents).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { deriveMomentum } from "../rsvpMomentum.ts";

const COMPONENT_RAW = await Deno.readTextFile(
  new URL("../RsvpMomentumDecision.tsx", import.meta.url),
);
const COMPONENT = COMPONENT_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);

// (1) — no derived sub-line may carry a digit EXCEPT the capacity-derived
// "N spots left" scarcity line. Sweep a wide range incl. unlimited + full.
Deno.test("adversarial: only the spots-left line carries a digit — no leaked headcount", () => {
  const cases: Array<[number, number | null]> = [
    [0, 50],
    [4, null], // unlimited (matches live event the-second-test: 4 going, cap null)
    [38, 50],
    [50, 50], // full
    [80, 50], // OVER capacity (over-subscribed)
    [1, 1], // full at 1 (matches live event test-rsvp)
  ];
  for (const [going, cap] of cases) {
    const m = deriveMomentum(going, cap);
    const hasDigit = /\d/.test(m.subLabel);
    const isSpotsLeftLine = /\bspots? left\b/.test(m.subLabel);
    // a digit is permitted ONLY inside an "N spots left" scarcity line.
    if (hasDigit) {
      assert(
        isSpotsLeftLine,
        `subLabel "${m.subLabel}" (going=${going} cap=${cap}) leaked a non-spots-left number`,
      );
    }
  }
});

// (2) — full (spotsLeft 0) → "Full · waitlist open", meter 100, NO waitlist NUMBER.
Deno.test("adversarial: full state is state-copy + 100% meter, never a waitlist count", () => {
  const m = deriveMomentum(50, 50);
  assertEquals(m.subLabel, "Full · waitlist open");
  assertEquals(m.meterPercent, 100);
  assert(!/\d/.test(m.subLabel), "full sub-line must carry no digit");
});

// (3) — meter clamp: an over-subscribed event (going > capacity) must NOT paint a
// bar above 100% (silent-overflow guard the 38/50 happy case never hits).
Deno.test("adversarial: meter is clamped at 100 even when going overshoots capacity", () => {
  assertEquals(deriveMomentum(80, 50).meterPercent, 100);
  assertEquals(deriveMomentum(999, 10).meterPercent, 100);
  // and is never negative / NaN for degenerate input.
  const z = deriveMomentum(-5, 50);
  assertEquals(z.meterPercent, 0);
  assert(Number.isFinite(deriveMomentum(5, 0).meterPercent));
});

// (4) — the FULL+waitlist (goingIsWaitlist) + hard-full decision branches must NOT
// render the Maybe button (a Maybe on a full event is a dead-end). The component
// renders {MaybeButton} ONLY in the open / going / maybe branches — never inside a
// branch guarded by `goingIsWaitlist` or `ctaState === "full"`.
Deno.test("adversarial: full / waitlist decision branches exclude the Maybe button", () => {
  // Isolate each `else if` decision branch body and assert no MaybeButton inside a
  // full/waitlist branch. We do a coarse-but-load-bearing structural check: the two
  // full-family branches each render exactly {GoingButton} + {NotGoingButton}.
  const fullNoWaitlist =
    /ctaState === "full" && !waitlistEnabled\)\s*\{[\s\S]*?decisionButtons = \(([\s\S]*?)\);/.exec(
      COMPONENT,
    );
  const waitlistBranch =
    /\}\s*else if \(goingIsWaitlist\)\s*\{[\s\S]*?decisionButtons = \(([\s\S]*?)\);/.exec(
      COMPONENT,
    );
  assert(fullNoWaitlist !== null, "could not locate the hard-full decision branch");
  assert(waitlistBranch !== null, "could not locate the waitlist decision branch");
  assert(
    !/MaybeButton/.test(fullNoWaitlist![1]),
    "hard-full branch must NOT offer Maybe",
  );
  assert(
    !/MaybeButton/.test(waitlistBranch![1]),
    "full+waitlist branch must NOT offer Maybe",
  );
});

// (5) — the kicker copy is the spec-locked wordmark, color inherits the title
// (palette.primaryText), and the pulsing dot uses the accent (the theme dial).
Deno.test("adversarial: kicker is the locked 'YOU'RE INVITED' (inherits title color, accent dot)", () => {
  assert(/YOU'RE INVITED/.test(COMPONENT), "kicker copy drift");
  // kicker text reads palette.primaryText (= same as title), NOT palette.accent.
  assert(
    /kickerText[\s\S]{0,80}color: palette\.primaryText/.test(COMPONENT),
    "kicker text color must inherit the title (palette.primaryText)",
  );
  // the dot is the accent.
  assert(
    /kickerDot[\s\S]{0,120}backgroundColor: palette\.accent/.test(COMPONENT),
    "kicker dot must use palette.accent",
  );
});
