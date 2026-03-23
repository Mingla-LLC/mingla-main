# Spec: Collaboration UI Consolidation

**Date:** 2026-03-23
**Status:** Planned
**Mode:** Refactor — Access Pattern Consolidation

---

## 1. Summary

Three disconnected entry points currently reach collaboration features: (1) CollaborationSessions pill bar on HomePage, (2) CollaborationModule modal hidden in chat menu, (3) BoardViewScreen full page via notifications/deep links. The user wants **one entry point**: the CollaborationSessions pill bar, with session details shown in the existing **SessionViewModal** (already a modal). CollaborationModule and BoardViewScreen get deleted. Notifications route to HomePage and auto-open SessionViewModal for the relevant session.

## 2. Design Principle

**"The pill bar is the single gateway to all collaboration. Every collaboration action happens in a modal launched from it — never a page navigation."**

## 3. Source of Truth Definition

| Entity | Source of Truth | Where Accessed |
|--------|----------------|---------------|
| Session list | `collaboration_sessions` + `collaboration_invites` tables | CollaborationSessions pill bar (via parent props from index.tsx) |
| Session board content | `board_saved_cards`, `session_participants`, `board_card_messages` | SessionViewModal (already reads these) |
| Active session selection | Zustand `currentMode` | CollaborationSessions pill bar |
| Notification routing | `deepLinkService.ts` + `index.tsx` handlers | Modified to open modal instead of page |

## 4. Current State (What Exists Today)

### 4.1 CollaborationSessions (`app-mobile/src/components/CollaborationSessions.tsx`)
- **Pill bar on HomePage** — the visible entry point
- Pills: Solo | + (create) | [session pills] | [invite pills]
- Tap active session pill → opens **SessionViewModal** (line 213-214)
- Tap invite pill → opens invite accept/decline modal (line 209)
- Tap "+" → opens create session modal (line 428)
- **Already has the correct UX pattern.** All actions happen in modals.

### 4.2 SessionViewModal (`app-mobile/src/components/SessionViewModal.tsx`)
- **877-line modal** that already contains the full board experience:
  - Header with session name, participant avatars, settings button
  - BoardTabs (Saved | Discussion with unread badge)
  - SwipeableSessionCards (card carousel with voting/RSVP)
  - BoardDiscussionTab (group chat with @mentions)
  - BoardSettingsDropdown (rename, notifications, manage members, invite, exit, delete)
  - ManageBoardModal, InviteParticipantsModal, CardDiscussionModal
  - ExpandedCardModal (full card detail)
  - ShareModal
  - Calendar prompt on lock-in
  - Real-time subscriptions (5 event types)
  - Pagination + caching via BoardCache
  - Permission validation via BoardErrorHandler
- **This is already the "board in a modal."** It was built as the replacement.

### 4.3 CollaborationModule (`app-mobile/src/components/CollaborationModule.tsx`)
- Hidden modal reachable only from: Connections → friend chat → ⋯ menu → "Send Collaboration Invite"
- Has tabs: Sessions, Invites, Create
- SessionsTab punts to BoardViewScreen for actual content
- **Redundant.** Everything it does is already handled by CollaborationSessions + SessionViewModal.

### 4.4 BoardViewScreen (`app-mobile/src/components/board/BoardViewScreen.tsx`)
- Full-page board view rendered when `currentPage === 'board-view'`
- ~1,094 lines — same features as SessionViewModal but as a page
- Reached via: notification deep links, connections page board taps
- **Redundant.** SessionViewModal already provides the same experience as a modal.

## 5. Target State

```
CollaborationSessions (pill bar on HomePage)
├── Solo pill → switch to solo mode
├── "+" pill → Create Session modal (already works)
├── Session pill → SessionViewModal (already works)
├── Invite pill → Accept/Decline modal (already works)
└── Notification tap → navigate to HomePage, auto-open SessionViewModal for that session
```

**No CollaborationModule. No BoardViewScreen. No `board-view` page.**

## 6. Success Criteria

1. Tapping a collaboration notification opens HomePage → SessionViewModal for that session
2. Tapping a board message/card notification opens HomePage → SessionViewModal for that session
3. CollaborationModule is fully deleted — no imports, no renders, no state
4. BoardViewScreen is fully deleted — no imports, no renders, no `board-view` page case
5. "Send Collaboration Invite" menu item in chat is removed
6. All existing pill bar functionality (create, switch, accept/decline, view session) continues to work unchanged
7. `board-view` deep link routes to HomePage + auto-open SessionViewModal
8. No orphaned state variables (`boardViewSessionId`, `showCollaboration` in AppStateManager)

## 7. Non-Goals

1. **No feature changes to SessionViewModal** — it already has cards, voting, discussion, settings, calendar. No modifications needed.
2. **No changes to create session flow** — already works in CollaborationSessions.
3. **No changes to invite accept/decline flow** — already works in CollaborationSessions.
4. **No new components** — everything needed already exists.
5. **No database changes** — this is purely a UI access pattern refactor.

---

## 8. Implementation Plan

### Phase 1: Wire Notification → SessionViewModal

**Goal:** Notifications open the pill bar's SessionViewModal instead of BoardViewScreen.

#### 8.1.1 Add `openSessionId` prop to CollaborationSessions

CollaborationSessions needs a way for the parent (index.tsx) to say "open SessionViewModal for this session."

**File:** `app-mobile/src/components/CollaborationSessions.tsx`

**Change:** Add optional prop:
```typescript
interface CollaborationSessionsProps {
  // ... existing props ...
  openSessionId?: string | null;        // NEW: auto-open this session's modal
  onOpenSessionHandled?: () => void;    // NEW: callback to clear the trigger
}
```

**Behavior:** When `openSessionId` changes to a non-null value:
1. Find the session in the `sessions` array
2. If it's an active session → set `sessionToView` and `showSessionViewModal = true`
3. If it's a received-invite → set `inviteModalSession` and `showInviteModal = true`
4. Call `onOpenSessionHandled()` to clear the trigger (prevents re-opening on re-render)

**Implementation — add useEffect:**
```typescript
useEffect(() => {
  if (!openSessionId || !onOpenSessionHandled) return;

  const session = sessions.find(s => s.id === openSessionId);
  if (!session) {
    // Session not found yet — may still be loading. Don't clear trigger.
    return;
  }

  if (session.type === 'received-invite' || session.type === 'sent-invite') {
    setInviteModalSession(session);
    setShowInviteModal(true);
  } else {
    setSessionToView(session);
    setShowSessionViewModal(true);
    onSessionSelect(session.id);
  }

  onOpenSessionHandled();
}, [openSessionId, sessions, onOpenSessionHandled, onSessionSelect]);
```

#### 8.1.2 Add state in index.tsx to bridge notifications → pill bar

**File:** `app-mobile/app/index.tsx`

**Add state:**
```typescript
const [pendingSessionOpen, setPendingSessionOpen] = useState<string | null>(null);
```

**Pass to CollaborationSessions (in both render locations — home and likes):**
```typescript
<CollaborationSessions
  // ... existing props ...
  openSessionId={pendingSessionOpen}
  onOpenSessionHandled={() => setPendingSessionOpen(null)}
/>
```

#### 8.1.3 Reroute notification handlers

**File:** `app-mobile/app/index.tsx`

**Change `handleNotificationNavigate`** (line 853):

Replace the `board_message_` / `board_card_` block (lines 877-884):
```typescript
// BEFORE:
} else if (type.startsWith('board_message_') || type.startsWith('board_card_')) {
  const sessionId = notification.data?.sessionId as string;
  if (sessionId) {
    setBoardViewSessionId(sessionId);
    setCurrentPage('board-view');
  } else {
    setCurrentPage('likes');
  }
}

// AFTER:
} else if (type.startsWith('board_message_') || type.startsWith('board_card_')) {
  const sessionId = notification.data?.sessionId as string;
  if (sessionId) {
    setPendingSessionOpen(sessionId);
    setCurrentPage('home');
  } else {
    setCurrentPage('home');
  }
}
```

Also update the `collaboration_` / `session_` block (line 873) to include session opening:
```typescript
// BEFORE:
} else if (type.startsWith('collaboration_') || type.startsWith('session_')) {
  setCurrentPage('home');
}

// AFTER:
} else if (type.startsWith('collaboration_') || type.startsWith('session_')) {
  const sessionId = notification.data?.sessionId as string;
  if (sessionId) {
    setPendingSessionOpen(sessionId);
  }
  setCurrentPage('home');
}
```

#### 8.1.4 Reroute deep link handler

**File:** `app-mobile/src/services/deepLinkService.ts`

**Change the `session` case** (line 53-57):
```typescript
// BEFORE:
case 'session':
  return {
    page: 'board-view',
    params: { sessionId: pathSegments[1], ...params },
  };

// AFTER:
case 'session':
  return {
    page: 'home',
    params: { openSessionId: pathSegments[1], ...params },
  };
```

**Change `executeDeepLink`** (line 123-127):
```typescript
// BEFORE:
case 'board-view':
  if (params?.sessionId && handlers.setBoardViewSessionId) {
    handlers.setBoardViewSessionId(params.sessionId);
  }
  handlers.setCurrentPage('board-view');
  break;

// AFTER:
case 'home':
  if (params?.openSessionId && handlers.setPendingSessionOpen) {
    handlers.setPendingSessionOpen(params.openSessionId);
  }
  handlers.setCurrentPage('home');
  break;
```

**Update handler interface** to include `setPendingSessionOpen`:
```typescript
interface DeepLinkHandlers {
  setCurrentPage: (page: string) => void;
  setPendingSessionOpen?: (sessionId: string) => void;  // NEW
  // ... keep existing handlers for other deep link types ...
}
```

**Update `executeDeepLink` call in index.tsx** (line 860) to pass the new handler:
```typescript
executeDeepLink(action, {
  setCurrentPage: setCurrentPage as (page: string) => void,
  setPendingSessionOpen,  // NEW
  setShowPaywall: (show: boolean) => setShowPaywall(show),
  setDeepLinkParams: (params: Record<string, string>) => setDeepLinkParams(params),
});
```

---

### Phase 2: Delete CollaborationModule

**Goal:** Remove CollaborationModule and all paths to it.

#### 8.2.1 Remove from MessageInterface

**File:** `app-mobile/src/components/MessageInterface.tsx`

1. Delete import (line 25): `import CollaborationModule from "./CollaborationModule";`
2. Delete state (line 146): `const [showCollaboration, setShowCollaboration] = useState(false);`
3. Delete handler (line 461): `const handleSendCollabInvite = () => { ... }`
4. Delete "Send Collaboration Invite" menu item (line 585)
5. Delete CollaborationModule render block (lines 1018-1025)

#### 8.2.2 Remove from index.tsx (AppStateManager)

**File:** `app-mobile/src/components/AppStateManager.tsx`

1. Delete state: `const [showCollaboration, setShowCollaboration] = useState(false);`
2. Delete state: `const [showCollabPreferences, setShowCollabPreferences] = useState(false);`
3. Remove from returned state object

**File:** `app-mobile/src/components/AppHandlers.tsx`

1. Delete `handleCollaborationOpen` handler

**File:** `app-mobile/app/index.tsx`

1. Remove any render of CollaborationModule at app level
2. Remove `showCollaboration` from state destructuring
3. Remove `onOpenCollaboration` prop from HomePage

#### 8.2.3 Delete CollaborationModule files

Delete these files entirely:
- `app-mobile/src/components/CollaborationModule.tsx`
- `app-mobile/src/components/collaboration/SessionsTab.tsx`
- `app-mobile/src/components/collaboration/InvitesTab.tsx`
- `app-mobile/src/components/CreateSessionModal.tsx` (if only used by CollaborationModule — verify first)

**Verify before deleting CreateSessionModal:**
```bash
grep -r "CreateSessionModal\|CreateSessionContent" app-mobile/src/ --include="*.tsx" --include="*.ts"
```
If only imported by CollaborationModule → delete. If imported elsewhere → keep.

---

### Phase 3: Delete BoardViewScreen Page

**Goal:** Remove BoardViewScreen and all page-level navigation to it.

#### 8.3.1 Remove from index.tsx

**File:** `app-mobile/app/index.tsx`

1. Delete import (line 39): `import { BoardViewScreen } from "../src/components/board/BoardViewScreen";`
2. Delete state: `boardViewSessionId` / `setBoardViewSessionId` (lines 161-162)
3. Delete the entire `case "board-view":` block (lines 1779-1860+)
4. Remove `setBoardViewSessionId` from all handler objects and deep link handler calls

#### 8.3.2 Remove board navigation from other components

**Search and remove** any `onNavigateToBoard` callbacks that set `board-view` page:
```bash
grep -rn "onNavigateToBoard\|board-view\|setBoardViewSessionId" app-mobile/src/ --include="*.tsx" --include="*.ts"
```

These are likely in:
- `ConnectionsPage.tsx` — remove board navigation callback
- Any component that receives `onNavigateToBoard` prop

#### 8.3.3 Delete BoardViewScreen file

**File to delete:** `app-mobile/src/components/board/BoardViewScreen.tsx`

**Do NOT delete** the board sub-components — SessionViewModal uses them:
- `app-mobile/src/components/board/BoardTabs.tsx` ✅ KEEP
- `app-mobile/src/components/board/SwipeableSessionCards.tsx` ✅ KEEP
- `app-mobile/src/components/board/BoardDiscussionTab.tsx` ✅ KEEP
- `app-mobile/src/components/board/BoardSettingsDropdown.tsx` ✅ KEEP
- `app-mobile/src/components/board/ManageBoardModal.tsx` ✅ KEEP
- `app-mobile/src/components/board/InviteParticipantsModal.tsx` ✅ KEEP
- `app-mobile/src/components/board/CardDiscussionModal.tsx` ✅ KEEP
- `app-mobile/src/components/board/ParticipantAvatars.tsx` ✅ KEEP

#### 8.3.4 Clean up deep link service

**File:** `app-mobile/src/services/deepLinkService.ts`

- Remove `board-view` case from `executeDeepLink` (replaced in Phase 1)
- Remove `setBoardViewSessionId` from handler interface

---

### Phase 4: Clean Up Orphaned Code

#### 8.4.1 Remove orphaned state from AppStateManager

Grep for and remove any references to:
- `boardViewSessionId`
- `setBoardViewSessionId`
- `showCollaboration` (AppStateManager version)
- `showCollabPreferences`
- `handleCollaborationOpen`

#### 8.4.2 Remove orphaned props

- `HomePage.tsx`: Remove `onOpenCollaboration` prop if no longer used
- Any component that had `onNavigateToBoard` — remove the prop

#### 8.4.3 Verify no dead imports

```bash
npx tsc --noEmit 2>&1 | head -50
```

Fix any TypeScript errors from removed imports/props.

---

## 9. Implementation Order

**Step 1:** Add `openSessionId` prop to CollaborationSessions + useEffect handler
**Step 2:** Add `pendingSessionOpen` state to index.tsx, pass to CollaborationSessions
**Step 3:** Reroute notification handlers in index.tsx (board_message_, board_card_, collaboration_, session_)
**Step 4:** Reroute deep link service (`session` → `home` with `openSessionId`)
**Step 5:** Update `executeDeepLink` handler interface and calls
**Step 6:** Verify: tap a collaboration notification → HomePage → SessionViewModal opens ✅
**Step 7:** Remove CollaborationModule from MessageInterface (import, state, handler, menu item, render)
**Step 8:** Remove CollaborationModule from AppStateManager/AppHandlers/index.tsx
**Step 9:** Delete CollaborationModule.tsx, SessionsTab.tsx, InvitesTab.tsx
**Step 10:** Delete `case "board-view"` from index.tsx page renderer
**Step 11:** Delete BoardViewScreen.tsx
**Step 12:** Remove `boardViewSessionId` state and all references
**Step 13:** Remove `onNavigateToBoard` callbacks from ConnectionsPage and any other parents
**Step 14:** Clean up deep link service — remove `board-view` case
**Step 15:** Run TypeScript compiler — fix any errors from removed imports/props
**Step 16:** Full smoke test: create session, switch session, tap pill → view board, accept invite, notification → modal

## 10. Test Cases

| # | Test | Input | Expected | Status |
|---|------|-------|----------|--------|
| 1 | Tap active session pill | Press session pill on HomePage | SessionViewModal opens with board content | Already works |
| 2 | Tap invite pill | Press received-invite pill | Accept/decline modal opens | Already works |
| 3 | Tap "+" pill | Press create pill | Create session modal opens | Already works |
| 4 | Tap Solo pill | Press Solo pill | Switches to solo mode | Already works |
| 5 | Collaboration invite notification | Tap push notification for `collaboration_invite_received` | Navigate to HomePage, SessionViewModal opens for that session | NEW |
| 6 | Board message notification | Tap push notification for `board_message_new` | Navigate to HomePage, SessionViewModal opens for that session | NEW |
| 7 | Board card saved notification | Tap push notification for `board_card_saved` | Navigate to HomePage, SessionViewModal opens for that session | NEW |
| 8 | Deep link `mingla://session/{id}` | Open deep link | Navigate to HomePage, SessionViewModal opens for that session | NEW |
| 9 | Session not loaded yet | Notification arrives before sessions list loads | Modal opens once sessions finish loading (useEffect watches `sessions` array) | NEW |
| 10 | Invalid session ID in notification | Notification with deleted/invalid sessionId | Navigate to HomePage, no modal opens, no crash | NEW |
| 11 | Chat menu has no collab option | Open ⋯ menu in MessageInterface | "Send Collaboration Invite" is gone | NEW |
| 12 | No `board-view` page | Any navigation attempt to `board-view` | Never reaches that case — redirected to home | NEW |

## 11. Common Mistakes to Avoid

1. **Don't delete board sub-components:** `BoardTabs`, `SwipeableSessionCards`, `BoardDiscussionTab`, `BoardSettingsDropdown`, `ManageBoardModal`, `InviteParticipantsModal`, `CardDiscussionModal` are all used by SessionViewModal. Only delete `BoardViewScreen.tsx` itself.

2. **Don't forget both render locations:** CollaborationSessions is rendered in TWO places in index.tsx (lines ~1670 and ~1920 — the home and likes page cases). Pass `openSessionId` to BOTH.

3. **Don't forget to clear the trigger:** `onOpenSessionHandled` must call `setPendingSessionOpen(null)`. Without this, switching tabs and coming back will re-open the modal.

4. **Handle session not yet loaded:** When a notification arrives, the sessions list might still be loading. The useEffect in CollaborationSessions should watch the `sessions` array — when the matching session appears, open it. Don't silently swallow the trigger if the session isn't found on first render.

5. **Don't break the `home` deep link case:** The deep link service already has a `home` case. Make sure adding `openSessionId` param handling doesn't break plain `mingla://home` links that have no session param.

6. **Verify CreateSessionModal usage before deleting:** It may be imported by CollaborationSessions' create flow too. Grep first.

## 12. Files Touched Summary

### Modified
| File | Change |
|------|--------|
| `app-mobile/src/components/CollaborationSessions.tsx` | Add `openSessionId` prop + useEffect |
| `app-mobile/app/index.tsx` | Add `pendingSessionOpen` state, reroute notifications, remove BoardViewScreen/CollaborationModule rendering, remove `boardViewSessionId` |
| `app-mobile/src/services/deepLinkService.ts` | Reroute `session` deep link to `home` with `openSessionId` |
| `app-mobile/src/components/MessageInterface.tsx` | Remove CollaborationModule import/state/render/menu item |
| `app-mobile/src/components/AppStateManager.tsx` | Remove `showCollaboration` state |
| `app-mobile/src/components/AppHandlers.tsx` | Remove `handleCollaborationOpen` |
| `app-mobile/src/components/HomePage.tsx` | Remove `onOpenCollaboration` prop |

### Deleted
| File | Reason |
|------|--------|
| `app-mobile/src/components/CollaborationModule.tsx` | Redundant — replaced by CollaborationSessions + SessionViewModal |
| `app-mobile/src/components/collaboration/SessionsTab.tsx` | Only used by CollaborationModule |
| `app-mobile/src/components/collaboration/InvitesTab.tsx` | Only used by CollaborationModule |
| `app-mobile/src/components/board/BoardViewScreen.tsx` | Redundant — replaced by SessionViewModal |
| `app-mobile/src/components/CreateSessionModal.tsx` | Only if exclusively used by CollaborationModule (verify first) |

### Untouched (confirmed safe)
| File | Why |
|------|-----|
| `SessionViewModal.tsx` | Already works — no changes needed |
| All `board/` sub-components | Used by SessionViewModal — keep as-is |
| Board hooks (`useBoardSession`, `useSessionVoting`, etc.) | Used by SessionViewModal |
| Board services (`BoardCache`, `BoardMessageService`, etc.) | Used by SessionViewModal |

## 13. Handoff to Implementor

Implementor: this spec is a **deletion and rewiring job**, not a feature build. The key insight is that **SessionViewModal already exists and already contains the full board experience as a modal.** You are not building anything new — you are:

1. Adding one prop + one useEffect to CollaborationSessions (§8.1.1)
2. Adding one state variable to index.tsx and passing it down (§8.1.2)
3. Changing 3 notification routing blocks from `board-view` → `home` + `setPendingSessionOpen` (§8.1.3-8.1.4)
4. Deleting CollaborationModule and all paths to it (§8.2)
5. Deleting BoardViewScreen page and all paths to it (§8.3)
6. Cleaning up orphaned state/props (§8.4)

Execute in order from §9. Verify TypeScript compiles after each phase. Do not skip, reorder, or expand scope. Produce IMPLEMENTATION_REPORT.md referencing each section, hand to tester.
