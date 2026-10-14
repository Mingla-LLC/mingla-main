import assert from "node:assert/strict";
import test from "node:test";

import {
  explorerCheckoutContactFieldsForEditor,
  resolveExplorerCheckoutContact,
  validateExplorerCheckoutContact,
} from "../explorerCheckoutContact.mjs";

test("#3859 resolves current profile name, auth email, and normalized profile phone", () => {
  const result = resolveExplorerCheckoutContact({
    authUserId: "user-1",
    authEmail: " buyer@example.com ",
    profileId: "user-1",
    profileDisplayName: "  Ada Lovelace  ",
    profilePhone: "0803 123 4567",
    profileCountry: "ng",
  });

  assert.deepEqual(result.normalized, {
    name: "Ada Lovelace",
    email: "buyer@example.com",
    phone: "+2348031234567",
  });
  assert.equal(result.isValid, true);
  assert.deepEqual(result.provenance, {
    name: "current_profile",
    email: "current_auth",
    phone: "current_profile_normalized",
  });
});

test("#3859 never fabricates a name from email or falls back to profile email", () => {
  const result = resolveExplorerCheckoutContact({
    authUserId: "user-1",
    authEmail: "",
    profileId: "user-1",
    profileDisplayName: "  ",
    profilePhone: "+14155550123",
    profileCountry: "US",
  });

  assert.equal(result.normalized.name, "");
  assert.equal(result.normalized.email, "");
  assert.deepEqual(result.invalidFields, ["name", "email"]);
});

test("#3859 ignores a lagging profile from another authenticated account", () => {
  const result = resolveExplorerCheckoutContact({
    authUserId: "new-user",
    authEmail: "new@example.com",
    profileId: "old-user",
    profileDisplayName: "Old Account",
    profilePhone: "+14155550123",
    profileCountry: "US",
  });

  assert.deepEqual(result.normalized, {
    name: "",
    email: "new@example.com",
    phone: "",
  });
  assert.deepEqual(result.invalidFields, ["name", "phone"]);
  assert.equal(result.provenance.name, "missing");
  assert.equal(result.provenance.phone, "missing");
});

test("#3859 validates a booking-local correction without any profile writer", () => {
  const invalid = validateExplorerCheckoutContact({
    name: "A",
    email: "not-an-email",
    phone: "4155550123",
  });
  assert.deepEqual(invalid.invalidFields, ["name", "email", "phone"]);

  const corrected = validateExplorerCheckoutContact({
    name: "A Buyer",
    email: "booking@example.com",
    phone: "+14155550123",
  });
  assert.equal(corrected.isValid, true);
  assert.deepEqual(corrected.normalized, {
    name: "A Buyer",
    email: "booking@example.com",
    phone: "+14155550123",
  });
});

test("#3859 asks only for missing fields until the buyer explicitly chooses Change", () => {
  const validation = validateExplorerCheckoutContact({
    name: "Ada Lovelace",
    email: "",
    phone: "+14155550123",
  });

  assert.deepEqual(
    explorerCheckoutContactFieldsForEditor(validation, false),
    ["email"],
  );
  assert.deepEqual(
    explorerCheckoutContactFieldsForEditor(validation, true),
    ["name", "email", "phone"],
  );
});
