# QA_META-ORCH-0972_SUB_B_REPORT

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]  
**Sub-scope:** Sub-B targeted verification with Phase 0.A live-fire retest  
**Tester:** Codex `tester-mingla` parity mirror  
**Date:** 2026-05-25  
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`  
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`  
**Baseline under retest:** `c9741eb52`  
**Adversarial test commit:** `411925909` preserved (`git merge-base --is-ancestor 411925909 HEAD` PASS)  

## Verdict

**FAIL — do not dispatch Sub-C yet.**

The missing live-fire matrix was retested. iOS and authenticated web preview now have usable evidence for the universal chooser path, and the required automated gates remain green. Android still fails the release gate: the stable Pixel 8 Pro emulator/dev-client repeatedly froze at the Expo bundling screen or ANR dialog and never rendered the authenticated Home/Hub path from the current worktree bundle.

This is now an isolated Android runtime failure, not a source-only ambiguity. Per the routing rule, send this to `implementor-mingla` with the Android finding isolated; do not route to Sub-C.

## Comms Ledger

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry before other work. Relevant open WARN entries addressed to ALL were already acknowledged for this Sub-B line and were factored into the retest:

- COMMS-0002 — backend strict-grep warning; no backend files touched.
- COMMS-0003 — external API docs gate; N/A, no external API integration changed.
- COMMS-0004 — intake collision SOP; N/A for tester phase.

## Inputs Read

- `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_B.md`
- `Mingla_Artifacts/reports/REVIEW_META-ORCH-0972_SUB_B.md`
- `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md`
- `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` §Sub-spec B
- Prior `Mingla_Artifacts/reports/QA_META-ORCH-0972_SUB_B_REPORT.md` at `c9741eb52`

## Automated Verification

| Gate | Command | Result |
|---|---|---|
| Mandatory Sub-B Jest + tester adversarial test | `npx jest --runInBand __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx` from `mingla-business/` | PASS — 2 suites, 8 tests |
| Venue claim banner/service regression | `npx jest --runInBand src/services/__tests__/venueClaimService.test.ts` from `mingla-business/` | PASS — 1 suite, 4 tests |
| Admin production build | `npm run build` from `mingla-admin/` | PASS — Vite build completed with existing chunk-size/dynamic CSS warnings |
| Adversarial commit preserved | `git merge-base --is-ancestor 411925909 HEAD` | PASS |
| Hard forbidden-path guard | `git diff --name-only fee178634..HEAD \| rg '(^supabase/|^\\.github/scripts/strict-grep/meta-orch-0972-|PublicBrandPage|publicEventsService|ExperienceMiniCard|useUpcomingFeed|EventMiniCard|TripMiniCard)'` | PASS — empty output |
| DB / edge / strict-grep touch guard | `git diff --name-only fee178634..HEAD -- supabase .github/scripts/strict-grep` | PASS — empty output |
| Brand.kind reintroduction guard | `git diff --unified=0 fee178634..HEAD -- mingla-business mingla-admin \| rg '^\\+.*(Brand\\.kind|brand\\.kind|currentBrand\\.kind)'` | PASS — empty output |

## Phase 0.A Live-Fire Retest Evidence

New retest evidence files:

- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/ios-retest-authenticated-home.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/ios-retest-start.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/web-retest-authenticated-home.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/web-retest-hub-getstarted.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-start.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-after-wait.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-after-long-wait.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-authenticated-home.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-10-0-2-2.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-retest-logcat-excerpt.txt`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/admin-retest-claims-pending.png`

Prior evidence retained from `411925909` / `c9741eb52`:

- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/ios-offering-chooser.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/ios-event-create.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-home-recovered.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/android-default-expo-blocker.png`
- `Mingla_Artifacts/reports/evidence/meta-orch-0972-sub-b/web-preview-auth-screen.png`

| Surface | Required coverage | Result | Evidence |
|---|---|---|---|
| iOS simulator | Authenticated empty-brand Home/Hub chooser; brand creation skip-address + skip-cover; Event/Trip/Experience creator routing; hub populated tabs | PARTIAL PASS | Current worktree bundle loaded on authenticated iPhone 17 Pro Max simulator and rendered the empty-brand Home chooser with Event / Trip / Experience cards. Prior retained iOS evidence shows OfferingChooser and Event creator routing. Trip/Experience route refresh was not completed after Android reproduced the blocker. |
| Android emulator/dev-client | Same business-app checklist on stable Android emulator/dev-client | FAIL | Pixel 8 Pro AVD launched `com.sethogieva.minglabusiness` from the current Metro URL. The app produced System UI / Business ANR dialogs and remained stuck at `Bundling 89.0%...` even after Metro reported `Android Bundled 47774ms index.js (3201 modules)`. Retried with both LAN host URL and `10.0.2.2`; neither produced a usable authenticated Home/Hub screen. |
| Authenticated web preview | Authenticated business preview Home/Hub chooser where applicable | PASS | Headless Chromium injected the existing Supabase web auth session and loaded `http://localhost:8097` plus `/hub/getstarted`. Body text included the authenticated brand name, `What do you want to make first?`, and Event / Trip / Experience chooser cards on both Home and Hub Get Started. |
| Admin web | Venue Claims Pending/Verified/Rejected tabs | BLOCKED BY AUTH | Admin Vite served on `http://127.0.0.1:5177/#/claims`, but no authenticated admin browser/session state was available. Injecting the business Supabase session correctly landed on the admin login screen, so the Venue Claims tabs could not be live-fired. Source and build still verify the Pending review / Verified / Rejected tabs and the removal of `.eq("kind", "physical")` from claims queries. |

## Android Failure Detail

### P1 — Android dev-client runtime freeze/ANR blocks Phase 0.A

Reproduction:

1. Start Metro from the Sub-B worktree with `npx expo start --clear --dev-client --port 8097`.
2. Boot Pixel 8 Pro AVD and launch `com.sethogieva.minglabusiness` with the Expo dev-client URL.
3. Observe System UI / Business ANR and persistent `Bundling 89.0%...`; retry with `10.0.2.2:8097`.

Observed log excerpt:

- `Running "main" with {"rootTag":1,"initialProps":{},"fabric":true}`
- `[ReferenceError: Property 'document' doesn't exist]`
- `[auth] auth-event { event: 'INITIAL_SESSION', hasSession: true, hasUser: true }`
- `Cycle17d §C] Evicted 0 entries from 0 ended events.`

Interpretation: Android reaches React bootstrap/auth code, but the dev-client runtime never becomes usable. This reproduces the Android blocker and prevents full Phase 0.A PASS.

## Non-Blocker Notes

- Web preview is no longer merely signed-out/unverified; authenticated Home and Hub Get Started passed.
- Admin Claims remains a credentials/session availability blocker, not a proven Venue Claims page crash.
- The previous P2 icon note remains non-blocking: the spec says Calendar / Map / Sparkles while `OfferingChooser.tsx` uses calendar / compass / sparkle.
- No DB, migrations, edge functions, forbidden public-page files, or META-ORCH-0972 strict-grep scripts changed in this retest.

## Downstream Routing

Do not dispatch Sub-C. Route to `implementor-mingla` with this isolated Android runtime finding and preserve the Sub-B hard guards: no DB/migrations/edge, no forbidden public-page files, no META-ORCH-0972 strict-grep script touch, no Brand.kind reintroduction, and no Sub-A rewrites.
