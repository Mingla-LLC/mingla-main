/**
 * #3682 Wave 2.8 — Show me as going (Who's going privacy) structural guard.
 *
 * Pins the migration that replaces peer_list_event_guests after #871: default-off
 * opt-in columns, friend/self/opt-in naming, privateOthersCount, and the setter.
 */
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../", import.meta.url);
const migration = Deno.readTextFileSync(
  new URL(
    "supabase/migrations/20270810003682_issue_3682_show_me_as_going.sql",
    root,
  ),
);

Deno.test("#3682 show_me_as_going columns default false on RSVP + orders", () => {
  assertStringIncludes(
    migration,
    "ADD COLUMN IF NOT EXISTS show_me_as_going boolean NOT NULL DEFAULT false",
  );
  assertStringIncludes(migration, "ALTER TABLE public.event_rsvps");
  assertStringIncludes(migration, "ALTER TABLE public.orders");
});

Deno.test("#3682 setter RPC is authenticated-only and attendance-gated", () => {
  assertStringIncludes(migration, "biz_set_show_me_as_going");
  assertStringIncludes(migration, "RAISE EXCEPTION 'attendance_required'");
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.biz_set_show_me_as_going(uuid, boolean)\n  TO authenticated",
  );
  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.biz_set_show_me_as_going(uuid, boolean)\n  FROM PUBLIC, anon",
  );
});

Deno.test("#3682 peer_list names self, friends, or opt-in — not profile visibility alone", () => {
  assertStringIncludes(migration, "a.linked_user_id = v_viewer");
  assertStringIncludes(migration, "FROM public.friends f");
  assertStringIncludes(migration, "OR a.show_me_as_going");
  assert(
    !/visibility_mode IN \('public', 'friends'\)/.test(migration),
    "profile visibility alone must not name guests after #3682",
  );
  assertStringIncludes(migration, "'privateOthersCount'");
  assertStringIncludes(migration, "SUM(pf.party_size)");
  assertStringIncludes(migration, "'viewerShowMeAsGoing'");
});
