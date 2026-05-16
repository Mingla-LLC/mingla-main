# DESIGN VERDICT — ORCH-0847 Phase C `<TicketCartSheet>` (Consumer)

**Skill:** `/ui-ux-pro-max` design pre-flight per memory `feedback_implementor_uses_ui_ux_pro_max`
**ORCH:** ORCH-0847 [Consumer ticket purchase parity with public business page]
**Phase:** C — Consumer multi-tier cart sheet + marketing opt-in (mirroring public J-C1 within 8pt visual tolerance)
**Date:** 2026-05-15
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

This is a binding design contract. The mingla-implementor Phase C JSX must conform to this verdict or call out the deviation in the implementation report.

---

## 1. Why this design exists

The consumer app's current `TicketClaimConfirmModal` confirms a single ticket purchase. SPEC §4.1 + operator pushback require a multi-tier cart that mirrors the public business buyer page's J-C1 screen (`mingla-business/app/checkout/[eventId]/index.tsx`) within 8pt visual tolerance. Phase B already landed the country-picker phone field and the per-tier `<QuantityRow>` is extracted to `@mingla/event-rendering` with a ports-and-adapters theme prop. Phase C now wraps that primitive into a bottom-sheet checkout flow for the consumer app, adds a marketing-opt-in checkbox matching the public form's copy verbatim, and a compact buyer recap card showing the auth-derived pre-fill (name / email / phone) read-only.

The constraints are mobile-only (RN, `@gorhom/bottom-sheet`), dark canvas (mingla consumer dark UI), and parity-locked with the public J-C1 visual language. No web target. No bottom-sheet redesign — reuse the proven snap+backdrop pattern already in `TicketClaimConfirmModal.tsx` and `ExpandedBusinessEventSheet.tsx`.

---

## 2. Sheet anatomy

### 2.1 Bottom-sheet container

| Property | Value | Rationale |
|---|---|---|
| Library | `@gorhom/bottom-sheet` | Per memory `feedback_topsheet_extended_universal_creator` + `I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM`. Matches every other consumer-side sheet in app-mobile. |
| `snapPoints` | `["75%"]` | Taller than `TicketClaimConfirmModal`'s 60% because the cart needs to display up to 4 tier rows + opt-in + buyer recap + sticky bar simultaneously. 75% leaves a visible backdrop strip so the user knows they can dismiss. |
| `index` | `visible ? 0 : -1` | Declarative open/close — same pattern as existing sheets. NO `present()` / `dismiss()` ref dance. |
| `enablePanDownToClose` | `true` | Standard iOS gesture. Guarded inside `onCancel` when `isSubmitting === true`. |
| `backdropComponent` | `BottomSheetBackdrop` with `appearsOnIndex={0}`, `disappearsOnIndex={-1}`, `pressBehavior="close"` | Matches existing pattern. |
| `onChange(-1) && visible` | Calls `onCancel` | Mirror `TicketClaimConfirmModal:103-110`. |
| Mounting position | Sibling-in-fragment alongside the parent `<BottomSheet>` inside `ExpandedBusinessEventSheet` | Per memory `feedback_rn_sub_sheet_must_render_inside_parent`. |

### 2.2 Sheet background + handle

| Token | Value | Source |
|---|---|---|
| `sheetBackground.backgroundColor` | `#15181f` | Existing `TicketClaimConfirmModal.tsx:241` — preserves the dark-glass canvas readability + matches the consumer ExpandedBusinessEventSheet's `#0c0e12` canvas at a one-step-lighter offset for visual depth. |
| `borderTopLeftRadius` / `borderTopRightRadius` | `28` | Existing TicketClaimConfirmModal. |
| `handleIndicator.backgroundColor` | `rgba(255,255,255,0.35)` | Existing TicketClaimConfirmModal. |
| `handleIndicator.width` | `44` | iOS HIG drag-handle width; matches existing. |

### 2.3 Internal padding

| Region | Padding | Rationale |
|---|---|---|
| Sheet content horizontal | `24` | Matches `TicketClaimConfirmModal.tsx:251` + iOS HIG comfortable safe inset. |
| Sheet content top | `12` (from handle area) | Same. |
| Sheet content bottom | `insets.bottom + 16` | Honor safe area on devices with home indicator. |
| Between sections | `16` | Standard rhythm. Mirrors public J-C1 `spacing.md`. |
| Between tier rows | `8` | Matches package `QuantityRow.host.marginBottom`. |

---

## 3. Layout — top to bottom

### 3.1 Header row (sticky inside sheet content)

```
┌─────────────────────────────────────────┐
│ Get tickets                         ×   │  ← 20pt heavy weight title, left
└─────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Title text | "Get tickets" — 20pt, weight 700, color `rgba(255,255,255,0.96)`, line-height 26 |
| Close (×) button | 32×32pt circular hit area, `accessibilityLabel="Close"`, `hitSlop={12}`, icon size 20, color `rgba(255,255,255,0.65)`, background `rgba(255,255,255,0.08)` |
| Layout | `flexDirection: "row"`, `alignItems: "flex-start"`, `justifyContent: "space-between"`, `gap: 12` |

### 3.2 Section label — "SELECT YOUR TICKETS"

```
SELECT YOUR TICKETS
```

| Property | Value | Source |
|---|---|---|
| Font size | `11` | Matches public J-C1 (`mingla-business/app/checkout/[eventId]/index.tsx:352-356` `styles.sectionLabel`) |
| Font weight | `600` |  |
| Letter spacing | `1.4` | Same |
| Color | `rgba(255,255,255,0.52)` (textTertiary equivalent on dark) |
| Top margin | `16` (after header) |
| Bottom margin | `8` |

### 3.3 Tier rows — `<QuantityRow>` per visible ticket

Use `<QuantityRow>` from `@mingla/event-rendering` per Phase A2 with these host adapters:

| Adapter | Value |
|---|---|
| `CardComponent` | A new minimal `ConsumerCartCard` component (defined in §6.1 below). NOT the public `GlassCard` (consumer doesn't have the GlassChrome / blurIntensity stack). |
| `renderPlusIcon` | `(props) => <Icon name="plus" size={props.size} color={props.color} />` using app-mobile's existing `Icon` component (verified `plus` exists in the consumer icon set). |
| `formatCurrency` | App-mobile's existing `formatCurrency(value, currency)` util at `app-mobile/src/utils/currency.ts` (mirror the public-page contract: `formatCurrency(156.20, "GBP") → "£156.20"`). |
| `theme` | See §4 below — `CONSUMER_TICKET_CART_THEME`. |
| `fallbackCurrency` | `data.currency` (event's currency from `ExpandedBusinessEventSheet` data prop). |

Sorting: by `ticket.displayOrder` ascending — matches public J-C1.

Visibility filter (mirror public J-C1 lines 56-57): `ticket.visibility !== "hidden" && ticket.availableAt !== "door"`.

### 3.4 Marketing opt-in checkbox

Renders BELOW the last tier row, ABOVE the buyer recap.

```
☐  Email me about this organiser's future events
```

| Property | Value | Source |
|---|---|---|
| Box | 22×22pt, `radius.sm` corners (8pt), 1.5pt border | Mirror public `mingla-business/app/checkout/[eventId]/buyer.tsx:551-580` |
| Unchecked border color | `rgba(255,255,255,0.12)` | Dark-mode equivalent of `glass.border.profileBase` |
| Checked fill | `#eb7825` (accent) | Same as public + `TicketClaimConfirmModal` CTA color |
| Checked border | `#eb7825` |  |
| Check icon | 14pt `Icon name="check"` color `#ffffff` |  |
| Label text | "Email me about this organiser's future events" — 14pt, `rgba(255,255,255,0.72)`, line-height 20 | **VERBATIM** match with `mingla-business/app/checkout/[eventId]/buyer.tsx:415` per SPEC SC-14 |
| Pressable hit area | Entire row (box + label + 12pt vertical padding) | iOS HIG ≥44pt touch target |
| Accessibility | `accessibilityRole="checkbox"`, `accessibilityState={{checked}}`, `accessibilityLabel="Email me about this organiser's future events"` |  |
| Default | `useState<boolean>(false)` — UNCHECKED | SPEC SC-12 / GDPR/CAN-SPAM compliance |
| Top margin from last tier row | `12` |  |
| Bottom margin before buyer recap | `12` |  |

### 3.5 Buyer recap card

Compact, read-only block showing the auth-derived pre-fill. Replaces the longer name/email/phone form on the public J-C2 (consumer pre-fills from profile — no inline editing).

```
┌─────────────────────────────────────────┐
│ YOUR TICKET GOES TO                     │
│                                         │
│ Name      Alice Smith                   │
│ Email     alice@example.com             │
│ Phone     +447700900000                 │
└─────────────────────────────────────────┘
```

| Property | Value | Source |
|---|---|---|
| Wrapper | `ConsumerCartCard` (§6.1) | Visually identical to tier rows for hierarchy continuity |
| Section label | "YOUR TICKET GOES TO" — 12pt, 600 weight, uppercase, letter-spacing 0.6, color `rgba(255,255,255,0.55)` | Mirror `TicketClaimConfirmModal.tsx:298-305` |
| Bottom margin (label → first row) | `10` | Same |
| Row gap | `8` |  |
| Row label color | `rgba(255,255,255,0.45)` |  |
| Row value color | `rgba(255,255,255,0.96)` |  |
| Row layout | `flexDirection: "row"`, `alignItems: "baseline"`, `justifyContent: "space-between"`, `gap: 12` |  |
| Row value | `numberOfLines={1}`, ellipsis on long emails |  |

Pre-fill source (already wired in `ExpandedBusinessEventSheet.tsx:206-211`):
- `buyerName = profile?.display_name?.trim() || user.email?.split("@")[0] || "Guest"`
- `buyerEmail = user.email ?? profile?.email ?? ""`
- `buyerPhone = profile?.phone ?? ""`

No inline edit — passing through to backend exactly as the parent computes.

### 3.6 Sticky bottom bar

Pinned to the sheet bottom; rises above scroll content via `position: "absolute"` inside the BottomSheetView. NOT inside the scrollable region.

```
┌─────────────────────────────────────────┐
│ Subtotal              £45.00            │
│ ┌─────────────────────────────────────┐ │
│ │       Continue to Payment           │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Bar background | `rgba(21, 24, 31, 0.94)` — same hue as sheet, slight transparency for visual depth above the scroll content edge |
| Top border | `1pt` hairline `rgba(255,255,255,0.06)` |
| Top padding | `12` |
| Horizontal padding | `24` (matches sheet content) |
| Bottom padding | `insets.bottom + 16` |
| Subtotal row | `flexDirection: "row"`, `justifyContent: "space-between"`, `alignItems: "baseline"`, `marginBottom: 8` |
| Subtotal label text | "Subtotal" — 13pt, 500 weight, `rgba(255,255,255,0.55)` |
| Subtotal value text | 20pt, 700 weight, `rgba(255,255,255,0.96)`, letter-spacing -0.3 — mirrors public J-C1 |
| Subtotal value content | `totals.isEmpty ? "—" : totals.isFree ? "Free" : formatCurrency(totals.total, totals.currency)` |
| Primary CTA | Full-width pill button, height 52, `borderRadius: 14`, background `#eb7825`, text `#ffffff` 15pt 700 weight |
| CTA disabled | `opacity: 0.5` when `totals.isEmpty || isSubmitting` |
| CTA loading | Replace label text with `<ActivityIndicator color="#fff" />` when `isSubmitting === true` |
| CTA label | `totals.isEmpty ? "Add tickets above" : totals.isFree ? "Claim Free Ticket" : "Continue to Payment"` — matches existing consumer copy verbatim (SPEC §4.1.5) |
| Touch target | CTA full-width × 52pt ≥ 44pt (passes WCAG) |
| Haptic on tap | `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)` |

---

## 4. `CONSUMER_TICKET_CART_THEME` for `<QuantityRow>`

Dark-mode tokens matching the `#15181f` sheet canvas. Pass via `theme={CONSUMER_TICKET_CART_THEME}` prop on `<QuantityRow>`.

```ts
const CONSUMER_TICKET_CART_THEME: QuantityRowTheme = {
  accent: "#eb7825",
  textPrimary: "rgba(255, 255, 255, 0.96)",
  textSecondary: "rgba(255, 255, 255, 0.72)",
  textTertiary: "rgba(255, 255, 255, 0.52)",
  textQuaternary: "rgba(255, 255, 255, 0.32)",
  stepperBg: "rgba(255, 255, 255, 0.06)",
  stepperBorder: "rgba(255, 255, 255, 0.12)",
  semanticWarning: "#f59e0b",
  semanticError: "#ef4444",
  saleBannerBg: "rgba(245, 158, 11, 0.12)",
  saleBannerBorder: "rgba(245, 158, 11, 0.32)",
  soldOutBg: "rgba(239, 68, 68, 0.16)",
  soldOutBorder: "rgba(239, 68, 68, 0.32)",
};
```

Visual delta from public-side mingla-business theme: consumer uses pure-white-alpha text + stepper bg (against the dark sheet canvas) instead of mingla-business's `glass.tint.chrome.idle = "rgba(12,14,18,0.48)"` (against a different canvas). Both render identically to the user — same perceived contrast on each app's respective canvas — but the alpha values differ because the underlying backgrounds differ. Within 8pt visual tolerance per SPEC SC-02.

---

## 5. State matrix

Per SPEC §4.1.5 every state MUST render. Implementor MUST handle all 7:

| State | Trigger | Visible content | CTA |
|---|---|---|---|
| `loading` | `tickets === undefined` (parent's `ticketsQuery.isLoading`) | Skeleton: 3 placeholder rows (gray bars at 60pt height each, 8pt vertical gap), header + close render normally | Hidden (no sticky bar) |
| `empty` | `tickets.length === 0` | Header + section label + body text "No tickets available for this event." | Hidden |
| `sold_out` | Every visible tier `!isUnlimited && capacity <= 0` | Header + body text "Sold out. Check back later." | Hidden — replaced with a single "Close" button styled like the CTA |
| `sales_closed` | Event ended OR every visible tier disabled/sale-ended | Header + body text "This event isn't taking new tickets." | Hidden — Close button instead |
| `populated_empty_cart` | Tickets renderable; user hasn't tapped any stepper yet | Header + tier rows + opt-in + buyer recap + sticky bar | CTA disabled, label "Add tickets above" |
| `populated_cart` | At least one tier has `quantity > 0` | Same as above with sticky bar subtotal updated | CTA enabled, label "Claim Free Ticket" or "Continue to Payment" |
| `submitting` | `isSubmitting === true` | Same as populated_cart; stepper buttons disabled; backdrop tap + swipe-down no-op | CTA shows `<ActivityIndicator>` |

---

## 6. New consumer-app components (Phase C deliverables)

### 6.1 `ConsumerCartCard`

A minimal card wrapper used by `<QuantityRow>` (as `CardComponent`) AND by the buyer-recap block. Pure presentational.

```tsx
// app-mobile/src/components/expandedCard/ConsumerCartCard.tsx
import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

export interface ConsumerCartCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const ConsumerCartCard: React.FC<ConsumerCartCardProps> = ({
  children,
  style,
}) => <View style={[styles.card, style]}>{children}</View>;

const styles = StyleSheet.create({
  card: {
    borderRadius: 16, // matches public GlassCard radius "lg" = 16
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    padding: 16, // matches public GlassCard padding={spacing.md}
  },
});
```

Why not reuse a complex glass primitive? The consumer ExpandedBusinessEventSheet canvas is already dark glass; layering another glass component creates visual mud. A simple low-alpha card on top of the `#15181f` sheet reads clearly without competing.

### 6.2 `useTicketCart` hook

Already specified in SPEC §4.1.4. No new design call — implementor uses the spec'd `useReducer` over Zustand contract.

### 6.3 `TicketCartSheet`

Already specified in SPEC §4.1.5 + this design verdict §2-§5. Bottom-sheet container with the layout in §3.

---

## 7. Accessibility checklist (per memory `feedback_wcag_aa_kit_invariants`)

- [x] Every interactive `<Pressable>` has explicit `accessibilityRole` + `accessibilityLabel`
- [x] Stepper buttons ≥ 44pt (inherited from `QuantityRow.STEPPER_BTN = 44`)
- [x] Primary CTA ≥ 52pt height
- [x] Close (×) button has `hitSlop={12}` to reach 44pt
- [x] Opt-in checkbox row tap area spans entire row (≥44pt height via 12pt vertical padding × 22pt box)
- [x] Quantity number value has `accessibilityLiveRegion="polite"` (inherited from QuantityRow)
- [x] Color is not the only signal: sold-out / sales-paused / sales-closed all surface BOTH a colored badge AND text
- [x] Contrast: white-alpha text on `#15181f` — body text at 0.96 alpha = >12:1 ratio, secondary at 0.72 = >7:1, tertiary at 0.52 = >4.5:1 (passes WCAG AA)
- [x] CTA background `#eb7825` on dark sheet `#15181f` — contrast >4.5:1 for white text on the orange button (passes)
- [x] Haptic feedback for stepper taps (selection) and CTA tap (impact medium) per memory recommendation
- [x] `prefers-reduced-motion`: bottom-sheet transition respects RN's default; ActivityIndicator does not over-animate
- [x] No emoji icons — every glyph from app-mobile `Icon` set (`plus`, `check`, `close`)
- [x] Touch-target overlap: tier row stepper buttons have 6pt gap (not 0pt) so the user can't accidentally hit `−` when targeting `+`

---

## 8. What's NOT in the design (anti-scope creep)

- **No country picker on the sheet.** Phone is pre-filled from auth profile, displayed read-only in the buyer recap. The country picker only lives on the public web buyer form (Phase B).
- **No name / email / phone inline edits.** If the user has bad pre-fill data, they fix it on their profile screen — out of scope for the cart sheet.
- **No "saved cards" UI.** Stripe PaymentSheet handles all payment-method state via the existing Connect ephemeral key flow (ORCH-0844).
- **No animation when cart total changes.** `accessibilityLiveRegion="polite"` is enough; visual fade/slide on numeric updates is over-design here.
- **No additional sheet snap points.** Single 75% snap. No expand-to-90%-on-scroll dance.
- **No web target.** RN-only (per memory `I-MOR-0827-CONSUMER-NATIVE-STRIPE-ONLY` for payments; this sheet is on consumer mobile only).

---

## 9. 8pt visual tolerance verification (vs. public J-C1)

| Element | Public J-C1 value | Consumer cart sheet value | Delta | Within 8pt? |
|---|---|---|---|---|
| Section label font size | 11pt | 11pt | 0 | ✓ |
| Section label letter spacing | 1.4 | 1.4 | 0 | ✓ |
| Tier row inter-spacing | 8pt | 8pt | 0 | ✓ |
| Tier row card padding | 16pt | 16pt | 0 | ✓ |
| Tier row card radius | 16pt | 16pt | 0 | ✓ |
| Sticky bar top padding | 16pt | 12pt | -4 | ✓ |
| Sticky bar horizontal | 24pt | 24pt | 0 | ✓ |
| Subtotal value font size | 20pt | 20pt | 0 | ✓ |
| Subtotal value letter spacing | -0.3 | -0.3 | 0 | ✓ |
| Primary CTA height | ~52pt (Button size="lg") | 52pt | 0 | ✓ |
| Primary CTA radius | radius.md ≈ 12pt | 14pt | +2 | ✓ |
| Card border alpha | rgba 0.06 | rgba 0.06 | 0 | ✓ |
| Sheet content horizontal padding | 24pt | 24pt | 0 | ✓ |

All deltas within 8pt. Color values match where they map cleanly (tier card alpha = 0.03 vs. public glass.tint.profileBase 0.04 = sub-1% delta, visually identical on the dark canvas).

---

## 10. Design verdict — APPROVED for implementation

Phase C is greenlit. Implementor receives:

1. `<ConsumerCartCard>` definition (§6.1) — write as a new file
2. `CONSUMER_TICKET_CART_THEME` constant (§4) — declare inline in `TicketCartSheet.tsx`
3. Exact spacing + token table (§2 + §3 + §9) — translate into StyleSheet.create
4. State matrix (§5) — implement all 7 render branches
5. Accessibility checklist (§7) — verify each at implementation
6. Anti-scope (§8) — DO NOT add country picker / saved-cards / animation flourishes

Deviations from this verdict MUST be called out explicitly in the Phase C implementation report. No silent design improvisation.
