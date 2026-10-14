import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const appMobileRoot = process.env.MINGLA_ISSUE_3859_SOURCE_ROOT ??
  fileURLToPath(new URL("../../..", import.meta.url));

const readSource = (relativePath) =>
  readFileSync(`${appMobileRoot}/${relativePath}`, "utf8");

const cartSource = readSource("src/components/expandedCard/TicketCartSheet.tsx");
const checkoutScreens = [
  "src/screens/Event/ConsumerEventDetailScreen.tsx",
  "src/screens/Trip/ConsumerTripDetailScreen.tsx",
  "src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
].map((path) => ({ path, source: readSource(path) }));

test("#3859 real Explorer cart owns recap, Change, and missing-only contact editing", () => {
  assert.match(cartSource, /CONTACT FOR THIS BOOKING/);
  assert.match(cartSource, /Change contact for this booking/);
  assert.match(cartSource, /Save for this booking/);
  assert.match(cartSource, /explorerCheckoutContactFieldsForEditor\(validation, false\)/);
  assert.match(cartSource, /We’ll send booking updates and receipts here\./);
  assert.match(cartSource, /buyer: contactValidation\.normalized/);
});

test("#3859 contact edits are booking-local and preserve cart authority", () => {
  assert.doesNotMatch(cartSource, /setProfile|updateProfile|profiles["']?\)\.update/);
  assert.match(cartSource, /lines: lines/);
  assert.match(cartSource, /totalCents: pricing\.allInCents/);
  assert.match(cartSource, /intakeFormData/);
  assert.match(cartSource, /paymentPlanChoice:/);
});

test("#3859 every migrated Explorer checkout sends the saved booking snapshot", () => {
  for (const { path, source } of checkoutScreens) {
    assert.match(source, /resolveExplorerCheckoutContact\(/, path);
    assert.match(source, /buyerName=\{explorerCheckoutContact\.normalized\.name\}/, path);
    assert.match(source, /\.\.\.payload\.buyer/, path);
    assert.doesNotMatch(source, /const buyerName\s*=/, path);
    assert.doesNotMatch(
      source,
      /buyerName=\{\s*profile\?\.display_name.*Guest/s,
      path,
    );
  }
});

test("#3859 leaves the existing consent rail in place pending approved legal copy", () => {
  assert.match(cartSource, /const \[marketingOptIn, setMarketingOptIn\]/);
  assert.match(cartSource, /void recordConsent\(\{/);
  assert.match(cartSource, /marketingOptIn,/);
  assert.match(cartSource, /disclosureVersion:/);
});
