#!/usr/bin/env node
/**
 * I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET  (issue #1047)
 *
 * Re-homes the load-bearing parts of the keyboard Done-bar invariant previously
 * pinned by `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts`
 * (ORCH-1165 / ORCH-1170). That jest file also pinned ~13 checkout-scrollview
 * paddings (some drifted) and is now quarantined; this additive gate keeps the two
 * load-bearing rules enforced.
 *
 * THE RULE:
 *  (A) MOUNT COVERAGE — the Done bar can only reach a focused field if a
 *      <KeyboardToolbarRoot/> is rendered in the SAME native window. Three host
 *      windows must each render it: app/_layout.tsx (root), SheetMobile.tsx (sheet
 *      Modal window), Modal.tsx (dialog Modal window).
 *  (B) KEYED-ON-KEYBOARD-OPEN OFFSET — the +42pt Done-bar clearance MUST be gated
 *      on the keyboard being open (`> 0 ? … + 42`), NEVER unconditional (an
 *      unconditional +42 leaves a permanent dead 42pt gap). Pinned on the three
 *      stable surfaces (auth welcome, waitlist sheet, marketing composer).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel) => fs.readFileSync(path.join(REPO, path.join("mingla-business", rel)), "utf8");
const stripImports = (s) => s.split("\n").filter((l) => !/^\s*import\b/.test(l)).join("\n");

const violations = [];

// (A) mount coverage — all three host windows render <KeyboardToolbarRoot/>.
for (const rel of ["app/_layout.tsx", "src/components/ui/SheetMobile.tsx", "src/components/ui/Modal.tsx"]) {
  let src;
  try {
    src = read(rel);
  } catch {
    violations.push(`${rel} is missing — a keyboard-toolbar host window disappeared.`);
    continue;
  }
  if (!/<KeyboardToolbarRoot\s*\/?>/.test(stripImports(src))) {
    violations.push(`${rel} no longer renders <KeyboardToolbarRoot/> — inputs in its native window get no Done bar.`);
  }
}

// (B) keyed (never-unconditional) +42 offsets on the three stable surfaces.
const KEYED = [
  ["src/components/auth/BusinessWelcomeScreen.tsx", /keyboardPad\s*>\s*0\s*\?\s*keyboardPad\s*\+\s*42/],
  ["src/components/waitlist/JoinWaitlistSheet.tsx", /keyboardPadding\s*>\s*0\s*\?\s*42/],
  ["src/components/marketing/ComposerV2/ComposerV2Editor.tsx", /keyboardHeight\s*>\s*0\s*\?\s*keyboardHeight\s*\+\s*42/],
];
for (const [rel, re] of KEYED) {
  let src;
  try {
    src = read(rel);
  } catch {
    violations.push(`${rel} is missing.`);
    continue;
  }
  if (!re.test(src)) {
    violations.push(`${rel} no longer gates its +42 Done-bar offset on keyboard-open (\`> 0 ? … + 42\`) — an unconditional offset leaves a permanent dead 42pt gap.`);
  }
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-KEYBOARD-TOOLBAR-KEYED-OFFSET]: 3 mount hosts render the toolbar; +42 offsets are keyboard-keyed.");
