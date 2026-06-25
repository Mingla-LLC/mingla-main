# ORCH-1215 — Mingla Business · Compliance Questionnaire Answer Sheet

**Covers:** Play Console Permissions Declaration + Play Console Content Rating (IARC) + App Store Connect Age Rating
**Audit date:** 2026-06-22
**Bundle:** `com.sethogieva.minglabusiness` v1.0.0 · ASC App ID `6768737367`
**Modeled on:** `ORCH_0977_COMPLIANCE_QUESTIONNAIRES.md` (consumer). Business deltas flagged ⚠️.

**Business app permissions in scope (verified `app.json`):**
- **Android:** `CAMERA`, `NFC`, `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE`, `INTERNET`, `RECORD_AUDIO`
- **iOS infoPlist:** `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSFaceIDUsageDescription`, `NSUserTrackingUsageDescription`
- **iOS entitlements:** `com.apple.developer.in-app-payments` (Apple Pay merchant), `aps-environment: production`, OneSignal app group
- **NO location permission on either platform** (key difference from consumer).

How to use: read each section, paste/select the matching answer. Decisions needing your call are flagged ⚠️.

---

## A — Play Console Permissions Declaration

**Where:** Play Console → Mingla Business → Policy > App content > Sensitive app permissions (or surfaces during the release flow).

Google requires a declaration for "sensitive/high-risk" permissions. **The business app requests NO `ACCESS_*_LOCATION`**, so the onerous location declaration does NOT apply (this is the easy path, unlike consumer).

The business app's sensitive permissions and their justifications:

| Permission | Justification (paste if asked) |
|---|---|
| `CAMERA` | User-initiated QR ticket scanning at the door (operator scans attendee tickets) + capturing brand/event cover photos. Verified: `app/event/[id]/scanner/index.tsx` uses `expo-camera` `CameraView` + `useCameraPermissions` for QR-only scanning. |
| `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` | User-initiated photo/video selection for brand logo + event/experience cover media (`expo-image-picker`, `CoverPicker.tsx`). |
| `NFC` | ⚠️ **DECLARED BUT UNUSED.** `react-native-nfc-manager` is in `package.json` but NO `NfcManager` import / NFC code path exists in `src/` or `app/` (verified). `app.config.ts` comments mark it `[TRANSITIONAL]` for a future Cycle 13 door-mode. **Recommend removing `android.permission.NFC` from `app.json` before submission** — declaring an unused sensitive permission invites a Play review question. |
| `RECORD_AUDIO` | ⚠️ **DECLARED BUT UNUSED.** No audio-recording code path found in the business app. **Recommend removing `android.permission.RECORD_AUDIO` from `app.json`.** |
| `INTERNET` | Standard; no declaration needed. |

⚠️ **Side flag (iOS):** `NSFaceIDUsageDescription` is declared ("confirm Apple Pay transactions at the door"). Confirm Face ID / Apple Pay door-mode is actually wired in the shipped build; if not yet live, the string is harmless but be ready to explain it in review.

**Advertising ID:** `AD_ID` permission auto-merges from AppsFlyer. Declare in Data Safety (separate form) — purpose Analytics + App functionality, NOT advertising.

---

## B — Play Console Content Rating (IARC questionnaire)

**Where:** Play Console → Mingla Business → Policy > App content > Content rating → Start questionnaire.

**Category:** Select **"Utility, Productivity, Communication, or Other"** or **"Business"** — Mingla Business is a B2B organizer/venue-management tool, NOT a social network. (It is NOT the consumer "Social Networking" category.) Recommend **Business / Productivity**.

| IARC question | Answer | Why |
|---|---|---|
| Violence (any) | **No** | None |
| Sexuality / nudity | **No** | None |
| Profanity / crude humor (in the app) | **No** | Clean B2B copy |
| Controlled substances (drugs, alcohol, tobacco) | ⚠️ **References only — choose "References to"** | Organizers can list bar/drinks venues + experiences. References to alcohol as a venue category, not depiction/encouragement of use. If a frequency sub-question appears: "Infrequent/Mild." |
| Gambling | **No** | None |
| Horror / fear themes | **No** | None |
| Users can interact / communicate | ⚠️ **Limited** — there is NO user-to-user messaging. The only chat is **Ari (user↔AI assistant)** and a **support ticket inbox (user↔Mingla)**. There is no organizer-to-organizer or organizer-to-attendee in-app chat. If the question is strictly "can users communicate with each other," answer **No**; if it covers any messaging surface, answer **Yes** and note it is AI/support only. |
| Users can share their location with others | **No** | No location features |
| Shares user-provided personal info with third parties | **No** | Not sold/shared for third-party marketing (Privacy Policy §5) |
| Digital purchases | ⚠️ **No IAP** — Business has no in-app purchase/subscription (RevenueCat install-only). Buyers DO purchase event tickets via Stripe/Apple Pay, but that is real-world goods/services (event admission), not digital goods. Answer per Google's intent: **No** for "digital purchases (IAP)." |
| Unrestricted internet access | **No** | No open web browser; only Stripe Connect/onboarding web views with fixed URLs |

**Expected resulting rating:** Likely **Everyone / Everyone 10+** to **Teen**, driven mainly by the mild alcohol-reference answer. The absence of user-to-user social + location-sharing keeps it lower than the consumer app. ⚠️ The business app is intended for **adult organizers (18+)** — App access notes and the listing should state it is a business tool for organizers, but content-rating may still land low.

---

## C — App Store Connect Age Rating questionnaire

**Where:** ASC → My Apps → Mingla Business → (version) → Age Rating → Edit.

| Apple content type | Answer |
|---|---|
| Cartoon or Fantasy Violence | **None** |
| Realistic Violence | **None** |
| Prolonged Graphic/Sadistic Violence | **None** |
| Profanity or Crude Humor | **None** |
| Mature/Suggestive Themes | **None** |
| Horror/Fear Themes | **None** |
| Medical/Treatment Information | **None** |
| Alcohol, Tobacco, or Drug Use or References | ⚠️ **Infrequent/Mild** (organizers list bar/drinks venues + experiences; references only) |
| Sexual Content or Nudity | **None** |
| Graphic Sexual Content and Nudity | **None** |
| Gambling (simulated) | **None** |
| Contests | **None** |
| Unrestricted Web Access | **No** |

**Apple's UGC + communication questions (the consequential part):**

⚠️ **Guideline 1.2 (UGC) — business app posture:**
The business app has **NO user-to-user communication** (no organizer↔organizer or organizer↔attendee chat). The only conversational surfaces are:
1. **Ari** — user↔**AI** assistant chat (not user-generated content visible to other users).
2. **Support inbox** — user↔**Mingla** ticketing.

However, organizers DO **publish public-facing content** (event/experience listings, cover images, descriptions, brand profiles) that appears on public pages and in the consumer app's discovery deck. This is UGC visible to the public, so Apple's 1.2 safeguards still apply to that published content:
1. **Filter objectionable material** — ⚠️ CONFIRM whether business-published listing copy/images run through the `moderate-content` edge function (the consumer app uses OpenAI Moderation, fail-open; shared backend means the function exists). If brand listings are NOT filtered, that is a 1.2 gap to close before submission.
2. **Report offensive content** — the consumer app provides reporting of public listings; confirm a report path exists for brand-published content.
3. **Block abusive users** — N/A for organizer-to-organizer (no such surface); platform-level moderation/takedown applies.
4. **Published contact** — ✅ `support@usemingla.com` + in-app Support tab (`app/support/inbox.tsx`).

⚠️ **DECISION POINT for Seth:** Because the business app is primarily an authoring/management tool with no user-to-user chat, the 1.2 risk is LOWER than consumer. But confirm: **(a)** brand-published listing content is moderated server-side, and **(b)** there is a report path for brand-published public content. If both hold, declare the safeguards and proceed. If not, the gap is on published-listing moderation, not on chat.

**Expected resulting rating:** **12+** (driven by Alcohol references = Infrequent/Mild). The lack of user-to-user social pulls it below the consumer profile, but the public-listing UGC still requires the 1.2 attestation.

---

## Summary of decisions needed from Seth

1. ⚠️ **Remove unused `android.permission.NFC`** from `app.json` (declared, no code path). Recommend yes.
2. ⚠️ **Remove unused `android.permission.RECORD_AUDIO`** from `app.json` (no audio code path). Recommend yes.
3. ⚠️ **Confirm Face ID / Apple Pay door-mode** is wired (or accept the `NSFaceIDUsageDescription` as a forward-looking string and explain in review).
4. ⚠️ **Confirm brand-published listing content moderation + report path** (Apple 1.2 for public UGC). Lower risk than consumer (no user-to-user chat) but still required for published listings.
5. Both content-rating questionnaires resolve to roughly **12+/Teen**, driven by mild alcohol references. The app is a B2B organizer tool — categorize under **Business**, not Social Networking.

## Cross-references

- Permissions verified against `mingla-business/app.json` (`android.permissions` + `ios.infoPlist` + `ios.entitlements`)
- Camera = QR ticket scanning (`app/event/[id]/scanner/index.tsx`) + cover-media capture
- NFC/RECORD_AUDIO = declared-but-unused (verified no imports)
- Ari = AI assistant (`app/(tabs)/ari.tsx`); Support inbox = `app/support/inbox.tsx`
- Contact published: `support@usemingla.com` + in-app Support tab
