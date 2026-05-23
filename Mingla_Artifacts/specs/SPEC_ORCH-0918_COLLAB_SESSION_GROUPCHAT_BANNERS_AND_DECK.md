# SPEC — ORCH-0918 [Collab session group chat: schedule banner + liked-cards banner + in-chat swipeable deck + in-deck preferences access]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Date:** 2026-05-22
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Dispatch:** orchestrator "take over" 2026-05-22 (adopts defaults Q1–Q4 + O-2 from investigation §9 DISC-0918-2 + F-10b)
**Severity:** S2-medium
**Classification:** `missing-feature` + `ux`
**Affected Surfaces:** Consumer iOS + Consumer Android only
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## 0. Phase 0 Ingest Log (this turn)

Files re-confirmed against investigation findings:
- `app-mobile/src/components/SwipeableCards.tsx:179-205` — `SwipeableCardsProps` interface. Critical: it does NOT take `sessionId` directly; `resolvedSessionId` is derived from `boardsSessions` + `currentMode`. `onOpenCollabPreferences?: () => void` is the existing collab-prefs hook — this is the entry point for F-10b.
- `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx:141-147` — existing invalidation set. Rework preserves `['scheduledCards', sessionId]` and deletes the obsolete `['sessionLikedCards', sessionId]` key.
- `app-mobile/src/contexts/RecommendationsContext.tsx:1347, 1602-1603, 1652` — additional invalidation sites for `['deck-cards']` and `['session-deck']` keys.
- `app-mobile/src/components/SessionViewModal.tsx:787-797` — source-of-truth Cards-tab mount pattern for `<SwipeableSessionCards>`.

**Material consequence:** The in-chat deck sheet cannot simply pass `sessionId` to `SwipeableCards`; the implementor must either (a) reuse the same `boardsSessions`/`currentMode` props the dedicated screen passes, or (b) extend `SwipeableCardsProps` with an optional `sessionIdOverride?: string` for sheet-embedded mode. The SPEC adopts (b) as the additive, lower-risk path — see §3.3.

---

## 1. Scope

### In scope (15 numbered items)

1. NEW discriminator `isCollabSessionGroupChat` in `MessageInterface.tsx`.
2. NEW component `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` (3 banners + 3 sheets).
3. NEW hook `app-mobile/src/hooks/useSessionScheduledCards.ts` (locked + scheduled reader).
4. NO `useSessionLikedCards` hook. Rework deletes the previous right-swipe aggregation path entirely.
5. NEW Zustand store `app-mobile/src/store/sessionDeckMountStore.ts` (single-mount mutex).
6. NEW `<ScheduleSheet>` sub-component (vertical list of locked-in cards in scheduled order).
7. NEW `<SavedToSessionCardsSheet>` sub-component that Modal-wraps `<SwipeableSessionCards>` for saved session cards.
8. NEW `<InChatDeckSheet>` sub-component (full-screen `Modal` hosting `SwipeableCards` + prefs header button + `<PreferencesSheet>` as sub-sheet inside parent per F-10b).
9. Additive `SwipeableCardsProps.sessionIdOverride?: string` for sheet-embedded mode (no behavior change when absent).
10. Invalidation wiring: preserve `['scheduledCards', sessionId]` and the existing saved-card keys; delete `['sessionLikedCards', sessionId]` from lock/schedule and swipe-write paths.
11. Realtime refresh uses the existing `board_session` channel callbacks for `board_saved_cards`/`board_votes` changes; no new channel, RPC, RLS policy, migration, or Supabase push.
12. Implementor happy-path regression tests (immutable per ORCH-0840).
13. Tester adversarial regression tests (different angles per ORCH-0840).
14. Strict-grep gate `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs`.
15. CI append-only regression script `app-mobile/scripts/ci/orch-0918-regression-check.mjs`.

### Non-goals

- NOT touching `BoardDiscussionTab.tsx` (legacy in-board chat tab — separate surface; DISC-0918-1 follow-up if Seth wants modernization).
- NOT touching `SwipeableCards.tsx` internals beyond the additive `sessionIdOverride` prop — no refactor.
- NOT touching `PreferencesSheet.tsx` internals — used as-is.
- NOT touching `SessionViewModal.tsx` dedicated session screen.
- NOT touching trip/event broadcast banner code path.
- NOT regressing ORCH-0909 [collab positional shared deck] — verified by hard-guard test (T-A05 below).
- NOT changing V_n cutover protocol (CR-3) — preserved by single-mount mutex.
- NOT introducing TopSheet consumers — all 3 sheets use standard `Modal`.
- NOT adding new edge functions or new DB tables — read-only on existing schema (`board_saved_cards`, `calendar_entries`, `board_user_swipe_states`, `conversations`).
- NOT adding new migrations.

### Assumptions

- `board_user_swipe_states` is the live swipe-state table; ORCH-0918 rework does not read it for the saved-to-session sheet.
- `calendar_entries.scheduled_at` and `calendar_entries.board_card_id` are the live schedule-join columns per ORCH-0908.
- `conversations.linked_entity_type` admits `'session'` value (verified at `ConnectionsPage.tsx:236` + `MessageInterface.tsx:110` TS types).
- RLS on `board_saved_cards` already permits participant-scoped cross-user reads via `bsc_select = (saved_by = auth.uid()) OR is_session_participant(session_id, auth.uid())`; the saved-to-session sheet inherits this protection automatically.
- `PreferencesSheet` is mountable from any context (verified — single primitive used by solo + collab).

---

## 2. Cross-Surface Impact (Phase 2.5 — mandatory)

| Surface | Touched? | What changes for the user | Files touched | Parity |
|---|---|---|---|---|
| **Consumer iOS** | YES | When opening a collab session group chat from the Friends tab, three banners render at top: (1) "Locked-in plans (N)" → opens a sheet listing scheduled cards in chronological order, (2) "Saved to session (N cards saved)" → opens a Modal-wrapped remount of the dedicated Cards-tab `<SwipeableSessionCards>` primitive, (3) "Swipe cards together →" → opens a full-screen sheet with the same swipe deck as the dedicated session screen + a Preferences icon in the header that opens the existing session-prefs sub-sheet inline. | `CollabSessionChatBanners.tsx` + `useSessionScheduledCards.ts` + 1 NEW store + 1 MODIFIED `MessageInterface.tsx` + targeted invalidation cleanup + 1 MODIFIED `SwipeableCards.tsx` (additive prop) | Automatic (shared RN/JS) |
| **Consumer Android** | YES | Identical to iOS. | Same set | Automatic (shared RN/JS); separate SC for sheet open + horizontal scroll on emulator |
| Buyer-anon-web | NO | No consumer chat surface on buyer-anon-web | none | n/a |
| Business iOS | NO | `mingla-business/` does NOT render collab session chats (collab is consumer-only) | none | n/a |
| Business Android | NO | Same | none | n/a |
| Admin Web | NO | No consumer chat or collab session surface on admin | none | n/a |
| Business Web preview | NO | Same as business iOS | none | n/a |

Parity is automatic across iOS + Android (shared RN/JS); SPEC lists separate SC only for items where rendered output is platform-dependent (sheet open animation, horizontal scroll inertia, keyboard interaction).

---

## 3. Per-Layer Specification

### 3.1 Type layer

#### 3.1.1 NEW `SessionScheduledCardRow` type

File: `app-mobile/src/hooks/useSessionScheduledCards.ts` (exported).

```ts
export interface SessionScheduledCardRow {
  savedCardId: string;                       // board_saved_cards.id
  cardData: Record<string, unknown> | null;  // board_saved_cards.card_data
  scheduledAt: string;                       // calendar_entries.scheduled_at (ISO)
  lockedAt: string;                          // board_saved_cards.locked_at
  lockedBy: string | null;                   // board_saved_cards.saved_by (the participant who pressed Lock-in)
}
```

#### 3.1.2 Additive prop on `SwipeableCardsProps`

File: `app-mobile/src/components/SwipeableCards.tsx:179-205`.

ADD one optional prop (no other change):

```ts
  /**
   * ORCH-0918: when set, overrides the `resolvedSessionId` derivation so this
   * SwipeableCards instance scopes to the named session regardless of
   * boardsSessions/currentMode state. Used by the in-chat deck sheet
   * (CollabSessionChatBanners) so participants can swipe from inside the
   * group chat without leaving it. Single-mount mutex enforced via
   * useSessionDeckMountStore — see ORCH-0918 SPEC §3.4.
   */
  sessionIdOverride?: string;
```

In the body of `SwipeableCards`, the existing `resolvedSessionId` derivation must prefer `props.sessionIdOverride` when defined:

```ts
// pseudocode — implementor picks the exact insertion point
const resolvedSessionId = props.sessionIdOverride ?? <existing derivation>;
```

No other behavior change. When `sessionIdOverride` is absent, `SwipeableCards` behaves exactly as today.

### 3.2 Hook layer

#### 3.2.1 NEW `useSessionScheduledCards`

File: `app-mobile/src/hooks/useSessionScheduledCards.ts`

Query key: `['scheduledCards', sessionId]`

Query: SELECT joining `board_saved_cards` ↔ `calendar_entries` using the live `calendar_entries.board_card_id` column:

```sql
SELECT bsc.id          AS saved_card_id,
       bsc.card_data,
       bsc.saved_by    AS locked_by,
       bsc.locked_at,
       ce.scheduled_at
  FROM public.board_saved_cards bsc
  JOIN public.calendar_entries ce ON ce.board_card_id = bsc.id
 WHERE bsc.session_id = :sessionId
   AND bsc.is_locked = true
   AND ce.scheduled_at IS NOT NULL
 ORDER BY ce.scheduled_at ASC;
```

Implementation may use two reads if the PostgREST FK relationship name is not ergonomic: locked `board_saved_cards` rows by `session_id` + `is_locked=true`, then `calendar_entries` filtered by `board_card_id IN (...)` and ordered by `scheduled_at ASC`.

Hook contract:
- `enabled: !!sessionId`
- `staleTime: 30_000` (30s — matches other session-state hooks; realtime invalidates earlier)
- Returns `{ rows: SessionScheduledCardRow[], isLoading: boolean, isError: boolean, refetch }`.
- Honest empty state: returns `rows: []` when no locked+scheduled cards exist. NO fabrication (Constitution #9).

#### 3.2.2-rev Saved-to-session sheet data source

The likes/saved-to-session sheet reuses `<SwipeableSessionCards>` per the `SessionViewModal.tsx:787-797` mount pattern. The data source is `board_saved_cards` via the same Cards-tab filter used by `SessionViewModal`: `session_id = :sessionId`, `is_locked = false`, ordered by `saved_at DESC`, page size 20. Locked cards live in the schedule sheet and must not be duplicated in this sheet.

No `useSessionLikedCards` hook exists in the rework. The previous direct `board_user_swipe_states` aggregation path is deleted because production RLS only exposes the viewer's own swipe rows. Cross-participant visibility comes from existing quorum promotion into `board_saved_cards` plus production RLS `bsc_select = (saved_by = auth.uid()) OR is_session_participant(session_id, auth.uid())`.

Query-key contract:
- The chat sheet uses `['savedCards', sessionId]` so the existing saved-card invalidation set can refresh it.
- The chat sheet listens through the existing `board_session` realtime channel callbacks (`onCardSaved`, debounced `onMatchPromoted`, and `onCardLocked`) and invalidates `['savedCards', sessionId]`. This reuses the existing channel; it does not add a new table subscription.
- No new RPC, RLS amendment, migration, edge function, or `supabase db push`.

#### 3.2.3 Cache invalidation augmentation

Keep only the live keys needed by the reworked surfaces at `LockedCardSchedulingSheet.tsx:141-147`:

```ts
queryClient.invalidateQueries({ queryKey: ["savedCards", sessionId] });
queryClient.invalidateQueries({ queryKey: ["savedSessionCards", sessionId] });
queryClient.invalidateQueries({ queryKey: ["scheduledCards", sessionId] });
```

Delete every `['sessionLikedCards', sessionId]` invalidation from lock/schedule and swipe-write paths. The saved-to-session sheet is refreshed by `board_saved_cards`/`board_votes` events on the existing `board_session` realtime channel and by the existing saved-card query keys.

### 3.3 Component layer

#### 3.3.1 MODIFY `MessageInterface.tsx`

Around line 231 (existing `isTripEventGroupChat` definition), add:

```ts
const isCollabSessionGroupChat =
  isGroupChat &&
  friend.linkedEntityType === 'session' &&
  !!friend.sessionId;
```

Around line 1284-1300 (the trip/event banner-stack region), add a SIBLING conditional block (parallel to the existing `isTripEventGroupChat` block — NOT inside it):

```tsx
{isCollabSessionGroupChat ? (
  <CollabSessionChatBanners
    sessionId={friend.sessionId!}
    currentUserId={currentUserId}
  />
) : null}
```

Import: `import { CollabSessionChatBanners } from "./chat/CollabSessionChatBanners";` at the top.

NO other change to `MessageInterface.tsx`.

#### 3.3.2 NEW `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`

```tsx
interface Props {
  sessionId: string;
  currentUserId: string | undefined;
}
```

Renders 3 banners stacked vertically + owns 3 `Modal`-based sheets. Banner stack uses `View` with `gap: 4` and inherits the existing `styles.eventChannelHeaderStack` visual rhythm from `MessageInterface.tsx` (mirror the precise padding + bottomBorder).

**Banner #1 — Schedule:**
- Visual: amber background `#FEF3C7` (mirror `LockedPlanBanner.tsx:108`), 48pt min height, lock-closed icon + "Locked-in plans" title + "(N scheduled)" subtitle + chevron-forward.
- Hidden when `rows.length === 0` (Constitution #9 — no fabricated "(0 scheduled)" banner). Renders ONLY when `useSessionScheduledCards(sessionId).rows.length > 0`.
- Tap → `setShowScheduleSheet(true)`.
- A11y label: `Locked-in plans: N scheduled. Tap to view.`

**Banner #2 — Saved to session:**
- Visual: rose/pink-tinted background (recommend `#FCE7F3`), 48pt min height, heart icon + "Saved to session" title + "(N cards saved)" subtitle + chevron-forward.
- Hidden when `savedCardsForLikesSheet.length === 0`.
- Tap → `setShowLikedSheet(true)`.
- A11y label: `Saved to session: N cards saved. Tap to view.`

**Banner #3 — Deck launcher:**
- Visual: orange background `#FED7AA`, 56pt min height (distinguished from info banners as primary action), cards-stack icon + "Swipe cards together" title + "Tap to open the deck →" subtitle + larger chevron.
- Always renders (no row-count gate — the deck is always swipeable as long as the session has ≥2 accepted participants per CR-8).
- Tap → check `useSessionDeckMountStore.acquire(sessionId)` (§3.4). If acquired: `setShowDeckSheet(true)`. If NOT acquired (deck mounted elsewhere): show toast "Deck open elsewhere — close it to swipe from chat."
- A11y label: `Open swipeable deck for this session.`

All three banners satisfy I-38 (touch target ≥44pt — min 48pt enforced).

**Sheets:**

**`<ScheduleSheet visible onClose sessionId currentUserId />`** — standard `Modal transparent animationType="slide"`. Renders a vertical `FlatList` of `SessionScheduledCardRow` rows; each row shows the card's title + formatted scheduled date (using `LockedPlanBanner.formatScheduledAt` pattern) + "Locked in by <name>" + chevron. Tap a row → opens existing `ExpandedCardModal` with `card={row.cardData}`. Empty state: never reached because the banner hides at row-count 0. Loading state: `ActivityIndicator`. Error state: "Couldn't load locked-in plans. Tap to retry."

**`<SavedToSessionCardsSheet visible onClose sessionId currentUserId />`** — standard `Modal animationType="slide" presentationStyle="fullScreen"`. Sheet body is a remount of `<SwipeableSessionCards>` with the same Cards-tab props from `SessionViewModal.tsx:787-797`: `cards={savedCardsForLikesSheet}`, `sessionId`, `userId={currentUserId}`, `participantCount={participants.length}`, `onViewDetails={openExpandedCardModal}`, `accountPreferences`, and `isAdmin` (plus `loading={savedCardsLoading}`). Voting, RSVP, liker-names row, and the admin-gated "Lock it in" CTA are inherited unchanged from `<SwipeableSessionCards>`.

**`<InChatDeckSheet visible onClose sessionId currentUserId />`** — standard `Modal animationType="slide" presentationStyle="fullScreen"`. Layout:
- Top bar: chevron-down close button (left) + "Swipe cards" title (center) + Preferences icon button (right; 44pt touch target; opens `PreferencesSheet` as sub-sheet rendered INSIDE this Modal's children per `feedback_rn_sub_sheet_must_render_inside_parent.md`).
- Body: `<SwipeableCards sessionIdOverride={sessionId} … />` rendered in **strict session scope** (see §3.3.3 below) — implementor passes the same `userPreferences`, `accountPreferences`, `boardsSessions`, `currentMode`, `onCardLike`, `onAddToCalendar`, `onShareCard`, `onPurchaseComplete` props that `HomePage`/`AppHandlers` pass when mounting the dedicated session deck for THIS specific session id. The `onOpenCollabPreferences` callback is OVERRIDDEN to `() => setShowPrefsSheet(true)` so prefs open INSIDE this sheet, not at app root.

#### 3.3.3 Strict session-scope contract for the in-chat deck mount (added 2026-05-22 per operator clarification)

The in-chat deck sheet MUST render the deck for the session the chat belongs to — **never** the general/solo deck, **never** another session's deck, and **never** a mongrel mount that scopes writes to session A but reads prefs from solo. Specifically:

1. **`sessionIdOverride` is REQUIRED, not optional, on this mount.** `<InChatDeckSheet>` MUST pass `sessionIdOverride={sessionId}` where `sessionId` is the prop the sheet was opened with. The implementor MAY NOT omit it under any branch.

2. **`currentMode` MUST be `'collab'` for this mount.** The in-chat deck sheet is collab-only by definition (the chat itself is a collab session group chat — verified by the F-1 discriminator before the banners ever render). If the surrounding app state has `currentMode='solo'`, the sheet OVERRIDES it locally and passes `currentMode='collab'` to `SwipeableCards`.

3. **`userPreferences` MUST be the session's preferences, not the solo user's preferences.** The implementor resolves session prefs via the existing `useBoardSession(sessionId)` hook (or whichever hook the dedicated session screen uses today for the same purpose — confirm by reading the dedicated mount in `SessionViewModal.tsx` and mirroring the prop wiring exactly). Solo prefs MUST NOT leak in.

4. **All callbacks (`onCardLike`, `onAddToCalendar`, `onShareCard`, `onPurchaseComplete`) MUST be the session-bound versions.** Mirror the dedicated session screen's callback wiring 1-for-1. The implementor finds the dedicated mount site, copies the callback bindings, and reuses them. Solo callbacks (which write to the user's personal saves, not session swipes) MUST NOT be wired here.

5. **When the chat switches to a different collab session, the deck for the NEW session renders, not the old one.** This is guaranteed automatically by the unmount/re-mount cycle: `MessageInterface` unmounts when the user backs out of chat A and re-mounts with `friend.sessionId = 'B'` when chat B opens. The Zustand mutex releases on unmount, so the next mount acquires cleanly. The implementor MUST verify there is no module-scoped state in `SwipeableCards` or the new components that survives unmount and could leak session A's deck into session B's render. If any such state is found, it's reset on mount via a `key={sessionId}` prop on the relevant subtree.

6. **The in-chat deck mount does NOT touch the home page's deck.** The home page (or wherever the general/solo/collab deck lives today) keeps its own mount, its own preferences, its own callbacks. The in-chat sheet is a SECOND, ISOLATED mount per the mutex contract — only ONE deck is alive at a time per session, but the home page and chat sheet target different mount points for the same underlying session state.

7. **Rule 7 (added 2026-05-22 after operator-discovered context-leak P1):** The `<SwipeableCards>` mount inside `<InChatDeckSheet>` MUST be wrapped in a nested `<RecommendationsProvider currentMode={sessionId} key={sessionId}>` so it consumes a session-scoped RecommendationsContext value, NOT the ambient app-root provider's value. The `key={sessionId}` guarantees clean remount on chat-switch. Verified by T-11 (positive — session deck renders despite ambient solo provider) + T-A16 (cross-chat isolation — sessions A and B never cross-leak). Rationale: SwipeableCards reads recommendations, userLocation, and ~24 other deck-state fields from `useRecommendations()` ambient context per `app-mobile/src/components/SwipeableCards.tsx:437-473`. Passing the right PROPS alone is insufficient; the ambient context must also be scoped to the session.

This is the foundation for the operator's broader direction (mid-2026-05-22): retiring the home-page collab session pills + top bar and centralizing collab session interaction in the Friends-tab chat surface. The strict scoping here ensures the in-chat surface is a true equal of the dedicated screen — same deck, same prefs, same swipes — so the home-page surface can be removed in a future ORCH without any user-visible regression.
- Sub-sheet (rendered INSIDE Modal children, not as Fragment sibling): `<PreferencesSheet visible={showPrefsSheet} onClose={() => setShowPrefsSheet(false)} sessionId={sessionId} mode="collab" … />` — implementor passes the same props existing PreferencesSheet consumers use for collab mode.
- On unmount (sheet closes): `useSessionDeckMountStore.release(sessionId)`.

### 3.4 Client-state layer (Zustand)

#### 3.4.1 NEW `app-mobile/src/store/sessionDeckMountStore.ts`

```ts
import { create } from 'zustand';

interface DeckMountState {
  mountedSessionId: string | null;
  mountedBy: 'in-chat-sheet' | 'dedicated-screen' | null;
  acquire: (sessionId: string, owner: 'in-chat-sheet' | 'dedicated-screen') => boolean;
  release: (sessionId: string) => void;
}

export const useSessionDeckMountStore = create<DeckMountState>((set, get) => ({
  mountedSessionId: null,
  mountedBy: null,
  acquire: (sessionId, owner) => {
    const current = get();
    if (current.mountedSessionId === null) {
      set({ mountedSessionId: sessionId, mountedBy: owner });
      return true;
    }
    // Same session + same owner re-acquiring is idempotent
    if (current.mountedSessionId === sessionId && current.mountedBy === owner) {
      return true;
    }
    return false;
  },
  release: (sessionId) => {
    const current = get();
    if (current.mountedSessionId === sessionId) {
      set({ mountedSessionId: null, mountedBy: null });
    }
  },
}));
```

**Integration:**
- `InChatDeckSheet` calls `acquire(sessionId, 'in-chat-sheet')` in its open effect; releases on close.
- The DEDICATED `SessionViewModal.tsx` (or wherever `SwipeableCards` is mounted for the standalone session screen) MUST also acquire/release. Implementor finds the mount site and adds the lock calls.
- If `acquire` returns false: in `CollabSessionChatBanners`, surface the "Deck open elsewhere" toast. In the dedicated screen, the analogous handling already exists (the dedicated screen is the canonical entry point; in practice the dedicated screen takes precedence when both are reachable).

This store holds **client state only** (mount-coordination flag) — fully compliant with the Zustand-no-server-snapshots invariant from memory.

### 3.5 Realtime layer

Already covered in §3.2.2-rev — the saved-to-session sheet reuses the existing `board_session` realtime channel callbacks for `board_saved_cards` INSERT, `board_votes` INSERT, and `board_saved_cards` lock UPDATE. `useSessionScheduledCards` does NOT need its own subscription because the `LockedCardSchedulingSheet` invalidation set and existing lock realtime callbacks cover cross-participant lock updates.

### 3.6 Database layer

NO migrations. NO new tables, columns, constraints, or RLS policies. The feature reads from existing schema:
- `board_saved_cards` (existing — `is_locked`, `locked_at`, `saved_by`, `card_data`, `session_id`).
- `calendar_entries` (existing — `scheduled_at`, `board_card_id`).
- `board_user_swipe_states` (existing — `swipe_state='swiped_right'` rows already written by the existing swipe RPC; not read by the saved-to-session sheet).
- `conversations` (existing — `linked_entity_type='session'` + `session_id`).
- `profiles` (existing — `display_name`, `avatar_url`).

Existing RLS on `board_saved_cards` permits participant-scoped cross-user reads via `bsc_select`; existing RLS on `calendar_entries` carries for the schedule sheet. No RLS or DB object changes are in scope.

### 3.7 Edge function layer

NO new edge functions. NO modifications to existing edge functions.

---

## 4. Success Criteria

| ID | Criterion | Verifies |
|---|---|---|
| **SC-01** | `MessageInterface` mounted with `friend.linkedEntityType === 'session'` + `friend.sessionId = 's1'` renders `<CollabSessionChatBanners sessionId="s1" />` exactly once at the banner-stack region. | F-1 discriminator |
| **SC-02** | `MessageInterface` mounted with `friend.linkedEntityType === 'trip'` does NOT render `<CollabSessionChatBanners>`. | Negative parity |
| **SC-03** | `MessageInterface` mounted with `friend.linkedEntityType === 'event'` does NOT render `<CollabSessionChatBanners>`. | Negative parity |
| **SC-04** | `MessageInterface` mounted with `friend.linkedEntityType === 'direct'` (DM) does NOT render `<CollabSessionChatBanners>`. | Negative parity |
| **SC-05** | `useSessionScheduledCards('s1')` returns `rows: []` when no `board_saved_cards` row in session s1 has `is_locked=true AND calendar_entries.scheduled_at IS NOT NULL`. | Honest empty |
| **SC-06** | `useSessionScheduledCards('s1')` with 3 locked+scheduled cards returns 3 rows ordered by `scheduledAt ASC`. | Hook contract |
| **SC-07** | Saved-to-session sheet renders one row per `board_saved_cards` row in the session matching the `SessionViewModal` Cards-tab filter, with voting + RSVP + liker-names + admin-gated Lock-in CTA inherited from `<SwipeableSessionCards>` unchanged. | Saved-card parity |
| **SC-08** | Banner #2 hides when there are zero quorum-promoted saved cards matching the Cards-tab filter. | Honest empty |
| **SC-09** | When another participant's right-swipe creates a cross-participant quorum hit, the saved card appears in the saved-to-session sheet within ~2 seconds via the existing `board_session` realtime channel. | Realtime |
| **SC-10** | Banner #1 (Schedule) is hidden when `useSessionScheduledCards.rows.length === 0`; rendered when `.length > 0`. | Honest gating |
| **SC-11** | Banner #2 (Saved to session) is hidden when `savedCardsForLikesSheet.length === 0`; rendered when `.length > 0`. | Honest gating |
| **SC-12** | Banner #3 (Deck launcher) renders unconditionally inside `CollabSessionChatBanners`. | Always-available action |
| **SC-13** | Tapping Banner #1 opens `<ScheduleSheet>`; the sheet renders all locked+scheduled cards in chronological order with title + formatted date + locker name. | Schedule sheet |
| **SC-14** | Tapping Banner #2 opens `<SavedToSessionCardsSheet>`; the sheet body mounts `<SwipeableSessionCards>` with `cards`, `sessionId`, `userId`, `participantCount`, `onViewDetails`, `accountPreferences`, `isAdmin`, and loading props. | Saved-to-session sheet |
| **SC-15** | Tapping Banner #3 opens `<InChatDeckSheet>` AND calls `useSessionDeckMountStore.acquire(sessionId, 'in-chat-sheet')`. | Deck sheet open + mutex acquire |
| **SC-16** | Inside `<InChatDeckSheet>`, swiping a card LEFT calls the same swipe-record path as the dedicated session screen (writes `board_user_swipe_states` row with `swipe_state='swiped_left'`). | State coupling |
| **SC-17** | Inside `<InChatDeckSheet>`, swiping a card RIGHT writes `board_user_swipe_states` row with `swipe_state='swiped_right'`; at quorum the existing match-quorum trigger promotes the card to `board_saved_cards`. | State coupling — quorum preserved |
| **SC-18** | Closing `<InChatDeckSheet>` calls `useSessionDeckMountStore.release(sessionId)`. | Mutex release |
| **SC-19** | If `useSessionDeckMountStore.mountedSessionId` already equals a sessionId (set by dedicated screen), tapping Banner #3 surfaces a toast "Deck open elsewhere — close it to swipe from chat." and does NOT open the sheet. | Mutex enforcement |
| **SC-20** | Inside `<InChatDeckSheet>`, tapping the Preferences icon (top-right header) opens `<PreferencesSheet>` as a sub-sheet rendered INSIDE the deck sheet's Modal children (NOT as a Fragment sibling at app root). | F-10b — sub-sheet inside parent |
| **SC-21** | Changing preferences from the in-deck `<PreferencesSheet>` writes through the existing `PreferencesService` paths; the server mints V_{n+1} and the client buffers per CR-3. The user continues swiping the V_n deck in the same sheet without cards swapping underfoot. | F-10b + CR-3 |
| **SC-22** | When V_n is exhausted (user swipes last V_n card) inside `<InChatDeckSheet>`, the next swipe shows V_{n+1} card #1. | CR-3 cutover |
| **SC-23** | `<SwipeableCards sessionIdOverride="s1">` derives `resolvedSessionId === 's1'` regardless of `boardsSessions`/`currentMode` state. | Additive prop correctness |
| **SC-24** | `<SwipeableCards>` mounted WITHOUT `sessionIdOverride` derives `resolvedSessionId` from the existing path unchanged. | No regression on existing mount |
| **SC-23a** | `<InChatDeckSheet>` for session `s1` ALWAYS passes `sessionIdOverride='s1'` + `currentMode='collab'` + session-bound `userPreferences` (resolved via `useBoardSession('s1')`) + session-bound callbacks (mirroring the dedicated session screen's callback wiring 1-for-1). NEVER passes solo prefs or solo callbacks. | F-1/§3.3.3 strict session scope |
| **SC-23b** | Opening chat for session `s1`, then backing out and opening chat for session `s2`, then opening the deck sheet from chat `s2` renders the deck for `s2` — NOT `s1`'s deck, NOT a stale `s1` cache, NOT the general/solo deck. Verified by asserting `resolvedSessionId === 's2'` and the rendered card list matches `useDeckCards('s2')`, NOT `useDeckCards('s1')` or solo. | §3.3.3 rule 5 — chat-switch per-session deck rendering |
| **SC-23c** | Opening the in-chat deck sheet does NOT mutate, hide, or affect the home-page deck mount. The home-page deck (if mounted elsewhere in the navigation stack) keeps its own state, prefs, and callbacks. Verified by mounting both and asserting they share no React state, no Zustand selectors beyond the mount-mutex flag, and no React Query cache key collisions outside the per-session keys both legitimately read. | §3.3.3 rule 6 — isolated mount |
| **SC-23d** | The `<SwipeableCards>` mount inside `<InChatDeckSheet>` is a descendant of a `<RecommendationsProvider currentMode={sessionId}>` element distinct from the app-root provider; verified by JSX-tree assertion + T-11/T-A16 behavioral assertion. | §3.3.3 rule 7 — session-scoped context owner |
| **SC-25** | After a participant locks-in a card via the dedicated `LockedCardSchedulingSheet`, the in-chat `<ScheduleSheet>` reflects the new row within 2 seconds (invalidation set augmentation). | Invalidation wiring |
| **SC-26** | Strict-grep gate `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` fails CI if `<CollabSessionChatBanners>` is mounted under any predicate other than the exact `isGroupChat && friend.linkedEntityType === 'session' && !!friend.sessionId` shape. | Invariant lockdown |
| **SC-27-iOS** | On iOS Simulator, the saved-to-session sheet slide animation and inherited `<SwipeableSessionCards>` interactions render correctly. | Platform-dependent render |
| **SC-27-Android** | On Android Emulator, the saved-to-session sheet slide animation and inherited `<SwipeableSessionCards>` interactions render correctly. | Platform-dependent render |
| **SC-28** | Solo sessions do NOT render any of the new banners (verified by the fact that solo sessions don't create a group conversation per F-9). | Solo non-regression |
| **SC-29** | Trip broadcast banner (`TripCountdownBanner`) renders unchanged when `friend.linkedEntityType === 'trip'`. | Trip-banner non-regression |
| **SC-30** | `BoardDiscussionTab.tsx` legacy in-board chat tab renders unchanged (zero diff in that file). | Legacy surface non-regression |

---

## 5. Invariants

### Preserved (must continue to hold)

| ID | How preserved |
|---|---|
| **CR-1..CR-9** (collab determinism contract) | In-chat deck consumes `SwipeableCards` as-is via additive prop; underlying state machine unchanged. |
| **CR-3 V_n cutover** | Pref change from in-deck `PreferencesSheet` flows through existing `PreferencesService` writers that already respect CR-3 buffering. Verified by SC-21 + SC-22. |
| **Constitution #1 (no dead taps)** | All 3 banners + all sheet interactions have onPress handlers with haptics. |
| **Constitution #2 (one owner per truth)** | React Query owns saved-card and scheduled-card server reads; the in-chat deck data is owned by the nested session-scoped `RecommendationsProvider` subtree, distinct from the app-root/home provider. No duplicate swipe aggregation state. Single-mount mutex prevents two `SwipeableCards` instances writing concurrently. |
| **Constitution #3 (no silent failures)** | Schedule hook exposes `isError`; saved-to-session behavior is inherited from `<SwipeableSessionCards>` and its existing voting/RSVP/lock flows. |
| **Constitution #4 (one query key per entity)** | `['scheduledCards', sessionId]` + `['savedCards', sessionId]` are the live query keys; obsolete `['sessionLikedCards', sessionId]` is deleted. |
| **Constitution #5 (server state server-side)** | Zustand store holds ONLY the mount-coordination client flag, NOT server data. |
| **Constitution #8 (subtract before adding)** | No layering on broken code; `BoardDiscussionTab` untouched (separate surface). |
| **Constitution #9 (no fabricated data)** | Banners #1 + #2 hide on empty (no "(0)" placeholders). Sheets render honest empty/error states. |
| **I-38 (touch target ≥44pt)** | All banners ≥48pt; deck-sheet Preferences icon button explicitly 44pt. |
| **I-39 (explicit accessibilityLabel on interactive Pressable)** | Every Pressable in the new components has `accessibilityLabel`. |
| **TopSheet consumer count = 2** | All 3 new sheets use standard `Modal`, NOT TopSheet. |
| **Sub-sheet inside parent** | In-deck PreferencesSheet renders INSIDE InChatDeckSheet's Modal children. |
| **Zustand-no-server-snapshots** | New store carries client flag only. |
| **ORCH-0898 SAME-THREAD-TWO-VIEWS** | In-chat surface is a second view onto the same `conversations` row; no new conversation primitive introduced. |

### NEW (DRAFT — flip ACTIVE on CLOSE)

| ID | Description | Enforcement |
|---|---|---|
| **I-PROPOSED-COLLAB-SESSION-CHAT-BANNERS-ONLY-ON-SESSION-CONV** | `<CollabSessionChatBanners>` mounts iff `friend.linkedEntityType === 'session' && !!friend.sessionId`. | Strict-grep gate `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` + unit test SC-01..SC-04. |
| **I-PROPOSED-IN-CHAT-DECK-SINGLE-MOUNT** | At most one `SwipeableCards` instance per `sessionId` at any time across the app. | Zustand mutex `useSessionDeckMountStore` + unit test on `acquire`/`release` contract + integration test SC-19. |
| **I-PROPOSED-IN-DECK-PREFS-SUB-SHEET-INSIDE-PARENT** | `PreferencesSheet` invoked from `InChatDeckSheet` MUST render inside the deck sheet's Modal children, not as a Fragment sibling. | Unit test asserting JSX structure: PreferencesSheet is a descendant of the InChatDeckSheet Modal element. |

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** (impl, happy) | Banner-stack rendering — collab session chat | `MessageInterface` mounted with `friend.linkedEntityType='session'`, `friend.sessionId='s1'`, `friend.isGroupChat=true` | `<CollabSessionChatBanners sessionId='s1' />` rendered exactly once | Component (RTL) |
| **T-02** (impl, happy) | Schedule hook | Seeded DB: 2 locked+scheduled cards in s1, 1 locked-not-scheduled, 1 not-locked | `useSessionScheduledCards('s1').rows.length === 2`, ordered by scheduledAt ASC | Hook (jest + supabase mock) |
| **T-03-rev** (impl, happy) | Saved-to-session banner count | Seeded/mocked `board_saved_cards`: 2 unlocked rows matching the Cards-tab filter | Banner subtitle reads `2 cards saved` and is sourced from `savedCardsForLikesSheet.length` | Component/query |
| **T-04** (impl, happy) | Deck embedding — sessionIdOverride | `<SwipeableCards sessionIdOverride='sX' boardsSessions={[]} currentMode='solo'>` | `resolvedSessionId === 'sX'` | Component |
| **T-05** (impl, happy) | Deck embedding — absent override | `<SwipeableCards boardsSessions={[{id:'sY'}]} currentMode='collab' sessionIdOverride={undefined}>` | `resolvedSessionId === 'sY'` (existing derivation unchanged) | Component |
| **T-06** (impl, happy) | Mutex acquire/release | Sequence: acquire('s1','in-chat-sheet') → release('s1') → acquire('s1','dedicated-screen') | All three return true; final mountedBy === 'dedicated-screen' | Zustand store |
| **T-07** (impl, happy) | Mutex conflict | Sequence: acquire('s1','in-chat-sheet') → acquire('s1','dedicated-screen') | First returns true, second returns false | Zustand store |
| **T-08** (impl, happy) | Banner #1 hidden on empty | Mount `<CollabSessionChatBanners>` with mocked hook returning `rows:[]` | Schedule banner element NOT in DOM | Component |
| **T-09-rev** (impl, happy) | Banner #2 hidden on empty | Mount with mocked saved-cards query returning `[]` | Saved-to-session banner element NOT in DOM | Component |
| **T-10** (impl, happy) | In-deck Preferences sub-sheet structure | Mount `<InChatDeckSheet visible>` then trigger prefs open | `<PreferencesSheet>` is a descendant of the InChatDeckSheet Modal element (not at app root) | Component (JSX tree assertion) |
| **T-11** (impl, happy) | In-chat deck consumes session-scoped recommendations, not home-page recommendations | Mount `<InChatDeckSheet visible sessionId='sA'>` inside an ambient app-root `<RecommendationsProvider currentMode='solo'>` with distinguishable solo and sA deck stubs | Rendered deck contains sA cards, not solo cards; count matches the sA stub. Test fails when the nested provider is removed. | Component/static + simulated behavior |
| **T-12** (impl, happy) | Saved-to-session sheet remount | Open `<SavedToSessionCardsSheet>` | `<SwipeableSessionCards>` receives the SessionViewModal prop set: `cards`, `sessionId`, `userId`, `participantCount`, `onViewDetails`, `accountPreferences`, `isAdmin` (and loading) | Component/static |
| **T-A01** (tester, adv) | Wrong linkedEntityType | Mount with `linkedEntityType='trip'` then `'event'` then `'direct'` then `null` | `<CollabSessionChatBanners>` NEVER rendered | Component |
| **T-A02** (tester, adv) | Missing sessionId despite linkedEntityType='session' | Mount with `linkedEntityType='session'` but `sessionId=undefined` | `<CollabSessionChatBanners>` NOT rendered (predicate guards on `!!friend.sessionId`) | Component |
| **T-A03** (tester, adv) | Saved-to-session RLS cross-session leak | User A in session s1, query saved cards for s2 | RLS denies or returns no rows; no cross-session saved cards appear | Hook/query + DB |
| **T-A04** (tester, adv) | V_n cutover with in-chat sheet open mid-swipe | Open in-chat deck, swipe 3 cards (V_n has 10), trigger pref change from a different participant, swipe 7 more cards | First 7 cards are remaining V_n; card 11 is V_{n+1} card #1; NO cards swap underfoot during V_n consumption | Integration (state machine) |
| **T-A05** (tester, adv) | ORCH-0909 positional shared deck non-regression | Run ORCH-0909 happy-path tests with `sessionIdOverride` set | All positional-shared-deck tests PASS unchanged | Cross-ORCH integration |
| **T-A06** (tester, adv) | Concurrent mount race | Race condition: two components call `acquire('s1', …)` in the same tick | Exactly one returns true (Zustand is synchronous; no race in practice) | Zustand store |
| **T-A07** (tester, adv) | Saved-to-session sheet with 0 saved cards | Banner #2 forced visible (override gate); sheet opened | `<SwipeableSessionCards>` receives `cards=[]` and no fabricated rows appear | Component |
| **T-A08** (tester, adv) | Schedule sheet with locked-not-scheduled row | Card locked but no calendar_entries row | Hook returns `rows: []`; banner hides; never renders fabricated date | Hook (Constitution #9) |
| **T-A09** (tester, adv) | Realtime — quorum-promoted saved card from another user | User B right-swipes a card that reaches quorum in s1 while User A has the saved-to-session sheet open | New `board_saved_cards` row appears within ~2s through the existing `board_session` realtime path | Realtime integration |
| **T-A10** (tester, adv) | Prefs change mid-swipe DOES NOT change current deck | Open in-chat deck, change travel-time in PreferencesSheet, close PreferencesSheet | Deck cards on screen are UNCHANGED (same V_n); next V_n card same as before; only after V_n exhausted does V_{n+1} appear | Integration — CR-3 strict |
| **T-A11** (tester, adv) | Solo session never shows banners | Force-mount `<CollabSessionChatBanners>` with sessionId from a solo session | If RLS permits read (currentUser is the solo "session"), the rows still display, but the component itself never mounts in solo because no group conversation exists. Verify by attempting to open a MessageInterface for a solo session — fails because `getOrCreateGroupConversationForSession` doesn't return for solo. | Negative path |
| **T-A12** (tester, adv) | BoardDiscussionTab unchanged | `git diff` on `app-mobile/src/components/board/BoardDiscussionTab.tsx` after implementation | Zero diff (legacy surface protected) | Static check |
| **T-A13** (tester, adv) | Chat-switch per-session deck (SC-23b) | Open MessageInterface for session s1, mount in-chat deck, close, open MessageInterface for s2, mount in-chat deck | Second mount fetches `useDeckCards('s2')` rows, NOT s1's; no stale s1 cards visible; `resolvedSessionId === 's2'` | Integration |
| **T-A14** (tester, adv) | Mongrel prop leak prevention (SC-23a) | Mount `<InChatDeckSheet sessionId='s1'>` from app state where `currentMode='solo'` and solo `userPreferences` are loaded | Sheet's `<SwipeableCards>` receives `currentMode='collab'` + session-bound prefs (resolved via `useBoardSession('s1')`); solo prefs DO NOT leak in. Verified by inspecting the props the SwipeableCards mount actually receives (via test render harness). | Component prop assertion |
| **T-A15** (tester, adv) | Home-page deck isolation (SC-23c) | Mount home-page deck for session s1 AND in-chat deck sheet for session s1 (after mutex resolution — close one first per SC-19), verify no cross-mount state leak in either direction | Each mount renders its own props; home-page closure doesn't reset chat-sheet state and vice-versa | Integration |
| **T-A16** (impl, adv) | Switching between two chats renders each session's own deck, never cross-leaks | Mount `<InChatDeckSheet visible sessionId='sA'>` under ambient solo provider, capture rendered card IDs, unmount, then mount `sessionId='sB'` | `setA ∩ setB === ∅`; each set matches its corresponding session stub. Test fails when `key={sessionId}` is removed from the nested provider. | Component/static + simulated behavior |

**Implementor-owned (happy-path/adversarial, immutable):** T-01, T-02, T-03-rev, T-04, T-05, T-06, T-07, T-08, T-09-rev, T-10, T-11, T-12, T-A16 — each with `fails-on-revert verified at <hash>` per ORCH-0840 Step 0.5.

**Tester-owned (adversarial, immutable):** T-A01..T-A15 plus live-device parity around T-A16 — must attack different angles than the implementor's happy-path. Each with its own `fails-on-revert` receipt.

---

## 7. Implementation Order

1. **Type + Zustand store first** (`useSessionDeckMountStore`) — pure client-state, no DB. Implementor writes T-06 + T-07 alongside.
2. **`useSessionScheduledCards` hook** — read-only. Uses live `calendar_entries.board_card_id`. Writes T-02.
3. **Saved-to-session query** — delete `useSessionLikedCards`; read unlocked `board_saved_cards` with the `SessionViewModal` Cards-tab filter and key `['savedCards', sessionId]`. Writes T-03-rev + T-A09.
4. **`SwipeableCardsProps.sessionIdOverride` additive prop** — minimal change to `SwipeableCards.tsx`. Writes T-04 + T-05.
5. **Invalidation cleanup** — remove obsolete `['sessionLikedCards', sessionId]`; preserve saved/scheduled keys. Writes SC-25 verification test.
6. **`<ScheduleSheet>` + `<SavedToSessionCardsSheet>` + `<InChatDeckSheet>` components** — three sheets, three files OR one file with three exports (implementor choice). The saved-to-session sheet remounts `<SwipeableSessionCards>`; the in-deck sheet wires PreferencesSheet sub-sheet INSIDE its Modal. Writes T-08 + T-09-rev + T-10 + T-11.
7. **`<CollabSessionChatBanners>` parent component** assembling 3 banners + 3 sheets + 2 hooks + mutex calls.
8. **`MessageInterface.tsx` mount** — the 5-line diff (discriminator + sibling conditional + import).
9. **Dedicated screen mutex calls** — find `SwipeableCards` mount in `SessionViewModal.tsx` (or wherever) and add `acquire`/`release` for `'dedicated-screen'` owner.
10. **Strict-grep gate** `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` registered in `.github/workflows/strict-grep-mingla-business.yml` (despite the workflow name; if it's mobile-specific, register in the right workflow — implementor confirms the pattern from prior ORCHs).
11. **CI regression script** `app-mobile/scripts/ci/orch-0918-regression-check.mjs` covering T-01..T-11 as text-regex + behavioral assertions; lands under append-only CI per ORCH-0840.

---

## 8. Regression Prevention

- **Structural safeguard:** three new DRAFT invariants (§5) + the single-mount mutex pattern make accidental regressions visible at code-review time and at runtime.
- **Test gate:** ORCH-0918 happy-path + adversarial regression scripts land under `app-mobile/scripts/ci/` and pick up the append-only CI workflow (`.github/workflows/tests-append-only.yml`). Tests become immutable after merge per ORCH-0840.
- **Strict-grep gate:** `orch-0918-banners-only-on-session-conv.mjs` prevents future PRs from mounting `<CollabSessionChatBanners>` under a wider predicate.
- **Protective comment:** added at the top of `CollabSessionChatBanners.tsx` documenting why the discriminator is exactly `linkedEntityType === 'session' && !!sessionId` (not `'session' || 'trip' || 'event'` — banner systems are intentionally non-shared).

---

## 9. Open questions (resolved by SPEC defaults)

| Q | Default adopted (overridable by operator before implementor dispatch) |
|---|---|
| Q1 (one banner vs two) | TWO separate banners (Schedule + Saved to session) — operator's corrected data-model directive supersedes the prior liked-cards wording. |
| Q2 (deck-button placement) | Third banner row, full-width, orange-tinted to signal primary action. NOT FAB, NOT composer icon. |
| Q3 (locked-card left-swipe semantics) | Locked cards are EXCLUDED from the deck's V_n shown list — the user never sees them in the deck once locked. Left-swipe in the deck only applies to non-locked V_n cards. |
| Q4 (saved-to-session refresh cadence) | Realtime via the existing `board_session` channel callbacks for saved-card promotion/lock changes. NOT polled, NOT open-time snapshot. |
| O-2 (in-deck prefs placement) | Header icon button in the deck sheet's top-right corner, opening `<PreferencesSheet>` as sub-sheet INSIDE the deck sheet's Modal children. NOT a 4th top-level banner. |

If Seth wants any default overridden, name it before implementor dispatch.

---

## 10. Hard guards re-stated for implementor

- No code in this spec — implementor produces it.
- No scope creep beyond the 15 items. Tangential discoveries → DISC-0918-N follow-up.
- **No `supabase db push`** — no migration; nothing to push.
- **No edge function deploy** — none touched.
- Consumer iOS + Android only.
- Do NOT touch `BoardDiscussionTab.tsx`, `SwipeableCards.tsx` internals (only the additive prop), `PreferencesSheet.tsx`, `SessionViewModal.tsx` (except adding the mutex acquire/release at the existing mount site), trip/event broadcast banner code path.
- Do NOT introduce a 3rd TopSheet consumer — all 3 sheets use standard `Modal`.
- Do NOT introduce server-state into the Zustand store — mount flag only.
- No AI attribution in commit messages.
- ORCH-0840 Step 0.5 regression-test gate: implementor writes happy-path tests with `fails-on-revert` receipts; tester writes adversarial tests with `fails-on-revert` receipts. Both immutable after merge.

---

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
