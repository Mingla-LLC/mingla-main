# UI/UX — ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking deadline + bookings-closed]

**Mode:** COMPONENT (accordion-body) + flow + state machine.
**Caller:** mingla-forensics (SPEC mode) — this contract is embedded verbatim into `SPEC_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md` §4 (Component layer) and §Design.
**Surfaces:** business iOS + business Android (opaque-glass fallback) + adjacent business-web preview (same RN component).
**Comms ledger:** scanned on entry — no OPEN row targets ORCH-1120, `mingla-designer`, or `ALL`. Nothing to ack.
**Pattern anchor (binding):** `mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx` (ORCH-0880). The new component is its SETTINGS sibling — same self-contained accordion-body shape: server-seeded local edit state, dirty tracking, inline reason-and-save `GlassCard` banner (NOT a modal), success `Toast`. Reuse its `styles.*` shapes verbatim where named below.

---

## 0. The deliverable in one line

Replace the read-only Settings accordion body (dead-end hint + 3 static rows) with `<EditPublishedTripSettingsAccordion />`: a **Refund policy** editor block, a **Booking window** block (booking-deadline picker + live "Bookings closed" switch), and the SAME inline reason-and-save banner + Toast the Intake accordion uses — with one NEW state the Intake accordion does not have: a **server "Refund first" hard-block** path when a buyer-unfavorable edit is attempted on a trip that already has paid bookings.

---

## 1. IA & flow

**The moment:** the planner opened a LIVE trip → Edit → tapped the **Settings** section. They want to change the cancellation terms or the booking cutoff. Today they hit a lie ("use the wizard") and a disabled switch. Now they edit in place.

**Information hierarchy (top → bottom inside the accordion body):**
1. **Refund policy** — the buyer-protection terms. Most consequential (it's money), so it leads.
2. **Booking window** — the deadline + the hard "Bookings closed" switch. Second.
3. **Reason-and-save** — the commit affordance, appears only when something is dirty.

**The decision:** "what cancellation terms / cutoff do I want, and (if I have sales) am I making it BETTER or WORSE for people who already booked?"

**The action that follows:** tap **Save changes** → reason banner → **Save** → either (a) success toast "Settings saved. Live now." or (b) a **Refund first** block dialog if the edit hurt an existing booking.

**Flow (happy):** edit a control → it goes dirty → "Save changes" button enables → tap → reason banner slides in → type ≥10 chars → "Save" → RPC ok → banner collapses, dirty clears, success Toast.

**Flow (blocked-by-sales):** same up to RPC → RPC returns `ok:false` with a refund-class reason + `affected_order_count` → reason banner stays open, submitting clears, a **Refund first** ConfirmDialog overlays (reusing the screen's existing `setRejectDialog` machinery and copy shapes) → "Open Orders" (transitional toast stub) or "Got it" → local edit state is PRESERVED (the planner can dial the edit back to a favorable one and retry).

**Edge — no pricing tiers / free trip:** refund policy is irrelevant on a free trip but the column still exists; show the editor normally (a free trip simply never charges, so a refund policy is harmless). Do NOT special-case hide it — matches the existing read-only tab which always showed the row.

---

## 2. Layout & spacing grid

4/8pt grid via `spacing` tokens. The accordion body already sits inside `styles.sectionBody` (the parent provides section padding); this component adds only INTERNAL rhythm. Mirror `EditPublishedTripIntakeAccordion`'s `container { gap: spacing.md }` (16) as the outer stack.

```
<View container gap=16>                         // styles.container (= intake parity)

  ── Block A: Refund policy ───────────────────
  <View block>                                   // gap=8 (spacing.sm)
    <Text blockLabel>Refund policy</Text>        // see §3
    <Text blockHelp>How much travelers get back when they cancel.</Text>
    <RefundPolicyEditor value onChange />         // ORCH-0875 editor, full width
  </View>

  ── Block B: Booking window ──────────────────
  <View block>                                   // gap=8
    <Text blockLabel>Booking window</Text>
    <BookingDeadlinePicker value tripStartIso brandTimezone onChange />
    <View switchRow>                              // see §2.1
      <View switchRowText>
        <Text switchLabel>Bookings closed</Text>
        <Text switchHelp>Stop taking new bookings now, before the deadline.</Text>
      </View>
      <Switch ... />                              // LIVE, 44pt min hit target
    </View>
  </View>

  ── Block C: Sales-aware notice (conditional) ─
  {hasSales ? <GlassCard infoBanner> ... </GlassCard> : null}   // §5 populated-with-sales

  ── Reason-and-save (conditional) ────────────
  {reasonDialogVisible
    ? <GlassCard reasonBanner> ... </GlassCard>   // identical to intake reasonBanner
    : <View saveWrap><Button "Save changes" /></View>}

  <View toastWrap><Toast/></View>                 // absolute, intake parity
</View>
```

**Exact spacing:**
- Outer stack gap: `spacing.md` (16) — between Block A / Block B / Block C / save row.
- Inside a block: `spacing.sm` (8) — label → help → control.
- `blockHelp` → control: `spacing.xs` (4) extra is NOT added; the 8 gap is enough.
- `switchRow`: `flexDirection:"row"`, `alignItems:"center"`, `justifyContent:"space-between"`, `gap: spacing.md` (16), `paddingVertical: spacing.xs` (4) so the row reaches a ≥44pt height with the switch.
- `switchRowText`: `flex:1`, `gap: 2` (`spacing.xxs`).
- Reason banner internal spacing: copy the intake `reasonBanner` / `reasonInput` / `reasonButtons` styles VERBATIM (marginTop `spacing.sm`, border `accent.border` 1px, input minHeight 80, etc.). Do not re-derive.
- `saveWrap`: `marginTop: spacing.sm` (intake parity).

**Density rationale:** this is a CHOOSING task (set terms), not a comparing task → spacious, one control per row, generous 16 between blocks. The editors themselves are dense internally (that's their own ORCH-0875 spec); we don't touch them.

### 2.1 The live "Bookings closed" switch row

The ONLY genuinely new atomic control. It must read as a hard, slightly dangerous toggle (it stops revenue). Layout = label+help on the left (`flex:1`), `Switch` on the right. The Switch's native hit area is ~32pt tall on iOS; the `paddingVertical: spacing.xs` + the two-line text guarantees the ROW is ≥44pt, and the Switch itself is the tap target — acceptable per RN norms. Keep the existing `trackColor`/`thumbColor`/`ios_backgroundColor` values from the current disabled switch (track false `rgba(255,255,255,0.16)`, true `accent.warm`, thumb `#ffffff`) — just remove `disabled` and add `onValueChange`.

---

## 3. Type scale

| Element | Token | Value | Color token | Why |
|---|---|---|---|---|
| `blockLabel` ("Refund policy", "Booking window") | `typography.caption` + `fontWeight:"600"` | 12/16, 600, +0.2 ls | `text.secondary` | Matches the intake `reasonLabel` section-label rhythm; quiet, structural. |
| `blockHelp` | `typography.bodySm` | 14/20, 400 | `text.tertiary` | One-line plain-English subtitle. |
| `switchLabel` | `typography.body` | 16/24, 400 | `text.primary` | The toggle is a primary control — readable body weight. |
| `switchHelp` | `typography.caption` | 12/16, 500 | `text.tertiary` | Consequence hint. |
| `reasonTitle` ("Save settings changes?") | `typography.h3` | 20/32, 600 | `text.primary` | Intake parity. |
| `reasonDescription` | `typography.bodySm` | 14/20 | `text.secondary` | Intake parity. |
| `reasonLabel` ("Reason for change *") | `typography.caption` + 600 | 12/16 | `text.secondary` | Intake parity. |
| `infoBanner` text (sales notice) | `typography.body` | 16/24 | `text.primary` | Intake `warningText` parity. |

**Dynamic Type:** all type tokens are fixed point sizes (RN, no Dynamic Type scaling in this app — consistent with the whole business app). Line-heights are already ≥1.3× so larger system fonts won't clip within a block. No change.

---

## 4. Color & token mapping

Dark surface only (the business app is dark-mode-only; `canvas.discover` host bg). No light-mode variant required (parity with every sibling section).

| Surface / element | Token | Value | Contrast |
|---|---|---|---|
| Block label text | `text.secondary` | rgba(255,255,255,0.72) on ~#15171c card | ≈ 8.5:1 — pass AA |
| Block help / switch help | `text.tertiary` | rgba(255,255,255,0.52) | ≈ 5.0:1 — pass AA (it's ≥14px/≥12px secondary text) |
| Switch label | `text.primary` | rgba(255,255,255,0.96) | ≈ 14:1 — pass AAA |
| Switch track (on) | `accent.warm` | #eb7825 | indicator color — paired with the text label, not color-only |
| Reason banner border | `accent.border` | rgba(235,120,37,0.55) | accent affordance |
| Sales info banner | `GlassCard variant="base"` + border `semantic.warning` (#f59e0b) 1px + bg `semantic.warningTint` | intake `warningBanner` parity | the warning hue signals "edits here can be blocked" |
| Reason input bg/border | `glass.tint.profileBase` / `glass.border.profileBase` | intake `reasonInput` parity | |
| Success Toast | `Toast kind="success"` | semantic.success #22c55e | |

**Color-is-never-the-only-indicator:** the "Bookings closed" state is conveyed by the switch position AND the label; the sales-block is conveyed by an icon + title text ("Refund first") + count, never by hue alone.

---

## 5. Every interactive state

**Loading (server seed in flight):** the parent screen already gates the whole `EditPublishedTripScreen` behind its own trip-load query; by the time the Settings body renders, `trip.refundPolicy` / `trip.bookingDeadline` / `trip.bookingsClosed` are already populated (they ride on the same `trip` object). So this component seeds synchronously from props — NO independent loading skeleton needed. (Contrast with the Intake accordion, which has its OWN `useTripIntakeSchemasByEvent` query and thus a seed-from-server `useEffect`; this component seeds directly from the `trip` prop in `useState` initializers.) If the implementor instead chooses a `useEffect` seed for symmetry, show nothing (the props are already present) — do not flash an empty state.

**Empty:** not applicable — a trip always has a (possibly null) refund policy and deadline. `null` refund policy renders the editor's own "no policy / non-refundable" template state (ORCH-0875 owns that). `null` deadline renders the picker's own "No deadline" off state.

**Default / populated (no sales):** all three controls fully interactive. No info banner. "Save changes" button disabled until dirty.

**Default / populated (WITH paid sales):** identical controls + the **sales info banner** (Block C) renders above the save row:
> Icon `bell` (semantic.warning) + "{n} traveler{s} already booked. More-generous refunds, an extra tier, or a later deadline save instantly — but you can't make terms worse for them here."

This is the proactive teach so the planner isn't surprised by a block. Banner is `GlassCard` warning-tinted, intake `warningBanner` style.

**Press (control level):** the editors + picker own their own press states (ORCH-0875). The Switch uses native press. The "Save changes" `Button` uses its built-in press opacity. No custom press states added.

**Dirty (any control changed):** the changed control updates local state, the field is flagged dirty, "Save changes" enables. A small **"Edited"** badge on the Settings section HEADER lights up via the parent's existing `editedSectionKeys` mechanism — see §9 build note (the component must signal dirtiness up so the parent badge fires, matching every other section).

**Submitting:** reason banner's "Save" `Button` → `loading`, both buttons `disabled`, the editors/picker/switch `disabled` (pass a `disabled` prop through, OR wrap in `pointerEvents="none"` + 0.6 opacity — prefer per-control `disabled` where the control supports it; RefundPolicyEditor/BookingDeadlinePicker accept no `disabled` prop today, so wrap those two in a `<View pointerEvents={submitting ? "none" : "auto"}>` with `opacity: submitting ? 0.6 : 1` — document this in the SPEC as the disable mechanism).

**Error (network / unknown):** reason banner shows inline `reasonError` (red `semantic.error` caption) "Couldn't save. Try again." — intake `reasonError` parity. Banner stays open, edit state preserved.

**Blocked-by-sales (the NEW state):** RPC returns `ok:false` with `reason ∈ {refund_policy_downgrade_with_sales, refund_tier_removed_with_sales, booking_deadline_earlier_with_sales, bookings_closed_harms_active}` + `affected_order_count`. Behavior:
- submitting clears; reason banner STAYS OPEN (so the planner sees their typed reason + can adjust).
- a **ConfirmDialog overlays** via the screen's existing `setRejectDialog(...)` — DO NOT invent a new dialog. New copy entries (mirror existing "Refund first" shapes):

| reason | title | body | primary |
|---|---|---|---|
| `refund_policy_downgrade_with_sales` | "Refund first" | "{n} traveler{s} booked under the current refund terms. You can make refunds MORE generous, but to lower them, refund existing buyers first." | "Open Orders" → `closeAndOpenOrders` |
| `refund_tier_removed_with_sales` | "Refund first" | "{n} traveler{s} are protected by your current refund tiers. Add a tier freely, but removing one means refunding them first." | "Open Orders" |
| `booking_deadline_earlier_with_sales` | "Refund first" | "Moving the deadline earlier can strand people mid-booking. You can push it LATER any time; to pull it in, refund the {n} affected first." | "Open Orders" |
| `bookings_closed_harms_active` | "Refund first" | "Closing bookings this way affects {n} active booking{s}. Refund them first, or leave bookings open." | "Open Orders" |

- "Open Orders" reuses the existing `closeAndOpenOrders` transitional toast stub ("Trip orders ledger is coming soon. Refund existing buyers via your Stripe dashboard first.").

---

## 6. Motion spec

Match the parent screen + intake accordion exactly; add nothing novel.

| Trigger | Property | Curve | Duration | Reduced-motion |
|---|---|---|---|---|
| Section expand/collapse (header tap) | height/opacity of body | parent-owned (existing accordion) | existing | inherits parent |
| Reason banner appears (Save tapped) | mount + opacity 0→1 + translateY 8→0 | ease-out | 200ms | mount instantly, no translate |
| Reason banner dismiss | reverse | ease-in | 160ms | unmount instantly |
| Switch toggle | native | native | native | native (system honors reduce-motion) |
| Toast in/out | `Toast` component own motion | existing | existing | existing |
| Reject dialog overlay | screen's existing ConfirmDialog motion | existing | existing | existing |

Spring/translate values for the banner are LIFTED from the intake accordion's reasonBanner mount (if it animates) — if the intake banner mounts without animation, this one mounts without animation too (parity over novelty). No bespoke choreography. `prefers-reduced-motion` / RN `AccessibilityInfo.isReduceMotionEnabled`: where the parent already respects it, inherit; do not add a new animated value that ignores it.

---

## 7. Accessibility

- **Touch targets ≥44pt:** "Save changes" / "Keep editing" / "Save" buttons are `Button size="md"` (≥44). The Switch row is ≥44 tall via the two-line text + `paddingVertical`. The editors/picker own their own ≥44 targets (ORCH-0875, already shipped).
- **Switch a11y:** `accessibilityRole="switch"`, `accessibilityLabel="Bookings closed"`, `accessibilityState={{ checked: bookingsClosed, disabled: submitting }}`, `accessibilityHint="Stops new bookings immediately."`.
- **Block labels:** each editor block wrapped so the `blockLabel` precedes the control in reading order (VoiceOver/TalkBack reads "Refund policy" then the editor).
- **Reason input:** `accessibilityLabel="Reason for change"`, the char counter is decorative (`accessibilityElementsHidden` / `importantForAccessibility="no"`), errors use `accessibilityLiveRegion="polite"` (intake parity).
- **Reject dialog:** inherits the screen's ConfirmDialog a11y (focus trap, labeled buttons).
- **Color independence:** see §4. The bookings-closed state and the sales-block are never hue-only.
- **One-handed reach:** Save controls sit at the BOTTOM of the accordion body, in the thumb zone; destructive-ish "Bookings closed" sits mid-body, requiring a deliberate reach (intentional friction). Aligns with Mingla's thumb-zone principle.

---

## 8. Per-platform deltas

| Concern | iOS | Android | Web preview |
|---|---|---|---|
| Glass surfaces (reason banner, sales info banner) | translucent `GlassCard variant="base"` (blur + `glass.tint.profileBase`) | **opaque ≥0.92 fallback** — handled INSIDE `GlassCard` (it already `Platform.select`s an opaque fill + `overflow:"hidden"` + zeroes Android elevation under the rounded fill). The component inherits the policy by USING `GlassCard`; do not hand-roll a `View` with translucent fill. Invariant `ANDROID_GLASS_USES_OPAQUE_FALLBACK`. | renders the iOS translucent path (acceptable for the adjacent preview) |
| Active accent shadow/glow (if any pill used) | iOS glow `shadowOpacity 0.35 radius 14` | `elevation: 0` under rounded fills (no hard rectangle) — intake `tabActive` precedent | n/a |
| `Switch` | iOS native switch (track colors apply) | Android Material switch (same `trackColor` map; thumb `#ffffff`) | RN-web switch fallback |
| Date/time picker inside `BookingDeadlinePicker` | iOS spinner | Android dialog | web input — ORCH-0875 already handles platform deltas; not re-specified here |

**No new tokens required.** Everything maps to existing `spacing` / `radius` / `accent` / `glass` / `semantic` / `text` / `typography` exports.

---

## 9. Build-ready handoff

**New component:** `mingla-business/src/components/trip/EditPublishedTripSettingsAccordion.tsx` — the Settings sibling of `EditPublishedTripIntakeAccordion.tsx`. Copy that file's skeleton (imports, `REASON_MIN`/`MAX`, reason-dialog state, `onSavePressed`/`onConfirmSave`/`onCloseReasonDialog`, `Toast`, `styles` for `container`/`saveWrap`/`reasonBanner`/`reasonInput`/`reasonButtons`/`reasonCancel/ConfirmCell`/`reasonCounter`/`reasonError`/`toastWrap`/`warningBanner`/`warningRow`/`warningText`) VERBATIM, then swap the tier-tab body for the three Settings blocks (§2).

**Props:**
```ts
interface EditPublishedTripSettingsAccordionProps {
  eventId: string;
  refundPolicy: RefundPolicy | null;          // from trip.refundPolicy
  bookingDeadline: string | null;             // ISO, from trip.bookingDeadline
  bookingsClosed: boolean;                     // from trip.bookingsClosed
  tripStartIso: string | null;                // from trip.businessTrip.startAt (BookingDeadlinePicker.tripStartIso)
  brandTimezone: string | null;               // trip timezone (BookingDeadlinePicker.brandTimezone)
  affectedOrderCount?: number;                // paid non-cancelled order count; >0 ⇒ sales-banner + block-aware copy
  onDirtyChange?: (dirty: boolean) => void;   // lifts dirtiness so the parent's editedSectionKeys badge fires for "settings"
  testID?: string;
}
```

**RN primitives / components reused:** `View`, `Text`, `TextInput`, `Pressable`, `Switch`, `Platform` (RN); `GlassCard`, `Button`, `Icon`, `Toast` (ui); `RefundPolicyEditor`, `BookingDeadlinePicker` (trip); `RefundPolicy` type (refundPolicyService).

**State:**
```ts
const [policy, setPolicy] = useState<RefundPolicy | null>(refundPolicy);
const [deadline, setDeadline] = useState<string | null>(bookingDeadline);
const [closed, setClosed] = useState<boolean>(bookingsClosed);
const dirty = policy !== refundPolicy /* deep-eq */ || deadline !== bookingDeadline || closed !== bookingsClosed;
```
Use a stable deep-equality check for `policy` (JSON.stringify compare is acceptable given the bounded ≤8-tier shape). Fire `onDirtyChange(dirty)` in an effect.

**Save wiring (the SPEC owns the exact service/RPC contract):** `onConfirmSave` calls the extended `updateLiveTripFields(eventId, patch, reason)` with `patch = { refund_policy, booking_deadline, bookings_closed }` carrying ONLY the dirty fields (omit unchanged keys so the RPC's favorable/unfavorable classifier only evaluates what changed). On `ok:true` → success Toast "Settings saved. Live now." + clear dirty. On `ok:false` → route the reason through the parent's `setRejectDialog` via a passed-in `onReject(result)` callback OR (simpler, matches intake) handle the four refund-class reasons locally by surfacing the §5 ConfirmDialog. The SPEC will lock which; design-wise either is acceptable as long as the §5 copy + "Open Orders" CTA appear.

**Parent change (`EditPublishedTripScreen.tsx`):** delete the entire read-only `case "settings"` JSX (the hint `Text` + 3 `settingsField` rows + the disabled `Switch`) and replace with `<EditPublishedTripSettingsAccordion ... />`; remove the now-dead `styles.settingsWrap/settingsHint/settingsField/settingsLabel/settingsValue` styles. Wire `onDirtyChange` into the existing `editedSectionKeys` set for the `"settings"` key so the header "Edited" badge behaves like every other section.

**What we are NOT doing (designer's brutal cut):** no new modal, no new motion language, no redesign of the ORCH-0875 editors, no light-mode variant, no bespoke skeleton. The whole win is: kill the lie, mount the two existing editors + a live switch, and reuse the intake accordion's proven reason-save-toast chassis plus the screen's proven reject-dialog chassis. Anything beyond that is scope creep and is cut.

---

## 10. Justification ledger (every element earns its place)

- **Refund policy leads** — it's money + buyer trust; highest consequence first.
- **Block help lines** — the planner is editing legal-ish terms; one plain sentence each prevents misconfiguration. Cut if Seth finds them noisy, but they're cheap insurance.
- **Sales info banner (proactive)** — prevents the "why is Save blocked?!" confusion BEFORE the planner wastes a reason-typing round. Earns its place only when sales>0; hidden otherwise.
- **Reason banner reuse** — the edit-log/reason contract is a hard server requirement (10–200 chars); reusing the intake chassis means zero new interaction to learn.
- **Reject dialog reuse** — the "Refund first" mental model already exists on this exact screen for capacity/dates/tiers; refund-policy/deadline blocks MUST feel identical or the planner won't connect them. Consistency = comprehension.
- **Live switch** — the single net-new control; designed as a labeled, consequence-hinted row, not a bare toggle, because flipping it stops revenue.
