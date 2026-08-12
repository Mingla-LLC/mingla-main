import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const body = await Deno.readTextFile(
  new URL("../StayGuestBooking.tsx", import.meta.url),
);
const contract = await Deno.readTextFile(
  new URL("../stayGuest.ts", import.meta.url),
);

Deno.test("#1857 Stay keeps phone optional but preserves explicit country with a valid phone", () => {
  assertStringIncludes(contract, "phoneCountryIso?: string | null");
  assertStringIncludes(body, "useState<string | null>(null)");
  assertStringIncludes(body, 'label: "Phone (optional if email is provided)"');
  assertStringIncludes(
    body,
    "...(cleanPhone && phoneCountryIso ? { phoneCountryIso } : {})",
  );
  assertStringIncludes(
    body,
    'setValidationError("Select a country and enter a valid phone number.")',
  );
  assert(
    body.indexOf("phoneRawValue.trim().length > 0") <
      body.indexOf("void onSubmit"),
  );
});

Deno.test("#1857 Stay email-only payload omits both phone and ISO", () => {
  assertStringIncludes(body, "...(cleanPhone ? { phone: cleanPhone } : {})");
  assertStringIncludes(
    body,
    "...(cleanPhone && phoneCountryIso ? { phoneCountryIso } : {})",
  );
});
