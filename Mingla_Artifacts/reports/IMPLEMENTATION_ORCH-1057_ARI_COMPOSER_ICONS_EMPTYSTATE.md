# IMPLEMENTATION — ORCH-1057 · Ari composer + header icons + empty-state polish

**Surface:** Mingla **Business** app · Ari assistant (React Native / Expo · iOS + Android + web)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1057-[ari-composer-icons-polish]/` · branch `ORCH-1057-ari-composer-icons-polish`
**Baseline (pre-fix HEAD):** `e944b0b202e08145bac81ca125b60d45ad8cf915` (== `main` at implement time)
**Spec:** `Mingla_Artifacts/specs/DESIGN_ORCH-1057_ARI_COMPOSER_ICONS_EMPTYSTATE.md` (Direction A1 "Ember Send" recommended + operator-locked)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1057_ARI_SHEET_SCREEN_SHIFT.md` (screen-shift NREP — explicitly SKIPPED per operator decision)
**Status:** implemented and verified (web/jest + typecheck + lint). Cross-platform device QA deferred to tester (Business sim build blocked by ORCH-0978 `VideoTrim` native module — see Discoveries).

---

## 1. What was built (operator-locked decisions)

### Item A — Send button: "Ember Send" (Direction A1)
`InputBar.tsx` send button rebuilt: lucide `ArrowUp` (white, `strokeWidth={2.5}`, size 20) on a 38×38 circle filled with a `react-native-svg` `<RadialGradient>` (flame `#e69869` top → ember `#c66c54` bottom), echoing `AriOrb`'s warm radial. iOS-only ember glow via the button's own `shadowColor: ariPalette.ember` (animated `shadowOpacity` 0.4→0.7→0.4 on send); Android takes the opaque-glass branch (`overflow:'hidden'` to clip the SVG fill, NO shadow/elevation) per `ANDROID_GLASS_USES_OPAQUE_FALLBACK`. Send-moment micro-interaction (scale `1→0.92→spring 1`, iOS glow pulse) is GATED behind `useReducedMotion()` — reduced motion path does an opacity-only dim/restore. `Haptics.impactAsync(Light)` fires on send (expo-haptics already installed). `hitSlop` of 6 on all sides reaches the ≥44pt effective target. Disabled state (`canSend === false`) keeps the 0.4-opacity `btnDisabled` token, no glow/press feedback, `accessibilityState={{ disabled: !canSend }}`.

### Item B — Header icons: Unicode → lucide
`AriChatScreen.tsx` header: `<Text>≡</Text>` → `<Menu size={24} color={textTokens.primary} strokeWidth={2} />`; `<Text>⚙</Text>` → `<Settings size={22} color={textTokens.primary} strokeWidth={2} />`. The 44×44 `iconBtn` tap targets, `accessibilityLabel`s ("Show conversations" / "Open Ari settings"), and the `pressed && styles.pressed` feedback are all preserved verbatim. The now-dead `styles.iconText` block was removed.

### Item C — Empty state: chip wall removed, first-run protected
`EmptyState.tsx`: deleted the `QuickReplyChips` import, the `EXAMPLES` array, the `onChipSelect` prop, the `EmptyStateProps` interface, and the `chipsWrap` View/style. Kept the orb + "Hi, I'm Ari." headline + body. Added the single non-tappable hint row: `<Plus size={14} color={textTokens.tertiary} strokeWidth={2} />` + caption "Tap + for things to try" (`typography.caption`, `textTokens.tertiary`), centered, `marginTop: spacing.xl`, `gap: spacing.xs`. It is NOT a `Pressable` (a pointer, not an action). Call site `AriChatScreen.tsx` updated to `<EmptyState />` (no props).

---

## 2. Old → New receipts

### `mingla-business/src/components/ari/InputBar.tsx` (~+90 lines net)
- **Before:** 36×36 circle, flat `ariPalette.flame` fill, send mark = CSS-border triangle (`sendArrow` style, `borderBottomColor:'#fff'`). iOS-and-Android flame shadow (Android draws a rectangle). Disabled = opacity 0.4; pressed = opacity 0.8. No hitSlop. No motion.
- **After:** 38×38 circle, SVG `<RadialGradient>` flame→ember fill, lucide `ArrowUp` glyph. iOS-only ember glow with animated `shadowOpacity` pulse; Android opaque + `overflow:'hidden'` + no shadow. `useReducedMotion()`-gated scale spring + glow flicker on send; reduced-motion = opacity dim/restore. `expo-haptics` light impact on send. `hitSlop` 6 all sides. Disabled unchanged (0.4 token).
- **Why:** Spec Item A / Direction A1 (operator-locked). Fixes the real 2.55:1 white-on-flame contrast failure (now 3.5:1 on ember). Removes the generic CSS-triangle mark.

### `mingla-business/src/screens/ari/AriChatScreen.tsx` (~+1 import, −4 style lines, 3 swaps)
- **Before:** header buttons rendered `<Text style={styles.iconText}>≡</Text>` and `…⚙`; `iconText` style present; `<EmptyState onChipSelect={handleSend} />`.
- **After:** `import { Menu, Settings } from "lucide-react-native";`; `<Menu size={24} …/>` and `<Settings size={22} …/>`; `iconText` style removed; `<EmptyState />` (no props).
- **Why:** Spec Item B + Item C call-site cleanup. `handleSend` still used by the suggestionsPanel + InputBar — no dead code. `suggestionsPanel` (lines ~196-211) and the `QuickReplyChips` import (still used there) UNTOUCHED per hard guard.

### `mingla-business/src/components/ari/EmptyState.tsx` (~−15 lines net)
- **Before:** orb + headline + body + `chipsWrap` with `QuickReplyChips` over a hardcoded `EXAMPLES` array; `onChipSelect` prop + `EmptyStateProps` interface.
- **After:** orb + headline + body + single `Plus`-icon hint row. No chips, no EXAMPLES, no props (`React.FC`).
- **Why:** Spec Item C (operator-locked). Removes the duplicate of the `+` suggestions entry point while keeping one quiet first-run nudge so a new user is not stranded.

---

## 3. Spec traceability

| Criterion | Status | Evidence |
|---|---|---|
| A — ArrowUp glyph, warm flame→ember fill, white strokeWidth 2.5 | PASS | InputBar `<ArrowUp size={20} color="#ffffff" strokeWidth={2.5}/>` over `<RadialGradient>` flame→ember |
| A — iOS-only glow, send-moment micro-interaction gated by useReducedMotion | PASS | iOS `shadow*` only; `if (reduceMotion)` opacity path vs `withSpring` + glow pulse |
| A — Android opaque-glass policy (opaque fill, overflow:hidden, no elevation) | PASS | `Platform.select` default branch = `overflow:'hidden'`, no shadow/elevation; SVG fill opaque by construction |
| A — enabled + disabled (canSend=false) states | PASS | `disabled={!canSend}`, `btnDisabled` 0.4, `accessibilityState` |
| B — Menu (24) + Settings (22), textTokens.primary, strokeWidth 2 | PASS | Both lucide renders present; 44×44 + a11y labels preserved; `iconText` removed |
| C — remove QuickReplyChips import / EXAMPLES / onChipSelect / chipsWrap | PASS | All deleted; `EmptyState` is `React.FC` with no props |
| C — keep orb + headline + body, add Plus hint row | PASS | hint row `<Plus size={14}…/>` + "Tap + for things to try" |
| C — call site `<EmptyState />` | PASS | AriChatScreen line ~168 |
| Hard guard — suggestionsPanel untouched | PASS | lines ~196-211 byte-identical; `QuickReplyChips` import retained in AriChatScreen |
| Hard guard — no screen-shift fix | PASS | No Sheet/SheetMobile/ConversationDrawer/keyboard-padding edits |
| Hard guard — no new deps | PASS | Only already-installed lucide-react-native / react-native-svg / react-native-reanimated / expo-haptics used |

---

## 4. Regression test

- **Path:** `mingla-business/src/components/ari/__tests__/orch_1057_ari_composer_icons_emptystate.test.ts`
- **Pattern:** ts-jest, `testEnvironment: node`, source/structure assertions — the established mingla-business CI pattern (the jest config has no RN render preset; component "tests" in this repo are source/diff assertions, e.g. `metaOrch1002SubDBusinessGlass`). 16 assertions across the 3 items + the suggestionsPanel hard guard.
- **Passing run (on fix):** `Test Suites: 1 passed`, `Tests: 16 passed, 16 total`.
- **Fails-on-revert:** verified at baseline commit `e944b0b202e08145bac81ca125b60d45ad8cf915` — `git stash`-reverting the three source files (test kept) → `Tests: 12 failed, 4 passed` (the 4 surviving are negative/guard assertions true on both versions; all 12 substantive ORCH-1057 assertions flip red). Fix restored via `git stash pop` → 16/16 green again.

---

## 5. Verification matrix

| Check | Result |
|---|---|
| `tsc --noEmit` on scoped Ari files | PASS (0 errors in `ari/` + `screens/ari/`). The 210 repo-wide errors are pre-existing baseline noise in unrelated files (home.tsx, checkout buyer, marketing ComposerV2, `@mingla/payments-native` + `packages/phone-input` worktree-symlink module resolution) — none in touched files. |
| `eslint` on 3 source files + test | PASS (exit 0, no output) |
| jest regression test | PASS 16/16 |
| fails-on-revert | VERIFIED @ `e944b0b20` (12/16 fail) |

---

## 6. Cross-surface impact (Step 3.5)

| Surface | Affected? | What changes / why not |
|---|---|---|
| Consumer iOS / Android (`app-mobile`) | NO | Ari lives only in `mingla-business`; no consumer analog |
| Buyer/anon Web | NO | Anon routes don't render the Ari chat screen |
| Business iOS | YES | Send button material/motion, lucide header icons, empty-state hint — shared RN code path (automatic parity) |
| Business Android | YES | Same shared code; Android opaque-glass branch verified in source (no shadow, overflow:hidden) |
| Business Web preview | YES | lucide-react-native renders on web via react-native-web; SVG radial + Reanimated supported. Shared code path |
| Admin Web | NO | No Ari surface |

Parity is **automatic** (single shared component per surface) — no manual cross-path drift.

---

## 7. Invariant / constitution / cache checks

- **ANDROID_GLASS_USES_OPAQUE_FALLBACK:** PASS — Android send button uses opaque SVG fill + `overflow:'hidden'` + no elevation/shadow; no translucent Android fill introduced.
- **No new dependency invariant:** PASS — zero new deps.
- **Cache safety / React Query / Zustand:** N/A — pure presentational UI, no data layer touched.
- **Error/empty/loading states:** unchanged ownership (send errors still surface via screen-level `Toast`; empty state IS the pre-content surface).
- **Append-only test CI:** N/A — net-new test file, no existing test modified.

---

## 8. Regression surface (for tester)
1. Send button enabled→disabled transition as input text changes (canSend).
2. Send-moment animation under reduced-motion ON vs OFF (iOS Settings → Accessibility → Reduce Motion).
3. Android send button — confirm NO rectangular shadow artifact behind the circle.
4. Header icon tap targets still 44×44 and open the drawer / settings route.
5. `+` suggestions panel still opens with the 3 examples (must be unchanged).

---

## 9. Discoveries for orchestrator
- **D-1 (P2, from investigation D-1, confirmed-relevant):** Business dev-build sim binaries predate the `react-native-video-trim` native module (ORCH-0978) → app red-boxes at boot on sims with `getEnforcing('VideoTrim')`. Business sim/device QA for this ORCH needs a fresh native rebuild (per the iOS dev-build runbook) before launch. Web + jest verification was done here; full cross-platform device QA is a tester-phase item.
- **D-2 (informational):** The `metro.config.js` VideoTrim stub + harness route the investigator used were already reverted; worktree is clean of those.
- No unrelated bugs found; no scope expansion.

---

## 10. Files changed + commit
- `mingla-business/src/components/ari/InputBar.tsx`
- `mingla-business/src/screens/ari/AriChatScreen.tsx`
- `mingla-business/src/components/ari/EmptyState.tsx`
- `mingla-business/src/components/ari/__tests__/orch_1057_ari_composer_icons_emptystate.test.ts` (new)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1057_ARI_COMPOSER_ICONS_EMPTYSTATE.md` (this report)

Commit hash: see git log on branch `ORCH-1057-ari-composer-icons-polish` (recorded in the final chat message).

## 11. Deviations from spec
- **Send glow implementation:** the spec describes the iOS glow as the button's `shadowOpacity` pulsing 0.4→0.7→0.4. Implemented exactly that by animating the button's own `shadowOpacity` via a Reanimated `useAnimatedStyle` (iOS only) rather than a separate SVG glow layer — this is the spec's literal description and avoids an extra clipped SVG sibling that `overflow:'hidden'` would have killed on iOS. No visual/behavioral deviation.
- All other values built verbatim to Direction A1 + Items B/C. No other deviations.
