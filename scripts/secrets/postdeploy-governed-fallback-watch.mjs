#!/usr/bin/env node
/**
 * Post-deploy governed-bundle fallback watch (#2241).
 *
 * WHY THIS EXISTS
 * ---------------
 * `assertLiveNameParity` used to refuse every NORMAL deploy while the approved
 * two-name migration band was still live in production. The strictness was not
 * arbitrary: while a direct fallback name still exists, a function can pass
 * every static check by silently reading the OLD standalone copy, and the gap
 * only surfaces later, when that copy is deleted. Refusing the deploy was a
 * blunt way of holding that risk.
 *
 * The band is now TOLERATED in normal mode (deploys ship again), so the risk it
 * was holding has to be OBSERVED instead of assumed away. It is directly
 * observable: `supabase/functions/_shared/governedAdSecret.ts` emits
 * `governed_ad_legacy_fallback` (and `governed_ad_bundle_invalid`) exactly when
 * a reader falls back to a direct name. `docs/runbooks/SUPABASE_SECRET_CAPACITY.md`
 * already instructs a human to "stop on any fallback or invalid-bundle
 * diagnostic"; this script is that instruction, executed by the deploy job.
 *
 * A relaxation with no replacement observation is the #2113 shape. This is the
 * replacement observation.
 *
 * FAIL-CLOSED
 * -----------
 * A check that cannot fail is worse than no check. Every way of NOT observing
 * production is a failure here, not a skip: no credential, a non-200, an
 * unreadable body, non-integer counts, or an empty window. A zero is only
 * reported alongside its denominator (`scanned=`), so "no fallback" can never
 * be a count nobody took.
 *
 * VALUE-BLIND
 * -----------
 * Like every other script in this directory, this module never emits a secret
 * value, digest, prefix, suffix or length. The query returns COUNTS ONLY —
 * `event_message` is aggregated inside the analytics engine and no raw log line
 * ever enters this process.
 */

import { pathToFileURL } from "node:url";

const LOGS_ENDPOINT = "analytics/endpoints/logs";
const PROJECT_REF = /^[a-z]{20}$/;
const FALLBACK_EVENT = "governed_ad_legacy_fallback";
const INVALID_EVENT = "governed_ad_bundle_invalid";

/**
 * 60 minutes, not the API's 24-hour maximum. Long enough that production edge
 * traffic gives the count a real denominator; short enough that a fallback that
 * has actually been fixed clears the gate within the hour instead of blocking
 * deploys for a day. The API rejects a range over 24 hours outright.
 */
export const DEFAULT_WINDOW_MINUTES = 60;
const MAX_WINDOW_MINUTES = 1440;

export class FallbackWatchError extends Error {
  constructor(code, details = []) {
    super(code);
    this.name = "FallbackWatchError";
    this.code = code;
    this.details = [...new Set(details)].sort();
  }
}

/**
 * ClickHouse SQL against the unified `logs` table. `edge_logs` is included so
 * the row count is a genuine denominator: it proves production served edge
 * traffic in the window even when no function wrote a console line. The two
 * diagnostic strings only ever appear in `function_logs`.
 */
export function buildWatchQuery() {
  return [
    "select count() as total_rows,",
    "countIf(source = 'function_logs') as function_log_rows,",
    `countIf(position(event_message, '${FALLBACK_EVENT}') > 0)`,
    "as legacy_fallback,",
    `countIf(position(event_message, '${INVALID_EVENT}') > 0)`,
    "as bundle_invalid",
    "from logs",
    "where source in ('edge_logs', 'function_logs')",
  ].join(" ");
}

function exactCount(value, field) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : null;
  if (parsed === null || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new FallbackWatchError("watch_response_invalid", [field]);
  }
  return parsed;
}

/**
 * Pure verdict over the reduced counts. Separated so the regression suite can
 * exercise every branch with no network and no credential.
 */
export function evaluateFallbackWatch(row) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new FallbackWatchError("watch_response_invalid", ["row"]);
  }
  const counts = {
    bundleInvalid: exactCount(row.bundle_invalid, "bundle_invalid"),
    functionLogRows: exactCount(row.function_log_rows, "function_log_rows"),
    legacyFallback: exactCount(row.legacy_fallback, "legacy_fallback"),
    totalRows: exactCount(row.total_rows, "total_rows"),
  };
  // A zero needs its denominator. An empty window observed nothing, so it
  // cannot report "no fallback" — it reports that it could not look.
  if (counts.totalRows === 0) {
    throw new FallbackWatchError("log_window_empty");
  }
  const details = [];
  if (counts.legacyFallback > 0) details.push(FALLBACK_EVENT);
  if (counts.bundleInvalid > 0) details.push(INVALID_EVENT);
  if (details.length > 0) {
    throw new FallbackWatchError("governed_ad_fallback_observed", details);
  }
  return counts;
}

function isoMinute(ms) {
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
}

export async function runGovernedFallbackWatch({
  projectRef,
  windowMinutes = DEFAULT_WINDOW_MINUTES,
  accessToken = process.env.SUPABASE_ACCESS_TOKEN,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
} = {}) {
  if (typeof projectRef !== "string" || !PROJECT_REF.test(projectRef)) {
    throw new FallbackWatchError("watch_project_ref_invalid");
  }
  if (
    !Number.isSafeInteger(windowMinutes) ||
    windowMinutes < 1 ||
    windowMinutes > MAX_WINDOW_MINUTES
  ) {
    throw new FallbackWatchError("watch_window_invalid");
  }
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new FallbackWatchError("watch_access_token_missing");
  }
  if (typeof fetchImpl !== "function") {
    throw new FallbackWatchError("watch_transport_unavailable");
  }

  const url = new URL(
    `https://api.supabase.com/v1/projects/${projectRef}/${LOGS_ENDPOINT}`,
  );
  url.searchParams.set("sql", buildWatchQuery());
  url.searchParams.set(
    "iso_timestamp_start",
    isoMinute(nowMs - windowMinutes * 60000),
  );
  url.searchParams.set("iso_timestamp_end", isoMinute(nowMs));

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    });
  } catch {
    // The transport error text can quote the request; it is never surfaced.
    throw new FallbackWatchError("watch_request_failed", ["transport"]);
  }
  if (!response?.ok) {
    throw new FallbackWatchError("watch_request_failed", [
      `status:${response?.status ?? "unknown"}`,
    ]);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new FallbackWatchError("watch_response_invalid", ["body"]);
  }
  if (typeof body?.error === "string" && body.error.length > 0) {
    throw new FallbackWatchError("watch_query_error");
  }
  if (!Array.isArray(body?.result) || body.result.length !== 1) {
    throw new FallbackWatchError("watch_response_invalid", ["result"]);
  }
  return { ...evaluateFallbackWatch(body.result[0]), windowMinutes };
}

export function parseWatchArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--project-ref") args.projectRef = argv[++index];
    else if (value === "--window-minutes") {
      args.windowMinutes = Number(argv[++index]);
    } else throw new FallbackWatchError("argument_invalid", [value]);
  }
  return args;
}

async function main() {
  try {
    const args = parseWatchArgs(process.argv.slice(2));
    const result = await runGovernedFallbackWatch({
      projectRef: args.projectRef,
      windowMinutes: args.windowMinutes ?? DEFAULT_WINDOW_MINUTES,
    });
    console.log(
      `PASS governed-fallback-watch window=${result.windowMinutes}m ` +
        `scanned=${result.totalRows} function_log_rows=${result.functionLogRows} ` +
        `${FALLBACK_EVENT}=${result.legacyFallback} ` +
        `${INVALID_EVENT}=${result.bundleInvalid}`,
    );
  } catch (error) {
    const code = error instanceof FallbackWatchError
      ? error.code
      : "watch_failed";
    console.error(`FAIL governed-fallback-watch ${code}`);
    if (error instanceof FallbackWatchError) {
      for (const detail of error.details) console.error(`- ${detail}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
