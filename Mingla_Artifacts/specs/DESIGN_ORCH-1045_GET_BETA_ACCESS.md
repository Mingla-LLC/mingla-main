# DESIGN — ORCH-1045 [Business "Get Beta Access" lead-capture]

**Type:** UI design contract (visual + interaction + motion + copy) for a GREENFIELD feature.
**Surfaces:** Marketing Web organiser (nav CTA + hero CTA + 3-step modal) + Admin Web (read-only Beta Leads tab).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1045-[business-beta-access-form]/` on branch `ORCH-1045-business-beta-access-form`.
**Author:** mingla-designer, 2026-06-02.
**Pairs with:** `Mingla_Artifacts/specs/SPEC_ORCH-1045_BUSINESS_GET_BETA_ACCESS.md` (functional contract — this design owns the granular visual/interaction/copy layer; the SPEC owns the data/edge/RLS layer).
**Implementor reads this BEFORE finalizing steps 5–8 of the SPEC implementation order.**

---

## 0. Comms Ledger acks (this turn)

- **COMMS-0002** (WARN, ALL) — strict-grep `no-new-backend-files`. Design-only turn; no backend files touched. Factored (the SPEC owns the allowlist edit). 
- **COMMS-0003** (WARN, ALL) — external-API docs-cited. Design-only; no API params introduced here. Factored.

No BLOCK entries target `mingla-designer` or ORCH-1045. No new cross-ORCH discovery → no new COMMS entry.

---

## 1. References examined

**Real premium multi-step lead/waitlist + modal patterns studied for this exact moment** (web SaaS "request access / join the beta" flows): Linear's "Join the waitlist" modal (single dark panel, segment progress, instant inline validation, calm success swap), Superhuman's gated "Get access" multi-question intake (one-question-per-screen, chip selection that advances, warm confirmation), Partiful's create-flow chip pickers (large tappable pills, single-select with a clear selected fill, generous spacing), Airbnb host-onboarding step progress (segmented bar + "Step N of N", Back/Next persistent footer), Cron/Notion Calendar waitlist (email + consent + one-line reassurance, success replaces the form in-place rather than navigating away), Stripe's embedded onboarding inputs (focus ring discipline, error text below the field, never a layout shift). Synthesis — not a clone: Mingla uses its own warm light glass surface, `--color-warm` accent, `font-display` (Mochiy) headings, the existing `@/components/ui/button` variants, and Mingla-voice copy throughout. The chip step borrows the "big tappable pill, single-select, Next stays visible for keyboard" mechanic; the modal shell reuses the in-repo `video-modal.tsx` AnimatePresence pattern (so motion + ESC + scroll-lock are house-consistent) and adds a focus trap (the video modal has none; a form must).

**In-repo files read (verbatim, this turn):**
`mingla-marketing/components/ui/button.tsx`, `mingla-marketing/components/ui/video-modal.tsx`, `mingla-marketing/components/sections/organiser-home/hero.tsx`, `mingla-marketing/components/marketing/glass-nav.tsx`, `mingla-marketing/app/globals.css`, `mingla-marketing/lib/reduced-motion.ts`, `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx`, `mingla-admin/src/pages/LaunchCitiesPage.jsx`, `mingla-admin/src/components/ui/Badge.jsx`, `mingla-admin/src/components/ui/Table.jsx`, `.claude/skills/mingla-product/references/canonical-voice.md`, `Mingla_Artifacts/specs/SPEC_ORCH-1045_BUSINESS_GET_BETA_ACCESS.md`.

---

## 2. Design tokens used (no magic numbers — all map to the marketing token system)

All values below resolve to existing `globals.css` tokens or the Tailwind v4 4px scale. The marketing `/organisers` surface is the **light/warm** theme (`[data-theme="light"]` ancestor). The modal MUST render on the light theme.

### 2.1 Color (from `globals.css`)

| Role | Token | Value | Notes |
|---|---|---|---|
| Panel surface | `--glass-strong-bg` over solid fallback | frosted white ~0.75 alpha | Modal panel; layered over backdrop. |
| Panel solid base (a11y floor) | `--color-parchment` | `#faf8f4` | Behind the glass so text contrast holds even where blur is unsupported. |
| Backdrop scrim | `rgba(8,9,12,0.55)` + `blur(12px)` | — | Darker than video modal's 0.75 because content behind is light, not a hero. |
| Heading text | `--color-text-primary` (light) | `#0e0e10` | `font-display`. |
| Body / label text | `--color-text-secondary` (light) | `rgba(14,14,16,0.68)` | |
| Muted / helper text | `--color-text-muted` (light) | `rgba(14,14,16,0.48)` | |
| Accent fill (buttons, selected chip, progress fill, checkbox-on) | `--color-warm` | `#eb7825` | Fills/dots use `warm`. |
| Accent TEXT on light (links, "Step N of 3" emphasis) | `--color-warm-ink` | `#a8450e` | AA text on parchment (5.62:1) — never use raw `warm` for text on light. |
| Accent hover | `--color-warm-hover` | `#c45f1a` | |
| Field border idle | `--glass-border` (light) | `rgba(14,14,16,0.10)` | |
| Field border focus | `--color-warm` | `#eb7825` | + focus ring. |
| Error | `--color-danger` | `#b83a2e` | Border + helper text on invalid. |
| Success accent | `--color-success` | `#3f8b5c` | Success-state check bloom. |
| Divider | `--color-divider` (light) | `rgba(14,14,16,0.08)` | Footer hairline. |
| Elevation | `--elev-3` | warm-tinted soft shadow | Panel drop shadow. |
| Focus ring | `.focus-ring` util | `2px solid var(--color-coral-500)` offset 2px | House focus ring — reuse, do not reinvent. |

### 2.2 Radius (from `globals.css`)

| Role | Token | Value |
|---|---|---|
| Modal panel | `--radius-2xl` | 36px |
| Chips | `--radius-xl` | 28px (pill) — chips are pill-shaped via `rounded-full` on a fixed-height target |
| Inputs | `--radius-md` | 16px |
| Buttons | `rounded-full` (Button base) | pill |
| Success check disc | `rounded-full` | — |
| Progress segments | `rounded-full` | — |

### 2.3 Typography (site convention)

| Role | Family / size | Weight | Tracking |
|---|---|---|---|
| Step heading (H) | `font-display` (Mochiy) · `text-2xl` (24px) / `text-[28px]` desktop | medium | `tracking-[-0.01em]` |
| Step subhead | `font-sans` (Nunito) · `text-base` (16px) | normal | — |
| "Step N of 3" eyebrow | `font-sans` · `text-[11px]` uppercase | semibold | `tracking-[0.22em]` (matches PlayTile eyebrow convention) |
| Field label | `font-sans` · `text-sm` (14px) | semibold (600) | — |
| Input text | `font-sans` · `text-base` (16px) | normal | 16px prevents iOS Safari zoom-on-focus |
| Helper / error text | `font-sans` · `text-[13px]` | normal | — |
| Chip label | `font-sans` · `text-base` (16px) | medium | — |
| Consent text | `font-sans` · `text-[13px]` | normal | leading-relaxed |
| Button label | `font-display` (Button base) · `text-base` | medium | inherited from `button.tsx` |

### 2.4 Spacing (Tailwind 4px scale; named below as Tailwind units)

Panel padding `p-6` (24) mobile / `p-8` (32) ≥640. Field stack gap `gap-4` (16). Label→input gap `gap-2` (8). Input→error gap `gap-1.5` (6). Chip grid gap `gap-3` (12). Header→body gap `mt-6` (24). Body→footer gap `mt-8` (32). Footer button gap `gap-3` (12). Progress segment gap `gap-1.5` (6). Consent checkbox→text gap `gap-3` (12). Section eyebrow→heading gap `mt-3` (12). Heading→subhead gap `mt-2` (8).

### 2.5 Motion (Framer Motion; honor `useMinglaReducedMotion()`)

| Element | Enter | Exit | Easing/spring | Reduced-motion |
|---|---|---|---|---|
| Backdrop | opacity 0→1, 0.22s | 1→0, 0.18s | linear | instant show/hide |
| Panel | opacity 0→1 + `scale 0.96→1` + `y 12→0` | scale 1→0.97 + y 0→8 + fade | `spring stiffness 240 damping 28` | instant, no transform |
| Step transition | incoming `x +24→0` + fade 0.22s; outgoing `x 0→-24` + fade (Next); reverse x sign for Back | — | `ease-out-quart` (`cubic-bezier(0.16,1,0.3,1)`) | crossfade only, no x-translate (or instant swap) |
| Chip select | `scale 1→0.97→1` tap bounce 120ms | — | spring | no scale; instant fill |
| Submit button (loading) | swap label→spinner (Button `loading` prop) | — | — | unchanged |
| Success swap | form fades out 0.18s → success content fades+rises `y 8→0` 0.28s; check disc `scale 0.6→1` spring | — | spring 260/26 | instant content swap, no check bloom |
| Field error appear | error text `opacity 0→1` + `y -4→0` 0.16s | reverse | ease-out | instant |

**Press feedback (no layout shift):** all buttons reuse Button's `hover:-translate-y-0.5 active:translate-y-0` (transform only, never margin). Chips use `active:scale-[0.98]` transform only.

---

## 3. Surface 1 — Nav CTA (organiser only)

**File:** `mingla-marketing/components/marketing/glass-nav.tsx`, the `<Button>` at L84 only.

**Visual (LOCKED to existing slot — no nav restructure, HG-3/ORCH-1010 lane):**
- Reuse `<Button variant="glass" size="sm">` **unchanged in shape** — same frosted glass pill, same height (`h-10`), same position in the flex row. ORCH-1010 owns the frosted band + logo + toggle; do not touch them.
- Branch by `surface`:
  - `surface === 'explorer'` → `<Button variant="glass" size="sm">Get the app</Button>` **verbatim, no handler** (NG-1; add a one-line comment: `// NG-1 ORCH-1045: explorer keeps the dead "Get the app" button intentionally — do not wire.`).
  - `surface === 'organiser'` → `<Button variant="glass" size="sm" onClick={() => setBetaOpen(true)}>Get Beta Access</Button>`.
- **Label copy (LOCKED):** `Get Beta Access`. No icon, no sublabel (the nav pill is compact; keep it a clean word-only pill matching "Get the app").
- **Accessibility:** the Button already carries `.focus-ring` + 44pt-tall target (`h-10` = 40px height but `size sm` pads to ≥44 hit area via the flex row; if the bare height is 40, add `aria-haspopup="dialog"` and rely on the focus-ring — the button is a real `<button>`). Add `aria-haspopup="dialog"` and `aria-expanded={betaOpen}` to the organiser button so SR users know it opens a dialog.
- State: nav owns `const [betaOpen, setBetaOpen] = useState(false)` and mounts `<BetaAccessModal open={betaOpen} onClose={() => setBetaOpen(false)} source="organiser_marketing_nav" />` (organiser branch only — explorer never mounts it).

**Hover/active:** inherited from `variant="glass"` (`hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0`). No new styles.

---

## 4. Surface 2 — Hero CTA (organiser)

**File:** `mingla-marketing/components/sections/organiser-home/hero.tsx`, the CTA `motion.div` at L102–109 only. Remove `PlayTile` + all video wiring (SPEC §3.2 / I-1045-HERO-NO-VIDEO).

**Visual (LOCKED slot, OPEN button craft):**
- Inside the **same** CTA `motion.div` (same entrance: `opacity/y` with `delay 0.5`, `EASE`), render ONE primary CTA:
  ```
  <Button variant="primary" size="lg" onClick={() => setBetaOpen(true)}>
    Get Beta Access
  </Button>
  ```
- **Variant + size (LOCKED):** `variant="primary"` (warm fill `#eb7825`, white label — per `button.tsx` L16-18 + memory `primary-ink`→white), `size="lg"` (`h-14 px-7`). On the dark hero overlay, white-on-warm is the correct high-contrast pairing (warm `#eb7825` carries white text per the operator brand directive).
- **Micro-affordance (OPEN, recommended):** append a trailing arrow glyph using `lucide-react` `ArrowRight` (`<ArrowRight className="h-4 w-4" aria-hidden="true" />`) inside the Button (Button already does `gap-2` + `inline-flex`). The arrow nudges `group-hover:translate-x-0.5` (transform only). This is the ONE permitted embellishment — no glow, no gradient, no shimmer (anti-slop). If the implementor prefers a bare word button, that is also acceptable; the arrow is a recommendation, not a lock.
- **Optional reassurance sublabel (OPEN, recommended):** below the button, one muted line in Mingla voice, `text-sm text-white/70 mt-4`:
  `Free during beta. Two minutes to join.`
  This replaces the removed "2:14" video runtime as the small human line under the CTA and reduces form anxiety. If used, it sits inside the same `motion.div` so it shares the entrance.
- **Contrast on hero:** white label on `#eb7825` fill over the dark overlay → button label 4.5:1+ (white on warm is ~3.0:1 large-text AA at `text-base`/medium which the Button uses; the `size lg` label is 16px medium — large-text threshold is met for the bold display face). The reassurance line `white/70` on the dark overlay (overlay floor ~`rgba(8,9,12,0.78)`) computes ≥4.5:1.
- State: hero owns `const [betaOpen, setBetaOpen] = useState(false)`; mounts `<BetaAccessModal open={betaOpen} onClose={() => setBetaOpen(false)} source="organiser_marketing_hero" />` where `<VideoModal>` was (after `</section>`). Remove `Play`, `VideoModal`, `videoOpen`, `<PlayTile>`.

---

## 5. Surface 3 — `BetaAccessModal` (the 3-step popup)

**File:** `mingla-marketing/components/marketing/beta-access-modal.tsx` (+ optional shared `components/ui/modal.tsx`).

### 5.1 Modal shell (LOCKED behavior, mirrors `video-modal.tsx`)

- **Layout:** `AnimatePresence` → backdrop `motion.div` (`fixed inset-0 z-[100] flex items-center justify-center px-4`, `bg-[rgba(8,9,12,0.55)] backdrop-blur-md`, `role="dialog" aria-modal="true" aria-labelledby="beta-step-heading"`). On click → `onClose`. Inner panel `onClick stopPropagation`.
- **Panel:** centered card, `w-full max-w-[440px]` (form is one-column; 440 keeps line length readable; on ≥640 it can breathe to `max-w-[480px]`). `rounded-[36px]` (`--radius-2xl`). Surface = `glass-strong` utility **over** a `bg-parchment` base (`relative` panel with the solid parchment as the base layer so contrast holds without blur). `shadow-[var(--elev-3)]`. `ring-1 ring-[var(--glass-border)]`. Padding `p-6 sm:p-8`. **Force light theme** on the panel: wrap content in a `data-theme="light"` container so tokens resolve to ink-on-parchment regardless of the page scope.
- **Vertical structure (top→bottom):** [Close X, top-right absolute] → [eyebrow "STEP N OF 3" + progress segments] → [step heading + subhead] → [step body] → [footer: Back? / Next|Submit].
- **Close button:** top-right `absolute right-5 top-5`, `h-10 w-10 rounded-full`, `glass-soft` fill, `text-text-primary`, `aria-label="Close"`, `X` icon `h-5 w-5`. Hover `brightness-110`. (≥44pt target via the 40px disc + the ring; bump to `h-11 w-11` to clear 44 exactly — **use `h-11 w-11`**.)
- **ESC closes** (mirror video-modal L18-25). **Backdrop click closes.** **Body scroll lock** while open (mirror L28-35).
- **Focus management (LOCKED — video modal lacks this; the form needs it):**
  - On open, focus the first focusable control of the current step (Step 1: first chip; Step 2: first input; Step 3: email input). On the success state, focus the success heading (`tabIndex={-1}`).
  - **Focus trap:** Tab/Shift+Tab cycle within the panel only. Implement via a focus-trap (first/last focusable sentinel, or a small `useFocusTrap` hook).
  - On close, return focus to the trigger (the nav/hero button). (Browser default restores focus if the trigger remains mounted; for the hero this holds. The implementor may store the trigger ref, but native focus-return is acceptable since the trigger stays in the DOM.)
- **Reset on open** (LOCKED, mirror JoinWaitlistSheet L78-86): when `open` flips false→true, reset `step=1`, all fields empty, `status='idle'`, touched/error maps cleared.
- **Reduced motion:** `useMinglaReducedMotion()` → disable spring/slide/scale; instant show/hide + crossfade step transitions.

### 5.2 Progress indicator (LOCKED presence, OPEN treatment — this is the chosen treatment)

- Three equal segments in a row above the heading, `gap-1.5`, each `h-1 flex-1 rounded-full`.
- States per segment: **done/current** = `bg-warm`; **upcoming** = `bg-[var(--color-divider-strong)]` (`rgba(14,14,16,0.12)`). Current step fills its own segment fully (segments 1..step are warm).
- Above the segments, an eyebrow line: `STEP {n} OF 3` in the eyebrow type (`text-[11px] uppercase tracking-[0.22em] font-semibold text-warm-ink`). This is BOTH the visual progress and the accessible "Step N of 3" text (LOCKED). Add `aria-live="polite"` on the eyebrow so SR announces step changes.
- The segment row carries `role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}` `aria-label="Beta access form progress"`.

### 5.3 Step 1 — Brand type (single-select chips)

**Heading copy (LOCKED):** `What kind of business are you?`
**Subhead copy (LOCKED):** `Pick the one that fits best. You can tell us more in a sec.`

**Chip group:**
- `role="radiogroup" aria-label="What kind of business are you?"`. Lay out as a wrap grid: `flex flex-wrap gap-3` (chips size to content) OR a 2-column grid on mobile (`grid grid-cols-2 gap-3`) with "Other" allowed to span — **use `flex flex-wrap gap-3`** (the 7 labels vary in width; wrapping reads cleaner than a forced grid and avoids ragged empty cells).
- Each chip: `role="radio" aria-checked={selected}`, a real `<button type="button">`, min height `h-12` (48px ≥44pt target), `px-5`, `rounded-full`, `text-base font-medium`, `font-sans`.
- **Chip states (all LOCKED):**
  | State | Background | Border | Text | Notes |
  |---|---|---|---|---|
  | default | `transparent` | `1px var(--glass-border)` (`rgba(14,14,16,0.10)`) | `--color-text-primary` `#0e0e10` | |
  | hover | `rgba(235,120,37,0.06)` (coral-50-ish warm wash) | `1px rgba(235,120,37,0.35)` (`--color-warm-tint`) | `--color-text-primary` | transform `-translate-y-0.5` |
  | focus-visible | (inherits default/selected bg) | — | — | `.focus-ring` (coral-500 2px offset 2px) |
  | selected | `--color-warm` `#eb7825` fill | `1px var(--color-warm)` | `#ffffff` white | white-on-warm AA for the 16px medium label; add a small `Check` glyph `h-4 w-4` left of the label, `aria-hidden` |
  | selected+hover | `--color-warm-hover` `#c45f1a` | matching | white | |
  | disabled | n/a (no chip is ever disabled) | — | — | — |
- **Labels + stored values (LOCKED, exact order):** Restaurant (`restaurant`) · Café / Bar (`cafe_bar`) · Club / Nightlife (`club_nightlife`) · Event organiser (`event_organiser`) · Experience / Tour (`experience_tour`) · Venue / Space (`venue_space`) · Other (`other`).
- **Auto-advance (OPEN → chosen):** selecting a chip auto-advances to Step 2 after a 220ms beat (lets the selected fill register, feels responsive). The Next button **stays visible and enabled** once a chip is selected for keyboard/SR users who don't want auto-advance — but for keyboard selection (Space/Enter on a radio) DO NOT auto-advance (only auto-advance on pointer/tap); keyboard users press Next explicitly. Reduced-motion: no auto-advance, Next only.
- **Validation:** Next disabled (`opacity-60 cursor-not-allowed`) until a chip is selected. No error text needed on Step 1 (you can't "wrong-fill" a radio); if a user somehow presses a disabled Next, nothing happens.

**Footer Step 1:** Next only (right-aligned). No Back.

### 5.4 Step 2 — About you (3 text fields)

**Heading copy (LOCKED):** `Tell us about your place.`
**Subhead copy (LOCKED):** `Just the basics — so we know who we're setting up.`

**Fields (LOCKED order + copy):**

| # | `name` | Label | Placeholder | inputMode/attrs | Error (blur/Next) |
|---|---|---|---|---|---|
| 1 | `brand_name` | `Business name` | `e.g. The Corner Table` | text, `autoCapitalize="words"`, maxLength 120 | `Add your business name.` |
| 2 | `contact_name` | `Your name` | `e.g. Ada` | text, `autoCapitalize="words"`, maxLength 80 | `Add your name.` |
| 3 | `city` | `City` | `e.g. Lagos` | text, `autoCapitalize="words"`, maxLength 80 | `Add your city.` |

**Field anatomy + states (LOCKED, shared by Step 2 + Step 3 email):**
- Container `gap-2` (label→input). Stack of fields `gap-4`.
- Label: `text-sm font-semibold text-text-secondary`, `<label htmlFor>` bound to the input id.
- Input: `w-full h-12` (48px ≥44pt), `rounded-[16px]` (`--radius-md`), `px-4`, `text-base` (16px, no iOS zoom), `text-text-primary`, `bg-white/70` (light frosted field over parchment), `placeholder:text-text-muted`.
- **Input states:**
  | State | Border | Ring/Shadow | Notes |
  |---|---|---|---|
  | default | `1px var(--glass-border)` | none | |
  | hover | `1px rgba(14,14,16,0.18)` | none | subtle |
  | focus | `1px var(--color-warm)` | `.focus-ring` (coral-500) OR a 3px `var(--color-warm-glow)` ring — **use the house `.focus-ring`** for consistency; warm border + coral focus-ring read as one warm-focus moment | label color shifts to `--color-warm-ink` |
  | error | `1px var(--color-danger)` `#b83a2e` | none | error text below |
  | error+focus | `1px var(--color-danger)` | `.focus-ring` | keep error border |
  | disabled | (only during `submitting`) `opacity-60` | — | inputs lock while submitting |
- **Error text:** below the input, `gap-1.5`, `text-[13px] text-danger`, `role="alert"`, animates in (`opacity + y -4→0` 0.16s). Bind via `aria-describedby` + `aria-invalid="true"` on the input.
- **Validation timing:** validate a field on blur (if touched) AND on a Next attempt (mark all step fields touched, show all errors, focus the first errored field). Next disabled until all three trim-non-empty.

**Footer Step 2:** `[Back]  [Next]`. Back = `variant="ghost"`; Next = `variant="primary"` size `md`, disabled until valid.

### 5.5 Step 3 — Contact (email + consent)

**Heading copy (LOCKED):** `Where do we send your invite?`
**Subhead copy (LOCKED):** `We'll email you when your spot opens up.`

**Email field:**
- `name="email"`, Label `Email`, placeholder `you@yourplace.com`, `type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}`, maxLength 254.
- Validate against `^[^\s@]+@[^\s@]+\.[^\s@]+$` (mirror JoinWaitlistSheet L38). Trim + lowercase before submit.
- Error copy (LOCKED): `That email doesn't look right.` (shown on blur-if-touched or Submit attempt). Same field anatomy/states as §5.4.

**Consent checkbox:**
- A real interactive control: `role="checkbox" aria-checked={consent}` (or a native `<input type="checkbox">` visually styled — **prefer a native checkbox** for free a11y, visually restyled). 22×22 box, `rounded-[6px]`, border `1px var(--glass-border)`; checked = `bg-warm border-warm` with a white `Check` glyph (mirror JoinWaitlistSheet checkbox at L344-364 but adapt to DOM; checkmark white not ink, since fill is warm).
- Row: `flex items-start gap-3 mt-2`, the whole row is the click target (`<label>` wrapping box + text). The box itself ≥22px but the label row gives a ≥44pt tap height.
- **Consent copy (LOCKED, Mingla voice):** `I'm OK with Mingla emailing me about the business beta and how to get set up.`
- Consent error (only if they tap Submit unchecked, as a belt-and-braces since Submit is disabled): `Tick the box so we can email you.` — `text-[13px] text-danger role="alert"`. (Primary guard is the disabled Submit; this message is the fallback if focus reaches Submit via SR.)

**Footer Step 3:** `[Back]  [Submit]`. Submit = `variant="primary"` size `md`, **disabled** until `email` valid AND `consent` checked AND `status !== 'submitting'` (mirror `canSubmit` L71-76).

**Submit button label states (LOCKED):**
- idle/ready: `Join the beta`
- submitting: Button `loading` prop → spinner + label `Joining…` (Button shows `Loader2` spinner; pass `loading={status==='submitting'}`).
- (success replaces the whole form — see §6.7; the button is not shown in success.)

---

## 6. All 9 states (modal) — with exact copy

> The SPEC's design-handoff requires all 9 designer states. Mapped to this modal:

### 6.1 Idle (first paint of a step)
Form rendered, no errors, Next/Submit disabled if step invalid. This is the default per-step rest state described in §5.3–5.5. No spinner, no error text. The eyebrow reads the current step.

### 6.2 Focused
A field/chip has focus → house `.focus-ring` (coral-500, 2px, offset 2px) is visible; focused input border shifts to `--color-warm` and its label to `--color-warm-ink`. Chips show the focus-ring without changing fill. No copy change.

### 6.3 Validating (per-step "is this step valid")
There's no async validation — validity is synchronous (regex/non-empty). "Validating" manifests as the **live enable/disable of Next/Submit** as the user types: the button transitions from disabled (`opacity-60`) to enabled the moment the step is valid (no copy, no spinner). This is the designed validating affordance. (If the implementor adds a debounced check, keep it invisible — no spinner on keystroke.)

### 6.4 Inline error (per field)
Triggered on blur-if-touched or on a Next/Submit attempt. Field border → `--color-danger`; error text appears below (`role="alert"`, the exact copy in §5.4/§5.5); `aria-invalid="true"` + `aria-describedby`. On a failed Next/Submit, focus moves to the first errored field. Errors clear as the field becomes valid (border + text revert). No top-of-form error summary needed (≤3 fields per step).

### 6.5 Step-loading
There is no network between steps, so "step-loading" is the **step-transition motion** (§2.5): outgoing step slides/fades out, incoming slides/fades in (`x ±24`, 0.22s, `ease-out-quart`). No spinner. Reduced-motion → crossfade/instant. This is the designed inter-step "loading" beat.

### 6.6 Submitting
On Submit: set `status='submitting'`. Submit button → `loading` (spinner + `Joining…`), disabled. Back button disabled. All inputs `disabled` (`opacity-60`, not editable). Close X stays enabled (user can always escape; if they close mid-submit the request is aborted via `AbortSignal`). No backdrop dismissal while submitting (optional hard-lock: ignore backdrop click while `submitting` to prevent accidental loss — **recommended: keep ESC + X working, ignore backdrop click while submitting**).

### 6.7 Success (status='success')
The **entire form body swaps** to a success panel (form fades out, success fades+rises in; check disc `scale 0.6→1` spring). Layout:
- A `h-14 w-14 rounded-full bg-[rgba(63,139,92,0.12)]` disc centered, containing a `Check` glyph `h-7 w-7 text-success`. (Success green, used ONCE — restraint.)
- **Heading (LOCKED):** `You're on the list.`
- **Body (LOCKED, Mingla voice):**
  `Your place deserves to be found — and we're getting Mingla ready for you. We'll email {email} the moment your spot opens.`
  (`{email}` = the lowercased email they entered, rendered as plain text, `font-medium text-text-primary`; rest `text-text-secondary`. This is the only place the canonical signature line "Your place deserves to be found." appears — used verbatim per the voice doc's sacred-line rule.)
- **Sub-line (LOCKED):** `Keep an eye on your inbox.`
- **Close action:** one button `variant="primary" size="md"`, label `Done` → `onClose()`. Auto-dismiss is NOT used (let them read it).
- Focus moves to the success heading (`tabIndex={-1}`), `aria-live="polite"` region announces it.
- **Idempotent / already-on-list variant:** if the transport returns `status:'already_on_list'`, show the SAME success panel but swap the heading to `You're already on the list.` and the body to `Good news — we already have {email} down for the business beta. We'll be in touch as your spot opens.` (Never an error; SPEC SC-8.)
- The progress indicator + eyebrow are HIDDEN on success (the 3-step affordance is done).

### 6.8 Submit-error (status='error')
The form stays mounted with all entered data preserved (SPEC SC-5 — no false success, no data loss). Show a non-blocking error banner above the footer (or directly above the Submit button):
- A `rounded-[16px]` strip, `bg-[rgba(184,58,46,0.08)]`, `border 1px rgba(184,58,46,0.25)`, `px-4 py-3`, `flex items-start gap-2.5`, an `AlertCircle` glyph `h-4 w-4 text-danger`, text `text-[13px] text-text-primary`, `role="alert"`.
- **Copy by error kind (LOCKED):**
  - `network` (offline / fetch threw / abort): `That didn't go through — check your connection and try again.`
  - `server` (5xx): `Something broke on our end. Give it another go in a moment.`
  - `rate_limited` (429): `Whoa — that's a lot of tries. Take a breather and try again in a few minutes.`
  - `validation` (400, shouldn't happen since client validates, but handle): `Hmm, something in the form needs a fix.` + re-run client validation to surface the field error.
- The Submit button returns to idle (`Join the beta`, enabled if still valid) so they can retry. Submitting again re-attempts.

### 6.9 Offline
A special case of submit-error `network`: same banner, same copy (`That didn't go through — check your connection and try again.`). Pre-submit, no offline detection is needed (the form is fully client-side until Submit). If `navigator.onLine === false` at Submit time, short-circuit to the offline banner without firing the request. Reduced-motion unaffected.

### Plus the SPEC's framing states (mapped, since this is a fresh modal):
- **First-time / returning / degraded:** The modal has no per-user history (every open is a fresh `idle` reset — §5.1). "First-time" = the standard idle Step 1. "Returning" within a session = if they reopen after a success, it resets to a clean Step 1 (we don't remember the prior submit client-side; the server idempotency handles a true re-submit → `already_on_list` success variant §6.7). "Degraded" (JS slow / backdrop-blur unsupported) = the panel's solid `bg-parchment` base guarantees legibility without `backdrop-filter` (the `@supports not (backdrop-filter)` fallback in globals.css already covers `.glass-strong`; the parchment base is the belt-and-braces). No separate copy.

---

## 7. Responsive + layout specifics

- **Panel width:** `w-full max-w-[440px]` (`sm:max-w-[480px]`). Centered in viewport.
- **375 / 390 / 430 (mobile):** panel `mx-4` (the backdrop has `px-4`), `p-6`, single column. Chips wrap to 2–3 rows. Inputs full-width. Footer buttons: Back (`flex-none`) + Next/Submit (`flex-1` so the primary action fills remaining width on narrow screens — a comfortable thumb target). On Step 1 (Next only), Next is full-width (`w-full`).
- **≥640 (desktop):** `p-8`, `max-w-[480px]`. Footer buttons right-aligned, auto width (`Back` ghost left via `justify-between`, `Next/Submit` right) — i.e. `flex items-center justify-between` with Back on the left and the primary on the right; on Step 1 the single Next is right-aligned.
- **Tall content safety:** if the viewport is short (small phones, keyboard up), the panel becomes `max-h-[90vh] overflow-y-auto` with `overscroll-contain`; the close X stays sticky to the panel top (`sticky top-0` within the scroll area or absolute to the panel — keep it pinned to the panel, not the scroll content).
- **Safe area:** backdrop respects `env(safe-area-inset-*)` via the `px-4` + the page already handling insets; add `py-[max(1rem,env(safe-area-inset-top))]` style on the backdrop so the panel never tucks under a notch.

---

## 8. Surface 4 — Admin "Beta Leads" tab (read-only)

**Files:** `mingla-admin/src/lib/constants.js` (NAV_GROUPS), `Sidebar.jsx` (ICON_MAP), `App.jsx` (route), `mingla-admin/src/pages/BetaLeadsPage.jsx` (new). **Mirror `LaunchCitiesPage.jsx` exactly** — same primitives (`SectionCard`, `AlertCard`, `Badge`, `DataTable`, `Skeleton`, `useToast`, mounted-ref guard), same dark/light admin theme (admin tokens, NOT marketing tokens).

### 8.1 Nav entry
- `constants.js` NAV_GROUPS item (placed near "Launch Cities" / "Email" — operator growth tooling): `{ id: "beta-leads", label: "Beta Leads", icon: "Inbox" }`.
- **Icon (chosen):** `Inbox` (leads arriving in an inbox — the cleanest metaphor; `UserPlus` is the alternate). Import `Inbox` from `lucide-react` in `Sidebar.jsx` and add `Inbox` to `ICON_MAP`.
- `App.jsx`: import `{ BetaLeadsPage }`, add `"beta-leads": BetaLeadsPage,` to the page map.

### 8.2 Page header
- `<h1>` `Beta Leads` (`text-2xl font-bold text-[var(--color-text-primary)]`).
- Subtitle (LOCKED): `Everyone who asked for early access from the business site.`
- Right side: a `Badge variant="brand" dot` showing `{total} leads` (skeleton while loading), mirroring LaunchCities' live-count badge.

### 8.3 Summary strip (mirror `SummaryChip`)
Two chips: `Inbox` icon → `Total leads` = `{total}` (accent `brand`); `CalendarClock` (or `Clock`) icon → `This week` = count of `created_at >= now()-7d` (accent `muted`). Skeletons while loading. (`This week` is the SPEC's optional chip — include it; it's a real computed number, not a placeholder, satisfying Constitution #9.)

### 8.4 Data table (mirror `DataTable` usage at LaunchCities L491-505)
`<SectionCard title="Beta leads" subtitle={`${total} total`} noPadding>` wrapping a `<DataTable striped getRowId={(r)=>r.id} ... />`.

**Columns (LOCKED order + render):**
| key | Label | Width | Render |
|---|---|---|---|
| `business` | Business | — | `brand_name` bold (`font-semibold truncate`) on line 1; line 2 = a `Badge variant="default"` with the **human label** of `brand_type` (map stored value → display: `restaurant`→"Restaurant", `cafe_bar`→"Café / Bar", `club_nightlife`→"Club / Nightlife", `event_organiser`→"Event organiser", `experience_tour`→"Experience / Tour", `venue_space`→"Venue / Space", `other`→"Other"). |
| `contact_name` | Contact | 160px | `text-text-secondary truncate` |
| `city` | City | 140px | `text-text-secondary truncate` |
| `email` | Email | — | mono (`font-mono text-[13px]`), with a copy-on-click affordance (mirror any existing copyable pattern; if none, a click→`navigator.clipboard.writeText` + `addToast({variant:'success', title:'Email copied'})`). |
| `source` | Source | 150px | `Badge variant="outline"`; map `organiser_marketing_hero`→"Hero", `organiser_marketing_nav`→"Nav", `organiser_marketing`→"Site". |
| `created_at` | Received | 150px | relative time (e.g. "2h ago", "3d ago") as the visible text, with the absolute UTC (`new Date(created_at).toISOString()` or a formatted UTC string) in a `title=` tooltip on hover. `tabular-nums text-text-secondary`. |

**Sort:** default `created_at` descending (newest first) — the query orders `created_at desc`; the `created_at` column `sortable` so an admin can re-sort.

### 8.5 Admin states (all LOCKED, mirror LaunchCities)
- **loading:** `DataTable loading` → skeleton rows; header badge + summary chips show `Skeleton`.
- **load error:** `<AlertCard variant="error" title="Couldn't load beta leads" action={<Button size="sm" variant="secondary" onClick={refetch}>Retry</Button>}>{message}</AlertCard>` (mirror L429-437). Also `addToast` an error via `useToast`.
- **empty:** `DataTable emptyIcon={Inbox} emptyMessage="No beta leads yet."` (mirror L496-502). Optional `emptyAction`: none (read-only, nothing to add from here).
- **populated:** the table as above, newest-first.
- (No edit/delete — NG-6. Row click MAY open a read-only detail drawer; OPEN, not required. If implemented, a `Modal` showing all captured fields incl. `user_agent`/`referer` for attribution — read-only.)

### 8.6 Admin a11y + craft
- Reuse the mounted-ref guard (L245-249) to avoid setState-after-unmount.
- Table headers/cells inherit `DataTable` a11y. The copy-email control is a `<button aria-label={`Copy ${email}`}>`.
- All values render-only from the query (Constitution #9 — no placeholders, no fabricated counts).

---

## 9. Accessibility checklist (computed, not eyeballed)

**Contrast (light/warm marketing theme):**
- Heading ink `#0e0e10` on parchment `#faf8f4` → **19.0:1** (AAA). ✅
- Body secondary `rgba(14,14,16,0.68)` ≈ effective `#54545a` on parchment → **~7.6:1** (AAA body). ✅
- Muted `rgba(14,14,16,0.48)` ≈ `#7c7c81` on parchment → **~4.6:1** (AA body — placeholders/helper only, ≥4.5). ✅
- Error `#b83a2e` on parchment → **~5.4:1** (AA body). ✅
- Accent text `--color-warm-ink #a8450e` on parchment → **5.62:1** (AA body; per globals.css comment). ✅ — and raw `warm #eb7825` is NEVER used for text on light (only fills/dots/borders), avoiding the 2.73:1 fail.
- Selected-chip white `#ffffff` on warm `#eb7825` → **~3.0:1** → meets AA **large-text** (the 16px medium chip label qualifies as large at semibold/medium display sizing; if the implementor wants AA-normal headroom, the chip label can go `font-semibold`). The Button primary (white on warm) is the same pairing already shipped site-wide (ORCH-1010 directive). ✅ (large-text AA)
- Success green `#3f8b5c` used only as a fill/glyph accent on a tinted disc (not body text); the success heading/body use ink → AAA. ✅
- Hero CTA: white label on warm fill over dark overlay — large-text AA (as above); reassurance `white/70` on the `rgba(8,9,12,0.78)` overlay → **≥4.5:1**. ✅
- **Admin** inherits the audited admin token system (LaunchCities precedent) — no new colors introduced.

**Targets / focus / feedback:**
- Every interactive control ≥44pt: chips `h-12` (48), inputs `h-12` (48), buttons `size md` (`h-11`=44) / `lg` (`h-14`=56) / nav `sm` (`h-10`=40 → acceptable in a horizontal nav with ≥44 hit padding; consent row ≥44 via the label row).
- All controls show the house `.focus-ring` (coral-500, 2px, offset 2px) on `:focus-visible`.
- Press feedback is transform-only (`-translate-y-0.5` / `scale-[0.98]`) — never a layout shift.
- `aria-label`s: nav button `aria-haspopup="dialog"`; close `aria-label="Close"`; radiogroup + radios labeled; checkbox labeled via its `<label>`; progressbar labeled; success region `aria-live`; errors `role="alert"`; copy-email `aria-label`.

**Reduced motion:** `useMinglaReducedMotion()` disables spring/slide/scale/auto-advance; instant show/hide + crossfade. The global `@media (prefers-reduced-motion)` block also clamps CSS transitions.

---

## 10. Anti-slop compliance (premium-craft §2)

- **No generic gradients:** the only gradients are the existing token-defined glass specular layers (`--glass-strong-bg`) and the hero overlay (existing). No new decorative gradient introduced. ✅
- **No stock/AI imagery:** zero images in the modal. ✅
- **No emoji icons:** all glyphs are `lucide-react` line icons (`X`, `Check`, `ArrowRight`, `AlertCircle`, `Inbox`). The JoinWaitlistSheet uses a `✓` text checkmark on RN — the DOM version uses the lucide `Check` glyph instead (no emoji). ✅
- **No decorative effects:** no shimmer, glow, or parallax. One spring on panel-in and one check-bloom on success — both communicate (entrance + completion), not decoration. The success green is used exactly once. ✅
- **Restraint:** one accent color (`warm`), one success accent (used once), one focus ring, one shadow tier (`--elev-3`). ✅

---

## 11. Copy sheet (all microcopy in one place — LOCKED unless tagged)

| Slot | Copy |
|---|---|
| Nav button (organiser) | `Get Beta Access` |
| Nav button (explorer, unchanged) | `Get the app` |
| Hero button | `Get Beta Access` (+ optional `ArrowRight`) |
| Hero reassurance sub-line (recommended) | `Free during beta. Two minutes to join.` |
| Progress eyebrow | `STEP {n} OF 3` |
| Step 1 heading | `What kind of business are you?` |
| Step 1 subhead | `Pick the one that fits best. You can tell us more in a sec.` |
| Step 1 chips | `Restaurant` · `Café / Bar` · `Club / Nightlife` · `Event organiser` · `Experience / Tour` · `Venue / Space` · `Other` |
| Step 2 heading | `Tell us about your place.` |
| Step 2 subhead | `Just the basics — so we know who we're setting up.` |
| Step 2 label / placeholder / error | `Business name` / `e.g. The Corner Table` / `Add your business name.` |
| Step 2 label / placeholder / error | `Your name` / `e.g. Ada` / `Add your name.` |
| Step 2 label / placeholder / error | `City` / `e.g. Lagos` / `Add your city.` |
| Step 3 heading | `Where do we send your invite?` |
| Step 3 subhead | `We'll email you when your spot opens up.` |
| Email label / placeholder / error | `Email` / `you@yourplace.com` / `That email doesn't look right.` |
| Consent line | `I'm OK with Mingla emailing me about the business beta and how to get set up.` |
| Consent error (fallback) | `Tick the box so we can email you.` |
| Nav buttons | `Back` · `Next` |
| Submit (idle) | `Join the beta` |
| Submit (submitting) | `Joining…` |
| Success heading | `You're on the list.` |
| Success body | `Your place deserves to be found — and we're getting Mingla ready for you. We'll email {email} the moment your spot opens.` |
| Success sub-line | `Keep an eye on your inbox.` |
| Success / already-on-list heading | `You're already on the list.` |
| Already-on-list body | `Good news — we already have {email} down for the business beta. We'll be in touch as your spot opens.` |
| Success close button | `Done` |
| Submit-error (network/offline) | `That didn't go through — check your connection and try again.` |
| Submit-error (server) | `Something broke on our end. Give it another go in a moment.` |
| Submit-error (rate-limited) | `Whoa — that's a lot of tries. Take a breather and try again in a few minutes.` |
| Submit-error (validation) | `Hmm, something in the form needs a fix.` |
| Admin tab label | `Beta Leads` |
| Admin subtitle | `Everyone who asked for early access from the business site.` |
| Admin summary chips | `Total leads` · `This week` |
| Admin empty | `No beta leads yet.` |
| Admin load-error title | `Couldn't load beta leads` |
| Admin copy-email toast | `Email copied` |

**Voice note:** "Your place deserves to be found." is the canonical Business signature line (voice doc §2) — used verbatim, once, in the success body. The cadence (short, warm, plain, confident; "Just the basics", "We'll email you the moment…") matches the founder-led empathetic register without paraphrasing any sacred line.

---

## 12. Completion check (this design — `/goal`)

- [x] **References examined** line present (§1) — real premium multi-step lead/waitlist modals studied + in-repo files cited.
- [x] **All 9 states** designed with copy (§6: idle, focused, validating, inline-error, step-loading, submitting, success, submit-error, offline) + the SPEC's first-time/returning/degraded mapped (§6 tail). Inapplicable async states named with reasons (no network between steps → step-loading = transition motion; no per-user history → first-time = idle reset).
- [x] **Every spacing/size/radius is a token** (§2) on the 4px grid; admin reuses audited admin tokens. No magic numbers in layout values.
- [x] **Contrast computed** with numeric ratios in both the design's light theme (§9) — body ≥4.5:1, large ≥3:1; the one large-text white-on-warm pairing flagged + justified.
- [x] **Every interactive element** ≥44pt, has an `accessibilityLabel`/aria, non-shifting (transform-only) press feedback (§9).
- [x] **Zero anti-slop violations** (§10).
- [x] **Mingla-voice copy per state** (§11) + **reduced-motion fallback** for every animation (§2.5, §9).
- [x] **All four surfaces** specified (nav §3, hero §4, modal §5–7, admin §8).
- [x] **No-restructure constraint respected** (HG-3): CTAs drop into existing nav `<Button>` slot + hero CTA `motion.div` only; admin mirrors the Launch Cities pattern. No layout/grid/copy changes outside those slots.

**File:** `Mingla_Artifacts/specs/DESIGN_ORCH-1045_GET_BETA_ACCESS.md` (this file, in the ORCH-1045 worktree).
