// #4435 leftovers — INDEPENDENT TESTER adversarial suite for notify-dispatch's
// app-caller gate (appCallerGate.ts). Angles the implementor suite does not
// take: header spellings and padded keys, a "deleted" notice for a group that
// is already gone from someone who was never in it, a pending invitee as the
// recipient, type confusion in every field the gate reads, a sanitized request
// that can never carry the v2 contract or a server idempotency key, and the
// bounded wait never reporting "gone" on a failed read.
// Fails on revert: loosening any rule in appCallerGate.ts fails a case below.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorizeAppCaller,
  isServerCaller,
  SESSION_GONE_POLL_MS,
  SESSION_GONE_WAIT_MS,
  waitForSessionGone,
  type AppCallerDeps,
  type SessionNoticeFacts,
} from "../appCallerGate.ts";

const SERVICE = "test-service-role-key-not-real";
const SENDER = "aaaaaaaa-1111-4111-8111-111111111111";
const RECIPIENT = "bbbbbbbb-2222-4222-8222-222222222222";
const SESSION = "cccccccc-3333-4333-8333-333333333333";
const OTHER_SESSION = "dddddddd-4444-4444-8444-444444444444";

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;
const USER = `Bearer ${jwt({ role: "authenticated", sub: SENDER })}`;

function deps(facts: SessionNoticeFacts | null): AppCallerDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    userIdForToken: () => Promise.resolve(SENDER),
    sessionFacts: (s, from, to) => {
      asked.push(`${s}:${from}:${to}`);
      return Promise.resolve(facts);
    },
  };
}
const body = (type: string, extra: Record<string, unknown> = {}) => ({
  userId: RECIPIENT,
  type,
  title: "t",
  body: "b",
  data: { sessionId: SESSION, deepLink: `mingla://session/${SESSION}` },
  actorId: SENDER,
  relatedId: SESSION,
  relatedType: "session",
  idempotencyKey: `${type}:${SESSION}:1:${RECIPIENT}`,
  pushOverrides: { androidChannelId: "collaboration", collapseId: `board:${SESSION}` },
  ...extra,
});

Deno.test("server caller: only the exact Bearer spelling of the exact key, or a service_role claim", () => {
  assert(isServerCaller(`Bearer ${SERVICE}`, SERVICE));
  for (const header of [
    `bearer ${SERVICE}`, // lower-case scheme
    `Bearer  ${SERVICE}x`, // padded and changed
    `Bearer ${SERVICE.slice(0, -1)}`, // one character short
    `Basic ${SERVICE}`,
    `${SERVICE}`,
    `Bearer ${jwt({ role: "authenticated", service_role: true })}`,
    `Bearer ${jwt({ role: "Service_Role" })}`,
    `Bearer ${jwt({ roles: ["service_role"] })}`,
  ]) {
    assertEquals(isServerCaller(header, SERVICE), false, header);
  }
});

Deno.test("a deleted notice about a group that is already gone still needs a sender who was in it", async () => {
  const d = deps({ session_exists: false, sender_member: false, recipient_member: true });
  const decision = await authorizeAppCaller(USER, body("session_deleted"), d);
  assertEquals(decision, { allowed: false, status: 403, reason: "not_allowed" });
  const d2 = deps({ session_exists: false, sender_member: true, recipient_member: false });
  assertEquals((await authorizeAppCaller(USER, body("session_deleted"), d2)).allowed, false);
});

Deno.test("a pending invitee may receive group notices (the app sends to every participant row)", async () => {
  const decision = await authorizeAppCaller(USER, body("session_member_joined"),
    deps({ session_exists: true, sender_member: true, recipient_member: true }));
  assert(decision.allowed);
});

Deno.test("the membership check is asked about the session the notice names in data, sender from the token", async () => {
  const d = deps({ session_exists: true, sender_member: true, recipient_member: true });
  await authorizeAppCaller(USER, body("board_card_saved", { actorId: RECIPIENT, relatedId: OTHER_SESSION, relatedType: "board_saved_card" }), d);
  assertEquals(d.asked, [`${SESSION}:${SENDER}:${RECIPIENT}`]);
});

Deno.test("type confusion in every field the gate reads is refused before the database is asked", async () => {
  for (const extra of [
    { type: ["board_card_saved"] },
    { type: "BOARD_CARD_SAVED" },
    { type: "board_card_saved " },
    { userId: [RECIPIENT] },
    { userId: RECIPIENT.toUpperCase().replace(/./, "x") },
    { data: { sessionId: [SESSION] }, relatedType: "board_saved_card" },
    { data: { sessionId: `${SESSION} ` }, relatedType: "board_saved_card" },
    { data: null, relatedType: "session", relatedId: 42 },
    { emailTo: ["x@example.test"] },
    { transientPayLinkPush: true },
    { category_key: "buyer_order_cancelled" },
  ]) {
    const d = deps({ session_exists: true, sender_member: true, recipient_member: true });
    const decision = await authorizeAppCaller(USER, body("board_card_saved", extra), d);
    assertEquals(decision.allowed, false, JSON.stringify(extra));
    assertEquals(d.asked.length, 0, `asked the database for ${JSON.stringify(extra)}`);
  }
});

Deno.test("the dispatched request can never carry the v2 contract, email, pay links or a server idempotency key", async () => {
  const decision = await authorizeAppCaller(USER, body("board_card_voted", {
    category_key: "", emailTo: "", transientPayLinkPush: "true", user_id: RECIPIENT, contact: "+15555550100",
    idempotencyKey: "friend_request_received:x:y", channels: ["sms"], smsTo: "+15555550100",
    pushOverrides: { collapseId: 7, androidChannelId: "payments", url: "https://evil.example", iosSound: "x" },
  }), deps({ session_exists: true, sender_member: true, recipient_member: true }));
  assert(decision.allowed);
  if (!decision.allowed) return;
  const keys = Object.keys(decision.payload).sort();
  assertEquals(keys, ["actorId", "body", "data", "idempotencyKey", "pushOverrides", "relatedId", "relatedType", "title", "type", "userId"]);
  assert(String(decision.payload.idempotencyKey).startsWith("app:"));
  assertEquals(decision.payload.pushOverrides, { androidChannelId: "payments" });
  // no idempotency key from the app: a generated one, still in the app namespace
  const gen = await authorizeAppCaller(USER, body("board_card_voted", { idempotencyKey: 12 }),
    deps({ session_exists: true, sender_member: true, recipient_member: true }));
  assert(gen.allowed && String(gen.payload.idempotencyKey).startsWith(`app:board_card_voted:${SESSION}:${RECIPIENT}:`));
});

Deno.test("the wait for a deleted group is bounded at 8 s and a failed read is never 'gone'", async () => {
  assertEquals(SESSION_GONE_WAIT_MS, 8_000);
  let slept = 0;
  const sleep = (ms: number) => { slept += ms; return Promise.resolve(); };
  let n = 0;
  const flaky = () => Promise.resolve(n++ % 2 === 0 ? null : true);
  assertEquals(await waitForSessionGone(flaky, sleep), false);
  assert(slept <= SESSION_GONE_WAIT_MS && slept >= SESSION_GONE_WAIT_MS - SESSION_GONE_POLL_MS, `slept ${slept}`);
});
