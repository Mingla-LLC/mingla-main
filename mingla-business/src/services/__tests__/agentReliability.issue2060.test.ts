import {
  AriResponseEnvelope,
  assertAriEnvelope,
  canDispatchAriIntent,
  createAriClientIntent,
  reduceAriClientIntent,
  retryDelayMs,
} from "../agentReliability";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";

function envelope(
  patch: Partial<AriResponseEnvelope> = {},
): AriResponseEnvelope {
  return {
    protocol_version: 1,
    kind: "success",
    code: "CANONICAL_READBACK_MATCHED",
    user_message: "Done.",
    retryability: "never",
    safe_to_retry: false,
    operation_state: "executed",
    request_id: REQUEST_ID,
    client_turn_id: UUID,
    execution_id: null,
    release_sha: "a".repeat(40),
    function_version: "agent-chat-v500",
    ...patch,
  };
}

describe("#2060 Ari recovery foundation", () => {
  it("reuses one stable turn identity through offline and retry", () => {
    const draft = createAriClientIntent({
      intent: "send",
      conversationId: null,
      brandId: "brand-1",
      draftText: "Create Friday's event",
    }, () => UUID);

    const offline = reduceAriClientIntent(draft, { type: "offline_detected" });
    expect(offline.stableId).toBe(UUID);
    expect(canDispatchAriIntent(offline, false)).toEqual({ allowed: false, reason: "offline" });

    const sending = reduceAriClientIntent(offline, { type: "dispatch_started" });
    expect(sending.stableId).toBe(UUID);
    expect(sending.attempt).toBe(1);
    expect(canDispatchAriIntent(sending, true)).toEqual({ allowed: false, reason: "in_flight" });

    const uncertain = reduceAriClientIntent(sending, {
      type: "transport_uncertain",
      code: "TRANSPORT_UNAVAILABLE",
    });
    const retried = reduceAriClientIntent(uncertain, { type: "dispatch_started" });
    expect(retried.stableId).toBe(UUID);
    expect(retried.attempt).toBe(2);
  });

  it("never invites a second write while the server reconciles", () => {
    const intent = createAriClientIntent({
      intent: "confirm",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: "323e4567-e89b-42d3-a456-426614174000",
      argsVersion: 3,
    }, () => UUID);
    const reconciling = reduceAriClientIntent(intent, {
      type: "server_response",
      envelope: envelope({
        kind: "error",
        code: "RESULT_UNKNOWN",
        retryability: "server_reconcile",
        safe_to_retry: false,
        operation_state: "reconciliation_required",
        client_turn_id: null,
        execution_id: "323e4567-e89b-42d3-a456-426614174000",
      }),
    });
    expect(reconciling.state).toBe("server_reconcile");
    expect(canDispatchAriIntent(reconciling, true)).toEqual({
      allowed: false,
      reason: "server_reconcile",
    });
  });

  it("aliases a UUID pending action as the one stable execution identity", () => {
    const executionId = "323e4567-e89b-42d3-a456-426614174000";
    const intent = createAriClientIntent({
      intent: "confirm",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: executionId,
      argsVersion: 4,
    }, () => {
      throw new Error("must not mint a competing execution ID");
    });
    expect(intent.stableId).toBe(executionId);
  });

  it("fails correlation mismatches closed", () => {
    const intent = createAriClientIntent({
      intent: "send",
      conversationId: null,
      brandId: "brand-1",
      draftText: "hello",
    }, () => UUID);
    const next = reduceAriClientIntent(intent, {
      type: "server_response",
      envelope: envelope({ client_turn_id: "323e4567-e89b-42d3-a456-426614174000" }),
    });
    expect(next.state).toBe("uncertain");
    expect(next.lastCode).toBe("CORRELATION_MISMATCH");
  });

  it("honours server retry floors with capped jitter", () => {
    expect(retryDelayMs(1, undefined, () => 0)).toBe(1_000);
    expect(retryDelayMs(20, undefined, () => 1)).toBe(30_500);
    expect(retryDelayMs(2, 10, () => 0)).toBe(10_000);
  });

  it("rejects incomplete or unattested envelopes", () => {
    expect(() => assertAriEnvelope(envelope())).not.toThrow();
    expect(() => assertAriEnvelope({ ...envelope(), request_id: "bad" })).toThrow("ARI_ENVELOPE_INVALID");
    expect(() => assertAriEnvelope({ ...envelope(), release_sha: "unattested" })).toThrow("ARI_ENVELOPE_INVALID");
    expect(() => assertAriEnvelope({ ...envelope(), function_version: "unknown" })).toThrow("ARI_ENVELOPE_INVALID");
    expect(() => assertAriEnvelope({ ...envelope(), retryability: "server_reconcile", safe_to_retry: true })).toThrow("ARI_ENVELOPE_INVALID");
  });

  it("does not accept an uncorrelated terminal response", () => {
    const intent = createAriClientIntent({
      intent: "send",
      conversationId: null,
      brandId: "brand-1",
      draftText: "hello",
    }, () => UUID);
    const next = reduceAriClientIntent(intent, {
      type: "server_response",
      envelope: envelope({ client_turn_id: null }),
    });
    expect(next.state).toBe("uncertain");
    expect(next.lastCode).toBe("CORRELATION_MISMATCH");
  });
});

describe("#2060 rework guards", () => {
  it("requires explicit successful reauthorization before the same execution ID can retry", () => {
    const intent = createAriClientIntent({
      intent: "confirm",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: "323e4567-e89b-42d3-a456-426614174000",
      argsVersion: 4,
    });
    const revoked = reduceAriClientIntent(intent, {
      type: "server_response",
      envelope: envelope({
        kind: "error",
        code: "ROLE_REVOKED",
        retryability: "after_reauth",
        safe_to_retry: false,
        operation_state: "none",
        client_turn_id: null,
        execution_id: intent.stableId,
      }),
    });
    expect(revoked.state).toBe("awaiting_reauth");
    expect(canDispatchAriIntent(revoked, true).allowed).toBe(false);
    const reauthorized = reduceAriClientIntent(revoked, { type: "reauthorized" });
    expect(reauthorized.state).toBe("ready");
    expect(reauthorized.stableId).toBe(intent.stableId);
    expect(canDispatchAriIntent(reauthorized, true)).toEqual({ allowed: true });
  });

  it("rehydrates a role-revoked operation as inert", () => {
    const intent = createAriClientIntent({
      intent: "cancel",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: "323e4567-e89b-42d3-a456-426614174000",
      argsVersion: 2,
    });
    const rehydrated = reduceAriClientIntent(intent, {
      type: "rehydrated",
      operationState: "none",
      code: "ROLE_REVOKED",
    });
    expect(rehydrated.state).toBe("awaiting_reauth");
    expect(canDispatchAriIntent(rehydrated, true).allowed).toBe(false);
  });
});
