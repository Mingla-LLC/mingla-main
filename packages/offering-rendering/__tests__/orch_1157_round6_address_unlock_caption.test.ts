// ORCH-1157 [rsvp-public-redesign] Round-6 — hidden-address UNLOCK CAPTION
// (implementor-owned happy-path regression). Deno source-contract style (these
// files import RN-bound modules; we read the source as TEXT and assert the locked
// contract — the same pattern as the Round-2 suite).
//
// Seth, device-confirmed: in the "Where you'll be" section, when the exact street
// is HIDDEN (hideAddressUntilTicket ON and the viewer has not unlocked it), show a
// short caption UNDER the city explaining HOW to unlock the full address. It is
// CONDITION-AWARE and must render ONLY while hidden:
//   - TICKETED (hidden until purchase): "Full address shared after you get tickets"
//   - RSVP     (hidden until going/maybe): "Full address shared once you're going"
// It must NOT render when the address is revealed (flag off, or viewer purchased /
// going / maybe).
//
// Three surfaces (parity):
//   1. CONSUMER  — app-mobile ConsumerEventDetailScreen ("Where you'll be"; RSVP +
//      ticketed branches share one `addressUnlockCaption`, copy keyed on isRsvp).
//   2. WEB/BUSINESS RSVP — RsvpPublicBody (RSVP copy, gated on !addressRevealed).
//   3. WEB/BUSINESS TICKETED — FoundationEventPreview (ticketed copy, gated on
//      hideAddressUntilTicket).
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - delete the `addressUnlockCaption` gate/render on any surface → its asserts fail.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const consumerScreen = await Deno.readTextFile(
  new URL(
    "../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    import.meta.url,
  ),
);
// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
const rsvpBody = await Deno.readTextFile(
  new URL(
    "../RsvpOfferingBody.tsx",
    import.meta.url,
  ),
);
// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The ticketed address-unlock caption was likewise promoted out of
// FoundationEventPreview into the ONE shared EventOfferingBody (testID
// orch-1167-address-unlock-caption) — same surface, same gate. Repoint the read.
const ticketedPreview = await Deno.readTextFile(
  new URL(
    "../EventOfferingBody.tsx",
    import.meta.url,
  ),
);

// Strip comments so a doc-string can't satisfy an assertion.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

// ───────────────────────── CONSUMER (app-mobile) ────────────────────────────

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The bespoke consumer addressUnlockCaption (a screen-local string keyed on isRsvp,
// testID orch-1157-consumer-address-unlock-caption) was DELETED and PROMOTED into
// the SAME two shared bodies the consumer now mounts: the RSVP caption ("…once
// you're going") into RsvpOfferingBody, the ticketed caption ("…after you get
// tickets") into EventOfferingBody. The consumer surface therefore still shows the
// condition-aware caption — via the shared bodies, not a screen-local variable.
Deno.test("CONSUMER: caption is condition-aware (RSVP + ticketed copy live in the shared bodies the consumer mounts)", () => {
  // the consumer screen mounts BOTH shared bodies (ticketed vs RSVP), each owning
  // its own gated caption.
  const screen = stripComments(consumerScreen);
  assertStringIncludes(screen, "<RsvpOfferingBody");
  assertStringIncludes(screen, "<EventOfferingBody");
  // RSVP copy lives in RsvpOfferingBody; ticketed copy in EventOfferingBody.
  assertStringIncludes(stripComments(rsvpBody), "Full address shared once you're going");
  assertStringIncludes(stripComments(ticketedPreview), "Full address shared after you get tickets");
});

Deno.test("CONSUMER: caption renders UNDER the venue line only when non-null (in the shared bodies)", () => {
  // RSVP body: gated null-check + correct testID, under the city.
  const rsvp = stripComments(rsvpBody);
  assertStringIncludes(rsvp, "addressUnlockCaption !== null ?");
  assertStringIncludes(rsvp, 'testID="orch-1157-rsvp-address-unlock-caption"');
  const rSubIdx = rsvp.indexOf("? venueAddressLabel");
  const rCapIdx = rsvp.indexOf('testID="orch-1157-rsvp-address-unlock-caption"');
  assert(rSubIdx !== -1 && rCapIdx !== -1 && rSubIdx < rCapIdx, "RSVP caption under the city");
  // ticketed body: gated null-check + correct testID, under the city.
  const ticketed = stripComments(ticketedPreview);
  assertStringIncludes(ticketed, "addressUnlockCaption !== null ?");
  assertStringIncludes(ticketed, 'testID="orch-1167-address-unlock-caption"');
  const tSubIdx = ticketed.indexOf("{venueAddressLabel}");
  const tCapIdx = ticketed.indexOf('testID="orch-1167-address-unlock-caption"');
  assert(tSubIdx !== -1 && tCapIdx !== -1 && tSubIdx < tCapIdx, "ticketed caption under the city");
});

// ───────────────────────── WEB/BUSINESS RSVP ────────────────────────────────

Deno.test("RSVP web: caption is RSVP copy, null when revealed or online", () => {
  const code = stripComments(rsvpBody);
  assertStringIncludes(code, "const addressUnlockCaption");
  // gated null when revealed (going/maybe/hide-off) or online.
  assertStringIncludes(code, 'event.format === "online" || addressRevealed');
  assertStringIncludes(code, "Full address shared once you're going");
  // RSVP page must NOT use ticketed wording for the caption.
  assert(
    !code.includes("Full address shared after you get tickets"),
    "RSVP caption must never say 'tickets'",
  );
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The promoted body renders the venue card INLINE (no separate Venue subcomponent),
// so the caption is a local `const addressUnlockCaption: string | null` rendered
// directly under the city label — the threaded-prop form is gone, but the
// rendered-under-the-city, gated-non-null, RSVP-copy, correct-testID INVARIANT holds.
Deno.test("RSVP web: caption rendered in the Venue card under the city, gated non-null", () => {
  const code = stripComments(rsvpBody);
  // declared as a local string|null (the promoted body renders the venue inline).
  assertStringIncludes(code, "const addressUnlockCaption: string | null");
  assertStringIncludes(code, "addressUnlockCaption !== null ?");
  assertStringIncludes(code, 'testID="orch-1157-rsvp-address-unlock-caption"');
  // it follows the gated city/address label inside the Venue text column.
  const labelIdx = code.indexOf("? venueAddressLabel");
  const capIdx = code.indexOf('testID="orch-1157-rsvp-address-unlock-caption"');
  assert(labelIdx !== -1 && capIdx !== -1 && labelIdx < capIdx, "caption under the city");
});

// ───────────────────────── WEB/BUSINESS TICKETED ────────────────────────────

Deno.test("TICKETED web: caption is ticketed copy, gated on hideAddressUntilTicket", () => {
  const code = stripComments(ticketedPreview);
  assertStringIncludes(code, "const addressUnlockCaption");
  assertStringIncludes(
    code,
    "addressUnlockCaption: string | null = event.hideAddressUntilTicket",
  );
  assertStringIncludes(code, "Full address shared after you get tickets");
  // a ticketed page must NEVER show the RSVP wording.
  assert(
    !code.includes("Full address shared once you're going"),
    "ticketed caption must never say 'RSVP'/'going'",
  );
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// Ticketed caption testID is orch-1167-address-unlock-caption in the shared body.
Deno.test("TICKETED web: caption rendered under the city, gated non-null", () => {
  const code = stripComments(ticketedPreview);
  assertStringIncludes(code, "addressUnlockCaption !== null ?");
  assertStringIncludes(code, 'testID="orch-1167-address-unlock-caption"');
  // sits after the venueAddressLabel sub-line (now the City/Country line when hidden).
  const subIdx = code.indexOf("{venueAddressLabel}");
  const capIdx = code.indexOf('testID="orch-1167-address-unlock-caption"');
  assert(subIdx !== -1 && capIdx !== -1 && subIdx < capIdx, "caption under the city");
});

// ───────────────────────── REVEALED state = NO caption ──────────────────────

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The consumer screen-local caption-nulling moved into the two shared bodies the
// consumer mounts; assert each shared body ties the caption to its hide gate.
Deno.test("REVEALED state shows NO caption (all surfaces): the variable nulls out", () => {
  // The render is `addressUnlockCaption !== null ? <Text/> : null` on every
  // surface; the variable is null whenever the street is revealed. Assert each
  // SHARED body ties the caption to its hide gate (so revealing nulls it). The
  // consumer mounts both bodies, so its caption nulls out through them.
  const rsvp = stripComments(rsvpBody);
  assertStringIncludes(rsvp, 'event.format === "online" || addressRevealed\n      ? null');

  const ticketed = stripComments(ticketedPreview);
  assertStringIncludes(
    ticketed,
    "event.hideAddressUntilTicket\n    ? \"Full address shared after you get tickets\"\n    : null;",
  );
});
