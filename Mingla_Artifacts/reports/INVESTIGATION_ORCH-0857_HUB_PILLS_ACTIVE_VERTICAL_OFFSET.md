# INVESTIGATION — ORCH-0857 — Hub Events filter pills: active pill appears taller / not flush with siblings

**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0857_HUB_PILLS_ACTIVE_VERTICAL_OFFSET.md`
**Mode:** Claude `mingla-forensics` — INVESTIGATE
**Confidence:** **probable** (sim attempt made; blocked at login screen on the booted sim — see §2.b)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## §1. Symptom (operator verbatim)

> "the live, and drafts tab have this weird space on top not sitting flush like the all, upcoming, and past tabs."

Operator attached two `mingla-business` Hub → Events screenshots:
- **Shot A** — Live filter selected (orange highlight, green dot, count "2"). Live pill visually extends above the baseline of the other four pills.
- **Shot B** — Drafts filter selected (orange highlight, count "0"). Drafts pill visually extends above the baseline of the other four pills.

**Reframing after code read:** the "off" pill in each shot is the **selected one**, not the keys "live" + "draft" per se. The bug is correlated with `pillActive` state, not with specific filter keys.

## §2. Investigation Manifest (every file read, in trace order)

1. [mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/(tabs)/hub/events.tsx) — pill row JSX L485-L525, style sheet L725-L777, imports L36-L41
2. [mingla-business/src/constants/designSystem.ts](mingla-business/src/constants/designSystem.ts) — `spacing` L29-L37, `radius` (imported as `radiusTokens`) L39-L47, `accent` L158-L163, `glass` L194-L220
3. ORCH-0826 [Hub Foundation + universal-plus creator] M0 SPEC + close note — confirmed prior decisions on pill row (sticky pills, negative-margin hack removed, no documented active-height differential)
4. Sim state probe: `xcrun simctl listapps booted` → `com.sethogieva.minglabusiness` installed on iPhone 17 Pro (iOS 26.4, UDID `17091E60-C3B6-4167-980D-60C348E177F6`)

### §2.b — Sim repro attempt + blocker (per Prime Directive 7)

Launched the app via `xcrun simctl launch booted com.sethogieva.minglabusiness` (pid 32424). App opened to the auth landing screen ("MINGLA BUSINESS / List experiences, reach guests, and grow — simply. / Continue with Apple / Google / Email"). **Blocker:** test founder credentials are not pre-staged on this sim; navigating to Hub → Events requires sign-in + a brand with active + draft events. Surfacing this per Prime Directive 7 — confidence remains **probable**; can be promoted to **proven** if Seth signs in and reaches Hub → Events while I'm watching the sim, OR Seth's already-provided screenshots are accepted as runtime evidence.

## §3. Findings

### F-1 🔴 ROOT CAUSE (probable) — Border-alpha asymmetry creates the illusion that the active pill is taller than the idle pills

| Field | Evidence |
|---|---|
| **File + line** | [mingla-business/app/(tabs)/hub/events.tsx:737-751](mingla-business/app/(tabs)/hub/events.tsx#L737-L751) + [mingla-business/src/constants/designSystem.ts:158-163, 211](mingla-business/src/constants/designSystem.ts#L158-L211) |
| **Exact code** | `pill: { height: 34, borderWidth: 1, borderColor: glass.border.profileBase, ... }` / `pillActive: { backgroundColor: accent.tint, borderColor: accent.border }` |
| **Token values** | `glass.border.profileBase = "rgba(255, 255, 255, 0.08)"` (alpha 0.08 — barely visible on the dark Hub background) vs `accent.border = "rgba(235, 120, 37, 0.55)"` (alpha 0.55 — clearly visible warm-orange) |
| **What it does** | Both states layout-occupy 34px of height with a 1px border. But the idle border at α=0.08 is so faint on a near-black background that the human eye reads the pill's visible top edge as the **tint background's top**, not the (invisible) border's top. The active state at α=0.55 makes the border crisply visible, so the eye reads the pill's visible top edge as the **orange border's top** — which sits exactly 1px above where the idle pills' apparent top reads. Combined with the active background-tint being more saturated than the idle profileBase, the active pill appears to extend ~1-2px upward AND downward relative to its idle neighbors. |
| **What it should do** | All five pills should share a single visual top + bottom baseline. The active state should change color WITHOUT changing perceived bounding rect. |
| **Causal chain** | Operator selects a filter → `pillActive` applied → `borderColor` swaps from rgba(255,255,255,0.08) to rgba(235,120,37,0.55) → the active border becomes visible while idle borders remain near-invisible against the dark hub background → human visual system anchors the active pill's "edge" 1px higher than the idle pills' apparent edges → active pill reads as taller / not flush. |
| **Verification** | (a) Render the active pill with `borderColor: "transparent"` and confirm the perceived offset disappears. (b) Render an idle pill with `borderColor: "rgba(255, 255, 255, 0.55)"` (matching the active alpha) and confirm idle now reads at the same perceived top edge as the active. (c) Pixel-measure both states at retina: layout heights will be identical; visible-edge heights will differ by ~1-2px due to alpha contrast. |

**Why "probable" not "proven":** the rgba differential is direct code evidence and the perceptual model is well-known on dark RN surfaces, but the live-fire pixel measurement on the booted sim is the bar for `proven` per Prime Directive 7. Seth can promote to `proven` by navigating to Hub → Events on the booted sim (instructions in §7).

### F-2 🟠 CONTRIBUTING FACTOR — `pillLiveDot` may add a secondary visual asymmetry on the Live pill only

| Field | Evidence |
|---|---|
| **File + line** | [mingla-business/app/(tabs)/hub/events.tsx:511-513, 772-777](mingla-business/app/(tabs)/hub/events.tsx#L511-L777) |
| **Exact code** | `{p.showLivePulse ? (<View style={styles.pillLiveDot} />) : null}` with `pillLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: semantic.success }` |
| **What it does** | When `counts.live > 0`, a 6×6 green `<View>` renders inside the Live pill before the label. The pill uses `flexDirection: "row"` + `alignItems: "center"` + `gap: 6`. RN on iOS computes `alignItems: center` per-child against each child's intrinsic cross-axis size — a 6px `<View>` centers around its geometric midpoint, while a `<Text>` centers around the line-box midpoint, which on iOS sits 1-2px above the visible glyph midpoint due to font ascender/descender padding. |
| **What it should do** | The dot's optical center should sit on the same horizontal line as the label glyph's optical center. |
| **Causal chain** | Live pill renders dot + "Live" + "2" in a row → RN aligns each child by its own intrinsic center → the dot's geometric center aligns to (pill_inner_height / 2), but the "Live" glyph optical center is offset ~1-2px below that line on iOS → dot reads slightly above the label, creating a subtle visual asymmetry unique to the Live pill. This would make Live look slightly off-baseline EVEN WHEN NOT SELECTED. |
| **Verification** | Render Live pill in idle state with the dot temporarily removed; pixel-compare the label-baseline to All / Upcoming / Drafts / Past idle pills. If Live now matches, F-2 contributes. If Live still looks off vs the others while idle, F-2 is not contributing. |

**Why this is a contributing factor not the root cause:** F-2 only affects the Live pill (no other pill has `showLivePulse`). It can't explain Drafts appearing off in Shot B. F-1 explains both shots; F-2 may compound the Live pill's perceived offset across both shots.

### F-3 🟡 HIDDEN FLAW — Pill height 34px is below the WCAG AA touch-target minimum 44pt (I-38 violation)

| Field | Evidence |
|---|---|
| **File + line** | [mingla-business/app/(tabs)/hub/events.tsx:738](mingla-business/app/(tabs)/hub/events.tsx#L738) |
| **Exact code** | `pill: { height: 34, ... }` |
| **What it does** | Each filter pill is 34pt tall. With WCAG AA + Apple HIG touch target = 44pt minimum (Mingla codified as invariant `I-38 IconChrome touch ≥ 44pt` per `feedback_wcag_aa_kit_invariants.md`), every Hub filter pill is currently below target. |
| **What it should do** | Pills should expose at least a 44pt hit area, either by raising `height` to 44 or by adding `hitSlop={{ top: 5, bottom: 5, left: 0, right: 0 }}` to each Pressable. |
| **Causal chain** | Independent of the F-1 symptom — this is pre-existing and surfaces in any small-pill review. Flagged here because the ORCH-0857 SPEC will touch this same style sheet and the fix is one line. |
| **Verification** | Accessibility Inspector → tap target size on Hub pill row. |

**Why flagged separately:** Not the symptom Seth reported, but the closing SPEC for ORCH-0857 should decide whether to fold the height-bump in (Mingla pattern: yes, when touching adjacent code) or register a follow-up ORCH.

### F-4 🔵 OBSERVATION — `pillLabel` and `pillCount` have no explicit `lineHeight`

| Field | Evidence |
|---|---|
| **File + line** | [mingla-business/app/(tabs)/hub/events.tsx:755-771](mingla-business/app/(tabs)/hub/events.tsx#L755-L771) |
| **Detail** | `pillLabel { fontSize: 13, fontWeight: "500" }` and `pillCount { fontSize: 11, fontWeight: "600" }` rely on RN's platform-default line-height (iOS ~1.2× fontSize). Mixed font sizes inside `alignItems: "center"` can produce minor cross-axis baseline drift even without F-1. Not a defect today; worth noting because the F-1 fix may want to explicitly set `lineHeight: 16` (label) + `lineHeight: 14` (count) so the row baseline is deterministic. |

## §4. Five-Truth-Layer Cross-Check

| Layer | Finding |
|---|---|
| **Docs** | ORCH-0826 M0 SPEC describes pill row as "sticky filter pills, ~34pt height" — no contradiction with current code. No prior decision on active-state visual symmetry. |
| **Schema** | N/A — pure UI. |
| **Code** | Pill heights are STRUCTURALLY identical at 34px regardless of state. Only color tokens differ. F-1 is a visual/perceptual issue, not a layout issue. |
| **Runtime** | Sim attempt made; blocked at login screen (§2.b). Pixel measurement on the booted sim would confirm. |
| **Data** | N/A. |

**Contradiction map:** None across layers — all five agree pills are 34px tall. The bug lives in the **gap between layout truth (heights identical) and perceptual truth (active pill reads taller because its border is 6.9× more visible: α=0.55 vs α=0.08)**. This is the kind of bug source-only analysis CAN reach a probable verdict on because the contradiction is between code and human perception, not between code layers.

## §5. Blast Radius

- **`mingla-business` Hub → Events** ([mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/(tabs)/hub/events.tsx)) — directly affected (the operator's reported surface).
- **`mingla-business` Hub → Marketing sub-nav** — different component but uses the same `accent.border` token vs `glass.border.profileBase` pattern; may exhibit the same issue. Recommend spec-level audit.
- **Any other pill rows in `mingla-business`** using `accent` for active border on dark backdrop. Quick grep target: `accent.border` co-located with `glass.border.profileBase`.
- **`app-mobile` (consumer)** — uses different design system tokens (Mingla consumer mobile is dark with its own palette). Out of scope for ORCH-0857 per the dispatch's Surfaces declaration. Should be flagged separately if a consumer audit reveals the same alpha mismatch — `glass.border.profileBase = 0.08` is the universal Mingla idle-glass border, and any consumer pill row pairing it with a 0.55-alpha active border would replicate.
- **Android parity** — same RN StyleSheet renders identically on Android with the same alpha values, so the bug is cross-platform if reproduced on iOS.

## §6. Invariant Implications

Candidate new invariant: **`I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY`** — any pill/chip/toggle component whose active state changes border color MUST either (a) maintain the same border alpha across states (within ±0.1), OR (b) add an idle-state "ghost" border at the active alpha so toggling state changes only color, not perceived bounding rect. Status: DRAFT — promote to ACTIVE on ORCH-0857 CLOSE if the spec adopts this rule.

Existing invariants potentially nudged:
- **`I-38 IconChrome touch ≥ 44pt`** — see F-3.

## §7. Recommended Next Phase (SPEC scope, NOT how to fix)

The SPEC should cover:
1. **F-1 visual parity fix** — pick ONE strategy (do not let implementor improvise):
   - **Option A:** raise idle `glass.border.profileBase` alpha to match active alpha range (e.g., `rgba(255,255,255,0.40)`) — risk: cascades to every other `profileBase`-bordered component in mingla-business; needs cross-surface impact map.
   - **Option B (recommended)** — pin a **new dedicated `pill.borderIdle` token at α=0.55** and use it only on the Hub pill row + any audit-identified siblings. Keeps `glass.border.profileBase` untouched. Scope contained.
   - **Option C:** keep idle border invisible and remove the active border entirely (rely on backgroundColor swap only). Risk: degrades active-state legibility.
2. **F-2 dot baseline fix** — wrap `pillLiveDot` in a Text-height shim (e.g., `<View style={{ height: 16, justifyContent: "center" }}><View style={pillLiveDot} /></View>`) OR set explicit `lineHeight: 16` on `pillLabel` so the dot and label share a deterministic cross-axis center. Spec should pick one and codify in the closing CSS rule.
3. **F-3 hit-target** — fold in OR defer to follow-up ORCH (operator call at SPEC review).
4. **Cross-surface impact** — spec MUST enumerate the 5 + 2 surfaces. Likely: `business-iOS` + `business-Android` only (consumer iOS/Android, admin-web, buyer-web all out of scope).
5. **Success criteria** — SC-1 (pill visible top edge identical ±1px across all 5 states + active state, measured on iOS sim screenshot), SC-2 (Android parity), SC-3 (Live-pill dot optical center aligned with label glyph center ±1px).
6. **Regression-test gate (ORCH-0840 Step 0.5)** — happy-path: pixel-snapshot test using `react-native-testing-library` or a Maestro screenshot diff; adversarial: change `accent.border` alpha and confirm test fails.

## §8. Layman summary (per `feedback_investigation_spec_test_layman_outcome.md`)

- **What's happening.** The pill you tap (Live in shot A, Drafts in shot B) looks like it sits a hair higher than the others. It's not actually taller — the math says all five pills are exactly 34 points tall in both states. The *border* of the selected pill is the bright orange (`rgba(235,120,37,0.55)`) while the other pills' borders are essentially invisible (`rgba(255,255,255,0.08)` — only 8% white on a dark background). Your eye reads the orange edge as the pill's top, but reads the *background tint* as the others' top. That 1-pixel of border thickness becomes the "weird space on top" you're seeing.
- **Why Live looks slightly off even when not selected (shot A).** Live is the only pill with the green pulse dot. Tiny 6×6 dot views and `<Text>` labels don't quite share the same optical center on iOS — the dot reads ~1 pixel above the label. So Live has a faint baseline-asymmetry independent of the active-state issue. This is a secondary contributor, not the main cause.
- **What the fix needs to be.** Either give the idle pills the same border intensity as the active pill (so toggling state only changes COLOR, never apparent SIZE), or remove the active border entirely and lean on the background tint alone. Spec leans toward option B (a dedicated 0.55-alpha idle border just for these Hub pills, leaving `glass.border.profileBase` untouched so we don't accidentally change every other glass component in mingla-business). Plus wrap the Live dot in a Text-height shim so it shares the label's baseline.
- **What's NOT broken.** The filter logic, the counts, the navigation, the responsiveness, the tap targets in absolute terms (34pt is below WCAG AA 44pt — flagged as F-3 hidden flaw, but pre-existing, not part of this symptom).
- **Confidence + blocker.** Probable from source code analysis (the rgba differential is unambiguous). Promoting to proven needs ~30 seconds on the iOS sim — Seth navigates to Hub → Events, I pixel-measure both states, then we lock the SPEC.

---

## Discoveries for Orchestrator

1. **Marketing sub-nav same risk.** Strong likelihood the same active-border-alpha asymmetry exists in any other `mingla-business` pill / chip row that pairs `glass.border.profileBase` (α=0.08) with `accent.border` (α=0.55). Worth a single-grep blast-radius pass at SPEC time; if found, fold into ORCH-0857 or register a follow-up.
2. **`I-PROPOSED-PILL-ACTIVE-STATE-VISUAL-PARITY` candidate invariant** — F-1's class is generalizable. Promote at CLOSE if the spec adopts.
3. **F-3 hit-target (I-38)** — 34pt pill height is a pre-existing accessibility miss. Operator call: fold or defer.
4. **F-4 explicit lineHeight** — no defect today; F-1 fix may want to set explicit `lineHeight` on `pillLabel` + `pillCount` for deterministic baselines.
