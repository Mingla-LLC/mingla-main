// #424 children C–O — every domain tool is registered; money tools are not
// read-only; invalid brand/event ids fail closed.

import {
  assert,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_TOOLS, findTool, READ_ONLY_TOOL_NAMES, ToolError } from "../agentTools.ts";
import { DOMAIN_TOOLS, MONEY_CONFIRM_TOOLS } from "../agentDomainTools.ts";

const CHILD_TOOLS = [
  "publish_experience",
  "create_trip",
  "publish_trip",
  "create_rsvp",
  "publish_rsvp",
  "quote_stay",
  "create_stay_reservation",
  "create_venue_listing",
  "venue_ops_action",
  "send_venue_sms",
  "draft_campaign",
  "send_campaign_now",
  "run_growth_tool",
  "get_payout_status",
  "refund_order",
  "cancel_order",
  "get_brand_analytics",
  "invite_brand_member",
  "export_brand_people",
  "update_ari_prefs",
  "create_support_ticket",
  "request_account_deletion",
  "get_operator_snapshot",
];

Deno.test("#424 happy: children C–O tools are in the registry", () => {
  const names = new Set(AGENT_TOOLS.map((t) => t.name));
  for (const n of CHILD_TOOLS) {
    assert(names.has(n), `${n} missing`);
  }
  assert(DOMAIN_TOOLS.length >= CHILD_TOOLS.length);
});

Deno.test("#424 happy: money/destructive tools stay behind confirm (not inline)", () => {
  for (const n of MONEY_CONFIRM_TOOLS) {
    assert(findTool(n), `${n} registered`);
    assert(!READ_ONLY_TOOL_NAMES.has(n), `${n} must not run inline`);
  }
});

Deno.test("#424 adversarial: refund_order / send_campaign_now reject bad ids", async () => {
  await assertRejects(
    () => findTool("refund_order")!.executor({ brand_id: "x", order_id: "y" }, {} as never, "u"),
    ToolError,
  );
  await assertRejects(
    () => findTool("send_campaign_now")!.executor({ campaign_id: "x" }, {} as never, "u"),
    ToolError,
  );
  await assertRejects(
    () =>
      findTool("request_account_deletion")!.executor(
        { legal_name: "Ada", confirm_phrase: "NOPE" },
        {} as never,
        "u",
      ),
    ToolError,
  );
});

Deno.test("#424 adversarial: cancel_event rejects a missing or wrong confirm_phrase before any RPC", async () => {
  const tool = findTool("cancel_event")!;
  await assertRejects(
    () =>
      tool.executor(
        { event_id: "11111111-1111-4111-8111-111111111111" },
        {} as never,
        "u",
      ),
    ToolError,
    "confirm_phrase must be CANCEL",
  );
  await assertRejects(
    () =>
      tool.executor(
        {
          event_id: "11111111-1111-4111-8111-111111111111",
          confirm_phrase: "cancel",
        },
        {} as never,
        "u",
      ),
    ToolError,
    "confirm_phrase must be CANCEL",
  );
});

Deno.test("#424 intelligence: get_operator_snapshot is read-only for chain planning", () => {
  assert(READ_ONLY_TOOL_NAMES.has("get_operator_snapshot"));
  assert(findTool("get_operator_snapshot"));
});
