/**
 * ISSUE-997 scope D2 — Google Demand Gen VIDEO create — INDEPENDENT TESTER
 * adversarial suite (a DIFFERENT ANGLE from the implementor happy-path).
 *
 * The implementor's happy-path (issue997_google_video_create.test.ts) proves the
 * NOMINAL wire shape, the at-cap boundaries for businessName(25)/headline(40), a
 * validateOnly:true zero-object create, and SOURCE-shape assertions on the create
 * branch. It checks the validator only at the BOOLEAN level (`.ok`).
 *
 * This suite attacks the NEGATIVE space the happy-path never touched, at the LIVE
 * function level (not source-string matching):
 *
 *   1. The validator's exact ERROR-DETAIL CONTRACT — every failure mode's `detail`
 *      code (not just `.ok:false`), the FIRST-FAIL ordering when several fields are
 *      bad at once, the non-string / whitespace-only `_invalid` path, and the
 *      trim-at-boundary semantics (the validator measures TRIMMED length, exactly
 *      what the builder emits).
 *   2. The DERIVATION cap invariant the create branch relies on (§1c of the create
 *      branch): a DERIVED longHeadlines === headlines (each ≤40) can NEVER overflow
 *      the ≤90 long-headline cap; a slug-derived businessName (slice(0,25)) can
 *      NEVER overflow ≤25 — proved against adversarially long inputs so the
 *      derivation defaults are structurally safe.
 *   3. The create fn's fail-CLOSED on an UNVERIFIABLE success — validateOnly:false +
 *      a mutate response MISSING the campaign/adGroup/adGroupAd resource names throws
 *      `unexpected_mutate_response` (refuses to persist an unverifiable create); AND
 *      the real-create parse extracts the numeric campaign / adGroup ids and the
 *      `{adGroupId}~{adId}` composite ad id.
 *   4. Builder CARDINALITY — 0 geo criteria (no criterion op) and N=3 geo criteria
 *      (3 AD-GROUP criterion ops, each bound to the ad-group temp resource — #1303
 *      RC-1), and a GENERALIZED define-before-reference invariant (every temp
 *      resourceName referenced by an op is DEFINED by an earlier op, incl. the
 *      logo asset); plus the optional trackingUrlTemplate is OMITTED (never
 *      injected null/empty) when absent.
 *
 * fails-on-revert: recorded in the tester QA report (revert the seam → the named
 * test goes RED → restore → GREEN).
 *
 * Pure/mocked-runtime only. NO live provider/network call, NO ad object, NO spend.
 * The DEMAND_GEN wire shape is LIVE-VALIDATED (#1303 — validateOnly:true HTTP 200
 * on v24 AND v25); the tester's post-deploy live validate_only ACCEPT re-confirm is
 * a SEPARATE orchestrator/tester step, not this gate.
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue997_google_video_create.adversarial.tester.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { AdApiError, type AdConnectionRow } from "../adChannel.ts";
import {
  buildGoogleDemandGenMutateOperations,
  buildGoogleDemandGenMutateRequest,
  GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX,
  GOOGLE_DEMAND_GEN_DESCRIPTION_MAX_CHARS,
  GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS,
  GOOGLE_DEMAND_GEN_LONG_HEADLINE_MAX_CHARS,
  googleCreateDemandGenVideoCampaign,
  type GoogleDemandGenVideoInput,
  resetGoogleTokenCacheForTests,
  validateGoogleDemandGenAd,
} from "../google.ts";
import { MINGLA_SQUARE_LOGO_PNG_BASE64 } from "../adDemandGenLogo.ts";

const CUSTOMER_ID = "3623860476";

const GOOD_INPUT: GoogleDemandGenVideoInput = {
  name: "Adversarial DG Video",
  dailyBudgetCents: 2000,
  finalUrl: "https://usemingla.com/e/test-brand/test-event",
  trackingUrlTemplate: "https://go.usemingla.com/w36m?pid=google_ads",
  businessName: "Test Brand",
  headlines: ["Book Test Event", "Live in London"],
  longHeadlines: ["Book the long-form headline that runs a bit longer here"],
  descriptions: ["A real Mingla event you can book today.", "Limited."],
  youtubeVideoId: "dQw4w9WgXcQ",
  // #1303 RC-3: the REQUIRED square logo image (base64 PNG bytes).
  logoImageData: MINGLA_SQUARE_LOGO_PNG_BASE64,
  geoTargetCriterionIds: ["1006886"],
};

const OK_COPY = {
  businessName: "Brand",
  headlines: ["Headline"],
  longHeadlines: ["Long headline"],
  descriptions: ["Desc"],
};

// Narrows GoogleValidation (a discriminated union) to its `detail` (undefined on ok).
function detailOf(
  input: {
    businessName: unknown;
    headlines: unknown;
    longHeadlines: unknown;
    descriptions: unknown;
  },
): string | undefined {
  const v = validateGoogleDemandGenAd(input);
  return v.ok ? undefined : v.detail;
}

function okOf(input: {
  businessName: unknown;
  headlines: unknown;
  longHeadlines: unknown;
  descriptions: unknown;
}): boolean {
  return validateGoogleDemandGenAd(input).ok;
}

function opOfType(
  ops: Record<string, unknown>[],
  key: string,
): Record<string, unknown> | undefined {
  const wrapper = ops.find((o) => key in o);
  if (!wrapper) return undefined;
  return (wrapper[key] as Record<string, unknown>).create as Record<
    string,
    unknown
  >;
}

// ── 1. The validator's exact error-detail CONTRACT (not just `.ok`) ───────────

Deno.test("ADV D2 validator: each failure mode returns its EXACT detail code", () => {
  assertEquals(
    detailOf({ ...OK_COPY, businessName: "" }),
    "demand_gen_business_name_required",
  );
  assertEquals(
    detailOf({ ...OK_COPY, businessName: "x".repeat(26) }),
    "demand_gen_business_name_too_long",
  );
  assertEquals(
    detailOf({ ...OK_COPY, headlines: [] }),
    "demand_gen_headlines_required",
  );
  assertEquals(
    detailOf({ ...OK_COPY, headlines: ["x".repeat(41)] }),
    "demand_gen_headlines_too_long",
  );
  assertEquals(
    detailOf({ ...OK_COPY, longHeadlines: [] }),
    "demand_gen_long_headlines_required",
  );
  assertEquals(
    detailOf({ ...OK_COPY, longHeadlines: ["x".repeat(91)] }),
    "demand_gen_long_headlines_too_long",
  );
  assertEquals(
    detailOf({ ...OK_COPY, descriptions: [] }),
    "demand_gen_descriptions_required",
  );
  assertEquals(
    detailOf({ ...OK_COPY, descriptions: ["x".repeat(91)] }),
    "demand_gen_descriptions_too_long",
  );
});

Deno.test("ADV D2 validator: a non-string OR whitespace-only array element is `_invalid`, never silently coerced", () => {
  // A number smuggled into headlines — must NOT stringify into the wire.
  assertEquals(
    detailOf({ ...OK_COPY, headlines: [123 as unknown as string] }),
    "demand_gen_headlines_invalid",
  );
  // Whitespace-only trims to empty — an all-spaces "headline" is not a headline.
  assertEquals(
    detailOf({ ...OK_COPY, longHeadlines: ["   "] }),
    "demand_gen_long_headlines_invalid",
  );
  // null element in descriptions.
  assertEquals(
    detailOf({ ...OK_COPY, descriptions: [null as unknown as string] }),
    "demand_gen_descriptions_invalid",
  );
});

Deno.test("ADV D2 validator: FIRST-FAIL ordering — businessName › headlines › longHeadlines › descriptions", () => {
  // Every field is bad at once; the FIRST checked failing field wins.
  const allBad = {
    businessName: "",
    headlines: [],
    longHeadlines: [],
    descriptions: [],
  };
  assertEquals(detailOf(allBad), "demand_gen_business_name_required");
  // Fix businessName → headlines is next.
  assertEquals(
    detailOf({ ...allBad, businessName: "Brand" }),
    "demand_gen_headlines_required",
  );
  // Fix headlines → longHeadlines is next.
  assertEquals(
    detailOf({ ...allBad, businessName: "Brand", headlines: ["H"] }),
    "demand_gen_long_headlines_required",
  );
  // Fix long → descriptions is last.
  assertEquals(
    detailOf({
      ...allBad,
      businessName: "Brand",
      headlines: ["H"],
      longHeadlines: ["LH"],
    }),
    "demand_gen_descriptions_required",
  );
});

Deno.test("ADV D2 validator: caps measure TRIMMED length — whitespace-padded at-cap PASSES, real overflow FAILS at every field", () => {
  // Exactly at-cap wrapped in whitespace → trims to at-cap → allowed (the builder
  // emits `.trim()`, so the validated length is the wire length).
  assertEquals(
    okOf({
      ...OK_COPY,
      businessName: "  " + "x".repeat(GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX) +
        "  ",
    }),
    true,
  );
  // Long-headline and description at EXACTLY 90 pass (the happy-path only proved
  // business/headline at-cap — this closes the long/desc at-cap boundary).
  assertEquals(
    okOf({
      ...OK_COPY,
      longHeadlines: ["x".repeat(GOOGLE_DEMAND_GEN_LONG_HEADLINE_MAX_CHARS)],
    }),
    true,
  );
  assertEquals(
    okOf({
      ...OK_COPY,
      descriptions: ["x".repeat(GOOGLE_DEMAND_GEN_DESCRIPTION_MAX_CHARS)],
    }),
    true,
  );
  // A trailing non-space token pushes a trimmed headline OVER 40 → rejected.
  assertEquals(
    detailOf({
      ...OK_COPY,
      headlines: ["x".repeat(GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS) + " y"],
    }),
    "demand_gen_headlines_too_long",
  );
});

// ── 2. The DERIVATION cap invariant the create branch depends on ──────────────

// Replicates deriveGoogleBusinessName (non-exported, index.ts:255) so the property
// is proved independently of the create-branch plumbing.
function deriveBusinessName(brandSlug: string): string {
  const titled = brandSlug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
  return (titled || "Mingla").slice(0, 25);
}

Deno.test("ADV D2 derivation: a slug-derived businessName is ALWAYS ≤25 and ALWAYS validates (even for a pathological slug)", () => {
  const slugs = [
    "smoke-and-rhythm",
    "aaaa-bbbb-cccc-dddd-eeee-ffff-gggg", // long → must be truncated
    "the-very-longest-independent-fine-dining-lounge-in-the-city",
    "---", // all separators → empty title → "Mingla" fallback
    "x".repeat(200),
  ];
  for (const slug of slugs) {
    const derived = deriveBusinessName(slug);
    assert(
      derived.length <= GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX,
      `derived "${derived}" (${derived.length}) exceeds 25 for slug "${slug}"`,
    );
    assert(
      derived.trim().length > 0,
      "derived business name must never be blank",
    );
    // The DERIVED value must never trip the validator (it is truncated, not 422'd).
    assertEquals(okOf({ ...OK_COPY, businessName: derived }), true);
  }
});

Deno.test("ADV D2 derivation: longHeadlines defaulted FROM headlines can never overflow ≤90 (40 < 90) — the fallback is structurally safe", () => {
  // Any headline set that PASSES the ≤40 headline gate is, by construction, also
  // ≤90 — so the create branch's `longHeadlinesGV = headlinesGV` default is safe.
  const headlineSets = [
    ["Short"],
    ["x".repeat(GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS)], // exactly 40
    ["Book Test Event", "Live in London", "x".repeat(39)],
  ];
  for (const headlines of headlineSets) {
    // Precondition: headlines valid at ≤40.
    assertEquals(okOf({ ...OK_COPY, headlines }), true);
    // Derived longHeadlines = the SAME array → must validate at ≤90.
    assertEquals(
      okOf({ ...OK_COPY, headlines, longHeadlines: headlines }),
      true,
    );
  }
  // Sanity floor: 40 is strictly below 90, so the invariant cannot silently rot.
  assert(
    GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS <
      GOOGLE_DEMAND_GEN_LONG_HEADLINE_MAX_CHARS,
  );
});

// ── 3. The create fn: fail-CLOSED on an unverifiable success + real-create parse ─

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000002",
  platform: "google",
  lane: "consumer",
  display_name: "Google Ads · Consumer",
  external_account_id: "3623860476",
  external_org_id: "8280000000",
  auth_kind: "dev_token_oauth",
  token_env_var: "GOOGLE_ADS_REFRESH_TOKEN",
  extra: {},
  status: "connected",
  currency: "USD",
  timezone: "America/New_York",
  min_daily_budget_cents: null,
  account_status: "ENABLED",
  token_last_verified_at: null,
  connected: true,
};

const GOOGLE_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_CUSTOMER_ID",
];

// Runs `body` with the Google env stubbed and fetch mocked to a fixed mutate
// response, restoring both afterward. Never touches the network.
async function withMockedGoogle(
  mutateResponse: unknown,
  body: () => Promise<void>,
): Promise<void> {
  const prior = new Map<string, string | undefined>();
  for (const n of GOOGLE_ENV) {
    prior.set(n, Deno.env.get(n));
    Deno.env.set(n, n === "GOOGLE_ADS_CUSTOMER_ID" ? CUSTOMER_ID : `test-${n}`);
  }
  resetGoogleTokenCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    _init?: RequestInit,
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }),
          { status: 200 },
        ),
      );
    }
    if (url.includes("googleAds:mutate")) {
      return Promise.resolve(
        new Response(JSON.stringify(mutateResponse), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [n, v] of prior) {
      if (v !== undefined) Deno.env.set(n, v);
      else Deno.env.delete(n);
    }
    resetGoogleTokenCacheForTests();
  }
}

Deno.test("ADV D2 create fn: a real create whose mutate response is MISSING the campaign/adGroup/adGroupAd ids fails CLOSED (never persists an unverifiable create)", async () => {
  // Google returns 200 OK but only a budget result — the campaign/adGroup/ad ids
  // are absent. Persisting anything here would orphan an unverifiable object.
  await withMockedGoogle(
    {
      mutateOperationResponses: [
        {
          campaignBudgetResult: {
            resourceName: "customers/3623860476/campaignBudgets/1",
          },
        },
      ],
    },
    async () => {
      const err = await assertRejects(
        () =>
          googleCreateDemandGenVideoCampaign(CONN, {
            ...GOOD_INPUT,
            validateOnly: false,
          }),
        AdApiError,
      );
      assertEquals((err as AdApiError).code, "unexpected_mutate_response");
      assertEquals((err as AdApiError).platform, "google");
      assertStringIncludes((err as AdApiError).message, "refusing to persist");
    },
  );
});

Deno.test("ADV D2 create fn: a real create parses the numeric campaign/adGroup ids and the {adGroupId}~{adId} composite ad id", async () => {
  await withMockedGoogle(
    {
      mutateOperationResponses: [
        {
          campaignBudgetResult: {
            resourceName: "customers/3623860476/campaignBudgets/777",
          },
        },
        {
          campaignResult: {
            resourceName: "customers/3623860476/campaigns/555",
          },
        },
        {
          assetResult: { resourceName: "customers/3623860476/assets/333" },
        },
        {
          adGroupResult: {
            resourceName: "customers/3623860476/adGroups/444",
          },
        },
        {
          adGroupAdResult: {
            resourceName: "customers/3623860476/adGroupAds/444~999",
          },
        },
      ],
    },
    async () => {
      const result = await googleCreateDemandGenVideoCampaign(CONN, {
        ...GOOD_INPUT,
        validateOnly: false,
      });
      assertEquals(result.validated, false);
      assertEquals(result.externalCampaignId, "555");
      assertEquals(result.externalAdSetId, "444");
      // The ad id is the {adGroupId}~{adId} composite, not a bare number.
      assertEquals(result.externalAdId, "444~999");
      assertStringIncludes(
        result.budgetResourceName ?? "",
        "/campaignBudgets/777",
      );
    },
  );
});

// ── 4. Builder cardinality + generalized define-before-reference ──────────────

Deno.test("ADV D2 builder: ZERO geo criteria → no geo criterion op at all, and define-before-reference still holds (incl. the logo asset)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, {
    ...GOOD_INPUT,
    geoTargetCriterionIds: [],
  });
  // #1303: video asset + logo asset both ride; geo (when present) is ad-group level.
  const keys = ops.map((o) => Object.keys(o)[0]);
  assertEquals(keys, [
    "campaignBudgetOperation",
    "campaignOperation",
    "assetOperation",
    "assetOperation",
    "adGroupOperation",
    "adGroupAdOperation",
  ]);
  // No geo → neither a campaign- nor an ad-group-level criterion op.
  assertEquals(ops.filter((o) => "campaignCriterionOperation" in o).length, 0);
  assertEquals(ops.filter((o) => "adGroupCriterionOperation" in o).length, 0);
  assertGeneralizedDefineBeforeReference(ops);
});

Deno.test("ADV D2 builder: N=3 geo criteria → 3 AD-GROUP criterion ops (#1303 RC-1), each bound to the ad-group temp resource", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, {
    ...GOOD_INPUT,
    geoTargetCriterionIds: ["1006886", "1013962", "2840"],
  });
  // #1303 RC-1: geo lives at the AD-GROUP level — NOT the campaign level.
  assertEquals(ops.filter((o) => "campaignCriterionOperation" in o).length, 0);
  const criterionOps = ops.filter((o) => "adGroupCriterionOperation" in o);
  assertEquals(criterionOps.length, 3);
  const adGroupRes = opOfType(ops, "adGroupOperation")!
    .resourceName as string;
  for (const c of criterionOps) {
    const create = (c.adGroupCriterionOperation as Record<string, unknown>)
      .create as Record<string, unknown>;
    assertEquals(create.adGroup, adGroupRes);
    const loc = create.location as Record<string, unknown>;
    assertStringIncludes(
      loc.geoTargetConstant as string,
      "geoTargetConstants/",
    );
  }
  assertGeneralizedDefineBeforeReference(ops);
});

Deno.test("ADV D2 builder: the OneLink trackingUrlTemplate is OMITTED (not null/empty) when absent", () => {
  const noOneLink: GoogleDemandGenVideoInput = { ...GOOD_INPUT };
  delete (noOneLink as { trackingUrlTemplate?: string }).trackingUrlTemplate;
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, noOneLink);
  const campaign = opOfType(ops, "campaignOperation")!;
  // The KEY must be absent — never a null/empty tracking template on the wire.
  assertEquals("trackingUrlTemplate" in campaign, false);
});

Deno.test("ADV D2 envelope: validateOnly defaults to false when the flag is omitted (no accidental silent validate-only)", () => {
  const req = buildGoogleDemandGenMutateRequest(CUSTOMER_ID, GOOD_INPUT);
  // GOOD_INPUT carries no validateOnly → must be an explicit false (a real create),
  // never undefined/true. A silent validate-only would create nothing while the
  // caller believes it launched.
  assertEquals(req.validateOnly, false);
  assertEquals(req.partialFailure, false);
});

// Generalized define-before-reference: every temp resourceName that any op
// REFERENCES must be DEFINED (as a `resourceName`) by an EARLIER op in the list.
function assertGeneralizedDefineBeforeReference(
  ops: Record<string, unknown>[],
): void {
  const defined = new Set<string>();
  const tempRef =
    /customers\/\d+\/(campaignBudgets|campaigns|assets|adGroups)\/-\d+/g;
  for (const op of ops) {
    const create = (Object.values(op)[0] as Record<string, unknown>)
      .create as Record<string, unknown>;
    // 1. Any temp resource referenced by THIS op must already be defined.
    const serialized = JSON.stringify({ ...create, resourceName: undefined });
    for (const ref of serialized.match(tempRef) ?? []) {
      assert(
        defined.has(ref),
        `op references temp resource ${ref} before it is defined`,
      );
    }
    // 2. Then register this op's own resourceName (if it declares one).
    if (typeof create.resourceName === "string") {
      defined.add(create.resourceName);
    }
  }
}
