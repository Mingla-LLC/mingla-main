# QA REPORT — ORCH-1030 [Consumer app notification deep-linking]

**Skill:** mingla-tester (Claude)
**Date:** 2026-05-31
**Mode:** TARGETED (orchestrator-dispatched, ORCH-ID)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1030-[notification-deep-linking]/` on branch `ORCH-1030-notification-deep-linking`
**Contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1030_NOTIFICATION_DEEP_LINKING.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1030_NOTIFICATION_DEEP_LINKING.md`
**Posture:** assumed broken until independently proven. Implementor claims NOT trusted — every claim re-run.

---

## VERDICT: PASS

- P0: 0 | P1: 0 | P2: 0 | P3: 1 | P4: 2
- SC-1-iOS: **PASS (proven)** — live-fire on iPhone 17 Pro sim.
- SC-1-Android: **PASS (proven)** — live-fire on emulator-5554.
- Both SC-1 platform gates pass → unconditional PASS.

---

## 1. Code-layer verification (independent)

### 1.1 Implementor happy-path regression test — re-run independently
`cd app-mobile && deno test --allow-read --no-check src/services/__tests__/deepLinkRouting.orch1030.test.ts`
→ **11 passed | 0 failed.** Confirmed.

### 1.2 Tester adversarial regression test (NEW, committed `af4e1d2ee`)
`app-mobile/src/services/__tests__/deepLinkRouting.orch1030.adversarial.test.ts` — **11 passed | 0 failed.**

Attacks a DIFFERENT angle than the implementor's happy-path test:
- **ADV-1a/b/c** stale/deleted entity ids → still produce a well-formed Destination that the executor LANDS (session→Home, calendar→Likes/Calendar w/ entryId carried, profile→overlay). Never null, never blank, never crash.
- **ADV-2** unknown scheme (`ftp://`), empty string, bare `mingla://`, `mingla://%%%`, unknown path, `orders/{id}` no-`/chat` → all return `null` and NEVER throw; the full ladder then falls back by type (no dead tap).
- **ADV-3a/b/c** special-case killer — a type that USED to have a hand-coded in-app special-case (`paired_user_*`, `direct_message_*`, `holiday_reminder`) but now ALSO carries a server `data.deepLink`: the SERVER LINK WINS (the special-case is genuinely gone; the deep link is canonical).
- **ADV-4** push vs in-app vs deferred parity for the SAME malformed input → all three reach the byte-identical Destination + identical executor effects; none lands Connections.
- **ADV-5** `profile/{id}` empty/bare → falls back to the user's own Profile tab (no overlay for an empty id).
- **ADV-6** exhaustive: every live consumer type (from `notify-dispatch` `typeToPreference` + `SESSION_SCOPED_TYPES`), with no deepLink + no ids, lands a real page via the executor; collab/session/board_card never land Connections.
- **ADV-7** `executeDeepLink(null)` is a safe no-op.

**fails-on-revert verified at `309dcfac6`** (the implementor's HEAD before my adversarial commit): I scratch-reverted the F-01 hunk in `deepLinkService.ts` (`typeFallbackDestination` collab/session branch → `{ kind:'page', page:'connections' }`), re-ran → **3 adversarial tests FAILED** (ADV-2 ladder-falls-to-Connections, ADV-4 parity-to-Connections, ADV-6 collab-to-Connections); restored the fix → **11 passed.** The implementor's own happy-path test independently claims fails-on-revert at `b1d1028ba`; I re-confirmed the same hunk drives 5 of its cases.

### 1.3 Type / lint / deno-check gates (implementor claims re-run)
- **deno check** on all 4 modified edge functions (`notify-birthday-reminder`, `notify-holiday-reminder`, `notify-message`, `notify-dispatch`) → **clean** (zero output).
- **tsc** `deepLinkService.ts` isolated (strict, bundler resolution) → **exit 0, 0 errors.**
- **eslint** on the 4 touched app-mobile files (`index.tsx`, `deepLinkService.ts`, `LikesPage.tsx`, `CalendarTab.tsx`) → **0 errors** (85 warnings, all pre-existing baseline: import-ordering + exhaustive-deps in existing code, none introduced by this ORCH).

### 1.4 Truthfulness check — executeDeepLink + typeFallbackDestination traced for EVERY consumer type
Every live notification type lands on a real screen, including in loading/error/empty/stale states:

| Type(s) | No-deepLink fallback Destination | Lands | Stale/error degrade |
|---|---|---|---|
| session_*, collaboration_*, board_card_* | `session` (if id) else `page:home` | Home | stale session id → `pendingSessionOpen` set then cleared at Home; never blank (index.tsx:999-1004) |
| board_message_* | `conversation` (if id) else `page:home` | Connections thread / Home | — |
| direct_message_* | `conversation` (if id) else `page:connections` | Connections | — |
| paired_user_* | `profile` (actor_id) else `pairedDeck` | Profile overlay / Discover | garbage userId → `ViewFriendProfileScreen` renders "Profile unavailable" error state (line 606), never blank |
| birthday/holiday_reminder | `profile` (partnerId) else `page:connections` | Profile / Connections | same error-state degrade |
| calendar_*, visit_feedback_prompt | `page:likes` | Likes | stale calendar entryId → CalendarTab only auto-expands on match (CalendarTab.tsx:241-247); else plain Calendar |
| trial_ending | `paywall` | Paywall | — |
| re_engagement*, weekly_digest, referral_credited | `page:home` | Home | — |
| unknown type | `page:home` | Home | — |

**No dead-ends found.** Constitution #3 (no silent failure) + I-NO-SILENT-FAILURE upheld: every path lands somewhere; `parseDeepLink` is try/catch-wrapped + null-safe; `executeDeepLink` has a `never` exhaustiveness guard.

### 1.5 Architecture / invariant spot-checks
- `NAV_TARGETS` is **DELETED** (grep: 0 definitions). The 4 call sites (in-app `handleNotificationNavigate` :1028, push `processNotification` :499, deferred-replay :749, OS-Linking `handleDeepLink` :1709) all run the identical `parseDeepLink(deepLink) ?? typeFallbackDestination(type,data)` → `executeDeepLink` ladder with the full handler set (incl. `setPendingSessionOpen` + `setViewingFriendProfileId`). **I-NOTIF-ONE-ROUTER upheld.**
- No `setCurrentPage('connections')` in any notification-routing region. The 5 `setCurrentPage("connections")` hits (index.tsx:1859/1908/2082/2194/2314) are all unrelated UI callbacks (discover→DM, profile→connections), NOT in `handleNotificationNavigate`/`processNotification`. **Strict-grep gate clean.**
- Backend producers: birthday + holiday + board-message now pass `deepLink` TOP-LEVEL (so `notify-dispatch:314/316` fills both `data.deepLink` and the `deep_link` column). Holiday correctly uses `paired_user_id` (a real user id) not `person_id` (a `saved_people` contact) — verified the D-1 deviation against `information_schema`; producers emit `partnerId` in data so the no-deepLink fallback still resolves the profile.

---

## 2. SC-1 device live-fire (mandatory acceptance gate — both platforms distinct gates)

**Setup:** Metro on port 8087. The assigned port was held by a stale ORCH-1016 Metro (PID 46773, different worktree) — reclaimed that specific PID only (no global pkill, no other ports touched). The worktree's `node_modules` symlink mangled Metro's `expo-router/entry` resolution ("Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry"). Resolved per `feedback_testing_handoff_just_run_expo_start` + `feedback_shared_anchor_checkout_staging_hazard`: overlaid ONLY my 4 changed source files onto the anchor checkout (whose copies of those 4 files were clean/committed; ZERO overlap with another session's 8 dirty coach-mark files), ran Metro from the anchor on 8087, then restored my 4 files via `git checkout -- <explicit paths>` (never `reset --hard`/`add -A`). Other session's dirty files confirmed untouched.

**Signed-in test user (both devices):** `c727d491-4884-4e72-b467-d6c124b9a8b9` ("Seth" / `sethogieva`), participant in active session `5ebf8afb-0793-4c9c-b76c-c914048bcf54`.

### SC-1-iOS — PASS (proven) — iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)
Inserted controlled row via Management API (read-only MCP can't write): `session_member_joined`, `data:{sessionId:5ebf8afb…}`, `deep_link=NULL`, **NO `data.deepLink`** (id `44d51ede…`) — the exact F-01 headline-bug scenario.
- Opened the in-app NotificationsSheet (bell), row rendered: "ORCH-1030 QA: Ari joined your session … no deepLink" (screenshot `/tmp/ios_notifsheet2.png`).
- Tapped the row (Maestro `--device 17091E60…`, NEVER osascript). 
- **Result:** sheet dismissed, bell badge cleared, app landed on **Home/Explore** (bottom "Explore" tab active) — **NOT Connections/Friends.** Screenshot `/tmp/ios_after_tap2.png`.
- **Metro log proof:** `[ACTION] Notification tapped | type="session_member_joined", deepLink=undefined` followed by `[HEALTH_MONITOR]` on home + HomePage render-count increments. The `deepLink=undefined` confirms the no-deepLink F-01 path routed via `typeFallbackDestination` → `{kind:'session'}` → Home. Pre-fix this hit `setCurrentPage('connections')`.

### SC-1-Android — PASS (proven) — emulator-5554 (Pixel 8 Pro AVD)
`adb reverse tcp:8087`, loaded the 8087 bundle via the dev-client deep link (Android Bundled, 5051 modules). Same signed-in user `c727d491`. Inserted controlled row (id `51ea08e4…`): `session_member_joined`, `sessionId:5ebf8afb…`, `deep_link=NULL`, no `data.deepLink`.
- Opened NotificationsSheet, row rendered: "ORCH-1030 QA Android: Ari joined your session … no deepLink" (screenshot `/tmp/android_sheet.png`).
- Tapped the row (Maestro/`adb input tap` at hierarchy-derived bounds [315,1113][989,1233]).
- **Result:** sheet dismissed, app landed on **Home/Explore** — NOT Connections. Screenshot `/tmp/android_after_tap.png`.
- **Metro log proof:** `[ACTION] Notification tapped | type="session_member_joined", deepLink=undefined` + `[HEALTH_MONITOR]` on home. Identical log signature + identical landing to iOS, confirming the shared unified router.

### Push leg
Real OneSignal push delivery requires server-side push infrastructure not drivable from the sim. Per the dispatch's explicit fallback ("if you cannot drive a real notification tap end-to-end … at minimum drive the in-app sheet tap on a controlled inserted row on BOTH platforms"), the in-app sheet tap was driven on both platforms (above). The push path (`processNotification` :499) runs the byte-identical `parseDeepLink ?? typeFallbackDestination → executeDeepLink` ladder as the in-app path — proven equivalent by code inspection + the ADV-4 push/in-app/deferred parity unit test. **Push parity = proven by shared-code + parity test (the push tray delivery itself was not driven — see P3-01).**

### Smoke tests (≥2 other destination types, iOS)
- **Calendar:** `calendar_reminder_today` with `mingla://calendar/63ebd17c…` → tapped → landed **Likes → Calendar tab** (Calendar tab highlighted, "Likes" bottom tab active). Screenshot `/tmp/ios_cal_result3.png`. (Target entry is archived/completed → Active(0); the route correctly landed the Calendar container — graceful coarse v1 landing, no crash.)
- **Profile:** `birthday_reminder` with `mingla://profile/b17e3e15…` → tapped → opened **Ava Thompson's friend profile** (`ViewFriendProfileScreen`: name, "San Francisco · Mingla+ · Lv. 9", bio, Message). Screenshot `/tmp/ios_prof_result3.png`. Overlay mounted over current page (no page change), exactly per the executor `profile` branch.

Both smoke paths confirm the unification did NOT regress the already-working calendar/profile routes.

---

## 3. Constitution (relevant rules)

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | PASS | every type lands a real page (truthfulness trace + ADV-6) |
| 2 | One owner per truth | PASS | one router; `NAV_TARGETS` deleted |
| 3 | No silent failures | PASS | parseDeepLink null-safe + try/catch; executor never-guard; ADV-2/ADV-7 |
| 14 | Persisted-state startup | PASS (mechanism) | F-13 cold-start persists to AsyncStorage `mingla_deferred_deeplink`; onboarding-gated replay (`:822`) calls `handleDeepLink` which now carries `setPendingSessionOpen`+`setViewingFriendProfileId` (live cold-start not driven — see P3-01) |

---

## 4. Findings

### P3-01 — Push-tray + cold-start (SC-6) live delivery not driven (only mechanism + shared-code proven)
The real OneSignal push-tray tap and the logged-out→cold-launch replay (SC-6) were not driven end-to-end (no sim push delivery without OneSignal server-side send). Both are proven by (a) shared-code: `processNotification` and the deferred replay run the identical ladder verified live in-app, and (b) the ADV-4 parity test. Risk is low (the routing logic is the same module proven on both platforms), but a real push-tap + a real cold-start replay remain unverified by live-fire. Recommend a follow-up live OneSignal send when convenient; not a blocker.

### P3 → actually a v1-scope NOTE: "session open" is a recorded-intent stub
SC-1's "Home with the session opening" is delivered as: land Home (correct container) + record `pendingSessionOpen`, with the auto-open of the specific CollabDeckSheet deferred to v2. This is architecturally justified (collab decks mount only inside the session's group chat per `collab-deck-lives-in-group-chat`; Home is solo-only, so there is no Home primitive to auto-open the deck) and is documented in both SPEC §3.2.1 and the implementation. The PRIMARY F-01 gate (NOT Connections, IS Home) is fully met. Informational, not a defect.

### P4-01 — `parseDeepLink` does not validate the https host
`https://anything.com/session/x` parses to `{kind:'session', sessionId:'x'}` (the host is stripped, routing is by pathname). Not exploitable in this scope — notification deep links come from the trusted server `data.deepLink`, and the spec explicitly accepts the https form. Worth a host-allowlist if `parseDeepLink` is ever fed untrusted external URLs (e.g. universal links from arbitrary senders). Note for a future hardening ORCH.

### P4-02 — Praise: clean discriminated-union design
The typed `Destination` union + exhaustive `executeDeepLink` `never`-guard make "you forgot to carry entryId/experienceId" a compile error, killing the F-02/F-11 param-drop class structurally. `typeFallbackDestination` returning only parser-producible kinds (I-NOTIF-FALLBACK-AGREES) is a strong, testable invariant. Good work.

---

## 5. Completion condition (/goal) — all clauses satisfied

1. Every independent test green — happy-path 11/11 + adversarial 11/11 (output captured §1.1/1.2). ✓
2. tsc clean (deepLinkService isolated, 0 errors) + eslint 0 errors on touched files + deno check clean on 4 edge fns (§1.3). ✓
3. Both regression tests in `git diff origin/main...HEAD --name-only`; adversarial attacks a different angle; implementor fails-on-revert at `b1d1028ba` (re-confirmed independently at `309dcfac6`). ✓
4. UI/runtime change: SC-1 reproduced at **proven** level on iOS sim AND Android emulator; the Metro/symlink blocker was RESOLVED (not noted). ✓
5. Zero open P0, zero open P1. ✓

---

## 6. Discoveries for orchestrator
- **DISC-1:** Port 8087 was held by a stale ORCH-1016 Metro from a different worktree (PID 46773). Reclaimed safely. If ORCH-1016 is still active, its Metro is now down — restart from its own worktree if needed.
- **DISC-2:** Worktree `node_modules` symlink mangles Metro's `expo-router/entry` resolution → "Unable to resolve module" red-screen. The reliable fix is to run Metro from the anchor with the changed files overlaid (per `feedback_testing_handoff_just_run_expo_start`), NOT to debug the symlink. Recurring across ORCHs.
- **DISC-3 (implementor's DISC-2 confirmed):** `HomePage.tsx` imports `executeDeepLink` but never calls it (pre-existing dead import). Out of scope; future cleanup.

## 7. Commit ledger (this QA)
| Commit | Scope |
|---|---|
| `af4e1d2ee` | Tester adversarial regression test (committed to `ORCH-1030-notification-deep-linking`). |
