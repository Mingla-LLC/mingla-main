# QA VERDICT — ORCH-1010 Business Marketing Redesign (`/organisers`)

**Phase:** 5 of 5 (TEST)
**Skill:** `mingla-tester` (production gatekeeper)
**Surface:** marketing web — `/organisers` business surface (`mingla-marketing/`), web-only
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1010-[marketing-business-rebrand-copy-design]/` on branch `ORCH-1010-marketing-business-rebrand-copy-design`
**Built at:** commit `e2e2dd2395ef81d30f4e23c10fc9ce72a838afb3`
**Tested against:** dev server on `localhost:3010` (real Chromium headless via Playwright)
**Date:** 2026-05-30

---

## VERDICT: **PASS**

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 | **P4:** 2
- All 8 hard checks pass with captured evidence.
- Both regression tests present in the closing diff; adversarial test attacks a proven-different angle.
- `tsc --noEmit` clean. Consumer `/` byte-for-byte unaffected (zero business-copy leakage, zero console errors, dark theme intact).

### Sim-gate disposition
Web-only surface. iOS Simulator + Android Emulator legs are **EXEMPT** (the `/organisers` page does not ship to native). The **web preview leg is `proven`**: real Chromium drove `localhost:3010` at 375 / 390 / 430 / 1280 px, with live computed-style contrast, DOM a11y inspection, reduced-motion emulation, and consumer-parity checks. This satisfies the Phase 0.A platform-leg requirement for a web-only surface.

### Comms ledger
Read on entry. No `BLOCK`/`WARN` entry targets `tester`, `ORCH-1010`, or `ALL` that is OPEN and actionable for this turn (COMMS-0001 is an ORCH-0955 WARN, unrelated). No new cross-ORCH discovery — change is wholly contained in `mingla-marketing/`. No ledger write warranted.

---

## HARD CHECK 1 — CONTRAST (the binding finding) ✅ PASS

Computed in a real browser from `getComputedStyle().color` composited over the real surface, WCAG ratio math applied. Verified at **375 / 390 / 430 / desktop**.

| Element | Computed color | Surface | Ratio | Threshold | Result |
|---|---|---|---|---|---|
| Hero accent "to show up for you." | `rgb(168,69,14)` = `#a8450e` (`text-warm-ink`) | parchment | **5.62:1** | ≥4.5 body | ✅ PASS (all 4 widths) |
| Primary button "Partner with Mingla" | label `rgb(14,14,16)` ink on `rgb(235,120,37)` warm fill | — | **6.65:1** | ≥4.5 body | ✅ PASS |
| Why-Mingla generic-left (×5 pairs) | `rgba(14,14,16,0.68)` (`text-text-secondary`) | vellum | **6.39:1** | ≥4.5 body | ✅ PASS (was failing `text-muted` 3.29) |
| Litany payoff "we should go there" | `rgb(168,69,14)` (`text-warm-ink`) | parchment | 5.62:1 | ≥4.5 | ✅ PASS |
| How-it-works step nodes (01–04) | `rgb(168,69,14)` (`text-warm-ink`) | vellum | 5.41:1 | ≥4.5 | ✅ PASS |
| Comparison accent (dark band) | `rgb(235,120,37)` (`text-warm`) | `#08090c` | **6.87:1** | ≥3 large | ✅ PASS |
| Comparison struck generic (dark) | `rgba(255,255,255,0.52)` (`text-muted`) | `#08090c` | **5.69:1** | ≥3 large | ✅ PASS |
| CTA accent (dark band) | `rgb(235,120,37)` (`text-warm`) | `#08090c` | 6.87:1 | ≥3 large | ✅ PASS |

**Binding-finding resolution confirmed live:**
1. Accent text on the light surface renders as `warm-ink` (`#a8450e`), **never** bare `text-warm` (`#eb7825`). The DOM scan flagged exactly two `#eb7825` text nodes — both are the **Comparison** and **CTA** eyebrows, which live inside `data-theme="dark"` `<SpotlightBand>` sections where `text-warm` is the *correct* token (6.87:1 on dark). Not a finding; this is the spec'd dark-band behavior (DESIGN PART 0.1 usage rule).
2. Primary buttons are ink-on-warm (`primary-ink` variant resolves to `bg-warm text-ink`), 6.65:1, 56px tall (≥44pt).
3. No `text-muted` eyebrow on a light surface survives (eyebrows are `text-warm-ink`); the why-mingla generic-left contrast regression is fixed to `text-text-secondary`.

Evidence: `qa_evidence_orch1010/playwright_results.txt`, `organisers_m375.png`, `organisers_desktop.png`.

---

## HARD CHECK 2 — COPY FIDELITY ✅ PASS

Every section's words were diffed against COPY PART B by source read AND by an independent verbatim-assertion test.

- Hero, What-Mingla-Does (9-line litany + `<em>` payoff), How-It-Works (4 steps), Audiences (6 cards incl. the Compass / "Experiences, trips & adventures" Inclusion-Rule card), Why-Mingla (5 pairs), Comparison (4 verbatim kill-shots), Features (6 true cards), FAQ (8 Q&A), CTA (SACRED split line + roll-call), page metadata — **all verbatim** (curly quotes are typographic polish only; wording identical).
- **The two fabricated FAQ claims are GONE:** no "performance-based pricing / charged when Mingla drives a booking / no flat fees / refunds available", no "first placements within a week". Confirmed by source scan + structural-invariant test (exactly 8 FAQ items, none about cost/billing/SLA/timeline).
- **No unshipped-channel claims:** no SMS / RCS / push automation / ads / Mingla Brain copy. Features dropped the "generate push copy" card; email-only retained.
- **No fabricated metric:** `<StatLine>` is numberless; no `$` chip, counter, or mock dashboard.
- **Supply-side AI matching framed as the engine, not a delivered per-brand metric** (How-It-Works §03, FAQ Q1) — consistent with META-ORCH-1009 reality anchor.

---

## HARD CHECK 3 — A11Y ✅ PASS

Real-DOM inspection at 1280px:
- **FAQ accordion:** 8 `<button>` rows, each with `aria-expanded` + `aria-controls`. On click, `aria-expanded` flips `false→true`, the panel renders with `role="region"` + `aria-labelledby` pointing back to its button. Rows are `min-h-14` (≥44pt). Keyboard-operable (`<button>` semantics; `focus-ring` on `:focus-visible`).
- **Heading order:** exactly **1 `<h1>`** ("we give people a reason…"), all section titles `<h2>`, card titles `<h3>`. Semantic, no skips.
- **Images:** 6 `<img>` on the page, **0 missing alt** (business logo `alt="Mingla Business"`, app-store badges, etc.). The hero deck is inline SVG (decorative, no alt needed).
- **Keyboard focus:** Tab lands on interactive controls; `focus-ring` utility (`outline: 2px solid coral-500`, offset 2px) applies on `:focus-visible` for buttons, FAQ rows, nav links, and the PlayTile.

---

## HARD CHECK 4 — REDUCED MOTION ✅ PASS

Emulated `prefers-reduced-motion: reduce` (Playwright `reducedMotion: 'reduce'`):
- **CTA headline fully visible** (opacity 1) — content not gated behind an animation that fails to fire.
- **CTA warm-aurora breathe is STATIC** — sampled `opacity` at two timepoints 1.5s apart: `1` then `1` (no loop). The component sets `animate={{opacity:0.8}}` with `duration:0` under reduced; framer + the global `@media (prefers-reduced-motion: reduce)` CSS clamp both kill the breathe.
- All `Reveal`/`RevealGroup` consumers route through `useMinglaReducedMotion` → `initial={false}` (no transform, no blur, delay 0). Global CSS also clamps `animation-duration`/`transition-duration` to `0.001ms`.
- No transforms / aurora breathe / blur animation / scroll-driven jank under reduced motion; content fully visible.

Evidence: `qa_evidence_orch1010/organisers_reducedmotion_cta.png`.

---

## HARD CHECK 5 — CONSUMER UNCHANGED ✅ PASS

- `git diff origin/main...HEAD --name-only` touches **no** `explorer-home/*`, `app/page.tsx`, or `app/layout.tsx`.
- Shared files are additive/gated: `globals.css` = **zero removals** (purely additive tokens); `button.tsx` = only the `Variant` type union extended with `primary-ink` (existing variant strings untouched); `glass-nav.tsx` logo swap is gated on `surface === 'organiser'` (consumer still shows the wordmark); `faq-accordion.tsx` is consumed only by the organiser FAQ; `surface-toggle.tsx` is a Phase-1 label change ("Organiser"→"Business").
- Real-browser check of `/`: h1 "Find nature places that fit the vibe." renders, dark theme intact (`bg #0c0e12`), consumer deck text present, **0 console errors**.
- **Zero business-copy leakage** onto `/`: no "Partner with Mingla", no sacred line, no "businesses with the most soul" copy.

---

## HARD CHECK 6 — RESPONSIVE ✅ PASS

At **375 / 390 / 430 / 1280** px: `document.scrollWidth === clientWidth` at every width → **no horizontal overflow** anywhere. All 9 sections + nav lay out cleanly. Hero `<ProductFrame>` deck scales; the two dark `<SpotlightBand>` sections (Comparison + CTA) render with the spotlight gradient and flip `data-theme="dark"` correctly. Safe-area padding (`max(…, env(safe-area-inset-*))`) is present on every section + the nav `top`. Full-page screenshots captured at 375 + desktop.

---

## HARD CHECK 7 — REGRESSION TESTS ✅ PASS

**Implementor's happy-path test** — `mingla-marketing/components/sections/organiser-home/organiser-redesign.test.ts`
- Run: `npx tsx …/organiser-redesign.test.ts` → **All 7 passed** (captured).
- **Fails-on-revert independently verified by tester:** flipping the hero accent `text-warm-ink → text-warm` made case "light-surface sections use text-warm-ink…" FAIL (exit 1); restoring → all 7 PASS, file byte-for-byte restored (zero diff). Implementor cited fails-on-revert at base `908a3a3a2509aee0f1024d242ef7727cb577026b`.
- Present in `git diff origin/main...HEAD --name-only`. ✅

**Tester's adversarial test (NEW)** — `mingla-marketing/components/sections/organiser-home/__tests__/organiser-copy-fidelity.test.ts`
- Run: `npx tsx …/__tests__/organiser-copy-fidelity.test.ts` → **All 6 passed** (captured).
- **Different angle (proven):** the implementor's test scans for *absence* of forbidden substrings + *presence* of marker substrings. Mine asserts **positive verbatim fidelity** of the highest-risk approved copy (the [SACRED] CTA line, the full litany, all 6 audience eyebrows, the 4 comparison kill-shots, the metadata) AND the **FAQ structural invariant** (exactly 8 items, zero cost/billing/SLA/timeline questions).
- **Adversarial-ness demonstrated empirically:** I re-introduced a pricing FAQ phrased to dodge the forbidden-phrase scan ("How much does it cost?"). The **implementor's test still passed all 7** (blind spot); **my test FAILED** ("expected exactly 8 FAQ questions, found 9"). This is a regression class the happy-path test cannot catch. (Sabotage reverted; faq.tsx restored to zero diff.)
- Staged at the spec'd `__tests__/` path, ready to ship with the closing PR (tester does not commit/merge per hard guards).

**BACKFILL-EXEMPT note:** `mingla-marketing/` has no test runner wired (ORCH-1007 precedent); both tests run via `tsx` like the existing `lib/city-decks.test.ts`. The marketing package is backfill-exempt for the close gate, but both tests exist, pass, and the implementor's is fails-on-revert — exceeding the exemption bar.

---

## HARD CHECK 8 — tsc clean ✅ PASS

`cd mingla-marketing && npx tsc --noEmit` → **exit 0** (clean), including both `.test.ts` files. Re-run after adding the adversarial test → still exit 0.

`next lint` is interactive-only / not wired in `mingla-marketing` (ORCH-1007 baseline) — TSC strict is the real type gate and is green. Noted as a discovery (P3), not a blocker.

---

## Findings

### P3 — LOW
- **F-1 (P3):** `mingla-marketing/` has no ESLint config and no test runner wired; `next lint` is interactive-only (and deprecated in Next 16). The two `tsx`-run tests are good-practice but not CI-enforced. Recommend a future hardening ORCH wire a flat `eslint.config.mjs` + a `tsx` test script so `city-decks.test.ts` + both ORCH-1010 tests run in CI. (Pre-existing baseline, not introduced by this ORCH. Already flagged by the implementor.)

### P4 — NOTE (good work worth crediting)
- **F-2 (P4):** Clean root-cause contrast fix at the **token layer** (`--color-warm-ink`) plus the `primary-ink` button variant — fixes all three binding deltas once, every section inherits. Zero per-element overrides; zero `globals.css` removals (purely additive, so consumer parity is automatic).
- **F-3 (P4):** Reality-anchor discipline held end-to-end — the two fabricated FAQ claims and every unshipped channel are gone, `<StatLine>` is numberless, and the only imagery is the **real** consumer card deck. The page shows actual product, not stock art.

---

## Spec-compliance matrix (DESIGN PART 1, all 9 sections)

| § | Section | Spec'd | Built & verified | Result |
|---|---|---|---|---|
| 0 | Shell + metadata + bg rhythm | parchment→…→2 dark bands; sacred metadata | metadata verbatim; 2 `data-theme="dark"` SpotlightBands confirmed in DOM | ✅ |
| 1 | Hero | 2-col + real deck in ProductFrame + warm-ink + primary-ink + StatLine | all present; deck (27 SVGs) renders; 5.62:1 accent; 6.65:1 btn | ✅ |
| 2 | What Mingla Does | 9-line litany + warm-ink payoff | all 9 lines + `<em>` payoff warm-ink (5.62:1) | ✅ |
| 3 | How It Works | 4 steps + rail + warm-ink nodes (vellum) | 4 steps; nodes warm-ink; rail present | ✅ |
| 4 | Audiences | 6 cards incl. Compass; lucide chips | 6 eyebrows verbatim; Compass card present | ✅ |
| 5 | Why Mingla | 5 pairs; generic-left → text-secondary | 5 pairs; generic-left 6.39:1 (fix live) | ✅ |
| 6 | Comparison | dark SpotlightBand; 4 kill-shots; text-warm | dark band; 4 verbatim lines; accent 6.87:1 | ✅ |
| 7 | Features | 6 true cards; no fabricated channel | 6 cards; lucide chips; no SMS/push/ads | ✅ |
| 8 | FAQ | 8 Q&A; no pricing/SLA; a11y | 8 items; aria-expanded/controls/region | ✅ |
| 9 | CTA | dark SpotlightBand; SACRED split; primary-ink; aurora breathe (reduced-safe) | all present; aurora static under reduced | ✅ |
| 2.1 | Nav | scroll-pill + safe-area-top; logo gated | scroll-pill; reduced-safe shadow; consumer wordmark preserved | ✅ |

Deviations (from implementor report) — both spec-sanctioned, both verified acceptable:
1. Features artifact thumbnails = text+chip only (spec marked optional; "never a placeholder screenshot"). ✅ reality-anchored.
2. Comparison dot-grid off (`grid={false}`, spec marked optional; business signature is aurora+card, not grid). ✅

---

## Completion gate (machine-verified)

1. ✅ Every independent test green — implementor 7/7, adversarial 6/6; output captured.
2. ✅ `tsc --noEmit` clean (exit 0, both packages-of-record). Lint not wired (P3, pre-existing).
3. ✅ Both regression tests in the closing diff; adversarial attacks a proven-different angle; implementor's fails-on-revert at cited commit.
4. ✅ Web leg `proven` (real Chromium, 4 widths + a11y + reduced-motion + parity); native legs exempt (web-only surface).
5. ✅ Zero open P0, zero open P1.

All five clauses hold → **PASS**.

---

## Evidence index (`Mingla_Artifacts/reports/qa_evidence_orch1010/`)
- `playwright_results.txt` — full captured log of contrast / overflow / a11y / reduced-motion / dark-band checks across 375/390/430/1280.
- `organisers_m375.png` — full-page mobile (375px) screenshot.
- `organisers_desktop.png` — full-page desktop (1280px) screenshot.
- `organisers_reducedmotion_cta.png` — CTA under `prefers-reduced-motion: reduce`.

---

## Next handoff

Working tree: `~/Desktop/mingla-orchs/ORCH-1010-[marketing-business-rebrand-copy-design]/` on branch `ORCH-1010-marketing-business-rebrand-copy-design`. Verdict is **PASS** with 0 P0 / 0 P1. The orchestrator can proceed to CLOSE: commit the staged adversarial test (`components/sections/organiser-home/__tests__/organiser-copy-fidelity.test.ts`), open the PR, and `[deploy]` after required checks pass. No rework required.
