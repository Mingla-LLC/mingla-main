#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] ADVERSARIAL check.
 *
 * Companion to `orch-0851-regression-check.mjs`. The happy-path script
 * locks the channel name, filter, invalidate key, and removeChannel
 * cleanup. This adversarial script attacks DIFFERENT angles — lifecycle
 * safety, dep-array correctness, anonymous-safety, and fallback-layer
 * preservation — to satisfy the ORCH-0840 CLOSE Step 0.5 requirement
 * that the adversarial test exercise a different angle than the
 * happy-path test.
 *
 * Coverage angles (all source-level structural):
 *
 * (A1) Anonymous-safety — hook MUST early-return when userId is falsy so
 *      no channel is opened for logged-out users (also covers SC-2).
 * (A2) Dep array MUST include `userId` so a user switch tears down the
 *      old subscription and opens a new one (covers SC-3 cleanup-on-
 *      logout and the user-switch edge case).
 * (A3) Hook body MUST live inside useEffect so subscribe is not called
 *      on every render (would leak channels). React rules of hooks
 *      enforcement.
 * (A4) Fallback layers MUST remain intact — the spec explicitly forbids
 *      removing `refetchOnWindowFocus: true` from useBusinessEventOrders
 *      or the 3-attempt invalidate loop in ExpandedBusinessEventSheet.
 *      A regression here would silently break post-purchase freshness
 *      when realtime fails to connect.
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

// Extract the useOrdersRealtimeSubscription function body for tighter checks.
const hookMatch =
  hookSrc &&
  hookSrc.match(
    /export const useOrdersRealtimeSubscription\s*=[\s\S]*?\n\};/,
  );
const hookBody = hookMatch ? hookMatch[0] : "";

check(
  "A1 Hook early-returns when userId is falsy (no channel for anonymous users)",
  hookBody !== "" &&
    /useEffect\(\(\)\s*=>\s*\{\s*\n?\s*if\s*\(!userId\)\s*return;?/.test(
      hookBody,
    ),
  "Hook must guard with `if (!userId) return;` at the top of the useEffect so logged-out sessions don't open a channel against an undefined user id (would crash or subscribe to nothing). Spec SC-2.",
);

check(
  "A2 useEffect dep array includes userId so user switches tear down + reopen the channel",
  hookBody !== "" &&
    /\}\s*,\s*\[\s*userId\s*,\s*queryClient\s*\]\s*\)\s*;?\s*\n?\s*\}\s*;?\s*$/.test(
      hookBody,
    ),
  "Dep array must be `[userId, queryClient]` so a user switch (or logout) re-runs the effect — the cleanup tears down the prior channel and a new one opens for the new user. Without userId in deps, signing out leaves the old channel live (spec SC-3).",
);

check(
  "A3 Subscribe/removeChannel calls live INSIDE useEffect (not at module or render scope)",
  hookBody !== "" &&
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?supabase[\s\S]*?\.channel\(`orders:buyer_user_id=eq\.\$\{userId\}`\)[\s\S]*?\.subscribe\(\)[\s\S]*?return\s*\(\)\s*=>\s*\{[\s\S]*?supabase\.removeChannel\(channel\)[\s\S]*?\}\s*;?\s*\n?\s*\}/.test(
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
  "Spec explicitly forbids removing the existing window-focus refetch from useBusinessEventOrders — it remains the second-line fallback when realtime fails to connect. Removing it makes the app silently regress for users with realtime disabled.",
);

check(
  "A5 Fallback layer 2 preserved — ExpandedBusinessEventSheet still has the post-purchase invalidate loop",
  sheetSrc !== null &&
    /invalidateQueries\(\s*\{\s*queryKey:\s*\[[\"']businessEventOrders[\"']/.test(
      sheetSrc,
    ),
  "The 3-attempt-over-3-seconds invalidate loop in ExpandedBusinessEventSheet.handleBuy's success branch is the third fallback layer. Removing it (e.g., 'realtime makes this redundant') silently regresses the buyer who navigates away during the realtime connect handshake.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0851 adversarial check (lifecycle + fallback)\n");
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
