# SPEC — ORCH-1030 [Consumer app notification deep-linking]

**Mode:** SPEC (contract for the implementor; no product code written here)
**Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1030-[notification-deep-linking]/` on branch `ORCH-1030-notification-deep-linking`
**Source of truth:** `Mingla_Artifacts/reports/VERIFICATION_ORCH-1030_NOTIFICATION_DEEP_LINKING.md` (this session's independent verification — supersedes the prior INVESTIGATION on the F-04/F-08 points and the DB-data claim).
**Architecture chosen (Part 2 winner):** ONE canonical pipeline — server `data.deepLink` → ONE `parseDeepLink → Destination (typed union)` → ONE `executeDeepLink(Destination, handlers)`, consumed identically by the in-app sheet tap AND the OneSignal push tap; `NAV_TARGETS` demoted to a typed `typeFallbackDestination`; the 5 in-app special-cases deleted and folded into parser routes. Reflects the WINNING architecture, not the prior proposal's "keep the special-cases" framing.

---

## 1. Goal (locked)

Every consumer-app notification (in-app sheet row tap AND OneSignal push tap, iOS + Android) opens the **right screen + right container**: the correct session/board, conversation thread, calendar entry, person's profile, or coarse-but-correct fallback page. Auto-scroll to the exact card/message inside a container is **OUT of scope for v1**. The collaboration/session → wrong-tab misroute (F-01) is **IN scope and is the primary acceptance gate**.

## 2. Scope / Non-goals / Assumptions

**Scope:**
- Unify in-app + push + deferred routing onto one `parseDeepLink/executeDeepLink` pipeline with a typed `Destination` output.
- Fix F-01 (session/collab → Connections), F-02 (Likes never gets params), F-06 (3-authority disagreement), F-07 (friend-request panel), F-11 (review downgrade), F-13 (cold-start push deep link not persisted).
- Add parser routes: `profile/{userId}` (Ruling 1), accept query-form `session?id=` (latent-but-cheap), fix `review/{experienceId}` to carry the entity.
- Wire `setPendingSessionOpen` + `setViewingFriendProfileId` into the push + deferred handler objects.
- Backend: correct `data.deepLink` for `birthday_reminder`, `holiday_reminder` (→ `profile/{id}`) and `board_message_received` (→ `chat/{conv}`), and have those callers pass top-level `deepLink` so `notify-dispatch` fills the `deep_link` column.

**Non-goals (explicit):**
- Auto-scroll to a specific card/message within a container (v2).
- Order/refund/ticket buyer transactional push taps — VERIFIED separate pipeline (`ticket_order_notifications` via `ticket-confirmation-dispatch`); not the consumer inbox (Ruling 2). The `orders/{id}` parser-null stays latent.
- Event/experience-detail route — no consumer notification targets one today (de-scoped; latent follow-up).
- Business app, buyer-web, admin-web (see Cross-Surface Impact).
- A DB enum/CHECK on `notifications.type` (F-09) — optional drift-prevention follow-up, not required for v1.

**Assumptions (proven, not assumed):**
- `notify-dispatch/index.ts` is the single insert + push site for all in-scope consumer types (read in full: SESSION_SCOPED_TYPES `:145-155`, typeToPreference `:158-194`, insert `:299-341`, push `:473-521`).
- The client reads `data.deepLink`/`notification.data?.deepLink` only — the `deep_link` column never reaches the device. The column fix is for data hygiene, not routing.
- `ViewFriendProfileScreen` renders an arbitrary user by id today (`index.tsx:2353-2356`), gated by `viewingFriendProfileId` state; `setViewingFriendProfileId` already declared in `NavigationHandlers` (`deepLinkService.ts:20`).

---

## 3. Layer-by-layer contract

### 3.1 Shared router — `app-mobile/src/services/deepLinkService.ts`

**🔒 LOCKED — typed Destination union (new):**
```ts
export type Destination =
  | { kind: 'session'; sessionId: string }
  | { kind: 'conversation'; conversationId?: string; eventId?: string; orderId?: string; claimToken?: string; chatType?: 'direct' | 'group' }
  | { kind: 'profile'; userId: string }
  | { kind: 'calendarEntry'; entryId: string }
  | { kind: 'review'; experienceId: string }
  | { kind: 'pairedDeck' }                 // mingla://discover?paired=true
  | { kind: 'page'; page: 'home' | 'discover' | 'connections' | 'likes' | 'saved' | 'profile' | 'onboarding' }
  | { kind: 'paywall' };
```
`parseDeepLink(url: string): Destination | null` — returns `null` on unknown/garbled input (caller falls back to `typeFallbackDestination`).

**🔒 LOCKED — parser route changes:**
- `session/{id}` AND query-form `session?id={id}` → `{ kind:'session', sessionId }`. (Today only path-form parses — `:58-62`; tag-along emits query-form.)
- `profile/{userId}` → `{ kind:'profile', userId }`. (NEW — Ruling 1. Bare `profile` with no id → `{kind:'page', page:'profile'}`.)
- `messages/{id}`, `chat/{id}?type=…&eventId=…`, `orders/{id}/chat?token=…` → `{ kind:'conversation', … }`.
- `calendar/{id}` → `{ kind:'calendarEntry', entryId }`.
- `review/{id}` → `{ kind:'review', experienceId }`. (Executor MUST carry experienceId — see 3.2.)
- `discover?paired=true` → `{ kind:'pairedDeck' }`; bare `discover` → `{kind:'page', page:'discover'}`.
- `subscription` → `{ kind:'paywall' }`; `home/connections/likes/saved/onboarding` → `{kind:'page', …}`.
- `orders/{id}` without `/chat` → `null` (latent; documented).

**🔒 LOCKED — `executeDeepLink(dest: Destination | null, handlers): void`:**
- `null` → no-op (caller runs `typeFallbackDestination`).
- `session` → `handlers.setPendingSessionOpen?.(sessionId); handlers.setCurrentPage('home')`.
- `conversation` → `handlers.setDeepLinkParams({ tab:'messages', ...ids }); handlers.setCurrentPage('connections')` (ConnectionsPage effect `:2031` opens the thread).
- `profile` → `handlers.setViewingFriendProfileId?.(userId)` (overlay mounts; no page change needed — `viewingFriendProfileId` overlays whatever page).
- `calendarEntry` → `handlers.setDeepLinkParams({ tab:'calendar', entryId }); handlers.setCurrentPage('likes')`.
- `review` → `handlers.setDeepLinkParams({ tab:'calendar', experienceId }); handlers.setCurrentPage('likes')` (v1 coarse: land Likes→Calendar; opening the review modal by id = documented v2). MUST NOT drop `experienceId`.
- `pairedDeck` → `handlers.setDeepLinkParams({ paired:'true' }); handlers.setCurrentPage('discover')`.
- `page` → `handlers.setCurrentPage(page)`. `paywall` → `handlers.setShowPaywall?.(true)`.

**🔒 LOCKED — `NavigationHandlers`** must include `setPendingSessionOpen?`, `setViewingFriendProfileId?`, `setDeepLinkParams?`, `setShowPaywall?`, `setCurrentPage` (all already declared except confirm they're passed at every call site — see 3.2).

**🎨 OPEN:** internal helper structure of the parser (regex vs manual split), how `typeFallbackDestination` is organized (table vs switch), naming of the union file. The implementor may colocate `Destination` + `typeFallbackDestination` in the service or a sibling module.

### 3.2 Orchestration — `app-mobile/app/index.tsx`

**🔒 LOCKED:**
1. **DELETE F-01 misroute:** remove the `} else if (type.startsWith('collaboration_') || type.startsWith('session_')) { setCurrentPage('connections'); }` branch (`:1068-1069`). Collab/session with no deepLink must resolve via `typeFallbackDestination` → `{kind:'session'|'page:home'}` → Home (+ open session if id present in `data.sessionId`).
2. **DELETE the 5 in-app special-cases** (`:1022-1051`: paired_user_saved_card, paired_user_visited/holiday_reminder, friend_request_received/friend_request, pair_request_*, direct_message_*+actor). Their behavior is now expressed by parser routes (`profile/{id}`, `pairedDeck`, `conversation`) so `data.deepLink` is canonical. (Keep ONLY a `direct_message_*`+actor_id fallback INSIDE `typeFallbackDestination` for the no-deepLink case, returning `{kind:'conversation'}` resolved via actor — i.e. preserve the working DM behavior as a fallback, not an override.)
3. **`handleNotificationNavigate`** becomes: `const dest = data?.deepLink ? parseDeepLink(deepLink) : null; executeDeepLink(dest ?? typeFallbackDestination(type, data), handlers)`. ONE ladder, deep-link-first, fallback-second. Handlers object MUST include `setPendingSessionOpen` and `setViewingFriendProfileId`.
4. **Push `processNotification`** (`:475-481`): same shape — `executeDeepLink(parseDeepLink(deepLink) ?? typeFallbackDestination(type, data), handlers)`. Handlers object MUST add `setPendingSessionOpen` + `setViewingFriendProfileId` (currently missing — this is why push session/profile taps fail). Delete the `paired_user_saved_card` push special-case (`:463-474`) — folded into `pairedDeck`/`profile` routes.
5. **Deferred replay** (`:785-788`): add `setPendingSessionOpen` + `setViewingFriendProfileId` to the handlers object (currently missing).
6. **`NAV_TARGETS`** (`:589-633`) → replaced by `typeFallbackDestination(type, data): Destination`. It MUST return the SAME `Destination` kinds the parser returns (so it can never disagree). Required mappings (LOCKED): collab/session* → `{kind:'session', sessionId:data.sessionId}` if id present else `{kind:'page',page:'home'}`; board_message_* → `{kind:'conversation', conversationId:data.conversationId}` if present else `{kind:'page',page:'home'}`; direct_message_* → `{kind:'conversation'}` via `data.conversationId`/actor; friend_*/pair_* → `{kind:'page',page:'connections'}`; paired_user_* → `{kind:'profile', userId:data.actor_id}` if present else `{kind:'pairedDeck'}`; calendar_*/visit_feedback → `{kind:'page',page:'likes'}`; trial_ending → `{kind:'paywall'}`; re_engagement*/weekly_digest → `{kind:'page',page:'home'}`; birthday/holiday → `{kind:'profile', userId:data.partnerId|actor_id}` if present else `{kind:'page',page:'connections'}`.
7. **F-13 cold-start persistence:** when `processNotification` runs with `!userIdRef.current` (`:417`), in ADDITION to `pendingDeepLinkRef`, persist `{url, ts}` to AsyncStorage `mingla_deferred_deeplink` (same key/shape the OS-link path uses at `:1654-1655`), so the cold-start tap rides the onboarding-gated replay at `:852-874`. The in-memory ref stays for the warm-process case.
8. **Pass `deepLinkParams` to `<LikesPage>`** at BOTH render sites (`:2196`, `:2465`): `deepLinkParams={currentPage === 'likes' ? deepLinkParams : null}` plus an `onDeepLinkHandled={() => setDeepLinkParams(null)}` (mirror the Connections/Discover memo pattern at `:1918-1924`).

**🎨 OPEN:** how `typeFallbackDestination` is imported/colocated; whether the handlers object is hoisted to a memo; micro-refactor of the three call sites into one shared `routeNotification(data)` helper (encouraged but not mandated).

### 3.3 Screen — `app-mobile/src/components/LikesPage.tsx`

**🔒 LOCKED:** add `deepLinkParams?: Record<string,string> | null` + `onDeepLinkHandled?: () => void` to `LikesPageProps` (`:36-78`). On mount/param-change: if `deepLinkParams?.tab === 'calendar'`, set `activeTab='calendar'` and select/highlight `deepLinkParams.entryId` if present (entry SELECT only — no scroll). Call `onDeepLinkHandled()` after consuming. Mirror the existing `navigationData`/`onNavigationComplete` consumption pattern (`:141-142`).

**🎨 OPEN:** whether to reuse the existing `navigationData` prop instead of a new `deepLinkParams` prop (implementor's call — both acceptable; if reusing, document it).

### 3.4 Screen — `app-mobile/src/components/ConnectionsPage.tsx`

**🔒 LOCKED:** no change to the chat deep-link effect (`:2031-2089` already consumes `conversationId`/`eventId`/`claimToken` correctly — VERIFIED).
**🎨 OPEN (F-07, optional):** honor `deepLinkParams.tab === 'requests'` to open the Requests panel for `friend_request_received` instead of the Friends panel. Include only if the implementor can do it cleanly; otherwise leave the coarse Connections landing (acceptable v1).

### 3.5 Backend — producers (independent deploy; ship after client)

**🔒 LOCKED:**
- `supabase/functions/notify-birthday-reminder/index.ts:206-213` — change `data.deepLink` from `mingla://discover` to `mingla://profile/{birthdayOwner.id}` AND add top-level `deepLink: "mingla://profile/{birthdayOwner.id}"` to the `callNotifyDispatch` payload (so `notify-dispatch:309` fills the column).
- `supabase/functions/notify-holiday-reminder/index.ts:146-152` — `data.deepLink` → `mingla://profile/{giftTargetUserId}` + top-level `deepLink`.
- `supabase/functions/notify-message/*` (board_message_received) — ensure `data.deepLink = mingla://chat/{conversationId}?type=group&sessionId=…` is set (live: 0/8 rows carry it) and passed top-level.
- General rule (LOCKED, documented as a code comment in `notify-dispatch`): callers MUST pass the deep link as the TOP-LEVEL `deepLink` field (not only nested in `data`) so both `data.deepLink` and the `deep_link` column are populated.

**🎨 OPEN:** whether to also backfill the 47 historical rows' `deep_link` column (low value — they already have `data.deepLink` which is what routes; skip unless trivial).

---

## 4. Success criteria (observable / testable / unambiguous)

- **SC-1 (PRIMARY GATE):** A `session_member_joined` notification with NO `data.deepLink`, tapped from the in-app sheet, lands on **Home with the session open** (today: Connections). Same notification tapped from the push tray lands identically on Home+session. Verified on iOS sim AND Android emulator.
- **SC-2:** A `collaboration_invite_received` / `board_card_*` notification with `data.deepLink = mingla://session/{id}` opens **Home + that session** from both in-app and push.
- **SC-3:** A `calendar_reminder_today/tomorrow` notification opens **Likes → Calendar tab**, with `entryId` selected/highlighted (in-app + push).
- **SC-4:** A `direct_message_received` / `board_message_received` notification opens the **correct conversation thread** (in-app + push). board_message_received with the corrected producer link opens the group thread.
- **SC-5:** A `birthday_reminder` / `holiday_reminder` / `paired_user_saved_card` / `friend_request_accepted` notification opens the **target person's profile** (`ViewFriendProfileScreen` by id) from both in-app and push.
- **SC-6:** A push tapped while logged out that triggers a COLD app launch, after auth+onboarding completes, navigates to the notification's destination (F-13) — proven by AsyncStorage persistence + onboarding-gated replay.
- **SC-7:** A malformed/unknown `data.deepLink` (e.g. `mingla://garbage`) never crashes and never blanks — `parseDeepLink` returns null → `typeFallbackDestination` lands the correct tab; a stale session id degrades gracefully to Home.
- **SC-8:** In-app and push handlers produce the SAME `Destination` for every type (no 3-authority disagreement) — provable by unit test asserting `parseDeepLink ?? typeFallbackDestination` is identical across both call paths for all 12 live types.
- **SC-9:** `referral_credited` / `trial_ending` / `re_engagement` continue to route correctly (regression guard).

## 5. Invariants

- **I-NOTIF-ONE-ROUTER (new):** exactly one `parseDeepLink`/`executeDeepLink` pipeline; in-app, push, and deferred-replay all call it; no per-type navigation ladder outside `typeFallbackDestination`. Strict-grep gate: `setCurrentPage('connections')` must NOT appear inside `handleNotificationNavigate`'s type-prefix region.
- **I-NOTIF-FALLBACK-AGREES (new):** `typeFallbackDestination` returns only `Destination` values the parser can also produce; CI/unit test asserts no `type` yields a fallback page that disagrees with its producer's deep-link page.
- **I-DEEPLINK-IN-ADDITIONALDATA (preserve):** the deep link is carried in the OneSignal `additionalData`/`data` object (survives foreground/background/cold tap) — never only in the `deep_link` column (which never reaches the device).
- **I-PERSISTED-STATE-STARTUP (preserve, Constitution #14):** cold-start push deep link persists to AsyncStorage and replays only after `isAuthenticated && !showOnboardingFlow` + 24h staleness discard.
- **I-NO-SILENT-FAILURE (preserve, Constitution #3):** `parseDeepLink` null + fallback must always land somewhere; no dead tap.

## 6. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | session no-deeplink in-app (PRIMARY) | `session_member_joined`, `data:{sessionId}` no deepLink, in-app tap | Home + session open | index handler + parser |
| T-02 | session no-deeplink push | same, push tap | Home + session open (parity w/ T-01) | processNotification |
| T-03 | session w/ deeplink | `mingla://session/{id}` | Home + session open | parser+executor |
| T-04 | tag-along query-form | `mingla://session?id={id}` | Home + session open | parser |
| T-05 | calendar reminder | `mingla://calendar/{id}` in-app+push | Likes→Calendar, entry selected | LikesPage |
| T-06 | review | `mingla://review/{expId}` | Likes→Calendar (coarse), experienceId not dropped | executor+LikesPage |
| T-07 | DM thread | `mingla://messages/{conv}` in-app+push | conversation thread opens | ConnectionsPage effect |
| T-08 | board message | `mingla://chat/{conv}?type=group` | group thread opens | ConnectionsPage effect |
| T-09 | profile by id | `mingla://profile/{userId}` in-app+push | ViewFriendProfileScreen for userId | parser+executor |
| T-10 | birthday → profile | `birthday_reminder` corrected producer | friend's profile | backend + client |
| T-11 | malformed link | `mingla://garbage` | no crash, fallback by type | parser null path |
| T-12 | stale session id | `mingla://session/{deleted}` | Home (graceful degrade) | executor |
| T-13 | cold-start logged-out push | tap push while signed out → cold launch → sign in + onboard | lands destination | AsyncStorage replay |
| T-14 | fallback==parser parity | all 12 live types | `typeFallbackDestination` page == producer deepLink page | unit |
| T-15 | regression | `trial_ending`, `re_engagement`, `referral_credited` | paywall / home / profile-subscription | regression |

## 7. Implementation order

1. `deepLinkService.ts` — `Destination` union, parser routes (`profile/{id}`, query-form session, review carries id), executor branches, `typeFallbackDestination`.
2. `index.tsx` — delete F-01 branch + 5 special-cases; rewrite `handleNotificationNavigate` + `processNotification` + deferred-replay to the one-router shape; add `setPendingSessionOpen`+`setViewingFriendProfileId` to all 3 handler objects; F-13 AsyncStorage persistence; pass `deepLinkParams` to `<LikesPage>`.
3. `LikesPage.tsx` — consume `deepLinkParams` → Calendar tab + entry select.
4. (optional) `ConnectionsPage.tsx` — `tab=requests` panel.
5. Backend producers — birthday/holiday → `profile/{id}` + top-level deepLink; board_message → `chat/{conv}` + top-level.
6. Unit tests T-14/T-11; then live-fire sim T-01/T-02.

## 8. Regression prevention

- Strict-grep CI gate for I-NOTIF-ONE-ROUTER (no stray `setCurrentPage('connections')` in the collab/session prefix region).
- Unit test (T-14) locks fallback==parser agreement so a new type can't reintroduce the 3-authority drift.
- Protective comment in `notify-dispatch` documenting the top-level-`deepLink` requirement (column + data parity).

## 9. Cross-Surface Impact

| Surface | Covered? | Behavior / files / parity |
|---|---|---|
| **Consumer iOS** (`app-mobile/` iOS) | YES | All SCs. Shared client code → parity automatic with Android, BUT the live-fire gate (SC-1) is per-platform (manual): **SC-1-iOS** + **SC-1-Android** are separate gates. OneSignal cold-start (SC-6) verified on both. Files: `deepLinkService.ts`, `index.tsx`, `LikesPage.tsx`, `ConnectionsPage.tsx`. |
| **Consumer Android** (`app-mobile/` Android) | YES | Same shared code; SC-1-Android is its own acceptance gate (Android push tray cold-start behavior differs from iOS). |
| **Buyer/anonymous Web** | NO | No notification inbox, no push registration — nothing to deep-link into. |
| **Business iOS / Android** (`mingla-business/`) | NO | Separate OneSignal app id + `mingla-business://` scheme + `business.*`/`stripe.*` types filtered out of the consumer inbox; entirely separate routing code. |
| **Admin Web** (`mingla-admin/`) | NO | Does not render the consumer `notifications` feed; not a tap consumer. |
| **Business Web preview** | NO | No consumer notification surface. |

Parity is automatic (shared `app-mobile/` code) EXCEPT the live-fire sim gate, which is manual per platform → **SC-1-iOS and SC-1-Android are distinct success criteria** the tester must each prove; "code is the same" is NOT a valid skip.

## 10. External-API contract (OneSignal — COMMS-0003)

No new OneSignal payload field is introduced. The deep link rides the existing `additionalData`/`data` object (`notify-dispatch:475-481`), which the v5 click listener (`OneSignal.Notifications.addEventListener('click', e => e.notification.additionalData)`) surfaces on foreground/background/cold taps. Doc URLs (cited inline per COMMS-0003): click/event handlers https://documentation.onesignal.com/docs/sdk-notification-event-handlers ; additional data https://documentation.onesignal.com/docs/data-notifications ; RN SDK lifecycle https://documentation.onesignal.com/docs/react-native-sdk . The F-13 cold-start persistence requirement is grounded in the documented "click fires after app launch; queued on cold start" behavior.
