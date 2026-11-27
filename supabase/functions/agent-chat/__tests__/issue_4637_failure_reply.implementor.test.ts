// MINGLA-INVARIANT: I-ARI-NO-SILENT-TURN | issue #4637 | Every owner attempt that fails after claim commits one plain-words assistant reply.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AriFailureClass,
  ariFailureClass,
  buildAriFailureReply,
} from "../../_shared/ariFailureCopy.ts";

Deno.test("each terminal family has one typed non-empty owner reply", () => {
  const cases: Array<[string, AriFailureClass]> = [
    ["GEMINI_FAILED", "model_unavailable"],
    ["MODEL_TIMEOUT", "timeout"],
    ["RPC_FAILED", "tool_failed"],
    ["ROLE_CHECK_UNAVAILABLE", "tool_failed"],
    ["OWNERSHIP_DENIED", "permission"],
    ["NOT_FOUND", "not_found"],
    ["INVALID_ARGS", "invalid_input"],
    ["RATE_LIMITED", "rate_limited"],
    ["TURN_ABORTED", "internal"],
  ];
  for (const [code, expected] of cases) {
    assertEquals(ariFailureClass(code), expected);
    const reply = buildAriFailureReply({ errorCode: code });
    assert(reply.text.trim().length > 0);
    assertEquals(reply.structured.failure.v, 1);
    assertEquals(reply.structured.failure.class, expected);
    assertEquals(reply.structured.failure.changed_anything, false);
    assert(!/[A-Z]{2,}(?:_[A-Z]{2,})+/.test(reply.text));
  }
});

Deno.test("chat failure path uses the atomic RPC before failed activity", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  const rpc = source.indexOf('"commit_agent_chat_failure_turn"');
  const failedActivity = source.indexOf('eventType: "failed"', rpc);
  assert(rpc > 0 && failedActivity > rpc);
  assertStringIncludes(source, 'event: "failure_reply_commit_failed"');
  assertStringIncludes(source, "storedFailure?.v === 1");
  assertStringIncludes(source, 'attempt_status: "failed"');
});
