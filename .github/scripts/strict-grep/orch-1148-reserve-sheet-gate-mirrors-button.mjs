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
 * ---------------------------------------------------------------------------
 * #1605 wave 4 REWORK — THE GATE NOW PINS ALL **THREE** CONDITIONS.
 *
 * Until now this gate pinned only `reservable === true` and `brand_id !== null`.
 * The sheet has ALWAYS ALSO required `venue_id !== null` — it passes
 * `venueId={venueReservable.venue_id}` to <VenueReserveSheet> — so a button
 * gated on two of the three is a gate the SHEET does not mirror: the exact
 * asymmetry this file exists to forbid, in the other direction.
 *
 * That is not hypothetical. #1605 wave 4 shipped a BUTTON gated on two
 * conditions while the sheet kept three, and this gate PASSED on both `main`
 * and the branch — only `main` was correct. A reservable venue with a null
 * `venue_id` rendered "Reserve a table", the tap flipped `isReserveSheetOpen`,
 * the sheet's gate was false, and nothing opened, forever, with no feedback: a
 * NEW dead tap, invisible to the gate meant to catch it. `RESERVABLE_CONDITIONS`
 * below is now the COMPLETE set, asserted on BOTH sites, so the two gates cannot
 * drift in either direction.
 *
 * Static checks against ExpandedCardModal.tsx (comments stripped so the FIX
 * comment block that *describes* the old `isNightOut && nightOut` shape does not
 * trip the gate):
 *   (1) The "Reserve a table" BUTTON's enclosing render gate references ALL
 *       THREE reservable conditions (`venueReservable?.reservable === true`,
 *       `brand_id !== null`, `venue_id !== null`) and does NOT reference
 *       `isNightOut`/`nightOut`.
 *   (2) The <VenueReserveSheet> render gate references the SAME three
 *       conditions (gated additionally only by `isReserveSheetOpen`) and does
 *       NOT reference `isNightOut`/`nightOut`.
 *
 * Fails-on-revert, two harnesses:
 *   ORCH1148_SIMULATE_REVERT=1         re-adds `isNightOut && nightOut` to the
 *                                      SHEET gate  -> check (2) fails.
 *   ORCH1148_SIMULATE_VENUEID_REVERT=1 deletes `venue_id !== null` from the
 *                                      BUTTON gate -> check (1) fails.
 * Both locate their target by REGEX, not by an exact multi-line literal. The
 * old literal anchor had already gone stale against `origin/main`, which means
 * the fails-on-revert proof it backed was silently asserting nothing — so a
 * target that cannot be found now exits 2 instead of being papered over.
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

/**
 * The reservable condition both gates must share (button + sheet) — ALL THREE.
 *
 * `venue_id` is in this list because `<VenueReserveSheet venueId={...} />`
 * cannot open without it. Pinning two of three is what made the #1605 dead tap
 * undetectable.
 */
const RESERVABLE_CONDITIONS = [
  "venueReservable?.reservable === true",
  "venueReservable.brand_id !== null",
  "venueReservable.venue_id !== null",
];

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
  for (const cond of RESERVABLE_CONDITIONS) {
    if (!head.includes(cond)) {
      problems.push(
        `${name} gate does not reference \`${cond}\`. The button and the sheet must ` +
          "gate on the IDENTICAL set of three conditions — a button with fewer " +
          "conditions than the sheet is a guaranteed DEAD TAP (#1605 P0-1), and a " +
          "sheet with fewer than the button crashes on a null id.",
      );
    }
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

  // Fails-on-revert harness 1: inject the exact original regression (re-add the
  // mutually-exclusive `isNightOut && nightOut` to the SHEET gate head — the one
  // that also gates on `isReserveSheetOpen`, NOT the button gate).
  //
  // Located by REGEX, not by an exact multi-line literal. The previous literal
  // anchor had already gone stale on `origin/main`, so this harness was silently
  // unrunnable and the fails-on-revert proof it backed asserted nothing.
  if (process.env.ORCH1148_SIMULATE_REVERT === "1") {
    const SHEET_GATE_HEAD = /\{(\s*venueReservable\?\.reservable === true\s*&&)/;
    if (!SHEET_GATE_HEAD.test(src)) {
      console.error(
        "ORCH1148_SIMULATE_REVERT: could not find the sheet gate to revert — extraction anchors may have changed.",
      );
      process.exit(2);
    }
    // The SHEET gate is the LAST such head in the file (the button's comes
    // first, inside the <ActionButtons reserve={...}> slot).
    const heads = [...src.matchAll(/\{(\s*venueReservable\?\.reservable === true\s*&&)/g)];
    const last = heads[heads.length - 1];
    src =
      src.slice(0, last.index) +
      "{isNightOut && nightOut &&" +
      src.slice(last.index + 1);
  }

  // Fails-on-revert harness 2 (#1605 P0-1): delete `venue_id !== null` from the
  // BUTTON gate, which is precisely the regression this file failed to catch.
  if (process.env.ORCH1148_SIMULATE_VENUEID_REVERT === "1") {
    const BUTTON_VENUE_ID = /venueReservable\.venue_id !== null\s*&&\s*\(/;
    if (!BUTTON_VENUE_ID.test(src)) {
      console.error(
        "ORCH1148_SIMULATE_VENUEID_REVERT: could not find the button gate's venue_id condition — anchors may have changed.",
      );
      process.exit(2);
    }
    src = src.replace(BUTTON_VENUE_ID, "(");
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
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && (
        <TouchableOpacity accessibilityLabel={\`Reserve a table at \${card.title}\`}>
          <Text>Reserve a table</Text>
        </TouchableOpacity>
      )}
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && isReserveSheetOpen && (
        <VenueReserveSheet visible={isReserveSheetOpen} />
      )}
  `;
  expect(scan(GOOD).length === 0, "a mirrored three-condition button+sheet pair passes clean");

  // The dead-tap regression on the SHEET gate is caught.
  const BAD = `
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && (
        <TouchableOpacity accessibilityLabel={\`Reserve a table at \${card.title}\`}>
          <Text>Reserve a table</Text>
        </TouchableOpacity>
      )}
    {isNightOut && nightOut && venueReservable?.reservable === true &&
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && isReserveSheetOpen && (
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
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && (
        <TouchableOpacity accessibilityLabel={\`Reserve a table at \${card.title}\`}>
          <Text>Reserve a table</Text>
        </TouchableOpacity>
      )}
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && isReserveSheetOpen && (
        <VenueReserveSheet visible={isReserveSheetOpen} />
      )}
  `;
  expect(
    scan(BAD_BTN).some((p) => p.startsWith("BUTTON")),
    "an isNightOut-referencing BUTTON gate is flagged",
  );

  // #1605 P0-1, THE REGRESSION THIS FILE MISSED: the button drops `venue_id`
  // while the sheet keeps it. Both `main` and the #1605 branch passed the
  // two-condition version of this gate; only `main` was correct.
  const BAD_BTN_NO_VENUE = `
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null && (
        <TouchableOpacity accessibilityLabel={\`Reserve a table at \${card.title}\`}>
          <Text>Reserve a table</Text>
        </TouchableOpacity>
      )}
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && isReserveSheetOpen && (
        <VenueReserveSheet visible={isReserveSheetOpen} />
      )}
  `;
  expect(
    scan(BAD_BTN_NO_VENUE).some(
      (p) => p.startsWith("BUTTON") && p.includes("venue_id"),
    ),
    "a BUTTON gate missing venue_id is flagged (the #1605 P0-1 dead tap)",
  );

  // …and the mirror image: the sheet drops it while the button keeps it.
  const BAD_SHEET_NO_VENUE = `
    {venueReservable?.reservable === true &&
      venueReservable.brand_id !== null &&
      venueReservable.venue_id !== null && (
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
    scan(BAD_SHEET_NO_VENUE).some(
      (p) => p.startsWith("SHEET") && p.includes("venue_id"),
    ),
    "a SHEET gate missing venue_id is flagged",
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
