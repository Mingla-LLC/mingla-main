# Feature: Replace Custom DateWheelPicker with react-native-date-picker
**Date:** 2026-03-14
**Status:** Planned
**Requested by:** Replace the custom FlatList-based date wheel picker in onboarding with the `react-native-date-picker` library for both Android and iOS, using spinner/wheel mode.

---

## 1. Summary

The current onboarding flow uses a hand-built `DateWheelPicker` component (FlatList + scroll snapping) for collecting birthdays. This works but is fragile — scroll momentum detection is finicky, the highlight bar is a visual hack, and it doesn't feel native on either platform. This spec replaces it with `react-native-date-picker`, which renders actual native iOS `UIDatePicker` and Android `DatePicker` wheels. The swap touches two locations: Step 1/details (user birthday) and Step 5/pathB_birthday (added person birthday). The custom `DateWheelPicker.tsx` file is deleted after migration.

## 2. User Story

As a new user going through onboarding, I want the date picker to feel native and responsive so that selecting my birthday is smooth and intuitive on both platforms.

## 3. Success Criteria

1. When the user taps the "Date of birth" button on Step 1/details, an inline spinner/wheel date picker appears below the button — identical placement to the current custom picker.
2. The spinner shows Month / Day / Year columns on iOS and a native date wheel on Android.
3. The date boundaries are enforced: minimum Jan 1, 1906; maximum today's date (Step 1) and minimum today−100yr / maximum today−13yr (Step 5).
4. When the user scrolls to a date and taps "Done", the selected date is committed to `data.userBirthday` and the picker closes.
5. The CTA button ("Let's go") remains disabled until `data.userBirthday` is set — unchanged behavior.
6. On Step 5/pathB_birthday, the spinner appears immediately (always visible, no toggle), and the selected date commits when the user taps the Next CTA — unchanged behavior.
7. The picker defaults to Jan 1, 2000 (Step 1) or today−25yr (Step 5) when no prior value exists — unchanged behavior.
8. Both iOS and Android render correctly with no crashes or layout issues.
9. The `DateWheelPicker.tsx` file is deleted.

---

## 4. Database Changes

None.

---

## 5. Edge Functions

None.

---

## 6. Mobile Implementation

### 6.1 Install react-native-date-picker

**Command (run from `app-mobile/`):**
```bash
npx expo install react-native-date-picker
```

This installs the Expo-compatible version. The library requires a dev client (not Expo Go) — Mingla already uses a dev client, so no config change is needed.

**Verify:** After install, confirm `react-native-date-picker` appears in `app-mobile/package.json` under `dependencies`.

### 6.2 Files to Delete

#### 6.2.1 `app-mobile/src/components/ui/DateWheelPicker.tsx`

Delete this file entirely. It is only imported in `OnboardingFlow.tsx` and will be fully replaced.

### 6.3 Files to Modify

#### 6.3.1 `app-mobile/src/components/OnboardingFlow.tsx`

**Change 1: Replace import**

**Remove (line 21):**
```typescript
import { DateWheelPicker } from './ui/DateWheelPicker'
```

**Add in its place:**
```typescript
import DatePicker from 'react-native-date-picker'
```

---

**Change 2: Replace Step 1/details picker (lines 1761–1775)**

**Remove:**
```tsx
{showDatePicker && (
  <DateWheelPicker
    value={pendingBirthdayRef.current || data.userBirthday || BIRTHDAY_PICKER_DEFAULT}
    minimumDate={MIN_BIRTHDAY_DATE}
    maximumDate={new Date()}
    onChange={(date) => { pendingBirthdayRef.current = date }}
    onDone={() => {
      const dateToCommit = pendingBirthdayRef.current
      if (dateToCommit) {
        setData((p) => ({ ...p, userBirthday: dateToCommit }))
        pendingBirthdayRef.current = null
      }
      setShowDatePicker(false)
    }}
  />
)}
```

**Replace with:**
```tsx
{showDatePicker && (
  <View style={{ marginTop: spacing.sm }}>
    <DatePicker
      date={pendingBirthdayRef.current || data.userBirthday || BIRTHDAY_PICKER_DEFAULT}
      mode="date"
      minimumDate={MIN_BIRTHDAY_DATE}
      maximumDate={new Date()}
      onDateChange={(date) => { pendingBirthdayRef.current = date }}
      androidVariant="iosClone"
      theme="light"
    />
    <Pressable
      style={{
        alignItems: 'flex-end',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      }}
      onPress={() => {
        const dateToCommit = pendingBirthdayRef.current
        if (dateToCommit) {
          setData((p) => ({ ...p, userBirthday: dateToCommit }))
          pendingBirthdayRef.current = null
        }
        setShowDatePicker(false)
      }}
    >
      <Text style={{
        ...typography.md,
        fontWeight: fontWeights.semibold,
        color: colors.primary[600],
      }}>Done</Text>
    </Pressable>
  </View>
)}
```

**Key decisions:**
- `androidVariant="iosClone"` — gives Android the same iOS-style spinner wheel, so both platforms look identical. This matches the user's request for a consistent wheel picker on both platforms.
- `theme="light"` — matches the onboarding flow's light background. Adjust to `"dark"` if the app uses dark mode during onboarding.
- `mode="date"` — date only, no time.
- The "Done" button is kept as a manual Pressable to preserve the exact same commit-on-done pattern (pending ref → commit → close).
- `onDateChange` fires on every scroll, updating the ref — identical to the old `onChange` behavior.

---

**Change 3: Replace Step 5/pathB_birthday picker (lines 2627–2638)**

**Remove:**
```tsx
<DateWheelPicker
  value={pendingPersonBirthdayRef.current || data.personBirthday || DEFAULT_PERSON_DATE}
  minimumDate={MIN_PERSON_DATE}
  maximumDate={MAX_PERSON_DATE}
  onChange={(date) => { pendingPersonBirthdayRef.current = date }}
  onDone={() => {
    const dateToCommit = pendingPersonBirthdayRef.current
    if (dateToCommit) {
      setData((p) => ({ ...p, personBirthday: dateToCommit }))
    }
  }}
/>
```

**Replace with:**
```tsx
<DatePicker
  date={pendingPersonBirthdayRef.current || data.personBirthday || DEFAULT_PERSON_DATE}
  mode="date"
  minimumDate={MIN_PERSON_DATE}
  maximumDate={MAX_PERSON_DATE}
  onDateChange={(date) => { pendingPersonBirthdayRef.current = date }}
  androidVariant="iosClone"
  theme="light"
/>
```

**Key decisions:**
- No "Done" button here — the old pattern commits the date when the user taps the Next CTA (handled in `handleGoNext` at line ~1529). This is unchanged.
- The picker is always visible on this screen (no toggle state) — unchanged.

---

**Change 4: Remove pendingBirthdayRef seeding guard (optional cleanup)**

The `pendingBirthdayRef` pattern was needed because the custom picker's `onChange` only fired on momentum scroll end. `react-native-date-picker`'s `onDateChange` fires on every value change, so the ref is always up to date. However, **keep the ref pattern as-is** — it's not broken, adds no complexity, and removing it risks regression. Do not touch it.

---

### 6.4 No New Files

No new components, hooks, or services are created. This is a direct 1:1 library swap inside the existing component.

### 6.5 State Changes

**Zustand:** No changes.
**React Query:** No changes.
**Local state:** `showDatePicker`, `pendingBirthdayRef`, `pendingPersonBirthdayRef` — all kept exactly as-is. No new state.

---

## 7. Implementation Order

**Step 1: Install the library.**
Run `npx expo install react-native-date-picker` from the `app-mobile/` directory. Verify it appears in `package.json`. Run `npx expo prebuild` if needed (dev client rebuild required since this is a native module).

**Step 2: Modify OnboardingFlow.tsx.**
Apply Changes 1–3 from §6.3.1 in order. Do not change any other code in the file.

**Step 3: Delete DateWheelPicker.tsx.**
Delete `app-mobile/src/components/ui/DateWheelPicker.tsx`. Verify no other file imports it (it's only used in OnboardingFlow.tsx).

**Step 4: Rebuild the dev client.**
`react-native-date-picker` is a native module. Run `npx expo run:ios` and `npx expo run:android` (or `eas build` for dev client). The app will crash on launch if you skip this step.

**Step 5: Test on both platforms.**
Walk through the full onboarding flow on iOS and Android. Verify every success criterion from §3.

---

## 8. Test Cases

| # | Test | Input | Expected Output | Platform |
|---|------|-------|-----------------|----------|
| 1 | Picker opens on tap | Tap "Date of birth" button on Step 1/details | Spinner/wheel picker appears below the button | Both |
| 2 | Scroll selects date | Scroll the year wheel to 1995 | Year column shows 1995 selected | Both |
| 3 | Done commits date | Scroll to March 15, 1995 → tap Done | Button text shows "15/03/1995", picker closes | Both |
| 4 | CTA disabled without birthday | Load Step 1/details without setting birthday | "Let's go" button is disabled/grayed out | Both |
| 5 | CTA enabled after birthday | Set birthday via picker → tap Done | "Let's go" button becomes active | Both |
| 6 | Min date enforced | Try scrolling past Jan 1, 1906 | Picker does not allow dates before Jan 1, 1906 | Both |
| 7 | Max date enforced (Step 1) | Try scrolling past today's date | Picker does not allow future dates | Both |
| 8 | Step 5 picker visible | Navigate to pathB_birthday | Picker is immediately visible (no tap needed) | Both |
| 9 | Step 5 min/max enforced | Try scrolling to today's date on Step 5 | Picker caps at today−13yr | Both |
| 10 | Step 5 Next commits | Scroll to a date on Step 5 → tap Next | `data.personBirthday` is set to the scrolled date | Both |
| 11 | Default date (Step 1) | Open picker with no prior birthday set | Picker starts at Jan 1, 2000 | Both |
| 12 | Default date (Step 5) | Navigate to pathB_birthday with no prior value | Picker starts at today−25yr | Both |
| 13 | Android renders correctly | Run on Android | iOS-clone spinner wheels render, no crashes | Android |

---

## 9. Common Mistakes to Avoid

1. **Forgetting the dev client rebuild:** `react-native-date-picker` is a native module — it will NOT work in Expo Go or without rebuilding the dev client. The app will crash with a "Module not found" error. → **Correct approach:** Run `npx expo prebuild` and rebuild the dev client after installing.

2. **Using `open` prop / modal mode:** `react-native-date-picker` supports a `modal` prop that opens a system dialog. Do NOT use this — the spec calls for an inline spinner that appears in the layout, not a modal overlay. → **Correct approach:** Use the component inline (no `modal` prop) with the default behavior.

3. **Removing the pendingRef pattern:** It may seem redundant now that `onDateChange` fires on every scroll. But removing it changes the commit-on-done semantics and risks committing dates before the user is ready. → **Correct approach:** Keep `pendingBirthdayRef` and `pendingPersonBirthdayRef` exactly as they are.

4. **Using `locale` prop incorrectly:** The default locale shows English month names. If the user's `userPreferredLanguage` should affect the picker, that's a separate feature — do NOT add locale support in this change. → **Correct approach:** Leave locale unset (defaults to device locale).

5. **Hardcoding styles instead of using design tokens:** The "Done" button styles must use `colors.primary[600]`, `typography.md`, `fontWeights.semibold`, and `spacing.*` from the design system — not hardcoded hex values. → **Correct approach:** Import and use the existing design tokens.

---

## 10. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in §7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec. Every file path, import, prop, and style value in this document is intentional and exact — copy them precisely. If something in this spec is unclear or seems wrong, stop and ask before improvising. When you are finished, produce your IMPLEMENTATION_REPORT.md referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.
