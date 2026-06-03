# ORCH-1062 — Brand delete "maximum depth exceeded" + account-list event-count lie

**Status:** INVESTIGATE + IMPLEMENT + on-device VERIFY complete.
**Affected Surfaces:** business-iOS, business-Android (`mingla-business/` native; the
account/switcher/brand-profile delete flow + the account brand-list badge). NOT in scope:
consumer apps, buyer-web, admin-web (no business brand-delete/account-list there).
**Owner:** Claude `mingla-orchestrator` (drove audit → fix → sim verify).

---

## Bug 1 — "Maximum update depth exceeded" when deleting a brand (sometimes silent)

### Root cause (PROVEN on iOS sim, not source-only)
Reproduced on iPhone 17 Pro (iOS 26.4), business dev build, logged in as
sethogieva@gmail.com. Deleting the **currently-selected** brand red-boxes with
`Maximum update depth exceeded` — React's infinite-setState-in-render guard. The
red box named the exact frames: `useCurrentBrandRecovery.ts:73` (`setErrorMessage(null)`)
and `_layout.tsx:105` (`useBrand(currentBrandId)`), component stack `<RootLayoutInner />`.

It is a **two-writer race on stale React Query cache**:

1. `useSoftDeleteBrand.onSuccess` only **invalidated** `brandKeys.list` — React Query keeps
   serving the **stale** list (still containing the just-deleted brand) during the
   background refetch, and `creator_accounts.default_brand_id` cache still points at it.
2. `useCurrentBrand` (`useCurrentBrand.ts:44-45`) sees its detail fetch return `null`
   (the brand is gone) → `setCurrentBrandId(null)`.
3. `useCurrentBrandRecovery` (`useCurrentBrandRecovery.ts:59-101`) sees `currentBrandId === null`
   + the **stale** list / **stale** default still containing the deleted brand →
   `resolveCurrentBrandId` returns the **just-deleted brand** → `setCurrentBrandId(deleted)`.
4. → back to step 2 → synchronous ping-pong between `null` and the deleted id, past React's
   ~50 nested-update cap → crash.

This is why it "sometimes fails silently": deleting a **non-current** brand never trips the
race (currentBrandId stays valid → resolver returns `keep-local` → no loop).

### Ruled out (with evidence)
- **Postgres recursion / "stack depth limit exceeded":** FALSE. The soft-delete is an
  `UPDATE brands SET deleted_at` (never the DELETE policy or `ON DELETE CASCADE`). DB probes:
  **zero triggers** in the entire `public` schema; the brands/team RLS helper functions
  (`biz_is_brand_admin_plus_for_caller`, `biz_brand_effective_rank`, …) are all
  `SECURITY DEFINER` owned by `postgres` (`rolbypassrls = true`) → they bypass RLS and
  cannot recurse. Postgres logs show no stack-depth error. The Explore agent's
  "CASCADE → RLS recursion" theory was falsified.

### Fix (root cause)
`mingla-business/src/hooks/useBrands.ts` — `useSoftDeleteBrand.onSuccess` now
**synchronously evicts** the deleted brand from the list cache and clears a stale
`default_brand_id` pointer BEFORE the invalidate backstop, so the resolver immediately
sees fresh data and lands on a valid brand:

```ts
queryClient.setQueryData<Brand[]>(brandKeys.list(accountId), (prev) =>
  prev !== undefined ? prev.filter((b) => b.id !== brandId) : prev);
queryClient.setQueryData<CreatorAccountRow | null>(creatorAccountKeys.byId(accountId),
  (prev) => (prev != null && prev.default_brand_id === brandId
    ? { ...prev, default_brand_id: null } : prev));
// invalidate stays as a server-truth backstop
```

### On-device verification
After the fix, deleting the **current** brand ("rrrr") completes cleanly: NO red box,
the app auto-recovers the current brand to a valid one ("Lantern & Vine"), Metro log shows
zero errors. Re-tested the exact crash path.

---

## Bug 2 — Account brand list "lies": shows events when the hub is empty

### Root cause (PROVEN with live data)
`brandsService.ts` `getEventCountsByBrandIds` counted **all** non-deleted events
(`deleted_at IS NULL` only) — including **drafts**. The hub events list
(`businessEvents.ts` → `business_management_events_view`) only surfaces
`status IN ('scheduled','live','ended','cancelled')`. So a brand with only draft events
showed "N events" on the account card while its hub was empty.

Live data for sethogieva@gmail.com confirmed it: "rrrr" old badge **2** vs hub **0**
(both drafts); "Lumen Wine Bar" **2** vs **0**; "A gloat" **1** vs **0**; "Travel Brand"
**32** vs **2** (30 drafts).

### Fix
`getEventCountsByBrandIds` now applies the hub's exact status filter
(`.in("status", HUB_VISIBLE_EVENT_STATUSES)` where
`HUB_VISIBLE_EVENT_STATUSES = ['scheduled','live','ended','cancelled']`) alongside
`deleted_at IS NULL`. Stays type-agnostic (no `event_type` filter — the ORCH-0859
events-vs-trips badge question is untouched). Verified live: every brand's badge now equals
its true hub-visible count. Confirmed on the sim — "rrrr" and "Lumen Wine Bar" now show
"0 events".

---

## Regression tests
- `src/hooks/__tests__/useSoftDeleteBrand.orch1062.test.ts` — impl happy-path: onSuccess
  evicts the deleted brand from the list cache + clears the matching default pointer.
- `src/hooks/__tests__/useSoftDeleteBrand.orch1062.adversarial.test.ts` — tester adversarial:
  rejected-delete leaves cache untouched; non-matching default preserved; absent-brand no-op.
- `src/services/__tests__/brandsService.orch1062.eventCount.test.ts` — count fix: events
  count query filters to hub-visible statuses (excludes drafts).
All fail-on-revert by exercising the changed behavior.

## Live data action (operator-requested, "junk + dupes only")
Deleted via the app UI on the sim (sethogieva@gmail.com): the empty + duplicate test brands
(checking, rrrr, A gloat, Lumen Wine Bar, Fine Dining Raleigh, QA SubB Event 1456g,
Sub-E Smoke Test, Perry's Steakhouse & Grille ×2, The Tuscanny Place, The Tuscany And Co).
KEPT brands with live/paid events (Leggo This, Travel Brand, Lantern & Vine, testtttt) so
real events are not yanked from the consumer/marketing decks.
