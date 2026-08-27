import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#2714 campaign mail uses the tracking-enabled sender domain", () => {
  assert(source.includes("@campaigns.usemingla.com"));
  assert(!source.includes("`${fromDisplay} <${fromLocal}@usemingla.com>`"));
  assert(source.includes("reply_to: input.replyTo ?? FALLBACK_REPLY_TO"));
});

Deno.test("#2714 eligibility is committed atomically with the provider id", () => {
  for (
    const contract of [
      "provider_message_id: providerMessageId",
      "delivery_tracking_eligible_at: eligibleAt",
      "open_tracking_eligible_at: eligibleAt",
      'tracking_sender_domain: "campaigns.usemingla.com"',
    ]
  ) assert(source.includes(contract), `missing ${contract}`);

  assertEquals(
    source.match(/delivery_tracking_eligible_at/g)?.length ?? 0,
    4,
    "write, select, and readback guard must all name delivery eligibility",
  );
  assert(source.includes("row.open_tracking_eligible_at !== null"));
});
