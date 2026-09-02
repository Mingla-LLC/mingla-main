/**
 * #2060 — Business client unwraps protocol-v1 envelopes from agent-chat /
 * agent-confirm-action (fail-on-revert).
 */

import { assertAriEnvelope } from "../agentReliability";

const RELEASE = "c".repeat(40);

function successEnvelope(data: Record<string, unknown>) {
  return {
    protocol_version: 1 as const,
    kind: "success" as const,
    code: "PROPOSAL_READY",
    user_message: "Ready when you are.",
    retryability: "never" as const,
    safe_to_retry: false,
    operation_state: "pending" as const,
    request_id: "123e4567-e89b-42d3-a456-426614174000",
    client_turn_id: "223e4567-e89b-42d3-a456-426614174000",
    execution_id: null,
    release_sha: RELEASE,
    function_version: "agent-chat-v1",
    data,
  };
}

describe("agentChatService #2060 envelope wire", () => {
  it("accepts a success envelope and exposes nested domain kind", () => {
    const envelope = successEnvelope({
      kind: "text",
      text: "ok",
      conversation_id: "323e4567-e89b-42d3-a456-426614174000",
      message_id: "423e4567-e89b-42d3-a456-426614174000",
      task_state_revision: 1,
    });
    expect(() => assertAriEnvelope(envelope)).not.toThrow();
    expect(envelope.data.kind).toBe("text");
  });

  it("rejects unattested release unless allowUnattested", () => {
    const envelope = {
      ...successEnvelope({ kind: "text", text: "x" }),
      release_sha: "unattested",
      function_version: "unknown",
    };
    expect(() => assertAriEnvelope(envelope)).toThrow("ARI_ENVELOPE_INVALID");
    expect(() =>
      assertAriEnvelope(envelope, { allowUnattested: true })
    ).not.toThrow();
  });
});
