// @ts-nocheck -- a Deno suite (deno2-discovered); the app tsc has no Deno globals or URL imports.
// Issue #3645 (payments audit item 7 follow-through) — Explorer's chip-in
// (ConsumerEventDetailScreen.handleChipIn) rejects with the SERVER's code and
// floor, read from a REAL FunctionsHttpError (the @supabase/functions-js
// version the app ships) around a real Response.
//
// Before: handleChipIn threw `error.message`, supabase-js's generic
// "Edge Function returned a non-2xx status code", so every refusal — the
// provider floor, the host minimum and brand_cannot_collect (paused) — showed
// "Couldn't process that".
//
// FAILS-ON-REVERT: throw `error.message` again -> the source case fails; drop
// the body from the thrown error -> the floor cases fail.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FunctionsHttpError } from "npm:@supabase/functions-js@2.103.0";

import { extractFunctionErrorFields } from "../../utils/edgeFunctionError.ts";
import { chipInRefusalFromBody } from "../../../../packages/offering-rendering/chipInRefusal.ts";

const refusal = (body: Record<string, unknown>, status = 422): FunctionsHttpError =>
  new FunctionsHttpError(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

/** What handleChipIn now throws for an invoke error. */
const thrownFor = async (error: unknown) => {
  const fields = await extractFunctionErrorFields(error, "contribution_failed");
  return chipInRefusalFromBody(fields.token, fields.body);
};

Deno.test("#3645 the provider floor reaches the panel (₦50 host minimum, ₦100 floor)", async () => {
  const err = await thrownFor(
    refusal({ error: "amount_below_min", minCents: 10_000, reason: "provider_minimum" }),
  );
  assertEquals(err.message, "amount_below_min");
  assertEquals(err.minCents, 10_000);
});

Deno.test("#3645 brand_cannot_collect reaches the panel (its paused state)", async () => {
  const err = await thrownFor(refusal({ error: "brand_cannot_collect" }, 409));
  assertEquals(err.message, "brand_cannot_collect");
  assertEquals(err.minCents, null);
});

Deno.test("#3645 an unreadable body or a network failure falls back, never throws past the caller", async () => {
  const html = new FunctionsHttpError(new Response("<!doctype html>bad gateway", { status: 502 }));
  const fromHtml = await thrownFor(html);
  // The reader's own fallback wording (e.g. "contribution_failed (server
  // error)"); what matters is that no refusal code or floor is invented.
  assert(fromHtml.message.startsWith("contribution_failed"));
  assertEquals(fromHtml.minCents, null);
  const network = { name: "FunctionsFetchError", message: "Failed to send", context: new TypeError("Failed to fetch") };
  const err = await thrownFor(network);
  assertEquals(typeof err.message, "string");
  assertEquals(err.minCents, null);
});

Deno.test("#3645 handleChipIn reads the body and no longer throws the generic message", async () => {
  const source = await Deno.readTextFile(
    new URL("../../screens/Event/ConsumerEventDetailScreen.tsx", import.meta.url),
  );
  const start = source.indexOf("const handleChipIn = useCallback(");
  assert(start > 0, "handleChipIn not found");
  const body = source.slice(start, source.indexOf("requires_native_payment", start));
  assert(body.includes('extractFunctionErrorFields(error, "contribution_failed")'));
  assert(body.includes("throw chipInRefusalFromBody(fields.token, fields.body)"));
  assert(!body.includes("(error as { message?: string }).message"), "still throws error.message");
});
