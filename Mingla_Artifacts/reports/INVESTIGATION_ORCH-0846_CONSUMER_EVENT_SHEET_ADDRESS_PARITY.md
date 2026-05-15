# INVESTIGATION — ORCH-0846 [Consumer event sheet missing venue/address — parity with public event page]

**Mode:** INVESTIGATE.
**Surface:** `app-mobile/` Discover → `ExpandedBusinessEventSheet` rendering of a Mingla Business event.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Confidence:** root cause **probable** (code-asymmetry is conclusive; simulator visual repro deferred to TEST phase per dispatch §3 — see §10 Confidence note).

---

## 1. Symptom (expected vs actual)

| Surface | Expected | Actual |
|---|---|---|
| Brand-side public buyer page (`mingla-business` route `/e/{brandSlug}/{eventSlug}`) | Venue card under cover renders venue title + address line when `hideAddressUntilTicket=false`; renders "Address shared after ticket purchase" line when `hideAddressUntilTicket=true` | Works as expected. Baseline. |
| Consumer app (`app-mobile`) Discover → tap business card → `ExpandedBusinessEventSheet` | Same venue card with same content (parity contract from META-ORCH-0827 [Platform structure consolidation — Pass 2 Step 10]: consumer renders the EXACT same shared `@mingla/event-rendering` `PublicEventPage`) | Venue card is **absent entirely**. No venue name, no address line, no "Address shared after ticket purchase" line — the whole `<View style={styles.venueCard}>` block is skipped. |

User-facing impact: a buyer browsing Discover on the consumer app cannot see WHERE an event is happening, even when the brand opted into public-address sharing. To see the address, the buyer would have to leave the app, open `https://mingla.business/e/...`, and read it from the web. That's the parity break.

---

## 2. Phase 0 — Ingest (read this turn)

1. `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md` — dispatch contract.
2. `Mingla_Artifacts/WORLD_MAP.md` — confirmed ORCH-0846 is a new ID; latest closes ORCH-0826 [Hub Foundation + universal-plus creator], ORCH-0843 [charge-shape reconciliation], ORCH-0844 [Explorer PaymentSheet connect_account_id]; open investigation ORCH-0845 [Discover excludes ended events] is the most recent edit to the same edge function (`discover-merged-events`) — relevant because ORCH-0845's SPEC will touch the same file; coordinate with that workstream.
3. `packages/event-rendering/PublicEventPage.tsx` lines 21–24, 370–400, 863–895.
4. `packages/event-rendering/types.ts` — `PublicEventProps` shape (`venueName: string | null`, `address: string | null`, `format: EventFormat = "in-person" | "online" | "hybrid"`, `hideAddressUntilTicket: boolean`).
5. `mingla-business/src/services/publicEventsService.ts` lines 188–193, 337–384 (brand-side resolution).
6. `mingla-business/src/components/event/PublicEventPage.tsx` lines 110–130 (brand-side wrapper that maps `DraftEventFormat "in_person"` to shared `EventFormat "in-person"`).
7. `supabase/functions/discover-merged-events/index.ts` lines 160–200 (`extractCoverHue`, `extractHideAddressUntilTicket`), 300–340 (SELECT block — `theme` and `location_text` and `is_online` are all already selected), 380–440 (`BusinessEventCard` builder; line 422 hardcodes `venueName: null`, line 424 gates `address` on `hide`).
8. `app-mobile/src/types/mergedDiscover.ts` lines 37–41 (`BusinessEventCard` carries `venueName: string | null`, `address: string | null`, `hideAddressUntilTicket: boolean`).
9. `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` lines 75–115 (`mapCardToPublicEvent` — line 81 hardcodes `format: "in-person"`, lines 96–98 forward `venueName` / `address` / `hideAddressUntilTicket` straight through from the card).
10. `mingla-business/src/store/draftEventStore.ts` lines 196–197, 268–269, 282–285, 379–380 — `venueName` and `address` are TOP-LEVEL fields of `BusinessEventDraft`, NOT nested under a `location` sub-object.
11. `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql` lines 358–369 (publish RPC writes the entire draft minus promoted columns into `theme.business_event`).
12. `supabase/migrations/20260525000003_orch_0792_events_with_master_date_view.sql` line 126 (the `events_public_with_master_date` view exposes `(e.theme - 'business_draft') AS public_theme` — same JSONB shape as `theme` minus the in-progress draft sub-blob; brand-side reads `public_theme`, discover edge function reads `theme` directly — equivalent for this field path).

Prior artifacts on the same area: ORCH-0824 [post-publish address re-pick RPC] touched `location_text` mutability but did not touch the consumer sheet mapping; ORCH-0792 [events_with_master_date view] established the `events_public_with_master_date` view; META-ORCH-0827 Pass 2 Step 10 established the shared-component parity contract that this bug breaks.

---

## 3. Investigation manifest (every file read, in trace order)

| Order | File | Why read |
|---|---|---|
| 1 | `packages/event-rendering/PublicEventPage.tsx` | Confirm the venue-card render condition |
| 2 | `packages/event-rendering/types.ts` | Confirm the `PublicEventProps` contract |
| 3 | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` | What the consumer side passes IN to the shared component |
| 4 | `app-mobile/src/types/mergedDiscover.ts` | What shape the discover edge function produces |
| 5 | `supabase/functions/discover-merged-events/index.ts` | Where the consumer-side payload is built |
| 6 | `mingla-business/src/services/publicEventsService.ts` | Brand-side baseline — how venueName / address are actually resolved when the brand page works |
| 7 | `mingla-business/src/components/event/PublicEventPage.tsx` | Brand-side wrapper that hands the resolved record to the shared component |
| 8 | `mingla-business/src/store/draftEventStore.ts` | The shape of the data the publish RPC writes into `theme.business_event` |
| 9 | `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql` | The latest publish RPC — confirms where `venueName` / `address` land in JSONB |
| 10 | `supabase/migrations/20260525000003_orch_0792_events_with_master_date_view.sql` | Confirms `public_theme = theme - 'business_draft'` (identical shape for this path) |

---

## 4. Findings

### 🔴 ROOT CAUSE — `discover-merged-events/index.ts:422` hardcodes `venueName: null`, which forces the shared `PublicEventPage`'s venue-card render condition `event.venueName !== null` to false on every business event in Discover, dropping the entire venue card (and therefore the address line, and the "Address shared after ticket purchase" line) from the consumer sheet.

| Field | Evidence |
|---|---|
| **File + line** | `supabase/functions/discover-merged-events/index.ts:422` |
| **Exact code** | `venueName: null, // venueName lives in theme.business_event.venueName per draft store; left null for v1 — flagged in report` |
| **What it does** | Sets `BusinessEventCard.venueName` to `null` on every row, regardless of what `events.location_text` or `theme.business_event.venueName` actually contain. The card is propagated through `ExpandedBusinessEventSheet.mapCardToPublicEvent` (line 96 — `venueName: card.venueName`) into the shared `PublicEventPage`'s `event.venueName` prop. |
| **What it should do** | Mirror the brand-side resolution at `publicEventsService.ts:377`: `venueName: asStringOrNull(theme.business_event.venueName) ?? row.location_text`. With this fallback, any event that has a non-null `location_text` (which is every published business event post-ORCH-0824, because the publish RPC requires `city` + `location_geo`, and the typical creator wizard pairs them with `location_text`) receives a non-null `venueName`, allowing the venue card to render. |
| **Causal chain** | (a) Discover edge function builds `BusinessEventCard` with `venueName: null` (line 422). (b) Function returns rows to `app-mobile`. (c) User taps a business card on Discover; `ExpandedBusinessEventSheet` opens. (d) `mapCardToPublicEvent` forwards `card.venueName` (null) to `event.venueName` of the shared component. (e) Inside `packages/event-rendering/PublicEventPage.tsx:373`, the render gate `event.format !== "online" && event.venueName !== null` evaluates `null !== null === false`, so the entire `<View style={styles.venueCard}>` block at lines 374–390 is skipped. (f) The hybrid/online fallback at line 391 (`else if event.format === "online"`) is also skipped because the consumer mapping hardcodes `format: "in-person"` at `ExpandedBusinessEventSheet.tsx:81`. (g) Net result: no venue card renders at all, regardless of any `hideAddressUntilTicket` value. User sees no address. |
| **Verification step** | (i) Pick a live business event in Supabase whose `location_text` is non-null and whose `theme->'business_event'->>'hideAddressUntilTicket'` is `'false'` (via the Management API workaround per `feedback_supabase_mcp_workaround.md`). (ii) Hit `https://mingla.business/e/{brandSlug}/{eventSlug}` — venue card visible with venue title + address. (iii) Open the same event on `app-mobile` via Discover — venue card absent. (iv) Local code-asymmetry proof is conclusive: brand-side passes `venueName = location_text` (fallback), consumer-side hardcodes `venueName = null`; the shared component branches on `venueName !== null`; the gap is mathematically certain. |

### 🟠 CONTRIBUTING FACTOR — `ExpandedBusinessEventSheet.tsx:81` hardcodes `format: "in-person"`.

Even after the root-cause fix above, the consumer sheet would still misrepresent online and hybrid events: an online-only event would render with an "in-person" venue card instead of the online card at `PublicEventPage.tsx:391`, and a hybrid event would lose the "· also online" suffix at line 383. The discover edge function already selects `is_online` and `theme` (line 327 of `index.ts`), so the data is available — the consumer mapping just does not use it. The brand-side equivalent (`publicEventsService.ts:360`) resolves format via `asFormat(businessEvent.format, row.is_online)`. The consumer side must mirror this.

### 🟡 HIDDEN FLAW — `address` is gated on `hide` in the discover edge function (line 424) but the shared `PublicEventPage` already does its own hide-gating at lines 380–384.

Brand-side `publicEventsService.ts:378` passes `address` unconditionally (`asStringOrNull(location.address) ?? row.location_text`) and lets the shared component decide what to render based on `hideAddressUntilTicket`. The discover edge function instead pre-nulls `address` when `hide=true`. In practice the rendered output is identical (when `hide=true`, the shared component shows "Address shared after ticket purchase" regardless of the `address` value), but the mechanism is divergent. Two different code paths for the same UI outcome is exactly the parity drift META-ORCH-0827 was meant to eliminate. The SPEC must collapse this to one mechanism (always pass `location_text`, let UI gate). Not user-visible today, will surface the moment a future PR changes the gate logic on one side and not the other.

### 🟡 HIDDEN FLAW — `BusinessEventCard.venueName` shape contract is silently lying.

`app-mobile/src/types/mergedDiscover.ts:37` types `venueName` as `string | null`, but the producer (`discover-merged-events/index.ts:422`) makes it deterministically `null`. There is no runtime contract that the `string` branch is ever produced. Consumers that special-case "venueName is null → hide UI" (which is exactly what the shared `PublicEventPage` does) are not bugs per se but are operating on a degenerate type. After the fix, this becomes a real `string | null` and consumers behave correctly. No code action needed beyond the root-cause fix, but worth noting because it explains why the bug went unnoticed in code review (the type lied softly).

### 🔵 OBSERVATION — Same edge function is also being modified by ORCH-0845 [Discover excludes ended events].

ORCH-0845 SPEC will switch `event_dates!left` to `event_dates!inner` and rely on the existing `.gte("event_dates.end_at", lowerBoundUtc)` floor. The ORCH-0846 fix touches a different region of the same file (the `BusinessEventCard` builder block, not the query construction or floor predicate) and there is no logical interaction between the two changes. Coordinate merge order with the orchestrator: whichever lands first, the other rebases on `Seth`.

### 🔵 OBSERVATION — `events.format` column does not exist.

The schema has only `events.is_online` (boolean). `format` is derived from `theme.business_event.format` (one of `"in_person" | "online" | "hybrid"` per draft store) with `is_online` as fallback. The contributing-factor fix must do the same derivation and convert the draft-store underscore (`"in_person"`) to the shared-component hyphen (`"in-person"`), matching `mingla-business/src/components/event/PublicEventPage.tsx:117–122`.

---

## 5. Five-truth-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | META-ORCH-0827 Pass 2 Step 10 (consumer renders shared `PublicEventPage`) and the `@mingla/event-rendering` package design declare parity. Reality: parity is broken on `venueName` + `format`. |
| **Schema** | `events` has `location_text` (text, nullable), `location_geo` (geography, nullable post-ORCH-0824 publish), `is_online` (boolean), and `theme` (jsonb). There is NO `venueName` column on `events` — venue name lives only at `theme->'business_event'->>'venueName'` (top-level of business_event, NOT under a `.location` sub-object — confirmed by reading `draftEventStore.ts:196,268,379` and the publish RPC at `20260604000001_orch_0824_publish_rpc.sql:358–369`). |
| **Code** | Brand side resolves `venueName: theme.business_event.venueName ?? row.location_text`. Consumer side hardcodes `venueName: null`. Code paths disagree. |
| **Runtime** | The shared `PublicEventPage` branches on `venueName !== null` for the venue card render. With `null` input, the whole card is skipped. Mathematically certain from the code; awaits live-sim visual confirmation per §10 confidence note. |
| **Data** | Live business events in production have `location_text` populated (post-ORCH-0824 publish requires `city` + `location_geo`, and the wizard always pairs them with a `location_text` string). `theme.business_event.venueName` may be null on rows where the operator didn't enter a separate venue name — in that case the brand side still renders the venue card because it falls back to `location_text`; the consumer side hides the card entirely. **Quantification deferred to TEST phase live probe.** Recommended SQL probe (run by tester before PASS): `select count(*) filter (where theme->'business_event'->>'venueName' is null) as venue_null, count(*) filter (where location_text is not null) as loc_present, count(*) total from events where deleted_at is null and visibility='public' and status in ('scheduled','live');` |

Layers Docs and Code disagree → that is the bug.

---

## 6. Blast radius

| Surface | Affected? | How |
|---|---|---|
| `app-mobile` Discover → `ExpandedBusinessEventSheet` | **Yes — primary** | Venue card missing on every business event. |
| `app-mobile` other consumers of `BusinessEventCard` | Audit | grep below confirms `ExpandedBusinessEventSheet` is the only sheet that maps `BusinessEventCard` into the shared `PublicEventPage`. Discover list-card previews use a different reduced card shape (title + cover + date + price) and do not render an address — out of scope. |
| `mingla-business` brand-side public page | No | Resolves correctly via `publicEventsService`. Baseline. |
| `mingla-business` checkout page (`/checkout/[eventId]`) | No | Uses `usePublicEventBySlug` → same resolution. |
| `mingla-admin` | No | Does not render the shared `PublicEventPage`. |

Grep evidence (run this turn): `grep -rn "venueName\|address" app-mobile/src/components/expandedCard/` → only `ExpandedBusinessEventSheet.tsx:96–97` hits.

---

## 7. Invariant / constitutional impact

- **META-ORCH-0827 Pass 2 Step 10 parity contract** — violated. Consumer sheet must render the SAME content as the brand public page. Currently does not.
- **Constitution #9 No fabricated data** — borderline. The consumer sheet does not fabricate data; it omits it. Closer to a silent failure (Constitution #3) — the user has no way to know the venue exists for this event; from their perspective the field simply does not exist.
- **Constitution #3 No silent failures** — light violation. The data is there in the DB and is being SELECTed by the edge function, but the producer drops it silently.
- **New invariant proposal:** `I-PROPOSED-CONSUMER-EVENT-ADDRESS-PARITY` — every consumer-side payload builder that produces a card consumed by the shared `@mingla/event-rendering` `PublicEventPage` MUST resolve `venueName`, `address`, `format`, `hideAddressUntilTicket` using the SAME helpers (or moral equivalent) as the brand-side `publicEventsService.toPublicEventBySlug`. Backed by a strict-grep CI gate that forbids the literal `venueName: null` (with `// left null` or `// v1` comment heuristics) in any function under `supabase/functions/discover-*/` or `supabase/functions/*event*/`. (DRAFT — flips ACTIVE on CLOSE.)

---

## 8. Fix strategy (direction only — SPEC owns the contract)

1. In `supabase/functions/discover-merged-events/index.ts`:
   - Add helpers `extractVenueName(theme: unknown): string | null` and `extractFormatHint(theme: unknown): "in_person" | "online" | "hybrid" | null` mirroring `extractHideAddressUntilTicket` / `extractCoverHue` shape already in the file.
   - In the `BusinessEventCard` builder (line 422 area), replace `venueName: null` with `venueName: extractVenueName(row.theme) ?? row.location_text ?? null`.
   - Replace `address: hide ? null : (row.location_text ?? null)` with `address: row.location_text ?? null` (let UI gate, matching brand side).
   - Add `format: deriveFormat(extractFormatHint(row.theme), row.is_online)` (returns `"in-person" | "online" | "hybrid"` for the shared-component contract). The helper converts `"in_person"` → `"in-person"`.

2. In `app-mobile/src/types/mergedDiscover.ts`:
   - Add `format: "in-person" | "online" | "hybrid"` to `BusinessEventCard`.
   - (`venueName`, `address`, `hideAddressUntilTicket` are already present — no shape change.)

3. In `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`:
   - Replace `format: "in-person"` (line 81) with `format: card.format`.

4. CI gate: new strict-grep job per `feedback_strict_grep_registry_pattern.md` — forbids `venueName: null` in `supabase/functions/discover-*/index.ts` and `supabase/functions/*event*/index.ts`.

5. Tests:
   - Deno unit test under `supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts` for the three input shapes (theme has venueName / theme null + location_text / both null) and format derivation (3 × 3 matrix or pruned).
   - RN regression test under `app-mobile/src/components/expandedCard/__tests__/expandedBusinessEventSheet_address_parity.test.tsx` that mounts the sheet with three card shapes and asserts venue card content. Pure-function variant acceptable if mounting is hostile in jest.

Implementor does not invent column names — verify every `events.*` against `supabase/migrations/` CREATE TABLE / ALTER TABLE before writing. No `supabase db push`. No edge deploy until operator gate.

---

## 9. Discoveries for orchestrator

- ORCH-0846-A candidate: `ExpandedBusinessEventSheet.tsx:81` `format: "in-person"` hardcode is folded INTO this ORCH per §4 contributing factor — no separate ORCH needed.
- ORCH-0846-B candidate: the `BusinessEventCard.venueName` type lying as `string | null` while always producing `null` is a soft contract drift; after this fix it self-resolves. No ORCH needed.
- Coordinate merge order with ORCH-0845 [Discover excludes ended events] — same file, different region, no logical interaction; whichever lands first, the other rebases.
- Future hardening (NOT in scope): the venue card on the shared `PublicEventPage` currently uses `venueName !== null` as the gate; a future improvement would be to render the card whenever `address || venueName` is non-null. Out of scope here because the contract is bidirectional (both sides match the current shared component). File a future ORCH if the design team wants to revisit.

---

## 10. Confidence

**Probable** — code-asymmetry between the brand-side resolution and the consumer-side hardcode is mathematically certain (the shared component branches on `venueName !== null`; the consumer side guarantees `null`; the venue card cannot render). Six-field root-cause evidence is intact in §4. Live-fire iOS Simulator visual repro is **deferred to the TEST phase** per the dispatch's downstream-routing section §9 (`Claude mingla-tester` runs iOS Sim + Android Emulator + brand-buyer-page parity probe). The reason for deferral is that the bug is a code asymmetry conclusively provable from source; the value of running the sim in INVESTIGATE phase would be to capture a "before" screenshot, which the tester can also capture at PRE-IMPLEMENTATION baseline before verifying the fix. If the operator wants the sim repro before SPEC ships, the orchestrator can dispatch a one-shot screenshot probe — but it does not change the SPEC contract.

Per `feedback_always_simulator_repro_described_behaviour.md`, this is the honest confidence label. Source-only reasoning caps at `probable` for a UI bug; `proven` requires live-fire.

---

## 11. Output references

- **SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md` (this dispatch).
- **Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_ORCH-0846_CONSUMER_EVENT_SHEET_ADDRESS_PARITY.md`.
- **Related open:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0845_DISCOVER_ENDED_EVENTS_STILL_SHOWN.md` (same file, different region; coordinate merge).
