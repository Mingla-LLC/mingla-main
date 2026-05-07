# Implementation Report: ORCH-0750B README Snapshot Rebuild

> Date: 2026-05-07  
> Mode: Spec Execute  
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0750B_README_SNAPSHOT_REBUILD.md`  
> Dispatch: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0750B_README_SNAPSHOT_REBUILD.md`  
> Status: implemented and verified

## 1. Plain-English Summary

README is now a front door instead of a stale filing cabinet.

The root README was rewritten as a current ecosystem snapshot with live inventory provenance and a clear artifact atlas. The mobile README was rewritten as an app-local guide and no longer duplicates global backend counts.

No product code, migrations, Supabase functions, archive moves, or deletes were made for ORCH-0750B.

## 2. Files Changed

| File | Change | Scope |
|---|---|---|
| `README.md` | Rebuilt as root ecosystem snapshot, source-of-truth map, repo map, backend snapshot, local dev guide, and maintenance guide. | In scope |
| `app-mobile/README.md` | Rebuilt as mobile-local setup, commands, architecture pointers, env vars, builds, and docs boundary. | In scope |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750B_README_SNAPSHOT_REBUILD.md` | New implementation evidence report. | In scope |

`Mingla_Artifacts/ARTIFACT_MANIFEST.md` was not edited. Existing manifest metadata was sufficient.

## 3. Exact Inventory Command Outputs

### `git rev-parse --short HEAD`

```text
8168cf16
```

### `git status --short`

```text
 M Mingla_Artifacts/AGENT_HANDOFFS.md
 M Mingla_Artifacts/COVERAGE_MAP.md
 M Mingla_Artifacts/DECISION_LOG.md
 M Mingla_Artifacts/INVARIANT_REGISTRY.md
 M Mingla_Artifacts/OPEN_INVESTIGATIONS.md
 M Mingla_Artifacts/PRIORITY_BOARD.md
 M Mingla_Artifacts/PRODUCT_SNAPSHOT.md
 M Mingla_Artifacts/WORLD_MAP.md
 M app-mobile/app/index.tsx
 M app-mobile/package.json
 M app-mobile/src/components/AppStateManager.tsx
 M app-mobile/src/components/OnboardingFlow.tsx
 M app-mobile/src/components/profile/AccountSettings.tsx
 M app-mobile/src/components/ui/Icon.tsx
 M app-mobile/src/config/queryClient.ts
 M app-mobile/src/hooks/useAuthSimple.ts
 M app-mobile/src/hooks/useFriendsQuery.ts
 M app-mobile/src/hooks/useProfileInterests.ts
 M app-mobile/src/services/appsFlyerService.ts
 M app-mobile/src/services/blockService.ts
 M app-mobile/src/services/cardEngagementService.ts
 M app-mobile/src/services/friendsService.ts
 M app-mobile/src/store/appStore.ts
 M supabase/functions/run-place-intelligence-trial/index.ts
?? Mingla_Artifacts/ARTIFACT_MANIFEST.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V8_DENO_GATE_REWORK_REPORT.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH_REPORT.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md
?? Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md
?? Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_V8_FLASH_THROUGHPUT_DEEP_DIVE.md
?? Mingla_Artifacts/reports/INVESTIGATION_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md
?? Mingla_Artifacts/reports/INVESTIGATION_ORCH-0750_DOCUMENTATION_ARTIFACTS_TOTAL_SWEEP.md
?? Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md
?? Mingla_Artifacts/reports/QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md
?? Mingla_Artifacts/reports/RUNTIME_QA_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md
?? Mingla_Artifacts/reports/SPEC_ORCH-0749_MOBILE_AUTH_CACHE_RLS_LOG_STORM.md
?? Mingla_Artifacts/reports/TEST_REPORT_ORCH-0737_V8_DENO_GATE_RETEST.md
?? Mingla_Artifacts/reports/TEST_REPORT_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md
?? Mingla_Artifacts/reports/TEST_REPORT_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md
?? Mingla_Artifacts/specs/SPEC_ORCH-0737_V8_FLASH_MEASUREMENT_PATCH.md
?? Mingla_Artifacts/specs/SPEC_ORCH-0750A_ARTIFACT_MANIFEST_LINK_INTEGRITY.md
?? Mingla_Artifacts/specs/SPEC_ORCH-0750B_README_SNAPSHOT_REBUILD.md
?? app-mobile/scripts/ci/orch-0749-regression-check.mjs
?? app-mobile/src/utils/authCleanup.ts
?? app-mobile/src/utils/queryPersistence.ts
?? scripts/docs/
?? supabase/migrations/20260507000003_orch_0737_v8_timing_diagnostics.sql
```

Note: the dirty product files above pre-existed ORCH-0750B and were not edited by this implementation.

### Function directory count including `_shared`

Command:

```bash
find supabase/functions -mindepth 1 -maxdepth 1 -type d | sed 's#supabase/functions/##' | sort | wc -l
```

Output:

```text
      66
```

### Deployable function directory count excluding `_shared`

Command:

```bash
find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_shared' | sed 's#supabase/functions/##' | sort | wc -l
```

Output:

```text
      65
```

### Function directory list

```text
_shared
accept-tag-along
admin-place-search
admin-refresh-places
admin-seed-map-strangers
admin-seed-places
admin-send-email
ai-reason
backfill-place-photos
brand-mingla-tos-accept
brand-stripe-balances
brand-stripe-detach
brand-stripe-onboard
brand-stripe-refresh-status
compute-engagement-scores
decline-tag-along
delete-user
discover-cards
events
generate-ai-summary
generate-curated-experiences
generate-holiday-categories
get-companion-stops
get-nearby-people
get-paired-saves
get-person-hero-cards
get-picnic-grocery
keep-warm
lookup-phone
notify-birthday-reminder
notify-calendar-reminder
notify-dispatch
notify-holiday-reminder
notify-invite-response
notify-lifecycle
notify-message
notify-pair-activity
notify-pair-request-visible
notify-referral-credited
notify-session-match
process-referral
record-visit
replace-curated-stop
run-bouncer
run-place-intelligence-trial
run-pre-photo-bouncer
run-signal-scorer
score-place-photo-aesthetics
send-collaboration-invite
send-friend-accepted-notification
send-friend-request-email
send-message-email
send-otp
send-pair-accepted-notification
send-pair-request
send-phone-invite
send-tag-along
stripe-kyc-stall-reminder
stripe-webhook
stripe-webhook-health-check
submit-feedback
ticketmaster-events
update-map-location
upsert-leaderboard-presence
verify-otp
weather
```

### Active migration file count

Command:

```bash
find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sed 's#supabase/migrations/##' | sort | wc -l
```

Output:

```text
      26
```

### Active migration file list

```text
20260505000000_baseline_squash_orch_0729.sql
20260505000001_orch_0734_city_runs.sql
20260505000002_orch_0734_signal_id_nullable.sql
20260506000000_brand_kind_address_cover_hue_media.sql
20260506000001_orch_0737_async_trial_runs.sql
20260506000002_orch_0737_v3_cron_filter_cancelling.sql
20260507000000_orch_0734_rls_returning_owner_gap_fix.sql
20260507000002_orch_0737_v4_prep_status.sql
20260507000003_orch_0737_v8_timing_diagnostics.sql
20260508000000_b2a_stripe_connect_onboarding.sql
20260509000001_b2_payouts_stripe_id_unique.sql
20260509000002_b2_kyc_stall_reminder_column.sql
20260510000001_b2a_path_c_trigger_detach_cascade.sql
20260510000002_b2a_path_c_revoke_anon_status_grant.sql
20260511000001_b2a_v3_country_support.sql
20260511000002_b2a_v3_external_accounts.sql
20260511000003_b2a_v3_notifications.sql
20260511000004_b2a_v3_gdpr_erasure.sql
20260511000005_b2a_v3_tos_acceptance.sql
20260511000006_b2a_v3_account_type_rename.sql
20260511000007_b2a_v3_webhook_retry_count.sql
20260511000008_b2a_v3_payments_webhook_secrets.sql
20260512000001_b2a_v3_mingla_revenue_log.sql
20260513000001_b2a_v3_owner_team_members_backfill.sql
20260513000002_b2a_v3_audit_log_target_id_text.sql
20260514000000_b2a_v3_brand_owner_team_member_trigger.sql
```

### Package roots

```text
./app-mobile/package.json
./mingla-admin/package.json
./mingla-business/package.json
./mingla-marketing/package.json
./scripts/package.json
```

## 4. Old Stale Claims Removed

| Claim | Previous location | Result |
|---|---|---|
| `57 Deno edge functions` | root README, app-mobile README | Removed. Root README now uses live snapshot count and command provenance. |
| `288 SQL migration files` | root README | Removed. Root README now uses active migration snapshot and points to the ORCH-0729 archive for history. |
| Absent function `new-generate-experience-` | app-mobile README and root README | Removed. |
| Absent functions `discover-experiences`, `get-personalized-cards`, `generate-session-deck`, `warm-cache`, `places` | root README | Removed. |
| Root README as "mobile + admin" only | root README intro | Replaced with full ecosystem map: mobile, business, admin, marketing, Supabase, scripts, docs, artifacts. |
| App README global backend inventory | app-mobile README | Removed. App README now links up to root/artifacts for global truth. |

## 5. README Artifact Atlas Links Added

Root README now links to:

- `Mingla_Artifacts/ARTIFACT_MANIFEST.md`
- `Mingla_Artifacts/WORLD_MAP.md`
- `Mingla_Artifacts/PRODUCT_SNAPSHOT.md`
- `Mingla_Artifacts/PRIORITY_BOARD.md`
- `Mingla_Artifacts/DECISION_LOG.md`
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- `Mingla_Artifacts/reports/ORCH-0750A_LINK_AUDIT.md`

The mobile README links upward to root README, the artifact manifest, world map, product snapshot, priority board, and core docs.

## 6. Verification

| Check | Command | Result |
|---|---|---|
| Stale count grep | `rg -n "57 Deno|57 edge|288 SQL|288 migration" README.md app-mobile/README.md` | PASS, exit 1 with no output. |
| Dead function grep | `rg -n "new-generate-experience-|discover-experiences|get-personalized-cards|generate-session-deck|warm-cache|\\bplaces\\b" README.md app-mobile/README.md` | PASS, exit 1 with no output. |
| Link checker markdown | `python3 scripts/docs/check_links.py --format markdown` | PASS after this report was added: 424 files checked, 2,392 links, 1,195 missing. |
| Link baseline gate | `python3 scripts/docs/check_links.py --max-missing 1195` | PASS after this report was added: 424 files checked, 2,392 links, 1,195 missing. |
| Expected doc diff | `git diff --name-status -- README.md app-mobile/README.md Mingla_Artifacts/ARTIFACT_MANIFEST.md` | PASS: only README.md and app-mobile/README.md changed among those paths. |

## 7. Scope Safety

| Boundary | Result |
|---|---|
| Product code | No product code edited for ORCH-0750B. Pre-existing dirty product files remain unrelated. |
| Supabase functions | No function edited for ORCH-0750B. |
| Migrations/RLS/schema/data | No changes. |
| Package dependencies | No changes. |
| Archive moves | None. |
| Deletes | None. |
| Broad link cleanup | Not attempted. Link debt remains measured at 1,195. |
| Prompt-file evidence | README does not link to prompt files. |

## 8. Spec Traceability

| Spec criterion | Status | Evidence |
|---|---|---|
| Root README becomes ecosystem snapshot | PASS | Root README has ecosystem snapshot, source-of-truth atlas, repo map, backend snapshot, app surfaces, local dev, verification sections. |
| App README becomes app-local | PASS | Mobile README focuses on setup, commands, architecture pointers, env vars, builds, docs boundary. |
| Live inventory commands used | PASS | Outputs recorded in Section 3. |
| Stale 57/288 claims removed | PASS | Grep clean. |
| Dead function references removed | PASS | Grep clean. |
| Link debt not increased | PASS | Missing count remains 1,195 after this report was added. |
| No archive/delete/product code | PASS | Scope safety table above. |

## 9. Residual Risks

- Link debt remains high by design. ORCH-0750B did not repair historical artifact links.
- `mingla-admin/README.md` and `mingla-business/README.md` still contain older local prose; they were explicitly out of scope.
- `mingla-marketing/` still has no README; creation was explicitly out of scope.
- Root README snapshot counts will drift if functions/migrations are added. The `Last Synced` block now makes that drift visible and gives the commands to refresh it.

## 10. Deploy Notes

No deploy required.

- Mobile OTA: none.
- Business/admin/marketing deploy: none.
- Supabase db push: none.
- Edge function deploy: none.

## 11. Ready-For-Tester Checklist

- [x] Root README rewritten.
- [x] App-mobile README rewritten.
- [x] Stale count grep clean.
- [x] Dead function grep clean.
- [x] Link checker markdown mode passes.
- [x] Link checker baseline gate passes.
- [x] No archive moves.
- [x] No deletes.
- [x] No product/runtime code edited for this ORCH.
- [x] Implementation report written.

IMPLEMENTATION COMPLETE - READY FOR TESTER
