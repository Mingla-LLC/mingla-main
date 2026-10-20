// Issue #3980 proof fix P2-2 — an agent can finish Journey G: set_expected_event
// takes repeats (none, week or month, the person's own choices) and the
// promo moment type, so a promised event changes to weekly in place and a
// venue's promo moment can be recorded. The server checks the same values
// again (ops_expected_event_set).
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkArguments } from "../teamAgentTools.ts";
import { findWorkTool } from "../teamAgentWorkTools.ts";

const ID = "39930000-0000-4000-c100-000000000002";
const EXP = "39930000-0000-4000-d100-000000000002";

Deno.test("#3980 P2-2 set_expected_event takes repeats and makes a saved event weekly in place", () => {
  const tool = findWorkTool("set_expected_event")!;
  const r = checkArguments(tool, { record_id: ID, id: EXP, repeats: "week", request_key: "g-weekly-0001" });
  assert(r.ok, JSON.stringify(r));
  if (r.ok) assertEquals(r.args, { record_id: ID, id: EXP, repeats: "week", request_key: "g-weekly-0001" });
  for (const repeats of ["none", "week", "month"]) {
    assert(checkArguments(tool, { record_id: ID, id: EXP, repeats, request_key: "g-repeat-0002" }).ok, repeats);
  }
  const bad = checkArguments(tool, { record_id: ID, id: EXP, repeats: "fortnight", request_key: "g-repeat-0003" });
  assert(!bad.ok, "an unknown repeat is refused before it reaches the server");
});

Deno.test("#3980 P2-2 set_expected_event takes a venue's promo moment", () => {
  const tool = findWorkTool("set_expected_event")!;
  const r = checkArguments(tool, {
    record_id: ID, title: "Detty December menu", event_type: "promo_moment", expected_on: "2026-12-05", repeats: "none",
    request_key: "g-moment-0001",
  });
  assert(r.ok, JSON.stringify(r));
  assertMatch(tool.description, /repeats: none, week or month; send id with repeats to make a saved event repeat in place/);
  assertMatch(tool.description, /promo_moment/);
  assert(tool.description.length < 1900, "the description stays under 1900 characters");
});
