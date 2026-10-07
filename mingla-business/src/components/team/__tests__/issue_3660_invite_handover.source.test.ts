/**
 * #3660 Phase 4 — outgoing-owner disposition at invite send + leave-default wiring.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const inviteSheet = readFileSync(
  join(__dirname, "../InviteBrandMemberSheet.tsx"),
  "utf8",
);
const pendingSheet = readFileSync(
  join(__dirname, "../InvitePendingSheet.tsx"),
  "utf8",
);
const inviteEdge = readFileSync(
  join(
    __dirname,
    "../../../../../supabase/functions/invite-brand-member/index.ts",
  ),
  "utf8",
);
const acceptEdge = readFileSync(
  join(
    __dirname,
    "../../../../../supabase/functions/accept-brand-invitation/index.ts",
  ),
  "utf8",
);
const migration = readFileSync(
  join(
    __dirname,
    "../../../../../supabase/migrations/20270803003660_issue_3660_invite_handover_leave_default.sql",
  ),
  "utf8",
);
const pgTest = readFileSync(
  join(
    __dirname,
    "../../../../../supabase/migrations/__tests__/issue_3660_invite_handover_leave_default.implementor.happy.pg17.test.sql",
  ),
  "utf8",
);

describe("issue_3660 invite handover", () => {
  test("outgoing owner chooses leave/stay when inviting brand_owner", () => {
    expect(inviteSheet).toContain('role === "brand_owner"');
    expect(inviteSheet).toContain('"leave" | "stay"');
    expect(inviteSheet).toContain('>("leave")');
    expect(inviteSheet).toContain("I leave this brand");
    expect(inviteSheet).toContain("I stay as admin");
    expect(inviteSheet).toContain("outgoingDisposition");
    expect(inviteSheet).toContain('accessibilityLabel="I leave this brand"');
    expect(inviteSheet).toContain('accessibilityLabel="I stay as admin"');
  });

  test("invitee Accept sheet does not choose disposition", () => {
    expect(pendingSheet).not.toContain("Previous owner leaves");
    expect(pendingSheet).not.toContain("Previous owner stays as admin");
    expect(pendingSheet).not.toContain("outgoingDisposition");
  });

  test("invite edge stores outgoing_disposition; accept does not pass override", () => {
    expect(inviteEdge).toContain("outgoing_disposition");
    expect(inviteEdge).toContain('dispositionRaw === "stay" ? "stay" : "leave"');
    expect(acceptEdge).not.toContain("p_outgoing_disposition");
    expect(acceptEdge).not.toContain("outgoingDisposition");
  });

  test("migration: column + 2-arg only + dual audit + GUC before disposition", () => {
    expect(migration).toContain("outgoing_disposition");
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.accept_invite_and_transfer_brand_ownership(text, uuid, text)",
    );
    expect(migration).toContain("brand_owner_removed_on_handover");
    expect(migration).toContain("brand_owner_demoted_on_handover");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)");
    expect(migration).toContain("FROM PUBLIC, anon");
    const gucAt = migration.indexOf(
      "PERFORM set_config('app.allow_brand_owner_transfer', 'on', true)",
    );
    const stayAt = migration.indexOf("SET role = 'brand_admin'");
    expect(gucAt).toBeGreaterThan(-1);
    expect(stayAt).toBeGreaterThan(gucAt);
  });

  test("pg17 happy asserts audit rows, co-owner cleanup, and 2-arg leave path", () => {
    expect(pgTest).toContain("brand_ownership_transferred");
    expect(pgTest).toContain("brand_owner_removed_on_handover");
    expect(pgTest).toContain("brand_owner_demoted_on_handover");
    expect(pgTest).toContain("co-owner rank");
    expect(pgTest).toContain("outgoing_disposition");
    expect(pgTest).not.toContain(",\n  'leave'\n)");
    expect(pgTest).not.toContain(",\n  'stay'\n)");
  });
});
