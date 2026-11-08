// #4273 — a phone whose country has no SMS rate is skipped with its own
// reason, never a whole-quote failure, and never texted. The quote, the SMS
// cost, the segment count, the group figures, the invite quote and the send
// all skip exactly the same numbers (smsRateForPhone is the one rule). An
// expired, missing, invalid or not-yet-effective rate BOOK still fails closed.
// The database half (the seal) is the pg17 suite of the same name.
// MINGLA-INVARIANT: I-4273-UNPRICED-ONE-RULE | issue #4273 | Whether a phone can be priced is decided only by smsRateForPhone; the Blast quote, the invite quote and the SMS send guard all read it, and an unpriced phone is skipped, never texted and never a quote failure.
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.224.0/testing/time.ts";
import {
  allocateSmsCosts,
  configuredSmsRoutes,
  SMS_UNPRICED_COUNTRY,
  smsRateForPhone,
  type SmsRateV1,
  validatedSmsRates,
} from "../_shared/smsPriceBook.ts";
import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";
import {
  buildOfferingExecutionSnapshot,
  offeringUnpricedSmsCount,
  type QuoteCandidateRow,
} from "../_shared/offeringInviteQuote.ts";
import { buildCampaignGroupPreview } from "./campaignGroupPreview.ts";
import {
  marketingBookQuoteErrorCode,
  processClaimedCampaigns,
} from "./index.ts";
import {
  composeSmsBody,
  computeSegments,
  smsAdapter,
} from "../_shared/adapters/smsAdapter.ts";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const US = "+12025550142";
const NG = "+2348031104273";
const BE = "+32470123456";
const rate = (
  rateId: string,
  provider: "twilio" | "termii",
  country: string,
  currency: string,
  minor: number,
): SmsRateV1 => ({
  rateId,
  provider,
  country,
  currency,
  unit: "sms_segment",
  minorNumerator: minor,
  minorDenominator: 1,
  effectiveAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  sourceReference: `${rateId}-card`,
});
// The production book prices only these two routes (2026-11-08).
const RATES = [
  rate("twilio-us", "twilio", "US", "USD", 79),
  rate("termii-ng", "termii", "NG", "NGN", 265),
];

const candidate = (key: string, phone: string | null, allowed = true) => ({
  personKey: key,
  brandPersonId: `p-${key}`,
  contactMethodId: `m-${key}`,
  normalizedContact: phone,
  allowed,
  safeReasonCode: allowed ? "allowed" : "suppressed",
});
const smsEnvelope = (candidates: ReturnType<typeof candidate>[]) => ({
  brandId: "brand",
  channel: "sms" as const,
  selectedCount: candidates.length,
  content: { kind: "sms", body: "Doors at 9" },
  audienceId: "aud",
  audienceKind: "combined_sources" as const,
  audienceVersion: 1,
  audienceName: "Your Book",
  candidates,
});

// ── The one rule ────────────────────────────────────────────────────────────
Deno.test("#4273 U-1 smsRateForPhone: NG→termii, else twilio; no rate or no country is null", () => {
  assertEquals(smsRateForPhone(US, RATES)?.rateId, "twilio-us");
  assertEquals(smsRateForPhone(NG, RATES)?.rateId, "termii-ng");
  assertEquals(smsRateForPhone(BE, RATES), null);
  assertEquals(smsRateForPhone("+999123", RATES), null);
  assertEquals(smsRateForPhone(null, RATES), null);
  assertEquals(SMS_UNPRICED_COUNTRY, "sms_unpriced_country");
});

Deno.test("#4273 U-2 allocateSmsCosts skips an unpriced phone instead of throwing", () => {
  const priced = allocateSmsCosts(
    [
      { key: "a", normalizedPhone: US, segments: 2, target: "us" },
      { key: "b", normalizedPhone: BE, segments: 2, target: "be" },
      { key: "c", normalizedPhone: "+9991234567", segments: 2, target: "none" },
    ],
    NOW,
    RATES,
    () => true,
  );
  assertEquals(priced.allocations.map((a) => a.target), ["us"]);
  assertEquals(priced.unpriced.map((u) => u.target), ["be", "none"]);
  assertEquals(priced.estimatedCostMinor, 158);
  assertEquals(priced.currency, "USD");
});

Deno.test("#4273 U-3 an expired, missing, invalid or not-yet-effective BOOK still fails closed", () => {
  const expired = [{ ...RATES[0], expiresAt: "2026-01-02T00:00:00.000Z" }];
  assertThrows(
    () => validatedSmsRates(NOW, expired),
    Error,
    "sms_rate_book_expired",
  );
  const future = [{ ...RATES[0], effectiveAt: "2099-01-01T00:00:00.000Z" }];
  assertThrows(
    () => validatedSmsRates(NOW, future),
    Error,
    "sms_rate_book_not_effective",
  );
  assertThrows(
    () => validatedSmsRates(NOW, [{ nope: 1 }]),
    Error,
    "sms_rate_book_invalid",
  );
  assertEquals(
    marketingBookQuoteErrorCode(
      new Error("cost_unavailable:sms_rate_book_expired"),
    ),
    "BOOK_BLAST_RATE_BOOK_EXPIRED",
  );
  assertEquals(
    marketingBookQuoteErrorCode(
      new Error("cost_unavailable:sms_rate_book_missing"),
    ),
    "BOOK_BLAST_RATE_BOOK_UNAVAILABLE",
  );
});

// ── The Blast quote ─────────────────────────────────────────────────────────
Deno.test("#4273 U-4 one Belgian number no longer fails the quote: it is skipped and counted", async () => {
  const quote = await buildMarketingBookQuote(
    smsEnvelope([
      candidate("us", US),
      candidate("be", BE),
      candidate("off", NG, false),
    ]),
    NOW,
    { smsCountryLive: () => true, smsRates: RATES, trackingOrigin: "https://usemingla.com/m" },
  );
  assertEquals(quote.reachableCount, 1);
  assertEquals(quote.unpricedCount, 1);
  // The sealed execution needs selected = reachable + suppressed + unavailable:
  // the unpriced phone is one of the suppressed, alongside the opted-out one.
  assertEquals(quote.suppressedCount, 2);
  assertEquals(
    quote.selectedCount,
    quote.reachableCount + quote.suppressedCount + quote.unavailableCount,
  );
  const us = quote.candidates.find((c) => c.personKey === "us")!;
  const be = quote.candidates.find((c) => c.personKey === "be")!;
  // Quote = send: the unpriced phone has no segments and no cost, so the
  // seal writes it as suppressed / sms_unpriced_country.
  assertEquals(be.segments, 0);
  assertEquals(be.allocatedCostMinor, null);
  assertEquals(be.smsUnpriced, true);
  assertEquals(
    be.allowed,
    true,
    "the Book's verdict is kept: the confirm compares it",
  );
  assertEquals(be.safeReasonCode, "allowed");
  assert(us.segments >= 1);
  assertEquals(quote.smsSegments, us.segments);
  assertEquals(quote.estimatedCostMinor, us.segments * 79);
  assertEquals(quote.currency, "USD");
  assertEquals(quote.rateIds, ["twilio-us"]);
  assertEquals(publicMarketingBookQuote(quote).unpricedCount, 1);
});

Deno.test("#4273 U-5 every SMS recipient unpriced: reach 0 with that reason, not an error", async () => {
  const quote = await buildMarketingBookQuote(
    smsEnvelope([candidate("be", BE), candidate("be2", "+32470999888")]),
    NOW,
    { smsCountryLive: () => true, smsRates: RATES, trackingOrigin: "https://usemingla.com/m" },
  );
  assertEquals(quote.reachableCount, 0);
  assertEquals(quote.unpricedCount, 2);
  assertEquals(quote.suppressedCount, 2);
  assertEquals(quote.smsSegments, 0);
  assertEquals(quote.estimatedCostMinor, 0);
  assertEquals(quote.costBreakdown, []);
});

Deno.test("#4273 U-6 group figures skip a person reachable only by an unpriced text", async () => {
  const email = {
    ...smsEnvelope([
      { ...candidate("us", "us@example.test") },
      {
        ...candidate("be", null),
        allowed: false,
        safeReasonCode: "channel_unavailable",
      },
    ]),
    channel: "email" as const,
    content: { kind: "email" },
  };
  const sms = smsEnvelope([candidate("us", US), candidate("be", BE)]);
  const preview = await buildCampaignGroupPreview(
    {
      loadGroup: () =>
        Promise.resolve({
          rows: [{ id: "e", channel: "email" }, { id: "s", channel: "sms" }],
          unlisted: [],
        }),
      candidates: (id) => Promise.resolve(id === "e" ? email : sms),
      quoteBrand: () =>
        Promise.resolve({ followBrand: null, costCurrency: "USD" }),
      allowance: (_c, quote) => Promise.resolve(quote),
      errorCode: (error) => String(error),
      smsCountryLive: () => true, smsRates: RATES,
    },
    "e",
    NOW,
  );
  assertEquals(preview.methods.map((m) => m.error), [null, null]);
  assertEquals(preview.group?.selectedCount, 2);
  assertEquals(preview.group?.reachableCount, 1);
  assertEquals(preview.group?.skippedCount, 1);
  assertEquals(preview.group?.unpricedSmsCount, 1);
});

// ── The invite quote ────────────────────────────────────────────────────────
Deno.test("#4273 U-7 the invite snapshot seals an unpriced text as suppressed and counts it", async () => {
  const brand = "42730000-0000-4000-8000-0000000000b1";
  const event = "42730000-0000-4000-8000-0000000000e1";
  const row = (n: string, phone: string): QuoteCandidateRow => ({
    brandPersonId: `42730000-0000-4000-8000-00000000010${n}`,
    inviteId: null,
    predecessorAttemptId: null,
    channel: "sms",
    contactMethodId: `42730000-0000-4000-8000-00000000020${n}`,
    recipientUserId: null,
    normalizedContact: phone,
    allowed: true,
    safeReasonCode: null,
    lastContactAt: null,
    eventUrl: "https://host.usemingla.com/e/brand/night",
  });
  const rows = [row("1", US), row("2", BE)];
  const book = JSON.stringify({
    schema_version: 1,
    bunny_storage_cap_bytes: 1000,
    bunny_traffic_cap_bytes: 2000,
    event_cover_video_provider: "bunny",
    google_ads_api_version: "v24",
    meta_api_version: "v25.0",
    mingla_footer_address: "Mingla legal address",
    mingla_logo_url: "https://usemingla.com/brand/email/logo.png",
    termii_base_url: "https://v3.api.termii.com",
    offering_invite_sms_price_book_v1: RATES,
  });
  const previous = Deno.env.get("MINGLA_RUNTIME_CONFIG_JSON");
  Deno.env.set("MINGLA_RUNTIME_CONFIG_JSON", book);
  try {
    const snapshot = await buildOfferingExecutionSnapshot({
      eventId: event,
      brandId: brand,
      purpose: "invitation",
      channels: ["sms"],
      selectionHash: "a".repeat(64),
      candidates: rows,
      content: {},
      now: NOW,
      smsRates: RATES,
      smsCountryLive: () => true,
    });
    const be = snapshot.candidates.find((c) =>
      c.contactMethodId === rows[1].contactMethodId
    )!;
    const us = snapshot.candidates.find((c) =>
      c.contactMethodId === rows[0].contactMethodId
    )!;
    assertEquals(be.outcome, "suppressed");
    assertEquals(
      be.safeReasonCode,
      "suppressed",
      "the reason the seal already accepts",
    );
    assertEquals(be.smsQuote, null);
    assertEquals(us.outcome, "queued");
    assertEquals(snapshot.quote.rateIds, ["twilio-us"]);
    assertEquals(snapshot.quote.smsSegments, us.smsQuote!.segments);
    assertEquals(offeringUnpricedSmsCount(snapshot, rows), 1);
  } finally {
    if (previous === undefined) Deno.env.delete("MINGLA_RUNTIME_CONFIG_JSON");
    else Deno.env.set("MINGLA_RUNTIME_CONFIG_JSON", previous);
  }
});

// ── The send ────────────────────────────────────────────────────────────────
Deno.test("#4273 U-8 configuredSmsRoutes reads the book without dates; no book is null", () => {
  assertEquals(configuredSmsRoutes(null), null);
  assertEquals(
    configuredSmsRoutes([
      { ...RATES[0], expiresAt: "2000-01-01T00:00:00.000Z" },
      { bad: 1 },
    ]),
    [{ country: "US", provider: "twilio" }],
  );
});

function sendFake(
  writes: Array<{ table: string; op: string; payload: unknown }>,
  sealed = true,
) {
  const brandId = "42730000-0000-4000-8000-0000000000b1";
  const row = (key: string, phone: string) => ({
    contact_key: key,
    display_name: "Guest",
    first_name: "Guest",
    raw_email: null,
    raw_phone: phone,
    order_count: 1,
    total_spend_minor: 0,
    total_spend_currency: "USD",
    last_event_id: null,
    last_event_name: null,
    last_purchase_at: null,
    email_marketing_ok: false,
    sms_marketing_ok: true,
  });
  const builder = (table: string) => {
    let op = "select";
    let payload: unknown = null;
    const filters: Array<[string, unknown]> = [];
    const result = () => {
      if (op === "upsert" && table === "marketing_messages") {
        return { data: { id: `msg-${writes.length}` }, error: null };
      }
      if (op !== "select") return { data: null, error: null };
      if (table === "marketing_audiences") {
        return {
          data: {
            id: "aud",
            brand_id: brandId,
            query_definition: { kind: "all_brand_people", brand_id: brandId },
          },
          error: null,
        };
      }
      if (table === "brands") {
        return filters.some(([m]) => m === "in")
          ? { data: [{ id: brandId, slug: "lantern-room" }], error: null }
          : {
            data: { id: brandId, name: "Lantern Room", slug: "lantern-room" },
            error: null,
          };
      }
      if (table === "marketing_messages") return { data: null, error: null };
      if (table === "marketing_book_send_executions") {
        return { data: sealed ? { id: "exec" } : null, error: null };
      }
      return { data: [], error: null };
    };
    const chain: Record<string, unknown> = {};
    for (
      const method of ["eq", "in", "is", "neq", "or", "order", "range", "limit"]
    ) {
      chain[method] = (column: string, value: unknown) => {
        filters.push([method, value]);
        void column;
        return chain;
      };
    }
    const write = (kind: string) => (p?: unknown) => {
      op = kind;
      payload = p ?? null;
      writes.push({ table, op, payload });
      return chain;
    };
    chain.select = () => chain;
    chain.insert = write("insert");
    chain.update = write("update");
    chain.upsert = write("upsert");
    chain.delete = write("delete");
    chain.maybeSingle = () => Promise.resolve(result());
    chain.single = () => Promise.resolve(result());
    chain.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  };
  return {
    from: builder,
    rpc: (name: string) =>
      Promise.resolve(
        name === "biz_marketing_book_send_audience"
          ? {
            data: {
              brand_id: brandId,
              reach: { total: 2, reachable_email: 0, reachable_sms: 2 },
              rows: [row("us", US), row("be", BE)],
            },
            error: null,
          }
          : { data: null, error: null },
      ),
  };
}

Deno.test("#4273 U-9 the send never attempts an unpriced number", async () => {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const sentTo: string[] = [];
  const realSend = smsAdapter.send;
  // 12:00 in Washington: inside the US marketing window.
  const time = new FakeTime(new Date("2026-11-09T17:00:00Z"));
  smsAdapter.send = (input) => {
    sentTo.push(input.to);
    return Promise.resolve({
      ok: true,
      status: "sent",
      providerMessageId: "SM-test",
      provider: "twilio",
      segments: computeSegments(composeSmsBody(input.message, true)),
      // deno-lint-ignore no-explicit-any
    } as any);
  };
  let summary;
  try {
    summary = await processClaimedCampaigns(
      // deno-lint-ignore no-explicit-any
      sendFake(writes) as any,
      [{
        id: "42730000-0000-4000-8000-0000000000c1",
        account_id: "42730000-0000-4000-8000-0000000000d1",
        brand_id: "42730000-0000-4000-8000-0000000000b1",
        audience_id: "aud",
        channel: "sms",
        // deno-lint-ignore no-explicit-any
        channel_payload: { kind: "sms", body: "Doors at 9." } as any,
        name: "Unpriced",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      {
        live: true,
        resendApiKey: "re_test_key",
        smsRoutes: [{ country: "US", provider: "twilio" }, {
          country: "NG",
          provider: "termii",
        }],
      },
    );
  } finally {
    smsAdapter.send = realSend;
    time.restore();
  }
  assertEquals(summary.failed, 0, JSON.stringify(summary.errors));
  assertEquals(sentTo, [US], "only the priced number reaches the provider");
  assertEquals(summary.delivered, 1);
  assertEquals(
    summary.recipient_failed,
    0,
    "the unpriced number is not a provider failure",
  );
  const touched = writes.filter((w) =>
    w.table === "marketing_messages" &&
    JSON.stringify(w.payload).includes(BE)
  );
  assertEquals(
    touched,
    [],
    "no message row is ever written for the unpriced number",
  );
});

async function runSend(
  options: { smsRoutes?: Array<{ country: string; provider: "twilio" | "termii" }> | null },
  sealed: boolean,
) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const sentTo: string[] = [];
  const realSend = smsAdapter.send;
  const time = new FakeTime(new Date("2026-11-09T17:00:00Z"));
  smsAdapter.send = (input) => {
    sentTo.push(input.to);
    return Promise.resolve({
      ok: true,
      status: "sent",
      providerMessageId: "SM-test",
      provider: "twilio",
      segments: 1,
      // deno-lint-ignore no-explicit-any
    } as any);
  };
  try {
    const summary = await processClaimedCampaigns(
      // deno-lint-ignore no-explicit-any
      sendFake(writes, sealed) as any,
      [{
        id: "42730000-0000-4000-8000-0000000000c1",
        account_id: "42730000-0000-4000-8000-0000000000d1",
        brand_id: "42730000-0000-4000-8000-0000000000b1",
        audience_id: "aud",
        channel: "sms",
        // deno-lint-ignore no-explicit-any
        channel_payload: { kind: "sms", body: "Doors at 9." } as any,
        name: "Legacy",
        scheduled_for: null,
        // deno-lint-ignore no-explicit-any
      }] as any,
      // deno-lint-ignore no-explicit-any
      { live: true, resendApiKey: "re_test_key", ...options } as any,
    );
    return { summary, writes, sentTo };
  } finally {
    smsAdapter.send = realSend;
    time.restore();
  }
}

const failedRows = (writes: Array<{ table: string; op: string; payload: unknown }>) =>
  writes.filter((w) =>
    w.table === "marketing_messages" &&
    (w.payload as { status?: string } | null)?.status === "failed"
  ).map((w) => (w.payload as { failure_reason: string }).failure_reason);

Deno.test("#4273 U-10 (tester P3) a legacy buyer-list send records the unpriced number so the host sees it", async () => {
  const { sentTo, writes, summary } = await runSend(
    { smsRoutes: [{ country: "US", provider: "twilio" }] },
    false,
  );
  assertEquals(sentTo, [US]);
  assertEquals(failedRows(writes), [SMS_UNPRICED_COUNTRY]);
  assertEquals(summary.recipient_failed, 1, "counted as not reached");
});

Deno.test("#4273 U-11 (tester P3) no readable prices: nothing is texted, and a legacy send says why", async () => {
  const legacy = await runSend({ smsRoutes: null }, false);
  assertEquals(legacy.sentTo, [], "fail safe: never text a number Mingla can't price");
  assertEquals(failedRows(legacy.writes), ["sms_rate_book_unavailable", "sms_rate_book_unavailable"]);
  const sealed = await runSend({ smsRoutes: null }, true);
  assertEquals(sealed.sentTo, []);
  assertEquals(failedRows(sealed.writes), [], "a sealed Blast adds no rows: its unsent people already read as couldn't be reached");
});
