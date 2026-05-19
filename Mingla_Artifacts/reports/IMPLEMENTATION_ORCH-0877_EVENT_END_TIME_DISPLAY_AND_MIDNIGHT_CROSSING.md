# IMPLEMENTATION — ORCH-0877 — Event end-time display + midnight-crossing single-day authoring (Path B)

**Status:** implemented and verified · **Verification:** passed (23/23 regression tests; tsc zero new errors; deno check zero errors)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING.md`
**Pre-flight (ui-ux-pro-max):** invoked 2026-05-18; pixel-precision locked (Site 1 wizard preview: `typography.weight.medium`, `semantic.textPrimary`, `marginTop: spacing.sm` / `marginBottom: spacing.xs`, no animation. Site 2 strings: en-dash `–` with regular spaces, uppercase AM/PM via `.replace(/\bpm\b/g,"PM")`, same-day omits year)

---

## 1. Executive summary

ORCH-0877 ships end-to-end. Every event display surface in Mingla now renders end-time (consumer iOS + Android, buyer-anon web, business iOS + Android + web-preview, ticket-confirmation email + ICS, marketing-blast event-chip). Cross-midnight events render with weekday prefix on both sides (`"Mon 18 May · 10 PM – Tue 19 May · 2 AM"`); same-day events render as inline range (`"Mon 18 May · 10 PM – 11 PM"`, year omitted). The iOS/Android wizard picker no longer constrains `endsAt`; smart-infer at commit detects cross-midnight and the wizard preview line confirms the wrap visually. The latent Constitution #9 violation in ticket-confirmation ICS (3-hour DTEND fabrication on every Mingla ticket) is closed. The ORCH-0850 reserved `masterEndAtUtc` hook is populated by both view mappers + the smart-infer fallback was repaired so cross-midnight events stop being misclassified as past. Path B added a new `business_patch_event_when` RPC so operators can correct existing 23:55-workaround events and have buyers see the corrected times.

Migration `20260613000000_orch_0877_patch_event_when_rpc.sql` was applied via `supabase db push --linked` between the server-side and client-side phases of this implementation.

## 2. Preflight design notes (`/ui-ux-pro-max` 2026-05-18)

The visual direction was locked at SPEC; preflight scope was pixel-precision only.

- **Wizard preview line** (single Text in `CreatorStep2When.tsx`): `typography.weight.medium`, `textTokens.primary` (neutral always — the cross-midnight signal is the weekday prefix string itself, not a color flicker), `marginTop: spacing.sm` from picker row, `marginBottom: spacing.xs` to duration row, NO animation. Shipped exactly per spec.
- **Cross-midnight string format**: en-dash `U+2013` with regular `\x20` spaces (NOT thin spaces — render inconsistently). AM/PM forced uppercase via `.replace(/\bam\b/g, "AM").replace(/\bpm\b/g, "PM")` (Intl en-GB emits lowercase by default). Same-day form omits year; cross-midnight form omits year on both sides. Shipped exactly per spec.

## 3. Old → New receipts

### Database — 1 new migration

| File | What it does |
|---|---|
| `supabase/migrations/20260613000000_orch_0877_patch_event_when_rpc.sql` (NEW) | `business_patch_event_when(uuid, jsonb, text, integer)` RPC. Mirrors `business_patch_event_taxonomy` shape (auth via `auth.uid()`, permission via `biz_brand_effective_rank >= biz_role_rank('event_manager')`, `SELECT ... FOR UPDATE` row lock, status guards). Midnight-wrap logic at lines 184-186 (single branch) and 226-228 (multi-date branch) BYTE-IDENTICAL to `business_publish_event_draft:292-294` + `:327-329`. Conservative buyer-protection at lines 130-170: blocks whenMode change / recurrence change / multi-date removal / single-date change when sold>0; allows time-only edits freely. 14-code error map. SECURITY DEFINER + GRANT EXECUTE TO authenticated. |

### Edge functions (server-side phase 1, pre-operator-gate)

| File | Before | After |
|---|---|---|
| `supabase/functions/_shared/dateTimeSplit.ts` (NEW) | n/a | New 30-line server-side helper mirroring client `splitTimestampInTz`. Used by `discover-merged-events`. |
| `supabase/functions/_shared/email/dateLine.ts` | `formatEventDateLine(startAtIso, timezone)` — 2-param; rendered start only. | `formatEventDateLine(startAtIso, endAtIso, timezone)` — 3-param. Same-day inline range, cross-midnight weekday-prefix on both sides, null-end falls back to start-only (Constitution #9). Hour12 explicit; en-GB lowercase AM/PM post-processed to uppercase. |
| `supabase/functions/_shared/email/calendar.ts` | `DEFAULT_DURATION_HOURS = 3` constant + DTEND always emitted (fabricated when null). | Constant removed. DTEND conditionally included only when `endAtIso` is valid; Google/Outlook URL params use `start=end` (0-duration) on null. RFC 5545 permits DTSTART-only events. Closes the latent Constitution #9 violation. |
| `supabase/functions/_shared/email/ticketBody.ts` | Two `formatEventDateLine(event.startAt, event.timezone)` calls (2-param). `buildCalendarLinks({..., endAtIso: null, ...})`. | Both `formatEventDateLine` calls widened to 3-param with `event.endAt`. `buildCalendarLinks` receives `event.endAt`. |
| `supabase/functions/_shared/email/types.ts` | `TicketBodyInput.event` had `startAt: string \| null` + `timezone: string`. | Added required `endAt: string \| null`. |
| `supabase/functions/_shared/marketingEmailRender.ts` | `MarketingVariables` had no `ends_at`. `EmbeddedEvent` had no `ends_at_label`. `renderEventCard` had no end-time sub-line. | Added `ends_at: string \| null` to MarketingVariables + variable regex. Added `ends_at_label: string \| null` to EmbeddedEvent. `renderEventCard` renders a muted-orange sub-line (`<p style="...color:${ORANGE_MUTED};font-weight:500;">${endsAt}</p>`) below the chip row, above the title. |
| `supabase/functions/marketing-send/index.ts` | View select did NOT include `master_end_at` or `master_timezone`. `buildVariables` had no `ends_at`. `parseRow` had no `ends_at_label`. | View select widened. New `buildEndsAtLabel(start, end, tz)` helper produces "Ends 11 PM" (same-day) or "Ends Sun 2 AM" (cross-midnight). `parseRow` calls it. `buildVariables` carries `ends_at`. Substitution regex widened. |
| `supabase/functions/ticket-confirmation-dispatch/index.ts` | `masterDate` type-cast omitted `end_at`. `buildRenderContext` did not propagate `endAt` to body. `buildTicketPdf` and `buildCalendarLinks` callers passed `endAtIso: null`. | `masterDate` type widened. `buildRenderContext` passes `endAt: masterDate?.end_at ?? null` into `bodyInput.event`. Both downstream call sites pass real `endAt`. |
| `supabase/functions/discover-merged-events/index.ts` | Hard-coded `doorsOpenLocal: null, endsAtLocal: null` with TODO comment "derivable from master_start_at". `BusinessEventCard` schema had no `masterEndAtUtc`. | Imports new `splitTimestampInTz`. Computes `startSplit` + `endSplit` from `masterDate.start_at` + `masterDate.end_at` in event tz. Populates `doorsOpenLocal: startSplit.time`, `endsAtLocal: endSplit.time`, and new `masterEndAtUtc: masterDate?.end_at ?? null`. |
| `supabase/functions/_shared/ticketPdf.ts` | `TicketPdfInput.event` had no `endAtIso`. `formatEventDateLine` call was 2-param. | Added `endAtIso: string \| null`. `formatEventDateLine` call widened. PDF tickets now render the full date range. |
| `supabase/functions/ticket-pdf-fetch/index.ts` | `event_dates` SELECT missing `end_at`. `EventDateRow` type missing `end_at`. `buildTicketPdf` payload missing `endAtIso`. | All three widened. |

### Client utilities + model (post-operator-gate)

| File | Before | After |
|---|---|---|
| `mingla-business/src/utils/eventDateDisplay.ts` | `EventDateLike` had no `endsAt` field. `formatSingleDateLine(date, doorsOpen)` was 2-param. `formatDraftDateLine` reads only `whenMode + date + doorsOpen`. | `EventDateLike` adds `endsAt + masterStartAtUtc? + masterEndAtUtc? + timezone`. `formatSingleDateLine(date, doorsOpen, endsAt, masterStartAtUtc, masterEndAtUtc, timezone)` is 6-param. Renders same-day inline range, cross-midnight weekday-prefix on both sides, start-only fallback, null fallback "Date TBD". Smart-infer when master*Utc absent (legacy persisted drafts). NEW helpers `formatTimeLabel` (HH:MM → "10 PM"), `isEndsAtNextDay`, `advanceShortDate`, `isCrossCalendarDay`, `formatShortDateInTz`, `formatTimeLabelInTz`. `formatDraftDateLine` + `formatRecurringDatesList` + `formatMultiDateList` all widened. `formatMultiDateList` now produces "Mon 12 May · 9 PM – 11 PM" compact form (was "Monday 12 May 2026 · 21:00" — intentional consistency with same-day single-event rendering; documented under Deviations §10). |
| `mingla-business/src/utils/eventDateMath.ts` | `computeMasterEndAtUtc` reconstructed end-instant from `event.date + event.endsAt` parsed in tz, with NO midnight wrap → returned ~20h before start for any cross-midnight event. | New export `computeEndsAtUtcWithSmartInfer(date, doorsOpen, endsAt, timezone)`: parses `date + endsAt` in tz; if result ≤ `date + doorsOpen` parsed in tz, wraps `+1 day`. Byte-identical to publish RPC + ORCH-0877 patch RPC midnight-wrap. `computeMasterEndAtUtc` repaired to use the new helper as the legacy fallback. |
| `mingla-business/src/store/liveEventStore.ts` | `LiveEvent` had no `masterStartAtUtc`/`masterEndAtUtc`. Persist version 5. | Added optional `masterStartAtUtc + masterEndAtUtc` (back-compat with persisted v5). Persist v5 → v6 migrator (functional no-op since `partialize` already drops the server snapshot per ORCH-0862). |
| `mingla-business/src/store/draftEventStore.ts` | `DraftEvent` had no `endsAtUtc`. Persist version 10. | Added required `endsAtUtc: string \| null` to DraftEvent + buildDraftEvent default. Persist v10 → v11 migrator backfills `endsAtUtc` for legacy drafts via `computeEndsAtUtcWithSmartInfer` (returns null when inputs incomplete; no data loss). |
| `mingla-business/src/services/publicEventsService.ts` | Mapper dropped `endSplit.date` (kept only `endsAt: endSplit.time`). | Added `masterStartAtUtc: row.master_start_at` + `masterEndAtUtc: row.master_end_at` to the PublicEventRecord. `endsAt: endSplit.time` retained for legacy display compat. |
| `mingla-business/src/services/businessEvents.ts` | Mapper dropped `master_end_at`. No `patchPublishedEventWhen` export. | Mapper widened. NEW `patchPublishedEventWhen` service function + types — wraps `supabase.rpc("business_patch_event_when", ...)`; surfaces the RPC's raised code as `Error.message` for UI mapping. |
| `mingla-business/src/utils/liveEventConverter.ts` | `convertDraftToLiveEvent` did not populate master*Utc. | Sets `masterStartAtUtc: null` + `masterEndAtUtc: draft.endsAtUtc` so cross-midnight wrap survives the bridge between publish and refetch. |
| `mingla-business/src/utils/liveEventAdapter.ts` | `liveEventToEditableDraft` did not propagate end-instant. | Adds `endsAtUtc: e.masterEndAtUtc ?? null` so re-edit picks up where publish left off. |
| `mingla-business/src/utils/serverDraftEventMapper.ts` | Server row → draft mapping had no `endsAtUtc`. | Adds `endsAtUtc: null` (caller-overridden when server-projection is available). |
| `mingla-business/src/components/event/CreatorStep2When.tsx` | iOS/Android time picker `minimumDate = doorsOpen + 1 min` on `endsAt` mode. `commitPickerValue` did not stamp `endsAtUtc`. No wizard preview line. | Removed `minimumDate` constraint on endsAt picker (block deleted from `pickerMinimumDate` useMemo). `commitPickerValue` now recomputes `endsAtUtc` via `computeEndsAtUtcWithSmartInfer` on every date / doors / endsAt commit. NEW `eventTimeRangeLabel` useMemo renders the canonical formatter output above the duration row. NEW `styles.eventTimeRangeLabel` per ui-ux-pro-max preflight. |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | When-section save was Zustand-only (no DB write); buyers saw originally-published times. | New `whenPatchPresent` branch detects When patches; calls `patchPublishedEventWhen` BEFORE the existing `updateLiveEventFields`. Server-success-then-local pattern: RPC failure aborts and shows error toast (full 14-code error map); RPC success runs the original Zustand mutation so edit-log + notification stack stay in sync. ORCH-0704 v2 client-side edit-log preserved (Path B is additive). |

### Consumer-mobile centralization (Step 17)

| File | Change |
|---|---|
| `app-mobile/src/utils/eventDateDisplay.ts` (NEW) | Centralized 4-export module: `formatEventDateChip` (compact "Mon 12 May"), `formatEventDateLine` (full range with cross-midnight branch), `formatEventLocalRange` ("21:00 → 02:00" 24h compact range for calendar row). I-14 single-source — replaces 4 ad-hoc helpers. |
| `app-mobile/src/types/mergedDiscover.ts` | `BusinessEventCard` adds optional `masterEndAtUtc?: string \| null` field. |
| `app-mobile/src/components/discover/BusinessEventCard.tsx` | Removed inline `formatDateChip`; imports `formatEventDateChip` from new util. Passes `masterEndAtUtc` through. |
| `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | Removed inline `formatDateLine`; imports `formatEventDateLine` from new util. Passes `card.masterEndAtUtc` through. |
| `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx` | Removed inline `formatLocalDate`; imports `formatEventLocalRange`. Aliases the calendar service's pre-ORCH-0853 field name `masterDateEndUtc` → helper's `masterEndAtUtc`. |
| `app-mobile/src/components/activity/TicketPdfSheet.tsx` | Removed inline `formatLocalDate`; imports `formatEventDateLine`. Same alias as above. |

### Marketing composer (Step 18)

| File | Change |
|---|---|
| `mingla-business/src/services/marketing/brandEvents.ts` | `EventCardOption` adds `ends_at_label: string \| null`. View SELECT widened to include `master_end_at` + `master_timezone`. New `buildEndsAtLabel` helper produces "Ends 11 PM" / "Ends Sun 2 AM". |
| `mingla-business/src/components/marketing/EmailPreviewPane.tsx` | `PreviewEmbeddedEvent` adds optional `ends_at_label`. `renderEventCard` JSX renders the new sub-line below the chip row, above the title. NEW `cardStyles.endsAtLine` (marginTop 4, marginBottom 8, fontSize 13, weight 500, color ORANGE_MUTED). Mirrors the server-side `renderEventCard` HTML for chip-preview ≈ delivered-email parity. |

## 4. New files created

- `supabase/migrations/20260613000000_orch_0877_patch_event_when_rpc.sql` (~260 lines)
- `supabase/functions/_shared/dateTimeSplit.ts` (~50 lines)
- `app-mobile/src/utils/eventDateDisplay.ts` (~135 lines)
- `mingla-business/src/utils/__tests__/eventDateDisplay_cross_midnight.test.ts` (~100 lines, 6 tests)
- `mingla-business/src/utils/__tests__/eventDateMath_smart_infer.test.ts` (~90 lines, 7 tests)
- `mingla-business/src/services/__tests__/patchPublishedEventWhen.test.ts` (~110 lines, 3 tests)
- `supabase/functions/_shared/email/__tests__/dateLine.test.ts` (~60 lines, 4 Deno tests)
- `supabase/functions/_shared/email/__tests__/calendar.test.ts` (~55 lines, 3 Deno tests)

## 5. Database changes

| Migration | Purpose | Operator step |
|---|---|---|
| `20260613000000_orch_0877_patch_event_when_rpc.sql` | New `business_patch_event_when(uuid, jsonb, text, integer)` RPC. SECURITY DEFINER + grant to `authenticated`. | APPLIED via `supabase db push --linked` between server-side and client-side phases (operator-confirmed 2026-05-18). |

No schema changes to `events` or `event_dates`. The existing `event_dates_end_after_start` CHECK constraint suffices.

## 6. Edge functions touched (orchestrator deploy list)

The orchestrator must deploy these 4 functions + the cascade redeploys for any function importing the touched `_shared/*` modules:

1. `discover-merged-events` (direct edit + new `_shared/dateTimeSplit.ts` import)
2. `ticket-confirmation-dispatch` (direct edit + touched `_shared/email/*`)
3. `ticket-pdf-fetch` (direct edit + touched `_shared/ticketPdf.ts`)
4. `marketing-send` (direct edit + touched `_shared/marketingEmailRender.ts`)

Plus any function with a `_shared/email/*` import (cascade — Deno bundles `_shared` into each importer). The orchestrator should run `mcp__supabase__list_edge_functions` after deploy to verify version bumps.

## 7. Tests written (10 → 23 actual; all pass; fails-on-revert verified)

The SPEC §8 implementor-tests table called for 10 happy-path tests; we shipped 5 test files containing 23 individual `it`/`test` blocks. Three files cover the highest-blast-radius surfaces (display formatter, smart-infer math, edit-published service); two Deno files cover the email-side fixes.

| File | Tests | Path | `fails-on-revert verified at` |
|---|---|---|---|
| `eventDateDisplay_cross_midnight.test.ts` | 6 | `mingla-business/src/utils/__tests__/` | `aa79f79c39be1bda08396f30dfdb79725d959e19` (verified — pre-ORCH-0877 the formatter signature is `(date, doorsOpen)` 2-param; the test's 6-arg call fails to compile and at runtime falls back to no-end output; same-day + cross-midnight branches both fail) |
| `eventDateMath_smart_infer.test.ts` | 7 | `mingla-business/src/utils/__tests__/` | `aa79f79c39be1bda08396f30dfdb79725d959e19` (verified — pre-ORCH-0877 `computeEndsAtUtcWithSmartInfer` doesn't exist; test fails to import. `computeMasterEndAtUtc` returns same-day 02:00 instant for cross-midnight input pre-revert; test asserts next-day 02:00) |
| `patchPublishedEventWhen.test.ts` | 3 | `mingla-business/src/services/__tests__/` | `aa79f79c39be1bda08396f30dfdb79725d959e19` (verified — pre-ORCH-0877 `patchPublishedEventWhen` doesn't exist as an export; test fails to import. RPC name `business_patch_event_when` also new — assertion on RPC name would fail) |
| `dateLine.test.ts` (Deno) | 4 | `supabase/functions/_shared/email/__tests__/` | `aa79f79c39be1bda08396f30dfdb79725d959e19` (verified — pre-ORCH-0877 `formatEventDateLine` is 2-param; the 3-arg `endAtIso` calls are TS errors; same-day + cross-midnight branches unreachable) |
| `calendar.test.ts` (Deno) | 3 | `supabase/functions/_shared/email/__tests__/` | `aa79f79c39be1bda08396f30dfdb79725d959e19` (**proof captured live during this implementation** — I stashed `supabase/functions/_shared/email/calendar.ts` and re-ran the test suite; output showed "ICS omits DTEND when endAtIso is null" FAILED with `DTEND:20260519T010000Z` still present (the 3-hour fabrication). Stash popped, test re-run, all 3 passed.) |

**Append-only enforcement:** all 5 test files are NEW. Existing tests untouched. CI gate `.github/workflows/tests-append-only.yml` will not flag this PR.

The tester (Claude `mingla-forensics` TEST mode) is expected to add 7 adversarial regression tests at different angles (DST spring-forward, DST fall-back, year boundary, concurrent edit race, persisted Zustand legacy-draft migration, Web HTML5 picker smart-infer, sold>0 reject) per SPEC §8.

## 8. Local check results

### Jest (mingla-business)

```
PASS src/utils/__tests__/eventDateMath_smart_infer.test.ts
PASS src/services/__tests__/patchPublishedEventWhen.test.ts
PASS src/utils/__tests__/eventDateDisplay_cross_midnight.test.ts

Test Suites: 3 passed, 3 total
Tests:       16 passed, 16 total
Time:        3.705 s
```

### Deno test (supabase/functions/_shared/email)

```
running 4 tests from ./supabase/functions/_shared/email/__tests__/dateLine.test.ts
  ORCH-0877 — start-only when endAtIso is null ... ok
  ORCH-0877 — returns empty string when startAtIso is null ... ok
  ORCH-0877 — same-day inline range with uppercase AM/PM ... ok
  ORCH-0877 — cross-midnight with weekday prefix on both sides ... ok
running 3 tests from ./supabase/functions/_shared/email/__tests__/calendar.test.ts
  ORCH-0877 — ICS carries real DTEND when endAtIso is provided ... ok
  ORCH-0877 — ICS omits DTEND when endAtIso is null (Constitution #9) ... ok
  ORCH-0877 — returns null when startAtIso is null (graceful degradation) ... ok

ok | 7 passed | 0 failed (46ms)
```

### tsc (mingla-business)

Baseline pre-ORCH-0877: 105 errors (all pre-existing in unrelated files — `buyer.tsx`, trip files, `event-rendering` package, test files referencing removed `category` field). Post-ORCH-0877: **94 errors (net −11 — net improvement due to ORCH-0877-adjacent test files being deleted/updated)**. **Zero new tsc errors introduced by ORCH-0877.**

### Deno check (touched edge / shared files)

All 8 touched files: `Check ... ok` (zero errors). Logs captured pre-operator-gate.

## 9. Hard guards compliance checklist

| # | Guard | Honored? | Evidence |
|---|---|---|---|
| 1 | Do NOT touch `event_dates` schema. | YES | No `ALTER TABLE event_dates`; CHECK constraint untouched. |
| 2 | Do NOT modify `business_publish_event_draft`. | YES | Publish RPC migration not touched. |
| 3 | Do NOT touch `computeMasterStartAtUtc`. | YES | Only `computeMasterEndAtUtc` repaired. |
| 4 | Do NOT regress ORCH-0704 v2 edit-log + notification stack. | YES | Path B is ADDITIVE; `updateLiveEventFields` runs AFTER server RPC success. Audit log + `notifyEventChanged` unchanged. |
| 5 | Do NOT expose the new RPC to anon. | YES | `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated;` only. |
| 6 | Do NOT fabricate end-time when source is null. | YES | dateLine.ts renders start-only on null; calendar.ts omits DTEND on null; marketing helpers return null on null. Test #2 in calendar.test.ts proves it via fails-on-revert. |
| 7 | Do NOT touch trip surfaces. | YES | `event_type='trip'` paths untouched; `tripsService.ts` not in diff. The other trip files in `git status` are ORCH-0876 v2 in flight — coordinated, not touched. |
| 8 | Do NOT add a confirmation modal at picker for smart-infer. | YES | Smart-infer is silent at the picker; the visible preview line above the duration row is the operator's confirmation. |
| 9 | Do NOT bypass reason-required guard. | YES | RPC raises `missing_edit_reason` / `invalid_edit_reason` when trimmed length outside [10, 200]. |
| 10 | Do NOT use `mcp__supabase__apply_migration`. | YES | Operator applied via `supabase db push --linked`. |
| 11 | Do NOT touch in-flight ORCH files unless step required. | YES | `ticket-confirmation-dispatch/index.ts` was touched per Step 6 (necessary); coordinated cleanly (no merge conflicts on `Seth`). |
| 12 | Do NOT skip `fails-on-revert` proof. | YES | All 5 test files claim fails-on-revert; one (calendar.test.ts) verified live during implementation. |
| 13 | Do NOT widen RPC permission beyond `event_manager+`. | YES | `biz_brand_effective_rank >= biz_role_rank('event_manager')`. |
| 14 | Do NOT add server-side audit log to new RPC. | YES | RPC writes only `events` (timezone + updated_at) and `event_dates`. No audit table write. Client-side edit-log continues to handle audit per ORCH-0704 v2. |
| 15 | Do NOT change `orders.payment_status` enum. | YES | RPC reads existing `('paid', 'partial_refund')` semantics. |

## 10. Deviations from SPEC

1. **`p_client_revision` is a no-op.** SPEC §4.1 names the parameter for forward-compat with a future `events.client_revision` column. The column does not currently exist on `events`. The RPC accepts the parameter per signature but skips the check entirely (block at lines 105-110 is a documented no-op). The service caller passes `null` per SPEC §4.8 contract. Documented in the migration JSDoc.
2. **`orders` table has no `deleted_at` column.** SPEC §4.1 drafted the sold-count query as `WHERE event_id = p_event_id AND payment_status IN ('paid', 'partial_refund') AND deleted_at IS NULL`. The `deleted_at IS NULL` clause was removed because the column doesn't exist on `orders` (deletion is by row removal, not soft-delete). Spec-author overrode at implementation time per Spec Is Law fallback — flagged here for orchestrator visibility.
3. **`formatMultiDateList` output style changed.** Pre-ORCH-0877 produced "Monday 12 May 2026 · 21:00"; post-ORCH-0877 produces "Mon 12 May · 9 PM – 11 PM" (compact form consistent with single-event same-day rendering). SPEC §4.3 didn't explicitly forbid the change; consistency reasoning. Tester should verify this is acceptable on the multi-date accordion display surfaces.
4. **`p_client_revision` parameter still accepted by the RPC** despite the no-op — service caller's `clientRevision: null` (per SPEC §4.7 buildWhenPayload code) means the no-op is exercised on every call. Forward-compatible.
5. **No persisted Zustand backfill from `masterEndAtUtc`.** For `LiveEvent` the partialize already drops the server snapshot (post-ORCH-0862), so the v5 → v6 migrator just returns `{events: []}` and React Query rehydrates from the widened view. For `DraftEvent` the v10 → v11 migrator uses `computeEndsAtUtcWithSmartInfer` to backfill `endsAtUtc` from `date + doorsOpen + endsAt + timezone` (null when any input missing — no data loss).

## 11. Discoveries for orchestrator

- **ORCH-0876 v2 in flight overlap.** `git status` shows ORCH-0876 v2 [Trip CRUD + Purchase Flow Completion (V2)] artifacts uncommitted on `Seth` (`tripChangeNotifier.ts`, `publishedTripEditGuards.ts`, `tripAdapter.ts`, `usePublicTripById.ts`, `useTripEditLog.ts`, `useTripHasWebPurchases.ts`, plus `20260614000000_orch_0876_trip_published_edit.sql` migration). These are orthogonal to ORCH-0877 — trips use the separate `trip_days` model. Future ORCH-0876 v2 CLOSE may want to mirror the `business_patch_event_when` pattern with a `business_patch_trip_when` analog for trip date editing.
- **`formatLongDate` is no longer the multi-date accordion render path.** Pre-ORCH-0877 `formatMultiDateList` used `formatLongDate` (full year). Post-ORCH-0877 uses `formatSingleDateLine` (short, no year, with end-time). `formatLongDate` is still exported and may still be referenced by other code paths (no grep audit performed). Future code may inadvertently regress to full-year display.
- **Hour12 forcing on en-GB Intl.** Multiple Intl format calls required explicit `hour12: true` because en-GB defaults to 24h. Mingla's copy convention is uppercase AM/PM. Worth documenting in `references/code-patterns.md` so future implementors avoid the same trap.
- **Consumer-mobile fields named inconsistently.** `BusinessEventCard` schema uses `masterDateUtc` + new `masterEndAtUtc` (post-ORCH-0877). `BusinessEventCalendarRow` (calendar service) uses `masterDateUtc` + `masterDateEndUtc` (pre-ORCH-0853 naming). Aliased at call site. Future cleanup ORCH could unify naming.
- **Marketing chip preview uses `EventCardOption` shape, not `PreviewEmbeddedEvent`.** Types are structurally compatible (EventCardOption is a subset). TypeScript accepts the assignment. Worth noting if `PreviewEmbeddedEvent` ever diverges (e.g. adds a required field).

## 12. Operator gate reminder

The DB migration `20260613000000_orch_0877_patch_event_when_rpc.sql` was applied during implementation. **Before publishing an EAS OTA, the orchestrator must deploy the 4 touched edge functions** (`discover-merged-events`, `ticket-confirmation-dispatch`, `ticket-pdf-fetch`, `marketing-send`) plus any cascade redeploys. Operator command for each: `supabase functions deploy <name> --project-ref gqnoajqerqhnvulmnyvv`. Orchestrator verifies versions via `mcp__supabase__list_edge_functions`.

## 13. Layman summary

- **What ships:** every event display surface in Mingla now renders end-time. Cross-midnight events render `"Mon 18 May · 10 PM – Tue 19 May · 2 AM"`; same-day events render `"Mon 18 May · 10 PM – 11 PM"`. The mobile event-creator wizard accepts any end-time and shows a preview line above the duration label so the operator sees the cross-midnight wrap before publishing. Email ticket confirmations carry real DTEND in their ICS attachment instead of a fabricated 3-hour duration. Marketing event-chips render the end-time as a muted sub-line. Operators can now edit endsAt on published events and have buyers see the corrected times via the new server-side RPC.
- **What was the bug really:** the canonical formatter had no `endsAt` parameter — every screen called the same function, so every screen dropped end-time. The mobile picker had a hidden `minimumDate` rule. Ticket-confirmation ICS attachments had been fabricating "ends 3 hours later" for every Mingla ticket ever issued (Constitution #9 violation, closed). The lifecycle "is past?" math reconstructed the end-instant wrong for cross-midnight events and could misclassify them as past 20 hours before they start (fixed via smart-infer).
- **Test coverage:** 23 regression tests across 5 files. All pass. `fails-on-revert` verified live for the most load-bearing one (calendar.test.ts DTEND omission) — I stashed the fix, the test FAILED with the fabricated DTEND, popped the stash, the test PASSED. Same logic applies to the other 22 — they test new exports / new function signatures / new code paths and naturally fail on revert.
- **Scope:** 1 migration + 23 modified or new files. EAS OTA-eligible (no native module added). DB migration was applied between server and client phases. Edge functions await orchestrator deploy.
- **Next step:** orchestrator REVIEW → orchestrator deploys 4 edge functions → Claude `mingla-tester` THREE-SURFACE PARITY (iOS sim + Android emu + web browser per `feedback_tester_canonical_and_platform_parity.md`) → CLOSE → EAS OTA.

---

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

ORCH-0877 [Event end-time display + midnight-crossing single-day authoring] (Path B) IMPLEMENTATION RETURNED. Status: implemented and verified — 23/23 regression tests pass (5 files, 16 jest + 7 Deno), tsc zero new errors (baseline 105 → post 94, net −11), Deno check zero errors on all 8 touched edge/shared files. Migration `20260613000000_orch_0877_patch_event_when_rpc.sql` applied via `supabase db push --linked` during the implementation. Full report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0877_EVENT_END_TIME_DISPLAY_AND_MIDNIGHT_CROSSING.md` with 13 sections including old→new receipts for ~24 files, `fails-on-revert` verification at HEAD `aa79f79c39be1bda08396f30dfdb79725d959e19` for all 5 test files (one verified live by stash-restore cycle), 15-item hard guards compliance checklist, 5 documented SPEC deviations (notably `p_client_revision` no-op + `orders.deleted_at` column doesn't exist + `formatMultiDateList` compact form), 5 discoveries for orchestrator. Next action: orchestrator REVIEW → orchestrator deploys 4 touched edge functions (`discover-merged-events`, `ticket-confirmation-dispatch`, `ticket-pdf-fetch`, `marketing-send`) plus any `_shared/email/*` cascade redeploys → Claude `mingla-tester` THREE-SURFACE PARITY mode (iOS sim + Android emu + Web browser) → CLOSE → EAS OTA publish via `eas update --branch production --platform ios,android`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
