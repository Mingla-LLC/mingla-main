#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1163 [rsvp-shared-body] — I-PROPOSED-1163-RSVP-GOING-CONFIRM-MAYBE-DIRECT.
 *
 * FLOW A: tapping "Going" opens a shared confirmation dialog (RsvpGoingConfirmDialog)
 * BEFORE the write commits; a success popup (RsvpSuccessPopup) shows after. Maybe /
 * Not-going record DIRECTLY (no dialog). Both dialog components are package-isolated
 * (I-MOR-0827-PACKAGE-ISOLATION): React-Native + ./themePalette + ./designTokens only
 * — NO designSystem import, NO app-src (../../) reach.
 *
 * Structural source-string gate. FAIL-ON-REVERT: leak a designSystem/app-src import,
 * drop the confirmOpen wiring, or remove a testID and a check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};
const exists = (rel) => fs.existsSync(path.join(repoRoot, rel));
// Strip // line + /* */ block comments so package-isolation absence checks bind to
// CODE — a doc comment that merely says "NO designSystem import" must not trip.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const DIALOG = "packages/offering-rendering/RsvpGoingConfirmDialog.tsx";
const POPUP = "packages/offering-rendering/RsvpSuccessPopup.tsx";
const BODY = "packages/offering-rendering/RsvpOfferingBody.tsx";

check(
  "T1 RsvpGoingConfirmDialog exists",
  exists(DIALOG),
  `${DIALOG} must exist`,
);
check("T2 RsvpSuccessPopup exists", exists(POPUP), `${POPUP} must exist`);

const dialog = read(DIALOG);
const popup = read(POPUP);
const body = read(BODY);

// Package-isolation: NO designSystem, NO app-src reach (../../) in either dialog
// (comments stripped — the invariant is about imports, not prose).
const isolated = (src) => {
  const code = stripComments(src);
  return !/designSystem/.test(code) && !/from\s+["']\.\.\/\.\.\//.test(code);
};

check(
  "T3 RsvpGoingConfirmDialog is package-isolated (no designSystem / no ../../ app-src)",
  isolated(dialog),
  "RsvpGoingConfirmDialog.tsx must not import designSystem or an app-src ../../ path",
);
check(
  "T4 RsvpSuccessPopup is package-isolated (no designSystem / no ../../ app-src)",
  isolated(popup),
  "RsvpSuccessPopup.tsx must not import designSystem or an app-src ../../ path",
);
check(
  "T5 body wires the Going confirmation dialog",
  body.includes("RsvpGoingConfirmDialog") && /\bconfirmOpen\b/.test(body),
  "RsvpOfferingBody.tsx must reference RsvpGoingConfirmDialog and own confirmOpen state",
);
check(
  "T6 body wires the success popup",
  body.includes("RsvpSuccessPopup"),
  "RsvpOfferingBody.tsx must reference RsvpSuccessPopup",
);
check(
  "T7 Going opens the dialog via confirmOpen state (FLOW A)",
  /setConfirmOpen\(true\)/.test(body),
  "RsvpOfferingBody.tsx must open the dialog on Going (setConfirmOpen(true))",
);
check(
  "T8 dialog testID present",
  dialog.includes('orch-1163-rsvp-going-confirm-dialog'),
  "RsvpGoingConfirmDialog.tsx must expose testID orch-1163-rsvp-going-confirm-dialog",
);
check(
  "T9 success popup testID present",
  popup.includes('orch-1163-rsvp-success-popup'),
  "RsvpSuccessPopup.tsx must expose testID orch-1163-rsvp-success-popup",
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}
if (failed.length > 0) {
  console.error(
    `\nORCH-1163 rsvp-going-confirm gate failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}
console.log("\nORCH-1163 rsvp-going-confirm gate: PASS");
