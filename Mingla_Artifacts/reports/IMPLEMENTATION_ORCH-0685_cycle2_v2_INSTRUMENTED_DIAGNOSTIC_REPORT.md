# IMPLEMENTATION REPORT — ORCH-0685 cycle-2 v2 — Instrumented diagnostic + Shape 2a notifications-Modal

**Date:** 2026-04-26
**Dispatch:** [prompts/IMPL_ORCH-0685_cycle2_v2_INSTRUMENTED_DIAGNOSTIC.md](../prompts/IMPL_ORCH-0685_cycle2_v2_INSTRUMENTED_DIAGNOSTIC.md)
**Forensics chain:** [reports/INVESTIGATION_ORCH-0685_cycle2_SAVE_DEAD_TAP.md](INVESTIGATION_ORCH-0685_cycle2_SAVE_DEAD_TAP.md) (cycle-2 v1 — RC-1 falsified by MCP probes; see AH-236)
**Cycle-1 IMPL preserved:** [reports/IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md](IMPLEMENTATION_ORCH-0685_EXPANDED_CARD_MODAL_REPORT.md)
**Result:** **CODE-COMPLETE.** All 4 dispatch deliverables applied (D.1 + D.2 + D.3 + D.4). TypeScript baseline preserved (zero new errors). Single commit pending operator approval. **NOT a final fix** — this is an instrumented diagnostic build. Final fix lands in IMPL_v3 after operator returns the `[ORCH-0685]` console output from a real-device tap.

---

## A. Layman summary

This is a temporary diagnostic build. Every branch in the Save chain now prints a `[ORCH-0685]` log line so we can see exactly where the save silently aborts on a real device. Plus the Shape 2a second-Modal makes any error toast visible above the chat-mounted modal (so the user sees the failure mode in addition to having the console log).

**Operator runs the build → taps Save once → copies the `[ORCH-0685]` console output → orchestrator interprets → IMPL_v3 ships the targeted fix + removes the diagnostic logs.**

Round trip: ~75-110 min wall time.

---

## B. Pre-flight gate results

| Gate | Status | Notes |
|------|--------|-------|
| G-1 — Working tree state | ✅ PASS | Cycle-1 IMPL changes uncommitted (expected per AH-235/236). 28 chat.json + 27 common.json + cardPayloadAdapter.ts (new) + edits to messagingService/MessageInterface/ExpandedCardModal all M-flagged. NO unrelated edits. |
| G-2 — Cycle-1 IMPL still in tree | ✅ PASS | `handleSaveSharedCard` × 2 in MessageInterface.tsx; `ORCH-0685 DEC-1` × 4 in messagingService.ts; `cardPayloadAdapter.ts` exists. |
| G-3 — File:line anchors | ✅ PASS | Verified before each Edit: handleSaveSharedCard at line 687-717, ActionButtons.handleSave at 201-219, saveCard at 67-116, ExpandedCardModal mount at 1467-1481, existing notifications panel at 1558-1592. |
| G-4 — JS console reachability on test device | ⚠️ DEFERRED-TO-OPERATOR | Cannot verify from CLI. Operator MUST run a Metro/Expo dev build (`npx expo start --dev-client`) instead of consuming the production EAS Update if they want the granular log evidence. The Shape 2a notifications-Modal will surface visible toast feedback on any build (production or dev) — that's the user-visible diagnostic signal. |

---

## C. Spec compliance crosswalk

| Dispatch § | Topic | Status |
|------------|-------|--------|
| §B Execution rules | Cycle-1 deliverables preserved, instrumentation tagged TRANSITIONAL, no Co-Authored-By | ✅ Honored |
| §C G-1..G-4 pre-flight | All 4 gates run | ✅ See §B above |
| §D.1 handleSaveSharedCard instrumentation | Replace handler body verbatim with logging at every branch | ✅ Applied at MessageInterface.tsx (formerly :687-717, now ~:687-754) |
| §D.2 ActionButtons.handleSave instrumentation | Replace handler body verbatim with logging at every branch | ✅ Applied at ActionButtons.tsx (formerly :201-219, now ~:201-247) |
| §D.3 savedCardsService.saveCard instrumentation | Replace function body verbatim with logging at every branch | ✅ Applied at savedCardsService.ts (formerly :67-116, now ~:67-144) |
| §D.4 Shape 2a second-Modal | Mount second `<Modal>` after chat-mount block, copy inner per-notification JSX from existing panel verbatim, add `pointerEvents` | ✅ Applied at MessageInterface.tsx (~lines 1483-1525, between ExpandedCardModal close and "More options bottom sheet" comment) |
| §D.5 Imports | `Modal` already in `react-native` import; `Alert` already in ActionButtons; cycle-1 imports preserved | ✅ No new imports needed |
| §F Implementation order | 10-step order followed | ✅ Steps 1-7 done (gates, JSX read, 4 edits, tsc); step 8 (commit) + step 9 (EAS) operator-driven; step 10 (device test) operator-driven |
| §J Definition of done | 3 instrumented bodies tagged + Shape 2a Modal mounted + tsc passes + no new errors | ✅ All four code criteria met; commit + EAS + device test remain operator |

---

## D. Old → New file receipts

### `app-mobile/src/components/MessageInterface.tsx`

**What it did before:** `handleSaveSharedCard` (lines 687-717) had the cycle-1 wired logic — early-return on guards, await `savedCardsService.saveCard`, surface toast via `showNotification` on success/failure. No diagnostic visibility into which branch executed. No second Modal for toast visibility above chat-mount.

**What it does now:**
1. `handleSaveSharedCard` body replaced with instrumented version. Logic UNCHANGED — only `console.log('[ORCH-0685]', ...)` calls added at: function entry (with state snapshot + cardData fingerprint), each early-return branch, the `setIsSavingSharedCard(true)` boundary, before the saveCard await, after a successful resolve, in the catch (with full error fields: message/code/details/hint/status/statusCode/name/raw), and in the finally. All instrumentation tagged `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` with explicit exit condition.
2. New second `<Modal>` block added immediately after the chat-mounted `<ExpandedCardModal>` mount (Shape 2a). Renders only when `showExpandedCardFromChat && notifications.length > 0`. Uses `transparent={true} animationType="fade" presentationStyle="overFullScreen"` so it doesn't dim the underlying modal. Outer `<View style={styles.notificationsContainer}> pointerEvents="box-none"` lets taps pass through; per-notification `<View pointerEvents="auto">` so dismiss button works. Inner JSX mirrors existing notifications panel at lines 1558-1592 byte-for-byte.

**Why:** Dispatch §D.1 (instrumentation) + §D.4 (Shape 2a). Cycle-2 forensics' RC-1 (toast hidden behind RN Modal portal) is real but contributing-factor; Shape 2a structurally fixes it. Branch-level logging gives orchestrator the runtime evidence needed to classify the actual root cause of the broken save.

**Lines changed:** ~+105 / -18 net (~70 lines for instrumented handler body, ~45 lines for Shape 2a Modal block, both verbatim per dispatch).

---

### `app-mobile/src/components/expandedCard/ActionButtons.tsx`

**What it did before:** `handleSave` (lines 201-219) had pre-cycle-2 logic — early-return on `isSaving`, curated paywall gate fires `onPaywallRequired?.()` and returns silently if `isCurated && !canAccessCurated`, then `setIsSaving(true)` → `await onSave(card)` → catch surfaces native `Alert.alert(t('common:error'), ...)`. No visibility into which branch fires.

**What it does now:** `handleSave` body replaced with instrumented version. Logic UNCHANGED — only `console.log('[ORCH-0685]', ...)` calls added at: function entry (with state + card fingerprint + curated flags + canAccessCurated + onPaywallRequired/onSave defined-status), `isSaving` early-return, `paywall gate fired` log when `isCurated && !canAccessCurated` triggers `onPaywallRequired?.()` (this is one of the four hypothesized root cause patterns), before `await onSave(card)`, after onSave resolves cleanly, in the catch (with error message/code/raw), and in the finally. All instrumentation tagged `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]`.

**Why:** Dispatch §D.2. The paywall gate is one of the three plausible mechanisms cycle-2 forensics flagged. The `await onSave(card)` log boundary is critical for distinguishing Pattern D (onSave never reaches handleSaveSharedCard) from Patterns A/B/C.

**Lines changed:** ~+30 / -1 net.

---

### `app-mobile/src/services/savedCardsService.ts`

**What it did before:** `saveCard(profileId, card, source?)` (lines 67-116) constructed the upsert payload, called `supabase.from("saved_card").upsert(payload, { onConflict: "profile_id,experience_id" })`, swallowed 23505 (duplicate) silently with `console.warn`, threw all other errors. On success: recordActivity + fire-and-forget engagement RPC. No granular diagnostic visibility into the upsert call or the error code returned.

**What it does now:** Function body replaced with instrumented version. Logic UNCHANGED — only `console.log('[ORCH-0685]', ...)` calls added at: function entry (profileId/cardId fingerprints + title/category + image presence + sourceParam + cardSourceField), payload-prepared (full payload structure including card_data keys), before the upsert call, after the upsert returns (with errorIsNull / errorCode / errorMessage / errorDetails / errorHint — this is the critical line that surfaces RLS/schema/network failures), 23505-duplicate path warn-tagged with `[ORCH-0685]`, non-23505 error-path error-logged before re-throwing, success path log before recordActivity, and final completion log. All instrumentation tagged `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]`.

**Why:** Dispatch §D.3. The "saveCard upsert returned" log is the single most decisive diagnostic — if `errorCode` is non-null the root cause is empirically classified (e.g., `42501` = RLS denial; `23502` = NOT NULL violation; `PGRST...` = network / PostgREST issue). This collapses Pattern B from "plausible" to "proven" in one log line.

**Lines changed:** ~+45 / -3 net.

---

## E. Verification matrix

| Dispatch criterion | How verified | Status |
|--------------------|--------------|--------|
| Instrumentation logic-preserving (no behavioral change vs. cycle-1) | Direct read of each new function body — confirmed every original code path preserved; only `console.log` calls added at branch points. No new returns, no new awaits, no new state writes. | ✅ PASS |
| All `[ORCH-0685]` logs tagged `[TRANSITIONAL]` per Constitution #7 | Each function-body docstring has `[TRANSITIONAL — ORCH-0685-cycle2-v2 DIAGNOSTIC]` with explicit exit condition ("REMOVE in IMPL_v3 once root cause known. Exit condition: cycle-2 v3 final fix lands and the `[ORCH-0685]` log lines are stripped."). Shape 2a Modal block has `[TRANSITIONAL — ORCH-0685 cycle-2 v2 Shape 2a]` with exit condition ("if v3 switches to a global toast provider this entire block can be deleted"). | ✅ PASS |
| Shape 2a Modal correctly stacks above ExpandedCardModal | Verified by code review: second `<Modal>` mounted AFTER ExpandedCardModal in JSX order; RN renders modals in mount order with newer-on-top. `transparent={true}` + `presentationStyle="overFullScreen"` confirms no background dimming. | ✅ PASS (structural — runtime-confirmed at device test) |
| Pointer pass-through correct so Save/Close still tappable | Outer `<View pointerEvents="box-none">` lets taps fall through empty regions to underlying modal; per-notification `<View pointerEvents="auto">` makes the dismiss button tappable. Verified by code structure. | ✅ PASS (structural — runtime-confirmed at device test) |
| Inner per-notification JSX matches existing panel byte-for-byte | Read existing notifications panel at lines 1558-1592, copied verbatim into Shape 2a Modal inner. Same indicator color logic, same notification card structure, same dismissButton, same icon + size + color. | ✅ PASS |
| `Modal` is imported from `react-native` | Verified `Modal` already in the imports line (~line 14 of MessageInterface.tsx) — used by existing `<Modal>` for picker / image preview / more-options. | ✅ PASS |
| TypeScript compile — zero NEW errors | `cd app-mobile && npx tsc --noEmit` returned 3 errors, all pre-existing baseline (ConnectionsPage:2763 Friend cross-service; HomePage:246 + :249 SessionSwitcherItem state — same as cycle-1 IMPL §SC-16 baseline per ORCH-0680). Zero new errors introduced by cycle-2 v2. | ✅ PASS |
| Cycle-1 deliverables preserved | Direct grep + read confirms: `cardPayloadAdapter.ts` exists; `CardPayload` interface still has 22 fields; `trimCardPayload` v2 with extended drop order intact; `cardPayloadToExpandedCardData` import + usage at MessageInterface.tsx:945-950 intact; locale audit + CI gates not touched; categoryIcon fallback + sub-component wraps unchanged in ExpandedCardModal.tsx. | ✅ PASS |

---

## F. Test plan — operator-driven device test

This dispatch is incomplete without operator action on a real device. The operator MUST:

1. **Build**: either run `cd app-mobile && npx expo start --dev-client` for a Metro dev build (Recommended — exposes `console.log` directly to terminal), OR commit + push + 2 EAS Updates per §G below for a production build (note: production EAS build hides `console.log` unless wired to Sentry breadcrumbs).
2. **Open chat with a friend** (recommend the same conversation as today's test: `cc2ef75e-f062-43e8-997a-475ac60d4fea`).
3. **Tap any shared-card chat bubble → modal opens.**
4. **Tap Save ONCE.**
5. **Open JS console** (Metro terminal, or Sentry breadcrumbs panel, or `adb logcat *:S ReactNativeJS:V` on Android).
6. **Copy all `[ORCH-0685]` log lines** (5-15 lines from Save tap onward) and paste back to orchestrator.
7. **ALSO note**: did a toast appear visibly on screen? Did the button transition to "Saved"? Either is diagnostic.

The orchestrator will match the log output against 4 expected patterns (A/B/C/D per dispatch §E T-D-01) and write IMPL_v3 with the targeted fix + log cleanup.

---

## G. Commit message + EAS Update commands

### Commit message (no Co-Authored-By per memory rule)

```
diag(chat): ORCH-0685 cycle-2 v2 — instrumented Save flow + Shape 2a notifications-Modal

- Empirical MCP probes via Supabase mcp__execute_sql proved cycle-2 forensics
  conclusion ("Save IS working — only toast hidden") was WRONG. saved_card has
  zero inserts in last 4 days; recipient's chat-Save tap today did not insert.
  The save is genuinely broken at an unknown branch point.

- This commit ships an INSTRUMENTED build — NOT a final fix:
  * console.log statements at every branch in MessageInterface.handleSaveSharedCard,
    ActionButtons.handleSave, and savedCardsService.saveCard (all tagged
    [ORCH-0685] for grep + clean-up later)
  * Shape 2a second Modal so the error toast (if any) becomes visible above
    the chat-mounted ExpandedCardModal — RC-1 from cycle-2 forensics still
    holds as a contributing factor

- After this ships: operator taps Save on real device, copies [ORCH-0685]
  console output, orchestrator dispatches forensics to interpret + writes
  IMPL_v3 with the targeted fix.

- All cycle-1 deliverables preserved (CardPayload widening, typed cast helper,
  locale audit, CI gates, categoryIcon fallback).

- All instrumentation tagged [TRANSITIONAL] — to be removed in IMPL_v3.
```

### EAS Update commands (TWO separate invocations per memory rule)

```bash
cd app-mobile && eas update --branch production --platform ios --message "ORCH-0685 cycle-2 v2: instrumented diagnostic + Shape 2a notifications-Modal"
cd app-mobile && eas update --branch production --platform android --message "ORCH-0685 cycle-2 v2: instrumented diagnostic + Shape 2a notifications-Modal"
```

⚠️ **Recommendation:** if the operator wants the granular branch-by-branch log evidence (the primary diagnostic output), use a **Metro dev build** (`npx expo start --dev-client`) instead of consuming the EAS production update. Production builds hide `console.log` output unless wired to Sentry breadcrumbs. The Shape 2a notifications-Modal will surface visible toast feedback either way.

---

## H. Invariant verification

| Invariant ID | Preserved? | Notes |
|--------------|-----------|-------|
| **I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS** (ORCH-0667) | ✅ YES | Required fields `{id, title, category, image}` never dropped. Trim function untouched in cycle-2 v2. |
| **I-DM-PARTICIPANTS-ONLY** (RLS) | ✅ YES | No policy change. |
| **I-MESSAGE-IMMUTABILITY** | ✅ YES | No UPDATE on card messages. |
| **I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS** (cycle-1) | ✅ YES | Trim function body unchanged in this cycle; saveCard logging only adds `console.log` and does NOT extract any recipient-relative field. CI gate would still pass. |
| **I-LOCALE-CATEGORY-PARITY** (cycle-1) | ✅ YES | Locale JSONs untouched. |
| **I-MODAL-CATEGORY-SUBCOMPONENT-WRAPS** (cycle-1) | ✅ YES | ExpandedCardModal.tsx untouched. |

---

## I. Constitutional compliance

| # | Principle | Status |
|---|-----------|--------|
| **#1** | No dead taps | ⚠️ The Save tap is STILL not producing user-visible feedback at the user level, BUT the diagnostic now produces console output AND error toast (via Shape 2a). The dead-tap appearance is the symptom this dispatch is diagnosing — the final fix lands in IMPL_v3. |
| **#2** | One owner per truth | ✅ No new state authorities introduced. |
| **#3** | No silent failures | ✅ IMPROVED — every branch in the Save chain now logs to console. Save errors that catch into `showNotification` will now ALSO surface visibly via the Shape 2a Modal, on top of the console log. The toast-hiding pattern that masked failures is structurally fixed (at least for the chat-mounted flow). |
| **#5** | Server state stays server-side | ✅ Zustand untouched. |
| **#7** | Label temporary fixes | ✅ STRENGTHENED — every instrumentation block + the Shape 2a Modal block is explicitly tagged `[TRANSITIONAL]` with named exit condition. Implementation report has a §J transition register. |
| **#8** | Subtract before adding | ✅ Cycle-1's correct logic preserved without modification; only `console.log` calls added at branch points. No code subtraction needed. |
| **#9** | No fabricated data | ✅ saveCard schema-prep code unchanged; trim function unchanged. No new fallback literals introduced. |

No new constitutional violations introduced.

---

## J. Transition register (the [TRANSITIONAL] markers)

Per Constitution #7, every transitional code block must be registered:

| Location | What is temporary | Exit condition |
|----------|-------------------|----------------|
| `MessageInterface.tsx` `handleSaveSharedCard` body — every `console.log('[ORCH-0685]', ...)` line + the docstring marker | Diagnostic logging at every branch point — produces 5-10 console lines per Save tap | IMPL_v3 lands with targeted fix; the orchestrator instructs implementor to grep `[ORCH-0685]` and remove all matching lines from this file |
| `ActionButtons.tsx` `handleSave` body — same pattern | Same diagnostic logging | Same IMPL_v3 cleanup |
| `savedCardsService.ts` `saveCard` body — same pattern | Same diagnostic logging | Same IMPL_v3 cleanup |
| `MessageInterface.tsx` Shape 2a second `<Modal>` block (`{showExpandedCardFromChat && notifications.length > 0 && (<Modal>...)}`) | Conditionally-rendered second Modal that stacks above ExpandedCardModal so toasts become visible | If IMPL_v3 ships a global toast provider (Shape 3 from cycle-2 forensics), this entire block can be deleted because the global provider would render above all modals via portal. Otherwise the block stays as the structural fix for the modal-portal toast-hiding mechanism. |

**4 transitional code regions total. All grep-able via `[ORCH-0685]` (logs) + `Shape 2a` (Modal block).**

---

## K. Cache safety check

- **Did any query keys change?** No.
- **Did any mutation change?** No — saveCard logic unchanged; only logging added.
- **Did any data shape change?** No.
- **AsyncStorage compatibility?** Unchanged — no persistence touched.

---

## L. Parity check

Sender vs. recipient axis unchanged — both still flow through the same single `<ExpandedCardModal>` mount + same Save handler. Solo/collab axis: chat-mount hardcodes `currentMode="solo"` per cycle-1's deferred D-7 — preserved unchanged.

---

## M. Regression surface (for orchestrator to flag tester)

The 4 most likely regression-risk surfaces from this change:

1. **Modal interactions during a toast** — does the Shape 2a Modal correctly let taps pass through? T-D-03 in dispatch §E covers this.
2. **Auto-dismiss timing** — `showNotification` already does `setTimeout(..., 3000)` to remove from state. The second-Modal re-renders + unmounts when `notifications.length` drops to 0. Verify smooth fade-out animation per dispatch test plan T-D-01 step 7.
3. **Other chat-mounted modals** — picker (`showSavedCardPicker`), more-options sheet, image-preview — they're all separate `<Modal>` mounts. The Shape 2a Modal renders only when `showExpandedCardFromChat` is true, so it shouldn't conflict. But verify no z-order surprises if both are open simultaneously.
4. **Console log volume in production** — if the operator deploys a production EAS Update with these logs, they'll fire on every shared-card Save tap. Logs are tagged `[ORCH-0685]` so they're easy to grep but represent a brief spam in the production console. Acceptable for a diagnostic build that's expected to land + be cleaned up within ~75-110 min round-trip.

---

## N. Discoveries for orchestrator

| ID | Title | Action |
|----|-------|--------|
| **ORCH-0685.cycle2v2.D-1** | Existing notifications panel uses `styles.dismissButton` (line 1585), not `styles.notificationDismiss` as the dispatch example mentioned. Implementor matched the existing style name. | No-op — already handled in this implementation. |
| **ORCH-0685.cycle2v2.D-2** | Cycle-1 IMPL changes are still uncommitted to `origin/Seth` (per `git status`). The combined commit recommended in §G includes BOTH cycle-1 and cycle-2 v2 changes. The orchestrator/operator should decide whether to: (a) make ONE big commit that's "ORCH-0685 cycle-1 + cycle-2 v2 instrumented", OR (b) make TWO commits in sequence (cycle-1 first, then cycle-2 v2 on top). The §G commit message draft assumes (a). | Operator decides. Recommend (a) for simplicity. |
| **ORCH-0685.cycle2v2.D-3** | The cycle-2 forensics report at `reports/INVESTIGATION_ORCH-0685_cycle2_SAVE_DEAD_TAP.md` retains its original "RC-1: Save IS working" claim. Per AH-237 that claim is FALSIFIED. The report should not be re-cited as authoritative; cite AH-236/AH-237 + this implementation's evidence trail instead. | Orchestrator follow-up — either add a "RC-1 FALSIFIED" preamble to the report, or supersede it with a v2 forensics report after IMPL_v3 lands. |
| **ORCH-0685.cycle2v2.D-4** | If IMPL_v3's targeted fix is structural (e.g., resolves Pattern A by re-wiring `currentUserId` propagation, or Pattern B by fixing a payload-shape that triggers RLS), the Shape 2a notifications-Modal block in this commit becomes redundant — toasts wouldn't fire because the save would just succeed. Decision for IMPL_v3 cycle: keep Shape 2a (resolves HF-1 from cycle-2 forensics) OR delete it (cleaner code if no longer needed). | Defer to IMPL_v3 cycle. |
| **ORCH-0685.cycle2v2.D-5** | Production EAS Update path may hide `console.log` output unless wired to Sentry breadcrumbs. The `breadcrumbs` import in `TrackedTouchableOpacity.tsx` suggests breadcrumbs infrastructure exists. If production-only operator can't access Metro, IMPL_v3 dispatch should consider switching `console.log('[ORCH-0685]', ...)` to `breadcrumbs.add(...)` so the log evidence reaches Sentry. Out of scope for this dispatch — the user authorized switching to dev build per orchestrator. | Defer if dev build works; revisit if operator can only do production EAS. |

---

## O. Status

**Implementation: code-complete, partially verified.**

- 4/4 dispatch deliverables applied (D.1 + D.2 + D.3 + D.4)
- 3/3 instrumented function bodies tagged `[TRANSITIONAL]` with named exit conditions
- 1/1 Shape 2a Modal block tagged `[TRANSITIONAL]`
- TypeScript baseline preserved (3 pre-existing baseline errors, zero new)
- Inner JSX of Shape 2a Modal mirrors existing notifications panel byte-for-byte
- All cycle-1 invariants preserved
- Constitution #7 (label temporary fixes) STRENGTHENED via §J transition register

**Pending operator actions:**

1. Decide commit strategy (single big commit per §G OR sequential cycle-1 + cycle-2 v2 commits per D-2)
2. Push to `Seth` branch
3. EITHER: run `npx expo start --dev-client` for Metro dev build (recommended for granular console.log access) OR publish iOS + Android EAS Updates (separate invocations) for production build
4. Tap Save once on chat-shared modal; copy `[ORCH-0685]` console output (5-15 lines)
5. Paste console output back to orchestrator
6. Orchestrator interprets log → IMPL_v3 dispatch with targeted fix + diagnostic cleanup

**Cascade:** None — no coupling to ORCH-0684 / ORCH-0686 / ORCH-0688 (parallel tracks).
