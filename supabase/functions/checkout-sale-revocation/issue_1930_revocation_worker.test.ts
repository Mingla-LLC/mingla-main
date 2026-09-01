import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1930 revocation worker defaults dark and authenticates before claim", () => {
  assert(
    source.indexOf("not_authorized") < source.indexOf("issue_1930_claim_revocations"),
  );
  assertStringIncludes(
    source,
    'import { resolveCheckoutRevocationExecute } from "../_shared/secretBundle.ts";',
  );
  assertStringIncludes(source, "if (!resolveCheckoutRevocationExecute())");
});

Deno.test("#1930 Stripe neutralization keeps stable keys and account context", () => {
  assertStringIncludes(source, "provider_idempotency_key}:expire");
  assertStringIncludes(source, "provider_idempotency_key}:cancel");
  assertStringIncludes(source, "stripeAccount: session.stripe_account_id");
  assertStringIncludes(source, 'attempt.provider === "paystack"');
  assert(!source.includes("client_secret"));
});
