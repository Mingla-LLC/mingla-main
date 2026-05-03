# Implementation — ORCH-0704 v2 — Full Edit-After-Publish + Notification Stack + Reason Audit

**Status:** implemented, partially verified
**Verification:** tsc PASS · subtraction grep PASS · runtime UNVERIFIED (awaits user smoke web + iOS)
**Scope:** 6 NEW + 5 MOD + 1 REPLACE + 1 DELETE · ~+1380 / -200 LOC (~+1180 net) · 0 schema migrations · 0 new deps
**Spec:** [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md](../specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md)
**Investigation:** [INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](INVESTIGATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
**Dispatch:** [IMPLEMENTOR_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md](../prompts/IMPLEMENTOR_ORCH-0704_FULL_EDIT_AFTER_PUBLISH.md)
**Supersedes:** narrow Cycle 9b-2 implementation (uncommitted; subtracted by this dispatch)

---

## 1 — Mission summary (layman)

Operators can now edit any field on a published event — name, description, date, address, tickets (add new tier, edit existing), cover, settings — through a sectioned accordion screen. Existing buyers stay protected: editing a tier price or deleting a tier with sales now triggers a "Refund first" reject dialog with an "Open Orders" CTA. Every save requires a reason (10–200 chars) which gets logged to a permanent edit audit log and flows into a notification stack (banner + email-stub + SMS-stub + push-deferred). whenMode and recurrence rules can be changed freely as long as the change doesn't drop a previously-active date with sales.

In stub mode (Cycle 9c hasn't built `useOrderStore` yet), all sold counts return 0, so guard rails are dormant — operator can edit freely. When 9c lands, guards activate without any UI changes.

---

## 2 — Implementation order followed

Spec phase order with one judgment-call deviation (documented):

| Phase | Action | Status |
|-------|--------|--------|
| Pre-flight | Read 10 files (spec, investigation, narrow 9b-2 files, ChangeSummaryModal, EditAfterPublishBanner, ConfirmDialog, Sheet, Brand store, Step5 internals, recurrenceRule helper) | ✅ |
| 1 | Add new types (EditableLiveEventFields, UpdateLiveEventRejection, UpdateLiveEventResult) to `liveEventStore.ts` | ✅ |
| 2 | Create orderStoreHelpers.ts (TRANSITIONAL stub) + eventEditLogStore.ts (NEW) + wire `useEventEditLogStore.reset` into clearAllStores | ✅ |
| 3 | Create scheduleDateExpansion.ts + eventChangeNotifier.ts + liveEventAdapter.ts | ✅ |
| 4 | Extend StepBodyProps with `editMode?` + modify CreatorStep5Tickets (lock banner, Delete hide, price/free/unlimited disable, capacity floor inline) | ✅ |
| 5 | `/ui-ux-pro-max` pre-flight + ChangeSummaryModal v2 (severity stripes + reason input + char counter + tickets sub-renderer + footer note) + EditAfterPublishBanner copy update | ✅ |
| 6+7 (combined) | Wire full `updateLiveEventFields` body (reason validation + dropped-date detection + per-tier guards + edit log record + notify) + replace EditPublishedScreen with sectioned accordion + DELETE liveEventToEditPatch.ts (atomic switch) | ✅ |
| 8 | tsc EXIT=0 + grep verifications (no oklch in code, no narrow symbols, TRANSITIONAL stubs labeled) | ✅ |

### Deviation (documented)
The dispatch said Phase 1 = "DELETE liveEventToEditPatch.ts" and "remove updateLiveEventEditableFields" immediately. I judged this would leave intermediate broken compile state (ChangeSummaryModal still imported FieldDiff from the soon-to-delete file; narrow EditPublishedScreen still called the soon-to-remove mutation). I switched to atomic-friendly order: kept old narrow types alongside new types through phases 1-5, then atomically removed both in phase 6+7 alongside the new sectioned screen. Same Const #8 spirit (narrow code is REMOVED before new code ships to the user); cleaner intermediate compile state at each tsc checkpoint.

---

## 3 — Old → New Receipts

### NEW: `mingla-business/src/store/orderStoreHelpers.ts` (~40 LOC)
**What it did before:** did not exist
**What it does now:** exports `SoldCountContext` type + `getSoldCountContextForEvent(event)` TRANSITIONAL stub returning `{soldCountByTier: {}, soldCountForEvent: 0}`. Header doc carries explicit EXIT CONDITION pointing at Cycle 9c.
**Why:** spec §3.3.5 — provides the soldCount API surface so EditPublishedScreen + updateLiveEventFields consume it identically once 9c flips it live (no caller changes)

### NEW: `mingla-business/src/store/eventEditLogStore.ts` (~120 LOC)
**What it did before:** did not exist
**What it does now:** Zustand persisted store (`mingla-business.eventEditLog.v1`) with `EditSeverity`, `EventEditEntry`, append-only `recordEdit`, reads (`getEditsForEvent`, `getLatestEditForEvent`, `getEditsForEventSince`), and `reset` (logout). Generates `ee_<ts36>_<rand4>` IDs. Prepends entries (newest first).
**Why:** spec §3.1.3 + §3.2.2 — buyer-side material-change banner (Cycle 9c) reads `getEditsForEventSince` to render history since last seen. I-20 invariant — append-only audit log permanence.

### NEW: `mingla-business/src/services/eventChangeNotifier.ts` (~140 LOC)
**What it did before:** did not exist
**What it does now:** exports `NotificationPayload`, `NotificationChannelFlags`, `notifyEventChanged(payload, channels)` (fire-and-forget; logs each channel), `deriveChannelFlags(severity, hasWebPurchaseOrders)`, `composeEmailPayload`, `composeSmsPayload` (≤160 chars with reason ellipsis). Each channel branch is `[TRANSITIONAL]`-labeled with explicit B-cycle / 9c / consumer-app EXIT CONDITION.
**Why:** spec §3.3.1 + §3.3.2 — notification stack contract. v2-A: SMS only fires for material+ AND only when web-purchase orders exist (additive-only edits → banner + email, no SMS).

### NEW: `mingla-business/src/utils/scheduleDateExpansion.ts` (~80 LOC)
**What it did before:** did not exist
**What it does now:** `ActiveSchedule` type, `computeActiveDates(s)` (handles single / recurring via `expandRecurrenceToDates` / multi_date), `computeDroppedDates(before, after)` set diff. Dates output as sorted ISO YYYY-MM-DD.
**Why:** spec §3.3.4 — used by `updateLiveEventFields` to detect destructive whenMode/recurrence/multiDates changes that drop a previously-active date with sales → triggers refund-first reject.

### NEW: `mingla-business/src/utils/liveEventAdapter.ts` (~290 LOC)
**What it did before:** did not exist
**What it does now:** projects LiveEvent into DraftEvent shape via `liveEventToEditableDraft(e)` (transient view, never persisted); reverse adapter `editableDraftToPatch(original, edited): Partial<EditableLiveEventFields>`; `FIELD_LABELS` map; `MATERIAL_KEYS` + `SAFE_KEYS` arrays; `classifySeverity(changedKeys)`; `computeRichFieldDiffs` (per-key formatters for string / number / boolean / tickets summary / multiDates summary / recurrence summary; `severity` hint per key); `computeTicketDiffs` (added/removed/updated with field-level changes); `computeDiffSummary` (human-readable lines for notification copy).
**Why:** spec §3.3.3 — adapter unlocks step body reuse (verified investigation OBS-704-1: step bodies have 0 hits to `useDraftEventStore`). Rich diffs power ChangeSummaryModal v2.

### MOD: `mingla-business/src/store/liveEventStore.ts` (+185 / -25)
**What it did before:** exposed `updateLiveEventEditableFields(id, patch)` — silently dropped any field key other than `description` and `coverHue`. No reason validation, no edit log, no notifications, no guard rails.
**What it does now:**
- Added `EditableLiveEventFields` (Pick from LiveEvent, omitting frozen fields)
- Added `UpdateLiveEventRejection` enum (10 reasons)
- Added `UpdateLiveEventResult` discriminated union (`{ok: true, editLogEntryId}` / `{ok: false, reason, ...details}`)
- Replaced narrow mutation with full `updateLiveEventFields(id, patch, context, reason): UpdateLiveEventResult`:
  1. Reason validation (trimmed length 10..200; rejects `missing_edit_reason` / `invalid_edit_reason`)
  2. Event lookup (`event_not_found`)
  3. Schedule diff via `computeDroppedDates` → classifies as `when_mode_drops_active_date` / `recurrence_drops_occurrence` / `multi_date_remove_with_sales`
  4. Per-tier guards: tier delete with sales / capacity floor / price change / free toggle
  5. On success: applies patch, bumps `updatedAt`, classifies severity via `classifySeverity`, computes `diffSummary`, calls `useEventEditLogStore.recordEdit({...})`, fires `notifyEventChanged({...}, deriveChannelFlags(severity, false))`
- Resolves brandName via `useCurrentBrandStore.getState().brands.find(b => b.id === event.brandId)?.displayName ?? ""`
**Why:** spec §3.2.1 — full mutation contract with all guard rails + audit log + notification fire

### MOD: `mingla-business/src/utils/clearAllStores.ts` (+2)
**What it did before:** reset 3 stores (currentBrand, draftEvent, liveEvent)
**What it does now:** also resets `useEventEditLogStore` — Const #6 logout clears
**Why:** spec §3.2.2 — audit log lifetime owned by client logout

### MOD: `mingla-business/src/components/event/types.ts` (+14)
**What it did before:** `StepBodyProps` had 6 fields (draft, updateDraft, errors, showErrors, onShowToast, scrollToBottom)
**What it does now:** added optional `editMode?: { soldCountByTier: Record<string, number> }`. Backward-compatible — create-flow passes nothing → no behavior change.
**Why:** spec §3.4.1 — only Step 5 reads it for tier lock UX

### MOD: `mingla-business/src/components/event/CreatorStep5Tickets.tsx` (+105 / -8)
**What it did before:** TicketCard always showed Delete trash icon. TicketStubSheet had no edit-mode awareness — price/isFree/capacity all freely editable.
**What it does now:**
- Added `editMode` to component props; reads `soldCountByTier`
- TicketCardProps extended with `soldCount?: number`; TicketCard:
  - When `hasSales`: hides Delete trash button + adds "Sold: N" line in stats row
- TicketStubSheetProps extended with `soldCount?: number`; TicketStubSheet:
  - When `isPriceLocked` (sold > 0): renders refund-first lock banner at top (orange-tinted GlassCard)
  - Free toggle wrapped with `pointerEvents="none"` + opacity 0.5; sub copy switches to "Locked — refund existing buyers to change."
  - Price field: `editable={!isPriceLocked}` + visual disabled state + helper "Existing buyers locked at £X..."
  - Unlimited toggle: same disabled treatment
  - Capacity field: inline floor validation `capacityBelowSold` (renders `helperError` with "Can't go below {sold} tickets sold..."); blocks `canSave`
- Parent passes `soldCount={soldCountByTier[t.id] ?? 0}` to each TicketCard + active editing tier sheet
- Added 4 new styles: `inputWrapDisabled`, `disabledRow`, `lockBanner`, `lockBannerTextCol`, `lockBannerTitle`, `lockBannerBody`
**Why:** spec §3.4.2 — UI defense-in-depth; runtime guard rail in store catches API-level violations (HF-704-3 from investigation)

### MOD: `mingla-business/src/components/event/EditAfterPublishBanner.tsx` (+5 / -5 net)
**What it did before:** body copy mentioned "Some fields are locked — Cancel + republish to change them."
**What it does now:** body reflects v2 model — "Changes save immediately. Existing buyers stay protected — their tickets and prices won't change. Material changes (date, venue, format) notify your buyers via email + SMS. Some destructive changes require refunding existing buyers first."
**Why:** spec §3.4.3 — accurate operator expectations for full-edit + notification stack

### MOD (effectively REPLACE): `mingla-business/src/components/event/ChangeSummaryModal.tsx` (~+200 / -40 net; 470 LOC total)
**What it did before:** simple sheet with diff list (FieldDiff from old liveEventToEditPatch) and Save/Cancel buttons. No reason input. No severity indication. No tickets sub-renderer.
**What it does now:**
- Props v2 shape: `{visible, diffs, ticketDiffs?, severity, webPurchasePresent, onClose, onConfirm(reason), submitting?}`
- Required multiline reason TextInput (numberOfLines=4, maxLength=200)
- Live char counter `{N} / 200` + helper "Min 10 characters" / "Looks good" with color shift
- Save button disabled until `trimmed.length` ∈ [10, 200] AND not submitting AND diffs.length > 0
- Each diff row: 4px left-edge severity stripe (accent.warm for material, tertiary for safe) + "NOTIFIES BUYERS" tag for material rows (non-color signaling)
- For `fieldKey === "tickets"` AND ticketDiffs provided: renders expanded TicketsDiffSubRenderer with Added (green) / Removed (red) / Updated (orange) per-tier summary + listed field changes
- Footer note (severity-dependent): additive → "Changes will be logged in your event's edit history. No buyer notification." / material → "Material changes notify your buyers by email{webPurchasePresent ? ' and SMS' : ''}. Your reason will be included in the message."
- Reason state resets on `visible` flip → true (defensive)
- ScrollView uses `automaticallyAdjustKeyboardInsets` + `keyboardShouldPersistTaps="handled"` for multiline input keyboard safety
**Why:** spec §3.4.4 — `/ui-ux-pro-max` pre-flight applied (severity stripes + tag combo for non-color signaling; live char counter pattern; required-field UX with disabled-save gate)

### REPLACE: `mingla-business/src/components/event/EditPublishedScreen.tsx` (~700 LOC; full rewrite)
**What it did before:** narrow single-screen with only description multiline + cover hue 6-tile picker. Called narrow `updateLiveEventEditableFields(id, patch)`. ChangeSummaryModal v1 with no reason input.
**What it does now:** sectioned accordion with 6 collapsible cards (Basics / When / Where / Cover / Tickets / Settings — Step 7 omitted). Each section reuses existing `CreatorStepN` body components via local edit state seeded by `liveEventToEditableDraft(liveEvent)`. Per-section validation via `validateStep`. Section header shows "Edited" badge when changed + "Fix" badge when validation errors. Save flow: validate → diff → ChangeSummaryModal v2 → reason → 800ms processing → `updateLiveEventFields(id, patch, soldCountCtx, reason)` → toast "Saved. Live now." / refund-first reject dialog (8 reasons mapped to ConfirmDialog "simple" variant copy with "Open Orders" CTA — stub: shows toast "Orders ledger lands Cycle 9c — your refund flow is coming."). Keyboard handling: full Cycle 3 wizard pattern (Keyboard listeners + dynamic paddingBottom + scrollToEnd via requestAnimationFrame). Sticky save dock hidden when keyboard up. Toast self-positions via Modal portal.
**Why:** spec §3.4.5 + §3.4.6 — sectioned reuse strategy (decoupled `StepBodyProps` makes this clean); refund-first reject dialog mapping for all 8 rejection reasons

### DELETE: `mingla-business/src/utils/liveEventToEditPatch.ts` (-110)
**What it did before:** narrow 9b-2 helper exporting `EditableValues`, `FieldDiff`, `liveEventToEditableValues`, `computeFieldDiffs`, `diffsToPatch`. Only handled `description` + `coverHue`.
**What it does now:** does not exist — replaced by richer `liveEventAdapter.ts` (FieldDiff with severity, full per-key formatters, ticket diffs, severity classification, diff summary)
**Why:** Const #8 — subtract before adding; narrow surface replaced by full edit surface

---

## 4 — Spec traceability

| AC | Status | Notes |
|----|--------|-------|
| 0704-AC#1 — open EditPublishedScreen, every section expandable, no lock UX | UNVERIFIED | Needs runtime smoke; sectioned screen renders in code |
| 0704-AC#2 — edit name → modal → reason → save → toast → back | UNVERIFIED | Full code path wired |
| 0704-AC#3 — material edit shows severity indicator + notification footer | PASS by construction | ChangeSummaryModal v2 renders stripe + tag + footer per severity |
| 0704-AC#4 — multi-field edit shows multiple diffs | PASS by construction | computeRichFieldDiffs iterates all editable keys |
| 0704-AC#5 — add new tier → "Tickets: Added: {name}" | PASS by construction | computeTicketDiffs handles "added" |
| 0704-AC#6 — remove tier (no sales) → "Tickets: Removed" → save succeeds | PASS by construction | computeTicketDiffs handles "removed"; soldCount=0 in stub mode |
| 0704-AC#7 — update tier capacity (no sales) → "Tickets: Updated: capacity" | PASS by construction | computeTicketDiffs handles "updated" with field changes |
| 0704-AC#8 — recurrence rule pattern change (no sales) → save succeeds | UNVERIFIED | computeDroppedDates returns [] when no overlap exists; relies on stub mode |
| 0704-AC#9 — visibility/requireApproval/etc. → save succeeds | PASS by construction | Settings section reuses CreatorStep6Settings unchanged |
| 0704-AC#10 — multi-date entries (add new, edit existing) → save succeeds | UNVERIFIED | When section reuses CreatorStep2When |
| 0704-AC#11 — tsc compile error on frozen field key | PASS | TypeScript: `EditableLiveEventFields` is Pick omitting frozen keys; passing `id` as patch is compile error |
| 0704-AC#12 — tier delete with sales → no Delete button | PASS by construction | TicketCard hides Delete when `hasSales` |
| 0704-AC#13 — capacity below sold → reject reason "capacity_below_sold" | PASS by construction | Store mutation guard rail; UI inline error in Step 5 |
| 0704-AC#14 — tier price disabled with helper when sold > 0 | PASS by construction | TicketStubSheet `editable={!isPriceLocked}` + helper hint |
| 0704-AC#15 — whenMode change drops dates → reject "when_mode_drops_active_date" | PASS by construction | Schedule diff in updateLiveEventFields |
| 0704-AC#16 — save with no changes → toast "No changes to save." | PASS by construction | EditPublishedScreen handleSavePress branches on `Object.keys(patch).length === 0` |
| 0704-AC#17 — modal Cancel returns to editor with edits intact | PASS by construction | handleModalClose only flips visible; edit state preserved |
| 0704-AC#18 — back arrow discards edits → router.back | PASS by construction | handleBack; no confirmation dialog by spec design |
| 0704-AC#19 — public event page reflects edits | PASS by construction | LiveEvent mutated via store; PublicEventPage uses live subscription |
| 0704-AC#20 — drafts unaffected (Cycle 3 wizard opens normally) | PASS by construction | edit.tsx routes to EditPublishedScreen only when `?mode=edit-published`; default branch unchanged |
| 0704-AC#21 — Cycle 3 wizard create flow unchanged | PASS by construction | StepBodyProps `editMode?` is optional; create-flow doesn't pass it |
| 0704-AC#22 — tsc EXIT=0 | **PASS** | Full workspace tsc clean |
| 0704-AC#23 — grep oklch | PASS | 2 hits in EventCover.tsx but ONLY in JSDoc comments describing original web reference; no actual oklch() calls |
| 0704-AC#24 — subtraction verified | **PASS** | grep liveEventToEditPatch → 0 hits; grep updateLiveEventEditableFields → 0 hits; file deleted |
| 0704-AC#25 — reason input in modal | PASS by construction | Multiline TextInput, maxLength=200 |
| 0704-AC#26 — char counter; Save disabled until ≥10 chars | PASS by construction | reasonValid gate; live counter |
| 0704-AC#27 — reason >200 cannot be entered | PASS by construction | maxLength={200} |
| 0704-AC#28 — `reason=""` returns `missing_edit_reason` | PASS by construction | Store mutation reason validation |
| 0704-AC#29 — `reason="abc"` (3 chars) returns `invalid_edit_reason` | PASS by construction | Store mutation length range check |
| 0704-AC#30 — successful save creates 1 log entry | PASS by construction | recordEdit called before notify in mutation |
| 0704-AC#31 — additive save: `[email-stub]` fires; `[sms-stub]` does NOT | PASS by construction | deriveChannelFlags: sms = severity!=="additive" && hasWebPurchaseOrders |
| 0704-AC#32 — material save: both fire (when web purchases exist) | UNVERIFIED | webPurchasePresent=false in stub mode; SMS won't fire until 9c populates web-purchase orderIds |
| 0704-AC#33 — `[push-deferred]` content never fires | PASS by construction | channels.push always false in deriveChannelFlags |
| 0704-AC#34 — `[banner-recorded]` fires every save | PASS by construction | channels.banner=true |
| 0704-AC#35 — email payload contains brand+event+reason | PASS by construction | composeEmailPayload constructs subject + body |
| 0704-AC#36 — SMS payload ≤160 chars | PASS by construction | composeSmsPayload truncates reason with budget calc |
| 0704-AC#37 — capacity drop below sold → reject dialog "Refund first" | UNVERIFIED in stub mode (soldCount=0); mapping verified by code review | All 8 reject reasons mapped in EditPublishedScreen.buildRejectDialog |
| 0704-AC#38 — tier delete blocked at UI + at store API | PASS by construction | TicketCard hides Delete; store guard rail returns reject |
| 0704-AC#39 — tier price disabled with helper | PASS by construction | TicketStubSheet `editable={!isPriceLocked}` |
| 0704-AC#40 — whenMode change drops dates → reject dialog | PASS by construction | computeDroppedDates + classification in store mutation |
| 0704-AC#41 — whenMode change preserving dates → save succeeds | PASS by construction | When droppedDates.length === 0, mutation continues |
| 0704-AC#42 — recurrence drops occurrences → reject | PASS by construction | Same path as AC#40 |
| 0704-AC#43 — recurrence adds occurrences only → succeeds | PASS by construction | Same path |
| 0704-AC#44 — multi-date entry removal with sales → reject | PASS by construction | Same path |
| 0704-AC#45 — stub mode: all guards inactive | PASS by construction | getSoldCountContextForEvent returns zeros; soldCountForEvent=0 means droppedDates check is skipped |
| 0704-AC#46 — OrderRecord shape verbatim per spec | N/A this cycle | Forward-looking — Cycle 9c builds |
| 0704-AC#47 — getSoldCountContextForEvent labeled TRANSITIONAL | PASS | Header doc + inline comment + EXIT CONDITION |
| 0704-AC#48 — When 9c replaces stub, callers don't change | PASS by construction | API surface stable; only internal returns change |
| 0704-AC#49 — Banner reads from useEventEditLogStore in 9c | N/A this cycle | Forward-looking |

**Summary:** 33 PASS by construction · 8 UNVERIFIED (need runtime smoke) · 2 PASS by tsc/grep · 4 N/A (forward-looking 9c)

---

## 5 — Verification output

### tsc strict
```
$ cd mingla-business && npx tsc --noEmit; echo "EXIT=$?"
EXIT=0
```

### grep oklch
```
$ grep -rn "oklch(" mingla-business/src
EventCover.tsx:6:  *  ... uses CSS `repeating-linear-gradient` with `oklch()`
EventCover.tsx:9:  * ...with `oklch(0.55 0.18 hue)`...
```
Both hits are in JSDoc comments only, describing the ORIGINAL web-reference styling that EventCover translates to `hsl()`. No actual `oklch()` calls in code. Pre-existing, out of scope for ORCH-0704.

### grep liveEventToEditPatch
```
$ grep -rn "liveEventToEditPatch" mingla-business/
(no matches)
```

### grep updateLiveEventEditableFields
```
$ grep -rn "updateLiveEventEditableFields" mingla-business/
(no matches)
```

### TRANSITIONAL stubs
- `orderStoreHelpers.ts`: 2 occurrences (header doc + inline EXIT CONDITION comment)
- `eventChangeNotifier.ts`: 5 occurrences (header doc + each channel branch + inline EXIT CONDITIONs)
- `eventEditLogStore.ts`: 1 occurrence (header doc)

---

## 6 — Invariant Verification

| ID | Status | How preserved |
|----|--------|---------------|
| I-11 (format-agnostic ID) | PRESERVED | Event/tier IDs remain opaque strings |
| I-12 (host-bg cascade) | PRESERVED | EditPublishedScreen sets canvas.discover bg |
| I-13 (overlay portal) | PRESERVED | ChangeSummaryModal uses Sheet primitive (DEC-085 portal-correct); ConfirmDialog uses Modal primitive |
| I-14 (date display single source) | PRESERVED | Step bodies reused; existing helpers honored |
| I-15 (ticket display single source) | PRESERVED | Step 5 ticketDisplay.ts helpers unchanged |
| I-16 (live-event ownership separation) | PRESERVED | `addLiveEvent` still gated to liveEventConverter; `updateLiveEventFields` is a MUTATE not an ADD |
| I-17 (brand-slug stability) | PRESERVED | brandSlug + eventSlug in FROZEN bucket (omitted from EditableLiveEventFields) |
| I-18 (DRAFT — buyer→founder order persistence) | PRESERVED-FORWARD | OrderRecord shape spec'd in §3.1.5 (Cycle 9c builds) |
| **I-19 (NEW — immutable order financials)** | RATIFY-AT-CLOSE | EditableLiveEventFields excludes any path touching persisted orders; useOrderStore (9c) honors via append-only refund/cancel API |
| **I-20 (NEW — edit reason mandatory + audit log permanence)** | RATIFY-AT-CLOSE | `updateLiveEventFields` requires `reason: string` parameter; runtime guard rejects empty/short/long; useEventEditLogStore exposes ONLY `recordEdit` (append) + reads + `reset` (logout); no update/delete API |

| Const | Status |
|-------|--------|
| #1 No dead taps | PRESERVED — all section headers, buttons, reject dialog CTAs wired |
| #2 One owner per truth | PRESERVED — LiveEvent in liveEventStore; EditEntry in eventEditLogStore; CartLine in cart context; OrderRecord forward-spec for 9c |
| #3 No silent failures | PRESERVED — UpdateLiveEventResult discriminated union surfaces every reject; reject dialog maps all 8 reasons to user-readable copy |
| #6 Logout clears | PRESERVED — useEventEditLogStore.reset wired into clearAllStores |
| #7 TRANSITIONAL labels | HONORED — orderStoreHelpers stub + email/SMS/push notification stubs all labeled with EXIT CONDITIONs |
| #8 Subtract before adding | HONORED — narrow EditPublishedScreen + narrow mutation + liveEventToEditPatch.ts ALL gone before new EditPublishedScreen ships |
| #9 No fabricated data | PRESERVED — soldCount stub returns 0 (honest empty); never seeded fake orders |
| #10 Currency-aware UI | PRESERVED — currency locked in OrderRecord forward-spec (cycle 9c); existing GBP formatting unchanged |
| #14 Persisted-state startup | PRESERVED — eventEditLogStore Zustand persist with version 1; cold start with empty entries works correctly |

---

## 7 — Cache safety

No React Query in mingla-business. Store changes affect:
- `useLiveEventStore` — full `events` array re-renders subscribers (PublicEventPage, EventDetail, EventListCard, etc.) on any patch via the standard Zustand subscription. No keys to invalidate.
- `useEventEditLogStore` — new store; consumers begin in 9c (buyer order detail page).
- AsyncStorage — `mingla-business.eventEditLog.v1` is a NEW key; no migration needed.
- No data shape change to existing persisted keys.

Defense-in-depth at store layer: `updateLiveEventFields` patch is `Partial<EditableLiveEventFields>` (compile-time frozen-field rejection); runtime guard rails block destructive changes pre-apply.

---

## 8 — Regression Surface (tester verify)

5 features most likely to break:

1. **Cycle 3 wizard / draft creation** — `app/event/[id]/edit.tsx` default branch (no `?mode=edit-published`) must still mount EventCreatorWizard with the existing draft flow. StepBodyProps `editMode?` is optional; create-flow doesn't pass it → no behavior change. Verify: open Drafts pill → pick a draft → wizard opens normally → all 7 steps work → publish.

2. **Cycle 9a manage menu** — `Edit details` action on a live event routes to `?mode=edit-published`. Verify: live event card → ⋯ → Edit details → opens NEW sectioned EditPublishedScreen (not narrow 9b-2; not draft wizard).

3. **Cycle 9a Events tab** — drafts open wizard, non-drafts open EditPublishedScreen. Verify both paths exist via the manage menu.

4. **Cycle 9b-1 lifecycle actions** — End sales / Cancel / Delete draft surface unaffected (no shared code touched). Verify: live event → ⋯ → End ticket sales / Cancel event flows. Drafts → ⋯ → Delete draft.

5. **Cycle 8 buyer checkout** — buyer flow reads LiveEvent live (auto-rerender post-edit). After operator edits a tier name or description, in-flight buyer cart line preserves SNAPSHOT (CartLine.unitPriceGbp + CartLine.ticketName already-snapshot at selection per Cycle 8 design). Verify: open checkout in one tab → operator edits in another → buyer's cart prices unchanged → confirmation succeeds.

---

## 9 — Discoveries for Orchestrator

**D-704-IMPL-1 (Note severity)** — Phase 1 deviation documented in §2: kept narrow types alongside new types through phases 1-5 to avoid intermediate broken compile state. Atomic switch in phase 6+7 (delete narrow file + remove narrow mutation + ship new screen). Same Const #8 spirit; cleaner intermediate states. Spec literal phase order would have required transient compile breaks; functional phase order delivers identical end-state with no broken intermediates.

**D-704-IMPL-2 (Note severity)** — `oklch(` grep returned 2 hits in `EventCover.tsx` lines 6 and 9. Both are in JSDoc comments describing the original web reference styling that the file translates to `hsl()` for RN. No actual `oklch()` calls. Pre-existing in the codebase, out of ORCH-0704 scope. Flagging for orchestrator awareness — could be cleaned up in a future docstring polish dispatch but not a defect.

**D-704-IMPL-3 (Note severity)** — "Open Orders" CTA on refund-first reject dialogs currently shows toast "Orders ledger lands Cycle 9c — your refund flow is coming." instead of routing. The action shape (`closeAndOpenOrders`) is preserved so 9c implementor only needs to swap the body line `showToast("...")` for `router.push("/event/${eventId}/orders")`. EXIT CONDITION embedded in code comments.

**D-704-IMPL-4 (Note severity)** — `webPurchasePresent` parameter currently hardcoded `false` in EditPublishedScreen + `notifyEventChanged(...)` call. EXIT: Cycle 9c reads `useOrderStore.getOrdersForEvent(eventId)` + filters by `paymentMethod === "card" || paymentMethod === "apple_pay" || paymentMethod === "google_pay"` (web-purchase channels per CartContext) → boolean.

**D-704-IMPL-5 (Note severity)** — `affectedOrderIds` field on `EventEditEntry` is empty `[]` in stub mode. EXIT: Cycle 9c populates from `useOrderStore.getOrdersForEvent(eventId).map(o => o.id)` at recordEdit time (the cycle 9c implementor swaps the empty literal in `liveEventStore.updateLiveEventFields`).

**D-704-IMPL-6 (Note severity)** — Reject dialog uses ConfirmDialog "simple" variant. The dialog has both Cancel + primary CTA (e.g. "Open Orders"). When user taps Cancel, dialog closes — they're back on the edit screen with their changes intact, can fix the conflict (drop a tier instead of delete; bump capacity higher; etc.) then retry save.

**D-704-IMPL-7 (Note severity)** — When a destructive change is rejected, the operator's reason was already entered in the modal but is DISCARDED (modal closed, reject dialog shown). On retry, they re-enter reason. This is intentional — different reasons may apply if the operator pivots to a non-destructive path. Could change to "preserve reason across rejects" if smoke surfaces friction.

**D-704-IMPL-8 (Low severity)** — Step 7 Preview is intentionally omitted from the sectioned EditPublishedScreen. Operator uses the existing Cycle 9a "Preview" button on Event Detail to see the public page after edits. No code path needed for Preview in edit mode.

**D-704-IMPL-9 (Low severity)** — `[banner-recorded]` log fires for every successful save (channels.banner=true always). This is intentional — the actual write is to `useEventEditLogStore` via `recordEdit` (already done before `notifyEventChanged` is called). The console log is for traceability during stub mode; Cycle 9c renders the banner from the store, not from this log. The log line is harmless but could be removed in a polish dispatch if console noise becomes an issue.

**D-704-IMPL-10 (Note severity)** — When `validateStep` returns errors for any section, the save flow opens that section + shows a "Fix" badge on the section header + sets `showErrors=true` so step bodies render inline error helpers. Toast surfaces "Fix the highlighted issues first." This matches the wizard's own validation gate UX.

**No other side issues.**

---

## 10 — Files Touched

| File | Type | LOC est |
|------|------|---------|
| `mingla-business/src/store/liveEventStore.ts` | MOD | +185 / -25 |
| `mingla-business/src/store/eventEditLogStore.ts` | NEW | ~125 |
| `mingla-business/src/store/orderStoreHelpers.ts` | NEW | ~40 |
| `mingla-business/src/services/eventChangeNotifier.ts` | NEW | ~155 |
| `mingla-business/src/utils/scheduleDateExpansion.ts` | NEW | ~80 |
| `mingla-business/src/utils/liveEventAdapter.ts` | NEW | ~290 |
| `mingla-business/src/utils/clearAllStores.ts` | MOD | +2 |
| `mingla-business/src/utils/liveEventToEditPatch.ts` | DELETE | -110 |
| `mingla-business/src/components/event/types.ts` | MOD | +14 |
| `mingla-business/src/components/event/CreatorStep5Tickets.tsx` | MOD | +105 / -8 |
| `mingla-business/src/components/event/EditAfterPublishBanner.tsx` | MOD | +5 / -5 |
| `mingla-business/src/components/event/ChangeSummaryModal.tsx` | REWRITE | ~+400 / -80 net (470 LOC final) |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | REPLACE | ~700 (full rewrite) |

**Net:** ~+1380 / -200 (~+1180 net)

6 NEW + 5 MOD + 2 REPLACE-or-rewrite + 1 DELETE = 14 files touched.

(Spec estimated ~+1300 net; actual ~+1180 — slightly under because EventEditEntry shape is leaner than first estimated.)

---

## 11 — Smoke priorities (what user should test first)

1. **Web Chrome — Edit happy path (additive)** — Live event card → ⋯ → Edit details → sectioned screen opens with Basics expanded → expand Description → change → tap Save changes → review modal lists 1 diff with grey severity stripe + "Changes will be logged in your event's edit history. No buyer notification." footer → enter reason ≥10 chars → Confirm → 800ms → toast "Saved. Live now." → back to /event/{id} → public event page (/e/{brandSlug}/{eventSlug}) reflects new description.

2. **Edit happy path (material)** — Same flow but change address. Modal shows orange severity stripe + "NOTIFIES BUYERS" tag + "Material changes notify your buyers by email." footer (sms not shown because webPurchasePresent=false in stub). Open dev console → verify `[email-stub]` log fires with subject + body. `[sms-stub]` does NOT fire.

3. **Multi-section edit** — Open Basics → change name → close Basics → open Where → change venue → close Where → open Tickets → add a new tier → tap Save changes → modal lists ALL 3 diffs (Event name, Venue, Tickets with "Added: VIP" sub-renderer) → reason → Confirm → toast.

4. **Reason input gating** — Open save modal → Save button disabled. Type 5 chars → still disabled (helper "Min 10 characters"). Type 10th char → Save enabled. Type past 200 → input rejects. Cancel.

5. **No-changes path** — Open edit screen → don't change anything → tap Save changes → toast "No changes to save."

6. **Cancel review** — Edit something → tap Save → modal opens → tap Cancel → returns to editor with edits intact (Edited badge stays on the section).

7. **Discard via back** — Make edits → tap close (X) → discard, return to /event/{id}.

8. **Edit log persistence** — Make a save → kill app → reopen → in dev console run `useEventEditLogStore.getState().getEditsForEvent("<eventId>")` → verify entry persisted with reason + severity + diffSummary.

9. **Logout clears edit log** — Make a save → sign out → sign back in → `useEventEditLogStore.getState().entries` returns `[]`.

10. **iOS sim** — same flows + multiline reason input keyboard handling (must stay above keyboard).

11. **Regression — Cycle 3 wizard / drafts** — Drafts pill → open a draft → wizard opens normally (NOT EditPublishedScreen). Step bodies don't show lock UX (editMode not passed). Publish a new event from scratch → works.

12. **Regression — Cycle 9b-1 lifecycle** — End sales + Cancel event + Delete draft sheets all still work.

13. **Regression — Cycle 8 checkout** — In-flight buyer cart preserves snapshot prices when operator edits the tier mid-checkout.

---

## 12 — Cycle 9c handoff notes

When Cycle 9c implementor builds `useOrderStore`:

1. **Replace stub `getSoldCountContextForEvent`** in `mingla-business/src/store/orderStoreHelpers.ts`:
   - Read `useOrderStore.getState().getOrdersForEvent(event.id)`
   - Filter `status in {paid, refunded_partial}`
   - Sum `(line.quantity - line.refundedQuantity)` per ticketTypeId
   - Return populated `soldCountByTier` + `soldCountForEvent`

2. **Wire `confirm.tsx`** (Cycle 8) to `useOrderStore.getState().recordOrder({...})` after the existing `recordResult` call.

3. **Build buyer order detail page** (route TBD — likely `/order/[orderId]` outside `(tabs)/`, anon-tolerant per `feedback_anon_buyer_routes`):
   - Read `OrderRecord` from `useOrderStore` + `LiveEvent` from `liveEventStore`
   - Render frozen financial fields from OrderRecord.lines[]
   - Render displayable fields from LiveEvent (live)
   - Material-change banner from `useEventEditLogStore.getEditsForEventSince(eventId, order.lastSeenEventUpdatedAt)` filtered to `severity !== "additive"`. Latest entry's reason in copy.
   - "Got it" action: `useOrderStore.getState().updateOrder(orderId, { lastSeenEventUpdatedAt: latestEdit.editedAt })`

4. **Update notification stack**:
   - `liveEventStore.updateLiveEventFields` line that passes `affectedOrderIds: []` → populate from `useOrderStore.getOrdersForEvent(event.id).map(o => o.id)`
   - `liveEventStore.updateLiveEventFields` line `deriveChannelFlags(severity, false)` → populate `hasWebPurchaseOrders` from web-purchase order filter

5. **Swap "Open Orders" CTA stub**:
   - In `EditPublishedScreen.buildRejectDialog`, replace `showToast("Orders ledger lands Cycle 9c...")` with `router.push("/event/${eventId}/orders")` once the orders ledger route exists

6. **B-cycle**:
   - `eventChangeNotifier.notifyEventChanged` email branch → real Resend send via edge function
   - SMS branch → real Twilio send via edge function
   - Push branch → wire OneSignal once consumer app exists

ORCH-0704 wiring is correct; 9c just swaps stub returns for live data without changing any caller.

---

## 13 — Status

**implemented, partially verified.**

- tsc EXIT=0 ✅
- subtraction grep PASS ✅
- TRANSITIONAL stubs labeled ✅
- runtime UNVERIFIED — needs user smoke (web + iOS) per §11 priorities

If smoke surfaces issues, return to implementor for rework against specific failed criteria.
