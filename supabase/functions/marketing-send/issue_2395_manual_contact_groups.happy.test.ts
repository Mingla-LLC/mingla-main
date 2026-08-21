import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveAudience } from "../_shared/marketingAudience.ts";

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
  assert(source.includes("audienceVersion"));
});
