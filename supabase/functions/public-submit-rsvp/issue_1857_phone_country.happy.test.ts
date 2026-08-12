import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1857 RSVP Edge accepts only strict E.164 and carries ISO to RPC", () => {
  assertStringIncludes(source, "const PHONE_RE = /^\\+[1-9][0-9]{7,14}$/");
  assertStringIncludes(source, "const COUNTRY_ISO_RE = /^[A-Z]{2}$/");
  assertStringIncludes(
    source,
    "p_guest_phone_country_iso: guestPhoneCountryIso",
  );
  assertStringIncludes(source, "phoneCountryIso: gPhoneCountryIso");
  assert(!source.includes("`+${digits}`"));
});
