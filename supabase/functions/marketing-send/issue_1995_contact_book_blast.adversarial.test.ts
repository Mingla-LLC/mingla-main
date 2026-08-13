import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";

Deno.test("#1995 public Book preview is an aggregate-only allowlist", async () => {
  const quote = await buildMarketingBookQuote({
    brandId: crypto.randomUUID(),
    channel: "email",
    selectedCount: 1,
    content: {
      kind: "email",
      subject: "Private launch subject",
      body_html: "Private launch body",
      body_text: "Private launch body",
    },
    candidates: [{
      brandPersonId: crypto.randomUUID(),
      contactMethodId: crypto.randomUUID(),
      normalizedContact: "private-recipient@example.com",
      allowed: true,
      safeReasonCode: "allowed",
    }],
  }, new Date("2026-08-13T12:00:00.000Z"));

  const publicQuote = publicMarketingBookQuote(quote);
  assertEquals(Object.keys(publicQuote).sort(), [
    "costKind",
    "currency",
    "estimatedCostMinor",
    "expiresAt",
    "quoteHash",
    "quoteVersion",
    "quotedAt",
    "reachableCount",
    "selectedCount",
    "smsSegments",
    "suppressedCount",
    "unavailableCount",
  ]);
  assertEquals(
    JSON.stringify(publicQuote).includes("private-recipient@example.com"),
    false,
  );
  assertEquals(
    JSON.stringify(publicQuote).includes("Private launch body"),
    false,
  );
});
