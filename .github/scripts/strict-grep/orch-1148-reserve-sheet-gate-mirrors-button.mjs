#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1148 reserve-tap runtime-fix gate — the Reserve-a-table SHEET render gate
 * MUST mirror the BUTTON's render condition, and NEITHER may reference
 * `isNightOut` / `nightOut`.
 *
 * I-PROPOSED-1148-RESERVE-SHEET-GATE-MIRRORS-BUTTON
 *
 * Root cause this gate guards against (runtime-proven 2026-06-17):
 *   In app-mobile/src/components/ExpandedCardModal.tsx the "Reserve a table"
 *   BUTTON renders ONLY in the regular-place branch (`!isNightOut`). The sheet
 *   render gate USED to additionally require `isNightOut && nightOut`. Those two
 *   conditions are mutually exclusive, so on every card that showed the button
 *   `isNightOut` was false → the sheet gate was false → tapping flipped
 *   `isReserveSheetOpen` true but the <VenueReserveSheet> never mounted (a
 *   guaranteed DEAD TAP). The fix removed `isNightOut && nightOut` from the
 *   sheet gate so it mirrors the button exactly:
 *       venueReservable?.reservable === true && venueReservable.brand_id !== null
 *   The sheet's props (brandId, venueName, currency) never depend on nightOut,
 *   so this is correct. This gate keeps the two gates from drifting back to a
 *   mutually-exclusive (dead-tap) shape.
 *
 * Static checks against ExpandedCardModal.tsx (comments stripped so the FIX
 * comment block that *describes* the old `isNightOut && nightOut` shape does not
 * trip the gate):
 *   (1) The "Reserve a table" BUTTON's enclosing render gate references the
 *       reservable condition (`venueReservable?.reservable === true` +
 *       `brand_id !== null`) and does NOT reference `isNightOut`/`nightOut`.
 *   (2) The <VenueReserveSheet> render gate references the SAME reservable
 *       condition (gated additionally only by `isReserveSheetOpen`) and does NOT
 *       reference `isNightOut`/`nightOut`.
 *
 * Fails-on-revert: re-adding `isNightOut && nightOut` to the sheet gate makes
 * check (2) fail. Verified locally via ORCH1148_SIMULATE_REVERT=1, which injects
 * that exact regression into the in-memory source before scanning.
 *
 * Exit codes: 0 pass · 1 violation · 2 fs error.
 * Self-test mode (`--self-test`) validates the matchers against inline fixtures.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET = path.join(
  root,
  "app-mobile/src/components/ExpandedCardModal.tsx",
);

// The reservable condition both gates must share (button + sheet).
const RESERVABLE_RESERVABLE = "venueReservable?.reservable === true";
const RESERVABLE_BRAND = "venueReservable.brand_id !== null";

// The dead-tap regression tokens that must NOT appear inside either gate head.
const NIGHTOUT_TOKENS = [/\bisNightOut\b/, /\bnightOut\b/];

// JSX tags each gate renders — used as anchors.
const BUTTON_TAG = "<TouchableOpacity"; // the Reserve-a-table button (disambiguated below)
const BUTTON_LABEL = "Reserve a table at ${"; // accessibilityLabel inside that button
const SHEET_TAG = "<VenueReserveSheet";

/**
 * Strip block + line comments so the FIX comment block (which intentionally
 * quotes the old `isNightOut && nightOut` shape) does not trigger the gate.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Extract the JSX-expression gate that renders a given JSX tag.
 *
 * Pattern in source: `{ <cond> && (\n  <Tag ... />\n )}`. From the tag index we
 * walk back to the `&& (` (or just `(`) that opens the rendered element, then
 * back to the `{` that opens the conditional-render expression, returning the
 * condition text between that `{` and the `&&` that precedes the `(`.
 */
function gateHeadFor(src, tagIdx) {
  if (tagIdx === -1) return "";
  // The render-open `(` is the last `(` before the tag.
  const open = src.lastIndexOf("(", tagIdx);
  if (open === -1) return "";
  // Trim a trailing `&&` that joins the condition to the render-open.
  let condEnd = open;
  const beforeOpen = src.slice(0, open).replace(/\s+$/, "");
  if (beforeOpen.endsWith("&&")) condEnd = beforeOpen.length - 2;
  // The conditional-render `{` is the last unmatched `{` before condEnd.
  const brace = src.lastIndexOf("{", condEnd);
  if (brace === -1) return "";
  return src.slice(brace + 1, condEnd);
}

function checkGate(name, head) {
  const problems = [];
  if (!head.includes(RESERVABLE_RESERVABLE)) {
    problems.push(
      `${name} gate does not reference the reservable condition \`${RESERVABLE_RESERVABLE}\`.`,
    );
  }
  if (!head.includes(RESERVABLE_BRAND)) {
    problems.push(
      `${name} gate does not reference \`${RESERVABLE_BRAND}\`.`,
    );
  }
  for (const re of NIGHTOUT_TOKENS) {
    if (re.test(head)) {
      problems.push(
        `${name} gate references ${re} — that re-creates the mutually-exclusive DEAD-TAP bug (button renders only when !isNightOut). Remove it.`,
      );
    }
  }
  return problems;
}

function scan(src) {
  const clean = stripComments(src);

  // ---- BUTTON gate ----
  // Anchor on the <TouchableOpacity> that carries the Reserve-a-table
  // accessibilityLabel (disambiguates it from other TouchableOpacity uses).
  const labelIdx = clean.indexOf(BUTTON_LABEL);
  const btnTagIdx =
    labelIdx !== -1 ? clean.lastIndexOf(BUTTON_TAG, labelIdx) : -1;
  const btnHead = gateHeadFor(clean, btnTagIdx);

  // ---- SHEET gate ----
  const sheetIdx = clean.indexOf(SHEET_TAG);
  const sheetHead = gateHeadFor(clean, sheetIdx);

  const problems = [];
  if (!btnHead) {
    problems.push("Could not locate the Reserve-a-table BUTTON render gate.");
  } else {
    problems.push(...checkGate("BUTTON", btnHead));
  }
  if (!sheetHead) {
    problems.push("Could not locate the <VenueReserveSheet> render gate.");
  } else {
    problems.push(...checkGate("SHEET", sheetHead));
  }
  return problems;
}

function run() {
  if (!fs.existsSync(TARGET)) {
    console.error(`ORCH-1148 FAIL: target missing: ${path.relative(root, TARGET)}`);
    process.exit(2);
  }
  let src = fs.readFileSync(TARGET, "utf8");

  // Fails-on-revert harness: inject the exact regression (re-add the
  // mutually-exclusive `isNightOut && nightOut` to the SHEET gate head — the
  // one that also gates on `isReserveSheetOpen`, NOT the button gate).
  if (process.env.ORCH1148_SIMULATE_REVERT === "1") {
    const sheetGate =
      "{venueReservable?.reservable === true &&\n        venueReservable.brand_id !== null && isReserveSheetOpen";
    const reverted =
      "{isNightOut && nightOut && venueReservable?.reservable === true &&\n        venueReservable.brand_id !== null && isReserveSheetOpen";
    if (!src.includes(sheetGate)) {
      console.error(
        "ORCH1148_SIMULATE_REVERT: could not find the sheet gate to revert — extraction anchors may have changed.",
      );
      process.exit(2);
    }
    src = src.replace(sheetGate, reverted);
  }

  const problems = scan(src);
  if (problems.length > 0) {
    console.error(
      "ORCH-1148 reserve-sheet-gate-mirrors-button gate FAILED:",
    );
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    "ORCH-1148 reserve-sheet-gate-mirrors-button gate passed (button + sheet share the reservable gate; neither references isNightOut/nightOut).",
  );
  process.exit(0);
}

function runSelfTest() {
  console.log("# Self-test mode");
  let fails = 0;
  const expect = (cond, msg) => {
    if (!cond) {
      console.error(`SELF-FAIL: ${msg}`);
      fails += 1;
    } else {
      console.log(`SELF-OK: ${msg}`);
    }
  };

  // stripComments removes the FIX comment that quotes the old shape.
  expect(
    !stripComments(
      "/* the gate previously required isNightOut && nightOut */",
    ).includes("isNightOut"),
    "a commented isNightOut mention is stripped (FIX comment cannot trip the gate)",
  );

  // A clean, mirrored pair passes.
  const GOOD = `
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null && (
        <TouchableOpacity accessibilityLabel={\`Reserve a table at \${card.title}\`}>
          <Text>Reserve a table</Text>
        </TouchableOpacity>
      )}
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null && isReserveSheetOpen && (
        <VenueReserveSheet visible={isReserveSheetOpen} />
      )}
  `;
  expect(scan(GOOD).length === 0, "a mirrored button+sheet pair passes clean");

  // The dead-tap regression on the SHEET gate is caught.
  const BAD = `
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null && (
        <TouchableOpacity accessibilityLabel={\`Reserve a table at \${card.title}\`}>
          <Text>Reserve a table</Text>
        </TouchableOpacity>
      )}
    {isNightOut && nightOut && venueReservable?.reservable === true &&
      venueReservable.brand_id !== null && isReserveSheetOpen && (
        <VenueReserveSheet visible={isReserveSheetOpen} />
      )}
  `;
  const badProblems = scan(BAD);
  expect(
    badProblems.some((p) => p.startsWith("SHEET") && /isNightOut|nightOut/.test(p)),
    "the mutually-exclusive isNightOut&&nightOut sheet gate is flagged",
  );

  // The dead-tap regression on the BUTTON gate is caught too.
  const BAD_BTN = `
    {isNightOut && venueReservable?.reservable === true &&
      venueReservable.brand_id !== null && (
        <TouchableOpacity accessibilityLabel={\`Reserve a table at \${card.title}\`}>
          <Text>Reserve a table</Text>
        </TouchableOpacity>
      )}
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null && isReserveSheetOpen && (
        <VenueReserveSheet visible={isReserveSheetOpen} />
      )}
  `;
  expect(
    scan(BAD_BTN).some((p) => p.startsWith("BUTTON")),
    "an isNightOut-referencing BUTTON gate is flagged",
  );

  if (fails > 0) {
    console.error(`SELF-TEST FAILED (${fails})`);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  try {
    run();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }
}
