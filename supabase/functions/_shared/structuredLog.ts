/**
 * #426 — Structured JSON logging for edge functions.
 *
 * Emits one JSON line per event for Supabase log drains. Errors also forward to
 * Sentry when SENTRY_DSN is configured (#426 G3).
 */

import { captureEdgeException } from "./sentryEdge.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogFields {
  fn?: string;
  requestId?: string;
  durationMs?: number;
  userId?: string;
  brandId?: string;
  err?: string;
  [key: string]: unknown;
}

export function structuredLog(
  level: LogLevel,
  message: string,
  fields: StructuredLogFields = {},
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(payload);
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export function logError(
  message: string,
  error: unknown,
  fields: StructuredLogFields = {},
): void {
  const err =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  structuredLog("error", message, { ...fields, err });
  if (error instanceof Error) {
    captureEdgeException(error, {
      fn: fields.fn,
      requestId: fields.requestId,
      extra: { message, ...fields },
    });
  }
}

/**
 * Top-level edge handler wrapper — logs structured JSON on uncaught throws.
 * Returns `onError` response when provided; otherwise a generic 500.
 */
export function wrapEdgeHandler(
  fnName: string,
  handler: (req: Request) => Promise<Response>,
  options?: {
    onError?: (error: unknown, requestId: string) => Response;
  },
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    try {
      return await handler(req);
    } catch (error) {
      logError(`${fnName} unhandled`, error, {
        fn: fnName,
        requestId,
        durationMs: Date.now() - started,
      });
      if (options?.onError) {
        return options.onError(error, requestId);
      }
      return new Response(
        JSON.stringify({ error: "internal_error", requestId }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}
