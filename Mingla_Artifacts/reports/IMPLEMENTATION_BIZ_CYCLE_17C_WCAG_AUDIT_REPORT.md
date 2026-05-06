# IMPLEMENTATION REPORT — BIZ Cycle 17c (WCAG AA kit-wide remediation)

**Cycle:** 17c (BIZ — Refinement Pass mini-cycle 3)
**Status:** completed
**Verification:** passed (tsc clean + 3 gates green: i37=0 / i38=0 / i39=0)
**Generated:** 2026-05-05
**Effort:** ~3 hrs (well under SPEC's 7.5-hr estimate; drivers in §1)
**SPEC anchor:** `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17C_WCAG_AUDIT.md`
**Forensics anchor:** `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17C_WCAG_AUDIT.md`

---

## 1. Layman summary

Shipped 14 work items per binding SPEC. **Visual outcome on device is identical to today** — every glassy icon button still renders at 36×36 — but the touchable area is now invisibly 44×44 thanks to a baked-in default `hitSlop` on the IconChrome primitive. Every interactive element in mingla-business now has an explicit screen-reader label (TypeScript-enforced for IconChrome, CI-enforced for every other Pressable/TouchableOpacity via the new I-39 gate). The QR scanner's overlay fade now collapses to instant set when the user has reduce-motion ON.

**Effort came in ~3 hrs vs SPEC's 7.5-hr estimate.** Three drivers: (a) only 5 IconChrome consumers needed explicit-label additions (all in dev styleguide) — production code was already labeled; (b) §D verification surfaced 5/8 false positives + 3 true I-39 violations the dev didn't anticipate (caught by gate, fixed in 5 min); (c) primitive-level `hitSlop` default made all 58 IconChrome consumers AA-compliant in one line.

**Test first:** open mingla-business on TestFlight or `npx expo start`. Confirm all 5 surfaces (home, events, event detail, brand profile, account) render unchanged visually. Then enable VoiceOver (iOS) → tap each icon — confirm the label announces (e.g., "Search, button" / "Notifications, button"). Open any modal, swipe to focus the dim backdrop → confirm "Dismiss modal, button" announces. Toggle Reduce Motion in iOS Settings → open scanner → scan a code → confirm overlay snaps in instantly.

---

## 2. Status

**Status:** completed · **Verification:** passed (static + tsc + 3 CI gates)

| Verification surface | Result |
|---|---|
| `cd mingla-business && npx tsc --noEmit` | ✅ clean (TSC=0) |
| `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` | ✅ exit 0 (119 files, 0 violations) |
| `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` | ✅ exit 0 (119 files, 0 violations) |
| `node .github/scripts/strict-grep/i39-pressable-label.mjs` | ✅ exit 0 (119 files, 0 violations, 0 implicit-Text-fallback INFOs) |
| Test fixtures cleaned | ✅ git status clean (no `__test_*` files) |
| `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17C_WCAG_AUDIT_REPORT.md` | ✅ this file |

**Runtime visual smoke** UNVERIFIED — implementor cannot run device. Operator gates on the 5-surface VoiceOver/TalkBack live-fire per SPEC §10 + IMPL dispatch §6.

---

## 3. Pre-flight design verification (per `feedback_implementor_uses_ui_ux_pro_max`)

Invoked `/ui-ux-pro-max` with the SPEC §3.2 query verbatim. Output (verbatim):

**UX domain — touch target hit slop accessibility icon button:**
- Touch Target Size (Severity: HIGH): "Minimum 44x44px touch targets" — **directly endorses I-38 invariant target.**
- Touch Spacing (Severity: MEDIUM): "Minimum 8px gap between touch targets" — **already met** by `spacing.sm = 8` in TopBar `rightCluster` style.

**Stack: react-native:**
- Use Pressable: "Pressable for touch interactions" — **IconChrome already uses Pressable** ✅
- Use Reanimated: "react-native-reanimated for high-performance animations" — IconChrome already uses Reanimated `useReducedMotion` ✅; scanner/index.tsx uses RN's old `Animated` API and gets `AccessibilityInfo` guard per §F.2

**Verdict:** /ui-ux-pro-max output supports SPEC §A approach. Visual size 36 + hitSlop 4 per side = effective 44×44 touchable area. Industry-standard for shipping invisible touch expansion on chrome icons. PROCEED.

---

## 4. Section A — Code changes (per SPEC item)

### §A — IconChrome primitive change

**File:** `mingla-business/src/components/ui/IconChrome.tsx`
**What it did before:** `accessibilityLabel?: string` (optional); component fell back to `accessibilityLabel ?? icon` at line 166 — silent regression vector. No `hitSlop` prop or default; touch surface = 36×36 visual = 36×36 effective (below WCAG AA 44pt floor).
**What it does now:**
- Added `import type { PressableProps }` to react-native imports
- Added `DEFAULT_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const` constant
- `IconChromeProps.accessibilityLabel: string` (REQUIRED — no `?`)
- `IconChromeProps.hitSlop?: PressableProps["hitSlop"]` (optional override)
- Both new props have explicit JSDoc citing I-38 / I-39 / Cycle 17c §A.1
- Component destructure: `hitSlop = DEFAULT_HIT_SLOP`
- Pressable JSX: added `hitSlop={hitSlop}` prop; removed `?? icon` fallback
**Why:** Satisfies SC-A1, SC-A2, SC-A3, SC-A4. Closes D-CYCLE17A-IMPL-5 + D-CYCLE17B-QA-5. Visual `DEFAULT_SIZE = 36` unchanged at line 56.
**Lines changed:** +20 / -3 (mostly JSDoc + interface fields)

### §B — IconChrome consumer migration

**Files modified:** `mingla-business/app/__styleguide.tsx` only (5 lines).
**What it did before:** 5 IconChrome demo fixtures at lines 468-472 with no explicit `accessibilityLabel=` (fell back to `?? icon`).
**What it does now:** 5 fixtures with explicit `accessibilityLabel="<purpose> (demo<,modifier>)"` strings (e.g., "Search (demo)", "Notifications (demo, 3 unread)", "Settings (demo, active)", "Settings (demo, disabled)").
**Why:** Satisfies SC-B1, SC-B2. Production code surface produced ZERO tsc errors — every non-styleguide IconChrome consumer was already labeled by 17a/17b. Only 5 dev fixtures needed migration. **Major scope reduction vs SPEC §B.2 28-file enumeration.**
**Lines changed:** +5 (label strings inserted)

### §C — Scrim Pressable label + role

**File 1:** `mingla-business/src/components/ui/Modal.tsx` line 187
- BEFORE: `<Pressable style={styles.scrimPress} onPress={handleScrimPress} />`
- AFTER: same JSX + `accessibilityLabel="Dismiss modal"` + `accessibilityRole="button"`

**File 2:** `mingla-business/src/components/ui/Sheet.tsx` line 260
- Same pattern + `accessibilityLabel="Dismiss sheet"`

**File 3:** `mingla-business/src/components/ui/TopSheet.tsx` line 275
- Same pattern + `accessibilityLabel="Dismiss sheet"`

**Why:** Satisfies SC-C1, SC-C2, SC-C3.
**Lines changed:** +12 across 3 files

### §D — Other label gap verification (8 files)

| # | File | Verdict | Action |
|---|---|---|---|
| 1 | `app/checkout/[eventId]/payment.tsx:340, 353` | TRUE GAP — implicit Text but explicit better | Added `accessibilityLabel="Force 3DS challenge (Card, testing only)"` and `"Force payment decline (testing only)"` |
| 2 | `mingla-business/src/components/checkout/PaymentElementStub.tsx` | FALSE POSITIVE in §D scan; **CAUGHT BY I-39 gate** at lines 277, 294 | Added `accessibilityLabel="Force 3DS challenge (stub only)"` and `"Force payment decline (stub only)"` |
| 3 | `mingla-business/src/components/brand/BrandEditView.tsx:369` | FALSE POSITIVE — already has `accessibilityLabel="Edit brand photo"` | None |
| 4 | `mingla-business/src/components/brand/PublicBrandPage.tsx:255, 264` | FALSE POSITIVE — IconChromes already labeled "Close" + "Share" | None |
| 5 | `mingla-business/src/components/event/PreviewEventView.tsx:73, 207, 292` | FALSE POSITIVE — has `accessibilityLabel={`Edit ${label}`}` template literal | None |
| 6 | `mingla-business/src/components/event/MultiDateOverrideSheet.tsx:642` | FALSE POSITIVE — has `accessibilityLabel={`Use main event ${accessibilityBase}`}` | None |
| 7 | `mingla-business/src/components/brand/BrandProfileView.tsx` | FALSE POSITIVE — 4 Pressables (lines 405, 461, 493, 532) all have explicit labels | None |
| 8 | `mingla-business/src/components/event/CreatorStep2When.tsx:1231` | TRUE GAP — implicit Text but explicit better per SPEC §D mandate | Added `accessibilityLabel={opt.label}` |
| 9 | (gate-discovered) `mingla-business/src/components/event/CreatorStep1Basics.tsx:224` | TRUE GAP — preset selector caught by I-39 gate | Added `accessibilityLabel={cat}` |

**Why:** Satisfies SC-D1, SC-D2. The I-39 gate caught 3 violations §D scan missed (PaymentElementStub:277, 294 + CreatorStep1Basics:224) — gate works as designed.

### §E — Pill.tsx (D-17c-8 NO-OP)

**File:** `mingla-business/src/components/ui/Pill.tsx`
**Verification:** Read full file. Component renders `<View>` (line 138-168), NOT `<Pressable>` or `<TouchableOpacity>`. No `onPress` prop. Pure visual status badge.
**Action:** No code change. Forensics §A.4 hidden flaw F-A3 hereby downgraded from 🟡 hidden flaw to 🔵 observation.
**SC:** SC-E1 PASS.

### §F.1 — EventCover.tsx (D-17c-9 partial NO-OP)

**File:** `mingla-business/src/components/ui/EventCover.tsx`
**Verification:** Grep confirmed zero `Animated`, `withTiming`, `withSpring`, `useAnimatedStyle`, `LayoutAnimation`, or `useReducedMotion` references. Pure SVG-rendered stripe pattern.
**Action:** No code change.
**SC:** SC-F1 PASS.

### §F.2 — scanner/index.tsx reduce-motion guard

**File:** `mingla-business/app/event/[id]/scanner/index.tsx`
**What it did before:** Two `Animated.timing` call sites (lines 207, 228) ran 250ms fade animations with NO reduce-motion respect. Vestibular-sensitive users with iOS/Android reduce-motion ON would still see the fade.
**What it does now:**
- Added `AccessibilityInfo` to react-native named imports
- Added `reduceMotionRef` (useRef<boolean>) + useEffect that subscribes to `AccessibilityInfo` initial state + `reduceMotionChanged` listener
- `dismissOverlay` (was line 207): branches on `reduceMotionRef.current` — when true: `overlayAnim.setValue(0)` + `setOverlay(null)` synchronously; else: existing `Animated.timing` path
- `showResult` (was line 228): same branching pattern — when reduce-motion ON, `overlayAnim.setValue(1)` instantly; else: existing timing
**Why:** Satisfies SC-F2. RN old Animated API has no `useReducedMotion` hook; subscription pattern with `AccessibilityInfo.addEventListener('reduceMotionChanged', ...)` is the canonical workaround for live updates mid-session.
**Lines changed:** +28 (16 new useEffect + 12 in branching)

### §G — I-38 CI gate

**File:** `.github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` (NEW, ~225 LOC)
**What it does:** Babel AST traversal across `mingla-business/app/` + `mingla-business/src/`. For each `<IconChrome>` JSX element: extracts `size=` numeric (default 36) + `hitSlop=` object/scalar (default `{top:4,bottom:4,left:4,right:4}`); computes effective dimensions `width = size + slop.left + slop.right` and `height = size + slop.top + slop.bottom`; flags if either dimension < 44 without `// orch-strict-grep-allow icon-chrome-touch-target — <reason>` allowlist comment. Mirrors `i37-topbar-cluster.mjs` pattern.

**Spec interpretation correction:** SPEC §G.3 had per-side math `size + slop_side` (incorrect — this returns 40 for the kit default of 36+4). The correct math is `size + 2×slop` for each axis. Fixed during implementation. Documented in spec-vs-implementation comment in the .mjs script.

**Workflow YAML:** Added `i38-icon-chrome-touch-target` job to `.github/workflows/strict-grep-mingla-business.yml` mirroring i37 job shape.

**Fixture round-trip (§G.3):**
- Violation fixture (`size={20} hitSlop={top:0,...}`) → exit 1 ✅ (with rich error showing 20×20 < 44)
- Allowlist fixture (same JSX + allowlist comment above) → exit 0 ✅
- Fixtures DELETED before final tsc + commit ✅

**Why:** Satisfies SC-G1, SC-G2, SC-G3.
**Lines changed:** +225 (new script) + 13 (new workflow job)

### §H — I-39 CI gate

**File:** `.github/scripts/strict-grep/i39-pressable-label.mjs` (NEW, ~205 LOC)
**What it does:** Babel AST traversal across same surfaces. For each `<Pressable>` and `<TouchableOpacity>` JSX element: checks `onPress=` presence (skip if absent — non-interactive); checks `accessibilityLabel=` presence; if absent, applies implicit-Text-child heuristic (only direct child is `<Text>{StringLiteral}</Text>` or `<Text>{TemplateLiteral}</Text>` → log INFO, pass); else: VIOLATION unless `// orch-strict-grep-allow pressable-no-label — <reason>` allowlist.

**Workflow YAML:** Added `i39-pressable-label` job mirroring i37/i38 shape.

**Fixture round-trip (§H.3):**
- Violation fixture (`<Pressable onPress={() => {}}><View /></Pressable>`) → exit 1 ✅
- Implicit-Text fixture (`<Pressable onPress={() => {}}><Text>Save</Text></Pressable>`) → exit 0 with INFO log ✅
- Allowlist fixture (violation JSX + allowlist comment) → exit 0 ✅
- Fixtures DELETED before final tsc + commit ✅

**§H gate also caught 3 real violations** the §D scan missed (PaymentElementStub:277, 294 + CreatorStep1Basics:224). Fixed; gate then exited 0.

**Why:** Satisfies SC-H1, SC-H2, SC-H3.
**Lines changed:** +205 (new script) + 13 (new workflow job)

### §I — README registry update

**File:** `.github/scripts/strict-grep/README.md`
**What it did before:** Active gates table listed I-37 only.
**What it does now:** Active gates table includes I-38 + I-39 rows pointing to script paths and INVARIANT_REGISTRY anchors. Added 2 lines under "Other registered gate tags" documenting the I-38 and I-39 allowlist comment patterns.
**Why:** Satisfies SC-I1.
**Lines changed:** +6

### §J — INVARIANT_REGISTRY.md I-38 + I-39 entries (DRAFT)

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`
**What it did before:** Latest entry was I-37 (Cycle 17b) ending at line 1709.
**What it does now:** Appends I-38 + I-39 entries verbatim per SPEC §J.1 + §J.2. Both tagged `status: DRAFT — flips to ACTIVE on Cycle 17c CLOSE`. Both reference forensics report + SPEC + DEC-103 placeholder + CI gate paths + fixture verification descriptions.
**Why:** Satisfies SC-J1.
**Lines changed:** +44

### §K — Memory file + MEMORY.md index entry (DRAFT)

**Files:**
- NEW: `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_wcag_aa_kit_invariants.md` (DRAFT, ~50 lines)
- MOD: `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md` — added new section "WCAG AA Kit Invariants (post-Cycle-17c)" with 1-line index entry pointing to the memory file (DRAFT marker)

**Status:** DRAFT — operator flips to ACTIVE at Cycle 17c CLOSE per `feedback_post_pass_protocol`.

**Why:** Satisfies SC-K1, SC-K2.
**Lines changed:** +50 (new file) + 4 (MEMORY.md index)

---

## 5. Spec Traceability — 25 success criteria verification matrix

| SC | Criterion | Verification | Result |
|---|---|---|---|
| SC-A1 | DEFAULT_HIT_SLOP constant + props field + Pressable spread | Direct file read | ✅ PASS |
| SC-A2 | accessibilityLabel TS-required (no `?`) | tsc fails on missed consumer | ✅ PASS (5 styleguide errors caught + fixed) |
| SC-A3 | `?? icon` fallback REMOVED | Direct file read line 166 area | ✅ PASS |
| SC-A4 | DEFAULT_SIZE = 36 unchanged | Direct file read line 56 | ✅ PASS |
| SC-B1 | Every IconChrome consumer passes explicit `accessibilityLabel=` | tsc clean | ✅ PASS |
| SC-B2 | IMPL report "Label additions" section | This report §4 §B + §C + §D tables | ✅ PASS |
| SC-C1 | Modal scrim has Dismiss modal + role | Direct file read | ✅ PASS |
| SC-C2 | Sheet scrim has Dismiss sheet + role | Direct file read | ✅ PASS |
| SC-C3 | TopSheet scrim has Dismiss sheet + role | Direct file read | ✅ PASS |
| SC-D1 | Each §D file verified; verdict per file | §4 §D table | ✅ PASS (5 false-pos + 3 true-gap from gate + 1 explicit add) |
| SC-D2 | CreatorStep2When:1231 explicit label | Direct file read | ✅ PASS |
| SC-E1 | Pill.tsx unchanged + NO-OP recorded | This report §4 §E | ✅ PASS |
| SC-F1 | EventCover.tsx unchanged + NO-OP recorded | This report §4 §F.1 | ✅ PASS |
| SC-F2 | scanner/index.tsx AccessibilityInfo guard | Direct file read + tsc clean | ✅ PASS |
| SC-G1 | i38 script exists + executes cleanly | `node ... ; EXIT=0` | ✅ PASS |
| SC-G2 | I-38 workflow job added | Direct file read | ✅ PASS |
| SC-G3 | I-38 fixtures verified violation→1, allowlist→0 | This report §4 §G | ✅ PASS |
| SC-H1 | i39 script exists + executes cleanly | `node ... ; EXIT=0` | ✅ PASS |
| SC-H2 | I-39 workflow job added | Direct file read | ✅ PASS |
| SC-H3 | I-39 fixtures verified violation→1, implicit→0+INFO, allowlist→0 | This report §4 §H | ✅ PASS |
| SC-I1 | README Active gates table includes I-38 + I-39 | Direct file read | ✅ PASS |
| SC-J1 | INVARIANT_REGISTRY I-38 + I-39 (DRAFT) | Direct file read | ✅ PASS |
| SC-K1 | feedback_wcag_aa_kit_invariants.md DRAFT | Direct file read | ✅ PASS |
| SC-K2 | MEMORY.md index entry | Direct file read | ✅ PASS |
| SC-PRE | tsc clean | `tsc --noEmit ; TSC=0` | ✅ PASS |

**25 of 25 SC items PASS.**

---

## 6. Invariant verification

| Invariant | Status | Verification |
|---|---|---|
| I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS | preserved (Y) | i37 gate exit 0 post-IMPL (regression check) |
| Constitutional #1 (no dead taps) | preserved (Y) | Every IconChrome interactive path now has explicit label; scrim Pressables labeled |
| Constitutional #3 (no silent failures) | preserved + reinforced (Y) | Removed `?? icon` silent fallback (subtraction). New code has no fallback paths to fail silently |
| Constitutional #8 (subtract before adding) | followed (Y) | §A removed `?? icon` BEFORE adding required prop. §B added explicit labels AFTER subtraction. |
| I-38 ICONCHROME-TOUCH-TARGET-AA-COMPLIANT | NEW (DRAFT) | Pre-written per SPEC §J.1; flips ACTIVE at CLOSE |
| I-39 INTERACTIVE-PRESSABLE-ACCESSIBILITY-LABEL | NEW (DRAFT) | Pre-written per SPEC §J.2; flips ACTIVE at CLOSE |

---

## 7. Parity check

- **Solo/collab modes:** N/A — Cycle 17c is platform-wide accessibility; no mode boundary
- **mobile/admin parity:** Out of scope per SPEC non-goals (mingla-admin a11y is a separate cycle)
- **iOS/Android parity:** Reduce-motion subscribe pattern uses `AccessibilityInfo.addEventListener('reduceMotionChanged', ...)` which works on both platforms. iOS VoiceOver + Android TalkBack both honor `accessibilityLabel` + `accessibilityRole`. **Operator must live-fire test on both platforms (per D-17c-6 + IMPL §6)**.

---

## 8. Cache safety

No query keys, no hooks, no React Query, no Zustand changes. **No cache impact.**

---

## 9. Regression surface (5 adjacent features tester should check)

1. **TopBar** (3 IconChromes — search, bell, back) — verify still tappable, labels announce
2. **BottomNav** (5 tabs) — already labeled per `tab.label`; no regression possible
3. **Modal/Sheet/TopSheet** — verify dismiss-by-scrim-tap still works (no behavior change, just label/role added)
4. **Scanner overlay fade** — primary regression vector. Verify in BOTH reduce-motion-OFF (250ms fade) and reduce-motion-ON (instant) states
5. **CreatorStep1Basics + CreatorStep2When sheet pickers** — added explicit labels to row Pressables; verify selection still triggers

---

## 10. Constitutional compliance

| Rule | Touched? | Compliant? |
|---|---|---|
| #1 No dead taps | YES | ✅ Strengthened (explicit labels reinforce intent) |
| #2 One owner per truth | NO | N/A |
| #3 No silent failures | YES | ✅ Strengthened (removed `?? icon` silent fallback) |
| #4 One query key per entity | NO | N/A |
| #5 Server state server-side | NO | N/A |
| #6 Logout clears everything | NO | N/A |
| #7 Label temporary | NO | No new TRANSITIONAL items |
| #8 Subtract before adding | YES | ✅ §A removed fallback before §B added explicit labels |
| #9 No fabricated data | NO | N/A |
| #10 Currency-aware | NO | N/A |
| #11 One auth instance | NO | N/A |
| #12 Validate at right time | NO | N/A |
| #13 Exclusion consistency | NO | N/A |
| #14 Persisted-state startup | NO | N/A |

No violations introduced. Two rules (#3, #8) materially strengthened.

---

## 11. CI gate verification matrix (final)

| Gate | Command | Result | Files scanned | Violations |
|---|---|---|---|---|
| I-37 (existing) | `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` | exit 0 | 119 | 0 |
| I-38 (NEW) | `node .github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` | exit 0 | 119 | 0 |
| I-39 (NEW) | `node .github/scripts/strict-grep/i39-pressable-label.mjs` | exit 0 | 119 | 0 (0 INFO implicit-Text fallbacks) |

**All 3 gates green against final code state.** I-37 regression check: PASS.

---

## 12. Discoveries for orchestrator

- **D-CYCLE17C-IMPL-1** — SPEC §G.3 had a math error: per-side `size + slop_side` returns 40 for kit default 36+4, not 44. Correct math is `width = size + slop.left + slop.right` and `height = size + slop.top + slop.bottom`. Implementor caught + fixed during gate authoring; documented in this report §4 §G as "Spec interpretation correction." Future SPECs touching dimensional math should specify total dimension formulas, not per-side extents.

- **D-CYCLE17C-IMPL-2** — §B consumer migration was a major scope reduction: SPEC §B.2 enumerated 28 files needing potential explicit-label additions. Reality: only 5 styleguide demo fixtures needed migration (all production IconChrome consumers were already labeled by 17a/17b). The "tsc-driven enumeration" approach was the right call — saved ~1.5h vs file-by-file SPEC reading.

- **D-CYCLE17C-IMPL-3** — §D scan was 5/8 false positives. Sub-agent in forensics over-flagged P2 candidates without verifying. The I-39 gate caught the 3 ACTUAL violations (PaymentElementStub:277, 294 + CreatorStep1Basics:224) the §D scan missed entirely. Conclusion: gates are more authoritative than sub-agent label-coverage scans. Future audits should run gates first, file-list second.

- **D-CYCLE17C-IMPL-4** — `mingla-business/src/components/event/CreatorStep1Basics.tsx:224` was NOT in forensics §B.3 nor SPEC §D.1, but I-39 gate flagged it. Category-picker preset selector with no explicit label. Fixed in this IMPL with `accessibilityLabel={cat}`. Validates the gate's catch-real-bugs design.

- **D-CYCLE17C-IMPL-5** — `mingla-business/src/components/checkout/PaymentElementStub.tsx:277, 294` (dev __DEV__ test toggles) were in forensics §B.3 as false positives but actually had no `accessibilityLabel=`. The §D verification scan misread them. Implementor verified via direct read + I-39 gate confirmed violation, fixed inline. Re-confirms D-CYCLE17C-IMPL-3.

---

## 13. Test first — what tester / operator must manually verify

**Highest priority (operator-side live-fire per D-17c-6, mandatory pre-CLOSE):**

1. iOS Settings → Accessibility → VoiceOver ON. Tap each TopBar icon (search, bell, back) → verify announcement matches "Search, button" / "Notifications, button" / "Back, button".
2. Open any modal (e.g., from BottomNav account menu). VoiceOver-focus the dim backdrop → verify "Dismiss modal, button" announces.
3. Open any sheet (e.g., event detail). Same focus on backdrop → verify "Dismiss sheet, button".
4. iOS Settings → Accessibility → Reduce Motion ON. Open scanner. Trigger a scan or test pattern → verify result overlay snaps in INSTANTLY (no 250ms fade).
5. Repeat 1-3 on Android with TalkBack (if device available).

**Tester-side (regression):**

- Confirm IconChrome buttons still visually 36×36 (no size change)
- Confirm tap responsiveness improved at edges (44 effective, was 36)
- Confirm scanner reduce-motion-OFF state still has 250ms fade

---

## 14. Operator-side checklist (pre-CLOSE)

### 14.1 Live-fire (mandatory, per D-17c-6)

- [ ] iOS device: VoiceOver smoke on home / events / event detail / brand profile / account
- [ ] iOS device: Reduce Motion ON → scanner overlay snap test
- [ ] Android device (if available): TalkBack smoke on same 5 surfaces
- [ ] Android device (if available): Reduce Motion ON → scanner snap test

### 14.2 Commit message draft

```
feat(business): Cycle 17c — WCAG AA kit-wide remediation (I-38 + I-39)

- IconChrome: bake default hitSlop={top:4,bottom:4,left:4,right:4} → effective 44×44 touch (visual unchanged at 36×36)
- IconChrome: accessibilityLabel now TypeScript-required; remove ?? icon silent fallback
- ~10 explicit screen-reader labels added (3 scrim Pressables in Modal/Sheet/TopSheet + 7 P2 gaps in dev/checkout/event surfaces)
- scanner/index.tsx: wire AccessibilityInfo.isReduceMotionEnabled() guard around Animated.timing
- New CI gates: I-38 IconChrome touch-target + I-39 Pressable accessibilityLabel coverage
- INVARIANT_REGISTRY: I-38 + I-39 entries (DRAFT → ACTIVE on this CLOSE)
- New memory: feedback_wcag_aa_kit_invariants.md (DRAFT → ACTIVE on this CLOSE)

Visual UI unchanged. tsc clean. 3 CI gates green (i37 + i38 + i39).
ORCH-IDs closed: D-CYCLE17A-IMPL-5, D-CYCLE17B-QA-5, D-17c-1..D-17c-9.
DEC-103 (or DEC-104 pending ORCH-0733).
```

### 14.3 EAS dual-platform OTA (per `feedback_eas_update_no_web` — two separate commands)

```bash
cd mingla-business && eas update --branch production --platform ios --message "Cycle 17c WCAG AA kit-wide remediation"
cd mingla-business && eas update --branch production --platform android --message "Cycle 17c WCAG AA kit-wide remediation"
```

### 14.4 CLOSE protocol reminders (per `feedback_post_pass_protocol`)

- Update all 7 close-protocol artifacts (WORLD_MAP, MASTER_BUG_LIST, COVERAGE_MAP, PRODUCT_SNAPSHOT, PRIORITY_BOARD, AGENT_HANDOFFS, OPEN_INVESTIGATIONS)
- Flip I-38 + I-39 invariant statuses DRAFT → ACTIVE
- Flip `feedback_wcag_aa_kit_invariants.md` status DRAFT → ACTIVE (at CLOSE date)
- Author DEC-103 (or DEC-104 if ORCH-0733 closes first) entry in DECISION_LOG.md with the 9 D-17c-N decisions batched

---

## 15. Files changed summary

| File | Change | Lines |
|---|---|---|
| `mingla-business/src/components/ui/IconChrome.tsx` | MOD (primitive) | +20 / -3 |
| `mingla-business/app/__styleguide.tsx` | MOD (5 dev fixtures) | +5 / -5 |
| `mingla-business/src/components/ui/Modal.tsx` | MOD (scrim) | +4 |
| `mingla-business/src/components/ui/Sheet.tsx` | MOD (scrim) | +4 |
| `mingla-business/src/components/ui/TopSheet.tsx` | MOD (scrim) | +4 |
| `mingla-business/app/checkout/[eventId]/payment.tsx` | MOD (dev toggles) | +2 |
| `mingla-business/src/components/checkout/PaymentElementStub.tsx` | MOD (dev toggles) | +2 |
| `mingla-business/src/components/event/CreatorStep1Basics.tsx` | MOD (preset row) | +1 |
| `mingla-business/src/components/event/CreatorStep2When.tsx` | MOD (preset row) | +1 |
| `mingla-business/app/event/[id]/scanner/index.tsx` | MOD (motion guard) | +28 / -5 |
| `.github/scripts/strict-grep/i38-icon-chrome-touch-target.mjs` | NEW | +225 |
| `.github/scripts/strict-grep/i39-pressable-label.mjs` | NEW | +205 |
| `.github/scripts/strict-grep/README.md` | MOD (registry) | +6 |
| `.github/workflows/strict-grep-mingla-business.yml` | MOD (2 jobs) | +26 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | MOD (I-38 + I-39 entries DRAFT) | +44 |
| `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_wcag_aa_kit_invariants.md` | NEW (DRAFT) | +50 |
| `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md` | MOD (index entry) | +4 |

**Net:** +630 / -13 across 17 files (10 production code, 4 CI/build, 3 documentation). Two new .mjs scripts. Two new invariant entries. One new memory file.

---

**End of implementation report.**
