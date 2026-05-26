# CLOSE NOTE — META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]

**Status:** CLOSED PASS Grade A
**Closed by:** Claude `mingla-orchestrator`
**Close date:** 2026-05-26
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`
**Verified commit:** `77604c7c5` (per Sub-D grant retest); CLOSE artifact commit pending
**QA report commit:** `3a0cc69b1` (`Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_D_GRANT_RETEST.md`)
**Worktree reaped:** pending — after PR merges to main, run `scripts/orch-worktree/reap.sh ~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]`

---

## Step 0.5 regression-test gate — SATISFIED

**Implementor happy-path tests (all fails-on-revert verified):**

| Test path | Anchor | Coverage |
|---|---|---|
| `mingla-business/__tests__/components/BrandCreationFlow.test.tsx` | Sub-B `3414ea6b8` (fails-on-revert at `6633be066` pre-amend) | SC-B-1/2/5 |
| `mingla-business/__tests__/hooks/useHubVisibleTabs.test.tsx` | Sub-B `3414ea6b8` (fails-on-revert at `6633be066` pre-amend) | SC-B-6/13 |
| `mingla-business/__tests__/androidWebOnlyConnectRoutes.test.ts` | Sub-B Android rework #1/#2 | Android-only Stripe Connect SDK exclusion |
| `mingla-business/__tests__/androidRootStripeProviderIsolation.test.ts` | Sub-B Android rework #2 `19adf8004` | Root-layout Stripe boundary |
| `mingla-business/__tests__/androidOptionalSdkStartupIsolation.test.ts` | Sub-B Android rework #3 `1b560d669` | Android autolinking exclusions |
| `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` | Sub-C `a1c1d7f70` (fails-on-revert at `2aea165d5`) | SC-C-15 data-driven tabs |
| `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` | Sub-C `a1c1d7f70` (fails-on-revert at `2aea165d5`) | SC-C-14 RPC shape probe |
| `mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts` | Sub-D `7c7da04b8` (fails-on-revert at `a1c1d7f70`) | SC-D-8 strict-grep gate |
| `supabase/migrations/__tests__/pg_brand_offering_counts_grants.test.ts` | Sub-D grant rework `77604c7c5` | Grant repair contract |
| `supabase/migrations/__tests__/pg_brand_offering_counts_privilege_probe.sql` | Sub-D grant rework `77604c7c5` | Live + local SQL privilege probe |

**Tester adversarial tests (all PASS at HEAD, different angles from implementor):**

| Test path | Anchor | Attack angle |
|---|---|---|
| `mingla-business/__tests__/androidRootStripeTransitiveGraph.adversarial.test.ts` | Sub-B tester `39b59a36f` | Transitive import-graph (different from implementor's direct-import test) |
| `mingla-business/__tests__/strictGrep/noBrandKindReadsAppCoverage.test.ts` | Sub-D tester `bd49d6aee` | `app/` directory coverage (different from implementor's `src/` test) |

**Test-mod note for the eventual squash-merge body:** `[TEST-MOD-APPROVED META-ORCH-0972]` REQUIRED. Cumulative 13 pre-existing test files modified across Sub-B (2 files: `KeyboardRoot.adversarial.test.tsx` + `native_checkout_flow_parity.test.ts`) and Sub-C (11 files: 5 publicEventsService tests + 4 PublicBrandPage tests + `homeNextAction.test.ts` + `upcomingBuilder.adversarial.test.ts`). All realignments are mirror-images to the new brand-kind-removed contract — assertions strengthened, not weakened. `.github/workflows/tests-append-only.yml` will reject the PR merge without the tag.

---

## Step 1.5 DIAG-marker reap — CLEAN

```
$ grep -rn "\[META-ORCH-0972-DIAG\]" mingla-business/src/ mingla-business/app/ app-mobile/src/ supabase/functions/ mingla-admin/src/
(zero matches)
```

---

## Step 1 SYNC — what was updated in this CLOSE commit

| Artifact | Updated? | Notes |
|---|---|---|
| `Mingla_Artifacts/WORLD_MAP.md` | YES — comprehensive CLOSE blockquote prepended | Canonical record of the close. |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | YES — 4 new ACTIVE invariants + 3 SUPERSEDED markers | I-BRAND-UNIVERSAL-AUTHORING, I-PUBLIC-PAGE-DATA-DRIVEN-TABS, I-HUB-TABS-DATA-DRIVEN, I-VENUE-CLAIM-OPTIONAL added; I-PUBLIC-BRAND-KIND-BRANCHED + I-PROPOSED-TR1-PERSONA-INTERFACE + I-PROPOSED-TR1-KIND-IMMUTABLE marked SUPERSEDED with status notes. |
| `Mingla_Artifacts/DECISION_LOG.md` | YES — DEC-170 + DEC-171 appended | DEC-170 universal authoring decision; DEC-171 data-driven public/hub tabs decision. |
| `Mingla_Artifacts/WORKTREE_REGISTRY.md` | YES — META-ORCH-0972 row removed | Per `feedback_orchestrator_removes_registry_row_in_close_commit.md`. |
| `Mingla_Artifacts/CLOSE_NOTE_META-ORCH-0972.md` | YES — this file | The CLOSE artifact for audit. |
| `Mingla_Artifacts/MASTER_BUG_LIST.md` | SYNC-deferred | Avoiding merge conflicts with parallel in-flight ORCHs touching `Mingla_Artifacts/`. WORLD_MAP serves as the canonical record. |
| `Mingla_Artifacts/COVERAGE_MAP.md` | SYNC-deferred | Same reason. |
| `Mingla_Artifacts/PRODUCT_SNAPSHOT.md` | SYNC-deferred | Same reason. |
| `Mingla_Artifacts/PRIORITY_BOARD.md` | SYNC-deferred | Same reason. |
| `Mingla_Artifacts/AGENT_HANDOFFS.md` | SYNC-deferred | Same reason. |
| `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | SYNC-deferred | Same reason. |

The 6 SYNC-deferred artifacts will be rolled up in a future SNAPSHOT/SWEEP pass that touches them atomically; this matches the established pattern from the last 6+ closes (ORCH-0954/0961/0962/0965/0957/0915).

---

## Step 5 DEPRECATION CLOSE PROTOCOL EXTENSION

This close decommissions `brands.kind` as a feature/authoring gate. Stage 4 (`DROP COLUMN brands.kind`) ships as a separate follow-up migration ≥1 release cycle later. The 8-step extension flags are:

| Step | What | Status |
|---|---|---|
| 5a | NEW persistent memory file `feedback_brand_kind_decommissioned.md` | EXISTS as DRAFT in operator's Claude memory (per MEMORY.md index). **Operator flips DRAFT → ACTIVE on this CLOSE.** |
| 5b | MEMORY.md index update | **Operator action** — change status text from `(status: DRAFT post META-ORCH-0972 REGISTERED 2026-05-25)` to `(status: ACTIVE post META-ORCH-0972 CLOSE 2026-05-26)`. |
| 5c | Existing memory file scan | Memory rules to update: `feedback_brand_kind_immutable_post_create.md` (mark SUPERSEDED), `feedback_persona_picker_locked_interface.md` (mark SUPERSEDED). **Operator action.** |
| 5d | Skill definition review | Grep `.claude/skills/*/SKILL.md` for `brands.kind` / `brand.kind` / `currentBrand.kind` / `PersonaPickerCards` / `PersonaForkSheet` / `TripBrandWizard`. Update any skill that describes these as live. **Operator action** — orchestrator skill text is unchanged by this close. |
| 5e | INVARIANT_REGISTRY | DONE — 4 added, 3 SUPERSEDED in this CLOSE commit. |
| 5f | DECISION_LOG | DONE — DEC-170 + DEC-171 in this CLOSE commit. |
| 5g | PRODUCT_SNAPSHOT + ROOT_CAUSE_REGISTER | SYNC-deferred (see Step 1 table). Future SWEEP pass to absorb. |
| 5h | Backup snapshot retention reminder | DEFERRED — Stage 4 follow-up migration will handle the optional 14-day archive snapshot if any live rows carry meaningful `kind` values at drop time. 21 live brands today carry kind values; archive snapshot is the recommended default. Cron / `/schedule` reminder to be created when Stage 4 ships. |

---

## Vercel `[deploy]` gate decision

**Tag REQUIRED.** Sub-C + Sub-D touch `mingla-business/src/` + `mingla-business/app/` + `mingla-admin/src/` (Sub-A admin Claims tabs). Sub-D touches `.github/scripts/strict-grep/` + `.github/workflows/`. Sub-B touches all 3 Vercel projects' shared `mingla-business/` source tree.

The CLOSE commit MUST contain `[deploy]` in the subject line.

---

## EAS OTA recommendation

Native module changes shipped in Sub-B Android rework #3 (autolinking exclusions in `mingla-business/package.json`). These are config-layer changes, not new native dependencies — production EAS builds with env keys set will continue to include all SDKs (OneSignal / AppsFlyer / RevenueCat / Stripe RN). However, the autolinking exclusion rules themselves are evaluated at build time, so:

- **Recommended:** `cd app-mobile && eas update --branch production --platform ios,android --message "META-ORCH-0972: brand-kind decommission + universal authoring"` for the JS-side changes that DON'T require native rebuilds (Sub-A, Sub-B JS, Sub-C TS).
- **NOTE:** The Sub-B rework #3 autolinking config change technically requires `eas build --profile production --platform android` to actually take effect in production binaries — operator decision whether to ship a fresh production build now or roll the autolinking improvement into the next regular release cycle.

---

## Migrations applied

| Migration | Status |
|---|---|
| `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` | APPLIED 2026-05-26 (Sub-C; operator `supabase db push --linked`) |
| `supabase/migrations/20260729000001_meta_orch_0972_pg_brand_offering_counts_grants.sql` | APPLIED 2026-05-26 (Sub-D grant rework; operator `supabase db push --linked`) |
| `supabase/migrations/20260730000000_meta_orch_0972_drop_brand_kind.sql` | NOT YET CREATED (Stage 4 follow-up; allowlist placeholder already in `ORCH_0972_BACKEND_ALLOWLIST`) |

Live Mgmt API verification post-grant-rework:
- `anon_can_execute(pg_brand_offering_counts) = false`
- `authenticated_can_execute(pg_brand_offering_counts) = true`
- `proacl = "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}"`
- Anonymous REST `POST /rest/v1/rpc/pg_brand_offering_counts` returns HTTP 401 `permission denied for function`

---

## Edge function deploys (orchestrator-executed at Sub-D REVIEW)

| Function | Pre-deploy version | Post-deploy version | Δ | verify_jwt preserved |
|---|---|---|---|---|
| `parse-restaurant-menu` | 38 | 39 | +1 | true |
| `parse-play-activities` | 37 | 38 | +1 | true |
| `agent-chat` | 71 | 72 | +1 | true |
| `agent-confirm-action` | 66 | 67 | +1 | true |

Fresh `ezbr_sha256` hashes confirmed via `mcp__supabase__list_edge_functions`; `entrypoint_path` for all 4 now reflects the META-ORCH-0972 worktree, proving deploys came from this branch.

---

## Commit message (ready to use)

```
[deploy] Close META-ORCH-0972 [TEST-MOD-APPROVED META-ORCH-0972]: brand-kind decommission + universal authoring + data-driven hub/public tabs

Every brand can now author every offering type (event, trip, experience)
regardless of kind. Public brand page and business hub render data-driven
tabs from real offering counts. brands.kind retained in DB until Stage 4
follow-up; TS field deleted; 3 persona files (PersonaPickerCards,
PersonaForkSheet, TripBrandWizard) removed. Atomic Stage 0+2+3 migration
20260729000000 + grant repair 20260729000001 both live on remote. 4 edge
functions deployed (parse-restaurant-menu v39, parse-play-activities v38,
agent-chat v72, agent-confirm-action v67), verify_jwt: true preserved.
Android live-fire PASS on Pixel 8 Pro after 3-rework cascade.

ORCH-IDs closed: META-ORCH-0972 (4 sub-specs A/B/C/D + Sub-D grant rework).
QA verdict: PASS Grade A — P0:0 P1:0 P2:0 P3:0 P4:2 non-blocking notes.
Deploy notes: web auto-deploys on [deploy] tag push (Vercel gate); EAS OTA
recommended for JS-side native parity (cd app-mobile && eas update --branch
production --platform ios,android --message "META-ORCH-0972"); Sub-B rework
#3 autolinking config change may need fresh eas build for full effect in
production binaries. Migrations 20260729000000 + 20260729000001 already
applied to remote. 4 invariants flipped DRAFT → ACTIVE; 3 SUPERSEDED.
DEC-170 + DEC-171 added. Worktree to be reaped post-merge.
```

---

## Operator post-CLOSE actions

1. Verify CLOSE commit pushes cleanly to `meta-orch-0972-brand-kind-decommission-universal-features`.
2. Open PR: `gh pr create --base main --head meta-orch-0972-brand-kind-decommission-universal-features --title "Close META-ORCH-0972 [TEST-MOD-APPROVED META-ORCH-0972]: brand-kind decommission + universal authoring + data-driven hub/public tabs" --body "<paste WORLD_MAP CLOSE blockquote>"`.
3. Pre-merge gate: `gh pr checks <PR#> --watch` until all required checks green; `gh pr view <PR#> --json mergeable,mergeStateStatus,reviewDecision` to confirm CLEAN + no BEHIND.
4. Merge: `gh pr merge <PR#> --squash --delete-branch` — confirm the squash message preserves `[TEST-MOD-APPROVED META-ORCH-0972]` (required by `tests-append-only` CI gate) AND `[deploy]` (required by Vercel ignore-build-step gate).
5. Vercel verification: after push to main, check Vercel dashboard for all 3 projects building (not "Ignored"). If any show "Ignored" with `[deploy]` present, that's a real failure — empty-commit recovery is documented in `feedback_vercel_deploy_gate.md`.
6. EAS OTA: optional but recommended — `cd app-mobile && eas update --branch production --platform ios,android --message "META-ORCH-0972: brand-kind decommission + universal authoring"`.
7. Reap worktree: `scripts/orch-worktree/reap.sh ~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]`, then remove the folder from your VS Code multi-root workspace.
8. Memory rule flips: change `feedback_brand_kind_decommissioned.md` status from DRAFT to ACTIVE in MEMORY.md; mark `feedback_brand_kind_immutable_post_create.md` + `feedback_persona_picker_locked_interface.md` as SUPERSEDED.
9. Decide on Stage 4 timing: open a new ORCH for `DROP CONSTRAINT brands_kind_check` + `DROP COLUMN brands.kind` with an optional 14-day archive snapshot, scheduled for ≥1 release cycle after this merge.
