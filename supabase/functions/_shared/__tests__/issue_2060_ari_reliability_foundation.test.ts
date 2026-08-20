import {
  assertEquals,
  assertFalse,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_ERROR_REGISTRY,
  ARI_UNATTESTED_RELEASE,
  AriDeadlineExceededError,
  buildAriTelemetryEvent,
  createAriDeadline,
  decideAriFinalization,
  errorEnvelope,
  finalizeAriCertificationRun,
  resolveReleaseAttestation,
  resolveRequestId,
  successEnvelope,
} from "../agentReliability.ts";

const RELEASE = {
  release_sha: "a".repeat(40),
  function_version: "agent-chat-v500",
};

Deno.test("#2060 typed envelope carries stable correlation and release truth", () => {
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  const context = {
    requestId,
    clientTurnId: "223e4567-e89b-42d3-a456-426614174000",
    executionId: "323e4567-e89b-42d3-a456-426614174000",
    release: RELEASE,
  };
  const success = successEnvelope(context, {
    code: "CANONICAL_READBACK_MATCHED",
    userMessage: "The event is confirmed.",
    operationState: "executed",
    data: { id: "event-1" },
  });
  assertEquals(success.protocol_version, 1);
  assertEquals(success.request_id, requestId);
  assertEquals(success.client_turn_id, context.clientTurnId);
  assertEquals(success.execution_id, context.executionId);
  assertEquals(success.release_sha, RELEASE.release_sha);
  assertEquals(success.safe_to_retry, false);

  const unknown = errorEnvelope(context, "RESULT_UNKNOWN");
  assertEquals(unknown.status, 202);
  assertEquals(unknown.body.retryability, "server_reconcile");
  assertFalse(unknown.body.safe_to_retry);
  assertEquals(unknown.body.operation_state, "reconciliation_required");
});

Deno.test("#2060 error registry covers every locked family with safe recovery", () => {
  const required = [
    "VALIDATION_FAILED",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "ROLE_REVOKED",
    "TENANT_MISMATCH",
    "STALE_PROPOSAL",
    "CONFLICT",
    "RATE_LIMITED",
    "OFFLINE",
    "TRANSPORT_UNAVAILABLE",
    "PROVIDER_UNAVAILABLE",
    "DEPENDENCY_UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "RESULT_UNKNOWN",
    "RECONCILIATION_REQUIRED",
    "INTERNAL",
  ];
  assertEquals(required.every((code) => code in ARI_ERROR_REGISTRY), true);
  assertFalse(ARI_ERROR_REGISTRY.DEADLINE_EXCEEDED.safeToRetry);
  assertEquals(ARI_ERROR_REGISTRY.ROLE_REVOKED.retryability, "after_reauth");
  assertEquals(ARI_ERROR_REGISTRY.OFFLINE.httpStatus, 0);
});

Deno.test("#2060 release and request identifiers fail closed", () => {
  const valid = "423e4567-e89b-42d3-a456-426614174000";
  assertEquals(resolveRequestId(valid), valid);
  assertEquals(
    resolveRequestId("not-a-request-id") === "not-a-request-id",
    false,
  );

  const attested = resolveReleaseAttestation({
    get: (key: string) =>
      key === "MINGLA_RELEASE_SHA"
        ? "B".repeat(40)
        : key === "DENO_DEPLOYMENT_ID"
        ? "v500"
        : undefined,
  });
  assertEquals(attested.release_sha, "b".repeat(40));
  assertEquals(attested.function_version, "v500");

  const unattested = resolveReleaseAttestation({ get: () => undefined });
  assertEquals(unattested.release_sha, ARI_UNATTESTED_RELEASE);
  assertEquals(unattested.function_version, "unknown");
});

Deno.test("#2060 deadline aborts cancellable work and blocks later phases", async () => {
  const deadline = createAriDeadline(5);
  const abort = new Promise<void>((_resolve, reject) => {
    deadline.signal.addEventListener(
      "abort",
      () => reject(deadline.signal.reason),
    );
  });
  await assertRejects(() => abort, AriDeadlineExceededError);
  assertEquals(deadline.signal.aborted, true);
  assertEquals(deadline.remainingMs(), 0);
  deadline.dispose();
});

Deno.test("#2060 success requires both durable receipt and matched readback", () => {
  assertEquals(
    decideAriFinalization(true, {
      state: "matched",
      reference: "events:event-1:v7",
      value: { id: "event-1" },
    }),
    {
      state: "executed",
      reference: "events:event-1:v7",
      value: { id: "event-1" },
    },
  );
  assertEquals(
    decideAriFinalization(false, {
      state: "matched",
      reference: "events:event-1:v7",
      value: { id: "event-1" },
    }),
    { state: "reconciliation_required", code: "RESULT_UNKNOWN" },
  );
  assertEquals(
    decideAriFinalization(true, {
      state: "mismatch",
      reference: "events:event-1:v8",
    }),
    { state: "reconciliation_required", code: "RECONCILIATION_REQUIRED" },
  );
});

Deno.test("#2060 telemetry is correlation-only and carries no payload fields", () => {
  const event = buildAriTelemetryEvent({
    phase: "canonical_readback",
    context: {
      requestId: "523e4567-e89b-42d3-a456-426614174000",
      clientTurnId: "623e4567-e89b-42d3-a456-426614174000",
      executionId: "723e4567-e89b-42d3-a456-426614174000",
      release: RELEASE,
    },
    tenantRef: "brand:sha256:6d96d74d",
    capabilityId: "ari.event.create",
    attempt: 2,
    operationState: "executing",
    durationMs: 12.4,
  });
  assertEquals(event.attempt, 2);
  assertEquals(event.duration_ms, 12);
  assertEquals(event.tenant_ref, "brand:sha256:6d96d74d");
  const keys = Object.keys(event);
  for (
    const forbidden of [
      "prompt",
      "message",
      "args",
      "result",
      "jwt",
      "contact",
      "exception",
    ]
  ) {
    assertFalse(keys.includes(forbidden));
  }
});

Deno.test("#2060 finalization has an explicit fail-closed control-plane caller", async () => {
  const runId = "823e4567-e89b-42d3-a456-426614174000";
  const calls: unknown[] = [];
  const result = await finalizeAriCertificationRun({
    rpc: (functionName, args) => {
      calls.push([functionName, args]);
      return Promise.resolve({ data: { status: "passed" }, error: null });
    },
  }, runId);
  assertEquals(result, { status: "passed" });
  assertEquals(calls, [["ari_cert_finalize_run", { p_run_id: runId }]]);
  await assertRejects(
    () =>
      finalizeAriCertificationRun({
        rpc: () => Promise.resolve({ data: null, error: { code: "denied" } }),
      }, runId),
    Error,
    "ari_cert_finalize_failed",
  );
  await assertRejects(
    () =>
      finalizeAriCertificationRun({
        rpc: () => Promise.resolve({ data: null, error: null }),
      }, "not-a-run-id"),
    TypeError,
    "ari_cert_invalid_run_id",
  );
});
