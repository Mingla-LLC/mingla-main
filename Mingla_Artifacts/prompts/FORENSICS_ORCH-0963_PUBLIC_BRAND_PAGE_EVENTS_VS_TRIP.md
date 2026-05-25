# FORENSICS DISPATCH — ORCH-0963 [Public brand page business-case optimization — events vs. trip brands]

**Target skill:** Claude `mingla-forensics`
**Mode:** INVESTIGATE → SPEC (two-phase; return INVESTIGATE first, await REVIEW, then SPEC)
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/` on branch `ORCH-0963-public-brand-page-events-vs-trip`
**Metro port:** 8085 (mingla-business web preview is the primary verification surface)
**Affected Surfaces:** buyer-web (`mingla-business/app/b/[brandSlug]/index.tsx` — anonymous, no auth). **Surfaces explicitly NOT in scope:** iOS-consumer (`app-mobile/` does not render `/b/`), Android-consumer (same), business-iOS / business-Android (organiser-only, not the IG-bio-link surface), admin-web (no admin equivalent of public brand page).

---

## Goal (plain English)

Today the public brand page (`/b/{brandSlug}`) is one-size-fits-all: 3 tabs (Upcoming / Past / About) hard-coded for ticketed events. A trip-planner brand (`brands.kind = 'trip_planner'`) gets the exact same chrome — but a trip planner's business case is "discover the next trip and join it," not "buy a ticket to an upcoming event." Today an organiser of a trip-planner brand drops their `/b/{slug}` link into IG bio and visitors see a layout that doesn't match the offering.

The work is **information architecture**, not visual polish:

- For `kind = 'physical' | 'popup'` (event brands): upcoming-event list + ticket CTAs front-and-center.
- For `kind = 'trip_planner'`: itinerary discovery + trip cards front-and-center.

Same URL, same auth (anon), same primitives — but the page model branches on `brands.kind`.

---

## INVESTIGATE — what we need proved before SPEC

### Phase 0 mandatory ingest

Before any analysis, read:

1. `mingla-business/app/b/[brandSlug]/index.tsx` — current entry.
2. `mingla-business/src/components/brand/PublicBrandPage.tsx` — full file. Note the Cycle 7 spec header lines 1-41 (constitutional rules already in force: no fake counts, no Follow CTA, no rating, no verified blue check, route-handle suppression for popups). Confirm whether trip_planner brands currently fall into the popup branch or the physical branch for venue/address handling.
3. `mingla-business/src/hooks/usePublicEvents.ts` and the corresponding `publicEventsService.ts` — does the public hook return trips? Just events? Mixed? Today's contract.
4. `mingla-business/src/components/brand/TripBrandWizard.tsx` + memory entries [[persona-picker-locked-interface]] and [[brand-kind-immutable-post-create]] (codified ORCH-0855) — the trip-planner persona is locked at `'place' | 'event' | 'trip'`; `brands.kind` is immutable post-create. This means trip-planner brands are a *first-class* discrete brand kind, not a feature flag on event brands.
5. Schema layer: query `brands` table — full column list including `kind`, `venue_id`, persona fields. Query the trip schema (likely `trips` table — confirm the actual table name) — what trip rows live under a brand? What's the trip lifecycle (draft / scheduled / in-progress / completed / cancelled)? Ticketing model — do trips sell seats the same way events do, or is the booking primitive different?
6. ORCH-0859 [Tr2 Minimum Viable Trip] + ORCH-0855 [Tr1 Trip Planner Brand Onboarding] close notes from `Mingla_Artifacts/WORLD_MAP.md` — the trip data model is recent. Anchor against the latest contract.
7. ORCH-0962 [brand-edit public render audit] is currently in flight (worktree exists at `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]`). Check that worktree's investigation/spec artifacts if any exist — does it touch the public brand page render path? If overlap exists, flag it as a cross-ORCH dependency (use COMMS_LEDGER).

### Five-truth-layer cross-check

| Layer | Question |
|-------|----------|
| Docs | What does the Cycle 7 spec say about trip brands on the public page? What did ORCH-0855 / ORCH-0859 leave for the public surface? |
| Schema | What `brands.kind` values exist? What `trips` columns + states exist? What public-readable RLS policies apply to trips? |
| Code | What does `PublicBrandPage` currently render when given a trip-planner brand? Empty Upcoming tab? Trips lumped under events? Crash? |
| Runtime | Pull one live trip-planner brand from prod (read-only Mgmt API) — what shape does its data have right now? |
| Data | How many brands per `kind`? How many active trips? What's the realistic surface state today? |

### Required findings (numbered F-#)

F-1 — Current behaviour for a `kind = 'trip_planner'` brand on `/b/{slug}`: what does a visitor see? Screenshot from running web preview against a real trip-planner brand if any exists; otherwise, source-only reasoning with a "suspected" qualifier per memory rule [[always-simulator-repro-described-behaviour]]. Spin up Metro on port 8085 + Playwright/Chromium against `localhost:8085/b/<a-real-trip-brand-slug>` if a trip-planner brand exists in prod that's safe to load read-only.

F-2 — Trip data contract: how does a trip surface publicly today? Is there a `usePublicTripsForBrand` hook? A `public_trips` view? A SECURITY DEFINER RPC? Or is the only public path the per-trip URL (analogous to `/e/{brandSlug}/{eventSlug}`)?

F-3 — Brand-kind divergence inventory: every spot in `PublicBrandPage.tsx` and its descendants where event-specific assumptions live (Upcoming/Past tab labels, ticket CTA copy, "Sold out" indicators, "Buy tickets" buttons, event-cover-driven hero, etc.). For each, name the trip-planner equivalent (or "no equivalent — different concept").

F-4 — SEO/share contract: `brandOgImageUrl` + `brandPublicUrl` + `Head` metadata in `PublicBrandPage`. Do these need kind-aware variants? (e.g., the OG image for a trip-planner brand should probably show next-trip-cover, not next-event-cover.)

F-5 — Ownership model: today `ownsThisBrand` enables a "manage" close chrome for signed-in owners. Does this need any trip-planner divergence?

F-6 — Anon RLS / public read path for trips: confirm trips have a public-readable surface analogous to `public_events` / the public hook for events. If they don't, that's a P0 blocker that has to be specced before any IA work.

F-7 — Cross-surface: does the consumer app (`app-mobile/`) consume `/b/{slug}` directly via deeplink? Verify by grep. Per the surfaces declaration above, app-mobile is NOT in scope — but if a deeplink exists, flag it.

### Hard guards for INVESTIGATE phase

- **Investigation only.** No code edits. No migrations. No edge-function deploy. No SPEC writing yet.
- **No fabrication.** Honest "could not verify — needs operator data" beats invented findings.
- **No fake data examples.** Use real prod brand slugs (read-only) or synthetic clearly-labeled examples.
- **Do not propose solutions.** Save them for SPEC.
- **External-API check (per COMMS-0003 [[external-api-docs-verified]]):** none expected this phase — public brand page has no external API surface. Confirm explicitly in the report.
- **Run web preview before claiming behaviour** — per memory [[always-simulator-repro-described-behaviour]]. If you can't get a trip-planner brand to render, say so and downgrade claims to "suspected from source."

### Expected output

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` in the worktree, with sections:

1. Executive summary (3-5 sentences, plain English).
2. Phase 0 ingest log (files + commits + memory entries read).
3. Five-truth-layer matrix (filled).
4. Findings F-1 through F-7 with evidence (file paths + line numbers + grep output + screenshots if produced).
5. Cross-ORCH dependencies (ORCH-0962 overlap if any, COMMS entries triggered).
6. Open questions for operator before SPEC.
7. Recommended SPEC scope boundaries (what's in / out of ORCH-0963).

---

## SPEC — write only after INVESTIGATE REVIEW APPROVED

When the orchestrator returns APPROVED on the investigation, produce
`Mingla_Artifacts/specs/SPEC_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` defining:

- Branching strategy: kind-aware render at the route level vs. inside `PublicBrandPage` vs. two sibling components (`PublicEventBrandPage` / `PublicTripBrandPage`). Recommend one with rationale.
- IA for trip-planner variant: tab structure (Upcoming trips / Past trips / About?), trip-card primitive shape, join CTA semantics, capacity/spots-left display rules (mirror ORCH-0947's `biz_trip_tickets_sold` invariant `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE` if applicable).
- IA for event variant: confirm what stays vs. what gets reorganized to push tickets CTA further up the visual hierarchy.
- Public data contract: new RPC / view / hook needed for public trip read, or reuse of existing.
- SEO/share contract per kind.
- Constitutional compliance checklist (every Cycle 7 §12 honesty rule must still hold per kind).
- Invariants proposed (e.g., `I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED`).
- Strict-grep gate proposal if any (registry pattern per [[strict-grep-registry-pattern]]).
- Regression test plan (per Step 0.5 gate — happy-path test path + adversarial test path, both must FAIL on revert).
- Success criteria (numbered SC-#).
- Out-of-scope (named explicitly — e.g., consumer app deeplink behavior, trip-creation flow, paid-trip checkout if any).

---

## Downstream routing

After SPEC REVIEW APPROVED: orchestrator dispatches Codex `implementor-mingla` (default per pipeline routing). Test: Claude `mingla-tester` with web (Playwright) parity verification against both kinds on the same `/b/{slug}` URL pattern.

## Working notes

- The `events` prop on `PublicBrandPage` is type `LiveEvent[]` — it cannot transparently absorb trips. Either the component branches early on `brand.kind` and reads a different data source, or two components diverge from a shared shell.
- `venue?: PublicVenueDetail | null` already handles the popup vs. physical split; the trip-planner kind extends that pattern but the data shape is fundamentally different (trips are scheduled multi-day plans, not single-event line items).
- Memory rule [[brand-kind-immutable-post-create]] guarantees we can branch on `brands.kind` at render time without worrying about runtime kind migration.

Operator (Seth) is in auto-mode and will dispatch this prompt as soon as the orchestrator hands it off. INVESTIGATE first, return for REVIEW, then SPEC.
