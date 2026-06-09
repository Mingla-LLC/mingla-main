# IMPLEMENTATION — META-ORCH-1104 Phase 3 — Business-App Support STAFF CONSOLE

**Skill:** mingla-implementor (IMPLEMENT, Claude parity)
**Date:** 2026-06-08
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]/` on branch `meta-orch-1104-support-livechat-segmentation`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1104_…SEGMENTATION.md` §7 (Phase 3) + §2.9/§2.10 + §3.3
**Journey:** `JOURNEY_META-ORCH-1104_SUPPORT_WHERE_AND_FLOW.md` Journey 3
**Phase 0:** backend LIVE on production (support_staff, is_support_staff(), support_set_available, claim_support_ticket via support-claim, RLS — deployed + verified). **No backend change in this work.**
**Phase 1:** requester UI + shared `<SupportThread>` quarantine already shipped — **REUSED, not rebuilt.**
**Scope:** Phase 3 only — business-app staff console (gated card + inbox + availability + claim + thread reuse). NO admin, NO Phase 0 backend change, NO edge-fn deploy, NO migration, NO designer pass (operator-directed reuse-only).
**Status:** implemented and verified (static + unit + gate + fails-on-revert). Native runtime + web-export device pass DEFERRED to TEST (no sim/device this pass — see Verification Matrix). The `support-*` edge fns are not yet deployed; claim/status/priority degrade gracefully until then.

---

## 0. Designer note (deviation, operator-directed)

SPEC §7 says Phase 3 "REQUIRES a `mingla-designer` DESIGN pass." Seth's IMPLEMENT dispatch
explicitly directed **NO designer dispatch — match existing patterns**. Honored: the inbox reuses
the Phase-1 `account/support.tsx` chrome (IconChrome back + centered title), `GlassCard`, `Pill`,
`Button`, `Switch` (from `notifications.tsx`), `SettingsNavRow`, and the `designSystem` tokens
verbatim. No new visual language.

---

## 1. What was built (mapped to SPEC §7.1)

| # | SPEC §7.1 item | Built |
|---|---|---|
| 1 | Capability hook keyed on `user.id` (NOT brand) | `src/hooks/useSupportStaff.ts` — RQ hook reading the caller's own `support_staff` row; returns `{ isStaff, enabled, available, role }`. `isStaff = enabled === true` (mirrors `is_support_staff()`). 30s security-adjacent stale-time (mirror `useCurrentBrandRole`). |
| 2 | Gated "Support — Live Chats" card on Account (sub-page, NOT a tab) | `app/(tabs)/account.tsx` — a `GlassCard` rendered ONLY when `useSupportStaff().isStaff`, with a `SettingsNavRow` (`icon="inbox"`) → `router.push('/support/inbox')`. **No `TABS` entry** (CF-C3 — avoids the brand-rank `MIN_RANK_FOR_TAB` gate). |
| 3 | Staff inbox + availability toggle + claim → shared thread | `app/support/inbox.tsx` — header "Available for support" `Switch` → live `support_set_available` RPC; queue list (`support_tickets` via `is_support_staff()` RLS) newest-activity-first, live via realtime; per-ticket Claim / Open chat / status / priority; Open-chat claims-then-routes to the SHARED `/support/[ticketId]` thread (Phase 1). |
| 4 | PUSH RECEIVE routes `business.support_*` | **Verified, no change needed** — Phase 0's `businessNotificationRouting.ts` case + the inbound `_layout.tsx:434 processBusinessNotification` handler route to `/support/[ticketId]`. Push SEND is server-side (`notify-support`, not deployed) — no client send. |
| 5 | Web degradation (§2.10) | Inbox + toggle + claim render on business web (PC + mobile browser) via JS SDK + edge fns; realtime queue is the web "new-ticket" signal (push is native-only — copy states it). The shared thread carries the Phase-1 `I-1104-NO-KBC-ON-WEB` quarantine; no Phase-3 file imports keyboard-controller. Strict-grep GREEN. |
| 6 | Regression tests (Step 0.5) | `supportStaffService.test.ts` (happy + adversarial) + `useSupportStaff.test.ts` (gate happy + adversarial). 13 passing; fails-on-revert proven. |

### Service/hooks
- `src/services/supportStaffService.ts` — `listSupportQueue` (RLS-scoped, throws on DB error), `setSupportAvailable` (live RPC), `claimSupportTicket` / `setSupportTicketStatus` / `setSupportTicketPriority` (edge fns via `invokeSupportFn` with graceful 404/403 — never throws), mirroring the admin desk's `invokeSupportFn` posture.
- `src/hooks/useSupportQueue.ts` — RQ queue hook + a `support:queue` realtime channel (web-safe JS SDK) that refreshes the queue live (how a web staffer learns of a new ticket without push, §7.2).

### `icon` choices (no deviation needed)
The business `Icon` union HAS `inbox` and `chat` — used `inbox` for the Account card row and `chat`
for the inbox "Open chat" button. No missing-glyph substitution this phase.

---

## 2. Files changed (committed on branch — hashes are git blob object ids)

| File | New/Mod | blob | What |
|---|---|---|---|
| `mingla-business/src/hooks/useSupportStaff.ts` | NEW | `9f7f857` | Capability hook keyed on `user.id` (brand-decoupled); `isStaff = enabled===true`. |
| `mingla-business/src/hooks/useSupportQueue.ts` | NEW | `4cfa870` | Shared queue RQ hook + `support_tickets` realtime channel. |
| `mingla-business/src/services/supportStaffService.ts` | NEW | `92b2e6d` | Staff-side reads + availability RPC + claim/status/priority edge fns (graceful 404). |
| `mingla-business/app/support/inbox.tsx` | NEW | `4688cc2` | Staff inbox: availability toggle + queue + claim/open/status/priority + web-degradation copy + denied state. |
| `mingla-business/app/(tabs)/account.tsx` | MOD (+34) | `09c7439` | `useSupportStaff()` + `handleOpenSupportInbox` + gated "Support — Live Chats" `GlassCard`. |
| `mingla-business/src/services/__tests__/supportStaffService.test.ts` | NEW | `585087b` | Regression — happy (availability RPC, queue read, claim) + adversarial (queue throw, non-staff RPC reject, 404/403 degradation). |
| `mingla-business/src/hooks/__tests__/useSupportStaff.test.ts` | NEW | `32e467e` | Regression — gate happy (enabled→staff) + adversarial (absent/disabled row→not staff). |

**Zero** files touched under `supabase/`, `mingla-admin/`, or `app-mobile/`. No migration, no edge fn, no `notifications.tsx` push-pref master this phase (see Deviations §10).

---

## 3. The staff gate + inbox + availability + claim wiring (how it hangs together)

1. **Gate (brand-decoupled).** `useSupportStaff()` reads `support_staff WHERE user_id = auth.uid()` (RLS `support_staff_self_read`) and returns `isStaff` ONLY when `enabled === true`. It keys on `user.id`, NEVER `currentBrandId` (I-1104-STAFF-DECOUPLED). The Account card mounts on `isStaff`; a non-staff user never sees it.
2. **Inbox (cosmetic gate + real RLS boundary).** `app/support/inbox.tsx` re-checks `useSupportStaff()`: a forced deep-link by a non-staff viewer renders an access-denied state and fires NO queue query; even if it did, `is_support_staff()` RLS returns zero rows (SPEC §3.3 / T-3.1). The queue read (`useSupportQueue(staff.isStaff)`) only fires for an enabled staffer.
3. **Availability.** The header `Switch` calls `setSupportAvailable(v)` → `support_set_available(p_available)` RPC (column-restricted self-write). Optimistic with revert-on-failure (never lie about shift state). The live RPC is Phase-0 deployed, so this works today.
4. **Claim → shared thread.** "Open chat" claims-then-routes: an unclaimed/foreign ticket is `claimSupportTicket()` (→ `support-claim` edge fn → `claim_support_ticket` seeds the staffer participant so the thread's staff INSERT/SELECT RLS passes), then `router.push('/support/[ticketId]')` mounts the SHARED Phase-1 `<SupportThread>`. A claim 404 (fn undeployed) still opens the thread read-only. Reply uses the shared thread's existing `postPlannerMessage` direct INSERT (staff RLS `messages_support_staff_insert`) — identical engine to the requester, no fork.
5. **Status/priority.** Per-ticket "Move to <next>" (legal transition only, mirrors the edge fn) and "Cycle priority" call `support-set-status`; both degrade gracefully (toast) when the fn is undeployed.

---

## 4. Web-degradation quarantine (§2.10 / §7.2)

- The inbox imports ONLY pure-JS / RN-core / Supabase-JS-SDK modules — it does **not** import the
  shared `<SupportThread>` directly; it navigates to the route, which Metro resolves to the
  `.native`/`.tsx` quarantined pair built in Phase 1. **No Phase-3 file imports
  `react-native-keyboard-controller`.**
- The `support:queue` realtime channel is pure `supabase.channel` (web-safe).
- Push is native-only; the inbox copy explicitly states "On the web, the queue still updates live —
  but push alerts only reach the Mingla Business app on your phone" (§7.2 documented degradation).

### Strict-grep proof (I-1104-NO-KBC-ON-WEB, scans every support-path file incl. the new inbox/hooks)
```
$ node .github/scripts/strict-grep/i-meta-orch-1104-support-backend-invariants.mjs
OK   [INV-A: I-1104-NO-KBC-ON-WEB] scanned 17 support source file(s) — no non-native keyboard-controller imports
OK   [INV-B: I-1104-SCHEMA-NO-BARE-TICKETS-AGENTS] scanned 2 support migration(s) — no bare tickets/agents schema names
OK   [INV-C: I-1104-SUPPORT-SCOPED-RLS] checked 4 support_staff chat policy block(s) — all carry linked_entity_type='support'
OK   [INV-D: I-1104-IS-ADMIN-RETIRED-SAFE] scanned 7 support edge-fn file(s) — no new profiles.is_admin readers
```
(17 = the Phase-1 11 + Phase-3 6 new support-path files; all clean.)

---

## 5. Old → New receipts

### app/(tabs)/account.tsx (MOD, +34)
**Before:** Account rendered Your-brands, Partner (gated on `isPartner`), Settings cards.
**Now:** adds `import { useSupportStaff }`, a `const supportStaff = useSupportStaff()` + `handleOpenSupportInbox` callback, and a gated "Support — Live Chats" `GlassCard` (rendered only when `supportStaff.isStaff`) with an `inbox` `SettingsNavRow` → `/support/inbox`, placed between the Partner card and the Settings card.
**Why:** SPEC §7.1 mount (sub-page, not a tab — CF-C3). **Lines:** ~34.

### src/hooks/useSupportStaff.ts (NEW, ~110)
**Now:** brand-decoupled capability hook (RQ, keyed on `user.id`, 30s stale-time); `isStaff` true only for an `enabled` row. Throws on DB error (no silent fallback).
**Why:** SPEC §7.1 capability hook + I-1104-STAFF-DECOUPLED.

### src/hooks/useSupportQueue.ts (NEW, ~85)
**Now:** the shared queue RQ hook + a `support:queue` realtime channel (web-safe) that invalidates on any `support_tickets` change. Disabled for non-staff.
**Why:** SPEC §7.1 shared queue + §7.2 web "new-ticket via realtime, not push".

### src/services/supportStaffService.ts (NEW, ~170)
**Now:** `listSupportQueue` (throws on DB error), `setSupportAvailable` (live RPC), claim/status/priority via `invokeSupportFn` (graceful 404→`not_deployed`, 403→`forbidden`, never throws). Mirrors the admin desk.
**Why:** SPEC §7.1 inbox actions + dispatch graceful-degradation requirement.

### app/support/inbox.tsx (NEW, ~330)
**Now:** the staff console — availability `Switch`, queue list with status/priority pills + assignment label, expandable per-row actions (Open chat / Claim / Move-to / Cycle-priority), all 9 states (loading/error/empty/populated/denied/submitting), web-degradation note, Toast feedback.
**Why:** SPEC §7.1 inbox + §7.2 web degradation + §3.3 denied state.

---

## 6. Regression tests (Step 0.5 gate — MANDATORY)

Revert-baseline commit = **`fad5a50ba`** (Phase-2 head, before this Phase-3 work).

| Test | Cases | Run | Fails-on-revert |
|---|---|---|---|
| `supportStaffService.test.ts` (happy + adversarial) | 8 | **8 passed** | ✅ (a) changed `support_set_available` → `WRONG_rpc_name` → happy RPC assertion RED; (b) made `listSupportQueue` swallow the error (`return []`) → "throws on DB error" RED. Restored → 8 passed. |
| `useSupportStaff.test.ts` (gate happy + adversarial) | 5 | **5 passed** | ✅ forced the queryFn map to `enabled: true` (ignoring `row.enabled`) → "disabled row maps to enabled false" RED. Restored → 5 passed. |

Combined run captured:
```
Test Suites: 2 passed, 2 total
Tests:       13 passed, 13 total
```
Fails-on-revert captured: `Tests: 4 failed, 9 passed, 13 total` (disabled-row gate + queue-throw + RPC-name), then restored to 13/13.

**Happy path:** an enabled staff row → `isStaff` true + `available` reflected; `setSupportAvailable(true)` calls `support_set_available {p_available:true}` and returns the persisted value; `listSupportQueue` reads `support_tickets` newest-first; `claimSupportTicket` invokes `support-claim {ticketId}`.
**Distinct adversarial:** a NON-staff user (absent row) AND a DISABLED staff row both map to `enabled: false` → the card stays hidden / inbox denied; `listSupportQueue` THROWS on RLS error (no silent `[]`); `setSupportAvailable` THROWS when the RPC RAISEs `not_support_staff`; claim degrades to `{ok:false, code:'not_deployed'/'forbidden'}` on 404/403 (never throws).

Full support suite (Phase 1 + Phase 3): **30 passed / 30** (`supportService` 8 + `supportThread.webQuarantine` 4 + `businessNotificationRouting.support` 5 + `supportStaffService` 8 + `useSupportStaff` 5).

---

## 7. Gates run locally (captured)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (mingla-business) | **257 total errors = the exact pre-existing baseline** (Phase-1 confirmed 257); **0 reference any Phase-3 file**. |
| `npx eslint` (7 Phase-3 files) | **clean** — the only error is the PRE-EXISTING `account.tsx:303` "Couldn't load your brands" unescaped-apostrophe (Phase 1 flagged it at `:292`; my insertions shifted the line). NOT in my added lines. |
| `i-meta-orch-1104-support-backend-invariants.mjs` (INV-A KBC) | **OK** — 17 support files, 0 non-native KBC imports. |
| `orch-0863-marketing-hub-phase-b.mjs` (C7 no-new-backend-files) | **N/A** — Phase 3 adds ZERO backend files (no `supabase/functions/*`, no migration). No `META_ORCH_1104_BACKEND_ALLOWLIST` entry needed (COMMS-0002 factored). |
| `npx jest` support suite (5 files) | **30 passed / 30** |

---

## 8. Cross-surface impact (Step 3.5)

| Surface | Affected | Notes |
|---|---|---|
| Business iOS (native) | ✅ | Gated card + inbox + claim→shared-thread; thread keyboard via the Phase-1 `.native` KBC. AUTOMATIC parity with Android (shared code). |
| Business Android (native) | ✅ | Same shared code; **physical-device proof owed at TEST** (memory rule). |
| Business Web — PC browser | ✅ | Inbox + toggle + claim via JS SDK + edge fns; queue realtime; push no-op. MANUAL parity via the Phase-1 `.native`/`.tsx` thread split. |
| Business Web — mobile browser | ✅ | Same web path; no KBC bundle break. |
| Consumer iOS / Android | ❌ | No consumer support staff surface (SPEC D1). |
| Admin Web | ❌ | The admin desk is Phase 2 (separate, shipped). Phase 3 reuses the SAME queue + edge fns — cross-client parity is data-level (one `support_tickets`), not code-level. |
| Buyer/anon Web | ❌ | Anon buyer routes never import operator-side support. |

Manual native↔web parity is via the inherited Phase-1 thread split (recorded so drift gets caught).

---

## 9. Verification Matrix (SPEC §7.3)

| SC | Verified how | Verdict |
|---|---|---|
| SC-3.1 non-staff sees NO card + can't reach `/support/*` | unit (`useSupportStaff` absent/disabled→not staff) + inbox denied-state code + RLS (Phase-0) | PASS (static + unit); runtime owed at TEST |
| SC-3.2 enabled staffer sees console; availability persists | unit (`setSupportAvailable` calls live RPC, returns persisted) + card-gate code | PASS (static + unit) |
| SC-3.3-web new tickets via live queue; push no-op | code (`useSupportQueue` realtime channel; native-only push) | PASS (static) |
| SC-3.3-native push to staffer | **DEFERRED** — `notify-support` undeployed; PUSH RECEIVE routing verified (Phase-0 test), SEND owed post-deploy | DEFERRED to deploy + TEST |
| SC-3.4 claim → reply → PC desk reflects live (shared queue) | code (claim edge fn + shared thread + shared `support_tickets`); admin desk realtime (Phase 2) | PASS (static); cross-client live owed at TEST |
| SC-3.5-iOS / SC-3.5-Android | NOT run here (no sim/device this pass) | **DEFERRED to TEST** — Android physical |
| SC-3.6-web-PC / SC-3.7-web-mobile no KBC break | strict-grep INV-A + no direct thread import | PASS (static); web-export smoke owed at TEST |

**No UNVERIFIED escape on a shippable criterion taken silently:** the SC-3.3-native push leg and all RUNTIME legs (sim / physical Android / web export) are explicitly handed to TEST + the edge-fn deploy — they cannot be exercised in this code-only, pre-deploy pass.

---

## 10. Deviations / scope notes

- **No designer pass** — operator-directed (§0). Reuse-only.
- **"Create a ticket on a user's behalf" NOT built — matches the desk, blocked by Phase-0 RPC.** The dispatch listed create-on-behalf "(parity with the desk)". The Phase-2 admin desk does NOT implement create-on-behalf either (it's a queue + claim + reply + status/priority desk). The Phase-0 `create_support_ticket(p_subject, p_brand_id)` RPC mints with `requester_user_id = auth.uid()` — there is **no requester-override parameter**, so a staffer cannot bind a ticket to an arbitrary requester without a Phase-0 backend change (OUT of scope per HARD GUARDS). Built to actual desk parity; create-on-behalf is a deferred Phase-0 RPC extension (registered below).
- **"Support console" push-pref master (notifications.tsx) NOT added.** SPEC §7.1 mentions a push-pref master rendered when `isStaff`. The dispatch's BUILD list (item 4) only required PUSH RECEIVE routing verification, not the push-pref master. Push is native-only and `notify-support` is undeployed; the master is cosmetic until then. Deferred to avoid scope creep beyond the dispatch (registered below).
- **Switching between active chats = the inbox-as-switcher pattern.** The dispatch cited the ARI `ConversationDrawer` as "the reference". The simplest correct realization (and the one matching the Phase-1 requester list and the admin desk queue→detail) is the inbox list itself: each row → the shared thread, Back → the inbox to pick another. No separate drawer component was built (would duplicate the queue).
- **TS-type regen is a no-op** — the mingla-business supabase client is untyped (`.rpc`/`.from` un-generic), so there's no generated-types consumer; tsc is clean. (Same as Phase 1.)

---

## 11. Discoveries for orchestrator

- **Phase-0 RPC blocks staff create-on-behalf.** If create-on-behalf is wanted on either the desk OR the phone console, Phase 0 needs a `create_support_ticket_for(p_requester uuid, p_subject text, …)` staff-gated SECURITY DEFINER RPC (admin/staff only). Register as a Phase-0 follow-up; both Phase-2 and Phase-3 light it up with ~10 lines each once it exists.
- **"Support console" push-pref master** (notifications.tsx, `isStaff`-gated) remains an unbuilt SPEC §7.1 line — small, native-push-coupled; pick it up with the `notify-support` deploy.
- **Pre-existing lint error** at `mingla-business/app/(tabs)/account.tsx:303` (`react/no-unescaped-entities` on "Couldn't load your brands") — NOT in this diff (Phase 1 flagged the same at `:292`). Flag for a sweep.
- **No COMMS-ledger BLOCK targeted this ORCH at entry.** COMMS-0002 (backend strict-grep allowlist) + COMMS-0003 (external-API docs) are WARN and **N/A for Phase 3** (zero `supabase/functions/*` files, zero new external API) — factored, acked.

---

## 12. What to deploy / verify before the device TEST

1. **Deploy the support edge fns from MERGED main** (per `feedback_edge_deploy_and_migration_apply_hazards.md`): `support-claim`, `support-send`, `support-set-status`, `support-grant-staff`, `notify-support`:
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]" && \
   /Users/sethogieva/bin/supabase functions deploy support-claim support-send support-set-status support-grant-staff notify-support --project-ref gqnoajqerqhnvulmnyvv
   ```
   (Deploy AFTER this branch's PR merges to main; deploy from the merged checkout, not the worktree.)
2. **Grant a test staffer** via the (now-deployed) `support-grant-staff` OR the admin Agents panel (Phase 2): set `support_staff(user_id, enabled=true)` for your test account. Then the "Support — Live Chats" card appears on that account's Account tab within ~30s (the hook stale-time).
3. **Native runtime (iOS sim + Android physical):** Account → Support — Live Chats → Open support inbox → toggle "Available for support" (persists) → tap a ticket → Open chat → claim seeds you → send a staff reply (persists + the requester sees it live + the PC desk reflects it).
4. **Web export:** `expo export -p web --clear` succeeds with the new `/support/inbox` route; open it on a PC + mobile browser — toggle works, queue streams a new ticket live, claim/reply work, NO keyboard-controller bundle error, signed-out hit redirects to sign-in.
5. **Push (after `notify-support` deploy):** an available staffer gets `business.support_new_ticket` on the business app; tapping it deep-links to `/support/[ticketId]` (routing already verified by the Phase-0 test).
