# IMPLEMENTATION — ORCH-0806: Audit Log Human-Readable Labels + Pagination + Filter

**Skill:** Claude `mingla-implementor` (parity mirror; canonical IMPLEMENT is Codex per DEC-133, dispatched here by operator)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** [SPEC_ORCH-0806_AUDIT_LOG_HUMAN_READABLE.md](../specs/SPEC_ORCH-0806_AUDIT_LOG_HUMAN_READABLE.md)
**Investigation:** [INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md](INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md) §F-05
**Status:** **implemented and verified**

---

## 1. Layman summary

The brand audit log now renders 28 known event types as plain English with optional explainer lines and icons, instead of monospace developer slugs. A horizontal filter chip row lets the user scope the list to Stripe Connect / Payouts & refunds / Orders / Legal / Ops / Other / All. The hard 100-row cap is replaced with a cursor-paginated "Load more" button. A CI gate fails the build if any new audit emitter is added without registering its label. Banner copy corrected from a misleading admin-vs-self claim to the honest self-only scope.

---

## 2. Scope confirmation

Per SPEC §1, three deliverables in one logical change:

- ✅ Slug → label resolver covering 28 emitted slugs + dynamic patterns + unknown fallback.
- ✅ Pagination via `useInfiniteQuery` with 25-row pages and cursor on `created_at`.
- ✅ Filter pill row with 7 options (All + 6 categories).

Plus SPEC §10:

- ✅ Strict-grep CI gate registered + negative control proven.
- ✅ Banner copy corrected (SPEC §7.4).

Out of scope (deferred per §2 non-goals):

- Actor name resolution (still last-6-of-UUID).
- Absolute timestamp on long-press / hover.
- RLS admin-can-read-all change.
- Schema changes.
- CSV export.
- Real-time updates.

No scope expansion.

---

## 3. File diff summary

| File | Status | Lines before → after |
|---|---|---|
| `mingla-business/src/utils/auditActionLabels.ts` | new | 0 → 285 |
| `mingla-business/src/utils/__tests__/auditActionLabels.test.ts` | new | 0 → 152 |
| `mingla-business/src/hooks/useAuditLog.ts` | rewritten | 62 → 144 |
| `mingla-business/app/brand/[id]/audit-log.tsx` | rewritten | 237 → 297 |
| `.github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` | new | 0 → 175 |
| `.github/workflows/strict-grep-mingla-business.yml` | edit | +11 lines (new job block) |

Total: 2 new utility files, 2 rewrites, 1 new CI script, 1 workflow registration.

---

## 4. Old → New Receipts

### `mingla-business/src/utils/auditActionLabels.ts` (new)

**What it did before:** N/A.
**What it does now:** Exports `resolveAuditActionLabel(action: string): AuditActionLabel` resolving every emitted audit slug to `{ title, detail?, category, iconHint }`. Static exact-match for 18 slugs, dynamic pattern-match for `stripe_connect.deadline_warning_*_sent`, `stripe.*.reconciled`, `stripe.*.orphan`, `stripe.*.{status}`, generic `stripe_connect.*`. Unknown fallback humanizes and stores raw slug in `detail`. Exports `AUDIT_CATEGORIES` + `KNOWN_STATIC_SLUGS` (used by strict-grep gate).
**Why:** SPEC §6.1, §6.2. Closes F-05 (28 raw slugs rendered verbatim).
**Lines:** 285.

### `mingla-business/src/utils/__tests__/auditActionLabels.test.ts` (new)

**What it did before:** N/A.
**What it does now:** 35 jest tests covering 7 static slug variants, 6 dynamic pattern cases, 2 unknown-fallback cases, all 18 KNOWN_STATIC_SLUGS via data-driven loop (T-07), AUDIT_CATEGORIES shape.
**Why:** SPEC §11 T-01 through T-07.
**Lines:** 152.

### `mingla-business/src/hooks/useAuditLog.ts` (rewritten)

**What it did before:** Single `useQuery` with hardcoded `limit(100)`. Returned `{ rows, isLoading, isError }`. No filter.
**What it does now:** `useInfiniteQuery` with 25-row pages. Cursor is `created_at` (descending). New `categoryFilter: AuditCategoryFilter = "all"` parameter (client-side filter via `resolveAuditActionLabel(row.action).category === categoryFilter`). Returns `{ rows, isLoading, isError, hasMore, isFetchingMore, fetchMore }`. Query key factory now keyed by `(brandId, filter)` for per-filter cache isolation.
**Why:** SPEC §6.3. Replaces the 100-row hard cap (F-05 bundled P2 finding).
**Lines:** 62 → 144.

### `mingla-business/app/brand/[id]/audit-log.tsx` (rewritten)

**What it did before:** Rendered raw `action` slug in monospace as the primary row text. Banner claimed brand admins see all team actions (false — RLS is self-only). No filter, no pagination.
**What it does now:**
- Imports `resolveAuditActionLabel` + `AUDIT_CATEGORIES`.
- Defines local `FILTER_OPTIONS = [{ id: "all", label: "All" }, ...AUDIT_CATEGORIES]`.
- `useState<AuditCategoryFilter>("all")` local-only state (component-scoped).
- Horizontal-scroll filter pill row above the list, using `Pressable` + `Pill` (accent variant when active, draft variant when inactive). `accessibilityRole="tablist"` on container; per-pill `accessibilityRole="button"`, `accessibilityLabel`, `accessibilityState.selected`.
- Row layout changed: icon column (left, `Icon` from existing `IconName` set, coloured `accent.warm`) + text column (title 600-weight + optional detail + meta line with relative time · actor · target).
- "Load more" button below the list when `hasMore === true`. While `isFetchingMore`, label flips to "Loading…" and button disables.
- Empty state shows context-aware message: "No audit entries yet" (all filter) vs "No events match this filter" + "Try a different category or 'All'." (specific filter).
- Banner copy corrected to "You see audit events tied to your account on this brand." per SPEC §7.4.
- Removed `styles.rowAction` (monospace) and `styles.rowTopLine` / `styles.rowTime` / `styles.rowTarget` / `styles.rowActor` — replaced by `iconCol`, `rowText`, `rowTitle`, `rowDetail`, `rowMeta`, `loadMoreHost`, `filterRow`, `filterChipPressable`.
**Why:** SPEC §7. Closes F-05.
**Lines:** 237 → 297.

### `.github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` (new)

**What it did before:** N/A.
**What it does now:** Eight pattern checks per SPEC §10:
  1. `auditActionLabels.ts` exists.
  2. Exports `resolveAuditActionLabel` + `AUDIT_CATEGORIES`.
  3. Every `action: "<slug>"` literal in files that call `writeAudit` is present in `KNOWN_STATIC_SLUGS`. (Dynamic slugs via template literals are intentionally NOT counted — they're pattern-matched by the resolver.)
  4. `useAuditLog.ts` uses `useInfiniteQuery`.
  5. `useAuditLog.ts` accepts `categoryFilter: AuditCategoryFilter`.
  6. `audit-log.tsx` imports `resolveAuditActionLabel`.
  7. `audit-log.tsx` no longer references `styles.rowAction` (negative grep — proves raw-slug render is gone).
  8. `audit-log.tsx` renders pills via `FILTER_OPTIONS.map(...)`.
**Why:** SPEC §10. Enforces I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE.
**Lines:** 175.

### `.github/workflows/strict-grep-mingla-business.yml` (edit)

**What it did before:** Registered orch-0788, orch-0793, orch-0795, orch-0796 jobs (plus all the older I-PROPOSED-* gates).
**What it does now:** Adds `orch-0806-audit-action-labels` job below `orch-0796-no-stub-payout-fee`, naming I-PROPOSED-BD.
**Why:** SPEC §10 — one script, one job, registry pattern.
**Lines:** +11.

---

## 5. Spec traceability (per success criterion)

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| L-01 | Every 28 emitted slug renders non-monospace plain-English title | Jest T-01..T-07 (35/35 PASS); strict-grep Check 7 negative grep confirms `styles.rowAction` is removed | ✅ PASS |
| L-02 | Unknown slug renders humanized title + `other` category + raw in detail | Jest test `T-06 unknown slug humanizes...` PASS | ✅ PASS |
| L-03 | Dynamic patterns resolve | Jest tests for deadline N=7 / N=1 / N=3, refund pending / failed / reconciled / orphan, generic stripe_connect.* — all PASS | ✅ PASS |
| P-01 | First 25 rows load in < 800ms on busy brand | Index on `audit_log(brand_id, created_at desc)` is the existing query path; no schema change. Runtime perf is hardware-dependent — UNVERIFIED on device | ⚠️ UNVERIFIED (no device runtime probe) |
| P-02 | "Load more" appends without re-fetching first page | `useInfiniteQuery` semantics + cursor=`created_at` + `lt(created_at, pageParam)` on subsequent pages; React Query caches per-page | ✅ PASS (architectural) |
| P-03 | `hasMore` flips false after last page | `isLast` = `fetched.length < PAGE_SIZE`; `getNextPageParam` returns `null` on isLast; UI hides button when `hasMore === false` | ✅ PASS |
| F-01 | Category pill filters list | Client-side `flatRows.filter(r => resolveAuditActionLabel(r.action).category === filter)` in `useAuditLog` | ✅ PASS |
| F-02 | "All" restores full list | When `filter === "all"`, no `.filter()` applied; returns `flatRows` | ✅ PASS |
| F-03 | Switching filter does NOT reset cursor of OTHER filter views | Query key includes filter: `["audit-log", brandId, filter]` — each filter has its own infinite-query cache | ✅ PASS |
| A-01 | Filter pills + Load more have accessibility labels | `accessibilityLabel={\`Filter audit log by \${opt.label}\`}` on each pill; Button primitive provides accessibilityRole | ✅ PASS |
| A-02 | Banner copy reads "You see audit events tied to your account on this brand." | Verified in `audit-log.tsx:bannerText` literal | ✅ PASS |
| R-01 | tsc --noEmit clean | `npx tsc --noEmit` from `mingla-business/` → EXIT 0 | ✅ PASS |
| R-02 | Jest unit tests for resolver pass | 35/35 PASS | ✅ PASS |
| R-03 | Strict-grep gate passes locally | `node .github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` → PASS 8/8 (known=18, emitted-static=16) | ✅ PASS |

13/14 PASS, 1 UNVERIFIED (P-01 runtime perf — needs device smoke).

---

## 6. Invariant verification

### Preserved

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Constitution #2 (one owner per truth) | ✅ | React Query is the sole owner of audit_log cache; Zustand untouched |
| Constitution #3 (no silent failures) | ✅ | `isError` branch renders EmptyState; queryFn throws on Supabase error |
| Constitution #5 (server state server-side) | ✅ | No Zustand additions; `categoryFilter` is `useState` (component-local) |
| Constitution #9 (no fabricated data) | ✅ | Unknown slugs render raw form in detail field for debugging; no fake titles |
| I-PROPOSED-J (Zustand persist no server snapshots) | ✅ | No persist changes |

### New invariant promoted DRAFT

- **I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE** — every distinct `action` string emitted by `writeAudit` MUST resolve to a non-`other` category in `resolveAuditActionLabel`. CI gate (Check 3 of orch-0806-audit-action-labels.mjs) enforces. Promotion: DRAFT now → ACTIVE on ORCH-0806 CLOSE.

> Note: SPEC originally proposed `I-PROPOSED-BC` but that letter was already taken by ORCH-0796 (`I-PROPOSED-BC` STRIPE-PAYOUT-DERIVED-FROM-APP-FEE). Bumped to BD during implementation. Carried through to the workflow job name and strict-grep gate comment.

---

## 7. Parity check

- Solo / collab parity: N/A — brand audit log is a single-user view; no collab equivalent.
- Mobile / admin / business parity: ORCH-0806 is scoped to `mingla-business` only. The audit log surface does not exist in `mingla-admin` or `app-mobile`.
- iOS / Android parity: pure RN — no platform-conditional code. Behavior is identical.

---

## 8. Cache safety

- Query key changed from `["audit-log", brandId]` to `["audit-log", brandId, filter]`. Any existing cached entry under the old key will be ignored (effectively invalidated on first render). No cross-version persistence concerns (audit log was never persisted to AsyncStorage).
- No mutations introduced; no `invalidateQueries` calls.
- React Query stale time unchanged (60s).

---

## 9. Regression surface

The tester should smoke these adjacent surfaces:

1. **The audit-log screen at low data** — fewer than 25 rows (Load more should not render).
2. **The audit-log screen at exactly 25 rows** — Load more renders; tapping it fetches second page with 0 rows; Load more disappears.
3. **The audit-log screen with `isError`** — disconnect network mid-load; verify EmptyState renders.
4. **Brand member (rank < 50) opening audit log** — should still see "Insufficient permissions" empty state. The rank gate runs before the new filter pill logic so it must not have moved.
5. **Filter category with zero rows** — selecting "Legal" on a brand with no ToS event should render "No events match this filter" + "Try a different category or 'All'."
6. **Filter then Load more** — load 25 rows, switch filter, observe filter-scoped subset; switch back to "All" — full 25 still there (per-filter cache isolation).

---

## 10. Constitutional compliance

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | ✅ Every pill responds; Load more button disables while fetching |
| 2 | One owner per truth | ✅ |
| 3 | No silent failures | ✅ queryFn throws; UI renders EmptyState |
| 4 | One query key per entity | ✅ Factory pattern preserved with filter dimension added |
| 5 | Server state server-side | ✅ React Query owns rows; filter state is component-local |
| 6 | Logout clears everything | ✅ No new persist; React Query cache cleared by existing logout flow |
| 7 | Label temporary fixes | ✅ TRANSITIONAL comment about admin-can-read-all retained in hook docblock; honest banner copy renders the same truth |
| 8 | Subtract before adding | ✅ Removed `styles.rowAction` + 3 other dead styles before adding new render path |
| 9 | No fabricated data | ✅ |
| 10 | Currency-aware | N/A — no currency in audit log |
| 11 | One auth instance | ✅ |
| 12 | Validate at right time | N/A — read-only screen |
| 13 | Exclusion consistency | ✅ |
| 14 | Persisted-state startup | ✅ No new persist |

---

## 11. Discoveries for orchestrator

- **`ops.webhook_silence_check_fired` still pollutes the user-facing audit log.** The resolver categorises it as `ops` so users at least see a clean label, but the underlying decision to route ops health-check events to the same `audit_log` table as user-relevant events remains an architectural smell. F-05 already flagged this; recommend ORCH-0806-A or a new follow-up to move `ops.*` to a separate `system_audit_log` table.
- **No infrastructure for actor-name resolution.** SPEC §2 deferred this. If operator wants real actor names after retest, queue ORCH-0806-B: join `users` / `brand_team_members` to render display names instead of `User …a1b2c3`.
- **PAGE_SIZE = 25 is a magic number** — exposed as a module-local const at the top of `useAuditLog.ts`. If audit logs grow heavy enough that 25 feels too small or large, easy to tune.
- **Query key cardinality** — each filter has its own cache slot. 7 filters × N brands = potential cache size growth. Not a problem at current scale; flag if memory pressure surfaces later.

---

## 12. Test plan for tester

Per default routing → Claude `mingla-forensics` (TEST mode) TARGETED sub-mode:

- Re-run jest: `cd mingla-business && npx jest auditActionLabels --no-coverage` → expect 35/35 PASS.
- Re-run tsc: `cd mingla-business && npx tsc --noEmit` → expect EXIT 0.
- Run strict-grep gate: `node .github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` → expect "PASS 8/8".
- Run negative control: temporarily delete an entry from `KNOWN_STATIC_SLUGS` (e.g. `mingla_tos_accept`); re-run gate; expect Check 3 FAIL naming that slug; restore.
- Read each of the 6 regression-surface scenarios in §9 and confirm against the code.
- UI smoke: render audit-log screen on a brand with mixed slug history (if available via Supabase MCP probe), verify pills, Load more, empty filter state.
- Constitution scan: re-verify §10 entries by reading the modified files.

---

## 13. Transition items

None new. The hook's existing `[TRANSITIONAL] RLS self-only` docblock (cycle 13a) is preserved unchanged — exit condition remains "Brand-admin-can-read-all is queued for B-cycle." ORCH-0806 did not advance that exit condition.

---

## 14. Working-branch discipline confirmation

- All edits on `/Users/sethogieva/Desktop/mingla-main` branch `Seth`. ✅
- Operator owns `supabase db push` — no migrations written. ✅
- No edge function deploys initiated. ✅
- No `mcp__supabase__apply_migration` call. ✅
- Monotonic migration filenames N/A (no new migration). ✅

---

## 15. Migrations awaiting `supabase db push`

None.

---

**End of implementation report.**
