/**
 * Issue #2060 — request-scoped Ari envelope responders for hot-path functions.
 *
 * Uses AsyncLocalStorage so concurrent requests cannot share correlation state.
 * Domain payloads stay nested under `data`; error copy is registry-owned.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { corsHeaders } from "./cors.ts";
import {
  AriEnvelopeContext,
  AriErrorCode,
  AriOperationState,
  AriTelemetryPhase,
  buildAriTelemetryEvent,
  emitAriTelemetry,
  errorEnvelope,
  mapLegacyAriErrorCode,
  resolveReleaseAttestation,
  resolveRequestId,
  successCodeForDomainKind,
  successEnvelope,
  userMessageForSuccessCode,
} from "./agentReliability.ts";

interface AriRequestState {
  context: AriEnvelopeContext;
  startedAt: number;
  tenantRef: string | null;
  capabilityId: string | null;
  attempt: number;
}

const ariRequestStore = new AsyncLocalStorage<AriRequestState>();

function requireState(): AriRequestState {
  const state = ariRequestStore.getStore();
  if (!state) {
    throw new TypeError("ari_request_context_missing");
  }
  return state;
}

export function runWithAriRequest<T>(
  init: {
    requestIdHeader?: string | null;
    clientTurnId?: string | null;
    executionId?: string | null;
  },
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const state: AriRequestState = {
    context: {
      requestId: resolveRequestId(init.requestIdHeader),
      clientTurnId: init.clientTurnId ?? null,
      executionId: init.executionId ?? null,
      release: resolveReleaseAttestation(),
    },
    startedAt: Date.now(),
    tenantRef: null,
    capabilityId: null,
    attempt: 1,
  };
  return ariRequestStore.run(state, fn);
}

export function updateAriRequest(patch: {
  clientTurnId?: string | null;
  executionId?: string | null;
  tenantRef?: string | null;
  capabilityId?: string | null;
  attempt?: number;
}): AriEnvelopeContext {
  const state = requireState();
  if (patch.clientTurnId !== undefined) {
    state.context.clientTurnId = patch.clientTurnId;
  }
  if (patch.executionId !== undefined) {
    state.context.executionId = patch.executionId;
  }
  if (patch.tenantRef !== undefined) state.tenantRef = patch.tenantRef;
  if (patch.capabilityId !== undefined) {
    state.capabilityId = patch.capabilityId;
  }
  if (patch.attempt !== undefined) {
    state.attempt = Math.max(1, Math.floor(patch.attempt));
  }
  return state.context;
}

export function currentAriContext(): AriEnvelopeContext {
  return requireState().context;
}

export function emitAriPhase(
  phase: AriTelemetryPhase,
  options: {
    operationState?: AriOperationState;
    errorCode?: AriErrorCode | null;
    durationMs?: number | null;
  } = {},
): void {
  const state = requireState();
  emitAriTelemetry(buildAriTelemetryEvent({
    phase,
    context: state.context,
    tenantRef: state.tenantRef,
    capabilityId: state.capabilityId,
    attempt: state.attempt,
    operationState: options.operationState,
    durationMs: options.durationMs === undefined
      ? Date.now() - state.startedAt
      : options.durationMs,
    errorCode: options.errorCode ?? null,
  }));
}

export function ariJsonResponse(
  status: number,
  body: { kind: string } & Record<string, unknown>,
): Response {
  const state = requireState();
  if (body.kind === "error") {
    return ariErrorResponse(
      status,
      typeof body.code === "string" ? body.code : "INTERNAL",
      typeof body.message === "string" ? body.message : "error",
      {
        retry_after_seconds: typeof body.retry_after_seconds === "number"
          ? body.retry_after_seconds
          : undefined,
      },
    );
  }
  if (
    typeof body.pending_action_id === "string" &&
    state.context.executionId == null
  ) {
    state.context.executionId = body.pending_action_id;
  }
  const code = successCodeForDomainKind(body.kind);
  if (body.kind === "pending_action") {
    emitAriPhase("proposal_committed", { operationState: "pending" });
  }
  const envelope = successEnvelope(state.context, {
    code,
    userMessage: userMessageForSuccessCode(code, {
      followup_text: body.followup_text,
      text: body.text,
    }),
    operationState: code === "CANONICAL_READBACK_MATCHED"
      ? "executed"
      : code === "ACTION_CANCELLED"
      ? "cancelled"
      : code === "EXECUTION_IN_PROGRESS"
      ? "executing"
      : "pending",
    data: body,
  });
  emitAriPhase("response", { operationState: envelope.operation_state });
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function ariErrorResponse(
  _status: number,
  legacyCode: string,
  _message: string,
  recovery?: { retry_after_seconds?: number; cooldown_until?: string },
): Response {
  const state = requireState();
  const code = mapLegacyAriErrorCode(legacyCode);
  const { status, body } = errorEnvelope(state.context, code, {
    retryAfterSeconds: recovery?.retry_after_seconds,
  });
  // Registry uses 0 for client-only OFFLINE; never emit that from the edge.
  const httpStatus = status > 0 ? status : 503;
  emitAriPhase("response", {
    operationState: body.operation_state,
    errorCode: code,
  });
  emitAriPhase("terminal", {
    operationState: body.operation_state,
    errorCode: code,
  });
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
