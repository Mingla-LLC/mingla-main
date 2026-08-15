import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const page = fs.readFileSync(path.join(root, "mingla-admin/src/pages/ClaimsPage.jsx"), "utf8");
const service = fs.readFileSync(path.join(root, "mingla-admin/src/services/adminClaimsService.js"), "utf8");

test("#2099 Admin uses shared sealed correction RPC with honest states", () => {
  for (const token of [
    "Correct venue identity",
    "Check eligibility",
    "Correct pending venue",
    'aria-live="polite"',
    "Your entries are preserved; retry when you're online.",
    "STALE_VERSION",
    'stay: "Stay"',
  ]) assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(service, /preview_pending_venue_identity_correction/);
  assert.match(service, /correct_pending_venue_identity/);
  assert.match(service, /p_expected_schema_fingerprint: preview\.schema_fingerprint/);
  assert.match(service, /p_expected_state_fingerprint: preview\.state_fingerprint/);
  assert.match(service, /updated_at/);
});
