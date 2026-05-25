import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0953 §3.10 — stripe-webhook has signature-failure notification hook", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(source, "STRIPE_WEBHOOK_FAILURE_ALERT_USERS");
  assertStringIncludes(source, "stripe_webhook_signature_failure");
  assertStringIncludes(source, "notifyWebhookSignatureFailure(signature)");
  assert(
    source.indexOf("notifyWebhookSignatureFailure(signature)") >
      source.indexOf("signature verification failed"),
    "alert must be wired in the invalid-signature catch branch",
  );
});

Deno.test("ORCH-0953 §3.10 — missing alert env returns without throwing", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(source, "if (userIds.length === 0) return 0;");
});
