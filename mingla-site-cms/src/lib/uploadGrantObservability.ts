import type { PayloadRequest } from "payload";
import { emitCmsObservation } from "./observability";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODES = new Set([
  "FORBIDDEN",
  "INVALID_STATE",
  "VALIDATION_FAILED",
  "SESSION_EXPIRED",
  "MEDIA_REJECTED",
]);

export type UploadGrantStage =
  | "mutation_assertion"
  | "session_binding"
  | "body_parsing"
  | "grant_creation"
  | "grant_media_create"
  | "grant_media_create_hook_preflight"
  | "grant_media_create_core_authorize"
  | "grant_media_create_core_authorized"
  | "grant_media_create_access"
  | "grant_media_update"
  | "grant_presign";

function safeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

export function observeUploadGrantFailure(
  request: PayloadRequest,
  stage: UploadGrantStage,
  error: unknown,
): void {
  const rawCode = error instanceof Error ? error.message : "";
  const safeCode = SAFE_ERROR_CODES.has(rawCode)
    ? rawCode
    : "SERVICE_TEMPORARILY_UNAVAILABLE";
  const user = request.user as { siteId?: unknown } | null | undefined;

  emitCmsObservation({
    event: "mingla_sites_state",
    metric: "cms.media.upload_grant_failure",
    request_id: safeUuid(request.headers.get("x-request-id")) ??
      crypto.randomUUID(),
    operation_id: null,
    site_id: safeUuid(user?.siteId),
    publication_id: null,
    direction: "studio_to_cms",
    route: "/mingla/media/upload-grants",
    state_transition: `upload_grant_${stage}->request_rejected`,
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: safeCode,
    status_code: safeCode === "FORBIDDEN" || safeCode === "SESSION_EXPIRED"
      ? 403
      : safeCode === "SERVICE_TEMPORARILY_UNAVAILABLE"
        ? 503
        : 409,
    version: "sites-v1",
  });
}
