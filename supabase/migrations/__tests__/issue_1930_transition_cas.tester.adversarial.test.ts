import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20270403001930_issue_1930_checkout_current_truth.sql",
    import.meta.url,
  ),
);
const rsvpCreate = await Deno.readTextFile(
  new URL(
    "../../functions/rsvp-contribution-create/index.ts",
    import.meta.url,
  ),
);

Deno.test("#1930 tester: replay/finalize authorization rechecks the locked capacity formula", () => {
  const authorization = migration.slice(
    migration.indexOf("issue_1930_ticket_session_authorized"),
    migration.indexOf("issue_1930_claim_ticket_provider_attempt"),
  );
  assertStringIncludes(authorization, "quantity_total");
  assertStringIncludes(authorization, "is_unlimited");
  assert(
    authorization.includes("public.tickets") &&
      authorization.includes("ticket_checkout_session_items"),
    "authorization must compare sold + active reservations + this session quantity to current capacity",
  );
});

Deno.test("#1930 tester: physical line/occurrence deletion cannot bypass DB revocation", () => {
  const triggerBlock = migration.slice(
    migration.indexOf("issue_1930_child_sale_revoke_trigger"),
    migration.indexOf("-- Extend the canonical source-refund vocabulary"),
  );
  assert(
    /CREATE TRIGGER issue_1930_ticket_types_revoke[\s\S]*?DELETE/.test(
      triggerBlock,
    ),
    "ticket type DELETE must revoke affected nonterminal sales",
  );
  assert(
    /CREATE TRIGGER issue_1930_event_dates_revoke[\s\S]*?DELETE/.test(
      triggerBlock,
    ),
    "event date DELETE must revoke affected nonterminal sales",
  );
});

Deno.test("#1930 tester: RSVP provider mutation has a post-response epoch CAS before continuation", () => {
  assertStringIncludes(migration, "issue_1930_claim_rsvp_provider_attempt");
  assertStringIncludes(migration, "issue_1930_commit_rsvp_provider_attempt");
  assertStringIncludes(rsvpCreate, '"issue_1930_claim_rsvp_provider_attempt"');
  assertStringIncludes(rsvpCreate, '"issue_1930_commit_rsvp_provider_attempt"');

  for (const continuation of [
    "hostedCheckoutUrl: checkoutSession.url",
    "clientSecret,",
  ]) {
    const returnAt = rsvpCreate.indexOf(continuation);
    const commitAt = rsvpCreate.lastIndexOf(
      '"issue_1930_commit_rsvp_provider_attempt"',
      returnAt,
    );
    assert(returnAt > 0 && commitAt > 0 && commitAt < returnAt);
  }
});
