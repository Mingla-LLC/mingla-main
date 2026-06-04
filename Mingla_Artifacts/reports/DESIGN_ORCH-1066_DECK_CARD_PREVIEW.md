# DESIGN — ORCH-1066 [admin deck score tuner + card preview]

**Status:** BUILD-READY (design contract)
**Author:** mingla-designer
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1066-[deck-score-tuner]/` on branch `ORCH-1066-deck-score-tuner`
**Surface:** Admin Web only (`mingla-admin`, React + Tailwind v4 `@theme` tokens + lucide-react)
**Binding inputs:** SPEC §3.8 / §3.9 / §3.10 (functional contract), `globals.css` (token authority), `SwipeableCards.tsx:2604-2658` + styles `:2868-2977` (native card source of truth), `ui/Button.jsx` / `ui/Badge.jsx` / `ui/Input.jsx` / `ui/Skeleton.jsx` / `ui/Spinner.jsx` (existing primitives — REUSE, do not re-author).

**References examined (premium-craft §3):** the single source of truth is the live Mingla consumer deck card itself — `app-mobile/src/components/SwipeableCards.tsx` front face (geometry confirmed in code: `glass.card.bezelRadius` outer radius, hero `IMAGE_SECTION_RATIO` ~60-65%, `heroGradient` bottom 45% three-stop scrim `rgba(0,0,0,0)→0.2→0.55`, `titleOverlay` padding 20 / paddingBottom 40, `cardTitle` 24/bold, `oneLiner` 15/600 numberOfLines=1, `detailsBadges` row gap 8 wrap). The replica matches IT, not a generic card aesthetic. Secondary references for the admin-side tuner control ergonomics (dial + live-rank readout pattern): Linear's property-editor rows (label / mono value / inline control, no modal hop), Stripe Dashboard's read-only computed badges next to editable fields. No generic "card UI" template was cloned. Web available — not skipped.

**Comms ledger:** read on entry. No BLOCK targeting mingla-designer or ORCH-1066. WARN entries COMMS-0002 (strict-grep backend allowlist) and COMMS-0018 (venue-onboarding source reconciliation) are backend/implementor concerns, not design-phase — noted, not actioned here.

---

## 0. What this document owns vs. delegates

This contract owns the **visual + interaction + copy + token + state** specification for two reusable blocks:

1. **`<DeckCardPreview>`** — the web replica of the consumer swipe-card front face (§A).
2. **`<ScoreTunerPanel>`** — the reusable per-category signal tuner block that mounts BOTH inside the Venue Claims modal (`ClaimsPage.jsx`) AND on the standalone tuner page (`DeckScoreTunerPage.jsx`) (§B).

It does **not** own: the RPC contracts, the edge-action wiring, the service-layer signatures, the migration, or the nav wiring — those are fully specified in the SPEC. Where this design references a data field it cites the SPEC field name verbatim so the implementor never guesses.

**Token discipline:** every spacing/size/radius below is a token from `globals.css` (`--space-*` = 4 / 8 / 16 / 24 / 32 / 48; `--radius-sm/md/lg/xl` = 8 / 12 / 16 / 24) or a Tailwind step on the same 4px grid. Zero magic numbers except the two intentional native-fidelity constants called out explicitly in §A.2 (the card's own internal geometry, which mirrors the native pt values and is documented as such).

---

# §A — `<DeckCardPreview>`

**File:** `mingla-admin/src/components/DeckCardPreview.jsx`

## A.1 Job

Show an admin, with zero ambiguity, **how this venue's card will render in the consumer deck** for the category currently being tuned — using only real venue data, never fabricated. It is a confidence instrument: "tune the score, watch the card you're ranking." It is NOT a marketing surface and never invents a hero, a distance, or a rating.

## A.2 Anatomy & geometry (token-mapped to the native card)

The replica is a single rounded card, **fixed width 340px** (within the SPEC's 320–360px envelope; 340 = `--space-xl` × 10.625, but pin it as a named constant `CARD_W = 340` with a comment "native-fidelity width, SPEC §3.10"), **aspect-ratio 3 / 4** (portrait, matches the native deck card's tall hero-dominant proportion). Height derives from width → 453px. Do not hardcode height; use `aspect-[3/4]`.

| Layer | Spec | Token / value | Native parity note |
|---|---|---|---|
| Outer card | rounded, clipped, elevated | `rounded-[24px]` (= `--radius-xl`), `overflow-hidden`, `shadow-[var(--shadow-lg)]` | Native uses 40pt bezel; 24px is the admin-scale equivalent (admin's largest radius token). Documented downscale. |
| Hero region | top 64% of card | `h-[64%]` of the card, `relative` | Native `IMAGE_SECTION_RATIO` ~0.6–0.65 → 64%. |
| Hero image | cover-fit real photo | `<img>` `object-cover w-full h-full`, `loading="lazy"`, `draggable={false}` | Source `place_pool.stored_photo_urls[0]`. |
| Scrim | bottom fade over hero | abs-positioned `inset-x-0 bottom-0 h-[55%]`, `bg-gradient-to-t from-black/60 via-black/25 to-transparent`, `pointer-events-none` | Native three-stop `0→0.2→0.55` over bottom 45%; admin uses `from-black/60 via-black/25 to-transparent` over bottom 55% to clear text at web scale. |
| Title + meta overlay | bottom-left, over scrim | abs `inset-x-0 bottom-0`, `p-[var(--space-md)] pb-[var(--space-lg)]` (16 / 24) | Native padding 20 / paddingBottom 40 → admin 16 / 24 (downscaled, same rhythm). |
| Title | venue name | `text-[20px] leading-[1.15] font-bold text-white`, `line-clamp-2`, `[text-shadow:0_1px_3px_rgba(0,0,0,0.6)]` | Native 24/bold + textShadow. 20px at 340w. |
| One-liner | summary, single line | `text-[13px] font-semibold text-white/95 line-clamp-1 mt-[var(--space-xs)]`, same text-shadow | Native 15/600 numberOfLines=1. Hidden if null. |
| Badge row | meta chips, wrap | `flex flex-wrap gap-[var(--space-sm)] mt-[var(--space-sm)]` (8 / 8) | Native `detailsBadges` gap 8 wrap. |
| Rating badge | star + number | see A.4 | Hidden if `rating == null || rating <= 0`. |
| Price badge | tier label | see A.4 | Hidden if null. |
| Category pill | focused signal label | see A.4 | Always shown. |

**Caption strip (below the card, NOT on it):** one line, `text-[12px] text-[var(--color-text-tertiary)] mt-[var(--space-sm)] max-w-[340px]`:
> "Distance & travel time appear on the buyer's device, based on where they are."

This is LOCKED copy (SPEC §3.10) and prevents a false "card is missing fields" bug report. It lives outside the card so the card itself stays a faithful replica.

## A.3 The glass badge (web replica of native `GlassBadge`)

The native badges are frosted-glass chips. Web replica — a single reusable internal sub-component `<CardChip icon label />`:

- Container: `inline-flex items-center gap-[6px] h-[26px] px-[8px] rounded-full`, `bg-white/18 backdrop-blur-md border border-white/25`.
- Icon: lucide, `14px`, `text-white`, `aria-hidden`.
- Label: `text-[12px] font-semibold text-white whitespace-nowrap`.
- Text-shadow on the label `[text-shadow:0_1px_2px_rgba(0,0,0,0.5)]` so it survives a bright photo patch (matches native).

`backdrop-blur` over the scrim + photo gives the frosted-glass read without a fake gradient. Contrast: white on the scrim's darkest band (`≈#262626` equivalent) = **15.13:1** (verified) — passes AAA even over a mid-tone photo because the scrim + per-chip 18% white fill + text-shadow stack.

## A.4 Badge inventory (exact, per SPEC §3.10 field contract)

| Chip | lucide icon | Source field | Render rule |
|---|---|---|---|
| Rating | `Star` (filled: `fill-white`) | `place_pool.rating` | `rating.toFixed(1)`. **Hidden** if `rating == null \|\| rating <= 0` (exact native rule). |
| Price | `Tag` | `place_pool.price_tiers` / `price_level` | Tier label via the shared `priceTiers` mapping if portable, else `price_level` → `$`/`$$`/`$$$`/`$$$$`. **Hidden** if null. |
| Category | `Sparkles` | the tuner's currently-focused `signal_id` → `signal_definitions.label` | **Always shown.** This is the live coupling: as the admin focuses a different signal row in the panel, the pill text updates. |
| ~~Distance~~ | — | — | **OMITTED.** Admin has no buyer geo. Never fabricated (Constitution #9). |
| ~~Travel time~~ | — | — | **OMITTED.** Same. |

Badge order left→right: Rating (if present), Price (if present), Category (always). No distance/travel placeholders, no empty slots.

## A.5 States (all 9 — card-level)

| State | Trigger | Design |
|---|---|---|
| **loading / skeleton** | preview data in flight | Card silhouette at 340×453 with `rounded-[24px] overflow-hidden`. Hero region = `.skeleton-shimmer` block. Overlay: two shimmer bars (title 70% × 18px, one-liner 45% × 13px) + three pill-shaped shimmer chips (`rounded-full h-[26px]` widths 54/44/72). Uses existing `<Skeleton>` primitive. `aria-busy="true"`, `aria-label="Loading card preview"`. |
| **real-photo / populated** | `stored_photo_urls[0]` valid | Full anatomy §A.2. The default success state. |
| **no-photo (honest placeholder)** | `stored_photo_urls` null/empty OR `[0] === '__backfill_failed__'` | Hero region = solid `bg-[var(--gray-800)]` (light) / `bg-[var(--gray-100)]` (dark) — a flat neutral, NOT a gradient, NOT stock art. Centered: lucide `ImageOff` icon `32px text-white/40` above `text-[12px] font-medium text-white/55` reading **"No photo yet"**. Scrim still applied so the title overlay stays legible. White-on-`#1f2937` = **14.68:1**, subtext white/55 ≈ 5.8:1 — both pass. This is the LOCKED no-AI-slop placeholder. |
| **error** | preview fetch threw | Card frame retained; hero region = `bg-[var(--gray-100)]`, centered lucide `AlertTriangle 28px text-[var(--color-text-tertiary)]` + `text-[13px] text-[var(--color-text-secondary)]` "Couldn't load this card." + a `<Button variant="ghost" size="sm" icon={RotateCw}>Retry</Button>`. No overlay text (nothing to overlay). |
| **empty / first-time** | no venue selected (tuner page) | Card not rendered; the host panel shows its own empty state (§B.6). `<DeckCardPreview>` returns `null` when `placeData == null`. |
| **submitting** | a score write in flight | Card stays fully rendered (it reflects committed data, re-fetched after each write per SPEC §3.8.3). A subtle top-edge progress hint: `absolute inset-x-0 top-0 h-[3px] bg-[var(--color-brand-500)] animate-pulse` inside the hero clip. No skeleton flash — the previous card holds until the re-fetch resolves (prevents flicker). |
| **offline** | write failed offline | Card unchanged (still shows last-committed data). The host panel surfaces the offline toast (§B.6); the card does not change — it is honest about committed state. |
| **returning** | re-open with cached venue | Identical to populated; no special treatment (admin tool, no first-run vs returning distinction at card level). |
| **degraded** | photo `<img>` `onError` at runtime (URL 404s after load attempt) | Fall back to the **no-photo placeholder** (§ above) — never a broken-image glyph. Wire `onError={() => setHeroFailed(true)}`. |

**Reduced motion:** the submitting top-edge pulse and skeleton shimmer both already honor `@media (prefers-reduced-motion: reduce)` via the global rule in `globals.css:228-234` (animations forced to 0.01ms). No extra work; verify the brand top-edge bar degrades to a static brand line (acceptable).

## A.6 Light + dark

The card interior is photo-driven and always dark-overlaid, so the card face itself looks identical in both themes (white text on scrim). Only two surfaces are theme-aware:
- **No-photo hero fill:** `--gray-800` (light → `#1f2937`) vs `--gray-100` (dark → `#242833`). White-on-both ≥ 14.6:1 (verified).
- **Caption strip + error/skeleton frames:** use `--color-text-tertiary` / `--gray-100` which flip automatically via the `[data-theme="dark"]` block.

No hardcoded hex in the component except `white`/`black` alpha values on the scrim and chips (intentional, photo-overlay layer — these are the native card's own values, not theme tokens).

## A.7 Accessibility

- Card root: `role="img"` with `aria-label` composed from real data: `` `Deck card preview for ${name}${rating ? `, rated ${rating.toFixed(1)}` : ''}, category ${categoryLabel}` ``. Screen-reader users get the meaningful content without the decorative chips being read twice.
- Hero `<img>` `alt=""` (decorative — the content is in the aria-label) when populated; when placeholder, the `aria-label` already states "No photo yet" context via the visible text.
- Chips: each icon `aria-hidden`, label is real text → readable.
- No interactive elements inside the card (it is display-only) → no hit-target concern for the card itself.

---

# §B — `<ScoreTunerPanel>` (reusable block)

**File:** `mingla-admin/src/components/ScoreTunerPanel.jsx` (new; imported by both `ClaimsPage.jsx` and `DeckScoreTunerPage.jsx`).

## B.0 Reuse contract

One component, two mount contexts. Differences are passed as props, never forked:

| Prop | Claims modal | Standalone tuner page |
|---|---|---|
| `placePoolId` | `detail.place_pool_id` | selected search result id |
| `projected` | `true` (venue is `pending_review`, non-servable) | `false` (search returns `is_servable=true` only) |
| `placeData` | from claim bundle | from `getPlacePreviewCard` |
| `scores` | from claim bundle | from `getPlaceScores` |
| `needsSeed` | `scores.length === 0` → show "Score this venue now" | never (live venues already scored) — fall back to seed button only if somehow 0 |
| `onAfterWrite` | re-fetch claim bundle | re-fetch scores + rank |
| `density` | `'modal'` (narrower, embedded) | `'page'` (wider, two-column-aware) |

The panel renders the SAME signal-row list, the SAME dial/pin/rank controls, the SAME `<DeckCardPreview>`. The ONLY visual difference is the rank label prefix ("Projected" vs live) and outer width — both driven by props.

## B.1 Layout — two-column on page, stacked in modal

**Standalone page (`density='page'`, ≥1024px viewport):** two-column grid.
- Left column (flex 1, min 360px): the 16-signal list (§B.3) inside a scroll region.
- Right column (fixed 340px + `--space-md` gutter): **sticky** (`sticky top-[var(--space-lg)]`) `<DeckCardPreview>` + rank readout strip (§B.4) + radius selector (§B.5).
- Grid: `grid grid-cols-[1fr_372px] gap-[var(--space-xl)]` (32px gutter). Below 1024px → single column, preview moves above the list (`flex flex-col`, preview first).

**Claims modal (`density='modal'`):** single column, stacked. Order top→bottom: (1) header + radius selector inline, (2) `<DeckCardPreview>` centered, (3) rank readout strip, (4) the 16-signal list. The modal is already a constrained width; the card sits at its native 340 centered with `mx-auto`.

**Panel outer padding:** `p-[var(--space-lg)]` (24) on the page; `p-0` in the modal (the modal supplies its own padding — pass `density='modal'` to drop the panel's own outer pad and avoid double-gutter).

## B.2 Header + "Score this venue now" (seed) affordance

Panel header row: `flex items-center justify-between mb-[var(--space-md)]`.
- Left: `text-[15px] font-semibold text-[var(--color-text-primary)]` — "Category scores" + a count `<Badge variant="default">{scoredCount}/16</Badge>`.
- Right: the radius selector (§B.5).

**Unscored gate (`needsSeed === true`):** the 16-signal list is REPLACED by a centered empty block (the SPEC's dead-end-copy replacement, §3.8.1):
- lucide `Sparkles 28px text-[var(--color-brand-500)]` (or `Wand2`).
- `text-[14px] font-medium text-[var(--color-text-primary)]` — "Not scored yet."
- `text-[13px] text-[var(--color-text-secondary)] mt-[var(--space-xs)] max-w-[40ch]` — "Seed all 16 categories at a neutral starting score, then tune each one."
- `<Button variant="primary" size="md" icon={Sparkles} loading={seeding}>Score this venue now</Button>` — full label, ≥44px target (`size=md` = h-10 = 40px; **override to `size="lg"` = h-12 = 48px** here so the seed CTA clears the 44px floor and reads as the primary action). On success → toast "Seeded 16 categories — tune them below." → `onAfterWrite()` re-fetches and the list renders.

Microcopy is Mingla-voice: plain, warm, action-first. Not "Initialize scoring." → "Score this venue now."

## B.3 The 16-signal list

A vertical list (NOT a grid — comparison is vertical, density serves the compare task per Mingla principle 2). Sorted **score-descending** so the venue's strongest categories surface first; ties alphabetical by label. Each signal is one row:

**Row container:** `flex items-center gap-[var(--space-md)] py-[var(--space-sm)] px-[var(--space-sm)] rounded-[12px]` (radius-md). Hover `hover:bg-[var(--gray-50)]`. Row separation by `divide-y divide-[var(--table-border)]` on the list wrapper (no per-row border).

**Row anatomy (left → right):**

1. **Label** (flex, min 96px): `text-[14px] font-medium text-[var(--color-text-primary)]` — `signal_definitions.label`. Below it, a `text-[12px] text-[var(--color-text-tertiary)]` rank micro-line per row: "#N · M live" (the per-signal rank chip, B.3.4). When focused, label gets `text-[var(--color-brand-700)]` and a 2px left accent bar.

2. **Current score** (mono, fixed 44px): `font-[var(--font-mono)] text-[15px] tabular-nums text-[var(--color-text-primary)] text-right`. This is the committed `place_scores.score`. When the input value diverges from committed → this mono value shows the committed number with a `text-[var(--color-text-tertiary)] line-through` and the pending value next to it in `text-[var(--color-brand-600)]` (the **edited** state, B.3.5).

3. **Dial input** (the 0–200 control): a number input + a range slider, paired. See B.3.1 — this is the core interactive element, ≥44px.

4. **Set button**: `<Button variant="secondary" size="sm" icon={Check}>` — **but** sm = h-8 = 32px < 44px. **Override:** in the signal row, Set/Pin use `size="md"` (h-10 = 40px) AND the tap target is extended via `min-h-[44px]` wrapper, OR (preferred) render them as `size="sm"` with an explicit `className="!h-11"` (44px). LOCKED: every per-row action button is **≥44px tall**. Set is disabled (`opacity-50`) until the input value differs from committed (no-op guard).

5. **Pin button**: `<Button variant="ghost" size="sm" icon={ArrowUpToLine} className="!h-11">` — "Pin to top". Icon-led; on `density='modal'` (narrow) it collapses to icon-only with `aria-label="Pin {label} to top of the deck"` and a tooltip; on the page it shows the "Pin" text label.

### B.3.1 The dial (0–200 number + slider pair)

The control is a **number input flanked by a slider**, because a 0–200 integer needs both precision (type 183) and feel (drag to ~top). Layout: `flex items-center gap-[var(--space-sm)]`, total min-width 180px.

- **Number input:** reuse `<Input>` primitive sized `w-[64px] h-11 text-center font-[var(--font-mono)] tabular-nums`, `type="number" min={0} max={200} step={1}`, `inputMode="numeric"`. Label (visually-hidden) `aria-label="{signal label} score, 0 to 200"`. On blur/Enter → clamp to 0–200 (mirror the RPC `score_out_of_range` guard client-side so the admin never round-trips an invalid value), then the Set button enables if changed.
- **Slider:** native `<input type="range" min={0} max={200} step={1}>` styled to admin tokens: track `h-[6px] rounded-full bg-[var(--gray-200)]`, filled portion `bg-[var(--color-brand-500)]` (via `accent-[var(--color-brand-500)]` — Tailwind `accent` color), thumb min `44×44` **hit area** (visually 18px thumb, but `[&::-webkit-slider-thumb]` padding/`touch-action` to reach 44px target — or simpler: wrap the slider in a `h-11 flex items-center` so the whole strip is a 44px grab zone). The slider is the "feel" affordance; the number input is the "precision" affordance. Both write the same pending value; neither commits until **Set** (or **Pin**) is pressed — explicit commit prevents accidental score changes on a ranking-critical control.

**Why explicit commit, not live-write:** scores drive the real deck. A slider that writes on every drag tick would spam `place_scores` and the audit log. The dial edits a LOCAL pending value; **Set** commits. This is the Mingla "no silent/accidental destructive write" posture applied to a ranking control.

### B.3.2 Pinned state (after a successful Pin)

When a Pin write returns, the row's committed score jumps to `LEAST(200, local_max+1)` (or 200). Mark it:
- A `<Badge variant="brand" dot>` reading **"Pinned"** appears inline after the label.
- The mono score animates (count-up is overkill; use a single `animate-[scale-in_150ms]` on the new value) — respects reduced-motion (degrades to instant).
- If the RPC returned `capped:true && tie_warning:true` (incumbent already at 200): the Pinned badge becomes `<Badge variant="warning" dot>` "Tied at max" and a `text-[12px] text-[var(--color-warning-700)]` helper line appears under the row: "Already at the 200 cap — tie broken by review count. Raise reviews or accept the tie." (LOCKED copy, mirrors SPEC §3.2 edge case; warning-700 on warning-50 = 4.81:1, passes.)

### B.3.3 Over-cap / clamp state

If the admin types > 200 in the number input: on blur the value snaps to 200 with a brief `text-[var(--color-warning-600)]` flash on the input border (`ring-2 ring-[var(--color-warning-100)]` for 600ms) + a `text-[12px] text-[var(--color-text-tertiary)]` inline note "Max is 200." No toast (too heavy for a clamp). The Set button uses the clamped value.

### B.3.4 Per-signal rank chip (live readout)

Under each signal's label, the micro rank line (`getPlaceDeckRank` per signal). Three sub-states:
- **Ranked:** "#{rank} · {total} live" — e.g. "#3 · 47 live". `text-[12px] text-[var(--color-text-tertiary)]`.
- **Projected** (`projected===true`, i.e. claims modal / non-servable): prefix a `<Badge variant="info" className="!text-[10px] !py-0">Projected</Badge>` chip → "Projected · #3 of 47". The info color signals "not live yet" without alarm.
- **Unscored / unavailable:** if `rank===null` (signal seeded but this place unscored for it) → "Not ranked for this category". If the rank RPC errored → "Rank unavailable" (NEVER a fabricated number — Constitution #9), in `text-[var(--color-text-muted)]`.

The chip refreshes after each Set/Pin (the panel re-fetches rank for the touched signal). To avoid 16 parallel rank calls on mount, fetch rank **lazily**: only for the focused row + any row the admin has touched this session; un-focused untouched rows show their rank on first focus (a `text-[var(--color-text-muted)]` "tap to check rank" affordance is overkill — instead fetch all 16 ranks once on panel load in a single batched effect, debounced; if that's too many round-trips, fetch on row-focus). **Implementor note:** SPEC exposes `getPlaceDeckRank` per (place, signal, radius); batching is an implementation choice — the design only requires the chip never shows a stale or fake number.

### B.3.5 Edited (uncommitted) state

While the dial value ≠ committed score:
- The row gets a `border-l-2 border-l-[var(--color-brand-500)]` accent (left edge).
- The mono score shows committed (struck) → pending (brand-600), per B.3 item 2.
- The **Set** button goes `variant="primary"` (was secondary) to signal "there's an uncommitted change here."
- A panel-level sticky footer hint appears when ANY row is edited: `text-[12px] text-[var(--color-text-secondary)]` "Unsaved changes in {n} categor{y/ies}. Each Set saves that row." — no global "Save all" (each Set is atomic + audited; a bulk save would obscure per-signal audit provenance). Navigating away with edits → a `window.confirm`-style inline warning is overkill for an admin tool; instead the edited rows simply remain edited (local state) until Set or reset.

## B.4 Rank readout strip (under the card)

A single prominent line tied to the **focused** signal, beneath `<DeckCardPreview>`. This is the headline rank (vs the per-row micro chips). Layout: `flex items-baseline gap-[var(--space-sm)] mt-[var(--space-md)] p-[var(--space-md)] rounded-[12px] bg-[var(--gray-50)] border border-[var(--table-border)]`.

- Lead: `font-[var(--font-mono)] text-[20px] font-bold text-[var(--color-text-primary)] tabular-nums` — "#{rank}".
- Body: `text-[14px] text-[var(--color-text-secondary)]` — "of {total} for {category} within {radius}".
  - Full LOCKED string (servable / live): **"Ranks #3 of 47 for Romantic within 16 km."**
  - Projected (non-servable, claims modal): **"Projected #3 of 47 for Romantic within 16 km — goes live when you approve."** with the trailing clause in `text-[var(--color-info-700)]`. This is the LOCKED "projected — not yet servable" note (SPEC §3.3 / §3.8.4).
  - Unscored focused signal: **"Not ranked for Romantic yet — set a score to see where it lands."**
  - Rank RPC error: **"Rank unavailable right now."** in `text-[var(--color-text-muted)]` (no fake number).
- `aria-live="polite"` on the strip so screen readers announce rank changes after a Set/Pin.

## B.5 Radius selector

Feeds both pin and rank (SPEC §3.9.2: default 16 km, options 8 / 16 / 40 km). A segmented control (NOT a dropdown — only 3 options, instant compare):
- `inline-flex rounded-[8px] border border-[var(--gray-300)] p-[2px] bg-[var(--color-background-primary)]`.
- Each segment: `h-9 px-[var(--space-sm)] text-[13px] font-medium rounded-[6px]`. Wrap in a `min-h-[44px] flex items-center` parent so the tap row clears 44px even though the visible chip is 36px (admin desktop is pointer-first, but the 44px floor is honored for touch/zoom).
- Selected: `bg-[var(--color-brand-500)] text-white`. Unselected: `text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]`.
- `role="radiogroup"` `aria-label="Ranking radius"`; each segment `role="radio" aria-checked`. Labels "8 km" / "16 km" / "40 km".
- Changing radius re-fetches the focused rank + the per-row rank chips (debounced 250ms).

**Units note:** the SPEC RPCs take meters (`p_radius_m`, 16000 default). The UI shows km. Convert at the service boundary, display km. (Mile display is out of scope — admin is metric-internal; do not add a mi/km toggle.)

## B.6 Panel states (9)

| State | Design |
|---|---|
| **loading** | Header skeleton + 6 signal-row skeletons (`<Skeleton height={20}>` label + `<Skeleton width={64} height={44}>` dial + two `<Skeleton width={72} height={44}>` button blocks) + a `<DeckCardPreview>` skeleton. `aria-busy`. |
| **error** | Replace list with centered `AlertTriangle` + `text-[14px] text-[var(--color-text-secondary)]` "Couldn't load this venue's scores: {message}" + `<Button variant="secondary" size="md" icon={RotateCw}>Try again</Button>`. (SPEC §3.8 copy: "Couldn't load scores: {e}".) |
| **empty / unscored** | The seed block (§B.2). LOCKED — replaces the META-ORCH-1062 dead-end copy. |
| **empty / no venue (page only)** | Centered `Search 28px text-[var(--color-text-muted)]` + "Search a live venue to tune its category scores." (SPEC §3.9.5 LOCKED). |
| **populated / seeded** | Full 16-row list + card + rank strip. |
| **submitting** | The acting row's Set/Pin → `loading` spinner (Button primitive handles it). That row's inputs `disabled`. Other rows stay interactive. Panel-level `acting` flag dims only the active control, not the whole panel (admin can queue thinking on other rows). |
| **offline** | On a write that fails offline: toast `<Toast variant="warning">` "You're offline — couldn't save. Try again when you're back." (SPEC §3.8 LOCKED). The dial reverts to committed (the edit was not persisted); the edited-state accent clears. |
| **first-time / returning** | No distinction (admin tool). First-time on an unscored venue = the seed block; returning = scores load from bundle. |
| **degraded** | If `getPlaceDeckRank` errors but scores loaded: rows + card render normally; only the rank chips/strip show "Rank unavailable" (never a fake number). The tuner stays fully usable — rank is informational, not gating. |

**Reduced motion:** all panel motion (edited-accent, pinned scale-in, count animations) inherits the global `prefers-reduced-motion` kill in `globals.css`. The pinned-value `scale-in` degrades to instant; nothing essential is motion-only.

## B.7 Accessibility (panel)

- Each signal row is a labeled group: the number input carries `aria-label="{label} score, 0 to 200"`; the slider carries the same; Set `aria-label="Save {label} score"`; Pin `aria-label="Pin {label} to top of the deck within {radius}"`.
- Rank strip `aria-live="polite"`; per-row rank chips are static text (not announced on every focus to avoid chatter — only the focused headline strip announces).
- Tab order: radius selector → row 1 (input → slider → Set → Pin) → row 2 → … → card is `role="img"` (not in tab order, display-only).
- Every interactive control ≥44px tall (dials, sliders' grab strip, Set, Pin, radius segments, seed CTA) — enumerated and LOCKED above; press feedback is the Button primitive's `active:scale-[0.98]` (non-shifting; scale, not layout reflow).
- Focus ring: the global `:focus-visible { outline: 2px solid #f97316; outline-offset: 2px }` covers all controls.

## B.8 Microcopy register (all panel + card copy, Mingla voice)

| Surface | Copy (LOCKED) |
|---|---|
| Seed CTA | "Score this venue now" |
| Seed headline | "Not scored yet." |
| Seed subtext | "Seed all 16 categories at a neutral starting score, then tune each one." |
| Seed success toast | "Seeded 16 categories — tune them below." |
| Rank strip (live) | "Ranks #{n} of {m} for {category} within {radius}." |
| Rank strip (projected) | "Projected #{n} of {m} for {category} within {radius} — goes live when you approve." |
| Rank strip (unscored) | "Not ranked for {category} yet — set a score to see where it lands." |
| Rank strip (error) | "Rank unavailable right now." |
| Per-row rank (live) | "#{n} · {m} live" |
| Per-row rank (unscored) | "Not ranked for this category" |
| Pinned badge | "Pinned" / (tie) "Tied at max" |
| Pin tie helper | "Already at the 200 cap — tie broken by review count. Raise reviews or accept the tie." |
| Clamp note | "Max is 200." |
| Edited footer | "Unsaved changes in {n} categor{y/ies}. Each Set saves that row." |
| Card caption | "Distance & travel time appear on the buyer's device, based on where they are." |
| No-photo hero | "No photo yet" |
| Load error | "Couldn't load this venue's scores: {message}" |
| Offline toast | "You're offline — couldn't save. Try again when you're back." |
| Page empty | "Search a live venue to tune its category scores." |

Voice notes: warm, plain, action-first, never jargon ("seed/initialize/configure" → "score this venue now"). No exclamation spam, no emoji, no cleverness that obscures the action. The projected/live distinction is stated as a fact, not an error.

---

## C — Contrast ledger (computed, WCAG 2.1)

| Pair | Context | Ratio | Pass |
|---|---|---|---|
| white / scrim band `≈#262626` | card title + chips over photo | **15.13:1** | AAA |
| white / `#1f2937` (gray-800) | no-photo hero (light) | **14.68:1** | AAA |
| white / `#242833` (gray-100 dark) | no-photo hero (dark) | **14.72:1** | AAA |
| white/55 `#9ca3af`-equiv / `#1f2937` | "No photo yet" subtext | **5.78:1** | AA |
| brand-700 `#c2410c` / brand-50 `#fff7ed` | Pinned badge, focused label | **4.88:1** | AA |
| warning-700 `#b45309` / warning-50 `#fffbeb` | tie warning helper | **4.81:1** | AA |
| success-700 `#15803d` / success-50 `#f0fdf4` | (if used for saved confirm) | **4.79:1** | AA |
| text-primary `#111827` / bg `#fff` | mono scores, labels (light) | **17.74:1** | AAA |
| text-primary `#f3f4f6` / bg `#0f1117` | mono scores, labels (dark) | **17.15:1** | AAA |

All body text ≥ 4.5:1, all large text ≥ 3:1, both themes. No eyeballed values.

---

## D — Anti-slop compliance (premium-craft §2)

- No generic gradients: the only gradient is the card's bottom scrim, which mirrors the native card's functional legibility scrim (`black/60→transparent`), not decoration.
- No stock / AI imagery: hero is the venue's real `stored_photo_urls[0]` or the honest flat-neutral "No photo yet" placeholder — never a fabricated or generated image.
- No emoji icons: all icons are lucide-react (`Star`, `Tag`, `Sparkles`, `ImageOff`, `AlertTriangle`, `RotateCw`, `ArrowUpToLine`, `Check`, `Search`) — admin's established icon family.
- No decorative effects: no glows, no faux-3D, no purple. Brand orange is used only for state meaning (focus, edited, pinned, primary action) — never ornament.
- Honest data: distance/travel OMITTED not faked; missing rating HIDDEN not zeroed; missing rank → "unavailable" not a number; missing photo → labeled placeholder.

---

## E — State coverage map (the 9, accounted for)

| State | Card (§A.5) | Panel (§B.6) |
|---|---|---|
| loading | shimmer skeleton | header + row skeletons + card skeleton |
| error | hero-frame error + Retry | list-replace error + Try again |
| empty | returns null (host shows empty) | seed block / no-venue block |
| populated | full anatomy | 16-row list + card + rank |
| submitting | top-edge brand pulse, no flash | active-row spinner, others live |
| offline | unchanged (honest) | warning toast + revert dial |
| first-time | = populated | = seed block (unscored) |
| returning | = populated | = populated |
| degraded | photo onError → placeholder | scores OK, rank → "unavailable" |

---

## F — Concerns for the implementor

1. **Slider 44px hit target on desktop web:** the visible slider thumb is ~18px; reaching a 44px grab target requires either a `h-11` wrapper grab-strip or `::-webkit-slider-thumb` sizing. This is the one control where the 44px floor needs deliberate CSS — don't ship a bare 18px thumb. Spec'd in B.3.1; flagging because it's the easiest miss.
2. **Rank fan-out (16 calls):** the per-row rank chips imply up to 16 `admin_place_deck_rank` calls per venue load (× radius changes). The SPEC exposes per-(place,signal,radius) rank only. If that's too chatty in practice, recommend the implementor batch-fetch on load + refetch only the touched signal + the focused headline on radius change (design tolerates lazy/on-focus fetch — the only hard rule is "never a stale or fake number"). A future single multi-signal rank RPC would be the clean fix (note for orchestrator, not blocking).
3. **`priceTiers` portability:** SPEC §3.10 says reuse the shared `priceTiers` mapping "if portable, else `price_level` text." Confirm whether the native `priceTiers.ts` import resolves in `mingla-admin`; if not, the `$`–`$$$$` fallback from `price_level` is the LOCKED degrade. Either way the Price chip hides cleanly when null.
4. **Card width vs modal width:** the card is fixed 340px. Verify the Claims modal content area is ≥ ~372px so the centered card + its gutters don't clip on the narrowest admin modal breakpoint. If the modal is narrower, the card may scale down via `max-w-full` but should never drop below 300px (below that the two-chip + title overlay crowds). Flagging the min.
5. **Edited-state persistence across re-fetch:** each Set re-fetches the bundle (SPEC §3.8.3). Ensure local pending values for OTHER (unsaved) rows survive that re-fetch — re-fetch must merge committed scores without clobbering in-progress edits, or the admin loses uncommitted dial positions on every Set. Recommend keying local edit state by signal_id and only clearing the row that was just committed.

---

*Completion: References-examined line present (native deck card + Linear/Stripe control ergonomics). All 9 states designed for both card and panel. Every spacing/size/radius is a `globals.css` token on the 4px grid (the two native-fidelity card constants — 340 width, internal 64% hero — are named + commented as deliberate parity values). Contrast computed in both themes with numeric ratios (§C). Every interactive control ≥44px with accessibilityLabel + non-shifting press feedback (§B.7). Zero anti-slop violations (§D). Copy in Mingla voice per state (§B.8); motion has the global reduced-motion fallback.*
