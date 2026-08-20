import { assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { successEnvelope } from "../agentReliability.ts";

const context = {
  requestId: "123e4567-e89b-42d3-a456-426614174000",
  clientTurnId: "223e4567-e89b-42d3-a456-426614174000",
  executionId: "323e4567-e89b-42d3-a456-426614174000",
  release: {
    release_sha: "a".repeat(40),
    function_version: "agent-confirm-action-v500",
  },
};

Deno.test("#2060 tester: edge success builder rejects tuples the Business client cannot consume", () => {
  assertThrows(
    () =>
      successEnvelope(context, {
        code: "CANONICAL_READBACK_MATCHED",
        userMessage: "Done.",
        operationState: "pending",
        data: { id: "event-1" },
      }),
    TypeError,
    "ARI_SUCCESS_ENVELOPE_INVALID",
  );
  assertThrows(
    () =>
      successEnvelope(context, {
        code: "UNREGISTERED_SUCCESS",
        userMessage: "Done.",
        operationState: "executed",
        data: { id: "event-1" },
      }),
    TypeError,
    "ARI_SUCCESS_ENVELOPE_INVALID",
  );
});
