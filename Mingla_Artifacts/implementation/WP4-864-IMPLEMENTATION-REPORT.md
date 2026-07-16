# WP4 — ISSUE-864 Campaign Builder UI — Implementation Report

**Issue:** #864 (child of #852 Full Rooms Ad Engine) · **WP:** 4
**Worktree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui` on branch `issue-864-campaign-builder-ui` (rebased onto `origin/main` at `7aa1b971c` — the superseded branch copy of SPEC_ISSUE-862 was dropped in favour of main's merged version during rebase)
**Contract:** `Mingla_Artifacts/specs/SPEC_ISSUE-864_CAMPAIGN_BUILDER_UI.md` body + **Amendment A4 (binding)**; blueprint §1, §1.6, §1.7, §1.8, §1.9b; the DEPLOYED `admin-ad-*` edge-fn sources as API truth.
**Status:** implemented and verified (build + 49-test suite + fails-on-revert + strict-grep gates). Live-fire against real platforms is the tester's step.

---

## 1. Summary (plain English)

The admin now has a real Campaign Builder at `#/campaign-builder`: a 10-step wizard
(lane → channel health → goal → destination → audience → budget → creative → copy →
policy check → review) that ends in "Create campaign (paused)". The operator never picks
a channel — the engine computes which channels can run the ad (preflight ∩ goal ∩ market ∩
budget) and says exactly why the others can't. Launch was moved to a new `#/campaigns`
surface with a spend-honest confirm modal, dual status badges, per-ad review verdicts
rendered as cause→fix cards, and sync. The WP1 `#/ad-engine` surface is untouched.

## 2. SPEC/A4 coverage table

| Rule | Where enforced | Commit | Status |
|---|---|---|---|
| A4.0(1) channel picker = OUTPUT of preflight ∩ goal ∩ market ∩ budget; manual override in Advanced (narrow-only) | `lib/adBuilder/channelPlan.js` `planChannels()`; Budget step Advanced allowlist | `ea52e8cb3`/`23b569719` | ✓ tested |
| A4.0(2) everything created PAUSED; Launch on the campaign surface, never in the builder | payload has no status field; no builder file references the action service (source-asserted); Launch only on `CampaignsPage` | `23b569719` | ✓ tested (SC-10 suite) |
| A4.0(3) destination = canonical URL, live public pages only (scheduled\|live + future) | `services/adDestinationsService.js` filters + canonical `https://usemingla.com/...` shown in Step Destination | `cfaca8703` | ✓ |
| A4.0(4) per-channel floors; Meta per-category from connection extra ($5/day link-clicks) | `budgetRules.metaFloorCents` (mirrors server `metaBudgetCategoryForGoal`), `channelFloorCents` (TikTok 2000¢, Snap 500¢, Google/Reddit no invented floor) | `ea52e8cb3` | ✓ tested |
| A4.0(5) honest goals: LINK_CLICKS not LPV; Reservations/Retargeting HIDDEN entirely | `goals.js` (visible:false entries, config-driven array); Meta goal derived LINK_CLICKS/REACH | `ea52e8cb3` | ✓ tested |
| A4.a preflight step: P1–P6 cards, per-channel Recheck, Recheck-all, continue-anyway-past-amber-never-hard | `StepPreflight.jsx` + `CampaignBuilderPage` gating (amber eligible + annotated; red excluded) | `23b569719` | ✓ tested (plan) |
| A4.b Meta warn-not-reject at 125 (hard 1024/255) | `copyRules.validateCopyForChannel("meta")` | `ea52e8cb3` | ✓ tested |
| A4.b TikTok 100-hard + emoji strip-with-Spark-explanation | `copyRules` (`stripEmoji`, `TIKTOK_EMOJI_EXPLANATION`) | `ea52e8cb3` | ✓ tested + fails-on-revert anchor |
| A4.b Google 3–15 headlines ≤30 / 2–4 descriptions ≤90 / keywords REQUIRED / **NO call_to_action_type** | `copyRules` + `payload.buildCreatePayload("google")` (field never constructed; JSON-scan tested) | `ea52e8cb3` | ✓ tested |
| A4.b Snap 34/32; Reddit 300-block/100-warn/80-warn + ALL-CAPS block; CJK ×2 weighting | `copyRules` (`weightedLength`, `isAllCaps`) | `ea52e8cb3` | ✓ tested |
| A4.b live truncation preview strip | `copyRules.truncationPreview` → StepCopy strip (FB Feed/IG/Reels/TikTok w/ strip count/Snap/Google n-of-15/Reddit) | `23b569719` | ✓ tested |
| A4.c per-channel dropzone caps (Snap 5 MB, Google 5,120 KB, Meta 30 MB storage bound) | `mediaUpload.CHANNEL_BYTE_CAPS` + `ImageUploader` hint (Meta-shaped hint gone) | `cfaca8703`/`23b569719` | ✓ |
| A4.c creative validated by the #866 server byte-probe; tiers rendered | StepCreative → `admin-ad-creative-upload` `action:'validate'` inline, then `'record'`; panel renders pass/warn/reject/needs_transcode/not_evaluable + confidence | `23b569719` | ✓ source-asserted |
| A4.d 4-pattern personal-attributes linter (warn-only) + inline rejected→compliant examples | `policyLinter.lintPersonalAttributes` + `PERSONAL_ATTRIBUTES_EXAMPLES` in StepPolicy | `ea52e8cb3` | ✓ tested |
| A4.d Reddit DATING lexicon ("plan the night, never meet someone") | `lintRedditDating`, scoped to reddit-in-channel-set | `ea52e8cb3` | ✓ tested |
| A4.d alcohol-adjacency warning (room-and-music copy) | `lintAlcohol` | `ea52e8cb3` | ✓ tested |
| A4.d special_ad_categories collected+validated, CREDIT rejected w/ migration message, cascade preview | `policyLinter` + StepPolicy selector + `SPECIAL_CATEGORY_CASCADE`; payload sends validated list + `special_ad_category_country` | `ea52e8cb3` | ✓ tested |
| A4.e learning-limited formula (daily×7÷CPA<50 → "directional only") | `budgetRules.learningLimitedWarning` → Budget split + launch summary warnings | `ea52e8cb3` | ✓ tested |
| A4.e Meta 175% weekly pacing + Google 2×/30.4 disclosures; §1.8 confirm-modal copy | `PACING_DISCLOSURES` + `launchConfirmCopy` (used by the Launch modal) | `ea52e8cb3` | ✓ tested |
| A4.e §1.8 launch-confirmation summary (per-channel rows, blocked-with-reason inline, dest/creative/copy lines, ambers) | `launchSummary.buildLaunchSummary` → StepReview | `ea52e8cb3` | ✓ tested |
| A4.f Reddit no-age passthrough note (verbatim); Advantage+ age-cap reject-with-explanation; gender enum mapping | `audienceRules` (+ StepAudience); Advantage+ rule unit-tested, control not rendered (endpoint carries no flag — honest) | `ea52e8cb3` | ✓ tested |
| A4.f city+radius | **flag-gated OFF** (`TARGETING_SEARCH_PROXY_ENABLED=false`) — `admin-ad-targeting-search` does not exist; labeled "coming" block | `ea52e8cb3` | ✓ (gap flagged) |
| A4.g frequency-cap gated to REACH/THRUPLAY, absent otherwise | `budgetRules.frequencyCapAllowed` + `FREQUENCY_CAP_CONTROL_ENABLED=false` (endpoint has no field — control absent, logic tested) | `ea52e8cb3` | ✓ tested |
| A4.g ad previews | no preview endpoint exists → `API_AD_PREVIEWS_ENABLED=false`; client-side 9:16 safe-zone overlay (14%/35%) drawn in StepPolicy | `23b569719` | ✓ (gap flagged) |
| §1.9b review_detail cause→fix map (Meta personal-attrs, Reddit DATING/CAPITALIZATION/EXCEEDING_CHARACTERS/BRIDGE_PAGE/ALCOHOL*, Google DestinationMismatch/unavailable-offers, TikTok verbatim+quality line, Snap verbatim, billing-not-a-rejection) | `reviewDetailMap.mapReviewDetail` → CampaignsPage detail (verbatim raw JSON always available) | `ea52e8cb3`/`23b569719` | ✓ tested |
| Campaign-action 200+warning states rendered | CampaignsPage `data.warning` → row warning + toast (never swallowed) | `23b569719` | ✓ source-asserted |
| validate-only with validated_layers/skipped_layers | StepReview "Validate shapes (nothing created)" renders both lists per channel | `23b569719` | ✓ |
| SC-1/SC-9 route + admin gate + keyboard/a11y | hash route behind existing AuthContext; stepper `aria-current`, card radio/checkbox groups, keyboard-operable uploader (hidden file input + labeled button), selection = ring+check | `23b569719` | ✓ (axe/manual run = tester) |
| SC-8 error surfacing + deep-link back | per-channel error AlertCards w/ code + fbtrace; `destination_not_public` → jump to Destination; `budget_below_minimum` → jump to Budget; form state preserved | `23b569719` | ✓ |

## 3. Files changed (WP4 commits `307c2d742..5e2de49b0`)

- `supabase/migrations/20270101000864_issue_864_meta_ad_creatives_bucket.sql` (+104, new)
- `mingla-admin/src/lib/adBuilder/` — `flags.js` 42 · `goals.js` 107 · `channelPlan.js` 225 · `budgetRules.js` 148 · `copyRules.js` 294 · `policyLinter.js` 217 · `audienceRules.js` 66 · `payload.js` 127 · `launchSummary.js` 87 · `reviewDetailMap.js` 220 (all new)
- `mingla-admin/src/services/` — `mediaUpload.js` 69 (new) · `adDestinationsService.js` 96 (new) · `adEngineService.js` +36 (additive)
- `mingla-admin/src/components/ui/` — `CurrencyInput.jsx` 62 · `MultiSelect.jsx` 54 · `ImageUploader.jsx` 105 (new primitives, additive)
- `mingla-admin/src/components/campaign-builder/` — `Stepper` 60 · `AdPreview` 60 · `StepLane` 74 · `StepPreflight` 91 · `StepGoal` 102 · `StepDestination` 162 · `StepAudience` 108 · `StepBudget` 173 · `StepCreative` 231 · `StepCopy` 284 · `StepPolicy` 145 · `StepReview` 167 (all new)
- `mingla-admin/src/pages/CampaignBuilderPage.jsx` 517 (new) · `mingla-admin/src/pages/CampaignsPage.jsx` 340 (new)
- `mingla-admin/src/App.jsx` +8 · `mingla-admin/src/lib/constants.js` +5 (2 PAGES entries + 2 Growth nav items; both icons already in ICON_MAP — Sidebar untouched)
- `mingla-admin/src/__tests__/issue864_campaign_builder_happy.test.js` 555 (new)
- `.github/workflows/strict-grep-mingla-business.yml` +11 (one appended job — append-only)

Total ≈ +4,090 lines, zero deletions outside the rebase.

## 4. Data-model changes

One Storage bucket only (SPEC §4.5): `meta-ad-creatives`, `public=true`,
`file_size_limit=31457280`, `allowed_mime_types={image/jpeg,image/png}`; RLS on
`storage.objects`: SELECT public; INSERT/UPDATE/DELETE `bucket_id='meta-ad-creatives' AND
public.is_admin_user()`. Idempotent (ON CONFLICT upsert + drop-then-create policies,
column-existence guards per the ORCH-0786 pattern). **Read-only prod probes pasted:**
`SELECT … FROM storage.buckets WHERE id='meta-ad-creatives'` → `[]` (bucket absent —
migration genuinely needed; #866's row schema references it by name only);
`is_admin_user()` exists on prod (zero-arg). No tables/columns/indexes touched.

## 5. Edge functions touched

**None written or modified** (dispatch hard guard honored). Consumed as deployed:
`admin-ad-connect` (status) · `admin-ad-preflight` (all + per-platform recheck) ·
`admin-ad-create-campaign` (create + validate_only) · `admin-ad-campaign-action`
(launch/pause — campaign surface only) · `admin-ad-campaign-sync` · `admin-ad-creative-upload`
(validate/record). No `verify_jwt` values changed (nothing deployed from here).

## 6. Regression tests

- `mingla-admin/src/__tests__/issue864_campaign_builder_happy.test.js` — **49 tests, 49 pass** (`node --test`).
- **fails-on-revert verified at `5e2de49b0`** — TRUE LINE DELETION of the TikTok hard-cap
  reject in `copyRules.js` → suite 48/49 (the A4.b TikTok test fails); restored → 49/49.
- CI job `issue-864-campaign-builder-node-tests` appended to
  `strict-grep-mingla-business.yml` (YAML parse-verified). Append-only: no existing test
  file modified; existing gated suites re-run green (1271 foundation+adversarial + 1277:
  118/118; `npm --prefix mingla-admin test`: 19/19).

## 7. Old → New receipts

### supabase/migrations/20270101000864_…bucket.sql
**Before:** no `meta-ad-creatives` bucket anywhere (referenced by #866 by name only; probe-confirmed absent on prod — image upload from the admin had NO storage home).
**Now:** bucket + public-read + admin-write RLS. **Why:** SPEC §4.5; the creative step and #866's `storage_bucket` column need it. ~104 lines.

### mingla-admin/src/lib/adBuilder/* (10 modules)
**Before:** none — WP1's page had a raw Meta-shaped form; every A4 rule lived only in documents.
**Now:** every A4 rule is an importable, unit-tested pure module; React components render them. **Why:** the admin's node:test harness has no DOM — rules-as-modules is the only honest way to gate them in CI. ~1,533 lines.

### mingla-admin/src/services/{mediaUpload,adDestinationsService}.js + adEngineService.js
**Before:** no upload helper existed in mingla-admin; no destination reader; adEngineService had WP1's five wrappers.
**Now:** bucket upload with per-channel byte-cap honesty; live-public-only destination reader resolving canonical URLs; +3 additive service fns (getConnection/getCampaignDetail/creativeUpload). **Why:** SPEC §4.3. ~201 lines.

### mingla-admin/src/pages/CampaignBuilderPage.jsx + components/campaign-builder/**
**Before:** no builder; WP1's single-page form asked the admin for raw slugs, objectives and image URLs.
**Now:** the 10-step A4.0(1) wizard with the channel plan as an output, per-step gates with exact inline messages, live AdPreview rail, per-channel create loop with per-session request_id idempotency, per-channel success/error cards with deep-link-back. **Why:** the WP4 user story. ~2,174 lines.

### mingla-admin/src/pages/CampaignsPage.jsx
**Before:** launch/pause/sync lived only inside WP1's `#/ad-engine` list with no review detail rendering (a red badge was a dead end).
**Now:** dedicated campaign surface: dual badges, §1.8 confirm modal (175% pacing truth), 200+warning states surfaced, per-ad `review_detail` → §1.9b cause→fix cards + verbatim raw JSON, per-campaign and sweep sync. **Why:** dispatch scope; blueprint §1.9b "the badge must not be a dead end". ~340 lines. (WP1's page left untouched — no regression surface.)

### App.jsx / constants.js
**Before:** Growth group had one entry (`ad-engine`).
**Now:** + `campaign-builder` (Rocket) + `campaigns` (ClipboardList) routes/nav; icons already registered — Sidebar untouched. ~13 lines.

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Consumer iOS / Android | No | admin-only feature |
| Buyer/anon Web | Reference only | its public pages are read as destinations (read-only view queries) |
| Business iOS / Android | No | untouched |
| **Admin Web** | **YES — only surface** | everything above; single surface, no parity split |
| Business Web preview | No | untouched |
| Backend | Minimal | one storage bucket migration; zero edge-fn changes |

## 9. Smoke / gate results (real output)

- `npm run build` (Vite): **green** — `✓ 3009 modules transformed … built in 3.53s` (chunk-size warning pre-existing).
- `node --test …issue864_campaign_builder_happy.test.js`: `# tests 49 / # pass 49 / # fail 0`.
- Fails-on-revert: deletion run `# pass 48 / # fail 1`; restore run `# pass 49 / # fail 0`.
- Strict-grep: `issue-862-ad-token-env-server-only` PASS (16 token names, 7 client trees clean — RT-3 satisfied by the existing widened gate; no admin file references any platform token/Graph host) · `issue-866-creative-guards` PASS · `issue-862-reddit-configured-status-explicit` PASS · `i-admin-single-gate` / `i-admin-gate-first-statement` / `i-1272-identity-admin-read` PASS.
- Drift check: `supabase migration list --linked` → **zero remote-only rows**; new prefix `20270101000864` > max local/sibling `20261231000866` (monotonic verified across `~/Desktop/mingla-orchs/*/supabase/migrations`).
- ESLint: 4 findings in the two new pages, all `react-hooks/set-state-in-effect` on the standard load-on-mount pattern — identical to the shipped WP1 `AdEnginePage` (2 findings) and 79 pre-existing repo-wide; lint is not an admin CI gate. Zero other findings in ~4k new lines.
- Browser smoke: **not run** (no dev server driven from this session) — the wizard flow is state-machine + service calls; the tester drives the authed admin web live-fire.

## 10. Known issues / deferred (no [TRANSITIONAL] markers in code — all deferrals are flag-gated or documented)

1. Multi-goal create currently derives ONE Meta objective set from the primary selected goal (traffic wins when both picked); true per-goal campaign fan-out ("separate campaigns under one budget plan") is a small follow-up once #884's plan model exists. The disjoint-goals warning renders per blueprint.
2. Lifetime budgets: rendered disabled with the reason (server rejects `budget_type_unsupported_wp1`).
3. Dayparting/schedule fields: not rendered — the create endpoint has no schedule fields (blueprint flags dayparting as unbuilt on every channel).
4. `AdPreview` is a Facebook-feed approximation; platform previews are post-create API calls behind the missing preview endpoint.

## 11. Operator action required (orchestrator/Seth — at merge/deploy time)

- Migration (bucket): from the merged tree —
  `cd "/Users/sethogieva/Desktop/mingla-orchs/issue-864-campaign-builder-ui" && /Users/sethogieva/bin/supabase db push --linked`
  **Caveat:** the linked remote's migration history is behind local files (rows `20261225…20261231000866` show blank Remote from the anchor too) — a `db push` will attempt everything local-ahead, not just this bucket file. Known drift state (memory: blind `db push` UNSAFE) — the orchestrator owns sequencing; the bucket migration itself is idempotent and probe-verified safe (bucket absent, `is_admin_user()` present).
- No edge-fn deploys needed for WP4. No `[deploy]` tag used in any commit.

## 12. Flagged gaps (endpoints the spec'd UI needs that DO NOT exist — never invented)

| Gap | Impact | UI behavior today |
|---|---|---|
| **`admin-ad-create-campaign` has NO TikTok/Reddit branch** (adapters shipped in WP6/WP7 as libraries; the generic branch is Meta-shaped — Meta objective matrix, `extra.minimum_budgets` floor read, `resolveMetaClient` pixel gate — so tiktok/reddit payloads structurally 422/424) | The builder can actually create on **Meta + Google only** | `channelPlan.CREATE_WIRED=['meta','google']`; TikTok/Reddit render in preflight + excluded with the endpoint-gap reason inline |
| `admin-ad-targeting-search` (A4.f city+radius proxy) | No city targeting | flag `TARGETING_SEARCH_PROXY_ENABLED=false`; labeled "coming" block |
| `admin-ad-budget-plan-preview` (#884) | No server split preview | client-side `splitBudget` labeled "local estimate" |
| Ad-preview endpoint (Meta previews/TikTok preview/Reddit preview_url) | No platform-rendered previews | flag `API_AD_PREVIEWS_ENABLED=false`; client safe-zone overlay (14%/35%) |
| `frequency_control_specs` not accepted by create | Control would be a lie | flag `FREQUENCY_CAP_CONTROL_ENABLED=false`; `frequencyCapAllowed()` gate tested for the day it ships |
| Snapchat lane (WP5 #867 adapter stub) | No Snap create | preflight stub row + exclusion reason |

## 13. Discoveries for Orchestrator

1. **The `meta-ad-creatives` bucket never existed on prod** (probe: `storage.buckets` → `[]`) even though #866's shipped schema names it as the image storage home — any pre-WP4 attempt to store library images in-bucket would have failed. Fixed by this WP's migration; worth a note on the #866 close record.
2. **TikTok/Reddit create-branch gap** (above) is the single blocker between "4 live adapters" and "4 creatable channels" — suggest registering a follow-up ORCH to add their branches to `admin-ad-create-campaign` (the adapters + floors + validation helpers already exist in `_shared/`).
3. The linked remote's migration history shows ~7 local-ahead versions from the anchor itself (including migrations COMMS-0094/0095 recorded as applied) — history vs. files drift worth reconciling before the next `db push`.
4. Admin ESLint has 79 pre-existing errors repo-wide (incl. WP1's page); a cleanup ORCH would let lint become a CI gate.

## Route back

→ orchestrator for REVIEW, then `mingla-tester` (adversarial suite + authed admin-web live-fire: drive the wizard against a real live event page, upload a real image, create paused on Meta + Google, launch/pause from `#/campaigns`, verify review_detail rendering after sync).
