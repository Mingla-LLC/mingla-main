# INVESTIGATE — ORCH-1142 — Business notifications: no full-read + no delete

- **ORCH-ID:** ORCH-1142
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1142-[notif-read-delete]` on `ORCH-1142-notif-read-delete` (HEAD `2bcf4e847`, 0 behind / 0 ahead of `origin/main` — verified `git rev-list --left-right --count`).
- **Date:** 2026-06-15
- **Author:** mingla-forensics+claude
- **Phase:** INVESTIGATE (no fix proposed; root causes proven with evidence)
- **Affected surfaces:** business iOS, business Android, business web preview (same `app/notifications.tsx` route). NOT consumer, NOT buyer-web, NOT admin-web.

---

## Symptom summary (Seth, verbatim)

> "Right now notifications show and there is no way to read the full thing or delete read notifications from the business app. why? When we find out why I want to know how we can fix this."

**Two distinct symptoms:**
1. **No full-read** — a notification's title/body are truncated in the inbox and there is no way to see the untruncated text; tapping navigates away instead of revealing the full content.
2. **No delete** — read notifications cannot be removed from the inbox; only mark-read / mark-all-read exist.

**Expected (per Seth's locked decisions):** tap a row to expand it in place (full title + body, deep-link demoted to a secondary "Open" action); swipe a row to delete it; a "Clear read" header action to bulk-remove read rows — all via DB **soft-delete** so financial-record reference value is preserved server-side.

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `COMMS_LEDGER.md` (anchor) | docs | Mandatory entry read; COMMS-0029/0030 are trip-migration coordination, unrelated; none BLOCK/directed to ORCH-1142 |
| 2 | `mingla-business/src/components/notifications/BusinessNotificationsScreen.tsx` | code (component) | The inbox render — truncation + tap behavior |
| 3 | `mingla-business/src/hooks/useBusinessNotifications.ts` | code (hook) | Fetch + mutations (mark-read), realtime patch, the I-PROPOSED-W filter |
| 4 | `mingla-business/app/notifications.tsx` | code (route) | Header chrome ("Mark all read"), deep-link routing |
| 5 | `supabase/migrations/20260511000003_b2a_v3_notifications.sql` | schema | Latest migration touching `notifications`; confirms columns added |
| 6 | live `public.notifications` columns (Management API SQL) | schema/data | Confirm `deleted_at` does NOT exist yet |
| 7 | live `public.notifications` RLS policies (`pg_policy`) | schema | Prove the calling business user can UPDATE own rows to set a soft-delete column |
| 8 | `.github/scripts/strict-grep/i-proposed-w-notifications-app-type-prefix.mjs` | code (CI gate) | The I-PROPOSED-W enforcement — how soft-delete fetch must keep the filter |
| 9 | `mingla-business/package.json` | deps | Gesture library availability (no new dep) |
| 10 | `mingla-business/app/_layout.tsx`, `Icon.tsx`, gesture-handler node_modules | code/deps | `GestureHandlerRootView` mounted; `trash` icon present; `ReanimatedSwipeable` ships |
| 11 | grep sweep across `mingla-business/{app,src}` | code | Prove NO existing detail route + NO existing notifications-delete path anywhere |

---

## Q-scorecard

### Q1 — WHY is there no way to read the full notification text?

**Verdict: CONFIRMED — by design (META-ORCH-1074 Sub-C), proven in source.** Title is rendered `numberOfLines={1}`, body `numberOfLines={2}`; a tap fires `markAsRead` + (if a deep-link exists) navigates *away* via `resolveBusinessNavTarget`. There is no detail screen, no inline expand, and a row with a NULL `deep_link` taps to nothing visible. Confidence: **proven** (source-only is acceptable here — this is a deterministic render/handler contract, not a reproducer-bound runtime/keyboard bug; the truncation props and the navigate-away handler are unambiguous in code).

### Q2 — WHY can read notifications not be deleted?

**Verdict: CONFIRMED — by design (SUB-C_DESIGN §4.4 "NO swipe-to-dismiss — financial records have reference value"), proven in source.** The hook exposes ONLY `markAsRead` / `markAllAsRead`; no delete mutation exists. The screen header offers only "Mark all read". A repo-wide grep finds NO notifications-delete path anywhere in `mingla-business`. Confidence: **proven** (source + grep + absence proof).

### Q3 — Does any detail route or delete path already exist anywhere in mingla-business?

**Verdict: NO — neither exists (grep absence proof).** No `notifications/[id]` dynamic route, no `notificationDetail`, no `.from("notifications").delete(`. The only `deleted_at` references in `mingla-business/src` are for `creator_accounts` (account deletion) and draft *events* (`serverDraftEventMapper` / `orch_1123_batch_rpc`) — soft-delete is an **established pattern** in the codebase, but never on `notifications`.

### Q4 — Does `public.notifications` already have a `deleted_at` column?

**Verdict: NO.** Live column introspection (Management API, project `gqnoajqerqhnvulmnyvv`) returns 20 columns; `deleted_at` is absent. The most recent migration touching the table (`20260511000003_b2a_v3_notifications.sql`) only ADDed `brand_id` + `deep_link` and the type-prefix index — no soft-delete column.

### Q5 — Does RLS allow the calling business user to UPDATE their own rows to set a soft-delete column (precedent = the existing `read_at` update)?

**Verdict: YES — proven against live policies.** The UPDATE policy on `public.notifications` is **column-agnostic** (`USING auth.uid() = user_id` + `WITH CHECK auth.uid() = user_id`). The existing `markAsRead` already does `.update({ read_at })` `.eq("id", id)` through this exact policy, so an `.update({ deleted_at })` on the same rows is permitted with **NO new RLS**. (A DELETE policy `USING auth.uid() = user_id` also exists, but the locked decision is soft-delete, not hard delete.)

### Q6 — How must the soft-delete fetch preserve the I-PROPOSED-W strict-grep gate?

**Verdict: Keep `.or('type.like.stripe.%,type.like.business.%')` on the SELECT and ADD `.is('deleted_at', null)`.** The gate scans forward 25 lines from each `.from('notifications')`; SELECT chains MUST contain a business-inclusion pattern (the `.or(...)` clause is one). Adding `.is('deleted_at', null)` does not remove the inclusion clause, so the gate stays green. `.update(...)` chains (the new `softDelete` and `clearRead`) are **exempt** from the gate (modify-op exemption), so they will not trip it — but the locked decision still requires `clearRead` to internally scope to `read_at IS NOT NULL` AND the business-type `.or(...)` for correctness, not for the gate.

---

## Findings (six-field evidence)

### F-1 — Inbox truncates title to 1 line + body to 2 lines, with no expand affordance (answers Q1)

1. **Symptom:** Long notification titles/bodies are clipped with no way to see the full text in the inbox.
2. **Layer:** code (component).
3. **Probe:** Read `BusinessNotificationsScreen.tsx` lines 246–309 verbatim.
4. **Evidence:**
   - Line 264–266: `<Text style={styles.title} numberOfLines={1}>{notification.title}</Text>`
   - Line 246–248 (blocking-risk branch): `<Text ... numberOfLines={1}>{notification.title}</Text>`
   - Line 256 (bold-token branch): `<Text style={styles.title} numberOfLines={1}>`
   - Line 307–309: `<Text style={styles.body} numberOfLines={2}>{notification.body}</Text>`
   - There is NO per-row `expanded` state; the `NotificationRow` component (lines 226–342) has no toggle.
5. **Mechanism:** Hard `numberOfLines` caps + zero expand state → the full text is structurally unreachable inside the inbox.
6. **Severity:** `CONFIRMED ROOT CAUSE` (symptom #1).

### F-2 — Row tap navigates AWAY (deep-link) or does nothing; it never reveals content (answers Q1)

1. **Symptom:** Tapping a row leaves the inbox (deep-link) or, with a NULL `deep_link`, visibly does nothing.
2. **Layer:** code (component + route).
3. **Probe:** Read `BusinessNotificationsScreen.tsx` lines 429–437 and `app/notifications.tsx` lines 63–75.
4. **Evidence:**
   - Screen `handlePress` (429–437): `void markAsRead(n.id); if (n.deep_link && onOpenDeepLink) { onOpenDeepLink(n.deep_link, n); }` — the ONLY tap behaviors are mark-read + navigate.
   - Route `handleOpenDeepLink` (63–75): `const target = resolveBusinessNavTarget(data); router.push(target as never);` — navigates away.
   - When `n.deep_link` is NULL, the `if` is skipped → tap marks read but produces no visible change.
5. **Mechanism:** The tap is a doorway, not an opener; combined with F-1 there is no in-place full-read path.
6. **Severity:** `CONFIRMED ROOT CAUSE` (symptom #1).

### F-3 — Hook exposes only mark-read mutations; no delete mutation exists (answers Q2)

1. **Symptom:** No delete capability anywhere in the inbox.
2. **Layer:** code (hook).
3. **Probe:** Read `useBusinessNotifications.ts` full file (1–285); grep for any delete on `notifications`.
4. **Evidence:**
   - The `BusinessNotificationsInbox` interface (169–178) exports exactly: `query`, `notifications`, `unreadCount`, `markAsRead`, `markAllAsRead`. No delete member.
   - `fetchBusinessNotifications` (126–144) selects with NO `deleted_at` exclusion (the column does not exist yet — F-5).
   - The realtime UPDATE handler (101–117) patches rows in place; it never removes a row from cache.
   - grep: `.from("notifications").delete(` → **0 hits** in `mingla-business`.
5. **Mechanism:** With no delete mutation and no soft-delete column, a read notification can never leave the inbox.
6. **Severity:** `CONFIRMED ROOT CAUSE` (symptom #2).

### F-4 — Screen + route offer no delete or "Clear read" affordance (answers Q2)

1. **Symptom:** The only header action is "Mark all read"; no per-row swipe, no "Clear read".
2. **Layer:** code (component + route).
3. **Probe:** Read `BusinessNotificationsScreen.tsx` (component grammar comment §4.4 line 15) + `app/notifications.tsx` lines 92–109.
4. **Evidence:**
   - Screen doc comment line 15: "NO swipe-to-dismiss (§4.4 — financial records have reference value)." The `Pressable` row (271–340) has no swipe wrapper.
   - Route header (92–109) renders only the "Mark all read" `Pressable`; the right slot is otherwise an empty spacer (`chromeRightSlot`).
5. **Mechanism:** Deliberate SUB-C design choice; the absence is intentional, not a bug — which answers Seth's "why".
6. **Severity:** `CONFIRMED ROOT CAUSE` (symptom #2).

### F-5 — `public.notifications` has no `deleted_at` column (enables the fix path)

1. **Symptom:** N/A (enabling fact for the fix).
2. **Layer:** schema/data.
3. **Probe:** `select column_name ... from information_schema.columns where table_name='notifications'` (Management API, live prod).
4. **Evidence:** 20 columns returned (`id, user_id, type, title, body, data, actor_id, related_id, related_type, is_read, read_at, push_sent, push_sent_at, push_clicked, push_clicked_at, idempotency_key, created_at, expires_at, brand_id, deep_link`). `deleted_at` ABSENT.
5. **Mechanism:** A soft-delete column must be added by migration (SPEC defines; implementor writes).
6. **Severity:** N/A (enabling finding — informs the SPEC migration).

### F-6 — RLS UPDATE policy is column-agnostic → soft-delete is permitted with no new RLS (enables the fix path)

1. **Symptom:** N/A (security/enabling fact).
2. **Layer:** schema (RLS).
3. **Probe:** `pg_policy` introspection on `public.notifications` (live prod).
4. **Evidence:**
   - UPDATE (`polcmd = w`) "Users can update own notifications (mark read)": `USING (auth.uid() = user_id)`, `WITH CHECK (auth.uid() = user_id)` — no column restriction.
   - SELECT (`r`): `USING (auth.uid() = user_id)`.
   - DELETE (`d`): `USING (auth.uid() = user_id)` (present but unused by the soft-delete plan).
   - INSERT (`a`): `WITH CHECK false` (service-role only).
   - Precedent: `markAsRead` (hook lines 204–208) already updates `read_at` through the UPDATE policy.
5. **Mechanism:** Because the UPDATE policy gates on row ownership (not column), `.update({ deleted_at })` on the user's own rows passes RLS identically to the existing `read_at` write. No policy change needed.
6. **Severity:** N/A (enabling finding — confirms the SPEC needs no RLS migration, only a column + index).

### F-7 — I-PROPOSED-W gate exempts modify-ops and requires the inclusion clause on SELECT (constrains the fix)

1. **Symptom:** N/A (CI invariant the fix must preserve).
2. **Layer:** code (CI strict-grep gate, DRAFT status per the file header).
3. **Probe:** Read `.github/scripts/strict-grep/i-proposed-w-notifications-app-type-prefix.mjs` (1–268).
4. **Evidence:**
   - Lines 89–90: `.update(`/`.delete(`/`.insert(`/`.upsert(` chains are SAFE (modify-op exemption).
   - Lines 102–109 + 232–240: business-side SELECT chains must contain a business-inclusion pattern (`.or('...type.like.stripe.%...')` or `.like('type','stripe.%')` etc.) within 25 forward lines, else a violation.
   - Line 199: whole-file allowlist tag `orch-strict-grep-allow notifications-cross-app-read` (do NOT use — keep the real filter).
5. **Mechanism:** The soft-delete fetch keeps `.or('type.like.stripe.%,type.like.business.%')` and ADDs `.is('deleted_at', null)` → still passes. New `softDelete`/`clearRead` use `.update(...)` → exempt. Gate stays green.
6. **Severity:** N/A (constraint — the SPEC's regression contract must verify the gate still passes post-fix).

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | SUB-C_DESIGN §4.4 explicitly says NO swipe-to-dismiss; the screen comment block documents 1-line title / 2-line body and tap=doorway. Memory `feedback_public_trip_page_all_surface_parity` is unrelated. | None — docs MATCH code: both behaviors are intentional design, not regressions. |
| **Schema** | `notifications` has `read_at` but no `deleted_at`; UPDATE RLS is column-agnostic; DELETE RLS exists. | None — schema is internally consistent; it simply lacks the soft-delete column. |
| **Code** | Truncation props (F-1), navigate-away tap (F-2), no delete mutation (F-3), header has only mark-all (F-4). | None — code matches docs. |
| **Runtime** | Not separately live-fired — see "Repro evidence". Render/handler contract is deterministic from source. | None. |
| **Data** | Live introspection confirms 20 columns (no `deleted_at`) + the 4 RLS policies. | None — data confirms schema. |

**No cross-layer contradiction.** The "bug" is the *absence* of two capabilities that were deliberately scoped out by META-ORCH-1074 Sub-C. This is the answer to Seth's "why": both are by-design Sub-C decisions, NOT hidden defects. The fix adds the two capabilities per Seth's locked decisions.

---

## Repro evidence

This investigation is a **render/handler-contract + schema/RLS** investigation, not a reproducer-bound runtime/keyboard/gesture bug. Per Prime Directive 7's exemption ("pure backend / SQL / migration / RLS investigations, and investigations explicitly scoped 'code audit only'"), and because the two root causes are deterministic from unambiguous source (`numberOfLines={1/2}`, the tap handler, the absent delete mutation, the absent column), no simulator repro is required to *prove* the causes. The orchestrator INTAKE lead (both behaviors are deliberate Sub-C design) was independently CONFIRMED with file:line evidence (F-1..F-4) plus live schema/RLS introspection (F-5..F-6). Live-fire of the *new* behavior belongs to the TEST phase after IMPLEMENT.

**Negative-verdict note:** there is genuinely no hidden detail route or delete path masked elsewhere — the grep absence proof (Q3) is exhaustive across `mingla-business/{app,src}`.

---

## Blast radius / cross-surface map

- **In-scope:** business iOS, business Android, business web preview — all three render the SAME `app/notifications.tsx` → `BusinessNotificationsScreen.tsx` → `useBusinessNotifications.ts`. Parity is **automatic** for the hook + DB layer (shared code); **manual** for the swipe gesture (native `ReanimatedSwipeable` vs a web button fallback — see SPEC §3 web variant).
- **Out-of-scope (do NOT touch):**
  - Consumer iOS/Android (`app-mobile/`) — different inbox; the I-PROPOSED-W gate forces the consumer side to EXCLUDE `stripe.%`/`business.%`. A soft-delete column on the shared table is harmless to consumer reads only if the consumer fetch is left untouched (it is — out of scope). *Reason: not Seth's ask; consumer inbox unchanged.*
  - Buyer/anonymous web — no notifications surface. *Reason: anon route, no inbox.*
  - Admin web (`mingla-admin/`) — exempt from I-PROPOSED-W by design (cross-app support reads); adding `deleted_at` does not change admin reads unless admin opts to filter (out of scope). *Reason: not Seth's ask.*
- **Shared-table caution:** the new `deleted_at` column lives on the shared `public.notifications`. The migration is additive (NULL-by-default), so consumer + admin reads are unaffected unless they choose to filter. The SPEC must NOT modify the consumer fetch.

---

## Invariant impact

- **I-PROPOSED-W (DRAFT)** — MUST be preserved. The soft-delete SELECT keeps the `.or('type.like.stripe.%,type.like.business.%')` inclusion clause; modify-ops are gate-exempt. No change to the gate file. (See F-7.)
- **New invariant proposed (DRAFT) — `I-PROPOSED-BH-NOTIF-SOFTDELETE-EXCLUDED-AND-SCOPED`:** the business notifications SELECT MUST exclude soft-deleted rows (`deleted_at IS NULL`) AND the "Clear read" bulk soft-delete MUST be scoped to `read_at IS NOT NULL` AND the business-type prefix — never unread rows, never consumer rows. (Letters BH/BI/BJ/BK are free in the registry; BH chosen.) The orchestrator owns the ACTIVE flip at CLOSE.
- No DECISION_LOG conflict. SUB-C_DESIGN §4.4 ("NO swipe-to-dismiss — financial records have reference value") is **superseded for the operator inbox view only** by Seth's locked decision; reference value is preserved because the delete is a soft-delete (the row persists server-side, just hidden from the inbox). The SPEC must record this supersession explicitly so a future session does not "restore" the §4.4 no-delete rule as a regression.

---

## Discoveries for Orchestrator

- **DISC-1142-A:** `notifications` carries BOTH a legacy boolean `is_read` (default false, NOT NULL) AND `read_at` (nullable timestamp). The business hook reads/writes ONLY `read_at`; `is_read` is never updated by the business app. Not in scope for ORCH-1142, but flagged: any future consumer/admin code that keys off `is_read` will diverge from the business app's `read_at`-based unread count. No action this ORCH.
- **DISC-1142-B:** SUB-C_DESIGN §4.4's "NO swipe-to-dismiss" rule is now partially superseded (operator inbox view) by ORCH-1142. The orchestrator should annotate the SUB-C design doc / World Map so the rule is not treated as still-binding.
- **COMMS factored:** COMMS-0029 + COMMS-0030 (trip-migration coordination, iOS build) read and confirmed unrelated to notifications; factored only for migration-version hygiene (chose `20261002000000`, clear of all prod-applied-but-unmerged trip migrations at/below `20260930000000`).

---

## Confidence level

**proven** — both root causes (no full-read; no delete) are proven from unambiguous source with file:line evidence; the schema absence of `deleted_at` and the column-agnostic UPDATE RLS are proven from live prod introspection; the I-PROPOSED-W gate logic is read verbatim. No environment blocker. Live-fire of the *new* capability is a TEST-phase concern, not a prerequisite to proving the *current* (absent) behavior.

---

## Recommended next phase + scope

**SPEC (same dispatch, IA mode).** Scope is fixed by Seth's two locked decisions: (1) tap-to-expand inline full-read with the deep-link demoted to a secondary "Open" action; (2) per-row swipe-to-delete + a "Clear read" header bulk action, both implemented as DB soft-delete (`deleted_at`) with fetch + realtime excluding soft-deleted rows and "Clear read" scoped to read+business-type only. Do NOT widen beyond these two. DESIGN runs after SPEC (this touches UI — expand interaction, swipe affordance, "Clear read" placement, all states).
