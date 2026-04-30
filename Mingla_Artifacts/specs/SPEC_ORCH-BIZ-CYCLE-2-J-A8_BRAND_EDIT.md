# Spec — J-A8: Edit Brand Profile

> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A8
> **Cycle:** 2 — Brands
> **Codebase:** `mingla-business/` (mobile + web parity per DEC-071)
> **Predecessor investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A8.md`
> **Predecessor cycle:** J-A7 implementor PASS (`00c0c89f`)
> **Authoritative design:** `HANDOFF_BUSINESS_DESIGNER.md` §5.3.5 lines 1837-1842
> **Spec writer turn:** 2026-04-29
> **Status:** locked

---

## 1. Scope

### 1.1 In scope

- **Route (NEW):** `mingla-business/app/brand/[id]/edit.tsx`
- **Component (NEW):** `mingla-business/src/components/brand/BrandEditView.tsx`
- **Schema (MOD):** `mingla-business/src/store/currentBrandStore.ts` — Brand v3 → v4 + migration
- **Stub data (MOD):** `mingla-business/src/store/brandList.ts` — all 4 STUB_BRANDS get `displayAttendeeCount: true`
- **J-A7 wiring (MOD):** `mingla-business/src/components/brand/BrandProfileView.tsx` — add `onEdit` prop + remove TRANSITIONAL marker on Edit CTA
- **Route wiring (MOD):** `mingla-business/app/brand/[id]/index.tsx` — pass `onEdit` handler

### 1.2 Out of scope (hard non-goals)

- ❌ Slug edit (§5.3.6 settings)
- ❌ Tax/VAT, Default currency, Timezone (§5.3.6)
- ❌ "Allow DMs" toggle, "List in Discover" toggle (§5.3.6 settings)
- ❌ Photo upload (TRANSITIONAL Toast on edit-pencil tap; photo crop deferred with it)
- ❌ Custom links multi-add UI (schema field stays; UI deferred — see investigation O-A8-2)
- ❌ Email/phone format validation (frontend-first; user can save anything; backend validates at B1)
- ❌ Operations rows (Payments / Team / Tax / Reports — those live on J-A7 view per investigation O-A8-4)
- ❌ "Preview public page" button (Cycle 3+)
- ❌ J-A9+ scope
- ❌ J-A7 view consuming `displayAttendeeCount` toggle — Cycle 3+ public-page reads it; J-A7 always shows attendees
- ❌ Backend code (DEC-071)
- ❌ Kit primitive extension (DEC-079) — toggle composed inline

### 1.3 Assumptions

- J-A7 baseline shipped at `00c0c89f`: BrandProfileView, route, Account brand-rows, Brand v3 schema
- Founder always has owner role; no role-based field gating in Cycle 2
- AsyncStorage persistence works on web via existing WEB3/Cycle 0b fixes
- `useLocalSearchParams<{id: string | string[]}>()` returns string segment on all 3 platforms (verified in J-A7)

---

## 2. Authoritative design source

Per investigation H-A7-1, the J-A8 source is the EDITOR component (`screens-brand.jsx:126-196`) plus designer handoff §5.3.5 (lines 1837-1842):

> ### 5.3.5 `/brand/:brandId/edit` — Edit brand
>
> **Mobile:** scroll view sectioned: Photo · Basics (name, description, contact email, contact phone) · Social links (multi-select platforms with URL inputs) · Custom links (multi-add) · Display attendee count toggle.
> **Desktop:** same in a wider form, 720 max.
> **States:** clean / dirty / saving / saved / error.
> **Edge cases:** Photo crop required if uploaded image is not square (default brand photo is square).

For J-A8 cycle 2: **Photo upload deferred · Custom links UI deferred · Multi-select social platforms deferred to website + instagram only**. Schema fields stay so future cycles can light up the missing UI without further migration.

---

## 3. Layer specifications

### 3.1 Schema layer (Brand v3 → v4)

**File:** `mingla-business/src/store/currentBrandStore.ts`

Add new optional field to `Brand` type:

```typescript
export type Brand = {
  // ... v3 fields unchanged ...
  /** Whether to show attendee count on public-facing surfaces.
      NEW in J-A8 schema v4. Undefined treated as `true`. */
  displayAttendeeCount?: boolean;
};
```

**Persist version bump:**
- `persistOptions.name` → `"mingla-business.currentBrand.v4"`
- `version: 4`
- Migration adds v4 case:
  - `version < 2` → reset to empty (unchanged)
  - `version === 2` → existing v2→v3 path (unchanged)
  - `version === 3` → passthrough; new field starts undefined for all brands
  - `version >= 4` → passthrough

```typescript
migrate: (persistedState, version) => {
  if (version < 2) {
    return { currentBrand: null, brands: [] };
  }
  if (version === 2) {
    // ... existing v2→v3 logic unchanged ...
  }
  // v3 → v4: passthrough (new optional field starts undefined)
  return persistedState as PersistedState;
}
```

Header comment update: extend schema-version history with v4 entry.

### 3.2 Stub data layer

**File:** `mingla-business/src/store/brandList.ts`

Add `displayAttendeeCount: true` to each of 4 STUB_BRANDS. Single-line addition per stub. Header comment update: note v4 schema.

### 3.3 Route layer (NEW)

**File:** `mingla-business/app/brand/[id]/edit.tsx`

Same pattern as J-A7 `[id]/index.tsx` — format-agnostic find + canvas.discover host-bg + router.canGoBack guard:

```typescript
import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandEditView } from "../../../src/components/brand/BrandEditView";
import { canvas } from "../../../src/constants/designSystem";
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../../src/store/currentBrandStore";

export default function BrandEditRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const idParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const currentBrand = useCurrentBrandStore((s) => s.currentBrand);
  const brand =
    typeof idParam === "string" && idParam.length > 0
      ? brands.find((b) => b.id === idParam) ?? null
      : null;

  const handleBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  };

  const handleSave = (next: Brand): void => {
    // Replace the brand by id in the brand list
    setBrands(brands.map((b) => (b.id === next.id ? next : b)));
    // Mirror to currentBrand if it matches
    if (currentBrand !== null && currentBrand.id === next.id) {
      setCurrentBrand(next);
    }
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
      <BrandEditView brand={brand} onCancel={handleBack} onSave={handleSave} onAfterSave={handleBack} />
    </View>
  );
}
```

Per invariant **I-12** (host-bg cascade): `backgroundColor: canvas.discover` is REQUIRED. Without it, screen renders against system default and breaks visual continuity (D-IMPL-A7-6 lesson).

### 3.4 Component layer (NEW)

**File:** `mingla-business/src/components/brand/BrandEditView.tsx`

```typescript
export interface BrandEditViewProps {
  brand: Brand | null;
  onCancel: () => void;        // back-arrow / cancel handler
  onSave: (next: Brand) => void;  // commits draft to the store
  onAfterSave: () => void;     // navigates back after save success
}
```

#### 3.4.1 Not-found state

When `brand === null`, render the same not-found layout as J-A7:
- TopBar `leftKind="back"` + title "Edit brand" + onBack=`onCancel` + `rightSlot={<View />}`
- GlassCard with "Brand not found" + body + "Back to Account" Button

#### 3.4.2 Populated state — form sections

**Local state:**
```typescript
const [draft, setDraft] = useState<Brand>(brand);  // initial copy of brand
const [submitting, setSubmitting] = useState<boolean>(false);
const [discardDialogVisible, setDiscardDialogVisible] = useState<boolean>(false);
const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

const isDirty = useMemo<boolean>(() => {
  return JSON.stringify(draft) !== JSON.stringify(brand);
}, [draft, brand]);
```

(JSON.stringify comparison is acceptable for client-state form-dirty check. Field-by-field comparison is over-engineering for a 5-section form. Document this choice with a code comment so reviewers don't refactor it.)

**TopBar:**
- `leftKind="back"` + title=`"Edit brand"` + onBack=`handleBackPress` + `rightSlot={<SaveButton ... />}`
- SaveButton:
  - `<Button label={submitting ? "Saving…" : "Saved"|"Save"} variant="primary" size="sm" onPress={handleSave} disabled={!isDirty || submitting} loading={submitting} />`

Wait — clarify state machine. Save button label:
- Clean (`!isDirty`): label="Save", disabled=true
- Dirty (`isDirty && !submitting`): label="Save", disabled=false
- Submitting: label="Saving…", disabled=true, loading=true (Button primitive supports loading prop)
- After save success: navigate back via `onAfterSave()` — user never sees a static "Saved" label since they're navigated away. Toast "Saved" handles user feedback.

So the simpler state machine:
- `disabled = !isDirty || submitting`
- `label = submitting ? "Saving…" : "Save"`
- `loading = submitting`

**handleSave:**
```typescript
const handleSave = useCallback((): void => {
  if (!isDirty || submitting) return;
  setSubmitting(true);
  // Frontend-first: in-memory mutation is synchronous. Brief artificial
  // delay (e.g., setTimeout 300ms) creates a perceptible "saving…" beat
  // so the UI feels real. When B1 lands, this becomes a real async call
  // and the delay vanishes.
  setTimeout(() => {
    onSave(draft);
    setSubmitting(false);
    setToast({ visible: true, message: "Saved" });
    // Navigate back after a short delay to let Toast register visually
    setTimeout(() => onAfterSave(), 300);
  }, 300);
}, [draft, isDirty, submitting, onSave, onAfterSave]);
```

The 300ms simulated-async delay is intentional — without it the Save button flickers and the user can't perceive the state transition. Mark with `// [TRANSITIONAL] simulated async delay — replaced by real Supabase call in B1.`

**handleBackPress (intercepts back/cancel when dirty):**
```typescript
const handleBackPress = useCallback((): void => {
  if (isDirty) {
    setDiscardDialogVisible(true);
  } else {
    onCancel();
  }
}, [isDirty, onCancel]);
```

**ConfirmDialog (unsaved-changes warning):**
```typescript
<ConfirmDialog
  visible={discardDialogVisible}
  onClose={() => setDiscardDialogVisible(false)}
  onConfirm={() => {
    setDiscardDialogVisible(false);
    onCancel();
  }}
  variant="simple"
  destructive
  title="Discard changes?"
  description="Your edits won't be saved if you leave now."
  confirmLabel="Discard"
  cancelLabel="Keep editing"
/>
```

**ScrollView body sections (top-to-bottom):**

##### Section A — Photo card (read-mostly)

GlassCard variant="elevated", padding=spacing.lg, centered content:
- 84×84 gradient avatar with initial (same pattern as J-A7 hero)
- Edit-pencil overlay button (32×32, accent.warm, white pencil icon, positioned bottom-right of avatar at -4/-4 offset) → `onPress` fires `[TRANSITIONAL]` Toast `"Photo upload lands in a later cycle."`
- Below avatar: `mingla.com/{brand.slug}` displayed as Text (read-only). Slug is white text inside a tertiary-colored prefix: `mingla.com/` (tertiary) + `{slug}` (white)
- No "Preview public page" button (deferred to Cycle 3+)

##### Section B — About

Section label `"About"` (uppercase, tertiary, letterSpacing 1.4, fontWeight 700).

Three Inputs in a column with `spacing.sm` gap:
1. `<Input variant="text" value={draft.displayName} onChangeText={(v) => setDraft({...draft, displayName: v})} placeholder="Brand name" accessibilityLabel="Display name" />`
2. `<Input variant="text" value={draft.tagline ?? ""} onChangeText={(v) => setDraft({...draft, tagline: v})} placeholder="Short tagline" accessibilityLabel="Tagline" />`
3. `<Input variant="text" value={draft.bio ?? ""} onChangeText={(v) => setDraft({...draft, bio: v})} placeholder="Tell people about your brand" multiline numberOfLines={4} textAlignVertical="top" accessibilityLabel="Bio / description" />` (multiline pass-through to TextInput per Input primitive's TextInputProps inheritance)

##### Section C — Contact

Section label `"Contact"`.

Two Inputs:
1. `<Input variant="email" value={draft.contact?.email ?? ""} onChangeText={(v) => setDraft({...draft, contact: {...draft.contact, email: v}})} placeholder="hello@yourbrand.com" leadingIcon="mail" accessibilityLabel="Contact email" />`
2. `<Input variant="phone" value={draft.contact?.phone ?? ""} onChangeText={(v) => setDraft({...draft, contact: {...draft.contact, phone: v}})} placeholder="+44 ..." accessibilityLabel="Contact phone" />` (Phone variant has its own UI per Cycle 0a — no leadingIcon needed)

(Note: the email + phone fields update the nested `contact` object. Use the spread-then-merge pattern. If `contact` is undefined, `{...undefined, email: v}` produces `{email: v}` — JS object spread handles undefined correctly.)

##### Section D — Social links

Section label `"Social links"`.

Two Inputs:
1. `<Input variant="text" value={draft.links?.website ?? ""} onChangeText={(v) => setDraft({...draft, links: {...draft.links, website: v}})} placeholder="yourbrand.com" leadingIcon="link" accessibilityLabel="Website" />`
2. `<Input variant="text" value={draft.links?.instagram ?? ""} onChangeText={(v) => setDraft({...draft, links: {...draft.links, instagram: v}})} placeholder="@yourbrand" leadingIcon="user" accessibilityLabel="Instagram handle" />`

(Custom links UI deferred per O-A8-2. Schema field `links.custom` stays untouched on draft → preserved on save.)

##### Section E — Display

Section label `"Display"`.

GlassCard variant="base" padding=spacing.md containing one toggle row:
- Left column: `Text` "Show attendee count" (body weight 500) + `Text` "Display live RSVP numbers" (caption, tertiary)
- Right: composed Toggle pressable (40×24 capsule) — see §3.5 for inline-toggle implementation

Toggle current value: `draft.displayAttendeeCount ?? true` (undefined treated as ON per schema default).

OnPress: `setDraft({...draft, displayAttendeeCount: !(draft.displayAttendeeCount ?? true)})`

##### KeyboardAvoidingView wrap

Wrap the ScrollView in `<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{flex: 1}}>` so iOS keyboard pushes content above. Web ignores this prop (no-op).

##### Toast

Bottom-mounted Toast for "Saved" and `[TRANSITIONAL]` photo-upload feedback. Same pattern as J-A7's BrandProfileView.

### 3.5 Inline Toggle composition (no kit extension)

Per H-A8-5, kit lacks a Toggle primitive. Compose inline in BrandEditView:

```typescript
interface InlineToggleProps {
  value: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

const InlineToggle: React.FC<InlineToggleProps> = ({ value, onPress, accessibilityLabel }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="switch"
    accessibilityState={{ checked: value }}
    accessibilityLabel={accessibilityLabel}
    style={{
      width: 40,
      height: 24,
      borderRadius: 999,
      backgroundColor: value ? accent.warm : glass.tint.profileBase,
      borderWidth: 1,
      borderColor: value ? accent.border : glass.border.profileBase,
      justifyContent: "center",
    }}
  >
    <View
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        backgroundColor: textTokens.primary,
        marginLeft: value ? 19 : 3,
      }}
    />
  </Pressable>
);
```

(No animation needed for v1 — instant switch. If Cycle 2 polish wants animated translate, candidate for inline `withTiming` wrap. Mark this in implementor's discoveries if they think it's worth a polish pass.)

### 3.6 J-A7 wiring (BrandProfileView modification)

**File:** `mingla-business/src/components/brand/BrandProfileView.tsx`

Add `onEdit` prop to `BrandProfileViewProps`:

```typescript
export interface BrandProfileViewProps {
  brand: Brand | null;
  onBack: () => void;
  /** Called when user taps "Edit brand" sticky-shelf button. Receives the brand id. */
  onEdit: (brandId: string) => void;  // NEW — required per J-A8 spec
}
```

Modify `handleEdit`:

```typescript
// Before (J-A7):
// const handleEdit = useCallback((): void => {
//   fireToast("Editing lands in J-A8.");
// }, [fireToast]);

// After (J-A8):
const handleEdit = useCallback((): void => {
  if (brand !== null) {
    onEdit(brand.id);
  }
}, [brand, onEdit]);
```

Remove the `[TRANSITIONAL] Edit CTA` comment line (line ~144). The marker is no longer accurate.

### 3.7 Route wiring (BrandProfileRoute modification)

**File:** `mingla-business/app/brand/[id]/index.tsx`

Pass `onEdit` to BrandProfileView:

```typescript
const handleOpenEdit = (brandId: string): void => {
  router.push(`/brand/${brandId}/edit` as never);
};

return (
  <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: canvas.discover }}>
    <BrandProfileView brand={brand} onBack={handleBack} onEdit={handleOpenEdit} />
  </View>
);
```

---

## 4. Success Criteria

**AC#1** J-A7 sticky-shelf "Edit brand" tap navigates to `/brand/${brand.id}/edit` (no longer fires Toast).

**AC#2** Edit screen renders pre-filled with all current Brand fields (displayName, tagline, bio, contact email/phone, links website/instagram, displayAttendeeCount).

**AC#3** Save button is **disabled** when `!isDirty` (form unchanged from initial brand).

**AC#4** Editing any field flips `isDirty = true` and **enables** Save button.

**AC#5** Tap Save → Save button changes label to "Saving…" + loading indicator → after ~300ms → Toast "Saved" appears → after another ~300ms → navigates back to `/brand/${brand.id}/`.

**AC#6** After save, `/brand/:id/` view reflects the edited values (live read from updated store).

**AC#7** Tap back arrow when `isDirty === true` → ConfirmDialog "Discard changes?" appears with description "Your edits won't be saved if you leave now." + Discard (destructive) + Keep editing buttons.

**AC#8** ConfirmDialog "Discard" tap → returns to `/brand/:id/` view without committing changes.

**AC#9** ConfirmDialog "Keep editing" tap → dialog closes, user stays on edit screen, draft state preserved.

**AC#10** Tap back arrow when clean (no edits) → returns immediately, no dialog.

**AC#11** Photo edit-pencil tap → Toast `[TRANSITIONAL]` "Photo upload lands in a later cycle." No navigation.

**AC#12** Slug rendered as read-only text below photo (`mingla.com/{slug}`). No Input field for slug.

**AC#13** Display section toggle reflects current `displayAttendeeCount` (undefined → ON visually).

**AC#14** Tapping toggle flips its visual state AND marks form `isDirty`. Saving persists the new boolean to the store.

**AC#15** Brand-not-found state when `:id` doesn't match any brand. Same pattern as J-A7. "Back to Account" button returns to `/(tabs)/account`.

**AC#16** Persist v3 → v4 migration cold-launch: app opens without crash; all v3 brands hydrate with `displayAttendeeCount` undefined (effectively ON at read sites).

**AC#17** Web direct URL navigation `/brand/lm/edit` opens the edit form correctly. Browser back triggers the same dirty-check confirm.

**AC#18** TopBar: `leftKind="back"` + title `"Edit brand"` + Save button in right-slot. Back arrow respects dirty-check.

**AC#19** `npx tsc --noEmit` exits 0. No `any`, no `@ts-ignore`, no kit extension. Host View on edit route has `backgroundColor: canvas.discover` (per invariant I-12).

**AC#20** Multi-line bio input renders ~4 lines tall and accepts line breaks.

**AC#21** Email Input on iOS shows email keyboard; phone Input shows phone variant chip-prefix (per Input primitive Cycle 0a behavior).

**AC#22** All `[TRANSITIONAL]` markers grep-verifiable: photo upload + simulated-async-save delay. Edit-CTA marker REMOVED from BrandProfileView.tsx (J-A7 marker retired).

---

## 5. Invariants

| ID | Preserve / Establish |
|---|---|
| I-1 | designSystem.ts not modified |
| I-3 | iOS / Android / web all execute |
| I-4 | No `app-mobile/` imports |
| I-6 | tsc strict clean |
| I-7 | TRANSITIONAL markers labeled (photo, simulated-async-save delay) |
| I-9 | No animation timings touched (toggle uses no animation in v1) |
| I-11 | Format-agnostic ID resolver (J-A7 invariant — same pattern in edit route) |
| **I-12 (NEW)** | **Host-bg cascade** — every non-tab Expo Router route MUST set `backgroundColor: canvas.discover` on its host View. Codifies D-IMPL-A7-6 lesson. Verification: grep new route file for `canvas.discover`. |
| DEC-071 | Frontend-first; no backend code |
| DEC-079 | Kit closure preserved (Toggle composed inline; no new primitive) |
| DEC-080 | TopSheet untouched |
| DEC-081 | No `mingla-web/` references |

**Retired marker:** J-A7's `[TRANSITIONAL]` Edit CTA exits this cycle (no longer Toast — now navigates).

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A8-01 | Happy save | Edit displayName from "Lonely Moth" → "Lonely Moth ✨" → Save | Saving... → Saved Toast → router.back() to /brand/lm/ → name updated | Full stack |
| T-A8-02 | Save button gating | Open edit screen, no edits | Save button disabled | Component |
| T-A8-03 | Dirty enables Save | Edit any field | Save button enabled | Component |
| T-A8-04 | Discard dirty changes | Edit field → tap back → tap Discard | Returns to view; field unchanged | Component + Route |
| T-A8-05 | Keep editing | Edit field → tap back → tap Keep editing | Dialog closes; draft preserved | Component |
| T-A8-06 | Clean back | Open edit → tap back without edits | Returns immediately, no dialog | Component + Route |
| T-A8-07 | Photo upload Toast | Tap edit-pencil on photo | Toast TRANSITIONAL "Photo upload lands in a later cycle." | Component |
| T-A8-08 | Slug read-only | Inspect slug display | "mingla.com/{slug}" rendered as Text, no Input | Component |
| T-A8-09 | Toggle initial state | Stub brand with `displayAttendeeCount: true` | Toggle shows ON visual | Component |
| T-A8-10 | Toggle flip dirties form | Tap toggle | Visual flips; Save button enables | Component |
| T-A8-11 | Toggle persists | Flip toggle → Save → reopen view | Toggle state persisted; visible on next open of edit | Full stack |
| T-A8-12 | Multi-line bio | Type with line breaks | Renders multi-line; saves with `\n` | Component |
| T-A8-13 | Email keyboard | Tap email field on iOS | Email keyboard shows | Component (iOS) |
| T-A8-14 | Phone variant chip | Tap phone field | Country chip + numeric keyboard | Component |
| T-A8-15 | Brand not found | Navigate to /brand/xyz/edit | Not-found GlassCard + Back to Account | Component |
| T-A8-16 | Persist v3→v4 | Cold-launch with v3 persisted state | Brands hydrate; toggles render ON (undefined treated as true) | State migration |
| T-A8-17 | Web direct URL | Paste /brand/sl/edit in browser, sign in | Edit screen renders for Sunday Languor | Route + web |
| T-A8-18 | Web browser back when dirty | Edit field → click browser back | Dialog "Discard changes?" appears | Route + web |
| T-A8-19 | tsc strict | `npx tsc --noEmit` | exit 0 | Build |
| T-A8-20 | Host-bg cascade | Inspect /brand/lm/edit screen | Dark canvas (canvas.discover) visible — not system default | Route |
| T-A8-21 | J-A7 Edit CTA wiring | Tap "Edit brand" on J-A7 sticky shelf | Navigates to /brand/{id}/edit; no Toast fires | Component (J-A7) |
| T-A8-22 | onEdit prop required | Render BrandProfileView without onEdit | tsc error (prop is required) | Type check |
| T-A8-23 | TRANSITIONAL marker grep | Grep BrandProfileView.tsx | Edit CTA marker REMOVED; only photo + simulated-async markers in BrandEditView | Build |

---

## 7. Implementation Order

1. **Schema bump** — currentBrandStore.ts (v3 → v4 + migration); update header comment.
2. **tsc check** — clean.
3. **Stub data** — brandList.ts (4 stubs get `displayAttendeeCount: true`).
4. **tsc check** — clean.
5. **Build BrandEditView component** — `src/components/brand/BrandEditView.tsx`. All 5 sections + ConfirmDialog + Toast + InlineToggle compose. Inline TRANSITIONAL marker on simulated-async delay.
6. **tsc check** — clean.
7. **Create route file** — `app/brand/[id]/edit.tsx`. Format-agnostic find + canvas.discover host-bg + onSave/onAfterSave wiring.
8. **tsc check** — clean.
9. **Wire J-A7 Edit CTA** — modify BrandProfileView.tsx (`onEdit` prop + remove TRANSITIONAL marker on Edit CTA + simplify `handleEdit`). Modify `app/brand/[id]/index.tsx` to pass `onEdit` handler. **Note: removing the TRANSITIONAL marker also reduces the marker count in implementor grep verification — call this out in implementation report.**
10. **tsc check** — clean.
11. **Grep verify** — TRANSITIONAL markers: photo upload + simulated-async-save delay (in BrandEditView). Edit CTA marker should be ABSENT from BrandProfileView.
12. **Implementation report.**

---

## 8. Regression Prevention

- **Invariant I-12 codified.** Code comment in new route file:
  ```
  // Host-bg cascade per Cycle 2 invariant I-12.
  // Routes outside (tabs)/ do not inherit canvas.discover from the tabs
  // layout — each non-tab route MUST set it on the host View.
  // Established after D-IMPL-A7-6 regression on /brand/[id]/.
  ```
- **Edit-CTA wiring pattern** — view component takes `onEdit` callback; route owns navigation. Documented in BrandProfileView's interface comment so J-A9/A10/A11/A12 follow same pattern.
- **Dirty-state confirm-discard** — established pattern for forms; reusable across all future edit screens.
- **Form-dirty comparison via JSON.stringify** — explicit code comment so reviewers don't refactor it. For 5-section form with primitive + nested-object fields, JSON serialization is correct, fast, and avoids field-by-field bookkeeping.

---

## 9. Founder-facing UX (plain English summary)

When this lands the founder will:

- On any brand profile (`/brand/:id/`), tap **"Edit brand"** → land on a form pre-filled with that brand's content
- Edit name, tagline, bio, contact email/phone, website, instagram, and a "Show attendee count" toggle
- See **"Save"** at top-right — disabled when nothing's changed, enabled the moment any field is edited
- Tap Save → brief "Saving…" → "Saved" Toast → land back on the profile screen with their changes visible
- Tap back arrow when there are unsaved changes → confirmation dialog "Discard changes?" with Discard + Keep editing
- Tap photo edit-pencil → Toast saying "Photo upload lands in a later cycle." (no actual upload yet — frontend-first)

**What this DOESN'T do yet:** photo upload, slug edit (lives in settings), custom social links beyond website + instagram, currency/timezone/Tax-VAT settings (also settings).

---

## 10. Out-of-band carve-outs

| Carry-over | Status in J-A8 |
|---|---|
| **D-IMPL-A7-6** Host-bg cascade (J-A7) | ✅ ADDRESSED — invariant I-12 codified + edit route applies it |
| **H-1 (J-A6 audit)** ID format tolerance | ✅ ADDRESSED — same format-agnostic resolver in edit route |
| **D-IMPL-38 (Cycle 1)** Sign-out doesn't clear brand store | ❌ DEFERRED to B1 backend cycle |
| **H-4 (J-A6 audit)** BrandSwitcherSheet form-prefill polish | ❌ DEFERRED to end-of-Cycle-2 polish |
| **D-INV-A8-1** "Allow DMs" + "List in Discover" toggles | ❌ DEFERRED to §5.3.6 settings cycle |
| **D-INV-A8-2** Custom links multi-add UI | ❌ DEFERRED to polish or settings cycle |

---

## 11. Dispatch hand-off

Implementor dispatch shall reference both:
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A8.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A8_BRAND_EDIT.md` (this file)

Implementor follows §7 implementation order verbatim. Tester verifies T-A8-01 through T-A8-23 inclusive.

---

**End of J-A8 spec.**
