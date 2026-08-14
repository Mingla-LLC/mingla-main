import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("#1930 status authenticates before bounded preflight and exposes no continuation", () => {
  const tokenCheck = source.indexOf("session.buyer_status_token_hash !==");
  const preflight = source.indexOf("if (body.preflight === true)");
  assert(tokenCheck >= 0 && tokenCheck < preflight);
  assertStringIncludes(source, 'status: "present_allowed"');
  const preflightBlock = source.slice(
    preflight,
    source.indexOf("if (", preflight + 20),
  );
  assert(!preflightBlock.includes("clientSecret"));
  assert(!preflightBlock.includes("providerObjectId"));
});
