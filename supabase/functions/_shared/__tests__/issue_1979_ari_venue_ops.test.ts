// #1979 — Ari venue ops / SMS / availability / menu / waitlist source contract.
//
// These are append-only regressions that FAIL ON REVERT of the #1979 repair:
//   - venue_ops_action advertises EXACTLY the venue-order-staff action set and
//     forwards a flat, camelCase envelope (never the old {action, payload} shape
//     with the legacy list_tables/open_tab/add_item/seat_waitlist tokens).
//   - send_venue_sms sends { waitlistId } ONLY — no arbitrary to_phone / body.
//   - the three previously-unsupported venue rows are registered with strict,
//     additionalProperties:false discriminated unions and reject unknown actions.
//
// Run:
//   deno test --allow-none supabase/functions/_shared/__tests__/issue_1979_ari_venue_ops.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";
const WAITLIST = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered in DOMAIN_TOOLS`);
  return tool;
}

/** A client that captures the single edge-function invocation it receives. */
function captureClient() {
  const captured: { name?: string; body?: Record<string, unknown> } = {};
  const client = {
    functions: {
      // deno-lint-ignore no-explicit-any
      invoke: (name: string, opts: any) => {
        captured.name = name;
        captured.body = opts?.body ?? {};
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
  };
  return { client, captured };
}

Deno.test("#1979 venue_ops_action advertises exactly the venue-order-staff action set", () => {
  const tool = domainTool("venue_ops_action");
  const actions: string[] = tool.parameters.properties.action.enum;
  assertEquals(
    [...actions].sort(),
    [
      "create",
      "item_availability",
      "pause",
      "refund_decision",
      "set_ordering_enabled",
      "settle",
      "tab_close",
      "tab_open",
      "transition",
    ],
  );
  // The legacy divergent tokens must be gone, and the generic {payload} envelope
  // must not survive (it is what made every call `unknown_action`).
  for (const legacy of ["list_tables", "open_tab", "add_item", "seat_waitlist"]) {
    assert(!actions.includes(legacy), `legacy action ${legacy} must be retired`);
  }
  assert(
    tool.parameters.properties.payload === undefined,
    "the generic payload envelope must be removed",
  );
  assertEquals(tool.parameters.additionalProperties, false);
});

Deno.test("#1979 venue_ops_action forwards a flat camelCase envelope to venue-order-staff", async () => {
  const tool = domainTool("venue_ops_action");
  const { client, captured } = captureClient();
  await tool.executor(
    { brand_id: BRAND, venue_id: VENUE, action: "transition", order_id: ORDER, to: "ready" },
    client as never,
    "user",
  );
  assertEquals(captured.name, "venue-order-staff");
  assertEquals(captured.body?.action, "transition");
  assertEquals(captured.body?.orderId, ORDER);
  assertEquals(captured.body?.to, "ready");
  assert(!("payload" in (captured.body ?? {})), "must not wrap args in payload");
});

Deno.test("#1979 venue_ops_action rejects an unknown/legacy action before any I/O", async () => {
  const tool = domainTool("venue_ops_action");
  const { client } = captureClient();
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, venue_id: VENUE, action: "seat_waitlist" },
        client as never,
        "user",
      ),
    ToolError,
  );
});

Deno.test("#1979 send_venue_sms schema carries waitlist_id only — no arbitrary phone/body", () => {
  const tool = domainTool("send_venue_sms");
  const props = Object.keys(tool.parameters.properties);
  assert(props.includes("waitlist_id"), "waitlist_id is required input");
  assert(!props.includes("to_phone"), "to_phone must be removed");
  assert(!props.includes("body"), "body must be removed");
  assert(tool.parameters.required.includes("waitlist_id"));
});

Deno.test("#1979 send_venue_sms forwards { waitlistId } and nothing else", async () => {
  const tool = domainTool("send_venue_sms");
  const { client, captured } = captureClient();
  await tool.executor(
    { brand_id: BRAND, venue_id: VENUE, waitlist_id: WAITLIST },
    client as never,
    "user",
  );
  assertEquals(captured.name, "send-venue-sms");
  assertEquals(captured.body, { waitlistId: WAITLIST });
});

Deno.test("#1979 the three previously-unsupported venue tools are registered with strict unions", () => {
  const expected: Record<string, string[]> = {
    manage_venue_availability: [
      "delete_blackout",
      "list_blackouts",
      "read_config",
      "read_slots",
      "update_config",
      "upsert_blackout",
    ],
    manage_venue_menu: [
      "delete_menu",
      "delete_menu_item",
      "delete_modifier_group",
      "list_menus",
      "list_modifier_groups",
      "save_modifier_group",
      "set_item_availability",
      "upsert_menu",
      "upsert_menu_item",
    ],
    manage_venue_waitlist: [
      "add_waitlist_entry",
      "convert_waitlist_to_reservation",
      "list_waitlist",
      "mark_waitlist_lost",
    ],
  };
  for (const [name, actions] of Object.entries(expected)) {
    const tool = domainTool(name);
    assertEquals(tool.parameters.additionalProperties, false);
    assertEquals([...tool.parameters.properties.action.enum].sort(), actions);
  }
});

Deno.test("#1979 venue management tools reject unknown actions before any write", async () => {
  const { client } = captureClient();
  for (const name of [
    "manage_venue_availability",
    "manage_venue_menu",
    "manage_venue_waitlist",
  ]) {
    const tool = domainTool(name);
    await assertRejects(
      () =>
        tool.executor(
          { brand_id: BRAND, venue_id: VENUE, action: "definitely_not_real" },
          client as never,
          "user",
        ),
      ToolError,
    );
  }
});
