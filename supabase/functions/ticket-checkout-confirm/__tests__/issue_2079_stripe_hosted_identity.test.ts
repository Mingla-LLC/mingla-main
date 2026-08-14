import { assert } from "jsr:@std/assert@1";

const source = Deno.readTextFileSync(
  "supabase/functions/ticket-checkout-confirm/index.ts",
);

Deno.test("#2079 confirm always proves stored hosted CS before PI finalize", () => {
  const hosted = source.indexOf("stripe_checkout_session_id.length > 0");
  const retrieve = source.indexOf("checkout.sessions.retrieve", hosted);
  const relation = source.indexOf("hostedRelationConflict", retrieve);
  const verify = source.indexOf('"issue_2079_verify_ticket_paid_identity"');
  assert(
    hosted >= 0 && retrieve > hosted && relation > retrieve &&
      verify > relation,
  );
  assert(
    !source.slice(hosted - 160, hosted).includes("paymentIntentId === null"),
    "persisted PI must not bypass hosted Checkout Session proof",
  );
});

Deno.test("#2079 confirm captures mismatch and fails retryably on capture failure", () => {
  const conflict = source.indexOf("if (hostedRelationConflict)");
  const capture = source.indexOf(
    '"issue_2079_capture_ticket_paid_identity_attention"',
    conflict,
  );
  const retryable = source.indexOf(
    '{ error: "paid_identity_capture_failed" }, 502',
    capture,
  );
  const nonfinal = source.indexOf("checkout_unavailable", retryable);
  assert(
    conflict >= 0 && capture > conflict && retryable > capture &&
      nonfinal > retryable,
  );
});
