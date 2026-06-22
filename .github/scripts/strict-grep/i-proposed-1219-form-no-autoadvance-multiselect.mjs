#!/usr/bin/env node
/**
 * ORCH-1219 [Explorer form follow-ups] — I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT.
 *
 * WHY (Fix A + Fix B): neither lead form may auto-advance to step 2 on a chip tap
 * — the user presses Next. AND the explorer interest step is MULTI-select (an
 * array, role="group"/aria-pressed), while the organiser brand-type stays
 * single-select. This gate locks all three behaviors:
 *
 *   get-the-app-modal.tsx (explorer):
 *     A1. interest state is an array: `useState<string[]>`.
 *     A2. step1Valid checks array length: `interest.length`.
 *     A3. the chip group uses role="group" + aria-pressed (NOT radiogroup/radio).
 *     A4. NO chip-handler auto-advance: the chip toggle handler must NOT call
 *         setStep( inside it.
 *
 *   beta-access-modal.tsx (organiser):
 *     B1. (AMENDED by ORCH-1220) brand-type is MULTI-select: array state
 *         `useState<string[]>([])`, the chip group uses role="group" +
 *         aria-pressed (NOT radiogroup/radio), and step1Valid checks
 *         `brandType.length`. A business can be e.g. Restaurant AND Club.
 *     B2. NO `setTimeout(() => setStep(2), 220)` pointer auto-advance anywhere.
 *
 * Heuristic for "no chip auto-advance": neither file may contain the
 * `setTimeout(() => setStep` auto-advance pattern (the ORCH-1216/1045 220ms
 * advance). The legitimate Next button calls setStep directly (no setTimeout).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 *
 * Model: orch-1211-notif-web-render-safe.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const EXPLORER = "mingla-marketing/components/marketing/get-the-app-modal.tsx";
const ORGANISER = "mingla-marketing/components/marketing/beta-access-modal.tsx";

// The banned auto-advance pattern (whitespace-tolerant).
const AUTO_ADVANCE_RE = /setTimeout\(\s*\(\s*\)\s*=>\s*setStep/;

function checkExplorer(src, failures) {
  // A1 — interest array state.
  if (!/useState<string\[\]>\(/.test(src)) {
    failures.push(
      `${EXPLORER}: interest is not a \`useState<string[]>\` — it must be a ` +
        `MULTI-select array (ORCH-1219 Fix A).`,
    );
  }
  // A2 — array-length validity.
  if (!/interest\.length/.test(src)) {
    failures.push(
      `${EXPLORER}: step1Valid does not check \`interest.length\` — multi-select ` +
        `must require ≥1 toggled chip.`,
    );
  }
  // A3 — role="group" + aria-pressed, NOT radiogroup/radio.
  if (!/role="group"/.test(src) || !/aria-pressed/.test(src)) {
    failures.push(
      `${EXPLORER}: the interest chip group must use role="group" + aria-pressed ` +
        `(toggle semantics), not a radiogroup.`,
    );
  }
  if (/role="radiogroup"/.test(src) || /role="radio"/.test(src)) {
    failures.push(
      `${EXPLORER}: the interest chips still use radiogroup/radio — they must be ` +
        `a multi-select toggle group (aria-pressed).`,
    );
  }
  // A4 — no chip auto-advance.
  if (AUTO_ADVANCE_RE.test(src)) {
    failures.push(
      `${EXPLORER}: a \`setTimeout(() => setStep…\` chip auto-advance is present — ` +
        `the user must press Next (ORCH-1219 Fix A).`,
    );
  }
}

function checkOrganiser(src, failures) {
  // B1 (AMENDED by ORCH-1220) — brandType is MULTI-select array state.
  if (!/const \[brandType, setBrandType\] = useState<string\[\]>\(/.test(src)) {
    failures.push(
      `${ORGANISER}: brandType is not a \`useState<string[]>\` — it must be a ` +
        `MULTI-select array (ORCH-1220 Fix 2).`,
    );
  }
  // B1b — array-length validity (step1Valid checks brandType.length).
  if (!/brandType\.length/.test(src)) {
    failures.push(
      `${ORGANISER}: step1Valid does not check \`brandType.length\` — multi-select ` +
        `must require ≥1 toggled chip (ORCH-1220 Fix 2).`,
    );
  }
  // B1c — role="group" + aria-pressed, NOT radiogroup/radio.
  if (!/role="group"/.test(src) || !/aria-pressed/.test(src)) {
    failures.push(
      `${ORGANISER}: the brand-type chip group must use role="group" + aria-pressed ` +
        `(toggle semantics), not a radiogroup (ORCH-1220 Fix 2).`,
    );
  }
  if (/role="radiogroup"/.test(src) || /role="radio"/.test(src)) {
    failures.push(
      `${ORGANISER}: the brand-type chips still use radiogroup/radio — they must be ` +
        `a multi-select toggle group (aria-pressed) (ORCH-1220 Fix 2).`,
    );
  }
  // B2 — no auto-advance.
  if (AUTO_ADVANCE_RE.test(src)) {
    failures.push(
      `${ORGANISER}: a \`setTimeout(() => setStep…\` chip auto-advance is present — ` +
        `it must be removed (ORCH-1219 Fix B); the user presses Next.`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const runE = (s) => { const f = []; checkExplorer(s, f); return f; };
  const runO = (s) => { const f = []; checkOrganiser(s, f); return f; };

  const goodExplorer = `
  const [interest, setInterest] = useState<string[]>([])
  const step1Valid = interest.length >= 1
  <div role="group" aria-label="x">
    <button aria-pressed={selected} onClick={() => props.onToggleChip(it.value)}>{x}</button>
  </div>
  const toggleChip = useCallback((value) => { setInterest((p) => p) }, [])
`;
  if (runE(goodExplorer).length !== 0) selfFailures.push("compliant explorer wrongly flagged");

  // explorer still single-select string → fire (no string[] state).
  const singleExplorer = goodExplorer.replace("useState<string[]>([])", "useState('')");
  if (runE(singleExplorer).length === 0) selfFailures.push("explorer single-select state not flagged");

  // explorer auto-advance → fire.
  const advExplorer = goodExplorer + "\nwindow.setTimeout(() => setStep(2), 220)\n";
  if (runE(advExplorer).length === 0) selfFailures.push("explorer auto-advance not flagged");

  // explorer radiogroup → fire.
  const radioExplorer = goodExplorer.replace('role="group"', 'role="radiogroup"');
  if (runE(radioExplorer).length === 0) selfFailures.push("explorer radiogroup not flagged");

  // ORCH-1220 — organiser is now MULTI-select (array state, group/aria-pressed).
  const goodOrganiser = `
  const [brandType, setBrandType] = useState<string[]>([])
  const step1Valid = brandType.length >= 1
  <div role="group" aria-label="x">
    <button aria-pressed={selected} onClick={() => props.onToggleChip(bt.value)}>{x}</button>
  </div>
  const toggleChip = useCallback((value) => { setBrandType((p) => p) }, [])
`;
  if (runO(goodOrganiser).length !== 0) selfFailures.push("compliant organiser wrongly flagged");

  // organiser still single-select string → fire (no string[] state).
  const singleOrganiser = goodOrganiser.replace("useState<string[]>([])", "useState('')");
  if (runO(singleOrganiser).length === 0) selfFailures.push("organiser single-select state not flagged");

  // organiser radiogroup → fire.
  const radioOrganiser = goodOrganiser.replace('role="group"', 'role="radiogroup"');
  if (runO(radioOrganiser).length === 0) selfFailures.push("organiser radiogroup not flagged");

  // organiser auto-advance → fire.
  const advOrganiser = goodOrganiser + "\nwindow.setTimeout(() => setStep(2), 220)\n";
  if (runO(advOrganiser).length === 0) selfFailures.push("organiser auto-advance not flagged");

  if (selfFailures.length) {
    console.error("ORCH-1219 I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1219 I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT self-test PASS " +
      "(9/9 cases; B1 amended by ORCH-1220 — organiser is multi-select).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
for (const [label, rel, fn] of [
  ["explorer", EXPLORER, checkExplorer],
  ["organiser", ORGANISER, checkOrganiser],
]) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: not found (gate path out of sync).`);
    continue;
  }
  fn(fs.readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1219 I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT FAIL — both lead forms\n" +
      "must be multi-select toggle groups (role=group/aria-pressed, array state) with\n" +
      "NO auto-advance (B1 amended by ORCH-1220 — organiser brand-type is multi-select).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1219 I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT PASS — explorer interest\n" +
    "AND organiser brand-type are both multi-select (role=group/aria-pressed, array\n" +
    "state, length-gated) with no auto-advance (B1 amended by ORCH-1220).",
);
