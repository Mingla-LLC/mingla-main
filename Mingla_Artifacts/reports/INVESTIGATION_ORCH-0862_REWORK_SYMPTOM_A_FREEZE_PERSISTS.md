# INVESTIGATION REWORK — ORCH-0862 [Destructive-action UI-truth divergence] — Symptom A freeze PERSISTS post-F-1

**Status:** REWORK in progress. Confidence: **probable** on narrowed hypothesis space; sim freeze capture blocked by Maestro tap-on-Cancel-row reliability (Case-B operator hand-tap required for `proven`).
**Owner:** Claude `mingla-forensics` (executed via operator "take over" delegation).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Parent prior report (SUPERSEDED on Symptom A):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md`

---

## 1. Falsification statement (A-H1 dead)

A-H1 (`router.replace` racing iOS UIKit Modal dismiss animation) is **FALSIFIED by live operator evidence on two independent targets**:

- **iPhone 17 Pro iOS Simulator** UDID `17091E60-C3B6-4167-980D-60C348E177F6` running the Metro JS bundle that **HAS the F-1 deletion live** — `router.replace("/(tabs)/hub/events" as never);` is removed from `handleCancelConfirm`. Cancel still freezes.
- **Operator's physical iPhone dev build** running pre-F-1 code. Cancel still freezes.

Hub-list "..." Cancel works on both targets. Same `useCancelBusinessEvent` mutation, same `business_cancel_event` RPC, same `ConfirmDialog` primitive, same `EventManageMenu` Sheet primitive — only the calling screen differs.

The prior diagnosis was wrong: removing the navigation does NOT cure the freeze. The discriminating mechanism between event-detail (freezes) and hub-list (works) is something other than the navigation call.

---

## 2. Live-fire evidence captured this session

Streams started: `xcrun simctl spawn 17091E60-... log stream` with predicates for `minglabusiness` syslog (`/tmp/orch0862-rework-symptomA-syslog.txt`, ~18k lines captured during navigation) and UIKit lifecycle events (`/tmp/orch0862-rework-symptomA-uikit.txt`).

Reached event-detail screen on Leggo This → opened EventManageMenu manage sheet (screenshot `/tmp/orch0862-rwk-05-menu.png` confirms Cancel-event row visible after redbox dismiss). **Maestro could not reliably tap the Cancel-event row** despite multiple coord permutations (30%/96%, 50%/94%) and accessibility-label selectors — same tooling blocker observed in the prior QA session.

Result: the freeze itself was NOT captured in my session. Logs contain only normal sim startup + navigation chatter, no JS-level cancel handler invocation. The freeze frame must come from a Case-B operator hand-tap with the streams already running (instructions in §11 below).

This rework cannot promote to `proven` until that capture happens. Honest confidence ceiling for this dispatch: **`probable` on narrowed candidate set, `suspected` on the single most-likely mechanism (A-H2).**

---

## 3. Structural discriminator — what makes event-detail freeze but hub-list work

Read carefully — this is the only material difference between the two cancel flows.

### Shared mechanics (identical on both screens)

| Mechanic | Both flows do this identically |
|---|---|
| Cancel handler async shape | `setCancelSubmitting(true) → await cancelServerEvent.cancelEvent(...) → setCancelDialogVisible(false) → showToast → finally setCancelSubmitting(false)` (vs hub-list `setCancelEvent(null)`) — both batch the same way under React 18 |
| Mutation | `useCancelBusinessEvent.cancelEvent({eventId, brandId})` → RPC `business_cancel_event` (migration `20260515000005_orch_0763d_event_lifecycle_repair.sql`) |
| onSuccess | `writePublishedEventCaches(qc, published, brandId)` — 7 cache operations: `setQueryData(detail)` + `setQueryData(list)` + 5 `invalidateQueries(...)` |
| Dialog primitive | `ConfirmDialog` (`variant="typeToConfirm"`) → wraps native `Modal` from `src/components/ui/Modal.tsx` |
| Manage menu | `EventManageMenu` Sheet primitive opened first, dismissed via `setManageMenuVisible(false)` / `setManageCtx(null)` in same handler as `setCancelDialogVisible(true)` / `setCancelEvent(brand)` |

If the freeze were in any of the shared mechanics, hub-list would freeze too. It doesn't. The freeze is gated by something on the event-detail screen that hub-list doesn't have.

### The discriminator: `writePublishedEventCaches` invalidates the EXACT query that event-detail subscribes to

From [useBusinessEvents.ts:50-78](mingla-business/src/hooks/useBusinessEvents.ts#L50-L78), `writePublishedEventCaches` calls:

```ts
queryClient.setQueryData(businessEventKeys.detail(published.event.id), detailForPublishedEvent(published));
queryClient.setQueryData<LiveEvent[]>(businessEventKeys.list(brandId), (prev) => ...);
queryClient.invalidateQueries({ queryKey: businessEventKeys.detail(published.event.id) });  // ← line 66
queryClient.invalidateQueries({ queryKey: businessEventKeys.list(brandId) });
queryClient.invalidateQueries({ queryKey: publicEventKeys.detailById(published.event.id) });
queryClient.invalidateQueries({ queryKey: publicEventKeys.detailBySlug(...) });
queryClient.invalidateQueries({ queryKey: publicEventKeys.brandBySlug(...) });
```

| Screen | Active subscribers to which key | Refetch trigger on cancel success |
|---|---|---|
| **event-detail** (`/event/{id}`) | `useManagedEventRoute(id)` → `useBusinessEventById(id)` → subscribes to **`businessEventKeys.detail(eventId)`** | line 66 invalidate fires refetch on the screen the user is **currently looking at** |
| **hub-list** (`/(tabs)/hub/events`) | `useBusinessEventsForBrand(brandId)` → subscribes to **`businessEventKeys.list(brandId)`**; NOT a subscriber to `detail(eventId)` | The list-key invalidate fires refetch on the list screen, but the detail-key invalidate has no active subscriber on hub → no-op on the screen rendering hub |

**This is the asymmetry.** On event-detail, the mutation's onSuccess triggers a refetch of the SAME query whose data was just synchronously updated via setQueryData. The screen re-renders TWICE in rapid succession (once from setQueryData, once from refetch landing), while the ConfirmDialog Modal is mid-dismiss. On hub-list, the list-key flow already has stable refetch semantics and the detail-key invalidate is silently absorbed because no subscriber exists.

Whether the freeze is iOS-side (UIKit dismiss collision with React re-mount during refetch) or JS-side (Hermes stall on the double-render + Reanimated worklet contention) requires log capture to disambiguate. But this IS the discriminator — and the only mechanism class consistent with "same handler, same primitive, same RPC, only the active subscriber to the invalidated key differs."

---

## 4. Hypothesis ladder (12 candidates, attacked)

A-H1 dead (§1). Remaining 12:

| ID | Hypothesis | Mechanism (file:line) | Verdict after this rework | Why |
|---|---|---|---|---|
| **A-H2** | Cache-invalidate triggers refetch on the active `useBusinessEventById` subscriber while Modal is mid-dismiss → React re-render storm during animation | [useBusinessEvents.ts:66](mingla-business/src/hooks/useBusinessEvents.ts#L66) + [useManagedEventRoute.ts:30](mingla-business/src/hooks/useManagedEventRoute.ts#L30) | **PROMOTED to leading candidate (`suspected`)** — only mechanism class that matches the discriminator in §3. Needs live freeze capture to confirm the exact stall layer. |
| A-H3 | `useEventOrders` cascade | [useEventOrders.ts:58-72](mingla-business/src/hooks/useEventOrders.ts#L58-L72) | **DISPROVEN (structural):** useEventOrders is plain `useQuery` with no realtime/auto-invalidate, 15s staleTime. The cancel mutation does NOT invalidate eventOrdersKeys. No cascade. |
| A-H4 | React 18 batching modal orphan | event/[id]/index.tsx handleCancelConfirm | **DISPROVEN (structural):** hub-list has identical setState ordering and doesn't freeze; if batching were the cause both would freeze. |
| A-H5 | Sibling-Modal mount ordering (EventManageMenu Sheet closing while ConfirmDialog Modal opening) | [event/[id]/index.tsx:818-821](mingla-business/app/event/%5Bid%5D/index.tsx#L818-L821) + hub events.tsx | **DISPROVEN (structural):** hub-list has identical `setManageCtx(null) + setCancelEvent(brand)` same-tick sibling-Modal pattern at [hub/events.tsx:390-391](mingla-business/app/%28tabs%29/hub/events.tsx#L390-L391); doesn't freeze. |
| A-H6 | ConfirmDialog Reanimated worklet stall | [ConfirmDialog.tsx:88-90 + 131-133](mingla-business/src/components/ui/ConfirmDialog.tsx#L88-L133) | **DISPROVEN (structural):** `progress` shared value is declared but never written for `typeToConfirm` variant (only `holdToConfirm` calls `withTiming` on it). Worklet is inert. Hub-list uses identical primitive — would also freeze. |
| A-H7 | Cancel mutation never resolves (RPC stall) | [businessEvents.ts:591-604](mingla-business/src/services/businessEvents.ts#L591-L604) | **REJECTED**: would freeze hub-list too (same RPC). DB probe at 14:25Z shows historic cancels DO succeed (`Test Stripe`'s `The ripe` cancelled successfully). Not RPC-level. |
| A-H8 | LiveEvent edit-log notification fan-out | [liveEventStore.ts updateLifecycle](mingla-business/src/store/liveEventStore.ts) | **DISPROVEN (structural):** server-backed cancel path does NOT call `updateLifecycle` on the local store (only the legacy non-server path does). Operator's repro is on server-backed events. |
| A-H9 | HeroStatusPill animation deadlock | EventDetailHeroStatusPill | **DEFERRED to live capture** — possible but not differentiated from A-H2 without trace. |
| A-H10 | Hermes JS heap GC pause | global | **DEFERRED** — operator describes total freeze persisting for many seconds, not a 1-2s GC stall. Possible compounding factor, not primary cause. |
| **A-H11** | ORCH-0859 [Tr2 Minimum Viable Trip] WIP interaction | working-tree dirty files | **DISPROVEN (structural diff):** ORCH-0859 WIP touches `home.tsx`, `hub/trips.tsx`, `trip/coming-soon.tsx`, `UniversalCreatorSheet.tsx`, 2 edge functions, `businessEvents.ts` (adds `event_type` discriminator), `liveEventStore.ts` (adds optional `event_type` field), `useBrands.ts` (adds `event_type='event'` filter to cascade-preview counters). **NONE of these touch the cancel-from-event-detail code path.** `useManagedEventRoute`, `ConfirmDialog`, `Modal`, `EventManageMenu`, `useBusinessEvents.useCancelBusinessEvent + writePublishedEventCaches` — zero diff. The differential-stash test was the most decisive structurally-checkable hypothesis, and the diff inspection refutes it without needing to run the stash. |
| A-H12 | iOS 26 keyboard-show race | ConfirmDialog Input + iOS keyboard | **POSSIBLE** — operator did NOT have to type before freeze if the freeze happened post-button-tap (after type-to-confirm). Defer to live capture; if freeze happens AFTER tapping Cancel (input already blurred), this is irrelevant. |
| A-H13 | Realtime channel storm | [useBrands.ts:122 + useBrand:167 realtime subs](mingla-business/src/hooks/useBrands.ts#L122-L187) | **DEFERRED** — possible compounding factor if order Realtime fires during cancel cascade, but hub-list mounts the same brand-detail realtime sub via the user's home navigation. Not a primary discriminator. |

### Verdict on the hypothesis ladder

- **5 disproven structurally** (A-H3, A-H4, A-H5, A-H6, A-H8) — hub-list has identical mechanics in those areas and doesn't freeze.
- **2 disproven by data** (A-H7 — RPC works; A-H11 — diff is in different files).
- **5 deferred to live capture** (A-H2, A-H9, A-H10, A-H12, A-H13) — of these, **A-H2 is the only one structurally matching the event-detail-vs-hub-list discriminator**.

**Leading candidate: A-H2.** The mechanism is: cache-write triggers refetch on the active `useBusinessEventById` subscriber that the event-detail screen IS, while the ConfirmDialog Modal is mid-dismiss-animation. Hub-list isn't subscribed to that detail key so its flow doesn't see the refetch storm. Confidence: `suspected` (source-only ceiling per Phase 0.A) until the freeze capture lands.

---

## 5. Five-truth-layer reconciliation

| Layer | What it says |
|---|---|
| **Docs** | Spec §5 F-1 says drop navigation, screen re-renders in place. SC-1 says "Cancel completes without freezing". Live evidence contradicts spec. |
| **Schema** | RPC `business_cancel_event` (migration `20260515000005`) UPDATEs status='cancelled' under FOR UPDATE lock + returns published event. No triggers cascade. RPC behaviour is correct. |
| **Code** | Post-F-1 `handleCancelConfirm` is sound (no router calls, error path preserved, finally clause closes submitting state). Difference between event-detail and hub-list is the React Query subscriber-graph above the handler. |
| **Runtime** | Operator-confirmed freeze on sim+device. My sim attempts couldn't reach the Cancel tap to capture log frame. Phase 0.A live capture deferred to operator hand-tap. |
| **Data** | DB cancel succeeds (`Test Stripe.The ripe` historic cancel at 15:18:08Z). No data-side anomaly. |

Layers reconcile cleanly except Docs vs Runtime. The bug is in the cache-subscriber interaction (Code layer) which is invisible to Docs and not directly probeable by Data.

---

## 6. Fix direction (NO SPEC — direction only)

If A-H2 is confirmed by live capture, the fix shape is one of:

1. **Skip the detail-key invalidate when the cache was just authoritatively set via `setQueryData`.** Remove `queryClient.invalidateQueries({ queryKey: businessEventKeys.detail(published.event.id) })` from [useBusinessEvents.ts:66](mingla-business/src/hooks/useBusinessEvents.ts#L66) on the basis that the preceding `setQueryData` already provides the new authoritative data — refetch would just re-fetch the same row we just wrote. **Cheapest fix; mirrors what hub-list naturally has via the list-key.**
2. **Defer the detail-key invalidate to after the ConfirmDialog dismisses.** Wrap in `requestAnimationFrame` or `setTimeout(0)`. Brittle; not preferred.
3. **Replace the `setQueryData + invalidate` pair with `queryClient.setQueryData + queryClient.refetchQueries({queryKey, type: 'active'}).` to control the refetch timing precisely**, OR with `cancel + setQueryData` to interrupt any in-flight refetch.

Option 1 has the smallest blast radius and aligns with the "setQueryData already wrote authoritative data" intent. The hub-list flow effectively does this for the detail key (it's not an active subscriber, so the invalidate is a no-op). Event-detail's active subscription is what makes the invalidate damaging.

The actual SPEC AMENDMENT (after `proven` is reached) will specify the exact line to remove plus a unit test that asserts no `invalidateQueries({detail})` immediately after `setQueryData(detail)` in this codepath, plus a sim live-fire regression test.

The original F-1 (drop `router.replace`) **may still be valid** as a defensive change against a related but distinct race — but per the falsification it is NOT the primary fix. Recommend keeping F-1 in the bundle since it's structurally clean and removes a redundant navigation, but the headline Symptom A fix is the cache-invalidate change.

F-2 (DISCOVERY-7 date-aware brand-delete) and F-3 (`liveEventStore` v4→v5) remain VALID and ship unchanged.

---

## 7. Constitutional + invariant implications

- **Const #2 (one owner per truth):** `setQueryData` followed by `invalidate` in the same tick effectively creates two writes to the same query state from one operation. Borderline violation. Removing the invalidate consolidates ownership.
- **Const #3 (no silent failures):** the freeze IS a silent failure — no toast, no log, no error surface. Whatever fix lands must guarantee an observable error path if the dismiss-vs-refetch race ever re-emerges.
- **I-PROPOSED-J (Zustand persist no server snapshots):** unchanged. F-3 still satisfies.

No new invariant proposed yet; SPEC amendment may codify "no detail-key invalidate when setQueryData(detail) was the source of new data in the same handler."

---

## 8. Confidence

**`probable` for the narrowed hypothesis space (A-H2 leading) — `suspected` per Phase 0.A ceiling without live freeze capture.** The leading candidate is the ONLY hypothesis structurally consistent with the event-detail-vs-hub-list discriminator after eliminating A-H1, A-H3, A-H4, A-H5, A-H6, A-H7, A-H8, A-H11 with structural disproofs or behavioural evidence.

To promote to `proven`: operator performs the 4-tap Cancel sequence on the booted sim with the streaming logs (instructions in §11 below). The freeze frame will show one of:
- React Query refetch storm in JS bridge (confirms A-H2)
- UIKit `Attempt to dismiss... while presentation in progress` (also A-H2 mechanism)
- Reanimated worklet failure (would re-promote A-H6 — but disproven structurally)
- Hermes GC pause (A-H10)
- Other unanticipated pattern → re-investigation

---

## 9. Discoveries for orchestrator

- **DISCOVERY-rwk-1 (P3, separate ORCH-0863 candidate):** the 18k+ sim syslog lines captured during ~5 minutes of normal navigation are dominated by `(Network) [com.apple.network:endpoint]` chatter (TCP socket churn from Supabase Realtime channels). The pattern `endpoint Hostname#X:443 has nothing to cleanup, no protocol instance registrars / has associations` repeats hundreds of times per second. Suggests Realtime connection churn / subscription leak independent of ORCH-0862. May be related to A-H13 but warrants its own observability ORCH if real users hit network slowness. Not blocking this rework.
- **DISCOVERY-rwk-2 (P4, positive):** the prior investigation's structural disproof of A-H4, A-H5, A-H6, A-H8 holds up under this rework's re-inspection. The earlier failure was NOT a wide-coverage gap — it was specifically that A-H2 was hand-waved away when it should have been the leading candidate. Documenting this in the §10 retrospective.
- **DISCOVERY-rwk-3 (P3):** the cancel handler's `setCancelDialogVisible(false)` runs ONLY on the success branch of the try/catch. On error, the dialog stays open with the input cleared (because `confirmInput` state in ConfirmDialog isn't reset until the next mount). Operator could see "I typed but nothing happened" if the cancel mutation errors silently. Defensive: clear input on error toast too. Not freeze-related; minor UX flaw.

---

## 10. Retrospective — what the prior investigation got wrong

Honest accounting per the brutal-prompt §7 accountability addendum:

**Mistake 1:** the prior investigation labeled A-H2 (cache-write triggers refetch on the screen's own subscriber) as "DISPROVEN" with the reasoning "`getBusinessEventById` still returns the now-cancelled event (no `deleted_at` filter on the row), so `resolvedLiveEvent !== null`." That reasoning addresses ONLY the empty-shell scenario (whether resolvedLiveEvent goes to null), not the broader mechanism class (whether the refetch storm collides with Modal dismiss animation). The hypothesis was too narrowly stated and then disproven against the narrow statement, leaving the broader mechanism unchecked.

**Mistake 2:** A-H1 (`router.replace` race) was elevated to "leading candidate" on the strength of a plausible iOS UIKit interaction model, with confidence labeled `probable` and live-fire deferred under the Maestro tap-on-Cancel-row blocker. The Case-B operator-hand-tap clause was AVAILABLE per Phase 0.A but not exercised. The shortcut was accepted and the spec/implementation pipeline ran on top of an unverified diagnosis.

**Mistake 3:** the QA report's CONDITIONAL PASS verdict noted the Maestro tap blocker as a tooling gap rather than as a verification gap. The right move was to escalate to operator immediately for the manual freeze capture, with the QA artifact LOCKED at "diagnosis unverified" until the capture landed.

**Lesson codifiable into MEMORY.md post-close:** *for any UI/runtime hypothesis where the mechanism touches React Query cache-subscriber interaction with active subscribers on the rendering screen, structurally disprove the broader mechanism class — not the narrow specific symptom. AND when sim driving is blocked at a specific tap, immediately route to Case-B operator hand-tap rather than absorbing the gap as "tooling limitation" and shipping a probable-confidence fix.*

This rework structurally disproves 7 hypotheses with confidence and isolates A-H2 as the leading candidate using a different lens (the event-detail-vs-hub-list discriminator) — the lens the prior pass should have used.

---

## 11. What needs to happen to promote → `proven`

Operator performs the Cancel sequence on the booted sim with logs already streaming. Instructions:

**Step 1.** The sim is booted (`17091E60-C3B6-4167-980D-60C348E177F6`), the app is launched on Leggo This home, and two log streams are running in background (`/tmp/orch0862-rework-symptomA-syslog.txt` and `/tmp/orch0862-rework-symptomA-uikit.txt`). Verify with: `pgrep -af "simctl spawn.*log stream"` → should show 2 PIDs.

**Step 2.** On the sim, tap **The Reckoning** event row in the Upcoming list. Wait for event-detail to render.

**Step 3.** Tap the **⋯** menu icon at the top right. Manage menu sheet slides up.

**Step 4.** Dismiss the forwardRef redbox if present (tap its X at bottom right).

**Step 5.** Tap **Cancel event** (red trash row at the bottom of the manage menu).

**Step 6.** ConfirmDialog appears. Type `The Reckoning` exactly into the input.

**Step 7.** **Note the exact wall-clock time** (e.g., write down `t = HH:MM:SS`).

**Step 8.** Tap the red **Cancel event** destructive button inside the dialog.

**Step 9.** Wait for the freeze. **Note the exact wall-clock time when the freeze begins** (`t_freeze_start`) and observe whether it ever recovers, OR whether you have to force-quit (`t_freeze_end_via_force_quit`).

**Step 10.** Report back the two timestamps. I'll then `head -50` and `tail -100` the relevant log windows to identify the mechanism.

Alternative: if the sim is uncooperative, perform the same 9-tap sequence on the physical iPhone dev build (pre-F-1) — same instrumentation works via Console.app filtering on `minglabusiness`. Either target's freeze frame is decisive.

When the timestamps arrive, I'll close this rework with a `proven`-confidence root cause and emit a spec amendment for the implementor.
