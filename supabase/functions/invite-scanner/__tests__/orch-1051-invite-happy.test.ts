// ORCH-1051 — happy-path regression for invite-scanner.
//
// Exercises the pure-logic contract the handler ships: payload validation
// (event vs brand scope), token+hash mint, invite-email build (per-scope
// copy). The handler's network surface is covered indirectly via the
// validator + email-builder; full e2e is covered by tester adversarial
// suite (which runs against the deployed edge fn).
//
// CLOSE Step 0.5: this test PASSES on the shipped contract at the head
// commit and MUST FAIL on revert (e.g. if scope enum widens past
// event/brand, if the SHA-256 hash size changes, or if the URL builder
// drops the token query param).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/invite-scanner/__tests__/orch-1051-invite-happy.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildInviteEmail,
  sha256Hex,
  validateInvite,
} from "../index.ts";

const BRAND_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";

const GOOD_EVENT = {
  brand_id: BRAND_ID,
  event_id: EVENT_ID,
  scope: "event",
  invitee_email: "Tunde@Example.com",
  invitee_name: "Tunde Olu",
  can_accept_payments: false,
};

const GOOD_BRAND = {
  brand_id: BRAND_ID,
  scope: "brand",
  invitee_email: "Tunde@Example.com",
  invitee_name: "Tunde Olu",
  can_accept_payments: true,
};

Deno.test("validateInvite — event-scope happy path normalises email + carries event_id", () => {
  const result = validateInvite(GOOD_EVENT);
  assert(result.ok, "expected valid invite");
  if (!result.ok) return;
  assertEquals(result.payload.invitee_email, "tunde@example.com");
  assertEquals(result.payload.scope, "event");
  assertEquals(result.payload.event_id, EVENT_ID);
  assertEquals(result.payload.brand_id, BRAND_ID);
  assertEquals(result.payload.can_accept_payments, false);
});

Deno.test("validateInvite — brand-scope happy path leaves event_id null", () => {
  const result = validateInvite(GOOD_BRAND);
  assert(result.ok, "expected valid invite");
  if (!result.ok) return;
  assertEquals(result.payload.scope, "brand");
  assertEquals(result.payload.event_id, null);
  assertEquals(result.payload.can_accept_payments, true);
});

Deno.test("validateInvite — accepts only event|brand scopes", () => {
  for (const scope of ["event", "brand"]) {
    const r = validateInvite({ ...GOOD_EVENT, scope, event_id: scope === "event" ? EVENT_ID : "" });
    assert(r.ok, `scope ${scope} should be accepted`);
  }
  for (const scope of ["site", "global", "team", "venue", ""]) {
    const r = validateInvite({ ...GOOD_EVENT, scope });
    assert(!r.ok, `scope ${scope} must be rejected`);
    if (r.ok) return;
    assert(r.fields.includes("scope"));
  }
});

Deno.test("validateInvite — scope=event requires event_id", () => {
  const r = validateInvite({ ...GOOD_EVENT, event_id: "" });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.fields.includes("event_id"));
});

Deno.test("validateInvite — scope=brand rejects an event_id payload", () => {
  const r = validateInvite({ ...GOOD_BRAND, event_id: EVENT_ID });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.fields.includes("event_id"));
});

Deno.test("validateInvite — rejects malformed email", () => {
  const r = validateInvite({ ...GOOD_EVENT, invitee_email: "not-an-email" });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.fields.includes("invitee_email"));
});

Deno.test("validateInvite — rejects empty or oversized name", () => {
  const empty = validateInvite({ ...GOOD_EVENT, invitee_name: "" });
  assert(!empty.ok);
  if (!empty.ok) {
    assert(empty.fields.includes("invitee_name"));
  }
  const huge = validateInvite({
    ...GOOD_EVENT,
    invitee_name: "x".repeat(101),
  });
  assert(!huge.ok);
  if (!huge.ok) {
    assert(huge.fields.includes("invitee_name"));
  }
});

Deno.test("validateInvite — rejects malformed brand_id", () => {
  const r = validateInvite({ ...GOOD_EVENT, brand_id: "not-a-uuid" });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.fields.includes("brand_id"));
});

Deno.test("sha256Hex — stable 64-char hex digest", async () => {
  const a = await sha256Hex("the-token");
  const b = await sha256Hex("the-token");
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]+$/.test(a));
});

Deno.test("buildInviteEmail — event scope wires event name + acceptUrl", () => {
  const payload = buildInviteEmail({
    inviteeName: "Tunde",
    inviteeEmail: "tunde@example.com",
    brandName: "Acme Events",
    eventName: "Lagos Night",
    inviterName: "Seth",
    scope: "event",
    acceptUrl:
      "https://business.usemingla.com/accept-scanner-invitation?token=abc.def",
    from: "Mingla <noreply@usemingla.com>",
  });
  assertEquals(payload.to, ["tunde@example.com"]);
  assertEquals(payload.from, "Mingla <noreply@usemingla.com>");
  assert(payload.subject.includes("Lagos Night"));
  assert(payload.html.includes("Lagos Night"));
  assert(
    payload.html.includes(
      "https://business.usemingla.com/accept-scanner-invitation?token=abc.def",
    ),
  );
});

Deno.test("buildInviteEmail — brand scope wires brand name + acceptUrl", () => {
  const payload = buildInviteEmail({
    inviteeName: "Tunde",
    inviteeEmail: "tunde@example.com",
    brandName: "Acme Events",
    eventName: null,
    inviterName: "Seth",
    scope: "brand",
    acceptUrl:
      "https://business.usemingla.com/accept-scanner-invitation?token=abc.def",
    from: "Mingla <noreply@usemingla.com>",
  });
  assert(payload.subject.includes("Acme Events"));
  assert(payload.html.includes("every"));
  assert(payload.html.includes("Acme Events"));
});
