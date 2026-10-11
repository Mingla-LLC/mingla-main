/**
 * #3682 Wave 2.8b — Invite Followers / Friends of followers at creation.
 * Structural guard: selection schema, circle resolve helper, Host picker rows.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");

const migration = read(
  "../supabase/migrations/20270811003682_issue_3682_wizard_invite_followers.sql",
);
const service = read("src/services/offeringInvitePlanService.ts");
const picker = read("src/components/invites/InvitePeopleStep.tsx");

describe("issue #3682 Wave 2.8b — wizard invite followers", () => {
  test("selection key lock includes Followers and Friends of followers booleans", () => {
    expect(migration).toContain("'includeFollowers'");
    expect(migration).toContain("'includeFriendsOfFollowers'");
    expect(migration).toContain("private.issue_3682_circle_invite_person_ids");
    expect(migration).toContain("issue_1777_resolve_brand_circle_members");
    expect(migration).toContain("muted_until");
    expect(migration).toContain("'follower'");
    expect(migration).toContain("'extended'");
    expect(service).toContain("includeFollowers: boolean");
    expect(service).toContain("includeFriendsOfFollowers: boolean");
  });

  test("Host picker exposes Followers and Friends of followers sources", () => {
    expect(picker).toContain('title="Followers"');
    expect(picker).toContain('title="Friends of followers"');
    expect(picker).toContain("onSelectFollowers");
    expect(picker).toContain("onSelectFriendsOfFollowers");
    expect(picker).toContain("includeFollowers: true");
    expect(picker).toContain("includeFriendsOfFollowers: true");
    expect(picker).toContain("followers, or friends of followers");
  });

  test("clear RPC sends the widened six-key empty selection", () => {
    expect(migration).toContain("'includeFollowers', false");
    expect(migration).toContain("'includeFriendsOfFollowers', false");
    const clear = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.biz_clear_offering_invite_plan_v1"),
    );
    expect(clear).toContain("includeFollowers");
    expect(clear).toContain("includeFriendsOfFollowers");
  });
});
