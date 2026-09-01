import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { serviceClient } from "../_shared/ticketCheckout.ts";
import { neutralizeTicketStripeAttempt } from "./ticketProviderNeutralization.ts";
import { resolveCheckoutRevocationExecute } from "../_shared/secretBundle.ts";

type Revocation = {
  id: string;
  subject_type: "ticket_checkout_session" | "rsvp_contribution";
  subject_id: string;
  provider_attempt_id: string | null;
  state: string;
  reason: string;
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
  if (!resolveCheckoutRevocationExecute()) {
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
          if (
            !account?.stripe_account_id || !contribution.provider_attempt_key
          ) {
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
                idempotencyKey: `${contribution.provider_attempt_key}:expire`,
              },
            );
          } else if (contribution.provider_object_id) {
            await stripe.paymentIntents.cancel(
              contribution.provider_object_id,
              {},
              {
                stripeAccount: account.stripe_account_id,
                idempotencyKey: `${contribution.provider_attempt_key}:cancel`,
              },
            );
          } else {
            // A Stripe revocation is never terminal merely because the local
            // row lacks an object id. An accepted-but-lost provider response
            // remains retryable/unknown until exact identity is adopted.
            throw new Error("provider_identity_missing");
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
        if (row.reason.startsWith("paid_provider_")) {
          // #2168 — paid provider evidence is a refund obligation, never
          // ordinary continuation suppression. This USED to throw, which made
          // the row `failed_retryable` and re-armed it forever: the durable
          // attention row it said it was waiting for was never created by
          // anything. The handoff now creates it, so the row can leave the
          // retry pool with the money question owned by a person.
          const { data: outcome, error: handoffError } = await client.rpc(
            "issue_2168_handoff_revocation_attention",
            { p_outbox_id: row.id },
          );
          if (handoffError) throw new Error("attention_handoff_failed");
          // `no_money` means the buyer is owed nothing (a free ticket, or a
          // charge that is entirely platform fee), so there is no reversal to
          // perform and nothing for an operator to decide.
          state = outcome === "no_money" ? "paid_reversed" : "paid_reversal_pending";
        } else if (!attempt) {
          state = "neutralized";
        } else if (attempt.provider === "paystack") {
          state = "neutralized";
        } else if (!session?.stripe_account_id) {
          throw new Error("stripe_account_missing");
        } else {
          const stripe = stripeTicketCheckout();
          if (
            (attempt.flow === "stripe_checkout" &&
              attempt.provider_checkout_id) ||
            (attempt.flow === "stripe_native" && attempt.provider_object_id)
          ) {
            await neutralizeTicketStripeAttempt(
              attempt,
              session.stripe_account_id,
              {
                expireCheckout: async (input) => {
                  const operationKey =
                    `${attempt.provider_idempotency_key}:expire`;
                  if (input.operationKey !== operationKey) {
                    throw new Error("provider_operation_key_mismatch");
                  }
                  if (input.stripeAccountId !== session.stripe_account_id) {
                    throw new Error("stripe_account_mismatch");
                  }
                  // @ts-ignore Stripe runtime namespace.
                  await stripe.checkout.sessions.expire(
                    input.checkoutSessionId,
                    {},
                    {
                      stripeAccount: session.stripe_account_id,
                      idempotencyKey: operationKey,
                    },
                  );
                },
                cancelPaymentIntent: async (input) => {
                  const operationKey =
                    `${attempt.provider_idempotency_key}:cancel`;
                  if (input.operationKey !== operationKey) {
                    throw new Error("provider_operation_key_mismatch");
                  }
                  if (input.stripeAccountId !== session.stripe_account_id) {
                    throw new Error("stripe_account_mismatch");
                  }
                  await stripe.paymentIntents.cancel(
                    input.paymentIntentId,
                    {},
                    {
                      stripeAccount: session.stripe_account_id,
                      idempotencyKey: operationKey,
                    },
                  );
                },
              },
            );
          } else {
            throw new Error("provider_identity_missing");
          }
          state = "neutralized";
        }
      }
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "provider_unknown";
      if (message === "paid_provider_identity_pending") {
        const { error: retryError } = await client.rpc(
          "issue_2079_record_paid_identity_retry",
          {
            p_outbox_id: row.id,
            p_worker_id: workerId,
            p_error_code: message,
          },
        );
        if (retryError) {
          results.push({ id: row.id, state: "record_failed" });
          continue;
        }
        results.push({ id: row.id, state: "provider_unknown" });
        continue;
      }
      errorCode = /^[a-z0-9_]{3,80}$/.test(message)
        ? message
        : "provider_unknown";
      state = "provider_unknown";
    }
    const { error: recordError } = await client.rpc(
      "issue_1930_record_revocation_result",
      {
        p_outbox_id: row.id,
        p_worker_id: workerId,
        p_state: state,
        p_error_code: errorCode,
      },
    );
    if (recordError) {
      results.push({ id: row.id, state: "record_failed" });
      continue;
    }
    results.push({ id: row.id, state });
  }
  return Response.json({ claimed: results.length, results });
});
