import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const step = readFileSync(resolve(here, "../TicketsFoundStep.tsx"), "utf8");
const flow = readFileSync(resolve(here, "../../OnboardingFlow.tsx"), "utf8");
const copy = JSON.parse(
  readFileSync(
    resolve(here, "../../../i18n/locales/en/purchases.json"),
    "utf8",
  ),
);

test("#4203 ticket confirmation names its real next action", () => {
  assert.equal(copy.found.continueSetup, "Continue setup");
  assert.match(copy.found.setupBody, /Finish setting up Mingla/);
  assert.match(copy.found.setupFooter, /Purchases/);
  assert.ok(step.includes('t("found.continueSetup")'));
  assert.ok(!step.includes("See my purchases"));
  assert.ok(!step.includes("AddIdentitySheet"));
});

test("#4203 pending intent does not force a false ticket-found screen", () => {
  assert.ok(flow.includes("showTicketConfirmation: foundItems.length > 0"));
  assert.ok(!flow.includes("Even when the purchase is already linked"));
});

test("#4203 leaves the existing Purchases coach mark outside this component", () => {
  assert.ok(!step.toLowerCase().includes("coach"));
  assert.ok(!step.includes("getting_experiences"));
});
