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
const rsvpBody = await Deno.readTextFile(
  new URL(
    "../../../mingla-business/src/components/event/RsvpPublicBody.tsx",
    import.meta.url,
  ),
);
const ticketedPreview = await Deno.readTextFile(
  new URL(
    "../../../mingla-business/src/components/event/FoundationEventPreview.tsx",
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

Deno.test("CONSUMER: caption is condition-aware and gated on addressHidden", () => {
  const code = stripComments(consumerScreen);
  // declared, derived from addressHidden (only computed when hidden, else null).
  assertStringIncludes(code, "const addressUnlockCaption");
  assertStringIncludes(code, "addressUnlockCaption: string | null = addressHidden");
  // RSVP copy + ticketed copy both present, picked by isRsvp.
  assertStringIncludes(code, "Full address shared once you're going");
  assertStringIncludes(code, "Full address shared after you get tickets");
});

Deno.test("CONSUMER: caption renders UNDER the venue line only when non-null", () => {
  const code = stripComments(consumerScreen);
  // rendered guarded by the null check (so it never paints when revealed).
  assertStringIncludes(code, "addressUnlockCaption !== null ?");
  assertStringIncludes(code, 'testID="orch-1157-consumer-address-unlock-caption"');
  // it sits AFTER the venue sub-line (the city line) in the venue card.
  const subIdx = code.indexOf("{venueAddressLabel}");
  const capIdx = code.indexOf('testID="orch-1157-consumer-address-unlock-caption"');
  assert(subIdx !== -1 && capIdx !== -1 && subIdx < capIdx, "caption renders under the city");
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

Deno.test("RSVP web: caption rendered in the Venue card under the city, gated non-null", () => {
  const code = stripComments(rsvpBody);
  // threaded into the Venue subcomponent + rendered guarded.
  assertStringIncludes(code, "addressUnlockCaption={addressUnlockCaption}");
  assertStringIncludes(code, "addressUnlockCaption: string | null;");
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

Deno.test("TICKETED web: caption rendered under the city, gated non-null", () => {
  const code = stripComments(ticketedPreview);
  assertStringIncludes(code, "addressUnlockCaption !== null ?");
  assertStringIncludes(code, 'testID="orch-1157-ticketed-address-unlock-caption"');
  // sits after the venueAddressLabel sub-line (now the City/Country line when hidden).
  const subIdx = code.indexOf("{venueAddressLabel}");
  const capIdx = code.indexOf('testID="orch-1157-ticketed-address-unlock-caption"');
  assert(subIdx !== -1 && capIdx !== -1 && subIdx < capIdx, "caption under the city");
});

// ───────────────────────── REVEALED state = NO caption ──────────────────────

Deno.test("REVEALED state shows NO caption (all surfaces): the variable nulls out", () => {
  // The render is `addressUnlockCaption !== null ? <Text/> : null` on every
  // surface; the variable is null whenever the street is revealed. Assert each
  // surface ties the caption to its hide gate (so revealing nulls it).
  const consumer = stripComments(consumerScreen);
  assertStringIncludes(consumer, "addressUnlockCaption: string | null = addressHidden");

  const rsvp = stripComments(rsvpBody);
  assertStringIncludes(rsvp, 'event.format === "online" || addressRevealed\n      ? null');

  const ticketed = stripComments(ticketedPreview);
  assertStringIncludes(
    ticketed,
    "event.hideAddressUntilTicket\n    ? \"Full address shared after you get tickets\"\n    : null;",
  );
});
