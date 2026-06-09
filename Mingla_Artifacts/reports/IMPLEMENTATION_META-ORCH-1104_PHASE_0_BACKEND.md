# IMPLEMENTATION — META-ORCH-1104 Phase 0 — Support Live-Chat + Tickets + Segmentation (Backend Foundation)

**Skill:** mingla-implementor (IMPLEMENT)
**Date:** 2026-06-08
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]/` on branch `meta-orch-1104-support-livechat-segmentation`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1104_SUPPORT_LIVECHAT_TICKETS_SEGMENTATION.md` §2 / §3 / §4
**Scope:** Phase 0 backend only. No UI. No OTA. No remote apply.
**Status:** implemented and verified (static + unit; live-DB RLS via the operator-applied probe).

---

## 1. What was built (mapped to SPEC §4.1)

1. **Feature migration** `supabase/migrations/20260921000000_meta_orch_1104_support_foundation.sql` —
   `support_tickets` (§2.1) + `support_staff` (§2.2) + `support_audit_log` (§3.2 #7);
   `is_support_staff()` (§2.3); `derive_user_segment()` + `profiles_with_segment` view (§2.4);
   data-integrity cleanup (§2.5: `admin_toggle_partner` rewritten to `is_admin_user()`;
   `account_type` CHECK + backfill; `is_admin` **snapshot + deprecate ONLY**, NO drop);
   the 3-constraint `'support'` widening (§2.6, DROP+ADD each);
   `create_support_ticket` + `claim_support_ticket` + `support_set_available` RPCs (§2.8/§2.7);
   all RLS policies (§2.7); `support_tickets` added to `supabase_realtime`.
2. **Operator-gated drop migration** `supabase/migrations/20260922000000_meta_orch_1104_drop_profiles_is_admin.sql`
   (§2.5.1 Step B) — written, **NOT applied with the feature migration**. Reversible via the snapshot.
3. **Edge functions** (§2.9): `support-claim`, `support-send`, `support-set-status`,
   `support-grant-staff`, `notify-support` (internal push fan-out). Plus the `notify-dispatch`
   D6 dead-gate fix.
4. **Router patch** `mingla-business/src/services/businessNotificationRouting.ts` —
   `business.support_*` case + `support/{ticketId}` deep-link parse → `/support/[ticketId]`.
5. **CI:** `META_ORCH_1104_BACKEND_ALLOWLIST` (COMMS-0002, §2.11) wired into C7;
   new strict-grep gate `i-meta-orch-1104-support-backend-invariants.mjs` (4 invariants) +
   registered in `strict-grep-mingla-business.yml`.
6. **config.toml** verify_jwt entries (true for the 4 caller fns; false for the internal `notify-support`).
7. **Regression tests** (Step 0.5 gate) — see §5.

TS-type regen (§4.1 #6) is deferred to Phase 1 (it needs the migration applied first; the types
file is consumed only by Phases 1–3). Flagged below in Deviations.

---

## 2. Files changed (with the closing-commit hash)

Committed on branch `meta-orch-1104-support-livechat-segmentation` at **`<COMMIT_HASH>`** (see chat).

| File | New/Mod | What |
|---|---|---|
| `supabase/migrations/20260921000000_meta_orch_1104_support_foundation.sql` | NEW | Phase-0 feature migration (DDL/RLS/RPC). |
| `supabase/migrations/20260922000000_meta_orch_1104_drop_profiles_is_admin.sql` | NEW | Operator-gated `is_admin` DROP (Step B). |
| `supabase/migrations/__tests__/meta_orch_1104_support_foundation.test.ts` | NEW | Migration contract test (13 cases, happy + adversarial). |
| `supabase/migrations/__tests__/meta_orch_1104_support_rls_probe.sql` | NEW | Live RLS / restrictive-policy read-only probe (operator/tester runs). |
| `supabase/functions/support-claim/index.ts` | NEW | Claim ticket (staff/admin gate → `claim_support_ticket`). |
| `supabase/functions/support-send/index.ts` | NEW | Insert message + first_response/last_message bump + push. |
| `supabase/functions/support-set-status/index.ts` | NEW | Legal status/priority transitions. |
| `supabase/functions/support-set-status/statusLogic.ts` | NEW | Pure transition logic. |
| `supabase/functions/support-set-status/statusLogic.test.ts` | NEW | Transition unit test (4 cases incl. adversarial). |
| `supabase/functions/support-grant-staff/index.ts` | NEW | Admin roster write (admin-only). |
| `supabase/functions/notify-support/index.ts` | NEW | Internal push fan-out producer (D6). |
| `supabase/functions/notify-dispatch/index.ts` | MOD | D6 dead-gate fix + support→messages mapping. |
| `supabase/functions/notify-dispatch/__tests__/meta_orch_1104_d6_pref_gate.test.ts` | NEW | D6 fix regression (3 cases). |
| `mingla-business/src/services/businessNotificationRouting.ts` | MOD | `business.support_*` routing case. |
| `mingla-business/src/services/__tests__/businessNotificationRouting.support.test.ts` | NEW | Support routing regression (5 cases). |
| `supabase/config.toml` | MOD | verify_jwt for the 5 support fns. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | MOD | `META_ORCH_1104_BACKEND_ALLOWLIST` (COMMS-0002). |
| `.github/scripts/strict-grep/i-meta-orch-1104-support-backend-invariants.mjs` | NEW | 4-invariant gate. |
| `.github/workflows/strict-grep-mingla-business.yml` | MOD | Register the new gate. |

---

## 3. MIGRATION APPLY COMMAND (operator runs — DO NOT apply with this work)

> The implementor never runs `supabase db push`. Apply the **feature migration ONLY**; the
> `is_admin` DROP (Step B) is a SEPARATE operator-gated file — do NOT apply it now.

Pre-flight (confirm no remote-only versions):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]" && /Users/sethogieva/bin/supabase migration list --linked
```
Apply the Phase-0 feature migration:
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]" && /Users/sethogieva/bin/supabase db push --linked
```
**Monotonicity note:** the remote migration head is `20260917000000`. `20260920000000_orch_1081`
exists locally (and in sibling worktrees) but is NOT yet applied remotely — so on a normal
`db push` it will be applied first, then `20260921000000` (this work), in order. No `--include-all`
needed (these are the newest two versions, in order). If `migration list` shows `20260920000000`
already remote, the push is still in-order. The operator-gated drop (`20260922000000`) is applied
LATER, on Seth's explicit go, after Phase 0 soaks.

---

## 4. Remote read-only probe results (captured 2026-06-08 via Management API execute_sql; never mutated)

| Probe | Result | Why it matters |
|---|---|---|
| `profiles.is_admin` true/notnull | 38 rows, **0 true**, 38 not-null | Blast radius ≈ 0 → snapshot-then-deprecate is safe; drop is reversible (SPEC D5.1 / Lane B §3). |
| `profiles.account_type` distinct | `{null:35, business:2, admin:1}` | All values ∈ `{explorer,business,admin,NULL}` → the new CHECK passes existing rows. |
| `derive_user_segment` inline counts | **admin=1, business=13, explorer=24** | Matches SPEC SC-0.3 exactly. |
| `conversations` CHECK constraints | names+defs identical to SPEC §2.6 | DROP CONSTRAINT targets the exact live constraint names. |
| `conversations_group_requires_name` | already requires non-empty trimmed name for `type='group'` | No DROP/ADD needed (SPEC §2.6 (3)). |
| `can_insert_message_into_conversation` | for `'support'` takes the `(<> ALL(trip,event))` branch = **TRUE** | RESTRICTIVE `messages_broadcast_only_enforcement` **passes** a support insert (SPEC §2.7 VERIFY / SC-0.6). |
| `notification_preferences` columns | boolean-per-category (`messages`,`marketing`,`push_enabled`,…); **no** `channel`/`type`/`opt_in` | Confirms the D6 dead-gate fact (Lane A F5.5b); the fix reads `push_enabled` + the mapped category boolean (`messages`). |
| `admin_toggle_partner` live def | gated on `profiles.account_type='admin'` | Confirms the divergence bug; rewrite gates on `is_admin_user()` (verbatim re-declare, gate-block only changed). |
| `is_admin_user()` signature | `() → boolean` | Rewrite calls `public.is_admin_user()` (no args). |
| `supabase_realtime` `puballtables` | **false**; `conversations`/`messages` individually listed | `ALTER PUBLICATION … ADD TABLE support_tickets` is the correct idiom, won't error. |
| `conversation_participants` unique | `(conversation_id, user_id)` unique index present | `claim_support_ticket` `ON CONFLICT (conversation_id, user_id)` is valid (SC-0.7 idempotent seed). |

No migration pre-flight `RAISE EXCEPTION` guard exists in this work that could abort against
remote rows; the CHECK + backfill are over verified-compatible data.

---

## 5. Regression tests (Step 0.5 gate)

All run with `/Users/sethogieva/.deno/bin/deno` + `npx jest`. Revert-baseline commit = **`f0e35b915`**.

| Test | Cases | Run | Fails-on-revert |
|---|---|---|---|
| `meta_orch_1104_support_foundation.test.ts` (happy + adversarial migration contract) | 13 | **13 passed** | ✅ — mangling `create_support_ticket`'s support-conversation mint → 1 failed; restore → 13 passed. |
| `notify-dispatch/__tests__/meta_orch_1104_d6_pref_gate.test.ts` (D6 regression) | 3 | **3 passed** | ✅ — reintroducing the dead `row.channel` read → 2 failed; restore → 3 passed. |
| `support-set-status/statusLogic.test.ts` (incl. adversarial illegal-transition) | 4 | **4 passed** | (pure-logic; covered by the gate + contract). |
| `businessNotificationRouting.support.test.ts` (Jest, support routing) | 5 | **5 passed** | revert the support case → falls to ACCOUNT_FALLBACK → RED. |

**Adversarial coverage (SPEC test cases):**
- **T-0.2** (requester B reads A's case) → asserted by the `support_tickets_requester_read` predicate test + the live probe (E).
- **T-0.3** (non-staff self-promote) → `support_staff_admin_write` is `is_admin_user()`-only (contract test + probe C).
- **T-0.4** (staff read a NON-support DM = PII boundary) → all 4 chat policies carry `linked_entity_type='support'` (contract test + strict-grep INV-C + probe B).
- **T-0.6** (spoofed `claim_support_ticket`) → `REVOKE … FROM anon, authenticated` + never GRANTed to a client role (contract test + probe D).
- **T-0.7** (D6 dead-gate) → the gate now reads real columns; reintroducing the dead read fails the test (proven).
- **T-0.8** (`admin_toggle_partner` divergence) → gates on `is_admin_user()`, old predicate absent (contract test).
- **T-0.9 / SC-0.5** (`is_admin` reversibility) → column present + snapshot table + Step-B file exists, unapplied (contract test + probe F).
- **§2.7 VERIFY** (restrictive policy passes 'support') → live probe (A) + the remote `can_insert_message_into_conversation` probe above.

The live-RLS adversarial rows (T-0.2/T-0.4 actually executed under two different JWTs) require the
migration applied; they are encoded as the read-only `meta_orch_1104_support_rls_probe.sql` the
tester runs post-apply (the static contract test pins the predicates that produce those results).

---

## 6. Gates run locally

| Gate | Result |
|---|---|
| `node …/orch-0863-marketing-hub-phase-b.mjs` (C7) | **All checks PASS** — C7 `no-new-backend-files` green once committed; `META_ORCH_1104_BACKEND_ALLOWLIST` covers all new migration + edge-fn + test files. |
| `node …/i-meta-orch-1104-support-backend-invariants.mjs --self-test` | **SELF-TEST OK** |
| `node …/i-meta-orch-1104-support-backend-invariants.mjs` | **INV-A/B/C/D all OK** (4 chat policies scoped; 0 KBC web imports; no bare tickets/agents; no new is_admin reader) |
| `deno check` × 6 edge fns | **clean** (support-claim/send/set-status/grant-staff, notify-support, notify-dispatch) |
| `deno test` migration + D6 + statusLogic | **20 passed / 0 failed** |
| `npx jest` support routing | **5 passed** |
| `npx tsc --noEmit` (mingla-business) | no errors in the touched routing file |

---

## 7. Security posture (SPEC §3.2 — 9 mandatory authZ checks)

1. `support_staff` `enabled`/`role` writes are `is_admin_user()`-only via `support-grant-staff` ✅
2. `is_support_staff()` SECURITY DEFINER STABLE, modeled on `is_admin_user()` ✅
3. Chat policies scoped to `linked_entity_type='support' AND (is_support_staff() OR is_admin_user())`; restrictive broadcast-only confirmed passing 'support' ✅
4. `support_tickets` RLS = requester-own OR staff/admin (not blanket-authenticated) ✅
5. Every `support-*` fn: `getUser()` → 401, staff/admin RPC gate → 403, service-role only for the privileged write ✅
6. Claim-time participant insert ONLY via `claim_support_ticket` (DEFINER) behind the service-role `support-claim` fn; `p_staff_id` is always the verified caller ✅
7. `support_audit_log` records claim/reply/status/grant; push payloads carry IDs only (no message bodies); off-duty staff excluded from new-ticket fan-out ✅
8. COMMS-0002 allowlist in the same commit ✅
9. Presence: support staff get the extended `conversation_presence` SELECT policy + claim-time seed ✅

**verify_jwt:** `support-claim/send/set-status/grant-staff` = **true**; `notify-support` = **false**
(internal producer, authenticated by matching the service-role bearer itself). Webhook fns unchanged.

---

## 8. Deviations / scope notes

- **TS-type regen (§4.1 #6) deferred to Phase 1.** Regenerating Supabase types needs the migration
  applied remotely first; the generated file is consumed only by Phases 1–3 (no Phase-0 consumer).
  No functional impact on Phase 0. Phase 1 IMPLEMENT regenerates after `db push`.
- **New-ticket push trigger point is a Phase-1/3 wiring.** `notify-support` ships supporting
  `event:'new_ticket'`, but `create_support_ticket` is a client RPC (no edge fn at creation), and
  the SPEC §4.1 layer list does NOT mandate a DB trigger for the new-ticket push. The requester
  client (Phase 1) invokes `notify-support` after `create_support_ticket` returns; `support-send`
  already wires the per-message fan-out. This is intentional Phase-0-scope, not a gap.
- **`admin_toggle_partner` migration twins** (`20260822…`, `20260823…`) are historical/applied; the
  authoritative live function is rewritten here via `CREATE OR REPLACE` (single source of truth
  post-migration). The twins are not re-edited (immutable applied migrations).

## 9. Discoveries for orchestrator

- The worktree contains pre-existing macOS-duplicate artifacts (`… 2.md` / `…_2.sql`-style) under
  `Mingla_Artifacts/reports/` and `specs/` that can break `git fetch` (memory
  `feedback_edge_deploy_and_migration_apply_hazards.md`). They are NOT staged by this work. Suggest a
  sweep before the Phase-0 PR.
- No COMMS-ledger BLOCK/WARN entries targeted this ORCH / `ALL` / implementor at entry.
