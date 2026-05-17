#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0854 [Consumer ticket status live-flip valid→used on scan] regression check.
 *
 * Asserts that `useTicketsRealtimeSubscription` exists in
 * `app-mobile/src/hooks/useCalendarEntries.ts`, opens a Supabase realtime
 * channel on `public.tickets` for UPDATE events, invalidates BOTH the
 * `["businessEventOrders", userId]` AND `["consumerCalendar", userId]`
 * React Query caches on any qualifying event, cleans up via
 * `supabase.removeChannel(...)`, and is wired into
 * `app-mobile/src/components/activity/CalendarTab.tsx` alongside the
 * existing `useOrdersRealtimeSubscription(user?.id)` call. Also asserts
 * the companion publication-add migration is present on disk.
 *
 * Coverage angles (all source-level structural — happy-path):
 *
 * (H) Hook contract grep — locks in the channel name pattern, event scope,
 *     table, both invalidate keys, and cleanup.
 * (M) Migration presence — companion `ALTER PUBLICATION supabase_realtime
 *     ADD TABLE public.tickets` migration is on disk.
 *
 * H-04 is the fails-on-revert key: reverting the
 * `queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })`
 * line removes the primary observable behavior and this check fails.
 *
 * The tester writes the adversarial second test from a different angle per
 * CLOSE Step 0.5 — see `orch-0854-adversarial-check.mjs`.
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
  "H-01 useTicketsRealtimeSubscription hook is exported with the correct signature",
  hookSrc !== null &&
    /export const useTicketsRealtimeSubscription\s*=\s*\(userId:\s*string\s*\|\s*undefined\)\s*:\s*void\s*=>/.test(
      hookSrc,
    ),
  "Hook must be exported as `(userId: string | undefined): void` so CalendarTab can call it with `user?.id`. Missing export or wrong signature breaks the wiring.",
);

check(
  "H-02 Channel opens via supabase.channel with per-user scoped name `tickets:buyer=${userId}`",
  hookSrc !== null &&
    /supabase\s*\n?\s*\.channel\(`tickets:buyer=\$\{userId\}`\)/.test(hookSrc),
  "Channel name must be `tickets:buyer=${userId}` per the spec — the userId suffix is purely a per-user disambiguator so two buyers signed in on the same dev environment do not collide on channel identity.",
);

check(
  "H-03 postgres_changes listener targets table=tickets with event='UPDATE' (no server filter — RLS gates delivery)",
  hookSrc !== null &&
    /\.on\(\s*\n?\s*[\"']postgres_changes[\"']\s*,\s*\n?\s*\{[\s\S]*?event:\s*[\"']UPDATE[\"'][\s\S]*?schema:\s*[\"']public[\"'][\s\S]*?table:\s*[\"']tickets[\"'][\s\S]*?\}/.test(
      hookSrc,
    ),
  "Listener must subscribe to UPDATE events on public.tickets. No server-side filter (postgres_changes cannot join through orders.buyer_user_id); RLS policy `Buyer or brand team can select tickets` gates delivery to tickets the buyer owns.",
);

check(
  "H-04 [FAILS-ON-REVERT KEY] Payload handler invalidates [\"businessEventOrders\", userId]",
  hookSrc !== null &&
    /useTicketsRealtimeSubscription[\s\S]*?queryClient\s*\n?\s*\.?invalidateQueries\(\{\s*queryKey:\s*\[[\"']businessEventOrders[\"']\s*,\s*userId\s*\]\s*\}\)/.test(
      hookSrc,
    ),
  "The new hook MUST invalidate the existing `useBusinessEventOrders` query key on realtime events — without this, the consumer Tickets tab keeps rendering stale `valid` badges after a scan. Reverting this line removes the primary observable behavior; canonical fails-on-revert anchor.",
);

check(
  "H-05 Payload handler also invalidates [\"consumerCalendar\", userId] (H-2 defense)",
  hookSrc !== null &&
    /useTicketsRealtimeSubscription[\s\S]*?queryClient\s*\n?\s*\.?invalidateQueries\(\{\s*queryKey:\s*\[[\"']consumerCalendar[\"']\s*,\s*userId\s*\]\s*\}\)/.test(
      hookSrc,
    ),
  "Per SPEC Hidden Flaw H-2 defense in depth, the handler must ALSO invalidate `[\"consumerCalendar\", userId]` so any future surface reading that key inherits the freshness. React Query deduplicates same-tick invalidations.",
);

check(
  "H-06 Cleanup removes the channel via supabase.removeChannel(channel)",
  hookSrc !== null &&
    /useTicketsRealtimeSubscription[\s\S]*?return\s*\(\)\s*=>\s*\{\s*\n?\s*supabase\.removeChannel\(channel\)\s*;?\s*\n?\s*\}/.test(
      hookSrc,
    ),
  "useEffect must return a cleanup that calls supabase.removeChannel(channel) on unmount or userId change. Without this, channels leak across renders and across user sessions (logout would not clear the subscription).",
);

check(
  "H-07 CalendarTab imports useTicketsRealtimeSubscription from useCalendarEntries",
  tabSrc !== null &&
    /import\s*\{[\s\S]*?useTicketsRealtimeSubscription[\s\S]*?\}\s*from\s*[\"']\.\.\/\.\.\/hooks\/useCalendarEntries[\"']/.test(
      tabSrc,
    ),
  "CalendarTab must import the new hook alongside useBusinessEventOrders + useOrdersRealtimeSubscription — wiring is mandatory for the consumer Tickets tab to actually benefit from realtime ticket-status flips.",
);

check(
  "H-08 CalendarTab calls useTicketsRealtimeSubscription(user?.id)",
  tabSrc !== null &&
    /useTicketsRealtimeSubscription\(user\?\.id\)/.test(tabSrc),
  "CalendarTab body must call `useTicketsRealtimeSubscription(user?.id)` so the subscription opens for every signed-in consumer session. Missing this call means the hook ships dead.",
);

// (M) Migration presence — paired publication-add must exist on disk.
const migrationPath =
  "supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql";
const migrationSrc = read(migrationPath);
check(
  "M-01 Companion publication-add migration is present on disk",
  migrationSrc !== null &&
    /ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+public\.tickets\s*;/.test(
      migrationSrc,
    ),
  `Migration must exist at \`${migrationPath}\` and contain \`ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;\`. Without this the client subscription silently no-ops (same trap ORCH-0816 caught for orders).`,
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0854 regression check (happy-path)\n");
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
