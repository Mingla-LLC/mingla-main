/**
 * ORCH-1218 [venue-authoring vendor-error scrub] — the single-owner client-side
 * sanitizer for venue auto-authoring user-facing error messages.
 *
 * WHY: Seth's standing intent is that business users must NEVER learn which AI
 * technology powers Mingla (ORCH-1217 established this for the Ari co-pilot
 * copy; this is the second leak the 1217 tester found). The venue
 * auto-authoring pipeline (edge fn `run-business-place-authoring-pipeline`) can
 * fail and rethrow a raw reason string that contains our AI vendor's name
 * (`gemini_failed:429:...`, `gemini_incomplete_coverage:...`, `gemini_empty`,
 * etc.). That raw string was rendered verbatim to the venue operator in
 * `VenueCreatorWizard`. This function maps any AI-vendor-tagged reason to a
 * generic, human, per-code message BEFORE it reaches `setMessage`/`setSubmitErr`.
 *
 * The RAW code is untouched server-side (edge fn `console.error` +
 * `brand_place_pipeline_state.last_error_message`) for debugging — this is a
 * UI-boundary scrub ONLY. Non-vendor reasons (`tier2_pipeline_failed`,
 * `place_pool_link_missing`, network errors, the "Google location" geocoding
 * branch) pass through UNCHANGED so the venue operator still sees the useful
 * real reason (preserves META-ORCH-1009 Sub-E B6 intent).
 *
 * Enforced by `.github/scripts/strict-grep/orch-1218-venue-authoring-no-vendor-leak.mjs`
 * (I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK).
 */

// The one generic message for any AI-stage failure that does not have a more
// specific mapping (and the catch-all for unknown/new vendor tokens).
const GENERIC_AI_FAILURE =
  "Mingla's AI couldn't finish setting up your listing. Please try again.";

/**
 * Forbidden AI-vendor tokens (word-boundaried, case-insensitive). MUST mirror
 * the strict-grep gate's token list. NOTE: the `\bgoogle\s+ai\b` pattern is
 * deliberately narrow so the legitimate "Google location" geocoding message is
 * NOT treated as a vendor disclosure and passes through unchanged. No broad
 * `\bgoogle\b` rule is added here.
 *
 * Each token requires a leading word boundary and is NOT followed by another
 * letter — `(?![a-z])` — so the bare word AND the underscore-suffixed code form
 * (`openai_overloaded`, `claude_timeout`) both match, but a longer word that
 * merely starts with the token (`openait`, `claudette`) does not. A trailing
 * `\b` would miss `openai_…` because `_` is a word char (no boundary there).
 *
 * strict-grep-allow: vendor-token-list
 */
const FORBIDDEN_VENDOR_TOKENS: readonly RegExp[] = [
  /\bgemini(?![a-z])/i,
  /\bopenai(?![a-z])/i,
  /\banthropic(?![a-z])/i,
  /\bclaude(?![a-z])/i,
  /\bgpt-/i,
  /\bgoogle\s+ai(?![a-z])/i,
  /\bvertex\s+ai(?![a-z])/i,
  /\bbard(?![a-z])/i,
  /\bllama(?![a-z])/i,
  /\bmistral(?![a-z])/i,
];

/**
 * Per-code mapping table. `[rawCodePrefix, userMessage]`. The raw code prefixes
 * legitimately name the AI vendor (they match the edge fn's emitted reason) but
 * are NEVER returned to the user — only the right-hand `userMessage` is. Ordered
 * longest/most-specific prefix FIRST so `gemini_failed:429` is matched before the
 * bare `gemini_failed`. The vendor-token strings on the left live in this
 * sentinel-exempted block (they are matching keys, not user copy).
 *
 * strict-grep-allow: vendor-token-list
 */
const CODE_MESSAGE_TABLE: readonly (readonly [string, string])[] = [
  [
    "gemini_failed:429",
    "Mingla's AI is busy right now. Please wait a moment and try again.",
  ],
  [
    "gemini_unconfigured",
    "Mingla's AI isn't available right now. Please try again shortly.",
  ],
  ["gemini_empty", "Mingla's AI didn't return a result. Please try again."],
  [
    "gemini_unparseable_json",
    "Mingla's AI returned an unexpected result. Please try again.",
  ],
  ["gemini_missing_evaluations", GENERIC_AI_FAILURE],
  ["gemini_incomplete_coverage", GENERIC_AI_FAILURE],
  ["gemini_missing_signal", GENERIC_AI_FAILURE],
  // Any other gemini_failed status (incl. bare) — AFTER the 429 entry above.
  ["gemini_failed", GENERIC_AI_FAILURE],
];

const USER_SAFE_SERVER_MESSAGES: Readonly<Record<string, string>> = {
  forbidden:
    "You don't have permission to submit venues for this brand. Ask a brand owner to update your role.",
};

function authoringErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err !== "object" || err === null || !("message" in err)) {
    return "";
  }
  return typeof err.message === "string" ? err.message : "";
}

/**
 * Map a raw venue-authoring error to a user-safe message.
 *
 * @param err      The caught error (unknown — may be an Error, null, or any).
 * @param fallback The existing per-call fallback used when no useful raw message.
 * @returns        A user-facing string that never discloses an AI vendor.
 */
export function sanitizeAuthoringError(err: unknown, fallback: string): string {
  // Supabase/PostgREST rejects with a structured plain object rather than an
  // Error instance. Read only its string `message` field so the operator gets
  // the same safe handling as native Error failures.
  const raw = authoringErrorMessage(err);

  // No useful raw message → preserve the existing per-call fallback.
  if (raw.length === 0) {
    return fallback;
  }

  const safeServerMessage = USER_SAFE_SERVER_MESSAGES[raw];
  if (safeServerMessage !== undefined) return safeServerMessage;

  // Per-code mapping (longest-prefix-first, see CODE_MESSAGE_TABLE).
  for (const [codePrefix, userMessage] of CODE_MESSAGE_TABLE) {
    if (raw.startsWith(codePrefix)) {
      return userMessage;
    }
  }

  // Defense-in-depth: a NEW or differently-named vendor code added later is
  // auto-scrubbed even before the table is updated.
  if (FORBIDDEN_VENDOR_TOKENS.some((re) => re.test(raw))) {
    return GENERIC_AI_FAILURE;
  }

  // No known code, no vendor token → surface the useful real reason
  // (tier2_pipeline_failed, place_pool_link_missing, network errors,
  // "Google location", etc.). Preserves META-ORCH-1009 Sub-E B6.
  return raw;
}
