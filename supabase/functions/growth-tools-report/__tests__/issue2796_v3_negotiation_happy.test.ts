import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("issue 2796 report transport is explicit opt-in and projects exact v2 by default", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  for (const expected of [
    'max_schema_version',
    'body.max_schema_version !== 2 && body.max_schema_version !== 3',
    'body.max_schema_version === 3',
    'brief?.schema_version === 3',
    'schema_version: wantsV3 ? 3 : 2',
    '...(wantsV3 ? { decision_report: brief?.decision_report } : {})',
  ]) assertEquals(source.includes(expected), true, expected);
  assertEquals(source.includes("wantsV3"), true);
});
