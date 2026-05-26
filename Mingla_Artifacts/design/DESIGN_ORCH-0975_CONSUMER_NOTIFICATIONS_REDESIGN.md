# DESIGN — ORCH-0975 [Consumer notifications sheet redesign]

**Skill:** Mingla forensics (SPEC mode) pre-baking `/ui-ux-pro-max` visual contract
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]/`
**Branch:** `ORCH-0975-consumer-notifications-redesign`
**Companion:** `Mingla_Artifacts/specs/SPEC_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
**Reference screenshot:** operator-supplied in INTAKE chat (notifications sheet with "1 new" badge, "Stay updated on what matters." subtitle, "Mark all as read | Clear all" action row, four filter chips [REMOVED in redesign], "YESTERDAY" date heading, single card with ringed avatar + "Marcus Rivera shared an experience" + "Regal Crossroads → Kashin Japanese Restaurant" location chain + "Social" pill + "1d" timestamp + orange unread dot)

---

## 1. Visual identity decisions

### 1.1 Theme = LIGHT (white sheet on dimmed home)

The reference screenshot shows a near-white frosted sheet sliding up over the dimmed Home tab. The redesign stays LIGHT — does NOT adopt the dark `glass.bottomSheet.*` scrim + dark sheet pattern used by `TicketCartSheet.tsx` (which is a dark canvas at `#15181f`). This is intentional and consistent with the existing `NotificationsModal.tsx` palette today (white sheet, `colors.gray.*` text).

Why divergence from `glass.bottomSheet.*` is acceptable: those tokens were defined for dark-canvas sheets (ExpandedCardModal, TicketCartSheet, ExpandedBusinessEventSheet — all dark photo-card overlays). The notifications sheet sits over the Home tab which is bright/photographic content. A dark sheet here would clash with the OS notification-center mental model (white-on-blur). DESIGN_ORCH-0975 adds a sibling `glass.notificationsSheet.*` namespace to `designSystem.ts` so the divergence is named, not arbitrary.

### 1.2 Backdrop = light dim, tap-to-close

- Backdrop tint: `rgba(0, 0, 0, 0.32)` (lighter than `glass.bottomSheet.scrim.color` 0.55 — preserves the photographic Home behind it as in the screenshot).
- `BottomSheetBackdrop` config: `appearsOnIndex={0}`, `disappearsOnIndex={-1}`, `pressBehavior="close"` (same pattern as `TicketCartSheet.tsx:246-256`).
- No blur on the backdrop — keep it a flat dim so the sheet's own frost reads as the "depth" layer.

### 1.3 Sheet canvas

- Background: pure `#FFFFFF` with `borderTopLeftRadius` + `borderTopRightRadius` = `28` (matches `glass.bottomSheet.topRadius`).
- Sheet shadow: `glass.bottomSheet.shadow` (negative-Y offset upward shadow at the sheet's leading edge).
- Handle: `glass.bottomSheet.handle` tokens BUT recolour to `rgba(0,0,0,0.18)` (the white handle on the dark variants reads invisible on a white sheet). Width 36, height 4, radius 2, marginTop 8, marginBottom 12 — unchanged.
- Single snap point: `snapPoints={["88%"]}` (one snap; matches today's `SHEET_HEIGHT = SCREEN_HEIGHT * 0.88`). NO half-snap. `enablePanDownToClose` engaged.

---

## 2. Header zone

Layout from top to bottom inside the sheet:

```
┌─────────────────────────────────────────────────────────┐
│                       ──────                            │  ← drag handle (36×4)
│                                                         │
│   Notifications  [1 new]                          [×]   │  ← title row
│   Stay updated on what matters.                         │  ← subtitle (≤ 1 line)
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │ ✓✓ Mark all as read    │    🗑 Clear all       │   │  ← action row pill
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 2.1 Title row

- `Notifications` — `fontSize: 28, fontWeight: '700', color: '#111827'` (matches `colors.gray.900`), `letterSpacing: -0.4`.
- `[N new]` pill — adjacent to title, vertical-centered on the title's cap-height baseline (not the bottom). Pill chrome:
  - Background: `rgba(235, 120, 37, 0.10)` (`colors.accent` at 10%)
  - Text: `colors.accent` `#eb7825`, `fontSize: 13, fontWeight: '600'`
  - Padding: `paddingHorizontal: 10, paddingVertical: 4`
  - Radius: `999` (full pill)
  - **Hidden** when `unreadCount === 0` (no "0 new" rendering).
- `[×]` close button — top-right corner, vertical-aligned to title:
  - 32×32 circle, `borderRadius: 16`
  - Background: `colors.gray[100]` `#f3f4f6`
  - Icon: `close` (Ionicons) at `size: 18, color: colors.gray[500]` `#6b7280`
  - `hitSlop: 12`
  - `accessibilityLabel: "Close notifications"`, `accessibilityRole: "button"`
  - Per WCAG AA + I-38: the × stays as a redundant close affordance (pan-down-to-close is the gesture; × is the explicit affordance for users who can't perform the pan, e.g. VoiceOver users).

### 2.2 Subtitle

- Text: `Stay updated on what matters.` (new locale key `notifications:header.subtitle`)
- Style: `fontSize: 15, fontWeight: '400', color: colors.gray[500]` `#6b7280`, `lineHeight: 20`
- Margin: `marginTop: 4` below the title row
- Single line, no `numberOfLines` cap needed (copy is fixed)

### 2.3 Action row (Mark all as read | Clear all)

Per the screenshot, these two actions live in a single horizontal pill with a thin divider between them:

- Container:
  - Background: `rgba(243, 244, 246, 0.7)` (`colors.gray[100]` at 70% so it reads as a soft pill on the white canvas)
  - Radius: `16`
  - Padding: `paddingVertical: 14, paddingHorizontal: 16`
  - Margin: `marginTop: 18, marginHorizontal: 20`
  - `flexDirection: 'row'`, two equal-width children (`flex: 1` each)
- Left half — `Mark all as read`:
  - Icon: `checkmark-done` (Ionicons) `size: 16, color: colors.accent`
  - Label: `Mark all as read`, `fontSize: 14, fontWeight: '600', color: colors.accent`
  - `accessibilityLabel: t('notifications:header.markAllRead')`
  - Hidden when `unreadCount === 0`
- Divider: 1px vertical line, `backgroundColor: 'rgba(0,0,0,0.08)'`, `height: 18`, vertically centered
- Right half — `Clear all`:
  - Icon: `trash-outline` (Ionicons) `size: 16, color: colors.gray[500]`
  - Label: `Clear all`, `fontSize: 14, fontWeight: '500', color: colors.gray[500]`
  - `accessibilityLabel: t('notifications:header.clearAll')`
  - Hidden when `notifications.length === 0`
- **Edge case:** if BOTH halves hidden (truly empty inbox), the entire action-row pill is hidden — the empty-state below takes over the body.
- **Edge case:** if only one half visible, that half takes full width (no flex:1 split), divider hidden.

### 2.4 NO filter chip row

The horizontal `ScrollView` with All/Social/Sessions/Messages chips is **deleted entirely** from the render tree. No replacement. The vertical space gained (~64px) goes to the list body.

---

## 3. List zone

### 3.1 Section header (date group)

```
YESTERDAY
─────────────────────────────────────────
```

- Label: ALL-CAPS, `fontSize: 12, fontWeight: '700', color: 'rgba(0,0,0,0.42)'`, `letterSpacing: 1.2`
- Margin: `marginLeft: 20, marginTop: 24, marginBottom: 12`
- NO horizontal line below the label (the screenshot has no underline; the existing code's `sectionHeaderLine` is removed)
- Section grouping unchanged: Today / Yesterday / This Week / Earlier (existing `groupNotificationsByDate()` logic preserved verbatim)

### 3.2 Notification card anatomy (THE redesign)

This is the heart of the redesign. Premium look per the screenshot.

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   ╭────────╮                                                   │
│   │        │   Marcus Rivera  shared an experience      1d     │
│   │ avatar │                                                   │
│   │   ●    │   📍 Regal Crossroads → Kashin Japanese     ●     │
│   ╰────────╯       Restaurant                                  │
│        ↑                                                       │
│     orange     ╭──────────╮                                    │
│     status     │ 👥 Social │                                   │
│      dot       ╰──────────╯                                    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

#### 3.2.1 Card container

- Background: `#FFFFFF`
- Border: `1px solid rgba(0,0,0,0.06)` — subtle hairline
- Shadow: `glass.notificationsSheet.cardShadow` (new token):
  ```ts
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.05,
  shadowRadius: 8,
  elevation: 2,
  ```
- Radius: `20`
- Padding: `paddingVertical: 16, paddingLeft: 16, paddingRight: 14`
- Margin: `marginHorizontal: 20, marginBottom: 12`
- Pressed state: `opacity: 0.85` (TouchableOpacity `activeOpacity={0.85}`)
- **Unread treatment:** when `!is_read`, background shifts to `rgba(255, 247, 237, 0.6)` (`colors.orange[50]` at 60%) — soft peach tint. No left border (the old `unreadLeftBorder` is deleted; the avatar's status dot + right-side unread dot carry the signal).

#### 3.2.2 Avatar block (left column, fixed 56×56 reserved width)

- Outer wrapper: 56×56 (handles ring + dot positioning)
- Ring:
  - Outer ring stroke: `2px solid rgba(235, 120, 37, 0.35)` for unread, `2px solid rgba(0,0,0,0.06)` for read
  - Ring gap: `2px white` between ring and avatar (achieved via `borderWidth: 2` + a 2px transparent margin OR a nested wrapper)
- Avatar circle: `48×48`, `borderRadius: 24`
- Avatar image: same `48×48`, `resizeMode: 'cover'`. Uses `ImageWithFallback` (existing).
- Initials fallback (when `getAvatarUrl()` null AND `actor_id != null`):
  - Background: linear gradient `['#eb7825', '#f5a623']` (matches `glass.profile.avatar.initialsGradient`)
  - Text: white, `fontSize: 18, fontWeight: '700'`
- Icon fallback (when no actor at all — system notifications like `weekly_digest`, `holiday_reminder`, `trial_ending`):
  - Background: `iconConfig.color + '15'` (existing pattern, 15% alpha tint of the type's accent colour)
  - Icon: `iconConfig.name` at `size: 24, color: iconConfig.color`
  - The orange ring around system-icon avatars uses the SAME unread/read rule (orange-when-unread)
- **Status dot** (orange, bottom-right of avatar):
  - Position: `position: 'absolute', bottom: 0, right: 0` on the avatar wrapper
  - Size: `12×12`, `borderRadius: 6`
  - Background: `colors.accent` `#eb7825`
  - Border: `2px solid #FFFFFF` (ring contrast against the white card)
  - **Visibility rule:** rendered ONLY when `!is_read` (unread marker; mirrors the right-side dot for redundancy at-a-glance on busy lists). Confirmed answer to SPEC §5 open question 5.

#### 3.2.3 Main content column (flex: 1, left padding 12)

- **Row 1 — title + time:**
  - Title: `item.title` (already comes from server, e.g. `"Marcus Rivera shared an experience"`). Rendered as ONE string today, but to match the screenshot's bold-name + regular-verb mixed weight, the SPEC defines a `renderTitleWithBoldActor()` helper that splits on the actor name and renders the actor portion at `fontWeight: '700'`, the rest at `fontWeight: '400'`. Both at `fontSize: 15, color: colors.gray[900], lineHeight: 20`. Actor name source: `data.senderName || data.inviterName || data.userName || data.fromUserName` (matches existing `getInitials()` source-of-truth). When no actor name can be resolved, the full title renders at `fontWeight: '600'` (no split).
  - `numberOfLines: 2` (allow wrap to a second line if the title runs long)
  - Time pill: right-aligned in the same row, `fontSize: 13, fontWeight: '500', color: colors.gray[400]` `#9ca3af`. Time format unchanged (uses existing `formatTimeAgo()` → `1d`, `2w`, `5m`, etc.).
  - Row layout: `flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'`, `gap: 8`.

- **Row 2 — body / location chain (optional):**
  - Source: `item.body` for non-location types (just renders the body text directly).
  - For location-bearing notification types (`board_card_saved`, `paired_user_visited`, `paired_user_saved_card`, `collaboration_invite_received` when `data.placeName` is present), render the row as a **location chain**:
    ```
    📍 <data.fromLocationName>  →  <data.toLocationName>
    ```
    Falls back to single-name when only one side is present:
    ```
    📍 <data.locationName>
    ```
  - Pin icon: `location` (Ionicons) `size: 13, color: colors.accent`
  - Arrow: ` → ` (literal arrow character with spaces) `color: colors.gray[400]`
  - Name text: `fontSize: 14, fontWeight: '500', color: colors.gray[700]`, `numberOfLines: 2`
  - **Constitution #9 compliance:** if no location data fields exist, the row is OMITTED entirely. NO placeholder string. Per Phase 0 read of `useNotifications.ts` ServerNotification type, location data comes from `data: Record<string, unknown>` — fields are best-effort. Helper `getNotificationLocation(item: ServerNotification): { from?: string; to?: string } | null` returns null when nothing renderable is present.
  - Margin: `marginTop: 8`

- **Row 3 — category pill (always present):**
  - Pill chrome (per-category colour mapping — answer to SPEC §5 open question 3):
    | Category | Background | Text | Icon (Ionicons) |
    |---|---|---|---|
    | Social (`getFilterCategory()==='social'`) | `rgba(235, 120, 37, 0.12)` | `colors.accent` `#eb7825` | `people` |
    | Sessions (`'sessions'`) — labelled **Plans** in UI | `rgba(59, 130, 246, 0.10)` | `#2563eb` (blue-600) | `calendar` |
    | Messages (`'messages'`) — labelled **Chats** in UI | `rgba(139, 92, 246, 0.10)` | `#7c3aed` (violet-600) | `chatbubble` |
    | All / catch-all (`'all'`) — labelled **System** in UI | `rgba(107, 114, 128, 0.10)` | `colors.gray[600]` `#4b5563` | `notifications` |
  - Pill geometry: `paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999`, `flexDirection: 'row', alignItems: 'center', gap: 5`, `alignSelf: 'flex-start'` (does NOT stretch full-width)
  - Icon size: `12`
  - Label: `fontSize: 12, fontWeight: '600'`
  - Locale keys: NEW `notifications:categoryLabels.social = "Social"`, `categoryLabels.sessions = "Plans"`, `categoryLabels.messages = "Chats"`, `categoryLabels.all = "System"` (operator's INTAKE wording: "All, Social, Plans and Chat" — the redesign maps the internal `sessions/messages` enum keys to the operator's `Plans/Chats` UI labels).
  - Margin: `marginTop: 10`

- **Row 4 — action buttons (only when `ACTIONABLE_TYPES[type]` matches):**
  - Layout identical to today (`actionButtons` row with Accept + Decline TouchableOpacity), but restyled to fit the premium card:
    - Accept button: `backgroundColor: colors.accent` `#eb7825`, `paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, minHeight: 40 (NOT 44 — the whole card is the touch target; the inner buttons are secondary CTAs)`, text: `fontSize: 14, fontWeight: '600', color: '#FFFFFF'`
    - Decline button: `backgroundColor: colors.gray[100]`, same geometry, text: `fontSize: 14, fontWeight: '500', color: colors.gray[700]`
  - Row: `flexDirection: 'row', gap: 8, marginTop: 12`
  - Pending state: `<ActivityIndicator size="small" color={colors.accent} />` aligned left at same `marginTop: 12`
  - Error state: existing red error text retained, `marginTop: 8`

- **Row 5 — right-side unread dot (absolute-positioned, NOT in the column flow):**
  - Position: `position: 'absolute', top: 18, right: 12`
  - Size: `8×8`, `borderRadius: 4`
  - Background: `colors.accent` `#eb7825`
  - **Visibility rule:** rendered ONLY when `!is_read`. Mirrors the avatar status dot in §3.2.2 (intentional redundancy — left-edge dot for quick scan when scrolling, right-edge dot to balance the card visually with the time label above it).

### 3.3 Spacing scale (whole card stack)

- Sheet horizontal padding for cards: 20px each side
- Card-to-card vertical gap: 12px (via `marginBottom: 12` on each card)
- Section-to-first-card gap: 12px (via section header `marginBottom`)
- Section-to-section gap: 12px (next section header's `marginTop: 24` minus prior card's `marginBottom: 12`)
- Sheet content `paddingTop`: 0 (handle has its own marginBottom)
- Sheet content `paddingBottom`: `Math.max(insets.bottom, 16) + 16` (extra 16px so the last card breathes above the safe-area)

---

## 4. State variants

### 4.1 Empty state (`notifications.length === 0 && !isOffline && !isLoading && !isError`)

Centred vertically in the body area (≥ 60% of sheet height). NO change from today's design language — keep the icon-circle + title + subtitle pattern, just refresh tokens:

- Icon circle: 80×80, `backgroundColor: rgba(243, 244, 246, 0.6)`, `borderRadius: 40`
- Icon: `notifications-outline` Ionicons, `size: 40, color: colors.gray[300]`
- Title: existing `notifications:emptyState.title` "You're all caught up", `fontSize: 17, fontWeight: '600', color: colors.gray[800], marginTop: 16`
- Subtitle: existing `notifications:emptyState.subtitle` "New activity will show up here.", `fontSize: 14, color: colors.gray[500], marginTop: 6`

### 4.2 Loading state (`isLoading && notifications.length === 0`)

Three skeleton cards stacked. Each card uses the same outer chrome as a real card (radius 20, white, hairline, shadow), with shimmer placeholders for avatar + 2 lines + 1 pill:

- Skeleton avatar: 48×48 circle, `backgroundColor: rgba(0,0,0,0.06)`
- Skeleton title line: width 70%, height 14, `backgroundColor: rgba(0,0,0,0.06)`, `borderRadius: 4`
- Skeleton body line: width 90%, height 12, `backgroundColor: rgba(0,0,0,0.06)`, `borderRadius: 4`, `marginTop: 8`
- Skeleton pill: width 60, height 22, `backgroundColor: rgba(0,0,0,0.06)`, `borderRadius: 11`, `marginTop: 10`
- Pulse animation: optional in v1 (operator may defer to follow-up); for v1 use static placeholders.

### 4.3 Error state (`isError`)

Same centred layout as empty, with:
- Icon: `alert-circle-outline`, `size: 48, color: colors.error[400]`
- Title: existing `notifications:errorState.title` "Something went wrong"
- Subtitle: existing `notifications:errorState.subtitle` "Couldn't load notifications."
- Retry button: `backgroundColor: colors.accent`, label `Try Again`, geometry matches Accept button in §3.2.4 Row 4

### 4.4 Offline banner (`isOffline && notifications.length > 0`)

Pinned strip below the action row, above the list:
- Background: `rgba(243, 244, 246, 1)`
- Padding: `paddingHorizontal: 16, paddingVertical: 10`
- Margin: `marginHorizontal: 20, marginTop: 12, marginBottom: 8`
- Radius: `12`
- Icon: `cloud-offline-outline`, `size: 14, color: colors.gray[500]`
- Text: existing `notifications:offline.banner`, `fontSize: 13, color: colors.gray[600]`
- Layout: `flexDirection: 'row', alignItems: 'center', gap: 8`

### 4.5 Submitting state (per-card)

Existing pendingActions Set logic preserved. Action buttons replaced by ActivityIndicator (see §3.2.4 Row 4).

---

## 5. Motion

- Sheet open: `@gorhom/bottom-sheet` default spring (mass 1, stiffness 380, damping 28 in v5 default config — not overridden)
- Sheet close (via × tap OR backdrop tap): `sheetRef.current?.close()` → bottom-sheet's default close animation (~250ms)
- Sheet close (via pan-down gesture): native gesture velocity feeds the spring — feels right out of the box; no override
- Card press: `activeOpacity={0.85}` on the outer TouchableOpacity (no scale animation — keeps the list feeling responsive on rapid scroll)
- Mark-all-read tap: existing `Haptics.notificationAsync(NotificationFeedbackType.Success)` if present, else `Haptics.impactAsync(ImpactFeedbackStyle.Light)`. NEW — wire if missing.
- Pull-to-refresh: keep RN `SectionList` `onRefresh` behaviour wrapped in `BottomSheetSectionList` (see §6 below)

---

## 6. List virtualisation inside the bottom sheet

The current implementation uses `SectionList` directly. Inside `@gorhom/bottom-sheet` v5, you MUST use `BottomSheetSectionList` (the bottom-sheet-aware wrapper) instead of the raw RN `SectionList`. Otherwise:
- Pan-down gestures on the list body are captured by the list's scroll handler instead of the sheet's pan handler → sheet won't dismiss when the list is scrolled to the top and the user drags down.
- The bottom-sheet's auto-keyboard handling + scroll-locking doesn't engage.

`@gorhom/bottom-sheet` v5 exports: `BottomSheetView`, `BottomSheetScrollView`, `BottomSheetFlatList`, `BottomSheetSectionList`, `BottomSheetTextInput`. Use `BottomSheetSectionList` and pass all current SectionList props through verbatim (sections, keyExtractor, renderItem, renderSectionHeader, etc.).

---

## 7. Token additions to `designSystem.ts`

Add a new sibling namespace `glass.notificationsSheet` (do NOT mutate the existing `glass.bottomSheet` dark-canvas tokens):

```ts
// ORCH-0975 — Light-canvas notifications sheet tokens. Sibling to glass.bottomSheet
// (dark canvas, ExpandedCardModal / TicketCartSheet) — notifications sheet sits
// over the Home tab and needs a light frosted-white treatment to read as the
// OS notification-center mental model. Consumed exclusively by NotificationsSheet.tsx.
notificationsSheet: {
  canvas: '#FFFFFF',
  topRadius: 28,
  backdropTint: 'rgba(0, 0, 0, 0.32)',
  handle: {
    color: 'rgba(0, 0, 0, 0.18)',
    width: 36,
    height: 4,
    radius: 2,
    marginTop: 8,
    marginBottom: 12,
  },
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardBorder: 'rgba(0, 0, 0, 0.06)',
  cardUnreadBg: 'rgba(255, 247, 237, 0.6)', // colors.orange[50] at 60%
  avatarRing: {
    unread: 'rgba(235, 120, 37, 0.35)',
    read: 'rgba(0, 0, 0, 0.06)',
    width: 2,
    gap: 2,
  },
  statusDot: {
    size: 12,
    color: '#eb7825',
    borderColor: '#FFFFFF',
    borderWidth: 2,
  },
  unreadDotRight: {
    size: 8,
    color: '#eb7825',
  },
  categoryPill: {
    social: { bg: 'rgba(235, 120, 37, 0.12)', text: '#eb7825', icon: 'people' as const },
    sessions: { bg: 'rgba(59, 130, 246, 0.10)', text: '#2563eb', icon: 'calendar' as const },
    messages: { bg: 'rgba(139, 92, 246, 0.10)', text: '#7c3aed', icon: 'chatbubble' as const },
    all: { bg: 'rgba(107, 114, 128, 0.10)', text: '#4b5563', icon: 'notifications' as const },
  },
} as const,
```

All inline-style colours obey the RN-color-format rule (hex / rgb / rgba only — no oklch/lab/color-mix). All touch targets remain ≥ 44pt (card itself = TouchableOpacity ≥ 88pt tall; × button + accept/decline pills have `hitSlop` extension to 44pt).

---

## 8. Accessibility

- × close button: `accessibilityLabel="Close notifications"`, `accessibilityRole="button"`, `hitSlop={12}`
- Mark all as read button: `accessibilityLabel={t('notifications:header.markAllRead')}`, `accessibilityRole="button"`, `accessibilityHint="Marks every unread notification as read"`
- Clear all button: `accessibilityLabel={t('notifications:header.clearAll')}`, `accessibilityRole="button"`, `accessibilityHint="Removes all notifications"`
- Each notification card: `accessibilityRole="button"`, `accessibilityLabel={\`${item.title}. ${item.body}. ${unread ? 'Unread' : 'Read'}. ${formatTimeAgo(item.created_at)} ago\`}`
- Category pill: `accessibilityElementsHidden={true}` (decorative; the card's label includes context)
- Status dots: `accessibilityElementsHidden={true}` (decorative; "Unread" is in the card label)
- Pan-down-to-close: redundant with × button per I-39. VoiceOver users use the × button (announced as "Close notifications"); sighted users get the pan gesture.

---

## 9. Per-platform parity notes (iOS + Android)

- `@gorhom/bottom-sheet` v5 handles both platforms identically when wrapped in `GestureHandlerRootView` (confirmed at `app/_layout.tsx:54` in Phase 0).
- Shadow: iOS uses `shadowColor/shadowOffset/shadowOpacity/shadowRadius`. Android uses `elevation`. Both are included in `cardShadow` token.
- Backdrop tap target on Android: `BottomSheetBackdrop` `pressBehavior="close"` handles touch ripple suppression automatically (no Android-specific override needed).
- StatusBar: do NOT set `statusBarTranslucent` (was on the RN `<Modal>`); the bottom sheet renders inside the existing layout, no status-bar override required.
- Keyboard: this sheet has no TextInput, so the keyboard rule is N/A. If a future iteration adds search/filter input, wrap the input in `BottomSheetTextInput` and the keyboard-avoidance comes free.

---

## 10. What this design EXPLICITLY does NOT change

- The `useNotifications` hook (no changes to query keys, mutation signatures, realtime subscription).
- The `ServerNotification` type or any field semantics.
- The `NOTIFICATION_ICONS` registry or `getIconConfig()` mapping (icons are still used for system-notification avatar fallbacks per §3.2.2).
- The `ACTIONABLE_TYPES` registry or `handleAccept`/`handleDecline` logic (action button restyle only, behaviour unchanged).
- The `groupNotificationsByDate()` helper or section ordering (Today/Yesterday/This Week/Earlier preserved).
- The `formatTimeAgo()` helper or time-string format (`1d`/`2w`/`5m`).
- The OneSignal badge clearing flow.
- The `failedImageIds` fallback-to-initials pattern.
- Realtime subscription, pagination, refresh, or load-more behaviour.

---

**End of DESIGN_ORCH-0975.**
