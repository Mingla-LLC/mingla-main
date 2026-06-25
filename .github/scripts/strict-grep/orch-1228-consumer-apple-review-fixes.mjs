#!/usr/bin/env node
/**
 * ORCH-1228 [consumer-apple-review-rejections] —
 * I-PROPOSED-1228-CONSUMER-APPLE-REVIEW-FIXES.
 *
 * WHY: Apple rejected the CONSUMER app (Mingla – Date Plans & City Gems, iOS
 * 1.1.0 build 29) for four code-fixable issues. This gate locks the fixes so a
 * revert FAILS CI:
 *
 *   FIX 2 (Guideline 5.1.1(iv)) — the location pre-permission button must NOT use
 *     persuasive wording. en/onboarding.json `location.enable_location` and
 *     `location.cta_enable` must NOT be "Enable Location"/"Enable location".
 *
 *   FIX 5 (Guideline 5.1.1(ii)) — NSCalendarsUsageDescription must explain the use
 *     AND give a concrete example (e.g. "reservation", "ticketed show", "like a").
 *
 *   FIX 3 (Guideline 2.1) — ATT must fire reliably BEFORE tracking. The
 *     deterministic ATT gate must exist: permissionOrchestrator exports
 *     `ensureAttRequested` + `whenAttResolved`; app/index.tsx calls
 *     `ensureAttRequested()`; postHogService awaits `whenAttResolved()` before
 *     creating its client.
 *
 *   FIX 1 (Guideline 4) — Sign in with Apple must NOT re-ask for name/email. The
 *     `isAppleSignIn` flag must thread through onboarding: detected in
 *     useOnboardingResume and used to make the welcome name gate non-blocking in
 *     OnboardingFlow.
 *
 * `--self-test` proves PASS-on-fix + FAIL-on-revert for each assertion.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const EN_ONBOARDING = path.join(
  root,
  "app-mobile/src/i18n/locales/en/onboarding.json",
);
const APP_JSON = path.join(root, "app-mobile/app.json");
const PERM_ORCH = path.join(
  root,
  "app-mobile/src/services/permissionOrchestrator.ts",
);
const APP_INDEX = path.join(root, "app-mobile/app/index.tsx");
const POSTHOG = path.join(root, "app-mobile/src/services/postHogService.ts");
const RESUME = path.join(root, "app-mobile/src/hooks/useOnboardingResume.ts");
const ONBOARDING_FLOW = path.join(
  root,
  "app-mobile/src/components/OnboardingFlow.tsx",
);

// Banned persuasive wordings for the location pre-permission button (FIX 2).
const BANNED_LOCATION_WORDS = ["Enable Location", "Enable location"];

// ── FIX 2: location button wording ──────────────────────────────────────────
function checkLocationWording(onboardingSrc, failures) {
  let parsed;
  try {
    parsed = JSON.parse(onboardingSrc);
  } catch (e) {
    failures.push(`en/onboarding.json is not valid JSON: ${e.message}`);
    return;
  }
  const loc = parsed?.location;
  if (!loc || typeof loc !== "object") {
    failures.push(`en/onboarding.json has no "location" block.`);
    return;
  }
  for (const key of ["enable_location", "cta_enable"]) {
    const val = loc[key];
    if (typeof val !== "string" || val.length === 0) {
      failures.push(`en/onboarding.json location.${key} is missing/empty.`);
      continue;
    }
    if (BANNED_LOCATION_WORDS.includes(val)) {
      failures.push(
        `en/onboarding.json location.${key} is persuasive wording "${val}" — Apple 5.1.1(iv) regression (must be neutral, e.g. "Continue").`,
      );
    }
  }
}

// ── FIX 5: calendar purpose string ──────────────────────────────────────────
function checkCalendarString(appJsonSrc, failures) {
  let parsed;
  try {
    parsed = JSON.parse(appJsonSrc);
  } catch (e) {
    failures.push(`app.json is not valid JSON: ${e.message}`);
    return;
  }
  const desc =
    parsed?.expo?.ios?.infoPlist?.NSCalendarsUsageDescription;
  if (typeof desc !== "string" || desc.length === 0) {
    failures.push(`app.json NSCalendarsUsageDescription is missing/empty.`);
    return;
  }
  // Must contain a concrete example/trigger (Apple 5.1.1(ii)).
  if (!/reservation|ticketed show|like a/i.test(desc)) {
    failures.push(
      `NSCalendarsUsageDescription lacks a concrete example — Apple 5.1.1(ii). Must match /reservation|ticketed show|like a/. Found: "${desc}".`,
    );
  }
}

// ── FIX 3: ATT-before-tracking gate ─────────────────────────────────────────
function checkAttGate(permSrc, indexSrc, posthogSrc, failures) {
  // (a) permissionOrchestrator exports the single-flight gate.
  if (!/export\s+function\s+ensureAttRequested\b/.test(permSrc)) {
    failures.push(
      `permissionOrchestrator.ts must export ensureAttRequested() (the deterministic ATT trigger).`,
    );
  }
  if (!/export\s+function\s+whenAttResolved\b/.test(permSrc)) {
    failures.push(
      `permissionOrchestrator.ts must export whenAttResolved() (the ATT-before-tracking gate).`,
    );
  }
  if (!/requestTrackingPermissionsAsync/.test(permSrc)) {
    failures.push(
      `permissionOrchestrator.ts must still request ATT via requestTrackingPermissionsAsync().`,
    );
  }
  // (b) app/index.tsx fires ATT deterministically at the home screen.
  if (!/ensureAttRequested\s*\(/.test(indexSrc)) {
    failures.push(
      `app/index.tsx must call ensureAttRequested() so ATT fires independent of the coach-mark tour.`,
    );
  }
  // (c) PostHog awaits the gate before initializing (ATT-before-tracking).
  if (!/whenAttResolved\s*\(/.test(posthogSrc)) {
    failures.push(
      `postHogService.ts must await whenAttResolved() before creating the client (no tracking before ATT).`,
    );
  }
}

// ── FIX 1: SIWA name/email skip ─────────────────────────────────────────────
function checkSiwaSkip(resumeSrc, flowSrc, failures) {
  // (a) useOnboardingResume detects Sign in with Apple and sets isAppleSignIn.
  if (!/isAppleSignIn/.test(resumeSrc)) {
    failures.push(
      `useOnboardingResume.ts must set isAppleSignIn (detect Sign in with Apple).`,
    );
  }
  if (!/['"]apple['"]/.test(resumeSrc)) {
    failures.push(
      `useOnboardingResume.ts must detect the 'apple' auth provider.`,
    );
  }
  // (b) OnboardingFlow uses isAppleSignIn to make the name gate non-blocking.
  if (!/isAppleSignIn/.test(flowSrc)) {
    failures.push(
      `OnboardingFlow.tsx must read isAppleSignIn to skip the mandatory name gate for SIWA users.`,
    );
  }
  // The welcome CTA must condition `disabled` on isAppleSignIn (non-blocking).
  if (
    !/data\.isAppleSignIn\s*\?\s*false\s*:/.test(flowSrc)
  ) {
    failures.push(
      `OnboardingFlow.tsx welcome CTA must be non-blocking when data.isAppleSignIn (e.g. \`data.isAppleSignIn ? false : !nameReady\`).`,
    );
  }
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const self = [];

  // Good fixtures.
  const goodOnboarding = JSON.stringify({
    location: { enable_location: "Continue", cta_enable: "Continue" },
  });
  const goodAppJson = JSON.stringify({
    expo: {
      ios: {
        infoPlist: {
          NSCalendarsUsageDescription:
            "Mingla adds events you book or RSVP to — like a dinner reservation or a ticketed show — to your device calendar.",
        },
      },
    },
  });
  const goodPerm = `
export function ensureAttRequested() {}
export function whenAttResolved() {}
await requestTrackingPermissionsAsync();
`;
  const goodIndex = `ensureAttRequested().then(() => startAppsFlyer());`;
  const goodPosthog = `const { whenAttResolved } = await import("./permissionOrchestrator"); await whenAttResolved();`;
  const goodResume = `base.isAppleSignIn = provider === 'apple' || identityProviders.includes('apple');`;
  const goodFlow = `const disabled = data.isAppleSignIn ? false : !nameReady;`;

  // All-good must pass clean.
  let f = [];
  checkLocationWording(goodOnboarding, f);
  if (f.length) self.push("good onboarding wrongly flagged: " + f.join("; "));
  f = [];
  checkCalendarString(goodAppJson, f);
  if (f.length) self.push("good app.json wrongly flagged: " + f.join("; "));
  f = [];
  checkAttGate(goodPerm, goodIndex, goodPosthog, f);
  if (f.length) self.push("good ATT gate wrongly flagged: " + f.join("; "));
  f = [];
  checkSiwaSkip(goodResume, goodFlow, f);
  if (f.length) self.push("good SIWA wrongly flagged: " + f.join("; "));

  // Revert FIX 2: button back to "Enable Location".
  f = [];
  checkLocationWording(
    JSON.stringify({
      location: { enable_location: "Enable Location", cta_enable: "Enable location" },
    }),
    f,
  );
  if (f.length === 0)
    self.push('reverting location button to "Enable Location" was not flagged');

  // Revert FIX 5: calendar string back to the vague original.
  f = [];
  checkCalendarString(
    JSON.stringify({
      expo: {
        ios: {
          infoPlist: {
            NSCalendarsUsageDescription:
              "Mingla needs calendar access to add scheduled experiences to your device calendar.",
          },
        },
      },
    }),
    f,
  );
  if (f.length === 0)
    self.push("reverting calendar string to the vague original was not flagged");

  // Revert FIX 3 (a): remove ensureAttRequested export.
  f = [];
  checkAttGate(
    "export function whenAttResolved() {}\nrequestTrackingPermissionsAsync();",
    goodIndex,
    goodPosthog,
    f,
  );
  if (f.length === 0)
    self.push("removing ensureAttRequested export was not flagged");

  // Revert FIX 3 (c): PostHog no longer awaits the gate.
  f = [];
  checkAttGate(goodPerm, goodIndex, "new PostHogClass(key, {});", f);
  if (f.length === 0)
    self.push("removing PostHog whenAttResolved await was not flagged");

  // Revert FIX 1: welcome CTA back to always-blocking.
  f = [];
  checkSiwaSkip(goodResume, "const disabled = !nameReady;", f);
  if (f.length === 0)
    self.push("reverting welcome CTA to always-blocking was not flagged");

  // Revert FIX 1: resume no longer sets isAppleSignIn.
  f = [];
  checkSiwaSkip("base.firstName = profile.first_name;", goodFlow, f);
  if (f.length === 0)
    self.push("removing isAppleSignIn detection was not flagged");

  if (self.length) {
    console.error("ORCH-1228 consumer-apple-review-fixes self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1228 consumer-apple-review-fixes self-test PASS (all PASS-on-fix + FAIL-on-revert cases).",
  );
  process.exit(0);
}

// ── LIVE RUN ─────────────────────────────────────────────────────────────────
const failures = [];

function readOrFail(p, label) {
  if (!fs.existsSync(p)) {
    failures.push(`${label} not found at ${p}.`);
    return null;
  }
  return fs.readFileSync(p, "utf8");
}

const onboardingSrc = readOrFail(EN_ONBOARDING, "en/onboarding.json");
if (onboardingSrc) checkLocationWording(onboardingSrc, failures);

const appJsonSrc = readOrFail(APP_JSON, "app-mobile/app.json");
if (appJsonSrc) checkCalendarString(appJsonSrc, failures);

const permSrc = readOrFail(PERM_ORCH, "permissionOrchestrator.ts");
const indexSrc = readOrFail(APP_INDEX, "app/index.tsx");
const posthogSrc = readOrFail(POSTHOG, "postHogService.ts");
if (permSrc && indexSrc && posthogSrc)
  checkAttGate(permSrc, indexSrc, posthogSrc, failures);

const resumeSrc = readOrFail(RESUME, "useOnboardingResume.ts");
const flowSrc = readOrFail(ONBOARDING_FLOW, "OnboardingFlow.tsx");
if (resumeSrc && flowSrc) checkSiwaSkip(resumeSrc, flowSrc, failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1228 I-PROPOSED-1228-CONSUMER-APPLE-REVIEW-FIXES FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1228 I-PROPOSED-1228-CONSUMER-APPLE-REVIEW-FIXES PASS — location button neutral, calendar string has a concrete example, ATT-before-tracking gate present, SIWA name/email skip wired.",
);
