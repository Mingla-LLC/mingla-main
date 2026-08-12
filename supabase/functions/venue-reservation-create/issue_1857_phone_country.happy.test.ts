import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1857 reservation Edge never infers country and persists ISO before provider IO", () => {
  assertStringIncludes(
    source,
    "/^\\+[1-9][0-9]{7,14}$/.test(buyer.phone.trim())",
  );
  assertStringIncludes(source, "buyer_phone_country_iso: buyerPhoneCountryIso");
  assertStringIncludes(
    source,
    "p_guest_phone_country_iso: buyerPhoneCountryIso",
  );
  assert(!source.includes("normalizePhoneE164"));
  const firstSessionWrite = source.indexOf(
    "buyer_phone_country_iso: buyerPhoneCountryIso",
  );
  const firstProviderCall = Math.min(...[
    source.indexOf("stripeTicketCheckout("),
    source.indexOf("paystackInitializeTransaction("),
  ].filter((index) => index >= 0));
  assert(firstSessionWrite >= 0 && firstSessionWrite < firstProviderCall);
});
