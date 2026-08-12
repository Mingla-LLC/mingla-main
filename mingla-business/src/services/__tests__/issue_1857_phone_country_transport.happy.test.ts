import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const rsvp = await Deno.readTextFile(
  new URL("../rsvpEvents.ts", import.meta.url),
);
const reserve = await Deno.readTextFile(
  new URL("../venueGuestReservationService.ts", import.meta.url),
);
const stay = await Deno.readTextFile(
  new URL("../stayGuestService.ts", import.meta.url),
);

Deno.test("#1857 Buyer services preserve selected ISO on every changed envelope", () => {
  assertStringIncludes(rsvp, "guestPhoneCountryIso?: string | null");
  assertStringIncludes(
    rsvp,
    "guestPhoneCountryIso: input.guestPhoneCountryIso",
  );
  assertStringIncludes(reserve, "phoneCountryIso?: string | null");
  assertStringIncludes(stay, "guest,");
});
