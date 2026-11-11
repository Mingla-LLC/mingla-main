// Issue #4383 — a scheduled email can change its time or its words until the
// sender starts it (T19). The writes are conditional (status 'scheduled' and
// no processing_started_at), so a started campaign is refused with
// campaign_not_reschedulable and nothing changes. A past time is refused by
// the server too; the edited words pass the same checks as a new campaign.
import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://issue4383.supabase.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key-4383");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-4383");
Deno.env.set("RESEND_API_KEY", "");

const { getScheduledCampaign, rescheduleCampaign, rescheduleInput, updateScheduledCampaign } = await import("./index.ts");

const ID = "43830000-0000-4000-8000-0000000000e1";
const NOW = Date.parse("2026-11-10T12:00:00Z");

type Row = Record<string, unknown>;

// A fake service client: one admin_email_log row, and the query chain the
// functions use. An update applies only when every .eq/.is filter matches.
function fakeClient(row: Row) {
  const calls: Array<{ op: string; patch?: Row; filters: Array<[string, string, unknown]> }> = [];
  const client = {
    from(table: string) {
      if (table !== "admin_email_log") throw new Error(`unexpected table ${table}`);
      const filters: Array<[string, string, unknown]> = [];
      let op = "select";
      let patch: Row | undefined;
      const matches = () => filters.every(([kind, col, value]) => kind === "eq" ? row[col] === value : row[col] === value);
      const chain = {
        update(p: Row) { op = "update"; patch = p; return chain; },
        select() { return chain; },
        eq(col: string, value: unknown) { filters.push(["eq", col, value]); return chain; },
        is(col: string, value: unknown) { filters.push(["is", col, value]); return chain; },
        maybeSingle() {
          calls.push({ op, patch, filters: [...filters] });
          if (!matches()) return Promise.resolve({ data: null, error: null });
          if (op === "update" && patch) Object.assign(row, patch);
          return Promise.resolve({ data: { ...row }, error: null });
        },
      };
      return chain;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  };
  return { client: client as never, calls, row };
}

const scheduled = (extra: Row = {}): Row => ({
  id: ID, status: "scheduled", subject: "Your December checklist", body: "Old body",
  body_document: { version: 1, blocks: [{ type: "rich_text", html: "<p>Old body</p>" }] },
  scheduled_for: "2026-11-12T08:00:00.000Z", timezone: "Africa/Lagos", processing_started_at: null, ...extra,
});

Deno.test("T19 a scheduled email moves to a new time in a new zone", async () => {
  const fake = fakeClient(scheduled());
  const result = await rescheduleCampaign(fake.client, { campaignId: ID, scheduledFor: "2026-11-13T14:00:00.000Z", timezone: "America/New_York" }, NOW);
  assertEquals(result.scheduled_for, "2026-11-13T14:00:00.000Z");
  assertEquals(result.timezone, "America/New_York");
  // The write was guarded: still scheduled and not started.
  assertEquals(fake.calls[0].filters, [["eq", "id", ID], ["eq", "status", "scheduled"], ["is", "processing_started_at", null]]);
});

Deno.test("T19 a campaign the sender started is not changed", async () => {
  const fake = fakeClient(scheduled({ processing_started_at: "2026-11-10T11:59:00Z" }));
  await assertRejects(
    () => rescheduleCampaign(fake.client, { campaignId: ID, scheduledFor: "2026-11-13T14:00:00.000Z", timezone: "UTC" }, NOW),
    Error, "campaign_not_reschedulable",
  );
  assertEquals(fake.row.scheduled_for, "2026-11-12T08:00:00.000Z");
  const sent = fakeClient(scheduled({ status: "sending" }));
  await assertRejects(
    () => updateScheduledCampaign(sent.client, { campaignId: ID, subject: "New", document: [{ type: "rich_text", html: "<p>New</p>" }] }),
    Error, "campaign_not_reschedulable",
  );
  assertEquals(sent.row.subject, "Your December checklist");
  await assertRejects(() => getScheduledCampaign(sent.client, { campaignId: ID }), Error, "campaign_not_reschedulable");
});

Deno.test("T19 the server refuses a past or too-soon time and a bad zone", () => {
  for (const [input, code] of [
    [{ scheduledFor: "2026-11-10T11:59:00Z", timezone: "UTC" }, "scheduled_time_past"],
    [{ scheduledFor: "2026-11-10T12:00:30Z", timezone: "UTC" }, "scheduled_time_past"],
    [{ scheduledFor: "not a time", timezone: "UTC" }, "scheduled_time_invalid"],
    [{ scheduledFor: "2026-11-13T09:00:00Z", timezone: "Mars/Olympus" }, "scheduled_timezone_invalid"],
    [{ scheduledFor: "2026-11-13T09:00:00Z", timezone: "" }, "scheduled_timezone_invalid"],
  ] as Array<[Row, string]>) {
    let message = "";
    try { rescheduleInput(input, NOW); } catch (error) { message = (error as Error).message; }
    assertEquals(message, code, JSON.stringify(input));
  }
});

Deno.test("T19 edited words pass the same checks as a new campaign", async () => {
  const fake = fakeClient(scheduled());
  const result = await updateScheduledCampaign(fake.client, { campaignId: ID, subject: " New subject ", document: [{ type: "rich_text", html: "<p>New words</p>" }] });
  assertEquals(result.subject, "New subject");
  assertEquals(fake.row.body, "New words");
  assertEquals((fake.row.body_document as { version: number }).version, 1);
  await assertRejects(() => updateScheduledCampaign(fakeClient(scheduled()).client, { campaignId: ID, subject: "Two\nlines", document: [{ type: "rich_text", html: "<p>x</p>" }] }), Error, "email_subject_invalid");
  await assertRejects(() => updateScheduledCampaign(fakeClient(scheduled()).client, { campaignId: ID, subject: "Hi", document: [{ type: "rich_text", html: "<p> </p>" }] }), Error, "email_document_empty");
  await assertRejects(() => updateScheduledCampaign(fakeClient(scheduled()).client, { campaignId: "nope", subject: "Hi", document: [] }), Error, "campaign_id_invalid");
});

Deno.test("T19 the composer's edit mode reads a scheduled email's words", async () => {
  const result = await getScheduledCampaign(fakeClient(scheduled()).client, { campaignId: ID });
  assertEquals(result.subject, "Your December checklist");
  assertEquals(result.document.length, 1);
  assertEquals(result.timezone, "Africa/Lagos");
});
