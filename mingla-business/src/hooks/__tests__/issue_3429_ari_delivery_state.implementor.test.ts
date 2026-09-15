/** #3429 — synchronous delivery invariants behind the chat interaction seams. */

import {
  canDispatchAriIntent,
  createAriClientIntent,
  existingAriAttachmentBytes,
  isAriSendReady,
  nextAriAttachmentBytes,
  reduceAriClientIntent,
} from "../../services/agentReliability";

const turnId = "11111111-1111-4111-8111-111111111111";

describe("#3429 load-bearing delivery state", () => {
  it("uses the exact same disabled gate for empty, externally disabled, and in-flight Enter/send paths", () => {
    expect(isAriSendReady("", false, false, false)).toBe(false);
    expect(isAriSendReady("message", false, true, false)).toBe(false);
    expect(isAriSendReady("message", false, false, true)).toBe(false);
    expect(isAriSendReady("", true, false, false)).toBe(true);
  });

  it("does not charge an invalid sibling against the next valid attachment's byte budget", () => {
    expect(
      nextAriAttachmentBytes(20 * 1024 * 1024, {
        state: "failed",
        sizeBytes: 10 * 1024 * 1024,
      }),
    ).toBe(20 * 1024 * 1024);
    expect(
      nextAriAttachmentBytes(20 * 1024 * 1024, {
        state: "preparing",
        sizeBytes: 5 * 1024 * 1024,
      }),
    ).toBe(25 * 1024 * 1024);
    expect(existingAriAttachmentBytes([
      { state: "failed", sizeBytes: 10 * 1024 * 1024 },
      { state: "ready", sizeBytes: 20 * 1024 * 1024 },
    ])).toBe(20 * 1024 * 1024);
  });

  it("makes duplicate dispatch and retry-before-return impossible for the one stable turn id", () => {
    const ready = createAriClientIntent({
      intent: "send",
      conversationId: null,
      brandId: "brand-a",
      draftText: "hello",
    }, () => turnId);
    const inFlight = reduceAriClientIntent(ready, { type: "dispatch_started" });
    expect(canDispatchAriIntent(inFlight, true)).toEqual({
      allowed: false,
      reason: "in_flight",
    });
    expect(reduceAriClientIntent(inFlight, { type: "dispatch_started" }))
      .toEqual(inFlight);
    const uncertain = reduceAriClientIntent(inFlight, {
      type: "transport_uncertain",
      code: "TRANSPORT_UNAVAILABLE",
    });
    expect(
      reduceAriClientIntent(uncertain, { type: "dispatch_started" }).attempt,
    ).toBe(2);
    const terminal = reduceAriClientIntent(inFlight, {
      type: "server_response",
      envelope: {
        protocol_version: 1,
        kind: "error",
        code: "VALIDATION_FAILED",
        user_message: "Not retryable",
        retryability: "never",
        safe_to_retry: false,
        operation_state: "none",
        request_id: "request",
        client_turn_id: turnId,
        execution_id: null,
        release_sha: "sha",
        function_version: "1",
      },
    });
    expect(canDispatchAriIntent(terminal, true)).toEqual({
      allowed: false,
      reason: "terminal",
    });
    expect(reduceAriClientIntent(terminal, { type: "dispatch_started" }))
      .toEqual(terminal);
  });
});
