import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("#4063 confirmation dispatch uses one purchase message for events, trips and experiences", () => {
  assertStringIncludes(source, "buildOrderConfirmationMessage({");
  assertStringIncludes(source, 'variant: "purchase_message"');
  assertStringIncludes(source, "const messageKind = isTrip");
  assertStringIncludes(source, '? "experience" as const');
  assert(!source.includes("renderTripConfirmationEmail({"));
  assert(!source.includes("renderExperienceConfirmationEmail({"));
  assert(!source.includes("attachTicketFollowBlock("));
});

Deno.test("#4063 short links suppress legacy claim minting and power SMS", () => {
  assertStringIncludes(
    source,
    "hasShortClaimLink = confirmation.claim.shortUrl !== null",
  );
  assertStringIncludes(source, "!hasShortClaimLink &&");
  assertStringIncludes(source, "smsBody = initialMessage.sms");
  assertStringIncludes(
    source,
    "confirmation.claim.shortUrl ?? BUYER_DOWNLOAD_URL",
  );
});

Deno.test("#4063 every Resend path accepts and supplies a validated reply-to", () => {
  assertStringIncludes(source, "reply_to: input.replyTo.trim()");
  const sends = source.match(/sendResendEmailWithAttachment\(\{/g) ?? [];
  const replyTos = source.match(/replyTo: eventUpdateReplyTo\(/g) ?? [];
  assertEquals(replyTos.length, sends.length);
  assert(sends.length >= 7);
});
