// #1974 / #424 child B — ticket tiers + pricing switches. Paid path requires
// pg_brand_can_collect; invalid ids never reach a write.

import {
  assert,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";

Deno.test("#1974 happy: upsert_ticket_tier and set_pricing_switches are registered", () => {
  assert(findTool("upsert_ticket_tier"), "upsert_ticket_tier registered");
  assert(findTool("set_pricing_switches"), "set_pricing_switches registered");
});

Deno.test("#1974 adversarial: paid-tier args with a bad event_id throw before collect check", async () => {
  const tool = findTool("upsert_ticket_tier")!;
  await assertRejects(
    () =>
      tool.executor(
        { event_id: "nope", name: "GA", price_cents: 2500 },
        {} as never,
        "user-1",
      ),
    ToolError,
    "event_id must be a uuid",
  );
});

Deno.test("#1974 adversarial: set_pricing_switches rejects a non-uuid event", async () => {
  const tool = findTool("set_pricing_switches")!;
  await assertRejects(
    () => tool.executor({ event_id: "nope", pass_tax: true }, {} as never, "user-1"),
    ToolError,
  );
});
