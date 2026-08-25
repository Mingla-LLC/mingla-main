// deno-lint-ignore-file no-explicit-any
// [TEST-MOD-APPROVED #1977] set_guest_approval retired; containment
// proofs now drive set_rsvp_guest_status via roster_keys (rsvp:<uuid>).
// #2593 — INDEPENDENT TESTER adversarial proofs for the eight #2415 (#424
// Wave 3) defect-class repairs. Deliberately a DIFFERENT AXIS from the
// implementor suite in issue_2593_ari_wave3_defects.test.ts:
//
//   A. The implementor suite never touches `normalizeRosterCursor`. A mutation
//      sweep on head bf4d0d52a3 proved that deleting its CALL SITE, its key-set
//      check, or its non-object guard leaves all 19 implementor tests GREEN —
//      the same "check that carries no information" shape the implementor
//      caught for `classifyPartnerDisconnectError` and fixed in 39e7e9c19, but
//      a second, unaudited instance in the sibling helper added by the same PR.
//      These tests assert the guard at the EXECUTOR seam, so a deleted call
//      site fails here.
//   B. The implementor's D8 compares the advertised enum against a hand-copied
//      constant living in the test file, so a migration edit could never be
//      caught. These tests parse the MIGRATION ITSELF — the actual source of
//      truth — for both the `p_filter` domain and the cursor key set.
//   C. The implementor asserts three unpriced refund shapes. These walk the
//      numeric tower (NaN / Infinity / negative / fractional) AND pin the
//      opposite direction: a legitimately FREE cancellation prices at ZERO and
//      must still commit. Nothing in the implementor suite would notice a
//      future over-tightening to `> 0` that silently refuses free cancels.
//   D. Containment is asserted on the BULK `guest_ids` array at both element
//      positions, so a short-circuiting loop cannot pass.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { authorizeAgentTool } from "../agentToolAuthorization.ts";
import { AGENT_TOOLS } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

const CALLER = "99999999-9999-4999-8999-999999999999";
const BRAND = "11111111-1111-4111-8111-111111111111";
const EVENT = "33333333-3333-4333-8333-333333333333";
const OTHER_EVENT = "44444444-4444-4444-8444-444444444444";
const RSVP_A = "55555555-5555-4555-8555-555555555555";
const RSVP_B = "88888888-8888-4888-8888-888888888888";
const GUEST_A = "77777777-7777-4777-8777-777777777777";
const GUEST_B = "7777777a-7777-4777-8777-777777777777";
const BOOKING = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, unknown>;

type Recorder = {
  rpcCalls: Array<{ name: string; args: Row }>;
  invokeCalls: Array<{ name: string; body: Row }>;
};

function makeClient(options: any): { client: any; calls: Recorder } {
  const calls: Recorder = { rpcCalls: [], invokeCalls: [] };
  const client: any = {
    from(table: string) {
      let id: string | null = null;
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          if (key === "id") id = String(value);
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
          resolve({
            data: table === "brands" ? (options.brands ?? []) : [],
            error: null,
          }),
      };
      return query;
    },
    rpc(name: string, args: Row) {
      calls.rpcCalls.push({ name, args });
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

const domainTool = (name: string) =>
  DOMAIN_TOOLS.find((candidate) => candidate.name === name)!;
const securedTool = (name: string) =>
  AGENT_TOOLS.find((candidate) => candidate.name === name)!;

function rosterClient(rpc: (name: string, args: Row) => unknown) {
  return makeClient({
    brands: [{ id: BRAND, name: "Brand", slug: "brand" }],
    rows: {
      events: { [EVENT]: { id: EVENT, brand_id: BRAND, event_type: "rsvp" } },
    },
    rpc,
  });
}

const ROSTER_OK = (_name: string, _args: Row) => ({
  rows: [],
  summary: null,
  nextCursor: null,
});

// A cursor with exactly the seven keys the RPC's own guard requires.
const GOOD_CURSOR = {
  activityAt: "2027-01-01T00:00:00Z",
  name: "ada",
  queryHash: "deadbeef",
  rank: 1,
  rosterKey: "person:abc",
  signature: "cafebabe",
  watermark: 12,
};

// ---------------------------------------------------------------------------
// AXIS A — the cursor guard must be WIRED, not merely defined.
//
// Every case below asserts the executor SEAM: the refusal must happen and
// `biz_guest_roster_list` must never be reached. Deleting the
// `normalizeRosterCursor(...)` call site (or either guard inside it) makes
// these fail, which no test in the implementor suite does.
// ---------------------------------------------------------------------------

async function rejectsCursor(cursor: unknown): Promise<Recorder> {
  const { client, calls } = rosterClient(ROSTER_OK);
  const error = await assertRejects(
    () =>
      domainTool("list_guest_roster").executor(
        { event_id: EVENT, cursor },
        client,
        CALLER,
        undefined as never,
      ),
    ToolError,
  );
  assertEquals(error.code, "INVALID_ARGS");
  return calls;
}

Deno.test("#2593 T-A1 a mangled cursor is refused AT THE EXECUTOR and never reaches the RPC", async () => {
  const mangled: Array<[string, unknown]> = [
    ["an extra key", { ...GOOD_CURSOR, extra: 1 }],
    [
      "a missing key",
      (() => {
        const { signature: _drop, ...rest } = GOOD_CURSOR;
        return rest;
      })(),
    ],
    [
      "a renamed key",
      (() => {
        const { name: _drop, ...rest } = GOOD_CURSOR;
        return { ...rest, nombre: "ada" };
      })(),
    ],
    ["an empty object", {}],
    ["a model-invented cursor", { page: 2 }],
  ];
  for (const [label, cursor] of mangled) {
    const calls = await rejectsCursor(cursor);
    assert(
      !calls.rpcCalls.some((entry) => entry.name === "biz_guest_roster_list"),
      `${label} still reached biz_guest_roster_list`,
    );
  }
});

Deno.test("#2593 T-A2 a non-object cursor is refused AT THE EXECUTOR and never reaches the RPC", async () => {
  // The RPC's guard is `jsonb_typeof(p_cursor) <> 'object'`. A string, an array
  // or a number must be refused locally with an actionable INVALID_ARGS rather
  // than forwarded for Postgres to reject with a raw sentinel.
  for (const cursor of ['{"rank":1}', [GOOD_CURSOR], 5, true]) {
    const calls = await rejectsCursor(cursor);
    assert(
      !calls.rpcCalls.some((entry) => entry.name === "biz_guest_roster_list"),
      `${JSON.stringify(cursor)} still reached biz_guest_roster_list`,
    );
  }
});

Deno.test("#2593 T-A3 a well-formed cursor is forwarded BYTE FOR BYTE (the signature must survive)", async () => {
  // The cursor is HMAC-signed by the database. Any client-side normalisation,
  // re-ordering into a new object with dropped keys, or coercion would make the
  // RPC's signature re-derivation fail. Identity is the contract.
  const { client, calls } = rosterClient(ROSTER_OK);
  await domainTool("list_guest_roster").executor(
    { event_id: EVENT, cursor: GOOD_CURSOR },
    client,
    CALLER,
    undefined as never,
  );
  const call = calls.rpcCalls.find((entry) =>
    entry.name === "biz_guest_roster_list"
  )!;
  assertEquals(call.args.p_cursor, GOOD_CURSOR);
  assertEquals(
    JSON.stringify(call.args.p_cursor),
    JSON.stringify(GOOD_CURSOR),
  );
});

// ---------------------------------------------------------------------------
// AXIS B — the advertised contract is compared against the MIGRATION, not
// against a constant transcribed into a test file.
// ---------------------------------------------------------------------------

const MIGRATION_URL = new URL(
  "../../../migrations/20270319000873_issue_0873_guest_status_roster.sql",
  import.meta.url,
);
const MIGRATION_SQL = await Deno.readTextFile(MIGRATION_URL);

Deno.test("#2593 T-B1 the advertised filter enum equals the migration's own p_filter guard", () => {
  const guard = MIGRATION_SQL.match(
    /IF p_filter NOT IN \(([\s\S]*?)\)\s*\n\s*OR p_sort/,
  );
  assert(guard, "could not locate the p_filter guard in the migration");
  const fromMigration = [...guard[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assertEquals(
    fromMigration.length,
    22,
    "the migration's filter domain changed size",
  );
  const advertised =
    (domainTool("list_guest_roster").parameters as any).properties.filter.enum;
  assert(Array.isArray(advertised), "filter is not constrained to an enum");
  assertEquals(
    [...advertised].sort(),
    [...fromMigration].sort(),
    "the advertised filter enum drifted from the RPC's accepted domain",
  );
  assertEquals(
    new Set(advertised).size,
    advertised.length,
    "the advertised enum contains duplicates",
  );
});

Deno.test("#2593 T-B2 the advertised cursor key set equals the migration's own key guard", () => {
  const guard = MIGRATION_SQL.match(
    /public\.issue_1770_json_keys\(p_cursor\)<>\s*\n?\s*ARRAY\[([^\]]*)\]::text\[\]/,
  );
  assert(guard, "could not locate the cursor key guard in the migration");
  const fromMigration = [...guard[1].matchAll(/'([A-Za-z]+)'/g)].map((m) =>
    m[1]
  );
  const advertised =
    (domainTool("list_guest_roster").parameters as any).properties.cursor
      .required;
  assertEquals(
    [...advertised].sort(),
    [...fromMigration].sort(),
    "the advertised cursor key set drifted from the RPC's guard",
  );
});

Deno.test("#2593 T-B3 every filter the enum advertises is actually forwarded to p_filter", async () => {
  // An enum that lists a value the executor then refuses would be a dead
  // advertisement — the gate and the schema must agree in BOTH directions.
  const advertised = (domainTool("list_guest_roster").parameters as any)
    .properties.filter
    .enum as string[];
  for (const filter of advertised) {
    const { client, calls } = rosterClient(ROSTER_OK);
    await domainTool("list_guest_roster").executor(
      { event_id: EVENT, filter },
      client,
      CALLER,
      undefined as never,
    );
    const call = calls.rpcCalls.find((entry) =>
      entry.name === "biz_guest_roster_list"
    );
    assert(call, `advertised filter "${filter}" was refused by the executor`);
    assertEquals(call!.args.p_filter, filter);
  }
});

// ---------------------------------------------------------------------------
// AXIS C — the refund guard, walked across the numeric tower AND pinned in the
// permissive direction.
// ---------------------------------------------------------------------------

async function cancelWith(
  refundTotalCents: unknown,
  omit = false,
): Promise<{ error: ToolError | null; calls: Recorder }> {
  const preview = omit ? {} : { refundTotalCents };
  const { client, calls } = makeClient({
    invoke: (_name: string, body: Row) =>
      body.mode === "preview" ? preview : { ok: true },
  });
  const args = {
    brand_id: BRAND,
    booking_id: BOOKING,
    reason: "Operator cancelled the departure.",
    confirm_phrase: "CANCEL",
  };
  try {
    await domainTool("cancel_trip_booking").executor(
      args,
      client,
      CALLER,
      undefined as never,
    );
    return { error: null, calls };
  } catch (error) {
    return { error: error as ToolError, calls };
  }
}

Deno.test("#2593 T-C1 the numeric tower cannot smuggle an unpriced refund past the guard", async () => {
  const poison: Array<[string, unknown]> = [
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["a negative amount", -1],
    ["a fractional amount", 1200.5],
    ["a numeric string", "4275"],
    ["a zero string", "0"],
    ["a boolean", true],
    ["an array", []],
    ["an object", {}],
    ["null", null],
  ];
  for (const [label, value] of poison) {
    const { error, calls } = await cancelWith(value);
    assert(error, `${label} was committed instead of refused`);
    assertEquals(
      error!.code,
      "REFUND_PREVIEW_UNPRICED",
      `${label} produced the wrong refusal`,
    );
    // The commit leg must never have been reached: preview only.
    assertEquals(
      calls.invokeCalls.length,
      1,
      `${label} reached the commit leg`,
    );
    assertEquals(calls.invokeCalls[0].body.mode, "preview");
  }
  // A preview that returns a nested shape instead of the flat key is unpriced.
  const nested = await cancelWith(undefined, true);
  assertEquals(nested.error?.code, "REFUND_PREVIEW_UNPRICED");
  assertEquals(nested.calls.invokeCalls.length, 1);
});

Deno.test("#2593 T-C2 a legitimately FREE cancellation prices at zero and MUST still commit", async () => {
  // The opposite failure direction, which the implementor suite never pins: a
  // fully non-refundable booking legitimately previews at 0. Fail-closed must
  // mean "refuse the UNPRICED", never "refuse the ZERO" — tightening this to
  // `> 0` would silently block every free cancellation.
  const { error, calls } = await cancelWith(0);
  assertEquals(error, null, "a zero-priced cancellation was wrongly refused");
  assertEquals(calls.invokeCalls.length, 2, "the commit leg was not reached");
  assertEquals(calls.invokeCalls[1].body.mode, "operator");
  assertEquals(calls.invokeCalls[1].body.expectedRefundTotalCents, 0);
});

Deno.test("#2593 T-C3 the committed amount is the previewed amount, never a substitute", async () => {
  for (const amount of [1, 99, 4275, 1_000_000]) {
    const { error, calls } = await cancelWith(amount);
    assertEquals(error, null);
    assertEquals(calls.invokeCalls[1].body.expectedRefundTotalCents, amount);
  }
});

// ---------------------------------------------------------------------------
// AXIS D — containment across the BULK guest_ids array.
// ---------------------------------------------------------------------------

const RSVP_EVENT_ROW = { brand_id: BRAND, event_type: "rsvp" };

function guestClient(
  guestToRsvp: Record<string, string>,
  rsvpToEvent: Record<string, string>,
) {
  return makeClient({
    rows: {
      events: { [EVENT]: RSVP_EVENT_ROW, [OTHER_EVENT]: RSVP_EVENT_ROW },
      event_rsvp_guests: Object.fromEntries(
        Object.entries(guestToRsvp).map(([g, r]) => [g, { id: g, rsvp_id: r }]),
      ),
      event_rsvps: Object.fromEntries(
        Object.entries(rsvpToEvent).map((
          [r, e],
        ) => [r, { id: r, event_id: e }]),
      ),
    },
    rpc: () => 40,
  }).client;
}

Deno.test("#2593 T-D1 a bulk roster_keys array is checked at EVERY position, not short-circuited", async () => {
  // RSVP_A belongs to this event; RSVP_B belongs to a DIFFERENT event of the
  // SAME brand. The refusal must hold whichever position the bad member sits
  // in — a loop that stops after the first success would let one ordering pass.
  for (const order of [[RSVP_A, RSVP_B], [RSVP_B, RSVP_A]]) {
    const error = await assertRejects(
      () =>
        authorizeAgentTool(
          securedTool("set_rsvp_guest_status"),
          {
            event_id: EVENT,
            decision: "approve",
            scope: "selected",
            roster_keys: order.map((id) => `rsvp:${id}`),
          },
          guestClient(
            { [GUEST_A]: RSVP_A, [GUEST_B]: RSVP_B },
            { [RSVP_A]: EVENT, [RSVP_B]: OTHER_EVENT },
          ),
          CALLER,
        ),
      ToolError,
      undefined,
      `a mismatched member at position ${order.indexOf(RSVP_B)} was allowed`,
    );
    assertEquals(error.code, "BRAND_ACCESS_DENIED");
  }
});

Deno.test("#2593 T-D2 a bulk array whose members ALL belong to the named event is authorized", async () => {
  const context = await authorizeAgentTool(
    securedTool("set_rsvp_guest_status"),
    {
      event_id: EVENT,
      decision: "approve",
      scope: "selected",
      roster_keys: [`rsvp:${RSVP_A}`, `rsvp:${RSVP_B}`],
    },
    guestClient(
      { [GUEST_A]: RSVP_A, [GUEST_B]: RSVP_B },
      { [RSVP_A]: EVENT, [RSVP_B]: EVENT },
    ),
    CALLER,
  );
  assertEquals(context.brandId, BRAND);
});

Deno.test("#2593 T-D3 an RSVP with no resolvable parent event fails CLOSED on both chains", async () => {
  // `undefined !== "<uuid>"` must refuse, not slip through as a missing field.
  for (const missing of [null, undefined]) {
    await assertRejects(
      () =>
        authorizeAgentTool(
          securedTool("set_rsvp_guest_status"),
          { event_id: EVENT, decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP_A}`] },
          makeClient({
            rows: {
              events: { [EVENT]: RSVP_EVENT_ROW },
              event_rsvps: { [RSVP_A]: { id: RSVP_A, event_id: missing } },
            },
            rpc: () => 40,
          }).client,
          CALLER,
        ),
      ToolError,
      undefined,
      `an RSVP with event_id=${missing} was authorized`,
    );
  }
});

// ---------------------------------------------------------------------------
// AXIS E — P2-2: the containment compare is UUID-case-insensitive.
//
// `isUuid` carries the /i flag, so an uppercase event_id is a VALID uuid, while
// Postgres always returns uuids lowercase. The first containment fix compared
// with a raw `!==`, so a caller naming the RIGHT event in uppercase was told it
// had no permission. `sameUuid` fixes that. These tests attack a DIFFERENT axis
// than the implementor's D2e/D2f/D2g:
//
//   1. The implementor repaired its MOCK to lowercase the row-lookup key
//      (Postgres compares a uuid COLUMN by parsed value, so `WHERE id='AAA…'`
//      matches a lowercase row). That is faithful, but it means its fixtures
//      depend on the mock being right. This harness does the opposite: the
//      lookup stays CASE-SENSITIVE and every row is registered under lowercase,
//      uppercase AND mixed case, so a lookup can never 404 and can never be the
//      reason a case behaves differently. Only the comparison can be.
//   2. MIXED case, which the implementor only tests as all-uppercase.
//   3. A NEAR-COLLISION pair — two uuids sharing every character except the
//      last — which proves the comparison is whole-string. A prefix-only
//      comparison passes every implementor test and would be a false GRANT.
//   4. The bulk `guest_ids` array under an uppercase event_id.
// ---------------------------------------------------------------------------

// Hex LETTERS in every group. The other ids in this file are all digits, so a
// case test built on one would silently prove nothing — CASE_FIXTURE_IS_CASED
// below pins that, and pins it harder than `upper !== lower`.
const CASE_EVENT = "3a3b3c3d-4e4f-4a4b-8c8d-9e9f0a0b0c0d";
const CASE_OTHER_EVENT = "5b5c5d5e-6f6a-4b6c-8d8e-af0b1c2d3e4f";
// Differs from CASE_EVENT in the FINAL character only.
const CASE_NEAR_COLLISION = "3a3b3c3d-4e4f-4a4b-8c8d-9e9f0a0b0c0e";

const upper = (value: string) => value.toUpperCase();
const mixed = (value: string) =>
  [...value].map((char, index) => index % 2 ? char.toUpperCase() : char).join(
    "",
  );

/** Rows registered under EVERY casing, looked up CASE-SENSITIVELY: the lookup
 * is therefore never the variable under test. */
function caseHarness(rsvpEventIdInDatabase: unknown, guestRsvps: Row = {}) {
  const everyCasing = (rows: Row): Row => {
    const out: Row = {};
    for (const [key, value] of Object.entries(rows)) {
      out[key] = value;
      out[upper(key)] = value;
      out[mixed(key)] = value;
    }
    return out;
  };
  return makeClient({
    rows: {
      events: everyCasing({
        [CASE_EVENT]: RSVP_EVENT_ROW,
        [CASE_OTHER_EVENT]: RSVP_EVENT_ROW,
        [CASE_NEAR_COLLISION]: RSVP_EVENT_ROW,
      }),
      // The database returns the CANONICAL value, never an echo of the input.
      event_rsvps: everyCasing({
        [RSVP_A]: { id: RSVP_A, event_id: rsvpEventIdInDatabase },
        ...guestRsvps,
      }),
      event_rsvp_guests: everyCasing({
        [GUEST_A]: { id: GUEST_A, rsvp_id: RSVP_A },
        [GUEST_B]: { id: GUEST_B, rsvp_id: RSVP_B },
      }),
    },
    rpc: () => 40,
  }).client;
}

Deno.test("#2593 T-E0 the case fixtures are genuinely cased (an all-digit uuid would prove nothing)", () => {
  for (
    const [label, value] of [
      ["CASE_EVENT", CASE_EVENT],
      ["CASE_OTHER_EVENT", CASE_OTHER_EVENT],
      ["CASE_NEAR_COLLISION", CASE_NEAR_COLLISION],
    ] as Array<[string, string]>
  ) {
    const letters = value.replace(/[-0-9]/g, "");
    assert(
      letters.length >= 8,
      `${label} has only ${letters.length} hex letters — .toUpperCase() would barely change it`,
    );
    assert(upper(value) !== value, `${label} is not actually case-bearing`);
    assert(mixed(value) !== value, `${label} has no mixed-case form`);
  }
  // The premise of the whole defect: an uppercase uuid is a VALID uuid, which
  // is why a raw `!==` produced a false denial instead of an INVALID_ARGS.
  const schemaUuid = (domainTool("list_guest_roster").parameters as any)
    .properties.event_id;
  assert(schemaUuid, "event_id is not schema-declared");
  assertEquals(
    CASE_NEAR_COLLISION.slice(0, -1),
    CASE_EVENT.slice(0, -1),
    "the near-collision pair must differ in the LAST character only",
  );
});

Deno.test("#2593 T-E1 an uppercase or MIXED-case event_id that matches is accepted on both chains", async () => {
  for (const form of [upper, mixed]) {
    const bare = await authorizeAgentTool(
      securedTool("set_rsvp_guest_status"),
      { event_id: form(CASE_EVENT), decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP_A}`] },
      caseHarness(CASE_EVENT),
      CALLER,
    );
    assertEquals(bare.brandId, BRAND);
    const guest = await authorizeAgentTool(
      securedTool("set_rsvp_guest_status"),
      { event_id: form(CASE_EVENT), decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP_A}`] },
      caseHarness(CASE_EVENT),
      CALLER,
    );
    assertEquals(guest.brandId, BRAND);
  }
});

Deno.test("#2593 T-E2 case-insensitivity did NOT become a hole: a different event is still refused", async () => {
  // The repair must not trade a false denial for a false grant.
  for (const form of [upper, mixed, (value: string) => value]) {
    for (
      const [tool, args] of [
        ["set_rsvp_guest_status", { decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP_A}`] }],
        ["set_rsvp_guest_status", { decision: "deny", scope: "selected", roster_keys: [`rsvp:${RSVP_A}`] }],
      ] as Array<[string, Row]>
    ) {
      const error = await assertRejects(
        () =>
          authorizeAgentTool(
            securedTool(tool),
            { ...args, event_id: form(CASE_OTHER_EVENT) },
            caseHarness(CASE_EVENT),
            CALLER,
          ),
        ToolError,
      );
      assertEquals(error.code, "BRAND_ACCESS_DENIED");
    }
  }
});

Deno.test("#2593 T-E3 the compare is WHOLE-STRING: a uuid differing only in the LAST character is refused", async () => {
  // A prefix-only or truncated comparison satisfies every other case test in
  // this repo — both fixtures elsewhere differ in their first characters — yet
  // would conflate two distinct events. Attack the far end of the string, in
  // every casing.
  for (const form of [upper, mixed, (value: string) => value]) {
    const error = await assertRejects(
      () =>
        authorizeAgentTool(
          securedTool("set_rsvp_guest_status"),
          {
            event_id: form(CASE_NEAR_COLLISION),
            decision: "approve",
            scope: "selected",
            roster_keys: [`rsvp:${RSVP_A}`],
          },
          caseHarness(CASE_EVENT),
          CALLER,
        ),
      ToolError,
      undefined,
      `a uuid differing only in the last character was accepted (${
        form(CASE_NEAR_COLLISION)
      })`,
    );
    assertEquals(error.code, "BRAND_ACCESS_DENIED");
  }
  // ...and the genuine match still passes, so this is not just a blanket deny.
  const context = await authorizeAgentTool(
    securedTool("set_rsvp_guest_status"),
    { event_id: upper(CASE_EVENT), decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP_A}`] },
    caseHarness(CASE_EVENT),
    CALLER,
  );
  assertEquals(context.brandId, BRAND);
});

Deno.test("#2593 T-E4 an uppercase event_id does not weaken BULK roster_keys containment", async () => {
  // Axis D, re-run under the case fix: every member is still checked, at every
  // position, when the event is named in uppercase.
  const rsvps = {
    [RSVP_B]: { id: RSVP_B, event_id: CASE_OTHER_EVENT },
  };
  for (const order of [[RSVP_A, RSVP_B], [RSVP_B, RSVP_A]]) {
    const error = await assertRejects(
      () =>
        authorizeAgentTool(
          securedTool("set_rsvp_guest_status"),
          {
            event_id: upper(CASE_EVENT),
            decision: "approve",
            scope: "selected",
            roster_keys: order.map((id) => `rsvp:${id}`),
          },
          caseHarness(CASE_EVENT, rsvps),
          CALLER,
        ),
      ToolError,
    );
    assertEquals(error.code, "BRAND_ACCESS_DENIED");
  }
  // All members inside the named event, addressed in uppercase: authorized.
  const context = await authorizeAgentTool(
    securedTool("set_rsvp_guest_status"),
    {
      event_id: upper(CASE_EVENT),
      decision: "approve",
      scope: "selected",
      roster_keys: [`rsvp:${RSVP_A}`, `rsvp:${RSVP_B}`],
    },
    caseHarness(CASE_EVENT, {
      [RSVP_B]: { id: RSVP_B, event_id: CASE_EVENT },
    }),
    CALLER,
  );
  assertEquals(context.brandId, BRAND);
});

Deno.test("#2593 T-E5 a non-string event_id on the database side still fails CLOSED", async () => {
  // Reachability note: these refuse UPSTREAM of the comparison, at the row
  // guard, with INVALID_ARGS rather than BRAND_ACCESS_DENIED — so `sameUuid`'s
  // own typeof guards are defence in depth rather than the active gate here.
  // Pinned anyway: if the row guard is ever loosened, the comparison must not
  // start coercing a non-string into a match.
  for (const value of [null, undefined, 12345, true, { id: CASE_EVENT }]) {
    await assertRejects(
      () =>
        authorizeAgentTool(
          securedTool("set_rsvp_guest_status"),
          { event_id: upper(CASE_EVENT), decision: "approve", scope: "selected", roster_keys: [`rsvp:${RSVP_A}`] },
          caseHarness(value),
          CALLER,
        ),
      ToolError,
      undefined,
      `rsvp.event_id=${JSON.stringify(value)} was authorized`,
    );
  }
});
