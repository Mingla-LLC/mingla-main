# INVESTIGATE — ORCH-1123 [Hub multi-select draft delete]

**Mode:** mingla-forensics INVESTIGATE
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1123-[hub-multiselect-draft-delete]` (branch `ORCH-1123-hub-multiselect-draft-delete`, current with origin/main `0f9860b4a`)
**Date:** 2026-06-11
**COMMS_LEDGER:** read on entry — no BLOCK/WARN row targets ORCH-1123 or mingla-forensics. No new cross-ORCH discovery requiring a ledger write.

---

## Symptom / Goal

There is no symptom; this is a **feature build**. Seth's locked decision: in the **business app Hub**, let a brand **long-press a DRAFT row** to enter a **multi-select mode** (per-row checkboxes + a sticky "Delete (N)" bar + one confirm) and **bulk-delete** the selected drafts. Scope = **DRAFTS ONLY**, across all three Hub tabs (events, trips, experiences). Live / Upcoming / Past keep their existing single-item flow untouched.

This investigation proves exactly how each tab renders drafts today, the exact single-delete contract per type, the auth/permission model the batch RPC must replicate, the cache-invalidation surface, and every constraint SPEC must honor. **No code written. Scope not expanded.**

---

## Five-Truth-Layer Findings

### Truth 1 — Database (`public.events`, one table, three `event_type`s)

- **VERIFIED.** All three offering types live in `public.events`, keyed by `event_type IN ('event','trip','experience')`. A draft = `status='draft' AND deleted_at IS NULL`. Delete is a **soft-delete** (`deleted_at = now()`), never a hard `DELETE`.
- The existing draft-discard RPC `public.business_discard_event_draft(p_event_id uuid)` is defined in **`supabase/migrations/20260515000006_orch_0763d_draft_discard_rpc.sql`**. **Critical:** the RPC has **NO `event_type` filter** — it discards *any* draft row (event, trip, or experience) so long as `status='draft'`. This is the single biggest enabler for ORCH-1123: a batch RPC can reuse this exact logic verbatim for all three kinds.
- **Latest migration version on origin/main:** `20260926000000_orch_1111_oauth_null_email_accept.sql`. Same in this worktree (no newer local migration). **SPEC must pick a version strictly greater than `20260926000000`** (e.g. `20260927000000_...`) for monotonicity. (Recall the migration-baseline CI gotchas from memory: `$function$;` before GRANT, DROP before widening a `RETURNS TABLE`, apply via Management API since MCP is read-only + CLI drift-wedged.)

### Truth 2 — RLS / permission model

- **`business_discard_event_draft` SQL (quoted in full below in "Existing delete contract").** It is `SECURITY DEFINER`, runs an explicit auth check (`auth.uid()` not null), a draft-status guard (`status = 'draft'`), a brand-ownership/existence check, and a **rank gate**: `biz_brand_effective_rank(brand_id, user_id) >= biz_role_rank('event_manager')`. `EXECUTE` granted to `authenticated, service_role` only; `REVOKE`d from `PUBLIC`/`anon`.
- **DIVERGENCE (important).** `softDeleteTrip` (`mingla-business/src/services/tripsService.ts:1286`) is a **direct client-side table UPDATE** with NO server rank check — it relies purely on the `events` table RLS UPDATE policy for authz. So events drafts are discarded through a rank-checked RPC, while trip drafts are discarded through a raw RLS-only UPDATE. A unified batch RPC (rank-checked, `event_type`-agnostic) **tightens** trip-draft authz to match events (good — one-owner-per-truth).
- **Permission constant:** `mingla-business/src/utils/permissionGates.ts` — `CREATE_EVENT` and `EDIT_EVENT` both require `BRAND_ROLE_RANK.event_manager` (40). There is **no dedicated DELETE/DISCARD action constant** today; the events single-delete leans on the RPC's server-side `event_manager` gate + decodes the `insufficient_event_permission` error into a user message (`events.tsx:125`). SPEC should mirror that: server-enforced `event_manager` for the batch, client surfaces the permission error.

### Truth 3 — Services / hooks

- **Events draft delete:** service `discardServerDraft(draftId)` (`src/services/eventDrafts.ts:282`) → `supabase.rpc("business_discard_event_draft", { p_event_id })`; wrapped by hook `useDiscardServerDraft()` (`src/hooks/useServerDraftEvents.ts:334`). It also tolerates `ServerDraftLifecycleError` (treats not-found / not-discardable as success — idempotent).
- **Trip draft delete:** service `softDeleteTrip(eventId)` (`tripsService.ts:1286`) → hook `useSoftDeleteTrip()` (`src/hooks/useTrips.ts:316`). The service first **rejects if confirmed orders exist** (`{ rejected: true, reason: "has_confirmed_orders" }`) — but for *drafts* this is a no-op (a draft can't have sold tickets), so it's harmless for ORCH-1123's drafts-only scope.
- **Experience delete:** **DOES NOT EXIST.** VERIFIED by exhaustive grep across `src/services`, `src/hooks`, and `app/experience/**` — there is **no** `softDeleteExperience`, no `useSoftDeleteExperience`, no discard, no `deleted_at` write for experiences anywhere. The experiences Hub manage-sheet only offers Edit / View public / Share / Cancel (and Cancel routes to the dashboard for non-drafts only). **For experiences, ORCH-1123 is the FIRST delete capability ever.** This means the batch RPC is not just a convenience — it is the *only* way an experience draft will be deletable. SPEC must treat experience-draft deletion as net-new, not a wrap of an existing path.

### Truth 4 — State / cache

See the dedicated cache-invalidation map below. Key point: **events drafts live in BOTH a Zustand store AND React Query**; trips and experiences live in React Query only. The events tab reads drafts from the Zustand store via `useDraftsForBrand` (`draftEventStore.ts:1028`), and the store holds local-only (`d_*`/`serverSlug===null`) drafts that **never hit the server** plus server-synced drafts upserted by `useServerDraftsForBrand`. A batch selection on the events tab can therefore mix **local-only** and **server** drafts in one operation.

### Truth 5 — UI / runtime

- **No reusable list-row multi-select / checkbox / selection-mode primitive exists** in mingla-business (see "Multi-select primitive gap"). Long-press is not currently wired on any Hub row — the row cards only expose body-tap (`onOpen`) and the 3-dot manage trigger (`onManageOpen`).
- **Runtime repro:** NO booted iOS simulator and no reachable business login session at investigation time (`xcrun simctl list devices booted` → none; Metro is running on :8081 but no signed-in business session is available to drive). Per the "always reproduce on simulator" rule, **runtime claims are capped at "suspected"** and NOT fabricated. **Suspected (source-backed, not runtime-proven):** long-press on a draft row is currently a no-op — the row `Pressable`s in `OfferingListCard.tsx` / `EventListCard.tsx` / `TripListCard.tsx` define only `onPress`, with **no `onLongPress` prop anywhere** (grep returned zero `onLongPress` in the Hub render path). SPEC's dead-tap risk (long-press must actually enter selection mode) needs device proof at TEST.

---

## The 3-Tab Render Map (how each tab renders DRAFTS today)

> The three tabs **diverge structurally**. A multi-select layer cannot assume one shared row component or one shared data source.

### `app/(tabs)/hub/events.tsx` (`EventsTab`)
- **Row component:** `EventListCard` (`src/components/event/EventListCard.tsx`) — **NOT** the shared `OfferingListCard`. It is the original best-of-breed card; `OfferingListCard` was *generalized from* it but events still use the bespoke one.
- **Draft data source:** Zustand store. `useDraftsForBrand(brandId)` (`draftEventStore.ts:1028`) returns `s.drafts` filtered by brand. `useServerDraftsForBrand(brandId)` (side-effect hook, line 143) fetches server drafts and **upserts them into the same Zustand store**. So `drafts` = local-only + server, merged.
- **Draft filter:** `filteredItems` (events.tsx:234) — when `filter === "draft"` it returns only `draftItems` (events.tsx:258). Each draft item carries `{ key: 'draft-<id>', event: DraftEvent, kind: 'draft', status: 'draft' }`.
- **Local-only vs server distinction:** `isLocalOnlyDraft(draft)` (events.tsx:115) = `draft.id.startsWith("d_") || draft.serverSlug === null`. The single-delete handler (`handleDeleteDraftConfirm`, events.tsx:494) branches: local-only → `deleteLocalDraft(draft.id)` (Zustand `deleteDraft`, draftEventStore.ts:903); server → `discardServerDraft.discardDraft(draft)`.
- **Multi-select must accommodate:** mixed local+server selection; rows are `EventListCard`, not `OfferingListCard`; data is Zustand-backed (selection state can key off `draft.id`).

### `app/(tabs)/hub/trips.tsx` (`HubTripsRoute`)
- **Row component:** `TripListCard` (`src/components/trip/TripListCard.tsx`) — **a parallel, bespoke card, NOT `OfferingListCard`**. (Despite the file header saying it mirrors EventListCard, it does its own status derivation and rendering.)
- **Draft data source:** React Query — `useTripsByBrand(brandId)` → `tripsQuery.data`. Drafts are bucketed in `buckets.draft` via `deriveTripFilterBucket` (`trip.status === "draft"`, trips.tsx:64). When `filter === "draft"`, `filteredTrips` returns `buckets.draft` (trips.tsx:131).
- **No local-only concept** — all trips are server rows.
- **Multi-select must accommodate:** rows are `TripListCard`; data is React-Query-backed `Trip[]`; selection keys off `trip.id`.

### `app/(tabs)/hub/experiences.tsx` (`HubExperiencesRoute` → `ExperienceGenerationSurface`)
- **Row component:** `ExperienceListCard` (`src/components/experience/ExperienceListCard.tsx`) — a **thin adapter** that maps `VenueExperience` → `OfferingListCardModel` and renders `OfferingListCard` (kind="experience"). So experiences DO use `OfferingListCard` (indirectly); events and trips do NOT.
- **Draft data source:** React Query — `useExperiencesByBrand(brandId)` → `experiencesQuery.data`. **No filter pills at all** on this tab — there is NO Drafts pill, NO All/Upcoming/Past pills. It renders a single flat "Your experiences" list of *all* experiences regardless of status (experiences.tsx:253-300). Draft-ness is only conveyed by the per-card DRAFT pill/overlay.
- **Branching by `venueCategory`:** `HubExperiencesRoute` renders four different shells — `restaurant` and `play` get the full `ExperienceGenerationSurface` (with the AI snap CTA + list); `creative_and_arts` and the default get a bare empty-state with no list. **The experiences list (and therefore any multi-select layer) only exists inside `ExperienceGenerationSurface`**, i.e. only for `restaurant`/`play` brands. SPEC must decide where the list renders for other categories OR scope multi-select to wherever the list lives.
- **Multi-select must accommodate:** there is **no Drafts filter** to scope into — selection mode must filter to `exp.status === "draft"` itself, or the long-press must be allowed only on draft rows; experiences are the ONLY tab where a draft sits inline among live/ended rows with no draft-only view.

**Net divergence summary the multi-select layer must absorb:**
| | Row component | Data source | Has Drafts filter? | Local-only drafts? | Existing delete? |
|---|---|---|---|---|---|
| events | `EventListCard` (bespoke) | Zustand (`useDraftsForBrand`) | Yes (pill) | **Yes** (`d_*`/`serverSlug===null`) | RPC (rank-checked) |
| trips | `TripListCard` (bespoke) | React Query (`useTripsByBrand`) | Yes (pill) | No | Client UPDATE (RLS-only) |
| experiences | `OfferingListCard` (via adapter) | React Query (`useExperiencesByBrand`) | **No** (flat list, category-gated shell) | No | **None — net new** |

---

## Existing Delete Contract Per Type (the contract a batch delete MUST preserve)

### Events — `business_discard_event_draft` (SQL quoted in full)
`supabase/migrations/20260515000006_orch_0763d_draft_discard_rpc.sql`:
```sql
CREATE OR REPLACE FUNCTION public.business_discard_event_draft(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_now timestamptz := now();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_discardable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name INTO v_brand FROM public.brands
  WHERE id = v_event.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  UPDATE public.events
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = p_event_id AND status = 'draft' AND deleted_at IS NULL
  RETURNING * INTO v_event;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event.id,
    'brand_id', v_event.brand_id,
    'deleted_at', v_event.deleted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.business_discard_event_draft(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_discard_event_draft(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_discard_event_draft(uuid) TO authenticated, service_role;
```
**Guards to preserve in any batch:** auth-present · row-exists-and-not-already-deleted · `status='draft'` · `event_manager` rank on the row's brand · brand exists & not deleted · `FOR UPDATE` row lock · idempotent re-discard (the `WHERE ... deleted_at IS NULL` no-ops a second call). Note the RPC does **not** filter `event_type` — it already works for trips/experiences as written.

### Trips — `softDeleteTrip` (client UPDATE, RLS-only)
`tripsService.ts:1286`:
- Pre-check: rejects if non-failed/cancelled orders exist (`orders` count) → `{ rejected: true, reason: "has_confirmed_orders" }`. (Moot for drafts.)
- `UPDATE public.events SET deleted_at = now() WHERE id = eventId AND event_type = 'trip' AND deleted_at IS NULL`.
- **NO rank check in code** — authz is RLS-only. `useSoftDeleteTrip` (`useTrips.ts:316`) on success `removeQueries(tripKeys.detail)` + `invalidateQueries(tripKeys.listByBrand(brandId))`.

### Experiences — none
No service, hook, RPC, or RLS-mediated client UPDATE deletes an experience today. **Net-new for ORCH-1123.**

---

## Proposed-Batch-RPC Constraints (for SPEC — do NOT design the solution here, just the constraints)

A batch RPC (the INTAKE working name is `business_discard_offering_drafts(p_event_ids uuid[])`) must:
1. **Be atomic per the constitution's no-silent-failure rule but report per-row outcome.** A single transaction that rolls back the whole batch on one bad row would silently lose the user's intent; a fire-and-forget loop that swallows failures violates no-silent-failure. SPEC must choose a model that returns, per id, a status (`deleted` / `skipped_not_draft` / `forbidden` / `not_found`) so the UI can surface "Deleted 4, 1 couldn't be deleted." (Open question Q3.)
2. **Replicate every guard from `business_discard_event_draft` per row** (auth, `status='draft'`, `event_manager` rank on each row's brand, not-already-deleted, `FOR UPDATE`). It must be `event_type`-AGNOSTIC (one RPC for all three kinds — the single table makes this the one-owner-per-truth choice; do NOT write three batch paths).
3. **Enforce same-brand scope.** All selected ids should belong to the current brand (the rank check is per-brand anyway, but SPEC should decide whether to reject a cross-brand id or just `forbidden` it).
4. **Be idempotent** (re-discarding an already-deleted row is a no-op `skipped`, mirroring the single RPC's `deleted_at IS NULL` guard).
5. **`SECURITY DEFINER`, `SET search_path`, `REVOKE` from PUBLIC/anon, `GRANT EXECUTE` to `authenticated, service_role`** — identical hardening posture to the existing RPC. End the body with `$function$;`/`$$;` BEFORE the GRANT (migration-baseline CI gotcha from memory).
6. **Pick migration version > `20260926000000`.**
7. **Tighten trips to rank-checked authz** (acceptable, strictly safer) and **add experiences delete for the first time** (net-new capability — make sure RLS/`event_manager` is the gate, not "anyone authenticated").
8. **NOT touch live/upcoming/past** — the `status='draft'` guard already enforces this server-side; a non-draft id must come back `skipped_not_draft`, never deleted.

---

## Cache-Invalidation Map (so all 3 lists refresh after a batch)

After a successful batch delete, SPEC must invalidate/remove these keys **per the kinds present in the selection** (a single tab's selection is single-kind, but the events tab also needs the Zustand mutation):

| Kind | React Query key factory | On-success actions today (single delete) |
|---|---|---|
| events | `eventDraftKeys` (`useServerDraftEvents.ts:54`) — `list(brandId)`, `detail(draftId)` | `removeQueries(detail)` + `removeDraftFromListCache` (setQueryData filter) + `invalidateQueries(list(brandId))` **AND** Zustand `deleteDraft(id)` (draftEventStore.ts:903) |
| trips | `tripKeys` (`useTrips.ts:60`) — `listByBrand(brandId)`, `detail(eventId)` | `removeQueries(detail)` + `invalidateQueries(listByBrand(brandId))` |
| experiences | `experienceKeys` (`useExperiencesByBrand.ts:13`) — `listByBrand(brandId)` (no detail key defined) | none today — SPEC defines it; minimally `invalidateQueries(listByBrand(brandId))` |

**The Zustand local-draft store is the trap (events only).** Local-only drafts (`d_*` / `serverSlug===null`) are **never on the server** — calling the RPC for them would either 404 (`event_draft_not_found`) or do nothing. They must be deleted via the Zustand store's `deleteDraft(id)` action ONLY. Server-synced events drafts must be deleted via the RPC **and** removed from the Zustand store (the single-delete path already does both: RPC + `deleteDraft`). **A mixed batch selection on the events tab must split: local-only ids → Zustand only; server ids → batch RPC + Zustand removal + RQ invalidation.** This split logic already exists in the single-delete handler (`events.tsx:494-520`, gated on `isLocalOnlyDraft`) and is the contract to generalize. Also note `useBrandOfferingCounts` (events.tsx:170) drives the "nothing created yet" empty state and the Hub To-Do counts — SPEC should confirm whether it needs invalidation after a batch so counts don't go stale (likely yes).

---

## Multi-Select Primitive Gap

**No reusable list-row multi-select / selection-mode / row-checkbox primitive exists in mingla-business.** VERIFIED by grep across `src/components`, `src/hooks`, `app` for `Checkbox|selectionMode|multiSelect|selectedIds|longPress|onLongPress|isSelectionMode`:
- `src/components/ui/` has NO `Checkbox` component (only `coverPickerSelection.ts`, unrelated).
- `src/components/ari/MultiSelectPrompt.tsx` (ORCH-1101) is an **Ari-conversation-specific, presentational** "pick all that apply" card with checkbox rows (`Check`/`CheckSquare`/`Square` from lucide) and a sticky confirm. It is a useful **visual reference** for the checkbox-row + sticky-confirm pattern Seth described, but it is NOT a list-row selection primitive: no long-press entry, no overlay on existing cards, no selection-state management, data-prop driven only. Reuse the *look*, not the component.
- The three row cards (`EventListCard`, `TripListCard`, `OfferingListCard`) expose only `onOpen` + `onManageOpen`. **None has an `onLongPress` or a selection/checkbox visual.**

**Cleanest insertion point for selection state (for SPEC to decide, options surfaced):**
- The three tabs DON'T share a row component or a data source, so a single drop-in shared card change is impossible without touching all three cards. Two viable shapes: (a) **per-tab local `useState<Set<string>>(selectedIds)` + `selectionMode` boolean** in each tab screen (minimal blast radius, but 3x the wiring + risk of drift), or (b) **a shared `useDraftMultiSelect` hook** (selection set + enter/exit/toggle/clear + a shared sticky "Delete (N)" bar component + a shared confirm) that each tab mounts, with each card gaining an `onLongPress` + a `selected`/`selectionMode` prop pair. Option (b) better honors one-owner-per-truth for the *selection mechanics* and the *delete dispatch*, while each tab keeps its own card + data-source adapter. The single batch RPC + a single `useDiscardOfferingDrafts` hook keeps the *delete logic* one-owner regardless of which UI option is chosen.

---

## Risks / Invariants SPEC Must Honor

- **Dead-tap (I-INTERACTIVE-ELEMENTS-FIRE):** long-press MUST actually enter selection mode at runtime — "wired in source" ≠ fires (cf. the Ari "Add cover" dead-tap, ORCH-1103). No `onLongPress` exists anywhere in the Hub path today, so this is brand-new interaction surface. **TEST must prove on a physical device / sim** that (1) long-press on a draft row enters mode, (2) tapping rows toggles checkboxes, (3) the sticky bar appears/updates count, (4) confirm deletes, (5) exit restores normal mode. Source-only proof caps at "suspected."
- **No-silent-failure:** a partial batch failure (e.g. one row lost its draft status, or a permission edge) MUST surface to the user ("Deleted 4, 1 couldn't be deleted"), not be swallowed. The per-row-result RPC shape (Q3) is what makes this possible.
- **One-owner-per-truth:** the single `public.events` table + the already-`event_type`-agnostic existing RPC argue strongly for **ONE batch RPC + ONE delete-dispatch hook** for all three kinds — do NOT replicate delete logic three times. (Today there are already three *different* single-delete mechanisms — RPC vs raw UPDATE vs nonexistent — ORCH-1123 is a chance to converge, but stay in scope: converge only the *batch* path; don't refactor the three single paths unless SPEC explicitly scopes it.)
- **Cache exclusion-consistency:** after delete, the deleted rows must vanish from the list immediately (optimistic `setQueryData` filter, like `removeDraftFromListCache`) AND the authoritative invalidate must follow. For events, the Zustand store and the RQ cache must stay consistent (both updated) or the list will resurrect a deleted draft on next render.
- **Drafts-only enforcement, server-side:** the `status='draft'` guard must live in the RPC (defense in depth), not just in the UI filter — a stale UI must never be able to delete a live offering.
- **Permission parity:** server enforces `event_manager`; client decodes `insufficient_event_permission` into a message. Don't let the UI offer multi-select to a sub-rank user and then 100%-fail the batch with a cryptic error.
- **Experiences category gate:** the experiences list only renders for `restaurant`/`play` brands inside `ExperienceGenerationSurface`. SPEC must confirm whether other categories ever show an experiences list (today they show only an empty state with a Create CTA), and scope long-press accordingly.
- **Android opaque-glass policy** (memory): any new selection-mode chrome / sticky bar / checkbox must follow the opaque ≥0.92 Android fill + `overflow:'hidden'` policy, not reintroduce translucent Android fills.

---

## Open Questions for SPEC

1. **Selection mechanics ownership:** per-tab local state vs a shared `useDraftMultiSelect` hook + shared sticky-bar component? (Recommendation leans shared, see gap section — but SPEC decides.)
2. **Experiences with no Drafts filter:** does selection mode filter to `status==='draft'` rows only (long-press allowed only on draft rows), or do we add a Drafts concept to the experiences tab? And what happens for `creative_and_arts`/default brands that currently show no list?
3. **Batch RPC result shape:** atomic-all-or-nothing vs per-row outcome array. (No-silent-failure pushes toward per-row outcomes so partial failure is surfaceable.)
4. **Mixed local+server events selection:** confirm the split (local → Zustand `deleteDraft`; server → RPC + Zustand removal + RQ invalidate) and the single confirm/toast copy that covers both.
5. **Counts invalidation:** does `useBrandOfferingCounts` (and any Hub To-Do count) need invalidation after a batch so the empty-state/To-Do rows update?
6. **Trip authz tightening:** is converging trip-draft delete onto the rank-checked batch RPC (away from RLS-only client UPDATE) in-scope, or strictly additive (batch RPC for the bulk path, single path unchanged)?
7. **Long-press affordance discoverability:** Seth said long-press to enter mode — is there also an explicit "Select" entry point (e.g. in an overflow), or is long-press the sole entry? (Discoverability vs scope.)
8. **Confirm copy + count:** the sticky bar "Delete (N)" + the one confirm dialog wording (reuse `ConfirmDialog` `destructive` variant as the events single-delete does at events.tsx:705).

---

## Summary

ORCH-1123 adds long-press multi-select + bulk soft-delete for DRAFT offerings across the three business-app Hub tabs, and the codebase is unusually well-positioned for a clean, single-owner solution because all three offering types are rows in one `public.events` table and the existing `business_discard_event_draft(p_event_id)` RPC is already `event_type`-agnostic (it discards any `status='draft'` row, rank-checked at `event_manager`) — so SPEC should converge on ONE batch RPC (`business_discard_offering_drafts(p_event_ids uuid[])`, migration version > `20260926000000`) that replicates that RPC's guards per row and returns a per-row outcome to satisfy no-silent-failure. The hard parts are NOT the database but the UI divergence and the events Zustand trap: the three tabs share neither a row component (events=`EventListCard`, trips=`TripListCard`, experiences=`OfferingListCard` via adapter) nor a data source (events=Zustand `useDraftsForBrand` carrying local-only `d_*` drafts; trips/experiences=React Query), experiences has no Drafts filter and a category-gated list shell, experiences has NO existing delete path at all (net-new), trips currently delete via an RLS-only client UPDATE rather than a rank-checked RPC, and a mixed events selection can span local-only (Zustand-only delete) and server (RPC + Zustand + RQ invalidate) drafts — all of which the multi-select layer and cache-invalidation map must absorb. No reusable list-row selection/checkbox primitive exists (only the Ari `MultiSelectPrompt` as a visual reference), and long-press is currently unwired everywhere, so the dead-tap and no-silent-failure invariants demand device-level runtime proof at TEST; this investigation could not boot a sim or reach a business login session, so all runtime claims are explicitly capped at "suspected."

**Artifact:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1123_HUB_MULTISELECT_DRAFT_DELETE.md`
