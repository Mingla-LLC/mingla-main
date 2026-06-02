# Mingla — App Store & Play Store Launch Playbook

**Canonical, reusable runbook for shipping a production build of the Mingla consumer app to the Apple App Store and Google Play Store.**

Born from ORCH-0977 (2026-05). Follow it top-to-bottom for any new build or launch. Sections marked **[per-launch]** change each release; everything else is stable infrastructure.

> How to use: Part A is the ordered "do this" runbook. Part B is the canonical reference data (IDs, credentials, field values). Part C is the answer-sheet index. Part D is the gotchas that cost time — read it before every build.

---

# PART A — THE LAUNCH RUNBØOK (ordered)

## Phase 0 — Where the code lives (READ FIRST — this bit us)

- The consumer app is `app-mobile/` inside the monorepo.
- ORCH work happens in a **per-ORCH git worktree** (`~/Desktop/mingla-orchs/<ORCH>/`), but **EAS builds from whatever git root you run `eas build` in**, and it builds the **committed branch state**.
- **THE LESSON:** the launch binary must be built from **`main`** AFTER the ORCH branch is merged. Building from `main` while the work sits on an unmerged ORCH branch produces a STALE binary (wrong version, missing features). The tell: `runtimeVersion` in the build log resolves to the OLD version.
- **Rule: merge the ORCH branch → `main` FIRST, then build from `main`.** Never submit a binary built off an unmerged branch.

## Phase 1 — Code & config readiness (shared, both platforms)

1. **Bump version** in `app-mobile/app.json` → `expo.version` (e.g. `1.0.0` → `1.1.0`). `runtimeVersion` policy is `appVersion`, so this drives OTA channels too.
2. **EAS env vars** present in the `production` environment (EAS dashboard): `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`, `EXPO_PUBLIC_MIXPANEL_TOKEN`, `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`. (Build log prints which loaded.)
3. **No dead env vars / dead integrations** in code.
4. **Permissions hygiene:** only request what you use. Location is **foreground-only** (no `requestBackgroundPermissionsAsync`, no `NSLocationAlwaysAndWhenInUseUsageDescription`, no `ACCESS_BACKGROUND_LOCATION`). Strip `SYSTEM_ALERT_WINDOW` (Android) via the `withoutSystemAlertWindow` plugin.
5. **ATT (iOS):** `NSUserTrackingUsageDescription` set via the `expo-tracking-transparency` plugin `userTrackingPermission` string; ATT prompt fires post-auth (AppsFlyer `manualStart: true` → `startAppsFlyer()` after the prompt resolves).
6. **Sentry** `sendDefaultPii` decision recorded (Mingla = `true`). This forces declaring IP + User ID + Diagnostics in both stores' privacy forms.
7. **UGC content moderation** wired (Apple Guideline 1.2 — see Phase 7).
8. **Reviewer access** (test-OTP bypass) live (see Phase 8).
9. `npm run typecheck` + relevant jest gates pass.

## Phase 2 — Android prep

- `eas.json` `submit.production.android`: `serviceAccountKeyPath` → `/Users/sethogieva/.mingla-secrets/playstore-mingla.json`, `track: internal` (flip to `production` after internal testing), `releaseStatus: draft`.
- Confirm the Play service account still has Android Publisher API access (see Part D for the verify command).
- Android signing + `versionCode` are managed by EAS (`appVersionSource: remote` + `autoIncrement: true`); the local `android/` dir is gitignored and regenerated.

## Phase 3 — iOS prep

- `eas.json` `submit.production.ios`: `ascAppId`, `ascApiKeyPath`, `ascApiKeyId`, **`ascApiKeyIssuerId`** (NOTE the field name — `ascApiIssuerId` is WRONG and fails schema validation).
- `app.json` `ios.bundleIdentifier` = `com.mingla.app.v2`; `supportsTablet: false` (iPhone-only); `ITSAppUsesNonExemptEncryption: false` (auto-skips encryption export docs).
- Associated domains: `applinks:usemingla.com` (+ `applinks:business.usemingla.com`) — backs Universal Links; requires the `/.well-known/apple-app-site-association` file served as `application/json` (see Phase 5/6 + the marketing site).
- Credentials: distribution cert + App Store provisioning profile + OneSignal-extension profile, all on EAS (managed). When EAS says a profile is "no longer valid," answer **Y / reuse** — it regenerates a valid one.

## Phase 4 — Marketing site / well-known (one-time, then verify)

The marketing site (`mingla-marketing/`, Next.js on Vercel, domain `usemingla.com`) must serve:
- `/.well-known/apple-app-site-association` — AASA, `Content-Type: application/json`, appID `782KVMY869.com.mingla.app.v2`, paths `/invite/*`, `/board/*`, `/orders/*`, `/chat/*`
- `/.well-known/assetlinks.json` — package `com.mingla.app.v2`, both prod SHA-256 fingerprints
- `vercel.json` headers config forcing `application/json` on both (required by the strict-grep gate)
- Legal pages: `/privacy-policy`, `/terms-of-service`, `/delete-account`, `/support`
- **Vercel deploy gotcha:** the project has an "Ignored Build Step" that SKIPS the build unless the commit message contains `[deploy]`. Every marketing commit that should deploy MUST include `[deploy]`.

Verify after deploy:
```bash
curl -sIL https://usemingla.com/.well-known/apple-app-site-association   # 200 + application/json
curl -sIL https://usemingla.com/.well-known/assetlinks.json              # 200 + application/json
curl -s "https://app-site-association.cdn-apple.com/a/v1/usemingla.com"  # Apple CDN echoes AASA
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://usemingla.com&relation=delegate_permission/common.handle_all_urls"
```

## Phase 5 — Play Console dashboard config

Policy > App content:
- **Data safety** — declare ALL data types actually collected (~15 for Mingla; see answer sheet). Encryption in transit = yes. Deletion = supported (in-app Settings → Delete Account + `/delete-account` URL). **Don't under-declare** — re-audit each release.
- **Advertising ID** = Yes (AppsFlyer uses it; AD_ID permission auto-merged from SDK). Purpose: Analytics + App functionality (NOT advertising).
- **Permissions declaration** — `ACCESS_FINE_LOCATION` foreground-only → easy declaration, no background-location video.
- **Content rating** (IARC) — Social Networking; alcohol = references only (Infrequent/Mild); users-communicate = yes; → Teen/12+.
- **Ads** = none. **Financial features** = none (IAP ≠ financial feature). **Health** = none. **Government** = no.
- **App access** — "some functionality restricted"; provide reviewer instructions (Phase 8).
- **Main store listing → Contact details** — public email `support@usemingla.com` + website.

## Phase 6 — App Store Connect dashboard config

- **App Privacy (Nutrition Labels)** — Data Used to Track You = Device ID/IDFA (the only one, via ATT). Everything else = Linked to You (tied to account). Nothing Not-Linked.
- **Age Rating** — all None except Alcohol references = Infrequent/Mild → 12+.
- **App Information [per-launch]:**
  - Support URL → `https://www.usemingla.com/support`
  - Marketing URL → `https://www.usemingla.com`
  - Version → matches `app.json` version (e.g. `1.1.0`)
  - Copyright → `2026 MINGLA LLC` (Apple prepends ©)
- **App Review Information:**
  - Sign-in required: Yes. User name `+12015550199`, Password `123456` (the test-OTP bypass — see Phase 8).
  - Notes: the reviewer flow (Sign in with Apple → phone `+12015550199` → code `123456` → Home).
  - Contact Information: Seth Ogieva + monitored phone + monitored email.
- **Encryption Export Compliance** — auto-clears via `ITSAppUsesNonExemptEncryption: false`.
- **Subscriptions** — `mingla_plus_weekly/_monthly/_annual` must be `READY_TO_SUBMIT`.

## Phase 7 — UGC content moderation (Apple Guideline 1.2)

Apps with user content need 4 things: **report ✓, block ✓, published contact ✓, filter ✓**.
- Filter = `moderate-content` edge function (OpenAI Moderation, free endpoint, reuses `OPENAI_API_KEY`, fails OPEN). Client `moderationService.moderateText()` called pre-insert at: board messages, direct messages, profile bio. (Reviews are rating-only — nothing to filter.)
- Published contact = in-app Settings → Contact Support → `mailto:support@usemingla.com`.

## Phase 8 — Reviewer access (test-OTP bypass)

Primary login = Sign in with Apple / Google. Onboarding has a **mandatory phone+OTP gate** with no skip — so reviewers need a bypass:
- Reviewer number **`+12015550199`** (NANP 555-0199 fictional range) + fixed code **`123456`**.
- `send-otp` skips real SMS for that number; `verify-otp` accepts the fixed code, attaches the number to the reviewer's account, frees it from any prior account first (so repeat reviews work). Server-side, in deployed edge functions — works on any build.

## Phase 9 — Build → submit (exact sequence)

```bash
# 1. Ensure the ORCH branch is MERGED to main, then from the anchor on main:
cd ~/Desktop/mingla-main && git checkout main && git pull

# 2. Build (run INTERACTIVELY; see gotchas about the invisible prompt)
cd ~/Desktop/mingla-main/app-mobile
eas build --platform ios --profile production --non-interactive   # non-interactive avoids the invisible-prompt hang
# (Android: --platform android, or --platform all)

# 3. When the build finishes (build URL + .ipa link printed), submit:
eas submit --platform ios --profile production --latest
# uses the ASC API key in eas.json — no Apple ID / 2FA prompt

# 4. Build processes in ASC (~5-15 min), then appears in the version's Build dropdown.
# 5. Attach build → fill any remaining metadata → Submit for Review.
```

## Phase 10 — Pre-submit verification

- Build off **main HEAD** (verify `runtimeVersion` = current version, NOT the old one).
- EAS build logs: confirm Mixpanel + Mapbox + Stripe envs injected.
- Install signed AAB on a physical Android + the IPA via TestFlight on iPhone.
- **Walk the full first-run flow:** install → Sign in with Apple → ATT prompt → location grant/deny → reviewer phone bypass (`+12015550199` / `123456`) → Home → search/autocomplete → paywall → IAP sandbox → push tap → deep link (`usemingla.com/invite/...` opens app).
- Post a test message with objectionable text → confirm moderation blocks it.
- Watch Sentry for zero fatal crashes during the smoke walk.
- `eas submit` to internal/closed track first; promote after smoke passes.

---

# PART B — CANONICAL REFERENCE DATA

## Identifiers (stable)
| Thing | Value |
|---|---|
| iOS bundle ID | `com.mingla.app.v2` |
| iOS extension bundle | `com.mingla.app.v2.OneSignalNotificationServiceExtension` |
| Android package | `com.mingla.app.v2` |
| Apple Team ID | `782KVMY869` (MINGLA LLC) |
| Apple Provider ID | `128592392` |
| ASC App ID | `6760440898` |
| ASC App name | `Mingla–Date Plans & City Gems` |
| ASC SKU | `mingla-ios-v1` |
| Expo project | `@sethogieva/mingla` (`01f9ff7c-379a-4be5-9236-1195d6921c6d`) |
| Supabase project ref | `gqnoajqerqhnvulmnyvv` |
| Firebase / Google project | `mingla-dev` (single project, dev+prod) |
| Legal entity / jurisdiction | MINGLA LLC, Raleigh, Wake County, North Carolina · DUNS 144936276 |
| Reviewer test phone / code | `+12015550199` / `123456` |
| iOS dist cert serial | `3EA1AD008F0C9F2592639D817AAFF16` (exp 2027-03-03) |
| ASC API key ID / issuer | `B39RMRV6D8` / `ee78d0ff-158c-4326-80ef-aec69745fc2d` |
| Android signing SHA-256 (×2) | `06:4E:20:DE:…:7A:BC` + `90:28:F8:B1:…:0E:02` |

## Email aliases (Google Workspace on usemingla.com, all → seth@)
`support@` · `legal@` · `privacy@` · `security@` · `press@` · `hello@` · `developer@`

## Secrets locations (LOCAL ONLY, gitignored)
- `~/.mingla-secrets/playstore-mingla.json` — Play service account
- `~/Desktop/mingla-main/Key Details For Mingla/` — all downloaded keys (ASC `.p8`, Stripe live, Twilio, OneSignal, etc.)
- `~/Desktop/mingla-main/Key Details For Mingla/AuthKey_B39RMRV6D8.p8` — ASC API key

## Subscription products
`mingla_plus_weekly` · `mingla_plus_monthly` · `mingla_plus_annual` (group "Mingla Plus", id 22000661)

---

# PART C — ANSWER-SHEET INDEX

Detailed paste-ready content for each dashboard form (in `Mingla_Artifacts/`):
- `ORCH_0977_PLAY_CONSOLE_DATA_SAFETY.md` — Play Data Safety, per data type
- `ORCH_0977_APP_STORE_PRIVACY_NUTRITION_LABELS.md` — ASC Nutrition Labels
- `ORCH_0977_COMPLIANCE_QUESTIONNAIRES.md` — Permissions Declaration + Content Rating + Age Rating
- `ORCH_0977_APP_REVIEW_INFORMATION.md` — reviewer notes + sign-in bypass + contact
- `ORCH_0977_RELEASE_NOTES.md` — Play + App Store "What's New"
- `ORCH_0977_LAUNCH_CHECKLIST.md` — the full 47-item checklist with per-item evidence

---

# PART D — GOTCHAS & LESSONS (read before every build)

1. **Build from `main` after merge — not from an unmerged worktree branch.** Stale-binary trap. Verify `runtimeVersion` in the build log matches the new version.
2. **`eas build` "hangs" with a blank screen** = an invisible interactive prompt (TTY rendering issue), usually the **billing confirmation** ("you've used 100% of build credits — pay-as-you-go?") or the encryption-config prompt. Fix: run `--non-interactive` (auto-accepts app-config values), OR run with `EXPO_DEBUG=1` to force plain-text prompts. Your terminal IS a valid TTY — it's an eas-cli rendering quirk.
3. **EAS build credits** reset monthly. Over the limit = pay-as-you-go (~$1–2/iOS build). The "hang" right after "Incrementing buildNumber" is the billing prompt.
4. **eas.json iOS submit field is `ascApiKeyIssuerId`** — NOT `ascApiIssuerId`. Wrong name fails schema validation and blocks even `eas build`.
5. **Vercel marketing deploys need `[deploy]` in the commit message** or the Ignored Build Step skips them.
6. **Vercel `domains inspect` 403** is fine — the canonical DNS records are universal: apex `A → 76.76.21.21`, `www CNAME → cname.vercel-dns.com`. Custom domains bypass Vercel SSO (`all_except_custom_domains`), so the public site is reachable even when preview URLs return 401.
7. **Page `<title>` doubling** — root layout has `title.template = '%s — Mingla'`. Page metadata title must be bare (`'Support'`, not `'Support — Mingla'`).
8. **Reviewer can't receive SMS** — primary login is Apple/Google OAuth + a mandatory phone gate. Use the `+12015550199` / `123456` bypass; explain it in App Review notes.
9. **Privacy Policy must list every third-party processor** or store reviewers flag a mismatch with the data-safety declarations. Mingla uses 17 (Supabase, Cloudinary, Twilio, Resend, Google, Apple, Mapbox, OpenWeatherMap, BestTime, Ticketmaster, Mixpanel, AppsFlyer, OneSignal, Sentry, RevenueCat, Stripe, Expo). Vonage is NOT used.
10. **`supabase functions deploy` can report success but 404** — always curl the function URL once after deploy to confirm reachable.
11. **Touching `supabase/functions/` or `migrations/` in a PR** → add the files to the strict-grep backend allowlist in the SAME commit or CI fails.
12. **OpenAI Moderation API is free** (no per-token charge) — use it for UGC filtering; reuses the existing `OPENAI_API_KEY` edge secret.
13. **Root `.easignore` is shared by BOTH EAS apps and can silently gut the app you're building.** `eas build` archives the entire **git repo root** (not just the app dir), so the root `/.easignore` applies to app-mobile AND mingla-business builds alike. A `.easignore` line excluding `app-mobile/` (added 2026-05-28 in ORCH-0978 for a mingla-business build) stripped the consumer app's source from the upload — the build then **fails in ~55s, right after `PRE_INSTALL_HOOK`, with a content-less "Unknown error"** (no compile output, no real diagnostic). Diagnose with `eas build:inspect -p ios -e production -s archive -o /tmp/x` then `ls /tmp/x/app-mobile/src` — if it's missing, the `.easignore` ate it. **Rule: the root `.easignore` must exclude NEITHER `app-mobile/` NOR `mingla-business/` (keep `packages/` too); only exclude non-built dirs (`Mingla_Artifacts/`, `mingla-admin/`, `mingla-marketing/`, roadmap/docs, plus the standard `node_modules`/`ios`/`android`/`.expo`/`.env`).** A sub-minute "Unknown error" before INSTALL_DEPENDENCIES is almost always the archive missing the project, not an EAS transient.

---

# PART E — POST-LAUNCH / DECOMMISSION NOTES

- Retire the reviewer test-OTP bypass post-launch by deleting the `REVIEWER_TEST_PHONE` blocks in `send-otp` + `verify-otp` and redeploying (optional; low risk to leave).
- Rotate any credential that ever appeared in a chat/log (e.g. APNs `.p8`, FCM service account if surfaced during an OneSignal probe).
- Tighten DMARC from `p=none` → `p=quarantine`/`reject` once you've confirmed no legit mail is blocked.
