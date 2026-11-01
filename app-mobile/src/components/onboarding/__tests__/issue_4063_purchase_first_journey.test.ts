import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const flow = readFileSync(resolve(here, "../../OnboardingFlow.tsx"), "utf8");
const welcome = readFileSync(resolve(here, "../../signIn/WelcomeScreen.tsx"), "utf8");

test("purchase-first OTP and ticket reassurance cannot complete onboarding early", () => {
  assert.ok(flow.includes("showTicketConfirmation: foundItems.length > 0"));
  assert.ok(flow.includes("goToSubStep('tickets_found')"));
  assert.ok(flow.includes("onContinue={goNext}"));
  assert.ok(!flow.includes("completeTicketFirst"));
  assert.ok(!flow.includes("onboarding_ticket_first_completed"));
});

test("an untouched visible DOB default cannot masquerade as a committed birthday", () => {
  assert.ok(flow.includes("setBirthdayPickerTouched(false)"));
  assert.ok(
    flow.includes("disabled={!data.userBirthday && !birthdayPickerTouched}"),
  );
  assert.ok(flow.includes("dob_picker_helper"));
  assert.ok(flow.includes("setBirthdayPickerTouched(true)"));
});

test("email sign-in reveals on demand and matches the provider-button system", () => {
  assert.ok(welcome.includes("!emailPanelOpen ? ("));
  assert.ok(welcome.includes('testID="welcome-continue-with-email"'));
  assert.ok(welcome.includes('testID="welcome-email-panel"'));
  assert.ok(welcome.includes('name="mail-outline"'));
  assert.match(
    welcome,
    /emailPanel:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?maxWidth:\s*s\(400\)/,
  );
  assert.match(
    welcome,
    /emailButton:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?maxWidth:\s*s\(400\)[\s\S]*?minHeight:\s*vs\(56\)[\s\S]*?backgroundColor:\s*colors\.background\.primary[\s\S]*?borderWidth:\s*1\.5[\s\S]*?borderRadius:\s*radius\.lg/,
  );
  assert.match(
    welcome,
    /emailSubmit:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?maxWidth:\s*s\(400\)[\s\S]*?minHeight:\s*vs\(56\)[\s\S]*?borderRadius:\s*radius\.lg[\s\S]*?backgroundColor:\s*colors\.background\.primary[\s\S]*?borderWidth:\s*1\.5/,
  );
});

test("the generic bought-a-ticket footer is absent from the welcome screen", () => {
  assert.ok(!welcome.includes('testID="welcome-cold-ticket-line"'));
  assert.ok(!welcome.includes('testID="welcome-ticket-any-hint"'));
  assert.ok(!welcome.includes("auth:welcome.coldTicketLine"));
});
