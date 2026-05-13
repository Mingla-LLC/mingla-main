// ORCH-0821 — Gemini call wrapper for Ari.
//
// Adapted from the proven pattern in supabase/functions/run-place-intelligence-trial/index.ts
// (Gemini 2.5 Flash, MALFORMED_FUNCTION_CALL retry loop, function calling mode ANY).
// Uses GEMINI_API_KEY_ARI (isolated from place-intel quota).

const GEMINI_MODEL_ID = "gemini-2.5-flash";
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;
const MAX_MALFORMED_RETRIES = 2;
const MAX_OUTPUT_TOKENS = 1500;
const TEMPERATURE = 0.3;

export interface GeminiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface GeminiContentMessage {
  role: "user" | "model";
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
  >;
}

export interface GeminiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GeminiToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiResult {
  textResponse?: string;
  toolCall?: GeminiToolCall;
  usage: GeminiUsage;
  finishReason: string;
  attemptCount: number;
}

export interface GeminiError extends Error {
  kind: "config" | "http" | "malformed" | "empty";
  status?: number;
  detail?: string;
}

function makeError(
  kind: GeminiError["kind"],
  message: string,
  detail?: { status?: number; detail?: string },
): GeminiError {
  const err = new Error(message) as GeminiError;
  err.kind = kind;
  if (detail?.status !== undefined) err.status = detail.status;
  if (detail?.detail !== undefined) err.detail = detail.detail;
  return err;
}

export async function callGemini(args: {
  systemPrompt: string;
  contents: GeminiContentMessage[];
  tools: GeminiToolDef[];
}): Promise<GeminiResult> {
  // GEMINI_API_KEY_ARI is the ONLY accepted secret. No fallbacks — Ari
  // gets its own isolated quota by design. If this key is missing, the
  // operator must set it in the Supabase function secrets before Ari can
  // respond.
  const apiKey = Deno.env.get("GEMINI_API_KEY_ARI");
  if (!apiKey) {
    throw makeError(
      "config",
      "GEMINI_API_KEY_ARI is not configured in this Supabase project. Operator must add it via Project Settings → Edge Functions → Secrets.",
    );
  }

  const requestBody = {
    contents: args.contents,
    systemInstruction: { parts: [{ text: args.systemPrompt }] },
    tools: [
      {
        function_declarations: args.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        // mode=AUTO lets Gemini choose between a tool call and a plain text
        // reply. Per Google's FunctionCallingConfig spec, allowedFunctionNames
        // is ONLY valid with mode=ANY (which forces a tool call). Combining
        // AUTO + allowedFunctionNames returns HTTP 400 "Function declaration
        // validation failed". The set of callable tools is already implicitly
        // restricted by the function_declarations list we passed above.
        mode: "AUTO",
      },
    },
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
    },
  };

  let attempt = 0;
  let lastFinishReason = "";
  let lastUsage: GeminiUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  while (attempt <= MAX_MALFORMED_RETRIES) {
    attempt++;

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // 5xx is transient — retry once via the malformed loop.
      if (response.status >= 500 && attempt <= MAX_MALFORMED_RETRIES) {
        continue;
      }
      throw makeError("http", `Gemini HTTP ${response.status}`, {
        status: response.status,
        detail: text.slice(0, 500),
      });
    }

    const payload = await response.json() as GeminiResponse;

    // Capture usage if present
    if (payload.usageMetadata) {
      lastUsage = {
        prompt_tokens: payload.usageMetadata.promptTokenCount ?? 0,
        completion_tokens: payload.usageMetadata.candidatesTokenCount ?? 0,
        total_tokens: payload.usageMetadata.totalTokenCount ?? 0,
      };
    }

    const candidate = payload.candidates?.[0];
    lastFinishReason = candidate?.finishReason ?? "UNKNOWN";

    // Retry on MALFORMED_FUNCTION_CALL — Gemini sometimes truncates a tool
    // call mid-emit when output tokens are tight.
    if (lastFinishReason === "MALFORMED_FUNCTION_CALL" && attempt <= MAX_MALFORMED_RETRIES) {
      continue;
    }

    // Successful candidate — extract either a tool call or text
    const parts = candidate?.content?.parts ?? [];
    let toolCall: GeminiToolCall | undefined;
    let textParts: string[] = [];
    for (const part of parts) {
      if ("functionCall" in part && part.functionCall) {
        toolCall = {
          name: part.functionCall.name,
          args: (part.functionCall.args ?? {}) as Record<string, unknown>,
        };
      } else if ("text" in part && typeof part.text === "string") {
        textParts.push(part.text);
      }
    }

    if (!toolCall && textParts.length === 0) {
      // Empty response — final attempt
      if (attempt <= MAX_MALFORMED_RETRIES) continue;
      throw makeError("empty", "Gemini returned no usable content", {
        detail: `finishReason=${lastFinishReason}`,
      });
    }

    return {
      textResponse: textParts.length > 0 ? textParts.join("") : undefined,
      toolCall,
      usage: lastUsage,
      finishReason: lastFinishReason,
      attemptCount: attempt,
    };
  }

  throw makeError(
    "malformed",
    `Gemini failed after ${attempt} attempts with finishReason=${lastFinishReason}`,
    { detail: lastFinishReason },
  );
}

// Internal — minimal shape of the Gemini API response we depend on
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<
        | { text: string }
        | { functionCall: { name: string; args?: Record<string, unknown> } }
      >;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export const ARI_MODEL_VERSION = GEMINI_MODEL_ID;
