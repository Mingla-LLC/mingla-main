import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildObservationComparisons,
  concreteEvidenceObservation,
  PROMPT_CONTRACT_VERSION,
  synthesizeBrief,
  validateBrief,
} from "../index.ts";

const observations = [{
  sourceId: "website-1",
  kind: "website",
  facts: {
    profile: {
      name: "Shiro Lagos",
      bio: "Japanese dining and cocktails in Victoria Island",
    },
  },
  checkedAt: "2026-08-28T14:00:00Z",
  latestObservedAt: null,
  publicUrl: "https://shiro.example",
  fingerprint: "a".repeat(64),
}, {
  sourceId: "instagram-1",
  kind: "instagram",
  facts: {
    profile: { name: "Shiro Lagos", bio: "Japanese dining" },
    items: [{
      caption_excerpt: "Live music Fridays with a new late-night menu",
    }],
  },
  checkedAt: "2026-08-28T14:01:00Z",
  latestObservedAt: "2026-08-27T19:00:00Z",
  publicUrl: "https://instagram.com/shirolagos",
  fingerprint: "b".repeat(64),
}];
const venueContext = {
  listing: {
    id: "gogi",
    name: "Gogi Lagos",
    city: "Lagos",
    venue_category: "restaurant",
  },
  brand_published_events: [{
    id: "event-1",
    title: "Thursday live music",
    description: "An existing Gogi event",
  }],
};

Deno.test("issue 2725 rework uses GEMINI_API_KEY and keeps a concrete first brief", async () => {
  const previousStandard = Deno.env.get("GEMINI_API_KEY");
  const previousLegacy = Deno.env.get("GOOGLE_AI_API_KEY");
  try {
    Deno.env.set("GEMINI_API_KEY", "test-standard-owner");
    Deno.env.delete("GOOGLE_AI_API_KEY");
    let requestUrl = "";
    let requestBody = "";
    const brief = await synthesizeBrief(
      "Shiro Lagos",
      "Lagos",
      observations,
      buildObservationComparisons(observations, []),
      venueContext,
      (async (input, init) => {
        requestUrl = String(input);
        requestBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            candidates: [{
              finishReason: "STOP",
              content: {
                parts: [{
                  text: JSON.stringify({
                    what_changed: [{
                      id: "f1",
                      text:
                        "Shiro's public Instagram promotes live music Fridays and a late-night menu.",
                      source_id: "instagram-1",
                      evidence_id: "e2",
                      confidence: "observed",
                    }],
                    why_it_matters: [{
                      text:
                        "Because Gogi already publishes a Thursday live-music event, Friday discovery may be worth considering as a different public programming moment.",
                      evidence_ids: ["e2"],
                      confidence: "interpretation",
                    }],
                    worth_doing: [{
                      id: "a1",
                      text:
                        "Publish Gogi's existing Thursday live-music event so guests looking for live music can find it on Mingla.",
                      kind: "publish_existing_event",
                      confidence: "suggested_action",
                      is_primary: true,
                    }],
                  }),
                }],
              },
            }],
            usageMetadata: {
              promptTokenCount: 300,
              candidatesTokenCount: 180,
              thoughtsTokenCount: 0,
              totalTokenCount: 480,
            },
            modelVersion: "gemini-2.5-flash",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    );
    assertStringIncludes(requestUrl, "test-standard-owner");
    assertStringIncludes(requestBody, `Contract ${PROMPT_CONTRACT_VERSION}`);
    assertStringIncludes(requestBody, '\\"first_check\\":true');
    assertEquals(
      (brief.what_changed[0] as { text: string }).text.includes("changed"),
      false,
    );
    assertStringIncludes(
      (brief.what_changed[0] as { text: string }).text,
      "live music Fridays",
    );
    assertStringIncludes(
      (brief.evidence[1] as { observation: string }).observation,
      "Live music Fridays",
    );
    validateBrief(brief, observations);
  } finally {
    previousStandard === undefined
      ? Deno.env.delete("GEMINI_API_KEY")
      : Deno.env.set("GEMINI_API_KEY", previousStandard);
    previousLegacy === undefined
      ? Deno.env.delete("GOOGLE_AI_API_KEY")
      : Deno.env.set("GOOGLE_AI_API_KEY", previousLegacy);
  }
});

Deno.test("issue 2725 rework fails closed when model configuration is missing", async () => {
  const previousStandard = Deno.env.get("GEMINI_API_KEY");
  const previousLegacy = Deno.env.get("GOOGLE_AI_API_KEY");
  try {
    Deno.env.delete("GEMINI_API_KEY");
    Deno.env.delete("GOOGLE_AI_API_KEY");
    let modelCalls = 0;
    const error = await assertRejects(() =>
      synthesizeBrief(
        "Shiro Lagos",
        "Lagos",
        observations,
        buildObservationComparisons(observations, []),
        venueContext,
        (async () => {
          modelCalls += 1;
          return new Response("unexpected");
        }) as typeof fetch,
      )
    );
    assertEquals((error as Error).message, "model_configuration_missing");
    assertEquals(modelCalls, 0);
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    assertEquals(
      source.includes('settleZeroCost(db, job, "deterministic_fallback")'),
      false,
    );
  } finally {
    previousStandard === undefined
      ? Deno.env.delete("GEMINI_API_KEY")
      : Deno.env.set("GEMINI_API_KEY", previousStandard);
    previousLegacy === undefined
      ? Deno.env.delete("GOOGLE_AI_API_KEY")
      : Deno.env.set("GOOGLE_AI_API_KEY", previousLegacy);
  }
});

Deno.test("issue 2725 rework evidence is source-specific and refuses empty source facts", () => {
  assertStringIncludes(
    concreteEvidenceObservation(observations[0]),
    "Japanese dining",
  );
  assertStringIncludes(
    concreteEvidenceObservation(observations[1]),
    "Live music Fridays",
  );
});
