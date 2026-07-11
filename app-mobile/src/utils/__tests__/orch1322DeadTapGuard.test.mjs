/**
 * ORCH-1322 [consumer-android-media-permission-latent] — TESTER ADVERSARIAL
 * dead-tap guard (spec T10). Append-only; a DIFFERENT ANGLE than the
 * implementor's happy-path runtime test.
 *
 * IMPLEMENTOR'S ANGLE (orch1322MediaLibraryPermission.test.mjs): the underlying
 * ImagePicker permission mock returns { granted: true }, and the test asserts it
 * is NOT called on Android. That proves the short-circuit fires, but it can NEVER
 * observe a dead-tap: even if the wrapper delegated, the granted:true mock would
 * still yield status === 'granted', so no gate site would early-return.
 *
 * TESTER'S ANGLE (this file): drive the wrapper with the underlying OS permission
 * mocked { granted: false, status: 'denied' } — the REAL post-strip Android <= 12
 * reality (once app.json blocks READ/WRITE_EXTERNAL_STORAGE the OS denies the
 * absent permission). Then run the EXACT gate-site predicate the 3 routed sites
 * use (`const { status } = await requestGalleryPermission(); if (status !==
 * 'granted') { return; /* dead-tap: never opens the picker *\/ }
 * launchImageLibraryAsync(...)`) and prove the flow STILL REACHES the picker on
 * Android — i.e. NO DEAD TAP — because the wrapper short-circuits BEFORE the
 * denying OS call. This is the exact failure that stripping the permissions
 * alone (without the wrapper) would cause; the happy-path stub cannot surface it.
 *
 * iOS CONTRAST (proves the guard is Android-specific and honest): on iOS the
 * wrapper delegates to the real (denied) API, status === 'denied', and the gate
 * site DEAD-TAPS — exactly as iOS should when the user truly denies photo access.
 *
 * FAILS-ON-REVERT: delete the wrapper's `if (Platform.OS === 'android') { return
 * { granted: true, ... } }` short-circuit and, on Android, the wrapper falls
 * through to the denied OS mock → status === 'denied' → the gate site early-
 * returns → the picker is NEVER reached (dead-tap). The Android assertion
 * `reachedPicker === true` then flips to fail.
 *
 * Runs under plain node (app-mobile has no jest — OQ-1):
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     ./src/utils/__tests__/orch1322DeadTapGuard.test.mjs
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register the DENIED-underlying stub loader BEFORE importing the real wrapper.
register("./orch1322-deadtap-loader.mjs", pathToFileURL(__filename));

const wrapperUrl = pathToFileURL(
  path.join(__dirname, "..", "mediaLibraryPermission.ts"),
).href;
const { requestGalleryPermission } = await import(wrapperUrl);

/**
 * Faithful reproduction of the gate-site predicate shared by all 3 routed sites
 * (BetaFeedbackModal.tsx, MessageInterface.tsx, cameraService.ts): request, and
 * if the status is not 'granted', bail out BEFORE launching the library picker.
 * Returns whether the launchImageLibraryAsync path was reached ("no dead-tap").
 */
async function simulateGalleryGatePick() {
  const { status } = await requestGalleryPermission();
  if (status !== "granted") {
    return { reachedPicker: false }; // DEAD TAP — early return, picker never opens
  }
  // launchImageLibraryAsync(...) would run here.
  return { reachedPicker: true };
}

const failures = [];

// ── T10a — Android: OS denies, but the pick STILL reaches the picker ──────────
globalThis.__ORCH1322_DEADTAP_IP_CALLS = 0;
globalThis.__ORCH1322_DEADTAP_PLATFORM_OS = "android";
{
  const perm = await requestGalleryPermission();
  const pick = await simulateGalleryGatePick();
  try {
    assert.equal(
      globalThis.__ORCH1322_DEADTAP_IP_CALLS,
      0,
      "the denying OS permission API MUST NOT be called on Android (short-circuit)",
    );
    assert.equal(
      perm.granted,
      true,
      "Android wrapper must report granted:true even though the underlying OS denies",
    );
    assert.equal(
      perm.status,
      "granted",
      "Android wrapper must report status:'granted' (Photo Picker needs no permission)",
    );
    assert.equal(
      pick.reachedPicker,
      true,
      "NO DEAD TAP: the Android gallery pick must reach launchImageLibraryAsync " +
        "despite the OS denying the stripped storage permission",
    );
  } catch (e) {
    failures.push("T10a (android no-dead-tap under OS denial): " + e.message);
  }
}

// ── T10b — iOS contrast: OS denial DOES dead-tap (real permission honored) ────
globalThis.__ORCH1322_DEADTAP_IP_CALLS = 0;
globalThis.__ORCH1322_DEADTAP_PLATFORM_OS = "ios";
{
  const pick = await simulateGalleryGatePick();
  try {
    assert.equal(
      globalThis.__ORCH1322_DEADTAP_IP_CALLS,
      1,
      "iOS MUST delegate to the real ImagePicker permission API exactly once",
    );
    assert.equal(
      pick.reachedPicker,
      false,
      "iOS must still gate on the real permission: a genuine denial early-returns " +
        "(this is correct iOS behavior, and proves the no-dead-tap guarantee is " +
        "specifically the Android short-circuit, not a blanket bypass)",
    );
  } catch (e) {
    failures.push("T10b (iOS still honors real denial): " + e.message);
  }
}

if (failures.length) {
  console.error("ORCH-1322 adversarial dead-tap guard FAIL:");
  failures.forEach((m) => console.error("  - " + m));
  process.exit(1);
}
console.log(
  "ORCH-1322 adversarial dead-tap guard PASS " +
    "(T10a: Android reaches the picker despite OS denial — no dead-tap; " +
    "T10b: iOS still dead-taps on a real denial).",
);
