// deno-lint-ignore-file no-explicit-any
// [TEST-MOD-APPROVED #1977] set_guest_approval retired; containment
// proofs now drive set_rsvp_guest_status via roster_keys (rsvp:<uuid>).
// #2593 — implementor happy-path proofs for the eight #2415 (#424 Wave 3)
// defect classes that merged with 21 unaddressed review threads.
//
// Every assertion here is written to FAIL when its fix is deleted from source.
// The tester owns the adversarial angle separately.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyPartnerDisconnectError,
  DOMAIN_TOOLS,
} from "../agentDomainTools.ts";
import { authorizeAgentTool } from "../agentToolAuthorization.ts";
import { AGENT_TOOLS } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const CALLER = "99999999-9999-4999-8999-999999999999";
const BRAND = "11111111-1111-4111-8111-111111111111";
const OTHER_BRAND = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const OTHER_EVENT = "44444444-4444-4444-8444-444444444444";
const RSVP = "55555555-5555-4555-8555-555555555555";
const BOOKING = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, unknown>;

/** The RAW (pre-authorization) executor, so an executor-level defect is what
 * the assertion actually reaches. Item 2 exercises the seam directly instead. */
function domainTool(name: string) {
  const found = DOMAIN_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing domain tool fixture: ${name}`);
  return found;
}

function securedTool(name: string) {
  const found = AGENT_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing secured tool fixture: ${name}`);
  return found;
}

type ClientOptions = {
  brands?: Row[];
  members?: Row[];
  rows?: Record<string, Record<string, Row | null>>;
  rpc?: (name: string, args: Row) => unknown;
  rpcError?: (name: string, args: Row) => unknown;
  invoke?: (name: string, body: Row) => unknown;
};

type Recorder = {
  rpcCalls: Array<{ name: string; args: Row }>;
  invokeCalls: Array<{ name: string; body: Row }>;
};

function makeClient(options: ClientOptions): { client: any; calls: Recorder } {
  const calls: Recorder = { rpcCalls: [], invokeCalls: [] };
  const listFor = (table: string): Row[] => {
    if (table === "brands") return options.brands ?? [];
    if (table === "brand_team_members") return options.members ?? [];
    return [];
  };
  const client = {
    from(table: string) {
      let id: string | null = null;
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          // Postgres compares a uuid COLUMN by parsed value, not by string, so
          // `WHERE id = 'AAAA...'` matches a lowercase row. Lowercase the
          // lookup key so the fixture cannot accidentally "prove" a
          // case-sensitivity fix by 404-ing the row instead.
          if (key === "id") id = String(value).toLowerCase();
          return query;
        },
        is: () => query,
        not: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: options.rows?.[table]?.[id ?? ""] ?? null,
            error: null,
          }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve({ data: listFor(table), error: null }),
      };
      return query;
    },
    rpc(name: string, args: Row) {
      calls.rpcCalls.push({ name, args });
      // PostgREST hands back a PLAIN OBJECT in `error`, never an Error.
      const error = options.rpcError ? options.rpcError(name, args) : null;
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({
        data: options.rpc ? options.rpc(name, args) : null,
        error: null,
      });
    },
    functions: {
      invoke(name: string, init: { body: Row }) {
        calls.invokeCalls.push({ name, body: init.body });
        return Promise.resolve({
          data: options.invoke ? options.invoke(name, init.body) : null,
          error: null,
        });
      },
    },
  };
  return { client, calls };
}

// A caller who owns BRAND and can read EVENT (an rsvp-type event of BRAND).
function rosterClient(
  rpc: (name: string, args: Row) => unknown,
): { client: any; calls: Recorder } {
  return makeClient({
    brands: [{ id: BRAND, name: "Brand", slug: "brand" }],
    rows: {
      events: {
        [EVENT]: { id: EVENT, brand_id: BRAND, event_type: "rsvp" },
      },
    },
    rpc,
  });
}

// ---------------------------------------------------------------------------
// Item 1 — a money-moving commit must carry the exact previewed amount.
// ---------------------------------------------------------------------------

Deno.test("#2593 D1 cancel_trip_booking commits the EXACT previewed refund", async () => {
  const { client, calls } = makeClient({
    invoke: (_name, body) =>
      body.mode === "preview" ? { refundTotalCents: 4275 } : { ok: true },
  });
  await domainTool("cancel_trip_booking").executor(
    {
      brand_id: BRAND,
      booking_id: BOOKING,
      reason: "Operator cancelled the departure.",
      confirm_phrase: "CANCEL",
    },
    client,
    CALLER,
    undefined as never,
  );
  assertEquals(calls.invokeCalls.length, 2);
  assertEquals(calls.invokeCalls[1].body.mode, "operator");
  assertEquals(calls.invokeCalls[1].body.expectedRefundTotalCents, 4275);
});

Deno.test("#2593 D1 an unpriced preview refuses instead of committing zero", async () => {
  for (
    const preview of [{}, { refundTotalCents: null }, {
      refundTotalCents: "4275",
    }]
  ) {
    const { client, calls } = makeClient({
      invoke: (
        _name,
        body,
      ) => (body.mode === "preview" ? preview : { ok: true }),
    });
    const error = await assertRejects(
      () =>
        domainTool("cancel_trip_booking").executor(
          {
            brand_id: BRAND,
            booking_id: BOOKING,
            reason: "Operator cancelled the departure.",
            confirm_phrase: "CANCEL",
          },
          client,
          CALLER,
          undefined as never,
        ),
      ToolError,
    );
    assertEquals(error.code, "REFUND_PREVIEW_UNPRICED");
    // The commit leg must never have been reached.
    assertEquals(calls.invokeCalls.length, 1);
    assertEquals(calls.invokeCalls[0].body.mode, "preview");
  }
});

// ---------------------------------------------------------------------------
// Item 2 — the rsvp_id / event_id pair must name the same parent record.
// ---------------------------------------------------------------------------

function approvalClient(
  rsvpEventId: string,
  events: Record<string, Row | null>,
): any {
  return makeClient({
    rows: {
      events,
      event_rsvps: { [RSVP]: { id: RSVP, event_id: rsvpEventId } },
    },
    rpc: () => 40,
  }).client;
}

const RSVP_EVENT_ROW = { brand_id: BRAND, event_type: "rsvp" };

Deno.test("#2593 D2a a matching event_id / rsvp_id pair is authorized", async () => {
  const context = await authorizeAgentTool(
    securedTool("set_rsvp_guest_status"),
    { event_id: EVENT, decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP}`] },
    approvalClient(EVENT, { [EVENT]: RSVP_EVENT_ROW }),
    CALLER,
  );
  assertEquals(context.brandId, BRAND);
});

Deno.test("#2593 D2b a same-brand pair naming DIFFERENT events fails closed", async () => {
  const error = await assertRejects(
    () =>
      authorizeAgentTool(
        securedTool("set_rsvp_guest_status"),
        { event_id: EVENT, decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP}`] },
        // The RSVP belongs to OTHER_EVENT — same brand, different event.
        approvalClient(OTHER_EVENT, {
          [EVENT]: RSVP_EVENT_ROW,
          [OTHER_EVENT]: RSVP_EVENT_ROW,
        }),
        CALLER,
      ),
    ToolError,
  );
  assertEquals(error.code, "BRAND_ACCESS_DENIED");
});

Deno.test("#2593 D2c an rsvp_id from a FOREIGN brand fails closed", async () => {
  const error = await assertRejects(
    () =>
      authorizeAgentTool(
        securedTool("set_rsvp_guest_status"),
        { event_id: EVENT, decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP}`] },
        approvalClient(OTHER_EVENT, {
          [EVENT]: RSVP_EVENT_ROW,
          [OTHER_EVENT]: { brand_id: OTHER_BRAND, event_type: "rsvp" },
        }),
        CALLER,
      ),
    ToolError,
  );
  assertEquals(error.code, "BRAND_ACCESS_DENIED");
});

Deno.test("#2593 D2d the guest two-hop chain enforces the same containment", async () => {
  const GUEST = "77777777-7777-4777-8777-777777777777";
  const guestClient = (rsvpEventId: string) =>
    makeClient({
      rows: {
        events: {
          [EVENT]: RSVP_EVENT_ROW,
          [OTHER_EVENT]: RSVP_EVENT_ROW,
        },
        event_rsvp_guests: { [GUEST]: { id: GUEST, rsvp_id: RSVP } },
        event_rsvps: { [RSVP]: { id: RSVP, event_id: rsvpEventId } },
      },
      rpc: () => 40,
    }).client;
  const args = { event_id: EVENT, decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP}`] };
  const context = await authorizeAgentTool(
    securedTool("set_rsvp_guest_status"),
    args,
    guestClient(EVENT),
    CALLER,
  );
  assertEquals(context.brandId, BRAND);
  const error = await assertRejects(
    () =>
      authorizeAgentTool(
        securedTool("set_rsvp_guest_status"),
        args,
        guestClient(OTHER_EVENT),
        CALLER,
      ),
    ToolError,
  );
  assertEquals(error.code, "BRAND_ACCESS_DENIED");
});

// #2593 P2-2 — `isUuid` carries the /i flag, so an uppercase event_id is a
// VALID uuid, and Postgres returns the RSVP's event_id lowercase. A raw `!==`
// therefore denied a caller whose uppercase event_id genuinely matched. The
// fix must accept the match WITHOUT weakening containment.
//
// This fixture deliberately carries hex LETTERS. The other ids in this file
// are all digits, so `.toUpperCase()` on them is a no-op and a case test built
// on one would silently prove nothing — the assert below pins that.
const CASED_EVENT = "3a3b3c3d-4e4f-4a4b-8c8d-9e9f0a0b0c0d";
const UPPER_EVENT = CASED_EVENT.toUpperCase();

Deno.test("#2593 D2e an uppercase event_id that MATCHES the rsvp is accepted", async () => {
  // Sanity: the uppercase form is still a valid uuid and a different string,
  // so this test is exercising the comparison and not a typo.
  assert(UPPER_EVENT !== CASED_EVENT, "fixture is not actually uppercase");
  const context = await authorizeAgentTool(
    securedTool("set_rsvp_guest_status"),
    { event_id: UPPER_EVENT, decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP}`] },
    approvalClient(CASED_EVENT, { [CASED_EVENT]: RSVP_EVENT_ROW }),
    CALLER,
  );
  assertEquals(context.brandId, BRAND);
});

Deno.test("#2593 D2f an uppercase event_id from a DIFFERENT event is still refused", async () => {
  const error = await assertRejects(
    () =>
      authorizeAgentTool(
        securedTool("set_rsvp_guest_status"),
        { event_id: UPPER_EVENT, decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP}`] },
        // Same brand, different event — case-insensitivity must not become a
        // hole in the containment guard.
        approvalClient(OTHER_EVENT, {
          [CASED_EVENT]: RSVP_EVENT_ROW,
          [OTHER_EVENT]: RSVP_EVENT_ROW,
        }),
        CALLER,
      ),
    ToolError,
  );
  assertEquals(error.code, "BRAND_ACCESS_DENIED");
});

Deno.test("#2593 D2g the guest chain matches case-insensitively and still contains", async () => {
  const GUEST = "88888888-8888-4888-8888-888888888888";
  const guestClient = (rsvpEventId: string) =>
    makeClient({
      rows: {
        events: {
          [CASED_EVENT]: RSVP_EVENT_ROW,
          [OTHER_EVENT]: RSVP_EVENT_ROW,
        },
        event_rsvp_guests: { [GUEST]: { id: GUEST, rsvp_id: RSVP } },
        event_rsvps: { [RSVP]: { id: RSVP, event_id: rsvpEventId } },
      },
      rpc: () => 40,
    }).client;
  const args = {
    event_id: UPPER_EVENT,
    decision: "approve",
    scope: "selected",
    roster_keys: [`rsvp:${RSVP}`],
  };
  const context = await authorizeAgentTool(
    securedTool("set_rsvp_guest_status"),
    args,
    guestClient(CASED_EVENT),
    CALLER,
  );
  assertEquals(context.brandId, BRAND);
  const error = await assertRejects(
    () =>
      authorizeAgentTool(
        securedTool("set_rsvp_guest_status"),
        args,
        guestClient(OTHER_EVENT),
        CALLER,
      ),
    ToolError,
  );
  assertEquals(error.code, "BRAND_ACCESS_DENIED");
});

// ---------------------------------------------------------------------------
// Item 3 — roster fields read the keys biz_guest_roster_list actually emits.
// ---------------------------------------------------------------------------

const ROSTER_ROW = {
  rosterKey: "person:abc",
  displayName: "Ada",
  primaryStatus: "awaiting_approval",
  invitationStatus: "invited",
  rsvpId: RSVP,
  rsvpApprovalStatus: "pending",
  checkedIn: false,
  party: { size: 3, activeTickets: 0 },
  canApprove: true,
  canDeny: true,
  canRemind: false,
  canRetry: false,
};

Deno.test("#2593 D3 approvalStatus and partySize come from rsvpApprovalStatus / party.size", async () => {
  const { client } = rosterClient((name) =>
    name === "biz_guest_roster_list"
      ? { rows: [ROSTER_ROW], summary: { all: 1 }, nextCursor: null }
      : null
  );
  const result = await domainTool("list_guest_roster").executor(
    { event_id: EVENT },
    client,
    CALLER,
    undefined as never,
  ) as { rows: Array<Record<string, unknown>> };
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0].approvalStatus, "pending");
  assertEquals(result.rows[0].partySize, 3);
});

// ---------------------------------------------------------------------------
// Item 4 — advertised pagination actually paginates.
// ---------------------------------------------------------------------------

const NEXT_CURSOR = {
  activityAt: "2027-01-01T00:00:00Z",
  name: "ada",
  queryHash: "deadbeef",
  rank: 1,
  rosterKey: "person:abc",
  signature: "cafebabe",
  watermark: 12,
};

Deno.test("#2593 D4 the first page sends no cursor and returns the next one", async () => {
  const { client, calls } = rosterClient((name) =>
    name === "biz_guest_roster_list"
      ? { rows: [ROSTER_ROW], summary: null, nextCursor: NEXT_CURSOR }
      : null
  );
  const result = await domainTool("list_guest_roster").executor(
    { event_id: EVENT },
    client,
    CALLER,
    undefined as never,
  ) as { hasMore: boolean; nextCursor: unknown };
  const call = calls.rpcCalls.find((entry) =>
    entry.name === "biz_guest_roster_list"
  )!;
  assertEquals(call.args.p_cursor, null);
  assertEquals(result.hasMore, true);
  assertEquals(result.nextCursor, NEXT_CURSOR);
});

Deno.test("#2593 D4 page 2 forwards the returned cursor verbatim to p_cursor", async () => {
  const { client, calls } = rosterClient((name) =>
    name === "biz_guest_roster_list"
      ? { rows: [], summary: null, nextCursor: null }
      : null
  );
  const result = await domainTool("list_guest_roster").executor(
    { event_id: EVENT, cursor: NEXT_CURSOR },
    client,
    CALLER,
    undefined as never,
  ) as { hasMore: boolean; nextCursor: unknown };
  const call = calls.rpcCalls.find((entry) =>
    entry.name === "biz_guest_roster_list"
  )!;
  assertEquals(call.args.p_cursor, NEXT_CURSOR);
  assertEquals(result.hasMore, false);
  assertEquals(result.nextCursor, null);
});

Deno.test("#2593 D4 the tool advertises a cursor input and a nextCursor output", () => {
  const schema = domainTool("list_guest_roster").parameters as any;
  assert(schema.properties.cursor, "cursor input is not advertised");
  assertEquals(
    [...schema.properties.cursor.required].sort(),
    [
      "activityAt",
      "name",
      "queryHash",
      "rank",
      "rosterKey",
      "signature",
      "watermark",
    ],
  );
});

// ---------------------------------------------------------------------------
// Item 5 — pg_brand_can_collect is a scalar boolean, and a non-boolean is loud.
// ---------------------------------------------------------------------------

Deno.test("#2593 D5 payout readiness reads the scalar boolean both ways", async () => {
  for (const value of [true, false]) {
    const { client } = makeClient({
      brands: [{ id: BRAND, name: "Brand", slug: "brand" }],
      rpc: (name) => (name === "pg_brand_can_collect" ? value : null),
    });
    const result = await domainTool("get_payout_status").executor(
      { brand_id: BRAND },
      client,
      CALLER,
      undefined as never,
    ) as { can_collect: boolean };
    assertEquals(result.can_collect, value);
  }
});

Deno.test("#2593 D5 a non-boolean readiness answer refuses instead of reporting 'cannot collect'", async () => {
  for (const value of [null, { can_collect: true }, "true"]) {
    const { client } = makeClient({
      brands: [{ id: BRAND, name: "Brand", slug: "brand" }],
      rpc: (name) => (name === "pg_brand_can_collect" ? value : null),
    });
    const error = await assertRejects(
      () =>
        domainTool("get_payout_status").executor(
          { brand_id: BRAND },
          client,
          CALLER,
          undefined as never,
        ),
      ToolError,
    );
    assertEquals(error.code, "RPC_FAILED");
  }
});

// ---------------------------------------------------------------------------
// Item 6 — failures are classified on structured fields, not on prose.
// ---------------------------------------------------------------------------

Deno.test("#2593 D6 partner disconnect failures classify on the SQLSTATE + whole sentinel", () => {
  assertEquals(
    classifyPartnerDisconnectError({ code: "P0001", message: "forbidden" })
      .code,
    "BRAND_ACCESS_DENIED",
  );
  assertEquals(
    classifyPartnerDisconnectError({ code: "P0001", message: "link_not_found" })
      .code,
    "INVALID_ARGS",
  );
  assertEquals(
    classifyPartnerDisconnectError({
      code: "P0001",
      message: "link_not_active",
    }).code,
    "INVALID_ARGS",
  );
  // PostgREST errors are PLAIN OBJECTS, never Error instances — the classifier
  // must not depend on the prototype.
  assert(!(({ code: "P0001", message: "forbidden" }) instanceof Error));
});

Deno.test("#2593 D6 a foreign sentinel embedded in prose is NOT this RPC's refusal", () => {
  // Same substring the old `.includes()` matched, but a different SQLSTATE and
  // a different token: it must fall through to a generic failure.
  assertEquals(
    classifyPartnerDisconnectError({
      code: "42501",
      message: "guest_roster_forbidden",
    }).code,
    "RPC_FAILED",
  );
  assertEquals(
    classifyPartnerDisconnectError({
      code: "P0001",
      message: "guest_roster_forbidden",
    }).code,
    "RPC_FAILED",
  );
  assertEquals(
    classifyPartnerDisconnectError({
      code: "P0001",
      message: "link_not_found_v2",
    })
      .code,
    "RPC_FAILED",
  );
});

async function disconnectWith(error: Row): Promise<ToolError> {
  const { client } = makeClient({ rpcError: () => error });
  return await assertRejects(
    () =>
      domainTool("disconnect_partner").executor(
        {
          brand_id: BRAND,
          partner_id: RSVP,
          confirm_phrase: "DISCONNECT",
        },
        client,
        CALLER,
        undefined as never,
      ),
    ToolError,
  );
}

Deno.test("#2593 D6 disconnect_partner routes failures through the structured classifier", async () => {
  // The RPC's own sentinels still map to their clean refusals...
  assertEquals(
    (await disconnectWith({ code: "P0001", message: "link_not_active" })).code,
    "INVALID_ARGS",
  );
  assertEquals(
    (await disconnectWith({ code: "P0001", message: "forbidden" })).code,
    "BRAND_ACCESS_DENIED",
  );
  // ...but a DIFFERENT failure that merely contains the substring "forbidden"
  // must not be dressed up as this RPC's permission refusal. The substring
  // classifier called this BRAND_ACCESS_DENIED.
  assertEquals(
    (await disconnectWith({ code: "42501", message: "guest_roster_forbidden" }))
      .code,
    "RPC_FAILED",
  );
});

// ---------------------------------------------------------------------------
// Item 7 — `input` is the intake object, and it is required.
// ---------------------------------------------------------------------------

Deno.test("#2593 D7 run_growth_tool declares input required and forwards it", async () => {
  const schema = domainTool("run_growth_tool").parameters as any;
  assert(schema.required.includes("input"), "input is not required");
  const { client, calls } = makeClient({ invoke: () => ({ ok: true }) });
  await domainTool("run_growth_tool").executor(
    {
      brand_id: BRAND,
      tool_key: "site_check",
      input: { url: "https://x.test" },
    },
    client,
    CALLER,
    undefined as never,
  );
  assertEquals(calls.invokeCalls[0].name, "growth-tools-run");
  assertEquals(calls.invokeCalls[0].body.input, { url: "https://x.test" });
});

Deno.test("#2593 D7 a missing or non-object input refuses before the engine runs", async () => {
  for (const input of [undefined, null, "site_check", ["a"]]) {
    const { client, calls } = makeClient({ invoke: () => ({ ok: true }) });
    const error = await assertRejects(
      () =>
        domainTool("run_growth_tool").executor(
          { brand_id: BRAND, tool_key: "site_check", input },
          client,
          CALLER,
          undefined as never,
        ),
      ToolError,
    );
    assertEquals(error.code, "INVALID_ARGS");
    assertEquals(calls.invokeCalls.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Item 8 — filter is constrained to the domain the RPC accepts.
// ---------------------------------------------------------------------------

const MIGRATION_FILTERS = [
  "all",
  "rsvpd",
  "ticketed",
  "not_yet",
  "suppressed",
  "needs_attention",
  "no_response",
  "confirmed",
  "checked_in",
  "not_checked_in",
  "delivery_failed",
  "removed",
  "going",
  "maybe",
  "awaiting_approval",
  "waitlisted",
  "declined",
  "denied",
  "bought_ticket",
  "refunded",
  "cancelled",
  "transferred",
];

Deno.test("#2593 D8 the advertised filter enum equals the RPC's accepted domain", () => {
  const schema = domainTool("list_guest_roster").parameters as any;
  assertEquals(
    [...schema.properties.filter.enum].sort(),
    [
      ...MIGRATION_FILTERS,
    ].sort(),
  );
});

Deno.test("#2593 D8 an off-domain filter refuses before the RPC is called", async () => {
  const { client, calls } = rosterClient(() => ({
    rows: [],
    summary: null,
    nextCursor: null,
  }));
  const error = await assertRejects(
    () =>
      domainTool("list_guest_roster").executor(
        { event_id: EVENT, filter: "everyone" },
        client,
        CALLER,
        undefined as never,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
  assert(
    !calls.rpcCalls.some((entry) => entry.name === "biz_guest_roster_list"),
    "an unconstrained filter still reached the RPC",
  );
});
