// issue #3526 M-1 — persist WHY a growth-tools run failed.
//
// WHY THIS EXISTS. `tool_leads` outlived the function logs: it is how we knew
// Gemini last succeeded on 2026-09-15 and failed six times after. But every
// failed row carried `status = 'failed'` and `report = NULL` — the table
// recorded THAT a run failed and never WHY. Google's actual error ("this model
// is no longer available to new users") was written to `function_logs` and then
// expired, so a four-day-old failure had no retrievable cause while the row
// proving it failed was still sitting there. Logs expire; rows do not.
//
// CONTRACT. `failure_reason` holds `{ stage, http_status, detail }` only:
// the provider status line and a truncated message. NEVER the request body,
// NEVER a key, NEVER PII. `detail` is truncated to 500 chars and scrubbed for
// key-shaped strings before it is stored.
//
// ACCESS. `tool_leads` is RLS deny-all with zero policies (I-1045-ANON-NO-SELECT),
// so the column is unreadable by anon and authenticated alike; only the
// service-role edge functions touch it. `growth-tools-report` additionally
// allowlists its select-list, and surfaces only `stage` — never `http_status`
// or `detail`.

/** Max stored length of the provider detail string. */
export const FAILURE_DETAIL_MAX = 500;

/** Which stage of the run failed. Safe to surface to an authenticated caller. */
export type ToolLeadFailureStage =
  | "config"
  | "research"
  | "synthesis"
  | "generate"
  | "timeout"
  | "budget_exhausted";

export interface ToolLeadFailure {
  stage: ToolLeadFailureStage;
  http_status: number | null;
  detail: string | null;
}

/**
 * A per-REQUEST capture slot for the last provider failure. Request-scoped on
 * purpose: a module-level mutable would bleed across the concurrent requests a
 * single Deno isolate serves.
 */
export interface ProviderFailureSink {
  last: ToolLeadFailure | null;
}

export function createProviderFailureSink(): ProviderFailureSink {
  return { last: null };
}

// Google API keys are `AIza` + 35 url-safe chars. A Gemini error body has never
// contained one, but the scrub is cheap and the column is durable — belt and
// braces beats discovering a leaked key in a table later. Also scrubs the
// `?key=` query param in case a URL is ever echoed back in an error string.
const KEY_SHAPED = /AIza[0-9A-Za-z_-]{10,}/g;
const KEY_QUERY_PARAM = /([?&]key=)[^&\s"'}]+/gi;

/** Truncate to FAILURE_DETAIL_MAX and strip anything key-shaped. */
export function scrubFailureDetail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const scrubbed = raw
    .replace(KEY_SHAPED, "[redacted]")
    .replace(KEY_QUERY_PARAM, "$1[redacted]")
    .trim();
  if (scrubbed.length === 0) return null;
  return scrubbed.slice(0, FAILURE_DETAIL_MAX);
}

export function buildToolLeadFailure(
  stage: ToolLeadFailureStage,
  httpStatus: number | null,
  detail: string | null | undefined,
): ToolLeadFailure {
  return {
    stage,
    http_status: Number.isSafeInteger(httpStatus) ? httpStatus : null,
    detail: scrubFailureDetail(detail),
  };
}

/** Record a provider failure into the request's sink (newest wins). */
export function recordProviderFailure(
  sink: ProviderFailureSink | undefined,
  stage: ToolLeadFailureStage,
  httpStatus: number | null,
  detail: string | null | undefined,
): void {
  if (!sink) return;
  sink.last = buildToolLeadFailure(stage, httpStatus, detail);
}

interface MinimalUpdateClient {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
    };
  };
}

/**
 * Mark a tool_leads row failed WITH its reason. Replaces the bare
 * `.update({ status: "failed" })` at all four growth-tools write sites.
 *
 * `failure` is never omitted: a config failure carries stage "config" with a
 * null http_status, so `failure_reason` is non-null on every failed row.
 */
export async function markToolLeadFailed(
  client: MinimalUpdateClient,
  runId: string,
  failure: ToolLeadFailure,
  logPrefix: string,
): Promise<void> {
  const { error } = await client
    .from("tool_leads")
    .update({ status: "failed", failure_reason: failure })
    .eq("id", runId);
  if (error) {
    // Constitution #3 — never swallow. The run already failed; losing the
    // reason too is the exact defect this module exists to end.
    console.error(`${logPrefix} failed-status update failed`, {
      message: error.message,
      stage: failure.stage,
    });
  }
}

/**
 * Pick the failure to store: a captured provider refusal beats the generic
 * fallback, because the provider's own words are what a later reader needs.
 */
export function resolveFailure(
  sink: ProviderFailureSink | undefined,
  fallbackStage: ToolLeadFailureStage,
  fallbackDetail: string,
): ToolLeadFailure {
  if (sink?.last) return sink.last;
  return buildToolLeadFailure(fallbackStage, null, fallbackDetail);
}
