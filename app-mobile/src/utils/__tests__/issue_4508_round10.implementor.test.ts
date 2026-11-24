// @ts-nocheck -- a Deno suite (deno2-discovered); the app tsc has no Deno globals or URL imports.
// issue #4508 fix round 10.
//
//   P3  Success card pass chips: on an iPhone SE "Number ending 0141" was cut
//       to "Number ending 0…", so two number guests looked the same. The chip
//       shows "Guest · 0141" (or "Kofi · 0002"); the full label stays the
//       chip's accessibility label and the name under the QR.
//
// FAILS-ON-REVERT: the chip back on the full label -> R10-P3 fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { rsvpPassChipLabel, rsvpPassLabel } from "../../../../packages/offering-rendering/rsvpPassLabels.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(new URL(path, import.meta.url));

Deno.test("R10-P3: pass chips keep the digits that tell guests apart", () => {
  const invites = [
    { guestId: "g1", displayName: null, phoneLast4: "0141" },
    { guestId: "g2", displayName: null, phoneLast4: "0142" },
    { guestId: "g3", displayName: "Kofi Mensah", phoneLast4: "0002" },
    { guestId: "g4", displayName: "Rita Ray", phoneLast4: null },
  ];
  const chip = (id: string) => rsvpPassChipLabel({ entityType: "guest", entityId: id, displayName: "Andy's guest" }, invites);
  assertEquals(chip("g1"), "Guest · 0141");
  assertEquals(chip("g2"), "Guest · 0142");
  assertEquals(chip("g3"), "Kofi · 0002");
  assertEquals(chip("g4"), "Rita Ray");
  // Short enough for a chip on a small phone (the old label was 18 characters).
  for (const id of ["g1", "g2", "g3"]) assert(chip(id).length <= 13, chip(id));
  // The full label is unchanged for screen readers and the QR caption.
  assertEquals(rsvpPassLabel({ entityType: "guest", entityId: "g1", displayName: "x" }, invites), "Number ending 0141");
  const popup = read("../../../../packages/offering-rendering/RsvpSuccessPopup.tsx");
  assert(popup.includes(": rsvpPassChipLabel(credential, details.invites)}"), "the chip shows the short label");
  assert(/accessibilityLabel=\{\s*credential\.entityType === "primary"\s*\?\s*"You"\s*:\s*passLabel\(credential\)\s*\}/.test(popup), "the chip's accessibility label is the full one");
});
