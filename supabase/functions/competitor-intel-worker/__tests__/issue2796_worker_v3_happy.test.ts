import { assertEquals, assertThrows } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildDecisionFoundation,
  buildObservationComparisons,
  canFinishAsNoChange,
  primaryActionFirst,
  PROMPT_CONTRACT_VERSION,
  PROVIDER_RESPONSE_SCHEMA,
  synthesizeBrief,
  validateDecisionReport,
} from "../index.ts";

const observations = [{
  sourceId: "11111111-1111-4111-8111-111111111111",
  kind: "instagram",
  facts: {
    profile: { name: "Shiro", bio: "Pan-Asian dining" },
    items: [{ format: "image", caption_excerpt: "Weekend tasting menu" }],
    cadence: { posts_7d: 1, posts_28d: 1 },
  },
  checkedAt: "2026-08-29T00:00:00.000Z",
  latestObservedAt: "2026-08-28T00:00:00.000Z",
  publicUrl: "https://instagram.com/shiro",
  fingerprint: "a".repeat(64),
}];
const venue = {
  listing: { id: "22222222-2222-4222-8222-222222222222", name: "Gogi", city: "Lagos", venue_category: "restaurant" },
  brand_published_events: [{ id: "33333333-3333-4333-8333-333333333333", title: "Korean supper", description: "A tasting event" }],
};

Deno.test("issue 2796 derives bounded evidence, cadence, format, delta and owner facts without AI", () => {
  const comparisons = buildObservationComparisons(observations, [{ source_id: observations[0].sourceId, facts: { profile: { bio: "Old bio" } }, checked_at: "2026-08-22T00:00:00.000Z" }]);
  const foundation = buildDecisionFoundation(observations, comparisons, venue);
  assertEquals(foundation.signal_evidence.length, 1);
  assertEquals(foundation.signal_evidence[0].source_url, observations[0].publicUrl);
  assertEquals(foundation.signals.map((item) => item.kind), ["profile", "delta", "cadence", "format"]);
  assertEquals(foundation.signals[1].changed_paths, ["cadence", "items", "profile.bio", "profile.name"]);
  assertEquals(foundation.owner_facts.length, 3);
});

Deno.test("issue 2796 accepts one exact grounded decision report and rejects unknown keys", () => {
  const foundation = buildDecisionFoundation(observations, buildObservationComparisons(observations, []), venue);
  const brief = {
    why_it_matters: [{ text: "The competitor is active.", evidence_ids: ["e1"], confidence: "interpretation" }],
    worth_doing: [{ id: "a1", text: "Publish a clear event offer.", kind: "event", confidence: "suggested_action", is_primary: true }],
    evidence: [{ id: "e1", source_id: observations[0].sourceId, public_url: observations[0].publicUrl, checked_at: observations[0].checkedAt, observed_at: observations[0].latestObservedAt, observation: "Instagram post" }],
  };
  const report = {
    ...foundation,
    decision: { class: "act", confidence: "medium", headline: "A clear offer is gaining visibility", rationale: "Respond with a verified event offer.", signal_ids: ["s-instagram-1"], owner_fact_ids: ["of-listing-category"] },
    interpretation_meta: [{ index: 0, signal_type: "threat", confidence: "medium", priority: "high", signal_ids: ["s-instagram-1"], owner_fact_ids: ["of-listing-category"] }],
    comparisons: [{ id: "c1", dimension: "event_theme", owner_text: "Korean supper", competitor_text: "Weekend tasting menu", outcome: "different", confidence: "medium", signal_ids: ["s-instagram-1"], owner_fact_ids: ["of-event-title-33333333-3333-4333-8333-333333333333"] }],
    action_plan: [{ index: 0, action_id: "a1", timeframe: "this_week", impact: "high", confidence: "medium", order: 1, is_primary: true, signal_ids: ["s-instagram-1"], owner_fact_ids: ["of-listing-category"] }],
  };
  // Align the comparison with the signal's deterministic dimension.
  report.comparisons[0].dimension = "positioning";
  report.comparisons[0].owner_fact_ids = [];
  report.comparisons[0].outcome = "not_comparable";
  validateDecisionReport(report, brief, observations);
  assertThrows(() => validateDecisionReport({ ...report, unknown: true }, brief, observations));
});

Deno.test("issue 2796 worker keeps deterministic one-call and cost bounds in source", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertEquals(source.includes("maxOutputTokens: MAX_SYNTHESIS_OUTPUT_TOKENS"), true);
  assertEquals(source.includes("temperature: 0"), true);
  // issue #3526: Gemini 3 replaced thinkingBudget with thinking_level.
  assertEquals(
    source.includes(
      "thinkingConfig: { thinking_level: GEMINI_THINKING_LEVEL_MINIMAL }",
    ),
    true,
  );
  assertEquals(source.includes("candidateCount: 1"), true);
  assertEquals(source.includes("MAX_SYNTHESIS_REQUEST_BYTES = 65_536"), true);
  assertEquals(source.includes("RESERVED_MICROUSD = 50_000"), true);
});

Deno.test("issue 2811 upgrades unchanged legacy briefs once and keeps unchanged v3 checks free", () => {
  const fingerprint = "a".repeat(64);
  assertEquals(
    canFinishAsNoChange({
      observation_set_fingerprint: fingerprint,
      schema_version: 2,
    }, fingerprint),
    false,
  );
  assertEquals(
    canFinishAsNoChange({
      observation_set_fingerprint: fingerprint,
      schema_version: null,
    }, fingerprint),
    false,
  );
  assertEquals(
    canFinishAsNoChange({
      observation_set_fingerprint: fingerprint,
      schema_version: 3,
    }, fingerprint),
    true,
  );
  assertEquals(
    canFinishAsNoChange({
      observation_set_fingerprint: "b".repeat(64),
      schema_version: 3,
    }, fingerprint),
    false,
  );
});

Deno.test("issue 2814 accepts the bounded provider schema and grounds legacy-upgrade references", async () => {
  const previous = Deno.env.get("GEMINI_API_KEY");
  try {
    Deno.env.set("GEMINI_API_KEY", "test");
    assertEquals(PROMPT_CONTRACT_VERSION, "competitor-brief-v3.4");
    const serializedSchema = JSON.stringify(PROVIDER_RESPONSE_SCHEMA);
    for (const forbidden of [
      "minItems",
      "maxItems",
      "minimum",
      "maximum",
    ]) {
      assertEquals(serializedSchema.includes(`\"${forbidden}\"`), false);
    }
    const unchanged = buildObservationComparisons(observations, [{
      source_id: observations[0].sourceId,
      facts: observations[0].facts,
      checked_at: "2026-08-22T00:00:00.000Z",
    }]);
    let requestSchema: unknown = null;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSchema = JSON.parse(String(init?.body)).generationConfig
        .responseJsonSchema;
      return new Response(JSON.stringify({
        candidates: [{
          finishReason: "STOP",
          content: {
            parts: [{
              text: JSON.stringify({
                what_changed: [],
                why_it_matters: [{
                  text: "The public positioning may compete for the same dining occasion.",
                  evidence_ids: ["e1"],
                  confidence: "interpretation",
                }],
                worth_doing: [{
                  id: "a2",
                  text: "Prepare a longer-term menu update.",
                  kind: "menu",
                  confidence: "suggested_action",
                  is_primary: false,
                }, {
                  id: "a1",
                  text: "Publish one specific event offer this week.",
                  kind: "event",
                  confidence: "suggested_action",
                  is_primary: true,
                }],
                decision: {
                  class: "watch",
                  confidence: "medium",
                  headline: "The competitor maintains clear positioning",
                  rationale: "Its current public profile remains consistent.",
                  signal_ids: [
                    "s-instagram-1",
                    "s-cadence-1",
                    "unknown-signal",
                    "s-format-1",
                  ],
                  owner_fact_ids: ["of-listing-category"],
                },
                theme_signals: [],
                interpretation_meta: [{
                  index: 9,
                  signal_type: "neutral",
                  confidence: "medium",
                  priority: "medium",
                  signal_ids: ["s-instagram-1", "unknown-signal"],
                  owner_fact_ids: ["of-listing-category"],
                }],
                comparisons: [{
                  id: "bad-cross-dimension",
                  dimension: "positioning",
                  owner_text: "restaurant",
                  competitor_text: "Pan-Asian dining",
                  outcome: "different",
                  confidence: "medium",
                  signal_ids: ["s-instagram-1"],
                  owner_fact_ids: ["of-listing-category"],
                }],
                action_plan: [{
                  index: 0,
                  action_id: "a2",
                  timeframe: "this_month",
                  impact: "medium",
                  confidence: "low",
                  order: 1,
                  is_primary: false,
                  signal_ids: ["s-instagram-1", "unknown-signal"],
                  owner_fact_ids: ["of-listing_category"],
                }, {
                  index: 1,
                  action_id: "a1",
                  timeframe: "this_week",
                  impact: "high",
                  confidence: "medium",
                  order: 2,
                  is_primary: true,
                  signal_ids: ["s-instagram-1"],
                  owner_fact_ids: [],
                }],
              }),
            }],
          },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 0,
          totalTokenCount: 200,
        },
        modelVersion: "gemini-3.6-flash",
      }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const brief = await synthesizeBrief(
      "Shiro",
      "Lagos",
      observations,
      unchanged,
      venue,
      fetcher,
    );
    assertEquals(requestSchema, PROVIDER_RESPONSE_SCHEMA);
    assertEquals(brief.what_changed.length, 1);
    assertEquals(brief.decision_report.comparisons[0].outcome, "not_comparable");
    assertEquals(
      (brief.decision_report.decision.signal_ids as string[]).length,
      3,
    );
    assertEquals(brief.decision_report.interpretation_meta[0].index, 0);
    assertEquals(
      (brief.worth_doing as Array<Record<string, unknown>>).map((action) =>
        action.id
      ),
      ["a1", "a2"],
    );
    assertEquals(brief.decision_report.action_plan[0].action_id, "a1");
    assertEquals(brief.decision_report.action_plan[0].is_primary, true);
    assertEquals(brief.decision_report.action_plan[0].timeframe, "this_week");
    assertEquals(brief.decision_report.action_plan[0].owner_fact_ids, []);
    assertEquals(brief.decision_report.action_plan[1].action_id, "a2");
    assertEquals(brief.decision_report.action_plan[1].timeframe, "this_month");
  } finally {
    previous === undefined
      ? Deno.env.delete("GEMINI_API_KEY")
      : Deno.env.set("GEMINI_API_KEY", previous);
  }
});

Deno.test("issue 2817 grounds every malformed theme and comparison field before strict validation", async () => {
  const previous = Deno.env.get("GEMINI_API_KEY");
  try {
    Deno.env.set("GEMINI_API_KEY", "test");
    const unchanged = buildObservationComparisons(observations, [{
      source_id: observations[0].sourceId,
      facts: observations[0].facts,
      checked_at: "2026-08-22T00:00:00.000Z",
    }]);
    const longText = "A grounded positioning theme ".repeat(20);
    const duplicateLongId = "comparison-id-".repeat(10);
    const fetcher = (async () =>
      new Response(JSON.stringify({
        candidates: [{
          finishReason: "STOP",
          content: {
            parts: [{
              text: JSON.stringify({
                what_changed: [],
                why_it_matters: [{
                  text:
                    "The public positioning may compete for the same dining occasion.",
                  evidence_ids: ["e1"],
                  confidence: "interpretation",
                }],
                worth_doing: [{
                  id: "a1",
                  text: "Publish one specific event offer this week.",
                  kind: "event",
                  confidence: "suggested_action",
                  is_primary: true,
                }],
                decision: {
                  class: "invalid-class",
                  confidence: "certain",
                  headline: "\u0000\u0000",
                  rationale: " ",
                  signal_ids: ["theme-one", "unknown-signal"],
                  owner_fact_ids: ["unknown-owner"],
                  unexpected: true,
                },
                theme_signals: [{
                  id: "theme-one",
                  kind: "content",
                  derivation: "deterministic",
                  dimension: "positioning",
                  label: "  Pan-Asian\u0000 positioning  ",
                  summary: longText,
                  source_id: "unknown-source",
                  evidence_ids: ["e1", "e1", "unknown-evidence"],
                  metrics: {
                    posts_7d: -1,
                    posts_28d: 999,
                    images_28d: "many",
                    videos_28d: 4,
                    extra: true,
                  },
                  changed_paths: ["invented.path", "x".repeat(100)],
                  unexpected: true,
                }, {
                  id: "theme-one",
                  kind: "theme",
                  derivation: "synthesis",
                  dimension: "content_cadence",
                  label: "Steady content cadence",
                  summary: "The account keeps a visible publishing rhythm.",
                  source_id: observations[0].sourceId,
                  evidence_ids: ["e1"],
                  metrics: {},
                  changed_paths: ["cadence.posts_7d"],
                }, {
                  id: "theme-three",
                  kind: "theme",
                  derivation: "synthesis",
                  dimension: "offer",
                  label: "Third theme",
                  summary: "This record must be discarded by the two-theme bound.",
                  source_id: observations[0].sourceId,
                  evidence_ids: ["e1"],
                  metrics: {},
                  changed_paths: [],
                }],
                interpretation_meta: [{
                  index: 99,
                  signal_type: "certain-threat",
                  confidence: "certain",
                  priority: "urgent",
                  signal_ids: ["theme-one", "unknown-signal"],
                  owner_fact_ids: ["unknown-owner"],
                  unexpected: true,
                }],
                comparisons: [{
                  id: duplicateLongId,
                  dimension: "positioning",
                  owner_text: "\u0000".repeat(150),
                  competitor_text: longText,
                  outcome: "winner",
                  confidence: "certain",
                  signal_ids: ["theme-one", "theme-one", "unknown-signal"],
                  owner_fact_ids: ["of-listing-category", "unknown-owner"],
                  unexpected: true,
                }, {
                  id: duplicateLongId,
                  dimension: "not-a-dimension",
                  owner_text: "No matching venue fact",
                  competitor_text: "Current public profile",
                  outcome: "not_comparable",
                  confidence: "medium",
                  signal_ids: ["s-instagram-1", "unknown-signal"],
                  owner_fact_ids: [],
                  extra: "drop-me",
                }],
                action_plan: [{
                  index: 12,
                  action_id: "wrong-action",
                  timeframe: "someday",
                  impact: "massive",
                  confidence: "certain",
                  order: 99,
                  is_primary: false,
                  signal_ids: ["theme-one", "unknown-signal"],
                  owner_fact_ids: ["unknown-owner"],
                  unexpected: true,
                }],
              }),
            }],
          },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 100,
          thoughtsTokenCount: 0,
          totalTokenCount: 200,
        },
        modelVersion: "gemini-3.6-flash",
      }), { headers: { "content-type": "application/json" } })) as typeof fetch;

    const brief = await synthesizeBrief(
      "Shiro",
      "Lagos",
      observations,
      unchanged,
      venue,
      fetcher,
    );
    const report = brief.decision_report;
    const themes = report.signals.filter((signal) =>
      signal.derivation === "synthesis"
    );
    assertEquals(themes.length, 2);
    assertEquals(themes[0], {
      id: "theme-one",
      kind: "theme",
      derivation: "synthesis",
      dimension: "positioning",
      label: "Pan-Asian positioning",
      summary: longText.replace(/\s+/g, " ").trim().slice(0, 180),
      source_id: observations[0].sourceId,
      evidence_ids: ["e1"],
      metrics: {
        posts_7d: null,
        posts_28d: null,
        images_28d: null,
        videos_28d: null,
      },
      changed_paths: [],
    });
    assertEquals(themes[1].id, "s-theme-2");
    assertEquals(Object.keys(themes[1]).sort(), [
      "changed_paths",
      "derivation",
      "dimension",
      "evidence_ids",
      "id",
      "kind",
      "label",
      "metrics",
      "source_id",
      "summary",
    ]);
    assertEquals(report.decision.class, "watch");
    assertEquals(report.decision.confidence, "low");
    assertEquals(report.decision.headline, "Competitor signal reviewed");
    assertEquals(report.comparisons.length, 2);
    assertEquals(report.comparisons[0].outcome, "not_comparable");
    assertEquals(report.comparisons[0].confidence, "low");
    assertEquals(report.comparisons[0].owner_fact_ids, []);
    assertEquals(report.comparisons[0].signal_ids, ["theme-one"]);
    assertEquals(String(report.comparisons[0].competitor_text).length, 140);
    assertEquals(report.comparisons[1].id, "c-grounded-2");
    assertEquals(report.comparisons[1].dimension, "positioning");
    assertEquals(Object.keys(report.comparisons[1]).sort(), [
      "competitor_text",
      "confidence",
      "dimension",
      "id",
      "outcome",
      "owner_fact_ids",
      "owner_text",
      "signal_ids",
    ]);
    assertEquals(JSON.stringify(report).includes("unexpected"), false);
    validateDecisionReport(report, brief, observations);
  } finally {
    previous === undefined
      ? Deno.env.delete("GEMINI_API_KEY")
      : Deno.env.set("GEMINI_API_KEY", previous);
  }
});

Deno.test("issue 2820 makes the sole primary action first before report bindings", () => {
  const actions = primaryActionFirst([{
    id: "a-secondary",
    text: "Prepare a longer-term menu update.",
    kind: "menu",
    confidence: "suggested_action",
    is_primary: false,
  }, {
    id: "a-primary",
    text: "Publish one specific offer this week.",
    kind: "offer",
    confidence: "suggested_action",
    is_primary: true,
  }, {
    id: "a-third",
    text: "Review future event positioning.",
    kind: "event",
    confidence: "suggested_action",
    is_primary: false,
  }]) as Array<Record<string, unknown>>;
  assertEquals(actions.map((action) => action.id), [
    "a-primary",
    "a-secondary",
    "a-third",
  ]);
  assertEquals(actions.map((action) => action.is_primary), [true, false, false]);
});

// ══════════════════════════════════════════════════════════════════════════
// issue #3541 — the synthesis output budget
// ══════════════════════════════════════════════════════════════════════════
import { assertRejects } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  MAX_SYNTHESIS_OUTPUT_TOKENS,
  RESULT_CLASS_OUTPUT_BUDGET_EXCEEDED,
  SYNTHESIS_OUTPUT_CHARS_PER_TOKEN,
  synthesisOutputTokenHeadroom,
  synthesisWorstCaseOutputChars,
  synthesisWorstCaseOutputTokens,
  validateBrief,
} from "../index.ts";

// Every array the schema declares, as [dotted path, node].
function issue3541SchemaArrays(
  node: unknown,
  path = "$",
  found: Array<[string, Record<string, any>]> = [],
): Array<[string, Record<string, any>]> {
  if (!node || typeof node !== "object") return found;
  const schema = node as Record<string, any>;
  if (schema.type === "array") {
    found.push([path, schema]);
    issue3541SchemaArrays(schema.items, `${path}[]`, found);
  } else if (schema.type === "object") {
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      issue3541SchemaArrays(value, `${path}.${key}`, found);
    }
  }
  return found;
}

// Every free-text string the schema declares (enums carry their own bound).
function issue3541SchemaFreeTextStrings(
  node: unknown,
  path = "$",
  found: Array<[string, Record<string, any>]> = [],
): Array<[string, Record<string, any>]> {
  if (!node || typeof node !== "object") return found;
  const schema = node as Record<string, any>;
  if (schema.type === "string" && !Array.isArray(schema.enum)) {
    found.push([path, schema]);
  } else if (schema.type === "array") {
    issue3541SchemaFreeTextStrings(schema.items, `${path}[]`, found);
  } else if (schema.type === "object") {
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      issue3541SchemaFreeTextStrings(value, `${path}.${key}`, found);
    }
  }
  return found;
}

const issue3541Observations = [{
  sourceId: "11111111-1111-4111-8111-111111111111",
  kind: "website",
  facts: { profile: { name: "Shiro", bio: "Pan-Asian dining" } },
  checkedAt: "2026-09-22T00:00:00.000Z",
  latestObservedAt: null,
  publicUrl: "https://example.com",
  fingerprint: "c".repeat(64),
}];

// A brief validateBrief accepts, with the three model-supplied arrays set to
// whatever lengths the caller asks for. Used to RECOVER validateBrief's bounds
// by observation instead of restating them, so a schema bound and the validator
// cannot drift apart and both still look right.
function issue3541BriefWithLengths(
  facts: number,
  interpretations: number,
  actions: number,
) {
  return {
    what_changed: Array.from({ length: facts }, (_unused, index) => ({
      id: `f${index + 1}`,
      text: `A public detail changed on the site, item ${index + 1}.`,
      source_id: issue3541Observations[0].sourceId,
      evidence_id: "e1",
      confidence: "observed",
    })),
    why_it_matters: Array.from(
      { length: interpretations },
      (_unused, index) => ({
        text: `This reads as a shift in their weekend positioning, ${
          index + 1
        }.`,
        evidence_ids: ["e1"],
        confidence: "interpretation",
      }),
    ),
    worth_doing: Array.from({ length: actions }, (_unused, index) => ({
      id: `a${index + 1}`,
      text: `Publish one specific weekend offer, option ${index + 1}.`,
      kind: "offer",
      confidence: "suggested_action",
      // validateBrief demands exactly one primary action.
      is_primary: index === 0,
    })),
    evidence: [{
      id: "e1",
      source_id: issue3541Observations[0].sourceId,
      public_url: issue3541Observations[0].publicUrl,
      checked_at: issue3541Observations[0].checkedAt,
      observation: "Pan-Asian dining sits in the site header.",
    }],
  };
}

// Scan a length range and report the inclusive window validateBrief accepts.
function issue3541AcceptedRange(
  build: (length: number) => ReturnType<typeof issue3541BriefWithLengths>,
): { min: number; max: number } {
  const accepted: number[] = [];
  for (let length = 0; length <= 6; length++) {
    try {
      validateBrief(build(length), issue3541Observations as never);
      accepted.push(length);
    } catch {
      // rejected at this length
    }
  }
  if (accepted.length === 0) throw new Error("no accepted length");
  return { min: accepted[0], max: accepted[accepted.length - 1] };
}

Deno.test("issue 3541 bounds every schema array and every free-text string", () => {
  const arrays = issue3541SchemaArrays(PROVIDER_RESPONSE_SCHEMA);
  // Guard the guard: if the walker stops finding arrays, the loop below is
  // vacuous and would pass over a completely unbounded schema.
  assertEquals(arrays.length >= 12, true);
  for (const [path, schema] of arrays) {
    assertEquals(
      [path, Number.isInteger(schema.minItems)],
      [path, true],
    );
    assertEquals(
      [path, Number.isInteger(schema.maxItems)],
      [path, true],
    );
    assertEquals([path, schema.maxItems >= schema.minItems], [path, true]);
  }
  const strings = issue3541SchemaFreeTextStrings(PROVIDER_RESPONSE_SCHEMA);
  assertEquals(strings.length >= 20, true);
  for (const [path, schema] of strings) {
    assertEquals([path, Number.isInteger(schema.maxLength)], [path, true]);
  }
});

Deno.test("issue 3541 schema item bounds equal validateBrief's own accepted range", () => {
  // Recovered from validateBrief by probing it, not copied from it.
  const facts = issue3541AcceptedRange((length) =>
    issue3541BriefWithLengths(length, 1, 1)
  );
  const interpretations = issue3541AcceptedRange((length) =>
    issue3541BriefWithLengths(1, length, 1)
  );
  const actions = issue3541AcceptedRange((length) =>
    issue3541BriefWithLengths(1, 1, length)
  );
  const properties = (PROVIDER_RESPONSE_SCHEMA as Record<string, any>)
    .properties;
  assertEquals(
    [properties.what_changed.minItems, properties.what_changed.maxItems],
    [facts.min, facts.max],
  );
  assertEquals(
    [properties.why_it_matters.minItems, properties.why_it_matters.maxItems],
    [interpretations.min, interpretations.max],
  );
  assertEquals(
    [properties.worth_doing.minItems, properties.worth_doing.maxItems],
    [actions.min, actions.max],
  );
  // validateDecisionReport ties these two arrays to the briefs above, so the
  // schema has to carry the SAME window, not merely a window of its own.
  assertEquals(
    [
      properties.interpretation_meta.minItems,
      properties.interpretation_meta.maxItems,
    ],
    [interpretations.min, interpretations.max],
  );
  assertEquals(
    [properties.action_plan.minItems, properties.action_plan.maxItems],
    [actions.min, actions.max],
  );
});

Deno.test("issue 3541 keeps the bounded worst case inside the output budget", () => {
  const chars = synthesisWorstCaseOutputChars();
  assertEquals(Number.isFinite(chars) && chars > 0, true);
  // The arithmetic in the comment above MAX_SYNTHESIS_OUTPUT_TOKENS, redone.
  assertEquals(
    synthesisWorstCaseOutputTokens(),
    Math.ceil(chars / SYNTHESIS_OUTPUT_CHARS_PER_TOKEN),
  );
  assertEquals(
    synthesisWorstCaseOutputTokens() <= MAX_SYNTHESIS_OUTPUT_TOKENS,
    true,
  );
  assertEquals(synthesisOutputTokenHeadroom() >= 0, true);
  // The budget must also still be the one actually sent to the provider.
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  assertEquals(source.includes("maxOutputTokens: MAX_SYNTHESIS_OUTPUT_TOKENS"), true);
});

// A minimal provider + database harness. The response is a REAL provider-shaped
// body, so finish_reason travels the same path it travels in production; the
// receipt is whatever the worker hands issue_2725_record_model_usage.
async function issue3541SynthesisReceipt(
  finishReason: string,
  text: string,
): Promise<Record<string, unknown>> {
  let receipt: Record<string, unknown> = {};
  const db = {
    from(_table: string) {
      const chain: Record<string, any> = {};
      for (const method of ["select", "eq", "order", "limit", "in", "is"]) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => ({ data: null, error: null });
      chain.single = async () => ({ data: null, error: null });
      return chain;
    },
    async rpc(name: string, args: Record<string, any>) {
      if (name === "issue_2725_record_model_usage") {
        receipt = args.p_receipt as Record<string, unknown>;
        return { data: "receipt-1", error: null };
      }
      return { data: null, error: null };
    },
  } as never;
  const job = {
    id: "job-1",
    competitor_id: "22222222-2222-4222-8222-222222222222",
    brand_id: "brand-1",
    venue_listing_id: "venue-1",
    source_set_fingerprint: "a".repeat(64),
    capability_snapshot: { website: 1 },
    lease_owner: "owner-1",
    attempt_count: 1,
    funding_lane: "manual" as const,
    manual_tool_lead_id: null,
  } as never;
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ finishReason, content: { parts: [{ text }] } }],
        usageMetadata: {
          promptTokenCount: 4_000,
          candidatesTokenCount: 1_185,
          thoughtsTokenCount: 0,
          totalTokenCount: 5_185,
        },
        modelVersion: "gemini-3.6-flash",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  const previous = Deno.env.get("GEMINI_API_KEY");
  Deno.env.set("GEMINI_API_KEY", "test-key");
  try {
    await assertRejects(
      () =>
        synthesizeBrief(
          "Competitor",
          "Lagos",
          issue3541Observations as never,
          [{
            sourceId: issue3541Observations[0].sourceId,
            kind: "website",
            before: null,
            after: issue3541Observations[0].facts,
            changedPaths: [],
          }] as never,
          venue as never,
          fetcher,
          { db, job },
        ),
      Error,
      "synthesis_failed",
    );
  } finally {
    previous === undefined
      ? Deno.env.delete("GEMINI_API_KEY")
      : Deno.env.set("GEMINI_API_KEY", previous);
  }
  return receipt;
}

// The document the provider actually returned on 2026-09-22: valid JSON up to
// the point the budget ran out, then nothing.
const ISSUE_3541_TRUNCATED =
  '{"what_changed":[{"id":"f1","text":"The site now leads with a weekend tast';

Deno.test("issue 3541 records a MAX_TOKENS finish as an output budget defect", async () => {
  const receipt = await issue3541SynthesisReceipt(
    "MAX_TOKENS",
    ISSUE_3541_TRUNCATED,
  );
  // Prove the input really carried the finish reason, so the class below
  // cannot be right for the wrong reason.
  assertEquals(receipt.finish_reason, "MAX_TOKENS");
  assertEquals(receipt.usage_complete, true);
  assertEquals(receipt.result_class, RESULT_CLASS_OUTPUT_BUDGET_EXCEEDED);
  // The negative half: the old class must be gone, not merely joined.
  assertEquals(receipt.result_class === "provider_error", false);
  assertEquals(receipt.result_class === "invalid_result", false);
});

Deno.test("issue 3541 leaves a non-MAX_TOKENS bad body classed as a provider error", async () => {
  // Same harness, same unparseable body, only the finish reason differs — so a
  // default leaking through would show up here as the budget class.
  const receipt = await issue3541SynthesisReceipt(
    "STOP",
    ISSUE_3541_TRUNCATED,
  );
  assertEquals(receipt.finish_reason, "STOP");
  assertEquals(receipt.result_class, "provider_error");
  assertEquals(
    receipt.result_class === RESULT_CLASS_OUTPUT_BUDGET_EXCEEDED,
    false,
  );
});
