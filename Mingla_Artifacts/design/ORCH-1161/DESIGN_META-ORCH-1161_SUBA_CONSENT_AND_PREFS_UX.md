# DESIGN — META-ORCH-1161 Sub-A — Consent Gates + Notification-Preferences UX

**ORCH:** META-ORCH-1161 Sub-A (notification foundation)
**Phase:** DESIGN (pixel-precise contract for mingla-implementor)
**Author:** mingla-designer
**Date:** 2026-06-19
**Canonical spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1161_NOTIFICATION_MESSAGING_SYSTEM.md` (v2; §5.1 data model, §5.2 seed, §8 compliance, §10 per-surface)
**Decisions:** `Mingla_Artifacts/DECISION_LOG.md` DEC-185 (simultaneous policy send) + DEC-186 (bundled mandatory consent; TCPA risk accepted; legal sign-off RECORDED 2026-06-19)
**Comms-ledger:** read on entry. No BLOCK directed at mingla-designer. COMMS-0040 / COMMS-0041 (WARN, ALL — RSVP/experience public-page standardization) factored: this design touches `buyer.tsx` (the CHECKOUT flow, not `PublicEventPage`/`RsvpPublicBody`), `AccountSettings.tsx`, and the OnboardingFlow `phone` substep — none of those are the public-page bodies being promoted into `packages/`, so there is no structural conflict. Noted for awareness only.

> ### COPY DEPENDENCY (hard, blocks implement of the exact strings)
> The **legal/consent COPY is owned by `mingla-product`** in a parallel task. This design specifies the LAYOUT, STATES, MOTION, TOKENS, and the EXACT BINDING POINTS where the disclosure string must be recorded into `consent_records.disclosure_text`. Every visible consent string below is a **`{COPY:product.<key>}` placeholder**. The implementor MUST NOT ship hand-written legal copy; it pulls the final strings from the mingla-product copy deliverable and wires the EXACT rendered string into the `consent_records` write (both scopes). See §6 "Consent-string binding contract."

---

## 0. The three surfaces (scope of this spec)

| # | Surface | File | What changes |
|---|---|---|---|
| **S1** | Consumer notification-preferences matrix | `app-mobile/src/components/profile/AccountSettings.tsx` (extend the Notifications `AccordionCard`, L694-777) | Replace the flat 5-toggle list with a per-CATEGORY × per-CHANNEL matrix (§5.2 seed): sections Purchases / Reservations / Reminders / Marketing / Social. |
| **S2** | Bundled mandatory consent gate — consumer OTP/consent onboarding | `app-mobile/src/components/OnboardingFlow.tsx` (the `phone` substep consent box, L2355-2397; CTA gate L2143) | Redesign the single consent checkbox to ONE mandatory bundled agreement (T&Cs + transactional + reminders + email marketing + SMS marketing); underlined "terms and conditions" opens a full-screen T&C view; cannot proceed until checked. |
| **S3** | Bundled mandatory consent gate — anon buyer checkout | `mingla-business/app/checkout/[eventId]/buyer.tsx` (marketing checkbox L550-574; bottom-bar Button L594-602; validation L152-177) | Name/email/phone become REQUIRED with validation; replace the marketing checkbox with an underlined "I agree to all terms and conditions" that opens a T&C sheet; Pay/Continue greyed out until checked AND fields valid. Web + web-phone responsive. |

Both S1 and S2 are **shared React Native** in `app-mobile` → **auto Android parity** (deltas in §7). S3 is `mingla-business` Expo Router rendered on **web + web-phone** (the public buyer checkout) → responsive deltas in §7.

---

## 1. Token foundations (the two design systems in play)

This work spans two token files. Every value below is a real token in the named file — do NOT introduce raw hex in components.

### 1A. Consumer app — `app-mobile/src/constants/designSystem.ts`
- **spacing:** `xxs 2 · xs 4 · sm 8 · md 16 · lg 24 · xl 32 · xxl 48`
- **radius:** `sm 8 · md 12 · lg 16 · xl 24 · full 999`
- **typography (fontSize / lineHeight):** `xs 12/16 · sm 14/20 · md 16/24 · lg 18/28 · xl 20/32 · xxl 24/36 · xxxl 32/48`
- **fontWeights:** `regular 400 · medium 500 · semibold 600 · bold 700`
- **colors.primary:** `500 #f97316 · 600 #ea580c · 700 #c2410c` (note: AccountSettings hand-codes the brand orange as `#eb7825`; see §1C)
- **colors.text:** `primary #111827 · secondary #4b5563 · tertiary #6b7280 · inverse #ffffff`
- **colors.gray:** `200 #e5e7eb · 500 #6b7280 · 900 #111827`
- **colors.success.500 #22c55e · colors.error.500 #ef4444**
- **Checkbox** (`ui/Checkbox.tsx`): 20×20, radius 4, border 2 `#d1d5db`; checked fill+border `#eb7825`; inner check 10×10 radius 2 `#ffffff`. Sizes via `size` prop; `disabled` → reduced opacity.
- **Toggle** (`profile/Toggle.tsx`): track 48×28 radius 14; thumb 22×22 radius 11 `#ffffff` (shadow y1 blur2 α0.15); ON track `#eb7825`, OFF track `#d1d5db`; thumb translateX 0→20 over **200ms `Easing.out(Easing.cubic)`**; `disabled` → opacity 0.5; hitSlop 8 all sides.

### 1B. Business app / buyer web — `mingla-business/src/constants/designSystem.ts`
- **spacing:** `xxs 2 · xs 4 · sm 8 · md 16 · lg 24 · xl 32 · xxl 48`
- **radius:** `sm 8 · md 12 · lg 16 · xl 24 · xxl 28 · display 40 · full 999`
- **accent.warm #eb7825** · accent.border `rgba(235,120,37,0.55)`
- **text (dark surface):** `primary rgba(255,255,255,0.96) · secondary rgba(255,255,255,0.72) · tertiary rgba(255,255,255,0.52) · inverse #ffffff`
- **semantic:** `success #22c55e · warning #f59e0b · error #ef4444` (+ tints at α0.18)
- **glass.border.profileBase `rgba(255,255,255,0.08)`**
- Checkout host canvas: `#0c0e12` (near-black). Bottom bar: `rgba(12,14,18,0.94)`, top border `rgba(255,255,255,0.06)`.
- **Existing checkbox** (buyer.tsx local styles): box 22×22 radius `radiusTokens.sm` (8), border 1.5 `glass.border.profileBase`, transparent; checked fill+border `accent.warm`; inner check via `Icon name="check" size 14` color `textTokens.primary`.

### 1C. Brand-orange reconciliation (do NOT regress)
AccountSettings + Toggle + Checkbox all hard-code **`#eb7825`** as the brand action color (it predates this work and is the Mingla brand action color per `ariThread`/`userBubble` memory). The `colors.primary.500` token in the consumer system is `#f97316` (a sibling orange). **For S1 + S2, match the surrounding file: use the existing `#eb7825` literals already in AccountSettings/Toggle/Checkbox/`consentLink`'s `colors.primary[700]`.** Do not "fix" the orange to the token — that is out of scope and would visually drift this screen from the rest of settings. (The existing `consentLink` uses `colors.primary[700]` = `#c2410c`; keep that for S2 link styling — it's the established link treatment on that screen.)

---

# S1 — Consumer notification-preferences matrix

## S1.1 IA & flow

**The moment:** a user is in Settings → Notifications. Their intent is *control* — "stop texting me about X" or "I do want reminders." The cognitive task is **scanning + comparing** across categories and channels, so density is higher than a choosing screen but never a wall.

**Information hierarchy (top → bottom):**
1. **Master push toggle** (existing `push_enabled`) — the global push kill-switch, kept at the very top, unchanged in behavior (turning it off suppresses the PUSH column everywhere but never email/SMS — mirror §5.3 `can_send` semantics in the helper text).
2. **Five category SECTIONS** in this fixed order (matches §5.2 + urgency-first intent): **Purchases · Reservations · Reminders · Marketing · Social**.
3. Within each section, one **category ROW per seed category**, each showing only the **channels that category supports** (its `default_channels`) as small channel chips/toggles.

**Decision the user makes:** per (category, channel) — on or off. Writes a `notification_channel_prefs(user_id, category_key, channel, enabled)` row (absent row = `default_channels` default; §5.1).

**Flow:** single screen, no sub-navigation. Toggling is instant (optimistic, like the existing `updateNotifPref`). No save button.

**Progressive disclosure:** Sections render as **labeled groups inside the one existing Notifications `AccordionCard`** (do NOT add five new top-level accordions — that buries control and breaks the ORCH-1040 "first card at scroll offset 0" contract). The card stays one accordion; inside it, each section is a sub-group with a small section header.

## S1.2 Layout & spacing grid (4/8pt; reuse AccountSettings primitives)

Reuse the EXACT existing row primitives so this looks native to the screen: `styles.row` + `styles.rowMultiline`, `styles.rowLabelWrap`, `styles.rowLabel`, `styles.rowHint`, `styles.rowDivider`, and the `Toggle` component. New styles are additive.

**Card:** the existing Notifications `AccordionCard` (icon `notifications`, title from `t('settings:notifications.title')`). Card chrome unchanged: `styles.card` (white, radius 16, border `#e5e7eb`, `overflow:'hidden'`, shadow sm).

**Master push row (row 1, unchanged):**
- `styles.row + styles.rowMultiline`, `rowLabelWrap` → label `push_notifications` + hint `push_hint`, trailing `Toggle` bound to `push_enabled`.
- Below it: `styles.rowDivider`.

**Section group (repeat ×5):**
```
[section header row]            ← NEW: styles.prefSectionHeader
  [category row]                ← styles.row + rowMultiline
    label + hint  |  channel chips (right)
  rowDivider (between categories within a section)
  [category row] …
[section gap]                   ← styles.prefSectionGap (height 8) before next header
```

**NEW styles (add to the AccountSettings `StyleSheet`):**
```
prefSectionHeader: {
  paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
}
prefSectionHeaderText: {
  fontSize: 12, fontWeight: '700', color: '#9ca3af',
  letterSpacing: 0.6, textTransform: 'uppercase',
}            // matches the muted-caps section-label idiom used in buyer.tsx sectionLabel
prefCategoryRow: {                 // extends styles.row; channels sit on the right
  flexDirection: 'row', alignItems: 'flex-start',
  paddingVertical: 12, paddingHorizontal: 16, minHeight: 56,
}
prefChannelCluster: {              // the right-side channel controls
  flexDirection: 'row', alignItems: 'center', gap: 8,
  flexShrink: 0, marginLeft: 12, paddingTop: 2,
}
prefSectionGap: { height: 8 }
prefLockHint: {                    // tiny "Required" lock affordance
  flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4,
}
prefLockText: { fontSize: 11, color: '#9ca3af', fontWeight: '500' }
```

**Channel control choice — chip toggles, not full Toggles.** A full 48×28 `Toggle` per channel × up to 4 channels × ~13 categories is visual noise and blows the row width on small phones. Use a **compact channel chip**: a 44×44 tappable target (accessibility minimum) rendering a 28×28 rounded-square pill with the channel glyph, ON = filled `#eb7825` + white glyph, OFF = `#f3f4f6` fill + `#9ca3af` glyph, DISABLED/locked = `#f9fafb` fill + `#d1d5db` glyph + a 10px lock badge.
```
prefChip: {
  width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
}                                  // 44pt hit target (a11y)
prefChipInner: {
  width: 28, height: 28, borderRadius: 8,
  alignItems: 'center', justifyContent: 'center',
}
prefChipOn:   { backgroundColor: '#eb7825' }
prefChipOff:  { backgroundColor: '#f3f4f6' }
prefChipLocked: { backgroundColor: '#f9fafb' }
```
Channel glyphs (use the existing `Icon` set — SVG, never emoji): `inapp → 'notifications'`, `push → 'phone-portrait'` (or the bell-with-badge variant present in the set; fall back to `notifications-circle`), `email → 'mail'`, `sms → 'chatbubble'` (or `chatbox`). Icon size 16, color `#ffffff` (on) / `#9ca3af` (off) / `#d1d5db` (locked).

**Row anatomy (one category):**
```
[ rowLabelWrap (flex 1) ]                         [ prefChannelCluster ]
   rowLabel: "Purchase confirmations"               [chip inapp][chip push][chip email]
   rowHint:  "When your ticket or order is confirmed."
   (prefLockHint if any channel is locked): 🔒 "Always on"
```
Only the channels in that category's `default_channels` render as chips. A category with `{push,inapp,email}` shows 3 chips; one with `{push,inapp,email,sms}` shows 4.

## S1.3 Category → row content (data-driven from the seed)

The rows are driven by `notification_categories` filtered to the consumer (Explorer) sections, in seed order. Labels/hints are i18n keys under `settings:notifications.cat.*` (COPY owned by mingla-product for the user-facing category names; placeholders below).

| Section header | Category row (`category_key`) | Channels shown (chips) | Lock rule |
|---|---|---|---|
| **PURCHASES** | `buyer_purchase_confirmation` | inapp, push, email | transactional — email locked-on (legal receipt); inapp/push user-toggleable |
| | `waitlist_spot_open` | inapp, push, email, sms | transactional — all user-toggleable except inapp locked-on |
| | `buyer_refund_issued` | inapp, push, email, sms | transactional |
| | `buyer_order_cancelled` | inapp, push, email, sms | transactional |
| | `buyer_payment_failed` | inapp, push, email | transactional — email locked-on |
| **RESERVATIONS** | `buyer_reservation_confirmed` | inapp, push, email | transactional — email locked-on |
| | `buyer_reservation_changed` | inapp, push, email, sms | transactional |
| | `buyer_reservation_cancelled` | inapp, push, email, sms | transactional |
| | `waitlist_table_ready` | inapp, push, email, sms | transactional |
| **REMINDERS** | `buyer_event_reminder_24h` | inapp, push, email, sms | transactional |
| | `buyer_event_reminder_2h` | inapp, push, email, sms | transactional |
| | `buyer_reservation_reminder_24h` | inapp, push, email, sms | transactional |
| | `buyer_reservation_reminder_2h` | inapp, push, email, sms | transactional |
| **MARKETING** | `marketing_blast` | inapp, push, email, sms | marketing — ALL opt-OUT (default ON because DEC-186 auto-enrolls; user may turn any off here) |
| **SOCIAL** | `social_friend_request` | inapp, push, email | non-transactional — user-toggleable |
| | `social_collab_invite` | inapp, push, email | non-transactional |
| | `social_message`+`social_rsvp`+`social_other` (one combined "Messages & activity" row) | inapp, push | non-transactional |

> **Reminders density note:** 4 reminder categories with 4 chips each is the densest section. To avoid 4 near-identical rows, the implementor MAY collapse event + reservation reminders into **two rows** ("Event reminders", "Reservation reminders") each writing BOTH the `_24h` and `_2h` category prefs together (one chip toggles both buckets for that channel). **Design preference: collapse to 2 rows** — the 24h/2h split is a delivery detail, not a user mental model. Flagged as open question OQ-1 for Seth.

**Locked channel rule (legal):** for `is_transactional` categories whose policy includes `email`, the **email chip is LOCKED ON** (the legal receipt/confirmation channel — CAN-SPAM transactional is permitted and the user cannot opt out of a purchase receipt). `inapp` is always locked-on for every category (it's the free durable inbox, zero-cost, the system-of-record surface). `push` and `sms` are user-toggleable on every category. Marketing: nothing locked (full opt-out). Show the lock affordance via `prefLockHint` ("Always on") only ONCE per row if any chip is locked, plus the locked chip's lock badge.

## S1.4 States (every one designed)

- **Loading:** while `notification_channel_prefs` fetch is in flight (extend the existing `isLoadingNotifPrefs`). Render the section headers immediately (they're static) and a **skeleton chip cluster** per row: 3-4 chip-sized `#f3f4f6` rounded rects at 0.6 opacity with a 1200ms ease-in-out opacity pulse 0.4↔0.7 (reduced-motion: static 0.6). No spinner — skeletons prevent layout jump (perf rule 3). Chips are non-interactive while loading.
- **Empty (first-time, no rows yet):** there is no true empty state — absent rows mean "use category defaults," so every chip renders at its default ON/OFF immediately. The matrix is never blank.
- **Default (loaded):** each chip reflects `coalesce(pref.enabled, default)`. Transactional defaults ON; marketing defaults ON (DEC-186 auto-enroll); locked chips render ON+lock.
- **Press (chip):** scale to 0.92 over 90ms then back over 120ms (`Easing.out(quad)`); haptic `Haptics.impactAsync(Light)` on commit (mirror existing `updateNotifPref`). Optimistic flip immediately.
- **Saving:** optimistic — chip flips instantly. No per-chip spinner. On the underlying upsert, no visible blocker.
- **Error (save failed):** revert the chip to its prior value (mirror the existing `updateNotifPref` rollback) AND show a transient inline toast at the bottom of the card: `prefSaveErrorBar` — `#fef2f2` fill, `#fecaca` border, radius 12, `Icon "alert-circle" #dc2626 16`, text `#dc2626` 13/18 = `{COPY:settings.notifications.save_error}` ("Couldn't save that — tap to retry."). Tappable to retry the last write. Auto-dismiss after 4s. (Error-as-conversation principle.)
- **Locked chip tapped:** no state change; haptic `notificationAsync(Warning)` + a one-time inline hint bubble under the row: `{COPY:settings.notifications.locked_email}` ("Purchase receipts are always emailed.") — fades in 200ms, auto-dismiss 3s.
- **Master push OFF:** when `push_enabled` is false, every `push` chip across the matrix renders **dimmed + struck (opacity 0.4, non-interactive)** with a single explanatory hint under the master row: `{COPY:settings.notifications.push_master_off}` ("Push is off for the whole app. Turn it on to choose per-type push.") — mirrors `can_send` (a global push-off suppresses push only). Email/SMS chips stay live.

## S1.5 Motion
| Trigger | Property | Curve | Duration | Reduced-motion |
|---|---|---|---|---|
| Chip toggle ON→OFF | chip `backgroundColor` + glyph color crossfade | ease-in-out | 160ms | instant swap |
| Chip press | `scale` 1→0.92→1 | `Easing.out(quad)` | 90+120ms | none (instant) |
| Skeleton pulse | `opacity` 0.4↔0.7 | ease-in-out loop | 1200ms | static 0.6 |
| Error bar enter | `translateY` 8→0 + `opacity` 0→1 | spring (damping 18, stiffness 180) | ~300ms | opacity-only fade 200ms |
| Locked hint | `opacity` 0→1→0 | ease | 200ms in / 3s hold | same (no transform) |

## S1.6 Accessibility (S1)
- Each chip: `accessibilityRole="switch"` (NOT button), `accessibilityState={{ checked, disabled: locked }}`, `accessibilityLabel = "{channelName} for {categoryName}, {on|off}{, always on if locked}"`. Locked chips also set `accessibilityState.disabled=true`.
- Hit target 44×44 even though the visual chip is 28×28 (the `prefChip` wrapper provides it).
- Section headers: `accessibilityRole="header"`.
- Reading order: master push → section header → category label+hint → its chips left-to-right (inapp, push, email, sms).
- Contrast: `#ffffff` glyph on `#eb7825` = 3.0:1 (icon glyph, non-text, passes the 3:1 non-text minimum); off glyph `#9ca3af` on `#f3f4f6` = 2.3:1 — **bump the OFF glyph to `#6b7280` (4.0:1) so the channel is identifiable by more than fill state** (color-is-not-the-only-indicator rule: the glyph SHAPE already distinguishes channel; ON/OFF is fill + the a11y state). Locked chip glyph `#d1d5db` on `#f9fafb` is intentionally faint but the lock badge + "Always on" text carry the meaning non-visually.
- Dynamic Type: labels/hints already use fixed sizes; allow them to grow — rows are `minHeight` not fixed height, and `rowMultiline` already wraps. The chip cluster stays fixed; at the largest Dynamic Type, the cluster wraps below the label (set `prefCategoryRow` to `flexWrap:'wrap'` fallback at very large text via `useWindowDimensions`/`PixelRatio.getFontScale() > 1.4`).

---

# S2 — Bundled mandatory consent gate (consumer OTP/consent onboarding)

## S2.0 Ground truth (where the consent box actually lives)
The consent box is on the **`phone` substep** of `OnboardingFlow.tsx` (NOT the `otp` substep, and NOT the passive `OnboardingConsentStep.tsx` informational screen which is a later step). Today (L2355-2397) it is a single `Pressable` row: a `Checkbox` bound to `smsConsentChecked` + `consentText` with two inline links (Terms of Service, Privacy Policy) opening a `LegalBrowser` modal. The "Send code" CTA is already gated: `disabled: !isPhoneValid() || !smsConsentChecked` (L2143). **This is the exact gate DEC-186 wants — we are upgrading its COPY + presentation to be the ONE bundled mandatory agreement, and making the T&C link a full-screen view.**

## S2.1 IA & flow
**The moment:** the user has typed their phone number and is about to receive an OTP. This is the legal consent capture point — DEC-186 bundles T&Cs + transactional + reminders + email marketing + SMS marketing into ONE mandatory checkbox here.

**Hierarchy:** phone input (existing) → **bundled consent row** (redesigned) → "Send code" CTA (existing, stays gated).

**Decision:** check the box (mandatory). Cannot proceed (CTA stays disabled) until both phone valid AND box checked — already the code's behavior; keep it.

**Flow branch:** tapping the underlined "terms and conditions" opens a **full-screen T&C view** (the existing `LegalBrowser` modal, retitled and pointed at the bundled T&C URL). Reading is not required to check the box (checking is the affirmative act); the link is the disclosure access path for the legal record.

## S2.2 Layout & states (reuse existing `consentRow` primitives)
Keep the exact structure: `Pressable style={consentRow}` → `Checkbox` + `Text style={consentText}` with an inline underlined link. Only the COPY and the link target/treatment change.

- **`consentRow`** unchanged: `flexDirection row, alignItems flex-start, marginTop spacing.md (16)`.
- **`Checkbox`** unchanged (20×20, `#eb7825` checked).
- **`consentText`** unchanged base: `typography.sm (14/20)`, `colors.text.tertiary #6b7280`, `flex 1`, `marginLeft spacing.sm (8)`.
- **Underlined link treatment (NEW for the "terms and conditions" span):** keep `consentLink` color `colors.primary[700] #c2410c` + `fontWeight medium`, and ADD `textDecorationLine: 'underline'` (the task explicitly requires the link underlined; the current ToS/Privacy links are not underlined). Define:
```
consentLinkUnderlined: { color: colors.primary[700], fontWeight: '500', textDecorationLine: 'underline' }
```

**Copy structure (placeholder — mingla-product owns the verbatim string):**
> `{COPY:onboarding.consent.bundled_prefix}` By continuing, you agree to Mingla's `[terms and conditions]`(underlined link) and consent to receive account & booking updates, event reminders, and marketing by email and text. Msg & data rates may apply. Reply STOP to opt out. `{COPY:onboarding.consent.bundled_suffix}`

The "terms and conditions" span is the underlined link. (Per DEC-186/§8.6 the disclosure must surface: Mingla identity + agree to marketing texts + reminders + transactional + expected frequency + "Msg & data rates may apply" + STOP/HELP + link to full T&Cs. The visible row carries the short form; the full T&C view carries the long form. BOTH the rendered visible string AND the full T&C reference are what bind into `consent_records.disclosure_text` — see §6.)

### States
- **Unchecked (default):** box empty (`#d1d5db` border, transparent), CTA "Send code" **disabled** (Button disabled styling — the existing primary button at reduced opacity per its own disabled state; `disabled: !isPhoneValid() || !smsConsentChecked`).
- **Checked:** box `#eb7825` filled + white check; if phone also valid, CTA enabled (full `#eb7825` / `colors.primary[500]`-family, full opacity, pressable). Haptic Light on check.
- **Disabled-continue (phone invalid but box checked, or vice-versa):** CTA stays disabled; no error shouting (touched-flag pattern). If the user TAPS the disabled CTA region, surface the phone error (existing `phoneError`) — do not silently dead-tap.
- **T&C view open:** full-screen `LegalBrowser` modal (existing). Title = `{COPY:onboarding.consent.tc_title}` ("Terms & Conditions"). A clear close affordance (existing modal chrome). Pointed at `LEGAL_URLS.termsOfService` (or a new bundled `LEGAL_URLS.bundledTerms` if mingla-product provides a combined doc).
- **Pressed (row):** the `Pressable` toggles the box; standard `activeOpacity`-equivalent (the row has no explicit pressed style today — add `opacity 0.7` on press for affordance parity with the checkout checkbox).

## S2.3 Motion (S2)
- Checkbox check: the existing `Checkbox` has no entrance animation; ADD a 120ms scale-pop of the inner check (0.6→1, `Easing.out(back)` mild overshoot) + Light haptic. Reduced-motion: instant.
- CTA enable transition: when it flips disabled→enabled, crossfade the button fill opacity over 180ms ease-out (no layout change). Reduced-motion: instant.

## S2.4 Accessibility (S2)
- Row `accessibilityRole="checkbox"`, `accessibilityState={{ checked: smsConsentChecked }}`, `accessibilityLabel = {COPY:onboarding.consent.a11y}` (must read the full agreement intent, not just "checkbox").
- The underlined link span: `accessibilityRole="link"`, label `{COPY:onboarding.consent.tc_link_a11y}` ("Open terms and conditions").
- CTA disabled state exposes `accessibilityState={{ disabled: true }}` so screen readers announce it's not yet actionable, and the label hints why when tapped.
- Contrast: `consentText #6b7280` on the warm-white onboarding canvas (`#fff9f5`/white) = 4.6:1 (passes AA for 14px). Underlined link `#c2410c` on white = 5.9:1 (passes); underline guarantees color-is-not-the-only-indicator.

---

# S3 — Bundled mandatory consent gate (anonymous buyer checkout)

## S3.1 IA & flow
**The moment:** an anonymous buyer is about to pay for a ticket/RSVP. DEC-186: name/email/phone become REQUIRED, and ONE mandatory "I agree to all terms and conditions" gates the Pay button. The buyer's intent is to **complete a purchase fast**; friction must be minimal and the gate must feel like standard checkout consent, not a wall.

**Hierarchy (existing order, kept):** order summary → Name* → Email* → Mobile number* → **bundled T&C agreement** (replaces the marketing checkbox) → sticky bottom bar (Total + Pay/Continue).

**Decision:** fill 3 required fields + check the box. Pay/Continue is **greyed out until the box is checked AND all fields valid**.

**Flow branch:** tapping the underlined "all terms and conditions" opens a **T&C sheet** (bottom sheet on web-phone, centered modal/sheet on wide web).

## S3.2 Required fields (name/email/phone)
Today name+email+phone already render with a red `*` (`styles.required`, `semantic.error #ef4444`) and `validate()` already requires all three for `isValid` (L162-176, `nameValid && emailValid && phoneValid`). **So the "make them required" work is largely present** — the visible asterisks and validation exist. Confirm:
- Name: `fieldLabel "Name"` + `required *`; error `"Please enter your full name"` shown after blur (`visibleErrors.name`). Keep.
- Email: same pattern; error `"Enter a valid email"`. Keep.
- Mobile: `PhoneInput` with `error={visibleErrors.phone}`. Keep.
- **Validation error visual:** `styles.errorText` — `marginTop 6, fontSize 12, color semantic.error #ef4444, fontWeight 500`. Keep. Touched-flag gating stays (don't scream on fresh mount).

**No change needed to field requiredness/validation logic** beyond ensuring `validation.isValid` continues to require all three (it does). The NEW gate is the consent checkbox AND-ed into the Pay enable condition (§3.4).

## S3.3 Replace marketing checkbox → bundled T&C agreement (L550-574)
Replace the `Pressable` marketing-opt-in block with a structurally identical agreement row, new copy + underlined link + sheet trigger. Reuse the existing checkbox styles exactly (`checkboxRow`, `checkboxBox` 22×22 radius 8 border 1.5 `glass.border.profileBase`, `checkboxBoxChecked` fill `accent.warm`, inner `Icon "check" size 14 textTokens.primary`, `checkboxLabel` 14/20 `textTokens.secondary`).

**New state:** rename `marketingOptIn` → `termsAccepted` (boolean) in cart/buyer state (the implementor wires the rename; the persisted field becomes the consent-grant signal, recorded into `consent_records` both scopes per §6). DEFAULT `false` (mandatory affirmative act).

**Layout:**
```
<Pressable style={[checkboxRow, pressed && checkboxRowPressed]}
           accessibilityRole="checkbox"
           accessibilityState={{ checked: termsAccepted }}>
  <View style={[checkboxBox, termsAccepted && checkboxBoxChecked]}>
     {termsAccepted ? <Icon check 14 textTokens.primary/> : null}
  </View>
  <Text style={checkboxLabel}>
     {COPY:checkout.consent.prefix} I agree to{' '}
     <Text style={checkboxLinkUnderlined} onPress={openTermsSheet} accessibilityRole="link">
        all terms and conditions
     </Text>
     . {COPY:checkout.consent.suffix}
  </Text>
</Pressable>
```
**NEW style:**
```
checkboxLinkUnderlined: {
  color: accent.warm,            // #eb7825 — link affordance on the dark checkout canvas
  fontWeight: '600',
  textDecorationLine: 'underline',
}
```
Rationale for accent.warm (not white): on the dark `#0c0e12` canvas the underlined link must be visually distinct from the `textTokens.secondary` label; warm-orange + underline gives two non-color affordances. Contrast `#eb7825` on `#0c0e12` = 5.4:1 (passes AA).

**Copy (placeholder — mingla-product owns verbatim):**
> `{COPY:checkout.consent.body}` I agree to `[all terms and conditions]`(underlined) and consent to receive booking confirmations, reminders, and marketing for this event and Mingla by email and text. Msg & data rates may apply. Reply STOP to opt out.

## S3.4 Pay/Continue gating (L594-602)
Today: `disabled={!validation.isValid || submitting}`. **Change to:** `disabled={!validation.isValid || !termsAccepted || submitting}`.
- **Disabled (incomplete):** the existing `Button variant="primary" size="lg" fullWidth` renders its built-in disabled treatment (reduced opacity / muted fill per the Button component). The button label stays `continueLabel` (free → "Reserve"/"Continue"; paid → "Pay" / pay-amount label). Keep.
- **Enabled (complete):** full `accent.warm` primary, full opacity, pressable.
- **Loading:** `loading={submitting}` (existing) — spinner in button, disabled.
- **Disabled tap → no dead tap:** if the buyer taps the disabled button, mark all fields touched (existing `handleContinue` already does `setAllTouched`-equivalent so errors render) AND if fields are valid but the box is unchecked, scroll the consent row into view + a 1-shot pulse on the checkbox border (`#ef4444` flash 400ms then back) + inline helper under the row: `{COPY:checkout.consent.must_agree}` ("Please agree to continue."). This is the ONLY way to communicate "you missed the box" — never a silent dead button.

**NEW helper style:**
```
consentRequiredHint: { marginTop: 6, fontSize: 12, color: semantic.error, fontWeight: '500' }
```

## S3.5 T&C sheet (the underlined-link target)
Open a sheet showing the full T&Cs. Reuse the existing `GlassCard`-based sheet idiom already imported in buyer.tsx, OR a standard bottom-sheet. Spec:
- **Web-phone (< 600px):** bottom sheet, full-width, max-height 85vh, slides up. Radius top `radiusTokens.xl (24)`, fill near-opaque dark `rgba(18,20,26,0.98)` (NOT translucent — readable legal text), drag handle 36×4 `rgba(255,255,255,0.3)` at top, close X top-right (44×44 hit). Scrollable body, `textTokens.secondary` 14/22.
- **Wide web (≥ 600px):** centered modal, width `min(560px, 92vw)`, max-height 80vh, radius `radiusTokens.lg (16)`, scrim `rgba(0,0,0,0.6)`. Same content.
- **Title:** `{COPY:checkout.consent.tc_title}` ("Terms & Conditions"), 17/700 `textTokens.primary`, sticky top of sheet.
- **Footer (optional but recommended):** a sticky "I agree" button at the bottom of the sheet that, when tapped, checks the box AND closes — a faster path than reading-then-hunting-the-checkbox. Secondary "Close" dismisses without checking. (Progressive-disclosure + thumb-zone primary action.)
- Reading the sheet is NOT required to check the box; the sheet is the disclosure access path.

## S3.6 Country capture (§10 requirement)
§10 requires buyer **country** capture at checkout for `consent_records.country_code`. The `PhoneInput` already carries a `countryCode` (`phoneCountry`) — **derive `consent_records.country_code` from the phone country ISO** (no extra field; minimal friction). The design adds NO visible country field; the implementor maps `phoneCountry` → ISO-2 into the finalize RPC consent write. (If product later wants an explicit billing country, that's a separate field — out of scope here.)

## S3.7 States summary (S3)
| State | Pay button | Consent box | Fields |
|---|---|---|---|
| Fresh mount | disabled | unchecked | empty, no errors (touched=false) |
| Typing, incomplete | disabled | unchecked | errors only after blur |
| Fields valid, box unchecked | disabled | unchecked | valid |
| Tap disabled Pay (box unchecked) | stays disabled | border flashes red 400ms + helper "Please agree to continue." | valid |
| All valid + checked | ENABLED (full accent.warm) | checked (filled + check) | valid |
| Submitting | disabled + spinner | checked | locked |
| Submit error | enabled again | checked | `submitError` shown via existing `errorText` |

## S3.8 Motion (S3)
| Trigger | Property | Curve | Duration | Reduced-motion |
|---|---|---|---|---|
| Box check | inner check scale 0.6→1 | `Easing.out(back)` | 120ms | instant |
| Pay enable | button fill opacity | ease-out | 180ms | instant |
| Disabled-Pay tap (box unchecked) | checkbox border color `#ef4444`↔base + 1 shake (translateX ±4) | ease | 400ms | color flash only, no shake |
| T&C sheet enter (web-phone) | `translateY` 100%→0 | spring (damping 22, stiffness 220) | ~320ms | opacity fade 200ms |
| T&C modal enter (wide web) | `opacity` 0→1 + `scale` 0.96→1 | ease-out | 200ms | opacity only |

## S3.9 Accessibility (S3)
- Consent row: `accessibilityRole="checkbox"`, state checked, label = full agreement intent (`{COPY:checkout.consent.a11y}`).
- Underlined link: `accessibilityRole="link"`, label "Open all terms and conditions".
- Pay button: `accessibilityState={{ disabled }}`; when disabled, an `accessibilityHint` states what's missing ("Complete all fields and agree to terms to continue").
- T&C sheet: focus moves into the sheet on open (web focus trap), Escape/back closes, focus returns to the link on close. Scrim tap closes (web).
- Required fields: each input `accessibilityLabel` includes ", required" (already present for email/phone; add for name).
- Web keyboard: the consent link + checkbox are tab-focusable with a visible focus ring (`outline: 2px solid #eb7825` on web; RN web respects `:focus-visible`). Pay button focusable.
- Contrast: error `#ef4444` on `#0c0e12` = 5.0:1 (passes). `checkboxLabel #b3b3b3-equiv (rgba white .72)` on `#0c0e12` ≈ 9:1 (passes).

---

## 6. Consent-string binding contract (where the EXACT disclosure is recorded)

This is the load-bearing legal requirement (DEC-186 / §8.1 / §8.6). At EVERY grant, the **exact rendered visible disclosure string** (the composed final copy the user actually saw, after i18n interpolation) MUST be written verbatim into `consent_records.disclosure_text`, for BOTH a `scope='transactional'` row AND a `scope='marketing'` row.

| Surface | Grant trigger | What binds into `consent_records.disclosure_text` | `source` | Extra columns |
|---|---|---|---|---|
| **S2 consumer onboarding** | `smsConsentChecked === true` at the moment "Send code" succeeds / phone verified | The fully-rendered `consentText` string (prefix + "terms and conditions" link text + interpolated suffix) — the EXACT i18n-resolved string, not the key. PLUS a stored reference to the full T&C version/URL shown behind the link. | `'prefs_ui'`→ use `'checkout'`-style? → **`source='reservation'` is wrong here; use a new allowed value or `'prefs_ui'`.** NOTE: §5.1 `consent_records.source` enum lists `'checkout' \| 'prefs_ui' \| 'stop_keyword' \| 'unsubscribe_link' \| 'reservation'`. **Onboarding signup is none of these** — flag to forensics/implementor: add `'onboarding'` to the source CHECK, or reuse `'prefs_ui'`. (OQ-2.) | `user_id` (the just-created user), `contact` = E.164 phone + lowercased email, `country_code` from phone ISO, `ip_hash` (mobile: may be null or device-derived — null acceptable). |
| **S3 buyer checkout** | `termsAccepted === true` at finalize (the finalize RPC consent write, §10) | The fully-rendered `checkboxLabel` string (prefix + "all terms and conditions" + suffix), EXACT resolved text. PLUS the T&C sheet version/URL reference. | `'checkout'` | `user_id` NULL (anon) → `contact` = E.164 phone + lowercased email; `country_code` from `phoneCountry` ISO; `ip_hash` = hashed request IP (web — available server-side at finalize). |

**Implementation note for the implementor:** the visible copy lives in i18n; the binding requires capturing the RESOLVED string at grant time (not the key) and passing it through to the consent write. For S3, the finalize RPC receives `disclosure_text` as a parameter computed client-side from the exact rendered label (or, more robustly, the server composes it from a versioned `disclosure_versions` table keyed by a `disclosure_version` the client sends — RECOMMENDED so the legal record can't be spoofed/drifted by a stale client). **Design recommendation: a `disclosure_version` string is sent from each surface; the server stores both the version and the resolved text.** This is the legal burden-of-proof artifact backing the risk-accepted bundling (R-8).

---

## 7. Per-platform deltas

### S1 + S2 (consumer RN — `app-mobile`)
- **iOS:** as specified. Card shadow (sm) renders.
- **Android (auto via shared RN):** the AccountSettings `card` already follows the ANDROID GLASS / opaque-fallback policy — opaque white `#ffffff` fill + `overflow:'hidden'` clip + the existing shadow is a real drop-shadow on an opaque card (acceptable; not a translucent glass surface, so the opaque-fallback policy is already satisfied — do NOT add Android `elevation` tweaks here). The chips are opaque fills (`#eb7825`/`#f3f4f6`) — no glass, no Android delta needed. Haptics: `expo-haptics` maps to Android vibration.
- **No glass is introduced by this work** → the `ANDROID_GLASS_USES_OPAQUE_FALLBACK` invariant is not triggered (nothing translucent added). State this explicitly in the implementation report.

### S3 (buyer web + web-phone — `mingla-business`)
- **Web-phone (< 600px):** the sticky bottom bar (`bottomBar`, absolute, `rgba(12,14,18,0.94)`) stays; consent row sits in the scroll body above it. T&C = bottom sheet. The existing `bottomBarHidden` (translateY 200 when keyboard up) behavior is preserved.
- **Wide web (≥ 600px):** the checkout is a centered column (max content width ~560px). T&C = centered modal. The sticky bottom bar may become a non-sticky footer at very wide widths if the existing layout does so — match whatever the current checkout does; do not regress.
- **Web focus/keyboard:** visible focus rings on link, checkbox, Pay (RN-web `:focus-visible` → 2px `#eb7825` outline). The other two surfaces are native (no hover/focus-ring concern).
- **No hover-induced layout shift:** the consent link hover (web) changes only color/underline emphasis, never layout (perf rule 3).

---

## 8. Cross-surface declaration

- **Shared (single source of truth):** the `consent_records` write contract (§6) is identical in shape across S2 and S3 — both write a transactional + a marketing row with `disclosure_text`. The category seed (§5.2) is the single source for S1's rows; S1 must render exactly the seed's `default_channels` per category (no hardcoded channel lists in the component — read from `notification_categories`).
- **Reused primitives:** S1 reuses AccountSettings `row`/`rowDivider`/`rowLabel`/`rowHint` + `Toggle` (master only) + `Icon` + `Checkbox` (consumer). S2 reuses `consentRow`/`consentText`/`Checkbox`/`LegalBrowser`. S3 reuses `checkboxRow`/`checkboxBox`/`Button`/`Input`/`PhoneInput`/`GlassCard`/`Icon`.
- **NEW reusable token:** an underlined-link text style appears on all three surfaces. Recommend the implementor add `textDecorationLine:'underline'` variants co-located in each file (consumer: `consentLinkUnderlined`; business: `checkboxLinkUnderlined`) rather than a shared package (the two design systems differ). No new global token required.
- **Brand orange consistency:** `#eb7825` is the action/link color on S1 (chips), S3 (link + checkbox); S2 link uses `colors.primary[700] #c2410c` (the established settings link color on that screen). This is intentional — match each screen's existing idiom (§1C).
- **Parity:** S1+S2 are shared RN → Android parity is automatic. S3 is web/web-phone only (the consumer-app native checkout already removed the tax form per ORCH-1130/1147 and uses a different consent path — NOT in this Sub-A scope; the §10 "native checkout manual parity" note applies to a future leg, not this design).

---

## 9. Build-ready handoff summary

**Files + anchors:**
- S1: `app-mobile/src/components/profile/AccountSettings.tsx` — extend the Notifications `AccordionCard` (L694-777); add the listed `pref*` styles to the `styles` block (L1191+); add a `notification_channel_prefs` fetch + per-(category,channel) upsert helper mirroring `updateNotifPref`/`isLoadingNotifPrefs`; read categories from `notification_categories`.
- S2: `app-mobile/src/components/OnboardingFlow.tsx` — update the `phone`-substep consent block (L2355-2397) copy + underlined-link treatment + full-screen T&C target; keep the CTA gate (L2143); on grant, write `consent_records` (both scopes, §6).
- S3: `mingla-business/app/checkout/[eventId]/buyer.tsx` — replace the marketing checkbox (L550-574) with the bundled T&C agreement; rename `marketingOptIn`→`termsAccepted`; AND it into the Pay disable (L601); add T&C sheet; add disabled-tap helper + flash; map `phoneCountry`→`country_code`; finalize RPC writes `consent_records` (both scopes + `disclosure_text` + `ip_hash` + `country_code`).

**Existing tokens used:** all listed in §1 (no new global tokens). New component-local styles enumerated in §S1.2, §S2.2, §S3.3-3.5.

**Copy:** ALL user-facing strings are `{COPY:*}` placeholders owned by mingla-product. The implementor binds the RESOLVED strings into `consent_records.disclosure_text` per §6 (recommend a `disclosure_version` sent from each surface + server-side versioned storage).

---

## 10. Open design questions for Seth
- **OQ-1 (Reminders density):** collapse the 4 reminder categories into 2 user-facing rows ("Event reminders", "Reservation reminders", each toggling its 24h+2h buckets together)? **Design recommendation: YES** (the 24h/2h split is a delivery detail, not a user mental model).
- **OQ-2 (consent source enum):** `consent_records.source` (§5.1 CHECK) has no `'onboarding'` value, but S2 grants at signup. Add `'onboarding'` to the CHECK, or reuse `'prefs_ui'`? **Design/forensics handoff — recommend adding `'onboarding'`** for a clean audit trail. (Affects the migration, not the UI.)
- **OQ-3 (T&C "I agree" footer in the sheet):** include a sticky "I agree" button inside the S3 T&C sheet that checks the box + closes (faster path)? **Recommendation: YES.**
- **OQ-4 (disclosure versioning):** adopt a server-side `disclosure_version` + versioned-text store so the legal record can't drift with a stale client? **Recommendation: YES** (strengthens the R-8 burden-of-proof artifact).
