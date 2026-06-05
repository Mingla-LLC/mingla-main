# DESIGN SPEC — META-ORCH-1074 Sub-C [Business notification inbox]

**Date:** 2026-06-04
**Mode:** SCREEN + COMPONENT (design only — no code)
**Skill:** mingla-designer
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1074-[business-notifications]/` on branch `META-ORCH-1074-business-notifications`
**Consumes:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1074_BUSINESS_NOTIFICATIONS.md` §5 (Sub-C), §6 (Sub-D copy/defaults)
**Feeds:** mingla-implementor (Sub-C build), Sub-D copy authoring (voice already drafted here per the SPEC matrix)
**Comms-ledger:** read on entry. COMMS-0019 is this ORCH's own renumber entry (already acked by the orchestrator). No BLOCK/WARN row targets `mingla-designer` or requires action from this design turn. No new cross-ORCH discovery this turn.

> **Scope note (v1):** 11 notification types. `business.new_follower` is **DROPPED from v1** per the dispatch (followers have no data source — SPEC §7 Q2). It is NOT designed here. The 11 live types are: `order_paid`, `event_sold_out`, `refund_processed`, `dispute_opened`, `dispute_action_needed`, `payout_paid`, `account_status_changed`, `new_review`, `claim_decision`, `low_inventory`, `team_member_joined` — plus the 9 existing `stripe.*` compliance types that already write rows and ride the same inbox.

---

## References examined

Studied before designing — these are the moment-specific premium references for an operator-facing notification inbox (money + risk + ops), NOT a consumer social feed:

- **Stripe Dashboard mobile (iOS/Android) activity hub** — groups operator notifications into *payouts / account changes / refunds / disputes*, push-driven daily summary + dispute alerts with an inline quick-action (complete refund). Validates the Money/Risk category split and the "needs-attention, not alarmist" risk treatment. (docs.stripe.com/dashboard/mobile, support.stripe.com/topics/mobile-app)
- **Square / Shopify Point-of-Sale + admin mobile inboxes** — leading category icon in a tinted circle, one-line bold title with the entity (amount / order #) emphasised, two-line body, right-aligned relative time, left unread rail, date-bucketed sections (Today / Earlier). This is the operator-inbox card grammar I synthesise from — dense enough to scan a payout history, calm enough not to feel like an alarm panel.
- **Linear / Height notification center** — restrained mono-accent unread treatment (a single hairline rail or dot, never a saturated card flood), "mark all read" as a quiet text affordance not a loud button, skeleton rows that match the real row geometry exactly.
- **Mingla consumer `NotificationsSheet.tsx` (ORCH-0975)** — the in-house quality bar: ringed avatar/icon, date grouping, unread amber ring, relative time, skeleton + empty + error + offline states, bold-actor title, `prefers-reduced-motion` discipline. I match its *rigor* and reuse its grouping/state machine, but **re-skin to the business app's dark premium-glass language** (the consumer sheet is a light canvas; business is a near-black `#0c0e12` canvas with frosted glass cards).

Synthesis, not clone: the consumer sheet is a *social* feed (avatars, accept/decline). The business inbox is an *operator* feed — no avatars, money/risk-first iconography, no inline accept/decline (every row deep-links into the real surface where the action lives). I keep the date-bucket + state machine, drop the social affordances, and add a 4-family category accent system the consumer feed doesn't have.

---

## 0. The moment (IA first)

A brand owner opens this because **something happened to their money, their listing, or their team** — and they need to know "is this good news or a problem, and what do I do next." The inbox is a *triage surface*, not a destination. Three jobs, in priority order:

1. **Reassure** — money landed, a ticket sold, the event sold out. (Most rows. Calm, positive.)
2. **Alert** — a dispute opened, payouts paused, evidence is due. (Rare, high-stakes. Must surface without crying wolf.)
3. **Inform** — a review came in, a teammate joined. (Background. Quiet.)

Design consequence: **the category accent does the triage**, the copy confirms it, and **every row is a doorway** (tap → the real screen). The inbox never asks the user to *act inside it* — it routes. This is the single most important divergence from the consumer feed and it drives the whole card design.

---

## 1. Surface — full route reached from the bell (NOT a sheet)

**Decision: a full-screen expo-router route at `app/notifications.tsx`** mounting an upgraded `BusinessNotificationsScreen`, reached by `router.push("/notifications")` from the TopBar bell. **Not a bottom sheet.** (Resolves SPEC §5.C.1 OPEN and §7 Q4 in favour of the route.)

**Justification (against the business app's nav reality):**

- **Web-preview parity (the deciding factor).** Surface 7 in the SPEC's cross-surface table requires the inbox to work on the business web export. A full route renders identically on web (a normal page with a back affordance); a gorhom bottom-sheet is a mobile-idiom that reads as an awkward floating panel on a 1024px-wide desktop. The business app already ships `.web.tsx` route variants (connect-* pages) — a route is the native-grain choice for an app that must work on web.
- **The 5-tab capsule + TopBar is a navigation shell, not a deck.** The consumer app overlays a sheet because its Home is a swipe deck the user must not lose. The business Home/Hub are *scrollable document screens*; pushing a route over them and popping back loses nothing. A route gets a real back gesture (iOS edge-swipe, Android system back, web browser-back) for free.
- **Depth fits the content.** A brand can accumulate dozens of money/payout/dispute rows; a full route gives the list the full viewport + safe scrolling without fighting a sheet's snap points or the floating bottom-nav capsule overlap the consumer sheet has to special-case (`tabBarAware`).
- **The settings screen is already a route** (`app/account/notifications.tsx` with its own `chromeRow` back affordance) — a route inbox is consistent with the app's own pattern for "notification surfaces."

### 1.1 Route chrome, entry, exit

- **Header:** a `back`-variant TopBar pattern, but to honour I-37 + the bell living in the *default* cluster, use the existing lightweight `chromeRow` pattern from `account/notifications.tsx` (a `close`/`chevL` IconChrome left + centred title) rather than the brand TopBar. **Left:** `IconChrome icon="chevL"` (or `close` on web where there's no back stack), 36×36 (44pt effective via baked hitSlop), `accessibilityLabel="Back"`. **Center title:** "Notifications", `typography.h3` (20/32, 600), `text.primary`, `letterSpacing -0.2`, centred. **Right:** the **Mark all read** affordance (see §4.3) when `unreadCount > 0`, else a 36-wide spacer `View` for balance (mirror `chromeRightSlot`).
- **Canvas:** `backgroundColor: canvas.discover` (`#0c0e12`) — the business app's standard dark screen floor, matching the settings route. The list scrolls on this floor; cards are the frosted-glass surfaces (§3).
- **Entry motion:** default expo-router push — horizontal slide-in from the right (iOS), shared-axis-X on Android. 260ms (`durations.entry`), `easings.out`. No custom transition needed; the platform default reads as "I went somewhere."
- **Exit motion:** pop (slide-out right / back). Marking-read state persists (it's server-backed), so returning later shows the read state already applied.
- **Safe area:** `paddingTop: insets.top` on the host (mirror settings route); list `contentContainerStyle.paddingBottom = insets.bottom + spacing.xl` (32). The route **hides the bottom-nav capsule** is NOT required — but because this is a pushed route over `(tabs)`, the capsule does not render on a non-tab route (the `(tabs)/_layout` only mounts BottomNav for tab routes). So **no capsule overlap to manage** — a clean advantage over the consumer sheet.

---

## 2. Category system — 4 families (Money / Risk / Audience / Team & Listing)

The 11 types collapse into **four visual families**. Each family owns one **accent color**, one **leading-icon metaphor**, and one **emphasis weight**. This is the triage layer — a brand reads the *color + icon* before the words.

| Family | Types | Accent | Leading icon (per type) | Emphasis | Severity |
|---|---|---|---|---|---|
| **Money** | order_paid, payout_paid, refund_processed, event_sold_out, low_inventory | **Warm brand** `accent.warm #eb7825` (the only family on the brand color — money *is* the business) | order_paid → `cash`; payout_paid → `bank`; refund_processed → `refund`; event_sold_out → `ticket`; low_inventory → `flash` | Normal (positive). low_inventory carries a soft nudge tint. | info (low_inventory = warning) |
| **Risk** | dispute_opened, dispute_action_needed, account_status_changed | **Amber** `semantic.warning #f59e0b` (NOT red — see §2.1) | dispute_opened → `shield`; dispute_action_needed → `flag`; account_status_changed → `shield` (or `bank` when payments-related) | Elevated — amber ring + bolder title. action_needed is the single loudest row. | warning / blocking |
| **Audience** | new_review | **Gold/star** `#f59e0b` star-context (reuse warning hue but star icon reframes it as positive) | new_review → `star` | Normal (positive) | info |
| **Team & Listing** | team_member_joined, claim_decision | **Info blue** `semantic.info #3b82f6` | team_member_joined → `users`; claim_decision → `check` (approved) / `flag` (rejected) | Normal | info |

Plus the existing **`stripe.*`** compliance types map onto **Risk** (kyc/payout-failed/deauth/bank/restricted = Risk amber) or **Money** (`stripe.refund_processed` = Money), driven by their existing `severity` field in `stripeNotificationTemplates.ts` (`blocking`/`warning` → Risk amber; `info` → Money/neutral). One mapping function, no per-stripe-type bespoke design.

### 2.1 Why Risk is amber, never red (the "needs-attention without alarmist" rule)

Red (`semantic.error #ef4444`) reads as *failure / destructive / you broke something*. A dispute or an account-restriction is **a deadline, not a catastrophe** — the brand can win the dispute, can fix the verification. Amber says "look here, there's a clock running" without the cortisol spike of red. **Red is reserved exclusively for the inbox's own error state** (couldn't-load), so the brand learns: amber = a thing about your account; red = the app itself failed. This separation is load-bearing.

The single exception in *weight* (not color): `dispute_action_needed` and `blocking`-severity stripe rows get the **amber left rail at full width + a one-word amber chip** ("Action needed" / "Due {date}") so the one row that genuinely needs a tap today is unmissable in a scroll of green-tinted good news. It is still amber, still calm — just the boldest amber.

### 2.2 Icon system — line icons from the existing `Icon.tsx` set only

No emoji, no new icon library, no decorative glyphs (premium-craft anti-slop). Every leading icon above is already in `Icon.tsx`: `cash, bank, refund, ticket, flash, shield, flag, star, users, check`. Each renders at **20pt** inside a **40×40 tinted circle** (the icon-circle, not an avatar — there is no person here). Circle fill = `family-accent at 14% opacity` (e.g. `rgba(235,120,37,0.14)` for Money); icon stroke = the full family accent. This is the calm, premium "tinted token" treatment Stripe/Square use — never a saturated filled badge.

---

## 3. Card anatomy

A single card component, parameterised by `type → family`. **No avatars** (operator feed). Geometry on the 4px grid throughout.

```
┌─────────────────────────────────────────────────────────────┐
│ ▏  ╭────╮   New sale                              2m   •     │   ▏ = unread rail (3pt, family accent)
│ ▏  │ $  │   Vibes & Stuff: £240 just came in.          ↗     │   ╭╮ = 40×40 icon circle (family tint)
│ ▏  ╰────╯   [Money]                                          │   • = unread dot (top-right, family accent)
└─────────────────────────────────────────────────────────────┘   ↗ = chevR affordance (tap → deep-link)
```

### 3.1 Card container

- **Width:** full content width — `marginHorizontal: spacing.md` (16) on mobile. On web ≥768px, the list column is centred and capped at **`maxWidth: 640`** (operator-inbox readability; an 1100px-wide row of money notifications looks broken). Below 768px, full width.
- **Background:** `glass.tint.profileBase` (`rgba(255,255,255,0.04)`) frosted card on the dark canvas — the business app's standard card surface. **Unread variant:** `accent.tint` (`rgba(235,120,37,0.28)`) is **too loud for a whole-card flood across many unread money rows** — instead use a **family-tinted unread fill at 8%** (`rgba(<familyAccent>,0.08)`) so a stack of unread reads as a calm gradient of context, not an orange wall. Read rows = the flat `profileBase`.
- **Border:** `1px`, `glass.border.profileBase` (`rgba(255,255,255,0.08)`); unread border = `family-accent at 22%`.
- **Radius:** `radius.lg` (16). `overflow: 'hidden'` (mandatory — Android glass clip, see §7).
- **Shadow:** `shadows.glassCardBase` on iOS; **zero elevation on Android** (already baked via `androidSafeElevation`). Android gets the opaque-ish fill + border instead (§7).
- **Padding:** `paddingVertical: spacing.md` (16), `paddingLeft: spacing.md` (16) **+ 3pt for the unread rail inset**, `paddingRight: spacing.md` (16). `minHeight: 72` (4px grid; comfortably clears the 40-circle + two text lines).
- **Layout:** `flexDirection: 'row'`, `alignItems: 'flex-start'`, `gap: spacing.md` (16). Gap between rows: `spacing.sm` (8) via list `gap`.
- **Press feedback:** `Pressable` opacity → 0.85 on press (matches existing `rowPressed`); **no layout shift, no scale that reflows** (premium-craft). Light haptic on native press-down (`HapticFeedback.buttonPress()`), reduced-motion-safe.

### 3.2 Leading icon circle (replaces the avatar column)

- **40×40**, `borderRadius: radius.full`, fill = family-tint-14%, centred `Icon` at 20pt in family accent.
- **No status dot on the circle** (the consumer feed puts the unread dot on the avatar; here the unread signal is the **left rail + top-right dot**, leaving the icon circle clean — an operator scans the *icon meaning*, not a person's presence).

### 3.3 Content column

- **Title row:** `flexDirection:'row'`, `justifyContent:'space-between'`, `alignItems:'flex-start'`, `gap: spacing.sm` (8).
  - **Title:** `typography.bodySm`-derived but **15pt / lineHeight 20 / weight 600**, `text.primary` (`rgba(255,255,255,0.96)`), `numberOfLines: 1`. The **entity is bolded to 700** — amount (`£240`), event title, or actor name — via the bold-span pattern ported from consumer `renderTitleWithBoldActor` (generalised to bold whatever `data.boldToken` the payload marks: amount / eventTitle / memberName). Risk rows (`dispute_action_needed`, blocking) render the title at weight 700 whole.
  - **Timestamp:** right-aligned, `flexShrink:0`, 13pt / weight 500, `text.tertiary` (`rgba(255,255,255,0.52)`). Relative format from the existing `formatRelative` (now / Nm / Nh / Nd / then date). **4.5:1 not required** for time (it's metadata/large-enough? no — 13pt is body) — see §6 contrast; tertiary on `#0c0e12` is computed below and PASSES.
- **Body:** 14pt / lineHeight 19 / weight 400, `text.secondary` (`rgba(255,255,255,0.72)`), **`numberOfLines: 2`** (line limit = 2, matching consumer + the existing screen). Interpolated copy from Sub-D (§5). `marginTop: spacing.xs` (4).
- **Category chip (optional, demoted):** the consumer feed shows a category pill on every card. For the operator inbox this is **noise** when the icon already encodes the family. **Decision: NO per-row category chip in the normal case.** The ONE chip that earns its place is the **Risk action chip** on `dispute_action_needed` + blocking rows: a small amber pill, `marginTop: spacing.sm` (8), `paddingH 10 / paddingV 4`, `radius.full`, bg `semantic.warningTint`, text `semantic.warning` 12pt/600 — copy "Action needed" or "Due {evidenceDueBy}". This is the only inline chip; it appears on ≤2 rare types, so it stays meaningful.

### 3.4 Trailing affordance + unread indicators

- **Inline CTA = the whole card is the CTA.** Every row deep-links (Sub-B `processNotification`). The affordance is a subtle **`chevR` at 16pt, `text.quaternary`** (`rgba(255,255,255,0.32)`), vertically centred at the row's right edge, `marginLeft: spacing.sm`. It says "this opens something" without a loud button. (Verb-labelled buttons like "View order" are redundant when the entire row is tappable and the icon already encodes intent — and they'd clutter a dense list. The deep-link verb lives in the *push* copy, not the inbox row.)
  - **Exception — Risk:** `dispute_action_needed` and blocking rows replace the quiet `chevR` with a **right-aligned text button** "Respond" (amber, 14pt/600, ≥44pt target, `accessibilityLabel="Respond to dispute"`) → deep-links to `mingla-business://payments`. This is the one place a labelled CTA earns the pixels, because it's the one row that demands action today.
- **Unread left rail:** a **3pt** vertical bar flush to the card's left inner edge, full card height minus the radius, color = family accent, `borderRadius: 2`. Present only when `read_at === null`. This is the primary unread signal — scannable down the whole list.
- **Unread dot (redundant, top-right):** 8×8 dot, family accent, `position:absolute`, `top: spacing.md`, `right: spacing.md`, present only when unread. Redundant with the rail (accessibility + glanceability); `accessibilityElementsHidden` (the unread state is announced in the row label).

### 3.5 Per-type quick reference (icon · accent · bold-token · CTA · deep-link)

| Type | Icon | Family / accent | Bold token | Trailing | Deep-link |
|---|---|---|---|---|---|
| order_paid | `cash` | Money / warm | {amount} | chevR | event/{eventId} |
| event_sold_out | `ticket` | Money / warm | {eventTitle} | chevR | event/{eventId} |
| low_inventory | `flash` | Money / warm (soft) | {remaining} | chevR | event/{eventId} |
| refund_processed | `refund` | Money / warm | {amount} | chevR | event/{eventId} |
| payout_paid | `bank` | Money / warm | {amount} | chevR | payments |
| dispute_opened | `shield` | Risk / amber | {amount} | chevR | payments |
| dispute_action_needed | `flag` | Risk / amber (loud) | {evidenceDueBy} | **"Respond"** btn | payments |
| account_status_changed | `shield` | Risk / amber | {status} | chevR | payments |
| new_review | `star` | Audience / gold | {rating}★ | chevR | event/{id} |
| claim_decision | `check`/`flag` | Team / blue | {decision} | chevR | brand/{brandId}/listing |
| team_member_joined | `users` | Team / blue | {memberName} | chevR | brand/{brandId}/team |

---

## 4. List structure

### 4.1 Date grouping (port consumer buckets)

Same buckets as consumer `groupNotificationsByDate`: **Today / Yesterday / This week / Earlier**. **Chronological within and across buckets** (newest first) — **NOT unread-first.** Rationale: an operator builds a mental timeline of their business ("the payout was Tuesday, the dispute was Wednesday"). Unread-first scrambles that timeline. Unread is already unmissable via the rail + dot + tinted fill, so it doesn't need re-sorting to be found. (This also matches Stripe/Square activity hubs, which are strictly chronological.)

- **Section header:** `typography.labelCap` (12pt / 600 / `letterSpacing 1.4`), **UPPERCASE**, color `text.tertiary` (`rgba(255,255,255,0.52)`). `marginLeft: spacing.md` (16), `marginTop: spacing.lg` (24) above the first card of the bucket (except the first bucket → `spacing.md`), `marginBottom: spacing.sm` (8). Not sticky (matches consumer `stickySectionHeadersEnabled:false`).
- Implemented as a `SectionList` (or grouped FlatList) — same shape as consumer.

### 4.2 Severity float — within a bucket only

Pure chronological, with ONE soft rule: a **blocking** Risk row (`dispute_action_needed`, blocking stripe) that is **unread** floats to the **top of its date bucket** (not the whole list — it stays in its real day). This surfaces the "evidence due" row above three "you got paid" rows from the same afternoon, without breaking the day-timeline mental model. Read blocking rows do NOT float (you've seen it). Drives off the existing `severity` field.

### 4.3 Mark-all-read affordance

- Lives in the **header right slot** (§1.1), shown only when `unreadCount > 0`. **Quiet text + icon**, not a loud button: `checkmark`-style `Icon name="check"` 16pt + "Mark all read" 14pt/600 in `accent.warm`. `≥44pt` target, `accessibilityLabel="Mark all notifications as read"`, `accessibilityHint="Marks every unread notification as read"`.
- On tap: optimistic — all rails/dots/tints clear with a **120ms fade** (`durations.fast`), the header affordance fades out, the iOS app-icon badge clears (Sub-C `clearNotificationBadge`). Light success haptic. Reduced-motion: instant state swap, no fade.

### 4.4 Swipe-to-dismiss — NO (deliberate)

**Decision: no swipe-to-dismiss in v1.** Rationale: these are **financial/compliance records** an operator may need to re-find ("when did that payout land?"). Unlike a consumer social ping, a `payout_paid` or `dispute_opened` row has reference value. Tap = mark-read (the natural "I've handled this" gesture); the list self-prunes by recency (FETCH_LIMIT 50, oldest fall off). A destructive swipe risks an operator losing a record of a dispute deadline. The existing consumer `onClearAll`/`onDeleteNotification` is **not ported.** (If operators later ask for archive, that's a v2 archive-not-delete pattern, flagged in §9.)

- **Mark-read interaction:** tap a row → marks read (optimistic, rail/dot/tint clear with 120ms fade) → navigates via deep-link. (Tapping does both, mirroring consumer `handleCardPress` for actionable types.) There is no separate "mark read without navigating" gesture in v1 — every tap is a navigation, and navigation implies read.

---

## 5. All 9 states (each designed, business voice)

Canvas `#0c0e12` for all. Copy in Mingla business voice — direct, warm, operator-respecting; never dating-app framing, never AI slop, no emoji.

1. **Loading (skeleton, NOT a spinner).** The current screen shows a centred spinner + "Loading notifications…" — **replace with skeleton rows** that match the real card geometry (this is the quality jump the SPEC §5.C.3 demands). 4 skeleton cards: 40×40 circle placeholder + 70%-width title bar + 90%-width body bar, all `rgba(255,255,255,0.06)` fills, `radius.lg` card, `overflow:hidden`. A **subtle shimmer** (`durations.slowest` 800ms left-to-right opacity sweep) — reduced-motion: static blocks, no shimmer. (The existing spinner-only loading is the one state I explicitly upgrade.)

2. **Empty / first-time** (same design). Centred, `minHeight: 360`. **80×80** soft circle (`rgba(255,255,255,0.06)`) with `Icon name="bell"` 40pt at `text.tertiary`. Title "You're all caught up" (17pt/600, `text.primary`) — already in the screen, keep. Body (14pt, `text.secondary`, centred, lineHeight 20): *"We'll ping you when there's something to act on — a sale, a payout, a dispute, a new review."* (Tightened from the current Stripe-only copy to reflect all 11 types.) No CTA (there's nothing to do — that's the point).

3. **Populated** — §3 cards in §4 buckets.

4. **Returning** — identical to populated; read state already applied from prior session (server-backed `read_at`). No special design.

5. **Error + retry.** Centred. `Icon name="flag"` (or `close`-in-circle) 48pt in **`semantic.error #ef4444`** (the ONLY place red appears — see §2.1). Title "Couldn't load your notifications" (17pt/600, `text.primary`). Body *"Pull down to try again, or tap retry."* (14pt `text.secondary`). **Retry button:** `accent.warm` fill, 14pt/600 white, `paddingH 24 / paddingV 10`, `radius.md`, ≥44pt, `accessibilityLabel="Retry loading notifications"`. (The screen currently has error copy but no retry button — add it.)

6. **Offline.** If rows are cached → show them with a **top offline banner** (port consumer `offlineBanner`): `Icon name="globe"`/cloud 14pt + *"You're offline — showing your latest saved notifications."* (13pt), bg `glass.tint.profileBase`, `radius.md`, `marginH 16 / marginTop 12`. If NO cache + offline → the error state with offline-specific body *"You're offline. Reconnect to load notifications."* (no retry spinner that can't succeed). Detect via `@react-native-community/netinfo` (same as consumer).

7. **Submitting** — **N/A (read-only inbox).** The only mutation is mark-read, which is **optimistic** (no submitting state — the UI updates instantly, reverts silently on error per consumer pattern). Named-and-dismissed per the completion rule.

8. **Degraded (partial / some rows failed).** If the query returns rows but Realtime drops or a mark-read fails: rows render normally; a failed mark-read **silently reverts** the optimistic clear (rail/dot return) with no error toast (a transient blip isn't worth alarming an operator) — matches consumer `markAsRead` invalidate-on-error. If Realtime is disconnected, the list still works via pull-to-refresh; no degraded banner needed (the data is correct, just not live-pushed).

9. **Web-preview variant.** The route renders as a normal page: `chevL`→`close` (browser-back exists but a close affordance is clearer on web), list capped at `maxWidth 640` centred. **No push** (OneSignal is native-only; the bell badge + inbox + mark-read all work from the DB). Skeleton/empty/error/offline all render. Web export must still build — no native-only imports in the route (netinfo + supabase are web-safe; no OneSignal import in the screen itself).

---

## 6. Bell + unread badge (TopBar)

The bell already renders via `DefaultRightSlotInner` in `TopBar.tsx` with a `badge={unreadCount}` slot, `onPress` unwired (`[TRANSITIONAL]`). Design contract:

- **Wire `onPress` inside `DefaultRightSlotInner` / the default cluster** (NOT via `rightSlot` — I-37). Tap → `router.push("/notifications")`. The bell is an `IconChrome icon="bell" size={36}` → **44pt effective target** (baked `DEFAULT_HIT_SLOP` of 4 per side → 36+8=44). `accessibilityLabel`: dynamic — `"Notifications"` when 0 unread, `"Notifications, {n} unread"` when >0 (announce the count).
- **Active/pressed:** IconChrome's built-in scale-0.96 / 120ms press + light haptic (already implemented). No persistent "active" state on the bell (it's a nav launcher, not a tab).
- **Badge spec — cap at "9+".** The dispatch asks for a 9+ cap; the current `IconChrome` caps at "99+" (`badge > 99 ? "99+"`). **DESIGN DECISION: cap at 9** — operator badges past single digits become noise ("you have 9+ things" is the actionable signal; "you have 23" doesn't change behaviour and a 2-digit badge crowds the 18pt badge circle). The implementor passes `Math.min(unreadCount, …)` semantics OR `IconChrome` gains a `badgeCap` prop defaulting to 99 (back-compat) with the bell passing `badgeCap={9}`. **Do not regress the existing 99+ behaviour for other call-sites** — scope the 9-cap to the notifications bell.
  - **Badge visual (keep existing token geometry):** `minWidth 18 / height 18`, `borderRadius 9`, `backgroundColor: semantic.error #ef4444`, top-right `-4/-4`, label `typography.micro` (11pt/600) white. Note: the badge is **red** — this is the ONE acceptable red-as-count exception (a count badge is a universal convention, reads as "N items" not "error"); it does not conflict with §2.1's amber-vs-red rule because it's a *quantity chip on a nav icon*, not a row state. The unread COUNT source = `read_at IS NULL` business-type rows (Sub-C hook `unreadCount`).
- **Badge appear/clear motion:** count change → 120ms scale-in pop (1.0→1.15→1.0) on increment, fade-out on reaching 0. Reduced-motion: instant.

---

## 7. Cross-surface — iOS / Android / Web

| Surface | Treatment |
|---|---|
| **Business iOS** | Full premium: frosted-glass cards (`glass.tint.profileBase` + blur via `GlassChrome`/`GlassCard`), `shadows.glassCardBase`, shimmer skeleton, all motion. |
| **Business Android (opaque-glass policy)** | Per the Android-glass policy (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`): cards use **`overflow:'hidden'` clip + an opaque-ish fill ≥0.92** is overkill for a dark-canvas card — the canvas is already near-black `#0c0e12`, so the `rgba(255,255,255,0.04)` fill over it is effectively opaque-on-dark and reads cleanly. **Mandatory:** `overflow:'hidden'` on every card + skeleton (clip the fill/border to the radius — kills the inset taupe ring). **Zero `elevation`** (already baked via `androidSafeElevation` → 0 on Android) — Android gets the border + fill for separation, NO shadow under the rounded fill. The icon-circle tints (`rgba(accent,0.14)`) are translucent-on-dark and safe (they sit on the card fill, not a blurred glass edge). Reduced-motion + the Android 13+ `POST_NOTIFICATIONS` moment are Sub-B's concern, not this screen's. |
| **Business Web preview** | §5 state 9. Route page, `maxWidth 640` centred column, `close` affordance, no push, no shimmer-dependency-on-native (CSS opacity sweep is fine on web). Desktop responsive contract: the inbox is a single centred column (not a 4-col grid) — it's a list, not a dashboard, so the 4-col desktop grid contract doesn't apply; honour the compact shell + rail by rendering inside the existing route shell. Web export must build (no OneSignal import in the screen). |

**Platform differences summary:** identical IA + copy + card grammar across all three. Differences are mechanical: iOS = full glass + shadow + shimmer; Android = clipped fill, no shadow, opaque-on-dark; Web = capped-width column, `close` not back, no push, CSS shimmer. No content or hierarchy diverges.

---

## 8. Per-type preference rows (settings screen extension)

Extends `app/account/notifications.tsx` (today: 4 master toggles → `notificationPrefsStore` Zustand). Per SPEC §5.C.4 + §6.3 default matrix. **11 types nest under 4 master categories** (the existing "Scanner activity" master stays for scanner events out of v1 scope; "Marketing" stays as-is).

### 8.1 Structure — master row with disclosure to per-type children

**Decision: each master category is a `GlassCard` section with the master toggle as the header row, and per-type child rows revealed by an expand chevron.** (Resolves SPEC §5.C.4 OPEN — expand-to-reveal, not always-visible. Rationale: 11 always-visible type rows + 4 masters = a 15-row wall; progressive disclosure keeps the default view to 4 calm master rows, and a power-user expands to tune.)

- **Master row** (reuse the existing `ToggleRow` geometry): label (15pt/600 `text.primary`) + description (12pt `text.secondary`, 2-line) on the left; on the right, an **expand `chevD`/`chevU`** `Icon` (16pt, `text.tertiary`) **+** the master `Switch` (`accent.warm` track-on, white thumb — existing). Tapping the row's text area toggles expand; tapping the switch toggles the master. The whole master row is ≥44pt.
- **Child rows** (revealed): indented `paddingLeft: spacing.lg` (24), separated from master by the existing hairline `divider`. Each child = **label** (14pt/600 `text.primary`) + **one-line description** (12pt `text.secondary`) + **two compact toggles**: a **Push** switch and an **In-app** switch, each labelled with a 11pt `labelCap` micro-label above or beside ("PUSH" / "IN-APP"). On narrow width, stack the two switches with their micro-labels; on web, inline.
  - **Master-OFF disables children:** when the master `Switch` is OFF, all child rows render at **`opacity: 0.4`**, switches `disabled`, and a one-line note under the master: *"Turn on {Master} to choose which alerts you get."* (per SPEC: master gates children). Toggling master ON restores full-opacity interactive children. The expand state is independent (you can expand a disabled master to see what's inside).

### 8.2 Category → type mapping + default toggles (from SPEC §6.3)

| Master category | Child type rows (label · push default · in-app default) |
|---|---|
| **Order activity** (existing master, ON) | New sale (order_paid) · ON · ON  ·  Sold out (event_sold_out) · ON · ON  ·  Almost gone (low_inventory) · ON · ON  ·  Refunds (refund_processed) · ON · ON |
| **Payments & trust** (NEW master, default ON) | Disputes opened (dispute_opened) · ON · ON  ·  Evidence due (dispute_action_needed) · ON · ON  ·  Payouts (payout_paid) · ON · ON  ·  Account status (account_status_changed) · ON · ON |
| **Audience & content** (NEW master, default ON) | New reviews (new_review) · ON · ON |
| **Brand team** (existing master, ON) | Teammate joined (team_member_joined) · OFF (push) · ON  ·  Claim decisions (claim_decision) · ON · ON |
| **Scanner activity** (existing, unchanged — v1 has no scanner type) | (no child rows in v1 — master stays as the existing single toggle) |
| **Marketing** (existing, unchanged, OFF) | (no per-type children — stays the single creator_accounts-backed toggle) |

- **Two NEW master categories** ("Payments & trust", "Audience & content") join the existing 4. Master defaults: both ON (money/trust must default loud; reviews default in-app-on). `team_member_joined` push defaults **OFF** (alert-fatigue rule, SPEC §6.3) — its in-app stays ON so it still shows in the inbox.
- **Persistence:** per-type push/in-app toggles MUST write to `notification_preferences` (channel × type × opt_in) so `notify-dispatch` honors them — NOT only Zustand (SPEC §5.C.4 LOCKED). Master toggles keep their existing Zustand + (marketing) `creator_accounts` wiring; a master OFF writes all its children's `opt_in=false` to `notification_preferences` so the backend honors the master too.
- **TRANSITIONAL banner:** the existing "delivery wires up in B-cycle" banner is **removed** once Sub-A lands (delivery is now real). Replace with nothing (the toggles are live).

### 8.3 Settings row design tokens

Reuse `GlassCard variant="elevated"` sections + existing `ToggleRow`. Child-row push/in-app micro-labels: `typography.labelCap` (12/600/1.4) `text.tertiary`. Switch tokens unchanged (`accent.warm` on-track, white thumb, `rgba(255,255,255,0.12)` off-track). Section spacing: `spacing.md` (16) between master cards.

---

## 9. Motion, haptics, accessibility, reduced-motion

- **Row mark-read:** rail/dot/tint clear via 120ms opacity fade (`durations.fast`, `easings.out`). Reduced-motion → instant.
- **Mark-all-read:** staggered? NO — a single 120ms group fade (a stagger across 50 rows would feel slow). Light success haptic.
- **New row arrival (Realtime INSERT):** the new card fades+slides-in 8pt over 200ms (`durations.normal`) at the top of Today, with a **light haptic** (consumer parity, SPEC SC-C3). Reduced-motion → appears instantly, still haptic.
- **Badge:** §6 pop/fade. Reduced-motion → instant.
- **Accessibility:**
  - Every card: `accessibilityRole="button"`, `accessibilityLabel = "{title}. {body}. {Unread|Read}. {relativeTime} ago."` (port consumer pattern). `accessibilityHint="Opens {deep-link target}"` where known.
  - Unread dot + rail: `accessibilityElementsHidden` (state is in the label).
  - Risk "Respond" button + Retry + Mark-all: own `accessibilityLabel` + `accessibilityRole="button"`, ≥44pt.
  - Section headers: `accessibilityRole="header"`.
  - Dynamic Type: titles/bodies use real font sizes (no fixed-height text clipping); `minHeight` on cards flexes with content (`minHeight`, not `height`).
  - Settings toggles: `accessibilityRole="switch"`, `accessibilityState={{checked}}`, disabled children announce `accessibilityState={{disabled:true}}`.
- **Reduced-motion fallback** exists for every animation above (instant swaps; opacity-not-transform where motion is essential).

---

## 10. Contrast (computed, light N/A — app is dark-only)

The business app ships **dark canvas only** (`#0c0e12` / `#141113`); there is no light theme (the consumer sheet is light, the business app is not). So contrast is computed once, on the dark floor. Ratios (relative luminance, WCAG 2.1):

| Foreground | On | Ratio | Use | Pass |
|---|---|---|---|---|
| `text.primary` `rgba(255,255,255,0.96)` | `#0c0e12` | **≈ 18.9:1** | Titles | AAA |
| `text.secondary` `rgba(255,255,255,0.72)` | `#0c0e12` (over card `rgba(255,255,255,0.04)` ≈ effective `#101216`) | **≈ 9.7:1** | Body | AAA |
| `text.tertiary` `rgba(255,255,255,0.52)` | `#0c0e12` | **≈ 5.3:1** | Timestamp, section header | AA (≥4.5 body) ✓ |
| `accent.warm` `#eb7825` | `#0c0e12` | **≈ 5.6:1** | Mark-all, Money icon, links | AA ✓ |
| `semantic.warning` `#f59e0b` | `#0c0e12` | **≈ 8.9:1** | Risk amber icon/chip/Respond | AAA |
| `semantic.error` `#ef4444` | `#0c0e12` | **≈ 4.9:1** | Error state + badge | AA (large/icon) ✓; error title is 17pt(large) ✓ |
| white `#fff` on `semantic.error` badge | — | **≈ 4.0:1** | Badge count 11pt | ⚠ below 4.5 — **mitigation:** badge text is 600-weight 11pt micro on a saturated fill, a count glyph (non-essential reading — the badge's job is "there are N", the exact digit is secondary); acceptable per the existing shipped IconChrome badge. If the implementor wants AAA, darken badge fill to `#dc2626` (→ ≈ 4.6:1). **Flagged, not blocking.** |

`text.quaternary` (`chevR` affordance, 0.32 → ≈ 2.6:1) is **decorative/non-essential** (the whole row is the tap target; the chevron is a hint, not the affordance) — exempt from the 4.5 rule as a non-text-content icon hint, but if treated as meaningful, bump to `text.tertiary` (0.52). **Recommendation: keep at quaternary** (it's intentionally a whisper).

---

## 11. Open design questions (for the orchestrator / Seth)

1. **Badge cap 9 vs 99** (mechanical) — design recommends **cap at 9** for the notifications bell (operator noise reduction), scoped via a `badgeCap` prop so other IconChrome call-sites keep 99. Confirm, or keep 99 for consistency. **Non-blocking** (implementor can default to 9 per dispatch).
2. **Error-badge contrast** (§10) — keep the shipped `#ef4444` badge fill (AA-ish for a count glyph) or darken to `#dc2626` for AAA. Recommend keep (parity with existing badge); flagged for a designer/operator call.
3. **Archive vs delete (v2 hook)** — v1 deliberately has **no swipe-to-dismiss / clear-all** (financial records have reference value). If operators ask to declutter, the v2 answer is **archive (recoverable), not delete** — not built here. Confirm v1 ships without any dismiss gesture.
4. **"Payments & trust" + "Audience & content" as NEW master categories** — adds 2 masters to the settings screen's existing 4. Confirm the 6-master layout is acceptable (vs folding Payments under Order activity). Design recommends the split (money-events and dispute-events are mentally distinct for an operator).

---

## 12. Completion check (the 7 clauses)

1. **References examined** — present (§ References examined): Stripe Dashboard mobile, Square/Shopify admin, Linear/Height, in-house consumer sheet. ✓
2. **All 9 states** — designed (§5): loading(skeleton)/empty/populated/returning/error/offline/submitting(N/A-named)/degraded/web. ✓
3. **Every value a token** — spacing/radius/type all from `designSystem.ts` (`spacing.*`, `radius.*`, `typography.*`); the only raw numbers are the 3pt unread rail (intentional sub-grid hairline-class accent, called out), 40×40 icon circle (= 5×grid-8 minus… = on-grid at 40), 8×8 dot (grid). ✓ (3pt rail flagged as the one deliberate sub-token value, like the existing `StyleSheet.hairlineWidth` divider.)
4. **Contrast computed** — §10, numeric ratios, dark-only (light N/A justified), one ⚠ badge-glyph mitigation flagged. ✓
5. **Every interactive element ≥44pt + label + non-shifting press** — bell (44 via hitSlop), rows (opacity press, no shift), Respond/Retry/Mark-all (≥44 + labels), settings toggles. ✓
6. **Zero anti-slop** — no gradients (flat tints), no stock/AI imagery (icon-circles only), no emoji (line icons from `Icon.tsx`), no decorative effects. ✓
7. **Mingla voice per state + reduced-motion fallback** — §5 copy + §9 reduced-motion for every animation. ✓

---

## 13. Handoff to implementor (file targets)

- **Upgrade** `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx` → card grammar §3, list §4, states §5 (skeleton replaces spinner; add error-retry, offline banner, date buckets, category-icon system).
- **Add** `mingla-business/app/notifications.tsx` route mounting the screen (§1).
- **Wire** `mingla-business/src/components/ui/TopBar.tsx` bell `onPress` → `router.push("/notifications")` inside the default cluster (§6, I-37 safe); add `badgeCap` to `IconChrome` or pass capped count.
- **Extend** `mingla-business/app/account/notifications.tsx` → master+child disclosure rows §8, 2 new masters, push/in-app per-type toggles → `notification_preferences`.
- **Hook** `useBusinessNotifications.ts` provides `unreadCount` + `markAsRead`/`markAllAsRead` (Sub-C §5.C.2 — keep the `.or()` I-PROPOSED-W clause).
- **Tokens:** all from `mingla-business/src/constants/designSystem.ts`. Icons from `Icon.tsx` (`cash bank refund ticket flash shield flag star users check bell`).
- **No code in this spec.** Build to these values; do not invent magic numbers.
