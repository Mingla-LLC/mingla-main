#!/usr/bin/env node
/**
 * ORCH-1299 [rsvp-phone-picker-nested-modal] — strict-grep gate.
 *
 * WHY: the RSVP guest phone country-picker froze on WEB. The RSVP guest details
 * form (name/email/phone) renders inside RsvpDetailsModal — a portal RN <Modal>.
 * PhoneInput's default country picker is CountryPickerModal, itself a nested RN
 * <Modal>. On react-native-web a <Modal> nested inside another <Modal> never
 * opens/interacts → the picker is a dead-tap (Constitution #1). The package ships
 * CountryPickerOverlay (an in-place fixed-fill View) for exactly the "inside an
 * existing Modal" case; PhoneInput now selects it via `pickerPresentation`.
 *
 * The PRIMARY (runtime-proven) fix is check F: handleOpenPicker must open the
 * picker IMMEDIATELY on web, NOT only inside InteractionManager.runAfterInteractions
 * — the RSVP public page holds a looping Animated interaction handle, so
 * runAfterInteractions never fires and setPickerVisible(true) never runs (the real
 * dead-tap). The overlay (checks A–E) is the SECONDARY fix for the details-modal
 * instance (a nested <Modal> is documented to freeze on web).
 *
 * RULE (structural anti-recurrence) — all must hold, else exit non-zero:
 *   A. pickerPresentation.ts::resolvePickerPresentation returns 'overlay' ONLY
 *      when presentation === "overlay" AND platformOS === "web" (native + the
 *      'modal' default are never diverted from the modal picker).
 *   B. PhoneInput.tsx renders CountryPickerOverlay for the resolved-overlay branch
 *      AND still renders CountryPickerModal for the default branch, and it drives
 *      the choice through resolvePickerPresentation(...).
 *   F. PhoneInput.tsx::handleOpenPicker opens the picker immediately on web
 *      (Platform.OS === "web" → setPickerVisible(true)) and does NOT gate the web
 *      path solely behind InteractionManager.runAfterInteractions.
 *   C1. PublicEventPage.tsx consumes useBusinessRsvpPhoneField and passes its
 *       renderer into FoundationRsvpPreview (the callsite ownership chain).
 *   C2. useBusinessRsvpPhoneField.tsx renders the RSVP PhoneInput with
 *       `pickerPresentation="overlay"` (the field lives inside RsvpDetailsModal).
 *   D. The three buyer-CHECKOUT PhoneInput hosts do NOT pass
 *      pickerPresentation="overlay" — they are standalone pages (no enclosing
 *      <Modal>) and MUST keep the default nested-<Modal> picker.
 *   E. CountryPickerOverlay pins position:'fixed' on web (so it covers the details
 *      modal, not just PhoneInput's ~56px box).
 *
 * Comment-stripped before scanning (the rationale comments name the very tokens
 * the gate asserts). Self-test: `--self-test` proves GOOD passes and each reverted
 * BAD shape fails.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const HELPER_REL = "packages/phone-input/pickerPresentation.ts";
const PHONEINPUT_REL = "packages/phone-input/PhoneInput.tsx";
const OVERLAY_REL = "packages/phone-input/CountryPickerModal.tsx";
const RSVP_REL = "mingla-business/src/components/event/PublicEventPage.tsx";
const RSVP_RENDERER_REL =
  "mingla-business/src/components/event/useBusinessRsvpPhoneField.tsx";
const CHECKOUT_RELS = [
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
  "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
];

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

/** Scan the resolver helper source (rule A). */
function scanHelper(src) {
  const failures = [];
  const s = normalize(src);
  // The overlay branch must require BOTH presentation === "overlay" AND web.
  const branch =
    /presentation\s*===\s*"overlay"\s*&&\s*platformOS\s*===\s*"web"/.test(s) &&
    /return\s*"overlay"/.test(s);
  if (!branch) {
    failures.push(
      "A: resolvePickerPresentation no longer returns 'overlay' ONLY for " +
        "(presentation === \"overlay\" && platformOS === \"web\"). The overlay is a " +
        "WEB-only escape hatch for the nested-<Modal> freeze; native + the 'modal' " +
        "default must stay on CountryPickerModal (ORCH-1299).",
    );
  }
  return failures;
}

/** Scan PhoneInput (rule B). */
function scanPhoneInput(src) {
  const failures = [];
  const s = normalize(src);
  if (!/resolvePickerPresentation\s*\(/.test(s)) {
    failures.push(
      "B: PhoneInput no longer drives the picker choice through " +
        "resolvePickerPresentation(...) — the web/native + default gating is gone " +
        "(ORCH-1299).",
    );
  }
  if (!/<CountryPickerOverlay\b/.test(s)) {
    failures.push(
      "B: PhoneInput no longer renders <CountryPickerOverlay> — the RSVP " +
        "details-modal picker will fall back to the nested <Modal> that freezes on " +
        "web (ORCH-1299).",
    );
  }
  if (!/<CountryPickerModal\b/.test(s)) {
    failures.push(
      "B: PhoneInput no longer renders <CountryPickerModal> for the default " +
        "branch — the standalone buyer-checkout picker would regress (ORCH-1299).",
    );
  }
  // F — the runtime-proven PRIMARY fix: open immediately on web.
  const webImmediate =
    /Platform\.OS\s*===\s*"web"[\s\S]{0,120}?setPickerVisible\s*\(\s*true\s*\)/.test(
      s,
    );
  if (!webImmediate) {
    failures.push(
      "F: handleOpenPicker no longer opens the picker immediately on web " +
        "(Platform.OS === \"web\" → setPickerVisible(true)). The RSVP page holds a " +
        "looping Animated interaction handle, so InteractionManager." +
        "runAfterInteractions NEVER fires — gating the web open behind it is the " +
        "real dead-tap (ORCH-1299).",
    );
  }
  return failures;
}

/**
 * The prop window of the RSVP <PhoneInput ...> JSX element (up to its self-close
 * `/>`), or null. Matches `<PhoneInput` followed by whitespace so the type usage
 * `useMemo<PhoneInputTheme>` (a `<PhoneInput`-PREFIX) never false-matches.
 */
function rsvpPhoneInputElement(normalizedSrc) {
  const m = /<PhoneInput\s/.exec(normalizedSrc);
  if (m === null) return null;
  const open = m.index;
  // The element's props end at its self-closing `/>`. The inline iconRenderer
  // returns `<Icon .../>` BEFORE that, but pickerPresentation is the FIRST prop,
  // so the window up to the first `/>` reliably contains it.
  const rel = normalizedSrc.slice(open).indexOf("/>");
  const end = rel === -1 ? normalizedSrc.length : open + rel;
  return normalizedSrc.slice(open, end);
}

/** Scan the public RSVP callsite (rule C1). */
function scanRsvpCallsite(src) {
  const failures = [];
  const s = normalize(src);
  if (!/useBusinessRsvpPhoneField\s*\(/.test(s)) {
    failures.push(
      "C1: PublicEventPage no longer consumes useBusinessRsvpPhoneField(...). " +
        "The country-aware RSVP renderer ownership chain is missing (ORCH-1299).",
    );
  }
  if (!/renderPhoneField\s*=\s*\{\s*renderRsvpPhoneField\s*\}/.test(s)) {
    failures.push(
      "C1: PublicEventPage no longer passes the shared renderRsvpPhoneField into " +
        "FoundationRsvpPreview. The modal RSVP field can silently fall back to the " +
        "plain input even if the shared renderer remains correct (ORCH-1299).",
    );
  }
  return failures;
}

/** Scan the shared Business RSVP phone renderer (rule C2). */
function scanRsvpRenderer(src) {
  const failures = [];
  const s = normalize(src);
  const el = rsvpPhoneInputElement(s);
  if (el === null) {
    failures.push(
      "C2: could not locate the RSVP <PhoneInput ...> JSX element in " +
        "useBusinessRsvpPhoneField — the shared renderer moved or was removed " +
        "(ORCH-1299).",
    );
  } else if (!/pickerPresentation\s*=\s*"overlay"/.test(el)) {
    failures.push(
      "C2: the shared RSVP <PhoneInput> no longer passes " +
        "pickerPresentation=\"overlay\". " +
        "That field renders inside RsvpDetailsModal, where the default nested " +
        "<Modal> picker freezes on web (ORCH-1299).",
    );
  }
  return failures;
}

/** Scan a checkout host (rule D) — must NOT pass the overlay presentation. */
function scanCheckout(src, rel) {
  const failures = [];
  const s = normalize(src);
  if (/pickerPresentation\s*=\s*"overlay"/.test(s)) {
    failures.push(
      `D: ${rel} passes pickerPresentation="overlay". The buyer-checkout PhoneInput ` +
        "is a standalone page with NO enclosing <Modal>; it must keep the default " +
        "nested-<Modal> picker. Only the RSVP field (inside RsvpDetailsModal) uses " +
        "overlay (ORCH-1299).",
    );
  }
  return failures;
}

/** Scan the overlay component (rule E) — web pins position:'fixed'. */
function scanOverlay(src) {
  const failures = [];
  const s = normalize(src);
  const webFixed =
    /Platform\.OS\s*===\s*"web"\s*\?\s*"fixed"\s*:\s*"absolute"/.test(s);
  if (!webFixed) {
    failures.push(
      "E: CountryPickerOverlay no longer pins position:'fixed' on web. Without it " +
        "the absolute-fill overlay only covers PhoneInput's ~56px field box instead " +
        "of the RSVP details modal, so the picker is not usable (ORCH-1299).",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const HELPER_OK = `
    export function resolvePickerPresentation(presentation, platformOS) {
      if (presentation === "overlay" && platformOS === "web") { return "overlay"; }
      return "modal";
    }`;
  const HELPER_BAD = `
    export function resolvePickerPresentation(presentation, platformOS) {
      if (presentation === "overlay") { return "overlay"; }
      return "modal";
    }`;
  const HANDLE_OK = `
    const handleOpenPicker = () => {
      if (disabled) return;
      Keyboard.dismiss();
      if (Platform.OS === "web") { setPickerVisible(true); return; }
      InteractionManager.runAfterInteractions(() => { setPickerVisible(true); });
    };`;
  const HANDLE_BAD_F = `
    const handleOpenPicker = () => {
      if (disabled) return;
      Keyboard.dismiss();
      InteractionManager.runAfterInteractions(() => { setPickerVisible(true); });
    };`;
  const RENDER_OK = `
    const usePickerOverlay = resolvePickerPresentation(pickerPresentation, Platform.OS) === "overlay";
    return (<View>{pickerVisible ? (usePickerOverlay ? (
        <CountryPickerOverlay selectedCode={countryCode} />
      ) : (
        <CountryPickerModal visible={pickerVisible} />
      )) : null}</View>);`;
  const PHONEINPUT_OK = HANDLE_OK + RENDER_OK;
  // Overlay branch dropped (B fails) — still has web-immediate open.
  const PHONEINPUT_BAD = HANDLE_OK + `
    return (<View>{pickerVisible ? (
        <CountryPickerModal visible={pickerVisible} />
      ) : null}</View>);`;
  // web-immediate open dropped (F fails) — overlay wiring intact.
  const PHONEINPUT_BAD_F = HANDLE_BAD_F + RENDER_OK;
  const RSVP_CALLSITE_OK = `
    const renderRsvpPhoneField = useBusinessRsvpPhoneField(palette, resolvedTheme);
    return <FoundationRsvpPreview renderPhoneField={renderRsvpPhoneField} />;`;
  const RSVP_CALLSITE_BAD_HOOK = `
    const renderRsvpPhoneField = legacyPhoneRenderer;
    return <FoundationRsvpPreview renderPhoneField={renderRsvpPhoneField} />;`;
  const RSVP_CALLSITE_BAD_PROP = `
    const renderRsvpPhoneField = useBusinessRsvpPhoneField(palette, resolvedTheme);
    return <FoundationRsvpPreview />;`;
  const RSVP_RENDERER_OK = `<PhoneInput pickerPresentation="overlay" value={localDigits} countryCode={countryCode} theme={phoneFieldTheme} />`;
  const RSVP_RENDERER_BAD = `<PhoneInput value={localDigits} countryCode={countryCode} theme={phoneFieldTheme} />`;
  const CHECKOUT_OK = `<PhoneInput value={digits} countryCode={code} theme={darkTheme} />`;
  const CHECKOUT_BAD = `<PhoneInput pickerPresentation="overlay" value={digits} countryCode={code} />`;
  const OVERLAY_OK = `const overlayStyle = { ...styles.overlayContainer, position: Platform.OS === "web" ? "fixed" : "absolute" };`;
  const OVERLAY_BAD = `const overlayStyle = { ...styles.overlayContainer };`;

  const check = (label, failures, expectFail) => {
    if (expectFail && failures.length === 0) {
      console.error(`ORCH-1299 self-test FAIL: ${label} should have failed but passed.`);
      process.exit(1);
    }
    if (!expectFail && failures.length !== 0) {
      console.error(
        `ORCH-1299 self-test FAIL: ${label} should have passed but reported:\n` +
          failures.join("\n"),
      );
      process.exit(1);
    }
  };

  // GOOD shapes pass.
  check("helper GOOD", scanHelper(HELPER_OK), false);
  check("phoneinput GOOD", scanPhoneInput(PHONEINPUT_OK), false);
  check("rsvp callsite GOOD", scanRsvpCallsite(RSVP_CALLSITE_OK), false);
  check("rsvp renderer GOOD", scanRsvpRenderer(RSVP_RENDERER_OK), false);
  check("checkout GOOD", scanCheckout(CHECKOUT_OK, "checkout"), false);
  check("overlay GOOD", scanOverlay(OVERLAY_OK), false);

  // BAD shapes (each a plausible revert) fail.
  check("helper BAD (web gate dropped)", scanHelper(HELPER_BAD), true);
  check("phoneinput BAD (overlay branch dropped)", scanPhoneInput(PHONEINPUT_BAD), true);
  check("phoneinput BAD_F (web-immediate open dropped)", scanPhoneInput(PHONEINPUT_BAD_F), true);
  check(
    "rsvp callsite BAD (shared hook dropped)",
    scanRsvpCallsite(RSVP_CALLSITE_BAD_HOOK),
    true,
  );
  check(
    "rsvp callsite BAD (renderer prop dropped)",
    scanRsvpCallsite(RSVP_CALLSITE_BAD_PROP),
    true,
  );
  check(
    "rsvp renderer BAD (overlay prop dropped)",
    scanRsvpRenderer(RSVP_RENDERER_BAD),
    true,
  );
  check("checkout BAD (overlay leaked in)", scanCheckout(CHECKOUT_BAD, "checkout"), true);
  check("overlay BAD (web fixed dropped)", scanOverlay(OVERLAY_BAD), true);

  console.log(
    "ORCH-1299 gate self-test PASS (14/14: 6 fixed shapes pass; 8 reverts fail).",
  );
  process.exit(0);
}

// ---- Live mode
function read(rel) {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    console.error(`ORCH-1299 gate FAIL — cannot read ${rel}: ${err.message}`);
    process.exit(1);
  }
}

const failures = [
  ...scanHelper(read(HELPER_REL)),
  ...scanPhoneInput(read(PHONEINPUT_REL)),
  ...scanOverlay(read(OVERLAY_REL)),
  ...scanRsvpCallsite(read(RSVP_REL)),
  ...scanRsvpRenderer(read(RSVP_RENDERER_REL)),
  ...CHECKOUT_RELS.flatMap((rel) => scanCheckout(read(rel), rel)),
];

if (failures.length > 0) {
  console.error(
    "ORCH-1299 gate FAIL — the RSVP phone country-picker overlay wiring " +
      "regressed:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nThe RSVP guest phone field lives inside RsvpDetailsModal; on " +
      "react-native-web a <Modal> nested in a <Modal> freezes, so PhoneInput must " +
      "select CountryPickerOverlay (web) there while the standalone buyer-checkout " +
      "fields keep the nested-<Modal> picker. See ORCH-1299.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1299 gate PASS — resolvePickerPresentation web-gates overlay; PhoneInput " +
    "renders both surfaces; PublicEventPage consumes the shared RSVP renderer; " +
    "the shared RSVP field passes overlay; checkout fields keep modal; overlay " +
    "pins web fixed.",
);
