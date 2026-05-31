# DESIGN — ORCH-1010 Business Marketing Redesign (`/organisers`)

**Phase:** 3 of 3 (DESIGN-SPEC only — no `.tsx` edits, no deploys, no migrations)
**Skill:** `mingla-designer`
**Surface:** marketing web — the `/organisers` business surface (`mingla-marketing/`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1010-[marketing-business-rebrand-copy-design]/` on branch `ORCH-1010-marketing-business-rebrand-copy-design`
**Date:** 2026-05-30

**Source-of-truth inputs (read in full before writing this spec):**
- **Approved copy:** `Mingla_Artifacts/reports/COPY_ORCH-1010_BUSINESS_MARKETING_REWRITE.md` — PART B (final per-section words + `text-warm` accent spans + `<br>` points + **[SACRED]** lines), PART C (voice rationale). Every word slotted below is pulled verbatim from PART B and cited by section number, e.g. *(COPY PART B §1)*.
- **Design system:** `mingla-marketing/app/globals.css` (tokens), `components/ui/*` (primitives), `lib/cn.ts`.
- **Current sections:** `components/sections/organiser-home/*` (9 files) + `app/organisers/page.tsx` + `app/organisers/layout.tsx`.
- **Quality bar:** `components/sections/explorer-home/hero.tsx` + `hero-place-deck.tsx` (the real auto-rotating SVG card deck), `components/marketing/glass-nav.tsx`.

**References examined (premium-craft §3, mandatory):** Studied the live patterns this redesign competes with —
(1) **Linear marketing site** (linear.app) for restrained dark-on-light section rhythm, hairline dividers, and the "one idea per viewport" scroll cadence;
(2) **Stripe `/payments` + `/connect`** for how a product-truth page sequences "what it is → how it works → proof → objections → CTA" without stock imagery, and for spotlight/gradient-on-dark accent bands inside an otherwise calm page;
(3) **Partiful + Posh organiser/host pages** for warm, human, event-economy voice paired with real card artifacts rather than 3D blobs;
(4) **Airbnb "Become a Host"** for the audience-segmentation grid and the calm comparison table treatment;
(5) **Timeleft** for the emotional-litany / fragment-cadence display-type moment (mirrors our "What Mingla Does" litany).
Synthesis, not clone: every device below is rebuilt in Mingla's own tokens (warm coral + Mochiy display + parchment/vellum + Liquid-Glass), reusing the **real consumer card deck** as the page's signature artifact so the page shows actual product, never stock art (premium-craft §2).

---

## ⚠️ BINDING ACCESSIBILITY FINDING (read first — it constrains every section)

The organiser surface renders inside `data-theme="light"` (`app/organisers/layout.tsx` → `bg-parchment` `#faf8f4`, ink text). I computed contrast for every load-bearing pair on that surface (not eyeballed):

| Pair | Ratio | AA body (4.5) | AA large (3.0) | Verdict |
|---|---|---|---|---|
| ink `#0e0e10` / parchment | **18.18** | ✅ | ✅ | primary text — perfect |
| ink / vellum `#f4efe7` | **16.85** | ✅ | ✅ | primary text on alt band — perfect |
| text-secondary (ink @68%) / parchment | **6.58** | ✅ | ✅ | body copy — pass |
| text-secondary / vellum | **6.38** | ✅ | ✅ | body copy — pass |
| text-muted (ink @48%) / parchment | **3.34** | ❌ | ✅ | **eyebrows/labels FAIL body 4.5** |
| text-muted / vellum | **3.29** | ❌ | ✅ | same |
| **`warm` `#eb7825` / parchment** | **2.73** | ❌ | ❌ | **accent text FAILS even large 3:1** |
| `coral-600` `#ea580c` / parchment | **3.36** | ❌ | ✅ | large only |
| **white / `warm` (primary button)** | **2.90** | ❌ | ❌ | **button label FAILS** |
| ink / `warm` | 6.65 | ✅ | ✅ | dark text on warm fill — pass |

**Three deltas this spec must resolve (PART 0 adds the tokens; sections consume them):**

1. **`text-warm` accent in headlines fails contrast on the light surface (2.73:1).** The copy's `text-warm` accent spans (every section headline's second line) are load-bearing brand text. On the *light* organiser surface they are illegible-grade. **Fix:** introduce **`--color-warm-ink: #a8450e`** (5.62:1 on parchment — passes AA body) as the accent-*text* token for the light surface. `warm` (#eb7825) stays the token for **fills, the live dot, icon chips, and on-dark spotlight bands** where it sits on dark or is decorative. Do NOT print warm text directly on parchment.
2. **Primary button `bg-warm` + white label = 2.90:1.** On the light surface the hero/CTA primary button must use **ink label on warm fill** (6.65:1) OR a darkened fill. Spec'd per-section below (PART 0 adds `button` variant `primary-ink`).
3. **`text-muted` eyebrows (3.29–3.34:1) fail body 4.5.** Eyebrows are small uppercase ~11px — small text, needs 4.5. **Fix:** eyebrows on the light surface use **`text-warm-ink`** (5.62) or **`text-text-secondary`** (6.38–6.58), never `text-muted`. (Note: `SectionHeading` already uses `text-coral-600` = 3.36 for its eyebrow, also a fail — but `SectionHeading` isn't used by these sections; they hand-roll eyebrows in `text-text-muted`, which this spec replaces.)

These are not optional polish. They are the difference between premium and "looks broken in light mode" (premium-craft §4 contrast rule). Every section spec below already routes accent text through `warm-ink`.

---

# PART 0 — Design-system deltas (premium tokens to ADD)

All values are defined against existing `globals.css` tokens. The implementor pastes these into `@theme inline` / the `[data-theme="light"]` block / `@layer utilities` as noted. **Every spacing/size value in this spec is a 4px-grid token** (4/8/12/16/20/24/32/40/48/64/80/96/128) or an existing radius token (`--radius-sm 10 / -md 16 / -lg 20 / -xl 28 / -2xl 36`). No magic numbers.

## 0.1 Color / accent tokens (ADD to `@theme inline`)

```css
/* Accent TEXT token for light surfaces — fixes the 2.73:1 warm-on-parchment fail.
   #a8450e = warm darkened to clear AA body (5.62:1 on parchment, 5.41:1 on vellum). */
--color-warm-ink: #a8450e;

/* Warm spotlight ink for on-DARK bands (Comparison/CTA spotlight) — the existing
   #eb7825 is already correct on dark; alias for intent clarity. */
--color-warm-on-dark: var(--color-warm); /* #eb7825 — 4.71:1 on #08090c, passes */
```

Usage rule (LOCKED 🔒): on `data-theme="light"` regions, accent **text** = `text-warm-ink`; accent **fills / dots / icon-chips / underlines** = `bg-warm` / `text-warm`. On nested `data-theme="dark"` spotlight bands (PART 0.5), accent text = `text-warm`.

## 0.2 Premium gradient / atmosphere tokens (ADD to `[data-theme="light"]` block + utilities)

The current organiser page is flat parchment with hairline `border-divider` between sections — calm but inert. Add **two restrained, depth-serving** atmosphere primitives (premium-craft §2: gradients only when they serve depth/brand, never decoration):

```css
/* Warm aurora — a single, very soft top-anchored radial that gives the page a
   light source. Used ONCE behind the hero and ONCE behind the CTA, nowhere else. */
--bg-warm-aurora:
  radial-gradient(ellipse 90% 55% at 50% -8%, rgba(235,120,37,0.10) 0%, rgba(235,120,37,0) 60%),
  radial-gradient(ellipse 60% 40% at 85% 8%, rgba(235,120,37,0.06) 0%, rgba(235,120,37,0) 55%);

/* Parchment grain seam — a 1px hairline that replaces hard section borders with
   a soft light-to-shadow seam, so sections feel layered, not stacked. */
--seam-light: linear-gradient(90deg, transparent, rgba(14,14,16,0.10) 18%, rgba(14,14,16,0.10) 82%, transparent);
```

Dark spotlight band uses the consumer hero's already-shipped recipe (verbatim, so the two surfaces feel like one brand):

```css
/* Spotlight band background (for Comparison + CTA on-dark bands). Lifted from
   explorer-home/hero.tsx so the business page inherits the consumer night-canvas. */
--bg-spotlight:
  radial-gradient(ellipse at 50% 8%, rgba(235,120,37,0.16), transparent 38%),
  radial-gradient(ellipse at 88% 22%, rgba(118,67,38,0.18), transparent 40%),
  linear-gradient(180deg, #0c0d10 0%, #08090c 100%);
```

## 0.3 Type scale (ADD as documented scale; values map to Tailwind + the Mochiy constraint)

**HARD CONSTRAINT:** `--font-display` = **Mochiy Pop One ships weight 400 ONLY** (`app/layout.tsx:11`, `weight: '400'`). There is no bold display weight. Premium hierarchy therefore comes from **size, leading, tracking, and color** — never `font-bold` on display text. This is locked.

Documented display scale (existing utilities; no new Tailwind config needed — these are the exact classes to use, standardized so all 9 sections share one rhythm):

| Role | Mobile | Desktop | leading | tracking | weight | token |
|---|---|---|---|---|---|---|
| Display XL (hero H1) | `text-5xl` (48) | `md:text-8xl` (96) | `leading-[1.02]` | `tracking-[-0.02em]` | display 400 | `type-display-xl` |
| Display L (section H2) | `text-4xl` (36) | `md:text-7xl` (72) | `leading-[1.05]` | `tracking-[-0.02em]` | display 400 | `type-display-l` |
| Display M (litany lines, card H3-lg) | `text-3xl` (30) | `md:text-5xl` (48) | `leading-[1.1]` | `tracking-[-0.01em]` | display 400 | `type-display-m` |
| Title (card H3) | `text-xl` (20) | `md:text-2xl` (24) | `leading-tight` | `tracking-[-0.005em]` | display 400 | `type-title` |
| Lede (subhead) | `text-lg` (18) | `md:text-xl` (20) | `leading-relaxed` | `0` | sans 400 | `type-lede` |
| Body | `text-base` (16) | `md:text-base` (16) | `leading-relaxed` | `0` | sans 400 | `type-body` |
| Eyebrow | `text-xs` (12) | — | `none` | `tracking-[0.2em]` | sans 600 uppercase | `type-eyebrow` |

> Net change from current: hero grows from `md:text-7xl` → `md:text-8xl` (more presence); section H2s standardize at `md:text-7xl` (some currently `md:text-6xl`/`md:text-5xl` — unify up); tracking tightens to `-0.02em` on display for the premium "optical kern" feel. Eyebrow tracking widens `0.18em → 0.2em`.

## 0.4 Spacing rhythm + elevation (standardize across all sections)

- **Section vertical rhythm:** mobile `py-24` (96), desktop `md:py-40` (160) — up from the current `md:py-32` (128). More air = more premium (premium-craft §1). **Locked at two values; no per-section drift.**
- **Horizontal padding / safe-area:** `px-6` (24) mobile, `md:px-10` (40) desktop — KEEP (already consistent). Add `[padding-left:max(1.5rem,env(safe-area-inset-left))]` / right equivalents on every `section` so notch/rounded-display devices never clip (premium-craft §4). Content max-widths per section below (range `max-w-3xl` text → `max-w-6xl` grids), one per section, never mixed within a section.
- **Card inner padding:** `p-6` (24) mobile, `md:p-8` (32) desktop — standardize (some cards currently `p-6` only).
- **Grid gaps:** `gap-4` (16) for dense card grids, `gap-6`/`gap-8` (24/32) for sparse — per section below.
- **Elevation scale (NEW, 3 steps; replaces ad-hoc glass shadows for hover):**

```css
/* Light-surface elevation — soft, warm-tinted, no harsh black. */
--elev-1: 0 1px 2px rgba(14,14,16,0.05), 0 4px 12px rgba(14,14,16,0.04);          /* resting card */
--elev-2: 0 2px 6px rgba(14,14,16,0.06), 0 12px 32px rgba(14,14,16,0.07);          /* hover lift */
--elev-3: 0 8px 24px rgba(14,14,16,0.08), 0 24px 64px rgba(235,120,37,0.10);       /* hero artifact / CTA — warm-tinted */
```

Hover = `translate-y-[-2px]` + `--elev-1 → --elev-2`, both inside `transition-all duration-200 ease-out-quart`. **Never** reflow neighbors (premium-craft §2 no-layout-shift).

## 0.5 Motion primitives (standardize the 4 reveal patterns already scattered across sections)

Every section currently re-declares an identical `Reveal` helper. Promote to one shared component (PART 3) and standardize the four motion roles. **All four have a reduced-motion fallback already wired via `useMinglaReducedMotion`** (when reduced → `initial={false}`, no transform).

| Primitive | Use | Transition | Reduced-motion |
|---|---|---|---|
| `revealUp` | section blocks enter on scroll | `{opacity:0,y:24}→{1,0}`, `dur 0.6`, `ease [0.16,1,0.3,1]`, `viewport once amount 0.2` | `initial={false}` (appears, no move) |
| `revealStagger` | list/grid items | same, `delay = i*0.06 (+0.2 base)` | `delay 0`, all appear together |
| `litanyLine` | "What Mingla Does" lines | `{opacity:0,y:14}→{1,0}`, `dur 0.5`, `delay i*0.06` | static |
| `headlineRise` | hero H1 only | `{opacity:0,y:12,filter:blur(8px)}→{1,0,blur(0)}`, `dur 0.72`, `delay 0.1` | static, no blur |

**Easing token:** `ease-out-quart` = `cubic-bezier(0.16,1,0.3,1)` (already in globals.css) — the single page-wide curve. Springs (`stiffness 220–240, damping 26–28`) only for hover lift + the deck. Micro-interactions land 150–300ms (premium-craft §4); none exceed 720ms.

## 0.6 NEW shared components (defined here, built in PART 3)

1. **`<SpotlightBand>`** — wraps a section in `data-theme="dark"` + `--bg-spotlight`, restoring the consumer night-canvas inside the otherwise-light page. Props: `children`, optional `grid` (faint dot-grid overlay like consumer hero). Used by Comparison (optional) + CTA (required).
2. **`<RevealGroup>` / `<Reveal>`** — the consolidated motion helpers from 0.5 (kills 7 duplicate local copies).
3. **`<ProductFrame>`** — a glass-`strong`, `rounded-2xl`, `--elev-3` frame that holds a REAL product artifact (the consumer card deck, or a static brand-page mock). The page's one "show, don't tell" device. Used in Hero (right rail desktop / below on mobile) and optionally Features.
4. **`<StatLine>`** — NOT a fabricated-metric counter. A small inline label row (e.g. "Native checkout · Guest list · Email your buyers") used as a trust strip under the hero. No numbers (reality-anchor: no invented metrics). Reuses `Pill` primitive.

---

# PART 1 — Section-by-section spec (render order)

Render order is **unchanged** (no IA change justified — the copy's arc problem→pivot→uplift already maps cleanly to the existing 9-section order; reordering would fight the manifesto cadence in COPY PART C). Background system alternates to create rhythm (PART 2.3). Every "word" below is verbatim from COPY PART B.

---

## §0 — Page shell & background system (`app/organisers/page.tsx` + `layout.tsx`)

**Design intent:** the page must feel like ONE continuous premium artifact, not nine stacked blocks. Calm parchment is the "daylight" baseline; two on-dark spotlight bands (Comparison optional + CTA) are the "nightlife" punctuation that ties back to the consumer night-canvas.

- **Layout shell:** KEEP `layout.tsx` structure (`data-theme="light"`, `bg-parchment`, `GlassNav`, `<main id="main">`, `Footer`). ADD nothing to the shell except: wrap the hero's section in the `--bg-warm-aurora` light-source (PART 0.2) and ensure `main` has no top padding that fights the fixed nav (hero owns its own `pt`).
- **Background rhythm (LOCKED 🔒):** parchment → parchment → **vellum** → parchment → **vellum** → **SPOTLIGHT/dark** → parchment → parchment → **SPOTLIGHT/dark**. (Hero, WhatMinglaDoes = parchment; HowItWorks = vellum; Audiences = parchment; WhyMingla = vellum; Comparison = dark spotlight; Features = parchment; FAQ = parchment; CTA = dark spotlight.) This matches the *existing* vellum usage on HowItWorks + WhyMingla and adds two dark bands for the two "argument" moments.
- **Section seams:** replace hard `border-t border-divider` with the `--seam-light` hairline (PART 0.2) on parchment↔parchment / parchment↔vellum transitions; on transitions INTO a dark spotlight band, no seam (the color change is the seam).
- **Metadata** *(COPY PART B PAGE METADATA)*: `title` = `Mingla Business — we give people a reason to show up for you.` `description` = `The businesses with the most soul are the hardest to find. Mingla Business changes that — we take what makes your place, event, or experience special and put it in front of the people already looking for exactly that. Your business has a vibe. Your community is looking for it. Mingla helps them find you.`
- **Responsive:** single column < `md`; the page never exceeds `max-w-6xl` (1152) centered. No horizontal scroll at 375/390/430 (premium-craft §4) — verified per section.
- **States** (page-level, premium-craft §5 — most are N/A for a static marketing page; each named): **loading** = fonts swap via `display:'swap'` (already set), no FOUT jump because sizes are fixed; **first-time/returning** = identical (no auth); **error/offline/submitting/degraded** = N/A (no data fetch, no forms on this surface — the only async is the hero video modal, which has its own loading state in `VideoModal`); **empty** = N/A (all content static); **populated** = the designed state below. The one interactive async surface (Watch video) keeps the existing `VideoModal` loading/close states.

---

## §1 — HERO (`hero.tsx`)

**Design intent (COPY PART B §1 + PART C):** in one breath make a venue/experience owner feel *seen* and state the business North Star. Emotion first. Today's hero is centered text + two buttons over flat parchment — competent but generic (premium-craft §2 "centered-everything" tell). **Elevation move:** keep the centered emotional headline, but add the page's signature proof artifact — the **real consumer card deck inside `<ProductFrame>`** — so the very first screen *shows* the product that creates demand, not just claims it. This is the single biggest premium move.

- **Layout:**
  - **Mobile (< md):** single column, centered. Order: H1 → subhead → CTA row → `<StatLine>` trust strip → `<ProductFrame>` (deck) below the fold-ish. `pt-32` (128, clears fixed nav) `pb-24` (96). `max-w-xl` (576) for text block.
  - **Desktop (≥ lg):** 2-col asymmetric grid `lg:grid-cols-[1.1fr_0.9fr]`, `gap-16` (64). LEFT = H1 + subhead + CTA row + StatLine (left-aligned, NOT centered — premium-craft §2). RIGHT = `<ProductFrame>` holding the live `HeroPlaceDeck` (reused from explorer; it already auto-rotates single→intent→event). `pt-44` (176) `pb-40` (160). `max-w-6xl` container.
  - **Tablet (md):** stack but center, deck scaled to `min(380px, 70vw)`.
  - **Safe-area:** `px-6 md:px-10` + `env(safe-area-inset-*)` max().
- **Atmosphere:** the hero `section` carries `--bg-warm-aurora` (PART 0.2) as a single `pointer-events-none absolute inset-0` layer — the page's only hero light source. No grid lines on the business hero (that's the consumer hero's device; keep them distinct).
- **Typography & copy slotting:**
  - **H1** `type-display-xl`, `text-text-primary`, left desktop / center mobile, `headlineRise` motion:
    > we give people a reason
    > `<span class="text-warm-ink">`**to show up for you.**`</span>`

    *(KEEP line break; accent line now `text-warm-ink` per binding finding, NOT `text-warm`.)*
  - **Subhead** `type-lede`, `text-text-secondary`, `max-w-xl`, `mt-8` (32):
    > The businesses with the most soul are the hardest for people to find. Mingla changes that. We take what makes your place, event, or experience special — the vibe, the story, the night people will actually remember — and put it in front of the people already looking for exactly that.
  - **Closing microcopy** `type-body`, `mt-12` (48), `text-text-muted` base with `text-text-primary` emphasis:
    > Not just a listing. Not just an ad. `<span class="text-text-primary">`**A reason people choose you.**`</span>`
- **Color/material:** parchment + aurora. `<ProductFrame>` = `glass-strong` + `rounded-2xl` (36) + `--elev-3` (warm-tinted lift). The deck inside is the real product (premium-craft §2 "real, earned imagery").
- **CTA row** (`mt-10`, 40; `flex-col` mobile → `flex-row gap-3` desktop):
  - **Primary** `Partner with Mingla` — **`Button` variant `primary-ink`** (warm fill, **ink label**, per binding finding #2; size `lg` = h-14). 44pt+ target ✅. `accessibilityLabel="Partner with Mingla"`.
  - **Secondary** the `PlayTile` (`Watch · See how Mingla works`) — KEEP as built (glass-strong pill, warm play chip, already has `aria-label`). Runtime `2:14` is an asset concern, not copy.
- **`<StatLine>` trust strip** (`mt-8`, NEW): three glass `Pill`s, no numbers — `Native all-in checkout` · `Email your real buyers` · `Guest list + check-ins`. Reality-anchored (all shipped). `dot={null}`. Reinforces "real product" without a fabricated metric.
- **Motion:** H1 `headlineRise`; subhead/CTA/StatLine `revealUp` staggered `delay 0.35 / 0.5 / 0.6`; deck animates in `revealUp delay 0.4` then self-rotates. Reduced-motion → all static, deck still rotates only if not reduced (the consumer deck already respects `useMinglaReducedMotion` → holds front card when reduced).
- **States:** populated = above. Video = `VideoModal` (existing loading/error/close). Others N/A (static).

---

## §2 — WHAT MINGLA DOES (`what-mingla-does.tsx`)

**Design intent (COPY PART B §2 + PART C):** the page's emotional core — the litany. The copy explicitly asks for this to "breathe like quiet, confident statements." This is the Timeleft-style kinetic-fragment moment. **Do not add chrome — subtract it.** Center, generous, slow stagger.

- **Layout:** centered single column, `max-w-4xl` (896), parchment, `py-24 md:py-40`. Litany lines stacked `flex-col items-center gap-3` (12) → `md:gap-4` (16).
- **Typography & copy slotting:**
  - **Eyebrow** `type-eyebrow`, `text-warm-ink` (per binding finding #3 — was `text-text-muted` which fails): `What Mingla does`
  - **H2** `type-display-l`, center, `mt-4` (16), `revealUp`:
    > we sell what makes `<br class="hidden md:block">`
    > `<span class="text-warm-ink">`**you special.**`</span>`
  - **Intro subhead** `type-lede`, `text-text-secondary`, `max-w-2xl mx-auto`, `mt-8`:
    > Nobody chooses a place, an event, or an experience because it exists. They choose it because something about it feels worth showing up for.
  - **The litany** `type-display-m`, `text-text-primary`, center, `mt-16` (64), each line `litanyLine` motion (stagger `i*0.06`). Verbatim *(COPY PART B §2)* — note the `<em>` on the last line and the experience-economy lines:
    > The food.
    > The room.
    > The crowd.
    > The music.
    > The host who remembers your name.
    > The view from the trail.
    > The class you can't stop talking about.
    > The story only you can tell.
    > `<em class="text-warm-ink not-italic">`The *"we should go there"* moment.`</em>`

    *(Last line gets the warm-ink accent + the italic quote treatment to land the payoff. The italic is on the quoted phrase only; render the line in display 400.)*
  - **Closing line** `type-lede`, `text-text-secondary`, `max-w-2xl mx-auto`, `mt-16`:
    > Mingla helps you name that reason, shape it into a page and a plan people understand instantly, and put it in front of the people most likely to care.
- **Material:** pure parchment, zero cards, zero borders. The whitespace IS the design (premium-craft §1). The only color is the two warm-ink accents (eyebrow + payoff line).
- **Motion:** litany lines rise one-by-one (`litanyLine`, 60ms stagger) — the reader reads at the speed they appear. Reduced-motion → all visible at once, no rise.
- **Responsive:** litany font `text-3xl` (30) mobile keeps 9 short lines on ≤375 without wrap except the two longer experience lines, which wrap to 2 lines gracefully (acceptable — they're the longest by design). No horizontal scroll.
- **States:** static; populated only.

---

## §3 — HOW IT WORKS (`how-it-works.tsx`)

**Design intent (COPY PART B §3):** show the real journey from the owner's chair in 4 true steps, ending on "a full room." Today it's 4 abstract columns on vellum — fine but flat. **Elevation:** keep the 4-step structure but give it a **connecting through-line** (a hairline rail with warm-ink step nodes) so it reads as a *journey*, not a feature list, and number the steps with real visual weight.

- **Layout:** vellum band, `max-w-6xl`, `py-24 md:py-40`. Steps in `grid md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6` (32/24). On `lg`, a `1px` horizontal `--seam-light` rail runs behind the row at the step-number baseline; each step's number sits in a `40×40` (`size-10`) warm-tinted node (`bg-warm/12`, `text-warm-ink`, `rounded-full`, `--elev-1`) ON the rail. On mobile the rail is vertical (left gutter, `w-px`, nodes down the side).
- **Typography & copy slotting** *(COPY PART B §3)*:
  - **Eyebrow** `type-eyebrow text-warm-ink`: `How it works`
  - **H2** `type-display-l`, `max-w-3xl`, `mt-4`, `revealUp`:
    > from what you have `<br class="hidden md:block">`
    > `<span class="text-warm-ink">`**to a full room.**`</span>`
  - **Steps** (`mt-16`), each `revealStagger delay i*0.08+0.2`:

    | node | title `type-title text-text-primary` | body `type-body text-text-secondary` |
    |---|---|---|
    | 01 | `show us what you've got` | Your place, your menu, your event, your trip, your class, your pop-up — whatever you want people to show up for. |
    | 02 | `we make it impossible to ignore` | We turn it into a page and a story people get in seconds: the vibe, the details that matter, the reason it's worth leaving the house for. |
    | 03 | `we put it in front of the right people` | Mingla matches what you offer to people nearby by taste, mood, timing, budget, and what they're already planning — not just who's close, but who actually wants this tonight. |
    | 04 | `they show up — and you can sell them the night` | People discover you, save you, and book or buy right there. Sell tickets, packages, and tables with all-in pricing and no checkout surprises — then watch who came through the door. |

    Step numbers: `font-display text-base text-warm-ink` inside the node (display 400; the node's fill + size carry the weight, not bold).
- **Material:** vellum + glass-free (steps are open, not carded — keeps the "journey" feel light). Node = warm-tint chip. Rail = `--seam-light`.
- **Motion:** steps reveal left→right (`revealStagger`); on `lg`, an optional `scaleX` draw of the rail from 0→1 (`dur 0.8 ease-out-quart`) as the section enters. Reduced-motion → rail drawn instantly, steps appear together.
- **Responsive:** 1-col mobile (vertical rail), 2-col md, 4-col lg. Step 04 title is the longest — wraps to 2 lines on narrow cols (designed).
- **States:** static.

---

## §4 — AUDIENCES "Built for" (`audiences.tsx`)

**Design intent (COPY PART B §4):** make the owner say "that's me," now across the **full experience economy** (the copy adds a 6th card for experiences/trips/adventures per the Inclusion Rule). Today's 5 glass cards are good; the redesign extends to **6 cards** and adds a quiet category icon per card so the grid scans faster (Airbnb "Become a Host" segmentation pattern) — using the **real lucide set already in the consumer deck** (no emoji, premium-craft §2).

- **Layout:** parchment, `max-w-6xl`, `py-24 md:py-40`. Cards in `grid gap-4 md:grid-cols-2 lg:grid-cols-3` (16). 6 cards → clean 2×3 / 3×2. Each card `glass-soft rounded-2xl p-6 md:p-8`, `--elev-1`, `flex flex-col gap-4`, `h-full` (equal heights).
- **Card anatomy (top→bottom):** category **icon** (`size-6` lucide, `text-warm-ink`, in a `size-10 rounded-full bg-warm/10` chip) → eyebrow `type-eyebrow text-warm-ink` → title `type-title text-text-primary` → body `type-body text-text-secondary` → CTA row pinned bottom (`mt-auto`, `text-text-primary` + `ArrowRight size-4`).
- **Copy slotting + icon mapping** *(COPY PART B §4 — all 6 cards verbatim; icons from lucide, already bundled)*:

  | icon (lucide) | eyebrow | title | body | cta |
  |---|---|---|---|---|
  | `UtensilsCrossed` | `Restaurants & cafés` | `make your menu the reason.` | The handmade pasta. The patio at golden hour. The cocktail only your bartender can make. Mingla turns your menu, your room, and your best nights into something people book a table for. | `Fill more tables` |
  | `Martini` | `Bars, clubs & nightlife` | `give people a night they brag about.` | The DJ. The sound. The room when it's full. The thing everyone wants to be in. Mingla turns your energy into a crowd that shows up — and comes back. | `Build the crowd` |
  | `Users` | `Venues & activity spaces` | `be the plan, not the afterthought.` | A date. A birthday. A team night. A weekend ritual. Mingla shapes your space and packages into plans people actively choose — and pay for up front. | `Sell more group plans` |
  | `PartyPopper` | `Events & promoters` | `sell the night, not just the ticket.` | A flyer says what's happening. Mingla says why it matters — the lineup, the crowd, the culture, the timing — and lets people buy in seconds. | `Sell out your event` |
  | `Compass` | `Experiences, trips & adventures` | `turn a thing-to-do into a must-do.` | Cooking classes, horseback rides, tours, day trips, tastings, outdoor adventures. Mingla helps experience and trip organizers turn "that sounds fun" into a booking — matched to the people already looking for exactly this. | `Book out your experience` |
  | `Sparkles` | `Pop-ups & independent creators` | `land fast. land hard.` | A pop-up has one shot. Mingla helps chefs, artists, makers, and curators turn concept, scarcity, and timing into something people feel they cannot miss. | `Launch your pop-up` |

  *(The new 5th card — `Compass` / Experiences — discharges the Inclusion Rule. All icons exist in the consumer deck's lucide import; reuse verbatim for stroke/size consistency.)*
- **Material:** glass-soft on parchment. Glass must stay legible on light (premium-craft §4) — the light-theme `--glass-soft-bg` is frosted-white @55%, ink text 18:1 over it, borders `rgba(14,14,16,0.10)` visible. ✅
- **Motion:** cards `revealStagger delay 0.05*i+0.2`; hover = `translate-y-[-2px]` + `--elev-1→--elev-2` + icon chip `bg-warm/10→bg-warm/16` (no reflow). CTA `ArrowRight` slides `translate-x-1` on hover. Reduced-motion → all appear, no hover transform (color only).
- **CTA affordance:** the per-card CTA is **visual, not a link target** today (it's a `<span>`). KEEP as a visual cue (the whole card is the affordance) OR, if the implementor wants real targets, wrap the card in a button with the CTA as `accessibilityLabel`. Spec: keep visual; whole-card hover signals interactivity; if no destination exists yet, do NOT fake a link (reality-anchor).
- **Responsive:** 1/2/3 col. Bodies are the longest content — cards grow to fit, `h-full` keeps row heights equal. No clipping at 375.
- **States:** static.

---

## §5 — WHY MINGLA (`why-mingla.tsx`)

**Design intent (COPY PART B §5):** reveal the insight — people choose feelings before categories. The generic→specific pairs are the page's smartest device. Today it's a 2-col text grid on vellum — keep it, sharpen the rhythm, make the "specific" side land harder with `warm-ink` emphasis on the operative phrase.

- **Layout:** vellum band, `max-w-4xl`, `py-24 md:py-40`. Pairs in `flex-col gap-6 md:gap-8`; each pair `grid md:grid-cols-2 gap-2 md:gap-8` with a `--seam-light` hairline `border-t pt-6` above each (KEEP the divider rhythm — it's the device).
- **Typography & copy slotting** *(COPY PART B §5 — 5 pairs verbatim)*:
  - **Eyebrow** `type-eyebrow text-warm-ink`: `Why Mingla`
  - **H2** `type-display-l`, `mt-4`, `revealUp`:
    > because people choose `<br class="hidden md:block">`
    > `<span class="text-warm-ink">`**feelings before categories.**`</span>`
  - **Pairs** (`mt-16`): LEFT (generic) `type-body text-text-muted`*… see note* / RIGHT (specific) `type-display-m text-text-primary`:

    | generic (left) | specific (right) |
    |---|---|
    | they don't want *"a restaurant."* | they want somewhere cute, where they can actually hear each other. |
    | they don't want *"an event."* | they want a night worth leaving the house for. |
    | they don't want *"a class."* | they want a plan that feels fun, useful, or a little bit theirs. |
    | they don't want *"a trip."* | they want the story they'll tell for years. |
    | they don't want *"a bar."* | they want the right energy, with the right people. |

    **Contrast note:** the generic-left text is intentionally de-emphasized but MUST clear 4.5:1 — so it uses **`text-text-secondary`** (6.38 on vellum), NOT `text-text-muted` (3.29, fails). The quoted category gets `italic`.
  - **Closing line** `type-display-m`, center, `mt-16`, `revealUp delay 0.5`:
    > Mingla turns those feelings `<span class="text-warm-ink">`**into demand.**`</span>`

    *(Accent on last two words = `text-warm-ink`.)*
- **Material:** vellum, no cards, seam hairlines. Restraint = the point.
- **Motion:** pairs `revealStagger delay 0.06*i+0.2`; closing line `revealUp`. Reduced-motion static.
- **Responsive:** stacks to 1-col on mobile (generic above specific per pair); the seam line spans full width.
- **States:** static.

---

## §6 — COMPARISON "Mingla vs the rest" (`comparison.tsx`)

**Design intent (COPY PART B §6):** the bright-line argument — everyone else owns one slice; Mingla owns the whole outing loop. The copy arms this with **verbatim kill-shot lines**. **Biggest material move of the page:** render this as the first **on-dark `<SpotlightBand>`** (PART 0.6) — the argument lands harder on the nightlife canvas, and it visually rhymes with the consumer hero. Struck-through "generic" vs warm "Mingla" per row.

- **Layout:** `<SpotlightBand>` (dark, `--bg-spotlight`, optional faint dot-grid), `max-w-6xl`, `py-24 md:py-40`. 4 contrast cards `grid gap-4 md:grid-cols-2`. Each card `glass-strong rounded-2xl p-6 md:p-8` (dark-theme glass now — legible on the dark band), `--elev-2`.
- **Typography & copy slotting** *(COPY PART B §6 — verbatim)*:
  - **Eyebrow** `type-eyebrow text-warm` (on DARK now, so `warm` #eb7825 = 4.71:1, passes): `Mingla vs the rest`
  - **H2** `type-display-l text-text-primary` (white-on-dark), `max-w-4xl`, `mt-4`, `revealUp`:
    > they show people your business. `<br class="hidden md:block">`
    > `<span class="text-warm">`**Mingla shows them why they'd love it.**`</span>`

    *(On the dark band, accent reverts to `text-warm` per PART 0.1 usage rule.)*
  - **Cards** (`mt-16`), each `revealStagger delay 0.06*i+0.2`:

    | category `type-eyebrow text-text-muted`(on dark = `rgba(255,255,255,0.52)` = 5.6:1 ✅) | generic (struck) `type-lede text-text-muted line-through` | Mingla `type-title text-text-primary`, prefixed warm `Mingla` chip |
    |---|---|---|
    | `Listings` | tell people you exist. | sells why you're worth choosing tonight. |
    | `Ticketing` | sells the ticket. | sells the night. |
    | `Ads` | chase customers you have to pay for again and again. | finds the people already looking for a place like yours. |
    | `The group chat` | is where plans go to die. | is where they get picked. |

    Each "Mingla" line is prefixed by a small `font-display text-warm` "Mingla" label (KEEP the existing in-card device), then the verbatim line in white display.
- **Material:** dark spotlight + `glass-strong` cards. This is the page's one "the contrast is the product" moment — the only place struck-through text appears.
- **Motion:** cards `revealStagger`; on enter, the struck-through line draws its strike (`scaleX 0→1` on the line-through pseudo, `dur 0.4`) — subtle, communicates "this is the old way." Reduced-motion → strike shown instantly.
- **Responsive:** 2-col md, 1-col mobile. Longest line ("Ads") wraps gracefully.
- **States:** static.
- **Transition:** entering from vellum (WhyMingla) INTO dark — no seam; the color flip is the divider. The page-background goes parchment→vellum→**dark**, the cinematic peak before Features returns to daylight.

---

## §7 — FEATURES (`features.tsx`)

**Design intent (COPY PART B §7):** the concrete, all-shipped capability list — "what you actually get." Today: 7 cards, several off-reality (the copy cut to **6 true cards**). Back on parchment (daylight after the dark peak). **Elevation:** lead with the most tangible (the page), and give 2–3 cards a small real-product thumbnail where one exists (the brand page, the deck) so "real, earned imagery" replaces abstract feature text (premium-craft §2). Where no artifact exists, text-only card — never a fake screenshot.

- **Layout:** parchment, `max-w-6xl`, `py-24 md:py-40`. `grid gap-4 md:grid-cols-2 lg:grid-cols-3`. 6 cards = clean 3×2 / 2×3. Cards `glass-soft rounded-2xl p-6 md:p-8`, `--elev-1`, `flex flex-col gap-3`, `h-full`.
- **Typography & copy slotting** *(COPY PART B §7 — verbatim)*:
  - **Eyebrow** `type-eyebrow text-warm-ink`: `What you get`
  - **H2** `type-display-l`, `max-w-3xl`, `mt-4`, `revealUp`:
    > everything you need to turn a vibe `<br class="hidden md:block">`
    > into a booking — `<span class="text-warm-ink">`**and a full room.**`</span>`
  - **Cards** (`mt-16`), each `revealStagger delay 0.04*i+0.2`, title `type-title text-text-primary`, body `type-body text-text-secondary`:

    | title | body | optional artifact |
    |---|---|---|
    | `a page worth sharing` | A beautiful, on-brand page for your place, event, or experience — your colors, your photos and video, your story. The page people actually want to send to the group chat. | small static brand-page frame thumb (real `packages/brand-rendering` mock) — if asset ready; else text-only |
    | `taste-matched discovery` | Your offer reaches people by vibe, taste, location, timing, budget, and what they're already planning — not just who's nearby, but who's looking for exactly this tonight. | small static deck card thumb (reuse a single `PlaceCard`) — optional |
    | `all-in checkout, built in` | Sell tickets, tables, and packages right inside Mingla. One all-in price up front, no address typing, no checkout surprises — buyers see the full cost before they pay. | text + `lucide:Receipt` chip |
    | `email your real customers` | Send campaigns to the people who actually bought from you or your events — no list to build, no extra tool to learn. They're already there. | text + `lucide:Mail` chip |
    | `know who showed up` | Your dashboard shows the guest list, check-ins, and what sold — so you finally know which nights, offers, and crowds are working. | text + `lucide:UserCheck` chip |
    | `tell your vibe in plain words` | Name the energy people should expect — cozy, lively, romantic, late-night, family-friendly, high-energy, intimate — so the right people self-select in, and the wrong fit self-selects out. | text + `lucide:Sparkles` chip |

    **Reality guard:** the optional thumbnails are ONLY the brand page + a real deck card (both shipped, real). If those assets aren't trivially available, ship text-only cards with a small lucide chip per card — NO mock dashboards, NO invented charts (premium-craft §2). Chips = `size-10 rounded-full bg-warm/10 text-warm-ink`.
- **Material:** parchment + glass-soft. Two card "tiers": artifact cards (1–2) slightly taller; text cards uniform. Keep heights tidy via `h-full` per row.
- **Motion:** `revealStagger`; hover lift `--elev-1→--elev-2`. Reduced-motion static/color-only.
- **Responsive:** 1/2/3 col. No horizontal scroll. Artifact thumbs cap at card width.
- **States:** static (artifact thumbs are static images, no load state needed; if a thumb is a real `<img>`, give it explicit width/height to prevent layout shift — premium-craft §2).

---

## §8 — FAQ (`faq.tsx`)

**Design intent (COPY PART B §8):** answer real objections honestly — the two fabricated answers (pricing SLA, one-week placements) are GONE in the copy; the design must not reintroduce any price/metric chrome. Keep the existing `FAQAccordion` (it's a solid pattern) but elevate the header and ensure focus/keyboard states are first-class.

- **Layout:** parchment, `max-w-3xl` (768, narrow for readability), `py-24 md:py-40`. Header block then `FAQAccordion` (`mt-12`, 48).
- **Typography & copy slotting** *(COPY PART B §8 — 8 Q&A verbatim)*:
  - **Eyebrow** `type-eyebrow text-warm-ink`: `Common questions`
  - **H2** `type-display-l` (cap at `md:text-5xl` for the narrower column), `text-text-primary`:
    > before we get on a call.
  - **8 items** in `FAQAccordion` — questions/answers exactly as COPY PART B §8 (Q1 matching-as-engine, Q2 full experience economy, Q3 listing/ad difference, Q4 "you bring raw material," Q5 native all-in checkout + tax/fee toggle, Q6 guest list/check-ins, Q7 email campaigns, Q8 "makes the rest work harder"). **No pricing question. No SLA.**
- **Material:** parchment; each accordion row separated by `--seam-light` hairline; expanded row gets a faint `bg-warm/[0.04]` tint (legible — warm @4% over parchment, text still 18:1). Chevron = `lucide:ChevronDown`, `text-warm-ink`, rotates `180°` on open (`dur 0.2 ease-out-quart`).
- **Interaction & a11y (premium-craft §4):** each question is a `<button>` (≥44pt row height, `min-h-14`), `aria-expanded`, `aria-controls`, panel `role=region`. `focus-ring` visible on keyboard focus. Answer panel animates `height auto` (framer `AnimatePresence` + `layout`) — reduced-motion → instant open/close, no height animation.
- **Motion:** header `revealUp`; accordion `revealUp delay 0.15`; row expand 200ms. Reduced-motion instant.
- **States:** **populated/default** = all collapsed (or first open — implementor choice; spec: all collapsed for a calm wall); **expanded** = one or many open (independent rows); **focus/hover** = row bg `bg-warm/[0.03]`; others N/A (static, no fetch). No empty/error/loading.
- **Responsive:** single column always; rows full-width; long answers wrap. No clip at 375.

---

## §9 — CTA (`cta.tsx`)

**Design intent (COPY PART B §9 + PART C):** convert, and end on the **[SACRED]** Business signature line — "Your business has a vibe. Your community is looking for it. Mingla helps them find you." This is the page's final, quietest, most confident moment. **Second `<SpotlightBand>`** (dark) — bookends the page's two argument peaks and gives the sacred line a stage. Maximum air; the line must "breathe" (COPY PART C, dispatch hard constraint).

- **Layout:** `<SpotlightBand>` (dark, `--bg-spotlight` + `--bg-warm-aurora` over it for an extra warm halo behind the headline), centered, `max-w-3xl`, `py-32 md:py-48` (128/192 — the most air on the page, deliberately). `flex-col items-center gap-6 text-center`.
- **Typography & copy slotting** *(COPY PART B §9 — verbatim, [SACRED])*:
  - **Eyebrow** `type-eyebrow text-warm` (on dark): `Ready to give people a reason?`
  - **H2** `type-display-xl` (hero-scale — this is the co-equal climax), `text-text-primary` white, `revealUp`:
    > your business has a vibe. `<br class="hidden md:block">`
    > `<span class="text-warm">`**your community is looking for it.**`</span>`
  - **Body** `type-lede text-text-secondary` (on dark = `rgba(255,255,255,0.72)` = 8.9:1 ✅), `max-w-2xl`, ending on the sacred completion in `text-text-primary`:
    > Restaurants, bars, venues, events, pop-ups, and the people behind every experience, trip, and adventure — Mingla takes what makes you special and puts it in front of the people already looking for it. `<span class="text-text-primary">`**Mingla helps them find you.**`</span>`
  - **Primary CTA** `Partner with Mingla` — `Button` size `lg`. On the DARK band, `bg-warm` + **white label** is borderline (2.9) — so on dark use **`primary` variant with white label is still <3:1; instead use `bg-warm` + `text-ink`** (ink-on-warm 6.65 ✅) OR a white-glass `secondary` button (`glass-strong`, white label, 8:1+). **Spec: `bg-warm` fill + ink label** for brand punch with legal contrast. 44pt+. `accessibilityLabel="Partner with Mingla"`.
- **Material:** dark spotlight + warm aurora halo. The sacred line is the only element with display-XL weight here — nothing competes.
- **Motion:** eyebrow→H2→body→button `revealUp` staggered (`0 / 0.1 / 0.2 / 0.3`); the warm aurora behind the headline does a slow 8s `opacity` breathe (0.6↔1.0) — the page's one ambient loop, ONLY here. Reduced-motion → aurora static at 0.8, content appears no-move.
- **Responsive:** centered single column; headline `text-5xl` mobile → `text-8xl` desktop; safe-area padding. No clip.
- **States:** static; the only action is the CTA button (no async → no loading state needed unless it opens a contact modal later; out of scope).
- **Transition:** Features (parchment) → CTA (dark) — color flip is the seam; the page ends on the night canvas, closing the loop back to the consumer brand.

---

# PART 2 — Cross-cutting

## 2.1 Nav / header (`components/marketing/glass-nav.tsx`)

- **KEEP the shipped business logo** (`/brand/mingla-business-logo.svg`, `h-10 w-10`) — the dispatch forbids redesigning it. KEEP the fixed `top-4`, `max-w-6xl`, glass `Get the app` CTA, and `SurfaceToggle` (desktop only).
- **Two premium nits (optional, low-risk):** (1) on scroll past the hero, give the header bar itself a `glass-soft` rounded-full container (`rounded-full px-2 h-12`, `--elev-1`) so it reads as a floating pill over the now-scrolling content (Linear/Vercel pattern) — currently the logo + CTA float bare on parchment, which can look unanchored once content scrolls under them. Reduced-motion → static glass (no scroll-driven fade-in). (2) Ensure the nav's `Get the app` button label clears contrast — `glass-soft` + `text-text-primary` on parchment = 18:1 ✅ (already fine).
- **A11y:** logo link already has `aria-label`; nav is in a `<header>`; `Skip to content` exists in root layout. Keep.
- **Safe-area:** nav is `top-4` + `px-4`; add `env(safe-area-inset-top)` to the `top` so it clears the notch on landscape. 44pt targets on logo + CTA ✅.

## 2.2 Section-to-section rhythm & transitions

The page is a **scroll arc**: warm daylight (Hero, WhatMinglaDoes) → process (HowItWorks, vellum) → recognition (Audiences) → insight (WhyMingla, vellum) → **argument peak (Comparison, dark)** → proof (Features) → objections (FAQ) → **emotional close (CTA, dark)**. Two dark bands at positions 6 and 9 are the two crescendos; everything between is calm. Transitions use `--seam-light` on light↔light/vellum and a clean color-flip into the dark bands. Vertical rhythm is locked at `py-24 / md:py-40` everywhere except the CTA (`py-32 / md:py-48`, the one deliberate extra-air moment) and WhatMinglaDoes litany (same py, but `mt-16` internal gaps give it the most internal air).

## 2.3 Background / atmosphere system

- **Baseline:** parchment `#faf8f4` (light theme).
- **Alt band:** vellum `#f4efe7` (HowItWorks, WhyMingla) — already in use; KEEP.
- **Light source:** `--bg-warm-aurora` — used ONCE in Hero, ONCE in CTA. Nowhere else (restraint).
- **Dark bands:** `--bg-spotlight` (Comparison, CTA) — the consumer night-canvas, inherited verbatim so business + consumer feel like one brand.
- **No grid lines on business** (that's the consumer hero's signature; keep surfaces distinct). The business page's signature is the **warm aurora + real card artifact**, not the route-grid.

## 2.4 Responsive strategy

- **Breakpoints (Tailwind default):** base (<640 mobile), `sm` 640, `md` 768, `lg` 1024. Mobile-first.
- **Container widths (one per section, locked):** Hero/Audiences/HowItWorks/Comparison/Features = `max-w-6xl`; WhatMinglaDoes/WhyMingla = `max-w-4xl`; FAQ/CTA = `max-w-3xl`.
- **Padding:** `px-6 md:px-10` + `max(…, env(safe-area-inset-*))` on every section.
- **Type:** fluid via the two-stop scale in PART 0.3 (mobile → `md:` desktop). No `clamp()` needed except hero/CTA H1 may optionally use `clamp(3rem, 8vw, 6rem)` to avoid a hard jump on tablet.
- **Verify:** no horizontal scroll at 375 / 390 / 430; all touch targets ≥44pt; litany + longest card bodies wrap gracefully (premium-craft §4).
- **Reduced motion:** every animation has a fallback (PART 0.5); `useMinglaReducedMotion` is already wired in all sections.

---

# PART 3 — Implementor build notes

## 3.1 Files that change

| File | Change |
|---|---|
| `app/globals.css` | ADD PART 0.1 color tokens (`--color-warm-ink`, `--color-warm-on-dark`), PART 0.2 gradient tokens (`--bg-warm-aurora`, `--seam-light`, `--bg-spotlight`), PART 0.4 elevation tokens (`--elev-1/2/3`). No removals. |
| `components/ui/button.tsx` | ADD variant `primary-ink` (warm fill + ink label, for light-surface primary CTAs) — fixes the 2.9:1 white-on-warm fail. |
| `app/organisers/page.tsx` | UPDATE `metadata` (title KEEP, description = COPY PART B). No structural change to render order. |
| `components/sections/organiser-home/hero.tsx` | Rework to 2-col desktop + `<ProductFrame>` w/ `HeroPlaceDeck`; new copy; `text-warm-ink` accent; `primary-ink` button; `<StatLine>`. |
| `…/what-mingla-does.tsx` | New litany lines (9, incl. experience-economy + `<em>` payoff); `text-warm-ink` eyebrow/accent. |
| `…/how-it-works.tsx` | 4 new steps; connecting rail + warm-ink nodes; `text-warm-ink`. |
| `…/audiences.tsx` | 6 cards (add Experiences/Compass); category icon chips; new copy; `text-warm-ink`. |
| `…/why-mingla.tsx` | 5 refreshed pairs; left text → `text-text-secondary` (contrast fix); `text-warm-ink` accents. |
| `…/comparison.tsx` | Wrap in `<SpotlightBand>` (dark); 4 verbatim kill-shot cards; new headline; `text-warm` on dark. |
| `…/features.tsx` | 6 true cards (was 7); optional real-artifact thumbs + lucide chips; new headline; `text-warm-ink`. |
| `…/faq.tsx` | 8 new Q&A (remove fabricated pricing + SLA); warm-ink chevron; focus states. |
| `…/cta.tsx` | Wrap in `<SpotlightBand>`; [SACRED] split headline; full roll-call body; `bg-warm`+ink button; aurora breathe. |
| `components/marketing/glass-nav.tsx` | Optional: scroll-state glass pill container + safe-area-top. (Low-risk, can defer.) |

## 3.2 New shared components to build (PART 0.6)

1. `components/ui/spotlight-band.tsx` — `<SpotlightBand>` (sets `data-theme="dark"` + `--bg-spotlight`, optional dot-grid). Consumed by Comparison + CTA.
2. `components/ui/reveal.tsx` — consolidate the 7 duplicated `Reveal` helpers into `<Reveal>` + `<RevealGroup>` (PART 0.5 primitives). Pure refactor + reuse.
3. `components/ui/product-frame.tsx` — `<ProductFrame>` (glass-strong + rounded-2xl + `--elev-3`). Holds the real deck/brand-page artifact.
4. `components/ui/stat-line.tsx` — `<StatLine>` (3 numberless trust pills, reuses `Pill`).
5. `components/ui/button.tsx` — add `primary-ink` variant (not a new file).

## 3.3 Recommended build order

1. **Tokens first** (`globals.css` PART 0.1/0.2/0.4) + **`primary-ink` button** — unblocks every section, fixes all 3 contrast deltas at the root.
2. **Shared components** (`Reveal`, `SpotlightBand`, `ProductFrame`, `StatLine`) — so sections compose, don't duplicate.
3. **Section copy + accent swap, top→bottom** (Hero → … → CTA) — each section is independently shippable; do them in render order so you can eyeball the scroll arc as it builds.
4. **Two dark bands** (Comparison, CTA) — verify glass legibility flips correctly under `data-theme="dark"`.
5. **Nav polish** (optional scroll pill) — last, low-risk.
6. **A11y + responsive QA pass** — verify the PART 0/PART 2 contrast values in a browser, 375/390/430 widths, keyboard focus on FAQ + buttons, reduced-motion on.

## 3.4 Guard rails (reality-anchor — do NOT regress)

- **No pricing/billing UI, no fabricated metric, no unshipped channel** (SMS/push/ads/Brain). The copy removed them; the design must not reintroduce a "$" chip, a fake counter, or a mock automation dashboard (COPY PART B reality anchor + flags 1–3).
- **No stock/AI imagery.** The only imagery is the REAL consumer card deck + (optional) a real brand-page mock. If an artifact isn't real and ready, ship text-only — never a placeholder screenshot (premium-craft §2).
- **Display font stays weight 400** (Mochiy). Hierarchy via size/leading/tracking/color, never `font-bold` on display.
- **Accent text on light = `text-warm-ink` (never `text-warm`).** Accent text on dark = `text-warm`. Fills/dots/chips = `warm` everywhere.

---

## Completion gate (mingla-designer `/goal`, machine-checkable)

1. **References examined** ✅ (Linear, Stripe, Partiful/Posh, Airbnb Host, Timeleft — PART intro).
2. **All 9 states** ✅ — addressed per section; static-marketing states (error/offline/submitting/empty/degraded) explicitly named N/A with reason; the one async surface (Watch video, FAQ expand) has loading/focus states specified.
3. **Every spacing/size/radius is a token** ✅ — all from the 4px grid + existing radius tokens; the only literal `rgba()`s are inside the new color/gradient/elevation token definitions (PART 0), which is where literals are required.
4. **Contrast computed, light + dark** ✅ — full table in the binding-finding block + per-section ratios; the 3 fails are fixed via `warm-ink` / `primary-ink` / `text-text-secondary` substitutions, all recomputed ≥4.5 (body) or ≥3 (large).
5. **Every interactive element** ✅ — buttons (Partner, Get the app, PlayTile), FAQ rows, audience cards: ≥44pt, `accessibilityLabel`/`aria-*`, non-shifting hover.
6. **Zero anti-slop** ✅ — no generic gradients (aurora/spotlight serve depth + brand; defined, restrained), no stock/AI imagery (real deck only), no emoji icons (lucide set), no decorative effects (every shadow/glass earns grouping/depth).
7. **Copy in Mingla voice + reduced-motion fallback** ✅ — all words pulled verbatim from COPY PART B and cited; every motion primitive has a reduced-motion branch.

**All 9 sections + page shell + nav are specced.** ✅
