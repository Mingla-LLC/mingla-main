// MINGLA-INVARIANT: I-3827-PRIVATE-LINK-CONTROL | issue #3827 | only an authenticated host can operate links, and control-plane responses never expose nonce or hash material
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketLinksHandler,
  type TicketLinksDeps,
  validTicketLinksBody,
} from "../index.ts";

const ACTOR = "123e4567-e89b-42d3-a456-426614174000";
const EVENT = "223e4567-e89b-42d3-a456-426614174000";
const TIER = "323e4567-e89b-42d3-a456-426614174000";
const LINK = "423e4567-e89b-42d3-a456-426614174000";
const SIGNUP = "523e4567-e89b-42d3-a456-426614174000";
const REQUEST = "623e4567-e89b-42d3-a456-426614174000";
const PEPPER = {
  bytes: new Uint8Array(32).fill(11),
  format: "hex" as const,
  fingerprint: "test-only",
};

function request(body: unknown): Request {
  return new Request("https://example.test/functions/v1/ticket-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeDeps(overrides: Partial<TicketLinksDeps> = {}): TicketLinksDeps {
  return {
    actorId: async () => ACTOR,
    rpc: async () => ({ data: null, error: null }),
    pepper: async () => PEPPER,
    qrPepper: () => "qr-pepper",
    dispatch: async () => undefined,
    audit: async () => undefined,
    ...overrides,
  };
}

Deno.test("#3827 host create persists only derived lookup material and returns a share URL", async () => {
  let stored: Record<string, unknown> | null = null;
  const handler = createTicketLinksHandler(makeDeps({
    rpc: async (name, args) => {
      assertEquals(name, "biz_ticket_link_create");
      stored = args;
      return { data: { id: args.p_link_id, label: "VIP" }, error: null };
    },
  }));
  const response = await handler(request({
    op: "create",
    eventId: EVENT,
    ticketTypeId: TIER,
    eventDateId: null,
    label: "VIP",
    maxUses: 25,
    partyMax: 4,
    approvalMode: "auto",
    expiresAt: null,
  }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertMatch(body.link.url, /^https:\/\/host\.usemingla\.com\/g\/[A-Za-z0-9_-]{22}$/);
  assert(stored);
  const persisted = stored as Record<string, unknown>;
  assertMatch(String(persisted.p_token_hash), /^[0-9a-f]{64}$/);
  assertMatch(String(persisted.p_nonce), /^\\x[0-9a-f]{32}$/);
  const serialized = JSON.stringify(body);
  assert(!serialized.includes(String(persisted.p_token_hash)));
  assert(!serialized.includes(String(persisted.p_nonce)));
});

Deno.test("#3827 reset rotates the bearer URL and approval dispatches issued orders", async () => {
  const urls: string[] = [];
  const dispatched: string[] = [];
  const handler = createTicketLinksHandler(makeDeps({
    rpc: async (name, args) => {
      if (name === "biz_ticket_link_reset") return { data: { id: args.p_link_id }, error: null };
      assertEquals(name, "biz_ticket_link_decide");
      return {
        data: { status: "issued", issuedCount: 1, emailQueuedOrderIds: ["723e4567-e89b-42d3-a456-426614174000"] },
        error: null,
      };
    },
    dispatch: async (id) => {
      dispatched.push(id);
    },
  }));
  for (let index = 0; index < 2; index += 1) {
    const response = await handler(request({ op: "reset", linkId: LINK }));
    urls.push((await response.json()).link.url);
  }
  assertNotEquals(urls[0], urls[1]);

  const approval = await handler(request({ op: "decide", signupId: SIGNUP, decision: "approve", clientRequestId: REQUEST }));
  assertEquals(approval.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(dispatched, ["723e4567-e89b-42d3-a456-426614174000"]);
});

Deno.test("#3827 control plane fails closed for auth, unknown RPC errors, and loose payloads", async () => {
  const unauthenticated = createTicketLinksHandler(makeDeps({ actorId: async () => null }));
  const unauth = await unauthenticated(request({ op: "list", eventId: EVENT }));
  assertEquals(unauth.status, 401);

  const unknown = createTicketLinksHandler(makeDeps({
    rpc: async () => ({ data: null, error: { message: "database internals must stay private" } }),
  }));
  const failure = await unknown(request({ op: "list", eventId: EVENT }));
  assertEquals(failure.status, 500);
  assertEquals(await failure.json(), { ok: false, code: "internal" });

  assert(!validTicketLinksBody({ op: "list", eventId: EVENT, extra: true }));
  assert(!validTicketLinksBody({ op: "update", linkId: LINK, patch: { tokenHash: "leak" } }));
  assert(!validTicketLinksBody({ op: "create", eventId: EVENT, ticketTypeId: TIER, label: "x", partyMax: 11, approvalMode: "auto" }));
});
