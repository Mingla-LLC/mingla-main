// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1195 [schedule-button-disabled-when-place-closed-now] — regression test.
//
// BUG: on the consumer Likes page, each liked-place card's "Schedule" button was
// disabled whenever the place was closed RIGHT NOW (`!isPlaceOpen` term in both
// the disabled-style condition and the `disabled` prop of the renderCard path).
// That wrongly prevented the user from even OPENING the scheduler to pick a
// different (future) day/time. The scheduler validates the SELECTED datetime
// separately via checkSingleCardSchedulingAvailability → isPlaceOpenAt inside
// handleProposeDateTime, so the closed-future-time case is still rejected there.
// (See openingHoursUtils.ts: "Schedule validation MUST use isPlaceOpenAt(hours,
// selectedDateTime) — checking current time would wrongly block scheduling for a
// future open time".)
//
// FIX: remove `!isPlaceOpen` from the Schedule TouchableOpacity's disabled-style
// condition AND its `disabled` prop, in the renderCard path. The button is now
// disabled ONLY by `schedulingCardId === card.id || isScheduled`. The
// "currently closed" (placeClosed) label is KEPT.
//
// SOURCE-STRING assertions (RN can't mount under node — the established
// ORCH-1138/1148 consumer pattern). fails-on-revert. Owner: mingla-implementor.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

const APP = "app-mobile";
const fullSrc = read(`${APP}/src/components/activity/SavedTab.tsx`);
const src = stripComments(fullSrc);
// Issue #4265: the Likes list became a grid; the Schedule button now lives in
// the shared grid card and its gate is ONE expression for places and plans.
const cardSrc = stripComments(read(`${APP}/src/components/activity/SavedGridCard.tsx`));

const disabledMatch = cardSrc.match(/const primaryDisabled = ([^;]+);/);
ok(
  "grid card Schedule/primary button has a single disabled gate",
  Boolean(disabledMatch),
  "could not locate `const primaryDisabled = …;` in SavedGridCard",
);
const disabledExpr = disabledMatch ? disabledMatch[1] : "";
ok(
  "the gate is what the button's disabled prop uses",
  /disabled=\{primaryDisabled\}/.test(cardSrc),
);

// ── CORE REGRESSION: button must NOT be disabled on current open-now status ──
ok(
  "Schedule button gate does NOT reference current open-now status",
  !/isPlaceOpen|openNow|isOpenNow/.test(disabledExpr),
  `disabled expr references open-now: «${disabledExpr.trim()}»`,
);

// The button must still be gated by the in-flight + already-scheduled states.
ok(
  "Schedule button is still disabled while scheduling is in flight (isScheduling)",
  /isScheduling/.test(disabledExpr) &&
    /isScheduling=\{schedulingCardId === card\.id\}/.test(src),
);
ok(
  "Schedule button is still disabled once the card is already scheduled (inCalendar)",
  /primaryAction === "inCalendar"/.test(disabledExpr) &&
    /isScheduled,\s*\n?\s*isEnded/.test(src),
);

// ── The "currently closed" information MUST be preserved (Seth-confirmed scope) ─
ok(
  "a closed-right-now place still says so (facts line), while the button stays enabled",
  /if \(openNow === false\) parts\.unshift\(t\("activity:savedTab\.closedNow"\)\)/.test(cardSrc),
  "the closed-now label must remain even though the button is enabled",
);

// ── Selected-datetime validation must still run (closed-future-time rejected) ─
ok(
  "handleProposeDateTime still validates the SELECTED datetime via checkSingleCardSchedulingAvailability",
  /checkSingleCardSchedulingAvailability\(\s*\n?\s*cardToSchedule,\s*\n?\s*date,/.test(
    src,
  ),
);
ok(
  "a not-safe selected time still blocks scheduling (Not Safe to Schedule + early return)",
  /isSafeToSchedule/.test(src) && /"Not Safe to Schedule"/.test(src),
);

console.log(`\n${passed} assertions passed.`);
