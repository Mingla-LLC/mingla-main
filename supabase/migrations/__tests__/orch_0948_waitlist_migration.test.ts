// ORCH-0948 migration source-regression tests.
//
// These tests pin the database contract without needing a live Supabase
// instance in the implementor worktree. The tester phase owns live DB
// adversarial verification after the operator applies the migration.

import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL("../20260724000010_orch_0948_waitlist_feature.sql", import.meta.url),
);

Deno.test("T-WL-05: migration enforces DB-level waitlist contact dedupe", () => {
  assertStringIncludes(migration, "waitlist_entries_dedupe_email_idx");
  assertStringIncludes(
    migration,
    "ON public.waitlist_entries (ticket_type_id, lower(email))",
  );
  assertMatch(
    migration,
    /WHERE\s+status\s+IN\s+\('waiting','invited'\)\s+AND\s+email\s+IS\s+NOT\s+NULL/,
  );
  assertStringIncludes(migration, "waitlist_entries_dedupe_phone_idx");
});

Deno.test("T-WL-07: migration drains waitlist rows FIFO when capacity frees", () => {
  assertStringIncludes(
    migration,
    "CREATE OR REPLACE FUNCTION public.fn_waitlist_drain_on_capacity_freed()",
  );
  assertStringIncludes(
    migration,
    "OLD.status NOT IN ('valid','used','transferred')",
  );
  assertStringIncludes(
    migration,
    "NEW.status NOT IN ('refunded','cancelled','void')",
  );
  assertMatch(migration, /ORDER\s+BY\s+created_at\s+ASC/);
  assertStringIncludes(migration, "EXIT WHEN v_running >= v_freed");
});

Deno.test("T-WL-08: migration uses notification idempotency per waitlist entry", () => {
  assertStringIncludes(migration, "ON CONFLICT (idempotency_key) DO NOTHING");
  assertStringIncludes(migration, "'waitlist_invite:' || v_entry.id::text");
  assertStringIncludes(migration, "notification_id = v_notification_id");
});

Deno.test("T-WL-09: migration makes ticket_order_notifications.order_id nullable", () => {
  assertStringIncludes(
    migration,
    "ALTER TABLE public.ticket_order_notifications",
  );
  assertStringIncludes(migration, "ALTER COLUMN order_id DROP NOT NULL");
  assertStringIncludes(
    migration,
    "ORCH-0948 requires ticket_order_notifications.order_id to be NULLABLE",
  );
  assert(
    /INSERT INTO public\.ticket_order_notifications[\s\S]*?\(order_id,\s*event_id/
      .test(
        migration,
      ),
    "waitlist notification insert must preserve event_id while allowing order_id NULL",
  );
});
