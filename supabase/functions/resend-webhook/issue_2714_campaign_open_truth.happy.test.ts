import { assert } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#2714 campaign correlation gaps are retryable without leaking ids", () => {
  assert(source.includes('data === "campaign_unmatched"'));
  assert(source.includes('data === "campaign_unmatched_stale"'));
  assert(source.includes("status: 500"));
  assert(source.includes("correlationHash"));
  const safeLog = source.slice(
    source.indexOf("const safeLog"),
    source.indexOf('if (data === "campaign_unmatched_stale")'),
  );
  assert(!safeLog.includes("providerMessageId"));
  assert(!safeLog.includes("payload"));
});
