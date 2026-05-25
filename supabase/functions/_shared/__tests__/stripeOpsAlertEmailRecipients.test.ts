import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0956 T-07 — ops alert email normalizes duplicate and malformed recipients", async () => {
  const priorTesting = Deno.env.get("DENO_TESTING");
  const priorApiKey = Deno.env.get("RESEND_API_KEY");
  const priorSystemFrom = Deno.env.get("RESEND_SYSTEM_FROM");
  const originalFetch = globalThis.fetch;
  const posts: Record<string, unknown>[] = [];
  Deno.env.set("DENO_TESTING", "1");
  Deno.env.set("RESEND_API_KEY", "re_test_key");
  Deno.env.delete("RESEND_SYSTEM_FROM");
  globalThis.fetch = ((_url, init) => {
    const body = (init as { body?: BodyInit | null } | undefined)?.body;
    posts.push(JSON.parse(String(body)));
    return Promise.resolve(new Response("{}", { status: 202 }));
  }) as typeof fetch;
  try {
    const { sendOpsAlertEmail } = await import(
      `../stripeOpsAlertEmail.ts?t07=${Date.now()}`
    );
    const result = await sendOpsAlertEmail({
      subject: "Recipient normalization test",
      paragraphs: ["Only one normalized recipient should receive this."],
      recipients: ["Seth@UseMingla.com", " seth@usemingla.com", " ", "bogus"],
      cta: null,
    });
    assertEquals(result, { attempted: 1, succeeded: 1, failed: 0 });
    assertEquals(posts.length, 1);
    assertEquals(posts[0].to, ["seth@usemingla.com"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorTesting === undefined) Deno.env.delete("DENO_TESTING");
    else Deno.env.set("DENO_TESTING", priorTesting);
    if (priorApiKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", priorApiKey);
    if (priorSystemFrom === undefined) Deno.env.delete("RESEND_SYSTEM_FROM");
    else Deno.env.set("RESEND_SYSTEM_FROM", priorSystemFrom);
  }
});
