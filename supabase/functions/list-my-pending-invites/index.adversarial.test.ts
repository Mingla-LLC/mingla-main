// ORCH-1111 — list-my-pending-invites ADVERSARIAL guards (tester-owned).
//
// The TESTER owns the runtime/seeded-row version of these (driving the real
// query path with seeded brand_invitations rows to prove that a wrong-email,
// expired, revoked, or declined invite is NOT returned). This implementor stub
// asserts the filtering SEAMS exist in source so the tester's seeded-row tests
// have something to bind to; reverting any filter removes the seam → fails.
//
// Tester: replace/extend with seeded-DB integration assertions per SPEC §9(b):
//   (i)   invite for a DIFFERENT email is NOT returned
//   (ii)  an expired and a revoked invite are NOT returned
//   (iii) a declined invite is NOT returned

import {
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.test("[seam] email match is server-side off the JWT (no email param)", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  // Match is keyed on the stored (lowercased) email derived from the JWT.
  assertStringIncludes(source, '.eq("email", email)');
});

Deno.test("[seam] status=pending AND non-expired filter present", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  // A revoked / accepted / declined / expired invite is excluded by these two
  // filters (status must be pending AND expires_at must be in the future).
  assertStringIncludes(source, '.eq("status", "pending")');
  assertStringIncludes(source, '.gt("expires_at", nowIso)');
});
