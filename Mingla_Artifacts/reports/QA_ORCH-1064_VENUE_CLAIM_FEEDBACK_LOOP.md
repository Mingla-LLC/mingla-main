# QA — ORCH-1064 [admin↔business venue-listing feedback loop]

**Status:** VERDICT — **CONDITIONAL PASS** (code-level + regression PASS; live end-to-end sim round-trip deferred to orchestrator post-merge per dispatch scope)
**Skill:** mingla-tester (Claude) — TEST mode, independent verification
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1064-[venue-claim-feedback-loop]/` on branch `ORCH-1064-venue-claim-feedback-loop`
**Scope (per dispatch):** CODE-LEVEL + REGRESSION pass. Live edge-fn deploy + live admin↔business round-trip smoke are the orchestrator's post-merge job, NOT this pass. Migration `20260901000000` is ALREADY APPLIED to remote (orchestrator via Management API) — read-only SQL probes against remote were used; no remote mutation, no deploy.
**Comms ledger:** read on entry. Relevant OPEN entries COMMS-0002 (strict-grep backend allowlist), COMMS-0003 (external-API docs cited), COMMS-0018 (canonical reconciled `admin-review-venue-claim` base) were all already `acked_by` the ORCH-1064 implementor; verified the implementation honors each. No new cross-ORCH discovery this turn → no new ledger entry written.

---

## 1. Verdict summary

| | |
|---|---|
| **Verdict** | **CONDITIONAL PASS** |
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 1 (env note — local-db apply residue, see §8) |
| P4 | 2 (praise — clean RLS-only-write modeling; honest impl report) |
| **Adversarial test** | `supabase/migrations/__tests__/orch_1064_feedback_owner_rls.adversarial.test.sql` — 9 assertions, ALL PASS on real Postgres; fails-on-revert proven on TWO security axes |
| **RLS owner-read isolation** | **HOLDS** — proven by live execution (owner A sees 0 of brand B's feedback) |
| **RPC-only-write invariant** | **HOLDS** — proven by live execution (direct owner UPDATE affects 0 rows) |

**The CONDITIONAL is solely the live-fire sim round-trip deferral**, which the dispatch explicitly assigns to the orchestrator post-merge ("the live round-trip smoke are the orchestrator's job post-merge — NOT yours"). Every code-level, backend-contract, RLS, RPC-guard, regression, and adversarial clause is **PASS** with captured evidence. There are zero open P0/P1.

---

## 2. Contract-verification table (file:line)

### 2.1 Backend — table, RLS, RPCs (verified live on remote + by execution on local)

| Contract | Where | Verified |
|---|---|---|
| Table `venue_claim_feedback` shape (id, brand_id FK→brands CASCADE, place_pool_id FK→place_pool SET NULL, round, category, note, overall_message, status, created_by, created_at, resolved_at) | `supabase/migrations/20260901000000_orch_1064_venue_claim_feedback.sql:34-47` | ✅ live: all columns + 2 FKs confirmed via `pg_constraint` probe |
| `status` CHECK `('open','fixed')` | migration:43 | ✅ live: `venue_claim_feedback_status_check` = `CHECK ((status = ANY (ARRAY['open','fixed'])))` |
| `category` CHECK 7-enum | migration:39-40 | ✅ live: `venue_claim_feedback_category_check` matches the 7 values exactly |
| `note` CHECK len>0 | migration:41 | ✅ live: `venue_claim_feedback_note_check` = `length(TRIM(note)) > 0` |
| RLS ENABLED | migration:62 | ✅ live: `relrowsecurity=true` |
| Admin FOR ALL policy `is_admin_user()` | migration:71-75 | ✅ live: policy `*` cmd, using+check = `is_admin_user()` |
| Owner FOR SELECT-only `biz_brand_effective_rank_for_caller >= biz_role_rank('account_owner')` | migration:78-84 | ✅ live: policy `r` cmd, using matches exactly |
| **NO owner INSERT/UPDATE/DELETE policy** (RPC-only-write) | migration §2 (absence) | ✅ live: only 2 policies exist (`*` admin, `r` owner) — no write policy. Adversarial ADV-2 proves a direct UPDATE is denied |
| `admin_add_venue_claim_feedback` admin-gated + opens `max(round)+1` + stamps `claim_follow_up_at` | migration:106-174 | ✅ live: SECURITY DEFINER, search_path `public,pg_temp`, grant→authenticated only; `auth.uid() null→not_authenticated`, `not is_admin_user()→forbidden` (lines 125-126); round=max+1 (143-144); stamp (168-170) |
| `biz_mark_feedback_item_fixed` owner-gated toggle | migration:188-218 | ✅ live: SECURITY DEFINER; owner predicate guard (205-207); resolved_at set/cleared |
| `biz_resubmit_venue_claim` owner-gated + SPEC guards | migration:231-279 | ✅ live: owner guard (248-250); `pending_review`+`follow_up` guard→`not_awaiting_resubmit` (254-255); `>=1 round` guard→`no_feedback_to_resubmit` (261-262); clears stamp (268-270) |
| `admin_get_claim_review_bundle` extended with `feedback` key, all META-ORCH-1062 fields preserved | migration:297-418 | ✅ live: pulled `pg_get_functiondef` from remote — byte-matches migration; retains ALL brand + place_pool fields incl. `ai_signal_scores_veto`; adds active-round `feedback` array |
| `venue_claim_active_feedback` view `security_invoker=true` | migration:91-97 | ✅ live: `security_invoker=true`, max-round predicate confirmed |
| `notify pgrst, 'reload schema'` | migration:429 | ✅ present |

### 2.2 Edge function — `add_feedback` branch

| Contract | Where | Verified |
|---|---|---|
| `add_feedback` early-return branch, admin-gated | `supabase/functions/admin-review-venue-claim/index.ts:264-325` | ✅ The top-of-handler `is_admin_user` gate (L244-248) runs BEFORE the branch; the RPC re-asserts admin via `userClient.rpc` |
| Calls `admin_add_venue_claim_feedback` via user client | index.ts:269-276 | ✅ |
| Writes `admin_audit_log` (`action:'venue_claim_feedback'`, metadata `{round,item_count}`) | index.ts:288-294 | ✅ |
| Fires business push **exactly once** via `sendPush` | index.ts:309-322 | ✅ Branch returns at L324 BEFORE the main-flow push (L538-551) — no double-push. Targets `brand.account_id`, copy from `feedbackPushCopy` |
| `verify_jwt:true` preserved | index.ts:233-234 | ✅ `authorization` header still required; no `config.toml`/dispatch change |
| Pre-RPC body validation | `reviewLogic.ts:76-127` `normalizeFeedbackBody` | ✅ mirrors RPC contract (brand_id + items[].category∈enum + non-empty note + nullable overall_message) — defense in depth |
| `feedbackPushCopy` (F-2 fix) | reviewLogic.ts:64-71 | ✅ title `"Your venue listing needs a few updates"`, body points at fix surface |

### 2.3 Admin UI (mingla-admin)

| Contract | Where | Verified |
|---|---|---|
| Feedback authoring panel (category select + note + Add item stager) | `mingla-admin/src/pages/ClaimsPage.jsx:893-959` | ✅ staged items list + Add item |
| Wires to edge `add_feedback` via service | `adminClaimsService.js` `addClaimFeedback` invoked `ClaimsPage.jsx:224` | ✅ routes through `admin-review-venue-claim` action `add_feedback` |
| `Send feedback` disabled at 0 items | ClaimsPage.jsx:979 `disabled={acting \|\| feedbackItems.length === 0}` | ✅ (SC-ADMIN-2) |
| Read-only current-round status from `bundle.feedback` | ClaimsPage.jsx:411-413 | ✅ Open/Fixed badges (SC-ADMIN-3) |

### 2.4 Business UI (mingla-business)

| Contract | Where | Verified |
|---|---|---|
| `follow_up` tile tappable + open-count badge | `VenueClaimStatusBanner.tsx:65-111` | ✅ `<Pressable>`, worded "N to fix" badge, "Ready" badge at openCount 0, chevron, a11y `role=button` |
| Other 3 variants byte-identical (diff-confirm) | `VenueClaimStatusBanner.tsx:113-124` vs origin/main | ✅ `git diff` confirms the static `<View accessibilityRole="summary">` render path is functionally unchanged; only the old `follow_up→toneWarning` static mapping was removed (now intercepted as the Pressable) |
| `VenueClaimFeedbackSheet` grouped items + Open/Fixed toggle + Re-submit CTA + 9 states | `VenueClaimFeedbackSheet.tsx` | ✅ `snapPoint="full"`; loading skeleton / error / empty / populated / all-fixed / submitting / success / offline / dark; fixed `CATEGORY_ORDER`; optimistic toggle; pinned always-enabled CTA |
| `useVenueClaimFeedback` hook + service | `useVenueClaimFeedback.ts`, `venueClaimService.ts` | ✅ enabled-on-follow_up query; optimistic markFixed (onMutate flip + onError rollback + onSettled invalidate); resubmit invalidates detail+feedback+list; `useVenueClaimOpenCount` selector |
| `brandKeys.feedback` factory (Constitution #4) | `useBrands.ts:85` | ✅ brand-scoped key from the factory |
| Foreground refresh invalidates feedback key | `useVenueClaimRefresh.ts:34-35` | ✅ |
| Single Toast host | `hub/_layout.tsx:248` (one `<Toast>`) | ✅ via `showToast` callback (DESIGN §6.7) |
| `HapticFeedback.success()` | `hapticFeedback.ts:22-24` | ✅ safe-wrapped notification Success |

---

## 3. Captured test runs

### 3.1 Implementor happy-path regression suites (re-run independently — all green)

```
deno test supabase/functions/admin-review-venue-claim/__tests__/orch_1064_feedback_loop.test.ts
  → ok | 11 passed | 0 failed

node --test mingla-admin/src/__tests__/orch1064_feedback_panel.test.js
  → tests 5 | pass 5 | fail 0

npx jest mingla-business/src/services/__tests__/venueClaimFeedback.orch1064.test.ts
  → Tests: 6 passed, 6 total
```

### 3.2 No-regression on existing immutable tests

```
npx jest venueClaimService.test.ts venueClaimFeedback.orch1064.test.ts
  → Test Suites: 2 passed; Tests: 10 passed (existing 4 + new 6 — append-only intact)

deno test (META-ORCH-1062 approve/scorer tests) WITH the documented --allow-net + env
  → ok | 7 passed | 0 failed
```
> Note: the two META-ORCH-1062 deno tests `error` if run WITHOUT `--allow-net` + `SUPABASE_*` env because they import `index.ts` (which calls `serve()` → binds 0.0.0.0:8000). This is a pre-existing harness requirement from META-ORCH-1062, NOT an ORCH-1064 regression — ORCH-1064's `add_feedback` branch is purely additive and the tests pass green with the flags their own headers specify.

### 3.3 fails-on-revert (implementor claims — independently re-verified)

| Reverted file | Test | Result | Restored |
|---|---|---|---|
| `mingla-business/src/services/venueClaimBannerLogic.ts` → origin/main | jest B-01 | ✅ FAILED on revert (`follow_up copy differs` broke) | ✅ clean |
| `supabase/functions/admin-review-venue-claim/reviewLogic.ts` → origin/main | deno orch_1064_feedback_loop | ✅ FAILED on revert (type-check failure — `feedbackPushCopy`/`normalizeFeedbackBody` gone) | ✅ clean |

### 3.4 tsc / eslint / strict-grep

```
mingla-business: npx tsc --noEmit → 243 pre-existing baseline errors; ZERO in ORCH-1064 touched files (grep-confirmed clean: VenueClaim*, useVenueClaim*, hub/_layout, hapticFeedback, useBrands)
mingla-business: eslint (9 touched files) → 0 errors
mingla-admin:    eslint (ClaimsPage.jsx + adminClaimsService.js) → 0 errors
strict-grep ORCH-0863 C7 (incl. ORCH_1064_BACKEND_ALLOWLIST) → All checks PASS (C1-C7), migration allowlisted, 23 files changed
```

### 3.5 Live remote read-only probes (Supabase MCP — no mutation)

- All 6 objects exist live: table, view, 3 RPCs, extended bundle.
- All constraints, RLS policies (2: admin-ALL + owner-SELECT, no write policy), SECURITY DEFINER + `search_path=public,pg_temp` + `grant→authenticated` confirmed.
- Live `admin_get_claim_review_bundle` definition byte-matches the migration with all META-ORCH-1062 fields intact.
- Edge case found in live data: brand `Lantern & Vine` is `pending_review` with `claim_follow_up_at` set but ZERO feedback rows (a pre-ORCH-1064 META-1062 stamp). Handled gracefully: `biz_resubmit_venue_claim` would raise `no_feedback_to_resubmit` (guard correct), and the sheet renders its empty state (`totalCount===0`). No defect.

---

## 4. Adversarial regression test (tester-authored — DIFFERENT angle)

**Path:** `supabase/migrations/__tests__/orch_1064_feedback_owner_rls.adversarial.test.sql`

**Why it's a different angle:** the implementor's deno test asserts the migration **text** contains certain substrings + validates the pure `normalizeFeedbackBody` input gate. It NEVER executes the SQL against a database, so it cannot prove the RLS predicate or RPC guards actually *behave* correctly at runtime — a migration can contain the right strings and still leak (wrong column in the predicate, missing guard, accidental owner-write policy). My test **executes the real DDL + RLS + RPCs against a live Postgres** (the local Supabase container, migration applied) with TWO distinct authenticated users, asserting the security invariants by behavior.

**Run (local Supabase Postgres `supabase_db_gqnoajqerqhnvulmnyvv`, migration applied locally, runs in ONE tx that ROLLS BACK):**

```
ADV-1  PASS: owner A sees only own feedback (1 row), zero of brand B (no leak)
ADV-1b PASS: security_invoker view enforces owner isolation
ADV-2  PASS: direct owner UPDATE denied (0 rows), status stays open — writes are RPC-only
ADV-4  PASS: non-owner mark-fixed raised forbidden
ADV-3c PASS: non-owner re-submit raised forbidden
ADV-3b PASS: re-submit without follow-up stamp raised not_awaiting_resubmit
ADV-3a PASS: owner re-submit cleared stamp, returned pending_review + resubmitted_round=1
ADV-3d PASS: re-submit with no feedback round raised no_feedback_to_resubmit
ADV-5  PASS: anon sees zero feedback rows
ORCH-1064 ADVERSARIAL: ALL PASS
```

**fails-on-revert (proven on TWO security axes by injecting the regression):**

| Injected regression | Test caught it? |
|---|---|
| Widen owner-SELECT policy to `using(true)` (RLS leak) | ✅ `ERROR: ADV-1 FAIL: owner A sees 2 rows, expected exactly 1` |
| Add a leaky owner-UPDATE policy (break RPC-only-write) | ✅ `ERROR: ADV-2 FAIL: direct owner UPDATE affected 1 rows` |

Both injected regressions were reverted and the final clean run is ALL PASS. This proves the adversarial test genuinely guards `I-1064-FEEDBACK-OWNER-READ` and `I-1064-RPC-WRITES-ONLY` — not just asserts strings.

**Maps to SPEC §9:** T-BE-2 (non-admin/non-owner forbidden), T-BE-6 (non-owner mark-fixed forbidden), T-BE-7/8 (resubmit guards + cross-brand RLS read = 0 rows), plus the SPEC's named revert-proof gate `orch_1064_feedback_owner_rls.adversarial`.

---

## 5. Invariant verification (independent)

| Invariant | Holds? | Proof |
|---|---|---|
| **I-1064-FEEDBACK-OWNER-READ** (no cross-brand leak) | ✅ | ADV-1/1b live execution: owner A sees 0 of brand B's rows (table + view); fails-on-revert proven |
| **I-1064-RPC-WRITES-ONLY** | ✅ | ADV-2 live execution: direct owner UPDATE → 0 rows; only 2 RLS policies exist live (no write policy); fails-on-revert proven |
| **I-1064-FEEDBACK-IMPLIES-FOLLOWUP** | ✅ | migration:168-170 always stamps; deno T asserts |
| **I-ADMIN-WRITE-GATED** | ✅ | RPC re-asserts `is_admin_user()` (migration:126); edge top-gate (index.ts:244-248) |
| **verify_jwt preserved** | ✅ | no config/dispatch change; `authorization` still required |
| Constitution #2 (one owner per truth) | ✅ | `need_more_info` stays `pending_review + claim_follow_up_at`; no competing status column |
| Constitution #3 (no silent failures) | ✅ | every mutation has onError + rollback; edge structured errors |
| Constitution #4 (one key per entity) | ✅ | `brandKeys.feedback` from the factory |

---

## 6. Cross-surface / no-other-surface-regression

- Consumer iOS/Android, buyer/anon web: NO claim-feedback surface — unaffected (confirmed; no shared code touched in those paths).
- Business iOS/Android: shared RN code; Sheet is the only platform split (`SheetMobile`/`Sheet.web`); Android opaque-glass satisfied by the Sheet primitive's `FALLBACK_BACKGROUND ≥0.92`.
- Admin web: feedback panel added in ClaimsPage modal; existing tweak/override/approve/reject paths untouched (additive).
- Existing `venueClaimService.test.ts` (4 immutable tests) still green → no banner-logic regression.

---

## 7. Phase 0.A live-fire sim gate — status: `probable` (environment-blocked, dispatch-deferred)

This IS a business UI/runtime change (Hub `follow_up` tile + feedback sheet). A genuine end-to-end sim repro of the tile→sheet→toggle→re-submit flow requires:
1. the migration live on remote **and** the edge fn `admin-review-venue-claim` **deployed** (orchestrator's post-merge job — NOT done in this pass, by dispatch),
2. a sim login as a brand owner whose claim is in `follow_up` with seeded feedback rows.

The `follow_up` tile only renders when live feedback data round-trips through the deployed edge fn + remote owner-RLS view. With the edge fn not yet deployed, the runtime tile cannot light up on a sim. The dispatch explicitly carves this out: *"the live edge fn deploy + the live round-trip smoke are the orchestrator's job post-merge — NOT yours."* This is an operator-accepted deferral baked into the dispatch scope.

What was verified in lieu of a live sim render: the component logic (banner variant + copy + badge derivation + 9-state branching) is unit-tested green; tsc + eslint clean on the components; the business app has no `@testing-library/react-native` harness for render tests (codebase convention is logic/service tests for this surface). I did NOT claim a sim render I did not perform.

**Recommendation for the orchestrator's post-merge smoke (SPEC §11.5):** admin sends feedback on a `pending_review` brand → business owner receives push → opens Hub tile (shows "Updates requested" + "N to fix") → opens sheet → toggles an item Fixed (admin modal then shows Fixed) → Re-submit → tile reverts to plain "being reviewed" + claim reappears in admin Pending queue. The brand `Lantern & Vine` (already `pending_review`+follow_up but 0 feedback rows) is a ready target to start an admin round on.

---

## 8. Defects (severity-ranked)

- **P3 (env note — not a code defect):** I applied the ORCH-1064 migration to the **local** Supabase Docker container (`supabase_db_gqnoajqerqhnvulmnyvv`) to run the adversarial RLS execution test. This local dev DB now carries the `venue_claim_feedback` objects. This is a developer-machine dev container, not remote, and the objects are byte-identical to the canonical migration (already live on remote). No action required; flagged for transparency. The remote was touched read-only only.
- **P4 (praise):** the RPC-only-write modeling (owner SELECT-only + writes routed through two SECURITY DEFINER RPCs, no owner write policy) is exactly right — it makes the leak surface minimal and is the cleanest expression of Constitution #2 for this feature.
- **P4 (praise):** the implementation report is honest about what was NOT verified (the live round-trip), naming it a genuine environment limitation rather than claiming a sim run.

No P0, no P1, no P2.

---

## 9. Completion-condition (`/goal`) audit

| Clause | Status |
|---|---|
| 1. Every independent test green (paths + output captured) | ✅ §3 |
| 2. tsc + lint clean on touched packages | ✅ §3.4 (243 are pre-existing baseline; zero in touched files) |
| 3. Both regression tests in branch diff; adversarial attacks a different angle; implementor fails-on-revert at cited commits | ✅ implementor 3 tests in diff (§2.3.x); adversarial = live-SQL behavior vs string-match; fails-on-revert re-verified §3.3 + §4 |
| 4. UI/runtime platform legs at `proven` | ⚠ `probable` — environment-blocked + dispatch-deferred to orchestrator post-merge (§7). This is the sole reason for CONDITIONAL vs full PASS |
| 5. Zero open P0 and P1 | ✅ |

Per the tester verdict gate, a UI/runtime change without `proven` sim evidence caps at CONDITIONAL PASS with explicit operator deferral. The deferral here is pre-authorized by the dispatch's own scoping. **The backend security core (the load-bearing risk for this feature) is at `proven` level via live SQL execution + remote probes + fails-on-revert.**

---

## 10. Discoveries for orchestrator

- The live round-trip smoke (admin→push→business→re-submit→admin-queue) is the remaining gate before close; §7 gives a ready repro using `Lantern & Vine`.
- Live data has a pre-ORCH-1064 brand (`Lantern & Vine`) carrying `claim_follow_up_at` with no feedback rows. The new guards handle it (resubmit→`no_feedback_to_resubmit`, sheet→empty state). The orchestrator may want to start a real admin feedback round on it as the smoke target.
- ID-collision OQ-1 (sibling `ORCH-1064-[sheet-nav-freeze-class]`) is unresolved — orchestrator must renumber one before close (migration uses a timestamp filename, so no file collision regardless).

**End of QA — ORCH-1064.**
