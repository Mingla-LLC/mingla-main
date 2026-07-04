#!/usr/bin/env node
/**
 * ORCH-1300 [rsvp-phone-picker-mobile-portal] — strict-grep gate.
 *
 * WHY: ORCH-1299 un-froze the RSVP guest phone country-picker on DESKTOP web
 * (web-immediate open + a `position:'fixed'` overlay), but it STAYED broken on
 * real MOBILE web. Runtime-proven on iPhone-13 WebKit against the live page: the
 * picker mounts (DOM node count 231→331, "Select Country" present) but its
 * `position:'fixed'` layer renders OFF-SCREEN at y=-683 (above the 664px
 * viewport) → invisible. Cause: the RSVP page nests the phone field inside
 * `Animated`/transform ancestors, and CSS `fixed` resolves against the nearest
 * TRANSFORMED ancestor, not the viewport (mobile WebKit enforces this; desktop
 * Chromium was lenient, which is why the ORCH-1299 Chromium-at-430px check
 * passed while the phone stayed frozen).
 *
 * FIX: portal the whole fixed overlay layer to `document.body` (react-dom
 * createPortal) on web, so it has ZERO transformed ancestors and `fixed` is
 * truly viewport-relative on every engine. Native is untouched (the overlay is
 * web-only; the portal wrapper is a passthrough off web) and MUST stay
 * react-dom-free.
 *
 * RULE (structural anti-recurrence) — all must hold, else exit non-zero:
 *   A. CountryPickerModal.tsx imports WebOverlayPortal AND wraps the overlay
 *      <View style={overlayStyle...}> in <WebOverlayPortal>…</WebOverlayPortal>
 *      (the fixed layer is detached from PhoneInput's transformed tree).
 *   B. WebOverlayPortal.web.tsx imports createPortal from "react-dom" AND calls
 *      createPortal(children, document.body) (portals to the document root).
 *   C. WebOverlayPortal.tsx (NATIVE build) does NOT reference react-dom (Metro
 *      must keep the web-only dep out of the native bundle).
 *   D. CountryPickerModal.tsx still pins position:'fixed' on web (the portal
 *      makes that `fixed` viewport-relative — dropping it regresses ORCH-1299).
 *
 * Comment-stripped before scanning (the rationale comments name the very tokens
 * the gate asserts). Self-test: `--self-test` proves GOOD passes and each
 * reverted BAD shape fails.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const OVERLAY_REL = "packages/phone-input/CountryPickerModal.tsx";
const PORTAL_WEB_REL = "packages/phone-input/WebOverlayPortal.web.tsx";
const PORTAL_NATIVE_REL = "packages/phone-input/WebOverlayPortal.tsx";

/** Strip block comments + whole-line `//` comments so prose can't satisfy/trip. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Collapse whitespace so multi-line JSX/exprs match on a single normalized line. */
function normalize(src) {
  return stripComments(src).replace(/\s+/g, " ");
}

/** Scan CountryPickerModal.tsx (rules A + D). */
function scanOverlay(src) {
  const failures = [];
  const s = normalize(src);

  const importsPortal =
    /import\s*\{\s*WebOverlayPortal\s*\}\s*from\s*["']\.\/WebOverlayPortal["']/.test(
      s,
    );
  if (!importsPortal) {
    failures.push(
      "A: CountryPickerModal no longer imports WebOverlayPortal from " +
        "'./WebOverlayPortal'. The overlay's position:'fixed' layer must be " +
        "portaled to document.body or mobile WebKit traps it off-screen (ORCH-1300).",
    );
  }

  // The overlay <View style={overlayStyle...> must be wrapped by <WebOverlayPortal>.
  const wraps =
    /<WebOverlayPortal>\s*<View\s+style=\{\s*overlayStyle/.test(s) &&
    /<\/WebOverlayPortal>/.test(s);
  if (!wraps) {
    failures.push(
      "A: CountryPickerOverlay no longer wraps its fixed <View style={overlayStyle" +
        "...}> in <WebOverlayPortal>…</WebOverlayPortal>. Rendered inline it stays a " +
        "descendant of the RSVP page's transformed ancestors, so position:'fixed' " +
        "resolves off the viewport on mobile WebKit (measured y=-683) → the picker is " +
        "invisible (ORCH-1300).",
    );
  }

  // D — preserve ORCH-1299's web `fixed` pin (portal makes it viewport-relative).
  const webFixed =
    /Platform\.OS\s*===\s*"web"\s*\?\s*"fixed"\s*:\s*"absolute"/.test(s);
  if (!webFixed) {
    failures.push(
      "D: CountryPickerOverlay no longer pins position:'fixed' on web. Once the " +
        "layer is portaled to document.body, 'fixed' is what makes it cover the " +
        "viewport; dropping it regresses the picker (ORCH-1299/ORCH-1300).",
    );
  }
  return failures;
}

/** Scan WebOverlayPortal.web.tsx (rule B). */
function scanPortalWeb(src) {
  const failures = [];
  const s = normalize(src);
  const importsCreatePortal =
    /import\s*\{\s*createPortal\s*\}\s*from\s*["']react-dom["']/.test(s);
  if (!importsCreatePortal) {
    failures.push(
      "B: WebOverlayPortal.web.tsx no longer imports { createPortal } from " +
        "'react-dom'. The web overlay must be portaled to the document root " +
        "(ORCH-1300).",
    );
  }
  const portalsToBody =
    /createPortal\s*\(\s*children\s*,\s*document\.body\s*\)/.test(s);
  if (!portalsToBody) {
    failures.push(
      "B: WebOverlayPortal.web.tsx no longer calls createPortal(children, " +
        "document.body). The overlay must attach to <body> (zero transformed " +
        "ancestors) so position:'fixed' is viewport-relative on mobile WebKit " +
        "(ORCH-1300).",
    );
  }
  return failures;
}

/** Scan WebOverlayPortal.tsx native build (rule C) — must be react-dom-free. */
function scanPortalNative(src) {
  const failures = [];
  const s = normalize(src);
  if (/react-dom/.test(s)) {
    failures.push(
      "C: WebOverlayPortal.tsx (the NATIVE build) references react-dom. react-dom " +
        "is web-only; the native variant must be a plain passthrough so Metro keeps " +
        "it out of the native bundle (ORCH-1300).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const OVERLAY_OK = `
    const overlayStyle = { ...styles.overlayContainer, position: Platform.OS === "web" ? "fixed" : "absolute" };
    return (
      <WebOverlayPortal>
        <View style={overlayStyle as StyleProp<ViewStyle>}>
          <SafeAreaProvider><CountryPickerContent {...props} /></SafeAreaProvider>
        </View>
      </WebOverlayPortal>
    );`;
  const OVERLAY_HEADER_OK = `import { WebOverlayPortal } from "./WebOverlayPortal";`;
  const OVERLAY_GOOD = OVERLAY_HEADER_OK + OVERLAY_OK;
  // A revert — overlay rendered inline again (no portal wrap, no import).
  const OVERLAY_BAD_A = `
    const overlayStyle = { ...styles.overlayContainer, position: Platform.OS === "web" ? "fixed" : "absolute" };
    return (
      <View style={overlayStyle as StyleProp<ViewStyle>}>
        <SafeAreaProvider><CountryPickerContent {...props} /></SafeAreaProvider>
      </View>
    );`;
  // D revert — web fixed pin dropped (but still portaled).
  const OVERLAY_BAD_D =
    OVERLAY_HEADER_OK +
    `
    const overlayStyle = { ...styles.overlayContainer };
    return (
      <WebOverlayPortal>
        <View style={overlayStyle as StyleProp<ViewStyle>}>
          <SafeAreaProvider><CountryPickerContent {...props} /></SafeAreaProvider>
        </View>
      </WebOverlayPortal>
    );`;

  const PORTAL_WEB_OK = `
    import { type ReactNode, type ReactElement } from "react";
    import { createPortal } from "react-dom";
    export function WebOverlayPortal({ children }) {
      if (typeof document === "undefined" || !document.body) { return <>{children}</>; }
      return createPortal(children, document.body);
    }`;
  // B revert — inline again (createPortal gone).
  const PORTAL_WEB_BAD = `
    import { type ReactNode, type ReactElement } from "react";
    export function WebOverlayPortal({ children }) { return <>{children}</>; }`;

  const PORTAL_NATIVE_OK = `
    import { type ReactNode, type ReactElement } from "react";
    export function WebOverlayPortal({ children }) { return <>{children}</>; }`;
  // C revert — react-dom leaked into the native build.
  const PORTAL_NATIVE_BAD = `
    import { createPortal } from "react-dom";
    export function WebOverlayPortal({ children }) { return createPortal(children, document.body); }`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(
        `ORCH-1300 self-test FAIL: ${label} should have failed but passed.`,
      );
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1300 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  // GOOD shapes pass.
  check("overlay GOOD", scanOverlay(OVERLAY_GOOD), false);
  check("portal-web GOOD", scanPortalWeb(PORTAL_WEB_OK), false);
  check("portal-native GOOD", scanPortalNative(PORTAL_NATIVE_OK), false);

  // BAD shapes (each a plausible revert) fail.
  check("overlay BAD_A (portal wrap dropped)", scanOverlay(OVERLAY_BAD_A), true);
  check("overlay BAD_D (web fixed dropped)", scanOverlay(OVERLAY_BAD_D), true);
  check("portal-web BAD (createPortal dropped)", scanPortalWeb(PORTAL_WEB_BAD), true);
  check(
    "portal-native BAD (react-dom leaked)",
    scanPortalNative(PORTAL_NATIVE_BAD),
    true,
  );

  console.log(
    "ORCH-1300 gate self-test PASS (7/7: 3 fixed shapes pass; 4 reverts fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1300 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = [
  ...scanOverlay(read(OVERLAY_REL)),
  ...scanPortalWeb(read(PORTAL_WEB_REL)),
  ...scanPortalNative(read(PORTAL_NATIVE_REL)),
];

if (failures.length > 0) {
  console.error(
    "ORCH-1300 gate FAIL — the RSVP phone country-picker mobile portal wiring " +
      "regressed:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe overlay's position:'fixed' layer must be portaled to document.body " +
      "on web, or a transformed ancestor on the RSVP page traps it off-screen on " +
      "mobile WebKit (the picker mounts but is invisible). See ORCH-1300.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1300 gate PASS — CountryPickerOverlay portals its fixed layer to " +
    "document.body on web (react-dom createPortal); native stays react-dom-free; " +
    "web fixed pin preserved.",
);
