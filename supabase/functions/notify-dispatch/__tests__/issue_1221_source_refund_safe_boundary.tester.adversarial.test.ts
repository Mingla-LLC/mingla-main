import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { emailAdapter } from "../../_shared/adapters/emailAdapter.ts";

Deno.test("Provider body and attention credential never cross the source safe adapter boundary", async () => {
  Deno.env.set("RESEND_API_KEY", "re_test_fixture");
  Deno.env.set("DENO_TESTING", "1");
  const credential =
    "https://host.usemingla.com/refund/id/attention#attentionToken=do-not-leak";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(`provider echoed ${credential}`, { status: 500 }),
    )) as typeof fetch;
  try {
    const result = await emailAdapter.send({
      to: "guest@example.com",
      title: "Refund",
      body: "Continue",
      cta: { label: "Continue", url: credential },
      idempotencyKey: "source-refund-email/test",
      beforeProviderIo: async () => {},
    });
    assertEquals(result.error, "provider_unavailable");
    assertEquals(JSON.stringify(result).includes(credential), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Source dispatch exposes only the binding status/outcome matrix", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  for (
    const marker of [
      'outcome: "accepted"',
      'outcome: "retryable"',
      'outcome: "terminal_unsent"',
      'outcome: "ambiguous_parked"',
      'outcome: "source_dispatch_failed"',
    ]
  ) assertStringIncludes(source, marker);
  for (
    const status of ["}, 200)", "}, 503)", "}, 422)", "}, 202)", "}, 500)"]
  ) {
    assertStringIncludes(source, status);
  }
  const sourceBranch = source.slice(
    source.indexOf('payload.category_key.startsWith("source_refund_")'),
    source.indexOf("const v2Input: DispatchV2Input"),
  );
  assertEquals(sourceBranch.includes("console."), false);
});
