# IMPLEMENTATION — REWORK 6 — META-ORCH-1009 Sub-E [business-app supply-feeder] venue-wizard bugs

Worktree: `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-E-[business-app-supply-feeder]`
Branch: `META-ORCH-1009-Sub-E-business-app-supply-feeder`
Base commit (fails-on-revert anchor): `22649eb27`
Commits: B6 = `3f9e2a7c1`; B1–B5 = `7c4d8e1f2`
Edge fn deployed: `run-business-place-authoring-pipeline` v4 (ACTIVE) — verify-first-call 401 + structured envelope (non-404).

## Per-bug summary

| Bug | Root cause | Fix (file:line) | Commit | Test |
|-----|-----------|-----------------|--------|------|
| B6 (submit fails, no place_pool row) | Client threw the opaque `FunctionsHttpError` ("non-2xx status code"); a partial edge failure left brand created but place_pool + pipeline_state empty. DB inserts themselves are valid (reproduced as service role, both succeed). | Client: `businessPlaceAuthoringService.ts` `pipelineInvokeError()` reads `error.context` body + `upsertTier1Place` throws real `{code,message}`. Edge fn `run-business-place-authoring-pipeline/index.ts:173-268` idempotent reuse + brand back-link + pipeline_state upsert(onConflict brand_id) + structured `console.error`. | `3f9e2a7c1` | `upsertTier1PlaceError.test.ts` (real-message + fallback); fails-on-revert @ `22649eb27` |
| B5 (false "slug taken") | Only slug feedback was the create RPC's `slug_taken` exception, which counted the caller's OWN just-created brand from a prior partial submit (the B6 orphan). | `brandsService.ts checkVenueSlugAvailable()` scopes to `deleted_at IS NULL` + excludes own account; `VenueStep2NameSlug.tsx` debounced live check. | `7c4d8e1f2` | `venueSlugAvailability.test.ts` (own-brand/soft-delete scoping); fails-on-revert @ `22649eb27` |
| B3 (manual slug entry) | `VenueStep2NameSlug` slug field was hand-typed only. | `VenueStep2NameSlug.tsx` auto-derives kebab slug from name (until hand-edited) + tappable numbered suggestions via `suggestVenueSlugs()`. | `7c4d8e1f2` | `venueSlugAvailability.test.ts` (suggestions) |
| B2 (Continue dead-tap on address) | Dock Continue called `() => canContinue && onNext()` — looked active, silently no-op'd; the wizard dock Continue had no `disabled`. | `VenueCreatorWizard.tsx` computes `stepValid = venueStepError(step,draft)===null` and passes `disabled={!stepValid}` to the dock Continue. On step 0 that requires a validated address with lat/lng. | `7c4d8e1f2` | Covered by `venueWizardValidation.test.ts` (existing) + manual |
| B1 (category cards wider than Continue) | `VenueCategoryPicker.host` had its own `paddingHorizontal: lg` (double-padded vs section) AND the category Continue button was content-width (`fullWidth` absent → narrow). | `VenueCategoryPicker.tsx` removed inner `paddingHorizontal`; `app/venue/create.tsx` category Continue now `fullWidth`. | `7c4d8e1f2` | Visual / manual |
| B4 (hero cover "coming soon") | DELIBERATE architectural constraint: `CoverPickerSheet` requires an existing `brandId`; the brand is only created at submit, so cover is collected on the post-submit deck-readiness screen. Not a buildable in-wizard picker without a temp-brand/deferred-upload flow. | `VenueStep3Photos.tsx` copy clarified ("Next: add your cover" / post-submit). NOT wired in-wizard. | `7c4d8e1f2` | n/a — see NEEDS-OPERATOR |

## NEEDS-OPERATOR

- **B4 — hero cover in the wizard.** The unified CoverPicker uploads to an existing brand (`CoverPickerSheet` requires `brandId`/`accountId`). In the create wizard the brand doesn't exist until submit, which is exactly why the existing design collects the cover on the post-submit deck-readiness screen (`VenueDeckReadinessSetup` already mounts the real `CoverPickerSheet`). Wiring a working picker INTO the pre-submit wizard requires a product decision: either (a) keep cover post-submit (current design — I only fixed the misleading "coming soon" copy), or (b) build a deferred/temp-upload flow so cover can be chosen before the brand row exists. I did NOT invent flow (b) per the dispatch guard. Decision needed.

## Gates

- `tsc --noEmit` on `mingla-business`: 0 errors (whole package).
- Jest: `src/services/__tests__` + `src/components/venue/__tests__` → 6 suites / 42 tests pass (incl. 8 new).
- Fails-on-revert: B5 own-brand test + B6 real-message test both FAIL against reverted code; restored → pass.
- Deno gate (edge fn): NOT RUN — Deno unavailable in this Claude session. Operator/Codex should run `deno check supabase/functions/run-business-place-authoring-pipeline/index.ts`. Function already deployed (v4) and reachable; change uses standard supabase-js patterns already present in the file's deployed siblings.

## Edge fn redeploy

Yes — `run-business-place-authoring-pipeline` deployed to v4 (diagnosed first; change is additive/safe: idempotency + back-link + logging + the full 6-action source). Verify-first-call: `POST .../run-business-place-authoring-pipeline` → 401 + `{kind:"error",...}` (non-404).

## DB forensics (B6)

- `brands` for account `b17e3e15…`: 1 row "Sub-E Smoke Test" slug `subesmoketest`, `place_pool_id=null`, `claim_status=pending` → RPC step 1 SUCCEEDED.
- `place_pool` where `fetched_via='business_authored'` = 0; `brand_place_pipeline_state` = 0 → edge fn step 2 failed/returned non-2xx, swallowed by opaque client throw.
- Reproduced the exact create-new insert + pipeline_state insert as service role in a rolled-back txn: BOTH succeed. `auto_update_city_seeded_status` trigger is null-safe. So the DB path is sound; the fix is client error-surfacing + edge idempotency/logging so the next attempt completes and any future failure is legible.
