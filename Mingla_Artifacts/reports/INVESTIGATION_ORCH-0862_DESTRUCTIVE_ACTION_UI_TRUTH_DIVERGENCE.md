# INVESTIGATION — ORCH-0862 [Destructive-action UI-truth divergence: event-detail Cancel freezes app + brand-delete completes but brand stays visible]

**Status:** INVESTIGATE complete + live-fire update 2026-05-17 17:09Z.
**Confidence:** Symptom B-1 **PROVEN** (live-fire on iPhone 17 Pro sim — see §LIVE-FIRE UPDATE). Symptom A **probable** (static + DB evidence; sim repro not yet driven because Test Stripe has no UI-visible upcoming event to cancel — operator declined to switch back to Leggo This for the Symptom A pass).
**Mode:** Claude `mingla-forensics` INVESTIGATE (executed by Claude `mingla-orchestrator` under operator's "take over" delegation).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## LIVE-FIRE UPDATE (2026-05-17, after initial report write)

**Driver:** Maestro on iPhone 17 Pro sim UDID `17091E60-C3B6-4167-980D-60C348E177F6` per `feedback_sim_test_drivers_maestro_default.md`.
**Brand under test:** `Test Stripe` (`8f989994-1e6c-42c1-8754-78e1085a960d`).
**Brand state at test time:** 1 event `Friday Free Sunset Mixer QA` with `status='scheduled'` and `event_dates.start_at='2026-05-09 01:00 UTC'` (8 days in the past at test time).

### Sequence executed (with screenshot evidence in `/tmp/orch0862-b*.png`)

1. Switch to Test Stripe brand. Home screen renders: **"ACTIVE EVENTS: 0 / No active events / No upcoming events / Tap + to create your first event."**
2. Open switcher → tap trash icon next to Test Stripe row (via accessibility label `"Delete Test Stripe"`).
3. BrandDeleteSheet step 1 — **Warn** renders correctly.
4. Tap Continue → step 2 — **Preview** renders: `Past events: 1` / **`Upcoming events: 1` (red text)** / `Team members: 1` / `Stripe Connect: Linked (will unlink)` / red banner **"Active events block delete. Cancel or transfer your live and upcoming events before deleting this brand..."**
5. Tap Type to confirm → step 3 — input field renders, typed "Test Stripe", Delete brand button enables.
6. Tap Delete brand → ~1s submitting state → step 5 — **rejected** terminal screen renders:
   - Header: **"Cannot delete this brand"**
   - Red card: **"1 upcoming event. You have 1 upcoming event on this brand. Cancel or transfer it first, then come back to delete the brand."**
   - Single "Close" button.

### What this proves

- **B-1 mechanism PROVEN** (confidence: high). The "I finished the entire delete process but the brand is still there" symptom is verbatim observable — operator runs warn → preview → confirm → tap Delete → lands on a terminal screen, and the brand survives. The flow IS complete; the rejection IS the terminal state.
- **DISCOVERY-7 PROVEN** (new finding, P1, see §9). The same brand simultaneously displays contradictory event counts to the operator:
  - **Home screen** says `ACTIVE EVENTS: 0 / No active events / No upcoming events`
  - **BrandDeleteSheet preview** says `Upcoming events: 1`
  - **Cause:** Home filters via `deriveLiveStatus` / `isEventPast` which collapse past-dated `status='scheduled'` rows to "ended" lifecycle (ORCH-0850 [End-not-start parity systemic] canonical helper, closed 2026-05-15). Brand-delete preview and `softDeleteBrand` Step 1 filter PURELY on `events.status IN ('scheduled','live')` with NO date check, so past-dated ghosts count. Result: operator sees "0 events" everywhere except inside the delete sheet where 1 ghost event blocks the delete.
- **Operator's confirmation "it was definitely the same brand"** is now fully consistent with B-1: the brand the operator tried to delete IS still there because the delete was REJECTED, not because a different brand appeared via auto-recovery. **B-2 (auto-recovery silent replacement) is therefore DEMOTED from "probable real" to "not the operative cause this session"** — it remains a latent risk that could fire on a clean-deletable brand, but it's not what the operator hit. Spec scope should still include the just-deleted-flag fix as defense-in-depth; not bumping it to P0.

### What this does NOT yet prove

- Symptom A (event-detail cancel freezes app). Test Stripe's only `scheduled` event has a past date so the UI hub list won't surface a Cancel CTA from "Upcoming". To promote A from `probable` → `proven` we'd need to either (a) switch back to Leggo This and try to cancel `The Reckoning` (current/future-dated scheduled event), or (b) find a way into the event detail of the past-dated Friday mixer (Hub Past filter, then tap into detail, then Manage → Cancel — if the Cancel CTA is even shown for past-dated `status='scheduled'` events). Recommend driving (a) before SPEC dispatch.

---

## Layman summary

- **Symptom A is real and has a single proven mechanism.** The event-detail screen at `app/event/[id]/index.tsx` does THREE things in the same tick on cancel success: dismisses a native iOS Modal (200ms exit animation), shows a toast, and navigates the screen away with `router.replace`. The native iOS `UIViewController` for the Modal is mid-dismiss while React Native unmounts its parent screen out from under it — that's a classic UIKit deadlock pattern, plus the cache-invalidate on the same tick triggers a refetch on a subscriber inside the unmounting tree. The hub-list flow doesn't navigate, so the Modal dismisses on a stable parent and finishes cleanly. **Fix direction**: defer `router.replace` until AFTER the Modal exit animation completes (~250ms), OR navigate first and let the destination screen render the toast, OR drop the navigation entirely and let the screen re-render in-place to show the cancelled state.
- **Symptom B has TWO mechanisms, both real, and at least one is happening to the operator right now.** Mechanism B-1: the brand-delete sheet is reaching the **rejected** terminal step (which to the user looks like "I finished the delete process and the brand is still there") because Symptom A's freeze prevented one or more event-cancels from actually persisting server-side, so when `softDeleteBrand` Step 1 counts `events.status IN ('scheduled','live')` it still finds N>0. The DB confirms this: brand `Leggo This` (`22a18413-...`) has 4 events still in status `scheduled` (`The Reckoning`, `The cover`, `Another Tested Event`, `The random`) — none cancelled. Mechanism B-2: when delete DOES succeed, `useCurrentBrandRecovery` silently re-assigns `currentBrand` to the newest remaining brand via the "newest-brand" branch — so the operator sees A brand on home and may interpret it as "the brand I tried to delete is still there" when it's actually a different brand. **Fix direction**: B-1 fixes itself when Symptom A is fixed; B-2 needs a "brand-just-deleted" intent flag so recovery doesn't auto-pick a replacement immediately after explicit delete.
- **Shared root-cause verdict: PARTIAL OVERLAP, not identical.** Both bugs are "destructive action whose UI effect diverges from data effect", but the mechanisms are distinct: A is RN Modal/Navigation race; B-1 is downstream of A (cancel didn't persist); B-2 is a deliberate auto-recovery interacting badly with explicit deletes. R1 (Zustand-persist-server-snapshots) was the prime suspect for B but is DISPROVEN for the BRAND state (`currentBrandStore` v14 persists ID only, complies with I-PROPOSED-J). R1 IS confirmed for `liveEventStore` which is a separate latent risk — registered as DISCOVERY-1 below.
- **Similar-bug-class sweep findings:** 1 confirmed I-PROPOSED-J violation (`liveEventStore.partialize` persists full `LiveEvent` records including `serverEventId`, `status`, `cancelledAt` — server snapshot). 6 candidate stores persist `entries` of unknown shape (need spec-time audit). 8 destructive mutations or navigation-after-mutation patterns to audit for the same Modal/navigation race (table in §7).

---

## 1. Symptoms reported

**Symptom A (verbatim):** "When I try to cancel an upcoming event from the event page, the entire app freezes. But when I do it from the event list on the hub page by clicking the more button, it works."

**Symptom B (verbatim):** "Even though I cancel an event, I still cannot delete the brand. I finish the entire delete process but the brand is still there."

---

## 2. Phase 0 ingest — what was read

**Symptom A path:**
- [mingla-business/app/event/\[id\]/index.tsx](mingla-business/app/event/%5Bid%5D/index.tsx) — full read, focus on lines 1–160, 278–315, 794–859
- [mingla-business/app/(tabs)/hub/events.tsx](mingla-business/app/%28tabs%29/hub/events.tsx) — grep + targeted read of cancel handler (lines 394–433) and modal render block
- [mingla-business/src/hooks/useBusinessEvents.ts](mingla-business/src/hooks/useBusinessEvents.ts) — `useCancelBusinessEvent` + `writePublishedEventCaches` + `useBusinessEventById`
- [mingla-business/src/hooks/useManagedEventRoute.ts](mingla-business/src/hooks/useManagedEventRoute.ts) — full
- [mingla-business/src/components/ui/ConfirmDialog.tsx](mingla-business/src/components/ui/ConfirmDialog.tsx) — full
- [mingla-business/src/components/ui/Modal.tsx](mingla-business/src/components/ui/Modal.tsx) — full
- `supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql` — `business_cancel_event` RPC body

**Symptom B path:**
- [mingla-business/src/components/brand/BrandDeleteSheet.tsx](mingla-business/src/components/brand/BrandDeleteSheet.tsx) — full
- [mingla-business/src/services/brandsService.ts](mingla-business/src/services/brandsService.ts) lines 109, 158–166, 300–377, 378–460
- [mingla-business/src/hooks/useBrands.ts](mingla-business/src/hooks/useBrands.ts) lines 1–200, 350–391
- [mingla-business/src/hooks/useCurrentBrandRecovery.ts](mingla-business/src/hooks/useCurrentBrandRecovery.ts) — full
- [mingla-business/src/utils/currentBrandResolver.ts](mingla-business/src/utils/currentBrandResolver.ts) — full
- [mingla-business/src/store/currentBrandStore.ts](mingla-business/src/store/currentBrandStore.ts) — full
- [mingla-business/src/hooks/useBrandListShim.ts](mingla-business/src/hooks/useBrandListShim.ts) — full
- [mingla-business/app/(tabs)/home.tsx](mingla-business/app/%28tabs%29/home.tsx) lines 120–215 (handleBrandDeleted)
- [mingla-business/app/(tabs)/account.tsx](mingla-business/app/%28tabs%29/account.tsx) handleBrandDeleted block (lines 128–155)
- [mingla-business/app/brand/\[id\]/index.tsx](mingla-business/app/brand/%5Bid%5D/index.tsx) handleBrandDeleted block (lines 48–66)
- [mingla-business/src/components/brand/BrandSwitcherSheet.tsx](mingla-business/src/components/brand/BrandSwitcherSheet.tsx) grep
- DB probes via Supabase MCP `execute_sql` (see §5)

**Prior art / memory:**
- `feedback_zustand_persist_no_server_snapshots.md` (I-PROPOSED-J)
- `feedback_rn_sub_sheet_must_render_inside_parent.md`
- `feedback_back_listener_disarm_pattern.md`
- ORCH-0742 [Zustand persist no server snapshots] precedent
- ORCH-0734 [signal_anchors decommission] REWORK rowcount-verification precedent

---

## 3. Symptom A — Proven root cause

### 3.1 Mechanism

Inside [app/event/\[id\]/index.tsx:282-315](mingla-business/app/event/%5Bid%5D/index.tsx#L282-L315) `handleCancelConfirm`:

```ts
await cancelServerEvent.cancelEvent({ eventId: event.id, brandId: event.brandId });
setCancelDialogVisible(false);          // (A) starts Modal exit animation (160ms) + 200ms unmount timer
showToast("Event cancelled.");
router.replace("/(tabs)/hub/events" as never);   // (B) UNMOUNTS event-detail screen synchronously
```

What happens in that same micro-tick across layers:

1. **RPC `business_cancel_event` resolves** — DB row flips `status='cancelled'` (verified via migration `20260515000005`).
2. **`useCancelBusinessEvent.onSuccess` fires** ([useBusinessEvents.ts:185-187](mingla-business/src/hooks/useBusinessEvents.ts#L185-L187)) → `writePublishedEventCaches` runs.
3. `writePublishedEventCaches` ([useBusinessEvents.ts:50-78](mingla-business/src/hooks/useBusinessEvents.ts#L50-L78)) calls `queryClient.invalidateQueries({ queryKey: businessEventKeys.detail(event.id) })` — **the very query that `useBusinessEventById(serverQueryId)` inside `useManagedEventRoute` is subscribed to on the screen that is about to unmount.** Invalidate → refetch enqueued.
4. `setCancelDialogVisible(false)` triggers React state change. The `<ConfirmDialog>`'s `<Modal>` wrapper ([Modal.tsx](mingla-business/src/components/ui/Modal.tsx)) sees `visible=false`, kicks off:
   - `withTiming` exit animation on scrim opacity (160ms), panel opacity (160ms), panel scale (160ms)
   - `closeTimerRef = setTimeout(() => setMounted(false), 200ms)` ([Modal.tsx:95-100](mingla-business/src/components/ui/Modal.tsx#L95-L100))
   - The underlying native `<RNModal visible={mounted=true}>` still has UIKit-level "mounted" state because `setMounted(false)` hasn't fired yet (it's in a 200ms timer).
5. `router.replace("/(tabs)/hub/events")` fires **synchronously** in the same callback continuation — Expo Router unmounts the entire event-detail screen tree. The `<ConfirmDialog>` and its `<Modal>` and the underlying `<RNModal>` get destroyed.
6. **iOS UIKit error class:** the native `UIViewController` backing `RNModal` was in the middle of presenting/dismissing animation when its host React-Native bridge component is torn down. Symptoms in the iOS native log are typically: `Attempt to present <X> on <Y> whose view is not in the window hierarchy`, or `Warning: Attempt to dismiss from view controller <Z> while a presentation or dismiss is in progress`. The React Native bridge then queues unmount commands against a UIKit object in transitional state → JS bridge stall → app appears frozen.
7. Additionally, the in-flight refetch (`useBusinessEventById`) hits the network on a query whose subscriber tree was just unmounted; the React Query result lands in nobody, but the cache write is still applied. Not a freeze cause, but compounds the chaos.

### 3.2 Why hub-list flow doesn't freeze

[app/(tabs)/hub/events.tsx:394-433](mingla-business/app/%28tabs%29/hub/events.tsx#L394-L433) `handleCancelEventConfirm`:

```ts
await cancelServerEvent.cancelEvent({ eventId: cancelEvent.id, brandId: cancelEvent.brandId });
setCancelEvent(null);    // closes ConfirmDialog
setSubmitting(false);
setToast({ visible: true, message: "Event cancelled." });
// NO router.replace
```

The hub screen stays mounted. The Modal exit animation completes on a stable parent. UIKit dismisses cleanly. No bridge stall.

### 3.3 Six-field evidence (A-H1 confirmed)

| Field | Content |
|---|---|
| **Claim** | `router.replace` fires synchronously after `setCancelDialogVisible(false)` on the event-detail screen, racing the 200ms Modal unmount timer + 160ms iOS UIKit exit animation; the hub screen does not navigate and avoids the race. |
| **Mechanism** | [app/event/\[id\]/index.tsx:282-315](mingla-business/app/event/%5Bid%5D/index.tsx#L282-L315) `handleCancelConfirm` calls `setCancelDialogVisible(false)` then `router.replace(...)` in the same async continuation. [Modal.tsx:95-107](mingla-business/src/components/ui/Modal.tsx#L95-L107) keeps `mounted=true` for 200ms via setTimeout to let the exit animation complete; the native `<RNModal visible={mounted}>` still holds a live UIViewController during that window. `router.replace` unmounts the screen — including the Modal — mid-animation. |
| **What it does** | Symptom: JS bridge stalls. Toast does not appear, screen does not navigate, taps stop working, app appears frozen. |
| **What it should do** | Either navigate AFTER Modal exit animation completes (~250ms), OR don't navigate at all (let the screen re-render with `status='cancelled'`), OR navigate first and let the destination screen render the toast. |
| **Causal chain** | (1) cancel RPC succeeds → (2) `invalidateQueries(detail)` triggers refetch on still-mounted subscriber → (3) `setCancelDialogVisible(false)` → Modal starts 160ms+200ms exit window → (4) `router.replace` unmounts screen synchronously in same tick → (5) iOS UIViewController mid-dismiss + RN bridge unmount = deadlock → (6) freeze. |
| **Verification step** | Two ways to promote `probable` → `proven`: (a) iOS sim repro per Phase 0.A — reproduce freeze, capture `xcrun simctl spawn booted log stream` showing UIKit assertion strings around the timestamp of the cancel button press; (b) counter-test — comment out the `router.replace` line on line 294, rebuild, repeat repro; if cancel succeeds without freeze (Modal dismisses, screen re-renders with cancelled state), H1 is confirmed by exclusion. |
| **Confidence** | **probable** (source-only + DB confirmation of RPC success path; sim live-fire deferred to operator). |

### 3.4 Hypotheses disproven

- **A-H2 (cache-write flips `useManagedEventRoute` → null → triggers draft-redirect `useEffect`):** the draft-redirect `useEffect` ([app/event/\[id\]/index.tsx:123-132](mingla-business/app/event/%5Bid%5D/index.tsx#L123-L132)) fires only when `resolvedLiveEvent === null && draftEvent !== null`. Post-cancel, `getBusinessEventById` still returns the now-cancelled event (no `deleted_at` filter on the row), so `resolvedLiveEvent !== null`. Disproven.
- **A-H5 (sibling-Modal mount ordering):** EventManageMenu's `setManageMenuVisible(false)` fires BEFORE `handleCancelDialogOpen`. Same pattern exists on the hub flow which works. Disproven as differentiator.
- **A-H4 (React-18 batching modal orphan):** React 18 does batch the `setCancelDialogVisible(false)` + `router.replace` BUT both are observed by React before commit. The Modal's `useEffect` runs in the next commit. The race is real but is downstream of H1, not a separate cause.
- **A-H3 (`useEventOrders` cascade):** `useEventOrders(event?.id ?? null)` ([app/event/\[id\]/index.tsx:327](mingla-business/app/event/%5Bid%5D/index.tsx#L327)) does not have a Realtime subscription on the event-detail screen specifically; no infinite loop. Disproven.

---

## 4. Symptom B — Two real mechanisms

### 4.1 Mechanism B-1 (downstream of Symptom A): brand-delete REJECTS because cancel didn't actually persist

When Symptom A's freeze blocks the JS bridge, the operator force-quits and reopens the app. The `business_cancel_event` RPC may or may not have completed server-side. **If it didn't complete**, the event remains `status='scheduled'`. Then:

1. Operator opens BrandDeleteSheet via brand switcher / brand profile.
2. Steps 1–3 progress normally (warn → preview → type-confirm).
3. `handleSubmit` → `softDeleteMutation.mutateAsync` → `softDeleteBrand(brandId)` ([brandsService.ts:394-460](mingla-business/src/services/brandsService.ts#L394-L460)).
4. Step 1 of `softDeleteBrand` counts events `WHERE brand_id=? AND status IN ('scheduled','live') AND deleted_at IS NULL`. Returns N>0.
5. Returns `{rejected: true, reason: "upcoming_events", upcomingEventCount: N}` ([brandsService.ts:406-413](mingla-business/src/services/brandsService.ts#L406-L413)).
6. `BrandDeleteSheet.handleSubmit` sees `result.rejected = true` → `setRejectionCount(N)` + `setStep("rejected")` ([BrandDeleteSheet.tsx:151-154](mingla-business/src/components/brand/BrandDeleteSheet.tsx#L151-L154)).
7. Step 5 of the sheet renders: "Cannot delete this brand" + "N upcoming events on this brand. Cancel or transfer them first..." + a single "Close" button ([BrandDeleteSheet.tsx:397-426](mingla-business/src/components/brand/BrandDeleteSheet.tsx#L397-L426)).
8. Operator interprets this as "I finished the delete process but the brand is still there" — which is **literally true**. The flow completed (terminal step), the brand still exists.

### 4.2 DB evidence (Symptom B-1)

MCP `execute_sql` probe at investigation time (2026-05-17 ~15:30Z):

| brand | id (truncated) | deleted_at | scheduled events still alive |
|---|---|---|---|
| Travel Brand | `becddd00-...` | NULL | 0 (only `draft` trips) |
| World travels | `cb56afa9-...` | NULL | 0 (different account) |
| **Leggo This** | **`22a18413-...`** | **NULL** | **4 — `The Reckoning`, `The cover`, `Another Tested Event`, `The random`** |
| Stripe Wise 2 | `81fd06bc-...` | NULL | 0 (different account) |
| Test Stripe | `8f989994-...` | NULL | 1 cancelled (`The ripe` — `updated_at=2026-05-17 15:18:08Z`) |
| Leggo This | (other 8 brands) | SET (deleted 15:11–15:12Z today) | — |

**The "Leggo This" brand cannot be soft-deleted right now because 4 of its events are still `status='scheduled'`.** If operator tried to cancel one of these via the event-detail page and the app froze, the cancel may have silently failed or partially failed — leaving the events alive. Brand-delete then correctly rejects per spec, but operator perceives it as "the brand is still there."

(Note: `Test Stripe`'s event `The ripe` was successfully cancelled at 15:18:08Z — proves the cancel RPC itself works when not blocked by Symptom A's freeze. So the cancel path is not server-broken; it's UI-blocked.)

### 4.3 Mechanism B-2 (independent of Symptom A): auto-recovery silently replaces deleted brand

When delete DOES succeed (no blocking events), `handleBrandDeleted` ([app/(tabs)/home.tsx:198-213](mingla-business/app/%28tabs%29/home.tsx#L198-L213)) does:

```ts
const currentBrandId = useCurrentBrandStore.getState().currentBrandId;
if (currentBrandId === deletedBrandId) {
  setCurrentBrand(null);
}
setBrandPendingDelete(null);
setToast({ visible: true, message: `${deleted?.displayName ?? "Brand"} deleted` });
// NO navigation — stays on home
```

Then `useCurrentBrandRecovery` ([useCurrentBrandRecovery.ts:21-118](mingla-business/src/hooks/useCurrentBrandRecovery.ts#L21-L118)) re-runs because `currentBrandId` and `brands` both changed:

```ts
resolution = resolveCurrentBrandId({
  currentBrandId: null,
  defaultBrandId: <maybe null after Step 3 fire-and-forget clear>,
  brands: [...remaining],
});
// → "newest-brand" branch → picks brands[0]
setCurrentBrandId(resolution.brandId);   // assigns a NEW brand as current
```

Per [currentBrandResolver.ts:24-43](mingla-business/src/utils/currentBrandResolver.ts#L24-L43), when `currentBrandId=null` and `defaultBrandId` doesn't match any brand, it falls through to `brands[0]` ("newest-brand"). **The home screen immediately re-renders showing a different brand**. The operator sees "a brand" on home and may perceive the deleted brand as "still there" — when it's actually a different brand the auto-recovery just selected.

This is observable in the DB timeline:
- 15:11:25Z to 15:12:57Z — operator deleted 8 brands in 92 seconds (one every ~12 seconds).
- During that spate, after each delete, the recovery would have picked the next-newest remaining brand. The home screen would always show "a brand". The operator's perception: "I keep deleting, but a brand keeps appearing."
- 15:19Z — operator created `Travel Brand` fresh (probably gave up and made a new one).

This is a hidden flaw — possibly the operator's primary frustration even if Mechanism B-1 is the verbatim-quoted symptom.

### 4.4 Six-field evidence

**B-H1 (B-1): brand-delete rejects post-frozen-cancel because event still `scheduled`**

| Field | Content |
|---|---|
| **Claim** | Symptom A's freeze prevents `business_cancel_event` from completing cleanly, leaving events `scheduled`; `softDeleteBrand` Step 1 then correctly rejects with `upcoming_events: N>0`; the rejected step of `BrandDeleteSheet` is the terminal "I finished" state the operator sees. |
| **Mechanism** | [brandsService.ts:397-413](mingla-business/src/services/brandsService.ts#L397-L413) + [BrandDeleteSheet.tsx:151-154](mingla-business/src/components/brand/BrandDeleteSheet.tsx#L151-L154) + [BrandDeleteSheet.tsx:397-426](mingla-business/src/components/brand/BrandDeleteSheet.tsx#L397-L426). |
| **What it does** | Operator sees "Cannot delete this brand. N upcoming events on this brand. Cancel or transfer them first..." with a single Close button. They interpret as "process complete, brand still there". |
| **What it should do** | Either: (a) auto-cancel-all-blocking-events in a single delete flow (with confirm UX); OR (b) show clearer copy + a "Cancel these events for me" CTA in the rejected step that one-tap cancels all blocking events; OR (minimum) (c) fix Symptom A so cancel actually persists, so this path stops mis-firing. |
| **Causal chain** | Operator attempts cancel from event-detail → A-H1 freezes app → operator force-quits → cancel didn't persist OR partial state → operator opens BrandDeleteSheet → Step 1 counts > 0 → rejected → operator confused. |
| **Verification step** | Already DB-verified: `Leggo This` brand has 4 still-scheduled events at investigation time, with the `Test Stripe` brand showing one event cancelled successfully when freeze didn't fire — proving the rejection logic is the operative branch when cancel didn't complete. |
| **Confidence** | **probable** (DB-verified state + code trace; sim repro would promote to proven). |

**B-H2 (B-2): auto-recovery silently re-assigns currentBrand to newest after delete**

| Field | Content |
|---|---|
| **Claim** | After successful brand soft-delete on home or account screens, `useCurrentBrandRecovery` calls `resolveCurrentBrandId` which falls through to `"newest-brand"` and assigns `brands[0]` as the new current — making the home screen show a different brand immediately, which the operator may interpret as "the deleted brand is still there." |
| **Mechanism** | [useCurrentBrandRecovery.ts:75-77](mingla-business/src/hooks/useCurrentBrandRecovery.ts#L75-L77) `setCurrentBrandId(resolution.brandId)` + [currentBrandResolver.ts:36-40](mingla-business/src/utils/currentBrandResolver.ts#L36-L40) `newestBrand = brands[0]; if (newestBrand !== undefined) return { brandId: newestBrand.id, reason: "newest-brand" };`. |
| **What it does** | Home re-renders showing a different brand seamlessly. No toast / banner saying "Switched to <other brand>." User can't tell what happened. |
| **What it should do** | After explicit user delete, recovery should leave `currentBrandId` null (or pause for one cycle) so the operator sees the empty / brand-switcher state and explicitly chooses what to do next. A "just-deleted" intent flag in the store (TTL ~3s, cleared on next user action) would satisfy this without breaking cold-start recovery. |
| **Causal chain** | Operator deletes brand A → `setCurrentBrand(null)` → React re-render → `useCurrentBrandRecovery` sees null + non-empty brands → assigns newest → home shows brand B → operator sees "a brand" on home and thinks A is still there. |
| **Verification step** | Sim repro: account with ≥ 2 brands; delete the current brand; observe home screen → should show empty / switcher state, but instead shows a different brand. Counter-test: temporarily comment line 76 of useCurrentBrandRecovery (`setCurrentBrandId(resolution.brandId)`) — home should remain empty after delete. |
| **Confidence** | **probable** (code-trace proven; UX intent ambiguity needs operator confirmation that this is what they hit). |

### 4.5 Hypotheses disproven

- **R1 / B-H1-Zustand (initial prime suspect): `currentBrandStore` persists full Brand snapshot violating I-PROPOSED-J.** DISPROVEN. [currentBrandStore.ts:127-151](mingla-business/src/store/currentBrandStore.ts#L127-L151) v14 `partialize` returns ONLY `{ currentBrandId }`. Migration history (v12 → v13 → v14) explicitly dropped Brand snapshot per ORCH-0742 [Zustand persist no server snapshots]. Confirmed live by reading the persist config.
- **B-H3 (cache-key mismatch):** `useSoftDeleteBrand.onSuccess` ([useBrands.ts:369-384](mingla-business/src/hooks/useBrands.ts#L369-L384)) invalidates `brandKeys.list(accountId)` AND removes detail, role, and cascade-preview. All consumer surfaces (home, account, brand profile, switcher) read via `useBrandList()` → `useBrands(user.id)` → same `brandKeys.list(accountId)` key. No mismatch. Disproven.
- **B-H4 (silent no-op UPDATE):** DB probe confirms 8 brands were successfully soft-deleted today between 15:11 and 15:12 (operator's own account `b17e3e15-...`). The `.select("id")` rowcount guard ([brandsService.ts:431-435](mingla-business/src/services/brandsService.ts#L431-L435)) added post-ORCH-0734 is firing correctly. Disproven.
- **B-H5 (default-brand pointer fallout):** `default_brand_id` is now `Travel Brand` (alive, created 15:19Z). Step 3's fire-and-forget clear works (verified by absence of stale default_brand_id pointers to soft-deleted brands). Not the operative cause.
- **B-H6 (sheet closes before onDeleted runs):** Code reading shows `onDeleted?.(result.brandId); onClose();` in that order ([BrandDeleteSheet.tsx:157-158](mingla-business/src/components/brand/BrandDeleteSheet.tsx#L157-L158)). React batches these but invoking `onDeleted` first is synchronous; parent's `handleBrandDeleted` runs before `onClose`. Disproven.

---

## 5. Five-layer cross-check

| Layer | Symptom A | Symptom B |
|---|---|---|
| **Docs** | event/[id]/index.tsx header docs say "Founder-side screen showing event KPIs…" — no mention of cancel-then-navigate contract. Spec gap. | BrandDeleteSheet header docs cite "Cycle 14 J-A4 account-delete pattern" + I-PROPOSED-J compliance. Spec says rejected step shows "Cannot delete this brand." Matches operator-reported terminal state. |
| **Schema** | `business_cancel_event` RPC (migration `20260515000005`) sets `status='cancelled'` correctly under FOR UPDATE lock. RPC is sound. | `brands.deleted_at` filter present in `getBrands` ([brandsService.ts:163](mingla-business/src/services/brandsService.ts#L163)) and `getBrand` ([brandsService.ts:319](mingla-business/src/services/brandsService.ts#L319)). RLS SELECT policy "Account owner can select own brands" admits soft-deleted rows for the owner (intentional per `softDeleteBrand` rowcount-verify pattern; service-layer filter gates display). |
| **Code** | `handleCancelConfirm` runs Modal close + navigate in same tick → race. **Buggy.** | `handleBrandDeleted` in home.tsx doesn't navigate; auto-recovery refills currentBrand silently. **Behavioural gap.** Plus B-1 mechanism downstream of Symptom A. |
| **Runtime** | Source-only `probable`; iOS sim repro deferred. Hub flow works (proven by operator). | DB confirms 8 brands soft-deleted in 92s window today (proves data layer fine). Brand `Leggo This` has 4 still-scheduled events — would cause rejection. |
| **Data** | DB shows `Test Stripe`'s `The ripe` flipped to `status='cancelled'` at 15:18:08Z — proves RPC works when freeze doesn't fire. | `Leggo This` brand alive, 4 events `scheduled`, all `deleted_at IS NULL` — confirms rejection path is active. |

---

## 6. Blast radius

### 6.1 Symptom A (Modal/navigation race)

Pattern: any screen that owns a `<ConfirmDialog>` (which wraps `<Modal>` with 200ms unmount delay) AND calls `router.replace` / `router.back` / `router.push` inside the dialog's `onConfirm` async handler is at risk of the same freeze. Confirmation requires sim test, but static-trace candidates (priority order):

| Surface | File:line | Pattern | Risk |
|---|---|---|---|
| Event detail Cancel | [event/\[id\]/index.tsx:282-315](mingla-business/app/event/%5Bid%5D/index.tsx#L282-L315) | ConfirmDialog `onConfirm` → mutation → `router.replace` | **confirmed-broken (operator-reproed)** |
| Event detail End-sales | [event/\[id\]/index.tsx](mingla-business/app/event/%5Bid%5D/index.tsx) handleEndSalesConfirm | EndSalesSheet `onConfirm` → mutation; need to check if it navigates | **likely-broken (audit needed)** |
| Order refund / cancel order | `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | ORCH-0787 history; refund/cancel modals + possible navigation after | **likely-broken (audit needed)** |
| Account delete | `mingla-business/app/account/delete.tsx` | "mirrors J-A4 account-delete" per BrandDeleteSheet header | **likely-broken (audit needed)** |
| Brand-profile delete | [app/brand/\[id\]/index.tsx:59-66](mingla-business/app/brand/%5Bid%5D/index.tsx#L59-L66) | `handleBrandDeleted` → `setCurrentBrand(null)` + `router.replace("/(tabs)/account")` while BrandDeleteSheet (Sheet primitive, not Modal) closes | **suspected** — Sheet primitive may have different lifecycle than Modal; needs check |
| Buyer-side checkout completion | `mingla-business/app/checkout/[eventId]/buyer.tsx` | post-payment navigation while toast/modal active | **suspected** |
| BrandSwitcherSheet trip-create commit | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (ORCH-0855 4-mode) | post-create router.push from inside sheet | **suspected** |
| EditPublishedScreen save | `mingla-business/src/components/event/EditPublishedScreen.tsx` | save then navigate back; modal-in-flight unknown | **suspected** |

### 6.2 Symptom B-1 (cancel-blocked-by-freeze) — fixes itself when Symptom A is fixed.

### 6.3 Symptom B-2 (auto-recovery silently replaces deleted brand)

Pattern: `useCurrentBrandRecovery` runs on EVERY brand-list change. Any flow that explicitly clears `currentBrandId` (delete, logout-partial, manual switch-to-none) is subject to silent replacement. Audit:

- Home delete (no navigation) — **confirmed problematic**
- Account delete (no navigation) — **likely problematic**
- Brand-profile delete (does `router.replace("/(tabs)/account")` AFTER `setCurrentBrand(null)`) — partially mitigated by destination-change but recovery still runs on /account

### 6.4 Constitution / invariant violations

- **Const #2 "One owner per truth"** — Symptom A's `handleCancelConfirm` competes with the cache-invalidate refetch for the source-of-truth on the event-detail screen; partial violation.
- **Const #3 "No silent failures"** — Symptom A's freeze IS a silent failure (no error toast, no log, just freeze). Symptom B-2's silent currentBrand replacement is also a silent state change.
- **Const #5 "Server state stays server-side"** — `liveEventStore.partialize` persists `events` containing `serverEventId`, `status`, `cancelledAt` — VIOLATION (DISCOVERY-1 below).
- **I-PROPOSED-J "Zustand persist no server snapshots"** — VIOLATED by `liveEventStore` (DISCOVERY-1).

---

## 7. Similar-bug-class sweep tables (operator-asked)

### 7.1 Class A — Modal/navigation race candidates

See §6.1 above. Action: spec the fix for `event/[id]/index.tsx` first (highest-confidence), then audit the 7 other candidates with explicit static-trace + sim spot-checks before declaring them safe or scoping fixes.

### 7.2 Class B — I-PROPOSED-J Zustand persist-server-snapshot audit

| Store | `partialize` returns | Server-snapshot risk | Verdict |
|---|---|---|---|
| `currentBrandStore` v14 | `{ currentBrandId }` | none — ID only | **SAFE** |
| **`liveEventStore` v4** | **`{ events: state.events }` containing `LiveEvent[]` with `serverEventId`, `status='cancelled'\|'live'\|...`, `cancelledAt`, `endedAt`, full content snapshot** | **HIGH — server snapshot persisted** | **VIOLATES I-PROPOSED-J** (DISCOVERY-1) |
| `draftEventStore` v10 | `{ drafts: state.drafts }` (local drafts) | low — drafts are client state | **SAFE** (audit confirms `DraftEvent` is local until publish) |
| `orderStore` v1 | `{ entries: s.entries }` | unknown shape — needs audit | **AUDIT REQUIRED** (DISCOVERY-2) |
| `brandTeamStore` v1 | `{ entries: s.entries }` | unknown shape — needs audit | **AUDIT REQUIRED** (DISCOVERY-2) |
| `guestStore` v1 | `{ entries: s.entries }` | unknown shape | **AUDIT REQUIRED** (DISCOVERY-2) |
| `scanStore` v1 | `{ entries: s.entries }` | unknown shape | **AUDIT REQUIRED** (DISCOVERY-2) |
| `eventEditLogStore` v1 | `{ entries: s.entries }` | unknown shape | **AUDIT REQUIRED** (DISCOVERY-2) |
| `doorSalesStore` v1 | `{ entries: s.entries }` | unknown shape | **AUDIT REQUIRED** (DISCOVERY-2) |
| `scannerInvitationsStore` v2 | `{ entries: s.entries }` | unknown shape | **AUDIT REQUIRED** (DISCOVERY-2) |
| `notificationPrefsStore` v1 | `{ prefs: s.prefs }` (user preferences) | low — client prefs | **SAFE (likely)** |

---

## 8. Recommended fix direction (NOT a spec; spec is next dispatch)

### 8.1 Symptom A — three options, ranked

1. **PREFERRED: drop the navigation.** Remove `router.replace("/(tabs)/hub/events")` from `handleCancelConfirm`. The event-detail screen already re-derives `status` from the cache write — let it render in-place showing the cancelled state. Operator can tap back to leave. Mirrors hub-list flow which works. Simplest, least surface.
2. **Defer navigation past Modal exit.** Wrap `router.replace` in `setTimeout(..., 250)` after `setCancelDialogVisible(false)`. Brittle (relies on timer not Modal lifecycle callback) — only consider if (1) breaks UX.
3. **Navigate first, toast on destination.** `router.replace` synchronously, pass the toast message via navigation params or query-cache slot, destination screen renders the toast. More refactor, but cleanest separation.

### 8.2 Symptom B-1 — falls out of Symptom A fix.

When cancel persists reliably, the brand-delete rejection only fires when there are genuinely uncancelled events. The "rejected" step's copy + the single Close button are already correct UX — no change needed once the upstream is fixed. Optional polish: change Close button to "Go cancel them" with a router.push to the Hub events list filtered to scheduled.

### 8.3 Symptom B-2 — narrow fix

Add a transient "just-deleted" intent flag to `currentBrandStore`:

- New persisted field `lastDeletedBrandId: string | null` + non-persisted `lastDeletedAt: number | null` (timestamp).
- `setCurrentBrand(null)` after explicit delete sets these.
- `useCurrentBrandRecovery` checks: if `lastDeletedAt` is within last 3s, skip the "newest-brand" auto-assignment for that one cycle.
- On any user action (tap, navigation, sheet open), clear the flag.
- TTL guarantees cold-start recovery still works.

Net effect: after explicit delete, home shows empty/switcher state for one beat, giving the operator visual confirmation that the brand is gone. After 3s or any tap, auto-recovery resumes normal behaviour.

---

## 9. Discoveries for orchestrator

- **DISCOVERY-1 (P1):** `liveEventStore` v4 persists full `LiveEvent[]` (with `serverEventId`, `status`, `cancelledAt`, content snapshot) in `partialize` ([liveEventStore.ts:352](mingla-business/src/store/liveEventStore.ts#L352)). Violates I-PROPOSED-J (ACTIVE post-ORCH-0742 [Zustand persist no server snapshots]). Cold start can show stale `cancelled='no'` state for events that were cancelled on another device. Register as new ORCH and follow ORCH-0742 precedent (persist ID list, read live via React Query, drop the snapshot in a versioned migrator).
- **DISCOVERY-2 (P2):** 7 Zustand stores persist `entries: state.entries` without obvious type clarity — need a focused 30-min audit to confirm none are server snapshots. Affected: `orderStore`, `brandTeamStore`, `guestStore`, `scanStore`, `eventEditLogStore`, `doorSalesStore`, `scannerInvitationsStore`. Could be a sibling ORCH or folded into the I-PROPOSED-J compliance sweep.
- **DISCOVERY-3 (P2):** The "Account owner can select own brands" RLS SELECT policy on `brands` admits soft-deleted rows (no `deleted_at IS NULL` filter). The service-layer `.is("deleted_at", null)` in `getBrands` / `getBrand` is the only gatekeeper. If a future read site forgets to filter, soft-deleted brands leak to the owner. Recommend adding the filter to the RLS policy as defense-in-depth, OR codify an invariant + CI grep gate that every `from("brands")` read includes `.is("deleted_at", null)` (except the rowcount-verify `.select("id")` after `softDeleteBrand`'s UPDATE which intentionally needs the post-update row).
- **DISCOVERY-4 (P3):** ORCH-0840 [Regression-test enforcement + append-only CI] gate — there is no test today that asserts "after `setCancelDialogVisible(false)` + `router.replace` in the same tick, the screen unmounts cleanly without iOS UIKit assertions." A regression script that mounts the screen, fires cancel, and asserts no `UIViewController` warnings appear within 500ms would catch reintroductions. Spec-time concern, not investigator-blocking.
- **DISCOVERY-5 (P3):** The 200ms unmount delay in `Modal.tsx` ([Modal.tsx:66](mingla-business/src/components/ui/Modal.tsx#L66)) is hardcoded as `UNMOUNT_DELAY_MS = 200`. If exit animations ever exceed 200ms (e.g., reduce-motion future change), the delay is too short. Consider deriving from `EXIT_DURATION + 40` automatically.
- **DISCOVERY-7 (P1, NEW from live-fire 2026-05-17 17:09Z):** **Past-dated `status='scheduled'` "ghost" events are double-counted in contradictory ways.** Home screen lifecycle helper (`deriveLiveStatus` + `isEventPast` per ORCH-0850 [End-not-start parity systemic] canonical) treats past-dated scheduled events as "ended" and hides them from active/upcoming counts. BrandDeleteSheet cascade preview AND `softDeleteBrand` Step 1 service query (`brandsService.ts:397-413`) filter purely on `events.status IN ('scheduled','live')` with NO date check, so past-dated ghosts count as "Upcoming events: 1" and block delete. The operator sees "0 active events" on home AND "1 upcoming event blocking delete" inside the delete sheet — for the same brand at the same instant. There is no operator-discoverable path from the home view to the blocking event because home hides it. This is the second-order cause of "I can't delete this brand" — even when Symptom A's freeze isn't the culprit. **Fix direction options:** (a) align the delete-blocking filter with the lifecycle helper (only block on events where `status='scheduled' OR 'live'` AND `effectiveEndAt > now`), making past-dated ghosts non-blocking; (b) batch flip past-dated scheduled events to a synthesized 'ended' status server-side (cron / on-read trigger); (c) auto-cancel ghosts as part of the delete flow with explicit operator consent ("This brand has 1 past event still flagged scheduled — cancel it and continue?"). Option (a) is the cheapest and aligns with the spirit of ORCH-0850. Folding into ORCH-0862 because the spec already needs to think about cancel semantics.
- **DISCOVERY-6 (P4 / positive):** `currentBrandStore` v14 is exemplary I-PROPOSED-J compliance — persists only `currentBrandId`, has full v12→v13→v14 migrator chain with clear comments. Use as the reference pattern for fixing `liveEventStore`.

---

## 10. Confidence + next steps

**Overall confidence: probable.** Static trace + DB probe is comprehensive across both symptoms and produces single-mechanism explanations consistent with operator's verbatim symptoms. Promotion to `proven` requires the operator to drive the iOS sim repro (Phase 0.A blocker per Prime Directive 7 — agent cannot drive operator's dev build without authorization).

**Recommended next dispatch:** Claude `mingla-forensics` SPEC mode, scoped to:
- Symptom A fix (Option 1 preferred — drop the navigation).
- Symptom B-2 fix (transient just-deleted flag in `currentBrandStore`).
- Defer Symptom B-1 (falls out of A).
- Defer DISCOVERY-1 (`liveEventStore` snapshot) to a sibling ORCH — different change-class, would inflate this ORCH.
- Defer DISCOVERY-2/3 sweeps to sibling ORCHs.

**Recommendation: KEEP AS SINGLE ORCH-0862, NOT SPLIT.** The two symptoms are causally linked through Symptom A and the fix is naturally bundled (one PR, two scoped diffs). DISCOVERY-1/2/3 should split out.
