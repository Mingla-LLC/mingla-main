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
