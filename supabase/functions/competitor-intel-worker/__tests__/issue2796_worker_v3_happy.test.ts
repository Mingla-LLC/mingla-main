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
  assertEquals(source.includes("thinkingConfig: { thinkingBudget: 0 }"), true);
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
        modelVersion: "gemini-2.5-flash",
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
        modelVersion: "gemini-2.5-flash",
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
