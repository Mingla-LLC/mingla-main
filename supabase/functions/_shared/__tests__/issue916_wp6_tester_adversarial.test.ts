/**
 * ISSUE-916 WP6 — mingla-tester ADVERSARIAL suite (append-only; new file).
 *
 * Attacks angles the implementor's 58-test suite does NOT cover:
 *   A1  hostile job-poll payloads — all four documented-plausible id-key
 *       shapes, none, and junk (wrong prefix / numeric / bare "t3_" / wrong
 *       nesting) through extractRedditPostId AND through the live runner
 *       (SUCCESS-with-garbage-id ⇒ post_id_missing, exactly 1 submission).
 *   A2  CLIENT_ERROR is terminal: verbatim errors[] surfaced, total
 *       submissions === 1, zero polls after the verdict.
 *   A3  hostile job-submit response (id under an unexpected key) ⇒
 *       job_id_missing — the runner refuses to poll blind.
 *   A4  PAUSED fuzz with hostile status injection at ALL THREE levels —
 *       every built body says configured_status:"PAUSED" byte-exact no matter
 *       what the inputs smuggle (targeting passthrough carrying
 *       configured_status/status keys, hostile extraQueryParameters).
 *   A5  hostile getStatus payloads: junk/lowercase/numeric configured_status
 *       collapses to engine-status null — never leaks into the engine vocab.
 *   A6  CTA case attacks: uppercase / snake / lowercase / NBSP / Unicode
 *       lookalikes (Cherokee Ᏼ, Cyrillic В) / trailing space — all 422, both
 *       at the validator and through the structured-post builder; plus a
 *       cross-registry check that every REDDIT_CTA_MAP value is byte-exact in
 *       the 24-string enum.
 *   A7  age-key smuggling via the passthrough (not just normalized) — never
 *       emitted, warning copy verbatim.
 *   A8  display_url / destination attacks: userinfo trick, uppercase OneLink
 *       host, display more-specific-than-destination, display with path.
 *   A9  the ALL-CAPS operationalization BOUNDARY (2-consecutive vs
 *       3-consecutive shouted words; punctuation-laced runs; acronym runs) —
 *       fails-on-revert vs reddit.ts `if (run >= 3) return "block";` (a
 *       DIFFERENT line than the implementor's three proven reverts).
 *   A10 micro-conversion boundaries THROUGH THE BUILDER in cents:
 *       $3.49/$3.50/$100/$100.01 bid edges, $2.00/day budget passes (no
 *       floor), non-integer cents fail closed.
 *   A11 rate-limit honoring: r=0 arriving on a SUCCESSFUL response gates the
 *       NEXT call; a 429 with NO RateLimit header backs off the 5s default.
 *   A12 [P1 QA-916-1 regression — ignore:true until REWORK] a failed connect
 *       persists external_account_id:'unconfigured'; the reconnect preflight
 *       must NOT use that placeholder as an account pin (today it does, and
 *       reconnect is bricked until manual DB surgery).
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue916_wp6_tester_adversarial.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { type AdConnectionRow, AdApiError, REDDIT_CTA_MAP } from "../adChannel.ts";
import {
  buildRedditAdBody,
  buildRedditAdGroupBody,
  buildRedditCampaignBody,
  buildRedditStructuredPostJobBody,
  engineStatusFromReddit,
  extractRedditPostId,
  REDDIT_CTA_ENUM,
  REDDIT_NO_AGE_TARGETING_COPY,
  REDDIT_TARGETING_ALLOWLIST,
  redditAdapter,
  redditCapsVerdict,
  redditConnectPreflight,
  redditRequest,
  redditRunStructuredPostJob,
  resetRedditBackoffForTests,
  resetRedditCommunityCacheForTests,
  resetRedditTokenCacheForTests,
  resolveRedditClient,
  serializeRedditTargeting,
  setRedditSleepForTests,
  validateRedditCopy,
  validateRedditCta,
  validateRedditDestinationPolicy,
} from "../reddit.ts";

// ── Harness (self-contained; mirrors the house fetch-mock idiom) ──────────────

const REDDIT_ENV_NAMES = [
  "REDDIT_ADS_CLIENT_ID",
  "REDDIT_ADS_CLIENT_SECRET",
  "REDDIT_ADS_REFRESH_TOKEN",
  "REDDIT_ADS_BUSINESS_ID",
  "REDDIT_ADS_ACCOUNT_ID",
  "REDDIT_ADS_PROFILE_ID",
  "REDDIT_ADS_PIXEL_ID",
  "REDDIT_ADS_FUNDING_INSTRUMENT_ID",
  "REDDIT_ADS_API_BASE",
  "REDDIT_ADS_TOKEN_URL",
];

async function withRedditEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const name of REDDIT_ENV_NAMES) {
    saved.set(name, Deno.env.get(name));
    Deno.env.delete(name);
  }
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) Deno.env.set(name, value);
  }
  resetRedditTokenCacheForTests();
  resetRedditBackoffForTests();
  resetRedditCommunityCacheForTests();
  try {
    await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value !== undefined) Deno.env.set(name, value);
      else Deno.env.delete(name);
    }
    resetRedditTokenCacheForTests();
    resetRedditBackoffForTests();
    resetRedditCommunityCacheForTests();
    setRedditSleepForTests(null);
  }
}

const BASE_ENV = {
  REDDIT_ADS_CLIENT_ID: "qa-adv-client-id",
  REDDIT_ADS_CLIENT_SECRET: "qa-adv-client-secret",
  REDDIT_ADS_REFRESH_TOKEN: "qa-adv-refresh-token",
};

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const MINT_OK = {
  access_token: "qa-adv-minted-token",
  token_type: "bearer",
  expires_in: 86_400,
  scope: "adsread adsedit",
};

interface MockFetchInit {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
}

function installFetchMock(
  handler: (req: CapturedRequest, calls: CapturedRequest[]) => Response | Promise<Response>,
): { calls: CapturedRequest[]; restore: () => void } {
  const calls: CapturedRequest[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: Request | URL | string,
    init?: MockFetchInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const captured: CapturedRequest = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(captured);
    return await handler(captured, calls);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

function installApiMock(
  handler: (req: CapturedRequest, calls: CapturedRequest[]) => Response | Promise<Response>,
): { calls: CapturedRequest[]; restore: () => void } {
  return installFetchMock((req, calls) => {
    if (req.url.includes("access_token") || req.url.includes("/token")) {
      return jsonResponse(MINT_OK);
    }
    return handler(req, calls);
  });
}

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000917",
  platform: "reddit",
  lane: "consumer",
  display_name: "Reddit · Consumer (Mingla Ad Account 0)",
  external_account_id: "a2_jcfwvnfcfqcs",
  external_org_id: "950c8eac-da26-45e6-942e-645ed657e43f",
  auth_kind: "refresh_token",
  token_env_var: "REDDIT_ADS_REFRESH_TOKEN",
  extra: {
    reddit_profile_id: "t2_2ikkjswp3a",
    reddit_funding_instrument_id: "1889187",
    reddit_pixel_id: "a2_jcfwvnfcfqcs",
  },
  status: "connected",
  currency: "USD",
  timezone: null,
  min_daily_budget_cents: null,
  account_status: null,
  token_last_verified_at: null,
  connected: true,
} as unknown as AdConnectionRow;

const PROFILE = "t2_2ikkjswp3a";
const CANONICAL = "https://usemingla.com/e/mingla/rooftop-party";

// ── A1 · hostile job-poll payloads: the four id-key shapes + none + junk ──────

Deno.test("ADV-A1: extractRedditPostId accepts exactly the 4 documented-plausible shapes and nothing else", () => {
  // The four shapes the extractor pins (implementation §12.5 — unpinned wire
  // shape, fail-close): each must resolve the same t3_ id.
  assertEquals(extractRedditPostId({ data: { post_id: "t3_qa1" } }), "t3_qa1");
  assertEquals(extractRedditPostId({ data: { post: { id: "t3_qa2" } } }), "t3_qa2");
  assertEquals(extractRedditPostId({ data: { structured_post: { id: "t3_qa3" } } }), "t3_qa3");
  assertEquals(extractRedditPostId({ data: { structured_post_id: "t3_qa4" } }), "t3_qa4");

  // None → null (never fabricated).
  assertEquals(extractRedditPostId({}), null);
  assertEquals(extractRedditPostId({ data: {} }), null);

  // Junk: wrong prefix, numeric, bare prefix, id at the wrong nesting level,
  // arrays, t3_ id hidden in an unknown key — all null.
  assertEquals(extractRedditPostId({ data: { post_id: "x3_evil" } }), null);
  assertEquals(extractRedditPostId({ data: { post_id: 12345 } }), null);
  assertEquals(extractRedditPostId({ data: { post_id: "t3_" } }), null);
  assertEquals(extractRedditPostId({ post_id: "t3_toplevel" } as never), null);
  assertEquals(extractRedditPostId({ data: { post: { id: ["t3_arr"] } } }), null);
  assertEquals(extractRedditPostId({ data: { totally_new_key: "t3_hidden" } }), null);
  // Prefix-lookalike: uppercase T3_ is NOT a t3_ id.
  assertEquals(extractRedditPostId({ data: { post_id: "T3_CAPS" } }), null);
});

Deno.test("ADV-A1: runner — SUCCESS payload carrying a garbage post id fails close with 1 submission", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    setRedditSleepForTests(() => Promise.resolve());
    let submissions = 0;
    const { restore } = installApiMock((req) => {
      if (req.url.includes("/structured_posts/jobs") && req.method === "POST") {
        submissions++;
        return jsonResponse({ data: { job_id: "job-qa-a1" } }, 201);
      }
      // SUCCESS — but the id is garbage at every shape.
      return jsonResponse({
        data: { status: "SUCCESS", post_id: "x3_garbage", post: { id: 42 } },
      });
    });
    try {
      const client = await resolveRedditClient(CONN);
      const err = await assertRejects(
        () => redditRunStructuredPostJob(client, PROFILE, { creative: {} }),
        AdApiError,
      );
      assertEquals((err as AdApiError).toJSON().code, "post_id_missing");
      assertEquals(submissions, 1, "a garbage SUCCESS must never trigger a resubmission");
    } finally {
      restore();
    }
  });
});

// ── A2 · CLIENT_ERROR is terminal: verbatim, 1 submission, no post-verdict polls ──

Deno.test("ADV-A2: CLIENT_ERROR — verbatim errors[], exactly 1 submission, zero polls after the verdict", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    setRedditSleepForTests(() => Promise.resolve());
    let submissions = 0;
    let pollsAfterVerdict = 0;
    let verdictServed = false;
    const providerProse =
      "Image could not be processed because the file appears to be corrupted; please re-upload.";
    const { restore } = installApiMock((req) => {
      if (req.url.includes("/structured_posts/jobs") && req.method === "POST") {
        submissions++;
        return jsonResponse({ data: { job_id: "job-qa-a2" } }, 201);
      }
      if (verdictServed) pollsAfterVerdict++;
      verdictServed = true;
      return jsonResponse({
        data: { status: "CLIENT_ERROR", errors: [{ message: providerProse }] },
      });
    });
    try {
      const client = await resolveRedditClient(CONN);
      const err = await assertRejects(
        () => redditRunStructuredPostJob(client, PROFILE, { creative: {} }),
        AdApiError,
      );
      const message = (err as AdApiError).toJSON().message as string;
      // Character-for-character provider prose inside the admin copy.
      assertStringIncludes(message, providerProse);
      assertEquals(submissions, 1, "CLIENT_ERROR must NEVER produce a new job submission");
      assertEquals(pollsAfterVerdict, 0, "CLIENT_ERROR must stop the poll loop immediately");
    } finally {
      restore();
    }
  });
});

// ── A3 · hostile job-submit response: unexpected id key ⇒ refuse to poll blind ──

Deno.test("ADV-A3: a submit response with the id under an unexpected key ⇒ job_id_missing, zero polls", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    setRedditSleepForTests(() => Promise.resolve());
    let polls = 0;
    const { restore } = installApiMock((req) => {
      if (req.url.includes("/structured_posts/jobs") && req.method === "POST") {
        // Hostile: the id arrives as `jobId` (camelCase) — not a pinned shape.
        return jsonResponse({ data: { jobId: "job-qa-a3" } }, 201);
      }
      polls++;
      return jsonResponse({ data: { status: "SUCCESS", post_id: "t3_never" } });
    });
    try {
      const client = await resolveRedditClient(CONN);
      const err = await assertRejects(
        () => redditRunStructuredPostJob(client, PROFILE, { creative: {} }),
        AdApiError,
      );
      assertEquals((err as AdApiError).toJSON().code, "job_id_missing");
      assertEquals(polls, 0, "no poll may ever run against a fabricated job id");
    } finally {
      restore();
    }
  });
});

// ── A4 · PAUSED fuzz: hostile inputs can never flip any create body to ACTIVE ──

Deno.test("ADV-A4: hostile inputs at all three levels — configured_status stays byte-exact PAUSED", () => {
  // Campaign level: name/objective fuzz.
  const campaignFuzz = [
    { name: 'ACTIVE" ,"configured_status":"ACTIVE', objective: "CLICKS" },
    { name: "configured_status", objective: "TRAFFIC" },
    { name: "𝕬𝖈𝖙𝖎𝖛𝖊 unicode 𝖓𝖆𝖒𝖊", objective: "OUTCOME_TRAFFIC" },
  ];
  for (const fuzz of campaignFuzz) {
    const body = buildRedditCampaignBody({
      name: fuzz.name,
      objective: fuzz.objective,
      fundingInstrumentId: "1889187",
      isCbo: false,
      conversionPixelId: "a2_jcfwvnfcfqcs",
    });
    assertEquals(body.configured_status, "PAUSED");
  }

  // Ad-group level: the targeting passthrough smuggles status keys — the
  // serializer must drop them AND the body stays PAUSED.
  const serialized = serializeRedditTargeting({
    normalized: { countries: ["GB"] },
    passthrough: {
      communities: ["london"],
      configured_status: "ACTIVE",
      status: "ACTIVE",
      effective_status: "ACTIVE",
    },
  });
  assert(serialized.ok);
  assertEquals(serialized.targeting.configured_status, undefined);
  assertEquals(serialized.targeting.status, undefined);
  assertEquals(serialized.targeting.effective_status, undefined);
  const adGroupBody = buildRedditAdGroupBody({
    campaignExternalId: "1684291704682361243",
    name: "QA adversarial ad group",
    budgetCents: 200, // $2/day — must build clean (no invented floor)
    conversionPixelId: "a2_jcfwvnfcfqcs",
    startTime: "2026-07-16T00:00:00Z",
    targeting: serialized.targeting,
  });
  assertEquals(adGroupBody.configured_status, "PAUSED");
  assertEquals(adGroupBody.goal_value, 2_000_000);

  // Ad level: hostile extraQueryParameters cannot escape the params array.
  const adBody = buildRedditAdBody({
    adGroupExternalId: "2684291704682361244",
    name: "QA adversarial ad",
    postId: "t3_qa916",
    profileId: PROFILE,
    clickUrl: CANONICAL,
    utmCampaign: "qa-916",
    extraQueryParameters: [
      { name: "configured_status", value: "ACTIVE" },
      { name: "utm_term", value: '"},"configured_status":"ACTIVE' },
    ],
  });
  assertEquals(adBody.configured_status, "PAUSED");
  // The smuggled pairs stay INSIDE click_url_query_parameters — the body root
  // has exactly one status key and it is PAUSED.
  const statusKeys = Object.keys(adBody).filter((k) => k.includes("status"));
  assertEquals(statusKeys, ["configured_status"]);
});

// ── A5 · hostile getStatus payloads: junk statuses collapse to null ───────────

Deno.test("ADV-A5: engineStatusFromReddit refuses junk / lowercase / numeric statuses", () => {
  for (
    const junk of [
      "TOTALLY_BOGUS'; DROP TABLE ads;--",
      "active",
      "paused",
      5,
      null,
      undefined,
      { status: "ACTIVE" },
      "ACTIVE ", // trailing space — not the enum member
    ]
  ) {
    assertEquals(engineStatusFromReddit(junk), null);
  }
  assertEquals(engineStatusFromReddit("ACTIVE"), "ACTIVE");
  assertEquals(engineStatusFromReddit("DELETED"), "DELETED");
});

Deno.test("ADV-A5: adapter.getStatus surfaces null engine status on a hostile payload (never the junk)", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const { restore } = installApiMock(() =>
      jsonResponse({
        data: {
          id: "3684291704682361245",
          configured_status: "WEAPONIZED_STATE",
          effective_status: "DEFINITELY_NOT_A_REAL_STATUS",
        },
      })
    );
    try {
      const s = await redditAdapter.getStatus(CONN, "ad", "3684291704682361245");
      assertEquals(s.status, null, "junk configured_status must not leak into engine vocab");
      // The RAW state is still surfaced for review_detail (verbatim contract).
      assertEquals(s.effectiveStatus, "DEFINITELY_NOT_A_REAL_STATUS");
    } finally {
      restore();
    }
  });
});

// ── A6 · CTA case attacks: uppercase / snake / lookalike unicode ───────────────

Deno.test("ADV-A6: CTA attacks — case, snake, NBSP, Unicode lookalikes, whitespace all 422", () => {
  const attacks = [
    "BUY TICKETS", // uppercased
    "BUY_TICKETS", // snake-cased constant style
    "buy tickets", // lowercased
    "Buy tickets", // sentence case
    "Buy Tickets", // non-breaking space
    "Ᏼuy Tickets", // Cherokee letter Ᏼ (U+13F4) lookalike
    "Вuy Tickets", // Cyrillic В (U+0412) lookalike
    "Buy Tickets ", // trailing space
    " Buy Tickets", // leading space
    "Buy  Tickets", // double space
  ];
  for (const cta of attacks) {
    const verdict = validateRedditCta(cta);
    assert(!verdict.ok, `CTA ${JSON.stringify(cta)} must be rejected`);
    assertEquals(verdict.ok === false && verdict.detail, "invalid_cta");
    // And through the builder: the attack can never reach a job body.
    assertThrows(
      () =>
        buildRedditStructuredPostJobBody({
          type: "IMAGE",
          headline: "Rooftop night in Shoreditch",
          destinationUrl: CANONICAL,
          callToAction: cta,
          imageUrl: "https://cdn.usemingla.com/hero.jpg",
        }),
      AdApiError,
    );
  }
  // The genuine article passes byte-exact.
  assert(validateRedditCta("Buy Tickets").ok);
});

Deno.test("ADV-A6: cross-registry — every REDDIT_CTA_MAP value is byte-exact in the 24-string enum", () => {
  for (const [offering, cta] of Object.entries(REDDIT_CTA_MAP)) {
    assert(
      REDDIT_CTA_ENUM.includes(cta),
      `REDDIT_CTA_MAP.${offering} = ${JSON.stringify(cta)} is not a verbatim enum member`,
    );
    // No normalizer artifacts: never all-caps, never underscored.
    assert(cta !== cta.toUpperCase(), `${cta} must not be uppercase`);
    assert(!cta.includes("_"), `${cta} must not be snake-cased`);
  }
});

// ── A7 · age-key smuggling via the passthrough ─────────────────────────────────

Deno.test("ADV-A7: age keys smuggled through the PASSTHROUGH never emit and warn verbatim", () => {
  const result = serializeRedditTargeting({
    normalized: null,
    passthrough: {
      communities: ["london"],
      age_min: 18,
      age_max: 65,
    },
  });
  assert(result.ok);
  assertEquals(result.targeting.age_min, undefined);
  assertEquals(result.targeting.age_max, undefined);
  assert(
    result.warnings.includes(REDDIT_NO_AGE_TARGETING_COPY),
    "the builder copy must be the verbatim §4.1 string",
  );
  // Alternate spellings can never appear either (explicit-construction proof).
  const alt = serializeRedditTargeting({
    normalized: null,
    passthrough: { communities: ["london"], AGE_MIN: 18, ageMin: 21, min_age: 25 },
  });
  assert(alt.ok);
  const smuggled = ["age_min", "age_max", "AGE_MIN", "ageMin", "min_age", "max_age"];
  for (const key of Object.keys(alt.targeting)) {
    assert(!smuggled.includes(key), `smuggled age key "${key}" leaked into the output`);
    // And every emitted key must be an allowlist member (G-4 defense-in-depth).
    assert(
      REDDIT_TARGETING_ALLOWLIST.includes(key),
      `non-allowlisted key "${key}" leaked into the output`,
    );
  }
});

// ── A8 · display_url / destination attacks ────────────────────────────────────

Deno.test("ADV-A8: userinfo trick and uppercase OneLink hosts are still bridge-blocked", () => {
  // https://usemingla.com@go.usemingla.com/x — the REAL host is the OneLink.
  const userinfo = validateRedditDestinationPolicy(
    "https://usemingla.com@go.usemingla.com/w36m",
  );
  assert(!userinfo.ok);
  assertEquals(userinfo.ok === false && userinfo.detail, "destination_bridge_page");

  const uppercase = validateRedditDestinationPolicy("https://GO.USEMINGLA.COM/w36m");
  assert(!uppercase.ok);
  assertEquals(uppercase.ok === false && uppercase.detail, "destination_bridge_page");

  const bareOneLink = validateRedditDestinationPolicy("https://onelink.me/ZSCW");
  assert(!bareOneLink.ok);

  const httpDowngrade = validateRedditDestinationPolicy("http://usemingla.com/e/x/y");
  assert(!httpDowngrade.ok);
  assertEquals(httpDowngrade.ok === false && httpDowngrade.detail, "destination_url_not_https");
});

Deno.test("ADV-A8: display_url more specific than the destination host is rejected; suffix attacks fail", () => {
  // display sub.usemingla.com vs destination usemingla.com → mismatch (the
  // display may be broader, never narrower).
  const narrower = validateRedditDestinationPolicy(CANONICAL, "sub.usemingla.com");
  assert(!narrower.ok);
  assertEquals(narrower.ok === false && narrower.detail, "display_url_domain_mismatch");

  // Suffix lookalike: display mingla.com vs host usemingla.com must NOT pass
  // the endsWith check ("usemingla.com" does not end with ".mingla.com").
  const suffix = validateRedditDestinationPolicy(CANONICAL, "mingla.com");
  assert(!suffix.ok);

  // Evil registrable-domain: destination usemingla.com.evil.com with display
  // usemingla.com must fail (host ends with ".com", not ".usemingla.com").
  const evil = validateRedditDestinationPolicy(
    "https://usemingla.com.evil.com/e/x",
    "usemingla.com",
  );
  assert(!evil.ok);

  // A display_url with scheme+path still matches by domain (documents the
  // normalization contract).
  const withPath = validateRedditDestinationPolicy(CANONICAL, "https://usemingla.com/some/path");
  assert(withPath.ok);

  // Subdomain destination under the display domain is allowed (broader display).
  const broader = validateRedditDestinationPolicy(
    "https://events.usemingla.com/e/x",
    "usemingla.com",
  );
  assert(broader.ok);
});

// ── A9 · ALL-CAPS operationalization boundary (fails-on-revert: reddit.ts
//        `if (run >= 3) return "block";` — a different line than the
//        implementor's three proven reverts) ──────────────────────────────────

Deno.test("ADV-A9: the 2-vs-3 consecutive shouted-word boundary is exact", () => {
  // 2 consecutive shouted words in mixed text: WARN (shouted present), not block.
  assertEquals(redditCapsVerdict("GRAND OPENING tonight in Shoreditch"), "warn");
  // 3 consecutive shouted words: BLOCK — this is the ≥3-run rule, and it is
  // the ONLY path that catches a mixed-text caps run (the whole-text branch
  // does not fire here). Deleting `if (run >= 3) return "block";` flips this.
  assertEquals(redditCapsVerdict("GRAND OPENING TONIGHT in Shoreditch"), "block");
  // Scattered (non-consecutive) shouted words: warn, never block.
  assertEquals(redditCapsVerdict("GRAND opening TONIGHT big NIGHT"), "warn");
  // Punctuation-laced runs still count as a run.
  assertEquals(redditCapsVerdict("SALE!!! NOW!!! HERE!!! flash offer"), "block");
  // An acronym RUN blocks too (pinned: 3 consecutive ≥2-letter caps words) —
  // conservative by design; single acronyms stay ok.
  assertEquals(redditCapsVerdict("NYC VIP DJ night out"), "block");
  assertEquals(redditCapsVerdict("Rooftop party in NYC tonight"), "ok");
  // Integration: the boundary reaches the copy validator verbatim.
  const blocked = validateRedditCopy({ headline: "GRAND OPENING TONIGHT in Shoreditch" });
  assert(!blocked.ok && blocked.blocks.some((b) => b.rule === "headline_all_caps"));
  const warned = validateRedditCopy({ headline: "GRAND OPENING tonight in Shoreditch" });
  assert(warned.ok && warned.warnings.some((w) => w.rule === "headline_partial_caps"));
});

// ── A10 · micro boundaries THROUGH THE BUILDER, in cents ──────────────────────

Deno.test("ADV-A10: bid band edges in cents through buildRedditAdGroupBody ($3.49/$3.50/$100/$100.01)", () => {
  const base = {
    campaignExternalId: "1684291704682361243",
    name: "QA bid-band ad group",
    budgetCents: 500,
    conversionPixelId: "a2_jcfwvnfcfqcs",
    startTime: "2026-07-16T00:00:00Z",
    targeting: {},
  };
  // $3.49 → 3,490,000 micro → reject.
  assertThrows(() => buildRedditAdGroupBody({ ...base, bidValueCents: 349 }), AdApiError);
  // $3.50 → 3,500,000 micro → accept, MANUAL_BIDDING engaged.
  const low = buildRedditAdGroupBody({ ...base, bidValueCents: 350 });
  assertEquals(low.bid_value, 3_500_000);
  assertEquals(low.bid_strategy, "MANUAL_BIDDING");
  // $100.00 → 100,000,000 micro → accept.
  const high = buildRedditAdGroupBody({ ...base, bidValueCents: 10_000 });
  assertEquals(high.bid_value, 100_000_000);
  // $100.01 → 100,010,000 micro → reject.
  assertThrows(() => buildRedditAdGroupBody({ ...base, bidValueCents: 10_001 }), AdApiError);
  // Non-integer cents fail CLOSED (no silent rounding at the money boundary).
  assertThrows(() => buildRedditAdGroupBody({ ...base, budgetCents: 350.5 }));
  assertThrows(() => buildRedditAdGroupBody({ ...base, budgetCents: -500 }));
});

// ── A11 · rate-limit honoring beyond the happy 429 ────────────────────────────

Deno.test("ADV-A11: r=0 on a SUCCESSFUL response gates the NEXT call to the reset window", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const sleeps: number[] = [];
    setRedditSleepForTests((ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    });
    const { calls, restore } = installApiMock((req) => {
      if (req.url.includes("/me")) {
        // 200 OK — but the pool is exhausted (r=0, resets in 7s).
        return jsonResponse({ data: { id: PROFILE } }, 200, {
          RateLimit: '"ads-campaign-management-read";r=0;t=7',
        });
      }
      return jsonResponse({ data: [] });
    });
    try {
      const client = await resolveRedditClient(CONN);
      await redditRequest(client, "GET", "/me"); // 200 + r=0 recorded
      await redditRequest(client, "GET", "/me/businesses"); // must back off FIRST
      assert(sleeps.length >= 1, "the next call must sleep out the reset window");
      assert(
        sleeps[0] > 6_000 && sleeps[0] <= 7_000,
        `expected a ~7s backoff before the next call; got ${sleeps[0]}ms`,
      );
      assertEquals(calls.filter((c) => c.url.includes("/me/businesses")).length, 1);
    } finally {
      restore();
    }
  });
});

Deno.test("ADV-A11: a 429 with NO RateLimit header still backs off (5s default) and retries once", async () => {
  await withRedditEnv(BASE_ENV, async () => {
    const sleeps: number[] = [];
    setRedditSleepForTests((ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    });
    let apiHits = 0;
    const { restore } = installApiMock(() => {
      apiHits++;
      if (apiHits === 1) return jsonResponse({ error: "too many" }, 429);
      return jsonResponse({ data: { id: PROFILE } });
    });
    try {
      const client = await resolveRedditClient(CONN);
      const payload = await redditRequest(client, "GET", "/me");
      assertEquals((payload.data as Record<string, unknown>).id, PROFILE);
      assertEquals(apiHits, 2, "exactly one retry after the 429");
      assert(sleeps.some((ms) => ms === 5_000), "headerless 429 must use the 5s default window");
    } finally {
      restore();
    }
  });
});

// ── A12 · P1 QA-916-1: the 'unconfigured' placeholder must never pin step 4 ───
// RUNTIME-PROVEN against the local stack (see QA_ISSUE-916_WP6.md): a failed
// connect persists external_account_id:'unconfigured'; every reconnect then
// dies at step 4 ("No ad account matching ^(t2|a2)_") until manual DB surgery.
// This test asserts the FIXED behavior and is ignored until the REWORK lands —
// unignore it in the rework commit; it must then pass.

Deno.test({
  name:
    "ADV-A12 [P1 QA-916-1, ignore until REWORK]: reconnect after an invalid-row upsert must succeed",
  ignore: true,
  fn: async () => {
    await withRedditEnv(BASE_ENV, async () => {
      const happyApi = (req: CapturedRequest): Response => {
        if (req.url.includes("/me/businesses")) {
          return jsonResponse({
            data: [{ id: "950c8eac-da26-45e6-942e-645ed657e43f", name: "Mingla" }],
          });
        }
        if (req.url.includes("/ad_accounts") && req.url.includes("/businesses/")) {
          return jsonResponse({
            data: [{ id: "a2_jcfwvnfcfqcs", name: "Mingla Ad Account 0", currency: "USD" }],
          });
        }
        if (req.url.includes("/profiles")) {
          return jsonResponse({ data: [{ id: PROFILE }] });
        }
        if (req.url.includes("/funding_instruments")) {
          return jsonResponse({
            data: [{ id: "1889187", is_servable: true, reasons_not_servable: [] }],
          });
        }
        if (req.url.includes("/pixels")) {
          return jsonResponse({ data: [{ id: "a2_jcfwvnfcfqcs" }] });
        }
        if (req.url.includes("/me")) return jsonResponse({ data: { id: PROFILE } });
        return jsonResponse({ data: [] });
      };
      const { restore } = installApiMock(happyApi);
      try {
        // The poisoned row a failed connect leaves behind (markRedditInvalid).
        const poisoned = {
          ...CONN,
          external_account_id: "unconfigured",
          status: "invalid",
          connected: false,
          extra: {},
        } as unknown as AdConnectionRow;
        const snapshot = await redditConnectPreflight(poisoned, "consumer");
        assertEquals(
          snapshot.account.id,
          "a2_jcfwvnfcfqcs",
          "the 'unconfigured' placeholder must be ignored as an account pin",
        );
      } finally {
        restore();
      }
    });
  },
});
