import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#2714 an unusable brand identity fails closed instead of falling back to apex", () => {
  const helperStart = source.indexOf("function campaignSenderLocalPart(");
  const helperEnd = source.indexOf("\n}\n", helperStart) + 2;
  const helper = source.slice(helperStart, helperEnd);

  assert(helperStart >= 0, "campaign sender local-part owner is missing");
  assert(
    helper.includes("return slug;"),
    "empty local parts must remain empty",
  );
  assert(
    !helper.includes('"team"'),
    "a fallback mailbox would hide invalid sender truth",
  );

  const senderStart = source.indexOf(
    "const brandEmailLocal = campaignSenderLocalPart",
  );
  const senderEnd = source.indexOf("const embedded =", senderStart);
  const sender = source.slice(senderStart, senderEnd);
  assert(sender.includes("campaign_sender_local_part_empty"));
  assert(sender.includes("@campaigns.usemingla.com"));
  assertEquals(sender.includes("@usemingla.com"), false);
});
