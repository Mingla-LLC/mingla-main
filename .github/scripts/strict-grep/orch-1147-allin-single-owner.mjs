#!/usr/bin/env node
/**
 * ORCH-1147 (SC-11) — the per-tier server all-in
 * (`pg_public_event_tier_allin`) has exactly ONE owner of the RPC call:
 * `fetchTierAllInCents` in `mingla-business/src/services/publicEventsService.ts`.
 *
 * The trip producer (`getPublicTripById`, same file) and the experience
 * service (`publicExperienceService.ts`) MUST reuse that single helper — they
 * IMPORT/CALL it, they do NOT call the RPC themselves and do NOT recompute
 * fees in TS. This catches a future duplicate-RPC / re-derived-fee regression
 * that would re-introduce the two-source drift ORCH-1147 eliminated.
 *
 * The gate fails if:
 *   (a) `pg_public_event_tier_allin` is referenced anywhere OTHER than
 *       publicEventsService.ts (the single owner), OR
 *   (b) the trip-tier / experience source services contain the RPC string at
 *       all (`tripsService.ts`, `publicExperienceService.ts`).
 *
 * Comments are stripped so explanatory ORCH-1147 prose never trips the gate.
 * Mirrors the modular gate pattern (sibling: orch-1147-cart-total-is-allin.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];

const RPC = "pg_public_event_tier_allin";

// The ONLY file allowed to call the RPC (single owner = fetchTierAllInCents).
const OWNER = "mingla-business/src/services/publicEventsService.ts";

// Files that MUST reuse the helper, never the RPC directly.
const REUSERS = [
  "mingla-business/src/services/tripsService.ts",
  "mingla-business/src/services/publicExperienceService.ts",
];

// Strip line + block comments so prose mentioning the RPC never trips.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// --- self-test fixtures (run with --self-test) ----------------------------
const SELF_TEST = process.argv.includes("--self-test");

const evaluateReuser = (rel, rawCode) => {
  const code = stripComments(rawCode);
  if (code.includes(RPC)) {
    return [
      `${rel}: references ${RPC} directly. The single owner is fetchTierAllInCents in publicEventsService.ts — import + reuse it, do NOT duplicate the RPC or recompute fees. ORCH-1147 SC-11.`,
    ];
  }
  return [];
};

const evaluateOwner = (rel, rawCode) => {
  const code = stripComments(rawCode);
  // The owner must actually own the RPC (the single call site).
  if (!code.includes(RPC)) {
    return [
      `${rel}: the single-owner helper fetchTierAllInCents must call ${RPC}, but the RPC string is missing. ORCH-1147 SC-11.`,
    ];
  }
  // …and must export the helper so reusers can call it.
  if (!/export\s+const\s+fetchTierAllInCents\b/.test(code)) {
    return [
      `${rel}: fetchTierAllInCents must be EXPORTED so the experience service reuses the single owner. ORCH-1147 SC-11.`,
    ];
  }
  return [];
};

if (SELF_TEST) {
  const GOOD_OWNER = `
    export const fetchTierAllInCents = async (eventId) => {
      const { data } = await supabase.rpc("pg_public_event_tier_allin", { p_event_id: eventId });
      return data;
    };
  `;
  const BAD_OWNER_NOEXPORT = `
    const fetchTierAllInCents = async (eventId) => {
      const { data } = await supabase.rpc("pg_public_event_tier_allin", { p_event_id: eventId });
      return data;
    };
  `;
  const GOOD_REUSER = `
    import { fetchTierAllInCents } from "./publicEventsService";
    const m = await fetchTierAllInCents(eventId);
  `;
  const BAD_REUSER = `
    const { data } = await supabase.rpc("pg_public_event_tier_allin", { p_event_id: eventId });
  `;
  const ok =
    evaluateOwner("owner.ts", GOOD_OWNER).length === 0 &&
    evaluateOwner("owner-noexport.ts", BAD_OWNER_NOEXPORT).length >= 1 &&
    evaluateReuser("reuser-good.ts", GOOD_REUSER).length === 0 &&
    evaluateReuser("reuser-bad.ts", BAD_REUSER).length >= 1;
  if (!ok) {
    console.error("ORCH-1147 allin-single-owner SELF-TEST failed.");
    process.exit(1);
  }
  console.log("ORCH-1147 allin-single-owner gate self-test passed.");
  process.exit(0);
}

const ownerAbs = join(root, OWNER);
if (!existsSync(ownerAbs)) {
  failures.push(`${OWNER}: single-owner service not found.`);
} else {
  failures.push(
    ...evaluateOwner(relative(root, ownerAbs), readFileSync(ownerAbs, "utf8")),
  );
}

for (const rel of REUSERS) {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    failures.push(`${rel}: expected reuser service not found.`);
    continue;
  }
  failures.push(
    ...evaluateReuser(relative(root, abs), readFileSync(abs, "utf8")),
  );
}

if (failures.length > 0) {
  console.error("ORCH-1147 allin-single-owner gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1147 allin-single-owner gate passed.");
