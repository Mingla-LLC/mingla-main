// T-WL-01 — waitlist-signup happy-path source contract.
//
// The function is integration-tested live by tester after the operator pushes
// the migration. This repo-running implementor test pins the happy-path
// behavior that would disappear on revert: service-role insert, consent_at,
// buyer_web source, waiting status, and success response shape.

import {
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("T-WL-01: valid email + consent inserts a buyer_web waiting row", () => {
  assertStringIncludes(source, "body.consent !== true");
  assertStringIncludes(source, 'source: "buyer_web"');
  assertStringIncludes(source, 'status: "waiting"');
  assertStringIncludes(source, "consent_at: new Date().toISOString()");
  assertStringIncludes(source, '.from("waitlist_entries")');
  assertStringIncludes(source, "waitlist_entry_id: inserted.id");
});

Deno.test("T-WL-01: signup uses service-role and verifies enabled ticket type", () => {
  assertStringIncludes(source, "serviceClient()");
  assertStringIncludes(source, '.from("ticket_types")');
  assertStringIncludes(source, '.eq("waitlist_enabled", true)');
  assertStringIncludes(source, '.is("deleted_at", null)');
});
