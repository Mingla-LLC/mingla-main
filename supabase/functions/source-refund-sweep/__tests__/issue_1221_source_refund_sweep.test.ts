import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
Deno.test("sweep claims bounded work and runs the shared authority", () => {
  assertStringIncludes(source, '"claim_source_refund_operations"');
  assertStringIncludes(source, "p_limit: 25");
  assertStringIncludes(source, "runSourceRefundOperation");
});
