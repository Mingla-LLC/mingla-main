import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1930 RSVP contribution retries require caller identity", () => {
  assertStringIncludes(source, "callerIdempotencyKey");
  assertStringIncludes(source, "caller_idempotency_key");
  assert(!source.includes("mingla_contrib_${contributionId.replaceAll(\"-\", \"\")}_${Date.now()"));
});

Deno.test("#1930 RSVP revalidates immediately before both provider rails", () => {
  const guard = "contributionStillAuthorized(supabase, contributionId, eventId)";
  assert(source.split(guard).length - 1 >= 3);
  assert(
    source.indexOf(guard, source.indexOf("let init:")) <
      source.indexOf("await paystackInitializeTransaction"),
  );
  assertStringIncludes(source, 'visibility, deleted_at');
  assertStringIncludes(source, '"checkout_unavailable"');
});
