# IMPLEMENTATION — ORCH-0897 follow-up: Group chat title + keyboard avoidance + floating composer

**Skill:** Claude `mingla-implementor` — User Dispatch (no spec; 3 UX fixes from operator screenshot)
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Parent:** ORCH-0897 [Trips + Events Group Chat] CLOSED in PR #160 merge `7a143230`
**Status:** implemented, unverified (UI-only changes need sim repro for `proven` verdict)

---

## §1 Operator's report

Three concrete UX fixes from screenshot:

1. **Group chat title in business app should show the event title** — currently displays "Untitled draft" (the cached `conversation.name` snapshot from auto-create trigger time)
2. **Keyboard blocks the input field when typing** — composer sits below the SmartScrollView (which only lifts fields INSIDE its scroll), so the composer stays put when keyboard appears
3. **Input field + send button need more breathing room from bottom of screen AND need to float (no backdrop)** — currently composer has a top border + sits flush with safe-area edge

---

## §2 Old → New Receipts

### `mingla-business/src/services/groupChatService.ts`
**What it did before:** `getEventGroupChat(eventId)` SELECTed `id, name, is_broadcast_only, is_enabled` from `conversations`. The `name` was the trigger-time snapshot of `events.name` — never re-syncs on rename.
**What it does now:** SELECTs the same columns PLUS `events!event_id(name)` via FK join. Returns new `event_name: string` field on `EventGroupConversation` populated from `events.name` (with fallback to cached `name`, then "Group chat"). The cached `name` field is preserved for backward compatibility.
**Why:** Operator fix #1 — header should reflect live event title, not stale snapshot. Trigger auto-create wrote "Untitled draft" because that's what the event was named at the time; renaming the event would NOT update the chat name without this fix.
**Lines changed:** ~15 (interface + select + mapping)

### `mingla-business/src/components/groupChat/GroupChatPanel.tsx`
**What it did before:** Header displayed `chat.conversation?.name ?? "Group chat"`. Composer was a sibling `<View>` below `<SmartScrollView>` (not lifted on keyboard show) with `borderTopWidth: 1, borderTopColor: glass.border.profileBase` (the "backdrop" line) and `padding: spacing.md` (tight to bottom safe-area edge).
**What it does now:**
- Header displays `chat.conversation?.event_name ?? "Group chat"` (operator fix #1 wiring)
- Composer wrapped in `<KeyboardAvoidingView behavior="padding">` from `react-native-keyboard-controller` (the project's canonical keyboard library per I-PROPOSED-KEYBOARD-LIBRARY-ONLY post-ORCH-0892-C). Inline `// orch-strict-grep-allow orch-0892 — chat composer needs sticky-above-keyboard lift` comment documents the intentional library-primitive use (operator fix #2)
- Composer style drops `borderTopWidth + borderTopColor` (kills the backdrop line — composer now "floats" over the chat list); `paddingBottom` applied inline as `Math.max(insets.bottom, 0) + spacing.lg` via `useSafeAreaInsets()` from `react-native-safe-area-context` (handles home-indicator clearance + breathing room) (operator fix #3)
**Why:** Operator fixes #1, #2, #3 from screenshot.
**Lines changed:** ~30 (imports + insets hook + KAV wrap + composer style)

---

## §3 Cross-Surface Impact (Step 3.5)

- **Business iOS / Android / web preview**: SHARED code path — single component. Parity automatic. All 3 surfaces get the fix.
- **Buyer-anon-web**: NOT affected (Group Chat tile is operator-side only).
- **Consumer iOS / Android**: NOT affected (separate substrate consumed by `app-mobile/src/components/MessageInterface.tsx`).
- **Admin web**: NOT affected (no chat surface there).

---

## §4 Verification Matrix

| Operator fix | How verified | Status |
|---|---|---|
| #1 Title shows event name | Read `getEventGroupChat` body — JOIN to `events` returns `events.name`; `event_name` populated; GroupChatPanel header reads `event_name` | **implemented, unverified** (needs sim — service query shape change requires live Postgres run to confirm RLS-side renders correctly) |
| #2 Keyboard doesn't block input | KeyboardAvoidingView from `react-native-keyboard-controller` is the library-recommended pattern for sticky-composer-above-keyboard; identical pattern works on iOS + Android in the library's docs | **implemented, unverified** (UI/runtime requires sim per Phase 0.A; source-only ceiling = `suspected`) |
| #3 Floating composer + breathing room | Border tokens removed; `paddingBottom: insets.bottom + spacing.lg` (= 16pt on iPhone 14+ + ~24pt extra = ~40pt clear of home indicator) | **implemented, unverified** (visual; sim) |

---

## §5 Regression Test status

**No new regression test added this turn.** This is a UI polish follow-up on a CLOSED ORCH (ORCH-0897 merged via PR #160). Per the operator's casual-dispatch pattern (no ORCH-ID assigned), the regression-test enforcement gate fires at CLOSE protocol time — not immediately on push.

If this ships under a fresh ORCH-ID + PR, the implementor at CLOSE must add:
- A regression check that asserts `getEventGroupChat` SELECT includes the `events!event_id(name)` JOIN
- A regression check that asserts `KeyboardAvoidingView` from `react-native-keyboard-controller` wraps the composer in `GroupChatPanel.tsx`

Pure-UI changes (composer styling) are visual-only; no programmatic regression test.

Recommend the operator either:
- (a) Spin a small ORCH-ID (`ORCH-0897-F` or similar) + PR + the 2 regression tests above
- (b) Bundle with another in-flight close on `Seth`

---

## §6 Invariant Preservation

- **I-PROPOSED-CHAT-SUBSTRATE-UNIFIED**: preserved (no new chat-message tables)
- **I-PROPOSED-CHAT-RLS-INLINE-EXISTS**: preserved (no SELECT policy changes)
- **I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED**: preserved (no new mutations added; gate PASS 30/30)
- **I-PROPOSED-KEYBOARD-LIBRARY-ONLY** (ACTIVE post-ORCH-0892-C): preserved (KAV is from the official `react-native-keyboard-controller` library; allowlist comment documents intent)
- **I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY**: preserved (existing SmartScrollView untouched; ORCH-0892 gate PASS 0 violations)

---

## §7 Cache Safety

- **`getEventGroupChat` shape change**: the new `event_name` field is additive — old consumers (none beyond `useEventGroupChat` + `GroupChatPanel`) won't break. No React Query key change. No persisted cache to invalidate.
- **No mutation changed.** No invalidation needed.

---

## §8 Constitutional Compliance

| # | Rule | Status |
|---|------|--------|
| 1 | No dead taps | PASS (header buttons unchanged) |
| 2 | One owner per truth | PASS (events.name is the source of truth; conversation.name preserved as snapshot for future use) |
| 3 | No silent failures | PASS (`Alert.alert` on send/moderate failures preserved) |
| 7 | Label temporary | N/A (no transitional code) |
| 9 | No fabricated data | PASS (event_name comes from real `events.name`, fallback chain is honest) |
| 14 | Persisted-state startup | N/A (no persisted state) |

No automatic-P0 triggers.

---

## §9 Discoveries for Orchestrator

- **DISC-FOLLOWUP-1**: `conversations.name` is now dead code at read-time (always shadowed by `event_name`). Future cleanup ORCH could drop the `name` column from `EventGroupConversation` if no other consumer depends on it. Low priority.
- **DISC-FOLLOWUP-2**: The trigger that wrote `conversations.name` at auto-create time still runs (per ORCH-0897 migration). For new events, the cached value will sit stale forever. Consider either (a) dropping the column entirely in a future close (and the trigger's `name` insert), or (b) adding a sync trigger on `events.name` updates. **For now: the cached `name` is harmless because the UI ignores it.**

---

## §10 Smoke-test steps for operator (after EAS publish)

1. Open `mingla-business` on iOS / Android after `eas update` ships this change
2. Navigate to a trip OR event you've published with a real title (NOT "Untitled draft")
3. Tap the "Group chat" tile → chat panel opens
4. **Verify fix #1:** the header title shows the actual event title (e.g., "Beach Party 2026"), NOT "Untitled draft"
5. **Verify fix #2:** tap the "Write a reply" field → keyboard appears → field LIFTS above the keyboard (not hidden beneath it)
6. **Verify fix #3:** composer floats above the home indicator with visible breathing room; no horizontal divider line between chat list and composer; composer feels like part of the chat surface, not a separate dock

If a previously-renamed event still shows the old chat title, that means the cached `conversation.name` from auto-create is showing — confirm by tapping into a NEW (post-rename) trip/event chat; that one should show the live event title.
