#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0854 [Consumer ticket status live-flip valid→used on scan]
 * TESTER ADVERSARIAL check (separate from the implementor's adversarial
 * script `orch-0854-adversarial-check.mjs`).
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5
 * the tester must author an adversarial regression that attacks a
 * DIFFERENT angle than the implementor's happy-path AND the implementor's
 * adversarial. The implementor scripts cover hook shape (happy) and
 * lifecycle / fallback / channel-name-collision (adversarial). This
 * tester script attacks:
 *
 * (TA1) Cache-key consistency — `["businessEventOrders", userId]` AND
 *       `["consumerCalendar", userId]` must literally appear in the
 *       producer hooks (`useBusinessEventOrders` + `useConsumerCalendar`).
 *       If a future contributor renames a key in the producer without
 *       updating the realtime subscription, invalidation silently misses
 *       and the bug returns. (Constitution #4 enforcement at QA gate.)
 *
 * (TA2) Migration filename monotonicity — the ORCH-0854 migration prefix
 *       must be strictly greater than the prior migration
 *       `20260606000100_orch_0852_realtime_checkout_sessions.sql` so
 *       `supabase db push --linked` applies in order. Catches backdated
 *       timestamps that re-trigger a previously-applied migration.
 *
 * (TA3) NO `buyer_user_id` filter on the tickets subscription — the
 *       `public.tickets` table has NO `buyer_user_id` column (buyer
 *       linkage is via `tickets.order_id → orders.buyer_user_id`).
 *       A future contributor copying the orders subscription pattern
 *       verbatim would add `filter: \`buyer_user_id=eq.${userId}\``,
 *       which postgres logical replication evaluates against the changed
 *       row's columns and silently matches zero. Asserts no such filter
 *       appears inside the tickets-subscription body.
 *
 * (TA4) Server-side scan path UNTOUCHED — SPEC §Non-goals explicitly
 *       forbids touching `supabase/functions/scan-ticket/index.ts` or
 *       adding an `UPDATE orders` side-effect to the scan RPC. Asserts
 *       the edge function still routes to `biz_ticket_scan` and contains
 *       no orders-table SQL.
 *
 * (TA5) Migration uses ALTER PUBLICATION, NOT CREATE PUBLICATION or DROP
 *       PUBLICATION — CREATE PUBLICATION would either fail (publication
 *       exists) or in a fresh-environment recreate the publication and
 *       lose all the legacy tables that were dashboard-added (orders,
 *       notifications, etc.). DROP + CREATE would silently break every
 *       other realtime consumer.
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
const scanFnSrc = read("supabase/functions/scan-ticket/index.ts");
const migrationSrc = read(
  "supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql",
);

// Extract producer hook bodies and the tickets-subscription body.
const businessOrdersMatch =
  hookSrc &&
  hookSrc.match(/export const useBusinessEventOrders\s*=[\s\S]*?\n\};/);
const consumerCalendarMatch =
  hookSrc &&
  hookSrc.match(/export const useConsumerCalendar\s*=[\s\S]*?\n\};/);
const ticketsSubMatch =
  hookSrc &&
  hookSrc.match(
    /export const useTicketsRealtimeSubscription\s*=[\s\S]*?\n\};/,
  );

const businessOrdersBody = businessOrdersMatch ? businessOrdersMatch[0] : "";
const consumerCalendarBody = consumerCalendarMatch
  ? consumerCalendarMatch[0]
  : "";
const ticketsSubBody = ticketsSubMatch ? ticketsSubMatch[0] : "";

// TA1 — cache-key consistency
check(
  "TA1a useBusinessEventOrders producer declares queryKey [\"businessEventOrders\", userId] (subscriber invalidation target exists)",
  businessOrdersBody !== "" &&
    /queryKey:\s*\[[\"']businessEventOrders[\"']\s*,\s*userId\s*\]/.test(
      businessOrdersBody,
    ),
  "useBusinessEventOrders must declare its queryKey as `[\"businessEventOrders\", userId]` because useTicketsRealtimeSubscription invalidates that exact key. Renaming the producer key without updating the subscription invalidation silently breaks the live-flip without any TypeScript error. Constitution #4 enforcement.",
);

check(
  "TA1b useConsumerCalendar producer declares queryKey [\"consumerCalendar\", userId] (H-2 defense target exists)",
  consumerCalendarBody !== "" &&
    /queryKey:\s*\[[\"']consumerCalendar[\"']\s*,\s*userId\s*\]/.test(
      consumerCalendarBody,
    ),
  "useConsumerCalendar must declare its queryKey as `[\"consumerCalendar\", userId]` because useTicketsRealtimeSubscription invalidates that key as H-2 defense. If the producer key drifts, the second invalidation silently no-ops.",
);

// TA2 — migration filename monotonicity
const prior =
  "supabase/migrations/20260606000100_orch_0852_realtime_checkout_sessions.sql";
const current =
  "supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql";
const priorPrefix = path.basename(prior).split("_")[0];
const currentPrefix = path.basename(current).split("_")[0];
check(
  `TA2 Migration filename monotonicity (${currentPrefix} > ${priorPrefix})`,
  fs.existsSync(path.join(repoRoot, current)) &&
    fs.existsSync(path.join(repoRoot, prior)) &&
    Number(currentPrefix) > Number(priorPrefix),
  "ORCH-0854 migration filename prefix must be strictly greater than the prior migration (ORCH-0852 = 20260606000100). Backdating a new migration would either skip apply or re-trigger a previously-applied one — both create supabase_migrations.schema_migrations drift.",
);

// TA3 — no buyer_user_id filter on tickets subscription
check(
  "TA3 Tickets subscription has NO buyer_user_id filter (tickets table has no such column — would silently match zero)",
  ticketsSubBody !== "" &&
    !/filter:\s*`buyer_user_id=eq\.\$\{userId\}`/.test(ticketsSubBody),
  "The `tickets` table has no `buyer_user_id` column (linkage is via `tickets.order_id → orders.buyer_user_id`). A future contributor copying the orders subscription pattern would add `filter: \\`buyer_user_id=eq.${userId}\\`` here, and Supabase postgres_changes would silently match zero rows. RLS is the right gate. If a filter ever lands, this assertion fires.",
);

// TA4 — server-side scan path untouched
check(
  "TA4a scan-ticket edge function still invokes biz_ticket_scan RPC (server logic unchanged per SPEC §Non-goals)",
  scanFnSrc !== null &&
    /supabase\.rpc\(\s*[\"']biz_ticket_scan[\"']/.test(scanFnSrc),
  "SPEC §Non-goals forbids server-side change. scan-ticket edge function must still route to the biz_ticket_scan RPC. If this regresses, the scan flow itself is broken.",
);

check(
  "TA4b scan-ticket edge function does NOT write to orders table (no UPDATE orders / .from('orders').update(...))",
  scanFnSrc !== null &&
    !/\bUPDATE\s+(public\.)?orders\b/i.test(scanFnSrc) &&
    !/\.from\([\"']orders[\"']\)[\s\S]*?\.update\(/.test(scanFnSrc),
  "SPEC explicitly forbids adding an `UPDATE orders` side-effect to the scan path as a hack to trigger the existing orders realtime subscription. The fix must flow through the tickets table + tickets subscription. If this regresses we have modeling theatre, not a real fix.",
);

// TA5 — ALTER PUBLICATION semantics
check(
  "TA5a Migration uses ALTER PUBLICATION ADD TABLE (not CREATE / DROP PUBLICATION)",
  migrationSrc !== null &&
    /\bALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+public\.tickets\b/i.test(
      migrationSrc,
    ) &&
    !/\bCREATE\s+PUBLICATION\s+supabase_realtime\b/i.test(migrationSrc) &&
    !/\bDROP\s+PUBLICATION\s+supabase_realtime\b/i.test(migrationSrc),
  "Migration MUST use `ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets`. CREATE PUBLICATION on a fresh environment would NOT include the dashboard-added legacy tables (orders, notifications, messages, etc.) — every other realtime consumer would silently break. DROP + CREATE is even worse.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log(
  "\nORCH-0854 TESTER adversarial check (cache-key + monotonicity + filter-trap + server-path + ALTER semantics)\n",
);
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
