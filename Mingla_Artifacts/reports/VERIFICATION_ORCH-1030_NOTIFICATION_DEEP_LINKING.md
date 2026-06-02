# VERIFICATION — ORCH-1030 [Consumer app notification deep-linking]

**Mode:** Adversarial INVESTIGATE(verification) — independent re-proof of the prior report
**Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1030-[notification-deep-linking]/` on branch `ORCH-1030-notification-deep-linking`
**Posture:** brutal skeptic. Prior report (`reports/INVESTIGATION_ORCH-1030_NOTIFICATION_DEEP_LINKING.md`) treated as a list of CLAIMS to falsify, each re-proven against code at the cited line + a fresh read-only DB probe.
**Surfaces in scope:** Consumer iOS + Consumer Android (`app-mobile/`) only.

---

## Phase 0 — Context ingested + COMMS ack

- **Comms ledger** (`/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`): scanned Active entries. **COMMS-0003** (WARN, `to: ALL`) — every external-API integration ORCH must cite provider docs URLs inline at SPEC time. **ACKNOWLEDGED**; this ORCH touches the OneSignal push payload, so Part 4 cites OneSignal docs inline and the SPEC §EXTERNAL-API carries the doc URLs. No `BLOCK` row addressed to this ORCH or to `mingla-forensics`.
- **Prior artifacts read for context:** the prior ORCH-1030 investigation (the claim set), plus the V2 notifications history in `index.tsx` git blame (`f224813f` Notifications V2, `4aec5afd` OneSignal Android push fix, `0f28e441` deep-link executor wiring).
- **Migration/producer chain:** the authoritative notification producer is `supabase/functions/notify-dispatch/index.ts` (548 lines, read in full). It is the single insert site for the consumer `notifications` table and the single OneSignal push site for these types.

---

## A NOTE ON METHOD (why this verdict diverges materially from the prior report)

The prior report's **central data claim is FALSE.** It states (Phase 2, §Coverage note, F-15, Confidence): *"rows_with_deeplink = 0 … the `deep_link` COLUMN is empty for every row … Producers write the URL into `data.deepLink` (JSONB), not the `deep_link` column."* It then built F-08 ("orphan types — no creator found") and F-04 ("birthday/holiday created with NO deep_link") on top of incomplete greps.

My independent live probe (Supabase Management API, project `gqnoajqerqhnvulmnyvv`, read-only):

```
SELECT COUNT(*) total, COUNT(deep_link) col_nonnull,
       COUNT(NULLIF(data->>'deepLink','')) data_deeplink, COUNT(DISTINCT type) types
FROM public.notifications;
-> [{ total_rows: 107, nonnull_deep_link_column: 0, nonnull_data_deeplink: 47, distinct_types: 12 }]
```

So: the **column** is indeed 0/107 (that half is true), but **47 of 107 rows DO carry `data.deepLink`** — not zero. And reading `notify-dispatch` in full shows it writes BOTH (`index.ts:307` `data: { ...data, deepLink: deepLink || null }` AND `index.ts:309` `deep_link: deepLink || null`). The column is null **because callers pass the deep link nested inside `data` rather than as the top-level `deepLink` param** (e.g. `notify-birthday-reminder/index.ts:206-213` sends `data: { deepLink: "mingla://discover", ... }` with no top-level `deepLink`). That is a real, precise bug — but it is NOT "the column is dead by design / producers don't write it," which is what the prior report concluded.

This single error cascaded: the per-type DB sample below shows session_member_joined, board_card_saved, etc. **DO have producers and DO carry deepLinks**, refuting F-08 wholesale.

Per-type live breakdown (read-only):

| type | n | with data.deepLink | sample deepLink |
|---|---|---|---|
| paired_user_saved_card | 44 | 12 | `mingla://discover?paired=true` |
| session_member_joined | 22 | 14 | `mingla://session/007877f9-…` |
| board_message_received | 8 | 0 | null |
| friend_request_accepted | 6 | 6 | `mingla://connections?userId=1bb79276-…` |
| pair_request_accepted | 6 | 4 | `mingla://discover` |
| direct_message_received | 5 | 4 | `mingla://messages/66652f38-…` |
| collaboration_invite_received | 5 | 3 | `mingla://session/0d64ca0f-…` |
| board_card_saved | 4 | 4 | `mingla://session/0d64ca0f-…` |
| direct_card_message | 3 | 0 | null |
| pair_request_received | 2 | 0 | null |
| stripe_webhook_signature_failure | 1 | 0 | null (ops, not consumer) |
| friend_request_received | 1 | 0 | null |

---

## PART 1 — Per-claim verdict table (CONFIRMED / REFUTED / REVISED)

Evidence is six-field where the claim is load-bearing. File paths are absolute under the worktree `app-mobile/` unless noted.

### The four load-bearing claims the dispatch named explicitly

**C-1 — "F-01: collab_/session_ in-app handler routes to Connections; PUSH NAV_TARGETS says Home; they contradict."**
**Verdict: CONFIRMED (the most important real bug).**
- `app/index.tsx:1068-1069`: `} else if (type.startsWith('collaboration_') || type.startsWith('session_')) { setCurrentPage('connections'); }` — the in-app type-prefix fallback routes collab/session to **Connections**.
- `app/index.tsx:600-607`: `NAV_TARGETS` maps `collaboration_invite_*` and `session_member_joined/_left/session_deleted` all to **`"home"`**.
- The contradiction is real: the SAME notification, tapped from the in-app sheet with no `data.deepLink`, goes to Connections; tapped from the system tray, goes to Home. Collab/session UI mounts from Home (the parser's `session` case returns `page:'home'` at `deepLinkService.ts:58-62`), so Connections is wrong.
- **Reachability of the fallback (this matters for scope):** 8 of 22 live `session_member_joined` rows have NO `data.deepLink` (`no_dl=8`), so the fallback at 1068 IS hit in production — this is not a theoretical path.

**C-2 — "Three systems decide routing and disagree (server data.deepLink vs in-app handler vs push NAV_TARGETS). Is the in-app handler already deep-link-first?"**
**Verdict: REVISED — three authorities exist, but the precedence is NOT what the prior report implies. The in-app handler is special-case-FIRST, then deep-link, then prefix-fallback. It is NOT deep-link-first.**
Exact in-app precedence, proven at `app/index.tsx:1017-1082`:
1. `paired_user_saved_card` special-case (1022) → Connections + friend profile — **overrides** `data.deepLink` (which is `mingla://discover?paired=true`).
2. `paired_user_visited` / `holiday_reminder` special-case (1027) → Connections + friend profile — **overrides** deepLink (`mingla://discover`).
3. `friend_request_received` / `friend_request` special-case (1034) → Connections + Friends panel — **overrides** deepLink (`connections?userId=`).
4. `pair_request_received` / `pair_request_accepted` special-case (1041) → Connections — **overrides** deepLink (`mingla://discover`).
5. `direct_message_*` + actor_id special-case (1047) → opens DM thread — this one AGREES with intent.
6. **THEN** deep-link (1054): `if (deepLink) { executeDeepLink(parseDeepLink(deepLink)) }`.
7. **THEN** type-prefix fallback (1065-1082).
   The push handler (`processNotification`, 413-486) is different again: it special-cases ONLY `paired_user_saved_card` (463), then deep-link (475), then `NAV_TARGETS` fallback (482). So there are genuinely **three disagreeing authorities** AND the two client handlers disagree with each OTHER on the same type (e.g. `holiday_reminder`: in-app → friend profile via special-case; push → `NAV_TARGETS` "connections" tab only). The prior report's "three systems disagree" headline is CONFIRMED, but its claim that the in-app handler is "already deep-link-first with prefix only a fallback" is **REFUTED** — five hard-coded special-cases sit ABOVE the deep-link branch and actively override the server's link.

**C-3 — "deep_link column empty on all rows; routing rides data.deepLink instead." (re-run the probe)**
**Verdict: REVISED.** Column empty: CONFIRMED (0/107). "Routing rides data.deepLink": CONFIRMED for the client (both handlers read `data.deepLink` / `notification.data?.deepLink`, never the column — `index.tsx:428`, `:1018`). BUT the prior framing "producers write to data.deepLink **not** the column" is **REFUTED** — `notify-dispatch/index.ts:307+309` writes BOTH; the column is null only because callers nest the link in `data` instead of passing top-level `deepLink`. Real numbers: **107 total, 0 column, 47 data.deepLink, 12 types.** (Prior report said 0 data.deepLink in Phase 2 — wrong by 47.)

**C-4 — "Likes screen does NOT consume the calendar/review param (F-02/F-11)."**
**Verdict: CONFIRMED.**
- `components/LikesPage.tsx:36-78` `LikesPageProps` has no `deepLinkParams` / `entryId` / `tab` field (only `calendarEntries`, `onShowQRCode`, `userPreferences`, `navigationData`/`onNavigationComplete`). Internal `activeTab` is `useState` (no deep-link seed).
- `app/index.tsx:2196` and `:2465` (`<LikesPage>` render sites) pass NO `deepLinkParams` — grep-proven (the prop simply isn't on the element).
- Parser `calendar` case (`deepLinkService.ts:93-97`) returns `{page:'likes', params:{tab:'calendar', entryId}}`; executor `likes` case (`:153-156`) just `setCurrentPage('likes')` and the params are dropped at the screen boundary. So calendar reminders land Likes at its last-used tab, entry not opened. CONFIRMED.
- `review` variant (`deepLinkService.ts:163-165`): executor hardcodes `setCurrentPage('likes')` for `review` and drops `experienceId`. CONFIRMED.

### Corrections the dispatch asked me to re-prove

**C-5 — "chat/DM deep-links DO already open the thread in-app (prior correction). Confirm ConnectionsPage consumes conversationId."**
**Verdict: CONFIRMED.** `components/ConnectionsPage.tsx:350` declares `deepLinkParams?: Record<string,string> | null`; effect at `:2031-2089` runs when `deepLinkParams.tab === 'messages'`, resolves `conversationId` (or `claimToken`→`claimPendingTripChats`, or `eventId`→`getOrCreateGroupConversationForEvent`) and calls `handleSelectConversation(rawConversation)` → opens the thread, then `onDeepLinkHandled()`. `index.tsx:2190/2447` forward `connectionsDeepLinkParams` (gated on `currentPage==='connections'`, memo at `:1922-1924`). So `chat/`, `messages/`, and `orders/{id}/chat` deep-links open the right conversation in-app. CONFIRMED. (DM via the in-app row also has a second path: the `direct_message_*`+actor_id special-case at `index.tsx:1047` → `setPendingOpenDmUserId` → ConnectionsPage `openDirectMessageWithUserId`. Two paths, both work in-app.)

**C-6 — "The 7 orphan-routed-but-no-creator types (incl. session_member_joined): grep BOTH edge fns AND DB triggers/RPCs."**
**Verdict: REFUTED.** The prior report's F-08 ("no edge fn creates them; may be DB triggers or dead") is wrong. `notify-dispatch/index.ts` is the producer hub and explicitly enumerates these as live types:
- `SESSION_SCOPED_TYPES` set (`:145-155`): `session_member_joined, session_member_left, board_card_saved, board_card_voted, board_card_rsvp, board_card_matched, board_message_received, board_message_mention, board_card_message`.
- `typeToPreference` map (`:171-181`): the same set plus `session_deleted`.
- Live DB confirms they are minted and carry deepLinks: `session_member_joined` 22 rows / 14 with `mingla://session/{id}`; `board_card_saved` 4 rows / 4 with `mingla://session/{id}`. These are produced by session/board edge functions that POST to `notify-dispatch` (the dispatch hub is the single insert point; callers supply `type` + `data.deepLink`). **They are NOT orphans and NOT trigger-origin mysteries.** `collaboration_invite_sent` is the ONE entry in `NAV_TARGETS` (`index.tsx:604`) with no producer found in functions, migrations, or live data (0 rows) — that single key is genuinely vestigial. So: 6 of the 7 alleged orphans REFUTED (real producers + live rows), 1 (`collaboration_invite_sent`) CONFIRMED-vestigial. **Scope impact: the SPEC does NOT need to "find missing producers" for session/board types — they exist; it only needs to fix the client routing + backfill the missing deep links on the few types that nest-without-column or send a coarse target.**

### The remaining prior findings, re-proven

| Claim | Verdict | Evidence (file:line) |
|---|---|---|
| **F-02** deepLinkParams reaches Connections+Discover, NOT Likes | **CONFIRMED** | ConnectionsPage `:350/:558/:2031`; Discover `index.tsx:2140/2412`; LikesPage props `:36-78` lack it; `<LikesPage>` `index.tsx:2196/2465` pass none. |
| **F-03** DM push tap lands Connections tab not thread | **CONFIRMED** | `processNotification` has no `direct_message_`+actor special-case (only `paired_user_saved_card` at `:463`); push for `direct_message_received` deepLink `mingla://messages/{conv}` parses to `{page:'connections',params:{conversationId}}` → ConnectionsPage effect DOES consume it (`:2031`). **REVISED nuance:** because the producer DOES send `mingla://messages/{conv}` (live sample confirms: `direct_message_received` 4/5 rows carry it), the PUSH path actually opens the thread via the ConnectionsPage effect for those 4 rows. It fails only for the 1 row with no deepLink. So F-03 is **REVISED**: push DM is mostly fixed by the existing `messages/` parser+effect; the residual gap is the no-deepLink row + reliance on the effect rather than a dedicated push special-case. Severity downgraded from "broken" to "edge-case gap." |
| **F-04** birthday/holiday created with NO deep_link | **REFUTED** | `notify-birthday-reminder/index.ts:206-213` sends `data:{ deepLink:"mingla://discover", partnerId, pairingId, milestone }`; `notify-holiday-reminder/index.ts:146-152` sends `data:{ deepLink:"mingla://discover", ... }`. Both HAVE deep links. The REAL issue (REVISED finding): the link is the coarse `discover` page, not the friend's profile, and it's nested in `data` so the `deep_link` column stays null. Not "no deep link." |
| **F-05** NAV_TARGETS missing keys for several push types | **CONFIRMED (latent)** | `index.tsx:589-633` has no key for `board_card_matched, session_locked, direct_card_message, birthday_reminder, onboarding_incomplete, tag_along_*, installment_reminder`, order/ticket types. With `data.deepLink` present these still route via the parser; only types with NO deepLink AND no NAV_TARGETS key dead-end. |
| **F-06** in-app special-cases / NAV_TARGETS contradict producer deep_link | **CONFIRMED** | Proven in C-2 above: 5 in-app special-cases (`:1022-1044`) override `data.deepLink`; NAV_TARGETS `board_message_received:"home"` (`:615`) contradicts producer `mingla://chat/{conv}` (which the parser routes to connections+thread); `referral_credited` NAV_TARGETS `"home"` (`:628`) vs producer `mingla://profile?...`. |
| **F-07** friend-request panel mismatch | **CONFIRMED** | `index.tsx:1034-1037` forces `pendingConnectionsPanel='friends'` for `friend_request_received`; live producer deepLink is `connections?userId=` (accepted) / the requests panel is never opened by `tab=requests` (param dead). |
| **F-08** orphan types no creator | **REFUTED (6/7)** | See C-6. Only `collaboration_invite_sent` is vestigial. |
| **F-09** notifications.type has no DB enum/constraint | **CONFIRMED (observation)** | No CHECK/enum; type is free-text. True but low-severity; not a routing bug, a drift-prevention gap. |
| **F-10** no profile-by-id route, no event/experience-detail route in parser | **CONFIRMED** | `deepLinkService.ts:103-104` `profile` case ignores any id (opens own Profile); no `profile/{id}`, no `event`/`experience` case. The by-id friend profile screen DOES exist (`ViewFriendProfileScreen`, `index.tsx:32/2353-2356`, mounted by `viewingFriendProfileId` state) — reachable today only via the actor_id special-cases, not via a URL. |
| **F-11** review executor downgraded; experienceId never opens a review | **CONFIRMED** | `deepLinkService.ts:163-165`. |
| **F-12** tag-along `session?id=` query-form not parsed; `orders/{id}` returns null | **CONFIRMED (latent)** | Parser `session` reads `pathSegments[1]` (`:58-62`), so `mingla://session?id=X` yields `openSessionId=undefined`. No live consumer rows for tag-along/orders in the inbox today → latent. |
| **F-13** push-tap deferral is in-memory-only (pendingDeepLinkRef), not the persistent onboarding-gated path | **CONFIRMED** | Push defer: `index.tsx:417-424` writes `pendingDeepLinkRef.current` (in-memory), replayed at `:766-794` (gated on `user?.id` only, NOT onboarding). OS-link defer: `:1654-1655` persists to AsyncStorage `mingla_deferred_deeplink`, replayed at `:852-874` (gated on `isAuthenticated && !isLoadingAuth && !showOnboardingFlow` + 24h staleness). Two mechanisms; push path is weaker (lost on cold start). CONFIRMED. |
| **F-15** deep_link column dead for consumer | **REVISED** | Column IS 0/107, but `notify-dispatch` WRITES it (`:309`); it's null because callers nest in `data`. "Dead by design / intended for business app" is REFUTED. |
| **F-16** order/refund money notifications are a separate buyer pipeline (ticket_order_notifications), not the consumer inbox | **CONFIRMED** | No order/refund rows in the 12 live consumer types; they ride `ticket-confirmation-dispatch` (deployed, confirmed in function list). Out of consumer-inbox scope. |

**Tally: 16 prior findings reassessed → 9 CONFIRMED, 2 REFUTED (F-04, F-08), 5 REVISED (the 3-authority precedence, the DB data claim/F-15, F-03 severity, plus the column-cause). The reported headline bug (F-01) is CONFIRMED and is the correct primary target. The architecture root-cause framing is broadly right but rests on two false sub-claims that the SPEC must NOT inherit.**

---

## PART 2 — Architecture challenge: the winning approach

The prior report proposed **(a)**: make server `data.deepLink` the single canonical authority, one shared `parseDeepLink`/`executeDeepLink` for in-app + push, reduce `NAV_TARGETS` to a no-link fallback that agrees with the parser. I evaluated all four named alternatives against correctness, auto-coverage, blast radius, future-proofing, and malformed/stale failure mode.

**(b) Use the dedicated `deep_link` COLUMN instead of `data.deepLink`.** REJECTED. The column is 0/107 and the client reads `data.deepLink` everywhere (`index.tsx:428`, `:1018`; push payload merges `data` not the column at `notify-dispatch:475`). Reviving the column means changing the push payload contract (push `data` is what OneSignal delivers; the column never reaches the device) AND backfilling 47 rows AND rewriting both client read sites — strictly more churn than standardizing on `data.deepLink`, which is already the de-facto device contract. The column cannot even reach a push tap (it's a DB column, not part of the OneSignal `additionalData`). Hard fail on "must work for push."

**(c) Pure client-side routing keyed off (type + related_id/actor_id), server sends no link.** REJECTED as the primary, but its best idea is ADOPTED as a fallback layer. Pro: removes the "missing/nested deepLink at creation" class entirely. Con: it duplicates the destination policy on the client for ~30 types, and the client must know each type's entity semantics (which id is the session vs the friend) — exactly the brittle per-type knowledge that produced today's 5 special-cases. It also can't express server-only context (e.g. which conversation a board message belongs to) without the server passing ids anyway. So it doesn't actually remove the server contract; it just moves the string-building to the client. **Adopt the half that's good:** the client fallback (when `data.deepLink` is absent/malformed) computes a destination from `type` + `data.{sessionId,conversationId,actor_id,related_id}` via a small typed table — this is what makes the no-deepLink rows (8 session_member_joined, board_message_received, etc.) land correctly without a backend deploy.

**(d) Typed route registry / discriminated union instead of string-URL parsing.** PARTIALLY ADOPTED. Full replacement of `mingla://` URLs is too much churn (URLs are also used by OS `Linking`, email CTAs, and OneSignal `url`/launch-URL; 47 live rows already carry `mingla://` strings). But the parser's OUTPUT should become a typed discriminated union (`type Destination = {kind:'session', sessionId} | {kind:'conversation', conversationId, …} | {kind:'profile', userId} | {kind:'calendarEntry', entryId} | {kind:'review', experienceId} | {kind:'page', page} …`) so the executor and every screen consume a typed contract, not a loose `Record<string,string>`. This kills the "param silently dropped at the screen" class (F-02/F-11) by making each destination's required fields explicit and compiler-checked.

### WINNER: (a) as the spine, hardened with the typed-Destination output of (d) and the client-fallback table of (c).

One canonical pipeline: **server `data.deepLink` is the source of truth → ONE `parseDeepLink(url) → Destination (typed union)` → ONE `executeDeepLink(Destination, handlers)` → each screen consumes its typed slice.** Both the in-app sheet tap AND the OneSignal push tap call this same pipeline. `NAV_TARGETS` is demoted to a tiny `typeFallbackDestination(type, data)` used ONLY when `data.deepLink` is absent or `parseDeepLink` returns null, and it must return the SAME `Destination` shape so it can never disagree with the parser's page mapping. The five in-app special-cases are DELETED — their behavior is folded into the parser routes (`profile/{id}`, `discover?paired=…`) so the server link wins.

**Why it beats the others, point by point:**
- **Correctness:** removes the 3-authority disagreement at its root — there is exactly one destination function; in-app and push are guaranteed identical because they call the same code (today they're two hand-written ladders that drifted, which IS the F-01/F-06 bug).
- **Auto-coverage:** any type whose producer sets a correct `data.deepLink` is handled with zero client code — 47/107 live rows already qualify; the client-fallback table covers the no-deepLink remainder by entity id.
- **Blast radius:** client-only for the routing unification (no backend deploy required to fix F-01/F-02/F-06/F-07/F-11); two tiny backend deep-link corrections (birthday/holiday/board-message) are independent and can ship separately. Smaller than (b) (which rewrites the push contract) and smaller than (c)-as-primary (which re-implements 30 destinations).
- **Future-proofing:** a new notification type is covered the moment its producer sets a `data.deepLink` that matches an existing `Destination` kind; new kinds are one typed-union case + one executor branch + one screen-prop. The discriminated union makes "you forgot to consume entryId" a compile error.
- **Malformed/stale failure mode:** `parseDeepLink` returns `null` on unknown/garbled URLs → `executeDeepLink` no-ops the navigation and the client-fallback table runs off `type` → worst case lands the user on the correct tab (Home/Connections/Likes), never a crash, never a blank screen. Stale ids (deleted session) degrade to the container tab (Home) because the open-session call fails gracefully — strictly better than today's "wrong tab."

**If the prior proposal had been taken literally** (keep the 5 in-app special-cases as "where deep_link can't express the target") it would have preserved F-06's disagreement for `paired_user_*`, `holiday_reminder`, `pair_request_*`, and `friend_request_received`. The improvement here is: express those targets AS parser routes (`profile/{id}`, `discover?paired=true`) and DELETE the special-cases, so the server link is genuinely canonical. That is the loud correction to the prior architecture.

---

## PART 3 — Feasibility ledger (every destination: reachable-today / needs-build + mechanism)

The app uses a custom navigation state machine (`currentPage` setState + overlay flags), NOT React Navigation. For each destination the SPEC will require:

| Destination | Reachable today? | Mechanism / what's proven | Verdict for v1 |
|---|---|---|---|
| **Open a specific session/board container** | YES (full chain proven) | `deepLinkService.ts:58-62` parser `session/{id}` → `{page:'home', openSessionId}`; executor `:144-148` calls `setPendingSessionOpen(openSessionId)` + `setCurrentPage('home')`. `setPendingSessionOpen` is a declared handler; HomePage mounts the session/CollabDeckSheet from the pending-open state. The push handler already wires `setPendingSessionOpen`? **HALF:** the in-app + push executors pass `setShowPaywall`+`setDeepLinkParams` but the push call at `index.tsx:477-481` does NOT pass `setPendingSessionOpen` in its handlers object (only `setCurrentPage`,`setShowPaywall`,`setDeepLinkParams`), and the deferred-replay at `:785-788` also omits it. So push/deferred `session/{id}` taps reach Home but DON'T open the session. **Needs: add `setPendingSessionOpen` to the push + deferred handler objects.** Minimal. | INCLUDE. Fix is wiring one handler into two call sites + deleting the F-01 prefix-misroute. |
| **Open a specific DM / group conversation** | YES (full chain proven) | ConnectionsPage `:2031-2089` consumes `deepLinkParams{tab:'messages', conversationId|eventId|claimToken}` → `handleSelectConversation`. Parser `chat/`,`messages/`,`orders/{id}/chat` all produce it. | INCLUDE. Works in-app and push (push routes through same parser→connectionsDeepLinkParams). |
| **Open a specific calendar entry** | NO (param dropped at screen) | Parser `calendar/{id}` produces `{page:'likes', params:{tab:'calendar', entryId}}` but LikesPage has no `deepLinkParams` prop (`LikesPage.tsx:36-78`) and isn't passed any (`index.tsx:2196/2465`). LikesPage already HAS internal tab state + a `navigationData`/`onNavigationComplete` prop pattern (`:141-142`) it can mirror. **Needs: add `deepLinkParams` (or reuse `navigationData`) prop → seed `activeTab='calendar'` + select `entryId`.** | INCLUDE. Small, additive — mirror the existing ConnectionsPage prop pattern. Entry SELECT only (scroll = v2 per scope). |
| **Open a specific review** | NO (executor downgrades to likes, drops experienceId) | `deepLinkService.ts:163-165`. The review modal is triggered by `usePostExperienceCheck`, not a route. **Needs: either a `setPendingReviewExperienceId` handler that opens the review modal for `experienceId`, OR (cheaper) land Likes→Calendar tab as a coarse container.** | INCLUDE with a RULING: land Likes→Calendar (the entry the review is for) as the v1 container; opening the review modal by id is a small follow-up. Document the coarse fallback in the SPEC; do not silently drop experienceId. |
| **Open a specific PERSON'S profile by id** | PARTIAL — screen exists, no URL route | `ViewFriendProfileScreen` is mounted by `viewingFriendProfileId` state (`index.tsx:32, :2353-2356`); reachable today ONLY via the 3 actor_id special-cases (`:1022-1031`), not via any `mingla://` URL. **Needs: parser `profile/{userId}` case → `setViewingFriendProfileId(userId)` handler (add to NavigationHandlers).** The handler already exists as a setter. | INCLUDE (this is the Part-5 ruling #1 — see below). Minimal: one parser case + thread `setViewingFriendProfileId` into the executor handlers (already in the `NavigationHandlers` interface at `deepLinkService.ts:20`!). |
| **Open a specific EVENT/EXPERIENCE detail** | NO route; in-app trip overlay exists | `index.tsx:257` notes an "in-app trip detail overlay slot (mirrors viewingFriendProfileId)" (`viewingTrip`, ORCH-1016). No notification type currently targets an event/experience detail (none in the 12 live types). **Needs: net-new parser route + handler IF a producer ever targets one.** | DE-SCOPE for v1. RULING: no consumer notification type targets an event/experience detail today; building the route would be speculative. Register as a latent follow-up; revisit if/when a producer emits `mingla://event/{id}`. The trip-overlay slot proves the mechanism is cheap to add later. |

**No destination required for v1 needs a disproportionate new build.** The two genuine "needs-build" items (profile-by-id route, Likes param consumption) are each a single parser case + a handler that already exists as a setter. The session-open push gap is a one-line handler-object addition. Everything else is reachable today.

---

## PART 4 — External-API correctness (OneSignal — COMMS-0003)

OneSignal React Native SDK v5 (the app's SDK; `index.tsx:59-61` imports `initializeOneSignal/loginToOneSignal/logoutOneSignal`, listeners via `onNotificationClicked`/`onForegroundNotification` wrappers). Verified against OneSignal docs:

- **Custom data field is `additionalData`.** A notification's custom key/value payload is delivered to the client as `notification.additionalData`. Mingla's server sends it as the REST `data` object (`notify-dispatch:475-481` builds `pushData = {...data, notificationId, type}` and passes it to `sendPush` as `data`), which OneSignal surfaces on the device as `additionalData`. The client wrapper normalizes this into the `data` arg of `onNotificationClicked((data)=>…)` (`index.tsx:652-655`). **The SPEC must keep the deep link inside this `data`/`additionalData` object** — it is the only channel that survives to the device on a tap. Doc: https://documentation.onesignal.com/docs/sdk-notification-event-handlers (click listener `OneSignal.Notifications.addEventListener('click', e => …)`; custom data via `additionalData`). https://documentation.onesignal.com/docs/data-notifications (additional data payload).
- **Click listener API (v5):** `OneSignal.Notifications.addEventListener('click', (event) => { /* event.notification.additionalData */ })`. The doc explicitly notes: *"Runs when a user clicks a push notification that opens the app. The app is already launched by the time this fires — do not relaunch or duplicate navigation."* Doc: https://documentation.onesignal.com/docs/sdk-notification-event-handlers.
- **Foreground / background / cold-start tap delivery:** the click event fires after the app is launched in all three states; for a cold start the SDK queues the click and delivers it once the listener is registered on launch. **This is exactly why F-13 matters:** Mingla registers the click listener inside a `useEffect([])` (`index.tsx:408-673`) that mounts before auth resolves, but on a cold launch the tap can fire BEFORE `userIdRef.current` is set (`:417`), so it stashes into the in-memory `pendingDeepLinkRef` — which is fine within the same process, but the SPEC must ensure the cold-start tap's deep link is persisted (AsyncStorage), mirroring the OS-link path, so it survives the auth+onboarding gate. Doc: https://documentation.onesignal.com/docs/react-native-sdk (lifecycle of click handlers across app states). The SPEC's persistence requirement is grounded in this documented cold-start behavior, not invented.
- **Payload fields the SPEC relies on (all already sent by `notify-dispatch`, none new):** `data.deepLink` (string `mingla://…`), `data.type` (string), `data.notificationId` (uuid), and the entity ids already in `data` (`sessionId`, `conversationId`, `actor_id`/`actorId`, `related_id`/`relatedId`). The SPEC introduces NO new OneSignal payload field — it only requires producers to populate `data.deepLink` correctly (and, for the column-fix, ALSO pass it top-level so `notify-dispatch:309` fills the column). **No OneSignal enum or endpoint changes.** Deep links survive foreground/background/cold per the docs above provided the link is in `additionalData` (it is) and the cold-start tap is persisted (the F-13 fix).

**COMMS-0003 satisfied:** every payload field the SPEC relies on is an existing OneSignal `additionalData` field, doc-cited inline above; no new external-API enum/shape is introduced.

---

## PART 5 — The two product rulings (evidence-based, baked into the SPEC)

**RULING 1 — Add a tap-to-open-a-person's-profile-by-id route? → YES, INCLUDE in v1.**
Rationale: (a) feasibility is trivial — `ViewFriendProfileScreen` already renders an arbitrary user by id (`index.tsx:2353-2356`), `setViewingFriendProfileId` is an existing setter, and `NavigationHandlers` already declares `setViewingFriendProfileId?` (`deepLinkService.ts:20`) — it's just never used by the parser. (b) It directly serves **5 notification types** that point at a person and currently either misroute or land coarse: `birthday_reminder` (→ should be the birthday friend), `friend_request_accepted` (producer already sends `connections?userId={id}` — 6/6 live rows carry it, and it's currently DROPPED), `paired_user_saved_card`, `paired_user_visited`, `holiday_reminder`. Adding `parseDeepLink('profile/{userId}')` → `setViewingFriendProfileId(userId)` lets the SPEC DELETE 3 of the 5 in-app special-cases and make the server link canonical. High benefit, near-zero build cost. The producers must switch `mingla://discover` (birthday/holiday) and `connections?userId=` to `mingla://profile/{userId}`.

**RULING 2 — Are order/refund push taps in scope? → NO, OUT OF SCOPE.**
Rationale: VERIFIED that order/cancel/refund/booking/ticket notifications do NOT enter the consumer in-app inbox — none of the 12 live consumer `notifications` types are order/money types; they ride the separate `ticket_order_notifications` queue dispatched by `ticket-confirmation-dispatch` (deployed, confirmed in the function list) as buyer email/push. They never render in `NotificationsSheet` and never call `notify-dispatch`. The prior report's F-16 is CONFIRMED. The `orders/{id}` parser-null (F-12) stays latent. **Recommendation baked into SPEC Non-Goals: order/refund taps are a separate buyer pipeline, out of ORCH-1030; if buyer transactional push deep-linking is ever wanted, spin a dedicated ORCH against `ticket-confirmation-dispatch`.**

---

## Implementor blast radius (precise)

**Client (consumer app — the bulk; no backend deploy needed for these):**
- `app-mobile/src/services/deepLinkService.ts` — add `profile/{userId}` route; make parser output a typed `Destination` union; fix `review` to carry `experienceId`; accept query-form `session?id=` (latent, cheap); add `setViewingFriendProfileId` + `setPendingSessionOpen` usage in executor.
- `app-mobile/app/index.tsx` — (1) DELETE the F-01 `collaboration_/session_ → connections` prefix branch (`:1068-1069`); (2) DELETE/fold the 5 special-cases (`:1022-1051`) into parser routes so `data.deepLink` is canonical; (3) add `setPendingSessionOpen` + `setViewingFriendProfileId` to BOTH the push handler object (`:477-481`) and the deferred-replay object (`:785-788`); (4) demote `NAV_TARGETS` to a `typeFallbackDestination(type,data)` returning the typed `Destination`; (5) pass `deepLinkParams` to `<LikesPage>` (`:2196/2465`); (6) persist the cold-start push deep link to AsyncStorage (F-13) so it rides the onboarding-gated replay at `:852-874`.
- `app-mobile/src/components/LikesPage.tsx` — add `deepLinkParams`/initial-tab prop; seed `activeTab='calendar'` + select `entryId`.
- `app-mobile/src/components/ConnectionsPage.tsx` — no change to the chat path (already consumes); OPTIONAL: honor `tab=requests` for the friend-request panel (F-07) if the panel correction is wanted.

**Backend (independent, small, deploy-gated — can ship after client):**
- `supabase/functions/notify-birthday-reminder/index.ts` (`:212`), `notify-holiday-reminder/index.ts` (`:152`) — change `data.deepLink` from `mingla://discover` to `mingla://profile/{birthdayOwnerId|giftTargetId}` AND pass top-level `deepLink` so `notify-dispatch:309` fills the column.
- `supabase/functions/notify-message/*` (board_message_received) — ensure `data.deepLink = mingla://chat/{conv}…` is set (live shows 0/8 board_message_received rows carry it) and passed top-level.
- OPTIONAL (drift prevention, low priority): a canonical type registry + strict-grep gate (F-09).

**Out of scope (verified):** business app (separate OneSignal app id + `mingla-business://` scheme), buyer-web (no inbox/push), admin-web (not a tap consumer), order/refund pipeline (Ruling 2).

---

## Mandatory acceptance gate the SPEC must carry

Per Prime Directive 7 + the dispatch: a **live-fire sim repro of the session→wrong-tab misroute** is a hard acceptance gate. The fallback at `index.tsx:1068` IS hit in production (8/22 `session_member_joined` rows have no deepLink), so it is reproducible: create/observe a `session_member_joined` row with no `data.deepLink`, tap the in-app sheet row → currently lands **Connections** (bug); after fix → lands **Home + session open**; tap the push → must match. This MUST be run on iOS sim AND Android emulator before CLOSE; source-only caps the verdict at `probable`.

---

## Confidence

- **PROVEN (six-field + live DB):** F-01 (C-1), the 3-authority precedence (C-2), the corrected DB numbers (C-3, 47/107), Likes param gap (C-4/F-02/F-11), ConnectionsPage chat consumption (C-5), the orphan REFUTATION (C-6/F-08), F-04 refutation, F-15 revision, the feasibility ledger (every chain read end to end).
- **PROVEN at wiring/data layer:** F-03 (revised), F-05, F-06, F-07, F-10, F-12, F-13, F-16.
- **Capped at PROBABLE (runtime feel):** no on-device repro THIS pass — the SPEC carries the mandatory sim gate. External (OneSignal) behavior verified against docs.
- **One residual GAP flagged honestly:** the exact session/board edge function that POSTs `session_member_joined`/`board_card_*` to `notify-dispatch` was identified by-contract (notify-dispatch enumerates them + live rows exist) but the individual producer files were not each opened this pass due to a tool-channel stall late in the session; this does not change any verdict (the types are proven non-orphan by the dispatch hub's own type tables + live data), and the SPEC's backend work targets `notify-dispatch` callers generically for the top-level-deepLink fix.
