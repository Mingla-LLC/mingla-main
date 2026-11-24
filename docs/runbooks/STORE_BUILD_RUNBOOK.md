# Store build runbook (App Store and Google Play)

Use this when you cut production builds of Mingla (Explorer, `app-mobile`) or Mingla Host (`mingla-business`). A store build needs Seth's approval of that release by name (AGENTS.md § Standing holds).

## Always build from the latest main

EAS uploads whatever is in the checkout you run it from. Both apps' `build-production-*` scripts run `scripts/release/store-build-guard.cjs` first. The guard fetches `origin/main` and refuses to build unless HEAD is exactly that commit and the whole repo is clean. Never call `npx eas build --profile production` directly: that skips the guard.

```bash
git -C ~/Desktop/mingla-main fetch origin main
git -C ~/Desktop/mingla-main worktree add --detach ~/Desktop/mingla-orchs/release-<version> origin/main
cd ~/Desktop/mingla-orchs/release-<version>/mingla-business && npm ci && npm run build-production-ios
```

Do the same for `build-production-android`, and in `app-mobile`. Both apps ship the same version.

- **iPhone signing:** run the iOS build authenticated, with the App Store Connect API key variables `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `EXPO_APPLE_TEAM_ID` and `EXPO_APPLE_TEAM_TYPE`. Without it EAS cannot regenerate a profile when entitlements change. Key locations are in MINGLA_MASTER_KEYS.md.
- **Same build for everyone:** after main moves, cut all four builds again from the new commit. Never mix commits within one release.

## Check the binary before you submit

Each check fails silently if you skip it:

- **Local modules (#4389):** `.easignore` patterns for native folders must be anchored (`/ios/`, `/*/ios/`). A bare `ios/` also drops `modules/*/ios`, and the local Expo module disappears from the binary. 1.3.0 shipped without `MinglaTapToPayEducation`, so Tap to Pay was hidden on every iPhone. `issue_4271_apple_requirements.implementor.test.ts` pins this.
- **Before submitting the Host iPhone build:** unzip the `.ipa`, then:
  - check that `Info.plist` has `MinglaTapToPayEntitled = true`;
  - check that the executable contains the `MinglaTapToPayEducation` string (`strings -a`);
  - check that `embedded.mobileprovision` lists `com.apple.developer.proximity-reader.payment.acceptance`.
