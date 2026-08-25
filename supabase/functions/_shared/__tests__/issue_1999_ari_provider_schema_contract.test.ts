// #1999 — provider-compatible Ari tool declarations.
// Implementor happy path: compile the complete actual registry, preserve the
// canonical execution schemas, and normalize Google's typed int64 fields.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileGeminiToolDeclarations,
  GeminiToolDef,
} from "../agentGemini.ts";
import { AGENT_TOOLS } from "../agentTools.ts";

const PROVIDER_FIELDS = new Set([
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

const INT64_FIELDS = new Set([
  "maxItems",
  "minItems",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
]);

function assertProviderSchema(schema: unknown, pointer = "/parameters"): void {
  assert(
    schema !== null && typeof schema === "object" && !Array.isArray(schema),
  );
  for (
    const [keyword, value] of Object.entries(schema as Record<string, unknown>)
  ) {
    assert(
      PROVIDER_FIELDS.has(keyword),
      `unsupported ${keyword} at ${pointer}`,
    );
    if (INT64_FIELDS.has(keyword)) {
      assertEquals(
        typeof value,
        "string",
        `${keyword} must serialize as int64 string`,
      );
    } else if (keyword === "properties") {
      assert(
        value !== null && typeof value === "object" && !Array.isArray(value),
      );
      for (
        const [name, child] of Object.entries(value as Record<string, unknown>)
      ) {
        assertProviderSchema(child, `${pointer}/properties/${name}`);
      }
    } else if (keyword === "items") {
      assertProviderSchema(value, `${pointer}/items`);
    } else if (keyword === "anyOf") {
      assert(Array.isArray(value));
      value.forEach((child, index) =>
        assertProviderSchema(child, `${pointer}/anyOf/${index}`)
      );
    }
  }
}

function actualRegistry(): GeminiToolDef[] {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

Deno.test("#1999 happy: all 86 actual Ari tools compile for Gemini typed parameters", () => {
  // [TEST-MOD-APPROVED #1975+#1978+#1979] Stay + venue listing + venue manage tools; 77→80.
  // [TEST-MOD-APPROVED #1971] Five trip tools; 85→86. Only the registry-size
  // baseline moves — every schema-compilation assertion is unchanged and now
  // covers the five new declarations too.
  const tools = actualRegistry();
  assertEquals(
    tools.length,
    86,
    "registry baseline changed; provider coverage must be reviewed",
  );

  const compiled = compileGeminiToolDeclarations(tools);

  assertEquals(compiled.length, tools.length);
  assertEquals(
    compiled.map((tool) => tool.name),
    tools.map((tool) => tool.name),
  );
  for (const declaration of compiled) {
    assertProviderSchema(declaration.parameters);
  }

  const createEvent = compiled.find((tool) => tool.name === "create_event");
  assert(createEvent);
  const recurrenceRule = (createEvent.parameters.properties as Record<
    string,
    Record<string, unknown>
  >).recurrence_rule;
  const bySetPos = (recurrenceRule.properties as Record<
    string,
    Record<string, unknown>
  >).bySetPos;
  assertEquals(bySetPos.enum, ["1", "2", "3", "4", "-1"]);
});

Deno.test("#1999 happy: PR #1986 raw schemas fail the provider subset and projections pass", () => {
  const rawDomainTool = actualRegistry().find((tool) =>
    Object.hasOwn(tool.parameters, "additionalProperties")
  );
  assert(
    rawDomainTool,
    "expected a #1986 domain schema with additionalProperties",
  );

  assertThrows(
    () => assertProviderSchema(rawDomainTool.parameters),
    Error,
    "additionalProperties",
  );

  const [compiled] = compileGeminiToolDeclarations([rawDomainTool]);
  assertProviderSchema(compiled.parameters);
  assert(!JSON.stringify(compiled.parameters).includes("additionalProperties"));
});

Deno.test("#1999 happy: compilation is non-mutating and int64-normalizing", () => {
  const tools = actualRegistry();
  const canonicalBefore = JSON.parse(JSON.stringify(tools)) as GeminiToolDef[];

  const compiled = compileGeminiToolDeclarations(tools);

  assertEquals(
    tools,
    canonicalBefore,
    "canonical execution schemas were mutated",
  );
  const createTrip = compiled.find((tool) => tool.name === "create_trip");
  assert(createTrip);
  const title = (createTrip.parameters.properties as Record<
    string,
    Record<string, unknown>
  >).title;
  assertEquals(title.minLength, "1");
  assertEquals(title.maxLength, "500");
});

Deno.test("#1999 happy: numeric enums normalize narrowly and invalid enum members fail closed", () => {
  const [compiled] = compileGeminiToolDeclarations([{
    name: "numeric_enum",
    description: "Numeric enum projection",
    parameters: {
      type: "object",
      properties: {
        ordinal: { type: "integer", enum: [1, -1] },
      },
    },
  }]);
  const ordinal = (compiled.parameters.properties as Record<
    string,
    Record<string, unknown>
  >).ordinal;
  assertEquals(ordinal.enum, ["1", "-1"]);

  for (const invalidEnum of [[1, "2"], [true], [Number.NaN], [1.5]]) {
    assertThrows(
      () =>
        compileGeminiToolDeclarations([{
          name: "invalid_numeric_enum",
          description: "Invalid numeric enum",
          parameters: {
            type: "integer",
            enum: invalidEnum,
          },
        }]),
      Error,
      "keyword=enum",
    );
  }
});
