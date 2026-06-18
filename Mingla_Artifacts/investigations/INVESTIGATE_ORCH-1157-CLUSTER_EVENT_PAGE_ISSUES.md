# INVESTIGATE — ORCH-1157 CLUSTER: four event-page / wizard issues

**Skill:** mingla-forensics (INVESTIGATE mode)
**Date:** 2026-06-17
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1157-[rsvp-public-redesign]` on branch `ORCH-1157-rsvp-public-redesign`
**Project ref:** gqnoajqerqhnvulmnyvv
**Comms ledger:** read on entry — no OPEN `BLOCK` rows target this skill / ORCH-1157 / ALL. 22 OPEN `WARN` + 1 `FYI`; none touch the RSVP-page / address-hide / map-preview / doors topics. COMMS-0028 (env keys not inlined into standalone/OTA builds) factored into Issue 3 (it is NOT the cause here — see F-3).

> Source-only static reasoning + live DB introspection. No simulator repro was run this turn (read-and-DB investigation). Confidence labels are bound accordingly: schema/data facts are `proven` (live `pg_get_viewdef` + row reads); the UI render-path mechanisms are `probable` (traced verbatim through the exact components, but not yet eyeballed on a booted sim/device). No fix proposed.

---

## Symptom summary (expected vs actual)

| # | Issue | Expected | Actual (Seth, on device) |
|---|-------|----------|--------------------------|
| 1 | Consumer RSVP ≠ business/web structure | Consumer RSVP detail looks/structures like the business/web RSVP page | Consumer RSVP body is a different structure (it is the consumer *ticketed* body with the momentum unit swapped in — even renders a "Choose your ticket → No tickets available yet" block) |
| 2 | "Hide address until purchase" ignored | Exact street address hidden on the public page until purchase / RSVP | Full street address shown on the public RSVP page despite hide=ON (PRIVACY LEAK on live events) |
| 3 | Map preview broken in 4 wizards | Address → live map preview in the location step | Striped grey placeholder, no map, in all four wizards |
| 4 | Doors open / doors close not shown | "Doors open X · Doors close Y" beneath the date | Nothing shown — and the data does not exist |

---

## Investigation manifest (every file read, in trace order)

1. `/COMMS_LEDGER.md` — entry scan (no BLOCK; relevant WARN none).
2. `mingla-business/src/components/event/RsvpPublicBody.tsx` — the business/web RSVP body (Issue 1 baseline, Issue 2 leak).
3. `packages/event-rendering/PublicEventPage.tsx` — shared renderer (honors `hideAddressUntilTicket` — but is only mounted for cancelled/password variants; a red herring for the live page).
4. `mingla-business/src/components/event/PublicEventPage.tsx` — the business adapter; routes RSVP→`RsvpPublicBody`, standard→`FoundationEventPreview` (NOT the shared page).
5. `mingla-business/src/components/event/FoundationEventPreview.tsx` (grep) — standard ticketed body; honors `hideAddressUntilTicket` (lines 199-207).
6. `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` — the consumer detail; one shared body for standard + RSVP (Issue 1 + Issue 2 consumer path).
7. `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` + `src/hooks/usePublicEvents.ts` + `src/services/publicEventsService.ts` — anon data path; `publicEventViewRowToEvent` (lines 722-847) maps the view row.
8. `mingla-business/src/components/event/CreatorStep3Where.tsx` — the shared "Where" wizard step (hide toggle + map placeholder).
9. `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx` (grep) — reuses `CreatorStep3Where`.
10. `app-mobile/src/hooks/useConsumerEventFoundation.ts` + `ConnectionsPage.tsx` — consumer `hideAddressUntilTicket` source (`theme.business_event`).
11. Live DB: `events` columns, `event_dates` columns, `business_public_events_view` definition, live event/RSVP rows (Issues 2 & 4 schema + data).
12. Sub-agent forensics on the map preview (Issue 3) — confirmed shared placeholder.

---

## Five-Truth-Layer reconciliation (the load-bearing one)

The single fact that reframes Issues 2 and 4: **the `events` table has NO `hide_address_*` column and NO door-time columns.** Address + venue + the hide flag live INSIDE the `events.theme` JSONB under `theme.business_event.*`; date/time comes from `event_dates.start_at/end_at`. There is no doors concept anywhere.

| Layer | Issue 2 (hide address) | Issue 4 (doors) |
|-------|------------------------|-----------------|
| **Docs** | `PublicEventPage.tsx` header (lines 19-22) + `CreatorStep3Where` (lines 99-100) promise "address hidden until purchase". | No doc/spec mentions a doors-open/close field. |
| **Schema** | `events` has **no** `hide_address_*` column (`information_schema.columns` → only `venue_tax_address`, `location_text`, `location_geo`, `location_mode`, `city`). The flag lives at `events.theme->'business_event'->>'hideAddressUntilTicket'`. **proven.** | `events` has **no** `doors_*` / `door_time` column; `event_dates` has only `start_at`, `end_at`, `timezone`. **proven — doors NOT stored.** |
| **Code** | `RsvpPublicBody.tsx` never reads the flag (leak). `FoundationEventPreview`/consumer DO read it. The anon mapper defaults the flag to `true` (`publicEventsService.ts:775-778`). | `publicEventViewRowToEvent` sets `doorsOpen: startSplit.time` (line 753) — this is the event START time relabeled, NOT a separate door offset. No render surface shows it. |
| **Runtime** | (not sim-verified this turn) anon view returns `public_theme` incl. `business_event` → flag reachable. | n/a — nothing to render. |
| **Data** | Two LIVE RSVP rows carry `hideAddressUntilTicket=true` AND a full street address (see F-2 evidence). | No row has any door field. |

**Contradiction flagged (Issue 2):** Docs+Schema+wizard all say "hidden", but the RSVP render code (`RsvpPublicBody`) holds the opposite truth — it shows the address unconditionally. The render code is the bug; the host's intent (data) is correct.

---

## Q-scorecard

- **Q1 — Does the consumer RSVP render the same structure as business/web RSVP?**
  **Verdict: NO (`probable`).** Business/web mount the dedicated `RsvpPublicBody` (no ticket section, no "Where you'll be" ticket-language; momentum is the gravitational center; floating Going/Maybe/Can't dock). Consumer reuses the *ticketed* body (`ConsumerEventDetailScreen` lines 721-1033) and only swaps in `rsvpMomentumUnit` (line 822) + `rsvpDock` (line 1032) — it still renders a "Choose your ticket → No tickets available yet" block (lines 993-1028, ungated by `isRsvp`). See F-1.

- **Q2 — Is the address-hide flag respected on every public surface?**
  **Verdict: NO (`proven` schema/data + `probable` render).** Honored on standard ticketed (FoundationEventPreview) and consumer (both branches). NOT honored on the business/web **RSVP** page (`RsvpPublicBody`). Live RSVP rows have hide=true + a real street → leak. See F-2.

- **Q3 — Why is the wizard map preview broken in all four wizards?**
  **Verdict: NEVER IMPLEMENTED (`proven`).** All four wizards share `CreatorStep3Where`, whose "map preview" is a hardcoded striped `<View>` (lines 139-144). Not a token/URL/geocode/regression failure. See F-3.

- **Q4 — Are doors-open / doors-close times stored?**
  **Verdict: NO — NOT STORED (`proven`).** No column on `events` or `event_dates`; not in the wizard; not in the view. Displaying them requires a schema + wizard change first (Constitution rule 9). See F-4.

---

## Findings

### F-1 — Consumer RSVP renders the ticketed body, not the shared RSVP body (answers Q1) — SECONDARY ROOT CAUSE (structural divergence)

- **Symptom:** Consumer RSVP detail differs structurally from business/web RSVP; shows a ticket section that shouldn't exist on a no-money RSVP.
- **Layer:** code.
- **Probe:** read `ConsumerEventDetailScreen.tsx` lines 721-1033; compared to `RsvpPublicBody.tsx` whole file; grep `isRsvp`.
- **Evidence:**
  - Business/web RSVP body (`RsvpPublicBody.tsx`): brand chip → inline momentum (kicker+chips+count+meter+faceless cluster) → contact form → date fact → venue fact → About; NO ticket section anywhere; the Going/Maybe/Can't decision is a floating dock (phone) / sticky panel (desktop). Header explicitly: "NO ticket tiers, NO checkout, NO money."
  - Consumer (`ConsumerEventDetailScreen.tsx`): one body for both kinds — lead block (line 771) → meta chips (785) → `{isRsvp ? rsvpMomentumUnit : null}` (822) → brand chip (830) → About (894) → "Where you'll be" venue card (929) → **"Choose your ticket" section unconditionally (lines 993-1028)** → `{isRsvp ? rsvpDock : dockedReserve}` (1032). The ticket section is NOT gated by `isRsvp`, so an RSVP card shows "Choose your ticket / No tickets available yet."
- **Mechanism:** Consumer RSVP was retrofitted onto the existing ticketed `ConsumerEventDetailScreen` (swap the dock + insert a momentum unit) rather than rendering the shared `RsvpPublicBody`. Result: extra/wrong sections (ticket block), different section order, momentum placed after meta chips instead of as the hero, no contact-capture form, parallax/cover chrome differs (BaseBottomSheet + pinned cover vs `ParallaxCoverShell`).
- **Severity:** SECONDARY ROOT CAUSE (UX/structure parity, not a data leak).

**Recommendation (direction only — not a fix):** The cleanest path to true parity is for the consumer RSVP branch to render the SAME shared body the business/web use. Two viable shapes for the SPEC to choose between:
1. **Mount `RsvpPublicBody` directly on consumer** when `isRsvp` (early-return like the business adapter does at `PublicEventPage.tsx:539`). `RsvpPublicBody` already imports only from `@mingla/offering-rendering` + `@mingla/event-rendering` (shared packages), so it is consumable from `app-mobile`. The consumer would supply `onSubmit` via its existing `submitDeckRsvp`, `isLoggedIn`, and the cover/share callbacks. This maximizes parity (one body, all three surfaces) and removes the ticket-block bug for free.
2. If a full body swap is too invasive for ORCH-1157's remaining budget, at minimum (a) gate the "Choose your ticket" section with `!isRsvp`, (b) move the momentum unit to the hero position, (c) add the contact-capture form for logged-out users. This is a partial parity patch, not true parity.
- **Justified reason consumer *can't* share the body?** None found. `RsvpPublicBody` is package-clean and already mounted cross-surface (business native + web). The only consumer-specific concern is the sheet host (`BaseBottomSheet` + gorhom scroll) vs `ParallaxCoverShell` — but `RsvpPublicBody` already uses `ParallaxCoverShell` and the consumer ticketed path already proved the shared `PublicEventPage`/Foundation pattern renders inside the consumer sheet. **Decision needed (Open Q-A).**

### F-2 — `RsvpPublicBody` ignores `hideAddressUntilTicket`; the anon view exposes the address; live RSVP rows leak (answers Q2) — CONFIRMED ROOT CAUSE (privacy)

- **Symptom:** Full street address visible on the public RSVP page despite host setting "Hide address until purchase" = ON.
- **Layer:** code + data + schema.
- **Probe:** read `RsvpPublicBody.tsx:260-274`; `publicEventsService.ts:722-847`; `pg_get_viewdef('business_public_events_view')`; row read of live `scheduled/live` events.
- **Evidence:**
  - `RsvpPublicBody.tsx:263-270` (verbatim):
    ```
    const venueAddressLabel =
      event.format === "online"
        ? "Online event"
        : (event.address ?? event.venueName ?? "Location shared on RSVP");
    const venueMapsQuery =
      event.venueName === null
        ? null
        : [event.venueName, event.address].filter(Boolean).join(", ");
    ```
    No reference to `event.hideAddressUntilTicket` anywhere in the file (grep clean). The `Venue` sub-component (lines 612-656) renders `venueName` + `venueAddressLabel` directly and builds an "Open in maps" deep-link from the full address.
  - Contrast — `FoundationEventPreview.tsx:199-207` and `ConsumerEventDetailScreen.tsx:593-601` BOTH gate on `hideAddressUntilTicket` (replace address with "Address shared after ticket purchase", and null the maps query). So the leak is **RsvpPublicBody-only** = business app + buyer web RSVP page.
  - Anon view exposes it: `business_public_events_view` selects `e.theme - 'business_draft'::text AS public_theme` — it strips only `business_draft`, NOT `business_event`. So `public_theme.business_event.{address,venueName,hideAddressUntilTicket}` is returned to anonymous callers.
  - Mapper reads it back: `publicEventsService.ts:772-778`: `venueName = location.venueName ?? location_text`, `address = location.address ?? location_text`, `hideAddressUntilTicket = asBoolean(businessEvent.hideAddressUntilTicket, true)` (default true).
  - LIVE DATA (anon-readable rows, status scheduled/live):
    - "The Second Test" (`event_type=rsvp`): `hideAddressUntilTicket=true`, venueName="The Party Venue", **address="700 Corporate Center Drive, Raleigh, North Carolina 27607, United States"**.
    - "Test Rsvp" (`event_type=rsvp`): `hideAddressUntilTicket=true`, venueName="The Speakeasy Corporate Center", **address="700 Corporate Center Drive, Raleigh, North Carolina 27607, United States"**.
- **Mechanism:** Host sets hide=ON → flag persists in `theme.business_event` → anon view returns it → mapper sets `event.hideAddressUntilTicket=true` and `event.address=<full street>` → `RsvpPublicBody` renders `event.address` with no hide-gate → the exact street address (and an Open-in-maps deep link) is shown to any logged-out viewer of the share link.
- **Severity:** CONFIRMED ROOT CAUSE. **Real privacy leak on live RSVP events. Highest severity in the cluster.**
- **Standard-event surface:** Standard ticketed (FoundationEventPreview) and consumer correctly gate. For a hide=true standard event the venue NAME still shows (by design) and the street line becomes "Address shared after ticket purchase". If Seth saw the *street* on a standard event, the likely cause is one of: (a) the event's hide flag is actually `false` (most live standard rows in the data have `hide_flag="false"`), or (b) the host typed the street into the **Venue name** field, which is never hidden on any surface. Both are data/wizard issues, not a render bug on the standard path. **Open Q-B: needs the specific standard event Seth saw to confirm which.** As a render bug, the standard path is currently RULED OUT (gating present + correct).

**Recommendation (direction only):**
- RSVP page must gate the address exactly like FoundationEventPreview/consumer. For RSVP there is no "ticket purchase", so the semantics differ — **Open Q-C (steering needed):** what is the RSVP reveal rule? Options: (i) hide exact street until the guest is `going`+`approved` (reveal post-RSVP, mirrors ticket gate), showing only city/area + venue name until then; (ii) show venue name + city/area only, never the exact street on the public page (RSVP confirmation email/in-app carries the street); (iii) honor the same flag but treat "purchase" as "approved RSVP". The investigator recommends (i)/(iii) for symmetry with the ticketed gate, but Seth should decide.
- Independently, the SPEC should consider whether `venueName` should be address-sanitized (a host can defeat any hide by putting the street in the name field) — flag, not decide.

### F-3 — Wizard map preview is a hardcoded placeholder, never implemented (answers Q3) — CONFIRMED ROOT CAUSE

- **Symptom:** Striped grey box labeled "map preview", no map, in RSVP create, RSVP edit, standard create, standard edit.
- **Layer:** code.
- **Probe:** sub-agent forensics + direct read of `CreatorStep3Where.tsx`; git blame; grep `buildStaticMapUrl`, `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`.
- **Evidence:**
  - `CreatorStep3Where.tsx:139-144` (verbatim):
    ```
    {/* Map placeholder */}
    <View style={styles.mapWrap}>
      <View style={styles.mapStripes} />
      <View style={styles.mapPin} />
      <Text style={styles.mapHint}>map preview</Text>
    </View>
    ```
    Styles `mapWrap/mapStripes/mapPin/mapHint` (lines 272-303) are static dark `<View>`s — no `<Image>`, no Mapbox URL, no `draft.locationGeo` consumption. File header (lines 10-11): "Map preview is a solid striped placeholder. Real geocoding + Google Places autocomplete land in B-cycle." (the B-cycle work never happened for this step).
  - Shared by all four: imported in `EventCreatorWizard.tsx` (standard create), `EditPublishedScreen.tsx` (standard edit), `RsvpCreatorWizard.tsx` (RSVP create AND edit/resume) — all render the same component → all four fail identically.
  - NOT a token failure: token IS wired — `mingla-business/app.config.ts:251-252` emits `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` into `expoConfig.extra`; reader `getPublicMapboxToken()` exists at `mingla-business/src/utils/mapboxStaticImage.ts:24-31`. (Whether the env value is provisioned to a given build is a separate runtime question — but the step never even attempts a read, so the token is irrelevant to the symptom. COMMS-0028's "env not inlined in standalone" trap does not apply here.)
  - NOT a URL/coords failure: `buildStaticMapUrl()` (`mapboxStaticImage.ts:69-92`) is correct and already used by `TripPreview.tsx:628` and `ExperiencePreview.tsx:504`. Coords ARE captured — `CreatorStep3Where.tsx:85-90` writes `locationGeo: details.location` on pick — the placeholder just never consumes `draft.locationGeo`.
  - NOT a regression: git blame shows the placeholder unchanged since the component's first commit `fe640d54a` (2026-05-03).
- **Mechanism:** The real-map render was only ever built for trip + experience previews; the event/RSVP "Where" step shipped with a permanent placeholder. All four wizards share that step, so all four show no map.
- **Severity:** CONFIRMED ROOT CAUSE (missing feature, not a regression). Low risk to fix (a working `buildStaticMapUrl` + `<Image>` pattern exists and is proven on trip/experience).

**Recommendation (direction only):** Replace the placeholder block with the `TripPreview.tsx:627-644` pattern — `buildStaticMapUrl({ lat: draft.locationGeo?.lat, lng: draft.locationGeo?.lng, accentHex })` → `<Image>` when non-null; render nothing (rule 9) when coords/token absent. Because the component is shared, one change repairs all four wizards.

### F-4 — Doors-open / doors-close times are NOT stored anywhere (answers Q4) — DATA-DOES-NOT-EXIST (scope flag)

- **Symptom:** Seth wants "Doors open X · Doors close Y" beneath the date; nothing shows.
- **Layer:** schema + data.
- **Probe:** `information_schema.columns` on `events` and `event_dates`; `pg_get_viewdef('business_public_events_view')`; grep `door` across the worktree.
- **Evidence:**
  - `events` columns (full list): no `doors_*`, `door_time`, `open_at`, `close_at`. Only `booking_deadline`, `bookings_closed_at`, time-of-day lives in `event_dates`.
  - `event_dates` columns: `start_at, end_at, timezone, is_master, override_*` — no doors columns.
  - `business_public_events_view` exposes `master_start_at`/`master_end_at` only.
  - The only "doors" token in code is `publicEventViewRowToEvent` mapping `doorsOpen: startSplit.time` (publicEventsService.ts:753) — this is just the **event start time relabeled**, not a separate door offset, and it is not rendered as "doors" anywhere on the public page.
- **Mechanism:** There is no door-open/door-close concept in the schema, the wizard, or the view. Constitution rule 9 forbids displaying a fabricated/derived "doors" value as if real.
- **Severity:** DATA-DOES-NOT-EXIST. **Scope flag: Issue 4 cannot be a pure render change.** Showing real doors times requires (1) schema (new columns, e.g. `event_dates.doors_open_at` / `doors_close_at`, or an `events`-level doors offset), (2) the wizard's "When" step to capture them, (3) the anon view to expose them, (4) the mapper + types to carry them, THEN (5) the render beneath the date on all three surfaces. This is a feature, not a fix.

**Recommendation (direction only):** Either (a) build the full doors feature (schema → wizard → view → render) as its own ORCH, or (b) descope to displaying the existing event **start–end** time as "Starts X · Ends Y" beneath the date (real data already present in `master_start_at`/`master_end_at`) and defer true "doors" until a doors field exists. **Open Q-D (steering needed):** does Seth want true doors (new field + wizard capture) or is start/end acceptable for now?

---

## Repro evidence

No simulator/device repro run this turn (read + live-DB investigation). Issues 2 and 4 are `proven` at the schema/data layer via live `pg_get_viewdef` and row reads; the render mechanisms (Issues 1, 2, 3) are traced verbatim through the exact components and rated `probable`. A confirming sim repro (load an RSVP share link with hide=ON, observe the street) is recommended before/within IMPLEMENT but the data already proves the leak exists.

---

## Blast radius / cross-surface map

| Surface | Issue 1 | Issue 2 | Issue 3 | Issue 4 |
|---------|---------|---------|---------|---------|
| Consumer iOS/Android (`app-mobile`) | IN — divergent RSVP body (F-1) | OK — gates correctly (not a leak source) | n/a (consumer has no create wizard; map omitted by design OQ-5) | IN (render target, gated on data) |
| Buyer/anon Web (`mingla-business` `/e/...`) | n/a (uses RsvpPublicBody — already shared) | **IN — LEAK (F-2)** via RsvpPublicBody | n/a | IN (render target) |
| Business iOS/Android | n/a (RsvpPublicBody) | **IN — LEAK (F-2)** | IN — all 4 wizards (F-3, shared `CreatorStep3Where`) | IN (render + wizard capture if doors built) |
| Admin Web | not covered | not covered | not covered | not covered |
| Business Web preview | parity via shared body | inherits RsvpPublicBody leak | inherits wizard placeholder | inherits render |

Shared chokepoints: `CreatorStep3Where.tsx` (Issue 3, one fix → 4 wizards); `RsvpPublicBody.tsx` (Issues 1 + 2 for business/web); `ConsumerEventDetailScreen.tsx` (Issue 1 consumer).

---

## Invariant impact (flagged, not resolved)

- `I-PROPOSED-1157-RSVP-NO-CHECKOUT-AFFORDANCE` — a consumer-RSVP body-share (F-1 option 1) must not introduce any price/Reserve/cart affordance; if consumer mounts `RsvpPublicBody`, this is preserved by construction. The current consumer "Choose your ticket" block (F-1) arguably already brushes this invariant for RSVP cards — flag.
- `I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY` — preserved by either F-1 option.
- A NEW invariant should be proposed for F-2: "every public event-render surface (ticketed, experience, RSVP, all platforms) gates the exact address on `hideAddressUntilTicket`" — RsvpPublicBody currently violates it. Propose as `I-PROPOSED-1158-PUBLIC-ADDRESS-HIDE-ALL-SURFACES` (DRAFT) with a fails-on-revert grep test.
- Constitution rule 9 governs F-4 (no fabricated doors display).

---

## Discoveries for Orchestrator (side issues)

- D-1: Host can defeat any address-hide by typing the street into the **Venue name** field (never hidden on any surface). Possible standard-event explanation for Issue 2; worth a product decision on validating/sanitizing the venue-name field.
- D-2: `hideAddressUntilTicket` default in the anon mapper is `true` (publicEventsService.ts:776-778), but legacy rows / consumer card pipeline default `false` in several spots (`venueExperienceMapping.ts:151`, `SwipeableCards.tsx:182`). Inconsistent defaults across surfaces — flag for the address-hide ORCH to unify.
- D-3: The shared `PublicEventPage.tsx` (`packages/event-rendering`) honors the hide flag but is now only mounted for cancelled/password variants — its address logic is effectively dead on the live path. Not a bug, but a maintenance trap (future readers may "fix" the wrong file).

---

## Confidence level

- F-2 (RSVP address leak): **proven** at schema/data; **probable** at render (verbatim-traced, sim-repro pending). Net: high-confidence real leak.
- F-3 (map placeholder): **proven** (verbatim code + git blame + shared-import map).
- F-4 (doors not stored): **proven** (live schema + view introspection).
- F-1 (consumer RSVP structure): **probable** (verbatim-traced; not eyeballed on sim).

---

## SCOPING RECOMMENDATION

**Two ORCHs, sequenced.**

### Stays in ORCH-1157 (RSVP-public-redesign)
- **Issue 1 (consumer RSVP structure parity, F-1)** — directly in the RSVP-redesign charter. Touches `ConsumerEventDetailScreen.tsx` (consumer) and possibly nothing else if it mounts the existing `RsvpPublicBody`.
- **Issue 2 — the RSVP slice of the address leak (F-2, `RsvpPublicBody.tsx`)** — same file family as ORCH-1157's redesign; the leak is RSVP-only at the render layer; fixing it here is natural and urgent. (The standard-event slice is render-OK; see below.)

### New ORCH-1158 (cross-cutting standard + RSVP)
- **Issue 3 (map preview, F-3)** — purely a wizard fix in `CreatorStep3Where.tsx`, shared by standard + RSVP create/edit. Cross-cutting, not RSVP-specific. Belongs in 1158.
- **Issue 4 (doors, F-4)** — schema + wizard + view + render across standard + RSVP, all surfaces. Cross-cutting and needs a data model. Belongs in 1158 (or its own ORCH if Seth wants true doors — it is the heaviest item).
- Optionally fold the **address-hide invariant + venue-name-sanitize + default-unification (D-1/D-2)** into 1158 so the address-hide contract is enforced once across every surface (ticketed + RSVP + experience), with the RsvpPublicBody fix from 1157 retro-covered by the invariant test.

### File overlap / sequencing between 1157 and 1158
- **`RsvpPublicBody.tsx`** is touched by ORCH-1157 (Issues 1 path + Issue 2 RSVP gate). ORCH-1158's address-hide invariant test should be written to PASS against the post-1157 RsvpPublicBody — so **1157 must land first**, then 1158's invariant codifies the contract repo-wide. If they run concurrently, coordinate via COMMS ledger (both touch the RSVP address render).
- **`CreatorStep3Where.tsx`** (Issue 3) and the doors schema/wizard (Issue 4) are 1158-only — no overlap with 1157. They can proceed in parallel with 1157.
- **Recommended order:** ORCH-1157 (Issues 1+2-RSVP) → then ORCH-1158 (Issue 3 map, then the address-hide invariant retro-covering 1157, then Issue 4 doors gated on Seth's steering).

### Does Issue 4 need a wizard/schema change?
**YES — scope flag.** Doors times are not stored; true "Doors open/close" requires new columns + wizard capture + view exposure before any render. If Seth accepts "Starts/Ends" from the existing start/end timestamps, Issue 4 collapses to a render-only change (real data exists) and could even ride along in 1157/1158 cheaply.

---

## Open questions needing Seth's steering

- **Open Q-A (Issue 1):** Mount the shared `RsvpPublicBody` on consumer for full parity (recommended; removes the stray ticket block for free), or do the partial patch (gate ticket block + reorder)? No technical blocker to full parity found.
- **Open Q-B (Issue 2):** On the *standard* event page where you saw the street — was the hide toggle actually ON, or was the street typed into the Venue-name field? The standard render path gates correctly; need the specific event to confirm it is data, not code.
- **Open Q-C (Issue 2, RSVP semantics):** What is the RSVP address-reveal rule (no "purchase" exists)? Recommend: hide exact street until the guest is going+approved, showing venue name + city/area until then; reveal the street in the RSVP confirmation. Confirm or override.
- **Open Q-D (Issue 4):** True doors (new field + wizard capture, heavier ORCH) or display existing Start–End time beneath the date for now?

---

## Recommended next phase

SPEC — split into ORCH-1157 (Issues 1 + 2-RSVP) and ORCH-1158 (Issues 3 + 4 + the cross-surface address-hide invariant). SPEC should be written only after Seth answers Open Q-A/C/D (and ideally Q-B), since those decisions change the contract materially. Issue 3 can be specced immediately (no open questions).
