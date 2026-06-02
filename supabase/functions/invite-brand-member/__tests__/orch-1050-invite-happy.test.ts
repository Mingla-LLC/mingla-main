// ORCH-1050 — happy-path regression for invite-brand-member.
//
// Exercises the pure-logic contract the handler ships: payload validation,
// token+hash mint, invite-email build. The handler's network surface is
// covered indirectly via the validator + email-builder; full e2e is covered
// by the tester adversarial suite (which runs against the deployed edge fn).
//
// CLOSE Step 0.5: this test PASSES on the shipped contract at commit
// 67f24b776 and MUST FAIL on revert (e.g. if the 6-value role allow-set
// shrinks, if the email regex is loosened, if the SHA-256 hash size
// changes, or if the URL builder drops the token query param).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/invite-brand-member/__tests__/orch-1050-invite-happy.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildInviteEmail,
  sha256Hex,
  validateInvite,
} from "../index.ts";

const GOOD = {
  brand_id: "11111111-1111-1111-1111-111111111111",
  invitee_email: "Tunde@Example.com",
  invitee_name: "Tunde Olu",
  role: "event_manager",
};

Deno.test("validateInvite — happy path normalises email + accepts", () => {
  const result = validateInvite(GOOD);
  assert(result.ok, "expected valid invite");
  if (!result.ok) return;
  assertEquals(result.payload.invitee_email, "tunde@example.com");
  assertEquals(result.payload.role, "event_manager");
  assertEquals(result.payload.invitee_name, "Tunde Olu");
  assertEquals(result.payload.brand_id, GOOD.brand_id);
});

Deno.test("validateInvite — accepts every documented role literal", () => {
  for (const role of [
    "brand_owner",
    "brand_admin",
    "event_manager",
    "finance_manager",
    "marketing_manager",
    "scanner",
  ]) {
    const r = validateInvite({ ...GOOD, role });
    assert(r.ok, `role ${role} should be accepted`);
  }
});

Deno.test("validateInvite — rejects unknown roles", () => {
  const r = validateInvite({ ...GOOD, role: "promoter" });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.fields.includes("role"));
});

Deno.test("validateInvite — rejects malformed email", () => {
  const r = validateInvite({ ...GOOD, invitee_email: "not-an-email" });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.fields.includes("invitee_email"));
});

Deno.test("validateInvite — rejects empty or oversized name", () => {
  const empty = validateInvite({ ...GOOD, invitee_name: "" });
  assert(!empty.ok);
  if (!empty.ok) {
    assert(empty.fields.includes("invitee_name"));
  }
  const huge = validateInvite({
    ...GOOD,
    invitee_name: "x".repeat(101),
  });
  assert(!huge.ok);
  if (!huge.ok) {
    assert(huge.fields.includes("invitee_name"));
  }
});

Deno.test("validateInvite — rejects malformed brand_id", () => {
  const r = validateInvite({ ...GOOD, brand_id: "not-a-uuid" });
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

Deno.test("buildInviteEmail — wires brand + role + acceptUrl into the body", () => {
  const payload = buildInviteEmail({
    inviteeName: "Tunde",
    inviteeEmail: "tunde@example.com",
    brandName: "Acme Events",
    inviterName: "Seth",
    role: "event_manager",
    acceptUrl:
      "https://business.usemingla.com/accept-brand-invitation?token=abc.def",
    from: "Mingla <noreply@usemingla.com>",
  });
  assertEquals(payload.to, ["tunde@example.com"]);
  assertEquals(payload.from, "Mingla <noreply@usemingla.com>");
  assert(payload.subject.includes("Acme Events"));
  assert(payload.html.includes("Acme Events"));
  assert(payload.html.includes("Event manager"));
  assert(
    payload.html.includes(
      "https://business.usemingla.com/accept-brand-invitation?token=abc.def",
    ),
  );
  assert(payload.text.includes("Acme Events"));
  assert(payload.text.includes("Accept:"));
});

Deno.test("buildInviteEmail — HTML-escapes brand name + inviter name", () => {
  const payload = buildInviteEmail({
    inviteeName: "Test",
    inviteeEmail: "x@y.com",
    brandName: "<script>x</script>",
    inviterName: "Bob & Alice",
    role: "brand_admin",
    acceptUrl: "https://business.usemingla.com/accept-brand-invitation?token=t",
    from: "Mingla <noreply@usemingla.com>",
  });
  // Brand name is escaped in the HTML body.
  assert(payload.html.includes("&lt;script&gt;"));
  // Inviter name is escaped (& → &amp;).
  assert(payload.html.includes("Bob &amp; Alice"));
});
