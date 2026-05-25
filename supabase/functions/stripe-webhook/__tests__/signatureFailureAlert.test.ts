import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0956 T-04 — signature failure routes operator email alert", async () => {
  const priorTesting = Deno.env.get("DENO_TESTING");
  const priorEmails = Deno.env.get("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS");
  Deno.env.set("DENO_TESTING", "1");
  Deno.env.set("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS", "ops@example.com");
  try {
    const mod = await import(`../index.ts?orch0956=${Date.now()}`);
    const alerts: {
      subject: string;
      paragraphs: string[];
      recipients: string[];
      cta?: { label: string; url: string } | null;
    }[] = [];
    const count = await mod.notifyWebhookSignatureFailure(
      "t=12345,v1=abcdef0123456789abcdef",
      ((input: {
        subject: string;
        paragraphs: string[];
        recipients: string[];
        cta?: { label: string; url: string } | null;
      }) => {
        alerts.push(input);
        return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
      }) as never,
    );
    assertEquals(count, 1);
    assertEquals(alerts.length, 1);
    assertEquals(
      alerts[0].subject,
      "⚠️ [LIVE] Stripe webhook signature failure detected",
    );
    assertEquals(alerts[0].recipients, ["ops@example.com"]);
    assertStringIncludes(
      alerts[0].paragraphs.join("\n"),
      "Signature prefix: t=12345,v1=abcdef01",
    );
    assertStringIncludes(
      alerts[0].paragraphs.join("\n"),
      "STRIPE_WEBHOOK_SECRET_LIVE",
    );
    assertEquals(alerts[0].cta, {
      label: "Open Stripe webhooks dashboard",
      url: "https://dashboard.stripe.com/webhooks",
    });
  } finally {
    if (priorTesting === undefined) Deno.env.delete("DENO_TESTING");
    else Deno.env.set("DENO_TESTING", priorTesting);
    if (priorEmails === undefined) {
      Deno.env.delete("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS");
    } else {
      Deno.env.set("STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS", priorEmails);
    }
  }
});

Deno.test("ORCH-0956 T-04 — invalid-signature branch preserves 400 response", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(source, "STRIPE_WEBHOOK_FAILURE_ALERT_EMAILS");
  assertStringIncludes(
    source,
    "⚠️ [LIVE] Stripe webhook signature failure detected",
  );
  assertStringIncludes(source, "Signature prefix: ${sigPrefix}");
  assertStringIncludes(source, "STRIPE_WEBHOOK_SECRET_LIVE");
  assertStringIncludes(source, "https://dashboard.stripe.com/webhooks");
  assertStringIncludes(source, "notifyWebhookSignatureFailure(signature)");
  assertStringIncludes(
    source,
    'return plainResponse({ error: "invalid_signature"',
  );
  assert(
    source.indexOf("notifyWebhookSignatureFailure(signature)") >
      source.indexOf("signature verification failed"),
    "alert must be wired in the invalid-signature catch branch",
  );
});

Deno.test("ORCH-0956 §3.10 — missing signature-failure email env returns without throwing", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(source, "if (emails.length === 0) return 0;");
});
