import {
  dispatchIdempotentLegacyEmail,
  type EmailDeliveryClaim,
  isExactServiceBearer,
  type LegacyEmailDispatchDeps,
  type ResendEmailPayload,
} from "../../_shared/legacyEmailIdempotency.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Delivery = {
  recipientFingerprint: string;
  payloadFingerprint: string;
  claimId: string | null;
  status: "queued" | "sent" | "failed";
  providerMessageId: string | null;
  failureReason: string | null;
};

function fixture() {
  const recipient = ["ops", "example.com"].join("@");
  const logicalKey = "ops.stripe_payout_release_attempt_cap:release-1172";
  const payload: ResendEmailPayload = {
    from: "Mingla <notifications@example.com>",
    to: [recipient],
    subject: "Stripe organiser payout needs manual review",
    html: "<p>Release release-1172 exhausted 10 attempts.</p>",
    text: "Release release-1172 exhausted 10 attempts.",
  };
  const deliveries = new Map<string, Delivery>();
  const accepted = new Map<string, string>();
  const providerKeys: string[] = [];
  let claimSequence = 0;
  let providerCalls = 0;
  let failProviderAckOnce = false;
  let failCompletionOnce = false;
  let providerOutcome: "accepted" | "retryable" | "manual_review" = "accepted";

  const deps: LegacyEmailDispatchDeps = {
    claimDelivery: async (input): Promise<EmailDeliveryClaim> => {
      const existing = deliveries.get(input.idempotencyKey);
      if (!existing) {
        const claimId = `claim-${++claimSequence}`;
        deliveries.set(input.idempotencyKey, {
          recipientFingerprint: input.recipientFingerprint,
          payloadFingerprint: input.payloadFingerprint,
          claimId,
          status: "queued",
          providerMessageId: null,
          failureReason: null,
        });
        return {
          action: "send_new",
          deliveryId: "delivery-1172",
          claimId,
          providerMessageId: null,
        };
      }
      if (
        existing.recipientFingerprint !== input.recipientFingerprint ||
        existing.payloadFingerprint !== input.payloadFingerprint
      ) {
        return {
          action: "idempotency_conflict",
          deliveryId: "delivery-1172",
          claimId: null,
          providerMessageId: null,
        };
      }
      if (existing.status === "sent" && existing.providerMessageId) {
        return {
          action: "already_accepted",
          deliveryId: "delivery-1172",
          claimId: null,
          providerMessageId: existing.providerMessageId,
        };
      }
      if (existing.status === "failed") {
        return {
          action: "acceptance_unknown",
          deliveryId: "delivery-1172",
          claimId: null,
          providerMessageId: null,
        };
      }
      const claimId = `claim-${++claimSequence}`;
      existing.claimId = claimId;
      return {
        action: "retry_same_provider_key",
        deliveryId: "delivery-1172",
        claimId,
        providerMessageId: null,
      };
    },
    completeDelivery: async (input): Promise<void> => {
      if (failCompletionOnce) {
        failCompletionOnce = false;
        throw new Error("simulated_delivery_record_failure");
      }
      const delivery = deliveries.get(logicalKey);
      assert(delivery, "delivery row missing");
      assert(delivery.claimId === input.claimId, "claim id changed");
      delivery.claimId = null;
      if (input.outcome === "accepted") {
        delivery.status = "sent";
        delivery.providerMessageId = input.providerMessageId;
        delivery.failureReason = null;
      } else if (input.outcome === "retryable") {
        delivery.status = "queued";
        delivery.failureReason = input.errorReason;
      } else {
        delivery.status = "failed";
        delivery.failureReason = input.errorReason;
      }
    },
    sendResend: async (_payload, providerKey) => {
      providerCalls++;
      providerKeys.push(providerKey);
      if (providerOutcome !== "accepted") {
        return {
          outcome: providerOutcome,
          reason: providerOutcome === "retryable"
            ? "resend_retryable_503"
            : "resend_rejected_400",
        };
      }
      const providerMessageId = accepted.get(providerKey) ?? "email-1172";
      accepted.set(providerKey, providerMessageId);
      if (failProviderAckOnce) {
        failProviderAckOnce = false;
        throw new Error("simulated_lost_http_response");
      }
      return { outcome: "accepted", providerMessageId };
    },
  };

  const send = () =>
    dispatchIdempotentLegacyEmail({
      recipient,
      logicalIdempotencyKey: logicalKey,
      recipientHmacSecret: "h".repeat(64),
      payload,
    }, deps);

  return {
    recipient,
    logicalKey,
    payload,
    deliveries,
    providerKeys,
    send,
    providerCalls: () => providerCalls,
    providerAcceptanceCount: () => accepted.size,
    failProviderAck: () => failProviderAckOnce = true,
    failCompletion: () => failCompletionOnce = true,
    setProviderOutcome: (
      value: "accepted" | "retryable" | "manual_review",
    ) => providerOutcome = value,
  };
}

Deno.test("email-only acceptance and replay converge on one provider id", async () => {
  const state = fixture();
  const first = await state.send();
  const replay = await state.send();
  assert(first.outcome === "provider_accepted", "first send not accepted");
  assert(replay.outcome === "provider_accepted", "replay not accepted");
  assert(replay.duplicate, "replay did not use durable accepted state");
  assert(state.providerCalls() === 1, "provider accepted more than once");
  assert(state.providerKeys.length === 1, "provider key missing");
  assert(
    !state.providerKeys[0].includes(state.recipient),
    "provider key leaked recipient",
  );
});

Deno.test("lost provider response retries the same Resend key", async () => {
  const state = fixture();
  state.failProviderAck();
  await state.send().then(
    () => {
      throw new Error("lost response unexpectedly succeeded");
    },
    () => undefined,
  );
  const retry = await state.send();
  assert(retry.outcome === "provider_accepted", "retry not accepted");
  assert(state.providerCalls() === 2, "expected one provider retry");
  assert(
    state.providerKeys[0] === state.providerKeys[1],
    "retry changed provider idempotency key",
  );
});

Deno.test("delivery-record failure retries without a second acceptance", async () => {
  const state = fixture();
  state.failCompletion();
  await state.send().then(
    () => {
      throw new Error("completion failure unexpectedly succeeded");
    },
    () => undefined,
  );
  const retry = await state.send();
  assert(retry.outcome === "provider_accepted", "retry not accepted");
  assert(
    state.providerKeys[0] === state.providerKeys[1],
    "completion retry changed provider key",
  );
  assert(
    state.providerAcceptanceCount() === 1,
    "completion retry created a second provider acceptance",
  );
});

Deno.test("overlapping sends converge through one provider key and id", async () => {
  const state = fixture();
  const results = await Promise.all([state.send(), state.send()]);
  assert(
    results.every((result) => result.outcome === "provider_accepted"),
    "overlap did not converge to acceptance",
  );
  assert(
    new Set(state.providerKeys).size === 1,
    "overlap used more than one provider key",
  );
  assert(
    state.providerAcceptanceCount() === 1,
    "overlap created more than one provider acceptance",
  );
});

Deno.test("provider rejection is honest manual review", async () => {
  const state = fixture();
  state.setProviderOutcome("manual_review");
  const result = await state.send();
  assert(result.outcome === "manual_review", "rejection reported as success");
  const row = state.deliveries.get(state.logicalKey);
  assert(row?.status === "failed", "rejection not durably failed");
});

Deno.test("missing HMAC secret and payload conflicts fail before resend", async () => {
  const state = fixture();
  await dispatchIdempotentLegacyEmail({
    recipient: state.recipient,
    logicalIdempotencyKey: state.logicalKey,
    recipientHmacSecret: "",
    payload: state.payload,
  }, {
    claimDelivery: () => {
      throw new Error("claim must not run");
    },
    completeDelivery: () => {
      throw new Error("complete must not run");
    },
    sendResend: () => {
      throw new Error("provider must not run");
    },
  }).then(
    () => {
      throw new Error("missing secret unexpectedly succeeded");
    },
    () => undefined,
  );

  await state.send();
  const conflict = await dispatchIdempotentLegacyEmail({
    recipient: ["other", "example.com"].join("@"),
    logicalIdempotencyKey: state.logicalKey,
    recipientHmacSecret: "h".repeat(64),
    payload: {
      ...state.payload,
      to: [["other", "example.com"].join("@")],
    },
  }, {
    ...fixtureDeps(state),
  });
  assert(conflict.outcome === "manual_review", "conflict not manual review");
  assert(state.providerCalls() === 1, "conflict called provider");
  const serialized = JSON.stringify(
    Array.from(state.deliveries.values()),
  );
  assert(!serialized.includes(state.recipient), "ledger leaked raw recipient");

  const piiKey = await dispatchIdempotentLegacyEmail({
    recipient: state.recipient,
    logicalIdempotencyKey: `alert:${state.recipient}`,
    recipientHmacSecret: "h".repeat(64),
    payload: state.payload,
  }, {
    claimDelivery: () => {
      throw new Error("PII key must not reach durable claim");
    },
    completeDelivery: () => {
      throw new Error("PII key must not complete");
    },
    sendResend: () => {
      throw new Error("PII key must not call provider");
    },
  });
  assert(piiKey.outcome === "manual_review", "PII key did not fail closed");
});

Deno.test("email-bearing legacy auth requires the exact service bearer", () => {
  assert(
    isExactServiceBearer("Bearer service-secret", "service-secret"),
    "exact service bearer rejected",
  );
  assert(
    !isExactServiceBearer("Bearer user-jwt", "service-secret"),
    "user JWT accepted for email",
  );
  assert(
    !isExactServiceBearer("Bearer service-secret-extra", "service-secret"),
    "forged bearer suffix accepted",
  );
});

function fixtureDeps(
  state: ReturnType<typeof fixture>,
): LegacyEmailDispatchDeps {
  return {
    claimDelivery: async (input) => {
      const existing = state.deliveries.get(input.idempotencyKey);
      if (
        existing &&
        (existing.recipientFingerprint !== input.recipientFingerprint ||
          existing.payloadFingerprint !== input.payloadFingerprint)
      ) {
        return {
          action: "idempotency_conflict",
          deliveryId: "delivery-1172",
          claimId: null,
          providerMessageId: null,
        };
      }
      throw new Error("unexpected claim");
    },
    completeDelivery: () => {
      throw new Error("complete must not run");
    },
    sendResend: () => {
      throw new Error("provider must not run");
    },
  };
}
