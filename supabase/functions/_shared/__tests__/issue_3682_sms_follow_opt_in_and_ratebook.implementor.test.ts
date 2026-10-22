// #3682 — SMS Follow is opt-in and provider rate failures stay fail-closed but actionable.
// Run: deno test --allow-read supabase/functions/_shared/__tests__/issue_3682_sms_follow_opt_in_and_ratebook.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { buildMarketingBookQuote } from "../marketingBookQuote.ts";
import { type SmsRateV1, validatedSmsRates } from "../smsPriceBook.ts";
import { marketingBookQuoteErrorCode } from "../../marketing-send/index.ts";

const NOW = new Date("2026-10-22T18:00:00.000Z");

const NG_RATE: SmsRateV1 = {
  rateId: "termii-ng-test",
  provider: "termii",
  country: "NG",
  currency: "NGN",
  unit: "sms_segment",
  minorNumerator: 400,
  minorDenominator: 1,
  effectiveAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-11-01T00:00:00.000Z",
  sourceReference: "approved-test-rate-card",
};

Deno.test("#3682 SMS quote keeps author copy concise when Follow is off", async () => {
  const body =
    "CTRL V2 ticket yet? Sat 24 Oct: https://host.usemingla.com/e/ctrl/ctrl-v2";
  const quote = await buildMarketingBookQuote(
    {
      brandId: crypto.randomUUID(),
      channel: "sms",
      selectedCount: 1,
      content: { kind: "sms", body, include_follow_cta: false },
      candidates: [{
        brandPersonId: crypto.randomUUID(),
        contactMethodId: crypto.randomUUID(),
        normalizedContact: "+2348012345678",
        allowed: true,
        safeReasonCode: "allowed",
      }],
    },
    NOW,
    { smsRates: [NG_RATE], followBrand: null },
  );

  assertEquals(quote.reachableCount, 1);
  assertEquals(quote.currency, "NGN");
  assertEquals(quote.estimatedCostMinor, 400);
  assertEquals(quote.smsSegments, 1);
});

Deno.test("#3682 expired rate book is specific, safe, and still blocks", () => {
  const expired = { ...NG_RATE, expiresAt: "2026-10-22T17:59:59.999Z" };
  const thrown = assertRejects(
    async () => {
      validatedSmsRates(NOW, [expired]);
    },
    Error,
    "sms_rate_book_expired",
  );
  return thrown.then((error) => {
    assertEquals(
      marketingBookQuoteErrorCode(error),
      "BOOK_BLAST_RATE_BOOK_EXPIRED",
    );
  });
});

Deno.test("#3682 invalid or unavailable rates expose no values", () => {
  assertEquals(
    marketingBookQuoteErrorCode(new Error("sms_rate_book_invalid")),
    "BOOK_BLAST_RATE_BOOK_UNAVAILABLE",
  );
  assertEquals(
    marketingBookQuoteErrorCode(new Error("sms_rate_unavailable")),
    "BOOK_BLAST_RATE_BOOK_UNAVAILABLE",
  );
  assertEquals(
    marketingBookQuoteErrorCode(new Error("unrelated")),
    "BOOK_BLAST_COST_UNAVAILABLE",
  );
});

Deno.test("#3682 production quote and dispatch gate Follow on explicit true", () => {
  const send = Deno.readTextFileSync(
    new URL("../../marketing-send/index.ts", import.meta.url),
  );
  assertStringIncludes(
    send,
    "candidateEnvelope.content?.include_follow_cta !== true",
  );
  assertStringIncludes(
    send,
    "campaign.channel_payload.include_follow_cta === true ? brandSlugSms : null",
  );
  assert(
    !send.includes(
      "smsBlastBodyWithFollow(rawBodyBase, brandName, brandSlugSms)",
    ),
    "dispatch must not force Follow for an absent opt-in",
  );
});
