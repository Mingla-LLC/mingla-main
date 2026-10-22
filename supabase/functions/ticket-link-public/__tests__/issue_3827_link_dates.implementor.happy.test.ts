// MINGLA-INVARIANT: I-3827-LINK-DATE-SET-RPC | issue #3827 | a guest-list sign-up that names a set of dates goes to pg_ticket_link_signup_days; a sign-up without one keeps the single-date RPC and arguments
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketLinkPublicHandler,
  parseTicketLinkPublicBody,
  signupDateIds,
  type TicketLinkPublicDeps,
} from "../index.ts";
import { deriveTicketLinkToken, ticketLinkNonceFromHex } from "../../_shared/ticketLinkToken.ts";

const LINK_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";
const DAY_ONE = "323e4567-e89b-42d3-a456-426614174001";
const DAY_TWO = "423e4567-e89b-42d3-a456-426614174002";
const PEPPER = { bytes: new Uint8Array(32).fill(7), format: "hex" as const, fingerprint: "test-only" };

const request = (body: Record<string, unknown>) =>
  new Request("https://example.test/functions/v1/ticket-link-public", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function harness() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: TicketLinkPublicDeps = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "pg_venue_order_rate_limit_hit") return { data: { allowed: true }, error: null };
      if (name === "pg_ticket_link_resolve") {
        return {
          data: {
            state: "active",
            kind: "guest_list",
            event: {
              title: "Two nights",
              coverUrl: "https://cdn.example/guid/play_720p.mp4",
              coverMediaType: "video",
              coverPosterUrl: "https://cdn.example/guid/thumbnail.jpg",
            },
          },
          error: null,
        };
      }
      return { data: { status: "issued", emailQueuedOrderIds: [], people: [] }, error: null };
    },
    pepper: async () => PEPPER,
    qrPepper: () => "qr-pepper",
    dispatch: async () => {},
  };
  return { calls, handler: createTicketLinkPublicHandler(deps) };
}

const base = (token: string) => ({
  op: "signup",
  token,
  lead: { name: "Ada", email: "ada@example.com", phone: "+12025550111" },
  guests: [],
  clientRequestId: REQUEST_ID,
  website: "",
});

Deno.test("#3827 a set of dates goes to the per-date RPC with every date", async () => {
  const token = (await deriveTicketLinkToken(PEPPER, LINK_ID, ticketLinkNonceFromHex("00112233445566778899aabbccddeeff"))).opaqueToken;
  const { calls, handler } = harness();
  const response = await handler(request({ ...base(token), eventDateId: null, eventDateIds: [DAY_ONE, DAY_TWO] }));
  assertEquals(response.status, 200);
  const call = calls.find((c) => c.name === "pg_ticket_link_signup_days");
  assert(call, "the per-date RPC was called");
  assertEquals(call.args.p_event_date_ids, [DAY_ONE, DAY_TWO]);
  assert(!calls.some((c) => c.name === "pg_ticket_link_signup"), "the single-date RPC was not called");
});

Deno.test("#3827 a sign-up without a date set keeps the single-date RPC", async () => {
  const token = (await deriveTicketLinkToken(PEPPER, LINK_ID, ticketLinkNonceFromHex("00112233445566778899aabbccddeeff"))).opaqueToken;
  const { calls, handler } = harness();
  await handler(request({ ...base(token), eventDateId: DAY_ONE }));
  const call = calls.find((c) => c.name === "pg_ticket_link_signup");
  assert(call);
  assertEquals(call.args.p_event_date_id, DAY_ONE);
  assert(!("p_event_date_ids" in call.args));
});

Deno.test("#3827 preview uses a video cover's poster, never the video file", async () => {
  const token = (await deriveTicketLinkToken(PEPPER, LINK_ID, ticketLinkNonceFromHex("00112233445566778899aabbccddeeff"))).opaqueToken;
  const { handler } = harness();
  const preview = await (await handler(request({ op: "preview", token }))).json();
  assertEquals(preview.ogImageUrl, "https://cdn.example/guid/thumbnail.jpg");
  const resolved = await (await handler(request({ op: "resolve", token }))).json();
  assertEquals(resolved.event.coverMediaType, "video");
  assertEquals(resolved.event.coverPosterUrl, "https://cdn.example/guid/thumbnail.jpg");
});

Deno.test("#3827 hostile date sets are refused before any database call", () => {
  const token = "a".repeat(22);
  assertEquals(parseTicketLinkPublicBody({ ...base(token), eventDateIds: [DAY_ONE, DAY_ONE] }), null);
  assertEquals(parseTicketLinkPublicBody({ ...base(token), eventDateIds: ["not-a-uuid"] }), null);
  assertEquals(parseTicketLinkPublicBody({ ...base(token), eventDateIds: DAY_ONE }), null);
  assertEquals(
    parseTicketLinkPublicBody({ ...base(token), eventDateIds: Array.from({ length: 61 }, () => crypto.randomUUID()) }),
    null,
  );
  assert(parseTicketLinkPublicBody({ ...base(token), eventDateIds: [] }));
  assertEquals(signupDateIds({ eventDateIds: [DAY_ONE], eventDateId: DAY_TWO }), [DAY_ONE, DAY_TWO]);
  assertEquals(signupDateIds({ eventDateIds: [DAY_ONE], eventDateId: DAY_ONE }), [DAY_ONE]);
});
