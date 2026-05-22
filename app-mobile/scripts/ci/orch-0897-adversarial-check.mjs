#!/usr/bin/env node
// ORCH-0897 [Trips + Events Group Chat] — TESTER ADVERSARIAL regression check.
//
// Different attack angles than the implementor's happy-path check at
// app-mobile/scripts/ci/orch-0897-regression-check.mjs (which mostly asserts
// migration TEXT contains expected SQL strings via regex).
//
// Adversarial angles attacked here:
//   TA-01  Defense against base64url regression (Postgres encode() rejects this literal)
//   TA-02  Defense against bare gen_random_bytes regression (pgcrypto lives in extensions schema)
//   TA-03  UNIQUE indexes are PARTIAL (WHERE clause present) — without it idempotency breaks
//   TA-04  RESTRICTIVE keyword on broadcast-only policy — without it the constraint is bypassed via OR-combination
//   TA-05  SECURITY DEFINER on trigger + helper — without it RLS would block trigger writes
//   TA-06  SET search_path = public on SECURITY DEFINER — defense against search_path injection
//   TA-07  Trigger gate condition for event_type='experience' exclusion present
//   TA-08  Backfill row-count assertion uses RAISE EXCEPTION (not RAISE NOTICE)
//   TA-09  brand_team_members ACTIVE membership predicate present in all 3 ORCH-0897 RLS policies
//   TA-10  No SECURITY DEFINER helper called from SELECT policy bodies (I-PROPOSED-CHAT-RLS-INLINE-EXISTS)
//   TA-11  marketing-send blast→chat fan-out writes ONE row per CAMPAIGN (not per recipient)
//   TA-12  marketing-send blast→chat path is best-effort (failure does NOT throw and abort email)
//   TA-13  Deep-link handler accepts /orders/<id>/chat path
//   TA-14  claim_token column has UNIQUE constraint (without it the claim flow can collide)
//   TA-15  pending_trip_chat_claims has RLS ENABLED with ZERO policies (service-role only access)
//
// Fails-on-revert: re-running this script against the parent commit of
// `b76467755e07` (Codex implementation) MUST produce >=1 failed assertion
// (most likely TA-04 RESTRICTIVE or TA-13 deep-link or TA-15 claims-RLS).
//
// Codified per ORCH-0840 Step 0.5 regression-test gate.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function readFileOrNull(rel) {
  try {
    return readFileSync(path.join(repoRoot, rel), "utf-8");
  } catch {
    return null;
  }
}

const migration = readFileOrNull(
  "supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql",
);
const marketingSend = readFileOrNull("supabase/functions/marketing-send/index.ts");
const deepLink = readFileOrNull("app-mobile/src/services/deepLinkService.ts");

let pass = 0;
let fail = 0;

function check(name, condition, hint) {
  if (condition) {
    console.log(`PASS ${name}`);
    pass += 1;
  } else {
    console.log(`FAIL ${name} — ${hint}`);
    fail += 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 1: defenses against the two migration hotfix regressions
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-01 migration must not contain bare 'base64url' as encode() argument",
  migration !== null && !/encode\([^)]*'base64url'/.test(migration),
  "Postgres encode() supports only base64/hex/escape. base64url literal triggers SQLSTATE 22023.",
);

check(
  "TA-02 migration must use extensions.gen_random_bytes (never bare gen_random_bytes)",
  migration !== null &&
    /extensions\.gen_random_bytes\(24\)/.test(migration) &&
    !/(?<!\.|extensions\.)gen_random_bytes\(/.test(migration),
  "pgcrypto is installed in the `extensions` schema on Supabase. Bare gen_random_bytes() triggers SQLSTATE 42883.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 2: idempotency uniqueness must be PARTIAL
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-03a messages_unique_blast_per_conversation is PARTIAL (WHERE marketing_campaign_id IS NOT NULL)",
  migration !== null &&
    /CREATE UNIQUE INDEX[^;]*messages_unique_blast_per_conversation[^;]*WHERE[^;]*marketing_campaign_id IS NOT NULL/s.test(
      migration,
    ),
  "Without the WHERE clause, regular DM messages (marketing_campaign_id IS NULL) would collide.",
);

check(
  "TA-03b pending_trip_chat_claims_order_unclaimed is PARTIAL (WHERE claimed_at IS NULL)",
  migration !== null &&
    /CREATE UNIQUE INDEX[^;]*pending_trip_chat_claims_order_unclaimed[^;]*WHERE[^;]*claimed_at IS NULL/s.test(
      migration,
    ),
  "Without the WHERE clause, a buyer who buys the same trip twice and claims the first cannot get a second unclaimed row.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 3: RESTRICTIVE keyword on broadcast-only policy
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-04 messages_broadcast_only_enforcement policy declared AS RESTRICTIVE",
  migration !== null &&
    /CREATE POLICY messages_broadcast_only_enforcement[\s\S]*?AS RESTRICTIVE/.test(
      migration,
    ),
  "Without AS RESTRICTIVE, the new policy is OR'd permissively with existing INSERT policies and the broadcast-only constraint is bypassed.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 4: SECURITY DEFINER + search_path lock on trigger/helper
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-05a ensure_group_conversation_on_event_create is SECURITY DEFINER",
  migration !== null &&
    /CREATE OR REPLACE FUNCTION public\.ensure_group_conversation_on_event_create[\s\S]*?SECURITY DEFINER/.test(
      migration,
    ),
  "Without SECURITY DEFINER, the trigger runs as the inserting user and RLS blocks the conversations insert.",
);

check(
  "TA-05b add_buyer_to_event_chat is SECURITY DEFINER",
  migration !== null &&
    /CREATE OR REPLACE FUNCTION public\.add_buyer_to_event_chat[\s\S]*?SECURITY DEFINER/.test(
      migration,
    ),
  "Without SECURITY DEFINER, the helper called from biz_ticket_checkout_finalize cannot write to conversation_participants or pending_trip_chat_claims.",
);

check(
  "TA-06 both SECURITY DEFINER functions SET search_path = public (anti-injection)",
  migration !== null &&
    (migration.match(/SECURITY DEFINER[\s\S]*?SET search_path = public/g) || []).length >= 2,
  "search_path injection is a documented attack class on SECURITY DEFINER PL/pgSQL — pinning to public mitigates.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 5: experience exclusion
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-07 trigger explicitly excludes event_type='experience' via early-return",
  migration !== null &&
    /IF NEW\.event_type NOT IN \('event', 'trip'\)[\s\S]*?RETURN NEW/.test(migration),
  "Without the exclusion, experience-type events would also auto-create group chats — out of scope per operator decision 2026-05-21.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 6: backfill assertion strength
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-08 backfill row-count assertion uses RAISE EXCEPTION (not RAISE NOTICE)",
  migration !== null &&
    /IF v_actual < v_expected THEN[\s\S]*?RAISE EXCEPTION/.test(migration),
  "RAISE NOTICE on mismatch leaves the migration in a half-applied state. RAISE EXCEPTION rolls back atomically.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 7: active-membership predicate consistency across RLS policies
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-09 all 3 ORCH-0897 RLS policies require accepted_at IS NOT NULL AND removed_at IS NULL",
  migration !== null &&
    (migration.match(/accepted_at IS NOT NULL[\s\S]{0,200}?removed_at IS NULL/g) || []).length >= 3,
  "Without active-membership predicate, removed brand_team_members would retain chat access — security violation.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 8: no SECURITY DEFINER helpers in SELECT policies (I-PROPOSED-CHAT-RLS-INLINE-EXISTS)
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-10 RLS SELECT policies use inline EXISTS — not SECURITY DEFINER helper calls",
  migration !== null &&
    /CREATE POLICY conversations_brand_team_member_read[\s\S]*?USING[\s\S]*?EXISTS \([\s\S]*?FROM public\.brand_team_members/.test(
      migration,
    ) &&
    !/CREATE POLICY messages_brand_team_member_read[\s\S]*?USING[\s\S]*?has_thread_access\(/.test(
      migration,
    ),
  "I-PROPOSED-CHAT-RLS-INLINE-EXISTS forbids SECURITY DEFINER helpers in SELECT bodies (RLS-RETURNING-OWNER-GAP class).",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 9: marketing-send fan-out scope
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-11 marketing-send invokes writeBlastIntoEventChat exactly once (one chat write per campaign, not per recipient)",
  marketingSend !== null &&
    // Helper is DEFINED once and CALLED once. Total occurrences should be exactly
    // 2 (declaration + single invocation site). More than 2 implies multiple call
    // sites, most likely a per-recipient loop iteration.
    (marketingSend.match(/writeBlastIntoEventChat/g) || []).length === 2,
  "ONE chat message per campaign — not per recipient. Multiple call sites would mean per-recipient invocation, which the idempotency partial UNIQUE would block N-1 times while emitting noise.",
);

check(
  "TA-12 marketing-send blast→chat failure is non-fatal (does not throw past the email path)",
  marketingSend !== null &&
    // The helper call should be wrapped in try/catch OR explicitly swallow
    // errors. Conservative check: presence of try-catch around the helper.
    /try\s*\{[\s\S]{0,800}writeBlastIntoEventChat[\s\S]{0,400}\}\s*catch/.test(marketingSend),
  "Email already sent; chat fan-out is best-effort. Throw would abort the send and double-bill the email rate limit on retry.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 10: deep-link routing surface
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-13 deepLinkService routes /orders/<id>/chat to a handler with claim params",
  deepLink !== null &&
    /case 'orders':[\s\S]{0,300}pathSegments\[2\] === 'chat'/.test(deepLink) &&
    /claimPendingTripChats|claim_and_open_chat|claimToken/.test(deepLink),
  "Without the orders/chat route, web confirmation CTA and email CTA both 404 in the app.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 11: claim_token UNIQUE constraint
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-14 pending_trip_chat_claims.claim_token has UNIQUE constraint",
  migration !== null &&
    /claim_token text NOT NULL UNIQUE/.test(migration),
  "Without UNIQUE, two anon buyers could collide on the same token (cryptographically unlikely with 24 bytes, but a missing constraint is a silent invariant violation).",
);

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial angle 12: claims table is RLS-locked (no user policies)
// ─────────────────────────────────────────────────────────────────────────────

check(
  "TA-15 pending_trip_chat_claims enables RLS but defines zero user-side policies (service-role only)",
  migration !== null &&
    /ALTER TABLE public\.pending_trip_chat_claims ENABLE ROW LEVEL SECURITY/.test(migration) &&
    !/CREATE POLICY[^;]*ON public\.pending_trip_chat_claims/.test(migration),
  "Per SPEC §3.4: claim flow goes through claim-pending-trip-chat-participation edge function (service-role bouncer). Direct user access must be blocked.",
);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log("");
if (fail === 0) {
  console.log(`ORCH-0897 adversarial check passed: ${pass}/${pass + fail}`);
  process.exit(0);
} else {
  console.log(`ORCH-0897 adversarial check FAILED: ${fail} failure(s) out of ${pass + fail}`);
  process.exit(1);
}
