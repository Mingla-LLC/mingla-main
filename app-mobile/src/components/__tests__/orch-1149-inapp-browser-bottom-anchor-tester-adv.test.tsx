// @ts-nocheck
// ORCH-1149 [in-app browser bottom-anchor] — TESTER adversarial regression test.
//
// DIFFERENT ANGLE than the implementor's happy-path test
// (orch-1149-inapp-browser-bottom-anchor.test.tsx). The implementor asserts the
// NEW shape is PRESENT (slide / flex-end / 100% / top-radius / inset). This
// adversarial test attacks the two regression risks the happy-path test does NOT
// cover:
//
//   ANGLE A — NO LEFTOVER CENTERED-CARD MARKERS. The happy-path test only checks
//     `SCREEN_HEIGHT*0.85` and `justifyContent:'center'`. A sloppy re-center could
//     leave the OTHER centered-card markers behind (`width:'95%'`, `maxWidth:600`,
//     `maxHeight: SCREEN_HEIGHT*...`, `alignItems:'center'` INSIDE the overlay, a
//     resurrected `Dimensions`/`SCREEN_HEIGHT`) — every one of which silently
//     reopens the tab-bar bleed-through. We assert ALL of them are gone, and we
//     scope the `alignItems:'center'` check to the OVERLAY block specifically (it
//     legitimately remains in chrome styles: closeButton/navBar/etc.), which a
//     coarse file-wide grep would get wrong.
//
//   ANGLE B — CHROME / WEBVIEW / ERROR-PATH BYTE-PRESERVED. SPEC SC-4/SC-6/SC-7 +
//     the tester mandate #2 demand the header/close/nav/URL chrome and every
//     WebView prop be byte-identical and the error path NOT eject to an external
//     browser. The happy-path test never verifies chrome preservation. We assert
//     the dark header color, the lock+URL bar, `source={{ uri: url }}` verbatim
//     (I-WEBVIEW-URL-NORMALIZED — no normalization inside the modal), the
//     external-window-suppression props, and the in-app error handlers are all
//     present and that `onShouldStartLoadWithRequest` returns true (keep-all-nav-
//     inside-WebView, never eject).
//
//   ANGLE C — ALL 5 MOUNT SITES STILL OPEN THE SHARED DEFAULT EXPORT. The
//     happy-path test only reads InAppBrowserModal.tsx. We assert the 5 mount
//     sites (ExpandedCardModal ticket + policies, ProfilePage, CustomPaywallScreen,
//     OnboardingFlow) still `import` + `<InAppBrowserModal` so the bottom-anchor
//     fix actually propagates everywhere (SC-8).
//
// Source-static-analysis (the app-mobile convention — no jest in app-mobile);
// node-runnable via require.main === module. Append-only; does not modify the
// implementor's test.
//
// FAILS-ON-REVERT lever: ANGLE A. On the origin/main (centered) shape the overlay
// still has `alignItems:'center'`, the modalContainer still has `width:'95%'` /
// `maxWidth:600` / `maxHeight: SCREEN_HEIGHT*...`, and `Dimensions`/`SCREEN_HEIGHT`
// are re-imported — so the absence assertions throw. ANGLE B passes on both shapes
// (chrome is preserved by design) and is a pure non-regression guard.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..'); // app-mobile/
const SRC = path.join(ROOT, 'src/components/InAppBrowserModal.tsx');

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

function runOrch1149TesterAdversarial() {
  const source = fs.readFileSync(SRC, 'utf8');
  const overlay = styleBlock(source, 'overlay');
  const modalContainer = styleBlock(source, 'modalContainer');

  assert.ok(overlay.length > 0, 'precondition: styles.overlay block must exist');
  assert.ok(modalContainer.length > 0, 'precondition: styles.modalContainer block must exist');

  // ===== ANGLE A — NO leftover centered-card markers =====

  // A-1 the floating-card width is gone (full-width sheet now).
  assert.ok(
    !/width:\s*['"]95%['"]/.test(modalContainer) && !/width:\s*['"]95%['"]/.test(source),
    "A-1 the centered-card width:'95%' must be GONE (sheet is full-width)"
  );

  // A-2 the maxWidth cap of the floating card is gone.
  assert.ok(
    !/maxWidth:\s*600/.test(modalContainer) && !/maxWidth:\s*600/.test(source),
    'A-2 the centered-card maxWidth: 600 must be GONE (full-bleed sheet)'
  );

  // A-3 the fixed maxHeight (the other half of the 0.85 fixed card) is gone.
  assert.ok(
    !/maxHeight:\s*SCREEN_HEIGHT/.test(modalContainer) && !/maxHeight:\s*SCREEN_HEIGHT/.test(source),
    'A-3 the fixed maxHeight: SCREEN_HEIGHT * 0.85 must be GONE'
  );

  // A-4 the overlay no longer centers horizontally. CRITICAL: scope to the overlay
  //     block — alignItems:'center' legitimately survives in chrome styles
  //     (closeButton / navBar / navButton / navUrlContainer / loadingOverlay).
  assert.ok(
    !/alignItems:\s*['"]center['"]/.test(overlay),
    "A-4 styles.overlay must NOT keep alignItems:'center' (full-width sheet; a leftover would re-cage the sheet to a centered column)"
  );

  // A-5 Dimensions / SCREEN_HEIGHT are fully gone (no resurrected screen-fraction sizing).
  assert.ok(
    !/\bDimensions\b/.test(source),
    'A-5 the Dimensions import must be GONE (no screen-fraction card sizing)'
  );
  assert.ok(
    !/\bSCREEN_HEIGHT\b/.test(source),
    'A-5 the SCREEN_HEIGHT constant must be GONE everywhere in the file'
  );

  // ===== ANGLE B — chrome / WebView / error-path byte-preserved (SC-4/6/7) =====

  // B-1 dark title header color preserved (no chrome recolor).
  assert.ok(
    /backgroundColor:\s*['"]#1C1C1E['"]/.test(source),
    'B-1 the dark title header (#1C1C1E) must be preserved (no chrome change)'
  );

  // B-2 lock-icon + URL bar preserved.
  assert.ok(
    /name=["']lock-closed["']/.test(source) && /navUrlText/.test(source),
    'B-2 the lock icon + URL text bar (navUrlText) must be preserved'
  );

  // B-3 back / forward chrome preserved.
  assert.ok(
    /name=["']chevron-back["']/.test(source) && /name=["']chevron-forward["']/.test(source),
    'B-3 the back/forward nav chrome must be preserved'
  );

  // B-4 URL passed to WebView verbatim — normalization stays call-site owned
  //     (I-WEBVIEW-URL-NORMALIZED). The modal must NOT normalize internally.
  assert.ok(
    /source=\{\{\s*uri:\s*url\s*\}\}/.test(source),
    'B-4 WebView must render source={{ uri: url }} verbatim (call-site-owned normalization)'
  );
  assert.ok(
    !/normalizeWebsiteUrl/.test(source),
    'B-4 InAppBrowserModal must NOT normalize the URL itself (I-WEBVIEW-URL-NORMALIZED is call-site owned)'
  );

  // B-5 external-window suppression props preserved (no popup/external eject).
  assert.ok(
    /setSupportMultipleWindows=\{false\}/.test(source) &&
      /javaScriptCanOpenWindowsAutomatically=\{false\}/.test(source),
    'B-5 the external-window-suppression WebView props must be preserved'
  );

  // B-6 error path stays IN-APP — both error handlers wired, and the
  //     shouldStartLoad handler returns true (keep-all-nav-inside-WebView), never
  //     ejecting to an external browser (SC-6).
  assert.ok(
    /onError=\{handleError\}/.test(source) && /onHttpError=\{handleError\}/.test(source),
    'B-6 onError + onHttpError must both route to the in-app handleError (no external eject)'
  );
  assert.ok(
    /handleShouldStartLoad\s*=\s*useCallback\(\(\)\s*=>\s*\{\s*return true;/.test(
      source.replace(/\s+/g, ' ')
    ) || /const handleShouldStartLoad = useCallback\(\(\) => \{\s*return true;/.test(source),
    'B-6 handleShouldStartLoad must return true (keep all navigation inside the WebView; never eject)'
  );

  // ===== ANGLE C — all 5 mount sites still open the shared default export =====

  const mountSites = [
    'src/components/ExpandedCardModal.tsx',
    'src/components/ProfilePage.tsx',
    'src/components/CustomPaywallScreen.tsx',
    'src/components/OnboardingFlow.tsx',
  ];
  for (const rel of mountSites) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(
      /import\s+InAppBrowserModal\s+from\s+['"][^'"]*InAppBrowserModal['"]/.test(text),
      `C-1 ${rel} must import the default InAppBrowserModal (shared bottom-anchored sheet)`
    );
    assert.ok(
      /<InAppBrowserModal/.test(text),
      `C-1 ${rel} must mount <InAppBrowserModal (inherits the bottom-anchor)`
    );
  }
  // ExpandedCardModal hosts TWO mounts (ticket + policies) → 5 total.
  const ecm = fs.readFileSync(path.join(ROOT, 'src/components/ExpandedCardModal.tsx'), 'utf8');
  const ecmMounts = (ecm.match(/<InAppBrowserModal/g) || []).length;
  assert.equal(
    ecmMounts,
    2,
    `C-2 ExpandedCardModal must host exactly 2 InAppBrowserModal mounts (ticket + policies); found ${ecmMounts}`
  );
}

if (require.main === module) {
  try {
    runOrch1149TesterAdversarial();
    console.log(
      'PASS ORCH-1149 tester-adversarial: no leftover centered-card markers (95%/maxWidth/maxHeight/overlay-alignItems/Dimensions/SCREEN_HEIGHT gone), chrome+WebView+error-path byte-preserved (header/lock+URL/back-forward/verbatim-uri/window-suppression/in-app-error/no-eject), all 5 mount sites still open the shared default export'
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch1149TesterAdversarial };
