# SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase:** 3 of 5 — SPEC
**Mode:** SPEC (Claude `mingla-forensics`)
**Date:** 2026-05-25
**Author:** Claude `mingla-forensics`
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`
**Base commit:** `ff26b23bb` (Phase 2 design REWORK APPROVED at `8311fa89b`; REWORK REVIEW at `ff26b23bb`)
**Design lock:** Phase 2 design at commit `8311fa89b` — DO NOT redesign

---

## Comms-ledger reads on entry

- **COMMS-0002 (WARN):** `ORCH_0972_BACKEND_ALLOWLIST` MUST be added to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` listing every file under `supabase/functions/` + `supabase/migrations/` this spec authors, IN THE SAME COMMIT as the backend touch (Sub-A + Sub-C + Sub-D). Factored into each sub-spec's checklist.
- **COMMS-0003 (WARN):** External-API docs verification required when external APIs touched. **META-ORCH-0972 touches NO external APIs** (no Stripe, Google, OpenAI surfaces) — N/A. The OpenAI calls in `parse-restaurant-menu` / `parse-play-activities` are UNCHANGED; only the brand-kind authorization gates around them are removed.
- **COMMS-0004 (WARN):** INTAKE ORCH-ID collision check — N/A (this is SPEC, not INTAKE).
- **COMMS-0005 (WARN):** ORCH-0964 [public-page theme customization] touches `PublicBrandPage.tsx` (SEO/metadata block lines 230–267 + font/color/animation tokens). META-ORCH-0972 Sub-C also touches `PublicBrandPage.tsx` (tab structure + address card + primitives). Per COMMS-0005, the two ORCHs touch non-overlapping sections. **Sub-C implementor MUST rebase against `main` before final push; if ORCH-0964 lands first, the theme tokens apply inside the new `<ExperienceMiniCard>` + `<NextEventTeaser>` primitives. If META-ORCH-0972 lands first, ORCH-0964 inherits the new tab structure.**

Acked by `mingla-forensics+claude (META-ORCH-0972 SPEC)` — orchestrator updates ledger on next direct-to-main entry.

---

## Migration filename collision check (orchestrator backstop, 2026-05-24)

Per migration-apply backstop. Scanned with `for d in ~/Desktop/mingla-orchs/*/supabase/migrations/; do ls "$d" 2>/dev/null | grep -E "^2026072[89]|^2026073" ; done | sort -u`. Result: only `20260728000000_orch_0963_pg_public_trips_by_brand.sql` exists with prefix `2026072[89]*`. **No conflict for `20260729000000+` or `20260730000000+`.** This spec reserves prefixes:

- `20260729000000_meta_orch_0972_*.sql` — Stage 0 + Stage 2 + Stage 3 (Sub-A + Sub-C migrations, all in one safe-deploy cycle)
- `20260730000000_meta_orch_0972_drop_brand_kind.sql` — Stage 4 (column + constraint drop, ships in the FOLLOW-UP release cycle ≥1 cycle after Stages 1–3 are live; see Sub-C §Stage 4)

Re-check at implementor time via `/Users/sethogieva/bin/supabase migration list --linked` from the per-ORCH worktree.

---

## Quick-reference: 11 operator decisions (Q1–Q11 from OPEN_QUESTIONS)

Carried verbatim from the investigation. Phase 3 translates each into testable predicates.

| Q | Decision | Spec realization |
|---|---|---|
| Q1 | Stripe required to publish only when `max(tier.price) > 0`; RSVP-with-deposit counts as paid | Sub-B §Home rung 1 predicate + Sub-B §Publish validator |
| Q2 | "Get started" placeholder hub tab with 3-button chooser when all 3 hub tabs empty | Sub-B §`useHubVisibleTabs` |
| Q3 | Sticky last-visited hub tab; default Events on first ever visit | Sub-B §`useHubInitialTab` with AsyncStorage key |
| Q4 | Experiences IN public-page Upcoming tab (chronologically interleaved) | Sub-C §Upcoming tab interleave + `pg_public_experiences_by_brand` |
| Q5 | TripBrandWizard clean-delete and unify into BrandCreationFlow | Sub-B §BrandCreationFlow |
| Q6 | Address combined ask: optional at brand-create + re-ask at first experience-create | Sub-B §BrandCreationFlow Step 2 + Sub-B §`useExperienceVenueDefault` |
| Q7 | Experience venue: always ask + pre-fill from brand address if present | Sub-B §ExperienceCreatorWizard Step 2 |
| Q8 | Worktree rebased onto origin/main — done (Phase 1 ingest) | N/A spec time |
| Q9 | Experience schema: JSON sub-fields in `theme.experience_meta` (`next_occurrence_at` + `venue_text`); no new column | Sub-C §Stage 0 migration + indexing strategy |
| Q10 | Admin Venue Claims: pending-review queue default + Verified + Rejected tabs | Sub-B §`adminClaimsService.js` rewrite + admin UI tabs |
| Q11 | Persona picker KILLED (PersonaPickerCards + PersonaForkSheet + persona-fork mode all deleted) | Sub-B §Persona picker deletion checklist |

## Quick-reference: 4 designer-surfaced questions (Q12–Q15 from USER_JOURNEYS §Newly-surfaced)

These were NOT in the operator's Q1–Q11 batch. Designer provided recommendations; this SPEC formally resolves them.

### Q12 — Experience recurrence model

**SPEC DECISION:** **v1 ships ONE-TIME only.** `theme.experience_meta.next_occurrence_at` is a single `timestamptz` (single occurrence). No recurrence enum, no cron, no `experience_instances` table. Recurring experiences require operator to manually edit the date or republish.

**Rationale:** Smallest schema surface + smallest test matrix. Recurrence is a follow-up ORCH if users ask for it. Aligns with operator Q9 rejection of the `experience_instances` table.

**Spec realization:** `theme.experience_meta` JSON sub-fields written by Sub-B `ExperienceCreatorWizard` Step 3 = `{ next_occurrence_at: ISO8601 string }` only. No `recurrence` field. UI shows only "One-time only" option in Step 3 Recurrence label per COPY_INVENTORY line 121.

### Q13 — Past trips/events: per-type vs unified "Past" tab

**SPEC DECISION:** **PER-TYPE past sections inside each per-type tab.** Events tab body contains an "Upcoming" section + "Past" section below; Trips tab body contains an "Upcoming" section + "Past Trips" section below; Experiences tab body contains "Active" section only (no past for experiences in v1 since one-time experiences past `next_occurrence_at` become inactive, not "past sales"). NO unified "Past" tab at the right end of the tab bar.

**Rationale:** Matches today's per-type tab mental model; less tab proliferation. Designer recommendation in USER_JOURNEYS line 794 accepted.

**Spec realization:** Sub-C `PublicBrandPage.tsx` Events tab body keeps `pastEvents` section; Trips tab body keeps `pastTrips` section. No new tab added.

### Q14 — Upcoming tab cap

**SPEC DECISION:** **Cap 30 items + cursor-load-more.** The Upcoming tab fetches the next 30 chronologically-interleaved items (events + trips + experiences) sorted by their `start_at` / `start_date` / `next_occurrence_at` ascending. When the user reaches the bottom, a "Load more" CTA fetches the next 30. No infinite-scroll auto-trigger in v1.

**Rationale:** Prevents unbounded JSONB query cost (since experiences sort by JSON sub-field). Cursor-pagination is well-understood on the Mingla codebase (matches `useInfiniteQuery` patterns).

**Spec realization:** Sub-C `pg_public_brand_upcoming(p_brand_slug TEXT, p_cursor_at TIMESTAMPTZ, p_limit INTEGER)` RPC (see §Sub-C.4). Default `p_limit = 30`, default `p_cursor_at = now()`. Returns 30 + 1 lookahead row to determine "has more".

### Q15 — venueCategory inference for AI parsers

**SPEC DECISION:** **Infer by tool type at edge-function entry; pass as `temporaryCategory` to OpenAI; NEVER write to `brands.venue_category`.** `parse-restaurant-menu` always sets `temporaryCategory = 'restaurant'` for the OpenAI prompt. `parse-play-activities` always sets `temporaryCategory = 'play'`. Brand's `venue_category` column is read-only from these endpoints (used as primary source if present, falls back to `temporaryCategory` if null). Edge functions DO NOT update `brands.venue_category` based on parser output.

**Rationale:** Universal parser access (operator decision Q1 / D8) without polluting brand state with implicit category writes. Brands set their venue category explicitly via the (future) venue-claim flow or BrandEditView, never via AI side-effect.

**Spec realization:** Sub-D `parse-restaurant-menu/index.ts` + `parse-play-activities/index.ts` edits include the `temporaryCategory` literal at the OpenAI call site; no `UPDATE brands SET venue_category = ...` anywhere.

---

## Top-level scope, non-goals, assumptions

### Scope (in)

1. Decommission `brands.kind` column + `brands_kind_check` constraint via 4-stage safe-deploy plan.
2. Delete all 22 brand-kind-coupled product-code surfaces catalogued in GAP_AUDIT D1–D12.
3. Unify brand creation into single 4-step `BrandCreationFlow` (replacing persona-fork + TripBrandWizard).
4. Make business app Hub tabs + public brand page tabs DATA-DRIVEN (offering-count-based).
5. Universalize AI experience generators (parse-restaurant-menu, parse-play-activities, agentTools create_experience).
6. Reframe venue claim from "verify-to-sell gate" to "claim-for-badge upgrade".
7. Add JSON-sub-field schema for experiences (`theme.experience_meta.next_occurrence_at`, `theme.experience_meta.venue_text`).
8. Add public-page experience RPC (`pg_public_experiences_by_brand`) and unified Upcoming RPC (`pg_public_brand_upcoming`).
9. Rewrite 3 RLS policies + 3 public views + 2 SECURITY DEFINER RPCs to drop kind predicates.
10. Replace ORCH-0855 strict-grep adversarial gates + ORCH-0963 strict-grep C1/C3 with new META-ORCH-0972 gates enforcing `I-BRAND-UNIVERSAL-AUTHORING` + `I-PUBLIC-PAGE-DATA-DRIVEN-TABS` + `I-HUB-TABS-DATA-DRIVEN`.
11. Rebuild admin Venue Claims dashboard with 3-tab structure (Pending review / Verified / Rejected) and replace `.eq("kind","physical")` filter.

### Non-goals (explicit)

- **Consumer app (`app-mobile/`)** — Dim 12 audit confirmed brand-kind-agnostic. Sub-A through Sub-D touch zero consumer files. Phase 5 tester verifies no regression.
- **Experience recurrence beyond one-time** (Q12 deferred).
- **Unified "Past" tab on public brand page** (Q13 deferred).
- **Infinite scroll on Upcoming tab** (Q14 cursor-paginated only).
- **AI parser auto-classification of brand venue category** (Q15 — `temporaryCategory` is request-scoped only).
- **Replacement venue-discovery moderation for unclaimed brands.** Operator stated "zero live brands at INTAKE"; visibility moderation is OUT of scope and tracked as a follow-up if needed.
- **Stripe Connect onboarding copy or behaviour changes** (ORCH-0954/0955 are unrelated active workstreams).
- **Marketing hub copy or backend changes** (Dim 11 false-positives confirmed in audit).
- **Adding paid recurrence to home rung 1** beyond the `max(tier.price) > 0 AND stripeStatus !== 'active'` predicate.
- **Backfilling `brands.kind` archive snapshot** if zero live brands (verified at Sub-C migration time).

### Assumptions

1. Zero live brands at INTAKE (operator-stated). Sub-C Stage 4 verifies via `SELECT count(*) FROM brands WHERE deleted_at IS NULL;` before column drop. If non-zero, archive snapshot per CLOSE Step 5h.
2. ORCH-0963 surfaces (`pg_public_trips_by_brand` RPC at line 46 brand-kind guard, `BusinessPublicBrandViewRow.kind` TS union, `BusinessPublicEventViewRow.brand_kind` SELECT field, ORCH-0963 strict-grep gate) are present in this worktree post-rebase (verified at Phase 2 design ingest).
3. Phase 2 design at commit `8311fa89b` is the binding visual + copy + flow contract. This SPEC defines the contracts; it does NOT redesign.
4. JSONB queries on `theme.experience_meta ->> 'next_occurrence_at'` will be performant for sub-100-experience-per-brand scale; functional GIN index added preemptively per Sub-C Stage 0.

---

## Cross-Surface Impact (Phase 2.5)

Mandatory per orchestrator SPEC contract. Same source-of-truth as the Phase 2 design SCREEN_INVENTORY cross-platform table.

| Surface | In scope? | What changes user-visibly here | Files touched here | Parity? |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NO | Nothing — consumer app reads `events`/`trips` tables directly, never `brands.kind` | None | N/A — Phase 5 tester verifies zero regression |
| Consumer Android (`app-mobile/` Android) | NO | Same | None | Same |
| Buyer/anonymous Web (`mingla-business/` `/b/{slug}`, `/e/`, `/checkout/`) | **YES** | Public brand page tabs become data-driven; new `<ExperienceMiniCard>`; Upcoming tab interleaves all 3 offering types; "Verified location" pill replaces today's no-pill UX | `src/components/brand/PublicBrandPage.tsx`, `src/services/publicEventsService.ts`, new `<ExperienceMiniCard>` | Shared code with business-web-preview |
| Business iOS (`mingla-business/` iOS) | **YES** | Persona picker GONE; unified `BrandCreationFlow`; data-driven hub tabs + "Get started" placeholder; OfferingChooser on home empty state; address always-optional in BrandEditView; AI parsers universally accessible; trip creation universally accessible; experience creation has new wizard with venue field; venue claim is opt-in opportunity | All Sub-A + Sub-B files; iOS-business is the primary surface | iOS+Android share React Native code; manual parity per platform = automatic |
| Business Android (`mingla-business/` Android) | **YES** | Same as iOS; tested for hardware-back parity in BrandCreationFlow + ExperienceCreatorWizard | Same | Same |
| Admin Web (`mingla-admin/`) | **YES** | Venue Claims dashboard gets 3-tab structure (Pending review / Verified / Rejected); filter changes from `.eq("kind","physical")` to claim_status-based; row actions unchanged | `mingla-admin/src/services/adminClaimsService.js`, admin Venue Claims page component | Admin is its own React 19 + Vite stack; not shared with mingla-business |
| Business Web preview (`mingla-business/` dev/web) | **YES** | Same as business-iOS/Android (mingla-business is one Next.js codebase with web preview) | Same as Business iOS | Shared code → automatic parity |

**Manual-parity surfaces requiring separate success criteria per surface:**

- iOS-business vs Android-business: RN code is shared; per-platform criteria only where native modules differ (Haptics, AsyncStorage). All success criteria are tagged SC-N (single criterion, parity automatic) UNLESS a native-module path is involved (then SC-N-iOS / SC-N-Android).
- Admin web: completely separate React 19 stack; admin success criteria use SC-A-N prefix.
- Buyer/anon web: shares mingla-business code with business surfaces; buyer-specific criteria use SC-PUB-N prefix to make the anonymous-context bar explicit.

---

## Invariants (preserved, introduced, superseded)

### Preserved (MUST NOT regress)

- **I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE** (ORCH-0947) — when rewriting `pg_public_trips_by_brand`, the canonical sold formula `tickets.status IN ('valid','used','transferred')` joined via `ticket_types.event_id` STAYS unchanged.
- **I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE** (ORCH-0859) — `/e/*` events-only, `/t/*` trips-only, `/exp/*` experiences-only. ORCH-0963 strict-grep C4 enforces; META-ORCH-0972 PRESERVES it.
- **I-PROPOSED-J — Zustand persist holds IDs not server records** (ORCH-0742) — none of the new hooks (`useHubVisibleTabs`, `useHubInitialTab`, `useBrandOfferingCounts`, `useExperienceVenueDefault`) persist server data to Zustand. AsyncStorage holds last-visited tab name (string) only.
- **All 14 constitutional rules** (no dead taps, one owner per truth, etc.) — verified per surface in success criteria.

### Introduced on CLOSE

- **I-BRAND-UNIVERSAL-AUTHORING** — every brand can author every offering type (event, trip, experience) without kind or claim-status gating in product code. Enforced by `orch-0972-no-brand-kind-reads.mjs` strict-grep gate (Sub-D §F.2).
- **I-PUBLIC-PAGE-DATA-DRIVEN-TABS** — `PublicBrandPage.tsx` tab visibility derives from offering counts, not from `brand.kind`. Enforced by `orch-0972-data-driven-tabs.mjs` (Sub-D §F.1).
- **I-HUB-TABS-DATA-DRIVEN** — business app Hub tab visibility derives from offering counts, not from `brand.kind`. Same gate as above.
- **I-VENUE-CLAIM-OPTIONAL** — venue claim is an opt-in discovery upgrade, never an authoring gate. No code path may early-return on `claim_status !== 'verified'` for any authoring or publish operation. Enforced by the no-brand-kind-reads gate (extended to also forbid `claim_status` early-returns in authoring code paths).
- **I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED** — N/A (no external APIs touched).

### Superseded on CLOSE

- **I-PROPOSED-TR1-PERSONA-INTERFACE** (ORCH-0855) — `PersonaDef.id` 3-id union is deleted with PersonaPickerCards. Adversarial check A-07 deletion is in Sub-D §F.1.
- **I-PROPOSED-TR1-KIND-IMMUTABLE** (ORCH-0855) — `brands.kind` ceases to exist; immutability is moot. Adversarial check A-13 deletion is in Sub-D §F.1.
- **I-PUBLIC-BRAND-KIND-BRANCHED** (ORCH-0963, ACTIVE 2026-05-25 with ~24-hour lifetime) — superseded by I-PUBLIC-PAGE-DATA-DRIVEN-TABS. ORCH-0963 strict-grep C1+C3 deletion is in Sub-D §F.2.
- **DEC-152** (TopSheet extended to UniversalCreatorSheet) — preserved; the carve-out is unaffected.
- **DEC-161** (brands.kind immutable post-create for trip_planner) — superseded.
- Memory rules `feedback_brand_kind_immutable_post_create.md` + `feedback_persona_picker_locked_interface.md` — flipped to SUPERSEDED status on CLOSE (orchestrator CLOSE Step 5).

---

## Implementation order (cross-sub-spec)

The 4 sub-specs execute in this order. Each sub gets its own commit + PR-able scope, but they all live on the same per-ORCH branch and merge in ONE PR per WORKTREE_STRATEGY rule 5.

| Order | Sub-spec | Owner | Operator gates | Strict-grep allowlist | DB push? |
|---|---|---|---|---|---|
| 1 | **Sub-A** — Backend gates + early-returns deletions (no DB schema change, no migration apply) | Codex `implementor-mingla` | None | Add `parse-restaurant-menu`, `parse-play-activities`, `_shared/agentTools.ts` to `ORCH_0972_BACKEND_ALLOWLIST` in same commit | No |
| 2 | **Sub-B** — UI flow redesign (BrandCreationFlow + OfferingChooser + ExperienceCreatorWizard + persona-picker delete + home + hub + brand edit + admin Venue Claims) | Codex `implementor-mingla` | None | N/A (no backend touch) | No |
| 3 | **Sub-C** — Public brand page + DB schema enrichment + view + RLS + RPC rewrites + ORCH-0963 RPC kind guard removal (Stages 0/2/3 of safety plan in ONE migration commit) | Codex `implementor-mingla` | **Operator runs `supabase db push --linked` BEFORE orchestrator deploys edge functions or tester begins.** | Add all new migration files to `ORCH_0972_BACKEND_ALLOWLIST` | YES — single migration commit `20260729000000_meta_orch_0972_*.sql` |
| 4 | **Sub-D** — Edge function gate deletions deploy + strict-grep gate rewrites (delete ORCH-0855 + reshape ORCH-0963 + add 2 new META-ORCH-0972 gates) + parser regate per Q15 | Codex `implementor-mingla` | None | Same allowlist append | No new DB; orchestrator deploys edge functions per protocol |
| 5 | **Stage 4 follow-up migration** — `DROP CONSTRAINT brands_kind_check` + `DROP COLUMN brands.kind` (ONE release cycle after Sub-A through Sub-D ship live; ships as a follow-up commit/PR on the SAME per-ORCH branch only if scope allows, OR a new ORCH if operator decides) | Codex `implementor-mingla` | **Operator runs `supabase db push --linked` for `20260730000000_meta_orch_0972_drop_brand_kind.sql`.** Optional 14-day archive snapshot if any live rows. | Allowlist entry for the drop migration | YES |

**Per-stage tester dispatch** between every pair: Claude `mingla-tester` runs TARGETED scope on each sub-spec before the next starts. CONDITIONAL PASS only allowed for documented carry-overs.

---

# Sub-spec A — Backend gates + product-code early-return deletions

**Scope:** Stage 1 steps 1–8 of DATA_MODEL_AUDIT §"DROP COLUMN safety plan" + the 5 trivial product-code gate deletions. No DB schema change. No migration applied. Edge function `_shared/` source edits ship in Sub-A but the `supabase functions deploy` happens in Sub-D after the strict-grep gates are also updated (so one deploy covers both source + gate changes).

## A.1 Files touched

| Path | Change | Lines |
|---|---|---|
| `mingla-business/src/utils/brandAuthoringGate.ts` | **DELETE entire file** | whole file |
| `mingla-business/src/services/eventDrafts.ts` | DELETE the `brandAuthoringGate(...)` callsite + its import | line 172 + matching import line |
| `mingla-business/src/services/tripsService.ts` | DELETE the `brandAuthoringGate(...)` callsite + its import | line 441 + matching import line |
| `mingla-business/app/trip/create.tsx` | DELETE the `if (currentBrand.kind !== "trip_planner") setErrorMessage; return;` block | line 52 (block) + line 9 (doc comment update per COPY_INVENTORY) |
| `mingla-business/app/trip/[id]/edit.tsx` | DELETE the `if (currentBrand.kind !== "trip_planner") return;` early-return inside the client-only-trip-ID migration `useEffect` | line 67 |
| `mingla-business/src/utils/homeNextAction.ts` | REGATE rung 2 (replace kind-branched copy block with single OfferingChooser render trigger); DELETE rung 4 entirely; UPDATE rung 1 trigger predicate from `stripeStatus !== 'active'` to `hasAnyDraftPaidOffering(brand) && stripeStatus !== 'active'` | rung 1: lines 33–60; rung 2: lines 60–90; rung 4: lines 112–123 |
| `mingla-business/src/components/hub/experiences.tsx` (path per GAP_AUDIT D6) | DELETE/REGATE 5 kind gates | lines 292, 307, 319, 331, 345 |
| `mingla-business/src/utils/canGenerateExperiencesFromMenu.ts` | REGATE from `brand.kind === 'physical'` to `brand.venue_category === 'restaurant'` (read brand row, NOT brand.kind) | whole gate logic |
| `mingla-business/src/utils/canGenerateExperiencesFromActivities.ts` | REGATE from `brand.kind === 'physical'` to `brand.venue_category === 'play'` | whole gate logic |
| `supabase/functions/parse-restaurant-menu/index.ts` | DELETE the kind gate (line 155) + claim_status gate (line 161); DROP `kind, claim_status` from `.select()` (line 144) — keep `venue_category`; ADD `temporaryCategory = 'restaurant'` literal at OpenAI call site per Q15 | lines 144 + 155 + 161 + OpenAI call site |
| `supabase/functions/parse-play-activities/index.ts` | Same shape | lines 151 + 162 + 176 + OpenAI call site |
| `supabase/functions/_shared/agentTools.ts` | DELETE the `if (brand.kind !== "physical") throw ToolError(...)` gate | lines 412 + 421 (error message string is part of same block) |

## A.2 Type-level contracts to update

### `mingla-business/src/services/brandsService.ts:88-128` — `CreateBrandInput`

**Before:**
```ts
export interface CreateBrandInput {
  name: string;
  bio: string | null;
  slug?: string;
  kind: "physical" | "popup" | "trip_planner";   // line 95
  // ...other fields
}
```

**After:**
```ts
export interface CreateBrandInput {
  name: string;
  bio: string | null;
  slug?: string;
  // kind field DELETED — universal authoring per I-BRAND-UNIVERSAL-AUTHORING
  // ...other fields
}
```

Also DELETE `kind: input.kind,` from the INSERT mapping at line 128.

### `mingla-business/src/services/brandMapping.ts`

5 line-edits per GAP_AUDIT D1:
- Lines 47–48: `kind` field in TS Brand type definition — DELETE
- Lines 91–92: `kind` field in insert mapper — DELETE
- Lines 240–243: `kind` field in update mapper — DELETE
- Line 311: `kind` field in row-to-domain mapper — DELETE
- Line 395: `kind` field in domain-to-row mapper — DELETE

### `mingla-business/src/utils/brandPatch.ts:38-40`

**Before:**
```ts
if (draft.kind !== original.kind) {
  patch.kind = draft.kind;
}
```

**After:** DELETE the 3-line block entirely. Verified at line 38–39 in current source (`grep -n "kind" src/utils/brandPatch.ts` returns lines 38 + 39).

### `mingla-business/src/hooks/useBrands.ts` — `useCreateBrand`

DROP `kind` from the mutation input type. Hook signature stays otherwise unchanged.

## A.3 Tests deleted (per SCREEN_INVENTORY row 7)

| Path | Reason |
|---|---|
| `BrandSwitcherSheet.personaFork.test.ts` | persona-fork mode deleted |
| `BrandSwitcherSheet.personaFork.ve1.test.ts` | same |
| `BrandSwitcherSheet.personaFork.ve2.test.ts` | same |
| `TripBrandWizard.test.ts` | wizard component deleted |
| `brandsService.tripPlannerKind.test.ts` | kind contract removed |

These deletions count as "diff deletes lines from any test file" per feedback rule `feedback_close_commit_precommit_checks.md` — the CLOSE commit body MUST include `[TEST-MOD-APPROVED META-ORCH-0972]` (or per-sub `[TEST-MOD-APPROVED META-ORCH-0972 Sub-A]`).

## A.4 New invariant assertions in product code (for static-analysis discipline)

Add a single-line comment above each surface that previously had a kind gate, citing the invariant + ORCH:

```ts
// I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972) — no kind gate.
```

Add ONLY where a future reader might wonder "why no gate?" (top of `parse-restaurant-menu/index.ts`, top of `parse-play-activities/index.ts`, top of `_shared/agentTools.ts` create_experience tool def, top of `eventDrafts.ts` createEventDraft function, top of `tripsService.ts` createTrip function). Do NOT spam every line.

## A.5 Success criteria (Sub-A)

- **SC-A-1** Compiling `mingla-business/` after Sub-A diffs has ZERO type errors and ZERO references to `CreateBrandInput.kind`, `brand.kind` (anywhere except types yet-to-be-removed), or `currentBrand.kind` in active product code.
- **SC-A-2** `grep -rn "brand\.kind\|brands\.kind\|currentBrand\.kind" mingla-business/src/ mingla-business/app/` returns ZERO hits in active product code (allowlisted: type definitions in `brand.ts` lines 200–210 are still present pending Sub-C; deleted in Sub-C).
- **SC-A-3** Edge function source files at `supabase/functions/parse-restaurant-menu/index.ts`, `supabase/functions/parse-play-activities/index.ts`, `supabase/functions/_shared/agentTools.ts` have ZERO `brand.kind` references.
- **SC-A-4** All 5 deleted test files are gone from `mingla-business/__tests__/` (verified by `find ... -name "personaFork*" -o -name "TripBrandWizard.test*" -o -name "*tripPlannerKind*"` returning empty).
- **SC-A-5** Existing passing tests still pass (`yarn workspace mingla-business jest`).
- **SC-A-6** Type check `yarn workspace mingla-business tsc --noEmit` is clean (no `any` introductions; no `@ts-ignore` introductions).
- **SC-A-7** **Implementor regression test** (per CLOSE Step 0.5): `mingla-business/__tests__/services/eventDrafts.universalAuthoring.test.ts` — assert `createEventDraft({ brand: { kind: 'physical', claim_status: 'none', ... } })` succeeds (returns draft row, does NOT throw `BrandAuthoringGateError`). Fails on revert when the gate is restored.

## A.6 Test cases (Sub-A — T-01 through T-07)

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-01 | Universal event draft creation | `createEventDraft` called against a brand with any `claim_status` value | Returns draft row; no `BrandAuthoringGateError` | Service |
| T-02 | Universal trip draft creation | `tripsService.createTrip` against any brand | Returns trip row; no early-throw | Service |
| T-03 | Universal `/trip/create` route entry | Navigate to `/trip/create` as any brand (popup/physical/trip_planner) | Renders form; no setErrorMessage redirect | Component / Navigation |
| T-04 | `/trip/[id]/edit.tsx` migration effect runs for any brand | Open trip edit page with a client-only-ID trip as a popup brand | Effect runs; trip persists | Component / Effect |
| T-05 | `parse-restaurant-menu` accepts any brand | POST with brand_id of a `kind='popup'` brand | 200 OK with parsed JSON; no `BRAND_NOT_ELIGIBLE` error | Edge function |
| T-06 | `parse-play-activities` accepts any brand | Same shape, different endpoint | 200 OK | Edge function |
| T-07 | Home rung 1 (Stripe inactive) only fires with paid draft | Brand with Stripe inactive + 0 paid drafts | Rung 1 does NOT fire (rung 3 or OfferingChooser fires instead per state) | Hook / Component |

---

# Sub-spec B — UI flow redesign + admin Venue Claims rebuild

**Scope:** Stage 1 steps 9–15 + step 18a–18c of DATA_MODEL_AUDIT §"DROP COLUMN safety plan" + all client UX redesign per USER_JOURNEYS Design Areas 1–4 + 7–8 + 9-client-side.

No DB schema change, no edge function source change, no RLS change. Pure client work + 1 admin web file change.

## B.1 New components

### B.1.a `<OfferingChooser>` (Design Area 2)

**File:** `mingla-business/src/components/brand/OfferingChooser.tsx` (NEW)

**Props interface:**
```ts
interface OfferingChooserProps {
  headline?: string;             // optional — defaults to "What do you want to make first?"
  subhead?: string;               // optional — defaults to "Mix and match anytime."
  variant?: 'home-empty' | 'hub-getstarted' | 'brand-create-welcome';
  onSelect: (offering: 'event' | 'trip' | 'experience') => void;
  testID?: string;
}
```

**Render contract:**
- Three `<Pressable>` buttons in a column on mobile, row on web ≥ md breakpoint.
- Each button: `<GlassCard>` wrapper, `<Icon>` (Calendar / Map / Sparkles), bold label ("Event"/"Trip"/"Experience"), subhead (e.g., "One night, one place."), no kind reference anywhere.
- All 3 buttons always render — never gated.
- Each button has `accessibilityRole="button"`, `accessibilityLabel` matching label + subhead, minimum 44pt touch target.
- Press triggers `Haptics.impactAsync(ImpactFeedbackStyle.Medium)` then `onSelect(...)`.
- Buttons share equal width; no priority hierarchy.

**Copy per COPY_INVENTORY lines 30–37:**
- Event: "Event" / "One night, one place."
- Trip: "Trip" / "Multi-day getaway."
- Experience: "Experience" / "Recurring or evergreen."

**onSelect dispatch table:**
- `'event'` → router.push(`/event/create`)
- `'trip'` → router.push(`/trip/create`)
- `'experience'` → router.push(`/experience/create`) (new route — see B.1.c)

### B.1.b `<BrandCreationFlow>` (Design Area 1)

**File:** `mingla-business/src/components/brand/BrandCreationFlow.tsx` (NEW)

**Props interface:**
```ts
interface BrandCreationFlowProps {
  onComplete: (newBrandId: string) => void;
  onCancel?: () => void;
}
```

**State machine (4 steps):**

```
Step 1: Identity (name + bio + slug auto-derive)
  → Continue → Step 2

Step 2: Address (optional)
  → Skip → Step 3 (address stays NULL)
  → Continue (validated) → Step 3 (address persisted to brand row)

Step 3: Cover (optional — opens existing <BrandCoverPickerSheet>)
  → Skip → Step 4
  → Done → Step 4

Step 4: Welcome + OfferingChooser
  → onSelect(...) → calls onComplete(brandId) + router.push(...)
```

**Key behavioral details:**
- Brand row is INSERTed at the end of Step 1 (after Continue) so subsequent steps update the same row. Slug-collision toast surfaces here using existing `SlugCollisionError` handler.
- Address validation in Step 2: free-text, no Google Places autocomplete in v1 (per Q6 — autocomplete is a Future ORCH).
- Cover picker in Step 3 reuses existing `<BrandCoverPickerSheet>`; do not invent new picker UI.
- All 4 steps are full-screen sheets (or modal on web ≥ md); back navigation between steps preserves form state in React local state.
- Hardware back on Android: Step 1 confirms "Discard new brand?"; Steps 2/3 navigate to previous step; Step 4 hard-exits to wherever onComplete routes to.

**Copy per COPY_INVENTORY lines 13–38.** Implementor reads COPY_INVENTORY exactly.

### B.1.c `<ExperienceCreatorWizard>` (Design Area 6)

**File:** `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (NEW)

**Route:** new `mingla-business/app/experience/create.tsx` mounts this wizard.

**Props interface:**
```ts
interface ExperienceCreatorWizardProps {
  brandId: string;             // required — supplied by route from useCurrentBrand
  onComplete: (newExperienceId: string) => void;
  onCancel?: () => void;
}
```

**State machine (5 steps):**

```
Step 1: Identity (title + description + optional menu/activities shortcut card)
Step 2: Venue (always asked; pre-filled from brand.address if present per Q7)
Step 3: When (next_occurrence_at single timestamp per Q12 — "One-time only" recurrence label)
Step 4: Pricing (reuses existing pricing flow)
Step 5: Cover (reuses existing BrandCoverPickerSheet)

Final: Publish or Save as draft
```

**Step 1 shortcut cards** (only render when brand's `venue_category === 'restaurant'` or `'play'`):
- "Upload a menu" card → routes to `parse-restaurant-menu` flow with `temporaryCategory='restaurant'`
- "Paste your activities" card → routes to `parse-play-activities` flow with `temporaryCategory='play'`
- If `brand.venue_category` is null, neither card renders (per Q15 — no implicit category inference at brand level).

**Step 2 venue field:**
- Always visible — never gated.
- If `brand.address` non-empty: field pre-filled with brand.address. Helper text: "Pre-filled from your brand address. Edit if this experience is somewhere else."
- Optional `<Checkbox label="Also save this as my brand's address" />` shown ONLY when brand.address is currently null AND user types a value. Checked = field write-through to `brands.address` on next publish/save.

**Step 3 when:**
- Single timestamp picker (date + time).
- Recurrence label per COPY_INVENTORY line 121: shows "Recurrence" with disabled "One-time only" dropdown (only option in v1). Phase 4 implementor MUST render the dropdown disabled to signal future recurrence is coming; this is intentional and not a layout bug.

**Persisted shape (theme JSON):**
```jsonc
{
  "experience_meta": {
    "next_occurrence_at": "2026-06-15T19:00:00.000Z",
    "venue_text": "Soho Lounge"
  }
}
```

Other `theme.*` fields (cover, colors, copy) are unchanged.

## B.2 Files modified (B-level edits)

| Path | Change |
|---|---|
| `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | DELETE persona-fork mode (the 3-card chooser). Sheet now contains only the brand-list mode + "Create brand" CTA that opens `<BrandCreationFlow>` |
| `mingla-business/src/components/brand/PersonaPickerCards.tsx` | **DELETE entire file** |
| `mingla-business/src/components/brand/PersonaForkSheet.tsx` | **DELETE entire file** |
| `mingla-business/src/components/brand/TripBrandWizard.tsx` | **DELETE entire file** |
| `mingla-business/src/components/brand/BrandEditView.tsx` | DELETE SECTION B-2 kind picker (lines 541–664 + styles block); address always-visible per D2/D4; INSERT new "Claim a venue" affordance at top per Design Area 7 |
| `mingla-business/src/components/brand/VenueClaimStatusBanner.tsx` | DELETE the `if (brand.kind !== 'physical') return null;` gate at line 28; banner now renders for any brand with `claim_status !== 'none'`; render 3 copy variants per COPY_INVENTORY lines 134–136 |
| `mingla-business/src/utils/venueClaimBannerLogic.ts` | DELETE the kind predicate at line 25; bannerLogic returns based on `claim_status` alone |
| `mingla-business/app/(tabs)/hub/_layout.tsx` | REWRITE tab bar to render based on `useHubVisibleTabs()` result; mount "Get started" placeholder tab when all 3 counts are zero; persist last-visited tab via `useHubInitialTab()` |
| `mingla-business/app/(tabs)/hub/trips.tsx` | DELETE the `kind !== 'trip_planner'` empty-state block (line 161); body now renders standard upcoming-trips list |
| `mingla-business/app/(tabs)/hub/experiences.tsx` | DELETE all 5 kind gates (lines 292, 307, 319, 331, 345); add Get-started tab body or empty-state-with-CTA per Design Area 4 |
| `mingla-business/src/utils/homeNextAction.ts` | Rewrite per A.1 row; rung 2 now triggers `<OfferingChooser variant="home-empty">` instead of branching on kind |
| `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` | UPDATE-COPY comment at lines 79–80 per COPY_INVENTORY (or DELETE comment) |
| `mingla-business/src/types/brand.ts` | UPDATE-COPY comment block at lines 200–210 (kind union immutability comment); the `Brand.kind` type field stays as `string` literal union until Sub-C drops it from runtime; mark as deprecated with JSDoc `@deprecated META-ORCH-0972 — kind is removed from DB in Sub-C; this field will be deleted next.` |
| `mingla-business/app/trip/create.tsx` | UPDATE-COPY line 9 doc comment per COPY_INVENTORY |

## B.3 New hooks

### B.3.a `useBrandOfferingCounts(brandId: string)` (Theme E shared)

**File:** `mingla-business/src/hooks/useBrandOfferingCounts.ts` (NEW)

**Signature:**
```ts
interface BrandOfferingCounts {
  events: number;       // count from events table where brand_id matches AND event_type='event'
  trips: number;        // count from events table where brand_id matches AND event_type='trip'
  experiences: number;  // count from events table where brand_id matches AND event_type='experience'
}

function useBrandOfferingCounts(brandId: string | null): UseQueryResult<BrandOfferingCounts>;
```

**Query key:** `['brand', brandId, 'offeringCounts']` — added to existing brand-scoped query key factory.
**staleTime:** `30_000` (30s) — counts don't change rapidly.
**enabled:** `!!brandId`.
**Implementation:** single Supabase RPC call to a NEW `pg_brand_offering_counts(p_brand_id uuid)` RPC. Sub-C defines the RPC (Stage 0 — additive).

### B.3.b `useHubVisibleTabs(brandId)` + `useHubInitialTab(brandId, visibleTabs)`

**File:** `mingla-business/src/hooks/useHubTabs.ts` (NEW — exports both)

**Signatures:**
```ts
type HubTabName = 'getstarted' | 'events' | 'trips' | 'experiences';

function useHubVisibleTabs(brandId: string | null): {
  data: HubTabName[] | undefined;        // ordered: ['events','trips','experiences'] subset, OR ['getstarted'] when all counts 0
  isLoading: boolean;
};

function useHubInitialTab(brandId: string | null, visibleTabs: HubTabName[]): HubTabName | null;
```

**`useHubVisibleTabs` rules:**
- Reads `useBrandOfferingCounts(brandId)`.
- If all 3 counts are zero → returns `['getstarted']`.
- Otherwise returns subset of `['events','trips','experiences']` where count > 0, in that fixed order.
- Returns `undefined` (`isLoading: true`) while counts pending — UI shows shimmer pills.

**`useHubInitialTab` rules:**
- Reads `AsyncStorage.getItem('@mingla/hub/lastTab')` synchronously via cached value (set on mount).
- If stored tab name is in `visibleTabs` → returns it.
- If stored tab name is NOT in visibleTabs (e.g., user had Trips open last time but now has zero trips) → returns first tab in `visibleTabs`.
- If no stored value → returns `'events'` if visible, else first tab in `visibleTabs`.
- Tab bar onChange handler writes `AsyncStorage.setItem('@mingla/hub/lastTab', tabName)` (fire-and-forget; no error toast).

### B.3.c `useExperienceVenueDefault(brandId)`

**File:** `mingla-business/src/hooks/useExperienceVenueDefault.ts` (NEW)

**Signature:**
```ts
function useExperienceVenueDefault(brandId: string | null): {
  defaultVenue: string;   // brand.address ?? ''
  hasPrefill: boolean;    // !!brand.address
};
```

**Implementation:** reads `useCurrentBrand()` (existing hook); returns `{ defaultVenue: brand?.address ?? '', hasPrefill: !!brand?.address }`. Synchronous-on-render after `useCurrentBrand` resolves. No new query.

## B.4 Admin web — Venue Claims rebuild (Design Area 8 + Q10)

| Path | Change |
|---|---|
| `mingla-admin/src/services/adminClaimsService.js` | Line 37: DELETE `.eq("kind", "physical")` filter. ADD new functions `listPendingClaims()`, `listVerifiedClaims()`, `listRejectedClaims()` each filtering by `claim_status` |
| `mingla-admin/src/pages/VenueClaims.jsx` (or whatever the admin Venue Claims page path is — implementor confirms during ingest) | Replace single-list UI with 3-tab structure per COPY_INVENTORY lines 170–179. Default tab = "Pending review" |

Admin uses Tailwind v4 + Framer Motion + React Context; do NOT introduce React Query or Zustand. Existing admin patterns apply.

## B.5 Success criteria (Sub-B)

- **SC-B-1** Brand creation: tapping "Create brand" in `BrandSwitcherSheet` opens `BrandCreationFlow` Step 1; no persona picker renders anywhere. (iOS-business + Android-business + business-web-preview)
- **SC-B-2** `BrandCreationFlow` 4-step flow: each step renders the exact copy in COPY_INVENTORY; back-navigation preserves form state; Step 2 Skip persists null address; Step 4 OfferingChooser routes to the correct create page per selection.
- **SC-B-3** Persona picker artifacts (`PersonaPickerCards.tsx`, `PersonaForkSheet.tsx`, `TripBrandWizard.tsx`) do NOT exist in the file tree.
- **SC-B-4** `BrandEditView` shows address input always (no kind gate); SECTION B-2 kind picker is GONE; "Claim a venue" affordance renders at top with COPY_INVENTORY copy.
- **SC-B-5** Home empty state renders `<OfferingChooser variant="home-empty">` when rung 2 fires (per refactored `homeNextAction.ts`); rung 1 fires only when brand has paid draft + Stripe inactive; rung 4 (physical-no-address) does NOT exist.
- **SC-B-6** Hub `_layout.tsx`: when all 3 counts are 0, only "Get started" tab renders with `<OfferingChooser variant="hub-getstarted">`; when counts > 0, the correct subset of Events/Trips/Experiences renders; last-visited tab is sticky across app reloads.
- **SC-B-7** Hub `trips.tsx`: opens for ANY brand kind without the "Trips are for trip-planner brands" empty state.
- **SC-B-8** Hub `experiences.tsx`: opens for ANY brand; no kind-branched dead-ends; shortcut cards (menu/activities) appear when `brand.venue_category` matches.
- **SC-B-9** Experience creation: navigating to `/experience/create` mounts `ExperienceCreatorWizard`; Step 2 venue pre-fills from brand.address when present; "Also save as my brand's address" checkbox appears when brand.address is null AND user types.
- **SC-B-10** `<VenueClaimStatusBanner>` renders for ANY brand with `claim_status !== 'none'`; 3 copy variants (pending/verified/rejected) match COPY_INVENTORY.
- **SC-A-11 (admin)** Admin Venue Claims page: 3 tabs default to "Pending review"; tab switching loads correct claim_status filter; empty states per COPY_INVENTORY.
- **SC-B-12** Type check `yarn workspace mingla-business tsc --noEmit` is clean; type check `yarn workspace mingla-admin tsc --noEmit` (or admin's equivalent) is clean.
- **SC-B-13** **Implementor regression test**: `mingla-business/__tests__/hooks/useHubVisibleTabs.test.tsx` — assert empty brand returns `['getstarted']`; brand with only trips returns `['trips']`; brand with all 3 returns `['events','trips','experiences']`. Fails on revert when the kind-branched layout returns.
- **SC-B-14** **Implementor regression test**: `mingla-business/__tests__/components/BrandCreationFlow.test.tsx` — assert all 4 steps render copy from COPY_INVENTORY; Step 2 skip persists null address; Step 4 onSelect dispatches correctly.

## B.6 Test cases (Sub-B — T-08 through T-22)

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-08 | BrandCreationFlow Step 1 happy path | Type "Test Brand" name, "" bio | Step 1 Continue enabled; tap → brand row INSERTED with slug | Component+Service |
| T-09 | BrandCreationFlow Step 2 skip | Step 1 done, tap "Skip for now" | brand.address remains null | Component |
| T-10 | BrandCreationFlow Step 2 continue | Type "12 Soho Square" + tap Continue | brand.address persisted as exact string | Component+Service |
| T-11 | BrandCreationFlow Step 4 select event | Tap "Event" button | router.push('/event/create') called | Component+Nav |
| T-12 | BrandCreationFlow back nav preserves state | Step 1→2→back | Step 1 form preserved | Component |
| T-13 | Hub tab visibility all empty | Brand with 0 events, 0 trips, 0 experiences | Only "Get started" tab visible; OfferingChooser renders in tab body | Hook+Component |
| T-14 | Hub tab visibility partial | Brand with 5 events, 0 trips, 0 experiences | Only "Events" tab visible | Hook+Component |
| T-15 | Hub last-visited sticky | Open Trips tab, force-quit, reopen | Hub opens to Trips tab | Hook+Storage |
| T-16 | Hub last-visited fallback | User had Experiences open; experiences now 0 | Hub opens to first remaining tab (Events or Trips) | Hook |
| T-17 | Home rung 1 with paid draft + Stripe inactive | Brand state matches | Rung 1 copy "Connect Stripe to take payments" renders | Hook+Component |
| T-18 | Home rung 1 with free draft + Stripe inactive | Brand has only free-tier drafts, Stripe inactive | Rung 1 does NOT fire; rung 3 (finish draft) fires | Hook |
| T-19 | Home rung 4 deleted | Physical brand with null address (legacy data) | No "Add your venue address" rung fires; rung 2 OfferingChooser shows | Hook+Component |
| T-20 | ExperienceCreatorWizard Step 2 pre-fill | brand.address = "Soho Lounge"; open Step 2 | Venue field shows "Soho Lounge"; helper text per COPY_INVENTORY | Component+Hook |
| T-21 | ExperienceCreatorWizard Step 2 save-as-brand | brand.address null, user types "X", checks checkbox | On publish, brand.address = "X" AND experience.theme.experience_meta.venue_text = "X" | Component+Service |
| T-22 (admin) | Admin Venue Claims tabs | Open admin Venue Claims; default | "Pending review" tab loads pending list; tab switch to Verified loads verified-claim_status rows | Admin Component+Service |

---

# Sub-spec C — Public brand page rebuild + DB schema, view, RLS, RPC rewrites

**Scope:** Stage 0 + Stage 2 + Stage 3 of DATA_MODEL_AUDIT §"DROP COLUMN safety plan" (steps 16–26) + Phase 2 design Area 5 + 9. ONE migration commit covers Stage 0 (additive schema) + Stage 2 (view + RLS + RPC rewrites) + Stage 3 (RPC body rewrites). Stage 4 (DROP COLUMN) is a follow-up commit (§Stage 4 below).

**Operator gate:** Operator runs `supabase db push --linked` from the per-ORCH worktree BEFORE orchestrator deploys Sub-D edge functions or tester begins.

## C.1 Stage 0 — additive schema + index (single migration)

**Migration filename:** `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql`

**Migration contents (in this exact order — see C.5 for the full migration text):**

### C.1.a Functional GIN index on theme.experience_meta JSON sub-fields (per Q9)

```sql
-- Functional index for chronological sort of experiences in Upcoming tab
CREATE INDEX IF NOT EXISTS events_experience_next_occurrence_idx
  ON public.events ((theme->'experience_meta'->>'next_occurrence_at'))
  WHERE event_type = 'experience' AND deleted_at IS NULL;
```

Rationale: `theme->'experience_meta'->>'next_occurrence_at'` is the sort key for the Upcoming RPC. Without this index, JSONB extraction on large brand sets is sequential-scan. Partial index narrows to experience rows only.

### C.1.b NEW RPC `pg_brand_offering_counts(p_brand_id uuid)` (Theme E shared)

```sql
CREATE OR REPLACE FUNCTION public.pg_brand_offering_counts(p_brand_id uuid)
RETURNS TABLE (
  events bigint,
  trips bigint,
  experiences bigint
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE event_type = 'event')      AS events,
    count(*) FILTER (WHERE event_type = 'trip')       AS trips,
    count(*) FILTER (WHERE event_type = 'experience') AS experiences
  FROM public.events
  WHERE brand_id = p_brand_id
    AND deleted_at IS NULL
    AND published_at IS NOT NULL;   -- only published offerings count toward hub visibility
$$;

REVOKE EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.pg_brand_offering_counts(uuid) TO authenticated;
```

Authenticated-only (consumed by business app hub + brand creation flow); no anon access needed since the count drives owner-side UI.

## C.2 Stage 2 — view + RLS + RPC rewrites (continued in same migration)

### C.2.a `business_public_brands_view` rewrite

**Before** (latest at `20260727000003_orch_0962_brand_field_render_truthful.sql:14-39`):
```sql
CREATE OR REPLACE VIEW public.business_public_brands_view AS
SELECT b.id, b.name, b.slug, b.kind, b.bio, b.address, ... FROM public.brands b
WHERE b.deleted_at IS NULL
  AND (b.kind IN ('popup','trip_planner') OR (b.kind = 'physical' AND b.claim_status = 'verified'));
```

**After:**
```sql
DROP VIEW IF EXISTS public.business_public_brands_view;
CREATE VIEW public.business_public_brands_view AS
SELECT
  b.id, b.name, b.slug, b.bio, b.address,
  b.cover_hue, b.cover_media_url, b.cover_media_type, b.profile_photo_type,
  b.default_currency, b.custom_links, b.display_attendee_count,
  b.place_pool_id, b.claim_status,
  b.created_at, b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL;
GRANT SELECT ON public.business_public_brands_view TO anon, authenticated;
```

Changes vs prior:
- `b.kind` DROPPED from SELECT.
- WHERE simplified to `b.deleted_at IS NULL` (universal public-read for non-deleted brands).
- Other columns unchanged (Sub-B doesn't depend on the kind column being present in the view; consumer reads stay valid).

### C.2.b `claimed_venues_public_view` rewrite

**Before:** `WHERE b.kind = 'physical' AND b.claim_status = 'verified'` with `b.kind` in SELECT.

**After:**
```sql
DROP VIEW IF EXISTS public.claimed_venues_public_view;
CREATE VIEW public.claimed_venues_public_view AS
SELECT
  b.id AS brand_id, b.name, b.slug, b.address, b.place_pool_id,
  b.claim_status, pp.google_place_id, pp.lat, pp.lng, pp.primary_type,
  -- ... other venue fields from place_pool join, UNCHANGED ...
FROM public.brands b
JOIN public.place_pool pp ON pp.id = b.place_pool_id
WHERE b.deleted_at IS NULL
  AND b.claim_status = 'verified';
GRANT SELECT ON public.claimed_venues_public_view TO anon, authenticated;
```

Changes vs prior:
- `b.kind` DROPPED from SELECT.
- WHERE simplified to `claim_status = 'verified'` alone (any brand with a verified claim).

### C.2.c `business_public_events_view` rewrite

**Before:** SELECTs `b.kind AS brand_kind` among event detail fields.

**After:**
```sql
DROP VIEW IF EXISTS public.business_public_events_view;
CREATE VIEW public.business_public_events_view AS
SELECT
  e.id, e.brand_id, e.slug, e.event_type, e.name, e.bio,
  e.start_at, e.end_at, e.timezone, e.cover_media_url, e.theme,
  e.published_at, e.created_at,
  b.name AS brand_name, b.slug AS brand_slug,
  -- b.kind AS brand_kind  -- DROPPED per META-ORCH-0972
  -- ... other passthrough fields UNCHANGED ...
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE e.deleted_at IS NULL
  AND e.published_at IS NOT NULL
  AND b.deleted_at IS NULL;
GRANT SELECT ON public.business_public_events_view TO anon, authenticated;
```

Changes vs prior:
- `b.kind AS brand_kind` DROPPED from SELECT (callers in `publicEventsService.ts` line 36 must be updated in Sub-C TS work — see C.4).

### C.2.d Three RLS policy rewrites

**Policy 1 — brands public-read** (originally `20260622000000_ve4_claimed_venues_public_view.sql:11-19`):

```sql
DROP POLICY IF EXISTS "Public can read verified physical venues" ON public.brands;
CREATE POLICY "Public can read non-deleted brands"
  ON public.brands FOR SELECT
  TO anon, authenticated
  USING (deleted_at IS NULL);
```

Renaming the policy (`"Public can read non-deleted brands"`) makes the new semantic explicit. The prior policy NAME is also part of the cleanup.

**Critical verification** before implementor lands this:
```sql
-- Run this read-only probe BEFORE pushing the migration:
SELECT polname, pg_get_expr(polqual, polrelid) AS predicate
FROM pg_policy
WHERE polrelid = 'public.brands'::regclass
  AND polcmd = 'r'   -- SELECT
ORDER BY polname;
```

Operator + orchestrator confirm the only public-read policy on `brands` is the one being rewritten. If there's a parallel policy (e.g., `"Anyone can read brands"`), that policy stays untouched and the new policy SUPPLEMENTS rather than REPLACES the kind filter.

**Policy 2 — brand_hours public-read** (originally `20260622000000_ve4_claimed_venues_public_view.sql:24-37`):

```sql
DROP POLICY IF EXISTS "Public can read hours for verified physical venues" ON public.brand_hours;
CREATE POLICY "Public can read hours for verified venues"
  ON public.brand_hours FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_hours.brand_id
      AND b.deleted_at IS NULL
      AND b.claim_status = 'verified'
  ));
```

Changes: dropped `b.kind = 'physical'` from EXISTS subquery; kept `claim_status = 'verified'`.

**Policy 3 — place_pool public-read** (originally `20260622000000_ve4_claimed_venues_public_view.sql:42-55`):

```sql
DROP POLICY IF EXISTS "Public can read place_pool for verified physical venues" ON public.place_pool;
CREATE POLICY "Public can read place_pool for verified-claimed venues"
  ON public.place_pool FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.place_pool_id = place_pool.id
      AND b.deleted_at IS NULL
      AND b.claim_status = 'verified'
  ));
```

Same pattern: kind predicate dropped, verified preserved.

### C.2.e `pg_public_trips_by_brand` RPC kind-guard removal (ORCH-0963 surface)

**Before** (`20260728000000_orch_0963_pg_public_trips_by_brand.sql` line 46):
```sql
WHERE b.slug = p_brand_slug
  AND b.kind = 'trip_planner'          -- line 46
  AND b.deleted_at IS NULL
  AND e.event_type = 'trip'
  AND e.published_at IS NOT NULL
  AND e.deleted_at IS NULL
```

**After** (same RPC body, line 46 deleted):
```sql
WHERE b.slug = p_brand_slug
  AND b.deleted_at IS NULL
  AND e.event_type = 'trip'
  AND e.published_at IS NOT NULL
  AND e.deleted_at IS NULL
```

**CRITICAL — preserve I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE:** the canonical `tickets.status IN ('valid','used','transferred')` join via `ticket_types.event_id` STAYS bit-identical to the ORCH-0947 spec. Implementor copies the existing RPC body verbatim and deletes ONLY line 46.

Full migration SQL in C.5.

### C.2.f NEW RPC `pg_public_experiences_by_brand(p_brand_slug text)` (Design Area 5 — Q4 cascade)

```sql
CREATE OR REPLACE FUNCTION public.pg_public_experiences_by_brand(p_brand_slug text)
RETURNS TABLE (
  experience_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  experience_slug text,
  name text,
  bio text,
  cover_media_url text,
  theme jsonb,
  venue_text text,
  next_occurrence_at timestamptz,
  price_from_minor_units bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.name,
    e.bio,
    e.cover_media_url,
    e.theme,
    (e.theme->'experience_meta'->>'venue_text')::text AS venue_text,
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz AS next_occurrence_at,
    (
      SELECT min(tt.price_minor_units)
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
    ) AS price_from_minor_units,
    e.default_currency AS currency,
    (
      SELECT NOT EXISTS (
        SELECT 1 FROM public.ticket_types tt
        WHERE tt.event_id = e.id AND tt.price_minor_units > 0
      )
    ) AS is_free,
    e.published_at
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE b.slug = p_brand_slug
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;

REVOKE EXECUTE ON FUNCTION public.pg_public_experiences_by_brand(text) FROM public;
GRANT EXECUTE ON FUNCTION public.pg_public_experiences_by_brand(text) TO anon, authenticated;
$$;
```

### C.2.g NEW RPC `pg_public_brand_upcoming(p_brand_slug text, p_cursor_at timestamptz, p_limit integer)` (Q4 + Q14)

Unified chronological feed of events + trips + experiences for the public Upcoming tab.

```sql
CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(
  p_brand_slug text,
  p_cursor_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  offering_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  offering_type text,         -- 'event' | 'trip' | 'experience'
  offering_slug text,
  name text,
  bio text,
  cover_media_url text,
  theme jsonb,
  starts_at timestamptz,      -- normalized timestamp for sort (event.start_at, trip.start_date, experience.next_occurrence_at)
  price_from_minor_units bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  WITH offerings AS (
    SELECT
      e.id AS offering_id, e.brand_id, e.event_type AS offering_type,
      e.slug AS offering_slug, e.name, e.bio, e.cover_media_url, e.theme,
      CASE e.event_type
        WHEN 'event' THEN e.start_at
        WHEN 'trip' THEN (e.theme->>'start_date')::timestamptz   -- legacy ORCH-0947 trip schema; implementor verifies the exact field at ingest
        WHEN 'experience' THEN NULLIF(e.theme->'experience_meta'->>'next_occurrence_at','')::timestamptz
      END AS starts_at,
      (
        SELECT min(tt.price_minor_units) FROM public.ticket_types tt
        WHERE tt.event_id = e.id
      ) AS price_from_minor_units,
      e.default_currency AS currency,
      (
        SELECT NOT EXISTS (
          SELECT 1 FROM public.ticket_types tt
          WHERE tt.event_id = e.id AND tt.price_minor_units > 0
        )
      ) AS is_free,
      e.published_at
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND e.published_at IS NOT NULL
  )
  SELECT
    o.offering_id, o.brand_id, p_brand_slug AS brand_slug,
    (SELECT b.name FROM public.brands b WHERE b.slug = p_brand_slug LIMIT 1) AS brand_name,
    o.offering_type, o.offering_slug, o.name, o.bio, o.cover_media_url, o.theme,
    o.starts_at, o.price_from_minor_units, o.currency, o.is_free, o.published_at
  FROM offerings o
  WHERE o.starts_at IS NOT NULL
    AND o.starts_at > p_cursor_at
  ORDER BY o.starts_at ASC, o.published_at DESC
  LIMIT (p_limit + 1);

REVOKE EXECUTE ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) TO anon, authenticated;
$$;
```

Returns `p_limit + 1` rows so the client can determine "has more" by comparing returned row count to `p_limit`.

**Implementor verification at ingest:** the trip `start_date` field path inside `theme` must be verified against the ORCH-0947 trip schema. If trips store start as `theme->>'startsAt'` (camelCase) or some other path, update the CASE arm accordingly. If trips have a dedicated column, prefer the column.

## C.3 Stage 3 — SECURITY DEFINER RPC body rewrites (continued in same migration)

### C.3.a `biz_create_venue_brand_pending_review()` rewrite

Latest definition at `20260618000000_ve2_pool_match_claim.sql:38-219` includes `INSERT INTO brands (kind, ...) VALUES ('physical', ...)` at ~line 162.

**Rewrite:** copy the existing RPC body verbatim with two changes:
1. Drop `kind` from the INSERT column list.
2. Drop `'physical'` from the INSERT values list.

Other RPC behavior (claim row creation, error handling, place_pool join) is UNCHANGED.

### C.3.b `biz_review_venue_claim()` rewrite

Latest definition at `20260619000000_ve3_admin_claim_review.sql:30-191` includes `WHERE b.id = p_brand_id AND b.kind = 'physical'` at line 61.

**Rewrite:** drop `AND b.kind = 'physical'` predicate. Replace with `AND b.claim_status IN ('pending_review','verified','rejected')` to preserve the semantic that this RPC only operates on brands that have initiated a claim.

## C.4 Sub-C TS code changes — public brand page rebuild (Design Area 5 + 9)

### C.4.a `mingla-business/src/components/brand/PublicBrandPage.tsx` full tab rebuild

The exact line ranges from SCREEN_INVENTORY row "PublicBrandPage.tsx tab structure":

| Lines | Action |
|---|---|
| 108 | `isTripBrand` constant DELETED (computed from kind) |
| 124 | tab-array initialization DELETED — replaced with data-driven array assembled from offering counts (see below) |
| 144 | tab-render block REWRITTEN |
| 196–223 | trip-branched render block REWRITTEN as data-driven `switch (activeTab)` over the new tab set |
| 227–232 | address card gate: `showLocation` no longer reads `brand.kind`; new predicate is `brand.address?.trim().length > 0` |
| 415–431 | Stats card DELETED (ORCH-0963 intent re-confirmed) |
| 434–467 | Past-events/past-trips conditional render block kept but made unconditional per per-tab type (per Q13) |

**New tab-array assembly logic** (replaces line 124):
```tsx
const visibleTabs: PublicTab[] = useMemo(() => {
  const tabs: PublicTab[] = [];
  if (offerings.upcomingCount > 0) tabs.push('upcoming');
  if (offerings.events.length > 0) tabs.push('events');
  if (offerings.trips.length > 0) tabs.push('trips');
  if (offerings.experiences.length > 0) tabs.push('experiences');
  tabs.push('about');   // about always present (identity card content)
  return tabs;
}, [offerings.upcomingCount, offerings.events.length, offerings.trips.length, offerings.experiences.length]);

type PublicTab = 'upcoming' | 'events' | 'trips' | 'experiences' | 'about';
```

**Tab body switch** (replaces lines 196–223):
```tsx
switch (activeTab) {
  case 'upcoming': return <UpcomingTabBody upcoming={offerings.upcoming} onLoadMore={...} hasMore={...} />;
  case 'events':   return <EventsTabBody events={offerings.events} pastEvents={offerings.pastEvents} />;
  case 'trips':    return <TripsTabBody trips={offerings.trips} pastTrips={offerings.pastTrips} />;
  case 'experiences': return <ExperiencesTabBody experiences={offerings.experiences} />;
  case 'about':    return <AboutTabBody brand={brand} />;
}
```

**Verified location pill** (Design Area 5/7 NEW — per Q10):
- Renders in the identity card next to brand name when `brand.claim_status === 'verified'`.
- Component: existing `<Pill>` or `<Badge>` primitive (implementor confirms during ingest).
- Copy: "Verified location" with `shield-check` Lucide icon per COPY_INVENTORY line 139.

### C.4.b `mingla-business/src/services/publicEventsService.ts` rewrite

| Lines | Action |
|---|---|
| 36 | `brand_kind` field in `BusinessPublicEventViewRow` interface — DELETE (view also drops the column) |
| 111–114 | `BusinessPublicBrandViewRow.kind` TS union — DELETE (view also drops the column) |
| 850–905 | `getPublicBrandBySlug` kind-branched dispatch — REPLACE with parallel fetch of events + trips + experiences + upcoming using `Promise.all([fetchPublicBrandEvents, fetchPublicBrandTrips, fetchPublicBrandExperiences, fetchPublicBrandUpcoming])` |

**New function signatures added to publicEventsService.ts:**

```ts
// NEW — public experience fetch
async function fetchPublicBrandExperiences(brandSlug: string): Promise<PublicExperienceCard[]>;

// NEW — chronological unified Upcoming feed
async function fetchPublicBrandUpcoming(
  brandSlug: string,
  cursor?: { startsAt: string; limit?: number }
): Promise<{ rows: PublicUpcomingRow[]; hasMore: boolean; nextCursor: string | null }>;

// NEW — combined fetcher used by PublicBrandPage
async function fetchPublicBrand(brandSlug: string): Promise<PublicBrandPayload>;

// PublicBrandPayload shape:
interface PublicBrandPayload {
  brand: PublicBrandSummary;
  events: PublicEventCard[];
  pastEvents: PublicEventCard[];
  trips: PublicTripCard[];
  pastTrips: PublicTripCard[];
  experiences: PublicExperienceCard[];
  upcoming: PublicUpcomingRow[];   // first 30 from pg_public_brand_upcoming
  upcomingHasMore: boolean;
  upcomingNextCursor: string | null;
  upcomingCount: number;           // sum of events.upcoming + trips.upcoming + experiences.length
}

interface PublicExperienceCard {
  experienceId: string;
  experienceSlug: string;
  brandSlug: string;
  brandName: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  theme: ExperienceTheme;
  venueText: string | null;          // from theme.experience_meta.venue_text
  nextOccurrenceAt: string | null;   // ISO from theme.experience_meta.next_occurrence_at
  priceFromMinorUnits: number | null;
  currency: string;
  isFree: boolean;
  publishedAt: string;
}

interface PublicUpcomingRow {
  offeringId: string;
  offeringType: 'event' | 'trip' | 'experience';
  offeringSlug: string;
  brandSlug: string;
  brandName: string;
  name: string;
  bio: string | null;
  coverMediaUrl: string | null;
  theme: Record<string, unknown>;
  startsAt: string;
  priceFromMinorUnits: number | null;
  currency: string;
  isFree: boolean;
}
```

### C.4.c New `<ExperienceMiniCard>` component (Design Area 5)

**File:** `mingla-business/src/components/brand/ExperienceMiniCard.tsx` (NEW)

**Props:**
```ts
interface ExperienceMiniCardProps {
  experience: PublicExperienceCard;
  showTypePill?: boolean;     // true in Upcoming tab interleave; false in Experiences-only tab
  testID?: string;
}
```

**Render contract per COPY_INVENTORY lines 154–156:**
- Cover image (16:9 aspect; fallback to brand color if no cover).
- Title (brand name's experience name).
- Subline: `{venueText} · Next: {formatNextOccurrence(nextOccurrenceAt)}` — venueText omitted if null; "Next: ..." omitted if null. Pattern: "Soho Lounge · Next: Sat 7pm".
- Type-pill labeled "Experience" when `showTypePill` is true.
- Price: `"From {currencySymbol}{priceFromMinorUnits / 100}"` OR `"Free"` pill when `isFree`.
- Tap → router.push(`/exp/{brandSlug}/{experienceSlug}`).

### C.4.d Type-pill addition to existing `<EventMiniCard>` and `<TripMiniCard>` (Design Area 5)

Add an optional `showTypePill?: boolean` prop to both existing components. When true, renders a pill labeled "Event" or "Trip" in the same position as `<ExperienceMiniCard>`'s pill. Default false (no behavior change in existing call sites).

### C.4.e New `useUpcomingFeed(brandSlug)` hook (Design Area 5 + Q14 cursor)

**File:** `mingla-business/src/hooks/useUpcomingFeed.ts` (NEW)

```ts
function useUpcomingFeed(brandSlug: string | null): UseInfiniteQueryResult<PublicUpcomingFeedPage>;

interface PublicUpcomingFeedPage {
  rows: PublicUpcomingRow[];
  nextCursor: string | null;
  hasMore: boolean;
}
```

- Query key: `['public', 'brand', brandSlug, 'upcoming']` (added to query key factory).
- Uses `useInfiniteQuery` with `getNextPageParam` reading `nextCursor`.
- Initial `pageParam` is undefined → server uses default `now()`.
- staleTime: 60_000 (1 min) — upcoming feed updates as offerings publish.

## C.5 Full Stage 0+2+3 migration text (single file)

**Path:** `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql`

Implementor copies the SQL exactly. All sections cited above ASSEMBLE into this one migration in this order:

1. Functional GIN index on `events ((theme->'experience_meta'->>'next_occurrence_at'))` — C.1.a
2. `CREATE OR REPLACE FUNCTION pg_brand_offering_counts` — C.1.b
3. `DROP VIEW + CREATE VIEW business_public_brands_view` — C.2.a
4. `DROP VIEW + CREATE VIEW claimed_venues_public_view` — C.2.b
5. `DROP VIEW + CREATE VIEW business_public_events_view` — C.2.c
6. `DROP POLICY + CREATE POLICY` × 3 (brands, brand_hours, place_pool) — C.2.d
7. `CREATE OR REPLACE FUNCTION pg_public_trips_by_brand` (existing body minus line 46 brand-kind guard) — C.2.e
8. `CREATE OR REPLACE FUNCTION pg_public_experiences_by_brand` — C.2.f
9. `CREATE OR REPLACE FUNCTION pg_public_brand_upcoming` — C.2.g
10. `CREATE OR REPLACE FUNCTION biz_create_venue_brand_pending_review` (existing body minus `kind` from INSERT) — C.3.a
11. `CREATE OR REPLACE FUNCTION biz_review_venue_claim` (existing body minus `kind = 'physical'` predicate) — C.3.b

**Read-only pre-flight probe (implementor runs before `db push` per orchestrator backstop 2026-05-24):**

```sql
-- Confirm only one public-read policy on brands
SELECT polname, pg_get_expr(polqual, polrelid) AS predicate
FROM pg_policy WHERE polrelid = 'public.brands'::regclass AND polcmd = 'r';

-- Confirm zero live brands (or report count for archive decision)
SELECT count(*) FROM public.brands WHERE deleted_at IS NULL;

-- Confirm latest pg_public_trips_by_brand RPC has the kind guard
SELECT pg_get_functiondef('public.pg_public_trips_by_brand(text)'::regprocedure);

-- Confirm no rows in events with non-null next_occurrence_at would be lost by partial index WHERE clause
SELECT count(*) FROM public.events
WHERE event_type = 'experience' AND deleted_at IS NULL
  AND theme->'experience_meta'->>'next_occurrence_at' IS NOT NULL;
```

Record outputs in the implementation report PER orchestrator invariant-migration backstop. If probe 1 returns >1 row, the migration MUST be amended to handle the parallel policy. If probe 2 returns >0, archive snapshot per Stage 4 follow-up.

## C.6 Stage 4 — DROP COLUMN follow-up migration

**Path:** `supabase/migrations/20260730000000_meta_orch_0972_drop_brand_kind.sql`

**Ships in a SEPARATE commit ≥1 release cycle AFTER Sub-A through Sub-D are live and operating cleanly with no rollback signal.** Operator gates the second `supabase db push --linked` for this file.

```sql
-- META-ORCH-0972 Stage 4 — drop brands.kind column + constraint
-- Prereq: Stage 1-3 deployed and stable for ≥1 release cycle (no rollback signal)
-- Prereq: archive snapshot taken IF any live brands existed at deploy time

-- Optional archive (only if probe in C.5 showed live brands at Stage 1-3 deploy time)
-- CREATE TABLE IF NOT EXISTS _archive_meta_orch_0972_brand_kind
--   AS SELECT id, kind FROM public.brands;
-- COMMENT ON TABLE _archive_meta_orch_0972_brand_kind IS
--   'Archive of brands.kind values before META-ORCH-0972 drop. 14-day retention; drop 2026-08-13.';

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_kind_check;
ALTER TABLE public.brands DROP COLUMN IF EXISTS kind;
```

After this migration applies, the `mingla-business/src/types/brand.ts` `Brand.kind` field must also be DELETED (not just marked `@deprecated`). That TS edit ships in the same commit as this migration.

## C.7 Success criteria (Sub-C)

- **SC-C-1** Migration `20260729000000_meta_orch_0972_universal_authoring.sql` applies cleanly via `supabase db push --linked` against the production DB. No `RAISE EXCEPTION`; no permission errors.
- **SC-C-2** Post-apply, all 3 views (`business_public_brands_view`, `claimed_venues_public_view`, `business_public_events_view`) exist; NONE contain `b.kind` in their SELECT or WHERE. Verified via `pg_get_viewdef(viewname)`.
- **SC-C-3** Post-apply, all 3 RLS policies (brands, brand_hours, place_pool public-read) exist with predicates that DO NOT reference `b.kind`. Verified via the C.5 pre-flight policy probe.
- **SC-C-4** Post-apply, `pg_public_trips_by_brand`, `pg_public_experiences_by_brand`, `pg_public_brand_upcoming`, `pg_brand_offering_counts`, `biz_create_venue_brand_pending_review`, `biz_review_venue_claim` are all callable and return expected shapes. Tester runs RPC probes.
- **SC-C-5** `pg_public_trips_by_brand` returns trip rows for a `kind='popup'` brand that has published trips (proving the kind guard is removed). Tester probes with a test brand.
- **SC-C-6** `pg_public_experiences_by_brand` returns experiences sorted by `next_occurrence_at ASC NULLS LAST` then `published_at DESC`. Tester probes with 3 experiences (different occurrence dates).
- **SC-C-7** `pg_public_brand_upcoming` interleaves events + trips + experiences chronologically across brand types. Tester probes with mixed offerings.
- **SC-PUB-8** Public brand page `/b/{brandSlug}`: zero-offering brands show identity card + "More coming soon from this brand." Brands with offerings render data-driven tabs (only counts > 0 produce tabs). Verified on buyer-web.
- **SC-PUB-9** Public Upcoming tab shows interleaved cards with type-pills ("Event"/"Trip"/"Experience") visible. Load-more CTA appears when `upcomingHasMore` is true; tap fetches next 30.
- **SC-PUB-10** Public Events / Trips / Experiences tabs each render only their type's cards (no interleave); each shows past sections per Q13 (Events past, Trips past, Experiences active-only).
- **SC-PUB-11** Address card on public page renders when `brand.address?.trim().length > 0`, regardless of any other field. Verified for popup + trip_planner + physical brands.
- **SC-PUB-12** Verified location pill renders in identity card when `brand.claim_status === 'verified'`. Copy + icon match COPY_INVENTORY.
- **SC-C-13** `BusinessPublicBrandViewRow` TS type does NOT contain `kind` field. `BusinessPublicEventViewRow` does NOT contain `brand_kind`. `publicEventsService.getPublicBrandBySlug` does not branch on any kind value.
- **SC-C-14** **Implementor regression test**: `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` (or TS variant via `supabase functions test`) — assert chronological interleave + cursor pagination + has-more boundary. Fails on revert when the union is wrong-ordered.
- **SC-C-15** **Implementor regression test**: `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` — assert zero-offering brand renders identity + empty state; brand with only experiences renders only Experiences tab + About; brand with all 3 renders all 4 + About. Fails on revert when the legacy kind-branched tab structure returns.

## C.8 Test cases (Sub-C — T-23 through T-44)

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-23 | Migration apply clean | `supabase db push --linked` | OK, no errors | Migration |
| T-24 | views drop kind | post-apply `pg_get_viewdef('business_public_brands_view')` | No `b.kind` in result | DB |
| T-25 | RLS drop kind | `pg_policy.polqual` for brands public-read | No `kind = 'physical'` predicate | DB |
| T-26 | pg_public_trips_by_brand universal | RPC called with popup-brand slug that has trips | Returns trip rows | DB+RPC |
| T-27 | pg_public_trips_by_brand sold formula preserved | RPC returns `spots_remaining` = `capacity - sold` where sold uses `tickets.status IN ('valid','used','transferred')` | Bit-identical to ORCH-0947 contract | DB+RPC |
| T-28 | pg_public_experiences_by_brand happy | Insert 3 experiences with `next_occurrence_at` 6/1, 6/2, 6/3; RPC | Returns 3 sorted ASC | DB+RPC |
| T-29 | pg_public_experiences_by_brand null occurrence | Insert experience with no `next_occurrence_at` | Returns last (NULLS LAST) | DB+RPC |
| T-30 | pg_public_brand_upcoming interleave | Brand with 1 event 6/1, 1 trip 6/2, 1 experience 6/3 | Returns 3 in chronological order | DB+RPC |
| T-31 | pg_public_brand_upcoming cursor | Call with `p_cursor_at = '2026-06-01'` | Returns offerings >'2026-06-01' only | DB+RPC |
| T-32 | pg_public_brand_upcoming has_more | Brand with 31 offerings; default `p_limit=30` | Returns 31 rows (30 + 1 lookahead); client detects hasMore=true | DB+RPC |
| T-33 | pg_brand_offering_counts | Brand with 5 events, 0 trips, 2 experiences | Returns `{events:5, trips:0, experiences:2}` | DB+RPC |
| T-34 | biz_create_venue_brand_pending_review no kind | Call RPC; check resulting brand row | brand row created; kind column has default value (`'popup'`) OR after Stage 4 column doesn't exist; either way RPC doesn't fail | DB+RPC |
| T-35 | biz_review_venue_claim universal | Call RPC against a `kind='popup'` brand with `claim_status='pending_review'` | RPC succeeds (no kind guard) | DB+RPC |
| T-36 | PublicBrandPage zero-offering | Brand with 0 events, 0 trips, 0 experiences | Identity + "More coming soon from this brand." renders; zero tabs (or only About tab per implementor decision — see Phase 2 design) | UI |
| T-37 | PublicBrandPage events-only | Brand with 3 events | Only Events tab + About tab render | UI |
| T-38 | PublicBrandPage all-3 | Brand with 2 events, 1 trip, 1 experience | Upcoming + Events + Trips + Experiences + About render | UI |
| T-39 | PublicBrandPage Upcoming interleave | Brand with mixed offerings | Cards interleaved chronologically; type-pills present | UI |
| T-40 | PublicBrandPage Verified pill | Brand with `claim_status='verified'` | Pill renders next to brand name | UI |
| T-41 | PublicBrandPage address card popup | popup brand with `address='12 Soho Square'` | Address card renders (no kind gate) | UI |
| T-42 | PublicBrandPage Stats card gone | Any brand | No Stats card renders | UI |
| T-43 | `<ExperienceMiniCard>` rendering | Pass experience with venueText + nextOccurrenceAt + price | "Soho Lounge · Next: Sat 7pm" + "From £15" | UI |
| T-44 | `<ExperienceMiniCard>` free | Pass experience with isFree=true | "Free" pill instead of "From" price | UI |

---

# Sub-spec D — Edge function deploys + strict-grep gate rewrites + Q15 parser regate

**Scope:** Stage 1 steps 6–8 deployed (edge function source edits ship in Sub-A's commit; the DEPLOY happens here after Sub-C's migration is live). Also: Stage 4 steps 29–30 strict-grep gate updates + ORCH-0972 new gate creation + parser `temporaryCategory` write-through per Q15.

## D.1 Edge function deploys (orchestrator-owned)

Per protocol `feedback_orchestrator_deploys_edge_functions.md`: the orchestrator deploys edge functions via local CLI; operator does NOT. Sub-D commit landing on the per-ORCH branch is the trigger for the orchestrator to run:

```bash
/Users/sethogieva/bin/supabase functions deploy parse-restaurant-menu --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy parse-play-activities --project-ref gqnoajqerqhnvulmnyvv
# Functions importing _shared/agentTools.ts (any function that uses agent tools — check imports at deploy time):
/Users/sethogieva/bin/supabase functions deploy agent-chat --project-ref gqnoajqerqhnvulmnyvv
# Plus any other function importing _shared/agentTools.ts (orchestrator greps before deploy)
```

**Post-deploy verification** (orchestrator runs per `feedback_supabase_edge_deploy_verify_first_call.md`):

```bash
# Verify the version bumps:
# Use mcp__supabase__list_edge_functions to confirm post-deploy version numbers
# Then issue one curl per deployed function to confirm reachability:
curl -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/parse-restaurant-menu" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"brand_id":"<test_brand_uuid>","menu_text":"sample"}'
# Expect 200 or 400 (validation error) — NOT 404 NOT_FOUND
```

If any function returns 404, re-deploy with `--no-verify-jwt` flag (since these functions use `verify_jwt: true` per config.toml verification).

`verify_jwt` settings — orchestrator MUST preserve existing values (parse-restaurant-menu + parse-play-activities are `verify_jwt: true`; agent-chat per its own config).

## D.2 Strict-grep gate rewrites

### D.2.a DELETE `scripts/ci/orch-0855-adversarial-check.mjs` assertions

| Assertion | Action |
|---|---|
| A-07 — `PersonaDef.id` 3-id literal union locked | DELETE assertion (lines 155 onward per audit) |
| A-13 — kind-immutable for trip_planner | DELETE assertion |

If A-07 and A-13 are the ONLY assertions in this file → DELETE the entire file. If other assertions exist → preserve them; delete only A-07 + A-13. Implementor inspects file at ingest.

Also remove the corresponding job from `.github/workflows/strict-grep-mingla-business.yml`.

### D.2.b RESHAPE `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs`

| Assertion | Action |
|---|---|
| C1 — `PublicBrandPage.tsx contains brand.kind === "trip_planner"` | DELETE |
| C2 — `publicEventsService calls pg_public_trips_by_brand` | **PRESERVE** (RPC still called universally) |
| C3 — `BusinessPublicBrandViewRow.kind admits "trip_planner"` | DELETE |
| C4 — `event_type === 'trip'` allowlist (route segregation) | **PRESERVE** (I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE; orthogonal) |

The gate file is renamed to reflect its now-narrower scope: `.github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs` (rename in the same commit). Update the workflow job reference accordingly.

### D.2.c CREATE `.github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs`

Enforces `I-PUBLIC-PAGE-DATA-DRIVEN-TABS` + `I-HUB-TABS-DATA-DRIVEN`.

Required assertions:
1. **D1** `PublicBrandPage.tsx` MUST contain the substring `visibleTabs` (data-driven assembly) AND MUST NOT contain `isTripBrand` or `brand.kind ===`.
2. **D2** `app/(tabs)/hub/_layout.tsx` MUST contain `useHubVisibleTabs(` AND MUST NOT contain `brand.kind ===` or `currentBrand.kind`.
3. **D3** `hub/_layout.tsx` MUST contain `useHubInitialTab(` (sticky-tab discipline).
4. **D4** `PublicBrandPage.tsx` MUST NOT contain `if (isTripBrand)` or `if (!isTripBrand)`.

Workflow job added to `strict-grep-mingla-business.yml`.

### D.2.d CREATE `.github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs`

Enforces `I-BRAND-UNIVERSAL-AUTHORING`.

Required assertions:
1. **N1** No file under `mingla-business/src/`, `mingla-business/app/`, `mingla-admin/src/`, `supabase/functions/` may contain the substring `brand.kind`, `brands.kind`, or `currentBrand.kind` UNLESS the file is in the allowlist.
2. **N2** Allowlist:
   - `supabase/migrations/*.sql` (historical migrations preserved)
   - `mingla-business/src/types/brand.ts` UNTIL Stage 4 migration lands (then the `kind` field is deleted from the TS type and the file is removed from allowlist in the Stage 4 commit)
   - `app-mobile/**` if any file has been verified false-positive (per Dim 12 audit none expected — verify allowlist remains empty for app-mobile/)
3. **N3** `_shared/agentTools.ts`, `parse-restaurant-menu/index.ts`, `parse-play-activities/index.ts` — assert ZERO `brand.kind` references.
4. **N4** Also forbids `claim_status !== 'verified'` early-returns in any authoring-path file (rough heuristic: file paths containing `Drafts`, `Service`, `tripsService`, `eventDrafts`, `experienceCreator`, `brandAuthoringGate`). The pattern `if (.*claim_status.*!==.*'verified'.*) return\b` is the regex.

Workflow job added to `strict-grep-mingla-business.yml`.

### D.2.e UPDATE `ORCH_0972_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

Per COMMS-0002. Allowlist entries to add (in the same commit as the backend touches):

```
supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql
supabase/migrations/20260730000000_meta_orch_0972_drop_brand_kind.sql
supabase/functions/parse-restaurant-menu/index.ts
supabase/functions/parse-play-activities/index.ts
supabase/functions/_shared/agentTools.ts
```

## D.3 Q15 parser regate finalization

Per OPEN_QUESTIONS Q15 + this SPEC's Q15 resolution (line ~80): both parsers receive a `temporaryCategory` literal at the OpenAI call site:

**File:** `supabase/functions/parse-restaurant-menu/index.ts`

After the gates are removed, the OpenAI prompt construction MUST include:
```ts
const temporaryCategory = 'restaurant';
// passed to OpenAI as system-prompt context:
// "You are parsing a {temporaryCategory} menu..."
```

**File:** `supabase/functions/parse-play-activities/index.ts`

```ts
const temporaryCategory = 'play';
// similar passthrough to OpenAI
```

**No write-through to `brands.venue_category`** — this is the explicit non-goal per Q15 resolution.

## D.4 Success criteria (Sub-D)

- **SC-D-1** Post-deploy, `parse-restaurant-menu`, `parse-play-activities`, and any `_shared/agentTools.ts`-importing functions report bumped version numbers via `mcp__supabase__list_edge_functions`. Live curl returns non-404.
- **SC-D-2** ORCH-0855 adversarial-check file is deleted (or A-07 + A-13 removed if other assertions exist). CI workflow no longer runs that job.
- **SC-D-3** ORCH-0963 strict-grep gate file is renamed; C1 + C3 deleted; C2 + C4 preserved. CI workflow references the renamed file.
- **SC-D-4** `meta-orch-0972-data-driven-tabs.mjs` exists with 4 assertions; runs in CI; passes on the META-ORCH-0972 branch HEAD.
- **SC-D-5** `meta-orch-0972-no-brand-kind-reads.mjs` exists with 4 assertions; runs in CI; passes on the META-ORCH-0972 branch HEAD.
- **SC-D-6** `ORCH_0972_BACKEND_ALLOWLIST` in `orch-0863-marketing-hub-phase-b.mjs` includes all 5 backend files. CI's `no-new-backend-files` check passes.
- **SC-D-7** Parser regate Q15: both parsers contain `temporaryCategory` literal at the OpenAI call site (`'restaurant'` and `'play'` respectively). Neither contains an `UPDATE brands SET venue_category` statement.
- **SC-D-8** **Implementor regression test**: `mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts` — assert the strict-grep gate fires (returns non-zero exit) when a test fixture contains `brand.kind` in `mingla-business/src/`. Fails on revert when the gate is weakened.
- **SC-D-9** Edge function smoke: `parse-restaurant-menu` called as a `kind='popup'` brand returns 200 with parsed JSON (proving the gate is gone live). Tester runs this with a test brand id.

## D.5 Test cases (Sub-D — T-45 through T-54)

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-45 | parse-restaurant-menu universal | POST as popup brand | 200 + parsed JSON; no 403 BRAND_NOT_ELIGIBLE | Edge fn live |
| T-46 | parse-play-activities universal | POST as popup brand | 200 + parsed JSON | Edge fn live |
| T-47 | agentTools create_experience | Agent invokes against popup brand | Tool runs; no INVALID_ARGS | Edge fn live |
| T-48 | Strict-grep no-kind-reads fires | Insert `const x = brand.kind;` in test fixture file under mingla-business/src/ | CI gate returns exit code 1 | CI |
| T-49 | Strict-grep no-kind-reads passes clean | Branch HEAD without any kind reads | CI gate returns exit code 0 | CI |
| T-50 | Strict-grep data-driven-tabs fires on isTripBrand | Re-introduce `const isTripBrand = ...` in PublicBrandPage | CI gate exit 1 | CI |
| T-51 | Strict-grep data-driven-tabs passes clean | Branch HEAD with `visibleTabs` and no isTripBrand | CI gate exit 0 | CI |
| T-52 | ORCH-0863 backend allowlist accepts META-ORCH-0972 files | PR with `supabase/functions/parse-restaurant-menu/index.ts` diff | ORCH-0863 gate passes (C7 `no-new-backend-files` allowed) | CI |
| T-53 | ORCH-0963 strict-grep C2 still enforces | PR removing `pg_public_trips_by_brand` call from publicEventsService | CI gate exit 1 (RPC still required to be called) | CI |
| T-54 | ORCH-0963 strict-grep C4 still enforces (route segregation) | PR allowing `event_type === 'trip'` in non-allowlisted file | CI gate exit 1 | CI |

---

# Regression test summary (CLOSE Step 0.5 gate)

CLOSE Step 0.5 requires BOTH (a) implementor-written happy-path regression test AND (b) tester-written adversarial regression test, both at real paths, with fails-on-revert verification.

## Implementor happy-path tests (per sub-spec)

- **Sub-A:** `mingla-business/__tests__/services/eventDrafts.universalAuthoring.test.ts` (SC-A-7) — asserts no `BrandAuthoringGateError` on physical-brand draft creation.
- **Sub-B:** `mingla-business/__tests__/hooks/useHubVisibleTabs.test.tsx` (SC-B-13) + `mingla-business/__tests__/components/BrandCreationFlow.test.tsx` (SC-B-14).
- **Sub-C:** `supabase/functions/__tests__/pg_public_brand_upcoming.test.sql` or TS-shaped test via `supabase functions test` (SC-C-14) + `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` (SC-C-15).
- **Sub-D:** `mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts` (SC-D-8).

Each test MUST include the line `// fails-on-revert verified at <commit hash>` in the implementation report.

## Tester adversarial tests (different angle per sub-spec — tester writes these)

Tester guidance: each adversarial test attacks a different angle than the implementor's test. Examples:

- **Sub-A adversarial:** edge-function POST with malformed brand_id; assert proper validation error (NOT a silent kind-gate fallback).
- **Sub-B adversarial:** race condition in `useHubVisibleTabs` — what if counts arrive in different order than React Query expects? Stale data?
- **Sub-C adversarial:** SQL injection via `p_brand_slug` parameter; assert RPC properly escapes.
- **Sub-D adversarial:** strict-grep gate evasion — does a Unicode-similar-character `brand․kind` (U+2024 one-dot leader) trigger the gate? It should — gate matches via exact substring.

Tester reports each adversarial test path + fails-on-revert commit hash in their QA report.

---

# Cross-references

- Phase 2 design (LOCKED at `8311fa89b`): `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md`, `_SCREEN_INVENTORY.md`, `_COPY_INVENTORY.md`, `_HANDOFF_TO_SPEC.md`
- Phase 2 REVIEW REWORK (APPROVED at `ff26b23bb`): `Mingla_Artifacts/reports/REVIEW_META-ORCH-0972_PHASE_2_DESIGN_REWORK.md`
- Phase 1 audit reports: `INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md`, `INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md`, `INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md`, `INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md`
- Comms ledger: `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` — COMMS-0002 (allowlist) factored in Sub-A/C/D; COMMS-0003 (external API docs) N/A; COMMS-0005 (ORCH-0964 collision) factored in Sub-C
- Invariant typo fix: `Mingla_Artifacts/design/PHASE_2_DESIGN_META-ORCH-0972_SCREEN_INVENTORY.md` row 1 cites `I-BRAND-UNIVARSAL-AUTHORING` — Phase 4 implementor fixes to `I-BRAND-UNIVERSAL-AUTHORING` in the same commit that introduces the new invariant in `INVARIANT_REGISTRY.md`

End of spec.
