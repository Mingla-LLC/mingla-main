# IMPLEMENTATION REPORT — ORCH-0664 (DM Realtime Receive Dedup) — Cycle 2 Re-apply

**Status:** `implemented and verified` (all 8 mandatory gates PASS, including negative-control reproduction)
**Cycle:** 2 of 2 (cycle-1 was lost when parallel ORCH-0666/0667/0668 work overwrote the working tree; this cycle re-applied the same binding contract surgically)
**Spec:** `specs/SPEC_ORCH-0664_DM_REALTIME_DEDUP.md`
**Investigation:** `reports/INVESTIGATION_ORCH-0663_0664_0665_CHAT_TRIPLE.md`
**Architecture choice:** Option B (locked in spec §0)
**OTA-safe:** YES — no native, no migration, no edge fn
**Files touched (this cycle):** 4 source/registry files net (2 already had cycle-1 work survive on HEAD: MessageInterface.tsx + ci-check-invariants.sh)
**Date:** 2026-04-25

---

## §A — Layman summary

Every friend's incoming DM was being silently dropped from the chat UI until the user closed and reopened the conversation. The fix re-couples the dedup tracking to actual UI mutation: the broadcast handler now hands incoming messages to a single owner in `ConnectionsPage` (`addIncomingMessageToUI`), which calls `setMessages` and THEN marks the message as "seen." The postgres_changes backup path also funnels through the same owner, so whichever delivery path arrives first wins and the other becomes a clean idempotent no-op. CI gate prevents the bug class from coming back.

---

## §1 Pre-flight verification (per dispatch §"Mandatory pre-flight")

| # | Item | Verification | Status |
|---|------|--------------|--------|
| 1 | `useBroadcastReceiver.ts:51` had `broadcastSeenIds.current.add(msg.id);` | Read pre-edit; confirmed | ✓ |
| 2 | `MessageInterface.tsx:235-241` had no-op `handleBroadcastMessage` block | **Found cycle-1 cleanup survived on HEAD** — block already deleted; props interface already has required `onBroadcastReceive` (L120-129); destructure at L158; comment block at L250-259. Skipped re-edit. | ✓ (already done) |
| 3 | `ConnectionsPage.tsx:1513-1518` had inline `alreadyDelivered` check + `if (!alreadyDelivered)` block | Read pre-edit; confirmed (no helper extraction, no `addIncomingMessageToUI`, no `handleBroadcastReceive`) | ✓ |
| 4 | `ConnectionsPage.tsx:1907-area` had sender-side `broadcastSeenIds.current.add(sentMessage.id);` (LEGITIMATE — DO NOT MODIFY) | Read pre-edit; confirmed at L1936 pre-helper-insertion; LEFT UNCHANGED post-edit (now at L1944 due to helper insertion shifting subsequent lines) | ✓ |
| 5 | `useBroadcastReceiver.ts:45` had sender-multi-device defense `if (msg.sender_id === currentUserId) return;` | Read pre-edit; confirmed; LEFT UNCHANGED | ✓ |
| 6 | `messages` table is in `supabase_realtime` publication | Confirmed via grep at `20260310000002_create_user_push_tokens_and_realtime.sql:59` | ✓ |
| 7 | Sender's send broadcast at L1909-1923 unchanged from current HEAD | Read pre-edit; confirmed; LEFT UNCHANGED post-edit | ✓ |

**All 7 pre-flight checks PASS.** Cycle-2-specific finding: cycle-1 work on `MessageInterface.tsx` + `scripts/ci-check-invariants.sh` SURVIVED the working-tree overwrite from parallel chats. Only `useBroadcastReceiver.ts` + `ConnectionsPage.tsx` + `INVARIANT_REGISTRY.md` + `ROOT_CAUSE_REGISTER.md` needed re-application this cycle.

---

## §2 Files changed — Old → New receipts

### File 1: `app-mobile/src/hooks/useBroadcastReceiver.ts` (+13 / -3, net +10)

**What it did before:**
The broadcast event handler at L41-53 marked `broadcastSeenIds.current.add(msg.id)` BEFORE calling `onBroadcastMessageRef.current(msg)`. Pre-emptive seen-set add decoupled from any guarantee that the delegate actually mutated UI state. Combined with cycle-1's no-op delegate, this made postgres_changes' backup path silently skip its `setMessages` add.

**What it does now:**
- Pre-emptive `broadcastSeenIds.current.add(msg.id)` at L51 REMOVED.
- Defensive `has()` check at L48 KEPT (now defends against rare double-fire of same broadcast event).
- Multi-line protective comment block added explaining `I-DEDUP-AFTER-DELIVERY`, why population is the delegate's job, and pointing at the CI gate that enforces this file stays free of seen-set mutation calls.

**Why:** spec §4 "Layer: Hook" + RC-0664 structural fix.

### File 2: `app-mobile/src/components/ConnectionsPage.tsx` (+128 / -82, net +46)

**What it did before:**
`setupRealtimeSubscription.onMessage` (L1509-1592) inlined ~80 lines of message-add logic. NO callback into MessageInterface for the broadcast path — relying on the (broken) intent that postgres_changes would be the sole UI delivery. NO helper. NO `handleBroadcastReceive`. JSX render of `<MessageInterface>` at L2190-area didn't pass `onBroadcastReceive` (TypeScript would have caught this once the prop became required, but cycle-1's prop addition went un-paired with this prop pass — that's the ORCH-0664-internal half-state that this cycle resolved).

**What it does now:**
- New `useCallback` `addIncomingMessageToUI(newMessage, conversationId, userId)` at L1497-1592 (~95 lines including JSDoc) owns the message-add funnel for both delivery paths.
  - Body extracted from previous inline `onMessage`, with one structural change: `broadcastSeenIds.current.add(newMessage.id)` is placed INSIDE the `if (!alreadyDelivered) { ... }` block, AFTER `setMessages` (L1550). Cache + conversation-list + mark-as-read side effects ALWAYS run idempotently outside the gate.
  - `useCallback` deps: `[transformMessage]`. Other captured identifiers (`setMessages`, `setMessagesCache`, `setConversations`, `messagingService`, `broadcastSeenIds`) are stable references (state setters / module imports / refs) per React conventions — no deps required.
  - JSDoc references the sender-side legitimate exception explicitly so future reviewers know NOT to "consolidate" L1944 into the helper.
- New `useCallback` `handleBroadcastReceive(msg)` at L1605-1612. Calls `addIncomingMessageToUI(msg, currentConversationId, user.id)` with null guards. Deps: `[currentConversationId, user?.id, addIncomingMessageToUI]`.
- `setupRealtimeSubscription.onMessage` body collapsed from ~80 lines to a single line: `addIncomingMessageToUI(newMessage, conversationId, userId);` (L1623-1627). No logic regression — same parameters, same flow.
- JSX render at L2235 now passes `onBroadcastReceive={handleBroadcastReceive}` to `<MessageInterface />` between existing `broadcastSeenIds={broadcastSeenIds}` and `isOffline={isOffline}` props.
- `onMessageUpdated` (read-receipt UPDATE handler) at the new L1632-1648 (was L1601-1617 pre-helper-insertion) is **untouched**.
- Sender-side `broadcastSeenIds.current.add(sentMessage.id)` at L1944 (was L1936 → L1944 due to helper insertion line shift) is **untouched** — documented legitimate exception per `I-DEDUP-AFTER-DELIVERY` clause.

**Why:** spec §4 "Layer: Component — ConnectionsPage" Changes 1-4.

### File 3: `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+58 / -0)

**What it did before:**
Tracked invariants from prior ORCHs. Top entry was ORCH-0672's `I-COUPLED-DIFF-NEVER-PARTIAL-COMMIT` (added earlier this session).

**What it does now:**
Adds `## ORCH-0664 invariant (2026-04-25) — DM realtime dedup ordering` section between ORCH-0672 and ORCH-0558 entries. Documents `I-DEDUP-AFTER-DELIVERY` with rule, why-it-exists with RC-0664 reference, 4-prong enforcement (code review checklist + CI gate + required-prop contract + 3-site protective comments), bash negative-control test, and the legitimate exception clause for sender-side L1944 add.

**Why:** spec §7 + §9 documentation lock-in.

### File 4: `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` (+11 / -1)

**What it did before:**
Listed older root causes (RC-001 onward). Header date stale at 2026-03-30.

**What it does now:**
- Header date bumped to 2026-04-25.
- New `### RC-0664: DM Realtime Receive Silently Dropped (Pre-emptive Dedup)` entry at the top of the Root Causes section. Discovery date, proof reference (investigation chain), symptoms, full causal chain (broadcast hook → no-op delegate → postgres_changes seen-set check → silent skip), structural fix (single owner helper + required prop + CI gate), status (Fixed cycle-2), invariant link (I-DEDUP-AFTER-DELIVERY), recurrence vector (any future seen-set/idempotency-cache must populate AFTER work, not before delegation).

**Why:** spec §9 documentation lock-in.

### Files NOT touched this cycle (cycle-1 work survived on HEAD)

- `app-mobile/src/components/MessageInterface.tsx` — props interface + destructure + comment block already correct from cycle-1
- `scripts/ci-check-invariants.sh` — I-DEDUP-AFTER-DELIVERY gate already added at L188-209 from cycle-1

---

## §3 Gate results

| Gate | Command | Expected | Actual | Status |
|------|---------|----------|--------|--------|
| **G-1** | `cd app-mobile && npx tsc --noEmit` | Exit 0 OR errors only on baseline files | 4 errors total, ALL on parallel-work files (`ConnectionsPage:2235` ORCH-0666 `onOpenAddToBoardModal` baseline; `ConnectionsPage:2756` ORCH-0666 Friend type cross-service mismatch baseline; `HomePage:238/241` ORCH-0661 follow-up `state` prop baseline). **ZERO new errors introduced by this cycle.** | ✓ PASS for ORCH-0664 surface |
| **G-2** | `bash scripts/ci-check-invariants.sh` | I-DEDUP-AFTER-DELIVERY portion clean | I-DEDUP-AFTER-DELIVERY check passes silently between sibling checks. Overall script exit 1 due to PRE-EXISTING `I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` failure for `fetch_local_signal_ranked` (no defining migration found) — orthogonal baseline failure flagged in chat 11 handoff brief, NOT introduced by this cycle. | ✓ PASS for ORCH-0664 portion |
| **G-3** | `grep -nE "broadcastSeenIds\.current\.add\(" app-mobile/src/hooks/useBroadcastReceiver.ts` | Zero matches | Zero matches | ✓ PASS |
| **G-4** | `grep -nE "broadcastSeenIds\.current\.add\(" app-mobile/src/components/ConnectionsPage.tsx` | Exactly 2 actual code adds (helper + sender L1944-area) + acceptable JSDoc mention | 3 grep hits: L1511 (JSDoc string mentioning the sender-side line — informational), L1550 (NEW helper add inside `if (!alreadyDelivered)` block AFTER setMessages), L1944 (sender-side, UNCHANGED — legitimate exception). 2 actual code adds as required. | ✓ PASS |
| **G-5** | `grep -c "handleBroadcastMessage" app-mobile/src/components/MessageInterface.tsx` | Zero | Zero matches | ✓ PASS |
| **G-6** | `grep -c "onBroadcastReceive" app-mobile/src/components/MessageInterface.tsx` | ≥2 | 4 matches (interface declaration L129 + JSDoc L121 + destructure L158 + pass to useBroadcastReceiver L255-area) | ✓ PASS |
| **G-7** | Negative-control reproduction | Inject violation → gate exit 1; revert → gate exit 0 | See §4 — full reproduction proven both directions | ✓ PASS |
| **G-8** | `grep -n "^### I-DEDUP-AFTER-DELIVERY" Mingla_Artifacts/INVARIANT_REGISTRY.md` | Exactly one match | 1 match at L72 | ✓ PASS |

**All 8 mandatory gates PASS for ORCH-0664 surface.**

---

## §4 Negative-control reproduction (G-7 detail)

**Step 1 — Establish clean baseline:** `bash scripts/ci-check-invariants.sh` — output between "Checking I-DEDUP-AFTER-DELIVERY..." and the next sibling check ("Checking I-NO-TOAST-CARD-SHARED-STRINGS...") is silent — no FAIL message between → my gate passing.

**Step 2 — Inject violation:**
```bash
cp app-mobile/src/hooks/useBroadcastReceiver.ts /tmp/useBroadcastReceiver.ts.backup
sed -i "s|// Deliver — delegate is responsible|broadcastSeenIds.current.add(msg.id);\n        // Deliver — delegate is responsible|" app-mobile/src/hooks/useBroadcastReceiver.ts
```
Verification: `grep -n "broadcastSeenIds.current.add" app-mobile/src/hooks/useBroadcastReceiver.ts` → `56:        broadcastSeenIds.current.add(msg.id);`

**Step 3 — Run gate (expect exit 1):**
```
Checking timeAway field resurrection...
Checking I-DEDUP-AFTER-DELIVERY...
FAIL: I-DEDUP-AFTER-DELIVERY violated. ORCH-0664 forbids
   'broadcastSeenIds.current.add(' inside useBroadcastReceiver.ts.
   Population belongs in the delegate (ConnectionsPage.
   addIncomingMessageToUI), AFTER setMessages succeeds. Hit lines:
56:        broadcastSeenIds.current.add(msg.id);
```
Gate fired. Descriptive error names the file, the line, and points at the correct delegate.

**Step 4 — Revert:**
```bash
cp /tmp/useBroadcastReceiver.ts.backup app-mobile/src/hooks/useBroadcastReceiver.ts
```
Verification: `grep -n "broadcastSeenIds.current.add" app-mobile/src/hooks/useBroadcastReceiver.ts` → "NO MATCHES (clean revert)"

**Step 5 — Run gate (expect clean):**
```
Checking I-DEDUP-AFTER-DELIVERY...
Checking I-NO-TOAST-CARD-SHARED-STRINGS...
```
Silent between checks → my gate passes again.

**Negative-control proves:** the gate fires correctly on violation (descriptive error identifies the file + line) and exits clean on healthy code. The gate is real, not decorative.

---

## §5 Diff summary

```
useBroadcastReceiver.ts          +13 / -3   (net +10  — protective comment, removed pre-emptive add)
ConnectionsPage.tsx              +128 / -82 (net +46  — extracted helper, simplified onMessage, added handleBroadcastReceive, added prop in JSX)
INVARIANT_REGISTRY.md            +58 / 0    (new section)
ROOT_CAUSE_REGISTER.md           +11 / -1   (new RC entry, date bumped)
                                 ─────
                                 +210 / -86  (net +124 across 4 files)
```

**Spec budget vs actual:** spec said `+35/-10 LOC across 3 files`. Actual source-code delta on the 2 .ts/.tsx files is `+141 / -85`. The overshoot is dominated by:

1. **`ConnectionsPage.tsx` extraction:** spec assumed straight body move (`+1` for function signature, ~80-line move counted as both add and delete by git). My JSDoc + the new `handleBroadcastReceive` callback add ~28 lines. Net behavioral change is the small surgical fix; line count is dominated by the verbatim body extraction.
2. **Multi-line protective comments:** spec §4 explicitly mandated multi-line protective comment blocks. ~22 comment lines total.
3. **Documentation lock-in (INVARIANT_REGISTRY + ROOT_CAUSE_REGISTER):** spec §8/§9 mandated these but didn't enumerate line counts.

**Confirmed: no scope expansion. Every line traces back to a spec requirement.**

---

## §6 Constitutional preservation

| # | Principle | Preservation |
|---|-----------|--------------|
| **#2** | One owner per truth | **RESTORED.** Pre-fix had two owners of "is this message delivered" (broadcast hook claimed via seen-set add; CDC handler was the only one writing UI). Post-fix: ONE owner — `addIncomingMessageToUI` — both delivery paths funnel through it. |
| **#3** | No silent failures | **IMPROVED.** Pre-fix silently dropped every receiver-side message. Post-fix: message arrives via at least one path; existing `console.error` paths preserved (e.g., `messagingService.markAsRead([...]).catch(console.error)`). |
| **#8** | Subtract before adding | **HONORED.** Deleted: pre-emptive seen-set add (1 line) + 80-line inline `onMessage` body (replaced with single-line delegate). Added: 1 line in helper (the seen-set add, now correctly placed) + helper extraction (same 80 lines, now reusable across delivery paths) + 6-line `handleBroadcastReceive` + protective comments. |
| All others | Not relevant to this change. | N/A |

---

## §7 Sender-path regression check

| Sender-side site | Pre-fix line | Post-fix line | Status |
|------------------|--------------|---------------|--------|
| `broadcastSeenIds.current.add(sentMessage.id);` (sender-side legitimate exception) | L1907 (pre-cycle-1) | L1944 (post-cycle-2; line shift caused by helper insertion above) | ✓ UNCHANGED |
| Sender broadcast `supabase.channel(channelName).send({...})` | L1909-1923 (pre-cycle-1) | L1946-1959 (post-cycle-2 line shift) | ✓ UNCHANGED |
| Sender's optimistic-replace path | L1880-1894 (pre-cycle-1) | shifted (post-cycle-2 line shift) | ✓ UNCHANGED |
| `useBroadcastReceiver.ts:45` `if (msg.sender_id === currentUserId) return;` | L45 | L45 | ✓ UNCHANGED |

**Sender flow is fully preserved.** The legitimate exception to I-DEDUP-AFTER-DELIVERY (sender's pre-emptive add — sender already mutated UI via optimistic-replace) is documented in INVARIANT_REGISTRY entry's "Exception (legitimate)" clause AND in the helper's JSDoc to prevent future "consolidation" attempts.

---

## §8 Spec traceability

| SC | Criterion | Verification |
|----|-----------|--------------|
| **SC-1** | Receiver UI updates within 1s of sender's send (broadcast path) | UNVERIFIED (requires two-device live-fire — T-09, user-owned) |
| **SC-2** | postgres_changes path fully functional when broadcast unavailable | UNVERIFIED (requires manual broadcast disconnect injection — T-02, user-owned) |
| **SC-3** | Both paths deliver same id → exactly one bubble (no duplicate) | Code-proven: `addIncomingMessageToUI` is idempotent — second call sees `alreadyDelivered=TRUE`, skips setMessages. Live-fire T-03 still wanted. |
| **SC-4** | Sender's optimistic-replace still works (own CDC echo doesn't re-add) | Code-proven: §7 above; sender L1944 add unchanged, CDC echo hits `alreadyDelivered=TRUE`, skips. Live-fire T-04 still wanted. |
| **SC-5** | Mark-as-read still fires for incoming messages | Code-proven: `markAsRead` call moved from inline onMessage to helper, runs unconditionally outside the dedup gate. Same call signature. |
| **SC-6** | Chat-list "last message" preview still updates | Code-proven: `setConversations` block runs unconditionally outside the dedup gate. Same logic as pre-extraction. |
| **SC-7** | unread_count not inflated for currently-open chat | Code-proven: helper preserves the existing comment + behavior — does NOT increment unread_count. |
| **SC-8** | `broadcastSeenIds` cleared on `handleBackFromMessage` | Verified: `handleBackFromMessage` at L1668-1684 still calls `broadcastSeenIds.current.clear()` — unchanged from HEAD (line shift only). |
| **SC-9** | CI grep gate catches future re-introduction | Verified via G-7 negative-control reproduction (§4). |
| **SC-10** | TypeScript `tsc --noEmit` exits 0 | Partial: 0 NEW errors. Baseline 4 errors are pre-existing parallel work (ORCH-0666 prop drift + Friend type baseline + HomePage state-prop baseline) — explicitly out of dispatch scope per "do not re-architect ORCH-0661" / "do not bundle parallel work" constraints. |
| **SC-11** | T-09 two-device live-fire matrix | UNVERIFIED (user-owned live-fire) |

**SC-1, SC-2, SC-3 (live), SC-4 (live), SC-11:** require physical device live-fire. Implementor cannot run two-device tests headlessly. Tester or user owns these.

**SC-5..SC-10:** code-proven and gate-proven.

---

## §9 Solo / collab parity

**N/A** per spec §10. DMs are friend-only. Collab session messages route through `BoardDiscussionTab` + `realtimeService.subscribeToBoardSession` + `board_messages` table with a different channel name (`board:${sessionId}`) and a different hook (NOT `useBroadcastReceiver`). Confirmed via grep — `subscribeToConversation` and `useBroadcastReceiver` each used by exactly one caller (ConnectionsPage and MessageInterface).

---

## §10 Cache safety

- **No query-key changes.** No React Query factory touched.
- **`messagesCache` shape unchanged.** Same `Record<string, Message[]>` keyed by conversationId. Same `optimisticIndex` replace logic.
- **`broadcastSeenIds` ref shape unchanged.** Same `MutableRefObject<Set<string>>`. Population timing changed (now after setMessages), not shape.
- **AsyncStorage compat:** unchanged. The `persistMessages` path consumes `messagesCache[currentConversationId]` — no shape change, no migration needed for existing persisted state.

---

## §11 Regression surface (for tester — 5 adjacent features most likely to break)

1. **Sender-side optimistic message render** — when you send, your message should still appear instantly with `id: temp-...`, then get replaced by real id on server return. T-04 verifies.
2. **Sender's own CDC echo not re-adding** — when you send, the postgres_changes echo of your own write should NOT add a duplicate. Sender's L1944 seen-set add prevents this (legitimate exception). Verify own messages render exactly once.
3. **Read receipts (`onMessageUpdated`)** — when receiver marks as read, sender's UI should update. Code path UNCHANGED at the new L1632-1648. Verify "Seen" indicator still appears.
4. **Chat-list last-message preview** — for ANY incoming message (including in conversations not currently open), the chat-list row should update its preview. Helper preserves this. Verify with two open conversations.
5. **Reconnect after offline** — backgrounding the app for 5min while messages flow should not break realtime upon foreground. The `prevIsOfflineRef.current` reconnect path at L1471-1498 calls `setupRealtimeSubscription` again — unchanged. Verify no message duplication or loss across foreground transitions.

---

## §12 Discoveries for orchestrator

**None new from this cycle.** All work stayed within scope.

The pre-existing tsc baseline errors (HomePage state-prop, ConnectionsPage `onOpenAddToBoardModal`, Friend cross-service type) are previously-discovered and out of scope per dispatch constraints. They are tracked under their respective ORCH-0661 / ORCH-0666 / ORCH-0673-candidate work streams.

The pre-existing CI gate failure (`I-RPC-LANGUAGE-SQL-FOR-HOT-PATH` for `fetch_local_signal_ranked` with no defining migration) was flagged in chat 11 handoff brief as a known orthogonal baseline failure unrelated to ORCH-0664.

The original 3 ORCH-0664 discoveries (D-1 deprecated `useMessages.ts`, D-2 reconnect-on-foreground gap, D-3 broadcast-channel ownership consolidation / HF-0664-A) remain unchanged and out of scope per spec §1.

---

## §13 Constraints respected

- ✓ TypeScript strict, no `any`, no `as any`, no `as unknown`. The existing `payload.payload as DirectMessage` cast at useBroadcastReceiver.ts:42 unchanged (acceptable per spec §14).
- ✓ No new dependencies, no new npm packages.
- ✓ No new files (all changes within existing files + 2 markdown registries).
- ✓ No auto-formatted unrelated lines.
- ✓ Used existing `useCallback` patterns from the same file. Matched local style.
- ✓ Comments ≤2 lines except where spec explicitly mandated multi-line blocks.

---

## §14 Ready for tester

All 8 mandatory gates PASS. Negative-control reproduction PASSED both directions. Sender-path regression check confirms zero behavior change on send. Solo/collab parity confirmed N/A. Cache safety confirmed. Regression surface enumerated.

Tester actions:
1. Re-run G-1, G-3, G-4, G-5, G-6, G-7, G-8 independently.
2. Re-run G-7 negative-control reproduction independently (proves the gate is effectual).
3. Verify the diff matches §2 receipts (no scope creep, no unrelated touches).
4. Coordinate with founder on user-owned T-01..T-04, T-09, T-10 two-device live-fire.

---

## §15 Orchestrator hand-back — surgical commit prep needed

Working tree has parallel ORCH-0666/0667 work mixed into:
- `app-mobile/src/components/ConnectionsPage.tsx` — needs `git add -p` to capture only ORCH-0664 hunks (helper + handleBroadcastReceive + onMessage simplification + JSX prop pass)
- `app-mobile/src/components/MessageInterface.tsx` — already has cycle-1 ORCH-0664 hunks staged in index from prior chat (needs verification at commit time)
- `scripts/ci-check-invariants.sh` — has cycle-1 ORCH-0664 gate already staged + further parallel ORCH-0666/0667 gates added; needs `git add -p` to capture only ORCH-0664 portion if not already staged
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — needs `git add -p` to capture only the new I-DEDUP-AFTER-DELIVERY entry (other entries from prior commits already on HEAD)
- `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` — clean (zero parallel hunks expected)
- `app-mobile/src/hooks/useBroadcastReceiver.ts` — clean (zero parallel hunks expected)

Orchestrator REVIEW + commit-message + git-add allowlist for surgical staging requested. Recommend pathspec commit pattern (same as ORCH-0672 hotfix d566dab7) to preserve the 65-file ORCH-0667 pre-staged index.

---

## §16 Commit message draft (per spec §13)

```
fix(chat): ORCH-0664 DM realtime receive — couple seen-set add to UI mutation

Receiver-side broadcast handler was a deliberate no-op that pre-marked the
message id in broadcastSeenIds; postgres_changes then saw the seen flag and
skipped the setMessages add. Result: every DM receiver of every message was
silently dropped from UI until close+reopen.

Fix: extract addIncomingMessageToUI helper in ConnectionsPage. Both the
broadcast hook (via new required onBroadcastReceive prop on MessageInterface)
and postgres_changes onMessage funnel through it. Seen-set is populated
INSIDE the helper, AFTER setMessages has run. Establishes invariant
I-DEDUP-AFTER-DELIVERY (registered in INVARIANT_REGISTRY.md) + CI grep gate
in scripts/ci-check-invariants.sh to prevent recurrence. Negative-control
reproduction proves the gate fires on violation and clears on revert.

Sender-path is fully preserved: L1944 sender-side seen-set add (was L1907
pre-helper-insertion) is the documented legitimate exception (sender already
mutated UI via optimistic-replace) and unchanged. onMessageUpdated read-receipt
path unchanged.

No DB / native / edge fn changes — OTA-safe both platforms.

ORCH-0664 closes (cycle 2 of 2 — cycle 1 work was lost when parallel
ORCH-0666/0667/0668 work overwrote the working tree; cycle 2 re-applied
the same binding contract surgically).

Spec: specs/SPEC_ORCH-0664_DM_REALTIME_DEDUP.md
Investigation: reports/INVESTIGATION_ORCH-0663_0664_0665_CHAT_TRIPLE.md
RC: ROOT_CAUSE_REGISTER.md RC-0664
Invariant: INVARIANT_REGISTRY.md I-DEDUP-AFTER-DELIVERY
```
