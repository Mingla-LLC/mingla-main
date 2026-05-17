# IMPLEMENTATION — ORCH-0857 — Hub Events filter pill row: "weird space on top" between pills and event list

**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET.md` (original SPEC was based on a wrong root cause — see §16 below)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET.md` (original investigation also wrong — see §16)
**Author:** Claude `mingla-implementor` (parity mirror)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Parent commit (fails-on-revert citation):** `a2019cfd5155eceaafaddebe38dc9cd31ece311c`
**Status:** implemented and verified — root-cause fix live-fire confirmed on iOS sim across all 3 affected filters (Live, Drafts, Upcoming).

---

## §1. ACTUAL root cause (replaces the original investigation's "border alpha asymmetry" hypothesis)

**Symptom (operator words):** "the live, and drafts tab have this weird space on top not sitting flush like the all, upcoming, and past tabs." Reframed after sim repro: when the Live or Drafts filter is selected, the event list appears ~150pt lower than when Upcoming/All/Past are selected — large empty area between the pill row and the first event card / empty-state card.

**Root cause (proven via iOS sim live-fire):** React Native's `<ScrollView>` outer container defaults to `flexGrow: 1` and `flexShrink: 1`. The Hub Events screen has TWO ScrollView siblings inside a flex column host: the horizontal `pillsScroll` (filter pills) and the vertical events ScrollView (event cards). With both defaulting to `flexGrow: 1`, they competed for the host's leftover vertical space and split it between themselves. The amount the pills ScrollView grew depended on the events ScrollView's intrinsic content size:

| Filter | Events list intrinsic | Pills ScrollView grew to | Empty space below pills inside pillsScroll | Visible gap above first card |
|---|---|---|---|---|
| Upcoming (5+ cards) | ~500pt | ~50pt (no extra) | 0pt | flush ✅ |
| Past (4 cards) | ~400pt | ~50pt (no extra) | 0pt | flush ✅ |
| All (11 items) | ~1000pt | ~50pt (no extra) | 0pt | flush ✅ |
| **Live (2 cards)** | ~250pt | **~200pt** | ~150pt empty | **~150pt gap** ❌ |
| **Drafts (0 → empty card)** | ~150pt | **~250pt** | ~200pt empty | **~200pt gap** ❌ |

Pills had natural content of 50pt (34pt pill + 16pt vertical padding) but the stretched frame let them render 150-200pt of empty space below the pill content (still inside the pills ScrollView's bounds), pushing the events ScrollView down by that amount.

**Fix:** pin `pillsScroll` to its intrinsic 50pt height by setting `flexGrow: 0` + `flexShrink: 0`. This stops the space competition; events ScrollView sits flush right below pills across every filter.

## §2. Cross-Surface Impact (executed)

| Surface | Touched? | Why |
|---|---|---|
| 1. Consumer iOS (`app-mobile/`) | NO | different app |
| 2. Consumer Android (`app-mobile/`) | NO | different app |
| 3. Buyer/anon Web | NO | no Hub |
| 4. **Business iOS** | **YES** | events.tsx style edit; parity auto via shared StyleSheet |
| 5. **Business Android** | **YES** | same file, auto parity |
| 6. Admin Web | NO | no Hub |
| 7. Business Web preview | NO | `(tabs)/hub` is mobile-only |

## §3. Old → New Receipts

### File 1: [mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/(tabs)/hub/events.tsx) — four edits

#### Edit 1 — `pill.borderColor` literal swap (cosmetic polish, not bug fix)

**Before:** `borderColor: glass.border.profileBase` → `"rgba(255, 255, 255, 0.08)"`
**After:** `borderColor: "rgba(255, 255, 255, 0.55)"`
**Why:** Originally diagnosed (incorrectly) as the bug root cause; turns out it was a separate visual polish opportunity. Operator confirmed they like the change ("perfect as it is right now"), so kept it. Tradeoff: idle pill borders are now clearly visible at the same alpha as the active pill's orange border, so toggling state changes color only — never perceived bounding rect.
**Lines:** 1 style line + 6 lines of `ORCH-0857 [Hub pill active-state visual parity]` protective comment.

#### Edit 2 — Pressable `hitSlop`

**Before:** No `hitSlop` prop. Touch area = 34pt visual pill height.
**After:** `hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}` → 44pt total touch area while visual height stays 34pt.
**Why:** Independent accessibility improvement folded in — WCAG AA + Mingla `I-38 IconChrome touch ≥ 44pt`.
**Lines:** 1 prop line + 3 lines of `ORCH-0857 [Hub pill 44pt hit target]` protective comment.

#### Edit 3 — `pillLabel.lineHeight: 16`

**Before:** No explicit `lineHeight`. iOS used font default; dot/label cross-axis baselines could drift 1-2pt on the Live pill.
**After:** `lineHeight: 16` for deterministic baseline.
**Why:** Independent polish — locks the green pulse dot's optical center to the label glyph center.
**Lines:** 1 style line + 6 lines of `ORCH-0857 [Hub pill dot/label baseline]` protective comment.

#### Edit 4 — **ROOT-CAUSE FIX** — `pillsScroll.flexGrow: 0` + `flexShrink: 0`

**Before:**
```ts
pillsScroll: {
  paddingVertical: spacing.sm,
}
```
RN's ScrollView default `flexGrow: 1` made this scroll view stretch to compete for the host's leftover vertical space against the events ScrollView sibling.

**After:**
```ts
pillsScroll: {
  paddingVertical: spacing.sm,
  // [12-line ORCH-0857 comment documenting the bug and fix]
  flexGrow: 0,
  flexShrink: 0,
}
```
Pins pillsScroll to its 50pt intrinsic height (34pt pill + 16pt vertical padding). Events ScrollView now sits flush right below pills regardless of filter.

**Why:** Fixes the operator-reported "weird space on top" symptom — the actual bug.
**Lines:** 2 style lines + 13 lines of `ORCH-0857 [Hub events list flush-with-pills]` root-cause-fix comment.

### File 2: `mingla-business/scripts/ci/orch-0857-pill-visual-parity-check.mjs` (new)

10-check Node script, no dependencies. Validates all four edits with comment-strip-aware revert guards:
- E1.a-c: borderColor literal + revert guard + comment
- E2.a-b: hitSlop literal + comment
- E3.a-b: lineHeight: 16 + comment
- **E4.a-c: pillsScroll flexGrow:0 + flexShrink:0 + comment (ROOT-CAUSE FIX)**

## §4. Verification Matrix

| Goal | Verification | Result |
|---|---|---|
| Live filter flush against pills | iOS sim screenshot at /tmp/o857_FIX_LIVE2.png — 2 cards visible directly below pill row, no gap | **PASS (live-fire)** |
| Drafts filter (empty state) flush against pills | iOS sim screenshot at /tmp/o857_FIX_DRAFTS.png — "No events here" card flush below pills | **PASS (live-fire)** |
| Upcoming filter still flush (no regression) | iOS sim screenshot at /tmp/o857_FIX_UPC.png — 5 cards stacked from top, no change from pre-fix | **PASS (live-fire)** |
| All filter still flush (no regression) | Same pillsScroll fix applies; not specifically re-screenshotted | **PASS (structural — same code path)** |
| Past filter still flush (no regression) | Same | **PASS (structural)** |
| Cosmetic: active pill no longer reads taller than idle pills | Borders now share alpha 0.55; verified visually in /tmp/o857_FIX_LIVE2.png | **PASS** |
| Hit-target 44pt | hitSlop literal in source; runtime tap-above verification deferred to TEST phase | **PASS (structural); runtime unverified** |
| Live dot/label baseline | lineHeight: 16 in source; pixel sampling deferred to TEST | **PASS (structural); pixel unverified** |

Android parity unverified (no Android emulator booted this session) — implementor cites SPEC §2.5 auto-parity claim (shared StyleSheet, no platform-conditional code), tester to confirm.

## §5. Invariant Verification

| Invariant | Status |
|---|---|
| `I-38 IconChrome touch ≥ 44pt` | **Preserved + improved** (Hub filter pills now compliant via hitSlop) |
| Constitution #1 (no dead taps) | Preserved — touch area grew |
| `I-1.2-UNIFIED-EVENT-TYPE` | Not touched |
| `I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY` (DRAFT) | Satisfied for Hub pills |
| **New candidate `I-PROPOSED-RN-SCROLLVIEW-FLEX-GROW-ZERO-WHEN-SIBLING`** | Codified: when two or more `<ScrollView>` siblings share a flex column/row parent, at least all-but-one MUST declare `flexGrow: 0` to prevent space-competition layout bugs. RN's default `flexGrow: 1` is the silent footgun. |

## §6. Regression Test (ORCH-0840 Step 0.5)

**Test path:** `mingla-business/scripts/ci/orch-0857-pill-visual-parity-check.mjs`

**Passing-run output (on fixed code at HEAD):**

```
10/10 checks passed.
exit=0
```

**fails-on-revert verified at commit `a2019cfd5155eceaafaddebe38dc9cd31ece311c`** — true-line-deletion of `flexGrow: 0` + `flexShrink: 0` from pillsScroll style flips the script to:

```
[FAIL] E4.a  pillsScroll style declares flexGrow: 0 ...
[FAIL] E4.b  pillsScroll style declares flexShrink: 0 ...
8/10 checks passed.
exit=1
```

Restoring → 10/10 PASS exit 0. Comment-strip awareness in pillsScrollBlockNoComments ensures the ORCH-0857 comment's mention of "flexGrow: 1" (explaining what's being fixed) doesn't false-positive the regression check.

## §7. Deno gate

Not applicable.

## §8. Migration / DB push

Not applicable.

## §9. TypeScript gate

`npx tsc --noEmit` in mingla-business — zero new errors in [events.tsx](mingla-business/app/(tabs)/hub/events.tsx). Pre-existing errors in `app/checkout/[eventId]/buyer.tsx` and `packages/phone-input/` were present at parent commit and unrelated.

## §10. Parity Check

Single shared StyleSheet — iOS + Android render identical. RN's `flexGrow: 0` is cross-platform.

## §11. Cache Safety

N/A — pure style edit.

## §12. Regression Surface

5 adjacent flows to spot-check:
1. **Hub → Marketing sub-route** — uses same `<HubSubNav>` chrome; events ScrollView pattern may differ. Tester confirms no regression.
2. **Hub → Experiences sub-route** — placeholder; spot-check renders.
3. **Hub → Trips sub-route** — placeholder; spot-check renders.
4. **Marketing → Campaigns/Audiences/Blasts** — uses similar pill-row-then-list pattern. Check for the same competing-ScrollView bug class.
5. **Other glass-bordered components in mingla-business** — `glass.border.profileBase` is untouched globally; should be visually unchanged.

## §13. Constitutional Compliance

All 14 rules scanned. No violations.

## §14. Transition Items

None.

## §15. Discoveries for Orchestrator

1. **NEW CRITICAL DISCOVERY: RN `<ScrollView>` defaults `flexGrow: 1`.** This is a silent footgun any time two or more ScrollViews are siblings in a flex container. Recommend codifying as invariant `I-PROPOSED-RN-SCROLLVIEW-FLEX-GROW-ZERO-WHEN-SIBLING` and adding a strict-grep CI gate to detect the anti-pattern (two `<ScrollView>` siblings without explicit `flexGrow: 0` on N-1 of them). High likelihood this pattern exists in OTHER mingla-business / app-mobile screens — worth a sweep. Saved as memory `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` (DRAFT until orchestrator confirms).

2. **Investigation + SPEC were both wrong** — diagnosed border-alpha asymmetry (cosmetic) instead of the actual layout bug. Three things contributed: (a) source-only investigation when sim repro was Prime Directive 7 mandatory and the sim was accessible (didn't push hard enough on the unblock at the time), (b) anchoring on the screenshots' active-pill visual difference as the "obvious" symptom and never measuring the pill-row-to-card gap, (c) operator's "weird space on top" wording was ambiguous between "inside the pill" and "between pills and content". Process improvement: forensics phase should pixel-measure the gap they're investigating BEFORE writing the report, not just visually eyeball it.

3. **Cosmetic Edits 1-3 ended up as side benefits, not the bug fix.** The borderColor swap (Edit 1) is operator-confirmed-liked, but it was a fortunate side-effect of the wrong diagnosis. If we'd diagnosed correctly first, Edit 1 might never have been written. Worth noting for future ORCH retro that wrong-diagnosis-with-good-cosmetic-byproduct is a pattern to recognize, not celebrate.

4. **Drafts 0 count text is awkward UX** — empty filter shows "Drafts 0" pill which Seth taps to see "No events here" empty state. Could consider hiding the count badge when 0 for cleaner copy. Not in scope; orchestrator call.

5. **The forwardRef LogBox error** (ORCH-0836 [Stripe forwardRef RN 0.65.1 LogBox filter]) is still surfacing on Hub navigation — the LogBox filter isn't catching it. Separate ORCH if it's actually broken; flagged as observation only.

## §16. Honest retrospective — original SPEC was wrong

The original investigation (`reports/INVESTIGATION_ORCH-0857...`) hypothesized the bug was a perceptual illusion caused by the active pill's border-alpha (0.55) being more visible than the idle pill's border-alpha (0.08). The SPEC (`specs/SPEC_ORCH-0857...`) locked in three edits to "fix" that illusion (borderColor swap, hitSlop, lineHeight). After landing those edits, operator confirmed the actual bug ("weird space STILL exists") was untouched. Sim repro on a fresh Live filter screenshot revealed the actual symptom: ~150pt gap between pill row and first card, varying by filter content size — a classic flex-layout bug, not a perceptual one. Root cause re-investigated (this implementation report §1). Fix shipped as Edit 4. SPEC and investigation should be retroactively annotated or superseded by a META-ORCH note; orchestrator call. Original Edits 1-3 are NOT reverted — operator approved keeping them as polish — but they are NOT the bug fix.
