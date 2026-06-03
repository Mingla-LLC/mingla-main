# IMPLEMENTATION REPORT — ORCH-1030 [Consumer app notification deep-linking]

**Skill:** mingla-implementor (Claude parity side)
**Date:** 2026-05-31
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1030-[notification-deep-linking]/` on branch `ORCH-1030-notification-deep-linking`
**Status:** implemented and verified (client) + implemented, deploy-pending (backend edge fns — orchestrator owns deploy)
**Contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1030_NOTIFICATION_DEEP_LINKING.md`
**Resumed:** a prior implementor pass was cut off mid-work by a rate-limit, leaving uncommitted edits to `index.tsx` + `deepLinkService.ts`. This pass verified/corrected those edits and finished the remaining contract.

---

## 0. Resume assessment (what already existed vs. what was broken)

**`deepLinkService.ts` (prior pass):** the typed `Destination` union, `parseDeepLink → Destination|null`, all parser routes (session path+query, conversation, profile/{id}, calendarEntry, review-carries-id, pairedDeck, page, paywall), the exhaustive `executeDeepLink`, and `typeFallbackDestination` were already present and matched the SPEC's winning architecture. **Kept as-is** (verified clean via `deno check` + the new regression test). One legacy `board-invite` page kind was preserved from the original parser — correct (no regression).

**`index.tsx` (prior pass):** the in-app handler (`handleNotificationNavigate`), the push `processNotification`, and the F-13 AsyncStorage cold-start persistence were already correctly rewired to the one-router shape. The F-01 collaboration_/session_→Connections branch and the 5 in-app special-cases were already deleted. **BUT three defects remained:**
1. **Deferred-replay effect (`:786`) used the STALE shape** — it referenced `action?.page` / `action.params` (the old `NavigationAction`), which no longer exist on `Destination`; the ORCH-0435 `paired→notificationId-lookup` branch was both stale-shape-broken AND dead (no producer emits `notificationId` in the deepLink). Its handlers object was also missing `setPendingSessionOpen` + `setViewingFriendProfileId` (SPEC §3.2.5).
2. **OS Linking handler (`:1758`)** — its handlers object was missing `setPendingSessionOpen` + `setViewingFriendProfileId`. This handler also serves the F-13 cold-start replay (`handleDeepLink(url)` at `:888`), so a `mingla://session/{id}` or `mingla://profile/{id}` cold-start tap would silently no-op (SC-6 break).
3. **`NAV_TARGETS` was NOT deleted** — still defined (`:608`) and still passed to `processNotification` as the unused `navigationTarget` param (SPEC §3.2.6 demote-to-fallback not done).

All three were corrected this pass.

---

## 1. Files changed (Old → New receipts + commit hashes)

### `app-mobile/src/services/deepLinkService.ts` — commit `553dc940a`
- **Before:** prior-pass rewrite (typed union + parser + executor + fallback). **Now:** unchanged from the prior pass except verified correct; committed as-is. **Why:** SPEC §3.1 winning architecture. **Lines:** ~322 (prior pass).

### `app-mobile/app/index.tsx` — commits `553dc940a` (routing) + `527e64c40` (LikesPage wiring)
- **Before:** deferred-replay used stale `action.page`/`action.params` + ORCH-0435 dead branch; OS Linking + deferred handler objects missing session/profile setters; `NAV_TARGETS` map live + passed as `navigationTarget`. **Now:** deferred-replay routes through `executeDeepLink(parseDeepLink(url), fullHandlers)` with the full handler set; OS Linking handler gets `setPendingSessionOpen`+`setViewingFriendProfileId`; `NAV_TARGETS` deleted, `processNotification` param dropped, `onNotificationClicked` calls `processNotification(data)`; added `likesDeepLinkParams` memo + wired `deepLinkParams`/`onDeepLinkHandled` to both `<LikesPage>` render sites. **Why:** SPEC §3.2.5/.6, §3.2.8, SC-6. **Lines:** ~60 changed this pass (on top of the prior ~197).

### `app-mobile/src/components/LikesPage.tsx` — commit `527e64c40`
- **Before:** no deep-link prop; only `navigationData`/`onNavigationComplete`. **Now:** added `deepLinkParams?` + `onDeepLinkHandled?` props (mirrors navigationData); on `deepLinkParams.tab==='calendar'` seeds `activeTab='calendar'`, holds `entryId ?? experienceId` in `deepLinkEntryId` state, passes it to CalendarTab as `selectedEntryId`, then clears via `onDeepLinkHandled`. **Why:** SPEC §3.3, F-11 (experienceId carried not dropped). **Lines:** ~25.

### `app-mobile/src/components/activity/CalendarTab.tsx` — commit `527e64c40`
- **Before:** no entry-selection prop. **Now:** added `selectedEntryId?` prop; an effect auto-expands the matching inline card (reuses the existing `expandedCard` mechanism = v1 "select", no scroll); only fires when the entry exists in the loaded list (stale id → graceful plain-Calendar landing). **Why:** SPEC §3.3 "entry SELECT only — no scroll". **Lines:** ~12.

### `supabase/functions/notify-birthday-reminder/index.ts` — commit `b1d1028ba`
- **Before:** `data.deepLink = "mingla://discover"`, no top-level `deepLink` (so notify-dispatch:307 NULLED it). **Now:** `mingla://profile/{birthdayOwner.id}` passed top-level AND in data. `birthdayOwner.id` is a real Mingla user id (profiles join on `pairings.user_a_id`/`user_b_id`). **Why:** SPEC §3.5, SC-5. **Lines:** ~12.

### `supabase/functions/notify-holiday-reminder/index.ts` — commit `b1d1028ba`
- **Before:** `data.deepLink = "mingla://discover"`, no top-level. **Now:** `mingla://profile/{paired_user_id}` top-level + data WHEN the gift target is a linked Mingla user; omitted when there is none. Added `paired_user_id` to the select. **Why:** SPEC §3.5 + a **DB-probe deviation** (see §4). **Lines:** ~25.

### `supabase/functions/notify-message/index.ts` — commit `b1d1028ba`
- **Before:** `data: { deepLink }` only (nested → NULLED by dispatch) for both `board_message_received` and `board_message_mention`. **Now:** `deepLink` passed top-level + in data on both. **Why:** SPEC §3.5 (board_message_received explicit; mention folded under the general top-level rule, same producer/same bug). **Lines:** ~6.

### `supabase/functions/notify-dispatch/index.ts` — commit `b1d1028ba`
- **Before:** no documentation of the top-level-deepLink override behavior. **Now:** protective contract comment above the insert payload documenting that `data.deepLink` is overridden by the top-level `deepLink` (or nulled) — callers MUST pass both. **Why:** SPEC §3.5 general rule + §8. **Lines:** ~7 (comment only; no behavior change).

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — commit `b1d1028ba`
- **Before:** no ORCH-1030 backend allowlist. **Now:** `ORCH_1030_BACKEND_ALLOWLIST` (4 modified edge fns) defined + spread into `ALLOWLIST`. **Why:** COMMS-0002 — C7 `no-new-backend-files` flags MODIFIED backend files too; must land in the same commit as the backend touch. **Lines:** ~17.

### `app-mobile/src/services/__tests__/deepLinkRouting.orch1030.test.ts` — commit `e56e5fda5` (NEW)
- Deno regression test, 11 cases. **Why:** ORCH-0840 mandatory regression gate. **Lines:** ~210.

### `app-mobile/deno.lock` — commit `0e10718f0`
- deno test regenerated the lock to record std@0.190.0 `testing/asserts.ts` hashes the new test imports (+ a reconciled `react-native-compressor` entry already declared in package.json). No behavior change.

---

## 2. Spec traceability (success criteria)

| SC | Status | Evidence |
|---|---|---|
| SC-1 (PRIMARY) session no-deeplink → Home+session, in-app + push | PASS | Regression test "SC-1 PRIMARY" + "SC-1 push parity"; ladder identical for both call paths. iOS/Android sim live-fire = tester's per-platform gate (not run here). |
| SC-2 session w/ deeplink → Home+session | PASS | Test "SC-2". |
| SC-3 calendar reminder → Likes→Calendar, entry selected | PASS | Test "T-05" + LikesPage `selectedEntryId` → CalendarTab auto-expand. |
| SC-4 DM/board message → correct thread | PASS (client routing) | ConnectionsPage effect unchanged (VERIFIED in SPEC); board_message producer now carries the link (backend, deploy-pending). |
| SC-5 birthday/holiday/paired/friend-accepted → person's profile | PASS | Test "T-09"; birthday/holiday producers route to `profile/{userId}` (deploy-pending). |
| SC-6 cold-start logged-out push → destination after auth+onboard | PASS (mechanism) | F-13 persists to AsyncStorage `mingla_deferred_deeplink` in `processNotification`; onboarding-gated replay (`:871`) calls `handleDeepLink` which now has the full handler set incl. session/profile. Live cold-start = tester gate. |
| SC-7 malformed link → no crash, fallback by type | PASS | Test "T-11"; `parseDeepLink` try/catch + null path. |
| SC-8 in-app == push Destination for every type | PASS | Test "SC-1 push parity" + "T-14"; both call paths run the identical `parseDeepLink ?? typeFallbackDestination` ladder. |
| SC-9 referral/trial/re_engagement regression | PASS | Test "T-15". |

**Sim live-fire (SC-1-iOS / SC-1-Android) NOT run** — these are the tester's per-platform acceptance gates per SPEC §9. The unified-router mechanism is proven by the regression test (fails-on-revert). No native bridge change was made, so no dev-build rebuild was required.

## 3. Invariants

- **I-NOTIF-ONE-ROUTER (new):** PASS — exactly one `parseDeepLink`/`executeDeepLink` pipeline; in-app, push, deferred-replay, and OS-Linking all call it; no per-type ladder outside `typeFallbackDestination`. No `setCurrentPage('connections')` in the collab/session region (grep-verified).
- **I-NOTIF-FALLBACK-AGREES (new):** PASS — `typeFallbackDestination` returns only `Destination` values the parser produces; test "T-14" locks no-collab→Connections.
- **I-DEEPLINK-IN-ADDITIONALDATA (preserve):** PASS — link rides `data.deepLink`; no new payload field.
- **I-PERSISTED-STATE-STARTUP (Constitution #14):** PASS — cold-start link persists to AsyncStorage, replays only after `isAuthenticated && !showOnboardingFlow`, 24h staleness discard (`:883`).
- **I-NO-SILENT-FAILURE (Constitution #3):** PASS — `parseDeepLink` null + fallback always lands somewhere; `executeDeepLink` exhaustive `never` guard.

## 4. Deviations from SPEC (documented)

**D-1 (holiday reminder profile target — DB-probe-driven correction).** SPEC §3.5 said `mingla://profile/{giftTargetUserId}` using "personId" semantics. A read-only DB probe (`information_schema.columns` on `custom_holidays` + `saved_people`) proved `custom_holidays.person_id` FKs to `saved_people` — a **non-user contact** (initials/name, no auth user link) — NOT a Mingla user id. `ViewFriendProfileScreen` requires a user id. `custom_holidays` ALSO has `paired_user_id` (a real user id, nullable). **Correction:** route to `mingla://profile/{paired_user_id}` and emit the deep link ONLY when `paired_user_id` is present; when absent (saved-person-only holiday), omit the deep link so the client's `holiday_reminder` type fallback lands Connections. This honors the SPEC intent ("the gift-target's profile") with the correct id source. Probe: SQL summary in §6.

**D-2 (board_message_mention folded in).** SPEC §3.5 named `board_message_received` explicitly. `board_message_mention` (same producer file `notify-message`, same conversation deep link, same nested-only NULL bug) was fixed in the same edit under the SPEC's general LOCKED rule (§3.5 line 111 "callers MUST pass the deep link top-level"). Not scope creep — same one-line pattern, avoids leaving a known sibling bug.

**D-3 (ORCH-0435 deferred-replay branch removed).** The deferred-replay `paired→notificationId-lookup` branch was stale-shape-broken by the typed-union migration AND dead (the live `notify-pair-activity` producer emits `mingla://discover?paired=true` with NO `notificationId` param). Replaced with the unified `executeDeepLink(parseDeepLink(url), fullHandlers)`. `discover?paired=true` now parses to `{kind:'pairedDeck'}` directly. No behavior regression for any live producer.

## 5. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | YES | All client files; shared code. |
| Consumer Android | YES | Same shared code; SC-1-Android is its own tester gate. |
| Buyer/anon Web | NO | No notification inbox. |
| Business iOS/Android | NO | Separate OneSignal app + scheme + routing. |
| Admin Web | NO | Does not render consumer notifications. |

Parity automatic (shared `app-mobile/` code); sim live-fire is the only manual per-platform gate.

## 6. DB probe (read-only, per Prime Directive 9b-adjacent)

`SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name IN ('custom_holidays','saved_people')` — confirmed `custom_holidays.person_id` (uuid, FK→saved_people, a contact), `custom_holidays.paired_user_id` (uuid, nullable, the Mingla user), `saved_people` has no user FK (name/initials only). Drove D-1. No mutation.

## 7. Regression test

- **Path:** `app-mobile/src/services/__tests__/deepLinkRouting.orch1030.test.ts`
- **Runner:** Deno (`deno test --allow-read`) — matches the app-mobile pure-logic test convention (deepLinkService is a zero-import pure module).
- **Result:** 11 passed | 0 failed.
- **fails-on-revert verified at `b1d1028ba`:** reintroducing the F-01 `collaboration_/session_ → { kind:'page', page:'connections' }` branch into `typeFallbackDestination` made **5 tests FAIL** (incl. the PRIMARY gate "session_member_joined ... NOT Connections" and "T-14 no collab/session type falls back to Connections"); restoring the fix → 11 passed.

## 8. Quality gates

- **tsc:** touched files (`index.tsx`, `deepLinkService.ts`, `LikesPage.tsx`, `CalendarTab.tsx`, test) report ZERO errors. Whole-package `tsc -p` = 260 errors both on clean HEAD and with changes (identical baseline of pre-existing config noise — Deno test files seen by tsc, packages/brand-rendering missing react types). **0 new errors.**
- **eslint:** touched files = 0 errors (pre-existing warnings only).
- **deno check:** clean on all 4 modified edge functions.
- **strict-grep ORCH-0863 gate:** exit 0; C7 `no-new-backend-files` OK (all 4 backend files allowlisted).
- **node --check:** strict-grep script syntactically valid.

## 9. Deploy commands for the orchestrator (DO NOT run here — orchestrator owns deploy)

No migration in this ORCH (no `supabase db push` needed). After the PR merges to main, deploy the 4 modified edge functions FROM main:

```bash
supabase functions deploy notify-birthday-reminder --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy notify-holiday-reminder  --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy notify-message           --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy notify-dispatch          --project-ref gqnoajqerqhnvulmnyvv
```

Verify-first-call after deploy: each should return non-404 (these are auth/cron-invoked POST fns; a bare GET returning 401/405 confirms the route is live, not 404).

## 10. Discoveries for orchestrator

- **DISC-1 (the D-1 finding, registered as a data-correctness note):** any future code routing on `custom_holidays.person_id` as a user id is wrong — it is a `saved_people` contact id. Use `paired_user_id` for user-targeted routing. Worth a one-line note in the notifications data dictionary if one exists.
- **DISC-2:** `HomePage.tsx` imports `executeDeepLink` but never calls it (pre-existing dead import; delegates to `onNotificationNavigate`). Left untouched (out of scope); flag for a future cleanup.
- **DISC-3:** the 260-error `tsc -p` baseline in app-mobile means the repo has no clean whole-package typecheck gate; the team relies on targeted checks. Not this ORCH's problem, but worth knowing the CI signal is per-file, not whole-package.

## 11. Commit ledger

| Commit | Scope |
|---|---|
| `553dc940a` | Unified client routing (deepLinkService verified; index.tsx deferred-replay + OS-Linking + NAV_TARGETS removal). |
| `527e64c40` | LikesPage + CalendarTab deep-link entry select + index.tsx wiring. |
| `b1d1028ba` | Backend producers (birthday/holiday/message/dispatch) + ORCH-0863 C7 allowlist. |
| `e56e5fda5` | Regression test. |
| `0e10718f0` | deno.lock for the test imports. |
