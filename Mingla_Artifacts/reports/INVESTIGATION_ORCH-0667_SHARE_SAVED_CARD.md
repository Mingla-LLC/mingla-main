# INVESTIGATION — ORCH-0667 — Share Saved Card button is a stub

**Mode:** INVESTIGATE-ONLY
**Severity:** S1 → recommend **stay at S1** (not launch-blocking, but a constitutional dead-tap that lies via toast)
**Confidence:** **HIGH** on root cause, schema gap, blast radius. **HIGH** on bisect.
**Date:** 2026-04-25
**Investigator:** Mingla Forensics (orchestrator-dispatched, user invoked TAKE OVER)
**Dispatch:** `prompts/FORENSICS_ORCH-0667_SHARE_SAVED_CARD_PICKER.md`

---

## 1 — Layman summary

The "Share Saved Card" button in the DM more-options menu is theatre. Tap it and the app
fires a green toast that says "A saved experience has been shared with [friend]" — but
nothing actually happened. No card is picked. No message lands in the chat. The recipient
never sees a thing. This is the truest definition of a constitutional dead-tap (#1) plus
fake-success (#3) plus fabricated UI state (#9), all stacked on the chat surface that's
central to Mingla's positioning as an experience app.

The fix is **not** a one-file change. The chat database schema does not currently support
card-type messages — `messages.message_type` is constrained to `text | image | video | file`
by a CHECK constraint, and there is no `card_payload` column. So shipping the founder's
target flow ("show all my saved cards, let me pick one, deliver it as a tappable bubble in
chat") requires: a new migration with a new `message_type='card'` value plus a payload
column plus updated RLS, an updated `messagingService.sendMessage` signature, a new picker
modal in `MessageInterface.tsx`, a new card-bubble renderer in the chat message list, an
optional new `notify-message` notification type for push delivery, and a way to open
`ExpandedCardModal` from inside the chat surface (which is currently impossible).

Recommended scope: single-select picker (mirror iMessage attachment pattern), snapshot
payload (store relevant card_data in `card_payload jsonb` so the bubble survives the
place being dropped from the pool), bubble + push for v1 delivery, deep-link to the chat
on tap of push, in-chat tap opens a locally-mounted `ExpandedCardModal`.

---

## 2 — Symptom summary

| Field | Value |
|-------|-------|
| **Expected** | Tap "Share Saved Card" → picker opens with all the user's saved cards → user selects one → card delivered as a tappable bubble in the chat that opens the full ExpandedCardModal on tap. Recipient also gets in-app notification + push (matching the pattern for `direct_message`). |
| **Actual** | Tap "Share Saved Card" → success toast fires ("A saved experience has been shared with {friend}") → menu closes → nothing else. No picker. No DB write. No message inserted. No notification. No push. The recipient sees nothing now or later. |
| **Reproduction** | 100% deterministic — every tap fires the exact same toast-only handler regardless of friend, time, or chat state. |
| **Bisect** | Missing-feature, NOT regression. Introduced in commit `de16b724` (2025-11-26 "saved card") as a stub. Has been a stub for ~5 months; only diff since (`1fd48004`) was an i18n migration that swapped hardcoded English strings for translation keys — same behavior. Founder report dated 2026-04-25 is the first time this has surfaced. |

---

## 3 — Investigation manifest (files read in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/components/MessageInterface.tsx:99,128,614-621,777-783,1351-1358` | Both DM entry points + handler |
| 2 | `app-mobile/src/components/AppHandlers.tsx:340-355,872` | Terminal toast-only handler + export |
| 3 | `app-mobile/src/components/ConnectionsPage.tsx:82,280,1996-1997,2206` | Prop-drilling chain |
| 4 | `app-mobile/app/index.tsx:2129,2417` | Top-level wiring of `handlers.handleShareSavedCard` |
| 5 | `app-mobile/src/services/messagingService.ts` (full file) | Schema types + send pipeline + realtime subscription + notification fan-out |
| 6 | `supabase/migrations/20250128000003_create_direct_messaging.sql` | `messages` table definition + RLS + check-constraint (verified as latest authoritative migration via grep) |
| 7 | `app-mobile/src/services/savedCardsService.ts` (full file) | `fetchSavedCards` returns merged solo + board saves with full `card_data` JSONB |
| 8 | `app-mobile/src/hooks/useSavedCards.ts` (full file) | React Query consumer, 5-min staleTime, 10-min gcTime |
| 9 | `app-mobile/src/components/MessageInterface.tsx:587-612,1241-1315` | BoardSelectionSheet inline modal (analog UI pattern) |
| 10 | `app-mobile/src/components/board/BoardDiscussionTab.tsx`, `BoardDiscussion.tsx`, `board/CardDiscussionModal.tsx` | Parity check — confirmed NO share-card UI on board / collab surfaces |
| 11 | `supabase/functions/notify-message/index.ts:1-241` | Existing notification types (`direct_message`, `board_message`, `board_mention`, `board_card_message`) — confirmed NO existing type for "card shared via DM" |
| 12 | `git log -L 340,355:app-mobile/src/components/AppHandlers.tsx` | Bisect proving missing-feature (not regression) |
| 13 | Repo-wide grep for `ExpandedCardModal` usage | ExpandedCardModal NOT currently mounted from MessageInterface — cross-surface render gap |
| 14 | `Mingla_Artifacts/reports/VERIFICATION_PUSH_DELIVERY_MATRIX.md:54` | Pre-existing flag: "Someone saved card you shared — NEVER BUILT" |

---

## 4 — Findings

### 🔴 RC-1 — `handleShareSavedCard` is a toast-only stub

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/AppHandlers.tsx:340-355` |
| **Exact code** | ```const handleShareSavedCard = (friend: any, suppressNotification?: boolean) => { if (!suppressNotification) { const notification = { id: `share-saved-card-${Date.now()}-${friend.id}`, type: "success" as const, title: i18n.t('common:toast_card_shared'), message: i18n.t('common:toast_card_shared_msg', { name: friend.name }), autoHide: true, duration: 3000, }; setNotifications((prev: any) => [...prev, notification]); } };``` |
| **What it does** | Receives `(friend, suppressNotification)`. If `suppressNotification` is truthy, does **literally nothing**. Otherwise pushes a "success" notification to local state. No card is read from anywhere. No DB call. No message insert. No edge-fn invocation. No recipient lookup. |
| **What it should do** | Open a picker showing the user's saved cards (powered by existing `useSavedCards` hook), let the user select one, insert a `'card'`-type message into the `messages` table containing the card payload, then trigger the in-app notification + push pipeline so the recipient sees the bubble + gets pinged. |
| **Causal chain** | User taps "Share Saved Card" (`MessageInterface.tsx:778` or `:1353`) → `handleShareSavedCard` local handler (`MessageInterface.tsx:614`) → calls `onShareSavedCard?.(friend, true)` (suppressNotification=true) → `MessageInterface` independently fires its OWN `showNotification` ("Card shared!" / "A saved experience has been shared with {name}") at `:617-620` → prop traverses `ConnectionsPage.tsx:2206 → 1996-1997 → 280 → 82` → `app/index.tsx:2129` or `:2417` wires to `handlers.handleShareSavedCard` → terminal stub at `AppHandlers.tsx:340` returns immediately because `suppressNotification === true`. The local toast in `MessageInterface` is the ONLY observable side-effect. The terminal handler does nothing in the wired path. |
| **Verification** | `git log -L 340,355:app-mobile/src/components/AppHandlers.tsx` shows the function has had this exact body since commit `de16b724` (2025-11-26 "saved card"). Only diff since is an i18n string migration. There is no edge function called `share-saved-card` (verified via `ls supabase/functions/`). There is no `notifications` row insertion path for "card shared via DM" (verified by grep on `direct_card_message`, `card_share`, `shared_card` across the entire repo — zero hits). The recipient cannot receive what was never sent. **Confidence: HIGH.** |

**Classification rationale:** This is THE root cause. Every other finding either makes
this worse or describes downstream missing infrastructure. The stub is the headwater.

---

### 🟠 CF-1 — `messages.message_type` CHECK constraint blocks card-type messages at the schema layer

| Field | Evidence |
|-------|----------|
| **File + line** | `supabase/migrations/20250128000003_create_direct_messaging.sql:39` |
| **Exact code** | `message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'video', 'file'))` |
| **What it enforces** | Postgres rejects any INSERT with `message_type` not in the four allowed values. Trying to insert a card-type row would return error code `23514` (check_violation). |
| **What it should support** | Either a new value (`'card'`) added to the CHECK constraint, OR a structurally different solution (separate `card_payload` column + a `'card'` discriminator). |
| **Migration chain rule applied** | Grepped all 293 migrations for `message_type` and `messages_message_type_check` — only ONE migration (the original) touches it. No later `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …` exists. The original CHECK is current authoritative truth. |
| **Causal contribution** | Even if RC-1 were fixed today (handler wired up to insert a row), the insert would fail with HTTP 400 because the schema rejects unknown `message_type`. The schema gap is BLOCKING, not just inconvenient. |
| **Confidence** | **HIGH.** Migration chain audited. Constraint is authoritative. |

---

### 🟠 CF-2 — Chat message renderer has no card-bubble code path

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/services/messagingService.ts:722-731` (preview path) and the chat list rendering in `ConnectionsPage.tsx` (NOT inspected in detail — flagged for spec to enumerate) |
| **What it does** | `sendMessageNotifications` builds a message preview by switching on `message.message_type`: `'image' → '📷 Photo'`, `'video' → '🎥 Video'`, `'file' → '📄 {filename}'`, default `→ message.content`. There is no `'card'` branch. The chat list bubble component (likely in `ConnectionsPage` or a child) similarly has no code path for rendering a card-type bubble. |
| **Causal contribution** | Even if RC-1 + CF-1 were fixed, an inserted `'card'`-type message would render as either nothing (if the renderer hard-asserts on known types) or as fallback `message.content` text (if the renderer is lenient). Neither is the founder's target UX. |
| **Verification** | Grep on `message_type === 'card'` returns zero hits across the repo. Grep on the existing `'image' | 'video' | 'file'` branches confirms exhaustive coverage of currently-supported types only. |
| **Confidence** | **HIGH** that the renderer has no card path. **MEDIUM** on exact failure mode (whether unknown type renders as text fallback or as nothing — spec writer must trace the message-list component). |

---

### 🟡 HF-1 — Toast text fabricates a success state (Constitution #9 violation)

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/components/MessageInterface.tsx:617-620` (local toast) and `app-mobile/src/i18n/locales/en/chat.json:56` (`cardSharedMessage`) and `en/common.json:132` (`toast_card_shared_msg`) |
| **Exact code** | ```showNotification(t('chat:cardShared'), t('chat:cardSharedMessage', { name: friend.name }));``` (in `MessageInterface`) and `"toast_card_shared_msg": "A saved experience has been shared with {{name}}"` (in 28 locale files). |
| **Why it's a flaw** | The string asserts an action that did not occur. No card was shared. No experience was delivered. The user is shown a success state that is factually false. This is the textbook Constitution #9 violation: the UI is fabricating data (in this case, "the share happened"). |
| **Why hidden flaw, not contributing factor** | Removing the toast wouldn't fix the bug — the bug is "share doesn't happen." The toast is what makes the bug invisible (user thinks it worked, doesn't report it). It's also what made the bug survive 5 months without a founder report. |
| **Bundle into fix** | Yes — when the real flow is implemented, the toast must reflect actual state. v1 candidates: "Card sent" (after successful insert + ack), "Couldn't send. Try again." (on error). The current "shared with {name}" is fine if it fires only on real success. |
| **Confidence** | **HIGH.** |

---

### 🟡 HF-2 — `ExpandedCardModal` cannot currently be opened from `MessageInterface`

| Field | Evidence |
|-------|----------|
| **File + line** | `MessageInterface.tsx` (no import of `ExpandedCardModal`, no local mount, no `setShowExpandedCard` state). Repo grep for `ExpandedCardModal` returns 9 mount sites (SwipeableCards, SavedTab, CalendarTab, ViewFriendProfileScreen, PersonHolidayView, SessionViewModal, DiscoverScreen, ExpandedCardModal itself, AppHandlers/busynessService) — NONE in the chat surface. |
| **Why it's a flaw** | The founder's target UX is "tap the card bubble, see the full expanded card." That requires either (a) MessageInterface mounting its own ExpandedCardModal instance, (b) the modal being lifted to a global / context-mounted overlay accessible from anywhere, or (c) chat tap navigates the user OUT of chat to a screen that already has the modal (jarring UX). |
| **Why hidden flaw, not contributing factor** | Doesn't block the basic share-and-deliver flow — a card bubble can render WITHOUT being tappable initially. But shipping a non-tappable bubble would be a Constitution #1 mini-violation (semi-dead element). |
| **Bundle into fix** | Yes — spec must specify the bubble's tap behavior. Recommendation: option (a) local mount, because `ExpandedCardModal` already accepts `card` and `isOpen` props and is self-contained. Adds ~5 lines to MessageInterface. |
| **Confidence** | **HIGH** that no chat-surface mount exists. **MEDIUM** on best path forward (a/b/c) — spec writer should weigh the global-overlay refactor cost against per-surface mount churn. |

---

### 🔵 OBS-1 — `notify-message` already has a card-related notification type, but it's the WRONG one

| Field | Evidence |
|-------|----------|
| **File + line** | `supabase/functions/notify-message/index.ts:23,210-241` |
| **Detail** | The edge function supports `type: 'board_card_message'` with fields `{sessionId, savedCardId, cardName, cardSaverId, otherCommenterIds}`. Deep link is `mingla://session/${sessionId}?card=${savedCardId}`. Idempotency key is `card_msg:${savedCardId}:${fiveBucket}:${recipientId}`. |
| **Why this matters** | This is the notification when someone COMMENTS on a card inside a board's CardDiscussionModal — NOT when someone shares a card via DM. The two are different events. But the pattern is good: structured payload with savedCardId + cardName, deep-link, idempotency, in-app notification row + push. **A new type `'direct_card_message'` (or `'shared_card_dm'`) can be cloned from this pattern in ~30 LOC**, with deep-link to chat (`mingla://chat/${conversationId}`) instead of session, and idempotency keyed on the new message id. |
| **Bundle into fix** | Yes — this is the lowest-risk path for v1 push delivery. Don't invent new infrastructure; clone the proven pattern. |

---

### 🔵 OBS-2 — `BoardSelectionSheet` (Add to Board) is the right UI analog for the picker

| Field | Evidence |
|-------|----------|
| **File + line** | `MessageInterface.tsx:1241-1315` (inline modal) and `:587-612` (handlers) |
| **Detail** | Add-to-Board uses an inline `<View style={styles.modalOverlay}>` modal with a ScrollView of selectable items, a checkbox per row, Cancel/Confirm at the bottom, and a multi-select `selectedBoards: string[]` state. Founder did NOT specify single-vs-multi for share-cards. |
| **Recommendation** | **Single-select** for v1 (one bubble per share, like iMessage attachments). Multi-select adds confusion ("did I send 3 bubbles or one bubble with 3 cards?") and expands surface area. Mirror Add-to-Board's modal CHROME (overlay + header + close button + scrollable list + Cancel/Confirm) but make tap = immediate select-and-confirm (no confirm button needed for single-select; tap → send → close). Adds simplicity AND removes a step. Multi-select can be a v2 follow-up if founder asks. |
| **Caveat** | The orchestrator dispatch noted (and concurrent intake ORCH-0666 confirmed) that `AppHandlers.handleAddToBoard` is itself a fake-success theatre that does no DB write. Do NOT use the Add-to-Board flow as a behavioral model — only as a UI pattern. The card-share flow must be REAL, not stub. |

---

### 🔵 OBS-3 — Bisect proves missing-feature, not regression

| Field | Evidence |
|-------|----------|
| **Bisect** | `git log -L 340,355:app-mobile/src/components/AppHandlers.tsx` returns only TWO commits touching this range: (a) `1fd48004` (2026-03-?? "translate final ~155 hardcoded English strings") — pure i18n migration, swapped `"Card Shared!"` for `i18n.t('common:toast_card_shared')` and `\`A saved experience has been shared with ${friend.name}\`` for the i18n equivalent. Behavior unchanged. (b) `de16b724` (2025-11-26 "saved card") — introduced the function in its current toast-only form. |
| **Implication** | This was never broken — it was never built. Spec is missing-feature, not bug-fix. No "restore to prior working state" path exists. Tester cannot do regression-comparison testing because there's no baseline that worked. Implementor builds from scratch against spec. |
| **Severity implication** | A 5-month-old missing-feature on a primary social surface in a launch-readiness program is concerning, but not S0. It's S1 because (a) it's user-visible and degrades a primary social action, (b) the toast lies — at minimum the Constitution #9 fabrication should be removed even before the real flow ships. |

---

### 🔵 OBS-4 — `useSavedCards` already returns the merged solo + board list — no new query needed

| Field | Evidence |
|-------|----------|
| **File + line** | `app-mobile/src/hooks/useSavedCards.ts:53-61` and `app-mobile/src/services/savedCardsService.ts:214-321` |
| **Detail** | `useSavedCards(userId)` returns `SavedCardModel[]` from `savedCardsService.fetchSavedCards`, which fetches both `saved_card` (solo) and `board_saved_cards` (collab) tables, deduplicates by experience id (board version wins on duplicate), and sorts by `dateAdded` desc. Each item carries the FULL `card_data` JSONB — title, image, images[], category, rating, address, highlights, matchScore, source, sessionId, sessionName. Already has 5-min staleTime and 10-min gcTime. |
| **Implication for spec** | Picker can call `useSavedCards(currentUser.id)` directly. Zero new service code, zero new RPC. This is one of very few places where the data layer is already in great shape. Picker cost is purely UI: render a list of `SavedCardModel` rows. |
| **Edge case** | Empty state — when user has zero saved cards. Founder didn't specify copy. Recommend: title "No saved cards yet" + body "Save cards from the deck to share them with friends." + close button. Pull from new `chat:noSavedCardsToShare` / `chat:noSavedCardsToShareMessage` keys (will need translation across 28 locale files matching the existing pattern). |

---

### 🔵 OBS-5 — Solo + collab parity check: NO share-card UI exists in board / collab discussion surfaces

| Field | Evidence |
|-------|----------|
| **Files searched** | `BoardDiscussionTab.tsx`, `BoardDiscussion.tsx`, `board/CardDiscussionModal.tsx`, `SessionViewModal.tsx`. Grep for `share`, `Share Saved`, `shareSavedCard` returned zero matches. |
| **Implication** | The dead-tap is DM-only. No parity issue to bundle. Adding share-card support to board discussions is **additive scope** — file as deferred follow-up, NOT bundled into ORCH-0667. Recommended deferred ID: **ORCH-0667.D-1** ("Share saved card from board discussion surface — parity follow-up after DM share ships"). |

---

### 🔵 OBS-6 — `VERIFICATION_PUSH_DELIVERY_MATRIX.md` already flagged this gap

| Field | Evidence |
|-------|----------|
| **File + line** | `Mingla_Artifacts/reports/VERIFICATION_PUSH_DELIVERY_MATRIX.md:54,64` |
| **Detail** | Matrix lists "Someone saved card you shared — NEVER BUILT" and "Shared card saved by someone — NEVER BUILT" as known-missing notification types. ORCH-0667 doesn't address those (those are recipient-side notifications fired AFTER the recipient interacts with the shared card). The notification ORCH-0667 needs is the missing primitive: "Friend shared a card with you in a DM." |
| **Implication** | Spec must add ONE new notification type minimum (`direct_card_message` or `shared_card_dm`). The two NEVER-BUILT items above remain as deferred follow-ups (recommended ID: **ORCH-0667.D-2** "Recipient interaction notifications for shared cards (saved-by-recipient + saver-notified)"). Out of v1 scope. |

---

## 5 — Five-truth-layer reconciliation

| Layer | Source-of-truth read | Verdict |
|-------|---------------------|---------|
| **Docs** | No prior ORCH on share-card flow. Grep across `Mingla_Artifacts/` for "share" + "saved" + "card" returns: WORLD_MAP rows for paired-map saved cards (ORCH-0174), offline-saved-cards (ORCH-0200), and several investigation reports about saved-card semantics — none mention sharing. Founder report dated 2026-04-25 is the original source of intent. **No conflict.** |
| **Schema** | `messages.message_type CHECK ('text', 'image', 'video', 'file')` is current authoritative state. No `card_payload` column. RLS allows participants to SELECT messages in their conversations and INSERT messages they sent into conversations they participate in (`20250128000003:154-186`). RLS DOES NOT discriminate by message type — a `'card'`-type message would inherit the same SELECT/INSERT semantics, which is correct. **Schema is the binding constraint.** |
| **Code** | Sender path: `MessageInterface.tsx → ConnectionsPage.tsx → app/index.tsx → AppHandlers.tsx` — all wired correctly EXCEPT terminal handler is a stub. Receiver path: `messagingService.subscribeToConversation` postgres_changes INSERT handler at `:560-624` would receive any new row; `enrichMessageRealtime` at `:686-694` returns the raw row; the receiver's chat list would render whatever the bubble component does. **Code is partially ready** (transport works, terminal handler does not). |
| **Runtime** | Cannot probe runtime today because no card-type message has ever been inserted (CF-1 blocks it). MCP probe would fail with `23514` check_violation. **Runtime confirms schema constraint is active.** |
| **Data** | Zero rows in `messages` with non-text-image-video-file `message_type` (constraint guarantees this). Zero rows in `notifications` with `type='direct_card_message'` or similar (no such code path exists). **Data layer is empty for this feature, as expected.** |

**Verdict:** No layer contradicts another. The bug is a coherent, complete absence — the
feature is genuinely not built at any layer. This is good news for spec design: no
half-built scaffolding to dismantle.

---

## 6 — Blast radius

| Surface / flow | Impact today | Impact after fix |
|----------------|--------------|------------------|
| DM more-options menu (current location) | Dead tap (toast only) | Real share — primary surface |
| DM chat sheet (`MessageInterface.tsx:1351-1358` — duplicate entry point) | Dead tap (toast only) | Real share — same handler |
| Board discussion tab | No share-card UI exists | No change (deferred to ORCH-0667.D-1) |
| Board CardDiscussionModal (per-card comments) | Different feature (commenting on a card from inside a session) — unaffected | No change |
| Collab session chat | No general chat surface inside collab sessions has share-card UI | No change |
| Saved card page itself | "Share" button exists somewhere (verified `SavedTab.tsx:108` exposes `onShareCard` prop) — reverse direction (share FROM saved card → pick friend) — out of ORCH-0667 scope | No change unless user requests |
| iOS app badge / OneSignal counts | Not affected by stub today; new push will increment counts after fix | New: 1 push per share recipient |
| In-app notifications | Not affected today; new notification row per share after fix | New: 1 notification row per share recipient |
| Realtime subscriptions | Already subscribed to `messages` INSERT — new card-type rows will fan out automatically | No code change to realtime subscription logic |

**Affected query keys (post-fix):**
- `messageKeys.list(conversationId)` — invalidate after send so list refetches
- `notificationKeys.list(userId)` — recipient's notification list refetches via realtime
- `savedCardKeys.list(userId)` — read by picker; no invalidation needed (read-only consumer)

**Cross-domain check (mobile + admin + business):**
- Admin: no impact (admin doesn't render chat content; read-only metric on message counts at most)
- Business: Pre-MVP, no chat surface exists yet
- Mobile: only mobile is affected

---

## 7 — Constitutional compliance check

| # | Constitution rule | Violation today | Fix obligation |
|---|-------------------|-----------------|----------------|
| **#1** | No dead taps — every interactive element must respond | **VIOLATED** — button fires toast but does nothing real | Implement real flow OR remove button |
| **#2** | One owner per truth | Not violated today (only one stub) | Spec must keep the picker as the only "list of saved cards in chat" surface |
| **#3** | No silent failures — errors must surface | **VIOLATED in spirit** — fake success masks the failure to share | Real handler must surface real errors (network, RLS, schema) — Constitution #3 makes silent-fail unacceptable |
| **#4** | One query key per entity | Not violated; spec must use `savedCardKeys.list` from existing factory | — |
| **#5** | Server state stays server-side | Not violated today; spec must avoid Zustand-storing card payload | — |
| **#8** | Subtract before adding | Spec MUST delete the stub `handleShareSavedCard` body (`AppHandlers.tsx:340-355`) before writing the real implementation. Subtract first. | Mandatory. |
| **#9** | No fabricated data | **VIOLATED** — toast asserts an action that didn't happen | Real flow must only show "shared" toast on real success |
| **#13** | Exclusion consistency — same rules in generation and serving | Block-check is enforced by RLS at INSERT time (`messagingService.ts:496`) — spec must keep this invariant for card-type messages too (don't bypass RLS by going around `messagingService.sendMessage`) | Mandatory. |

**Net constitutional load:** 3 active violations (#1, #3, #9), 1 structural risk (#13).
This is a high-load constitutional fix — recommend the implementor read these constraints
before writing any code.

---

## 8 — Schema delta menu (with recommendation)

The fix needs SOMETHING in the schema. Three options:

### Option A — New `message_type='card'` + new `card_payload jsonb` column (RECOMMENDED)

**Migration sketch:**
```sql
-- 20260425000001_orch_0667_add_card_message_type.sql
ALTER TABLE public.messages
  DROP CONSTRAINT messages_message_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'file', 'card'));
ALTER TABLE public.messages
  ADD COLUMN card_payload jsonb;
-- Soft constraint: card_payload required when message_type='card'
ALTER TABLE public.messages
  ADD CONSTRAINT messages_card_requires_payload
  CHECK (message_type <> 'card' OR card_payload IS NOT NULL);
COMMENT ON COLUMN public.messages.card_payload IS
  'ORCH-0667: Snapshot of shared card data. Populated only when message_type=card. Snapshot (not reference) to survive place removal from pool.';
```

**RLS impact:** None — existing message SELECT/INSERT RLS doesn't discriminate by type.
The new column inherits the row's RLS automatically.

**Realtime impact:** None — `postgres_changes` payload is the full row, including new
column. The receiver's `enrichMessageRealtime` returns `{...message}`, which now includes
`card_payload`.

**Pros:**
- Type-safe at the DB layer
- No conflict with existing `'file'` type behavior (file_url, file_name, file_size remain file-only)
- Easy to query analytics: "how many card shares per day?" → `WHERE message_type='card'`
- Push preview can branch on type cleanly
- Renderer can branch on type cleanly

**Cons:**
- New migration (1 new file, not a hot patch)
- TypeScript type union must be widened (1-line change in `messagingService.ts:11`)
- All callers of `sendMessage` accepting `messageType` parameter must accept `'card'` in their type — minor

### Option B — Reuse `'file'` type with embedded JSON in a string column

Hack: put the card payload in `file_url` as a `data:application/json;base64,...` blob, set
`message_type='file'`, set `file_name='shared_card.json'`. Recipient's bubble checks
`file_name === 'shared_card.json'` and renders a card.

**Pros:** No migration. Ships in mobile-only OTA.

**Cons:** Type is dishonest (it's not a file). `file_url` is meant for actual URLs to
storage. Analytics gets garbled. Push preview branches on file extension (fragile). Old
mobile builds would render this as a 📄 file bubble (broken-looking). **Recommend AGAINST** —
short-term win, long-term tech debt and Constitution #2 (one-owner-per-truth) violation.

### Option C — Send card share as a deep-link in `'text'` message

Hack: send a regular text message containing only `mingla://card/{place_id}`. Recipient's
chat renders text, with a local link-preview enhancer that fetches card data on render.

**Pros:** Zero schema change. Works on every existing build.

**Cons:** Looks like a raw URL in old clients (ugly). Card data is not snapshot — if the
place is dropped from the pool, the link breaks (no resolution). Link-preview in chat is
its own UX problem (race conditions, network flakiness, image loading). Push preview shows
the literal URL. **Recommend AGAINST** for a primary feature.

### Recommendation

**Option A — new `message_type='card'` + `card_payload jsonb`.** It's the only option that
treats card-share as a first-class message type with honest schema, clean rendering, clean
analytics, and forward-compatible RLS. Cost: one migration, one type widening, ~20 LOC of
shared infrastructure. Worth it.

---

## 9 — Recommended v1 fix strategy (NOT a spec — direction only)

The spec writer should bind these decisions:

1. **Schema:** Option A. New migration adds `'card'` to `message_type` CHECK + adds
   `card_payload jsonb` column + adds soft-constraint requiring payload when type=card.
2. **Service layer:** Add `sendCardMessage(conversationId, senderId, cardPayload, replyToId?)`
   to `messagingService` that calls `.insert({ ..., message_type: 'card', card_payload })`,
   then triggers `notify-message` with the new type. Widen `DirectMessage.message_type`
   union to include `'card'`. Add `card_payload?: SavedCardModel | CardPayloadShape` to
   `DirectMessage` interface.
3. **Hook layer:** No new hook. Picker uses existing `useSavedCards(currentUser.id)`.
4. **Component layer:**
   - New inline modal in `MessageInterface.tsx` (mirror BoardSelectionSheet pattern at
     `:1241-1315`) — single-select, tap-to-send.
   - New card-bubble renderer in the chat message list (find the message-list component
     in `ConnectionsPage.tsx` — spec writer to confirm exact location, not investigated
     in detail in this pass — recommend marking as a spec-task).
   - Tap on bubble → opens locally-mounted `ExpandedCardModal` (HF-2 fix).
   - Empty-state copy + new locale keys.
5. **Notification:** Add `'direct_card_message'` type to `notify-message/index.ts`,
   cloned from the `'board_card_message'` pattern at `:210-241`. Deep-link to
   `mingla://chat/${conversationId}`. Idempotency key:
   `card_share:${messageId}:${recipientId}`.
6. **Subtraction (Constitution #8):** DELETE the toast-only body of
   `handleShareSavedCard` in `AppHandlers.tsx:340-355` and replace with the real handler.
   DELETE the local `showNotification` call in `MessageInterface.tsx:617-620` (the real
   send path will fire the toast on real success/failure).
7. **i18n:** Add new keys for picker title, empty-state copy, real-success toast,
   real-failure toast, push title, push body, in-app notification copy. Translate
   across 28 locale files (matching existing chat.json + common.json patterns).

---

## 10 — Discoveries register

| ID | Title | Recommendation |
|----|-------|----------------|
| **ORCH-0667.D-1** | Share-card parity for board discussion surface (`BoardDiscussionTab`, `BoardDiscussion`) | File. Defer to post-DM-share ship. Same picker UI + same schema benefits, different sender path. |
| **ORCH-0667.D-2** | Recipient-interaction notifications for shared cards: (a) "Friend saved the card you shared," (b) "Friend opened the card you shared." Listed as NEVER BUILT in `VERIFICATION_PUSH_DELIVERY_MATRIX.md:54,64`. | File. Defer to post-v1. Optional engagement signal, not core. |
| **ORCH-0667.D-3** | `AppHandlers.handleAddToBoard` is itself fake-success theatre per concurrent ORCH-0666 intake | Already tracked under ORCH-0666 — cross-reference only, no new ID needed. |
| **ORCH-0667.D-4** | `MessageInterface` currently has no path to mount `ExpandedCardModal` (cross-surface render gap, Constitution #1 risk for card bubbles if shipped non-tappable) | Bundle into ORCH-0667 fix as HF-2. Don't file separately. |
| **ORCH-0667.D-5** | Constitution #9 fabrication in toast string `toast_card_shared_msg` shipped in 28 locales — even before the real flow ships, this string should not fire on a stub | Bundle into ORCH-0667 fix. As subtraction step in Constitution #8 compliance. |
| **ORCH-0667.D-6** | Multi-select share (send N cards in one chat action) — explicit non-goal for v1 | File for spec record. Defer until founder explicitly requests. |
| **ORCH-0667.D-7** | Reverse direction (share saved card FROM SavedTab → pick friend → send) — `SavedTab.tsx:108` already exposes `onShareCard` prop. Different sender flow, same DB schema, same notification — could be free side-effect of v1 if scoped in. | File. Recommend bundling IF spec writer agrees (low marginal cost). Otherwise defer. |

---

## 11 — Confidence summary & spec-readiness verdict

| Aspect | Confidence | Reasoning |
|--------|-----------|-----------|
| **Root cause proven** | **HIGH** | Stub handler is six-field-anchored. Bisect proven. No alternative explanation. |
| **Schema gap proven** | **HIGH** | Migration chain audited end-to-end. CHECK constraint is current authoritative truth. |
| **Solution direction proven** | **HIGH** | Option A is structurally sound, low-risk, idiomatic for the existing chat schema, and avoids all Constitution violations. |
| **UI pattern proven** | **HIGH** | BoardSelectionSheet inline modal is the proven analog. Mirror chrome, simplify to single-select. |
| **Notification path proven** | **HIGH** | `board_card_message` pattern at `notify-message/index.ts:210-241` is directly cloneable. |
| **Saved-cards source proven ready** | **HIGH** | `useSavedCards` hook already returns merged solo + board with full payload. Zero new query work. |
| **ExpandedCardModal mount path** | **MEDIUM** | Recommend local mount (option a) but spec writer should weigh against global-overlay refactor. Implementor cost: ~5 LOC for local mount; ~50 LOC and broader refactor for global. |
| **Cross-surface dead-tap inventory** | **HIGH** | Repo-wide grep confirms DM-only scope. No parity bundle needed. |
| **Bisect** | **HIGH** | Two commits in scope, both inspected, both confirm "missing-feature, never built." |

**Spec-readiness verdict: HIGH.** The spec writer can produce a complete spec from this
investigation without re-tracing any code. Every layer is mapped. Every option has a
recommendation. Every Constitution violation is quoted. Every discovery is filed. Open
question count is small and bounded:

1. Single-select vs multi-select picker (recommend single — spec to lock)
2. Snapshot vs reference card payload (recommend snapshot — spec to lock)
3. Bubble + push for v1 vs bubble-only (recommend bubble + push — spec to lock)
4. Local ExpandedCardModal mount vs global overlay refactor (recommend local — spec to lock)
5. Whether to bundle reverse-direction share from SavedTab (D-7) (recommend defer — spec to lock)

---

## 12 — Recommended next step

**Spec dispatch.** Orchestrator should write `prompts/SPEC_ORCH-0667_SHARE_SAVED_CARD_PICKER.md`
that ingests this investigation and produces `outputs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md`
binding the 5 open questions above and specifying every layer in implementor-executable
detail (DB migration SQL verbatim, service signature exact, picker JSX states enumerated,
bubble renderer states enumerated, notification body template fixed, i18n key list fixed,
implementation order numbered).

After spec returns, implementor dispatch follows. Estimated implementor surface: 1 new
migration, 1 widened type, ~30 LOC service, ~80 LOC picker modal, ~40 LOC bubble renderer,
~30 LOC edge-fn notification clone, ~10 new i18n keys × 28 locales = 280 string adds.
Total: ~6-8 hours of implementor time, single-pass scope.

---

**End of investigation report.**
