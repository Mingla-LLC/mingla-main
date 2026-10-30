// ORCH-0821 — Gemini call wrapper for Ari.
//
// Adapted from the proven pattern in supabase/functions/run-place-intelligence-trial/index.ts
// (Gemini 2.5 Flash, MALFORMED_FUNCTION_CALL retry loop, function calling mode ANY).
// Uses GEMINI_API_KEY_ARI (isolated from place-intel quota).

// ORCH-1201 — Layer-C passive health observation (fire-and-forget, best-effort).
import { recordApiCall } from "./apiHealthLog.ts";
// issue #3605 — the two Gemini 3.x contents rules, enforced on the way out.
import { sanitizeGeminiContents } from "./agentGeminiContents.ts";
// issue #3526 — model id + thinking level come from the single source.
import {
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LEVEL_MINIMAL,
  geminiErrorFingerprint,
  geminiGenerateContentUrl,
} from "./geminiModel.ts";

const MAX_MALFORMED_RETRIES = 2;
const MAX_OUTPUT_TOKENS = 1500;
const LOCAL_MAX_OUTPUT_TOKENS = 384;
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
    | { inlineData: { mimeType: string; data: string } }
    // issue #3605 — `thoughtSignature` is the opaque token a Gemini 3.x model
    // returns beside every functionCall. Echoing the call back without it is
    // HTTP 400 "Function call is missing a thought_signature in functionCall
    // parts", which is what silently broke every Ari inline read. Carry it.
    | {
      functionCall: { name: string; args: Record<string, unknown> };
      thoughtSignature?: string;
    }
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
  /**
   * issue #3605 — the model's own signature for this call. Undefined only for
   * a provider that did not send one; when it IS present the caller MUST put
   * it back on the functionCall part it echoes into the next request.
   */
  thoughtSignature?: string;
}

export interface GeminiResult {
  textResponse?: string;
  /** Every function call emitted in provider order. */
  toolCalls: GeminiToolCall[];
  /** Compatibility alias for the legacy single-call path. */
  toolCall?: GeminiToolCall;
  usage: GeminiUsage;
  finishReason: string;
  attemptCount: number;
}

export interface GeminiError extends Error {
  kind:
    | "config"
    | "http"
    | "malformed"
    | "empty"
    | "schema"
    | "unsupported_input";
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
  /**
   * #3355 evaluation-only override. Runtime callers omit this. A candidate is
   * accepted only when the operator has explicitly listed it in the local
   * ARI_EVAL_GEMINI_MODEL_ALLOWLIST secret, so a user request can never steer
   * production traffic to an arbitrary provider model.
   */
  evaluationModelId?: string;
}): Promise<GeminiResult> {
  // Compile before secret lookup or network access so provider-contract drift
  // fails locally, deterministically, and without exposing request data.
  const functionDeclarations = compileGeminiToolDeclarations(args.tools);

  // #3355 local verification lane. It is opt-in, accepts only an uncredentialed
  // loopback Ollama endpoint, and never becomes a silent production fallback.
  // Production remains pinned to the isolated Gemini key below.
  const localModel = localModelConfig();
  if (localModel) {
    if (
      args.evaluationModelId && args.evaluationModelId !== localModel.modelId
    ) {
      throw makeError(
        "config",
        "The requested evaluation model is not the configured local Ari model.",
      );
    }
    return await callLocalOllama(localModel, {
      systemPrompt: args.systemPrompt,
      contents: args.contents,
      toolDefinitions: args.tools,
    });
  }

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
  let requestUrl = geminiGenerateContentUrl();
  if (args.evaluationModelId) {
    const allowed = new Set(
      (Deno.env.get("ARI_EVAL_GEMINI_MODEL_ALLOWLIST") ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean),
    );
    if (!allowed.has(args.evaluationModelId)) {
      throw makeError(
        "config",
        "Evaluation model is not in ARI_EVAL_GEMINI_MODEL_ALLOWLIST.",
      );
    }
    requestUrl = geminiGenerateContentUrl(args.evaluationModelId);
  }

  // issue #3605 — one chokepoint, both shape rules. Every caller of callGemini
  // (the first hop, the read follow-up, and any future hop) gets a transcript
  // Gemini 3.x will accept: no unsigned functionCall, no orphan
  // functionResponse. Enforced HERE rather than at each call site because a
  // call site that forgets it does not fail loudly — it returns a 400 the
  // follow-up's catch swallows into "Here's what I found."
  const contents = sanitizeGeminiContents(args.contents);

  const requestBody = {
    contents,
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
      // issue #3526 — Gemini 3 removed `thinkingBudget`. Without an explicit
      // thinking_level a 3.x model defaults to `medium` and bills the thinking
      // tokens as OUTPUT. Set it, never inherit it.
      thinkingConfig: { thinking_level: GEMINI_THINKING_LEVEL_MINIMAL },
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
    const response = await fetch(`${requestUrl}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // ORCH-1201-R2 Layer-C: capture the Gemini depletion fingerprint. A 429 with
      // error.status=RESOURCE_EXHAUSTED is true quota exhaustion (vs transient).
      // issue #3526 M-3: this used to fire ONLY on 429, so the 17-Sep 403 and the
      // 21-Sep 404 both recorded error_code=NULL and were unmatchable by any
      // depletion/retirement signal. Fingerprint EVERY refusal class now.
      const depErr = geminiErrorFingerprint(response.status, text);
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
    const toolCalls: GeminiToolCall[] = [];
    let textParts: string[] = [];
    for (const part of parts) {
      if ("functionCall" in part && part.functionCall) {
        // issue #3605 — Gemini 3.x puts the signature on the PART (sibling of
        // `functionCall`); older shapes nested it. Read both, keep whichever
        // exists, and never invent one: an absent signature is a fact the
        // repair pass downstream has to act on, not a field to fabricate.
        const signature = typeof part.thoughtSignature === "string"
          ? part.thoughtSignature
          : typeof part.functionCall.thoughtSignature === "string"
          ? part.functionCall.thoughtSignature
          : undefined;
        toolCalls.push({
          name: part.functionCall.name,
          args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          ...(signature ? { thoughtSignature: signature } : {}),
        });
      } else if ("text" in part && typeof part.text === "string") {
        textParts.push(part.text);
      }
    }

    const toolCall = toolCalls.at(-1);
    if (!toolCall && textParts.length === 0) {
      // Empty response — final attempt
      if (attempt <= MAX_MALFORMED_RETRIES) continue;
      throw makeError("empty", "Gemini returned no usable content", {
        detail: `finishReason=${lastFinishReason}`,
      });
    }

    return {
      textResponse: textParts.length > 0 ? textParts.join("") : undefined,
      toolCalls,
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
        | { text: string; thoughtSignature?: string }
        | {
          // issue #3605 — model this explicitly. While the signature was not
          // in this interface the parser could not see it, so every echoed
          // call went out unsigned and every follow-up turn 400'd.
          functionCall: {
            name: string;
            args?: Record<string, unknown>;
            thoughtSignature?: string;
          };
          thoughtSignature?: string;
        }
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

interface OllamaToolCall {
  function?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_name?: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaResponse {
  message?: {
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function modelVersionFromEnvironment(): string {
  try {
    return Deno.env.get("ARI_LOCAL_MODEL_ENABLED") === "true"
      ? `local:${Deno.env.get("ARI_LOCAL_MODEL_ID") ?? "qwen3:4b-instruct"}`
      : GEMINI_MODEL_ID;
  } catch (error) {
    if (
      error instanceof Deno.errors.PermissionDenied ||
      (error instanceof Error && error.name === "NotCapable")
    ) return GEMINI_MODEL_ID;
    throw error;
  }
}

function localModelConfig(): { baseUrl: string; modelId: string } | null {
  if (Deno.env.get("ARI_LOCAL_MODEL_ENABLED") !== "true") return null;

  const rawBaseUrl = Deno.env.get("ARI_LOCAL_MODEL_BASE_URL") ??
    "http://host.docker.internal:11434";
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw makeError("config", "ARI_LOCAL_MODEL_BASE_URL is invalid.");
  }
  const allowedHosts = new Set([
    "host.docker.internal",
    "127.0.0.1",
    "localhost",
  ]);
  if (
    parsed.protocol !== "http:" || !allowedHosts.has(parsed.hostname) ||
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    (parsed.port && parsed.port !== "11434")
  ) {
    throw makeError(
      "config",
      "Ari's local model endpoint must be an uncredentialed loopback Ollama URL on port 11434.",
    );
  }
  const modelId = (Deno.env.get("ARI_LOCAL_MODEL_ID") ?? "qwen3:4b-instruct")
    .trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(modelId)) {
    throw makeError("config", "ARI_LOCAL_MODEL_ID is invalid.");
  }
  return { baseUrl: parsed.origin, modelId };
}

function toOllamaMessages(
  systemPrompt: string,
  contents: GeminiContentMessage[],
): OllamaMessage[] {
  const unsupportedInlineData = contents.some((content) =>
    content.parts.some((part) =>
      "inlineData" in part &&
      !part.inlineData.mimeType.toLowerCase().startsWith("image/")
    )
  );
  if (unsupportedInlineData) {
    // Ollama's chat wire format accepts image bytes, but not audio, video, or
    // arbitrary document bytes. Silently dropping those parts would let Ari
    // answer as though it had inspected evidence it never received.
    throw makeError(
      "unsupported_input",
      "Ari’s current local test model can’t read this attachment type. The upload is safe and still here; use the production multimodal model or attach an image or text file for this local test.",
    );
  }
  const messages: OllamaMessage[] = [{
    role: "system",
    content: systemPrompt,
  }];

  for (const content of contents) {
    const text = content.parts.flatMap((part) =>
      "text" in part ? [part.text] : []
    ).join("\n").trim();
    const images = content.parts.flatMap((part) =>
      "inlineData" in part && part.inlineData.mimeType.startsWith("image/")
        ? [part.inlineData.data]
        : []
    );
    const toolCalls = content.parts.flatMap((part) =>
      "functionCall" in part
        ? [{
          function: {
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          },
        }]
        : []
    );
    const toolResponses = content.parts.flatMap((part) =>
      "functionResponse" in part
        ? [{
          role: "tool" as const,
          content: JSON.stringify(part.functionResponse.response),
          tool_name: part.functionResponse.name,
        }]
        : []
    );

    if (toolCalls.length > 0 || (content.role === "model" && text)) {
      messages.push({
        role: "assistant",
        content: text,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (content.role === "user" && (text || images.length > 0)) {
      messages.push({
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      });
    }
    messages.push(...toolResponses);
  }
  return messages;
}

async function callLocalOllama(
  config: { baseUrl: string; modelId: string },
  args: {
    systemPrompt: string;
    contents: GeminiContentMessage[];
    toolDefinitions: GeminiToolDef[];
  },
): Promise<GeminiResult> {
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.modelId,
      stream: false,
      // Qwen3's smaller local variants default to a hidden reasoning pass.
      // The Ari loop already owns explicit planning and tool observations, so
      // disabling that pass preserves the worker budget without weakening the
      // production Gemini lane.
      think: false,
      keep_alive: "1h",
      messages: toOllamaMessages(args.systemPrompt, args.contents),
      tools: args.toolDefinitions.map((definition) => ({
        type: "function",
        function: {
          name: definition.name,
          description: definition.description,
          parameters: definition.parameters,
        },
      })),
      options: {
        temperature: TEMPERATURE,
        num_predict: LOCAL_MAX_OUTPUT_TOKENS,
      },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw makeError("http", `Local Ari model HTTP ${response.status}`, {
      status: response.status,
      detail,
    });
  }
  const payload = await response.json() as OllamaResponse;
  const toolCalls = (payload.message?.tool_calls ?? []).flatMap((call) => {
    const name = call.function?.name;
    if (!name) return [];
    return [{
      name,
      args: call.function?.arguments ?? {},
    }];
  });
  const textResponse = payload.message?.content?.trim() || undefined;
  if (!textResponse && toolCalls.length === 0) {
    throw makeError("empty", "The local Ari model returned no usable content.");
  }
  const promptTokens = payload.prompt_eval_count ?? 0;
  const completionTokens = payload.eval_count ?? 0;
  return {
    textResponse,
    toolCalls,
    toolCall: toolCalls.at(-1),
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    finishReason: payload.done_reason ?? "stop",
    attemptCount: 1,
  };
}

// Keep importing the provider compiler permission-free. Runtime calls still
// read the full local-model configuration, but schema and contract consumers
// can inspect Ari's production model identity without --allow-env.
export const ARI_MODEL_VERSION = modelVersionFromEnvironment();
