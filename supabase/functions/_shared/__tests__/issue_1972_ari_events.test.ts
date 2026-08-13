// #1972 / #424 child A — Events tools wrap existing RPCs; invalid ids never write.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError, AGENT_TOOLS } from "../agentTools.ts";

const EVENT_TOOLS = [
  "publish_event",
  "unpublish_event",
  "cancel_event",
  "end_event_sales",
  "duplicate_event",
  "patch_event_when",
  "set_event_cover",
  "set_event_guest_privacy",
];

Deno.test("#1972 happy: events tools are registered and still propose-only (not read-only)", () => {
  const names = new Set(AGENT_TOOLS.map((t) => t.name));
  for (const n of EVENT_TOOLS) {
    assert(names.has(n), `${n} missing from AGENT_TOOLS`);
    const tool = findTool(n)!;
    assertEquals(typeof tool.executor, "function");
  }
});

Deno.test("#1972 adversarial: every events write tool rejects a non-uuid event_id", async () => {
  for (const n of EVENT_TOOLS) {
    const tool = findTool(n)!;
    await assertRejects(
      () => tool.executor({ event_id: "bad" }, {} as never, "user-1"),
      ToolError,
    );
  }
});
