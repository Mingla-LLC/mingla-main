# SPEC — ORCH-0975 [Consumer notifications sheet redesign]

**Skill:** Mingla forensics (SPEC mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]/`
**Branch:** `ORCH-0975-consumer-notifications-redesign`
**Companion design contract:** `Mingla_Artifacts/design/DESIGN_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md` (READ THIS FIRST — every visual decision lives there)
**Status:** READY FOR IMPLEMENTOR
**Confidence:** H — clean redesign with operator-supplied screenshot, no unknown failure surface, all bottom-sheet primitives already battle-tested by `TicketCartSheet.tsx` and `ExpandedBusinessEventSheet.tsx`

---

## 1. Problem statement

The consumer app's in-app Notification Center (`app-mobile/src/components/NotificationsModal.tsx`, 1109 lines) ships today with three things the operator wants gone:

1. **Filter chip row** (All / Social / Sessions / Messages) takes vertical space and forces the user to triage notifications by category before reading them. Operator wants a single chronological list.
2. **React Native `<Modal>` wrapper** offers no swipe-to-dismiss gesture — users must tap the × close button, the backdrop, or the OS back button. Operator wants a modern bottom-sheet with pan-down-to-close.
3. **Flat card visuals** (small avatar, plain text rows, no per-card category signal) don't match the premium feel of the rest of the consumer app (the discover deck, swipe cards, profile screen all use richer treatments). Operator wants the screenshot's ringed-avatar + bold-name + location-chain + per-card category pill + redundant unread indicators look.

This is a presentation-layer redesign. The server-sync layer (React Query + Supabase Realtime via `useNotifications.ts`) stays untouched.

## 2. Scope and non-goals

### In scope
- Replace `NotificationsModal.tsx`'s RN `<Modal>` wrapper with `@gorhom/bottom-sheet` v5 `BottomSheet` + `BottomSheetSectionList`.
- Delete the filter chip row + `FilterTab` state + `FILTER_TAB_KEYS` constant + `filters.*` locale keys.
- Redesign every notification card per `DESIGN_ORCH-0975` §3.2 (ringed avatar, status dot, bold-actor title split, location chain row, per-category pill, right-side unread dot, redesigned action buttons).
- Redesign header per `DESIGN_ORCH-0975` §2 (title + "N new" pill + subtitle + combined mark-all-read | clear-all action pill + × close button).
- Redesign empty / loading / error / offline / submitting state visuals per `DESIGN_ORCH-0975` §4.
- Add `glass.notificationsSheet` token namespace to `app-mobile/src/constants/designSystem.ts`.
- Add `notifications:header.subtitle` + `notifications:header.newCount` + `notifications:categoryLabels.*` locale keys; delete `notifications:filters.*`.
- Rename the file: `NotificationsModal.tsx` → `NotificationsSheet.tsx`. Update HomePage import. Keep a `NotificationsModal` named-export re-alias from `NotificationsSheet.tsx` for one ORCH cycle (drop in ORCH-0976+) to avoid breaking any incidental import we missed.
- Optional component split: extract `<NotificationCard>` into `app-mobile/src/components/notifications/NotificationCard.tsx` (~250 lines). RECOMMENDED to keep `NotificationsSheet.tsx` under 600 lines, but acceptable to keep inline if implementor prefers (the file already passes today at 1109; splitting is a quality-of-life choice, not a contract).
- Add new strict-grep CI invariant: `NotificationsSheet must not import RN Modal` — guards the migration to `@gorhom/bottom-sheet` from regression.
- Implementor jest happy-path regression test + tester adversarial test (Step 0.5 gate).

### Non-goals (explicitly excluded)
- **No changes to `useNotifications.ts`** — hook signatures, query keys, Realtime subscription, pagination, mutation behaviour all unchanged.
- **No changes to `ServerNotification` type** — field shapes locked.
- **No changes to `NotificationsModalProps` semantics** — additive-only (renamed to `NotificationsSheetProps` with the old name re-exported as a type alias for one cycle).
- **No changes to `HomePage.tsx`** beyond the import path (and component name if rename is taken).
- **No changes to OneSignal push payloads, notify-dispatch edge function, or any backend notification creation path.**
- **No changes to action-handler logic** (handleAccept, handleDecline, handleCardPress) beyond restyle.
- **No changes to category resolution** — `getFilterCategory()` survives as the labelling helper that drives the per-card pill colour. Logic preserved verbatim.
- **No new analytics events** — Mixpanel events fired today (none in `NotificationsModal.tsx`) stay zero.
- **No theme switch** — sheet stays LIGHT canvas; the existing dark `glass.bottomSheet.*` tokens are NOT consumed. New `glass.notificationsSheet.*` namespace handles the light-canvas case (justified in `DESIGN_ORCH-0975` §1.1).
- **Pull-to-refresh** behaviour unchanged (existing `onRefresh` prop still wired to `BottomSheetSectionList`).
- **No accessibility regression** — every TouchableOpacity that had an `accessibilityLabel` keeps one or better.

### Assumptions
- `@gorhom/bottom-sheet` v5.2.8 is installed (verified at `app-mobile/package.json`).
- `GestureHandlerRootView` wraps the app at `app/_layout.tsx:54` (verified Phase 0).
- The `ImageWithFallback` component handles failed avatar URLs (existing, unchanged).
- The operator's screenshot is the binding visual reference; ambiguities resolve in favour of `DESIGN_ORCH-0975`'s explicit token values.

## 2.5 Cross-Surface Impact (MANDATORY per orchestrator INTAKE rule)

| Surface | In scope? | What changes | Files touched |
|---|---|---|---|
| **Consumer iOS** | YES | Notifications sheet UI fully redesigned; pan-down-to-close gesture engaged; new per-card category pill + ringed avatar + status dot. Mark-all-read / clear-all behaviour identical to today (visual only). | `app-mobile/src/components/NotificationsSheet.tsx` (renamed from NotificationsModal.tsx), `app-mobile/src/components/notifications/NotificationCard.tsx` (new, optional split), `app-mobile/src/constants/designSystem.ts` (token addition), `app-mobile/src/i18n/locales/en/notifications.json`, `app-mobile/src/components/HomePage.tsx` (import only) |
| **Consumer Android** | YES | Identical to iOS (`@gorhom/bottom-sheet` v5 is cross-platform; `GestureHandlerRootView` already wraps the app). | Same files as iOS. |
| Business iOS | NO | No notifications sheet in `mingla-business/`. The Marketing Hub Campaigns surface (ORCH-0863) is a separate flow with no shared code. | — |
| Business Android | NO | Same reason. | — |
| Buyer/anonymous Web | NO | Anonymous buyer routes (`/checkout/{eventId}`, `/e/{slug}/{slug}`, `/b/{slug}`) have no notifications surface — anonymous users have no inbox. | — |
| Admin Web | NO | No admin notifications inbox. | — |
| Business Web preview | NO | Same as Business iOS/Android. | — |

**Parity contract:** automatic (shared code — `app-mobile/` is one React Native codebase rendered on iOS + Android via Expo). Each success criterion in §4 has implicit `SC-N-iOS` + `SC-N-Android` mirrors; the tester verifies both platforms in §6 and may NOT skip one. The only platform-divergent risk is the `BottomSheetBackdrop` press-ripple behaviour on Android (handled natively by v5) and the shadow vs elevation rendering (both tokens included). No separate-code-path branches.

**Other surfaces explicitly NOT affected:**
- OneSignal push notification payloads (separate flow, not touched).
- Email-based notifications via Resend (separate flow, not touched).
- The `notify-dispatch` edge function (server-side, not touched).
- The `notifications` table schema or RLS (no DB work).
- The `FriendRequestsModal` shown on top of notifications (separate component, not touched — its z-order stays above the bottom sheet because RN `<Modal>` lives in a separate native window above the React tree where `BottomSheet` mounts).

## 3. File-by-file change list

### 3.1 `app-mobile/src/constants/designSystem.ts` — token addition

**Change type:** ADD a new sibling namespace inside the existing `glass` object. Do NOT mutate `glass.bottomSheet.*` (which serves dark-canvas sheets). Do NOT alter any other token.

**Insertion point:** alphabetical/grouped — after the existing `glass.bottomSheet` block (around line 273-298), insert the new `glass.notificationsSheet` block.

**Content:** verbatim from `DESIGN_ORCH-0975` §7. Includes `canvas`, `topRadius`, `backdropTint`, `handle.*`, `cardShadow.*`, `cardBorder`, `cardUnreadBg`, `avatarRing.*`, `statusDot.*`, `unreadDotRight.*`, `categoryPill.social/sessions/messages/all`.

**Constitution checks:**
- All colour values are hex / rgb / rgba (no oklch/lab/color-mix). ✅ per the RN-color-format rule.
- No mutation of existing tokens — purely additive. ✅

### 3.2 `app-mobile/src/i18n/locales/en/notifications.json` — copy update

**Change type:** ADD 5 keys, DELETE 1 key set.

**Add:**
```json
"header": {
  "title": "Notifications",
  "subtitle": "Stay updated on what matters.",      // NEW
  "newCount": "{{count}} new",                       // NEW — replaces "unread" semantic
  "unread": "{{count}} unread",                      // KEEP for backwards-compat with any other surface
  "markAllRead": "Mark all as read",                 // updated copy: was "Mark all read" → match screenshot
  "clearAll": "Clear all"
},
"categoryLabels": {                                  // NEW namespace
  "social": "Social",
  "sessions": "Plans",
  "messages": "Chats",
  "all": "System"
}
```

**Delete:**
```json
"filters": { ... }   // entire object removed
```

**Verification step the implementor MUST run:** `grep -rn "notifications:filters" mingla-business/ app-mobile/ mingla-admin/ supabase/` should return 0 hits before the locale deletion ships. If hits exist outside the file being deleted from, scope-creep ALERT — stop and flag to orchestrator.

**i18n locales for other languages:** the implementor must mirror the additions/deletions in every `app-mobile/src/i18n/locales/<lang>/notifications.json` that exists. Run `ls app-mobile/src/i18n/locales/` to enumerate; apply the same JSON patch to each. For languages where translations don't exist yet, copy the English value and tag with the existing project convention (likely `/* TODO: translate */` or just verbatim English).

### 3.3 `app-mobile/src/components/NotificationsModal.tsx` → rename → `app-mobile/src/components/NotificationsSheet.tsx`

**Change type:** RENAME via `git mv` (preserves blame), then REWRITE the body per the design contract.

**Rename command:** `git -C app-mobile mv src/components/NotificationsModal.tsx src/components/NotificationsSheet.tsx`

**Re-export shim for one cycle:** at the bottom of the new `NotificationsSheet.tsx`, add:
```ts
/**
 * @deprecated Renamed to NotificationsSheet in ORCH-0975. This alias exists for one cycle
 * (drop in ORCH-0976+). All new imports should target NotificationsSheet directly.
 */
export { NotificationsSheet as NotificationsModal };
```
And mirror at the type level:
```ts
/** @deprecated — see NotificationsSheetProps */
export type NotificationsModalProps = NotificationsSheetProps;
```

**Body rewrite — preserved sections (copy verbatim):**

- Top JSDoc comment header (update first line: `NotificationsModal — V2 Server-Synced Notification Center` → `NotificationsSheet — V2 Server-Synced Notification Center (redesigned ORCH-0975)`)
- Imports of `Icon`, `useNetInfo`, `ImageWithFallback`, `colors/spacing/radius/shadows`, `ServerNotification`, `useTranslation`
- Constant `EMPTY_PENDING_SET`
- Function `getFilterCategory(type: string)` — verbatim (now powers per-card pill colour, not filter state)
- Constant `NOTIFICATION_ICONS` and function `getIconConfig(type: string)` — verbatim (powers no-actor system-icon avatars)
- Constant `ACTIONABLE_TYPES` — verbatim
- Function `formatTimeAgo(isoTimestamp, t)` — verbatim
- Function `groupNotificationsByDate(notifications, t)` — verbatim
- Function `getAvatarUrl(data)` — verbatim
- Function `getInitials(data)` — verbatim
- `interface NotificationsModalProps` — rename to `NotificationsSheetProps`, all fields unchanged
- Component skeleton (`export default function NotificationsSheet({ ...sameProps }: NotificationsSheetProps)`)
- `useTranslation`, `useSafeAreaInsets`, `useNetInfo` calls
- Local state: KEEP `failedImageIds`, `actionErrors`. DELETE `activeFilter` + `setActiveFilter`.
- `filteredNotifications` memo — REPLACE with `const sortedNotifications = notifications` (or just pass `notifications` directly to grouping). Filter state gone.
- `sections` memo — points at `notifications` directly.
- `handleImageError`, `handleAccept`, `handleDecline`, `handleCardPress` callbacks — verbatim.

**Body rewrite — replaced sections:**

| Old section | New section |
|---|---|
| `<Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>` wrapper | `<BottomSheet ref={sheetRef} index={visible ? 0 : -1} snapPoints={SHEET_SNAP_POINTS} enablePanDownToClose onChange={handleSheetChange} backdropComponent={renderBackdrop} backgroundStyle={styles.sheetBackground} handleIndicatorStyle={styles.handleIndicator}>` (mirror `TicketCartSheet.tsx:328-337`) |
| Manual `<View style={styles.sheetOverlay}>` + `<TouchableOpacity backdropTouch>` | `BottomSheetBackdrop` via `renderBackdrop` callback (mirror `TicketCartSheet.tsx:246-256` with `pressBehavior="close"`) |
| Manual `<View style={styles.dragHandleContainer}>` + drag handle View | Built-in `handleIndicatorStyle` prop on `<BottomSheet>` (handle is rendered automatically) |
| Manual `Math.max(insets.bottom, 16)` paddingBottom on `sheetContent` | `paddingBottom` applied inside `BottomSheetView` content; safe-area handled via `useSafeAreaInsets()` (existing) |
| Header row with title + unread count text + actions row of two TouchableOpacity | Header row per `DESIGN_ORCH-0975` §2.1 (title + "N new" pill + × button), subtitle per §2.2, combined action pill per §2.3 |
| `<ScrollView horizontal>` with filter tabs | DELETED entirely |
| `<SectionList>` | `<BottomSheetSectionList>` from `@gorhom/bottom-sheet` (props pass through verbatim) |
| Card render `renderNotification` | Card render per `DESIGN_ORCH-0975` §3.2 (or call out to extracted `<NotificationCard>` if split is taken) |
| Section header render `renderSectionHeader` | Updated per `DESIGN_ORCH-0975` §3.1 (no horizontal line) |
| Skeleton loader `renderSkeleton` | Updated per `DESIGN_ORCH-0975` §4.2 |
| Empty state `<View style={styles.emptyState}>` | Updated per `DESIGN_ORCH-0975` §4.1 |
| Error state `<View style={styles.errorState}>` | Updated per `DESIGN_ORCH-0975` §4.3 |
| Offline banner | Updated per `DESIGN_ORCH-0975` §4.4 |
| StyleSheet block at end | Rewritten — drop `sheetOverlay`/`backdropTouch`/`dragHandleContainer`/`dragHandle`/`filterTab*`/`unreadLeftBorder`/`sectionHeaderLine`/`sheetContent`/`sheetMainBody`; add new styles per design |

**New constants at top of file (after imports):**

```ts
const SHEET_SNAP_POINTS = ['88%'];
```

**New helpers (either inline in this file or in `notifications/NotificationCard.tsx` if split is taken):**

1. `renderTitleWithBoldActor(title: string, actorName: string | null): React.ReactNode` — splits `title` on `actorName`, returns `<Text>` with the actor span at `fontWeight: '700'` and the rest at `fontWeight: '400'`. When `actorName === null` or not found in title, returns single `<Text fontWeight: '600'>{title}</Text>`. Source for `actorName`: `(data?.senderName as string) || (data?.inviterName as string) || (data?.userName as string) || (data?.fromUserName as string) || null` (mirror `getInitials()` source-of-truth).

2. `getNotificationLocation(item: ServerNotification): { from?: string; to?: string } | null` — returns location data if present, else null. Logic:
   - If `data.fromLocationName && data.toLocationName` → `{ from: data.fromLocationName, to: data.toLocationName }`
   - Else if `data.locationName` → `{ from: data.locationName }`
   - Else if `data.placeName` → `{ from: data.placeName }`
   - Else `null`
   - All field reads are `(data?.X as string | undefined)` for type safety.

3. `getCategoryPillConfig(type: string): { bg: string; text: string; icon: string; label: string }` — returns the pill's full visual + locale config. Implementation:
   ```ts
   const category = getFilterCategory(type);
   const tokens = glass.notificationsSheet.categoryPill[category];
   const label = t(`notifications:categoryLabels.${category}`);
   return { ...tokens, label };
   ```

4. `renderBackdrop` callback (in component scope, `useCallback([])`) — exact mirror of `TicketCartSheet.tsx:246-256`:
   ```ts
   const renderBackdrop = useCallback(
     (props: BottomSheetBackdropProps) => (
       <BottomSheetBackdrop
         {...props}
         appearsOnIndex={0}
         disappearsOnIndex={-1}
         pressBehavior="close"
         opacity={0.32}  // matches glass.notificationsSheet.backdropTint alpha
       />
     ),
     [],
   );
   ```

5. `handleSheetChange` callback — when bottom sheet's `onChange` fires with `index === -1`, call `onClose()` (the existing prop). This is what fires on pan-down dismiss + backdrop tap + programmatic close. Mirror `TicketCartSheet.tsx:237-244`.

6. `sheetRef` — `useRef<BottomSheet>(null)`. Imperative `snapToIndex(0)` / `close()` on `visible` change in a `useEffect` (mirror `TicketCartSheet.tsx:192-199`).

### 3.4 `app-mobile/src/components/notifications/NotificationCard.tsx` (NEW, optional split)

If the implementor elects to split: 200-300 lines containing the full card render per `DESIGN_ORCH-0975` §3.2. Props:

```ts
export interface NotificationCardProps {
  notification: ServerNotification;
  isPending: boolean;
  hasError: boolean;
  avatarUrl: string | null;
  initials: string;
  showAvatar: boolean;
  iconConfig: IconConfig;
  actionConfig: { acceptKey: string; declineKey?: string } | undefined;
  onPress: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onImageError: () => void;
  t: TFunction;
}
```

If implementor keeps everything inline in `NotificationsSheet.tsx`, the file is acceptable as-is — both shapes pass the spec. Recommended: split.

### 3.5 `app-mobile/src/components/HomePage.tsx` — import path update

**Change type:** ONE line change.

```diff
-import NotificationsModal from "./NotificationsModal";
+import NotificationsSheet from "./NotificationsSheet";
```

And the JSX usage at line 209:
```diff
-<NotificationsModal
+<NotificationsSheet
   visible={showNotificationsModal}
   ...
/>
```

The state variable `showNotificationsModal` stays as-is (purely local naming; no reader cares).

### 3.6 `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` (NEW CI gate)

Mirror the registry pattern from `orch-0863-marketing-hub-phase-b.mjs` (per memory `feedback_strict_grep_registry_pattern.md` — one script + one workflow job, plug into existing `.github/workflows/strict-grep-mingla-business.yml`).

**Invariant ID:** `I-PROPOSED-ORCH-0975-NOTIFICATIONS-NO-RN-MODAL` (flips to `I-ORCH-0975-NOTIFICATIONS-NO-RN-MODAL` ACTIVE on CLOSE).

**Check:** `NotificationsSheet.tsx` MUST NOT import `Modal` from `react-native`. Specifically:

```js
// Gate C1 — NotificationsSheet must use @gorhom/bottom-sheet, not RN Modal
const sheetFile = 'app-mobile/src/components/NotificationsSheet.tsx';
const sheetSource = fs.readFileSync(sheetFile, 'utf8');
const importsRnModal = /from\s+['"]react-native['"][\s\S]*?Modal[\s\S]*?[;}]/m.test(sheetSource) ||
                       /import\s+\{[^}]*\bModal\b[^}]*\}\s+from\s+['"]react-native['"]/m.test(sheetSource);
if (importsRnModal) {
  fail('C1', `NotificationsSheet.tsx imports RN Modal — must use @gorhom/bottom-sheet instead per ORCH-0975 invariant.`);
}
const importsBottomSheet = /from\s+['"]@gorhom\/bottom-sheet['"]/.test(sheetSource);
if (!importsBottomSheet) {
  fail('C1', `NotificationsSheet.tsx must import from @gorhom/bottom-sheet per ORCH-0975 invariant.`);
}
```

**Gate C2 — filter chip locale keys must not return:**
```js
const localeFile = 'app-mobile/src/i18n/locales/en/notifications.json';
const localeJson = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
if (localeJson.filters !== undefined) {
  fail('C2', `notifications.json must not contain a "filters" namespace per ORCH-0975 (filter chip row deleted).`);
}
```

**Gate C3 — categoryLabels namespace must exist:**
```js
if (!localeJson.categoryLabels || !localeJson.categoryLabels.social) {
  fail('C3', `notifications.json must contain "categoryLabels" namespace with at least "social" key per ORCH-0975.`);
}
```

**Wire into `.github/workflows/strict-grep-mingla-business.yml`** as a new job mirroring the existing ORCH-0863 job pattern.

### 3.7 Test file additions (Step 0.5 gate)

**Implementor happy-path test:** `app-mobile/src/components/__tests__/NotificationsSheet.test.tsx`

- Render `<NotificationsSheet visible={true} notifications={mockNotifications} ...mockProps />`
- Assert: no element with `testID="notifications-filter-chip"` exists (the chip row was deleted)
- Assert: `getByText('Notifications')` resolves
- Assert: `getByText('Stay updated on what matters.')` resolves (subtitle)
- Assert: every mock notification renders with its category pill label visible
- Assert: importing the component does NOT pull in `Modal` from `react-native` (introspect via mocking or a runtime guard)
- **Fail-on-revert proof:** test must fail if the filter ScrollView is reintroduced (re-add the chip row and `getByTestId('notifications-filter-chip')` should resolve → test detects and fails). Implementor reports the fail-on-revert verification commit hash.

**Tester adversarial test:** `app-mobile/src/components/__tests__/NotificationsSheet.tester-adversarial.test.tsx`

- Different angle from happy-path. Suggested attack vectors (tester picks one or more):
  1. **Double-close race:** mock `onClose` to be a spy. Trigger BOTH pan-down dismiss AND × button tap in rapid succession. Assert `onClose` fires exactly once OR is idempotent (no error thrown). Fails if both `<Modal onRequestClose>` and the bottom-sheet `onChange(-1)` both wire to `onClose`.
  2. **Avatar fallback with missing data:** notification with `actor_id=null`, `data={}`, type `weekly_digest`. Assert system-icon fallback renders (icon, not initials, not broken). Constitution #9 — no fabricated initials like "??".
  3. **Location-row graceful degradation:** notification type `direct_message_received` with no `data.locationName` or `data.placeName`. Assert the location chain row is OMITTED entirely (no placeholder string like "Location unknown"). Per Constitution #9.
  4. **Pan-down on populated list mid-scroll:** mock list with 20 notifications, scroll to position 5, then pan down on the sheet handle. Assert sheet dismisses (the gesture handler must route to the sheet, not the list, when initiated on the handle area). This is the most likely real-world bug — picks up if the implementor used raw `SectionList` instead of `BottomSheetSectionList`.
- Tester reports fail-on-revert verification commit hash for the chosen attack.

## 4. Success criteria (testable)

| ID | Criterion |
|---|---|
| SC-01 | Tapping the bell icon on Home opens a bottom sheet that animates up from the bottom (not a slide-from-top modal). |
| SC-02 | The sheet's drag-handle area at the top is visually distinct (subtle dark-gray pill on white canvas) and is grab-targetable for pan gesture. |
| SC-03 | Dragging the sheet handle downward dismisses the sheet (calls `onClose`). Velocity > 500 px/s OR drag distance > 25% of sheet height engages dismiss. |
| SC-04 | Dragging the sheet content downward (when SectionList is scrolled to top) also dismisses. Same threshold as SC-03. |
| SC-05 | Tapping the dimmed area above the sheet (backdrop) dismisses the sheet (calls `onClose`). |
| SC-06 | Tapping the × button in the sheet header dismisses the sheet (calls `onClose`). |
| SC-07 | The filter chip row (All / Social / Sessions / Messages) is NOT present in the rendered tree. `queryByTestId('notifications-filter-chip')` returns null. |
| SC-08 | The sheet header displays exactly: title "Notifications", a "{N} new" pill when `unreadCount > 0`, subtitle "Stay updated on what matters.", and the × button. |
| SC-09 | When `unreadCount === 0`, the "{N} new" pill is hidden (not rendered at all — not rendered with "0"). |
| SC-10 | The combined action pill below the subtitle displays "Mark all as read" (orange) on the left and "Clear all" (gray) on the right, divided by a thin vertical line. |
| SC-11 | When `unreadCount === 0`, the "Mark all as read" half is hidden; "Clear all" takes the full width if `notifications.length > 0`, else the entire action pill is hidden. |
| SC-12 | Notifications are rendered as a flat list grouped by date sections (YESTERDAY, TODAY, THIS WEEK, EARLIER). No category-based filtering. |
| SC-13 | Each notification card has the new visual treatment: ringed avatar (48×48 with 2px ring, orange-on-unread / gray-on-read), orange status dot bottom-right of avatar when unread (12×12 with 2px white border), bold actor name + regular verb in the title, optional location chain row with orange pin + arrow, per-category pill at card bottom (Social/Plans/Chats/System), right-side time-ago + 8×8 orange unread dot when unread. |
| SC-14 | Cards for notification types `friend_request_received`, `pair_request_received`, `collaboration_invite_received`, `trial_ending`, `visit_feedback_prompt` show Accept (+ Decline where applicable) action buttons inline. Button geometry matches `DESIGN_ORCH-0975` §3.2.4 Row 4. |
| SC-15 | Card press behaviour unchanged: actionable types only mark-as-read on tap; non-actionable types delete + navigate on tap (per `handleCardPress` preserved logic). |
| SC-16 | Empty state (no notifications, online, not loading, not error) shows the centered icon + "You're all caught up" + subtitle, with the new spacing/sizing per `DESIGN_ORCH-0975` §4.1. |
| SC-17 | Loading state (`isLoading && notifications.length === 0`) shows three skeleton cards with the new chrome (radius 20, white, hairline border) per `DESIGN_ORCH-0975` §4.2. |
| SC-18 | Error state (`isError`) shows the error icon, title, subtitle, and orange Try Again button per `DESIGN_ORCH-0975` §4.3. |
| SC-19 | Offline state (`isOffline && notifications.length > 0`) shows the gray offline banner above the list per `DESIGN_ORCH-0975` §4.4. |
| SC-20 | iOS: rendering on iPhone 15 simulator (390×844) shows no horizontal scroll, no clipped text in the action pill, and the sheet snaps to 88% height. |
| SC-21 | Android: rendering on Pixel 7 emulator (412×892) shows identical layout, same snap point, and `BottomSheetBackdrop` press-to-close behaviour. |
| SC-22 | `getFilterCategory()` function exists and returns the correct category for every notification type defined in `NOTIFICATION_ICONS` — verified by unit test. |
| SC-23 | Locale file `notifications.json` no longer contains the `filters` namespace; contains the new `categoryLabels` namespace with all four keys (`social`, `sessions`, `messages`, `all`). |
| SC-24 | `useNotifications.ts` hook is BIT-IDENTICAL to its pre-change state (verified by `git diff HEAD app-mobile/src/hooks/useNotifications.ts` returning empty). |
| SC-25 | `HomePage.tsx` diff is exactly one import-path change and one component-name change in the JSX (verified by `git diff --stat HEAD app-mobile/src/components/HomePage.tsx` showing ≤ 3 lines changed). |
| SC-26 | New strict-grep CI gate `orch-0975-notifications-sheet.mjs` passes on the branch. Gate fails on `main` if reverted (verified by running `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` against `main` after the rename — expect failure because `NotificationsSheet.tsx` won't exist on main). |
| SC-27 | Implementor happy-path jest test passes AND fails-on-revert (re-add filter ScrollView → test fails). |
| SC-28 | Tester adversarial jest test passes AND fails-on-revert against a different angle (pick from §3.7 list). |
| SC-29 | Constitution #3 — no silent failures. Mark-all-read failure surfaces a toast or inline error (existing `handleAccept` error path preserved). |
| SC-30 | Constitution #9 — no fabricated data. Cards with missing location data hide the location row entirely; cards with missing actor name render the title without the bold-split. |
| SC-31 | WCAG AA I-38 — every interactive Pressable / TouchableOpacity has a touch target ≥ 44pt (card itself ≥ 88pt; × button + action pill halves have `hitSlop` extending to 44pt). |
| SC-32 | WCAG AA I-39 — every interactive Pressable / TouchableOpacity has an `accessibilityLabel`. Pan-down-to-close gesture is supplementary (× button retains explicit close affordance for VoiceOver). |
| SC-33 | File rename preserves git blame (verified by `git log --follow app-mobile/src/components/NotificationsSheet.tsx` showing pre-rename history). |
| SC-34 | Re-export shim works: `import NotificationsModal from './NotificationsSheet'` resolves correctly (verified by adding a transient import in a test file or by `tsc --noEmit`). |
| SC-35 | EAS OTA-eligible — `git diff HEAD app-mobile/package.json app-mobile/app.config.ts app-mobile/eas.json app-mobile/ios app-mobile/android` returns empty (no native module added, no native config touched). |

## 5. Invariants

### Preserved (must not break)
- **I-PROPOSED-J — Zustand persist no server snapshots:** notifications continue to be served via React Query from `useNotifications`. No Zustand persistence introduced.
- **I-38 — IconChrome touch ≥ 44pt:** every Pressable retains ≥ 44pt touch target.
- **I-39 — explicit accessibilityLabel on interactive Pressable:** every Pressable has an `accessibilityLabel`.
- **RN inline-style colours — hex/rgb/hsl/hwb only:** new tokens use rgba/hex only.
- **Toast needs absolute wrap:** N/A this sheet has no toast.
- **Keyboard never blocks an input field:** N/A this sheet has no TextInput.
- **Anon-tolerant buyer routes:** N/A consumer authenticated surface.
- **Back listener disarm pattern:** N/A `@gorhom/bottom-sheet` v5 manages its own back-button hook on Android via gesture-handler.
- **Strict-grep registry pattern:** new gate plugs into existing `strict-grep-mingla-business.yml` as one script + one job.

### NEW (established by this ORCH)
- **I-PROPOSED-ORCH-0975-NOTIFICATIONS-NO-RN-MODAL:** `app-mobile/src/components/NotificationsSheet.tsx` MUST NOT import `Modal` from `react-native`. Codifies the migration to `@gorhom/bottom-sheet`. Enforced by `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` Gate C1. Flips to ACTIVE on CLOSE.
- **I-PROPOSED-ORCH-0975-NOTIFICATIONS-NO-FILTER-CHIPS:** locale file `notifications.json` MUST NOT contain a `filters` namespace. Codifies the deletion of filter chip row. Enforced by Gate C2.
- **I-PROPOSED-ORCH-0975-NOTIFICATIONS-CATEGORY-LABELS-EXIST:** locale file MUST contain a `categoryLabels` namespace with `social/sessions/messages/all` keys. Codifies the per-card pill label requirement. Enforced by Gate C3.

## 6. Test cases (full matrix)

| ID | Scenario | Input | Expected | Layer | Notes |
|---|---|---|---|---|---|
| T-01 | Sheet open on bell tap | `setShowNotificationsModal(true)` | Sheet animates up from bottom; backdrop dims; handle visible at top | Component | iOS + Android |
| T-02 | Sheet close on × tap | × button press | `onClose` fires; sheet animates down | Component | iOS + Android |
| T-03 | Sheet close on backdrop tap | Tap dimmed area above sheet | `onClose` fires; sheet animates down | Component | iOS + Android |
| T-04 | Sheet close on pan-down (handle) | Pan handle area down ≥ 25% height OR velocity > 500 px/s | `onClose` fires; sheet animates down | Component | iOS + Android (uses `@gorhom/bottom-sheet` native pan) |
| T-05 | Sheet close on pan-down (content at top) | Scroll list to top; pan content area down | `onClose` fires | Component | iOS + Android |
| T-06 | Sheet does NOT close on pan-down mid-scroll | Scroll list to position 5; pan down | List scrolls up; sheet stays open | Component | Verifies `BottomSheetSectionList` used (not raw SectionList) |
| T-07 | No filter chips rendered | Inspect render tree | `queryByTestId('notifications-filter-chip')` null | Component | Regression |
| T-08 | Header title + new-count pill | `unreadCount=3` | "Notifications" + "3 new" pill visible | Component | |
| T-09 | New-count pill hidden when no unread | `unreadCount=0` | "3 new" pill NOT rendered (not "0 new") | Component | Constitution #9 |
| T-10 | Subtitle always visible | Any state | "Stay updated on what matters." visible below title | Component | |
| T-11 | Mark all as read tap | Tap mark-all-read half of action pill | `onMarkAllRead` fires; haptics light impact | Component | |
| T-12 | Clear all tap | Tap clear-all half | `onClearAll` fires | Component | |
| T-13 | Mark all as read hidden when no unread | `unreadCount=0, notifications.length>0` | Only "Clear all" half visible, full width | Component | |
| T-14 | Entire action pill hidden when empty | `notifications.length=0` | Action pill NOT rendered; empty state shows below header | Component | |
| T-15 | Date section grouping | Mock with notifications across all 4 buckets | Sections render in order: Today → Yesterday → This Week → Earlier | Component | Existing logic preserved |
| T-16 | Card with avatar URL | `data.senderAvatarUrl="https://..."` | Image renders inside ringed circle; orange ring when unread, gray when read | Component | |
| T-17 | Card with broken avatar URL | `data.senderAvatarUrl="https://broken"` | Initials fallback renders inside ringed circle with orange→gold gradient bg | Component | `ImageWithFallback` onError path |
| T-18 | Card with no actor | `actor_id=null, data={}, type='weekly_digest'` | System icon (bar-chart-outline orange) renders inside ringed circle; orange ring when unread | Component | Constitution #9 |
| T-19 | Status dot on unread | `is_read=false` | 12×12 orange dot with white border at avatar bottom-right | Component | |
| T-20 | Status dot hidden on read | `is_read=true` | No dot on avatar | Component | |
| T-21 | Right-side unread dot on unread | `is_read=false` | 8×8 orange dot at card top-right | Component | |
| T-22 | Right-side unread dot hidden on read | `is_read=true` | No dot on card right | Component | |
| T-23 | Bold actor name split | `title="Marcus Rivera shared an experience", data.senderName="Marcus Rivera"` | "Marcus Rivera" bold + " shared an experience" regular | Component | renderTitleWithBoldActor() |
| T-24 | Title without actor split | `title="Welcome to Mingla", actor_id=null` | Single semibold text, no split | Component | renderTitleWithBoldActor() null-actor branch |
| T-25 | Location chain (both sides) | `data.fromLocationName="Regal Crossroads", data.toLocationName="Kashin"` | "📍 Regal Crossroads → Kashin" row | Component | |
| T-26 | Location single name | `data.locationName="Cafe X"` | "📍 Cafe X" row (no arrow) | Component | |
| T-27 | Location row omitted | `data={}` (no location fields) | Row NOT rendered (no placeholder string) | Component | Constitution #9 |
| T-28 | Category pill Social | `type='friend_request_accepted'` | "Social" pill, orange chrome | Component | getFilterCategory='social' |
| T-29 | Category pill Plans | `type='collaboration_invite_received'` | "Plans" pill, blue chrome | Component | getFilterCategory='sessions' |
| T-30 | Category pill Chats | `type='direct_message_received'` | "Chats" pill, purple chrome | Component | getFilterCategory='messages' |
| T-31 | Category pill System | `type='weekly_digest'` | "System" pill, gray chrome | Component | getFilterCategory='all' |
| T-32 | Action buttons on actionable type | `type='friend_request_received'` | Accept (orange) + Decline (gray) buttons render | Component | |
| T-33 | Accept tap | Tap Accept | `onAcceptFriendRequest(requestId, notificationId)` fires | Component | |
| T-34 | Decline tap | Tap Decline | `onDeclineFriendRequest(...)` fires | Component | |
| T-35 | Pending state | Card in `pendingActions` set | ActivityIndicator replaces buttons | Component | |
| T-36 | Error state | `actionErrors` includes id | "Action failed. Tap to retry." text below buttons | Component | Constitution #3 |
| T-37 | Card press non-actionable | Tap card type `weekly_digest` | `onDeleteNotification(id)` + `onClose()` + `onNotificationTap(item)` | Component | Existing handleCardPress logic |
| T-38 | Card press actionable | Tap card type `friend_request_received` | `onMarkAsRead(id)` only (NOT delete) + `onClose()` + `onNotificationTap` | Component | Existing handleCardPress logic |
| T-39 | Empty state | `notifications=[], isLoading=false, isError=false, !isOffline` | Centered icon + "You're all caught up" + subtitle | Component | |
| T-40 | Loading state | `isLoading=true, notifications=[]` | Three skeleton cards | Component | |
| T-41 | Error state | `isError=true` | Error icon + title + subtitle + Try Again button | Component | |
| T-42 | Offline banner | `isOffline=true, notifications.length>0` | Gray offline banner above list | Component | |
| T-43 | Pull-to-refresh | Swipe down on list (when scrolled to top, before sheet dismiss kicks in) | `onRefresh()` fires; list shows refresh indicator | Hook+Component | |
| T-44 | Load more | Scroll to end with `hasMore=true` | `onLoadMore()` fires | Hook+Component | |
| T-45 | iOS visual parity | iPhone 15 sim, render with mock notifications | Pixel-perfect match to screenshot (within 8pt tolerance) | Sim | Tester live-fire |
| T-46 | Android visual parity | Pixel 7 emu, render with mock notifications | Identical to iOS (within RN platform deltas) | Emu | Tester live-fire |
| T-47 | useNotifications hook unchanged | `git diff HEAD app-mobile/src/hooks/useNotifications.ts` | Empty diff | CI | Static |
| T-48 | HomePage unchanged except import | `git diff --stat HEAD app-mobile/src/components/HomePage.tsx` | ≤ 3 lines | CI | Static |
| T-49 | Strict-grep gate passes on branch | Run `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` | exit 0 | CI | |
| T-50 | Strict-grep gate fails on revert | Revert the file rename, re-run gate | exit 1 with Gate C1 message | CI | Regression |

## 7. Implementation order

1. **Token addition** — patch `app-mobile/src/constants/designSystem.ts` to add `glass.notificationsSheet.*`.
2. **Locale update** — patch `app-mobile/src/i18n/locales/en/notifications.json` (add `header.subtitle`, `header.newCount`, `categoryLabels.*`; delete `filters.*`). Mirror in every other `locales/<lang>/notifications.json`.
3. **Rename** — `git mv app-mobile/src/components/NotificationsModal.tsx app-mobile/src/components/NotificationsSheet.tsx`.
4. **Component rewrite** — replace body per §3.3. Either keep inline OR split out `notifications/NotificationCard.tsx` (implementor choice; recommended split).
5. **HomePage import** — patch `app-mobile/src/components/HomePage.tsx` (import + JSX usage).
6. **Strict-grep gate** — write `.github/scripts/strict-grep/orch-0975-notifications-sheet.mjs` mirroring the registry pattern; wire into `.github/workflows/strict-grep-mingla-business.yml`.
7. **Implementor jest test** — `app-mobile/src/components/__tests__/NotificationsSheet.test.tsx` with happy-path + fails-on-revert verification commit hash.
8. **Self-verification** — run `npm test --workspace app-mobile -- NotificationsSheet`, run `node .github/scripts/strict-grep/orch-0975-notifications-sheet.mjs`, run `tsc --noEmit`, and confirm `git diff HEAD app-mobile/src/hooks/useNotifications.ts` is empty.
9. **Implementor report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md` with file inventory + fails-on-revert hash + screenshots-pending (operator-attested).

## 8. Regression prevention

- **Structural safeguard:** strict-grep Gate C1 prevents anyone reintroducing RN `Modal` in `NotificationsSheet.tsx`. Gate C2 prevents reintroducing the filter chips locale. Gate C3 ensures the category labels namespace stays present.
- **Test safeguard:** Step 0.5 implementor + adversarial regression tests fail-on-revert. Append-only enforced by `.github/workflows/tests-append-only.yml`.
- **Protective comment (top of `NotificationsSheet.tsx`):** one short note: `// ORCH-0975 — wraps @gorhom/bottom-sheet v5 (NOT RN Modal). Pan-down dismisses; × is the redundant explicit affordance for VoiceOver. Filter chips intentionally removed — getFilterCategory survives only for per-card pill labelling.`
- **Pattern compliance:** the component follows `TicketCartSheet.tsx` + `ExpandedBusinessEventSheet.tsx` bottom-sheet patterns verbatim, so future implementors reading those neighbours will recognise the shape.

## 9. Open questions — RESOLVED

| # | Question | Resolution |
|---|---|---|
| 1 | Backdrop behaviour | `BottomSheetBackdrop` with `pressBehavior="close"`, opacity `0.32`, no blur. Lighter than `glass.bottomSheet.scrim` because notifications sit over the bright Home tab, not over dark photo cards. |
| 2 | Snap points | Single snap `['88%']`. No half-snap. Matches today's `SCREEN_HEIGHT * 0.88`. |
| 3 | Category pill colours | Social=orange-on-orange-tint, Plans=blue-on-blue-tint, Chats=violet-on-violet-tint, System=gray-on-gray-tint. Full mapping in DESIGN §3.2 Row 3 table. |
| 4 | Avatar fallback | Three tiers: real image > initials with orange→gold gradient bg > Ionicon from `NOTIFICATION_ICONS` registry. The ring rule (orange-when-unread) applies to all three. |
| 5 | Status dot semantics | Read-state marker (visible when `!is_read`). Mirrors the right-side unread dot for redundancy. NOT online-presence, NOT new-since-last-open. |
| 6 | File split | RECOMMENDED yes — extract `<NotificationCard>` to `app-mobile/src/components/notifications/NotificationCard.tsx`. Acceptable to keep inline if implementor prefers (both shapes pass the spec). |
| 7 | File rename | YES — `NotificationsModal.tsx` → `NotificationsSheet.tsx`. Re-export shim (`export { NotificationsSheet as NotificationsModal }`) for one ORCH cycle. |
| 8 | Regression-test fail-on-revert anchors | Implementor: filter-chip-absence (re-add ScrollView → test fails). Tester (pick one): double-close race / avatar fallback / location-row degradation / pan-down on populated list mid-scroll. |
| 9 | Strict-grep gate | New script `orch-0975-notifications-sheet.mjs` with 3 gates (C1 no-RN-Modal, C2 no-filters-locale, C3 categoryLabels-exists). Wired into `strict-grep-mingla-business.yml`. |

## 10. Downstream routing

After this SPEC passes orchestrator REVIEW:

1. **IMPLEMENT** → Claude `mingla-implementor`. Pre-flight `/ui-ux-pro-max` already done via this DESIGN file — implementor consumes the design contract directly and proceeds straight to code. Working tree: `~/Desktop/mingla-orchs/ORCH-0975-[consumer-notifications-redesign]/` on branch `ORCH-0975-consumer-notifications-redesign`. Expected output: code changes per §7 + `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`.

2. **TEST** → Claude `mingla-tester` (canonical post-META-ORCH-0755 reversal). Default tester per memory rule. iOS Simulator + Android Emulator parity MANDATORY (per Phase 7 of TARGETED protocol). Operator-attested live-fire on physical iPhone for pan-down feel.

3. **CLOSE** → Claude `mingla-orchestrator` (this session). Includes Step 0.5 regression-test gate verification, Step 1 artifact updates, Step 2 commit message with `[deploy]` tag (NO — `app-mobile/` is not a Vercel surface; `[deploy]` is NOT required), Step 3 EAS OTA publish (REQUIRED — pure-JS change, OTA-eligible).

## 11. Constitution checklist

| # | Principle | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | PRESERVED | Every Pressable wires to a handler (card press, action buttons, ×, mark-all, clear-all). |
| 2 | One owner per truth | PRESERVED | Notifications owned by React Query via `useNotifications`. No Zustand introduced. |
| 3 | No silent failures | PRESERVED | Action errors surface via `actionErrors` set + inline "Action failed. Tap to retry." Constitution #3 path unchanged. |
| 4 | One query key per entity | PRESERVED | `useNotifications` uses `circleKeys` factory — unchanged. |
| 5 | Server state server-side | PRESERVED | No Zustand persistence of notifications. |
| 6 | Logout clears everything | PRESERVED | No new persisted state. Sheet snap-state is component-local. |
| 7 | Label temporary | N/A | No temporary fixes introduced. |
| 8 | Subtract before adding | APPLIED | Filter chip row deleted before any new visual is added. RN Modal wrapper deleted before bottom-sheet introduced. |
| 9 | No fabricated data | PRESERVED | Location row omitted when fields missing. Title bold-split degrades gracefully. "N new" pill hidden when 0. Initials "??" never rendered (icon fallback instead). |
| 10 | Currency-aware | N/A | No currency display. |
| 11 | One auth instance | N/A | No auth touch. |
| 12 | Validate at right time | N/A | No date validation introduced. |
| 13 | Exclusion consistency | N/A | No generation/serving rule split. |
| 14 | Persisted-state startup | N/A | No new persisted state. |

## 12. Cross-references

- DESIGN contract: `Mingla_Artifacts/design/DESIGN_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md` (READ FIRST).
- Reference patterns: `app-mobile/src/components/expandedCard/TicketCartSheet.tsx`, `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`.
- Hook contract (unchanged): `app-mobile/src/hooks/useNotifications.ts`.
- Caller (1-line touch): `app-mobile/src/components/HomePage.tsx:12, 209`.
- Tokens: `app-mobile/src/constants/designSystem.ts` (add to `glass.*` block, after `glass.bottomSheet`).
- Locales: `app-mobile/src/i18n/locales/en/notifications.json` (and mirror in every other `locales/<lang>/notifications.json`).
- Strict-grep registry pattern memory: `feedback_strict_grep_registry_pattern.md`.
- WCAG memory: `feedback_wcag_aa_kit_invariants.md`.
- RN colour memory: `feedback_rn_color_formats.md`.
- TopSheet ≠ BottomSheet memory: `feedback_topsheet_extended_universal_creator.md` (TopSheet is for top-down sheets; this ORCH uses bottom-sheet, no TopSheet decision implicated).

---

**End of SPEC_ORCH-0975. READY FOR IMPLEMENTOR.**
