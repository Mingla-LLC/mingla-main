import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1857 Stay Edge exact guest envelope supports email-only and strict phone evidence", () => {
  assertStringIncludes(source, '["name", "email", "phone", "phoneCountryIso"]');
  assertStringIncludes(source, "STRICT_E164.test(guest.phone.trim())");
  assertStringIncludes(source, "COUNTRY_ISO.test(guest.phoneCountryIso)");
  assertStringIncludes(
    source,
    "if (guest.phoneCountryIso != null && guest.phone == null) return false",
  );
  assertStringIncludes(source, "return hasEmail || hasPhone");
});
