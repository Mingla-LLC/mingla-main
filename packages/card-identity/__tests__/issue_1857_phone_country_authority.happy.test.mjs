import assert from "node:assert/strict";
import test from "node:test";
import phone from "../phone.js";

const { resolveUserPhoneE164 } = phone;

test("#1857 resolves national numbers only with explicit handset country", () => {
  assert.equal(resolveUserPhoneE164("0803 482 1689", "NG"), "+2348034821689");
  assert.equal(resolveUserPhoneE164("01279 942348", "GB"), "+441279942348");
  assert.equal(resolveUserPhoneE164("(919) 419-9222", "US"), "+19194199222");
  assert.equal(resolveUserPhoneE164("0803 482 1689", null), null);
  assert.equal(resolveUserPhoneE164("0803 482 1689", "US"), null);
});

test("#1857 preserves strict E.164 exactly regardless of country metadata", () => {
  for (const value of ["+2348034821689", "+441279942348", "+19194199222"]) {
    assert.equal(resolveUserPhoneE164(value, null), value);
    assert.equal(resolveUserPhoneE164(value, "GB"), value);
  }
  assert.equal(resolveUserPhoneE164("+012345678", "NG"), null);
  assert.equal(resolveUserPhoneE164("name@example.com", "US"), null);
  assert.equal(resolveUserPhoneE164("9194199222", "us"), null);
  assert.equal(resolveUserPhoneE164("9194199222", "USA"), null);
});
