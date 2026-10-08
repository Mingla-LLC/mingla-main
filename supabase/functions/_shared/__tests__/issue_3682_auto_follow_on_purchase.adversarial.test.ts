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
const migrationSrc = Deno.readTextFileSync(
  "supabase/migrations/20261008013682_issue_3682_auto_follow_on_purchase.sql",
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
  // Guests are null/undefined; whitespace is also skipped after trim.
  assertEquals(calls, 0);
});

Deno.test("#3682 adversarial: confirm auto-follow is fire-and-forget (void)", () => {
  // Must not block the buyer confirmation response.
  assert(confirmSrc.includes("void autoFollowBrandBestEffort"));
  assert(!/await autoFollowBrandBestEffort/.test(confirmSrc));
});

Deno.test("#3682 adversarial: free create only auto-follows on non-replay", () => {
  const callIdx = createSrc.indexOf(
    "void autoFollowBrandBestEffort(supabase as never, {",
  );
  assert(callIdx > 0);
  // fireAdConversion + catch sit between the replay gate and the follow call.
  const window = createSrc.slice(Math.max(0, callIdx - 1200), callIdx + 200);
  assert(window.includes("finalizedRecord.replayed !== true"));
  assert(window.includes('source: "rsvp"'));
});

Deno.test("#3682 adversarial: migration refuses anon/authenticated execute", () => {
  assert(
    migrationSrc.includes(
      "REVOKE ALL ON FUNCTION public.biz_auto_follow_brand(uuid, uuid, text)\n  FROM PUBLIC, anon, authenticated;",
    ) ||
      migrationSrc.includes(
        "FROM PUBLIC, anon, authenticated",
      ),
  );
  assert(migrationSrc.includes("auto_follow_source_invalid"));
  assert(migrationSrc.includes("auto_follow_args_required"));
});
