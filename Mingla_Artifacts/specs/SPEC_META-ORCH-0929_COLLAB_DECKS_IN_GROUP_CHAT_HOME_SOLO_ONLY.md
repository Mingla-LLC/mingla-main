# SPEC — META-ORCH-0929 [Collab decks live in group chat — Home is solo-only]

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` (read the corrected version — ORCH-0902/0909/0906 are SHIPPED)
**Absorbs:** ORCH-0928 [Friends `+` chooser] (sub-scope)
**Folds:** ORCH-0926 [Realtime scoped authenticated rebind] (in-flight dirty changes — see §13)
**Preserves verbatim:** ORCH-0902/0909/0906 deck contracts (already shipped — `supabase/migrations/20260625…orch_0902…`, `…20260701…orch_0909_positional_shared_deck.sql`, `…20260703…orch_0906_session_deck_cards_mixed_type.sql`)
**Pipeline next:** Codex `implementor-mingla` → Claude `mingla-tester` → orchestrator CLOSE

---

## 1. Layman Summary

Home becomes a clean solo-only swipe surface. The collaboration session pill row on Home is deleted. Friends-page `+` opens a chooser sheet with two options. "Add a friend" routes to the existing pair flow unchanged. "Create a group chat" opens a small create sheet that creates a group chat + collab session atomically and drops the user into the new chat. Inside any group chat that's session-linked, a "Start swiping together" CTA in the header opens a full-screen deck sheet that hosts the existing positional shared-deck swiper (driven by the already-shipped ORCH-0909 contract via `sessionIdOverride`). Incoming session invites surface as push notifications + an in-app banner + a chat-list row with inline Accept/Decline buttons (the old SessionSwitcher invite-pill UX disappears). Every group chat is independent — no "global active session" concept; users implicitly context-switch by tabbing between chats. ORCH-0926's realtime authenticated-rebind dirty changes ship inside the same PR.

## 2. Scope and Non-Goals

### 2.1 Scope (in)

**Component additions:**
- `app-mobile/src/components/connections/FriendsActionChooserSheet.tsx` — chooser
- `app-mobile/src/components/connections/CreateGroupChatSheet.tsx` — replaces CollaborationSessions create-modal
- `app-mobile/src/components/connections/CollabDeckSheet.tsx` — full-screen deck wrapper
- `app-mobile/src/components/connections/PendingSessionInviteRow.tsx` — chat-list row UI for pending invites
- `app-mobile/src/components/connections/StartSwipingHeaderButton.tsx` — header CTA inside group chat

**Component modifications:**
- `app-mobile/src/components/ConnectionsPage.tsx` — chooser wire-up, pending-invite rows in chat list, remove dead props
- `app-mobile/src/components/HomePage.tsx` — strip mode plumbing, delete GlassSessionSwitcher mount, delete CollaborationSessions mount, lock `<SwipeableCards>` to solo
- `app-mobile/src/components/MessageInterface.tsx` — mount StartSwipingHeaderButton + CollabDeckSheet for session-linked group chats; add "Leave session" in existing 3-dot menu
- `app-mobile/app/index.tsx` — strip `selectedSessionId`/`currentMode`/`setCurrentMode`/`setSessionModalTrigger`/`pendingSessionOpen` state and prop chains; rewire ConnectionsPage props
- `app-mobile/src/hooks/useSessionManagement.ts` — rename callers; no behavioral change
- `app-mobile/src/hooks/useFriendsQuery.ts` or chat-list query — surface `pending_invite` chat rows in the conversations list
- `app-mobile/src/contexts/RecommendationsContext.tsx` — no logic change (mode plumbing already supports sessionIdOverride); minor cleanup of HomePage-only fallbacks; FOLD ORCH-0926 dirty changes
- `app-mobile/src/hooks/useAuthSimple.ts` — FOLD ORCH-0926 dirty changes (auth-event rebind wiring)
- `app-mobile/src/hooks/useBoardSession.ts` — FOLD ORCH-0926 dirty changes (async subscription handling)
- `app-mobile/src/services/realtimeService.ts` — FOLD ORCH-0926 dirty changes (scoped authenticated rebind for `board_session:{sessionId}`)

**Deletions:**
- `app-mobile/src/components/GlassSessionSwitcher.tsx` (entire file, 654 lines)
- `app-mobile/src/components/CollaborationSessions.tsx` (entire file, ~1641 lines)
- HomePage's `<CollaborationSessions modalsOnlyMode />` mount + GlassSessionSwitcher mount + all session-related props in `HomePageProps`
- `app/index.tsx` state: `currentSessionId` (replaced by per-chat `friend.sessionId`), `sessionModalTrigger`, `pendingSessionOpen`, `inviteModalTrigger`
- `app/index.tsx` handlers: `handleSessionSelect`, `handleSoloSelect`, `handleInviteMoreToSession`, `handleSessionStateChanged`, and any HomePage-only mode-switching plumbing
- Dead `feedback_solo_collab_parity.md` interpretation — UPDATE the memory at CLOSE Step 5c

**i18n additions** (all locales under `app-mobile/src/i18n/locales/<lang>/social.json`):

| Key | English value |
|---|---|
| `social:friendsActionChooserTitle` | `"What do you want to do?"` |
| `social:friendsActionChooserCreateGroupChat` | `"Create a group chat"` |
| `social:friendsActionChooserAddFriend` | `"Add a friend"` |
| `social:friendsActionChooserPlusButtonA11y` | `"Add a friend or start a group chat"` |
| `social:friendsActionChooserCreateDisabledPaywall` | `"Pro plan required"` |
| `social:createGroupChatSheetTitle` | `"Create a group chat"` |
| `social:createGroupChatNamePlaceholder` | `"What's this group about?"` |
| `social:createGroupChatFriendsLabel` | `"Invite friends"` |
| `social:createGroupChatSubmit` | `"Create"` |
| `social:startSwipingCta` | `"Start swiping together"` |
| `social:collabDeckSheetTitle` | `"Find a spot together"` |
| `social:pendingInviteAccept` | `"Accept"` |
| `social:pendingInviteDecline` | `"Decline"` |
| `social:pendingInviteRowSubtitle` | `"{{name}} invited you to swipe together"` |
| `social:leaveSessionMenuItem` | `"Leave session"` |
| `social:leaveSessionConfirmTitle` | `"Leave this session?"` |
| `social:leaveSessionConfirmBody` | `"You'll stop seeing new cards together. The chat stays."` |

### 2.2 Non-goals (out)

- **No backend changes.** Zero migrations, zero edge-function changes, zero RPC changes, zero RLS changes. ORCH-0902/0909/0906 contracts are already shipped and live in production.
- **No SwipeableCards / RecommendationsContext logic rewrites.** Both already support session-driven mode via the existing `sessionIdOverride` prop (`SwipeableCards.tsx:205`). The META leverages this seam; it does not touch the deck logic.
- **No ORCH-0906 amendment scope expansion.** Single↔intent alternation + `session_curated_cache` + curated_payload wiring already shipped. No further amendments.
- **Onboarding pair flow (`OnboardingFriendsAndPairingStep.tsx`) unchanged.** Different surface, different UI pattern.
- **Phone invites at create-time are deferred.** Friend multi-select only on the create-group-chat sheet. Phone invites can be added later via an in-chat invite affordance (separate ORCH if needed).
- **Paywall sheet UI not redesigned.** Existing `useSessionCreationGate` + paywall sheet are reused as-is — only the gate-check location moves (see Q7 in §3 below).
- **Notification deep-link target.** Tapping a session push lands the user in the group chat (Friends tab + MessageInterface open), NOT directly in the CollabDeckSheet. Reason: chat is the more general surface; deck is one of many things the user might want.
- **`useDeckCards` solo path** — UNCHANGED.
- **Existing pair-request UI (`PairRequestModal.tsx`)** — UNCHANGED.

### 2.3 Assumptions

- A1. `SwipeableCards.tsx:205` `sessionIdOverride` prop is the supported integration seam for forcing collab mode from outside HomePage. Verified by reading `SwipeableCards.tsx:587-600` (the prop takes precedence over `currentMode` for session resolution).
- A2. Conversation list (`MessageInterface.tsx` / `useFriendsQuery.ts` / `messagingService.ts:getConversations`) can surface pending-invite rows by adding a new conversation `type` or `pending_invite_flag` field in the transform. The transform layer at `ConnectionsPage.tsx:870-1044` already builds custom conversation objects from raw rows — extending the projection is straightforward.
- A3. Group-chat creation can be wrapped in a single client-side flow that calls existing `useSessionManagement.createSession()` (or the equivalent RPC) + creates the conversation row + adds participants. Today CollaborationSessions does this; the new CreateGroupChatSheet reproduces the same calls (no new server logic).
- A4. The ORCH-0926 implementation (per `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`) is correct and survives intact when folded into this META. Tester validates ORCH-0926's PASS still holds after the META reshape.
- A5. Existing realtime channels (`board_session:{sessionId}` per ORCH-0926) work identically whether the deck mounts inside HomePage or inside a sheet — they're channel-scoped, not React-tree-scoped.

## 2.5 Cross-Surface Impact

| Surface | In scope? | What changes | Parity |
|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | Chooser, create-sheet, CollabDeckSheet, MessageInterface CTA + leave-menu, pending-invite chat rows, HomePage strip, GlassSessionSwitcher + CollaborationSessions deletions, app/index.tsx prop rewire, ORCH-0926 fold | Automatic via shared RN code with Android |
| **Consumer Android** (`app-mobile/` on Android) | YES | Same as iOS | Automatic |
| **Backend** (`supabase/`) | NO | Zero backend changes — ORCH-0902/0909/0906 already live; no new migrations, RPCs, or edge functions | — |
| **Buyer/anon Web** (`mingla-business/`) | NO | No consumer collab surfaces on buyer-web | — |
| **Business iOS / Android** (`mingla-business/`) | NO | No consumer collab surfaces in Business app | — |
| **Admin Web** (`mingla-admin/`) | NO | No consumer-deck UI on admin | — |
| **Business web preview** | NO | Same as Business iOS/Android | — |

iOS + Android parity is automatic via shared RN code; per-surface SCs not required. Tester still exercises BOTH iOS Simulator AND Android Emulator per `feedback_tester_canonical_and_platform_parity.md`.

---

## 3. Forensics-recommended answers to the 10 SPEC-shaping questions

For traceability — these answers shape §4-§13 below:

| # | Question | Answer | Why |
|---|---|---|---|
| 1 | ORCH-0926 sequencing | **Fold into META** | Operator directive ("fold everything into one rigorous spec"); ORCH-0926 already has Implementation + QA + Review reports, ready to ship; bundling avoids cross-PR merge conflict in the same files. |
| 2a | Pending invites — same chat list or separate section | **Same chat list, with state badge** | Operator framing was "chat appearing in the chat list"; simpler than a separate section; matches existing chat-row UX. |
| 2b | Chat content visible before accept | **Hidden until accept** | Consent gate — revealing messages pre-accept leaks content to invited-but-not-accepted users. Pending row shows only inviter name + subtitle. |
| 2c | Decline notifies inviter | **No — silent drop** | Matches the established `useFriendsQuery` decline-doesn't-notify pattern; avoids notification storm. |
| 2d | Multi-invite ordering | **Recency, newest first** | Matches existing `sortedConversations` order at `ConnectionsPage.tsx:812-819` (already sorts by `last_message.created_at`). Invites use `created_at` of the invite. |
| 3 | CollabDeckSheet visual | **Full-screen modal, slide-up animation** | Deck needs full-bleed real estate; chat backdrop adds visual noise; matches existing PaywallSheet / FX2 full-screen patterns. |
| 4 | "Start swiping" CTA placement | **MessageInterface header right slot** | Persistent affordance; doesn't push messages down (banner option) or compete with composer (FAB option); MessageInterface header already has affordance slots. |
| 5 | Leave-session affordance | **Inside MessageInterface 3-dot menu only** | Single source of truth; sheet is for deck-only; menu is the natural home for chat-level actions. |
| 6 | Create-group-chat sheet fields | **Name + friends multi-select** (no phone invites at create-time) | Simpler create flow; phone invites can be added later via in-chat invite (separate ORCH if needed). |
| 7 | Paywall gate location | **At chooser tap** | Cheaper UX — user knows immediately if paywalled. "Create a group chat" option renders with "Pro plan required" badge when `!gateAllows && !isUnlimited`; tap opens paywall sheet instead of the create sheet. |
| 8 | Notification deep-link target | **Group chat (MessageInterface), not CollabDeckSheet directly** | Chat is more general; deck is one of many things user might want; user taps "Start swiping" if they want deck. |
| 9 | Global "active session" concept | **DELETE — no global active session** | Biggest simplification; each chat is independent; eliminates `selectedSessionId` / `currentMode === sessionId` mental model; deletes ~80 lines of state-routing plumbing from `app/index.tsx`. |
| 10 | ORCH-0902 SPEC archive | **Mark superseded by ORCH-0909, keep on disk** | ORCH-0902 SPEC has historical/audit value; superseded-banner added. |

---

## 4. New Component Specifications

### 4.1 `FriendsActionChooserSheet.tsx`

**File:** `app-mobile/src/components/connections/FriendsActionChooserSheet.tsx` (NEW)

**Purpose:** Two-option chooser sheet that routes the Friends-page `+` tap.

**Props:**
```ts
interface FriendsActionChooserSheetProps {
  visible: boolean;
  onClose: () => void;
  onChooseCreateGroupChat: () => void;
  onChooseAddFriend: () => void;
  // Q7: paywall gate at chooser tap — chooser owns the disabled-state
  createGroupChatDisabled?: boolean;   // true when !gateAllows && !isUnlimited
  onCreateGroupChatPaywall?: () => void;  // called instead of onChooseCreateGroupChat when disabled
}
```

**Visual:**
- Native RN `<Modal animationType="slide" transparent statusBarTranslucent>` with overlay `rgba(0, 0, 0, 0.35)`, bottom-anchored.
- Sheet container: `#FFFFFF`, `borderTopLeftRadius: s(24)`, `borderTopRightRadius: s(24)`, `paddingBottom: Math.max(insets.bottom, 16) + 16`, `maxHeight: "40%"`.
- Drag handle: 40pt wide, 4pt tall, `colors.gray[300]`, centered.
- Header: title `t('social:friendsActionChooserTitle')`, centered, `s(18)/700/colors.text.primary`. No close X — backdrop dismisses.
- Section divider: 1px `colors.gray[100]`.
- Option rows (vertical stack, gap 12pt, both full-width):
  - Row 1 "Create a group chat": icon `name="people"` (left), label `t('social:friendsActionChooserCreateGroupChat')` (centered-left), chevron right. `paddingVertical: s(18), paddingHorizontal: s(20), borderRadius: s(14), backgroundColor: colors.gray[50]`. If `createGroupChatDisabled`: render badge `t('social:friendsActionChooserCreateDisabledPaywall')` in `colors.warning[500]` next to label; icon opacity 0.5; press routes to `onCreateGroupChatPaywall` instead of `onChooseCreateGroupChat`.
  - Row 2 "Add a friend": icon `name="person-add-outline"` (left), label `t('social:friendsActionChooserAddFriend')`, chevron right. Same base styling.
- Pressed-state: `transform: [{ scale: 0.98 }]` on both rows.
- Haptics: `HapticFeedback.medium()` on row tap (either option, paywall variant included).

**Dismiss-before-open pattern (critical):**
```tsx
onChooseCreateGroupChat={() => {
  setShowFriendsActionChooser(false);
  requestAnimationFrame(() => {
    setShowCreateGroupChatSheet(true);
  });
}}
onChooseAddFriend={() => {
  setShowFriendsActionChooser(false);
  requestAnimationFrame(() => {
    setShowPairRequestModal(true);
  });
}}
onCreateGroupChatPaywall={() => {
  setShowFriendsActionChooser(false);
  requestAnimationFrame(() => {
    setShowPaywall(true);  // existing paywall sheet
  });
}}
```

`requestAnimationFrame` defer is mandatory per `feedback_rn_sub_sheet_must_render_inside_parent.md`. Codified as new invariant **I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN**.

**Accessibility:**
- Modal: `accessibilityViewIsModal={true}`.
- Header: `accessibilityRole="header"`.
- Row 1: `accessibilityRole="button"`, label `t('social:friendsActionChooserCreateGroupChat')` (or `${label} — ${t('social:friendsActionChooserCreateDisabledPaywall')}` when disabled).
- Row 2: `accessibilityRole="button"`, label `t('social:friendsActionChooserAddFriend')`.
- Backdrop: `accessibilityLabel="Close"`, `accessibilityRole="button"`.

**Imports allowed:** `react`, `react-native`, `react-native-safe-area-context`, `../ui/Icon`, `../../utils/hapticFeedback`, `../../constants/designSystem`, `../../utils/responsive`, `react-i18next`.

**Imports forbidden:** any service, any server-state hook, `@tanstack/react-query`, `@react-native-async-storage/async-storage`. Pure UI.

---

### 4.2 `CreateGroupChatSheet.tsx`

**File:** `app-mobile/src/components/connections/CreateGroupChatSheet.tsx` (NEW)

**Purpose:** Replaces the create-modal portion of `CollaborationSessions.tsx`. Lightweight name + friends picker. Atomic create on submit.

**Props:**
```ts
interface CreateGroupChatSheetProps {
  visible: boolean;
  onClose: () => void;
  availableFriends: Friend[];
  isCreating: boolean;
  onSubmit: (sessionName: string, selectedFriends: Friend[]) => Promise<void>;
  /** Called after onSubmit resolves successfully — passes the new conversation id so parent can navigate */
  onCreated: (conversationId: string, sessionId: string) => void;
}
```

**Visual:**
- Same RN `<Modal>` bottom-sheet pattern as FriendsActionChooserSheet — overlay, white sheet, drag handle.
- Height: `maxHeight: "85%"` (taller — needs friends list room).
- Header: title `t('social:createGroupChatSheetTitle')`, close X right-aligned (`Icon name="close"`).
- Body (KeyboardAwareScrollView):
  - **Name input section:** label-less `<TextInput placeholder={t('social:createGroupChatNamePlaceholder')}>`. Auto-focus on open (deferred via `setTimeout(_, 400)` to avoid iOS Fabric Modal+autoFocus crash per the existing `CollaborationSessions.tsx:203-208` pattern). `maxLength: 60`. Required.
  - **Friends section:** label `t('social:createGroupChatFriendsLabel')`. Search input if `availableFriends.length > 3` (mirror `PairRequestModal.tsx:338-355`). Multi-select rows with avatar + name + check-state indicator. Tap toggles selection. Visual mirrors the friends-list pattern from `CollaborationSessions.tsx` create modal (the implementor reads that file before deletion to extract the exact row structure).
- Footer (fixed at bottom, above safe area):
  - Submit button: `t('social:createGroupChatSubmit')`. `backgroundColor: #eb7825`, white text, `s(48)` height, full-width. Disabled when: `!name.trim()` OR `selectedFriends.length === 0` OR `isCreating`. While `isCreating`: show ActivityIndicator inside button.

**Behavior:**
- On submit: call `onSubmit(name.trim(), selectedFriends)`. On success (parent resolves promise): parent fires `onCreated(conversationId, sessionId)` which navigates user to MessageInterface for the new chat (see §4.5 wire-up). Sheet closes via `onClose` after a 200ms delay to let the parent route.
- On error: surface inline error message at the top of the sheet (mirror `PairRequestModal`'s `friendError` pattern at line 467-469).

**No phone-invite section.** Per Q6 — deferred.

**i18n:** all literal copy from §2.1 i18n table.

---

### 4.3 `CollabDeckSheet.tsx`

**File:** `app-mobile/src/components/connections/CollabDeckSheet.tsx` (NEW)

**Purpose:** Full-screen modal wrapper that mounts the existing `<SwipeableCards>` swiper in collab mode for a specific session, launched from `MessageInterface`.

**Props:**
```ts
interface CollabDeckSheetProps {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  sessionName: string;  // for header title fallback
  userPreferences: any;
  accountPreferences: any;
  savedCards: any[];
  onSaveCard?: (card: any) => Promise<boolean>;
  onShareCard?: (card: any) => void;
  onAddToCalendar?: (data: any) => void;
  onPurchaseComplete?: (data: any, opt: any) => void;
  onOpenPreferences?: () => void;
  onOpenCollabPreferences?: () => void;
}
```

**Visual:**
- RN `<Modal animationType="slide" presentationStyle="fullScreen">` — full-screen, not bottom-sheet.
- Status bar visible (no `statusBarTranslucent` opacity).
- Top safe-area: respect `useSafeAreaInsets().top`.
- Header (60pt tall): left = back-arrow close (`Icon name="chevron-back"` + accessibility "Close deck"), center = title `sessionName || t('social:collabDeckSheetTitle')` (single line, ellipsize tail), right = preferences icon (opens collab preferences via `onOpenCollabPreferences`).
- Body: mount `<SwipeableCards>` with these props locked:
  ```tsx
  <SwipeableCards
    userPreferences={userPreferences}
    accountPreferences={accountPreferences}
    currentMode={sessionId}  // SwipeableCards resolves sessionIdOverride first then currentMode; passing sessionId here triggers the existing collab branch
    sessionIdOverride={sessionId}  // explicit override, belt-and-suspenders
    boardsSessions={[]}  // not needed when sessionIdOverride is set
    onAddToCalendar={onAddToCalendar ?? noop}
    onCardLike={onSaveCard ?? asyncNoop}
    onShareCard={onShareCard}
    onPurchaseComplete={onPurchaseComplete}
    removedCardIds={[]}  // sheet-local; persistent dismissal handled by ORCH-0909 server-side
    onResetCards={noop}
    onOpenPreferences={onOpenPreferences}
    onOpenCollabPreferences={onOpenCollabPreferences}
    generateNewMockCard={noop}
    refreshKey={0}
    savedCards={savedCards}
  />
  ```

**Behavior:**
- Close button (back-arrow header left): fires `HapticFeedback.light()`, calls `onClose`. Parent (MessageInterface) hides the sheet. SwipeableCards unmounts; RecommendationsContext naturally exits the collab branch when `sessionIdOverride` becomes undefined on next render with no consumer.
- Hardware back button (Android): same as close button (handled via `onRequestClose`).
- The sheet is THE ONLY mount point for collab-mode `<SwipeableCards>` after the META. Codified as new invariant **I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT**.
- No `removedCardIds` persistence inside the sheet — ORCH-0909's positional shared-deck model handles per-session dismissal server-side; the in-memory `removedCardIds` from HomePage is solo-only after the META.

**Accessibility:**
- Modal: `accessibilityViewIsModal={true}`.
- Header title: `accessibilityRole="header"`.
- Close button: `accessibilityRole="button"`, label `"Close deck"`.

**Imports allowed:** `react`, `react-native`, `react-native-safe-area-context`, `../SwipeableCards`, `../ui/Icon`, `../../utils/hapticFeedback`, `../../constants/designSystem`, `react-i18next`.

---

### 4.4 `PendingSessionInviteRow.tsx`

**File:** `app-mobile/src/components/connections/PendingSessionInviteRow.tsx` (NEW)

**Purpose:** Renders a pending-invite chat row inside the conversations list. Inline Accept / Decline buttons.

**Props:**
```ts
interface PendingSessionInviteRowProps {
  invite: {
    sessionId: string;
    inviteId: string;
    inviterDisplayName: string;
    inviterAvatarUrl: string | null;
    createdAt: string;  // ISO
  };
  onAccept: (sessionId: string, inviteId: string) => Promise<void>;
  onDecline: (sessionId: string, inviteId: string) => Promise<void>;
  isProcessing: boolean;
}
```

**Visual:**
- Same row height + padding as existing `ChatListItem` for visual consistency.
- Left: avatar (44pt, circular) — inviter's avatar with initials fallback (mirror `GlassPairedPill.tsx` avatar pattern).
- Middle: two-line text.
  - Line 1: inviter's display name (`s(15)/600`).
  - Line 2 (subtitle): `t('social:pendingInviteRowSubtitle', { name: inviterDisplayName })` (`s(13)/400/colors.text.secondary`).
- Right: two buttons stacked horizontally with gap 8pt:
  - **Accept** — primary `#eb7825` background, white text, `t('social:pendingInviteAccept')`. Disabled when `isProcessing`. ActivityIndicator inside button while in-flight.
  - **Decline** — outline button (border `colors.gray[300]`, text `colors.text.secondary`), `t('social:pendingInviteDecline')`. Disabled when `isProcessing`.

**Behavior:**
- Tap on the row body (not buttons) — no-op (content hidden until accept per Q2b).
- Accept: calls `onAccept(sessionId, inviteId)`. Parent fires `acceptCollaborationInviteWithPrefs` per ORCH-0909 §6.4 (already-shipped contract — no changes). On success, row transforms to a regular `ChatListItem` (parent re-renders the conversations list with the new state).
- Decline: calls `onDecline(sessionId, inviteId)`. Parent fires existing decline RPC (no inviter notification per Q2c). Row disappears from list.

**Accessibility:**
- Row container: `accessibilityRole="none"` (tap doesn't do anything meaningful).
- Accept button: `accessibilityRole="button"`, `accessibilityLabel="{t('social:pendingInviteAccept')} from {inviterDisplayName}"`.
- Decline button: `accessibilityRole="button"`, `accessibilityLabel="{t('social:pendingInviteDecline')} invite from {inviterDisplayName}"`.

---

### 4.5 `StartSwipingHeaderButton.tsx` (or inline into MessageInterface)

**File:** Implementor's choice — either new file `app-mobile/src/components/connections/StartSwipingHeaderButton.tsx` OR inline addition to `MessageInterface.tsx` header. Recommend new file for testability.

**Purpose:** The header right-slot CTA inside session-linked group chats. Opens CollabDeckSheet on tap.

**Props:**
```ts
interface StartSwipingHeaderButtonProps {
  onPress: () => void;
  disabled?: boolean;  // e.g., not yet >2 accepted participants if there's a quorum gate
}
```

**Visual:**
- Pressable, `paddingHorizontal: s(12), paddingVertical: s(6), borderRadius: s(16), backgroundColor: rgba(235, 120, 37, 0.18), borderWidth: 1, borderColor: rgba(235, 120, 37, 0.5)`.
- Inside: row with icon `name="layers"` (or `"albums-outline"` — implementor picks closest match) + label `t('social:startSwipingCta')` in white, `s(13)/600`.
- Pressed: `transform: [{ scale: 0.97 }]`.
- Disabled: opacity 0.5; no press action.

**Behavior:**
- Tap: `HapticFeedback.medium()`, call `onPress`. Parent (MessageInterface) opens CollabDeckSheet.

**Rendering condition:** parent only mounts this when `isGroupSessionChat === true` (per `MessageInterface.tsx:243`: `isGroupChat && friend.linkedEntityType === 'session' && !!friend.sessionId`).

---

## 5. Modified Component Specifications

### 5.1 `ConnectionsPage.tsx`

**File:** `app-mobile/src/components/ConnectionsPage.tsx`

#### 5.1.1 New props (added to `ConnectionsPageProps`)

```ts
/** META-ORCH-0929: real session-create handler (atomic group-chat + session row creation). */
onCreateGroupChat?: (sessionName: string, selectedFriends: any[]) => Promise<{ conversationId: string; sessionId: string }>;

/** META-ORCH-0929: accept-pending-invite handler (atomic accept with prefs per ORCH-0909 §6.4). */
onAcceptPendingInvite?: (sessionId: string, inviteId: string) => Promise<void>;

/** META-ORCH-0929: decline-pending-invite handler. */
onDeclinePendingInvite?: (sessionId: string, inviteId: string) => Promise<void>;

/** META-ORCH-0929: available friends for the create-group-chat sheet's multi-select. */
availableFriendsForCreate?: any[];

/** META-ORCH-0929: in-flight flag for the create-group-chat sheet's submit button. */
isCreatingGroupChat?: boolean;
```

The existing `onCreateSession?: (newSession: any) => void` prop (the ORCH-0666 refresh notification) survives — it stays for backward-compat with the post-create refresh path. The new `onCreateGroupChat` is distinct and named to avoid collision (per ORCH-0928 DISC-A precedent).

#### 5.1.2 New local state (alongside existing sheet-visibility state around line 686)

```ts
// META-ORCH-0929 chooser sheet visibility
const [showFriendsActionChooser, setShowFriendsActionChooser] = useState(false);

// META-ORCH-0929 create-group-chat sheet visibility
const [showCreateGroupChatSheet, setShowCreateGroupChatSheet] = useState(false);

// META-ORCH-0929 paywall sheet visibility (when chooser tap routes to paywall)
const [showPaywall, setShowPaywall] = useState(false);

// META-ORCH-0929 per-invite processing state (to disable Accept/Decline while in-flight)
const [processingInviteIds, setProcessingInviteIds] = useState<Set<string>>(new Set());
```

#### 5.1.3 Modify the `+` button onPress (lines 2891-2905)

Change `onPress={() => { HapticFeedback.light(); setShowPairRequestModal(true); }}` to `onPress={() => { HapticFeedback.light(); setShowFriendsActionChooser(true); }}`.

Change `accessibilityLabel="Pair with a friend"` to `accessibilityLabel={t('social:friendsActionChooserPlusButtonA11y')}`.

#### 5.1.4 Add the new sheet mounts (near existing `<PairRequestModal />` mount around line 3389)

```tsx
<FriendsActionChooserSheet
  visible={showFriendsActionChooser}
  onClose={() => setShowFriendsActionChooser(false)}
  createGroupChatDisabled={!gateAllows && !isUnlimited}
  onChooseCreateGroupChat={() => {
    setShowFriendsActionChooser(false);
    requestAnimationFrame(() => setShowCreateGroupChatSheet(true));
  }}
  onChooseAddFriend={() => {
    setShowFriendsActionChooser(false);
    requestAnimationFrame(() => setShowPairRequestModal(true));
  }}
  onCreateGroupChatPaywall={() => {
    setShowFriendsActionChooser(false);
    requestAnimationFrame(() => setShowPaywall(true));
  }}
/>

<CreateGroupChatSheet
  visible={showCreateGroupChatSheet}
  onClose={() => setShowCreateGroupChatSheet(false)}
  availableFriends={availableFriendsForCreate ?? []}
  isCreating={isCreatingGroupChat ?? false}
  onSubmit={async (name, friends) => {
    if (!onCreateGroupChat) return;
    const { conversationId, sessionId } = await onCreateGroupChat(name, friends);
    // Navigate user to the new chat — handled by useEffect watching for new conversation id
    setShowCreateGroupChatSheet(false);
    // Synthesize a chat-select via handleSelectConversation pattern
    const created = conversations.find(c => c.id === conversationId);
    if (created) {
      await handleSelectConversation(created);
    } else {
      // The just-created conversation may not be in the list yet — fetch + then select.
      await fetchConversations(user!.id);
      const refetched = conversations.find(c => c.id === conversationId);
      if (refetched) await handleSelectConversation(refetched);
    }
  }}
  onCreated={() => { /* parent navigates */ }}
/>

{/* Existing PaywallSheet — only if not already mounted via another path. Implementor confirms during integration. */}
{showPaywall && (
  <PaywallSheet
    visible={showPaywall}
    onClose={() => setShowPaywall(false)}
    // ... existing paywall props
  />
)}
```

The `gateAllows / isUnlimited` come from `useSessionCreationGate()` — implementor adds the hook import to ConnectionsPage (already used by CollaborationSessions today).

#### 5.1.5 Pending-invite rows in the conversations list

`ConnectionsPage.tsx:870-1044` (the `fetchConversations` transform) needs a new query path. Today it fetches conversations via `messagingService.getConversations`. The META extends this:

```ts
// Inside fetchConversations, AFTER existing transform produces `transformed: Conversation[]`:

// META-ORCH-0929: fetch pending invites that should surface as chat rows.
// Reuses existing session-invite query infrastructure (the hook that today feeds
// CollaborationSessions' received-invite pills). The query lives in useSessionManagement
// or equivalent — implementor confirms exact location.
const pendingInvites = await fetchPendingSessionInvitesForUser(userId);
//   ^ shape: Array<{ sessionId, inviteId, inviterDisplayName, inviterAvatarUrl, createdAt }>

const pendingInviteRows: Conversation[] = pendingInvites.map(inv => ({
  id: `pending-invite-${inv.inviteId}`,  // synthetic id; distinguishes from real conv
  created_by: '',
  created_at: inv.createdAt,
  participants: [],  // empty — invite has no real participants yet on this user's side
  unread_count: 0,
  messages: [],
  type: 'group' as const,
  name: null,
  session_id: inv.sessionId,
  // META-ORCH-0929 EXTRA: tag this row as a pending invite for the renderer to branch
  __pendingInvite: inv,
}));

setConversations([...pendingInviteRows, ...transformed]);  // pending always first per Q2d (newest invite-first)
```

The conversation list renderer at the chat-list FlatList branches on the row shape:

```tsx
renderItem={({ item }) =>
  '__pendingInvite' in item ? (
    <PendingSessionInviteRow
      invite={item.__pendingInvite}
      isProcessing={processingInviteIds.has(item.__pendingInvite.inviteId)}
      onAccept={async (sessionId, inviteId) => {
        setProcessingInviteIds(prev => new Set(prev).add(inviteId));
        try {
          await onAcceptPendingInvite?.(sessionId, inviteId);
          await fetchConversations(user!.id);  // refresh: invite row replaced by real chat
        } finally {
          setProcessingInviteIds(prev => { const n = new Set(prev); n.delete(inviteId); return n; });
        }
      }}
      onDecline={async (sessionId, inviteId) => {
        setProcessingInviteIds(prev => new Set(prev).add(inviteId));
        try {
          await onDeclinePendingInvite?.(sessionId, inviteId);
          await fetchConversations(user!.id);  // refresh: invite row removed
        } finally {
          setProcessingInviteIds(prev => { const n = new Set(prev); n.delete(inviteId); return n; });
        }
      }}
    />
  ) : (
    <ChatListItem
      conversation={item}
      // ... existing props
    />
  )
}
```

Sort order: pending invites first (per Q2d — newest invite is "more urgent" than older chats). Within pending invites, newest first by `createdAt`. Existing chats sort unchanged.

#### 5.1.6 Imports + cleanup

Add:
```tsx
import { FriendsActionChooserSheet } from "./connections/FriendsActionChooserSheet";
import { CreateGroupChatSheet } from "./connections/CreateGroupChatSheet";
import { PendingSessionInviteRow } from "./connections/PendingSessionInviteRow";
import { useSessionCreationGate } from "../hooks/useSessionCreationGate";  // for paywall gate
// (PaywallSheet already imported if used elsewhere; implementor confirms)
```

Remove the existing literal accessibility string `"Pair with a friend"` (replaced by the i18n key). Strict-grep verifies removal.

---

### 5.2 `HomePage.tsx`

**File:** `app-mobile/src/components/HomePage.tsx`

#### 5.2.1 Prop interface SHRINK

DELETE these props from `HomePageProps` (line ~25-65):
- `currentMode` (line 29)
- `boardsSessions` (already had — check, may stay for solo's saved-cards needs; implementor confirms)
- `selectedSessionId` (line 53)
- `collaborationSessions` (search exact line)
- `onSessionSelect`
- `onSoloSelect`
- `onCreateSession`
- `onAcceptInvite`
- `onDeclineInvite`
- `onCancelInvite`
- `onInviteMoreToSession`
- `onSessionStateChanged`
- `availableFriends`
- `isCreatingSession`
- `openSessionId`
- `onOpenSessionHandled`

Keep:
- `userPreferences`, `accountPreferences`, `userId`, `savedCards`, `onSaveCard`, `onShareCard`, `onAddToCalendar`, `onPurchaseComplete`, `removedCardIds`, `onResetCards`, `onOpenPreferences`, `onOpenCollabPreferences`, `generateNewMockCard`, `refreshKey`, `onboardingData`, `onNotificationNavigate`.

#### 5.2.2 Delete the GlassSessionSwitcher mount

Delete `HomePage.tsx:269-308` entire `sessionSwitcher={...}` prop block on `GlassTopBar`. The `GlassTopBar` `sessionSwitcher` prop becomes optional (or deleted if unused — implementor checks other consumers).

#### 5.2.3 Delete the CollaborationSessions mount

Delete `HomePage.tsx:320-350` entire conditional render block.

#### 5.2.4 Lock SwipeableCards to solo

Change `HomePage.tsx:354-377`:
```tsx
<SwipeableCards
  userPreferences={userPreferences}
  accountPreferences={accountPreferences}
  // META-ORCH-0929: HomePage is solo-only. Do NOT pass currentMode or sessionIdOverride.
  // SwipeableCards defaults currentMode="solo" when undefined.
  boardsSessions={[]}  // not needed for solo
  onAddToCalendar={onAddToCalendar}
  onCardLike={onSaveCard || asyncNoop}
  onShareCard={onShareCard}
  onPurchaseComplete={onPurchaseComplete}
  removedCardIds={removedCardIds}
  onResetCards={onResetCards}
  onOpenPreferences={onOpenPreferences}
  onOpenCollabPreferences={onOpenCollabPreferences}
  generateNewMockCard={generateNewMockCard}
  onboardingData={onboardingData}
  refreshKey={refreshKey}
  savedCards={savedCards}
  coachDeckRef={coachDeck.targetRef}
/>
```

The `canMountDeck` check at line 353 may simplify — implementor checks whether the "Deck open elsewhere" mutex is still needed (it was a sentinel for cross-mode collision; with no mode switching on Home, it may be removable). Default: keep the mutex check (defensive) but flag in implementation report.

#### 5.2.5 Delete unused imports

Remove `GlassSessionSwitcher`, `SessionSwitcherItem`, `CollaborationSessions` imports.

---

### 5.3 `MessageInterface.tsx`

**File:** `app-mobile/src/components/MessageInterface.tsx`

#### 5.3.1 Add CollabDeckSheet visibility state

Inside the component body:
```tsx
// META-ORCH-0929
const [showCollabDeckSheet, setShowCollabDeckSheet] = useState(false);
```

#### 5.3.2 Mount StartSwipingHeaderButton in header right slot

Inside the header rendering (implementor finds the exact location — likely near the existing 3-dot menu rendering), conditional on `isGroupSessionChat` (the existing check at line 243):

```tsx
{isGroupSessionChat && (
  <StartSwipingHeaderButton
    onPress={() => setShowCollabDeckSheet(true)}
  />
)}
```

If layout permits, place it LEFT of the 3-dot menu (so menu stays rightmost).

#### 5.3.3 Add CollabDeckSheet mount

Near the bottom of the component's JSX (close to other modals):
```tsx
{isGroupSessionChat && friend.sessionId && (
  <CollabDeckSheet
    visible={showCollabDeckSheet}
    onClose={() => setShowCollabDeckSheet(false)}
    sessionId={friend.sessionId}
    sessionName={friend.name || t('social:collabDeckSheetTitle')}
    userPreferences={/* prop chain from parent */}
    accountPreferences={/* prop chain */}
    savedCards={/* prop chain */}
    onSaveCard={/* prop chain */}
    onShareCard={/* prop chain */}
    onAddToCalendar={/* prop chain */}
    onPurchaseComplete={/* prop chain */}
    onOpenPreferences={/* prop chain */}
    onOpenCollabPreferences={/* prop chain */}
  />
)}
```

These props chain up: ConnectionsPage → MessageInterface → CollabDeckSheet. Implementor adds them to MessageInterface's props interface and ConnectionsPage's MessageInterface-mount prop list.

#### 5.3.4 Add "Leave session" menu item

Inside the existing 3-dot menu (`MessageInterface.tsx` — implementor finds the menu structure), add a new item visible only when `isGroupSessionChat`:

```tsx
{isGroupSessionChat && (
  <MenuItem
    label={t('social:leaveSessionMenuItem')}
    icon="exit-outline"
    destructive
    onPress={() => {
      Alert.alert(
        t('social:leaveSessionConfirmTitle'),
        t('social:leaveSessionConfirmBody'),
        [
          { text: t('common:cancel'), style: 'cancel' },
          {
            text: t('social:leaveSessionMenuItem'),
            style: 'destructive',
            onPress: async () => {
              // Reuses existing onGroupSessionExited callback that already exists at line 187
              onGroupSessionExited?.(friend.sessionId!);
            },
          },
        ]
      );
    }}
  />
)}
```

The `onGroupSessionExited` prop already exists at `MessageInterface.tsx:187`. The handler implementation lives upstream (ConnectionsPage / app/index.tsx) and triggers the existing leave-session RPC.

---

### 5.4 `app/index.tsx`

**File:** `app-mobile/app/index.tsx`

#### 5.4.1 State deletions (Q9 — no global active session)

DELETE these state declarations:
- `currentSessionId` (replaced by per-chat `friend.sessionId`)
- `sessionModalTrigger`
- `pendingSessionOpen`
- `inviteModalTrigger`
- `currentMode` (Home is always solo; mode lives inside CollabDeckSheet)

#### 5.4.2 Handler deletions

DELETE:
- `handleSessionSelect`
- `handleSoloSelect`
- `handleInviteMoreToSession`
- `handleSessionStateChanged` (if only consumer was HomePage — check)
- `handleModeChange` (if any)
- Any `setSessionModalTrigger` callsite

KEEP:
- `handleCreateSession` (line 1389) — RENAME to `handleCreateGroupChat` and update internal calls. This is now ONLY called from `CreateGroupChatSheet`. Inside, it performs the same atomic create (session row + group chat conversation row + participant rows + invite records). On success, returns `{ conversationId, sessionId }` to the caller.
- `handleAcceptInvite` (existing) — wired to ConnectionsPage's new `onAcceptPendingInvite` prop. Internally calls `acceptCollaborationInviteWithPrefs` per ORCH-0909 §6.4 (no new code — already shipped).
- `handleDeclineInvite` (existing) — wired to ConnectionsPage's new `onDeclinePendingInvite` prop.
- `handleCancelInvite` (existing) — survives for any inviter-side cancel flow.
- `handleCreateSessionFromConnections` (line 2183) — RENAME to `handleGroupChatRefreshAfterCreate` for clarity (it's a refresh hook).
- `refreshAllSessions` (existing) — survives.

#### 5.4.3 HomePage prop block (lines 2352-2399) shrinks

Remove every prop in the deletion list from §5.2.1. HomePage's mount becomes ~12 props instead of ~22.

#### 5.4.4 ConnectionsPage prop block (lines 2440-2469 + 2717-2737) expands

Add the new props from §5.1.1 to BOTH ConnectionsPage mount sites. Remove the obsolete `onCreateSession` async-stub at line 2457-2459 (replaced by `onCreateGroupChat`).

#### 5.4.5 Notification navigation handler updates

If `handleNotificationNavigate` (or equivalent) currently routes session-related pushes to `setPendingSessionOpen(sessionId)` to open the CollaborationSessions session modal, REWIRE per Q8 to:
1. `setCurrentPage("connections")` (switch to Friends tab).
2. Resolve the conversation_id for that session_id.
3. Synthesize a `handleSelectConversation` call to open MessageInterface for that chat.

Implementor adds a helper if needed: `findConversationIdBySessionId(sessionId)` querying the existing conversations cache.

---

### 5.5 ORCH-0926 fold-in: `RecommendationsContext.tsx`, `useAuthSimple.ts`, `useBoardSession.ts`, `realtimeService.ts`

Operator's dirty changes (~170 lines diff total per `git diff --stat`) are the in-flight ORCH-0926 [Realtime scoped authenticated rebind] implementation. Per Q1: fold into META.

**Procedure for the implementor:**

1. **Read** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` end-to-end to understand the ORCH-0926 design intent.
2. **Read** `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` §6.6 (`useBoardSession` realtime path) — confirms ORCH-0909's expectations for this layer are unchanged by ORCH-0926's rebind work.
3. **Adopt** the dirty-changes content as-shipped — these are the actual ORCH-0926 implementation. Do NOT re-derive; preserve the diff content.
4. **Verify integration with META:**
   - `RecommendationsContext.tsx` (+42 -27): ensure the META's HomePage-strip changes (removing the HomePage-only mode plumbing fallbacks if any) don't conflict with the ORCH-0926 realtime subscription changes. Both touch the same context but different concerns (auth-event rebind vs. mode plumbing) — clean orthogonal merge expected.
   - `useAuthSimple.ts` (+28 -0): pure addition (auth-event rebind wiring). No conflict — META doesn't touch this file otherwise.
   - `useBoardSession.ts` (+31 -8): async subscription handling. No conflict — META doesn't change useBoardSession's API surface beyond what ORCH-0909 already shipped.
   - `realtimeService.ts` (+98 -29): scoped authenticated rebind for `board_session:{sessionId}`. No conflict — META uses the same channel pattern.
5. **Run the ORCH-0926 regression tests** (per the implementation report) to confirm they still pass after the META reshape. Cite passing test paths + commit hash in the META's implementation report under §13 fold receipts.
6. **Re-attach ORCH-0926 evidence:** copy the QA report's verdict + the 4 file diffs into the META's implementation report so the orchestrator can close BOTH ORCH-0926 and META-ORCH-0929 from this single PR per the operator-approved bundle exception (one PR closes 2 ORCHs).

**The META's CLOSE-time PR title must name both ORCH-IDs:**
```
Close META-ORCH-0929 + ORCH-0926: collab decks in group chat + Home solo-only + realtime scoped rebind
```

---

## 6. Layer 6 (Database, Edge Function, Service) — NO CHANGES

| Layer | Change in META? | Notes |
|---|---|---|
| Database (`supabase/migrations/`) | NONE | ORCH-0902/0909/0906 schema already shipped per §1. No new tables, columns, constraints, indexes, RLS. |
| RPCs | NONE | `pg_aggregate_collab_prefs`, `query_servable_places_by_signal_intersection`, `accept_session_with_prefs`, `recompute_deck_version_after_prefs_change`, ORCH-0906's curated-cache helpers — all already shipped. |
| Edge functions | NONE | `discover-cards/handleDeterministicV2` + ORCH-0906 curated invocation — already shipped. |
| Service layer | MINOR | `collaborationInviteService.ts` already implements `acceptCollaborationInviteWithPrefs` per ORCH-0909 §6.4 — no change. `useSessionManagement` callers may get renamed for clarity (no behavior change). |
| Hooks | MINOR | `useSessionManagement.createSession` (or equivalent — implementor confirms exact name) is the underlying call CreateGroupChatSheet uses. No new hook logic; META just calls existing hooks from a new component. |

If the implementor discovers a missing piece (e.g., a hook returning pending invites in the shape PendingSessionInviteRow expects doesn't exist), it should be ADDED as a minimal helper, not as a new server-side change. Flag any such discovery in the implementation report.

---

## 7. Success Criteria

| ID | Criterion | Observable | Test layer |
|----|-----------|------------|------------|
| **MET-1** | Tapping `+` on Friends page opens FriendsActionChooserSheet (not PairRequestModal directly). | Visible | Maestro |
| **MET-2** | Chooser shows exactly 2 options: "Create a group chat" (top) + "Add a friend" (bottom), equal weight. | Visible | Maestro screenshot |
| **MET-3** | "Add a friend" closes chooser + opens PairRequestModal with no flicker (rAF defer working). | Visible | Component test + Maestro |
| **MET-4** | "Create a group chat" closes chooser + opens CreateGroupChatSheet with no flicker. | Visible | Component test + Maestro |
| **MET-5** | When paywall gate fails (`!gateAllows && !isUnlimited`), "Create a group chat" option shows "Pro plan required" badge; tap opens paywall sheet (NOT create sheet). | Visible | Component test |
| **MET-6** | Chooser backdrop tap dismisses chooser with no downstream sheet opened. | Visible | Component test |
| **MET-7** | CreateGroupChatSheet creates a group-chat conversation + collab-session row atomically on submit; user lands inside the new MessageInterface for that chat. | Visible + DB | Maestro + SQL probe `collaboration_sessions` |
| **MET-8** | CreateGroupChatSheet submit is disabled when `!name.trim()` OR `selectedFriends.length === 0` OR `isCreating`. | Visible | Component test |
| **MET-9** | HomePage no longer renders GlassSessionSwitcher (zero matches in grep + zero in render tree). | Code + Visual | Static grep + Maestro screenshot of Home top-bar |
| **MET-10** | HomePage `<SwipeableCards>` mount passes neither `currentMode` nor `sessionIdOverride` (always solo). | Code | Static grep on HomePage.tsx |
| **MET-11** | `GlassSessionSwitcher.tsx` file does NOT exist; zero imports of it anywhere. | Code | `ls` + grep |
| **MET-12** | `CollaborationSessions.tsx` file does NOT exist; zero imports of it anywhere. | Code | `ls` + grep |
| **MET-13** | `app/index.tsx` no longer declares `currentSessionId`, `sessionModalTrigger`, `pendingSessionOpen`, `inviteModalTrigger`, `currentMode` state. | Code | Static grep |
| **MET-14** | Inside a session-linked group chat (MessageInterface), the "Start swiping together" header CTA is visible. | Visible | Maestro |
| **MET-15** | Tapping the "Start swiping together" CTA opens CollabDeckSheet full-screen with the SwipeableCards deck rendered in collab mode for that session. | Visible | Maestro |
| **MET-16** | CollabDeckSheet close button (back-arrow header left) dismisses the sheet; underlying chat is visible again. | Visible | Maestro |
| **MET-17** | Android hardware back inside CollabDeckSheet dismisses the sheet (not the chat or the app). | Visible | Maestro on Android emulator |
| **MET-18** | Incoming session invite appears as a chat-list row in the conversations list within 5 seconds of the invite being sent. | Visible | Maestro across two simulators |
| **MET-19** | Pending-invite row shows ONLY inviter name + subtitle + Accept/Decline buttons; chat content (messages) is NOT visible until accept. | Visible | Maestro |
| **MET-20** | Tapping Accept on a pending-invite row calls `acceptCollaborationInviteWithPrefs` (existing ORCH-0909 contract); on success row converts to regular ChatListItem; user can tap to enter the chat. | Visible + DB | Maestro + SQL probe `session_participants.has_accepted` |
| **MET-21** | Tapping Decline removes the row from the list; inviter is NOT notified. | Visible + telemetry | Maestro + check absence of decline-notify event |
| **MET-22** | Pending-invite rows sort newest first, ABOVE existing chats. | Visible | Maestro |
| **MET-23** | "Leave session" menu item appears in MessageInterface 3-dot menu when in a session-linked group chat. Tap shows confirm dialog. Confirm calls `onGroupSessionExited`. | Visible | Maestro |
| **MET-24** | "Leave session" menu item does NOT appear in non-session group chats (event/trip chats) or DMs. | Visible | Maestro |
| **MET-25** | No notion of "active session" survives anywhere — tabbing between two group chats and entering CollabDeckSheet on each shows each session's independent deck state. | Visible + DB | Maestro across two chats |
| **MET-26** | Notification deep-link for a session invite navigates to the Friends tab + opens the corresponding group chat (NOT directly to CollabDeckSheet). | Visible | Manual push test |
| **MET-27** | ORCH-0926 regression tests still pass post-META reshape. | Code | Run cited tests; cite passing log |
| **MET-28** | i18n: all 17 new keys present in every locale `social.json`. | Code | Static node assert |
| **MET-29** | The literal accessibility string `"Pair with a friend"` is removed from `ConnectionsPage.tsx`. | Code | grep returns 0 matches |
| **MET-30** | Net code change: deletion exceeds addition (target net −1000 lines or more). | Code | `git diff --stat` review |
| **MET-31** | Home tab `<SwipeableCards>` works in solo mode end-to-end (cards load, swipe right saves, swipe left dismisses). No regression. | Visible | Maestro |
| **MET-32** | RecommendationsContext collab path is reachable ONLY when CollabDeckSheet is mounted (never from HomePage). | Code | Static analysis: trace `sessionIdOverride` callers — only CollabDeckSheet. |

### Carried-from-ORCH-0909 SCs (verbatim, already shipped — META re-verifies they still hold post-relocation)

| ID | Criterion |
|----|-----------|
| **MET-CR-1** | Determinism contract holds: every participant sees the same card at the same position. |
| **MET-CR-2** | Union/intersection geographic semantics (per ORCH-0909) hold across participants. |
| **MET-CR-3** | Late-joiner sees the frontier (current_position). |
| **MET-CR-4** | Deck-state resumes across app restarts. |
| **MET-CR-5** | "Locating you" banner appears when GPS pending. |
| **MET-CR-6** | Left-swipe dismissed-cards sheet is visible-but-not-binding. |
| **MET-CR-7** | Quorum match notifications fire. |
| **MET-CR-A** | Single↔intent strict-1:1 alternation works (ORCH-0906). |
| **MET-CR-B** | Curated-cache hits within session lifetime. |

These are re-verified by the tester at QA time — they should pass because the underlying contracts didn't change, only the React mount location did.

---

## 8. Invariants

### Preserved (existing)

- **I-SUB-SHEET-INSIDE-PARENT** — enforced via rAF defer in chooser.
- **Constitution #1, #2, #8** — see investigation §3 Finding 10.
- **All ORCH-0902/0909/0906 invariants** — verbatim. The META does not touch the contracts.
- **I-COLLAB-MATCH-OBSERVABLE** — match telemetry unaffected by relocation.

### New (established by this META)

| ID | Description | Enforcement |
|----|-------------|-------------|
| **I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN** | The Friends `+` chooser MUST dismiss itself before triggering any downstream sheet via `requestAnimationFrame`. | Adversarial component test (mocks rAF to no-op + asserts downstream sheet renders invisible). |
| **I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT** | `<SwipeableCards>` is mounted in collab mode (`sessionIdOverride` truthy) by EXACTLY ONE React tree at any time: `CollabDeckSheet`. No other component may pass `sessionIdOverride`. | Strict-grep CI gate: `grep -rn "sessionIdOverride=" app-mobile/src` must return only matches inside `CollabDeckSheet.tsx`. |
| **I-PROPOSED-META-0929-HOME-IS-SOLO-ONLY** | `HomePage.tsx` must not pass `currentMode` or `sessionIdOverride` to `<SwipeableCards>`. | Strict-grep CI gate. |
| **I-PROPOSED-META-0929-NO-GLOBAL-ACTIVE-SESSION** | `app/index.tsx` must not declare `currentSessionId`, `sessionModalTrigger`, `pendingSessionOpen`, `inviteModalTrigger`, or any state representing a global "active" collab session. Per-chat session state lives ONLY in the chat row's `friend.sessionId`. | Strict-grep CI gate. |

These four new invariants get codified in `Mingla_Artifacts/INVARIANT_REGISTRY.md` at CLOSE Step 5e.

### Updated memory

**`feedback_solo_collab_parity.md`** — UPDATE at CLOSE Step 5c. The "always check both" parity rule loses literal meaning post-META (solo and collab live in different surfaces). New scope: parity applies WITHIN the deck experience (i.e., `SwipeableCards` + `RecommendationsContext` shared logic must work whether `sessionIdOverride` is truthy or not), not across render surfaces.

---

## 9. Test Cases

### 9.1 Implementor-owned happy-path regression tests (ORCH-0840 Step 0.5 gate)

| ID | File | Scenario |
|----|------|----------|
| **T-IMP-1** | `app-mobile/src/components/connections/__tests__/FriendsActionChooserSheet.happy.test.tsx` | Tap `+` → chooser visible. Tap "Add a friend" → chooser dismissed + PairRequestModal visible. Tap "Create a group chat" (gate allows) → chooser dismissed + CreateGroupChatSheet visible. |
| **T-IMP-2** | `app-mobile/src/components/connections/__tests__/CreateGroupChatSheet.happy.test.tsx` | Open sheet, type name, select 2 friends, tap Create. `onSubmit` called with `(name.trim(), [friend1, friend2])`. After resolve, `onCreated` fires with the conversationId + sessionId. |
| **T-IMP-3** | `app-mobile/src/components/connections/__tests__/CollabDeckSheet.happy.test.tsx` | Mount with `visible=true, sessionId="abc"`. Assert `<SwipeableCards>` rendered with `sessionIdOverride="abc"`. Close button calls `onClose`. |
| **T-IMP-4** | `app-mobile/src/components/connections/__tests__/PendingSessionInviteRow.happy.test.tsx` | Render with invite. Tap Accept → `onAccept(sessionId, inviteId)` fires. Tap Decline → `onDecline(sessionId, inviteId)` fires. Buttons disabled while `isProcessing=true`. |

Each test MUST include `fails-on-revert verified at <commit-hash>` in the implementation report.

### 9.2 Tester-owned adversarial regression tests (ORCH-0840 Step 0.5 gate)

| ID | File | Scenario |
|----|------|----------|
| **T-ADV-1** | `app-mobile/src/components/connections/__tests__/FriendsActionChooserSheet.adversarial.test.tsx` | Mock `requestAnimationFrame` to no-op. Tap "Add a friend" → assert PairRequestModal is NOT visible (proves rAF defer is load-bearing per I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN). |
| **T-ADV-2** | `app-mobile/src/components/connections/__tests__/CollabDeckSheet.adversarial.test.tsx` | Mount CollabDeckSheet with `sessionId=undefined`. Assert it does NOT render (defensive null guard). Mount with `sessionId="abc"` then unmount mid-swipe. Assert no error / no leaked subscription. |
| **T-ADV-3** | `app-mobile/src/components/connections/__tests__/PendingSessionInviteRow.adversarial.test.tsx` | Render with `isProcessing=true`. Tap Accept rapidly 5 times — assert `onAccept` called exactly ONCE (idempotency under user spam). Same for Decline. |
| **T-ADV-4** | `app-mobile/src/i18n/__tests__/meta-0929-locale-completeness.test.ts` | Iterate every `app-mobile/src/i18n/locales/<lang>/social.json` — assert all 17 META keys present. |

Each adversarial test attacks a DIFFERENT angle than its happy-path sibling.

### 9.3 Manual sim regression matrix

| ID | Scenario | Devices |
|----|----------|---------|
| **T-SIM-1** | Full chooser → create group chat → enter chat → see Start Swiping CTA → open CollabDeckSheet → swipe a card → close sheet → back to chat | iOS sim + Android emu |
| **T-SIM-2** | Second device joins via accepted invite from chat list → CollabDeckSheet on both devices shows same card at same position (ORCH-0909 determinism contract) | Two iOS sims |
| **T-SIM-3** | Home tab swipe deck (solo mode) — no regression from solo perspective | iOS sim + Android emu |
| **T-SIM-4** | Tap a session push notification from background — lands in Friends tab + correct group chat | iOS sim (push tested via test send) |
| **T-SIM-5** | "Leave session" from 3-dot menu — confirm dialog → leave → CollabDeckSheet becomes unavailable; chat remains | iOS sim |

### 9.4 ORCH-0926 regression re-verification

Run the existing ORCH-0926 regression tests cited in `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` and `QA_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md`. Confirm all pass post-META reshape. Cite test paths + commit hashes in the META's implementation report.

---

## 10. Implementation Order

Strict execution order — out-of-order risks intermediate broken states.

### Phase A — i18n + new components (additive, no deletions yet)

1. Add all 17 new i18n keys from §2.1 to every `app-mobile/src/i18n/locales/<lang>/social.json`. English values from the table; placeholder English in other locales.
2. Create `FriendsActionChooserSheet.tsx` per §4.1.
3. Create `CreateGroupChatSheet.tsx` per §4.2.
4. Create `CollabDeckSheet.tsx` per §4.3.
5. Create `PendingSessionInviteRow.tsx` per §4.4.
6. Create `StartSwipingHeaderButton.tsx` per §4.5 (or inline into MessageInterface per implementor choice).
7. Write the 4 implementor-owned happy-path tests (T-IMP-1..T-IMP-4 in §9.1). Verify each passes. Verify fails-on-revert. Cite commit hashes in implementation report.

### Phase B — Wire chooser + create + accept paths

8. Modify `ConnectionsPage.tsx` per §5.1 (new props, state, sheet mounts, pending-invite row rendering).
9. Modify `app/index.tsx` per §5.4 — ADD the new ConnectionsPage props (don't delete state yet — that comes in Phase D).
10. Verify chooser → create flow works end-to-end on iOS sim. Capture screenshot.
11. Verify chooser → "Add a friend" → PairRequestModal still works (no regression). Capture screenshot.
12. Verify pending-invite rows appear in chat list. Verify Accept + Decline buttons work.

### Phase C — Wire CollabDeckSheet + MessageInterface CTA + leave-session

13. Modify `MessageInterface.tsx` per §5.3 (state, header CTA, sheet mount, leave-menu).
14. Wire prop chain ConnectionsPage → MessageInterface → CollabDeckSheet for `userPreferences`, `accountPreferences`, `savedCards`, etc.
15. Verify session-linked group chat shows the "Start swiping together" CTA. Tap → CollabDeckSheet opens. Cards render (driven by existing ORCH-0909 contract). Swipe works. Close works.
16. Verify "Leave session" menu item appears in 3-dot menu of session-linked chats only.

### Phase D — Deletions + cleanup

17. Modify `HomePage.tsx` per §5.2 — strip session props, delete GlassSessionSwitcher mount, delete CollaborationSessions mount, lock SwipeableCards to solo, remove unused imports.
18. Modify `app/index.tsx` per §5.4 — delete the `currentSessionId`/`sessionModalTrigger`/etc. state + handlers + HomePage prop wiring.
19. DELETE `app-mobile/src/components/GlassSessionSwitcher.tsx`.
20. DELETE `app-mobile/src/components/CollaborationSessions.tsx`.
21. Run grep verifications: zero matches for `GlassSessionSwitcher`, `CollaborationSessions`, `createTriggerNonce`, `modalsOnlyMode`, `selectedSessionId`, `currentSessionId`, `sessionModalTrigger`, `pendingSessionOpen`.
22. TypeScript check: `cd app-mobile && npx tsc --noEmit` — zero errors.
23. Lint: zero new errors.

### Phase E — Fold ORCH-0926

24. Preserve the operator's dirty changes to `RecommendationsContext.tsx`, `useAuthSimple.ts`, `useBoardSession.ts`, `realtimeService.ts` AS-IS (these are the ORCH-0926 implementation).
25. Re-run the ORCH-0926 regression tests cited in the ORCH-0926 implementation report. Confirm passing. Cite test paths + commit hashes in the META's implementation report under §13.
26. Verify the META's changes (HomePage strip, ConnectionsPage rewire) don't conflict with ORCH-0926's changes in the same files.

### Phase F — Tester gates + adversarial tests

(Implementor does NOT write these — tester does. Listed here for implementor awareness.)

27. (Tester) Write T-ADV-1..T-ADV-4 per §9.2. Verify each passes + fails on the relevant revert. Cite hashes in QA report.
28. (Tester) Run manual sim regression matrix per §9.3 — iOS + Android.
29. (Tester) Re-run ORCH-0926 regressions per §9.4.
30. (Tester) Constitution sweep (14 rules) + spec-compliance against all 32 MET-* SCs + 9 carried CRs.

### Phase G — Implementation report

31. Implementor writes `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` with:
   - Files modified (line-range citations)
   - i18n diffs (17 keys × N locales)
   - 3 iOS sim screenshots: (a) Friends chooser open, (b) MessageInterface with Start Swiping CTA, (c) CollabDeckSheet open mid-swipe
   - Test logs from Phase A.7 + Phase E.25 + fails-on-revert citations
   - ORCH-0926 fold receipts (test paths + commit hashes)
   - Net code change: `git diff --stat` summary (expect net −1000+ lines)
   - Deploy receipt: `[deploy]` NOT required (no Vercel-built surface); EAS OTA eligible (pure RN, no native module change, no migration); PR title must name both META-ORCH-0929 + ORCH-0926.

---

## 11. Regression Prevention

- **Strict-grep CI gates** (4 new):
  - `meta-0929-collab-deck-single-mount` — `sessionIdOverride=` only inside `CollabDeckSheet.tsx`.
  - `meta-0929-home-is-solo-only` — `HomePage.tsx` must not pass `currentMode` or `sessionIdOverride` to `SwipeableCards`.
  - `meta-0929-no-global-active-session` — `app/index.tsx` must not declare `currentSessionId|sessionModalTrigger|pendingSessionOpen|inviteModalTrigger|currentMode` state names.
  - `meta-0929-no-resurrected-glass-session-switcher` — `GlassSessionSwitcher|CollaborationSessions` must return 0 matches.
- **Adversarial tests** T-ADV-1..T-ADV-4 catch the most likely regressions (rAF removal, defensive null-guard removal, idempotency loss, locale-key drift).
- **Protective comments** in `FriendsActionChooserSheet.tsx` near the option handlers (mirroring the ORCH-0928 pattern from §3.2.4's superseded SPEC) explaining the rAF defer + I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN invariant.
- **CLOSE Step 5e** registers all 4 new invariants in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
- **CLOSE Step 5c** updates `feedback_solo_collab_parity.md` with the new "deck-experience-not-render-surface" scope.

---

## 12. Deploy Notes

- **No migration.** ORCH-0902/0909/0906 already shipped.
- **No edge function deploy.** Same reason.
- **EAS OTA eligible.** Pure RN client + i18n changes. No native module added/removed. No expo config change.
- **No Vercel `[deploy]` tag required** — zero Vercel-built surfaces touched.
- **PR title must be:** `Close META-ORCH-0929 + ORCH-0926: collab decks in group chat + Home solo-only + realtime scoped rebind` (operator-approved bundle exception per `feedback_one_pr_per_close.md` — bundling 2 ORCHs because ORCH-0926 was folded into the META by operator directive).
- **EAS update command on CLOSE:**
  ```
  cd app-mobile && eas update --branch production --platform ios,android \
    --message "META-ORCH-0929 + ORCH-0926: collab decks in group chat + Home solo-only + realtime scoped rebind"
  ```

---

## 13. ORCH-0926 fold receipts (implementor populates)

Implementor MUST populate this section in the implementation report:

- ORCH-0926 implementation diff content (4 files, ~170 lines) preserved AS-IS: ☐ confirmed
- ORCH-0926 happy-path regression test path: `<path>` — passing at commit `<hash>`
- ORCH-0926 adversarial regression test path: `<path>` — passing at commit `<hash>`
- ORCH-0926 fails-on-revert verified at commit `<hash>` (run by re-reverting the 4 dirty files and confirming test FAIL, then restoring)
- ORCH-0926 QA report's verdict + cited evidence preserved in META's QA report appendix
- WORLD_MAP banner for ORCH-0926 transitions from "IMPLEMENTED, awaiting close" to "CLOSED via META-ORCH-0929 PR" at CLOSE Step 1

---

## 14. CLOSE Step 5 extension flags

Per the orchestrator's CLOSE protocol Step 5a-5h, this META triggers the deprecation extension (it deletes 2 component files entirely). Specifically:

- **5a (new memory file):** `feedback_collab_deck_lives_in_group_chat.md` — codifies "Home is solo-only; collab decks mount ONLY inside CollabDeckSheet launched from MessageInterface; no global active-session concept." Status: DRAFT → ACTIVE on CLOSE.
- **5b (MEMORY.md update):** add pointer under "Mingla Business desktop-web / Mingla mobile" section.
- **5c (existing memory scan):** `feedback_solo_collab_parity.md` UPDATE per §8 above. Also scan for any memory referencing `GlassSessionSwitcher` or `CollaborationSessions.tsx` as live patterns — update with "REMOVED 2026-05-23 per META-ORCH-0929."
- **5d (skill definition reviews):** scan `.claude/skills/*/SKILL.md` for `GlassSessionSwitcher` / `CollaborationSessions` references — none expected, but verify.
- **5e (invariant registry):** add the 4 new invariants from §8.
- **5f (decision log):** add DEC entries: (i) "GlassSessionSwitcher + CollaborationSessions decommissioned per META-ORCH-0929" with operator-directive citation; (ii) "No global active-session — per-chat session state is canonical" with rationale.
- **5g (product snapshot + root cause register):** PRODUCT_SNAPSHOT mode-switching description gets rewritten; ROOT_CAUSE_REGISTER scan for collab-related root causes — any pointing at the deleted components gets RESOLVED with cross-ref.
- **5h (backup retention reminder):** N/A — no DB backup snapshot involved (this is a client-only redesign).

---

**END OF SPEC.**

Implementor: read this SPEC + `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` (full, including the CORRECTION banner at the top) + `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` (for the ORCH-0926 fold) + `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` §6.6 (for `useBoardSession` realtime path expectations). Execute Phases A→G in strict order. Write `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` per §10.31. The next dispatch will be Claude `mingla-tester` for TARGETED + SPEC-COMPLIANCE + cross-domain on the 32 MET-* SCs + 9 carried CRs + 4 adversarial tests + 5 manual sim flows + ORCH-0926 re-verification, then Codex `orchestrator-mingla` for CLOSE with the 2-ORCH bundle PR title.
