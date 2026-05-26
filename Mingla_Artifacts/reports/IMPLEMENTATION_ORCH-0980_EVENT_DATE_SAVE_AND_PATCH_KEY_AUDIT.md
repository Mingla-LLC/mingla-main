# IMPLEMENTATION ORCH-0980 - Event Date Save and Patch-Key Audit

## Executive Summary

ORCH-0980 is implemented on branch `ORCH-0980-silent-save-failure-bug-class`.

The real root cause was H3: after `business_patch_event_when` returned success, the edit flow only invalidated caches and continued into the local success flow. The edit screen seeds its draft once from `initialEditState`, so an immediate return/reopen could see stale cached event data even though the RPC had already committed the new date.

The fix makes the When save path wait for a canonical server detail read after the RPC, writes that row into React Query detail/list caches, and resets local edit state from the refreshed event before the success flow continues.

No migrations were added. No ORCH-0964 guarded files were touched. No META-ORCH-0972 edge functions were redeployed. No `testID` values were changed.

## Hypothesis Result

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| H1: Date picker does not set `patch.date`, so `patch.date === undefined` at save. | Disproved. | Live-fire on business iOS sim changed the date from Monday Nov 9 2026 to Wednesday Nov 11 2026; the When section showed `Edited` and Save was enabled. Source path also confirms `CreatorStep2When` calls `updateDraft({ date: newDate })`, `editableDraftToPatch` emits `patch.date`, and `EditPublishedScreen` composes `finalDate` from `patch.date`. Evidence screenshot: `/tmp/orch0980-date-changed.png`. |
| H2: `business_patch_event_when` silently no-ops the date change. | Disproved by source. | The RPC body deletes and reinserts `event_dates` rows for single, recurring, and multi-date payloads. For single-mode sold events, it explicitly raises on date change instead of silently accepting. Relevant lines: `supabase/migrations/20260615000000_orch_0877_patch_event_when_rpc.sql:178`, `:194`, `:214`, `:259`, `:274`. |
| H3: Cache/local state refresh is stale after save. | Root cause. | Before this fix, `EditPublishedScreen` awaited the RPC and then only invalidated server caches before continuing. The screen's local edit state is initialized once from the incoming event, so stale detail/list caches could repopulate the old date during immediate return/reopen. |

## Live-Fire Notes

Environment:

- Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0980-[silent-save-failure-bug-class]`
- Metro: port `8093`
- iOS simulator: `F7ECAC25-2A98-4002-AD17-85AED17AB752`
- Bundle: `com.sethogieva.minglabusiness`
- Test brand: `Leggo This`

The live-fire record `Runtime Share Test...` allowed date editing and proved H1 false, but its save was blocked by an unrelated Where/address validation issue: "Pick the venue address from the suggestions." Because that unrelated validation blocked the final RPC call on that record, the final persistence proof for this turn is source proof plus focused regression tests rather than a completed clean simulator save/reopen.

## Diff Per File

### `mingla-business/src/components/event/EditPublishedScreen.tsx`

- Imports `refreshPublishedEventWhenAfterSave`.
- After `await patchPublishedEventWhen(...)`, now awaits a canonical detail refresh for the same `eventId` and `brandId`.
- Resets local edit state from `liveEventToEditableDraft(refreshedDetail.event)`.
- Keeps the existing cache invalidation/success path after the canonical cache write.

### `mingla-business/src/utils/publishedEventWhenRefresh.ts`

- New helper: `refreshPublishedEventWhenAfterSave`.
- Fetches canonical detail with `fetchBusinessEventById`.
- Throws `patch_event_when_refresh_failed` if the committed event cannot be re-read.
- Writes the canonical event into `businessEventKeys.detail(eventId)`.
- Replaces or prepends the canonical event in `businessEventKeys.list(brandId)`.

### `mingla-business/src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts`

- New Step 0.5 regression.
- Asserts the RPC success path is followed by canonical detail refresh before local success flow.
- Asserts canonical server data replaces a stale date in both detail and list caches.

## Step 0.5 Regression

Regression path:

`mingla-business/src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts`

Verification:

```bash
cd mingla-business
npx jest src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts --runInBand
npx jest src/components/event/__tests__/EditPublishedScreen_when_save_gate.test.ts src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts --runInBand
```

Result:

- Single new suite: PASS, 2 tests.
- Paired When save gate + ORCH-0980 suite: PASS, 2 suites / 6 tests.

Fails-on-revert verified at `f0961b3e8` by reverting fix commit `0bca51f33`: the new regression failed because the refresh helper/import disappeared, then passed again after restoring the fix.

## Commits

| Commit | Purpose |
| --- | --- |
| `0bca51f33` | `ORCH-0980 fix event date save refresh` |
| `f0961b3e8` | `ORCH-0980 add event date round trip regression` |

## Patch-Key Audit Findings

This audit is reporting-only per dispatch. No follow-up surface was fixed in this PR.

| Surface | Severity | Finding | Recommended handling |
| --- | --- | --- | --- |
| Published event edit patch keys | P1 | `EditableLiveEventFields` has fields that render as editable sections but are not all server-writable for server-loaded published events: basics (`name`, `description`, `format`, `category`), Where (`venueName`, `onlineUrl`, `hideAddressUntilTicket`), cover hue, tickets, and settings (`visibility`, `requireApproval`, `allowTransfers`, `hideRemainingCount`, `passwordProtected`, `privateGuestList`, `inPersonPaymentsEnabled`). Current code blocks local save when the event is server-loaded, which avoids a false success for those paths, but the contract is spread across UI diffing, server-key sets, and local-store fallback. | Follow-up should classify every `EditableLiveEventFields` key as server-writable, intentionally local-only, frozen/deprecated, or blocked-with-copy. Add a CI gate so new editable fields cannot ship without that classification. |
| Brand profile patch keys | P2 | `computeDirtyFieldsPatch` allow-lists profile fields and intentionally skips immutable/server-derived fields. `defaultCurrency` is a notable Brand field outside the patch list; current product copy says connected currency changes require a new brand, so this is likely intentional, but it is not documented in the helper's skip list. Venue claim/place fields are also outside this profile patch helper and appear onboarding/admin-owned. | Add an explicit non-editable/owned-elsewhere skip stanza for `defaultCurrency`, claim fields, place fields, and server-derived commerce fields. Gate the helper against `Brand` type drift with an allowed-omits list. |
| Trip patch keys | P2 | Trip updates are healthier than events: published trips route through `updateLiveTripFields` and `biz_update_live_trip`, while basics/pricing services have defensive routing guards for capacity, dates, and destination. Risk remains because multiple explicit patch shapes (`TripBasicsPatch`, `TripPricingPatch`, `LiveTripPatch`) are manually maintained and not mechanically compared to UI edit inputs. | Add patch-shape coverage tests for trip edit screens that assert every emitted UI diff key maps to exactly one service/RPC path or an explicit blocker. |
| Marketing campaigns/templates | P3 | Campaign and template update helpers use tight allow-lists and throw on no-row updates. `template_id`, `scheduled_for`, and status transitions are intentionally separated into create/schedule/cancel/send paths; no immediate silent-save drift was found. | Low-priority CI source check: keep update input keys, selected columns, and update payload keys in sync for marketing services. |

## Structural Prevention Options

1. AST coverage gate for explicit patch builders: fail CI when an editable type key is neither written by a patch builder nor declared in an intentional-omit registry.
2. Round-trip mutation tests per save surface: for every field shown as editable, test old value -> edit state -> patch payload -> mocked canonical read/cache update.
3. Source-order save-flow gate for server mutations: server RPC success must be followed by canonical read/cache write before success toast/navigation for published server-owned entities.

## Final Verification

Commands run:

```bash
cd mingla-business
npx jest src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts --runInBand
npx jest src/components/event/__tests__/EditPublishedScreen_when_save_gate.test.ts src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts --runInBand
```

Both targeted checks passed.

## Residual Risk

The simulator save could not complete on the first selected test event because an unrelated venue-address validation issue blocked submission before the When RPC. The implemented fix is still scoped to the proven stale-refresh bug class and protected by a fails-on-revert regression. Operator retest should use a scheduled event with a valid venue/address or an online event so the save reaches the When RPC cleanly.

---

## Rework Audit - No-toast-after-RPC fall-through

**Status:** implemented and verified.

### Rework Root Cause

The real rework suspect was **S3: server-owned When edits still fell through into a local-only save/validation path after the RPC and canonical refresh had already succeeded**. S2 was disproved by source: `refreshPublishedEventWhenAfterSave` writes React Query detail/list caches and `setEditState`, but it does not write the Zustand row, and `updateLiveEventFields` has no no-change rejection. S1 remains a valid class risk because local buyer-protection can reject When-shape changes independently, but the direct defect was the fall-through ownership mismatch: a server-accepted, server-editable-only patch should terminate with the server success signal instead of asking local Zustand to approve the same save again.

### Rework Diff Per File

| File | Change | Rationale |
| --- | --- | --- |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | After `patchPublishedEventWhen` + canonical refresh, server-editable-only patches now close the modal, fire exactly one success toast `"Saved. Live now."`, navigate back after the existing toast delay, and return before `updateLiveEventFields`. The remaining local reject path now calls `surfaceLocalSaveRejection(...)` before opening the reject dialog. | Prevents the operator path from falling into a stale/local validation result after the server is already authoritative, and ensures the guard-rail reject path cannot be silent if the dialog fails to render. |
| `mingla-business/src/utils/localSaveRejectionSignal.ts` | New tiny signal helper + toast constant. | Gives the rejection-toast contract a pure unit-testable seam without importing the full React Native screen into Jest. |
| `mingla-business/src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts` | Added a new `it()` that simulates `updateLiveEventFields` returning `{ ok:false }` and asserts `showToast(...)` fires once before the reject dialog is set. | Extends Step 0.5 to cover the missing post-RPC local-reject signal, not just dialog mounting. |

### Step 0.5 Rework Regression

Regression path:

`mingla-business/src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts`

Verification:

```bash
cd mingla-business
npx jest src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts --runInBand
```

Result:

- PASS, 1 suite / 3 tests.
- New test: `fires a toast when updateLiveEventFields rejects after the save chain falls through`.

Fails-on-revert verified at `f62be42d6` by temporarily reverting fix commit `25683db1c`: the suite failed with `TS2307: Cannot find module '../../../utils/localSaveRejectionSignal'`, then passed again after restoring the fixed state.

Additional verification:

```bash
cd mingla-business
npx jest src/components/event/__tests__/EditPublishedScreen_when_save_gate.test.ts src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts --runInBand
npm run typecheck -- --noEmit
```

Result:

- Paired Jest gate: PASS, 2 suites / 7 tests.
- Typecheck: FAIL on pre-existing unrelated workspace errors outside this ORCH scope, including `app/(tabs)/home.tsx` impossible `1|2|3` vs `4` comparisons, checkout buyer implicit `any` parameters, ComposerV2 rich editor typings, missing `@mingla/payments-native`, legacy DraftEvent test fixtures with `category`, and package-level missing React/RN typings under `packages/event-rendering` and `packages/phone-input`.
- Simulator rework live-fire: not completed in this turn. The target simulator `F7ECAC25-2A98-4002-AD17-85AED17AB752` is booted, but Metro was not running on `8093` and no clean online/pre-validated event session was executed after the code fix. Operator/EAS retest remains the required end-to-end gate.

### Class-of-bug Audit - REPORT ONLY

Scope audited per dispatch: save/send/submit/confirm handlers in `mingla-business/src/components/` and `mingla-business/app/`. "Visible signal" means terminal success/error reaches a toast, inline error/dialog, alert, or explicit navigation. Findings below are **report-only**; no non-ORCH-0980 save surfaces were fixed in this PR.

| Surface | Terminal code paths audited | Verdict |
| --- | --- | --- |
| `mingla-business/src/components/event/EditPublishedScreen.tsx:584` | Validation rejection `:596-600` opens reject dialog; missing server id `:611-615`, `:676-682`, `:761-767` toasts; cover/taxonomy/When RPC catches `:649-657`, `:717-739`, `:826-853` toast; server-editable When success `:812-825` toast+navigate; local success `:893-902` toast+navigate; local reject `:903-909` now toast+dialog. | **Fixed in this PR.** |
| `mingla-business/src/components/brand/BrandEditView.tsx:287` + `mingla-business/app/brand/[id]/edit.tsx:60` | Component success `:295-297` toasts then exits; component catch `:298-303` toasts. Parent no-op branches `app/.../edit.tsx:63-66` return to component and therefore still receive component success toast. | PASS for visible signal, though the parent no-op branches may deserve a future false-success audit. |
| `mingla-business/src/components/trip/EditPublishedTripScreen.tsx:810` | Preflight reject `:825-829` visible dialog; mutation catch `:840-860` toasts; server reject `:863-867` visible dialog; success `:892-902` toast+navigate. | PASS. |
| `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:286` / `:479` | Manual "Save draft" calls `flushDraft()` and returns with no success toast/nav/dialog (`:479-481`). `flushDraft()` can also return silently when account/brand/audience is missing (`:286-289`). Error path `:317-320` uses an error toast. | **P1 REPORT-ONLY:** successful manual draft save and missing-context early return are silent. |
| `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx:548` / `:668` / `:682` | Send Now/Schedule hard guards set `errorBanner` (`:549-552`, `:673-676`, `:683-686`); valid paths open review/schedule visible surfaces (`:555-556`, `:678-679`, `:688`). | PASS. |
| `mingla-business/app/(tabs)/marketing/campaigns/index.tsx:73` / `:85` | Cancel scheduled campaign and delete draft refetch on success with no toast/dialog/nav (`:73-88`); failures show `Alert.alert` (`:77-82`, `:89-94`). | **P1 REPORT-ONLY:** successful cancel/delete is silent. |
| `mingla-business/app/(tabs)/marketing/templates/[id].tsx:114` / `:147` / `:169` | New-template save navigates (`:120-133`); existing-template save returns updated id with no toast/nav/dialog (`:135-144`); `handleSave` does not catch mutation rejection (`:147-149`); validation uses `Alert.alert` (`:116-118`); delete success navigates and failure alerts (`:179-189`). | **P1 REPORT-ONLY:** existing-template save success and mutation failure can be silent/unhandled. |
| `mingla-business/app/(tabs)/hub/events.tsx:378` / `:409` / `:467` | End sales/cancel event success and failure toast (`:378-448`); draft delete success toasts (`:476-487`) and failure sets visible dialog error (`:488-489`). Stale missing-draft branch closes dialog silently (`:467-473`). | **P1 REPORT-ONLY:** stale draft-delete confirm can close without signal. |
| `mingla-business/src/components/event/EventCreatorWizard.tsx:502` / `:528` | Publish validation opens errors sheet or Stripe toast (`:507-522`); confirm missing publisher toasts (`:534-538`); publish failure toasts (`:554-558`); success exits via `onExit("published")` (`:546-553`). | PASS. |
| `mingla-business/src/components/trip/TripCreatorWizard.tsx:792` / `:797` | Publish confirm success calls `onPublished` navigation (`:799-820`); failure sets persistent `publishError` banner (`:821-825`); autosave success in edit mode toasts (`:843-850`). | PASS. |
| `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx:140` | Success calls `onComplete` navigation (`:146-181`); catch sets toast (`:182-187`). Early returns on missing brand/user or invalid date (`:142-144`) have no signal. | **P1 REPORT-ONLY:** impossible/disabled-state early returns are silent if reached. |
| `mingla-business/src/components/venue/VenueCreatorWizard.tsx:94` | Validation branches set inline errors and step focus (`:99-120`); success calls `onDone` with optional warning (`:150-172`); errors set inline error/slug collision state (`:173-187`). | PASS. |
| `mingla-business/src/components/door/DoorSaleNewSheet.tsx:258`, `DoorRefundSheet.tsx:147`, `AddCompGuestSheet.tsx:134`, `InviteBrandMemberSheet.tsx:106` | Successful terminal path delegates to parent `onSuccess(...)` (`DoorSaleNewSheet.tsx:308`, `DoorRefundSheet.tsx:181-187`, `AddCompGuestSheet.tsx:165`, `InviteBrandMemberSheet.tsx:118`); disabled/invalid submits are button-gated. | No direct silent failure proven in component scope; parent-owned success signal should be audited when those parent sheets are next touched. |
| `mingla-business/src/components/brand/BrandDeleteSheet.tsx:135`, `BrandStripeDetachConfirmSheet.tsx:83` | Rejection/error states render inline (`BrandDeleteSheet.tsx:152-166`, `BrandStripeDetachConfirmSheet.tsx:91-98`); success closes via parent callbacks (`BrandDeleteSheet.tsx:157-159`, `BrandStripeDetachConfirmSheet.tsx:88-90`). | PASS. |
| `mingla-business/src/components/orders/RefundSheet.tsx:173`, `CancelOrderDialog.tsx:87` | Defensive validation/error branches set inline error (`RefundSheet.tsx:206-210`, `:225-228`; `CancelOrderDialog.tsx:97-100`); success delegates to parent `onSuccess` (`RefundSheet.tsx:221-224`, `CancelOrderDialog.tsx:90-96`). | PASS in component scope. |
| `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx:109` | Success toasts then closes (`:121-127`); failure toasts (`:128-130`). | PASS. |
| `mingla-business/app/account/edit-profile.tsx:205`, `app/account/delete.tsx:170`, `app/booking/[orderId]/cancel.tsx:94` | Profile save success/failure toasts (`edit-profile.tsx:215-224`); account delete success/failure toasts/nav (`delete.tsx:172-187`); booking cancel success moves to success state and errors show inline messages/refetch (`cancel.tsx:99-118`). | PASS. |
| `mingla-business/app/checkout/[eventId]/buyer.tsx:328`, `app/checkout/[eventId]/payment.tsx:267`, `app/checkout-trip/[tripEventId]/buyer.tsx:348`, `app/checkout-trip/[tripEventId]/payment.tsx:271`, `app/checkout-trip/[tripEventId]/intake.tsx:314` | Buyer/free checkout success navigates and failure shows inline error; payment success toasts+navigates (`payment.tsx:452-471`, trip payment `:440-454`), failures set inline error; intake validation shows banner and success navigates. | PASS; payment-sheet user-cancel returns to the payment screen by design and is not a save failure. |

### Rework Commits

| Commit | Purpose |
| --- | --- |
| `25683db1c` | `ORCH-0980 fix no-toast local save fallthrough` |
| `f62be42d6` | `ORCH-0980 extend local reject toast regression` |
