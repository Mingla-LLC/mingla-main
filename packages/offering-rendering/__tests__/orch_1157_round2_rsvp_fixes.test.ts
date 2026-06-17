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

const rsvpBody = await Deno.readTextFile(
  new URL(
    "../../../mingla-business/src/components/event/RsvpPublicBody.tsx",
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

Deno.test("ISSUE 1: consumer ticket block is gated !isRsvp (no 'Choose your ticket' on RSVP)", () => {
  const code = stripComments(consumerScreen);
  // the ticket radiogroup section is wrapped in a !isRsvp guard.
  assertStringIncludes(code, "{!isRsvp ? (");
  // the leak phrasing still exists in code (for ticketed) but only under the gate.
  assertStringIncludes(code, "Choose your ticket");
  assertStringIncludes(code, "No tickets available yet.");
  // it is reachable ONLY via the !isRsvp branch — assert the gate sits immediately
  // before the ticket section title (no ungated "Choose your ticket" render).
  const gateIdx = code.indexOf("{!isRsvp ? (");
  const titleIdx = code.indexOf("Choose your ticket");
  assert(gateIdx !== -1 && titleIdx !== -1 && gateIdx < titleIdx);
});

Deno.test("ISSUE 1: consumer RSVP body renders Direction-C sections in RsvpPublicBody order", () => {
  const code = stripComments(consumerScreen);
  // the parity nodes exist (brand / about / venue extracted for ordering).
  assertStringIncludes(code, "const brandNode");
  assertStringIncludes(code, "const aboutNode");
  assertStringIncludes(code, "const venueNode");
  // RSVP branch order: brand → momentum → venue → about (mirrors RsvpPublicBody).
  const rsvpBranch = code.slice(code.indexOf("isRsvp ? (\n"));
  const brandPos = rsvpBranch.indexOf("{brandNode}");
  const momPos = rsvpBranch.indexOf("{rsvpMomentumUnit}");
  const venuePos = rsvpBranch.indexOf("{venueNode}");
  const aboutPos = rsvpBranch.indexOf("{aboutNode}");
  assert(brandPos !== -1 && momPos !== -1 && venuePos !== -1 && aboutPos !== -1);
  assert(brandPos < momPos, "brand before momentum");
  assert(momPos < venuePos, "momentum before venue");
  assert(venuePos < aboutPos, "venue before about");
  // RSVP host chip reads "Hosted by" (parity with RsvpPublicBody host row).
  assertStringIncludes(code, '{isRsvp ? "Hosted by" : "Presented by"}');
});

Deno.test("ISSUE 1: consumer RSVP still consumes the shared momentum + decision dock", () => {
  // prior 1157 work intact (single decision row, no price/cart).
  assertStringIncludes(consumerScreen, "<RsvpMomentumDecision");
  const code = stripComments(consumerScreen);
  assert(!code.includes("ticket-checkout-create"));
});

// ──────────────────────── ISSUE 2 — address privacy ─────────────────────────

Deno.test("ISSUE 2: RsvpPublicBody gates the exact street on hideAddressUntilTicket", () => {
  const code = stripComments(rsvpBody);
  // reveal gate: revealed iff hide is OFF, or own status is going/maybe.
  assertStringIncludes(code, "const addressRevealed");
  assertStringIncludes(code, "event.hideAddressUntilTicket");
  assertStringIncludes(code, 'guestStatus === "going"');
  assertStringIncludes(code, 'guestStatus === "maybe"');
  // when NOT revealed the label is city/country only (not the street).
  assertStringIncludes(code, "addressRevealed");
  assertStringIncludes(code, "? (event.address ?? event.venueName ?? ");
  // the maps deep-link is suppressed when not revealed.
  assertStringIncludes(code, "!addressRevealed || event.venueName === null");
});

Deno.test("ISSUE 2: consumer RSVP reveal follows own rsvp status going/maybe", () => {
  const code = stripComments(consumerScreen);
  assertStringIncludes(code, "const rsvpAddressRevealed");
  assertStringIncludes(code, 'rsvpStatus === "going" || rsvpStatus === "maybe"');
  // the consumer gate combines the hide flag with the RSVP reveal for isRsvp.
  assertStringIncludes(code, "fnd.hideAddressUntilTicket && !rsvpAddressRevealed");
  // anon-safe flag source — never the brands table.
  assert(!code.includes('from("brands")'));
});

// ─────────────────────────────── ISSUE 4 — doors ────────────────────────────

Deno.test("ISSUE 4: business doors helper reuses start/end (no new field), real-data-only", () => {
  assertStringIncludes(bizDateUtil, "export const formatEventDoorsTimes");
  // close is null when masterEndAtUtc is absent (no fabricated close).
  const code = stripComments(bizDateUtil);
  assertStringIncludes(code, "masterEndAtUtc !== null && masterEndAtUtc !== undefined");
  assertStringIncludes(code, "? formatTimeLabelInTz(masterEndAtUtc, tz)");
  assertStringIncludes(code, ": null;");
});

Deno.test("ISSUE 4: RsvpPublicBody renders 'Doors open … · Doors close …' beneath the date", () => {
  const code = stripComments(rsvpBody);
  assertStringIncludes(code, "const doorsLine");
  assertStringIncludes(code, "Doors open ${config.doorsOpenLabel}");
  assertStringIncludes(code, "Doors close ${config.doorsCloseLabel}");
  // real-data-only: open-only form when close is null.
  assertStringIncludes(code, "`Doors open ${config.doorsOpenLabel}`");
  // rendered as a child of the date fact row.
  assertStringIncludes(code, "doorsLine !== null ?");
});

Deno.test("ISSUE 4: business adapter feeds doors labels from master start/end instants", () => {
  assertStringIncludes(bizAdapter, "formatEventDoorsTimes");
  assertStringIncludes(bizAdapter, "doorsOpenLabel: rsvpDoors.open");
  assertStringIncludes(bizAdapter, "doorsCloseLabel: rsvpDoors.close");
  assertStringIncludes(bizAdapter, "event.masterStartAtUtc");
  assertStringIncludes(bizAdapter, "event.masterEndAtUtc");
});

Deno.test("ISSUE 4: consumer doors line built in the foundation + rendered in the body", () => {
  assertStringIncludes(consumerDateUtil, "export const formatEventDoorsTimes");
  assertStringIncludes(consumerFoundation, "formatEventDoorsTimes");
  assertStringIncludes(consumerFoundation, "doorsLine");
  assertStringIncludes(consumerScreen, "fnd.doorsLine !== null");
  assertStringIncludes(consumerScreen, 'testID="orch-1157-consumer-doors"');
});
