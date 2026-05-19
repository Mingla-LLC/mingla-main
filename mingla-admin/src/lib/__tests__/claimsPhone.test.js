import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPhoneHref, resolveClaimDisplayPhone } from "../claimsPhone.js";

describe("resolveClaimDisplayPhone", () => {
  it("uses pool national_phone_number when place_pool_id set", () => {
    const r = resolveClaimDisplayPhone({
      place_pool_id: "p1",
      contact_phone: "+1 555 0000",
      place_pool: { national_phone_number: "+1 212 555 0100" },
    });
    assert.equal(r.phone, "+1 212 555 0100");
    assert.equal(r.source, "pool");
    assert.equal(r.note, null);
  });

  it("off-pool uses operator phone with Maps note", () => {
    const r = resolveClaimDisplayPhone({
      place_pool_id: null,
      contact_phone: "+1 555 9999",
      place_pool: null,
    });
    assert.equal(r.phone, "+1 555 9999");
    assert.equal(r.source, "operator");
    assert.equal(r.note, "Verify via Google Maps lookup");
  });

  it("formatPhoneHref strips formatting", () => {
    assert.equal(formatPhoneHref("+1 (212) 555-0100"), "tel:+12125550100");
  });
});
