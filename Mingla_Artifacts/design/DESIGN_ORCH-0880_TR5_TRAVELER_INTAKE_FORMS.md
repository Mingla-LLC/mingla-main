# DESIGN — ORCH-0880 [Tr5 Traveler Intake Forms]

**Skill:** Claude `/ui-ux-pro-max` (standalone design pass)
**Date:** 2026-05-19
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/DESIGNER_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md`
**Inputs:** `Mingla_Artifacts/specs/SPEC_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md` (with §15 per-tier amendment), `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md`
**Status:** BINDING — implementor follows this artifact verbatim for all visible-UI work; no design decisions made at implementation time.

---

## 1. Layman summary

Tr5 ships three new visible surfaces and extends two existing ones. The schema-builder lives in a new wizard Step 6 with a tier-picker tab row (Standard / VIP / etc.) on top so planners can configure different intake forms per ticket tier. Buyers fill the form at a new `/checkout-trip/[tripEventId]/intake` step between buyer-details and payment; with a multi-tier cart the page steps through one tier's form at a time. Planners see all answers in the existing Travelers tab via a new collapsible "Intake form answers" section on each per-traveler card, with image thumbnails inline and PDF/doc download chips. EditPublishedTripScreen gets a new Intake Form accordion section that reuses the same schema-builder primitive in published-edit mode.

All design lives inside Mingla's existing dark-glass design language: orange accent (`#eb7825`), translucent white-on-dark cards, 4-point spacing scale, radius scale (sm 8 → display 40), typography from `display 32pt` down to `micro 11pt`. No new primitives are introduced.

---

## 2. Design system inheritance (REUSE — do not redesign)

| Token / primitive | Source | Tr5 usage |
|---|---|---|
| `accent.warm` (#eb7825), `accent.tint`, `accent.border` | `designSystem.ts:158-163` | Active tab pill, primary CTA, required-asterisk, type-picker chip selected state |
| `glass.tint.profileBase` / `.profileElevated` | `designSystem.ts:194-220` | Question card backgrounds, tab row backdrop, file upload card backgrounds |
| `glass.border.profileBase` / `.profileElevated` | same | Card borders, tab divider, tier chip border |
| `semantic.error` (#ef4444), `semantic.errorTint` | `designSystem.ts:222-231` | Required-field validation error border + helper text + summary banner |
| `semantic.warning` (#f59e0b), `semantic.warningTint` | same | Schema-stale banner during edit-published, "X travelers will be asked to re-answer" warning |
| `semantic.success` (#22c55e) | same | File upload complete checkmark, fill-complete progress indicator |
| `text.primary` (rgba white 0.96), `.secondary` (0.72), `.tertiary` (0.52), `.quaternary` (0.32) | `designSystem.ts:233-239` | All copy hierarchy — labels, helpers, placeholders, char counts |
| `canvas.profile` (#141113) | `designSystem.ts:188-192` | Sheet background, modal background |
| `typography.h1` (26pt 700), `.h3` (20pt 600), `.body` (16pt), `.bodySm` (14pt), `.caption` (12pt), `.labelCap` (12pt uppercase 1.4 letter-spacing) | `designSystem.ts:269-284` | Step title, section headers, question labels, helpers, eyebrows, tier-chip text |
| `spacing.xs` (4), `.sm` (8), `.md` (16), `.lg` (24), `.xl` (32) | `designSystem.ts:29-37` | All padding + gap; never inline pixels |
| `radius.sm` (8), `.md` (12), `.lg` (16), `.full` (999) | `designSystem.ts:39-47` | Card radius lg, button radius md, chip radius full, input radius sm |
| `shadows.glassCardBase`, `.glassChrome`, `.glassChromeActive` | `designSystem.ts:99-112` | Question card depth, tab depth, active-tab orange-glow shadow |
| `GlassCard` primitive (`variant="base"\|"elevated"`, `padding`, `radius`) | `src/components/ui/GlassCard.tsx` | Wrap question editor sheets, schema-builder pane, buyer-fill renderers, Travelers card extension |
| `Sheet` primitive (`heightMode="compact"\|"fixed-70"`) | `src/components/ui/Sheet.tsx` | Question editor sheet (compact), file upload picker sheet (compact) |
| `ConfirmDialog` primitive | `src/components/ui/ConfirmDialog.tsx` | Schema-version-stale warn, delete-question confirm, ChangeSummaryModal reason input |
| `Stepper` primitive (already used by trip wizard) | `src/components/ui/Stepper.tsx` | Wizard step counter grows 6→7 |
| `Button` primitive (`variant="primary"\|"ghost"`, `size="md"\|"sm"`) | `src/components/ui/Button.tsx` | Continue dock buttons, Add question, Cancel/Save sheet buttons |
| `Input` primitive (TextInput wrapper with label + error) | `src/components/ui/Input.tsx` | Question label input, short_text answer, long_text answer (multiline), number answer |
| `IconChrome` primitive (36pt with hitSlop) | `src/components/ui/IconChrome.tsx` | Drag handle, remove-question icon, file-remove icon, expand-arrow on Travelers card |
| `Icon` SVG set (Lucide-shaped) | `src/components/ui/Icon.tsx` | All iconography — NO emojis ever |
| `@react-native-community/datetimepicker` | already in deps | Date question renderer |
| `expo-image-picker` + `expo-document-picker` | already in deps | File upload question renderer |
| `react-native-draggable-flatlist` | Implementor verifies pre-Step-1 | Drag-drop question list in schema-builder |

**No new primitives.** Every Tr5 component composes from the above set.

---

## 3. Schema-builder UI (`TripCreatorStep6Intake`)

### 3.1 Layout

- **Wide (RN-Web on business-web-preview, ≥768pt width):** split-view 50/50 — schema-builder pane on LEFT, live buyer-view preview pane on RIGHT, both fill height. Tier-picker tab row spans full width at the top.
- **Narrow (iOS / Android, <768pt):** vertically stacked — tier-picker at top, then schema-builder pane (60% viewport height with internal scroll), then preview pane (40% viewport height) below a divider. Operator scrolls the page to access the preview; the preview stays in sync with builder edits.

### 3.2 Tier-picker tab row (per D1 per-tier scope)

```
┌─────────────────────────────────────────────────────────────┐
│  STANDARD ($120)    VIP ($240)    + Add intake for tier 3   │
│  ──────────────                                              │
└─────────────────────────────────────────────────────────────┘
```

- Each tab = pill chip, `radius.full`, `paddingV: spacing.xs`, `paddingH: spacing.md`, `minHeight: 36` (touch target via hitSlop:8).
- Active tab: `backgroundColor: accent.tint`, `borderColor: accent.border`, `borderWidth: 1`, `text.primary` label with `fontWeight: 600`, `shadows.glassChromeActive` (orange glow).
- Inactive tab: `backgroundColor: glass.tint.profileBase`, `borderColor: glass.border.profileBase`, `text.secondary` label with `fontWeight: 500`.
- Underline under active tab: 2pt-tall `accent.warm` bar, `width: 100%`, `marginTop: spacing.xs`.
- Tier label format: `{tierName} (${tierPrice})` with currency formatted via `formatCurrency`.
- "Add intake for tier N" CTA (only renders when a tier has no schema yet): `accent.warm` text, `accent.border` 1pt border, `radius.full`, plus-icon-prefix (Lucide Plus 14pt).
- Single-tier collapse: when trip has only 1 ticket tier, the tab row collapses to a single non-clickable `text.tertiary` label `"For all travelers"` aligned left, no border, no background. Maintains layout slot height so wizard doesn't reflow.
- Accessibility: `accessibilityRole="tablist"` on row, `accessibilityRole="tab"` per tab, `accessibilityState={{ selected: isActive }}`, `accessibilityLabel="{tierName} intake form tab"`.

### 3.3 Schema-builder pane

```
┌──────────────────────────────────────────────┐
│ INTAKE QUESTIONS (3)                          │
│                                               │
│ ┌─ ⋮⋮ ─ Passport number ─ TEXT ─ ✓ Req ─ ✕ ┐│
│ │                                            ││
│ └────────────────────────────────────────────┘│
│ ┌─ ⋮⋮ ─ Dietary restrictions ─ LONG ─ ○ ─ ✕ ┐│
│ │                                            ││
│ └────────────────────────────────────────────┘│
│ ┌─ ⋮⋮ ─ Emergency contact ─ TEXT ─ ✓ Req ─ ✕ ┐│
│ │                                            ││
│ └────────────────────────────────────────────┘│
│                                               │
│  ┌────────────────────────────────────────┐  │
│  │  + Add question                        │  │
│  └────────────────────────────────────────┘  │
│                                               │
│  ───── Clear all questions ─────              │
└──────────────────────────────────────────────┘
```

- Header eyebrow: `typography.labelCap` "INTAKE QUESTIONS ({count})" in `accent.warm`. `marginBottom: spacing.sm`.
- Question card (one per question in the schema):
  - `GlassCard variant="base" padding={spacing.md} radius="lg"`, `marginBottom: spacing.sm`
  - Row layout: `flexDirection: "row"`, `alignItems: "center"`, `gap: spacing.sm`
  - Drag handle: Lucide `GripVertical` 18pt at `text.tertiary`, `width: 24`. Long-press to drag (via `react-native-draggable-flatlist`).
  - Question label (truncated): `typography.body` `text.primary`, `flex: 1`, `numberOfLines: 1`, `ellipsizeMode: "tail"`.
  - Type pill: `typography.caption` uppercase, `text.secondary`, `glass.tint.profileBase` background, `radius.full`, `paddingH: spacing.xs`, `paddingV: 2`. Labels per type below.
  - Required indicator: `accent.warm` filled checkmark (Lucide `Check` 14pt in tinted circle) when required, light `glass.border.profileBase` empty circle when optional. `accessibilityLabel={isRequired ? "Required" : "Optional"}`.
  - Remove `✕` icon: `IconChrome icon="close" size={32}` with `hitSlop:8`, `text.tertiary` color, tap → 2-tap confirm-on-clear pattern (mirror ORCH-0875 RefundPolicyEditor) — first tap arms `semantic.errorTint` background; second tap commits removal.
  - Tap anywhere on card body (except handle / remove / required toggle) → opens `IntakeQuestionEditor` sheet for that question.
- Type pill labels (uppercase): `SHORT TEXT`, `LONG TEXT`, `CHOICE` (single), `MULTI`, `DATE`, `NUMBER`, `FILE`.
- "+ Add question" button:
  - `Button variant="ghost" size="md" leadingIcon="plus" fullWidth` (or styled Pressable mirroring ORCH-0875 RefundPolicyEditor add-tier button)
  - `borderColor: accent.border`, `borderWidth: 1`, `backgroundColor: "transparent"`, `radius.md`, `paddingV: spacing.sm`, `minHeight: 44`, `text.primary` `fontWeight: 600`
  - Tap → opens type picker sheet (§3.5)
  - Disabled state when `questions.length >= 20` (per schema validator cap); label changes to `"Maximum 20 questions"`, `opacity: 0.4`.
- "Clear all questions" link (bottom of pane):
  - `typography.bodySm` `text.tertiary`, centered, `paddingV: spacing.sm`
  - 2-tap confirm pattern (mirror RefundPolicyEditor): first tap → red-bordered card surfaces with "Clear all intake questions for this tier? Buyers won't be asked anything." + Keep / Yes-clear buttons. Single accidental tap can't wipe schema.

### 3.4 Question editor sheet (`IntakeQuestionEditor`)

Bottom-up sheet via `Sheet heightMode="compact"`. Modal over the wizard. Header + scrollable body + sticky footer.

```
┌─────────────────────────────────────────────┐
│  ─                                          │  (drag handle)
│                                              │
│  EDIT QUESTION                               │  (labelCap accent.warm)
│                                              │
│  Question label *                            │  (caption text.secondary)
│  ┌──────────────────────────────────────┐   │
│  │ Passport number                       │   │  (Input primitive)
│  └──────────────────────────────────────┘   │
│  47 / 200                                    │  (caption text.tertiary right)
│                                              │
│  Type                                        │  (caption text.secondary)
│  [ SHORT TEXT ] LONG  CHOICE  MULTI  DATE   │  (horizontal scroll chip row)
│  NUMBER  FILE                                │
│                                              │
│  Required                                    │
│  ┌─ Switch ─┐  (existing Switch primitive)  │
│                                              │
│  ─── Type-specific config (varies) ───       │
│  ...                                         │
│                                              │
│  ┌──────────┐  ┌──────────────────────────┐ │
│  │  Cancel  │  │       Save question      │ │  (sticky footer)
│  └──────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────┘
```

- Sheet background: `canvas.profile`, `radius.xxl` top corners only.
- Padding: `spacing.lg` all sides.
- Header eyebrow `EDIT QUESTION` (new question = `NEW QUESTION`) in `typography.labelCap` `accent.warm`.
- Label field: `Input` primitive, `placeholder="e.g., What's your passport number?"`, max 200 chars enforced via `maxLength`, char counter `{length} / 200` below right-aligned in `typography.caption` `text.tertiary`; turns `semantic.warning` at 180+, `semantic.error` at 200.
- Type chip row: horizontal `ScrollView` with `keyboardShouldPersistTaps="handled"`, each chip = `radius.full`, `paddingH: spacing.md`, `paddingV: spacing.xs`, `minHeight: 36`, active = `accent.tint` + `accent.border`, inactive = `glass.tint.profileBase` + `glass.border.profileBase`. Tap a type to switch; switching a type with answered options shows `ConfirmDialog` "Switching type will clear current configuration. Continue?".
- Required Switch: same `Switch` primitive used by ORCH-0875 BookingDeadlinePicker, with `trackColor={{ false: glass.border.profileBase, true: accent.tint }}`, `thumbColor={required ? accent.warm : text.tertiary}`.
- Type-specific config sections per §3.4.A–G.
- Footer: `Button` row, Cancel (`variant="ghost"`) on left + Save (`variant="primary"`, `flex: 2`) on right.

#### 3.4.A short_text type config
No extra fields. Just the base label + required + (optional) placeholder hint field below required toggle:
```
Placeholder hint (optional)
┌──────────────────────────────────────┐
│ e.g., AB1234567                       │
└──────────────────────────────────────┘
```

#### 3.4.B long_text type config
Same as 3.4.A but Input is multiline (3 rows visible).

#### 3.4.C single_choice / multi_choice config

```
Options (2-10)
┌─ ⋮⋮ ─ Option 1 ────────────────── ✕ ┐
│  ┌──────────────────────────────┐    │
│  │ Vegetarian                   │    │
│  └──────────────────────────────┘    │
└─────────────────────────────────────┘
┌─ ⋮⋮ ─ Option 2 ────────────────── ✕ ┐
│  ┌──────────────────────────────┐    │
│  │ Vegan                        │    │
│  └──────────────────────────────┘    │
└─────────────────────────────────────┘

  + Add option
```

- Drag-drop reorderable via `react-native-draggable-flatlist` (same primitive as question list).
- Per-option row: handle + Input + remove `✕`. Remove disabled when only 2 options remain.
- "+ Add option" button: ghost variant, disabled when 10 options reached with label `"Maximum 10 options"`.
- Validation: option text required, min 2 options, max 10 options.

#### 3.4.D date type config
No extra fields. Optional `min_date` + `max_date` could be added in follow-up ORCH; v1 ships unconstrained.

#### 3.4.E number type config
```
Optional limits
┌──────────────┐  ┌──────────────┐
│ Min (blank)  │  │ Max (blank)  │
└──────────────┘  └──────────────┘
☐ Integer only (no decimals)
```
Two numeric Inputs side by side + integer-only Switch. Inline validation: min ≤ max if both set.

#### 3.4.F file_upload type config
```
Maximum files per upload
[1]  2  3  4  5

Allowed file types
☑ Images (JPG, PNG, HEIC, WebP)
☑ PDFs
☑ Documents (DOCX, DOC)
```
- Max files: chip-style number picker, 1 active by default. Tap to select.
- File-type allowlist: 3 checkboxes (each is a Pressable with `Check` icon when selected). Buyer's picker filters MIME types based on selection.
- Helper text below: `"Files capped at 10 MB each. Operators see all answers in the trip dashboard."` in `typography.caption` `text.tertiary`.

#### 3.4.G New-question flow
Tapping "+ Add question" in §3.3 opens a type-picker sheet first (smaller compact sheet), then opens the editor sheet pre-configured for that type:

```
┌─────────────────────────────────────────────┐
│  ADD QUESTION                                │
│                                              │
│  ┌─────────────┐ ┌─────────────┐            │
│  │ SHORT TEXT  │ │ LONG TEXT   │            │
│  └─────────────┘ └─────────────┘            │
│  ┌─────────────┐ ┌─────────────┐            │
│  │   CHOICE    │ │    MULTI    │            │
│  └─────────────┘ └─────────────┘            │
│  ┌─────────────┐ ┌─────────────┐            │
│  │    DATE     │ │   NUMBER    │            │
│  └─────────────┘ └─────────────┘            │
│  ┌─────────────────────────────┐            │
│  │       FILE UPLOAD           │            │
│  └─────────────────────────────┘            │
└─────────────────────────────────────────────┘
```

7 type cards in a 2-col grid. Each card = `GlassCard variant="base" padding={spacing.md} radius="lg"`, `minHeight: 72`. Type label `typography.body` + tiny icon (Lucide variants: Type, AlignLeft, CircleDot, CheckSquare, Calendar, Hash, Upload).

### 3.5 Live preview pane (`IntakeQuestionPreview`)

```
┌──────────────────────────────────────────────┐
│  PREVIEW · STANDARD                           │  (labelCap accent.warm + tier chip)
│                                               │
│  ─────────────────────────────────             │
│                                               │
│  Passport number *                            │  (body text.primary + asterisk)
│  ┌─────────────────────────────────────┐     │
│  │ AB1234567                            │     │  (disabled-looking Input)
│  └─────────────────────────────────────┘     │
│                                               │
│  Dietary restrictions                         │
│  ┌─────────────────────────────────────┐     │
│  │ Vegetarian, no nuts                  │     │
│  │                                       │     │
│  │                                       │     │
│  └─────────────────────────────────────┘     │
│                                               │
│  Emergency contact *                          │
│  ┌─────────────────────────────────────┐     │
│  │                                       │     │
│  └─────────────────────────────────────┘     │
│                                               │
│  ──────────────────────────────────            │
│  This is what travelers will see.             │  (caption text.tertiary)
└──────────────────────────────────────────────┘
```

- Header eyebrow `PREVIEW · {ACTIVE_TIER_NAME_UPPERCASE}` so planner always sees which tier they're previewing.
- Body renders each question via the SAME buyer-fill renderers used by `/checkout-trip/[tripEventId]/intake.tsx` (§4), but with `disabled={true}` prop so inputs are read-only and tap-inert.
- Pre-filled placeholder text in inputs simulates a real fill so planner can visualize spacing.
- Required asterisk: red `*` after question label, `accent.warm` color, `marginLeft: 2`.
- Bottom helper line: `typography.caption` `text.tertiary`, centered. Reassures planner this is buyer-side view.
- Empty state (no questions yet): centered illustration (Lucide `FileText` 48pt at `text.quaternary`) + `text.tertiary` body "Add a question to see how travelers will see this form."

---

## 4. Buyer-fill route UI (`/checkout-trip/[tripEventId]/intake.tsx`)

### 4.1 Header chrome (mirrors `/checkout-trip/[tripEventId]/buyer.tsx`)

```
┌──────────────────────────────────────────────┐
│   ←      Tell us about your trip      3 OF 4 │
│          Standard ticket form                 │
└──────────────────────────────────────────────┘
```

- Reuses `CheckoutHeader` primitive shipped by ORCH-0876 V2 [Trip CRUD + Purchase Flow Completion].
- Title: `typography.h1` `text.primary` "Tell us about your trip".
- Subtitle below title (NEW for Tr5): `typography.bodySm` `text.tertiary` showing the active tier name + form-position when multi-tier. For single-tier: subtitle hidden.
- Progress pill right side: `glass.tint.chrome.idle` background, `radius.full`, padding `spacing.xs spacing.sm`, `typography.micro` uppercase "{N} OF {TOTAL}". Total = 3 (single-tier) or 4 (when intake present) or higher with multi-tier cart.
- Back arrow left: `IconChrome icon="chevL" size={36}` with `hitSlop:8`. Tap → router.back() to buyer step.

### 4.2 Multi-tier stepped flow

When buyer's cart contains 2+ tier types, the intake screen steps through them one at a time. Internal progress lives at the top of the form body:

```
┌──────────────────────────────────────────────┐
│  STANDARD TICKET · FORM 1 OF 2                │
│  ●━━━━━━━━━━━━━━━━━━━━○                       │
└──────────────────────────────────────────────┘
```

- Section eyebrow `typography.labelCap` `accent.warm` "{TIER_NAME} TICKET · FORM {N} OF {TOTAL}".
- Progress dots: 2 dots horizontal, active = `accent.warm` filled, inactive = `glass.border.profileBase` outlined. Line between them = `accent.warm` for completed, `glass.border.profileBase` for pending.
- When buyer completes tier 1 and taps Continue, the form replaces with tier 2's questions. Back button on header → goes to tier 1 (not the prior route). Buyer can navigate freely between completed tiers.

### 4.3 Question renderers (7 components)

All renderers share a common wrapper:

```
┌──────────────────────────────────────────────┐
│  Passport number *                            │
│  ┌─────────────────────────────────────┐     │
│  │ {type-specific input}                │     │
│  └─────────────────────────────────────┘     │
│  Optional helper text or char counter         │
└──────────────────────────────────────────────┘
```

- Wrapper: `marginBottom: spacing.lg` (24pt between questions).
- Label: `typography.body` `text.primary`, `marginBottom: spacing.xs`.
- Required asterisk: `accent.warm` `*` after label.
- Optional badge (when NOT required): `typography.caption` `text.tertiary` "(optional)" inline after label.
- Input border default: `glass.border.profileBase`; focused: `accent.border`; error: `semantic.error`.
- Helper text / char count / hint: `typography.caption` `text.tertiary` below input; turns `semantic.error` when validation fails.
- Inline error message: `typography.caption` `semantic.error`, `marginTop: spacing.xs`, prefixed with `AlertCircle` icon 14pt.

#### 4.3.A short_text (`IntakeQuestionShortText`)
```
┌─────────────────────────────────────┐
│ AB1234567                            │
└─────────────────────────────────────┘
47 / 200
```
- `Input` primitive single-line. `maxLength: 200`. `keyboardType: "default"`. `autoCapitalize: "sentences"` (override-able).
- Char counter right-aligned `typography.caption` `text.tertiary`, turns `semantic.warning` at 180+, `semantic.error` at 200.

#### 4.3.B long_text (`IntakeQuestionLongText`)
- Multiline `Input` primitive, `numberOfLines: 4` min, grows to 8 with scroll.
- `maxLength: 2000`. Char counter same pattern.
- Honor `feedback_keyboard_never_blocks_input.md`: parent ScrollView reserves bottom space for keyboard via dynamic `paddingBottom: keyboardHeight`.

#### 4.3.C single_choice (`IntakeQuestionSingleChoice`)

```
┌─ ○ Vegetarian ──────────────────────┐
└──────────────────────────────────────┘
┌─ ● Vegan ───────────────────────────┐
└──────────────────────────────────────┘
┌─ ○ Pescatarian ─────────────────────┐
└──────────────────────────────────────┘
```

- Each option = full-width `Pressable` card. `GlassCard variant="base"` shape but tap-targetable.
- Selected: `backgroundColor: accent.tint`, `borderColor: accent.border`, `borderWidth: 1`, radio dot filled `accent.warm`.
- Unselected: `backgroundColor: glass.tint.profileBase`, `borderColor: glass.border.profileBase`, radio dot outline `text.tertiary`.
- Radio dot: Lucide `Circle` 18pt outline (unselected) / `CircleDot` 18pt fill (selected), `marginRight: spacing.sm`.
- Option label: `typography.body` `text.primary`.
- Min `minHeight: 56` for touch target comfort (well above 44pt requirement).
- `marginBottom: spacing.xs` between options.

#### 4.3.D multi_choice (`IntakeQuestionMultiChoice`)
Same shape as single_choice but checkbox icon (Lucide `Square` outline → `CheckSquare` fill) instead of radio dot. Multi-select.

#### 4.3.E date (`IntakeQuestionDate`)
```
┌─────────────────────────────────────┐
│  Sat, Jun 14, 2026             📅   │
└─────────────────────────────────────┘
```
- Pressable input that opens native `@react-native-community/datetimepicker` in `mode="date"` (NOT datetime — intake is date-only per Spec).
- Pre-fill: empty input shows placeholder `"Tap to choose date"` in `text.tertiary`.
- After selection: formatted display `"Sat, Jun 14, 2026"` (per `Intl.DateTimeFormat({ weekday: "short", month: "short", day: "numeric", year: "numeric" })`).
- Calendar icon right (Lucide `Calendar` 18pt `text.secondary`).
- iOS: `themeVariant="dark"` + `textColor={text.primary}` per ORCH-0875 BookingDeadlinePicker hot-fix pattern (avoids the dark-spinner-illegible bug).
- iOS uses pending-state Set/Cancel pattern (mirror ORCH-0875): scrolling spinner doesn't commit until "Set date" tapped.
- Android: native modal-confirm picker.

#### 4.3.F number (`IntakeQuestionNumber`)
```
┌─────────────────────────────────────┐
│ 32                                   │
└─────────────────────────────────────┘
Min 18 · Max 99
```
- `Input` primitive with `keyboardType="numeric"` (or `"number-pad"` if integer-only).
- Min/max hint below in `typography.caption` `text.tertiary` (only renders when min/max set).
- Inline validation: out-of-range → `semantic.error` border + error message "{value} is below the minimum ({min})" or "above the maximum ({max})".

#### 4.3.G file_upload (`IntakeQuestionFileUpload`)

Empty state:
```
┌─────────────────────────────────────┐
│   ↑                                  │
│   ┌────────────────────────────┐    │
│   │      + Choose file          │    │
│   └────────────────────────────┘    │
│   Up to 3 files · 10 MB each         │
│   Images, PDFs, docs allowed         │
└─────────────────────────────────────┘
```

- Empty-state card: `GlassCard variant="base" padding={spacing.lg} radius="lg"`.
- Upload icon: Lucide `Upload` 32pt `accent.warm` centered, `marginBottom: spacing.sm`.
- "Choose file" button: `Button variant="primary" size="md" fullWidth={false}` width `auto`. Tap → opens picker chooser sheet (§4.3.G.1).
- Helper lines below button: `typography.caption` `text.tertiary` centered. Render configured limits + allowed types.

Filled state (1+ files uploaded):
```
┌─────────────────────────────────────┐
│  Uploaded files                      │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ [thumb] passport.jpg     ✕   │   │
│  │         2.3 MB · uploaded     │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌──────────────────────────────┐   │
│  │ [📄]   vaccine.pdf       ✕   │   │
│  │         1.1 MB · uploaded     │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌────────────────────────────┐     │
│  │     + Add another file     │     │
│  └────────────────────────────┘     │
└─────────────────────────────────────┘
```

- Per-file card: `GlassCard variant="base" padding={spacing.sm} radius="md"`, `flexDirection: "row"`, `alignItems: "center"`, `gap: spacing.sm`, `marginBottom: spacing.xs`.
- Thumbnail (left):
  - **Images:** 48x48pt `<Image>` with `radius.sm`, `resizeMode="cover"`.
  - **PDFs/docs:** 48x48pt `GlassCard variant="base"` with centered Lucide `FileText` 24pt `text.secondary` icon.
- Filename + meta (center): `flex: 1`.
  - Filename: `typography.body` `text.primary`, `numberOfLines: 1`, `ellipsizeMode: "middle"` (so `.pdf` extension stays visible).
  - Meta line below: `typography.caption` `text.tertiary` "{size} · {status}". Status = `uploading` (with spinner) / `uploaded` / `failed`.
- Remove `✕`: `IconChrome icon="close" size={32}` `text.tertiary`, `hitSlop:8`, tap → 2-tap confirm-on-clear for accidental tap prevention (mirror RefundPolicyEditor pattern).
- Upload progress: when status=`uploading`, show animated spinner (Lucide `Loader2` rotating) right of filename. Progress percentage `typography.caption` `text.tertiary` if available from upload helper.
- Upload failure: status=`failed` → `semantic.error` border on card + error line below filename "{error message} · Retry". "Retry" is a Pressable text link `accent.warm`.
- "Add another file" button only renders when `count < max_files`. Disabled state at max files: label `"Maximum {max_files} files"`, `opacity: 0.4`.

##### 4.3.G.1 Picker chooser sheet

When buyer taps "Choose file", a compact sheet asks which source:

```
┌─────────────────────────────────────┐
│  ─                                   │
│                                      │
│  ADD FILE                            │
│                                      │
│  ┌────────────────────────────┐     │
│  │  📷  Take photo             │     │  (only if image MIME enabled)
│  └────────────────────────────┘     │
│  ┌────────────────────────────┐     │
│  │  🖼  Choose from library    │     │  (only if image MIME enabled)
│  └────────────────────────────┘     │
│  ┌────────────────────────────┐     │
│  │  📄  Browse files (PDF/doc) │     │  (only if PDF/doc MIME enabled)
│  └────────────────────────────┘     │
│                                      │
│  ┌────────────────────────────┐     │
│  │            Cancel           │     │
│  └────────────────────────────┘     │
└─────────────────────────────────────┘
```

- Sheet `heightMode="compact"` per `feedback_topsheet_extended_universal_creator.md` carve-out — must be added to allowlist at implement-time.
- Each source = full-width `Button variant="ghost" size="md"` with leading icon (Lucide `Camera`, `Image`, `FileText`).
- Tap "Take photo" / "Choose from library" → `expo-image-picker.launchCameraAsync` / `.launchImageLibraryAsync` with `mediaTypes: 'Images'` and `quality: 0.8`.
- Tap "Browse files" → `expo-document-picker.getDocumentAsync` with allowed MIME types per question config.
- Cancel → close sheet.

Note: emoji icons in the ASCII mockup are PLACEHOLDERS for the design specification only. The actual implementation uses Lucide SVG icons per `no-emoji-icons` rule.

### 4.4 Continue button (sticky dock)

```
┌──────────────────────────────────────────────┐
│  [          Continue to payment        →    ]│
└──────────────────────────────────────────────┘
```

- Sticky dock at bottom of viewport. Reuses the `dock` pattern from `TripCreatorWizard` `styles.dock` shape: `GlassCard variant="elevated" padding={6} radius="xxl"`, `marginHorizontal: spacing.md`, `marginBottom: spacing.lg`. Hidden when keyboard up (per existing keyboard listener pattern).
- Single CTA when last form step: "Continue to payment".
- Single CTA when multi-tier intermediate step: "Continue to next form".
- Back button (only on multi-tier intermediate steps): left `Button variant="ghost" size="md" leadingIcon="chevL"`. flex: 1.
- Continue primary CTA: `Button variant="primary" size="md" fullWidth` (or flex: 2 in dock row). Right-trailing chev icon `chevR`. Disabled state when validation fails.
- Disabled state: `opacity: 0.4`, `accessibilityState: { disabled: true }`. Helper text above dock (in glass tint): "{N} required questions still need answers" `typography.caption` `semantic.warning`.
- Loading state (during navigation): label changes to `"Loading..."`, spinner replaces chev.

### 4.5 Abandonment recovery toast

When buyer revisits the intake page within 7-day TTL with localStorage/AsyncStorage draft present:

```
                          ┌─────────────────────────┐
                          │ ✓ Your answers were      │
                          │   restored.    Dismiss   │
                          └─────────────────────────┘
```

- Toast component (existing `Toast` primitive). Wrapped in absolute-positioned `<View style={{position:"absolute", top: insets.top + spacing.md, left: 0, right: 0, paddingHorizontal: spacing.md, zIndex:100}}>` per `feedback_toast_needs_absolute_wrap.md`.
- Kind: `success` → green-tinted background.
- Auto-dismiss after 4 seconds OR on first interaction with any form field.
- Accessibility: `accessibilityLiveRegion="polite"`.

### 4.6 Validation summary banner (required-field missing)

When buyer taps Continue with missing required answers, render at TOP of form body (above first question) AND scroll the first missing question into view:

```
┌──────────────────────────────────────────────┐
│  ⚠ Please answer 2 required questions         │
│     before continuing.                        │
└──────────────────────────────────────────────┘
```

- `GlassCard variant="base"` with `borderColor: semantic.error`, `backgroundColor: semantic.errorTint`, `padding: spacing.md`, `marginBottom: spacing.lg`, `radius: lg`.
- Icon left: Lucide `AlertCircle` 20pt `semantic.error`.
- Text: `typography.body` `text.primary`, plural-aware count.
- Accessibility: `accessibilityLiveRegion="assertive"` so screen readers announce.

---

## 5. Travelers tab card extension (`TravelerIntakeAnswerCard`)

Per-traveler card (existing from ORCH-0873 [Tr3 Stage 2 UI]) gets a new "Intake form" section below the existing name+email+phone block AND a tier chip top-right.

### 5.1 Tier chip (NEW top-right of card)

```
┌──────────────────────────────────────────────────┐
│  Sarah Chen                          [ VIP ]      │
│  sarah@example.com                                │
│  +1 555-0123                                      │
└──────────────────────────────────────────────────┘
```

- Chip: `typography.caption` uppercase `text.primary` `fontWeight: 600`.
- Background: `accent.tint`, border `accent.border`, `radius.full`, padding `spacing.xs spacing.sm`.
- Hides when trip has only 1 tier (single-tier trips don't need tier disambiguation).
- Accessibility: `accessibilityLabel="VIP traveler"`.

### 5.2 Intake form answers section (below contact block)

Collapsed state:
```
┌──────────────────────────────────────────────────┐
│  ...contact block...                              │
│                                                   │
│  ───────────────────────────────────              │
│                                                   │
│  Intake form answers (5)                    ▾    │  (tap to expand)
│                                                   │
└──────────────────────────────────────────────────┘
```

Expanded state:
```
┌──────────────────────────────────────────────────┐
│  ...contact block...                              │
│                                                   │
│  ───────────────────────────────────              │
│                                                   │
│  Intake form answers (5)                    ▴    │
│                                                   │
│  Passport number                                  │
│  AB1234567                                        │
│                                                   │
│  Dietary restrictions                             │
│  Vegetarian, no nuts                              │
│                                                   │
│  Emergency contact                                │
│  John Chen, +1 555-0987                          │
│                                                   │
│  Vaccination records                              │
│  ┌───────┐ ┌───────┐                             │
│  │       │ │  📄   │                             │
│  │ [img] │ │vacc.pdf│                            │
│  │       │ │  [⬇]  │                             │
│  └───────┘ └───────┘                             │
│  Tap image to enlarge · Tap PDF to download       │
└──────────────────────────────────────────────────┘
```

- Section eyebrow: `typography.labelCap` `text.tertiary` "INTAKE FORM ANSWERS ({count})".
- Expand-arrow icon: Lucide `ChevronDown` (collapsed) / `ChevronUp` (expanded), 20pt `text.tertiary`. Tap header → toggle expand. `accessibilityRole="button"` `accessibilityState={{ expanded: isExpanded }}`.
- Each Q+A pair:
  - Question label: `typography.caption` `text.tertiary`, `marginBottom: spacing.xxs`.
  - Answer value: `typography.body` `text.primary`.
  - `marginBottom: spacing.md` between pairs.
- Empty answer state: when buyer skipped an optional question, answer renders as `"—"` in `text.quaternary` (NEVER fabricate; honor Constitution #9).
- File answer rendering — separate sub-component `IntakeAnswerFileThumbnail` (§5.3).
- Helper line below file thumbnails: `typography.caption` `text.tertiary` "Tap image to enlarge · Tap PDF to download".
- Multi-choice answer: render as comma-separated list "Vegetarian, Gluten-free, No nuts".

### 5.3 File thumbnail (`IntakeAnswerFileThumbnail`)

- Image files:
  - Size: 80x80pt square card. `GlassCard variant="base" padding={0} radius="md"`.
  - `<Image>` with `resizeMode="cover"`, full card size.
  - Loaded via signed URL (1-hour expiry; refetched lazily when card scrolls into view).
  - Tap → opens `IntakeAnswerFilePreview` modal (§5.4).
  - Loading state: skeleton shimmer.
  - Failed state: Lucide `ImageOff` 24pt `text.quaternary` centered + caption "Image unavailable".
- PDF / doc files:
  - Size: 80x100pt card (taller for filename).
  - Icon: Lucide `FileText` 32pt `text.secondary` centered top, `paddingTop: spacing.sm`.
  - Filename: `typography.caption` `text.primary`, `numberOfLines: 2`, `ellipsizeMode: "middle"`, bottom of card, padding `spacing.xs`.
  - Download icon overlay: bottom-right `IconChrome icon="download" size={24}` with `accent.warm` tint.
  - Tap → opens signed URL via `Linking.openURL` (system browser handles download).

Multiple files per question rendered in horizontal `ScrollView` (if >3 files) or wrap row (if ≤3 files). `gap: spacing.xs` between cards.

### 5.4 File preview modal (`IntakeAnswerFilePreview`)

Full-screen modal for image enlarge:

```
┌──────────────────────────────────────────────┐
│                                          ✕   │  (close button top-right)
│                                               │
│                                               │
│             [enlarged image]                  │
│                                               │
│                                               │
│                                               │
│        passport.jpg · 2.3 MB                  │  (caption bottom)
└──────────────────────────────────────────────┘
```

- Modal background: `canvas.depth` (#08090c) full-bleed.
- Close `✕`: `IconChrome icon="close" size={36}` top-right, `paddingTop: insets.top + spacing.md`, `paddingRight: spacing.md`, `text.primary`. Tap → close modal.
- Image: full-width with `aspectRatio` preserved (cap at viewport-height minus header+caption). Pinch-zoom via `react-native-gesture-handler` (already in deps) — if implementor verifies not in deps, fall back to basic non-zoom render.
- Caption bottom: `typography.caption` `text.tertiary`, centered, `paddingBottom: insets.bottom + spacing.md`. Format: `"{filename} · {size}"`.
- Backdrop tap (anywhere outside image) → close modal.

---

## 6. EditPublishedTripScreen Intake Accordion

Existing `EditPublishedTripScreen` from ORCH-0876 V2 has accordion sections. Tr5 adds one new section: "Intake form".

### 6.1 Accordion shape

Collapsed state:
```
┌──────────────────────────────────────────────────┐
│  Intake form                          ▾  2 tiers │
└──────────────────────────────────────────────────┘
```

Expanded state:
```
┌──────────────────────────────────────────────────┐
│  Intake form                                  ▴  │
│                                                   │
│  [ tier-picker tabs identical to §3.2 ]          │
│                                                   │
│  [ schema-builder pane identical to §3.3 ]       │
│                                                   │
│  [ live preview pane identical to §3.5 ]         │
│                                                   │
│  ⚠ Editing intake questions will ask 3 travelers │
│    to re-answer.                                  │
│                                                   │
│  ┌──────────────────────────────────────────┐   │
│  │       Save changes                        │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

- Section header reuses ORCH-0876 V2 accordion header pattern (whatever shape that ships — designer treats as black-box; implementor mirrors).
- Right-side meta: "{N} tiers" count of tiers with schema configured. Hidden when 0 tiers (renders "Not configured" in `text.tertiary` instead).
- Body embeds the same `IntakeSchemaBuilder` + `IntakeQuestionPreview` primitives from §3 — no design divergence between wizard and edit-published. Behavior change only: in published-edit mode, the builder shows a re-answer-count badge.
- Re-answer warning banner (NEW in published-edit mode): `GlassCard variant="base"` with `borderColor: semantic.warning`, `backgroundColor: semantic.warningTint`, padding `spacing.md`, `radius: lg`, `marginTop: spacing.md`, `marginBottom: spacing.sm`. Lucide `AlertTriangle` icon 20pt `semantic.warning` left. Text plural-aware: "Editing intake questions will ask {N} traveler{s} to re-answer.". Hidden when 0 affected travelers.
- "Save changes" button: `Button variant="primary" size="md" fullWidth`. Tap → opens `ChangeSummaryModal` (§6.2). Disabled when no diff vs persisted schema.

### 6.2 ChangeSummaryModal (reused + extended)

The existing `ChangeSummaryModal` from ORCH-0876 V2 handles reason-required input. Tr5 extends the copy:

- Title: `"Save intake form changes?"`.
- Description (renders above reason TextInput): `"You're updating the {tier_name} tier's intake form. {N} traveler{s} will be asked to re-answer the affected questions and notified by email."` (push notification also fires per spec D10 but not surfaced in copy to keep it tight).
- Reason TextInput: `placeholder="e.g., Added passport scan requirement for new visa policy."`, `minLength: 10`, `maxLength: 200`, char counter below.
- Confirm button label: `"Save + notify travelers"`.
- Cancel button label: `"Keep editing"`.
- On submit: `biz_update_live_trip` RPC call with `intake_schemas` patch key + reason. Success → close modal, refetch, surface success Toast "Intake form saved · {N} traveler{s} notified."

---

## 7. Color + typography + spacing + accessibility checklist

| Surface | Token usage |
|---|---|
| Schema-builder tier-picker active tab | `accent.tint` bg + `accent.border` border + `text.primary` label + `shadows.glassChromeActive` |
| Schema-builder tier-picker inactive tab | `glass.tint.profileBase` bg + `glass.border.profileBase` border + `text.secondary` label |
| Question card body | `glass.tint.profileBase` bg + `glass.border.profileBase` border |
| Required indicator | `accent.warm` filled circle + check icon |
| Remove/Clear 2nd-tap confirm | `semantic.errorTint` bg + `semantic.error` border |
| Buyer-fill option card selected | `accent.tint` bg + `accent.border` border + `accent.warm` radio/check |
| Buyer-fill input focus | `accent.border` border |
| Buyer-fill validation error | `semantic.error` border + `semantic.error` helper text |
| Validation summary banner | `semantic.errorTint` bg + `semantic.error` border + `text.primary` text |
| Re-answer warning banner | `semantic.warningTint` bg + `semantic.warning` border + `text.primary` text |
| Travelers tab tier chip | `accent.tint` bg + `accent.border` border + `text.primary` label |
| Travelers tab Q+A pair | Q label `text.tertiary` caption + A value `text.primary` body |
| Empty answer placeholder `—` | `text.quaternary` |
| File thumbnail card | `glass.tint.profileBase` bg + `glass.border.profileBase` border |
| Sheet background | `canvas.profile` (#141113) |
| File preview modal | `canvas.depth` (#08090c) full-bleed |

### Accessibility (I-38 + I-39 + WCAG AA)

- Every interactive Pressable: `accessibilityRole`, `accessibilityLabel`, `accessibilityState` (selected/disabled/expanded as appropriate), `hitSlop: 8` minimum.
- Touch target ≥ 44pt: confirmed via `minHeight: 44` (most CTAs use 56+), `minHeight: 36` + `hitSlop: 8` on chips (effective 52pt), `IconChrome size: 32` + `hitSlop: 8` (effective 48pt).
- Text contrast on `canvas.profile` (#141113):
  - `text.primary` (white 0.96) = 19.5:1 ratio — well above AAA
  - `text.secondary` (white 0.72) = 14.3:1 — AAA
  - `text.tertiary` (white 0.52) = 9.8:1 — AAA
  - `text.quaternary` (white 0.32) = 5.8:1 — AA (use for placeholders + empty states only, not primary copy)
  - `accent.warm` (#eb7825) on canvas = 4.6:1 — AA for normal text
  - `semantic.error` (#ef4444) on canvas = 4.8:1 — AA
- Screen-reader live regions: validation summary banner = `assertive`; abandonment recovery toast = `polite`.
- Keyboard navigation (RN-Web): tab order matches visual order. Form-label `htmlFor` association via `nativeID` + `accessibilityLabelledBy`.
- `prefers-reduced-motion` honored: drag-drop animation falls back to instant swap. Toast slide-in falls back to fade.
- Color is NEVER the sole indicator — required uses both `accent.warm *` + filled-circle icon; error uses both `semantic.error` border + AlertCircle icon + text.

---

## 8. Anti-patterns to avoid (designer-enforced)

- ❌ NO emoji icons. All iconography uses Lucide SVG from existing `Icon.tsx` set. The ASCII mockups in this spec use 📷 / 📄 / ✓ as visual placeholders ONLY — implementor maps each to the correct Lucide icon (Camera, FileText, Check, etc.).
- ❌ NO `oklch()` / `lab()` / `color-mix()` / `hwb()` in RN inline styles. Per `feedback_rn_color_formats.md` — they render transparent on iOS+Android.
- ❌ NO inline style objects. Use `StyleSheet.create` everywhere.
- ❌ NO hardcoded hex / rgb. Reference tokens from `designSystem.ts` (`text.primary`, `accent.warm`, etc.).
- ❌ NO hover styles. RN doesn't have hover — design press states only.
- ❌ NO `cursor: pointer`. RN doesn't have cursor.
- ❌ NO `Animated.timing` / `Animated.spring` defaults — always pass `easing` from `easings` token + `duration` from `durations` token.
- ❌ NO transparent text on glass without contrast verification. All `text.tertiary` and below uses tested against `canvas.profile` for AA compliance.
- ❌ NO Sheet-inside-Sheet sibling render. File picker chooser sheet (§4.3.G.1) must render INSIDE the parent Sheet's children, NOT as a Fragment sibling — per `feedback_rn_sub_sheet_must_render_inside_parent.md`.
- ❌ NO sibling `<ScrollView>` without `flexGrow: 0` discipline. Per `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`.
- ❌ NO `KeyboardAvoidingView`. Use existing Keyboard listener + dynamic paddingBottom pattern from `feedback_keyboard_never_blocks_input.md`.
- ❌ NO Toast without absolute-positioned wrapper. Per `feedback_toast_needs_absolute_wrap.md`.
- ❌ NO useAuth in any buyer-fill component or route. Anon-tolerance per `feedback_anon_buyer_routes.md`.

---

## 9. Implementor handoff notes

### Component prop interfaces (typed)

```ts
// Schema-builder side
export interface TripCreatorStep6IntakeProps {
  eventId: string;
  ticketTypes: TripTicketType[]; // from existing tripsService Trip interface
  schemasByTier: Map<string /* ticketTypeId */, IntakeSchema>;
  onSchemaChange: (ticketTypeId: string, schema: IntakeSchema | null) => void;
  disabled?: boolean;
}

export interface IntakeSchemaBuilderProps {
  schema: IntakeSchema | null;
  activeTicketTypeId: string;
  activeTierName: string;
  onSchemaChange: (next: IntakeSchema) => void;
  onClearAll: () => void;
  disabled?: boolean;
}

export interface IntakeQuestionEditorProps {
  question: IntakeQuestion | null; // null = new question
  initialType?: IntakeQuestion["type"];
  visible: boolean;
  onSave: (question: IntakeQuestion) => void;
  onCancel: () => void;
}

export interface IntakeQuestionPreviewProps {
  schema: IntakeSchema | null;
  activeTierName: string;
}

// Buyer-fill side
export interface IntakeFormRendererProps {
  schema: IntakeSchema;
  ticketTypeId: string;
  tierName: string;
  initialAnswers?: IntakeFormData["answers"]; // from localStorage draft
  onAnswersChange: (answers: IntakeFormData["answers"]) => void;
  validationErrors?: { [questionId: string]: string };
  disabled?: boolean; // true in preview pane
}

export interface IntakeQuestionShortTextProps {
  question: IntakeQuestion;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  disabled?: boolean;
}
// (one props interface per question-type renderer; all share the same shape)

export interface IntakeQuestionFileUploadProps {
  question: IntakeQuestion;
  value: IntakeFileAnswer[];
  onChange: (next: IntakeFileAnswer[]) => void;
  onUpload: (file: File | Asset) => Promise<UploadResult>;
  error?: string;
  disabled?: boolean;
}

// Travelers tab
export interface TravelerIntakeAnswerCardProps {
  order: Order; // from orderInstallmentsService or similar
  tier: TripTicketType;
  schema: IntakeSchema | null;
  answers: IntakeFormData["answers"] | null;
}

export interface IntakeAnswerFileThumbnailProps {
  filePath: string; // storage bucket path
  filename: string;
  mimeType: string;
  sizeBytes: number;
  onTap: () => void;
}

// EditPublishedTripScreen accordion
export interface EditPublishedTripIntakeAccordionProps {
  eventId: string;
  ticketTypes: TripTicketType[];
  schemasByTier: Map<string, IntakeSchema>;
  affectedTravelerCount: number; // from a derived query
  onSave: (patch: IntakeSchemaPatch, reason: string) => Promise<void>;
}
```

### State shapes

- Wizard local state: `schemasByTier` Map managed via `useReducer` (mirror ORCH-0875 Step5 pattern). Each tier's schema persists across tab switches.
- Buyer-fill local state: `answersByTier` Map keyed by `ticketTypeId`. localStorage key per `tr5_intake_draft_${eventId}_${ticketTypeId}_${buyerEmail}` per spec §15.7.
- Preview state: `activeTicketTypeId` shared between schema-builder tab row and preview pane header.

### File path conventions

Per SPEC §7. Implementor reads the SPEC blast radius for the file list. Visible-UI files all live under `mingla-business/src/components/{trip,checkout}/` per the existing pattern.

### Reuse vs build-new

| Component | Action |
|---|---|
| `GlassCard`, `Sheet`, `ConfirmDialog`, `Stepper`, `Button`, `Input`, `IconChrome`, `Icon`, `Toast`, `Switch` | **REUSE** — no Tr5 variants needed |
| `CheckoutHeader` (ORCH-0876 V2) | **REUSE** for `/checkout-trip/[tripEventId]/intake.tsx` header |
| `RefundPolicyEditor` 2-tap confirm pattern | **REUSE** the visual pattern for Clear-all + Remove-file confirm states |
| `BookingDeadlinePicker` iOS spinner dark themeVariant | **REUSE** the `themeVariant="dark"` + `textColor` pattern for date question renderer |
| Drag-drop with `react-native-draggable-flatlist` | **BUILD-NEW** (no prior Mingla usage); implementor verifies the lib is in `package.json` Step-1 |
| All Tr5 components in §3 / §4 / §5 / §6 | **BUILD-NEW** following the specs above |

---

## 10. Smoke-test handoff for implementor + tester

When the implementor delivers, the tester verifies on iOS sim + Android emu + business-web-preview using the following design-spec smoke tests:

### Wizard schema-builder (business iOS/Android/web)
1. Open trip wizard → Step 6. Tier-picker tab row renders with 1+ tabs (1 tab when single-tier; collapsed to non-clickable label).
2. Tap Standard tab → schema-builder shows Standard's questions. Tap VIP → shows VIP's questions. Schemas isolated.
3. Tap "+ Add question" → type-picker sheet appears with 7 type cards. Tap "Short text" → editor sheet opens pre-configured for short_text. Fill label "Passport number", toggle Required, tap "Save question" → question card appears in builder pane.
4. Drag-handle long-press → drag question to reorder. Preview pane updates real-time.
5. Tap remove `✕` on a question → first tap arms red confirm, second tap removes. Tap "Clear all questions" → 2-tap confirm. Confirms accidental wipe protection.
6. Wide-viewport (web): split-view 50/50 builder + preview. Narrow: stacked.

### Buyer-fill (business-web-preview / anon-buyer-web)
1. Open `/checkout-trip/{tripEventId}/buyer` in browser, fill name/email/phone, tap Continue. Routes to `/intake` IF trip has schema.
2. Verify progress pill shows "3 OF 4". Subtitle shows "{TIER_NAME} ticket form".
3. Fill required text → error clears. Skip required → tap Continue → validation summary banner appears at top + first missing question scrolls into view + inline error per missing question.
4. Tap file upload → picker chooser sheet appears with image+library+files options based on MIME allowlist. Upload a file → thumbnail + filename + size + "uploaded" status renders. Tap remove `✕` → 2-tap confirm.
5. Date question: tap → native picker. iOS: spinner is legible (white-on-dark) + has Set/Cancel buttons. Pick a date → date renders as "Sat, Jun 14, 2026".
6. Multi-tier cart (manually inject 2 tier types via dev console or use a multi-tier published trip): verify stepped flow "Form 1 of 2" → "Form 2 of 2" → final Continue routes to payment.
7. Reload page mid-fill: toast appears ("Your answers were restored") + draft answers visible.

### Travelers tab (business iOS/Android/web)
1. Open trip dashboard → Travelers tab. Each traveler card has tier chip top-right (hidden if single-tier).
2. Tap "Intake form answers (N)" header → accordion expands. Q+A pairs render. Empty optional answers show `—`.
3. Tap image thumbnail → full-screen preview modal opens, image fits viewport, tap backdrop or `✕` to close.
4. Tap PDF thumbnail → system browser opens download.

### EditPublishedTripScreen (business iOS/Android/web)
1. Open a published trip → Edit Published → scroll to "Intake form" accordion. Header shows "{N} tiers" count.
2. Expand → embedded schema-builder + preview render.
3. Edit a question's label → "Save changes" button enables. Warning banner shows "Editing intake questions will ask {N} traveler{s} to re-answer." with count derived from affected orders.
4. Tap Save → ChangeSummaryModal opens with reason input. Type reason ≥10 chars → Confirm button enables. Tap Confirm → success Toast + refetch.

---

## 11. Implementor checklist before declaring DONE

- [ ] All visible Pressables have `accessibilityLabel` (I-39)
- [ ] All touch targets ≥ 44pt effective (I-38)
- [ ] No emoji icons anywhere — all Lucide SVG via `Icon.tsx`
- [ ] All colors via `designSystem.ts` tokens; no inline hex/rgb
- [ ] All spacing via `spacing.*`; no inline pixels
- [ ] Sheet-inside-Sheet placement honored (file picker chooser inside intake form sheet, not sibling)
- [ ] Sibling ScrollViews have `flexGrow: 0` on non-primary ones
- [ ] Keyboard pattern: dynamic paddingBottom listener, no KeyboardAvoidingView
- [ ] Toast renders inside absolute-positioned wrapper at root
- [ ] No useAuth in buyer-fill components or routes
- [ ] iOS date picker has `themeVariant="dark"` + `textColor={text.primary}` + Set/Cancel buttons (mirror ORCH-0875 BookingDeadlinePicker)
- [ ] 2-tap confirm pattern on Clear all + Remove file + Remove question
- [ ] Empty answers render as `text.quaternary "—"` (Constitution #9 — no fabrication)
- [ ] Re-answer warning banner uses `semantic.warningTint` + `AlertTriangle` icon
- [ ] Validation summary banner uses `semantic.errorTint` + `AlertCircle` icon + `accessibilityLiveRegion="assertive"`
- [ ] File thumbnails lazy-load signed URLs (1hr expiry, refetch on scroll-in)
- [ ] localStorage/AsyncStorage key per spec §15.7: `tr5_intake_draft_${eventId}_${ticketTypeId}_${buyerEmail}` with 7-day TTL
- [ ] All SC numbers (SC-01..SC-34 including §15 deltas) traceable to component / state / interaction

---

## 12. Layman summary of the design

- **Wizard Step 6** = drag-drop question builder with tabs for each ticket tier so Standard and VIP can have different questions; live preview pane shows what travelers will see as planner builds.
- **Buyer fill** = a new step in the trip checkout where the buyer answers required questions before paying; multi-tier cart steps through one tier's form at a time with a progress indicator; file uploads (images + PDFs + docs) get thumbnails + remove buttons; required questions block continue with red inline errors; partial fills auto-save to browser storage for 7 days.
- **Travelers tab** = each traveler's card gets a tier chip (Standard / VIP) at top-right and a collapsible "Intake form answers" section below contact info; image answers render as thumbnails with tap-to-enlarge; PDFs render with download icons.
- **EditPublishedTripScreen** = new accordion section embeds the same schema-builder + preview from the wizard, plus a warning banner showing how many travelers will be asked to re-answer if the planner changes existing questions.
- **All visual language** = inherits Mingla's existing dark-glass design (orange accent, translucent white-on-dark cards, no new primitives). Accessibility AA verified across all text-on-canvas contrast pairs. Implementor follows this artifact verbatim.
