# QA — ORCH-1136 R3 [biz-web sheet animation: compositor CSS transition on web]

**Phase:** TEST (mingla-tester, business side). **Mode:** TARGETED + SPEC-COMPLIANCE.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1136-[biz-web-shell-bugs-r2]/` on branch `ORCH-1136-biz-web-sheet-anim-r3`.
**Under test:** commits `f95785386` (fix) + `80a864863` (report hash) + `7572732a7` (tester adversarial test).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1136_R3_SHEET_ANIM.md`. **Report:** `Mingla_Artifacts/IMPLEMENT_ORCH-1136_R3_SHEET_ANIM.md`.
**Comms ledger:** scanned on entry — no `BLOCK`/`OPEN` row addressed to `mingla-tester`, `ORCH-1136`, or `ALL` bearing on a web-only animation fix. COMMS-0029 (WARN, `biz_update_live_trip` migration clobber) is irrelevant to this UI-primitive change. Nothing to ack.

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise).

Every **mechanical** success criterion is PROVEN: the new gate fails-on-revert on two independent angles, the native reanimated path is byte-identical, the DIAG is fully reaped with a non-silent handler, the runtime harness demonstrates the compositor advancing 76px under a 220ms main-thread block (vs 11px frozen on revert), the web bundle compiles EXIT 0, the close-before-unmount timing contract holds across all 5 primitives, and a transform/opacity-only (no-reflow) contract is enforced. The implementor's jest fails-on-revert was independently re-run.

The CONDITIONAL is **purely** because SC-1..SC-4 (perceived snappiness on a heavy authed Hub/event page) and SC-5 (native parity on a real device) require an **authed login + a physical/sim device I do not have** — these are `suspected`/source-proven only and cannot be lifted to `proven` without Seth's runtime pass. Per the Phase-0.A confidence ladder, UI/runtime PASS is forbidden without live-fire. The mechanical layer is airtight; the human-eyeball layer is Seth's short checklist (§9).

No P0/P1 findings. No REWORK required. Route to Seth for the authed checklist, then CLOSE.

---

## 2. SC-by-SC matrix

| SC | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| SC-1-Web | Brand switcher slides down on heavy Hub, no mid-slide freeze | **SUSPECTED (authed)** | `TopSheetWeb` CSS `transform 280ms/240ms` present + gate INV-1 GREEN; harness Part A proves compositor advances 76px under a 220ms block. Perceived-snappiness on the authed Hub → Seth §9.1. |
| SC-2-Web | Event ⋯ menu opens immediately; no `[DIAG]` toast | **PARTIAL-PROVEN** | DIAG reaped (zero `[ORCH-1136-DIAG]` markers repo-wide, §4); `Sheet.web` CSS scale+fade 200/180ms present, reanimated import removed. "Immediate-on-heavy" perception → Seth §9.3. |
| SC-3-Web | Creator "+" compact sheet snappy after first measurement | **SUSPECTED (authed)** | `compactReady` gate re-fires the next-frame flip when `panelHeight` 0→measured (TopSheet.tsx:627/637/657) — slides from measured off-screen, not −0px. Eyeball → Seth §9.4. |
| SC-4-Web | Modal/Toast/bottom-sheet glide on heavy page | **SUSPECTED (authed)** | `ModalWeb` 200/160ms, `ToastWeb` 220/160ms, `SheetWeb` 280/240ms — all compositor CSS, gate GREEN. Eyeball → Seth §9.5. |
| SC-5-Native | iOS+Android byte-identical to pre-change | **PROVEN (source) / SUSPECTED (device)** | Native reanimated statement-set is a strict superset-with-zero-removals vs origin/main for all 5 files (§3); dispatch is `Platform.OS==='web'`. Device parity → Seth §9.6. |
| SC-6 | transform/opacity only — no layout/reflow animation | **PROVEN** | Every `transition:` references only transform/opacity (§3); gate INV-2 GREEN + jest no-layout; INV-2 fails-on-revert proven (height injected → exit 1). |
| SC-7 | No-fixed invariant stays GREEN | **PROVEN** | `i-proposed-topsheet-web-viewport-anchor.mjs` → exit 0; only `position:'fixed'` matches are in comments documenting the ban. |
| SC-8 | Close transition completes before unmount | **PROVEN** | UNMOUNT_DELAY_MS ≥ close+40 for all 5 (TopSheet 280≥280, SheetMobile 280≥280, Modal 200≥200, Toast 200≥200, Sheet.web 220≥220); enforced numerically by my adversarial test Angle 1 (fails-on-revert proven). |
| SC-9 | Reduce-motion: opacity-only, no translate/scale | **PROVEN (source)** | `useWebReducedMotion()` (matchMedia, zero reanimated hooks) drives opacity-only branch in every web variant (§7). OS-toggle eyeball → Seth (optional). |
| SC-10 | Regression harness fails-on-revert | **PROVEN (runtime)** | `assert_fails_on_revert.mjs` PASS exit 0 (compositor advances 76px); reverting css.html to a per-frame `style.transform` rAF write → exit 1 (advanced only 11px + Part B compositor=false). |

---

## 3. Native byte-identical verdict — PROVEN (source)

For **all 5 primitives**, every change is a `Platform.OS==='web'` dispatch to a NEW web component; the native variant is the pre-change body.

- **TopSheet:** the native animation region (`useSharedValue`/`withTiming` entry+exit effects/`cancelAnimation`/Escape/Android-back/`panGesture`/`useAnimatedStyle`) diffs **byte-identical** (modulo line offset) against origin/main's `TopSheet`. The only native restructure is extracting the L1–L4 glass-stack into a shared `TopSheetPanelInner` (consumed by both variants) — zero animation-control-flow change; native render still uses `panelStyle`/`scrimStyle`/`WebSafeGestureDetector`/`Animated.View`/`compactInvisible` identically.
- **SheetMobile / Modal / Toast:** diffing the set of reanimated animation statements (`withTiming`/`withSpring`/`useSharedValue`/`useAnimatedStyle`/`cancelAnimation`/`.value =`/`runOnJS`) old-vs-new shows **zero removed lines** (`diff | grep '^<'` empty for all three). Every "added" line is either a JSDoc comment naming withTiming/withSpring, or the **web** variant's `cancelAnimationFrame` browser-API call (a substring my grep caught). The native reanimated path is preserved verbatim. Reanimated is still imported in each (native needs it).

Device-level visual/timing parity (SC-5) is `suspected` only — needs Seth's iOS sim + Android emu / physical eyeball.

---

## 4. DIAG-reap confirmation — PROVEN

- Repo-wide scan: **zero** `[ORCH-1136-DIAG]` / `[DIAG]` markers in product code (`grep -rn` over `mingla-business/`, excluding node_modules/tests/artifacts).
- `handleManageOpen` (`app/event/[id]/index.tsx:164`) restored to a normal, NEVER-silent handler: `if (brand === null) { setToast("Loading brand… tap again in a moment."); return; } setManageMenuVisible(true);`, dep array `[brand]`. **Const #1 (no dead taps) satisfied** — the only non-open path emits explicit feedback; there is no silent no-op branch.

---

## 5. Strict-grep gate — fails-on-revert PROVEN (2 independent angles)

`i-proposed-1136-web-sheet-css-transition.mjs`:
- **On the fix:** `--self-test` → exit 0; gate run → exit 0, "PASS · violations=0" (15 OK lines across the 5 primitives × INV-1/2/3).
- **Fails-on-revert #1 (INV-1):** neutralizing the web CSS `transition:` in TopSheet (true mutation, `transition:`→`animDriver:`) → **node exit 1** (INV-1 violation: "compositor path removed"). Restored → exit 0.
- **Fails-on-revert #2 (INV-2):** injecting a `height` layout property into a web `transition:` → **node exit 1** (INV-2 violation: layout/reflow animation). Restored → exit 0.
- **Registration:** header registry line (`.yml:131`) + CI job `i-proposed-1136-web-sheet-css-transition` (`.yml:2348-2359`) with a self-test step then a run step. Confirmed wired into `strict-grep-mingla-business.yml`.
- **No regression on prior gates:** `i-proposed-topsheet-web-viewport-anchor.mjs` (no-fixed) → exit 0; `i-proposed-c-brand-crud-via-react-query.mjs` (no setBrands) → exit 0, "scanned 1180 files · 0 violations".

---

## 6. Harness result — PASS (runtime, stronger than the report's caveat)

`Mingla_Artifacts/evidence/ORCH-1136-R3/assert_fails_on_revert.mjs` run in headless Chromium (Playwright present; `PLAYWRIGHT_BROWSERS_PATH` cache present):
- **PASS exit 0.** Part A: css.html panel `blockStart −403px → blockEnd −327px = advanced 76px` during a 220ms main-thread block (assert ≥60px) — the compositor advanced the slide **while the main thread was frozen**, which the JS-rAF path physically cannot. Part B: css.html=compositor (transition:transform + will-change + no per-frame write), model.html=starvable (per-frame `style.transform=` in rAF).
- **Fails-on-revert (runtime, my mutation):** reverting css.html's `__open` to a per-frame `style.transform` rAF write → **exit 1**: Part A advanced only **11px** (frozen — the freeze the fix removes) AND Part B `compositor=false`. Restored → exit 0. This is a *runtime* fails-on-revert, going beyond the implementor's honest "Part B is the deterministic anchor" note — the 76px-vs-11px split directly distinguishes the fix from the reverted shape at runtime.

---

## 7. Reduce-motion + transform/opacity-only

- Every web `transition:` (TopSheet ×2, Sheet.web ×2, SheetMobile ×2, Modal ×2, Toast ×1) references **only** `transform`/`opacity` — no `height`/`top`/`width`/`left`/`right`/`bottom` (SC-6, confirmed by grep + gate INV-2 + jest).
- Reduce-motion: `useWebReducedMotion()` (a direct `matchMedia('(prefers-reduced-motion: reduce)')` hook calling ZERO reanimated hooks) drives an opacity-only branch in every web variant (SC-9). Behavior matches the native `useReducedMotion` contract.

---

## 8. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the worktree at HEAD (`f95785386`/`80a864863`) and ran the implementor's jest happy-path suite:
- **Restored state:** `orch1136R3WebSheetCssTransition.test.ts` → **20/20 PASS**.
- **Fails-on-revert (true line deletion):** `sed 's/transition:/animDriver:/g'` on `TopSheet.tsx` (removing the web CSS transition) → the assertion **"TopSheet.tsx drives its web animation via a CSS transition…" FAILED** (1 failed, 19 passed). Restored → **20/20 PASS**, working tree clean. Matches the implementor's claimed `fails-on-revert verified at f95785386`.

---

## 9. Adversarial test added (tester-owned, DIFFERENT angle)

- **Path:** `mingla-business/src/components/ui/__tests__/orch1136R3WebSheetCloseTimingAndHookPurity.test.ts`
- **Commit:** `7572732a7` (on-branch, in `git diff origin/main...HEAD` alongside the implementor's test).
- **Angle (vs the implementor's file-level CSS-transition presence check):**
  1. **SC-8 numeric close-before-unmount contract** — parses each primitive's `UNMOUNT_DELAY_MS` and its web close-duration constant from source and asserts `UNMOUNT_DELAY_MS ≥ closeDuration + 40ms` (the implementor's test never reads the numbers; a shrunk timer would pop an element mid-close undetected).
  2. **Web-variant hook purity** — slices each `*Web` component *body* (not the whole file) and asserts it contains **zero** `useSharedValue`/`useAnimatedStyle`/`withTiming`/`withSpring`/`cancelAnimation` — the actual F-1 freeze source. A file-level "still imports reanimated" check (the implementor's) is satisfied even if the web body called a reanimated hook (native import is shared); mine catches that.
- **Result:** 14/14 PASS.
- **fails-on-revert verified at `7572732a7`:** (a) Modal `UNMOUNT_DELAY_MS` 200→100 → Angle-1 assertion FAILED; (b) injecting `withTiming` into `TopSheetWeb`'s body → Angle-2 assertion FAILED; restored → 14/14 PASS, tree clean.

---

## 10. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **PASS** | DIAG reaped; `handleManageOpen` keeps the non-silent brand-not-resolved toast guard (§4). |
| 2 | One owner per truth | PASS | Animation state local to each primitive; no competing writer introduced. |
| 3 | No silent failures | PASS | The reaped handler emits explicit feedback; no swallowed catch added. |
| 4 | One query key per entity | N/A | No query/cache change. |
| 5 | Server state stays server-side | **PASS** | Brand-list stays in React Query; no `setBrands()` (gate I-PROPOSED-C GREEN, 0 violations). |
| 6 | Logout clears everything | N/A | No auth/session state. |
| 7 | `[TRANSITIONAL]` labeled | PASS | None introduced (implementor §10). |
| 8 | Subtract before adding | PASS | Reanimated removed from Sheet.web web path; DIAG block deleted. |
| 9 | No fabricated data | N/A | Pure animation. |
| 10 | Currency-aware | N/A | — |
| 11 | One auth instance | N/A | — |
| 12 | Validate at the right time | N/A | — |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup gate | N/A | — |

Zero violations.

---

## 11. Device / parity matrix

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS (`app-mobile/`) | N/A | Different app; out of ORCH scope. |
| Consumer Android | N/A | Same. |
| Buyer/anon Web (`mingla-business` public) | **AUTO (inherited)** | Inherits the web-gated CSS transition if it mounts a primitive; no public-page behavior targeted. |
| Business iOS | **SUSPECTED (device)** | Native byte-identical proven at source (§3); on-device visual/timing parity → Seth §9.6. |
| Business Android | **SUSPECTED (device)** | Same. |
| **Business Web** | **PARTIAL-PROVEN** | Bundle compiles EXIT 0; gates GREEN; harness proves compositor advance. Perceived snappiness on authed heavy pages → Seth §9.1–9.5. |
| Admin Web | N/A | Separate app. |

**Physical-device / authed-web HITL:** BLOCKED for me (no login, no device) — the named unblock is Seth's §9 checklist below. Not a silent downgrade: the mechanical layer is fully `proven`; only the perceived-runtime layer is deferred to Seth with an explicit ask.

### Bundle compile (mechanical, done)
`npx expo export -p web` in a bracket-free clean checkout (`/tmp/orch1136r3-clean`, real node_modules, HEAD source synced) → **EXIT 0**, "Exported: dist", zero errors.

### Pre-existing failure confirmed unrelated (Discovery)
`eventCoverMedia.test` (5 fails) is RED on HEAD. R3 touches **zero** eventCoverMedia files; the failing test files AND their sources (`eventCoverMedia.test.ts`, `eventCoverMediaService.test.ts`, `EventCoverMedia.tsx`, `eventCoverMediaService.ts`) are **byte-identical between origin/main and HEAD** → pre-existing worktree/main break, not caused by R3. The full `src/components/ui/__tests__` suite is otherwise green (14 suites pass, 1 pre-existing fail). The `Sheet.web` `cursor` tsc error + `packages/phone-input/*` missing-react-types are likewise pre-existing (identical source vs origin/main).

---

## 12. Discoveries for orchestrator

1. **[MED] `eventCoverMedia.test` RED in this worktree, independent of ORCH-1136** — 5/43 fail with R3 source byte-identical to origin/main. Pre-existing; recommend a rebase/triage pass on origin/main itself (the failure likely exists on main).
2. **[LOW] `Mingla_Artifacts/evidence/` is gitignored** — only `assert_fails_on_revert.mjs` was force-added; `css.html`/`model.html` (the harness fixtures it depends on) are on-disk evidence only. If CLOSE wants the harness reproducible in CI, force-add those two as well.
3. **[INFO] The harness fails-on-revert is runtime-demonstrable, not just source-contract** — my mutation showed 76px (fix) vs 11px (revert) panel advance under the block. The implementor under-claimed this in their report (§6 honesty note). Worth recording in the harness header for future rounds.
4. **[INFO/P4 praise]** Clean web/native split via component dispatch (`TopSheetWeb`/`TopSheetNative` + shared `TopSheetPanelInner`) is a replicable pattern for any future RN-web reanimated-freeze fix; the web variants calling ZERO reanimated hooks also closes the long-standing reanimated-on-web fragility class for these primitives.

---

## 13. Accepted conditions (CONDITIONAL PASS)

The verdict is CONDITIONAL solely on Seth's authed/device runtime pass (no P1/P2 to accept — every finding is mechanically PROVEN or N/A). **Seth authed checklist** (the only gap between CONDITIONAL and full PASS):

1. **SC-1** — `business.usemingla.com`, signed in, **Hub events** page (heavy). Tap the brand chip → switcher **slides down snappily (~280ms), no linger/freeze near the top**; close → slides up cleanly (~240ms).
2. **SC-2** — Open an **event detail** page (heavy). Tap **⋯** → manage menu **appears immediately** (fade+scale), **no `[DIAG]` toast**.
3. **SC-3** — Tap **"+"** (creator) on a heavy page → compact sheet **slides down snappily after it measures**, no mid-slide freeze.
4. **SC-4** — Trigger a **modal**, a **toast** (e.g. save), and a **narrow-web bottom sheet** (window < 1024px) on a heavy page → each glides, no freeze.
5. **SC-5** — On **iOS + Android** apps, open the same sheets → animations look **exactly as before** (no change).
6. *(Optional)* Performance-tab capture of the Hub brand-chip tap to NAME the live long-task (lifts F-2 to proven; not a gate).

If all pass → full PASS → CLOSE. If any sheet still freezes on a heavy page → FAIL → REWORK (cite the SC + surface).
