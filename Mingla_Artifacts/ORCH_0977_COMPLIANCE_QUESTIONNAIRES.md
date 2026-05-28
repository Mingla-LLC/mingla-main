# ORCH-0977 — Compliance Questionnaire Answer Sheet (#28, #29, #37)

**Covers:** Play Console Permissions Declaration (#28), Play Console Content Rating / IARC (#29), App Store Connect Age Rating (#37)
**Audit date:** 2026-05-28
**Bundle:** `com.mingla.app.v2`
**App permissions in scope:** ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, CAMERA, RECORD_AUDIO, READ_CALENDAR, WRITE_CALENDAR, MODIFY_AUDIO_SETTINGS (Android); Location (when-in-use), Camera, Microphone, Photo Library, Calendar, Reminders (iOS)

How to use: read each section, paste/select the matching answer in the dashboard. Decision points that need YOUR call are flagged ⚠️.

---

## #28 — Play Console Permissions Declaration

**Where:** Play Console → Mingla → Policy > App content > Sensitive app permissions (or it surfaces during the release flow).

Google requires a declaration for any "sensitive" permission. Mingla's only sensitive permission requiring declaration is **location**.

### Location permission declaration

- **Permissions requested:** `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION`
- **Background location:** **NOT requested** — `ACCESS_BACKGROUND_LOCATION` is absent. Mingla only accesses location while the app is in the foreground and in active use. This is the easy answer; you do NOT need to fill out the (onerous) background-location declaration video + justification.
- **Is location access required for core functionality?** **Yes**
- **Declaration text (paste this):**
  > Mingla uses your device location to recommend nearby venues, experiences, and date plans relevant to where you are. Location is accessed only while the app is open and in active use (foreground only). Users may deny location permission and manually select a city instead; the app remains functional without location access. Location is never accessed in the background and is never sold or shared for advertising.
- **Prominent disclosure:** confirm the in-app location permission prompt (the OS dialog) appears before any location access, and that the usage is described. Your `NSLocationWhenInUseUsageDescription` (iOS) and runtime permission request (Android) satisfy this.

### Other permissions (no separate declaration needed, but be ready to explain in review)

| Permission | Justification if asked |
|---|---|
| CAMERA | User-initiated photo capture for experience/board content |
| RECORD_AUDIO / MODIFY_AUDIO_SETTINGS | User-initiated voice notes in beta feedback |
| READ_CALENDAR / WRITE_CALENDAR | Add scheduled experiences to the user's device calendar (user-initiated) |

⚠️ **Side flag (iOS):** `app.json` still carries `NSLocationAlwaysAndWhenInUseUsageDescription` (the "Always"/background-location string), but the app only uses foreground location (no `ACCESS_BACKGROUND_LOCATION` on Android, no background-location entitlement). Apple App Review may ask why you declare "Always" capability you don't use. **Recommend removing `NSLocationAlwaysAndWhenInUseUsageDescription` from `app.json` infoPlist** and keeping only `NSLocationWhenInUseUsageDescription`. Small code change; eliminates a review question. Tell me to "strip the Always location string" and I'll do it in the worktree.

---

## #29 — Play Console Content Rating (IARC questionnaire)

**Where:** Play Console → Mingla → Policy > App content > Content rating → Start questionnaire.

**Category:** Select **"Social Networking / Communication"** or **"Reference, News, or Educational"** — Mingla is a social-experiences/planning app. Recommend **Social Networking** because it has friend connections + messaging.

| IARC question | Answer | Why |
|---|---|---|
| Violence (cartoon, fantasy, realistic) | **No** | Mingla has no violent content |
| Sexuality / nudity | **No** | None |
| Profanity / crude humor (in the app itself) | **No** | App copy is clean |
| Controlled substances (drugs, alcohol, tobacco) | ⚠️ **Yes — references only** | Mingla suggests venues including bars ("drinks places" preference). This is venue discovery, not depiction/encouragement of use. Select "References to" (not "use of"). If a "frequency" sub-question appears, choose "Infrequent/Mild." |
| Gambling (simulated or real) | **No** | None |
| Horror / fear themes | **No** | None |
| Users can interact / communicate | **Yes** | Friend connections + board discussion messages |
| Users can share their location with others | **Yes** | Collab/friend features share location context |
| Shares user-provided personal info with third parties | **No** | Mingla does not sell or share personal info for third-party marketing (per Privacy Policy §5) |
| Digital purchases | **Yes** | Mingla Plus subscription |
| Unrestricted internet access (in-app browser to any site) | **No** | No open web browser |

**Expected resulting rating:** Likely **Teen (13+)** in North America (ESRB) / **PEGI 12** (Europe), driven by the user-communication + location-sharing + mild alcohol-reference answers. This matches the 13+ minimum age in your Terms §3.

---

## #37 — App Store Connect Age Rating questionnaire

**Where:** ASC → My Apps → Mingla → (version) → Age Rating → Edit.

Apple's questionnaire (current system). Answer each content type with frequency: None / Infrequent or Mild / Frequent or Intense.

| Apple content type | Answer |
|---|---|
| Cartoon or Fantasy Violence | **None** |
| Realistic Violence | **None** |
| Prolonged Graphic or Sadistic Realistic Violence | **None** |
| Profanity or Crude Humor | **None** |
| Mature/Suggestive Themes | **None** |
| Horror/Fear Themes | **None** |
| Medical/Treatment Information | **None** |
| Alcohol, Tobacco, or Drug Use or References | ⚠️ **Infrequent/Mild** | (venue suggestions include bars; references only, no depiction of use) |
| Sexual Content or Nudity | **None** |
| Graphic Sexual Content and Nudity | **None** |
| Gambling (simulated) | **None** |
| Contests | **None** |
| Unrestricted Web Access | **No** |
| Gambling and Contests | **No** |

**Apple's user-generated-content + communication questions (the consequential part):**

⚠️ **DECISION POINT — Apple requires apps with user-generated content and/or user-to-user communication to have safeguards.** Mingla has friend messaging + board discussions + reviews. Apple's Guideline 1.2 requires, for UGC apps:
1. A method to **filter objectionable material**
2. A mechanism to **report offensive content** and timely response
3. The ability to **block abusive users**
4. Published **contact information** so users can reach you

You now have published contact (`support@`, `legal@`, `privacy@`). **Do you currently have in-app report + block + content filtering for the messaging/board features?**
- **If YES:** declare the moderation safeguards; age rating stays in the 12+ range.
- **If NO:** this is a **likely App Review rejection risk** (Guideline 1.2). You'd need to add report/block/filter to the messaging + board features before submission, OR Apple may reject. This is the single biggest remaining App Store risk and is a product-build item, not a dashboard toggle.

**Expected resulting rating:** **12+** (driven by the alcohol-reference = Infrequent/Mild + the social/UGC features), assuming moderation safeguards are in place. Without UGC safeguards, expect a 1.2 rejection regardless of the numeric rating.

---

## Summary of decisions needed from you

1. ⚠️ **Strip the vestigial `NSLocationAlwaysAndWhenInUseUsageDescription`** from app.json (recommend yes — I can do it).
2. ⚠️ **Confirm whether the app has in-app report/block/content-filtering** for messaging + board discussions. If not, that's a pre-submission build item (Apple Guideline 1.2) and the biggest remaining App Store rejection risk.
3. Both content-rating questionnaires resolve to **12+/Teen** — consistent with your Terms' 13+ minimum.

## Cross-references

- Permissions verified against `app.json` (`expo.android.permissions` + `expo.ios.infoPlist`)
- Alcohol reference basis: "drinks places" preference chip in onboarding (venue discovery)
- UGC surfaces: BoardDiscussion messages, place reviews/ratings, beta feedback
- Contact info now published: support@, legal@, privacy@, security@ (Workspace aliases live 2026-05-27)
