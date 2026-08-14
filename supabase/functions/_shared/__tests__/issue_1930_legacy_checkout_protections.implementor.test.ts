import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270403001930_issue_1930_checkout_current_truth.sql",
    import.meta.url,
  ),
);
const checkoutCreate = await Deno.readTextFile(
  new URL("../../ticket-checkout-create/index.ts", import.meta.url),
);

const wrapper = migration.slice(
  migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(",
  ),
  migration.indexOf(
    "REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(",
  ),
);

Deno.test("#1930 preserves terminal and expired-session tombstones in the latest checkout authority", () => {
  assertStringIncludes(
    wrapper,
    "v_existing.status IN ('paid_completed','free_completed','failed','expired')",
  );
  assertStringIncludes(wrapper, "OR v_existing.expires_at < now()");
  assertStringIncludes(
    wrapper,
    "idempotency_key=idempotency_key || ':tombstone:' || id::text",
  );
  assertStringIncludes(
    wrapper,
    "WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status",
  );
  assertStringIncludes(wrapper, "ELSE 'expired'");
});

Deno.test("#1930 checks current event truth before returning an in-flight continuation", () => {
  const eventLockAt = wrapper.indexOf(
    "FROM public.events WHERE id=p_event_id FOR UPDATE",
  );
  const saleCheckAt = wrapper.indexOf(
    "issue_1930_event_sale_reason(v_event)<>'sellable'",
  );
  const existingLookupAt = wrapper.indexOf(
    "FROM public.ticket_checkout_sessions",
  );
  const replayReturnAt = wrapper.indexOf("RETURN jsonb_build_object(");

  assert(eventLockAt >= 0, "the event must be locked");
  assert(saleCheckAt > eventLockAt, "sellability must follow the event lock");
  assert(
    existingLookupAt > saleCheckAt,
    "the idempotency row must be read only after current event truth",
  );
  assert(
    replayReturnAt > existingLookupAt,
    "an in-flight continuation must not escape before current truth",
  );
});

Deno.test("#1930 preserves #865 attribution as a decoupled fail-open write", () => {
  const fatalWriteAt = checkoutCreate.indexOf(
    "if (statusTokenError)",
  );
  const fatalReturnAt = checkoutCreate.indexOf(
    'detail: "buyer_status_token_persist_failed"',
    fatalWriteAt,
  );
  const attributionCallAt = checkoutCreate.indexOf(
    "persistAttributionClickId(supabase",
  );

  assert(fatalWriteAt >= 0 && fatalReturnAt > fatalWriteAt);
  assert(
    attributionCallAt > fatalReturnAt,
    "attribution must remain outside the fatal checkout-session update",
  );
  assert(
    !checkoutCreate.includes("sessionUpdate.attribution_click_id"),
    "attribution must never be coupled back into sessionUpdate",
  );
});
