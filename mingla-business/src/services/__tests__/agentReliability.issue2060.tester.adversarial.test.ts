import {
  AriResponseEnvelope,
  assertAriEnvelope,
  canDispatchAriIntent,
  createAriClientIntent,
  reduceAriClientIntent,
} from "../agentReliability";

const TURN_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";
const EXECUTION_ID = "323e4567-e89b-42d3-a456-426614174000";

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
    client_turn_id: null,
    execution_id: EXECUTION_ID,
    release_sha: "a".repeat(40),
    function_version: "agent-confirm-action-v500",
    ...patch,
  };
}

describe("#2060 tester adversarial recovery boundaries", () => {
  it("refuses to mint a competing execution identity when confirmation lacks the server UUID", () => {
    expect(() => createAriClientIntent({
      intent: "confirm",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: null,
      argsVersion: 1,
    }, () => TURN_ID)).toThrow();

    expect(() => createAriClientIntent({
      intent: "cancel",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: "legacy-non-uuid",
      argsVersion: 1,
    }, () => TURN_ID)).toThrow();
  });

  it("keeps a server-rehydrated executing action inert", () => {
    const intent = createAriClientIntent({
      intent: "confirm",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: EXECUTION_ID,
      argsVersion: 2,
    });
    const executing = reduceAriClientIntent(intent, {
      type: "rehydrated",
      operationState: "executing",
      code: "EXECUTION_IN_PROGRESS",
    });

    expect(canDispatchAriIntent(executing, true).allowed).toBe(false);
  });

  it("does not permit a retry until an after-reauth response has actually been reauthorized", () => {
    const intent = createAriClientIntent({
      intent: "confirm",
      conversationId: "conversation-1",
      brandId: "brand-1",
      pendingActionId: EXECUTION_ID,
      argsVersion: 2,
    });
    const revoked = reduceAriClientIntent(intent, {
      type: "server_response",
      envelope: envelope({
        kind: "error",
        code: "ROLE_REVOKED",
        user_message: "Your access changed before this action could run.",
        retryability: "after_reauth",
        safe_to_retry: false,
        operation_state: "none",
      }),
    });

    expect(canDispatchAriIntent(revoked, true).allowed).toBe(false);
  });

  it("rejects unregistered error codes and contradictory retry instructions", () => {
    expect(() => assertAriEnvelope(envelope({
      kind: "error",
      code: "RAW_DATABASE_ERROR",
      retryability: "never",
      safe_to_retry: false,
      operation_state: "failed",
    }))).toThrow("ARI_ENVELOPE_INVALID");

    expect(() => assertAriEnvelope(envelope({
      kind: "error",
      code: "ROLE_REVOKED",
      retryability: "after_reauth",
      safe_to_retry: true,
      operation_state: "none",
    }))).toThrow("ARI_ENVELOPE_INVALID");
  });
});
