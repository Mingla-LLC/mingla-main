import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { serviceClient } from "../_shared/ticketCheckout.ts";

type Revocation = {
  id: string;
  subject_type: "ticket_checkout_session" | "rsvp_contribution";
  subject_id: string;
  provider_attempt_id: string | null;
};

serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (
    !serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`
  ) {
    return Response.json({ error: "not_authorized" }, { status: 401 });
  }
  if (Deno.env.get("CHECKOUT_REVOCATION_EXECUTE") !== "true") {
    return Response.json({ disabled: true, claimed: 0 });
  }
  const client = serviceClient();
  const workerId = `checkout-revocation:${crypto.randomUUID()}`;
  const { data, error } = await client.rpc("issue_1930_claim_revocations", {
    p_worker_id: workerId,
    p_limit: 25,
  });
  if (error) return Response.json({ error: "claim_failed" }, { status: 500 });
  const results: Array<{ id: string; state: string }> = [];
  for (const row of (data ?? []) as Revocation[]) {
    let state = "failed_retryable";
    let errorCode: string | null = null;
    try {
      if (row.subject_type === "rsvp_contribution") {
        const { data: contribution } = await client.from(
          "event_rsvp_contributions",
        ).select(
          "provider,provider_flow,provider_object_id,provider_checkout_id,provider_attempt_key,brand_id",
        ).eq("id", row.subject_id).maybeSingle();
        if (!contribution || contribution.provider === "paystack") {
          // Paystack has no transaction-cancel primitive. Local continuation
          // suppression is immediate; a later verified success is reversed by
          // the canonical source-refund rail.
          state = "neutralized";
        } else {
          const { data: account } = await client.from("stripe_connect_accounts")
            .select("stripe_account_id")
            .eq("brand_id", contribution.brand_id)
            .is("detached_at", null).maybeSingle();
          if (!account?.stripe_account_id || !contribution.provider_attempt_key) {
            throw new Error("stripe_account_missing");
          }
          const stripe = stripeTicketCheckout();
          if (
            contribution.provider_flow === "stripe_checkout" &&
            contribution.provider_checkout_id
          ) {
            await stripe.checkout.sessions.expire(
              contribution.provider_checkout_id,
              {},
              {
                stripeAccount: account.stripe_account_id,
                idempotencyKey:
                  `${contribution.provider_attempt_key}:expire`,
              },
            );
          } else if (contribution.provider_object_id) {
            await stripe.paymentIntents.cancel(
              contribution.provider_object_id,
              {},
              {
                stripeAccount: account.stripe_account_id,
                idempotencyKey:
                  `${contribution.provider_attempt_key}:cancel`,
              },
            );
          }
          state = "neutralized";
        }
      } else {
        const { data: session } = await client.from("ticket_checkout_sessions")
          .select("stripe_account_id,reversal_state")
          .eq("id", row.subject_id).maybeSingle();
        const { data: attempt } = await client.from(
          "ticket_checkout_provider_attempts",
        )
          .select(
            "provider,flow,provider_object_id,provider_checkout_id,provider_reference,provider_idempotency_key",
          )
          .eq("id", row.provider_attempt_id).maybeSingle();
        if (!attempt) {
          state = "neutralized";
        } else if (attempt.provider === "paystack") {
          state = "neutralized";
        } else if (!session?.stripe_account_id) {
          throw new Error("stripe_account_missing");
        } else {
          const stripe = stripeTicketCheckout();
          if (
            attempt.flow === "stripe_checkout" && attempt.provider_checkout_id
          ) {
            // Expire is a provider mutation, keyed to the stable logical attempt.
            // @ts-ignore Stripe runtime namespace.
            await stripe.checkout.sessions.expire(
              attempt.provider_checkout_id,
              {},
              {
                stripeAccount: session.stripe_account_id,
                idempotencyKey: `${attempt.provider_idempotency_key}:expire`,
              },
            );
          } else if (attempt.provider_object_id) {
            await stripe.paymentIntents.cancel(attempt.provider_object_id, {}, {
              stripeAccount: session.stripe_account_id,
              idempotencyKey: `${attempt.provider_idempotency_key}:cancel`,
            });
          }
          state = "neutralized";
        }
      }
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "provider_unknown";
      errorCode = /^[a-z0-9_]{3,80}$/.test(message)
        ? message
        : "provider_unknown";
      state = "provider_unknown";
    }
    await client.rpc("issue_1930_record_revocation_result", {
      p_outbox_id: row.id,
      p_worker_id: workerId,
      p_state: state,
      p_error_code: errorCode,
    });
    results.push({ id: row.id, state });
  }
  return Response.json({ claimed: results.length, results });
});
