# INVESTIGATION — ORCH-0928 [Friends `+` button chooser sheet — group chat vs add a friend]

**Mode:** INVESTIGATE (code audit, no live-fire sim required per dispatch — UX entry-point routing, not a runtime bug)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0928_FRIENDS_PLUS_BUTTON_CHOOSER.md`

---

## 1. Executive Summary

The "Friends page" in the consumer mobile app is `ConnectionsPage.tsx` (mounted as a tab inside `app-mobile/app/index.tsx`'s `MainAppContent`). The header row has TWO icon buttons in sequence — a people-outline icon (opens the Friends modal) and a `+` glass button. The `+` button today directly opens `PairRequestModal` (a custom bottom-sheet built on the native RN `<Modal>`) via `setShowPairRequestModal(true)`. The collaboration-session creation flow lives in a completely separate component tree — `HomePage.tsx` mounts `GlassSessionSwitcher` whose `+` pill bumps a `createTriggerNonce` that `CollaborationSessions.tsx` (in `modalsOnlyMode`) reads to open its own create-session modal. The collab-create flow is not currently reachable from the Friends page, and `PairRequestModal` is only mounted by `ConnectionsPage` (no other consumer). The fix shape is a small chooser sheet inserted between the `+` tap and the existing `PairRequestModal`, with the "Create a group chat" branch triggering the same create-session flow that the home-screen `+` pill triggers — which means the spec must decide HOW the Friends page reaches into that flow (lift the create-session sheet up, broadcast a trigger to a centrally-mounted instance, or accept a new prop chain). No invariants block this; no DEC entries on TopSheet / Pair / Collab restrict it.

## 2. Affected Surfaces

- **Consumer iOS** — in scope (Friends page is `ConnectionsPage.tsx`, mounted in `app-mobile/`)
- **Consumer Android** — in scope (same component)
- **Buyer/anon Web** — NOT in scope (no Friends page on `mingla-business/` buyer routes)
- **Business iOS / Android** — NOT in scope (no Friends page on `mingla-business/`)
- **Admin Web** — NOT in scope (no Friends page on `mingla-admin/`)
- **Business web preview** — NOT in scope (same as Business iOS/Android)

Parity note: Consumer iOS and Consumer Android share the same `ConnectionsPage.tsx` code path. Any change ships to both simultaneously — no manual parity SCs required.

---

## 3. Findings

### 🔴 Finding 1 — `+` button location and current onPress (Root Cause / current contract)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/ConnectionsPage.tsx:2891-2905` |
| **Exact code** | `<Pressable onPress={() => { HapticFeedback.light(); setShowPairRequestModal(true); }} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }} accessibilityRole="button" accessibilityLabel="Pair with a friend" style={({ pressed }) => [styles.addButtonGlass, pressed ? { transform: [{ scale: 0.96 }] } : null]}><Icon name="add" size={20} color="#FFFFFF" /></Pressable>` |
| **What it does today** | Fires light haptic + sets local state `showPairRequestModal=true`, which mounts `<PairRequestModal visible={showPairRequestModal} onClose={() => setShowPairRequestModal(false)} ... />` at line 3389-3399 |
| **What user sees today** | "Pair with someone" bottom sheet (PairRequestModal) slides up with two sections: Friends list (Tier 1 pair) and Phone-by-number (Tier 2/3 pair) |
| **Why it matters** | This is the EXACT button the spec must re-wire. The accessibility label "Pair with a friend" is now misleading for the new behaviour and will need updating. The state `showPairRequestModal` becomes the "Add a friend" branch's state in the new design; a new state (e.g. `showFriendsChooserSheet`) becomes the entry chooser's gate. |
| **Confidence** | High — direct read of source; only one `+` button on the Friends header (the other Pressable at line 2874-2889 is the people-outline icon that opens the existing Friends modal). |

Adjacent context worth noting for SPEC:
- The header row already has 2 affordances side-by-side (people-outline at line 2874, `+` at line 2891). The chooser introduces a third intent without changing the number of header buttons — only the `+` behaviour changes.
- `openFriendsModal()` at line 1093-1099 is the OTHER button's handler. It is NOT involved in the pair flow today and stays untouched.
- Imports already include `PairRequestModal` (line 72) and `usePairings` hooks (line 74) — those stay.

### 🔴 Finding 2 — Current `PairRequestModal` flow (Root Cause / "Add a friend" target)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/PairRequestModal.tsx:1-861` (entire file is the sheet) |
| **Exact code** | Component signature at `PairRequestModal.tsx:88-93`: `export default function PairRequestModal({ visible, onClose, onPairRequestSent, onPairingLimitReached })` |
| **What it does today** | Renders a native RN `<Modal animationType="slide" transparent>` (line 293) styled as a 85%-max-height bottom sheet with a drag handle. Two sections: (Section 1, line 333-470) friends list with "Pair" buttons calling `sendPairRequest.mutateAsync({ friendUserId })` via the `useSendPairRequest()` hook (line 99, 162-181); (Section 2, line 472-583) phone-by-number input with `usePhoneLookup` debounced search + `createPendingInvite` + `sendPairRequest.mutateAsync({ phoneE164 })` for Tier 2/3 (line 183-249). |
| **What user sees today** | Bottom sheet titled "Pair with someone" (i18n key `social:pairWithSomeone`, line 319) with drag handle, two sections, close X in header. Tapping "Pair" on a friend fires a pair request; entering a phone fires lookup → either pair-or-invite. |
| **Why it matters** | This sheet IS the "Add a friend" branch in the new design per operator intent. **No behavior change required to this sheet.** Spec can leave it 100% intact; only the entry-point label/trigger changes. The sheet's `visible` prop and `onClose`/`onPairRequestSent`/`onPairingLimitReached` callbacks are the integration contract — the chooser sheet's "Add a friend" option simply needs to set the same `showPairRequestModal=true`. |
| **Confidence** | High — full file read; entry contract is the 4-prop interface above. |

Sheet primitive note: `PairRequestModal` uses native RN `<Modal>` directly — NOT the shared `TopSheet` primitive (DEC-080 / DEC-152). So the chooser sheet is not constrained by the TopSheet-consumer cap.

### 🔴 Finding 3 — Current collaboration-session creation flow ("Create a group chat" target)

The collab-create flow is split across THREE files today:

**(a) Entry-point button: `app-mobile/src/components/HomePage.tsx:269-308`** — `GlassSessionSwitcher` is rendered inside the floating glass top-bar with an `onCreate` callback at line 299-305 that bumps `createTriggerNonce` (state declared at line 127: `const [createTriggerNonce, setCreateTriggerNonce] = useState<number>(0);`).

**(b) Modal host: `app-mobile/src/components/HomePage.tsx:324-349`** — `<CollaborationSessions ... modalsOnlyMode createTriggerNonce={createTriggerNonce} />` is mounted to render ONLY its create / invite / session-view / paywall modals (the pill bar is suppressed because GlassSessionSwitcher above renders the pills).

**(c) Modal body + creation: `app-mobile/src/components/CollaborationSessions.tsx:228-242`** — A `useEffect` watches `createTriggerNonce`; when it changes (and is truthy, per the ORCH-0610 guard), it fires `HapticFeedback.buttonPress()`, checks the tier gate via `useSessionCreationGate()`, and either opens the paywall (line 238) or sets `showCreateModal=true` (line 241). The create modal collects `newSessionName` + `selectedFriends` + `phoneInvitees`, then on submit calls `onCreateSession(newSessionName.trim(), selectedFriends, phoneInvitees)` at line 391. The `onCreateSession` prop signature is `(sessionName: string, selectedFriends: Friend[], phoneInvitees?: { phoneE164: string }[]) => void` (line 88).

**The actual session-row insert** is performed by the prop chain's owner (one level above HomePage). The trace stops at HomePage's `onCreateSession` prop — that prop is fed from `app/index.tsx` / `RecommendationsContext` and ultimately hits `boardSessionService.ts` / `collaboration_sessions` table insert. The investigator did not trace deeper because the spec only needs to KNOW that the flow is owned by the same component tree HomePage already wires — the implementor will follow `onCreateSession` upward when implementing.

| Field | Evidence |
|---|---|
| **File + line** | `HomePage.tsx:127` (state), `HomePage.tsx:299-305` (trigger), `HomePage.tsx:324-349` (modal host), `CollaborationSessions.tsx:232-242` (nonce listener), `CollaborationSessions.tsx:391` (onCreateSession call), `CollaborationSessions.tsx:88` (prop signature) |
| **What it does today** | "+" pill on home top-bar → nonce bump → CollaborationSessions create-modal opens (gated by paywall) → user names the session + picks friends + optional phone invites → `onCreateSession(name, friends, invitees)` propagates up to RecommendationsContext-level handler that performs the insert. |
| **What user sees today** | A modal titled `t('modals:collaboration.create_new_session')` ("Create New Session") with a name input, friends multi-select, phone invite input, and a Create button. |
| **Why it matters for ORCH-0928** | The "Create a group chat" option in the new chooser must reach this exact create-modal. ConnectionsPage is a SIBLING of HomePage inside the tab navigator — it does not own `createTriggerNonce` or the `<CollaborationSessions modalsOnlyMode />` mount. **Three viable routing paths exist for the spec:**<br/>(A) Bump the same `createTriggerNonce` shared via a context/parent state — lift the nonce up to `app/index.tsx` so both HomePage's GlassSessionSwitcher + ConnectionsPage's new chooser write to the same nonce.<br/>(B) Mount a second `<CollaborationSessions modalsOnlyMode />` inside ConnectionsPage with its own local nonce — possible but duplicates state and can confuse the paywall/session-list reads.<br/>(C) Pass a new `onCreateSession` callback prop into ConnectionsPage (the prop ConnectionsPage already accepts at line 260 — already declared as `onCreateSession?: (newSession: any) => void` for ORCH-0666, but this is a "session was created" notification, NOT a "trigger create flow" callback — re-using the name is confusing).<br/>Spec should pick (A) — it's the smallest, mirrors the existing GlassSessionSwitcher integration, and keeps a single CollaborationSessions modal instance authoritative. |
| **Confidence** | High on (a)/(b)/(c) trace; Medium on the recommended routing path — implementor may surface a constraint the spec did not foresee. |

Auth/state dependencies: the create-session flow requires an authenticated user (`useAppStore` user, `useSessionCreationGate` paywall check). `ConnectionsPage` is mounted only when the user is authenticated (same tab navigator as HomePage), so auth/state is satisfied. No new auth gate needed.

### 🟠 Finding 4 — Sheet primitive + 2-option chooser precedent (Contributing Factor / pattern selection)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/ui/` directory listing (no Sheet / BottomSheet / ActionSheet primitive present); `PairRequestModal.tsx:293-595` (native RN `<Modal>` styled as bottom sheet); `CollaborationSessions.tsx:711-723` (native RN `<Modal>` for create-session); `mingla-business/...UniversalCreatorSheet` (TopSheet variant — different codebase, not applicable to consumer Friends page) |
| **What it does today** | The codebase has NO shared "ChooserSheet" or "ActionSheet" primitive. Every sheet is hand-rolled on top of RN `<Modal>` with custom overlay + drag handle + bottom-anchored container. `PairRequestModal` (the sheet we're branching from) uses this exact pattern. |
| **What user sees today** | Each sheet has slightly different visual treatment (PairRequestModal: white background, rounded top corners, drag handle, 85% max height; CollaborationSessions create-modal: similar pattern with different padding). No 2-option vertical chooser pattern exists today. |
| **Why it matters** | The SPEC must define the chooser's visual treatment from scratch. The closest precedent IN-FILE is `PairRequestModal`'s overlay + sheet container (lines 293-316: `<Modal animationType="slide" transparent>` + `<View style={styles.overlay}>` + `<TouchableOpacity style={styles.backdrop}>` + bottom-anchored `<View style={styles.sheet}>` with drag handle). For a 2-option chooser the sheet should be SHORT (not 85% height — closer to 30%) with two large tap targets and a header label + close X. |
| **Confidence** | High on absence of shared primitive; Medium on recommended pattern — SPEC owns the final visual decision (operator confirmed in last turn). |

**Sub-sheet nesting concern (`feedback_rn_sub_sheet_must_render_inside_parent.md`):** if the chooser sheet remains mounted while either of the downstream sheets (`PairRequestModal` for "Add a friend" or `CollaborationSessions`' create-modal for "Create a group chat") opens, the second `<Modal>` will be a sibling of the first at the OS root layer and the SECOND one mounted gets visually blocked (Cycle-13a precedent). **The SPEC must instruct the implementor to dismiss the chooser sheet BEFORE opening the downstream sheet** (set chooser `visible=false` synchronously, then trigger the next sheet). The chooser is a routing sheet — it shouldn't linger. This is the cleanest pattern and avoids the nested-modal rule entirely.

### 🟡 Finding 5 — Solo/collab parity + other entry points (Hidden Flaw / scope confirmation)

| Field | Evidence |
|---|---|
| **File + line** | `grep -rln "PairRequestModal\|showPairRequestModal\|setShowPairRequestModal"` returns ONLY `ConnectionsPage.tsx` and `PairRequestModal.tsx` (the component file itself). |
| **What it shows** | `PairRequestModal` has exactly ONE consumer — `ConnectionsPage.tsx`. No other screen mounts it. |
| **What about OnboardingFriendsAndPairingStep?** | `OnboardingFriendsAndPairingStep.tsx:26-27` imports `useSendPairRequest` directly and calls it inline on pair-pill taps — it does NOT mount `PairRequestModal` and does NOT use a sheet pattern. The onboarding step has its own UI (pair pills with per-friend pair buttons). **It is a different entry surface and is NOT affected by this ORCH.** |
| **What about HomePage / Profile / Discover empty states?** | None of these mount `PairRequestModal`. The only `+` button that opens the pair sheet is the Friends-page `+`. |
| **Solo vs collab parity** | The `+` button on the Friends header is unconditional — it does not branch on solo/collab mode today, and the new chooser should also not branch on mode. The "Create a group chat" option creates a NEW collab session (you start in solo, you tap "+" on Friends, you choose "Create a group chat" → you've now created and entered a collab session). This is consistent with the existing home-screen "+" pill behaviour. No parity gap. |
| **Why it matters** | Confirms the SPEC scope is tightly bounded: ONE entry point changes (ConnectionsPage `+` button), ONE chooser sheet is added, ZERO downstream sheets need modification. Other pair entry points (onboarding) and other session-create entry points (home-screen GlassSessionSwitcher `+` pill) stay completely untouched. |
| **Confidence** | High — comprehensive grep. |

### 🔵 Finding 6 — Invariants and constitutional checks (Observation)

| Check | Result |
|---|---|
| **I-TOPSHEET-CONSUMER-CAP** (`feedback_topsheet_extended_universal_creator.md`) | NOT TRIGGERED. The chooser sheet uses native RN `<Modal>`, not TopSheet. TopSheet stays at 2 consumers (BrandSwitcherSheet + UniversalCreatorSheet — both `mingla-business`, not `app-mobile`). |
| **I-SUB-SHEET-INSIDE-PARENT** (`feedback_rn_sub_sheet_must_render_inside_parent.md`) | AVOIDED IF spec mandates "dismiss chooser before opening downstream sheet" (see Finding 4). If chooser stays mounted underneath PairRequestModal / create-session modal, this rule WOULD be violated and the second modal would render invisible. |
| **I-PROPOSED-J NO_SERVER_SNAPSHOTS_IN_PERSIST** (`feedback_zustand_persist_no_server_snapshots.md`) | NOT TRIGGERED. The chooser holds no server state — only local visibility booleans. |
| **Constitution #1 (no dead taps)** | The two chooser options both have concrete onPress handlers (open PairRequestModal, bump createTriggerNonce). No dead taps. |
| **Constitution #2 (one owner per truth)** | If spec chooses routing path (A) from Finding 3 (lift `createTriggerNonce` to a shared parent), there is still ONE authoritative nonce + ONE `<CollaborationSessions modalsOnlyMode />` mount. No duplicate ownership. |
| **Constitution #8 (subtract before adding)** | The chooser ADDS a layer between `+` and PairRequestModal. The OLD behavior (direct `+` → PairRequestModal) is removed by changing the `+` button's onPress; PairRequestModal itself stays. Net: +1 sheet component, +1 state hook, 0 deletions of meaningful logic. Clean. |
| **ORCH-0902 Collab Deck Determinism Contract** (`feedback_collab_deck_determinism_contract.md`) | NOT TRIGGERED. This ORCH does not touch collab deck behavior, location aggregation, pref minting, or the dismissed-cards sheet. It only changes the ENTRY point that triggers session creation — the create-session logic itself is unchanged. |
| **`accessibilityLabel="Pair with a friend"` on `+` button** (line 2898) | OBSOLETE post-change. SPEC must update to reflect the chooser intent (e.g., "Add friend or start group chat" or whatever final label SPEC picks). |

No invariants block the change. No DEC entries block it. Memory checks all PASS or are non-applicable.

---

## 4. Open Questions for SPEC

1. **Chooser sheet visual treatment + naming.** Operator deferred to SPEC. Recommend: native RN `<Modal>` mirroring `PairRequestModal`'s overlay+sheet pattern, but short (~280pt tall, not 85% screen), title TBD (options: "What do you want to do?", "Start something", or no title), two large vertical option rows with icon + label + chevron. SPEC picks final copy.
2. **Routing pattern for "Create a group chat".** Three options enumerated in Finding 3. Investigator recommends path (A) — lift `createTriggerNonce` to a shared parent (likely `app/index.tsx` MainAppContent) so both HomePage and ConnectionsPage write to it. SPEC must confirm and define the prop chain explicitly.
3. **Accessibility label update for `+` button.** Currently "Pair with a friend" — SPEC must pick the new label that reflects the chooser intent.
4. **Dismiss-then-open ordering for downstream sheets.** SPEC must mandate: setShowChooser(false) FIRST, then on next frame (or via `onClose` callback) setShowPairRequestModal(true) or setCreateTriggerNonce(n+1). This avoids the sub-sheet nesting rule. Recommend a small `useState` + `useEffect` pattern or imperative `setTimeout(_, 0)` — SPEC picks the exact mechanism.
5. **Haptic on chooser open vs option select.** Today the `+` button fires `HapticFeedback.light()`. SPEC should decide whether option-select also fires haptic (recommend: yes, `HapticFeedback.medium()` for clarity).
6. **i18n keys.** Chooser title + option labels need translation keys added to all locale files. SPEC must enumerate the new keys for the implementor.
7. **Should onboarding's pair flow also get the chooser?** Investigator finding: NO. Onboarding pair UI is distinct (pair pills with per-friend buttons, not a sheet). Operator already scoped this ORCH to the Friends-page `+` only. Leaving here as an explicit SPEC confirmation point.

## 5. Invariants in Play

- **I-SUB-SHEET-INSIDE-PARENT** — must be respected by dismissing chooser before opening downstream sheet (Finding 4 + Open Question 4).
- **Constitution #1 (no dead taps)**, **#2 (one owner per truth)**, **#8 (subtract before adding)** — must be preserved by the implementation pattern picked by SPEC.

No new invariants need to be established by this ORCH (the change is small, the patterns are local).

## 6. Confidence Summary

| Area | Confidence | Notes |
|---|---|---|
| `+` button location and current handler | **High** | Direct source read; verbatim quoted. |
| `PairRequestModal` contract | **High** | Full file read; 4-prop interface. |
| Collab-create entry-point trace | **High** through `CollaborationSessions.tsx:391`; **Medium** above HomePage's `onCreateSession` prop (not traced into RecommendationsContext / boardSessionService — out of scope for this investigation, implementor will follow prop chain). |
| Sheet primitive landscape | **High** — no shared primitive; all sheets hand-rolled on RN `<Modal>`. |
| Solo/collab parity + other entry points | **High** — comprehensive grep. |
| Invariant + constitutional checks | **High** — read INVARIANT_REGISTRY + 4 named memory files. |
| Recommended routing path for collab-create reach | **Medium** — three options enumerated, one recommended, but implementor may surface a constraint that flips the choice. SPEC should re-confirm during Phase 3. |

**Overall verdict:** root cause / current contract **proven** with six-field evidence on Findings 1, 2, 3, 5. Fix shape is bounded, low-risk, and ships to two surfaces (iOS + Android) via one file (ConnectionsPage) plus a new chooser sheet component and (if path A) a small lift of `createTriggerNonce`. No live-fire sim required at this phase — the investigation is code-trace + contract mapping, not a runtime bug.

---

## Discoveries for Orchestrator

- **DISC-0928-A** — `ConnectionsPage.tsx` already declares an `onCreateSession?: (newSession: any) => void` prop (line 260) marked `ORCH-0666` — this is a "session was created" NOTIFICATION callback for refreshing the session list, NOT a "trigger create flow" callback. The SPEC must NOT re-use the name `onCreateSession` for the new trigger to avoid confusion. Recommend `onOpenCreateSessionFlow` or `onTriggerCreateSession`. Worth a feedback memory entry if the same naming collision shows up in future ORCHs.
- **DISC-0928-B** — `accessibilityLabel="Pair with a friend"` on the `+` button (line 2898) is the only label change required. The OLD label is a literal string, not an i18n key — SPEC should consider whether to add an i18n key as part of this change or accept a second literal string (consistency-wise, prefer i18n key).
- **DISC-0928-C** — `PairRequestModal`'s header literal `t('social:pairWithSomeone')` already exists in all locale files — no i18n work needed for the "Add a friend" downstream sheet. Only the chooser's new keys need locales backfilled.
- **DISC-0928-D** — `HomePage.tsx:299-305` `onCreate` callback is undefined-guarded (`onCreateSession ? () => {...} : undefined`). If the SPEC lifts `createTriggerNonce` to a shared parent, the same guard must apply to the Friends-page chooser — if collab create is unavailable for some reason (e.g., user signed out mid-render), the "Create a group chat" option should either be disabled or hidden, not a dead tap. SPEC should specify this edge case.

---

**Pipeline next:** Claude `mingla-forensics` SPEC (same skill, same session) consuming this investigation; then Codex `implementor-mingla`; then Claude `mingla-tester`; then orchestrator CLOSE.
