/**
 * #3682 Wave 2.8b — structural guard for wizard invite follower sources.
 */
import {
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../", import.meta.url);
const migration = Deno.readTextFileSync(
  new URL(
    "supabase/migrations/20270811003682_issue_3682_wizard_invite_followers.sql",
    root,
  ),
);

Deno.test("#3682 wizard invite selection widens to Followers + Friends of followers", () => {
  assertStringIncludes(migration, "'includeFollowers'");
  assertStringIncludes(migration, "'includeFriendsOfFollowers'");
  assertStringIncludes(migration, "private.issue_3682_circle_invite_person_ids");
  assertStringIncludes(migration, "issue_1777_resolve_brand_circle_members");
  assertStringIncludes(migration, "muted_until");
  assertStringIncludes(migration, "wizard_invite_circle_unavailable");
  assertStringIncludes(migration, "brand_circle_followers_v1");
});

Deno.test("#3682 clear RPC empties the new follower flags", () => {
  assertStringIncludes(migration, "'includeFollowers', false");
  assertStringIncludes(migration, "'includeFriendsOfFollowers', false");
});

Deno.test("#3682 legacy four-key selection remains accepted", () => {
  assertStringIncludes(migration, "'manualGroupIds', 'personIds'");
  assertStringIncludes(
    migration,
    "Accept legacy four-key Host payloads",
  );
});
