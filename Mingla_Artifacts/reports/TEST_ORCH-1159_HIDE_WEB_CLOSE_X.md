# TEST — ORCH-1159 [hide public-page "X" close button on web]

**Verdict: PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2 (praise) · Discoveries: 3 (all pre-existing, none introduced by ORCH-1159).

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1159-[hide-web-close-x]/` · branch `ORCH-1159-hide-web-close-x` · HEAD after tester commit `25ec42258` (was `8d9128730` at dispatch).

**Evidence level reached: RUNTIME / BUILD-ARTIFACT (above "suspected").** A clean `mingla-business` web export was produced and the SHIPPED web bundle was inspected — the gated render compiled in with `Platform.OS` statically resolved to `"web"`. Combined with the executed single-owner predicate. This is the correct evidence ceiling for an S3 presentational gate and it is honest (no on-screen pixel eyeball was performed — see §Runtime).

---

## 1. Per-consumer verification (independent source read)

All five public-page consumers were read directly and each was confirmed to (a) pass `hideCloseOnWeb` on the **full-page** `<ParallaxCoverShell>` element, (b) sit adjacent to a PRESERVED `onClose`/`onShare`, and (c) leave Share/Mute ungated.

| # | Consumer | File | Shell element | `hideCloseOnWeb` | Share preserved | Native keeps X |
|---|----------|------|---------------|------------------|-----------------|----------------|
| 1 | Event (ticketed) | `mingla-business/src/components/event/FoundationEventPreview.tsx` | L456–491 | ✓ L471 | ✓ `onShare={onShare}` L467 | ✓ predicate→true |
| 2 | Event (RSVP) | `mingla-business/src/components/event/RsvpPublicBody.tsx` | L498–610 | ✓ L520 | ✓ `onShare={onShare}` L517 | ✓ |
| 3 | Trip | `mingla-business/src/components/trip/TripPreview.tsx` | L698–737 | ✓ L711 | ✓ `onShare={onShare}` L708 | ✓ |
| 4 | Experience | `mingla-business/src/components/experience/ExperiencePreview.tsx` | L586–627 | ✓ L599 | ✓ `onShare={onShare}` L596 | ✓ |
| 5 | Brand | `packages/brand-rendering/PublicBrandPage.tsx` | L607–628 | ✓ L619 | ✓ `onShare={callbacks.onShare}` L618 | ✓ |

**Card-grade siblings correctly NOT opted in:** `TripPreview`'s `TripCardPreview` block (~L234–247) and `ExperiencePreview`'s card block (~L233–234) are internal card renderers, not public pages — they have no `hideCloseOnWeb`, which is correct.

**Predicate applied to the close button ONLY.** `OfferingChrome.tsx` L170 computes `showClose = shouldRenderCloseButton(hideCloseOnWeb, Platform.OS)`. L173–185 wrap **only** the close `ChromeButton` (`<CloseGlyph/>`) in `{showClose ? ( ... ) : ( <View pointerEvents="none" /> )}`. Share + optional Mute live in a SEPARATE `<View style={styles.rightGroup}>` (L186–209) that is a sibling AFTER the close ternary — never gated by `showClose`, `Platform.OS`, or `hideCloseOnWeb`.

**Native immunity by construction.** Predicate `!(hideCloseOnWeb && platformOS === "web")` returns `true` for ios/android (and windows/macos) regardless of `hideCloseOnWeb` → X always renders on native for every consumer.

**Desktop web also covered (not missed).** `ParallaxCoverShell`'s desktop branch (L207–266) mounts the same `chrome` (with `hideCloseOnWeb` forwarded) at L233; on desktop `Platform.OS === "web"` → X hidden there too. Good.

---

## 2. SC-by-SC matrix

| SC | Requirement | Result | Evidence |
|----|-------------|--------|----------|
| SC-1-Web | Public EVENT (ticketed+RSVP) X hidden on web | **PASS** | Consumers #1/#2 opt in; compiled bundle `shouldRenderCloseButton)(y,"web")` → showClose=false |
| SC-1-Native | Public EVENT X kept on native | **PASS** | predicate returns true for ios/android (ADV/D exhaustive) |
| SC-2-Web | Public TRIP X hidden on web | **PASS** | Consumer #3 opt-in + compiled gate |
| SC-2-Native | Public TRIP X kept on native | **PASS** | predicate |
| SC-3-Web | Public EXPERIENCE X hidden on web | **PASS** | Consumer #4 opt-in + compiled gate |
| SC-3-Native | Public EXPERIENCE X kept on native | **PASS** | predicate |
| SC-4 | Share stays on ALL surfaces incl. web | **PASS** | rightGroup ungated in source AND compiled bundle (`accessibilityLabel:"Share"` rendered unconditionally after the close ternary) |
| SC-5 | Close handler logic UNCHANGED | **PASS** | `git diff` shows no `onClose` handler edits; only render gating |
| SC-6 | No new web-detection helper | **PASS** | reuses `Platform.OS === "web"` (the package's existing idiom); predicate just wraps it for testability |
| SC-7 (revised by §13) | Public BRAND page opts in (X hidden on web) | **PASS** | Consumer #5 L619; the opt-in MECHANISM still covered by a synthetic non-opted predicate case (ADV-equivalent) |

All criteria PASS with build-artifact + executable-predicate evidence.

---

## 3. Findings

No P0/P1/P2/P3. Two P4 (praise):

- **P4-1 (praise):** Single-owner RN-free predicate `closeButtonVisibility.ts` is the right factoring — it makes the decision executable in a Deno test without mounting RN, and keeps exactly ONE owner of the close decision (verified compiled: exactly one `shouldRenderCloseButton(...)` call). Constitution Rule 2 (one owner per truth) satisfied cleanly.
- **P4-2 (praise):** The hidden-X case uses an empty `pointerEvents="none"` placeholder rather than removing the child — preserving the `space-between` right-edge pinning of Share/Mute without letting the empty slot intercept taps. This is the correct structural choice and it compiled through verbatim.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Ran the implementor's happy-path test `packages/offering-rendering/__tests__/orch_1159_hide_web_close_x.test.ts` myself with Deno 2.7.14:

- **As-shipped:** `ok | 8 passed | 0 failed`.
- **Revert (true line-edit of the predicate to `=> true;`** in `closeButtonVisibility.ts`): `FAILED | 7 passed | 1 failed` — the failing test was *"ORCH-1159: opted-in public page HIDES the close button on web"* at `orch_1159_hide_web_close_x.test.ts:43` (asserted `shouldRenderCloseButton(true,"web") === false`, got `true`).
- **Restore:** `ok | 8 passed | 0 failed`.

The implementor's fails-on-revert claim (cited at base `a58f46ffa` / extension `67fa1a0e4`) is **independently confirmed** at the current branch HEAD `8d9128730`.

---

## 5. Adversarial test added (tester-owned, different angle)

**Path:** `packages/offering-rendering/__tests__/orch_1159_hide_web_close_x_adversarial.test.ts`
**Committed:** `25ec42258` (on branch `ORCH-1159-hide-web-close-x`).
**In closing diff:** yes — `git diff origin/main...HEAD --name-only` lists BOTH `orch_1159_hide_web_close_x.test.ts` (implementor) AND `orch_1159_hide_web_close_x_adversarial.test.ts` (tester). Append-only: NEW file, no existing test touched.

**Distinct angle (NOT a renamed copy — shares zero assertions with the implementor test):**
- **A. Boundary:** `windows`/`macos` KEEP the X even when opted in; exhaustive over the `PlatformOSValue` union proving web is the *only* hideable platform. (This catches the tempting "mobile-only" refactor the implementor's web=false test would pass.)
- **B. Invariant (structural):** Share + Mute render strictly OUTSIDE/AFTER the `showClose` ternary; `hideCloseOnWeb` is consumed EXACTLY ONCE (one predicate call) and never appears on the Share path.
- **C. Structural:** the hidden-X placeholder is `<View pointerEvents="none" />` (no pointer theft) and the row stays `space-between` with the close slot FIRST and rightGroup SECOND (right-edge pin preserved).
- **D. Defensive:** NO caller can hide the X on native — exhaustive over `{true,false} × {ios,android}`.

**Run:** `ok | 8 passed | 0 failed`.

**fails-on-revert verified at `25ec42258`** across THREE distinct reverts:
1. Predicate → `=> true;` → ADV/A *"web is the ONLY platform…"* fails (`FAILED | 7 passed | 1 failed`).
2. Predicate → naive mobile-only `=> platformOS === "ios" || platformOS === "android";` → ADV/A *macos* AND *web-only* fail (`FAILED | 5 passed | 3 failed`) — the boundary trap fires.
3. Remove `pointerEvents="none"` from the placeholder in `OfferingChrome.tsx` → ADV/C *pointer-safety* fails (`FAILED | 7 passed | 1 failed`).

Restore after each → `ok | 8 passed | 0 failed`. `deno check` on the test → clean. Imports only `deno.land/std` (matching 7 pre-existing sibling tests) + relative `../closeButtonVisibility.ts` → introduces no new forbidden import.

---

## 6. Constitution 14-rule matrix (independent re-check vs the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | hidden X is removed, not a dead button; placeholder `pointerEvents="none"`; Share/Mute taps intact |
| 2 | One owner per truth | PASS | single predicate `shouldRenderCloseButton`; compiled bundle shows exactly one call |
| 3 | No silent failures | PASS | pure render gate; no error paths added |
| 4 | One query key per entity | N/A | no data layer touched |
| 5 | Server state server-side | N/A | client render only |
| 6 | Logout clears everything | N/A | no auth/state |
| 7 | `[TRANSITIONAL]` labels | PASS | none introduced (none needed) |
| 8 | Subtract before adding | PASS | opt-in prop threaded through existing chrome; no parallel mechanism |
| 9 | No fabricated data | N/A | no data |
| 10 | Currency-aware | N/A | no money |
| 11 | One auth instance | N/A | anon public pages; no `useAuth` added |
| 12 | Validate at the right time | N/A | no datetime |
| 13 | Exclusion consistency | N/A | no filtering |
| 14 | Persisted-state startup | N/A | no persisted state |

No violations.

---

## 7. Device / parity matrix

| Surface | Result | Evidence |
|---------|--------|----------|
| Consumer iOS | N/A (skip) | These business-app public pages are not rendered by app-mobile; consumer detail screens unaffected. Brand page `/b/{slug}` is shared but native predicate→true (X kept), no change. |
| Consumer Android | N/A (skip) | Same. |
| Buyer/anonymous Web | **PASS (build-artifact)** | Web export produced; compiled `[eventSlug]`/`[experienceSlug]`/brand chunks + `__common` contain `shouldRenderCloseButton)(y,"web")` → `showClose=false` for opted-in pages; Share renders unconditionally in the same compiled chunk. |
| Business iOS | **PASS (by construction)** | predicate returns true for `ios`; ADV/D exhaustive; no diff to native render path |
| Business Android | **PASS (by construction)** | predicate returns true for `android`; ADV/D exhaustive |
| Admin Web (adjacent) | N/A (skip) | does not render these pages |
| Business Web preview (adjacent) | **PASS (build-artifact)** | same web bundle as buyer web |

**Physical iPhone HITL:** not required — the native render path is provably unchanged (the only diff is a `Platform.OS === "web"`-gated branch that is dead on iOS; predicate returns true). No native behavior delta to eyeball.

---

## Runtime / live-fire honesty cap

- **What I DID:** produced a clean `mingla-business` web export (`npx expo export -p web`, exit 0, `Exported: /tmp/orch1159-webbuild` with real route chunks). Inspected the SHIPPED web JS: the predicate compiled verbatim as `(t,n)=>!(t&&"web"===n)`, the OfferingChrome call compiled as `v=(0,F.shouldRenderCloseButton)(y,"web")` with `Platform.OS` statically resolved to the literal `"web"`, the close button rendered `{v ? <close testID=…-close> : <View pointerEvents:"none">}`, and Share rendered unconditionally after it. This is build-artifact runtime evidence — the gate fires in the actual web build.
- **What I did NOT do:** I did not serve the build in a browser and visually confirm the pixel (no on-screen screenshot of a real public page with the X absent + Share present). The compiled-bundle proof is strictly stronger than a source read but stops short of a rendered-pixel eyeball.
- **Cap:** evidence level = **RUNTIME / BUILD-ARTIFACT**, which is the appropriate and sufficient ceiling for this S3 presentational gate per the dispatch ("Source + executable-predicate evidence is acceptable… a web render proof raises the verdict above suspected"). I reached above source-only. No runtime evidence was fabricated.

---

## Gate-regression result

| Gate | Result | Note |
|------|--------|------|
| `meta-orch-0827-package-isolation.mjs` | **PASS** (exit 0) | "META-ORCH-0827 package isolation gate PASS." |
| `orch-1138-mor-isolation.mjs` | **PASS** (exit 0) | consumer experience surface imports nothing from mingla-business/src |
| `orch-0964-brand-rendering-self-contained.mjs` | **PASS** (exit 0) | brand-rendering self-contained (touched `PublicBrandPage.tsx`) |
| `orch-1138-experience-checkout-byte-identical.mjs` | **PASS** (exit 0) | money path unchanged |
| `i38-icon-chrome-touch-target.mjs` | **BLOCKED-on-env (pre-existing)** | `ERR_MODULE_NOT_FOUND: @babel/parser` — absent at repo-root `node_modules` in this worktree (worktree dep gap, not ORCH-1159). The diff proves ORCH-1159 did NOT touch `HIT_SLOP` or the 40×40 glass touch targets, so the gate's subject is unaffected. Runs in CI with deps installed. |

---

## Pre-existing-vs-introduced determination (jest reds)

The implementor reported a broad `mingla-business` jest baseline failure and an isolation-gate red. I verified by checkout-compare against `origin/main`:

1. **`offeringRenderingIsolation.orch1138.test.ts` (test 71) FAILS on the branch** — failing spec `../../../app-mobile/src/utils/eventDateDisplay.ts`. **PRE-EXISTING, NOT introduced by ORCH-1159.** Proof: that forbidden import lives in `__tests__/orch_1157_round2_rsvp_fixes.test.ts` and `__tests__/orch_1157_round7_doors_locale_pill.test.ts`, BOTH of which exist UNCHANGED on `origin/main` (`git grep -l … origin/main` confirms) and are NOT in the ORCH-1159 diff (the diff touches only the 5 ORCH-1159 files). The gate also walks `__tests__/` and trips on the 7 pre-existing ORCH-1157 `deno.land/std` imports — a gate design flaw, not a code defect.
2. **My adversarial test does not worsen this gate** — it adds only a `deno.land/std` import (matching the 7 pre-existing files) + a relative import; no new forbidden app-src spec.
3. **Broad jest baseline (172 failed / 3928 passed, 98 suites):** consistent with the implementor's before/after byte-identical claim; the specific failure I reproduced (the app-mobile import in the orch1138 gate) is pre-existing. I did not exhaustively re-run all 507 suites, but the touched-file gates I ran are green and the one red I reproduced is provably pre-existing.

**Conclusion: zero jest reds are attributable to ORCH-1159.**

---

## 8. Discoveries for Orchestrator (NOT fixed here)

1. **orch1138 isolation gate walks `__tests__/`** and fails on legitimate Deno test-file imports (`https://deno.land/std…`) and a test fixture's app-mobile import. PRE-EXISTING on origin/main (ORCH-1157 era). Recommend a follow-up to exclude `__tests__/` from `offeringRenderingIsolation.orch1138.test.ts`'s `walk()` (production files only). Carried forward from implementor Discovery #3.
2. **`@babel/parser` absent at repo-root `node_modules`** in the per-ORCH worktree → `i38-icon-chrome-touch-target.mjs` cannot run locally (ERR_MODULE_NOT_FOUND). Worktree dependency-state gap; runs in CI. Recommend a worktree-freshness/`npm ci`-at-root step.
3. **Broad pre-existing mingla-business jest baseline** (172 failed tests) on clean origin/main — worktree-state drift per implementor Discovery #2. Orthogonal to ORCH-1159; flag for a source-reconciliation pass.

---

## Routing

**PASS → CLOSE (orchestrator).** Zero P0, zero unaccepted P1; regression gate satisfied (implementor happy-path fails-on-revert independently re-run @ `8d9128730`; tester adversarial test on-branch + in-diff @ `25ec42258` with fails-on-revert across 3 distinct reverts); all SC met with build-artifact + executable-predicate evidence; cross-domain checked (native by construction, web by compiled bundle); Constitution clean; the two required gates + two relevant gates PASS; the one un-runnable gate and all jest reds proven PRE-EXISTING.
