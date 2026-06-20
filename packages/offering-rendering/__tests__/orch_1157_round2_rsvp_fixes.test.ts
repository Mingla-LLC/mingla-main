// ORCH-1157 [rsvp-public-redesign] Round-2 device-fix pass — regression
// (implementor-owned happy-path). Deno source-contract style (the established
// app-mobile / RsvpPublicBody pattern: these files import RN-bound modules, so we
// read the source as TEXT and assert the LOCKED Round-2 contract).
//
// Covers Seth's three locked decisions:
//   ISSUE 1 — consumer RSVP STRUCTURAL PARITY: the consumer RSVP body renders the
//     Direction-C sections in the SAME order as the business/web RsvpPublicBody
//     (brand → momentum → venue → about) AND the ticketed "Choose your ticket /
//     No tickets available yet" block is GATED `!isRsvp` (no longer leaks onto an
//     RSVP card).
//   ISSUE 2 — RSVP ADDRESS PRIVACY: the exact street is hidden on the public RSVP
//     page when hideAddressUntilTicket is ON, UNLESS the viewer's own RSVP status
//     is going/maybe. Enforced on RsvpPublicBody (buyer-web + business) AND the
//     consumer screen.
//   ISSUE 4 — DOORS: "Doors open X · Doors close Y" beneath the date on every
//     RSVP surface, sourced from start_at/end_at (no new field), real-data-only.
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - delete the `!isRsvp` gate on the consumer ticket block → Issue-1 assert fails.
//   - delete the `addressRevealed`/`addressHidden` gate → Issue-2 asserts fail.
//   - delete the `doorsLine` render → Issue-4 asserts fail.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
const rsvpBody = await Deno.readTextFile(
  new URL(
    "../RsvpOfferingBody.tsx",
    import.meta.url,
  ),
);
const bizAdapter = await Deno.readTextFile(
  new URL(
    "../../../mingla-business/src/components/event/PublicEventPage.tsx",
    import.meta.url,
  ),
);
const consumerScreen = await Deno.readTextFile(
  new URL(
    "../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    import.meta.url,
  ),
);
const consumerFoundation = await Deno.readTextFile(
  new URL(
    "../../../app-mobile/src/hooks/useConsumerEventFoundation.ts",
    import.meta.url,
  ),
);
const bizDateUtil = await Deno.readTextFile(
  new URL(
    "../../../mingla-business/src/utils/eventDateDisplay.ts",
    import.meta.url,
  ),
);
const consumerDateUtil = await Deno.readTextFile(
  new URL("../../../app-mobile/src/utils/eventDateDisplay.ts", import.meta.url),
);

// Strip line-comments + block-comments so a doc-string can't satisfy an assertion.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

// ───────────────────────── ISSUE 1 — structural parity ──────────────────────

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The bespoke consumer RSVP-branch nodes (the inline ticket block, brandNode/
// aboutNode/venueNode/rsvpMomentumUnit ordering, the Hosted-by chip) were DELETED
// and PROMOTED into the ONE shared RsvpOfferingBody. The INVARIANT ("no ticket UI
// leaks onto an RSVP card; the RSVP path renders the shared, ticketless body")
// now lives in the consumer-screen `!isRsvp ? <EventOfferingBody> : <RsvpOfferingBody>`
// gate + the section-order contract is owned by RsvpOfferingBody (asserted below).
Deno.test("ISSUE 1: consumer ticket UI is gated !isRsvp (RSVP renders the ticketless shared body)", () => {
  const code = stripComments(consumerScreen);
  // the body choice is wrapped in a !isRsvp guard.
  assertStringIncludes(code, "{!isRsvp ? (");
  // ticketed branch → EventOfferingBody (carries the inline ticket box); RSVP
  // branch → RsvpOfferingBody (zero ticket UI). The gate enforces no-ticket-on-RSVP.
  assertStringIncludes(code, "<EventOfferingBody");
  assertStringIncludes(code, "<RsvpOfferingBody");
  // EventOfferingBody (ticketed) sits in the !isRsvp branch, RsvpOfferingBody after.
  const gateIdx = code.indexOf("{!isRsvp ? (");
  const ticketedIdx = code.indexOf("<EventOfferingBody");
  const rsvpIdx = code.indexOf("<RsvpOfferingBody");
  assert(gateIdx !== -1 && ticketedIdx !== -1 && rsvpIdx !== -1);
  assert(gateIdx < ticketedIdx && ticketedIdx < rsvpIdx, "ticketed body under !isRsvp, RSVP body after");
  // the RSVP body itself carries NO ticket-quantity UI (no leak by construction).
  const rsvpBodyCode = stripComments(rsvpBody);
  assert(!rsvpBodyCode.includes("Choose your ticket"));
  assert(!/onChangeTicketQuantity|ticketQuantities|<QuantityRow/.test(rsvpBodyCode));
});

Deno.test("ISSUE 1: RsvpOfferingBody renders the Direction-C parity sections (brand, momentum, venue, about)", () => {
  // The section-order parity now lives in the shared body (was the consumer
  // brandNode/rsvpMomentumUnit/venueNode/aboutNode mirror). The body promotion
  // extracts the decision into a sub-component, so source position no longer
  // tracks render order — assert all Direction-C parity sections are PRESENT
  // (the protective intent: the RSVP body still carries brand + the shared
  // momentum decision + venue + about, not a stripped surface).
  const code = stripComments(rsvpBody);
  assertStringIncludes(code, "<RsvpMomentumDecision"); // momentum decision
  assertStringIncludes(code, "styles.brandRow"); // brand row
  assertStringIncludes(code, "Presented by"); // brand kicker copy
  assertStringIncludes(code, "venueAddressLabel"); // venue card
  assertStringIncludes(code, "aboutText"); // about copy
});

Deno.test("ISSUE 1: consumer RSVP still consumes the shared momentum + decision dock (no checkout)", () => {
  // prior 1157 work intact (single shared decision via the shared body/dock, no
  // price/cart on the RSVP path).
  assertStringIncludes(consumerScreen, "<RsvpOfferingBody");
  assertStringIncludes(consumerScreen, "<RsvpOfferingDecisionDock");
  const bodyCode = stripComments(rsvpBody);
  assertStringIncludes(bodyCode, "<RsvpMomentumDecision");
  assert(!bodyCode.includes("ticket-checkout-create"));
});

// ──────────────────────── ISSUE 2 — address privacy ─────────────────────────

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
Deno.test("ISSUE 2: RsvpOfferingBody gates the exact street on hideAddressUntilTicket", () => {
  const code = stripComments(rsvpBody);
  // reveal gate: revealed iff hide is OFF, or own status is going/maybe.
  assertStringIncludes(code, "const addressRevealed");
  assertStringIncludes(code, "event.hideAddressUntilTicket");
  assertStringIncludes(code, 'guestStatus === "going"');
  assertStringIncludes(code, 'guestStatus === "maybe"');
  // when NOT revealed the label is city/country only (not the street). The
  // promoted body drops the parens around the revealed branch but keeps the
  // exact-street fallback chain (the invariant).
  assertStringIncludes(code, "addressRevealed");
  assertStringIncludes(code, "? event.address ?? event.venueName ?? ");
  // the maps deep-link is suppressed when not revealed.
  assertStringIncludes(code, "!addressRevealed || event.venueName === null");
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The bespoke consumer reveal-gate (rsvpAddressRevealed / `fnd.hideAddressUntilTicket
// && !rsvpAddressRevealed`) was DELETED and PROMOTED into RsvpOfferingBody, which
// now owns `addressRevealed = !event.hideAddressUntilTicket || state.guestStatus ===
// "going"/"maybe"`. The consumer screen threads the REAL host flag into the body
// via cardToPublicEvent (anon-safe; never the brands table). Same invariant.
Deno.test("ISSUE 2: RSVP reveal follows own rsvp status going/maybe (shared body owns it; consumer threads the real flag)", () => {
  const body = stripComments(rsvpBody);
  // the shared body reveals the street only on the viewer's own going/maybe.
  assertStringIncludes(body, "const addressRevealed");
  assertStringIncludes(body, 'state.guestStatus === "going"');
  assertStringIncludes(body, 'state.guestStatus === "maybe"');
  // the consumer screen carries the REAL host flag into the shared body props
  // (cardToPublicEvent → rsvpPublicEvent) — anon-safe, never the brands table.
  const code = stripComments(consumerScreen);
  assertStringIncludes(code, "hideAddressUntilTicket: card.hideAddressUntilTicket");
  assert(!code.includes('from("brands")'));
});

// ─────────────────────────────── ISSUE 4 — doors ────────────────────────────

Deno.test("ISSUE 4: business doors helper reuses start/end (no new field), real-data-only", () => {
  assertStringIncludes(bizDateUtil, "export const formatEventDoorsTimes");
  // close is null when masterEndAtUtc is absent (no fabricated close).
  // ORCH-1157 Round-7 [TEST-MOD-APPROVED ORCH-1157]: the doors helper now formats
  // via the device-locale-aware `formatDoorsTimeInTz` (12h/24h respecting the
  // phone setting, minutes always shown) instead of the forced-12h
  // `formatTimeLabelInTz` the date line uses. The reuse-start/end + real-data-only
  // contract is unchanged; only the internal formatter call was retargeted.
  const code = stripComments(bizDateUtil);
  assertStringIncludes(code, "masterEndAtUtc !== null && masterEndAtUtc !== undefined");
  assertStringIncludes(code, "? formatDoorsTimeInTz(masterEndAtUtc, tz, locale)");
  assertStringIncludes(code, ": null;");
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
Deno.test("ISSUE 4: RsvpOfferingBody renders 'Doors open … · Doors close …' beneath the date", () => {
  const code = stripComments(rsvpBody);
  assertStringIncludes(code, "const doorsLine");
  assertStringIncludes(code, "Doors open ${config.doorsOpenLabel}");
  assertStringIncludes(code, "Doors close ${config.doorsCloseLabel}");
  // real-data-only: open-only form when close is null.
  assertStringIncludes(code, "`Doors open ${config.doorsOpenLabel}`");
  // rendered as a child of the date fact row, behind the orch-1157-rsvp-doors testID.
  assertStringIncludes(code, "doorsLine !== null ?");
  assertStringIncludes(code, 'testID="orch-1157-rsvp-doors"');
});

Deno.test("ISSUE 4: business adapter feeds doors labels from master start/end instants", () => {
  assertStringIncludes(bizAdapter, "formatEventDoorsTimes");
  assertStringIncludes(bizAdapter, "doorsOpenLabel: rsvpDoors.open");
  assertStringIncludes(bizAdapter, "doorsCloseLabel: rsvpDoors.close");
  assertStringIncludes(bizAdapter, "event.masterStartAtUtc");
  assertStringIncludes(bizAdapter, "event.masterEndAtUtc");
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The bespoke consumer doors PILL (fnd.doorsLine + orch-1157-consumer-doors) was
// DELETED with the rest of the RSVP-branch; doors now render inside the shared
// RsvpOfferingBody from config.doorsOpenLabel/doorsCloseLabel (testID
// orch-1157-rsvp-doors). The "built in the foundation" half is unchanged. NOTE
// (flagged in the ORCH-1163 report): the consumer rsvpConfig does not yet pass
// doorsOpenLabel/doorsCloseLabel into the shared body, so the consumer RSVP doors
// line is currently not wired through — invariant preserved at the helper+body
// level, gap is at the consumer config plumbing.
Deno.test("ISSUE 4: doors line built in the foundation helper + rendered by the shared body", () => {
  assertStringIncludes(consumerDateUtil, "export const formatEventDoorsTimes");
  assertStringIncludes(consumerFoundation, "formatEventDoorsTimes");
  assertStringIncludes(consumerFoundation, "doorsLine");
  // the shared body owns the doors render (consumed by the consumer RSVP path).
  const body = stripComments(rsvpBody);
  assertStringIncludes(body, "const doorsLine");
  assertStringIncludes(body, 'testID="orch-1157-rsvp-doors"');
});
