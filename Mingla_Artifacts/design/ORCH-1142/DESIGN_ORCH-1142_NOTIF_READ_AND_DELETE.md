# DESIGN — ORCH-1142 — Business notifications: tap-to-expand full-read + swipe/clear soft-delete

- **ORCH-ID:** ORCH-1142 [notif-read-delete]
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1142-[notif-read-delete]` on `ORCH-1142-notif-read-delete`.
- **Surfaces:** Mingla **Business** iOS + Android + web preview (one shared route). NOT consumer, NOT admin.
- **Author:** mingla-designer · **Date:** 2026-06-15 · **Mode:** SCREEN (extends an existing screen — does NOT redesign it).
- **Binds to:** `SPEC_ORCH-1142_NOTIF_READ_AND_DELETE.md` §4.C / §4.D / §12; embed this before IMPLEMENT.
- **Files this design governs (allowlist only):**
  - `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx`
  - `mingla-business/app/notifications.tsx`
  - (reuse, do NOT modify) `mingla-business/src/components/ui/ConfirmDialog.tsx`
- **Token source of truth:** `mingla-business/src/constants/designSystem.ts`. Every value below resolves to a named token there. No raw values are introduced except the three deliberate sub-grid accents the existing screen already established (`UNREAD_RAIL_WIDTH=3`, `UNREAD_DOT=8`, `ICON_CIRCLE=40`) plus the swipe-panel geometry constants called out explicitly in §2.

---

## 0. Design stance (read first)

The collapsed row is the contract. **It stays pixel-identical to today** — same `styles.card`, same 40×40 family-tinted icon circle, same 1-line title / 2-line body, same unread rail (3pt) + dot (8pt), same chevron, same family accents, same date buckets, same severity float. This work is **purely additive**: it layers (1) an expanded state revealed on tap, (2) a delete gesture/affordance, and (3) one header sibling action. Nothing in the resting list changes. If a diff alters the collapsed row's measured geometry, it is wrong.

Three locked product decisions drive every choice below and must not be reversed:
1. Tap = expand in place + mark-read; the deep-link demotes to a secondary "Open" button inside the expanded body.
2. Per-row swipe-to-delete (right→left) + a header "Clear read" bulk sibling to "Mark all read"; both are recoverable soft-deletes.
3. "Clear read" gets a lightweight confirm (`Clear N read notifications?`); per-row swipe-delete is immediate (no confirm).

---

## 1. THE EXPANDED CARD

### 1.1 IA & moment
The operator tapped a row whose title/body was truncated. Their intent is "tell me the whole thing, and let me act if I want." The expanded state answers both: it reveals the **full text first** (the primary job — read), and only then offers the **secondary "Open"** route off-screen (the optional job — act). Reading must never require leaving the inbox; acting is opt-in. Mark-read fires on the same first tap regardless of which they do.

Multiple rows may be expanded at once (SPEC §10 Q1 default — accepted; no surprise auto-collapse of siblings). Expansion state is ephemeral component state.

### 1.2 What changes between collapsed and expanded (and ONLY these)

| Element | Collapsed (today, unchanged) | Expanded (new) |
|---|---|---|
| Title `<Text>` | `numberOfLines={1}` | **no `numberOfLines`** (full wrap). Same `styles.title` size/weight/color. Bold-token span + blocking-risk 700 variant keep their styling, just uncapped. |
| Body `<Text>` | `numberOfLines={2}` | **no `numberOfLines`** (full wrap). Same `styles.body` (14 / lh 19 / 400 / `text.secondary`). |
| Trailing chevron | `chevR`, 16, `text.quaternary`, vertically centered | **rotates to point down** (see §1.5). Same icon, size, color. |
| "Open" button | absent | **present** when `n.deep_link !== null` (see §1.3). |
| Card height | `minHeight: 72`, hugs 1+2 lines | grows to fit full content (see §1.4). |
| `respondRow` (blocking-risk) | rendered as today | unchanged — "Respond" stays; "Open" is additive and sits as a SECOND button in the same action row (see §1.3). |
| `backgroundColor` / `borderColor` / rail / dot / icon circle | per family + read state | **unchanged** — expansion does not restyle the surface. (Mark-read on first tap will flip an unread row to its read surface via the existing path; that is the existing behavior, not new.) |

### 1.3 The "Open" secondary button — anatomy & placement

A text-button affordance that mirrors the existing `respondBtn` grammar (the screen already has a labelled-CTA pattern — do not invent a filled button).

- **Container:** a new `expandedActionRow` — `flexDirection:"row"`, `justifyContent:"flex-end"`, `gap: spacing.sm`, `marginTop: spacing.sm`. This is the same shape as `respondRow`. When a row is BOTH blocking-risk AND has a deep_link, "Respond" and "Open" share this one row, right-aligned, "Respond" leftmost, "Open" rightmost (Respond is the more urgent verb → it reads first L→R).
- **Button label:** `Open`.
- **Type:** `typography.buttonMd` (14 / lh 20 / 600 / ls 0.2).
- **Color:** `accent.warm` (#eb7825) — the canonical brand action color. (Blocking-risk "Respond" keeps `semantic.warning`; the two colors intentionally differ — Open is a neutral navigate, Respond is a risk verb.)
- **Leading glyph:** none required; if the implementor wants a glyph, reuse `chevR` 14 `accent.warm` to the RIGHT of the label (signals "goes somewhere"). Optional.
- **Hit target:** `paddingVertical: spacing.sm` (8) + `paddingHorizontal: spacing.sm` (8) with the text's own 20pt line-height yields ≥36pt; add `hitSlop={{top:6,bottom:6,left:6,right:6}}` to clear ≥44pt. REQUIRED.
- **Press feedback:** `opacity: 0.7` on `pressed` (matches `markAllPressed`).
- **Action:** calls `onOpenDeepLink(n.deep_link, n)` — the SAME prop the route already passes. Plain tap on the card no longer navigates.
- **Absent** when `n.deep_link === null` (SC-2): the expanded card then shows full text only, no action row (unless blocking-risk, which keeps "Respond").

### 1.4 Height growth behavior
- The card has no fixed height — `minHeight: 72` stays as the floor; the expanded card's height is **content-driven** (RN auto-layout). Do NOT animate `height` to a measured pixel value (jank + measurement cost).
- Growth animates via the layout transition in §1.5, NOT via a manual `Animated.Value` on height. The body/title simply re-measure when `numberOfLines` is removed; `LayoutAnimation` (iOS/Android) / Reanimated `Layout` transition carries the resize.
- Horizontal metrics are **untouched**: same `paddingVertical: spacing.md`, `paddingLeft: spacing.md + 3`, `paddingRight: spacing.md`, `gap: spacing.md`, `borderRadius: radius.lg`. The icon circle stays top-aligned (`alignItems:"flex-start"` is already set) so it pins to the first title line as the body grows — correct; do not center it.

### 1.5 EXPAND / COLLAPSE MOTION (the spec the implementor builds to)

Two coordinated animations on tap. Both are already-available primitives (Reanimated v4 is present and used by `IconChrome`/`ConfirmDialog`; `LayoutAnimation` is RN core). **Pick ONE of the two equivalent implementations below — do not mix:**

**Animation A — the height/reveal (card grows):**
- **Trigger:** row `onPress` toggles `expanded`.
- **Property:** the card's intrinsic layout (height + the title/body text reflow).
- **Implementation (preferred):** Reanimated `LinearTransition` (a.k.a. `Layout`) on the card container, OR RN `LayoutAnimation.configureNext` fired immediately before the `setState` toggle.
- **Curve:** map to the token `easings.out` = `cubic-bezier(0.33, 1, 0.68, 1)` (decelerate — content settles into place, no overshoot). With Reanimated `LinearTransition.easing(Easing.bezier(0.33,1,0.68,1))`. With `LayoutAnimation`, use `type: 'easeInEaseOut'` (closest core analog) — acceptable since `LayoutAnimation` cannot take a custom bezier.
- **Duration:** `durations.entry` = **260ms** on expand; `durations.exit` = **180ms** on collapse (collapse is faster — getting out of the way should feel snappier than revealing). If `LayoutAnimation`, use a single `duration: 220` (`(260+180)/2` rounded — core cannot key per-direction); the Reanimated path SHOULD honor the per-direction split.

**Animation B — the chevron rotation (state signal):**
- **Trigger:** same `expanded` toggle.
- **Property:** `transform: [{ rotate }]` on the trailing chevron. Collapsed `chevR` (points right, "more →") rotates to point DOWN ("expanded ▾"). Rotate the existing `chevR` glyph **+90°** (0deg → 90deg) — do NOT swap to a different icon; rotation IS the continuity cue.
- **Curve:** `easings.out` (`cubic-bezier(0.33,1,0.68,1)`).
- **Duration:** `durations.normal` = **200ms** (slightly leads the 260ms reveal so the chevron "commits" to the new state just before the body finishes opening — reads as cause→effect).
- **Driver:** Reanimated `useSharedValue` + `withTiming(expanded ? 90 : 0, { duration: 200, easing })` + `useAnimatedStyle`.

**Reduced-motion fallback (`useReducedMotion()`, REQUIRED):**
- Animation A: skip the layout transition entirely — the card snaps to expanded/collapsed (RN renders the new layout on the next frame; no `LayoutAnimation.configureNext`, no Reanimated layout). Instantaneous, no motion.
- Animation B: snap the chevron rotation (set the shared value with no `withTiming` → `rotate` jumps 0↔90deg). The state is still conveyed by the static rotated glyph, so meaning survives.
- Mark-read, full-text reveal, and "Open" all function identically with motion off.

### 1.6 Expanded-state interaction edge cases
- Tapping the expanded card body (anywhere not on "Open"/"Respond") collapses it (toggle). The card stays a single `Pressable`; "Open"/"Respond" are nested `Pressable`s that `stopPropagation` is NOT needed for in RN — they consume their own press, and a tap landing on them must NOT also collapse the card. Implementor: render the action buttons as siblings inside `content`; a press on a child Pressable does not bubble to the parent Pressable's `onPress` in RN, so this is automatic. Verify on device (T1/T2/T3).
- A blocking-risk row already shows "Respond" while collapsed; tapping it to expand reveals full text + keeps "Respond" + adds "Open" if `deep_link`. No regression to the float-to-top behavior.

---

## 2. SWIPE-TO-DELETE (native) + WEB DELETE FALLBACK

### 2.1 IA & moment
The operator wants a read/handled notification gone. The gesture is the iOS-native mail idiom: **drag the row left to reveal a red destructive panel.** Because the delete is a recoverable soft-delete (row persists server-side), the destructive *styling* is honest (red, trash) but the action is **immediate, no confirm** — the cost of a mistap is near-zero and the optimistic revert covers transient failures. This is the deliberate asymmetry vs. "Clear read" (which CAN nuke many rows → it gets a confirm).

### 2.2 Native swipe panel — anatomy & geometry
Wrap each `NotificationRow` in `ReanimatedSwipeable` (named import from `react-native-gesture-handler` — NOT the legacy `Swipeable`; `GestureHandlerRootView` is already mounted at app root per SPEC §2).

- **Direction:** right→left (left-swipe). `renderRightActions` only. No left-action (right-swipe) panel.
- **Panel width (revealed, rest threshold):** **80pt**. Deliberate constant `SWIPE_ACTION_WIDTH = 80` (one trash glyph + label-less square ≥44pt target with breathing room; matches iOS mail action width). This is a called-out sub-grid accent.
- **Panel fill:** `semantic.error` (#ef4444). Solid, fully opaque, on EVERY platform (a destructive action surface is never glass — it must read as a hard stop). This satisfies the Android opaque policy trivially (no rgba).
- **Panel corner:** the panel sits BEHIND the row's right edge; because the card has `borderRadius: radius.lg` (16) + `overflow:'hidden'`, the revealed red must clip to the card's rounded right corners. Render the action panel inside the same rounded clip OR give the panel `borderTopRightRadius / borderBottomRightRadius: radius.lg`. The card's existing `overflow:'hidden'` already clips; ensure the swipeable wrapper does not defeat it (wrap the swipeable in a `View` with `borderRadius: radius.lg` + `overflow:'hidden'`, `marginBottom: spacing.sm` moved to that wrapper so row spacing is preserved).
- **Trash glyph:** `Icon name="trash"` size **22**, color `text.inverse` (#ffffff) — white-on-red, contrast ≈ 4.0:1 against #ef4444 for the 22pt glyph (large-graphic threshold 3:1 → PASS). Centered in the panel (`alignItems:"center"`, `justifyContent:"center"`).
- **No text label** in the panel (the trash glyph + red is unambiguous and keeps the panel to 80pt). The a11y label carries the words (§4).

### 2.3 Full-swipe-commit vs reveal-then-tap (threshold)
Support BOTH, like iOS Mail:
- **Reveal-then-tap:** dragging past ~50% of the panel width (≈40pt drag) and releasing **snaps open** to the 80pt rest position; the operator then taps the red panel to delete. `ReanimatedSwipeable` `rightThreshold={40}`.
- **Full-swipe-commit:** dragging past **40% of the row width** auto-commits the delete on release without requiring a second tap. Configure via `overshootRight={false}` + an `onSwipeableWillOpen`/`onSwipeableOpen` that, when the drag distance exceeded the full-commit threshold, fires the delete directly. Concretely: set the full-commit trigger at `dragX < -(ROW_WIDTH * 0.4)`. Implementor measures `ROW_WIDTH` via the swipeable's `onLayout`.
- On commit, the row animates out via the optimistic cache removal (§2.5).

### 2.4 Haptic timing (native only)
Two distinct haptics, both via the existing `HapticFeedback` util (no new dep):
1. **Threshold-cross haptic** — fire `HapticFeedback.selection()` (or `.light()` if `selection` is unavailable in the util) **once**, the moment the drag crosses the full-swipe-commit threshold (the 40%-row-width line), to tell the thumb "release now = delete." Fire exactly once per drag (debounce on a `hasCrossed` ref; reset on drag back under threshold).
2. **Commit haptic** — fire `HapticFeedback.success()` at the instant `softDelete(n.id)` is called (whether via full-swipe or tap-the-panel). This is the "done" confirmation. (Mirror the route's `handleMarkAll` which uses `HapticFeedback.success()`.)
- No haptic on plain reveal-then-rest (the threshold-cross already covered it if they dragged far; a short reveal that doesn't cross gets no haptic — correct, nothing committed).

### 2.5 Optimistic removal motion
On `softDelete`, the hook removes the row from cache immediately (SPEC §4.B). Visually:
- The row collapses out of the list. Use the SAME `LinearTransition` / `LayoutAnimation` already on the list container so siblings slide up to fill the gap over `durations.exit` = **180ms**, `easings.out`. (Reuse Animation A's transition config — one transition serves both expand-resize and delete-removal.)
- **Revert on error:** the cache restore re-inserts the row in prior order; the same 180ms layout transition slides it back in. No toast, no banner, no alarm — silent (matches mark-read grammar; SPEC §4.B item 3, SC-5). Reduced-motion: snap in/out, no slide.

### 2.6 WEB delete fallback (`Platform.OS === "web"` — `isWeb` constant already at line 116)
Swipe gestures are unreliable on web → degrade to a **visible button**, never a hidden gesture.
- **Affordance:** a trailing trash `Pressable` rendered INSIDE the row, after the chevron, in the row's trailing cluster. `Icon name="trash"` size **16**, color `text.tertiary` at rest.
- **Visibility model:** **always visible** on web (not hover-only). Rationale: hover-reveal fails touch-capable laptops/tablets hitting the web preview and is a discoverability trap; an always-visible low-contrast trash is the honest web pattern and the inbox is operator-dense, not marketing. (Resolves SPEC §10 Q2 → always-visible.)
- **Hover (web pointer):** on hover, trash color animates `text.tertiary → semantic.error` over `durations.fast` (120ms); on press, `semantic.error` at full. CSS/RN-web hover via `Pressable` `onHoverIn/Out`. No layout shift (color-only).
- **Placement:** in the trailing column, with `marginLeft: spacing.sm` from the chevron, vertically centered. Target ≥44pt via `hitSlop`.
- **Action:** `softDelete(n.id)` directly — **no confirm** (parity with native immediacy; recoverable soft-delete).
- On web, `ReanimatedSwipeable` is NOT mounted (branch on `isWeb`): render the plain row + trailing trash. No gesture handler on the web path.
- Web has no haptics; the only feedback is the row sliding out (same 180ms layout transition, gated off under `prefers-reduced-motion`).

---

## 3. HEADER ACTION CLUSTER + "CLEAR READ" CONFIRM (`app/notifications.tsx`)

### 3.1 IA & moment
The header right slot today holds ONE action: "Mark all read" (only when `unreadCount > 0`). ORCH-1142 adds a sibling: "Clear read" (only when `hasRead`). The two can co-exist, be mutually exclusive, or both be absent. The header must read calmly in all four states and never reflow the centered title.

### 3.2 The four states (the state machine)

| `unreadCount` | `hasRead` | Right slot renders |
|---|---|---|
| `> 0` | `false` | "Mark all read" only (today's behavior, unchanged) |
| `0` | `true` | "Clear read" only |
| `> 0` | `true` | BOTH, as a horizontal cluster (see §3.3) |
| `0` | `false` | empty — render `chromeRightSlot` spacer (width 36) so the title stays centered (today's empty-state behavior, unchanged) |

### 3.3 Layout when BOTH appear
The current right slot is a single `Pressable`. Replace with a `headerActions` row:
- **Container:** `flexDirection:"row"`, `alignItems:"center"`, `gap: spacing.md` (16 between the two actions — enough that the two icon+label pairs do not read as one control), `justifyContent:"flex-end"`.
- **Ordering (L → R):** **"Mark all read"** then **"Clear read"**. Rationale: reading (clearing unread) precedes pruning (clearing read); the more-common/less-destructive action sits first, the mildly-destructive one is the rightmost, slightly-harder reach (thumb-zone friction for the lossier action — matches the design principle that destructive actions earn a reach).
- **Each action** keeps the existing `markAll` grammar: `flexDirection:"row"`, `gap: spacing.xs`, icon 16 + label `typography`-ish 14/600, `accent.warm`, `pressed → opacity 0.7`, `hitSlop {8,8,8,8}`.
  - "Mark all read": `Icon name="check"` 16 `accent.warm` + label `Mark all read` (UNCHANGED).
  - "Clear read": `Icon name="trash"` 16 `accent.warm` + label `Clear read`.
- **Color discipline:** "Clear read" uses `accent.warm` in the header (NOT `semantic.error`) — the header action is the *trigger*, not the destruction itself; the red lives in the confirm's Confirm button. This keeps both header actions visually peers (same accent) and prevents a permanent red shouting in the chrome.
- **Width guard:** with both labels visible, the cluster can be wide. The centered title uses `flex:1` + `textAlign:"center"` already; on a narrow device the title truncates before the actions wrap. Acceptable — the title is "Notifications" (short). If the implementor sees wrap on small Androids, drop the "Clear read" LABEL to icon-only at `< 360pt` width (keep the 44pt target + a11y label); the "Mark all read" label is the one that must always read. (Progressive disclosure under width pressure.)

### 3.4 "Clear read" CONFIRM — reuse `ConfirmDialog`, do NOT build new
The screen already ships `mingla-business/src/components/ui/ConfirmDialog.tsx` (a 3-variant dialog over `Modal`, web-safe, token-driven). Use it. NO new component, NO `Alert.alert` (Alert is inconsistent web-side and unstyled).

- **Variant:** `"simple"` (title + description + Cancel + Confirm). NOT `holdToConfirm` (overkill — this is recoverable) and NOT `typeToConfirm`.
- **`destructive`:** `true` → routes the Confirm button to the destructive (red) `Button` variant. THIS is where the red lives.
- **`title`:** `Clear read notifications?`
- **`description`:** `This removes N read notifications from your inbox. Unread ones stay. You can’t undo this here.` — where **N is the live count** of read business rows (`notifications.filter(n => n.read_at !== null).length`). If N is unknown/zero the action is hidden (so N ≥ 1 always at render). Use the singular `1 read notification` when N === 1 (Mingla voice: never show "1 notifications").
  - Mingla voice note: honest and plain. "You can’t undo this here" is true (the row is hidden from the inbox; recovery is server-side only). Do NOT promise an undo we don't surface.
- **`confirmLabel`:** `Clear read` · **`cancelLabel`:** `Cancel`.
- **`onConfirm`:** `clearRead()` (the hook bulk soft-delete) + `HapticFeedback.success()` on native.
- **`onClose`:** dismiss, no-op.
- **Trigger:** tapping the header "Clear read" opens the dialog (sets `confirmVisible=true`); it does NOT call `clearRead()` directly. (This is the §3 difference from "Mark all read", which fires immediately with no confirm — mark-read is non-destructive, clear-read removes rows.)
- **Title-count copy precision:** compute N at open time and freeze it in the description for the dialog's lifetime (don't let a background realtime insert change the sentence mid-read).

### 3.5 "Clear read" hidden/empty states
- `hasRead === false` → the "Clear read" action is **not rendered** at all (not disabled-greyed — absent). After a successful clear with no read rows left, `hasRead` flips false → the action vanishes; if `unreadCount` is also 0 the whole right slot returns to the 36pt spacer and the screen shows the existing "You're all caught up" empty state (SC-9 / T14).
- The confirm dialog auto-dismisses on `onConfirm` (the optimistic removal empties the read rows); ensure `confirmVisible` is reset to false in the confirm handler.

---

## 4. PER-PLATFORM DELTAS + ACCESSIBILITY

### 4.1 Android glass — opaque fallback on the EXPANDED card (standing policy)
The collapsed row already complies: `styles.card` carries `overflow:'hidden'` (line 562) and Android shadows are zeroed via `androidSafeElevation` in the shadow tokens. The expanded card MUST NOT regress this:
- **Surface fill unchanged:** expansion does not introduce a new translucent layer. The card keeps its existing read/unread fill (`glass.tint.profileBase` rgba .04 read, or the family `unreadFill` rgba .08). These are the SAME fills the collapsed card uses today and were already accepted under the Sub-C design; expansion adds height, not a new glass plane, so no new Android translucency is introduced. Do **not** add a fresh blur/translucent panel behind the expanded body.
- **`overflow:'hidden'` is load-bearing now for two reasons:** (a) the Android glass clip (existing), and (b) clipping the swipe action panel's red to the rounded corners (§2.2). Keep it on the card AND on the new swipeable wrapper `View`.
- **No Android shadow under the expanded rounded fill** — `shadows.glassCardBase` is already `Platform.select`-zeroed on Android; the expanded card keeps using it (read rows only, as today via `!isWeb && !unread`). Do not add `elevation` to any new expanded/swipe element.
- **Swipe panel (§2.2)** is `semantic.error` solid — opaque by construction on Android; compliant.
- **Web preview:** glass renders fine (real blur); no opaque substitution needed. The always-visible trash (§2.6) is the web delta.

### 4.2 iOS vs Android swipe
- **iOS:** `ReanimatedSwipeable` left-swipe is the native mail idiom — ships as specced (§2).
- **Android:** same `ReanimatedSwipeable` gesture works; Android users also expect swipe-to-dismiss in lists, so the idiom transfers. Keep the SAME 80pt panel + red + trash. The full-swipe-commit threshold + threshold-cross haptic apply identically (`HapticFeedback` abstracts the platform).
- **Web:** no swipe — always-visible trash button (§2.6). This is the only behavioral fork.

### 4.3 Accessibility (WCAG AA + RN traits)

**Touch targets — all ≥44pt:**
- Row Pressable: already ≥72pt tall — PASS.
- "Open" button: text + `paddingVertical: spacing.sm` + `hitSlop` 6 → ≥44pt. REQUIRED hitSlop.
- Web trash: 16pt glyph + `hitSlop` to ≥44pt. REQUIRED.
- Swipe action panel: 80pt wide × full row height — PASS.
- Header "Mark all read" / "Clear read": keep `hitSlop {8,8,8,8}` (existing) → ≥44pt.

**State announcement (expand):**
- The row's `accessibilityLabel` (today: `"{title}. {body}. {Unread|Read}. {time} ago."`) appends the expand state: append `" Collapsed."` when collapsed, `" Expanded."` when expanded.
- Add `accessibilityState={{ expanded }}` to the row Pressable so screen readers announce the disclosure state natively (VoiceOver/TalkBack read "expanded/collapsed").
- When expanded, the full (now-untruncated) title + body are the visible text; the a11y label should still summarize — but because the full text is now on screen, the label may keep using `title`/`body` (which are the full strings already; truncation was visual-only). No change needed beyond the Collapsed/Expanded suffix and `accessibilityState`.

**"Open" button a11y:**
- `accessibilityRole="button"`, `accessibilityLabel="Open notification target"`, `accessibilityHint="Opens the related screen for this notification"`.

**Swipe / web-delete a11y:**
- Native: `ReanimatedSwipeable`'s right action `Pressable` (the red panel) gets `accessibilityRole="button"` + `accessibilityLabel="Delete notification"`. Because swipe is not reachable by VoiceOver/TalkBack gesture, ALSO expose delete as an **accessibility action** on the row: `accessibilityActions={[{ name: 'delete', label: 'Delete notification' }]}` + `onAccessibilityAction` → `softDelete(n.id)`. This is REQUIRED — a swipe-only delete with no a11y action is an accessibility failure on native. (Implementor: add the magic-tap / custom action.)
- Web: the trash `Pressable` gets `accessibilityRole="button"` + `accessibilityLabel="Delete notification"`.

**Header a11y:**
- "Mark all read": unchanged (`accessibilityLabel="Mark all notifications as read"` + hint).
- "Clear read": `accessibilityRole="button"`, `accessibilityLabel="Clear read notifications"`, `accessibilityHint="Removes read notifications from your inbox; unread stay"`.
- Confirm dialog: `ConfirmDialog` already wires `Modal` focus + the Cancel/Confirm `Button`s carry roles. Ensure the destructive Confirm's label "Clear read" is announced; the dialog `title` is read on present.

**Contrast (text-on-surface, AA):**
- Title `text.primary` (white .96) on `canvas.discover` (#0c0e12) / family unreadFill → ≫ 7:1. PASS.
- Body `text.secondary` (white .72) on same → ≈ 7:1. PASS.
- "Open" `accent.warm` (#eb7825) on the dark card → ≈ 3.6:1 (large-ish 14/600 text). This matches the app-wide accepted accent-action pairing (memory: white-on-#eb7825 ~2.9:1 is the established action pairing; accent-on-dark here is BETTER). Accepted, consistent with `markAllLabel` which already uses `accent.warm` at 14pt.
- Trash white on `semantic.error` red (panel): 22pt graphic, 3:1 threshold → PASS.
- Web trash `text.tertiary` (white .52) at rest on dark: ~4.4:1 for the 16pt glyph — borderline but it's an icon with a clear shape; on hover it goes to full `semantic.error`. Acceptable; if the implementor wants margin, rest at `text.secondary` (.72).

**Reduced motion:** every animation in §1.5 / §2.5 has a snap fallback specced above. `ConfirmDialog`'s simple variant has no animation. Honor `useReducedMotion()`.

### 4.4 Dynamic Type
- Title/body use fixed sizes today (15/14) — when expanded they wrap and grow, so larger system text sizes are accommodated by the content-driven height (§1.4). No `numberOfLines` cap in the expanded state means no clipping at large text sizes. PASS — expansion actually IMPROVES large-text behavior over the truncated collapsed row.

---

## 5. BUILD-READY HANDOFF

**Tokens used (all exist in `designSystem.ts`):** `spacing.xs/sm/md`, `radius.lg`, `typography.buttonMd`, `accent.warm`, `accent.border`, `semantic.error`, `glass.tint.profileBase`, `text.primary/secondary/tertiary/quaternary/inverse`, `durations.normal/entry/exit/fast`, `easings.out`, `shadows.glassCardBase` (Android-zeroed).

**Icons (all exist in `Icon.tsx`):** `chevR` (rotated +90° when expanded), `trash` (swipe panel + web fallback + header "Clear read"), `check` (existing "Mark all read").

**Primitives / components:**
- `ReanimatedSwipeable` from `react-native-gesture-handler` (present; `GestureHandlerRootView` mounted at root — SPEC §2). Native only.
- Reanimated v4 (`useSharedValue` / `withTiming` / `useAnimatedStyle` / `LinearTransition` / `useReducedMotion`) — present (used by `IconChrome`, `ConfirmDialog`).
- `LayoutAnimation` (RN core) — acceptable alternative for Animation A.
- `HapticFeedback` util (`.selection()`/`.light()` threshold-cross, `.success()` commit + clear-read) — present.
- `ConfirmDialog` (`variant="simple"`, `destructive`) — REUSE, do not modify.

**New constants to add (deliberate sub-grid accents, declared at the top of the screen file alongside the existing `ICON_CIRCLE`/`UNREAD_RAIL_WIDTH`/`UNREAD_DOT`):**
- `SWIPE_ACTION_WIDTH = 80`
- `SWIPE_FULL_COMMIT_RATIO = 0.4` (fraction of row width for full-swipe auto-commit)
- `SWIPE_REVEAL_THRESHOLD = 40` (`rightThreshold`)
- `CHEVRON_EXPAND_DEG = 90`

**No new dependency. No new component file. No new migration concern at the design layer.** The expand state is ephemeral component state (`Set<string>` of expanded ids on the screen, or per-row `useState` — implementor's choice per SPEC §4.C item 1; siblings do NOT auto-collapse).

**State coverage checklist (every state designed):** collapsed (unchanged) · expanded (full text + Open) · expanded no-deep_link (no Open) · expanded blocking-risk (Respond + Open) · swipe-revealed · swipe-committed (optimistic out) · delete-revert (slides back, silent) · web always-visible trash · web hover · clear-read confirm open · clear-read N==1 singular copy · empty after clear (existing EmptyState + Clear-read hidden) · reduced-motion snap for all of the above. Skeleton / error+retry / offline-banner unchanged.

---

## 6. What this design explicitly does NOT do (guard against scope/regression)
- Does NOT restyle the collapsed row (pixel-identical to today).
- Does NOT introduce a detail screen (full-read is in-place).
- Does NOT hard-delete or add an `Alert.alert` confirm (soft-delete + `ConfirmDialog`).
- Does NOT add a translucent Android layer (opaque policy held; no new glass plane).
- Does NOT change mark-read / mark-all / date-bucket / severity-float / family-accent grammar.
- Does NOT add a new dependency or a new component file.
- Does NOT surface an in-app "undo" (recovery is server-side; copy is honest about this).
