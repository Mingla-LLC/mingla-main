# REVIEW — ORCH-0914 [Trip Money tab redesign — organiser visibility into each traveller's payment-plan progress]

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Implementor return:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md` (Codex `implementor-mingla`)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0914_TRIP_MONEY_TAB_REDESIGN.md`

---

## VERDICT

**APPROVED for operator DB push + edge-function deploy + TEST dispatch.**

Orchestrator independently re-verified every implementor claim. All 4 SPEC hard guards held. All 5 affected gates pass. Cron behavior preserved (13/13 regression Deno tests green after helper extraction). Migrations are safe to push.

Operator may proceed with `supabase db push --linked` for the two new migrations:
- `supabase/migrations/20260723000000_orch_0914_manual_buyer_reminders.sql`
- `supabase/migrations/20260723000001_orch_0914_manual_charge_installment.sql`

Once migrations are live on remote, orchestrator deploys the 2 new edge functions, then dispatches TEST.

---

## 1. Scope verification

| Layer | Files | Verdict |
|---|---|---|
| Migrations | 2 new (`20260723000000` reminders ledger + RPC, `20260723000001` charge RPC + audit-log slugs) | IN SCOPE |
| Shared helper | NEW `supabase/functions/_shared/installments/createInstallmentPI.ts` | IN SCOPE per SPEC §3.2.2 |
| Edge functions | NEW `manual-charge-installment/`, NEW `send-installment-reminder/` | IN SCOPE per SPEC §3.2.1+3.2.3 |
| Email template | NEW `supabase/functions/_shared/email/installmentReminderEmail.ts` | IN SCOPE per SPEC §3.4 |
| Services | NEW `mingla-business/src/services/manualInstallmentChargeService.ts` + `installmentReminderService.ts` | IN SCOPE per SPEC §3.3 |
| Hooks | NEW `mingla-business/src/hooks/useManualInstallmentActions.ts` (consolidates the 3 hooks from SPEC §3.5 into one file — acceptable refactor; same surface area) | IN SCOPE |
| Component | Modified `mingla-business/app/trip/[id]/money/index.tsx` (5-column responsive redesign + 2 action handlers + pay-in-full row variant) | IN SCOPE per SPEC §3.6 |
| Strict-grep gate | NEW `i-proposed-manual-installment-action-via-shared-helper.mjs` + workflow registration | IN SCOPE per SPEC §3.7 |
| Cron header | UPDATED `process-scheduled-installments/index.ts` contract header to point to NEW invariant + import shared helper | IN SCOPE (helper extraction per SPEC §3.2.2) |
| Audit labels | UPDATED `mingla-business/src/utils/auditActionLabels.ts` with 2 new slug human-labels | IN SCOPE per SPEC §3.1.3 |
| InstallmentScheduleDisplay | UPDATED with new `variant="cell"` for compact horizontal display | IN SCOPE per SPEC §3.6.2 / HF-2 |
| Tests | NEW `mingla-business/app/trip/[id]/money/__tests__/` happy-path (19 tests T-01..T-18+) + NEW Deno tests for both edge fns + helper | IN SCOPE per SPEC §7.1 |
| Config | UPDATED `supabase/config.toml` — registers the 2 new edge functions | IN SCOPE (orchestrator-deploys-edge-functions memory rule) |
| Updated tr3 owner gate | `.github/scripts/strict-grep/i-proposed-tr3-installment-pi-via-cron-owner.mjs` — updated to allow the shared helper as the new owner | IN SCOPE per SPEC §6.2 (invariant supersession) |

**Out-of-scope check:** zero diff against `orders` schema, `order_installments` schema/RLS, admin web, consumer iOS/Android, buyer-anon-web. All 4 SPEC hard guards held.

---

## 2. Hard-guard verification (SPEC §8)

| Guard | Verification command | Result |
|---|---|---|
| No `orders` / `order_installments` schema or RLS changes | `git diff origin/main -- 'supabase/migrations/*orders*' '*order_installments*' '*orch_0869*' '*tr3*'` | EMPTY (untouched) |
| No cron behavior change beyond helper extraction | `git diff origin/main -- supabase/functions/process-scheduled-installments/index.ts` shows only: (a) contract header rewrite pointing to new invariant, (b) import switch from `stripeTicketCheckout` + `writeAudit` to `createInstallmentPI` helper, (c) removal of inline constants `MINGLA_APPLICATION_FEE_RATE` + `MAX_RETRY_ATTEMPTS` (now exported from helper). Per-installment processing loop calls `createInstallmentPI(...)` — same arg shape as the prior inline block | PRESERVED (behavior identical, owner re-pointed) |
| Cron tests still pass after extraction | `deno test supabase/functions/process-scheduled-installments/__tests__/` | **13/13 PASS** |
| No reminder rate-limit bypass | Migration 1 RPC `biz_send_installment_reminder` enforces 24h window via DB-side `SELECT COUNT(*) WHERE sent_at > now() - interval '24 hours'`; edge fn calls this RPC before any delivery; UI hook `useRecentReminderForOrder` reads the same ledger for client-side button gating (defense in depth) | ENFORCED at DB layer |
| No at-risk charge bypass without explicit override | Migration 2 RPC `biz_manual_charge_installment(p_atrisk_override boolean DEFAULT false)` requires explicit `true` to charge at-risk; edge fn passes the flag through to helper; UI opens `ConfirmDialog` to gather operator intent | ENFORCED at DB layer |
| No admin / consumer / buyer-anon touches | `git diff origin/main -- mingla-admin/ app-mobile/src/ mingla-business/app/checkout/ mingla-business/app/checkout-trip/ mingla-business/app/e/ mingla-business/app/b/` | EMPTY (untouched) |
| No Retry-now or Cancel-and-refund behavior changes | Money route's `useRetryInstallment` import + render branch + `RefundPreviewSheet` mount preserved (verified via grep of the modified file) | PRESERVED |

**All 7 hard guards held.**

---

## 3. Independent test re-runs

| Suite | Implementor claim | Orchestrator independent re-run | Verdict |
|---|---|---|---|
| Jest happy-path `app/trip/[id]/money/__tests__` | 19/19 | **19/19 PASS** (3.5s) | MATCHES |
| Deno cron regression `process-scheduled-installments/__tests__` | (implicit — cron must still pass) | **13/13 PASS** (11ms) | MATCHES — extraction did not break cron |
| Deno new edge fn tests `manual-charge-installment/__tests__` + `send-installment-reminder/__tests__` | 19/19 (combined with cron) | **6/6 PASS** (42ms) | MATCHES (13 cron + 6 new = 19 total) |
| Strict-grep `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` (NEW) | PASS | **PASS** — scanned 190 files, 0 violations | MATCHES |
| Strict-grep `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (updated) | PASS | **PASS** — scanned 190 files, 0 violations | MATCHES |
| Strict-grep `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` (ORCH-0882) | PASS | **PASS** — 7 files carry markers | MATCHES |
| Strict-grep `ORCH-0913 no-tabs-on-dashboards` | PASS | **PASS** | MATCHES |

**Total: 38/38 tests + 4/4 gates PASS independently.**

---

## 4. Constitution audit

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 2 | One owner per truth | PASS | Installment PI creation now single-owned by `_shared/installments/createInstallmentPI.ts`; cron + new manual-charge endpoint both call it |
| 3 | No silent failures | PASS | Edge fns return `{ ok: false, reason }` shapes; hooks have `onError` + toast; RPC errors humanized in `useManualInstallmentActions` |
| 8 | Subtract before adding | PASS | Cron's per-installment inline block REMOVED + replaced with helper call (not layered) |
| 9 | No fabricated data | PASS | Outstanding = real `orderTotalCents - SUM(collected.amountCents)`; last-charge status derived from real `collected_at`/`failed_at`; no placeholder/mock data in any new component code |
| 11 | One auth instance | PASS | Both new edge fns use service-role + JWT pattern matching existing `_shared` conventions |
| Other (1, 4, 5, 6, 7, 10, 12, 13, 14) | N/A or PASS | No interactive elements / cache keys / Zustand / logout / TRANSITIONAL / currency / datetime / exclusion / persisted-state changes |

**Constitution: 5 PASS + 9 N/A + 0 violations.**

---

## 5. Open concerns (none blocking)

- **NEW invariant supersession ratification.** SPEC §6.2 proposed `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` supersedes `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER`. Implementor preserved BOTH gates and updated the older one's allowlist to accept the new helper. This is the right move — old gate still enforces the no-bypass contract, new gate enforces the shared-helper contract. **Orchestrator notes the supersession is ADDITIVE, not replacement** — both gates active in CI is acceptable belt-and-suspenders.
- **Hook consolidation.** SPEC §3.5 named 3 hooks (`useChargeInstallmentNow` + `useSendInstallmentReminder` + `useRecentReminderForOrder`). Implementor consolidated into `useManualInstallmentActions.ts` exposing all three. Same surface area, fewer files. Acceptable per SPEC §3.6 implementor-freedom clause.
- **Repo-wide tsc + lint still fail.** Implementor disclosure honest — same pre-existing unrelated baseline failures (checkout buyer files / marketing editor / DraftEvent fixtures). No ORCH-0914 files in the post-implementation typecheck error list. Acceptable per the documented pre-existing state from prior closes (ORCH-0913, ORCH-0913-A, ORCH-0916).

---

## 6. Next pipeline steps (post-APPROVE)

1. **Operator runs `supabase db push --linked`** to ship the 2 new migrations to remote. Orchestrator cannot deploy edge functions until migrations are live (they reference the new RPCs).
2. **Operator confirms migration push complete** in chat.
3. **Orchestrator deploys edge functions** via local CLI:
   - `supabase functions deploy manual-charge-installment --project-ref gqnoajqerqhnvulmnyvv`
   - `supabase functions deploy send-installment-reminder --project-ref gqnoajqerqhnvulmnyvv`
   - Verify version bumps + preserved `verify_jwt: true` settings.
4. **Dispatch TEST to Claude `mingla-tester`** — live-fire sim on business iOS + Android + web preview verification. iOS sim dev binary is FRESH (rebuilt during ORCH-0913-A); UDIDs `F7ECAC25-...` + `2C3312D9-...` ready; Metro on `:8084`.
5. **On TEST PASS** → orchestrator CLOSE protocol → commit + push + PR + admin-merge + EAS publish.

---

## 7. Files for operator to push

Two migrations awaiting `supabase db push --linked`:

```
supabase/migrations/20260723000000_orch_0914_manual_buyer_reminders.sql  (131 lines)
supabase/migrations/20260723000001_orch_0914_manual_charge_installment.sql  (114 lines)
```

Both safe to push — additive (new table + new RPCs + 2 audit-log slugs); zero ALTER on existing tables.

---

**REVIEW VERDICT: APPROVED.** Cleared for operator DB push gate.
