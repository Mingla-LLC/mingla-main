#!/usr/bin/env node
/**
 * ORCH-1220 [Form pill follow-ups] — I-PROPOSED-1220-ALLPILL-SELECTS-ALL (DRAFT).
 *
 * WHY (Fix 1): the explorer "All of it" chip is a SELECT-ALL control, NOT an
 * independent toggle. Tapping it sets/clears the ENTIRE interest set (all 5
 * values), and it auto-reflects as selected when every specific pill is chosen.
 * This gate locks that contract structurally across two files:
 *
 *   mingla-marketing/lib/explorer-interest.ts (the pure reducer):
 *     C1. A pure select-all reducer `nextInterest(` exists and is exported (so
 *         it is unit-testable and the chip handler delegates to it).
 *     C2. The reducer branches on the select-all value (`value === ALL_VALUE`) —
 *         i.e. "All of it" is treated specially, not as a plain toggle.
 *     C3. The reducer references the full set (`ALL_SELECTED`) AND can clear
 *         everything (returns `[]`) — proving set/clear, not self-toggle.
 *
 *   mingla-marketing/components/marketing/get-the-app-modal.tsx (the UI):
 *     C4. The chip's selected state for "All of it" is DERIVED from every
 *         specific pill being selected (`SPECIFIC_INTERESTS.every(`), not a bare
 *         `interest.includes('all')` — so it reflects individual selections.
 *     C5. The chip toggle handler delegates to the reducer
 *         (`setInterest((prev) => nextInterest(prev, value))`) — it must NOT
 *         re-implement a plain `prev.includes(value) ? filter : [...]` toggle
 *         for the interest chips (that would make "All of it" a dumb toggle).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 *
 * Model: i-proposed-1219-form-no-autoadvance-multiselect.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const REDUCER = "mingla-marketing/lib/explorer-interest.ts";
const EXPLORER = "mingla-marketing/components/marketing/get-the-app-modal.tsx";

// Reducer-file rules (C1–C3): operate on lib/explorer-interest.ts.
function checkReducer(src, failures) {
  // C1 — exported pure reducer exists.
  if (!/export function nextInterest\(/.test(src)) {
    failures.push(
      `${REDUCER}: no exported \`nextInterest(\` select-all reducer — "All of it" ` +
        `must be a SELECT-ALL control, not a plain toggle (ORCH-1220 Fix 1).`,
    );
  }
  // C2 — reducer branches on the select-all value.
  if (!/value === ALL_VALUE/.test(src)) {
    failures.push(
      `${REDUCER}: nextInterest does not branch on \`value === ALL_VALUE\` — the ` +
        `"All of it" chip must be handled as select-all, not an independent toggle.`,
    );
  }
  // C3 — set (ALL_SELECTED) AND clear ([]) both present.
  if (!/ALL_SELECTED/.test(src)) {
    failures.push(
      `${REDUCER}: no \`ALL_SELECTED\` set — tapping "All of it" must select ALL 5 ` +
        `values.`,
    );
  }
  if (!/\?\s*\[\]\s*:/.test(src) && !/return\s*\[\]/.test(src)) {
    failures.push(
      `${REDUCER}: nextInterest never returns \`[]\` — tapping "All of it" while ` +
        `everything is selected must CLEAR everything.`,
    );
  }
}

// UI-file rules (C4–C5): operate on get-the-app-modal.tsx.
function checkUi(src, failures) {
  // C4 — "All of it" selected state is derived from every specific pill.
  if (!/SPECIFIC_INTERESTS\.every\(/.test(src)) {
    failures.push(
      `${EXPLORER}: the "All of it" chip selected-state is not derived from ` +
        `\`SPECIFIC_INTERESTS.every(\` — it must auto-reflect when every specific ` +
        `pill is chosen (ORCH-1220 Fix 1).`,
    );
  }
  // C5 — chip handler delegates to the reducer.
  if (!/setInterest\(\s*\(\s*prev\s*\)\s*=>\s*nextInterest\(\s*prev\s*,\s*value\s*\)\s*\)/.test(src)) {
    failures.push(
      `${EXPLORER}: the chip toggle handler must delegate to ` +
        `\`setInterest((prev) => nextInterest(prev, value))\` — it must NOT ` +
        `re-implement a plain includes/filter toggle for the interest chips.`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const runR = (s) => { const f = []; checkReducer(s, f); return f; };
  const runU = (s) => { const f = []; checkUi(s, f); return f; };

  const goodReducer = `
const ALL_VALUE = 'all'
const SPECIFIC_INTERESTS = ['places','events','trips','experiences']
const ALL_SELECTED = [...SPECIFIC_INTERESTS, ALL_VALUE]
export function nextInterest(prev, value) {
  if (value === ALL_VALUE) {
    return SPECIFIC_INTERESTS.every((v) => prev.includes(v)) ? [] : [...ALL_SELECTED]
  }
  return prev
}
`;
  const goodUi = `
const toggleChip = useCallback((value) => {
  setInterest((prev) => nextInterest(prev, value))
}, [])
const selected = it.value === ALL_VALUE
  ? SPECIFIC_INTERESTS.every((v) => props.interest.includes(v))
  : props.interest.includes(it.value)
`;
  if (runR(goodReducer).length !== 0) {
    selfFailures.push("compliant reducer wrongly flagged: " + JSON.stringify(runR(goodReducer)));
  }
  if (runU(goodUi).length !== 0) {
    selfFailures.push("compliant UI wrongly flagged: " + JSON.stringify(runU(goodUi)));
  }

  // Remove the reducer export → fire.
  const noReducer = goodReducer.replace("export function nextInterest(", "function nope(");
  if (runR(noReducer).length === 0) selfFailures.push("missing reducer export not flagged");

  // Reducer without the select-all branch (plain toggle) → fire.
  const noBranch = goodReducer.replace("value === ALL_VALUE", "false");
  if (runR(noBranch).length === 0) selfFailures.push("missing select-all branch not flagged");

  // UI uses a plain includes/filter toggle (dumb "all") → fire (no delegation, no derive).
  const dumbUi = `
const toggleChip = useCallback((value) => {
  setInterest((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value])
}, [])
const selected = props.interest.includes(it.value)
`;
  if (runU(dumbUi).length === 0) selfFailures.push("dumb plain-toggle UI not flagged");

  // UI has delegation but chip not derived from every() → fire.
  const notDerived = goodUi.replaceAll("SPECIFIC_INTERESTS.every(", "PROBE_NO_EVERY(");
  if (runU(notDerived).length === 0) selfFailures.push("non-derived all-chip not flagged");

  if (selfFailures.length) {
    console.error("ORCH-1220 I-PROPOSED-1220-ALLPILL-SELECTS-ALL self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1220 I-PROPOSED-1220-ALLPILL-SELECTS-ALL self-test PASS (6/6 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
for (const [rel, fn] of [[REDUCER, checkReducer], [EXPLORER, checkUi]]) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: not found (gate path out of sync).`);
    continue;
  }
  fn(fs.readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1220 I-PROPOSED-1220-ALLPILL-SELECTS-ALL FAIL — the explorer \"All of it\"\n" +
      "chip must be a SELECT-ALL control (sets/clears all interest values, auto-\n" +
      "reflects when every specific pill is chosen), not a plain independent toggle.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1220 I-PROPOSED-1220-ALLPILL-SELECTS-ALL PASS — \"All of it\" is a select-all\n" +
    "control (pure nextInterest reducer, sets/clears all 5, derived selected-state).",
);
