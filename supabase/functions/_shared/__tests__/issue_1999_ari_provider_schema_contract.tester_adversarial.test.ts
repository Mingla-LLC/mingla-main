// #1999 — independent tester adversarial guard for the Gemini Schema boundary.
// Different angle from the implementor's actual-registry happy path: hostile
// future schemas must fail closed before fetch, error values must stay private,
// and both agent-chat model-call sites must surface the same friendly response.

import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  callGemini,
  compileGeminiToolDeclarations,
  GeminiError,
  GeminiToolDef,
} from "../agentGemini.ts";
import { AGENT_TOOLS } from "../agentTools.ts";

const AGENT_CHAT_SOURCE_URL = new URL(
  "../../agent-chat/index.ts",
  import.meta.url,
);

function actualRegistry(): GeminiToolDef[] {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function hostileTool(
  parameters: Record<string, unknown>,
  name = "future_inventory_export",
): GeminiToolDef {
  return {
    name,
    description: "Future registry tool used only by the #1999 adversarial test",
    parameters,
  };
}

function captureSchemaError(tool: GeminiToolDef): GeminiError {
  try {
    compileGeminiToolDeclarations([tool]);
  } catch (error) {
    assert(error instanceof Error);
    assertEquals((error as GeminiError).kind, "schema");
    return error as GeminiError;
  }
  throw new Error("hostile schema unexpectedly compiled");
}

Deno.test("#1999 tester: a future registry tool with a deeply nested unsupported field fails with an escaped pointer", () => {
  const future = hostileTool({
    type: "object",
    properties: {
      payload: {
        type: "array",
        items: {
          type: "object",
          properties: {
            "line/items~raw": {
              type: "string",
              $ref: "SENSITIVE_PROVIDER_VALUE",
            },
          },
        },
      },
    },
  });

  const error = captureSchemaError(future);
  assertStringIncludes(error.message, "tool=future_inventory_export");
  assertStringIncludes(
    error.message,
    "/parameters/properties/payload/items/properties/line~1items~0raw/$ref",
  );
  assertStringIncludes(error.message, "keyword=$ref");
  assertFalse(error.message.includes("SENSITIVE_PROVIDER_VALUE"));
  assertFalse(error.detail?.includes("SENSITIVE_PROVIDER_VALUE") ?? false);

  // Appending a future tool must validate the newly added declaration too; a
  // compiler that freezes or slices the original registry would miss this.
  const registryPlusFuture = [...actualRegistry(), future];
  let appendedError: GeminiError | null = null;
  try {
    compileGeminiToolDeclarations(registryPlusFuture);
  } catch (caught) {
    appendedError = caught as GeminiError;
  }
  assert(appendedError);
  assertEquals(appendedError.kind, "schema");
  assertStringIncludes(appendedError.message, "future_inventory_export");
});

Deno.test("#1999 tester: invalid additionalProperties values are rejected without value leakage", () => {
  const hostileValues: unknown[] = [true, null, {}, "SENSITIVE_AP_VALUE"];
  for (const value of hostileValues) {
    const error = captureSchemaError(hostileTool({
      type: "object",
      additionalProperties: value,
    }));
    assertStringIncludes(error.message, "/parameters/additionalProperties");
    assertStringIncludes(error.message, "keyword=additionalProperties");
    assertStringIncludes(error.message, "only false can be consumed");
    assertFalse(error.message.includes("SENSITIVE_AP_VALUE"));
    assertFalse(error.detail?.includes("SENSITIVE_AP_VALUE") ?? false);
  }
});

Deno.test("#1999 tester: provider keyword types and int64 encodings fail closed", () => {
  const cases: Array<{
    keyword: string;
    parameters: Record<string, unknown>;
  }> = [
    { keyword: "type", parameters: { type: 7 } },
    { keyword: "nullable", parameters: { type: "object", nullable: "false" } },
    {
      keyword: "required",
      parameters: { type: "object", required: ["ok", 7] },
    },
    { keyword: "properties", parameters: { type: "object", properties: [] } },
    { keyword: "items", parameters: { type: "array", items: "not-a-schema" } },
    { keyword: "anyOf", parameters: { anyOf: { type: "string" } } },
    { keyword: "minLength", parameters: { type: "string", minLength: -1 } },
    { keyword: "maxItems", parameters: { type: "array", maxItems: 1.5 } },
    {
      keyword: "maxProperties",
      parameters: { type: "object", maxProperties: "01" },
    },
    {
      keyword: "minProperties",
      parameters: { type: "object", minProperties: "9223372036854775808" },
    },
    { keyword: "minimum", parameters: { type: "number", minimum: "0" } },
    { keyword: "description", parameters: { type: "string", description: 42 } },
  ];

  for (const testCase of cases) {
    const error = captureSchemaError(hostileTool(testCase.parameters));
    assertStringIncludes(error.message, `path=/parameters/${testCase.keyword}`);
  }
});

Deno.test("#1999 tester: schema drift rejects before key lookup or fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error("NETWORK_MUST_NOT_RUN");
  }) as typeof fetch;

  try {
    let error: GeminiError | null = null;
    try {
      await callGemini({
        systemPrompt: "SENSITIVE_PROMPT_MUST_NOT_LEAK",
        contents: [{
          role: "user",
          parts: [{ text: "SENSITIVE_USER_DATA_MUST_NOT_LEAK" }],
        }],
        tools: [hostileTool({
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: { type: "string", additionalProperties: true },
            },
          },
        })],
      });
    } catch (caught) {
      error = caught as GeminiError;
    }

    assert(error);
    assertEquals(error.kind, "schema");
    assertEquals(
      fetchCalls,
      0,
      "provider fetch ran despite local schema rejection",
    );
    assertFalse(error.message.includes("SENSITIVE_PROMPT_MUST_NOT_LEAK"));
    assertFalse(error.message.includes("SENSITIVE_USER_DATA_MUST_NOT_LEAK"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("#1999 tester: initial and read-follow-up calls share the sanitized schema-error response", async () => {
  const source = await Deno.readTextFile(AGENT_CHAT_SOURCE_URL);
  const initialStart = source.indexOf("// Call Gemini");
  const initialEnd = source.indexOf("// Branch on tool call vs text");
  const followupStart = source.indexOf(
    "// Follow-up Gemini call to summarise the read result",
  );
  const followupEnd = source.indexOf("const text = followup?.textResponse");
  assert(initialStart >= 0 && initialEnd > initialStart);
  assert(followupStart >= 0 && followupEnd > followupStart);

  const initialBoundary = source.slice(initialStart, initialEnd);
  const followupBoundary = source.slice(followupStart, followupEnd);
  for (const boundary of [initialBoundary, followupBoundary]) {
    assertStringIncludes(boundary, "callGemini({");
    assertStringIncludes(boundary, "schemaErrorResponse(err)");
    assertMatch(
      boundary,
      /const schemaResponse = schemaErrorResponse\(err\);\s*if \(schemaResponse\) return schemaResponse;/s,
    );
  }
  assertEquals(
    source.match(/\bcallGemini\(\{/g)?.length,
    2,
    "every agent-chat model call must be reviewed when the boundary count changes",
  );

  const helperStart = source.indexOf("function schemaErrorResponse");
  const helperEnd = source.indexOf("\nDeno.serve", helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assertMatch(
    helper,
    /return errorResponse\(\s*500,\s*"MODEL_SCHEMA_INVALID",\s*"Ari's tools need an update before chat can continue\. Please try again later\."\s*,?\s*\);/s,
  );
  assertFalse(
    /return errorResponse\([\s\S]*geminiError\.(?:message|detail)/.test(helper),
    "provider detail was interpolated into the user response",
  );
});
