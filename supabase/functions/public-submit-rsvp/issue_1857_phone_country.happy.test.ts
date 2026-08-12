import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20270325001857_issue_1857_phone_country_authority.sql",
    import.meta.url,
  ),
);

Deno.test("#1857 RSVP Edge accepts only strict E.164 and carries ISO to RPC", () => {
  assertStringIncludes(source, "const PHONE_RE = /^\\+[1-9][0-9]{7,14}$/");
  assertStringIncludes(source, "const COUNTRY_ISO_RE = /^[A-Z]{2}$/");
  assertStringIncludes(
    source,
    "p_guest_phone_country_iso: guestPhoneCountryIso",
  );
  assertStringIncludes(source, "phoneCountryIso: gPhoneCountryIso");
  assertStringIncludes(source, 'case "P1901":');
  assertStringIncludes(
    source,
    'return json(410, { error: "rsvp_event_ended" })',
  );
  assertStringIncludes(source, 'case "P1902":');
  assertStringIncludes(
    source,
    'return json(409, { error: "rsvp_date_unavailable" })',
  );
  assertStringIncludes(migration, "ERRCODE = 'P1901'");
  assertStringIncludes(migration, "MESSAGE = 'rsvp_event_ended'");
  assertStringIncludes(migration, "ERRCODE = 'P1902'");
  assertStringIncludes(migration, "MESSAGE = 'rsvp_date_unavailable'");
  assert(!source.includes("`+${digits}`"));
});
