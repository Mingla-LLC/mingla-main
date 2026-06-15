# SPEC — ORCH-1142 — Business notifications: full-read (tap-to-expand) + delete (soft-delete)

- **ORCH-ID:** ORCH-1142
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1142-[notif-read-delete]` on `ORCH-1142-notif-read-delete` (HEAD `2bcf4e847`).
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1142_NOTIF_READ_AND_DELETE.md` (this worktree).
- **Date:** 2026-06-15 · **Author:** mingla-forensics+claude · **Mode:** SPEC (binding contract; ≤2–3-line snippets only).
- **Pipeline note:** DESIGN runs AFTER this SPEC (UI-touching). §4-Component + §12-Design carry the design intent the implementor must NOT improvise on; the finished pixel spec from `mingla-designer` is appended/embedded before IMPLEMENT.

---

## 1. Executive summary

Business operators can see notifications but can neither read the full (untruncated) text nor remove read notifications — both are deliberate META-ORCH-1074 Sub-C scope-outs (proven: F-1..F-4). This SPEC adds two capabilities, exactly to Seth's locked decisions:

1. **Full-read = tap-to-expand in place.** Tapping a row toggles an inline expanded state that shows the untruncated title + body. The deep-link becomes a SECONDARY action: an "Open" button revealed only in the expanded state. Mark-as-read still fires on the first interaction.
2. **Delete = per-row swipe-to-delete + a "Clear read" header bulk action**, both implemented as a **DB soft-delete** (`deleted_at timestamptz` on `public.notifications`, NULL by default). The inbox fetch + realtime patch exclude soft-deleted rows. "Clear read" soft-deletes only rows where `read_at IS NOT NULL` AND the business-type prefix — never unread, never consumer rows. Financial-record reference value is preserved server-side (the row persists; it is only hidden from the operator inbox).

---

## 2. Scope & non-goals

**In scope:** business iOS + business Android + business web preview (one shared route). The migration (additive soft-delete column + index), the hook (`useBusinessNotifications.ts`), the screen (`BusinessNotificationsScreen.tsx`), the route header (`app/notifications.tsx`).

**Non-goals (explicit):**
- NO consumer (`app-mobile/`) changes — the consumer inbox fetch is untouched (its I-PROPOSED-W exclusion already holds). The new column is additive/NULL-default, so consumer reads are unaffected.
- NO admin (`mingla-admin/`) changes.
- NO hard delete — soft-delete only (preserves reference value). Do NOT use the existing DELETE RLS policy.
- NO push/OneSignal change; NO notify-dispatch / edge-function change (the column is operator-writable via RLS — F-6).
- NO new dependency — `react-native-gesture-handler` (~2.28.0) + `react-native-reanimated` (~4.1.1) are already present and `GestureHandlerRootView` is mounted at the app root (`mingla-business/app/_layout.tsx:665`).
- NO change to mark-read / mark-all-read semantics, the date bucketing, severity float, or the family-accent grammar.
- NO removal of the I-PROPOSED-W filter clause.

**Assumptions:** the soft-delete is a UI-inbox hide, not a GDPR erasure (erasure has its own path, `b2a_v3_gdpr_erasure`). The expand state is ephemeral (component state, not persisted).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | unchanged | none | n/a — *not Seth's ask; consumer inbox separate* |
| 2 | Consumer Android (`app-mobile/` Android) | NO | unchanged | none | n/a — *same reason* |
| 3 | Buyer/anonymous Web | NO | unchanged | none | n/a — *no notifications surface* |
| 4 | Business iOS | YES | tap-to-expand full text + "Open" secondary; swipe-to-delete; "Clear read" header | screen, hook, route, migration | automatic (shared hook/DB); manual (native swipe) |
| 5 | Business Android | YES | same as iOS | same | automatic (shared); manual (native swipe + Android glass opaque fill on expanded card) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NO | unchanged | none | n/a — *exempt from I-PROPOSED-W; not in ask* |
| 7 | Business Web preview (adjacent) | YES | tap-to-expand full text + "Open"; swipe DEGRADES to a visible "Delete" button on the row; "Clear read" header | screen (`.web` branch via `Platform.OS === "web"`), hook, route | manual (web button instead of swipe) |

**Hard gate:** the implementor must satisfy surfaces 4, 5, AND 7. Shipping native expand/swipe without the web delete-button fallback (or vice versa) is incomplete.

---

## 4. Layered specification

### 4.A Database (migration — implementor writes; SPEC defines exactly)

- **Migration file:** `supabase/migrations/20261002000000_orch_1142_notifications_soft_delete.sql`
  - **Version rationale:** live migration head is `20261001000000` (verified via `list_migrations`) and the worktree's last file is the same. `20261002000000` is the next free monotonic slot, clear of all COMMS-0029/0030 prod-applied-but-unmerged trip migrations (all at/below `20260930000000`). **At deploy time, re-verify the prod head with `list_migrations`** and bump the date prefix if a newer migration landed first (per `feedback_edge_deploy_and_migration_apply_hazards` — apply via Management API; CLI is drift-wedged).
- **Column:** `ALTER TABLE "public"."notifications" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;` (nullable, NO default → NULL = not deleted). `COMMENT ON COLUMN` explaining soft-delete + reference-value preservation + ORCH-1142.
- **Index (partial, for the exclusion filter):**
  `CREATE INDEX IF NOT EXISTS "idx_notifications_user_active" ON "public"."notifications" ("user_id", "created_at" DESC) WHERE "deleted_at" IS NULL;`
  Rationale: the hot path is "this user's non-deleted business rows, newest first". Partial index keeps it lean (most rows stay NULL).
- **RLS:** **NO new policy.** Proven (F-6): the UPDATE policy "Users can update own notifications (mark read)" is column-agnostic (`USING auth.uid()=user_id` + `WITH CHECK auth.uid()=user_id`), so the user can set `deleted_at` on their own rows exactly as `read_at` is set today. Do NOT add or alter any policy. Do NOT use the DELETE policy.
- **No GRANT change** — `authenticated` already has UPDATE on the table (precedent: existing mark-read writes).

### 4.B Hook (`mingla-business/src/hooks/useBusinessNotifications.ts`)

1. **`BusinessNotification` interface:** add `deleted_at: string | null;` and add `deleted_at` to `SELECT_COLUMNS`.
2. **`fetchBusinessNotifications` (the SELECT):** keep the existing `.or("type.like.stripe.%,type.like.business.%")` clause **verbatim** (I-PROPOSED-W) and ADD `.is("deleted_at", null)` to the chain. Order/limit unchanged. (Gate stays green — F-7: inclusion clause still present on the SELECT.)
3. **New `softDelete(id: string): Promise<void>`** — optimistic single-row soft-delete:
   - Snapshot prev cache for `businessNotificationKeys.all(userId)`.
   - Optimistically REMOVE the row from cache: `old.filter((n) => n.id !== id)`.
   - `await supabase.from("notifications").update({ deleted_at: new Date().toISOString() }).eq("id", id)` (targets by PK; gate-exempt modify-op).
   - On error: restore prev cache (or invalidate if prev undefined); `__DEV__` warn. Same silent-revert grammar as `markAsRead` (no operator alarm for a transient blip).
   - Recompute the iOS badge after removal (mirror `markAsRead`'s `clearNotificationBadge` when no unread remain).
4. **New `clearRead(): Promise<void>`** — optimistic bulk soft-delete scoped to read + business-type:
   - Snapshot prev cache.
   - Optimistically REMOVE all rows where `read_at !== null` from cache.
   - `await supabase.from("notifications").update({ deleted_at: nowIso }).eq("user_id", userId).is("read_at", null === false ...)` — **EXACT scope:** `.eq("user_id", userId)`, `.not("read_at", "is", null)` (read rows only), `.is("deleted_at", null)` (don't re-stamp), AND `.or("type.like.stripe.%,type.like.business.%")` (business-type only — never consumer). NEVER soft-delete unread or consumer rows.
   - On error: restore prev cache; `__DEV__` warn.
5. **Realtime UPDATE patch (lines 101–117):** when an UPDATE arrives with `deleted_at !== null` for a business row, DROP it from cache instead of patching it in place:
   `if (updated.deleted_at !== null) { setQueryData(key, (old=[]) => old.filter((n) => n.id !== updated.id)); return; }` — placed before the existing `.map` patch. This keeps multi-device inboxes consistent (delete on phone A removes it on phone B). The INSERT handler is unchanged.
6. **`BusinessNotificationsInbox` interface:** add `readonly softDelete: (id: string) => Promise<void>;` and `readonly clearRead: () => Promise<void>;`. Return them from the hook. `notifications` and `unreadCount` derivations unchanged (deleted rows are already absent from cache).
7. **Optional `hasRead` derived boolean** (`notifications.some((n) => n.read_at !== null)`) for the route to gate the "Clear read" header action. Add to the interface as `readonly hasRead: boolean;`.

### 4.C Component (`mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx`)

1. **Per-row expand state:** `NotificationRow` gains an `expanded` boolean (lifted to the screen as a `Set<string>` of expanded ids, OR local `useState` per row — implementor's choice, but expansion MUST collapse other rows is NOT required; multiple rows may be expanded). On row press: toggle expanded for this row AND fire `markAsRead(n.id)` on first interaction (mark-read must still happen even when only expanding).
2. **Expanded render:** when `expanded`, the title renders with NO `numberOfLines` cap (full text) and the body with NO `numberOfLines` cap. When collapsed, keep `numberOfLines={1}` (title) / `numberOfLines={2}` (body) exactly as today. The bold-token and blocking-risk title variants must also drop their cap when expanded.
3. **Secondary "Open" action:** when `expanded` AND `n.deep_link !== null`, render an "Open" button (revealed in the expanded state) that calls a new `onOpenDeepLink(n.deep_link, n)` — the SAME prop the route already passes. The deep-link is NO LONGER fired on plain tap (tap now = expand). Blocking-risk rows keep their existing "Respond" affordance; "Open" is additive and may co-exist.
4. **Tap contract change:** `handlePress` (screen, lines 429–437) no longer navigates on tap. New contract: tap → `markAsRead(n.id)` + toggle expand. Navigation happens ONLY via the expanded "Open" button (or the "Respond" CTA for blocking-risk). The `onOpenDeepLink` prop is still consumed, just from the "Open"/"Respond" buttons.
5. **Swipe-to-delete (native):** wrap each `NotificationRow` in `ReanimatedSwipeable` (named import from `react-native-gesture-handler` — NOT the legacy `Swipeable`; reanimated v4 is present). `renderRightActions` renders a destructive red panel with the `trash` icon (icon key `trash` confirmed present). On full swipe / action tap → `HapticFeedback` + `softDelete(n.id)`. Use `semantic.error` for the destructive panel; respect the Android glass opaque-fallback policy on the row card.
6. **Web variant (`Platform.OS === "web"`):** `ReanimatedSwipeable` swipe does not apply; instead render a visible trailing "Delete" affordance on each row (e.g. a small trash `Pressable` revealed on hover/focus or always-visible per DESIGN) that calls `softDelete(n.id)`. The `isWeb` constant already exists at line 116.
7. **States (all must be handled):**
   - **Collapsed (default):** as today (1-line title / 2-line body, chevron, unread rail/dot).
   - **Expanded:** full title + body, "Open" button if `deep_link`, chevron rotates or hides (DESIGN decides), card may grow height.
   - **Optimistic-delete in flight:** row removed immediately from the list.
   - **Delete revert on error:** row reappears in its prior position (cache restore); a non-alarming `__DEV__` warn only (matches mark-read grammar).
   - **Empty after clear-all:** the existing `EmptyState` ("You're all caught up") renders. The "Clear read" header action must hide (or disable) when no read rows remain.
   - Existing skeleton / error+retry / offline-banner states are unchanged.
8. **a11y:** the row `accessibilityLabel` should append "Expanded" / "Collapsed"; the "Open" button gets `accessibilityRole="button"` + label "Open notification target"; the swipe/web delete gets label "Delete notification". Maintain ≥44pt touch targets.

### 4.D Route header (`mingla-business/app/notifications.tsx`)

1. Add a **"Clear read"** action as a SIBLING to "Mark all read" in the chrome header right region. Render it only when `hasRead` is true (from the hook). It calls `clearRead()` (+ `HapticFeedback` on native).
2. Both actions may co-exist: "Mark all read" shows when `unreadCount > 0`; "Clear read" shows when `hasRead`. When both show, lay them out per DESIGN (likely a small action cluster; the current right slot is a single `Pressable`). Use the `trash` icon + accent for "Clear read", mirroring the `check` + accent for "Mark all read".
3. Pull `softDelete`, `clearRead`, `hasRead` from `useBusinessNotificationsInbox`. Pass `onOpenDeepLink` to the screen unchanged (now consumed by the expanded "Open" button).
4. Web: the header renders the same "Clear read" action; the route already has a web `close` affordance.

### 4.E Realtime

Channel + filter unchanged (`user_id=eq.${userId}`). The UPDATE handler gains the soft-delete drop branch (§4.B item 5). No new channel.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1 (full-read):** Tapping a collapsed row expands it in place to show the COMPLETE title + body (no truncation), and marks it read on first tap. Tapping again collapses it.
- **SC-2 (deep-link demoted):** In the expanded state, a row with a non-NULL `deep_link` shows an "Open" button that navigates to the resolved target; plain tap NO LONGER navigates. A row with NULL `deep_link` shows no "Open" button and tap only expands/marks-read.
- **SC-3-iOS / SC-3-Android (swipe delete):** Swiping a row left reveals a destructive trash action; completing it removes the row immediately (optimistic) and soft-deletes it server-side (`deleted_at` set). The row does not reappear on refetch.
- **SC-3-Web:** A visible "Delete" affordance on each row removes it (no swipe gesture required).
- **SC-4 (Clear read):** The header "Clear read" action soft-deletes every row where `read_at IS NOT NULL` AND type matches `stripe.%`/`business.%`; unread rows and any consumer rows are untouched. The inbox updates immediately; refetch confirms only unread/business rows remain.
- **SC-5 (revert on error):** When `softDelete` or `clearRead`'s UPDATE returns an error, the optimistically-removed row(s) reappear in prior order; no crash, no alarming UI (silent `__DEV__` warn only).
- **SC-6 (realtime multi-device):** A soft-delete performed on device A removes the row from device B's inbox within the realtime UPDATE patch (no manual refetch).
- **SC-7 (reference value preserved):** After soft-delete, the row still exists in `public.notifications` with `deleted_at` set (NOT physically deleted) — confirmable by a service-role/admin SELECT.
- **SC-8 (I-PROPOSED-W intact):** The strict-grep gate `i-proposed-w-notifications-app-type-prefix.mjs` passes after the change (the SELECT keeps the inclusion clause; modify-ops exempt).
- **SC-9 (empty state):** After clearing all read rows with no unread remaining, the "You're all caught up" empty state renders and "Clear read" hides.

---

## 6. Invariants

**Preserved:**
- **I-PROPOSED-W (DRAFT)** — soft-delete SELECT keeps `.or('type.like.stripe.%,type.like.business.%')`; modify-ops gate-exempt. Verified by SC-8 + the existing gate run.

**New (propose as DRAFT — orchestrator flips ACTIVE at CLOSE):**
- **`I-PROPOSED-BH-NOTIF-SOFTDELETE-EXCLUDED-AND-SCOPED` (DRAFT):** the business notifications SELECT MUST exclude soft-deleted rows (`.is("deleted_at", null)`), AND the "Clear read" bulk soft-delete MUST be scoped to `read_at IS NOT NULL` AND the business-type prefix `.or("type.like.stripe.%,type.like.business.%")` — never unread rows, never consumer rows. (Letter BH is free in the registry; BI/BJ/BK also free as fallbacks.)
  - **Why a gate:** without the `deleted_at IS NULL` filter, soft-deleted rows resurface in the inbox (defeats the feature); without the read+business scope on "Clear read", the bulk action could nuke unread or consumer notifications (data-loss + cross-app leak).
  - **Enforcement option (DRAFT, implementor to add):** extend the existing strict-grep gate OR add a small jest source-assertion (see §9) — the SPEC requires the jest source-assertion at minimum; a strict-grep extension is optional.

**Superseded (record explicitly):** SUB-C_DESIGN §4.4 "NO swipe-to-dismiss — financial records have reference value" is superseded for the operator inbox VIEW only. Reference value is preserved via soft-delete (row persists server-side). The implementor must add a protective comment at the new delete code AND the orchestrator should annotate the SUB-C design doc, so a future session does not "restore" §4.4 as a regression.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 | Expand happy path | Tap a collapsed row with long title/body | Full text shown, row marked read | component |
| T2 | Collapse | Tap an expanded row | Collapses to 1-line/2-line | component |
| T3 | Open secondary | Expanded row, `deep_link` non-null, tap "Open" | Navigates to resolved target | component+route |
| T4 | No deep-link | Expanded row, `deep_link` null | No "Open" button; tap only expands/marks-read | component |
| T5 | Swipe delete (native) | Swipe + confirm | Row removed; `update({deleted_at})` by id fired | component+hook+db |
| T6 | Web delete | Click row "Delete" affordance on web | Row removed (no swipe) | component (web) |
| T7 | Clear read scope | 2 read business + 1 unread business + (simulated) 1 read consumer row in DB | Only the 2 read business rows get `deleted_at`; unread + consumer untouched | hook+db |
| T8 | softDelete revert | UPDATE returns error | Removed row reappears in prior order; `__DEV__` warn | hook |
| T9 | clearRead revert | UPDATE returns error | All removed rows reappear; warn | hook |
| T10 | Realtime drop | Inbound UPDATE payload with `deleted_at != null`, business type | Row dropped from cache | hook (realtime) |
| T11 | Fetch excludes deleted | Row with `deleted_at` set | Absent from inbox after refetch | hook+db |
| T12 | I-PROPOSED-W gate | Run the strict-grep gate post-change | Exit 0 (passes) | CI |
| T13 | Reference value | Soft-deleted row | Still present in table with `deleted_at` set (service-role SELECT) | db |
| T14 | Empty after clear | Clear all read, no unread | "You're all caught up"; "Clear read" hidden | component+route |

---

## 8. Implementation order

1. **DB:** write + apply (via Management API, after re-checking prod head) `20261002000000_orch_1142_notifications_soft_delete.sql` (column + partial index; NO RLS change).
2. **Hook:** add `deleted_at` to interface + `SELECT_COLUMNS`; add `.is("deleted_at", null)` to fetch; add `softDelete` + `clearRead` + `hasRead`; add the realtime soft-delete drop branch; export the new members.
3. **Component:** add expand state + full-text expanded render + "Open" secondary button; change tap contract (expand+mark-read, no navigate); wrap rows in `ReanimatedSwipeable` (native) with a web "Delete" fallback; handle all states; a11y.
4. **Route:** add "Clear read" header action gated on `hasRead`; lay out alongside "Mark all read"; wire `softDelete`/`clearRead`.
5. **Tests:** add the jest source-assertion for `I-PROPOSED-BH` + the regression test (§9); run the I-PROPOSED-W gate.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the soft-delete exclusion + the read/business scope on "Clear read".
- **Test (jest source-assertion, REQUIRED):** add `mingla-business/src/hooks/__tests__/orch_1142_notif_softdelete_scope.test.ts` that reads `useBusinessNotifications.ts` source and asserts:
  1. `fetchBusinessNotifications` contains BOTH `type.like.stripe.%` AND `.is("deleted_at", null)`.
  2. `clearRead` contains `.is("read_at", null)` is NOT present as a delete-all (i.e. it targets `read_at` IS NOT NULL) AND contains the business-type `.or(...)`.
  3. `softDelete` updates `deleted_at` and targets by `.eq("id"`.
  - **Fails-on-revert:** removing the `.is("deleted_at", null)` filter, or widening `clearRead` to drop the read/business scope, MUST fail this test; restoring it MUST pass. The implementor proves the fail-on-revert.
- **I-PROPOSED-W:** the existing `i-proposed-w-notifications-app-type-prefix.mjs` gate already fails-on-revert if the inclusion clause is removed — re-confirm it passes (SC-8/T12).
- **Protective comment:** at the new delete code, add a comment citing ORCH-1142 + the SUB-C §4.4 supersession + "soft-delete preserves reference value; do NOT convert to hard delete or remove the deleted_at filter."

---

## 10. Open questions

1. **Expand multiplicity:** may multiple rows be expanded at once, or should opening one collapse others? SPEC default: allow multiple (simpler, no surprise collapse). DESIGN may override.
2. **Web delete affordance visibility:** always-visible trash vs hover/focus-revealed? Deferred to DESIGN.
3. **"Clear read" confirmation:** does Seth want a confirm step (could be many rows) or immediate-with-undo? SPEC default: immediate (matches "Mark all read" which has no confirm); the optimistic revert covers transient errors but NOT user mistake-undo. Flag for Seth — if undo is wanted, that is a scope addition.
4. **Swipe direction + threshold:** left-swipe to delete (iOS convention) — confirm with DESIGN; full-swipe auto-deletes vs reveal-then-tap.

(None of these block IMPLEMENT structurally except #3 if Seth wants undo; the rest are DESIGN refinements.)

---

## 11. Allowlist + DO-NOT-TOUCH

**Allowlist (implementor may modify/create ONLY these):**
- `supabase/migrations/20261002000000_orch_1142_notifications_soft_delete.sql` (new)
- `mingla-business/src/hooks/useBusinessNotifications.ts`
- `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx`
- `mingla-business/app/notifications.tsx`
- `mingla-business/src/hooks/__tests__/orch_1142_notif_softdelete_scope.test.ts` (new)
- (optional) `.github/scripts/strict-grep/` — ONLY if adding an `I-PROPOSED-BH` strict-grep gate (not required; jest assertion suffices)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — append the `I-PROPOSED-BH` DRAFT entry (orchestrator may instead own this at CLOSE; coordinate).

**DO-NOT-TOUCH:**
- Any `app-mobile/` (consumer) file — consumer fetch + I-PROPOSED-W exclusion stay as-is.
- Any `mingla-admin/` file.
- The I-PROPOSED-W gate's inclusion logic (do not weaken; do not add the file allowlist tag).
- `notify-dispatch` / any edge function / the `notification_preferences` table / `is_read` column.
- RLS policies on `public.notifications` (none needed — F-6).
- `businessNotificationRouting.ts` / `resolveBusinessNavTarget` (the "Open" button reuses the existing route map unchanged).
- Date bucketing, severity float, family-accent grammar, mark-read/mark-all semantics.

The implementor must STOP-and-amend (SPEC amendment) before touching anything outside the allowlist.

---

## 12. Design phase (mingla-designer — runs after this SPEC, before IMPLEMENT)

This change is UI-touching. DESIGN must produce the pixel-precise spec for:
- The **expanded card** state (height growth, full-text type/line-height, "Open" button placement/style, chevron rotate-or-hide, motion of the expand — trigger→curve→duration→property).
- The **swipe-to-delete** affordance (right-action panel width, destructive red token, trash icon size, full-swipe threshold vs reveal, haptic timing) + the **web "Delete"** fallback (visibility model).
- The **header action cluster** when both "Mark all read" and "Clear read" are present (layout, spacing, icon+label, the empty/hidden states).
- Per-platform deltas incl. Android glass opaque-fallback on the expanded card; a11y (≥44pt, labels, expanded/collapsed announcement).

The finished design contract is embedded here (or referenced) before the IMPLEMENT dispatch. The implementor builds from SPEC + embedded design; design questions during IMPLEMENT route back through the orchestrator to forensics, not to the designer directly.

---

## 13. Downstream routing

- **Next:** DESIGN (`mingla-designer`, business iOS/Android/web) → produce the pixel spec for §12; embed into this SPEC.
- **Then:** IMPLEMENT (`mingla-implementor`, business side) in this worktree — build §4 in §8 order, prove the §9 fails-on-revert.
- **Then:** TEST (`mingla-tester`, business iOS + Android + web) — live-fire SC-1..SC-9 on sim/device.
- **Then:** orchestrator CLOSE — flip `I-PROPOSED-BH` ACTIVE, annotate SUB-C §4.4 supersession, OTA the business app (pure-JS/RN changes are OTA-eligible; the migration deploys server-side independently).
- **Working tree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1142-[notif-read-delete]` on branch `ORCH-1142-notif-read-delete`.
