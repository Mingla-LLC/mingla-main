// ORCH-0821 — Gemini call wrapper for Ari.
//
// Adapted from the proven pattern in supabase/functions/run-place-intelligence-trial/index.ts
// (Gemini 2.5 Flash, MALFORMED_FUNCTION_CALL retry loop, function calling mode ANY).
// Uses GEMINI_API_KEY_ARI (isolated from place-intel quota).

// ORCH-1201 — Layer-C passive health observation (fire-and-forget, best-effort).
import { recordApiCall } from "./apiHealthLog.ts";

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

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
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
  kind: "config" | "http" | "malformed" | "empty" | "schema";
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

const PROVIDER_SCHEMA_FIELDS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "example",
  "anyOf",
  "propertyOrdering",
  "default",
  "items",
  "minimum",
  "maximum",
]);

const INT64_SCHEMA_FIELDS = new Set([
  "maxItems",
  "minItems",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
]);

const STRING_SCHEMA_FIELDS = new Set([
  "format",
  "title",
  "description",
  "pattern",
]);

const STRING_ARRAY_SCHEMA_FIELDS = new Set([
  "required",
  "propertyOrdering",
]);

const PROVIDER_TYPES = new Set([
  "STRING",
  "NUMBER",
  "INTEGER",
  "BOOLEAN",
  "ARRAY",
  "OBJECT",
  "NULL",
]);

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue;
};

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function schemaError(
  toolName: string,
  pointer: string,
  keyword: string,
  reason: string,
): GeminiError {
  return makeError(
    "schema",
    `Ari tool schema invalid: tool=${toolName} path=${pointer} keyword=${keyword} reason=${reason}`,
    { detail: `tool=${toolName} path=${pointer} keyword=${keyword}` },
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonValue(
  value: unknown,
  toolName: string,
  pointer: string,
  keyword: string,
): JsonValue {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw schemaError(toolName, pointer, keyword, "must be JSON-compatible");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      cloneJsonValue(entry, toolName, `${pointer}/${index}`, keyword)
    );
  }
  if (isPlainRecord(value)) {
    const copy: { [key: string]: JsonValue } = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = cloneJsonValue(
        entry,
        toolName,
        `${pointer}/${escapeJsonPointerSegment(key)}`,
        keyword,
      );
    }
    return copy;
  }
  throw schemaError(toolName, pointer, keyword, "must be JSON-compatible");
}

function normalizeInt64(
  value: unknown,
  toolName: string,
  pointer: string,
  keyword: string,
): string {
  let normalized: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw schemaError(
        toolName,
        pointer,
        keyword,
        "must be a safe nonnegative integer",
      );
    }
    normalized = String(value);
  } else if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    normalized = value;
  } else {
    throw schemaError(
      toolName,
      pointer,
      keyword,
      "must be a canonical nonnegative decimal integer",
    );
  }

  if (BigInt(normalized) > MAX_SIGNED_INT64) {
    throw schemaError(toolName, pointer, keyword, "exceeds signed int64 range");
  }
  return normalized;
}

function normalizeProviderEnum(
  value: unknown,
  schemaType: unknown,
  toolName: string,
  pointer: string,
): string[] {
  if (!Array.isArray(value)) {
    throw schemaError(toolName, pointer, "enum", "must be an array");
  }
  if (value.every((entry) => typeof entry === "string")) {
    return [...value];
  }

  const normalizedType = typeof schemaType === "string"
    ? schemaType.toUpperCase()
    : null;
  if (
    normalizedType === "INTEGER" &&
    value.every((entry) =>
      typeof entry === "number" && Number.isSafeInteger(entry)
    )
  ) {
    return value.map(String);
  }
  if (
    normalizedType === "NUMBER" &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return value.map(String);
  }
  throw schemaError(
    toolName,
    pointer,
    "enum",
    "must be all strings or finite numbers matching the schema type",
  );
}

function compileProviderSchema(
  schema: unknown,
  toolName: string,
  pointer: string,
): Record<string, unknown> {
  if (!isPlainRecord(schema)) {
    throw schemaError(toolName, pointer, "parameters", "must be an object");
  }

  const compiled: Record<string, unknown> = {};
  for (const [keyword, value] of Object.entries(schema)) {
    const keywordPointer = `${pointer}/${escapeJsonPointerSegment(keyword)}`;

    if (keyword === "additionalProperties") {
      if (value !== false) {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "only false can be consumed",
        );
      }
      continue;
    }
    if (!PROVIDER_SCHEMA_FIELDS.has(keyword)) {
      throw schemaError(
        toolName,
        keywordPointer,
        keyword,
        "unsupported typed-schema keyword",
      );
    }

    if (keyword === "type") {
      if (
        typeof value !== "string" || !PROVIDER_TYPES.has(value.toUpperCase())
      ) {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "must be a supported schema type",
        );
      }
      compiled[keyword] = value;
    } else if (STRING_SCHEMA_FIELDS.has(keyword)) {
      if (typeof value !== "string") {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "must be a string",
        );
      }
      compiled[keyword] = value;
    } else if (keyword === "nullable") {
      if (typeof value !== "boolean") {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "must be a boolean",
        );
      }
      compiled[keyword] = value;
    } else if (keyword === "enum") {
      compiled[keyword] = normalizeProviderEnum(
        value,
        schema.type,
        toolName,
        keywordPointer,
      );
    } else if (STRING_ARRAY_SCHEMA_FIELDS.has(keyword)) {
      if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string")
      ) {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "must be an array of strings",
        );
      }
      compiled[keyword] = [...value];
    } else if (INT64_SCHEMA_FIELDS.has(keyword)) {
      compiled[keyword] = normalizeInt64(
        value,
        toolName,
        keywordPointer,
        keyword,
      );
    } else if (keyword === "minimum" || keyword === "maximum") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "must be a finite number",
        );
      }
      compiled[keyword] = value;
    } else if (keyword === "properties") {
      if (!isPlainRecord(value)) {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "must be an object of schemas",
        );
      }
      const properties: Record<string, unknown> = {};
      for (const [propertyName, propertySchema] of Object.entries(value)) {
        properties[propertyName] = compileProviderSchema(
          propertySchema,
          toolName,
          `${keywordPointer}/${escapeJsonPointerSegment(propertyName)}`,
        );
      }
      compiled[keyword] = properties;
    } else if (keyword === "items") {
      compiled[keyword] = compileProviderSchema(
        value,
        toolName,
        keywordPointer,
      );
    } else if (keyword === "anyOf") {
      if (!Array.isArray(value)) {
        throw schemaError(
          toolName,
          keywordPointer,
          keyword,
          "must be an array of schemas",
        );
      }
      compiled[keyword] = value.map((entry, index) =>
        compileProviderSchema(entry, toolName, `${keywordPointer}/${index}`)
      );
    } else if (keyword === "example" || keyword === "default") {
      compiled[keyword] = cloneJsonValue(
        value,
        toolName,
        keywordPointer,
        keyword,
      );
    }
  }

  return compiled;
}

export function compileGeminiToolDeclarations(
  tools: readonly GeminiToolDef[],
): GeminiFunctionDeclaration[] {
  return tools.map((tool, index) => {
    const fallbackName = `tools[${index}]`;
    if (typeof tool?.name !== "string" || tool.name.length === 0) {
      throw schemaError(
        fallbackName,
        "/name",
        "name",
        "must be a nonempty string",
      );
    }
    if (typeof tool.description !== "string") {
      throw schemaError(
        tool.name,
        "/description",
        "description",
        "must be a string",
      );
    }
    return {
      name: tool.name,
      description: tool.description,
      parameters: compileProviderSchema(
        tool.parameters,
        tool.name,
        "/parameters",
      ),
    };
  });
}

export async function callGemini(args: {
  systemPrompt: string;
  contents: GeminiContentMessage[];
  tools: GeminiToolDef[];
}): Promise<GeminiResult> {
  // Compile before secret lookup or network access so provider-contract drift
  // fails locally, deterministically, and without exposing request data.
  const functionDeclarations = compileGeminiToolDeclarations(args.tools);

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
        function_declarations: functionDeclarations,
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
  let lastUsage: GeminiUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  while (attempt <= MAX_MALFORMED_RETRIES) {
    attempt++;

    const _t0 = Date.now();
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // ORCH-1201-R2 Layer-C: capture the Gemini depletion fingerprint. A 429 with
      // error.status=RESOURCE_EXHAUSTED is true quota exhaustion (vs transient).
      let depErr: { code?: string; text?: string } | undefined;
      if (response.status === 429) {
        let parsedStatus = "";
        try {
          parsedStatus = (JSON.parse(text)?.error?.status as string) ?? "";
        } catch { /* non-JSON body */ }
        depErr = {
          code: parsedStatus || "RESOURCE_EXHAUSTED",
          text: text.slice(0, 300),
        };
      }
      void recordApiCall(
        "gemini",
        false,
        Date.now() - _t0,
        response.status,
        depErr,
      ); // ORCH-1201 Layer-C
      // 5xx is transient — retry once via the malformed loop.
      if (response.status >= 500 && attempt <= MAX_MALFORMED_RETRIES) {
        continue;
      }
      throw makeError("http", `Gemini HTTP ${response.status}`, {
        status: response.status,
        detail: text.slice(0, 500),
      });
    }
    void recordApiCall("gemini", true, Date.now() - _t0, response.status); // ORCH-1201 Layer-C (ok path)

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
    if (
      lastFinishReason === "MALFORMED_FUNCTION_CALL" &&
      attempt <= MAX_MALFORMED_RETRIES
    ) {
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
