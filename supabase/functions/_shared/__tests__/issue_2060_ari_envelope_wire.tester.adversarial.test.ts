/**
 * #2060 — Pass-5 hot-path HTTP envelope wire (adversarial / fail-on-revert).
 *
 * Run:
 *   deno test --no-check --allow-env \
 *     supabase/functions/_shared/__tests__/issue_2060_ari_envelope_wire.tester.adversarial.test.ts
 */

import {
  assertEquals,
  assertFalse,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ariErrorResponse,
  ariJsonResponse,
  runWithAriRequest,
} from "../agentReliabilityHttp.ts";
import { ARI_ERROR_REGISTRY } from "../agentReliability.ts";

const RELEASE_SHA = "b".repeat(40);
const PENDING = "523e4567-e89b-42d3-a456-426614174000";

Deno.test("#2060 adversarial: secret/exception strings never reach user_message", async () => {
  Deno.env.set("MINGLA_RELEASE_SHA", RELEASE_SHA);
  Deno.env.set("DENO_DEPLOYMENT_ID", "wire-adv-v1");
  const secret =
    "jwt_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sql SELECT * FROM agent_messages";

  const response = await runWithAriRequest({ executionId: PENDING }, () =>
    ariErrorResponse(500, "HANDLER_THREW", `agent-chat threw: ${secret}`)
  );

  const body = await response.json();
  assertEquals(body.kind, "error");
  assertEquals(body.code, "INTERNAL");
  assertEquals(body.user_message, ARI_ERROR_REGISTRY.INTERNAL.userMessage);
  assertFalse(JSON.stringify(body).includes(secret));
  assertFalse(JSON.stringify(body).includes("jwt_"));
  assertFalse("data" in body);
});

Deno.test("#2060 adversarial: responders require request context", async () => {
  await assertRejects(
    () =>
      Promise.resolve(
        ariJsonResponse(200, { kind: "text", text: "hi", conversation_id: "x" }),
      ),
    TypeError,
    "ari_request_context_missing",
  );
  await assertRejects(
    () => Promise.resolve(ariErrorResponse(500, "INTERNAL", "nope")),
    TypeError,
    "ari_request_context_missing",
  );
});

Deno.test("#2060 adversarial: TIMEOUT maps to DEADLINE_EXCEEDED not raw echo", async () => {
  Deno.env.set("MINGLA_RELEASE_SHA", RELEASE_SHA);
  const response = await runWithAriRequest({}, () =>
    ariErrorResponse(504, "TIMEOUT", "Ari is taking too long — try again")
  );
  assertEquals(response.status, 504);
  const body = await response.json();
  assertEquals(body.code, "DEADLINE_EXCEEDED");
  assertEquals(body.retryability, "server_reconcile");
  assertFalse(body.safe_to_retry);
  assertEquals(
    body.user_message,
    ARI_ERROR_REGISTRY.DEADLINE_EXCEEDED.userMessage,
  );
});
