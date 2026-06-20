// ORCH-1157 [rsvp-public-redesign] Round-7 [doors pill + locale-aware time] —
// implementor-owned happy-path regression.
//
// Seth (device-confirmed) saw the doors line render as bare-hour plain text
// "Doors open 13 · Doors close 04" — no minutes, no AM/PM, no pill. Round-7:
//   (1) the doors TIME is now device-locale-aware via `formatEventDoorsTimes`:
//       device 12h → "1:00 PM" (minutes + AM/PM); device 24h → "13:00"
//       (zero-padded HH:MM). Always carries minutes. Real-data-only (null end →
//       open only; invalid start → null).
//   (2) the doors line renders in a PILL styled like the date chip on both RSVP
//       surfaces (consumer screen + business/web RsvpPublicBody).
//
// The consumer `eventDateDisplay.ts` is pure (zero imports) so we EXECUTE it with
// pinned-locale clocks (en-US → 12h, sv-SE → 24h). The business formatter shares
// the byte-identical helper but pulls RN-bound siblings (recurrenceRule) that
// Deno can't import, so it is asserted via source-contract that it carries the
// SAME locale mechanism. The two pill renders are asserted via source-contract.
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - revert `formatDoorsTimeInTz` to the en-GB ":00"-stripping path → the 24h
//     "02:00" / 12h "6:00 PM" minute+clock assertions fail.
//   - delete the consumer doors PILL (metaChip) render → the pill assert fails.
//   - delete the business doors PILL (factRow) render → the pill assert fails.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { formatEventDoorsTimes } from "../../../app-mobile/src/utils/eventDateDisplay.ts";

// ── (1) BEHAVIORAL: locale-aware time, real execution of the consumer formatter ──

// 18:00–02:00(+1) UTC in tz UTC.
const fields = {
  masterDateUtc: "2026-06-20T18:00:00Z",
  masterEndAtUtc: "2026-06-21T02:00:00Z",
  timezone: "UTC",
};

Deno.test("Round-7: device 12h clock → minutes + AM/PM (no bare hour)", () => {
  const { open, close } = formatEventDoorsTimes(fields, "en-US");
  assertEquals(open, "6:00 PM");
  assertEquals(close, "2:00 AM");
  // The bug was a bare hour with no minutes / no meridiem — must NOT recur.
  assert(/:\d{2}/.test(open ?? ""), "open must carry minutes");
  assertStringIncludes(open ?? "", "PM");
});

Deno.test("Round-7: device 24h clock → zero-padded HH:MM (no AM/PM)", () => {
  const { open, close } = formatEventDoorsTimes(fields, "sv-SE");
  assertEquals(open, "18:00");
  assertEquals(close, "02:00"); // zero-padded — was the bare "04"/"4:00" bug
  assert(!/[AP]M/.test(open ?? ""), "24h must not carry AM/PM");
  assert(!/[AP]M/.test(close ?? ""), "24h must not carry AM/PM");
});

Deno.test("Round-7: respects the event timezone (not the runtime tz)", () => {
  // 18:00 UTC is 14:00 in America/New_York (EDT, -4).
  const { open } = formatEventDoorsTimes(
    { ...fields, timezone: "America/New_York" },
    "en-US",
  );
  assertEquals(open, "2:00 PM");
});

Deno.test("Round-7: real-data-only — null end → open only, no fabricated close", () => {
  const { open, close } = formatEventDoorsTimes(
    { masterDateUtc: "2026-06-20T13:30:00Z", masterEndAtUtc: null, timezone: "UTC" },
    "en-US",
  );
  assertEquals(open, "1:30 PM");
  assertEquals(close, null);
});

Deno.test("Round-7: invalid start instant → both null (never fabricates)", () => {
  const { open, close } = formatEventDoorsTimes(
    { masterDateUtc: "not-a-date", masterEndAtUtc: null, timezone: "UTC" },
    "en-US",
  );
  assertEquals(open, null);
  assertEquals(close, null);
});

// ── (2) SOURCE-CONTRACT: business formatter shares the locale mechanism ──

const bizDateUtil = await Deno.readTextFile(
  new URL(
    "../../../mingla-business/src/utils/eventDateDisplay.ts",
    import.meta.url,
  ),
);

Deno.test("Round-7: business formatEventDoorsTimes uses the device-locale mechanism", () => {
  assertStringIncludes(bizDateUtil, "const formatDoorsTimeInTz");
  // device 12h/24h detection + the conditional hour width that yields padded 24h.
  assertStringIncludes(bizDateUtil, "resolvedOptions().hour12 === false");
  assertStringIncludes(bizDateUtil, 'is24h ? "2-digit" : "numeric"');
  assertStringIncludes(bizDateUtil, "toLocaleTimeString(locale");
});

// ── (3) SOURCE-CONTRACT: the doors PILL render on both RSVP surfaces ──

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const consumerScreen = stripComments(
  await Deno.readTextFile(
    new URL(
      "../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
      import.meta.url,
    ),
  ),
);
// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
const rsvpBody = stripComments(
  await Deno.readTextFile(
    new URL(
      "../RsvpOfferingBody.tsx",
      import.meta.url,
    ),
  ),
);

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The bespoke consumer doors PILL (doorsChipRow / metaChip / orch-1157-consumer-doors)
// was DELETED with the rest of the RSVP-branch; the consumer now mounts the shared
// RsvpOfferingBody which owns the doors render (testID orch-1157-rsvp-doors), fed
// via config.doorsOpenLabel. Assert the consumer mounts that body (the doors-pill
// invariant moved into the shared body, asserted in the business/web test below).
Deno.test("Round-7: consumer mounts the shared RsvpOfferingBody that owns the doors render", () => {
  assertStringIncludes(consumerScreen, "<RsvpOfferingBody");
  assertStringIncludes(rsvpBody, 'testID="orch-1157-rsvp-doors"');
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The promoted body renders the doors line in the date-fact column (styles.dateSubline)
// rather than the old factRow/metaChip pill — a presentation change from the body
// promotion. The INVARIANT (doors render gated on doorsLine !== null behind the
// orch-1157-rsvp-doors testID, sourced from config.doorsOpenLabel/doorsCloseLabel)
// is preserved; the factRow-pill styling assertion is retargeted to the new render.
Deno.test("Round-7: business/web doors renders beneath the date, gated, behind the orch-1157-rsvp-doors testID", () => {
  assertStringIncludes(rsvpBody, 'testID="orch-1157-rsvp-doors"');
  assertStringIncludes(rsvpBody, "doorsLine !== null ?");
  assertStringIncludes(rsvpBody, "Doors open ${config.doorsOpenLabel}");
});
