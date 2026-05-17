#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0854 [Consumer ticket status live-flip valid→used on scan] ADVERSARIAL check.
 *
 * Companion to `orch-0854-regression-check.mjs`. The happy-path script
 * locks the channel name, postgres_changes shape, both invalidate keys,
 * removeChannel cleanup, and the wiring call. This adversarial script
 * attacks DIFFERENT angles — lifecycle safety, dep-array correctness,
 * anonymous-safety, channel-scope hygiene, and fallback-layer preservation
 * — to satisfy the ORCH-0840 CLOSE Step 0.5 requirement that the
 * adversarial test exercise a different angle than the happy-path test.
 *
 * Coverage angles (all source-level structural):
 *
 * (A1) Anonymous-safety — hook MUST early-return when userId is falsy so
 *      no channel is opened for logged-out users (SC-4).
 * (A2) Dep array MUST include `userId` so a user switch tears down the
 *      old subscription and opens a new one (SC-5).
 * (A3) Hook body MUST live inside useEffect so subscribe is not called on
 *      every render (would leak channels). React rules-of-hooks safety.
 * (A4) ORCH-0851 fallback layer 1 still intact — useBusinessEventOrders
 *      retains `refetchOnWindowFocus: true` (SC-6).
 * (A5) ORCH-0851 fallback layer 2 still intact — ExpandedBusinessEventSheet
 *      retains the post-purchase invalidate loop (SC-6).
 * (A6) staleTime on useBusinessEventOrders is NOT regressed (still 60s,
 *      the post-ORCH-0851 value — SC-6).
 * (A7) Channel name does NOT collide with the orders channel — `tickets:`
 *      prefix must be present, distinct from `orders:`. Same-name collision
 *      would cause Supabase to coalesce both subscriptions onto a single
 *      channel handle and one cleanup would tear down both.
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
const sheetSrc = read(
  "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
);

// Extract the useTicketsRealtimeSubscription function body for tighter checks.
const hookMatch =
  hookSrc &&
  hookSrc.match(/export const useTicketsRealtimeSubscription\s*=[\s\S]*?\n\};/);
const hookBody = hookMatch ? hookMatch[0] : "";

check(
  "A1 Hook early-returns when userId is falsy (no channel for anonymous users)",
  hookBody !== "" &&
    /useEffect\(\(\)\s*=>\s*\{\s*\n?\s*if\s*\(!userId\)\s*return;?/.test(
      hookBody,
    ),
  "Hook must guard with `if (!userId) return;` at the top of the useEffect so logged-out sessions don't open a channel against an undefined user id. SC-4.",
);

check(
  "A2 useEffect dep array includes userId + queryClient so user switches tear down + reopen the channel",
  hookBody !== "" &&
    /\}\s*,\s*\[\s*userId\s*,\s*queryClient\s*\]\s*\)\s*;?\s*\n?\s*\}\s*;?\s*$/.test(
      hookBody,
    ),
  "Dep array must be `[userId, queryClient]` so a user switch (or logout) re-runs the effect — the cleanup tears down the prior channel and a new one opens for the new user. Without userId in deps, signing out leaves the old channel live (SC-5).",
);

check(
  "A3 Subscribe/removeChannel calls live INSIDE useEffect (not at module or render scope)",
  hookBody !== "" &&
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?supabase[\s\S]*?\.channel\(`tickets:buyer=\$\{userId\}`\)[\s\S]*?\.subscribe\(\)[\s\S]*?return\s*\(\)\s*=>\s*\{[\s\S]*?supabase\.removeChannel\(channel\)[\s\S]*?\}\s*;?\s*\n?\s*\}/.test(
      hookBody,
    ),
  "All side effects (channel open, subscribe, removeChannel) MUST live inside the useEffect callback. Calling supabase.channel() at render scope would open a new channel every render and leak.",
);

check(
  "A4 Fallback layer 1 preserved — useBusinessEventOrders still has refetchOnWindowFocus: true",
  hookSrc !== null &&
    /export const useBusinessEventOrders[\s\S]*?refetchOnWindowFocus:\s*true/.test(
      hookSrc,
    ),
  "Spec explicitly forbids removing the existing window-focus refetch from useBusinessEventOrders — it remains the second-line fallback when realtime fails to connect. SC-6.",
);

check(
  "A5 Fallback layer 2 preserved — ExpandedBusinessEventSheet still has the post-purchase invalidate loop",
  sheetSrc !== null &&
    /invalidateQueries\(\s*\{\s*queryKey:\s*\[[\"']businessEventOrders[\"']/.test(
      sheetSrc,
    ),
  "The 3-attempt-over-3-seconds invalidate loop in ExpandedBusinessEventSheet.handleBuy's success branch is the third fallback layer. Removing it (e.g., 'realtime makes this redundant') silently regresses the buyer who navigates away during the realtime connect handshake. SC-6.",
);

check(
  "A6 useBusinessEventOrders staleTime not regressed (still 60_000 / 60s post-ORCH-0851)",
  hookSrc !== null &&
    /export const useBusinessEventOrders[\s\S]*?staleTime:\s*60\s*\*\s*1000/.test(
      hookSrc,
    ),
  "Post-ORCH-0851 the staleTime was tightened to 60s. A regression to a longer value would extend the worst-case staleness window if realtime fails to connect. SC-6.",
);

check(
  "A7 Tickets channel name does not collide with the orders channel (distinct `tickets:` prefix)",
  hookBody !== "" &&
    /\.channel\(`tickets:buyer=\$\{userId\}`\)/.test(hookBody) &&
    !/\.channel\(`orders:[^`]*`\)/.test(hookBody),
  "The tickets channel name must use a `tickets:` prefix, not the existing `orders:` prefix. Same-name collision would cause Supabase to coalesce both subscriptions onto one channel handle and one cleanup would tear down both.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0854 adversarial check (lifecycle + fallback + scope)\n");
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
