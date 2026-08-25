// deno-lint-ignore-file no-explicit-any require-await
import { AGENT_TOOLS } from "../agentTools.ts";
import {
  AGENT_TOOL_AUTHORIZATION,
  authorizeAgentTool,
  secureAgentTools,
} from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const UUID = "11111111-1111-4111-8111-111111111111";
const PARTNER = "33333333-3333-4333-8333-333333333333";
const VALID_CREATE_EVENT_ARGS = {
  brand_id: UUID,
  title: "Test",
  when_mode: "single",
  start_at: "2027-01-01T00:00:00Z",
  visibility: "public",
};
const tool = (name: string) => {
  const found = AGENT_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool fixture: ${name}`);
  return found;
};

Deno.test("#2019 registry is exact, duplicate-free, and fully declared", () => {
  // [TEST-MOD-APPROVED #2063] Three certified brand tools extend the current
  // #1973/#1985 denominator without changing inherited authorization semantics.
// [TEST-MOD-APPROVED #1975+#1978+#1979] Stay authoring (+3), venue listing
// reads (+3), and venue manage tools (+3); 71 + 9 = 80.
// [TEST-MOD-APPROVED #1979] Registry pin 77→80 after additive #1978 rebase.
// [TEST-MOD-APPROVED #424] Guest-binding fixture uses set_rsvp_guest_status
// (set_rsvp_guest_status may carry rsvp_id for #1984/#2593 containment).
// [TEST-MOD-APPROVED #1971] Four trip graph tools (manage_trip_days /
// _inclusions / _tiers / _traveler_intake) plus the finance-gated aggregate
// // get_trip_order_money are additive declarations; 85 - 1 set_guest_approval + 2 RSVP writes = 86.
// [TEST-MOD-APPROVED #1984] get_event_order_reconciliation; 87→90. The four
// invalidated assertions are exactly the four census counts below
// (AGENT_TOOLS.length, the unique-name set size, AGENT_TOOL_AUTHORIZATION key
// count, and the mapped ledger-row count). No role translation, ordering,
// resource binding or denial assertion changes.
// [TEST-MOD-APPROVED #1976] Three partner/payments reads; 87→90.
// [TEST-MOD-APPROVED #1981] charge_installment_now + send_installment_reminder; 90→92.
  assert(
    AGENT_TOOLS.length === 95,
    `expected 95 tools, got ${AGENT_TOOLS.length}`,
  );
  assert(new Set(AGENT_TOOLS.map((t) => t.name)).size === 95, "duplicate tool");
  assert(
    Object.keys(AGENT_TOOL_AUTHORIZATION).length === 95,
    "authorization registry drift",
  );
  for (const tool of AGENT_TOOLS) {
    const expected = AGENT_TOOL_AUTHORIZATION[tool.name];
    assert(
      expected?.requiredRole === tool.requiredRole,
      `${tool.name}: role drift`,
    );
    assert(
      expected?.resource === tool.resource,
      `${tool.name}: resource drift`,
    );
    assert(
      !["owner", "account_owner"].includes(tool.requiredRole),
      `${tool.name}: stale role accepted`,
    );
  }
});

Deno.test("#2019 declarations exactly translate the accepted capability ledger", async () => {
  const ledger = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../docs/contracts/ari-capability-ledger.json",
        import.meta.url,
      ),
    ),
  );
  const translate: Record<string, string> = {
    business_user: "business_user",
    self: "self",
    brand_member: "scanner",
    owner_or_marketing_manager: "marketing_manager",
    owner_or_finance_manager: "finance_manager",
    owner_or_event_manager: "event_manager",
    owner_or_manager: "event_manager",
    owner_or_admin: "brand_admin",
    // issue #1978 — venue claim feedback/resubmit are brand-owner-only, matching
    // the canonical biz_role_rank('brand_owner') gate.
    brand_owner: "brand_owner",
    owner: "deed_owner",
  };
  const rows = ledger.capabilities.filter((row: any) =>
    AGENT_TOOL_AUTHORIZATION[row.ari_tool]
  );
  // [TEST-MOD-APPROVED #1979] Mapped ledger rows track the 80-tool registry.
  // [TEST-MOD-APPROVED #1977] 85 -> 86: drop set_guest_approval; add update_rsvp + update_rsvp_contribution_settings.
  // [TEST-MOD-APPROVED #1984] 87 -> 90: get_event_order_reconciliation.
  // [TEST-MOD-APPROVED #1976] 87 -> 90: balances + partner links + splits.
  // [TEST-MOD-APPROVED #1981] 90 -> 92: charge_now + send_reminder.
  assert(rows.length === 95, `expected 95 ledger rows, got ${rows.length}`);
  for (const row of rows) {
    assert(
      AGENT_TOOL_AUTHORIZATION[row.ari_tool].requiredRole ===
        translate[row.required_role],
      `${row.ari_tool}: ledger translation drift`,
    );
  }
});

function client(
  rank: number,
  required: number,
  deedOwner = false,
  rpcError = false,
): any {
  return {
    rpc(name: string) {
      if (rpcError) {
        return Promise.resolve({ data: null, error: { message: "down" } });
      }
      return Promise.resolve({
        data: name === "biz_role_rank" ? required : rank,
        error: null,
      });
    },
    from() {
      const q: any = {
        select: () => q,
        eq: (_key: string, value: string) => {
          if (_key === "account_id") q.owner = value;
          return q;
        },
        is: () => q,
        maybeSingle: () =>
          Promise.resolve({
            data: deedOwner ? { id: UUID } : null,
            error: null,
          }),
      };
      return q;
    },
  };
}

Deno.test("#2019 canonical role boundary is caller-bound and monotonic", async () => {
  const createEvent = tool("create_event");
  await authorizeAgentTool(
    createEvent,
    VALID_CREATE_EVENT_ARGS,
    client(40, 40),
    UUID,
  );
  await authorizeAgentTool(
    createEvent,
    VALID_CREATE_EVENT_ARGS,
    client(50, 40),
    UUID,
  );
  await authorizeAgentTool(
    tool("get_payout_status"),
    { brand_id: UUID },
    client(40, 30),
    UUID,
  );
  let denied = false;
  try {
    await authorizeAgentTool(
      createEvent,
      VALID_CREATE_EVENT_ARGS,
      client(30, 40),
      UUID,
    );
  } catch (e) {
    denied = e instanceof ToolError && e.code === "ROLE_DENIED";
  }
  assert(denied, "one-rank-below caller reached executor boundary");
});

Deno.test("#2019 authority outage fails closed and deed ownership is exact", async () => {
  const ranked = tool("update_brand");
  let unavailable = false;
  try {
    await authorizeAgentTool(
      ranked,
      { brand_id: UUID },
      client(60, 50, true, true),
      UUID,
    );
  } catch (e) {
    unavailable = e instanceof ToolError && e.code === "ROLE_CHECK_UNAVAILABLE";
  }
  assert(unavailable, "authority error fell back to owner");

  const deletion = tool("delete_brand");
  let denied = false;
  try {
    await authorizeAgentTool(
      deletion,
      { brand_id: UUID },
      client(60, 60, false),
      UUID,
    );
  } catch (e) {
    denied = e instanceof ToolError && e.code === "BRAND_ACCESS_DENIED";
  }
  assert(denied, "rank-60 non-deed owner could delete brand");
  await authorizeAgentTool(
    deletion,
    { brand_id: UUID },
    client(0, 0, true),
    UUID,
  );
});

Deno.test("#2019 full rank x operation-class matrix", async () => {
  const classes = [
    ["get_brand_analytics", "scanner", 10],
    ["draft_campaign", "marketing_manager", 20],
    ["get_payout_status", "finance_manager", 30],
    ["create_event", "event_manager", 40],
    ["update_brand", "brand_admin", 50],
  ] as const;
  const callerRanks = [0, 10, 20, 30, 40, 50, 60];
  for (const [name, requiredRole, threshold] of classes) {
    const registered = tool(name);
    assert(
      registered.requiredRole === requiredRole,
      `${name}: fixture role drift`,
    );
    for (const actual of callerRanks) {
      let allowed = false;
      try {
        await authorizeAgentTool(
          registered,
          name === "create_event"
            ? VALID_CREATE_EVENT_ARGS
            : name === "draft_campaign"
            ? { brand_id: UUID, title: "Test" }
            : name === "update_brand"
            ? { brand_id: UUID, description: "Test" }
            : { brand_id: UUID },
          client(actual, threshold),
          UUID,
        );
        allowed = true;
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        assert(
          error.code === (actual === 0 ? "BRAND_ACCESS_DENIED" : "ROLE_DENIED"),
          `${name}: rank ${actual} returned ${error.code}`,
        );
      }
      assert(
        allowed === (actual >= threshold),
        `${name}: rank ${actual} matrix mismatch`,
      );
    }
  }
});

Deno.test("#2019 foreign, deleted, nonexistent, and type-confused events are unavailable", async () => {
  const FOREIGN_BRAND = "22222222-2222-4222-8222-222222222222";
  const EVENT = "44444444-4444-4444-8444-444444444444";
  const eventClient = (
    state: "foreign" | "deleted" | "missing" | "wrong_type",
  ): any => ({
    rpc(name: string) {
      return Promise.resolve({
        data: name === "biz_role_rank" || state === "wrong_type" ? 40 : 0,
        error: null,
      });
    },
    from(table: string) {
      let activeOnly = false;
      const query: any = {
        select: () => query,
        eq: () => query,
        is: () => {
          activeOnly = true;
          return query;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: table !== "events" || state === "missing" ||
                (state === "deleted" && activeOnly)
              ? null
              : {
                brand_id: FOREIGN_BRAND,
                event_type: state === "wrong_type" ? "event" : "trip",
              },
            error: null,
          }),
      };
      return query;
    },
  });
  const codes: string[] = [];
  const messages: string[] = [];
  for (
    const state of ["foreign", "deleted", "missing", "wrong_type"] as const
  ) {
    try {
      await authorizeAgentTool(
        tool("publish_trip"),
        // [TEST-MOD-APPROVED #1971] publish_trip now REQUIRES expected_updated_at
        // (compare-and-swap). Without it the shared schema check fires first and
        // this case would assert INVALID_ARGS instead of the indistinguishable
        // not-found behaviour it exists to prove. Only the fixture changed — the
        // four states, the codes assertion and the messages assertion are
        // untouched.
        { event_id: EVENT, expected_updated_at: "2027-01-01T00:00:00Z" },
        eventClient(state),
        UUID,
      );
    } catch (error) {
      if (error instanceof ToolError) {
        codes.push(error.code);
        messages.push(error.message);
      }
    }
  }
  assert(
    codes.length === 4 && codes.every((code) => code === "BRAND_ACCESS_DENIED"),
    "event state leaked by code",
  );
  assert(
    messages.length === 4 &&
      messages.every((message) => message === messages[0]),
    "event state leaked by message",
  );
});

Deno.test("#2019 wrapped executor cannot be bypassed and catches revocation", async () => {
  let calls = 0;
  let currentRank = 40;
  const fake: any = {
    rpc(name: string) {
      return Promise.resolve({
        data: name === "biz_role_rank" ? 40 : currentRank,
        error: null,
      });
    },
  };
  const [secured] = secureAgentTools([
    {
      name: "create_event",
      description: "fixture",
      parameters: {
        type: "object",
        required: ["brand_id"],
        properties: { brand_id: { format: "uuid" } },
      },
      executor: async () => {
        calls++;
        return { reached: true };
      },
    },
    ...AGENT_TOOLS.filter((tool) => tool.name !== "create_event").map((
      tool,
    ) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      executor: tool.executor,
    })),
  ]);
  await secured.executor({ brand_id: UUID }, fake, UUID);
  assert(calls === 1, "authorized executor did not reach domain boundary");
  currentRank = 0;
  let denied = false;
  try {
    await secured.executor({ brand_id: UUID }, fake, UUID);
  } catch (error) {
    denied = error instanceof ToolError && error.code === "BRAND_ACCESS_DENIED";
  }
  assert(denied && calls === 1, "revoked caller reached domain boundary");
});

Deno.test("#2019 foreign indirect resources and nonexistent ids are indistinguishable", async () => {
  const FOREIGN = "22222222-2222-4222-8222-222222222222";
  const makeResourceClient = (partnerExists: boolean): any => ({
    rpc(name: string) {
      return Promise.resolve({
        data: name === "biz_role_rank" ? 30 : 60,
        error: null,
      });
    },
    from(table: string) {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "partner_brand_links" && partnerExists
              ? { brand_id: FOREIGN }
              : null,
            error: null,
          }),
      };
      return query;
    },
  });
  const disconnectPartner = tool("disconnect_partner");
  const codes: string[] = [];
  for (const exists of [true, false]) {
    try {
      await authorizeAgentTool(
        disconnectPartner,
        { brand_id: UUID, partner_id: PARTNER, confirm_phrase: "DISCONNECT" },
        makeResourceClient(exists),
        UUID,
      );
    } catch (error) {
      if (error instanceof ToolError) codes.push(error.code);
    }
  }
  assert(
    codes.length === 2 && codes.every((code) => code === "BRAND_ACCESS_DENIED"),
    "resource existence leaked",
  );
});

Deno.test("#2019 partner binding uses the canonical link relation", async () => {
  const tables: string[] = [];
  const resourceClient: any = {
    rpc(name: string) {
      return Promise.resolve({
        data: name === "biz_role_rank" ? 30 : 30,
        error: null,
      });
    },
    from(table: string) {
      tables.push(table);
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "partner_brand_links" ? { brand_id: UUID } : null,
            error: null,
          }),
      };
      return query;
    },
  };
  await authorizeAgentTool(
    tool("disconnect_partner"),
    { brand_id: UUID, partner_id: PARTNER, confirm_phrase: "DISCONNECT" },
    resourceClient,
    UUID,
  );
  assert(
    tables.includes("partner_brand_links"),
    "partner link was not resolved through its canonical table",
  );
  assert(
    !tables.includes("brand_partners"),
    "authorization queried the obsolete nonexistent partner table",
  );
});

Deno.test("#2019 malformed final args fail before any authority or resource lookup", async () => {
  let authorityCalls = 0;
  const noLookupClient: any = {
    rpc() {
      authorityCalls++;
      return Promise.resolve({ data: 60, error: null });
    },
    from() {
      authorityCalls++;
      throw new Error("resource lookup must not run");
    },
  };
  for (
    const args of [
      { brand_id: UUID, confirm_phrase: "DISCONNECT" },
      {
        brand_id: UUID,
        partner_id: "not-a-uuid",
        confirm_phrase: "DISCONNECT",
      },
      { brand_id: UUID, partner_id: PARTNER, confirm_phrase: false },
      {
        brand_id: UUID,
        partner_id: PARTNER,
        confirm_phrase: "DISCONNECT",
        surprise: true,
      },
    ]
  ) {
    let code = "";
    try {
      await authorizeAgentTool(
        tool("disconnect_partner"),
        args,
        noLookupClient,
        UUID,
      );
    } catch (error) {
      if (error instanceof ToolError) code = error.code;
    }
    assert(
      code === "INVALID_ARGS",
      `malformed args did not fail as INVALID_ARGS: ${code}`,
    );
  }
  assert(
    authorityCalls === 0,
    "malformed args reached authority or resource lookup",
  );
});

Deno.test("#2019 RSVP selected roster_keys bind each RSVP to its event", async () => {
  // [TEST-MOD-APPROVED #1977] set_rsvp_guest_status dropped guest_id/status for
  // decision+scope+roster_keys. The containment proof now follows the selected
  // roster_keys path (rsvp:<uuid> → event_rsvps → events) that authorization
  // actually walks. guest_id is rejected by additionalProperties:false.
  const EVENT = "44444444-4444-4444-8444-444444444444";
  const RSVP = "66666666-6666-4666-8666-666666666666";
  const selects: string[] = [];
  const resourceClient: any = {
    rpc(name: string) {
      return Promise.resolve({
        data: name === "biz_role_rank" ? 40 : 40,
        error: null,
      });
    },
    from(table: string) {
      let selected = "";
      const query: any = {
        select: (columns: string) => {
          selected = columns;
          selects.push(`${table}:${columns}`);
          return query;
        },
        eq: () => query,
        is: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "events" && selected === "brand_id, event_type"
              ? { brand_id: UUID, event_type: "rsvp" }
              : table === "event_rsvps" && selected === "event_id"
              ? { event_id: EVENT }
              : null,
            error: null,
          }),
      };
      return query;
    },
  };
  await authorizeAgentTool(
    tool("set_rsvp_guest_status"),
    {
      event_id: EVENT,
      decision: "approve",
      scope: "selected",
      roster_keys: [`rsvp:${RSVP}`],
    },
    resourceClient,
    UUID,
  );
  assert(
    selects.includes("event_rsvps:event_id"),
    "roster_keys binding skipped canonical RSVP parent",
  );
  assert(
    selects.filter((row) => row.startsWith("events:")).length >= 1,
    "roster_keys binding never resolved the parent event",
  );
});
