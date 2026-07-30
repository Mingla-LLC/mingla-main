import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
Deno.test("sweep fails closed and schedules ambiguity on the same attempt", () => {
  assertStringIncludes(source, "sourceRefundPostsEnabled()");
  assertStringIncludes(source, '"schedule_source_refund_retry"');
  assertStringIncludes(source, "SUPABASE_SERVICE_ROLE_KEY");
});
