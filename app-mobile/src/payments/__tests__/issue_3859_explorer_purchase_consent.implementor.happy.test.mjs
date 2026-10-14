import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appMobileRoot = process.env.MINGLA_ISSUE_3859_SOURCE_ROOT ??
  fileURLToPath(new URL("../../..", import.meta.url));

const readSource = (relativePath) =>
  readFileSync(`${appMobileRoot}/${relativePath}`, "utf8");

const cartSource = readSource("src/components/expandedCard/TicketCartSheet.tsx");
const disclosureSource = readSource("src/constants/consentDisclosure.ts");

test("#3859 Explorer shows the approved purchase-only disclosure", () => {
  assert.match(
    disclosureSource,
    /"I agree to Mingla’s Terms of Service and Privacy Policy\."/,
  );
  assert.match(
    disclosureSource,
    /"2026-10-14-purchase-v1"/,
  );
  assert.match(cartSource, /accessibilityLabel=\{PURCHASE_TERMS_DISCLOSURE_TEXT\}/);
  assert.match(cartSource, /LEGAL_URLS\.termsOfService/);
  assert.match(cartSource, /LEGAL_URLS\.privacyPolicy/);
  assert.equal((cartSource.match(/event\.stopPropagation\(\)/g) ?? []).length, 2);
});

test("#3859 Explorer purchase acceptance cannot mint a marketing consent row", () => {
  assert.match(cartSource, /scopes: \["transactional"\]/);
  assert.doesNotMatch(cartSource, /scopes: \["marketing"\]/);
  assert.doesNotMatch(cartSource, /CHECKOUT_MARKETING_LABEL/);
  assert.doesNotMatch(cartSource, /setMarketingOptIn/);
  assert.doesNotMatch(cartSource, /CONSENT_VISIBLE_FOLLOW_BEFORE/);
});

test("#3859 Explorer reports always-on account marketing without a checkout toggle", () => {
  assert.match(cartSource, /marketingOptIn: true/);
  assert.match(cartSource, /const \[termsAccepted, setTermsAccepted\]/);
  assert.doesNotMatch(cartSource, /const \[marketingOptIn, setMarketingOptIn\]/);
  assert.match(
    cartSource,
    /purchaseTermsAccepted: termsAccepted,[\s\S]*?buyer: contactValidation\.normalized/,
  );
});

test("#3859 Explorer purchase audit uses the booking-local contact snapshot", () => {
  assert.match(
    cartSource,
    /void recordConsent\(\{[\s\S]*?scopes: \["transactional"\],[\s\S]*?phone: contactValidation\.normalized\.phone,[\s\S]*?email: contactValidation\.normalized\.email/,
  );
});
