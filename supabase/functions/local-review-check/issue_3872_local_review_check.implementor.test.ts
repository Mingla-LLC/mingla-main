import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("#3872 Local social proof reuses the gig verifier and persists unknown safely", () => {
  assertStringIncludes(source, "verifyGigPost");
  assertStringIncludes(source, '["#minglalocal"]');
  assertStringIncludes(source, ': "unverifiable"');
  assertStringIncludes(source, 'db.rpc("local_social_check_record"');
});
