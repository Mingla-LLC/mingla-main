# INVESTIGATION — ORCH-1303 [rsvp-page-interactionmanager-starvation]

Worktree: `~/Desktop/mingla-orchs/ORCH-1303-[rsvp-page-interactionmanager-starvation]/` on branch `ORCH-1303-rsvp-page-interactionmanager-starvation`
Base commit: `e3743acf6`
Confidence: **PROVEN** (full source trace + full runtime reproduction in the real react-native-web engine + live-page confirmation + sealed ORCH-1299/1300 live evidence).
Comms: read `COMMS_LEDGER.md` on entry — no BLOCK targets this ORCH. WARN COMMS-0073/0074 confirm 1303 is the correct free ID; WARN COMMS-0040 (coordinate before EDITING the RSVP shared body) is factored — this is INVESTIGATE-only, no edits.

---

## 0. Symptom summary (expected vs actual)

- **Expected:** on the RSVP public page, `InteractionManager.runAfterInteractions(cb)` callbacks run once touch/animation interactions settle (as they do on every other page).
- **Actual (web):** `runAfterInteractions(cb)` callbacks **NEVER run** on the RSVP public page. `setTimeout` and `requestAnimationFrame` fire normally; only `runAfterInteractions` is starved. Discovered during ORCH-1299/1300: the country picker deferred its open behind `runAfterInteractions` → the picker never mounted (dead tap). ORCH-1299 worked around it (open immediately on web); the ROOT was filed as a discovery for this ORCH.

**The ROOT hypothesis in the dispatch is CONFIRMED for web, and REFINED for native:** a looping `Animated` animation on the RSVP page holds an InteractionManager handle open forever — but *only on web*, and the mechanism is subtler than "default `isInteraction: true`" (see F-1).

---

## 1. Investigation manifest (files read, in trace order)

| # | File / evidence | Layer | Why |
|---|---|---|---|
| 1 | `reports/IMPLEMENTATION_ORCH-1299_RSVP_PHONE_PICKER.md` §0/§9/§12 | docs | sealed runtime evidence that `runAfterInteractions` never fires on the live RSVP page; ROOT filed as discovery |
| 2 | `reports/IMPLEMENTATION_ORCH-1300_RSVP_PHONE_PICKER_MOBILE.md` §9 | docs | confirms the looping-handle defect is separate from the mobile-WebKit transform trap |
| 3 | `COMMS_LEDGER.md` (0073/0074/0040) | docs | ID space + shared-body coordination |
| 4 | `packages/offering-rendering/RsvpMomentumDecision.tsx:252-279` | code | **the loop** — the only permanent `Animated.loop` on the page |
| 5 | `packages/offering-rendering/RsvpOfferingBody.tsx:77,995-1021,1134-1135` | code | renders `RsvpMomentumDecision`; only other animation is a one-shot `LayoutAnimation` |
| 6 | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx:80,931` | code | consumer-native RSVP surface renders the shared `RsvpOfferingBody` (so the loop runs on native too) |
| 7 | `packages/phone-input/PhoneInput.tsx:157-175` | code | the only page-reachable `runAfterInteractions` consumer (native still defers; web opens immediately) |
| 8 | RNW `…/Animated/animations/TimingAnimation.js:36-38` | runtime | `__isInteraction = config.isInteraction ?? !this._useNativeDriver` |
| 9 | RNW `…/Animated/NativeAnimatedHelper.js:404-415` | runtime | `shouldUseNativeDriver` returns **false** on web (native module absent) |
| 10 | RNW `…/Animated/nodes/AnimatedValue.js:212-227` | runtime | creates an IM handle when `__isInteraction`, clears it on animation END |
| 11 | RNW `…/InteractionManager/index.js:19-37` | runtime | drains the task queue **only when `_interactionSet.size === 0`** |
| 12 | `mingla-business/src/hooks/useShimmer.ts:108-125` | code | a sibling same-class loop — confirmed NOT reachable on the RSVP page |

react-native-web version in scope: **0.21.1** (mingla-business declares `~0.21.0`). RN native: **0.81.5**.

---

## 2. Q-scorecard

- **Q1 — Which looping animation on the RSVP page holds the IM handle open forever?**
  **Verdict:** `RsvpMomentumDecision.tsx:255-263` — the "kicker dot pulse" `Animated.loop(Animated.sequence([timing→1, timing→0]))`. It is the ONLY permanent looping animation rendered anywhere on the RSVP page subtree. *(proven)*

- **Q2 — Its timings set `useNativeDriver: true`; how can a native-driven animation hold a JS interaction handle?**
  **Verdict:** on **web**, react-native-web has no native animated module, so `shouldUseNativeDriver({useNativeDriver:true})` returns `false` → `_useNativeDriver=false` → `__isInteraction = (undefined) ?? !false = true`. So on web the loop IS interaction-flagged and creates a handle. *(proven — F-1)*

- **Q3 — Which `runAfterInteractions` consumers are reachable on the RSVP page, and which are still broken?**
  **Verdict:** exactly ONE app-level consumer is reachable: the phone country-picker defer (`PhoneInput.tsx:172`). On **web** it is already worked around by ORCH-1299 (opens immediately). On **native** it still defers, but native holds no permanent handle (Q5) so it fires. **No other app or library consumer is reachable** (react-navigation absent, @gorhom/bottom-sheet + FlatList/VirtualizedList carry no IM usage, `useCoachMark`/`ConnectionsPage` IM consumers are off-page). *(proven — F-3, F-4)*

- **Q4 — Does the starvation affect NATIVE (iOS/Android)?**
  **Verdict:** **NO.** On native the native animated module exists, so the pulse loop's `useNativeDriver:true` yields `_useNativeDriver=true` → `__isInteraction=false` → no handle is ever created. runAfterInteractions settles normally on native. This **refutes** the dispatch's "affects native AND web" for THIS specific loop. *(proven — F-1)*

- **Q5 — Is the ORCH-1299 native picker defer frozen (so a future native build ships it broken)?**
  **Verdict:** **NO, not frozen.** Because native holds no permanent IM handle (Q4), `runAfterInteractions(() => setPickerVisible(true))` fires on native. A future native build ships a WORKING picker. The defer is nonetheless *latently fragile* (it silently depends on nothing else on the page holding a handle) — the SPEC hardens it. *(proven — F-3)*

- **Q6 — Is there any OTHER looping animation or library IM holder on the page?**
  **Verdict:** **NO.** The meter-fill timing (F-2) is a one-shot (not a loop). `useShimmer`'s loop (same latent class) is only on the notifications screen. ParallaxCoverShell/OfferingChrome/RsvpChipInPanel/EventCoverMedia carry no `Animated.loop`. *(proven)*

---

## 3. Findings

### F-1 — CONFIRMED ROOT CAUSE (proven) · answers Q1, Q2, Q4

- **Symptom:** on web, `runAfterInteractions(cb)` never fires on the RSVP page; `setTimeout`/`rAF` do.
- **Layer:** code (app) + runtime (RNW engine).
- **Probe:** full runtime reproduction in the REAL react-native-web engine (Node), replicating the exact `RsvpMomentumDecision` loop config, then re-running with `isInteraction:false`. Script committed at `Mingla_Artifacts/evidence/ORCH-1303/im_starvation_probe.js`. Run: `cd app-mobile && NODE_PATH=./node_modules node …/im_starvation_probe.js`.
- **Evidence (verbatim):**
  - App config — `packages/offering-rendering/RsvpMomentumDecision.tsx:255-263`:
    ```
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    ```
    (no `isInteraction` on either timing)
  - Engine — `react-native-web/.../Animated/animations/TimingAnimation.js:38`:
    `this.__isInteraction = config.isInteraction ?? !this._useNativeDriver;`
  - Engine — `NativeAnimatedHelper.js:408-415`: `if (config.useNativeDriver === true && !NativeAnimatedModule) { … return false; } return config.useNativeDriver || false;` (on web `NativeAnimatedModule` is null → returns **false**)
  - Engine — `AnimatedValue.js:213-227`: `if (animation.__isInteraction) { handle = InteractionManager.createInteractionHandle(); } … clearInteractionHandle(handle)` only in the END callback.
  - Engine — `InteractionManager/index.js:30-37`: task queue drains **only** `if (nextInteractionCount === 0)`.
  - Runtime output:
    ```
    [CULPRIT: loop timings, NO isInteraction (current RsvpMomentumDecision)]
      timing._useNativeDriver = false   (web => false: native module absent)
      timing.__isInteraction  = true
      runAfterInteractions fired within 3002ms? => false
    [FIX: loop timings with isInteraction:false]
      timing.__isInteraction  = false
      runAfterInteractions fired within 3003ms? => true
    ```
- **Mechanism:** on web the loop's timings are interaction-flagged (`__isInteraction=true`), so each 900ms leg creates an IM handle; the legs run back-to-back and the loop never ends, so `_interactionSet.size` never returns to 0 → InteractionManager never drains its task queue → every `runAfterInteractions` callback on the page starves forever. Setting `isInteraction:false` removes the handle and the queue drains. On native the native driver is real → `_useNativeDriver=true` → `__isInteraction=false` → no handle → native is unaffected.
- **Severity:** **CONFIRMED ROOT CAUSE.**

### F-2 — SECONDARY CONTRIBUTOR (proven) · the meter-fill timing

- **Symptom:** an additional, transient IM handle held on web AND native whenever the going-count/capacity changes.
- **Layer:** code + runtime.
- **Probe:** source read + the same isInteraction rule as F-1.
- **Evidence:** `RsvpMomentumDecision.tsx:267-275`:
  ```
  Animated.timing(meterWidth, { toValue: momentum.meterPercent, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
  ```
  `useNativeDriver:false` → `__isInteraction = !false = true` on **all** platforms.
- **Mechanism:** a one-shot (not a loop), so it holds a handle for ~500ms each time `momentum.meterPercent` changes (mount + every realtime going-count update), transiently re-starving `runAfterInteractions`. Not the permanent freeze, but it can re-block within the fix window if left interaction-flagged.
- **Severity:** **SECONDARY ROOT CAUSE** (defensive — the SPEC clears it in the same edit so the fix is robust across realtime count updates).

### F-3 — The only page-reachable `runAfterInteractions` consumer: the phone-picker defer (proven) · answers Q3, Q5

- **Symptom:** the picker deferred its open behind `runAfterInteractions`.
- **Layer:** code.
- **Probe:** exhaustive grep of `packages/ mingla-business/src/ app-mobile/src/` for `runAfterInteractions|createInteractionHandle|InteractionManager`, cross-referenced with what mounts on the RSVP page.
- **Evidence:** `PhoneInput.tsx:157-175` — web branch `setPickerVisible(true); return;` (ORCH-1299), native branch `InteractionManager.runAfterInteractions(() => setPickerVisible(true))`. The only other matches (`useCoachMark.ts:181`, `ConnectionsPage.tsx:3053`, `attRequestTiming.ts`) do NOT render on the RSVP page.
- **Mechanism:** web is already un-frozen by ORCH-1299; native fires because native holds no permanent handle (F-1). So there is **no currently still-broken consumer** — but the ORCH-1299 web workaround is a per-consumer patch that leaves the page-level trap in place: any *future* `runAfterInteractions` consumer added to the shared `RsvpOfferingBody`/RSVP page would silently break on web. The root fix (F-1) removes the trap for all consumers at once.
- **Severity:** **SUSPECTED CONTRIBUTOR** (currently mitigated on web, unaffected on native; the risk is latent/future, and it motivates the root fix + native-defer hardening).

### F-4 — RULED OUT: library IM holders (proven) · answers Q3, Q6

- **Probe:** `@gorhom/bottom-sheet/src` grep (no `runAfterInteractions`/`createInteractionHandle`); `@react-navigation` absent from `mingla-business/node_modules`; RNW `VirtualizedList`/`FlatList` carry no IM usage.
- **Evidence:** grep returned zero matches in each; `ls @react-navigation` → ABSENT (Mingla uses a custom navigator).
- **Severity:** **RULED OUT.**

---

## 4. Five-truth-layer reconciliation

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | ORCH-1299/1300 reports + the code comment at `PhoneInput.tsx:160-167` state "the RSVP page holds a looping Animated interaction handle." | none — docs correctly named the class; this investigation pins the exact file:line + the web-only mechanism. |
| **Schema** | n/a (pure client). | — |
| **Code** | `RsvpMomentumDecision.tsx:255-263` loop omits `isInteraction`, `:267-275` meter omits it. | — |
| **Runtime** | Node RNW-engine repro: culprit config starves `runAfterInteractions`; `isInteraction:false` settles it. | **RESOLVES** the dispatch's "affects native AND web": the loop starves web ONLY (native driver present on native → `isInteraction:false` by default). |
| **Data** | n/a. | — |

The one place Docs/Code and the dispatch DIVERGE: the dispatch reasoned "RN Animated timing/spring default `isInteraction: true`." That is only true when `useNativeDriver` is falsey. The loop DOES set `useNativeDriver:true`, so it is **web-specific** (RNW nullifies the native driver). Runtime is the truth-holder; F-1 documents it.

---

## 5. Repro evidence

- **RNW-engine runtime repro (decisive):** `Mingla_Artifacts/evidence/ORCH-1303/im_starvation_probe.js` — CULPRIT: `runAfterInteractions` false in 3002ms; FIX: true in 3003ms. Exit 0.
- **Live-page confirmation:** `Mingla_Artifacts/evidence/ORCH-1303/live_probe.js` + `live-01-rsvp-page-chromium-iphone13.png` — on the live deploy (`https://business.usemingla.com/e/smokerhythm/july-4th-bbq-pool-party`, Chromium + iPhone 13): `setTimeout=true`, `requestAnimationFrame=true`, and the `RsvpMomentumDecision` surface (Going/Maybe/Can't-go) is mounted (so the loop is live on the current deploy).
- **Sealed prior live evidence (cited, not re-proven):** ORCH-1299 §0 — on the same live URL, `runAfterInteractions(cb)` never fired within 6s even after creating+clearing its own handle (proving OTHER handles are held), while `setTimeout`/`rAF` fired.

---

## 6. Blast radius / cross-surface map

| Surface | Affected by the ROOT? | Detail |
|---|---|---|
| Buyer/anon Web (`/e/{brandSlug}/{eventSlug}`, RSVP) | **YES** | `runAfterInteractions` starved page-wide; every current+future consumer on the shared `RsvpOfferingBody` blocked on web. |
| Business Web preview (`FoundationRsvpPreview` / `rsvp/[id]/preview`) | **YES** | shares the same body + loop. |
| Consumer iOS | **NO (loop)** | native driver → no handle. Consumer renders the same `RsvpOfferingBody`, but the loop is native-driven. Native picker defer fires. |
| Consumer Android | **NO (loop)** | same as iOS. |
| Business iOS / Android | **NO (loop)** | same; native-driven loop holds no handle. |
| Admin Web | NO | RSVP body not imported. |

In-scope for the fix: `packages/offering-rendering/RsvpMomentumDecision.tsx` (the two Animated configs) — a single shared file that fixes ALL surfaces at once. `packages/phone-input/PhoneInput.tsx` native defer — optional hardening (the SPEC decides).

---

## 7. Invariant impact

- No existing invariant is violated by the current code, but there is **no guard** preventing a looping `Animated` on the RSVP body from re-introducing a held handle. The SPEC proposes a DRAFT invariant `I-PROPOSED-1303-RSVP-LOOP-NO-INTERACTION-HANDLE` (a strict-grep gate: any `Animated.loop`/looping timing in the RSVP shared body must carry `isInteraction:false`). Flagged, not pre-decided.

---

## 8. Discoveries for orchestrator

- **DISCOVERY (same-class latent risk, OUT OF SCOPE):** `mingla-business/src/hooks/useShimmer.ts:108-125` is the identical anti-pattern — `Animated.loop` with `useNativeDriver: Platform.OS !== "web"` (i.e. `false` on web) and no `isInteraction`. On web it holds an IM handle for as long as any shimmer skeleton is mounted. It is only used by `BusinessNotificationsScreen.tsx`, which has no page-reachable `runAfterInteractions` consumer today, so there is no active victim — but it is a live footgun. Worth a follow-up ORCH to add `isInteraction:false` to `useShimmer` (and any web-loop pattern), or a repo-wide lint.
- **NOTE:** the general rule is "any web `Animated.loop` whose inner timings do not set `isInteraction:false` starves `runAfterInteractions` for the whole page." A repo-wide strict-grep/lint for looping web timings missing `isInteraction:false` would prevent recurrence beyond the RSVP page.

---

## 9. Confidence

**PROVEN.** Source trace is complete across app + engine; the bug and its fix are reproduced in the exact react-native-web engine (0.21.1); the loop component is confirmed mounted on the live deploy; and the prior live "runAfterInteractions never fires" evidence is sealed. The one refinement vs the dispatch (native is NOT affected by this loop) is itself proven by the `isInteraction ?? !useNativeDriver` rule + the native module's presence on native.

---

## 10. Recommended next phase + scope

**SPEC** (this pass, IA mode). Recommended scope: the **root fix only** — set `isInteraction:false` on the `RsvpMomentumDecision` pulse loop timings (F-1) and, defensively, on the meter-fill timing (F-2), in the one shared file. Plus a CI regression gate. Optionally harden the native phone-picker defer (F-3) — but the root fix is sufficient for correctness; native already works. Do NOT widen to `useShimmer` (separate ORCH per §8). No migration (pure client).
