# SPEC — ORCH-1080 [Notification deep-link map + collab→group-chat routing gap]

**Mode:** SPEC (fix contract). Investigation complete; root cause proven.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1080-[notification-deeplink-collab-groupchat]/` on branch `ORCH-1080-notification-deeplink-collab-groupchat`.
**Source of truth:** `Mingla_Artifacts/reports/ANALYSIS_ORCH-1080_NOTIFICATION_DEEPLINK_MAP.md` (anchor `main`).
**Land target (operator-locked 2026-06-04):** the session's **GROUP CHAT** (Messages). Deck stays one tap away via the existing in-chat CTA. Do **NOT** auto-open `CollabDeckSheet`.
**Date:** 2026-06-04.

> SPEC-author re-confirmation note: every claim below was re-verified against live code on `main` (HEAD `98f34ff15`, which is the branch base). Where the analysis was inaccurate on the lifecycle/reminder rows, this spec **corrects** it inline (see §0.1). The collab root cause and the Option-A fix are confirmed exactly as the analysis describes.

---

## 0. Root cause (re-confirmed, six fields)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/services/deepLinkService.ts:58-62` (`session` parser case) + `:144-149` (`home` executor branch) |
| **Exact code** | Parser: `case 'session': return { page: 'home', params: { openSessionId: pathSegments[1], ...params } };` — Executor: `case 'home': if (params?.openSessionId && handlers.setPendingSessionOpen) { handlers.setPendingSessionOpen(params.openSessionId); } handlers.setCurrentPage('home');` |
| **What it does** | Routes every `mingla://session/{id}` deep link to the Home page and calls `setPendingSessionOpen` — but `setPendingSessionOpen` is **never supplied** by any of the four `executeDeepLink` call sites (`app/index.tsx:477, 785, 1056, 1764`), so the branch is dead and the tap lands on Home and does nothing. |
| **What it should do** | Route to the session's **group chat**: `{ page:'connections', params:{ tab:'messages', sessionId, ...params } }`, then `ConnectionsPage` resolves `sessionId → getOrCreateGroupConversationForSession` and opens that conversation (mirrors the working `eventId` branch). |
| **Causal chain** | edge fn emits `data.deepLink='mingla://session/{id}'` → `onNotificationClicked`/`handleNotificationNavigate` → `parseDeepLink` → `{page:'home', openSessionId}` → `executeDeepLink` → `home` branch, `setPendingSessionOpen` absent → only `setCurrentPage('home')` runs → user sits on Home; group chat never opens. |
| **Verification step** | `grep -rn "setPendingSessionOpen\|openSessionId" app-mobile/src app-mobile/app` returns matches **only** inside `deepLinkService.ts` (zero external consumers) — proven this turn. Confirmed all four call sites pass only `setCurrentPage`/`setShowPaywall`/`setDeepLinkParams`. |

**Why messages already work and collab didn't:** META-ORCH-0929 (2026-05-23) moved collab decks into group chat and updated the *message* deep links to `mingla://chat/{conversationId}?type=group&sessionId={sessionId}` (`supabase/functions/notify-message/index.ts:149-153`), but left the collab-lifecycle deep links pointing at the retired `session` route. Classic docs/code drift: the route survived in the parser as a no-op.

### 0.1 Corrections to the analysis (verified against live code — do not trust the analysis on these rows)

1. **A 6th and 7th dead-route notification exist that the analysis missed:** `supabase/functions/accept-tag-along/index.ts:363` and `:392` emit `mingla://session?id=${collabSessionId}` (types `tag_along_accepted`, `tag_along_match`). This is a **different shape** — `session` is the only path segment and the id is the **query param `id`**, not `pathSegments[1]`. The parser fix below MUST read the session id from `pathSegments[1] ?? params.id` or these two stay broken. These types are absent from `NAV_TARGETS` and `typeToPreference`, so the deep link is their only route.
2. **`trial_ending` ALREADY routes to the paywall.** `supabase/functions/notify-lifecycle/index.ts:143` emits `deepLink: "mingla://subscription"`; the parser `subscription` case (`deepLinkService.ts:105`) → `executeDeepLink` `subscription` branch → `setShowPaywall(true)`. Deep-link-first precedence means the NAV_TARGETS `home` entry never fires. Operator decision (d) is therefore **VERIFY-ONLY** (assert current behavior; no code change required).
3. **`birthday_reminder` is NOT a dead tap.** `supabase/functions/notify-birthday-reminder/index.ts:212` emits `deepLink: "mingla://discover"` → lands on Discover. It is a *weak* target, not a dead one. Retargeting it is an **edge-only** change (see §3.D).
4. **`referral_credited` ALREADY has a deep link.** `supabase/functions/notify-referral-credited/index.ts:55` emits `deepLink: "mingla://profile?tab=subscription"`. The genuine gap is only the missing `typeToPreference` opt-out gate — which is **edge-only** (`notify-dispatch`).
5. **`direct_card_message`** is emitted at `supabase/functions/notify-message/index.ts:476` as `mingla://messages/{conversationId}` — normalizing to `mingla://chat/…` is an **edge-only** change.

---

## 1. Scope & Non-Goals

### 1.1 In scope (operator-locked)

**Primary (client-only, the core bug):**
- **C-1 — Repoint the `session` deep-link route to the group chat.** Fixes ALL collab cases at once with zero edge redeploys. Covers the 5 analysis cases **plus** the 2 tag_along cases (§0.1.1).

**Secondary (reminder/lifecycle gaps — per-item routing in §3, with client-vs-server called out explicitly):**
- **C-2 (b)** — `board_card_message` must carry the `card` param through to the deck (param plumbing only; no deck-scroll feature).
- **S-1 (c)** — `birthday_reminder` → a more meaningful destination (edge-only; see §3.D).
- **VERIFY-1 (d)** — `trial_ending` → paywall (already true; assert only).
- **S-2 (e)** — `referral_credited` → add the missing `typeToPreference` opt-out gate (edge-only).
- **S-3 (f)** — normalize `direct_card_message` from `mingla://messages/` to `mingla://chat/` (edge-only).

### 1.2 Non-goals (explicit)

- **No collab-architecture redesign.** Home is solo-only forever; the deck lives in `CollabDeckSheet` reached from inside group chat (META-ORCH-0929, immutable). This spec does NOT auto-open the deck.
- **No `mingla-business` (business-app) changes.** Business notification handlers are entirely absent; deferred to a separate ORCH (see Discoveries).
- **No deck-scroll-to-card feature.** C-2 plumbs the `card` param through only; building scroll-to-card is a future ORCH.
- **No DB migration, no `db push`, no edge deploy by this skill.** Edge-side items (S-1/S-2/S-3) are specified for the implementor + operator to deploy on CLOSE per the standard deploy carve-out.

### 1.3 Assumptions

- A1: Every in-scope session has a `conversations` row with `linked_entity_type='session'` + `session_id` by the time its collab notification is tapped. `getOrCreateGroupConversationForSession` is **lookup-only** (`messagingService.ts:1002-1014`, `.maybeSingle()`); if the row is missing it returns `{conversation:null, error:'Group conversation not found for this session'}`. The spec requires a graceful fallback for that case (§3.B SC-5).
- A2: The four `executeDeepLink` call sites all already pass `setDeepLinkParams` (verified lines 480, 788, 1059, 1767), so repointing `session → connections` automatically forwards `tab`/`sessionId` to `ConnectionsPage`. No call-site edits required.

---

## 2. Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behavior / paths / parity |
|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ YES | Tapping any collab/session push or in-app notification opens the session's group chat. Files: `deepLinkService.ts`, `ConnectionsPage.tsx`. Shared RN code → parity with Android is **automatic**. |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ YES | Identical to iOS via the same shared code path. Parity automatic (single success criterion set; no per-platform divergence in the touched files). |
| 3 | **Buyer/anonymous Web** (`mingla-business/` checkout/public routes) | ❌ NO | No push, no `mingla://` deep links exposed on buyer-web. |
| 4 | **Business iOS** (`mingla-business/`) | ❌ NO | Out of scope (operator-locked). Business app has no notification tap/deep-link handlers at all — deferred to a separate ORCH. |
| 5 | **Business Android** (`mingla-business/`) | ❌ NO | Same as #4. |
| 6 | **Admin Web** (`mingla-admin/`) — adjacent | ❌ NO | Admin doesn't render or receive push. |
| 7 | **Business Web preview** — adjacent | ❌ NO | No notification surface. |

Parity is **automatic** across the two covered surfaces (iOS + Android) because the only client files touched (`deepLinkService.ts`, `ConnectionsPage.tsx`) are shared RN modules with no platform fork. No separate per-platform success criteria are required; a single set of SCs (§4) governs both. The tester must still live-fire on both an iOS sim and an Android emulator per the parity rule.

---

## 3. The fix, layer by layer (exact before/after)

### 3.A — Client: `app-mobile/src/services/deepLinkService.ts` 🔒 LOCKED

#### 3.A.1 Repoint the `session` parser case (lines 58-62)

**BEFORE:**
```ts
      case 'session':
        return {
          page: 'home',
          params: { openSessionId: pathSegments[1], ...params },
        };
```

**AFTER:**
```ts
      case 'session': {
        // ORCH-1080: collab/session notifications land in the session's GROUP CHAT
        // (deck is one tap away via the in-chat CTA). META-ORCH-0929: there is no
        // home-mounted session deck anymore. Accept BOTH shapes:
        //   mingla://session/{id}        (collab lifecycle: invite/accept/match/lock/card-msg)
        //   mingla://session?id={id}     (tag_along_accepted / tag_along_match)
        const sessionId = pathSegments[1] ?? params.id;
        return {
          page: 'connections',
          params: { tab: 'messages', sessionId, ...params },
        };
      }
```

Notes (LOCKED):
- `sessionId` MUST be derived as `pathSegments[1] ?? params.id` — both source shapes exist live (§0.1.1). Do not drop the query-form.
- `...params` MUST be spread AFTER the explicit keys so an existing `tab`/`sessionId` query param can override only if intentionally present; in practice the explicit keys win for the path-form and `params.id` is preserved for the query-form. Keep `card` flowing through (`...params` carries it — satisfies C-2 for `board_card_message`).
- When `sessionId` is `undefined` (malformed link) the effect in §3.B short-circuits gracefully (SC-6).

#### 3.A.2 Delete the dead `openSessionId`/`setPendingSessionOpen` code

**Executor (lines 144-149) BEFORE:**
```ts
    case 'home':
      if (params?.openSessionId && handlers.setPendingSessionOpen) {
        handlers.setPendingSessionOpen(params.openSessionId);
      }
      handlers.setCurrentPage('home');
      break;
```
**AFTER:**
```ts
    case 'home':
      handlers.setCurrentPage('home');
      break;
```

**Interface (line 17) — remove the now-unused handler:**
```ts
// DELETE this line from NavigationHandlers:
  setPendingSessionOpen?: (sessionId: string) => void;
```

LOCKED: after this change, `grep -rn "setPendingSessionOpen\|openSessionId" app-mobile` MUST return **zero** matches anywhere in `app-mobile/`. The dead code is fully removed, not orphaned.

### 3.B — Client: `app-mobile/src/components/ConnectionsPage.tsx` 🔒 LOCKED

Add a `sessionId` branch to the existing deep-link effect (lines 2036-2094), parallel to the `eventId` branch (lines 2056-2078).

**INSERT immediately after the `eventId` block (after line 2078, before the `if (!cancelled && rawConversation)` check at 2080):**

```ts
        if (!rawConversation && deepLinkParams.sessionId) {
          // ORCH-1080: collab/session notifications resolve sessionId → group chat,
          // mirroring the eventId branch above. Deck is reached via the in-chat CTA.
          const { conversation, error } =
            await messagingService.getOrCreateGroupConversationForSession(
              deepLinkParams.sessionId,
            );
          if (error) throw new Error(error);
          if (conversation) {
            rawConversation = {
              id: conversation.id,
              created_by: conversation.created_by ?? '',
              created_at: conversation.created_at,
              participants: conversation.participants.map((p) => ({
                id: p.user_id,
                username: 'user',
              })),
              last_message: conversation.last_message as unknown as ConvMessage | undefined,
              unread_count: conversation.unread_count ?? 0,
              messages: [],
              type: conversation.type,
              name: conversation.name ?? 'Session chat',
              session_id: conversation.session_id ?? deepLinkParams.sessionId,
              linked_entity_type: conversation.linked_entity_type,
            } as Conversation;
          }
        }
```

LOCKED contract:
- The branch runs only when no conversation was already resolved (`!rawConversation`) AND `deepLinkParams.sessionId` is truthy — so a malformed `session` link with no id (SC-6) falls straight through to the existing `if (!cancelled && rawConversation)` guard, which is false → effect ends without opening anything and calls `onDeepLinkHandled?.()` via the existing catch/finally semantics. (Note: the existing code only calls `onDeepLinkHandled?.()` inside the success branch and the catch. To avoid a stuck `deepLinkParams`, the implementor MUST ensure `onDeepLinkHandled?.()` is also called when no conversation resolves — see SC-6 / regression T-04. Add an `else { if (!cancelled) onDeepLinkHandled?.(); }` after the success guard if not already covered.)
- The mapped object MUST carry `session_id` (parallel to how the event branch carries `event_id`) so `MessageInterface` can detect `isCollabSessionGroupChat` (`MessageInterface.tsx:257`: `isGroupChat && linkedEntityType==='session' && !!sessionId`) and surface the in-chat deck CTA. Dropping `session_id` here breaks the "deck one tap away" requirement → P1.
- Reuse `messagingService` (already imported in this file — verified used at lines 2045, 2058, 2132) and the `Conversation`/`ConvMessage` types already in scope. No new imports unless `getOrCreateGroupConversationForSession`'s return shape requires a field not already typed (it does not — it returns the same `Conversation` shape, minus `event_id`/`is_broadcast_only`, plus `session_id`).
- The effect dependency array stays `[deepLinkParams, user?.id]` (unchanged); `getOrCreateGroupConversationForSession` is a service singleton, stable.

### 3.C — `board_card_message` `card` param (C-2) 🔒 LOCKED, client-only

`notify-message/index.ts:522` already emits `mingla://session/${sessionId}?card=${savedCardId}`. The §3.A.1 fix spreads `...params`, so `card` is preserved into `{ tab:'messages', sessionId, card }` and forwarded by `setDeepLinkParams`. **No additional code** is required for the param to survive into `ConnectionsPage`'s `deepLinkParams.card`. The deck-scroll consumer is explicitly out of scope; this spec only guarantees the param is not dropped. Verified by regression T-03.

### 3.D — Edge-side items (S-1 / S-2 / S-3) — FLAGGED as server changes ⚠️

These three cannot be done client-only; each is justified below. They are **independent** of the core client fix and may ship in the same PR but MUST be called out in the CLOSE deploy step (no `db push` here; edge deploy from merged main per the deploy carve-out and COMMS-0015).

| ID | Item | File + line | Change | Why it can't be client-only |
|---|---|---|---|---|
| **S-1 (c)** | `birthday_reminder` weak target | `supabase/functions/notify-birthday-reminder/index.ts:212` | Change `deepLink: "mingla://discover"` → `deepLink: "mingla://connections?tab=requests"` (or `mingla://connections` — operator's call; connections is where the paired friend lives). | The destination is decided by the edge fn's emitted `deepLink`; the client parser already handles `connections`. No `actor_id` is available (`actorId:null` at :217) so a friend-profile deep link isn't possible without an edge-side lookup — keep it to `connections`. |
| **S-2 (e)** | `referral_credited` not opt-out-able | `supabase/functions/notify-dispatch/index.ts:158-194` (`typeToPreference` map) | Add `"referral_credited": "marketing",` (or a dedicated key if the prefs schema has one; `marketing` is the closest existing bucket — confirm against the `notification_preferences` columns before choosing). The deep link `mingla://profile?tab=subscription` already exists and works. | The opt-out gate is server-side (`notify-dispatch` reads `typeToPreference[type]` at :399 to decide whether to send). The client cannot add an opt-out gate. |
| **S-3 (f)** | `direct_card_message` uses `messages` not `chat` | `supabase/functions/notify-message/index.ts:476` | Change `deepLink: \`mingla://messages/${conversationId}\`` → `deepLink: \`mingla://chat/${conversationId}?type=direct\``. | The emitted string is server-side. The client `chat` parser case (`deepLinkService.ts:68-78`) already preserves group/session/type params; `messages` (`:63-67`) is the lossy legacy shape. Cosmetic for direct card messages (no session), but aligns the contract and keeps `type` flowing. |

> S-2 backend allowlist note (COMMS-0002): if the implementor touches any file under `supabase/functions/`, the ORCH-0863 strict-grep C7 `no-new-backend-files` gate applies. S-1/S-2/S-3 only **modify** existing files (no new files), so C7 should not trip — but the implementor MUST run the strict-grep gate locally and add an `ORCH_1080_BACKEND_ALLOWLIST` entry only if a new backend file is introduced (it should not be). COMMS-0003 (external-API docs): no external API enums/payloads are introduced; OneSignal payload shapes are unchanged. Acked below.

### 3.E — VERIFY-1 (d): `trial_ending` → paywall 🔒 LOCKED (assert-only, no code)

No change. `notify-lifecycle:143` already emits `mingla://subscription`; parser `subscription` → `setShowPaywall(true)`. The implementor asserts this is intact (regression T-05). If a future refactor removes the deepLink, the NAV_TARGETS entry (`trial_ending:"home"`, index.tsx:619) would silently regress it to Home — so T-05 guards the deepLink emission.

---

## 4. Success criteria (observable, testable, unambiguous)

Single set; applies to **Consumer iOS + Consumer Android** (parity automatic).

- **SC-1** — Tapping a `collaboration_invite_received` push (deepLink `mingla://session/{id}`) opens the session's group chat in the Messages tab (conversation visible, deck CTA present inside the chat). Not Home.
- **SC-2** — Same for `collaboration_invite_accepted`, `board_card_matched`, `session_plan_scheduled` (and `session_card_locked`), and `board_card_message` — all land in the same session's group chat.
- **SC-3** — Tapping a `tag_along_accepted` / `tag_along_match` push (deepLink `mingla://session?id={id}`, query form) ALSO opens the session group chat (proves `pathSegments[1] ?? params.id`).
- **SC-4** — `board_card_message`'s `card` param survives into `ConnectionsPage` `deepLinkParams.card` (forwarded, not dropped). No deck-scroll behavior is required.
- **SC-5** — When the session's group conversation cannot be resolved (`getOrCreateGroupConversationForSession` returns `{conversation:null}`), the app lands on the Connections/Messages tab without crashing and clears the pending deep link (`onDeepLinkHandled` fires); no infinite spinner, no unhandled rejection (the existing `catch` logs `[ConnectionsPage] Failed to open trip/event chat deep link`).
- **SC-6** — A malformed `mingla://session` link with no id and no `id` param does not crash; the effect short-circuits (no conversation opened) and clears the pending deep link.
- **SC-7** — `grep -rn "setPendingSessionOpen\|openSessionId" app-mobile` returns zero matches (dead code fully removed).
- **SC-8 (VERIFY-1/d)** — `trial_ending` push still opens the paywall (`mingla://subscription` → `setShowPaywall(true)`), unchanged.
- **SC-9 (S-1/c)** — `birthday_reminder` deepLink emits `mingla://connections...` (not `discover`). [Edge — verify on deploy.]
- **SC-10 (S-2/e)** — `referral_credited` appears in `typeToPreference` so it is opt-out-able; its `mingla://profile?tab=subscription` deep link still routes to the profile/subscription view. [Edge — verify on deploy.]
- **SC-11 (S-3/f)** — `direct_card_message` deepLink emits `mingla://chat/{conversationId}?type=direct` (not `mingla://messages/...`) and the conversation still opens. [Edge — verify on deploy.]

---

## 5. Invariants

| ID | Invariant | How preserved | Test |
|---|---|---|---|
| **INV-COLLAB-DECK-IN-GROUP-CHAT** (META-ORCH-0929) | Home is solo-only; the collab deck mounts ONLY in `CollabDeckSheet` reached from inside group chat. No `currentMode`/`sessionIdOverride` routing on Home. | The fix routes to `connections` + group chat, NOT Home + deck. No deck auto-open. The `session_id` is carried so the in-chat CTA appears. | T-01, T-02 assert `page:'connections'` and no `CollabDeckSheet` auto-mount. |
| **INV-1077-NO-DEAD-SESSION-ROUTE** (NEW) | The `session` deep-link route resolves to the group chat (never the dead Home/openSessionId path). | §3.A.1 + §3.B; dead code deleted (§3.A.2). | T-01 (FAILS-ON-REVERT), T-07 (no dead-code symbols). |
| **INV-COMMS-LEDGER** | Ledger read on entry; ack the relevant WARN rows. | COMMS-0002/0003 acked (client-only; no new backend files, no external API enums). | n/a (process). |

NEW invariant proposed for the registry: **I-1077-SESSION-DEEPLINK-TO-GROUP-CHAT** — the `session` parser case in `deepLinkService.ts` MUST map to `{page:'connections', params:{tab:'messages', sessionId}}` and MUST NOT reference `home`, `openSessionId`, or `setPendingSessionOpen`. Enforced by T-01 + T-07 (a strict-grep gate is optional and not required by this spec).

---

## 6. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Path-form session link repointed | `parseDeepLink('mingla://session/abc')` | `{page:'connections', params:{tab:'messages', sessionId:'abc'}}` | Parser |
| T-02 | Executor routes to connections | `executeDeepLink({page:'connections',params:{tab:'messages',sessionId:'abc'}}, handlers)` | `setDeepLinkParams` called with those params; `setCurrentPage('connections')`; `setPendingSessionOpen` NOT in handlers | Executor |
| T-03 | `card` param preserved | `parseDeepLink('mingla://session/s1?card=c9')` | result `params.card === 'c9'` and `sessionId==='s1'` | Parser |
| T-04 | Query-form tag_along | `parseDeepLink('mingla://session?id=s2')` | `params.sessionId === 's2'` (from `params.id` fallback) | Parser |
| T-05 | trial_ending still paywall | source assert on `notify-lifecycle/index.ts` | emits `mingla://subscription` for `trial_ending` | Edge source |
| T-06 | ConnectionsPage has sessionId branch | source assert on `ConnectionsPage.tsx` | contains `getOrCreateGroupConversationForSession(` inside the deep-link effect, mapping `session_id` | Component source |
| T-07 | Dead code gone | grep `app-mobile/` | zero `setPendingSessionOpen` / `openSessionId` | Static |
| T-08 | No deck auto-open | source assert on `deepLinkService.ts` + `index.tsx` call sites | `session` case never returns `page:'home'`; no `CollabDeckSheet` open in deep-link path | Static / contract |

### 6.1 The two REQUIRED regression tests (concrete real paths)

Both follow the existing **source-assertion** pattern (`app-mobile/src/services/__tests__/*.test.ts` — standalone node files using `node:assert/strict`, guarded by `import.meta.url === \`file://${process.argv[1]}\``, run via `node <file>`). This matches `collabDeadEndBannerService.test.ts` exactly.

**Regression #1 — happy-path that FAILS-ON-REVERT**
**Path:** `app-mobile/src/services/__tests__/orch-1080-session-deeplink-to-group-chat.test.ts`
Imports/reads `src/services/deepLinkService.ts` source AND `src/components/ConnectionsPage.tsx` source and asserts the new contract:
- `[FAILS-ON-REVERT KEY]` the `session` case maps to `page: 'connections'` with `tab: 'messages'` and a `sessionId` derived from `pathSegments[1] ?? params.id` — `assert.match(deepLinkSrc, /case 'session':[\s\S]*?page:\s*'connections'[\s\S]*?tab:\s*'messages'[\s\S]*?sessionId/)` and `assert.match(deepLinkSrc, /pathSegments\[1\]\s*\?\?\s*params\.id/)`.
- `assert.doesNotMatch(deepLinkSrc, /case 'session':[\s\S]*?page:\s*'home'/)` — the dead Home route is gone.
- `assert.match(connectionsSrc, /getOrCreateGroupConversationForSession\(\s*deepLinkParams\.sessionId/)` and `assert.match(connectionsSrc, /session_id:\s*conversation\.session_id/)` — the ConnectionsPage branch exists and carries `session_id`.
- Reverting EITHER edit (parser repoint or ConnectionsPage branch) fails this test.

**Regression #2 — distinct adversarial angle (dead-code + query-form + no-deck-autoopen)**
**Path:** `app-mobile/src/services/__tests__/orch-1080-session-deeplink-adversarial.test.ts`
Different failure surface from #1:
- **Dead-code eradication:** read `deepLinkService.ts` AND every `executeDeepLink` call site in `app/index.tsx`; `assert.doesNotMatch` for `setPendingSessionOpen` and `openSessionId` in BOTH (catches a partial fix that repoints the parser but leaves the dead executor branch / interface).
- **Query-form coverage:** assert the parser source contains the `params.id` fallback so `mingla://session?id=X` (tag_along) is honored — guards the analysis-missed 6th/7th case (§0.1.1). A pure path-form fix would pass #1 but fail here.
- **No deck auto-open (INV-COLLAB-DECK-IN-GROUP-CHAT):** `assert.doesNotMatch(deepLinkSrc, /CollabDeckSheet/)` and assert the `session` case does NOT return `page:'home'` — proves the land target is group chat, not the deck and not Home.

Both tests are pure source-assertion (no RN render harness), runnable in CI exactly like the existing service tests, and target two genuinely different revert surfaces (functional repoint vs. dead-code/edge-shape/architecture-guard).

---

## 7. Implementation order

1. **`deepLinkService.ts`** — repoint `session` case (§3.A.1); delete dead `home`-branch code + `setPendingSessionOpen` from `NavigationHandlers` (§3.A.2).
2. **`ConnectionsPage.tsx`** — insert the `sessionId` branch (§3.B); ensure `onDeepLinkHandled` fires on the no-conversation path (SC-5/SC-6).
3. **Regression tests** — add the two `__tests__` files (§6.1); run `node <file>` for each → PASS.
4. **(Edge, optional in same PR — flagged)** S-1 (`notify-birthday-reminder`), S-2 (`notify-dispatch` typeToPreference), S-3 (`notify-message` direct_card_message). No new backend files; verify strict-grep C7 stays green. Edge deploy + verify happen at CLOSE from merged main (not from worktree) per COMMS-0015 — NOT by this skill.
5. Live-fire on iOS sim + Android emulator (tester): SC-1 through SC-8.

---

## 8. Regression prevention

- The dead `session→home` route recurs as docs/code drift when a route is retired but left in the parser as a no-op. **Structural safeguard:** T-01/T-07 + the proposed `I-1077-SESSION-DEEPLINK-TO-GROUP-CHAT` invariant assert the route maps to group chat and the dead symbols are absent. A protective comment (§3.A.1) states *why* (META-ORCH-0929 retired the home-mounted deck).
- Query-form vs path-form drift (the analysis-missed tag_along case) is guarded by the `params.id` fallback + adversarial test #2.

---

## 9. Client-only-vs-server question — DEFINITIVE ANSWER

- **The core bug (all 7 collab/session notification types: `collaboration_invite_received`, `collaboration_invite_accepted`, `board_card_matched`, `session_plan_scheduled`/`session_card_locked`, `board_card_message`, `tag_along_accepted`, `tag_along_match`) is fixed 100% CLIENT-SIDE** — two files (`deepLinkService.ts`, `ConnectionsPage.tsx`), zero edge redeploys, zero migrations. None of the 5 (or 7) edge functions need the `conversationId`; the client resolves `sessionId → conversation` via the existing `getOrCreateGroupConversationForSession`. This is the operator's preferred Option A, confirmed viable against live code.
- **Three secondary lifecycle items genuinely require edge changes** and are flagged explicitly:
  - **S-1 (birthday retarget)** — `notify-birthday-reminder/index.ts:212` (server: the emitted deepLink is server-owned).
  - **S-2 (referral opt-out gate)** — `notify-dispatch/index.ts` `typeToPreference` (server: the preference gate is server-side; the deep link already works).
  - **S-3 (direct_card_message normalize)** — `notify-message/index.ts:476` (server: the emitted string is server-owned; cosmetic).
- **VERIFY-1 (trial_ending paywall)** needs **no change** — already correct on `main`.

---

## 10. Comms-ledger acks (this entry)

- **COMMS-0002 (strict-grep backend allowlist):** factored — client-only core fix touches no `supabase/functions/` files; S-1/S-2/S-3 only modify existing backend files (no new files), so C7 should not trip. Implementor runs the gate; adds `ORCH_1080_BACKEND_ALLOWLIST` only if a new backend file is introduced (not expected).
- **COMMS-0003 (external-API docs cited inline):** factored — no external-API enums, payload shapes, or endpoints are introduced or modified (OneSignal push payload shapes unchanged; only `deepLink` string values and one preference-map entry). N/A.
