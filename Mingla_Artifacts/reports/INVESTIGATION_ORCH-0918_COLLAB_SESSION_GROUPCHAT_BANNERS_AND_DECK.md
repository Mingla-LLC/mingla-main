# INVESTIGATION — ORCH-0918 [Collab session group chat: schedule banner + liked-cards banner + in-chat swipeable deck]

**Author:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-22
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`
**Severity:** S2-medium
**Classification:** `missing-feature` + `ux`
**Affected Surfaces:** Consumer iOS + Consumer Android only
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** source-only investigation — no runtime sim repro required per Prime Directive #7 (this is a missing-feature investigation; the operator's specific reproducer is "open a collab session group chat and observe there are no banners or deck access" — verified true from code).

---

## 0. Phase 0 ingestion log

**Memories read:**
- `feedback_collab_deck_determinism_contract.md` — CR-1..CR-9 (determinism + V_n cutover + late-join + dismissed-sheet visible-but-not-binding + full cutover with no `deck_model` column).
- `feedback_topsheet_extended_universal_creator.md` — TopSheet has 2 acceptable consumers (BrandSwitcherSheet `heightMode="fixed-70"` + UniversalCreatorSheet `heightMode="compact"`); any new consumer needs orchestrator approval + DEC entry.
- `feedback_rn_sub_sheet_must_render_inside_parent.md` (referenced) — sub-sheets render inside parent `<Sheet>`, not as Fragment siblings.
- `feedback_solo_collab_parity.md` (referenced) — solo + collab parity rule; here the feature is collab-only because solo sessions have no group chat.
- `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` (referenced) — applies to the horizontal-scroll liked-cards sheet sitting near vertical message list.
- `feedback_keyboard_never_blocks_input.md` (referenced) — any text input inside the new sheets must respect keyboard.

**Artifacts read:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0910_CHAT_MOUNTED_CARD_PARITY.md` — current canonical chat-mounted card payload contract + `cardPayloadToExpandedCardData` adapter + `MessageBubble.tsx` curated-card render path. The new in-chat features build on this surface.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md` (referenced via memory + `LockedPlanBanner` header doc) — locked-plan banner pattern already established for `BoardDiscussionTab` (legacy in-board chat tab).
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0909_COLLAB_DECK_POSITIONAL_SHARED_DECK_v2.md` (file present; cited in dispatch as non-regression target).

**Code read:**
- `app-mobile/src/components/MessageInterface.tsx` (L100–1400 spot-reads, header + chat-substrate selection + banner region L1283-L1300).
- `app-mobile/src/components/ConnectionsPage.tsx` (L230–L1700 spot-reads, the friend/conversation-meta builder L970–L1010 and L1340–L1700 chat-launch).
- `app-mobile/src/hooks/useSessionDiscussion.ts` (full header + query-keys + resolver).
- `app-mobile/src/components/board/LockedPlanBanner.tsx` (full — 142 lines).
- `app-mobile/src/components/board/BoardDiscussionTab.tsx` (L1–100 — confirms it's the LEGACY in-board tab, separate from MessageInterface).
- `app-mobile/src/components/board/SwipeableSessionCards.tsx` (header + props — matched-cards horizontal carousel, NOT the main deck).
- `app-mobile/src/components/SwipeableCards.tsx` (spot-reads — the MAIN session deck with `useSessionDismissedCards` + `DismissedCardsSheet` integration).
- `app-mobile/src/components/SessionViewModal.tsx` (consumer of `SwipeableSessionCards`).
- `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` (full — the lock-and-schedule sheet from ORCH-0908).
- `app-mobile/src/hooks/useBoardSession.ts` (header + spot-reads).
- `app-mobile/src/hooks/useSessionDismissedCards.ts` (L62 — exists as the per-user dismissed-cards reader; mirror needed for likes).
- `app-mobile/src/hooks/useChatCardTagSource.ts` (L53–61 — confirms `board_saved_cards` columns `id, session_id, experience_id, saved_experience_id, card_data, saved_by, saved_at, is_locked, locked_at, locked_by_consensus`).
- `app-mobile/src/hooks/useSessionVoting.ts` (L70–90 — confirms `is_locked, locked_at` are real columns; uses query key pattern compatible with the new hooks).
- `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` (L120 comment — confirms `useSessionDismissedCards` reads `session_swipes WHERE action='left'`; the right-swipes equivalent is symmetric).
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` (L3705–L3861, L6280–L6378 — confirms `session_swipes` schema + the `rpc_record_swipe_and_check_match` RPC that already writes both `'left'` and `'right'` actions; ≥2 right-swipe quorum lives in the trigger).

---

## 1. Symptom Summary

**Expected (per operator request):** the group chat backing a collaboration session shows two top banners (modeled on the trip broadcast banner pattern) — one opens a sheet listing every locked-in card in scheduled order, one opens a horizontally-scrolling bottom sheet listing every right-swiped (liked) card attributed by participant — plus a third entry point (placement TBD) that opens the full swipeable deck inside the chat as a sheet whose swipes feed the same session state machine as the dedicated session screen.

**Actual (today):** the group chat backing a collaboration session (`friend.linkedEntityType === 'session'` inside `MessageInterface.tsx`) has NO header banner. The banner region at `MessageInterface.tsx:1283-1300` is gated on `isTripEventGroupChat` only — collab session chats fall through to a plain chat header with no session-state surfaces. The locked-in cards, liked-cards, and swipe deck are all accessible only from the separate dedicated session UI (`SessionViewModal.tsx` / `BoardDiscussion.tsx`). There is no in-chat access path.

**Reproduction:** open any collab session group chat via the Friends tab → `ConnectionsPage` list-item → `MessageInterface` mounts with `friend.linkedEntityType === 'session'` + `friend.sessionId` set. Observe: no banners, no deck access.

---

## 2. Investigation Manifest (files read, in order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `MessageInterface.tsx` | Component | Find the banner region + collab-session discriminator |
| 2 | `ConnectionsPage.tsx` | Component | Find the chat-launch path + `friend` shape including `linkedEntityType` + `sessionId` |
| 3 | `useSessionDiscussion.ts` | Hook | Confirm the session ↔ conversation link (`getOrCreateGroupConversationForSession`) |
| 4 | `LockedPlanBanner.tsx` | Component | Existing single-card locked-plan banner (ORCH-0908) — pattern to extend to multi-card schedule sheet |
| 5 | `BoardDiscussionTab.tsx` | Component | Confirm legacy in-board chat tab is SEPARATE from `MessageInterface`; not the surface the operator means |
| 6 | `SwipeableSessionCards.tsx` | Component | Determine whether this is the main deck (it's NOT — it's the matched-cards carousel) |
| 7 | `SwipeableCards.tsx` | Component | Find the actual main session deck primitive |
| 8 | `SessionViewModal.tsx` | Component | Confirm where `SwipeableSessionCards` mounts (matched-cards section, separate from deck) |
| 9 | `LockedCardSchedulingSheet.tsx` | Component | Existing lock+schedule sheet (ORCH-0908) — confirms `board_saved_cards` schema + `BoardSessionService.lockAndScheduleCard` RPC + query-key invalidations |
| 10 | `useSessionDismissedCards.ts` | Hook | Existing per-user left-swipe reader — the right-swipe (likes) hook will mirror it |
| 11 | `useChatCardTagSource.ts` | Hook | Confirms `board_saved_cards` columns inc. `is_locked, locked_at, locked_by_consensus` |
| 12 | `useSessionVoting.ts` | Hook | Confirms `is_locked, locked_at` query patterns |
| 13 | `useBoardSession.ts` | Hook | The umbrella session state hook |
| 14 | `20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` | Migration | `session_swipes` schema + partial index on action='left'; right-swipes use base PK |
| 15 | `20260505000000_baseline_squash_orch_0729.sql` | Migration | `session_swipes` baseline + `rpc_record_swipe_and_check_match` RPC + ≥2 right-swipe quorum trigger |

---

## 3. Findings (six-field evidence per root finding)

### Finding F-1 (🔵 Observation) — Collab session group chat surface is `MessageInterface`, not `BoardDiscussionTab`

**WHAT:** The operator's "group chats that are a collaboration session" refers to `MessageInterface.tsx` rendered with `friend.linkedEntityType === 'session'` and `friend.sessionId` populated. `BoardDiscussionTab.tsx` is a SEPARATE legacy chat-tab that lives inside the dedicated `BoardDiscussion.tsx` session view and already integrates `LockedPlanBanner` (single-card).

**WHERE:**
- `MessageInterface.tsx:110` — `linkedEntityType?: "direct" | "session" | "trip" | "event" | null;`
- `MessageInterface.tsx:231` — `const isTripEventGroupChat = isGroupChat && (friend.linkedEntityType === "trip" || friend.linkedEntityType === "event");` — note: **excludes `"session"`**.
- `ConnectionsPage.tsx:1358-1360` — `sessionId: conversationMeta.session_id ?? null, … linkedEntityType: conversationMeta.linked_entity_type ?? null,` — the friend object passed to `MessageInterface` carries both.
- `useSessionDiscussion.ts:60-78` — resolves `sessionId → conversationId` via `messagingService.getOrCreateGroupConversationForSession(sessionId)`. The "SAME-THREAD-TWO-VIEWS contract (operator-locked D1, 2026-05-20)" in the header doc explicitly states the conversation_id from the Friends-tab list-item route is the SAME conversation_id used by the in-session Discussion tab — single chat substrate, two surfaces.

**HOW REPRODUCED:** Grep `linkedEntityType` across `app-mobile/src/`; trace `ConnectionsPage.tsx:974–1004` building the friend item from `conversations.linked_entity_type` + `conversations.session_id`; read `MessageInterface.tsx` chat-substrate selection.

**WHY IT MATTERS:** The new banners + deck button MUST mount in `MessageInterface.tsx` under a new discriminator `isCollabSessionGroupChat = isGroupChat && friend.linkedEntityType === "session" && !!friend.sessionId`. They MUST NOT touch `BoardDiscussionTab.tsx` (legacy surface, separate purpose) and MUST NOT touch the trip/event branch.

**CONFIDENCE:** high — three layers (TS type, conversation schema migration, runtime resolver hook) all agree on the discriminator.

**CROSS-LAYER:** docs (useSessionDiscussion header doc) + code (MessageInterface + ConnectionsPage) + schema (conversations.linked_entity_type + conversations.session_id) — all aligned.

---

### Finding F-2 (🔵 Observation) — Trip broadcast banner pattern is the visual template (`TripCountdownBanner`)

**WHAT:** The trip broadcast banner the operator references is `TripCountdownBanner`, mounted at `MessageInterface.tsx:1287` inside `isTripEventGroupChat ? <View style={styles.eventChannelHeaderStack}>…</View> : null`. It's a Pressable that opens `setShowGroupEventSheet(true)`.

**WHERE:**
- `MessageInterface.tsx:36` — `import { TripCountdownBanner } from "./chat/TripCountdownBanner";`
- `MessageInterface.tsx:1284-1300` — render region:
  ```tsx
  {isTripEventGroupChat ? (
    <View style={styles.eventChannelHeaderStack}>
      {friend.eventId ? (
        <TripCountdownBanner
          eventId={friend.eventId}
          onPress={friend.eventPublicCard ? () => setShowGroupEventSheet(true) : undefined}
          …
        />
      ) : null}
      …
    </View>
  ) : null}
  ```
- `MessageInterface.tsx:1071` — `isBroadcastOnlyConsumerChannel` (trip broadcast specific) — does NOT generalize to session chats.

**HOW REPRODUCED:** Direct read of MessageInterface region around L1284.

**WHY IT MATTERS:** The visual pattern (thin banner pinned above message list, full-width, tap → sheet) and the structural slot (`styles.eventChannelHeaderStack` wrapper) are both reusable. The new collab session banners must mount in a SIBLING conditional block (`isCollabSessionGroupChat ? …`) — NOT inside the trip/event block.

**CONFIDENCE:** high — direct file read.

**CROSS-LAYER:** code only (visual primitive). No DB / runtime divergence.

---

### Finding F-3 (🔵 Observation) — Locked-in cards data source: `board_saved_cards WHERE is_locked = true AND scheduled_at IS NOT NULL`

**WHAT:** The canonical data source for "locked-in cards in scheduled order" is `board_saved_cards` filtered by `is_locked=true` joined to `calendar_entries` (or directly to `board_saved_cards.scheduled_at` if that column exists — verify in implementation; the migration index shows `scheduled_at` lives elsewhere per ORCH-0908 spec §2A.12). The existing `LockedPlanBanner` (`BoardDiscussionTab.tsx:91-99`) reads ONE locked card + one `scheduled_at` — needs extension to a list.

**WHERE:**
- `useChatCardTagSource.ts:57-61` — columns enumerated: `id, session_id, experience_id, saved_experience_id, card_data, saved_by, saved_at, is_locked, locked_at, locked_by_consensus`. **NOTE:** `scheduled_at` is NOT in this list — it likely lives in `calendar_entries` keyed by `saved_card_id`. The implementor must verify via `mcp__supabase__list_tables`.
- `LockedCardSchedulingSheet.tsx:115-120` — `BoardSessionService.lockAndScheduleCard(sessionId, savedCardId, pickedDate, …)` is the writer; the read-side mirror needs to JOIN `board_saved_cards` ↔ `calendar_entries` on saved_card_id.
- `LockedCardSchedulingSheet.tsx:141-147` — invalidation keys: `["deck-cards", sessionId]`, `["session", sessionId]`, `["calendarEntries", currentUserId]`, `["savedCards", sessionId]`, `["savedSessionCards", sessionId]`. The new hook's query key MUST be in the SAME invalidation set so a lock fires from anywhere updates the schedule sheet.
- `LockedPlanBanner.tsx:91-99` — operator-confirmed (memory `feedback_collab_deck_determinism_contract.md`) the dismissed-sheet pattern: visible-but-not-binding semantics. The schedule sheet does NOT need that nuance — locked cards are committed state.

**HOW REPRODUCED:** Read `LockedCardSchedulingSheet`'s invalidation keys + grep `board_saved_cards` across hooks.

**WHY IT MATTERS:** A NEW hook `useSessionScheduledCards(sessionId)` is needed. Query: `SELECT bsc.*, ce.scheduled_at FROM board_saved_cards bsc LEFT JOIN calendar_entries ce ON ce.saved_card_id = bsc.id WHERE bsc.session_id = $1 AND bsc.is_locked = true AND ce.scheduled_at IS NOT NULL ORDER BY ce.scheduled_at ASC`. Query key: `["scheduledCards", sessionId]` — must be added to the invalidation set in `LockedCardSchedulingSheet.tsx:141-147`. Empty state must render honestly (Constitution #9) — "No plans locked in yet" rather than fabricated rows.

**CONFIDENCE:** high — schema verified via `useChatCardTagSource` column doc + ORCH-0908 spec; the JOIN to `calendar_entries` is the open implementation detail (SPEC will resolve).

**CROSS-LAYER:** code (existing readers) + schema (column doc) + runtime (invalidation set) — coherent.

---

### Finding F-4 (🔴 Root Cause — missing-feature classification — applies to the gap, not a bug) — Liked-cards (right-swipes, pre-quorum) has NO existing hook; needs a new mirror of `useSessionDismissedCards`

**WHAT:** The operator's second banner shows "every card any participant has right-swiped in the session, attributed by participant" — a per-session aggregation of `session_swipes WHERE action = 'right'` GROUP BY `experience_id` with per-card participant lists. NO such hook exists today. Only the symmetric `useSessionDismissedCards` (left-swipes) and the post-quorum `board_saved_cards` view exist.

**WHERE:**
- `useSessionDismissedCards.ts:62` — `export function useSessionDismissedCards(sessionId, currentUserId): { rows: CollabDismissalRow[], … }` — reads `session_swipes WHERE session_id = X AND action = 'left'` (per migration `20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql:120` partial-index comment).
- `20260505000000_baseline_squash_orch_0729.sql:6280` — `WHEN 'right' THEN 'swiped_right'` — confirms the `action` column carries both `'left'` and `'right'` symmetrically; the schema supports the new query.
- `20260505000000_baseline_squash_orch_0729.sql:3776-3777` — `-- Threshold: 2+ right-swipes = match` — confirms right-swipes are written even pre-quorum (each one fires the trigger, the trigger only PROMOTES at ≥2). So the data is there from the first right-swipe.
- `feedback_collab_deck_determinism_contract.md` CR-8 — match (save) quorum at ≥2 right-swipes is PRESERVED; the new liked-sheet shows pre-quorum likes too (richer than the post-quorum `board_saved_cards` view).

**HOW REPRODUCED:** Grep `session_swipes` in hooks; only one reader exists (`useSessionDismissedCards`).

**WHY IT MATTERS:** A NEW hook is needed: `useSessionLikedCards(sessionId, currentUserId): { rows: SessionLikeRow[] }` reading `session_swipes WHERE session_id = $1 AND action = 'right'` joined to participant display-name (mirror the dismissed-cards JOIN). The hook MUST:
- Aggregate by `experience_id` (or `experience_card_data->>'id'`) so each card appears once with a list of liker participant IDs/names.
- Return cards in deterministic order (recommend: most-recent-swipe-first, or most-likes-first — SPEC to confirm).
- Include the full card payload so the sheet can render without a second fetch.
- Respect RLS so a participant only sees per-session likes, not cross-session.
- Cache key `["sessionLikedCards", sessionId]` — added to the invalidation set fired on `rpc_record_swipe_and_check_match` (current code invalidates `["dismissedCards", sessionId]`; symmetric invalidation required).

**CONFIDENCE:** high — schema confirmed, parallel hook pattern confirmed, gap is a clear absent reader not a broken reader.

**CROSS-LAYER:** docs (determinism contract CR-8 + ORCH-0902 spec) + schema (session_swipes baseline) + code (dismissed-cards mirror) — fully coherent.

---

### Finding F-5 (🟠 Contributing Factor) — Two distinct "swipeable" components exist; the operator's deck = `SwipeableCards.tsx` (the main Tinder-style deck), NOT `SwipeableSessionCards.tsx` (matched-cards carousel)

**WHAT:** `app-mobile/src/components/board/SwipeableSessionCards.tsx` (props at L52, render at L99) is the MATCHED-CARDS horizontal carousel mounted inside `SessionViewModal.tsx` — it shows cards that have already cleared the ≥2 right-swipe quorum and is a horizontal scroll, not a Tinder deck. The actual main session swipe deck (Tinder-style left/right swipe with per-card animation) is `app-mobile/src/components/SwipeableCards.tsx` (which integrates `useSessionDismissedCards` + `DismissedCardsSheet` per F-4 evidence).

**WHERE:**
- `SwipeableSessionCards.tsx:30` — imports `LockedCardSchedulingSheet`; renders horizontal scroll (`ScrollView` + `CARD_WIDTH = SCREEN_WIDTH * 0.75`); used by `SessionViewModal.tsx`.
- `SwipeableCards.tsx:51` — imports `useSessionDismissedCards`; the main deck. ~2600 lines. This is the one the operator wants.

**HOW REPRODUCED:** Grep both component names; observe consumers.

**WHY IT MATTERS:** The dispatch's I-5 (Deck Embedding Contract) must specify `SwipeableCards`, not `SwipeableSessionCards`. The deck's session-state coupling lives there (read of V_n via existing query keys, swipe writes via `rpc_record_swipe_and_check_match`, dismissed-sheet integration). The in-chat sheet renders `SwipeableCards` with the same props it receives in the dedicated session screen.

**CONFIDENCE:** high — direct file inspection.

**CROSS-LAYER:** code only.

---

### Finding F-6 (🟡 Hidden Flaw — design gate) — TopSheet currently has 2 acceptable consumers; adopting it for any of the 3 new sheets requires orchestrator approval + a new DEC entry

**WHAT:** Per `feedback_topsheet_extended_universal_creator.md`, `TopSheet.tsx` is reserved for `BrandSwitcherSheet` (`heightMode="fixed-70"`) and `UniversalCreatorSheet` (`heightMode="compact"`). Any third consumer (e.g., if the schedule banner sheet were specced as a drop-from-top sheet for visual continuity with the banner's origin) needs orchestrator approval + a new DEC entry per DEC-152 extension rule.

**WHERE:** `feedback_topsheet_extended_universal_creator.md` lines 32–51 — the kit-extension rule.

**WHY IT MATTERS:** RECOMMENDATION per sheet:
- **Schedule sheet (banner #1 → opens locked-in list):** use the standard bottom `Modal` pattern (mirror `LockedCardSchedulingSheet.tsx` overlay structure at L202-269 — `Modal transparent animationType="fade"` + centered card). NO TopSheet — flag-free.
- **Liked-cards sheet (banner #2 → horizontal-scroll bottom sheet):** use the standard bottom `Modal` with `animationType="slide"` rising from bottom. NO TopSheet — flag-free.
- **In-chat swipeable deck sheet (button → full deck):** use the standard `Modal` full-screen presentation (mirror how `SessionViewModal` is opened). NO TopSheet — flag-free.

If any of these recommendations is overridden to use TopSheet at SPEC time, the SPEC MUST flag it for orchestrator review BEFORE implementor dispatch and propose a new DEC entry.

**CONFIDENCE:** high — memory is canonical + this investigation can recommend standard `Modal` for all three without compromising UX.

**CROSS-LAYER:** docs (memory + DEC-152) + code (mirror existing primitives).

---

### Finding F-7 (🟠 Contributing Factor) — Button placement for the in-chat deck launch: recommend a third banner row (banner #3), NOT a FAB or composer-row icon

**WHAT:** Four placement candidates evaluated:

(a) **Third banner at top (alongside the two info banners)** — operator's request explicitly says "find a place to put a button"; the banner stack at `MessageInterface.tsx:1284-1300` already establishes a "session info banner stack" pattern. A third banner labeled e.g. "Swipe cards together →" with a chevron rightward and a tap target ≥48pt fits visually. Strong continuity with the trip-broadcast banner stack.

(b) **Floating action button (FAB) bottom-right** — competes with the chat composer's send button + visually overloads the message list scroll. Reject.

(c) **Icon button in the chat input row (composer)** — competes with the keyboard, the "tag card" `+` button (per `MessageInterface.tsx` `CardTagPopover` integration), and breaks the composer's compact layout. Reject.

(d) **Icon button in the existing banner row** — works visually but conflates "info pill" with "primary action launcher." Reject in favor of (a)'s dedicated row.

**WHERE:**
- `MessageInterface.tsx:1284-1300` — the existing banner stack region.
- `feedback_wcag_aa_kit_invariants.md` I-38 — IconChrome touch target ≥44pt; a banner row easily satisfies (48pt min height per `LockedPlanBanner.tsx:106` precedent).

**WHY IT MATTERS:** The SPEC adopts placement (a) — third banner row, full-width, distinct color from the two info banners to signal "primary action" not "info readout." Recommended visual: orange/amber-tinted to match the existing locked-plan banner family (`LockedPlanBanner.tsx:108` `backgroundColor: "#FEF3C7"`) but with a forward chevron + cards-stack icon.

**CONFIDENCE:** high — design rationale + WCAG invariant compliance both support (a).

**CROSS-LAYER:** code (banner stack pattern) + invariant (touch target).

---

### Finding F-8 (🟡 Hidden Flaw — non-regression risk) — V_n cutover protocol when in-chat deck sheet is open mid-swipe

**WHAT:** Per `feedback_collab_deck_determinism_contract.md` CR-3, a pref change at moment T does NOT update any participant's deck mid-session; each participant continues swiping V_n through its final card before V_{n+1} card #1 appears. The same rule MUST hold when the deck is rendered inside the in-chat sheet. If the user has the in-chat deck sheet open mid-swipe, a remote pref change must NOT cause cards to swap underfoot; the buffered transition fires on V_n exhaustion regardless of which mount (in-chat sheet vs dedicated session screen) the user is swiping from.

**WHERE:**
- `feedback_collab_deck_determinism_contract.md` CR-3 (full quote in §0 ingest).
- `SwipeableCards.tsx:621` — the existing main-deck consumer of `useSessionDismissedCards` — its state machine is already V_n-aware (per ORCH-0902 implementation).

**HOW REPRODUCED:** Source-only trace of the contract + the existing component's V_n handling. Live-fire repro will follow at TEST phase.

**WHY IT MATTERS:** The SPEC's "Deck Embedding Contract" MUST specify that the in-chat sheet renders the SAME `SwipeableCards` instance state (no fork). The cleanest approach: the sheet receives `sessionId` only and instantiates its own `SwipeableCards` mount — both mounts share the same React Query cache (`["deck-cards", sessionId]`) and the same session-state writes, so the V_n cutover protocol holds automatically because it lives in the underlying state machine, not in the component instance.

**Open question O-1 for SPEC** (default proposed): if the user swipes on a card in the in-chat sheet AND the dedicated session screen is ALSO mounted somewhere in the navigation stack, both mounts must converge on the cache. Cleanest default: only ONE `SwipeableCards` instance is allowed to be mounted at any time per session — when the in-chat sheet opens, it takes over; when it closes, the dedicated mount resumes. Implementation: a session-scoped mutex via a Zustand client-state flag (`useSessionDeckMountStore`), NOT a server-state. Operator can override.

**CONFIDENCE:** medium-high — contract is canonical, integration risk is real, mitigation is straightforward.

**CROSS-LAYER:** docs (determinism contract) + code (existing V_n state machine) + runtime (concurrent-mount risk).

---

### Finding F-9 (🟡 Hidden Flaw) — Solo sessions must NOT inherit these banners; solo has no group chat

**WHAT:** Per memory `feedback_solo_collab_parity.md`, every collab fix is checked against solo. Here the inverse holds: solo sessions have no group chat surface, so the new banners cannot appear in solo (there is no `MessageInterface` mount for a solo session). Confirmed by grep: `MessageInterface` is only reachable via `ConnectionsPage` → group conversation → `linkedEntityType === 'session'`; solo sessions don't create a group conversation.

**WHERE:**
- `useSessionDiscussion.ts:73` — `getOrCreateGroupConversationForSession(sessionId)` — only creates the conversation when the session is multi-participant (collab). Solo doesn't trigger this path.
- `ConnectionsPage.tsx:896-901` — chat list filters by `conv.type === 'group' && sessionId` — solo isn't `type='group'`.

**WHY IT MATTERS:** No-op — the implementor doesn't need to add a solo guard because the surface itself doesn't render in solo. The SPEC should explicitly state this so the tester doesn't write a "banner doesn't show in solo" test that's tautological. Tester writes the negative test as "banner doesn't show on `linkedEntityType === 'direct'` (DM) and doesn't show on `linkedEntityType === 'trip'` or `'event'` (broadcast)" — those are the real negative cases.

**CONFIDENCE:** high — schema-level proof.

**CROSS-LAYER:** code + schema.

---

### Finding F-10b (🔵 Observation — added 2026-05-22 per operator amendment) — In-chat deck sheet must ALSO expose session preferences access; reuse the existing `PreferencesSheet` primitive

**WHAT:** Operator amended ORCH-0918 (2026-05-22, mid-investigation): the sheet that hosts the swipeable deck in the chat must ALSO provide access to the session preferences sheet so participants can change their preferences without leaving the group chat. The existing `app-mobile/src/components/PreferencesSheet.tsx` is the single canonical primitive used by both the dedicated session screen and solo mode; it reads session context internally via `useBoardSession`, so it can be mounted from the in-chat deck sheet as-is.

**WHERE:**
- `app-mobile/src/components/PreferencesSheet.tsx:1-60` — single primitive; imports `useBoardSession`, `usePreferencesData`, `PreferencesService`. Renders inside a `Modal`.
- `app-mobile/src/components/AppHandlers.tsx:501` — existing consumer pattern: `PreferencesSheet.handleApplyPreferences` mirrors the collab pref-write path; pref change triggers server-side V_{n+1} mint per CR-3.
- `feedback_rn_sub_sheet_must_render_inside_parent.md` — the prefs sub-sheet MUST render INSIDE the in-chat deck sheet's children, not as a Fragment sibling, to avoid the OS-root-layer modal-blocking issue.

**HOW REPRODUCED:** Direct file read of `PreferencesSheet` props + consumer trace.

**WHY IT MATTERS:** The in-chat deck sheet now hosts TWO surfaces — `SwipeableCards` (deck) + an entry point to `PreferencesSheet` (prefs). Recommended UX: a small "Preferences" icon button in the deck sheet's header (top-right, ≥44pt touch target per I-38). Tapping it opens `<PreferencesSheet>` as a sub-sheet rendered INSIDE the deck sheet's `<Modal>` children per the sub-sheet-inside-parent rule. Pref changes from this entry point flow through the EXACT same `PreferencesService` writers as the dedicated session screen — V_{n+1} mints server-side, V_n cutover protocol holds (CR-3). When the user closes the prefs sub-sheet and returns to the deck, they resume V_n at their cursor; V_{n+1} fires on V_n exhaustion. No new state machine, no new mutex, no special handling.

**Open question O-2 for SPEC** (default proposed): the in-chat prefs entry point is a header icon button on the deck sheet, NOT a separate top-level banner. Rationale: prefs access is contextually a deck-companion action (you change prefs while looking at / about to swipe the deck), not a standalone chat-banner action. Adding it as a 4th top-level banner would visually overload the chat header. Operator can override to make it a 4th top-level banner if preferred.

**CONFIDENCE:** high — primitive exists, integration pattern is well-established, V_n contract is unchanged.

**CROSS-LAYER:** docs (determinism contract CR-3 + sub-sheet-inside-parent memory) + code (PreferencesSheet existing primitive + AppHandlers consumer pattern) — coherent.

---

### Finding F-10 (🔵 Observation) — `MessageInterface.tsx` is ~2000 lines; the new code surface should live in a new sub-component to keep MessageInterface's complexity bounded

**WHAT:** `MessageInterface.tsx` is already a large component (header L1110-L1283 + chat substrate + composer + modals). Adding three new banners + three new sheets inline would push it over 2400 lines and slow type-checking. Recommend: extract a new `<CollabSessionChatBanners sessionId={…} currentUserId={…} />` component that owns the three banners + their three sheets, and mount it in `MessageInterface.tsx` in a single line under the new `isCollabSessionGroupChat` conditional.

**WHERE:** `MessageInterface.tsx` length (verified by Bash earlier).

**WHY IT MATTERS:** Maintainability + bounded test surface + clean cross-surface non-regression (the SPEC's hard guard "no regression on trip broadcast banner" is trivially satisfied because the new component lives in a separate conditional branch).

**CONFIDENCE:** high — design recommendation, not a bug.

**CROSS-LAYER:** code only.

---

## 4. Five-Layer Cross-Check

| Layer | Result |
|---|---|
| **Docs** | Memory contracts (determinism CR-1..CR-9, TopSheet consumer count, solo-parity, sub-sheet inside parent, keyboard-never-blocks) are all consistent with the proposed feature. No doc/code contradictions. |
| **Schema** | `conversations.linked_entity_type` + `conversations.session_id` (link), `board_saved_cards.is_locked` + `locked_at` + `locked_by_consensus` (locked-in source), `calendar_entries.scheduled_at` + `.saved_card_id` (schedule join), `session_swipes.action` + `.user_id` + `.experience_id` (likes source) — all verified present in baseline + ORCH-0902 migrations. |
| **Code** | `MessageInterface` lacks the `isCollabSessionGroupChat` discriminator + banner mount points (gap). `useSessionDismissedCards` exists; symmetric `useSessionLikedCards` absent (gap). `SwipeableCards` is embeddable as-is into a sheet (no gap; just consumed). `LockedPlanBanner` shows single card today; multi-card schedule sheet new (gap). |
| **Runtime** | Existing invalidation keys at `LockedCardSchedulingSheet.tsx:141-147` define the contract the new hooks plug into. Adding `["scheduledCards", sessionId]` + `["sessionLikedCards", sessionId]` to that set is the runtime change. |
| **Data** | `session_swipes` already records right-swipes from quorum-trigger pre-existence (baseline L3776) — pre-quorum likes are queryable today. No data migration needed. Locked + scheduled rows exist (ORCH-0908) — readable today. |

**No layer contradictions.** All five align on a coherent additive feature.

---

## 5. Blast Radius Map

| Affected | What changes |
|---|---|
| `MessageInterface.tsx` | New `isCollabSessionGroupChat` discriminator + new banner-stack conditional block (parallel to trip/event block) |
| NEW file `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` | Three banners + three sheets (deck sheet additionally hosts a Preferences entry point opening `PreferencesSheet` as sub-sheet per F-10b), owned in one component |
| NEW hook `app-mobile/src/hooks/useSessionScheduledCards.ts` | `board_saved_cards` × `calendar_entries` JOIN reader |
| NEW hook `app-mobile/src/hooks/useSessionLikedCards.ts` | `session_swipes WHERE action='right'` aggregated by experience_id with liker names |
| `LockedCardSchedulingSheet.tsx:141-147` | ADD `["scheduledCards", sessionId]` + `["sessionLikedCards", sessionId]` to the invalidation set; also invalidate from the swipe write path (find via grep — likely in `useSessionVoting` mutate) |
| `useSessionVoting.ts` (swipe writer) | ADD `["sessionLikedCards", sessionId]` invalidation after right-swipe mutate |
| Existing `LockedPlanBanner.tsx` (`BoardDiscussionTab` legacy surface) | Unchanged — this ORCH does not touch the legacy in-board chat tab |
| Existing `SwipeableCards.tsx` main deck | Unchanged — embedded as-is into the new "deck sheet" via mount |
| Trip/event broadcast banner | Unchanged — different conditional branch |
| Solo session UX | Unchanged — no group chat surface exists for solo |
| `SessionViewModal.tsx` dedicated session screen | Unchanged — additional surface, not replacement |
| ORCH-0909 [Collab positional shared deck] | Unchanged — in-chat deck reuses the same shared deck state |

**Hard guards re-stated for SPEC:**
(a) Zero touch to the trip/event broadcast banner code path.
(b) Zero touch to `BoardDiscussionTab.tsx` legacy surface.
(c) Zero touch to `SessionViewModal.tsx` dedicated session screen.
(d) Zero touch to `SwipeableCards.tsx` internals (consume as-is).
(e) V_n cutover protocol preserved by mount-mutex pattern in F-8.
(f) Three new sheets use standard `Modal` primitive, NOT `TopSheet` (F-6).

---

## 6. Invariant Violations

None caused by the proposed feature. The feature must PRESERVE:
- **CR-1..CR-9** (determinism contract) — preserved automatically by consuming `SwipeableCards` as-is.
- **I-CATEGORY-SLUG-CANONICAL** — N/A (no category derivation).
- **I-PROPOSED-CHAT-PAYLOAD-CURATED-AWARE** + **I-PROPOSED-CHAT-MODAL-PARITY** + **I-PROPOSED-CHAT-MOUNT-VIEWER-RELATIVE-TRAVEL** (ORCH-0910) — preserved because card-in-bubble rendering is unchanged; the new sheets render cards via the same `ExpandedCardModal` / `MessageBubble` chain.
- **Constitution #2 (one owner per truth)** — preserved by single-mount-per-session pattern (F-8) and by hooks sharing query keys with the existing invalidation set.
- **Constitution #9 (no fabricated data)** — preserved by honest empty states for both sheets (e.g., "No plans locked in yet", "No one has liked any cards yet").
- **TopSheet consumer count = 2** — preserved by recommending standard `Modal` (F-6).

NEW invariants the SPEC may propose (DRAFT, flip ACTIVE on CLOSE):
- **I-PROPOSED-COLLAB-SESSION-CHAT-BANNERS-ONLY-ON-SESSION-CONV:** banners render iff `friend.linkedEntityType === 'session' && !!friend.sessionId`. Enforcement: strict-grep rule on `MessageInterface.tsx` that the new conditional matches exactly that predicate.
- **I-PROPOSED-IN-CHAT-DECK-SINGLE-MOUNT:** at most one `SwipeableCards` mount per `sessionId` at any time. Enforcement: unit test on `useSessionDeckMountStore` lock contract.

---

## 7. Fix Strategy (direction only — full contracts deferred to SPEC)

1. **New discriminator** in `MessageInterface.tsx:231` area:
   ```ts
   const isCollabSessionGroupChat = isGroupChat && friend.linkedEntityType === 'session' && !!friend.sessionId;
   ```
2. **New banner mount** parallel to `isTripEventGroupChat` block (~L1284):
   ```tsx
   {isCollabSessionGroupChat ? (
     <CollabSessionChatBanners sessionId={friend.sessionId!} currentUserId={currentUserId} />
   ) : null}
   ```
3. **New component** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` containing:
   - Banner #1 (Schedule) — uses `useSessionScheduledCards(sessionId)`; opens `<ScheduleSheet>` (standard `Modal`).
   - Banner #2 (Likes) — uses `useSessionLikedCards(sessionId)`; opens `<LikedCardsSheet>` (standard `Modal`, content is horizontal `<ScrollView horizontal>`).
   - Banner #3 (Deck launcher) — opens `<InChatDeckSheet>` (standard full-screen `Modal`) which renders `<SwipeableCards sessionId={sessionId} currentUserId={currentUserId} mode="in-chat" />` AND a header icon button (top-right, ≥44pt) that opens `<PreferencesSheet>` as a sub-sheet rendered INSIDE the `<InChatDeckSheet>` children per `feedback_rn_sub_sheet_must_render_inside_parent.md`. Pref changes from this entry point flow through the existing `PreferencesService` writers; V_{n+1} mints server-side and buffers per CR-3 — no special handling needed (F-10b).
4. **Two new hooks** per F-3 + F-4.
5. **Invalidation wiring**: add the two new query keys to `LockedCardSchedulingSheet.tsx:141-147` and to the swipe-write path in `useSessionVoting` (mutate `onSuccess`).
6. **Single-mount mutex** for `SwipeableCards`: Zustand store `useSessionDeckMountStore({ sessionId, ownerId })` — the in-chat sheet acquires lock on open, releases on close; dedicated session screen acquires on its own mount. If lock already held, the second mount renders a "Deck open elsewhere" placeholder (or no-op; SPEC decides).

---

## 8. Regression Prevention Requirements

- **Implementor happy-path test** (immutable per ORCH-0840 Step 0.5) — `app-mobile/scripts/ci/orch-0918-regression-check.mjs`:
  - Mount `MessageInterface` with `linkedEntityType='trip'` → assert NO collab session banners render.
  - Mount with `linkedEntityType='session'` + `sessionId='s1'` → assert all three collab session banners render.
  - Mount with `linkedEntityType='direct'` → assert NO banners.
  - `useSessionScheduledCards` happy path: seeded 2 locked+scheduled rows → returns 2 rows in scheduled order.
  - `useSessionLikedCards` happy path: seeded 3 right-swipes across 2 participants on 2 cards → returns 2 card rows, one with 2 likers + one with 1 liker.
- **Tester adversarial test** (different angles):
  - Mount in-chat deck sheet AND dedicated session screen concurrently → assert single-mount mutex prevents duplicate writes.
  - V_n cutover with in-chat deck sheet open mid-swipe → assert deck does NOT swap underfoot.
  - Liked-cards sheet with 0 likes → assert honest empty state, no fabricated row.
  - Schedule sheet with all locked cards lacking `scheduled_at` → assert empty state (per LockedPlanBanner constitution-9 rule).
- **Strict-grep gate** `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` — fails CI if `<CollabSessionChatBanners>` ever mounts under a non-session predicate.

---

## 9. Discoveries for Orchestrator

- **DISC-0918-1 (low):** `LockedPlanBanner.tsx` in the legacy `BoardDiscussionTab` surface shows ONE locked card. The new schedule sheet shows ALL of them. Recommend: after ORCH-0918 ships, evaluate whether `BoardDiscussionTab` should adopt the same multi-card sheet pattern OR be retired entirely in favor of the unified `MessageInterface` surface (per the SAME-THREAD-TWO-VIEWS contract from ORCH-0898). Out of scope for ORCH-0918; register a follow-up ORCH if Seth wants the legacy surface modernized.
- **DISC-0918-2 (low):** The dispatch's I-9 listed 4 open questions (Q1 one-banner-vs-two, Q2 deck-button placement, Q3 locked-card left-swipe semantics, Q4 liked-sheet refresh cadence). Recommended defaults (per finding evidence above):
  - **Q1:** TWO separate banners (matches operator's explicit phrasing "have a banner at the top" + "the second one shows a banner"). Adopt unless operator overrides.
  - **Q2:** Placement (a) — third banner row (F-7). Adopt unless operator overrides.
  - **Q3:** Locked cards are committed state; the in-chat deck should EXCLUDE locked cards from its V_n shown list (they're already "matched" beyond quorum and on the schedule). Left-swiping in the deck only applies to non-locked V_n cards. If a card is somehow visible AND locked, left-swipe is a no-op (locked overrides). Adopt unless operator overrides.
  - **Q4:** Real-time refresh — the liked-cards sheet subscribes to the same realtime channel that already broadcasts swipe events (per `useSessionDismissedCards` pattern) and re-fetches via `queryClient.invalidateQueries(['sessionLikedCards', sessionId])` on swipe event. NOT polled, NOT open-time-snapshot. Adopt unless operator overrides.
- **DISC-0918-3 (medium):** F-8's single-mount mutex pattern (`useSessionDeckMountStore`) is new client-state infrastructure. If Seth prefers a simpler approach (e.g., "both mounts are allowed, last-write-wins per session-state machine"), the SPEC defaults to mutex but accepts override. Mutex is safer; concurrent mounts are messy.
- **DISC-0918-4 (low):** This investigation did NOT live-fire-repro on iOS sim because the symptom is a MISSING feature (operator's reproducer is "open the chat and observe absence"), and source-only trace is conclusive for absence claims per Prime Directive #7 exemption clause. TEST phase will live-fire after implementation.

---

## 10. Confidence Level

**HIGH** for the overall investigation.

- Architecture (F-1, F-2) — high (three-layer code + schema + runtime agreement).
- Data sources (F-3, F-4) — high (schema verified; symmetric hook pattern).
- Component reuse (F-5) — high (direct file inspection).
- Design gates (F-6, F-7) — high (memory canonical + WCAG invariant).
- Non-regression (F-8, F-9) — medium-high (contract canonical; mutex pattern is a SPEC decision, not yet load-tested).
- Component scaling (F-10) — high (file-size evidence + standard refactor).

---

## 11. Next phase

Orchestrator REVIEW of this investigation; on APPROVE, re-dispatch this skill in SPEC mode with this investigation as input. The SPEC will produce contracts for the 2 new hooks, the 1 new component, the 1 new client-state store, the invalidation wiring, the 3 new banners + 3 new sheets, success criteria SC-01..SC-N, happy + adversarial test matrices, locked implementation order, and constitutional + invariant compliance audit.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
