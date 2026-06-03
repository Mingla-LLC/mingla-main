# QA — ORCH-1057 · Ari composer + header icons + empty-state polish

**Surface:** Mingla **Business** app · Ari assistant (React Native / Expo · iOS + Android + web)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1057-[ari-composer-icons-polish]/` · branch `ORCH-1057-ari-composer-icons-polish`
**Fix commit:** `d47fa278c30cb943fe075871e9c4746ee3e310e3` · **Baseline:** `e944b0b20`
**QA adversarial-test commit:** `53f4dc40d`
**Mode:** TARGETED (UI polish, 3 small surfaces)
**Spec:** `Mingla_Artifacts/specs/DESIGN_ORCH-1057_ARI_COMPOSER_ICONS_EMPTYSTATE.md` (Direction A1 "Ember Send", operator-locked)
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1057_ARI_COMPOSER_ICONS_EMPTYSTATE.md`

---

## VERDICT: CONDITIONAL PASS

**Conditions (exactly two, both pre-agreed deferrals — not fixable blockers):**

1. **On-device VISUAL repro is CONDITIONAL pending Seth's next native Business build.** The current Business dev-sim binary red-boxes at launch on the ORCH-0978 `react-native-video-trim` `VideoTrim` TurboModule (predates the native module; needs a full native rebuild per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`). Per the TEST dispatch's explicit instruction, I did NOT burn the phase on a 30-min native rebuild for UI polish. The iOS-glow / Android-opaque-shadow / reduced-motion behaviors are verified at the **code level** (`proven` by source + bundle, see §4) and on the **web runtime surface** (`proven` by compiled bundle, see §5). On-device visual confirmation rides Seth's already-planned ORCH-0977 launch build.
2. **The 18 unmerged (`UU`) index entries in `app-mobile/` + `packages/` + `COMMS_LEDGER.md` are NOT ORCH-1057** — they are stray/conflicted index state bleeding in from a parallel session via the shared object store. I left them untouched (shared-anchor-hazard discipline). My adversarial-test commit used `git commit --only <file>` so it touched **only** the one test file. Flagged for orchestrator (§9 D-2) — this worktree's index needs a clean-up by whoever owns the `app-mobile`/ORCH-1016 work before the closing PR.

No open P0. No open P1. The conditions are deferrals, not defects.

---

## 1. Severity tally

| Severity | Count | Items |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 1 | D-1 (pre-existing): Business sim binary red-boxes on `VideoTrim` — blocks on-device visual until native rebuild (carried from implementation report; not introduced by ORCH-1057) |
| P3 | 0 | — |
| P4 | 2 | Clean Android opaque-glass implementation (textbook `ANDROID_GLASS_USES_OPAQUE_FALLBACK`); tightly-scoped diff (zero scope creep, hard guards honored) |

---

## 2. Three locked changes — verification

### Item A — Send button "Ember Send" — PASS (code + web)
`InputBar.tsx` lines 131–171 + styles 198–226.
- **lucide `ArrowUp`** `size={20} color="#ffffff" strokeWidth={2.5}` over an `react-native-svg <RadialGradient>` (flame `#e69869` top → ember `#c66c54` bottom), 38×38 circle (`borderRadius 19`). Old CSS-border-triangle (`sendArrow` / `borderBottomColor`) fully removed. ✓
- **Enabled lights warm / disabled dims:** `canSend = text.trim().length > 0 && !disabled`; disabled applies `btnDisabled` (opacity 0.4) + `accessibilityState={{ disabled: !canSend }}` + `disabled={!canSend}`. ✓
- **Micro-interaction GATED behind `useReducedMotion()`:** `const reduceMotion = useReducedMotion()`; `if (reduceMotion)` → opacity-only `withTiming` dim/restore; `else` → `withSpring(1,{damping:14,stiffness:220,mass:0.7})` + (iOS-only) `glowOpacity` `withSequence` pulse. Adversarial ADV-5 proves the glow pulse lives ONLY in the non-reduced branch. ✓
- **CRITICAL Android opaque-glass check (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`):** `sendBtn` style uses `Platform.select`: iOS branch = `shadowColor/Offset/Opacity/Radius` only; **`default` (Android) branch = `overflow:'hidden'` ONLY — no shadow*, no elevation.** SVG fill is **fully opaque** (both `<Stop>` `stopOpacity="1"`, circle `r=50` fills the whole 100-viewbox). Codebase-wide `androidSafeElevation()` forces Android elevation to 0. **No rectangular shadow/elevation artifact is possible under the rounded fill on Android.** Adversarial ADV-2 (no `elevation:` anywhere) + ADV-3 (opaque fill, no translucent rgba/hsla on the circle) lock this. ✓

### Item B — Header icons Unicode → lucide — PASS (code + web)
`AriChatScreen.tsx` line 1 import + lines 140, 152.
- `import { Menu, Settings } from "lucide-react-native"`. ✓
- `<Menu size={24} color={textTokens.primary} strokeWidth={2} />` (left, opens ConversationDrawer); `<Settings size={22} color={textTokens.primary} strokeWidth={2} />` (right, `/ari/settings`). ✓
- **44×44 tap targets + a11y labels preserved verbatim:** `styles.iconBtn` 44×44 unchanged; `accessibilityLabel="Show conversations"` / `"Open Ari settings"` + `accessibilityRole="button"` + `pressed && styles.pressed` all intact. ✓
- **Old `iconText` Unicode-glyph style GONE:** diff confirms the `iconText` style block (fontSize 22) was deleted; `≡`/`⚙` no longer in source. ✓

### Item C — Empty state polish — PASS (code + web)
`EmptyState.tsx` (now `React.FC`, no props).
- **No QuickReplyChips / chip wall:** `QuickReplyChips` import, `EXAMPLES` array, `chipsWrap` View/style, `onChipSelect` prop, and `EmptyStateProps` interface all deleted. ✓
- **Orb + headline + body + single non-tappable hint:** `AriOrb size="lg" thinking` + "Hi, I'm Ari." + body + a `hintRow` = `<Plus size={14} color={textTokens.tertiary} strokeWidth={2} />` + caption "Tap + for things to try" (`typography.caption`, `textTokens.tertiary`). It is NOT a `Pressable`, has no `onPress`, no `accessibilityRole="button"` — a pointer, not an action. Adversarial ADV-6 locks the low-emphasis `tertiary` hierarchy token (not primary/secondary). ✓
- **`+`-triggered `suggestionsPanel` UNTOUCHED:** `AriChatScreen.tsx` lines 197–212 byte-identical to baseline; the 3 example strings ("Create a brand called Sample Events" / "What events do I have this week?" / "Help me schedule a Friday event") unchanged (adversarial ADV-7). `QuickReplyChips` component itself untouched (still imported + used by the panel). ✓
- **NO screen-shift fix attempted:** `AriChatScreen.tsx` diff is ONLY the import + 2 icon swaps + the `<EmptyState />` call-site + the dead-style removal. `BOTTOM_NAV_CLEARANCE_PX`, `keyboardHeight` padding logic, `<ConversationDrawer>` mount, and any Sheet/SheetMobile wrapper are all unchanged (adversarial ADV-7b). The investigation's screen-shift NREP stayed out of scope per operator decision. ✓

---

## 3. Spec-compliance matrix

| Spec criterion | Result | Evidence |
|---|---|---|
| A: ArrowUp, warm flame→ember radial, white strokeWidth 2.5 | PASS | InputBar:163-169 |
| A: iOS-only glow; Android opaque + overflow:hidden + no elevation | PASS | InputBar:204-219; ADV-2/ADV-3 |
| A: send micro-interaction gated by useReducedMotion | PASS | InputBar:56,75-93; ADV-5 |
| A: enabled/disabled (canSend) | PASS | InputBar:58,133,139,143 |
| A: hitSlop ≥44pt effective | PASS | InputBar:140 |
| B: Menu(24)+Settings(22), primary, strokeWidth 2, 44×44 + labels | PASS | AriChatScreen:140,152; iconBtn 44×44 |
| B: iconText dead style removed | PASS | diff removes lines 256-261 |
| C: chip wall / EXAMPLES / onChipSelect / chipsWrap removed | PASS | EmptyState full file |
| C: orb + headline + body + single Plus hint, non-tappable | PASS | EmptyState:22-36; ADV-6 |
| C: call site `<EmptyState />` | PASS | AriChatScreen:170 |
| Hard guard: suggestionsPanel untouched | PASS | AriChatScreen:197-212; ADV-7 |
| Hard guard: no screen-shift fix | PASS | diff scope; ADV-7b |
| Hard guard: no new deps | PASS | all deps pre-installed (package.json) |

Zero scope creep. Zero unimplemented criteria.

---

## 4. Code-level confidence (iOS glow + Android opaque + reduced-motion) — `proven` at source

- **Android opaque-glass:** `sendBtn` `Platform.select` `default` branch carries only `overflow:'hidden'`; no `shadow*`, no `elevation` anywhere in the file (ADV-2). SVG radial both stops `stopOpacity=1`, circle fills viewbox; no translucent fill on the circle (ADV-3). `designSystem.ts:26` `androidSafeElevation()` returns 0 on Android program-wide. → No rectangular artifact under the rounded fill. **PASS.**
- **iOS glow:** iOS-only `shadowColor: ariPalette.ember` base 0.4; `useAnimatedStyle` applies `shadowOpacity: glowOpacity.value` ONLY when `Platform.OS==='ios'`; pulse `0.4→0.7→0.4` lives in the non-reduced `else` path (ADV-5). **PASS.**
- **Reduced-motion gate:** `useReducedMotion()` → reduced path is opacity-only dim/restore, no spring, no glow. **PASS.**

## 5. Web-surface runtime evidence — `proven`

`npx expo export -p web --clear --output-dir web-build-orch1057` → **exit 0**, real **8.82 MB** web bundle (`_expo/static/js/web/index-*.js`), NOT a degenerate "No routes found" empty export. Then grepped the compiled bundle:

- **ORCH-1057 UI strings present:** "Tap + for things to try" (×1), "Send message to Ari", "Show conversations", "Open Ari settings", "Ask Ari", "Hi, I", "Create a brand called Sample Events" — all FOUND.
- **lucide on web (react-native-web → react-native-svg):** `createLucideIcon` factory FOUND; component names `ArrowUp` (×29), `Menu` (×31), `Settings` (×28), `Plus` (×65) FOUND; the literal lucide **arrow-up SVG path data `m5 12 7-7 7 7` FOUND** in the bundle; SVG web namespace `http://www.w3.org/2000/svg` ×16. → The send ArrowUp + header Menu/Settings + empty-state Plus all render as real SVG on web.

(web-build artifact deleted post-verification; not left in worktree.)

**Platform legs:** Web — `proven` (bundle export + string/icon-path grep). iOS / Android device visual — CONDITIONAL (sim build blocked by ORCH-0978 `VideoTrim`; code-level + web `proven`; on-device deferred to Seth's planned ORCH-0977 native build per dispatch instruction).

---

## 6. Regression tests

| Test | Path | Result |
|---|---|---|
| Implementor (happy-path) | `mingla-business/src/components/ari/__tests__/orch_1057_ari_composer_icons_emptystate.test.ts` | 16/16 PASS · committed in `d47fa278c` · fails-on-revert verified by implementor (12/16 fail @ `e944b0b20`) |
| **Tester (adversarial)** | `mingla-business/src/components/ari/__tests__/orch_1057_ari_composer_icons_emptystate.adversarial.test.ts` | **9/9 PASS** · committed in `53f4dc40d` · **fails-on-revert VERIFIED (4/9 fail when 3 source files checked out @ `e944b0b20`: ADV-3 opaque-fill, ADV-5 reduced-motion glow gating, ADV-6 hint hierarchy, ADV-8 ArrowUp glyph)** |

**Adversarial angle (different from implementor's happy-path):** the implementor asserts "the new thing is present." My test attacks **invariants + boundary/negative cases**: opaque-fill invariant (stops opacity 1, no translucent circle fill), no-elevation-in-either-branch, canSend-gated press feedback (no dead-tap dim on disabled), reduced-motion glow exclusion, wrong-package guard (`lucide-react` web pkg banned), hint hierarchy token must be `tertiary` not primary/secondary, send-glyph-direction invariant (ArrowUp not Send/SendHorizontal), and suggestions-content byte-stability. Not a renamed copy of the happy-path test.

Both tests appear in `git diff main...HEAD --name-only`. ✓

---

## 7. Verification matrix (captured output)

| Check | Result |
|---|---|
| `tsc --noEmit` (touched ari files) | PASS — 0 errors in `ari/InputBar`, `ari/EmptyState`, `screens/ari/AriChatScreen`, the test files (repo-wide pre-existing baseline errors are in unrelated files, not touched here) |
| `eslint` (3 source files + both tests) | PASS — exit 0 |
| Implementor jest (happy-path) | PASS 16/16 |
| Tester jest (adversarial) | PASS 9/9 |
| Both ORCH-1057 suites together | PASS 25/25 (2 suites) |
| Adversarial fails-on-revert @ baseline | VERIFIED — 4/9 flip red on `e944b0b20` source |
| Web export | exit 0, 8.82 MB bundle, all strings + lucide icons present |

The broad `jest ari` substring run matched the whole suite (287 suites; 62 pre-existing baseline failures in unrelated areas e.g. `PublicBrandPage.ve4`). **The only ari-touching suite is the ORCH-1057 test, which PASSES** — no failing suite references InputBar/EmptyState/AriChatScreen.

---

## 8. Constitution (14 rules)

All N/A or PASS for this pure-presentational UI change. Highlights:
- R1 (no dead taps): PASS — send/header buttons all respond; hint is intentionally non-interactive (static text, by design).
- R3 (no silent failures): PASS — send errors still surface via screen-level `Toast` (unchanged ownership); `Haptics.impactAsync(...).catch(()=>undefined)` only swallows a haptic no-op, not a user-facing error.
- R9 (no fabricated data): PASS — no data layer touched.
- R2/R4/R5/R6/R11/R12/R13/R14: N/A — no state, cache, auth, currency, datetime, or persisted-state surface touched.

---

## 9. Discoveries for orchestrator

- **D-1 (P2, pre-existing, carried from implementation report):** Business dev-sim binaries predate `react-native-video-trim` (ORCH-0978) → red-box at boot on `getEnforcing('VideoTrim')`. On-device visual QA for any Business UI needs a fresh native rebuild. Web + jest + code-level done here; on-device visual rides Seth's planned ORCH-0977 launch build.
- **D-2 (process, P2):** This worktree has **18 unmerged (`UU`) index entries** in `app-mobile/` (ExpandedCardModal, ExpandedBusinessEventSheet, TicketCartSheet, ConsumerTripDetailScreen + its ORCH-1016 test), `packages/brand-rendering/PublicBrandPage.tsx`, and `COMMS_LEDGER.md` — none belong to ORCH-1057. They appear to be stray/conflicted index state from a parallel session (likely ORCH-1016) bleeding through the shared git object store. I left them untouched and committed my test with `git commit --only <file>`. **Whoever owns that work must resolve this worktree's index before the ORCH-1057 closing PR is built** (the conflicts will otherwise block a clean PR diff). No ORCH-1057 source was affected.
- No unrelated bugs in the touched files; no scope expansion.

---

## 10. /goal completion check

1. Every independent test green — 25/25 captured (§6, §7). ✓
2. `tsc --noEmit` + lint clean on touched files — captured (§7). ✓ (repo-wide pre-existing errors are not in touched files.)
3. Both regression tests in `git diff main...HEAD --name-only`; adversarial attacks a different angle; implementor fails-on-revert @ `e944b0b20` cited. ✓
4. UI/runtime legs: **web `proven`** (bundle); **iOS/Android device visual CONDITIONAL** — sim build blocked by ORCH-0978 `VideoTrim` (an env blocker explicitly carved out of this UI-polish phase by the dispatch), code-level + web behaviors `proven`. The blocker is a known native-rebuild deferral Seth has already planned (ORCH-0977), not a fixable-in-this-phase Metro/cache issue.
5. Zero open P0, zero open P1. ✓

Clauses 1, 2, 3, 5 fully met. Clause 4 met on web + code level; device-visual is the named, pre-agreed deferral → **CONDITIONAL PASS** (not a shortcut around a fixable blocker).
