# QA — META-ORCH-1002 [Android glass hardening] Sub-C (shared GlassBlur opaque Android fallback)

**Date:** 2026-05-29
**Skill:** mingla-tester (Claude)
**Mode:** TARGETED — Step-0.5 adversarial regression gate + source-level verdict
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[sub-c-shared-glassblur-public]/` on branch `META-ORCH-1002-sub-c-shared-glassblur-public`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1002_SUB-C_SHARED_GLASS.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-1002_SUB-C_SHARED_GLASS.md`
**Fix under test:** `packages/event-rendering/GlassBlur.tsx` — Android now paints an OPAQUE frosted `View` fill (dark `rgba(20,22,26,0.92)` / light `rgba(248,249,251,0.94)`, keyed to BlurView `tint`) instead of expo-blur's thin Android film. iOS keeps the real `BlurView`; web unchanged.

**On-device note:** This report is a **source-level + behavioral** verdict. On-device business-render proof (`/b/{slug}` + `/e/{brand}/{event}` on an Android emulator over a busy hero) is SEPARATELY BLOCKED by a dev-build drift and is owned by the orchestrator's business-build decision. Per the dispatch, no device/emulator boot was attempted here. The Phase-0.A live-fire leg for Android is therefore explicitly DEFERRED to the orchestrator; this verdict does not assert pixel rendering.

---

## 1. Comms ledger (entry)

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK`/`OPEN` row targets `mingla-tester`, this ORCH (META-ORCH-1002), or `ALL` requiring action this turn. COMMS-0002 (strict-grep backend) N/A — no `supabase/functions` touch. COMMS-0003 (external-API docs) N/A — pure `Platform.OS` branch, no external API. COMMS-0011 (ORCH-0990 double-book) FYI, unrelated. No new ledger entry written (no cross-ORCH discovery: the fix is isolated to `packages/event-rendering/GlassBlur.tsx`; no collision with Sub-B/Sub-D app-source worktrees).

---

## 2. What was tested

The implementor's happy-path test (`meta-orch-1002-sub-c-shared-glass-check.mjs`) proves the Android opaque branch **exists** by REGEX-MATCHING the source text (does the pattern `androidOpaqueFillForTint(...)` + fill consts + the `Platform.OS==='android'` block appear). That proves a pattern is present; it does NOT prove the component **behaves** correctly when rendered, and it cannot catch a tint silently routed to the wrong fill, a leaked blur prop, or an accidental opaque-ification of iOS.

The tester adversarial test attacks a **different property — BEHAVIOR**. It transpiles the real `GlassBlur.tsx` in-process (sucrase: typescript+jsx+imports), mocks `react`/`react-native`/`expo-blur`, then RENDERS the actual exported component under each `Platform.OS` + tint and asserts the produced element tree (element type, resolved `backgroundColor`, forwarded/stripped props, children).

---

## 3. Adversarial test

**Path:** `packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-adversarial-check.mjs`
**Run:** `node ./packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-adversarial-check.mjs`

| Test | Adversarial angle | Assertion |
|---|---|---|
| A-01 | **iOS-freeze** | `Platform.OS='ios'` renders the REAL `<BlurView>`, forwards `tint`/`intensity`/`experimentalBlurMethod`, and has NO opaque `backgroundColor` (no accidental opaque-ification of iOS). |
| A-02 | **web-preserved** | `web` @ width<768 renders a plain `<View>` wrapping children (blur-skip branch) — NOT a BlurView and NOT the Android opaque fill; width>=768 keeps the real BlurView. |
| A-03 | **tint-mapping correctness** | Android: `'light'`, `'systemMaterialLight'`, `'extraLight'`, `'systemThinMaterialLight'` → LIGHT fill; `'dark'`, `'default'`, `undefined`, `'prominent'`, `'systemUltraThinMaterialDark'`, `'regular'` → DARK fill. No tint silently mis-routed; no throw. (Executes the real `androidOpaqueFillForTint`.) |
| A-04 | **no-blur-leak on Android** | For 6 tints, Android NEVER renders a BlurView; rendered element is a `View` whose resolved `backgroundColor` is opaque ≥0.92; blur-only props (`intensity`/`experimentalBlurMethod`/`blurReductionFactor`/`tint`) are NOT leaked onto the View; children preserved. |
| A-05 | **package-isolation** | `designTokens.ts` was NOT edited on this branch (`git diff origin/main...HEAD`); `GlassBlur` introduces no `app-mobile`/`mingla-business` import (I-MOR-0827). |

These attack different properties than the happy-path: A-01/A-02 assert rendered iOS/web element identity (happy-path only does a single `return <BlurView {...props}/>` regex); A-03 executes the actual tint decision over the full light/dark/unknown space (happy-path only checks the helper *exists*); A-04 asserts rendered output + prop-stripping (happy-path checks alpha of two string consts); A-05 asserts the branch diff (happy-path only greps imports). This is NOT a renamed copy of the happy-path.

### 3.1 Green run (on the real fix)

```
META-ORCH-1002 Sub-C — TESTER ADVERSARIAL behavioral check (rendered output)
  [PASS] A-01 iOS renders the REAL BlurView with blur props forwarded and NO opaque fill
  [PASS] A-02 mobile-web renders a plain <View> (blur skipped, no Android opaque fill); desktop-web keeps BlurView
  [PASS] A-03 every '*Light' tint -> light fill; dark/default/undefined/unknown -> dark fill (no silent mis-route, no throw)
  [PASS] A-04 Android NEVER renders a BlurView; opaque fill >=0.92; blur-only props not leaked onto the View; children preserved
  [PASS] A-05 designTokens.ts NOT edited on this branch AND GlassBlur introduces no app import (I-MOR-0827)
Summary: 5/5 PASS   (exit 0)
```

### 3.2 Fails-on-revert proof

Reverted `packages/event-rendering/GlassBlur.tsx` to its pre-Sub-C state via `git checkout 239b83b2d^ -- packages/event-rendering/GlassBlur.tsx` (the Sub-C fix landed in commit **`239b83b2d`**; `239b83b2d^` is the immediately-preceding state where the file returns `<BlurView {...props}/>` on every native platform incl. Android). With the Android branch removed:

```
META-ORCH-1002 Sub-C — TESTER ADVERSARIAL behavioral check (rendered output)
  [PASS] A-01 iOS renders the REAL BlurView with blur props forwarded and NO opaque fill
  [PASS] A-02 mobile-web renders a plain <View> ...; desktop-web keeps BlurView
  [FAIL] A-03 every '*Light' tint -> light fill; dark/default/undefined/unknown -> dark fill ...
         light-family routed wrong: [light, systemMaterialLight, extraLight, systemThinMaterialLight];
         dark/default/unknown routed wrong: [dark, default, undefined, prominent, systemUltraThinMaterialDark, regular]; threw=false.
  [FAIL] A-04 Android NEVER renders a BlurView; opaque fill >=0.92; blur-only props not leaked ...
         blurLeak=true belowAlphaFloor=true leakedBlurProps=true.
  [PASS] A-05 designTokens.ts NOT edited ...
Summary: 3/5 PASS (2 FAIL)   (exit 1)
```

The revert flips A-03 + A-04 to FAIL because, when **rendered**, Android now falls through to `return <BlurView {...props}/>` → the element is a `BlurView` with leaked blur props and no opaque fill, and every tint mis-routes. This proves the test exercises actual rendered behavior, on a different axis than the happy-path (which fails T-01/T-02 on the *absent source pattern*). A-01/A-02/A-05 correctly stay PASS on revert — iOS/web/isolation are genuinely unchanged by removing the Android branch, confirming those assertions are precise and not falsely coupled to the fix.

Restored to `HEAD` (`git checkout HEAD -- packages/event-rendering/GlassBlur.tsx`); working tree clean; adversarial re-run → **5/5 PASS, exit 0**.

### 3.3 Implementor happy-path cross-check (gate clause 2)

Confirmed the implementor's happy-path test exists, runs green (`9/9 PASS`, exit 0), and the implementation report cites fails-on-revert at commit `53e28e7128b03f123b3af383894a37979414e288` (`5/9 PASS, 4 FAIL` on revert). Independently re-ran the happy-path against the same `239b83b2d^` revert state used above and reproduced the documented `5/9 PASS (4 FAIL)`, exit 1 (T-01 ×2 + T-02 ×2 FAIL). The implementor claim is verified, not trusted.

### 3.4 Both tests ship together (gate clause 3)

`git diff origin/main...HEAD --name-only` includes `packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-check.mjs` (happy-path, already committed). The adversarial test `packages/scripts/ci/meta-orch-1002-sub-c-shared-glass-adversarial-check.mjs` is committed on this branch alongside this report, so it joins the same diff. Both ship with the fix in the closing PR.

---

## 4. Source-level verification (SC matrix)

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-C1 (Android) | opaque ≥0.92 View fill, tint-keyed, not BlurView | PASS (source+behavioral) | `GlassBlur.tsx:79-97` Android branch; A-03/A-04 render-assert dark/light ≥0.92, no BlurView. |
| SC-C1-iOS | iOS keeps real `<BlurView {...props}/>` | PASS | `GlassBlur.tsx:98`; A-01 renders BlurView with blur props forwarded, no opaque fill. |
| SC-C1-web | mobile-web blur-skip + desktop BlurView byte-identical | PASS | `GlassBlur.tsx:70-74` unchanged vs `239b83b2d^` (diff shows only +Android block); A-02 renders plain View @ <768, BlurView @ ≥768. |
| SC-C2/C3 (Android) | all 10 panels solid frosted, no ring | PASS (source) / DEFERRED (pixel) | All 10 call sites are decorative `absoluteFill` first-child layers with no own `backgroundColor`; parents clip (`overflow:'hidden'`+radius). Verified by implementor read + spec §2.3; on-device pixel = orchestrator's deferred business-build leg. |
| SC-C4 | cover cards keep `overflow:'hidden'` | PASS | A-04-equiv (happy-path T-04) + `EventCoverMedia.tsx` / `EventCover.tsx` retain `overflow:'hidden'`. |
| SC-C5 (isolation) | no app imports; only `packages/*` touched; `designTokens.ts` untouched | PASS | A-05 (`git diff` shows no `designTokens.ts` edit + no app import); branch diff = `GlassBlur.tsx` + 2 test scripts + 2 artifacts only. |

### Blast radius
`GlassBlur` is consumed by `PublicEventPage.tsx` (×1) + `PublicBrandPage.tsx` (×9) in the shared `@mingla/event-rendering` / `@mingla/brand-rendering` packages. Single shared code path → Android parity automatic across both Mingla apps. iOS/web branches byte-identical → zero regression risk to those surfaces (proven behaviorally by A-01/A-02). No `app-mobile`/`mingla-business` source touched (diff-confirmed) → no collision with Sub-B/Sub-D worktrees.

### Typecheck
The implementor documents 0 new `tsc` errors (234 pre-existing business-baseline worktree node_modules-resolution noise, identical with/without the fix). The change is a pure `Platform.OS` branch using standard object-rest destructure + array style; my destructure-and-render harness confirms the runtime shape is valid (no leaked props, children preserved). No new type surface introduced.

---

## 5. Constitution spot-check (relevant rules)

- **Rule 3 (no silent failures):** PASS — Android branch always renders a visible opaque View; A-03 confirms no tint throws.
- **Rule 8 (subtract before adding):** PASS — single guarded branch above the iOS return; nothing layered on broken code.
- **Rule 9 (no fabricated data):** N/A — presentational only.
- **I-7 (visible degradation, no null):** PASS — Android renders a visible opaque View, never null (A-04 children preserved).
- **I-MOR-0827 (package isolation):** PASS — A-05.

---

## 6. Findings

- **P0:** none
- **P1:** none
- **P2:** none
- **P3 — packaging wiring (informational):** Neither the implementor's happy-path nor this adversarial test is wired into a package `test` script — there is no `package.json` in `packages/scripts`, and no CI workflow references either `.mjs`. The first-strike (app-mobile) equivalent IS wired (`app-mobile/package.json` → `test:meta-orch-1002`). Per the dispatch ("wire it into the package test script **if** the happy-path one is wired"), no wiring is required here because the happy-path one is NOT wired; both run as standalone `node` invocations. Flagged for the orchestrator to optionally add a `packages/scripts` runner or a CI job at CLOSE so the gate runs on every PR rather than on-demand. Not a blocker.
- **P4 — praise:** Clean, minimal, correctly-guarded fix. Blur-only props are properly destructured out of the Android `View` (no invalid-prop leak), tint mapping is total (every tint resolves, unknown → safe dark default), and the diff is surgically scoped to `packages/*`. iOS + web are provably byte-identical (A-01/A-02 stay green on revert).

---

## 7. Verdict

**CONDITIONAL PASS (source + behavioral)** — pending the orchestrator's deferred Android on-device business-render leg.

- Source-level + behavioral contract: **PASS** — all 6 SCs verified; adversarial test 5/5 green, fails-on-revert proven on a different axis than the happy-path (commit `239b83b2d^`); happy-path cross-checked 9/9 + 5/9-on-revert; zero P0/P1.
- The verdict is CONDITIONAL (not full PASS) solely because the Phase-0.A Android live-fire leg — required for full PASS on a UI/runtime change — was intentionally DEFERRED to the orchestrator per dispatch (dev-build drift blocking the business Android build). No emulator boot was attempted. iOS + web legs are no-op (branches byte-identical, behaviorally proven). This deferral is the orchestrator's business-build decision, not a tester shortcut.

**Regression-test gate:** SATISFIED — (1) tester adversarial test present + green + fails-on-revert on a distinct axis; (2) implementor happy-path present, green, fails-on-revert cited @ `53e28e7`, independently reproduced; (3) both tests in `git diff origin/main...HEAD --name-only`.

**Sim evidence:** Android = DEFERRED to orchestrator (dev-build drift; no boot per dispatch). iOS = exempt/no-op (BlurView branch byte-identical, behaviorally proven A-01). Web = exempt/no-op (blur-skip branch byte-identical, behaviorally proven A-02).

**Discoveries for orchestrator:**
- P3 wiring note above — consider a CI runner for the two `packages/scripts/ci/*.mjs` gates at CLOSE.
- On-device Android business-render proof remains the only open item for full PASS; it rides the orchestrator's business dev-build fix.
