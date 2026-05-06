# SPEC — BIZ Cycle 17c (WCAG AA accessibility remediation — kit-wide)

**Cycle:** 17c (BIZ — Refinement Pass mini-cycle 3)
**Status:** AWAITING IMPL
**Generated:** 2026-05-05
**Forensics anchor:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md`
**Dispatch anchor:** `Mingla_Artifacts/prompts/SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md`
**Estimated IMPL effort:** ~7.5 hrs (single-sweep per D-17c-2 Option A)
**Codebase:** `mingla-business/`

---

## 1. Layman summary

Cycle 17c brings mingla-business to WCAG AA on the three pillars App/Play Store reviewers actually flag — touch-target size, screen-reader labels, and reduce-motion respect — without changing the visual design at all.

**What ships:**
1. `IconChrome` primitive bakes a default `hitSlop` of 4 on each side. All 58 icon buttons across 28 screens become 44×44-touchable while staying 36×36 visually.
2. `IconChrome` `accessibilityLabel` becomes a REQUIRED prop. TypeScript fails the build if any consumer forgets a label. The `?? icon` fallback is removed.
3. ~10 explicit screen-reader labels added: 3 scrim Pressables (Modal/Sheet/TopSheet) + ~6-8 P2 gaps in event creator, payments, brand views.
4. Two new CI gates (I-38 touch-target + I-39 label coverage) plug into the 17b hardening-registry scaffold. First re-use of that pattern.
5. Page-level scanner pulse animation gets a reduce-motion guard.
6. I-38 + I-39 invariants registered (DRAFT → ACTIVE on CLOSE).

**What stays the same:** visual size, colors, fonts, spacing, behavior. Reduce-motion (already 100% kit-wide).

**Out of scope:** color contrast, web focus-order, Dynamic Type, voice control, Pill.tsx (non-interactive — D-17c-8 is a NO-OP), EventCover.tsx (zero animations — D-17c-9 partial NO-OP).

---

## 2. Scope

**IN SCOPE — 11 sections (§A through §K) corresponding to the operator-locked decisions:**

- §A — IconChrome primitive change (`hitSlop` default + required label) — D-17c-1 + D-17c-3b
- §B — IconChrome consumer migration (explicit labels, enumerated per-file) — D-17c-3b execution
- §C — Scrim Pressable label + role (Modal/Sheet/TopSheet) — D-17c-3a
- §D — Other label gaps (verify + close ~6-8 P2 candidates) — D-17c-3b residual
- §E — Pill.tsx touch-target spot-check — D-17c-8 (resolved NO-OP per spec authoring; documentation only)
- §F — Page-level motion compliance (scanner.tsx + EventCover.tsx) — D-17c-9 (partial NO-OP for EventCover)
- §G — I-38 CI gate (icon-chrome touch-target AST script) — D-17c-5 component 1
- §H — I-39 CI gate (Pressable accessibilityLabel AST script) — D-17c-5 component 2
- §I — `.github/scripts/strict-grep/README.md` registry update
- §J — INVARIANT_REGISTRY.md I-38 + I-39 entries (DRAFT)
- §K — Pre-write feedback memory file

**Non-goals (explicitly out of scope):**
- Color contrast (WCAG SC 1.4.3) — separate later pass
- Web focus-order / keyboard navigation (D-17c-7 Option A) — deferred
- Dynamic Type / iOS text scaling — deferred
- Voice Control / Switch Control — depth-3 a11y, deferred
- I-40 motion gate (D-17c-4 Option A) — deferred
- mingla-admin / app-mobile a11y — separate codebases
- Performance / bundle-size — that's 17d

**Assumptions:**
- `@babel/parser` + `@babel/traverse` already transitively present in `mingla-business/node_modules` (verified during 17b — same `npm install --no-save` pattern works)
- IconChrome's existing `Pressable` rendering path at `IconChrome.tsx:158-169` is the only path that needs `hitSlop` (the `if (!interactive)` branch at line 150-156 uses `<View>` and is non-touch — no change needed there)
- 17b's `i37-topbar-cluster.mjs` AST pattern is mirror-able directly; 245-line script structure copies cleanly

---

## 3. Per-layer specifications

### §A — IconChrome primitive change (the highest-leverage single edit)

**File:** `mingla-business/src/components/ui/IconChrome.tsx`

**§A.1 — Default `hitSlop` baked into primitive Pressable (D-17c-1 Option C)**

Add a primitive-level default `hitSlop` so every IconChrome consumer becomes WCAG AA touchable without per-consumer remediation. Consumer-supplied `hitSlop=` overrides default.

**Change 1 — IconChromeProps interface (line 51 area):**
```ts
// BEFORE (line 51):
accessibilityLabel?: string;

// AFTER:
accessibilityLabel: string;  // required per I-39 (Cycle 17c)
hitSlop?: PressableProps["hitSlop"];  // optional override; primitive defaults to {top:4,bottom:4,left:4,right:4}
```

Add `import type { PressableProps } from "react-native";` if not already present (may already be transitively imported via `Pressable`).

**Change 2 — Component signature destructure (line 61-71 area):**
```ts
// BEFORE:
export const IconChrome: React.FC<IconChromeProps> = ({
  icon,
  badge,
  active = false,
  onPress,
  size = DEFAULT_SIZE,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
}) => {

// AFTER:
const DEFAULT_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;

export const IconChrome: React.FC<IconChromeProps> = ({
  icon,
  badge,
  active = false,
  onPress,
  size = DEFAULT_SIZE,
  disabled = false,
  accessibilityLabel,
  hitSlop = DEFAULT_HIT_SLOP,
  testID,
  style,
}) => {
```

**Change 3 — Pressable JSX (line 158-171):**
```tsx
// BEFORE:
<Pressable
  onPress={handlePress}
  onPressIn={handlePressIn}
  onPressOut={handlePressOut}
  disabled={disabled}
  accessibilityRole="button"
  accessibilityState={{ disabled }}
  accessibilityLabel={accessibilityLabel ?? icon}  // line 166 — fallback REMOVED
  testID={testID}
  style={style}
>

// AFTER:
<Pressable
  onPress={handlePress}
  onPressIn={handlePressIn}
  onPressOut={handlePressOut}
  disabled={disabled}
  hitSlop={hitSlop}
  accessibilityRole="button"
  accessibilityState={{ disabled }}
  accessibilityLabel={accessibilityLabel}  // explicit only — TS-enforced
  testID={testID}
  style={style}
>
```

**§A.2 — Visual size unchanged**

`DEFAULT_SIZE = 36` at line 56 stays exactly 36. Only the touchable frame expands via `hitSlop`. No icon, badge, or container dimension changes.

**§A.3 — Verification calc**

Effective per-side touchable extent = `size + hitSlop_side` = `36 + 4 = 40` per side, total touchable diameter = `36 + 4×2 = 44`. Meets WCAG AA + Apple HIG (44pt) minimum. Material Design's 48dp recommendation is not met — operator decision per D-17c-1 Option C accepted that AA-floor (not Material-comfort) is the target.

**§A.4 — Non-interactive branch unchanged**

`IconChrome.tsx:150-156` (`if (!interactive)` branch) renders a `<View>` not `<Pressable>` — no touch event surface, so no `hitSlop` needed. Leave verbatim.

---

### §B — IconChrome consumer migration (explicit-label propagation)

After §A removes the `?? icon` fallback, every IconChrome consumer that did not pass an explicit `accessibilityLabel=` will fail tsc. The implementor MUST add explicit labels using the canonical mapping:

**§B.1 — Canonical label mapping table**

| Icon name | Approved label string |
|---|---|
| `chevL` | `"Back"` |
| `chevR` | `"Forward"` |
| `chevU` | `"Collapse"` |
| `chevD` | `"Expand"` |
| `search` | `"Search"` |
| `bell` | `"Notifications"` |
| `plus` | context-specific (see §B.3) |
| `close` / `x` | `"Close"` (modal/sheet) or `"Dismiss"` (banner) — context-specific |
| `settings` | `"Settings"` |
| `download` | `"Download"` |
| `share` | `"Share"` |
| `qr` | `"Open QR scanner"` |
| `edit` / `pencil` | `"Edit"` |
| `trash` / `delete` | `"Delete"` |
| `check` | context-specific (e.g., `"Confirm"`, `"Mark as paid"`) |
| `refresh` / `arrow-cw` | `"Refresh"` |
| `flash` / `bolt` | `"Toggle flash"` (scanner) |
| `cameraSwap` / `camera-rotate` | `"Switch camera"` (scanner) |

Implementor MUST extend this table when encountering icons not listed and document the additions in IMPL report under "Label additions."

**§B.2 — Consumer enumeration (28 files; line numbers from forensics §A.2 grep + spec-time spot-checks)**

Files where IconChrome consumer requires explicit `accessibilityLabel=` (where missing):

| # | File | IconChrome line(s) | Likely icon | Suggested label |
|---|---|---|---|---|
| 1 | `app/account/notifications.tsx` | 112-117 | `close` | `"Back"` (already has it per spec-time read line 116) — verify only |
| 2 | `app/account/delete.tsx` | 210 | `chevL`/`close` | `"Back"` (verify) |
| 3 | `app/account/edit-profile.tsx` | 400 | TBD | TBD |
| 4 | `app/__styleguide.tsx` | 468-472 | search/bell/settings | dev fixtures — labels REQUIRED but allowlist acceptable per `// orch-strict-grep-allow icon-chrome-touch-target — styleguide demo` if dev-only |
| 5 | `app/(tabs)/events.tsx` | 395 | `plus` | `"Build a new event"` (already set per 17b §B.1) — verify |
| 6 | `app/event/[id]/scanners/index.tsx` | 203, 232, 241 | TBD | TBD per icon |
| 7 | `app/event/[id]/scanner/index.tsx` | 403, 428, 449, 495 | scanner controls (close, flash, cameraSwap) | per §B.1 |
| 8 | `app/event/[id]/reconciliation.tsx` | 286, 294, 370 | TBD | TBD |
| 9 | `app/event/[id]/orders/[oid]/index.tsx` | 270, 316 | TBD | TBD |
| 10 | `app/event/[id]/guests/[guestId].tsx` | 388, 466 | TBD | TBD |
| 11 | `app/event/[id]/guests/index.tsx` | 358, 389, 397, 403, 409 | TBD (5 icons) | TBD |
| 12 | `app/event/[id]/orders/index.tsx` | 138, 167, 175 | TBD | TBD |
| 13 | `app/event/[id]/index.tsx` | 627, 633 | Share + Manage | `"Share event"` + `"Manage event"` |
| 14 | `app/event/[id]/door/[saleId].tsx` | 180, 221 | TBD | TBD |
| 15 | `app/event/[id]/door/index.tsx` | 304, 335, 343, 349 | TBD | TBD |
| 16 | `mingla-business/src/components/brand/PublicBrandPage.tsx` | 255, 264 | TBD | TBD |
| 17 | `mingla-business/src/components/checkout/CheckoutHeader.tsx` | 46 | `chevL` | `"Back"` |
| 18 | `mingla-business/src/components/event/EditPublishedScreen.tsx` | 626 | TBD | TBD |
| 19 | `mingla-business/src/components/event/EventCreatorWizard.tsx` | 495 | TBD | TBD |
| 20 | `mingla-business/src/components/event/PreviewEventView.tsx` | 222, 228 | TBD | TBD |
| 21 | `mingla-business/src/components/event/PublicEventPage.tsx` | 345, 354 | TBD | TBD |
| 22 | `mingla-business/src/components/ui/TopBar.tsx` | 123, 124, 192 | search, bell, chevL | `"Search"` + `"Notifications"` + `"Back"` (already set per 17b — verify) |

Implementor MUST run `cd mingla-business && npx tsc --noEmit` after §A primitive change. tsc errors will list every consumer requiring an explicit label. Resolve each per §B.1 mapping. tsc-clean is the binding completion signal.

**§B.3 — `plus` context disambiguation**

`plus` icon labels by context:
- `app/(tabs)/events.tsx:395` → `"Build a new event"` (already set)
- `app/brand/[id]/team.tsx` (if applicable) → `"Invite team member"`
- `mingla-business/src/components/event/CreatorStep5Tickets.tsx` (if applicable) → `"Add ticket tier"`
- Implementor proposes per-file based on surrounding handler/screen context

**§B.4 — Implicit-label preservation**

If an existing consumer already passes explicit `accessibilityLabel="..."`, leave verbatim. Spec is additive, not rewriting good code.

---

### §C — Scrim Pressable label + role (D-17c-3a Option A)

3 files, exact lines verified:

**§C.1 — `mingla-business/src/components/ui/Modal.tsx` line 187**
```tsx
// BEFORE:
<Pressable style={styles.scrimPress} onPress={handleScrimPress} />

// AFTER:
<Pressable
  style={styles.scrimPress}
  onPress={handleScrimPress}
  accessibilityLabel="Dismiss modal"
  accessibilityRole="button"
/>
```

**§C.2 — `mingla-business/src/components/ui/Sheet.tsx` line 260**
Same pattern; label = `"Dismiss sheet"`.

**§C.3 — `mingla-business/src/components/ui/TopSheet.tsx` line 275**
Same pattern; label = `"Dismiss sheet"`.

No other behavior change in any of the three files.

---

### §D — Other label gaps (D-17c-3b residual closure)

Forensics §B.3 listed P2 candidates from sub-agent analysis. Implementor MUST verify each by direct file read and either close or document as false positive:

**§D.1 — Verification + remediation list**

| # | File | Approx line | Element (per forensics) | Action |
|---|---|---|---|---|
| 1 | `app/checkout/[eventId]/payment.tsx` | ~340, ~353 | Test payment-method checkboxes | Read; if missing `accessibilityLabel=` and no labeled inner Text, add explicit (e.g., `"Cash"`, `"Card reader"`, etc. per `paymentMethodLabels.ts`) |
| 2 | `mingla-business/src/components/checkout/PaymentElementStub.tsx` | TBD | 1 element | Read all Pressables; verify each is labeled |
| 3 | `mingla-business/src/components/brand/BrandEditView.tsx` | ~369 (per hitSlop grep) | hitSlop Pressable | Read; verify label |
| 4 | `mingla-business/src/components/brand/PublicBrandPage.tsx` | TBD | 1 element | Read all Pressables |
| 5 | `mingla-business/src/components/event/PreviewEventView.tsx` | ~77, ~207, ~292 (hitSlop sites) | toolbar elements | Read; verify each |
| 6 | `mingla-business/src/components/event/MultiDateOverrideSheet.tsx` | ~646 | hitSlop Pressable | Read; verify label |
| 7 | `mingla-business/src/components/brand/BrandProfileView.tsx` | TBD | 1 element | Read all Pressables |
| 8 | `mingla-business/src/components/event/CreatorStep2When.tsx` | 1231 | Preset selector (verified) | Add explicit `accessibilityLabel={opt.label}` for cross-platform safety |

**§D.2 — Verification protocol per file**
1. Read file at cited line
2. If Pressable has no `accessibilityLabel=` AND no labeled inner `<Text>` literal → add explicit label
3. If Pressable IS labeled (sub-agent false positive) → document in IMPL report under "Discoveries"; no code change
4. If Pressable is decorative (no `onPress=`) → add `accessibilityElementsHidden={true}` + `importantForAccessibility="no"`
5. Document every label string added in IMPL report — orchestrator REVIEWs at gate

**§D.3 — Label copy authority**
Implementor proposes per-element. Use action-verb format (`"Save changes"`, `"Open guest list"`) not noun-only (`"Guests"`). Operator may override at REVIEW gate.

---

### §E — Pill.tsx touch-target spot-check (D-17c-8) — RESOLVED NO-OP

**Spec-time finding (recorded in spec body so implementor doesn't re-derive):**

`mingla-business/src/components/ui/Pill.tsx` is **NOT interactive**. The component renders a `<View>` (line 138-168), not a `<Pressable>` or `<TouchableOpacity>`. It has no `onPress` prop. It is purely a visual status badge.

**Action:** No code change. Implementor records this verification in IMPL report under "Discoveries" / "§E spot-check confirmed NO-OP". The forensics §A.4 hidden-flaw F-A3 is hereby downgraded from 🟡 hidden flaw to 🔵 observation.

---

### §F — Page-level motion compliance (D-17c-9)

**§F.1 — `mingla-business/src/components/ui/EventCover.tsx` — RESOLVED NO-OP**

Spec-time grep verified: zero `Animated`, `withTiming`, `withSpring`, `useAnimatedStyle`, `LayoutAnimation`, or `useReducedMotion` references. Component is pure SVG-rendered stripe pattern (parallel `<Rect>` elements, no animation).

**Action:** No code change. Document in IMPL report.

**§F.2 — `mingla-business/app/event/[id]/scanner/index.tsx` — REQUIRES FIX**

Spec-time grep confirmed (line numbers verified):
- Line 25 — `Animated` import from `react-native`
- Line 160 — `const overlayAnim = useRef(new Animated.Value(0)).current;`
- Line 207 + 228 — `Animated.timing(overlayAnim, {...}).start()`
- Lines 538, 582 — `<Animated.View>` consumer

This is RN's old Animated API — Reanimated's `useReducedMotion()` does NOT apply. Use `AccessibilityInfo` import directly.

**§F.2.1 — Spec change**

Wire `AccessibilityInfo.isReduceMotionEnabled()` check before each `Animated.timing` call. When reduce-motion is enabled, set `overlayAnim.setValue(targetValue)` directly (instant set) instead of timing-animated.

**Pattern (canonical — implementor adapts to exact branching):**
```tsx
// BEFORE (line 207 area):
Animated.timing(overlayAnim, {
  toValue: 1,
  duration: 400,
  useNativeDriver: true,
}).start();

// AFTER:
const animateOverlay = async (target: number, duration: number): Promise<void> => {
  const reduced = await AccessibilityInfo.isReduceMotionEnabled();
  if (reduced) {
    overlayAnim.setValue(target);
    return;
  }
  Animated.timing(overlayAnim, {
    toValue: target,
    duration,
    useNativeDriver: true,
  }).start();
};
animateOverlay(1, 400);
```

Implementor decides whether to wrap inline at each site (2 sites: lines 207, 228) or extract a shared helper. Helper preferred for DRY; inline acceptable if sites diverge in target/duration.

**§F.2.2 — Add `AccessibilityInfo` import**

Add `AccessibilityInfo` to the existing `react-native` named imports at the top of `app/event/[id]/scanner/index.tsx`.

**§F.2.3 — Optional: also subscribe to reduce-motion changes**

If the screen is long-lived and the user could toggle reduce-motion mid-session (uncommon but possible on iOS), use `AccessibilityInfo.addEventListener('reduceMotionChanged', handler)` to re-evaluate. Implementor decision; documented either way in IMPL report.

---

### §G — I-38 CI gate (`i38-icon-chrome-touch-target.mjs`)

**File:** `.github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` (NEW)

**Mirror pattern:** copy `i37-topbar-cluster.mjs` structure verbatim. Replace gate-specific logic.

**§G.1 — Header comment (verbatim shape, replace I-37 fields with I-38)**

```js
#!/usr/bin/env node
/**
 * I-38 strict-grep gate — IconChrome touch-target ≥ 44 effective area.
 *
 * Gate logic:
 *   For every <IconChrome> JSX element in mingla-business/app/ + mingla-business/src/:
 *     Compute effective per-side touch extent = size_or_default + hitSlop_side
 *     If any side < 44 → VIOLATION (exit 1)
 *     Unless line immediately above has:
 *       // orch-strict-grep-allow icon-chrome-touch-target — <reason>
 *
 * Per DEC-103 D-17c-1 Option C (Cycle 17c) — registry pattern. See
 * .github/scripts/strict-grep/README.md for "How to add a new gate".
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error (parse failure across all files, file system error)
 *
 * Established by: Cycle 17c SPEC §G + INVARIANT_REGISTRY I-38.
 */
```

**§G.2 — Constants**

```js
const DEFAULT_ICON_CHROME_SIZE = 36;
const DEFAULT_HIT_SLOP_PER_SIDE = 4;  // matches IconChrome primitive default per Cycle 17c §A.1
const WCAG_AA_TOUCH_TARGET = 44;
const ALLOWLIST_TAG = "orch-strict-grep-allow icon-chrome-touch-target";
```

**§G.3 — Effective-area calculation**

```js
function computeEffectiveSides(sizeAttr, hitSlopAttr) {
  // sizeAttr: { present, value (number|null), dynamic } from getNumericAttr
  // hitSlopAttr: parsed object {top, bottom, left, right} or null

  const size = sizeAttr.dynamic
    ? null  // dynamic — cannot statically verify
    : sizeAttr.value ?? DEFAULT_ICON_CHROME_SIZE;

  if (size === null) return null;  // dynamic; warn but don't fail

  // Default hitSlop matches the primitive's baked-in default
  const slop = hitSlopAttr ?? {
    top: DEFAULT_HIT_SLOP_PER_SIDE,
    bottom: DEFAULT_HIT_SLOP_PER_SIDE,
    left: DEFAULT_HIT_SLOP_PER_SIDE,
    right: DEFAULT_HIT_SLOP_PER_SIDE,
  };

  return {
    top: size + (slop.top ?? 0),
    bottom: size + (slop.bottom ?? 0),
    left: size + (slop.left ?? 0),
    right: size + (slop.right ?? 0),
  };
}
```

**§G.4 — `hitSlop=` attribute parsing**

`hitSlop` can be:
- Object literal: `hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}`
- Scalar number: `hitSlop={6}` (RN treats as uniform)
- Dynamic expression: `hitSlop={someVariable}` (cannot statically verify — warn, do not violate)

Implementor walks the JSXAttribute's `expression` ObjectExpression properties OR NumericLiteral. If dynamic, return null (warn).

**§G.5 — Violation report**

Mirror `reportViolation` from i37 with content:
```
ERROR: I-38 violation in <file>:<line>
  <IconChrome size={N} hitSlop={...} ...> — effective <X>×<Y> below WCAG AA 44pt minimum
    Set size>=44 OR hitSlop with effective area >= 44 per side.
    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-38
    Allowlist: add // orch-strict-grep-allow icon-chrome-touch-target — <reason>
               immediately above the JSX block if intentional.
```

**§G.6 — Surfaces scanned**

`mingla-business/app/` + `mingla-business/src/`. Skip `node_modules`, `.git`, `.expo`, `dist`. Mirror `walkTsx` from i37.

**§G.7 — Workflow YAML extension**

Append job to `.github/workflows/strict-grep-mingla-business.yml`:

```yaml
  i38-icon-chrome-touch-target:
    name: I-38 IconChrome touch-target ≥ 44 effective
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install Babel parser/traverse
        working-directory: mingla-business
        run: npm install --no-save @babel/parser @babel/traverse
      - name: Run I-38 AST gate
        run: node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs
```

Same trigger filters + path filter as the existing `i37-topbar-default-cluster` job. Path filter MAY be widened to include `mingla-business/app/**/*.tsx` + `mingla-business/src/**/*.tsx` (already covered by 17b filter — verify).

---

### §H — I-39 CI gate (`i39-pressable-label.mjs`)

**File:** `.github/scripts/strict-grep/i39-pressable-label.mjs` (NEW)

**Mirror pattern:** same as §G + i37 pattern.

**§H.1 — Header comment**
```js
#!/usr/bin/env node
/**
 * I-39 strict-grep gate — Interactive Pressable accessibilityLabel coverage.
 *
 * Gate logic:
 *   For every <Pressable> or <TouchableOpacity> JSX element in
 *   mingla-business/app/ + mingla-business/src/:
 *     If onPress= is set (interactive) AND accessibilityLabel= is missing
 *     AND the only direct child is NOT a literal <Text>{string-literal}</Text>
 *     → VIOLATION (exit 1)
 *     Unless line immediately above has:
 *       // orch-strict-grep-allow pressable-no-label — <reason>
 *
 * Per DEC-103 D-17c-3b (Cycle 17c) — registry pattern.
 * Exit codes: 0 clean / 1 violation / 2 script error.
 */
```

**§H.2 — Element-name match**

```js
const TARGET_NAMES = new Set(["Pressable", "TouchableOpacity"]);
// In traverse JSXOpeningElement:
if (!TARGET_NAMES.has(node.name?.name)) return;
```

**§H.3 — Interactive check**

```js
const hasOnPress = hasAttr(node, "onPress");
if (!hasOnPress) return;  // not interactive — skip
```

**§H.4 — Label check**

```js
const hasLabel = hasAttr(node, "accessibilityLabel");
if (hasLabel) return;  // labeled — pass
```

**§H.5 — Implicit-Text-child check (heuristic — pass-through)**

Inspect the JSXElement's parent (the JSXElement, not the OpeningElement) `children`. If the only non-whitespace child is a `<Text>` whose only child is a `StringLiteral` or template literal → log as P2 implicit but do NOT violate.

```js
// Pseudocode — implementor adapts to exact AST traversal:
function hasImplicitTextLabel(jsxElement) {
  const realChildren = jsxElement.children.filter(c =>
    c.type !== "JSXText" || c.value.trim().length > 0
  );
  if (realChildren.length !== 1) return false;
  const child = realChildren[0];
  if (child.type !== "JSXElement") return false;
  if (child.openingElement.name?.name !== "Text") return false;
  const textChildren = child.children.filter(c =>
    c.type !== "JSXText" || c.value.trim().length > 0
  );
  if (textChildren.length !== 1) return false;
  return textChildren[0].type === "JSXText" || textChildren[0].type === "StringLiteral";
}
```

If `hasImplicitTextLabel(jsxElement) === true` → pass (P2 implicit) but emit `INFO` log so future audit can revisit.

**§H.6 — Violation report**

```
ERROR: I-39 violation in <file>:<line>
  <Pressable onPress={...}> with no accessibilityLabel and no inner <Text> literal
    Add accessibilityLabel="..." OR allowlist with reason.
    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-39
    Allowlist: add // orch-strict-grep-allow pressable-no-label — <reason>
```

**§H.7 — Workflow YAML job**

Mirror §G.7 pattern with `i39-pressable-label` job name + script path.

---

### §I — README registry update

**File:** `.github/scripts/strict-grep/README.md`

Append to the "Active gates" table (after existing I-37 row):
```
| I-38 | IconChrome touch-target ≥ 44 effective | i38-icon-chrome-touch-target.mjs | Cycle 17c |
| I-39 | Pressable accessibilityLabel coverage | i39-pressable-label.mjs | Cycle 17c |
```

If the README has a "Future / proposed gates" section listing I-38/I-39 as proposals, MOVE them to Active and remove from Future. (Verify; if not present, ignore.)

---

### §J — Invariant registry entries (DRAFT pre-write)

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`

Append AFTER existing I-37 entry (current latest, ends ~line 1709). Mirror I-37 template exactly.

**§J.1 — I-38 entry**

```markdown
### I-38 ICONCHROME-TOUCH-TARGET-AA-COMPLIANT — Every `<IconChrome>` consumer MUST have effective touch-area ≥ 44pt per side (mingla-business — Cycle 17c — DRAFT — flips to ACTIVE on Cycle 17c CLOSE)

**Statement:** Every `mingla-business` `<IconChrome>` JSX consumer (in `mingla-business/app/` + `mingla-business/src/`) MUST resolve to an effective touchable extent of ≥ 44pt per side. The primitive's baked-in default `hitSlop={{top:4,bottom:4,left:4,right:4}}` (Cycle 17c §A.1) plus `DEFAULT_SIZE = 36` yields effective 44 per side, satisfying WCAG AA / Apple HIG. Consumers MAY override `size=` and/or `hitSlop=`; combined effective extent must remain ≥ 44 OR carry an allowlist comment.

**Scope:** `mingla-business` only. `app-mobile/` + `mingla-admin/` accessibility audits are separate cycles.

**Why this exists:** Pre-17c, every IconChrome consumer rendered a 36×36 touch surface (kit-wide), below WCAG AA. Forensics report `INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md` §A documented 58 occurrences across 28 files. Motor-impaired or older users mis-tap small icons; App/Play Store reviewers flag this in automated scans. Cycle 17c bakes default `hitSlop` into the primitive (visual size unchanged) and codifies the rule with this invariant.

**CI enforcement:** `.github/workflows/strict-grep-mingla-business.yml` job `i38-icon-chrome-touch-target` running `.github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` (Babel AST traversal). Fails CI on PR if any `<IconChrome>` consumer's effective per-side touch extent < 44pt without an allowlist comment.

**Established by:** Cycle 17c SPEC §A + §G; D-CYCLE17A-IMPL-5 + D-CYCLE17B-QA-5 forensics anchors; DEC-103 lock entry [DEC ID confirmed at CLOSE — may bump to DEC-104 if ORCH-0733 closes first].

**EXIT condition:** None — permanent invariant. If the design system ever pivots away from `IconChrome` as the canonical glass icon button, supersede via NEW invariant; do not silently relax.

**Cross-reference:** Forensics report `INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md`; SPEC `SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md` §A; `.github/scripts/strict-grep/README.md` registry pattern.

**Test that catches a regression:** CI grep gate above. Synthetic violation fixture: `<IconChrome icon="search" size={36} accessibilityLabel="Search" />` with NO `hitSlop=` consumer override AND primitive default flipped (e.g., test mode where default is overridden) → exit 1. Allowlist fixture: same JSX with `// orch-strict-grep-allow icon-chrome-touch-target — <reason>` comment immediately above → exit 0.
```

**§J.2 — I-39 entry**

```markdown
### I-39 INTERACTIVE-PRESSABLE-ACCESSIBILITY-LABEL — Every interactive `<Pressable>` / `<TouchableOpacity>` MUST have explicit `accessibilityLabel=` (mingla-business — Cycle 17c — DRAFT — flips to ACTIVE on Cycle 17c CLOSE)

**Statement:** Every `<Pressable>` or `<TouchableOpacity>` JSX element in `mingla-business/app/` + `mingla-business/src/` that has an `onPress=` attribute (i.e., is interactive) MUST set an explicit `accessibilityLabel=` attribute on the same element OR carry an allowlist comment. An inner `<Text>{string-literal}</Text>` child is permitted as P2 implicit-label fallback (logged as INFO by the gate) but explicit labels are preferred for cross-platform consistency.

**Scope:** `mingla-business` only. Internal UI primitives in `mingla-business/src/components/ui/` may use allowlist comments more liberally — they expose label props to consumers; the consumers are gate-enforced.

**Why this exists:** Pre-17c, ~88 raw missing-label occurrences existed per master inventory (count later refined to ~8-10 actual gaps post-17a/17b primitive auto-pass-through). Screen-reader users (VoiceOver, TalkBack) need explicit labels to navigate confidently; implicit-Text fallback is platform-version-dependent. Cycle 17c removes the IconChrome `?? icon` silent fallback (Cycle 17c §A.1), closes the ~10 explicit gaps (§B + §C + §D), and codifies the rule with this invariant.

**CI enforcement:** `.github/workflows/strict-grep-mingla-business.yml` job `i39-pressable-label` running `.github/scripts/strict-grep/i39-pressable-label.mjs` (Babel AST traversal). Fails CI on PR if any interactive `<Pressable>` / `<TouchableOpacity>` without `accessibilityLabel=` AND without inner `<Text>` literal AND without allowlist comment.

**Established by:** Cycle 17c SPEC §B + §C + §D + §H; forensics report §B; DEC-103 lock entry [DEC ID confirmed at CLOSE].

**EXIT condition:** None — permanent invariant.

**Cross-reference:** Forensics report `INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md`; SPEC `SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md` §B/§C/§D/§H; `.github/scripts/strict-grep/README.md`.

**Test that catches a regression:** CI grep gate above. Synthetic violation fixture: `<Pressable onPress={() => {}}><Icon name="x" /></Pressable>` (no inner Text, no label) → exit 1. Allowlist fixture: same JSX with `// orch-strict-grep-allow pressable-no-label — <reason>` comment immediately above → exit 0. Implicit-label pass fixture: `<Pressable onPress={() => {}}><Text>Save</Text></Pressable>` → exit 0 with INFO log.
```

---

### §K — Pre-write feedback memory file

**File:** `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_wcag_aa_kit_invariants.md`

**Status at write time:** `DRAFT — flips to ACTIVE on Cycle 17c CLOSE` (operator flips at CLOSE; orchestrator does not flip unilaterally per `feedback_post_pass_protocol`).

**Frontmatter + body (verbatim shape):**

```markdown
---
name: WCAG AA kit invariants — IconChrome touch + Pressable label
description: mingla-business kit-wide WCAG AA discipline established post-Cycle 17c — every IconChrome consumer effective touch ≥ 44pt; every interactive Pressable/TouchableOpacity has explicit accessibilityLabel.
type: feedback
status: DRAFT — flips to ACTIVE on Cycle 17c CLOSE
---

# WCAG AA kit invariants (mingla-business)

**Status:** ACTIVE post Cycle 17c CLOSE [DATE].

## What's locked

Two invariants codify mingla-business WCAG AA discipline:

- **I-38 ICONCHROME-TOUCH-TARGET-AA-COMPLIANT** — every `<IconChrome>` consumer must have effective per-side touch extent ≥ 44pt. IconChrome primitive bakes default `hitSlop={{top:4,bottom:4,left:4,right:4}}` so effective area is `36+4×2 = 44` even when consumers don't pass `hitSlop=`. Consumer overrides honored; combined effective extent must stay ≥ 44.
- **I-39 INTERACTIVE-PRESSABLE-ACCESSIBILITY-LABEL** — every interactive `<Pressable>` / `<TouchableOpacity>` (those with `onPress=`) must set explicit `accessibilityLabel=`. Inner `<Text>{literal}</Text>` is permitted as implicit fallback (P2 — gate logs INFO). The IconChrome `accessibilityLabel ?? icon` silent fallback was REMOVED in Cycle 17c §A.1 — IconChrome's `accessibilityLabel` is now a TypeScript-required prop.

## Why: How to apply

- **When implementing new screens or components in `mingla-business/`:** every new IconChrome use must set explicit `accessibilityLabel=` (TS-enforced); every new Pressable with `onPress=` must set explicit `accessibilityLabel=` (CI-enforced via I-39 gate).
- **When reading old `mingla-business/` code:** if you find a `<Pressable onPress={...} />` without `accessibilityLabel=`, that's an I-39 violation. Either add the label or escalate to operator.
- **When designing new touchable components:** if it's a new primitive, mirror the IconChrome `hitSlop` baked-default pattern. If it's a one-off consumer Pressable, set hitSlop manually OR use a sized container ≥ 44pt.
- **Allowlist usage:** rare. Reserved for legitimate cases (e.g., decorative scrim Pressables that have been intentionally hidden via `accessibilityElementsHidden`, dev-only fixtures in `__styleguide.tsx`). Always include a written reason.

## CI enforcement

- `.github/workflows/strict-grep-mingla-business.yml` jobs `i38-icon-chrome-touch-target` + `i39-pressable-label`
- Babel AST traversal — robust against formatting variations
- Allowlist comments: `// orch-strict-grep-allow icon-chrome-touch-target — <reason>` and `// orch-strict-grep-allow pressable-no-label — <reason>`
- Both gates plug into the hardening-registry pattern established Cycle 17b (`feedback_strict_grep_registry_pattern.md`)

## Why this memory exists

Cycle 17c established kit-wide WCAG AA on three pillars (touch-target + screen-reader labels + reduce-motion) without changing the visual design. Without this memory, future skill sessions may re-introduce 36px-only touch targets or unlabeled Pressables and the CI gates will block PRs without explanation. This memory is the human-facing documentation behind the CI enforcement.

## Related memories

- [Strict-grep registry pattern](feedback_strict_grep_registry_pattern.md) — registry CI scaffold I-38/I-39 plug into (Cycle 17b)
- [Implementor uses /ui-ux-pro-max](feedback_implementor_uses_ui_ux_pro_max.md) — touch-target + label work qualifies even with no visual change

## Established

- Forensics: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md`
- Spec: `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17C_WCAG_AUDIT_REPORT.md` [created at IMPL]
- QA: `Mingla_Artifacts/reports/QA_BIZ_CYCLE_17C_WCAG_AUDIT.md` [created at tester PASS]
```

**Index entry to add to `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md`:**

Add under existing **"Strict-Grep CI Gate Registry Pattern (post-Cycle-17b)"** subheading OR create a new **"Accessibility Discipline (post-Cycle-17c)"** subheading under "User Preferences (Non-Negotiable)":

```
- [WCAG AA kit invariants](feedback_wcag_aa_kit_invariants.md) — I-38 IconChrome touch ≥ 44pt + I-39 explicit accessibilityLabel on interactive Pressable. (status: ACTIVE post-Cycle-17c CLOSE [DATE])
```

(Operator flips DRAFT → ACTIVE in CLOSE protocol; orchestrator updates the index.)

---

## 4. Success criteria

| ID | Criterion | Verification |
|---|---|---|
| **SC-A1** | `IconChrome.tsx` adds default `hitSlop={{top:4,bottom:4,left:4,right:4}}` constant + props field + Pressable spread | Direct file read |
| **SC-A2** | `IconChrome.tsx` `accessibilityLabel` prop is TS-required (no `?` after name) | tsc fails on consumer that omits it |
| **SC-A3** | `IconChrome.tsx` line 166 `?? icon` fallback REMOVED | Direct file read confirms `accessibilityLabel={accessibilityLabel}` |
| **SC-A4** | `DEFAULT_SIZE = 36` unchanged at line 56; visual chrome unchanged | Direct file read |
| **SC-B1** | Every IconChrome consumer in §B.2 enumeration passes explicit `accessibilityLabel=` | tsc clean |
| **SC-B2** | Implementor's IMPL report includes "Label additions" section listing every label string added | Direct report read |
| **SC-C1** | Modal.tsx scrim Pressable has `accessibilityLabel="Dismiss modal"` + `accessibilityRole="button"` | Direct file read |
| **SC-C2** | Sheet.tsx scrim Pressable has `accessibilityLabel="Dismiss sheet"` + `accessibilityRole="button"` | Direct file read |
| **SC-C3** | TopSheet.tsx scrim Pressable has `accessibilityLabel="Dismiss sheet"` + `accessibilityRole="button"` | Direct file read |
| **SC-D1** | Each §D.1 file verified by implementor; either labeled, hidden, or documented as false positive | IMPL report enumerates verdict per file |
| **SC-D2** | CreatorStep2When.tsx:1231 has explicit `accessibilityLabel={opt.label}` | Direct file read |
| **SC-E1** | Pill.tsx unchanged; IMPL report records NO-OP verification | IMPL report |
| **SC-F1** | EventCover.tsx unchanged; IMPL report records NO-OP verification | IMPL report |
| **SC-F2** | scanner/index.tsx imports `AccessibilityInfo` from react-native + wires reduce-motion guard before each `Animated.timing` call | Direct file read |
| **SC-G1** | `.github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` exists + executes cleanly | `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` exit 0 against current code state |
| **SC-G2** | I-38 workflow YAML job added to strict-grep-mingla-business.yml | Direct file read |
| **SC-G3** | I-38 gate flags synthetic violation fixture (exit 1) + passes allowlist fixture (exit 0) | Implementor authors temp fixtures, runs gate, confirms behavior, deletes fixtures, documents in IMPL report |
| **SC-H1** | `.github/scripts/strict-grep/i39-pressable-label.mjs` exists + executes cleanly | `node .github/scripts/strict-grep/i39-pressable-label.mjs` exit 0 against current code state |
| **SC-H2** | I-39 workflow YAML job added | Direct file read |
| **SC-H3** | I-39 gate flags synthetic violation fixture + passes allowlist fixture + passes implicit-label fixture | Implementor temp fixtures (3) + verification |
| **SC-I1** | README.md Active gates table includes I-38 + I-39 rows | Direct file read |
| **SC-J1** | INVARIANT_REGISTRY.md has I-38 + I-39 entries (DRAFT status) | Direct file read |
| **SC-K1** | `feedback_wcag_aa_kit_invariants.md` exists with DRAFT status + verbatim §K body | Direct file read |
| **SC-K2** | MEMORY.md index entry added | Direct file read |
| **SC-PRE** | `cd mingla-business && npx tsc --noEmit` exits clean | tsc command exit code 0 |

---

## 5. Invariants

**Preserved (must continue to hold post-17c):**
- I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS — IconChrome changes don't touch TopBar consumer surface; verify post-IMPL the I-37 gate still passes
- All 14 constitutional rules — particularly #1 (no dead taps — labels reinforce this), #3 (no silent failures — removing the `?? icon` fallback eliminates a silent regression vector), #8 (subtract before adding — the `?? icon` removal IS subtraction)

**Established (DRAFT pre-write, flips ACTIVE on CLOSE):**
- I-38 ICONCHROME-TOUCH-TARGET-AA-COMPLIANT (per §J.1)
- I-39 INTERACTIVE-PRESSABLE-ACCESSIBILITY-LABEL (per §J.2)

---

## 6. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-A1 | IconChrome with default props | `<IconChrome icon="search" accessibilityLabel="Search" />` | Renders 36×36 visual + 44 effective touch via `hitSlop={4}` | Component |
| T-A2 | IconChrome consumer missing label | Add new `<IconChrome icon="bell" />` (no label) | tsc error: missing required prop | Build |
| T-A3 | IconChrome consumer with explicit hitSlop | `<IconChrome icon="x" size={36} hitSlop={8} accessibilityLabel="Close" />` | Effective 52 per side; AA-pass; gate passes | CI gate |
| T-B1 | Existing consumer with label | TopBar.tsx:123 `<IconChrome icon="search" size={36} accessibilityLabel="Search" />` | Unchanged; tsc clean; gate passes | Component + CI |
| T-C1 | Modal scrim Pressable | Open a modal; VoiceOver focus on dim background | VoiceOver announces "Dismiss modal, button" | Live-fire (D-17c-6) |
| T-D1 | CreatorStep2When preset | Open repeat-pattern sheet; VoiceOver focus a row | VoiceOver announces "Daily, button, selected" (or "not selected") | Live-fire |
| T-F2 | scanner reduce-motion | iOS Settings → Accessibility → Reduce Motion ON; open scanner | Overlay sets instantly (no fade); scan still works | Live-fire |
| T-G3a | I-38 violation fixture | `<IconChrome icon="search" size={36} accessibilityLabel="Search" />` with primitive default temporarily disabled | Gate exits 1 with error message | CI gate |
| T-G3b | I-38 allowlist fixture | Same JSX + `// orch-strict-grep-allow icon-chrome-touch-target — test fixture` above | Gate exits 0 | CI gate |
| T-H3a | I-39 violation fixture | `<Pressable onPress={() => {}}><Icon name="x" /></Pressable>` | Gate exits 1 | CI gate |
| T-H3b | I-39 implicit-label pass | `<Pressable onPress={() => {}}><Text>Save</Text></Pressable>` | Gate exits 0 with INFO log | CI gate |
| T-H3c | I-39 allowlist | Same as T-H3a + allowlist comment | Gate exits 0 | CI gate |
| T-I37 | I-37 regression | Run existing i37 gate post-17c | Exit 0 (still passing — no regression) | CI gate |
| T-PRE | tsc clean | `cd mingla-business && npx tsc --noEmit` | Exit 0 | Build |

---

## 7. Implementation order (sequential — single-sweep per D-17c-2 Option A)

1. **§A — IconChrome primitive change** (~15 min)
   - Add `DEFAULT_HIT_SLOP` constant
   - Update `IconChromeProps` (required `accessibilityLabel`, optional `hitSlop`)
   - Update component signature destructure
   - Update Pressable JSX (add `hitSlop={hitSlop}` prop, remove `?? icon` fallback)

2. **§B — IconChrome consumer migration** (~1.5 hrs)
   - Run `cd mingla-business && npx tsc --noEmit` — collect every consumer error
   - For each errored file, read, identify icon, apply §B.1 mapping, add explicit label
   - Re-run tsc → clean

3. **§C — Scrim Pressable label + role** (~10 min)
   - Modal.tsx:187 + Sheet.tsx:260 + TopSheet.tsx:275 — add 2 props each

4. **§D — Other label gaps** (~45 min)
   - 8 files per §D.1 — verify + fix-or-document each
   - IMPL report enumerates verdict per file

5. **§E — Pill.tsx** (~5 min — verification only, no code change)
   - Document NO-OP in IMPL report

6. **§F — Page-level motion** (~30 min)
   - EventCover.tsx — verify NO-OP, document
   - scanner/index.tsx — add AccessibilityInfo import + wire reduce-motion guard around `Animated.timing` calls at lines 207 + 228

7. **§G — I-38 gate** (~1.5 hrs)
   - Author `i38-icon-chrome-touch-target.mjs` mirroring i37 pattern
   - Test against current code state (must exit 0 post-§A primitive change)
   - Add workflow YAML job
   - Author 2 fixtures (violation + allowlist) → confirm exit codes → delete fixtures

8. **§H — I-39 gate** (~2.5 hrs)
   - Author `i39-pressable-label.mjs` mirroring i37/i38 + Pressable+TouchableOpacity branching + implicit-Text-child heuristic
   - Test against current code state (must exit 0 post-§B/§C/§D)
   - Add workflow YAML job
   - Author 3 fixtures (violation + implicit pass + allowlist) → confirm → delete

9. **§I — README registry update** (~10 min)
   - Append 2 rows to Active gates table

10. **§J — INVARIANT_REGISTRY.md I-38 + I-39 entries (DRAFT)** (~30 min)
    - Append both entries verbatim per §J.1 + §J.2

11. **§K — Pre-write feedback memory file** (~20 min)
    - Write `feedback_wcag_aa_kit_invariants.md` (DRAFT)
    - Add MEMORY.md index entry

12. **Pre-flight verification + IMPL report** (~30 min)
    - Final tsc clean
    - Run all 3 gates locally (i37 + i38 + i39) → all exit 0
    - Write `IMPLEMENTATION_BIZ_CYCLE_17C_WCAG_AUDIT_REPORT.md` per `feedback_post_pass_protocol`

**Total estimate: ~7.5 hrs** (matches forensics dispatch projection).

**Pre-flight per `feedback_implementor_uses_ui_ux_pro_max`:** Step 1 (§A primitive change) MUST invoke `/ui-ux-pro-max` before code, even though visual size is unchanged — the touch-target adjustment is a UI accessibility decision.

---

## 8. Regression prevention

| Class of regression | Prevention |
|---|---|
| New IconChrome consumer ships without label | TS compiler fails build (required prop) |
| New IconChrome consumer with size < 44 + no hitSlop override | I-38 CI gate fails PR |
| New Pressable with `onPress=` ships without label | I-39 CI gate fails PR |
| Future cycle re-introduces `?? icon` fallback | Code review (no automated gate — fallback removal is a one-shot subtraction) |
| Future cycle removes default `hitSlop` from IconChrome primitive | I-38 gate fails — primitive default is encoded in gate logic (§G.2) |
| Future cycle adds I-37 violation | Existing I-37 gate (no regression) |
| reduce-motion regression in scanner | Manual VoiceOver/TalkBack live-fire smoke (D-17c-6) at every release pre-CLOSE |
| Future page-level animation skips reduce-motion | No CI gate (D-17c-4 deferred); operator-discretion code review |

---

## 9. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| §B consumer migration time exceeds 1.5h estimate | MEDIUM | LOW | tsc-driven enumeration is mechanical; if more time needed, pause and report |
| `@babel/parser` / `@babel/traverse` not transitively in mingla-business/node_modules | LOW | MEDIUM | Already verified Cycle 17b; same install pattern works |
| I-39 gate produces false positives (Pressables wrapped in already-labeled parents) | MEDIUM | LOW-MEDIUM | Allowlist comments resolve case-by-case; first-pass green is goal, not zero false positives |
| `Pill.tsx` turns out to be interactive somewhere (used as Pressable wrapper) | LOW | LOW | Direct file read at spec time confirms it's a `<View>`; if a future consumer wraps Pill in Pressable, that wrapper is the responsible element |
| `scanner/index.tsx` Animated.timing branches diverge per call site | LOW | LOW | Implementor adapts per call site; helper extraction optional |
| I-38 gate doesn't catch dynamic `size={someVar}` consumers | MEDIUM | LOW | Gate emits WARN (not violation); manual review captures these |
| Operator can't run TalkBack live-fire (no Android device) | LOW | MEDIUM | At minimum VoiceOver/iOS coverage required; TalkBack deferred with explicit "Android live-fire pending" note in CLOSE |

---

## 10. Operator-side checklist

**Pre-CLOSE manual gates (D-17c-6 — mandatory per `feedback_headless_qa_rpc_gap`):**

- [ ] Open mingla-business on iOS device (TestFlight or `npx expo start`)
- [ ] Settings → Accessibility → VoiceOver ON
- [ ] Navigate to **home** (`(tabs)/home.tsx`) — verify TopBar search/bell announce; brand chip announces; bottom nav tabs announce
- [ ] Navigate to **events** (`(tabs)/events.tsx`) — verify `+` announces "Build a new event"
- [ ] Navigate to **event detail** (`event/[id]/index.tsx`) — verify Share + Manage announce
- [ ] Navigate to **brand profile** (`brand/[id]/...`) — verify back button + edit button announce
- [ ] Navigate to **account** (`(tabs)/account.tsx`) — verify menu rows announce
- [ ] Open any **modal** + tap dim backdrop — verify "Dismiss modal" announces
- [ ] Open any **sheet** + tap dim backdrop — verify "Dismiss sheet" announces
- [ ] iOS Settings → Accessibility → Reduce Motion ON → open scanner → verify overlay snaps (no fade)
- [ ] Repeat the 5-surface walk on Android with TalkBack (if device available; otherwise document as deferred)

**Commit message draft (per `feedback_no_coauthored_by` — no AI attribution):**

```
feat(business): Cycle 17c — WCAG AA kit-wide remediation (I-38 + I-39)

- IconChrome: bake default hitSlop={top:4,bottom:4,left:4,right:4} → effective 44pt touch (visual unchanged at 36)
- IconChrome: accessibilityLabel now TS-required; remove ?? icon silent fallback
- ~10 explicit screen-reader labels added (3 scrim Pressables in Modal/Sheet/TopSheet + 6-8 P2 gaps)
- scanner/index.tsx: wire AccessibilityInfo.isReduceMotionEnabled() guard around Animated.timing
- New CI gates: I-38 IconChrome touch-target + I-39 Pressable accessibilityLabel
- INVARIANT_REGISTRY: I-38 + I-39 entries
- New memory: feedback_wcag_aa_kit_invariants.md

Visual UI unchanged. Live-fire VoiceOver+TalkBack PASS on 5 surfaces.
ORCH-IDs closed: D-CYCLE17A-IMPL-5, D-CYCLE17B-QA-5, D-17c-1..D-17c-9.
DEC-103 (or DEC-104 pending ORCH-0733).
```

**EAS dual-platform OTA (per `feedback_eas_update_no_web` — two separate commands):**

```bash
cd mingla-business && eas update --branch production --platform ios --message "Cycle 17c WCAG AA kit-wide remediation"
cd mingla-business && eas update --branch production --platform android --message "Cycle 17c WCAG AA kit-wide remediation"
```

**CLOSE protocol reminders (per `feedback_post_pass_protocol`):**
- Update all 7 close-protocol artifacts (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS)
- Flip I-38 + I-39 invariant statuses DRAFT → ACTIVE
- Flip `feedback_wcag_aa_kit_invariants.md` status DRAFT → ACTIVE
- Author DEC-103 (or DEC-104) entry in DECISION_LOG.md with the 9 D-17c-N decisions batched

---

**End of spec.**
