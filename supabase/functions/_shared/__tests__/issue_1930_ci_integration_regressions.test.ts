import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270403001930_issue_1930_checkout_current_truth.sql",
    import.meta.url,
  ),
);

Deno.test("#1930 child trigger branches before table-specific record fields", () => {
  const start = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1930_child_sale_revoke_trigger()",
  );
  const end = migration.indexOf(
    "DROP TRIGGER IF EXISTS issue_1930_ticket_types_revoke",
    start,
  );
  const trigger = migration.slice(start, end);
  const ticketBranch = trigger.indexOf("IF TG_TABLE_NAME='ticket_types' THEN");
  const eventDateBranch = trigger.indexOf(
    "ELSIF TG_TABLE_NAME='event_dates' THEN",
  );
  assert(ticketBranch >= 0 && eventDateBranch > ticketBranch);
  assert(trigger.slice(ticketBranch).indexOf("OLD.deleted_at") >= 0);
  assert(trigger.slice(eventDateBranch).indexOf("OLD.start_at") >= 0);
  assertEquals(trigger.includes("TG_TABLE_NAME='ticket_types' AND"), false);
  assertEquals(trigger.includes("TG_TABLE_NAME='event_dates' AND"), false);
});

Deno.test("#1930 current-truth wrapper preserves #1929 fresh-checkout errors", () => {
  const wrapper = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(",
    ),
  );
  assert(wrapper.includes("RAISE EXCEPTION 'event_not_found'"));
  assert(wrapper.includes("RAISE EXCEPTION 'event_not_selling'"));
  assertEquals(
    wrapper.includes("RAISE EXCEPTION 'checkout_unavailable'"),
    false,
  );
});
