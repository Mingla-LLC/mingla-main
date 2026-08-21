import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveAudience } from "../_shared/marketingAudience.ts";
import {
  buildMarketingBookQuote,
  publicMarketingBookQuote,
} from "../_shared/marketingBookQuote.ts";

Deno.test("#2395 Manual resolver requires campaign context", async () => {
  await assertRejects(
    () => resolveAudience({} as never, { kind: "manual_group" }),
    Error,
    "manual_group_campaign_context_required",
  );
});

Deno.test("#2395 Manual resolver consumes only the sealed campaign RPC", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve({ data: { rows: [], brand_id: "brand", reach: { total: 0, reachable_email: 0, reachable_sms: 0 } }, error: null });
    },
  };
  const result = await resolveAudience(client as never, { kind: "manual_group" }, "campaign");
  assertEquals(result.rows, []);
  assertEquals(calls, [{ name: "biz_marketing_people_send_audience_v2", args: { p_campaign_id: "campaign" } }]);
});

Deno.test("#2395 send edge exposes versioned people preview and confirm", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(source.includes('body.action === "preview_people_v2"'));
  assert(source.includes('body.action === "confirm_people_v2"'));
  assert(source.includes('"biz_confirm_marketing_people_send_v2"'));
  assert(source.includes("publicMarketingBookQuote(value)"));
});

Deno.test("#2395 public quotes preserve legacy Book shape and expose Manual identity", async () => {
  const base = {
    brandId: "22222222-2222-4222-8222-222222222222",
    channel: "email" as const,
    selectedCount: 0,
    content: {
      kind: "email",
      subject: "Hello",
      body_html: "Hi",
      body_text: "Hi",
    },
    candidates: [],
  };
  const now = new Date("2026-08-21T12:00:00.000Z");

  const legacy = publicMarketingBookQuote(
    await buildMarketingBookQuote(base, now),
  );
  assertEquals("audienceId" in legacy, false);
  assertEquals("audienceKind" in legacy, false);
  assertEquals("audienceVersion" in legacy, false);

  const manual = publicMarketingBookQuote(
    await buildMarketingBookQuote({
      ...base,
      audienceId: "11111111-1111-4111-8111-111111111111",
      audienceKind: "manual_group",
      audienceVersion: 4,
      audienceName: "VIP regulars",
    }, now),
  );
  assert(
    "audienceId" in manual && "audienceKind" in manual &&
      "audienceVersion" in manual,
  );
  assertEquals({
    audienceId: manual.audienceId,
    audienceKind: manual.audienceKind,
    audienceVersion: manual.audienceVersion,
  }, {
    audienceId: "11111111-1111-4111-8111-111111111111",
    audienceKind: "manual_group",
    audienceVersion: 4,
  });
  assertEquals("audienceName" in manual, false);
});
