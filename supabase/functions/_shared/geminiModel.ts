// issue #3526 — THE single source of truth for which Gemini model we call,
// what it costs, and where it lives.
//
// WHY THIS FILE EXISTS. On 2026-09-17 Google closed Gemini 2.5 Flash to
// callers without prior usage history. Ten production files named that model
// as a bare string literal, so every Gemini-powered surface went down at once
// (growth tools, place intelligence, the competitor brief worker, Ari) and the
// fix was a 28-file sweep. The next retirement is a one-line change to this
// file. Gate `.github/scripts/strict-grep/i-3526-gemini-model-single-source.mjs`
// keeps it that way: no file under supabase/functions/ except this one may
// carry a raw `gemini-<major>.<minor>-flash` literal outside a comment.
//
// WHY 3.6 AND NOT THE NEWER FLASH MODELS. `gemini-3.7-flash` and
// `gemini-3.8-flash` are stable and cost exactly the same, but their
// `thinking_level` only goes down to `low`. `competitor-intel-worker` has a
// 15s synthesis timeout and a 1,200-token output cap, both sized for a
// non-thinking model, and only `gemini-3.6-flash` still supports `minimal`.
// That is load-bearing — do not "upgrade" to a newer flash without re-sizing
// SYNTHESIS_TIMEOUT_MS and MAX_SYNTHESIS_OUTPUT_TOKENS first.
//
// THINKING. Gemini 3 removed `thinkingBudget` and replaced it with
// `thinking_level`. A Gemini 3 model that receives no thinking config defaults
// to `medium` and bills the thinking tokens as output — so every call site
// sets GEMINI_THINKING_LEVEL_MINIMAL explicitly rather than inheriting.

export const GEMINI_MODEL_ID = "gemini-3.6-flash";

// Stamped next to actual_microusd on every competitor-intel job row. Its whole
// job is to tell a later reader WHICH rate card produced a stored cost, so it
// must be bumped in the same change as the rates below — otherwise a $0.30-rate
// row and a $0.75-rate row become indistinguishable.
export const GEMINI_PRICING_VERSION = "gemini-3.6-flash-standard-2026-09";

// Published rates, https://ai.google.dev/gemini-api/docs/pricing (2026-09-21):
//   input  $0.75 / 1M   (was $0.30 on 2.5-flash — 2.5x)
//   output $3.75 / 1M   (was $2.50 on 2.5-flash — 1.5x), THINKING TOKENS INCLUDED.
//
// ⚠ 2027-01-01: Google doubles both — input $1.50 / 1M, output $7.50 / 1M.
// That needs a second bump here, a PRICING_VERSION bump to `-2027-01`, and a
// re-measurement of PER_PLACE_COST_USD in run-place-intelligence-trial. Tracked
// as OQ-1 on issue #3526.
//
// Per TOKEN (not per million) for arithmetic convenience, matching the
// long-standing convention in _shared/photoAestheticEnums.ts PRICING.
export const GEMINI_INPUT_USD_PER_TOKEN = 0.75 / 1_000_000;
export const GEMINI_OUTPUT_USD_PER_TOKEN = 3.75 / 1_000_000;

// Same rates expressed in microUSD per token, for the integer-microUSD
// accounting in competitor-intel-worker (Math.ceil over microUSD).
export const GEMINI_INPUT_MICROUSD_PER_TOKEN = 0.75;
export const GEMINI_OUTPUT_MICROUSD_PER_TOKEN = 3.75;

export const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

// `generationConfig.thinkingConfig.thinking_level` — the Gemini 3 replacement
// for `thinkingConfig.thinkingBudget`. "minimal" is the floor on 3.6-flash and
// preserves the cost and latency shape every one of our call sites was sized
// for. Kept as a named constant so a call site cannot silently drift to a
// different level.
export const GEMINI_THINKING_LEVEL_MINIMAL = "minimal";

/** Full `:generateContent` URL for the pinned model. Never build this inline. */
export function geminiGenerateContentUrl(
  modelId: string = GEMINI_MODEL_ID,
): string {
  return `${GEMINI_API_BASE}/${modelId}:generateContent`;
}

// ── issue #3526 M-3/M-4 — provider error fingerprints ───────────────────────
//
// Google returns `{ "error": { "code": 404, "status": "NOT_FOUND", "message": … } }`.
// `api_health_observations.error_code` is what `matchClassBDepletion` tests with
// `field:"type"`, so the fingerprint has to be CAPTURED for every refusal class
// we care about — not just 429. Before #3526 both Ari call sites populated
// `error_code` ONLY on 429, which meant a widened matcher would still have had
// nothing to match on the 403 (17 Sep) or the 404 (21 Sep).

/** Google's machine-readable `error.status`, e.g. NOT_FOUND / PERMISSION_DENIED. */
export function parseGeminiErrorStatus(body: string): string | null {
  try {
    const status = (JSON.parse(body) as { error?: { status?: unknown } })?.error
      ?.status;
    return typeof status === "string" && status.length > 0 ? status : null;
  } catch {
    return null; // non-JSON body (proxy/HTML error page)
  }
}

/**
 * Build the `recordApiCall` error fingerprint for a failed Gemini response.
 * Returns undefined only when there is genuinely nothing to record.
 */
export function geminiErrorFingerprint(
  httpStatus: number,
  body: string,
): { code?: string; text?: string } | undefined {
  const parsed = parseGeminiErrorStatus(body);
  // Keep the historical default for 429 so the pre-existing
  // {429, RESOURCE_EXHAUSTED} depletion fingerprint still matches on a
  // non-JSON body.
  const code = parsed ?? (httpStatus === 429 ? "RESOURCE_EXHAUSTED" : null);
  if (!code && !body) return undefined;
  return {
    ...(code ? { code } : {}),
    ...(body ? { text: body.slice(0, 300) } : {}),
  };
}
