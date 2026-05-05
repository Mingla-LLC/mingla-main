// ORCH-0708 Phase 1 — canonical enum source for photo-aesthetic scoring.
//
// SOURCE OF TRUTH for the field-value enums Claude Haiku 4.5 returns from the
// `photo_aesthetic_score` tool. Edge function (`score-place-photo-aesthetics`)
// imports from here for output sanitization. Admin form (`mingla-admin/src/
// constants/photoLabeling.js`) MUST stay in sync — values are duplicated there
// for Vite/JSX side; orchestrator dispatches a follow-up if either side diverges.
//
// Spec: §5 (prompt design + tool schema sanitization).

// 16 Mingla signal IDs. These are the values Claude must use in
// appropriate_for / inappropriate_for arrays. Same list as
// `mingla-admin/src/constants/photoLabeling.js::MINGLA_SIGNAL_IDS`.
export const MINGLA_SIGNAL_IDS = [
  "brunch",
  "casual_food",
  "creative_arts",
  "drinks",
  "fine_dining",
  "flowers",
  "groceries",
  "icebreakers",
  "lively",
  "movies",
  "nature",
  "picnic_friendly",
  "play",
  "romantic",
  "scenic",
  "theatre",
] as const;

export const LIGHTING_OPTIONS = [
  "bright_daylight",
  "warm_intimate",
  "dim_moody",
  "candle_lit",
  "neon_party",
  "fluorescent_clinical",
  "natural_outdoor",
  "mixed",
  "unclear",
] as const;

export const COMPOSITION_OPTIONS = ["strong", "average", "weak"] as const;

export const SUBJECT_CLARITY_OPTIONS = ["clear", "partial", "unclear"] as const;

export const PRIMARY_SUBJECT_OPTIONS = [
  "food",
  "drinks",
  "ambience",
  "exterior",
  "people",
  "art",
  "nature",
  "products",
  "mixed",
] as const;

export const VIBE_TAG_OPTIONS = [
  "fine_dining",
  "casual",
  "intimate",
  "lively",
  "party",
  "family_friendly",
  "romantic",
  "candle_lit",
  "brunchy",
  "food_forward",
  "cocktail_focused",
  "outdoor",
  "scenic",
  "artsy",
  "cozy",
  "modern",
  "rustic",
  "upscale",
  "divey",
  "bright",
  "dim",
  "professional",
  "amateur",
  "photogenic",
] as const;

export const SAFETY_FLAG_OPTIONS = [
  "adult_content",
  "explicit_imagery",
  "weapons",
  "drugs",
  "none",
] as const;

// ── Sanitizers ──────────────────────────────────────────────────────────────
// Drop any value not in the documented enum; preserves order; deduplicates.

export function sanitizeEnum<T extends string>(
  values: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(values)) return [];
  const allowSet = new Set<string>(allowed);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    if (!allowSet.has(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v as T);
  }
  return out;
}

export function sanitizeScalarEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== "string") return fallback;
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function sanitizeAestheticScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 5.0;
  if (n < 1) return 1;
  if (n > 10) return 10;
  return Math.round(n * 10) / 10;
}

export function sanitizePhotoQualityNotes(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, 300);
}

// ── Tool schema (Claude tool_use) ───────────────────────────────────────────

export const PHOTO_AESTHETIC_TOOL = {
  name: "photo_aesthetic_score",
  description: "Return the structured photo aesthetic score for the place.",
  input_schema: {
    type: "object",
    required: [
      "aesthetic_score",
      "lighting",
      "composition",
      "subject_clarity",
      "primary_subject",
      "vibe_tags",
      "appropriate_for",
      "inappropriate_for",
      "safety_flags",
      "photo_quality_notes",
    ],
    properties: {
      aesthetic_score: { type: "number", minimum: 1, maximum: 10 },
      lighting: { type: "string", enum: LIGHTING_OPTIONS },
      composition: { type: "string", enum: COMPOSITION_OPTIONS },
      subject_clarity: { type: "string", enum: SUBJECT_CLARITY_OPTIONS },
      primary_subject: { type: "string", enum: PRIMARY_SUBJECT_OPTIONS },
      vibe_tags: { type: "array", items: { type: "string" } },
      appropriate_for: { type: "array", items: { type: "string" } },
      inappropriate_for: { type: "array", items: { type: "string" } },
      safety_flags: { type: "array", items: { type: "string", enum: SAFETY_FLAG_OPTIONS } },
      photo_quality_notes: { type: "string", maxLength: 300 },
    },
  },
} as const;

// ── Pricing constants (Claude Haiku 4.5 vision, 2026-05-04) ─────────────────
// $1 per million input tokens, $5 per million output tokens.
// Batch API: 50% off both.
// Prompt caching: 10% read multiplier on cached tokens (write = 1.25x base).
// Prices are PER TOKEN (not per million) for arithmetic convenience.
export const PRICING = {
  HAIKU_4_5_INPUT_PER_TOKEN: 1.0 / 1_000_000,
  HAIKU_4_5_OUTPUT_PER_TOKEN: 5.0 / 1_000_000,
  HAIKU_4_5_CACHE_READ_PER_TOKEN: 0.1 / 1_000_000,
  HAIKU_4_5_CACHE_WRITE_PER_TOKEN: 1.25 / 1_000_000,
  BATCH_API_DISCOUNT: 0.5,
  // ORCH-0713 Gemini comparison (2026-05-05).
  // Gemini 2.5 Flash pricing per https://ai.google.dev/pricing (verify live).
  // Input/output rates apply uniformly to text + image tokens.
  // No prompt cache yet (paid prompt caching is documented but optional —
  // we don't use it for the trial path; baseline rates apply).
  GEMINI_2_5_FLASH_INPUT_PER_TOKEN: 0.30 / 1_000_000,
  GEMINI_2_5_FLASH_OUTPUT_PER_TOKEN: 2.50 / 1_000_000,
} as const;

export function computeCostUsd(args: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  useBatchApi: boolean;
}): number {
  const {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    useBatchApi,
  } = args;
  const discount = useBatchApi ? PRICING.BATCH_API_DISCOUNT : 1.0;
  const cost =
    inputTokens * PRICING.HAIKU_4_5_INPUT_PER_TOKEN * discount +
    outputTokens * PRICING.HAIKU_4_5_OUTPUT_PER_TOKEN * discount +
    cacheReadTokens * PRICING.HAIKU_4_5_CACHE_READ_PER_TOKEN * discount +
    cacheWriteTokens * PRICING.HAIKU_4_5_CACHE_WRITE_PER_TOKEN * discount;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// ORCH-0713 Gemini comparison — Gemini 2.5 Flash cost calc.
// Gemini's usageMetadata reports promptTokenCount + candidatesTokenCount;
// no separate cache-read/cache-write split exposed for free tier.
export function computeCostUsdGemini(args: {
  promptTokens: number;
  candidatesTokens: number;
}): number {
  const { promptTokens, candidatesTokens } = args;
  const cost =
    promptTokens * PRICING.GEMINI_2_5_FLASH_INPUT_PER_TOKEN +
    candidatesTokens * PRICING.GEMINI_2_5_FLASH_OUTPUT_PER_TOKEN;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
