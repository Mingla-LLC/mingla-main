/**
 * #3682 Wave 2 slice 1 — auto-follow after signed-in purchase / free RSVP.
 *
 *   deno test --allow-read --allow-env \
 *     supabase/functions/_shared/__tests__/issue_3682_auto_follow_on_purchase.happy.test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  AUTO_FOLLOW_RPC_DEADLINE_MS,
  autoFollowBrandBestEffort,
} from "../autoFollowBrand.ts";

const confirmSrc = Deno.readTextFileSync(
  "supabase/functions/ticket-checkout-confirm/index.ts",
);
const createSrc = Deno.readTextFileSync(
  "supabase/functions/ticket-checkout-create/index.ts",
);
const webhookSrc = Deno.readTextFileSync(
  "supabase/functions/_shared/stripeWebhookRouter.ts",
);
const paystackSrc = Deno.readTextFileSync(
  "supabase/functions/_shared/paystackWebhookRouter.ts",
);
const migrationSrc = Deno.readTextFileSync(
  "supabase/migrations/20270805003682_issue_3682_auto_follow_on_purchase.sql",
);

Deno.test("#3682 happy: helper no-ops without userId or brandId", async () => {
  const calls: unknown[] = [];
  const supabase = {
    rpc: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ data: null, error: null });
    },
  };
  await autoFollowBrandBestEffort(supabase, {
    userId: null,
    brandId: "brand-1",
    source: "purchase",
  });
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: "",
    source: "purchase",
  });
  assertEquals(calls.length, 0);
});

Deno.test("#3682 happy: helper RPCs biz_auto_follow_brand with purchase + orderId", async () => {
  const seen: { fn?: string; args?: Record<string, unknown> } = {};
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      seen.fn = fn;
      seen.args = args;
      return Promise.resolve({
        data: { followed: true, created: true },
        error: null,
      });
    },
  };
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: "brand-1",
    source: "purchase",
    orderId: "order-1",
  });
  assertEquals(seen.fn, "biz_auto_follow_brand");
  assertEquals(seen.args?.p_user_id, "user-1");
  assertEquals(seen.args?.p_brand_id, "brand-1");
  assertEquals(seen.args?.p_source, "purchase");
  assertEquals(seen.args?.p_order_id, "order-1");
});

Deno.test("#3682 happy: helper swallows RPC errors (fail-open)", async () => {
  const supabase = {
    rpc: () =>
      Promise.resolve({ data: null, error: { message: "auto_follow_boom" } }),
  };
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: "brand-1",
    orderId: "order-1",
  });
});

Deno.test("#3682 happy: helper swallows rejected RPC (fail-open)", async () => {
  const supabase = {
    rpc: () => Promise.reject(new Error("rpc_network_down")),
  };
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: "brand-1",
    orderId: "order-1",
  });
});

Deno.test("#3682 happy: pending RPC hits deadline and returns (no hang)", async () => {
  const supabase = {
    rpc: () =>
      new Promise<{ data: unknown; error: null }>(() => {
        /* never settles */
      }),
  };
  const started = Date.now();
  await autoFollowBrandBestEffort(supabase, {
    userId: "user-1",
    brandId: "brand-1",
    orderId: "order-1",
    deadlineMs: 50,
  });
  const elapsed = Date.now() - started;
  assert(elapsed < 500, `deadline should resolve quickly, took ${elapsed}ms`);
  assert(AUTO_FOLLOW_RPC_DEADLINE_MS >= 1000);
});

Deno.test("#3682 happy: confirm / create / stripe+paystack wire autoFollowBrandBestEffort", () => {
  assert(confirmSrc.includes('from "../_shared/autoFollowBrand.ts"'));
  assert(confirmSrc.includes("autoFollowBrandBestEffort"));
  assert(confirmSrc.includes('source: "purchase"'));
  assert(confirmSrc.includes("buyer_user_id"));
  assert(confirmSrc.includes("orderId:"));

  assert(createSrc.includes('from "../_shared/autoFollowBrand.ts"'));
  assert(createSrc.includes("autoFollowBrandBestEffort"));
  assert(createSrc.includes('source: "rsvp"'));
  assert(createSrc.includes("buyer_user_id"));

  assert(webhookSrc.includes('from "./autoFollowBrand.ts"'));
  assert(webhookSrc.includes("autoFollowBrandBestEffort"));
  assert(webhookSrc.includes("buyer_user_id"));

  assert(paystackSrc.includes('from "./autoFollowBrand.ts"'));
  assert(paystackSrc.includes("void autoFollowBrandBestEffort"));
  assert(paystackSrc.includes("buyer_user_id"));
});

Deno.test("#3682 happy: migration defines service-only biz_auto_follow_brand + claims + RLS", () => {
  assert(migrationSrc.includes("CREATE OR REPLACE FUNCTION public.biz_auto_follow_brand"));
  assert(migrationSrc.includes("CREATE TABLE IF NOT EXISTS public.brand_follow_auto_claims"));
  assert(migrationSrc.includes("ENABLE ROW LEVEL SECURITY"));
  assert(migrationSrc.includes("auto_follow_order_required"));
  assert(migrationSrc.includes("ON CONFLICT ON CONSTRAINT brand_follows_user_brand_key DO NOTHING"));
  assert(migrationSrc.includes("ON CONFLICT (order_id) DO NOTHING"));
  assert(migrationSrc.includes("GRANT EXECUTE ON FUNCTION public.biz_auto_follow_brand"));
  assert(migrationSrc.includes("TO service_role"));
  assert(migrationSrc.includes("Friends of followers"));
});
