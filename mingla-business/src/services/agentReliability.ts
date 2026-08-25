/**
 * Issue #2060 — platform-neutral Ari recovery state.
 *
 * Business web, iOS, and Android consume this one pure state machine. The
 * hot-path client (`agentChatService` / `useAgentChat`) imports and applies it
 * after #1985's task-state / client_turn_id and #1972's receipts landed.
 */

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

export interface AriResponseEnvelope<T = unknown> {
  protocol_version: 1;
  kind: "success" | "error";
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
  data?: T;
}

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

type AriErrorTuple = Readonly<{
  retryability: AriRetryability;
  safeToRetry: boolean;
  operationState: AriOperationState;
}>;

// Generated-contract mirror of the edge registry. The #2060 permanent gate
// compares both complete key/tuple sets, so neither side can drift silently.
export const ARI_CLIENT_ERROR_REGISTRY: Readonly<
  Record<AriErrorCode, AriErrorTuple>
> = Object.freeze({
  VALIDATION_FAILED: {
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
  },
  UNAUTHENTICATED: {
    retryability: "after_reauth",
    safeToRetry: false,
    operationState: "none",
  },
  FORBIDDEN: {
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
  },
  ROLE_REVOKED: {
    retryability: "after_reauth",
    safeToRetry: false,
    operationState: "none",
  },
  TENANT_MISMATCH: {
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
  },
  STALE_PROPOSAL: {
    retryability: "never",
    safeToRetry: false,
    operationState: "pending",
  },
  CONFLICT: {
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "pending",
  },
  RATE_LIMITED: {
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "none",
  },
  OFFLINE: {
    retryability: "after_reconnect",
    safeToRetry: true,
    operationState: "sending",
  },
  TRANSPORT_UNAVAILABLE: {
    retryability: "after_reconnect",
    safeToRetry: true,
    operationState: "sending",
  },
  PROVIDER_UNAVAILABLE: {
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "sending",
  },
  DEPENDENCY_UNAVAILABLE: {
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "sending",
  },
  DEADLINE_EXCEEDED: {
    retryability: "server_reconcile",
    safeToRetry: false,
    operationState: "reconciliation_required",
  },
  RESULT_UNKNOWN: {
    retryability: "server_reconcile",
    safeToRetry: false,
    operationState: "reconciliation_required",
  },
  RECONCILIATION_REQUIRED: {
    retryability: "server_reconcile",
    safeToRetry: false,
    operationState: "reconciliation_required",
  },
  MINIMUM_VERSION_REQUIRED: {
    retryability: "never",
    safeToRetry: false,
    operationState: "none",
  },
  INTERNAL: {
    retryability: "after_backoff",
    safeToRetry: true,
    operationState: "none",
  },
});

export const ARI_CLIENT_SUCCESS_REGISTRY = Object.freeze({
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

export type AriClientIntent = "send" | "confirm" | "cancel";
export type AriClientIntentState =
  | "ready"
  | "offline"
  | "in_flight"
  | "uncertain"
  | "awaiting_reauth"
  | "server_reconcile"
  | "terminal";

export interface AriClientIntentRecord {
  intent: AriClientIntent;
  stableId: string;
  conversationId: string | null;
  brandId: string | null;
  draftText: string | null;
  pendingActionId: string | null;
  argsVersion: number | null;
  state: AriClientIntentState;
  attempt: number;
  lastCode: string | null;
  retryAt: number | null;
}

export type AriRecoveryEvent =
  | { type: "dispatch_started" }
  | { type: "offline_detected" }
  | { type: "transport_uncertain"; code: string }
  | { type: "server_response"; envelope: AriResponseEnvelope }
  | { type: "retry_scheduled"; retryAt: number }
  | { type: "reauthorized" }
  | {
    type: "rehydrated";
    operationState: AriOperationState;
    code: string | null;
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELEASE_SHA_PATTERN = /^[0-9a-f]{40,64}$/i;
const RETRYABILITY = new Set<AriRetryability>([
  "never",
  "after_backoff",
  "after_reconnect",
  "after_reauth",
  "server_reconcile",
]);
const OPERATION_STATES = new Set<AriOperationState>([
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

export function createAriClientIntent(
  input: {
    intent: AriClientIntent;
    conversationId: string | null;
    brandId: string | null;
    draftText?: string | null;
    pendingActionId?: string | null;
    argsVersion?: number | null;
  },
  mintUuid: () => string = () => crypto.randomUUID(),
): AriClientIntentRecord {
  const existingExecutionId = input.intent === "send"
    ? null
    : input.pendingActionId;
  if (
    input.intent !== "send" &&
    (!existingExecutionId || !UUID_PATTERN.test(existingExecutionId))
  ) {
    throw new TypeError(
      "Ari confirm/cancel requires the authoritative pending action UUID",
    );
  }
  if (
    input.intent !== "send" &&
    (!Number.isInteger(input.argsVersion) || (input.argsVersion ?? 0) < 1)
  ) {
    throw new TypeError("Ari confirm/cancel requires a positive args version");
  }
  const stableId = input.intent === "send" ? mintUuid() : existingExecutionId!;
  if (!UUID_PATTERN.test(stableId)) {
    throw new TypeError("Ari stable ID must be a UUID");
  }
  return {
    intent: input.intent,
    stableId,
    conversationId: input.conversationId,
    brandId: input.brandId,
    draftText: input.draftText ?? null,
    pendingActionId: input.pendingActionId ?? null,
    argsVersion: input.argsVersion ?? null,
    state: "ready",
    attempt: 0,
    lastCode: null,
    retryAt: null,
  };
}

export function canDispatchAriIntent(
  record: AriClientIntentRecord,
  isConnected: boolean,
): { allowed: true } | {
  allowed: false;
  reason: "offline" | "in_flight" | "terminal" | "server_reconcile";
} {
  if (!isConnected) return { allowed: false, reason: "offline" };
  if (record.state === "in_flight") {
    return { allowed: false, reason: "in_flight" };
  }
  if (record.state === "awaiting_reauth") {
    return { allowed: false, reason: "in_flight" };
  }
  if (record.state === "server_reconcile") {
    return { allowed: false, reason: "server_reconcile" };
  }
  if (record.state === "terminal") {
    return { allowed: false, reason: "terminal" };
  }
  return { allowed: true };
}

function stateFromEnvelope(
  envelope: AriResponseEnvelope,
): AriClientIntentState {
  if (
    envelope.operation_state === "reconciliation_required" ||
    envelope.retryability === "server_reconcile"
  ) return "server_reconcile";
  if (envelope.retryability === "after_reauth") return "awaiting_reauth";
  if (envelope.retryability === "after_reconnect") return "offline";
  if (envelope.kind === "success" || envelope.retryability === "never") {
    return "terminal";
  }
  return "uncertain";
}

export function reduceAriClientIntent(
  current: AriClientIntentRecord,
  event: AriRecoveryEvent,
): AriClientIntentRecord {
  switch (event.type) {
    case "dispatch_started":
      if (
        current.state === "in_flight" || current.state === "terminal" ||
        current.state === "server_reconcile" ||
        current.state === "awaiting_reauth"
      ) return current;
      return {
        ...current,
        state: "in_flight",
        attempt: current.attempt + 1,
        retryAt: null,
      };
    case "offline_detected":
      return current.state === "terminal"
        ? current
        : { ...current, state: "offline", lastCode: "OFFLINE", retryAt: null };
    case "transport_uncertain":
      return current.state === "terminal" ? current : {
        ...current,
        state: "uncertain",
        lastCode: event.code,
        retryAt: null,
      };
    case "server_response":
      if (
        current.intent === "send" &&
        event.envelope.client_turn_id !== current.stableId
      ) {
        return {
          ...current,
          state: "uncertain",
          lastCode: "CORRELATION_MISMATCH",
          retryAt: null,
        };
      }
      if (
        current.intent !== "send" &&
        event.envelope.execution_id === null
      ) {
        return {
          ...current,
          state: "uncertain",
          lastCode: "CORRELATION_MISMATCH",
          retryAt: null,
        };
      }
      if (
        event.envelope.execution_id && current.intent !== "send" &&
        event.envelope.execution_id !== current.stableId &&
        event.envelope.execution_id !== current.pendingActionId
      ) {
        return {
          ...current,
          state: "uncertain",
          lastCode: "CORRELATION_MISMATCH",
          retryAt: null,
        };
      }
      return {
        ...current,
        state: stateFromEnvelope(event.envelope),
        lastCode: event.envelope.code,
        retryAt: null,
      };
    case "retry_scheduled":
      return current.state === "terminal" ||
          current.state === "server_reconcile" ||
          current.state === "awaiting_reauth" || current.state === "in_flight"
        ? current
        : { ...current, retryAt: event.retryAt };
    case "reauthorized":
      return current.state === "awaiting_reauth"
        ? { ...current, state: "ready", lastCode: null, retryAt: null }
        : current;
    case "rehydrated": {
      const terminal = ["executed", "failed", "cancelled", "expired"].includes(
        event.operationState,
      );
      const retryability = event.code && event.code in ARI_CLIENT_ERROR_REGISTRY
        ? ARI_CLIENT_ERROR_REGISTRY[event.code as AriErrorCode].retryability
        : null;
      const state: AriClientIntentState =
        event.operationState === "reconciliation_required"
          ? "server_reconcile"
          : event.operationState === "executing"
          ? "in_flight"
          : retryability === "after_reauth"
          ? "awaiting_reauth"
          : terminal
          ? "terminal"
          : "ready";
      return { ...current, state, lastCode: event.code, retryAt: null };
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function retryDelayMs(
  attempt: number,
  retryAfterSeconds?: number,
  random: () => number = Math.random,
): number {
  const serverFloor = Math.max(0, retryAfterSeconds ?? 0) * 1_000;
  const exponent = Math.min(6, Math.max(0, Math.floor(attempt) - 1));
  const cappedBase = Math.min(30_000, 1_000 * (2 ** exponent));
  const jitter = Math.floor(Math.max(0, Math.min(1, random())) * 500);
  return Math.max(serverFloor, cappedBase + jitter);
}

export function assertAriEnvelope(
  value: unknown,
  options: { allowUnattested?: boolean } = {},
): asserts value is AriResponseEnvelope {
  if (!value || typeof value !== "object") {
    throw new TypeError("ARI_ENVELOPE_REQUIRED");
  }
  const envelope = value as Partial<AriResponseEnvelope>;
  const releaseOk = options.allowUnattested
    ? typeof envelope.release_sha === "string" &&
      (RELEASE_SHA_PATTERN.test(envelope.release_sha) ||
        envelope.release_sha === "unattested")
    : typeof envelope.release_sha === "string" &&
      RELEASE_SHA_PATTERN.test(envelope.release_sha);
  const functionVersionOk = options.allowUnattested
    ? typeof envelope.function_version === "string" &&
      envelope.function_version.length > 0
    : typeof envelope.function_version === "string" &&
      envelope.function_version.length > 0 &&
      envelope.function_version !== "unknown";
  if (
    envelope.protocol_version !== 1 ||
    (envelope.kind !== "success" && envelope.kind !== "error") ||
    typeof envelope.code !== "string" || envelope.code.length === 0 ||
    typeof envelope.user_message !== "string" ||
    envelope.user_message.length === 0 ||
    !RETRYABILITY.has(envelope.retryability as AriRetryability) ||
    !OPERATION_STATES.has(envelope.operation_state as AriOperationState) ||
    typeof envelope.request_id !== "string" ||
    !UUID_PATTERN.test(envelope.request_id) ||
    (envelope.client_turn_id !== null &&
      (typeof envelope.client_turn_id !== "string" ||
        !UUID_PATTERN.test(envelope.client_turn_id))) ||
    (envelope.execution_id !== null &&
      (typeof envelope.execution_id !== "string" ||
        !UUID_PATTERN.test(envelope.execution_id))) ||
    !releaseOk ||
    !functionVersionOk ||
    typeof envelope.safe_to_retry !== "boolean" ||
    (envelope.retryability === "never" && envelope.safe_to_retry) ||
    (envelope.retryability === "server_reconcile" && envelope.safe_to_retry)
  ) {
    throw new TypeError("ARI_ENVELOPE_INVALID");
  }
  const tuple = envelope.kind === "error"
    ? ARI_CLIENT_ERROR_REGISTRY[envelope.code as AriErrorCode]
    : ARI_CLIENT_SUCCESS_REGISTRY[
      envelope.code as keyof typeof ARI_CLIENT_SUCCESS_REGISTRY
    ];
  if (
    !tuple || envelope.retryability !== tuple.retryability ||
    envelope.safe_to_retry !== tuple.safeToRetry ||
    envelope.operation_state !== tuple.operationState ||
    (envelope.kind === "error" && "data" in envelope)
  ) {
    throw new TypeError("ARI_ENVELOPE_INVALID");
  }
}
