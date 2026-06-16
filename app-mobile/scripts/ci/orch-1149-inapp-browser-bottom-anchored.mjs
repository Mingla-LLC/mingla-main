#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1149 [in-app browser bottom-anchor] structural regression gate.
 *
 * Locks I-PROPOSED-1149-INAPP-BROWSER-BOTTOM-ANCHORED: the shared consumer
 * in-app browser (app-mobile/src/components/InAppBrowserModal.tsx) MUST render
 * as a bottom-anchored, full-width sheet that covers the in-tree consumer tab
 * bar, opened with animationType="slide", with the WebView container padding the
 * bottom safe-area inset.
 *
 * WHY this gate exists: a future "simplifying" refactor could re-center the
 * dialog (reopening the ~7.5% tab-bar bleed-through at the base) or drop the
 * bottom inset (occluding web content behind the iOS home indicator / Android
 * nav bar). Both regressions are invisible in a diff review but caught here.
 *
 * Run: node ./scripts/ci/orch-1149-inapp-browser-bottom-anchored.mjs
 * Self-test: node ./scripts/ci/orch-1149-inapp-browser-bottom-anchored.mjs --self-test
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const TARGET = "app-mobile/src/components/InAppBrowserModal.tsx";

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

/**
 * Extract a StyleSheet.create object's named style block (best-effort, brace-
 * balanced) so assertions are scoped to the right style and not the whole file.
 */
function extractStyleBlock(source, styleName) {
  const startKey = `${styleName}: {`;
  const start = source.indexOf(startKey);
  if (start < 0) return "";
  let depth = 0;
  let i = source.indexOf("{", start);
  const blockStart = i;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(blockStart, i + 1);
    }
  }
  return "";
}

function runChecks(source) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });

  const overlayBlock = extractStyleBlock(source, "overlay");
  const modalContainerBlock = extractStyleBlock(source, "modalContainer");

  // 1. Slide animation present; fade absent.
  check(
    "G-01 opens with slide animation (no fade)",
    /animationType=["']slide["']/.test(source) &&
      !/animationType=["']fade["']/.test(source),
    'The <Modal> must use animationType="slide" and must NOT use animationType="fade".',
  );

  // 2. overlay is bottom-anchored, not centered.
  check(
    "G-02 overlay is bottom-anchored (not centered)",
    overlayBlock.length > 0 &&
      !/justifyContent:\s*["']center["']/.test(overlayBlock) &&
      /justifyContent:\s*["']flex-end["']/.test(overlayBlock),
    "styles.overlay must use justifyContent: 'flex-end' and must NOT use justifyContent: 'center'.",
  );

  // 3. modalContainer drops the fixed centered-card height.
  check(
    "G-03 modalContainer has no fixed SCREEN_HEIGHT card height",
    modalContainerBlock.length > 0 &&
      !/height:\s*SCREEN_HEIGHT\s*\*/.test(modalContainerBlock) &&
      !/SCREEN_HEIGHT\s*\*\s*0\.85/.test(source) &&
      /width:\s*["']100%["']/.test(modalContainerBlock),
    "styles.modalContainer must be full-width (width: '100%') and must NOT pin height to SCREEN_HEIGHT * 0.85.",
  );

  // 4. modalContainer is top-only rounded (flush bottom), not all-corner.
  check(
    "G-04 modalContainer is top-only rounded (flush bottom)",
    modalContainerBlock.length > 0 &&
      /borderTopLeftRadius:\s*20/.test(modalContainerBlock) &&
      /borderTopRightRadius:\s*20/.test(modalContainerBlock) &&
      !/(^|[^a-zA-Z])borderRadius:\s*20/.test(modalContainerBlock),
    "styles.modalContainer must use borderTopLeftRadius/borderTopRightRadius (top-only) and must NOT use all-corner borderRadius: 20.",
  );

  // 5. Bottom safe-area inset is imported and applied to the webview container.
  check(
    "G-05 bottom safe-area inset applied to the WebView container",
    /useSafeAreaInsets/.test(source) &&
      /const\s+insets\s*=\s*useSafeAreaInsets\(\)/.test(source) &&
      /webviewContainer,\s*\{\s*paddingBottom:\s*insets\.bottom\s*\}/.test(source),
    "Must import useSafeAreaInsets, read insets, and apply { paddingBottom: insets.bottom } to the webviewContainer view.",
  );

  // 6. Component name / export / prop contract preserved (other gates depend on it).
  check(
    "G-06 default export + prop contract preserved",
    /export default function InAppBrowserModal/.test(source) &&
      /visible[\s\S]{0,40}url[\s\S]{0,40}title[\s\S]{0,40}onClose/.test(source),
    "Must keep `export default function InAppBrowserModal` and the { visible, url, title, onClose } prop contract.",
  );

  // 7. No gorhom import sneaked in (sole-consumer invariant belt-and-braces).
  check(
    "G-07 no @gorhom/bottom-sheet import",
    !/@gorhom\/bottom-sheet/.test(source),
    "InAppBrowserModal must NOT import @gorhom/bottom-sheet (meta-orch-0991 sole-consumer invariant).",
  );

  return checks;
}

function report(checks, label) {
  const failures = checks.filter((item) => !item.pass);
  for (const item of checks) {
    console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
    if (!item.pass) console.log(`  ${item.detail}`);
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  // Prove the gate FAILS on the pre-ORCH-1149 (reverted) shape.
  const reverted = `
import { Modal, View, StyleSheet, Dimensions } from 'react-native';
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
export default function InAppBrowserModal({ visible, url, title, onClose }) {
  return (
    <Modal visible={visible} animationType="fade" transparent={true}>
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <View style={styles.webviewContainer} />
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContainer: { width: '95%', maxWidth: 600, height: SCREEN_HEIGHT * 0.85, maxHeight: SCREEN_HEIGHT * 0.85, borderRadius: 20 },
  webviewContainer: { flex: 1 },
});
`;
  const checks = runChecks(reverted);
  const failures = report(checks, "self-test (reverted shape)");
  if (failures.length === 0) {
    console.error(
      "ORCH-1149 self-test ERROR: the gate PASSED on the reverted (centered/fade/0.85) shape — the gate does not actually guard the fix.",
    );
    process.exit(1);
  }
  console.log(
    `ORCH-1149 self-test passed: gate correctly FAILS the reverted shape (${failures.length}/${checks.length} checks failed as expected).`,
  );
  process.exit(0);
}

const source = read(TARGET);
const checks = runChecks(source);
const failures = report(checks);

if (failures.length > 0) {
  console.error(
    `ORCH-1149 in-app browser bottom-anchor regression failed: ${failures.length}/${checks.length}`,
  );
  process.exit(1);
}

console.log("ORCH-1149 in-app browser bottom-anchor regression passed.");
