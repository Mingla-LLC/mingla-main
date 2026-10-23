import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1857 reservation boundary rejects national input before every persistence path", () => {
  const validation = source.indexOf(
    "/^\\+[1-9][0-9]{7,14}$/.test(buyer.phone.trim())",
  );
  const sessionWrite = source.indexOf('.from("reservation_checkout_sessions")');
  const freeWriter = source.indexOf(
    "p_guest_phone_country_iso: buyerPhoneCountryIso",
  );

  assert(validation >= 0);
  assert(sessionWrite > validation);
  assert(freeWriter > validation);
  assert(!source.includes("buyer.country"));
  assert(!source.includes("venue.country"));
  assert(!source.includes("defaultCountry"));
});

Deno.test("#1857 session evidence remains provenance on all paid provider paths", () => {
  // [TEST-MOD-APPROVED #3872] The shared session writer now owns the column
  // mapping. Each paid arm must pass the validated evidence into that writer
  // before it can reach its provider, and the writer must persist the field.
  assertStringIncludes(
    source,
    "buyer_phone_country_iso: s.buyerPhoneCountryIso",
  );
  for (
    const [armMarker, providerCall] of [
      [
        'if (providerRouting.provider === "paystack")',
        "paystackInitializeTransaction(",
      ],
      ["// ── STRIPE ARM", "stripeTicketCheckout("],
    ] as const
  ) {
    const armStart = source.indexOf(armMarker);
    const providerIndex = source.indexOf(providerCall, armStart);
    assert(armStart >= 0 && providerIndex > armStart);
    const beforeProvider = source.slice(armStart, providerIndex);
    assertStringIncludes(
      beforeProvider,
      "insertReservationSession(supabase, {",
    );
    assertStringIncludes(
      beforeProvider,
      "buyerPhoneCountryIso: phoneEvidence.countryIso",
    );
  }
});
