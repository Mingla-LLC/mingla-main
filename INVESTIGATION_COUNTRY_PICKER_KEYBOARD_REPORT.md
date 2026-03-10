# Investigation Report: Country Picker Keyboard Covering Results
**Date:** 2026-03-10
**Reported symptom:** When searching for a country in the country picker (inside the Add Friend modal on the connections page), the keyboard covers the search results and they cannot be seen.
**Investigated by:** Brutal Investigator Skill
**Verdict:** The AddFriendView has its own inline country picker modal that uses `transparent: true` with a bottom-sheet layout (`justifyContent: "flex-end"`, `maxHeight: 75%`) and has **zero keyboard avoidance**. When the search TextInput gets focus (it has `autoFocus`), the keyboard rises and covers the FlatList of country results. The existing reusable `CountryPickerModal` component (which uses `presentationStyle="fullScreen"` and handles keyboard correctly) is not used here — AddFriendView reinvented a broken version.

---

## 1. Symptom Summary

**What the user expected:** After opening the country picker and typing a country name, the filtered results should be visible and tappable above the keyboard.
**What actually happens:** The keyboard rises and covers the FlatList results. The user cannot see or scroll through matching countries.
**Reproducible:** Always (on every device, every time)

---

## 2. Investigation Perimeter

### Files Read (Direct Chain)
| File | Layer | Purpose | Status |
|------|-------|---------|--------|
| `app-mobile/src/components/ConnectionsPage.tsx` | Page | Renders the Add Friend modal | Read |
| `app-mobile/src/components/connections/AddFriendView.tsx` | Component | Contains inline country picker modal | Read |
| `app-mobile/src/components/connections/FriendsTab.tsx` | Component | Friends tab (triggers add friend) | Read |
| `app-mobile/src/components/onboarding/CountryPickerModal.tsx` | Component | Reusable full-screen country picker (NOT used here) | Read |
| `app-mobile/src/components/onboarding/PhoneInput.tsx` | Component | Reusable phone input that uses CountryPickerModal correctly | Read |

**Total files read:** 5
**Total lines inspected:** ~1,900

---

## 3. Findings

### ROOT CAUSE

#### RC-001: Inline country picker modal has no keyboard avoidance
**File:** `app-mobile/src/components/connections/AddFriendView.tsx` (lines 252-309)
**The defective code:**
```typescript
<Modal
  visible={showCountryPicker}
  transparent={true}        // ← transparent modal = no system keyboard avoidance
  animationType="slide"
  onRequestClose={() => setShowCountryPicker(false)}
>
  <View style={styles.pickerOverlay}>   // ← justifyContent: "flex-end"
    <TouchableOpacity ... />
    <View style={styles.pickerSheet}>   // ← maxHeight: "75%", positioned at bottom
      ...
      <TextInput autoFocus ... />       // ← keyboard opens immediately
      <FlatList ... />                  // ← covered by keyboard
    </View>
  </View>
</Modal>
```

**Styles involved:**
```typescript
pickerOverlay: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.5)",
  justifyContent: "flex-end",           // sheet sits at bottom
},
pickerSheet: {
  backgroundColor: "white",
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  paddingHorizontal: 20,
  paddingTop: 16,
  paddingBottom: 32,
  maxHeight: "75%",                     // 75% of screen height
},
```

**What it does:** Opens a transparent bottom-sheet modal with a search input that auto-focuses. The keyboard opens immediately. Because the modal is `transparent: true` with manual bottom-sheet positioning, the system does NOT automatically adjust the content. The FlatList of country results sits behind the keyboard.

**What it should do:** Either (a) use the existing `CountryPickerModal` component which is full-screen and handles keyboard correctly, or (b) wrap the picker sheet content in a `KeyboardAvoidingView` so the FlatList shrinks when the keyboard appears.

**Causal chain:**
1. User taps the country flag/dial code → `setShowCountryPicker(true)`
2. Modal opens with `transparent: true` and `pickerSheet` anchored to bottom of screen
3. Search `TextInput` has `autoFocus` → keyboard opens immediately
4. `pickerSheet` has `maxHeight: "75%"` — it occupies the bottom 75% of the screen
5. Keyboard occupies ~40-50% of the screen from the bottom
6. `pickerSheet` does NOT shrink or reposition — it stays at `maxHeight: 75%`
7. The FlatList inside the sheet is now mostly (or entirely) behind the keyboard
8. User cannot see or interact with filtered country results

**Verification:** Replace the inline country picker modal with the existing `CountryPickerModal` component (or wrap the `pickerSheet` View in a `KeyboardAvoidingView`). The country list will be visible above the keyboard.

**Fix complexity:** Small

---

#### RC-002: AddFriendView duplicates CountryPickerModal instead of reusing it
**File:** `app-mobile/src/components/connections/AddFriendView.tsx` (lines 252-309 + styles 416-479)
**What it does:** Implements a completely separate country picker modal with its own filtering, modal, FlatList, and styles — 60+ lines of JSX and 65+ lines of styles — instead of using the battle-tested `CountryPickerModal` component that already exists in the codebase.

**What it should do:** Import and use `CountryPickerModal` from `../../components/onboarding/CountryPickerModal`, exactly as `PhoneInput.tsx` does. This would:
- Eliminate the keyboard coverage bug (CountryPickerModal uses `presentationStyle="fullScreen"`)
- Remove ~130 lines of duplicate code
- Ensure consistent UX across all country picker instances in the app
- Inherit future fixes/improvements to CountryPickerModal automatically

**Causal chain:**
1. Developer built AddFriendView with its own inline country picker
2. The inline version used `transparent: true` bottom-sheet pattern (unlike CountryPickerModal which uses `presentationStyle="fullScreen"`)
3. Bottom-sheet + transparent modal + autoFocus = keyboard covers content
4. CountryPickerModal avoids this entirely by going full-screen with SafeAreaView + flex layout

**Fix complexity:** Small — replace ~130 lines with a single `<CountryPickerModal />` usage

---

### CONTRIBUTING FACTORS

#### CF-001: Parent modal is already a transparent bottom sheet — nested transparent modal creates layering confusion
**File:** `app-mobile/src/components/ConnectionsPage.tsx` (lines 1067-1122, 1332-1398)
**What's wrong:** The AddFriendView is rendered inside a `transparent` bottom-sheet Modal (the "Action Panel"). When AddFriendView opens its *own* `transparent` country picker Modal, we have a transparent modal inside a transparent modal. On Android especially, this creates z-ordering and touch-handling issues. The keyboard avoidance from the parent `KeyboardAvoidingView` (lines 1073-1076, 1338-1341) does NOT propagate into the child Modal — each Modal is its own window.
**Why it matters:** Even if you added a `KeyboardAvoidingView` inside the inline country picker modal, it might not behave correctly due to the nested transparent modal context. Using `presentationStyle="fullScreen"` (as CountryPickerModal does) avoids this entirely by creating a proper new screen.
**Recommended fix:** Use `CountryPickerModal` (full-screen) instead of inline transparent modal.

#### CF-002: Country picker search has `autoFocus` with no keyboard management strategy
**File:** `app-mobile/src/components/connections/AddFriendView.tsx` (line 279)
**What's wrong:** `autoFocus` on the search TextInput guarantees the keyboard opens immediately when the picker appears. Combined with no keyboard avoidance, the user never sees the results in their initial state.
**Why it matters:** Even without `autoFocus`, the user would hit this bug the moment they tap the search field. But `autoFocus` means 100% of users hit it immediately — there's no workaround.
**Recommended fix:** Moot if using CountryPickerModal. If keeping inline, must add keyboard avoidance.

---

### HIDDEN FLAWS

#### HF-001: Duplicate country filtering logic
**File:** `app-mobile/src/components/connections/AddFriendView.tsx` (lines 142-151)
**What's wrong:** `filteredCountries` in AddFriendView filters by `name`, `dialCode`, AND `code` (ISO alpha-2). The `CountryPickerModal` filters by `name` and `dialCode` only. This inconsistency means search behavior differs depending on which country picker the user encounters.
**What will eventually break:** User confusion — searching "US" would match in one picker but not the other. When AddFriendView is migrated to use CountryPickerModal, the `code` filter will silently disappear.
**Recommended fix:** If `code` filtering is useful, add it to `CountryPickerModal` for consistency. If not, it doesn't matter since AddFriendView's inline picker will be removed.

#### HF-002: `countrySearch` state not cleared when country picker closes via backdrop tap
**File:** `app-mobile/src/components/connections/AddFriendView.tsx` (lines 259-263)
**What's wrong:** When the user taps the backdrop overlay to close the country picker, `setShowCountryPicker(false)` is called but `setCountrySearch("")` is NOT called. The search text persists. Next time the picker opens, it shows the previous filtered results instead of the full list.
**What will eventually break:** User opens country picker, searches "Bra", doesn't find what they want, taps backdrop to close. Opens picker again — sees only Brazil/other "Bra" matches instead of the full country list. Confusing UX.
**Recommended fix:** Moot if migrating to CountryPickerModal (it clears search on close). If keeping inline, clear `countrySearch` in the backdrop onPress handler.

#### HF-003: AddFriendView country picker `onSelect` doesn't use the `CountryData` type consistently
**File:** `app-mobile/src/components/connections/AddFriendView.tsx` (lines 294-298)
**What's wrong:** The inline picker sets the entire `CountryData` object via `setSelectedCountry(item)`. The reusable `CountryPickerModal` passes only the ISO `code` string via `onSelect(code)`. If/when migrating to `CountryPickerModal`, the consuming code must change from `setSelectedCountry(item)` to `setSelectedCountry(getCountryByCode(code))`. This is a migration hazard.
**Recommended fix:** During migration, update `setSelectedCountry` call to use `getCountryByCode()` as `PhoneInput.tsx` does.

---

### OBSERVATIONS

#### OB-001: Two identical Add Friend modal blocks in ConnectionsPage.tsx
**File:** `app-mobile/src/components/ConnectionsPage.tsx` (lines 1067-1122 AND lines 1332-1398)
**What I noticed:** The "Action Panel Bottom Sheet" modal with AddFriendView is duplicated in two different render branches (error state branch at line 1066 and normal state branch at line 1331). Both are nearly identical but with minor differences (the second one includes "Blocked Users" panel).
**Why I'm flagging it:** Code duplication. Any fix to one must be manually applied to the other. This is how bugs drift.

#### OB-002: `existingFriendIds` prop is never used inside AddFriendView
**File:** `app-mobile/src/components/connections/AddFriendView.tsx` (line 31, 37)
**What I noticed:** `existingFriendIds` is declared in the interface and destructured in the component, but never referenced anywhere in the component body. Dead prop.
**Why I'm flagging it:** Dead code. Minor, but contributes to confusion about what the component actually does.

---

## 4. Root Cause Analysis — Full Trace

The issue begins at `AddFriendView.tsx`. When the user taps the country flag/dial code area (line 159), `setShowCountryPicker(true)` fires and a React Native `<Modal>` opens with `transparent={true}` (line 253). This modal renders a bottom sheet (`pickerOverlay` with `justifyContent: "flex-end"`, `pickerSheet` with `maxHeight: "75%"`) containing a search TextInput with `autoFocus` (line 279) and a FlatList of countries (line 284).

Because the modal is `transparent`, it does not create a new native screen — it overlays on top of the existing content. The system's automatic keyboard avoidance (which works for `presentationStyle="fullScreen"` or `presentationStyle="pageSheet"` modals) does NOT apply. There is no `KeyboardAvoidingView` wrapping the content inside this modal.

When the keyboard opens (immediately, due to `autoFocus`), it occupies approximately 40-50% of the screen height from the bottom. The `pickerSheet` is anchored to the bottom of the screen and occupies up to 75% of screen height. The FlatList, which sits below the header and search bar, is now partially or fully obscured by the keyboard. The user can type a search query but cannot see or tap the filtered results.

The irony is that a well-built `CountryPickerModal` component already exists at `app-mobile/src/components/onboarding/CountryPickerModal.tsx`. It uses `presentationStyle="fullScreen"` which creates a proper native screen where the keyboard avoidance works correctly. The FlatList has `flex: 1` and naturally shrinks when the keyboard appears. The `PhoneInput` component uses this modal correctly. But `AddFriendView` was built with its own inline version that skips all of these safeguards.

---

## 5. Recommended Fix Strategy

### Priority 1 — Fix the root cause(s)
| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|---------------|
| RC-001 + RC-002 | Replace inline country picker with reusable CountryPickerModal | `AddFriendView.tsx` | Small | 1. Import `CountryPickerModal` from `../onboarding/CountryPickerModal`. 2. Remove the entire inline `<Modal>` block (lines 252-309). 3. Remove `countrySearch`, `filteredCountries`, and related state/memo. 4. Add `<CountryPickerModal visible={showCountryPicker} selectedCode={selectedCountry.code} onSelect={(code) => { const c = getCountryByCode(code); if (c) setSelectedCountry(c); }} onClose={() => setShowCountryPicker(false)} />`. 5. Remove unused styles: `pickerOverlay`, `pickerSheet`, `pickerHeader`, `pickerTitle`, `pickerSearchRow`, `pickerSearchInput`, `countryRow`, `countryRowSelected`, `countryFlag`, `countryName`, `countryDial`. |

### Priority 2 — Fix contributing factors
| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|---------------|
| CF-001 | Resolved by RC fix | — | — | Using full-screen CountryPickerModal eliminates nested transparent modal issue |
| CF-002 | Resolved by RC fix | — | — | CountryPickerModal handles its own focus/keyboard |

### Priority 3 — Fix hidden flaws (before they become incidents)
| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|---------------|
| HF-001 | Add ISO code search to CountryPickerModal | `CountryPickerModal.tsx` | Trivial | Add `\|\| c.code.toLowerCase().includes(query)` to the filter at line 49 |
| HF-002 | Resolved by RC fix | — | — | CountryPickerModal clears search on close |
| HF-003 | Resolved by RC fix | — | — | Migration handled in RC fix instructions |

### Optional cleanup (not blocking)
| ID | Fix | File | Complexity | What to Change |
|----|-----|------|-----------|---------------|
| OB-001 | Extract shared modal into a single component | `ConnectionsPage.tsx` | Medium | Deduplicate the two modal blocks |
| OB-002 | Remove dead `existingFriendIds` prop | `AddFriendView.tsx` | Trivial | Remove from interface and destructuring |

### Suggested implementation order:
1. **RC-001 + RC-002:** Replace inline country picker with `CountryPickerModal` in `AddFriendView.tsx`
2. **HF-001:** Add ISO code search to `CountryPickerModal.tsx` filter (one line)
3. **OB-002:** Remove dead `existingFriendIds` prop (optional cleanup)
4. **OB-001:** Deduplicate modal blocks in `ConnectionsPage.tsx` (optional, separate PR)

### What NOT to change:
- `CountryPickerModal.tsx` — it is well-built, uses design system tokens, has proper accessibility, keyboard handling, and performance optimizations (`getItemLayout`, memoized `renderItem`). Do not refactor it.
- `PhoneInput.tsx` — correctly uses `CountryPickerModal`. Leave it alone.
- The parent modal structure in `ConnectionsPage.tsx` (the `KeyboardAvoidingView` wrapping) — it works correctly for the phone number TextInput in AddFriendView. The bug is only in the country picker sub-modal.

---

## 6. Handoff to Orchestrator

Orchestrator: the investigation is complete. The root cause is that `AddFriendView.tsx` has its own inline country picker modal using `transparent: true` with a bottom-sheet layout and **zero keyboard avoidance** — while a perfectly working full-screen `CountryPickerModal` component already exists in the codebase and is used everywhere else. The fix is a straightforward swap: delete ~130 lines of inline modal code and replace with a single `<CountryPickerModal />` usage. I've also surfaced 3 hidden flaws (1 needs a one-line fix in CountryPickerModal, 2 are resolved by the main fix) and 2 observations for optional cleanup. The fix strategy in section 5 has exact file paths, line numbers, and changes. Spec the fix, hand it to the implementor, then send the result to the tester.
