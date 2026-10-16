import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const COMPOSER = read("src/components/email/EmailComposer.jsx");
const PAGE = read("src/pages/EmailPage.jsx");

describe("#3720 exact Admin email composer contract", () => {
  it("is the default Email surface inside the existing page and has exactly two primary panels", () => {
    assert.match(PAGE, /<EmailComposer/);
    assert.doesNotMatch(PAGE, /VITE_ADMIN_EMAIL_COMPOSER/);
    assert.doesNotMatch(PAGE, /<LegacyComposeSubView/);
    assert.match(COMPOSER, /xl:grid-cols-\[minmax\(0,1\.8fr\)_minmax\(340px,0\.9fr\)\]/);
    assert.match(COMPOSER, /<section/);
    assert.match(COMPOSER, /<aside/);
  });

  it("keeps actionable filters visible and gives every optional filter an All state", () => {
    for (const label of ["User type", "Country", "Onboarding", "Account status", "Email status", "Language", "Beta tester", "Joined from"]) {
      assert.match(COMPOSER, new RegExp(label));
    }
    assert.match(COMPOSER, /Host/);
    assert.match(COMPOSER, /Explorer/);
    assert.match(COMPOSER, /All countries/);
    assert.match(COMPOSER, /All languages/);
    assert.match(COMPOSER, /Clear all and send to everyone/);
  });

  it("locks identities, personalizes subject/body, and supports safe rich media", () => {
    assert.match(COMPOSER, /Mingla &lt;hello@usemingla\.com&gt;/);
    assert.match(COMPOSER, /noreply@usemingla\.com/);
    for (const token of ["first_name", "display_name", "username", "country", "language", "joined_date"]) {
      assert.match(COMPOSER, new RegExp(token));
    }
    assert.match(COMPOSER, /createLink/);
    assert.match(COMPOSER, /admin-email-assets/);
    assert.match(COMPOSER, /image\/gif/);
    assert.match(COMPOSER, /Add divider/);
    assert.match(COMPOSER, /overflow-x-auto/);
  });

  it("uses the canonical centered Mingla email wordmark in the local preview", () => {
    assert.match(COMPOSER, /mingla-wordmark-email\.png/);
    assert.match(COMPOSER, /alt="Mingla"/);
    assert.match(COMPOSER, /items-center justify-center/);
    assert.match(COMPOSER, /h-8 w-\[90px\] object-contain/);
    assert.doesNotMatch(COMPOSER, />mingla<span/);
  });

  it("has send-now and timezone-aware scheduling without a client count cap", () => {
    assert.match(COMPOSER, /Send now/);
    assert.match(COMPOSER, /datetime-local/);
    assert.match(COMPOSER, /resolvedOptions\(\)\.timeZone/);
    assert.equal(COMPOSER.includes("DAILY_EMAIL_LIMIT"), false);
    assert.equal(COMPOSER.includes("limitReached"), false);
  });
});
