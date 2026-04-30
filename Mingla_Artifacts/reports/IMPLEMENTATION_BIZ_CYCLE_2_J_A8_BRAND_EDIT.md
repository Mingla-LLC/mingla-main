# Implementation Report — Cycle 2 · J-A8 (Edit Brand Profile)

> **Initiative:** Mingla Business Frontend Journey Build (DEC-071 frontend-first)
> **Cycle:** ORCH-BIZ-CYCLE-2-J-A8
> **Codebase:** `mingla-business/`
> **Predecessor:** Cycle 2 J-A7 CLOSED (`00c0c89f`)
> **Implementor turn:** 2026-04-29
> **Dispatch:** `Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_2_J_A8_BRAND_EDIT.md`
> **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-BIZ-CYCLE-2-J-A8_BRAND_EDIT.md`
> **Status:** implemented, partially verified (code-trace + tsc clean; founder runtime smoke pending)

---

## 1. Summary

J-A8 ships the **brand edit form** at `/brand/[id]/edit`. Founder taps "Edit brand" on any J-A7 profile sticky-shelf → lands on a 5-section form (Photo · About · Contact · Social links · Display) → edits → Save (with simulated-async beat) → navigates back. Unsaved-changes guard via ConfirmDialog. Photo upload + custom links UI deferred per spec.

**6 files** changed: 2 new + 4 modified, exactly per spec §1.1.

Sequential discipline preserved: schema → stubs → component → route → J-A7 wiring → final tsc, with tsc clean check between every step.

---

## 2. Old → New Receipts

### `mingla-business/src/store/currentBrandStore.ts` (MODIFIED)

**What it did before:** Brand v3 schema (id, displayName, slug, photo?, role, stats {events, followers, rev, attendees}, currentLiveEvent, bio?, tagline?, contact?, links?). Persist key `...currentBrand.v3`. Migration handled v1 (reset) + v2→v3 (add stats.attendees) + v3+ passthrough.

**What it does now:** Added optional `displayAttendeeCount?: boolean` to Brand type with JSDoc comment marking v4 origin + clarifying read-site default (undefined → true). Bumped persist key to `v4`. Migration extended: v1 reset (unchanged), v2→v3+ existing logic (unchanged), v3→v4 passthrough with explicit comment. Header schema-version history extended with v4 entry.

**Why:** spec §3.1 — Brand schema gap H-A8-1 (handoff §5.3.5 Display attendee count toggle).

**Lines:** +14, -3. Net +11.

### `mingla-business/src/store/brandList.ts` (MODIFIED)

**What it did before:** 4 STUB_BRANDS with v3 schema (no `displayAttendeeCount`).

**What it does now:** Each of 4 stubs gets `displayAttendeeCount: true` explicit (single-line addition each). Header comment extended with v4 schema reference.

**Why:** spec §3.2 — toggles render ON visually for testing the J-A8 edit screen immediately after seeding.

**Lines:** +9, -2. Net +7.

### `mingla-business/src/components/brand/BrandEditView.tsx` (NEW)

**What it did before:** did not exist.

**What it does now:** ~470-line composed view component implementing all spec §3.4 sections:

- Props: `{brand: Brand | null, onCancel: () => void, onSave: (next: Brand) => void, onAfterSave: () => void}`
- **Not-found state** (when `brand === null` OR `draft === null`): TopBar back + GlassCard "Brand not found" + "Back to Account" Button — pattern mirrors J-A7 BrandProfileView
- **Populated state**:
  - Local `draft: Brand | null` state initialized from `brand` prop
  - `submitting` state for Save button loading
  - `discardDialogVisible` state for ConfirmDialog
  - `isDirty` derived via `JSON.stringify(draft) !== JSON.stringify(brand)` — explicit code comment per spec §3.4.2 with rationale ("DO NOT refactor to field-by-field")
  - **Hero photo card**: 84×84 gradient avatar with initial + edit-pencil overlay button (32×32, accent.warm bg, white pencil) → fires `[TRANSITIONAL]` Toast "Photo upload lands in a later cycle." Slug rendered below as `mingla.com/{slug}` (read-only — slug edit is §5.3.6)
  - **About section**: 3 Inputs (displayName + tagline + bio multi-line with `numberOfLines={4}` + `textAlignVertical="top"`)
  - **Contact section**: email Input (variant="email", leadingIcon="mail") + phone Input (variant="phone", chip-prefix from Cycle 0a)
  - **Social links section**: website Input (leadingIcon="link") + instagram Input (leadingIcon="user")
  - **Display section**: GlassCard with 1 toggle row — label "Show attendee count" + sub "Display live RSVP numbers on your public page." + InlineToggle composed inline (no kit extension per DEC-079)
  - **TopBar right-slot**: Save Button (variant="primary", size="sm", `disabled={!isDirty || submitting}`, `loading={submitting}`, label flips "Save" → "Saving…")
  - **Save handler**: 300ms simulated-async delay → onSave(snapshot) → Toast "Saved" → 300ms → onAfterSave(). Both delays marked `[TRANSITIONAL]` with B1 backend exit
  - **Back handler**: dirty-check → ConfirmDialog (variant="simple", destructive, "Discard changes?" + "Your edits won't be saved if you leave now." + Discard / Keep editing) OR immediate `onCancel()` if clean
  - **InlineToggle** composed at file top — 40×24 pressable capsule + 18×18 white dot with positional `marginLeft` flip; warm bg + warm border when ON, glass tint + glass border when OFF
  - **KeyboardAvoidingView** wrap (iOS padding, Android height) so keyboard doesn't cover form fields
  - **ScrollView** with `keyboardShouldPersistTaps="handled"` (per memory pattern from app-mobile lessons)

All 4 inert handler + stub data sites carry `[TRANSITIONAL]` markers with explicit cycle-specific exit conditions (photo upload, simulated-async delay).

**Why:** spec §3.4 — implements J-A8 edit form per HANDOFF_BUSINESS_DESIGNER.md §5.3.5.

**Lines:** +470 net.

### `mingla-business/app/brand/[id]/edit.tsx` (NEW)

**What it did before:** did not exist.

**What it does now:** Thin Expo Router dynamic-segment wrapper:
- Reads `useLocalSearchParams<{id: string | string[]}>()`, normalizes array-form param
- Resolves brand via format-agnostic `useBrandList().find(b => b.id === idParam)` (per invariant I-11)
- Renders `<BrandEditView brand={...} onCancel={handleBack} onSave={handleSave} onAfterSave={handleBack} />`
- `handleBack` uses `router.canGoBack()` guard with fallback `router.replace("/(tabs)/account")` for cold-launch (web direct URL paste)
- `handleSave` mutates store: `setBrands(brands.map(b => b.id === next.id ? next : b))`; mirrors to `currentBrand` if matching (so TopBar chip + Home reflect new displayName immediately)
- Host View has `backgroundColor: canvas.discover` per **invariant I-12** (codified from D-IMPL-A7-6 cascade lesson)
- Includes regression-prevention comment block at top warning against future ID normalization (I-11) AND host-bg removal (I-12)

**Why:** spec §3.3 — required new edit route file.

**Lines:** +66 net.

### `mingla-business/src/components/brand/BrandProfileView.tsx` (MODIFIED)

**What it did before:** Had no `onEdit` prop. `handleEdit` callback fired `[TRANSITIONAL]` Toast "Editing lands in J-A8." Header comment line 144 carried the marker.

**What it does now:**
- `BrandProfileViewProps` gains required `onEdit: (brandId: string) => void` prop with JSDoc explaining the view→edit pattern (reusable for J-A9 Team, J-A10 Payments, etc.)
- `BrandProfileView` destructures `onEdit` from props
- `handleEdit` rewritten: when `brand !== null`, calls `onEdit(brand.id)`. No more Toast.
- **`[TRANSITIONAL] Edit CTA` comment line REMOVED** — exit condition reached.

**Why:** spec §3.6 — wires the J-A7 sticky-shelf "Edit brand" button to the new J-A8 route.

**Lines:** +6, -4. Net +2.

### `mingla-business/app/brand/[id]/index.tsx` (MODIFIED)

**What it did before:** Rendered `<BrandProfileView brand={...} onBack={handleBack} />` — passed only `onBack`.

**What it does now:**
- Adds `handleOpenEdit` callback: `(brandId: string) => router.push(\`/brand/${brandId}/edit\` as never)`
- Passes `onEdit={handleOpenEdit}` to BrandProfileView

**Why:** spec §3.7 — required to satisfy BrandProfileView's new required `onEdit` prop.

**Lines:** +5 net.

---

## 3. Spec Traceability — AC verification matrix

| AC | Criterion | Status | Code-trace evidence |
|----|-----------|--------|---------------------|
| 1 | J-A7 Edit-CTA navigates to /brand/:id/edit (no Toast) | ✅ CODE PASS · ⏳ DEVICE | BrandProfileView.tsx `handleEdit` calls `onEdit(brand.id)`; route file's `handleOpenEdit` calls `router.push('/brand/${id}/edit')` |
| 2 | Edit screen pre-fills all Brand fields | ✅ CODE PASS · ⏳ DEVICE | BrandEditView `useState<Brand \| null>(initialDraft)` initialized from prop; all 5 sections read from `draft.*` |
| 3 | Save button disabled when clean | ✅ CODE PASS · ⏳ DEVICE | `disabled={!isDirty \|\| submitting}` — initial `JSON.stringify(draft) === JSON.stringify(brand)` ⇒ isDirty=false ⇒ disabled |
| 4 | Editing any field enables Save | ✅ CODE PASS · ⏳ DEVICE | onChangeText handlers spread `{...draft, [field]: v}` → triggers re-render → useMemo recomputes isDirty=true |
| 5 | Save → "Saving…" → Toast "Saved" → navigate back | ✅ CODE PASS · ⏳ DEVICE | `handleSave` flips submitting=true → setTimeout(300) → onSave + setSubmitting(false) + fireToast("Saved") + setTimeout(300) → onAfterSave() |
| 6 | Edited values reflected on /brand/:id/ after save | ✅ CODE PASS · ⏳ DEVICE | Route file `handleSave` does `setBrands(brands.map(...))` + mirrors to currentBrand; J-A7 view reads from store via Zustand selectors → re-renders |
| 7 | Back when dirty → ConfirmDialog | ✅ CODE PASS · ⏳ DEVICE | `handleBackPress` checks isDirty → setDiscardDialogVisible(true) when dirty; ConfirmDialog renders with title/description per spec |
| 8 | Discard → returns to view without saving | ✅ CODE PASS · ⏳ DEVICE | `handleDiscardConfirm` closes dialog + calls `onCancel()` (which is route's `handleBack` → router.back()) |
| 9 | Keep editing → dialog closes, draft preserved | ✅ CODE PASS · ⏳ DEVICE | `handleDiscardCancel` only closes dialog; `draft` state untouched |
| 10 | Back when clean → returns immediately | ✅ CODE PASS · ⏳ DEVICE | `handleBackPress` else-branch calls onCancel() directly |
| 11 | Photo edit-pencil → Toast TRANSITIONAL | ✅ CODE PASS · ⏳ DEVICE | `handlePhotoEdit` fires Toast "Photo upload lands in a later cycle." Marker on line 198. |
| 12 | Slug rendered read-only | ✅ CODE PASS · ⏳ DEVICE | Lines ~290-294 render `<Text>` with prefix + value; no Pressable, no Input |
| 13 | Toggle reflects current value (undefined → ON) | ✅ CODE PASS · ⏳ DEVICE | `const toggleValue = draft.displayAttendeeCount ?? true;` |
| 14 | Toggle flip dirties + persists | ✅ CODE PASS · ⏳ DEVICE | onPress sets `displayAttendeeCount: !toggleValue` on draft → isDirty=true; Save persists |
| 15 | Brand-not-found state | ✅ CODE PASS · ⏳ DEVICE | Early return at line ~205 `if (brand === null \|\| draft === null)` |
| 16 | Persist v3→v4 cold-launch | ⏳ UNVERIFIED — founder runtime | Code-level: migrate callback v3→v4 path is passthrough; tsc clean confirms PersistedState type contract; no `displayAttendeeCount` field on existing brands → undefined → defaults to true at read sites |
| 17 | Web direct URL navigation | ⏳ UNVERIFIED — founder runtime | Code-level: `useLocalSearchParams` works on web; no Platform.OS branches in route or component |
| 18 | TopBar header layout | ✅ CODE PASS · ⏳ DEVICE | leftKind="back" + title="Edit brand" + onBack=handleBackPress + rightSlot=saveButton |
| 19 | tsc clean + canvas.discover host-bg per I-12 | ✅ PASS | `npx tsc --noEmit` exits 0 (verified after every step); host View has `backgroundColor: canvas.discover` |
| 20 | Multi-line bio | ✅ CODE PASS · ⏳ DEVICE | Input has `multiline numberOfLines={4} textAlignVertical="top"` — pass-through to TextInput |
| 21 | Email keyboard / phone variant chip | ✅ CODE PASS · ⏳ DEVICE | Input variant="email" + variant="phone" — Cycle 0a kit handles keyboard + chip rendering |
| 22 | TRANSITIONAL Edit-CTA marker REMOVED | ✅ PASS | grep verified: no "Edit CTA" string in BrandProfileView.tsx |

**Summary:** 20/22 AC code-trace PASS. 2/22 (AC#16 persist migration runtime, AC#17 web direct URL runtime) require founder runtime smoke.

---

## 4. Invariant Verification

| ID | Status | Evidence |
|----|--------|----------|
| I-1 | ✅ Preserved | `designSystem.ts` not touched (verified — no diff) |
| I-3 | ⏳ iOS/Android: code-trace pass; web: ⏳ founder smoke | Code-level: no Platform.OS branches in J-A8 surface |
| I-4 | ✅ Preserved | grep: zero `app-mobile/` strings in any modified or new file |
| I-5 | ✅ Preserved | Producer model intact — no consumer-app surface in J-A8 |
| I-6 | ✅ Preserved | tsc strict clean across all 6 files |
| I-7 | ✅ Preserved | New TRANSITIONAL markers (photo upload + simulated-async delay) labeled with explicit exits; J-A7 Edit-CTA marker RETIRED |
| I-8 | ✅ Preserved | No backend, migrations, RPCs, RLS touched |
| I-9 | ✅ Preserved | No animation timings touched (Toggle uses no animation in v1; ConfirmDialog uses Cycle 0a defaults) |
| I-10 | ✅ Preserved | No new £ formatting introduced (J-A8 doesn't render currency) |
| I-11 | ✅ Preserved | Edit route file uses format-agnostic `useBrandList().find(...)` resolver — same pattern as J-A7 route |
| **I-12** (NEW — codified from D-IMPL-A7-6) | ✅ Established | `app/brand/[id]/edit.tsx` host View has `backgroundColor: canvas.discover`; regression-prevention comment block at top of file |
| DEC-071 | ✅ Preserved | No backend code anywhere |
| DEC-079 | ✅ Preserved | No new files in `src/components/ui/`. New files only in `src/components/brand/` and `app/brand/[id]/`. Toggle composed inline. |
| DEC-080 | ✅ Preserved | TopSheet primitive untouched |
| DEC-081 | ✅ Preserved | grep: zero `mingla-web/` references in any new or modified file |

---

## 5. Constitutional Compliance

| # | Principle | Compliance |
|---|-----------|-----------|
| 1 | No dead taps | ✅ — every Pressable has handler. Toggle, photo pencil, Discard/Keep editing all handled. |
| 2 | One owner per truth | ✅ — `currentBrandStore` remains single brand-state authority. Local `draft` state is intentional form-staging, not duplicate truth. |
| 3 | No silent failures | ✅ — Save handler does not catch (no errors possible in synchronous in-memory write). All UI feedback via Toast. |
| 4 | One query key per entity | N/A — no React Query in J-A8 |
| 5 | Server state stays server-side | ✅ — Zustand still holds CLIENT state only |
| 6 | Logout clears everything | ⚠ partial — D-IMPL-38 inherited from Cycle 1; B1-deferred per orchestrator acceptance. NOT introduced by J-A8. |
| 7 | Label temporary fixes | ✅ — 2 new TRANSITIONAL markers with explicit exits |
| 8 | Subtract before adding | ✅ — J-A7 Edit-CTA TRANSITIONAL marker REMOVED before adding new wiring (subtraction preceded addition) |
| 9 | No fabricated data | ✅ — stub data already labeled; no new fabricated numbers |
| 10 | Currency-aware UI | ✅ — no currency in J-A8 surface |
| 11 | One auth instance | ✅ — AuthContext untouched |
| 12 | Validate at the right time | ✅ — `isDirty` check + submitting guard prevents double-submit; param length check prevents empty-string lookup |
| 13 | Exclusion consistency | N/A — no event-eligibility logic |
| 14 | Persisted-state startup | ✅ — v3→v4 migration is cold-launch safe (passthrough) |

---

## 6. TRANSITIONAL marker grep

**J-A8 markers added (BrandEditView.tsx):**
- Line 18: doc reference (`Photo upload deferred (TRANSITIONAL Toast on edit-pencil).`)
- Line 59: `[TRANSITIONAL] simulated async delay — replaced by real Supabase mutation in B1 backend cycle.`
- Line 198: `[TRANSITIONAL] photo upload — exit when photo upload pipeline lands (likely Cycle 14+ or sooner if Stripe/checkout requires brand photos).`
- Line 272: inline comment `(read-mostly with TRANSITIONAL upload)`

**J-A8 markers retired:**
- BrandProfileView.tsx — `[TRANSITIONAL] Edit CTA — exit when J-A8 (/brand/[id]/edit) lands.` **REMOVED.** Verified: grep for "Edit CTA" returns no results.

**Pre-existing markers untouched:**
- BrandProfileView.tsx still has 10 markers for stub past-events, ops rows, View-public CTA, Stripe banner, empty-bio CTA, empty-events CTA, social-chip taps, plus inline references.
- currentBrandStore.ts + brandList.ts retain B1 backend-exit markers.

---

## 7. Cache Safety

Persist key bumped `mingla-business.currentBrand.v3` → `v4`. Migration:
- v1 (Cycle 0a) → reset to empty (unchanged)
- v2 (Cycle 1) → existing v2→v3 logic (add stats.attendees default 0, etc.)
- v3 (Cycle 2 J-A7) → passthrough (new `displayAttendeeCount` field starts undefined → defaults to `true` at read sites)
- v4+ → passthrough

A device with v3-persisted state (Cycle 2 J-A7 tester device) will cold-launch into v4 without crash. All toggles will render ON visually (undefined → true).

No React Query keys (no backend in J-A8).

---

## 8. Parity Check (mobile + web)

| Surface | iOS | Android | Web (compile) | Web (runtime) |
|---------|-----|---------|---------------|---------------|
| Edit form populated | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Edit form not-found | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Save state machine | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| ConfirmDialog (back when dirty) | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke (incl. browser back) |
| Photo TRANSITIONAL Toast | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Multi-line bio | ⏳ device (textAlignVertical: top) | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Email/phone variants | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |
| Persist v3→v4 cold-launch | ⏳ device | ⏳ device | ✅ tsc | ⏳ founder smoke |

Web direct-URL `/brand/lm/edit` is the highest-novelty surface (first dynamic edit route).

---

## 9. Regression Surface (3-5 features most likely to break)

1. **J-A7 view screen** — `BrandProfileView.tsx` gained required `onEdit` prop. tsc would catch any caller that didn't update; verified `app/brand/[id]/index.tsx` is the only caller and it's wired. **Low.**
2. **Cycle 1 Home tab live-event hero** — code path identical (still reads `currentBrand.currentLiveEvent`). New `displayAttendeeCount` field is optional and ignored by Home. **Low.**
3. **BrandSwitcherSheet create flow (J-A6)** — `buildBrand` does NOT add `displayAttendeeCount`; new brands save with the field undefined → defaults to `true` at edit-screen read site. **Verify a freshly-created brand opens correctly in edit mode.** Low-medium.
4. **Cold-launch with v3 persisted state** — migration adds nothing (passthrough); existing brands hydrate without `displayAttendeeCount`; J-A8 read-sites default to `true`. **Verify Cycle 2 v3 tester devices don't crash on first cold-launch with new build.** Medium-low.
5. **Web direct URL paste** — first dynamic Expo Router edit route in mingla-business; verify `useLocalSearchParams` returns `id` correctly when typed directly. **Medium.**

---

## 10. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|----|-------------|----------|--------|
| **D-IMPL-A8-1** | BrandProfileView.tsx empty-bio inline CTA still fires Toast `"Editing lands in J-A8."` (line 167 marker + handler at ~167-169). With J-A8 shipping, this Toast string is stale — it now references the cycle currently shipping. **Recommendation:** wire the empty-bio CTA to call `onEdit(brand.id)` like the main Edit button does (the inline empty-bio nudge IS literally a "go edit your bio" affordance). Spec §3.6 only addressed the main Edit CTA so this was intentionally left out of scope. Tiny implementor fix (~3 lines). | Low | Tiny implementor pass — fold into Cycle-2 polish or dispatch as standalone micro-fix |
| D-IMPL-A8-2 | Spec §3.4.2 specified Brand-not-found state mirrors J-A7. Implementor used early-return pattern (`if (brand === null \|\| draft === null) return ...`) BEFORE reading any other state. This handles the edge where `brand` arrives populated initially but parent later sets it to `null` (e.g., user wipes brands while on edit screen). The not-found GlassCard renders without trying to read `draft.displayName`, etc. Defensive add beyond strict spec. | Info | None — defensive guard, no scope expansion |
| D-IMPL-A8-3 | KeyboardAvoidingView wraps the ScrollView per spec. On web, `behavior` prop is ignored (no-op). Tested code path is platform-agnostic. If keyboard interaction issues surface in iOS smoke (e.g., bio input scroll behavior with multi-line keyboard), the typical fix is `keyboardVerticalOffset` calculation against TopBar height. Note for founder smoke. | Info | Watch-point during iOS smoke |
| D-IMPL-A8-4 | InlineToggle uses no animation (instant translate). If the founder requests animated transitions during smoke, the candidate fix is wrapping `marginLeft` in `useSharedValue` + `withTiming` (~5 lines). Currently visually adequate per spec §3.5 ("instant switch"). | Info | None — track if founder requests polish |
| D-IMPL-A8-5 | Save handler captures `draft` via closure at call-time (`const snapshot = draft`). This is intentional — if user types AFTER tapping Save (during the 300ms simulated-async window), those keystrokes won't be saved. This is conventional save UX (snapshot-at-submit, not snapshot-at-resolve). When B1 lands and the save becomes truly async, this same pattern carries forward correctly. | Info | None — correct behavior |

**No new high-severity issues.** D-IMPL-38 (sign-out brand-store cleanup) inherited from Cycle 1 still B1-deferred. **D-IMPL-A8-1 is the only actionable follow-up** — small enough to fold into a Cycle-2 polish slice with H-4 (J-A6 form prefill) and D-IMPL-A7-5 (social link Linking.openURL) if the orchestrator wants to bundle.

---

## 11. Transition Items

| Marker | Site | Exit condition |
|--------|------|----------------|
| `[TRANSITIONAL] simulated async delay` | `BrandEditView.tsx:59` | B1 backend cycle — replaced by real Supabase mutation; delay vanishes |
| `[TRANSITIONAL] photo upload` | `BrandEditView.tsx:198` | Photo upload pipeline lands (Cycle 14+ or earlier if Stripe requires brand photos) |
| Persist key `...currentBrand.v4` | `currentBrandStore.ts:101` | When backend lands, store becomes thin (active brand ID only); likely v5 |

---

## 12. Founder smoke instructions

```
SETUP:
  cd mingla-business && npx expo start --dev-client
  Open on iPhone, Android device, AND web browser.

iOS / Android smoke:

1. Account → "Wipe brands" → "Seed 4 stub brands". Open Sunday Languor profile.

2. AC#1: Tap "Edit brand" sticky-shelf button.
   Expected: navigates to /brand/sl/edit (NO Toast). URL bar updates on web.

3. AC#19 host-bg: Edit screen has dark canvas (canvas.discover),
   NOT light/grey system default.

4. AC#2: Form pre-filled:
   - Photo: "S" gradient avatar with edit-pencil overlay button (warm orange)
   - Slug: "mingla.com/sundaylanguor" displayed as plain text below photo
   - About: name "Sunday Languor", tagline "Brunch, but later.", bio (3 sentences)
   - Contact: email "hi@sundaylanguor.com", phone "+44 7700 900 781"
   - Social: website "sundaylanguor.com", instagram "@sundaylanguor"
   - Display: "Show attendee count" toggle ON (warm fill, dot right-aligned)

5. AC#3: Save button DISABLED initially (greyed out).

6. AC#4: Type a single character in the bio field. Save button ENABLES (warm fill).

7. AC#5: Tap Save.
   Expected: Save button shows "Saving..." with spinner ~300ms,
   then Toast "Saved" appears, then ~300ms later screen navigates back
   to /brand/sl/.

8. AC#6: On the profile screen, the bio shows the new content.

9. AC#7: Tap Edit again. Edit a field. Tap back arrow.
   Expected: ConfirmDialog "Discard changes?" appears with body
   "Your edits won't be saved if you leave now." + Discard (red destructive) +
   Keep editing buttons.

10. AC#9: Tap "Keep editing" → dialog closes; draft preserved.

11. Tap back again → tap "Discard".
    AC#8: Returns to /brand/sl/ profile; bio unchanged.

12. AC#10: Tap Edit again. Without editing anything, tap back.
    Expected: Returns immediately, no dialog.

13. AC#11: Tap edit-pencil overlay on photo.
    Expected: Toast TRANSITIONAL "Photo upload lands in a later cycle."

14. AC#12: Slug below photo is plain text (not tappable, not an Input).

15. AC#13 + AC#14: Toggle is ON. Tap it → flips OFF (visual: dot moves left,
    capsule color changes); Save enables. Tap Save. Reopen Edit screen →
    toggle still OFF (persisted to store).

16. AC#20 multi-line bio: Type with line breaks. Bio renders multi-line.
    Save → reopen → still multi-line.

17. AC#21: Email field on iOS shows email keyboard. Phone field shows
    country chip ("🇬🇧 +44") + numeric keyboard.

18. AC#22 marker retirement: Inspect BrandProfileView.tsx — no "Edit CTA" string.

Web smoke:

19. AC#17: Sign in to web. Open Account → Sunday Languor → Edit.
    URL: /brand/sl/edit. Form renders identically.

20. AC#18: Edit a field. Click browser back button.
    Expected: ConfirmDialog "Discard changes?" appears (same as AC#7).

21. Refresh page on /brand/sl/edit (F5/Cmd+R) — form re-renders.

22. Type /brand/lm/edit directly into URL bar → Lonely Moth edit form renders.

23. Type /brand/nonexistent/edit → AC#15 brand-not-found state with
    "Back to Account" button → returns to /(tabs)/account.

Persist migration smoke:

24. AC#16: If you have a device with Cycle 2 J-A7 (v3) persisted state,
    cold-launch this build (v4). App opens without crash. All 4 brands
    intact. Toggles render ON visually (undefined defaulted to true).
    Wipe + reseed → toggles still ON (stubs explicit true).

REGRESSION CHECKS:
- AC#22: J-A7 view's "Edit brand" sticky-shelf button no longer fires
  Toast — it navigates.
- BrandSwitcherSheet create flow (J-A6) still works; create new brand
  → open edit → toggle defaults ON; other fields empty.
- Account "Your brands" rows still navigate to view (J-A7)
- Stripe banner + Operations rows on J-A7 view still fire respective
  Toasts (J-A10 / J-A9 / Cycle later / J-A12)
- Empty-bio CTA on J-A7 still fires Toast "Editing lands in J-A8."
  (D-IMPL-A8-1 — note this is now stale; tiny follow-up dispatched separately)
- Sign-out from Account → /welcome (Cycle 0a behavior preserved)
- Home tab live-event hero (Sunday Languor) still works

If anything fails, report which AC + which platform.
```

---

## 13. Working method actually followed

1. ✅ Pre-flight reads — spec + investigation + Cycle 2 J-A7 baseline + handoff §5.3.5/§5.3.6 (all in context from session)
2. ✅ Kit primitive API verification (Input multiline, ConfirmDialog destructive, Button loading, Toast)
3. ✅ Schema bump v3 → v4 (currentBrandStore.ts) + JSDoc + migration extension
4. ✅ tsc check — clean
5. ✅ Stub data — brandList.ts (4 stubs explicit `displayAttendeeCount: true`)
6. ✅ tsc check — clean
7. ✅ Component build — BrandEditView.tsx (470 lines, all 5 sections + ConfirmDialog + InlineToggle + KeyboardAvoidingView + form state machine)
8. ✅ tsc check — clean
9. ✅ Route file — app/brand/[id]/edit.tsx (66 lines with I-11 + I-12 comment block)
10. ✅ tsc check — clean
11. ✅ J-A7 BrandProfileView wiring — added `onEdit` prop, retired TRANSITIONAL marker, simplified `handleEdit`
12. ✅ J-A7 route wiring — added `handleOpenEdit` callback, passed to BrandProfileView
13. ✅ tsc check — clean (final)
14. ✅ TRANSITIONAL marker grep — 2 J-A8 substantive markers added, 1 J-A7 marker retired (verified absent)
15. ✅ Report written
16. ⏳ Founder device + web smoke — pending

---

## 14. Layman summary (for orchestrator chat reply)

When this lands and is verified, the founder will:
- Tap "Edit brand" on any brand profile → land on a 5-section form pre-filled with everything (no longer a Toast)
- See Save button gate on dirty state; saving shows "Saving…" + spinner → Toast "Saved" → navigate back
- Tap back when there are unsaved changes → "Discard changes?" dialog with Discard + Keep editing
- Tap photo edit-pencil → Toast "Photo upload lands in a later cycle." (no actual upload yet)
- Edit name, tagline, bio (multi-line), contact email/phone, website, instagram, and a "Show attendee count" toggle
- Slug stays read-only (slug edit moved to settings cycle)

Brand schema upgraded v3→v4 with safe passthrough migration. New invariant I-12 codified — every non-tab Expo Router route MUST set `canvas.discover` host background (lesson from D-IMPL-A7-6 regression).

---

## 15. Hand-off

Per locked sequential rule, **stopping here**. tsc clean across all 6 files; 20/22 ACs PASS at code-trace level; AC#16 (persist v3→v4 runtime) + AC#17 (web direct URL runtime) require founder smoke.

D-IMPL-A8-1 is the only actionable follow-up (3-line empty-bio CTA wire-up — fold into Cycle-2 polish or standalone micro-fix). D-IMPL-38 remains B1-deferred per Cycle 1 acceptance.

Hand back to `/mingla-orchestrator` for review + founder smoke instruction execution + AGENT_HANDOFFS update.

---

**End of J-A8 Brand Edit implementation report.**
