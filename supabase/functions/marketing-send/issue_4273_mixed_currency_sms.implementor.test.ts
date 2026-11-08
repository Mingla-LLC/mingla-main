// #4273 — the group preview prices a mixed-currency SMS method, maps every
// quote failure to its own honest code (never "stale" unless the sealed set
// changed), and prices only the drafts the client named.
// MINGLA-INVARIANT: I-4273-STALE-MEANS-STALE | issue #4273 | marketing-send returns BOOK_BLAST_PREVIEW_STALE only when the sealed set, hash, cost or currency changed or the quote aged out; any other quote-build failure has its own code.
// MINGLA-INVARIANT: I-4273-GROUP-PREVIEW-PRICES-PICKED-METHODS | issue #4273 | When the client names the campaigns it is sending, the group preview prices only those; a group campaign it did not name is never counted.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildCampaignGroupPreview } from "./campaignGroupPreview.ts";
import {
  bookRpcErrorEnvelope,
  groupErrorStatus,
  groupMethodErrorCode,
  handleGroupPreview,
  parseGroupCampaignIds,
  resolveQuoteBrand,
  selectGroupDrafts,
} from "./index.ts";
import type { SmsFxConverter } from "../_shared/marketingSmsFx.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const RATES = [
  {
    rateId: "termii-ng",
    provider: "termii" as const,
    country: "NG",
    currency: "NGN",
    unit: "sms_segment" as const,
    minorNumerator: 265,
    minorDenominator: 1,
    effectiveAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    sourceReference: "termii-card",
  },
  {
    rateId: "twilio-us",
    provider: "twilio" as const,
    country: "US",
    currency: "USD",
    unit: "sms_segment" as const,
    minorNumerator: 79,
    minorDenominator: 1,
    effectiveAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    sourceReference: "twilio-card",
  },
];
const LEAD = "11111111-1111-4111-8111-111111111111";
const SMS_ID = "22222222-2222-4222-8222-222222222222";

const MIXED_SMS = {
  brandId: "brand",
  channel: "sms" as const,
  selectedCount: 2,
  content: { kind: "sms", body: "Doors at 9" },
  audienceId: "aud",
  audienceKind: "combined_sources" as const,
  audienceVersion: 1,
  audienceName: "Your Book",
  candidates: [
    {
      personKey: "ade",
      brandPersonId: "p-ade",
      contactMethodId: "m-ade",
      normalizedContact: "+2348012345678",
      allowed: true,
      safeReasonCode: "allowed",
    },
    {
      personKey: "sam",
      brandPersonId: "p-sam",
      contactMethodId: "m-sam",
      normalizedContact: "+14155550100",
      allowed: true,
      safeReasonCode: "allowed",
    },
  ],
};
const EMAIL = {
  ...MIXED_SMS,
  channel: "email" as const,
  content: { kind: "email" },
  candidates: MIXED_SMS.candidates.map((c, i) => ({
    ...c,
    normalizedContact: `p${i}@x.test`,
  })),
};

const FX: SmsFxConverter = {
  convert: ({ subtotals, targetCurrency }) =>
    Promise.resolve({
      snapshotId: "snap-1",
      provider: "exchange_rate_api_open_v6" as const,
      converted: subtotals.map((row) => ({
        currency: row.currency,
        providerCostMinor: row.estimatedCostMinor,
        convertedCostMinor: row.currency === targetCurrency
          ? row.estimatedCostMinor
          : row.estimatedCostMinor * 1600,
      })),
    }),
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    loadGroup: () =>
      Promise.resolve({
        rows: [{ id: SMS_ID, channel: "sms" as const }],
        unlisted: [],
      }),
    candidates: () => Promise.resolve(MIXED_SMS),
    quoteBrand: () => Promise.resolve({ followBrand: null, costCurrency: "NGN" }),
    fx: FX,
    allowance: (_c: unknown, quote: Record<string, unknown>) =>
      Promise.resolve(quote),
    errorCode: groupMethodErrorCode,
    smsCountryLive: () => true, smsRates: RATES,
    ...overrides,
  };
}

Deno.test("#4273 T-7 the group preview prices a mixed-currency SMS method in the brand currency", async () => {
  const preview = await buildCampaignGroupPreview(deps(), LEAD, NOW);
  const method = preview.methods[0];
  assert(method.quote !== null, String(method.error));
  // NGN 265 + USD 79 × 1600 = 126400.
  assertEquals(method.quote.currency, "NGN");
  assertEquals(method.quote.estimatedCostMinor, 265 + 126400);
  assertEquals(preview.group?.currency, "NGN");
  assertEquals(preview.group?.estimatedCostMinor, method.quote.estimatedCostMinor);
  assertEquals(preview.group?.costKind, "provider_estimate");
  assertEquals(preview.group?.costBreakdown, [
    { currency: "NGN", providerCostMinor: 265, convertedCostMinor: 265 },
    { currency: "USD", providerCostMinor: 79, convertedCostMinor: 126400 },
  ]);
  assert(!JSON.stringify(preview).includes("snap-1"));
});

Deno.test("#4273 T-8 a group method's quote failure is never reported as stale", async () => {
  const cases: Array<[string, string]> = [
    ["mixed_currency_cost_unsupported", "BOOK_BLAST_COST_UNAVAILABLE"],
    ["cost_unavailable:brand_lookup", "BOOK_BLAST_COST_UNAVAILABLE"],
    ["follow_brand_lookup:down", "BOOK_BLAST_COST_UNAVAILABLE"],
    ["book_blast_quote_invalid", "BOOK_BLAST_COST_UNAVAILABLE"],
    ["cost_unavailable:fx_unavailable", "BOOK_BLAST_COST_UNAVAILABLE"],
    ["some postgrest text", "BOOK_BLAST_COST_UNAVAILABLE"],
    ["book_blast_mms_not_supported", "BOOK_BLAST_MMS_NOT_SUPPORTED"],
    ["sms_rate_unavailable", "BOOK_BLAST_RATE_BOOK_UNAVAILABLE"],
  ];
  for (const [message, code] of cases) {
    assertEquals(groupMethodErrorCode(new Error(message)), code, message);
  }
  // Through the builder: no FX for a mixed set is COST, not STALE.
  const preview = await buildCampaignGroupPreview(
    deps({ fx: undefined }),
    LEAD,
    NOW,
  );
  assertEquals(preview.methods[0].error, "BOOK_BLAST_COST_UNAVAILABLE");
  // The RPC path: an unknown database error is UNAVAILABLE, not STALE.
  assertEquals(bookRpcErrorEnvelope("some postgrest text"), {
    error: "BOOK_BLAST_PREVIEW_UNAVAILABLE",
    status: 503,
  });
});

Deno.test("#4273 T-9 every SQL stale token is still STALE, explicitly", () => {
  for (
    const token of [
      "book_blast_preview_stale",
      "manual_group_preview_stale",
      "circle_blast_snapshot_stale",
    ]
  ) {
    assertEquals(bookRpcErrorEnvelope(token), {
      error: "BOOK_BLAST_PREVIEW_STALE",
      status: 409,
    });
    assertEquals(groupMethodErrorCode(new Error(token)), "BOOK_BLAST_PREVIEW_STALE");
  }
  assertEquals(bookRpcErrorEnvelope("xyz"), {
    error: "BOOK_BLAST_PREVIEW_UNAVAILABLE",
    status: 503,
  });
  assertEquals(bookRpcErrorEnvelope("circle_blast_forbidden").error, "BOOK_BLAST_FORBIDDEN");
});

function groupClient(options: {
  drafts: Array<{ id: string; channel: string }>;
  rpc: (name: string, args: Record<string, unknown>) => unknown;
  brand?: Record<string, unknown> | null;
}) {
  const quoted: string[] = [];
  return {
    quoted,
    client: {
      from: (table: string) => ({
        select: () => ({
          or: () => ({
            eq: () => Promise.resolve({ data: options.drafts, error: null }),
          }),
          eq: (column: string) =>
            table === "brands"
              ? {
                maybeSingle: () =>
                  Promise.resolve({ data: options.brand ?? null, error: null }),
              }
              : column === "id"
              ? {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: LEAD, campaign_group_id: LEAD },
                    error: null,
                  }),
              }
              : {
                eq: () => Promise.resolve({ data: options.drafts, error: null }),
              },
        }),
      }),
      rpc: (name: string, args: Record<string, unknown>) => {
        if (typeof args?.p_campaign_id === "string") quoted.push(args.p_campaign_id);
        return Promise.resolve(options.rpc(name, args));
      },
    },
  };
}

Deno.test("#4273 T-10 when every method is refused for cost, the status is 503, not 409", async () => {
  const { client } = groupClient({
    drafts: [{ id: LEAD, channel: "sms" }],
    rpc: (name) =>
      name === "biz_brand_blast_usage_v1"
        ? { data: {}, error: null }
        : { data: MIXED_SMS, error: null },
    // No brand row → cost_unavailable:brand_lookup.
    brand: null,
  });
  const response = await handleGroupPreview(client, "actor", LEAD, NOW);
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error, "BOOK_BLAST_COST_UNAVAILABLE");
  assertEquals(groupErrorStatus("BOOK_BLAST_PREVIEW_STALE"), 409);
  assertEquals(groupErrorStatus("BOOK_BLAST_AUDIENCE_NOT_FOUND"), 404);
  assertEquals(groupErrorStatus("BOOK_BLAST_COST_UNAVAILABLE"), 503);
});

Deno.test("#4273 T-11 a leftover SMS draft the client did not name is never priced", async () => {
  const { client, quoted } = groupClient({
    drafts: [{ id: LEAD, channel: "email" }, { id: SMS_ID, channel: "sms" }],
    rpc: (name, args) =>
      name === "biz_brand_blast_usage_v1"
        ? { data: {}, error: null }
        : { data: args.p_campaign_id === SMS_ID ? MIXED_SMS : EMAIL, error: null },
  });
  const response = await handleGroupPreview(client, "actor", LEAD, NOW, [LEAD]);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.methods.map((m: { channel: string }) => m.channel), ["email"]);
  assertEquals(body.group.estimatedCostMinor, null);
  assertEquals(body.group.costKind, "not_metered");
  assertEquals(body.unlistedDraftIds, [SMS_ID]);
  assert(!quoted.includes(SMS_ID));
  // Old builds name nothing: every group draft, as before.
  assertEquals(selectGroupDrafts([{ id: LEAD, channel: "email" }], undefined), {
    rows: [{ id: LEAD, channel: "email" }],
    unlisted: [],
  });
});

Deno.test("#4273 the group head is never handed back for discarding when the lead is a sibling", async () => {
  // H is the host's original campaign (group head); S is a sibling the host
  // reopened from Drafts and now sends alone. S names only itself.
  const H = "33333333-3333-4333-8333-333333333333";
  const out = selectGroupDrafts(
    [{ id: H, channel: "email" }, { id: SMS_ID, channel: "sms" }],
    [SMS_ID],
    H,
  );
  assertEquals(out.rows, [{ id: SMS_ID, channel: "sms" }]);
  assertEquals(out.unlisted, []);
  // Through the handler: the lead S belongs to group H.
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { id: SMS_ID, campaign_group_id: H }, error: null }),
        }),
        or: (filter: string) => {
          assert(filter.includes(`id.eq.${H}`), filter);
          return {
            eq: () =>
              Promise.resolve({
                data: [{ id: H, channel: "email" }, { id: SMS_ID, channel: "sms" }],
                error: null,
              }),
          };
        },
      }),
    }),
    rpc: (name: string) =>
      Promise.resolve(
        name === "biz_brand_blast_usage_v1"
          ? { data: {}, error: null }
          : { data: EMAIL, error: null },
      ),
  };
  const response = await handleGroupPreview(client, "actor", SMS_ID, NOW, [SMS_ID]);
  assertEquals(response.status, 200);
  assertEquals((await response.json()).unlistedDraftIds, []);
});

Deno.test("#4273 T-12 campaign_ids is validated; a named id that is not a group draft is stale", async () => {
  assertEquals(parseGroupCampaignIds(undefined, LEAD), null);
  assertEquals(parseGroupCampaignIds([LEAD, SMS_ID], LEAD), [LEAD, SMS_ID]);
  assertEquals(parseGroupCampaignIds([SMS_ID], LEAD), "invalid");
  assertEquals(
    parseGroupCampaignIds([LEAD, SMS_ID, crypto.randomUUID(), crypto.randomUUID()], LEAD),
    "invalid",
  );
  assertEquals(parseGroupCampaignIds([LEAD, "not-a-uuid"], LEAD), "invalid");
  assertEquals(parseGroupCampaignIds([LEAD, LEAD], LEAD), "invalid");
  assertEquals(parseGroupCampaignIds("x", LEAD), "invalid");
  const { client } = groupClient({
    drafts: [{ id: LEAD, channel: "email" }],
    rpc: () => ({ data: EMAIL, error: null }),
  });
  const response = await handleGroupPreview(client, "actor", LEAD, NOW, [LEAD, SMS_ID]);
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "BOOK_BLAST_PREVIEW_STALE");
});

Deno.test("#4273 one brand read gives the Follow line and the cost currency", async () => {
  const db = (data: Record<string, unknown> | null) => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }),
      }),
    }),
  });
  const smsFollow = { ...MIXED_SMS, content: { body: "x", include_follow_cta: true } };
  assertEquals(
    await resolveQuoteBrand(
      db({ name: "Harmattan", slug: "harmattan", pricing_currency: "ngn", default_currency: "USD" }),
      smsFollow,
    ),
    { followBrand: { name: "Harmattan", slug: "harmattan" }, costCurrency: "NGN" },
  );
  assertEquals(
    await resolveQuoteBrand(
      db({ name: "B", slug: "", pricing_currency: null, default_currency: "GBP" }),
      MIXED_SMS,
    ),
    { followBrand: null, costCurrency: "GBP" },
  );
  assertEquals(await resolveQuoteBrand(db(null), EMAIL), {
    followBrand: null,
    costCurrency: null,
  });
  await assertRejects(
    () => resolveQuoteBrand(db(null), MIXED_SMS),
    Error,
    "cost_unavailable:brand_lookup",
  );
});
