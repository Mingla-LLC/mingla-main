// #4435: notify-dispatch sends what each caller is allowed to send.
// Server callers keep every option; a signed-in app sends only its group
// notices, to people in that group; a "deleted" notice waits for the group to
// be gone. FAILS-ON-REVERT: removing the gate from index.ts fails the wiring
// test; loosening any rule in appCallerGate.ts fails its case below.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APP_SESSION_NOTICE_TYPES,
  authorizeAppCaller,
  isServerCaller,
  jwtRole,
  waitForSessionGone,
  type AppCallerDeps,
  type SessionNoticeFacts,
} from "../appCallerGate.ts";

const SERVICE = "test-service-role-key-not-real";
const SENDER = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.sig`;
}
const USER_TOKEN = jwt({ role: "authenticated", sub: SENDER });

function deps(facts: SessionNoticeFacts | null, user: string | null = SENDER): AppCallerDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    userIdForToken: (token) => {
      calls.push(`user:${token === USER_TOKEN}`);
      return Promise.resolve(user);
    },
    sessionFacts: (sessionId, senderId, recipientId) => {
      calls.push(`facts:${sessionId}:${senderId}:${recipientId}`);
      return Promise.resolve(facts);
    },
  };
}
const MEMBERS: SessionNoticeFacts = { session_exists: true, sender_member: true, recipient_member: true };

// The exact body the Explorer app sends (boardNotificationService.notifyUsers, 1.1.0 onwards).
function appBody(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    userId: RECIPIENT,
    type,
    title: "Ada saved a spot",
    body: "\"Cafe\" was added to Crew",
    data: { deepLink: `mingla://session/${SESSION}`, sessionId: SESSION, senderName: "Ada" },
    actorId: SENDER,
    relatedId: SESSION,
    relatedType: "session",
    idempotencyKey: `${type}:${SESSION}:1:${RECIPIENT}`,
    pushOverrides: { androidChannelId: "collaboration", collapseId: `board:${SESSION}` },
    ...extra,
  };
}

Deno.test("server callers: the exact key, or a service-role JWT (the database's copy)", () => {
  assert(isServerCaller(`Bearer ${SERVICE}`, SERVICE));
  assert(isServerCaller(`Bearer ${jwt({ role: "service_role" })}`, SERVICE));
  assert(!isServerCaller(`Bearer ${USER_TOKEN}`, SERVICE));
  assert(!isServerCaller(`Bearer ${jwt({ role: "anon" })}`, SERVICE));
  assert(!isServerCaller("Bearer not-a-jwt", SERVICE));
  assert(!isServerCaller(null, SERVICE));
  assert(!isServerCaller(`Bearer ${SERVICE}`, ""));
  assertEquals(jwtRole("a.b"), null);
  assertEquals(jwtRole(`x.${b64url({ role: 5 })}.y`), null);
});

Deno.test("every notice type the app sends is allowed for members, unchanged in content", async () => {
  assertEquals([...APP_SESSION_NOTICE_TYPES].sort(), [
    "board_card_rsvp", "board_card_saved", "board_card_voted",
    "session_deleted", "session_member_joined", "session_member_left",
  ]);
  for (const type of APP_SESSION_NOTICE_TYPES) {
    const d = deps(MEMBERS);
    const decision = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody(type), d);
    assert(decision.allowed, type);
    if (!decision.allowed) continue;
    assertEquals(decision.senderId, SENDER);
    assertEquals(decision.payload.userId, RECIPIENT);
    assertEquals(decision.payload.title, "Ada saved a spot");
    assertEquals((decision.payload.data as Record<string, unknown>).sessionId, SESSION);
    assertEquals(decision.payload.idempotencyKey, `app:${type}:${SESSION}:1:${RECIPIENT}`);
    assertEquals(decision.waitForSessionGone, type === "session_deleted");
    assertEquals(d.calls, ["user:true", `facts:${SESSION}:${SENDER}:${RECIPIENT}`]);
  }
});

Deno.test("an app request loses every server-only option", async () => {
  const decision = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody("board_card_saved", {
    brandId: "b", deepLink: "https://evil.example", quietHoursRetry: true, skipPush: false,
    expiresAt: "2030-01-01", emailVariant: "generic_notification", emailCta: { label: "x", url: "y" },
    oneSignalIdempotencyKey: "k",
    pushOverrides: { collapseId: "c", buttons: [{ id: "b" }], threadId: "t" },
  }), deps(MEMBERS));
  assert(decision.allowed);
  if (!decision.allowed) return;
  for (const key of ["brandId", "deepLink", "quietHoursRetry", "expiresAt", "emailVariant", "emailCta", "oneSignalIdempotencyKey"]) {
    assertEquals(key in decision.payload, false, key);
  }
  assertEquals(decision.payload.pushOverrides, { collapseId: "c" });
});

Deno.test("refused: no token, an unknown user, the v2 contract, other types, email and pay links", async () => {
  const body = appBody("board_card_saved");
  assertEquals(await authorizeAppCaller(null, body, deps(MEMBERS)), { allowed: false, status: 401, reason: "unauthorized" });
  assertEquals(await authorizeAppCaller(`Bearer ${USER_TOKEN}`, body, deps(MEMBERS, null)), { allowed: false, status: 401, reason: "unauthorized" });
  const v2 = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, { category_key: "buyer_order_cancelled", user_id: RECIPIENT, contact: "+15555550100" }, deps(MEMBERS));
  assertEquals(v2.allowed, false);
  for (const type of ["direct_message_received", "business.order_paid", "friend_request_received", "installment_pay_link", "referral_credited"]) {
    const decision = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody(type), deps(MEMBERS));
    assertEquals(decision.allowed, false, type);
  }
  assertEquals((await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody("board_card_saved", { emailTo: "x@example.test" }), deps(MEMBERS))).allowed, false);
  assertEquals((await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody("board_card_saved", { transientPayLinkPush: true }), deps(MEMBERS))).allowed, false);
});

Deno.test("refused: a recipient or session that is not a well-formed id, or the sender themself", async () => {
  for (const extra of [
    { userId: "not-a-uuid" },
    { userId: SENDER },
    { data: { sessionId: "nope" }, relatedType: "board_saved_card" },
    { data: {}, relatedType: "board_saved_card", relatedId: SESSION },
  ]) {
    const d = deps(MEMBERS);
    const decision = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody("board_card_saved", extra), d);
    assertEquals(decision.allowed, false, JSON.stringify(extra));
  }
  // the session id may come from relatedId when it is a session
  const viaRelated = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody("session_member_left", { data: {} }), deps(MEMBERS));
  assert(viaRelated.allowed);
});

Deno.test("refused unless the sender is an accepted member and the recipient is in the group", async () => {
  const body = appBody("board_card_saved");
  for (const facts of [
    { session_exists: true, sender_member: false, recipient_member: true },
    { session_exists: true, sender_member: true, recipient_member: false },
    { session_exists: false, sender_member: true, recipient_member: true },
  ]) {
    const decision = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, body, deps(facts));
    assertEquals(decision, { allowed: false, status: 403, reason: "not_allowed" }, JSON.stringify(facts));
  }
  assertEquals(await authorizeAppCaller(`Bearer ${USER_TOKEN}`, body, deps(null)), { allowed: false, status: 503, reason: "check_unavailable" });
});

Deno.test("a deleted notice: sent at once when the group is gone, held when it still exists", async () => {
  const gone = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody("session_deleted"),
    deps({ session_exists: false, sender_member: true, recipient_member: true }));
  assert(gone.allowed && gone.waitForSessionGone === false);
  const still = await authorizeAppCaller(`Bearer ${USER_TOKEN}`, appBody("session_deleted"), deps(MEMBERS));
  assert(still.allowed && still.waitForSessionGone === true);
});

Deno.test("waiting for the group: true once it is gone, false if it stays, polls bounded", async () => {
  const slept: number[] = [];
  const sleep = (ms: number) => { slept.push(ms); return Promise.resolve(); };
  let checks = 0;
  assertEquals(await waitForSessionGone(() => Promise.resolve(++checks < 2), sleep), true);
  assertEquals(checks, 2);
  slept.length = 0;
  assertEquals(await waitForSessionGone(() => Promise.resolve(true), sleep), false);
  assertEquals(slept, [2000, 2000, 2000, 2000]);
  slept.length = 0;
  assertEquals(await waitForSessionGone(() => Promise.resolve(null), sleep), false);
  assertEquals(slept.length, 4);
});

Deno.test("index.ts runs the gate before anything else and keeps server callers on the old path", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const gate = source.indexOf("if (!isServerCaller(authHeader, SUPABASE_SERVICE_ROLE_KEY))");
  const v2 = source.indexOf("payload.category_key.length > 0");
  const legacy = source.indexOf("const {\n      userId,");
  assert(gate > 0 && gate < v2 && gate < legacy, "the gate runs before the v2 and legacy branches");
  assert(source.includes("payload = decision.payload;"), "an app request is dispatched in its sanitized form");
  assert(source.includes('"issue_4435_session_notice_check"'));
  assert(source.includes("waitForSessionGone("));
  assert(source.includes("Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`"), "a held notice is re-sent as a server notice");
});
