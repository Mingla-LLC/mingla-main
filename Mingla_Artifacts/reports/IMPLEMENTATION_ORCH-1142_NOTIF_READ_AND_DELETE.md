# IMPLEMENTATION — ORCH-1142 — Business notifications: full-read (tap-to-expand) + delete (soft-delete)

- **ORCH-ID:** ORCH-1142 [notif-read-delete]
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1142-[notif-read-delete]` on `ORCH-1142-notif-read-delete`
- **Built from:** `SPEC_ORCH-1142_NOTIF_READ_AND_DELETE.md` + `DESIGN_ORCH-1142_NOTIF_READ_AND_DELETE.md` (both in worktree)
- **Author:** mingla-implementor+claude · **Date:** 2026-06-15 · **Status:** implemented and verified (source/type/gate/test); native swipe + on-device UX **unverified — needs tester live-fire**
- **Comms ledger:** read on entry. No BLOCK/OPEN row targets ORCH-1142, this skill, or ALL that blocks this work. Active WARNs are unrelated trip-migration coordination (factored, no action). No new COMMS entry needed (no cross-ORCH discovery).

---

## 1. Summary (plain English)

Business operators can now (1) tap any notification to expand it in place and read the full untruncated title + body — with the deep-link demoted to a secondary "Open" button inside the expanded card — and (2) remove read/handled notifications via per-row left-swipe (native) or an always-visible trash button (web), plus a header "Clear read" bulk action behind a confirm dialog. Delete is a **soft-delete**: the row is hidden from the inbox but preserved server-side (financial-record reference value intact). Nothing in the resting/collapsed row changed.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Satisfied by (commit) |
|----|-----------|--------|------------------------|
| SC-1 | Tap expands in place → full title+body, marks read first tap, tap again collapses | ✓ implemented | `488ffca8b` screen |
| SC-2 | Deep-link demoted to "Open" in expanded state; plain tap no longer navigates; no Open when deep_link null | ✓ implemented | `488ffca8b` screen + route |
| SC-3-iOS / SC-3-Android | Left-swipe reveals destructive trash; full-swipe / tap-panel removes optimistically + sets `deleted_at`; no reappear on refetch | ✓ implemented · **swipe gesture UNVERIFIED (needs device)** | `488ffca8b` screen + hook + migration |
| SC-3-Web | Visible per-row "Delete" affordance removes the row (no swipe) | ✓ implemented | `488ffca8b` screen (`WebTrashButton`) |
| SC-4 | "Clear read" soft-deletes read + `stripe.%`/`business.%` rows only; unread + consumer untouched | ✓ implemented + gated by test | `488ffca8b` hook + route |
| SC-5 | Revert on error: optimistically-removed rows reappear in prior order; silent `__DEV__` warn | ✓ implemented | `488ffca8b` hook |
| SC-6 | Realtime multi-device: a soft-delete UPDATE drops the row from another device's cache | ✓ implemented · **multi-device UNVERIFIED (needs 2 devices)** | `488ffca8b` hook (realtime) |
| SC-7 | Reference value preserved: row persists with `deleted_at` set (no hard delete) | ✓ implemented (soft-delete only; DELETE policy untouched) | `488ffca8b` migration + hook |
| SC-8 | I-PROPOSED-W gate passes (SELECT keeps inclusion clause; modify-ops exempt) | ✓ verified — gate exit 0, 0 violations | gate run |
| SC-9 | After clearing all read with no unread: empty state renders, "Clear read" hides | ✓ implemented (hasRead gate + existing EmptyState) | `488ffca8b` route + screen |

`488ffca8b` = the single implementation commit (see §3 / chat handoff).

---

## 3. Files changed

| File | Type | Δ lines (approx) |
|------|------|-------------------|
| `supabase/migrations/20261002000000_orch_1142_notifications_soft_delete.sql` | new | +33 |
| `mingla-business/src/hooks/useBusinessNotifications.ts` | modified | +95 / -3 |
| `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx` | modified | +240 / -40 |
| `mingla-business/app/notifications.tsx` | modified | +85 / -12 |
| `mingla-business/src/hooks/__tests__/orch_1142_notif_softdelete_scope.test.ts` | new (test) | +115 |

---

## 4. Data-model changes applied (WRITTEN, not applied — operator/orchestrator owns apply)

- **Migration:** `20261002000000_orch_1142_notifications_soft_delete.sql`
- **Column:** `ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS deleted_at timestamptz;` (nullable, NO default → NULL = active). `COMMENT ON COLUMN` documents soft-delete + reference-value preservation + ORCH-1142 + GDPR-erasure separation.
- **Index:** `CREATE INDEX IF NOT EXISTS idx_notifications_user_active ON public.notifications (user_id, created_at DESC) WHERE deleted_at IS NULL;` (partial — keeps the hot "active rows newest-first" path lean).
- **RLS:** NONE added/altered. Read-only prod probe (MCP `execute_sql`, SELECT only) confirmed: `notifications` has `read_at` but no `deleted_at` yet; the column-agnostic UPDATE policy `"Users can update own notifications (mark read)"` (cmd `w`) exists → owners can set `deleted_at` exactly as `read_at` today (F-6); `idx_notifications_user_active` does not exist yet. Additive migration, no guards → zero `db push` failure risk.
- **GRANT:** none (`authenticated` already has UPDATE — precedent: mark-read writes).
- **Migration SQL safety:** ALTER TABLE + CREATE INDEX only — no functions, no `RETURNS TABLE` widening → no `$function$;`/`DROP FUNCTION` needed.
- **Version monotonicity:** `20261002000000` verified free locally, across sibling worktrees, and `> ` the linked remote head `20261001000000` (`list_migrations`). **Re-verify the prod head at deploy time** and bump the prefix if a newer migration landed first (per `feedback_edge_deploy_and_migration_apply_hazards` — apply via Management API; CLI drift-wedged).

---

## 5. Edge functions touched

NONE. `deleted_at` is operator-writable via the existing RLS UPDATE policy; no `notify-dispatch` / edge change (SPEC §2 non-goal). Nothing to deploy server-side except the migration.

---

## 6. Regression tests added

- **Path:** `mingla-business/src/hooks/__tests__/orch_1142_notif_softdelete_scope.test.ts` (5 source-assertion cases — SPEC §9).
- **Passing run:** `Test Suites: 1 passed · Tests: 5 passed`.
- **Existing inbox test:** `useBusinessNotificationsInbox.test.ts` still `4 passed` (markAllAsRead semantics unchanged).
- **fails-on-revert verified at `2bcf4e847`** (worktree HEAD at IMPLEMENT): TRUE LINE DELETION of `.is("deleted_at", null)` from `fetchBusinessNotifications` → case 1 went RED (`1 failed, 4 passed`); restoring the line → `5 passed`. The test strips `//` line-comments before code assertions, so the protective-comment that also mentions `.is("deleted_at", null)` cannot produce a false pass.
- **I-PROPOSED-W gate:** `node .github/scripts/strict-grep/i-proposed-w-notifications-app-type-prefix.mjs` → exit 0, 0 violations, 1559 files scanned (SC-8).
- **I-PROPOSED-BH (new DRAFT, SPEC §6):** enforced by this jest source-assertion (the SPEC-required minimum; no strict-grep extension added — jest suffices). Orchestrator flips ACTIVE at CLOSE + appends the registry entry.

---

## 7. Old → New receipts

### `supabase/migrations/20261002000000_...sql` (new)
- **Before:** `notifications` had no soft-delete; the only way to remove a row was hard DELETE (and the SUB-C design forbade swipe-to-dismiss to protect reference value).
- **Now:** additive nullable `deleted_at` + partial active-rows index; no RLS/GRANT change.
- **Why:** SC-7 (preserve reference value) + the hot-path exclusion filter.

### `useBusinessNotifications.ts`
- **Before:** `BusinessNotification` had no `deleted_at`; fetch returned all business rows; inbox exposed only `markAsRead`/`markAllAsRead`; realtime UPDATE patched in place.
- **Now:** `deleted_at` on the interface + `SELECT_COLUMNS`; fetch adds `.is("deleted_at", null)` (I-PROPOSED-W `.or` kept verbatim); new optimistic `softDelete(id)` (by PK) + `clearRead()` (scoped to `user_id` + `read_at IS NOT NULL` + not-already-deleted + business-type `.or`) + derived `hasRead`; realtime UPDATE drops a row when `deleted_at` is set (before the in-place patch). Both new mutations silent-revert on error (mark-read grammar) + recompute the iOS badge.
- **Why:** SC-3/4/5/6/7 + the soft-delete exclusion (I-PROPOSED-BH).
- **Lines:** ~+95/-3.

### `BusinessNotificationsScreen.tsx`
- **Before:** row was a single `Pressable`; tap fired mark-read + navigate; title 1-line / body 2-line always; static chevron; no delete affordance.
- **Now:** per-row ephemeral expand (`Set<string>` on the screen, multiple may be expanded); expanded drops the title/body `numberOfLines` cap and reveals a secondary "Open" button (gated on `deep_link`); tap = mark-read + toggle expand (NO navigate); chevron rotates +90° (200ms, `easings.out`, reduced-motion snap); rows wrapped in a `rowWrapper` carrying `borderRadius`+`overflow:'hidden'`+`marginBottom` and a Reanimated `LinearTransition` (260/180-grade) for expand-resize + delete-slide; native rows wrap `ReanimatedSwipeable` (80pt solid-red trash panel, `rightThreshold=40`, `overshootRight=false`, full-swipe-commit at 40% row width via a `useAnimatedReaction` on `translation`, light threshold-cross haptic + success commit haptic); web rows render an always-visible `WebTrashButton` (typed `onHoverIn/Out` color change). a11y: `accessibilityState={{expanded}}`, "Collapsed/Expanded" suffix, REQUIRED row `accessibilityAction` "delete", Open/trash labels.
- **Why:** SC-1/2/3/3-Web/5/9 + DESIGN §1/§2/§4.
- **Lines:** ~+240/-40.

### `app/notifications.tsx`
- **Before:** header right slot held only "Mark all read" (when `unreadCount>0`), else a 36pt spacer.
- **Now:** four-state header cluster — "Mark all read" (unread>0) and/or "Clear read" (hasRead), Mark-all leftmost / Clear-read rightmost, `gap: spacing.md`; "Clear read" opens a reused `ConfirmDialog` (`variant="simple"`, `destructive`, title "Clear read notifications?", live frozen-count description with `1 read notification` singular, Confirm "Clear read"); confirm fires `clearRead()` + success haptic + dismiss; count frozen at open so a background realtime insert can't change the copy mid-read. NO `Alert.alert`, no new component.
- **Why:** SC-4/9 + DESIGN §3.
- **Lines:** ~+85/-12.

---

## 8. Cross-surface impact

| # | Surface | Affected | Behavior | Parity |
|---|---------|----------|----------|--------|
| 1 | Consumer iOS | NO | unchanged (additive NULL column; consumer fetch untouched) | n/a |
| 2 | Consumer Android | NO | unchanged | n/a |
| 3 | Buyer/anon Web | NO | unchanged (no notifications surface) | n/a |
| 4 | Business iOS | YES | tap-expand + Open + swipe-delete + Clear read | automatic (shared hook/DB) + manual (native swipe) |
| 5 | Business Android | YES | same as iOS; Android opaque-glass policy preserved (no new translucent layer; `overflow:'hidden'` clips card + red panel; shadows stay zeroed) | automatic + manual |
| 6 | Admin Web | NO | unchanged (exempt from I-PROPOSED-W; not in ask) | n/a |
| 7 | Business Web preview | YES | tap-expand + Open + always-visible trash + Clear read; swipe degrades to the trash button | manual (web button instead of swipe) |

---

## 9. Smoke / verification result

- **Source/type:** `tsc --noEmit` → 0 errors in any of the 4 changed files (project has 263 pre-existing baseline errors, none touching this ORCH).
- **Tests:** new test 5/5 green; existing inbox test 4/4 green; fails-on-revert proven at `2bcf4e847`.
- **Gate:** I-PROPOSED-W exit 0.
- **DB probe:** read-only prod SELECT confirmed the migration's assumptions (table/columns/policy/index) — see §4.
- **NOT run (label honestly):** native swipe gesture, full-swipe-commit threshold + dual haptics, multi-device realtime drop, and the expand/collapse + slide-out motion are **UNVERIFIED** — they need sim/device live-fire (the tester owns this). No `eas build` needed (pure-JS/RN; OTA-eligible) — but native runtime behavior of `ReanimatedSwipeable` + the `useAnimatedReaction` full-swipe path must be device-confirmed before CLOSE.

---

## 10. Known issues / deferred

- **Full-swipe-commit tuning:** the auto-commit fires when `translation <= -(rowWidth * 0.4)` via a worklet reaction; the exact "feel" (vs `rightThreshold` rest-open) should be eyeballed on device and the ratio/threshold nudged if it commits too eagerly or too late. No `[TRANSITIONAL]` marker — it is the intended final mechanism, just needs device tuning.
- No undo surface (by design — recovery is server-side; the confirm copy is honest: "You can't undo this here"). SPEC §10 Q3 default (immediate clear, no undo) accepted.

---

## 11. Operator action required

1. **Apply the migration** (re-verify prod head first; apply via Supabase Management API per the migration-apply hazard memo — CLI is drift-wedged). If applying via CLI from the worktree:
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1142-[notif-read-delete]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   The migration is additive + idempotent (`IF NOT EXISTS`), no guards — safe.
2. **Edge functions:** none to deploy.
3. **OTA:** after merge to main + tester PASS, OTA the business app dev channel (pure-JS/RN change; runtime biz 1.0.0) per the EAS OTA gotchas memo (`npx -y eas-cli@latest update`, per-platform).
4. **CLOSE:** flip `I-PROPOSED-BH` ACTIVE + append the registry entry; annotate META-ORCH-1074 SUB-C_DESIGN §4.4 supersession so a future session doesn't "restore" the no-swipe rule as a regression.

---

## 12. Discoveries for Orchestrator

- **SPEC vs reality — `ReanimatedSwipeable` import mechanics (minor deviation, behavior identical):** SPEC §4.C.5 / DESIGN §5 say "named import from `react-native-gesture-handler`". The installed gesture-handler 2.28.0 does NOT re-export `ReanimatedSwipeable` from the top-level barrel (only the legacy `Swipeable`). It is the **default export of the subpath** `react-native-gesture-handler/ReanimatedSwipeable`. I imported it as `import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable"` (+ `type { SwipeableMethods }`). Same component, NO new dependency. Flagging for REVIEW so it isn't mistaken for a wrong-component substitution.
- **Threshold-cross haptic:** the `HapticFeedback` util has no `.selection()`/`.light()`; per DESIGN §2.4's stated fallback I used `HapticFeedback.buttonPress()` (Light impact) for the threshold-cross and `HapticFeedback.success()` for the commit. No util change (DO-NOT-TOUCH respected).
- **Web hover:** the `hovered` Pressable style-callback arg is react-native-web-only and untyped (tsc error on native types). Implemented the DESIGN §2.6 hover color change via the typed `onHoverIn/onHoverOut` + local state in a small `WebTrashButton` (same file, no new dependency/component file beyond an in-file sub-component, consistent with the existing in-file `SkeletonRow`/`EmptyState` pattern).
- No unrelated bugs found.
