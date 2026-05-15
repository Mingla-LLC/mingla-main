# SPEC — ORCH-0846 [Consumer event sheet venue/address parity with brand-side public page]

**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Implementor:** Codex `implementor-mingla` (default IMPLEMENT owner).
**Status:** Ready for implementation.

---

## 1. Scope

Restore parity between the brand-side public buyer page (`mingla-business` `/e/{brandSlug}/{eventSlug}`) and the consumer-side `ExpandedBusinessEventSheet` (`app-mobile` Discover → tap business event) on three fields rendered by the shared `@mingla/event-rendering` `PublicEventPage`:

1. `venueName` (string | null) — must resolve identically on both sides.
2. `address` (string | null) — must resolve identically on both sides and let the shared UI gate visibility via `hideAddressUntilTicket`.
3. `format` ("in-person" | "online" | "hybrid") — must derive from `theme.business_event.format` with `events.is_online` fallback, identically on both sides.

The contract: a card surfaced by `supabase/functions/discover-merged-events/index.ts` and mapped by `ExpandedBusinessEventSheet.mapCardToPublicEvent` MUST produce the SAME shared-component output as `publicEventsService.getPublicEventBySlug` → `mingla-business/src/components/event/PublicEventPage.tsx` for the same `events` row.

---

## 2. Non-goals

- **No** venue-card UI redesign. The shared `PublicEventPage` `<View style={styles.venueCard}>` block is untouched.
- **No** changes to `hideAddressUntilTicket` semantics. Default remains `true`; brand UI gate copy unchanged.
- **No** maps embed, no copy-to-clipboard, no "open in Maps" affordance — those are future ORCHs.
- **No** changes to Ticketmaster event cards or `place_pool` expanded card flows — they use entirely different code paths.
- **No** changes to `events` table schema. No migration in this ORCH.
- **No** changes to the shared `@mingla/event-rendering/PublicEventPage.tsx` component itself — the bug is in the consumer-side payload producer, not the renderer.

---

## 3. Assumptions

A1. `events.location_text` is non-null for the overwhelming majority of live business events post-ORCH-0824 [post-publish address re-pick RPC]. Implementor MUST run the SQL probe in §10.D to quantify (via the Supabase Management API workaround per `feedback_supabase_mcp_workaround.md`) before writing the test fixtures. If `location_text` is null on a meaningful slice, the shared `PublicEventPage` already renders a fallback inside the venue card — that path is preserved.

A2. `theme.business_event.venueName` is OFTEN null (the wizard does not require a separate venue name distinct from address), so the `?? row.location_text` fallback is the dominant render path. Confirmed by reading `mingla-business/src/store/draftEventStore.ts:268–269,379` and the brand-side `publicEventsService.ts:377`.

A3. `theme.business_event.format` is one of the literal strings `"in_person" | "online" | "hybrid"` (underscore form, per draft store). The shared component contract uses the hyphen form `"in-person" | "online" | "hybrid"`. Conversion happens at the producer.

A4. ORCH-0845 [Discover excludes ended events] SPEC may land before or after this ORCH. The two changes touch disjoint regions of `supabase/functions/discover-merged-events/index.ts`. Whichever lands first, the other rebases on `Seth`.

---

## 4. Layer-by-layer specification

### 4.A — Edge function: `supabase/functions/discover-merged-events/index.ts`

**Add three helpers** alongside the existing `extractCoverHue` / `extractHideAddressUntilTicket` (around line 165–185):

```ts
function extractVenueName(theme: unknown): string | null {
  if (theme && typeof theme === "object") {
    const be = (theme as Record<string, unknown>).business_event;
    if (be && typeof be === "object") {
      const v = (be as Record<string, unknown>).venueName;
      if (typeof v === "string" && v.trim().length > 0) return v;
    }
  }
  return null;
}

function extractBusinessEventFormat(theme: unknown): "in_person" | "online" | "hybrid" | null {
  if (theme && typeof theme === "object") {
    const be = (theme as Record<string, unknown>).business_event;
    if (be && typeof be === "object") {
      const v = (be as Record<string, unknown>).format;
      if (v === "in_person" || v === "online" || v === "hybrid") return v;
    }
  }
  return null;
}

function deriveSharedFormat(
  themeFormat: "in_person" | "online" | "hybrid" | null,
  isOnline: boolean,
): "in-person" | "online" | "hybrid" {
  if (themeFormat === "in_person") return "in-person";
  if (themeFormat === "online") return "online";
  if (themeFormat === "hybrid") return "hybrid";
  return isOnline ? "online" : "in-person";
}
```

**Modify the `BusinessEventCard` builder** at lines ~405–435 (`.map((row: RawRow): BusinessEventCard => {...})`):

Replace:
```ts
venueName: null, // venueName lives in theme.business_event.venueName per draft store; left null for v1 — flagged in report
city: row.city ?? null,
address: hide ? null : (row.location_text ?? null),
hideAddressUntilTicket: hide,
```

With:
```ts
// ORCH-0846: parity with brand-side publicEventsService.toPublicEventBySlug —
// resolve venueName from theme.business_event.venueName, falling back to
// location_text. The shared PublicEventPage gates the venue card on
// venueName !== null; without this fallback the card would never render.
venueName: extractVenueName(row.theme) ?? row.location_text ?? null,
city: row.city ?? null,
// ORCH-0846: pass address unconditionally and let the shared component
// gate visibility via hideAddressUntilTicket (matches brand-side mechanism
// at publicEventsService.ts:378 and PublicEventPage.tsx:380-384).
address: row.location_text ?? null,
hideAddressUntilTicket: hide,
format: deriveSharedFormat(extractBusinessEventFormat(row.theme), row.is_online === true),
```

**No SELECT change required** — `theme`, `location_text`, and `is_online` are already in the SELECT block at lines 322–333.

**No new dependency, no new edge function, no `verify_jwt` change** — this is a pure logic edit.

### 4.B — Type contract: `app-mobile/src/types/mergedDiscover.ts`

Add one field to the `BusinessEventCard` interface (after `hideAddressUntilTicket`):

```ts
/**
 * ORCH-0846: shared-component format string for @mingla/event-rendering
 * PublicEventPage. Resolved from theme.business_event.format with
 * is_online fallback (see discover-merged-events/index.ts:deriveSharedFormat).
 */
format: "in-person" | "online" | "hybrid";
```

No other field changes. `venueName`, `address`, `hideAddressUntilTicket` already typed correctly.

### 4.C — Consumer mapping: `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

Replace line 81 (currently `format: "in-person"`) with:

```ts
format: card.format,
```

Lines 96–98 (`venueName`, `address`, `hideAddressUntilTicket`) are unchanged — they already forward straight through from the card.

### 4.D — Strict-grep CI gate (new)

Per `feedback_strict_grep_registry_pattern.md` — one new script + one new job, no parallel workflow file.

**New file:** `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs`

Asserts (each is a single grep + count assertion):

1. The literal string `venueName: null` does NOT appear in `supabase/functions/discover-merged-events/index.ts`. (Negative-control: must FAIL when reverted to current state.)
2. The literal string `format: "in-person"` does NOT appear in `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (only the helper `deriveSharedFormat`'s string-literal returns are permitted, which live in the edge function — different file).
3. The literal `extractVenueName` is referenced at least once in `supabase/functions/discover-merged-events/index.ts`.
4. The literal `deriveSharedFormat` is referenced at least once in `supabase/functions/discover-merged-events/index.ts`.
5. `BusinessEventCard` in `app-mobile/src/types/mergedDiscover.ts` contains a `format:` field declaration.

**Workflow registration:** add one job entry to `.github/workflows/strict-grep-mingla-business.yml` mirroring the existing ORCH-0809 / ORCH-0805 / ORCH-0806 job blocks.

### 4.E — Tests

#### 4.E.1 — Deno unit test (implementor-written happy-path regression)

**New file:** `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts`

Pure-function tests against the new helpers (export them from `index.ts` or extract to a small `_helpers.ts` if the implementor prefers — implementor's call, but the public surface must be testable). Minimum cases:

| Test | Input | Expected |
|------|-------|----------|
| V-01 | `theme.business_event.venueName = "Velvet Underground"`, `location_text = "123 Main St"` | `extractVenueName` returns `"Velvet Underground"`; full-builder returns `venueName: "Velvet Underground"` |
| V-02 | `theme.business_event.venueName = null`, `location_text = "123 Main St"` | `extractVenueName` returns `null`; full-builder returns `venueName: "123 Main St"` |
| V-03 | `theme.business_event.venueName = null`, `location_text = null` | full-builder returns `venueName: null` (shared component hides venue card — preserved behavior) |
| V-04 | `theme.business_event.venueName = "   "` (whitespace only) | `extractVenueName` returns `null` (trim guard) |
| F-01 | `theme.business_event.format = "in_person"`, `is_online = false` | `deriveSharedFormat` returns `"in-person"` |
| F-02 | `theme.business_event.format = "online"`, `is_online = true` | returns `"online"` |
| F-03 | `theme.business_event.format = "hybrid"`, `is_online = false` | returns `"hybrid"` |
| F-04 | `theme.business_event.format = null`, `is_online = true` | returns `"online"` (is_online fallback) |
| F-05 | `theme.business_event.format = null`, `is_online = false` | returns `"in-person"` (is_online fallback) |
| F-06 | `theme.business_event.format = "garbage"`, `is_online = true` | returns `"online"` (rejects unknown literal, fallback) |
| A-01 | `hide = true`, `location_text = "123 Main St"` | full-builder returns `address: "123 Main St"`, `hideAddressUntilTicket: true` (UI gates rendering) |
| A-02 | `hide = false`, `location_text = "123 Main St"` | full-builder returns `address: "123 Main St"`, `hideAddressUntilTicket: false` |
| A-03 | `hide = false`, `location_text = null` | full-builder returns `address: null` |

**Mandatory `fails-on-revert` proof per CLOSE Step 0.5:** implementor must capture, in the implementation report, a run log showing every V/F/A test FAILS when the production code is reverted to the current `venueName: null` hardcode, and PASSES when restored. This proves the tests exercise the bug (not a hollow assertion that passes either way).

#### 4.E.2 — RN regression test (consumer mapping)

**New file:** `app-mobile/src/components/expandedCard/__tests__/expandedBusinessEventSheet_address_parity.test.ts` (pure-function test on `mapCardToPublicEvent` — extract it to a named export from `ExpandedBusinessEventSheet.tsx` if currently a module-private const; that is acceptable).

| Test | Card input | Assert on returned `PublicEventProps` |
|------|------------|---------------------------------------|
| M-01 | `venueName: "Velvet Underground"`, `address: "123 Main St"`, `hideAddressUntilTicket: false`, `format: "in-person"` | `venueName === "Velvet Underground"`, `address === "123 Main St"`, `hideAddressUntilTicket === false`, `format === "in-person"` |
| M-02 | `venueName: null`, `address: "123 Main St"`, `hideAddressUntilTicket: false`, `format: "in-person"` | `venueName === null`, `address === "123 Main St"` (note: when card.venueName is null we DO NOT fall back at the consumer layer — the edge function is the single source of fallback, per §4.A) |
| M-03 | `format: "online"` | `format === "online"` (NOT hardcoded "in-person") |
| M-04 | `format: "hybrid"` | `format === "hybrid"` |

Implementor must also capture fails-on-revert for M-03 (revert line 81 to `format: "in-person"`; assert M-03 FAILS; restore; assert PASSES).

#### 4.E.3 — Tester-written adversarial regression (per CLOSE Step 0.5)

Tester writes a SEPARATE adversarial test at a different angle:
- **Adversarial vector:** edge-function builder receives a row where `theme.business_event.venueName` is the literal string `"null"` (string, not the JSON null) — common when client-side serialization mishandles a clear-the-field UX. Test must assert the helper does NOT treat `"null"` as null and DOES pass it through as a venue name (or, if product wants the opposite, defines the contract). Default expectation: `"null"` is treated as a valid venue name string (no special-casing of literal strings). Document the chosen contract in the QA report.
- **Adversarial vector 2 (tester's choice):** at least one more edge case the tester picks — suggestions: very long `location_text` (1000+ chars), unicode venue name with emoji + RTL chars, `theme` itself missing entirely (cold-cache race).

The adversarial test lives at a tester-chosen path (recommended `supabase/functions/discover-merged-events/__tests__/venue_name_adversarial.test.ts`).

### 4.F — Invariant registration

Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md`:

```
| I-PROPOSED-CONSUMER-EVENT-ADDRESS-PARITY | Every consumer-side payload builder producing a card consumed by the shared @mingla/event-rendering PublicEventPage MUST resolve venueName, address, format, hideAddressUntilTicket identically to mingla-business publicEventsService.toPublicEventBySlug for the same events row. | DRAFT — flips ACTIVE on ORCH-0846 close | Strict-grep gate `.github/scripts/strict-grep/orch-0846-consumer-event-address-parity.mjs` + Deno test suite + RN regression test |
```

Orchestrator flips DRAFT→ACTIVE on close, not the implementor.

---

## 5. Success criteria (numbered, observable, testable)

- **SC-01** — Open the consumer app (`app-mobile`) on Discover, find any live business event whose `location_text` is non-null and whose `hideAddressUntilTicket` is `false`. Tap into the sheet. The venue card under the cover renders with venue name (or address fallback) + address line. Visually identical to the brand-side `/e/{brandSlug}/{eventSlug}` for the same event.
- **SC-02** — Same flow, but with `hideAddressUntilTicket=true`. Venue card renders with venue title + "Address shared after ticket purchase" line. Visually identical to brand-side.
- **SC-03** — For an online-only event (`is_online=true`, `theme.business_event.format="online"`), the consumer sheet renders the online card at `PublicEventPage.tsx:391` (round icon, "Online" title), NOT the venue card. Visually identical to brand-side.
- **SC-04** — For a hybrid event, the venue card renders with address line "{address} · also online". Visually identical to brand-side.
- **SC-05** — Deno test suite at `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts` passes all V/F/A cases AND each FAILS when the production code is reverted to the current `venueName: null` hardcode (fails-on-revert proof captured in implementation report).
- **SC-06** — RN regression test passes all M cases AND M-03 fails-on-revert when `format` is reverted to the hardcoded `"in-person"`.
- **SC-07** — Strict-grep gate `orch-0846-consumer-event-address-parity` is GREEN on CI AND demonstrates negative-control (each of the 5 grep assertions individually flips RED when its respective product code is reverted; proof captured in implementation report).
- **SC-08** — Cross-domain blast verified zero: `mingla-business` brand public page renders unchanged for the same set of events (no regression on the baseline); `mingla-admin` unaffected; checkout flow unaffected.
- **SC-09** — `tsc --noEmit` clean across `app-mobile/` and `mingla-business/` after the change.
- **SC-10** — No DB migration, no new edge function, no native module change. EAS OTA-eligible for `app-mobile/`.

---

## 6. Invariants this change must preserve

| Invariant | How preserved |
|-----------|---------------|
| I-PROPOSED-AX EVENT_HAS_MASTER_DATE | Untouched — query construction and master-date floor unchanged. |
| ORCH-0845 ended-events floor | Untouched — `.gte("event_dates.end_at", lowerBoundUtc)` and `event_dates!inner` predicates unchanged. |
| Constitution #3 No silent failures | Strengthened — venue data that was being silently dropped is now surfaced. |
| Constitution #9 No fabricated data | Preserved — fallback chain uses real DB column (`location_text`), no invented strings. |
| META-ORCH-0827 Pass 2 Step 10 parity contract | Restored. |
| `hideAddressUntilTicket` default = true privacy contract | Untouched — `extractHideAddressUntilTicket` already defaults to `true`. |

---

## 7. Implementation order

1. Helpers + builder edit in `supabase/functions/discover-merged-events/index.ts` (§4.A).
2. Type field in `app-mobile/src/types/mergedDiscover.ts` (§4.B).
3. Consumer mapping in `ExpandedBusinessEventSheet.tsx` (§4.C).
4. Deno test (§4.E.1) + fails-on-revert proof captured in implementation report.
5. RN regression test (§4.E.2) + fails-on-revert proof captured in implementation report.
6. Strict-grep gate (§4.D) + workflow job registration + negative-control proof captured.
7. `tsc --noEmit` and Deno test runs from the implementor's machine, logged in the implementation report.
8. Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`.

No `supabase db push`. No `supabase functions deploy` — orchestrator owns the deploy per `feedback_orchestrator_deploys_edge_functions.md`. No `eas update` — orchestrator owns OTAs on CLOSE.

---

## 8. Regression prevention

- **Structural safeguard:** strict-grep gate (§4.D) prevents future regression of `venueName: null` hardcoded in any discover/event payload builder.
- **Type safeguard:** `BusinessEventCard.format` is now a non-optional discriminated union; consumers cannot silently default it.
- **Test safeguard:** Deno + RN tests with fails-on-revert proofs lock in the contract.
- **Invariant safeguard:** new `I-PROPOSED-CONSUMER-EVENT-ADDRESS-PARITY` (registered DRAFT at §4.F, flips ACTIVE on close) is the prose contract future investigators read first.

---

## 9. Tester directives (canonical TEST owner: Claude `mingla-tester` per `feedback_tester_canonical_and_platform_parity.md`)

Tester MUST verify across iOS Simulator + Android Emulator + brand-side web page (the parity baseline). Tester writes the §4.E.3 adversarial regression test (separate angle from implementor's happy-path) and captures its fails-on-revert proof.

Tester runs the SQL probe in §10.D against the live database (via Management API per `feedback_supabase_mcp_workaround.md`) to quantify the affected population, and includes the count in the QA report.

Tester MUST capture a before/after screenshot pair for SC-01 (the headline visible change), and verify SC-02 / SC-03 / SC-04 on at least one event each — if production has no live online or hybrid event, tester escalates the data-availability gap to the operator per `feedback_tester_canonical_and_platform_parity.md` (ask-to-unblock, do not silently CONDITIONAL PASS).

---

## 10. Reference data + probes

### 10.A — Brand-side baseline code (do not modify)

`mingla-business/src/services/publicEventsService.ts:188–193,337–384` — the resolution helpers (`asFormat`) and the `toPublicEventBySlug` return object.

### 10.B — Shared component render gate

`packages/event-rendering/PublicEventPage.tsx:373` — `event.format !== "online" && event.venueName !== null`. This is the gate the producer must satisfy.

### 10.C — Publish RPC writes (confirms data shape)

`supabase/migrations/20260604000001_orch_0824_publish_rpc.sql:358–369` — `theme = (v_theme - 'business_draft') || jsonb_build_object('business_event', v_business_draft - 'tickets' - 'category' - 'partyTypes' - 'vibeTags' - 'musicGenres' - 'city' - 'locationGeo' ...)`. So `theme.business_event.venueName` is whatever `v_business_draft.venueName` was at publish time. Confirms top-level (NOT under `.location`).

### 10.D — Affected-population SQL probe (tester runs at TEST phase)

```sql
SELECT
  COUNT(*) AS total_live_business_events,
  COUNT(*) FILTER (WHERE location_text IS NOT NULL) AS with_location_text,
  COUNT(*) FILTER (WHERE theme->'business_event'->>'venueName' IS NOT NULL) AS with_theme_venue_name,
  COUNT(*) FILTER (
    WHERE location_text IS NOT NULL
      AND (theme->'business_event'->>'hideAddressUntilTicket')::boolean IS DISTINCT FROM TRUE
  ) AS publicly_addressable
FROM public.events
WHERE deleted_at IS NULL
  AND visibility = 'public'
  AND status IN ('scheduled', 'live');
```

The `publicly_addressable` count is the population whose buyer-facing address is missing on the consumer app today.

---

## 11. Hard guards (binding on implementor + tester)

- No DB migration. No `supabase db push`. No edge-function deploy. No `eas update`. Operator + orchestrator own all of those.
- No scope expansion beyond the three fields named in §1. No venue-card UI redesign, no map embed, no copy-to-clipboard, no Maps deep-link.
- No `events` column-name invention — every reference to `events.*` is verified against `supabase/migrations/` CREATE TABLE / ALTER TABLE before commit, per `feedback_verify_db_column_names_before_writing_queries.md`.
- No deletion of the existing `extractCoverHue` or `extractHideAddressUntilTicket` helpers — extend, do not replace.
- No change to `hideAddressUntilTicket` default (still `true`).
- DIAG markers: any `[ORCH-0846-DIAG]` console.log used during implementation must be reaped before close per orchestrator Step 1.5.
- Co-Authored-By line is FORBIDDEN in commit messages per `feedback_no_coauthored_by.md`.

---

## 12. Definition of done

All SC-01..SC-10 pass. Tester PASS or CONDITIONAL PASS (with operator acceptance of any P2/P3 deferrals). Orchestrator runs CLOSE protocol Steps 0.5 → 5 (no decommission extension needed — no system retired). Invariant `I-PROPOSED-CONSUMER-EVENT-ADDRESS-PARITY` flips DRAFT → ACTIVE. Memory `feedback_consumer_event_address_parity.md` written if any future-relevant judgment emerges from the close.
