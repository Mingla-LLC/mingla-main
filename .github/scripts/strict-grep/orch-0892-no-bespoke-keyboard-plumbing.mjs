#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0892 [App-wide keyboard avoidance — react-native-keyboard-controller
 * pilot on mingla-business] — BLOCKING gate (exit 1 on violation, exit 0
 * on PASS; emits WARN lines on every run for visibility). Mirrors
 * orch-0861-sibling-scrollview-flexgrow-zero structure.
 *
 * Invariants under enforcement: I-PROPOSED-KEYBOARD-LIBRARY-ONLY (ACTIVE
 * since ORCH-0892-C close 2026-05-21) + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY
 * (ACTIVE since ORCH-0892-C close 2026-05-21). All keyboard-
 * avoidance code in mingla-business/ MUST flow through
 * react-native-keyboard-controller primitives. Three patterns are
 * forbidden outside the explicit SAFELIST:
 *
 *   1. Keyboard.addListener('keyboard(Will|Did)(Show|Hide)') for
 *      layout-affecting purposes. (Keyboard.dismiss() is fine — it's
 *      not a listener.)
 *   2. Import of KeyboardAvoidingView from 'react-native' — must use
 *      the library's drop-in replacement.
 *   3. automaticallyAdjustKeyboardInsets={true} prop on any ScrollView
 *      or fork.
 *
 * SAFELIST (carve-outs from the investigation; codified in SPEC §10):
 *   - Sheet primitive (CO-1): owns sheet-hosted keyboard via translateY;
 *     library would double-translate.
 *   - ComposerV2Editor (CO-2): fixed-height body shrink for pell rich
 *     editor tap reliability.
 *   - richEditor.{native.ts,tsx} (CO-3): WebView sandbox; library
 *     can't reach inside.
 *   - KeyboardRoot.native.tsx: the legitimate library mount itself.
 *
 * Per-file inline exemption: `// orch-strict-grep-allow orch-0892 — <reason>`
 * within 3 lines of the offending pattern suppresses the WARN. Mirrors
 * the // ORCH-0861-OK: convention.
 *
 * **Mode:** BLOCKING (exit 1 on violation, exit 0 on PASS).
 * Promoted from INFORMATIONAL by ORCH-0892-C [gate promotion + invariant
 * promote] close 2026-05-21 after ORCH-0892-B [sweep] cleared all WARN
 * sites and SmartScrollView wrapper became the canonical pattern.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const SCAN_ROOTS = [resolve(REPO_ROOT, "mingla-business")];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".expo",
  "dist",
  "build",
  "ios",
  "android",
  "Pods",
  ".git",
  "coverage",
  "__tests__",
]);

const SAFELIST = new Set([
  // ORCH-0892-B v2: Sheet.tsx legitimately imports KeyboardAwareScrollView
  // from the library — it's the single owner of sheet body keyboard handling
  // (panel translate / height clamp deleted; KAS does scroll-to-focused).
  "mingla-business/src/components/ui/Sheet.tsx",
  "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.tsx",
  "mingla-business/src/wrappers/KeyboardRoot.native.tsx",
  // ORCH-0892-B v2 (supersedes ORCH-0892-A KAV wrapper): SmartScrollView
  // native variant re-exports KeyboardAwareScrollView; useKeyboardIsVisible
  // native variant delegates to library useKeyboardState. The web variants
  // import from 'react-native' only — not flagged.
  "mingla-business/src/wrappers/SmartScrollView.native.tsx",
  "mingla-business/src/wrappers/useKeyboardIsVisible.native.ts",
  // ORCH-1165: KeyboardToolbarRoot native variant imports KeyboardToolbar from
  // the library (the Done-only accessory bar). Legitimate library mount, same
  // class as KeyboardRoot.native.tsx — safelisted so the gate stays green.
  "mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx",
]);

function walkSourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const path = resolve(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkSourceFiles(path, out);
    } else if (
      stat.isFile() &&
      (name.endsWith(".tsx") || name.endsWith(".ts"))
    ) {
      // Skip d.ts and test files
      if (name.endsWith(".d.ts")) continue;
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
      out.push(path);
    }
  }
  return out;
}

function stripLineComments(content) {
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function stripBlockComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "");
}

function clean(content) {
  return stripBlockComments(stripLineComments(content));
}

const RE_KEYBOARD_ADDLISTENER =
  /Keyboard\s*\.\s*addListener\s*\(\s*["']?(keyboard(?:Will|Did)(?:Show|Hide))["']?/;

const RE_KAV_FROM_RN_NAMED =
  /import\s+\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s+from\s+["']react-native["']/;

const RE_AUTO_INSETS = /automaticallyAdjustKeyboardInsets\s*=\s*\{?\s*true/;

// ORCH-0892-B v2 4th pattern: ScrollView imported from 'react-native' in a
// file that also contains a TextInput — must come from the SmartScrollView
// wrapper so KAS (KeyboardAwareScrollView on native) handles focused-input
// scrolling. Universal-coverage enforcer — prevents future form-screens
// from sneaking in a bare ScrollView import and inheriting the unreliable
// per-screen keyboard plumbing pattern this ORCH eliminates.
const RE_SCROLLVIEW_FROM_RN_NAMED =
  /import\s+\{[^}]*\bScrollView\b[^}]*\}\s+from\s+["']react-native["']/;
const RE_TEXTINPUT_PRESENT = /\bTextInput\b/;

function hasInlineAllowlist(content, lineIndex) {
  // Accept allowlist comment within 3 lines above or below the match.
  const lines = content.split("\n");
  const start = Math.max(0, lineIndex - 3);
  const end = Math.min(lines.length, lineIndex + 4);
  for (let i = start; i < end; i += 1) {
    if (
      /\/\/\s*orch-strict-grep-allow\s+orch-0892\s*[—-]/i.test(lines[i] ?? "")
    ) {
      return true;
    }
  }
  return false;
}

function findFirstLineMatching(content, re) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

const warnings = [];
let scannedCount = 0;
let safelistedCount = 0;

for (const root of SCAN_ROOTS) {
  const files = walkSourceFiles(root);
  for (const path of files) {
    scannedCount += 1;
    const relPath = relative(REPO_ROOT, path);
    if (SAFELIST.has(relPath)) {
      safelistedCount += 1;
      continue;
    }
    const raw = readFileSync(path, "utf8");
    const stripped = clean(raw);

    // Check for Keyboard.addListener with layout-affecting events
    if (RE_KEYBOARD_ADDLISTENER.test(stripped)) {
      const lineIdx = findFirstLineMatching(raw, RE_KEYBOARD_ADDLISTENER);
      if (!hasInlineAllowlist(raw, lineIdx)) {
        warnings.push({
          path: relPath,
          line: lineIdx + 1,
          pattern: "Keyboard.addListener (layout-affecting event)",
          fix: "Use useReanimatedKeyboardAnimation or useKeyboardHandler from react-native-keyboard-controller for layout-affecting reads, or wrap parent in <KeyboardAvoidingView from 'react-native-keyboard-controller'>.",
        });
      }
    }

    // Check for KeyboardAvoidingView imported from 'react-native'
    if (RE_KAV_FROM_RN_NAMED.test(stripped)) {
      const lineIdx = findFirstLineMatching(raw, RE_KAV_FROM_RN_NAMED);
      if (!hasInlineAllowlist(raw, lineIdx)) {
        warnings.push({
          path: relPath,
          line: lineIdx + 1,
          pattern: "KeyboardAvoidingView imported from 'react-native'",
          fix: "Import KeyboardAvoidingView from 'react-native-keyboard-controller' instead — drop-in replacement with frame-perfect native animation.",
        });
      }
    }

    // Check for automaticallyAdjustKeyboardInsets={true}
    if (RE_AUTO_INSETS.test(stripped)) {
      const lineIdx = findFirstLineMatching(raw, RE_AUTO_INSETS);
      if (!hasInlineAllowlist(raw, lineIdx)) {
        warnings.push({
          path: relPath,
          line: lineIdx + 1,
          pattern: "automaticallyAdjustKeyboardInsets={true}",
          fix: "Wrap parent in <KeyboardAwareScrollView from 'react-native-keyboard-controller'> — automaticallyAdjustKeyboardInsets is iOS-only and fragile in nested layouts.",
        });
      }
    }

    // ORCH-0892-B v2 4th pattern: ScrollView imported from 'react-native'
    // in a file that contains a TextInput — must come from SmartScrollView
    // wrapper. Universal-coverage enforcer for form screens.
    if (
      RE_SCROLLVIEW_FROM_RN_NAMED.test(stripped) &&
      RE_TEXTINPUT_PRESENT.test(stripped)
    ) {
      const lineIdx = findFirstLineMatching(raw, RE_SCROLLVIEW_FROM_RN_NAMED);
      if (!hasInlineAllowlist(raw, lineIdx)) {
        warnings.push({
          path: relPath,
          line: lineIdx + 1,
          pattern: "ScrollView imported from 'react-native' in a file containing TextInput",
          fix: "Import ScrollView from '@/wrappers/SmartScrollView' (correct relative path per file depth) — wrapper resolves to KeyboardAwareScrollView on native (focused TextInput auto-scrolls above keyboard) and plain ScrollView on web (passthrough).",
        });
      }
    }
  }
}

console.log("\nORCH-0892 no-bespoke-keyboard-plumbing informational gate");
console.log(
  `Scanned ${scannedCount} .ts/.tsx files under mingla-business/.\n`,
);
console.log(`  ${safelistedCount} file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)`);

if (warnings.length === 0) {
  console.log("\nPASS — zero bespoke keyboard-plumbing violations outside the safelist.\n");
  process.exit(0);
}

console.log(
  `\nWARN — ${warnings.length} file(s) using bespoke keyboard plumbing instead of react-native-keyboard-controller:\n`,
);
for (const w of warnings) {
  console.log(`  ${w.path}:${w.line}`);
  console.log(`    pattern: ${w.pattern}`);
  console.log(`    fix:     ${w.fix}`);
  console.log("");
}

console.log(
  "Each WARN above is a BLOCKER (this gate exits 1 post-ORCH-0892-C). Either\n" +
    "(a) migrate the file to SmartScrollView wrapper (and use library primitives\n" +
    "    for any other keyboard-related code), or\n" +
    "(b) add `// orch-strict-grep-allow orch-0892 — <one-line reason>` within 3\n" +
    "    lines of the offending pattern to suppress (per-file allowlist; needs\n" +
    "    operator approval before merge).\n",
);
console.log(
  "This gate is BLOCKING (exit 1). PR will fail CI until every WARN site\n" +
    "above is either (a) migrated to SmartScrollView / library primitives,\n" +
    "or (b) inline-allowlisted with `// orch-strict-grep-allow orch-0892 — <reason>`\n" +
    "within 3 lines of the offending pattern (per file).\n",
);

// BLOCKING — fails CI on any violation. Promoted from INFORMATIONAL by
// ORCH-0892-C close 2026-05-21. Per I-PROPOSED-KEYBOARD-LIBRARY-ONLY +
// I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (both ACTIVE).
process.exit(warnings.length > 0 ? 1 : 0);
