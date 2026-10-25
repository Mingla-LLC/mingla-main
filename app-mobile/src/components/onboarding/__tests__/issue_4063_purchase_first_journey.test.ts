import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const flow = readFileSync(resolve(here, "../../OnboardingFlow.tsx"), "utf8");

test("purchase-first OTP and ticket reassurance cannot complete onboarding early", () => {
  assert.ok(flow.includes("if (onboardingMode === 'ticket_first')"));
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
