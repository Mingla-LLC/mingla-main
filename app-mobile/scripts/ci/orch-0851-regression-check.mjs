#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] regression check.
 *
 * Asserts that `useOrdersRealtimeSubscription` exists in
 * `app-mobile/src/hooks/useCalendarEntries.ts`, opens a Supabase realtime
 * channel filtered by `buyer_user_id=eq.<userId>` on the `orders` table,
 * invalidates the `["businessEventOrders", userId]` React Query cache on
 * any postgres_changes event, cleans up via `supabase.removeChannel(...)`,
 * and is wired into `app-mobile/src/components/activity/CalendarTab.tsx`
 * alongside `useBusinessEventOrders(user?.id)`.
 *
 * Coverage angles (all source-level structural — happy-path):
 *
 * (H) Hook contract grep — locks in the channel name, filter, event scope,
 *     invalidate key, and cleanup.
 *
 * H-04 is the fails-on-revert key: reverting the
 * `queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })`
 * line removes the only behavior the hook provides and this check fails.
 *
 * The tester (and the companion `orch-0851-adversarial-check.mjs`) write
 * the adversarial second test from a different angle per CLOSE Step 0.5.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const hookSrc = read("app-mobile/src/hooks/useCalendarEntries.ts");
const tabSrc = read("app-mobile/src/components/activity/CalendarTab.tsx");

check(
  "H-01 useOrdersRealtimeSubscription hook is exported with the correct signature",
  hookSrc !== null &&
    /export const useOrdersRealtimeSubscription\s*=\s*\(userId:\s*string\s*\|\s*undefined\)\s*:\s*void\s*=>/.test(
      hookSrc,
    ),
  "Hook must be exported as `(userId: string | undefined): void` so CalendarTab can call it with `user?.id`. Missing export or wrong signature breaks the wiring.",
);

check(
  "H-02 Channel opens via supabase.channel with per-user scoped name",
  hookSrc !== null &&
    /supabase\s*\n?\s*\.channel\(`orders:buyer_user_id=eq\.\$\{userId\}`\)/.test(
      hookSrc,
    ),
  "Channel name must be `orders:buyer_user_id=eq.${userId}` per the spec — colon-prefixed scope keeps subscriptions isolated per user and reusable across remounts of the same user.",
);

check(
  "H-03 postgres_changes listener targets table=orders with buyer_user_id filter and event='*'",
  hookSrc !== null &&
    /\.on\(\s*\n?\s*[\"']postgres_changes[\"']\s*,\s*\n?\s*\{[\s\S]*?event:\s*[\"']\*[\"'][\s\S]*?schema:\s*[\"']public[\"'][\s\S]*?table:\s*[\"']orders[\"'][\s\S]*?filter:\s*`buyer_user_id=eq\.\$\{userId\}`[\s\S]*?\}/.test(
      hookSrc,
    ),
  "Listener must subscribe to all events (event: '*') on public.orders filtered by `buyer_user_id=eq.${userId}` so INSERT/UPDATE/DELETE all trigger cache invalidation.",
);

check(
  "H-04 [FAILS-ON-REVERT KEY] Payload handler invalidates [\"businessEventOrders\", userId]",
  hookSrc !== null &&
    /queryClient\s*\n?\s*\.?invalidateQueries\(\{\s*queryKey:\s*\[[\"']businessEventOrders[\"']\s*,\s*userId\s*\]\s*\}\)/.test(
      hookSrc,
    ),
  "The hook MUST invalidate the existing `useBusinessEventOrders` query key on realtime events — that is the entire purpose of this hook. Reverting this single call removes all observable behavior and this is the canonical fails-on-revert check.",
);

check(
  "H-05 Cleanup removes the channel via supabase.removeChannel(channel)",
  hookSrc !== null &&
    /return\s*\(\)\s*=>\s*\{\s*\n?\s*supabase\.removeChannel\(channel\)\s*;?\s*\n?\s*\}/.test(
      hookSrc,
    ),
  "useEffect must return a cleanup that calls supabase.removeChannel(channel) on unmount or userId change. Without this, channels leak across renders and across user sessions (logout would not clear the subscription).",
);

check(
  "H-06 CalendarTab imports useOrdersRealtimeSubscription from useCalendarEntries",
  tabSrc !== null &&
    /import\s*\{[^}]*useOrdersRealtimeSubscription[^}]*\}\s*from\s*[\"']\.\.\/\.\.\/hooks\/useCalendarEntries[\"']/.test(
      tabSrc,
    ),
  "CalendarTab must import the new hook alongside the existing useBusinessEventOrders import — the wiring is mandatory for the consumer Tickets tab to actually benefit from realtime.",
);

check(
  "H-07 CalendarTab calls useOrdersRealtimeSubscription(user?.id)",
  tabSrc !== null &&
    /useOrdersRealtimeSubscription\(user\?\.id\)/.test(tabSrc),
  "CalendarTab body must call `useOrdersRealtimeSubscription(user?.id)` so the subscription is opened for every signed-in consumer session. Missing this call means the hook ships dead.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0851 regression check (happy-path)\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
