import {
  APP_KEYS,
  OPERATING_SYSTEMS,
  READINESS_PROVIDERS,
} from "../_shared/adAppReadiness.ts";
import { responseHeaders } from "../admin-ad-app-readiness/handler.ts";

const EVENTS = [
  "readiness_viewed",
  "target_changed",
  "check_started",
  "check_completed",
  "action_opened",
  "retry",
  "detail_toggled",
];
const VERDICTS = ["ready", "action_required", "blocked", "stale"];
const DURATIONS = ["lt_1s", "1_3s", "3_10s", "10_30s", "30_60s", "timeout"];
const FRESHNESS = ["none", "current", "stale"];
const KEYS = [
  "event_name",
  "app_key",
  "os",
  "provider",
  "verdict",
  "reason_code",
  "duration_bucket",
  "freshness_bucket",
];

export function parseEvent(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (Object.keys(row).some((key) => !KEYS.includes(key))) return null;
  if (
    !EVENTS.includes(String(row.event_name)) ||
    !APP_KEYS.includes(row.app_key as never) ||
    !OPERATING_SYSTEMS.includes(row.os as never)
  ) return null;
  if (
    row.provider != null && !READINESS_PROVIDERS.includes(row.provider as never)
  ) return null;
  if (row.verdict != null && !VERDICTS.includes(String(row.verdict))) {
    return null;
  }
  if (
    row.reason_code != null &&
    (typeof row.reason_code !== "string" ||
      !/^[a-z0-9_]{1,64}$/.test(row.reason_code))
  ) return null;
  if (
    row.duration_bucket != null &&
    !DURATIONS.includes(String(row.duration_bucket))
  ) return null;
  if (
    row.freshness_bucket != null &&
    !FRESHNESS.includes(String(row.freshness_bucket))
  ) return null;
  return Object.fromEntries(
    KEYS.filter((key) => row[key] != null).map((key) => [key, row[key]]),
  );
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

export async function handleReadinessEvent(request: Request, deps: {
  authorize(
    header: string,
  ): Promise<
    | { status: "authorized"; actor: string }
    | { status: "unauthorized" }
    | { status: "forbidden" }
  >;
  insert(row: Record<string, unknown>): Promise<void>;
}) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: responseHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);
  const auth = await deps.authorize(authorization);
  if (auth.status === "unauthorized") {
    return json({ error: "unauthorized" }, 401);
  }
  if (auth.status === "forbidden") return json({ error: "forbidden" }, 403);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2048) {
    return json({ error: "invalid_request" }, 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const event = parseEvent(body);
  if (!event) return json({ error: "invalid_request" }, 400);
  try {
    await deps.insert({ ...event, actor: auth.actor });
    return new Response(null, { status: 204, headers: responseHeaders });
  } catch {
    console.warn(
      JSON.stringify({
        event: "ad_app_readiness_event_insert_failed",
        http_class: "5xx",
      }),
    );
    return new Response(null, { status: 204, headers: responseHeaders });
  }
}
