/**
 * #3682 Wave 2 slice 1 — adversarial: guests skipped; confirm never awaits follow.
 *
 *   deno test --allow-read --allow-env \
 *     supabase/functions/_shared/__tests__/issue_3682_auto_follow_on_purchase.adversarial.test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { autoFollowBrandBestEffort } from "../autoFollowBrand.ts";

const confirmSrc = Deno.readTextFileSync(
  "supabase/functions/ticket-checkout-confirm/index.ts",
);
const createSrc = Deno.readTextFileSync(
  "supabase/functions/ticket-checkout-create/index.ts",
);
const paystackSrc = Deno.readTextFileSync(
  "supabase/functions/_shared/paystackWebhookRouter.ts",
);
const migrationSrc = Deno.readTextFileSync(
  "supabase/migrations/20270805003682_issue_3682_auto_follow_on_purchase.sql",
);

Deno.test("#3682 adversarial: undefined / empty ids never call RPC", async () => {
  let calls = 0;
  const supabase = {
    rpc: () => {
      calls += 1;
      return Promise.resolve({ data: null, error: null });
    },
  };
  await autoFollowBrandBestEffort(supabase, {
    userId: undefined,
    brandId: "brand-1",
  });
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: undefined,
  });
  await autoFollowBrandBestEffort(supabase, {
    userId: "  ",
    brandId: "brand-1",
  });
  assertEquals(calls, 0);
});

Deno.test("#3682 adversarial: purchase without orderId never calls RPC", async () => {
  let calls = 0;
  const supabase = {
    rpc: () => {
      calls += 1;
      return Promise.resolve({ data: null, error: null });
    },
  };
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: "brand-1",
    source: "purchase",
    orderId: null,
  });
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: "brand-1",
    source: "rsvp",
  });
  assertEquals(calls, 0);
});

Deno.test("#3682 adversarial: confirm auto-follow is fire-and-forget (void)", () => {
  assert(confirmSrc.includes("void autoFollowBrandBestEffort"));
  assert(!/await autoFollowBrandBestEffort/.test(confirmSrc));
});

Deno.test("#3682 adversarial: free create reads persisted buyer_user_id, not request uid", () => {
  const callIdx = createSrc.indexOf("autoFollowBrandBestEffort(supabase as never, {");
  assert(callIdx > 0);
  const window = createSrc.slice(Math.max(0, callIdx - 1600), callIdx + 400);
  assert(window.includes('from("ticket_checkout_sessions")'));
  assert(window.includes("buyer_user_id"));
  assert(window.includes("finalizedRecord.replayed !== true"));
  assert(window.includes('source: "rsvp"'));
  assert(window.includes("followSession?.buyer_user_id"));
  assert(!/userId,\s*\n\s*brandId: typeof session\.brandId/.test(window));
});

Deno.test("#3682 adversarial: Paystack shared finalize path wires void auto-follow", () => {
  assert(paystackSrc.includes("void autoFollowBrandBestEffort"));
  const finalizeIdx = paystackSrc.indexOf('"biz_ticket_checkout_finalize"');
  const followIdx = paystackSrc.indexOf("void autoFollowBrandBestEffort", finalizeIdx);
  assert(finalizeIdx > 0 && followIdx > finalizeIdx);
  assert(!/await autoFollowBrandBestEffort/.test(paystackSrc));
});

Deno.test("#3682 adversarial: migration refuses anon/authenticated + claims unfollow safety", () => {
  assert(migrationSrc.includes("FROM PUBLIC, anon, authenticated"));
  assert(migrationSrc.includes("auto_follow_source_invalid"));
  assert(migrationSrc.includes("auto_follow_args_required"));
  assert(migrationSrc.includes("auto_follow_order_required"));
  assert(migrationSrc.includes("already_claimed"));
  assert(migrationSrc.includes("brand_follow_auto_claims"));
  assert(migrationSrc.includes("ENABLE ROW LEVEL SECURITY"));
});

Deno.test("#3682 adversarial: no banned issue-3682 workflow file", () => {
  let missing = false;
  try {
    Deno.statSync(".github/workflows/issue-3682-auto-follow-tests.yml");
  } catch {
    missing = true;
  }
  assert(missing, "issue-3682-auto-follow-tests.yml must not exist");
});
