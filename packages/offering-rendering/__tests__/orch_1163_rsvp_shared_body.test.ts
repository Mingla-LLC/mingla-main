// ORCH-1163 [rsvp-shared-body] — happy-path regression (implementor-owned).
// Deno source-contract style (the established offering-rendering pattern: these
// files import RN-bound modules, so we read source as TEXT and assert the LOCKED
// ORCH-1163 contract).
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - delete the `RsvpOfferingBody` export → §A barrel asserts fail.
//   - re-add a `ParallaxCoverShell` import to RsvpOfferingBody → §A.2 shell-agnostic
//     assert fails.
//   - delete the `orch-1167-date-row` full-width row → §0 canonical-order assert fails.
//   - delete the `RsvpGoingConfirmDialog`/`confirmOpen` wiring → FLOW-A assert fails.
//   - delete the per-guest `orch-1163-rsvp-guest-` fields → FLOW-B assert fails.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const body = await read("../RsvpOfferingBody.tsx");
const dialog = await read("../RsvpGoingConfirmDialog.tsx");
const popup = await read("../RsvpSuccessPopup.tsx");
const barrel = await read("../index.ts");

// ── §A — ONE shared body, exported from the barrel ──
Deno.test("ORCH-1163 §A — barrel exports the shared body + dock + state hook", () => {
  assertStringIncludes(barrel, "RsvpOfferingBody");
  assertStringIncludes(barrel, "RsvpOfferingDecisionDock");
  assertStringIncludes(barrel, "useRsvpOfferingState");
  assertStringIncludes(barrel, "RsvpGoingConfirmDialog");
  assertStringIncludes(barrel, "RsvpSuccessPopup");
});

// ── §A.2 — SHELL-AGNOSTIC: the body never wraps ParallaxCoverShell ──
Deno.test("ORCH-1163 §A.2 — RsvpOfferingBody hosts NO ParallaxCoverShell (shell-agnostic)", () => {
  // Strip comments so the doc-comment that NAMES the forbidden construct doesn't
  // produce a false positive; bind to actual code.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert(
    !code.includes("ParallaxCoverShell"),
    "RsvpOfferingBody must not import/render ParallaxCoverShell (re-triggers the gorhom freeze)",
  );
  // It IS a pure content body — no scroll root is RENDERED (the `onScrollViewLayout`
  // prop name + doc-comment mentions are fine; assert no JSX scroll element).
  assert(
    !code.includes("<ScrollView") && !code.includes("<BottomSheetScrollView"),
    "RsvpOfferingBody must render no scroll root",
  );
});

// ── §0 — canonical 9-section order anchors ──
Deno.test("ORCH-1163 §0 — canonical order: full-width date row + solid-fill pills + inline box", () => {
  // Section 3 — the FULL-WIDTH date row (orch-1167-date-row parity).
  assertStringIncludes(body, 'testID="orch-1167-date-row"');
  assertStringIncludes(body, "accentWash"); // solid-fill pills + date band
  // Section 4 — the canonical pills row (NO tickets-left for RSVP).
  assertStringIncludes(body, 'testID="orch-1167-pills-row"');
  assert(
    !body.includes("tickets left") && !body.includes("ticketsLeftLabel"),
    "RSVP pills row must carry NO tickets-left pill",
  );
  // Section 5 — the inline decision box.
  assertStringIncludes(body, 'testID="orch-1163-rsvp-inline-box"');
  // Party chips PROMOTED to the pills row — the body passes partyTypes={[]} to the
  // momentum unit so styles.chips never renders inside RsvpMomentumDecision.
  assertStringIncludes(body, "partyTypes={[]}");
  // Section 8 — where-you'll-be map.
  assertStringIncludes(body, 'testID="orch-1167-where-map"');
});

// ── decision is the shared RsvpMomentumDecision driven by resolveRsvpCta ──
Deno.test("ORCH-1163 §D — single owners preserved (RsvpMomentumDecision + resolveRsvpCta)", () => {
  assertStringIncludes(body, "RsvpMomentumDecision");
  assertStringIncludes(body, "resolveRsvpCta");
  // testID parity so existing ORCH-1150/1157 guards stay green.
  assertStringIncludes(body, "orch-1150-rsvp-going");
  assertStringIncludes(body, "orch-1150-rsvp-maybe");
  assertStringIncludes(body, "orch-1150-rsvp-not-going");
  assertStringIncludes(body, "orch-1157-rsvp-floating-dock");
});

// ── FLOW A — Going opens the confirm dialog; success popup on resolve ──
Deno.test("ORCH-1163 §G — FLOW A: Going → confirm dialog → success popup; maybe/not-going direct", () => {
  assertStringIncludes(body, "RsvpGoingConfirmDialog");
  assertStringIncludes(body, "RsvpSuccessPopup");
  assertStringIncludes(body, "confirmOpen");
  assertStringIncludes(body, "successDetails");
  // onGoingTap opens the dialog; submitDirect handles maybe/not_going with NO dialog.
  assertStringIncludes(body, "onGoingTap");
  assertStringIncludes(body, 'submitDirect("maybe")');
  assertStringIncludes(body, 'submitDirect("not_going")');
  // The dialog confirm calls onSubmit with rsvpStatus going.
  assertStringIncludes(body, "onConfirmGoing");
});

// ── FLOW A copy + package-isolation of the two new components ──
Deno.test("ORCH-1163 §G — dialog/popup copy + package isolation (no designSystem / app-src)", () => {
  assertStringIncludes(dialog, 'testID="orch-1163-rsvp-going-confirm-dialog"');
  assertStringIncludes(dialog, "Confirm I'm going");
  assertStringIncludes(popup, 'testID="orch-1163-rsvp-success-popup"');
  assertStringIncludes(popup, "You're going!");
  for (const f of [dialog, popup]) {
    // Strip comments — the doc comment legitimately NAMES "designSystem" while
    // asserting it must NOT be imported. Bind to actual import statements.
    const code = f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert(!/from\s+["'][^"']*designSystem/.test(code), "must not import designSystem");
    assert(!/from "\.\.\/\.\.\//.test(code), "must not import app-src (../../)");
    // Only RN + ./themePalette + ./designTokens.
    assertStringIncludes(code, './themePalette"');
  }
});

// ── FLOW B — per-guest plus-one contacts (name+email+phone), not a bare count ──
Deno.test("ORCH-1163 §H — FLOW B: per-guest contact mini-forms, guests array, contactReady gate", () => {
  assertStringIncludes(body, "orch-1163-rsvp-guest-");
  assertStringIncludes(body, "RsvpGuestContact");
  // body owns the per-guest stepper (hideStepper on the momentum unit) + guests array.
  assertStringIncludes(body, "hideStepper");
  assertStringIncludes(body, "guestsValid");
  // primary + every guest must be reachable.
  assertStringIncludes(body, "contactReady = primaryValid && guestsValid");
  // guests submitted with the write.
  assertStringIncludes(body, "guests: submittedGuests");
});

// ── address privacy mirrors the event leg (city-only until going/maybe) ──
Deno.test("ORCH-1163 §C — client address reveal gate (going/maybe) + unlock caption", () => {
  assertStringIncludes(body, "addressRevealed");
  assertStringIncludes(body, 'state.guestStatus === "going"');
  assertStringIncludes(body, 'state.guestStatus === "maybe"');
  assertStringIncludes(body, 'testID="orch-1157-rsvp-address-unlock-caption"');
});
