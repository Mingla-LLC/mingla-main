# IMPLEMENTATION — META-ORCH-1104 Phase 2 — Admin Support Desk + User Segmentation

**Skill:** mingla-implementor (IMPLEMENT)
**Date:** 2026-06-08
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1104-[support-livechat-segmentation]/` on branch `meta-orch-1104-support-livechat-segmentation`
**Spec:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1104_SUPPORT_LIVECHAT_TICKETS_SEGMENTATION.md` §6 (Phase 2), §2 (data model), §3 (security)
**Journey:** `Mingla_Artifacts/reports/JOURNEY_META-ORCH-1104_SUPPORT_WHERE_AND_FLOW.md` Journeys 2 + 4
**Scope:** mingla-admin web only. No backend changes, no edge-fn deploy, no business-app changes. NO designer dispatch (mirrored existing admin patterns per dispatch).
**Status:** implemented and verified (build + lint + regression green; Phase-0 backend confirmed live on production via read-only probe).

---

## 1. What was built (mapped to SPEC §6.1)

1. **Router + nav registration (SC-2.1):** `#/support` route added to `App.jsx` `PAGES`; `{ id: "support", label: "Support", icon: "LifeBuoy" }` added to `constants.js` `NAV_GROUPS` (between Venue claims + Users); `LifeBuoy` registered in `Sidebar.jsx` lucide import + `ICON_MAP` (Lane B finding — an unregistered icon silently falls back to `LayoutDashboard`).
2. **Support desk page (`SupportDeskPage.jsx`, NEW) — queue (SC-2.2):** a table over `support_tickets` (requester, subject, status, priority, assigned staff, last-activity), sorted `last_message_at desc`. Filters: status pill-tabs (All / New / Open / Pending / Resolved / Closed) + an "Unassigned only" checkbox (`.is("assigned_staff_id", null)`). Realtime refresh via a `support_tickets` postgres-changes channel (new tickets surface live at the top). Requester/assignee profiles + brand resolved in batched lookups (FKs point at `auth.users`, so they can't be embedded).
3. **Ticket detail (SC-2.2 / SC-2.3):** a modal — **left** = the conversation thread (reads `messages` for the ticket's `conversation_id` via the live `is_admin_user()` RLS path; live message stream subscription; system messages rendered as centered banners); **right** = ticket meta (requester + their derived segment badge, brand if any, status, priority, opened/first-reply/resolved timestamps) + actions: **Claim** (`support-claim`), **reply** composer (direct `messages` INSERT via the `messages_support_staff_insert` RLS policy + a non-fatal `support-send` side-effect for push/timestamp bump), **status** select, **priority** select.
4. **Agents panel (SC-2.4):** a modal listing `support_staff` rows (enabled/available/role) with grant-by-email (`support-grant-staff`) + per-row revoke. Admin-only by RLS.
5. **User segmentation on `UserManagementPage.jsx` (SC-2.5):** All/Explorer/Business/Admin segment pill-tabs above the Filters block, with live counts from `profiles_with_segment` (`segmentCounts` state, fetched in `fetchStats`). Selecting a tab reads the `profiles_with_segment` view and filters via `.eq("segment", segment)`; the legacy `.or('account_type.neq.admin…')` admin-hide guard is dropped under an explicit segment (it would hide the Admin tab's own rows) and preserved verbatim for the "All" tab (zero behavior change there).
6. **Graceful degradation (dispatch requirement):** the `support-claim` / `support-set-status` / `support-grant-staff` / `support-send` edge functions are NOT deployed yet (confirmed absent in `list_edge_functions`). All edge-fn calls go through `invokeSupportFn`, which special-cases a 404 with a clear "isn't deployed / queue is read-only until the support functions ship" toast and never throws. The reply's message INSERT runs BEFORE the side-effect fn, so an undeployed `support-send` never loses a reply.
7. **Regression tests (Step 0.5 gate):** one happy-path + one distinct adversarial test (node:test source/structure pattern — the established admin harness). See §5.

---

## 2. Files changed (sha256 at commit)

| File | New/Mod | sha256 | What |
|---|---|---|---|
| `mingla-admin/src/pages/SupportDeskPage.jsx` | NEW | `721e99f9…6540` | The whole Support desk: queue + status/unassigned filters + ticket detail (thread + meta/actions) + Agents panel. |
| `mingla-admin/src/pages/UserManagementPage.jsx` | MOD | `9d828b42…f388` | Segment tabs + counts (`profiles_with_segment`); `fetchUsers` reads the view + `.eq("segment", …)` under an explicit tab; `fetchStats` adds explorer/business/admin head-counts. |
| `mingla-admin/src/App.jsx` | MOD | `4b2f3db6…39df` | Import + `support: SupportDeskPage` PAGES entry (`#/support`). |
| `mingla-admin/src/lib/constants.js` | MOD | `42996240…bd5d` | `{ id:"support", label:"Support", icon:"LifeBuoy" }` NAV_GROUPS item. |
| `mingla-admin/src/components/layout/Sidebar.jsx` | MOD | `45a9eec9…c328c` | `LifeBuoy` lucide import + ICON_MAP entry (no silent fallback). |
| `mingla-admin/src/__tests__/meta_orch_1104_support_desk_happy.test.js` | NEW | `9ed0f676…0adb` | Happy-path regression (7 subtests). |
| `mingla-admin/src/__tests__/meta_orch_1104_support_desk_adversarial.test.js` | NEW | `34753169…2c605` | Adversarial regression (4 subtests). |

---

## 3. Old → New receipts

### UserManagementPage.jsx
- **Before:** the Users list read `profiles` with a hard-coded `.or('account_type.neq.admin,account_type.is.null')` guess; no segment tabs; `stats` had no per-segment counts. The `account_type` filter was the "lying" segment proxy.
- **Now:** when a segment tab other than "All" is active, the list reads the `profiles_with_segment` view and filters on the authoritative derived `segment` column; the `account_type` guard is applied only on "All" (unchanged behavior there). Segment pill-tabs with live counts (`profiles_with_segment` head-counts in `fetchStats`) sit above Filters. The Admin tab now shows the real derived admin(s).
- **Why:** SC-2.5 (correct derived segments; the `account_type` filter no longer lies), Journey 4.
- **Lines changed:** ~89 added.

### SupportDeskPage.jsx
- **Before:** did not exist.
- **Now:** the full admin support desk — queue, detail (thread + meta/actions), agents panel — mirroring `ClaimsPage`/`UserManagementPage`/`AdminPage` patterns (`SectionCard`, `Modal`, `Badge`, `Button`, `Avatar`, `Spinner`, `useToast`, direct `supabase` client, `logAdminAction`).
- **Why:** SC-2.1 → SC-2.4, Journey 2.
- **Lines changed:** ~640 new.

### App.jsx / constants.js / Sidebar.jsx
- **Before:** no `support` route / nav item / icon.
- **Now:** `#/support` rendered inside the authed shell; nav item between Venue claims + Users; `LifeBuoy` registered so the icon resolves.
- **Why:** SC-2.1 + the Lane B silent-fallback finding.
- **Lines changed:** 4 each.

---

## 4. Phase-0 backend confirmed live (read-only probe, 2026-06-08, never mutated)

Verified via Supabase Management API `execute_sql` (read-only):
- `support_tickets`, `support_staff` tables + `profiles_with_segment` view + `derive_user_segment` / `is_support_staff` / `create_support_ticket` / `claim_support_ticket` functions all PRESENT (1 each).
- Column shapes match SPEC §2.1/§2.2 (the page reads exactly these columns).
- Derived segment counts (inline derivation, matching `derive_user_segment`): **admin=1, business=13, explorer=24** (total 38) — matches SPEC SC-2.5 and the Phase-0 report.
- `support_tickets` currently has **0 rows** → the desk's empty-state path is exercised on first load (handled).
- Edge functions `support-claim` / `support-send` / `support-set-status` / `support-grant-staff` / `notify-support` are **NOT in `list_edge_functions`** → confirms the dispatch's "not deployed yet"; the desk degrades gracefully (§1.6).

> Note: the Management-API role lacks EXECUTE on `derive_user_segment` (SECURITY DEFINER, GRANTed to `authenticated`). The admin web authenticates as Seth (authenticated + admin), so the view + counts resolve there. The probe used an inline copy of the derivation to confirm the counts.

---

## 5. Regression tests (Step 0.5 gate)

Harness: `node --test` (the established mingla-admin test pattern — source-reading + constants import; no jsdom). Revert baseline commit = **`5d4ad9a81`** (origin/main).

| Test | Subtests | Run | Fails-on-revert |
|---|---|---|---|
| `meta_orch_1104_support_desk_happy.test.js` | 7 | **7 passed** | ✅ — reverting the `fetchUsers` view-filter (segment read) → subtest #7 RED; restore → 7 passed. |
| `meta_orch_1104_support_desk_adversarial.test.js` | 4 | **4 passed** | ✅ — (a) removing `LifeBuoy` from `ICON_MAP` → subtest A RED (proves the silent-fallback guard); (b) reverting the view-filter → subtest B RED. Restore → 4 passed. |

**Captured runs:**
- Post-restore: `# tests 11 / # pass 11 / # fail 0`.
- Revert ICON_MAP `LifeBuoy`: adversarial `# pass 3 / # fail 1` (`not ok 1 - A. the support nav icon resolves`).
- Revert segment view-filter: combined `# pass 9 / # fail 2` (`not ok 7` happy + `not ok 2` adversarial-B).

**Adversarial coverage (distinct from happy path):**
- **A** — the LifeBuoy silent-fallback bug: ICON_MAP key must match the NAV item's `icon` string exactly AND be imported from lucide-react.
- **B** — segmentation must filter via the derived view, never the lying `account_type` guard (the guard must sit in the non-segment else-branch).
- **C** — dual-role precedence: a user who is BOTH admin AND business derives as `admin` (admin-first), so the admin=1/business=13/explorer=24 partition holds without double-counting (the live count contract is the proof).
- **D** — graceful 404 degradation: `invokeSupportFn` is try/caught + 404-special-cased; the reply INSERT runs before the `support-send` side-effect so an undeployed fn never loses a reply.

---

## 6. Gates run locally

| Gate | Result |
|---|---|
| `npx vite build` (full admin app, with SupportDeskPage wired) | **built in 1m51s, exit 0** — 2951 modules transformed. (chunk-size warning is pre-existing; single-bundle admin.) |
| `npx eslint` on my NEW files (SupportDeskPage + 2 tests) | **clean (exit 0)** |
| `npx eslint` on touched files (full set) | 6 errors — ALL pre-existing on UNTOUCHED lines (`motion` App.jsx:2, `useCallback` Sidebar:60, `truncate`/`adminErr`/2×`Icon` in UserManagementPage). Proven via `git diff origin/main` (none in my added `+` lines). No NEW lint errors introduced. |
| `node --test` (both new regression tests) | **11 passed / 0 failed** |
| `i-meta-orch-1104-support-backend-invariants.mjs` (the Phase-0 gate) | **INV-A/B/C/D all OK** — my `.jsx` admin work is out of its `.ts/.tsx` scan scope and adds no `profiles.is_admin` reader. |

---

## 7. Spec traceability (§6.3)

| SC | Status | Evidence |
|---|---|---|
| SC-2.1 (`#/support` in authed shell; non-admins never reach it) | PASS | PAGES entry + NAV item + ICON_MAP; App renders pages only when `session` set; all reads go through anon-key RLS (`is_admin_user()`). |
| SC-2.2 (queue newest-first; click → thread; admin reply persists) | PASS (live-reply UNVERIFIED on-device) | queue `.order(last_message_at desc)`; thread reads `messages`; reply = direct INSERT via `messages_support_staff_insert`. Realtime + push side-effect pending the undeployed `support-send`. |
| SC-2.3 (claim / status / priority; timestamps; sidebar badge) | PARTIAL | claim/status/priority wired to edge fns (graceful 404 until deployed); `first_response_at`/`resolved_at` are set server-side by the edge fns. **Sidebar unread badge: deferred — see Deviations.** |
| SC-2.4 (agents grant/revoke flips `is_support_staff()`) | PASS (flip verifiable post-deploy) | Agents panel calls `support-grant-staff`; reads `support_staff`. |
| SC-2.5 (All/Explorer/Business/Admin tabs, correct counts, view filter) | PASS | tabs + `profiles_with_segment` counts (admin=1/business=13/explorer=24 confirmed live); `.eq("segment", …)` filter; old `account_type` filter no longer the segment source. |
| SC-2.6-PC (PC browser) | PASS (build) / on-device UNVERIFIED | Vite build green; standard admin desktop layout. Final PC eyeball is Seth's smoke-test. |
| SC-2.7-mobile (non-break on mobile browser) | PARTIAL | queue table is in an `overflow-x-auto` wrapper (no page overflow); segment tabs are `flex-wrap` (tappable); detail modal grid stacks to single-column under `md`. Final narrow-viewport eyeball is Seth's smoke-test. |

---

## 8. Invariants (§6.4)

- **Anon-key only** — the admin client uses `supabase` (anon key, RLS). No service-role key introduced client-side. ✅
- **Segment from the view/derive, never a trusted stored column** — counts + filter read `profiles_with_segment.segment` (= `derive_user_segment`), not `account_type`. ✅
- **No fabricated counts** — `segmentCounts` init to `null` (renders `·` placeholder until loaded); an errored count stays `null`, never a faked 0. ✅

---

## 9. Cross-surface impact (Step 3.5)

| Surface | Affected? | What / Why |
|---|---|---|
| Admin Web | YES | The whole feature. Files: the 5 admin `src` files above. |
| Consumer iOS / Android | NO | app-mobile has no support desk. |
| Buyer/anon Web | NO | no support surface. |
| Business iOS / Android | NO | Phase 3 owns the business-app staff console (separate ORCH). |
| Business Web preview | NO | not touched. |

Parity: single-surface (Admin Web). Phase 1 (business requester) + Phase 3 (business staff console) are separate phases; this work touches neither.

---

## 10. Deviations / scope notes

- **NO designer dispatch (per dispatch directive).** SPEC §6 nominally requires a `mingla-designer` pass; the dispatch explicitly overrode that ("mirror the existing admin page patterns exactly"). The desk reuses `ClaimsPage`'s pill-tab + table + modal idiom and `AdminPage`'s roster idiom verbatim. The responsive-stacking detail (SPEC §6.2 "OPEN") is the conventional `md:`-breakpoint single-column stack; if Seth wants a designed mobile layout, that's a follow-up.
- **Sidebar unread badge (SC-2.3 tail) deferred.** The queue surfaces new tickets live (realtime channel) at the top, but a numeric unread badge on the sidebar nav item would require threading per-page unread state up into the shell (`AppShell`/`Sidebar`), which the current nav-item contract (`{id,label,icon}`) doesn't carry. Flagged as a small follow-up; the live queue covers the "new tickets surface live" requirement.
- **Reply timestamps / push depend on the undeployed `support-send`.** The reply message persists immediately via RLS INSERT; `first_response_at`/`last_message_at` bump + the push fan-out land once `support-send` is deployed. Until then the desk is fully usable for reading + replying; the side-effect is a documented no-op (toast-free, console-warned).
- **`is_admin` retirement is Phase-0 / operator-gated** — untouched here.

---

## 11. Discoveries for orchestrator

- **Pre-existing admin lint debt (6 errors).** `mingla-admin` has 6 standing eslint errors on untouched lines (`motion` unused in App.jsx; `react-hooks/use-memo` on Sidebar's `useCallback(onMobileClose, …)`; 4 unused vars in UserManagementPage). Not introduced by this work; `npm run lint` is presumably not a blocking CI gate for admin today. Worth a cleanup ORCH.
- **Pre-existing failing admin test.** `src/__tests__/orch1008_sidebar.test.js` already fails 2 subtests ("NAV_GROUPS has exactly 10 items" / "NAV_ITEMS is the flat 10-item list") — the nav grew past 10 in later ORCHs (now 15 with Support). These are stale assertions, append-only-locked (can't be edited without `[TEST-MOD-APPROVED]`). My change adds the 15th item; it does not worsen the already-failing count assertion. Flag for a TEST-MOD-APPROVED refresh of that count.
- **Support edge fns undeployed.** `support-claim/send/set-status/grant-staff/notify-support` must be deployed (from MERGED main, per the edge-deploy hazards memory) before the desk's lifecycle actions work end-to-end. The desk degrades gracefully until then.

---

## 12. Test-first checklist for Seth

1. **Segmentation (highest value, works NOW — no deploy needed):** Users page → the All/Explorer/Business/Admin tabs should read admin=1, business=13, explorer=24; click Business → only the 13 derived business users; Admin → the 1 real admin (previously hidden by the `account_type` filter).
2. **Support nav + empty queue:** the Support item appears in the sidebar with the LifeBuoy icon (NOT a duplicate dashboard icon); the desk opens to an empty queue (0 tickets today) with the empty state.
3. **After the support edge fns deploy:** file a ticket from the business app (Phase 1), confirm it appears live in the queue, claim it, reply, change status/priority.
