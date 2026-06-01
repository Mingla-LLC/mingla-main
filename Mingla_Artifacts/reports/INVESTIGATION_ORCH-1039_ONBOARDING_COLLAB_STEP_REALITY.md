# INVESTIGATION — ORCH-1039 [Onboarding collaboration step — reality audit + conditional-hide]

**Mode:** INVESTIGATE (investigation only — no fixes)
**Date:** 2026-06-01
**Surface:** Consumer app (`app-mobile/`), onboarding Step 6 `subStep === 'collaborations'`
**Confidence:** root cause **proven** (source fully traced; copy strings + sequencing + data hooks read end-to-end). Live-fire sim not run — this is a copy/render/data-flow audit, not a runtime-bug reproducer; finding F-3 (fresh-user render) is proven from the render conditionals, not pattern-matched.

---

## 1. Symptom / Operator concern

Two concerns:
1. **Stale promise** — the "Plan something together" copy may describe an experience (Home-based active sessions / "vote on favorites") that no longer matches post-META-ORCH-0929 reality (Home is solo-only; collab decks live only inside group chat).
2. **Hollow fresh-user state** — a brand-new user who added no friends, has no sessions/trips/chats may see nothing meaningful, in which case the step should be hidden/skipped.

---

## 2. Investigation manifest (files read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | Mandatory entry read. No BLOCK/OPEN row targets ORCH-1039 / mingla-forensics. |
| 2 | `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` | The step under audit — full render + data wiring (read in full, 924 lines). |
| 3 | `app-mobile/src/i18n/locales/en/onboarding.json` (`collaborations` block) | Exact current copy. |
| 4 | `app-mobile/src/types/onboarding.ts` | SubStep type union + `OnboardingData` shape (`createdSessions`, `collabActionTaken`, `addedFriends`). |
| 5 | `app-mobile/src/hooks/useOnboardingStateMachine.ts` | Step/substep sequencing — where a skip would hook. |
| 6 | `app-mobile/src/components/OnboardingFlow.tsx` (L2137 CTA, L3099 friends, L3163 collab render) | How the step is mounted, its footer CTA, and its props. |
| 7 | `app-mobile/src/hooks/usePendingTripChatClaims.ts` | Trip/event-chat data source. |
| 8 | `app-mobile/src/hooks/useSessionManagement.ts` (L305 `createCollaborativeSession`, L566 `createCollaborativeSessionV2`) | What "Start session" actually creates + where it surfaces. |
| 9 | grep `CollabDeckSheet` / `collaboration_sessions` across `app-mobile/src` | Confirm post-0929 surfacing path (group chat → CollabDeckSheet). |

---

## 3. ANSWERS TO THE SIX QUESTIONS

### Q1 — What does `OnboardingCollaborationStep` actually render?

A single `KeyboardAwareScrollView` (OnboardingCollaborationStep.tsx:339) containing, top to bottom:

- **Headline** (L340): `t('onboarding:collaborations.headline')` → **"Plan something together"**
- **Body** (L341–343): `collaborations.body` → **"Start a session with your crew. Discover things to do, vote on favorites, and actually make it happen."**
- **"Who's in?" friend chips** (L346–383): horizontal scroll of `addedFriends`, each a tappable chip (avatar + `displayName`) that toggles selection. Section label `collaborations.whos_in` → **"Who's in?"**. **If `addedFriends` is empty, this ScrollView renders zero chips — an empty horizontal strip.**
- **Session-name input** (L386–399): rendered ONLY when ≥1 friend selected (`hasSelectedFriends`). Label `collaborations.session_name_label` → "Session name"; placeholder → "e.g. Weekend plans, Date night ideas...".
- **"Start session" button** (L402–419): rendered ONLY when `canCreateSession` (friend selected AND name typed). Label `common:start_session` → "Start session". On press → `createCollaborativeSessionV2`.
- **Created-session cards** (L422–480): rendered ONLY when `createdSessions.length > 0`. Header `collaborations.created_header` → "Created sessions ({{count}})"; each card shows name + stacked participant avatars + a remove (×) button.
- **Pending collaboration invites** (L482–565): loading spinner (`collaborations.loading_invites` → "Loading invites...") then, if `pendingCollabInvites.length > 0`, a "You're invited ({{count}})" section of invite cards with Join/Decline, plus bulk Accept-all/Decline-all when >10.
- **Trip/event chat claims** (L567–608): rendered when `loadingTripChatClaims || pendingTripChatClaims.length > 0`. **Hardcoded English (not i18n):** section label literal `"Your trip and event chats"`, loading literal `"Loading chats…"`, each card sub-line literal `"Join the buyer group chat"`, button literal `"Join chat"`. (🔵 Observation: these four strings bypass i18n — every other string in the file is translated.)
- **Empty state** (L610–622): rendered ONLY when `addedFriends.length === 0` → a `chatbubbles-outline` icon (48px, `gray[300]`) + `collaborations.empty_state` → **"Add friends first — then you can start planning together."**

No illustration beyond the empty-state icon. No "skip" affordance inside the component (the `onSkip` prop is passed `() => {}` at OnboardingFlow.tsx:3179 — a **dead callback**; skipping is driven entirely by the shell footer CTA, see Q5).

### Q2 — What data does it pull / depend on?

| Data | Source | Populated by |
|------|--------|--------------|
| `addedFriends` | Prop from `OnboardingFlow.data.addedFriends` (L3167) | Prior Step 5 `friends_and_pairing` — friends added/invited, or accepted incoming requests (OnboardingFlow.tsx:3105–3151). |
| `initialSessions` / `createdSessions` | Prop `data.createdSessions` (L3168) + local state | Sessions created earlier in this step (restored on back-nav). |
| `pendingCollabInvites` | `useSessionManagement().pendingInvites` via `loadUserSessions()` (L83–86, synced L147–151) | DB `collaboration_invites` where `invited_user_id = me` (real-time INSERT subscription at L122–144). |
| `pendingTripChatClaims` | `usePendingTripChatClaims()` → `messagingService.fetchPendingChatClaims()` (L87–91) | Server: trip/event buyer group chats the user can claim (e.g. bought a ticket pre-account). |
| `userPreferences` | Prop (L3169–3174) | Step 2/4 categories, intents, travelMode, travelTime — passed to session create but **ignored** server-side (see L605–608: the `preferences` param is kept for API compat only). |

**Not static.** The step is data-driven: it reads onboarding `addedFriends`, live `collaboration_invites`, and server-side trip-chat claims. Sessions it creates write to DB `collaboration_sessions` + `session_participants` (+ `pending_session_invites` for phone invites).

### Q3 — Fresh-user reality (no friends, no sessions, no trips, no chats)

For a brand-new user who added no friends in Step 5 and has no invites/sessions/claims, the rendered result is:

- Headline **"Plan something together"** + body **"Start a session with your crew…"** — a promise.
- "Who's in?" label followed by an **empty horizontal chip strip** (no chips, `addedFriends.map` over `[]`).
- Session-name input: **hidden** (`hasSelectedFriends` false).
- Start button: **hidden** (`canCreateSession` false).
- Created-session cards: **hidden** (`createdSessions.length === 0`).
- Invites section: **hidden** after the brief load (`pendingCollabInvites.length === 0`); a momentary "Loading invites..." spinner may flash.
- Trip-chat section: **hidden** (`pendingTripChatClaims.length === 0`).
- Empty state: **shown** → icon + **"Add friends first — then you can start planning together."**

**Net rendered state:** a headline + body promising "plan with your crew," then a "Who's in?" label over **nothing**, then a dead-end empty-state telling the user they should have done something in the previous step. The footer CTA reads **"I'll do this later"** (Q5). This is a **hollow placeholder step** — it promises collaboration but, with no friends, offers zero actionable affordance. **F-3, proven** from the render conditionals at L386 / L402 / L422 / L490 / L567 / L611.

### Q4 — Post-META-ORCH-0929 staleness verdict

META-ORCH-0929 (memory `feedback_collab_deck_lives_in_group_chat.md`) made: Home solo-only forever (no active-session concept), collab decks mount ONLY in `CollabDeckSheet.tsx` from inside a group chat, and invites surface as chat-list rows.

Tracing what this step's "Start session" actually does post-0929:
- `createCollaborativeSessionV2` (useSessionManagement.ts:566) → `createCollaborativeSession` (L305) writes a `collaboration_sessions` row + `session_participants`, and `createPendingSessionInvite` for phone friends. There is **no Home active-session**; the session surfaces as a **group chat row**, and the deck opens via `CollabDeckSheet` mounted in `MessageInterface.tsx` (L2282–2285: `isCollabSessionGroupChat && friend.sessionId` → `<CollabDeckSheet>`).

**Staleness pinpointed in the body copy** (`onboarding.json` `collaborations.body`):
- **"Start a session"** — the word "session" is the pre-0929 mental model (the global active-session concept META-0929 *killed*). Today the durable artifact the user lands in is a **group chat that contains a swipe deck**, not a free-standing "session." The CTA label `common:start_session` → "Start session" carries the same stale frame.
- **"Discover things to do, vote on favorites, and actually make it happen"** — partially accurate: the swipe-and-match deck does exist, but it now lives **inside the group chat** (`CollabDeckSheet`), not as a standalone Home session. "vote on favorites" maps loosely to right-swipe match-quorum, but the copy implies a lightweight poll, not the swipe deck that actually ships.

**Verdict:** the copy is **stale-by-framing**, not catastrophically false. It still promises a real, shipping capability (group decks), but describes it through the pre-0929 "session" lens that no longer matches where the user actually ends up (a group chat). It does NOT describe a pre-0929 "active session on Home" in so many words, so it is not a dead-feature promise — but "Start a session with your crew" undersells/mis-frames the real path (a shared group chat with a swipe deck inside). The fresh-user hollow state (Q3) is the bigger problem than wording.

### Q5 — Step mechanics (skippable? blocking? existing conditional? how substeps sequence)

- **Sequencing** (`useOnboardingStateMachine.ts:11–19`): `STEP_SUBSTEPS` is a static `Record<OnboardingStep, SubStep[]>`. Step 6 = `['collaborations']` (single substep). `goNext()` (L78–110) walks the current step's array, then advances to the next step's first substep. There is **no conditional skip** anywhere in the state machine — Step 4 has a `getStep4Sequence` hook (L67–70) but it currently returns a fixed array (the `manual_location` branch was removed). So the machine has a **precedent for conditional substep sequences** but no live conditional today.
- **The step is fully skippable / non-blocking.** The shell footer CTA for `collaborations` (OnboardingFlow.tsx:2137–2146): `hasActed = data.createdSessions.length > 0 || data.collabActionTaken`. Label = `common:continue` ("Continue") if acted, else `common:ill_do_this_later` ("I'll do this later"). `disabled: false` always; `onPress: () => goNext()`. So a fresh user can always advance with one tap; nothing blocks.
- **No auto-skip / conditional render of the step itself exists.** grep for `collaborations` in OnboardingFlow.tsx returns only: CTA (L2137), friends→addedFriends wiring (L3135), render block (L3163), and keyboard-avoidance toggle (L3226). The step is **always rendered** when reached.
- **Where a hide hook would live:** the cleanest hook is `useOnboardingStateMachine.getSequence` (L73–76) — make Step 6's sequence conditional (return `[]` for Step 6 when no collab context), mirroring the existing `getStep4Sequence` pattern. `goNext`/`goBack` already handle empty-ish sequences via the `idx === -1` guard, but an **empty array** would need handling (an empty Step 6 should make `goNext` from Step 5 land directly on Step 7's first substep). See recommendation (b) for the exact mechanism.

### Q6 — Current real collaboration entry path (post-0929)

The real consumer collab path today:
1. **Add friends** (Connections / onboarding Step 5) → friendship rows.
2. **Start a collab** → creates a `collaboration_sessions` row + participants, which manifests as a **group chat** (with phone invites pending until accepted).
3. **Open the group chat** (Messages) → `MessageInterface` detects `isCollabSessionGroupChat` and exposes the deck via **`CollabDeckSheet`** (`MessageInterface.tsx:2282–2285`).
4. **Swipe the shared deck inside that sheet** → right-swipe matches drive the group's plan; dismissed cards show attributed-by-name (per `feedback_collab_deck_determinism_contract.md`). Home stays solo-only.

So onboarding's "Start session" IS a valid entry into this path — it pre-creates the group chat the user later opens. The copy should frame the outcome as "a shared group chat where you swipe together," not a free-standing "session."

---

## 4. Five-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs/Memory** | `feedback_collab_deck_lives_in_group_chat.md`: Home solo-only; decks only in `CollabDeckSheet` from group chat; invites = chat rows. |
| **Schema** | `collaboration_sessions`, `session_participants`, `collaboration_invites`, `pending_session_invites` all still exist and are written by the onboarding step's hooks. The data model is intact — only the *surfacing* moved to group chat. |
| **Code** | OnboardingCollaborationStep renders friend chips/session-create/invites/trip-claims; gates everything except headline+body+empty-state on data presence. CTA never blocks. No conditional step-skip. |
| **Runtime** | Fresh user → empty chip strip + empty-state + "I'll do this later" CTA. Acted user → "Continue". |
| **Data** | `createCollaborativeSessionV2` ignores the passed `userPreferences` (L605–608, by design per ORCH-0446). |

No layer *contradicts* another in a way that breaks function — the divergence is **copy framing vs. surfacing reality**, and **promise vs. fresh-user emptiness**.

---

## 5. Blast radius

- Copy change is i18n-only (`collaborations.headline` + `collaborations.body` + the four hardcoded trip-chat strings if also fixed) across all `locales/*/onboarding.json` — translation fan-out.
- A hide-when-empty change touches `useOnboardingStateMachine.ts` (sequence) + the `progress`/`segmentFill` calc (L150–155, which assumes Step 6 has a substep) + onboarding resume logic (`resumeSubStep`) + any analytics keyed on the `collaborations` step. **Must verify Step 6 progress-bar segment doesn't break when the step is skipped.**
- No admin/business/web surface renders this step — consumer-iOS + consumer-Android only.

---

## 6. RECOMMENDATIONS (for the SPEC — not implemented)

### (a) Reality-matching copy (Mingla experience-app voice, never "dating")

Frame the outcome as a **shared group chat with a swipe-together deck**, not a free-standing "session." Two variants:

**Recommended (always-show teaser-friendly):**
- **Headline:** `Plan it together`
- **Body:** `Pull your crew into a shared chat and swipe through places together — match on what you all love, and turn "where should we go?" into a plan.`

**Tighter alternative:**
- **Headline:** `Bring your people in`
- **Body:** `Start a group chat with friends and swipe through ideas together. When you match, you've got your plan.`

CTA label: replace `common:start_session` "Start session" with something outcome-framed, e.g. **"Start the group"** or **"Create group chat"** (so it matches where the user lands). Keep `common:ill_do_this_later` as the skip CTA. Localize the four hardcoded trip-chat strings while in this file.

> Voice anchor: North Star "the app for when you know the vibe but not the venue" + consumer script "Less Planning. More Living." Avoid "session" (pre-0929 jargon) and any dating framing.

### (b) Hide-when-empty condition + hook point

**Recommended posture: HIDE when there is nothing user-specific AND nothing actionable.** A fresh user with no friends sees only a hollow promise + dead-end empty state, then taps "I'll do this later" — pure friction. Skip it for them. Users who added friends OR have invites/trip-chat claims get the real, populated step.

**Exact condition (compute in OnboardingFlow before sequencing):**
```
hasCollabContext =
  data.addedFriends.length > 0
  || data.createdSessions.length > 0
  || pendingCollabInvites.length > 0      // useSessionManagement.pendingInvites
  || pendingTripChatClaims.length > 0     // usePendingTripChatClaims.claims
```
Hide/skip Step 6 (`collaborations`) when `hasCollabContext === false`.

> **Caveat the SPEC must resolve:** `pendingCollabInvites` and `pendingTripChatClaims` are currently fetched *inside* `OnboardingCollaborationStep` on mount, not in `OnboardingFlow`. To gate the step *before* rendering it, those two reads must be lifted up to `OnboardingFlow` (or a lightweight pre-check) so the skip decision is available at sequencing time. The cheap, safe MVP is to gate on **`addedFriends.length > 0` only** (already in `OnboardingFlow.data`, zero new fetches) — a user with no friends can do nothing here anyway, and invites/claims are rare for a brand-new account mid-onboarding. Recommend: **MVP = gate on `addedFriends.length > 0`; full = add the two server reads lifted to the flow.**

**Where it hooks (file:line):**
- Primary: `app-mobile/src/hooks/useOnboardingStateMachine.ts:73–76` `getSequence` — make Step 6 return `[]` when `!hasCollabContext` (pass the flag in via the hook props, mirroring `hasGpsPermission`). When Step 6's sequence is `[]`, `goNext` from Step 5's last substep must skip to Step 7's first substep (`consent`) — requires teaching `goNext`/`goBack` (L78–144) to skip empty-sequence steps, and `progress` (L150–155) to not count an empty Step 6 segment.
- Alternative (smaller blast radius, no state-machine surgery): keep the static sequence but, in `OnboardingFlow` at the `collaborations` render (L3163) and CTA (L2137), when `!hasCollabContext` **auto-advance** (call `goNext()` in an effect on entry) so the step never visibly mounts. This avoids touching `getSequence`/`progress` math but leaves a no-op step in the sequence (back-nav lands on an auto-skipped step — must guard against a back/forward bounce loop).

**Recommendation:** prefer the `getSequence` approach (clean, matches the `getStep4Sequence` precedent, keeps the progress bar honest); spec must include the empty-sequence `goNext`/`goBack`/`progress` handling + onboarding-resume guard so a resumed user never resumes onto a skipped step.

### Should it always show as a teaser, or only with context?

**Recommendation: HIDE when no context.** A teaser with a dead "Who's in?" strip and an empty-state telling the user to "add friends first" is negative — it advertises a feature the user can't act on and adds a tap. Collaboration discovery is better surfaced *later* (Connections / Messages) once the user has friends. If product wants a teaser, make it a single non-interactive promo card (no empty chip strip, no "add friends first" scold) — but the cleaner call is to skip it for context-less users and let the real entry point (group chat) carry the feature.

---

## 7. Discoveries for orchestrator

- 🔵 Four trip-chat strings in `OnboardingCollaborationStep.tsx` (L569, L573, L588, L602) are hardcoded English, bypassing i18n while every sibling string is translated. Fold into the ORCH-1039 copy pass or register a small i18n cleanup.
- 🔵 `OnboardingCollaborationStep`'s `onSkip` prop is wired to a dead `() => {}` (OnboardingFlow.tsx:3179) — unused; skip is shell-CTA driven. Remove or wire intentionally.
- 🔵 `createCollaborativeSessionV2` accepts `userPreferences` but ignores it (useSessionManagement.ts:605–608, by design per ORCH-0446) — the onboarding step still builds and passes the object (OnboardingFlow.tsx:3169–3174); dead prop plumbing, low priority.

---

## 8. Fix strategy (direction only — not a spec)

1. Rewrite `collaborations.headline` + `collaborations.body` (+ CTA label + the four hardcoded strings) per (a); fan out translations.
2. Add `hasCollabContext` gating per (b) — MVP on `addedFriends.length > 0`, hooking `getSequence` with empty-sequence handling in `goNext`/`goBack`/`progress` + resume guard.
3. Verify progress bar + onboarding resume + analytics behave when Step 6 is skipped (consumer iOS + Android).

**Confidence:** proven for render/data/sequencing facts (source read end-to-end). The hide-condition recommendation is a product call backed by the proven fresh-user hollow-state finding.
