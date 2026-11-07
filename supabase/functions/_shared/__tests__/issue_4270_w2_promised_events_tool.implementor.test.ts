// Issue #4270 Wave 2 (D9, D16) — the agent tool set_expected_event no longer
// adds promised events: it needs the id of one already saved, and says that
// hosts create their events in the Host app. The Brand group's host avatar
// reads ops_brand_host_record, which an agent reads as the host card.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkArguments } from "../teamAgentTools.ts";
import { WORK_SCREEN_FUNCTION_PARITY, findWorkTool } from "../teamAgentWorkTools.ts";

const ID = "42700000-0000-4000-c0f0-000000000001";
const EXP = "42700000-0000-4000-d0f0-000000000001";

Deno.test("#4270 W2 set_expected_event: a new promised event is refused before the server", () => {
  const tool = findWorkTool("set_expected_event")!;
  const add = checkArguments(tool, { record_id: ID, title: "New brunch", event_type: "event", expected_on: "2026-12-05", request_key: "w2-add-0001" });
  assert(!add.ok, "no id: refused");
  const cancel = checkArguments(tool, { record_id: ID, id: EXP, status: "cancelled", cancel_reason: "The host moved it.", request_key: "w2-cancel-0001" });
  assert(cancel.ok, JSON.stringify(cancel));
  assertEquals(tool.title, "Change a promised event");
  assertMatch(tool.description, /New promised events can no longer be added: hosts create their events, experiences and trips in the Host app/);
  assert(!/Record the next event a host has promised/.test(tool.description));
});

Deno.test("#4270 W2 the Brand group's host avatar read has its parity reason", () => {
  assertEquals(WORK_SCREEN_FUNCTION_PARITY.ops_brand_host_record, { excluded: "the agent reads a host card with get_record" });
});
