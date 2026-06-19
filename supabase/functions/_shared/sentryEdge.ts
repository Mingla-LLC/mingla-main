/**
 * #426 G3 — lightweight Sentry capture for Supabase edge functions.
 *
 * Set `SENTRY_DSN` (or `SUPABASE_SENTRY_DSN`) as a project secret. Fire-and-forget
 * so error reporting never blocks the response path.
 */

export interface EdgeSentryContext {
  fn?: string;
  requestId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    const publicKey = url.username;
    if (!publicKey || !projectId) return null;
    return { publicKey, host: url.host, projectId };
  } catch {
    return null;
  }
}

function resolveDsn(): string | null {
  const dsn = Deno.env.get("SENTRY_DSN") ?? Deno.env.get("SUPABASE_SENTRY_DSN");
  return dsn && dsn.length > 0 ? dsn : null;
}

function stackFrames(stack: string): Array<{ filename?: string; function?: string }> {
  return stack
    .split("\n")
    .slice(1, 6)
    .map((line) => {
      const trimmed = line.trim();
      const match = trimmed.match(/at (.+?) \((.+)\)/) ??
        trimmed.match(/at (.+)/);
      if (!match) return { function: trimmed };
      if (match.length >= 3) {
        return { function: match[1], filename: match[2] };
      }
      return { function: match[1] };
    });
}

export function captureEdgeException(
  error: unknown,
  context: EdgeSentryContext = {},
): void {
  const dsn = resolveDsn();
  if (!dsn) return;

  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = crypto.randomUUID().replace(/-/g, "");

  const event = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "edge",
    tags: {
      runtime: "supabase-edge",
      ...(context.fn ? { fn: context.fn } : {}),
      ...(context.tags ?? {}),
    },
    extra: {
      requestId: context.requestId,
      ...(context.extra ?? {}),
    },
    exception: {
      values: [{
        type: err.name || "Error",
        value: err.message,
        stacktrace: err.stack ? { frames: stackFrames(err.stack) } : undefined,
      }],
    },
  };

  const sentryAuth =
    `Sentry sentry_version=7, sentry_client=mingla-edge/1.0, sentry_key=${parsed.publicKey}`;

  void fetch(`https://${parsed.host}/api/${parsed.projectId}/store/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": sentryAuth,
    },
    body: JSON.stringify(event),
  }).catch(() => {
    // Never throw from telemetry
  });
}

/** @internal Test hook */
export function __parseDsnForTest(dsn: string): ParsedDsn | null {
  return parseDsn(dsn);
}
