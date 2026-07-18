// ORCH-1384 — SQL-shape regression for the partner-link lifecycle migration.
//
// Reads the migration file and proves the load-bearing schema + RPC fragments
// are present (house pattern: orch_1054_partner_splits.test.ts). Catches the
// SPEC §9 reverts:
//   - proof 3: dropped invite-kill trigger, or its `accepted_at IS NULL`
//     guard → T-3/T-3c red here.
//   - proof 4: reissue's expire-now changed to a revoke → red here (the
//     reissue body must contain `SET expires_at = now()` and must NOT
//     contain any status→revoked transition).
//   - proof 5: team-stamp removed from partner_disconnect_link → T-8 red.
//   - proof 6: brand soft-delete / invitation revoke removed from
//     partner_cancel_pending_link → T-7 red.
//
// COMMS-0106 discipline: every body-content assert below runs against a
// UNIQUELY-EXTRACTED function body (extractFnBody throws unless the CREATE
// statement appears EXACTLY once), so a comment or a second definition cannot
// satisfy the assert (provenance companion), and orphaning-by-duplication is
// structurally caught.
//
// Run: deno test --allow-read \
//   supabase/migrations/__tests__/orch_1384_partner_link_lifecycle.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const SRC = await Deno.readTextFile(
  new URL(
    "../20270102000000_orch_1384_partner_link_lifecycle.sql",
    import.meta.url,
  ),
);

/** Count non-overlapping occurrences of `needle` in SRC. */
function countOf(needle: string): number {
  return SRC.split(needle).length - 1;
}

/**
 * Extract the body of a CREATE OR REPLACE FUNCTION statement, asserting the
 * declaration appears EXACTLY once (COMMS-0106 provenance companion). The
 * body spans from the declaration to the FIRST `$function$;` after it.
 */
function extractFnBody(decl: string): string {
  const first = SRC.indexOf(decl);
  assert(first >= 0, `declaration missing: ${decl}`);
  assertEquals(
    countOf(decl),
    1,
    `declaration must appear EXACTLY once (COMMS-0106): ${decl}`,
  );
  const end = SRC.indexOf("$function$;", first);
  assert(end > first, `unterminated function body for: ${decl}`);
  return SRC.slice(first, end);
}

// ---------------------------------------------------------------------------
// T-1 — migration objects present
// ---------------------------------------------------------------------------

Deno.test("T-1: cancelled_reason column + named CHECK with the 5 reasons", () => {
  assertStringIncludes(
    SRC,
    "ADD COLUMN IF NOT EXISTS cancelled_reason text",
  );
  assertStringIncludes(SRC, "partner_brand_links_cancelled_reason_check");
  // CHECK is stamp-coupled: a reason REQUIRES cancelled_at.
  assertStringIncludes(SRC, "cancelled_at IS NOT NULL AND cancelled_reason IN");
  for (
    const reason of [
      "'partner_cancelled'",
      "'owner_declined'",
      "'invitation_revoked'",
      "'partner_disconnected'",
      "'owner_removed'",
    ]
  ) {
    assert(countOf(reason) >= 1, `reason value missing from file: ${reason}`);
  }
});

Deno.test("T-1: owner-read RLS policy (inline EXISTS predicate — feedback_rls_returning_owner_gap)", () => {
  assertStringIncludes(SRC, "CREATE POLICY partner_brand_links_owner_select");
  assertStringIncludes(SRC, "FOR SELECT TO authenticated");
  // Inline predicate — never a SECURITY DEFINER helper.
  assertStringIncludes(SRC, "b.account_id = auth.uid()");
});

Deno.test("T-1: post-apply probes assert every object incl. the frozen ORCH-1081 status fn", () => {
  for (
    const probe of [
      "cancelled_reason column missing",
      "cancelled_reason CHECK missing",
      "expected 3 new RPCs",
      "invite-kill trigger missing",
      "owner_select policy missing",
      "partial unique index missing",
      "partner_brand_link_status fn missing",
    ]
  ) {
    assertStringIncludes(SRC, probe);
  }
  // The migration must not touch the frozen ORCH-1081 case tree.
  assertEquals(
    countOf("CREATE OR REPLACE FUNCTION public.partner_brand_link_status"),
    0,
    "the frozen partner_brand_link_status fn must NOT be redefined",
  );
});

// ---------------------------------------------------------------------------
// T-3 / T-3b / T-3c — invitation-kill trigger (fails-on-revert proof 3)
// ---------------------------------------------------------------------------

Deno.test("T-3: invite-kill trigger stamps revoked→invitation_revoked and declined→owner_declined", () => {
  const body = extractFnBody(
    "CREATE OR REPLACE FUNCTION public.partner_brand_links_stamp_on_invite_kill()",
  );
  assertStringIncludes(body, "NEW.role = 'brand_owner'");
  assertStringIncludes(body, "OLD.status = 'pending'");
  assertStringIncludes(body, "NEW.status IN ('revoked','declined')");
  assertStringIncludes(body, "WHEN 'revoked' THEN 'invitation_revoked'");
  assertStringIncludes(body, "ELSE 'owner_declined'");
  assertStringIncludes(
    body,
    "lower(invited_owner_email) = lower(NEW.email)",
  );
  // Trigger registration on the invitations status column.
  assertStringIncludes(
    SRC,
    "CREATE TRIGGER partner_brand_links_invite_kill_trigger",
  );
  assertStringIncludes(
    SRC,
    "AFTER UPDATE OF status ON public.brand_invitations",
  );
});

Deno.test("T-3c: trigger guard ignores accepted links (accepted_at IS NULL)", () => {
  const body = extractFnBody(
    "CREATE OR REPLACE FUNCTION public.partner_brand_links_stamp_on_invite_kill()",
  );
  // BOTH idempotency + accepted-link guards must survive (proof 3 names the
  // accepted_at guard explicitly).
  assertStringIncludes(body, "cancelled_at IS NULL");
  assertStringIncludes(body, "accepted_at IS NULL");
});

// ---------------------------------------------------------------------------
// T-7 — partner_cancel_pending_link (fails-on-revert proof 6)
// ---------------------------------------------------------------------------

Deno.test("T-7: cancel RPC — lock order, quad-outcome, upcoming-events blocker with DETAIL", () => {
  const body = extractFnBody(
    "CREATE OR REPLACE FUNCTION public.partner_cancel_pending_link(p_link_id uuid)",
  );
  // Ownership + typed errors.
  assertStringIncludes(body, "'forbidden'");
  assertStringIncludes(body, "'link_not_found'");
  assertStringIncludes(body, "'link_not_pending'");
  // Lock ORDER is load-bearing: invitation FOR UPDATE must come BEFORE the
  // link's FOR UPDATE re-read (accept-RPC lock order — SC-15 serialization).
  const invitationLock = body.indexOf("FROM public.brand_invitations");
  const linkRelock = body.lastIndexOf("FROM public.partner_brand_links");
  assert(invitationLock >= 0, "invitation lock missing");
  assert(
    linkRelock > invitationLock,
    "link FOR UPDATE re-read must FOLLOW the invitation lock",
  );
  // Re-verify pending after the lock (accept-won race → refuse).
  assertStringIncludes(
    body,
    "v_link.cancelled_at IS NOT NULL OR v_link.accepted_at IS NOT NULL",
  );
  // Upcoming-events blocker (OQ-1384-A) with the count in DETAIL (SC-7).
  assertStringIncludes(body, "'has_upcoming_events'");
  assertStringIncludes(body, "DETAIL = v_upcoming::text");
  assertStringIncludes(body, "e.status IN ('scheduled', 'live')");
  assertStringIncludes(body, "d.end_at > now()");
  // Quad-outcome (proof 6): link stamp + invitation revoke + brand
  // soft-delete + default-brand clear — all inside ONE function body.
  assertStringIncludes(body, "cancelled_reason = 'partner_cancelled'");
  assertStringIncludes(body, "SET status = 'revoked'");
  assertStringIncludes(body, "SET deleted_at = now()");
  assertStringIncludes(body, "SET default_brand_id = NULL");
  // Brand delete is defensively owner-guarded.
  assertStringIncludes(
    body,
    "account_id = v_link.partner_account_id",
  );
  // Link stamped BEFORE the invitation revoke (trigger no-ops on its
  // cancelled_at IS NULL predicate → reason stays partner_cancelled).
  const linkStamp = body.indexOf("cancelled_reason = 'partner_cancelled'");
  const invRevoke = body.indexOf("SET status = 'revoked'");
  assert(
    linkStamp >= 0 && invRevoke > linkStamp,
    "link stamp must PRECEDE the invitation revoke",
  );
});

Deno.test("T-7: cancel RPC grants — authenticated may execute; PUBLIC revoked", () => {
  assertStringIncludes(
    SRC,
    "REVOKE ALL ON FUNCTION public.partner_cancel_pending_link(uuid) FROM PUBLIC",
  );
  assertStringIncludes(
    SRC,
    "GRANT EXECUTE ON FUNCTION public.partner_cancel_pending_link(uuid) TO authenticated",
  );
});

// ---------------------------------------------------------------------------
// T-8 — partner_disconnect_link (fails-on-revert proof 5)
// ---------------------------------------------------------------------------

Deno.test("T-8: disconnect RPC — dual stamp in ONE body; per-caller reason; fail-close guards", () => {
  const body = extractFnBody(
    "CREATE OR REPLACE FUNCTION public.partner_disconnect_link(p_link_id uuid)",
  );
  assertStringIncludes(body, "'link_not_active'");
  assertStringIncludes(body, "'partner_is_owner'");
  // Per-caller reason resolution.
  assertStringIncludes(body, "v_reason := 'partner_disconnected'");
  assertStringIncludes(body, "v_reason := 'owner_removed'");
  // Proof 5 — the money truth: team removed_at stamp in the SAME function
  // body as the link stamp (I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH).
  assertStringIncludes(body, "UPDATE public.brand_team_members");
  assertStringIncludes(body, "SET removed_at = now()");
  assertStringIncludes(body, "role <> 'brand_owner'");
  assertStringIncludes(body, "cancelled_reason = v_reason");
});

Deno.test("T-8 / I-PROPOSED-1384-INFLIGHT-SPLITS-PAY-OUT: NO partner_splits writes in ANY new RPC", () => {
  for (
    const decl of [
      "CREATE OR REPLACE FUNCTION public.partner_cancel_pending_link(p_link_id uuid)",
      "CREATE OR REPLACE FUNCTION public.partner_disconnect_link(p_link_id uuid)",
      "CREATE OR REPLACE FUNCTION public.partner_reissue_brand_invitation(",
    ]
  ) {
    const body = extractFnBody(decl);
    assertEquals(
      body.includes("UPDATE public.partner_splits"),
      false,
      `partner_splits UPDATE found in ${decl}`,
    );
    assertEquals(
      body.includes("INSERT INTO public.partner_splits"),
      false,
      `partner_splits INSERT found in ${decl}`,
    );
    assertEquals(
      body.includes("DELETE FROM public.partner_splits"),
      false,
      `partner_splits DELETE found in ${decl}`,
    );
  }
  // The resolver stays untouched (sole money gate, ORCH-1054).
  assertEquals(
    countOf("resolve_partner_for_brand_at_time"),
    0,
    "the migration must not touch the time-pinned resolver",
  );
});

// ---------------------------------------------------------------------------
// T-4 static leg — reissue expires, NEVER revokes (fails-on-revert proof 4)
// ---------------------------------------------------------------------------

Deno.test("T-4: reissue RPC — expire-now kill; NO revoked transition anywhere in its body", () => {
  const body = extractFnBody(
    "CREATE OR REPLACE FUNCTION public.partner_reissue_brand_invitation(",
  );
  // Expire-now (I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES).
  assertStringIncludes(body, "SET expires_at = now()");
  assertStringIncludes(body, "AND expires_at > now()");
  // Proof 4: a revoke transition would fire the invite-kill trigger and
  // terminally cancel the link being reissued — it must NOT exist here.
  assertEquals(
    body.includes("'revoked'"),
    false,
    "reissue must NEVER write status='revoked' (proof 4)",
  );
  assertEquals(
    body.includes("revoked_at"),
    false,
    "reissue must NEVER stamp revoked_at (proof 4)",
  );
  // The link survives un-cancelled: reissue writes email VALUE + invited_at
  // only, never cancelled_at.
  assertStringIncludes(body, "SET invited_owner_email = p_new_email");
  assertStringIncludes(body, "invited_at = now()");
  assertEquals(
    body.includes("SET cancelled_at"),
    false,
    "reissue must never cancel the link",
  );
  // Fresh invitation stays pending.
  assertStringIncludes(body, "p_expires_at, 'pending'");
});

Deno.test("T-4: reissue RPC grant — service_role ONLY (edge fn owns JWT auth)", () => {
  assertStringIncludes(
    SRC,
    "GRANT EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz) TO service_role",
  );
  assertEquals(
    countOf(
      "GRANT EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz) TO authenticated",
    ),
    0,
    "reissue RPC must NOT be executable by authenticated (A-6)",
  );
});

// ---------------------------------------------------------------------------
// Frozen-surface companions
// ---------------------------------------------------------------------------

Deno.test("frozen surfaces: no accept-RPC redefinition; column names untouched (I-1331)", () => {
  assertEquals(
    countOf("accept_invite_and_transfer_brand_ownership"),
    0,
    "the accept RPC must not be redefined by this migration",
  );
  // No RENAME of any frozen link column.
  assertEquals(countOf("RENAME COLUMN"), 0, "no renames (I-1331)");
});

// ---------------------------------------------------------------------------
// REWORK additions (TEST FAIL P0-1 / P2-2) — effective-grant discipline.
//
// The original T-4 grant test above was a proven FALSE-GREEN (TEST report
// §3 P2-2): it asserted the file TEXT contained `REVOKE ALL ... FROM PUBLIC`
// + `GRANT ... TO service_role` and called that "service_role ONLY", while at
// RUNTIME Supabase's default per-ROLE ACL left anon + authenticated with
// EXECUTE (the ORCH-1338 P2-1 class). The tests below encode the remediation
// shape: the revoke must EXPLICITLY name anon AND authenticated, and the
// hardening migration 20270103000000 must re-assert the full end-state with
// effective-privilege (has_function_privilege) DO-block probes.
//
// Append-only: nothing above this banner was modified.
// ---------------------------------------------------------------------------

const HARDENING_SRC = await Deno.readTextFile(
  new URL(
    "../20270103000000_orch_1384_p0_reissue_grant_hardening.sql",
    import.meta.url,
  ),
);

/** Comment-stripped SQL (COMMS-0106: prose can never satisfy an assertion). */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}
const LIFECYCLE_SQL = stripComments(SRC);
const HARDENING_SQL = stripComments(HARDENING_SRC);

const REISSUE_SIG_SPACED =
  "public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz)";
const CANCEL_SIG = "public.partner_cancel_pending_link(uuid)";
const DISCONNECT_SIG = "public.partner_disconnect_link(uuid)";

/** REVOKE ... ON FUNCTION <sig> ... ; statements in `sql` (provenance-isolated
 *  by the exact signature, matching the tester-guard technique). */
function revokesFor(sql: string, sig: string): string[] {
  return [...sql.matchAll(/REVOKE\s+[\s\S]*?ON\s+FUNCTION[\s\S]*?;/gi)]
    .map((m) => m[0])
    .filter((s) => s.includes(sig));
}

/** The grantee list (text after FROM) of a REVOKE statement. */
function fromList(revoke: string): string {
  return revoke.replace(/^[\s\S]*\bFROM\b/i, "");
}

Deno.test("T-4b (REWORK P0-1): lifecycle reissue REVOKE explicitly strips anon AND authenticated — FROM PUBLIC alone is a proven runtime leak", () => {
  const revokes = revokesFor(LIFECYCLE_SQL, REISSUE_SIG_SPACED);
  assert(
    revokes.length >= 1,
    "lifecycle migration must carry a REVOKE ... ON FUNCTION <reissue> statement",
  );
  const ok = revokes.some((r) => {
    const from = fromList(r);
    return /\banon\b/i.test(from) && /\bauthenticated\b/i.test(from);
  });
  assert(
    ok,
    "reissue is service_role-ONLY (SPEC §4.4 RPC-3 / §7 A-6): the REVOKE must " +
      "name anon AND authenticated explicitly — `REVOKE ... FROM PUBLIC` does " +
      "NOT strip Supabase's default per-ROLE EXECUTE grants (P0-1, ORCH-1338 " +
      "P2-1 class; proven live 2026-07-17).",
  );
});

Deno.test("T-4c (REWORK P0-1/P2-2): hardening migration 20270103000000 revokes per-role and re-grants exactly the intended end-state", () => {
  // Reissue: explicit anon + authenticated + PUBLIC revoke; service_role-only grant.
  const reissueRevokes = revokesFor(HARDENING_SQL, REISSUE_SIG_SPACED);
  assert(reissueRevokes.length >= 1, "hardening must REVOKE on the reissue fn");
  assert(
    reissueRevokes.some((r) => {
      const from = fromList(r);
      return /\bPUBLIC\b/i.test(from) && /\banon\b/i.test(from) &&
        /\bauthenticated\b/i.test(from);
    }),
    "hardening reissue REVOKE must strip PUBLIC, anon AND authenticated",
  );
  const reissueGrants = [
    ...HARDENING_SQL.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?;/gi),
  ].map((m) => m[0]).filter((g) => g.includes(REISSUE_SIG_SPACED));
  assertEquals(reissueGrants.length, 1, "exactly one reissue GRANT expected");
  const reissueGrantees = reissueGrants[0].replace(/^[\s\S]*\bTO\b/i, "");
  assertStringIncludes(reissueGrantees, "service_role");
  assert(
    !/\banon\b/i.test(reissueGrantees) &&
      !/\bauthenticated\b/i.test(reissueGrantees),
    "reissue GRANT must target service_role ONLY",
  );

  // Cancel + disconnect: anon + PUBLIC revoked, authenticated KEPT (in-body
  // auth.uid() forbidden-gate) — the REVOKE must NOT name authenticated.
  for (const sig of [CANCEL_SIG, DISCONNECT_SIG]) {
    const revokes = revokesFor(HARDENING_SQL, sig);
    assert(revokes.length >= 1, `hardening must REVOKE on ${sig}`);
    assert(
      revokes.some((r) => {
        const from = fromList(r);
        return /\bPUBLIC\b/i.test(from) && /\banon\b/i.test(from) &&
          !/\bauthenticated\b/i.test(from);
      }),
      `${sig}: REVOKE must strip PUBLIC + anon and must NOT strip authenticated`,
    );
    const grants = [
      ...HARDENING_SQL.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*?;/gi),
    ].map((m) => m[0]).filter((g) => g.includes(sig));
    assert(
      grants.some((g) =>
        /\bauthenticated\b/i.test(g.replace(/^[\s\S]*\bTO\b/i, ""))
      ),
      `${sig}: authenticated grant must be (re-)asserted`,
    );
  }
});

Deno.test("T-4d (REWORK P2-2): hardening migration carries effective-privilege DO-block asserts + pgrst reload — grants are probed, never assumed", () => {
  // The DO-block must probe has_function_privilege for every role×fn cell of
  // the end-state matrix (9 probes), not just assert file text.
  const probes = [...HARDENING_SQL.matchAll(/has_function_privilege\s*\(/gi)];
  assert(
    probes.length >= 9,
    `expected >= 9 has_function_privilege probes (3 fns x 3 roles), found ${probes.length}`,
  );
  // Fail-loud: a mismatch must abort the migration.
  assert(
    /RAISE\s+EXCEPTION/i.test(HARDENING_SQL),
    "DO-block asserts must RAISE EXCEPTION on drift",
  );
  // Each function's signature must appear in the assert block's probe targets.
  for (
    const compact of [
      "partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)",
      "partner_cancel_pending_link(uuid)",
      "partner_disconnect_link(uuid)",
    ]
  ) {
    assertStringIncludes(
      HARDENING_SQL.replace(/\s+/g, ""),
      compact.replace(/\s+/g, ""),
      `assert block must probe ${compact}`,
    );
  }
  // PostgREST schema-cache reload after the grant change (house pattern,
  // 20261227000000).
  assert(
    /NOTIFY\s+pgrst\s*,\s*'reload schema'/i.test(HARDENING_SQL),
    "hardening must NOTIFY pgrst, 'reload schema'",
  );
});
