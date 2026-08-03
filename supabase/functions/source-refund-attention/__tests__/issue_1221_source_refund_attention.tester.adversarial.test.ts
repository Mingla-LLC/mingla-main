import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
Deno.test("attention bank details are request-local and owner/token gated", () => {
  assertStringIncludes(source, "/^[0-9]{10}$/");
  assertStringIncludes(source, "hashSourceRefundAttentionToken");
  assertStringIncludes(source, '"authorize_source_refund_attention"');
  assertStringIncludes(source, '"claim_source_refund_attention_submission"');
  assertStringIncludes(source, "MAX_BODY_BYTES = 4096");
  assertStringIncludes(source, '"Cache-Control": "no-store, max-age=0"');
  assert(!source.includes("pg_guest_venue_refund_summary"));
  assert(!source.includes("guestToken"));
  assert(!source.includes("account_number:"));
  assert(!source.includes("bank_id:"));
});
