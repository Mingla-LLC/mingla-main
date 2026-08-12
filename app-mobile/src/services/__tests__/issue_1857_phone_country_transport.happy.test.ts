import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const rsvp = await Deno.readTextFile(
  new URL("../rsvpDeckService.ts", import.meta.url),
);
const reserve = await Deno.readTextFile(
  new URL("../venueReservationService.ts", import.meta.url),
);
const sheet = await Deno.readTextFile(
  new URL(
    "../../components/expandedCard/VenueReserveSheet.tsx",
    import.meta.url,
  ),
);
const stay = await Deno.readTextFile(
  new URL("../stayGuestService.ts", import.meta.url),
);

Deno.test("#1857 Consumer transports RSVP and reservation country evidence", () => {
  assertStringIncludes(rsvp, "guestPhoneCountryIso: primary?.phoneCountryIso");
  assertStringIncludes(rsvp, "guests: guests ?? []");
  assertStringIncludes(reserve, "phoneCountryIso?: string | null");
  assertStringIncludes(reserve, "phoneCountryIso: input.buyer.phoneCountryIso");
  assertStringIncludes(
    sheet,
    "phoneCountryIso: needsPhone ? countryCode : null",
  );
  assert(
    !sheet.includes(
      "phoneCountryIso: needsPhone ? countryCode : getDefaultCountryCode",
    ),
  );
});

Deno.test("#1857 Consumer Stay passes the shared guest object without dropping ISO", () => {
  assertStringIncludes(stay, "guest,");
});
