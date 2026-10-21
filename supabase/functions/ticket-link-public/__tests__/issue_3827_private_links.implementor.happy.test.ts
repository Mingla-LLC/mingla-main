// MINGLA-INVARIANT: I-3827-PRIVATE-LINK-TOKEN | issue #3827 | private ticket link bearer tokens are domain-separated, never persisted raw, and anonymous signups issue through the governed RPC
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketLinkPublicHandler,
  maskTicketLinkEmail,
  parseTicketLinkPublicBody,
  type TicketLinkPublicDeps,
} from "../index.ts";
import {
  deriveTicketLinkToken,
  hashTicketLinkIp,
  hashTicketLinkToken,
  requestClientIp,
  ticketLinkNonceFromHex,
} from "../../_shared/ticketLinkToken.ts";

const LINK_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";
const NONCE = ticketLinkNonceFromHex("00112233445566778899aabbccddeeff");
const PEPPER = {
  bytes: new Uint8Array(32).fill(7),
  format: "hex" as const,
  fingerprint: "test-only",
};

function request(body: Record<string, unknown>, headers: HeadersInit = {}): Request {
  return new Request("https://example.test/functions/v1/ticket-link-public", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function deps(
  rpc: TicketLinkPublicDeps["rpc"],
  dispatched: string[] = [],
): TicketLinkPublicDeps {
  return {
    rpc,
    pepper: async () => PEPPER,
    qrPepper: () => "qr-pepper",
    dispatch: async (id) => {
      dispatched.push(id);
    },
  };
}

Deno.test("#3827 derives stable 22-character links with separated lookup and IP hashes", async () => {
  const first = await deriveTicketLinkToken(PEPPER, LINK_ID, NONCE);
  const second = await deriveTicketLinkToken(PEPPER, LINK_ID, NONCE);
  assertEquals(first, second);
  assertMatch(first.opaqueToken, /^[A-Za-z0-9_-]{22}$/);
  assertEquals(first.nonceHex, "00112233445566778899aabbccddeeff");
  assertEquals(first.tokenHash, await hashTicketLinkToken(first.opaqueToken, PEPPER.bytes));
  assertNotEquals(first.tokenHash, await hashTicketLinkIp(first.opaqueToken, PEPPER.bytes));
});

Deno.test("#3827 anonymous resolve and signup use hashed lookup data and dispatch every issued order", async () => {
  const token = (await deriveTicketLinkToken(PEPPER, LINK_ID, NONCE)).opaqueToken;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const dispatched: string[] = [];
  const handler = createTicketLinkPublicHandler(deps(async (name, args) => {
    calls.push({ name, args });
    if (name === "pg_venue_order_rate_limit_hit") return { data: { allowed: true }, error: null };
    if (name === "pg_ticket_link_resolve") {
      return { data: { state: "active", kind: "guest_list", event: { title: "Night Market" } }, error: null };
    }
    return {
      data: {
        status: "issued",
        emailQueuedOrderIds: ["323e4567-e89b-42d3-a456-426614174000", "423e4567-e89b-42d3-a456-426614174000"],
        people: [
          { name: "Ada", maskedEmail: "ad***@example.com" },
          { name: "Grace", maskedEmail: "gr***@example.com" },
        ],
      },
      error: null,
    };
  }, dispatched));

  const resolved = await handler(request({ op: "resolve", token }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
  assertEquals(resolved.status, 200);
  assertEquals((await resolved.json()).event.title, "Night Market");
  assertEquals(requestClientIp(new Request("https://example.test", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } })), "203.0.113.9");

  const signup = await handler(request({
    op: "signup",
    token,
    lead: { name: " Ada ", email: "ADA@EXAMPLE.COM", phone: "+12025550111" },
    guests: [{ name: "Grace", email: "grace@example.com", phone: "+12025550112" }],
    eventDateId: null,
    clientRequestId: REQUEST_ID,
    website: "",
  }));
  assertEquals(signup.status, 200);
  assertEquals((await signup.json()).status, "issued");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(dispatched.length, 2);

  const signupCall = calls.find((call) => call.name === "pg_ticket_link_signup");
  assert(signupCall);
  assertEquals(signupCall.args.p_token_hash, await hashTicketLinkToken(token, PEPPER.bytes));
  assertEquals(signupCall.args.p_client_request_id, REQUEST_ID);
  assertEquals(signupCall.args.p_qr_token_pepper, "qr-pepper");
  assertEquals((signupCall.args.p_members as Array<Record<string, unknown>>)[0].email, "ada@example.com");
  assert(!JSON.stringify(calls).includes(token), "raw bearer token never reaches persistence calls");
});

Deno.test("#3827 public payload validation requires every party member's identity and phone", () => {
  const valid = {
    op: "signup",
    token: "a".repeat(22),
    lead: { name: "Ada", email: "ada@example.com", phone: "+12025550111" },
    guests: [],
    eventDateId: null,
    clientRequestId: REQUEST_ID,
    website: "",
  };
  assert(parseTicketLinkPublicBody(valid));
  assertEquals(parseTicketLinkPublicBody({ ...valid, lead: { name: "Ada", email: "ada@example.com" } }), null);
  assertEquals(parseTicketLinkPublicBody({ ...valid, extra: true }), null);
  assertEquals(maskTicketLinkEmail("Ada@Example.com"), "ad***@example.com");
});
