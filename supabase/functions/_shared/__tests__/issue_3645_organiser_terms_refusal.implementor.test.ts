// Issue #3645 — the Organiser Terms refusal on Ari and on Stay publish.
//
// When the database refuses a paid publish with `mingla_tos_not_accepted`:
//   * Ari's write helpers throw one typed, plain refusal that tells the member
//     to accept in the app; it is terminal (never "result unknown"), it maps to
//     an envelope code every installed app already knows, and it is never a
//     success;
//   * manage-stay-inventory answers 409 with the typed code the Host app turns
//     into the acceptance sheet.
// When the database does NOT raise that code, every answer is what it was.
//
// The fakes are plain structural objects: no second supabase-js type graph.
//
// Run:
//   deno test --no-check --allow-env --allow-net --allow-read \
//     supabase/functions/_shared/__tests__/issue_3645_organiser_terms_refusal.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  callRpc,
  invokeFn,
  ORGANISER_TERMS_REQUIRED_CODE,
  ORGANISER_TERMS_REQUIRED_MESSAGE,
  organiserTermsRefusal,
  ToolError,
} from "../agentToolHelpers.ts";
import {
  ARI_ERROR_REGISTRY,
  mapLegacyAriErrorCode,
} from "../agentReliability.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { toolErrorHttpStatus } from "../../agent-confirm-action/index.ts";
import { handleManageStayInventory } from "../../manage-stay-inventory/index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const VENUE = "33333333-3333-4333-8333-333333333333";
const OPERATION = "44444444-4444-4444-8444-444444444444";

// deno-lint-ignore no-explicit-any
type Fake = any;

const rpcClient = (message: string | null, data: unknown = { ok: true }): Fake => ({
  rpc: () =>
    Promise.resolve(
      message === null ? { data, error: null } : { data: null, error: { message } },
    ),
});

async function thrown(run: () => Promise<unknown>): Promise<ToolError> {
  const error = await assertRejects(run);
  assert(error instanceof ToolError, "expected a ToolError");
  return error;
}

Deno.test("#3645 the refusal sentence is plain, short and names no code", () => {
  assert(ORGANISER_TERMS_REQUIRED_MESSAGE.length <= 200);
  assert(!/mingla_tos|_not_accepted|P0001|[A-Z]{2,}_[A-Z]/.test(ORGANISER_TERMS_REQUIRED_MESSAGE));
  assert(/Organiser Terms/.test(ORGANISER_TERMS_REQUIRED_MESSAGE));
  assert(/ask me again/.test(ORGANISER_TERMS_REQUIRED_MESSAGE));
  assert(!/\bpublished\b/i.test(ORGANISER_TERMS_REQUIRED_MESSAGE));
  assert(!/stripe|paystack/i.test(ORGANISER_TERMS_REQUIRED_MESSAGE));
  // The Host app shows the stored reason only when it is `CODE: sentence`.
  const stored = `${ORGANISER_TERMS_REQUIRED_CODE}: ${ORGANISER_TERMS_REQUIRED_MESSAGE}`;
  assertEquals(
    /^[A-Z][A-Z0-9_]*:\s+(\S.*)$/.exec(stored)?.[1],
    ORGANISER_TERMS_REQUIRED_MESSAGE,
  );
});

Deno.test("#3645 organiserTermsRefusal recognises only the terms code", () => {
  assertEquals(organiserTermsRefusal("mingla_tos_not_accepted")?.code, ORGANISER_TERMS_REQUIRED_CODE);
  assertEquals(
    organiserTermsRefusal("ari_execute_event_operation: mingla_tos_not_accepted")?.code,
    ORGANISER_TERMS_REQUIRED_CODE,
  );
  for (const other of ["stripe_charges_disabled", "event_currency_required", "", "tos", null, undefined, 42, {}]) {
    assertEquals(organiserTermsRefusal(other), null);
  }
});

Deno.test("#3645 callRpc: the terms code becomes the typed refusal", async () => {
  const error = await thrown(() =>
    callRpc(rpcClient("mingla_tos_not_accepted"), "ari_execute_event_operation", {})
  );
  assertEquals(error.code, ORGANISER_TERMS_REQUIRED_CODE);
  assertEquals(error.message, ORGANISER_TERMS_REQUIRED_MESSAGE);
});

Deno.test("#3645 callRpc: every other failure and every success is unchanged", async () => {
  for (const message of ["stripe_charges_disabled", "event_currency_required", "offering_date_past", "boom"]) {
    const error = await thrown(() => callRpc(rpcClient(message), "some_rpc", {}));
    assertEquals(error.code, "RPC_FAILED");
    assertEquals(error.message, `some_rpc: ${message}`);
  }
  assertEquals(await callRpc(rpcClient(null, { id: 7 }), "some_rpc", {}), { id: 7 });
});

const invokeClient = (error: unknown, data: unknown = null): Fake => ({
  functions: { invoke: () => Promise.resolve({ data, error }) },
});
const httpError = (status: number, body: unknown) => ({
  message: "Edge Function returned a non-2xx status code",
  context: new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
});

Deno.test("#3645 invokeFn: a 409 carrying the terms code becomes the typed refusal", async () => {
  for (const body of [{ kind: "error", code: "mingla_tos_not_accepted" }, { error: "forbidden", detail: "mingla_tos_not_accepted" }]) {
    const error = await thrown(() =>
      invokeFn(invokeClient(httpError(409, body)), "manage-stay-inventory", {})
    );
    assertEquals(error.code, ORGANISER_TERMS_REQUIRED_CODE);
    assertEquals(error.message, ORGANISER_TERMS_REQUIRED_MESSAGE);
  }
});

Deno.test("#3645 invokeFn: every other failure and every success is unchanged", async () => {
  const cases: unknown[] = [
    httpError(409, { kind: "error", code: "stay_publish_incomplete" }),
    httpError(409, { kind: "error", code: "paid_currency_not_ready", message: "mentions mingla_tos_not_accepted in prose" }),
    httpError(500, "not json"),
    { message: "network down" },
    { message: "no context", context: null },
  ];
  for (const failure of cases) {
    const error = await thrown(() => invokeFn(invokeClient(failure), "manage-stay-inventory", {}));
    assertEquals(error.code, "EDGE_FAILED");
    assertEquals(error.message, `manage-stay-inventory: ${(failure as { message: string }).message}`);
  }
  assertEquals(await invokeFn(invokeClient(null, { kind: "success" }), "x", {}), { kind: "success" });
});

Deno.test("#3645 invokeFn leaves the response body readable for the caller", async () => {
  const failure = httpError(409, { kind: "error", code: "stay_publish_incomplete" });
  await thrown(() => invokeFn(invokeClient(failure), "manage-stay-inventory", {}));
  assertEquals((await failure.context.json()).code, "stay_publish_incomplete");
});

Deno.test("#3645 the refusal is a known, non-retryable conflict on every installed app", () => {
  assertEquals(toolErrorHttpStatus(ORGANISER_TERMS_REQUIRED_CODE), 409);
  const mapped = mapLegacyAriErrorCode(ORGANISER_TERMS_REQUIRED_CODE);
  // Not a new envelope code: installed apps reject a code they do not know.
  assertEquals(mapped, "DOMAIN_ACTION_REFUSED");
  const definition = ARI_ERROR_REGISTRY[mapped];
  assertEquals(definition.httpStatus, 409);
  assertEquals(definition.retryability, "never");
  assertEquals(definition.safeToRetry, false);
  assert(!(ORGANISER_TERMS_REQUIRED_CODE in ARI_ERROR_REGISTRY));
  // And it is not one of the codes confirm treats as "result unknown".
  assert(!["RPC_FAILED", "EDGE_FAILED", "WRITE_FAILED"].includes(ORGANISER_TERMS_REQUIRED_CODE));
});

// Every Ari publish tool, run against a database that refuses with the terms
// code, must throw the typed refusal and must never return a result.
function publishClient(rpcMessage: string | null): Fake {
  // deno-lint-ignore no-explicit-any
  const chain = (result: unknown): any => {
    const self: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "not", "gt", "order", "limit"]) {
      self[method] = () => self;
    }
    self.maybeSingle = () => Promise.resolve({ data: result, error: null });
    self.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
    return self;
  };
  return {
    from: (table: string) =>
      chain(table === "events" ? { id: EVENT, brand_id: BRAND } : null),
    rpc: (name: string) => {
      if (name === "pg_brand_can_collect") return Promise.resolve({ data: true, error: null });
      return Promise.resolve(
        rpcMessage === null
          ? { data: { status: "scheduled" }, error: null }
          : { data: null, error: { message: rpcMessage } },
      );
    },
    functions: {
      invoke: () =>
        Promise.resolve(
          rpcMessage === null
            ? { data: { kind: "success" }, error: null }
            : { data: null, error: httpError(409, { kind: "error", code: rpcMessage }) },
        ),
    },
  };
}

const PUBLISH_TOOLS: Record<string, Record<string, unknown>> = {
  publish_event: { event_id: EVENT, brand_id: BRAND },
  publish_trip: { event_id: EVENT, brand_id: BRAND },
  publish_experience: { event_id: EVENT, expected_revision: "2026-10-13T00:00:00Z" },
  publish_rsvp: { event_id: EVENT, brand_id: BRAND },
  publish_stay: { brand_id: BRAND, venue_id: VENUE, expected_version: 1 },
};

for (const [name, args] of Object.entries(PUBLISH_TOOLS)) {
  Deno.test(`#3645 Ari ${name}: a terms refusal is the typed refusal, never a result`, async () => {
    const tool = DOMAIN_TOOLS.find((candidate) => candidate.name === name);
    assert(tool, `${name} is not a registered Ari tool`);
    let returned: unknown = "nothing";
    const error = await thrown(async () => {
      returned = await tool.executor(args, publishClient("mingla_tos_not_accepted"), "user", {
        operationId: OPERATION,
      });
    });
    assertEquals(returned, "nothing", `${name} returned a result for a refused publish`);
    assertEquals(error.code, ORGANISER_TERMS_REQUIRED_CODE);
    assertEquals(error.message, ORGANISER_TERMS_REQUIRED_MESSAGE);
  });
}

async function stayPublish(rpcError: { message?: string; code?: string } | null) {
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
  const response = await handleManageStayInventory(
    new Request("http://local/manage-stay-inventory", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ action: "publish_stay", venueId: VENUE, expectedVersion: 3 }),
    }),
    {
      createRpcClient: () => ({
        rpc: () => Promise.resolve({ data: rpcError ? null : { inventory: {} }, error: rpcError }),
      }),
    },
  );
  return { status: response.status, body: await response.json() };
}

Deno.test("#3645 manage-stay-inventory: the terms refusal is a typed 409", async () => {
  const { status, body } = await stayPublish({ message: "mingla_tos_not_accepted", code: "P0001" });
  assertEquals(status, 409);
  assertEquals(body.kind, "error");
  assertEquals(body.code, "mingla_tos_not_accepted");
  assertEquals(body.message, "Accept the Organiser Terms to publish this Stay.");
});

Deno.test("#3645 manage-stay-inventory: every other answer is what it was", async () => {
  const expected: Array<[string, number, string, string]> = [
    ["stay_publish_incomplete", 409, "stay_publish_incomplete", "stay publish incomplete"],
    ["paid_currency_not_ready", 409, "paid_currency_not_ready", "paid currency not ready"],
    ["stay_venue_not_approved", 409, "stay_venue_not_approved", "stay venue not approved"],
    ["stay_version_conflict", 409, "stay_version_conflict", "stay version conflict"],
    ["forbidden", 403, "forbidden", "forbidden"],
    ["stay_venue_not_found", 404, "stay_venue_not_found", "stay venue not found"],
    ["stay_currency_required", 422, "stay_currency_required", "stay currency required"],
    ["something nobody mapped", 500, "internal_error", "We couldn’t update this Stay. Try again."],
  ];
  for (const [raw, status, code, message] of expected) {
    const answer = await stayPublish({ message: raw });
    assertEquals(answer.status, status, raw);
    assertEquals(answer.body.code, code, raw);
    assertEquals(answer.body.message, message, raw);
  }
  const ok = await stayPublish(null);
  assertEquals(ok.status, 200);
  assertEquals(ok.body.kind, "success");
});
