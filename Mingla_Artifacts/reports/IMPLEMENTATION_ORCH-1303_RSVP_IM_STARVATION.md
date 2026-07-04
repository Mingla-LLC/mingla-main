# IMPLEMENTATION — ORCH-1303 [rsvp-page-interactionmanager-starvation]

Worktree: `~/Desktop/mingla-orchs/ORCH-1303-[rsvp-page-interactionmanager-starvation]/` on branch `ORCH-1303-rsvp-page-interactionmanager-starvation`
Base: `d7c8112ec` (rebased on origin/main) · Implementation commit: `656782cdf`
Spec: `Mingla_Artifacts/specs/SPEC_ORCH-1303_RSVP_IM_STARVATION.md` (the contract)
Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1303_RSVP_IM_STARVATION.md` (PROVEN)
Status: **implemented and verified** (structural + behavioral, headless — web runtime handoff to tester)

---

## 1. Summary

The RSVP public page had one looping animation (the kicker-dot pulse inside the shared
`RsvpMomentumDecision`) that silently jammed the whole page's interaction queue **on web** — so any
code waiting on `InteractionManager.runAfterInteractions(...)` never ran (this is what froze the
guest phone country-picker in ORCH-1299/1300). The fix adds one scheduling-only flag,
`isInteraction: false`, to the two pulse-loop timings and the meter-fill timing. The pulse still
pulses and the meter still fills — nothing visual changes — but the interaction queue drains again,
un-blocking every current and future deferred consumer on the page at once. Native was never
affected (real native driver → no JS handle) and is unchanged. One product file changed; a CI gate
and a fails-on-revert test lock it.

---

## 2. SPEC success-criteria coverage

| SC | Requirement | Status | Evidence / commit |
|---|---|---|---|
| SC-1-Web | `runAfterInteractions(cb)` fires on the RSVP page in a web build | ✓ | Real RNW-engine probe `im_starvation_probe.js`: FIX config → fired=true (CULPRIT → false). Deno test "BEHAVIORAL from SOURCE" drains on web. Commit `656782cdf`. Live-web confirmation = tester. |
| SC-1-Native | native `runAfterInteractions` fires; loop no longer depends on the native-driver default | ✓ (reasoned) | Explicit `isInteraction:false` + `useNativeDriver:true` kept. Deno test "BEHAVIORAL parity (T-6)": native drains. Commit `656782cdf`. |
| SC-2 | guest phone country-picker opens on web (immediate, ORCH-1299) and native (now-safe defer); no starved consumer on the shared body | ✓ (root removes the trap) | `PhoneInput.tsx` untouched (DO-NOT-TOUCH); the root fix un-starves the page. Live-fire picker open = tester. Commit `656782cdf`. |
| SC-3 | visual parity — pulse (scale 1→1.6, opacity 1→0.5, 1.8s) + meter (0.5s ease) look identical | ✓ | Only `isInteraction:false` added; `interpolate` outputs, durations, easings, `useNativeDriver` values all byte-identical (see receipts §7). `isInteraction` is scheduling-only, never rendered. |
| SC-4 | CI gate FAILS if either pulse timing OR the meter drops the flag, and FAILS on a new flagless looping Animated in the RSVP body | ✓ | Gate `orch-1303-rsvp-loop-interaction-handle.mjs` self-test 8/8; fails-on-revert proven (exit 1). Commit `656782cdf`. |
| SC-5 | no new dependency, migration, DB/edge change; ORCH-1299/1300 + checkout/chip-in untouched | ✓ | Diff = 4 files (1 product + gate + workflow + test). No deps/migrations/edge. DO-NOT-TOUCH files unchanged. |

---

## 3. Files changed

| File | Change | Δ |
|---|---|---|
| `packages/offering-rendering/RsvpMomentumDecision.tsx` | product fix — `isInteraction:false` on 2 pulse timings + meter timing + protective comments | +12 / −2 |
| `.github/scripts/strict-grep/orch-1303-rsvp-loop-interaction-handle.mjs` | NEW — CI gate (self-test 8/8) | +~300 |
| `.github/workflows/strict-grep-mingla-business.yml` | +1 registry header line, +1 job (`orch-1303-rsvp-loop-interaction-handle`) | +14 |
| `packages/offering-rendering/__tests__/orch1303_im_starvation.test.ts` | NEW — Deno structural + behavioral test (5/5) | +~200 |

No out-of-scope files staged (`git status` = these 4 only).

---

## 4. Data-model changes applied

None. Pure client (component) change. No tables/columns/constraints/indexes/RLS.

## 5. Edge functions touched

None. No `verify_jwt` change.

---

## 6. Regression tests added

- **Gate (structural, CI-enforced):** `.github/scripts/strict-grep/orch-1303-rsvp-loop-interaction-handle.mjs` — registered in `strict-grep-mingla-business.yml`. Self-test **8/8** PASS. Live PASS.
- **Test (behavioral + structural, Deno):** `packages/offering-rendering/__tests__/orch1303_im_starvation.test.ts` — **5/5** PASS (`deno test --allow-read --no-check`). Mirrors the committed real-engine probe: models the exact RNW rule (`__isInteraction = config.isInteraction ?? !shouldUseNativeDriver`; web ⇒ native module absent ⇒ false), fed by the config extracted from source.
- **Evidence (real engine, committed):** `Mingla_Artifacts/evidence/ORCH-1303/im_starvation_probe.js` — re-run this pass: CULPRIT `runAfterInteractions` fired=false (STARVED), FIX fired=true (SETTLES), exit 0.

**fails-on-revert verified at `656782cdf`** (proven by TRUE line deletion of `isInteraction:false` from the pulse timings + meter, not a comment-out):
- Gate on reverted source → **exit 1** (flags A pulse×2, B meter, C adversarial); restored → exit 0.
- Deno test on reverted source → **3 failed** (STRUCTURAL pulse, STRUCTURAL meter, BEHAVIORAL-from-source web-drain flips true→false); restored → 5 passed.

---

## 7. Old → New receipts

### `packages/offering-rendering/RsvpMomentumDecision.tsx`
**Before:** pulse `Animated.loop`'s two `Animated.timing(pulse, {…useNativeDriver:true})` and the meter `Animated.timing(meterWidth, {…useNativeDriver:false})` set NO `isInteraction`. On web (RNW nullifies `useNativeDriver`) each defaulted `__isInteraction=true`; the endless pulse loop held an InteractionManager handle forever → `runAfterInteractions` starved page-wide; the meter re-held a ~500ms handle per going-count change.
**After:** all three timings add `isInteraction: false`. The loop/meter hold no InteractionManager handle on any platform. A protective comment above the loop and beside the meter explains WHY (so a future editor doesn't "clean up" the flag).
**Why:** SC-1/SC-2 (root fix — un-starve `runAfterInteractions`), SC-3 (scheduling-only, visually identical). `interpolate` outputs (`dotScale` 1→1.6, `dotOpacity` 1→0.5, `meterFillWidth` 0%→100%), `duration`s (900/900/500), `easing`s, and `useNativeDriver` values are unchanged — the animation is byte-identical.
**Lines changed:** ~+12 / −2 (3 config sites + 2 comment blocks).

---

## 8. Cross-surface impact table

| Surface | Affected | What changes for the user | Parity |
|---|---|---|---|
| Consumer iOS | via root fix | RSVP page holds no interaction handle; explicit flag makes it driver-independent (already worked via native driver) | automatic (shared package) |
| Consumer Android | via root fix | same | automatic |
| Buyer/anon Web | **YES — primary** | `runAfterInteractions` fires on the RSVP page; guest phone-picker + any future deferred work un-frozen at the source | automatic |
| Business iOS | via root fix | same as consumer iOS | automatic |
| Business Android | via root fix | same | automatic |
| Admin Web | NO | RSVP body not imported | — |
| Business Web preview (`FoundationRsvpPreview`) | YES (incidental) | shares the buyer-web body + loop | automatic |

One shared file fixes surfaces 1–5 + 7 simultaneously. Web ships via Vercel `[deploy]`; native rides the next build (no `eas update`).

---

## 9. Smoke result

Headless (this session):
- Gate self-test **8/8**, live **PASS**; fails-on-revert exit 1 on deletion, exit 0 on restore.
- Deno test **5/5**; fails-on-revert 3-failed on deletion, 5-passed on restore.
- Real RNW-engine probe: CULPRIT starves (false), FIX settles (true), exit 0.
- Sibling no-regression: `orch-1292` parity + adversarial gates PASS; `orch_1157_rsvp_momentum` + `orch_1292_taxonomy_labels` Deno tests 21/21 PASS.

Web runtime (Playwright Chromium+WebKit on the deployed RSVP page) + reasoned-native = **tester** (biz-web authed/animated runtime is unreachable headless here; capping web claims at "verified in the real RNW engine + fails-on-revert", live-page = tester).

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- The Deno test uses a *model* of the RNW `isInteraction` rule (Deno cannot resolve the CJS `react-native-web` node package); the committed node probe `im_starvation_probe.js` is the real-engine backstop and is re-run each pass. Both are wired to fail on revert.
- The `offering-rendering/__tests__` Deno tests are run locally + proven fails-on-revert (matching the package's committed precedent: `orch_1157_*`, `orch_1292_*`); the **CI-enforced** guard for ORCH-1303 is the strict-grep gate (registered in the workflow).

## 11. Operator action required

- None for build. No migration (`db push` N/A). No edge deploy. No new dependency.
- Ship: web via Vercel `[deploy]` at CLOSE (orchestrator/operator-owned). **NO `eas update`** (COMMS-0052 OTA freeze) — native rides the next business/consumer build.

## 12. Discoveries for Orchestrator

- **`useShimmer.ts` follow-up (RESTATED, OUT OF SCOPE):** `mingla-business/src/hooks/useShimmer.ts:108-125` is the IDENTICAL anti-pattern — `Animated.loop` with `useNativeDriver: Platform.OS !== "web"` (false on web) and no `isInteraction`. On web it holds an InteractionManager handle for as long as any shimmer skeleton is mounted. It is only used by `BusinessNotificationsScreen.tsx`, which has no page-reachable `runAfterInteractions` consumer today, so there is **no active victim** — but it is a live footgun. Recommend a follow-up ORCH to add `isInteraction:false` to `useShimmer` (and/or a repo-wide lint for looping web timings missing the flag). Deliberately NOT fixed here (spec DO-NOT-TOUCH; widening scope).
- **COMMS coordination (COMMS-0040):** this edits the shared RSVP body `RsvpMomentumDecision.tsx`. The change is a minimal scheduling-only config add (`isInteraction:false` on existing timings + comments) — no structural/behavioral change to the shared body, no prop/API change, no render change. Investigation already factored COMMS-0040. Ledger `acked_by` append is anchor-main-owned → left for the orchestrator at CLOSE (sub-agents don't mutate the anchor). COMMS-0052 (OTA freeze) complied with: web-only, no `eas update`.
- **New invariant to flip at CLOSE:** `I-PROPOSED-1303-RSVP-LOOP-NO-INTERACTION-HANDLE` — flip DRAFT→ACTIVE (gate is registered + fails-on-revert).
