# SPEC — ORCH-0857 — Hub Events filter pill row: visual parity across active/idle states

**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET.md`
**Author:** Claude `mingla-forensics` (SPEC mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Strategy chosen:** Option B (new dedicated `pill.borderIdle` token at α=0.55) + fold F-3 (44pt hit target) + F-2 fix (explicit `lineHeight` on `pillLabel` so dot and text share a deterministic cross-axis baseline)

---

## §1. Scope

The Hub → Events filter pill row in `mingla-business` ([mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/%28tabs%29/hub/events.tsx)) MUST render with these guarantees:

- **SC-1.** All five filter pills (All / Live / Upcoming / Drafts / Past) share an identical visible top edge and visible bottom edge (±1 device pixel) regardless of which pill is selected. Toggling `pillActive` changes color only — never perceived bounding rect.
- **SC-2.** Each pill exposes a hit area ≥ 44pt (Apple HIG + WCAG AA + Mingla invariant `I-38 IconChrome touch ≥ 44pt`). Visual height may remain at the current 34pt; `hitSlop` carries the touch-target compliance.
- **SC-3.** On the Live pill, the green pulse dot's optical center aligns with the label glyph's optical center (±1 device pixel), eliminating the F-2 baseline asymmetry the investigation identified.

Implementation is StyleSheet-only inside [events.tsx](mingla-business/app/%28tabs%29/hub/events.tsx). No new tokens added to the global design system (`designSystem.ts` is NOT touched).

## §2. Non-goals

- Other pill rows in `mingla-business` (HubSubNav, MarketingSubNav, BottomNav, ActionTile, Stepper, etc.) — investigation §5 flagged them as candidates but did NOT prove the same alpha mismatch. Auditing those is a follow-up ORCH if any are confirmed affected.
- The global `glass.border.profileBase` token at `rgba(255, 255, 255, 0.08)` — leaving it untouched per Option B to contain blast radius.
- The `accent.border` token — unchanged.
- Pill background tint, label color, count color, active color — unchanged.
- Consumer mobile pill rows (`app-mobile/`) — different design system, different surface; out of scope for this dispatch.
- Animation / transition on selection state change — unchanged.

## §2.5. Cross-Surface Impact

| Surface | In scope? | Behavior demanded | Files touched | Parity |
|---|---|---|---|---|
| 1. Consumer iOS (`app-mobile/`) | NO | n/a — different app, different design system | none | n/a |
| 2. Consumer Android (`app-mobile/`) | NO | n/a — different app | none | n/a |
| 3. Buyer/anon Web (`mingla-business/` `/checkout/...`, `/e/...`, `/b/...`) | NO | n/a — buyer-anon routes don't expose Hub | none | n/a |
| 4. **Business iOS** (`mingla-business/` iOS) | **YES** | SC-1 + SC-2 + SC-3 all satisfied; selecting any filter pill produces no perceived height/position change in the row | [mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/%28tabs%29/hub/events.tsx) (StyleSheet section L725-L777 only) | Automatic (shared RN StyleSheet) |
| 5. **Business Android** (`mingla-business/` Android) | **YES** | Same as Business iOS | Same files | Automatic — RN StyleSheet renders identically; alpha rgba semantics are cross-platform |
| 6. Admin Web (`mingla-admin/`) | NO | n/a — admin doesn't render Hub | none | n/a |
| 7. Business Web preview (`mingla-business/` dev/web) | NO | n/a — `(tabs)/hub` is mobile-only; web preview does not render the Tabs group | none | n/a |

Parity between iOS and Android is automatic (shared RN StyleSheet, no platform-conditional code). Per the cross-surface rule, both still get explicit success criteria (SC-1-iOS, SC-1-Android, SC-2-iOS, SC-2-Android, SC-3-iOS, SC-3-Android — see §4).

## §3. Per-layer specification

### §3.1 Database layer
Not touched. No migration.

### §3.2 Edge function layer
Not touched.

### §3.3 Service layer
Not touched.

### §3.4 Hook layer
Not touched.

### §3.5 Component layer — `mingla-business/app/(tabs)/hub/events.tsx`

**Exactly three style-section edits inside `StyleSheet.create({ ... })` at L725-L777. No JSX changes. No new imports. No new tokens.**

#### Edit 1 — `pill` style (L737-L747)

**Before:**

```ts
pill: {
  height: 34,
  paddingHorizontal: spacing.md - 2,
  borderRadius: radiusTokens.full,
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  borderWidth: 1,
  borderColor: glass.border.profileBase,
  backgroundColor: glass.tint.profileBase,
},
```

**After:**

```ts
pill: {
  height: 34,
  paddingHorizontal: spacing.md - 2,
  borderRadius: radiusTokens.full,
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  borderWidth: 1,
  // ORCH-0857 [Hub pill active-state visual parity]: idle border alpha
  // raised from 0.08 (glass.border.profileBase) to 0.55 to match
  // accent.border. Toggling pillActive now changes color only — never
  // perceived bounding rect. Local to this file by design (Option B);
  // do NOT extract into a shared token without auditing all other
  // glass.border.profileBase consumers first.
  borderColor: "rgba(255, 255, 255, 0.55)",
  backgroundColor: glass.tint.profileBase,
},
```

#### Edit 2 — `pill` Pressable receives `hitSlop` (JSX L499-L509, single-line addition)

Actually a JSX edit — overriding the §3 promise of "no JSX changes." Correction: this is the ONE allowed JSX touch, and only to add `hitSlop`. No structural change to children.

**Before** (L499-L509):

```tsx
<Pressable
  key={p.key}
  onPress={() => setFilter(p.key)}
  accessibilityRole="tab"
  accessibilityState={{ selected: active }}
  accessibilityLabel={`${p.label}, ${p.count}`}
  style={({ pressed }) => [
    styles.pill,
    active && styles.pillActive,
    pressed && styles.pillPressed,
  ]}
>
```

**After:**

```tsx
<Pressable
  key={p.key}
  onPress={() => setFilter(p.key)}
  accessibilityRole="tab"
  accessibilityState={{ selected: active }}
  accessibilityLabel={`${p.label}, ${p.count}`}
  // ORCH-0857 [Hub pill 44pt hit target]: pill visual height stays at
  // 34pt for row compactness; hitSlop carries WCAG AA / I-38 compliance.
  // 5pt top + 5pt bottom = 44pt total touch area.
  hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}
  style={({ pressed }) => [
    styles.pill,
    active && styles.pillActive,
    pressed && styles.pillPressed,
  ]}
>
```

#### Edit 3 — `pillLabel` style (L755-L759) gets explicit `lineHeight`

**Before:**

```ts
pillLabel: {
  fontSize: 13,
  fontWeight: "500",
  color: textTokens.primary,
},
```

**After:**

```ts
pillLabel: {
  fontSize: 13,
  // ORCH-0857 [Hub pill dot/label baseline]: explicit lineHeight gives
  // RN a deterministic cross-axis center for the pillLiveDot to align
  // against under flexDirection:"row" + alignItems:"center". Without
  // it, iOS uses font-default line-height (~16) but reports it
  // inconsistently against the 6×6 dot's geometric center, producing
  // a 1-2pt visual drift unique to the Live pill.
  lineHeight: 16,
  fontWeight: "500",
  color: textTokens.primary,
},
```

#### Styles NOT touched

`host`, `barWrap`, `scroll`, `headerTitle`, `pillsScroll`, `pillsRow`, `pillActive`, `pillPressed`, `pillLabelActive`, `pillCount`, `pillCountActive`, `pillLiveDot`, `list`, `emptyTitle`, `emptyBody`, `emptyCta`, `emptyCtaLabel` — all unchanged.

### §3.6 Realtime
Not applicable.

## §4. Success criteria

| ID | Criterion | Test mechanism |
|---|---|---|
| SC-1-iOS | On iOS sim (iPhone 17 Pro or equivalent), tapping each of the 5 filter pills produces NO change in the row's visible top edge or bottom edge ±1 device pixel (measured by pixel diff between sequential screenshots). | Maestro flow: tap each pill in sequence, capture screenshot, run pixel-diff against the row's bounding rect Y coordinates. |
| SC-1-Android | Same as SC-1-iOS, on Android emulator. | Same Maestro flow against Android emulator UDID. |
| SC-2-iOS | Each pill responds to taps within a 44pt × pillWidth touch zone (5pt top + 5pt bottom hitSlop). Verified by tapping 5pt above the visible pill top and confirming the filter selects. | Maestro `tapOn: { point: "<x>,<y>" }` at coordinates 5pt above the visible pill top edge. |
| SC-2-Android | Same as SC-2-iOS, on Android. | Same. |
| SC-3-iOS | On the Live pill (when `counts.live > 0`), the green dot's vertical center pixel and the "L" glyph's vertical center pixel differ by ≤ 1 device pixel. | Screenshot of Live pill at 3x retina, sample dot center Y vs label glyph center Y, assert delta ≤ 1px. |
| SC-3-Android | Same as SC-3-iOS, on Android. | Same. |

All six criteria MUST pass independently. Cross-platform parity is automatic (single StyleSheet), but each criterion gets its own verification per the Cross-Surface rule.

## §5. Invariants

### Preserved
- **I-38 IconChrome touch ≥ 44pt** — preserved (now compliant for Hub filter pills via SC-2's hitSlop).
- **I-1.2-UNIFIED-EVENT-TYPE** — not touched.
- **Constitution #1 (no dead taps)** — preserved; touch area grows, doesn't shrink.

### New
- **I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY** (DRAFT → flips to ACTIVE on ORCH-0857 CLOSE) — any pill / chip / toggle component whose active state changes border color MUST maintain idle border alpha within ±0.10 of active border alpha, so toggling state changes color only — never perceived bounding rect. Codified to prevent ORCH-0857's class of bug from re-emerging in other pill-style components.

Strict-grep enforcement of this new invariant is OUT OF SCOPE for ORCH-0857 — it would require an AST-aware scanner to compare paired border-color tokens across active/idle style pairs, which is non-trivial. Tracked as a candidate for a future invariant-enforcement ORCH. The invariant is still binding on reviewers / implementors as a written rule.

## §6. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Idle row visual parity | Render row with no pill selected | Visible top/bottom edges identical across all 5 pills | UI snapshot |
| T-02 | Active-state row parity | Tap each of 5 pills in sequence | Row bounding rect unchanged between any two states | Maestro pixel diff |
| T-03 | Hit-target above pill | Tap 5pt above the visible top of the Live pill | Live filter selects (proves hitSlop top=5 active) | Maestro tap |
| T-04 | Hit-target below pill | Tap 5pt below the visible bottom of the Drafts pill | Drafts filter selects (proves hitSlop bottom=5 active) | Maestro tap |
| T-05 | Live dot/label alignment | Render Live pill with `counts.live = 5` | Dot center Y and label glyph center Y differ ≤ 1 pixel | Screenshot pixel sample |
| T-06 | No regression on `glass.border.profileBase` consumers | Render any other glass-bordered component in mingla-business (BrandProfileView, ConfirmDialog, GlassCard) | Visual unchanged from pre-ORCH-0857 baseline | Visual snapshot |
| T-07 | (Adversarial — tester-owned) Revert `borderColor` to `glass.border.profileBase` | Run T-01 + T-02 on reverted code | T-01 + T-02 FAIL (proves regression test exercises the fix) | Test infrastructure |

### Regression-test gate (ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5)

**Implementor happy-path test** — REQUIRED. A scripted check that:
1. Reads [mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/%28tabs%29/hub/events.tsx) text.
2. Asserts `pill: { ... borderColor: "rgba(255, 255, 255, 0.55)" ... }` is present.
3. Asserts `hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}` is present on the pill Pressable.
4. Asserts `pillLabel: { ... lineHeight: 16, ... }` is present.
5. Asserts `glass.border.profileBase` is NOT used in the `pill` style (would indicate revert).

Path: `mingla-business/scripts/ci/orch-0857-pill-visual-parity-check.mjs` (new file, modeled on `orch-0854-regression-check.mjs`).

**Fails-on-revert verified at <commit hash>** — implementor must demonstrate by reverting the three edits, running the script, getting exit 1; restoring, getting exit 0. Comment-revert does NOT count (per ORCH-0854 Discovery #5) — must be true line deletion.

**Tester adversarial test** — REQUIRED. Different angle from happy-path. Must attack at least ONE of:
- The new invariant `I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY` (e.g., parse the pill + pillActive styles, extract both border alphas, assert delta ≤ 0.10).
- The hitSlop math (assert top + bottom + visible-height ≥ 44).
- Cross-style independence (assert `glass.border.profileBase` is still referenced elsewhere in mingla-business — proving Option B kept the global token alive).

Path: `mingla-business/scripts/ci/orch-0857-tester-adversarial-check.mjs`.

Both tests are immutable post-land per `I-TESTS-APPEND-ONLY`.

## §7. Implementation order

1. **Edit 1** — change `borderColor` in `pill` style. Verify `tsc --noEmit` exit 0.
2. **Edit 2** — add `hitSlop` to pill Pressable. Verify `tsc --noEmit` exit 0.
3. **Edit 3** — add `lineHeight: 16` to `pillLabel` style. Verify `tsc --noEmit` exit 0.
4. **Write** `mingla-business/scripts/ci/orch-0857-pill-visual-parity-check.mjs`. Run it: must exit 0.
5. **Verify fails-on-revert** — temporarily revert Edit 1 (true line deletion of the new borderColor → restore old `glass.border.profileBase`); run the script; must exit 1. Restore Edit 1; run; must exit 0. Record the test commit hash.
6. **Write** `mingla-business/scripts/ci/orch-0857-tester-adversarial-check.mjs` (tester phase, not implementor).
7. Write implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET.md` per the implementor template with old→new receipts for all three edits.

## §8. Regression prevention

- **Structural safeguard:** the new invariant `I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY` codifies the rule; future pill components are bound to it.
- **CI safeguard:** the happy-path script in §6 fails CI if any of the three edits regress. Append-only enforcement via `.github/workflows/tests-append-only.yml` (existing, no change needed).
- **Protective comments:** each of the three edits carries an `ORCH-0857 [...]` comment explaining WHY the value is the way it is, so future maintainers don't "tidy up" the rgba literal back to a token reference, the `hitSlop` to nothing, or the `lineHeight: 16` to "let RN handle it."

## §9. Known carryover / accepted

- **Other pill rows in `mingla-business` may also exhibit the F-1 pattern** — not audited under this SPEC per §2 non-goals. If TEST phase reveals one during cross-surface verification, register a follow-up ORCH (e.g., ORCH-0858 [Hub adjacent pill rows visual parity audit]).
- **The global `glass.border.profileBase` (α=0.08) remains untouched** — intentional, to contain blast radius. Any other component using it that ALSO uses an `accent.border` (α=0.55) for active state will exhibit the same illusion; flagged but not fixed by ORCH-0857.

## §10. Layman summary

- **What the fix does.** Three tiny edits in one file. The unselected pills get a more visible border (matching the orange selected pill's intensity, but in white at the same opacity). Toggling between filters now only changes COLOR — never the apparent pill size. The pills also get a 5-point tap zone above and below so the touch target meets accessibility minimums even though the visual height stays at 34pt for row compactness. The green pulse dot on the Live pill is locked to the label's baseline so it stops drifting a pixel out of alignment.
- **What gets touched.** One file: [mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/%28tabs%29/hub/events.tsx). Three edits — `pill.borderColor`, `<Pressable hitSlop>`, `pillLabel.lineHeight`. No global tokens changed. No other pill row touched.
- **What gets verified.** Six success criteria (3 visual × iOS+Android). Two CI regression scripts (implementor + tester). One new invariant codified.
- **What does NOT change.** No DB. No edge function. No service. No hook. No global design token. No other pill row. No animation. No filter logic.
