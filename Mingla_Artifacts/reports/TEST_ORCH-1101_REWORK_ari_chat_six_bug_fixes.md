# TEST · ORCH-1101 REWORK — Ari chat interface + composer overhaul (six live-device bug fixes)

**Mode:** RETEST (rework re-verification)
**Surface:** Mingla Business app — Ari chat (`mingla-business/src/{components/ari, screens/ari, hooks, constants}`)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1101-[ari-chat-design-overhaul]/` on branch `ORCH-1101-ari-chat-design-overhaul`
**Date:** 2026-06-08
**Tester:** mingla-tester (claude)

---

## Verdict: **PASS**

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 (note) | **P4:** 2 (praise)
- All six Seth-reported live-device bugs are fixed in source, proven, and regression-guarded.
- Full ari suite: **85/85 green** (71 prior + 14 new tester-adversarial).
- Rework test: **17/17**. New tester adversarial: **14/14**.
- `tsc --noEmit`: zero errors in any of the seven rework files or the test files.
- Web (react-native-web) opaque-composer render: **proven** (`#191c21`, 6-digit hex, zero alpha, `overflow:hidden`).
- No leaks into edge functions / agent prompts / supabase — branch diff is mingla-business UI/hook/constant + tests only.

---

## Sim / render evidence

| Leg | Status | Evidence |
|-----|--------|----------|
| Web (react-native-web 0.21.2) | **proven** | RNWeb `StyleSheet.flatten` of the InputBar host → `backgroundColor: "#191c21"` (6-digit hex, no alpha), `overflow: "hidden"`. Opaque surface → empty-state hint / thread cannot bleed through. Script EXIT=0. |
| iOS / Android native | source-proven (`probable`) | Bugs are token/source-structure changes; values resolve identically across RN platforms. The opaque token is platform-agnostic (no `Platform.select` alpha branch); `ANDROID_GLASS_USES_OPAQUE_FALLBACK` honored (solid hex + `overflow:hidden`, no Android shadow). Seth is live on his physical iPhone via Metro :8129 Fast Refresh (orchestrator-owned, untouched). |

Note: per the live-fire gate, web is the canonical render leg here because the composer-opacity defect (#4) is the only one with a pixel-bleed symptom, and it is fully resolved at the RNWeb paint layer. The remaining five are state/structure fixes verified by source + fails-on-revert tests; Seth confirmed them on-device before this RETEST was dispatched.

---

## Bug-by-bug verification

### #1 — Send-time crash (FlatList separator read undefined `trailingItem`) — **FIXED**
`MessageList.tsx:151–164`: `ItemSeparatorComponent={({ leadingItem }) => …}` destructures ONLY `leadingItem`; the group gap derives from the precomputed `lead.tail === false` flag, never from a (always-undefined-in-FlatList) `trailingItem`. `speakerOf(item: ListItem | null | undefined)` guards with `if (!item) return null` (`:51–57`). No `trailingItem` dereference or alias anywhere. Guarded by rework test §#1 + adversarial ADV-R2/ADV-R-msglist.

### #2 — Optimistic user message on send — **FIXED**
`useAgentChat.ts`: `makeOptimisticMessage` (`:49–59`) builds a crash-safe `AgentMessage` (role `user`, `content:{text}`, `tool_calls/tool_results: null`, `optimistic-`-prefixed id). `sendMessage` (`:128–137`) inserts the placeholder synchronously BEFORE `mutateAsync`. `onSuccess` awaits the refetch THEN clears (`:116–117`); `onError` and the `kind==="error"` branch drop the placeholder by id (`:97, :124`). Merge dedupes against a matching server user-row text so the bubble never doubles (`:156–163`).

### #3 — Thinking bubble from the empty state — **FIXED**
`AriChatScreen.tsx:224–225` passes `isThinking={chat.isSending && !chat.pendingAction}` + `renderThinking={() => <StreamingText visible />}`. Because the optimistic insert (#2) flips `noMessages` false on the FIRST message, `MessageList` mounts and shows the thinking row from the empty state — closing the prior gap. `StreamingText.tsx` gates the blink behind `useReducedMotion()` (`:36`) and returns null when `!visible` (`:52`), cancelling the animation on unmount (`:45–47`).

### #4 — Opaque composer surface — **FIXED**
`designSystem.ts:231` `composerSurface: "#191c21"` (solid 6-digit hex). `InputBar.tsx:194` host `backgroundColor: ariThread.composerSurface`; border (`glass.border.profileBase`) + `borderRadius: radius.xl` + `overflow:"hidden"` preserved (`:195–198`). **Web-render proof:** RNWeb flattens to `#191c21` with zero alpha + `overflow:hidden` → no bleed-through. Honors `ANDROID_GLASS_USES_OPAQUE_FALLBACK`.

### #5 — Empty-state hint shows an inline `+` chip — **FIXED**
`EmptyState.tsx:38–48`: sentence split around an inline bordered `hintChip` View containing `<Plus size={13} color={textTokens.tertiary}>` — glyph stays tertiary (ORCH-1057 invariant preserved). No literal "Tap + for things to try". Natural a11y label "Tap the plus button for things to try"; chip is `accessibilityElementsHidden`. Chip border mirrors the InputBar `+` button (`glass.border.profileBase`, `radius.full`, `borderWidth:1`).

### #6 — Disclosure CTA dismisses instantly — **FIXED**
`AriChatScreen.tsx`: `const [disclosureDismissed, setDisclosureDismissed] = useState(false)` (`:70`); `disclosureNeeded` short-circuits on `!disclosureDismissed` first (`:98–101`), so the modal closes the instant the CTA fires regardless of network latency. `handleAcceptDisclosure` (`:103–114`) sets the flag synchronously THEN persists; the ack `.catch((err: unknown) => … setLocalError(message))` surfaces failures via the toast — the old `.catch(() => undefined)` swallow is gone. `AiDisclosureModal` CTA `onPress={onAccept}` → `handleAcceptDisclosure` (`:285`).

---

## Regression-test gate (all three clauses satisfied)

1. **Tester adversarial test** — `mingla-business/src/components/ari/__tests__/orch_1101_rework_ari_chat_bugs.adversarial.test.ts` (committed `f8d0c31c7`). 14/14 green. Attacks a DIFFERENT angle than the implementor's string-presence happy-path test: optimistic *dedupe + clear-after-await ordering* (no double bubble), thinking-bubble *unmount* + reanimated-loop *leak*, composerSurface *computed zero-alpha* (6-digit vs 8-digit/rgba/hsla), disclosure *network-decoupling source-of-truth*, optimistic-id *collision namespace*. **Fails-on-revert verified live:** ADV-R2 fails when StreamingText's `if(!visible) return null` is removed; ADV-R1 fails when the onSuccess clear is reordered before the await.
2. **Implementor happy-path test** — `orch_1101_rework_ari_chat_bugs.test.ts` (commit `d3c639ae5`, fails-on-revert stated by implementor). 17/17 green. Confirmed independently by reverting `composerSurface` to `rgba(...)` → #4 assertion went red, then restored.
3. **Both tests in branch diff** — `git diff origin/main...HEAD --name-only` lists both `orch_1101_rework_ari_chat_bugs.test.ts` and `…adversarial.test.ts`. They ship with the fix.

---

## Constitution check (relevant rules)

- **R1 No dead taps** — PASS. Disclosure CTA now responds instantly (#6).
- **R2 One owner per truth** — PASS. Dismissal source-of-truth is the local `disclosureDismissed` flag; optimistic messages owned by one `optimisticMessages` state, merged read-only.
- **R3 No silent failures** — PASS. The ack `.catch(()=>undefined)` swallow was the violation; now routed to the toast.
- **R12 Validate at right time** — N/A.
- All other rules N/A (UI/state rework, no auth/currency/persistence/migration change).

---

## Findings

- **P3 (note):** `useAgentChat` merge dedupe keys on `(role==='user' && text equal)`. If a user sends the *same exact text twice in rapid succession*, both optimistic placeholders are dropped once a single server echo with that text lands — the second placeholder reconciles against the first echo. This is benign (the canonical server thread is authoritative and will contain both rows after refetch), but a future id-based reconcile would be more precise. Not a blocker; no user-visible defect.
- **P4 (praise):** `onSuccess` awaiting `invalidateQueries` BEFORE clearing the optimistic placeholder is the correct fix for the clear/refetch race — eliminates the blink window cleanly.
- **P4 (praise):** Coupling #2 (optimistic insert) to #3 (empty-state thinking bubble) via `noMessages` is elegant — one mechanism closes two reported symptoms.

## Out-of-scope observations (not ORCH-1101 defects)

- `AriDevPreview.tsx` has a tsc error (`TS2322` line 82, `"disabled"` not assignable to `ChoiceState`). This file is **untracked orchestrator-owned dev-preview scaffolding** (not in the branch diff, reverted at close) — explicitly off-limits to this RETEST. Flagged for the orchestrator only.
- `packages/phone-input/*` tsc errors (`TS7031`/`TS2307` cannot-find `react`) are pre-existing worktree symlinked-node_modules module-resolution noise, unrelated to ORCH-1101.

---

## Commands captured

- `npx jest src/components/ari` → `Test Suites: 7 passed`, `Tests: 85 passed`.
- `npx jest …orch_1101_rework_ari_chat_bugs.adversarial.test.ts` → 14 passed.
- `npx jest …orch_1101_rework_ari_chat_bugs.test.ts` → 17 passed.
- `npx tsc --noEmit` → only AriDevPreview (scaffolding) + phone-input (pre-existing) errors; zero in rework files.
- RNWeb composer-opacity proof → EXIT=0 (`#191c21`, 6-digit, no alpha, overflow hidden).
- fails-on-revert: ADV-R1 (reorder) red; ADV-R2 (remove null-return) red; #4 token revert → rework test red. All restored.

## Routing

Return to **orchestrator REVIEW gate**. No rework needed. Do NOT commit/revert the dev-preview scaffolding (`ari.tsx`, `AriDevPreview.tsx`) — orchestrator reverts at close.
