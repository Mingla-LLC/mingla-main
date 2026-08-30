import type { PayloadRequest } from "payload";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODES = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_STATE",
  "VALIDATION_FAILED",
  "REVISION_CONFLICT",
  "SESSION_EXPIRED",
  "MEDIA_REJECTED",
  "MEDIA_PROCESSING",
  "SERVICE_TEMPORARILY_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
]);

type CmsHandler = (request: PayloadRequest) => Promise<Response>;

function safeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function envelopeIds(request: PayloadRequest): {
  operationId: string | null;
  siteId: string | null;
} {
  const raw = request.headers.get("x-mingla-sites-envelope");
  if (!raw || raw.length > 16_384) return { operationId: null, siteId: null };
  try {
    const value = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as
      Record<string, unknown>;
    return {
      operationId: safeUuid(value.operation_id),
      siteId: safeUuid(value.site_id),
    };
  } catch {
    return { operationId: null, siteId: null };
  }
}

async function responseCode(response: Response): Promise<string | null> {
  try {
    const value = (await response.clone().json()) as {
      error?: { code?: unknown };
    };
    const code = value?.error?.code;
    return typeof code === "string" && SAFE_CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}

export type CmsObservation = {
  event: "mingla_sites_request" | "mingla_sites_state";
  metric: string;
  request_id: string;
  operation_id: string | null;
  site_id: string | null;
  publication_id: string | null;
  direction: string;
  route: string;
  state_transition: string;
  latency_ms: number;
  retry_count: number;
  safe_error_code: string | null;
  status_code: number | null;
  version: "sites-v1";
};

export function emitCmsObservation(observation: CmsObservation): void {
  console.info(JSON.stringify(observation));
}

export function observeCmsEndpoint(
  route: string,
  direction: "customer_to_cms" | "core_to_cms" | "studio_to_cms",
  handler: CmsHandler,
): CmsHandler {
  if (!/^\/[A-Za-z0-9_{}:/.-]{1,240}$/.test(route)) {
    throw new Error("INVALID_OBSERVABILITY_ROUTE");
  }
  return async (request) => {
    const startedAt = performance.now();
    const requestId = safeUuid(request.headers.get("x-request-id")) ??
      crypto.randomUUID();
    const ids = envelopeIds(request);
    const user = request.user as
      | { siteId?: unknown }
      | null
      | undefined;
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      emitCmsObservation({
        event: "mingla_sites_request",
        metric: "cms.request.5xx",
        request_id: requestId,
        operation_id: ids.operationId,
        site_id: ids.siteId ?? safeUuid(user?.siteId),
        publication_id: null,
        direction,
        route,
        state_transition: "request_started->request_failed",
        latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        retry_count: 0,
        safe_error_code: "SERVICE_TEMPORARILY_UNAVAILABLE",
        status_code: 500,
        version: "sites-v1",
      });
      throw error;
    }
    const safeCode = await responseCode(response);
    emitCmsObservation({
      event: "mingla_sites_request",
      metric: `cms.request.${Math.floor(response.status / 100)}xx`,
      request_id: requestId,
      operation_id: ids.operationId,
      site_id: ids.siteId ?? safeUuid(user?.siteId),
      publication_id: null,
      direction,
      route,
      state_transition: `request_started->${response.ok ? "request_succeeded" : "request_rejected"}`,
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      retry_count: 0,
      safe_error_code: safeCode,
      status_code: response.status,
      version: "sites-v1",
    });
    const headers = new Headers(response.headers);
    headers.set("x-mingla-request-id", requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
