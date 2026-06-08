# IMPLEMENTATION — ORCH-1101 · Ari Chat Interface + Composer Overhaul

**Skill:** mingla-implementor (Claude parity) · **Date:** 2026-06-07
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1101-[ari-chat-design-overhaul]/` · branch `ORCH-1101-ari-chat-design-overhaul`
**Spec:** `Mingla_Artifacts/design/DESIGN_ORCH-1101_ARI_CHAT_INTERFACE_COMPOSER_OVERHAUL.md`
**Status:** implemented and verified (source + jest; on-device Fast-Refresh by Seth on his physical iPhone)
**Surface:** Mingla Business app only (`mingla-business`) — iOS / Android / desktop web. Phone web `/ari` is route-blocked (ORCH-1095) → out of scope, per spec §1.

---

## 0. Comms ledger

Read `COMMS_LEDGER.md` on entry. No `BLOCK`/`WARN` entry targets `implementor`, `ORCH-1101`, or `ALL`. The single relevant row (COMMS-0001) is scoped to ORCH-0955. No new cross-ORCH discovery — nothing written.

---

## 1. Commits (branch `ORCH-1101-ari-chat-design-overhaul`)

| Hash | Subject |
|---|---|
| `ab51cf104` | Bug A + Bug B composer/send fixes (InputBar, AriChatScreen, designSystem tokens) + 2 stale ORCH-1057 assertion updates |
| `859fa3f03` | Density spine + bubble/card redesign (ChatBubble, MessageList, StreamingText, ToolProposalCard, ToolEditForm, QuickReplyChips) |
| `97fe7f50f` | Four §5 presentational response components (ClarifyingCard, MultiSelectPrompt, ResponseCard new; QuickReplyChips §5.1 in prior commit) |
| `b86a20290` | Implementor regression test (fails-on-revert verified) + TEST-MOD token |

15 files changed vs `origin/main` (`129df41e1`): 1575 insertions, 151 deletions. Exactly the §7 handoff table (14 files) + the new regression test. Nothing outside scope; no edits to `useAgentChat`, `agentChatService`, `useConfirmPendingAction`, edge functions, prompts, `AiDisclosureModal`, or `ConversationDrawer`.

---

## 2. The two desktop-web bugs — exact before/after

### Bug B — send icon "blob" on web (the priority defect)

**Before** (`InputBar.tsx`, origin/main):
```tsx
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
...
<Animated.View style={[styles.sendBtn, ...]}>
  <Svg width={38} height={38} viewBox="0 0 100 100" style={styles.sendFill}>
    <Defs>
      <RadialGradient id="ari-send-fill" cx="50" cy="36" ...>
        <Stop offset="0%" stopColor={ariPalette.flame} stopOpacity="1" />
        <Stop offset="100%" stopColor={ariPalette.ember} stopOpacity="1" />
      </RadialGradient>
    </Defs>
    <Circle cx="50" cy="50" r="50" fill="url(#ari-send-fill)" />
  </Svg>
  <ArrowUp size={20} color="#ffffff" strokeWidth={2.5} />
</Animated.View>
// sendBtn 38px, no backgroundColor; sendFill: absolute SVG behind the glyph
```
Two-layer SVG-gradient-circle-behind-glyph composition; react-native-web mis-composited it into an amorphous orange blob (gradient-id collisions made it worse).

**After:**
```tsx
// react-native-svg import DELETED entirely
<Animated.View style={[styles.sendBtn, !canSend && styles.btnDisabled, sendAnimStyle]}>
  <ArrowUp size={18} color="#ffffff" strokeWidth={2.75} />
</Animated.View>
// sendBtn: width/height ariThread.sendSize (34), borderRadius 17,
//   backgroundColor ariPalette.userBubble (#a85a44), overflow:'hidden' (Android/web branch),
//   iOS-only ember shadow-glow kept (Platform.select)
```
A single `View` with a flat opaque `backgroundColor`, `borderRadius:17`, `overflow:'hidden'`, containing exactly one lucide `ArrowUp` as its only child. Renders identically on iOS/Android/web — single-path stroke glyph, no gradient, no sibling → cannot blob. White on `#a85a44` = 4.6:1 (was the old white-on-gradient-midpoint ~2.96:1). The kept `Animated.View` scale + iOS `shadowOpacity` glow + the send micro-interaction (scale 1→0.92→spring + glow pulse 0.4→0.7→0.4) + `useReducedMotion()` gate are verbatim — they were never the blob. "+" resized 32→30 to pair with the 34 send.

### Bug A — composer excess empty space at the bottom on web

**Before:** two compounding sources — (1) the web `<textarea>` kept a browser-default multi-row intrinsic height + larger line-height, parking the send button against a tall box; (2) `AriChatScreen.inputWrap.paddingBottom` was `keyboardHeight > 0 ? keyboardHeight + sm : insets.bottom + 80` — on desktop web `keyboardHeight` stays 0 and `insets.bottom` is 0, so it always reserved an 80px phantom gap (mobile floating-nav clearance that doesn't exist on the web side rail).

**After — input side (`InputBar.tsx`):**
```
input:  fontSize ariThread.bodyFont (14), lineHeight ariThread.bodyLine (19),
        paddingVertical ariThread.inputPadV (6), minHeight ariThread.inputMinH (30), maxHeight 120
host:   minHeight ariThread.composerMinH (48, was 52), paddingVertical web→6 / native→8
web:    TextInput gets rows={1} + style {height:'auto', resize:'none', overflowY:'auto'} via
        a Platform.OS==='web' spread (WEB_INPUT_PROPS), forwarded to the <textarea>
```
**After — screen side (`AriChatScreen.tsx`):**
```tsx
paddingBottom =
  Platform.OS === 'web'
    ? spacing.sm                                   // web: no nav capsule, no keyboard
    : keyboardHeight > 0
        ? keyboardHeight + spacing.sm
        : Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX   // native unchanged
```
Empty composer is exactly one line tall on every surface; the phantom 80px is gone on web; native is byte-for-byte unchanged (`BOTTOM_NAV_CLEARANCE_PX` retained).

---

## 3. Old → New receipts (per file)

### designSystem.ts (+42)
- **Before:** `ariPalette` had no legible primary; no Ari thread token block.
- **Now:** adds `ariPalette.userBubble = "hsl(10, 55%, 42%)"` (#a85a44, 4.6:1 on white) + the additive `ariThread` const block (gap/padding/radius/font/composer/send/chip/ribbon tokens + `ariBubbleAndroid` opaque equivalent). No existing token edited.
- **Why:** spec §7 token block — every downstream Ari value resolves here (zero magic numbers).

### InputBar.tsx (~103 changed)
- **Before/Now:** see §2 (Bug A input side + Bug B). Send disc flat ember, ArrowUp 18/2.75, host 48, input one-line, web textarea props, "+" 30.
- **Why:** spec §4.1/§4.2/§4.3.

### AriChatScreen.tsx (+20)
- **Before:** `inputWrap.paddingBottom` keyboard/nav only (phantom 80px on web).
- **Now:** platform-aware — web → `spacing.sm`; native branch unchanged. (List top padding handled in MessageList per spec; no header/orb/drawer behavior change.)
- **Why:** spec §4.1 screen side + §7 row 5.

### ChatBubble.tsx (~188 changed)
- **Before:** user fill `ariPalette.flame` (white = 2.32:1 fail); hard-coded 14/19 + 14/9 padding + 18/4 radius + 78% maxWidth; orbGap `spacing.sm`; flat single `Text`.
- **Now:** user fill `ariPalette.userBubble` (4.6:1); `ariThread` paddings (12/8) + radius (16 base / 4 tail) + maxWidth 80% + orbGap 6; new `tail?` prop (default true) for grouping (interior bubbles drop the tail → smooth column); lightweight paragraph (`\n\n`) + bullet (`• `/`- `) segment renderer; iOS subtle ember shadow / Android opaque `#16181b` + overflow:hidden + no shadow / web no shadow.
- **Why:** spec §2.1–2.5, §3.1, §3.2.

### MessageList.tsx (~109 changed)
- **Before:** fixed 10px separator; each turn full gap; orb on every Ari bubble; success `✓` Unicode; content padding md/md/xxl.
- **Now:** speaker grouping — `ItemSeparatorComponent` reads leading/trailing speaker and emits `gapGroup` (4) for same-speaker bubble pairs else `gapTurn` (10); Ari follow-ups in a group `hideOrb`; interior bubbles `tail=false`; ribbon padding → `ribbonPadH/V` (10/5); success glyph → lucide `Check` (size 13); list top → `spacing.sm`, bottom → `spacing.xl`.
- **Why:** spec §2.1, §2.4, §3.4, §7 row 3.

### StreamingText.tsx (~28 changed)
- **Before:** bubble 14/9 padding, 4/18 radius, glass tint + border on all platforms.
- **Now:** 12/8 padding + 16 radius (4 tail), Android opaque `#16181b` + overflow:hidden (iOS/web keep glass + hairline). No motion change.
- **Why:** spec §3.4.

### ToolProposalCard.tsx (~36 changed)
- **Before:** cardPad 14, title 16/22, button height 36, Confirm fill `ariPalette.flame` (white = 2.32:1 fail) with always-on shadow + `elevation:0`.
- **Now:** cardPad `ariThread.cardPad` (12), title 15/21, button height 34 + `hitSlop:{top:5,bottom:5}` on all three (→ ≥44 target), Confirm fill `ariPalette.userBubble` (4.6:1) with iOS-only ember shadow (Platform.select) + Android/web no elevation.
- **Why:** spec §3.3.

### ToolEditForm.tsx (+8)
- **Before:** field `typography.body.fontSize` (16), paddingVertical 8.
- **Now:** field 13/17 + `ariThread.inputPadV` (6); hairline underline + all `accessibilityLabel`s preserved verbatim.
- **Why:** spec §3.3, §7 row 7.

### QuickReplyChips.tsx (~138 changed)
- **Before:** legacy `chips: string[]` + `onSelect` + `layout` only.
- **Now:** adds the §5.1 single-select CHOICE mode (`options: {id,label}[]`, `selectedId?`, `state: 'default'|'loading'|'submitted'`, `onSelectId`, `disabled?`) — 30px wrapping chips, selected `userBubble` + lucide `Check`, loading `ActivityIndicator`, submitted collapses siblings. Legacy API kept (props now optional) so the suggestions panel is unchanged.
- **Why:** spec §5.1, §7 row 8. Presentational only.

### ClarifyingCard.tsx (NEW, +239) · MultiSelectPrompt.tsx (NEW, +248) · ResponseCard.tsx (NEW, +363)
- **Now:** the §5.2/§5.3/§5.4 presentational cards with the 5 named states each (default/typed-selected/loading/disabled/submitted; ResponseCard adds error). `GlassChrome` containers (which carry their own Android opaque ≥0.92 fallback), lucide single-path glyphs (`Check`/`Square`/`CheckSquare`), `ActivityIndicator` spinners, `ariPalette.userBubble` primaries, real-photo-only thumbnail (44×44, no placeholder), reduced-motion-gated shimmer skeleton (ResponseCard), muted inline retry row for error (not a red card).
- **Why:** spec §5.2–5.5, §7 rows 11–13. Data + callbacks wired by the downstream smart-Ari ORCH.

---

## 4. Spec traceability

| Spec criterion | Status | Evidence |
|---|---|---|
| §4.1 Bug A — input one line (14/19/6/30), host 48, web rows={1}+resize:none+height:auto | PASS | InputBar styles + WEB_INPUT_PROPS; regression test "Bug A" block |
| §4.1 Bug A — screen paddingBottom web→spacing.sm (no phantom 80px), native kept | PASS | AriChatScreen; regression test "platform-aware paddingBottom" |
| §4.2 Bug B — delete SVG/Defs/RadialGradient/Circle; flat #a85a44 disc 34 + ArrowUp 18/2.75 white | PASS | InputBar; regression test "Bug B" block |
| §4.2 keep Animated.View scale + iOS shadowOpacity glow + micro-interaction + reduced-motion | PASS | InputBar unchanged anim block; ORCH-1057 ADV-5 still green |
| §7 ariPalette.userBubble + ariThread token block | PASS | designSystem.ts; regression test "tokens exist" |
| §2.1–2.5 density spine (gaps, paddings, radius, grouping, segment renderer) | PASS | ChatBubble + MessageList |
| §3.1 user-bubble contrast fix (#a85a44, 4.6:1) | PASS | ChatBubble.userBubble fill |
| §3.3 Confirm contrast fix + 34h + hitSlop→44 | PASS | ToolProposalCard |
| §3.4 StreamingText 12/8+16; success ribbon lucide Check | PASS | StreamingText + MessageList |
| §5.1–5.4 four presentational response components, 5 states each | PASS | QuickReplyChips CHOICE + 3 new files |
| §1/§7 scope guard — no useAgentChat/agentChatService/edge/prompts/disclosure/drawer edits; a11y labels verbatim | PASS | diff stat = §7 files only; labels preserved |
| ANDROID_GLASS_USES_OPAQUE_FALLBACK on every new fill | PASS | opaque #16181b / #a85a44 + overflow:hidden + no Android shadow; GlassChrome opaque fallback |

---

## 5. Regression test (MANDATORY gate)

- **Path:** `mingla-business/src/components/ari/__tests__/orch_1101_ari_chat_composer_overhaul.test.ts`
- **Passing run:** `npx jest orch_1101 --runInBand` → **14 passed, 14 total**. Full ari suite (`src/components/ari`) → **44 passed, 4 suites**.
- **fails-on-revert verified @ `129df41e1` (origin/main):** `git checkout origin/main -- InputBar.tsx AriChatScreen.tsx designSystem.ts` → re-ran → **10 of 14 assertions FAILED** (every load-bearing Bug A / Bug B / token assertion; the 4 still-green checks live in separate new files). `git checkout HEAD --` restored → **14/14 green** again.
- **Append-only gate:** `node .github/scripts/test-append-only-check.js` (base origin/main) → **3 passed, 0 failed** — the two ORCH-1057 modifications carry the `[TEST-MOD-APPROVED ORCH-1101]` override token in the HEAD commit body; the new ORCH-1101 test is an ADD.

---

## 6. Verification matrix

- `tsc --noEmit` on `mingla-business`: **zero errors in any ORCH-1101-touched file** (the pre-existing repo errors in `app/checkout*/buyer.tsx`, `marketing/ComposerV2/*`, `payments/*.native`, etc. are untouched and unrelated — flagged below).
- jest: 44/44 across orch_1101 (14) + orch_1057 happy (16) + orch_1057 adversarial (11) + orch_1057 keyboard-decouple (3).
- Lint: not separately run (repo has no ari-scoped lint script); tsc strict is the type gate and is clean for these files.
- On-device: Metro dev server live on port 8129 watching this worktree → Seth Fast-Refreshes the changes on his physical iPhone live. The web-only branches (textarea props, paddingBottom) are desktop-web and need a web-build eyeball.

---

## 7. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---|---|---|---|
| Business iOS | YES | Bubble density, send disc (keeps ember glow), composer heights, cards | automatic (shared RN) |
| Business Android | YES | Same components; opaque fills + no shadow per policy | automatic |
| Desktop Business web | YES | Bug A + Bug B fixes; web textarea/paddingBottom branches | automatic + documented web branches |
| Phone Business web `/ari` | NO | route-blocked by ORCH-1095 | n/a |
| Consumer iOS/Android | NO | no Ari surface | n/a |
| Admin web | NO | no Ari surface | n/a |

---

## 8. Invariant / constitution check

- **ANDROID_GLASS_USES_OPAQUE_FALLBACK:** every new fill is opaque on Android (`#a85a44`, `#16181b`, GlassChrome ≥0.92) with `overflow:'hidden'` and no Android shadow/elevation. PASS.
- **Reduced-motion:** send micro-interaction gate kept verbatim; ResponseCard shimmer skeleton gated behind `useReducedMotion()`. PASS.
- **a11y:** every existing `accessibilityLabel` preserved; new interactive elements carry role + label + state (radio/checkbox/button); ≥44 targets via hitSlop. PASS.
- **No `any` introduced** in new components; the legacy `(m.content as any)` casts in MessageList pre-exist and are unchanged. PASS.
- **No silent catch / no scope creep.** PASS.

---

## 9. Deviations from spec

1. **Two stale ORCH-1057 test assertions updated** (with `[TEST-MOD-APPROVED ORCH-1101]`): the happy-path test asserted the send glyph `strokeWidth={2.5}` (spec §4.2 deepens it to 2.75) and the adversarial ADV-3 asserted opaque SVG-gradient stops (spec §4.2 deletes the SVG → ADV-3 now asserts the flat opaque ember disc + no-SVG invariant). The opaque-fill intent is preserved; the change is mechanically required by the spec. This is the sanctioned append-only escape hatch, not a scope expansion.
2. **List top padding** lives in `MessageList.contentContainerStyle` (→ `spacing.sm`), not `AriChatScreen` — the spec text (§7 row 5) attributes "list padding top→spacing.sm" to the screen but the list padding is a MessageList concern in this codebase. Functionally identical to spec intent; placed where the list actually pads.
3. **No render-state demo path added** for the four response components. Spec §7 + the dispatch say "presentational only … add a lightweight render-state demo path only if the spec calls for it; otherwise just build the components." The spec does not call for a demo harness, so none was added — they're exported and ready for the downstream ORCH to plug in.

No behavioral deviations on the two bug fixes — both are implemented exactly per §4.

---

## 10. Discoveries for orchestrator

- **Pre-existing `tsc` errors in mingla-business** (NOT introduced by this ORCH): `app/checkout/[eventId]/buyer.tsx` + `app/checkout-trip/[tripEventId]/buyer.tsx` (implicit-any params), `src/components/marketing/ComposerV2/richEditor.tsx` + `SelectionFormattingTooltip.tsx`, `src/payments/*.native` (missing `@mingla/payments-native` types), several `category` DraftEvent test-fixture errors, `eventCoverVideoProcessingService.ts`. These predate ORCH-1101 and are unrelated — flag for a typecheck-cleanup ORCH if the program wants a green `tsc` baseline.
- The four §5 response components are **presentational shells with no consumer**. They will dead-code-eliminate until the downstream smart-Ari ORCH wires them into `MessageList` item kinds. That ORCH owns the data/callback contract + the single-live-at-tail lifecycle wiring (spec §5.5).

---

## 11. Next steps

- DO NOT deploy / OTA / merge (per dispatch). REVIEW gate is the orchestrator's.
- Seth: Fast-Refresh on the physical iPhone (Metro on 8129) to confirm the send button + composer feel; eyeball the desktop-web build for the two bug fixes (the web branches only fire on react-native-web).

---

# REWORK PASS — 2026-06-08 (live-test bugs #2–#6)

Seth live-tested on his physical iPhone (Business dev build, Metro :8129) and found 6 bugs.
Bug #1 (send-time crash — FlatList separator read the always-undefined `trailingItem`)
was already fixed + committed by the orchestrator at `87d6e6cd3` (speakerOf guard +
precomputed `tail` flag). This rework fixes the remaining five (#2–#6) on top of it.

Scope expansion was operator-approved to touch `useAgentChat` / `AriChatScreen` /
`useAriPreferences`-adjacent service for #2/#3/#6. Edge functions + agent prompts untouched.
The dev-preview scaffolding (`app/(tabs)/ari.tsx`, `src/components/ari/AriDevPreview.tsx`)
was left UNCOMMITTED and untouched.

## Per-bug fixes

### #2 — Lag between sending and seeing your message (optimistic insert)
**Root cause (matches hypothesis):** `useAgentChat.sendMessage` only `mutateAsync`'d the
edge call; the user's bubble appeared only after the server round-trip + `agent_messages`
refetch. From the empty state it was worse — `AriChatScreen.noMessages` stayed true
(messages empty + conversationId null) so `MessageList` (which hosts every bubble AND the
thinking indicator) never even mounted until the server returned a conversationId.
**Fix:** `useAgentChat.ts` now inserts a crash-safe optimistic `AgentMessage`
(`makeOptimisticMessage` — `role:"user"`, `content:{text}`, `tool_calls:null`,
`tool_results:null`, `optimistic-…` id) synchronously in `sendMessage` before
`mutateAsync`. `messages` merges `serverMessages + liveOptimistic` (text-dedupe guards
against a double bubble if the real echo lands before the placeholder clears). On success
the hook **awaits** the thread `invalidateQueries` (which refetches), THEN drops the
placeholder — so the bubble never blinks out between clear and refetch. On error/edge-error
the placeholder is dropped (no stranded unsent message). Because `messages.length` is now
> 0 the instant you send, `noMessages` flips false and `MessageList` mounts immediately —
which is also what enables #3 from the empty state.
**Files:** `mingla-business/src/hooks/useAgentChat.ts`. **Commit:** see "send path" below.

### #3 — No processing/loading signal while Ari works (thinking indicator)
**Root cause (differs slightly from hypothesis):** the wiring
`isThinking={chat.isSending && !chat.pendingAction}` + `renderThinking={() =>
<StreamingText visible/>}` was ALREADY present in `AriChatScreen` (and `StreamingText`
already gates its blink behind `useReducedMotion`). The real reason Seth saw no signal on a
first message was the same mount gap as #2: from the empty state `MessageList` wasn't
mounted during the in-flight window, so its thinking row never rendered. #2's optimistic
insert mounts `MessageList` on send, so the thinking bubble now shows from send until Ari's
reply/proposal arrives, animated, reduced-motion-respecting. No new code was needed beyond
#2; this rework adds regression coverage asserting the wiring stays.
**Files:** none beyond #2 (coverage added in the rework test). **Commit:** with #2.

### #4 — Composer transparent; empty-state hint bled through the input
**Root cause (matches hypothesis):** `InputBar` `host` filled with
`glass.tint.profileBase` (rgba 255/.04) — a near-transparent glass tint — so the centered
empty-state hint and thread content showed through the field.
**Fix:** (a) added an opaque `ariThread.composerSurface` token (`#191c21`, solid hex, no
rgba/hsla → honors ANDROID_GLASS_USES_OPAQUE_FALLBACK on every platform) and switched the
`host` fill to it; border + radius preserved so it still reads as a glass-edged input.
(b) The empty-overlay already reserves `paddingBottom = inset + BOTTOM_NAV_CLEARANCE_PX +
60` to sit the hero/hint above the resting composer; with the opaque fill there is no
longer any bleed-through even at the seam. Verified visually that the field reads solid.
**Files:** `mingla-business/src/constants/designSystem.ts`,
`mingla-business/src/components/ari/InputBar.tsx`.

### #5 — Empty-state hint should reference the actual + button, not a literal "+"
**Root cause (matches hypothesis):** `EmptyState` printed the plain string
`Tap + for things to try`.
**Fix:** the sentence is now split around an inline chip that visually quotes the InputBar
"+" suggestions button — a bordered circle (`hintChip`, `radius.full` + 1px
`glass.border.profileBase`) wrapping a lucide `Plus` glyph: `Tap [＋] for things to try`.
The glyph keeps the low-emphasis `textTokens.tertiary` color (preserves the ORCH-1057
empty-state-hierarchy invariant ADV-6). A natural spoken `accessibilityLabel`
("Tap the plus button for things to try") is set on the row; the chip is hidden from the
a11y tree so it isn't double-announced. Still non-tappable (no Pressable / button role).
**Files:** `mingla-business/src/components/ari/EmptyState.tsx`.

### #6 — First-open disclosure sheet CTA did nothing
**Root cause (differs from hypothesis):** NOT a tap-swallow — the footer Pressable was
already moved out of the ScrollView in a 2026-05-12 fix and receives taps. The real cause
is a state-flip gap: `onAccept` only fired `prefs.acknowledge()` (an upsert + profile
`invalidateQueries`), but the modal's `visible` is derived from
`disclosureNeeded = !prefs.isLoading && profile?.ai_disclosure_acknowledged_at == null`.
The sheet stays up until the profile query REFETCHES and returns a non-null timestamp — so
on any latency (or if the ack write/refetch is slow) the button appears to "do nothing."
The old handler also swallowed every failure with `.catch(() => undefined)`.
**Fix:** `AriChatScreen` adds a local `disclosureDismissed` flag set to true the instant the
CTA is tapped; `disclosureNeeded` now also requires `!disclosureDismissed`, so the sheet
closes immediately, decoupled from the network round-trip. The `acknowledge()` mutation
still persists in the background; its error is now surfaced via the existing error toast
(`setLocalError`) instead of being swallowed.
**Files:** `mingla-business/src/screens/ari/AriChatScreen.tsx`.

## Compilation
`tsc --noEmit` is clean on every touched product file (`useAgentChat.ts`,
`AriChatScreen.tsx`, `InputBar.tsx`, `EmptyState.tsx`, `designSystem.ts`) and the new test.
The ~258 pre-existing `tsc` errors in unrelated files (checkout-trip buyer, ComposerV2,
payments-native, etc.) are the documented baseline and unchanged by this rework. The
`AriDevPreview.tsx` scaffolding has one pre-existing error (`ChoiceState` enum) — it is
orchestrator scaffolding, intentionally not touched/committed.

## Regression test
`mingla-business/src/components/ari/__tests__/orch_1101_rework_ari_chat_bugs.test.ts`
(new file, append-only safe). 17 assertions across #1-guard, #2, #3, #4, #5, #6.
- PASS on fixed code: 17/17.
- fails-on-revert verified @ `87d6e6cd3` (base commit, all five product files stashed):
  12 assertions fail (every #2/#4/#5/#6 clause); the 5 that stay green are the #1-guard
  (correctly already fixed at base) and the #3 wiring (pre-existing; enabled by #2's mount).

## Append-only test modification
Two stale ORCH-1057 happy-path assertions on `EmptyState` (the old literal
`Tap + for things to try` copy + the old `<Plus size={14} … strokeWidth={2}/>` glyph shape)
were updated in `orch_1057_ari_composer_icons_emptystate.test.ts` to match ORCH-1101's #5
redesign, cited `[TEST-MOD-APPROVED ORCH-1101]` in the test commit body. The 1057 intent
(single non-tappable Plus-bearing hint) is preserved. The 1057 **adversarial** test needed
NO change — the chip glyph keeps `textTokens.tertiary`, satisfying ADV-6.

## Cross-surface impact
- Business iOS / Business Android: all five fixes apply (shared component code; opaque
  composer + optimistic send + thinking + hint chip + disclosure dismiss).
- Business Web preview: #2/#3/#6 apply (shared); #4 opaque fill + #5 chip render on web too.
- Consumer iOS/Android, Buyer-anon Web, Admin Web: UNAFFECTED — Ari is a Business-app surface
  with no equivalent on those surfaces.

## Constraints honored
- Every intermediate state compiles (no broken imports/syntax — Metro stays live).
- ANDROID_GLASS_USES_OPAQUE_FALLBACK: new composer fill is solid hex (no rgba/hsla).
- accessibilityLabels preserved/added; reduced-motion gate on StreamingText intact.
- Dev-preview scaffolding NOT committed, NOT deleted.
- No deploy / OTA / merge.
