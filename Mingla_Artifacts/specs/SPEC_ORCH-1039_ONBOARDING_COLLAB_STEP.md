# SPEC — ORCH-1039 [Onboarding collaboration step — reality copy + conditional-hide]

**Mode:** SPEC (contract only — no implementation)
**Date:** 2026-06-01
**Amended:** 2026-06-01 (post-IMPLEMENT) to record the OPERATOR-LOCKED overrides that supersede the original MVP-primary contract. Two deltas vs. the original SPEC: (1) the EN copy was finalized to the "start-or-join" wording below (the body now covers BOTH paths — start a new group AND join an existing invite/chat/trip); (2) the hide condition is the **FULLER** four-signal condition, NOT the MVP `addedFriends`-only gate. These were chosen by the operator at dispatch. Sections 3.1.a, 3.3, 3.5, §5.2/§5.4 below are updated to the as-shipped contract; the original MVP framing is retained inline as struck/superseded context.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1039-[onboarding-collab-step-reality]/` on branch `ORCH-1039-onboarding-collab-step-reality`
**Surface:** Consumer app (`app-mobile/`), iOS + Android ONLY
**Source investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1039_ONBOARDING_COLLAB_STEP_REALITY.md` (root cause **proven**)
**Comms ledger:** read on entry. No `BLOCK`/`OPEN` row targets ORCH-1039 or `mingla-forensics`. COMMS-0003 (external-API docs-cite) is `N/A` — this ORCH touches no external API. No new entry needed.

---

## 0. One-paragraph summary

Two proven problems in onboarding **Step 6 (`subStep === 'collaborations'`)**: (1) the copy ("Plan something together" / "Start a session with your crew…" / CTA "Start session") frames the flow through the pre-META-ORCH-0929 "active session" model, which no longer matches reality — the real path is *friends → shared group chat → swipe-together `CollabDeckSheet` opened from Messages*; (2) a fresh user with no friends sees a hollow placeholder (a "Who's in?" label over an empty chip strip + a dead-end "Add friends first" scold). This spec (a) rewrites the copy across all 29 locale `onboarding.json` files + the CTA label to describe the real group-chat-with-swipe-deck outcome in Mingla's experience-app voice (never dating); (b) hides Step 6 entirely when there is no collaboration context (MVP: `addedFriends.length === 0`) by making `getSequence` return `[]` for Step 6, with the necessary `goNext`/`goBack`/`progress`/resume handling so the flow stays correct; (c) localizes the four hardcoded trip-chat strings and removes the dead `onSkip` callback. No DB, edge, service, hook-data, or visual-surface changes. No designer pass required (pure copy + sequence logic).

---

## 1. Scope

**In scope:**

1. **Copy rewrite** of `collaborations.headline`, `collaborations.body`, and the create-session CTA label, fanned out across **all 29** `app-mobile/src/i18n/locales/*/onboarding.json` files. The CTA gets a new locale key inside the `collaborations` block (`start_button`) instead of reusing `common:start_session`.
2. **Localize** the four currently-hardcoded English trip-chat strings in `OnboardingCollaborationStep.tsx` (L569, L573, L587, L602) into the `collaborations` block, fanned out across all 29 locales.
3. **Hide-when-empty gate** for Step 6: when there is no collaboration context, Step 6 is skipped — not shown as a teaser. Implemented in `useOnboardingStateMachine.ts` `getSequence`, with correct `goNext`/`goBack`/`progress` handling for an empty-sequence step, plus an onboarding-resume guard so a resumed user never lands on a skipped step.
4. **Remove the dead `onSkip` prop** (`() => {}` at OnboardingFlow.tsx:3179 + the prop in `OnboardingCollaborationStep`'s interface/destructure) — it is unused (skip is shell-CTA driven).
5. **Tests:** Step-0.5 implementor happy-path test (state-machine) + tester adversarial test (resume + back-nav across the skipped step), both fail-on-revert.

**Non-goals (explicit):**

- **No change to the populated visual surface** of `OnboardingCollaborationStep` (chips, session-name input, create button, created-session cards, invites, trip-claim cards). Only string values + the skipped-when-empty behavior change. → therefore **no `mingla-designer` pass** (§9).
- **No DB / migration / RLS / edge-function / service / data-fetch changes.** `createCollaborativeSessionV2`, `collaboration_sessions`, `collaboration_invites`, `usePendingTripChatClaims` are untouched.
- **No change to the "I'll do this later" / "Continue" shell footer logic** (OnboardingFlow.tsx:2137–2146) beyond it never being reached when Step 6 is skipped.
- ~~**MVP hide condition = `addedFriends.length > 0` only.**~~ **SUPERSEDED by operator override:** the FULLER four-signal condition shipped (`addedFriends || createdSessions || pendingCollabInvites || pendingTripChatClaims`), which DID require lifting the two server reads up to `OnboardingFlow` — that lift is now IN scope and shipped (§3.3 / §5.4). The lifted reads are non-blocking with a safe-path default while loading.
- **No `userPreferences` dead-prop cleanup** (investigation Discovery #3) — out of scope, low priority, register separately if desired.
- **No analytics-key changes.** The existing `onboarding_step_completed` / `trackOnboardingStepViewed` events (OnboardingFlow.tsx:748–766) fire on step transitions; when Step 6 is skipped, the user transitions 5→7 and the events fire for the steps actually visited. No new event is required; §5.5 documents the resulting analytics behavior so it is not mistaken for a regression.

**Assumptions:**

- The progress bar is a **fixed 7-segment** `SegmentedProgressBar` (`totalSegments={7}`, `currentStep={navState.step}`, OnboardingShell.tsx:279–283). There is **no "step N of M" text label** anywhere in onboarding. Segment `i` fills when `i < currentStep` (SegmentedProgressBar.tsx:29). **Proven** by reading both files. This is load-bearing for the parity criterion (§6, SC-5).
- `addedFriends` is already present in `OnboardingFlow.data` (`OnboardingData.addedFriends`, default `[]`) and in persisted/restored onboarding data (`useOnboardingResume` BASE_INITIAL_DATA:63). It requires zero new fetch to read at sequencing time.

---

## 2. Cross-Surface Impact (MANDATORY)

| # | Surface | Covered? | Behavior / files / parity |
|---|---------|----------|---------------------------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | ✅ YES | New copy renders in Step 6; Step 6 skipped when `addedFriends.length === 0`. Files: `i18n/locales/*/onboarding.json`, `OnboardingCollaborationStep.tsx`, `useOnboardingStateMachine.ts`, `OnboardingFlow.tsx`. Parity with Android is **automatic** (single shared RN code path). |
| 2 | **Consumer Android** (`app-mobile/` Android) | ✅ YES | Identical to iOS — same shared code. Parity automatic. Tester MUST still confirm on Android emulator (memory `feedback_sim_boot_blocker_must_resolve_not_note.md`) because the back-nav / resume edge cases are runtime behaviors, not pure-string. |
| 3 | **Buyer/anonymous Web** (`mingla-business/`) | ❌ NO | Onboarding does not exist on the buyer-web surface — no analog renders this step. |
| 4 | **Business iOS** (`mingla-business/` iOS) | ❌ NO | Business app has its own onboarding; the consumer collaboration step does not exist there. |
| 5 | **Business Android** (`mingla-business/` Android) | ❌ NO | Same as #4. |
| 6 | **Admin Web** (`mingla-admin/`) | ❌ NO | Admin does not render consumer onboarding. |
| 7 | **Business Web preview** (`mingla-business/` dev/web) | ❌ NO | Same as #3/#4. |

Parity across the two covered surfaces (iOS + Android) is automatic (shared code), so a single set of success criteria applies — except SC-1.5 / SC-2 / SC-3 (runtime sequencing + back-nav + resume) which the tester MUST verify on **both** an iOS simulator and an Android emulator (stated per-platform in §6).

---

## 3. Layer-by-layer contract

### 3.1 i18n layer — copy rewrite (🔒 LOCKED values; operator may tweak EN wording before merge)

**File set:** `app-mobile/src/i18n/locales/<lang>/onboarding.json` for **all 29** languages:
`ar, bin, bn, de, el, en, es, fr, ha, he, hi, id, ig, it, ja, ko, ms, nl, pl, pt, ro, ru, sv, th, tr, uk, vi, yo, zh`.

**3.1.a — English (`en/onboarding.json`) `collaborations` block.** Replace the three string values below; ADD the two new keys (`start_button`, plus the four trip-chat keys in §3.1.c). Keep every other key as-is.

```jsonc
"collaborations": {
  "headline": "Plan it together",                                    // 🔒 LOCKED final — was: "Plan something together"
  "body": "Start a group with your crew, or jump into a chat or trip you're already invited to.",  // 🔒 LOCKED final (operator) — covers BOTH paths: start a new group AND join an existing invite/chat/trip. Was: "Start a session with your crew. Discover things to do, vote on favorites, and actually make it happen."
  "whos_in": "Who's in?",                                            // UNCHANGED
  "session_name_label": "Session name",                              // UNCHANGED (see note below)
  "session_name_placeholder": "e.g. Weekend plans, Date night ideas...",  // UNCHANGED
  "start_button": "Start the group",                                 // 🔒 LOCKED final — NEW key (replaces common:start_session usage; see §3.2)
  "created_header": "Created sessions ({{count}})",                  // UNCHANGED
  "loading_invites": "Loading invites...",                           // UNCHANGED
  "invited_header": "You're invited ({{count}})",                    // UNCHANGED
  "inviter_message": "{{name}} invited you",                         // UNCHANGED
  "fallback_someone": "Someone",                                     // UNCHANGED
  "fallback_session": "Session",                                     // UNCHANGED
  "name_taken_error": "That name's taken. Get creative!",            // UNCHANGED
  "generic_error": "Hmm, that didn't work. Give it another go.",     // UNCHANGED
  "join_error": "Could not join session",                            // UNCHANGED
  "decline_error": "Could not decline invite",                       // UNCHANGED
  "empty_state": "Add friends first — then you can start planning together.",  // UNCHANGED (only ever rendered when addedFriends===0; with the hide gate, the step never mounts in that state — see §5.6)
  "trip_chats_header": "Your trip and event chats",                  // NEW (§3.1.c)
  "trip_chats_loading": "Loading chats…",                            // NEW (§3.1.c)
  "trip_chats_join_subtitle": "Join the buyer group chat",           // NEW (§3.1.c)
  "trip_chats_join_button": "Join chat"                              // NEW (§3.1.c)
}
```

**3.1.b — Copy contract notes (🔒 LOCKED intent, 🎨 OPEN exact EN wording pre-merge):**

- **Voice:** Mingla experience-app voice. North Star anchor: "the app for when you know the vibe but not the venue" + consumer script "Less Planning. More Living." **NEVER dating-app framing.** The body deliberately uses the group/crew/plan vocabulary, not romantic framing.
- **Reality match (the whole point of this ORCH):** the copy MUST describe the REAL post-0929 path — *a shared group chat where you swipe through places together and match*, NOT a free-standing "active session." The word **"session"** is the pre-0929 mental model and must NOT appear in `headline` or `body`. (It survives only in the UNCHANGED internal keys `session_name_label`, `created_header`, `fallback_session` because those label the create-form/created-list, which the implementor is NOT asked to touch in this pass — see §3.1.d.)
- **CTA reframe:** the create button label moves from the generic `common:start_session` ("Start session") to the outcome-framed `collaborations.start_button` ("Start the group"). Operator-approved alternative: "Create group chat". The implementor uses whichever EN string the operator locks; default = "Start the group".
- **Skip CTA UNCHANGED:** the shell footer keeps `common:ill_do_this_later` ("I'll do this later") and `common:continue` ("Continue"). Do NOT touch `common.json`.

**3.1.c — Localize the four hardcoded trip-chat strings.** These are added as the four NEW keys above and consumed in §3.4. The English values exactly preserve the current literals (`"Your trip and event chats"`, `"Loading chats…"` — note the ellipsis character `…` U+2026, `"Join the buyer group chat"`, `"Join chat"`).

**3.1.d — Translation fan-out rule (🔒 LOCKED):** For each of the 28 non-English locales, set `headline`, `body`, `start_button`, `trip_chats_header`, `trip_chats_loading`, `trip_chats_join_subtitle`, `trip_chats_join_button` to a faithful, natural translation of the new English copy in that language's register (NOT a literal word-for-word calque; match the existing tone of each file's neighboring strings). For the 6 locales currently carrying an English fallback for `headline` (`pl, ro, ru, sv, tr, uk` — proven via JSON scan), the implementor still writes the proper translation for the new values (do not perpetuate the English fallback). The implementor MUST keep valid JSON (escaped quotes inside `body`), preserve key ordering convention, and run `node -e "require('./<file>')"` (or `python3 -c "import json,json.load"`) on every edited file to confirm parse-validity. **`whos_in` and the create-form keys are NOT re-translated** (unchanged).

**3.1.e — i18n LOCKED/OPEN:** 🔒 LOCKED = the set of keys to add/change, the no-"session"-in-headline/body rule, no-dating rule, JSON validity, all 29 locales covered. 🎨 OPEN = the exact natural-language wording of each translation (translator's craft within the locked intent), and the operator's final EN wording for `headline`/`body`/`start_button`.

### 3.2 Component layer — `OnboardingCollaborationStep.tsx` (CTA key swap + remove dead prop)

**File:** `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx`

- **L412 (🔒 LOCKED):** change `t('common:start_session')` → `t('onboarding:collaborations.start_button')`. (The `useTranslation(['onboarding', 'common'])` call at L57 already loads the `onboarding` namespace — no import change.)
- **`onSkip` removal (🔒 LOCKED):** remove `onSkip: () => void` from `OnboardingCollaborationStepProps` (L44), remove `onSkip` from the destructured params (L54), and confirm it is referenced nowhere else in the file (it is not — grep `onSkip` in the file returns only the interface + destructure). This is a pure dead-code removal.
- No other changes to this file's logic, layout, styles, hooks, or data fetches.

### 3.3 Component layer — `OnboardingFlow.tsx` (remove dead `onSkip` wire + pass hide flag context)

**File:** `app-mobile/src/components/OnboardingFlow.tsx`

- **L3179 (🔒 LOCKED):** remove the `onSkip={() => {}}` prop from the `<OnboardingCollaborationStep />` render block (paired with §3.2's interface removal).
- **Hide-gate wiring (🔒 LOCKED — FULLER condition, operator override).** Pass a `hasCollabContext` boolean into `useOnboardingStateMachine` (§3.5). The condition ORs all four collaboration signals (NOT the original MVP `addedFriends`-only gate):
  ```ts
  // FULLER hide condition — show Step 6 only when the user has SOMETHING to act on.
  // Lifts the invite + trip-claim reads (previously inside OnboardingCollaborationStep)
  // up to the flow so the gate is evaluable BEFORE the step renders.
  const { pendingInvites, loadUserSessions } = useSessionManagement()
  const { claims: tripChatClaims, loading: tripClaimsLoading } = usePendingTripChatClaims()
  // useSessionManagement does not auto-load invites → kick it once + track first-load.
  const [invitesFirstLoadDone, setInvitesFirstLoadDone] = useState(false)
  useEffect(() => { loadUserSessions().finally(() => setInvitesFirstLoadDone(true)) /* +10s safety */ }, [loadUserSessions])
  const hasCollabContext = useMemo(() => (
    data.addedFriends.length > 0
    || data.createdSessions.length > 0
    || (pendingInvites?.length ?? 0) > 0
    || tripChatClaims.length > 0
    // Safe path: while server reads are resolving, keep the step eligible so we
    // never flash-then-yank it. Non-blocking — onboarding never stalls on these.
    || (!invitesFirstLoadDone || tripClaimsLoading)
  ), [data.addedFriends.length, data.createdSessions.length, pendingInvites, tripChatClaims.length, invitesFirstLoadDone, tripClaimsLoading])
  ```
  Place near the existing `hasGpsPermission` state (≈L722) and pass through to the hook (§3.5). `data.addedFriends`/`createdSessions` are synchronous local data so the common "fresh user, no friends" case resolves to hidden instantly; the two server reads are non-blocking and default to the safe (step-eligible) path while loading so no flash-then-yank occurs.

  > **Superseded MVP framing (original SPEC):** the original contract gated on `data.addedFriends.length > 0` ONLY, deferring the invite/claim reads as an optional §5.4 extension to keep blast radius low. The operator chose the FULLER condition at dispatch, which is what shipped — the two reads ARE lifted to the flow.

### 3.4 Component layer — trip-chat string consumption (`OnboardingCollaborationStep.tsx`)

**File:** `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` (🔒 LOCKED)

- L569 `Your trip and event chats` → `{t('onboarding:collaborations.trip_chats_header')}`
- L573 `Loading chats…` → `{t('onboarding:collaborations.trip_chats_loading')}`
- L587 `Join the buyer group chat` → `{t('onboarding:collaborations.trip_chats_join_subtitle')}`
- L602 `Join chat` → `{t('onboarding:collaborations.trip_chats_join_button')}`

### 3.5 State-machine layer — `useOnboardingStateMachine.ts` (the hide gate)

**File:** `app-mobile/src/hooks/useOnboardingStateMachine.ts`

This is the heart of the gate. Four edits, all 🔒 LOCKED. The existing code is the authoritative current state (read in full, 166 lines).

**(1) Props — accept `hasCollabContext`:**
```ts
interface UseOnboardingStateMachineProps {
  initialStep?: OnboardingStep
  hasGpsPermission: boolean
  hasCollabContext: boolean   // NEW: false ⇒ Step 6 (collaborations) is skipped
}
```
Destructure it in the hook signature (≈L35–38).

**(2) `getSequence` — return `[]` for Step 6 when no context:**
```ts
const getSequence = useCallback((step: OnboardingStep): SubStep[] => {
  if (step === 4) return getStep4Sequence()
  if (step === 6 && !hasCollabContext) return []   // NEW: skip the collaborations step
  return STEP_SUBSTEPS[step]
}, [getStep4Sequence, hasCollabContext])
```
This mirrors the existing `getStep4Sequence` precedent (conditional substep sequencing already exists in this hook).

**(3) `goNext` — skip empty-sequence steps when advancing.** The current `goNext` (L78–110) advances to `getSequence(prev.step + 1)[0]`. If that next step's sequence is `[]`, `nextSeq[0]` is `undefined` → a broken `subStep`. Teach the "advance to next step" branch (L97–105) to **skip forward over any empty-sequence step** until it finds a non-empty one (or hits launch):
```ts
// At end of step — advance to the next step that HAS a sequence.
let nextStep = (prev.step + 1) as OnboardingStep
while (nextStep <= 7 && getSequence(nextStep).length === 0) {
  nextStep = (nextStep + 1) as OnboardingStep
}
if (nextStep <= 7) {
  const nextSeq = getSequence(nextStep)
  const next = { step: nextStep, subStep: nextSeq[0] }
  logger.onboarding(`goNext: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
  setState(next)
  return
}
// No remaining non-empty step — trigger launch (end of Step 7 reached or skipped past it)
logger.onboarding('LAUNCH triggered (no further non-empty step)')
setIsLaunch(true)
```
This replaces the current L98–109 block. (With the MVP condition only Step 6 can be empty, so this loop skips at most one step; the loop form is future-proof and correct regardless.)

**(4) `goBack` — skip empty-sequence steps when retreating.** The current `goBack` (L113–144) at the start of a step goes to `getSequence(prev.step - 1)[last]`. If that previous step's sequence is `[]` (e.g. user on Step 7/consent presses Back, Step 6 is empty), `prevSeq[prevSeq.length - 1]` is `undefined`. Teach the "go to previous step" branch (L132–139) to **skip backward over empty-sequence steps**:
```ts
// At start of step — go back to the previous step that HAS a sequence.
let prevStep = (prev.step - 1) as OnboardingStep
while (prevStep >= 1 && getSequence(prevStep).length === 0) {
  prevStep = (prevStep - 1) as OnboardingStep
}
if (prevStep >= 1) {
  const prevSeq = getSequence(prevStep)
  const next = { step: prevStep, subStep: prevSeq[prevSeq.length - 1] }
  logger.onboarding(`goBack: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
  setState(next)
  return
}
// At the earliest non-empty step — no-op (existing Step-1 behavior preserved)
logger.onboarding(`goBack: already at earliest step — no-op`)
```
This replaces the current L132–143 block.

**(5) `progress` — unchanged, but verified safe.** `progress` (L150–155) computes `segmentFill` from `getSequence(state.step)`. The hook NEVER sets `state.step` to a step whose sequence is `[]` (goNext/goBack both skip empty steps, and `initialStep`/resume are guarded in §3.6). Therefore `seq` is always non-empty for the current `state.step`, `idx` is valid, and `segmentFill` is correct. **No change to `progress` is required** — but the implementor MUST add a defensive guard comment and an `idx === -1 || seq.length === 0 ⇒ segmentFill = 1` fallback so a future regression can't divide by an empty sequence:
```ts
const progress = useMemo(() => {
  const seq = getSequence(state.step)
  const idx = seq.indexOf(state.subStep)
  // Guard: an empty/uninitialized sequence (should never be the CURRENT step — see goNext/goBack
  // skip-empty logic + §3.6 resume guard) yields a full segment rather than NaN.
  const segmentFill = seq.length > 1 ? (idx + 1) / seq.length : 1
  return { step: state.step, segmentFill }
}, [state, getSequence])
```
(The existing ternary already yields `1` for `seq.length <= 1`, so an empty `seq` returns `1` — safe. The added comment is the regression-prevention artifact required by §8.)

**Progress-bar note (proven, load-bearing):** the `OnboardingShell` progress bar is a fixed 7-segment bar keyed off `navState.step` (the raw 1-7 step number), NOT off the dynamic sequence length. When Step 6 is skipped, the user goes from `step:5` to `step:7`; segment 6 (`i=6 < currentStep=7`) renders as **completed/filled** automatically (SegmentedProgressBar.tsx:29). So the bar correctly shows 6 segments filled while on Step 7 — it never shows a half-empty or stuck segment. **No change to OnboardingShell or SegmentedProgressBar is needed**, and the "total stays correct" parity criterion (SC-5) is satisfied by the fixed-7 design. There is no "step N of M" text to keep in sync.

### 3.6 Resume layer — `useOnboardingResume.ts` + `OnboardingFlow.tsx` resume guard

**Problem (proven edge case):** `useOnboardingResume` resumes at `profile.onboarding_step` (1–7). The hook sets `state.subStep = STEP_SUBSTEPS[initialStep][0]` (useOnboardingStateMachine.ts:41 + 63). If a user is persisted at `onboarding_step === 6` but `hasCollabContext === false` (no friends — e.g. they reached Step 6, killed the app, relaunched), `STEP_SUBSTEPS[6][0]` is `'collaborations'` and the static initial-state set bypasses `getSequence`. The user would resume directly onto the step that should be hidden, rendering the hollow placeholder this ORCH exists to remove.

**Fix (🔒 LOCKED) — guard at the state-machine initial-state computation.** Two coordinated edits:

- **`useOnboardingStateMachine.ts` initial state + initialStep-sync (L39–42 and L60–64):** compute the initial subStep through a normalizer that skips an empty Step-6 sequence forward to Step 7's first substep. Replace the two `STEP_SUBSTEPS[initialStep][0]` literals with a helper:
  ```ts
  // Resolve the entry step+subStep, skipping any step whose conditional sequence is empty
  // (e.g. Step 6 collaborations when hasCollabContext is false). Mirrors goNext's skip-empty logic
  // so a resumed user never lands on a hidden step.
  const resolveEntry = useCallback((step: OnboardingStep): OnboardingNavState => {
    let s = step
    while (s <= 7 && getSequence(s).length === 0) {
      s = (s + 1) as OnboardingStep
    }
    if (s > 7) s = 7  // defensive: never past the last step
    const seq = getSequence(s)
    return { step: s, subStep: seq[0] }
  }, [getSequence])
  ```
  Use `resolveEntry(initialStep)` for both the `useState` initializer (L39–42) and the `appliedInitialStep`-change `setState` (L63). Because `getSequence` depends on `hasCollabContext`, `resolveEntry` must be defined after `getSequence`; the `useState` initializer can call it via a lazy initializer (`useState(() => resolveEntry(initialStep))`) OR the implementor keeps the existing static initializer and relies solely on the `appliedInitialStep` effect — **but the lazy-initializer form is REQUIRED** so that a step-6 resume with no context never paints the hidden step even for one frame.

- **`OnboardingFlow.tsx` resume-subStep jump (L786–792):** the one-shot resume effect calls `goToSubStep(resumeSubStep)` when the loader returns a `resumeSubStep`. `resumeSubStep` is only ever `'gender_identity'` (useOnboardingResume.ts:114/125) today — never `'collaborations'` — so it does NOT collide with the hide gate. **No change required here**, but the implementor MUST add a one-line protective comment noting that `resumeSubStep` must never be a substep of a conditionally-hidden step, and the tester verifies (§6, SC-3) that the gender_identity resume path is unaffected.

**Net resume contract:** a user persisted at step 6 with no friends resumes onto **Step 7/consent** (skipping the hidden step); a user persisted at step 6 *with* friends resumes onto **Step 6/collaborations** (step shown). A user persisted at the `gender_identity` sub-step resumes there as before.

---

## 4. States (the affected surface) — exact behavior

The `OnboardingCollaborationStep` component's nine UI states are UNCHANGED in structure; only string values change. The behavioral change is at the **flow** level (whether the step mounts at all):

| Condition | Behavior after this spec |
|-----------|--------------------------|
| `addedFriends.length === 0` (fresh user, no friends) | **Step 6 is skipped entirely.** `goNext` from Step 5 lands on Step 7/consent. The hollow placeholder (empty chip strip + "Add friends first") never mounts. Progress bar shows segment 6 as completed when on Step 7. |
| `addedFriends.length > 0`, no sessions/invites/claims yet | Step 6 mounts with NEW copy: headline "Plan it together", body "Pull your crew into a shared chat…", "Who's in?" + friend chips, create button "Start the group" once a friend+name are chosen. Footer CTA "I'll do this later". |
| ≥1 session created or `collabActionTaken` | As above; footer CTA becomes "Continue". |
| Pending invites / trip-chat claims present | Their sections render with the now-localized strings. (Only reachable when `addedFriends.length > 0` under the MVP gate.) |
| Empty-state string (`empty_state`) | Now effectively dead code (only rendered when `addedFriends===0`, which is exactly when the step is skipped). Left in the locale files for safety; §5.6 notes it. |

---

## 5. Decisions & rationale

### 5.1 HIDE, not teaser (operator-aligned)
Per the audit §6 recommendation and the dispatch: **hide** Step 6 for context-less users. A teaser with a dead "Who's in?" strip + an "add friends first" scold advertises a feature the user cannot act on and adds an extra tap. Collaboration is better surfaced later (Connections / Messages) once the user has friends. **LOCKED: hide.**

### 5.2 Gate = FULLER four-signal condition (operator override — SHIPPED)
**As shipped:** `addedFriends.length > 0 || createdSessions.length > 0 || pendingCollabInvites.length > 0 || pendingTripChatClaims.length > 0`. The two server reads (`pendingInvites` from `useSessionManagement`, trip-chat `claims` from `usePendingTripChatClaims`) are LIFTED from inside `OnboardingCollaborationStep` up to `OnboardingFlow` so the gate is evaluable before render. The reads are non-blocking (onboarding never stalls); while loading, the gate defaults to the safe/step-eligible path to avoid flash-then-yank. **LOCKED.**

> ~~**Original MVP gate = `addedFriends.length > 0`** (superseded by the operator override above): zero new fetches; a user with no friends can do nothing actionable in Step 6 regardless of invites/claims.~~

### 5.3 New `collaborations.start_button` key instead of reusing `common:start_session`
`common:start_session` is used ONLY by this step (proven: grep returns a single call site). Moving the label into the `collaborations` block keeps the reframed CTA scoped, avoids editing shared `common.json` across 29 locales (lower blast radius), and lets the CTA wording track the step's copy. **LOCKED.** (`common:start_session` may be left orphaned or removed — leaving it is acceptable and lower-risk; do NOT remove it from other locales' `common.json` to avoid churn.)

### 5.4 Full condition — SHIPPED (was OPTIONAL, promoted by operator override)
The fuller gate described here was promoted from "optional follow-up" to the as-shipped contract by the operator at dispatch. `pendingInvites` (from `useSessionManagement`) and trip-chat `claims` (from `usePendingTripChatClaims`) ARE lifted up to `OnboardingFlow` and OR'd into `hasCollabContext`:
```ts
hasCollabContext =
  data.addedFriends.length > 0
  || data.createdSessions.length > 0
  || pendingCollabInvites.length > 0
  || pendingTripChatClaims.length > 0
  || (collabServerReadsStillLoading)   // safe path, non-blocking
```
The two lifted reads handle their loading state non-blockingly: the gate defaults to step-eligible while loading (no flash-then-yank), and `useSessionManagement` (which does not auto-load) is kicked once via a one-shot effect with a 10s safety release. **SHIPPED in this pass.**

### 5.5 Analytics behavior when Step 6 is skipped (not a regression)
The transition effect (OnboardingFlow.tsx:748–766) fires `onboarding_step_completed` for the step the user leaves and `trackOnboardingStepViewed` for the step they enter. When Step 6 is skipped, the user transitions `step:5 → step:7`, so `onboarding_step_completed{step:5}` fires and `trackOnboardingStepViewed(7)` fires; Step 6 is never "viewed" and never "completed" for context-less users. **This is correct and intended** — it accurately reflects that the user never saw Step 6. Document this in the implementation report so it is not flagged as a missing event.

### 5.6 `empty_state` string becomes dead
With the gate, `addedFriends===0` ⇒ step skipped ⇒ the empty-state block (L611) never renders. Leave the `empty_state` key in all locales (harmless, defensive — the component still references it). Do NOT remove the empty-state JSX from the component (keeps the component self-contained if the gate is ever loosened).

---

## 6. Success criteria (observable, testable, unambiguous)

- **SC-1 (copy reality match):** With ≥1 friend added, Step 6 renders headline = the new "Plan it together" string and body = the new "Pull your crew into a shared chat…" string; neither contains the word "session". The create-session button reads the new `collaborations.start_button` value ("Start the group"). Verified on iOS + Android (shared code → SC-1 covers both).
- **SC-1.5-iOS / SC-1.5-Android (hide gate):** With `addedFriends.length === 0`, advancing past Step 5 lands the user directly on Step 7/consent — Step 6/collaborations never mounts (no "Who's in?" / no empty chip strip / no "Add friends first"). Verified independently on an iOS simulator AND an Android emulator (runtime sequencing).
- **SC-2-iOS / SC-2-Android (back-nav across skip):** From Step 7/consent with no friends, pressing Back lands on Step 5/friends_and_pairing (skipping the hidden Step 6) — never on an empty/blank Step 6. From Step 7 *with* friends, Back lands on Step 6/collaborations. Verified on both platforms.
- **SC-3-iOS / SC-3-Android (resume across skip):** A user persisted at `onboarding_step === 6` with no friends resumes onto Step 7/consent (not the hidden step). A user persisted at step 6 *with* friends resumes onto Step 6. The pre-existing `gender_identity` resume path (phone pre-verified, missing identity) is unaffected. Verified on both platforms.
- **SC-4 (trip-chat localization):** The four trip-chat strings render via i18n keys (not hardcoded English); switching device language to a non-English locale changes them. (Spot-checked on one non-EN locale.)
- **SC-5 (progress bar parity):** The 7-segment progress bar total stays at 7 segments; when Step 6 is skipped, segment 6 shows as completed while the user is on Step 7 (never a stuck/empty current segment). No "step N of M" text exists to drift. `progress.segmentFill` is a valid 0–1 number on every reachable step (never NaN).
- **SC-6 (dead-code removal):** `onSkip` no longer appears in `OnboardingCollaborationStepProps`, in the component destructure, or as a prop at the OnboardingFlow render site; the app compiles (TypeScript) and renders the step unchanged when friends exist.
- **SC-7 (JSON validity + coverage):** All 29 `onboarding.json` files parse as valid JSON and each contains the new keys (`start_button`, `trip_chats_header`, `trip_chats_loading`, `trip_chats_join_subtitle`, `trip_chats_join_button`) with a translated (non-English-fallback) value, and a headline/body that omit "session"/its locale equivalent of the pre-0929 jargon where natural.

---

## 7. Invariants

| ID | Invariant | Preserved how | Verified by |
|----|-----------|---------------|-------------|
| I-ONB-SEQUENCE-VALID | The current `state.step` always has a non-empty sequence; `state.subStep` is always a member of `getSequence(state.step)`. | goNext/goBack skip-empty logic (§3.5 (3)(4)) + lazy resume normalizer (§3.6). | T-04, T-05, T-06 (state-machine tests). |
| I-ONB-PROGRESS-NO-NAN | `progress.segmentFill ∈ (0,1]`, never NaN. | `seq.length > 1 ? … : 1` guard returns 1 for empty/single sequences (§3.5 (5)). | T-07. |
| I-ONB-RESUME-NO-HIDDEN-STEP | A resumed user never lands on a conditionally-hidden step. | `resolveEntry` normalizer (§3.6) + `resumeSubStep` is only ever `gender_identity`. | T-08, SC-3. |
| I-COLLAB-DECK-IN-GROUP-CHAT (existing, memory `feedback_collab_deck_lives_in_group_chat.md`) | Home stays solo-only; collab decks live only in group chat; this step pre-creates the group chat the user later opens. | Copy now describes "shared chat + swipe together" (the real path); no new active-session concept introduced; create logic unchanged. | Code review (no Home/session-switcher wiring added). |
| I-CONSUMER-VOICE-NO-DATING (memory `feedback_mingla_positioning.md`) | Mingla copy is never dating-app framed. | New body uses crew/group/plan vocabulary, no romantic framing. | Copy review (SC-1). |

**New invariants established:** I-ONB-SEQUENCE-VALID, I-ONB-PROGRESS-NO-NAN, I-ONB-RESUME-NO-HIDDEN-STEP (all DRAFT → ACTIVE on ORCH-1039 CLOSE). Recommend registering in `INVARIANT_REGISTRY.md` at close.

---

## 8. Test cases

**Step-0.5 implementor happy-path tests (unit, state-machine) — fail-on-revert.**
Test file: `app-mobile/src/hooks/__tests__/useOnboardingStateMachine.collab-gate.test.ts` (or extend an existing state-machine test if one exists — implementor checks). Use `@testing-library/react-hooks` / `renderHook` per the repo's existing hook-test pattern.

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-04 | getSequence omits Step 6 when no context | `hasCollabContext=false` | `getSequence(6)` → `[]`; `getSequence(6)` with `hasCollabContext=true` → `['collaborations']` | hook |
| T-05 | goNext skips empty Step 6 | `hasCollabContext=false`, state at Step5/friends_and_pairing, call `goNext()` | state → `{step:7, subStep:'consent'}` (NOT step 6) | hook |
| T-05b | goNext does NOT skip when context exists | `hasCollabContext=true`, Step5 → goNext | state → `{step:6, subStep:'collaborations'}` | hook |
| T-06 | goBack skips empty Step 6 | `hasCollabContext=false`, state at Step7/consent, call `goBack()` | state → `{step:5, subStep:'friends_and_pairing'}` | hook |
| T-07 | progress never NaN across skip | `hasCollabContext=false`, walk Step1→launch via goNext | `progress.segmentFill` is a finite number in (0,1] at every state; step 6 never becomes `state.step` | hook |
| T-08 | resume normalizer skips hidden step | `initialStep=6`, `hasCollabContext=false` | initial `state` → `{step:7, subStep:'consent'}`; with `hasCollabContext=true` → `{step:6, subStep:'collaborations'}` | hook |

**Tester adversarial tests (runtime, both platforms) — see §6 SCs.**

| Test | Scenario | Expected | Platform |
|------|----------|----------|----------|
| T-09 | Fresh user, no friends, advance past Step 5 | Lands on Step 7/consent; Step 6 never visible | iOS sim + Android emu |
| T-10 | No friends, on Step 7, press Back | Lands on Step 5/friends; no blank Step 6 flash | iOS sim + Android emu |
| T-11 | Add a friend in Step 5, advance | Step 6 shows with new copy + "Start the group" CTA | iOS sim + Android emu |
| T-12 | Kill app at step 6 with no friends, relaunch | Resumes on Step 7/consent (not hidden step) | iOS sim + Android emu |
| T-13 | Kill app at step 6 with friends, relaunch | Resumes on Step 6/collaborations | iOS sim + Android emu |
| T-14 | Switch device language to a non-EN locale, reach populated Step 6 | Headline/body/CTA/trip-chat strings render translated | iOS sim |

**Fail-on-revert proof:** Reverting §3.5 (the `getSequence` Step-6 branch) makes T-04/T-05/T-06/T-08 fail (Step 6 no longer skipped). Reverting §3.6 makes T-08/T-12 fail. Reverting §3.1/§3.2 makes SC-1/T-11 fail (old copy / `common:start_session`).

---

## 9. Designer-gate decision

**No `mingla-designer` pass required.** This spec changes (a) locale string VALUES, (b) one CTA i18n key, (c) pure state-machine sequencing logic, and (d) removes a dead prop. The populated visual surface of `OnboardingCollaborationStep` — its layout, spacing, tokens, chips, cards, motion, and all nine visual states — is **unchanged**. Per the SPEC granularity protocol division-of-labor rule, a designer pass is required only when the visual surface changes materially; copy + sequence logic does not qualify. The new copy fits the existing headline/body text styles (the body is longer than the old string — the implementor MUST confirm it does not clip on the smallest in-matrix device, iPhone SE 3 / 667pt, via the existing `KeyboardAwareScrollView` scroll; this is a render check, not a design decision, covered by T-11).

---

## 10. Implementation order

1. **i18n (§3.1):** edit `en/onboarding.json` first (the 3 changed values + 5 new keys), then fan out to the other 28 locales with faithful translations. Validate JSON parse on every file. (No `common.json` edit.)
2. **Component strings (§3.2, §3.4):** swap the CTA key + the four trip-chat keys in `OnboardingCollaborationStep.tsx`; remove `onSkip` from its interface + destructure.
3. **Flow wiring (§3.3):** remove `onSkip={() => {}}`; add `hasCollabContext` const; pass it into `useOnboardingStateMachine`.
4. **State machine (§3.5):** add the prop, the `getSequence` Step-6 branch, the goNext/goBack skip-empty loops, the `progress` guard comment.
5. **Resume normalizer (§3.6):** add `resolveEntry`; use it for the lazy `useState` initializer + the `appliedInitialStep` setState; protective comment on the resume effect.
6. **Tests (§8):** write T-04…T-08 state-machine tests (implementor); tester runs T-09…T-14 on iOS sim + Android emu.
7. TypeScript compile + lint clean.

---

## 11. Regression prevention

- **Structural safeguard:** the `getSequence`-driven skip + the goNext/goBack skip-empty loops + the `resolveEntry` resume normalizer all read from the SAME `getSequence` function — there is one authority for "is this step present," so the three navigation paths (forward, back, resume) cannot diverge. (Mirrors the existing single-`getSequence` pattern.)
- **Test that catches recurrence:** T-04…T-08 (state-machine unit tests) fail if any future change removes the Step-6 skip, mis-handles the empty sequence, or breaks the resume normalizer.
- **Protective comments:** §3.5 (5) progress guard comment + §3.6 resume comment explain WHY empty sequences are handled, so a future editor doesn't "simplify" the skip-empty loops away.

---

## 12. Final notes / Discoveries deferred

- Discovery #3 (the dead `userPreferences` prop plumbing into `createCollaborativeSessionV2`) is left UNTOUCHED — register a small cleanup ORCH if desired.
- The OPTIONAL fuller hide-condition (§5.4) is registered here as a known follow-up.

**Confidence:** the functional contract is proven against source read end-to-end (state machine, shell, progress bar, resume hook, collab step, all 29 locale files confirmed to carry the block). The one product call (HIDE vs teaser, MVP-condition) is operator-aligned per the dispatch.
