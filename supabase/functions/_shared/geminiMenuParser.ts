// ORCH-0881 — Ve5 structured menu → experiences parser (Gemini 2.5 Flash).

const GEMINI_MODEL_ID = "gemini-2.5-flash";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;

const MAX_EXPERIENCES = 20;
const MAX_OUTPUT_TOKENS = 8192;
const TEMPERATURE = 0.2;

export interface MenuFileInput {
  mime_type: string;
  data_base64: string;
}

export interface ParsedMenuExperience {
  title: string;
  narrative: string;
  suggested_price_min_cents: number | null;
  suggested_price_max_cents: number | null;
  currency: string;
  intent_tags: string[];
  confidence: number;
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
          confidence: { type: "number" },
        },
        required: ["title", "narrative"],
      },
    },
  },
  required: ["experiences"],
};

const SYSTEM_PROMPT = `You are a restaurant menu analyst for Mingla, a social experiences platform.
Given menu images or PDF pages, extract single-intent experience offerings a venue could promote.
Each experience is ONE clear intent (e.g. "Bottomless brunch Saturdays", "Date-night tasting menu").
Return JSON only. Cap at ${MAX_EXPERIENCES} experiences. Use GBP if currency unclear.
If the upload is not a menu, return {"experiences":[]}.
Do not invent items not supported by the menu text.`;

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

function normalizeExperience(
  raw: Record<string, unknown>,
  defaultCurrency: string,
): ParsedMenuExperience | null {
  const title = asString(raw.title, 120);
  const narrative = asString(raw.narrative, 2000);
  if (!title || !narrative) return null;

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

  return {
    title,
    narrative,
    suggested_price_min_cents: minCents,
    suggested_price_max_cents: maxCents,
    currency,
    intent_tags: intentTags.slice(0, 12),
    confidence: clampConfidence(raw.confidence),
  };
}

/** Exported for unit tests — normalizes raw Gemini JSON. */
export function normalizeMenuParsePayload(
  payload: unknown,
  defaultCurrency = "GBP",
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

  const defaultCurrency = args.defaultCurrency ?? "GBP";
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
