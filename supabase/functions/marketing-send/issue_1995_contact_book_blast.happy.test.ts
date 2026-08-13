import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMarketingBookQuote,
  parseBookQuotedAt,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";
import { bookRpcErrorEnvelope, dispatchConfirmedBookSend } from "./index.ts";

Deno.test("#1995 quotedAt reproduces through five minutes and fails closed", async () => {
  const input = {
    brandId: crypto.randomUUID(),
    channel: "email" as const,
    selectedCount: 1,
    content: {
      kind: "email",
      subject: "Hello",
      body_html: "Hi",
      body_text: "Hi",
    },
    candidates: [{
      brandPersonId: crypto.randomUUID(),
      contactMethodId: crypto.randomUUID(),
      normalizedContact: "one@example.com",
      allowed: true,
      safeReasonCode: "allowed",
    }],
  };
  const origin = new Date("2026-08-13T12:00:00.000Z");
  const preview = await buildMarketingBookQuote(input, origin);
  const accepted = parseBookQuotedAt(
    preview.quotedAt,
    new Date("2026-08-13T12:04:59.000Z"),
  );
  assert(accepted !== null);
  assertEquals(
    (await buildMarketingBookQuote(input, accepted)).quoteHash,
    preview.quoteHash,
  );
  assertEquals(
    parseBookQuotedAt(preview.quotedAt, new Date("2026-08-13T12:05:00.001Z")),
    null,
  );
  assertEquals(parseBookQuotedAt("2026-08-13T12:00:00Z", origin), null);
  assertEquals(parseBookQuotedAt("2026-08-13T12:00:01.000Z", origin), null);
  assert(
    (await buildMarketingBookQuote({
      ...input,
      content: { ...input.content, subject: "Changed" },
    }, accepted)).quoteHash !== preview.quoteHash,
  );
});

Deno.test("#1995 email Book quote is honest and strips sealed targets", async () => {
  const quote = await buildMarketingBookQuote({
    brandId: crypto.randomUUID(),
    channel: "email",
    selectedCount: 2,
    content: {
      kind: "email",
      subject: "Hello",
      body_html: "Hi",
      body_text: "Hi",
    },
    candidates: [
      {
        brandPersonId: crypto.randomUUID(),
        contactMethodId: crypto.randomUUID(),
        normalizedContact: "one@example.com",
        allowed: true,
        safeReasonCode: "allowed",
      },
      {
        brandPersonId: crypto.randomUUID(),
        contactMethodId: null,
        normalizedContact: null,
        allowed: false,
        safeReasonCode: "channel_unavailable",
      },
    ],
  }, new Date("2026-08-13T12:00:00Z"));
  assertEquals(quote.reachableCount, 1);
  assertEquals(quote.unavailableCount, 1);
  assertEquals(quote.costKind, "not_metered");
  assertEquals(quote.estimatedCostMinor, null);
  assert(!("candidates" in publicMarketingBookQuote(quote)));
  assert(!("content" in publicMarketingBookQuote(quote)));
  assert(
    !JSON.stringify(publicMarketingBookQuote(quote)).includes(
      "one@example.com",
    ),
  );
});

Deno.test("#1995 contact value changes stale the private seal without exposing PII", async () => {
  const base = {
    brandId: crypto.randomUUID(),
    channel: "email" as const,
    selectedCount: 1,
    content: {
      kind: "email",
      subject: "Hello",
      body_html: "Hi",
      body_text: "Hi",
    },
    candidates: [{
      brandPersonId: crypto.randomUUID(),
      contactMethodId: crypto.randomUUID(),
      normalizedContact: "before@example.com",
      allowed: true,
      safeReasonCode: "allowed",
    }],
  };
  const now = new Date("2026-08-13T12:00:00.000Z");
  const before = await buildMarketingBookQuote(base, now);
  const after = await buildMarketingBookQuote({
    ...base,
    candidates: [{
      ...base.candidates[0],
      normalizedContact: "after@example.com",
    }],
  }, now);
  assert(before.quoteHash !== after.quoteHash);
  const publicJson = JSON.stringify(publicMarketingBookQuote(before));
  assert(!publicJson.includes("before@example.com"));
});

Deno.test("#1995 direct confirmation dispatches once while future schedule waits", async () => {
  const campaign = {
    id: crypto.randomUUID(),
    account_id: crypto.randomUUID(),
    brand_id: crypto.randomUUID(),
    audience_id: crypto.randomUUID(),
    channel: "email",
    channel_payload: {
      kind: "email",
      subject: "Hi",
      body_html: "Hi",
      body_text: "Hi",
    },
    name: "Hi",
    scheduled_for: new Date().toISOString(),
  };
  let claimCount = 0;
  let finalizeCount = 0;
  let dispatchCount = 0;
  const client = {
    rpc: async (name: string) => {
      if (name === "mkt_claim_campaigns") {
        claimCount += 1;
        return { data: [campaign], error: null };
      }
      if (name === "mkt_finalize_campaign") {
        finalizeCount += 1;
        return { data: null, error: null };
      }
      throw new Error(`unexpected_rpc:${name}`);
    },
  };
  const dispatcher = async () => {
    dispatchCount += 1;
    return { delivered: 1, deferred: 0, failed: 0, preview_skipped: 0 };
  };
  const direct = await dispatchConfirmedBookSend(
    client,
    campaign.id,
    null,
    { live: false, resendApiKey: "" },
    dispatcher,
  );
  assertEquals(direct?.processed, 1);
  assertEquals(claimCount, 1);
  assertEquals(dispatchCount, 1);
  assertEquals(finalizeCount, 1);
  const scheduled = await dispatchConfirmedBookSend(
    client,
    campaign.id,
    "2026-08-14T12:00:00.000Z",
    { live: false, resendApiKey: "" },
    dispatcher,
  );
  assertEquals(scheduled, null);
  assertEquals(claimCount, 1);
  assertEquals(dispatchCount, 1);
});

Deno.test("#1995 RPC failures keep their exact public status envelopes", () => {
  assertEquals(bookRpcErrorEnvelope("book_blast_audience_not_found"), {
    error: "BOOK_BLAST_AUDIENCE_NOT_FOUND",
    status: 404,
  });
  assertEquals(bookRpcErrorEnvelope("book_blast_flag_disabled"), {
    error: "BOOK_BLAST_FLAG_DISABLED",
    status: 503,
  });
  assertEquals(bookRpcErrorEnvelope("book_blast_forbidden"), {
    error: "BOOK_BLAST_FORBIDDEN",
    status: 403,
  });
});

Deno.test("#1995 MMS fails before quote", async () => {
  await assertRejects(
    () =>
      buildMarketingBookQuote({
        brandId: crypto.randomUUID(),
        channel: "sms",
        selectedCount: 0,
        content: {
          kind: "sms",
          body: "Hi",
          media_urls: ["https://example.com/x.jpg"],
        },
        candidates: [],
      }),
    Error,
    "book_blast_mms_not_supported",
  );
});
