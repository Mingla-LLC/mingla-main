# SPEC — ORCH-0806: Audit Log Human-Readable Labels + Pagination + Filter

**Skill:** Claude `mingla-forensics` (SPEC mode, IA continuation of ORCH-0801)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** [INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md](../reports/INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md) §F-05
**Operator decisions:** Q7 — preserve detail (~25-30 labels)

---

## 1. Scope

ORCH-0806 transforms the brand audit log from a raw-slug developer dump into a usable compliance + admin surface. Three deliverables, one commit:

1. **Slug → label resolver** (`auditActionToLabel`) covering every emitted slug (28 discovered + a stable fallback for unknown future slugs).
2. **Pagination** — replace the hardcoded `limit(100)` with an offset-based "Load more" pager.
3. **Filter** — single-select category dropdown ("All", "Stripe Connect", "Payouts & Refunds", "Orders", "Legal", "Ops") above the list.

## 2. Non-goals

- **Actor name resolution.** Audit log currently shows last-6-of-UUID for the actor. Joining `users`/`brand_team_members` to resolve display names is out of scope; bump to ORCH-0806-A follow-up if operator wants it after retest.
- **Absolute-timestamp on hover/long-press.** Keep relative-time rendering as-is; tooltip is a separate UX polish.
- **RLS admin-can-read-all change.** Current self-only RLS stays; the banner mismatch is a separate ORCH if operator wants it now.
- **Schema changes.** Zero migrations. `audit_log` schema is sufficient.
- **Export.** No CSV export of audit log in this pass.
- **Real-time updates.** No Supabase Realtime subscription; React Query refetch on focus is sufficient.

## 3. Assumptions

- The 28 emitted slugs inventoried in F-05 are the complete set as of 2026-05-12. New emitters MUST add to the label map in the same commit (enforced by strict-grep gate; see §10).
- React Query is the canonical server-state owner; Zustand is untouched.
- `currentBrandStore` v14 is unchanged (no persist additions).

---

## 4. Database layer

**No changes.** `audit_log` schema (per `20260513000002_b2a_v3_audit_log_target_id_text.sql`) is sufficient: `id`, `user_id`, `brand_id`, `event_id`, `action text`, `target_type`, `target_id text`, `before jsonb`, `after jsonb`, `created_at`. RLS unchanged.

---

## 5. Edge function layer

**No changes.** All 11 emitters (`brand-stripe-onboard`, `brand-stripe-detach`, `brand-stripe-balances`, `brand-stripe-refresh-status`, `_shared/stripeWebhookRouter.ts`, `stripe-webhook/index.ts`, `cancel-order`, `refund-order`, `brand-mingla-tos-accept`, `stripe-kyc-stall-reminder`, `stripe-webhook-health-check`) keep their existing slug emissions. The label map is read-side only.

---

## 6. Service / hook layer

### 6.1 New file: `mingla-business/src/utils/auditActionLabels.ts`

Pure function module. No React, no Supabase, no I/O.

```typescript
export type AuditCategory =
  | "stripe_connect"
  | "payouts_refunds"
  | "orders"
  | "legal"
  | "ops"
  | "other";

export interface AuditActionLabel {
  title: string;        // "Disconnected Stripe account"
  detail?: string;      // Optional explainer line, e.g. "Stripe rejected the detach request — local state cleared"
  category: AuditCategory;
  iconHint: "stripe" | "money" | "ticket" | "shield" | "wrench" | "info";
}

export const resolveAuditActionLabel = (action: string): AuditActionLabel => {
  // Exact-match static slugs first (cheaper + safer).
  // Then pattern-match dynamic slugs.
  // Fallback returns { title: humanizeSlug(action), category: "other", iconHint: "info" }
};

// Exposed for tests + filter component.
export const AUDIT_CATEGORIES: readonly { id: AuditCategory; label: string }[] = [
  { id: "stripe_connect", label: "Stripe Connect" },
  { id: "payouts_refunds", label: "Payouts & refunds" },
  { id: "orders", label: "Orders" },
  { id: "legal", label: "Legal" },
  { id: "ops", label: "Ops" },
  { id: "other", label: "Other" },
];
```

### 6.2 Label inventory (28 entries — preserve detail per Q7)

**Stripe Connect lifecycle (category: `stripe_connect`):**

| Slug | Title | Detail | Icon |
|------|-------|--------|------|
| `stripe_connect.onboard_initiated` | "Started Stripe onboarding" | — | stripe |
| `stripe_connect.reactivated` | "Reconnected Stripe account" | "A previously detached account was re-enabled" | stripe |
| `stripe_connect.country_change_locked` | "Country change blocked" | "Stripe account already has activity — country is now locked" | shield |
| `stripe_connect.country_change_replaced_before_completion` | "Replaced Stripe account during onboarding" | "Old account discarded; a fresh account was created for the new country" | stripe |
| `stripe_connect.detach_completed` | "Disconnected Stripe account" | — | stripe |
| `stripe_connect.detach_local_success_stripe_rejected` | "Disconnected locally — Stripe rejected" | "Local state cleared; Stripe still holds the account record" | shield |
| `stripe_connect.status_refreshed` | "Refreshed Stripe status" | — | stripe |
| `stripe_connect.account_updated` | "Stripe account updated" | "Stripe sent an account.updated webhook" | stripe |
| `stripe_connect.account_deauthorized` | "Stripe revoked access" | "Stripe deauthorized the Mingla platform on this account" | shield |
| `stripe_connect.kyc_stall_reminder_sent` | "KYC reminder sent" | "Stripe verification is overdue — reminder email dispatched" | stripe |
| `stripe_connect.deadline_warning_*_sent` (pattern) | "KYC deadline reminder sent" | "Verification deadline is N day(s) away" (N from slug) | stripe |
| `stripe_connect.capability.updated` (pattern fallback) | "Stripe capability updated" | (echo the Stripe event subtype) | stripe |
| `stripe_connect.*` (catch-all) | "Stripe Connect: <humanized event>" | — | stripe |

**Balances / payouts / refunds (category: `payouts_refunds`):**

| Slug | Title | Detail | Icon |
|------|-------|--------|------|
| `stripe_connect.balance_retrieved` | "Checked Stripe balance" | — | money |
| `stripe_connect.detached_refund_updated` | "Refund processed on disconnected account" | — | money |
| `stripe.charge.refunded.reconciled` / `stripe.*.reconciled` (pattern) | "Refund matched to order" | — | money |
| `stripe.*.{status}` (pattern, status ∈ pending/canceled/failed/succeeded) | "Refund {status}" (capitalised) | — | money |
| `stripe.*.orphan` (pattern) | "Orphan refund recorded" | "Refund arrived from Stripe with no matching Mingla order" | money |

**Order lifecycle (category: `orders`):**

| Slug | Title | Detail | Icon |
|------|-------|--------|------|
| `order_cancelled` | "Order cancelled" | — | ticket |
| `order_refund_issued` | "Refund issued" | — | money |

**Legal (category: `legal`):**

| Slug | Title | Detail | Icon |
|------|-------|--------|------|
| `mingla_tos_accept` | "Accepted Mingla terms" | — | shield |

**Ops (category: `ops`):**

| Slug | Title | Detail | Icon |
|------|-------|--------|------|
| `stripe_connect.webhook_ip_soft_fail` | "Webhook IP check failed (non-blocking)" | "Stripe webhook arrived from an unexpected IP — processed but flagged" | wrench |
| `stripe_connect.webhook_unhandled` | "Unhandled Stripe webhook" | (echo the event subtype) | wrench |
| `ops.webhook_silence_check_fired` | "Webhook health check fired" | "Liveness probe ran — no inbound webhooks in window" | wrench |

**Unknown fallback (category: `other`):**

- Title: humanized slug (split on `.` / `_`, capitalize first segment); detail: original raw slug rendered in monospace (for debugging).

### 6.3 Extend `useAuditLog` hook

File: `mingla-business/src/hooks/useAuditLog.ts`

Changes:

- Add `pageSize` constant: `const PAGE_SIZE = 25;` (replaces `ROW_LIMIT = 100`).
- Switch from `useQuery` to `useInfiniteQuery` with cursor = `created_at`.
- Add `categoryFilter?: AuditCategory | "all"` parameter.
- Apply category filter client-side via `resolveAuditActionLabel(row.action).category === filter` (server-side filter requires a category column; out of scope).
- Return shape:
  ```typescript
  export interface UseAuditLogState {
    rows: AuditLogRow[];      // already filtered + paginated
    isLoading: boolean;
    isError: boolean;
    hasMore: boolean;
    isFetchingMore: boolean;
    fetchMore: () => void;
  }
  ```
- Query key factory updated to include category in the key for cache isolation: `["audit-log", brandId, categoryFilter]`.

### 6.4 No new services

Direct Supabase query continues to live in the hook (existing pattern for this surface).

---

## 7. Component layer

File: `mingla-business/app/brand/[id]/audit-log.tsx` (237 lines → ~290)

### 7.1 New filter chip row

Above the list, render a horizontal scroll of category Pills (use existing `Pill` component from `src/components/ui/Pill.tsx`):

- Order: `All · Stripe Connect · Payouts & refunds · Orders · Legal · Ops · Other`
- Selected pill uses `variant="accent"`; unselected uses `variant="muted"` (or whatever the existing variants are — implementor verifies).
- Tap updates local `useState<AuditCategory | "all">("all")` → passes to `useAuditLog(brandId, categoryFilter)`.
- Accessibility: `accessibilityRole="button"`, `accessibilityLabel={`Filter audit log by ${label}`}`, `accessibilityState={{ selected: isActive }}`.

### 7.2 Row rendering changes

Replace existing line 157 monospace slug render with:

```jsx
<View style={styles.rowText}>
  <Text style={styles.rowTitle}>{label.title}</Text>
  {label.detail !== undefined ? (
    <Text style={styles.rowDetail}>{label.detail}</Text>
  ) : null}
  <Text style={styles.rowMeta}>
    {r.relativeTime} · {r.actorLabel}
  </Text>
</View>
```

Where `label = resolveAuditActionLabel(r.action)`. The existing styles.rowAction (monospace) is removed. Icon column on the left uses `Icon` component with name derived from `label.iconHint` (map: `stripe`→`creditCard`, `money`→`dollarSign`, `ticket`→`ticket`, `shield`→`shield`, `wrench`→`wrench`, `info`→`info`; verify icon names available in existing icon set, fall back to `info`).

### 7.3 Pagination

Below the rows, render a `Button` labelled `"Load more"` when `hasMore === true`. While `isFetchingMore`, show an inline spinner inside the button or use `loading` prop if Button supports it.

When `rows.length === 0 && !isLoading && !isError`, render existing empty state (`useAuditLog` already returns `rows: []` cleanly — keep current empty card).

### 7.4 Banner copy correction

The current banner (lines 125-130 per F-05) says "Brand admins see all team actions; team members see their own." This is misleading because RLS is self-only for everyone. Replace with: `"You see audit events tied to your account on this brand."` Honest and category-agnostic. (This is bundled here because it's a one-line copy fix in the same file; it does not expand scope.)

---

## 8. Success criteria

1. **L-01** — Every one of the 28 emitted slugs from F-05 renders a non-monospace, plain-English title via `resolveAuditActionLabel`. Verified by unit test reading the inventory list.
2. **L-02** — Unknown future slug renders `humanized title` + `category: "other"` + does NOT crash or render raw slug as title (raw slug appears in detail field only, for debugging).
3. **L-03** — Dynamic patterns (`stripe_connect.deadline_warning_*_sent`, `stripe.*.{status}`, `stripe.*.orphan`, `stripe.*.reconciled`, `stripe_connect.{event.type}`) resolve correctly; unit tests cover representative samples (`stripe_connect.deadline_warning_7d_sent`, `stripe.charge.refund.updated.pending`, etc.).
4. **P-01** — Audit log loads first 25 rows in under 800ms on a brand with ≥100 events (existing index on `audit_log(brand_id, created_at desc)` suffices; verify with `EXPLAIN ANALYZE` in implementor's report).
5. **P-02** — "Load more" appends the next 25 rows without re-fetching the first page; React Query `useInfiniteQuery` caches by cursor.
6. **P-03** — `hasMore` flips to `false` after the last page; "Load more" button disappears.
7. **F-01** — Selecting a category pill filters the rendered list to events of that category only.
8. **F-02** — Selecting "All" restores the full list.
9. **F-03** — Switching filter does NOT reset the pagination cursor of OTHER filter views (each filter has its own infinite-query key).
10. **A-01** — All filter pills + Load more button have `accessibilityLabel` and `accessibilityRole`.
11. **A-02** — Banner copy reads "You see audit events tied to your account on this brand."
12. **R-01** — `tsc --noEmit` clean from `mingla-business/`.
13. **R-02** — Jest unit tests for `auditActionLabels.ts` pass (≥30 cases covering all 28 static slugs + 5 dynamic patterns + unknown fallback).
14. **R-03** — Strict-grep CI gate `orch-0806-audit-action-labels` (see §10) PASSES locally.

---

## 9. Invariants

### Preserved

- **Constitution #2** (one owner per truth) — `audit_log` continues to be the single source of truth; React Query owns the cache; Zustand untouched.
- **Constitution #3** (no silent failures) — `isError` branch renders error card with retry (existing behavior); new "Load more" failures render inline retry within the button.
- **Constitution #5** (server state server-side) — no Zustand additions; category filter is component-local `useState`.
- **Constitution #9** (no fabricated data) — unknown slugs render their raw form in the detail field for debugging; no fake titles.

### New invariant promoted

- **I-PROPOSED-BC AUDIT_LOG_HUMAN_READABLE** — every distinct `action` string emitted by `writeAudit` MUST resolve to a non-`other` category in `resolveAuditActionLabel` for the audit log to count as compliant. CI gate enforces by grepping emitters and asserting every static slug has a matching entry in `auditActionLabels.ts`. Promotion: DRAFT now → ACTIVE on ORCH-0806 CLOSE.

---

## 10. Strict-grep CI gate

New file: `.github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` (mirror pattern from `orch-0795-event-scanner-auto-provision.mjs`).

Registered as a new job in `.github/workflows/strict-grep-mingla-business.yml` under `orch-0806-audit-action-labels`. **One script + one job** per the registry pattern from memory.

### Checks (8 total)

1. `auditActionLabels.ts` exists at `mingla-business/src/utils/auditActionLabels.ts`.
2. Exports `resolveAuditActionLabel` + `AUDIT_CATEGORIES` symbols.
3. Every static slug emitted by `writeAudit(..., "<slug>", ...)` across `supabase/functions/**/*.ts` has a corresponding case in the resolver. Implementation: grep all writeAudit call sites, extract the action literal, intersect against the resolver's known-slug list (literal table at top of resolver file). Fail on any unmapped slug.
4. `useAuditLog.ts` uses `useInfiniteQuery` (grep for the symbol).
5. `useAuditLog.ts` accepts `categoryFilter` parameter (grep for the parameter name).
6. `audit-log.tsx` imports `resolveAuditActionLabel` (grep).
7. `audit-log.tsx` does NOT render the raw action slug as the primary title (negative grep: `<Text[^>]*style={styles.rowAction}>{r.action}</Text>` MUST NOT match).
8. `audit-log.tsx` renders the category filter pills (grep for `AUDIT_CATEGORIES.map`).

Each check has a clear failure message naming the missing piece.

---

## 11. Test cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | Static slug resolves | `"order_cancelled"` | `{ title: "Order cancelled", category: "orders", iconHint: "ticket" }` | Unit (resolver) |
| T-02 | Dynamic deadline N=7 | `"stripe_connect.deadline_warning_7d_sent"` | title `"KYC deadline reminder sent"`, detail `"Verification deadline is 7 days away"` | Unit |
| T-03 | Dynamic deadline N=1 | `"stripe_connect.deadline_warning_1d_sent"` | detail uses singular `"1 day"` (test verifies pluralisation) | Unit |
| T-04 | Dynamic refund status | `"stripe.charge.refund.updated.pending"` | title `"Refund Pending"`, category `"payouts_refunds"` | Unit |
| T-05 | Dynamic refund reconciled | `"stripe.charge.refund.updated.reconciled"` | title `"Refund matched to order"` | Unit |
| T-06 | Unknown slug | `"some.future.slug"` | title `"Some future slug"`, category `"other"`, detail is raw `"some.future.slug"` | Unit |
| T-07 | All 28 static slugs covered | iterate the F-05 inventory | every slug returns category ≠ `"other"` | Unit (data-driven) |
| T-08 | Load more appends | mock 30-row brand | first page 25 rows; tap "Load more" → 30 rows total; hasMore=false | Hook (RTL renderHook) |
| T-09 | Filter by category | mock mixed-category brand | select "Orders" → only order_* rows render | Component (RTL) |
| T-10 | Empty after filter | mock brand with 0 orders | filter "Orders" → empty card "No events match this filter" | Component |
| T-11 | Banner copy correction | render screen | banner text matches "You see audit events tied to your account on this brand." | Component snapshot |
| T-12 | Accessibility | render filter pills | each pill has `accessibilityLabel` + `accessibilityState.selected` | Component |
| T-13 | tsc | repo-wide | exit 0 | CI |
| T-14 | Strict-grep | `node .github/scripts/strict-grep/orch-0806-audit-action-labels.mjs` | exit 0; all 8 checks PASS | CI |
| T-15 | Negative control — strict-grep | temporarily remove `order_cancelled` from resolver | strict-grep Check 3 FAILS with specific slug name | CI (manual smoke) |

---

## 12. Implementation order

1. Create `mingla-business/src/utils/auditActionLabels.ts` with the full resolver + AUDIT_CATEGORIES + label inventory.
2. Write jest tests in `mingla-business/src/utils/__tests__/auditActionLabels.test.ts` (T-01 through T-07).
3. Extend `useAuditLog.ts` with `useInfiniteQuery` + `categoryFilter` parameter.
4. Update `audit-log.tsx`: filter pill row, row rendering, Load more button, banner copy correction.
5. Create strict-grep gate script + register job in workflow.
6. Run `npx tsc --noEmit` from `mingla-business/`.
7. Run `npm test -- auditActionLabels` from `mingla-business/`.
8. Run strict-grep gate locally + verify negative control (T-15).
9. Write implementation report.

---

## 13. Regression prevention

- **Class of bug being fixed:** UI surface renders backend identifiers verbatim. Pattern broader than audit log — applies to any future admin screen.
- **Structural safeguard:** label-map utility pattern + strict-grep gate. Every new `writeAudit` slug fails CI until added to the resolver. The same pattern can be extended later to event types, notification template keys, etc.
- **Test catching regression:** T-07 (data-driven coverage of every emitted slug) + T-15 (negative control proves the strict-grep gate fires).
- **Protective comment:** Top of `auditActionLabels.ts` carries a comment explaining the invariant + how to add a new slug + cross-reference to ORCH-0806 + I-PROPOSED-BC.

---

## 14. Hard guards for implementor

- **Stay in scope.** Three files new/edited (`auditActionLabels.ts` + test, `useAuditLog.ts`, `audit-log.tsx`) plus the strict-grep script + workflow edit. No other product code modifications.
- **No schema changes.** Zero migrations.
- **No edge function deploys.** The slug emitters stay untouched.
- **No `supabase db push`.** N/A.
- **No actor-name resolution.** Out of scope (see §2 non-goals); if tempted, defer to ORCH-0806-A.
- **No Zustand additions.** Category filter is component-local state only.
- **No new edge function calls or external API integrations.**
- **Use existing UI primitives.** `Pill`, `Button`, `Icon` from `src/components/ui/` — do not create new components.
- **Preserve the `[TRANSITIONAL] RLS self-only` comment** in `useAuditLog.ts` lines 5-6; the admin-can-read-all change is a separate ORCH.

---

## 15. Expected implementation output

**File:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0806_AUDIT_LOG_HUMAN_READABLE.md`

Sections: scope confirmation; file diff summary (old→new line counts + paths); per-criterion (L-01 through R-03) verification with file:line + test name; jest output; tsc output; strict-grep output (with negative-control smoke verification); known limitations; downstream test handoff note.

---

**End of SPEC.**
