// #4273 wave B — one locked preview across methods; quote, group figures and
// the buyer subject. The database half is the pg17 suite of the same name.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildCampaignGroupPreview } from "./campaignGroupPreview.ts";
import {
  combinedHiddenSkips,
  existingBookSendResponse,
  handleGroupPreview,
  hostVisibleSkipped,
  isInterruptedSmsRow,
  shouldSkipDispatchedRecipient,
} from "./index.ts";
import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";
import { assertAudienceQueryMatchesCampaignBrand } from "../_shared/marketingAudienceBrandGate.ts";
import { renderBrandReachMessage } from "../_shared/brandReachMessages.ts";
import { resolveAudience } from "../_shared/marketingAudience.ts";
import { sendPushCampaign } from "./pushCampaign.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const RATES = [{
  rateId: "r1",
  provider: "twilio" as const,
  country: "US",
  currency: "USD",
  unit: "sms_segment" as const,
  minorNumerator: 1,
  minorDenominator: 1,
  effectiveAt: "2020-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  sourceReference: "test",
}];

const SOURCES = [
  { key: "book", name: "Your Book", count: 2, alsoInBookCount: 0 },
  { key: "followers", name: "Followers", count: 2, alsoInBookCount: 1 },
];

// Three people: Ann reachable everywhere, Ben only by push, Eve (a buyer) only
// by email. Dan is selected but opted out of everything.
const EMAIL = {
  brandId: "brand",
  channel: "email" as const,
  selectedCount: 3,
  content: { kind: "email" },
  audienceId: "aud",
  audienceKind: "combined_sources" as const,
  audienceVersion: 1,
  audienceName: "Your Book + Followers",
  audienceSources: SOURCES,
  candidates: [
    {
      personKey: "ann",
      brandPersonId: "p-ann",
      contactMethodId: "m-ann",
      normalizedContact: "ann@x.test",
      allowed: true,
      safeReasonCode: "allowed",
    },
    {
      personKey: "dan",
      brandPersonId: "dan",
      buyerContactKey: "k-dan",
      contactMethodId: null,
      normalizedContact: "dan@x.test",
      allowed: false,
      safeReasonCode: "suppressed",
    },
    {
      personKey: "eve",
      brandPersonId: "eve",
      buyerContactKey: "k-eve",
      contactMethodId: null,
      normalizedContact: "eve@x.test",
      allowed: true,
      safeReasonCode: "allowed",
    },
  ],
};
const PUSH = {
  brandId: "brand",
  channel: "push" as const,
  selectedCount: 2,
  content: { kind: "push", body: "Hi" },
  audienceId: "aud",
  audienceKind: "combined_sources",
  audienceVersion: 0,
  audienceName: "Your Book + Followers",
  campaignGroupId: "lead",
  candidates: [
    {
      personKey: "ann",
      recipientUserId: "u-ann",
      reason: "follower" as const,
      allowed: true,
      safeReasonCode: "allowed",
    },
    {
      personKey: "ben",
      recipientUserId: "u-ben",
      reason: "follower" as const,
      allowed: true,
      safeReasonCode: "allowed",
    },
  ],
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    loadGroup: () =>
      Promise.resolve([
        { id: "push-row", channel: "push" as const },
        { id: "email-row", channel: "email" as const },
      ]),
    candidates: (_id: string, channel: string) =>
      Promise.resolve(channel === "push" ? PUSH : EMAIL),
    followBrand: () => Promise.resolve(null),
    allowance: (_c: unknown, quote: Record<string, unknown>) =>
      Promise.resolve({ ...quote, allowance: { emailRemaining: 997 } }),
    errorCode: (error: unknown) => String(error),
    ...overrides,
  };
}

Deno.test("#4273 each person counts once across methods; the tiles are server figures", async () => {
  const preview = await buildCampaignGroupPreview(deps(), "lead", NOW);
  // ann, dan, eve + ben (ann is on both lists).
  assertEquals(preview.group?.selectedCount, 4);
  // ann + eve + ben; dan is opted out.
  assertEquals(preview.group?.reachableCount, 3);
  assertEquals(preview.group?.skippedCount, 1);
  assertEquals(preview.group?.audienceSources, SOURCES);
  assertEquals(preview.group?.costKind, "not_metered");
  assertEquals(preview.group?.estimatedCostMinor, null);
  // Methods in display order, each with its own lockable quote and allowance.
  assertEquals(preview.methods.map((m) => m.channel), ["email", "push"]);
  assertEquals(preview.methods[0].quote?.reachableCount, 2);
  assertEquals(preview.methods[1].quote?.reachableCount, 2);
  assert(typeof preview.methods[0].quote?.quoteHash === "string");
  assertEquals(preview.methods[0].quote?.expiresAt, preview.group?.expiresAt);
});

Deno.test("#4273 no contact or person key ever leaves the group preview", async () => {
  const text = JSON.stringify(
    await buildCampaignGroupPreview(deps(), "lead", NOW),
  );
  for (
    const secret of [
      "ann@x.test",
      "dan@x.test",
      "u-ann",
      "k-eve",
      "personKey",
      "normalizedContact",
      "candidates",
    ]
  ) {
    assert(!text.includes(secret), `leaked ${secret}`);
  }
});

Deno.test("#4273 a refused method reports its own code and the rest still preview", async () => {
  const preview = await buildCampaignGroupPreview(
    deps({
      candidates: (_id: string, channel: string) =>
        channel === "push"
          ? Promise.reject(new Error("book_blast_audience_not_found"))
          : Promise.resolve(EMAIL),
      errorCode: () => "BOOK_BLAST_AUDIENCE_NOT_FOUND",
    }),
    "lead",
    NOW,
  );
  assertEquals(preview.methods[1].quote, null);
  assertEquals(preview.methods[1].error, "BOOK_BLAST_AUDIENCE_NOT_FOUND");
  assertEquals(preview.group?.selectedCount, 3);
});

Deno.test("#4273 the SMS cost in the tile is exactly what the method's quote priced", async () => {
  const sms = {
    ...EMAIL,
    channel: "sms" as const,
    content: { kind: "sms", body: "Doors at 9" },
    candidates: [
      {
        personKey: "ann",
        brandPersonId: "p-ann",
        contactMethodId: "m-ann",
        normalizedContact: "+12025550102",
        allowed: true,
        safeReasonCode: "allowed",
      },
      {
        personKey: "eve",
        brandPersonId: "eve",
        buyerContactKey: "k-eve",
        contactMethodId: null,
        normalizedContact: "+12025550103",
        allowed: true,
        safeReasonCode: "allowed",
      },
    ],
    selectedCount: 2,
  };
  const quote = await buildMarketingBookQuote(sms as never, NOW, {
    trackingOrigin: "https://x.test/m",
    smsRates: RATES,
  });
  assertEquals(quote.reachableCount, 2);
  assert(quote.estimatedCostMinor !== null && quote.estimatedCostMinor > 0);
  assertEquals(quote.unavailableCount, 0);
  const preview = await buildCampaignGroupPreview(
    deps({
      loadGroup: () =>
        Promise.resolve([{ id: "sms-row", channel: "sms" as const }]),
      candidates: () => Promise.resolve(sms),
      smsRates: RATES,
    }),
    "lead",
    NOW,
  );
  assert(preview.methods[0].quote !== null, String(preview.methods[0].error));
  assert(typeof preview.group?.estimatedCostMinor === "number");
  assertEquals(
    preview.methods[0].quote?.estimatedCostMinor,
    preview.group?.estimatedCostMinor,
  );
  assertEquals(preview.group?.costKind, "provider_estimate");
});

Deno.test("#4273 a buyer known only from orders is a delivery identity in the quote", async () => {
  const quote = await buildMarketingBookQuote(EMAIL as never, NOW);
  assertEquals(quote.selectedCount, 3);
  assertEquals(quote.reachableCount, 2);
  assertEquals(quote.suppressedCount, 1);
  assertEquals(quote.unavailableCount, 0);
  const safe = publicMarketingBookQuote(quote) as Record<string, unknown>;
  assertEquals(safe.audienceKind, "combined_sources");
  assertEquals(safe.audienceSources, SOURCES);
  assertEquals(safe.candidates, undefined);
  // Old lanes hash no new key: a quote without sources omits it entirely.
  const { audienceSources: _s, ...plain } = EMAIL;
  const old = await buildMarketingBookQuote(plain as never, NOW);
  assert(!("audienceSources" in old));
});

Deno.test("#4273 the audience brand gate covers combined audiences", async () => {
  await assertAudienceQueryMatchesCampaignBrand(
    {},
    { kind: "combined_sources", brand_id: "b1" },
    "b1",
  );
  await assertRejects(() =>
    assertAudienceQueryMatchesCampaignBrand(
      {},
      { kind: "combined_sources", brand_id: "b2" },
      "b1",
    )
  );
  await assertRejects(() =>
    assertAudienceQueryMatchesCampaignBrand(
      {},
      { kind: "combined_sources" },
      "b1",
    )
  );
});

Deno.test("#4273 send resolves a combined audience through its sealed resolver only", async () => {
  const calls: string[] = [];
  const client = {
    rpc: (name: string) => {
      calls.push(name);
      return Promise.resolve({
        data: {
          brand_id: "b1",
          rows: [],
          reach: { total: 0, reachable_email: 0, reachable_sms: 0 },
        },
        error: null,
      });
    },
  };
  const query = {
    kind: "combined_sources" as const,
    brand_id: "b1",
    sources: ["book"],
  };
  await resolveAudience(client as never, query, "campaign");
  assertEquals(calls, ["biz_marketing_combined_send_audience_v1"]);
  await assertRejects(() => resolveAudience(client as never, query));
  await assertRejects(() =>
    resolveAudience(
      client as never,
      { ...query, brand_id: "other" },
      "campaign",
    )
  );
});

Deno.test("#4273 the subject feeds the push title; no title keeps the brand name", async () => {
  const withTitle = renderBrandReachMessage("brand_campaign_push", {
    brand_name: "Harmattan",
    body: "Doors at 9",
    title: "Highlife Live",
    reason: "follower",
  });
  assertEquals(withTitle.push.title, "Highlife Live");
  const without = renderBrandReachMessage("brand_campaign_push", {
    brand_name: "Harmattan",
    body: "Doors at 9",
    reason: "follower",
  });
  assertEquals(without.push.title, "Harmattan");

  const seen: Array<Record<string, unknown>> = [];
  const db = {
    rpc: () =>
      Promise.resolve({
        data: {
          brandName: "Harmattan",
          brandSlug: "harmattan",
          eventSlug: null,
          body: "Doors at 9",
          title: "Highlife Live",
          work: [{ messageId: "m1", userId: "u1", reason: "follower" }],
        },
        error: null,
      }),
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    }),
  };
  await sendPushCampaign(db, { id: "c1", brand_id: "b1" }, (_c, input) => {
    seen.push(input.payload as Record<string, unknown>);
    return Promise.resolve({
      success: true,
      deliveries: [{ channel: "push", status: "sent" }],
    } as never);
  });
  assertEquals(seen[0].title, "Highlife Live");
});

function groupClient(rpc: (name: string) => unknown) {
  const select = () => ({
    eq: (column: string) =>
      column === "id"
        ? {
          maybeSingle: () =>
            Promise.resolve({
              data: { id: "lead", campaign_group_id: "lead" },
              error: null,
            }),
        }
        : {
          eq: () =>
            Promise.resolve({
              data: [{ id: "lead", channel: "push" }],
              error: null,
            }),
        },
  });
  return {
    from: () => ({ select }),
    rpc: (name: string) => Promise.resolve(rpc(name)),
  };
}

Deno.test("#4273 the group preview action answers with the server's figures", async () => {
  const response = await handleGroupPreview(
    groupClient((name) =>
      name === "biz_brand_blast_usage_v1"
        ? { data: { blastsThisWeek: 1 }, error: null }
        : { data: PUSH, error: null }
    ),
    "actor",
    "lead",
    NOW,
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.group.reachableCount, 2);
  assertEquals(body.methods[0].quote.allowance.blastsThisWeek, 1);
  assert(!JSON.stringify(body).includes("u-ann"));
});

Deno.test("#4273 when every method is refused, the host gets the reason", async () => {
  const response = await handleGroupPreview(
    groupClient(() => ({
      data: null,
      error: { message: "book_blast_audience_not_found" },
    })),
    "actor",
    "lead",
    NOW,
  );
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "BOOK_BLAST_AUDIENCE_NOT_FOUND");
});

// ── The skipped count must not expose a contact match ───────────────────────
Deno.test("#4273 a contact-matched difference never reaches the skipped count", () => {
  // Sealed 5, sent 4, the one missing is a contact match: nothing to report.
  assertEquals(hostVisibleSkipped(5, 4, 1), 0);
  // A real skip beside it still shows, once.
  assertEquals(hostVisibleSkipped(5, 3, 1), 1);
  assertEquals(hostVisibleSkipped(2, 2, 0), 0);
});

Deno.test("#4273 an unreadable hidden figure withholds the difference rather than reveal it", async () => {
  const failing = {
    rpc: () => Promise.resolve({ data: null, error: { message: "down" } }),
  };
  const hidden = await combinedHiddenSkips(failing, "c");
  assertEquals(hostVisibleSkipped(5, 4, hidden), 0);
  const healthy = { rpc: () => Promise.resolve({ data: 2, error: null }) };
  assertEquals(await combinedHiddenSkips(healthy, "c"), 2);
});

Deno.test("#4273 a replay answer stays within the sealed count once hidden skips are removed", () => {
  const response = existingBookSendResponse({
    executionId: "e", campaignId: "c", scheduledFor: "2026-11-05T00:00:00Z",
    sendMode: "now", campaignStatus: "sent", campaignFailed: false,
    sealedReachable: 4, delivered: 4, deferred: 0, recipientFailed: 0,
    previewSkipped: 0, queued: 0, messageRows: 4,
  });
  assertEquals(
    (response.dispatch as { skipped_after_confirm: number }).skipped_after_confirm,
    0,
  );
});

// ── A reclaimed pass cannot text twice ──────────────────────────────────────
Deno.test("#4273 an SMS row left queued by a dead run is never texted again", () => {
  const leftBehind = { status: "queued", provider_message_id: null };
  assert(isInterruptedSmsRow(leftBehind));
  assert(!isInterruptedSmsRow(null));
  assert(!isInterruptedSmsRow({ status: "deferred", provider_message_id: null }));
  // With a provider id the older guard already skips it.
  assert(!isInterruptedSmsRow({ status: "queued", provider_message_id: "SM1" }));
  assert(shouldSkipDispatchedRecipient({ status: "queued", provider_message_id: "SM1" }));
});
