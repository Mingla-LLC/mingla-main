/**
 * Issue #3645 item 6 — cancel-refund release host notify + buyer cancel-email truth.
 *
 * Happy: drainable prep notifies once with stable copy/key/roles/deep link.
 * Adversarial: awaiting_review / zero work skip; notify failure is caller's
 * concern (helper still throws); fan-out source must not enqueue buyer cancel email.
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  CANCEL_REFUNDS_RELEASED_ROLES,
  CANCEL_REFUNDS_RELEASED_TYPE,
  cancelRefundsReleasedCopy,
  cancelRefundsReleasedDeepLink,
  cancelRefundsReleasedIdempotencyKey,
  notifyCancelRefundsReleased,
  shouldNotifyCancelRefundRelease,
  type CancelRefundReleaseNotifyDeps,
} from "../cancelRefundReleaseNotify.ts";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const BRAND_ID = "22222222-2222-4222-8222-222222222222";

Deno.test("#3645 item 6 — copy has no provider name and no timing promise", () => {
  const copy = cancelRefundsReleasedCopy("Rooftop night");
  assertEquals(copy.type, CANCEL_REFUNDS_RELEASED_TYPE);
  assertEquals(copy.title, "Refunds are on their way");
  assert(
    copy.body.includes("Rooftop night"),
    "body must name the offering",
  );
  assert(
    !/stripe|paystack/i.test(copy.body + copy.title),
    "host copy must not name the payment provider",
  );
  assert(
    !/24\s*hour|instant|already refunded/i.test(copy.body),
    "host copy must not promise refund timing",
  );
});

Deno.test("#3645 item 6 — shouldNotify gates on drainable status + work", () => {
  assertEquals(
    shouldNotifyCancelRefundRelease({
      run_status: "awaiting_review",
      total_objects: 3,
      rsvp_pending_count: 0,
    }),
    false,
  );
  assertEquals(
    shouldNotifyCancelRefundRelease({
      run_status: "pending",
      total_objects: 0,
      rsvp_pending_count: 0,
    }),
    false,
  );
  assertEquals(
    shouldNotifyCancelRefundRelease({
      run_status: "completed",
      total_objects: 2,
      rsvp_pending_count: 0,
    }),
    false,
  );
  assertEquals(
    shouldNotifyCancelRefundRelease({
      run_status: "pending",
      total_objects: 2,
      rsvp_pending_count: 0,
    }),
    true,
  );
  assertEquals(
    shouldNotifyCancelRefundRelease({
      run_status: "failed_partial",
      total_objects: 0,
      rsvp_pending_count: 1,
    }),
    true,
  );
});

Deno.test("#3645 item 6 — notify loads event and fans out to payment-view roles", async () => {
  const notifies: Array<Record<string, unknown>> = [];
  const supabase = {
    from: (table: string) => {
      assertEquals(table, "events");
      return {
        select: (_cols: string) => ({
          eq: (_col: string, id: string) => {
            assertEquals(id, EVENT_ID);
            return {
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: EVENT_ID,
                    brand_id: BRAND_ID,
                    title: "Lagos brunch",
                  },
                  error: null,
                }),
            };
          },
        }),
      };
    },
  };
  const deps: CancelRefundReleaseNotifyDeps = {
    notifyBrandManagers: async (_sb, input) => {
      notifies.push(input as unknown as Record<string, unknown>);
    },
  };

  const outcome = await notifyCancelRefundsReleased(
    supabase as never,
    EVENT_ID,
    deps,
  );
  assertEquals(outcome, "notified");
  assertEquals(notifies.length, 1);
  assertEquals(notifies[0].type, CANCEL_REFUNDS_RELEASED_TYPE);
  assertEquals(notifies[0].brandId, BRAND_ID);
  assertEquals(
    notifies[0].idempotencyKey,
    cancelRefundsReleasedIdempotencyKey(EVENT_ID),
  );
  assertEquals(notifies[0].deepLink, cancelRefundsReleasedDeepLink(EVENT_ID));
  assertEquals(notifies[0].roles, CANCEL_REFUNDS_RELEASED_ROLES);
  assert(
    String(notifies[0].body).includes("Lagos brunch"),
    "dispatched body must include title",
  );
});

Deno.test("#3645 item 6 ADV — missing brand skips without notify", async () => {
  let called = 0;
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { id: EVENT_ID, brand_id: null, title: "x" },
              error: null,
            }),
        }),
      }),
    }),
  };
  const outcome = await notifyCancelRefundsReleased(supabase as never, EVENT_ID, {
    notifyBrandManagers: async () => {
      called++;
    },
  });
  assertEquals(outcome, "skipped_no_brand");
  assertEquals(called, 0);
});

Deno.test("#3645 item 6 ADV — lookup error throws (caller fail-opens)", async () => {
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: null,
              error: { message: "db_down" },
            }),
        }),
      }),
    }),
  };
  await assertRejects(
    () => notifyCancelRefundsReleased(supabase as never, EVENT_ID),
    Error,
    "cancel_refund_release_event_lookup_failed",
  );
});

Deno.test("#3645 item 6 — fan-out source never enqueues buyer cancel email", async () => {
  const fanout = await Deno.readTextFile(
    new URL("../../event-cancel-refund-fanout/index.ts", import.meta.url),
  );
  assert(
    fanout.includes("notifyCancelRefundsReleased"),
    "fan-out must call host release notify",
  );
  assert(
    fanout.includes("INTENTIONALLY OFF"),
    "fan-out must document cancel-time buyer email as off",
  );
  assert(
    !fanout.includes('"buyer_order_cancelled"'),
    "fan-out must not enqueue buyer_order_cancelled",
  );
  assert(
    !fanout.includes("template_key: \"buyer_order_cancelled\""),
    "fan-out must not enqueue buyer_order_cancelled template",
  );
});
