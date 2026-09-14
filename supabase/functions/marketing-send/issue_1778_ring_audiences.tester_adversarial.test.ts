import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";

const candidate = {
  brandPersonId: "17780000-3000-4000-8000-000000000001",
  recipientUserId: "17780000-2000-4000-8000-000000000010",
  ring: "extended" as const,
  snapshotVersion: 44,
  contactMethodId: null,
  normalizedContact: "+12025550178",
  allowed: false,
  safeReasonCode: "can_send_denied",
};

Deno.test("#1778 denied Circle member is suppressed, never reachable", async () => {
  const quote = await buildMarketingBookQuote({
    brandId: "17780000-0000-4000-8000-000000000010",
    channel: "email",
    selectedCount: 1,
    content: {
      kind: "email",
      subject: "Private",
      body_html: "Private",
      body_text: "Private",
    },
    audienceId: "17780000-1000-4000-8000-000000000010",
    audienceKind: "brand_circle_extended",
    audienceVersion: 44,
    candidates: [candidate],
  }, new Date("2026-08-30T12:00:00.000Z"));
  assertEquals(quote.reachableCount, 0);
  assertEquals(quote.suppressedCount, 1);
  assertEquals(quote.unavailableCount, 0);
  const publicJson = JSON.stringify(publicMarketingBookQuote(quote));
  assert(!publicJson.includes(candidate.recipientUserId));
  assert(!publicJson.includes(candidate.normalizedContact));
  assert(!publicJson.includes("can_send_denied"));
});

Deno.test("#1778 membership snapshot changes invalidate the seal", async () => {
  const base = {
    brandId: "17780000-0000-4000-8000-000000000010",
    channel: "email" as const,
    selectedCount: 1,
    content: {
      kind: "email",
      subject: "Circle update",
      body_html: "Hello",
      body_text: "Hello",
    },
    audienceId: "17780000-1000-4000-8000-000000000010",
    audienceKind: "brand_circle_extended" as const,
    audienceVersion: 44,
    candidates: [{ ...candidate, allowed: true, safeReasonCode: "allowed" }],
  };
  const now = new Date("2026-08-30T12:00:00.000Z");
  const original = await buildMarketingBookQuote(base, now);
  const advanced = await buildMarketingBookQuote({
    ...base,
    audienceVersion: 45,
    candidates: base.candidates.map((row) => ({
      ...row,
      snapshotVersion: 45,
    })),
  }, now);
  assert(original.quoteHash !== advanced.quoteHash);
});
