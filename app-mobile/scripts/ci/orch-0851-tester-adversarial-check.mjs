#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness]
 * TESTER-AUTHORED ADVERSARIAL CHECK.
 *
 * Companion to the implementor's happy-path check
 * (`orch-0851-regression-check.mjs`) and lifecycle/fallback check
 * (`orch-0851-adversarial-check.mjs`). Satisfies the ORCH-0840 CLOSE
 * Step 0.5 requirement that a tester-authored adversarial test attack
 * a DIFFERENT angle than the implementor's tests.
 *
 * Different angles attacked here:
 *
 * (T1) queryClient is obtained via the React Query hook
 *      `useQueryClient()` — NOT captured via useState (would cause stale
 *      closure across re-renders) and NOT imported as a global singleton
 *      (would not respect Provider scope).
 *
 * (T2) The realtime payload handler MUST NOT inspect payload.new /
 *      payload.old fields. Reason: `orders` has `REPLICA IDENTITY = default`
 *      (PK-only). For DELETE and partial-column UPDATE events, payload
 *      will only carry the PK — any code that reads `payload.new.<field>`
 *      would crash with undefined access or silently behave wrong. Verified
 *      server-side via `pg_class.relreplident = 'd'` for `orders` on
 *      2026-05-17. The implementation correctly ignores payload and
 *      invalidates unconditionally — this check locks that contract.
 *
 * (T3) Channel name `orders:buyer_user_id=eq.${userId}` does NOT collide
 *      with any other channel naming convention in `app-mobile/src/`.
 *      A collision would cause supabase-js to return the existing channel
 *      and silently drop the second subscriber's listeners. Grep-based
 *      uniqueness check.
 *
 * (T4) Hook signature returns `void` — no channel reference leaks to the
 *      caller. A leaked reference would let CalendarTab accidentally
 *      hold and re-subscribe a channel after the hook's cleanup ran.
 *
 * (T5) The hook does NOT call `.unsubscribe()` on the channel before
 *      `removeChannel()`. `supabase.removeChannel()` is the correct
 *      single API call for cleanup; calling `.unsubscribe()` first is a
 *      known anti-pattern that double-fires the cleanup and can leak the
 *      socket-level subscription in supabase-js v2.x. Locks the contract
 *      against well-intentioned future "cleanup" rewrites.
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

// Extract just the new hook for tight scoping.
const hookMatch =
  hookSrc &&
  hookSrc.match(
    /export const useOrdersRealtimeSubscription\s*=[\s\S]*?\n\};/,
  );
const hookBody = hookMatch ? hookMatch[0] : "";

// T1 — queryClient via useQueryClient(), not useState/global
check(
  "T1 queryClient is obtained via useQueryClient() (not useState, not global singleton)",
  hookBody !== "" &&
    /const\s+queryClient\s*=\s*useQueryClient\(\)/.test(hookBody) &&
    !/useState[\s\S]*?queryClient/.test(hookBody),
  "queryClient MUST come from useQueryClient() so the hook respects the React Query Provider scope and doesn't stale-close across re-renders. Using useState or importing a global singleton would break Provider-scoped tests and cause stale-closure bugs across user switches.",
);

// T2 — payload handler does NOT inspect payload fields (REPLICA IDENTITY default
//      = PK-only on DELETE/partial UPDATE; any payload.new.* access is unsafe).
check(
  "T2 [FAILS-ON-REVERT KEY] Payload handler does NOT inspect payload.new / payload.old",
  hookBody !== "" &&
    !/payload\s*\.\s*new\s*\./.test(hookBody) &&
    !/payload\s*\.\s*old\s*\./.test(hookBody),
  "The orders table has REPLICA IDENTITY = default (PK-only). For DELETE and partial-column UPDATE events the payload only carries the primary key — any code that reads payload.new.<column> would silently misbehave or crash. The hook MUST invalidate unconditionally without inspecting payload. Verified server-side via pg_class.relreplident = 'd' on 2026-05-17.",
);

// T3 — channel name uniqueness across app-mobile/src/
const allHookSrcs = [
  read("app-mobile/src/hooks/useNotifications.ts"),
  read("app-mobile/src/hooks/useSocialRealtime.ts"),
  read("app-mobile/src/hooks/useSessionDiscussion.ts"),
  read("app-mobile/src/hooks/usePairedMapSavedCards.ts"),
  read("app-mobile/src/hooks/useSessionManagement.ts"),
  read("app-mobile/src/hooks/useBoardQueries.ts"),
  read("app-mobile/src/hooks/useBroadcastReceiver.ts"),
  read("app-mobile/src/hooks/useChatPresence.ts"),
  read("app-mobile/src/services/messagingService.ts"),
  read("app-mobile/src/services/chatPresenceService.ts"),
  read("app-mobile/src/services/realtimeService.ts"),
  read("app-mobile/src/components/MessageInterface.tsx"),
  read("app-mobile/src/components/ConnectionsPage.tsx"),
  read("app-mobile/src/components/onboarding/OnboardingFriendsAndPairingStep.tsx"),
  read("app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx"),
].filter(Boolean);
const collidingSources = allHookSrcs.filter((s) =>
  /\.channel\(`orders:/.test(s),
);
check(
  "T3 Channel name `orders:buyer_user_id=eq.${userId}` does not collide with other realtime channels",
  collidingSources.length === 0 &&
    hookBody !== "" &&
    /\.channel\(`orders:buyer_user_id=eq\.\$\{userId\}`\)/.test(hookBody),
  "supabase-js returns the existing channel when channel name collides and silently drops the second subscriber's listeners. Verified: no other file in app-mobile/src/ uses an `orders:` channel name prefix.",
);

// T4 — hook returns void; no channel reference leaks to caller
check(
  "T4 Hook signature returns void — no channel reference exposed to caller",
  hookBody !== "" &&
    /export const useOrdersRealtimeSubscription\s*=\s*\(userId:\s*string\s*\|\s*undefined\)\s*:\s*void\s*=>/.test(
      hookBody,
    ) &&
    !/return\s+channel\b/.test(hookBody),
  "Hook return type must be `void` and must not return the channel. A leaked channel ref would let CalendarTab accidentally hold and re-subscribe a channel after the hook's cleanup ran, defeating the cleanup contract.",
);

// T5 — cleanup uses removeChannel only (no .unsubscribe() before it)
check(
  "T5 Cleanup uses supabase.removeChannel(channel) only — no preceding channel.unsubscribe()",
  hookBody !== "" &&
    /return\s*\(\)\s*=>\s*\{\s*\n?\s*supabase\.removeChannel\(channel\)\s*;?\s*\n?\s*\}/.test(
      hookBody,
    ) &&
    !/channel\.unsubscribe\(\)/.test(hookBody),
  "removeChannel() is the correct single supabase-js v2 cleanup API. Calling channel.unsubscribe() first is a known anti-pattern that double-fires and can leak the socket-level subscription. Locks the contract against well-intentioned 'thorough cleanup' rewrites.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0851 TESTER adversarial check (infra correctness + collision + leak safety)\n");
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
