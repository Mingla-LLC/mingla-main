# SPEC — ORCH-1303 [rsvp-page-interactionmanager-starvation]

Worktree: `~/Desktop/mingla-orchs/ORCH-1303-[rsvp-page-interactionmanager-starvation]/` on branch `ORCH-1303-rsvp-page-interactionmanager-starvation`
Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1303_RSVP_IM_STARVATION.md` (confidence: PROVEN)
Type: pure-client fix. **No migration. No edge function. No DB/RLS. No new dependency.**

---

## 1. Executive summary

On the RSVP public page, one looping animation (the "kicker dot pulse" inside the shared `RsvpMomentumDecision`) silently jams the app's interaction queue on **web** — so any code that waits for `InteractionManager.runAfterInteractions(...)` never runs. That is what froze the guest phone country-picker during ORCH-1299 (worked around web-only) and would silently break any future deferred work on that page. The fix is one line per animation: tell those looping/animating timings they are **not** interactions (`isInteraction: false`). The pulse still pulses and the meter still fills — nothing visual changes — but the interaction queue drains again, un-blocking every consumer on the page at once, on every surface.

---

## 2. Scope & non-goals

**In scope:**
- Set `isInteraction: false` on the `RsvpMomentumDecision` pulse-loop timings (F-1, the CONFIRMED ROOT) and the meter-fill timing (F-2, defensive) — one shared file.
- A CI regression gate (strict-grep) + a behavioral runtime probe test that fails on revert.
- Confirm/keep the native phone-picker defer correct (it is now provably safe — see §4/§5).

**Non-goals (explicit):**
- **No change to `useShimmer.ts`** — it is the same anti-pattern but off the RSVP page and has no active victim; it is a SEPARATE follow-up ORCH (Investigation §8). Touching it here widens scope.
- **No removal of the native `runAfterInteractions` defer** in `PhoneInput.tsx` by default — it exists for Android keyboard-dismiss timing; the root fix makes it safe without removal. (Removal is an Open Question, §10.)
- **No visual/motion redesign** — the animations must look identical; only the interaction flag changes. No `mingla-designer` involvement (no UI/motion change).
- No change to the ORCH-1299 web-immediate picker open or the ORCH-1300 portal — both stay.

**Assumptions:** react-native-web ≥0.21 (verified 0.21.1) where `shouldUseNativeDriver` returns false on web; RN 0.81.5 on native where the native module is present.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile` iOS) | YES (via root fix) | RSVP page holds no interaction handle; `runAfterInteractions` consumers fire. Already worked pre-fix (native driver); the explicit flag makes it driver-independent. | shared `RsvpMomentumDecision.tsx` | automatic (shared package) |
| 2 | Consumer Android (`app-mobile` Android) | YES (via root fix) | same as iOS | same | automatic |
| 3 | Buyer/anon Web (`/e/{brandSlug}/{eventSlug}`, `rsvp`) | **YES — the primary fix** | `runAfterInteractions` fires on the RSVP page; the guest phone country-picker (and any future deferred work) is un-frozen at the source. | same | automatic |
| 4 | Business iOS | YES (via root fix) | same as consumer iOS | same | automatic |
| 5 | Business Android | YES (via root fix) | same | same | automatic |
| 6 | Admin Web | NOT covered | reason: RSVP body not imported. | none | — |
| 7 | Business Web preview (`FoundationRsvpPreview`/`rsvp/[id]/preview`) | YES (incidental) | shares the buyer-web body + loop. | same | automatic |

One shared file (`packages/offering-rendering/RsvpMomentumDecision.tsx`) fixes surfaces 1–5 + 7 simultaneously. Ships web via Vercel `[deploy]`; native rides the next build (COMMS-0052 OTA freeze — **no `eas update`**).

---

## 4. Layered specification

Only the **Component** layer is touched (client Animated config). No DB/edge/service/hook/realtime.

### Component A — `packages/offering-rendering/RsvpMomentumDecision.tsx` (the ROOT fix)

- **A1 — pulse loop (F-1), lines 255-263.** Add `isInteraction: false` to BOTH inner `Animated.timing` configs.
  - Before (each):
    `Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true })`
  - After (each):
    `Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false })`
  - (same for the `toValue: 0` leg)
- **A2 — meter-fill timing (F-2), lines 267-275.** Add `isInteraction: false`.
  - Before: `Animated.timing(meterWidth, { toValue: momentum.meterPercent, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: false })`
  - After: `Animated.timing(meterWidth, { …, useNativeDriver: false, isInteraction: false })`
- **A3 — protective comment.** Above the pulse loop, replace/extend the existing `// Kicker dot pulse …` comment with a one-line why:
  `// isInteraction:false — a looping/animating timing on the RSVP page must NOT hold an InteractionManager handle, or runAfterInteractions starves page-wide on web (ORCH-1303).`
- **States:** unchanged — this is a config-only change to existing animations. The `useEffect` start/stop lifecycle, the `interpolate` outputs (`dotScale`/`dotOpacity`/`meterFillWidth`), and every visual is byte-identical.

### Component B — `packages/phone-input/PhoneInput.tsx` (native-defer correctness, NO code change required)

- The native branch (`InteractionManager.runAfterInteractions(() => setPickerVisible(true))`, line 172) is now **provably safe**: after A1/A2 the shared RSVP body holds no interaction handle on ANY platform, so the defer fires. **No edit required**; the correctness is delivered by the root fix. (A comment breadcrumb is optional; see §10 Open Question if removal is preferred.)

---

## 5. Success criteria (numbered, observable)

- **SC-1-Web** — On the RSVP public page in a web build, `InteractionManager.runAfterInteractions(cb)` invokes `cb` within a normal frame budget (< ~1s). Verified by the runtime probe (`im_starvation_probe.js` shape) returning `fired === true` for the shipped config, and by the deployed page no longer starving.
- **SC-1-Native** — On native, `runAfterInteractions(cb)` on the RSVP page fires (unchanged behavior), and the pulse loop's interaction-neutrality no longer depends on the native-driver default (explicit `isInteraction:false`). Reasoned assertion (native runtime unreachable headless; the config is platform-independent).
- **SC-2** — The guest phone country-picker opens on the RSVP page on BOTH web (immediate, ORCH-1299) and native (via the now-safe defer). No `runAfterInteractions` consumer on the shared `RsvpOfferingBody` remains starved.
- **SC-3** — Visual parity: the kicker dot still pulses (scale 1→1.6, opacity 1→0.5, 1.8s cycle) and the momentum meter still fills (0.5s ease). No perceptible change vs pre-fix. (`isInteraction` does not affect rendering.)
- **SC-4** — A CI gate FAILS if either pulse-loop timing OR the meter timing drops `isInteraction:false` (fails-on-revert), and FAILS if a NEW looping `Animated` is added to the RSVP shared body without `isInteraction:false` (adversarial).
- **SC-5** — No new dependency, no migration, no DB/edge change. Checkout, chip-in, and the ORCH-1299/1300 picker fixes are untouched.

---

## 6. Invariants

- **Preserves** the ORCH-1299 web-immediate open + ORCH-1300 body-portal (do-not-touch, §Allowlist). The gate must not conflict with `orch-1299-*`/`orch-1300-*` gates.
- **NEW (DRAFT):** `I-PROPOSED-1303-RSVP-LOOP-NO-INTERACTION-HANDLE` — *Any `Animated.loop`, or any `Animated.timing/spring` inside a loop/`sequence` used for a persistent decorative animation, in the RSVP shared body (`packages/offering-rendering/RsvpMomentumDecision.tsx`, `RsvpOfferingBody.tsx`, `RsvpChipInPanel.tsx`) MUST set `isInteraction: false`.* Enforced by the strict-grep gate (§9). Flips ACTIVE on CLOSE (orchestrator owns the flip).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy) | shipped config drains the queue | RNW-engine probe with the pulse-loop config incl. `isInteraction:false` | `runAfterInteractions` fires (`fired===true`) | runtime (node/ts-jest) |
| T-2 (error/revert) | remove `isInteraction:false` from a pulse-loop timing | same probe, culprit config | `runAfterInteractions` NEVER fires (`fired===false`) → proves the guard is load-bearing | runtime |
| T-3 (structural, happy) | both pulse timings + meter timing carry the flag | static scan of `RsvpMomentumDecision.tsx` | gate PASS | CI strict-grep |
| T-4 (adversarial) | a new looping `Animated` added to the RSVP body without `isInteraction:false` | synthetic looping timing in a scanned file | gate FAIL, exit 1 | CI strict-grep |
| T-5 (edge) | meter timing re-fires on going-count change | probe: start pulse loop + fire meter timing repeatedly | `runAfterInteractions` still fires between updates | runtime |
| T-6 (parity) | native config path | reasoned: `useNativeDriver:true` + explicit `isInteraction:false` | no handle on native either | reasoned |

The reference runtime probe (`Mingla_Artifacts/evidence/ORCH-1303/im_starvation_probe.js`) is the canonical T-1/T-2 harness (real RNW engine, exit 0 when culprit starves + fix settles).

---

## 8. Implementation order

1. **Edit** `packages/offering-rendering/RsvpMomentumDecision.tsx` — A1 (both pulse timings), A2 (meter timing), A3 (comment). One file, three config sites.
2. **Add** the strict-grep gate `.github/scripts/strict-grep/orch-1303-rsvp-loop-interaction-handle.mjs` (checks: (a) both pulse timings carry `isInteraction:false`; (b) meter timing carries it; (c) adversarial — no looping `Animated` in the RSVP body files omits it). Self-test PASS + fails-on-revert by true line deletion.
3. **Register** the gate in `.github/workflows/strict-grep-mingla-business.yml` (job + registry header comment), mirroring the `orch-1299`/`orch-1300` registrations.
4. **Add** the runtime probe test `packages/offering-rendering/__tests__/orch1303_im_starvation.test.ts` (or a node harness under the same folder) mirroring `im_starvation_probe.js`: asserts fix-config drains and culprit-config starves. Append-only; no existing test modified.
5. Run gates + probe; prove fails-on-revert; commit on the branch.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the strict-grep gate `orch-1303-rsvp-loop-interaction-handle.mjs`, registered in `strict-grep-mingla-business.yml`, enforcing `I-PROPOSED-1303-RSVP-LOOP-NO-INTERACTION-HANDLE`.
  - **Fails-on-revert requirement:** deleting `isInteraction:false` from EITHER pulse timing (A1) OR the meter timing (A2) → gate FAIL, exit 1; restoring → PASS. Adversarial check: adding a looping `Animated` in a scanned RSVP body file without the flag → FAIL.
- **Behavioral safeguard:** the runtime probe test (T-1/T-2) — with the flag the queue drains, without it the queue starves — a direct, engine-level fails-on-revert proof independent of the string scan.
- **Protective comment (A3)** explains the "why" so a future editor does not "clean up" the flag.

---

## 10. Open questions

- **Q (native defer):** keep the native `runAfterInteractions` defer in `PhoneInput.tsx` (default, recommended — it is now safe and preserves Android keyboard-dismiss timing), OR remove it and open the native picker immediately after `Keyboard.dismiss()`? Default answer: **keep** (removal risks reintroducing the Android keyboard-overlap the defer was added for; the root fix already makes it correct). Only revisit if a tester finds a native keyboard-timing regression. No blocker.
- No other open questions — the fix is fully determined.

---

## 11. Downstream routing

Next = **mingla-implementor** (build steps §8 in this worktree). Then **mingla-tester**: live-fire on web via Playwright (Chromium + WebKit) that `runAfterInteractions` fires on the deployed RSVP page (re-run the `im_starvation_probe` shape against the built bundle, and confirm the guest phone-picker opens) + reasoned native assertion + run the strict-grep gate + the runtime probe test + prove fails-on-revert. Then **orchestrator CLOSE** (flip `I-PROPOSED-1303-*` ACTIVE; web ships via Vercel `[deploy]`; NO `eas update`).

### Allowlist (implementor may modify ONLY these)
- `packages/offering-rendering/RsvpMomentumDecision.tsx` (A1/A2/A3 config + comment)
- `.github/scripts/strict-grep/orch-1303-rsvp-loop-interaction-handle.mjs` (NEW)
- `.github/workflows/strict-grep-mingla-business.yml` (+gate registration)
- `packages/offering-rendering/__tests__/orch1303_im_starvation.test.ts` (NEW)

### DO-NOT-TOUCH (stop-and-amend before editing)
- `packages/phone-input/PhoneInput.tsx` (ORCH-1299/1300 fixes — no edit needed; the root fix delivers native correctness)
- `packages/phone-input/CountryPickerModal.tsx`, `WebOverlayPortal*.tsx`, `pickerPresentation.ts`
- `mingla-business/src/hooks/useShimmer.ts` (separate follow-up ORCH per Investigation §8)
- `RsvpOfferingBody.tsx` behavior, `RsvpChipInPanel.tsx`, checkout/chip-in paths, any DB/edge/migration
- The `orch-1299-*` / `orch-1300-*` strict-grep gates
