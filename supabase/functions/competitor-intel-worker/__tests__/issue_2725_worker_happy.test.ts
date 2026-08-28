import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  ANALYZED_PROVIDER_ALLOWLIST,
  buildObservationComparisons,
  fetchWithTimeout,
  geminiCostMicrousd,
  handler,
  leaseStillOwned,
  nextWeeklyDue,
  observedChangeText,
  observeInstagram,
  processCompetitorJob,
  providerSafeCode,
  publicationStates,
  synthesizeBrief,
  validateBrief,
  venueRelevantFallback,
} from "../index.ts";
import { normalizeCompetitorSource } from "../../_shared/competitorSourceIdentity.ts";
import { observeCompetitorWebsite } from "../../_shared/competitorWebsiteObservation.ts";
Deno.test("issue 2725 amendment 8 pricing is exact and rejects invented usage", () => {
  assertEquals(geminiCostMicrousd(350, 500, 0), 1355);
  assertThrows(() => geminiCostMicrousd(1, Number.NaN, 0));
  assertThrows(() => geminiCostMicrousd(-1, 0, 0));
});
Deno.test("issue 2725 canonical social identities and TikTok link-only", async () => {
  const ig = await normalizeCompetitorSource(
    "instagram",
    "https://instagram.com/My.Venue/",
  );
  assertEquals(ig.normalizedIdentity, "instagram:my.venue");
  assertEquals(ig.capability, "analyzed_weekly");
  const tt = await normalizeCompetitorSource(
    "tiktok",
    "https://www.tiktok.com/@MyVenue",
  );
  assertEquals(tt.normalizedIdentity, "tiktok:myvenue");
  assertEquals(tt.capability, "link_only");
  assertEquals([...ANALYZED_PROVIDER_ALLOWLIST], ["website", "instagram"]);
});
Deno.test("issue 2725 rejects post/video paths and machine door fails closed", async () => {
  await assertRejects(() =>
    normalizeCompetitorSource("instagram", "https://instagram.com/reel/abc")
  );
  await assertRejects(() =>
    normalizeCompetitorSource("tiktok", "https://tiktok.com/@venue/video/1")
  );
  const response = await handler(
    new Request("http://local", { method: "POST", body: "{}" }),
  );
  assertEquals(response.status, 401);
});
Deno.test("issue 2725 website observer accepts bounded public HTML and rejects private DNS before fetch", async () => {
  const source = await normalizeCompetitorSource(
    "website",
    "https://example.com/?utm_source=ignored&menu=dinner",
  );
  let calls = 0;
  const observed = await observeCompetitorWebsite(source, async () => {
    calls += 1;
    return new Response(
      '<html><title>Example Venue</title><a href="https://example.com/menu">Menu</a></html>',
      { headers: { "content-type": "text/html" } },
    );
  }, async (_host, type) => type === "A" ? ["93.184.216.34"] : []);
  assertEquals(calls, 1);
  assertEquals(observed.facts.site_signals.title_present, true);
  assertEquals(source.normalizedIdentity, "website:example.com/?menu=dinner");
  await assertRejects(() =>
    observeCompetitorWebsite(source, async () => {
      calls += 1;
      return new Response("should not run");
    }, async () => ["127.0.0.1"])
  );
  assertEquals(calls, 1);
});
Deno.test("issue 2725 website redirects stay bounded and revalidate every target", async () => {
  const source = await normalizeCompetitorSource(
    "website",
    "http://example.com",
  );
  let calls = 0;
  const ok = await observeCompetitorWebsite(source, async (url) => {
    calls += 1;
    return String(url).startsWith("http://")
      ? new Response(null, {
        status: 301,
        headers: { location: "https://www.example.com/home" },
      })
      : new Response("<html><title>Safe</title></html>", {
        headers: { "content-type": "text/html" },
      });
  }, async () => ["93.184.216.34"]);
  assertEquals(ok.facts.profile.name, "Safe");
  assertEquals(calls, 2);
  calls = 0;
  await assertRejects(() =>
    observeCompetitorWebsite(source, async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      });
    }, async () => ["93.184.216.34"])
  );
  assertEquals(calls, 1);
  calls = 0;
  await assertRejects(() =>
    observeCompetitorWebsite(source, async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "/again" },
      });
    }, async () => ["93.184.216.34"])
  );
  assertEquals(calls, 4);
});
Deno.test("issue 2725 success state, lease ownership, weekly rollover and explicit before-after are load-bearing", () => {
  assertEquals(publicationStates(false), {
    briefStatus: "current",
    jobState: "succeeded",
  });
  assertEquals(
    leaseStillOwned({ state: "leased", lease_owner: "new" }, "old"),
    false,
  );
  const due = Date.parse(
    nextWeeklyDue("00000000-0000-0000-0000-000000000001", 0),
  );
  assertEquals(due >= 7 * 86_400_000, true);
  const current = [{
    sourceId: "s1",
    kind: "website",
    facts: { profile: { bio: "live music nightly" } },
    checkedAt: "2026-08-27T00:00:00Z",
    latestObservedAt: null,
    publicUrl: "https://example.com",
    fingerprint: "a",
  }];
  const first = buildObservationComparisons(current, []);
  assertEquals(observedChangeText("Venue", first).includes("changed"), false);
  const changed = buildObservationComparisons(current, [{
    source_id: "s1",
    facts: { profile: { bio: "dinner" } },
    checked_at: "2026-08-20T00:00:00Z",
  }]);
  assertEquals(changed[0].changedPaths, ["profile.bio"]);
  assertEquals(
    observedChangeText("Venue", changed),
    "Website public fields changed: profile.bio.",
  );
});
Deno.test("issue 2725 venue relevance is bounded and absence degrades honestly", () => {
  const observations = [{
    sourceId: "s1",
    kind: "website",
    facts: { profile: { bio: "Live music every Friday" } },
    checkedAt: "2026-08-27T00:00:00Z",
    latestObservedAt: null,
    publicUrl: "https://example.com",
    fingerprint: "a",
  }];
  const relevant = venueRelevantFallback(observations, {
    listing: {
      id: "v1",
      name: "Our Venue",
      city: "Atlanta",
      venue_category: "restaurant",
    },
    brand_published_events: [],
  });
  assertEquals(
    relevant.why.includes("no matching published Mingla event"),
    true,
  );
  assertEquals(relevant.action.includes("live-music event"), true);
  const absent = venueRelevantFallback(observations, {
    listing: null,
    brand_published_events: [],
  });
  assertEquals(absent.why.includes("No comparable Mingla venue signal"), true);
});
Deno.test("issue 2725 first check synthesizes relevance but cannot invent historical change", async () => {
  const previous = Deno.env.get("GOOGLE_AI_API_KEY");
  try {
    Deno.env.set("GOOGLE_AI_API_KEY", "test");
    const observations = [{
      sourceId: "s1",
      kind: "website",
      facts: { profile: { bio: "Live music" } },
      checkedAt: "2026-08-27T00:00:00Z",
      latestObservedAt: null,
      publicUrl: "https://example.com",
      fingerprint: "a",
    }];
    const comparisons = buildObservationComparisons(observations, []);
    let prompt = "";
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      prompt = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          candidates: [{
            finishReason: "STOP",
            content: {
              parts: [{
                text: JSON.stringify({
                  what_changed: [{
                    id: "f1",
                    text: "They changed everything.",
                    source_id: "s1",
                    evidence_id: "e1",
                    confidence: "observed",
                  }],
                  why_it_matters: [{
                    text: "This may matter against the venue context.",
                    evidence_ids: ["e1"],
                    confidence: "interpretation",
                  }],
                  worth_doing: [{
                    id: "a1",
                    text: "Review the signal.",
                    kind: "review",
                    confidence: "suggested_action",
                    is_primary: true,
                  }],
                }),
              }],
            },
          }],
          usageMetadata: {
            promptTokenCount: 350,
            candidatesTokenCount: 500,
            thoughtsTokenCount: 0,
            totalTokenCount: 850,
          },
          modelVersion: "gemini-2.5-flash",
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const brief = await synthesizeBrief(
      "Competitor",
      null,
      observations,
      comparisons,
      { listing: null, brand_published_events: [] },
      fetcher,
    );
    assertEquals(prompt.includes('\\"first_check\\":true'), true);
    assertEquals(prompt.includes('\\"must_not_claim_change\\":true'), true);
    assertEquals(prompt.includes('"temperature":0'), true);
    assertEquals(prompt.includes('"thinkingBudget":0'), true);
    assertEquals(prompt.includes('"candidateCount":1'), true);
    assertEquals(prompt.includes('"responseJsonSchema"'), true);
    assertEquals(
      String((brief.what_changed[0] as { text: string }).text).includes(
        "changed",
      ),
      false,
    );
    assertEquals(
      (brief.why_it_matters[0] as { text: string }).text,
      "This may matter against the venue context.",
    );
  } finally {
    previous === undefined
      ? Deno.env.delete("GOOGLE_AI_API_KEY")
      : Deno.env.set("GOOGLE_AI_API_KEY", previous);
  }
});
Deno.test("issue 2725 provider timeout maps to safe unreachable without response content", async () => {
  const error = await assertRejects(() =>
    fetchWithTimeout(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("secret body", "AbortError")),
          );
        }),
      "https://provider.invalid",
      {},
      5,
    )
  );
  assertEquals((error as Error).message, "unreachable");
  assertEquals(providerSafeCode(error), "unreachable");
});
Deno.test("issue 2725 identical Instagram public input produces stable facts", async () => {
  const previousUser = Deno.env.get("META_COMPETITOR_IG_USER_ID");
  const previousToken = Deno.env.get("META_COMPETITOR_ACCESS_TOKEN");
  try {
    Deno.env.set("META_COMPETITOR_IG_USER_ID", "ig-1");
    Deno.env.set("META_COMPETITOR_ACCESS_TOKEN", "token");
    const body = {
      business_discovery: {
        username: "venue",
        name: "Venue",
        biography: "Live music",
        website: "https://venue.example",
        media: {
          data: [{
            id: "p1",
            caption: "Friday band",
            comments_count: 2,
            like_count: 5,
            media_type: "IMAGE",
            permalink: "https://instagram.com/p/1",
            timestamp: new Date().toISOString(),
          }],
        },
      },
    };
    const fetcher = async () =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    const first = await observeInstagram("venue", fetcher);
    const second = await observeInstagram("venue", fetcher);
    assertEquals(first.facts, second.facts);
  } finally {
    previousUser === undefined
      ? Deno.env.delete("META_COMPETITOR_IG_USER_ID")
      : Deno.env.set("META_COMPETITOR_IG_USER_ID", previousUser);
    previousToken === undefined
      ? Deno.env.delete("META_COMPETITOR_ACCESS_TOKEN")
      : Deno.env.set("META_COMPETITOR_ACCESS_TOKEN", previousToken);
  }
});
Deno.test("issue 2725 rejects malformed and fabricated brief references", () => {
  const observations = [{
    sourceId: "s1",
    kind: "website",
    facts: { profile: {} },
    checkedAt: "2026-08-27T00:00:00Z",
    latestObservedAt: null,
    publicUrl: "https://example.com",
    fingerprint: "a",
  }];
  const base = {
    what_changed: [{
      id: "f1",
      text: "Observed title changed.",
      source_id: "s1",
      evidence_id: "e1",
      confidence: "observed",
    }],
    why_it_matters: [{
      text: "Compared with venue context.",
      evidence_ids: ["e1"],
      confidence: "interpretation",
    }],
    worth_doing: [{
      id: "a1",
      text: "Review it.",
      kind: "review",
      confidence: "suggested_action",
      is_primary: true,
    }],
    evidence: [{
      id: "e1",
      source_id: "s1",
      public_url: "https://example.com",
      checked_at: "2026-08-27T00:00:00Z",
      observation: "Title changed.",
    }],
  };
  validateBrief(base, observations);
  assertThrows(() =>
    validateBrief({
      ...base,
      what_changed: [{ ...base.what_changed[0], evidence_id: "fabricated" }],
    }, observations)
  );
  assertThrows(() =>
    validateBrief({
      ...base,
      what_changed: [{
        id: "f1",
        text: 42,
        source_id: "s1",
        evidence_id: "e1",
        confidence: "observed",
      }],
    }, observations)
  );
  assertThrows(() =>
    validateBrief({ ...base, why_it_matters: [] }, observations)
  );
});

function correctnessDb(failAt: "observation" | "current") {
  const terminalOutcomes: string[] = [];
  const source = {
    id: "s1",
    kind: "instagram",
    normalized_url: "https://instagram.com/venue",
    normalized_identity: "instagram:venue",
    source_fingerprint: "a".repeat(64),
    capability: "analyzed_weekly",
    health: "current",
    last_checked_at: null,
  };
  const resultFor = (table: string, op: string, single: boolean) => {
    if (table === "tool_competitors") {
      return {
        data: {
          id: "w1",
          name: "Venue",
          city: "Atlanta",
          current_brief_id: failAt === "current" ? "b1" : null,
          updated_at: "2026-08-27T00:00:00Z",
        },
        error: null,
      };
    }
    if (table === "tool_competitor_sources" && op === "select") {
      return { data: [source], error: null };
    }
    if (table === "tool_competitor_sources") return { data: null, error: null };
    if (table === "tool_competitor_provider_capabilities") {
      return {
        data: single
          ? {
            kind: "instagram",
            mode: "analyzed_weekly",
            enabled: true,
            availability_generation: 1,
          }
          : [{
            kind: "instagram",
            mode: "analyzed_weekly",
            enabled: true,
            availability_generation: 1,
          }],
        error: null,
      };
    }
    if (table === "tool_competitor_refresh_jobs") {
      return {
        data: {
          state: "leased",
          lease_owner: "owner",
          cancel_requested_at: null,
          capability_snapshot: { instagram: 1 },
        },
        error: null,
      };
    }
    if (table === "tool_competitor_briefs") {
      return {
        data: null,
        error: failAt === "current" ? { message: "hidden db detail" } : null,
      };
    }
    if (table === "tool_competitor_observations" && op === "upsert") {
      return {
        data: null,
        error: failAt === "observation"
          ? { message: "hidden db detail" }
          : null,
      };
    }
    return { data: [], error: null };
  };
  const from = (table: string) => {
    let op = "select";
    let single = false;
    const chain: Record<string, unknown> = {};
    for (
      const method of [
        "select",
        "eq",
        "order",
        "limit",
        "in",
        "is",
        "maybeSingle",
      ]
    ) chain[method] = (..._args: unknown[]) => chain;
    chain.single = () => {
      single = true;
      return chain;
    };
    chain.upsert = (..._args: unknown[]) => {
      op = "upsert";
      return chain;
    };
    chain.update = (..._args: unknown[]) => {
      op = "update";
      return chain;
    };
    chain.then = (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(resultFor(table, op, single)).then(resolve, reject);
    return chain;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "issue_2725_finish_job") {
      terminalOutcomes.push(String(args.p_outcome));
    }
    return { data: { applied: true }, error: null };
  };
  return { db: { from, rpc }, terminalOutcomes };
}

Deno.test("issue 2725 DB result errors cannot publish or replace the last good brief", async () => {
  const previousUser = Deno.env.get("META_COMPETITOR_IG_USER_ID");
  const previousToken = Deno.env.get("META_COMPETITOR_ACCESS_TOKEN");
  try {
    Deno.env.set("META_COMPETITOR_IG_USER_ID", "ig-1");
    Deno.env.set("META_COMPETITOR_ACCESS_TOKEN", "token");
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          business_discovery: {
            username: "venue",
            name: "Venue",
            media: { data: [] },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    const job = {
      id: "j1",
      competitor_id: "w1",
      brand_id: "brand",
      venue_listing_id: "venue",
      source_set_fingerprint: "a".repeat(64),
      capability_snapshot: { instagram: 1 },
      lease_owner: "owner",
      attempt_count: 1,
      funding_lane: "manual" as const,
      manual_tool_lead_id: null,
    };
    for (const failAt of ["observation", "current"] as const) {
      const { db, terminalOutcomes } = correctnessDb(failAt);
      await assertRejects(() =>
        processCompetitorJob(db, job, fetcher as typeof fetch)
      );
      assertEquals(terminalOutcomes.includes("publish"), false);
      assertEquals(terminalOutcomes.includes("no_change"), false);
    }
  } finally {
    previousUser === undefined
      ? Deno.env.delete("META_COMPETITOR_IG_USER_ID")
      : Deno.env.set("META_COMPETITOR_IG_USER_ID", previousUser);
    previousToken === undefined
      ? Deno.env.delete("META_COMPETITOR_ACCESS_TOKEN")
      : Deno.env.set("META_COMPETITOR_ACCESS_TOKEN", previousToken);
  }
});
