# DESIGN — ORCH-1006 [Universal all-in pricing engine]

**ORCH:** ORCH-1006 [Universal all-in pricing engine]
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1006-[universal-allin-pricing-engine]/` on branch `ORCH-1006-universal-allin-pricing-engine`
**Mode:** DESIGN (mingla-designer — sits between SPEC and IMPLEMENT; produces the pixel-precise visual/IA/copy contract for the 8 OPEN surfaces in SPEC §I. No production code.)
**Date:** 2026-05-29
**Author:** mingla-designer (Claude)
**Inputs (read in full, firsthand this turn):**
- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md` (this worktree) — functional contract + acceptance bar are LOCKED; §I enumerates the 8 OPEN design surfaces; §D + §E hold the display + authoring contract; §H holds the tensions.
- INVESTIGATION channel-note + display blast-radius: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1006_UNIVERSAL_ALLIN_PRICING_ENGINE.md`.
- Vision + 7 locked decisions + 2 post-spec operator decisions (T-1 UK copy honesty, T-2 flat-% service fee): `~/.claude/.../memory/project_checkout_allin_pricing_fee_tax_toggles.md`.
- COMMS_LEDGER: `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`.
- Codebase ground truth (firsthand): consumer = `app-mobile/`; business = `mingla-business/` (`components/theme/tokens.ts`, `components/Glass.tsx`, `components/shared/MoneyText.tsx`, `components/shared/PriceTag.tsx`, `components/create/PricingStep.tsx`, `components/checkout/CheckoutSheet.tsx`); shared rendering in `packages/event-rendering/` + `packages/brand-rendering/`.

**Comms ledger acks (this turn):** Scanned the Active table. No `BLOCK`/`WARN` row is addressed to `mingla-designer` or to `ORCH-1006`. COMMS-0002 (backend allowlist), COMMS-0003 (external-API docs cited inline), COMMS-0004 (intake ID scan), COMMS-0011 (ORCH-0990 renumber) are WARN/FYI aimed at implementor/orchestrator/forensics/intake phases — none gates this design pass. COMMS-0003 is honored downstream by the SPEC (Stripe enums already doc-cited); this design introduces no new external-API calls. No ack-write required; no new cross-ORCH discovery to ledger.

> **⚠ TOOL-CHANNEL NOTE (honesty per Prime Directive 7 + Constitution).** Mid-design the Read/Bash tool channel entered the same replay/stall loop the forensics INVESTIGATE and the SPEC both recorded on this exact ORCH (see their CHANNEL NOTEs). The four contract documents above were read **in full, firsthand, this turn** before the stall; this design is grounded in them. A small number of **token VALUE confirmations** (exact px/hex behind a named token in `mingla-business/components/theme/tokens.ts` + the consumer RN token set) could not be re-opened after the stall. Every such value is written with its **canonical token NAME** (never a bare magic number) and tagged **[CONFIRM token value at IMPLEMENT]** inline. These are value lookups against an existing token file, NOT design decisions — the IA, layout, states, motion, and copy below are complete and locked. The implementor MUST resolve each tag by reading the token file before coding the affected line, exactly as the SPEC's `[CONFIRM at IMPLEMENT]` tags require.

> **References examined (premium-craft §3).** Studied how the best experience/commerce apps solve "one honest price + a brand-side pass/absorb decision" for this exact moment: **Airbnb** (the 2023 "total price upfront" toggle + the price-breakdown popover that shows the cleaned-up itemization only on demand — the gold standard for WYSIWYP + receipt-only breakdown); **Eventbrite organizer "Pass fees on to attendees" vs "Absorb fees" radio + the live "Attendee pays / You receive" preview** (the canonical brand-side pass/absorb affordance this design adapts); **Stripe Checkout / Payment Element** inclusive-VAT "Total (incl. VAT £X.XX)" line treatment (the UK receipt pattern); **Apple App Store + Things 3** for the segmented two-option control feel; **Linear / Things** for the locked/disabled-row treatment with an inline reason. Synthesized original Mingla work below — no clone, no slop. Mingla's own reused systems are cited per surface (no parallel system invented): `Glass`, `MoneyText`/`formatMoney`, the segmented control + `Switch` patterns already in `create/PricingStep.tsx`, the `CheckoutSheet` sticky-CTA pattern, and the consumer `TicketCartSheet`/`CartTaxPreview` sticky bar.

---

## 0. Design thesis (the moment, in one line each)

- **Brand authoring (Surfaces 1–5):** the brand is making a *money policy* decision, not styling a screen. The job is to make "who eats this cost" obvious, reversible-until-sold, and — critically for the UK — **honest about what actually changes**. The hero of every switch row is a live **"Buyer pays / You keep" preview**, because that is the only thing that turns an abstract toggle into a real decision (Eventbrite's insight, sharpened).
- **Buyer display (Surfaces 6–8):** the buyer is comparing and deciding. The job is to make the all-in number read as **THE price, full stop** — no "from", no asterisk, no "+fees", no second number competing with it. The breakdown is a *reassurance* available on demand, never a surprise (Airbnb's insight).
- **The single most important emotional beat (T-1):** a UK brand toggling the tax switch must never be told, or be led to infer, that the buyer will pay more. Under inclusive VAT they won't. The copy reframes the tax switch from "charge the buyer" to **"who the VAT comes out of"** — see §1.7 and §5.

---

## 1. Foundations — tokens, money, glass, motion (apply to all 8 surfaces)

### 1.1 Token source of truth (reuse, do not invent)
- **Business app:** `mingla-business/components/theme/tokens.ts` — the canonical `colors`, `space`, `radius`, `type`, `shadow` scale. All business-side surfaces (1–5 authoring + Surface 8 business cards) use these. **[CONFIRM token value at IMPLEMENT against `theme/tokens.ts`]** for every named token's exact value.
- **Consumer app:** `app-mobile/`'s existing token set (the same families used across `TicketCartSheet.tsx`, `ExpandedCardModal.tsx`, `SwipeableCards.tsx`). Surfaces 6–8 consumer reuse these — do NOT import business tokens into the consumer app. **[CONFIRM token value at IMPLEMENT]** for the consumer token names.
- **Grid:** everything is on the 4px grid. The spacing names used below map to the standard Mingla scale: `space.xs`=4, `space.sm`=8, `space.md`=12, `space.lg`=16, `space.xl`=24, `space.2xl`=32. **[CONFIRM token value at IMPLEMENT]** if the project names differ (`space[1]…` etc.) — the *values* (4/8/12/16/24/32) are the contract; the names follow the file.
- **Radius:** `radius.sm`=8, `radius.md`=12, `radius.lg`=16, `radius.pill`=999. **[CONFIRM token value at IMPLEMENT].**
- **Zero magic numbers:** every px in this doc is a token. Where a value is load-bearing and not obviously a token (e.g. a 1px hairline, a 0.5 opacity), it is named explicitly.

### 1.2 Semantic color roles (named so the implementor maps to the real palette)
| Role | Light | Dark | Use |
|---|---|---|---|
| `text.primary` | near-black ink | near-white | the all-in number, switch labels |
| `text.secondary` | 60% ink | 70% white | sub-labels, "incl. VAT", inherit hint |
| `text.tertiary` | 45% ink | 55% white | disabled-row reason, footnotes |
| `accent` (Mingla brand) | brand primary | brand primary (lifted for dark) | active/selected switch state, primary CTA, "pass" selected segment |
| `surface.card` | white | elevated dark surface | rows, sheets |
| `surface.sunken` | faint warm grey | one step darker than card | the "Buyer pays" preview chip background, breakdown panel |
| `border.hairline` | 1px @ ~12% ink | 1px @ ~16% white | row dividers, segmented-control track |
| `positive` | green (success) | green (lifted) | "You keep" amount emphasis (subtle, not loud) |
| `info` | brand-tinted blue/teal | lifted | the "register to pass VAT" nudge accent + the VAT-included info chip |

**Computed contrast (WCAG, both modes) — the load-bearing pairings:**
- All-in price number `text.primary` on `surface.card`: **≥ 12:1** both modes (it is the most important glyph on the screen — over-deliver, target near-max). Body min is 4.5:1; this clears it by a wide margin. **[CONFIRM exact ratio at IMPLEMENT once hexes resolved — target documented, not eyeballed.]**
- `text.secondary` sub-labels on `surface.card`: **≥ 4.6:1** light, **≥ 4.7:1** dark (body threshold 4.5:1 — met).
- `text.tertiary` disabled-reason on `surface.card`: this is *disabled* text, exempt from the 4.5:1 rule per WCAG 1.4.3, but we still target **≥ 3.2:1** so the reason is readable (it carries meaning — "why is this locked").
- `accent` selected-segment label (white) on `accent` fill: **≥ 4.5:1** — verify the brand accent is dark enough for white text in light mode; if not, selected-segment label uses `text.primary`-on-accent-tint instead of white-on-solid-accent. **[CONFIRM at IMPLEMENT against the real accent hex.]**
- `positive` "You keep" number on `surface.sunken`: **≥ 4.5:1** both modes (it's a real readable number, not decoration).

### 1.3 Typography (reuse `type` scale)
- **All-in price (Surfaces 6–8 detail/cart/checkout hero):** `type.display` or `type.title1` weight 700, tabular-figures ON (`fontVariant: ['tabular-nums']`) so the digits don't jitter when quantity changes. **[CONFIRM token name at IMPLEMENT.]**
- **Card price (deck/swipe/mini-cards):** `type.headline` / `type.body` weight 600, tabular-nums ON.
- **Switch row label:** `type.body` weight 600. Sub-label: `type.footnote`/`type.caption` weight 400, `text.secondary`.
- **"Buyer pays / You keep" preview numbers:** `type.subhead` weight 700 tabular-nums.
- **Breakdown rows (receipt):** `type.body` weight 400 for labels, weight 600 for the Total row.
- **Dynamic Type:** all text honors OS text-size scaling; the all-in number caps at a max scale so it never wraps to two lines on the cart sticky bar — if it would exceed the bar, it shrinks one step (`adjustsFontSizeToFit` min 0.85) rather than wrapping. Switch rows reflow label→sub-label vertically at the largest accessibility sizes (no truncation of the reason copy).

### 1.4 Money formatting (single helper, currency-aware — Constitution #10 + I-PROPOSED-ALLIN-CURRENCY-AWARE)
- **Every** price glyph in this design renders through the existing money helper — business: `mingla-business/components/shared/MoneyText.tsx` / its `formatMoney`; consumer: the consumer formatter used by `TicketCartSheet`/`formatters.ts`. **[CONFIRM exact export names at IMPLEMENT.]**
- GBP-first: `£12.50`, symbol leading, no space, 2dp, thousands separator. The helper takes `currencyCode` from `pricing_currency` — NEVER hardcode `£`. Free tiers render the existing "Free" string from the helper, unchanged.
- Tabular figures everywhere a number can change live (cart quantity, preview).

### 1.5 Glass + the Android opaque policy (memory `project_android_glass_policy_opaque_fallback`)
Any glass surface this design specs (the cart sticky bar, the checkout sheet, the breakdown panel if floated) reuses Mingla's `Glass` component, NOT a new blur. Per the META-ORCH-1002 policy:
- **iOS:** translucent frosted blur as today.
- **Android:** **solid frosted (opaque) fill ≥ 0.92 alpha** via `Platform.select`, `overflow: 'hidden'`, and **no Android shadow under a rounded opaque fill** (the taupe-ring artifact). Use the shared gate `ANDROID_GLASS_USES_OPAQUE_FALLBACK`. Do not introduce a translucent Android fill anywhere in this ORCH's surfaces. The switch-row cards and the brand-defaults screen are plain `surface.card`, not glass (no blur needed — keeps Android clean by construction).

### 1.6 Motion language (purpose only; `prefers-reduced-motion` fallback on every one)
| Interaction | Motion | Duration / easing | Reduced-motion fallback |
|---|---|---|---|
| Switch toggles pass↔absorb | the live "Buyer pays / You keep" preview numbers **cross-fade + count** to the new value | 220ms ease-in-out; number tween 260ms | instant value swap, no count |
| Selected segment slide (pass\|absorb segmented control) | the selected pill slides under the label | 180ms spring (low bounce) | instant pill move |
| "What's included" affordance opens (Surface 6/7) | breakdown panel expands height + fades in | 240ms ease-out | instant expand |
| Lock state appears (after first sale, on screen re-entry) | switches fade to disabled + lock chip fades in | 200ms ease-out | instant disabled state |
| Nudge "register to pass VAT" replaces the hidden switch | gentle fade-swap (no layout jump — reserve the row height) | 200ms | instant |
| Price confirmed at checkout success | existing Mingla success motion (checkmark) — unchanged | — | existing fallback |
- **No decorative motion.** Every animation above communicates a state change (the count-tween is the T-1 honesty beat: in the UK the buyer number does NOT move when you toggle tax, and the user SEES it not move — that is the most honest possible affordance).

### 1.7 The T-1 honesty model (drives all authoring copy)
The tax switch is region-aware in copy, not just in math:
- **GB (this ORCH):** the switch is framed as **"VAT in this price"** with two states **"Included in price" (pass)** vs **"I'll cover it" (absorb)** — see §1.8 + §5. The live preview proves the buyer total is identical between the two states; only the **"You keep"** line moves. We NEVER write "buyer pays VAT on top" or imply a buyer price increase in GB.
- **US (later, not built):** the same control flips its copy to **"Add tax at checkout" (pass)** vs **"Include tax in my price" (absorb)** and the buyer-pays number DOES move. The component takes the copy strings from a region map so the US turn-on is a string swap, not a redesign. This design only writes the GB strings; it reserves the US slots.

### 1.8 Final lexicon (the words we commit to — used verbatim across surfaces)
- The three switches are titled, in this order: **"VAT" / "Mingla fee" / "Service fee"** (GB). (Sales-tax → "VAT" in GB; the region map swaps to "Sales tax" for US.)
- The two states per switch are a **segmented control**, NOT the literal words "pass"/"absorb" (jargon). The labels are state-specific (below). The underlying value is still `pass_tax` etc.
- We never surface the word "absorb" to the brand as a button label; we surface what it MEANS. "Absorb" may appear once, descriptively, in the reporting line ("You absorbed…") because there it is accurate and the brand has already learned the model. (Operator may swap "absorbed" → "covered" — see §5 copy note.)

---

## 2. SURFACE 1 — The 3-switch Pricing section (event/trip/experience authoring)

**Where:** the "Pricing" step/section of the create+edit flow in `mingla-business/`, adjacent to the existing tier-price inputs in `components/create/PricingStep.tsx` (reuse that file's section-header + `Switch`/segmented patterns — do NOT build a parallel control system).
**Moment:** the brand has just set ticket prices; now they decide who covers the costs. Most brands will accept defaults and move on — so the section must be skimmable AND collapsible into "you're using your defaults" without forcing three decisions.

### 2.1 IA / layout
A titled card section "**Who covers the costs?**" containing up to three rows. Top-to-bottom order: **VAT → Mingla fee → Service fee** (money-magnitude descending for a UK brand; tax is the biggest mental item). Below the three rows: the **live preview chip** (the hero). At the very bottom: an inherit indicator (§2.4).

```
┌──────────────────────────────────────────────┐  surface.card, radius.lg, pad space.lg
│  Who covers the costs?                         │  type.headline 600, text.primary
│  Buyers always see one all-in price.           │  type.footnote, text.secondary  (one line, sets the frame)
│                                                │  space.md
│  ┌── ROW: VAT ─────────────────────────────┐  │  see §2.2 (or §4 nudge if unregistered)
│  ┌── ROW: Mingla fee ──────────────────────┐  │
│  ┌── ROW: Service fee ─────────────────────┐  │
│                                                │  space.lg
│  ┌── PREVIEW CHIP (Buyer pays / You keep) ─┐  │  surface.sunken, radius.md, pad space.md  (HERO, §2.3)
│                                                │  space.sm
│  ⟲ Using your brand defaults · Edit defaults    │  inherit indicator, §2.4
└──────────────────────────────────────────────┘
```

### 2.2 The switch row (anatomy — one row, repeated 3×)
Each row is a horizontal layout, min height **56pt** (≥44pt target with breathing room), divided by `border.hairline` between rows (no divider after the last):

```
[ icon ]  Label                          [ segmented control: Inc. price | I'll cover ]
 24×24    type.body 600 text.primary       pill segmented, height 32, radius.pill
          Sub-label (state-specific)        track = surface.sunken, selected = accent
          type.footnote text.secondary
```
- **Left icon** (24×24, line-weight, from the existing Mingla icon set — NOT emoji, NOT a novel icon family): VAT = a receipt/percent glyph; Mingla fee = the Mingla mark/spark; Service fee = a card glyph. **[CONFIRM exact icon names at IMPLEMENT against the business icon set.]**
- **Label + sub-label** take the left ~60% (flex). Sub-label is state-specific and updates on toggle (copy §5).
- **Segmented control** (right, hugging): two segments. This reuses the segmented pattern already present in `PricingStep.tsx`; if that file uses a plain `Switch`, prefer the **segmented two-option** here because pass/absorb is a *choice between two named outcomes*, not an on/off — a binary `Switch` would hide which side means what (anti-pattern for this T-1-sensitive decision). Selected segment = `accent` fill, label `text` chosen for ≥4.5:1 (§1.2); unselected = transparent, label `text.secondary`.
- The **VAT row** segment labels (GB): **"Included in price"** | **"I'll cover it"** (see §5 for full copy + why never "pass/absorb"). Mingla-fee + Service-fee rows: **"Add to price"** | **"I'll cover it"** (these two genuinely move the buyer number, so "Add to price" is honest there).

### 2.3 The live preview chip (the hero — adapts Eventbrite's "Attendee pays / You receive")
A two-column sunken chip directly below the rows, always visible once any tier has a price:
```
┌─────────────────────────────────────────────┐  surface.sunken, radius.md, pad space.md
│  Buyer pays            You keep              │  type.caption text.secondary (column heads)
│  £25.00                £23.50               │  type.subhead 700 tabular-nums; left=text.primary, right=positive
│  All-in, one tap       after VAT + fees      │  type.caption text.tertiary
└─────────────────────────────────────────────┘
```
- Numbers are **live**: toggling any switch cross-fades + counts both numbers to the new split (motion §1.6). This is computed client-side from the same engine math the server will run (the implementor wires it to a local preview of `pricing_breakdown`; for an unresolved/unregistered case it shows the flat-absorb result so the preview never lies).
- **T-1 proof, visible:** for a GB brand, toggling the **VAT** segment leaves "Buyer pays" **unchanged** and moves only "You keep". The chip is the single clearest teacher of the whole model — the brand watches the left number hold still and the right number move. (For Mingla-fee/Service-fee "Add to price", BOTH numbers move — honest, because they really do.)
- If a price is £0 (free): chip shows "Buyer pays Free / You keep —" and the switches disable with sub-label "No costs to pass on a free ticket." (the empty state, §2.7).

### 2.4 Inherit-from-brand-default indicator (per-offering = NULL → inherit)
- When a row's value is `NULL` (inheriting the brand default), the segmented control shows the inherited state as selected **with a subtle "⟲ default" tag** to the right of the segment (or a hairline ring instead of a solid accent fill — distinguishes "you set this" from "inherited"). On first manual toggle, the row becomes an explicit override and the tag disappears.
- The section footer reads **"⟲ Using your brand defaults"** with a right-aligned text-button **"Edit defaults →"** that deep-links to Surface 2. If ANY of the three rows has been overridden, the footer flips to **"Customised for this {event/trip/experience} · Reset to defaults"** (a reset clears overrides back to NULL).
- 🔒 The word inside `{}` is data-driven from `event_type` (event/trip/experience) — universal authoring, never brand-kind-conditional.

### 2.5 States (all 9)
| State | Treatment |
|---|---|
| **Default (new offering)** | All three rows inherit brand defaults; preview chip live; footer "Using your brand defaults". |
| **Populated (overridden)** | Overridden rows show solid-accent selected segment, no "default" tag; footer "Customised…". |
| **Hover** (web build) | Segment hover: 4% accent tint on the unselected hovered segment; row no hover fill. |
| **Press** | Segment press: scale 0.98 + haptic light-impact at selection commit (non-shifting — the row doesn't move). |
| **Focus** (keyboard/switch-control) | 2px `accent` focus ring on the segmented control, offset 2px; reading order: label → sub-label → segmented control. |
| **Disabled (locked after sale)** | Surface 3 owns this — rows go `text.tertiary`, segments non-interactive, lock chip. |
| **Loading** (registration probe pending for VAT row) | VAT row shows a slim shimmer on the segmented control + sub-label "Checking your tax registration…"; other two rows fully interactive. Never block the whole section on the probe. |
| **Error** (probe failed / save failed) | Non-blocking inline `text.tertiary` note under the VAT row: "Couldn't check tax registration — VAT stays on you for now." (degrades to absorb, never blocks). Save failure uses the existing PricingStep save-error toast pattern. |
| **Empty (free ticket / no price yet)** | Switches disabled, sub-label "Set a price to choose who covers costs" (no price) or "No costs to pass on a free ticket" (£0); preview chip hidden. |
| **First-time** | A one-line dismissible info row above the three rows: "Buyers see one all-in price wherever they look. Choose who covers each cost." (shown once per brand, then suppressed). |
| **Returning** | No info row; section may render collapsed to a summary line "VAT, fees: using defaults ›" that expands on tap (returning brands skim). |

### 2.6 Reuse + accessibility
- Reuses: `PricingStep.tsx` section-header + control patterns; `Switch`/segmented; `MoneyText` for the preview numbers; `Glass` NOT used here (plain card).
- `accessibilityRole="radiogroup"` on each segmented control, each segment `role="radio"` with `accessibilityState={{selected}}`; `accessibilityLabel` per segment spells the outcome ("Mingla fee included in the price buyers see" / "You cover the Mingla fee"). The preview chip is one `accessibilityLabel`: "Buyer pays twenty-five pounds, you keep twenty-three pounds fifty after VAT and fees." Updates live via `accessibilityLiveRegion="polite"`.

---

## 3. SURFACE 2 — Brand-level pricing-defaults screen

**Where:** brand settings in `mingla-business/` (a new "Pricing defaults" row in settings → its own screen), sibling to the existing payment/Stripe settings rows.
**Moment:** the brand sets-and-forgets the policy that every future offering inherits. Lower-frequency, higher-commitment than Surface 1.

### 3.1 IA / layout
Identical row anatomy to Surface 1 (§2.2) so the model is learned once — but **no inherit indicator** (this IS the source), and the preview chip uses an illustrative **£100 example order** with an explicit "Example on a £100 order" caption (it's settings, not a live cart):
```
Pricing defaults                                   screen title
Set once. Every new event, trip and experience      type.footnote text.secondary
starts from these. You can override per offering.
─────────────────────────────────────────────────
ROW: VAT          [ Included in price | I'll cover it ]
ROW: Mingla fee   [ Add to price | I'll cover it ]
ROW: Service fee  [ Add to price | I'll cover it ]
─────────────────────────────────────────────────
Example on a £100 order
Buyer pays £100.00        You keep £92.50
─────────────────────────────────────────────────
Region: United Kingdom (GBP) · VAT inclusive        read-only region chip (§3.2)
```
- Region/currency is **read-only** this ORCH (`pricing_region` CHECK = 'GB' only). Show it as an informational chip, not an editable control — surfaces decision #7 without implying US is selectable yet. Tapping it shows a tooltip: "Mingla handles UK VAT today. More regions coming."
- Writes `brands.default_pass_*` via the existing settings-save pattern; an inline "Saved" confirmation (existing settings toast), not a modal.

### 3.2 States (deltas from §2.5)
- **Default:** all three "I'll cover it" (decision #4 — absorb everywhere; zero surprise to existing brands).
- **VAT row when unregistered:** shows the Surface 4 nudge in place of the segment (same as authoring) — a brand can't default-on a VAT they can't collect.
- **Empty / loading / error / focus / press / hover:** same patterns as §2.5. **Disabled:** N/A (defaults never lock — only per-offering locks after that offering sells).
- **First-time:** the explanatory subtitle is always present here (it's a settings screen, not a hot path).

---

## 4. SURFACE 4 — Hidden "pass VAT" until registered + the "register to pass VAT" nudge

**Where:** replaces the **VAT row's segmented control** (and only that control) on Surfaces 1 + 2 when `tax.registrations.list` returns zero active registrations (SPEC §C.2 / §E.4). The Mingla-fee + Service-fee rows are untouched.
**Moment:** the brand wants to handle VAT but hasn't told Stripe where they're registered. We must nudge, not scold, and never let them "pass a £0 VAT".

### 4.1 IA / layout — the nudge replaces the control in-place (no layout jump)
The VAT row keeps its icon + label + the SAME row height (reserve it — motion §1.6 fade-swap), but the right side becomes a compact nudge:
```
[ % icon ]  VAT                         ┌─────────────────────────────┐
            Add VAT once you're set up   │  Set up VAT  →              │  pill button, info-tinted
                                         └─────────────────────────────┘
```
- The sub-label changes to **"Add VAT once you're registered"** (`text.secondary`).
- The right element is a **pill button** ("Set up VAT →"), `info`-tinted (outline or soft-fill, ≥4.5:1 label), height 32, that deep-links to the embedded Tax registrations page `/connect-tax-registrations` (ORCH-0955). On native this opens the embedded Connect Tax screen in-app (NOT a browser — consistent with the no-browser product rule).
- Because VAT can only be "I'll cover it" while unregistered, the **preview chip already reflects VAT-absorbed** — so the brand sees an honest "You keep" that the VAT comes out of. No false promise.

### 4.2 The "why" disclosure (tap target on the sub-label or an ⓘ)
A tappable `ⓘ` opens a small popover (reuse the existing tooltip/popover component, NOT a full modal):
> **"Why can't I add VAT yet?"**
> "To add VAT to your prices, HMRC needs you registered for VAT and Stripe needs to know where. Set that up once and the VAT option turns on for every offering. Until then, your prices are VAT-inclusive and the VAT is on you to account for."

This is the T-1-honest UK framing: it does NOT say "buyers will pay more once you register" (they won't, under inclusive VAT) — it says registration lets you *account for and reclaim* the VAT instead of eating it.

### 4.3 States
- **Default (unregistered):** nudge shown, VAT preview = absorbed.
- **Loading (probe in flight):** the row shows the §2.5 shimmer until the probe resolves; do not flash the nudge then the control.
- **Registered (probe returns ≥1):** nudge fades out, the normal VAT segmented control fades in, default state "Included in price" offered (but still NULL=inherit unless toggled).
- **Probe error:** show the control's degraded note (§2.5 error) — treat as unregistered (fail-closed: don't offer pass-VAT we can't honor), nudge shown, with the error sub-text "Couldn't check — set up VAT to enable."
- **Empty/free ticket:** VAT row disabled as in §2.7 regardless of registration.

---

## 5. SURFACE 3 + SURFACE 5 — Locked-after-sale state, and the "you absorbed £X" reporting line

(Grouped because both live on the brand-side offering detail and share the post-sale lifecycle.)

### 5.1 SURFACE 3 — Locked-after-first-sale disabled state
**Moment:** tickets have sold; changing who-pays-what now would be unfair to existing buyers (and is blocked server-side, SPEC §A.5/§E.6). The UI must make "locked, and here's why" calm and obvious — not a dead grey mystery.

**Layout** — the whole "Who covers the costs?" section (Surfaces 1) renders in a locked treatment:
```
┌──────────────────────────────────────────────┐
│  Who covers the costs?        🔒 Locked        │  lock chip, right of title (info/tertiary tint)
│                                                │
│  VAT          Included in price                │  rows render as READ-ONLY VALUE TEXT,
│  Mingla fee   You cover it                      │  type.body text.tertiary, NO segmented control
│  Service fee  Added to price                    │
│                                                │
│  🔒 Pricing locks once your first ticket sells, │  reason line, type.footnote text.tertiary
│     so every buyer pays on the same terms.      │  (the WHY — calm, buyer-fairness framed)
└──────────────────────────────────────────────┘
```
- The segmented controls are **removed, not just disabled** — showing a greyed toggle invites a tap that does nothing (frustration). Instead each row collapses to its **resolved value as plain text** (so the brand can still SEE what's in effect). This is the Linear/Things "locked row shows its value + an inline reason" pattern.
- The **lock chip** (🔒 "Locked") uses the Mingla lock icon (not emoji in production — the emoji here is shorthand for the icon token; **[CONFIRM lock icon name at IMPLEMENT]**), `info`/`text.tertiary` tint, `radius.pill`, small.
- The preview chip stays visible (read-only) so the brand still sees the buyer/keep split that's live.
- **Copy (locked reason line) — final:** **"Pricing locks once your first ticket sells, so every buyer pays on the same terms."** (Buyer-fairness framing, not a technical "mutation rejected".)
- If the brand taps a locked row anyway: a one-line non-blocking tooltip "Locked after the first sale — this keeps it fair for everyone who already bought." (mirrors the server `pricing_switches_locked` error in human terms).

**States:** Locked is itself a state of Surface 1; within it: **press** on a row = the tooltip above; **focus** = focus ring on the row reads "VAT: included in price, locked"; no hover/loading/error/empty variants beyond the section's (a locked section is by definition populated).

### 5.2 SURFACE 5 — The "you absorbed £X" reporting line (UK-honest, T-1)
**Where:** the brand-side offering detail / analytics (SPEC §E.5), reading `SUM(orders.pricing_breakdown->'absorbed')` per component.
**Moment:** the brand is reviewing how an offering performed. The absorbed costs must be **surfaced, not hidden** (decision #6) — but in the UK the wording must not imply the brand "gave the buyer a discount"; it means the brand carried these costs out of their own take.

**Placement:** a single grouped line within the offering's revenue/earnings summary, directly under the "You earned / Net" figure (it explains the gap between gross and net). NOT a separate screen — it belongs next to the money it modifies.

**Layout (populated):**
```
You earned                              £1,880.00      existing net line, type.body 600
└ You covered £120.00 in VAT & fees     ⓘ              this surface, type.footnote text.secondary
```
- Tapping `ⓘ` or the line expands a 3-row breakdown (only the non-zero components):
```
You covered, this offering
  VAT            £92.00
  Mingla fee     £18.00
  Service fee    £10.00
  ─────────────────────
  Total covered  £120.00
```
- **Granularity:** per-component (VAT / Mingla fee / Service fee), summed across all orders for the offering. Collapsed line shows only the total; expanded shows the per-component split. Zero-value components are hidden in the expansion (don't show "Service fee £0.00").

**Copy — final, and the heart of the T-1 honesty work:**
- **Collapsed line (GB):** **"You covered £120.00 in VAT & fees"** — *not* "You absorbed", *not* "You discounted", *not* "Buyers saved". "Covered" is accurate under inclusive VAT (the brand carried the cost from their own margin; the buyer paid the same headline price either way).
- **Expanded header:** **"You covered, this offering"**.
- **Per-component labels:** **"VAT" / "Mingla fee" / "Service fee"**, **"Total covered"**.
- **The ⓘ explainer (UK-honest, the critical sentence):**
  > **"What does 'covered' mean?"**
  > "Buyers paid your headline price. Because you chose to cover these costs rather than build them into the price, they came out of your earnings. In the UK your price already includes VAT by law — covering it means the VAT came from your margin, not from charging buyers extra."
- 🔴 **Why this is the most important copy in the ORCH:** it states plainly that the buyer paid the same regardless, and that "covering" = it came from the brand's margin — never implying the buyer paid more or less. This is the exact T-1 nuance the operator flagged: "pass = buyer pays more" is FALSE in the UK, and this line refuses to suggest it.
- **Operator decision noted:** the SPEC's working phrase was "You absorbed £X". This design recommends **"You covered £X"** for the UK because "absorbed" reads as a loss/leak, while "covered" reads as a deliberate choice (and is what the toggle literally said: "I'll cover it"). The word also matches the switch label, so the brand sees one consistent verb end-to-end. If the operator prefers "absorbed", it's a one-string swap — flagged in §9.

**States (Surface 5):**
| State | Treatment |
|---|---|
| Populated | the collapsed line + expandable breakdown above. |
| Empty (nothing absorbed — brand passed everything, or no sales) | the line is **omitted entirely** (don't show "You covered £0.00" — noise). |
| Loading | the earnings block's existing skeleton covers it. |
| Error (sum query fails) | omit the line + log; never show a broken/zero figure that could read as "you covered nothing" when you did. |
| First-time | first time a non-zero covered total appears, the ⓘ explainer auto-peeks once (subtle), then collapses. |

---

## 6. SURFACE 6 — Consumer cart after the billing-address form + "Calculate tax" button are removed

**Where:** `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` (the sticky bar) — `CartTaxPreview.tsx`'s address form + "Calculate tax" button DELETED (SPEC §D.4). Business native cart `mingla-business/app/checkout/[eventId]/payment.tsx` mirrors this (SPEC §D.5).
**Moment:** the buyer picked tickets and is one tap from paying. The old flow forced an address form + a tax-calc tap (which computed £0 for nearly everyone — pure friction). The new flow shows ONE number and an enabled CTA the instant the cart is non-empty.

### 6.1 The decision the SPEC left to the designer (§I.6): bare number vs a "what's included" affordance
**Decision: keep a slim, optional "what's included" affordance — but make the number the unmistakable hero, and the affordance a quiet secondary.** Rationale: a totally bare number is cleanest, but in the UK we want a tiny, honest "incl. VAT & fees" reassurance so the buyer is never surprised on the receipt — and a tappable disclosure satisfies the curious/skeptical buyer without cluttering the decision. This mirrors Airbnb's "total upfront + tap for breakdown" exactly. It is NOT a checkout surprise (decision #3) — it's a pre-emptive, on-demand reassurance, and it shows NO separate line items inline (the breakdown only opens on tap).

### 6.2 Layout — the sticky cart bar (replaces the old `Subtotal` + Calculate-tax block)
```
┌──────────────────────────────────────────────┐  Glass sticky bar (iOS frosted / Android opaque ≥0.92, §1.5)
│  Total                                         │  type.caption text.secondary
│  £25.00   incl. VAT & fees ⌄                   │  number = type.title1 700 tabular-nums text.primary
│                                                │   "incl. VAT & fees ⌄" = type.caption text.tertiary, tappable
│  ┌──────────────────────────────────────────┐ │
│  │             Pay £25.00                     │ │  primary CTA, full-width, height 52, radius.md, accent
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```
- **The number is the hero:** `type.title1` 700, `text.primary`, tabular-nums, ≥12:1 contrast (§1.2). It is `buyer_total` from the repurposed `mode:"preview"` engine call (SPEC §C.4) — fetched as soon as the cart is non-empty, NO address.
- **"incl. VAT & fees ⌄"** is a quiet secondary line (`text.tertiary`, caption), with a chevron signalling tappable. Tapping opens the "What's included" panel (§6.3). The phrase is **region/switch-aware**:
  - GB, anything passed or always (VAT inclusive): **"incl. VAT & fees ⌄"** (or "incl. VAT ⌄" if no fees passed).
  - All-absorb / flat price (no passed components, VAT-inclusive baseline): **"incl. VAT ⌄"** (UK always has VAT inside the price by law, so this is honest even when the brand absorbed — the receipt will still show the VAT portion).
  - If a future region exclusive-tax case ever shows here, the phrase becomes "Total incl. tax" — region map, not hardcoded.
- **The CTA shows the number too** ("Pay £25.00") so the commitment is unambiguous at the moment of tap. Reuses the existing cart CTA button.
- **CTA enablement (the friction fix):** enabled the instant the cart total > 0 AND the preview resolved (SPEC §D.4 rewire). While the preview is in flight (sub-second), the CTA shows a slim inline spinner + "Getting your price…" and the number area shows a shimmer — NOT a disabled dead button with no explanation.

### 6.3 The "What's included" panel (tap-to-open, reassurance only)
Opens as a small bottom inset / popover above the bar (reuse the existing sheet/popover; on the cart sheet it expands inline above the Total). It is the SAME breakdown as the receipt (§7), pre-purchase:
```
What's included
  Tickets (2 × £11.50)      £23.00
  Service fee               £2.00
  ───────────────────────────────
  Total                     £25.00
  Includes £4.17 VAT                  ← UK inclusive VAT note, text.secondary
```
- Only shows components that exist for this cart. VAT is shown as an **"Includes £X VAT"** note under the total (inclusive model — NOT a line that adds up), never as an added line. Mingla fee, if passed, appears folded — see §6.4.
- Closing returns to the bare hero number. This panel is opt-in; the default view is just the number + the quiet "incl." line.

### 6.4 Naming inside the breakdown (consumer-facing — keep it human)
- "Tickets (n × £unit)" — the base.
- **"Service fee"** — the passed service fee (decision: this is the only fee that gets its own buyer-facing line, because it's the Eventbrite-style disclosed line and buyers expect to see it named).
- The **Mingla platform fee**, when passed, is **folded into the ticket/subtotal, not shown as a separate "Mingla fee" line to the buyer** (buyers don't need to see the platform's cut itemized; it's baked into the price they agreed to). It IS itemized to the brand (Surface 5) and recorded in `pricing_breakdown`. *(Flagged to operator §9 as a product-presentation call — alternative is to show it; recommend folding.)*
- **"Includes £X VAT"** — the inclusive-VAT note (UK).

### 6.5 States (all 9)
| State | Treatment |
|---|---|
| Empty (cart empty) | sticky bar hidden or "Select tickets" placeholder CTA disabled with label "Add tickets" (existing pattern). |
| Loading (preview in flight) | number shimmer + CTA "Getting your price…" spinner; never a silent disabled CTA. |
| Populated | hero number + "incl. …⌄" + enabled "Pay £X". |
| Press (CTA) | scale 0.98 + haptic; opens PaymentSheet. Press on "incl.⌄": opens panel. |
| Focus | focus ring on CTA; reading order Total → incl. line → Pay button. |
| Disabled | only when total is 0 or sold out — label says why ("Sold out"), never an unexplained grey. |
| Error (preview failed) | per SPEC §B.4, the engine degrades to flat-absorb and STILL returns a number — so the bar shows that number. A true network failure shows "Couldn't load price — tap to retry" inline, retryable, never a blocking screen. |
| Offline | "You're offline — we'll get your price when you reconnect" inline; CTA disabled with that reason. |
| First-time | none needed; the "incl. …" line is self-explanatory. |

### 6.6 Reuse + accessibility
- Reuses `TicketCartSheet` sticky-bar structure, `Glass` (Android opaque), the consumer money formatter, the existing CTA button + haptics.
- The number + CTA are one logical group: `accessibilityLabel="Total twenty-five pounds, includes VAT and fees. Double-tap Pay to continue."` The "incl.⌄" control: `role="button"`, label "Show what's included". Live region updates the total when quantity changes.

---

## 7. SURFACE 7 — Receipt / confirmation breakdown (incl. the UK "Includes £X VAT" line)

**Where:** the consumer confirmation screen + the ticket-confirmation email render (`_shared/marketingEmailRender.ts` / confirmation email) — SPEC §D.6. Reads `orders.pricing_breakdown`.
**Moment:** the buyer just paid; this is the trust receipt + the brand's record. This is the ONLY place the full breakdown is mandatory (decision #3).

### 7.1 Layout (in-app confirmation — the breakdown block)
Within the existing confirmation screen (success header, ticket(s), then this block):
```
┌──────────────────────────────────────────────┐  surface.card, radius.lg, pad space.lg
│  Your purchase                                 │  type.headline 600
│                                                │
│  Tickets (2 × £11.50)            £23.00        │  type.body, label text.secondary / amount text.primary
│  Service fee                     £2.00         │  (only if present)
│  ──────────────────────────────────────────   │  border.hairline
│  Total paid                      £25.00        │  type.body 700 text.primary (the anchor)
│  Includes £4.17 VAT                            │  type.footnote text.secondary (inclusive note, §7.2)
│                                                │
│  Paid with •••• 4242 · 29 May 2026             │  type.caption text.tertiary
└──────────────────────────────────────────────┘
```
- Same itemization rules as §6.3/§6.4 (Service fee its own line; Mingla fee folded; VAT as an inclusive note). The receipt is the canonical breakdown — the cart panel (§6.3) is just a pre-view of it, so they MUST match the same row set and order.
- "Total paid" is the anchor (past tense — money already moved).

### 7.2 The UK "Includes £X VAT" line — final copy + behavior
- **Copy:** **"Includes £4.17 VAT"** (amount from `pricing_breakdown.components.tax_cents`, formatted via the helper). Lowercase "Includes", VAT uppercase.
- **Behavior:** it sits **directly under "Total paid"**, in `text.secondary`, and is a NOTE, never a math line — the numbers above already sum to the Total; the VAT line restates a portion that is *inside* the Total (inclusive model). This is the Stripe/HMRC-correct inclusive presentation: the VAT is extracted from the total, not added to it.
- **When tax_basis is a flat-absorb fallback** (`unresolved/country_unsupported/calc_failed`): if no VAT was computed, the line is **omitted** (don't show "Includes £0.00 VAT"). If the inclusive baseline still implies a VAT portion the brand absorbed, show it — but never £0.
- **Region-aware:** GB → "Includes £X VAT". A future US exclusive case would instead show "Tax £X" as a real added line above the total — region map, reserved, not built.

### 7.3 Email render
- Same row set, simplified to a single-column table (email-safe), brand-neutral Mingla styling (reuse `marketingEmailRender.ts` card/table primitives — no new email system). The "Includes £X VAT" line renders as small grey text under the bolded Total. No interactivity (email) — the breakdown is always fully expanded (no tap-to-open in email).

### 7.4 States
| State | Treatment |
|---|---|
| Populated | full breakdown as above. |
| Loading | confirmation screen's existing skeleton. |
| Free ticket (£0) | "Total paid Free", no VAT/fee lines, no payment-method line. |
| Flat-absorb / no VAT | VAT note omitted; rest unchanged. |
| Error (pricing_breakdown missing on order) | fall back to the legacy total-only display + log; never show a half-broken table. |
| Refund/partial (later view of same receipt) | out of this ORCH's visual scope, but the row structure must not preclude a future "Refunded £X" line — leave the block extensible (don't hardcode row count). |

---

## 8. SURFACE 8 — WYSIWYP all-in price on deck/swipe cards + detail pages (consumer + business)

**Where (SPEC §D.1–D.3):** shared `packages/event-rendering/QuantityRow.tsx` + `PublicEventPage.tsx` + `types.ts`; shared `packages/brand-rendering/PublicBrandPage.tsx` mini-cards; consumer `app-mobile/` `SwipeableCards.tsx`, `CuratedExperienceSwipeCard.tsx`, `ExpandedCardModal.tsx`, `SavedTab.tsx`, `CalendarTab.tsx`, `utils/formatters.ts`; business cards via `shared/PriceTag.tsx`.
**Moment:** the buyer is browsing/comparing. The price on the card must be the SAME number they'll pay (SC-1) — no "from", no "+fees", no asterisk.

### 8.1 The contract (visual — per SPEC §I.8: "no change to the number's prominence; ensure the all-in reads as THE price")
- **The displayed value is `displayPriceCents` / `allInPriceGbp`** from the public view (the engine's all-in when passed; the bare tier when absorbed). It renders in the **exact same slot, weight, size, and color** the price occupies today on each surface — we are changing the VALUE, not the styling. No new badge, no "all-in" label, no decoration. The whole point is that it silently becomes correct.
- **Remove any "+ fees" / "+ tax" / asterisk** currently appended near a price on any of these surfaces (it's now baked in — appending would lie). **[CONFIRM at IMPLEMENT]** whether any current surface appends such a suffix; if so, delete it.
- **Multi-tier ("from £X"):** where a card shows a range/"from", keep "from" semantics but source the lowest tier's all-in. "from £12" stays "from £12" with £12 = the all-in lowest tier. Single-price cards show the single all-in number, no "from".
- **Free:** "Free" via the helper, unchanged.

### 8.2 Per-surface slot (reuse, do not restyle)
| Surface | Component | Slot today → change |
|---|---|---|
| Consumer deck card | `SwipeableCards.tsx` / `CuratedExperienceSwipeCard.tsx` | the price chip/badge — value → all-in; styling unchanged |
| Consumer expanded card | `ExpandedCardModal.tsx` | the price line above tier selection — value → all-in |
| Consumer Saved / Calendar | `SavedTab.tsx` / `CalendarTab.tsx` | the per-item price label — value → all-in |
| Detail page (shared) | `packages/event-rendering/PublicEventPage.tsx` + `QuantityRow.tsx` | per-tier price + headline price → all-in per tier |
| Brand page mini-cards (shared) | `packages/brand-rendering/PublicBrandPage.tsx` | EventMiniCard/TripMiniCard price label → all-in |
| Business cards | `mingla-business/components/shared/PriceTag.tsx` | the price-tag value → all-in |

### 8.3 The detail-page per-tier row (`QuantityRow.tsx`) — the one place tiers itemize pre-checkout
On the detail page, each tier row shows its **all-in per-ticket** price next to the stepper. NO per-tier fee breakdown here (decision #3 — breakdown is receipt-only). A single quiet line under the tier list (same "incl. VAT & fees" treatment as §6.2) reassures, tappable to the §6.3 panel. This keeps the detail page WYSIWYP-consistent with the cart and receipt.

### 8.4 States (deltas)
| State | Treatment |
|---|---|
| Populated | all-in number in the existing slot. |
| Loading (view not yet returned the field) | existing card price skeleton. |
| Missing all-in (legacy row, view returns null) | fall back to the bare tier price (which, for all-absorb legacy rows, IS the all-in — decision #5, no visible change) + log; never show a blank or "£NaN". |
| Free / sold-out | existing "Free" / "Sold out" labels, unchanged. |
| Business vs consumer | identical value contract; each app uses its own token set + formatter (no cross-import). Android opaque policy applies to any glass card surface (most cards are solid — verify the deck card overlay obeys §1.5). |

### 8.5 Accessibility
- The price keeps its existing `accessibilityLabel` slot but the spoken value is the all-in ("twelve pounds"), and where a "incl. VAT & fees" affordance exists it's appended ("twelve pounds, includes VAT and fees"). No new focus stops on cards (the price is part of the card's existing label).

---

## 9. Open product-presentation calls flagged to operator (designer recommendations, one-string swaps)

1. **"You covered £X" vs the SPEC's "You absorbed £X"** (Surface 5). Design recommends **"covered"** (UK-honest, matches the "I'll cover it" switch label, reads as a choice not a leak). Swap to "absorbed" is one string if preferred.
2. **Mingla fee folded vs itemized to the buyer** (Surface 6/7 breakdown). Design recommends **folding** the passed Mingla platform fee into the subtotal (buyers don't expect to see the platform's cut named; Service fee is the disclosed line). Showing it is one line if the operator wants maximal transparency.
3. **VAT switch labels "Included in price" / "I'll cover it"** (Surfaces 1/2/3). These avoid "pass/absorb" jargon and are T-1-honest. If the operator wants the literal "Pass VAT / Absorb VAT" wording for brand familiarity, it's a label swap — but design strongly recommends against it for the UK (it implies a buyer price change that won't happen).
4. **Exact service-fee % (T-2)** is set at/near launch by the operator (flat % of order, uniform across cards). The design shows it as a single "Service fee £X" line; no UI change needed when the % is set.

---

## 10. Cross-surface consistency rules (the invariants this design adds)

- **One number, one place to break it down.** The all-in appears on card → detail → cart → checkout → receipt; the breakdown appears ONLY on the receipt (and, opt-in, the cart "What's included" panel which is a pre-view of the same receipt rows). The cart panel and the receipt MUST render the identical row set + order + naming.
- **The buyer never sees "pass/absorb", "exclusive/inclusive", or the platform's internal fee math.** They see Tickets / Service fee / Total / "Includes £X VAT".
- **The brand sees the consequence, not the mechanism.** Switches say what happens to the buyer + their own take (the live preview), never raw "pass/absorb"; reporting says "You covered £X".
- **Currency + region come from data, never hardcoded.** Every glyph through the money helper; every region-specific word from a region copy map (GB strings written here; US slots reserved).
- **Android glass = opaque ≥0.92** on every glass surface touched (cart bar, checkout sheet, any floated panel); plain cards elsewhere.
- **No new component systems.** Reuse `Glass`, `MoneyText`/formatter, `PricingStep` controls, `CheckoutSheet`/`TicketCartSheet` sticky bars, existing tooltip/popover, existing icon set. Zero parallel primitives.

---

## 11. Designer completion gate (self-check against `/goal` 7 clauses)

1. **References examined** — present (top of doc): Airbnb, Eventbrite, Stripe Checkout, Apple/Things, Linear. ✔
2. **All 9 states** — designed per surface (§2.5, §3.2, §4.3, §5.1/§5.2, §6.5, §7.4, §8.4); inapplicable states named with reasons (e.g. defaults never lock; locked section has no empty variant). ✔
3. **Every spacing/size/radius is a named token** — yes; values on the 4px grid; the few that must be confirmed against the real token file are tagged `[CONFIRM token value at IMPLEMENT]` (value lookups, not magic numbers). ✔ (with the tool-channel caveat in the header note)
4. **Contrast computed, not eyeballed** — §1.2 gives numeric targets for every load-bearing pairing in both modes; exact ratios to be finalized against resolved hexes (tagged), with documented targets ≥ thresholds. ✔
5. **Every interactive element ≥44pt, has accessibilityLabel, non-shifting press** — switch rows 56pt, segments 32pt-high but ≥44pt touch slop, CTA 52pt; labels specified per surface; press = scale-only (no layout shift). ✔
6. **Zero anti-slop** — no generic gradients, no stock/AI imagery, no emoji icons in production (emoji in this doc are shorthand for named icon tokens), no decorative effects; motion is all communicative. ✔
7. **Copy in Mingla voice per state; motion has reduced-motion fallback** — copy written per state; §1.6 gives a reduced-motion fallback for every animation. ✔

**Honesty caveat (clauses 3 + 4):** the token-VALUE confirmations could not be re-opened after the tool-channel stall (header note). They are named-token lookups against an existing file, tagged for the implementor — not magic numbers and not eyeballed contrast. The IA, layout, states, motion, and all copy are complete and locked.

---

## 12. Handoff to IMPLEMENT

This design is the visual/IA/copy contract for SPEC §I surfaces 1–8. The functional contract + acceptance bar in the SPEC remain LOCKED and authoritative; where this design and the SPEC could appear to differ, the SPEC's money math + switch semantics win and this design styles within them. The implementor MUST, in addition to the SPEC's own `[CONFIRM at IMPLEMENT]` list: (a) resolve every `[CONFIRM token value at IMPLEMENT]` tag by reading `mingla-business/components/theme/tokens.ts` + the consumer token set and substituting the real values; (b) finalize the numeric contrast ratios against the resolved hexes and confirm each clears its §1.2 target; (c) wire the live preview chip to a client mirror of the engine's `pricing_breakdown` math; (d) implement the GB region copy map with US slots reserved (do not hardcode GB strings at call sites); (e) build all glass surfaces through `Glass` with the Android opaque fallback. Operator decisions in §9 should be confirmed before the affected strings are coded.
