import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1857 reservation boundary rejects national input before every persistence path", () => {
  const validation = source.indexOf(
    "/^\\+[1-9][0-9]{7,14}$/.test(buyer.phone.trim())",
  );
  const sessionWrite = source.indexOf(".from(\"reservation_checkout_sessions\")");
  const freeWriter = source.indexOf("p_guest_phone_country_iso: buyerPhoneCountryIso");

  assert(validation >= 0);
  assert(sessionWrite > validation);
  assert(freeWriter > validation);
  assert(!source.includes("buyer.country"));
  assert(!source.includes("venue.country"));
  assert(!source.includes("defaultCountry"));
});

Deno.test("#1857 session evidence remains provenance on all paid provider paths", () => {
  assertStringIncludes(source, "buyer_phone_country_iso: buyerPhoneCountryIso");
  const evidenceWrite = source.indexOf(
    "buyer_phone_country_iso: buyerPhoneCountryIso",
  );
  for (const providerCall of [
    "stripeTicketCheckout(",
    "paystackInitializeTransaction(",
  ]) {
    const providerIndex = source.indexOf(providerCall);
    assert(providerIndex >= 0);
    assert(evidenceWrite >= 0 && evidenceWrite < providerIndex);
  }
});
