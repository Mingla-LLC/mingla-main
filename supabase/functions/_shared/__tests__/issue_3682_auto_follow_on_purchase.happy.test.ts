/**
 * #3682 — auto-follow after signed-in purchase / RSVP / booking.
 *
 * The helper is driven with a REAL supabase-js client against a local stub
 * PostgREST server. The previous version mocked `rpc` with a real Promise,
 * which has `.finally`; the real supabase-js builder is PromiseLike only, so
 * the old `work.finally(...)` threw before the request was ever sent and
 * every production auto-follow silently failed (2026-10-08 .. 2026-11-03).
 *
 *   deno test --allow-read --allow-env --allow-net --no-check \
 *     supabase/functions/_shared/__tests__/issue_3682_auto_follow_on_purchase.happy.test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AUTO_FOLLOW_FAILURE_TAG,
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

type Seen = { method: string; path: string; body: unknown };

async function withStubPostgrest(
  status: number,
  responseBody: unknown,
  run: (url: string, seen: Seen[]) => Promise<void>,
): Promise<void> {
  const seen: Seen[] = [];
  const ac = new AbortController();
  let resolveListen: (port: number) => void = () => {};
  const listening = new Promise<number>((r) => (resolveListen = r));
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      signal: ac.signal,
      onListen: ({ port }) => resolveListen(port),
    },
    async (req) => {
      const text = await req.text();
      seen.push({
        method: req.method,
        path: new URL(req.url).pathname,
        body: text.length > 0 ? JSON.parse(text) : null,
      });
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const port = await listening;
  try {
    await run(`http://127.0.0.1:${port}`, seen);
  } finally {
    ac.abort();
    await server.finished;
  }
}

function realClient(url: string) {
  return createClient(url, "service-role-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.test("#3682 happy: helper no-ops without userId or brandId (real client)", async () => {
  await withStubPostgrest(200, {}, async (url, seen) => {
    const supabase = realClient(url);
    await autoFollowBrandBestEffort(supabase, {
      userId: null,
      brandId: "brand-1",
      source: "purchase",
      orderId: "order-1",
    });
    await autoFollowBrandBestEffort(supabase, {
      userId: "user-1",
      brandId: "",
      source: "purchase",
      orderId: "order-1",
    });
    assertEquals(seen.length, 0);
  });
});

Deno.test("#3682 happy: REAL supabase-js builder POSTs /rest/v1/rpc/biz_auto_follow_brand", async () => {
  await withStubPostgrest(
    200,
    { followed: true, created: true },
    async (url, seen) => {
      const supabase = realClient(url);
      await autoFollowBrandBestEffort(supabase, {
        userId: "user-1",
        brandId: "brand-1",
        source: "purchase",
        orderId: "order-1",
      });
      assertEquals(seen.length, 1, "the RPC request must actually be sent");
      assertEquals(seen[0].method, "POST");
      assertEquals(seen[0].path, "/rest/v1/rpc/biz_auto_follow_brand");
      assertEquals(seen[0].body, {
        p_user_id: "user-1",
        p_brand_id: "brand-1",
        p_source: "purchase",
        p_order_id: "order-1",
      });
    },
  );
});

Deno.test("#3682 happy: RPC error is fail-open and logged at error level with the stable tag", async () => {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    await withStubPostgrest(
      500,
      { message: "auto_follow_boom", code: "XX000" },
      async (url, seen) => {
        await autoFollowBrandBestEffort(realClient(url), {
          userId: "user-1",
          brandId: "brand-1",
          orderId: "order-1",
        });
        assertEquals(seen.length, 1);
      },
    );
  } finally {
    console.error = original;
  }
  assert(
    errors.some((a) => a[0] === AUTO_FOLLOW_FAILURE_TAG),
    "failure must be logged with console.error + stable tag",
  );
});

Deno.test("#3682 happy: thenable-only RPC that never settles hits deadline (no hang)", async () => {
  // Mirrors supabase-js: `then` only, no `finally`.
  const pending = { then: (_ok: unknown, _err: unknown) => undefined };
  const supabase = { rpc: () => pending as never };
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
