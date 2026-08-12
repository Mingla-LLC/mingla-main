import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const body = await Deno.readTextFile(
  new URL("../RsvpOfferingBody.tsx", import.meta.url),
);

Deno.test("#1857 RSVP owns independent neutral country state for primary and plus-ones", () => {
  assertStringIncludes(body, "defaultPhoneCountry ?? null");
  assertStringIncludes(body, "phoneCountryIso: null");
  assertStringIncludes(body, "key={g.id}");
  assertStringIncludes(body, "row.id === g.id");
  assertStringIncludes(body, "label: `Guest ${i + 1} phone`");
  assertStringIncludes(
    body,
    "emptyRequired: showValidationErrors && g.rawPhone.trim().length === 0",
  );
  assertStringIncludes(body, "phoneCountryIso: g.phoneCountryIso");
  assert(!body.includes('defaultPhoneCountry ?? "US"'));
});

Deno.test("#1857 RSVP disables all mutable plus-one controls while submitting", () => {
  assertStringIncludes(body, "disabled: submitting");
  assertStringIncludes(
    body,
    "disabled={submitting || guests.length >= config.plusOnesMax}",
  );
  assertStringIncludes(body, "disabled={submitting || guests.length <= 0}");
});
