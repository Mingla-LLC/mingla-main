// #4238 — who may send a brand team invitation (invariant I-4238-TEAM-GRANTS).
// The database enforces the same rules in brand_invitations_grant_guard
// (supabase/migrations/20281118004238_issue_4238_team_role_grants.sql).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inviteRoleDecision, OWNER_ONLY_INVITE_ROLES } from "../index.ts";

const OWNER = { callerRank: 60, isOwner: true };
const ADMIN = { callerRank: 50, isOwner: false };
const EVENTS = { callerRank: 40, isOwner: false };
const mail = {
  inviterEmail: "me@example.test",
  inviteeEmail: "them@example.test",
};

Deno.test("#4238 finance_manager and brand_owner are owner-only roles", () => {
  assertEquals([...OWNER_ONLY_INVITE_ROLES].sort(), [
    "brand_owner",
    "finance_manager",
  ]);
});

Deno.test("#4238 a brand admin cannot invite a finance_manager or brand_owner", () => {
  for (const role of ["finance_manager", "brand_owner"]) {
    assertEquals(inviteRoleDecision({ ...ADMIN, ...mail, role }), {
      ok: false,
      reason: "owner_only_role",
    });
  }
});

Deno.test("#4238 the owner can invite a finance_manager and hand over ownership", () => {
  for (const role of ["finance_manager", "brand_owner"]) {
    assertEquals(inviteRoleDecision({ ...OWNER, ...mail, role }), { ok: true });
  }
});

Deno.test("#4238 a brand admin still invites roles up to brand_admin", () => {
  for (
    const role of [
      "brand_admin",
      "event_manager",
      "marketing_manager",
      "scanner",
      "venue_staff",
    ]
  ) {
    assertEquals(inviteRoleDecision({ ...ADMIN, ...mail, role }), { ok: true });
  }
});

Deno.test("#4238 below brand admin cannot invite", () => {
  assertEquals(
    inviteRoleDecision({ ...EVENTS, ...mail, role: "scanner" }),
    { ok: false, reason: "rank" },
  );
});

Deno.test("#4238 nobody invites their own email (case-insensitive)", () => {
  for (const caller of [OWNER, ADMIN]) {
    const decision = inviteRoleDecision({
      ...caller,
      role: "event_manager",
      inviterEmail: "Me@Example.test ",
      inviteeEmail: "me@example.test",
    });
    assert(!decision.ok);
    if (decision.ok) return;
    assertEquals(decision.reason, "self_role_change");
  }
});

Deno.test("#4238 an inviter without an email is not treated as a self-invite", () => {
  assertEquals(
    inviteRoleDecision({
      ...ADMIN,
      role: "event_manager",
      inviterEmail: "",
      inviteeEmail: "them@example.test",
    }),
    { ok: true },
  );
});
