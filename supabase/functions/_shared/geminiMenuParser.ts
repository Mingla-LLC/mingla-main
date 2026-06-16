// ORCH-0881 — Ve5 structured menu → experiences parser (Gemini 2.5 Flash).

const GEMINI_MODEL_ID = "gemini-2.5-flash";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;

// ORCH-1151: a CURATED FEW themed experiences (down from 20 flat per-dish),
// each carrying the menu items as STOPS. Cap low so the nested output stays well
// within MAX_OUTPUT_TOKENS.
const MAX_EXPERIENCES = 6;
const MAX_STOPS_PER_EXPERIENCE = 5;
const MAX_OUTPUT_TOKENS = 8192;
const TEMPERATURE = 0.2;

export interface MenuFileInput {
  mime_type: string;
  data_base64: string;
}

// ORCH-1151: a menu item becomes a STOP on the experience. name + one-line
// description + the printed price in cents. price_cents null when not printed
// (no fabrication — the executor treats null as 0 for summing).
export interface ParsedExperienceStop {
  name: string;
  description: string;
  price_cents: number | null;
}

export interface ParsedMenuExperience {
  title: string;
  narrative: string;
  suggested_price_min_cents: number | null;
  suggested_price_max_cents: number | null;
  currency: string;
  intent_tags: string[];
  // ORCH-1146 (Phase 2): null unless the field is explicitly present in the
  // photo (no fabrication).
  is_free: boolean | null;
  suggested_time_of_day: string | null;
  confidence: number;
  // ORCH-1151: the menu items grouped into this experience, as ordered stops.
  stops: ParsedExperienceStop[];
}

export interface MenuParseResult {
  experiences: ParsedMenuExperience[];
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
          is_free: { type: "boolean" },
          suggested_time_of_day: { type: "string" },
          confidence: { type: "number" },
          // ORCH-1151: the menu items grouped into this experience as stops.
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

const SYSTEM_PROMPT = `You are a restaurant menu analyst for Mingla, a social experiences platform.
Given menu images or PDF pages, group the menu items into a CURATED FEW themed experiences (aim for 3 to 6, never more than ${MAX_EXPERIENCES}).
Each experience is ONE coherent theme a chef would compose (e.g. "Date-Night Tasting Trio", "Brunch Crawl for Four", "Small-Plates Happy Hour").
Within each experience the MENU ITEMS ARE THE STOPS. Put 2 to ${MAX_STOPS_PER_EXPERIENCE} item-stops in each experience's "stops" array. Each stop carries the item name, a one-line description, and its PRINTED PRICE IN CENTS as price_cents (e.g. $14.00 → 1400). If an item has no printed price, omit price_cents for that stop.
Give each experience a descriptive title + a short narrative. Infer a vibe via intent_tags where sensible.
Return JSON only. If the printed currency is unclear, leave currency empty (do not guess a currency).
Set is_free=true ONLY when the menu explicitly signals no charge (e.g. "free entry", "no cover charge"); otherwise omit it. Include suggested_time_of_day only when a serving window is stated (e.g. "Saturday brunch", "happy hour 4-6pm"); otherwise omit it. Do not guess.
If the upload is not a menu, return {"experiences":[]}.
Do NOT invent items or prices not printed on the menu.`;

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

// ORCH-1151: build the ordered stops[] for an experience. Each stop's name is
// required (drop nameless rows); description defaults to ''; price_cents stays
// null when not printed (the executor treats null as 0 for summing — no
// fabrication of a price). Cap at MAX_STOPS_PER_EXPERIENCE.
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
): ParsedMenuExperience | null {
  const title = asString(raw.title, 120);
  const narrative = asString(raw.narrative, 2000);
  if (!title || !narrative) return null;

  // ORCH-1151: the menu items grouped into this experience, as ordered stops.
  // The RESPONSE_SCHEMA requires `stops` per item, so the model emits them; a
  // stop-less payload (e.g. a unit-test fixture or a degenerate model reply)
  // normalizes to an empty array and the executor treats it as the Ari/manual
  // shell path (one ticket, no stops) — never a fabricated stop. (SPEC §4.1
  // described a hard drop here; that is omitted to keep the executor's hasStops
  // gate the single fork and to preserve the append-only ORCH-1146 normalizer
  // tests — see IMPLEMENT report deviation note.)
  const stops = normalizeStops(raw.stops);

  const minCents = asCents(raw.suggested_price_min_cents);
  const maxCents = asCents(raw.suggested_price_max_cents);
  let currency = asString(raw.currency, 3).toUpperCase();
  if (!currency) currency = defaultCurrency;

  const intentTags: string[] = [];
  if (Array.isArray(raw.intent_tags)) {
    for (const t of raw.intent_tags) {
      if (typeof t === "string" && t.trim()) {
        intentTags.push(t.trim().slice(0, 40));
      }
    }
  }

  // ORCH-1146 (Phase 2): only persist these when present in the raw payload —
  // a missing field stays null (no fabrication).
  const isFree = typeof raw.is_free === "boolean" ? raw.is_free : null;
  const timeOfDay = asString(raw.suggested_time_of_day, 80) || null;

  return {
    title,
    narrative,
    suggested_price_min_cents: minCents,
    suggested_price_max_cents: maxCents,
    currency,
    intent_tags: intentTags.slice(0, 12),
    is_free: isFree,
    suggested_time_of_day: timeOfDay,
    confidence: clampConfidence(raw.confidence),
    stops,
  };
}

/**
 * Exported for unit tests — normalizes raw Gemini JSON.
 *
 * ORCH-1146 (Phase 3 — de-GBP): `defaultCurrency` defaults to "" (NOT "GBP").
 * Callers MUST pass the brand's currency; when truly unknown, an empty currency
 * flows through and the confirm executor resolves it from `brand.default_currency`
 * server-side (single source of truth). No hardcoded GBP anywhere in this path.
 */
export function normalizeMenuParsePayload(
  payload: unknown,
  defaultCurrency = "",
): ParsedMenuExperience[] {
  if (payload === null || typeof payload !== "object") return [];
  const experiences = (payload as { experiences?: unknown }).experiences;
  if (!Array.isArray(experiences)) return [];

  const out: ParsedMenuExperience[] = [];
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

export async function parseMenuWithGemini(args: {
  files: MenuFileInput[];
  defaultCurrency?: string;
  temporaryCategory?: "restaurant";
  venueName?: string;
}): Promise<MenuParseResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY_ARI");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_ARI is not configured");
  }

  // ORCH-1146 (Phase 3 — de-GBP): no GBP literal. The edge entry passes the
  // brand currency; absent → "" (executor resolves from brand.default_currency).
  const defaultCurrency = args.defaultCurrency ?? "";
  const temporaryCategory = args.temporaryCategory ?? "restaurant";
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];

  const venueHint = args.venueName
    ? `Venue name: ${args.venueName}\n\n`
    : "";
  parts.push({
    text: `${venueHint}Analyze this menu and return experience proposals as JSON.`,
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
      parts: [{ text: `You are parsing a ${temporaryCategory} menu.\n\n${SYSTEM_PROMPT}` }],
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

  const experiences = normalizeMenuParsePayload(parsed, defaultCurrency);

  return {
    experiences,
    usage: {
      prompt_tokens: json.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: json.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}
