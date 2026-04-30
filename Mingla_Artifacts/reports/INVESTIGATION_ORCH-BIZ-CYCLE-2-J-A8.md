# Investigation — J-A8 (Edit Brand Profile)

> **Mode:** Forensics INVESTIGATE (greenfield spec preparation)
> **Issue ID:** ORCH-BIZ-CYCLE-2-J-A8
> **Codebase:** `mingla-business/`
> **Predecessor:** J-A7 implementor PASS (`00c0c89f`); design-package `BrandProfileScreen` confirmed during J-A7 forensics as the J-A8 EDITOR (line 126-196)
> **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_2_J_A8_BRAND_EDIT.md`
> **Auditor turn:** 2026-04-29
> **Confidence:** **High** — all pre-flight files read, schema gap quantified, scope boundary (J-A8 vs §5.3.6 settings) locked

---

## 1. Symptom Summary

Greenfield spec preparation. No bug. The J-A7 sticky-shelf "Edit brand" CTA currently fires `[TRANSITIONAL]` Toast "Editing lands in J-A8." (BrandProfileView.tsx:144). J-A8 builds the actual edit form route.

**Expected post-J-A8 state:**
- Tap "Edit brand" on J-A7 sticky shelf → navigates to `/brand/[id]/edit`
- Form pre-filled with current Brand fields
- 5 sections: Photo (read-mostly with TRANSITIONAL upload Toast) · About (displayName + tagline + bio) · Contact (email + phone) · Social links (website + instagram) · Display (1 toggle: "Show attendee count")
- 5 form states: clean / dirty / saving / saved / error
- Save button in TopBar right-slot, disabled when clean
- Back/Cancel with dirty form → ConfirmDialog "Discard changes?"
- Mobile + web parity per DEC-071

**Current state:**
- `app/brand/[id]/edit.tsx` does not exist
- Brand v3 schema does NOT carry `displayAttendeeCount` field
- BrandProfileView's `handleEdit` is closure-scoped — no `onEdit` callback prop yet (must be added)

---

## 2. Investigation Manifest

| File | Layer | Read | Notes |
|---|---|---|---|
| Dispatch `FORENSICS_BIZ_CYCLE_2_J_A8_BRAND_EDIT.md` | Spec input | ✅ | Scope + carve-outs + forbidden zones |
| `SPEC_ORCH-BIZ-CYCLE-2-J-A7_BRAND_PROFILE.md` | Predecessor spec | ✅ (session) | J-A7 sticky-shelf wiring point + format-agnostic ID resolver pattern |
| `IMPLEMENTATION_BIZ_CYCLE_2_J_A7_BRAND_PROFILE.md` | Cycle 2 baseline | ✅ (session) | 5 files shipped, 11 TRANSITIONAL markers, D-IMPL-A7-6 host-bg cascade lesson |
| `INVESTIGATION_ORCH-BIZ-CYCLE-2-J-A7.md` | J-A7 evidence | ✅ (session) | Confirms design-package BrandProfileScreen = J-A8 editor (H-A7-1) |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.5 | Authoritative source | ✅ (line 1837-1842) | Form sections + 5 states + photo crop edge case |
| `HANDOFF_BUSINESS_DESIGNER.md` §5.3.6 | Boundary check | ✅ (line 1844-1848) | Settings page rows: Tax/VAT, Default currency, Timezone, Slug override → all OUT of J-A8 |
| `design-package/.../screens-brand.jsx` line 126-196 | Visual reference | ✅ (session) | Editor with Save button + FieldRow chevR + 3 toggles + Operations rows; cross-checked vs §5.3.5 |
| `mingla-business/src/store/currentBrandStore.ts` | Schema | ✅ | Brand v3; missing `displayAttendeeCount` |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | J-A7 surface | ✅ (session) | `handleEdit` closure at line ~144; needs `onEdit` prop addition |
| `mingla-business/app/brand/[id]/index.tsx` | J-A7 route | ✅ (session) | Format-agnostic find pattern + canvas.discover host-bg |
| `mingla-business/src/components/ui/Input.tsx` | Kit primitive | ✅ | Variants: text/email/phone/number/password/search — supports `multiline` via TextInputProps passthrough |
| `mingla-business/src/components/ui/ConfirmDialog.tsx` | Kit primitive | ✅ | Has `simple` variant + `destructive` flag — perfect for Discard/Keep-editing dialog |
| `mingla-business/src/components/ui/Toast.tsx` | Kit primitive | ✅ (session) | Used for "Saved" feedback |
| `DECISION_LOG.md` | DEC entries | ✅ | DEC-071/079/080/081 still binding |

`npx tsc --noEmit` baseline clean (verified post-J-A7 commit).

---

## 3. Findings (classified)

### 🔴 Root Causes — None (greenfield)

### 🟠 Contributing Factors — None

### 🟡 Hidden Flaws (spec MUST address)

**H-A8-1 — Brand schema v3 lacks `displayAttendeeCount` field**

- File: `mingla-business/src/store/currentBrandStore.ts:45-65`
- Current Brand v3 fields cover: id, displayName, slug, photo, role, stats, currentLiveEvent, bio, tagline, contact, links
- Handoff §5.3.5 requires "Display attendee count toggle" — needs `displayAttendeeCount?: boolean`
- **Spec mitigation:** schema bump v3 → v4. Optional field; undefined treated as `true` at read sites (default-on). Same migration pattern as J-A7's v2→v3.

**H-A8-2 — J-A7 BrandProfileView lacks `onEdit` callback prop**

- File: `mingla-business/src/components/brand/BrandProfileView.tsx:144`
- Current code: `const handleEdit = useCallback((): void => { fireToast("Editing lands in J-A8."); }, [fireToast]);`
- Edit CTA is closure-scoped to a Toast — no way to navigate from the component
- **Spec mitigation:** add `onEdit: (brandId: string) => void` to `BrandProfileViewProps`. Modify `handleEdit` to call `onEdit(brand.id)` (when brand !== null). Route file `app/brand/[id]/index.tsx` passes `onEdit={(id) => router.push(\`/brand/${id}/edit\`)}`.

**H-A8-3 — Unsaved-changes confirm-discard pattern**

- Risk: user edits fields → taps back arrow → loses work silently
- Constitutional principle: data integrity (don't lose user input without confirmation)
- §5.3.5 doesn't explicitly require this but it's standard form UX
- **Spec mitigation:** when `isDirty === true`, intercept back/cancel actions with `ConfirmDialog` (variant="simple", destructive=true on Discard). When clean, immediate back. Establishes pattern reusable across J-A9/A10/A11/A12 edit screens.

**H-A8-4 — Host-bg cascade (carry-over from D-IMPL-A7-6)**

- Risk: route file outside `(tabs)` doesn't inherit `canvas.discover` background — same regression that hit J-A7 during smoke
- **Spec mitigation:** route file `app/brand/[id]/edit.tsx` MUST set `backgroundColor: canvas.discover` on host View. Codify as new invariant **I-12** so future non-tab routes inherit the requirement structurally, not by reminder.

**H-A8-5 — No Toggle primitive in closed Cycle 0a kit**

- Cycle 0a 24 primitives + TopSheet do NOT include a Toggle/Switch primitive
- Design package shows custom 40×24 capsule with 18×18 dot (screens-brand.jsx:242-245)
- React Native's built-in `Switch` is iOS/Android-styled, breaks Mingla design
- **Spec mitigation:** compose toggle inline in BrandEditView using Pressable + Animated View (no kit extension; observation-class). Pattern documentation: if 3+ toggles land elsewhere, candidate for a `Toggle` primitive in a future kit-extension carve-out (DEC-079-style).

### 🔵 Observations

**O-A8-1 — Photo upload deferred but affordance still rendered**
- §5.3.5 lists "Photo" first. Design package shows pencil button overlay on photo.
- Frontend-first per DEC-071 — no actual upload pipeline yet.
- Render the pencil button + Toast `[TRANSITIONAL]` "Photo upload lands in a later cycle." Photo crop edge case deferred with it.

**O-A8-2 — Custom links multi-add UI complex; deferred**
- §5.3.5 mentions "Custom links (multi-add)" but provides no detailed spec for the multi-add component
- Design-package shows "+ Add a link" FieldRow as a single-row affordance
- For J-A8 ship: only website + instagram inputs. Custom links remain in schema (`links.custom` array stays in Brand v4) but no UI yet. Defer to polish or §5.3.6 settings.

**O-A8-3 — Slug stays read-only on J-A8**
- Slug edit lives in §5.3.6 settings ("Slug override")
- J-A8 displays `mingla.com/{brand.slug}` below photo as read-only Text — no Input

**O-A8-4 — Operations rows belong on J-A7 view, NOT in edit form**
- Design-package BrandProfileScreen (line 180-186) renders Operations rows (Payments / Team / Tax / Reports)
- Handoff §5.3.5 does NOT list them in edit-form scope
- **Decision: Operations rows render ONLY on J-A7 view; J-A8 omits them entirely.** They're navigation destinations for J-A9/A10/A11/A12, not edit targets.

**O-A8-5 — Multiple toggles in design package; only 1 in §5.3.5**
- Design-package shows 3 toggles: Show attendee count · Allow followers to message · List in Discover
- Handoff §5.3.5 lists only "Display attendee count toggle"
- "Allow DMs" + "List in Discover" belong in §5.3.6 settings (both are visibility/permission settings, not basic profile)
- J-A8 ships only the attendee-count toggle

**O-A8-6 — Save-then-navigate-back convention**
- §5.3.5 doesn't dictate post-save behavior
- Conventional save pattern (mobile + web): on success, brief Toast + navigate back to view (`router.back()`). Stays-on-edit forces an extra explicit-back action.
- **Spec recommendation: navigate back on save success.** Two-step rationale: (a) mirrors typical iOS Settings UX; (b) cleanly returns user to refreshed J-A7 view with their changes visible.

---

## 4. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs (handoff §5.3.5)** | 5 form sections; clean/dirty/saving/saved/error states |
| **Docs (handoff §5.3.6)** | Settings rows: Tax/VAT · Currency · Timezone · Slug — explicit boundary |
| **Docs (roadmap §3.2)** | J-A8 route `/brand/[id]/edit`, source `BrandProfileScreen edit-mode` |
| **Schema** | N/A (frontend-first) — but client-side schema gap (H-A8-1) |
| **Code** | Brand v3 + J-A7 baseline shipped; J-A8 surface absent |
| **Runtime** | N/A (greenfield) |
| **Data** | AsyncStorage v3 — must migrate to v4 |

**Layer agreement:** §5.3.5 + §5.3.6 + roadmap all align on J-A8 scope. Design-package visual reference cross-checks (FieldRow with chevR is a per-field-edit-drill-in pattern; for J-A8 we ship inline Inputs instead — simpler form UX, equivalent data fidelity).

---

## 5. Blast Radius

J-A8 ships:

| Surface | Change |
|---|---|
| `app/brand/[id]/edit.tsx` (NEW) | New route file |
| `src/components/brand/BrandEditView.tsx` (NEW) | New form component |
| `src/store/currentBrandStore.ts` (MOD) | Brand schema v3 → v4 + migration |
| `src/store/brandList.ts` (MOD) | All 4 STUB_BRANDS get `displayAttendeeCount: true` |
| `src/components/brand/BrandProfileView.tsx` (MOD) | Add `onEdit` prop; remove TRANSITIONAL marker on Edit CTA |
| `app/brand/[id]/index.tsx` (MOD) | Pass `onEdit` handler to BrandProfileView |

**Total:** 6 files (2 new + 4 modified). Slightly larger than J-A7's 5 files due to the J-A7 wiring touch.

**Other Cycle 2 surfaces:**
- J-A7 view screen — gets new `displayAttendeeCount` field; could optionally hide Attendees stat tile when `false`. **Decision: J-A7 view IGNORES the toggle in this cycle** (always shows attendees) — toggle only affects future public-page rendering (Cycle 3+). Spec calls this out.

---

## 6. Invariant Check (full list in spec)

| ID | Risk |
|---|---|
| I-1 | designSystem.ts not modified |
| I-3 | iOS/Android/web parity — TextInput multiline + ConfirmDialog work on all 3 |
| I-4 | No app-mobile/ imports |
| I-6 | tsc strict — explicit return types |
| I-7 | TRANSITIONAL markers on photo upload + custom links deferral |
| I-9 | No animation timings touched (toggle uses standard Animated.View transition) |
| I-11 (J-A7) | Format-agnostic ID resolver — same pattern in edit route |
| **I-12 (NEW)** | Host-bg cascade — every non-tab route sets backgroundColor: canvas.discover |
| DEC-071 | Frontend-first |
| DEC-079 | Kit closure preserved (compose toggle inline; no new primitive) |
| DEC-081 | No mingla-web references |

---

## 7. Fix Strategy (direction only — spec carries detail)

1. Bump Brand v3 → v4 with `displayAttendeeCount?: boolean`. Migration: passthrough (new field starts undefined).
2. Update STUB_BRANDS to set `displayAttendeeCount: true` on all 4.
3. Create `app/brand/[id]/edit.tsx` route file. Same pattern as J-A7 route: format-agnostic find, host-bg, KeyboardAvoidingView wrap.
4. Create `BrandEditView.tsx` with 5 sections + Save button in TopBar right-slot + ConfirmDialog for unsaved-changes back.
5. Modify `BrandProfileView.tsx`: add `onEdit` prop, remove TRANSITIONAL marker on Edit CTA, call `onEdit(brand.id)`.
6. Modify `[id]/index.tsx`: pass `onEdit` handler that does `router.push(\`/brand/${id}/edit\`)`.

---

## 8. Regression Prevention

- **Host-bg cascade invariant I-12** — codifies D-IMPL-A7-6. Every non-tab route file MUST set `backgroundColor: canvas.discover`. Spec adds boilerplate code comment.
- **Edit-CTA wiring pattern** — view component takes `onEdit` callback; route owns navigation. Documented in spec for J-A9/A10+ reuse.
- **Dirty-state confirm-discard pattern** — ConfirmDialog usage spec'd for reuse.
- **Persist version bump discipline** — same pattern as J-A7 (typed migration, header comment with version history).

---

## 9. Discoveries for Orchestrator

| ID | Description | Severity | Action |
|---|---|---|---|
| D-INV-A8-1 | "Allow followers to message" + "List in Discover" toggles from design-package screens-brand.jsx but NOT in handoff §5.3.5 — should belong in §5.3.6 settings. Roadmap §3.2 doesn't list them in any current cycle. | Info | Track in roadmap audit; defer to settings cycle |
| D-INV-A8-2 | Custom links multi-add UI design ambiguous (handoff §5.3.5 mentions but provides no spec). Defer until either explicit design lands OR is moved to §5.3.6 settings. | Info | Track in roadmap audit |
| D-INV-A8-3 | If 3+ Toggle uses appear in future cycles (e.g., notifications, settings), candidate for `Toggle` primitive carve-out (DEC-079-style additive extension). For J-A8: compose inline. | Info | Watch-point — track usage count |
| D-INV-A8-4 | Photo upload deferred entirely. Cycle 14+ candidate (or sooner if stripe/checkout requires brand photos for buyer trust). | Info | Track |
| D-INV-A8-5 | The `displayAttendeeCount` toggle's CONSUMER (where it actually hides numbers) doesn't yet exist. Likely Cycle 3+ public-page rendering. J-A8 stores the boolean but no surface reads it yet. Spec calls this out as expected. | Info | Validate consumer wires up in Cycle 3 |

---

## 10. Confidence

**HIGH.** Pre-flight files all read; handoff §5.3.5 + §5.3.6 boundary explicit; design-package cross-checked; Brand schema gap quantified per-field; carve-outs from J-A6/J-A7 cross-referenced; kit primitive APIs verified (Input multiline, ConfirmDialog destructive, Toast).

---

**End of J-A8 investigation.**
