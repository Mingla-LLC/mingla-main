/**
 * #2060 — Pass-5 hot-path HTTP envelope wire (implementor / fail-on-revert).
 *
 * Run:
 *   deno test --no-check --allow-env \
 *     supabase/functions/_shared/__tests__/issue_2060_ari_envelope_wire.implementor.test.ts
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ariErrorResponse,
  ariJsonResponse,
  emitAriPhase,
  runWithAriRequest,
  updateAriRequest,
} from "../agentReliabilityHttp.ts";
import {
  ARI_PROTOCOL_VERSION,
  ARI_SUCCESS_REGISTRY,
} from "../agentReliability.ts";

const RELEASE_SHA = "a".repeat(40);
const CLIENT_TURN = "123e4567-e89b-42d3-a456-426614174000";
const PENDING = "323e4567-e89b-42d3-a456-426614174000";

Deno.test("#2060 implementor: text success nests domain payload under data", async () => {
  Deno.env.set("MINGLA_RELEASE_SHA", RELEASE_SHA);
  Deno.env.set("DENO_DEPLOYMENT_ID", "wire-impl-v1");

  const response = await runWithAriRequest(
    { clientTurnId: CLIENT_TURN },
    () => {
      emitAriPhase("received", { operationState: "sending" });
      emitAriPhase("authorized", { operationState: "sending" });
      return ariJsonResponse(200, {
        kind: "text",
        text: "Hello from Ari",
        conversation_id: "423e4567-e89b-42d3-a456-426614174000",
        message_id: "523e4567-e89b-42d3-a456-426614174000",
        task_state_revision: 1,
      });
    },
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.protocol_version, ARI_PROTOCOL_VERSION);
  assertEquals(body.kind, "success");
  assertEquals(body.code, "PROPOSAL_READY");
  assertEquals(body.operation_state, "pending");
  assertEquals(body.client_turn_id, CLIENT_TURN);
  assertEquals(body.release_sha, RELEASE_SHA);
  assertEquals(body.function_version, "wire-impl-v1");
  assertEquals(
    body.retryability,
    ARI_SUCCESS_REGISTRY.PROPOSAL_READY.retryability,
  );
  assertEquals(body.data.kind, "text");
  assertEquals(body.data.text, "Hello from Ari");
});

Deno.test("#2060 implementor: pending_action stamps execution_id from pending_action_id", async () => {
  Deno.env.set("MINGLA_RELEASE_SHA", RELEASE_SHA);
  Deno.env.set("DENO_DEPLOYMENT_ID", "wire-impl-v2");

  const response = await runWithAriRequest(
    { clientTurnId: CLIENT_TURN },
    () =>
      ariJsonResponse(200, {
        kind: "pending_action",
        pending_action_id: PENDING,
        tool_name: "create_event",
        tool_args: { brand_id: "623e4567-e89b-42d3-a456-426614174000" },
        conversation_id: "423e4567-e89b-42d3-a456-426614174000",
        message_id: "523e4567-e89b-42d3-a456-426614174000",
        task_state_revision: 2,
      }),
  );

  const body = await response.json();
  assertEquals(body.kind, "success");
  assertEquals(body.code, "PROPOSAL_READY");
  assertEquals(body.execution_id, PENDING);
  assertEquals(body.data.kind, "pending_action");
  assertEquals(body.data.pending_action_id, PENDING);
});

Deno.test("#2060 implementor: executed maps to CANONICAL_READBACK_MATCHED", async () => {
  Deno.env.set("MINGLA_RELEASE_SHA", RELEASE_SHA);
  Deno.env.set("DENO_DEPLOYMENT_ID", "wire-impl-v3");

  const response = await runWithAriRequest(
    { executionId: PENDING },
    () => {
      updateAriRequest({ executionId: PENDING });
      return ariJsonResponse(200, {
        kind: "executed",
        pending_action_id: PENDING,
        tool_name: "publish_event",
        result: { event_id: "723e4567-e89b-42d3-a456-426614174000" },
      });
    },
  );

  const body = await response.json();
  assertEquals(body.code, "CANONICAL_READBACK_MATCHED");
  assertEquals(body.operation_state, "executed");
  assertEquals(body.execution_id, PENDING);
  assertEquals(body.data.kind, "executed");
  assertExists(body.request_id);
});

Deno.test("#2060 implementor: cancelled maps to ACTION_CANCELLED", async () => {
  Deno.env.set("MINGLA_RELEASE_SHA", RELEASE_SHA);
  Deno.env.set("DENO_DEPLOYMENT_ID", "wire-impl-v4");

  const response = await runWithAriRequest(
    { executionId: PENDING },
    () =>
      ariJsonResponse(200, {
        kind: "cancelled",
        pending_action_id: PENDING,
      }),
  );

  const body = await response.json();
  assertEquals(body.code, "ACTION_CANCELLED");
  assertEquals(body.operation_state, "cancelled");
  assertEquals(body.data.kind, "cancelled");
});

Deno.test("#2060 implementor: legacy RATE_LIMITED maps through registry", async () => {
  Deno.env.set("MINGLA_RELEASE_SHA", RELEASE_SHA);
  Deno.env.set("DENO_DEPLOYMENT_ID", "wire-impl-v5");

  const response = await runWithAriRequest(
    {},
    () =>
      ariErrorResponse(
        429,
        "RATE_LIMITED",
        "You've reached today's chat limit",
        {
          retry_after_seconds: 30,
        },
      ),
  );

  assertEquals(response.status, 429);
  const body = await response.json();
  assertEquals(body.kind, "error");
  assertEquals(body.code, "RATE_LIMITED");
  assertEquals(body.retryability, "after_backoff");
  assertEquals(body.safe_to_retry, true);
  assertEquals(body.retry_after_seconds, 30);
});
