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
const fixup = Deno.readTextFileSync(
  new URL(
    "supabase/migrations/20270812003682_issue_3682_wizard_invite_followers_fixup.sql",
    root,
  ),
);

Deno.test("#3682 wizard invite selection widens to Followers + Friends of followers", () => {
  assertStringIncludes(migration, "'includeFollowers'");
  assertStringIncludes(migration, "'includeFriendsOfFollowers'");
  assertStringIncludes(fixup, "private.issue_3682_circle_invite_person_ids");
  assertStringIncludes(fixup, "issue_1777_resolve_brand_circle_members");
  assertStringIncludes(fixup, "muted_until");
  assertStringIncludes(fixup, "wizard_invite_circle_unavailable");
  assertStringIncludes(fixup, "brand_circle_followers_v1");
});

Deno.test("#3682 clear RPC empties the new follower flags", () => {
  assertStringIncludes(fixup, "'includeFollowers', false");
  assertStringIncludes(fixup, "'includeFriendsOfFollowers', false");
});

Deno.test("#3682 circle invites do not promote into Your Book and preflight the 500 cap", () => {
  assertStringIncludes(fixup, "never promote circle hits into Your Book");
  assertStringIncludes(fixup, "v_candidate_count > 500");
  assertStringIncludes(fixup, "v_legacy_hash");
});
