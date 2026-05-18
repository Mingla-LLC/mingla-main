#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — ORCH-0864 [Marketing Composer V2 — inline chip
 * rich-text editor].
 *
 * Enforces the 4 new invariants from SPEC §3 + §8:
 *
 *   I-PROPOSED-MKT-COMPOSER-V2-SINGLE-RENDERER-TENTAP (C1)
 *     - mingla-business/package.json MUST NOT depend on
 *       `react-native-pell-rich-editor` (or any alt rich-text WebView lib).
 *     - mingla-business/package.json MUST depend on `react-native-pell-rich-editor`
 *       (the chosen renderer) and `react-native-webview`.
 *
 *   I-PROPOSED-MKT-COMPOSER-V2-NO-DIRECT-TEXTINPUT-IN-BODY (C2)
 *     - ComposerV2Editor.tsx MUST mount the TenTap `<RichText editor=` host
 *       for the body. Body editing CANNOT go through a raw `<TextInput`.
 *     - compose.tsx MUST NOT import RichText directly — that would
 *       bypass useTenTapEditor's bridge wiring.
 *
 *   I-PROPOSED-MKT-COMPOSER-V2-INSERTION-BAR-ALWAYS-VISIBLE (C3)
 *     - InsertionBar.tsx root styles MUST NOT include `display: none` or
 *       `pointerEvents: "none"`. Conditional rendering of the root
 *       container is also forbidden.
 *
 *   I-PROPOSED-MKT-COMPOSER-V2-TOKEN-ROUNDTRIP-LOSSLESS (C4)
 *     - tenTapTokenBridge.ts MUST contain the personalization-token regex
 *       literal that joins all 11 tokens via `|`. This is the designated
 *       fails-on-revert anchor (per IMPLEMENTATION_ORCH-0864 §4).
 *
 * Plus structural hygiene:
 *
 *   C5 — All ComposerV2 components live under
 *        mingla-business/src/components/marketing/ComposerV2/.
 *   C6 — V1 deletions verified: ComposerStepWhat.tsx + EventCardInserter.tsx
 *        + EmbeddedEventChips.tsx must NOT exist.
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — at least one check failed
 *   2 — file system error
 *
 * Self-test mode (`--self-test`) validates the regex/checker behaviour
 * against inlined fixture strings and exits 1 if expectations are not met.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const MINGLA_BUSINESS = path.join(REPO_ROOT, "mingla-business");
const PKG_JSON = path.join(MINGLA_BUSINESS, "package.json");
const COMPOSER_V2_DIR = path.join(
  MINGLA_BUSINESS,
  "src",
  "components",
  "marketing",
  "ComposerV2",
);
const COMPOSER_V2_EDITOR = path.join(COMPOSER_V2_DIR, "ComposerV2Editor.tsx");
const INSERTION_BAR = path.join(COMPOSER_V2_DIR, "InsertionBar.tsx");
const COMPOSE_ROUTE = path.join(
  MINGLA_BUSINESS,
  "app",
  "(tabs)",
  "marketing",
  "campaigns",
  "compose.tsx",
);
const TOKEN_BRIDGE = path.join(
  MINGLA_BUSINESS,
  "src",
  "services",
  "marketing",
  "tenTapTokenBridge.ts",
);
const DELETED_V1_FILES = [
  path.join(MINGLA_BUSINESS, "src", "components", "marketing", "ComposerStepWhat.tsx"),
  path.join(MINGLA_BUSINESS, "src", "components", "marketing", "EventCardInserter.tsx"),
  path.join(MINGLA_BUSINESS, "src", "components", "marketing", "EmbeddedEventChips.tsx"),
];

// ─── Check primitives ──────────────────────────────────────────────────────

/** @returns string contents or null if the file is missing. */
function readFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// C1 — single-renderer pell (package.json checks)
// Stage F.5 pivoted from TenTap to pell after TenTap 0.7.4 hit upstream
// Fabric bug (GitHub issue #314) on Expo SDK 54. Gate now bans TenTap and
// requires pell.
function checkC1SingleRendererPell(pkgJsonText) {
  const failures = [];
  let pkg;
  try {
    pkg = JSON.parse(pkgJsonText);
  } catch (e) {
    return [`C1: failed to parse package.json: ${e.message}`];
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps["@10play/tentap-editor"] !== undefined) {
    failures.push(
      "C1: @10play/tentap-editor is BANNED (Stage F.5 pivot — upstream Fabric bug). Remove from package.json.",
    );
  }
  if (deps["react-native-pell-rich-editor"] === undefined) {
    failures.push(
      "C1: react-native-pell-rich-editor MUST be a direct dep (chosen V2 renderer). Add to package.json.",
    );
  }
  if (deps["react-native-webview"] === undefined) {
    failures.push(
      "C1: react-native-webview MUST be a direct dep (pell peer). Add to package.json.",
    );
  }
  return failures;
}

// C2 — body editing goes through pell RichEditor, not raw TextInput
// Stage F.5: TenTap's `<RichText editor={...}>` replaced by pell's
// `<RichEditor ref={...}>`. The check pattern updates accordingly.
function checkC2NoDirectTextInputInBody(editorText, composeText) {
  const failures = [];
  // ComposerV2Editor MUST mount the pell RichEditor for the body. Pell's
  // RichEditor takes a ref (not an editor prop like TenTap).
  if (!/<RichEditor\b/.test(editorText)) {
    failures.push(
      "C2: ComposerV2Editor.tsx must mount `<RichEditor ref={...}>` for body editing (pell).",
    );
  }
  // compose.tsx MUST NOT import RichEditor directly — body editing must
  // route through ComposerV2Editor.
  if (/\bRichEditor\b/.test(composeText)) {
    failures.push(
      "C2: compose.tsx must not reference RichEditor directly — body editor lives inside ComposerV2Editor.",
    );
  }
  return failures;
}

// C3 — InsertionBar root cannot be hidden
function checkC3InsertionBarAlwaysVisible(barText) {
  const failures = [];
  // Strip comment lines (// and *-prefixed block-comment lines) before
  // pattern-matching — the file's own documentation describes the rule
  // and would otherwise trigger false positives.
  const codeOnly = barText
    .split("\n")
    .filter((line) => {
      const t = line.trimStart();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");

  if (/display\s*:\s*["']none["']/.test(codeOnly)) {
    failures.push(
      "C3: InsertionBar.tsx must not use `display: 'none'` — bar must always be visible.",
    );
  }
  if (/pointerEvents\s*:\s*["']none["']/.test(codeOnly)) {
    failures.push(
      "C3: InsertionBar.tsx must not use `pointerEvents: 'none'` — bar must always be interactive.",
    );
  }
  // Reject early null-return paths from the InsertionBar function.
  if (/export function InsertionBar[\s\S]*?return null;/.test(codeOnly)) {
    failures.push(
      "C3: InsertionBar.tsx must not return null from the InsertionBar function — bar is unconditionally rendered.",
    );
  }
  return failures;
}

// C4 — token-preservation regex literal present in the bridge
function checkC4TokenRoundtripRegex(bridgeText) {
  const failures = [];
  // The personalization-token regex must join all 11 tokens via `|`. The
  // exact line is: PERSONALIZATION_TOKENS.join("|"). If a future refactor
  // collapses this to a hardcoded subset, this gate fires.
  if (!/PERSONALIZATION_TOKENS\.join\("\|"\)/.test(bridgeText)) {
    failures.push(
      "C4: tenTapTokenBridge.ts must use `PERSONALIZATION_TOKENS.join(\"|\")` to build the token regex. Hardcoded subsets break round-trip.",
    );
  }
  // The event-token regex must accept full UUIDs.
  if (!/\\\{\\\{event:/.test(bridgeText)) {
    failures.push(
      "C4: tenTapTokenBridge.ts must contain the `{{event:<uuid>}}` regex literal.",
    );
  }
  // The 11 tokens must all be in the array — count check.
  const tokensArrayMatch = bridgeText.match(
    /PERSONALIZATION_TOKENS:\s*readonly\s+PersonalizationToken\[\]\s*=\s*\[([\s\S]*?)\]/,
  );
  if (tokensArrayMatch === null) {
    failures.push(
      "C4: PERSONALIZATION_TOKENS array literal not found in tenTapTokenBridge.ts.",
    );
  } else {
    const literals = tokensArrayMatch[1].match(/"[a-z_]+"/g) ?? [];
    if (literals.length !== 11) {
      failures.push(
        `C4: PERSONALIZATION_TOKENS must list exactly 11 tokens; found ${literals.length}.`,
      );
    }
  }
  return failures;
}

// C5 — ComposerV2 namespace hygiene
function checkC5ComposerV2Namespace() {
  const failures = [];
  if (!fs.existsSync(COMPOSER_V2_DIR) || !fs.statSync(COMPOSER_V2_DIR).isDirectory()) {
    failures.push(
      "C5: mingla-business/src/components/marketing/ComposerV2/ directory must exist.",
    );
    return failures;
  }
  const required = [
    "ComposerV2Editor.tsx",
    "InsertionBar.tsx",
    "InsertionBarState.ts",
    "SelectionFormattingTooltip.tsx",
    "composerChipHtml.ts", // Stage F.5: replaced EventChipBridge + PersonalizationChipBridge
    "TemplatePreviewDrawer.tsx",
    "templateDrawerHelpers.ts",
  ];
  // Stage F.5: TenTap-era chip-bridge files MUST NOT exist (pivot deletion).
  const forbidden = ["EventChipBridge.ts", "PersonalizationChipBridge.ts"];
  for (const f of forbidden) {
    if (fs.existsSync(path.join(COMPOSER_V2_DIR, f))) {
      failures.push(
        `C5: deleted TenTap-era file resurrected: ComposerV2/${f} (Stage F.5 pivot removed it).`,
      );
    }
  }
  for (const f of required) {
    if (!fs.existsSync(path.join(COMPOSER_V2_DIR, f))) {
      failures.push(`C5: required ComposerV2 file missing: ${f}`);
    }
  }
  return failures;
}

// C6 — V1 deletions verified
function checkC6V1FilesDeleted() {
  const failures = [];
  for (const p of DELETED_V1_FILES) {
    if (fs.existsSync(p)) {
      failures.push(
        `C6: deleted V1 file resurrected: ${path.relative(REPO_ROOT, p)} (Stage F deleted it; do not re-create).`,
      );
    }
  }
  return failures;
}

// ─── Self-test ─────────────────────────────────────────────────────────────

function selfTest() {
  let allPass = true;
  function expect(label, actualFailures, expectFails) {
    const got = actualFailures.length > 0;
    if (got !== expectFails) {
      console.error(`SELF-TEST FAIL: ${label} — expected ${expectFails ? "FAIL" : "PASS"}, got ${got ? "FAIL" : "PASS"}`);
      console.error("  Failures:", actualFailures);
      allPass = false;
    } else {
      console.log(`SELF-TEST PASS: ${label}`);
    }
  }

  // C1 — Stage F.5 pivot: ban TenTap, require pell + webview.
  const goodPkg = JSON.stringify({
    dependencies: { "react-native-pell-rich-editor": "^1.10.0", "react-native-webview": "^13.13.5" },
  });
  expect("C1 good pkg (pell + webview)", checkC1SingleRendererPell(goodPkg), false);
  const badPkgTenTap = JSON.stringify({
    dependencies: {
      "@10play/tentap-editor": "^0.7.4",
      "react-native-pell-rich-editor": "^1.10.0",
      "react-native-webview": "^13.13.5",
    },
  });
  expect("C1 rejects TenTap (post-pivot)", checkC1SingleRendererPell(badPkgTenTap), true);
  const badPkgMissingPell = JSON.stringify({ dependencies: {} });
  expect("C1 rejects missing pell", checkC1SingleRendererPell(badPkgMissingPell), true);

  // C2 — pell uses <RichEditor ref={...}>, not TenTap's <RichText editor=...>.
  const goodEditor = `<RichEditor ref={richEditorRef} />`;
  const goodCompose = `const x = "no rich editor here";`;
  expect("C2 good", checkC2NoDirectTextInputInBody(goodEditor, goodCompose), false);
  const badCompose = `import { RichEditor } from "react-native-pell-rich-editor";`;
  expect("C2 rejects compose RichEditor import", checkC2NoDirectTextInputInBody(goodEditor, badCompose), true);
  const badEditor = `const editor = useSomethingElse();`;
  expect("C2 rejects editor missing RichEditor", checkC2NoDirectTextInputInBody(badEditor, goodCompose), true);

  // C3
  const goodBar = `const styles = StyleSheet.create({ root: { backgroundColor: "#000" } });`;
  expect("C3 good", checkC3InsertionBarAlwaysVisible(goodBar), false);
  const badDisplayNone = `const styles = StyleSheet.create({ root: { display: "none" } });`;
  expect("C3 rejects display:none", checkC3InsertionBarAlwaysVisible(badDisplayNone), true);
  const badPointerEvents = `const styles = StyleSheet.create({ root: { pointerEvents: "none" } });`;
  expect("C3 rejects pointerEvents:none", checkC3InsertionBarAlwaysVisible(badPointerEvents), true);
  const badEarlyReturn = `export function InsertionBar(): React.ReactElement | null { if (!visible) return null; return <View />; }`;
  expect("C3 rejects early null", checkC3InsertionBarAlwaysVisible(badEarlyReturn), true);

  // C4
  const goodBridge =
    `const PERSONALIZATION_TOKENS: readonly PersonalizationToken[] = ["first_name","brand_name","event_name","event_date","event_time","doors_open","event_url","spots_left","previous_event_name","next_event_name","event_id"];\n` +
    `const PERSONALIZATION_TOKEN_RE = new RegExp(\`\\\\{(\${PERSONALIZATION_TOKENS.join("|")})\\\\}\`, "g");\n` +
    `const EVENT_TOKEN_RE = /\\{\\{event:([0-9a-f]{8})\\}\\}/g;`;
  expect("C4 good bridge", checkC4TokenRoundtripRegex(goodBridge), false);
  const badBridgeWeakened =
    `const PERSONALIZATION_TOKEN_RE = /\\{(first_name)\\}/g;`;
  expect("C4 rejects weakened regex", checkC4TokenRoundtripRegex(badBridgeWeakened), true);

  if (!allPass) process.exit(1);
  console.log("\n✓ all self-tests pass");
  process.exit(0);
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const failures = [];

  const pkgText = readFile(PKG_JSON);
  if (pkgText === null) {
    console.error(`FATAL: cannot read ${PKG_JSON}`);
    process.exit(2);
  }
  failures.push(...checkC1SingleRendererPell(pkgText));

  const editorText = readFile(COMPOSER_V2_EDITOR);
  const composeText = readFile(COMPOSE_ROUTE);
  if (editorText === null) {
    failures.push(`C2: cannot read ${COMPOSER_V2_EDITOR}`);
  } else if (composeText === null) {
    failures.push(`C2: cannot read ${COMPOSE_ROUTE}`);
  } else {
    failures.push(...checkC2NoDirectTextInputInBody(editorText, composeText));
  }

  const barText = readFile(INSERTION_BAR);
  if (barText === null) {
    failures.push(`C3: cannot read ${INSERTION_BAR}`);
  } else {
    failures.push(...checkC3InsertionBarAlwaysVisible(barText));
  }

  const bridgeText = readFile(TOKEN_BRIDGE);
  if (bridgeText === null) {
    failures.push(`C4: cannot read ${TOKEN_BRIDGE}`);
  } else {
    failures.push(...checkC4TokenRoundtripRegex(bridgeText));
  }

  failures.push(...checkC5ComposerV2Namespace());
  failures.push(...checkC6V1FilesDeleted());

  if (failures.length === 0) {
    console.log("✓ ORCH-0864 [Marketing Composer V2] strict-grep gate — all 6 checks pass");
    process.exit(0);
  }
  console.error("✗ ORCH-0864 strict-grep gate FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

main();
