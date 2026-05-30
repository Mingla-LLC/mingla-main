# IMPLEMENTATION — ORCH-1010 Business Marketing Redesign (`/organisers`)

**Phase:** 4 of 4 (IMPLEMENT)
**Skill:** `mingla-implementor`
**Surface:** marketing web — the `/organisers` business surface (`mingla-marketing/`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1010-[marketing-business-rebrand-copy-design]/` on branch `ORCH-1010-marketing-business-rebrand-copy-design`
**Date:** 2026-05-30
**Sources of truth:** `DESIGN_ORCH-1010_BUSINESS_MARKETING_REDESIGN.md` (pixel spec), `COPY_ORCH-1010_BUSINESS_MARKETING_REWRITE.md` (verbatim copy)

---

## Outcome

The `/organisers` business-marketing page is rebuilt to premium grade: the three root contrast failures are fixed at the token level, four shared components were added, all 9 sections + page metadata were reworked with the approved copy verbatim, and the hero now shows the **real consumer card deck** instead of generic centered text. The consumer explorer surface (`/`) is untouched. `tsc --noEmit` is clean; the dev server serves `/organisers` and `/` at HTTP 200.

---

## Comms ledger

Read on entry. No `BLOCK` entry targets ORCH-1010. COMMS-0002/0003/0004 are `ALL`/`WARN` but **N/A** for this ORCH: no Stripe/external API touched (COMMS-0003), no INTAKE/ID assignment (COMMS-0004), no `supabase/functions/` files added so the ORCH-0863 strict-grep backend gate is not triggered (COMMS-0002). No new comms entry warranted — the change is wholly contained in `mingla-marketing/` and affects no other in-flight ORCH.

---

## Cross-surface impact (Step 3.5)

This change touches a **single shipping surface**: the marketing web `/organisers` route. Of the 5 primary + 2 adjacent surfaces:

- **Consumer iOS / Android** — UNAFFECTED (app-mobile not touched).
- **Buyer/anon Web, Business iOS / Android** — UNAFFECTED (`mingla-business/` not touched).
- **Admin Web** — UNAFFECTED.
- **Marketing web `/organisers`** — the only affected surface. Files: `mingla-marketing/app/organisers/page.tsx`, `components/sections/organiser-home/*`, shared `components/ui/*` primitives, `components/marketing/glass-nav.tsx`, `app/globals.css`.
- **Marketing web `/` (explorer)** — explicitly preserved. Shares three modified files (`globals.css` tokens are additive; `button.tsx` gains a new variant, existing variants untouched; `faq-accordion.tsx` is only consumed by the organiser FAQ; `glass-nav.tsx` scroll-pill is surface-agnostic and reduced-motion safe). Verified untouched: no `explorer-home/*`, `app/page.tsx`, or `app/layout.tsx` diff.

Parity is automatic where files are shared (tokens, button, nav) and there is no manual-parity drift risk.

---

## Files changed

### New files (5)

| File | Purpose |
|---|---|
| `mingla-marketing/components/ui/reveal.tsx` | `<Reveal>` + `<RevealGroup>` — consolidated scroll-reveal primitives (kills 7 duplicate local `Reveal` helpers); 3 motion roles (`revealUp`/`litanyLine`/`headlineRise`) + stagger group; reduced-motion fallback wired. |
| `mingla-marketing/components/ui/spotlight-band.tsx` | `<SpotlightBand>` — wraps a section in `data-theme="dark"` + `--bg-spotlight` night canvas; optional dot-grid; safe-area padding + locked rhythm. |
| `mingla-marketing/components/ui/product-frame.tsx` | `<ProductFrame>` — glass-strong + rounded-2xl + `--elev-3` frame that holds a REAL product artifact. |
| `mingla-marketing/components/ui/stat-line.tsx` | `<StatLine>` — numberless trust strip of glass `Pill`s (no fabricated metric). |
| `mingla-marketing/components/sections/organiser-home/organiser-redesign.test.ts` | Reality-anchor + contrast-discipline smoke test (7 cases, self-contained Node-assert runner). |

### Modified files (14)

| File | Change |
|---|---|
| `app/globals.css` | ADDED PART 0 tokens: `--color-warm-ink`, `--color-warm-on-dark` (accent text), `--bg-warm-aurora`, `--seam-light`, `--elev-1/2/3` (light scope), `--bg-spotlight` + dark-scope `--elev-1/2/3`. ADDED `.seam-top` utility. No removals. |
| `components/ui/button.tsx` | ADDED `primary-ink` variant (warm fill + ink label) — fixes the 2.90:1 white-on-warm fail. Existing variants untouched. |
| `app/organisers/page.tsx` | UPDATED `metadata.description` to the COPY PART B emotion-first/sacred-line text. Render order unchanged. |
| `components/marketing/glass-nav.tsx` | ADDED scroll-state glass-pill container (Linear/Vercel pattern) + `env(safe-area-inset-top)`. Business logo untouched. |
| `components/ui/faq-accordion.tsx` | Warm-ink `ChevronDown` (rotates 180°), `min-h-14` rows, `aria-controls`+`role=region`+`aria-labelledby`, faint `bg-warm/[0.04]` expanded tint, reduced-motion-safe height animation, `--elev-1`. |
| `…/hero.tsx` | 2-col desktop grid + real `HeroPlaceDeck` inside `<ProductFrame>`; warm aurora; `text-warm-ink` accent; `primary-ink` button; `<StatLine>` trust strip; new COPY; display-XL scale (`md:text-8xl`). |
| `…/what-mingla-does.tsx` | 9-line litany (experience-economy lines + `<em>`/italic-quote warm-ink payoff); `text-warm-ink` eyebrow/accent; display-L H2; uses shared `<Reveal>`. |
| `…/how-it-works.tsx` | 4 new steps; connecting hairline rail + warm-ink `size-10` nodes (horizontal lg / vertical mobile); `text-warm-ink`; `<RevealGroup>`. |
| `…/audiences.tsx` | 6 cards (added Compass/Experiences card per Inclusion Rule); lucide category-icon chips; new COPY; `text-warm-ink`; hover lift + ArrowRight slide. |
| `…/why-mingla.tsx` | 5 refreshed pairs; generic-left → `text-text-secondary` (contrast fix, was failing `text-muted`); italic quoted category; `text-warm-ink` accents; display-M specific side. |
| `…/comparison.tsx` | Wrapped in `<SpotlightBand>` (dark); 4 verbatim kill-shot cards; new headline; `text-warm` on dark; `glass-strong` + `--elev-2`. |
| `…/features.tsx` | 6 true cards (was 7; removed off-reality campaign-gen + performance-learning); lucide chips per card; new headline; `text-warm-ink`. |
| `…/faq.tsx` | 8 new Q&A (removed fabricated pricing + SLA answers); `text-warm-ink` eyebrow; uses shared `<Reveal>`. |
| `…/cta.tsx` | Wrapped in `<SpotlightBand>`; [SACRED] split headline + full roll-call body + sacred completion; `primary-ink` button; 8s warm-aurora breathe (reduced-motion → static). |

---

## New tokens / components added

**Tokens (`globals.css`):**
- `--color-warm-ink: #a8450e` — accent TEXT for light surfaces (5.62:1 on parchment, AA body). Fixes the 2.73:1 bare-warm-on-parchment fail.
- `--color-warm-on-dark: var(--color-warm)` — intent alias for accent text on dark bands.
- `--bg-warm-aurora` — single soft top-radial light source (hero + CTA only).
- `--seam-light` — 1px hairline seam gradient (replaces hard `border-divider` via `.seam-top`).
- `--bg-spotlight` — consumer night-canvas, shared dark scope (Comparison + CTA).
- `--elev-1/2/3` — soft warm-tinted elevation, separate light + dark recipes.

**Button variant:** `primary-ink` (warm fill + ink label, 6.65:1).

**Shared components:** `<Reveal>`/`<RevealGroup>`, `<SpotlightBand>`, `<ProductFrame>`, `<StatLine>` (PART 0.6, all built).

---

## Contrast-fix verification (the three binding deltas)

| Delta | Fix shipped | Recomputed ratio | Verdict |
|---|---|---|---|
| `text-warm` accent in headlines (2.73:1 on parchment) | every light-surface accent now `text-warm-ink` (#a8450e) | 5.62:1 parchment / 5.41:1 vellum | ✅ AA body |
| Primary button white-on-warm (2.90:1) | hero + CTA use `primary-ink` (ink-on-warm) | 6.65:1 | ✅ AA body |
| `text-muted` eyebrows (3.29–3.34:1) | eyebrows now `text-warm-ink`; why-mingla generic-left now `text-text-secondary` (was `text-muted`) | 5.62:1 / 6.38:1 | ✅ AA body |

The smoke test mechanically enforces delta #1 (no bare `text-warm` survives in the 7 light-surface sections) and delta #2 (hero + CTA buttons use `primary-ink`).

---

## Spec traceability (per section)

| § | Section | Built | Evidence |
|---|---|---|---|
| 0 | Page shell + metadata | ✅ | `page.tsx` metadata = COPY PART B; background rhythm parchment→vellum→dark via section classes + `<SpotlightBand>`. |
| 1 | Hero | ✅ | 2-col grid, real `HeroPlaceDeck` in `<ProductFrame>`, aurora, `primary-ink`, `<StatLine>`, `headlineRise`. Renders `Real places, plans, and events` + `locals recommend` (deck) on `/organisers`. |
| 2 | What Mingla Does | ✅ | 9-line litany incl. `we should go there` payoff (warm-ink + italic quote); display-L H2. |
| 3 | How It Works | ✅ | 4 steps + rail + warm-ink nodes; vellum. |
| 4 | Audiences | ✅ | 6 cards incl. `Experiences, trips & adventures` (Compass); lucide chips. |
| 5 | Why Mingla | ✅ | 5 pairs; generic-left `text-text-secondary` (contrast); `into demand` warm-ink close. |
| 6 | Comparison | ✅ | `<SpotlightBand>` dark; 4 verbatim kill-shots; `text-warm` on dark. |
| 7 | Features | ✅ | 6 true cards; lucide chips; no fabricated channel. |
| 8 | FAQ | ✅ | 8 Q&A, no pricing/SLA; warm-ink chevron; a11y `aria-controls`/`role=region`. |
| 9 | CTA | ✅ | `<SpotlightBand>` dark; SACRED split headline + completion; `primary-ink`; aurora breathe. |
| 2.1 | Nav | ✅ | scroll-pill + safe-area-top; business logo untouched. |

---

## Reality-anchor guard rails (PART 3.4) — all held

- **No pricing/billing UI, no fabricated metric:** FAQ pricing+SLA answers removed; `<StatLine>` is numberless; no `$` chip, counter, or mock dashboard.
- **No unshipped channel:** no SMS/RCS/push-automation/ads/Brain copy. Features card "campaign creation: generate push copy" cut; email-only retained.
- **No stock/AI imagery:** the only imagery is the REAL consumer card deck (`HeroPlaceDeck`). Features cards are text + lucide chip (no fake screenshots).
- **Display font stays weight 400:** no `font-bold` on display text; hierarchy via size/leading/tracking/color.
- **Accent text on light = `text-warm-ink`; on dark = `text-warm`:** enforced by the smoke test.
- **Reduced motion:** every animation routes through `useMinglaReducedMotion` (shared `Reveal`/`RevealGroup`, hero, FAQ height, CTA aurora breathe).

---

## tsc / lint results

- `npx tsc --noEmit` (strict) → **clean, exit 0** (includes the new `.test.ts`). Captured.
- `npx next lint` → **no ESLint config exists in `mingla-marketing`** (pre-existing baseline — `next lint` prompts interactive setup and was never runnable here). No new lint surface introduced; TSC strict is the real type gate and is green. This matches the ORCH-1007 marketing-package baseline.
- Dev server (port 3010, already running from this worktree): `/organisers` HTTP 200, `/` HTTP 200, hot-reloaded cleanly through every edit. New copy + deck confirmed present on `/organisers`; zero business-copy leakage onto `/`.

---

## Regression / smoke test

**Path:** `mingla-marketing/components/sections/organiser-home/organiser-redesign.test.ts`
**Run:** `npx tsx components/sections/organiser-home/organiser-redesign.test.ts` → **All 7 tests passed** (output captured).
**Fails-on-revert verified** at base commit `908a3a3a2509aee0f1024d242ef7727cb577026b`: reverting the hero accent `text-warm-ink` → bare `text-warm` made case "light-surface sections use text-warm-ink…" **FAIL**; restoring made all 7 PASS.

Guards: (1) no fabricated pricing/SLA/unshipped-channel copy (comment-stripped scan); (2) light-surface accent = `text-warm-ink` only; (3) dark `<SpotlightBand>` sections use `text-warm`; (4) CTA ships the SACRED line; (5) hero+CTA use `primary-ink`; (6) hero renders real deck; (7) audiences ships all 6 cards incl. Compass.

**BACKFILL-EXEMPT note:** `mingla-marketing/` has no test runner wired (per ORCH-1007 precedent), so this test is good-practice, not a CLOSE blocker. It runs via `tsx` like the existing `lib/city-decks.test.ts`.

---

## Deviations from spec

1. **Features artifact thumbnails (PART 1 §7) — text+chip only, no real thumbnails.** The spec made the brand-page / deck-card thumbnails **optional** ("if asset ready; else text-only … never a placeholder screenshot"). I shipped all 6 Features cards as text + lucide chip to stay strictly reality-anchored and avoid layout-shift risk — no trivially-available static brand-page/deck thumbnail exists in `mingla-marketing/public`, and the design explicitly prefers text-only over a fake. Justification: PART 3.4 reality guard. Low impact — the hero already carries the real-deck "show, don't tell" moment.
2. **Comparison dot-grid overlay — off.** `<SpotlightBand grid>` is supported but Comparison uses `grid={false}` (default). Spec marked the grid "optional"; PART 2.3 says the business signature is the warm aurora + real card, NOT the route-grid, so I kept the dark band clean.
3. **Comparison card order.** The COPY PART B §6 table lists Listings → Ticketing → Ads → group chat; I shipped that exact order (the DESIGN §6 table had Listings/Ticketing/Ads/group-chat too). No deviation — noting for clarity since the old code had a different 4-row set.

No other deviations. Copy is verbatim from COPY PART B throughout (curly quotes/apostrophes used for typographic polish; wording identical).

---

## Discoveries for orchestrator

- **`mingla-marketing` has no ESLint config and no test runner.** `next lint` is interactive-only and `next lint` is deprecated in Next 16. Not in scope to fix here, but a future hardening ORCH could wire a flat `eslint.config.mjs` + a `tsx`-based test script so the existing `city-decks.test.ts` + this new test run in CI. (Marketing is BACKFILL-EXEMPT today.)
- No other side issues found. `/` explorer surface verified unchanged.

---

## Next handoff

Commit to the branch only (no deploy/merge/db-push per dispatch). Tester (`mingla-tester`) should verify the contrast values in a browser at 375/390/430 widths, keyboard focus on FAQ + buttons, reduced-motion behavior, and confirm `/` parity.
