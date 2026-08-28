import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#2714 retry logging exposes only bounded operational metadata", () => {
  const blockStart = source.indexOf(
    'if (data === "campaign_unmatched" || data === "campaign_unmatched_stale")',
  );
  const blockEnd = source.indexOf(
    "return new Response(JSON.stringify({ ok: true, outcome: data })",
    blockStart,
  );
  const block = source.slice(blockStart, blockEnd);

  assert(blockStart >= 0, "retryable campaign-debt branch is missing");
  assert(block.includes("status: 500"));
  assert(block.includes("event_type: eventType"));
  assert(block.includes("age_bucket: ageBucket"));
  assert(block.includes("correlation_hash: await correlationHash(svixId)"));
  assertEquals(block.includes("providerMessageId"), false);
  assertEquals(block.includes("rawBody"), false);
  assertEquals(block.includes("payload"), false);

  const hashBody = source.slice(
    source.indexOf("async function correlationHash"),
    source.indexOf("export async function handleResendWebhook"),
  );
  assertMatch(hashBody, /slice\(0, 12\)/);
});
