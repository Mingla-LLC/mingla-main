# IMPLEMENTATION_ORCH-0685_cycle3_REPORT

**ORCH-ID:** ORCH-0685
**Cycle:** 3 (final, closes ORCH-0685)
**Dispatch:** [IMPL_ORCH-0685_cycle3_PATTERN_F_FIX_AND_BRAND_TOAST.md](../prompts/IMPL_ORCH-0685_cycle3_PATTERN_F_FIX_AND_BRAND_TOAST.md)
**Status:** implemented and verified (tsc clean, grep clean, CI invariants pass for ORCH-0685; manual visual checks needed for SC-1/2/3/4/5 on device)
**Predecessor:** [IMPLEMENTATION_ORCH-0685_cycle2_v2_INSTRUMENTED_DIAGNOSTIC_REPORT.md](IMPLEMENTATION_ORCH-0685_cycle2_v2_INSTRUMENTED_DIAGNOSTIC_REPORT.md)

---

## A. Layman summary

Already-saved chat-shared cards now show "Saved" on first paint instead of stale "Save". The
toast that fires after a real save is restyled with Mingla brand colors — green-tinted card
with a green left stripe and checkmark icon for success, red equivalent for errors, orange
for default. All `[ORCH-0685]` diagnostic console.log lines and `[TRANSITIONAL]` markers from
cycle-2 v2 have been stripped. Save chain logic is unchanged from cycle-2 v2 (proven working
empirically via Supabase MCP probe last cycle).

---

## B. Mission ingestion

| Source | Read | Key takeaway |
|---|---|---|
| Dispatch prompt | ✓ | 4 deliverables: D-1 (Pattern F fix), D-2 (brand toast), D-3 (instrumentation strip), D-4 (TRANSITIONAL → permanent comment) |
| Cycle-2 v2 implementation report | ✓ | Defines what to strip — handleSaveSharedCard, ActionButtons.handleSave, savedCardsService.saveCard |
| Cycle-2 v2 forensics report | ✓ | RC-1 ("Save IS technically working") FALSIFIED last cycle by MCP probe; cycle-3 acts on Pattern F instead |
| MCP probe results | ✓ | eff78416 has 3 saved_card rows including Angus Barn at 2026-04-27 15:24:03 UTC — Save chain proven working |

---

## C. Files modified (Old → New receipts)

### [app-mobile/src/components/MessageInterface.tsx](../../app-mobile/src/components/MessageInterface.tsx)

**What it did before:**
- `sharedCardIsSaved` initialized to `false` via `useState(false)`; manually reset to `false` at modal open (line 1033) and modal close (line 1475)
- Both reset paths fired regardless of whether the card was already in the user's saves
- `handleSaveSharedCard` body had 8 `console.log("[ORCH-0685] …")` calls and a `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` header
- Shape 2a notification panel (line 1483-1491) had a `[TRANSITIONAL]` block comment with exit condition
- Both notification panels (Shape 2a Modal at ~1500, always-mounted at ~1635) rendered ~30 lines of inline JSX each — generic white/gray styling, blue/green/red 8x8 dot indicator, dismiss icon `rgba(255, 255, 255, 0.72)` (white-on-light-gray invisibility)

**What it does now:**
- Added `colors` import from `../constants/colors` (raw brand-token surface)
- Added `useEffect` (after `savedCardsQuery` hook) that derives `sharedCardIsSaved` from `savedCardsQuery.data`: when `expandedCardFromChat` becomes non-null, the effect checks if any saved card's `id` matches `expandedCardFromChat.id` and sets the flag accordingly; when `expandedCardFromChat` becomes null (modal closed), it resets to `false`
- Removed both manual `setSharedCardIsSaved(false)` calls (lines 1033 and 1475 respectively) — replaced with explanatory comments noting the useEffect now owns initial state
- `handleSaveSharedCard` body cut to clean state: 4-state flow (early-return guards → setIsSaving → await saveCard → toast → catch with single console.error → finally setIsSaving=false). Zero `[ORCH-0685]` log lines remain
- `[TRANSITIONAL]` block comment on Shape 2a Modal replaced with a 4-line permanent WHY comment explaining the RN Modal portal architecture
- Added two helpers below `dismissNotification`: `getNotificationVisuals(type)` returns `{stripeColor, bgColor, borderColor, iconName, iconColor}` per type; `renderNotificationCard(notification, withPointerEvents)` returns the JSX for one notification card
- Both notification panel mount sites (Shape 2a Modal panel + always-mounted panel) replaced with `notifications.map((n) => renderNotificationCard(n, withPointerEvents))` — Shape 2a passes `true` for tap-pass-through, always-mounted passes `false`
- StyleSheet `notification` entry: removed fixed `backgroundColor: "white"` and `borderColor: "#e5e7eb"` (now set inline per type), `paddingLeft: 18` (4px stripe + 14px gutter), bumped title weight to 600
- StyleSheet `notificationIndicator` entry: switched from 8x8 dot with `marginTop: 8` to absolute-positioned full-height 4px stripe (`position: absolute, left: 0, top: 0, bottom: 0, width: 4`)
- StyleSheet `notificationTitleRow` (NEW): row layout with 8px gap between icon and title text
- StyleSheet `notificationMessage` color: from `#6b7280` (gray-500) to `#374151` (gray-700) for better legibility on tinted backgrounds
- StyleSheet `dismissButton`: background `transparent` instead of `#f3f4f6` (no longer needed visually); now uses `colors.gray500` for the X icon (visible against light tinted backgrounds)

**Why:**
- Pattern F fix (cycle-3 dispatch §C, §D-1, SC-1, SC-2): chat-shared cards already in saves must show "Saved" button on first paint
- Mingla-brand toast (§D-2, SC-3, SC-4, SC-5): visual signal must use brand-aligned colors and icons; pre-existing dismiss-icon-color invisibility bug fixed as part of restyle
- Diagnostic strip (§D-3, SC-6, SC-7, Constitution #7): no transitional code without exit conditions
- Permanent WHY comment (§D-4): documents the architectural reason Shape 2a Modal stays after the transitional period

**Lines changed:** ~+95 added (useEffect, helpers, comments, StyleSheet keys), ~-130 removed (instrumentation lines, inline JSX duplication), net ~-35

---

### [app-mobile/src/components/expandedCard/ActionButtons.tsx](../../app-mobile/src/components/expandedCard/ActionButtons.tsx)

**What it did before:**
- `handleSave` body had 8 `console.log("[ORCH-0685] …")` calls including a state-snapshot dump at function entry, branch-marker logs at every guard/path, and a structured error log in the catch block
- A `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` header pointed to cycle-3 as the exit condition

**What it does now:**
- `handleSave` body is clean: isSaving early-return → curated paywall gate → setIsSaving → try await onSave → catch with single console.error + Alert.alert error toast → finally setIsSaving=false
- Zero `[ORCH-0685]` references remain

**Why:** §D-3, SC-6, Constitution #7 — diagnostic instrumentation no longer serves a purpose now that Pattern F is the proven root cause.

**Lines changed:** ~-30 removed instrumentation, ~-3 transitional comment lines

---

### [app-mobile/src/services/savedCardsService.ts](../../app-mobile/src/services/savedCardsService.ts)

**What it did before:**
- `saveCard` body had 7 `console.log("[ORCH-0685] …")` calls covering function entry payload, payload-prepared, before/after upsert with error fields breakdown, 23505 path, non-23505 path, and completion
- A `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` header pointed to cycle-3 as the exit condition
- 23505 duplicate path log was a `console.warn` with the `[ORCH-0685]` tag

**What it does now:**
- `saveCard` body is clean: payload prepare → supabase upsert with onConflict → 23505 idempotent path (preserved with a `[savedCardsService.saveCard] 23505 duplicate — treating as success` warn for production debugging) → non-23505 throw → recordActivity → engagement counter (fire-and-forget)
- Zero `[ORCH-0685]` references remain

**Why:** §D-3, SC-6, Constitution #7. Note: the 23505 `console.warn` is preserved (re-tagged without `[ORCH-0685]`) because it represents real production-relevant signal — the duplicate path executes silently otherwise and operations would be blind to spike patterns.

**Lines changed:** ~-30 removed instrumentation, ~-3 transitional comment lines

---

## D. Spec traceability

| Criterion | Spec text | How implemented | Verification |
|---|---|---|---|
| SC-1 | Already-saved chat card shows "Saved" button on modal open | useEffect derives `sharedCardIsSaved` from `savedCardsQuery.data` whenever `expandedCardFromChat` changes; `isSaved={sharedCardIsSaved}` already passed to ExpandedCardModal | UNVERIFIED — manual device test |
| SC-2 | Not-yet-saved chat card shows "Save" button on modal open | Same useEffect — `list.some(...)` returns false if no match → `setSharedCardIsSaved(false)` | UNVERIFIED — manual device test |
| SC-3 | Tap Save on unsaved card transitions to Saved + branded green toast | `handleSaveSharedCard` calls `setSharedCardIsSaved(true)` + `showNotification(t('chat:cardSavedTitle'), t('chat:cardSavedToast'))` (default type "success"); brand styling applied via `getNotificationVisuals("success")` | UNVERIFIED — manual device test |
| SC-4 | Toast uses Mingla brand colors | `getNotificationVisuals` returns `colors.success` / `colors.error` / `colors.primary` per type; full-height 4px stripe; tinted bg (`successLight` / `lightOrange`); checkmark / alert / info icon | UNVERIFIED — manual device test |
| SC-5 | Dismiss button icon visible | Icon color changed from `rgba(255,255,255,0.72)` to `colors.gray500` (`#6b7280`); dismissButton bg now transparent | UNVERIFIED — manual device test |
| SC-6 | Zero `[ORCH-0685]` log lines in code | `Grep [ORCH-0685] app-mobile/src` returns no matches | PASS |
| SC-7 | Zero `[TRANSITIONAL]` markers for ORCH-0685-cycle2-v2 | `Grep TRANSITIONAL.*ORCH-0685-cycle2-v2 app-mobile/src` returns no matches | PASS |
| SC-8 | tsc clean | `npx tsc --noEmit` shows 3 baseline errors only (ConnectionsPage:2763, HomePage:246, HomePage:249) — same as cycle-2 v2 baseline; zero new | PASS |

---

## E. Invariant verification

| ID | Invariant | Preserved? | Notes |
|---|---|---|---|
| C-1 | No dead taps | Y | Save tap still produces feedback (toast + button state); already-saved button is `disabled` so taps are correctly inert |
| C-3 | No silent failures | Y | catch blocks in all 3 files have a single `console.error` + user-facing surface (toast / Alert.alert) |
| C-7 | No transitional code without exit conditions | Y | All `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` markers removed; their exit conditions are now met (Pattern F proven, instrumentation no longer needed) |
| C-8 | Subtract before adding | Y | D-3 strip executed before D-1 useEffect / D-2 restyle / D-4 comment swap |
| C-12 | Validate at the right time | Y | useEffect derives state post-mount on dependency change — no render-time mutation; sharedCardIsSaved transitions through React's expected lifecycle |
| I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS (cycle-1) | Forbidden-field guard | Y | CI script PASS — no payload changes |
| I-LOCALE-CATEGORY-PARITY (cycle-1) | 29 locales × 12 keys | Y | CI script PASS — no locale changes |
| I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS (cycle-1) | Defense-in-depth slug-leak guard | Y | CI script PASS — no ExpandedCardModal subcomponent prop changes |

---

## F. Parity check

| Mode | Status |
|---|---|
| Solo | Pattern F fix + brand toast applied to chat-shared card flow which is solo-mode-only by construction (chat-mounted ExpandedCardModal passes `currentMode="solo"` at line 1533) |
| Collab | N/A — chat-shared cards do not exist in collaboration mode (sharing happens via session deck, not chat); no parity surface to update |
| Deck/saved-tab Save | NOT touched — those flows go through different ExpandedCardModal mount sites with their own `isSaved` propagation. Out of scope per dispatch §E. |

---

## G. Cache safety

| Concern | Status |
|---|---|
| Query keys | UNCHANGED — `savedCardKeys.list(userId)` still authoritative; no factory edits |
| Cache invalidation | UNCHANGED — `useSavedCards` already invalidated by save-mutating hooks elsewhere; cycle-3's useEffect READS from cache only |
| Data shape | UNCHANGED — `SavedCardModel.id` still `cardData.id || record.experience_id` |
| Persisted AsyncStorage | UNCHANGED — no AsyncStorage writes added/removed |
| Risk of stale `sharedCardIsSaved` after a fresh Save | LOW — `setSharedCardIsSaved(true)` is set explicitly in `handleSaveSharedCard` success path; the useEffect's `savedCardsQuery.data` dependency will also re-fire when the list updates after the save (assuming consumer hooks invalidate `savedCardKeys.list(userId)` on save mutation) |

**Caveat to test:** if `useSavedCards` query data lags 2-3s after a fresh save (e.g., refetch hasn't fired yet), the useEffect would briefly see `isAlreadySaved: false` while `setSharedCardIsSaved(true)` was just called. The explicit success-path `setSharedCardIsSaved(true)` wins because it's set after the await; the next useEffect run will then confirm `isAlreadySaved: true` from cache. No state regression risk in normal flow.

---

## H. Regression surface (tester focus areas)

1. **Chat-shared card Save flow** — the primary spec target. Open shared-card bubble → ExpandedCardModal → Save button must reflect actual saved state on first paint
2. **Always-mounted notification panel** — used by `handleAddToBoard`, `handleRemoveFriend`, `handleBlockUser`, `handleReportUser`, picker submit toasts, and any other `showNotification` caller in MessageInterface. Verify the new branded styling renders correctly for non-shared-card flows too
3. **Save flow on swipeable deck cards** — different ExpandedCardModal mount path, but ActionButtons.handleSave is shared. Verify the cleaned handleSave doesn't regress deck-card save UX
4. **Save flow on saved-tab cards** — opens existing-saved cards via a different mount; isSaved should be true initially. Verify nothing broke
5. **Curated card paywall gate** — `isCurated && !canAccessCurated` path in ActionButtons.handleSave still calls `onPaywallRequired?.()`. Verify the paywall sheet still opens for non-Mingla+ users tapping Save on curated cards

---

## I. Constitutional compliance

| # | Principle | Status |
|---|---|---|
| 1 | No dead taps | ✓ — Save tap produces real feedback (button state change + toast) |
| 2 | One owner per truth | ✓ — sharedCardIsSaved owned by useEffect derived from query cache (single source) |
| 3 | No silent failures | ✓ — all catch blocks surface errors to user |
| 4 | One query key per entity | ✓ — `savedCardKeys.list(userId)` used; no hardcoded keys |
| 5 | Server state stays server-side | ✓ — sharedCardIsSaved is a derived UI flag, not server data; the source-of-truth (savedCardsQuery.data) stays in React Query |
| 6 | Logout clears everything | N/A — no auth/persistence changes |
| 7 | Label temporary fixes | ✓ — all ORCH-0685 [TRANSITIONAL] markers removed because exit conditions met |
| 8 | Subtract before adding | ✓ — D-3 strip preceded D-1/D-2/D-4 additions |
| 9 | No fabricated data | ✓ — sharedCardIsSaved comes from real query data, not heuristics |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | ✓ — useEffect runs post-mount on dependency change |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✓ — useEffect runs on first render once savedCardsQuery resolves; cold-start with cached saves works |

---

## J. Discoveries for orchestrator

### D-1: Pre-existing CI invariant failure unrelated to ORCH-0685

`bash scripts/ci-check-invariants.sh` reports `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` violation:

> `fetch_local_signal_ranked` (no defining migration found)
> Hot-path RPCs must be LANGUAGE sql STABLE, OR plpgsql with
> SET plan_cache_mode = force_custom_plan AND a comment block
> containing 'I-RPC-LANGUAGE-SQL-FOR-HOT-PATH' justifying plpgsql.

This is **NOT** caused by cycle-3. It's pre-existing tech debt for a hot-path RPC associated with ORCH-0668 (per the CI message format that lists every ORCH that touches the script). Recommend the orchestrator register this as a separate ORCH for triage. The CI exit-code-1 means any branch protection that runs this script will fail — worth knowing.

### D-2: `dismissButton` icon-color invisibility was a pre-existing bug

The original code used `Icon name="close" size={12} color="rgba(255, 255, 255, 0.72)"` against a `backgroundColor: "#f3f4f6"` (gray-100) button background. Translucent white on light gray = effectively invisible. This bug existed in the always-mounted notification panel BEFORE ORCH-0685 — cycle-3's D-2 fixed it as part of the restyle (legitimate scope per dispatch). Recommend the orchestrator scan for similar invisible-icon patterns elsewhere (e.g., other dismiss buttons, action-row icons) — this could be a recurring antipattern.

### D-3: `Subscribed to conversation` log lacks ORCH tag

The Metro log from the operator's test session showed `LOG  Subscribed to conversation: 3b57c5f3-d6a8-4d45-a72c-b82d64f38f7e` — useful but unstructured. Out of cycle-3 scope. Suggest registering as a structured-logging cleanup ORCH if appetite.

### D-4: `Removing card from saved_cards service` log fired during navigation, not user action

The Metro log showed `Removing card from saved_cards service eff78416-… ChIJx1H8GFL1rIkRFDGYZph6OGI solo undefined` while the user was navigating to the Likes tab — they didn't tap any unsave action. This suggests removeCard is being invoked by a non-user-action code path (cache sync? duplicate detection? optimistic cleanup?). Out of cycle-3 scope but worth investigating — could indicate a phantom-removal bug.

### D-5: `console.warn` retained in savedCardsService.saveCard 23505 path

I preserved the 23505 duplicate-path warn (re-tagged from `[ORCH-0685]` to `[savedCardsService.saveCard]`) because it represents real production signal. If orchestrator wants stricter "no console in services" hygiene, this could move to a structured logger (e.g., Sentry breadcrumb).

---

## K. Spec deviations

None. All 4 deliverables (D-1 through D-4) implemented as specified.

Two minor implementation choices not strictly prescribed:
1. **Icon name correction** — dispatch §D-2 bullet 2 said `Icon name="check-circle"`; the registered name in `app-mobile/src/components/ui/Icon.tsx` is `checkmark-circle` (CircleCheck). Used the correct name. Verified at line 224 of Icon.tsx.
2. **`renderNotificationCard` helper instead of inline duplication** — dispatch said "BOTH mount sites at line 1500-1532 AND original notifications panel at line 1612-1640 — same style, same component, just two mount sites". I extracted the shared JSX into a `renderNotificationCard` function rather than inlining identical 30-line blocks twice (DRY without overengineering — single function used in both call sites with one parameter for pointerEvents). This matches the dispatch's intent ("just two mount sites" with shared design) without violating "no abstractions beyond what the task requires" — the helper is local, single-use, and unambiguous.

---

## L. Verification matrix

| Verification | Method | Result |
|---|---|---|
| `[ORCH-0685]` strings stripped | `Grep '\[ORCH-0685\]' app-mobile/src` | PASS — no matches |
| `[TRANSITIONAL] ... ORCH-0685-cycle2-v2` markers stripped | `Grep 'TRANSITIONAL.*ORCH-0685-cycle2-v2' app-mobile/src` | PASS — no matches |
| tsc clean (no new errors) | `npx tsc --noEmit` from `app-mobile/` | PASS — 3 baseline errors only (ConnectionsPage:2763, HomePage:246, HomePage:249), all in untouched files |
| ORCH-0685 CI invariants | `bash scripts/ci-check-invariants.sh` | PASS for I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS, I-LOCALE-CATEGORY-PARITY, I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS |
| Icon names exist | Grep checked `Icon.tsx` registry: `checkmark-circle`, `alert-circle`, `info`, `close` all present | PASS |
| useEffect dependency array correct | Manual review: `[expandedCardFromChat, savedCardsQuery.data]` — both used inside, no missing deps | PASS |
| Helper function purity | `getNotificationVisuals` is pure (no side effects, no closure over mutable state); `renderNotificationCard` reads `dismissNotification` from outer scope (acceptable — same scope rules as inline JSX it replaces) | PASS |

---

## M. Test plan for tester / operator

### Manual on-device steps

1. **Build:** Pull commits from cycle-1 + cycle-2 v2 + cycle-3 (operator chooses single big commit or sequential per orchestrator's CLOSE protocol). Run `npx expo start --dev-client` (Metro) or publish iOS+Android EAS Updates as TWO separate invocations.

2. **SC-1 / SC-2 — Pattern F fix on modal open:**
   - Open a chat with a friend who has shared cards
   - Find a card in chat that **you have already saved before** (verify via Likes tab beforehand)
   - Tap the card bubble → ExpandedCardModal opens
   - **Expected:** Save button reads "Saved" (filled bookmark icon) and is disabled
   - Find a different card in chat that you have NOT saved
   - Tap it → ExpandedCardModal opens
   - **Expected:** Save button reads "Save" (outline bookmark icon) and is tappable

3. **SC-3 / SC-4 — Brand toast on save:**
   - Tap the unsaved card's Save button
   - **Expected:** Button transitions to "Saved" (filled bookmark, disabled). Toast appears at top with: green-tinted background (`#dcfce7`), green left stripe (`#10b981` full height), green checkmark icon, "Card saved" title in dark text, message in slightly lighter dark text
   - Toast auto-dismisses after 3 seconds

4. **SC-5 — Dismiss button visible:**
   - Trigger another notification (any path — e.g., remove friend, block, etc.)
   - **Expected:** Dismiss (X) icon clearly visible against the tinted background; tapping it dismisses the toast

5. **Regression — non-shared-card flows:**
   - Trigger `handleAddToBoard` toast, `handleBlockUser` toast, or `handleReportUser` toast
   - **Expected:** Same brand-aligned styling as the shared-card save toast (default type uses orange brand)

6. **Regression — deck card save (ActionButtons.handleSave):**
   - Open ExpandedCardModal from the swipeable deck (Discover tab)
   - Tap Save on an unsaved card
   - **Expected:** Save flow works as before (no console.log spam, paywall gate still functional for curated cards on free tier)

### Headless / automated verification

- `Grep '\[ORCH-0685\]' app-mobile/src` returns 0 matches ✓
- `Grep 'TRANSITIONAL.*ORCH-0685-cycle2-v2' app-mobile/src` returns 0 matches ✓
- `cd app-mobile && npx tsc --noEmit` shows ≤3 baseline errors, none in MessageInterface / ActionButtons / savedCardsService / cardPayloadAdapter ✓
- `bash scripts/ci-check-invariants.sh` passes for the 3 ORCH-0685 invariants (it fails on the unrelated I-RPC-LANGUAGE-SQL-FOR-HOT-PATH for `fetch_local_signal_ranked` — see Discoveries D-1)

---

## N. Transition register

**Empty.** All `[TRANSITIONAL]` markers from cycle-2 v2 have been removed because their exit conditions are met:

| Marker (cycle-2 v2) | Exit condition | Status |
|---|---|---|
| `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` in MessageInterface.handleSaveSharedCard | "cycle-2 v3 final fix lands and the [ORCH-0685] log lines are stripped" | MET (cycle-3) |
| `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` in ActionButtons.handleSave | Same | MET |
| `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` in savedCardsService.saveCard | Same | MET |
| `[TRANSITIONAL — ORCH-0685 cycle-2 v2 Shape 2a]` Modal block comment | "cycle-2 v3 final fix lands; if v3 switches to a global toast provider this entire block can be deleted" | DECISION: KEPT block, replaced comment with permanent WHY (per dispatch §D-4 — operator confirmed toast is visible, so Shape 2a is the correct architecture, not transitional) |

No new `[TRANSITIONAL]` markers introduced in cycle-3.

---

## O. Final status

- **Implementation:** completed
- **Verification:** PASS for SC-6, SC-7, SC-8 + all 5 cycle-3 invariants; UNVERIFIED for SC-1, SC-2, SC-3, SC-4, SC-5 (require on-device visual inspection — operator-driven)
- **Cycle-3 closes ORCH-0685** pending tester confirmation of the 5 unverified visual criteria

**Next action (operator):** commit + push + ship build (Metro dev OR iOS+Android EAS Updates as separate invocations) → device test → orchestrator runs CLOSE protocol on PASS.
