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

// ---------------------------------------------------------------------------
// #2592 — implementor happy-path proofs for the nine repaired defects.
//
// APPEND-ONLY. Nothing above this banner is modified. Every test below fails
// when its own fix is deleted from `agentDomainTools.ts` or from
// `supabase/migrations/20270512001975_issue_1975_ari_stays_reservations.sql`.
//
// Run:
//   deno test --allow-read \
//     supabase/functions/_shared/__tests__/issue_1975_ari_stays_reservations.test.ts
// ---------------------------------------------------------------------------

const OTHER_BRAND = "99999999-9999-4999-8999-999999999999";
const RESERVATION = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const PREVIEW = "66666666-6666-4666-8666-666666666666";
const PREVIEW_HASH = "a".repeat(64);

const ISSUE_1975_MIGRATION_PATH = new URL(
  "../../../migrations/20270512001975_issue_1975_ari_stays_reservations.sql",
  import.meta.url,
);

/**
 * A client that captures the single RPC it receives and answers exactly one
 * `venue_listings` identity read. `venueRow: null` models a venue the caller's
 * own RLS-scoped JWT cannot see.
 */
function captureRpcClient(
  venueRow: Record<string, unknown> | null = { id: VENUE, brand_id: BRAND },
) {
  const captured: { fn?: string; args?: Record<string, unknown> } = {};
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      captured.fn = fn;
      captured.args = args;
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from: (_table: string) => ({
      select: (_columns: string) => ({
        eq: (_column: string, _value: unknown) => ({
          maybeSingle: () => Promise.resolve({ data: venueRow, error: null }),
        }),
      }),
    }),
  };
  return { client, captured };
}

function venueReservationArgs(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    brand_id: BRAND,
    venue_id: VENUE,
    reserved_for: "2026-09-01T19:30:00.000Z",
    party_size: 4,
    ...extra,
  };
}

Deno.test("#2592 B1 create_venue_reservation binds the venue into the RPC", async () => {
  const { client, captured } = captureRpcClient();
  await domainTool("create_venue_reservation").executor(
    venueReservationArgs(),
    client as never,
    "user",
    { operationId: OPERATION },
  );
  assertEquals(captured.fn, "biz_reservation_create");
  // The canonical RPC is VENUE-keyed; `p_brand_id` is not a parameter of it.
  assertEquals(captured.args?.p_venue_id, VENUE);
  assert(
    !("p_brand_id" in (captured.args ?? {})),
    "biz_reservation_create has no p_brand_id parameter — sending one cannot resolve",
  );
});

Deno.test("#2592 B1 create_venue_reservation refuses a venue outside the authorised brand", async () => {
  // Same shape the RLS-scoped read returns for another brand's venue.
  const { client, captured } = captureRpcClient({
    id: VENUE,
    brand_id: OTHER_BRAND,
  });
  await assertRejects(
    () =>
      domainTool("create_venue_reservation").executor(
        venueReservationArgs(),
        client as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );
  assertEquals(captured.fn, undefined);

  // An invisible venue (RLS returned no row) is refused on the same path.
  const invisible = captureRpcClient(null);
  await assertRejects(
    () =>
      domainTool("create_venue_reservation").executor(
        venueReservationArgs(),
        invisible.client as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );
  assertEquals(invisible.captured.fn, undefined);
});

Deno.test("#2592 B5 create_venue_reservation coerces tags to the strings its schema declares", async () => {
  const { client, captured } = captureRpcClient();
  await domainTool("create_venue_reservation").executor(
    venueReservationArgs({
      tags: ["vip", 7, "  anniversary  ", "", null, { a: 1 }, "x".repeat(501)],
    }),
    client as never,
    "user",
    { operationId: OPERATION },
  );
  assertEquals(captured.args?.p_tags, ["vip", "anniversary"]);
});

Deno.test("#2592 B4 create_venue_reservation refuses a non-E.164 guest phone", async () => {
  const { client, captured } = captureRpcClient();
  await assertRejects(
    () =>
      domainTool("create_venue_reservation").executor(
        venueReservationArgs({ guest_phone_e164: "415-555-0123" }),
        client as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );
  assertEquals(captured.fn, undefined);
});

Deno.test("#2592 B4 buildStayGuest validates the E.164 it claims in its refusal", async () => {
  const { client, captured } = captureClient();
  for (
    const phone of ["415 555 0123", "+0155501234567", "+1415", "not-a-phone"]
  ) {
    await assertRejects(
      () =>
        domainTool("create_stay_reservation").executor(
          {
            brand_id: BRAND,
            quote_id: VENUE,
            expected_version: 1,
            guest: { name: "Ada", phone },
          },
          client as never,
          "user",
          { operationId: OPERATION },
        ),
      ToolError,
    );
    assertEquals(captured.name, undefined);
  }
  // A real E.164 still passes through, trimmed, on the canonical guest shape.
  await domainTool("create_stay_reservation").executor(
    {
      brand_id: BRAND,
      quote_id: VENUE,
      expected_version: 1,
      guest: { name: "Ada", phone: " +14155550123 " },
    },
    client as never,
    "user",
    { operationId: OPERATION },
  );
  assertEquals(captured.name, "stay-reservations");
  const guest = (captured.body?.payload as Record<string, unknown>)
    .guest as Record<string, unknown>;
  assertEquals(guest.phone, "+14155550123");
});

Deno.test("#2592 B4 the guest phone schema publishes the same E.164 shape it enforces", () => {
  const stay = domainTool("create_stay_reservation");
  assertEquals(
    stay.parameters.properties.guest.properties.phone.pattern,
    "^\\+[1-9][0-9]{7,14}$",
  );
  const venue = domainTool("create_venue_reservation");
  assertEquals(
    venue.parameters.properties.guest_phone_e164.pattern,
    "^\\+[1-9][0-9]{7,14}$",
  );
});

Deno.test("#2592 B2 manage_stay_inventory refuses a mutation with no expected_version", async () => {
  const { client, captured } = captureClient();
  for (const action of ["save_settings", "create_offering", "bulk_create"]) {
    await assertRejects(
      () =>
        domainTool("manage_stay_inventory").executor(
          { brand_id: BRAND, venue_id: VENUE, action, payload: {} },
          client as never,
          "user",
          { operationId: OPERATION },
        ),
      ToolError,
    );
    assertEquals(captured.name, undefined, `${action} must not dispatch`);
  }
});

Deno.test("#2592 B2 manage_stay_inventory always forwards expectedVersion on a mutation", async () => {
  const { client, captured } = captureClient();
  await domainTool("manage_stay_inventory").executor(
    {
      brand_id: BRAND,
      venue_id: VENUE,
      action: "save_settings",
      payload: { check_in: "15:00" },
      expected_version: 9,
    },
    client as never,
    "user",
    { operationId: OPERATION },
  );
  assertEquals(captured.name, "manage-stay-inventory");
  assertEquals(captured.body?.expectedVersion, 9);
  assertEquals(captured.body?.venueId, VENUE);
});

Deno.test("#2592 B3 transition_stay refuses an unknown operation instead of cancelling", async () => {
  const { client, captured } = captureClient();
  for (const operation of ["cancel_request", "approve", "", "CANCEL"]) {
    await assertRejects(
      () =>
        domainTool("transition_stay").executor(
          {
            operation,
            group_id: GROUP,
            preview_id: PREVIEW,
            preview_hash: PREVIEW_HASH,
            reason: "guest asked",
          },
          client as never,
          "user",
          { operationId: OPERATION },
        ),
      ToolError,
    );
    assertEquals(
      captured.name,
      undefined,
      `${operation} must not fall through to cancel`,
    );
  }
});

Deno.test("#2592 B3 transition_stay keeps the two branches apart", async () => {
  const { client, captured } = captureClient();
  // A versioned approve may not smuggle a preview binding.
  await assertRejects(
    () =>
      domainTool("transition_stay").executor(
        {
          operation: "approve_request",
          group_id: GROUP,
          expected_version: 3,
          preview_id: PREVIEW,
        },
        client as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );
  assertEquals(captured.name, undefined);
  // A cancel is bound to a preview, never to a version.
  await assertRejects(
    () =>
      domainTool("transition_stay").executor(
        {
          operation: "cancel",
          group_id: GROUP,
          expected_version: 3,
          preview_id: PREVIEW,
          preview_hash: PREVIEW_HASH,
          reason: "guest asked",
        },
        client as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );
  assertEquals(captured.name, undefined);
  // Each branch still executes on its own exact shape.
  await domainTool("transition_stay").executor(
    { operation: "approve_request", group_id: GROUP, expected_version: 3 },
    client as never,
    "user",
    { operationId: OPERATION },
  );
  assertEquals(captured.body?.expectedVersion, 3);
});

Deno.test("#2592 transition_venue_reservation forwards the versioned RPC envelope", async () => {
  const { client, captured } = captureRpcClient();
  await domainTool("transition_venue_reservation").executor(
    {
      reservation_id: RESERVATION,
      to_status: "seated",
      expected_version: 4,
    },
    client as never,
    "user",
    { operationId: OPERATION },
  );
  assertEquals(captured.fn, "issue_1975_reservation_transition");
  assertEquals(captured.args?.p_expected_version, 4);
  assertEquals(captured.args?.p_reservation_id, RESERVATION);
});

Deno.test("#2592 A1 the #1975 migration scopes its CHECK probe to public.reservations", async () => {
  const sql = await Deno.readTextFile(ISSUE_1975_MIGRATION_PATH);
  // `pg_constraint.conname` is unique per RELATION, not per cluster: an
  // unrelated table using the same constraint name used to satisfy the probe
  // and the CHECK was silently never added.
  assert(
    sql.includes("conrelid = 'public.reservations'::regclass"),
    "the reservations_version_positive probe must be scoped to public.reservations",
  );
});

Deno.test("#2592 A2 the #1975 migration keeps the repo's version-conflict convention", async () => {
  const sql = await Deno.readTextFile(ISSUE_1975_MIGRATION_PATH);
  // Every optimistic-concurrency site in this repo raises '40001' paired with a
  // STABLE MESSAGE LITERAL, and the literal — never the SQLSTATE — is what the
  // owning layer translates into a 409. Diverging on this one function would
  // make the reservation path behave differently from the Stay path for an
  // identical failure. The literal is the load-bearing half, so it is pinned.
  assert(
    sql.includes("USING ERRCODE = '40001'"),
    "the version conflict must keep the repo's established optimistic-concurrency SQLSTATE",
  );
  assert(
    sql.includes("reservation_version_conflict_expected_%_actual_%"),
    "the conflict must carry a stable, classifiable literal AND the actual version",
  );
});

Deno.test("#2592 A2 a stale version is a VERSION_CONFLICT, never a server fault", async () => {
  // This is the layer the exposure actually lives at. `issue_1975_reservation_transition`
  // is the ONLY version-conflict site Ari calls with no owning Edge in front of
  // it, so nothing translated the conflict and it arrived as the generic
  // RPC_FAILED — which `toolErrorHttpStatus` maps to 500, the one status the Ari
  // envelope contract calls `safe_to_retry: true`.
  const client = {
    rpc: (_fn: string, _args: Record<string, unknown>) =>
      Promise.resolve({
        data: null,
        error: {
          code: "40001",
          message: "reservation_version_conflict_expected_2_actual_7",
        },
      }),
  };
  const error = await assertRejects(
    () =>
      domainTool("transition_venue_reservation").executor(
        {
          reservation_id: RESERVATION,
          to_status: "seated",
          expected_version: 2,
        },
        client as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );
  assertEquals(error.code, "VERSION_CONFLICT");
  assert(
    !error.message.includes("reservation_version_conflict_expected"),
    "the raw database literal must not be the user-facing message",
  );
  // The refusal must hand back the CURRENT version, so the next attempt is a
  // fresh read rather than the same stale number re-sent unchanged.
  assert(
    error.message.includes("7"),
    `the refusal must name the actual current version: ${error.message}`,
  );
});

Deno.test("#2592 A2 a non-conflict RPC failure is still reported as itself", async () => {
  const client = {
    rpc: (_fn: string, _args: Record<string, unknown>) =>
      Promise.resolve({
        data: null,
        error: { code: "42501", message: "not_authorized" },
      }),
  };
  const error = await assertRejects(
    () =>
      domainTool("transition_venue_reservation").executor(
        {
          reservation_id: RESERVATION,
          to_status: "seated",
          expected_version: 2,
        },
        client as never,
        "user",
        { operationId: OPERATION },
      ),
    ToolError,
  );
  assertEquals(error.code, "RPC_FAILED");
});
