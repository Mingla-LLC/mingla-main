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

Deno.test("#4522 E-7 a trip's confirmation dates are its calendar dates (UTC); events keep their zone", async () => {
  const { formatDateRange, formatMessageTime } = await import("../../_shared/messageTime.ts");
  assertStringIncludes(
    source,
    'const dateZone = isTrip ? "UTC" : context.bodyInput.event.timezone;',
  );
  assertStringIncludes(source, "formatMessageTime(startAt, dateZone)");
  assertStringIncludes(source, "? formatDateRange(startAt, endAt, dateZone)");
  // A 12–16 Mar New York trip, stored as UTC midnight (#4420).
  const start = "2099-03-12T00:00:00.000Z";
  const end = "2099-03-16T00:00:00.000Z";
  assertStringIncludes(formatMessageTime(start, "UTC")?.date ?? "", "12 Mar 2099");
  assertStringIncludes(formatDateRange(start, end, "UTC"), "12 Mar 2099 – ");
  // the zone rule the trip used to get ("Wed 11 Mar" in New York)
  assertStringIncludes(formatMessageTime(start, "America/New_York")?.date ?? "", "11 Mar 2099");
});
