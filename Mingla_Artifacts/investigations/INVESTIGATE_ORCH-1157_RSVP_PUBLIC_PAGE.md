# INVESTIGATE — ORCH-1157 · Public RSVP Event Page (Direction C "Momentum")

**Mode:** INVESTIGATE (half 1 of IA pass — SPEC is the sibling file).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1157-[rsvp-public-redesign]/` on branch `ORCH-1157-rsvp-public-redesign`.
**Date:** 2026-06-17.
**Approved design (binding):** Direction C "Momentum" — `Mingla_Artifacts/design/ORCH-1157/RSVP_DIRECTION_C_MOMENTUM.html` + `DESIGN_PHILOSOPHY_ORCH-1157_RSVP_PUBLIC_PAGE.md`. Seth chose C; the one applied tweak ("You're invited" kicker `color: inherit`, pulsing dot stays accent) is already in the mockup.
**Comms ledger:** read on entry. No OPEN BLOCK; no OPEN WARN/FYI addressed to forensics / ORCH-1157 / ALL that is actionable for a frontend-only RSVP redesign. COMMS-0002 (backend-allowlist strict-grep gate) is noted as a **conditional** factor — it only bites if a new edge function / migration is added, and this investigation proves **none is needed** (see F-3). No ledger ack required.

---

## 0. What this investigation answers (Q-scorecard)

| # | Question | Verdict |
|---|---|---|
| Q1 | What renders on the PUBLIC RSVP page today, per surface, and what is the gap to Direction C? | **F-1 / F-2** — buyer-web + business iOS/Android share `RsvpPublicBody`; consumer iOS/Android use a DIVERGENT hand-rolled `rsvpDock`. Both fall short of C in identical and surface-specific ways. |
| Q2 | Is the C information model backed by REAL data, and is the source anon-safe? | **F-3** — every C slot maps to a real column ALREADY on `business_public_events_view` (anon-safe, `security_invoker=false`). NO migration/RPC needed for buyer-web/business. The consumer deck-supply path is the ONLY data gap (F-6). |
| Q3 | What is reusable shared vs per-app? | **F-4** — Direction-A chrome + theme + city/country + cover are shared today; the C-specific units (momentum meter, anonymous cluster, hero kicker, float→dock decision) are NEW and should be a shared sub-component. |
| Q4 | Does a CONSUMER RSVP detail exist, or must it be built? | **F-5** — it EXISTS (`ConsumerEventDetailScreen` RSVP branch) but is a divergent 2-button dock, NOT `RsvpPublicBody`. Build-vs-defer is a real decision (see §Recommended scope). |
| Q5 | What real-data honesty gaps must Direction C preserve? | **F-7** — no public guest names/avatars, no public maybe count, no public waitlist count, no comments/photos/reactions. Social proof = going count + meter + anonymous cluster only. |
| Q6 | Is `party_types` available to the page, and why is it not shown? | **F-8** — `party_types` IS a column on the view; the gap is purely the service mapper + the `PublicEventProps` type not carrying it. Pure frontend plumbing. |

---

## 1. Investigation manifest (files read, in trace order)

| # | File (absolute) | Why |
|---|---|---|
| 1 | `Mingla_Artifacts/design/ORCH-1157/DESIGN_PHILOSOPHY_…md` | binding design intent + real-data field inventory |
| 2 | `Mingla_Artifacts/design/ORCH-1157/RSVP_DIRECTION_C_MOMENTUM.html` | binding visual spec (phone + desktop, 5 states) |
| 3 | `mingla-business/src/components/event/RsvpPublicBody.tsx` | current shared RSVP body (buyer-web + business) |
| 4 | `mingla-business/src/components/event/PublicEventPage.tsx` | mounter; RSVP-branch discriminator + props |
| 5 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | anon public route |
| 6 | `mingla-business/app/rsvp/[id]/preview.tsx` | draft preview route |
| 7 | `mingla-business/src/hooks/usePublicEvents.ts` | anon data hook |
| 8 | `mingla-business/src/services/publicEventsService.ts` | anon-safe fetch + view-row mapper |
| 9 | `mingla-business/src/services/rsvpEvents.ts` | `submitPublicRsvp` edge invoke |
| 10 | `packages/event-rendering/types.ts` | `PublicEventProps` / `PublicBrandProps` contract |
| 11 | `packages/event-rendering/offeringCta.ts` | `resolveRsvpCta` + `RsvpCtaState` |
| 12 | `packages/offering-rendering/index.ts` | shared exports (ParallaxCoverShell, ChipGroup, normalizeCityCountry, useResponsiveLayout) |
| 13 | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` | consumer RSVP detail (divergent dock) |
| 14 | `app-mobile/src/services/rsvpDeckService.ts` | consumer Going/Not-going write |
| 15 | `app-mobile/src/components/ExpandedCardModal.tsx` | deck-card → detail navigation |
| 16 | `app-mobile/src/types/mergedDiscover.ts` | consumer seed shape (party fields, eventType, NO rsvp host-control) |
| 17 | `supabase/migrations/20261004000000_orch_1150_rsvp_events.sql` | RSVP schema + view + `rsvp_going_count` |
| 18 | `supabase/migrations/…orch_1006_pricing_views.sql` + `orch_0824_expose_taxonomy_in_views.sql` | confirm `party_types` is on the view |

---

## 2. Findings (six-field evidence)

### F-1 — Buyer-web + Business iOS/Android render `RsvpPublicBody`; it is a "subtraction" layout, not Direction C
- **Symptom:** the public RSVP page on `/e/{brandSlug}/{eventSlug}` (web + business native) shows: brand chip ("Hosted by …") → action card (headline "Are you going?" + contact form + plus stepper + 3-button CTA) → date fact → venue fact → About. There is NO hero kicker, NO party-type chips, NO going-count display, NO capacity meter, NO anonymous attendee cluster, and the decision is inline mid-card (not a thumb-zone float→dock / sticky panel).
- **Layer:** code.
- **Probe:** read `RsvpPublicBody.tsx` (full) + `PublicEventPage.tsx:506–604` (the RSVP branch) + the demo mockup.
- **Evidence:** `RsvpPublicBody.tsx` body order is `brandRow` → `actionCard` → `factRow` (date) → `factRow` (venue) → `aboutCard` (lines 610–689). `goingCount` arrives in `config` (line 60) but is consumed ONLY to derive `capacityFull` (line 165–166) and is **never rendered**. No `party_types` reference anywhere in the file (0 grep hits). `PublicEventPage.tsx:509` `const isRsvp = event.event_type === "rsvp";` returns early into `<RsvpPublicBody …/>` passing `config={{ capacity, goingCount: event.rsvpGoingCount ?? 0, … }}`.
- **Mechanism:** the component renders a transactional-page subtraction; Direction C's social-momentum hero (count + meter + cluster + chips + kicker + float→dock) simply does not exist in the code → the page reads as a ticket page with the price removed, exactly as the philosophy doc diagnoses.
- **Severity:** CONFIRMED ROOT CAUSE (this is the work).

### F-2 — Consumer iOS/Android render a DIVERGENT hand-rolled 2-button `rsvpDock`, not `RsvpPublicBody`
- **Symptom:** tapping an RSVP deck card opens `ConsumerEventDetailScreen` which shows a bottom dock with only **Going / Not going** (no Maybe), with a one-line resolved note for pending/waitlisted. No going count, no meter, no anonymous cluster, no party chips beyond the generic event body, no float→dock decision matching C.
- **Layer:** code.
- **Probe:** read `ConsumerEventDetailScreen.tsx:200–657` + `rsvpDeckService.ts` + `ExpandedCardModal.tsx:1770–1796`.
- **Evidence:** `ConsumerEventDetailScreen.tsx:203` `const isRsvp = seed?.eventType === "rsvp";`; `:605–657` `rsvpDock` is authored INLINE (its own `rsvpStyles`), exposes only `submit("going")` / `submit("not_going")` via `handleRsvp` (`:322–363`) → `submitDeckRsvp` → `public-submit-rsvp`. It imports `@mingla/event-rendering` + `@mingla/offering-rendering` for theme/cover/chrome but **does NOT import `RsvpPublicBody`** and **does not reuse `resolveRsvpCta`**. No `Maybe` button (the shared body has Maybe since ORCH-1150 R2).
- **Mechanism:** the consumer surface is a parallel implementation that already DRIFTS from the shared body (no Maybe). Direction C must reach it too (all-surface parity), so the consumer dock must be rebuilt on the same shared C unit or it will drift further.
- **Severity:** CONFIRMED ROOT CAUSE (parity gap + existing drift).

### F-3 — Every Direction-C data slot is backed by a real column ALREADY on the anon-safe `business_public_events_view`; NO migration/RPC needed (buyer-web/business)
- **Symptom:** the C design needs going count, capacity, party types, city/country, host, date, cover, description, RSVP host-control. Question: do they exist anon-safe?
- **Layer:** schema.
- **Probe:** read the latest `business_public_events_view` definition (the ORCH-1150 migration redefines it last) + `getPublicEventBySlug`.
- **Evidence:** `20261004000000_orch_1150_rsvp_events.sql:1390–1484` — the view SELECTs `e.party_types`, `e.vibe_tags`, `e.city`, `e.cover_media_url/type`, `e.description`, `e.title`, brand theme columns, `e.rsvp_discoverable/_capacity/_allow_plus_ones/_plus_ones_max/_waitlist_enabled/_approval_mode`, and a subselect `rsvp_going_count = SUM(1 + r.plus_count) WHERE rsvp_status='going' AND approval_status='approved'` (`:1469–1475`). `ALTER VIEW … SET (security_invoker = false)` (`:1484`) = the view runs as definer → **anon-safe read** (this is the ORCH-0964 security-definer public-view pattern; it does NOT use `.from("brands")`). `getPublicEventBySlug` (`publicEventsService.ts:993–1020`) reads `business_public_events_view` with `.maybeSingle()` (no `.single()` crash), gates `event_type IN ('event','rsvp')`.
- **Mechanism:** all C content is one view away from the anon caller; the page is data-complete at the source. The ONLY missing plumbing is in the JS mapper + the `PublicEventProps` type (F-8). **This means the buyer-web/business legs of ORCH-1157 are pure frontend work — no DB, no edge function, no Stripe.**
- **Severity:** CONFIRMED (positive finding — descopes the backend).

### F-4 — Reusable shared chrome already exists; the C-specific units are new and belong in a shared sub-component
- **Symptom:** which parts of C can be shared across all 5 surfaces?
- **Layer:** code.
- **Probe:** read `packages/offering-rendering/index.ts` exports + `RsvpPublicBody`'s imports + `ConsumerEventDetailScreen`'s imports.
- **Evidence:** `offering-rendering/index.ts` exports `ParallaxCoverShell` (`:11`), `OfferingChrome` (`:14`), `ChipGroup` (`:25`, already used for tags elsewhere), `normalizeCityCountry` (`:32`), `useResponsiveLayout` (`:35`). `event-rendering` owns `resolveRsvpCta` + `RsvpCtaState` (`offeringCta.ts:276–331`) and `boldFontFamily` + the theme palette. BOTH apps already import these. The momentum meter, anonymous attendee cluster, hero "You're invited" kicker, and the float→dock / sticky-panel decision control do **not** exist anywhere.
- **Mechanism:** the parallax cover, brand-theme palette ("loudness dial"), City/Country normalization, fixed X·Share chrome, and the CTA state machine are reuse-ready; the gravitational-center C units are net-new and, to hold all-surface parity without drift (F-2), must live in a single shared RN component consumed by both the business `RsvpPublicBody` and the consumer screen.
- **Severity:** CONFIRMED (architecture finding).

### F-5 — A consumer RSVP detail EXISTS (build-vs-defer is a genuine choice, not a greenfield build)
- **Symptom:** orchestrator asked whether a consumer RSVP detail must be built.
- **Layer:** code.
- **Probe:** `ConsumerEventDetailScreen.tsx` RSVP branch + `ExpandedCardModal.tsx` routing.
- **Evidence:** `ExpandedCardModal.tsx:1770–1796` routes a deck `businessEvent` (including `eventType:'rsvp'`) DIRECTLY into `<ConsumerEventDetailScreen seed=… />` (native, no web link, no dead end). The RSVP branch (`:203`, `:605–657`) is the consumer RSVP detail — it just renders the divergent 2-button dock.
- **Mechanism:** the consumer detail is real and mounted; ORCH-1157 does not need to invent navigation — it needs to **replace the divergent dock with the shared C unit** (and decide how much of the momentum unit the consumer can show given F-6).
- **Severity:** CONFIRMED.

### F-6 — Consumer deck-supply seed carries NO RSVP host-control fields → the consumer momentum meter has no data source today
- **Symptom:** the consumer screen builds RSVP UI from the deck `seed`, not from a public-event fetch. The seed has `partyTypes`, `coverMediaUrl`, `city`, `venueName`, `eventType` — but NOT `rsvpGoingCount`, `rsvpCapacity`, `rsvpWaitlistEnabled`, `rsvpApprovalMode`, `rsvpAllowPlusOnes`.
- **Layer:** data / schema.
- **Probe:** `mergedDiscover.ts` (seed shape) + grep deck-supply RPCs for `rsvp_going_count`.
- **Evidence:** `mergedDiscover.ts:29,44–45,61,82–87` show `coverMediaUrl/Type`, `venueName`, `city`, `partyTypes`, `eventType` but no `rsvp*` host-control fields. Grep for `rsvp_going_count` across `supabase/migrations` + `supabase/functions` returns ONLY the ORCH-1150 view migration — the deck-supply RPCs (`20261007000000_orch_1138_rework_deck_supply.sql`, `20261009000003_orch_1153…`) do NOT surface it. So on the consumer surface there is currently no going-count / capacity / waitlist / approval available client-side.
- **Mechanism:** to render the C momentum unit (count + meter + cluster) and the correct waitlist/approval CTA states on the CONSUMER surface, the seed must carry these fields — which means EITHER (a) the consumer screen fetches the public event via the same anon view path as buyer-web (preferred — one data contract), OR (b) the deck-supply RPC + seed mapper are widened to carry the RSVP host-control fields. **This is the only real data-layer decision in ORCH-1157** and it is consumer-only.
- **Severity:** CONFIRMED CONTRIBUTOR (blocks full consumer momentum parity; not a bug, a supply gap).

### F-7 — Real-data honesty constraints Direction C MUST preserve (constitution rule 9)
- **Symptom:** Partiful shows guest names/faces/comments; Mingla cannot honestly.
- **Layer:** schema + docs.
- **Probe:** philosophy doc §2 + `event_rsvps` RLS in the ORCH-1150 migration.
- **Evidence:** philosophy doc §2 — `event_rsvps` stores `guest_name/email/phone` but RLS exposes ONLY the caller's own row; there is NO public read of who's going and NO guest-avatar column. `goingCount` (`rsvp_going_count`) is the ONLY public tally — no public `maybeCount`, no public `waitlistCount`. No comments/photos/reactions schema.
- **Mechanism:** Direction C's "anonymous attendee cluster" MUST be faceless avatars labelled as a COUNT (e.g. "+35 are pulling up"), never real identities; show waitlist/approval as STATE, not a number; show only the going count. Any avatar/name list, any "X maybe", any "Y on the waitlist" number, any comment/reaction affordance would fabricate data → constitution-rule-9 violation → enforced by I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY.
- **Severity:** CONFIRMED (honesty constraint — becomes a DRAFT invariant).

### F-8 — `party_types` is on the view but is dropped before the page; pure mapper/type plumbing
- **Symptom:** party-type chips are required by C; they render nowhere today.
- **Layer:** code.
- **Probe:** `publicEventsService.ts` mapper + `PublicEventProps` type + the RSVP component.
- **Evidence:** the view exposes `e.party_types` (F-3). `publicEventsService.ts` `publicEventViewRowToEvent` reads the row but does NOT extract `party_types` into the returned record; `packages/event-rendering/types.ts:48–82` `PublicEventProps` has NO `partyTypes` / `vibeTags` field; `RsvpPublicBody` therefore cannot render chips (0 grep hits).
- **Mechanism:** to show party-type vibe chips, `PublicEventProps` gains a `partyTypes: string[]` (+ optionally `vibeTags`), the buyer-web mapper populates it from the view row, the consumer seed already has `partyTypes` (F-6), and the shared C unit renders them via the existing `ChipGroup`. No DB change.
- **Severity:** CONFIRMED CONTRIBUTOR.

---

## 3. Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|---|---|---|
| Docs | Direction C is approved; real-data-only; all-surface parity; no checkout. | — |
| Schema | The anon view already carries every C field incl. `rsvp_going_count` + `party_types`; `event_rsvps` RLS hides guest identities. | **vs Code:** the view exposes data the JS layer drops (`party_types`, and the going count is fetched but never rendered). The gap IS the work. |
| Code | Buyer-web/business render a subtraction layout; consumer renders a divergent 2-button dock without Maybe. | **vs Schema:** code under-uses available data. **vs Docs (parity):** consumer ≠ business (no Maybe, no momentum). |
| Runtime | Not live-fire'd this pass — this is a design-build IA, not a reproducer-bound bug (see §4). | n/a |
| Data | `rsvp_going_count` is computed live; consumer deck supply does NOT carry it (F-6). | **vs Docs (parity):** consumer momentum unit has no supply today. |

---

## 4. Repro evidence / live-fire posture

This is a **design-implementation IA**, not a reproducer-bound UI bug. Prime Directive 7's live-fire mandate applies to "a UI/UX/input bug with a specific reproducer"; ORCH-1157 has no malfunction to reproduce — the current page renders correctly, it is simply the pre-redesign layout. The binding artifact is the approved Direction-C mockup (already headless-screenshotted at 390px/1280px per philosophy §6). **No simulator repro is required to define the build.** Runtime proof of the C build PER surface is the TESTER's job after implementation (SPEC §5 success criteria are written as runtime-observable per surface). Static evidence above is therefore confidence `proven` for the architecture/data findings (read every relevant line + confirmed the latest migration via the migration-chain rule) and the build scope.

---

## 5. Blast radius / cross-surface map

**In-scope surfaces (5 — all require parity):**
1. Consumer iOS (`app-mobile` `ConsumerEventDetailScreen` RSVP branch).
2. Consumer Android (same file; Android opaque-glass policy applies).
3. Buyer/anon Web (`mingla-business` `/e/{brandSlug}/{eventSlug}` → `PublicEventPage` → `RsvpPublicBody`, web variant).
4. Business iOS (same `RsvpPublicBody`).
5. Business Android (same; opaque-glass policy).

**Adjacent surfaces:**
6. Business Web preview (`/rsvp/[id]/preview`) — IN scope (it mounts `RsvpPublicBody`; goingCount=0 draft state must render the empty/zero momentum honestly).
7. Admin Web — NOT in scope (no RSVP public page).

**Shared blast points:** `packages/event-rendering/types.ts` (`PublicEventProps` gains `partyTypes`) and a NEW shared C unit in `packages/offering-rendering` (or `event-rendering`) consumed by both apps — a change here touches every offering page's type-check, so the type addition must be additive/optional-safe.

---

## 6. Invariant impact (flagged, not pre-decided)

- **Touched / must preserve:** `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (the new momentum/cluster/decision cards must use opaque Android fills + `overflow:'hidden'`); the ORCH-1150 RSVP-no-checkout contract (`orch-1150` test asserting the RSVP write never routes to `/checkout`); `I-PROPOSED-1138-EVENT-DECK-OFF-EBES` (consumer deck routing unchanged).
- **New DRAFT invariants proposed (SPEC owns the rule/enforcement; orchestrator flips ACTIVE on CLOSE):**
  - `I-PROPOSED-1157-RSVP-NO-CHECKOUT-AFFORDANCE`
  - `I-PROPOSED-1157-RSVP-DECISION-IS-HERO`
  - `I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY`
  - `I-PROPOSED-1157-RSVP-USES-BRAND-THEME-DIAL`
  (full rule/enforcement/regression-test in the SPEC §6.)

---

## 7. Discoveries for orchestrator (side issues)

- **D-1 (existing drift):** the consumer RSVP dock lacks the **Maybe** option that the shared body has had since ORCH-1150 R2. ORCH-1157 will close this incidentally by unifying on the shared C unit, but flag it as a pre-existing parity defect.
- **D-2 (consumer supply gap):** the consumer momentum meter needs `rsvp_going_count` + capacity client-side; the deck seed doesn't carry it (F-6). The SPEC recommends the consumer screen fetch the public event via the SAME anon view path (one data contract) rather than widening the deck-supply RPC — but this is a real architectural fork the orchestrator should bless.
- **D-3 (COMMS-0002):** if the orchestrator instead chooses to widen the deck-supply RPC (option b in F-6), that migration triggers the COMMS-0002 backend-allowlist strict-grep gate — the implementor must add the allowlist entry in the same commit. The SPEC's recommended path (anon-view fetch) avoids this entirely.

---

## 8. Confidence + recommended next phase

- **Confidence:** `proven` for the architecture/data/honesty findings (every relevant line read; latest migration confirmed via the migration-chain rule; the view already carries all C fields). The only open decision is the consumer data-supply fork (F-6 / D-2), surfaced as an Open Question in the SPEC.
- **Recommended next phase:** SPEC (written as the sibling file `SPEC_ORCH-1157_RSVP_PUBLIC_PAGE.md`) → then mingla-implementor → mingla-tester (per-surface live-fire) → orchestrator CLOSE.
- **Recommended scope:** build Direction C as a shared RN "RSVP momentum + decision" unit consumed by (a) `RsvpPublicBody` (buyer-web + business + preview) and (b) `ConsumerEventDetailScreen` RSVP branch. Add `partyTypes` to `PublicEventProps`. For the consumer momentum data, fetch the public event via the existing anon view path (no migration). Reserve NO checkout/price affordance anywhere.
