# IMPLEMENTATION — META-ORCH-1059 Kind-Aware Shared Management Screens

**ORCH:** META-ORCH-1059 [experiences-business-parity], kind-aware-screens pass
**Branch:** `meta-orch-1059-experiences-business-parity`
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/`
**Base commit:** `38636e6e5` (Sub-E edit-after-publish buyer-protection guards)
**Status:** implemented + verified (tsc clean, regression test fails-on-revert @ `38636e6e5`, full iOS bundle compiles with the kind-aware code live; live business-dashboard tap-through render UNVERIFIED — see §Device Evidence)

---

## Goal

The trip/experience operator dashboards (Pass 2) route into the SHARED event
sub-screens `/event/[id]/{orders,guests,scanner,scanners,blasts}`. Those
screens hardcoded EVENT copy ("Event not found", "Share event link", "Guests",
"Scan event tickets", "Different event", etc.), so a brand managing a trip or
experience saw "event"/"guests" everywhere. This pass makes the shared screens
KIND-AWARE: every USER-FACING noun/metric reads through the per-kind
`offeringKind` config lens. Events are byte-identical (config returns
"event"/"guests"); trips read "trip"/"travelers"; experiences read
"experience"/"spots". Routes/data/logic untouched — copy/lens only.

---

## Comms ledger

Read on entry. No `BLOCK` entries target this skill or META-ORCH-1059. Relevant
WARN/FYI factored: COMMS-0016 (experience-checkout constraint re-homed to Sub-F
— backend, unrelated to copy), COMMS-0018 (META-ORCH-1009 Sub-F source-to-main
reconciliation absorbed by META-ORCH-1062 — backend edge functions, unrelated to
this frontend copy change). No new COMMS entry written (no cross-ORCH discovery;
the pre-existing locked-test drift below is in-ORCH advisory, already documented
in the Pass-2/Pass-3 reports).

---

## Kind-derivation mechanism

The shared screens load the managed row via `useManagedEventRoute(id)`, whose
`LiveEvent.event_type` field (`"event" | "experience" | "trip"`, optional) is
the discriminator. Two NEW pure helpers were added to
`src/components/offering/offeringKind.ts`:

- `offeringKindFromEventType(eventType: string | null | undefined): OfferingKind`
  — maps `event_type` → `OfferingKind`, defaulting to `"event"` for
  null/undefined/unknown (matching `routeForEventRowDefensive`'s legacy-row
  interpretation; pre-discriminator persisted rows are all events). This is why
  EVENTS are never regressed.
- `capitalizeNoun(noun: string): string` — leads a sentence noun
  ("trip" → "Trip") for headings like "{Noun} not found".

Each screen derives `const kindCfg = offeringKindConfig(offeringKindFromEventType(event?.event_type))`
once from the already-loaded row, then composes every user-facing string from
`kindCfg.noun` / `kindCfg.metricSingular` / `kindCfg.metricPlural`. No new fetch,
no route change, no logic change.

**Transient-loader carve-out:** the "Loading event..." string in each screen's
loading shell is INTENTIONALLY kept generic. It renders only while the row is
still resolving (`event === null`), so the offering kind is not yet known — a
generic loader is correct. It is ALSO the locked shared-route-recovery marker
asserted by `src/utils/__tests__/serverDraftLifecycleGuards.test.ts`
("server-backed management subroutes use shared event route recovery"), which is
append-only locked. Relabeling it would (a) be meaningless (kind unknown) and
(b) break the locked marker. A protective comment documents this in each screen.

---

## Old → New Receipts (per screen + every relabeled string)

### `app/event/[id]/orders/index.tsx`
**Before:** hardcoded "Event not found", "Share event link" (empty-state CTA),
"No {filter} orders for this event." (no-match copy).
**Now:** imports the lens; derives `kindCfg`. Relabeled:
- `title="Event not found"` → `title={`${capitalizeNoun(kindCfg.noun)} not found`}` → "Trip not found"/"Experience not found".
- CTA `label: "Share event link"` → `` label: `Share ${kindCfg.noun} link` `` → "Share trip link"/"Share experience link".
- no-match `` `No ${filter} orders for this event.` `` → `` `...for this ${kindCfg.noun}.` ``.
- Loading shell: generic "Loading event..." retained (carve-out above) + protective comment.
**Why:** kind-aware copy on the shared orders screen.
**Lines:** ~+12 / −5.

### `app/event/[id]/guests/index.tsx`
**Before:** chrome title "Guests" (×3 shells), "Event not found", "Share event
link", "No guests yet", `No guests match "..."`, `Search guests` /
`Export guest list` a11y, `Downloaded N guest(s).` / `N guest(s) — CSV shared.`
toasts.
**Now:** imports the lens; derives `offeringKind` + `kindCfg`. Adds a headcount
lens that PRESERVES "Guests" for events (this screen predates the config, whose
event `metricPlural` is "attendees") and reads "Travelers"/"Spots" for
trips/experiences:
`headcountPlural = offeringKind === "event" ? "guests" : kindCfg.metricPlural`,
`headcountSingular` analogously, `headcountPluralCap = capitalizeNoun(headcountPlural)`,
and a `headcountLabelForCount(n)` helper for singular/plural in toasts.
Relabeled:
- chrome title "Guests" (all 3 shells) → `{headcountPluralCap}` → "Travelers"/"Spots"/"Guests".
- `title="Event not found"` → `` `${capitalizeNoun(kindCfg.noun)} not found` ``.
- `accessibilityLabel="Search guests"` → `` `Search ${headcountPlural}` ``.
- `accessibilityLabel="Export guest list"` → `` `Export ${headcountPlural} list` ``.
- empty `title="No guests yet"` → `` `No ${headcountPlural} yet` ``.
- empty CTA `label: "Share event link"` → `` `Share ${kindCfg.noun} link` ``.
- no-match `` `No guests match "..."` `` → `` `No ${headcountPlural} match "..."` ``.
- export toasts `N guest(s)` → `` `N ${headcountLabelForCount(N)}` `` (count-aware singular/plural).
- Loading shell: generic "Loading event..." retained (carve-out) + protective comment.
**Why:** kind-aware headcount metric + noun on the shared guests screen.
**Lines:** ~+22 / −10.

### `app/event/[id]/scanner/index.tsx`
**Before:** scan-result + auth messages hardcoded: "Different event"
(`wrong_event`), `Event ended {time}` / "Event has ended" / "Ticket can't be
used after the event" (`event_ended`), "You're not authorized to scan this
event" + "Ask the event owner to add you as a scanner." (`scanner_not_authorized`),
plus "Event not found" shell.
**Now:** imports the lens; derives `kindCfg`. Relabeled:
- `wrong_event` message "Different event" → `` `Different ${kindCfg.noun}` ``.
- `event_ended` `` `Event ended ${time}` `` → `` `${capitalizeNoun(kindCfg.noun)} ended ${time}` ``; "Event has ended" → `` `${capitalizeNoun(kindCfg.noun)} has ended` ``; detail "Ticket can't be used after the event" → `` `Ticket can't be used after the ${kindCfg.noun}` ``.
- auth message "You're not authorized to scan this event" → `` `...scan this ${kindCfg.noun}` ``; detail "Ask the event owner..." → `` `Ask the ${kindCfg.noun} owner...` ``.
- shell `title="Event not found"` → `` `${capitalizeNoun(kindCfg.noun)} not found` ``.
- `kindCfg.noun` added to `handleBarcodeScanned` useCallback deps.
- Loading shell: generic "Loading event..." retained (carve-out) + protective comment.
- KEPT (internal, not user-visible per dispatch): scan-result CODE strings
  `wrong_event`/`event_ended`/`not_found` (discriminators), session-log labels
  PAID/DUPE/WRONG/404/VOID/CXLD/EARLY/LATE, and the `${buyerName ?? "Guest"}`
  anonymous-buyer fallback (buyer label, not the offering noun).
**Why:** kind-aware scan-result + authorization copy.
**Lines:** ~+12 / −7.

### `app/event/[id]/scanners/index.tsx`
**Before:** "Event not found" shell, "Loading event..." shell.
**Now:** imports the lens; derives `kindCfg`. Relabeled:
- shell `title="Event not found"` → `` `${capitalizeNoun(kindCfg.noun)} not found` ``.
- Loading shell: generic "Loading event..." retained (carve-out) + protective comment.
- KEPT: "Ask your event manager or above to invite door staff." — "event
  manager" is a fixed brand ROLE name (`BRAND_ROLE_RANK.event_manager` in
  `permissionGates.ts`, used regardless of offering kind), NOT the offering
  noun. Relabeling it would misname the permission rank. See §Honest list.
**Why:** kind-aware shell copy.
**Lines:** ~+8 / −3.

### `app/event/[id]/blasts/index.tsx`
**No change.** Audited: all visible copy is about "Blasts"/"buyers", which is
kind-neutral (buyers are buyers for every offering). The only "event" tokens are
JSDoc comments and `audienceKind="event"` (an internal audience-scope enum for
`BlastCustomersCta`, not user-visible). The screen does not even use
`useManagedEventRoute`. Nothing to relabel.

### `src/components/offering/offeringKind.ts`
**Before:** config + `formatOfferingMetric`.
**Now:** ADDS `offeringKindFromEventType(eventType)` (discriminator → kind,
defaults event) + `capitalizeNoun(noun)`. Existing exports untouched.
**Why:** centralized kind-derivation + sentence-leading capitalization for the
shared screens. **Lines:** ~+34.

### `src/components/offering/OfferingListCard.tsx`
**No change needed.** Dispatch item 3 ("Untitled event" → per-kind) was ALREADY
satisfied by Pass 1: `untitledFor(kind)` returns "Untitled trip"/"Untitled
experience"/"Untitled event". Verified, no edit.

### Trip + experience DASHBOARD pages (dispatch item 4 audit)
**No change needed.** `app/trip/[id]/index.tsx` and `app/experience/[id]/index.tsx`
were audited for residual "event"/"guest" user-visible copy: the only matches
are JSDoc comments and tile-key string literals (`tile.key === "guests"`), not
user-facing copy. Pass 2 already routed all their tile labels + the manage sheet
through the config. Clean.

---

## Migrations

NONE. Frontend copy/lens only. No schema, no edge function, no DB read change.

---

## tsc

`npx tsc --noEmit` from `mingla-business/` — **zero errors in any touched file**
(filtered: `offeringKind.ts`, `event/[id]/{orders,guests,scanner,scanners}`).
Repo-wide pre-existing errors remain in untouched foreign files
(`packages/*`, marketing composer, `app-mobile/*`) — present on the base commit,
NOT introduced here.

---

## Regression Test (fails-on-revert verified @ `38636e6e5`)

`src/components/offering/__tests__/offeringKindAwareScreens.parity.test.ts`
(NEW, 11 tests, all green):

- **Block 1 (pure helpers):** `offeringKindFromEventType` maps the
  discriminator + defaults event for null/undefined/unknown; `capitalizeNoun`;
  composed strings per kind — "Trip not found"/"Experience not found",
  "Share trip link"/"Share experience link", headcount title
  Guests/Travelers/Spots, "Different trip", "Trip has ended".
- **Block 2 (screens kind-aware in source):** all four screens import the lens;
  no hardcoded steady-state "Event not found"/"Share event link"/"No guests
  yet"/"Different event"/"Event has ended"/"not authorized to scan this event";
  screens compose via `kindCfg`/`headcountPlural`.

**Run:** `npx jest .../offeringKindAwareScreens.parity.test.ts` → `Test Suites: 1
passed, Tests: 11 passed`.
**Fails-on-revert:** stashed the 4 screens + `offeringKind.ts` (keeping the
test) at base `38636e6e5` and re-ran → suite FAILS (`TS2305: '../offeringKind'
has no exported member 'capitalizeNoun'/'offeringKindFromEventType'`,
`Tests: 0`). Restored → 11 pass.

**Append-only locked-test interaction (handled):** changing the loading string
to "Loading {noun}..." initially broke the locked
`serverDraftLifecycleGuards.test.ts` marker that asserts `"Loading event..."`.
Resolved by reverting the loading strings to the generic literal (carve-out
above) — NOT by modifying the locked test. Verified: the full
`serverDraftLifecycleGuards` suite shows **identical 6-failed/15-passed on both
base and with my changes** (the 6 are pre-existing drift: ENOENT on
`app/(tabs)/events.tsx`, `router.replace("/(tabs)/events")` marker drift — see
Pass-2/3 reports), so this pass introduces ZERO net regression there.

---

## Device Evidence

**Physical `R58R54YV7JT` NOT connected** (only Android emulator `emulator-5554`
+ iOS sim `17091E60` [iPhone 17 Pro, iOS 26.4] booted). Metro on **8090**
confirmed serving THIS worktree (`expo start --dev-client --port 8090 --clear`,
cwd `meta-orch-1059`, `packager-status:running`).

- **Full iOS bundle compiles with the kind-aware code live:**
  `GET /index.bundle?platform=ios&dev=true` → **HTTP 200, 30,751,891 bytes**;
  grep of the compiled bundle confirms `offeringKindFromEventType`,
  `capitalizeNoun`, and `headcountPlural` are present (113 "Different "/"not
  found"/"not authorized to scan this " occurrences). Route bundle
  `GET /app/event/[id]/orders/index.bundle` → HTTP 200.
- **Sim relaunched** (terminate + launch `com.mingla.app.v2`) to load the latest
  bundle; Maestro reaches the sim and the app renders.

**UNVERIFIED (one criterion — same constraint Pass 2 hit):** the live business
experience-dashboard → shared-subscreen tap-through render of the relabeled
strings. The booted sim's `com.mingla.app.v2` is currently in a consumer/public
experience view, not the business-logged-in dashboard for "Raleigh Wine and Dine
Crawl" (the business brand context isn't active), and the physical device is
absent. The relabeled steady-state copy is proven by: (a) the full iOS bundle
compiling with the helpers live, (b) Pass 2's already-proven LIVE
experience-dashboard → `/event/{expId}/scanner` routing on THIS exact sim (the
shared screens DO resolve + render for experiences), and (c) the regression test
asserting the exact composed strings per kind with fails-on-revert.
**Manual test needed:** sign the business app into the Lantern & Vine brand,
open "Raleigh Wine and Dine Crawl", tap Orders / Scan / Guests and confirm
"experience"/"spots" copy; repeat for a TRIP brand ("travelers"/"trip"); open an
EVENT and confirm "event"/"guests" unchanged.

---

## Honest list — event-copy intentionally NOT relabeled

1. **"Loading event..." (all 4 shells)** — transient loader; kind unknown while
   `event === null`; also the locked shared-route-recovery marker. Kept generic
   on purpose (documented carve-out + protective comments).
2. **"Ask your event manager or above..." (scanners)** — "event manager" is a
   fixed brand permission ROLE name (`BRAND_ROLE_RANK.event_manager`), not the
   offering noun. Applies regardless of kind. Relabeling would misname the rank.
3. **Anonymous-buyer fallback `${buyerName ?? "Guest"}` (scanner success)** —
   "Guest" labels an unknown BUYER, not the offering. Consistent with the orders
   screen's "Anonymous" fallback. Left as-is.
4. **Internal scan-result CODE strings** (`wrong_event`, `event_ended`,
   `not_found`) + **session-log labels** (PAID/DUPE/WRONG/404/VOID/CXLD/EARLY/
   LATE) — not user-visible prose per dispatch; left as-is.
5. **`audienceKind="event"` (blasts)** — internal audience-scope enum, not
   user-visible copy. Left as-is.

---

## Cross-Surface Impact

Affected: **Business iOS + Business Android** (`mingla-business/app/event/[id]/*`
+ `src/components/offering/offeringKind.ts`) — shared RN code path, parity
automatic across both platforms (same component, no platform-specific files).
UNAFFECTED: Consumer iOS/Android (no equivalent business management screens),
Buyer/anon Web (no business state), Admin Web (doesn't render these screens),
Business Web preview (same shared code, inherits automatically).

---

## Files changed (commit pathspec — mingla-business only)

```
mingla-business/app/event/[id]/orders/index.tsx                                   (M)
mingla-business/app/event/[id]/guests/index.tsx                                   (M)
mingla-business/app/event/[id]/scanner/index.tsx                                  (M)
mingla-business/app/event/[id]/scanners/index.tsx                                 (M)
mingla-business/src/components/offering/offeringKind.ts                           (M)
mingla-business/src/components/offering/__tests__/offeringKindAwareScreens.parity.test.ts (A)
```
Foreign cruft (`app-mobile/*`, `packages/*`, anchor `COMMS_LEDGER.md`, the
unrelated `IMPLEMENTATION_*_COVER_PICKER_SELECTED_STATE.md`) left untouched and
NOT committed. No stray "* 2.*" dupes found.

**Commit hash:** _(filled in below after commit)_

---

## Discoveries for Orchestrator

1. **Pre-existing locked-test drift in `serverDraftLifecycleGuards.test.ts`**
   (6 failed / 15 passed on the base commit, independent of this pass): reads
   `app/(tabs)/events.tsx` which does not exist in this worktree (ENOENT ×3) and
   asserts a `router.replace("/(tabs)/events")` marker that drifted. Already
   noted in the Pass-2/3 reports. Recommend a follow-up to re-point or update
   those assertions. This pass neither fixes nor worsens them (identical
   failure count base vs. HEAD).
2. **Trip/experience business-dashboard live verification still needs a
   logged-in business brand context on the test device** (see §Device Evidence
   UNVERIFIED) — same gap Pass 2 documented for the trip dashboard.
