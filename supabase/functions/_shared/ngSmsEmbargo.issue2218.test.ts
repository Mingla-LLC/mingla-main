// ===========================================================================
// #2218 T-1 — THE NIGERIAN OPERATOR-EMBARGO WINDOW ITSELF.
// ===========================================================================
// This is the arithmetic everything else in #2218 rests on, and it is the piece
// most likely to be written wrong in a way that never shows up: the window
// WRAPS MIDNIGHT, so the obvious `hour >= 20 && hour < 8` is vacuously false at
// every hour of the day. A guard like that ships green, changes nothing, and
// the Nigerian buyer still gets no text — the "check that carries no
// information" family this repo keeps finding.
//
// So the boundary cases are asserted from BOTH sides of both edges, and both
// halves of the wrap (21:00 AND 03:00) are asserted independently. A vacuous
// implementation fails at 21:00; an unwrapped one fails at 03:00; an
// off-by-one at 08:00 or 20:00 fails at the edges.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  __pinNgClockInsideWindow,
  __setNgEmbargoClock,
  isNgGenericEmbargoed,
  isReconcilableTermiiMessageId,
  lagosWallClock,
  ngEmbargoNow,
  nextNgGenericWindowOpen,
} from "./ngSmsEmbargo.ts";

/** Nigeria is UTC+1 with no DST, so WAT hour H on this date is UTC H-1. */
const wat = (hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 7, 18, hour - 1, minute, 0));

Deno.test("#2218 T-1a: the embargo covers the whole wrapped window, both halves", () => {
  // The evening half. A vacuous `>= 20 && < 8` returns false here.
  assert(isNgGenericEmbargoed(wat(20)), "20:00 WAT is embargoed (inclusive)");
  assert(isNgGenericEmbargoed(wat(21)), "21:00 WAT is embargoed");
  assert(isNgGenericEmbargoed(wat(23, 59)), "23:59 WAT is embargoed");
  // The morning half, across the date boundary. An unwrapped implementation
  // that only checks the evening returns false here.
  assert(isNgGenericEmbargoed(wat(0)), "midnight WAT is embargoed");
  assert(isNgGenericEmbargoed(wat(3)), "03:00 WAT is embargoed");
  assert(isNgGenericEmbargoed(wat(7, 59)), "07:59 WAT is embargoed");
  // THE PRODUCTION INSTANT. The founder's confirmation was accepted at
  // 2026-08-18 05:10:39Z — 06:10:39 WAT — and never arrived.
  assert(
    isNgGenericEmbargoed(new Date("2026-08-18T05:10:39Z")),
    "the exact send in the #2218 report falls inside the embargo",
  );
});

Deno.test("#2218 T-1b: the carrying window is open 08:00–20:00 WAT", () => {
  assertEquals(isNgGenericEmbargoed(wat(8)), false, "08:00 WAT carries");
  assertEquals(isNgGenericEmbargoed(wat(8, 1)), false);
  assertEquals(isNgGenericEmbargoed(wat(12)), false, "midday carries");
  assertEquals(isNgGenericEmbargoed(wat(19, 59)), false, "19:59 WAT carries");
  // The one prior NG send this account completed successfully, 2026-08-04
  // 10:53:01Z = 11:53 WAT, sits inside the carrying window — which is the
  // correlation the whole diagnosis turns on.
  assertEquals(
    isNgGenericEmbargoed(new Date("2026-08-04T10:53:01Z")),
    false,
    "the last NG send that produced a documented numeric id was in-window",
  );
});

Deno.test("#2218 T-1c: the next opening is the coming 08:00 WAT, never the past", () => {
  const fromEvening = nextNgGenericWindowOpen(wat(21));
  assertEquals(lagosWallClock(fromEvening).hour, 8);
  assertEquals(lagosWallClock(fromEvening).day, 19, "21:00 rolls to tomorrow");
  assert(fromEvening.getTime() > wat(21).getTime(), "always in the future");

  const fromDawn = nextNgGenericWindowOpen(wat(3));
  assertEquals(lagosWallClock(fromDawn).hour, 8);
  assertEquals(lagosWallClock(fromDawn).day, 18, "03:00 opens the same day");
  assert(fromDawn.getTime() > wat(3).getTime(), "always in the future");

  // From the production instant: 06:10 WAT holds for under two hours, which is
  // the difference between a late text and no text.
  const held = nextNgGenericWindowOpen(new Date("2026-08-18T05:10:39Z"));
  assertEquals(held.toISOString(), "2026-08-18T07:00:00.000Z");

  // And the deadline is never inside the window it is waiting for.
  for (const h of [20, 22, 0, 3, 7]) {
    assertEquals(
      isNgGenericEmbargoed(nextNgGenericWindowOpen(wat(h))),
      false,
      `an opening computed from ${h}:00 WAT must not itself be embargoed`,
    );
  }
});

Deno.test("#2218 T-1d: the clock seam is real and restores", () => {
  const pinned = new Date("2026-08-18T05:10:39Z");
  __setNgEmbargoClock(() => pinned);
  try {
    assertEquals(ngEmbargoNow().toISOString(), pinned.toISOString());
    assert(isNgGenericEmbargoed(ngEmbargoNow()));
  } finally {
    __setNgEmbargoClock(null);
  }
  // Restored: the real clock is a moving target, so assert only that it moved
  // off the pin rather than asserting a value that would itself need a clock.
  assert(
    Math.abs(ngEmbargoNow().getTime() - Date.now()) < 5_000,
    "clearing the seam returns the wall clock",
  );
  // AND PUT IT BACK. `deno test` runs every named file in ONE process, and the
  // legacy NG suites pin this module at import time. Leaving the seam cleared
  // here would hand the real clock to whichever of those tests happens to run
  // after this one — green for thirteen hours a day, red for the other eleven,
  // and impossible to reproduce on demand. That is the exact class of flake
  // #2218 is cleaning up, and it must not be introduced by its own tests.
  __pinNgClockInsideWindow();
});

// ===========================================================================
// #2218 T-2 — THE `sig_` ACCEPT-ID.
// ===========================================================================
// The two production values are pinned verbatim. They are the evidence that the
// id shape is systematic rather than a one-off: the first is the founder's
// failed confirmation, the second a controlled re-send 28 minutes later inside
// the same embargo window. Neither can be matched by a Termii delivery report
// or looked up in Termii History, both of which key on the numeric form.
Deno.test("#2218 T-2: only Termii's documented numeric id is reconcilable", () => {
  // Documented / historically observed — reconcilable.
  assert(isReconcilableTermiiMessageId("3017858407816658717238173"));
  assert(isReconcilableTermiiMessageId("3017544054459083819856413"));
  assert(isReconcilableTermiiMessageId(" 30178310418 "), "trimmed");

  // The two ids production actually returned on the failing sends.
  assertEquals(
    isReconcilableTermiiMessageId("sig_7678b296aa6240b4864a6dcb294124b4"),
    false,
    "the id on the founder's undelivered confirmation",
  );
  assertEquals(
    isReconcilableTermiiMessageId("sig_d39356e5a21e477d82194175970f0552"),
    false,
    "the id on the controlled re-send 28 minutes later",
  );

  // Absence is not reconcilability.
  assertEquals(isReconcilableTermiiMessageId(null), false);
  assertEquals(isReconcilableTermiiMessageId(undefined), false);
  assertEquals(isReconcilableTermiiMessageId(""), false);
  assertEquals(isReconcilableTermiiMessageId("   "), false);
  // A Twilio SID is not a Termii id either — the predicate must not be a
  // generic "looks like an id" sniff.
  assertEquals(
    isReconcilableTermiiMessageId("SMd7e8039018f3e8b9b3f1f6c01d141879"),
    false,
  );
});

Deno.test("#2218 T-1e: the next opening rolls a month and a year correctly", () => {
  // `Date.UTC(y, m, day + 1, …)` normalises overflow, so these should fall out
  // of the construction — but "should fall out" is how off-by-one date bugs get
  // shipped, and a Nigerian buyer on the 31st is not a special case to them.
  // 2026-08-31 21:00 WAT -> 2026-09-01 08:00 WAT
  assertEquals(
    nextNgGenericWindowOpen(new Date("2026-08-31T20:00:00Z")).toISOString(),
    "2026-09-01T07:00:00.000Z",
  );
  // 2026-12-31 23:30 WAT -> 2027-01-01 08:00 WAT
  assertEquals(
    nextNgGenericWindowOpen(new Date("2026-12-31T22:30:00Z")).toISOString(),
    "2027-01-01T07:00:00.000Z",
  );
  // 2028-02-28 22:00 WAT, a leap year -> 2028-02-29 08:00 WAT
  assertEquals(
    nextNgGenericWindowOpen(new Date("2028-02-28T21:00:00Z")).toISOString(),
    "2028-02-29T07:00:00.000Z",
  );
  // And the small hours of the 1st still open the SAME morning, not the 2nd.
  assertEquals(
    nextNgGenericWindowOpen(new Date("2026-09-01T02:00:00Z")).toISOString(),
    "2026-09-01T07:00:00.000Z",
  );
});
