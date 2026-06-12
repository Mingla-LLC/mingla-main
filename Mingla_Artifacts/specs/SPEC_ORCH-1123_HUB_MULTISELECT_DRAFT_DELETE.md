# SPEC — ORCH-1123 [Hub multi-select draft delete]

**Mode:** mingla-forensics SPEC (binding build contract)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1123-[hub-multiselect-draft-delete]` (branch `ORCH-1123-hub-multiselect-draft-delete`)
**Date:** 2026-06-11
**Investigation read:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md` (all five truth layers + the 8 open questions)
**COMMS_LEDGER:** read on entry — no BLOCK/WARN row targets ORCH-1123 or mingla-forensics. No new cross-ORCH discovery requiring a ledger write.
**Scope guard:** DRAFTS-ONLY bulk delete across the 3 business-app Hub tabs (events, trips, experiences). NOT a redesign of any tab, NOT a new filter system, NOT a refactor of the 3 existing single-delete paths.

---

## 0. Decisions on the 8 Open Questions (binding)

| # | Open question | DECISION |
|---|---|---|
| Q1 | Selection mechanics: per-tab state vs shared hook? | **Shared `useDraftMultiSelect` hook + shared `<DraftSelectBar>` sticky-bar component + shared `<DraftSelectCheckbox>` overlay.** One owner for selection mechanics + delete dispatch. Each tab keeps its own row card + data-source adapter. (§3.3, §3.4) |
| Q2 | Experiences with no Drafts filter / category-gated shell? | **No new filter pills, no tab redesign.** Long-press is enabled ONLY on rows where `exp.status === "draft"` (selection mode then auto-filters the visible selectable set to drafts). The experiences list only exists inside `ExperienceGenerationSurface` (restaurant/play); multi-select mounts there only. `creative_and_arts`/default shells show no list today → out of scope, untouched. (§3.7.3, §6) |
| Q3 | Batch RPC result shape: all-or-nothing vs per-row? | **Per-row outcome array (SKIP-and-report, NOT all-or-nothing).** RPC returns `jsonb[]`-style rows `{event_id, outcome}` where outcome ∈ `deleted | skipped_not_draft | skipped_not_found | forbidden`. The whole batch never aborts on one bad row. This is the only shape that satisfies no-silent-failure ("Deleted 4, 1 couldn't be deleted"). Justification in §2.3. |
| Q4 | Mixed local+server events selection? | **Split confirmed.** Partition selected ids: local-only (`id.startsWith("d_") \|\| serverSlug === null`) → Zustand `deleteDraft(id)` only; server-backed → batch RPC + Zustand `deleteDraft(id)` + RQ cache ops. One confirm dialog, one combined toast. (§3.6, §3.8) |
| Q5 | Counts invalidation? | **Yes.** After any successful events/trips/experiences batch, invalidate `brandKeys.offeringCounts(brandId)` so the universal empty-state + Hub To-Do counts don't go stale. (§3.8) |
| Q6 | Trip authz tightening in-scope? | **Yes — converge the BULK path only.** Trips bulk-delete goes through the rank-checked batch RPC (stricter than today's RLS-only client UPDATE). The trip SINGLE-delete path (`softDeleteTrip`/`useSoftDeleteTrip`) is UNTOUCHED. Behavior change noted + accepted in §2.4. |
| Q7 | Long-press the sole entry, or also an explicit "Select"? | **Long-press is the sole entry point** (Seth's locked decision). No overflow "Select" item added — stays in scope, avoids touching the 3 manage sheets. Discoverability handled by DESIGN via a one-time affordance hint (designer's call; §8). |
| Q8 | Confirm copy + count + dialog reuse? | **Reuse `ConfirmDialog` `destructive` + `variant="simple"`** exactly as events single-delete (events.tsx:705). Bar label `Delete (N)`; dialog title/desc/toast copy specified verbatim in §3.4 + §3.8. |

---

## 1. Affected Surfaces (restated) + Out-of-Scope

### In scope (files changed/created)
- **DB (1 new migration):** `business_discard_offering_drafts(p_event_ids uuid[])` batch RPC.
- **Shared client (3 new files):** `useDraftMultiSelect` hook, `useDiscardOfferingDrafts` mutation hook + service fn, `<DraftSelectBar>` + `<DraftSelectCheckbox>` components.
- **3 tab screens:** `app/(tabs)/hub/events.tsx`, `app/(tabs)/hub/trips.tsx`, `app/(tabs)/hub/experiences.tsx` — mount selection mode, wire long-press, render bar.
- **3 row cards:** `EventListCard.tsx`, `TripListCard.tsx`, `OfferingListCard.tsx` — add optional `onLongPress` + `selectionMode`/`selected` + checkbox overlay (additive, backward-compatible props).
- **1 service:** `mingla-business/src/services/offeringDrafts.ts` (new) — `discardOfferingDrafts(eventIds)`.

### Explicitly OUT of scope (do NOT do)
- ❌ Multi-select on Live / Upcoming / Past — drafts only. Those keep single-item flow.
- ❌ New filter pills / a "Drafts" filter on the experiences tab. (Long-press gated to draft rows instead.)
- ❌ Any list rendering for `creative_and_arts`/default experience-brand shells.
- ❌ Refactoring the 3 existing SINGLE-delete paths (events RPC wrapper, trips `softDeleteTrip`, experiences none). The single paths stay exactly as they are.
- ❌ Hard delete. Everything stays soft-delete (`deleted_at = now()`).
- ❌ An explicit overflow "Select" entry (Q7).
- ❌ Undo / trash / restore.
- ❌ Cross-tab multi-select (selection is per-tab, single-kind).
- ❌ Currency anything (N/A — no money in a delete).

---

## 2. Database — Batch RPC

### 2.1 New migration file
`supabase/migrations/20260927000000_orch_1123_batch_discard_offering_drafts.sql`
(version strictly `> 20260926000000`, the current latest on origin/main).

### 2.2 Exact SQL (full, idempotent)

```sql
-- ORCH-1123 [Hub multi-select draft delete] — batch draft-discard RPC.
-- Replicates business_discard_event_draft's guards PER ROW, event_type-agnostic
-- (works for event/trip/experience — all rows in public.events). SKIP-and-report:
-- the batch never aborts on a bad row; returns a per-row outcome so the client
-- can surface "Deleted N, M couldn't be deleted" (no silent failure).
-- Source single-row RPC: 20260515000006_orch_0763d_draft_discard_rpc.sql

CREATE OR REPLACE FUNCTION public.business_discard_offering_drafts(
  p_event_ids uuid[]
) RETURNS TABLE (
  event_id uuid,
  outcome  text   -- 'deleted' | 'skipped_not_draft' | 'skipped_not_found' | 'forbidden'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_id      uuid;
  v_event   public.events%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Empty / null input → empty result set (no error).
  IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- De-duplicate ids defensively; iterate each.
  FOR v_id IN SELECT DISTINCT unnest(p_event_ids)
  LOOP
    -- Lock the row (NOWAIT-free: a brand's own drafts are not hot rows).
    SELECT * INTO v_event FROM public.events WHERE id = v_id FOR UPDATE;

    IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
      event_id := v_id; outcome := 'skipped_not_found'; RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_event.status <> 'draft' THEN
      event_id := v_id; outcome := 'skipped_not_draft'; RETURN NEXT;
      CONTINUE;
    END IF;

    -- Per-row rank gate on THAT row's brand — event_manager+ (mirrors single RPC).
    IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
         < public.biz_role_rank('event_manager'::text) THEN
      event_id := v_id; outcome := 'forbidden'; RETURN NEXT;
      CONTINUE;
    END IF;

    -- Brand must exist + not be deleted (mirrors single RPC).
    PERFORM 1 FROM public.brands
      WHERE id = v_event.brand_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      event_id := v_id; outcome := 'forbidden'; RETURN NEXT;
      CONTINUE;
    END IF;

    -- Soft-delete. The status='draft' + deleted_at IS NULL guard makes a
    -- second call a no-op (idempotent) — it would fall through to NOT FOUND
    -- on re-run because deleted_at is then set.
    UPDATE public.events
      SET deleted_at = now(), updated_at = now()
      WHERE id = v_id AND status = 'draft' AND deleted_at IS NULL;

    IF FOUND THEN
      event_id := v_id; outcome := 'deleted'; RETURN NEXT;
    ELSE
      -- Lost a race (concurrently deleted/published between SELECT and UPDATE).
      event_id := v_id; outcome := 'skipped_not_found'; RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.business_discard_offering_drafts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_discard_offering_drafts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_discard_offering_drafts(uuid[]) TO authenticated, service_role;
```

**Migration-baseline CI gotchas honored (from memory):**
- Body terminator `$function$;` appears BEFORE the `GRANT`/`REVOKE` lines.
- `RETURNS TABLE` is brand-new (no widening of an existing return type) → no `DROP FUNCTION` needed; but if a re-run in a dirty env hits a signature conflict, prefer `DROP FUNCTION IF EXISTS public.business_discard_offering_drafts(uuid[]);` at the top (the implementor MAY add this guarded DROP if the apply errors — additive, safe). `CREATE OR REPLACE` is the default.
- Apply path: via Supabase Management API (MCP is read-only; CLI is drift-wedged) per memory's DB-write-paths reference, using the token in `~/.claude.json` + browser UA. Implementor applies during IMPLEMENT; tester re-probes live.

### 2.3 Justification — SKIP-and-report over all-or-nothing
All-or-nothing (one transaction, rollback on any non-deletable row) would silently discard the user's whole intent when even one stale row exists (e.g. a draft the brand just published from another device). That is a silent failure of the user's action and a confusing UX ("I tapped Delete 5, nothing happened"). SKIP-and-report deletes everything deletable and tells the user exactly what didn't go through. Each row's `UPDATE` is its own statement inside the function's implicit transaction; a `forbidden`/`skipped` row simply isn't updated. The constitution's no-silent-failure rule is satisfied by surfacing the per-row tally (§3.8).

### 2.4 Behavior change accepted (trips authz tightening — Q6)
Today trip-draft single-delete is an RLS-only client UPDATE (`softDeleteTrip`, no rank check). The batch RPC enforces `event_manager` rank server-side. This is **strictly stricter, never looser** — a sub-rank user who could previously bulk-nothing (no bulk existed) now gets `forbidden` per row, surfaced honestly. The trip SINGLE-delete path is unchanged, so no existing flow regresses. ACCEPTED.

### 2.5 Guards preserved per row (parity checklist with `business_discard_event_draft`)
auth-present ✔ · row-exists-and-not-already-deleted ✔ · `status='draft'` ✔ · `event_manager` rank on the row's brand ✔ · brand exists & not deleted ✔ · `FOR UPDATE` row lock ✔ · idempotent re-discard ✔ · `event_type`-agnostic (no `event_type` filter — same as source) ✔ · `SECURITY DEFINER` + `SET search_path` + REVOKE PUBLIC/anon + GRANT authenticated/service_role ✔.

---

## 3. Client

### 3.1 Service — `mingla-business/src/services/offeringDrafts.ts` (NEW)

```ts
import { supabase } from "./supabase";

export type DraftDiscardOutcome =
  | "deleted"
  | "skipped_not_draft"
  | "skipped_not_found"
  | "forbidden";

export interface DraftDiscardRow {
  eventId: string;
  outcome: DraftDiscardOutcome;
}

/**
 * Batch soft-delete draft offerings (event/trip/experience — one events table).
 * Server SKIPs-and-reports per row; never aborts the batch.
 * Returns the per-row outcome array.
 */
export async function discardOfferingDrafts(
  eventIds: string[],
): Promise<DraftDiscardRow[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase.rpc(
    "business_discard_offering_drafts",
    { p_event_ids: eventIds },
  );
  if (error !== null) throw error;
  const rows = (data ?? []) as Array<{ event_id: string; outcome: string }>;
  return rows.map((r) => ({
    eventId: r.event_id,
    outcome: r.outcome as DraftDiscardOutcome,
  }));
}
```

> Note: `supabase.rpc` is untyped in mingla-business (no generated `Database` type — verified). Match the existing `discardServerDraft` pattern in `eventDrafts.ts` (raw `supabase.rpc("name", {...})`). Do NOT add a generated-types step.

### 3.2 Mutation hook — `mingla-business/src/hooks/useDiscardOfferingDrafts.ts` (NEW)

A single React-Query mutation that (a) calls the batch RPC for server-backed ids, (b) applies kind-specific cache invalidation, and (c) returns the per-row tally for the caller to toast. It is **kind-aware** because the cache keys differ per tab, but it is ONE owner of the delete dispatch.

```ts
import { useMutation, useQueryClient, type UseMutationResult }
  from "@tanstack/react-query";

import { discardOfferingDrafts, type DraftDiscardRow }
  from "../services/offeringDrafts";
import { eventDraftKeys } from "./useServerDraftEvents";
import { tripKeys } from "./useTrips";
import { experienceKeys } from "./useExperiencesByBrand";
import { brandKeys } from "./useBrandOfferingCounts"; // export brandKeys if not already
import { useDraftEventStore } from "../store/draftEventStore";

export type OfferingKind = "event" | "trip" | "experience";

export interface DiscardOfferingDraftsInput {
  kind: OfferingKind;
  brandId: string;
  /** Server-backed draft ids to discard via the RPC. */
  serverEventIds: string[];
  /**
   * EVENTS ONLY: local-only draft ids (d_* / serverSlug===null) to delete
   * from the Zustand store WITHOUT calling the RPC. Empty for trips/experiences.
   */
  localOnlyDraftIds?: string[];
}

export interface DiscardOfferingDraftsResult {
  rows: DraftDiscardRow[];        // server outcomes
  localDeletedCount: number;      // events local-only deletions
}

export const useDiscardOfferingDrafts = (): UseMutationResult<
  DiscardOfferingDraftsResult,
  Error,
  DiscardOfferingDraftsInput
> => {
  const queryClient = useQueryClient();
  const deleteLocalDraft = useDraftEventStore((s) => s.deleteDraft);

  return useMutation<DiscardOfferingDraftsResult, Error, DiscardOfferingDraftsInput>({
    mutationFn: async ({ serverEventIds, localOnlyDraftIds }) => {
      const rows = await discardOfferingDrafts(serverEventIds);
      return { rows, localDeletedCount: (localOnlyDraftIds ?? []).length };
    },
    onSuccess: (result, { kind, brandId, serverEventIds, localOnlyDraftIds }) => {
      const deletedServerIds = new Set(
        result.rows.filter((r) => r.outcome === "deleted").map((r) => r.eventId),
      );

      // EVENTS: also remove local-only ids from Zustand (no RPC was called for them)
      // AND remove server-deleted ids from Zustand (single path does both).
      if (kind === "event") {
        for (const id of localOnlyDraftIds ?? []) deleteLocalDraft(id);
        for (const id of deletedServerIds) deleteLocalDraft(id);
        // optimistic list-cache prune (mirror removeDraftFromListCache)
        queryClient.setQueryData<unknown[]>(
          eventDraftKeys.list(brandId),
          (prev) =>
            (prev as Array<{ id: string }> | undefined ?? []).filter(
              (d) => !deletedServerIds.has(d.id),
            ),
        );
        for (const id of deletedServerIds)
          queryClient.removeQueries({ queryKey: eventDraftKeys.detail(id) });
        queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(brandId) });
      }

      if (kind === "trip") {
        for (const id of deletedServerIds)
          queryClient.removeQueries({ queryKey: tripKeys.detail(id) });
        queryClient.invalidateQueries({ queryKey: tripKeys.listByBrand(brandId) });
      }

      if (kind === "experience") {
        queryClient.invalidateQueries({
          queryKey: experienceKeys.listByBrand(brandId),
        });
      }

      // ALL kinds: refresh offering counts (universal empty-state + Hub To-Do).
      queryClient.invalidateQueries({
        queryKey: brandKeys.offeringCounts(brandId),
      });
    },
  });
};
```

> If `brandKeys` is not exported from `useBrandOfferingCounts.ts`, add the named export (it is referenced internally at line 45 as `brandKeys.offeringCounts`). Additive change only.

### 3.3 Selection-mode hook — `mingla-business/src/hooks/useDraftMultiSelect.ts` (NEW)

One owner of selection mechanics. Generic over the id type (string).

```ts
import { useCallback, useState } from "react";

export interface DraftMultiSelect {
  selectionMode: boolean;
  selectedIds: Set<string>;
  count: number;
  /** Long-press entry: enters mode AND selects the long-pressed row. */
  enterWith: (id: string) => void;
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
  clear: () => void;
  /** Exit mode + clear selection (Cancel button / after delete). */
  exit: () => void;
}

export function useDraftMultiSelect(): DraftMultiSelect {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const enterWith = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );
  const clear = useCallback(() => setSelectedIds(new Set()), []);
  const exit = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  return {
    selectionMode,
    selectedIds,
    count: selectedIds.size,
    enterWith,
    toggle,
    isSelected,
    clear,
    exit,
  };
}
```

**Mounting:** each tab screen calls `useDraftMultiSelect()` once. (One instance per tab — selection never crosses tabs; switching the filter pill away from "draft" MUST call `exit()` so selection mode can't leak onto a non-draft view — see §3.6/§3.7 wiring.)

### 3.4 Sticky action bar — `mingla-business/src/components/offering/DraftSelectBar.tsx` (NEW)

Shared. Renders absolutely at the bottom of the tab (above the floating BottomNav). Shown only when `selectionMode === true`.

```ts
export interface DraftSelectBarProps {
  count: number;          // selected count → "Delete (N)"
  deleting: boolean;      // disables both buttons + shows spinner on Delete
  onCancel: () => void;   // → useDraftMultiSelect.exit()
  onDelete: () => void;   // → open ConfirmDialog
  bottomInset: number;    // safe-area inset to clear the home indicator
}
```

Contract:
- Two controls: `Cancel` (left, secondary) and `Delete (N)` (right, destructive).
- `Delete (N)` is **disabled when `count === 0`** (toggling the last row off must not leave an actionable empty delete) and **disabled when `deleting`**.
- Label uses the literal count: `Delete (${count})`.
- testIDs: bar `draft-select-bar`, cancel `draft-select-cancel`, delete `draft-select-delete`.
- accessibilityRole="button" on both; `accessibilityLabel` on delete = `Delete ${count} selected draft${count === 1 ? "" : "s"}`.
- **Android opaque-glass policy** (memory): the bar fill MUST be opaque ≥0.92 on Android via `Platform.select`, with `overflow:'hidden'` and no Android shadow under the rounded fill. iOS may keep the translucent glass tint. (Visual tokens are DESIGN's deliverable — §8 — but this policy is a hard constraint regardless of design.)

### 3.5 Checkbox overlay — `mingla-business/src/components/offering/DraftSelectCheckbox.tsx` (NEW)

Shared. A small circular check/uncheck control rendered as an overlay on a card when `selectionMode === true`. Uses the existing lucide check pattern referenced by `src/components/ari/MultiSelectPrompt.tsx` (reuse the LOOK, not the component) or the kit `Icon` (`check`). Props:

```ts
export interface DraftSelectCheckboxProps {
  selected: boolean;
  testID?: string;
}
```

It is purely presentational; the toggle is driven by the card's `onPress` being re-routed to `toggle(id)` while in selection mode (§3.7). The checkbox itself does not own the press (so the whole row is the hit target — matches Seth's "tapping rows toggles checkboxes").

### 3.6 EVENTS partitioning logic (the Zustand trap — Q4)

In `events.tsx`, when the user confirms a bulk delete, partition `selectedIds` (which are `draft.id`s) against the live `drafts` array:

```ts
const selected = drafts.filter((d) => selection.isSelected(d.id));
const localOnly = selected.filter(isLocalOnlyDraft).map((d) => d.id);
const serverIds = selected.filter((d) => !isLocalOnlyDraft(d)).map((d) => d.id);
// isLocalOnlyDraft is the existing helper at events.tsx:115
//   (d.id.startsWith("d_") || d.serverSlug === null)
```

Then call ONE mutation:
```ts
const result = await discardOfferingDrafts.mutateAsync({
  kind: "event",
  brandId: currentBrand.id,
  serverEventIds: serverIds,
  localOnlyDraftIds: localOnly,
});
```
The hook deletes `localOnly` from Zustand (no RPC) and discards `serverIds` via the RPC, then removes deleted server ids from Zustand + RQ (§3.2). Trips/experiences pass `localOnlyDraftIds: []` (or omit) and only `serverEventIds`.

### 3.7 Per-tab integration

#### 3.7.1 Row-card prop additions (all 3 cards — additive, backward-compatible)
Add to `EventListCardProps`, `TripListCardProps`, `OfferingListCardProps` (and pass-through `ExperienceListCardProps`):
```ts
  /** When true, the row is in selection mode: tap toggles instead of opening. */
  selectionMode?: boolean;     // default false
  selected?: boolean;          // default false
  onLongPress?: () => void;    // long-press to enter selection mode
  /** When true, this row is NOT a draft → long-press is a no-op + no checkbox. */
  selectable?: boolean;        // default true; caller passes false for non-draft rows
```
Card behavior (each card's root `Pressable`):
- Add `onLongPress={selectable ? onLongPress : undefined}` and `delayLongPress={350}` to the existing body `Pressable` (EventListCard.tsx:128, TripListCard.tsx:131, OfferingListCard.tsx:94).
- When `selectionMode === true` **and** `selectable === true`: `onPress` must call the toggle (the tab passes a press handler that routes to `selection.toggle(id)` instead of `onOpen`) — see §3.7.2. The manage 3-dot `Pressable` is **disabled/hidden** while `selectionMode` (no managing during selection).
- When `selectionMode === true` **and** `selectable === true`: render `<DraftSelectCheckbox selected={selected} />` overlay (top-left of the cover, per DESIGN).
- When `selectionMode === true` **and** `selectable === false` (a Live/Upcoming/Past row visible under the "All" filter): the row dims (DESIGN spec) and is non-interactive (no toggle, no open, no long-press, no checkbox). Drafts-only is thereby enforced visually AND functionally.
- `selected === true`: selected-row visual treatment (DESIGN; e.g. accent ring) — the card applies a `selected && styles.selectedHost` style.

> The cards already short-circuit defensively (e.g. EventListCard returns null for non-event rows). The new props default to non-selection so every EXISTING call site (single-delete flows, dashboards) is unaffected.

#### 3.7.2 Tab wiring pattern (identical shape for all 3 tabs)
Each tab:
1. `const selection = useDraftMultiSelect();`
2. `const discard = useDiscardOfferingDrafts();`
3. Add a confirm-dialog state: `const [confirmOpen, setConfirmOpen] = useState(false);` + `const [bulkError, setBulkError] = useState<string | null>(null);`
4. **Filter-change guard:** when `setFilter` is called to anything other than `"draft"`, call `selection.exit()` (wrap the pill `onPress`). For experiences (no filter), no-op — selection auto-scopes by `selectable`.
5. Per row, compute `const isDraftRow = <row is a draft>;` and pass to the card:
   ```tsx
   <XListCard
     ...existing props...
     selectionMode={selection.selectionMode}
     selectable={isDraftRow}
     selected={selection.isSelected(rowId)}
     onLongPress={isDraftRow ? () => selection.enterWith(rowId) : undefined}
     onOpen={
       selection.selectionMode && isDraftRow
         ? () => selection.toggle(rowId)
         : originalOnOpen
     }
     onManageOpen={selection.selectionMode ? undefined : originalOnManageOpen}
   />
   ```
6. Render `<DraftSelectBar visible via selection.selectionMode count={selection.count} deleting={discard.isPending} onCancel={selection.exit} onDelete={() => setConfirmOpen(true)} bottomInset={insets.bottom} />` as the last child of the tab host (sibling to the list ScrollView).
7. Render the shared `ConfirmDialog` (§3.8).
8. On successful delete: `selection.exit()` + show toast.

- `rowId`: events `draft.id`; trips `trip.id`; experiences `exp.id`.
- `isDraftRow`: events `item.kind === "draft"` (events.tsx already tags items); trips `trip.status === "draft"`; experiences `exp.status === "draft"`.

#### 3.7.3 EXPERIENCES specifics (Q2 resolution — what is/ISN'T added)
**Added (minimal):** long-press enabled only on `exp.status === "draft"` rows inside `ExperienceGenerationSurface`; selection bar + checkbox + confirm. The `OfferingListCard` prop additions (§3.7.1) flow through `ExperienceListCard`. This is the FIRST experience-delete capability ever; it is server-gated `event_manager` (§2) — net-new but RLS/rank-enforced, not "anyone authenticated."
**NOT added:** NO Drafts filter pill, NO All/Upcoming/Past pills, NO change to the flat "Your experiences" list, NO list for `creative_and_arts`/default brand shells (they show only a Create CTA today and stay that way). Multi-select lives only where the experiences list lives (restaurant/play). If a brand has zero draft experiences, long-press never fires (no `selectable` rows) and the feature is invisible — correct.

### 3.8 Confirm dialog + combined toast copy (Q8, Q4)

**ConfirmDialog** (reuse `src/components/ui/ConfirmDialog.tsx`, exactly as events.tsx:705):
```tsx
<ConfirmDialog
  visible={confirmOpen}
  onClose={() => { if (!discard.isPending) { setConfirmOpen(false); setBulkError(null); } }}
  onConfirm={handleBulkDeleteConfirm}
  title={selection.count === 1 ? "Delete this draft?" : `Delete ${selection.count} drafts?`}
  description={
    selection.count === 1
      ? "This draft will be permanently removed. This can't be undone."
      : `These ${selection.count} drafts will be permanently removed. This can't be undone.`
  }
  variant="simple"
  confirmLabel={selection.count === 1 ? "Delete draft" : `Delete ${selection.count}`}
  cancelLabel="Keep"
  confirmLoading={discard.isPending}
  confirmDisabled={discard.isPending}
  closeDisabled={discard.isPending}
  errorMessage={bulkError}
  testID="bulk-delete-confirm"
  confirmTestID="bulk-delete-confirm-button"
  cancelTestID="bulk-delete-cancel-button"
  destructive
/>
```

**Toast tally (no-silent-failure)** — after `mutateAsync` resolves, compute from the result:
```ts
const deleted = result.rows.filter((r) => r.outcome === "deleted").length
  + result.localDeletedCount;
const failed = result.rows.filter((r) => r.outcome !== "deleted").length;
```
Copy:
- `failed === 0`: `Deleted ${deleted} draft${deleted === 1 ? "" : "s"}.`
- `failed > 0 && deleted > 0`: `Deleted ${deleted}, ${failed} couldn't be deleted.`
- `failed > 0 && deleted === 0`: `Couldn't delete ${failed} draft${failed === 1 ? "" : "s"}. You may not have permission.`

Use each tab's existing Toast surface (events `setToast`, experiences `setToast`, trips — ADD a `Toast` mount; trips.tsx has none today, add `<Toast>` like experiences.tsx:309). On the `throw` path (network/`not_authenticated`), set `bulkError` on the dialog (keep dialog open) using the existing `draftDeleteErrorMessage` decoder pattern; do not silently swallow.
Then `setConfirmOpen(false)` + `selection.exit()` on success.

### 3.9 Cache-invalidation summary (per tab, after success)

| Tab | RQ ops | Zustand | Counts |
|---|---|---|---|
| events | `setQueryData(eventDraftKeys.list)` prune deleted server ids + `removeQueries(eventDraftKeys.detail)` per deleted + `invalidateQueries(eventDraftKeys.list)` | `deleteDraft(id)` for **every** local-only id AND every deleted server id | `invalidateQueries(brandKeys.offeringCounts)` |
| trips | `removeQueries(tripKeys.detail)` per deleted + `invalidateQueries(tripKeys.listByBrand)` | — | `invalidateQueries(brandKeys.offeringCounts)` |
| experiences | `invalidateQueries(experienceKeys.listByBrand)` | — | `invalidateQueries(brandKeys.offeringCounts)` |

(All implemented in `useDiscardOfferingDrafts.onSuccess`, §3.2 — one owner.)

---

## 4. DRAFT Invariants to pre-stage

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (PROPOSED, promoted at close):

1. **I-PROPOSED-ORCH-1123-MULTISELECT-DRAFTS-ONLY**
   - Rule: long-press selection mode + the `DraftSelectBar` may target ONLY rows whose status is `draft`. A non-draft row must be `selectable={false}` (no long-press, no toggle, no checkbox). The batch RPC must `skip_not_draft` any non-draft id.
   - Enforcement: card passes `selectable={isDraftRow}`; RPC guards `status='draft'` server-side (defense in depth).
   - Test: jest — assert each tab computes `selectable` from a draft predicate; SQL — a non-draft id returns `skipped_not_draft`, never `deleted`.

2. **I-PROPOSED-ORCH-1123-BATCH-RPC-RANK-GATED**
   - Rule: `business_discard_offering_drafts` must enforce `biz_brand_effective_rank >= biz_role_rank('event_manager')` PER ROW and must be REVOKE'd from PUBLIC/anon, GRANT'd to authenticated/service_role only.
   - Enforcement: SQL body + GRANT lines.
   - Test: migration-source jest grep (mirror `serverDraftLifecycleGuards.test.ts:200`) asserting the rank check + GRANT line are present; SQL adversarial — a sub-rank/other-brand caller gets `forbidden`.

3. **I-PROPOSED-ORCH-1123-NO-SILENT-PARTIAL-FAILURE**
   - Rule: a partial batch (some `forbidden`/`skipped`) MUST surface a toast naming counts; the RPC MUST return per-row outcomes (never all-or-nothing rollback that hides intent).
   - Enforcement: RPC `RETURN NEXT` per id; client toast tally (§3.8).
   - Test: jest — given a mixed-outcome result, the toast string contains "couldn't be deleted".

4. **I-PROPOSED-ORCH-1123-EVENTS-LOCAL-SERVER-SPLIT**
   - Rule: an events bulk delete must route local-only ids (`d_*`/`serverSlug===null`) to Zustand `deleteDraft` only, and server ids to the RPC + Zustand removal + RQ invalidate. A local-only id must NEVER be sent to the RPC (it would 404).
   - Enforcement: `events.tsx` partition (§3.6) + hook split (§3.2).
   - Test: jest — partition fn sends zero `d_*` ids in `serverEventIds`; deletes all local ids from the store.

5. **I-PROPOSED-ORCH-1123-LONGPRESS-FIRES** (Constitution #1 no-dead-tap)
   - Rule: long-press on a draft row MUST enter selection mode at runtime (not "wired in source").
   - Enforcement: `onLongPress`+`delayLongPress` on the body Pressable; tab passes a real `enterWith`.
   - Test: device/sim runtime proof at TEST (source caps at "suspected").

---

## 5. Step 0.5 — Regression-test plan

**Implementor (happy-path, must ship in the PR):**
- `mingla-business` jest:
  - `useDraftMultiSelect` unit: enterWith selects 1 + sets mode; toggle add/remove; exit clears mode+set; clear keeps mode.
  - Events partition unit: a mixed `[d_x, uuid1, uuid2]` selection → `serverEventIds=[uuid1,uuid2]`, `localOnlyDraftIds=[d_x]`.
  - Toast tally unit: `deleted/failed` combinations produce the §3.8 strings.
  - Migration-source grep test (new, mirror `serverDraftLifecycleguards.test.ts`): asserts `CREATE OR REPLACE FUNCTION public.business_discard_offering_drafts`, the per-row rank check, `$function$;` before GRANT, and the GRANT line.
- SQL behavioral (new `supabase/migrations/__tests__/orch_1123_batch_discard.test.sql`): seed 3 drafts (event/trip/experience) for a brand the caller manages → all return `deleted` + `deleted_at` set; a non-draft id → `skipped_not_draft`; a missing id → `skipped_not_found`; re-run on already-deleted → `skipped_not_found` (idempotent).
- Must prove **fails-on-revert**: revert the RPC migration → SQL test fails; revert the partition → events jest fails.

**Tester (adversarial — different angle):**
- **Security/authz:** call the RPC as (a) a sub-`event_manager` user on their own brand's draft → expect `forbidden`, row NOT deleted; (b) a user against ANOTHER brand's draft id → expect `forbidden`; (c) anon/`service_role`-revoked path → REVOKE holds. Live-fire via magic-link JWT + curl (the ORCH-1081 E2E driver pattern in memory).
- **Drafts-only enforcement bypass:** craft a batch containing a LIVE/published event id mixed with drafts → expect the live id `skipped_not_draft` and ONLY the drafts deleted (a stale UI must never delete a live offering).
- **Dead-tap runtime:** on a physical device/sim, long-press a draft row → mode enters; tap rows → checkboxes toggle + bar count updates; Delete → confirm → rows vanish; Cancel → mode exits cleanly; long-press a non-draft row under "All" → no-op.
- **Events Zustand consistency:** select a mix of a local-only `d_*` draft + a server draft → both vanish, neither resurrects on a tab re-render or app relaunch (Zustand + RQ stay consistent).
- **Partial-failure surfacing:** force one row to fail (publish a selected draft from another session mid-flow) → toast shows "Deleted N, 1 couldn't be deleted", deletables still removed.

---

## 6. Risks honored
- No-dead-tap (I-PROPOSED-...-LONGPRESS-FIRES) → device proof required at TEST.
- No-silent-failure → per-row RPC + toast tally (§3.8).
- Exclusion-consistency on cache keys → §3.9 one-owner hook.
- Drafts-only server-side (`status='draft'`) → defense in depth (§2).
- Permission parity → server `event_manager`; client decodes `forbidden`→message; sub-rank users still see selection mode but get an honest tally (acceptable — they CAN'T enter unless they manage; consider gating long-press on `canPerformAction(currentRank, "EDIT_EVENT")` if DESIGN/operator prefers hiding it entirely — implementor MAY add this gate, it is consistent with single-delete which leans on the same rank).
- Android opaque-glass policy → §3.4.
- Currency → N/A.

---

## 7. File-by-file change list (authoritative)

**New:**
1. `supabase/migrations/20260927000000_orch_1123_batch_discard_offering_drafts.sql` (§2.2)
2. `supabase/migrations/__tests__/orch_1123_batch_discard.test.sql` (§5)
3. `mingla-business/src/services/offeringDrafts.ts` (§3.1)
4. `mingla-business/src/hooks/useDiscardOfferingDrafts.ts` (§3.2)
5. `mingla-business/src/hooks/useDraftMultiSelect.ts` (§3.3)
6. `mingla-business/src/components/offering/DraftSelectBar.tsx` (§3.4)
7. `mingla-business/src/components/offering/DraftSelectCheckbox.tsx` (§3.5)
8. `mingla-business/src/hooks/__tests__/useDraftMultiSelect.test.ts` (+ partition/toast unit tests; §5)
9. `mingla-business/src/utils/__tests__/orch_1123_batch_rpc_source.test.ts` (migration-source grep; §5)

**Edited (additive):**
10. `mingla-business/src/components/event/EventListCard.tsx` — add selection props + onLongPress + checkbox overlay + selected style (§3.7.1)
11. `mingla-business/src/components/trip/TripListCard.tsx` — same
12. `mingla-business/src/components/offering/OfferingListCard.tsx` — same
13. `mingla-business/src/components/experience/ExperienceListCard.tsx` — pass-through the new props to `OfferingListCard`
14. `mingla-business/app/(tabs)/hub/events.tsx` — mount selection, partition (§3.6), bar, confirm, toast tally, filter-change `exit()`
15. `mingla-business/app/(tabs)/hub/trips.tsx` — mount selection, bar, confirm, ADD Toast, filter-change `exit()`
16. `mingla-business/app/(tabs)/hub/experiences.tsx` — mount selection inside `ExperienceGenerationSurface`, gate long-press to draft rows, bar, confirm, reuse existing Toast
17. `mingla-business/src/hooks/useBrandOfferingCounts.ts` — export `brandKeys` if not already exported (§3.2 note)
18. `Mingla_Artifacts/INVARIANT_REGISTRY.md` — add the 5 I-PROPOSED invariants (§4)

---

## 8. DESIGN handoff note (DESIGN runs next)

DESIGN must spec, pixel-precise, for mingla-business (React Native, dark glass system):
- **Checkbox states:** unchecked + checked circular control; exact size, stroke, fill, icon (check), position (recommended top-left over the cover thumb). iOS vs Android deltas (opaque ≥0.92 Android fill, `overflow:'hidden'`, no Android shadow under rounded fill).
- **Selected-row treatment:** how a `selected` card reads (accent ring? tint? scale?) vs unselected, and how a `selectable={false}` non-draft row dims under the "All" filter while selection mode is active.
- **Sticky `DraftSelectBar`:** height, padding, position above the floating BottomNav (clear `insets.bottom`), Cancel vs `Delete (N)` button hierarchy (destructive accent on Delete), disabled state when `count===0`, deleting spinner state, enter/exit motion (slide-up/fade), tokens per the design system.
- **Long-press affordance / discoverability:** since long-press is the SOLE entry (Q7) and is undiscoverable, DESIGN should propose a lightweight one-time hint (e.g. a first-run coachmark or subtle "Long-press to select" caption on the drafts filter) — DESIGN decides; do not redesign the tab.
- **Empty-after-delete state:** what each draft list shows when the last draft is deleted (reuse each tab's existing "No drafts in progress" empty copy — confirm it renders correctly post-batch).
- **Confirm dialog:** confirm the destructive `ConfirmDialog` `simple` variant matches the events single-delete dialog visually (already shipped).
- **Toast:** the partial-failure toast ("Deleted 4, 1 couldn't be deleted") kind = `warn` vs success `info` — DESIGN picks the kind mapping.
- **Per-platform deltas:** iOS long-press haptic (light impact on enter) vs Android; ripple vs opacity press feedback on the checkbox.

---

## Summary

ORCH-1123 ships long-press multi-select + bulk soft-delete for DRAFT offerings across all three business-app Hub tabs, anchored on ONE batch RPC and ONE delete-dispatch hook (one-owner-per-truth). **RPC:** `public.business_discard_offering_drafts(p_event_ids uuid[]) RETURNS TABLE(event_id uuid, outcome text)`, migration `20260927000000`, `SECURITY DEFINER`, per-row guards copied from `business_discard_event_draft` (auth · `status='draft'` · `event_manager` rank · brand-exists · `FOR UPDATE` · idempotent), `event_type`-agnostic, GRANT'd to authenticated/service_role only. **Result shape = SKIP-and-report (NOT all-or-nothing)** so partial failures surface as "Deleted N, M couldn't be deleted" (no silent failure). **Selection = shared `useDraftMultiSelect` hook + shared `DraftSelectBar` + `DraftSelectCheckbox`**, each tab keeping its own card + data source. **Experiences-drafts surfacing = no new filter / no tab redesign**: long-press is gated to `status==='draft'` rows inside the existing `ExperienceGenerationSurface` (restaurant/play), the first-ever experience delete, rank-gated. The events Zustand trap is handled by partitioning local-only (`d_*`/`serverSlug===null` → Zustand `deleteDraft` only) from server (RPC + Zustand + RQ invalidate). Trips bulk-delete now routes through the rank-checked RPC (stricter, accepted; single path untouched). Counts invalidated on every kind. Five I-PROPOSED invariants pre-staged; tester drives the adversarial authz/drafts-only/dead-tap angles live.

**Artifact:** `Mingla_Artifacts/specs/SPEC_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md`
