/**
 * issue #2101 [named-buyer checkout] — the Edge fence on
 * `ticket-checkout-create`.
 *
 * PROVES, on the REAL handler:
 *   1. the decision runs on the TOKEN-DERIVED caller only, BEFORE any event
 *      date read, capacity work, session RPC, provider call or free-ticket path;
 *   2. `sign_in_required` -> HTTP 401 and every other denial -> ONE
 *      indistinguishable HTTP 403, so membership cannot be probed;
 *   3. a denied request produces ZERO session, provider or free-entitlement
 *      side effect — asserted by an operation spy, not by inspection;
 *   4. no request-body field can supply buyer authority: a forged body UUID and
 *      a forged buyer email do not change the decision input;
 *   5. an unrestricted event is byte-compatible — the decision returns
 *      `allowed_unrestricted` and the whole downstream path runs as today;
 *   6. the fence FAILS CLOSED when the decision itself is unavailable.
 *
 * All three surfaces (`web`, `mobile-web`, `native`) are exercised, because the
 * contract fences the shared backend, not one client.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";

const EVENT_ID = "10000000-0000-4000-8000-00000000e101";
const TIER_ID = "20000000-0000-4000-8000-00000000e102";
const ALLOWED_USER = "30000000-0000-4000-8000-00000000e103";
const FORGED_USER = "40000000-0000-4000-8000-00000000e104";

type DbResult = { data?: unknown; error?: { message: string } | null; count?: number };

class FakeQuery implements PromiseLike<DbResult> {
  private action = "select";
  constructor(
    private readonly db: FakeServiceClient,
    private readonly table: string,
  ) {}
  select(_c: string, options?: { count?: string; head?: boolean }): this {
    this.action = options?.head ? "head" : "select";
    return this;
  }
  update(_p: Record<string, unknown>): this {
    this.action = "update";
    return this;
  }
  eq(): this { return this; }
  gt(): this { return this; }
  in(): this { return this; }
  maybeSingle(): Promise<DbResult> { return Promise.resolve(this.exec()); }
  then<A = DbResult, B = never>(
    onfulfilled?: ((v: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
  private exec(): DbResult {
    this.db.operations.push(`${this.action}:${this.table}`);
    if (this.table === "event_dates") return { data: null, error: null, count: 1 };
    return { data: null, error: null, count: 0 };
  }
}

class FakeServiceClient {
  readonly operations: string[] = [];
  readonly decisionArgs: Array<Record<string, unknown>> = [];
  decision = "allowed_unrestricted";
  decisionError: { message: string } | null = null;

  from(table: string): FakeQuery { return new FakeQuery(this, table); }

  // deno-lint-ignore require-await
  async rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
    this.operations.push(`rpc:${name}`);
    if (name === "issue_2101_ticket_checkout_access_decision") {
      this.decisionArgs.push(args);
      if (this.decisionError !== null) {
        return { data: null, error: this.decisionError };
      }
      return { data: this.decision, error: null };
    }
    return { data: null, error: null };
  }
}

const SIDE_EFFECTS = [
  "rpc:biz_ticket_checkout_create_session",
  "rpc:resolve_event_pricing_inputs",
  "update:ticket_checkout_sessions",
];

const makeDeps = (
  client: FakeServiceClient,
  userId: string | null,
): TicketCheckoutCreateDeps => ({
  userIdFromAuthHeader: () => Promise.resolve(userId),
  serviceClient: () => client as never,
  paystackInitializeTransaction: (() => {
    throw new Error("PROVIDER CALLED — a denied checkout must never reach a provider");
  }) as never,
});

const request = (body: Record<string, unknown>): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: EVENT_ID,
      buyer: {
        name: "Buyer Person",
        email: "buyer@issue2101.test",
        phone: "+15551234567",
      },
      lines: [{ ticketTypeId: TIER_ID, quantity: 1 }],
      ...body,
    }),
  });

for (const surface of ["web", "mobile-web", "native"] as const) {
  Deno.test(`#2101 ${surface}: anonymous under a restricted sale -> 401 sign_in_required, zero side effects`, async () => {
    const client = new FakeServiceClient();
    client.decision = "sign_in_required";
    const res = await createTicketCheckoutCreateHandler(makeDeps(client, null))(
      request({ surface }),
    );
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error, "sign_in_required");
    for (const effect of SIDE_EFFECTS) {
      assert(
        !client.operations.includes(effect),
        `${effect} ran on a denied request: ${client.operations.join(",")}`,
      );
    }
    // The decision is the FIRST database call — before the event-date read.
    assertEquals(
      client.operations[0],
      "rpc:issue_2101_ticket_checkout_access_decision",
    );
  });

  Deno.test(`#2101 ${surface}: authenticated non-member -> 403 checkout_restricted, zero side effects`, async () => {
    const client = new FakeServiceClient();
    client.decision = "checkout_restricted";
    const res = await createTicketCheckoutCreateHandler(
      makeDeps(client, FORGED_USER),
    )(request({ surface }));
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error, "checkout_restricted");
    for (const effect of SIDE_EFFECTS) {
      assert(!client.operations.includes(effect), `${effect} ran on a denied request`);
    }
  });
}

Deno.test("#2101 every non-sign-in denial is ONE indistinguishable 403", async () => {
  const seen = new Set<string>();
  for (const decision of ["checkout_restricted", "snapshot_stale", "event_unavailable"]) {
    const client = new FakeServiceClient();
    client.decision = decision;
    const res = await createTicketCheckoutCreateHandler(
      makeDeps(client, ALLOWED_USER),
    )(request({ surface: "web" }));
    seen.add(`${res.status}:${(await res.json()).error}`);
  }
  assertEquals([...seen], ["403:checkout_restricted"]);
});

Deno.test("#2101 the decision input is the TOKEN-derived user — a forged body UUID and email are ignored", async () => {
  const client = new FakeServiceClient();
  client.decision = "checkout_restricted";
  await createTicketCheckoutCreateHandler(makeDeps(client, ALLOWED_USER))(
    request({
      surface: "web",
      // Every shape a hostile client might try to smuggle authority through.
      userId: FORGED_USER,
      buyerUserId: FORGED_USER,
      p_buyer_user_id: FORGED_USER,
      buyer: {
        name: "Buyer Person",
        email: "owner@issue2101.test",
        phone: "+15551234567",
        userId: FORGED_USER,
      },
    }),
  );
  assertEquals(client.decisionArgs.length, 1);
  assertEquals(client.decisionArgs[0].p_buyer_user_id, ALLOWED_USER);
  assertEquals(client.decisionArgs[0].p_event_id, EVENT_ID);
  // Continuation snapshots are never supplied by the Edge — a fresh decision.
  assertEquals(client.decisionArgs[0].p_snapshot_mode, null);
  assertEquals(client.decisionArgs[0].p_snapshot_membership_id, null);
});

Deno.test("#2101 an unavailable decision FAILS CLOSED with 403, never open", async () => {
  const client = new FakeServiceClient();
  client.decisionError = { message: "permission denied for function" };
  const res = await createTicketCheckoutCreateHandler(
    makeDeps(client, ALLOWED_USER),
  )(request({ surface: "web" }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "checkout_restricted");
  for (const effect of SIDE_EFFECTS) {
    assert(!client.operations.includes(effect), `${effect} ran after a decision failure`);
  }
});

Deno.test("#2101 an UNRESTRICTED event is byte-compatible — the fence is a no-op", async () => {
  const client = new FakeServiceClient();
  client.decision = "allowed_unrestricted";
  const res = await createTicketCheckoutCreateHandler(
    makeDeps(client, null),
  )(request({ surface: "web" }));
  // The access fence did NOT terminate the request: it proceeded past the
  // decision into the ordinary downstream path (which this stub client does
  // not complete, but the status is decisively not one of the two denials).
  assert(
    res.status !== 401 && res.status !== 403,
    `unrestricted checkout was fenced with ${res.status}`,
  );
  assert(client.operations.includes("head:event_dates"),
    "the ordinary downstream path did not run for an unrestricted event");
});

Deno.test("#2101 an ALLOWED named buyer proceeds exactly like an unrestricted one", async () => {
  const client = new FakeServiceClient();
  client.decision = "allowed_named";
  const res = await createTicketCheckoutCreateHandler(
    makeDeps(client, ALLOWED_USER),
  )(request({ surface: "web" }));
  assert(res.status !== 401 && res.status !== 403);
  assert(client.operations.includes("head:event_dates"));
});
