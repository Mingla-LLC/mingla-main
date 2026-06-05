# IMPLEMENTATION — ORCH-1075 [Paid-publish integrity guards]

- **Mode:** mingla-implementor (parity mirror, Claude)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1075-[paid-publish-integrity-guards]/` on branch `ORCH-1075-paid-publish-integrity-guards`
- **Date:** 2026-06-04
- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1075_PAID_PUBLISH_INTEGRITY_GUARDS.md` (`0e2aaced1`)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1075_PAID_PUBLISH_INTEGRITY_GUARDS.md` (`55c7de9d4`)
- **Status:** implemented and verified (backend SQL parse-validated + source-contract tested + business-app catch sites tsc/lint/jest green). DB behavioral exercise is a hand-run post-`db push` probe (read-only MCP cannot run write transactions).

---

## 0. Layman summary

A brand that never finished Stripe onboarding could publish a PAID event/experience/trip; the buyer only hit the dead-end 409 at checkout. Same for a paid listing whose date already passed. This change adds two server-side guards INSIDE the publish/edit RPCs so the rejection happens at publish time, and the business app turns the two reasons into "Finish your payment setup" (routes to Stripe onboarding) and "Pick a future date" (routes to the date field). Free offerings and in-person-only paid offerings are untouched.

---

## 1. Pre-flight invariant probe (SPEC §7) — RESULT

**RPC latest-definer confirmation (grep-all → sort → read-newest):** all 7 RPC latest-defining migrations match the SPEC §3 citations EXACTLY, and no sibling worktree or origin/main carries a newer definition:

| RPC | Latest-defining migration | Matches SPEC? |
|---|---|---|
| `biz_create_experience` | `20260829000000_meta_orch_1059_draft_roundtrip_cover_neverends.sql` | ✅ |
| `biz_publish_experience` | `20260829000000_…neverends.sql` | ✅ |
| `biz_update_live_experience` | `20260906000000_orch_1069_live_edit_persists_experience_intents.sql` | ✅ |
| `business_publish_event_draft` | `20260604000001_orch_0824_publish_rpc.sql` | ✅ |
| `business_publish_trip_draft` | `20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql` | ✅ |
| `biz_update_live_trip` | `20260725000002_…coherence.sql` | ✅ |
| `business_patch_event_when` | `20260820000000_schedule_change_buyer_protection_refund_all.sql` | ✅ |

Confirmed against `origin/main` (identical) and all `~/Desktop/mingla-orchs/*/supabase/migrations/` siblings (none newer). Each RPC body was re-emitted VERBATIM from its latest-defining migration; a per-line audit confirmed the ONLY non-verbatim lines are the intended guard blocks + DECLARE additions.

**Read-only DB invariant probe (Lantern & Vine `53aaea42-0e7d-4b2a-92db-c220d78a352c`):**
```
stripe_charges_enabled = false,  sca_charges_enabled = false,
detached_at = NULL,              stripe_account_id = acct_1Tdu4cPjlZvMV1oP
```
→ `pg_brand_can_charge` returns **false** for this brand (charges_enabled is `false`, fails `IS DISTINCT FROM false`). The guard would correctly reject this brand's paid publish. EXPECTATION MET.

**Migration monotonicity:** max migration timestamp on origin/main + all worktrees = `20260908000000`, BUT the orchestrator's remote re-scan (MCP `list_migrations`, 2026-06-04) found the TRUE remote `schema_migrations` head is `20260910000000` (`meta_orch_1074_new_review_notify` — applied to remote but not yet on main, a COMMS-0018-class remote-only divergence the worktree scan could not see). Migration version bumped from the implementor's `20260909000000` to `20260911000000` so it is strictly greater than the true remote head per the SKILL monotonic-prefix rule. Applied via MCP `apply_migration` by the orchestrator (records the version; future `db push` from a linked checkout skips it idempotently).

---

## 2. Files changed (with commit hashes)

### Commit `e2c58f9bd` — migration + strict-grep gate + C7 allowlist (backend bundle, COMMS-0002 same-commit)

#### `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql` (NEW, ~3,516 lines)
- **Before:** no publish-time Stripe/date guard anywhere; readiness enforced only at checkout (`20260727000000_orch_0955:380-382`).
- **Now:** new `pg_brand_can_charge(uuid)` STABLE sql helper mirroring the checkout SOURCE predicate (`stripe_connect_accounts.charges_enabled WHERE detached_at IS NULL AND stripe_account_id IS NOT NULL AND charges_enabled IS DISTINCT FROM false`); the 6 money RPCs + `business_patch_event_when` re-emitted verbatim + guard blocks. Guard A (`RAISE/return stripe_charges_disabled`) + Guard B (`RAISE/return offering_date_past`) on PAID offerings only. `business_patch_event_when` gets Guard B only. Trailing self-verify DO block asserts every RPC carries its markers (fails-on-revert at apply).
- **Why:** SPEC §3.0–§3.5; moves the money fail-close from checkout-time to publish/edit-time.
- **COMMS-0003:** Stripe docs URLs (`https://docs.stripe.com/api/accounts/object`, `https://docs.stripe.com/connect/onboarding.md`) cited inline in the migration header AND the helper comment.

#### `.github/scripts/strict-grep/orch-1075-paid-publish-integrity-guards.mjs` (NEW, 214 lines)
- Modeled on `orch-0792`. For each of the 6 money RPCs asserts the LATEST defining migration's function body contains both `pg_brand_can_charge(` and `offering_date_past`; for `business_patch_event_when` asserts `offering_date_past` only. Slices per-function so a marker in a sibling function can't falsely satisfy. `--self-test` mode included.

#### `.github/workflows/strict-grep-mingla-business.yml` (MODIFIED, +13)
- New `orch-1075-paid-publish-integrity-guards` job (self-test step + real run). Static `run:` commands only — no untrusted-input interpolation.

#### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (MODIFIED, +12)
- Added `ORCH_1075_BACKEND_ALLOWLIST` (migration + the two `__tests__/orch_1075_*` files) and spread into the C7 ALLOWLIST. COMMS-0002 satisfied in the same backend bundle.

### Commit `977f65d96` — business-app catch sites + regression tests

#### `mingla-business/src/utils/paidPublishGuards.ts` (NEW)
- Single source of truth: `detectPaidPublishGuardReason` (matches both `error.message` and `data.reason`), `paidPublishGuardCopy`/`resolvePaidPublishGuardCopy` (LOCKED SPEC §3.7 copy), `brandStripeOnboardingRoute(brandId)` → `/brand/{id}/payments/onboard` (the real `BrandOnboardView` entry).

#### `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (MODIFIED)
- `handlePaidPublishGuard` interceptor wired into `handleSubmit` (publish) + `handleLiveSave` (both `error.message` and structured `data.reason` paths). Guard A → router push to onboarding; Guard B → jump to When step (3) + reveal errors.

#### `mingla-business/src/components/event/EventCreatorWizard.tsx` (MODIFIED)
- `handleConfirmPublish` catch now detects the two reasons; Guard A → existing `onOpenStripeOnboard()`; Guard B → When step (index 1) + step errors.

#### `mingla-business/src/components/event/EditPublishedScreen.tsx` (MODIFIED)
- `patchPublishedEventWhen` catch detects `offering_date_past` (Guard B only on this RPC) → locked copy toast; inline date field stays for the fix.

#### `mingla-business/src/components/trip/TripCreatorStep5Review.tsx` (MODIFIED)
- `mapPublishErrorToState` gains `stripe_charges_disabled` + `offering_date_past` cases with locked copy + `pointsToStep`.

#### `mingla-business/src/components/trip/TripCreatorWizard.tsx` (MODIFIED)
- Publish catch routes `stripe_charges_disabled` to `/brand/{id}/payments/onboard`.

#### `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` + `src/services/tripsService.ts` (MODIFIED)
- `UpdateLiveTripRejectReason` union extended with the two reasons; the reject-dialog switch gains both cases (Guard A → "Finish Stripe setup" route; Guard B → "Pick a future date").

#### Tests (NEW)
- `mingla-business/src/utils/__tests__/paidPublishGuards.test.ts` (jest, 10 tests).
- `supabase/migrations/__tests__/orch_1075_paid_publish_integrity_guards.test.ts` (Deno source-contract, 13 tests).
- `supabase/migrations/__tests__/orch_1075_paid_publish_integrity_guards.test.sql` (behavioral live-DB probe, hand-run post-`db push`, write-safe ROLLBACK).

---

## 3. Per-RPC guard placement (verbatim-plus-guard)

| RPC | Paid test used | Guard placement | Shape |
|---|---|---|---|
| `biz_create_experience` | `p_publish AND NOT v_is_free AND v_resolved_total > 0` | after date-model resolution, before slug build; recomputes `v_max_end` from the when payload | `RAISE` |
| `biz_publish_experience` | same | after date-model resolution, before cover patch | `RAISE` |
| `biz_update_live_experience` | `NOT v_is_free AND v_resolved_total > 0` | after the proposed date arrays are built (`MAX(v_new_date_ends)`), before the date-shift gate | `{ok:false,reason}` |
| `business_publish_event_draft` | `bool_or(availableAt∈(online,both) AND NOT isFree AND price_cents>0)` over `v_tickets` | after `event_dates` write, before status flip (`MAX(event_dates.end_at)`) | `RAISE` |
| `business_publish_trip_draft` | `MAX(ticket_types.price_cents WHERE available_online) > 0` | after pricing-tier-count check, before slug gen; uses validated `v_end` | `RAISE` |
| `biz_update_live_trip` | same online-tier max | after permission gate; effective end = patched `endAt` else current master `end_at` | `{ok:false,reason}` |
| `business_patch_event_when` | `EXISTS(ticket_types available_online AND price_cents>0)` | after `event_dates` rewrite, before events update (`MAX(event_dates.end_at)`) | `RAISE`, Guard B only |

In-person-only paid (`available_online=false`) is exempt everywhere (T-16) — operator-confirmed 2026-06-04.

---

## 4. Spec success-criteria traceability

| SC | How verified | Verdict |
|---|---|---|
| SC-1 (paid exp publish, not ready → `stripe_charges_disabled`, stays draft) | Guard A in `biz_publish_experience`/`biz_create_experience` inside `IF p_publish`; RAISE aborts the txn before status flip. Source-contract test + plpgsql parse. | PASS (source); behavioral = SQL probe post-push |
| SC-2 (paid exp publish, past date → `offering_date_past`) | Guard B computes `v_max_end` from when payload. | PASS (source) |
| SC-3 (paid event publish guards; event_dates preserved) | Guards on `v_paid_online`; `INSERT INTO public.event_dates` retained verbatim (orch-0792-A green). | PASS |
| SC-4 (paid trip publish guards; `trip_end_before_start` still fires) | Guard after pricing-tier check; existing end<start RAISE untouched. | PASS (source) |
| SC-5 (live exp/trip edit → `{ok:false,reason}`; existing rejections fire) | Structured returns added before existing gates; price/date refund-gates untouched. | PASS (source) |
| SC-6 (`business_patch_event_when` paid past → `offering_date_past`; free exempt) | Guard B gated on `v_event_is_paid_online`. | PASS (source) |
| SC-7 (`pg_brand_can_charge` == checkout predicate) | Helper body reads `stripe_connect_accounts.charges_enabled WHERE detached_at IS NULL …`; Deno test asserts it, does NOT read the brands cache. Live probe confirms false for Lantern & Vine. | PASS |
| SC-8 (FREE + ready-future PAID publish normally) | Guards wrapped in paid predicate; FREE/in-person bypass. Deno asserts paid-only gating. | PASS (source) |
| SC-9-iOS / SC-9-Android (locked copy + route, no raw error) | Shared RN `paidPublishGuards` + 6 wired call sites; jest asserts locked copy + route. Parity automatic (shared code). | PASS (code); on-device QA = tester |
| SC-10 (buyer 409 unchanged) | No edge-fn / checkout change in the diff. | PASS |

---

## 5. Regression Test (Step 0.5) — MANDATORY

- **jest (business-app catch sites):** `mingla-business/src/utils/__tests__/paidPublishGuards.test.ts` — **10/10 PASS** (`npx jest paidPublishGuards.test --runInBand`, exit 0). Covers reason detection from both `error.message` (decorated RAISE) and `data.reason` (edit), locked copy strings, the onboarding route, and no-over-reach on unrelated reasons.
- **Deno (migration source-contract):** `supabase/migrations/__tests__/orch_1075_paid_publish_integrity_guards.test.ts` — **13/13 PASS** (`deno test --allow-read …`). Asserts the helper mirrors the checkout source predicate, every money RPC carries both guards, `business_patch_event_when` carries Guard B only (and NOT Guard A), paid-only gating, event_dates preserved, Stripe docs cited.
- **Behavioral live-DB probe:** `supabase/migrations/__tests__/orch_1075_paid_publish_integrity_guards.test.sql` — write-safe (ROLLBACK), hand-run post-`db push`. Exercises `pg_brand_can_charge` true/false against seeded brands + asserts guard markers (M-00…M-03). Not runnable in this session because Supabase MCP `execute_sql` runs in a **read-only transaction** (cannot create temp fixtures / call write RPCs).

**fails-on-revert verified at commit `e2c58f9bd`:** stripping Guard A (`pg_brand_can_charge` + RAISE) from `business_publish_event_draft` in the migration made BOTH the Deno test (`1 failed`) AND the strict-grep gate (exit 1, "missing Guard A marker") FAIL; restoring (byte-identical, empty git diff) returned both to green (Deno 13/13, gate passed). For the jest catch-site test, reverting the locked title string failed 2 tests (exit 1); restoring passed 10/10.

---

## 6. Strict-grep run output (all green)

```
orch-1075 --self-test         → SELF-TEST PASSED
orch-1075 (real)              → gate passed (all paid-publish/edit RPCs carry the required guards)
orch-0792-A                   → passed (verified 20260911000000_orch_1075_paid_publish_integrity_guards.sql; INSERT INTO public.event_dates present)
orch-0792-B                   → passed
orch-0863 C7 no-new-backend   → OK [C7] zero touches outside allowlist (18 files changed total)
orch-0863 --self-test         → Self-test PASSED
```
Full local suite: the only two failing scripts are **pre-existing and unrelated** — `i-proposed-a-brands-deleted-filter.mjs` (ERR_MODULE_NOT_FOUND, broken import, byte-identical to origin/main) and `i-proposed-finalize-callers-pass-installment-params.test.mjs` (a node test file caught by the glob, not a gate). Neither is in this ORCH's diff.

---

## 7. tsc / lint

- `npx tsc --noEmit` (mingla-business): **zero errors in any ORCH-1075-touched file**. The baseline tsc errors that remain (`account.tsx` icon name, `buyer.tsx` implicit-any, `richEditor.tsx`, `@mingla/payments-native` module resolution, `packages/*` react resolution, pre-existing `category` test fixtures) are all in files this ORCH never touched — confirmed pre-existing.
- `npx eslint` on all 8 touched mingla-business files: **exit 0, zero warnings**.
- DDL + plpgsql parse (libpg_query via pglast 7.14): all 8 functions parse cleanly at both DDL and plpgsql level (`8 ok, 0 fail`).

---

## 8. Invariant verification

| Invariant | Preserved? |
|---|---|
| I-PUBLISH-WRITES-EVENT-DATES (orch-0792) | YES — `INSERT INTO public.event_dates` retained verbatim; orch-0792-A green. |
| `trg_events_enforce_master_date` | YES — untouched. |
| I-EVENT-TIMING-FROM-EVENT-DATES | YES — guards read in-scope computed dates / `event_dates`, no divergent source. |
| Checkout predicate (`20260727000000_orch_0955:380-382`) | YES — unchanged; `pg_brand_can_charge` mirrors, does not replace. |
| NEW I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED | ESTABLISHED — strict-grep gate asserts `pg_brand_can_charge(` in all 6 money RPCs. |
| NEW I-PAID-PUBLISH-REJECTS-PAST-DATE | ESTABLISHED — gate asserts `offering_date_past` in all 7. |

---

## 9. Cross-surface impact (Phase 2.5)

| Surface | Covered | Notes |
|---|---|---|
| Consumer iOS/Android | NO | no publish flow; buyer 409 unchanged |
| Buyer/anon web | NO | `ticket-checkout-create` 409 untouched (last-line defense) |
| Business iOS | YES | shared RN catch sites + onboarding route |
| Business Android | YES | shared RN — parity automatic in code; on-device QA is the tester's |
| Admin web | NO | no publish flow |
| Business web preview | adjacent | inherits the shared catch logic |

Parity is automatic (single shared `paidPublishGuards` + shared wizards), so iOS/Android cannot diverge in code; SC-9-iOS / SC-9-Android still require independent on-device QA (tester).

---

## 10. COMMS handling

- **COMMS-0002 (backend allowlist):** SATISFIED — `ORCH_1075_BACKEND_ALLOWLIST` (migration + 2 `__tests__` files) is in the strict-grep gate within the backend bundle; C7 verified GREEN locally.
- **COMMS-0003 (external-API docs):** SATISFIED — the two Stripe docs URLs are cited inline in the migration header + helper comment.
- **Formal ledger-row `acked_by` append (audit formality):** NOT applied this session. The shared anchor (`~/Desktop/mingla-main`) is currently in a **diverged + dirty** state (unpushed local commits + parallel-session uncommitted work + an autostash). Per COMMS-0019 + `[[shared-anchor-checkout-staging-hazard]]`, a direct-to-main ledger commit now risks the exact drop-on-rebase failure COMMS-0019 documents. **Recommendation for the orchestrator:** append this skill's ack tokens to COMMS-0002 + COMMS-0003 `acked_by` when the anchor is clean. The substantive requirements of both entries are met in-commit regardless.

---

## 11. db-push command (for the orchestrator — DO NOT run from this implementor)

The migration is `CREATE OR REPLACE` only (no DROP, no backfill, no column change) → idempotent, safe to re-run. No remote-only versions exist (verified via MCP). The worktree is **not linked** (`migration list --linked` failed "Cannot find project ref"), so run the push from a linked checkout, or link this worktree first:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1075-[paid-publish-integrity-guards]" && /Users/sethogieva/bin/supabase db push --linked
```

After push, hand-run the behavioral probe to confirm live behavior:
```bash
# from a psql session against the linked DB:
\i supabase/migrations/__tests__/orch_1075_paid_publish_integrity_guards.test.sql
```
No edge-function deploy is required (no `supabase/functions/**` change).

---

## 12. Discoveries for Orchestrator

1. **Read-only MCP precludes behavioral DB tests in-session.** Supabase MCP `execute_sql` runs every statement in a read-only transaction (verified: `CREATE TEMP TABLE` → `25006 cannot execute … in a read-only transaction`). So the live-DB behavioral exercise (T-01…T-08 with real fixtures) is delivered as a hand-run `.test.sql` for the tester/push operator; the runnable-now Step-0.5 coverage is the Deno source-contract test + the jest catch-site test (both fails-on-revert proven). Not a defect — environment constraint.
2. **Anchor `main` is diverged + dirty** (see §10). This is the COMMS-0019 fragility class still live. Flagging so the orchestrator reconciles the anchor before the next direct-to-main ledger commit.
3. **ORCH-1076** is registered as a sibling (`334db9a2b` on this branch) for "server-side suppression of unsellable paid offerings" — queued behind ORCH-1075. No overlap with this implementation (1075 is publish-time reject; 1076 is post-fact suppression). No coordination entry needed beyond awareness.
