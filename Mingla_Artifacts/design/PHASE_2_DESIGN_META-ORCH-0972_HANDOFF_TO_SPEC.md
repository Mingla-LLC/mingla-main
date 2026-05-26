# PHASE_2_DESIGN_META-ORCH-0972_HANDOFF_TO_SPEC

**ORCH:** META-ORCH-0972 — Phase 2 design deliverable (handoff to Phase 3 SPEC)
**Date:** 2026-05-25
**For:** Claude `mingla-forensics` SPEC mode
**Companion docs:** [USER_JOURNEYS](./PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md), [SCREEN_INVENTORY](./PHASE_2_DESIGN_META-ORCH-0972_SCREEN_INVENTORY.md), [COPY_INVENTORY](./PHASE_2_DESIGN_META-ORCH-0972_COPY_INVENTORY.md)

---

## What this design locks in

Nine design areas, all flow-level + copy-level + screen-level. Cross-references every Phase 1 audit dimension. Aligns with all 11 operator-answered design questions (Q1–Q11 per [OPEN_QUESTIONS](../reports/INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md)). Uses Mingla's existing primitives (GlassCard, Icon, Button, TopSheet, BrandCoverPickerSheet, EventMiniCard, TripMiniCard, Haptics) — no new design language. Applies ui-ux-pro-max cross-cutting rules (44pt touch, 150–300ms motion, 4.5:1 contrast, prefers-reduced-motion, no emojis as icons, content-jumping prevention via shimmer placeholders, button disable during async).

The design replaces today's persona-fork brand creation with a unified 4-step flow; collapses TripBrandWizard into that flow; introduces a reusable `<OfferingChooser>` 3-button component that appears in 3 surfaces; demotes the Stripe-inactive home rung from blocker to opportunistic upsell; deletes the physical-no-address home rung entirely; makes hub tabs data-driven with a placeholder "Get started" tab for zero-offering brands and sticky-last-visited defaulting; rebuilds the public brand page IA around a chronological "Upcoming" tab plus per-type tabs (Events / Trips / Experiences) that render only when their bucket has data; introduces an `<ExperienceMiniCard>` for the public page; redesigns experience creation to always ask for a venue with brand-address pre-fill; reframes venue claim end-to-end from "verify to sell" gate to "claim for badge + discovery" upgrade; rebuilds the admin Venue Claims dashboard with pending/verified/rejected tab structure; and makes the AI experience generators (parse-restaurant-menu, parse-play-activities) universally accessible.

## What this design DOES NOT lock in (Phase 3 spec scope)

- **Exact TS interfaces** for new components (`<OfferingChooser>` props, `<ExperienceMiniCard>` props, `<BrandCreationFlow>` step orchestration interface, etc.).
- **Exact hook signatures + query keys + staleTime/enabled rules** for `useHubVisibleTabs`, `useHubInitialTab`, `useBrandOfferingCounts`, `useExperienceVenueDefault`, `fetchPublicBrandExperiences`.
- **Exact RPC SQL** for `pg_public_experiences_by_brand` + the `pg_public_trips_by_brand` rewrite (drop the line-46 brand-kind guard, keep canonical sold formula per I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE).
- **Exact RLS predicate rewrites** for the 3 VE4 public-read policies + the `business_public_brands_view` + `claimed_venues_public_view` rewrites + `business_public_events_view` brand_kind column drop.
- **Exact migration ordering + SQL** for the 4-stage 30-step DROP COLUMN safety plan in [DATA_MODEL_AUDIT](../reports/INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md) §"DROP COLUMN SAFETY PLAN".
- **Exact schema enrichment** for `theme.experience_meta.venue_text` + `theme.experience_meta.next_occurrence_at` (JSONB structure, indexing strategy, validation rules) per Q9.
- **Strict-grep gate code** for `orch-0972-data-driven-tabs.mjs` + `orch-0972-no-brand-kind-reads.mjs` + the C1+C3 deletion + C2+C4 preservation in `orch-0963-public-brand-kind-branched.mjs`.
- **Cross-Surface Impact section (Phase 2.5)** with per-surface success criteria — Phase 3 spec writes this per the SPEC template.
- **Regression test cases** (T-01..T-NN) per Phase 1 audit-flagged surface — Phase 3 spec writes these.

## Cross-references to Phase 1 audit findings the spec must address

| Phase 1 finding | Phase 3 spec must cover |
|---|---|
| GAP_AUDIT D1 — brand creation cluster (22 surfaces) | Unified `BrandCreationFlow` SPEC + persona-picker deletion ordering + brandsService `CreateBrandInput` interface change + brandPatch dirty-field block delete |
| GAP_AUDIT D2 — BrandEditView SECTION B-2 + address conditional | Section deletion + address always-visible behavior + new "Claim a venue" affordance integration |
| GAP_AUDIT D3 — brandAuthoringGate.ts | Whole-file delete + 2 callsite deletions (eventDrafts.ts:172, tripsService.ts:441) |
| GAP_AUDIT D4 — Address handling (6 surfaces) | Universal-optional rule + experience-venue defaulting via `useExperienceVenueDefault` |
| GAP_AUDIT D5 — Home dashboard rungs + tests | `homeNextAction.ts` full rewrite per Design Area 3 + homeNextAction.test.ts rewrite |
| GAP_AUDIT D6 — Hub tabs (5 distinct kind gates in experiences.tsx) | Data-driven visibility hooks + tab body retention without kind gates + Get-started placeholder tab |
| GAP_AUDIT D7 — Offering creation (incl. trip/[id]/edit.tsx:67 + UniversalCreatorSheet:79-80) | trip/create.tsx:52 + trip/[id]/edit.tsx:67 gate deletes + UniversalCreatorSheet comment update + new `<ExperienceCreatorWizard>` |
| GAP_AUDIT D8 — AI experience generators (3 server-side gates + 2 client gates) | Server gate deletions in 3 edge functions + client gate redesign per Design Area 9 |
| GAP_AUDIT D9 — Public brand page (post-rebase supplemental + ORCH-0963 surfaces) | Full PublicBrandPage rewrite per Design Area 5 + publicEventsService dispatch rewrite + ORCH-0963 RPC brand-kind-guard removal + new `<ExperienceMiniCard>` + new `pg_public_experiences_by_brand` RPC + ORCH-0963 strict-grep gate C1+C3 deletion |
| GAP_AUDIT D10 — Venue claim (4 app surfaces) | VenueClaimStatusBanner reframe + venueClaimBannerLogic kind-gate removal + marketing copy updates per Design Area 7 |
| GAP_AUDIT D11 — Backend (DB + edge fns + strict-grep gates) | Full 4-stage 30-step safety plan execution + new META-ORCH-0972 strict-grep gates |
| GAP_AUDIT D12 — admin Venue Claims `adminClaimsService.js:37` | Filter replacement per Design Area 8 + 3-tab dashboard structure |
| OPEN_QUESTIONS Q1–Q11 | Translate operator decisions into testable spec criteria (e.g., Q1 free-vs-paid → exact predicate at publish-time validator) |
| DATA_MODEL_AUDIT §"DROP COLUMN safety plan" 4-stage 30-step | Sequence migrations + RPC rewrites + view rewrites + RLS rewrites in spec implementation order |
| Designer-surfaced Q12–Q15 (recurrence, past tab structure, Upcoming cap, venueCategory inference) | Resolve in spec phase — recommendations provided in master design doc |

## Affected Surfaces declaration (Phase 2.5 in Phase 3 SPEC)

Per the audit + this design:

- **In scope:** business-iOS, business-Android, business-web-preview, buyer-web (public brand page), admin-web (Venue Claims dashboard)
- **NOT in scope:** consumer iOS, consumer Android (Dim 12 confirmed brand-kind-agnostic; spot-verified by Codex independent REVIEW)

Phase 3 spec must write per-surface success criteria for every multi-platform area (brand creation, hub tabs, experience creation, public brand page, venue claim reframe).

## Locked invariants the spec must preserve

- **I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE** (ORCH-0947) — when rewriting `pg_public_trips_by_brand` to drop the brand-kind guard, the canonical sold formula `tickets.status IN ('valid','used','transferred')` joined via `ticket_types.event_id` MUST remain unchanged.
- **I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE** (ORCH-0859) — `/e/*` events-only, `/t/*` trips-only, `/exp/*` experiences-only when added. ORCH-0963 strict-grep C4 enforces; PRESERVE in META-ORCH-0972.

## Invariants META-ORCH-0972 will INTRODUCE on CLOSE

- `I-BRAND-UNIVERSAL-AUTHORING` — every brand can author every offering type. Strict-grep enforces no `brand.kind` reads in active product code.
- `I-PUBLIC-PAGE-DATA-DRIVEN-TABS` — public brand page tabs render based on offering counts, not on brand.kind.
- `I-HUB-TABS-DATA-DRIVEN` — business app hub tabs render based on offering counts.
- `I-VENUE-CLAIM-OPTIONAL` — venue claim is opt-in discovery booster, never authoring gate.

## Invariants META-ORCH-0972 will SUPERSEDE on CLOSE

- `I-PROPOSED-TR1-PERSONA-INTERFACE` (ORCH-0855)
- `I-PROPOSED-TR1-KIND-IMMUTABLE` (ORCH-0855)
- `I-PUBLIC-BRAND-KIND-BRANCHED` (ORCH-0963 — flipped ACTIVE 2026-05-25, lifetime ~24h before META-ORCH-0972 supersedes)
- DEC-152, DEC-161 (ORCH-0855)
- Memory rules `feedback_brand_kind_immutable_post_create.md` + `feedback_persona_picker_locked_interface.md`

## Comms-ledger to factor in spec

- **COMMS-0002** — ORCH-0863 backend allowlist must be updated in same commit as any backend touch (Phase 4 implementor scope, but spec lists this as a hard requirement).
- **COMMS-0003** — no external APIs touched in META-ORCH-0972 (verified — only internal RPC/view/RLS work + edge function gate deletions); N/A.

## Recommended Phase 3 spec structure

Single SPEC document at `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` covering all 9 design areas. Suggest splitting into Sub-A (gates + DB constraint), Sub-B (UX consolidation incl. brand creation + edit + home + hub), Sub-C (public page + experiences + RPC + RLS + view rewrites), Sub-D (edge functions + strict-grep gates + marketing audit + tests) per audit's Phase 4 sub-scoping. Each sub gets its own success criteria block but the SPEC stays one document for cross-reference integrity.

End of handoff.
