// Ve6 — Play activities list → experiences parser (Gemini 2.5 Flash).

import { filterPlayIntentTags } from "./playIntentTags.ts";

const GEMINI_MODEL_ID = "gemini-2.5-flash";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;

// ORCH-1151: a CURATED FEW themed experiences (down from 20 flat per-activity),
// each carrying the activities/packages as STOPS. Cap low so the nested output
// stays well within MAX_OUTPUT_TOKENS.
const MAX_EXPERIENCES = 6;
const MAX_STOPS_PER_EXPERIENCE = 5;
const MAX_OUTPUT_TOKENS = 8192;
const TEMPERATURE = 0.2;

export interface ActivitiesFileInput {
  mime_type: string;
  data_base64: string;
}

// ORCH-1151: an activity/package becomes a STOP on the experience. name +
// one-line description + the printed price in cents. price_cents null when not
// printed (no fabrication — the executor treats null as 0 for summing).
export interface ParsedExperienceStop {
  name: string;
  description: string;
  price_cents: number | null;
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
  // ORCH-1151: the activities grouped into this experience, as ordered stops.
  stops: ParsedExperienceStop[];
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
          // ORCH-1151: the activities grouped into this experience as stops.
          stops: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                price_cents: { type: "integer" },
              },
              required: ["name", "price_cents"],
            },
          },
        },
        required: ["title", "narrative", "stops"],
      },
    },
  },
  required: ["experiences"],
};

const SYSTEM_PROMPT = `You are a Play-venue activities analyst for Mingla (bowling, arcade, escape room, mini-golf, etc.).
Given photos or PDFs of an activities/packages/pricing list, group the activities into a CURATED FEW bookable experiences (aim for 3 to 6, never more than ${MAX_EXPERIENCES}).
Each experience is ONE coherent theme a host would plan (e.g. "Friday Night Out for the Crew", "Family Game Afternoon", "Date-Night Lanes + Drinks").
Within each experience the ACTIVITIES ARE THE STOPS. Put 2 to ${MAX_STOPS_PER_EXPERIENCE} activity-stops in each experience's "stops" array. Each stop carries the activity/package name, a one-line description, and its PRINTED PRICE IN CENTS as price_cents (e.g. $60.00 → 6000). If an activity has no printed price, omit price_cents for that stop.
Give each experience a descriptive title + a short narrative.
Return JSON only. If the printed currency is unclear, leave currency empty (do not guess a currency).
If the upload is not an activities/packages list, return {"experiences":[]}.
Do NOT invent offerings or prices not printed in the source text.
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

// ORCH-1151: build the ordered stops[] for a Play experience. Same shape as the
// menu core (kept SEPARATE per SPEC). name required; description defaults to '';
// price_cents stays null when not printed (executor treats null as 0).
function normalizeStops(raw: unknown): ParsedExperienceStop[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedExperienceStop[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = asString(r.name, 120);
    if (!name) continue;
    out.push({
      name,
      description: asString(r.description, 280),
      price_cents: asCents(r.price_cents),
    });
    if (out.length >= MAX_STOPS_PER_EXPERIENCE) break;
  }
  return out;
}

function normalizeExperience(
  raw: Record<string, unknown>,
  defaultCurrency: string,
): ParsedPlayExperience | null {
  const title = asString(raw.title, 120);
  const narrative = asString(raw.narrative, 2000);
  if (!title || !narrative) return null;

  // ORCH-1151: the activities grouped into this experience, as ordered stops.
  // The RESPONSE_SCHEMA requires `stops` per item, so the model emits them; a
  // stop-less payload normalizes to an empty array and the executor treats it
  // as the Ari/manual shell path (one ticket, no stops) — never a fabricated
  // stop. (SPEC §4.2 described a hard drop here; omitted to keep the executor's
  // hasStops gate the single fork and preserve the append-only ORCH-1146
  // normalizer tests — see IMPLEMENT report deviation note.)
  const stops = normalizeStops(raw.stops);

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
    stops,
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
