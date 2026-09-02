/**
 * Issue #2060 — Ari's common reliability envelope.
 *
 * Hot-path consumers: `agent-chat`, `agent-confirm-action`, and the Business
 * Ari client. #1972 owns the atomic domain receipt; #1985 owns task state /
 * client_turn_id. This module does not redefine either owner.
 */

export const ARI_PROTOCOL_VERSION = 1 as const;
export const ARI_UNATTESTED_RELEASE = "unattested" as const;

export type AriRetryability =
  | "never"
  | "after_backoff"
  | "after_reconnect"
  | "after_reauth"
  | "server_reconcile";

export type AriOperationState =
  | "none"
  | "sending"
  | "pending"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired"
  | "reconciliation_required";

export type AriErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ROLE_REVOKED"
  | "TENANT_MISMATCH"
  | "STALE_PROPOSAL"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "OFFLINE"
  | "TRANSPORT_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE"
  | "DEADLINE_EXCEEDED"
  | "RESULT_UNKNOWN"
  | "RECONCILIATION_REQUIRED"
  | "MINIMUM_VERSION_REQUIRED"
  | "INTERNAL";

export type AriSuccessCode =
  | "CANONICAL_READBACK_MATCHED"
  | "PROPOSAL_READY"
  | "ACTION_CANCELLED"
  | "EXECUTION_IN_PROGRESS";

export interface AriReleaseAttestation {
  release_sha: string;
  function_version: string;
}

export interface AriEnvelopeBase {
  protocol_version: typeof ARI_PROTOCOL_VERSION;
  kind: string;
  code: string;
  user_message: string;
  retryability: AriRetryability;
  safe_to_retry: boolean;
  operation_state: AriOperationState;
  request_id: string;
  client_turn_id: string | null;
  execution_id: string | null;
  release_sha: string;
  function_version: string;
  retry_after_seconds?: number;
}

export interface AriSuccessEnvelope<T> extends AriEnvelopeBase {
  kind: "success";
  data: T;
}

export interface AriErrorEnvelope extends AriEnvelopeBase {
  kind: "error";
  code: AriErrorCode;
}

export type AriResponseEnvelope<T> = AriSuccessEnvelope<T> | AriErrorEnvelope;

interface AriErrorDefinition {
  httpStatus: number;
  retryability: AriRetryability;
  safeToRetry: boolean;
  operationState: AriOperationState;
  userMessage: string;
}

export const ARI_ERROR_REGISTRY: Readonly<
  Record<AriErrorCode, AriErrorDefinition>
> = Object.freeze({
  VALIDATION_FAILED: {
    httpStatus: 400,
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
    userMessage: "Check the details and try again.",
  },
  UNAUTHENTICATED: {
    httpStatus: 401,
    retryability: "after_reauth",
    safeToRetry: false,
    operationState: "none",
    userMessage: "Sign in again to continue with Ari.",
  },
  FORBIDDEN: {
    httpStatus: 403,
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
    userMessage: "Your current access does not allow this action.",
  },
  ROLE_REVOKED: {
    httpStatus: 403,
    retryability: "after_reauth",
    safeToRetry: false,
    operationState: "none",
    userMessage: "Your access changed before this action could run.",
  },
  TENANT_MISMATCH: {
    httpStatus: 409,
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
    userMessage: "This chat belongs to a different brand.",
  },
  STALE_PROPOSAL: {
    httpStatus: 409,
    retryability: "never",
    safeToRetry: false,
    operationState: "pending",
    userMessage:
      "This proposal changed. Review the latest version before confirming.",
  },
  CONFLICT: {
    httpStatus: 409,
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "pending",
    userMessage: "A newer update is available. Refresh and try again.",
  },
  RATE_LIMITED: {
    httpStatus: 429,
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "none",
    userMessage: "Ari is busy right now. Try again shortly.",
  },
  OFFLINE: {
    httpStatus: 0,
    retryability: "after_reconnect",
    safeToRetry: true,
    operationState: "sending",
    userMessage:
      "You are offline. Your request is still here for you to retry.",
  },
  TRANSPORT_UNAVAILABLE: {
    httpStatus: 503,
    retryability: "after_reconnect",
    safeToRetry: true,
    operationState: "sending",
    userMessage: "Ari could not connect. Retry when your connection is stable.",
  },
  PROVIDER_UNAVAILABLE: {
    httpStatus: 502,
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "sending",
    userMessage: "Ari is temporarily unavailable. Try again shortly.",
  },
  DEPENDENCY_UNAVAILABLE: {
    httpStatus: 503,
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "sending",
    userMessage:
      "A required service is unavailable. Nothing new will run until it recovers.",
  },
  DEADLINE_EXCEEDED: {
    httpStatus: 504,
    retryability: "server_reconcile",
    safeToRetry: false,
    operationState: "reconciliation_required",
    userMessage:
      "Ari is checking whether the request completed. Do not submit it again.",
  },
  RESULT_UNKNOWN: {
    httpStatus: 202,
    retryability: "server_reconcile",
    safeToRetry: false,
    operationState: "reconciliation_required",
    userMessage:
      "The result is not confirmed yet. Ari is checking the official record.",
  },
  RECONCILIATION_REQUIRED: {
    httpStatus: 202,
    retryability: "server_reconcile",
    safeToRetry: false,
    operationState: "reconciliation_required",
    userMessage: "Ari is verifying the result before showing it as complete.",
  },
  MINIMUM_VERSION_REQUIRED: {
    httpStatus: 426,
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
    userMessage: "Update Mingla Business before using Ari again.",
  },
  INTERNAL: {
    httpStatus: 500,
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "none",
    userMessage: "Ari could not finish that request. Try again shortly.",
  },
});

interface AriSuccessDefinition {
  retryability: "never";
  safeToRetry: false;
  operationState: Extract<
    AriOperationState,
    "executed" | "pending" | "cancelled" | "executing"
  >;
}

export const ARI_SUCCESS_REGISTRY: Readonly<
  Record<AriSuccessCode, AriSuccessDefinition>
> = Object.freeze({
  CANONICAL_READBACK_MATCHED: {
    retryability: "never",
    safeToRetry: false,
    operationState: "executed",
  },
  PROPOSAL_READY: {
    retryability: "never",
    safeToRetry: false,
    operationState: "pending",
  },
  ACTION_CANCELLED: {
    retryability: "never",
    safeToRetry: false,
    operationState: "cancelled",
  },
  EXECUTION_IN_PROGRESS: {
    retryability: "never",
    safeToRetry: false,
    operationState: "executing",
  },
});

export interface AriEnvelopeContext {
  requestId: string;
  clientTurnId?: string | null;
  executionId?: string | null;
  release: AriReleaseAttestation;
}

function envelopeBase(
  context: AriEnvelopeContext,
  values: Pick<
    AriEnvelopeBase,
    | "kind"
    | "code"
    | "user_message"
    | "retryability"
    | "safe_to_retry"
    | "operation_state"
  >,
): AriEnvelopeBase {
  return {
    protocol_version: ARI_PROTOCOL_VERSION,
    ...values,
    request_id: context.requestId,
    client_turn_id: context.clientTurnId ?? null,
    execution_id: context.executionId ?? null,
    release_sha: context.release.release_sha,
    function_version: context.release.function_version,
  };
}

export function successEnvelope<T>(
  context: AriEnvelopeContext,
  input: {
    // Keep runtime callers fail-closed as well as typed callers. The registry
    // lookup below is the authority for values crossing an untyped boundary.
    code: string;
    userMessage: string;
    operationState: AriOperationState;
    data: T;
  },
): AriSuccessEnvelope<T> {
  const definition = ARI_SUCCESS_REGISTRY[input.code as AriSuccessCode];
  if (!definition || input.operationState !== definition.operationState) {
    throw new TypeError("ARI_SUCCESS_ENVELOPE_INVALID");
  }
  return {
    ...envelopeBase(context, {
      kind: "success",
      code: input.code,
      user_message: input.userMessage,
      retryability: definition.retryability,
      safe_to_retry: definition.safeToRetry,
      operation_state: definition.operationState,
    }),
    kind: "success",
    data: input.data,
  };
}

export function errorEnvelope(
  context: AriEnvelopeContext,
  code: AriErrorCode,
  options: { userMessage?: string; retryAfterSeconds?: number } = {},
): { status: number; body: AriErrorEnvelope } {
  const definition = ARI_ERROR_REGISTRY[code];
  const body: AriErrorEnvelope = {
    ...envelopeBase(context, {
      kind: "error",
      code,
      // Error copy is registry-owned. The compatibility option is intentionally
      // ignored so a widened caller cannot echo an exception/provider string.
      user_message: definition.userMessage,
      retryability: definition.retryability,
      safe_to_retry: definition.safeToRetry,
      operation_state: definition.operationState,
    }),
    kind: "error",
    code,
    ...(options.retryAfterSeconds === undefined ? {} : {
      retry_after_seconds: Math.max(1, Math.ceil(options.retryAfterSeconds)),
    }),
  };
  return { status: definition.httpStatus, body };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

export function resolveRequestId(candidate?: string | null): string {
  return candidate && UUID_PATTERN.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

/**
 * Map legacy hot-path error tokens onto the locked AriErrorCode registry.
 * Unknown tokens fail closed to INTERNAL so callers cannot invent families.
 */
export function mapLegacyAriErrorCode(legacy: string): AriErrorCode {
  const code = legacy.trim().toUpperCase();
  if (code in ARI_ERROR_REGISTRY) return code as AriErrorCode;
  switch (code) {
    case "UNAUTHORIZED":
      return "UNAUTHENTICATED";
    case "BRAND_ACCESS_DENIED":
    case "OWNERSHIP_DENIED":
    case "ROLE_DENIED":
      return "FORBIDDEN";
    case "TASK_STATE_CONFLICT":
    case "CHOICE_STALE":
    case "EXPIRED":
    case "STALE":
      return "STALE_PROPOSAL";
    case "WRONG_STATE":
    case "VERSION_CONFLICT":
    case "TASK_STATE_VERSION_UNSUPPORTED":
    case "DELETE_BLOCKED_BY_EVENTS":
    case "PAYOUT_NOT_READY":
    case "TAX_REGISTRATION_REQUIRED":
    case "EVENT_CURRENCY_REQUIRED":
    case "SLUG_TAKEN":
      return "CONFLICT";
    case "TIMEOUT":
      return "DEADLINE_EXCEEDED";
    case "TENANT_SCOPE_UNAVAILABLE":
    case "ROLE_CHECK_UNAVAILABLE":
    case "PAYOUT_CHECK_FAILED":
      return "DEPENDENCY_UNAVAILABLE";
    case "MODEL_EMPTY":
    case "MODEL_SCHEMA_INVALID":
    case "MODEL_ERROR":
    case "GEMINI_FAILED":
      return "PROVIDER_UNAVAILABLE";
    case "TASK_RECOVERY_REQUIRED":
    case "TERMINALIZATION_FAILED":
      return "RECONCILIATION_REQUIRED";
    case "EXECUTION_FAILED":
      return "RESULT_UNKNOWN";
    case "BAD_REQUEST":
    case "MESSAGE_TOO_LONG":
    case "INVALID_ARGS":
    case "METHOD_NOT_ALLOWED":
    case "NOT_FOUND":
    case "CONVERSATION_NOT_FOUND":
    case "PRIVATE_VISIBILITY_UNAVAILABLE":
      return "VALIDATION_FAILED";
    case "HANDLER_THREW":
    case "INTERNAL":
    default:
      return "INTERNAL";
  }
}

/** Domain response kinds → protocol success codes for the Pass-5 envelope. */
export function successCodeForDomainKind(
  kind: string,
): AriSuccessCode {
  switch (kind) {
    case "executed":
      return "CANONICAL_READBACK_MATCHED";
    case "cancelled":
      return "ACTION_CANCELLED";
    case "text":
    case "pending_action":
    case "proposal_replaced":
    case "expired_regenerate":
      return "PROPOSAL_READY";
    default:
      return "PROPOSAL_READY";
  }
}

export function userMessageForSuccessCode(
  code: AriSuccessCode,
  domain?: { followup_text?: unknown; text?: unknown },
): string {
  if (
    code === "CANONICAL_READBACK_MATCHED" &&
    typeof domain?.followup_text === "string" &&
    domain.followup_text.trim().length > 0
  ) {
    return domain.followup_text.trim().slice(0, 500);
  }
  if (
    code === "PROPOSAL_READY" &&
    typeof domain?.text === "string" &&
    domain.text.trim().length > 0
  ) {
    return domain.text.trim().slice(0, 500);
  }
  switch (code) {
    case "CANONICAL_READBACK_MATCHED":
      return "Done.";
    case "ACTION_CANCELLED":
      return "Cancelled.";
    case "EXECUTION_IN_PROGRESS":
      return "Ari is still finishing that action.";
    case "PROPOSAL_READY":
    default:
      return "Review Ari's reply.";
  }
}

export interface AriReleaseAttestationEnv {
  get: (name: string) => string | undefined;
}

function defaultReleaseAttestationEnv(): AriReleaseAttestationEnv {
  return {
    get(name: string) {
      if (name === "MINGLA_RELEASE_SHA") {
        return Deno.env.get("MINGLA_RELEASE_SHA");
      }
      if (name === "DENO_DEPLOYMENT_ID") {
        return Deno.env.get("DENO_DEPLOYMENT_ID");
      }
      if (name === "SB_EXECUTION_ID") return Deno.env.get("SB_EXECUTION_ID");
      return undefined;
    },
  };
}

export function resolveReleaseAttestation(
  env: AriReleaseAttestationEnv = defaultReleaseAttestationEnv(),
): AriReleaseAttestation {
  const sha = env.get("MINGLA_RELEASE_SHA")?.trim() ?? "";
  const deployment = env.get("DENO_DEPLOYMENT_ID")?.trim() ||
    env.get("SB_EXECUTION_ID")?.trim() || "unknown";
  return {
    release_sha: RELEASE_SHA_PATTERN.test(sha)
      ? sha.toLowerCase()
      : ARI_UNATTESTED_RELEASE,
    function_version: deployment,
  };
}

export interface AriDeadline {
  signal: AbortSignal;
  deadlineAt: number;
  assertOpen: () => void;
  remainingMs: () => number;
  dispose: () => void;
}

export class AriDeadlineExceededError extends Error {
  readonly code = "DEADLINE_EXCEEDED" as const;

  constructor() {
    super("ari_deadline_exceeded");
    this.name = "AriDeadlineExceededError";
  }
}

export function createAriDeadline(
  timeoutMs: number,
  now: () => number = Date.now,
): AriDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be positive");
  }
  const controller = new AbortController();
  const deadlineAt = now() + timeoutMs;
  let disposed = false;
  const timer = setTimeout(
    () => controller.abort(new AriDeadlineExceededError()),
    timeoutMs,
  );
  const remainingMs = (): number => Math.max(0, deadlineAt - now());
  const assertOpen = (): void => {
    if (disposed || controller.signal.aborted || remainingMs() === 0) {
      throw new AriDeadlineExceededError();
    }
  };
  return {
    signal: controller.signal,
    deadlineAt,
    assertOpen,
    remainingMs,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
    },
  };
}

export type AriReadbackResult<T> =
  | { state: "matched"; reference: string; value: T }
  | { state: "mismatch"; reference: string }
  | { state: "unavailable"; reference: string | null };

export type AriFinalizationDecision<T> =
  | { state: "executed"; reference: string; value: T }
  | {
    state: "reconciliation_required";
    code: "RESULT_UNKNOWN" | "RECONCILIATION_REQUIRED";
  };

/**
 * The shared truth seam consumed by every Pass 4 domain adapter. A caller may
 * expose success only after both the domain receipt is durable and its
 * canonical readback matches. The receipt implementation itself remains #1972.
 */
export function decideAriFinalization<T>(
  receiptDurable: boolean,
  readback: AriReadbackResult<T>,
): AriFinalizationDecision<T> {
  if (!receiptDurable || readback.state === "unavailable") {
    return { state: "reconciliation_required", code: "RESULT_UNKNOWN" };
  }
  if (readback.state === "mismatch") {
    return {
      state: "reconciliation_required",
      code: "RECONCILIATION_REQUIRED",
    };
  }
  return {
    state: "executed",
    reference: readback.reference,
    value: readback.value,
  };
}

export type AriTelemetryPhase =
  | "received"
  | "authorized"
  | "dedupe_hit"
  | "dedupe_miss"
  | "model_start"
  | "model_end"
  | "proposal_committed"
  | "execution_claimed"
  | "domain_call"
  | "canonical_readback"
  | "terminal"
  | "reconciliation"
  | "response";

export interface AriTelemetryEvent {
  event: "ari_reliability";
  phase: AriTelemetryPhase;
  request_id: string;
  client_turn_id: string | null;
  execution_id: string | null;
  tenant_ref: string | null;
  capability_id: string | null;
  attempt: number;
  release_sha: string;
  function_version: string;
  operation_state: AriOperationState;
  duration_ms: number | null;
  error_code: AriErrorCode | null;
}

const ARI_TELEMETRY_PHASES = new Set<AriTelemetryPhase>([
  "received",
  "authorized",
  "dedupe_hit",
  "dedupe_miss",
  "model_start",
  "model_end",
  "proposal_committed",
  "execution_claimed",
  "domain_call",
  "canonical_readback",
  "terminal",
  "reconciliation",
  "response",
]);
const ARI_OPERATION_STATES = new Set<AriOperationState>([
  "none",
  "sending",
  "pending",
  "executing",
  "executed",
  "failed",
  "cancelled",
  "expired",
  "reconciliation_required",
]);
const TENANT_REF_PATTERN = /^brand:sha256:[0-9a-f]{8,64}$/;
const CAPABILITY_ID_PATTERN = /^ari\.[a-z0-9_.-]{1,120}$/;
const FUNCTION_VERSION_PATTERN = /^[a-zA-Z0-9_.:-]{1,128}$/;

function safeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/**
 * Reconstruct the event from a fixed runtime allowlist. TypeScript's structural
 * typing does not strip hostile extra keys, so both build and emit cross this
 * boundary before anything reaches logs/Sentry.
 */
function sanitizeAriTelemetryEvent(
  value: AriTelemetryEvent,
): AriTelemetryEvent {
  const errorCode = typeof value.error_code === "string" &&
      value.error_code in ARI_ERROR_REGISTRY
    ? value.error_code as AriErrorCode
    : null;
  const duration = typeof value.duration_ms === "number" &&
      Number.isFinite(value.duration_ms)
    ? Math.min(86_400_000, Math.max(0, Math.round(value.duration_ms)))
    : null;
  return {
    event: "ari_reliability",
    phase: ARI_TELEMETRY_PHASES.has(value.phase) ? value.phase : "response",
    request_id: safeUuid(value.request_id) ?? "invalid_request_id",
    client_turn_id: safeUuid(value.client_turn_id),
    execution_id: safeUuid(value.execution_id),
    tenant_ref: typeof value.tenant_ref === "string" &&
        TENANT_REF_PATTERN.test(value.tenant_ref)
      ? value.tenant_ref
      : null,
    capability_id: typeof value.capability_id === "string" &&
        CAPABILITY_ID_PATTERN.test(value.capability_id)
      ? value.capability_id
      : null,
    attempt: typeof value.attempt === "number" && Number.isFinite(value.attempt)
      ? Math.min(10_000, Math.max(1, Math.floor(value.attempt)))
      : 1,
    release_sha: typeof value.release_sha === "string" &&
        RELEASE_SHA_PATTERN.test(value.release_sha)
      ? value.release_sha.toLowerCase()
      : ARI_UNATTESTED_RELEASE,
    function_version: typeof value.function_version === "string" &&
        FUNCTION_VERSION_PATTERN.test(value.function_version)
      ? value.function_version
      : "unknown",
    operation_state: ARI_OPERATION_STATES.has(value.operation_state)
      ? value.operation_state
      : "none",
    duration_ms: duration,
    error_code: errorCode,
  };
}

export function buildAriTelemetryEvent(input: {
  phase: AriTelemetryPhase;
  context: AriEnvelopeContext;
  tenantRef?: string | null;
  capabilityId?: string | null;
  attempt?: number;
  operationState?: AriOperationState;
  durationMs?: number | null;
  errorCode?: AriErrorCode | null;
}): AriTelemetryEvent {
  return sanitizeAriTelemetryEvent({
    event: "ari_reliability",
    phase: input.phase,
    request_id: input.context.requestId,
    client_turn_id: input.context.clientTurnId ?? null,
    execution_id: input.context.executionId ?? null,
    tenant_ref: input.tenantRef ?? null,
    capability_id: input.capabilityId ?? null,
    attempt: Math.max(1, Math.floor(input.attempt ?? 1)),
    release_sha: input.context.release.release_sha,
    function_version: input.context.release.function_version,
    operation_state: input.operationState ?? "none",
    duration_ms: input.durationMs == null
      ? null
      : Math.max(0, Math.round(input.durationMs)),
    error_code: input.errorCode ?? null,
  });
}

export function emitAriTelemetry(event: AriTelemetryEvent): void {
  console.log(JSON.stringify(sanitizeAriTelemetryEvent(event)));
}

export interface AriCertificationRpcClient {
  rpc(
    functionName: "ari_cert_finalize_run",
    args: { p_run_id: string },
  ): Promise<{ data: unknown; error: unknown }>;
}

/**
 * Explicit certification control-plane caller. The database still requires
 * service_role and independently recorded PASS/cleanup/rollback evidence; this
 * adapter does not create or widen any authority.
 */
export async function finalizeAriCertificationRun(
  client: AriCertificationRpcClient,
  runId: string,
): Promise<unknown> {
  if (!UUID_PATTERN.test(runId)) {
    throw new TypeError("ari_cert_invalid_run_id");
  }
  const { data, error } = await client.rpc("ari_cert_finalize_run", {
    p_run_id: runId,
  });
  if (error) throw new Error("ari_cert_finalize_failed");
  return data;
}
