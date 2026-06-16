// @ts-nocheck
// ORCH-1149 [in-app browser bottom-anchor] — IMPLEMENTOR happy-path regression test.
//
// Source-static-analysis test (the app-mobile component-test convention — see
// orch-0995-bottom-nav-spotlight-ui-thread.test.tsx / orch-1029-coach-mark-fixes.test.tsx):
// reads InAppBrowserModal.tsx as a string and asserts the bottom-anchored sheet shape.
// node-runnable (no jest in app-mobile); self-runs via require.main === module.
//
// Guards I-PROPOSED-1149-INAPP-BROWSER-BOTTOM-ANCHORED. Covers SPEC §5/§9:
//   T-01  <Modal> opens with animationType="slide" (not "fade")  — SC-2
//   T-02  <Modal> sets statusBarTranslucent (layers over in-tree tab bar) — SC-1
//   T-03  styles.overlay is bottom-anchored (justifyContent:'flex-end', no 'center') — SC-1
//   T-04  styles.modalContainer is full-width + has NO fixed SCREEN_HEIGHT*0.85 height — SC-1
//   T-05  styles.modalContainer is top-only rounded (flush bottom, no all-corner borderRadius:20) — SC-1
//   T-06  useSafeAreaInsets imported + { paddingBottom: insets.bottom } applied to webview container — SC-3
//   T-07  component name / default export / { visible,url,title,onClose } prop contract preserved — SC-8
//   T-08  no @gorhom/bottom-sheet import (sole-consumer invariant) — SC-9
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '../InAppBrowserModal.tsx');

// Best-effort brace-balanced extraction of a named StyleSheet.create block.
function styleBlock(source, name) {
  const start = source.indexOf(`${name}: {`);
  if (start < 0) return '';
  let depth = 0;
  let i = source.indexOf('{', start);
  const blockStart = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(blockStart, i + 1);
    }
  }
  return '';
}

function runOrch1149BottomAnchorTest() {
  const source = fs.readFileSync(SRC, 'utf8');
  const overlay = styleBlock(source, 'overlay');
  const modalContainer = styleBlock(source, 'modalContainer');

  // T-01 slide animation, no fade
  assert.ok(
    /animationType=["']slide["']/.test(source),
    'T-01 <Modal> must use animationType="slide"'
  );
  assert.ok(
    !/animationType=["']fade["']/.test(source),
    'T-01 <Modal> must NOT use animationType="fade"'
  );

  // T-02 statusBarTranslucent
  assert.ok(
    /statusBarTranslucent/.test(source),
    'T-02 <Modal> must set statusBarTranslucent so the sheet layers over the in-tree tab bar'
  );

  // T-03 overlay bottom-anchored
  assert.ok(overlay.length > 0, 'T-03 styles.overlay block must exist');
  assert.ok(
    /justifyContent:\s*["']flex-end["']/.test(overlay),
    "T-03 styles.overlay must use justifyContent: 'flex-end'"
  );
  assert.ok(
    !/justifyContent:\s*["']center["']/.test(overlay),
    "T-03 styles.overlay must NOT use justifyContent: 'center' (would re-center the dialog and reopen tab-bar bleed-through)"
  );

  // T-04 modalContainer full-width, no fixed SCREEN_HEIGHT*0.85
  assert.ok(modalContainer.length > 0, 'T-04 styles.modalContainer block must exist');
  assert.ok(
    /width:\s*["']100%["']/.test(modalContainer),
    "T-04 styles.modalContainer must be full-width (width: '100%')"
  );
  assert.ok(
    !/height:\s*SCREEN_HEIGHT\s*\*/.test(modalContainer),
    'T-04 styles.modalContainer must NOT pin height to SCREEN_HEIGHT * <n>'
  );
  assert.ok(
    !/SCREEN_HEIGHT\s*\*\s*0\.85/.test(source),
    'T-04 the SCREEN_HEIGHT * 0.85 centered-card height must be gone everywhere in the file'
  );

  // T-05 top-only rounding (flush bottom)
  assert.ok(
    /borderTopLeftRadius:\s*20/.test(modalContainer) &&
      /borderTopRightRadius:\s*20/.test(modalContainer),
    'T-05 styles.modalContainer must use top-only rounding (borderTopLeftRadius/borderTopRightRadius: 20)'
  );
  assert.ok(
    !/(^|[^a-zA-Z])borderRadius:\s*20/.test(modalContainer),
    'T-05 styles.modalContainer must NOT use all-corner borderRadius: 20 (flush bottom = no bottom rounding)'
  );

  // T-06 bottom safe-area inset applied to webview container
  assert.ok(
    /useSafeAreaInsets/.test(source),
    'T-06 must import/use useSafeAreaInsets'
  );
  assert.ok(
    /const\s+insets\s*=\s*useSafeAreaInsets\(\)/.test(source),
    'T-06 must read const insets = useSafeAreaInsets()'
  );
  assert.ok(
    /webviewContainer,\s*\{\s*paddingBottom:\s*insets\.bottom\s*\}/.test(source),
    'T-06 the WebView container must apply { paddingBottom: insets.bottom } so content clears the home indicator / nav bar'
  );

  // T-07 component contract preserved
  assert.ok(
    /export default function InAppBrowserModal/.test(source),
    'T-07 default export `InAppBrowserModal` must be preserved'
  );
  for (const prop of ['visible', 'url', 'title', 'onClose']) {
    assert.ok(
      new RegExp(`\\b${prop}\\b`).test(source),
      `T-07 prop "${prop}" must remain in the { visible, url, title, onClose } contract`
    );
  }

  // T-08 no gorhom import
  assert.ok(
    !/@gorhom\/bottom-sheet/.test(source),
    'T-08 InAppBrowserModal must NOT import @gorhom/bottom-sheet (meta-orch-0991 sole-consumer)'
  );
}

if (require.main === module) {
  try {
    runOrch1149BottomAnchorTest();
    console.log(
      'PASS T-01..T-08 ORCH-1149 in-app browser bottom-anchor: slide animation, statusBarTranslucent, bottom-anchored overlay, full-width flush sheet (no 0.85 card), top-only rounding, bottom safe-area inset on webview, prop contract preserved, no gorhom import'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch1149BottomAnchorTest };
