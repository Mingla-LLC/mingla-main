#!/usr/bin/env node
/**
 * ORCH-1227 [business-name-and-legal-links] —
 * I-PROPOSED-1227-BUSINESS-NAME-AND-LEGAL-LINKS.
 *
 * WHY: two App-Store-blocking fixes in the BUSINESS app:
 *  (1) Apple rejected the build with ITMS-90129 because the app's
 *      CFBundleDisplayName/CFBundleName resolved to the generic "Business"
 *      ("bundle name/display name already taken"). The fix renames the Expo
 *      top-level `name` to "Mingla Business". A revert back to the bare
 *      "Business" must FAIL CI.
 *  (2) the login footer legal links pointed at a DEAD domain
 *      (https://mingla.app/terms, https://mingla.app/privacy — both 000). The
 *      fix points them at the live usemingla.com pages (both HTTP 200). A revert
 *      that reintroduces the dead mingla.app links must FAIL CI.
 *
 * ASSERTS:
 *  A. mingla-business/app.json — the Expo top-level `name` is exactly
 *     "Mingla Business" (and is NOT the bare "Business").
 *  B. BusinessWelcomeScreen.tsx — TERMS_URL = the usemingla.com terms-of-service
 *     URL and PRIVACY_URL = the usemingla.com privacy-policy URL, and the dead
 *     mingla.app/terms + mingla.app/privacy strings are GONE.
 *
 * `--self-test` proves PASS-on-fix + FAIL-on-revert for each assertion.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const APP_JSON = path.join(root, "mingla-business/app.json");
const WELCOME = path.join(
  root,
  "mingla-business/src/components/auth/BusinessWelcomeScreen.tsx",
);

const EXPECTED_NAME = "Mingla Business";
const TERMS_URL = "https://usemingla.com/terms-of-service";
const PRIVACY_URL = "https://usemingla.com/privacy-policy";
const DEAD_TERMS = "https://mingla.app/terms";
const DEAD_PRIVACY = "https://mingla.app/privacy";

// FIX 1 — app.json top-level Expo name must be "Mingla Business".
function checkAppJson(appJsonSrc, failures) {
  let parsed;
  try {
    parsed = JSON.parse(appJsonSrc);
  } catch (e) {
    failures.push(`app.json is not valid JSON: ${e.message}`);
    return;
  }
  const name = parsed?.expo?.name;
  if (name !== EXPECTED_NAME) {
    failures.push(
      `app.json expo.name must be "${EXPECTED_NAME}" — found ${JSON.stringify(name)}.`,
    );
  }
  if (name === "Business") {
    failures.push(
      `app.json expo.name is the bare generic "Business" (ITMS-90129 regression).`,
    );
  }
}

// FIX 2 — BusinessWelcomeScreen legal links must be the live usemingla.com pages
// and the dead mingla.app links must be gone.
function checkWelcome(welcomeSrc, failures) {
  const hasTerms = new RegExp(
    `TERMS_URL\\s*=\\s*["']${TERMS_URL.replace(/[.\/]/g, "\\$&")}["']`,
  ).test(welcomeSrc);
  if (!hasTerms) {
    failures.push(`TERMS_URL must equal "${TERMS_URL}".`);
  }
  const hasPrivacy = new RegExp(
    `PRIVACY_URL\\s*=\\s*["']${PRIVACY_URL.replace(/[.\/]/g, "\\$&")}["']`,
  ).test(welcomeSrc);
  if (!hasPrivacy) {
    failures.push(`PRIVACY_URL must equal "${PRIVACY_URL}".`);
  }
  if (welcomeSrc.includes(DEAD_TERMS)) {
    failures.push(`dead link "${DEAD_TERMS}" must be removed.`);
  }
  if (welcomeSrc.includes(DEAD_PRIVACY)) {
    failures.push(`dead link "${DEAD_PRIVACY}" must be removed.`);
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const goodAppJson = JSON.stringify({
    expo: { name: "Mingla Business", slug: "mingla-business" },
  });
  const goodWelcome = `
const TERMS_URL = "https://usemingla.com/terms-of-service";
const PRIVACY_URL = "https://usemingla.com/privacy-policy";
`;

  // Good fixtures must pass clean.
  let f = [];
  checkAppJson(goodAppJson, f);
  if (f.length) self.push("good app.json wrongly flagged: " + f.join("; "));
  f = [];
  checkWelcome(goodWelcome, f);
  if (f.length) self.push("good welcome wrongly flagged: " + f.join("; "));

  // Revert A: app.json name back to the bare "Business".
  const revertName = goodAppJson.replace('"Mingla Business"', '"Business"');
  f = [];
  checkAppJson(revertName, f);
  if (f.length === 0) self.push("reverting app.json name to \"Business\" was not flagged");

  // Revert B: TERMS_URL back to the dead mingla.app/terms.
  const revertTerms = goodWelcome.replace(TERMS_URL, DEAD_TERMS);
  f = [];
  checkWelcome(revertTerms, f);
  if (f.length === 0) self.push("reverting TERMS_URL to the dead mingla.app link was not flagged");

  // Revert C: PRIVACY_URL back to the dead mingla.app/privacy.
  const revertPrivacy = goodWelcome.replace(PRIVACY_URL, DEAD_PRIVACY);
  f = [];
  checkWelcome(revertPrivacy, f);
  if (f.length === 0) self.push("reverting PRIVACY_URL to the dead mingla.app link was not flagged");

  if (self.length) {
    console.error("ORCH-1227 business-name-and-legal-links self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1227 business-name-and-legal-links self-test PASS (5/5 cases).");
  process.exit(0);
}

const failures = [];
if (!fs.existsSync(APP_JSON)) {
  failures.push(`app.json not found at ${APP_JSON}.`);
} else {
  checkAppJson(fs.readFileSync(APP_JSON, "utf8"), failures);
}
if (!fs.existsSync(WELCOME)) {
  failures.push(`BusinessWelcomeScreen.tsx not found at ${WELCOME}.`);
} else {
  checkWelcome(fs.readFileSync(WELCOME, "utf8"), failures);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1227 I-PROPOSED-1227-BUSINESS-NAME-AND-LEGAL-LINKS FAIL:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1227 I-PROPOSED-1227-BUSINESS-NAME-AND-LEGAL-LINKS PASS — app name is " +
    '"Mingla Business" and login legal links point at the live usemingla.com pages.',
);
