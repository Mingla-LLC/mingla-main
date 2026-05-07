# Implementor Dispatch — Cycle B2 Path C Integration

**Skill to invoke:** `/mingla-implementor`
**Spec:** `outputs/SPEC_B2_PATH_C_AMENDMENT.md`
**Reconciliation context:** `outputs/B2_RECONCILIATION_REPORT.md`
**Original B2a spec (now superseded):** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md`
**Branch:** `Seth` (current)
**Reference branch (read-only):** `feat/b2-stripe-connect` — worktree at `/tmp/mingla-b2-comparison/tao-b2/` (HEAD `1039a1c3`)
**Estimated effort:** 6-10 hours

---

## Dispatch prompt (copy-paste this into a `/mingla-implementor` invocation)

```
I'm dispatching you to execute Cycle B2 Path C — a merge of two parallel B2 Stripe Connect implementations into a single compliant cycle.

You ARE NOT writing this from scratch. The spec is already authored. Read these files in order before touching any code:

1. outputs/SPEC_B2_PATH_C_AMENDMENT.md (binding contract; ~870 lines)
2. outputs/B2_RECONCILIATION_REPORT.md (background; explains the two competing implementations)
3. Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md (superseded; gives historical context for SC-01..SC-22 + invariants O/P)
4. Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md (Seth's working tree state pre-amendment)

A second tree of code is checked out for reference at /tmp/mingla-b2-comparison/tao-b2/ (Taofeek's `feat/b2-stripe-connect` branch). DO NOT MERGE OR CHERRY-PICK FROM IT. You will REWRITE the relevant pieces using Seth's patterns. Reading from it is fine and necessary.

## Pre-flight finding (heads-up before Phase 5/6)

ORCH-0742 Phase 2 (commit `80c15297`, landed today) modified `mingla-business/src/store/currentBrandStore.ts` to enforce ID-only persistence (no server snapshots). Path C frontend Phases 5 (`useBrandStripeBalances`) and 6 (`useBrandStripeDetach`) likely read brand context — verify the new hooks read brand ID from currentBrandStore and resolve full brand records via React Query (per the new ORCH-0742 invariant), NOT directly from a persisted `currentBrand` server-snapshot. Read `currentBrandStore.ts` and the recent QA report `Mingla_Artifacts/reports/QA_ORCH_0742_PHASE_2_REPORT.md` (operator's untracked file) before authoring Phase 5+6 hooks.

## Hard constraints (non-negotiable)

1. Every Stripe SDK instantiation imports the client from `supabase/functions/_shared/stripe.ts`. Do not create new inline `new Stripe()` constructors with hardcoded API versions. (Enforces I-PROPOSED-Q.)

2. Every `stripe.<resource>.<method>(...)` call uses `{ idempotencyKey: makeIdempotencyKey(brand_id, op) }` from `_shared/idempotency.ts`. (Enforces I-PROPOSED-R.)

3. Every edge function in `supabase/functions/{brand-stripe-*,stripe-*}/index.ts` imports and calls `writeAudit(...)` from `_shared/audit.ts` at least once on success AND once on error. (Enforces I-PROPOSED-S.)

4. NEVER write directly to `brands.stripe_connect_id`, `brands.stripe_charges_enabled`, `brands.stripe_payouts_enabled` from edge function code. The trigger `tg_sync_brand_stripe_cache` mirrors from `stripe_connect_accounts`. If you find yourself wanting to update both — update only `stripe_connect_accounts` and let the trigger handle `brands`. (Enforces I-PROPOSED-P.)

5. Frontend Stripe SDK usage MUST go through `@stripe/connect-js` + `@stripe/react-connect-js` rendered on the `mingla-business/app/connect-onboarding.tsx` web bundle, opened via `expo-web-browser.openAuthSessionAsync`. Do NOT wrap connect-js in `react-native-webview` directly. (Enforces I-PROPOSED-O.)

6. Frontend status derivation function uses Seth's signature: `deriveBrandStripeStatus({ has_account, charges_enabled, payouts_enabled, requirements, detached_at })`. Do NOT change to 4-positional. (D-B2-25.)

7. Webhook handler returns HTTP 200 to Stripe for ALL signature-verified events, even on processing error. Errors are logged to `payment_webhook_events.error` and retried by separate cron job. Do NOT return 500. (D-B2-27.)

8. Soft-delete on detach: `UPDATE stripe_connect_accounts SET detached_at = now()` — DO NOT `DELETE FROM`. Audit history must persist. (D-B2-29.)

9. Drop these Taofeek files entirely if they appear in working tree (they shouldn't, since they're on a different branch — but be defensive):
   - supabase/functions/brand-stripe-connect-session/
   - supabase/functions/stripe-connect-webhook/
   - mingla-business/src/services/payoutsService.ts
   - mingla-business/src/utils/stripeConnectStatus.ts
   - mingla-business/src/utils/stripeConnectStatus.test.ts

10. The `Co-Authored-By:` line is FORBIDDEN in commits per `feedback_no_coauthored_by`.

## Phasing (binding order)

Execute Phases 0 through 9 from SPEC §7. (Phase 10 is operator smoke; Phase 11 is tester; Phase 12 is operator CLOSE.)

After EVERY phase:
- `cd mingla-business && npx tsc --noEmit` must exit 0
- `cd mingla-business && npx jest <test-files-touched-this-phase>` must pass
- `cd /Users/sethogieva/Desktop/mingla-main && node .github/scripts/strict-grep/i-proposed-o-stripe-no-webview-wrap.mjs` reports 0 violations
- `cd /Users/sethogieva/Desktop/mingla-main && node .github/scripts/strict-grep/i-proposed-p-stripe-state-canonical.mjs` reports 0 violations
- (After Phase 0) `node .github/scripts/strict-grep/i-proposed-q-stripe-api-version.mjs` reports 0
- (After Phase 0) `node .github/scripts/strict-grep/i-proposed-r-stripe-idempotency-key.mjs` reports 0
- (After Phase 0) `node .github/scripts/strict-grep/i-proposed-s-stripe-audit-log.mjs` reports 0
- Use the diagnose-first workflow: read every file in the chain BEFORE writing changes; if you discover an ambiguity in the SPEC, STOP and surface it — do not invent.

## Per-phase deliverables (high-level)

**Phase 0 — Foundation**
- Author 2 migration files: `supabase/migrations/20260509000001_b2_payouts_stripe_id_unique.sql` and `20260509000002_b2_kyc_stall_reminder_column.sql`. Port from `/tmp/mingla-b2-comparison/tao-b2/supabase/migrations/20260506120000_*` and `20260506130000_*`. Verify with `supabase db reset` locally.
- Author 3 strict-grep gates: `i-proposed-q-stripe-api-version.mjs`, `i-proposed-r-stripe-idempotency-key.mjs`, `i-proposed-s-stripe-audit-log.mjs`. Follow the existing pattern in `i-proposed-j-*.mjs` and `i-proposed-k-*.mjs`.
- Update `.github/workflows/strict-grep-mingla-business.yml` to register the 3 new gates per `feedback_strict_grep_registry_pattern` (one script + one job per gate; never create parallel workflow files).
- Update `Mingla_Artifacts/INVARIANT_REGISTRY.md` — add I-PROPOSED-Q, M, N as DRAFT entries.
- Update `Mingla_Artifacts/DECISION_LOG.md` — log DEC-121, DEC-122, DEC-123, D-B2-24, D-B2-25, D-B2-26, D-B2-27, D-B2-28, D-B2-29, D-B2-30. (DEC-115/116/117/118 already used by ORCH-0737 v6 lineage; renumbered per `outputs/B2_PATH_C_PRE_FLIGHT_INVESTIGATION.md` §A.)

**Phase 1 — Webhook router refactor**
- Create `supabase/functions/_shared/stripeWebhookRouter.ts` per SPEC §6 contract.
- Read Taofeek's `/tmp/mingla-b2-comparison/tao-b2/supabase/functions/_shared/stripeConnectWebhookProcess.ts` as reference for routing logic. REWRITE in your own code with Seth's idempotency + audit + trigger-only patterns. Do not copy file directly.
- Modify `supabase/functions/stripe-webhook/index.ts` to delegate to `routeStripeEvent()` from the new shared module. Preserve durable-queue + 200-always behaviour.
- Author Deno test `supabase/functions/_shared/__tests__/stripeWebhookRouter.test.ts` covering 7 event types + unknown + retryable error.
- Author Deno test `supabase/functions/_shared/__tests__/stripeWebhookSignature.test.ts` ported from Taofeek's equivalent.

**Phase 2 — brand-stripe-detach**
- Create `supabase/functions/brand-stripe-detach/index.ts` per SPEC §6 contract.
- Read Taofeek's `/tmp/mingla-b2-comparison/tao-b2/supabase/functions/brand-stripe-detach/index.ts` as reference. REWRITE with Seth's patterns: audit + idempotency + trigger-only sync + soft-delete + 200-on-Stripe-rejection.
- Author Deno test for detach happy path + Stripe-rejects-del path.

**Phase 3 — brand-stripe-balances**
- Create `supabase/functions/brand-stripe-balances/index.ts` per SPEC §6 contract.
- Read Taofeek's reference implementation. REWRITE.
- Author Deno test for balance retrieval + filtering by default_currency.

**Phase 4 — stripe-kyc-stall-reminder**
- Create `supabase/functions/stripe-kyc-stall-reminder/index.ts` per SPEC §6 contract.
- Read Taofeek's reference. REWRITE.
- Author Deno test for SELECT query + send simulation + marker write.
- Verify Resend idempotency key format: `kyc_reminder:{brand_id}:{YYYY-MM-DD}`.
- Document the cron schedule in a comment header (operator will configure pg_cron / Supabase scheduled trigger separately).

**Phase 5 — Frontend balances**
- Create `mingla-business/src/services/brandStripeBalancesService.ts` (wraps `brand-stripe-balances` edge fn invocation; uses `edgeFunctionError` util per memory `feedback_anon_buyer_routes` patterns).
- Create `mingla-business/src/hooks/useBrandStripeBalances.ts` (React Query; staleTime 30s; refetchInterval 60s).
- Modify `mingla-business/src/components/brand/BrandPaymentsView.tsx`:
  - KPI tiles bind to `useBrandStripeBalances(brandId)` — replace stub data
  - Loading state: skeleton; Error state: "—"; Detached state: hide tiles
- Author jest test `mingla-business/src/utils/__tests__/brandStripeBalances.test.ts` (~4 cases).

**Phase 6 — Frontend detach**
- Create `mingla-business/src/services/brandStripeDetachService.ts`.
- Create `mingla-business/src/hooks/useBrandStripeDetach.ts` (React Query mutation; invalidates brand + status queries on success).
- Modify `BrandPaymentsView.tsx`:
  - Settings section gains "Disconnect Stripe" CTA (destructive variant)
  - Tap → ConfirmDialog ("Are you sure? This stops payouts and removes the brand from Stripe. Audit log will preserve a record.")
  - Confirm → calls `useBrandStripeDetach()`; success Toast "Stripe disconnected."
  - CTA disabled when `stripeStatus === 'not_connected'` or `'onboarding'`
  - **REMINDER per `feedback_toast_needs_absolute_wrap`**: Toast must be wrapped in absolute-positioned wrapper.
  - **REMINDER per `feedback_rn_sub_sheet_must_render_inside_parent`**: ConfirmDialog must render inside parent Sheet structure if BrandPaymentsView is presented in a sheet.
- Author jest test `brandStripeDetach.test.ts` (~6 cases).

**Phase 7 — Smoke CI**
- Author `.github/workflows/stripe-connect-smoke.yml` adapted from Taofeek's. Adapt edge fn names: `brand-stripe-onboard`, `brand-stripe-refresh-status`, `brand-stripe-balances`, `brand-stripe-detach`. Same secrets pattern.
- Default to manual `workflow_dispatch` + scheduled daily at 6 AM UTC.
- Light mode (no JWT): assert 401/403 on each fn. Full mode (with JWT secret): smoke happy path on detach + balances + refresh.

**Phase 8 — Migrations + Deno CI**
- Author `.github/workflows/supabase-migrations-and-stripe-deno.yml` adapted from Taofeek's. Update Deno test paths to your new test files.

**Phase 9 — Cleanup**
- Verify no orphan imports referencing dropped Taofeek files.
- Verify no Co-Authored-By lines anywhere.
- Verify all SCs (30) are mapped to at least one test.
- Run full test suite: `cd mingla-business && npm test` — all pass.
- Run all 5 strict-grep gates — 0 violations.
- Run `npm run lint` — no NEW errors in Path C-touched files.
- Run `cd mingla-business && npx tsc --noEmit` — exit 0.

## Do not

- Do not pull from `feat/b2-stripe-connect` other than as a read-only reference. No `git cherry-pick`. No `git merge`. No `git rebase`.
- Do not "while you're at it" any other ORCH or cycle. Path C only.
- Do not skip the diagnose-first workflow. Read first, write second.
- Do not invent new spec sections. If something is unspecified, surface it; do not guess.
- Do not change the locked decisions DEC-112/113/114/D-B2-3/5/22/23. They are inputs, not negotiable.
- Do not deploy edge functions yourself. Phase 10 (deploy) is operator action.
- Do not summarize what you did at the end of your report. Report = artifact (per `feedback_no_summary_paragraph`).

## Output

Produce a single artifact: `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md`.

Structure:
1. Phase-by-phase summary (file-by-file, line-by-line if relevant)
2. Per-SC verification table (30 rows)
3. Per-invariant verification table (5 rows)
4. CI gate run output (paste actual output)
5. Constitutional compliance check (Const #1 / #2 / #3 per Mingla operating model)
6. Discoveries (D-CYCLE-B2-PATHC-IMPL-N) with severity + recommended disposition
7. Suggested commit messages (one per phase OR one squashed; no Co-Authored-By)
8. List of files changed (added / modified / deleted)
9. Operator post-IMPL action sequence (deploy edge fns, run smoke, dispatch tester)
10. Open questions (if any)

Read the SPEC. Read both implementations. Begin Phase 0.
```

---

## Operator-side steps after dispatching

1. **Run `/mingla-implementor`** with the prompt above pasted in.
2. **Wait for return.** Implementor produces:
   - Code changes on `Seth` branch (working tree, uncommitted)
   - Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2_PATH_C_REPORT.md`
3. **Review the report** focusing on:
   - SC verification table (30 SCs all PASS?)
   - Invariant gate output (all 5 = 0 violations?)
   - Discoveries (anything that needs your decision?)
   - File manifest (matches §4 of the SPEC?)
4. **Spot-check 2-3 high-risk files** yourself:
   - `_shared/stripeWebhookRouter.ts` (new code, complex logic)
   - `brand-stripe-detach/index.ts` (audit + idempotency must be present)
   - One frontend hook (matches existing patterns?)
5. **If approved:** commit per the implementor's suggested messages (one per phase OR squashed; remember NO Co-Authored-By).
6. **If rework needed:** dispatch `/mingla-implementor` with the specific findings (not a full re-spec; targeted fix prompt).
7. **After commit:** continue to operator-side smoke (Phase 10 — see SPEC §3 J-B2.1 / J-B2.4 / J-B2.5 + balances stages; original B2a smoke checklist in `clade transfer/HANDOFF_B2A_STRIPE_CONNECT_2026_05_06.md` §4 still applies, plus 3 new stages for the new functions).
8. **After smoke passes:** dispatch `/mingla-tester` against the IMPL report. Orchestrator authors that prompt at the time.
9. **After tester PASS:** CLOSE protocol per `feedback_post_pass_protocol`:
   - Lock DEC-121 in DECISION_LOG (status flip from DRAFT → ACTIVE)
   - Flip I-PROPOSED-O + K + L + M + N from DRAFT → ACTIVE in INVARIANT_REGISTRY
   - 7-artifact SYNC (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS)
   - Disposition any new D-CYCLE-B2-PATHC-IMPL discoveries
   - **EAS OTA dual-platform** per `feedback_eas_update_no_web` (TWO separate commands, never `ios,android`):
     ```
     cd mingla-business
     eas update --branch production --platform ios --message "Cycle B2 Path C: Stripe Connect onboarding + detach + balances + KYC reminder (sandbox)"
     eas update --branch production --platform android --message "Cycle B2 Path C: Stripe Connect onboarding + detach + balances + KYC reminder (sandbox)"
     ```
10. **Loop Taofeek in** with the reconciliation report + IMPL report so they understand how their work was integrated. (Operator is handling this per their answer to coordination question.)

---

## Open meta-questions for the operator (before dispatch)

These are not blockers, but worth answering to set expectations:

1. **Implementor estimated 6-10 hours.** Is that a single dispatch or split across two? Recommendation: single dispatch with phase-by-phase reporting, since interruption mid-phase risks state loss.

2. **The wrong-author commit `26e0a147` from earlier this session.** Recommend resolving before kicking off Path C: `git config --global user.email sethogievabelgium@gmail.com` + `git config --global user.name "Seth Ogieva"` + `git reset --soft HEAD~1` + recommit. The implementor will produce many new commits and you don't want them all to inherit the wrong author.

3. **`feat/b2-stripe-connect` branch fate.** After Path C lands and Taofeek is informed, recommend: archive his branch (don't delete; keep PR #47 open or convert to draft for reference). Operator decides timing.

4. **Cycle naming.** SPEC amendment renames B2a → B2 since B2b folds in. World map / priority board entries should reflect this. Implementor handles in Phase 0 artifact updates.

---

**End of dispatch package.**
