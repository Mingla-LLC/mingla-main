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

// Isolate the renderCard Schedule TouchableOpacity block: from the scheduling
// onPress handler down to its closing tag, so assertions target THE button.
const schedBlockMatch = src.match(
  /onPress=\{\(\) => handleSchedule\(card\)\}[\s\S]*?<\/TouchableOpacity>/,
);
ok(
  "renderCard Schedule button block is present",
  Boolean(schedBlockMatch),
  "could not locate the handleSchedule TouchableOpacity",
);
const schedBlock = schedBlockMatch ? schedBlockMatch[0] : "";

// Extract the `disabled={...}` expression of the Schedule button.
const disabledMatch = schedBlock.match(/disabled=\{([\s\S]*?)\}/);
ok(
  "renderCard Schedule button has a disabled prop",
  Boolean(disabledMatch),
);
const disabledExpr = disabledMatch ? disabledMatch[1] : "";

// ── CORE REGRESSION: button must NOT be disabled on current open-now status ──
ok(
  "Schedule button disabled prop does NOT gate on current open-now (!isPlaceOpen removed)",
  !/!isPlaceOpen/.test(disabledExpr),
  `disabled expr still references open-now: «${disabledExpr.trim()}»`,
);

// The button must still be gated by the in-flight + already-scheduled states.
ok(
  "Schedule button is still disabled while scheduling is in flight (schedulingCardId === card.id)",
  /schedulingCardId === card\.id/.test(disabledExpr),
);
ok(
  "Schedule button is still disabled once the card is already scheduled (isScheduled)",
  /isScheduled/.test(disabledExpr),
);

// The disabled-STYLE condition must also drop the open-now term, so the button
// does not render in the visually-disabled state when closed-now.
const styleDisabledMatch = schedBlock.match(
  /styles\.primaryButton,([\s\S]*?)styles\.primaryButtonDisabled/,
);
ok(
  "renderCard Schedule button has a primaryButtonDisabled style condition",
  Boolean(styleDisabledMatch),
);
const styleDisabledExpr = styleDisabledMatch ? styleDisabledMatch[1] : "";
ok(
  "Schedule button disabled STYLE does NOT gate on current open-now (!isPlaceOpen removed)",
  !/!isPlaceOpen/.test(styleDisabledExpr),
  `disabled-style expr still references open-now: «${styleDisabledExpr.trim()}»`,
);

// ── The "currently closed" label MUST be preserved (Seth-confirmed scope) ────
ok(
  "the placeClosed / currently-closed label is still rendered when isPlaceOpen is false",
  /\{!isPlaceOpen && \(/.test(src) &&
    /savedTab\.placeClosed/.test(src),
  "the closed-now label must remain even though the button is now enabled",
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
