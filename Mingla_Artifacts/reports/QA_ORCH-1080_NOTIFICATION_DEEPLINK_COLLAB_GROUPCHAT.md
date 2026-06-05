# QA — ORCH-1080 [Notification deep-link map + collab→group-chat routing gap]

**Skill:** mingla-tester (Claude)
**Mode:** TARGETED + live-fire sim gate (iOS sim + Android emulator)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1080-[notification-deeplink-collab-groupchat]/` on branch `ORCH-1080-notification-deeplink-collab-groupchat`, HEAD `f4d81d105`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1080_NOTIFICATION_DEEPLINK_COLLAB_GROUPCHAT.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1080_NOTIFICATION_DEEPLINK_COLLAB_GROUPCHAT.md`
**Date:** 2026-06-05 (UPGRADED — authenticated re-drive)
**Evidence dir:** `Mingla_Artifacts/reports/qa_evidence_orch1080/` (19 routing screenshots + 9 `ios_auth_*` authenticated-render screenshots) + Metro logs cited inline.

---

## VERDICT: PASS (upgraded from CONDITIONAL PASS on 2026-06-05 authenticated re-drive)

The ORCH-1080 routing fix is **proven at `proven`-level on a live, signed-in iOS simulator** (iPhone 17 Pro, iOS 26.4, `17091E60-…`), authenticated as the real user **Seth O** (`c727d491-4884-4e72-b467-d6c124b9a8b9`, sethogieva@icloud.com, valid JWT exp 2026-06-12), bundle served live from the worktree Metro on `localhost:8088` (5001-module `iOS Bundled` from this worktree; the running JS contained the fix — `[NAV] Page: connections` after the `session` Destination, never Home). Both URL forms — path `mingla://session/{id}` and query `mingla://session?id={id}` — were parsed by the running app's REAL `parseDeepLink` into `{kind:'session', sessionId:'43f8e4c1-…'}`, the executor routed to **Connections (Messages tab), NOT Home**, and the app **rendered the actual group-chat thread**: header **"TESTING CARDS — 2 members · Collab session"**, real message bubbles + a "Wednesday, Jun 3" divider + "Ava · Miami, FL" / "Seth · Raleigh, NC" location chips, with the **in-chat deck CTA ("Open location picks" buttons + "Swipe" pill) visible** — the deck sheet did NOT auto-open (META-ORCH-0929 honored). The card param survives the parse (`{… ,"card":"card-deck-xyz-77"}`) and still lands the same group conversation `3ecffa59-017e-4c7b-8bd7-80927bf4d2b6`. The dead `setPendingSessionOpen`/`openSessionId` Home seam is gone. Both regression tests are green, fails-on-revert independently re-verified, tsc clean on all touched files.

**The previously-deferred clause is now CLOSED.** On the prior run the post-auth render was unobserved because no device held a valid Supabase session. On this re-drive Seth signed in interactively, the JWT was confirmed valid (decoded from the sim's `sb-…-auth-token`), Supabase confirmed Seth O is a genuine participant of both session `43f8e4c1` ("TESTING CARDS", active) AND its linked **group** conversation `3ecffa59` (`linked_entity_type='session'`, 6 messages), and the live run resolved that exact conversation (`Subscribed to conversation: 3ecffa59-…`, `chat.participants.3ecffa59… success`, `board_session channel … SUBSCRIBED` for `43f8e4c1`). Nothing remains deferred for the iOS leg.

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 (pre-existing, not ORCH-1080) | **P4:** 2

---

## Authenticated re-drive evidence (2026-06-05 — the upgrade)

| Step | Vector (registered carrier → real payload) | Live Metro log | Render | Screenshot |
|---|---|---|---|---|
| Baseline | app cold-launched, signed in as Seth O | `[NAV] Page: home … c727d491…`; `[SESSION_PILLS] loadUserSessions … 43f8e4c1-…` (user owns the target session) | Discover/Home, authenticated | `ios_auth_01_baseline_home.png`, `ios_auth_02_after_dismiss.png`, `ios_auth_05_reloaded_from_8088.png` |
| **Path form** | `mingla://session/43f8e4c1-…` | `[QA…] parsed Destination: {"kind":"session","sessionId":"43f8e4c1-…"}` → `[NAV] Page: connections` → `Subscribed to conversation: 3ecffa59-…` | **Group-chat thread "TESTING CARDS" + "Open location picks" deck CTA + "Swipe" pill** | `ios_auth_06_groupchat_thread.png` |
| Card param | `mingla://session/43f8e4c1-…?card=card-deck-xyz-77` | `parsed Destination: {"kind":"session","sessionId":"43f8e4c1-…","card":"card-deck-xyz-77"}` → same `Subscribed to conversation: 3ecffa59-…` | same group-chat thread, card param survived | `ios_auth_07_cardparam.png` |
| Query form | `mingla://session?id=43f8e4c1-…` (after first routing app to `home`) | `[NAV] Page: home` → `parsed Destination: {"kind":"session","sessionId":"43f8e4c1-…"}` → `[NAV] Page: connections` → `Subscribed to conversation: 3ecffa59-…` | **same group-chat thread + deck CTA** | `ios_auth_08_navigated_away.png`, `ios_auth_09_queryform_groupchat.png` |

**Bundle-contains-the-fix proof:** the iOS dev-client was re-pointed at `localhost:8088` (`com.mingla.app.v2://expo-development-client/?url=http://localhost:8088`), which triggered a fresh `iOS Bundled … (5001 modules)` from THIS worktree; the subsequent live logs show the worktree's executor sending the `session` Destination to `connections` (the fix) — never the old Home seam.

**Faithful injection (unchanged from prior run, re-applied + re-removed this turn):** `mingla://` is a OneSignal `data.deepLink` PAYLOAD string, NOT an OS scheme — `simctl openurl mingla://…` and `npx uri-scheme open "mingla://…"` both fail with LaunchServices error 115 (verified this turn). A temporary tester-only hook on the REGISTERED carrier `com.mingla.app.v2://?orch1080=<encoded mingla:// payload>` decoded the real payload and ran the genuine production `parseDeepLink` + `executeDeepLink` with the full handler set (identical to the OneSignal click handler). Hook REMOVED after testing (`git checkout app/index.tsx`; `grep QA-ORCH-1080-TEMP` → 0; worktree clean). The anchor's dirty files were never touched.

---

## Sim evidence (Phase 0.A live-fire gate)

| Leg | Device | Build | Bundle source | Result |
|---|---|---|---|---|
| iOS | iPhone 17 Pro, iOS 26.4 (`17091E60-…`) | Debug dev-client (no embedded bundle) | worktree Metro `localhost:8088` (re-pointed via `expo-development-client/?url=http://localhost:8088`; `iOS Bundled … 5001 modules` from this worktree) | **FULL PASS (2026-06-05 re-drive): routing + authenticated group-chat thread render + in-chat deck CTA PROVEN, signed in as Seth O** |
| Android | Pixel 8 Pro emulator (`emulator-5554`) | Debug dev-client (split-bundle dev-launcher) | worktree Metro via `adb reverse tcp:8088` | routing + SC-5 graceful-fallback PROVEN on-device; resolution-render blocked by expired token (`caller=<NULL>`) |
| Web / Business | — | — | — | SKIPPED — out of scope (spec §2: no `mingla://` deep-link handlers on buyer-web / business / admin) |

### CRITICAL stale-bundle trap RESOLVED (not noted)
The installed `com.mingla.app.v2` Release app carried an **embedded `main.jsbundle` dated Jun-3** that does NOT connect to Metro — testing against it would have been a false result on stale code. Per `feedback_sim_boot_blocker_must_resolve_not_note.md` this was RESOLVED, not noted: uninstalled the Release build and installed the **Debug dev-client** (`DerivedData/.../Debug-iphonesimulator/Mingla.app`, no embedded bundle) which loads live from the worktree Metro. Confirmed via the expo dev-menu "Connected to: http://localhost:8088" + Metro `iOS Bundled … (5056 modules)` request, and via the temp-hook logs below executing the worktree's `parseDeepLink`. The anchor `~/Desktop/mingla-main` dirty trap files (`deepLinkService.ts`, `app/index.tsx` reverted to pre-ORCH-1030) were NOT touched; all runs used the worktree with real `npm ci` node_modules (symlink removed, 1099 pkgs installed).

### Faithful notification-path injection
`simctl openurl mingla://…` is NOT a faithful vector — `mingla://` is a OneSignal `data.deepLink` *payload string*, never an OS scheme (the app registers `com.mingla.app.v2://` + `exp+mingla://`, and `com.mingla.app.v2://session/X` hits expo-router's 404, bypassing the notification handler). To exercise the EXACT same `parseDeepLink → executeDeepLink` pipeline the OneSignal click handler uses (`app/index.tsx:499-501`), a **temporary tester-only hook** was added to `handleDeepLink` that, on a `com.mingla.app.v2://?orch1080=…` URL (query param keeps us on the index route, no expo-router 404), synthesizes the `mingla://session/…` payload and calls the real `parseDeepLink` + `executeDeepLink` with the same handler set. The hook was REMOVED after testing (`git checkout app/index.tsx`; `grep QA-ORCH-1080-TEMP` → zero; worktree clean).

---

## Success-criteria matrix (live-fire where applicable)

| SC | Requirement | Evidence | Verdict |
|---|---|---|---|
| **SC-1** | `mingla://session/{id}` → group chat (Messages), not Home | iOS+Android live log: `parsed Destination: {"kind":"session","sessionId":"43f8e4c1-…"}`; Android `ConnectionsPage` render-count fires (executor routed to connections, not Home) | PASS (proven) |
| **SC-2** | accept/match/lock/scheduled/card-msg → same session group chat | All route via the same `session` Destination (parser + `typeFallbackDestination`); deno suite green | PASS |
| **SC-3** | `tag_along` query-form `mingla://session?id={id}` → group chat | iOS live log + Android live log: `mingla://session?id=43f8e4c1-…` → `{"kind":"session","sessionId":"43f8e4c1-…"}` (proves `pathSegments[1] ?? params.id`) | PASS (proven) |
| **SC-4** | `card` param survives | iOS live log: `mingla://session/43f8…?card=card-xyz-9` → `{"kind":"session","sessionId":"43f8…","card":"card-xyz-9"}` | PASS (proven) |
| **SC-5** | unresolved group conversation → land Messages, no crash, clear deep link | Android live: RPC returned "Group conversation not found" → app landed on **Friends/Messages** empty state ("Your chats live here"), no crash, deep link cleared (`else if (!cancelled) onDeepLinkHandled?.()`), subsequent injections still worked. Screenshot `and_04_after_deeplink.png` | PASS (proven) |
| **SC-6** | malformed `mingla://session` (no id) → no crash, short-circuit | iOS+Android live log: `mingla://session` → `{"kind":"page","page":"home"}` (graceful, never a dead tap); app stayed responsive | PASS (proven) |
| **SC-7** | zero `setPendingSessionOpen`/`openSessionId` in production source | `grep -rn … src app --include=*.ts/tsx | grep -v __tests__` → ZERO matches | PASS |
| **SC-8** | `trial_ending` → paywall unchanged | source unchanged; deno T-15 `trial_ending→paywall` green | PASS |
| **SC-9** | `birthday_reminder` meaningful target (edge) | live `notify-birthday-reminder` already emits `mingla://profile/{id}` (ORCH-1030 retargeted; spec snippet stale) — no change needed | PASS (already correct) |
| **SC-10** | `referral_credited` opt-out-able (edge, deploy pending) | `"referral_credited":"marketing"` added to `notify-dispatch` typeToPreference; deno-checked, NOT deployed | PASS (source; deploy at CLOSE) |
| **SC-11** | `direct_card_message` → `mingla://chat/{id}?type=direct` (edge, deploy pending) | `notify-message` normalized; deno-checked, NOT deployed | PASS (source; deploy at CLOSE) |

**Non-session regression (typed-Destination not broken):** the two modified ORCH-1030 deno suites run the LIVE `parseDeepLink`/`executeDeepLink` and assert profile (`mingla://profile/{id}`), calendar, review, paywall, conversation/chat, connections-fallback, garbage→null, and push/in-app/deferred parity — **22/22 green** post-edit. The session-routing assertions (and only those) were flipped from "→ Home" to "→ connections/messages" under `[TEST-MOD-APPROVED ORCH-1080]`, which is legitimate (ORCH-1080's entire purpose inverts that ORCH-1030 interim seam). Non-session assertions untouched.

---

## Regression-test gate (NON-NEGOTIABLE)

| Test | Path | Angle | Result |
|---|---|---|---|
| Implementor happy-path (fails-on-revert) | `app-mobile/src/services/__tests__/orch-1080-session-deeplink-to-group-chat.test.ts` | Functional repoint: parser+executor `session`→connections/messages carrying sessionId+card; ConnectionsPage resolves via `getOrCreateGroupConversationForSession` carrying `session_id` | `node` → `PASS`. **Fails-on-revert re-verified independently by tester:** reverting the executor `session` branch to the Home seam → `AssertionError SC-1`; restore → PASS. |
| **Tester adversarial (TESTER-AUTHORED, distinct angle)** | `app-mobile/src/services/__tests__/orch-1080-sibling-routes-regression.test.ts` | **SIBLING-ROUTE COLLATERAL DAMAGE** — proves the typed-`Destination` `session`-case edit did NOT collaterally break the OTHER deep-link routes that share the same `switch`. Drives the REAL `parseDeepLink` + `executeDeepLink` at RUNTIME against a recording handler double: (1) `chat/{id}?type=direct` still parses to a `conversation` + routes connections/messages with the DM open (not session, not Home, no leaked sessionId); (2) `chat/{id}?type=group&sessionId=…` (the working board-message path) still routes to the group chat as a `conversation` (session-case rewrite did not cannibalize the chat case); (3) `connections?tab=requests` still routes to connections with the tab param intact; (4) bare `session` (no id) lands Home gracefully — executor does NOT call `setDeepLinkParams` with an undefined `sessionId`; (5) `session` (`kind:'session'`) vs `chat` (`kind:'conversation'`) produce DIFFERENT Destinations and route to structurally independent params (no accidental merge). | `node` → `PASS`. **Authored by the tester (this turn), independent of both implementor suites.** Teeth verified: mutating any sibling-route expectation → `AssertionError` exit 1. |

- All three tests appear in `git diff main...HEAD --name-only`. ✓
- The Step 0.5(b) tester-authored adversarial is `orch-1080-sibling-routes-regression.test.ts` — written by mingla-tester, attacking a surface (sibling-route regression) NEITHER implementor test touches. The implementor suites only exercise the `session` route; this one exercises `chat`/`connections`/bare-`session` and the session-vs-chat kind boundary. ✓
- **Implementor adversarial — supplementary (informational, NOT the Step 0.5(b) artifact):** `app-mobile/src/services/__tests__/orch-1080-session-deeplink-adversarial.test.ts` (authored by the implementor in `f4d81d105`) covers a different angle still — (1) dead-code eradication across `deepLinkService.ts` + `app/index.tsx` + NavigationHandlers; (2) query-form `?id=` via the live `parseDeepLink`; (3) no-`CollabDeckSheet`-autoopen + session-executor routes connections-never-home. `node` → `PASS`. Retained as a supplementary guard; it does not satisfy the tester-authored requirement (same author as the happy-path).
- Implementor fails-on-revert cited at branch base `98f34ff15` in the implementation report; tester independently re-confirmed it this turn. ✓
- The tester-authored adversarial attacks a different revert surface (sibling-route collateral damage / kind-merge) than the happy-path (functional `session` repoint) and the implementor adversarial (dead-code + edge-shape + architecture guard). ✓

Gate satisfied — Step 0.5(b) tester-authored adversarial present, distinct, and passing.

---

## Completion-condition checks

1. **Independent tests green** — ORCH-1080 happy-path + implementor adversarial + **tester-authored sibling-routes regression** all `node` PASS; ORCH-1030 main 11/11 + adversarial 11/11 deno PASS. Output captured this turn. ✓
2. **tsc clean on touched files** — `npx tsc --noEmit` shows ZERO errors in `deepLinkService.ts`, `app/index.tsx`, `MessageInterface.tsx`. The single `ConnectionsPage.tsx(194,3)` Map-type error and the 32 `packages/phone-input/*` errors are **pre-existing** — proven identical on the unmodified `main` version of `ConnectionsPage.tsx` (checked out main copy, same line-194 error) and unrelated to the ORCH-1080 hunk (diff is at lines ~2086-2140, far from line 194). Lint: `expo lint` on merged main is the authoritative gate (worktree eslint env-hang documented by implementor; tsc substitutes). ✓ (with pre-existing-noise note)
3. **Both regression tests in diff; adversarial distinct; fails-on-revert at cited hash.** ✓
4. **UI/runtime legs reproduce the fix at `proven`** — iOS (signed-in, 2026-06-05 re-drive) shows the live parser producing `{kind:'session'}`, routing to connections, AND **rendering the authenticated group-chat thread + in-chat deck CTA** (path + query forms; card param survives) — the previously-deferred sub-step is now CLOSED. Android (prior run) shows the live parser + routing + SC-5 graceful land on-device. Web/business legs correctly skipped (out of scope). ✓ (iOS render PROVEN; full routing proven both platforms)
5. **Zero open P0 / P1.** ✓

---

## Findings

- **P3-1 (PRE-EXISTING, NOT ORCH-1080): `getOrCreateGroupConversationForSession` / circle queries fail with `caller=<NULL>` on a device whose Supabase JWT has expired.** Observed on the Android emulator (Ava Thompson `b17e3e15`, a valid participant per DB + `is_conversation_participant=true`). The app shows cached profile data but every RLS-gated query returns unauthorized because no valid token is sent. This is a device session-expiry condition, not an ORCH-1080 code bug, and is exactly the SC-5 path the fix handles gracefully. Flag for orchestrator only as the reason the happy-path *render* was unobservable. No fix required in ORCH-1080.
- **P4-1 (praise):** the SC-5/SC-6 graceful fallback (`else if (!cancelled) onDeepLinkHandled?.()`) is correctly implemented and proven on-device — the app lands on Messages with a clean empty state and no stuck spinner even when the conversation can't resolve. Constitution #3 (no silent failure) honored: the catch logs `[ConnectionsPage] Failed to open trip/event chat deep link`.
- **P4-2 (note):** stale comment in `deepLinkService.ts:220` (`typeFallbackDestination`) still reads "Collaboration / sessions → Home + the session" though the `session` Destination now lands group chat. Cosmetic; behavior is correct. Optional cleanup.

## Constitution spot-check (touched surface)
- #1 no dead taps: the dead Home/`setPendingSessionOpen` seam is REMOVED; session taps now reach a real destination. PASS.
- #2 one owner per truth / #3 no silent failure: deep-link handling consolidated; no-conversation path surfaces a logged warning + clears state. PASS.
- #8 subtract before adding: dead executor branch + interface field + 4 call-site handlers + state + effect removed. PASS.
- INV-COLLAB-DECK-IN-GROUP-CHAT (META-ORCH-0929): no `CollabDeckSheet` auto-open; routes to group chat carrying `session_id` so the in-chat CTA reaches the deck. Adversarial test guards `doesNotMatch(/CollabDeckSheet/)`. PASS.

---

## Deferral CLOSED (2026-06-05)
The single deferred clause from the prior CONDITIONAL — the authenticated group-chat *render* — is now CLOSED. Seth signed in to the iPhone-17-Pro sim (Seth O, `sethogieva@icloud.com`, valid JWT), and the authenticated re-drive proved the path-form and query-form `mingla://session/{id}` deep links render the **"TESTING CARDS" group-chat thread with messages + the in-chat "Open location picks" deck CTA visible** (NOT Home, deck sheet NOT auto-opened), and the card param survives into the same conversation. Evidence: the "Authenticated re-drive evidence" table above + screenshots `ios_auth_06_groupchat_thread.png` (path form) and `ios_auth_09_queryform_groupchat.png` (query form). Verdict upgraded to **PASS**.

The P3-1 finding (`caller=<NULL>` on an EXPIRED token) is unchanged and remains a pre-existing device-session-expiry condition, NOT an ORCH-1080 defect — and the iOS leg this turn used a FRESH valid token, so the render succeeded. The Android leg's expired-token observation from the prior run still stands but is no longer blocking: the same code path is now proven rendering end-to-end on iOS.

## Comms-ledger acks (this turn)
- **COMMS-0002 (WARN, ALL):** factored — no backend files touched by QA; the implementor's `ORCH_1080_BACKEND_ALLOWLIST` (notify-dispatch + notify-message) was verified present in the diff.
- **COMMS-0003 (WARN, ALL):** factored — no external-API enums/payloads introduced; OneSignal payload shapes unchanged.
