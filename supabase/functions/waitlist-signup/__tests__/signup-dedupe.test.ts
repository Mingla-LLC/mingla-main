// T-WL-02 — waitlist-signup dedupe source contract.

import {
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("T-WL-02: duplicate contact maps unique violation to 409 already_waiting", () => {
  assertStringIncludes(source, 'insertError?.code === "23505"');
  assertStringIncludes(source, 'error: "already_waiting"');
  assertStringIncludes(source, "409");
  assertStringIncludes(
    source,
    'waitlist_entry_id: typeof existingId === "string" ? existingId : null',
  );
});

Deno.test("T-WL-02: dedupe lookup is scoped to active waitlist rows for the same ticket type", () => {
  assertStringIncludes(source, '.eq("ticket_type_id", ticketTypeId)');
  assertStringIncludes(source, '.in("status", ["waiting", "invited"])');
  assertMatch(source, /query\s*=\s*query\.ilike\("email",\s*email\)/);
  assertMatch(source, /query\s*=\s*query\.eq\("phone",\s*phone\)/);
});
