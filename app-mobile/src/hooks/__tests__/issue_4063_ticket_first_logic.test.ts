import assert from "node:assert/strict";
import test from "node:test";

import {
  advance,
  buildSequence,
  STEP_SUBSTEPS,
} from "../onboardingSequenceLogic.ts";
import {
  decideOnboardingMode,
  deferredLocationSeedFromOrder,
} from "../ticketFirstLogic.ts";

test("ticket-first mode is selected for an intent, a claim, or an upcoming purchase", () => {
  assert.equal(decideOnboardingMode({
    pendingClaim: { code: "AB12CD34EF" },
    lastClaim: null,
    hasUpcomingPurchase: false,
  }), "ticket_first");
  assert.equal(decideOnboardingMode({
    pendingClaim: null,
    lastClaim: { count: 1 },
    hasUpcomingPurchase: false,
  }), "ticket_first");
  assert.equal(decideOnboardingMode({
    pendingClaim: null,
    lastClaim: null,
    hasUpcomingPurchase: true,
  }), "ticket_first");
  assert.equal(decideOnboardingMode({
    pendingClaim: null,
    lastClaim: { count: 0 },
    hasUpcomingPurchase: false,
  }), "full");
});

test("ticket-first sequence reassures the buyer then continues normal onboarding", () => {
  assert.deepEqual(
    buildSequence(1, false, "ticket_first", {
      needsLanguage: false,
      phonePreVerified: false,
      showTicketConfirmation: true,
    }),
    [
      "welcome",
      "phone",
      "otp",
      "tickets_found",
      "gender_identity",
      "details",
    ],
  );
  for (const step of [2, 3, 4, 5, 7] as const) {
    assert.deepEqual(
      buildSequence(step, false, "ticket_first"),
      STEP_SUBSTEPS[step],
    );
  }
  assert.deepEqual(buildSequence(6, false, "ticket_first"), []);
  assert.deepEqual(
    advance({ step: 1, subStep: "tickets_found" }, false, "ticket_first", {
      needsLanguage: false,
      phonePreVerified: false,
      showTicketConfirmation: true,
    }),
    { kind: "move", next: { step: 1, subStep: "gender_identity" } },
  );
  assert.deepEqual(
    advance({ step: 1, subStep: "details" }, false, "ticket_first"),
    { kind: "move", next: { step: 2, subStep: "value_prop" } },
  );

  let state: Parameters<typeof advance>[0] = { step: 1, subStep: "welcome" };
  for (let transition = 0; transition < 30; transition += 1) {
    const result = advance(state, false, "ticket_first", {
      needsLanguage: false,
      phonePreVerified: false,
      showTicketConfirmation: true,
    });
    assert.notEqual(result.kind, "stay", `ticket-first dead-ended at ${state.step}/${state.subStep}`);
    if (result.kind === "launch") {
      assert.equal(state.step, 7);
      assert.equal(state.subStep, "getting_experiences");
      return;
    }
    state = result.next;
  }
  assert.fail("ticket-first did not reach launch within the bounded journey");
});

test("ticket-first skips verified phone and keeps language only when needed", () => {
  assert.deepEqual(
    buildSequence(1, false, "ticket_first", {
      needsLanguage: true,
      phonePreVerified: true,
      showTicketConfirmation: true,
    }),
    ["language", "welcome", "tickets_found", "gender_identity", "details"],
  );
});

test("ticket intent alone continues onboarding without a false found screen", () => {
  assert.deepEqual(
    buildSequence(1, false, "ticket_first", {
      needsLanguage: false,
      phonePreVerified: false,
      showTicketConfirmation: false,
    }),
    ["welcome", "phone", "otp", "gender_identity", "details"],
  );
});

test("finish-setup excludes language, welcome, phone, and otp", () => {
  assert.deepEqual(buildSequence(1, true, "finish_setup"), [
    "gender_identity",
    "details",
  ]);
  assert.deepEqual(buildSequence(2, true, "finish_setup"), STEP_SUBSTEPS[2]);
  assert.deepEqual(buildSequence(3, true, "finish_setup", {
    needsLanguage: false,
    phonePreVerified: true,
    skipLocation: true,
  }), []);
  assert.deepEqual(buildSequence(3, true, "finish_setup", {
    needsLanguage: false,
    phonePreVerified: true,
    skipLocation: false,
  }), ["location"]);
});

test("finish-setup accepts only bounded authenticated order location seeds", () => {
  assert.deepEqual(deferredLocationSeedFromOrder({
    city: "London",
    locationGeo: "(-0.1276,51.5072)",
  }), { city: "London", lat: 51.5072, lng: -0.1276 });
  assert.deepEqual(deferredLocationSeedFromOrder({
    city: "Lagos",
    locationGeo: { x: 3.3792, y: 6.5244 },
  }), { city: "Lagos", lat: 6.5244, lng: 3.3792 });
  assert.equal(deferredLocationSeedFromOrder({
    city: "Nowhere",
    locationGeo: "(181,95)",
  }), null);
  assert.equal(deferredLocationSeedFromOrder({
    city: "",
    locationGeo: { lat: 6.5, lng: 3.4 },
  }), null);
});

test("full mode remains byte-for-byte the existing static sequence", () => {
  for (const step of [1, 2, 3, 4, 5, 7] as const) {
    assert.deepEqual(buildSequence(step, true), STEP_SUBSTEPS[step]);
  }
  assert.deepEqual(buildSequence(6, false), []);
});
