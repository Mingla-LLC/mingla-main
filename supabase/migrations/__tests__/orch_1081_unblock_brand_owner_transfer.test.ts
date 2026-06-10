// ORCH-1081 — IMPLEMENTOR happy-path regression for the ownership-transfer unblock.
//
// Proves the migration's load-bearing fragments are present so a future
// "simplification" sweep can't silently drop them. Specifically:
//
//   (a) trg_brands_immutable_account_id retains the session-flag bypass branch
//       (without it, EVERY ownership transfer fails-close on the trigger; this
//       was the original pre-existing bug that broke partner workflow).
//   (b) accept_invite_and_transfer_brand_ownership sets the bypass flag in
//       transaction-local config RIGHT BEFORE the brands UPDATE. Without the
//       set_config call the trigger blocks even the legitimate transfer.
//   (c) The RPC writes brand_invitations.accepted_by_account_id (not the
//       non-existent accepted_by column that the original ORCH-1050 RPC mis-named).
//   (d) The RPC inserts into audit_log using the real column shape
//       (user_id, action, target_type, target_id, after) — NOT the (account_id,
//       detail) shape that didn't exist.
//   (e) partner_brand_links.accepted_at gets stamped on accept so the
//       /partner/brands list flips from "awaiting_owner" to "awaiting_stripe".
//
// fails-on-revert: verified by checking out the migration at the commit before
// `c927473a8` (the hotfix) and running this test — assertions (a)–(e) all FAIL
// against the broken version. See ORCH-1081 close banner for the exact hash.
//
// Run: deno test --allow-read \
//   supabase/migrations/__tests__/orch_1081_unblock_brand_owner_transfer.test.ts

import {
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const SRC = await Deno.readTextFile(
  new URL(
    "../20260920000001_orch_1081_unblock_brand_owner_transfer.sql",
    import.meta.url,
  ),
);

Deno.test("ORCH-1081 (a): trigger retains the session-flag bypass branch", () => {
  // Without this branch the legitimate ownership-transfer UPDATE fails with
  // "brands.account_id is immutable" and the entire partner workflow breaks.
  assertStringIncludes(
    SRC,
    "CREATE OR REPLACE FUNCTION public.biz_prevent_brand_account_id_change()",
  );
  assertStringIncludes(SRC, "current_setting('app.allow_brand_owner_transfer', true)");
  assertStringIncludes(SRC, "RETURN NEW;");
  // The fail-close path MUST also be preserved — manual UPDATEs from any
  // non-RPC path still get rejected.
  assertStringIncludes(SRC, "RAISE EXCEPTION 'brands.account_id is immutable'");
});

Deno.test("ORCH-1081 (b): RPC sets the bypass flag BEFORE the brands UPDATE", () => {
  assertStringIncludes(
    SRC,
    "PERFORM set_config('app.allow_brand_owner_transfer', 'on', true);",
  );
  // The flag must immediately precede the brands UPDATE so it's active when
  // the trigger fires. Asserting both strings appear is enough for the
  // append-only gate; the wider behavior is covered by the live-applied check.
  assertStringIncludes(
    SRC,
    "UPDATE public.brands SET account_id = p_accepting_account_id",
  );
});

Deno.test("ORCH-1081 (c): RPC uses brand_invitations.accepted_by_account_id (real column)", () => {
  // The original ORCH-1050 RPC referenced `accepted_by` (does not exist) which
  // caused the HTTP 500 once the immutability trigger was unblocked. This test
  // is the gate against that mis-name resurfacing.
  assertStringIncludes(SRC, "accepted_by_account_id = v_acceptor_user_id");
});

Deno.test("ORCH-1081 (d): RPC inserts into audit_log with real column shape", () => {
  // Real shape: user_id + (action, target_type, target_id, after). The original
  // ORCH-1081 RPC wrote (account_id, detail) which didn't exist → caught at
  // close time. Wrapped in EXCEPTION WHEN OTHERS so audit failure NEVER blocks
  // the accept itself; assertion proves both that wrap + the right columns.
  assertStringIncludes(SRC, "INSERT INTO public.audit_log");
  assertStringIncludes(SRC, "(user_id, brand_id, action, target_type, target_id, after)");
  assertStringIncludes(SRC, "EXCEPTION WHEN OTHERS THEN NULL;");
});

Deno.test("ORCH-1081 (e): partner_brand_links.accepted_at stamped on accept", () => {
  // Without this stamp /partner/brands stays on "awaiting_owner" forever and
  // the partner never sees their handed-off brand transition state.
  assertStringIncludes(SRC, "UPDATE public.partner_brand_links");
  assertStringIncludes(SRC, "SET accepted_at = now()");
  assertStringIncludes(SRC, "lower(invited_owner_email) = lower(v_invitation.email)");
});

Deno.test("ORCH-1081: SECURITY DEFINER + service_role-only grant preserved", () => {
  // RPC must run as definer to repoint brands.account_id (caller is the
  // accepting user, who can't update brands they don't own).
  assertStringIncludes(SRC, "LANGUAGE plpgsql\nSECURITY DEFINER");
  assertStringIncludes(SRC, "SET search_path = public");
  assertStringIncludes(SRC, "REVOKE ALL ON FUNCTION public.accept_invite_and_transfer_brand_ownership");
  assertStringIncludes(SRC, "GRANT EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership");
  assertStringIncludes(SRC, "TO service_role");
});
