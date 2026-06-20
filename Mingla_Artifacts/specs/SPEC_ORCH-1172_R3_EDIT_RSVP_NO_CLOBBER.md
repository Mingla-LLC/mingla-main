# SPEC ORCH-1172 R3 — Edit-RSVP must not clobber untouched settings

Status: READY FOR IMPLEMENT
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1163-[rsvp-shared-body]`
Severity: P0 data-integrity (DEVICE-PROVEN, live). Editing one RSVP setting silently
reverts other settings the host never touched.
Owns: business-app RSVP edit-published hydration + the full-state save contract.

---

## DEVICE-PROVEN SYMPTOM (the contract this spec must restore)

Host opens a PUBLISHED RSVP (`event_type='rsvp'`) in the editor, toggles ONLY the
hide-address switch, taps Save. One save, observed in the DB:

| field | before | after | host touched? |
|---|---|---|---|
| `theme.business_event.hideAddressUntilTicket` | false | true | YES (correct) |
| `theme.business_event.settings.hideRemainingCount` | false | true | NO — **clobbered** |
| `events.rsvp_discoverable` (column) | true | false | NO — **reverted to default** |

Plus: on OPEN, the on-screen toggles did NOT match the DB — DB `rsvp_discoverable=true`
rendered the "Also show on discovery feed" switch OFF; DB `hideRemainingCount=false`
rendered "Hide the Going count" ON.

Note: ORCH-1172 (#559) + R2 (#561) are ALREADY committed in this worktree. Those PRs
fixed BUG-A (`rsvp_title_required`) and BUG-B (host-controls never diffed) by switching
the RSVP save to a **full-state** payload (`buildRsvpUpdatePayload(editState)`). That
full-state send is exactly what turns a hydration miss into a clobber. This is the R3
follow-on those PRs created.

---

## A) ROOT CAUSE

Two independent defects compound. **A1 is the proven, structural cause; A2 is the
mechanism that turns A1 into a destructive write.**

### A1 — HYDRATION DROP: the single-event read never attaches `rsvpMeta`

The editor's `serverLiveEvent` comes from `useBusinessEventById` →
`fetchBusinessEventById` (`mingla-business/src/services/businessEvents.ts:631`) →
`detailFromRow` (`businessEvents.ts:501`) → `eventFromRow(row, tickets)`
(`businessEvents.ts:506`).

`eventFromRow` reads the 6 RSVP host-controls **exclusively from its `rsvpMeta`
parameter**, NOT from the row:
- `businessEvents.ts:382-388`:
  `rsvpDiscoverable: rsvpMeta?.rsvpDiscoverable ?? false`,
  `rsvpCapacity: rsvpMeta?.rsvpCapacity ?? null`, `rsvpAllowPlusOnes ?? false`,
  `rsvpPlusOnesMax ?? 0`, `rsvpWaitlistEnabled ?? false`, `rsvpApprovalMode ?? "auto"`.

`detailFromRow` calls `eventFromRow(row, tickets)` with **NO `eventType` and NO
`rsvpMeta` argument** (`businessEvents.ts:506`). Both parameters default:
`eventType = "event"` (`businessEvents.ts:343`) and `rsvpMeta = null`
(`businessEvents.ts:354`).

Why `rsvpMeta` is null here: the 6 `rsvp_*` columns are NOT exposed by
`business_management_events_view` (the view def at
`supabase/migrations/20260604000002_orch_0824_expose_taxonomy_in_views.sql:56`
surfaces `management_theme = (e.theme - 'business_draft')` and taxonomy columns, but
no `rsvp_*` columns — confirmed: `BusinessManagementEventRow` has no `rsvp_*` fields,
`businessEvents.ts:40-74`). Only the LIST path
(`fetchBusinessEventsForBrand`, `businessEvents.ts:557-591`) runs a second `events`
probe that selects `rsvp_capacity, rsvp_allow_plus_ones, rsvp_plus_ones_max,
rsvp_waitlist_enabled, rsvp_approval_mode, rsvp_discoverable` and passes a populated
`rsvpMeta` (`businessEvents.ts:622-627`). The single-event detail path does NOT.

CONSEQUENCE: for a server-loaded RSVP opened in the editor, `serverLiveEvent` ALWAYS
carries `rsvpDiscoverable=false, rsvpCapacity=null, rsvpAllowPlusOnes=false,
rsvpPlusOnesMax=0, rsvpWaitlistEnabled=false, rsvpApprovalMode="auto"` regardless of
the saved DB values. `liveEventToEditableDraft` then copies these wrong values into the
DraftEvent view with `?? default` fallbacks
(`mingla-business/src/utils/liveEventAdapter.ts:98-103`), and `RsvpStep5Setup` renders
exactly what it's given (`RsvpStep5Setup.tsx:115` reads only `draft.*`, no internal
default state). This is the proven cause of BOTH the wrong-on-open render (discoverable
OFF when DB=true) AND the discoverable true→false revert on save.

> `fetchBusinessEventById` already does a direct `events` probe at
> `businessEvents.ts:641-645` (it grabs the raw `pass_*` switches for the same
> view-doesn't-expose-them reason — ORCH-1006). It just doesn't grab the `rsvp_*`
> columns yet. The fix rides this existing probe.

CANDIDATE VERDICTS (from the dispatch):
- (a) staleTime cache — **not the cause.** `staleTime=30s`
  (`useBusinessEvents.ts:31,143`) can serve a slightly old row, but every cached read
  goes through the SAME `fetchBusinessEventById` with no `rsvpMeta`, so the rsvp values
  are wrong regardless of cache freshness.
- (b) `RsvpStep5Setup` own default state — **REFUTED.** It is a pure prop-driven body
  (`RsvpStep5Setup.tsx:115`), no `useState`/default overlay.
- (c) `settings` object not parsed — **partially relevant only for
  `hideRemainingCount`.** `hideRemainingCount` IS read correctly from
  `settings = asRecord(theme.business_event.settings)` (`businessEvents.ts:359,460`)
  and `management_theme` retains `business_event` (only `business_draft` is stripped).
  So the read path for `hideRemainingCount` is correct. Its wrong-render + clobber is
  explained by A2 (the editState was seeded from a source where it was true, then the
  full-state save wrote it back) — see A2. The CERTAIN, structural break is the rsvp_*
  columns via null `rsvpMeta`.
- (d) seeded from zustand `liveEvent` instead of `serverLiveEvent` — **possible
  secondary contributor.** `resolvedLiveEvent = serverLiveEvent ?? liveEvent`
  (`app/rsvp/[id]/edit.tsx:123`). The zustand store does NOT persist events across cold
  starts (`liveEventStore.ts:453` `partialize → { events: [] }`), so on a fresh/deep-link
  open `liveEvent` is null and `serverLiveEvent` (with the A1 defect) is the source —
  matching the device repro. Even when zustand IS populated (same-session, from the LIST
  fetch which DOES carry rsvpMeta), A2 still freezes whichever value mounted first.

### A2 — FULL-STATE SAVE turns any hydration miss into a destructive overwrite

`EditPublishedScreen` seeds editState ONCE:
`const [editState, setEditState] = useState(initialEditState)` where
`initialEditState = useMemo(() => liveEventToEditableDraft(liveEvent), [liveEvent])`
(`EditPublishedScreen.tsx:300-304`). There is **NO `useEffect` re-seeding editState when
`liveEvent` changes** (confirmed: `setEditState` is only called from `handleUpdateDraft`,
`EditPublishedScreen.tsx:368-375`). So editState is FROZEN at the first-mount value — if
the screen mounted before `serverLiveEvent` resolved (or against a defaulted source), the
wrong values stick even after a fresh fetch lands.

The RSVP save (`EditPublishedScreen.tsx:764-784`, `rsvpMode` branch) sends
**`buildRsvpUpdatePayload(editState)`** — the FULL edit state, every field
unconditionally (`serverDraftEventMapper.ts:429-454`), NOT the `currentPatch` diff that
the ticketed path computes (`EditPublishedScreen.tsx:421-424` via
`editableDraftToPatch`). The ticketed path only ever sends changed fields; the RSVP path
sends everything.

`biz_update_live_rsvp` (`supabase/migrations/20261114000000_orch_1172_r2_rsvp_edit_hide_address.sql`)
DOES default every field to its existing stored value — but ONLY when the key is
**ABSENT** from the payload:
- columns: `v_rsvp_discoverable := COALESCE((p_payload->>'rsvpDiscoverable')::boolean,
  v_existing.rsvp_discoverable)` (migration line 146) — fires only if the key is missing.
- theme leaves: `v_hide_remaining_count := COALESCE((p_payload->>'hideRemainingCount')::boolean,
  (v_theme #>> '{business_event,settings,hideRemainingCount}')::boolean, false)`
  (migration lines 159-162).

Because `buildRsvpUpdatePayload` ALWAYS emits every key
(`serverDraftEventMapper.ts:445-453`), the COALESCE-to-existing safety NEVER triggers.
The client value always wins. A wrong editState value → a wrong, present payload value →
a destructive UPDATE.

### Net causal chain
`fetchBusinessEventById` drops `rsvpMeta` (A1) → editState seeds `rsvpDiscoverable=false`
etc. → editState frozen (A2) → `buildRsvpUpdatePayload` emits the wrong `false` →
`biz_update_live_rsvp` writes `rsvp_discoverable=false`, reverting the DB `true`. Same
mechanism reverts `hideRemainingCount` (the editState carried `true` from its mount
source; full-state wrote it back as `true` over the DB's `false`).

### Why the green ORCH-1172 test suite missed it
`editRsvpParity.orch1172.test.ts:40-96` builds its `LiveEvent` fixture with `rsvpMeta`
ALREADY correctly attached (`rsvpCapacity:20, rsvpDiscoverable:false`, lines 86-91) and
unit-tests `editableDraftToPatch` / `buildRsvpUpdatePayload` in isolation — it never
exercises the real `fetchBusinessEventById → eventFromRow` read where the hydration drops.

---

## B) FIX

**Recommendation: do BOTH (A) and (B). They are complementary, not alternatives.**

- **B1 (Hydration fix) is MANDATORY** — it fixes wrong-on-open (which a save-diff alone
  can never fix) and removes the root of the clobber.
- **B2 (Diff-based save, defense-in-depth) is STRONGLY RECOMMENDED** — it makes the RPC's
  existing COALESCE-on-absent safety actually fire, so any future hydration imperfection
  degrades to a no-op instead of a clobber. The RPC ALREADY supports this (it defaults
  absent keys to the stored value); no migration is required.

### B1 — HYDRATION FIX (mandatory)

Mirror the existing ORCH-1006 `pass_*` overlay pattern that the SAME function already
uses for the same view-doesn't-expose-these reason.

**File: `mingla-business/src/services/businessEvents.ts`**

1. `fetchBusinessEventById` (`:641-645`): extend the existing direct `events` probe to
   also select the 6 rsvp columns AND `event_type`:
   ```
   .select("id, event_type, pass_tax, pass_mingla_fee, pass_service_fee, " +
           "rsvp_capacity, rsvp_allow_plus_ones, rsvp_plus_ones_max, " +
           "rsvp_waitlist_enabled, rsvp_approval_mode, rsvp_discoverable")
   ```
   (event_type is already read here for the trip-rejection at `:647`; reuse it.)

2. Build an `rsvpMeta` object (shape per `eventFromRow`'s `rsvpMeta` param,
   `businessEvents.ts:346-354`) from the probe row WHEN `event_type === 'rsvp'`, else
   `null`. `rsvpGoingCount`: the single-event detail does not need the live count for
   editing — set `0` (the edit screen's notice uses `liveEvent.rsvpGoingCount`; if that
   "N going" line must be accurate in the editor, pull it from the existing
   `event_rsvps` count query pattern at `businessEvents.ts:595-601`, but this is
   OPTIONAL and out of the clobber scope — flag, do not gold-plate).

3. Thread `eventType` + `rsvpMeta` through to `eventFromRow`. Two equivalent shapes —
   implementor picks one:
   - **(preferred)** give `detailFromRow` two optional params
     `(row, eventType?, rsvpMeta?)` and pass them to `eventFromRow(row, tickets,
     eventType, rsvpMeta)` (`businessEvents.ts:506`); pass them from
     `fetchBusinessEventById` (`:665`). Audit the OTHER `detailFromRow` caller(s) — there
     is one more `eventFromRow` at `businessEvents.ts:745` (the publish-response mapper);
     leave it unchanged unless it serves RSVP edit (it does not).
   - or overlay onto `detail.event` after `detailFromRow` returns, exactly like the
     `pass_*` overlay at `businessEvents.ts:668+`.

Result: `serverLiveEvent` carries the TRUE saved rsvp_* values → `liveEventToEditableDraft`
seeds correct values → toggles render correctly on open → full-state save (even if kept)
writes back the correct values.

### B2 — DIFF-BASED SAVE (defense-in-depth; no migration)

Make the RSVP save send ONLY changed fields, leaning on the RPC's existing
COALESCE-on-absent behaviour so omitted fields are never clobbered.

**File: `mingla-business/src/utils/serverDraftEventMapper.ts`**
- Add `buildRsvpUpdatePayloadDiff(original: LiveEvent, edited: DraftEvent):
  Partial<RsvpUpdatePayload> & { title: string }`. It MUST always include `title`
  (the RPC hard-requires it, `biz_update_live_rsvp ... rsvp_title_required`,
  migration `:120-123`) and SHOULD always include the `when` block + `requestedVisibility`
  (cheap, idempotent, drives the material-change notify correctly). For the 9 toggled
  controls (`rsvpCapacity, rsvpAllowPlusOnes, rsvpPlusOnesMax, rsvpWaitlistEnabled,
  rsvpApprovalMode, rsvpDiscoverable, privateGuestList, hideRemainingCount,
  hideAddressUntilTicket`), emit a key ONLY when it differs from `original`. Reuse the
  same comparison shape `editableDraftToPatch` already uses
  (`liveEventAdapter.ts:391-414`).
- Keep `buildRsvpUpdatePayload` (full-state) exported for the create/publish parity tests,
  or have the diff builder delegate to it for the always-on fields.

**File: `mingla-business/src/components/event/EditPublishedScreen.tsx`**
- In the `rsvpMode` save branch (`:764-784`), replace
  `buildRsvpUpdatePayload(editState)` with
  `buildRsvpUpdatePayloadDiff(liveEvent, editState)`. `liveEvent` is already in scope.

> RPC change needed? **NO.** `biz_update_live_rsvp` (migrations 20261113000000 +
> 20261114000000) ALREADY defaults every omitted column AND every omitted theme leaf to
> its existing stored value (column COALESCE at migration `:146`; theme COALESCE at
> `:159-169`). A partial payload is already safe — B2 just stops sending the full state so
> that safety engages. Do NOT write a new migration. (If, and only if, B1 is shipped
> ALONE without B2, the RPC also needs no change — B1 makes the full-state values correct.)

### Recommendation summary
Ship **B1 + B2 together**. B1 alone fixes the proven clobber and the wrong-on-open render.
B2 adds a structural guarantee that future hydration regressions cannot clobber. Neither
requires a migration.

---

## C) TEST STRATEGY

All must FAIL on revert of the corresponding fix.

### C1 — Hydration regression (proves B1; the gap the existing suite missed)
File: `mingla-business/src/services/__tests__/businessEventById.rsvpHydration.orch1172r3.test.ts`
- Mock `supabase` so the `events` probe returns
  `{ event_type:'rsvp', rsvp_capacity:30, rsvp_discoverable:true, rsvp_allow_plus_ones:true,
  rsvp_plus_ones_max:2, rsvp_waitlist_enabled:true, rsvp_approval_mode:'manual' }` and the
  `business_management_events_view` returns a matching row whose
  `management_theme.business_event.settings.hideRemainingCount = false`.
- Call `fetchBusinessEventById(id)`. Assert the returned `event`:
  `rsvpDiscoverable===true`, `rsvpCapacity===30`, `rsvpApprovalMode==='manual'`,
  `rsvpWaitlistEnabled===true`, `rsvpAllowPlusOnes===true`, `rsvpPlusOnesMax===2`,
  `hideRemainingCount===false`, `event_type==='rsvp'`.
- FAILS ON REVERT: drop the rsvpMeta thread → all rsvp_* assertions collapse to the
  defaults (`false/null/"auto"`).

### C2 — Round-trip "edit one field leaves all others untouched" (proves no clobber)
File: extend `mingla-business/src/utils/__tests__/editRsvpParity.orch1172.test.ts`
(or a new `editRsvpNoClobber.orch1172r3.test.ts`)
- Start from a `LiveEvent` (built via the C1-style CORRECT hydration, or directly with
  `rsvpDiscoverable:true, hideRemainingCount:false, hideAddressUntilTicket:false`).
- `edited = { ...liveEventToEditableDraft(original), hideAddressUntilTicket: true }`
  (ONLY the hide-address toggle — the device repro).
- If B2 shipped: assert `buildRsvpUpdatePayloadDiff(original, edited)` does NOT contain
  `rsvpDiscoverable` and does NOT contain `hideRemainingCount` (so the RPC defaults them
  to existing), and DOES contain `hideAddressUntilTicket:true` + `title`.
- If B1-only path: assert that with correct hydration `buildRsvpUpdatePayload(edited)`
  emits `rsvpDiscoverable:true` (the TRUE value, not the reverted `false`) and
  `hideRemainingCount:false` — i.e. the full-state payload now carries the correct,
  non-clobbering values.
- FAILS ON REVERT: revert B2's diff (full-state returns) → `rsvpDiscoverable`/
  `hideRemainingCount` reappear in the payload with whatever editState held; revert B1 →
  the hydration-built original carries `false`/wrong, and the "TRUE value" assertion fails.

### C3 — RPC COALESCE-on-absent contract lock (proves the safety net B2 relies on)
File: `supabase/tests/` or a doc-asserted contract test (per repo convention; if no SQL
test harness, assert via a pgTAP-style or a documented invariant in the spec + a
client-side unit test that the diff builder OMITS unchanged keys).
- Given a payload that omits `rsvpDiscoverable` and `hideRemainingCount`, the RPC must
  leave `events.rsvp_discoverable` and `theme.business_event.settings.hideRemainingCount`
  at their pre-call values. This is already implemented (migration `:146`, `:159-162`);
  the test LOCKS it so a future RPC edit can't break the B2 assumption.
- FAILS ON REVERT: change the RPC COALESCE to write a literal default when the key is
  absent → the omitted-field values change.

### C4 — Material-change notify unaffected
Assert that an edit which DOES change date/venue still sets `v_material_change` and
enqueues `rsvp_event_updated` (existing behaviour, migration `:216-235`) — guard against
B2's `when`/location handling regressing the going-guest notification.

---

## SCOPE GUARDS (do NOT do)
- Do NOT add a migration. The RPC already COALESCEs absent keys.
- Do NOT change the ticketed edit path (`rsvpMode=false`) — it already diffs.
- Do NOT add `rsvp_*` columns to `business_management_events_view` (broader blast radius;
  the direct-probe overlay is the established ORCH-1006 pattern and is sufficient).
- Do NOT add a re-seed `useEffect` to editState as the primary fix — fix the source
  (B1) so the first mount is already correct. (An editState re-seed is acceptable ONLY if
  the implementor also proves it doesn't stomp in-progress edits; it is not required.)
- Do NOT chase the `rsvpGoingCount` accuracy in the editor notice — out of clobber scope;
  flag only.

---

## EVIDENCE INDEX (file:line)
- Editor seeds once, no re-seed: `EditPublishedScreen.tsx:300-304`, `:368-375`.
- RSVP save sends FULL state: `EditPublishedScreen.tsx:764-784`;
  `serverDraftEventMapper.ts:429-454`.
- Ticketed save sends DIFF (contrast): `EditPublishedScreen.tsx:421-424`;
  `liveEventAdapter.ts:260-415`.
- Hydration drop (null rsvpMeta): `businessEvents.ts:506` (call),
  `:335-354` (defaults), `:382-388` (rsvp reads from rsvpMeta), `:631-665`
  (`fetchBusinessEventById` probe that omits rsvp_* and never passes rsvpMeta).
- LIST path that DOES attach rsvpMeta (the pattern to mirror):
  `businessEvents.ts:557-591`, `:622-627`.
- View doesn't expose rsvp_* columns: `BusinessManagementEventRow`
  `businessEvents.ts:40-74`; view def
  `supabase/migrations/20260604000002_orch_0824_expose_taxonomy_in_views.sql:56`.
- RPC COALESCE-on-absent (the safety B2 relies on, no migration needed):
  `supabase/migrations/20261114000000_orch_1172_r2_rsvp_edit_hide_address.sql:146,159-169`.
- `liveEventToEditableDraft` `?? default` seeding: `liveEventAdapter.ts:98-103`.
- `RsvpStep5Setup` is pure prop-driven (no own default state):
  `RsvpStep5Setup.tsx:115,232-233,271-272`.
- Existing test fixture pre-attaches rsvpMeta (why suite is green):
  `editRsvpParity.orch1172.test.ts:86-91`.
- staleTime=30s (not the cause): `useBusinessEvents.ts:31,143`.
- zustand events not persisted (cold open → serverLiveEvent is the source):
  `liveEventStore.ts:453`.
