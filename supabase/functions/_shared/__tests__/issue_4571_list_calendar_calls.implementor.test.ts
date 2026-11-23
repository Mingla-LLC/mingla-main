// #4571 W5: the connector's list_calendar gains the calls layer (booked demos and
// scheduled call-backs) and the work_due layer, and never an email address or a
// phone number. Run: deno test (deno 1.46).
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createTeamAgentHandler } from "../teamAgentMcp.ts";
import { checkArguments } from "../teamAgentTools.ts";
import { findWorkTool, WORK_SCREEN_FUNCTION_PARITY } from "../teamAgentWorkTools.ts";

const KEY = "mgla_c_" + "w".repeat(43);
const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const MIGRATION = "supabase/migrations/20281126054571_issue_4571_w5_calendar_week.sql";

const tool = () => {
  const t = findWorkTool("list_calendar");
  assert(t, "list_calendar is a tool");
  return t;
};
const args = (extra: Record<string, unknown>) => ({ from: "2026-11-23", to: "2026-11-29", ...extra });

Deno.test("list_calendar accepts the calls and work_due layers beside the five it had", () => {
  for (const layer of ["live", "expected", "deadlines", "promotions", "content", "calls", "work_due"]) {
    assert(checkArguments(tool(), args({ layers: [layer] })).ok, `${layer} is a layer`);
  }
  assert(
    checkArguments(tool(), args({ layers: ["live", "expected", "deadlines", "promotions", "content", "calls", "work_due"] })).ok,
    "all seven at once",
  );
});

Deno.test("list_calendar refuses a layer that is not one of the seven", () => {
  assert(!checkArguments(tool(), args({ layers: ["demos"] })).ok);
  assert(!checkArguments(tool(), args({ layers: [] })).ok);
});

Deno.test("the description names the calls and Work due layers and says no email or phone number", () => {
  const text = tool().description;
  assertMatch(text, /booked demos/);
  assertMatch(text, /scheduled call-backs/);
  assertMatch(text, /work_due layer lists open Work cards and subtasks/);
  assertMatch(text, /Neither carries an email address or a phone number/);
});

Deno.test("list_calendar reaches the two new functions, and the admin service's calls have a tool", () => {
  assertEquals([...tool().reaches], ["ops_calendar", "ops_calendar_callbacks", "ops_calendar_work_due"]);
  assertEquals(WORK_SCREEN_FUNCTION_PARITY["ops_calendar_callbacks"], { tools: ["list_calendar"] });
  assertEquals(WORK_SCREEN_FUNCTION_PARITY["ops_calendar_work_due"], { tools: ["list_calendar"] });
  const service = read("mingla-admin/src/services/opsService.js");
  assertMatch(service, /\.rpc\("ops_calendar_callbacks"/);
  assertMatch(service, /\.rpc\("ops_calendar_work_due"/);
});

// The projection list_calendar answers with, read out of the migration so a
// wider projection (a whole booking row) fails here.
function listCalendarBranch(): string {
  const sql = read(MIGRATION);
  const start = sql.indexOf("WHEN 'list_calendar' THEN");
  const end = sql.indexOf("WHEN 'runway_report' THEN", start);
  assert(start > 0 && end > start, "the list_calendar branch is in the migration");
  return sql.slice(start, end);
}

Deno.test("the gateway's calls projection names no email, phone or token column and scrubs @ from text", () => {
  const branch = listCalendarBranch();
  assertMatch(branch, /admin_calendar_calls\(/);
  assertMatch(branch, /ops_calendar_callbacks\(/);
  assertMatch(branch, /ops_calendar_work_due\(/);
  // Every key the projection sends, as written in jsonb_build_object.
  const code = branch.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert(!/phone|e164|schedule_token|'email'|->>'email'|->'email'/i.test(code.replace(/\[email hidden\]/g, "")), "no contact column is read");
  const scrubs = code.match(/regexp_replace\([^\n]*?'\\S\*@\\S\*', '\[email hidden\]', 'g'\)/g) ?? [];
  assert(scrubs.length >= 6, `names, venues, record names, call-back names and card titles are scrubbed (${scrubs.length})`);
  // The layer map carries the two new layers.
  assertMatch(read(MIGRATION), /"calls":"calls","work_due":"work_due"/);
});

Deno.test("an answer in the projected shape reaches the agent with no @ and no phone number", async () => {
  const projected = {
    today: "2026-11-23",
    calls: {
      time_zone: "Africa/Lagos",
      demos: [{
        id: "11111111-1111-4111-8111-111111111111", audience: "host", name: "Joke [email hidden] Ade", venue: "Loose Venue [email hidden]",
        call_at: "2026-11-26T10:00:00+00:00", call_at_local: "2026-11-26 11:00", status: "booked", record: null, needs_linking: true,
      }],
      callbacks: [{ record_id: "22222222-2222-4222-8222-222222222222", name: "Lagos Jazz Nights", pipeline: "hosts", due_on: "2026-11-24", stage: "replied", owners: ["Tao"] }],
    },
    work_due: [{ id: "33333333-3333-4333-8333-333333333333", number: 4571, title: "Send the launch note", status: "todo", due_on: "2026-11-25", overdue: false, owners: ["Tao"], parent: null }],
  };
  const seen: { tool: string; args: Record<string, unknown> }[] = [];
  const handler = createTeamAgentHandler({
    minRefusalMs: 0,
    gateway: async (_hash, name, sent) => {
      seen.push({ tool: name, args: sent });
      return { ok: true, result: projected, me: { role: "growth", agent: "claude", work: true } };
    },
  });
  const response = await handler(new Request("https://example.test/functions/v1/team-agent", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "mcp-protocol-version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "list_calendar", arguments: args({ layers: ["calls", "work_due"] }) } }),
  }));
  assertEquals(response.status, 200);
  assertEquals(seen.map((s) => s.tool), ["list_calendar"]);
  assertEquals(seen[0].args["layers"], ["calls", "work_due"]);
  const text = await response.text();
  assert(!text.includes("@"), "no @ in the answer");
  assert(!/\+\d{8,}/.test(text), "no phone number in the answer");
  assert(text.includes("Lagos Jazz Nights") && text.includes("Send the launch note"), "the layers arrive");
});
