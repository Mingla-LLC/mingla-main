# Feature: Global Keyboard Avoidance

**Date:** 2026-03-07
**Status:** Planned
**Requested by:** "When I try to add a friend on the Connections page and type a phone number or search for a country, the keyboard covers the input. I'm tired of fixing this per screen — make keyboard avoidance work everywhere, once and for all."

---

## 1. Summary

The app has **50 files** containing `TextInput`, but only **7** use the custom `KeyboardAwareScrollView` and **14** use the inconsistent `KeyboardAvoidingView`. The remaining **29+ screens have zero keyboard handling** — inputs get covered by the keyboard. This spec standardizes every screen on the two custom keyboard-aware wrappers the app already has (`KeyboardAwareScrollView` for scrollable content, `KeyboardAwareView` for fixed-layout chat/input-bar screens), removes all `KeyboardAvoidingView` usage, and ensures no input field in the app is ever covered by the keyboard again.

**Why NOT `react-native-keyboard-aware-scroll-view` (npm package):**
- Last published in 2020 — abandoned, 400+ open issues
- Does not support React Native New Architecture (Fabric), which this app has enabled (`newArchEnabled: true`)
- Does not support RN 0.81 or React 19
- The app already has a superior custom `KeyboardAwareScrollView` at `src/components/ui/KeyboardAwareScrollView.tsx` that handles both old and new architecture, measures focused inputs correctly, guards against cross-modal ghost scrolling, and integrates with the existing `useKeyboard` hook

The correct approach: **standardize on the existing custom components and apply them systematically to every screen that has a TextInput.**

---

## 2. User Story

As a user, I want every text input in the app to be visible and usable when the keyboard opens, on both iOS and Android, without needing per-screen fixes.

---

## 3. Success Criteria

1. When the keyboard opens on ANY screen with a TextInput, the focused input is fully visible above the keyboard with at least 20px of breathing room — on both iOS and Android.
2. No `KeyboardAvoidingView` import exists anywhere in the codebase after this refactor.
3. Every scrollable screen with a TextInput uses `KeyboardAwareScrollView` from `components/ui/KeyboardAwareScrollView`.
4. Every non-scrollable screen with a TextInput (chat input bars, fixed-position modals) uses `KeyboardAwareView` from `components/ui/KeyboardAwareView`.
5. Every `ScrollView` or `View` wrapping a `TextInput` uses `keyboardShouldPersistTaps="handled"` (already built into `KeyboardAwareScrollView`, must be added to `FlatList` instances manually).
6. The `app.json` `android.softwareKeyboardLayoutMode` remains `"pan"` (already set).
7. On the Connections page "Add Friend" modal specifically: both the country search input and the phone number input are fully visible when the keyboard is open.
8. Tapping a button while the keyboard is open fires the button (not dismissed by first tap) — everywhere.

---

## 4. Database Changes

None.

---

## 5. Edge Functions

None.

---

## 6. Mobile Implementation

### 6.1 Architecture Decision: Two Wrappers, Zero Exceptions

The app needs exactly two keyboard-aware wrappers. Every screen with a TextInput uses one of them. No third pattern exists after this refactor.

| Wrapper | File | Use When |
|---------|------|----------|
| `KeyboardAwareScrollView` | `components/ui/KeyboardAwareScrollView.tsx` | The screen has scrollable content containing TextInputs (forms, settings, search + list, modals with inputs) |
| `KeyboardAwareView` | `components/ui/KeyboardAwareView.tsx` | The screen has a **fixed-position input bar** at the bottom (chat interfaces, discussion tabs) — content above scrolls independently, the input bar pushes up with the keyboard |

**Decision rule for the implementor:** "Does this screen scroll its TextInput(s) as part of the content?" -> `KeyboardAwareScrollView`. "Does this screen have a pinned input bar at the bottom with separate scrollable content above?" -> `KeyboardAwareView`.

### 6.2 Files to Modify — Complete Inventory

Below is every file that needs changes, organized by change type. The implementor must go through every single one. No skipping.

---

#### CATEGORY A: Remove `KeyboardAvoidingView`, replace with `KeyboardAwareScrollView` or `KeyboardAwareView`

These 14 files currently import `KeyboardAvoidingView` from `react-native`. Remove that import and the `KeyboardAvoidingView` wrapper. Replace with the appropriate custom component.

| # | File | Current Pattern | Replace With | Notes |
|---|------|----------------|-------------|-------|
| A1 | `components/LinkFriendSheet.tsx` | `KeyboardAvoidingView` wrapping form content | `KeyboardAwareScrollView` | Form with TextInput — scrollable |
| A2 | `components/MessageInterface.tsx` | `KeyboardAvoidingView` wrapping chat layout | `KeyboardAwareView` | Chat screen — fixed input bar at bottom |
| A3 | `components/profile/EditBioSheet.tsx` | `KeyboardAvoidingView` wrapping bio editor | `KeyboardAwareScrollView` | Single TextInput form in modal |
| A4 | `components/CustomHolidayModal.tsx` | `KeyboardAvoidingView` wrapping form | `KeyboardAwareScrollView` | Form with TextInput |
| A5 | `components/CollaborationPreferences.tsx` | `KeyboardAvoidingView` wrapping preferences | `KeyboardAwareScrollView` | Form/settings with TextInputs |
| A6 | `components/profile/ProfileSettings.tsx` | `KeyboardAvoidingView` wrapping settings | `KeyboardAwareScrollView` | Settings with TextInputs |
| A7 | `components/onboarding/TravelModeStep.tsx` | `KeyboardAvoidingView` wrapping step | `KeyboardAwareScrollView` | Onboarding step with inputs |
| A8 | `components/onboarding/OnboardingShell.tsx` | `KeyboardAvoidingView` wrapping shell | `KeyboardAwareView` | Shell that wraps all onboarding steps — use `KeyboardAwareView` since child steps handle their own scrolling |
| A9 | `components/onboarding/LocationSetupStep.tsx` | `KeyboardAvoidingView` wrapping step | `KeyboardAwareScrollView` | Step with location search input |
| A10 | `components/onboarding/InviteFriendsStep.tsx` | `KeyboardAvoidingView` wrapping step | `KeyboardAwareScrollView` | Step with phone input |
| A11 | `components/board/CardDiscussionModal.tsx` | `KeyboardAvoidingView` wrapping discussion | `KeyboardAwareView` | Discussion with fixed input bar at bottom |
| A12 | `components/activity/ProposeDateTimeModal.tsx` | `KeyboardAvoidingView` wrapping modal | `KeyboardAwareScrollView` | Modal with form inputs |
| A13 | `components/ui/KeyboardAwareScrollView.tsx` | May have stale `KeyboardAvoidingView` import | Remove dead import only | Verify — the component itself does NOT use `KeyboardAvoidingView` |
| A14 | `components/ui/KeyboardAwareView.tsx` | May have stale `KeyboardAvoidingView` import | Remove dead import only | Verify — clean up |

**For each file in Category A, the implementor must:**
1. Open the file
2. Remove the `KeyboardAvoidingView` import from `react-native`
3. Add the import: `import { KeyboardAwareScrollView } from '../ui/KeyboardAwareScrollView'` or `import { KeyboardAwareView } from '../ui/KeyboardAwareView'` (adjust relative path based on file location)
4. Find the `<KeyboardAvoidingView ...>` JSX element
5. Replace it with `<KeyboardAwareScrollView>` or `<KeyboardAwareView>` per the table above
6. Remove any `behavior`, `keyboardVerticalOffset`, or platform-specific `KeyboardAvoidingView` props — the custom components handle all of that internally
7. If the `KeyboardAvoidingView` wrapped a `ScrollView`, remove the inner `ScrollView` and use `KeyboardAwareScrollView` directly (it IS a ScrollView)

---

#### CATEGORY B: Add keyboard awareness — screens with TextInput but NO keyboard handling

These files have `TextInput` but currently have no `KeyboardAvoidingView`, no `KeyboardAwareScrollView`, no `KeyboardAwareView`. They need one.

| # | File | Wrapper to Add | Notes |
|---|------|---------------|-------|
| B1 | `components/connections/AddFriendView.tsx` | Parent modal in `ConnectionsPage.tsx` must wrap content with `KeyboardAwareView` | **THE ORIGINAL BUG** — inside a Modal with no keyboard handling |
| B2 | `components/CollaborationSessions.tsx` | `KeyboardAwareScrollView` | Has TextInput for search |
| B3 | `components/activity/CalendarTab.tsx` | `KeyboardAwareScrollView` | Has TextInput |
| B4 | `components/activity/SavedTab.tsx` | `KeyboardAwareScrollView` | Has TextInput for search |
| B5 | `components/board/BoardDiscussionTab.tsx` | `KeyboardAwareView` | Discussion tab with fixed input bar |
| B6 | `components/ConnectionsPage.tsx` | Add `keyboardShouldPersistTaps="handled"` to the FlatList | Main page — FlatList needs the prop. The AddFriendView modal is the real fix (B1). |
| B7 | `components/DiscoverScreen.tsx` | Add `keyboardShouldPersistTaps="handled"` to any ScrollView/FlatList containing or near the search input | Search input at top |
| B8 | `components/ReportUserModal.tsx` | `KeyboardAwareScrollView` | Modal with TextInput for report reason |
| B9 | `components/board/InviteParticipantsModal.tsx` | `KeyboardAwareScrollView` | Modal with search input |
| B10 | `components/FriendSelectionModal.tsx` | `KeyboardAwareScrollView` | Modal with search input |
| B11 | `components/connections/FriendPickerSheet.tsx` | `KeyboardAwareScrollView` | Sheet with search input |
| B12 | `components/collaboration/CreateTab.tsx` | `KeyboardAwareScrollView` | Tab with form inputs |
| B13 | `components/collaboration/CollaborationFriendsTab.tsx` | `KeyboardAwareScrollView` | Tab with search input |
| B14 | `components/CreateSessionModal.tsx` | Already uses `KeyboardAwareScrollView` — verify it's correct | Should be fine |
| B15 | `components/profile/ProfilePersonalInfoSection.tsx` | `KeyboardAwareScrollView` or verify parent handles it | Profile form with TextInputs |
| B16 | `components/onboarding/CountryPickerModal.tsx` | Add `keyboardShouldPersistTaps="handled"` to the FlatList | Country picker — verify if already present |
| B17 | `components/OnboardingFlow.tsx` | Verify keyboard handling — likely handled by OnboardingShell (A8) | May need no changes |
| B18 | `components/board/BoardSettingsModal.tsx` | Already uses `KeyboardAwareScrollView` — verify | Should be fine |
| B19 | `components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | `KeyboardAwareScrollView` or verify parent handles it | Has TextInput |
| B20 | `components/onboarding/OnboardingCollaborationStep.tsx` | `KeyboardAwareScrollView` | Step with inputs |
| B21 | `components/onboarding/LanguagePickerModal.tsx` | Add `keyboardShouldPersistTaps="handled"` to the FlatList | Picker with search |
| B22 | `components/onboarding/PhoneInput.tsx` | Verify — likely handled by parent OnboardingShell | Reusable component, parent must handle |
| B23 | `components/onboarding/OTPInput.tsx` | Verify — likely handled by parent | Same as above |
| B24 | `components/connections/FriendsTab.tsx` | Add `keyboardShouldPersistTaps="handled"` to FlatList if search input exists | Tab with possible search |
| B25 | `components/connections/MessagesTab.tsx` | Add `keyboardShouldPersistTaps="handled"` to FlatList | Messages tab |
| B26 | `components/board/InviteAcceptScreen.tsx` | `KeyboardAwareScrollView` if it has editable inputs | Verify if TextInput is user-interactive |
| B27 | `components/board/BoardSettingsDropdown.tsx` | Verify — may be handled by parent | Dropdown with input |
| B28 | `components/UserInviteModal.tsx` | `KeyboardAwareScrollView` | Modal with input |
| B29 | `components/SessionSharing.tsx` | `KeyboardAwareScrollView` | Has input |
| B30 | `components/SessionChat.tsx` | `KeyboardAwareView` | Chat interface — fixed input bar |
| B31 | `components/SavedExperiencesPage.tsx` | Add `keyboardShouldPersistTaps="handled"` to ScrollView/FlatList | Search input |
| B32 | `components/BoardDiscussion.tsx` | `KeyboardAwareView` | Discussion with input bar |
| B33 | `components/ui/input-otp.tsx` | Do NOT add wrapper — reusable primitive, parent handles it | Component-level |
| B34 | `components/ui/input.tsx` | Do NOT add wrapper — reusable primitive, parent handles it | Component-level |
| B35 | `components/ui/command.tsx` | Do NOT add wrapper — reusable primitive, parent handles it | Component-level |
| B36 | `components/profile/ProfileAccountSection.tsx` | `KeyboardAwareScrollView` or verify parent handles it | Has inputs |

**For each file in Category B, the implementor must:**
1. Open the file and READ IT FULLY first
2. Identify the outermost container that holds the TextInput(s)
3. If it's a `ScrollView` -> replace with `KeyboardAwareScrollView`
4. If it's a `View` with scrollable content -> wrap with `KeyboardAwareScrollView`
5. If it's a fixed-layout with a pinned input bar -> wrap with `KeyboardAwareView`
6. If it's a `FlatList` or `SectionList` -> add `keyboardShouldPersistTaps="handled"` prop (these cannot be replaced with `KeyboardAwareScrollView` — they are virtualized lists)
7. If it's a reusable component (like `input.tsx`) -> do NOT add a wrapper; the PARENT screen must handle it
8. Add the appropriate import

---

#### CATEGORY C: Already using `KeyboardAwareScrollView` — Verify correctness

These 7 files already use the custom `KeyboardAwareScrollView`. The implementor must open each one and verify:
- The import path is correct
- No redundant `KeyboardAvoidingView` is also present
- `keyboardShouldPersistTaps` is NOT manually set (it's built into the component)

| # | File |
|---|------|
| C1 | `components/PreferencesSheet.tsx` |
| C2 | `components/CreateSessionModal.tsx` |
| C3 | `components/AddPersonModal.tsx` |
| C4 | `components/PersonEditSheet.tsx` |
| C5 | `components/EnhancedBoardModal.tsx` |
| C6 | `components/board/BoardSettingsModal.tsx` |

---

### 6.3 Specific Fix for the Original Bug: AddFriendView in Connections Modal

The `AddFriendView` is rendered inside a `<Modal>` in `ConnectionsPage.tsx` (line 1244). The modal structure is:

```
Modal -> Pressable (overlay) -> Pressable (sheet) -> View (sheetBody) -> AddFriendView
```

There is NO keyboard handling anywhere in this chain. The fix:

**File: `components/ConnectionsPage.tsx`**

**Change 1:** Import `KeyboardAwareView` at the top:
```typescript
import { KeyboardAwareView } from './ui/KeyboardAwareView';
```

**Change 2:** Wrap the `sheetContainer` Pressable's children with `KeyboardAwareView`:

Replace the inner content of the action panel Modal (around lines 1251-1285):
```tsx
<Pressable style={styles.sheetContainer} onPress={(e) => e.stopPropagation()}>
  <KeyboardAwareView dismissOnTap={false}>
    <View style={styles.sheetHandle} />
    <View style={styles.sheetHeader}>
      {/* ... existing header ... */}
    </View>
    <View style={styles.sheetBody}>
      {/* ... existing body with AddFriendView, RequestsView, BlockedUsersView ... */}
    </View>
  </KeyboardAwareView>
</Pressable>
```

**Why `KeyboardAwareView` here, not `KeyboardAwareScrollView`?** The modal sheet content is short — it doesn't need scrolling. It just needs the content to push up when the keyboard appears. `KeyboardAwareView` adds `paddingBottom` equal to the keyboard height, which pushes the entire sheet content up.

**File: `components/connections/AddFriendView.tsx`**

**Change:** The country picker Modal inside AddFriendView already has a FlatList with `keyboardShouldPersistTaps="handled"` (line 287) — this is correct. No changes needed to AddFriendView itself. The fix is in the parent (ConnectionsPage.tsx).

---

### 6.4 The `KeyboardAwareScrollView` Replacement Pattern

When replacing a `ScrollView` with `KeyboardAwareScrollView`, follow this exact pattern:

**Before:**
```tsx
import { ScrollView, KeyboardAvoidingView, Platform } from 'react-native';

// In JSX:
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={someOffset}
  style={{ flex: 1 }}
>
  <ScrollView
    keyboardShouldPersistTaps="handled"
    contentContainerStyle={styles.content}
  >
    {/* content with TextInputs */}
  </ScrollView>
</KeyboardAvoidingView>
```

**After:**
```tsx
import { KeyboardAwareScrollView } from '../ui/KeyboardAwareScrollView';
// Remove KeyboardAvoidingView from the react-native import

// In JSX:
<KeyboardAwareScrollView contentContainerStyle={styles.content}>
  {/* content with TextInputs */}
</KeyboardAwareScrollView>
```

**What gets removed:**
- `KeyboardAvoidingView` wrapper and its props (`behavior`, `keyboardVerticalOffset`)
- `keyboardShouldPersistTaps="handled"` on the inner ScrollView (already built into `KeyboardAwareScrollView`)
- Any `Platform.OS` ternary for keyboard behavior
- The inner `ScrollView` itself (replaced by `KeyboardAwareScrollView` which IS a ScrollView)

**What gets kept:**
- `contentContainerStyle` — pass it to `KeyboardAwareScrollView`
- Any other `ScrollView` props (`showsVerticalScrollIndicator`, etc.)

---

### 6.5 The `KeyboardAwareView` Replacement Pattern

For chat/discussion screens with a pinned input bar:

**Before:**
```tsx
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : undefined}
  style={{ flex: 1 }}
>
  <FlatList ... /> {/* messages */}
  <View style={styles.inputBar}>
    <TextInput ... />
    <TouchableOpacity onPress={send}>...</TouchableOpacity>
  </View>
</KeyboardAvoidingView>
```

**After:**
```tsx
import { KeyboardAwareView } from '../ui/KeyboardAwareView';

<KeyboardAwareView dismissOnTap={false}>
  <FlatList ... keyboardShouldPersistTaps="handled" /> {/* messages */}
  <View style={styles.inputBar}>
    <TextInput ... />
    <TouchableOpacity onPress={send}>...</TouchableOpacity>
  </View>
</KeyboardAwareView>
```

**Important:** Set `dismissOnTap={false}` on chat screens — users should not accidentally dismiss the keyboard by tapping the message list.

---

### 6.6 No Changes to `app.json`

The `android.softwareKeyboardLayoutMode` is already set to `"pan"` (line 39 of `app.json`). No change needed.

---

### 6.7 No New Dependencies

Do NOT install `react-native-keyboard-aware-scroll-view` or any other npm package. The existing custom components are superior for this codebase.

---

## 7. Implementation Order

**Step 1: Fix the original bug first.**
Modify `ConnectionsPage.tsx` to wrap the action panel modal content with `KeyboardAwareView`. This is the user's immediate pain point. Test it: open Connections -> tap "Add Friend" -> tap the phone number input -> the keyboard must not cover it. Also tap the country picker -> search for a country -> the keyboard must not cover the search input.

**Step 2: Remove all `KeyboardAvoidingView` usage (Category A).**
Go through files A1-A14 one by one. For each file:
1. Read the entire file
2. Remove the `KeyboardAvoidingView` import
3. Replace with the appropriate wrapper per the table
4. Verify the screen still renders correctly

**Step 3: Add keyboard awareness to unprotected screens (Category B).**
Go through files B1-B36 one by one. For each file:
1. Read the entire file
2. Determine the correct wrapper (ScrollView replacement vs. FlatList prop vs. parent handles it)
3. Apply the change
4. Mark as done

**Step 4: Verify Category C files.**
Open C1-C6, confirm they're using `KeyboardAwareScrollView` correctly with no redundant wrappers.

**Step 5: Full integration test.**
Walk through every screen that has a TextInput. On each screen:
1. Tap the TextInput
2. Verify the input is visible above the keyboard
3. Verify tapping a button while keyboard is open works (no "first tap dismisses" bug)
4. Verify dismissing the keyboard works
5. Test on both iOS and Android

---

## 8. Test Cases

| # | Test | Input | Expected Output | Screen |
|---|------|-------|-----------------|--------|
| 1 | Add Friend phone input visibility | Open Connections -> tap Add Friend -> tap phone input | Keyboard opens, phone input is fully visible above keyboard with ~40px breathing room | ConnectionsPage modal |
| 2 | Add Friend country picker search | Open Add Friend -> tap country picker -> type "Uni" | Keyboard opens, search input visible, list shows filtered results, tapping a result works without first dismissing keyboard | AddFriendView country picker modal |
| 3 | Chat input bar pushes up | Open any conversation -> tap message input | Keyboard opens, input bar pushes up to sit on top of keyboard, messages scroll is still accessible | MessageInterface |
| 4 | Profile settings input | Open Profile -> Settings -> tap any editable field | Keyboard opens, field scrolls into view above keyboard | ProfileSettings |
| 5 | Onboarding phone input | Start onboarding -> reach phone input step -> tap input | Keyboard opens, phone input fully visible | OnboardingShell / PhoneInput |
| 6 | Board discussion input | Open a board -> Discussion tab -> tap message input | Keyboard opens, input bar pushes up | BoardDiscussionTab |
| 7 | Session chat input | Open a session chat -> tap input | Keyboard opens, input bar pushes up | SessionChat |
| 8 | Button tap with keyboard open | On any screen with a button below a TextInput -> type in input -> tap button | Button fires immediately without needing to dismiss keyboard first | All screens |
| 9 | Report user modal | Open report modal -> tap reason TextInput | Keyboard opens, TextInput visible | ReportUserModal |
| 10 | No double-scroll on Android | On Android, open any form screen -> focus input | Content scrolls smoothly once (no jerky double-adjustment) | All screens (Android) |
| 11 | Modal keyboard handling | Open any modal with TextInput -> focus input | Content adjusts — keyboard does not cover input even inside modals | All modals |
| 12 | FlatList tap-through | On any screen with FlatList + search -> type search -> tap a list item | List item tap fires immediately | DiscoverScreen, FriendPickerSheet, etc. |

---

## 9. Common Mistakes to Avoid

1. **Wrapping a `FlatList` inside `KeyboardAwareScrollView`:** Never nest a virtualized list (`FlatList`, `SectionList`) inside a `ScrollView`/`KeyboardAwareScrollView` — it destroys virtualization and causes "VirtualizedList should never be nested" warnings. For screens with a FlatList + TextInput, either: (a) use `FlatList`'s `ListHeaderComponent` to place the TextInput, or (b) wrap the whole layout with `KeyboardAwareView` (padding approach), or (c) just add `keyboardShouldPersistTaps="handled"` to the FlatList and let the input handle its own scroll-into-view.

2. **Removing ScrollView props when replacing:** When swapping `<ScrollView>` for `<KeyboardAwareScrollView>`, do NOT drop existing props like `showsVerticalScrollIndicator={false}`, `bounces`, `contentContainerStyle`, etc. `KeyboardAwareScrollView` accepts all `ScrollViewProps` — pass them through.

3. **Adding `KeyboardAwareScrollView` to reusable primitive components:** Components like `input.tsx`, `input-otp.tsx`, `command.tsx` are reusable primitives. Do NOT add keyboard wrappers inside them — the PARENT screen is responsible for keyboard handling. Adding a ScrollView inside a reusable input component would break every screen that uses it.

4. **Using `KeyboardAwareView` when `KeyboardAwareScrollView` is needed:** `KeyboardAwareView` adds bottom padding — it does NOT scroll. If the content is taller than the screen minus keyboard, the input will still be hidden. Use `KeyboardAwareView` ONLY for fixed-layout screens (chat input bars). Everything else needs `KeyboardAwareScrollView`.

5. **Forgetting `keyboardShouldPersistTaps="handled"` on standalone FlatLists:** Any `FlatList` or `SectionList` that appears alongside or below a TextInput MUST have `keyboardShouldPersistTaps="handled"`. Without it, the first tap on a list item dismisses the keyboard instead of selecting the item. This applies even if the FlatList is not inside `KeyboardAwareScrollView`.

---

## 10. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in S7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec.

**Critical rules:**
- Read every file before modifying it — understand its current structure
- The two wrappers (`KeyboardAwareScrollView` and `KeyboardAwareView`) are the ONLY keyboard solutions allowed after this refactor — no `KeyboardAvoidingView`, no new npm packages
- Never nest a FlatList inside a KeyboardAwareScrollView
- Never add keyboard wrappers inside reusable primitive components
- Test on both iOS and Android — keyboard behavior differs significantly between platforms
- When in doubt about which wrapper to use, read S6.1's decision rule

When you are finished, produce your `IMPLEMENTATION_REPORT.md` referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.
