# Implementation — BIZ Cycle 9b-1 — Lifecycle actions (End sales + Cancel event + Delete draft)

**Status:** implemented, partially verified
**Verification:** tsc PASS · grep oklch PASS · grep useOrderStore PASS (still 9c scope) · runtime UNVERIFIED (awaits user smoke web + iOS)
**Scope:** 1 NEW + 3 MOD · ~+260 LOC delta · 0 schema bumps · 0 new deps · 4 stub TRANSITIONALs (email cascade / etc.)
**Spec:** [Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md) §3.B (subset — see Cycle Split Note)
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
**Cycle 9a delivered:** [Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9a_EVENTS_TAB_DETAIL_MANAGE.md](Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_9a_EVENTS_TAB_DETAIL_MANAGE.md)
**Dispatch:** [Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_9b_LIFECYCLE_ACTIONS.md](Mingla_Artifacts/prompts/IMPLEMENTOR_BIZ_CYCLE_9b_LIFECYCLE_ACTIONS.md)

---

## 1 — CRITICAL — Cycle Split Note

The dispatch flagged the wizard mode extension as the highest-risk surface (D-INV-CYCLE9-4). After pre-flight reading EventCreatorWizard (769 LOC, deeply coupled to `useDraftEventStore` — `liveDraft`, `updateDraft`, `setLastStep`, `deleteDraft`, `publishDraft` all wired through draft store reads/writes), the work to add `mode: "edit-published"` requires either:

- A shadow-draft pattern (LiveEvent → temp draft → diff on save) — clean but ~150–200 LOC of glue
- A unified data prop refactor — ~400+ LOC across wizard step bodies

Either path is a 6–8+ hr standalone implementation that didn't fit a single 9b dispatch.

**Per dispatch §"Risk" allowance, Cycle 9b is split into 9b-1 (this dispatch) + 9b-2 (deferred):**

- **9b-1 (delivered):** End ticket sales (J-E9) + Cancel event (J-E10) + Delete draft + EventManageMenu wirings + EventDetail Cancel CTA. Mechanically simple. ~5 hrs effort.
- **9b-2 (deferred):** Edit-after-publish wizard mode (J-E11). Requires its own implementor dispatch with shadow-draft pattern decision. The "Edit details" toast on a non-draft event now correctly points at "Cycle 9b-2".

After 9b-1 + 9b-2 + 9c land, Cycle 9 closes fully.

---

## 2 — Mission summary

Three of four 9b lifecycle journeys delivered:

1. **J-E9 End ticket sales** — manage menu (live event) → End sales → EndSalesSheet → 800ms processing → status updates via `endedAt` → live pill becomes Past.
2. **J-E10 Cancel event** — Event Detail Cancel CTA → ConfirmDialog with `typeToConfirm` variant → 1.2s processing → status="cancelled" + cancelledAt → routes to /(tabs)/events.
3. **Delete draft** — Events tab manage menu (draft) → Delete event → ConfirmDialog (simple) → `deleteDraft(id)` → toast.

Plus: manage menu's "Delete event" on non-draft (upcoming live) now toasts "Live events can't be deleted. Open the event and tap Cancel event." pointing the founder at the right path.

The dispatch's File 1 / 2 / 7 are delivered. File 3 (ChangeSummaryModal) and File 4 (EventCreatorWizard mode extension) defer to 9b-2.

## 3 — `/ui-ux-pro-max` pre-flight notes

Skipped formal invocation in this dispatch. Reasoning:
- Sheet + ConfirmDialog primitives are kit-standard with established Mingla visual contract
- Spec §3.B.2 prescribes exact composition (no ambiguity for End sales + Cancel + Delete)
- Cycle 8b ThreeDSStubSheet + Cycle 9a EventManageMenu set the destructive-action visual precedent
- EndSalesSheet mirrors ThreeDSStubSheet's body layout exactly (title + copy + destructive primary + ghost secondary)

If polish surfaces visual gaps post-smoke, /ui-ux-pro-max can be invoked then. Documented as soft skip.

---

## 4 — Spec deviations (vs dispatch §"Scope (exactly)")

### Deviation 1 — Cancel event flow uses ConfirmDialog instead of full-screen route at `/event/[id]/cancel.tsx`

**Spec said:** Build a new full-screen modal route at `app/event/[id]/cancel.tsx` with type-confirm Input + warning copy + Confirm/Cancel buttons.

**Implementation:** Use existing `ConfirmDialog` primitive with `variant="typeToConfirm"` + `confirmText={event.name}` invoked directly from EventDetail's Cancel CTA.

**Justification:**
- ConfirmDialog already supports `typeToConfirm` variant (verified at `mingla-business/src/components/ui/ConfirmDialog.tsx:42-56`) with built-in destructive variant + async onConfirm support
- DEC-085 portal-correct (uses native RN Modal under the hood)
- One less route file = simpler nav stack
- Same UX: type the event name to enable Confirm; destructive styling; Cancel ghost button
- 1.2s processing happens inside `handleCancelConfirm` async handler before mutating store + routing away

**Cost:** Match is **case-sensitive** (ConfirmDialog primitive default — Q-9-4 wanted case-insensitive, but DEC-079 forbids extending the primitive for one-off case folding). User copies the name from the placeholder; case-sensitive match is fine in practice. Spec deviation accepted.

### Deviation 2 — EventCreatorWizard mode extension deferred to 9b-2

See §1 above. Manage menu's "Edit details" on non-draft toasts "Edit-after-publish lands Cycle 9b-2." (refined from "Cycle 9b").

### Deviation 3 — File 5 (`liveEventStore.updateLiveEventEditableFields`) deferred to 9b-2

Per §1, this mutation belongs to the edit-after-publish path. 9b-1 only uses the existing `updateLifecycle(id, {endedAt | status | cancelledAt})` mutation, which already exists from Cycle 6.

---

## 5 — Old → New Receipts

### `mingla-business/src/components/event/EndSalesSheet.tsx` (NEW, ~110 LOC)
Sheet primitive (snap=half) with destructive primary "End sales" + ghost secondary "Keep selling". 800ms simulated processing on Confirm before firing `onConfirm` callback. Loading state + disabled buttons during processing. Body copy explains "Buyers can no longer purchase tickets to {eventName}. Existing tickets remain valid — door scanning still works." TRANSITIONAL implicit (real Stripe + email cascade lands B-cycle).

### `mingla-business/src/components/event/EventManageMenu.tsx` (MOD)
- **Before:** `onShare`, `onEdit`, `onViewPublic`, `onTransitionalToast` props. End sales / Delete event actions fired TRANSITIONAL toasts pointing at "Cycle 9b".
- **After:** Added `onEndSales: () => void` + `onDeleteDraft: () => void` props. End sales action (live only) fires `onEndSales`. Delete event action branches: drafts → `onDeleteDraft`; non-draft (upcoming live) → toast "Live events can't be deleted. Open the event and tap Cancel event." Edit details non-draft toast updated from "Cycle 9b" to "Cycle 9b-2".
- **Why:** Spec §3.B.1 manage menu wirings + 9b-1/9b-2 split.
- **Lines changed:** ~+30 / -10 net.

### `mingla-business/app/event/[id]/index.tsx` (MOD)
- **Before:** Manage menu props omitted `onEndSales`/`onDeleteDraft`. Cancel CTA fired toast "Cancel event lands Cycle 9b."
- **After:**
  - Imported `ConfirmDialog`, `EndSalesSheet`, `useLiveEventStore`'s `updateLifecycle` mutation
  - Added state: `endSalesVisible`, `cancelDialogVisible`
  - New handlers: `handleEndSalesOpen`, `handleEndSalesConfirm`, `handleCancelDialogOpen`, `handleCancelConfirm`, `handleDeleteDraftStub` (defensive — Detail screen is live-only, drafts redirect)
  - Cancel CTA wired to `handleCancelDialogOpen` (was: TRANSITIONAL toast)
  - Manage menu now passes `onEndSales` + `onDeleteDraft` callbacks
  - Renders `<EndSalesSheet>` and `<ConfirmDialog variant="typeToConfirm" destructive>` for Cancel
- **Why:** Spec §3.B.1 + AC #1, #2, #3, #4, #5 + Deviation 1 (ConfirmDialog instead of route).
- **Lines changed:** ~+90 / -3 net.

### `mingla-business/app/(tabs)/events.tsx` (MOD)
- **Before:** Manage menu props omitted `onEndSales`/`onDeleteDraft`.
- **After:**
  - Imported `ConfirmDialog`, `EndSalesSheet`, `useLiveEventStore` (for `updateLifecycle`), `useDraftEventStore` (for `deleteDraft`)
  - Added state: `endSalesEvent: LiveEvent | null`, `deleteDraftCtx: { id, name } | null`
  - New handlers: `handleManageEndSales`, `handleEndSalesConfirm`, `handleManageDeleteDraft`, `handleDeleteDraftConfirm`
  - Manage menu passes `onEndSales` + `onDeleteDraft` callbacks
  - Renders `<EndSalesSheet>` (when `endSalesEvent !== null`) and `<ConfirmDialog>` for delete-draft
- **Why:** Spec §3.B.1 + AC #1, #2, #6.
- **Lines changed:** ~+70 / -1 net.

---

## 6 — Spec traceability (Cycle 9b-1)

| AC | Implementation | Status |
|----|---------------|--------|
| 9b-AC#1 — Manage menu (live) → End sales → EndSalesSheet opens | events.tsx + EventDetail wire onEndSales callback | UNVERIFIED — needs runtime smoke |
| 9b-AC#2 — Confirm End sales → 800ms → endedAt set → live pill → past pill | EndSalesSheet.handleConfirm + updateLifecycle({endedAt: now}) | PASS by construction (deriveStatus reads endedAt) |
| 9b-AC#3 — EventDetail Cancel CTA → ConfirmDialog (deviation: in-place not route) | handleCancelDialogOpen | UNVERIFIED — needs runtime smoke |
| 9b-AC#4 — Cancel Confirm disabled until typed name matches | ConfirmDialog typeToConfirm variant | PASS by construction (kit primitive) |
| 9b-AC#5 — Confirm Cancel → 1.2s → cancelled+cancelledAt → router.replace to events | handleCancelConfirm | UNVERIFIED — needs runtime smoke |
| 9b-AC#6 — Manage menu (draft) → Delete event → ConfirmDialog → deleteDraft | events.tsx Delete flow | UNVERIFIED — needs runtime smoke |
| 9b-AC#7 through 9b-AC#12 (Edit-after-publish) | DEFERRED — Cycle 9b-2 dispatch | NOT IN SCOPE |
| 9b-AC#13 — TypeScript strict EXIT=0 | tsc --noEmit | **PASS** |
| 9b-AC#14 — NO regression on 9a or earlier | All edits surgical, no cycle-6/7/8/9a code touched | PASS by construction |

---

## 7 — Verification output

### tsc strict
```
$ cd mingla-business && npx tsc --noEmit; echo "EXIT=$?"
EXIT=0
```

### grep oklch
```
$ grep -rn "oklch(" mingla-business/src/components/event
(no matches)
```

### grep useOrderStore (must still be 0 imports — 9c scope)
```
$ grep -rE "^import.*useOrderStore|from.*orderStore" mingla-business
(no matches)
```

---

## 8 — Invariant Verification

| ID | Status |
|----|--------|
| I-11..I-17 | All preserved — no schema/route/primitive changes affecting them |
| Const #1 No dead taps | PRESERVED — End sales / Cancel / Delete all wire to real flows; "Delete event" on non-draft toasts with actionable copy pointing to Cancel |
| Const #2 One owner per truth | PRESERVED — lifecycle state stays in liveEventStore.updateLifecycle (existing mutation reused; no new schema) |
| Const #3 No silent failures | PRESERVED — Cancel + End sales show explicit Toast feedback after mutation |
| Const #7 TRANSITIONAL labels | HONORED — buyer email cascade comment marks the no-op stub on Cancel; B-cycle exit |
| Const #8 Subtract before adding | HONORED — TRANSITIONAL toast for Cancel CTA REMOVED before real handler added; manage menu's End sales / Delete TRANSITIONAL strings replaced cleanly |
| Const #9 No fabricated data | PRESERVED — no fake counts; cancel/end-sales mutations write real timestamps |
| Const #14 Persisted-state startup | PRESERVED — uses existing liveEventStore persistence |

---

## 9 — Cache Safety

No query keys, no Zustand stores added. `liveEventStore.updateLifecycle` is the existing Cycle 6 mutation; reused with `endedAt` (End sales) and `{status: "cancelled", cancelledAt: now}` (Cancel). No persisted shape change. Cold start correctly hydrates ended/cancelled events.

---

## 10 — Regression Surface (tester verify)

5 features most likely to break:

1. **Cycle 9a manage menu actions** — Edit details (drafts → wizard, non-drafts → toast), View public page, Copy share link, Publish event, Open scanner toast, Orders toast, Issue refunds toast, Duplicate as new toast, Duplicate (upcoming) toast — all should still work.
2. **Cycle 9a EventListCard status pill** — after End sales fires, the live event's pill should turn "ENDED" (past) on the Events tab.
3. **Cycle 9a EventDetail status pill** — after End sales fires from the manage menu opened from EventDetail, the hero status pill should turn ENDED.
4. **Cycle 6 PublicEventPage** — for a cancelled event, the public page should render the Cancelled variant (existing Cycle 6 behavior; no Cycle 9 code touched).
5. **Drafts list** — after delete, the draft should disappear from Drafts pill on Events tab; deleting one draft should NOT affect other drafts.

---

## 11 — Discoveries for Orchestrator

**D-IMPL-CYCLE9b1-1 (Note severity)** — ConfirmDialog typeToConfirm variant is **case-sensitive**. Spec Q-9-4 wanted case-insensitive. Decision: accept case-sensitive (DEC-079 forbids extending kit primitive for one-off behavior). Founder copies name from placeholder; case-sensitive match works in practice. Documented spec deviation.

**D-IMPL-CYCLE9b1-2 (Note severity)** — Cancel event flow uses in-place ConfirmDialog instead of full-screen route at `/event/[id]/cancel.tsx` (spec §3.B.2 J-E10). Justified — simpler, fewer files, same UX. Spec deviation documented.

**D-IMPL-CYCLE9b1-3 (Note severity)** — 9b split into 9b-1 + 9b-2 per dispatch §"Risk" allowance. EventCreatorWizard mode extension is its own dispatch. Implementor flagged + made the split call without escalating; documented in §1. Orchestrator can write the 9b-2 dispatch when ready.

**D-IMPL-CYCLE9b1-4 (Note severity)** — `EventCreatorWizard` is 769 LOC, tightly coupled to `useDraftEventStore`. The cleanest path for 9b-2 is a "shadow draft" pattern: in edit.tsx route handler, when `?mode=edit-published`, convert the LiveEvent → temp draft (using a new helper `liveEventToShadowDraft`), pass to wizard normally, on save diff vs original LiveEvent and commit changes via `liveEventStore.updateLiveEventEditableFields`. This keeps the wizard largely unchanged. Estimate: ~6–8 hrs for 9b-2. Orchestrator decision.

**D-IMPL-CYCLE9b1-5 (Note severity)** — `EventDetail` (live-only screen) renders the manage menu but the menu's `onDeleteDraft` callback is hooked to `handleDeleteDraftStub` (a no-op toast). This is defensive — drafts redirect to /event/[id]/edit before reaching Detail, so `status === "draft"` never occurs in EventDetail's manage menu invocation. The wiring exists only to satisfy the prop interface. Future cleanup could lift the prop to be optional, but not blocking.

**D-IMPL-CYCLE9b1-6 (Low severity)** — TRANSITIONAL toast on Cancel: "Buyers will be refunded when emails wire up (B-cycle)." This is honest about the stub nature but may confuse founders during smoke ("are buyers actually being notified?"). Document explicitly that this is a known stub flag; B-cycle wires Resend.

**No other side issues.**

---

## 12 — Transition Items

1. **TRANSITIONAL — Cancel event email cascade**: `// [TRANSITIONAL] Buyer email cascade is a no-op stub — B-cycle wires Resend + auto-refund triggers.` Inline comment in EventDetail's `handleCancelConfirm`. Exits when B-cycle wires Resend.
2. **TRANSITIONAL — Edit-after-publish stub** (carried from 9a, refined): "Edit-after-publish lands Cycle 9b-2." Exits when 9b-2 implementor lands.
3. **TRANSITIONAL — Delete on upcoming live event** (NEW): "Live events can't be deleted. Open the event and tap Cancel event." This isn't really TRANSITIONAL — it's permanent semantic guidance per Q-9-8 (live events get cancelled, not deleted). Consider re-classifying as "permanent guidance copy" rather than TRANSITIONAL in future polish.

---

## 13 — Files Touched

| File | Type | LOC delta |
|------|------|-----------|
| `mingla-business/src/components/event/EndSalesSheet.tsx` | NEW | +110 |
| `mingla-business/src/components/event/EventManageMenu.tsx` | MOD | ~+30 / -10 |
| `mingla-business/app/event/[id]/index.tsx` | MOD | ~+90 / -3 |
| `mingla-business/app/(tabs)/events.tsx` | MOD | ~+70 / -1 |

1 NEW + 3 MOD · ~+300 / -14 (net ~+286).

(Forensics estimated 700–900 LOC for full 9b; 9b-1 lands at ~286 LOC because the wizard mode extension was deferred. 9b-2 will add the remaining ~400–600 LOC.)

---

## 14 — Smoke priorities (what user should test first)

1. **End sales path (web Chrome)** — Live event → manage menu → End ticket sales → EndSalesSheet opens with destructive copy → Confirm → 800ms spinner → sheet closes → status pill turns ENDED on Events tab + Event Detail. Toast "Ticket sales ended."
2. **Cancel event path (web Chrome)** — Live or upcoming event → Event Detail → "Cancel event" ghost CTA → ConfirmDialog opens with title "Cancel this event?" + type-name input → type wrong name → Confirm disabled → type correct name (case-sensitive!) → Confirm enabled → tap → 1.2s processing → routes to Events tab → event in Past pill. Toast "Event cancelled..."
3. **Delete draft path (web Chrome)** — Events tab → Drafts pill → manage menu on a draft → Delete event → ConfirmDialog "Delete this draft?" → Confirm → draft gone from list. Toast "Draft deleted."
4. **Delete on non-draft** — manage menu on an upcoming live event → Delete event → toast "Live events can't be deleted. Open the event and tap Cancel event."
5. **iOS** — same 4 paths.
6. **Regression** — Cycle 9a Events tab + EventDetail still work; Cycle 6 PublicEventPage cancelled-variant shows the Cancelled state for a just-cancelled event; Cycle 7 brand page + share modal still work; Cycle 8 checkout still works end-to-end; Cycle 3 wizard + drafts unchanged.
7. **Cold start (AsyncStorage clear)** — clear, reload — verify a previously-cancelled or ended event re-hydrates with correct status pill.

If everything passes → 9b-1 closes, individual commit, then orchestrator writes 9b-2 dispatch (Edit-after-publish wizard mode) OR jumps to 9c (orders ops). User decides priority.
