import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AriTelemetryEvent,
  buildAriTelemetryEvent,
  emitAriTelemetry,
  errorEnvelope,
} from "../agentReliability.ts";

const context = {
  requestId: "123e4567-e89b-42d3-a456-426614174000",
  clientTurnId: "223e4567-e89b-42d3-a456-426614174000",
  executionId: "323e4567-e89b-42d3-a456-426614174000",
  release: {
    release_sha: "a".repeat(40),
    function_version: "agent-confirm-action-v500",
  },
};

Deno.test("#2060 tester: typed errors cannot echo caller-supplied raw diagnostics", () => {
  const secret = "postgres relation agent_pending_actions jwt=private-token";
  const response = errorEnvelope(context, "INTERNAL", { userMessage: secret });
  assertFalse(JSON.stringify(response.body).includes(secret));
  assertEquals(
    response.body.user_message,
    "Ari could not finish that request. Try again shortly.",
  );
});

Deno.test("#2060 tester: telemetry emission rebuilds the allowlist at runtime", () => {
  const built = buildAriTelemetryEvent({
    phase: "response",
    context,
    tenantRef: "brand:sha256:6d96d74d",
    capabilityId: "ari.event.create",
  });
  const hostile = {
    ...built,
    raw_result: "buyer@example.com",
    prompt: "private operator message",
    jwt: "private-token",
  } as AriTelemetryEvent;

  const prior = console.log;
  let output = "";
  console.log = (value?: unknown) => {
    output = String(value);
  };
  try {
    emitAriTelemetry(hostile);
  } finally {
    console.log = prior;
  }

  const emitted = JSON.parse(output);
  assertFalse("raw_result" in emitted);
  assertFalse("prompt" in emitted);
  assertFalse("jwt" in emitted);
  assertEquals(emitted.request_id, context.requestId);
});
