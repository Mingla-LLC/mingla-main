/**
 * issue #2291 — T-1, T-2, T-3, T-12. The two agent tools that need no human.
 *
 * `draft_campaign` and `schedule_campaign` carry NO type-to-confirm phrase
 * (only `send_campaign_now` does), and cron `orch_0815_b_marketing_send`
 * dispatches whatever is 'scheduled' every minute under the service role. So
 * these two tools together are a complete, unattended path from an Ari turn to
 * a customer inbox. Both are tested here through their real executors.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "./agentDomainTools.ts";
import { ToolError } from "./agentToolHelpers.ts";

const BRAND_ID = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const AUDIENCE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

function tool(name: string) {
  const found = DOMAIN_TOOLS.find((t) => t.name === name);
  if (found === undefined) throw new Error(`tool ${name} not registered`);
  return found;
}

interface Recorded {
  table: string;
  op: string;
  payload: unknown;
}

/**
 * Recording stand-in for the user-JWT Supabase client. `draft_campaign` looks
 * up (or creates) a system `brand_buyers` audience, then inserts the campaign;
 * `schedule_campaign` selects the stored payload, then updates status.
 */
function makeClient(opts: { storedPayload?: unknown; writes: Recorded[] }) {
  const builder = (table: string) => {
    const chain = {
      _op: "select",
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      // `draft_campaign`'s audience lookup ends on `.eq(...)` and is awaited
      // directly, so the chain must be thenable.
      then(resolve: (v: unknown) => void) {
        if (table === "marketing_audiences") {
          resolve({
            data: [{
              id: AUDIENCE_ID,
              query_definition: { kind: "brand_buyers", brand_id: BRAND_ID },
            }],
            error: null,
          });
          return;
        }
        resolve({ data: null, error: null });
      },
      maybeSingle() {
        if (table === "marketing_campaigns" && chain._op === "select") {
          return Promise.resolve({
            data: opts.storedPayload === undefined
              ? null
              : { channel_payload: opts.storedPayload },
            error: null,
          });
        }
        return Promise.resolve({
          data: { id: CAMPAIGN_ID, status: "scheduled", scheduled_for: "2026-09-01T12:00:00Z" },
          error: null,
        });
      },
      single() {
        return Promise.resolve({
          data: { id: CAMPAIGN_ID, name: "n", status: "draft", channel: "email" },
          error: null,
        });
      },
      in() {
        return chain;
      },
      insert(payload: unknown) {
        chain._op = "insert";
        opts.writes.push({ table, op: "insert", payload });
        return chain;
      },
      update(payload: unknown) {
        chain._op = "update";
        opts.writes.push({ table, op: "update", payload });
        return chain;
      },
    };
    return chain;
  };
  return { from: (table: string) => builder(table) };
}

const campaignInserts = (writes: Recorded[]) =>
  writes.filter((w) => w.table === "marketing_campaigns" && w.op === "insert");
const campaignUpdates = (writes: Recorded[]) =>
  writes.filter((w) => w.table === "marketing_campaigns" && w.op === "update");

// ---------------------------------------------------------------------------
// T-1 — the write now matches what both readers read.
// ---------------------------------------------------------------------------
Deno.test("#2291 T-1 — draft_campaign(email) writes subject + body_html, not `body`", async () => {
  const writes: Recorded[] = [];
  // deno-lint-ignore no-explicit-any
  await tool("draft_campaign").executor(
    { brand_id: BRAND_ID, title: "Autumn blast", subject: "Doors at 9", body: "<p>See you there.</p>" },
    makeClient({ writes }) as any,
    USER_ID,
  );

  assertEquals(campaignInserts(writes).length, 1);
  const payload = (campaignInserts(writes)[0].payload as {
    channel_payload: Record<string, unknown>;
  }).channel_payload;
  assertEquals(payload.kind, "email");
  assertEquals(payload.subject, "Doors at 9");
  assertEquals(payload.body_html, "<p>See you there.</p>");
  assertEquals(payload.body_text, "See you there.");
  assertEquals(payload.embedded_events, []);
  assert(
    !Object.prototype.hasOwnProperty.call(payload, "body"),
    "`body` is the SMS key — writing it on an email payload is the #2291 defect",
  );
});

Deno.test("#2291 T-1b — draft_campaign(sms) is unchanged: it still writes `body`", async () => {
  const writes: Recorded[] = [];
  // deno-lint-ignore no-explicit-any
  await tool("draft_campaign").executor(
    { brand_id: BRAND_ID, title: "SMS blast", channel: "sms", body: "Doors at 9. Reply STOP." },
    makeClient({ writes }) as any,
    USER_ID,
  );
  const payload = (campaignInserts(writes)[0].payload as {
    channel_payload: Record<string, unknown>;
  }).channel_payload;
  assertEquals(payload, { kind: "sms", body: "Doors at 9. Reply STOP." });
});

// ---------------------------------------------------------------------------
// T-3 — rcs is refused at the tool (M2): the DB allowed the discriminator but
// dispatchByKind has no arm for it.
// ---------------------------------------------------------------------------
Deno.test("#2291 T-3 — draft_campaign(rcs) is refused and writes nothing", async () => {
  const writes: Recorded[] = [];
  const err = await assertRejects(
    () =>
      // deno-lint-ignore no-explicit-any
      tool("draft_campaign").executor(
        { brand_id: BRAND_ID, title: "t", channel: "rcs", body: "x" },
        makeClient({ writes }) as any,
        USER_ID,
      ),
    ToolError,
  );
  assertEquals(err.code, "INVALID_ARGS");
  assertStringIncludes(err.message, "rcs");
  assertEquals(campaignInserts(writes).length, 0);
});

// ---------------------------------------------------------------------------
// T-2 — an empty or whitespace body/subject is refused, and NO row is written.
// ---------------------------------------------------------------------------
Deno.test("#2291 T-2 — draft_campaign(email) with no usable content writes nothing", async () => {
  for (
    const args of [
      { brand_id: BRAND_ID, title: "t", subject: "S" }, // body omitted
      { brand_id: BRAND_ID, title: "t", subject: "S", body: "   " },
      { brand_id: BRAND_ID, title: "t", body: "<p>Body</p>" }, // subject omitted
      { brand_id: BRAND_ID, title: "t", subject: " ", body: "<p>Body</p>" },
    ]
  ) {
    const writes: Recorded[] = [];
    const err = await assertRejects(
      () =>
        // deno-lint-ignore no-explicit-any
        tool("draft_campaign").executor(args, makeClient({ writes }) as any, USER_ID),
      ToolError,
    );
    assertEquals(err.code, "INVALID_ARGS");
    assertEquals(
      campaignInserts(writes).length,
      0,
      `wrote a row for ${JSON.stringify(args)}`,
    );
  }
});

Deno.test("#2291 T-2b — draft_campaign(sms) with an empty body writes nothing", async () => {
  const writes: Recorded[] = [];
  await assertRejects(
    () =>
      // deno-lint-ignore no-explicit-any
      tool("draft_campaign").executor(
        { brand_id: BRAND_ID, title: "t", channel: "sms", body: "  " },
        makeClient({ writes }) as any,
        USER_ID,
      ),
    ToolError,
  );
  assertEquals(campaignInserts(writes).length, 0);
});

// ---------------------------------------------------------------------------
// T-12 — the independently-exploitable half. These campaigns have the RIGHT
// keys with EMPTY values, so the key mismatch never enters into it.
// ---------------------------------------------------------------------------
Deno.test("#2291 T-12 — schedule_campaign refuses an empty-bodied draft and leaves it alone", async () => {
  for (
    const stored of [
      { kind: "email", subject: "S", body_html: "" },
      { kind: "email", subject: "S", body_html: "   " },
      { kind: "email" },
      { kind: "email", subject: "", body_html: "<p>Body</p>" },
      { kind: "email", subject: "S", body: "the Ari shape" },
      { kind: "sms", body: "" },
      { kind: "rcs", body: "x" },
    ]
  ) {
    const writes: Recorded[] = [];
    const err = await assertRejects(
      () =>
        // deno-lint-ignore no-explicit-any
        tool("schedule_campaign").executor(
          { campaign_id: CAMPAIGN_ID, scheduled_for: "2026-09-01T12:00:00Z" },
          makeClient({ storedPayload: stored, writes }) as any,
          USER_ID,
        ),
      ToolError,
    );
    assertEquals(err.code, "INVALID_ARGS");
    assertEquals(
      campaignUpdates(writes).length,
      0,
      `armed ${JSON.stringify(stored)} — it must stay a draft`,
    );
  }
});

Deno.test("#2291 T-12b — schedule_campaign still schedules a complete campaign", async () => {
  const writes: Recorded[] = [];
  // deno-lint-ignore no-explicit-any
  const result = await tool("schedule_campaign").executor(
    { campaign_id: CAMPAIGN_ID, scheduled_for: "2026-09-01T12:00:00Z" },
    makeClient({
      storedPayload: { kind: "email", subject: "Doors at 9", body_html: "<p>See you.</p>" },
      writes,
    }) as any,
    USER_ID,
  );
  assertEquals(campaignUpdates(writes).length, 1);
  assertEquals(
    (campaignUpdates(writes)[0].payload as { status: string }).status,
    "scheduled",
  );
  assertEquals((result as { status: string }).status, "scheduled");
});

// ---------------------------------------------------------------------------
// The confirm-phrase asymmetry that made this urgent, pinned so a future
// refactor cannot quietly widen it.
// ---------------------------------------------------------------------------
Deno.test("#2291 — draft/schedule take no confirm phrase; send_campaign_now does", () => {
  const props = (name: string) =>
    (tool(name).parameters as { properties: Record<string, unknown> }).properties;
  assert(!("confirm_phrase" in props("draft_campaign")));
  assert(!("confirm_phrase" in props("schedule_campaign")));
  assert(
    "confirm_phrase" in props("send_campaign_now"),
    "send_campaign_now must keep its type-to-confirm gate",
  );
});

Deno.test("#2291 — draft_campaign no longer advertises a channel it cannot dispatch", () => {
  const channel = (tool("draft_campaign").parameters as {
    properties: { channel: { enum: string[] } };
  }).properties.channel;
  assertEquals(channel.enum, ["email", "sms"]);
});
