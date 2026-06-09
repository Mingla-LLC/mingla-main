// META-ORCH-1104 Phase 0 — support foundation migration contract test.
//
// Run:
//   deno test --allow-read supabase/migrations/__tests__/meta_orch_1104_support_foundation.test.ts
//
// Pins the Phase-0 DDL/RLS/RPC contract (SPEC §2.1–2.8, §2.6, §3) without a live
// Supabase instance. Happy-path structure + ADVERSARIAL security predicates
// (PII-scoped RLS, admin-only staff writes, restrictive-policy-passes-support).
//
// This test FAILS ON REVERT: if the gate-fix predicates or the support-scoped
// RLS predicates are removed/weakened, the assertions below fail.

import { assert, assertStringIncludes } from "jsr:@std/assert@1";

const FEATURE = await Deno.readTextFile(
  "supabase/migrations/20260921000000_meta_orch_1104_support_foundation.sql",
);
const DROP = await Deno.readTextFile(
  "supabase/migrations/20260922000000_meta_orch_1104_drop_profiles_is_admin.sql",
);

const norm = FEATURE.replace(/\s+/g, " ").trim();

// ── Happy path: tables + helper + RPCs exist ────────────────────────────────
Deno.test("creates support_tickets + support_staff tables with RLS", () => {
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public.support_tickets");
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public.support_staff");
  assertStringIncludes(norm, "ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(norm, "ALTER TABLE public.support_staff ENABLE ROW LEVEL SECURITY");
});

Deno.test("is_support_staff mirrors is_admin_user (SECURITY DEFINER STABLE, authenticated-grant)", () => {
  assertStringIncludes(norm, "FUNCTION public.is_support_staff(p_user_id uuid DEFAULT auth.uid())");
  assertStringIncludes(norm, "SECURITY DEFINER");
  assertStringIncludes(norm, "GRANT EXECUTE ON FUNCTION public.is_support_staff(uuid) TO authenticated");
});

Deno.test("derive_user_segment + profiles_with_segment view (security_invoker)", () => {
  assertStringIncludes(norm, "FUNCTION public.derive_user_segment(p_profile_id uuid)");
  assertStringIncludes(norm, "public.admin_users au");
  assertStringIncludes(norm, "public.brand_team_members btm");
  assertStringIncludes(norm, "VIEW public.profiles_with_segment WITH (security_invoker = true)");
});

Deno.test("create_support_ticket + claim_support_ticket + support_set_available RPCs exist", () => {
  assertStringIncludes(norm, "FUNCTION public.create_support_ticket(p_subject text, p_brand_id uuid DEFAULT NULL)");
  assertStringIncludes(norm, "FUNCTION public.claim_support_ticket(p_ticket_id uuid, p_staff_id uuid)");
  assertStringIncludes(norm, "FUNCTION public.support_set_available(p_available boolean)");
  // claim seeds participant idempotently (SC-0.7)
  assertStringIncludes(norm, "ON CONFLICT (conversation_id, user_id) DO NOTHING");
  // create mints a support conversation (SC-0.1)
  assertStringIncludes(norm, "VALUES ('group','support'");
});

// ── §2.6 'support' linked_entity_type widening (DROP+ADD each) ───────────────
Deno.test("widens conversations CHECKs to admit 'support' (DROP then ADD)", () => {
  assertStringIncludes(norm, "ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_type_check");
  assertStringIncludes(norm, "linked_entity_type IN ('direct','session','trip','event','support')");
  assertStringIncludes(norm, "ALTER TABLE public.conversations DROP CONSTRAINT conversations_linked_entity_coherent");
  assertStringIncludes(norm, "(linked_entity_type = 'support' AND session_id IS NULL AND event_id IS NULL)");
});

// ── §2.5 data-integrity cleanup ─────────────────────────────────────────────
Deno.test("admin_toggle_partner gates on is_admin_user() not account_type (I-1104-ADMIN-GATE-UNIFIED)", () => {
  assertStringIncludes(norm, "FUNCTION public.admin_toggle_partner(p_account_id uuid, p_enabled boolean)");
  assertStringIncludes(norm, "IF NOT public.is_admin_user() THEN");
  // ADVERSARIAL: the old divergent predicate must NOT survive in the rewritten fn.
  assert(
    !/admin_toggle_partner[\s\S]*?p\.account_type\s*=\s*'admin'/.test(FEATURE),
    "admin_toggle_partner must NOT gate on profiles.account_type='admin'",
  );
});

Deno.test("account_type realigned as a CHECK-constrained cache + backfilled from derive_user_segment", () => {
  assertStringIncludes(norm, "ADD CONSTRAINT profiles_account_type_check");
  assertStringIncludes(norm, "account_type IN ('explorer','business','admin')");
  assertStringIncludes(norm, "SET account_type = public.derive_user_segment(p.id)");
});

Deno.test("is_admin is SNAPSHOTTED + DEPRECATED, NOT dropped in the feature migration (SC-0.5)", () => {
  assertStringIncludes(norm, "CREATE TABLE IF NOT EXISTS public._deprecated_profiles_is_admin_backup");
  assertStringIncludes(norm, "[DEPRECATED META-ORCH-1104 D5.1]");
  // ADVERSARIAL: the feature migration must NEVER drop the column.
  assert(
    !/DROP\s+COLUMN[\s\S]*is_admin/i.test(FEATURE),
    "feature migration must NOT drop profiles.is_admin (that is the separate operator-gated file)",
  );
});

Deno.test("the operator-gated DROP lives in a SEPARATE file and is reversible (SC-0.5)", () => {
  assertStringIncludes(DROP, "ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_admin");
  assertStringIncludes(DROP, "OPERATOR-GATED");
  assertStringIncludes(DROP, "_deprecated_profiles_is_admin_backup");
});

// ── §2.7 RLS: support-scoped + admin-only staff write (ADVERSARIAL) ──────────
Deno.test("support chat policies are linked_entity_type='support'-scoped (I-1104-SUPPORT-SCOPED-RLS / T-0.4 PII)", () => {
  for (
    const pol of [
      "conversations_support_staff_read",
      "messages_support_staff_read",
      "messages_support_staff_insert",
      "conversation_presence_support_staff_read",
    ]
  ) {
    assertStringIncludes(norm, pol);
  }
  // Each support_staff chat policy must carry the support scope. Count the
  // policy mentions vs the scope predicate mentions.
  const scopeCount = (norm.match(/linked_entity_type = 'support'/g) ?? []).length;
  assert(
    scopeCount >= 5, // 1 coherent CHECK + 4 chat policies (read/read/insert/presence)
    `expected >=5 linked_entity_type='support' predicates, found ${scopeCount}`,
  );
});

Deno.test("support_staff writes are admin-gated (T-0.3 no self-promote)", () => {
  assertStringIncludes(norm, "CREATE POLICY support_staff_admin_write ON public.support_staff FOR INSERT WITH CHECK (public.is_admin_user())");
});

Deno.test("support_tickets read is requester-own OR staff/admin, NOT blanket-authenticated (T-0.2)", () => {
  assertStringIncludes(
    norm,
    "support_tickets_requester_read ON public.support_tickets FOR SELECT USING (requester_user_id = auth.uid() OR public.is_support_staff(auth.uid()) OR public.is_admin_user())",
  );
});

Deno.test("claim_support_ticket is NOT client-callable (REVOKE from authenticated/anon — T-0.6)", () => {
  assertStringIncludes(norm, "REVOKE ALL ON FUNCTION public.claim_support_ticket(uuid, uuid) FROM anon, authenticated");
  // ADVERSARIAL: it must NOT be granted to authenticated/anon anywhere.
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_support_ticket[^;]+TO\s+(?:anon|authenticated|PUBLIC)/i
      .test(FEATURE),
    "claim_support_ticket must never be GRANTed to a client role",
  );
});
