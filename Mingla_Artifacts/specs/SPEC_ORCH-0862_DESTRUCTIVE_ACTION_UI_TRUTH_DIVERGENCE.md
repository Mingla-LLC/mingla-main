# SPEC — ORCH-0862 [Destructive-action UI-truth divergence]

**Phase:** SPEC. Mode: Claude `mingla-forensics` (executed by Claude `mingla-orchestrator` under operator delegation).
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md`.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Confidence inheritance:** Symptom B-1 + DISCOVERY-7 PROVEN via live-fire 2026-05-17 17:09Z. Symptom A and B-2 + DISCOVERY-1 are `probable`-confidence (static + DB evidence). Implementor MUST run sim live-fire on Symptom A before claiming PASS.

---

## 1. Scope (what THIS spec covers)

Three scoped fixes, in implementation order (F-3 dropped 2026-05-17 — see §2):

| # | Fix | Surface | File count (est) |
|---|---|---|---|
| **F-1** | Symptom A — drop `router.replace` from event-detail Cancel | business-iOS + business-Android | 1 component |
| **F-2** | DISCOVERY-7 — align brand-delete blocking filter with the date-aware lifecycle helper | business-iOS + business-Android (and any future buyer/admin paths that mount BrandDeleteSheet) | 1 service + 1 hook |
| ~~F-3~~ | ~~B-2 transient just-deleted flag~~ | **DROPPED** — see §2 non-goals | — |
| **F-3** (was F-4) | DISCOVERY-1 — `liveEventStore` v4 → v5, drop server snapshot from persist (I-PROPOSED-J compliance) | business-iOS + business-Android | 1 store + migrator |

## 2. Non-goals (explicit OUT-of-scope)

- **B-2 transient "just-deleted-brand" flag (formerly F-3) — DROPPED 2026-05-17 per operator directive.** Rationale: the original B-2 hypothesis (auto-recovery silently re-assigning the deleted brand → user confused) was over-eager. Operator confirmed in the live-fire pass that B-1 (rejection branch) fully explains "same brand still there". The auto-recovery's `newest-brand` fallback is GOOD UX — multi-brand operators see the deleted brand is gone because it's no longer the chip; zero-brand operators already land cleanly on the brand-less empty state because `resolveCurrentBrandId` returns `{brandId: null, reason: "none"}` when `brands` is empty (verified at `currentBrandResolver.ts:36-42`). Adding an artificial 3-second grace window would force ALL multi-brand operators through a confusing intermediate empty state they don't want. **Lock-in:** the auto-recovery behaviour is now treated as a deliberate UX choice. Do NOT re-spec this as a fix in any future ORCH unless real users report confusion (not investigator-imagined confusion).
- Backend cron / scheduled job to flip past-dated `events.status='scheduled'` to `'ended'` (DISCOVERY-7 option (b)). The cheapest fix (option (a) — align the read-side filter) is sufficient and avoids touching server batch infrastructure.
- Auto-cancel past-ghost events with consent dialog inside the brand-delete flow (DISCOVERY-7 option (c)). UX change too large for this ORCH; revisit if real users hit the new "Cannot delete — but home shows nothing to cancel" copy edge case.
- Symptom A's alternate fix options (defer `router.replace` via setTimeout, or navigate-first-toast-on-destination). Spec locks in option 1 — drop the navigation — because it mirrors the proven-working hub-list flow.
- Other Modal/navigation-race candidates flagged in §6.1 of the investigation (End-sales, order refund/cancel, account/delete, Stripe payments redirect, etc.). Each becomes its own ORCH if a real symptom surfaces. F-1 fixes the operator-reproed instance only; the implementor MUST NOT scope-creep into the 7 audit-required candidates.
- 7 other Zustand stores flagged in DISCOVERY-2 (`orderStore`, `brandTeamStore`, `guestStore`, `scanStore`, `eventEditLogStore`, `doorSalesStore`, `scannerInvitationsStore`). Defer to a sibling ORCH-0863 [Zustand persist server-snapshot audit] if operator approves.
- RLS defense-in-depth tightening on the `brands` SELECT policy (DISCOVERY-3). Sibling ORCH if scoped.

## 3. Assumptions

- Implementor reads the full investigation report + LIVE-FIRE UPDATE before touching code.
- The `event_dates` table has `start_at` and `end_at` columns for every event row (no orphan events with zero dates).
- Existing ORCH-0850 [End-not-start parity systemic] canonical helpers (`computeMasterEndAtUtc`, `isEventPast`) are stable and the implementor can use them as references for the F-2 filter semantics.
- React Query keys `brandKeys.list(accountId)` and `brandKeys.cascadePreview(brandId)` continue to be the only read paths the BrandDeleteSheet flow uses (verified during investigation).

## 4. Cross-Surface Impact (MANDATORY — Phase 2.5)

The 5 primary + 2 adjacent shipping surfaces:

| # | Surface | In scope? | Behaviour spec |
|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` on iOS) | **NO** | No event-cancel or brand-delete flow exists in `app-mobile/`. Reason: consumer app has no host-side surfaces. |
| 2 | Consumer Android | **NO** | Same as above. |
| 3 | Buyer/anonymous Web (`mingla-business/` `/checkout/*`, `/e/*`, `/b/*`) | **NO** | Buyer routes are anon and don't expose cancel/delete CTAs. Reason: anon-tolerant routes do not call host mutation APIs. |
| 4 | **Business iOS** | **YES** | F-1: tapping Cancel on `/event/{id}` no longer freezes — Modal dismisses, screen re-renders showing `status='cancelled'`. F-2: BrandDeleteSheet preview + service-layer block only future-dated scheduled/live events (past-dated ghosts pass). F-3: after explicit delete, home shows brand-less state for ≥1s before auto-recovery kicks in. F-4: cold-start does not load stale event snapshots from persisted storage. |
| 5 | **Business Android** | **YES** | Same as iOS — shared RN code. Parity auto via single codebase. |
| 6 | Admin Web (`mingla-admin/`) | **NO** | Admin does not call `softDeleteBrand` or `business_cancel_event`. Reason: admin has separate refund/cancel flows scoped to orders. |
| 7 | Business Web preview (`mingla-business/` dev/web build) | **YES (verify-only)** | Same RN code via Expo Web. Maestro can't drive it; implementor should at least confirm dev/web builds compile + Cancel CTA renders. Not part of PASS criteria. |

Parity is automatic across iOS + Android (single RN codebase). Implementor produces ONE set of changes; tester verifies on BOTH platforms per the canonical parity rule.

## 5. Per-layer specifications

### F-1 — Symptom A — drop `router.replace` on event-detail Cancel

**File:** [`mingla-business/app/event/[id]/index.tsx`](mingla-business/app/event/%5Bid%5D/index.tsx)

**Current code (lines 282–315), problematic:**

```tsx
const handleCancelConfirm = useCallback(async (): Promise<void> => {
  if (id === null) return;
  if (isServerBackedEvent) {
    if (event === null) return;
    setCancelSubmitting(true);
    try {
      await cancelServerEvent.cancelEvent({ eventId: event.id, brandId: event.brandId });
      setCancelDialogVisible(false);
      showToast("Event cancelled.");
      router.replace("/(tabs)/hub/events" as never);  // ← REMOVE THIS LINE
    } catch {
      showToast("Could not cancel event. Try again.");
    } finally {
      setCancelSubmitting(false);
    }
    return;
  }
  // legacy client-side path
  await cancelSleep(CANCEL_PROCESSING_MS);
  updateLifecycle(id, { status: "cancelled", cancelledAt: new Date().toISOString() });
  setCancelDialogVisible(false);
  showToast(
    "Event cancelled. Buyers will be refunded when emails wire up (B-cycle).",
  );
  router.replace("/(tabs)/hub/events" as never);  // ← REMOVE THIS LINE TOO
}, [id, isServerBackedEvent, event, cancelServerEvent, updateLifecycle, router, showToast]);
```

**Spec change:** Delete BOTH `router.replace("/(tabs)/hub/events" as never);` lines (server-backed success path on line ~294, and legacy client-side path on line ~314). Remove `router` from the `useCallback` dependency array if it becomes unused — verify with tsc strict.

**Behavioural contract post-fix:**

- On successful cancel (server-backed): mutation resolves → cache write fires → `useBusinessEventById` refetches → `event.status` flips to `cancelled` → `deriveScreenStatus` collapses to `"past"` → `EventDetailHeroStatusPill` renders ENDED state → `setCancelDialogVisible(false)` triggers the 200ms Modal exit → screen stays mounted → Modal dismisses cleanly on stable parent → toast shows "Event cancelled." → user can tap back or any nav element to leave.
- On failure: toast "Could not cancel event. Try again." → screen stays on the event in its prior state → user can retry or back out.
- On legacy client-side path: same as server-backed but uses the local `updateLifecycle` store mutation.

**What must NOT change:**

- The cache invalidation in `writePublishedEventCaches` ([`useBusinessEvents.ts:50-78`](mingla-business/src/hooks/useBusinessEvents.ts#L50-L78)) — it's the mechanism by which the screen re-renders in-place.
- The `setCancelDialogVisible(false)` / `showToast` ordering.
- The error-path UX.
- The `handleBack` callback elsewhere on the screen ([`event/[id]/index.tsx:152-158`](mingla-business/app/event/%5Bid%5D/index.tsx#L152-L158)) — user-initiated back navigation is a separate concern.

### F-2 — DISCOVERY-7 — align brand-delete blocking filter with the date-aware lifecycle helper

**Files:**
- [`mingla-business/src/services/brandsService.ts`](mingla-business/src/services/brandsService.ts) — `softDeleteBrand` Step 1 (lines 397-413)
- [`mingla-business/src/hooks/useBrands.ts`](mingla-business/src/hooks/useBrands.ts) — `useBrandCascadePreview` `upcomingResult` + `liveResult` queries (lines 437-448)

**Current shape (service Step 1):**

```ts
const { count, error: countError } = await supabase
  .from("events")
  .select("id", { count: "exact", head: true })
  .eq("brand_id", brandId)
  .in("status", BRAND_DELETE_BLOCKING_EVENT_STATUSES)  // ["scheduled","live"]
  .is("deleted_at", null);
```

**Spec change (service):**

```ts
const nowIso = new Date().toISOString();
const { count, error: countError } = await supabase
  .from("events")
  .select("id, event_dates!inner(end_at)", { count: "exact", head: true })
  .eq("brand_id", brandId)
  .in("status", BRAND_DELETE_BLOCKING_EVENT_STATUSES)
  .is("deleted_at", null)
  .gt("event_dates.end_at", nowIso);
```

Rationale: `event_dates!inner` forces an INNER JOIN so events with no dates are excluded (impossible per assumption §3, but defensive); `.gt("event_dates.end_at", now)` filters out past-dated rows aligning with ORCH-0850 [End-not-start parity systemic] canonical `isEventPast` semantics. Multi-date events are correctly handled because PostgREST counts DISTINCT events when `event_dates!inner` is used with count:exact — verify in implementation.

**Implementor verification:** if multi-date events would double-count via the join, use a subquery instead:

```ts
const { count } = await supabase.rpc("pg_count_brand_blocking_events", { p_brand_id: brandId });
```

with a server-side function. Prefer the inline query if PostgREST count semantics handle it correctly (test against a brand with 1 event having 3 future event_dates → expect count=1).

**Spec change (cascade preview hook):** apply the SAME date filter to `upcomingResult` and `liveResult` queries in `useBrandCascadePreview`. `pastResult` (status `IN ('ended','cancelled')`) is unaffected — past lifecycle is already authoritative there.

```ts
// upcomingResult — was: .eq("status","scheduled").is("deleted_at",null)
supabase
  .from("events")
  .select("id, event_dates!inner(end_at)", { count: "exact", head: true })
  .eq("brand_id", brandId)
  .eq("status", "scheduled")
  .is("deleted_at", null)
  .gt("event_dates.end_at", nowIso),

// liveResult — was: .eq("status","live").is("deleted_at",null)
supabase
  .from("events")
  .select("id, event_dates!inner(end_at)", { count: "exact", head: true })
  .eq("brand_id", brandId)
  .eq("status", "live")
  .is("deleted_at", null)
  .gt("event_dates.end_at", nowIso),
```

**Behavioural contract post-fix:**

- A brand whose only "scheduled" event has `event_dates.end_at < now` → cascade preview shows `Upcoming events: 0` → red "Active events block delete" banner suppressed → "Type to confirm" enables the delete path → `softDeleteBrand` Step 1 returns count=0 → delete proceeds → success.
- A brand with at least one `status='scheduled'` event whose `end_at > now` → preview shows `Upcoming events: N≥1` → banner shows → delete attempts still reject (correct).
- "Past events" count (status `ended` or `cancelled`) is unchanged.

**What must NOT change:**

- `BRAND_DELETE_BLOCKING_EVENT_STATUSES` constant ([`brandsService.ts:109`](mingla-business/src/services/brandsService.ts#L109)) — still `['scheduled', 'live']`. The date filter is additional, not replacement.
- The rejection-result shape `{rejected: true, reason: "upcoming_events", upcomingEventCount: N}`.
- The BrandDeleteSheet's rejected-step copy.

### ~~F-3 (DROPPED)~~ — B-2 transient "just-deleted-brand" flag

**Status:** DROPPED 2026-05-17. See §2 non-goals for rationale. The auto-recovery "newest-brand" fallback is now treated as deliberate good UX, not a bug. Sub-section retained below for audit trail only — implementor does NOT execute this fix.

<details>
<summary>Original (DROPPED) spec — DO NOT IMPLEMENT</summary>

**Files:**
- [`mingla-business/src/store/currentBrandStore.ts`](mingla-business/src/store/currentBrandStore.ts) — add transient state
- [`mingla-business/src/hooks/useCurrentBrandRecovery.ts`](mingla-business/src/hooks/useCurrentBrandRecovery.ts) — check flag before assigning newest-brand
- [`mingla-business/app/(tabs)/home.tsx`](mingla-business/app/%28tabs%29/home.tsx), [`mingla-business/app/(tabs)/account.tsx`](mingla-business/app/%28tabs%29/account.tsx), [`mingla-business/app/brand/[id]/index.tsx`](mingla-business/app/brand/%5Bid%5D/index.tsx) — `handleBrandDeleted` setters

**Spec change (`currentBrandStore.ts`):**

Add a non-persisted field to `CurrentBrandState`:

```ts
export type CurrentBrandState = {
  currentBrandId: string | null;
  /** Non-persisted: timestamp (ms) when a brand was just explicitly deleted. */
  lastBrandDeletedAt: number | null;
  setCurrentBrand: (brand: Brand | null) => void;
  setCurrentBrandId: (id: string | null) => void;
  /** Marks an explicit delete; recovery skips newest-brand fallback for 3s. */
  markBrandJustDeleted: () => void;
  reset: () => void;
};
```

`partialize` does NOT include `lastBrandDeletedAt` — it stays in-memory only (TTL-driven, no persistence needed).

```ts
const persistOptions: PersistOptions<CurrentBrandState, PersistedState> = {
  name: "mingla-business.currentBrand.v14",  // version unchanged — schema addition is non-persisted
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state) => ({ currentBrandId: state.currentBrandId }),  // unchanged
  version: 14,
  migrate: /* unchanged */,
};
```

Add the action:

```ts
markBrandJustDeleted: () => set({ lastBrandDeletedAt: Date.now() }),
```

Initial state adds `lastBrandDeletedAt: null`.

**Spec change (`useCurrentBrandRecovery.ts`):**

Add a constant `JUST_DELETED_BRAND_GRACE_MS = 3000` (3 seconds).

In the recovery `useEffect`, before calling `setCurrentBrandId(resolution.brandId)`, check:

```ts
const lastDeletedAt = useCurrentBrandStore.getState().lastBrandDeletedAt;
const isInGracePeriod =
  lastDeletedAt !== null && Date.now() - lastDeletedAt < JUST_DELETED_BRAND_GRACE_MS;

if (resolution.reason === "newest-brand" && isInGracePeriod) {
  // Skip the newest-brand auto-pick during the just-deleted grace window.
  // Leaves currentBrandId null so home shows the brand-less / switcher state.
  return;
}

if (resolution.brandId !== currentBrandId) {
  setCurrentBrandId(resolution.brandId);
}
```

The "server-default" and "keep-local" branches are NOT affected — they fire normally even during grace period. Only the silent `"newest-brand"` fallback is suppressed.

**Spec change (3 mount sites):**

Each `handleBrandDeleted` callback adds ONE call after `setCurrentBrand(null)` (whether or not the matched-id branch fires):

```ts
const handleBrandDeleted = useCallback(
  (deletedBrandId: string): void => {
    const currentBrandId = useCurrentBrandStore.getState().currentBrandId;
    if (currentBrandId === deletedBrandId) {
      setCurrentBrand(null);
    }
    useCurrentBrandStore.getState().markBrandJustDeleted();  // NEW
    // ... rest of existing logic (toast, navigation, etc.)
  },
  [...],
);
```

**Behavioural contract post-fix:**

- User deletes the CURRENT brand: `currentBrandId` set to null + `lastBrandDeletedAt` set to now → recovery sees grace period → skips newest-brand → home shows empty/switcher state for ≥3s → user sees confirmation the brand is gone → after 3s OR any tap that triggers a recovery re-run via different inputs, normal recovery resumes.
- User deletes a NON-current brand: `currentBrandId` unchanged + `lastBrandDeletedAt` set → recovery sees grace period BUT `resolution.reason === "keep-local"` (current brand still exists in the list) → normal path runs → no visible change. Defensive and correct.
- User force-quits in the grace window: `lastBrandDeletedAt` is non-persisted → null on relaunch → recovery resumes normally. By design — cold start should re-resolve from authoritative server state.

**What must NOT change:**

- The `currentBrandId` persisted-state shape (no version bump).
- The `useCurrentBrand` auto-clear effect (when `useBrand(currentBrandId)` returns null after fetch → clears currentBrandId). Already correct.

</details>

### F-3 (was F-4) — DISCOVERY-1 — `liveEventStore` v4 → v5, drop server snapshot

**File:** [`mingla-business/src/store/liveEventStore.ts`](mingla-business/src/store/liveEventStore.ts)

**Current code (lines 349-375):**

```ts
const persistOptions: PersistOptions<LiveEventState, PersistedState> = {
  name: "mingla-business.liveEvent.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (state): PersistedState => ({ events: state.events }),
  version: 4,
  migrate: (persistedState, version): PersistedState => {
    // v1→v3 migrators (preserved as audit trail)
  },
};
```

**Spec change:**

Bump to v5 with `partialize` returning `{ events: [] }` (zero persistence of server data). Add a v4→v5 migrator that drops the persisted events array:

```ts
const persistOptions: PersistOptions<LiveEventState, PersistedState> = {
  name: "mingla-business.liveEvent.v1",  // unchanged — storage key continues
  storage: createJSONStorage(() => AsyncStorage),
  // ORCH-0862 / DISCOVERY-1 — drop persisted server snapshots per I-PROPOSED-J.
  // Cold-start re-hydrates from React Query via useBusinessEventsForBrand.
  partialize: (_state): PersistedState => ({ events: [] }),
  version: 5,
  migrate: (persistedState, version): PersistedState => {
    if (version < 1) return { events: [] };
    // v1, v2, v3 migrators retained for audit trail.
    if (version === 1) { /* unchanged */ }
    if (version === 2) { /* unchanged */ }
    if (version === 3) { /* unchanged */ }
    if (version === 4) {
      // v4 → v5: ORCH-0862 — drop the persisted server snapshot.
      // Returning empty array; React Query re-hydrates in-memory state
      // via useBusinessEventsForBrand on next mount.
      return { events: [] };
    }
    return persistedState as PersistedState;
  },
};
```

**Behavioural contract post-fix:**

- Cold start on a returning user: AsyncStorage rehydration returns `{ events: [] }` → in-memory `liveEventStore.events = []` initially → React Query mounts on home / hub via `useBusinessEventsForBrand` → fetches live → existing converter code populates the store via `addLiveEvent` / `updateLiveEventFields` from server data → UI renders fresh.
- Cold start with no network: empty events array; React Query fails silently; UI shows brand-resolving state. Acceptable per Const #3 — no fake data is shown.
- Mid-session: behaviour identical to today (events accumulate in-memory; refresh cycles re-fetch).
- Cross-device staleness: ELIMINATED — cancelling an event on device A no longer leaves a stale `status='scheduled'` snapshot on device B's AsyncStorage.

**What must NOT change:**

- The `LiveEvent` type (still has `serverEventId`, `status`, etc. — in-memory state is unaffected).
- Any consumer of `useLiveEventStore` selectors (`getLiveEventsForBrand`, `getLiveEvent`, `updateLifecycle`, etc.). They read from in-memory state which IS populated, just not via persistence.
- The `name: "mingla-business.liveEvent.v1"` storage key — Zustand keys this by `name`, version is internal; do NOT change the name or you'll orphan all existing users' caches without running the v4→v5 migrator.

**Risk:** if a user opens the app on a flight (no network) and `useBusinessEventsForBrand` fails, they see "no events" instead of stale-but-rendered events. Per I-PROPOSED-J philosophy this is intentional — stale UI is more dangerous than empty UI. Acceptable.

## 6. Numbered Success Criteria

| SC | Criterion | Layer | Verification |
|---|---|---|---|
| **SC-1** | Tapping Cancel on `/event/{id}` for an active scheduled/live event completes the server-side cancel without freezing the app. ConfirmDialog dismisses within 500ms, screen re-renders with status pill showing the cancelled (ENDED) state, toast "Event cancelled." appears. | Component + iOS UIKit | Sim live-fire repro on Leggo This `The Reckoning` + Maestro flow asserting no freeze + screenshot showing post-cancel ENDED status pill. |
| **SC-2** | After F-1, tapping Back on the cancelled event-detail screen navigates to `/(tabs)/hub/events` cleanly, no orphaned modals. | Component + navigation | Sim live-fire — tap Back after Cancel succeeds, verify navigation reaches hub. |
| **SC-3** | A brand whose only `status='scheduled'` event has `event_dates.end_at < now` is deletable: BrandDeleteSheet preview shows `Upcoming events: 0`, "Active events block delete" banner hidden, type-to-confirm flow succeeds, brand row's `deleted_at` populated in DB. | Service + hook + DB | Maestro flow on Test Stripe (after F-2): preview shows 0 upcoming, delete succeeds, MCP probe confirms `brands.deleted_at IS NOT NULL`. |
| **SC-4** | A brand with at least one future-dated `status='scheduled'` event still cannot be deleted: preview shows the correct count, banner shows, type-to-confirm proceeds, terminal "Cannot delete this brand" rejection screen lands. | Service + hook | Maestro flow on Leggo This (4 future scheduled events): expect rejection step with N=4 (or however many remain future-dated). |
| **SC-5** | Multi-date events (one event with N>1 future `event_dates`) count as exactly 1 in the cascade preview upcomingEventCount, not N. | Service | Implementor jest test against a test brand with 1 event + 3 future dates; expect count === 1. If PostgREST inline join overcounts, switch to RPC per §5 F-2 implementor verification note. |
| ~~SC-6, SC-7, SC-8~~ | **DROPPED with F-3** — see §2 non-goals | — | — |
| **SC-6** (was SC-9) | Cold start after F-3 (was F-4) ships: AsyncStorage `mingla-business.liveEvent.v1` returns `events: []`; React Query populates the in-memory store within 2s of mount on home; UI renders the brand's events from server-derived state. | Store + persist migrator | Implementor jest test: simulate v4 persisted state with 3 stale events, verify v5 migrator returns `{events: []}`. Integration smoke: AsyncStorage inspector before/after relaunch. |
| **SC-7** (was SC-10) | No cross-device stale-event divergence: cancelling an event on device A and opening device B (post-F-3) shows the cancelled state, not the previously-persisted `status='scheduled'`. | Cross-device | Manual two-device test or AsyncStorage simulation. Tester-callable. |
| **SC-8** (NEW — replacing dropped F-3 criteria) | After successful brand-delete from home (zero remaining brands case): home renders the brand-less / "Create a brand" empty state via `resolveCurrentBrandId` returning `{brandId: null, reason: "none"}`. After successful brand-delete from home (≥1 remaining brand case): the most recently created remaining brand becomes the new current brand chip on home (newest-brand auto-recovery is INTENTIONAL UX — see §2). | Hook + component | Sim live-fire on the multi-brand path: delete a brand that is current, verify a different brand chip appears within ~1s. On the zero-brand path: delete the only brand, verify empty state appears. |

## 7. Invariants

**To preserve:**

- **I-PROPOSED-J (Zustand persist no server snapshots — ACTIVE post-ORCH-0742):** F-4 brings `liveEventStore` into compliance.
- **Const #2 (one owner per truth):** F-1 keeps the cache + service as the source-of-truth for event status; the screen reads from React Query, not from navigation side-effects.
- **Const #3 (no silent failures):** F-1's error path still toasts; F-2's rejection path still lands; F-3's recovery skip is intentional and time-bounded, not silent.
- **Const #5 (server state stays server-side):** F-4 explicitly enforces this.
- **ORCH-0850 canonical date-aware lifecycle (I-EVENT-LIFECYCLE-SINGLE-HELPER ACTIVE):** F-2 aligns the delete-blocking query with the same date semantics the helper uses (`end_at > now`).

**To establish (new candidate invariant):**

- **I-PROPOSED-BRAND-DELETE-BLOCKING-DATE-AWARE** (DRAFT → ACTIVE on ORCH-0862 CLOSE): Any query that counts brand-blocking events MUST filter by `event_dates.end_at > now()` in addition to `status IN ('scheduled','live')`. CI gate: strict-grep on `softDeleteBrand` Step 1 + `useBrandCascadePreview` upcomingResult/liveResult queries to require the date filter.

## 8. Test cases

### Implementor-written happy-path regression tests (ORCH-0840 Step 0.5 gate, side A)

| ID | Surface | Scenario | Expected | File |
|---|---|---|---|---|
| **IM-1** | Component | `handleCancelConfirm` no longer calls `router.replace` on success | `await handleCancelConfirm()` → `router.replace` mock NOT called; `setCancelDialogVisible(false)` called; `showToast("Event cancelled.")` called. | `mingla-business/app/event/[id]/__tests__/cancel-no-navigation.test.tsx` |
| **IM-2** | Service | `softDeleteBrand` ignores past-dated scheduled events as blockers | Brand with 1 `status='scheduled'` event with end_at=2020-01-01 + 0 other events → `softDeleteBrand` returns `{rejected: false, brandId}`. | `mingla-business/src/services/__tests__/softDeleteBrand-past-ghost.test.ts` |
| ~~IM-3~~ | **DROPPED with F-3** — see §2 | — | — | — |
| **IM-3** (was IM-4) | Store | v4 → v5 migrator returns empty events | Persisted v4 state `{events: [stale1, stale2]}` → migrate returns `{events: []}`. | `mingla-business/src/store/__tests__/liveEventStore-v4-v5-migrator.test.ts` |

Each test MUST include a `fails-on-revert verified at <commit-hash>` line in the implementation report, per ORCH-0840 [Regression-test enforcement + append-only CI].

### Tester-written adversarial tests (ORCH-0840 Step 0.5 gate, side B)

| ID | Surface | Adversarial angle | File |
|---|---|---|---|
| **AD-1** | Component | F-1 must NOT also drop the error-path toast — verify the catch branch still toasts "Could not cancel event. Try again." | `mingla-business/app/event/[id]/__tests__/cancel-error-path.adversarial.test.tsx` |
| **AD-2** | Service | F-2 must not regress: brand with a multi-date event (1 event, 3 future event_dates) counts as 1, not 3. Inline join semantics or RPC. | `mingla-business/src/services/__tests__/softDeleteBrand-multi-date.adversarial.test.ts` |
| ~~AD-3~~ | **DROPPED with F-3** — see §2 | — | — |
| **AD-3** (was AD-4) | Store | F-3's (was F-4) v5 migrator must NOT touch unrelated persisted keys (drafts, brand store, etc.); migrate from v3 + v4 separately to verify chain integrity. | `mingla-business/src/store/__tests__/liveEventStore-migrator-chain.adversarial.test.ts` |

Each adversarial test attacks a DIFFERENT angle than the happy-path counterpart (per ORCH-0840 [Regression-test enforcement + append-only CI] gate).

### Tester sim live-fire (Phase 0.A, mandatory before PASS)

- **TLF-1:** Symptom A repro on Leggo This `The Reckoning`. Pre-fix: freeze reproduces. Post-fix: cancel completes, no freeze, screen re-renders with cancelled state. (This is the proof we still need.)
- **TLF-2:** Symptom B-1 + DISCOVERY-7 repro on Test Stripe (which has 1 past-ghost). Pre-fix: rejection at terminal step. Post-fix: delete succeeds, brand row's `deleted_at IS NOT NULL`, switcher list excludes it.
- ~~**TLF-3:**~~ **DROPPED with F-3** — see §2. Replaced by SC-8 verification: tester confirms that after a successful brand-delete, the auto-recovery's `newest-brand` fallback behaves as intended (multi-brand case → newest other brand becomes current; zero-brand case → home renders empty state).

## 9. Implementation order

| Step | Files | Independently revertible? | Notes |
|---|---|---|---|
| **1** (F-1 Symptom A — drop navigation) | `mingla-business/app/event/[id]/index.tsx` (2 line deletions + dep array cleanup) | YES | Smallest, safest. Implementor MUST sim-repro both pre-fix freeze AND post-fix success before claiming complete. |
| **2** (F-2 DISCOVERY-7 — date-aware delete blocking) | `mingla-business/src/services/brandsService.ts` (Step 1 query) + `mingla-business/src/hooks/useBrands.ts` (cascade preview x2 queries) | YES | Run jest IM-2 with mock data; sim-verify against Test Stripe. |
| ~~3~~ | **DROPPED with F-3** — see §2 | — | — |
| **3** (was 4 — F-3 liveEventStore migration) | `mingla-business/src/store/liveEventStore.ts` (partialize + version + migrator) | YES | Last to ship — highest risk if cold-start re-hydration has unknown holes. Implementor MUST cold-start the sim with AsyncStorage cleared to a v4-shape state and verify no UI regression on home / hub / event detail. |

Each step is its own commit on `Seth` (sequential commits in ONE PR per ORCH-0862, per one-PR-per-CLOSE rule). If any step has to be reverted mid-bundle, the others can stay.

## 10. Regression prevention

- **Strict-grep gate (NEW):** `.github/scripts/strict-grep/i-brand-delete-blocking-date-aware.mjs` — scans `softDeleteBrand` Step 1 + `useBrandCascadePreview` `upcomingResult`/`liveResult` queries; FAILs if either is missing the `.gt("event_dates.end_at", ...)` filter (or an equivalent RPC call). Register in `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`. Codifies I-PROPOSED-BRAND-DELETE-BLOCKING-DATE-AWARE.
- **Strict-grep gate (NEW):** `.github/scripts/strict-grep/i-event-detail-cancel-no-navigation.mjs` — FAILs if `handleCancelConfirm` in `event/[id]/index.tsx` contains `router.replace` or `router.push` calls. Codifies the F-1 fix as a structural invariant: "the event-detail cancel handler does not navigate post-mutation."
- **Comment marker on F-1 lines** (the spots where `router.replace` used to live): `// ORCH-0862: do NOT navigate post-cancel. Re-rendering in place avoids the iOS UIKit dismiss-race freeze. See feedback_rn_sub_sheet_must_render_inside_parent.md cousin pattern.` — protects against accidental revert by future authors who might think the navigate "feels right."
- **Test append-only CI** (existing per ORCH-0840): IM-1 through IM-4 + AD-1 through AD-4 are immutable post-merge.

## 11. Files touched (final manifest)

| Category | Files | Net effect |
|---|---|---|
| Product code | `mingla-business/app/event/[id]/index.tsx`, `mingla-business/src/services/brandsService.ts`, `mingla-business/src/hooks/useBrands.ts`, `mingla-business/src/store/liveEventStore.ts` | 4 files (was 9 — F-3 drop removed 5: currentBrandStore, useCurrentBrandRecovery, home.tsx, account.tsx, brand/[id]/index.tsx) |
| Regression tests | 3 happy-path + 3 adversarial under `mingla-business/src/services/__tests__/`, `mingla-business/src/store/__tests__/`, `mingla-business/app/event/[id]/__tests__/` | 6 files (was 8 — F-3 drop removed IM-3 + AD-3) |
| CI gates | `.github/scripts/strict-grep/i-brand-delete-blocking-date-aware.mjs` + `i-event-detail-cancel-no-navigation.mjs` + workflow update | 3 files |
| **TOTAL** | | **~13 files** (was ~20) |

**No new DB migration. No new edge function. No native module change. EAS OTA-eligible** per `feedback_eas_update_no_web.md` two-platform pattern (mingla-business iOS + Android via separate `--platform` calls).

## 12. Out-of-scope discoveries surfaced during SPEC

- The `event_dates.end_at` filter in F-2 assumes every event has at least one `event_dates` row. If orphan events exist (event with zero dates), the INNER JOIN would exclude them silently. Implementor must verify with: `SELECT COUNT(*) FROM events e WHERE NOT EXISTS (SELECT 1 FROM event_dates ed WHERE ed.event_id = e.id);` — expected 0. If non-zero, F-2 needs a `LEFT JOIN` variant with `event_dates IS NULL OR event_dates.end_at > now()`. Tester must MCP-probe this before claiming PASS on SC-3 / SC-4.

---

## Pipeline next

Implementor (Codex `implementor-mingla` per default routing, OR Claude `mingla-implementor` if operator redirects) → 4 sequential steps in implementation order → 4 happy-path tests written + run + fails-on-revert verified → implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md`. Then Claude `mingla-forensics` TEST mode (canonical) → 4 adversarial tests + 3 sim live-fire flows + verdict. Then orchestrator CLOSE with one-PR-per-CLOSE per `feedback_one_pr_per_close.md`. Estimated total ~20 files, single PR, single ORCH-ID.
