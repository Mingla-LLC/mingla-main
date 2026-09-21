# Tutorial local build integration notes (2026-09-16)

LOCAL ONLY. Not committed to any branch. Branch `tutorial/local-build-2026-09-16`.

Base: origin/main `4e89361879b83ff10810c5bc0a30e8433b46c38e`.
Merged with `git -c core.commentChar=";" merge --no-ff`, in this order, all pinned to the PR head SHA:

| # | PR | branch | head | result |
|---|----|--------|------|--------|
| 1 | #3407 | fix-where-step-geo-rsvp-copy | 244493725 | clean |
| 2 | #3408 | rsvp-number-stepper-typeable | 2af28661f | clean |
| 3 | #3409 | rsvp-creator-host-bugs | c35d2760e | 1 conflict, resolved |
| 4 | #3418 | rsvp-step5-host-copy | 9278ead47 | 2 conflicts, resolved |
| 5 | #3416 | rsvp-guest-public-page-fixes | 4d920eb81 | clean |
| 6 | #3421 | fix-unlisted-rsvp-invite-link | ea374d6ec | 3 conflicts (CI only), resolved |
| 7 | #3413 | 3396-phone-fields-business | 8f6afdca4 | clean |
| 8 | #3405 | 3393-venue-rules-ordering | 13649ccef | clean |
| 9 | #3404 | 3393-venue-host-ux | 1c5778cd8 | clean |
| 10 | #3420 | 3386-venue-details-editor | 1e270eeb1 | 3 conflicts, resolved |

Skipped: none.

## Conflicts and resolutions

### #3409 into (#3407 + #3408)
- `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx`: import block only. #3407 added
  `useServerCoverAdoption` + `ServerDraftCover` imports; #3409 added `useScrollToTopOnStepChange`.
  Kept all three imports. Both hooks are used in the body (lines ~362 and ~565).

### #3418 into (... + #3409)
- `mingla-business/src/components/event/EventCreatorWizard.tsx` and
  `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx`, same hunk in both: step `baseProps`.
  #3407 changed `onCoverVideoProcessingChange: setCoverVideoProcessing` to the tracking wrapper
  `handleCoverProcessingChange` (which still calls `setCoverVideoProcessing`). #3418 kept the old
  setter and added a new `coverVideoProcessing` prop (processing video shown on the Cover card).
  Resolution: `onCoverVideoProcessingChange: handleCoverProcessingChange,` plus `coverVideoProcessing,`.
  baseProps is built in a plain render function (not memoised), so no dependency array to update.

### #3421 into (... + #3416)
PR is CONFLICTING against main on GitHub too; all three conflicts are CI files, none ship in the app.
- `.github/workflows/issue-1931-private-event-access.yml`: both sides appended a migration skip to the
  same `case`: main's `20270707003426_issue_3426_brand_offering_sections.sql` and #3421's
  `20270707000000_unlisted_rsvp_invite_link.sql`. Kept both.
- `.github/workflows/issue-2117-offering-visibility-gate-tests.yml`: same shape, kept both skips.
- `.github/ci-batch/MANIFEST.json`: `workflowMetadata.sourceSha256` for those two workflows. Neither
  side's hash is right for the merged file, so both were recomputed as sha256 of the resolved file:
  1931 = `4fd5dccd…a3e`, 2117 = `14467abf…667` (checked the scheme first: HEAD's hash equals sha256 of
  HEAD's file).

### #3420 into (... + #3404)
#3420 is stacked on #3404's commit `ee5e5821b`. #3404 was later rebased to `b2c3b2d61`
(`git range-diff` reports the two identical) plus two test-only commits. Git saw two histories.
- `mingla-business/src/components/venue/VenueSettingsModule.tsx` and
  `mingla-business/src/components/venue/__tests__/venueSettingsHostUx.issue3393.test.tsx` (add/add):
  verified `git diff ee5e5821b HEAD -- <both files>` is EMPTY, meaning the merged-in #3404 copies are
  byte-identical to #3420's stacked base. #3420's version is therefore #3404 plus the #3420 change.
  Took #3420's version (`checkout --theirs`). Nothing from #3404 is lost: the "Request a change" email
  moved into `VenueDetailsEditor.tsx`, which still imports `venueDetailsChangeRequest` and renders the
  button and the failure copy.
- `.github/workflows/supabase-migrations-and-stripe-deno.yml`: two new psql test steps at the same
  point (#3421 `unlisted_rsvp_invite_link.test.sql`, #3420 `issue_3386_venue_details_host_edit.test.sql`).
  Kept both. The MANIFEST carries no provider hash for this workflow.

Post-merge: every PR head is an ancestor of HEAD; 0 conflict markers added in `git diff base..HEAD`;
no package.json / lockfile / app.json / app.config / eas.json / plugins / patches changes.

## Build (LOCAL ONLY)

- Build sha: `10194559585663310a720e6e3905e14709021798` (branch `tutorial/local-build-2026-09-16`, not pushed).
- `npm ci` in `mingla-business/` (real install, patch-package applied expo-image-picker). No symlinked node_modules.
- `mingla-business/.env` copied from the anchor (gitignored): live Stripe publishable key + GIPHY key, same values the
  store app carries. No AppsFlyer / OneSignal / Sentry DSN env, so those SDKs no-op in this build (no attribution,
  push or Sentry events from it).
- `CI=1 npx expo prebuild -p ios --no-install` (no ios/ existed). Name -> `ios/MinglaHost`.
- updates OFF: `plutil -replace EXUpdatesEnabled -bool NO` and `EXUpdatesCheckOnLaunch NEVER` on
  `ios/MinglaHost/Supporting/Expo.plist` (ios/ is gitignored, nothing committed).
- `ios/.xcode.env.local` (gitignored) sources `.env`, sets `SENTRY_DISABLE_AUTO_UPLOAD=true`, unsets `EAS_BUILD_PROFILE`/`VERCEL_ENV`.
- `pod install`, then:
  `xcodebuild -workspace MinglaHost.xcworkspace -scheme MinglaHost -configuration Release -sdk iphonesimulator -destination "platform=iOS Simulator,id=85C5CD29-63F2-4EE0-8EC8-81C3F580C2AA" -jobs 4 ONLY_ACTIVE_ARCH=YES COMPILER_INDEX_STORE_ENABLE=NO build`
  First attempt was interrupted during the machine-wide load spike (load ~900); the incremental retry succeeded in 16 min.
- App: `~/Library/Developer/Xcode/DerivedData/MinglaHost-bksctltvalybblbcuugrssjjhclh/Build/Products/Release-iphonesimulator/MinglaHost.app`
  copy: `.local-build/MinglaHost.app` (APFS clone). Hermes bytecode main.jsbundle, 21 embedded frameworks, adhoc signature verifies.
  Contains "Guests see times in this time zone" (1 hit), not "We'll show this to guests in their local time" (0 hits).

## Install + verification on DEMO-Host-iPhone17Pro

- The sim (and every other sim) was found SHUT DOWN after the load spike; booted it with `simctl boot` (no erase, no uninstall).
- `xcrun simctl install 85C5CD29-... .local-build/MinglaHost.app` exit 0. Data container was renamed by CoreSimulator
  (96A23D97 -> C1DDCF31) with contents intact: `sb-gqnoajqerqhnvulmnyvv-auth-token` present, both old OTA bundles present.
- Launch: Home, signed in (Harmattan Club). `.local-build/01-launch.png`.
- Embedded-bundle proof: expo-updates log gained exactly one entry at launch:
  "The expo-updates system is explicitly disabled..." (InitializationError); no new OTA bundle downloaded, expo-v11.db untouched.
- RSVP wizard Step 2 copy: `.local-build/02-rsvp-step2-timezone-copy.png`.
- Step 5 guest limit default 50 + typeable field: `.local-build/03-rsvp-step5-guest-limit-default-50.png`,
  `.local-build/04-rsvp-step5-guest-limit-field-focused.png`.
- Autosaved draft (kept, not published, not deleted): `c15fe573-3d54-494d-8298-147ee8c8c144` "local build check",
  brand e79fdb72-c6d6-4a4e-b3b3-4c75580a2b0a (Harmattan Club), format online, date 2026-10-16, rsvpCapacity 50.

## Rebuild / reinstall quickly

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/tutorial-local-build/mingla-business/ios
set -a; . ../.env; set +a; export SENTRY_DISABLE_AUTO_UPLOAD=true; unset EAS_BUILD_PROFILE VERCEL_ENV
plutil -p MinglaHost/Supporting/Expo.plist | grep EXUpdatesEnabled   # must be false (re-apply after any prebuild)
xcodebuild -workspace MinglaHost.xcworkspace -scheme MinglaHost -configuration Release -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=85C5CD29-63F2-4EE0-8EC8-81C3F580C2AA" -jobs 4 ONLY_ACTIVE_ARCH=YES COMPILER_INDEX_STORE_ENABLE=NO build
APP=~/Library/Developer/Xcode/DerivedData/MinglaHost-bksctltvalybblbcuugrssjjhclh/Build/Products/Release-iphonesimulator/MinglaHost.app
plutil -p "$APP/Expo.plist" | grep EXUpdatesEnabled
xcrun simctl install 85C5CD29-63F2-4EE0-8EC8-81C3F580C2AA "$APP"     # never uninstall
xcrun simctl launch 85C5CD29-63F2-4EE0-8EC8-81C3F580C2AA com.sethogieva.minglabusiness
```
JS-only changes still need the xcodebuild (Release embeds the bundle; there is no Metro). Pulling new PR commits:
`git fetch origin <branch> && git -c core.commentChar=";" merge --no-ff origin/<branch>` in the worktree, then rebuild.
Do NOT re-run `expo prebuild` unless native config changes; if you do, re-apply the Expo.plist override before building.

## tsc (mingla-business, `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`)

- origin/main 4e8936187 (git archive of mingla-business, packages, supabase/functions, scripts, app-mobile/app + APFS-cloned node_modules): **688**
- integration 101945595: **679** -> delta **-9**, **0 new** (compared as file+code+message multisets, paths normalised).
- The 9 removed are all in `packages/offering-rendering/RsvpOfferingBody.tsx` (#3416).
- All conflict-resolved files are in the tsc program (`--listFilesOnly`).

## jest (default config, `--maxWorkers=2`)

- Phone (13 suites incl. #3413's 5 new ones): 13/13 suites, 166/166 tests PASS.
- RSVP / event creator (50 suites): 47 pass, 720/722 tests. 3 red suites, all CROSS-PR INTERACTIONS (each PR green alone):
  1. `event/__tests__/CreatorStep4Cover.videoProcessingCard.test.tsx` (#3418) source-pins
     `onCoverVideoProcessingChange: setCoverVideoProcessing,\s*coverVideoProcessing,` in RsvpCreatorWizard; #3407 replaced the
     setter with `handleCoverProcessingChange`. Runtime is right (the handler still sets the state and the new prop is passed);
     the pin needs updating to accept the handler when these land together.
  2. `event/__tests__/issue3439CoverTiming.tester.adversarial.test.tsx` (#3407) suite fails to run:
     "Unclassified wizard boundary: ../../hooks/useScrollToTopOnStepChange" (the hook #3409 added; the harness allowlist doesn't know it).
  3. `rsvp/__tests__/issue3402TypedCountHosts.tester.adversarial.test.tsx` (#3408) suite fails to run:
     "Unclassified host boundary: ../../hooks/useServerCoverAdoption" (the hook #3407 added).
- Venue (97 suites, conflict area): 94 pass + 2 skipped (orch1285 deck readiness, skipped by design), 916/919 tests.
  1 red: `venue/__tests__/venueModuleResolution.issue3393.tester.test.tsx` "a failed initial settings request is not a
  confirmed OFF..." - ALSO RED on #3404 alone (1c5778cd8, 1 failed / 18 passed): a tester test that deliberately exposes
  an open gap (commit "test: expose venue module error recovery gap (#3389)"). Not caused by the integration.
