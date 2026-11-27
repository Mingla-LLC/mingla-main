// MINGLA-INVARIANT: I-ARI-EVENT-SETTINGS-FAIL-CLOSED | issue #4599 | get_event_settings either returns the caller-authorized event's actual settings and explicitly-known PII-free counts, or throws READ_FAILED / reports *_known false; it never substitutes a plausible default for a failed or capped read.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { DOMAIN_TOOLS, readEventSettings } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";

type Response = { data: unknown; error: null | { message: string } };

class Query implements PromiseLike<Response> {
  selected = "";
  constructor(
    readonly table: string,
    readonly resolve: (table: string, selected: string) => Response,
  ) {}
  select(value: string) {
    this.selected = value;
    return this;
  }
  eq() {
    return this;
  }
  is() {
    return this;
  }
  not() {
    return this;
  }
  order() {
    return this;
  }
  range() {
    return this;
  }
  maybeSingle(): Promise<Response> {
    return Promise.resolve(this.resolve(this.table, this.selected));
  }
  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?:
      | ((value: Response) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve(this.table, this.selected)).then(
      onfulfilled,
      onrejected,
    );
  }
}

interface Fixture {
  access?: boolean;
  eventType?: string;
  tiers?: Array<Record<string, unknown>>;
  plans?: Array<Record<string, unknown>>;
  tickets?: Array<Record<string, unknown>>;
  failTable?: string;
  refundPolicy?: Record<string, unknown> | null;
}

function clientFor(fixture: Fixture = {}): SupabaseClient {
  const tierRows = fixture.tiers ?? [{
    id: "tier-1",
    name: "General",
    price_cents: 3500000,
    currency: "NGN",
    is_free: false,
    quantity_total: 100,
    is_unlimited: false,
    sale_start_at: null,
    sale_end_at: null,
    available_online: true,
    available_in_person: false,
    allow_transfers: false,
    requires_approval: false,
    is_hidden: false,
    is_disabled: false,
  }];
  const resolve = (table: string, selected: string): Response => {
    if (fixture.failTable === table) {
      return { data: null, error: { message: `${table} failed` } };
    }
    if (table === "brands") {
      return {
        data: fixture.access === false ? [] : [{
          id: BRAND,
          name: "Ari Tests",
          slug: "ari-tests",
          default_currency: "NGN",
          cover_media_url: null,
        }],
        error: null,
      };
    }
    if (table === "brand_team_members") return { data: [], error: null };
    if (table === "events" && selected === "id, brand_id") {
      return { data: { id: EVENT, brand_id: BRAND }, error: null };
    }
    if (table === "events") {
      return {
        data: {
          id: EVENT,
          brand_id: BRAND,
          title: "Sunday Brunch",
          event_type: fixture.eventType ?? "event",
          status: "live",
          refund_policy: fixture.refundPolicy ?? null,
        },
        error: null,
      };
    }
    if (table === "event_dates") {
      return {
        data: {
          start_at: "2026-12-20T12:00:00Z",
          end_at: "2026-12-20T16:00:00Z",
          timezone: "Africa/Lagos",
        },
        error: null,
      };
    }
    if (table === "ticket_types") return { data: tierRows, error: null };
    if (table === "trip_pricing_tiers") {
      return { data: fixture.plans ?? [], error: null };
    }
    if (table === "tickets") {
      return { data: fixture.tickets ?? [], error: null };
    }
    throw new Error(`unhandled table ${table}`);
  };
  return {
    from: (table: string) => new Query(table, resolve),
  } as unknown as SupabaseClient;
}

Deno.test("#4599 get_event_settings returns actual switches, policy and source counts without PII", async () => {
  const result = await readEventSettings(
    { event_id: EVENT },
    clientFor({
      refundPolicy: { kind: "host_terms", window_hours: 48 },
      tiers: [
        {
          id: "tier-1",
          name: "General",
          price_cents: 3500000,
          currency: "NGN",
          is_free: false,
          quantity_total: 100,
          is_unlimited: false,
          available_online: true,
          available_in_person: true,
          allow_transfers: false,
          requires_approval: false,
          is_hidden: false,
          is_disabled: false,
        },
      ],
      tickets: [
        {
          status: "valid",
          orders: { source: "online", payment_status: "paid" },
        },
        {
          status: "used",
          orders: { source: "door_sale", door_payment_method: "cash" },
        },
        { status: "valid", orders: { source: "comp" } },
      ],
    }),
    USER,
  );
  assertEquals(result.refund_policy_set, true);
  assertEquals(result.headcount, {
    capacity_total: 100,
    tickets_held: 3,
    tickets_held_known: true,
    by_source: { online_paid: 1, door: 1, comp: 1 },
    by_source_known: true,
  });
  assertEquals(
    (result.tiers as Array<Record<string, unknown>>)[0].sells_at_door,
    true,
  );
  assert(!JSON.stringify(result).match(/buyer|email|phone|attendee/i));
});

Deno.test("#4599 trip plans, unlimited capacity and capped counts stay explicit", async () => {
  const capped = Array.from({ length: 5000 }, () => ({
    status: "valid",
    orders: { source: "online", payment_status: "paid" },
  }));
  const result = await readEventSettings(
    { event_id: EVENT },
    clientFor({
      eventType: "trip",
      tiers: [{
        id: "tier-1",
        name: "Standard",
        price_cents: 100000,
        currency: "NGN",
        is_free: false,
        quantity_total: null,
        is_unlimited: true,
        available_online: true,
        available_in_person: false,
        allow_transfers: true,
        requires_approval: true,
        is_hidden: false,
        is_disabled: false,
      }],
      plans: [{
        ticket_type_id: "tier-1",
        tier_metadata: { payment_plan: { version: 2, deposit_cents: 25000 } },
      }],
      tickets: capped,
    }),
    USER,
  );
  const tier = (result.tiers as Array<Record<string, unknown>>)[0];
  assertEquals(tier.payment_plan, { version: 2, deposit_cents: 25000 });
  assertEquals(
    (result.headcount as Record<string, unknown>).capacity_total,
    null,
  );
  assertEquals(
    (result.headcount as Record<string, unknown>).tickets_held,
    null,
  );
  assertEquals(
    (result.headcount as Record<string, unknown>).tickets_held_known,
    false,
  );
});

Deno.test("#4599 event settings refuses inaccessible events and fails closed on any sub-read", async () => {
  const denied = await assertRejects(
    () =>
      readEventSettings(
        { event_id: EVENT },
        clientFor({ access: false }),
        USER,
      ),
    ToolError,
  );
  assertEquals((denied as ToolError).code, "BRAND_ACCESS_DENIED");
  const failed = await assertRejects(
    () =>
      readEventSettings(
        { event_id: EVENT },
        clientFor({ failTable: "ticket_types" }),
        USER,
      ),
    ToolError,
  );
  assertEquals((failed as ToolError).code, "READ_FAILED");
  assertEquals(
    (failed as ToolError).user_reason,
    "I couldn't read all of this event's settings safely.",
  );
});

Deno.test("#4599 registration is read-only, finance/event scoped, and list_events is active-brand bound", () => {
  assert(DOMAIN_TOOLS.some((tool) => tool.name === "get_event_settings"));
  assertEquals(AGENT_TOOL_AUTHORIZATION.get_event_settings, {
    requiredRole: "finance_manager",
    resource: "event",
  });
  const source = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assert(
    source.includes(
      '"get_operator_snapshot",\n                  "get_brand_site",\n                  "list_events",\n                  "list_event_orders",',
    ),
  );
  assert(
    source.includes(
      '["list_events", "list_event_orders"].includes(tool.name)',
    ),
  );
});
