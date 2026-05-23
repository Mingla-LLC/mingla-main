# INVESTIGATION — META-ORCH-0929 [Collab decks live in group chat — Home is solo-only]

> **CORRECTION (2026-05-23, same-day amendment).** Earlier sections of this report (including Findings 3, 4 and the §6 SPEC scope estimate) treated ORCH-0902 [Collab Deck Determinism], ORCH-0909 [Positional Shared Deck], and ORCH-0906 [Single↔intent alternation] as unshipped pending-implementation. This was wrong — stale memory carried from an earlier session. **All three are SHIPPED and IN PRODUCTION** as of merge commits `b14f4f08` (ORCH-0902 completion), `1ac55db8` (ORCH-0902 hotfix), `7043f0ec` (ORCH-0902 follow-up), `74142108` (ORCH-0908+0909+0906 multi-CLOSE bundle), `a5c116c3` (ORCH-0906 client hotfix). Migrations on disk: `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql`, `…20260627…orch_0902_round_gps…`, `…20260701…orch_0909_positional_shared_deck.sql`, `…20260703…orch_0906_session_deck_cards_mixed_type.sql`. **Consequence for the META:** zero backend changes. The DB schema, RPCs, edge functions, and most of the client retirement list from ORCH-0909 §6.1 are already live. META is now PURELY a client-side architectural relocation + chooser + deletions. Estimated SPEC size revises DOWN from 3500-4000 lines to ~1500-2000 lines. The §6 estimate was wrong; trust the SPEC scope instead. Finding 4's "contracts are render-surface-agnostic" claim STANDS and is now demonstrated by the fact that the shipped contracts work in production — relocation is purely a React-tree move. **ORCH-0926 dirty changes** remain in scope per operator directive ("fold everything into one rigorous spec").


**Mode:** INVESTIGATE (code audit + SPEC ingest pass; live-fire sim deferred to TEST phase per dispatch scope)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Supersedes:** ORCH-0928 [Friends `+` chooser] (absorbed as sub-scope)
**Folds:** ORCH-0902 / ORCH-0909 [Collab Deck Determinism / Positional Shared Deck] + ORCH-0906 [Single↔intent strict-1:1 alternation] (their existing SPECs survive intact — see Finding 4)

---

## 1. Executive Summary

Operator confirmed (2026-05-23) a product redesign that absorbs three previously-separate workstreams into one clean architectural pass: (a) the Friends `+` chooser sheet originally registered as ORCH-0928, (b) deletion of `GlassSessionSwitcher` from HomePage with HomePage's deck locked to solo-only, and (c) relocation of the collab deck experience into a full-screen sheet launched from a "Start swiping together" CTA inside the group-chat surface. Invites surface as push + in-app notifications + a chat row appearing in the chat list with accept/decline inline — the SessionSwitcher pill-bar invite UX disappears entirely. ORCH-0902/0909 and ORCH-0906 are folded into this META because their contracts (deterministic positional shared-deck via `session_deck_cards` table + intent/single alternation via `session_curated_cache`) are **render-surface-agnostic** — they specify server-driven deck state, not React mount location. The META preserves both contracts verbatim and only changes where the existing deck React tree mounts (from HomePage's `<SwipeableCards>` deck-wrapper at `HomePage.tsx:352-377` to a new `<CollabDeckSheet>` modal wrapper launched from `MessageInterface.tsx`). The scope is large but tractable: ~7 mobile files touched, 1 new component, 0 new schema (ORCH-0909's schema lands as part of the META), full deletion of `GlassSessionSwitcher.tsx` (654 lines) and its prop-chain plumbing across `app/index.tsx` + `HomePage.tsx` + `CollaborationSessions.tsx` modalsOnlyMode mount. Operator has uncommitted changes in 4 files (`RecommendationsContext.tsx`, `useAuthSimple.ts`, `useBoardSession.ts`, `realtimeService.ts`, ~170 lines diff total) that the SPEC must reconcile — these appear to be in-flight ORCH-0926 [Realtime scoped authenticated rebind] work and overlap the same RecommendationsContext / useBoardSession / realtimeService files the META rewrites.

## 2. Affected Surfaces

- **Consumer iOS** — in scope (entire META is consumer mobile)
- **Consumer Android** — in scope (same RN code path)
- **Backend** (`supabase/`) — in scope (ORCH-0909 schema + RPCs + edge function rewrite folded in)
- **Buyer/anon Web** — NOT in scope (no consumer collab surfaces)
- **Business iOS / Android** — NOT in scope (no consumer collab surfaces)
- **Admin Web** — NOT in scope (no consumer collab surfaces)
- **Business web preview** — NOT in scope (same as Business iOS/Android)

iOS + Android parity automatic via shared RN code path; per-surface SCs not required (tester still exercises both per `feedback_tester_canonical_and_platform_parity.md`).

---

## 3. Findings

### 🔴 Finding 1 — HomePage today: collab-mode-aware deck wrapper (Root Cause / current contract)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/HomePage.tsx:352-377` (deck mount), `:29` (`currentMode: "solo" \| string` prop), `:357` (`currentMode={currentMode}` forwarded to SwipeableCards), `:219-229` (resolved-session-id memo derives from currentMode), `:269-308` (GlassSessionSwitcher), `:324-349` (CollaborationSessions modalsOnlyMode mount) |
| **What it does today** | HomePage receives `currentMode` and `selectedSessionId` from `app/index.tsx`. Today the deck mounted at line 354 (`<SwipeableCards currentMode={currentMode} ... />`) renders solo OR collab cards depending on currentMode. The pills row above (GlassSessionSwitcher at 271-306) drives mode switching. The CollaborationSessions modalsOnlyMode mount at 324-349 hosts the legacy create-session modal triggered via `createTriggerNonce`. |
| **What the META requires** | Strip `currentMode` AND `selectedSessionId` AND `boardsSessions` AND `collaborationSessions` AND `onSessionSelect` AND `onSoloSelect` AND `onCreateSession` AND `onAcceptInvite` AND `onDeclineInvite` AND `onCancelInvite` AND `onInviteMoreToSession` AND `onSessionStateChanged` AND `availableFriends` AND `isCreatingSession` AND `openSessionId` AND `onOpenSessionHandled` AND `createTriggerNonce` from HomePage's prop interface entirely. HomePage props shrink to just the solo-deck-relevant subset. The `<SwipeableCards>` mount drops the `currentMode` prop and always renders solo. The GlassSessionSwitcher render block at 269-308 is DELETED. The CollaborationSessions modalsOnlyMode mount at 324-349 is DELETED. |
| **Causal chain** | HomePage today is "the home/swipe page that knows about sessions." After: "the home/swipe page that only renders solo cards." Mode awareness is concentrated server-side per ORCH-0909 (decks driven by `session_id + current_position`); the only mode awareness remaining client-side after the META lives inside the new CollabDeckSheet wrapper. |
| **Verification step** | Grep `app-mobile/src/components/HomePage.tsx` post-implementation: ZERO matches for `currentMode`, `selectedSessionId`, `collaborationSessions`, `GlassSessionSwitcher`, `CollaborationSessions`. Also grep `<SwipeableCards`: must not pass any session-related props. |
| **Confidence** | High — direct read of HomePage.tsx lines 1-480 + understanding of the META scope. |

### 🔴 Finding 2 — `GlassSessionSwitcher.tsx` (654 lines) deletes entirely + prop-chain plumbing cascade (Root Cause / deletion target)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/GlassSessionSwitcher.tsx` (entire file, 654 lines) + every import site. |
| **What it does today** | Renders the horizontal pill bar (Solo + Session A + Session B + `+` create-pill) inside HomePage's GlassTopBar. Coach-mark integration. Touch/scroll handling. Tap routing for select/switch/create. |
| **What the META requires** | DELETE the entire file. DELETE the import at `HomePage.tsx:15` (`import { GlassSessionSwitcher, type SessionSwitcherItem } from "./GlassSessionSwitcher"`). DELETE the `sessionSwitcher` prop slot on GlassTopBar at `HomePage.tsx:269-308`. Verify no other consumers via `grep -rn "GlassSessionSwitcher" app-mobile/`. |
| **Causal chain (prop deletion cascade)** | Once GlassSessionSwitcher is gone, the props feeding it from `app/index.tsx:2387-2398` (`onSessionSelect`, `onSoloSelect`, `onCreateSession`, `onAcceptInvite`, `onDeclineInvite`, `onCancelInvite`, `onInviteMoreToSession`, `onSessionStateChanged`, `openSessionId`, `onOpenSessionHandled`, `collaborationSessions`, `selectedSessionId`, `currentMode`, `availableFriends`, `isCreatingSession`, `boardsSessions`) lose their HomePage consumer. They survive ONLY IF a new consumer (ConnectionsPage or CollabDeckSheet) needs them. Most do not — they become dead code that gets deleted in the same pass. The ones that survive get re-routed to ConnectionsPage / the new CollabDeckSheet wrapper. |
| **Verification step** | Post-implementation grep: ZERO matches for `GlassSessionSwitcher` across `app-mobile/`. Post-implementation grep on `app/index.tsx` for `onSessionSelect`, `onSoloSelect`, etc. — surviving matches must be passing to ConnectionsPage or the new CollabDeckSheet wrapper, not HomePage. |
| **Confidence** | High — file structure + import-trace complete. The cascade analysis depends on which props the new surfaces actually need (Finding 6 maps this). |

### 🟠 Finding 3 — `RecommendationsContext.tsx` (1906 lines) mode plumbing strips for the Home path (Contributing Factor / large refactor)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/contexts/RecommendationsContext.tsx` (1906 lines, large context owning the deck state machine). Mode-aware state: per ORCH-0909 SPEC §6.1 retirement list — `pinnedDeckVersion` (line 551), `pinnedDeckVersionSessionRef` (line 563), `3-case transition effect` (lines 583-635), `collabDeckParams` memo (lines 642-651), `accumulatedCardsRef` (collab path), `sessionServedIdsRef` (collab path), `isExhausted` advancement gate (line 619), `isRefreshingAfterPrefChange` (line 1014), async GPS-write effect (lines 1465-1478, collab path), `expected_deck_version` request param. |
| **What it does today** | The context drives BOTH the solo deck AND the collab deck via shared state with mode-aware branches. The collab branch contains 9 distinct mechanisms that ORCH-0909 retired (per §6.1 of that SPEC). |
| **What the META requires (post-ORCH-0909 fold-in + relocation)** | ORCH-0909's §6.1 retirements still happen as-is. ADDITIONALLY: the context split. Today RecommendationsContext mounts ONCE at the app root and serves both solo (via HomePage) and collab (via HomePage + selectedSessionId). After META: the context still mounts once, but the Home deck consumes ONLY the solo path AND the new CollabDeckSheet consumes ONLY the collab path. Mode awareness inside the context shrinks because `currentMode` from HomePage's prop chain disappears. Two architectural options for SPEC: **(A)** keep RecommendationsContext as a single context but feed it `mode` from whichever sheet is currently mounted (sheet-driven); **(B)** split into `SoloRecommendationsContext` (always-active, drives Home deck) + a per-sheet `CollabRecommendationsContext` instance mounted by CollabDeckSheet for the active session. Recommend (A) — smaller blast radius, single source of truth. SPEC will lock the choice. |
| **Causal chain** | Today: HomePage owns the deck → HomePage's `currentMode` drives the context. After META: ConnectionsPage's CollabDeckSheet owns the collab deck → the sheet's `sessionId` drives the context's collab path. HomePage's deck stops triggering any collab branches. |
| **Verification step** | Grep `RecommendationsContext.tsx` post-implementation for `currentMode === 'solo'` and `isCollaborationMode` branches: every collab branch must be reachable ONLY when a sessionId is actively set by a mounted CollabDeckSheet, not by HomePage. |
| **Confidence** | Medium-high — RecommendationsContext is the largest file in scope; some sub-flows (e.g., `useBoardSession` realtime fan-out, deckStateRegistry interactions) need deeper read during SPEC. ORCH-0909 SPEC §6.1 + §6.6 carry most of the retirement plan, so the META just amends "context still owns it; the trigger source changes." |

### 🟠 Finding 4 — ORCH-0909 + ORCH-0906 contracts are render-surface-agnostic (Contributing Factor / fold confirmation)

| Field | Evidence |
|---|---|
| **File + line** | `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` §1.1 (scope: server table + RPCs + edge function), §6.1-§6.7 (client retirement + new state + accept flow + banner + useBoardSession realtime + solo unchanged). `Mingla_Artifacts/specs/SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE.md` §3-§7 (single↔intent alternation, `session_curated_cache` table, `generate-curated-experiences` invocation contract). |
| **What the SPECs assume about render surface** | NOTHING. The ORCH-0909 contract: client passes `{ session_id, current_position }` to `discover-cards/handleDeterministicV2`; server returns one card; deck advances. The render surface (which React component mounts the swiper) is NEVER specified. The "Locating you" banner from §6.5 is the only UI piece — it's a new component the implementor places "at the top of the deck UI"; the META just places it inside CollabDeckSheet instead of inside HomePage. |
| **What this means for the META** | ORCH-0909 + ORCH-0906 land verbatim. The META adds a thin wrapper component (`<CollabDeckSheet>`) that hosts the existing `<SwipeableCards>` (or whatever the deck renderer is) feeding it `session_id` instead of `currentMode`. The collab-mode logic that ORCH-0909 placed inside RecommendationsContext stays there — only the trigger source moves from HomePage's mode prop to CollabDeckSheet's sessionId prop. |
| **Causal chain** | Operator decided to fold ORCH-0909+0906 into the META. This finding confirms the fold has zero cost — the contracts are unaffected by relocation. The META's SPEC will re-state ORCH-0909+0906's contract sections (copy-paste from the existing SPECs) with a note that the deck mount lives in CollabDeckSheet not HomePage. |
| **Verification step** | Diff ORCH-0909 SPEC §3 (DB), §4 (SQL), §5 (edge function), §6.4 (accept flow), §7 (migration) against META SPEC's equivalent sections post-write — must be byte-equivalent except for the deck-mount-location language in §6.2. Same for ORCH-0906 amendment §3-§7. |
| **Confidence** | High on contract-agnostic claim; the SPECs explicitly leave render surface unspecified. |

### 🔴 Finding 5 — Group chat (`MessageInterface.tsx`) is ready for a deck CTA (Root Cause / integration point)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/MessageInterface.tsx:239-243` (already detects `isGroupChat` via `friend.conversationType === "group"` and resolves `friend.sessionId` for linked-entity-type `"session"`), `:108-109` (props `conversationType` + `sessionId`), `:1012` (existing session-id-dependent effect — proves sessionId is reliably available on group chats today). |
| **What it does today** | Group chats already distinguish session-linked chats from event/trip-linked chats. `friend.sessionId` is populated for `linked_entity_type='session'` chats. The infrastructure for a session-specific affordance inside MessageInterface already exists (header right-aligned slot, etc.). |
| **What the META requires** | Add a "Start swiping together" CTA inside the MessageInterface header (or a sticky banner at the top of the chat) — visible ONLY when `isGroupSessionChat` (the `sessionId !== null && linkedEntityType === 'session'` branch at line 243). On tap: open `<CollabDeckSheet sessionId={friend.sessionId}>`. The CTA's exact placement (header right slot, sticky banner, FAB) → SPEC decides. The CTA copy → SPEC decides ("Start swiping together" is operator-verbatim from the registration). |
| **Causal chain** | Today there's no entry to a collab deck from group chat — collab decks live on Home behind the SessionSwitcher pills. META moves the entry point to group chat. The CTA is the new entry. |
| **Verification step** | Maestro: tap a session-linked group chat from chat list → assert CTA visible. Tap CTA → assert CollabDeckSheet opens. |
| **Confidence** | High — MessageInterface is already shaped for session-aware affordances; this is an additive CTA, not a rewrite. |

### 🔴 Finding 6 — Friends `+` chooser sheet (sub-scope from ORCH-0928, simplified) (Root Cause / chooser portion)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/ConnectionsPage.tsx:2891-2905` (the `+` button) — same as ORCH-0928's investigation Finding 1. |
| **What it does today** | Tapping `+` opens `PairRequestModal` directly. |
| **What the META requires** | Same chooser sheet design as ORCH-0928's superseded SPEC §3.1 (RN `<Modal>`, ~40% max height, drag handle, two equal-weight options "Create a group chat" + "Add a friend", title "What do you want to do?", `requestAnimationFrame` defer for sub-sheet nesting compliance). **DIFFERENT routing**: "Create a group chat" no longer triggers an existing CollaborationSessions create-modal (that modal AND CollaborationSessions.tsx component AND `createTriggerNonce` plumbing AND modalsOnlyMode mount get DELETED in the META). Instead, "Create a group chat" routes to a NEW create-session flow that lands the user directly inside a freshly-created group chat — where they immediately see the "Start swiping together" CTA. |
| **Causal chain** | Pre-META: chooser → CollaborationSessions create-modal → (name, friends, phone invites) → onCreateSession → session row + invites. Post-META: chooser → new lightweight create-session sheet (name + friends) → atomic RPC creates session + group chat conversation row + session_participants rows + invite records → navigate user into the new group chat → "Start swiping together" CTA is the next tap. |
| **Why CollaborationSessions gets deleted** | Operator directive: "no transitional duplicate code, no dead instances." CollaborationSessions.tsx (1641+ lines) contains the legacy create-modal + invite-pill rendering + paywall gate. The create-modal portion moves into a much simpler new sheet. The invite-pill rendering DIES (invites now surface in chat list per Finding 7). The paywall gate moves with the create-sheet. Net: CollaborationSessions.tsx is fully replaced by a smaller new component (TBD `<CreateGroupChatSheet>`). |
| **Verification step** | Post-implementation grep: ZERO matches for `CollaborationSessions` across `app-mobile/`. ZERO matches for `createTriggerNonce`. ZERO matches for `modalsOnlyMode`. |
| **Confidence** | High on the deletion targets. SPEC needs to design the new create-session sheet's UI (name input + friends multi-select + paywall gate) — simpler than CollaborationSessions because invite-pill rendering + session-list browsing are gone. |

### 🔴 Finding 7 — Invites surface as chat rows + notifications (Root Cause / invite UX redesign)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/hooks/useSessionManagement.ts:619-637` (`acceptInvite` callback), `app-mobile/src/services/collaborationInviteService.ts` (entire file — invite resolution + atomic accept per ORCH-0909 §6.4), MessageInterface chat-list rendering at `ConnectionsPage.tsx` (the `<ChatListItem>` rendering — see Finding 5 of ORCH-0928 investigation for chat-list location). Current invite surfacing: `CollaborationSessions.tsx` pill bar showing `sent-invite` / `received-invite` types. |
| **What it does today** | Incoming invite → realtime push → `CollaborationSessions` pill bar shows received-invite pill → user taps to accept/decline inline → `useSessionManagement.acceptInvite` fires. |
| **What the META requires** | Incoming invite → push notification (OneSignal — existing system) + in-app notification banner (existing notification system) + a NEW chat-list row appears for that group chat with state="pending invite" badge and inline Accept / Decline buttons OR a "Tap to view invite" affordance. On Accept: `acceptCollaborationInviteWithPrefs` fires (ORCH-0909 §6.4 atomic accept), chat row updates to active state, user can tap to enter the chat and see the "Start swiping together" CTA. On Decline: chat row disappears. |
| **Causal chain** | The CollaborationSessions pill-bar invite UX is dead with the deletion of CollaborationSessions.tsx. The invite has to surface SOMEWHERE — chat list is the operator-chosen home for it. |
| **Open questions for SPEC** | (1) Does a pending-invite chat row appear in the same chat list as accepted chats, or in a separate "Invites" section? (2) Is the chat content visible BEFORE accept, or hidden until accept? (3) Does declining notify the inviter? (4) What happens if multiple invites pile up? |
| **Confidence** | Medium-high on the overall shape; SPEC needs to resolve the 4 open questions. |

### 🟡 Finding 8 — Operator dirty changes overlap META scope (Hidden Flaw / reconciliation required)

| Field | Evidence |
|---|---|
| **File + line** | `git diff --stat` on the 4 named files: `app-mobile/src/contexts/RecommendationsContext.tsx` (+42 -27), `app-mobile/src/hooks/useAuthSimple.ts` (+28 -0), `app-mobile/src/hooks/useBoardSession.ts` (+31 -8), `app-mobile/src/services/realtimeService.ts` (+98 -29). Total ~170 lines diff. |
| **What it is** | Per the `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` artifact (referenced in `git status`), this is in-flight ORCH-0926 work on realtime authenticated rebind. Three of the four files (RecommendationsContext, useBoardSession, realtimeService) are ALSO in META scope (RecommendationsContext is the deck-state owner; useBoardSession + realtimeService are the realtime fan-out for session updates). |
| **What it means for SPEC** | The META cannot land cleanly on top of unmerged ORCH-0926 changes — both touch the same realtime + session-state paths. The SPEC must explicitly call out: (a) confirm ORCH-0926 status (closed? in-flight? abandoned?); (b) if ORCH-0926 should land FIRST as its own PR, the META waits; (c) if ORCH-0926 is being folded into the META, the META SPEC must include the ORCH-0926 diff as part of its scope. Recommend (b) — ship ORCH-0926 first to keep PRs small + revert-able, then META on top. Operator must confirm. |
| **Causal chain** | Conflict mechanics: META retires RecommendationsContext collab-state machinery (ORCH-0909 §6.1 retirement list); ORCH-0926 modifies the same RecommendationsContext realtime subscription logic. Without sequencing, the two diffs collide and the resulting merge confuses both ORCHs. |
| **Verification step** | Operator answers: "Is ORCH-0926 ready to close? If yes, ship it first." |
| **Confidence** | High — git diff confirms file overlap; ORCH-0926 artifacts confirm the in-flight status. |

### 🔵 Finding 9 — Other entry points that need re-routing (Observation / scope completeness)

The following currently route to collab-session UIs and need re-evaluation post-META:

| Today's entry | Action |
|---|---|
| Profile page "Friends" stat → opens ConnectionsPage with `initialPanel="friends"` | Unchanged (Friends tab still exists). |
| Notification deep-link → `openSessionId` → CollaborationSessions opens session modal | Re-route to: open the group chat for that session in ConnectionsPage (MessageInterface). The session modal disappears. |
| Discover map "Message" → `pendingOpenDmUserId` → ConnectionsPage opens DM | Unchanged (DM path is separate from collab-session path). |
| ConnectionsPage's existing `onCreateSession` prop (ORCH-0666 refresh callback at `app/index.tsx:2457`) | Survives as-is (it's a "session was created — refresh" notification, not the trigger flow). May get renamed `onSessionListRefreshed` for clarity, SPEC decides. |
| `useSessionManagement` hook | Survives but methods get re-pointed (acceptInvite still atomic per ORCH-0909 §6.4, just called from chat-row Accept button instead of CollaborationSessions pill). |
| `useBoardSession` hook | Survives — extended per ORCH-0909 §6.6 (`current_position` surfacing). |
| `RecommendationsContext.onSessionLost` handler (ORCH-0444) | Re-routes — instead of pushing user back to solo mode on HomePage, now closes the CollabDeckSheet and surfaces a toast in the chat. |

### 🔴 Finding 10 — Constitutional + invariant compliance (Root Cause / no blockers)

| Check | Result |
|---|---|
| **Constitution #1 (no dead taps)** | Chooser options + chat-row accept/decline + Start-swiping CTA all have concrete handlers. |
| **Constitution #2 (one owner per truth)** | Cleaner than today — collab session state has ONE consumer (CollabDeckSheet) instead of TWO (HomePage deck + CollaborationSessions modal). Improves on the current architecture. |
| **Constitution #8 (subtract before adding)** | The META is mostly SUBTRACTION — GlassSessionSwitcher (654 lines), CollaborationSessions.tsx (~1641 lines), `createTriggerNonce` plumbing, mode-aware HomePage props, mode-aware deck render branch. Net code reduction expected to exceed net additions. |
| **I-SUB-SHEET-INSIDE-PARENT** | Applies to chooser → downstream sheet ordering. SPEC mandates `requestAnimationFrame` defer (carried from ORCH-0928's design). |
| **I-PROPOSED-J NO_SERVER_SNAPSHOTS_IN_PERSIST** | Not triggered — META holds no server snapshots in Zustand. |
| **I-PROPOSED-ORCH-0902/0909 contracts** | Preserved verbatim per Finding 4. |
| **I-COLLAB-MATCH-OBSERVABLE** (`INVARIANT_REGISTRY.md` line 2197) | Match notification observability stays — match quorum lives at `board_user_swipe_states` (ORCH-0909 §1.2 confirms quorum logic untouched). The notify-session-match telemetry events fire regardless of which React tree mounts the swiper. |
| **`feedback_solo_collab_parity.md`** | Inverted by this META — solo and collab are now in DIFFERENT surfaces (Home vs group-chat sheet). The parity rule loses its meaning for THIS feature; SPEC must update the memory to clarify "solo/collab parity applies WITHIN the deck experience, not across render surfaces." |

No constitutional or invariant blockers. The META improves several invariants (one-owner-per-truth) and creates one new one ("the collab deck is mounted ONLY by the CollabDeckSheet wrapper; no other React tree may instantiate the collab branch of RecommendationsContext").

---

## 4. Investigation Manifest — files read this pass

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0928_FRIENDS_PLUS_BUTTON_CHOOSER.md` (full)
- `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` (§1, §2, §3.1-§3.2, §6.1-§6.7 in full; remainder skimmed for header structure)
- `Mingla_Artifacts/specs/SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE.md` (header structure + §1, §3, §5, §8)
- `Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md` (header structure — confirmed superseded by ORCH-0909 design)
- `app-mobile/src/components/HomePage.tsx` (lines 1-480, full)
- `app-mobile/src/components/ConnectionsPage.tsx` (carried from ORCH-0928 investigation; targeted re-reads on +button + chat list + CollaborationSessions mount)
- `app-mobile/src/components/PairRequestModal.tsx` (carried from ORCH-0928 investigation)
- `app-mobile/src/components/CollaborationSessions.tsx` (lines 80-300; deletion target — SPEC will read remainder)
- `app-mobile/src/components/MessageInterface.tsx` (header structure + lines 105-115, 239-243, 1012)
- `app-mobile/src/contexts/RecommendationsContext.tsx` (line counts + dirty-diff structure — full read deferred to SPEC phase)
- `app-mobile/app/index.tsx` (lines 2340-2470 + 2183-2185, prop wiring)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (search hits for collab/match/session)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0926_REALTIME_SCOPED_AUTHENTICATED_REBIND.md` (referenced by name; not opened — operator clarifies status)
- `git diff --stat` on the 4 dirty files

## 5. Open Questions for SPEC (operator MUST answer before SPEC writes)

1. **ORCH-0926 sequencing.** Is ORCH-0926 [Realtime scoped authenticated rebind] ready to close as its own PR before META lands? Recommended: yes. If yes, operator ships 0926 first; SPEC starts after. If no/uncertain: SPEC must fold 0926 changes in.
2. **Pending-invite chat row UI.** Three sub-questions: (a) Pending invites in same chat list as accepted chats, or separate "Invites" section above? (b) Is chat content visible before accept, or hidden? (c) On decline — silently drop or notify inviter? (d) Multiple invites — order by recency, oldest first, or by inviter name?
3. **CollabDeckSheet visual.** Full-screen modal? Or 90%-height sheet with chat backdrop visible? Animation: slide-up or full-screen push?
4. **"Start swiping together" CTA placement inside MessageInterface.** Three options for SPEC: (a) header right slot (always visible while in chat), (b) sticky banner at top of message thread, (c) floating action button bottom-right.
5. **Existing session "leave" affordance location.** Today users leave sessions from CollaborationSessions UI. After META — inside the group chat menu? Inside CollabDeckSheet header? Both?
6. **Create-group-chat sheet UI.** Operator confirmed the chooser opens this. Does it need: (a) name input only, (b) name + friends multi-select, (c) name + friends + phone invites (current CollaborationSessions parity), (d) name + auto-include all selected from chooser? Recommend (b) — friend invites at creation time is the highest-value path; phone invites can come later via in-chat invite.
7. **Paywall gate placement.** Today `useSessionCreationGate` gates the create-modal opening from CollaborationSessions. After META — gate at chooser tap, or at create-sheet submit? Recommend at chooser tap (cheaper UX — user knows immediately if they're paywalled).
8. **Notification deep-link behavior post-META.** When user taps a session push notification, do they land in the group chat (Friends tab) or directly in the CollabDeckSheet?
9. **Multi-session handling.** A user can be in multiple group chats / sessions. Today the GlassSessionSwitcher made the "active" session explicit. After META — is there a notion of "active" session at all, or does each group chat have its own independent CollabDeckSheet? Recommend the latter — no global "active session," just per-chat session state. This simplifies considerably.
10. **ORCH-0902 SPEC disposition.** The earlier ORCH-0902 SPEC (1221 lines) is fully superseded by ORCH-0909. Confirm we archive ORCH-0902's SPEC entirely and rely only on ORCH-0909's design.

## 6. Estimated SPEC scope

The SPEC will be substantial — ~3-4x normal:

- §3 Database — copy-paste from ORCH-0909 §3 (3 schema items) + ORCH-0906 §3 (2 schema items). ~250 SPEC lines.
- §4 SQL — copy-paste from ORCH-0909 §4 (3 functions) + ORCH-0906 §4 (1 delta). ~600 SPEC lines.
- §5 Edge function — copy-paste from ORCH-0909 §5 + ORCH-0906 §7 (`handleDeterministicV2` rewrite). ~400 SPEC lines.
- §6 Client (NEW for META) — chooser sheet + create-group-chat sheet + CollabDeckSheet wrapper + MessageInterface "Start swiping" CTA + chat-list pending-invite row + HomePage strip + GlassSessionSwitcher deletion + CollaborationSessions deletion + RecommendationsContext mode-source change + ORCH-0909 §6.1-§6.7 client portions. ~1500 SPEC lines.
- §7 Migration / rollout — ORCH-0909 §7 single-shot reset + new deletion ordering. ~200 SPEC lines.
- §8 SC matrix — ~30 SCs (ORCH-0909's CR-1..CR-9 + ORCH-0906's CR-A..CR-D + META-specific MET-1..MET-15 for chooser, deletions, sheet, chat-row invites, locked-home-solo). ~200 SPEC lines.
- §9 Invariants — ORCH-0909 + ORCH-0906 invariants + META new invariants (collab-deck-mount-singleton, home-deck-solo-locked). ~150 SPEC lines.
- §10 Test plan — 9 ORCH-0909 step-0.5 tests + 4 CI gates + new META tests (~10). ~250 SPEC lines.

Total: **~3500-4000 line SPEC**. Single-turn SPEC writing is feasible IF operator answers the 10 open questions tightly. Otherwise SPEC writing should be staged across 2 turns.

---

## 7. Confidence Summary

| Area | Confidence |
|---|---|
| HomePage strip mechanics | **High** |
| GlassSessionSwitcher deletion cascade | **High** |
| RecommendationsContext mode-source change | **Medium-high** (large file, deeper sub-flow read needed during SPEC) |
| ORCH-0909+0906 render-surface-agnostic claim | **High** (SPECs explicitly leave surface unspecified) |
| MessageInterface "Start swiping" integration point | **High** |
| Friends chooser sub-scope (carried from ORCH-0928) | **High** |
| Invite-via-chat-row UX feasibility | **Medium-high** (4 sub-questions for SPEC) |
| ORCH-0926 dirty-diff conflict mechanics | **High** (git evidence confirms file overlap) |
| Constitutional + invariant compliance | **High** (no blockers; some improvements) |

**Overall:** Investigation has surfaced everything SPEC needs to write a coherent contract. The 10 open questions in §5 are all SPEC-shaping (UX decisions, paywall placement, ordering choices) — none are gating discoveries that would change the META's overall shape. Recommend operator answer all 10, then SPEC writes in 1-2 turns.

---

## Discoveries for Orchestrator

- **DISC-0929-A** — `CollaborationSessions.tsx` is ~1641 lines and contains the legacy session-creation modal + invite-pill rendering + paywall gate + per-session view modal + country-picker integration. The META deletes ALL of it; the replacement is a much smaller `<CreateGroupChatSheet>` (estimated ~300 lines). Net code reduction ~1300+ lines from this file alone.
- **DISC-0929-B** — `GlassSessionSwitcher.tsx` (654 lines) deletes entirely. Net code reduction +654.
- **DISC-0929-C** — Combined with ORCH-0909's `pinnedDeckVersion` + transition-effect + GPS-write-effect retirements (~150 lines from RecommendationsContext.tsx), the META is **net-negative on lines of code** even after adding the chooser sheet (~200 lines) + create-group-chat sheet (~300 lines) + CollabDeckSheet wrapper (~200 lines) + MessageInterface CTA (~50 lines) + chat-row pending-invite UI (~150 lines). Estimated net: -1500 lines. This is a healthy simplification.
- **DISC-0929-D** — The "no global active session" recommendation (Open Question 9) is a meaningful product simplification — eliminates the `selectedSessionId` + `currentMode === sessionId` mental model. Each group chat is independently a swipe surface; users implicitly "context-switch" by tabbing between chats. If operator agrees, the `selectedSessionId` + `setSessionModalTrigger` state at `app/index.tsx` gets DELETED in the same pass.
- **DISC-0929-E** — `feedback_solo_collab_parity.md` rule loses its meaning for THIS feature post-META (solo and collab live in different surfaces). The CLOSE Step 5c memory-scan must update that memory to clarify the new scope of the parity rule.
- **DISC-0929-F** — ORCH-0926 [Realtime scoped authenticated rebind] sequencing is a hard blocker per Finding 8. Operator MUST sequence: either close 0926 first, or fold 0926 into META. Without that decision, SPEC cannot write the RecommendationsContext / useBoardSession / realtimeService change blocks.

---

**Investigation report path:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0929_COLLAB_DECKS_IN_GROUP_CHAT_HOME_SOLO_ONLY.md` (this file)
**Pipeline next:** operator answers the 10 SPEC-shaping questions in §5 (especially Q1 ORCH-0926 sequencing — hard gate) → Claude `mingla-forensics` writes META SPEC (1-2 turns) → Codex `implementor-mingla` → Claude `mingla-tester` (iOS + Android sim + real device for sheet + deck experience) → orchestrator CLOSE.
