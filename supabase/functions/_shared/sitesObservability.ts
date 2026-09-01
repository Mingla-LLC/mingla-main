const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_ROUTE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

const SAFE_CODES = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_STATE",
  "VALIDATION_FAILED",
  "REVISION_CONFLICT",
  "SESSION_EXPIRED",
  "OPERATION_IN_PROGRESS",
  "PUBLISH_FAILED_LAST_GOOD_PRESERVED",
  "MEDIA_REJECTED",
  "MEDIA_PROCESSING",
  "SERVICE_TEMPORARILY_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "SIGNATURE_INVALID",
  "REPLAY_DETECTED",
  "TENANT_MISMATCH",
  "ARTIFACT_DIGEST_MISMATCH",
  "PROBE_FAILED",
  "CALLBACK_AMBIGUOUS",
  "STORAGE_UNAVAILABLE",
  "CORE_UNAVAILABLE",
]);

type SitesDirection =
  | "customer_to_core"
  | "runtime_to_core"
  | "cms_to_core"
  | "public_to_core";

type SignedIdentifiers = {
  operationId?: string;
  siteId?: string;
};

function safeUuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : undefined;
}

function signedIdentifiers(req: Request): SignedIdentifiers {
  const raw = req.headers.get("x-mingla-sites-envelope");
  if (!raw || raw.length > 16_384) return {};
  try {
    const envelope = JSON.parse(atob(raw)) as Record<string, unknown>;
    return {
      operationId: safeUuid(envelope.operation_id),
      siteId: safeUuid(envelope.site_id),
    };
  } catch {
    return {};
  }
}

export function safeSitesRoute(req: Request, service: string): string {
  const pathname = new URL(req.url).pathname;
  const marker = `/${service}`;
  const markerIndex = pathname.indexOf(marker);
  const relative = markerIndex >= 0
    ? pathname.slice(markerIndex + marker.length) || "/"
    : "/";
  const normalized = relative.replace(UUID_IN_ROUTE, "{id}");
  return /^\/[A-Za-z0-9_{}./-]{0,240}$/.test(normalized)
    ? normalized
    : "/invalid-route";
}

async function safeResponseCode(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json() as {
      error?: { code?: unknown };
    };
    const code = payload?.error?.code;
    return typeof code === "string" && SAFE_CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}

export async function observeSitesRequest(
  req: Request,
  input: {
    service: string;
    direction: SitesDirection;
    handler: (request: Request) => Promise<Response>;
  },
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = safeUuid(req.headers.get("x-request-id")) ??
    crypto.randomUUID();
  const identifiers = signedIdentifiers(req);
  const route = safeSitesRoute(req, input.service);
  let response: Response;
  try {
    response = await input.handler(req);
  } catch (error) {
    console.info(JSON.stringify({
      event: "mingla_sites_request",
      metric: `${input.service}.request.5xx`,
      request_id: requestId,
      operation_id: identifiers.operationId ?? null,
      site_id: identifiers.siteId ?? null,
      publication_id: null,
      direction: input.direction,
      route,
      state_transition: "request_started->request_failed",
      latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      retry_count: 0,
      safe_error_code: "SERVICE_TEMPORARILY_UNAVAILABLE",
      status_code: 500,
      version: "sites-v1",
    }));
    throw error;
  }
  const safeCode = await safeResponseCode(response);
  console.info(JSON.stringify({
    event: "mingla_sites_request",
    metric: `${input.service}.request.${Math.floor(response.status / 100)}xx`,
    request_id: requestId,
    operation_id: identifiers.operationId ?? null,
    site_id: identifiers.siteId ?? null,
    publication_id: null,
    direction: input.direction,
    route,
    state_transition: `request_started->${
      response.ok ? "request_succeeded" : "request_rejected"
    }`,
    latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    retry_count: 0,
    safe_error_code: safeCode,
    status_code: response.status,
    version: "sites-v1",
  }));
  const headers = new Headers(response.headers);
  headers.set("x-mingla-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
