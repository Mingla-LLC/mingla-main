# IMPLEMENTATION — ORCH-1110 — blank-email-undeletable-account

**Status:** implemented and verified (code + tests); migration WRITTEN + predicate-verified but NOT YET APPLIED (blocker — see §11).
**Author:** mingla-implementor (claude)
**Date:** 2026-06-10
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1110-[blank-email-undeletable-account]/` on branch `ORCH-1110-blank-email-undeletable-account`
**Commit:** `4b6d9480a`

---

## 1. Summary

A business user with a NULL stored `auth.users.email` (serialized as `""` by GoTrue) could never delete their account: the "Type your email to confirm" gate showed a blank "YOUR EMAIL" box and typing the real email never enabled the button. Fixed by (1) a shared `resolveUserEmail` helper that treats `""`/whitespace as absent and falls back to `user_metadata.email`/identity email, (2) a dual-mode Step-3 gate (real-email match, or a `DELETE`-keyword fallback when no email is resolvable) that never enables on blank input, (3) provisioning that seeds a real email or NULL (never `""`), and (4) a one-time idempotent backfill migration for the existing blank row.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `4b6d9480a`) |
|----|-----------|--------|-------|
| SC-1 | Resolved real email shown (never blank) | ✓ | `delete.tsx` Step3Confirm renders `resolvedEmail`; box only when `confirmMode==="email"`; `resolveUserEmail` resolves it. Unit: T-G1 asserts resolved email = `a@b.com`. |
| SC-2 | Email mode: case-insensitive match enables + runs delete | ✓ | `computeConfirmMatches("email", e, typed)`; T-G1 (`A@B.COM`→true). `handleConfirmDelete` gates on `confirmMatches`. |
| SC-3 | Email mode: empty input stays disabled | ✓ | `computeConfirmMatches` returns false on empty/whitespace. T-A1. |
| SC-4 | No resolvable email → keyword mode, `DELETE` enables, always deletable | ✓ | `confirmMode = resolvedEmail===null ? "keyword":"email"`; T-A2. |
| SC-5 | New sign-in with NULL auth email + metadata/identity email persists the real email | ✓ | `creatorAccount.ts` seeds `resolveUserEmail(user)`. T-P1. |
| SC-6 | Backfill corrects the affected row; 0 rows `''` | ⏳ PENDING APPLY | Migration written + predicate verified (resolves to `sethogievabelgium@gmail.com`); NOT applied (§11 blocker). |
| SC-7 | `ensureCreatorAccount` can't write `''` | ✓ | T-P2 (no email anywhere → NULL, not `""`). |

Parity automatic (single shared RN component → iOS == Android == business-web). No per-platform split.

## 3. Files changed

| File | +/- | Note |
|------|-----|------|
| `mingla-business/src/utils/resolveUserEmail.ts` | +88 NEW | `resolveUserEmail` + `computeConfirmMatches` + `DELETE_KEYWORD` |
| `mingla-business/src/services/creatorAccount.ts` | +6/-1 | seed via `resolveUserEmail(user)` |
| `mingla-business/app/account/delete.tsx` | +~75/-~50 | dual-mode gate + Step3Confirm rewrite |
| `supabase/migrations/20260925000000_orch_1110_backfill_creator_account_email.sql` | +33 NEW | idempotent backfill |
| `mingla-business/src/utils/__tests__/resolveUserEmail.test.ts` | +69 NEW | T-R1..R3 +3 |
| `mingla-business/src/utils/__tests__/deleteAccountGate.test.ts` | +79 NEW | T-G1/T-A1/T-A2 +2 |
| `mingla-business/src/services/__tests__/creatorAccountEnsure.test.ts` | +44 | T-P1/T-P2/T-P3 (append-only) |

## 4. Data-model changes applied

None (no DDL). The migration is a pure data UPDATE on `public.creator_accounts.email` + `updated_at`, guarded to touch only `''`/NULL rows and never write `''`/NULL. **Not yet applied** (§11).

## 5. Edge functions touched

None.

## 6. Regression tests added

- `mingla-business/src/utils/__tests__/resolveUserEmail.test.ts` — 6 tests (T-R1, T-R2, T-R3 + trim/null/multi-identity).
- `mingla-business/src/utils/__tests__/deleteAccountGate.test.ts` — 6 tests (T-G1 happy, T-A1 email+keyword blank, T-A2 keyword, wrong-email, null-resolved).
- `creatorAccountEnsure.test.ts` — +3 (T-P1, T-P2, T-P3), append-only.

**Run:** `19 passed, 19 total` (3 suites).
**fails-on-revert verified at `4b6d9480a`** — true line-deletion of the fix in `resolveUserEmail.ts` (`resolveUserEmail` → bare `user?.email ?? null`; `computeConfirmMatches` → old `typed === resolvedEmail??""` single-mode, no blank guard, no keyword) produced **5 failures** (T-G1, T-A1 email mode, T-A1 keyword mode, T-A2, T-P1, T-P2 — the empty-string mis-enable and the un-deletable trap both re-appeared). Fix restored → `19 passed`.

## 7. Old → New receipts

### resolveUserEmail.ts (NEW)
**Before:** did not exist; each site did `user.email ?? null/""`.
**Now:** single resolver treating `""`/whitespace as absent (`user.email` → `user_metadata.email` → identity email → null) + pure `computeConfirmMatches` dual-mode gate.
**Why:** SC-1/-4/-5/-7; centralizes so a bare `??` can't re-leak `""`.

### creatorAccount.ts
**Before:** `email: user.email ?? null` → persisted `""` when auth email NULL.
**Now:** `email: resolveUserEmail(user)` → real email or NULL.
**Why:** SC-5/-7 (root data origin).
**Lines:** ~7.

### delete.tsx
**Before:** `emailMatches` compared typed to `user.email` (`""` for this user) → never matched real email AND `""===""` mis-enabled on blank; `email={user?.email ?? ""}` rendered blank box.
**Now:** `resolvedEmail`/`confirmMode`/`confirmMatches`; Step3Confirm renders email-box only in email mode (never blank), keyword mode shows "Type DELETE"; blank input never enables.
**Why:** SC-1/-2/-3/-4.
**Lines:** ~125.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS / Android | No | — |
| Buyer/anon web | No | — |
| Business iOS | **Yes** | Automatic (shared RN) |
| Business Android | **Yes** | Automatic (shared RN) |
| Admin web | No | — |
| Business web preview | Incidental | Automatic (helper is platform-agnostic, no native API) |

## 9. Smoke result

Gate logic verified via jest (pure functions; no RN renderer needed per SPEC §8 testability note). No sim/device run this pass — UI render of the two modes is an UNVERIFIED item for the tester (open Delete → Step 3 on a business build: confirm real email shows, button enables on match, blank stays disabled, keyword fallback reachable for a no-email account). Typecheck: `resolveUserEmail.ts`, `delete.tsx`, `creatorAccount.ts` + the 3 test files are type-clean; the 257 `tsc` errors repo-wide are all pre-existing in unrelated files.

## 10. Known issues / deferred

- **Backfill not applied** — blocker §11.
- **D-2 (SPEC):** `delete.tsx:365` hardcoded `"GBP"` — out of scope, NOT touched.
- **DB reality vs SPEC:** SPEC expected 3 blank rows; the live probe found **1** (`332e1733…`, `email=''`). The 2 ORCH-1108 test rows are already populated (NULL count = 0). The migration is still correct and idempotent — it corrects whatever blank rows exist at apply time.

## 11. Operator action required

**BLOCKER — migration could not be applied by the implementor.** Both authorized apply paths are unavailable in this environment:
- Supabase CLI (`/Users/sethogieva/bin/supabase`) is **unlinked** in the worktree (`Cannot find project ref`).
- The only `sbp_` token found in the anchor returns **HTTP 401 Unauthorized** from the Management API (expired/rotated).
- MCP supabase tools are read-only per dispatch (used only for the read-only predicate probe).

Per dispatch ("if the migration won't apply, STOP and report"), I did NOT work around it. The migration is written, monotonic, collision-checked, and predicate-verified.

**Apply command (operator, from a linked CLI):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1110-[blank-email-undeletable-account]" && /Users/sethogieva/bin/supabase db push --linked
```
(or re-link first: `/Users/sethogieva/bin/supabase link --project-ref gqnoajqerqhnvulmnyvv`; or apply via Management API with a valid `SUPABASE_ACCESS_TOKEN` + browser UA.)

**Post-apply verification (expected):**
- `creator_accounts.email` for `332e1733-af2b-49ca-8014-87d56f1b735e` == `sethogievabelgium@gmail.com`.
- `SELECT count(*) FROM creator_accounts WHERE NULLIF(BTRIM(email),'') IS NULL` == `0`.

**No edge-function deploys.** OTA (business iOS + Android, per-platform) at CLOSE for the `delete.tsx`/service/util JS changes.

**Read-only predicate probe (run this pass, MCP):**
- 1 row blank (`332e1733…`, `email=''`); resolves to `sethogievabelgium@gmail.com` via identity + profile email.
- `version_collision` for `20260925000000` = 0; `max_remote_version` = `20260924000000`.

## 12. Discoveries for Orchestrator

- **D-FILENAME (deviation):** migration named `20260925000000` NOT the SPEC's `20260924000000` — the ORCH-1108-1109 sibling worktree already owns `20260924000000_orch_1108_brand_invite_declined.sql` (and it's the applied remote head). Cross-host monotonicity rule 10 forces a strictly-greater prefix; `20260925000000` is the next free, collision-checked against remote + both worktrees. Behaviorally identical to the SPEC SQL.
- **D-ROWCOUNT:** SPEC §4.4/§5 SC-6 expected 3 blank rows; live = 1. The 2 ORCH-1108 test rows are already corrected. Not a defect; the idempotent migration self-adjusts. SC-6's "the 2 ORCH-1108 rows equal their real emails" is moot (already non-blank).
- **D-1 (carried from SPEC):** `auth.users.email = NULL` for `332e1733…` originates in the consumer-app Google OAuth callback / GoTrue provisioning — recommend a separate INVESTIGATE. This fix only works around it.
- **D-2 (carried):** `delete.tsx:365` GBP hardcode → future currency-sweep ORCH.
