#!/usr/bin/env node
/**
 * ORCH-1219 [Explorer form follow-ups] — I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT.
 *
 * AMENDED by ORCH-1319 → ORGANISER-ONLY. The explorer half of this gate is GONE:
 * ORCH-1319 deleted the explorer get-the-app lead modal (the app is live on both
 * public stores; the explorer CTA now links straight to the store / desktop QR,
 * with no lead form at all). What remains — and what this gate STILL protects — is
 * the LIVE organiser `BetaAccessModal` (the business beta waitlist; business is
 * not yet on stores). Do NOT delete this gate: it is the only CI protection that
 * the organiser brand-type step stays a no-auto-advance MULTI-select toggle group.
 *
 * WHY (organiser, from Fix A/B + ORCH-1221 Fix 2): the organiser lead form may not
 * auto-advance to step 2 on a chip tap — the user presses Next. AND its brand-type
 * step is MULTI-select (an array, role="group"/aria-pressed, single-select was
 * dropped by ORCH-1221). This gate locks both behaviors on beta-access-modal.tsx:
 *
 *   beta-access-modal.tsx (organiser):
 *     B1. (AMENDED by ORCH-1221) brand-type is MULTI-select: array state
 *         `useState<string[]>([])`, the chip group uses role="group" +
 *         aria-pressed (NOT radiogroup/radio), and step1Valid checks
 *         `brandType.length`. A business can be e.g. Restaurant AND Club.
 *     B2. NO `setTimeout(() => setStep(2), 220)` pointer auto-advance anywhere.
 *
 * Heuristic for "no chip auto-advance": the file may not contain the
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

const ORGANISER = "mingla-marketing/components/marketing/beta-access-modal.tsx";

// The banned auto-advance pattern (whitespace-tolerant).
const AUTO_ADVANCE_RE = /setTimeout\(\s*\(\s*\)\s*=>\s*setStep/;

function checkOrganiser(src, failures) {
  // B1 (AMENDED by ORCH-1221) — brandType is MULTI-select array state.
  if (!/const \[brandType, setBrandType\] = useState<string\[\]>\(/.test(src)) {
    failures.push(
      `${ORGANISER}: brandType is not a \`useState<string[]>\` — it must be a ` +
        `MULTI-select array (ORCH-1221 Fix 2).`,
    );
  }
  // B1b — array-length validity (step1Valid checks brandType.length).
  if (!/brandType\.length/.test(src)) {
    failures.push(
      `${ORGANISER}: step1Valid does not check \`brandType.length\` — multi-select ` +
        `must require ≥1 toggled chip (ORCH-1221 Fix 2).`,
    );
  }
  // B1c — role="group" + aria-pressed, NOT radiogroup/radio.
  if (!/role="group"/.test(src) || !/aria-pressed/.test(src)) {
    failures.push(
      `${ORGANISER}: the brand-type chip group must use role="group" + aria-pressed ` +
        `(toggle semantics), not a radiogroup (ORCH-1221 Fix 2).`,
    );
  }
  if (/role="radiogroup"/.test(src) || /role="radio"/.test(src)) {
    failures.push(
      `${ORGANISER}: the brand-type chips still use radiogroup/radio — they must be ` +
        `a multi-select toggle group (aria-pressed) (ORCH-1221 Fix 2).`,
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
  const runO = (s) => { const f = []; checkOrganiser(s, f); return f; };

  // ORCH-1221 — organiser is MULTI-select (array state, group/aria-pressed).
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
      "(4/4 organiser cases; AMENDED organiser-only by ORCH-1319 — explorer modal deleted).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
const abs = path.join(root, ORGANISER);
if (!fs.existsSync(abs)) {
  failures.push(`${ORGANISER}: not found (gate path out of sync).`);
} else {
  checkOrganiser(fs.readFileSync(abs, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1219 I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT FAIL — the organiser\n" +
      "beta lead form must be a multi-select toggle group (role=group/aria-pressed,\n" +
      "array state) with NO auto-advance (AMENDED organiser-only by ORCH-1319).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1219 I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT PASS — organiser\n" +
    "brand-type is multi-select (role=group/aria-pressed, array state, length-gated)\n" +
    "with no auto-advance (AMENDED organiser-only by ORCH-1319).",
);
