// Issue #3980 Wave 2 — the calendar tools answer through the ops gateway, and
// an agent says why when a card stops needing a person.
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkArguments } from "../teamAgentTools.ts";
import {
  findWorkTool,
  WORK_SCREEN_FUNCTION_PARITY,
} from "../teamAgentWorkTools.ts";

const ROOT = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, ROOT));
const WAVE2 =
  "supabase/migrations/20271117003980_issue_3980_wave2_calendar_host_sync.sql";

function newestGateway(): string {
  const sql = read(WAVE2);
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.ops_agent_call(");
  assert(at > 0, "Wave 2 replaces the gateway");
  return sql.slice(at, sql.indexOf("$$;", sql.indexOf("AS $$", at)));
}

Deno.test("#3980 W2 the three calendar tools reach their functions; only plan_work still waits", () => {
  const gateway = newestGateway();
  assertMatch(gateway, /WHEN 'list_calendar' THEN[\s\S]*public\.ops_calendar\(/);
  assertMatch(gateway, /WHEN 'runway_report' THEN[\s\S]*public\.ops_runway_report\(/);
  assertMatch(
    gateway,
    /WHEN 'set_expected_event' THEN[\s\S]*public\.ops_expected_event_set\(/,
  );
  for (const tool of ["list_calendar", "runway_report", "set_expected_event"]) {
    assert(
      !new RegExp(`WHEN '${tool}' THEN RAISE`).test(gateway),
      `${tool} still answers not ready`,
    );
  }
  assertMatch(gateway, /WHEN 'plan_work' THEN RAISE EXCEPTION 'not_ready:/);
  for (
    const fn of [
      "ops_calendar",
      "ops_runway_report",
      "ops_expected_event_set",
      "ops_anchor_detail",
      "ops_host_on_mingla",
      "ops_promotions",
    ]
  ) {
    assertMatch(read(WAVE2), new RegExp(`CREATE FUNCTION public\\.${fn}\\(`));
  }
});

Deno.test("#3980 W2 the promotions seam reads no ad table", () => {
  const sql = read(WAVE2);
  const start = sql.indexOf("CREATE FUNCTION public.ops_promotions(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  assertMatch(body, /-- Seam: ads \(#3697\) and giveaway \(#3922\) records join here/);
  assert(!/\bad_[a-z]+/.test(body), "reads an ad table");
  assert(!/\bad_plans\b|\bad_campaigns\b/.test(sql), "the wave reads an ad table");
});

Deno.test("#3980 W2 the calendar read never selects an address, theme or contact", () => {
  const sql = read(WAVE2);
  const created = sql.slice(
    sql.indexOf("CREATE FUNCTION public."),
    sql.indexOf("CREATE OR REPLACE FUNCTION public.ops_work_update("),
  );
  for (const column of ["location_text", "location_geo", "organiser_contact", "theme"]) {
    assert(!created.includes(column), column);
  }
});

Deno.test("#3980 W2 update_work takes a reason, and the screens' new functions have a tool or a reason", () => {
  const update = findWorkTool("update_work")!;
  assert(
    checkArguments(update, {
      id: "39800000-0000-4000-a000-000000000001",
      expected_revision: 2,
      changes: { status: "todo", reason: "The host paid for it." },
    }).ok,
  );
  assert(
    !checkArguments(update, {
      id: "39800000-0000-4000-a000-000000000001",
      expected_revision: 2,
      changes: { status: "todo", reason: "x".repeat(501) },
    }).ok,
  );
  assertMatch(update.description, /say why in reason/);
  assertEquals(WORK_SCREEN_FUNCTION_PARITY.ops_calendar, { tools: ["list_calendar"] });
  assertEquals(WORK_SCREEN_FUNCTION_PARITY.ops_runway_report, { tools: ["runway_report"] });
  assertEquals(WORK_SCREEN_FUNCTION_PARITY.ops_expected_event_set, { tools: ["set_expected_event"] });
  assert("excluded" in WORK_SCREEN_FUNCTION_PARITY.ops_anchor_detail);
  assert("excluded" in WORK_SCREEN_FUNCTION_PARITY.ops_host_on_mingla);
  const sql = read(WAVE2);
  assertMatch(sql, /RAISE EXCEPTION 'reason_required: Say why this card no longer needs a person\./);
});
