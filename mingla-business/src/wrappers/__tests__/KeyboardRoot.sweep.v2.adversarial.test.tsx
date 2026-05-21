/**
 * ORCH-0892-B v2 — tester adversarial regression tests.
 *
 * Authored by Claude `mingla-tester` per ORCH-0840 [Regression-test
 * enforcement + append-only CI] Step 0.5(b). Attacks angles DIFFERENT
 * from the implementor's curated per-file tests in KeyboardRoot.test.tsx —
 * proves repo-wide and bundle-level invariants the per-file source-text
 * contracts cannot catch.
 *
 * Per SPEC_ORCH-0892-B_v2 §11.B (TA-V2-1, TA-V2-2, TA-V2-3).
 *
 * Implementor happy-path test: src/wrappers/__tests__/KeyboardRoot.test.tsx
 * (79/79 PASS at HEAD; fails-on-revert verified on 2 files at bb74655b per
 * implementation report §8).
 *
 * Tester adversarial angles:
 *
 *  TA-V2-1: Repo-wide enumeration. Walk EVERY .ts/.tsx file under
 *           mingla-business/src and mingla-business/app, exclude SAFELIST +
 *           sheet-adjacency carve-out + inline-allowlisted lines, assert ZERO
 *           files match ANY of the 4 forbidden patterns. Different angle
 *           than the implementor's curated FORM_SCREENS / SHEET_CONSUMERS
 *           list (which can drift if files are added/renamed). This proves
 *           the sweep is COMPLETE: no missed file in the repo right now,
 *           AND no future file can sneak in without tripping this test.
 *
 *  TA-V2-2: Web bundle library-leak assertion. Mirror of ORCH-0892-A TA-1.
 *           If `dist/_expo/static/js/web/` exists from a recent
 *           `npx expo export --platform web` run, grep all .js files for
 *           `react-native-keyboard-controller|KeyboardProvider|
 *           KeyboardAwareScrollView|useKeyboardState` strings. Assert ZERO.
 *           Proves the new SmartScrollView wrapper indirection works: web
 *           bundle stays library-free post-sweep. If dist/ is missing,
 *           SKIP with documented prerequisite.
 *
 *  TA-V2-3: Allowlist hygiene. Enumerate every file containing the inline
 *           allowlist marker `// orch-strict-grep-allow orch-0892`. Assert
 *           the set is EXACTLY the 2 known files (Input.tsx + welcome
 *           screen). Catches scope creep — any new allowlist without
 *           orchestrator approval fails this test.
 *
 * Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY (DRAFT, flips ACTIVE on
 * ORCH-0892-C close) + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (DRAFT, same).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(root, "..");

// Mirror the gate script's SAFELIST exactly. Files where the forbidden
// patterns are intentional (Sheet primitive owns its own keyboard via
// translateY — historical pre-rewrite reference; ComposerV2/richEditor
// have their own keyboard contracts; the wrapper native variants
// legitimately import from the library).
const SAFELIST = new Set([
  "mingla-business/src/components/ui/Sheet.tsx",
  "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.tsx",
  "mingla-business/src/wrappers/KeyboardRoot.native.tsx",
  "mingla-business/src/wrappers/SmartScrollView.native.tsx",
  "mingla-business/src/wrappers/useKeyboardIsVisible.native.ts",
]);

// Known allowlisted files where the gate's inline-comment mechanism is the
// approved exemption (per SPEC §7.H). Any NEW file in this set is a P1
// scope-creep finding caught by TA-V2-3.
const EXPECTED_ALLOWLISTED_FILES = new Set([
  "mingla-business/src/components/ui/Input.tsx",
  "mingla-business/src/components/auth/BusinessWelcomeScreen.tsx",
]);

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

const RE_KEYBOARD_ADDLISTENER =
  /Keyboard\s*\.\s*addListener\s*\(\s*["']?(keyboard(?:Will|Did)(?:Show|Hide))["']?/;
const RE_KAV_FROM_RN_NAMED =
  /import\s+\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s+from\s+["']react-native["']/;
const RE_AUTO_INSETS = /automaticallyAdjustKeyboardInsets\s*=\s*\{?\s*true/;
const RE_SCROLLVIEW_FROM_RN_NAMED =
  /import\s+\{[^}]*\bScrollView\b[^}]*\}\s+from\s+["']react-native["']/;
const RE_TEXTINPUT_PRESENT = /\bTextInput\b/;
const RE_INLINE_ALLOWLIST =
  /\/\/\s*orch-strict-grep-allow\s+orch-0892\s*[—-]/i;

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const fullPath = path.resolve(dir, name);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkSourceFiles(fullPath, out);
    } else if (
      stat.isFile() &&
      (name.endsWith(".tsx") || name.endsWith(".ts")) &&
      !name.endsWith(".d.ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      out.push(fullPath);
    }
  }
  return out;
}

function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function hasInlineAllowlistNear(content: string, lineIndex: number): boolean {
  // Mirror the gate's 3-line window mechanism.
  const lines = content.split("\n");
  const start = Math.max(0, lineIndex - 3);
  const end = Math.min(lines.length, lineIndex + 4);
  for (let i = start; i < end; i += 1) {
    if (RE_INLINE_ALLOWLIST.test(lines[i] ?? "")) {
      return true;
    }
  }
  return false;
}

function findFirstLineMatching(content: string, re: RegExp): number {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

describe("ORCH-0892-B v2 adversarial regression (tester)", () => {
  // --- TA-V2-1: repo-wide enumeration ---
  //
  // Mirrors the gate's logic but runs as a unit test (so failures show up
  // in `npm test` not just the CI strict-grep job). Walks every .ts/.tsx
  // file under mingla-business/src + mingla-business/app, intersects
  // with SAFELIST + inline allowlist, asserts ZERO files match any of
  // the 4 forbidden patterns.

  it("TA-V2-1: NO file outside SAFELIST + inline-allowlist matches any of the 4 forbidden keyboard patterns", () => {
    const scanRoots = [
      path.resolve(root, "src"),
      path.resolve(root, "app"),
    ];
    const offenders: Array<{
      file: string;
      pattern: string;
      line: number;
    }> = [];

    for (const scanRoot of scanRoots) {
      for (const absPath of walkSourceFiles(scanRoot)) {
        const relPath = path.relative(repoRoot, absPath);
        if (SAFELIST.has(relPath)) continue;

        const raw = fs.readFileSync(absPath, "utf8");
        const stripped = stripComments(raw);

        // Pattern 1: Keyboard.addListener on layout-affecting events
        if (RE_KEYBOARD_ADDLISTENER.test(stripped)) {
          const lineIdx = findFirstLineMatching(raw, RE_KEYBOARD_ADDLISTENER);
          if (!hasInlineAllowlistNear(raw, lineIdx)) {
            offenders.push({
              file: relPath,
              pattern: "Keyboard.addListener (layout event)",
              line: lineIdx + 1,
            });
          }
        }

        // Pattern 2: KeyboardAvoidingView from 'react-native'
        if (RE_KAV_FROM_RN_NAMED.test(stripped)) {
          const lineIdx = findFirstLineMatching(raw, RE_KAV_FROM_RN_NAMED);
          if (!hasInlineAllowlistNear(raw, lineIdx)) {
            offenders.push({
              file: relPath,
              pattern: "KeyboardAvoidingView from 'react-native'",
              line: lineIdx + 1,
            });
          }
        }

        // Pattern 3: automaticallyAdjustKeyboardInsets={true}
        if (RE_AUTO_INSETS.test(stripped)) {
          const lineIdx = findFirstLineMatching(raw, RE_AUTO_INSETS);
          if (!hasInlineAllowlistNear(raw, lineIdx)) {
            offenders.push({
              file: relPath,
              pattern: "automaticallyAdjustKeyboardInsets={true}",
              line: lineIdx + 1,
            });
          }
        }

        // Pattern 4: ScrollView from 'react-native' in a TextInput-bearing file
        if (
          RE_SCROLLVIEW_FROM_RN_NAMED.test(stripped) &&
          RE_TEXTINPUT_PRESENT.test(stripped)
        ) {
          const lineIdx = findFirstLineMatching(
            raw,
            RE_SCROLLVIEW_FROM_RN_NAMED,
          );
          if (!hasInlineAllowlistNear(raw, lineIdx)) {
            offenders.push({
              file: relPath,
              pattern: "ScrollView from 'react-native' (in TextInput file)",
              line: lineIdx + 1,
            });
          }
        }
      }
    }

    if (offenders.length > 0) {
      const lines = offenders
        .map((o) => `  ${o.file}:${o.line} — ${o.pattern}`)
        .join("\n");
      throw new Error(
        `[TA-V2-1 FAIL] Found ${offenders.length} non-allowlisted file(s) ` +
          `matching forbidden keyboard patterns:\n${lines}\n\n` +
          `Rework: migrate each file to use SmartScrollView wrapper, OR ` +
          `add inline allowlist comment within 3 lines of the offending ` +
          `pattern (and update TA-V2-3's EXPECTED_ALLOWLISTED_FILES set).`,
      );
    }
    expect(offenders).toEqual([]);
  });

  // --- TA-V2-2: web bundle library-leak ---
  //
  // Mirror of ORCH-0892-A TA-1. If `dist/_expo/static/js/web/` exists from
  // a recent export, grep for any library strings. ZERO is the contract.

  it("TA-V2-2: web bundle does NOT contain react-native-keyboard-controller library strings", () => {
    const webBundleDir = path.join(
      root,
      "dist",
      "_expo",
      "static",
      "js",
      "web",
    );
    if (!fs.existsSync(webBundleDir)) {
      console.warn(
        "[TA-V2-2 SKIP] dist/_expo/static/js/web missing. Prerequisite: " +
          "cd mingla-business && npx expo export --platform web; then re-run.",
      );
      return;
    }
    const bundleFiles = fs
      .readdirSync(webBundleDir)
      .filter((f) => f.endsWith(".js"));
    expect(bundleFiles.length).toBeGreaterThan(0);

    let totalMatches = 0;
    const offenders: string[] = [];
    for (const file of bundleFiles) {
      const content = fs.readFileSync(path.join(webBundleDir, file), "utf8");
      const matches = content.match(
        /react-native-keyboard-controller|KeyboardProvider|KeyboardAwareScrollView|useKeyboardState/g,
      );
      if (matches !== null) {
        totalMatches += matches.length;
        offenders.push(`${file}: ${matches.length} matches`);
      }
    }

    if (totalMatches > 0) {
      throw new Error(
        `[TA-V2-2 FAIL] Web bundle contains ${totalMatches} library ` +
          `reference(s) — SmartScrollView wrapper indirection broken.\n` +
          `Offending file(s):\n  ${offenders.join("\n  ")}\n\n` +
          `Root cause: a file under mingla-business/src or mingla-business/app ` +
          `imports KeyboardAwareScrollView / useKeyboardState / KeyboardProvider ` +
          `directly from 'react-native-keyboard-controller' instead of going ` +
          `through the .native.tsx / .native.ts wrapper. Grep the source tree ` +
          `for those identifiers + 'react-native-keyboard-controller' to find ` +
          `the leaker. Fix: route imports through the wrappers at ` +
          `mingla-business/src/wrappers/SmartScrollView.{tsx,native.tsx} or ` +
          `useKeyboardIsVisible.{ts,native.ts}.`,
      );
    }
    expect(totalMatches).toBe(0);
  });

  // --- TA-V2-3: allowlist hygiene ---
  //
  // Enumerate every file containing the allowlist marker and assert the
  // set equals the expected set. Any new allowlist without orchestrator
  // approval = test fail. Different angle than TA-V2-1 (which checks the
  // PATTERNS) — TA-V2-3 checks the EXEMPTIONS themselves.

  it("TA-V2-3: only the approved files contain inline orch-0892 allowlist comments", () => {
    let matchOutput = "";
    try {
      matchOutput = execSync(
        `cd "${repoRoot}" && grep -rln "orch-strict-grep-allow orch-0892" ` +
          `mingla-business/src mingla-business/app 2>/dev/null | ` +
          `grep -v __tests__ || true`,
        { encoding: "utf8" },
      );
    } catch {
      // grep exit-zero on no matches; that's fine.
    }

    const foundFiles = new Set(
      matchOutput
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );

    // Files in `foundFiles` that are NOT in EXPECTED_ALLOWLISTED_FILES
    // are scope creep.
    const unexpected: string[] = [];
    for (const file of foundFiles) {
      if (!EXPECTED_ALLOWLISTED_FILES.has(file)) {
        unexpected.push(file);
      }
    }

    // Files in EXPECTED_ALLOWLISTED_FILES that are NOT in `foundFiles`
    // means the allowlist was removed (probably intentionally — but the
    // test set should be updated).
    const missing: string[] = [];
    for (const file of EXPECTED_ALLOWLISTED_FILES) {
      if (!foundFiles.has(file)) {
        missing.push(file);
      }
    }

    if (unexpected.length > 0) {
      throw new Error(
        `[TA-V2-3 FAIL] Found ${unexpected.length} unexpected file(s) with ` +
          `inline orch-0892 allowlist comments (scope creep):\n  ` +
          `${unexpected.join("\n  ")}\n\n` +
          `Each new allowlist requires orchestrator approval. Either remove ` +
          `the allowlist and migrate the file to SmartScrollView, OR open a ` +
          `new ORCH and add the file path to TA-V2-3's ` +
          `EXPECTED_ALLOWLISTED_FILES set with operator sign-off.`,
      );
    }

    if (missing.length > 0) {
      throw new Error(
        `[TA-V2-3 FAIL] Expected allowlist file(s) missing the marker:\n  ` +
          `${missing.join("\n  ")}\n\n` +
          `If the file was migrated to SmartScrollView (allowlist no longer ` +
          `needed), update this test by removing the path from ` +
          `EXPECTED_ALLOWLISTED_FILES.`,
      );
    }

    expect(unexpected).toEqual([]);
    expect(missing).toEqual([]);
  });
});
