# IMPLEMENTATION — META-ORCH-1104 Phase 1 — Business Support REQUESTER UI

**Skill:** mingla-implementor (IMPLEMENT, Claude parity)
**Date:** 2026-06-08
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]/` on branch `meta-orch-1104-support-livechat-segmentation`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1104_…SEGMENTATION.md` §5 (Phase 1) + §2.10 (web quarantine) + §0.2
**Journey:** `JOURNEY_META-ORCH-1104_SUPPORT_WHERE_AND_FLOW.md` Journey 1
**Phase 0:** backend LIVE on production (tables, RLS, `create_support_ticket` RPC verified). No backend change in this work.
**Scope:** Phase 1 only — business requester entry + thread. NO admin, NO staff console, NO edge-fn deploy, NO migration.
**Status:** implemented and verified (static + unit + gate); native runtime + web-export device pass DEFERRED to TEST (no sim in this pass — see Verification Matrix).

---

## 0. Designer note (deviation, operator-directed)

SPEC §5 says Phase 1 "REQUIRES a `mingla-designer` DESIGN pass." Seth's IMPLEMENT dispatch
explicitly directed **NO designer dispatch — match existing UI patterns exactly (reuse-heavy)**.
Honored the operator directive: every screen reuses the established `account/notifications.tsx`
chrome (IconChrome back + centered title), `GlassCard`, `Pill`, `Button`, `Toast`, and the
`designSystem` tokens verbatim. No new visual language introduced.

---

## 1. What was built (mapped to SPEC §5.1)

| # | SPEC §5.1 item | Built |
|---|---|---|
| 1 | Entry mount on `account.tsx` | `SettingsNavRow` "Help & Support" (`icon="chat"`) under "Notifications", `onPress → /account/support`. |
| 2 | Help & Support screen | `app/account/support.tsx` — Start-a-chat button + optional subject field + "My support requests" list (status pills + empty/loading/error states). |
| 3 | Start-chat | calls LIVE `create_support_ticket(p_subject, p_brand_id)` via `useCreateSupportTicket` → navigates to `/support/[ticketId]`. |
| 4 | Support thread | `app/support/[ticketId].tsx` mounts platform-resolved `<SupportThread>` reusing the conversation-id chat substrate + `conversation:{id}` realtime. |
| 5 | Service/hook | `src/services/supportService.ts` + `src/hooks/useSupportTickets.ts` (RQ key `['support','tickets',userId]`, invalidate on create). Messages reuse `groupChatService` unchanged. |
| 6 | Push (D6, native-only) | best-effort `notify-support` invoke after create, try/catch no-op (fn not deployed yet); routing to `/support/[ticketId]` already shipped Phase 0. |

### `icon="help"` → `icon="chat"` (deviation)
SPEC §5.1 specified `icon="help"`. The business `Icon` union has **no `help` glyph** (verified
against `src/components/ui/Icon.tsx`). Used `icon="chat"` (the closest in-set semantic for a
live-chat support entry). Flagged for the designer/orchestrator if a dedicated lifebuoy glyph is
later wanted.

---

## 2. Files changed (committed on branch — see chat for closing hash)

| File | New/Mod | What |
|---|---|---|
| `mingla-business/app/(tabs)/account.tsx` | MOD | `handleSupport` callback + "Help & Support" `SettingsNavRow` (icon `chat`). |
| `mingla-business/app/account/support.tsx` | NEW | Help & Support screen (Start-a-chat + subject + ticket list, all states). |
| `mingla-business/app/support/[ticketId].tsx` | NEW | Thread route; resolves `ticketId`, mounts `<SupportThread>`. |
| `mingla-business/src/components/support/SupportThreadCore.tsx` | NEW | Shared, platform-agnostic thread (load/realtime/compose/send); takes `KeyboardWrap` prop. NO native keyboard import. |
| `mingla-business/src/components/support/SupportThread.native.tsx` | NEW | Native variant — injects the `react-native-keyboard-controller` `KeyboardAvoidingView`. |
| `mingla-business/src/components/support/SupportThread.tsx` | NEW | Web/default variant — Fragment passthrough keyboard wrapper (NO native module). |
| `mingla-business/src/services/supportService.ts` | NEW | `create`/`list`/`get` own tickets via RLS + `create_support_ticket` RPC + best-effort `notify-support`. |
| `mingla-business/src/hooks/useSupportTickets.ts` | NEW | `useSupportTickets` (list) + `useCreateSupportTicket` (mutation, invalidate). |
| `mingla-business/src/services/__tests__/supportService.test.ts` | NEW | Regression — happy + adversarial (8 cases). |
| `mingla-business/src/components/support/__tests__/supportThread.webQuarantine.test.ts` | NEW | Regression — web-quarantine import guard (4 cases). |

---

## 3. The web-degradation quarantine (§2.10 — CRITICAL)

**Chosen implementation: SPEC option (b)** — a thin, platform-resolved thread component.

- `SupportThreadCore.tsx` holds 100% of the thread logic (load ticket → resolve `conversation_id`
  → `listMessages` → `conversation:{id}` realtime → `postPlannerMessage` send). It imports **no**
  native keyboard module; the keyboard wrapper arrives via the `KeyboardWrap` prop.
- `SupportThread.native.tsx` (Metro picks on iOS/Android) passes the
  `react-native-keyboard-controller` `KeyboardAvoidingView`. This is the **only** support file that
  imports the native module — exactly as `KeyboardRoot.native.tsx` is for the app root.
- `SupportThread.tsx` (Metro picks on web + default) passes a Fragment passthrough — browsers
  handle the soft keyboard; zero library. Mirrors `KeyboardRoot.tsx` / `SmartScrollView.tsx`.
- **Realtime is web-safe**: the `conversation:{id}` channel is pure Supabase JS SDK (no native
  module), identical on native + web (SPEC §2.10, verified live in Phase 0).
- **Push is native-only**: `notifyNewSupportTicket` is fire-and-forget; on web the OneSignal-bound
  `notify-support` call simply fails/absents into a `console.warn` — never user-facing.

**Result: NO support file imports `react-native-keyboard-controller` outside a `.native` module.**

### Strict-grep proof (I-1104-NO-KBC-ON-WEB — Phase 0 gate, enforced for Phase 1)
```
$ node .github/scripts/strict-grep/i-meta-orch-1104-support-backend-invariants.mjs
OK   [INV-A: I-1104-NO-KBC-ON-WEB] scanned 11 support source file(s) — no non-native keyboard-controller imports
OK   [INV-B …] OK   [INV-C …] OK   [INV-D …]   EXIT=0
$ … --self-test → SELF-TEST OK
```
Note: the gate forbids the literal module string on any `import`/`require(`-bearing line in a
support-path file (incl. comments + test files). Doc comments + the test's example were reworded
so the gate stays GREEN while still documenting the rule.

---

## 4. Old → New receipts

### app/(tabs)/account.tsx
**Before:** Settings GlassCard had Edit profile / Notifications / Sign out everywhere nav rows.
**Now:** adds a "Help & Support" row (icon `chat`) between Notifications and Sign out, routing to
`/account/support`. Plus a `handleSupport` `useCallback`.
**Why:** SPEC §5.1 entry mount (Lane C 2.3). **Lines:** ~9.

### app/account/support.tsx (NEW)
**Now:** Help & Support screen — Start-a-chat (subject input + button), "My support requests" list
with per-ticket status pills (Open/Pending/Resolved/Closed), and loading / error / empty / populated
states in Mingla voice. Disables Start when subject is blank; surfaces create failures via Toast.
**Why:** SPEC §5.1 SC-1.1 / SC-1.3. **Lines:** ~320.

### app/support/[ticketId].tsx (NEW)
**Now:** resolves the `ticketId` route param and mounts `<SupportThread ticketId>`; renders a guard
fallback for a missing param. **Why:** SPEC §5.1 SC-1.2 / T-1.7. **Lines:** ~55.

### SupportThreadCore.tsx + SupportThread.native.tsx + SupportThread.tsx (NEW)
**Now:** the reusable thread + the native/web keyboard quarantine (§3 above).
**Why:** SPEC §5.1 thread + §2.10 quarantine. **Lines:** ~430 / ~35 / ~30.

### supportService.ts + useSupportTickets.ts (NEW)
**Now:** requester data access (RLS-scoped read of own tickets, `create_support_ticket` RPC,
best-effort `notify-support`) + the RQ list/create hooks. Throws on DB error (no silent fallback).
**Why:** SPEC §5.1 service/hook. **Lines:** ~140 / ~95.

---

## 5. Regression tests (Step 0.5 gate — MANDATORY)

Revert-baseline commit = **`7dd8b47a9`** (Phase-0/spec head, before this work).

| Test | Cases | Run | Fails-on-revert |
|---|---|---|---|
| `supportService.test.ts` (happy + adversarial) | 8 | **8 passed** | ✅ removed the empty-subject guard → `create_support_ticket` called with `""` → `expect(rpcMock).not.toHaveBeenCalled()` RED (`Received number of calls: 1`); restored → 8 passed. |
| `supportThread.webQuarantine.test.ts` (import guard) | 4 | **4 passed** | ✅ injected `import { KeyboardAvoidingView } from "react-native-keyboard-controller"` into the **web** `SupportThread.tsx` → "web variant does NOT import" RED; restored → 4 passed. |

Combined with the Phase-0 `businessNotificationRouting.support.test.ts` (5) the support suite is
**17 passed / 17 total**.

**Happy path (T-1.1):** `createSupportTicket("  Payouts are stuck  ")` → trims → calls
`create_support_ticket` with `{ p_subject:"Payouts are stuck", p_brand_id:null }` → returns id.
**Distinct adversarial:** (a) blank/whitespace subject rejected BEFORE any RPC; (b) the **web build
does not import keyboard-controller** (the bundle/import guard, mirroring the strict-grep gate at
unit level so the guarantee ships IN the Phase-1 diff). Plus: list/get throw on DB error (no silent
`[]`/`null`); `notify-support` 404 swallowed (no throw).

---

## 6. Gates run locally (captured)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (mingla-business) | **0 new errors** — 257 pre-existing on the clean baseline (stash-compared); ZERO in any support file. |
| `npx eslint` (the 8 new/changed support files) | **clean** (exit 0). The one repo error at `account.tsx:292` ("Couldn't load your brands") is PRE-EXISTING, not in this diff. |
| `i-meta-orch-1104-support-backend-invariants.mjs` (INV-A KBC) | **OK** — scanned 11 support files, 0 non-native KBC imports. |
| `i-…support-backend-invariants.mjs --self-test` | **SELF-TEST OK** |
| `orch-0863-marketing-hub-phase-b.mjs` (C7 no-new-backend-files) | **All checks PASS** — Phase 1 adds zero backend files. |
| `npx jest` support suite (3 files) | **17 passed / 17** |

---

## 7. Cross-surface impact (Step 3.5)

| Surface | Affected | Notes |
|---|---|---|
| Business iOS (native) | ✅ | New routes + thread; keyboard via `.native` KBC. AUTOMATIC parity with Android (shared code). |
| Business Android (native) | ✅ | Same shared code; **physical-device proof owed at TEST** (memory rule). |
| Business Web — PC browser | ✅ | Web `SupportThread.tsx` passthrough; realtime via JS SDK; push no-op. MANUAL parity (separate `.tsx`). |
| Business Web — mobile browser | ✅ | Same web path; composer usable, no KBC bundle break. |
| Consumer iOS / Android | ❌ | No consumer support surface (SPEC D1). |
| Admin Web | ❌ | Admin desk is Phase 2, separate work. |
| Buyer/anon Web | ❌ | Anon buyer routes never import operator-side support. |

Manual parity (native↔web) is via the deliberate `.native`/`.tsx` split — recorded so future
drift gets caught.

---

## 8. Verification Matrix (SPEC §5.3)

| SC | Verified how | Verdict |
|---|---|---|
| SC-1.1 Account → Help & Support shows Start + subject + list w/ badges | code review + unit (list/status mapping) | PASS (static); runtime owed at TEST |
| SC-1.2 Start a chat → live thread; send persists | unit (create→navigate; send path reuses proven `postPlannerMessage`) | PASS (static) |
| SC-1.3 "My support requests" newest-first + empty copy | unit (`order last_message_at desc`) + empty-state render | PASS |
| SC-1.4-web staff reply realtime; push no-op | code (JS-SDK channel; web push guard) | PASS (static) |
| SC-1.5-iOS / SC-1.5-Android | NOT run here (no sim/device this pass) | **DEFERRED to TEST** — Android on physical device |
| SC-1.6-web-PC / SC-1.7-web-mobile no KBC bundle break | strict-grep INV-A + unit import guard | PASS (static); web-export smoke owed at TEST |
| T-1.7 deep-link foreign ticket → not-found, no crash | `getOwnSupportTicket` returns null on RLS-hidden → not-found state | PASS (unit) |

**No UNVERIFIED escape on a shippable criterion was taken silently:** SC-1.5/1.6/1.7 RUNTIME legs
are explicitly handed to TEST (sim + web export + physical Android) — they cannot be exercised in
this code-only pass.

---

## 9. Things to verify before/at device TEST

1. **Native runtime**: Account → Help & Support → type subject → Start a chat → lands in thread →
   send a message (persists + appears). iOS sim + **Android physical device** (memory rule).
2. **Web export**: `expo export -p web --clear` succeeds with the new routes; open `/account/support`
   + a `/support/[id]` thread on a PC + a mobile browser — composer usable, no `keyboard-controller`
   bundle error, realtime streams a staff reply live.
3. **Web firewall**: signed-out hit on `/support/[id]` redirects to sign-in (route-agnostic gate in
   `_layout.tsx` — inherited, not re-implemented).
4. **`notify-support` deploy** (orchestrator): once deployed, a new ticket fires a
   `business.support_new_ticket` push; the client call is already wired (best-effort) — no Phase-1
   change needed.

---

## 10. Deviations / scope notes

- **No designer pass** — operator-directed (§0). Reuse-only.
- **`icon="help"` → `icon="chat"`** — no `help` glyph in the business Icon set (§1).
- **TS-type regen (Phase-0 §4.1 #6 deferral) is a no-op here** — the mingla-business supabase client
  is created WITHOUT a `Database` generic (untyped `.rpc`), so there is no generated-types consumer
  to regenerate; tsc is clean without it. No blocker.
- **No new-ticket DB trigger** — per Phase-0 design, the requester client invokes `notify-support`
  after `create_support_ticket` returns (best-effort). Intentional, not a gap.
- **Thread reuses `listMessages`/`postPlannerMessage` (conversation-id-driven) — NOT a fork of the
  chat engine.** `GroupChatPanel` itself was NOT reused directly because it is `eventId`-coupled
  (`useEventGroupChat(eventId)` + event moderation); reusing its conversation-id services keeps the
  engine shared while honoring the §2.10 quarantine. Image attachments were intentionally omitted
  from the support composer v1 (text-only); the underlying service supports them if later wanted.

---

## 11. Discoveries for orchestrator

- **Pre-existing lint error** at `mingla-business/app/(tabs)/account.tsx:292` (`react/no-unescaped-entities`
  on "Couldn't load your brands") — NOT in this diff; flag for a sweep.
- **macOS duplicate artifacts** (`… 2.md` / `…_2.sql`) persist under `Mingla_Artifacts/specs/` +
  `reports/` (same hazard Phase 0 flagged) — can break `git fetch`; suggest a sweep before the
  Phase-1 PR (per `feedback_edge_deploy_and_migration_apply_hazards.md`).
- **No COMMS-ledger BLOCK/WARN entry** targeted this ORCH / `ALL` / implementor at entry. The open
  WARN rows (COMMS-0013/0014/0018) are old, routed to other ORCHs (1006 / META-1062), not actionable
  here — read as FYI.
