// #4571 W2: the connector's log_activity takes a call's outcome (exactly the
// six SOP outcomes), its length, the number dialled and a Work card; the
// Work tools link the two new kinds. Run: deno test (deno 1.46).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CALL_OUTCOMES, checkArguments, findTool } from "../teamAgentTools.ts";
import { TEAM_AGENT_WORK_TOOLS } from "../teamAgentWorkTools.ts";

const RECORD = "45710000-0000-4000-d000-000000000001";
const logTool = () => {
  const tool = findTool("log_activity");
  assert(tool, "log_activity is a tool");
  return tool;
};
const entry = (extra: Record<string, unknown>) => ({
  entries: [{ id: RECORD, kind: "touch", channel: "phone", direction: "outbound", ...extra }],
  request_key: "w2-4571-outcome-key",
});

Deno.test("the outcomes are the SOP's six, in order", () => {
  assertEquals([...CALL_OUTCOMES], [
    "demo_booked",
    "spoke_follow_up",
    "call_back",
    "no_answer",
    "not_interested",
    "wrong_number",
  ]);
});

Deno.test("log_activity accepts each of the six outcomes with a length, a card and a number", () => {
  for (const outcome of CALL_OUTCOMES) {
    const answer = checkArguments(logTool(), entry({ outcome, duration_seconds: 245, work_card: "4571", identifier: "+234 803 555 0101" }));
    assert(answer.ok, `${outcome} is accepted`);
  }
});

Deno.test("log_activity refuses a seventh outcome", () => {
  const answer = checkArguments(logTool(), entry({ outcome: "busy" }));
  assert(!answer.ok, "busy is refused");
});

Deno.test("log_activity refuses a length outside 0 to 14400 seconds", () => {
  assert(!checkArguments(logTool(), entry({ duration_seconds: 14401 })).ok);
  assert(!checkArguments(logTool(), entry({ duration_seconds: -1 })).ok);
  assert(checkArguments(logTool(), entry({ duration_seconds: 0 })).ok);
});

Deno.test("the description says a call is a phone touch with its outcome", () => {
  assert(logTool().description.includes("A call is a touch with channel phone; send its outcome"));
});

Deno.test("add_work and update_work link calls and demo bookings", () => {
  for (const name of ["add_work", "update_work"]) {
    const tool = TEAM_AGENT_WORK_TOOLS.find((t) => t.name === name);
    assert(tool, `${name} is a tool`);
    const text = JSON.stringify(tool.inputSchema);
    assert(text.includes('"call"') && text.includes('"booking"'), `${name} takes call and booking links`);
  }
});
