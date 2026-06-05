# IMPLEMENTATION — ORCH-1080 [Notification deep-link map + collab→group-chat routing gap]

**Skill:** mingla-implementor (Claude parity mirror)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1080-[notification-deeplink-collab-groupchat]/` on branch `ORCH-1080-notification-deeplink-collab-groupchat`
**Base:** `98f34ff15` (main HEAD at dispatch)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1080_NOTIFICATION_DEEPLINK_COLLAB_GROUPCHAT.md`
**Date:** 2026-06-04
**Status:** implemented and verified (client core), implemented + deno-checked (edge S-2/S-3, NOT deployed)

---

## 0. CRITICAL SPEC-VS-CODE DEVIATION (read first)

The spec's §3 BEFORE/AFTER snippets and several §0/§3.D claims were written against a **pre-ORCH-1030 codebase** and are **stale against live `main` (`98f34ff15`)**. The spec author's re-verification note (§0.1) did not catch that ORCH-1030 [Consumer app notification deep-linking] had already rewritten `deepLinkService.ts` into a typed `Destination` discriminated union, with locked regression tests asserting the OLD "session → Home" behavior.

The spec's **intent and all 11 success criteria are still correct and achievable** — operator locked "land target = group chat" on 2026-06-04, which is the deliberate product evolution that supersedes ORCH-1030's interim "land on Home" seam (that seam was a proven no-op: `index.tsx`'s effect just cleared the pending id without opening any deck). I implemented the spec's **intent + SCs** against the actual code, documenting every deviation here.

### Stale spec claims corrected against live code

| Spec claim | Reality on `main` | Resolution |
|---|---|---|
| §3.A.1 parser BEFORE = `{ page:'home', params:{ openSessionId } }` | Parser already returns typed `{ kind:'session', sessionId }` reading `pathSegments[1] ?? params.id` (query-form already handled). | Kept the typed shape; extended the `session` Destination with optional `card`; repointed the **executor** (not the parser) to land group chat. |
| §0/SC-7: `grep setPendingSessionOpen` returns matches "only inside deepLinkService.ts (zero external consumers)" | FALSE — `app/index.tsx` had 4 call sites supplying `setPendingSessionOpen`, a `pendingSessionOpen` useState, and a dead clearing effect (1000-1004). | Removed ALL of them in `index.tsx` (required to satisfy SC-7's "zero matches in app-mobile" for production code). |
| §3.D S-1: `notify-birthday-reminder:212` emits `mingla://discover` | FALSE — already emits `mingla://profile/{id}` (ORCH-1030 retargeted it). | **S-1 NO CHANGE NEEDED** — already a meaningful destination. SC-9 satisfied by existing code (asserted, see §6). |
| §3.D S-3: `notify-message:476` emits `mingla://messages/{conversationId}` | TRUE for `direct_card_message` (line 485). | Normalized to `mingla://chat/{id}?type=direct` (S-3 valid). |
| ORCH-1030 locked tests assert `session → home` | Two immutable test files (`deepLinkRouting.orch1030.test.ts` + `.adversarial.test.ts`) assert F-01 "session must land Home, never Connections" — the exact opposite of ORCH-1080. | Updated the **session-routing assertions only** under `[TEST-MOD-APPROVED ORCH-1080]` (authorized by the append-only gate; ORCH-1080's entire purpose is to invert this routing). All non-session assertions untouched. |

**Net effect:** the spec's behavioral contract (SC-1..SC-11) is delivered exactly; the file-level mechanics differ from the spec's stale snippets because the live architecture differs. No success criterion was dropped or reinterpreted.

---

## 1. Files changed (with the Old→New receipts)

### app-mobile/src/services/deepLinkService.ts (CLIENT, core)
**Before:** `session` Destination = `{ kind:'session', sessionId }`; executor `case 'session'` called `setPendingSessionOpen?.(sessionId)` + `setCurrentPage('home')` (the dead Home seam). `NavigationHandlers` declared `setPendingSessionOpen?`.
**Now:** `session` Destination = `{ kind:'session', sessionId, card? }` (carries `card`). Parser preserves `params.card`. Executor `case 'session'` calls `setDeepLinkParams?.({ tab:'messages', sessionId, card? })` + `setCurrentPage('connections')`. `setPendingSessionOpen` removed from `NavigationHandlers`. `typeFallbackDestination` unchanged (its `collaboration_/session_/board_card_` block already returns the `session` Destination kind, which now lands group chat for free).
**Why:** SC-1, SC-2, SC-3 (both URL shapes via `pathSegments[1] ?? params.id`), SC-4 (`card`), SC-7 (dead-symbol removal), INV-COLLAB-DECK-IN-GROUP-CHAT.
**Lines:** ~34.

### app-mobile/app/index.tsx (CLIENT, dead-code removal required by SC-7)
**Before:** `const [pendingSessionOpen, setPendingSessionOpen] = useState(...)`; 4 handler objects supplied `setPendingSessionOpen`; a `useEffect` cleared `pendingSessionOpen` on Home (no-op v2 seam).
**Now:** state, all 4 handler entries, and the effect removed; comments updated to explain the group-chat routing. The 3 `NavigationHandlers` objects (push, deferred-replay, OS-Linking) now omit the removed handler; executor routes session → connections via `setDeepLinkParams` they already supply.
**Why:** SC-7 (`grep setPendingSessionOpen|openSessionId` → zero in production source).
**Lines:** ~51.

### app-mobile/src/components/ConnectionsPage.tsx (CLIENT, core)
**Before:** the deep-link effect (`tab==='messages'`) resolved `conversationId` and an `eventId` branch only; `onDeepLinkHandled` fired only on success + in the catch.
**Now:** added a `sessionId` branch parallel to `eventId` — resolves `messagingService.getOrCreateGroupConversationForSession(deepLinkParams.sessionId)`, maps the result into a `Conversation` carrying `session_id` + `linked_entity_type:'session'` (so `MessageInterface.isCollabSessionGroupChat` fires and the in-chat deck CTA appears), and opens it. Added an `else if (!cancelled) onDeepLinkHandled?.()` so the no-conversation path (missing group chat OR malformed link) clears the pending deep link.
**Why:** SC-1, SC-2, SC-5, SC-6; the in-chat deck CTA ("deck one tap away").
**Lines:** ~37.

### supabase/functions/notify-dispatch/index.ts (EDGE — S-2, NOT deployed)
**Before:** `typeToPreference` had no `referral_credited` key → it bypassed the opt-out gate (`typeToPreference[type] === undefined` → always sent).
**Now:** added `"referral_credited": "marketing"`.
**Why:** SC-10 (referral opt-out-able). Deep link `mingla://profile?tab=subscription` unchanged.
**Lines:** ~5.

### supabase/functions/notify-message/index.ts (EDGE — S-3, NOT deployed)
**Before:** `direct_card_message` (line 485) emitted `data.deepLink = mingla://messages/${conversationId}` (lossy legacy alias).
**Now:** `mingla://chat/${conversationId}?type=direct` (canonical `chat` parser preserves `type`).
**Why:** SC-11.
**Lines:** ~7.

### .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs (CI gate, REQUIRED with edge change)
**Before:** no ORCH-1080 backend allowlist.
**Now:** `ORCH_1080_BACKEND_ALLOWLIST = ["supabase/functions/notify-dispatch/index.ts", "supabase/functions/notify-message/index.ts"]` + spread into the aggregated `ALLOWLIST`.
**Why:** COMMS-0002 / C7 also flags MODIFIED backend files. Both are modifications (no new files). Gate verified green (§5).
**Lines:** ~13.

### app-mobile/src/services/__tests__/deepLinkRouting.orch1030.test.ts + .adversarial.test.ts ([TEST-MOD-APPROVED ORCH-1080])
**Before:** asserted `session → home` + `setPendingSessionOpen` called (F-01 "never Connections").
**Now:** the **session-routing assertions only** assert `session → connections/messages` carrying `sessionId`, and `sessionOpened === null`. Non-session assertions (profile, calendar, review, paywall, garbage-null, parity, special-case-killer, profile-boundary, null-no-op, exhaustive-no-id) untouched. 22/22 Deno tests pass post-edit.
**Why:** unavoidable — ORCH-1080 inverts the exact routing these locked tests pinned. Authorized via the append-only token in the commit body.

### NEW: app-mobile/src/services/__tests__/orch-1080-session-deeplink-to-group-chat.test.ts (happy-path, fails-on-revert)
### NEW: app-mobile/src/services/__tests__/orch-1080-session-deeplink-adversarial.test.ts (adversarial)

---

## 2. Spec traceability (SC-1 .. SC-11)

| SC | Evidence | Verdict |
|---|---|---|
| SC-1 collab push → group chat | executor `session → setDeepLinkParams({tab:'messages',sessionId}) + setCurrentPage('connections')`; ConnectionsPage resolves sessionId → conversation. Deno T-01 + happy-path test green. | PASS |
| SC-2 accept/match/lock/scheduled/card-msg → same chat | all route via the same `session` Destination (parser + `typeFallbackDestination`). Deno SC-2 test green. | PASS |
| SC-3 tag_along query-form `?id=` | parser `pathSegments[1] ?? params.id`; adversarial test exercises the LIVE parser on `mingla://session?id=...`. | PASS |
| SC-4 `card` param survives | parser preserves `params.card` → Destination.card → executor params.card → `deepLinkParams.card`. happy-path asserts the carry. | PASS |
| SC-5 missing group conversation → graceful | ConnectionsPage `else if (!cancelled) onDeepLinkHandled?.()`; existing catch logs. | PASS (source) |
| SC-6 malformed link → no crash, clears | parser returns `{kind:'page',page:'home'}` for no-id; ConnectionsPage `sessionId` branch guarded by truthy check + the new else clears. | PASS (source) |
| SC-7 zero dead symbols (production) | `grep setPendingSessionOpen\|openSessionId app-mobile/src app-mobile/app` excluding `__tests__` → zero. | PASS |
| SC-8 trial_ending → paywall (verify-only) | unchanged; Deno T-15 asserts `trial_ending → paywall`. | PASS |
| SC-9 birthday → connections/meaningful (edge) | live `notify-birthday-reminder` already emits `mingla://profile/{id}` (more meaningful than `connections`); no change needed. | PASS (already correct) |
| SC-10 referral opt-out-able (edge) | `"referral_credited":"marketing"` added; deep link unchanged. | PASS (deno-checked, deploy pending) |
| SC-11 direct_card_message → chat (edge) | `mingla://chat/{id}?type=direct`. | PASS (deno-checked, deploy pending) |

---

## 3. Edge functions TOUCHED — for orchestrator to DEPLOY at CLOSE (from merged main)

Per COMMS-0015 (deploy from merged main, never worktree) and the deploy carve-out:

- `supabase/functions/notify-dispatch/index.ts` (S-2)
- `supabase/functions/notify-message/index.ts` (S-3)

Deploy command (after PR merges to main, run from the merged-main checkout):
```
supabase functions deploy notify-dispatch --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy notify-message --project-ref gqnoajqerqhnvulmnyvv
```
**No migration. No `db push`.** S-1 (birthday) needs NO deploy (unchanged).

---

## 4. Regression test (the mandatory gate)

**Happy-path:** `app-mobile/src/services/__tests__/orch-1080-session-deeplink-to-group-chat.test.ts`
- Run: `node ./src/services/__tests__/orch-1080-session-deeplink-to-group-chat.test.ts` → `PASS ORCH-1080 happy-path: session deep link → group chat (parser+executor+ConnectionsPage)`
- **fails-on-revert verified at `98f34ff15`** (branch base, pre-fix):
  - Reverting the `deepLinkService.ts` executor `session` branch back to the Home seam → `AssertionError: SC-1: the 'session' executor must route to connections/messages carrying the sessionId`. Restored → PASS.
  - Reverting the `ConnectionsPage.tsx` `sessionId` branch → `AssertionError: SC-1: ConnectionsPage must resolve deepLinkParams.sessionId → group conversation`. Restored → PASS.

**Adversarial (distinct surface):** `app-mobile/src/services/__tests__/orch-1080-session-deeplink-adversarial.test.ts`
- Run → `PASS ORCH-1080 adversarial: dead-code absence + query-form parsing + no deck auto-open`
- Attacks: (1) dead-code eradication across BOTH `deepLinkService.ts` AND `app/index.tsx` (not just the parser); (2) query-form `?id=` parsing via the LIVE `parseDeepLink`; (3) no `CollabDeckSheet` reference in the deep-link path + session executor must route connections, never home. NOT a renamed copy of the happy-path.

---

## 5. Local checks

- `tsc --noEmit` (app-mobile): **0 errors total**, 0 on touched files. (captured `/tmp/orch1080_tsc2.txt`)
- `deno check` notify-dispatch/index.ts → `Check` exit 0; notify-message/index.ts → `Check` exit 0.
- strict-grep `orch-0863-marketing-hub-phase-b.mjs`: **all checks PASS**, `C7: no-new-backend-files` OK (allowlist covers both modified edge files).
- ORCH-1030 Deno suites (post `[TEST-MOD-APPROVED]` edit): **22 passed, 0 failed**.
- Both new node tests: PASS; fails-on-revert proven.
- eslint: **NOT RUNNABLE in this worktree** — eslint v9.37 hangs (timeout 124) on ANY file in this worktree, including UNTOUCHED files (`src/services/supabase.ts` reproduces it), so it is an environment hang (flat `eslint.config.js` + shared anchor node_modules under the bracketed worktree path), not a code defect. `tsc --noEmit` (the stronger type gate) is clean on all touched files. The orchestrator/CI runs `expo lint` on merged main as the authoritative lint gate. Changes are minimal, type-safe edits with explicit returns and no new `any`/`@ts-ignore`.

---

## 6. Cross-surface impact

Covered: Consumer iOS + Consumer Android (shared RN code; parity automatic). Not covered (by design): buyer-web, business iOS/Android, admin, business-web preview — none have `mingla://` deep-link handlers. Matches spec §2.

---

## 7. Invariants

- **INV-COLLAB-DECK-IN-GROUP-CHAT (META-ORCH-0929):** PRESERVED — routes to `connections`/group chat, NOT Home + deck; no `CollabDeckSheet` auto-open; `session_id` carried so the in-chat CTA reaches the deck. Adversarial test guards `doesNotMatch(/CollabDeckSheet/)`.
- **INV-1077-NO-DEAD-SESSION-ROUTE (new):** the `session` route lands group chat; dead `setPendingSessionOpen`/`openSessionId` removed from production source.
- **INV-COMMS-LEDGER:** COMMS-0002 (allowlist added in same commit) + COMMS-0003 (no external-API enums/payloads introduced) acked.

---

## 8. Discoveries for orchestrator

1. **Spec was stale (pre-ORCH-1030).** Documented in §0. The orchestrator should note the spec's §3 snippets do not match shipped code; future ORCHs touching `deepLinkService.ts` must read the typed-Destination architecture, not the spec's `{page:'home'}` shape.
2. **eslint hangs in this worktree (env, not code).** eslint v9.37 times out on ANY file in `~/Desktop/mingla-orchs/ORCH-1080-[…]/app-mobile` — including untouched files — so it could not be used to lint the touched files. Two contributing factors observed: (a) the flat `eslint.config.js` resolves the whole project through the shared anchor node_modules under a bracketed worktree path; (b) running multiple eslint processes in parallel against the SHARED anchor node_modules left `/Users/sethogieva/Desktop/mingla-main/app-mobile/node_modules/globals/globals.json` readable-as-0-bytes (metadata said 47996 bytes; `cat` yielded 0 — APFS read anomaly under concurrent access), which I restored by repacking `globals@14.0.0`. **Lessons:** never run parallel eslint against the shared anchor node_modules from a worktree; CI/`expo lint` on merged main is the authoritative lint gate. tsc clean substitutes for type safety here. Not a code issue.
3. **`direct_card_message` deepLink is nested-only (`data.deepLink`), not top-level.** Per the in-file comment, notify-dispatch nulls a nested-only deepLink (`deepLink: deepLink || null` override). The S-3 normalize fixes the STRING shape as the spec scoped, but if `direct_card_message` push deep links are observed not routing at all, the real fix is to pass `deepLink` top-level (out of ORCH-1080 scope — register if needed).

---

## 9. Comms-ledger acks (this turn)

- **COMMS-0002 (WARN, ALL):** acked — `ORCH_1080_BACKEND_ALLOWLIST` added in the SAME commit as the two edge modifications; C7 verified green. No new backend files.
- **COMMS-0003 (WARN, ALL):** acked — no external-API enums/payloads/endpoints introduced; only `deepLink` string values + one preference-map entry. OneSignal payload shapes unchanged. N/A.
