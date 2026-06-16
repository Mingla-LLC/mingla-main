// Ve6 — Play activities list → experiences parser (Gemini 2.5 Flash).

import { filterPlayIntentTags } from "./playIntentTags.ts";

const GEMINI_MODEL_ID = "gemini-2.5-flash";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;

const MAX_EXPERIENCES = 20;
const MAX_OUTPUT_TOKENS = 8192;
const TEMPERATURE = 0.2;

export interface ActivitiesFileInput {
  mime_type: string;
  data_base64: string;
}

export interface ParsedPlayExperience {
  title: string;
  narrative: string;
  suggested_price_min_cents: number | null;
  suggested_price_max_cents: number | null;
  currency: string;
  intent_tags: string[];
  capacity_min: number | null;
  capacity_max: number | null;
  suggested_time_of_day: string | null;
  // ORCH-1146 (Phase 2): null unless explicitly present in the photo.
  is_free: boolean | null;
  confidence: number;
}

export interface ActivitiesParseResult {
  experiences: ParsedPlayExperience[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    experiences: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          narrative: { type: "string" },
          suggested_price_min_cents: { type: "integer" },
          suggested_price_max_cents: { type: "integer" },
          currency: { type: "string" },
          intent_tags: { type: "array", items: { type: "string" } },
          capacity_min: { type: "integer" },
          capacity_max: { type: "integer" },
          suggested_time_of_day: { type: "string" },
          is_free: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: ["title", "narrative"],
      },
    },
  },
  required: ["experiences"],
};

const SYSTEM_PROMPT = `You are a Play-venue activities analyst for Mingla (bowling, arcade, escape room, mini-golf, etc.).
Given photos or PDFs of an activities/packages/pricing list, extract single-intent experience offerings.
Each experience is ONE clear bookable or walk-in offering (e.g. "Lane + pitcher for 4", "Friday night arcade tournament").
Return JSON only. Cap at ${MAX_EXPERIENCES} experiences. If the printed currency is unclear, leave currency empty (do not guess a currency).
If the upload is not an activities/packages list, return {"experiences":[]}.
Do not invent offerings not supported by the source text.
For intent_tags use ONLY: friends_chill, group_activity, date_night_active, family_friendly, solo_exploration.
Include capacity_min and capacity_max when the source implies group size (e.g. lanes seat 6, escape room max 8).
Include suggested_time_of_day when timing is implied (e.g. "Friday evening", "weekday afternoon").
Set is_free=true ONLY when the source explicitly signals no charge (e.g. "free entry", "free play hour"); otherwise omit it. Do not guess.`;

function clampConfidence(v: unknown): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

function asString(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, maxLen);
}

function asCents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function asCapacity(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) return null;
  return Math.round(v);
}

function normalizeExperience(
  raw: Record<string, unknown>,
  defaultCurrency: string,
): ParsedPlayExperience | null {
  const title = asString(raw.title, 120);
  const narrative = asString(raw.narrative, 2000);
  if (!title || !narrative) return null;

  const minCents = asCents(raw.suggested_price_min_cents);
  const maxCents = asCents(raw.suggested_price_max_cents);
  let currency = asString(raw.currency, 3).toUpperCase();
  if (!currency) currency = defaultCurrency;

  let capacityMin = asCapacity(raw.capacity_min);
  let capacityMax = asCapacity(raw.capacity_max);
  if (capacityMin !== null && capacityMax !== null && capacityMin > capacityMax) {
    const swap = capacityMin;
    capacityMin = capacityMax;
    capacityMax = swap;
  }

  const timeOfDay = asString(raw.suggested_time_of_day, 80) || null;
  const intentTags = filterPlayIntentTags(raw.intent_tags);
  // ORCH-1146 (Phase 2): null unless explicitly present (no fabrication).
  const isFree = typeof raw.is_free === "boolean" ? raw.is_free : null;

  return {
    title,
    narrative,
    suggested_price_min_cents: minCents,
    suggested_price_max_cents: maxCents,
    currency,
    intent_tags: intentTags,
    capacity_min: capacityMin,
    capacity_max: capacityMax,
    suggested_time_of_day: timeOfDay,
    is_free: isFree,
    confidence: clampConfidence(raw.confidence),
  };
}

/**
 * Exported for unit tests — normalizes raw Gemini JSON.
 *
 * ORCH-1146 (Phase 3 — de-GBP): `defaultCurrency` defaults to "" (NOT "GBP").
 * Callers MUST pass the brand currency; absent → "" flows through and the
 * confirm executor resolves from `brand.default_currency` server-side.
 */
export function normalizeActivitiesParsePayload(
  payload: unknown,
  defaultCurrency = "",
): ParsedPlayExperience[] {
  if (payload === null || typeof payload !== "object") return [];
  const experiences = (payload as { experiences?: unknown }).experiences;
  if (!Array.isArray(experiences)) return [];

  const out: ParsedPlayExperience[] = [];
  for (const item of experiences) {
    if (item === null || typeof item !== "object") continue;
    const normalized = normalizeExperience(
      item as Record<string, unknown>,
      defaultCurrency,
    );
    if (normalized) out.push(normalized);
    if (out.length >= MAX_EXPERIENCES) break;
  }
  return out;
}

export async function parseActivitiesWithGemini(args: {
  files: ActivitiesFileInput[];
  defaultCurrency?: string;
  temporaryCategory?: "play";
  venueName?: string;
}): Promise<ActivitiesParseResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY_ARI");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_ARI is not configured");
  }

  // ORCH-1146 (Phase 3 — de-GBP): no GBP literal; edge entry passes brand
  // currency, absent → "" (executor resolves from brand.default_currency).
  const defaultCurrency = args.defaultCurrency ?? "";
  const temporaryCategory = args.temporaryCategory ?? "play";
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];

  const venueHint = args.venueName
    ? `Venue name: ${args.venueName}\n\n`
    : "";
  parts.push({
    text: `${venueHint}Analyze this activities/packages list and return Play experience proposals as JSON.`,
  });

  for (const file of args.files) {
    parts.push({
      inline_data: {
        mime_type: file.mime_type,
        data: file.data_base64,
      },
    });
  }

  const requestBody = {
    contents: [{ role: "user", parts }],
    systemInstruction: {
      parts: [{ text: `You are parsing a ${temporaryCategory} activities list.\n\n${SYSTEM_PROMPT}` }],
    },
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const json = await response.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const textPart = json.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string");
  const rawText = textPart?.text ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }

  const experiences = normalizeActivitiesParsePayload(parsed, defaultCurrency);

  return {
    experiences,
    usage: {
      prompt_tokens: json.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: json.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}
