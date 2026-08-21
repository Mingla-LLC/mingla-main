// #1975 — Ari Stay authoring source contract.
//
// Append-only regressions that FAIL ON REVERT of the #1975 repair:
//   - the three previously-unsupported Stay authoring tools (manage_stay_inventory,
//     publish_stay, manage_stay_policy_price_media) are registered with strict,
//     additionalProperties:false discriminated unions and exact action sets.
//   - manage_stay_inventory 'get' is server-classified read-only (may run inline);
//     every other action is a confirmed mutation.
//   - the Stay authoring tools forward the canonical manage-stay-inventory
//     camelCase envelope (venueId / expectedVersion) and refuse to execute a
//     mutation without an operation id from the original proposal.
//   - the proposal-time authorization gate for all three is event_manager/brand.
//
// Run:
//   deno test --allow-none supabase/functions/_shared/__tests__/issue_1975_ari_stays_reservations.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";
const OPERATION = "55555555-5555-4555-8555-555555555555";

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

Deno.test("#1975 Stay authoring tools are registered with strict discriminated unions", () => {
  const expected: Record<string, string[]> = {
    manage_stay_inventory: [
      "bulk_create",
      "change_status",
      "create_offering",
      "get",
      "materialize_place_windows",
      "replace_units",
      "resolve_currency_reconciliation",
      "save_settings",
      "update_offering",
      "upsert_place_schedule",
      "upsert_place_windows",
      "upsert_room_nights",
    ],
    manage_stay_policy_price_media: [
      "attach_media",
      "remove_media",
      "reorder_media",
      "replace_fees",
      "set_policy",
      "set_price",
    ],
  };
  for (const [name, actions] of Object.entries(expected)) {
    const tool = domainTool(name);
    assertEquals(tool.parameters.additionalProperties, false);
    assertEquals([...tool.parameters.properties.action.enum].sort(), actions);
  }
});

Deno.test("#1975 publish_stay requires the current settings version", () => {
  const tool = domainTool("publish_stay");
  assertEquals(tool.parameters.additionalProperties, false);
  assert(
    tool.parameters.required.includes("expected_version"),
    "publish_stay must require expected_version (no force publish)",
  );
});

Deno.test("#1975 manage_stay_inventory 'get' is read-only; every mutation is not", () => {
  assert(isReadOnlyAgentToolCall("manage_stay_inventory", { action: "get" }));
  for (
    const action of [
      "save_settings",
      "create_offering",
      "change_status",
      "upsert_room_nights",
    ]
  ) {
    assert(
      !isReadOnlyAgentToolCall("manage_stay_inventory", { action }),
      `${action} must be a confirmed mutation, not an inline read`,
    );
  }
  // The money tools are never inline reads.
  assert(!isReadOnlyAgentToolCall("publish_stay", {}));
  assert(
    !isReadOnlyAgentToolCall("manage_stay_policy_price_media", {
      action: "set_price",
    }),
  );
});

Deno.test("#1975 Stay authoring proposal-time gate is event_manager/brand", () => {
  for (
    const name of [
      "manage_stay_inventory",
      "publish_stay",
      "manage_stay_policy_price_media",
    ]
  ) {
    const decl = AGENT_TOOL_AUTHORIZATION[name];
    assert(decl, `${name} must have an authorization declaration`);
    assertEquals(decl.requiredRole, "event_manager");
    assertEquals(decl.resource, "brand");
  }
});

Deno.test("#1975 manage_stay_policy_price_media forwards the canonical camelCase envelope", async () => {
  const tool = domainTool("manage_stay_policy_price_media");
  const { client, captured } = captureClient();
  await tool.executor(
    {
      brand_id: BRAND,
      venue_id: VENUE,
      action: "set_price",
      payload: { offering_id: "abc", price_cents: 1000 },
      expected_version: 3,
    },
    client as never,
    "user",
    { operationId: OPERATION },
  );
  assertEquals(captured.name, "manage-stay-inventory");
  assertEquals(captured.body?.action, "set_price");
  assertEquals(captured.body?.venueId, VENUE);
  assertEquals(captured.body?.expectedVersion, 3);
  assert(
    !("venue_id" in (captured.body ?? {})),
    "must forward camelCase venueId, not venue_id",
  );
});

Deno.test("#1975 Stay mutations refuse to execute without an operation id", async () => {
  const { client } = captureClient();
  await assertRejects(
    () =>
      domainTool("publish_stay").executor(
        { brand_id: BRAND, venue_id: VENUE, expected_version: 2 },
        client as never,
        "user",
      ),
    ToolError,
  );
  await assertRejects(
    () =>
      domainTool("manage_stay_policy_price_media").executor(
        {
          brand_id: BRAND,
          venue_id: VENUE,
          action: "set_policy",
          payload: {},
          expected_version: 1,
        },
        client as never,
        "user",
      ),
    ToolError,
  );
});
