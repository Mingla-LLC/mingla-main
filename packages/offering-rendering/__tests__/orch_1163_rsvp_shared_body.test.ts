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
//   - drop the guests from the write (buildGuestPayload) → FLOW-B assert fails.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseRsvpBrandFormPage,
  rsvpBrandFormPayload,
} from "../rsvpBrandForm.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const body = await read("../RsvpOfferingBody.tsx");
const dialog = await read("../RsvpGoingConfirmDialog.tsx");
const popup = await read("../RsvpSuccessPopup.tsx");
const barrel = await read("../index.ts");

// #4541 — the shared body owns required-question gating, while each app owns
// its renderer. This stays in the existing shared-body suite so a reversal of
// the single-owner RSVP flow fails the same required lane.
Deno.test("#4541 RSVP questions sit before the decision and required answers gate Going/Maybe", () => {
  assertStringIncludes(body, "questionsNode?: React.ReactNode");
  assertStringIncludes(body, "const decisionReady = contactReady && questionsReady");
  assertStringIncludes(body, 'pendingDecision !== "not_going" ? props.questionsNode ?? null : null');
  assertStringIncludes(body, "Answer the required questions to continue.");
  assertStringIncludes(body, "The questions changed. Review your answers and try again.");
  const boxStart = body.indexOf("export const RsvpDecisionBox");
  const questions = body.indexOf("{state.questionsNode}", boxStart);
  const decision = body.indexOf("<DecisionUnit", boxStart);
  assert(boxStart >= 0 && questions > boxStart && decision > questions,
    "questions must render before the Going/Maybe/Can't decision controls");
});

// #4541 bundle guard — the barrel is in the Host web eager chunk. A value
// re-export of the form helpers there, or an import from the shared Host RSVP
// service, hoists the parser into every visitor's first download (+2 KB
// measured). Fails if either comes back.
Deno.test("#4541 form helpers stay out of the barrel and the shared Host RSVP service", async () => {
  const valueReexport = /export\s*\{[^}]*\}\s*from\s*"\.\/rsvpBrandForm"/;
  assert(!valueReexport.test(barrel), "index.ts may re-export rsvpBrandForm TYPES only");
  assert(/export type\s*\{[^}]*RsvpBrandFormPage[^}]*\}\s*from\s*"\.\/rsvpBrandForm"/.test(barrel));
  const hostService = await read("../../../mingla-business/src/services/rsvpEvents.ts");
  assert(!/import\s*\{[^}]*\}\s*from\s*"@mingla\/offering-rendering\/rsvpBrandForm"/.test(hostService));
  assert(!hostService.includes("parseRsvpBrandFormPage"));
  const leaf = await read("../../../mingla-business/src/services/publicRsvpBrandForm.ts");
  assertStringIncludes(leaf, 'from "@mingla/offering-rendering/rsvpBrandForm"');
});

Deno.test("#4541 public RSVP form parser admits only on-page UUID-backed forms", () => {
  const page = parseRsvpBrandFormPage({
    active: true,
    mode: "required_step",
    formId: "45410000-0000-4000-8000-000000000001",
    versionId: "45410000-0000-4000-8000-000000000002",
    name: "Guest questions",
    definition: { questions: [] },
    doorFullAnswers: true,
    brand: { displayName: "Mingla" },
  });
  assert(page !== null);
  assertEquals(rsvpBrandFormPayload(page, { q1: "Vegan" }), {
    formId: page.formId,
    versionId: page.versionId,
    answers: { q1: "Vegan" },
  });
  assertEquals(parseRsvpBrandFormPage({ ...page, mode: "after_purchase" }), null);
  assertEquals(parseRsvpBrandFormPage({ ...page, versionId: "not-a-uuid" }), null);
  assertEquals(rsvpBrandFormPayload(null, { q1: "Vegan" }), null);
});

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
Deno.test("ORCH-1163 §0 — canonical order: fact rows + tag line + inline box", () => {
  // issue #4420 — sections 3 + 4 are the shared fact rows (when / where, with
  // the doors line and the address-privacy caption) and the quiet tag line,
  // with the SAME testID prefix as the event page (parity).
  assertStringIncludes(body, "<OfferingFactRows");
  assertStringIncludes(body, 'testID="orch-1167-facts"');
  assertStringIncludes(body, 'key: "when"');
  assertStringIncludes(body, 'key: "where"');
  assertStringIncludes(body, "caption: doorsLine");
  assertStringIncludes(body, "caption: addressUnlockCaption");
  // The tag line keeps format → vibes → party types → music, NO tickets-left.
  assertStringIncludes(body, "tags={[");
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
  // [TEST-MOD-APPROVED ORCH-1447] Founder-approved RSVP confirmation copy.
  assertStringIncludes(popup, "You’re on the list");
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

// ── FLOW B — plus-ones are a party of real people, not a bare count ──
// [#4508] Each plus-one used to be a name + email + phone mini-form
// (`orch-1163-rsvp-guest-<i>-*`). Issue #4508 replaced them with "Who's coming
// with you?": a guest is just a phone number (or a friend), sent as
// `{ phone, phoneCountryIso }` by the guest model (each guest's payload). What this test pins is
// unchanged in spirit: the body owns the guests (hideStepper on the momentum
// unit), the party gates the decision, and the guests ride the write.
Deno.test("ORCH-1163 §H — FLOW B: the body owns the party, guests ride the write", () => {
  assertStringIncludes(body, 'testID="orch-1163-rsvp-guests"');
  assertStringIncludes(body, "RsvpGuestPartyBlock");
  assertStringIncludes(body, "hideStepper");
  assertStringIncludes(body, "guestsValid");
  // primary + the party must be ready.
  assertStringIncludes(body, "contactReady = primaryValid && guestsValid");
  // guests submitted with the write, number-only.
  // #4508 round 8: each guest carries its payload (set by the guest model).
  assertStringIncludes(body, "guests: config.allowPlusOnes ? submittedGuests.map((g) => g.payload) : []");
});

// ── address privacy mirrors the event leg (city-only until going/maybe) ──
Deno.test("ORCH-1163 §C — client address reveal gate (going/maybe) + unlock caption", () => {
  assertStringIncludes(body, "addressRevealed");
  assertStringIncludes(body, 'state.guestStatus === "going"');
  assertStringIncludes(body, 'state.guestStatus === "maybe"');
  assertStringIncludes(body, 'testID="orch-1157-rsvp-address-unlock-caption"');
});

// ── #4541 — readiness is computed, not reported by the renderer ──
import { rsvpFormMissingRequiredIds } from "../rsvpBrandForm.ts";
import type { RsvpBrandFormPage } from "../rsvpBrandForm.ts";

const mkPage = (questions: RsvpBrandFormPage["definition"]["questions"]): RsvpBrandFormPage => ({
  active: true,
  mode: "optional_on_page",
  formId: "11111111-1111-4111-8111-111111111111",
  versionId: "22222222-2222-4222-8222-222222222222",
  name: "Q",
  definition: { questions },
  doorFullAnswers: false,
  brand: {},
});
const q = (id: string, position: number, required: boolean, extra = {}) => ({
  id, position, type: "short_text" as const, label: id, required, ...extra,
});

Deno.test("#4541 — missing required ids: unanswered listed, answered empty", () => {
  const page = mkPage([q("a", 1, true), q("b", 2, false), q("c", 3, true)]);
  assertEquals(rsvpFormMissingRequiredIds(page, {}), ["a", "c"]);
  assertEquals(rsvpFormMissingRequiredIds(page, { a: "x", c: "y" }), []);
});

Deno.test("#4541 — blank string and empty array count as missing; optional never listed", () => {
  const page = mkPage([
    q("a", 1, true),
    { ...q("m", 2, true), type: "multi_choice" as const, options: [{ id: "o", label: "O" }] },
    q("opt", 3, false),
  ]);
  assertEquals(rsvpFormMissingRequiredIds(page, { a: "   ", m: [] }), ["a", "m"]);
  assertEquals(rsvpFormMissingRequiredIds(page, { a: "x", m: ["o"] }), []);
});

Deno.test("#4541 — no required questions or no page ⇒ empty; hidden required is not listed", () => {
  assertEquals(rsvpFormMissingRequiredIds(mkPage([q("a", 1, false)]), {}), []);
  assertEquals(rsvpFormMissingRequiredIds(null, {}), []);
  const page = mkPage([
    { ...q("src", 1, false), type: "single_choice" as const, options: [{ id: "yes", label: "Y" }] },
    q("dep", 2, true, { show_if: { question_id: "src", option_id: "yes" } }),
  ]);
  assertEquals(rsvpFormMissingRequiredIds(page, {}), []);
  assertEquals(rsvpFormMissingRequiredIds(page, { src: "yes" }), ["dep"]);
});

Deno.test("#4541 — neither screen uses a __loading__ sentinel", async () => {
  const web = await read("../../../mingla-business/src/components/event/PublicEventPage.tsx");
  const app = await read("../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx");
  assert(!web.includes("__loading__"));
  assert(!app.includes("__loading__"));
});
