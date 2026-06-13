# INVESTIGATE — ORCH-1120: Published-trip Settings refund-tiers + booking-deadline are read-only with a dead-end "edit in the wizard" pointer

**Date:** 2026-06-11
**Investigator:** mingla-forensics (INVESTIGATE mode)
**ORCH-ID:** ORCH-1120
**Severity (registered):** S2-medium · `bug` + `ux` + `quality-gap` · candidate Constitution #1 (orphaned control) + #3 (silent dead-end)
**Surfaces in scope:** business-iOS, business-Android (+ adjacent business-web preview — same component)
**Anchor:** investigated read-only against `~/Desktop/mingla-main` on `main`. No product code touched.
**Comms ledger:** scanned on entry — no OPEN row targets ORCH-1120, `mingla-forensics`, or `ALL`. Only ORCH-0955-scoped rows present. Nothing to ack.

---

## 1. Symptom (expected vs actual)

**Seth's report:** In the business app, open a PUBLISHED trip's edit screen → "Settings" section. It shows:

> "Refund tiers and booking deadline are managed from the trip wizard (Step 5: Cancellation & deadline). Open the wizard from the draft trip menu to edit these."

Booking deadline is read-only text; the "Bookings closed" `Switch` is `disabled`; refund policy is a read-only tier-count summary. Seth asks: (1) **why** does he see this message, and (2) **why** can't he then actually edit refund tiers / booking deadline anywhere.

**Expected (Seth's mental model):** the hint implies a reachable "wizard / draft trip menu" path where these are editable.
**Actual:** no such path exists for a published trip. The fields are read-only on this screen AND there is no other operator surface that can edit them for a published trip. The pointer points at nothing.

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (header L1-42, settings case L1291-1338) | The screen + the read-only Settings case + hint copy |
| 2 | `mingla-business/app/trip/[id]/edit.tsx` | The status-based dispatch (which editor renders for which status) |
| 3 | `mingla-business/src/components/trip/TripManageMenu.tsx` | The "trip menu" the hint references — does it offer a wizard/revert path? |
| 4 | `mingla-business/src/components/trip/TripCreatorWizard.tsx` (Step 5 wiring L72-100, L159, L643-714, L1189-1232) | Does the wizard's Step-5 editor run for a published trip? |
| 5 | `mingla-business/src/services/tripsService.ts` (`LiveTripPatch` L1146-1167, `updateLiveTripFields` L1207-1250) | Does the live-update path even carry refund/deadline fields? |
| 6 | `supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql` (RPC UPDATE L360-384) | Does the server RPC apply refund/deadline columns? |
| 7 | Later RPC-touching migrations: `…0880…`, `…0950…` (x2), `…1016…`, `…1075…` | Did any later migration add refund/deadline to the RPC? (migration-chain rule) |
| 8 | `mingla-business/src/services/refundPolicyService.ts` (`updateRefundPolicy` L145-212, `updateBookingDeadline` L219-251) | Are the columns server-immutable after publish, or freely writable? |
| 9 | `supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql` | Column-defining migration — is there a status-immutability constraint? |
| 10 | `Mingla_Artifacts/MASTER_BUG_LIST.md` (ORCH-1120 + ORCH-1118 INTAKE notes) | Precedent: the sibling parity gap on the same screen |

---

## 3. Q-scorecard

### Q1 — What renders the Settings tab for a published trip, and is it read-only?
**Verdict: PROVEN read-only.** `EditPublishedTripScreen.tsx` `renderSectionBody` `case "settings"` (L1291-1338) renders three rows: booking-deadline as formatted `Text`, a `Switch` with a hardcoded `disabled` prop (L1317), and refund-policy as a tier-count `Text` summary. No editor, no handler, no mutation. The file's own header docstring (L17) declares the design: **"6. Settings → read-only refund-policy + booking-deadline snapshot."** Every OTHER section on this screen IS editable (Basics, Itinerary, Inclusions, Pricing, Cover, Intake — each wires a live editor + the `biz_update_live_trip` save flow). Settings is the lone read-only section.

### Q2 — Is there ANY reachable path from a published trip back into the Step-5 editors?
**Verdict: PROVEN unreachable. The "draft trip menu" pointer points at nothing.** The edit route `app/trip/[id]/edit.tsx` dispatches purely on `trip.status` (L150-221): `scheduled`|`live` → `EditPublishedTripScreen`; `ended`|`cancelled` → frozen read-only state; `draft` → `TripCreatorWizard`. There is **no revert-to-draft mutation** anywhere (grep of `useTrips.ts`/`tripsService.ts` for `revert`/`to_draft`/`unpublish` returns nothing). `TripManageMenu.tsx` offers only: View public page, Share trip link, **Edit trip** (→ `/trip/{id}/edit`, the same status-dispatch route), Cancel trip — no "open wizard"/"revert to draft" row. So for a `scheduled`/`live` trip, every entry point ("Edit trip", direct nav) lands on `EditPublishedTripScreen`; the wizard is **categorically unreachable** once published. The hint's "Open the wizard from the draft trip menu" describes a path that does not exist for the trip the operator is looking at.

### Q3 — Does TripCreatorWizard Step 5 edit these for an already-published trip, or only a draft?
**Verdict: PROVEN draft-only.** The wizard is only ever mounted by the `status === draft` branch of the dispatch (`edit.tsx` L185-221). Its Step-5 editor (`TripCreatorStep5Policy`, holding `RefundPolicyEditor` + `BookingDeadlinePicker`) and its `autosaveStep5` (`TripCreatorWizard.tsx` L647-657, writing `refund_policy` + `booking_deadline` via `updateRefundPolicy`/`updateBookingDeadline`) only run inside the wizard. Because the wizard never mounts for a published trip, Step 5 never runs for one. The editors exist and work — they're just gated behind a screen the published trip can't reach.

### Q4 — WHY read-only: deliberate post-publish immutability guard, or unfinished parity gap?
**Verdict: PROVEN unfinished parity gap — NOT an immutability guard.** Three independent proofs:
1. **The live-update contract has no slots for these fields.** `LiveTripPatch` (`tripsService.ts` L1151-1167) — the ONLY shape `updateLiveTripFields`/`biz_update_live_trip` accepts — has keys for title, description, theme, days, inclusions, pricing_tiers, and 7 cover_media_* fields. It has **no** `refund_policy`, `booking_deadline`, or `bookings_closed` key. The published-edit path literally cannot transmit them.
2. **The server RPC never touches those columns.** `biz_update_live_trip`'s `UPDATE events` (migration `20260616000000` L360-384) sets title, description, and cover_media_*. It does NOT set refund_policy / booking_deadline / bookings_closed. No later migration (`0880`, `0950`x2, `1016`, `1075`) adds them (grep count = 0 in every one).
3. **The columns are NOT frozen after publish.** `updateRefundPolicy` (`refundPolicyService.ts` L145-212) and `updateBookingDeadline` (L219-251) write straight to `events` scoped only by `id` + `event_type='trip'` — **no status gate, no orders/refund-gate, no draft-only check.** The TR4 column-defining migration (`20260612000000`) adds a shape-validation CHECK only — no status-immutability constraint. The events update RLS for planners is brand-ownership scoped, not status-scoped. So the columns are perfectly writable on a published row; they're read-only on the screen purely because the UI never wires the editors and the RPC patch never carries them. This is the **same shape as ORCH-1118** (free-text departure/destination omitted from the same `EditPublishedTripScreen` — an unfinished published-edit parity gap), explicitly cross-referenced in the ORCH-1120 INTAKE note.

### Q5 — Does the hint copy tell the truth? (five-truth-layer)
**Verdict: PROVEN false / misleading.** The copy asserts an edit path ("Open the wizard from the draft trip menu to edit these") that does not exist for a published trip (Q2). It is a **Constitution #1 violation (orphaned control / dead-end pointer)** and **#3 violation (misleading silent dead-end)** — it directs the operator to a non-existent action and leaves them with no way to do the thing it implies is possible.

---

## 4. Findings (six-field evidence)

### F-1 — Settings section is hardcoded read-only; no editor wired (CONFIRMED ROOT CAUSE, proven-by-source)
- **Symptom:** booking deadline shows as text, "Bookings closed" Switch can't be toggled, refund policy is a count.
- **Layer:** code (component).
- **Probe:** read `EditPublishedTripScreen.tsx` L1291-1338 + header L1-42.
- **Evidence:** `case "settings"` renders `<Text>` snapshots + `<Switch … disabled … />` (L1314-1325, `disabled` hardcoded at L1317). No `onValueChange`, no editor, no mutation. Header L17: *"6. Settings → read-only refund-policy + booking-deadline snapshot."*
- **Mechanism:** ORCH-0876 shipped Settings as a deliberate read-only SNAPSHOT and deferred the live editors → the operator sees only static values + a disabled toggle.
- **Severity:** CONFIRMED ROOT CAUSE.

### F-2 — The hint points at an unreachable path (CONFIRMED ROOT CAUSE, proven-by-source)
- **Symptom:** "Open the wizard from the draft trip menu to edit these" — there is no such menu/path for a published trip.
- **Layer:** code (routing + copy).
- **Probe:** read `app/trip/[id]/edit.tsx` L150-221 + `TripManageMenu.tsx`; grep `revert|to_draft|unpublish` across `useTrips.ts`/`tripsService.ts`.
- **Evidence:** dispatch is status-only — `scheduled`/`live` → `EditPublishedTripScreen` (L150-151); no revert-to-draft mutation exists (grep empty); `TripManageMenu` rows = View / Share / Edit trip (→ same route) / Cancel. No wizard/revert row.
- **Mechanism:** a published trip can never route to the wizard, so the hint's pointer is a dead-end → Constitution #1/#3 violation.
- **Severity:** CONFIRMED ROOT CAUSE (the copy half of the bug).

### F-3 — Live-update contract + RPC omit refund/deadline; columns are NOT server-frozen (SECONDARY ROOT CAUSE, proven-by-source)
- **Symptom:** even if the UI wanted to save these on a published trip, the plumbing can't.
- **Layer:** code (service) + schema (RPC + constraints).
- **Probe:** read `LiveTripPatch` (`tripsService.ts` L1151-1167); `biz_update_live_trip` UPDATE (migration `20260616000000` L360-384); `refundPolicyService.ts` L145-251; migration-chain grep over `0880/0950/1016/1075`; TR4 migration `20260612000000`.
- **Evidence:** `LiveTripPatch` has no refund_policy/booking_deadline/bookings_closed key; RPC UPDATE sets only title/description/cover_media_*; later migrations add 0 references; `updateRefundPolicy`/`updateBookingDeadline` write to `events` with no status gate; TR4 migration adds shape-CHECK only, no immutability constraint.
- **Mechanism:** the read-only state is an unfinished parity gap, NOT a deliberate post-sale freeze — the persistence path simply was never extended to the published-edit screen. (Note: a future fix must decide whether refund/deadline edits on a live trip with confirmed orders need a refund-gate like the other live-edit fields, since the standalone service functions currently have none — flagged below.)
- **Severity:** SECONDARY ROOT CAUSE.

### F-4 — Refund/deadline standalone writes have no orders/refund-gate (SUSPECTED CONTRIBUTOR — flag for SPEC, proven-by-source)
- **Symptom:** N/A at runtime today (no UI calls these on published trips); a latent integrity gap for the fix to address.
- **Layer:** code (service) + schema (RLS).
- **Probe:** read `refundPolicyService.ts` L145-251.
- **Evidence:** both functions update `events` scoped only by `id`+`event_type='trip'`; no `status` filter, no affected-order check (unlike `biz_update_live_trip`, which runs an 8-reason refund-gate for tier/date/inclusion changes).
- **Mechanism:** if a future fix wires these editors to the published screen via the standalone functions, it would bypass the refund-gate other live edits enforce. The SPEC must decide whether published refund/deadline edits route through `biz_update_live_trip` (extended) or carry their own guard.
- **Severity:** SUSPECTED CONTRIBUTOR (decision input for the SPEC, not the active bug).

---

## 5. Five-truth-layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| **Docs** | ORCH-0876 header (L17) intentionally describes Settings as a "read-only snapshot." The in-UI hint claims an edit path via the wizard. | **Docs internally contradict:** the design doc says "read-only snapshot" (honest) but the shipped hint copy invents an edit path (dishonest). |
| **Schema** | `events.refund_policy/booking_deadline/bookings_closed` are freely writable on any status (shape-CHECK only; no immutability constraint; RLS is ownership-scoped). | Schema permits editing → contradicts the UI's read-only presentation. The lock is UI-only, not schema-enforced. |
| **Code** | `EditPublishedTripScreen` renders read-only; `LiveTripPatch` + RPC omit the fields; the wizard (which can edit them) is unreachable post-publish. | Code path to edit exists ONLY in the wizard, which is gated to drafts → the hint's promise is uncoded for published trips. |
| **Runtime** | Not driven on device (business-app trip authoring is login-gated in sim; same blocker noted in ORCH-1116). Structural facts above are proven-by-source, not runtime-observed. | Capped at "proven-by-source" for the structural claims; the on-device *visual* of the disabled switch is "suspected" pending Seth's eyeball. |
| **Data** | No data query needed — the bug is structural (missing code path), not a data-state bug. | None. |

---

## 6. Repro evidence

**Not driven on simulator.** This is a structural/architectural investigation: the read-only state, the unreachable wizard, and the missing RPC/patch fields are facts in source + migrations, not runtime-emergent behavior. Business-app trip authoring is login-gated in the sim (the same blocker recorded for ORCH-1116, where the GIF-card on-device repro was deferred to a Seth confirm). Per Prime Directive 7, the structural conclusions are labeled **proven-by-source**; the on-device *appearance* of the disabled Switch + hint copy is labeled **suspected** pending Seth's 20-second eyeball (open any scheduled/live trip → Edit → Settings).

---

## 7. Blast radius / cross-surface map

- **business-iOS / business-Android — IN SCOPE.** Shared `EditPublishedTripScreen` + shared dispatch + shared service. Both platforms render the identical read-only Settings + dead-end hint (RN shared code → automatic parity).
- **business-web preview — IN SCOPE (adjacent).** Same component; same behavior.
- **consumer iOS/Android — OUT.** No trip authoring.
- **buyer/anon web — OUT.** Read-only public trip page; refund policy is *displayed* to buyers (consumes the same columns) but never edited there.
- **admin web — OUT.** No trip editor.
- **Sibling parity gap:** ORCH-1118 is the SAME class of defect on the SAME screen (free-text departure/destination omitted from `EditPublishedTripScreen`). The published-edit screen has at least two known parity holes; a sweep for others (does Settings vs wizard diff anywhere else?) is advisable but out of this ORCH's scope.

---

## 8. Invariant impact

- **Constitution #1 (no orphaned controls / dead-end pointers):** VIOLATED by the hint copy (F-2).
- **Constitution #3 (no misleading silent dead-ends):** VIOLATED — the copy implies an action that cannot be performed.
- **Audit-test invariant (`EditPublishedTripScreen` trip mutations route through `biz_update_live_trip`, header L37-39):** any fix that wires refund/deadline editing into this screen must EITHER extend `biz_update_live_trip` (preferred, keeps the audit invariant intact) OR explicitly carve out the standalone service functions — the latter risks the F-4 refund-gate bypass. Flagged for the SPEC; not pre-decided here.

---

## 9. Discoveries for orchestrator

- **DISC-1120-A:** `updateRefundPolicy`/`updateBookingDeadline` (`refundPolicyService.ts`) have NO status gate and NO affected-orders refund-gate. Harmless today (only the draft wizard calls them, where no orders exist), but a landmine if a fix reuses them for published trips. The SPEC must route published refund/deadline edits through the gated RPC or add an equivalent guard.
- **DISC-1120-B:** the ORCH-0876 design intentionally shipped Settings as read-only and deferred the editors — but the shipped *copy* over-promised an edit path. Whoever wrote the hint assumed a "revert to draft" affordance that was never built. Worth checking if other ORCH-0876 deferral copy makes the same promise.

---

## 10. Confidence

**root cause proven (by source) — high confidence.** All five questions are answered with verbatim source/migration evidence: read-only by design (F-1), unreachable wizard pointer (F-2), missing live-update plumbing with no immutability guard (F-3), latent ungated standalone writes (F-4). The only item not runtime-confirmed is the *visual* of the disabled Switch on a real device (login-gated sim) — capped at "suspected" and closable by a 20-second Seth eyeball. The architectural conclusions do not depend on that visual.

**Plain-English answers:**
1. **Why do I see this message?** Because ORCH-0876 (the screen that opens for published trips) intentionally shipped its "Settings" section as a read-only snapshot and never built the refund/deadline editors there — leaving a hint that tells you to "use the wizard."
2. **Why can't I then edit them anywhere?** Because the wizard the hint points to only opens for DRAFT trips. A published trip always opens this read-only screen instead (status-based routing, no "revert to draft" anywhere), so the pointer leads nowhere. And even the behind-the-scenes save path for published edits has no slots for refund policy or booking deadline, so nothing on this screen could persist them today.

**Intentional-guard vs unfinished-parity:** **Unfinished parity gap.** Deciding evidence: the columns are freely writable server-side (no status/immutability constraint, no refund-gate), and the live-update RPC + patch simply omit them — there is no freeze, just missing wiring. Same shape as ORCH-1118.

**Reachability verdict on the "draft trip menu" pointer:** **points at nothing.** No revert-to-draft path, no wizard entry for a published trip; `TripManageMenu`'s "Edit trip" re-enters the same status-dispatch that lands back on the read-only screen.

---

## 11. Recommended next phase + direction (NOT a spec)

**Next: forensics SPEC** (or DESIGN-then-SPEC if new editor layout is needed on the Settings tab).

**Single recommended direction — Option (a), wire the editors in:** wire the existing ORCH-0875 `RefundPolicyEditor` + `BookingDeadlinePicker` into the `EditPublishedTripScreen` "Settings" section (replacing the read-only snapshot + the dead-end hint), and EXTEND the `biz_update_live_trip` RPC + `LiveTripPatch` to carry `refund_policy` / `booking_deadline` / `bookings_closed` so saves route through the gated, audit-tested path (preserving the header L37-39 invariant and applying whatever refund-gate is appropriate for live trips with confirmed orders — see DISC-1120-A). The "Bookings closed" toggle should become live too. This closes the parity gap and removes the orphaned-control/dead-end copy in one move.

**Fallback — Option (b), only if Seth decides refund/deadline MUST be frozen after publish:** since nothing currently freezes them, "frozen" would be a NEW product decision, not the status quo. If chosen, replace the dishonest hint with honest locked-state copy that states WHY (e.g. "Refund terms are locked once a trip is published to protect existing buyers"). Option (a) is recommended because the data layer already supports editing and the editors already exist — the only thing missing is the wiring.

**The SPEC must resolve one open question:** do published refund/deadline edits need the same affected-orders refund-gate that tier/date/inclusion edits already enforce in `biz_update_live_trip`? (Decision input, not pre-decided here.)
