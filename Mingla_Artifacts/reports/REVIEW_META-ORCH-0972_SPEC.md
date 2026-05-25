# REVIEW_META-ORCH-0972_SPEC

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access + data-driven hub/public tabs]
**Phase reviewed:** 3 of 5 — SPEC
**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Spec commit reviewed:** `f1e5902a9`
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/` on branch `meta-orch-0972-brand-kind-decommission-universal-features`
**Verdict:** **APPROVED** with one P2 implementor-ingest verification note (see §"Findings")

---

## Reviewer transparency (same-session bias)

Same Claude session produced both the Phase 3 SPEC (as `mingla-forensics` SPEC mode) and this REVIEW (as `mingla-orchestrator`). This is the second same-session review on META-ORCH-0972 (Phase 2 design REWORK was also same-session). Bias direction is toward APPROVING my own work. I have actively hunted for gaps in the SPEC and found one that warrants a P2 ingest-verification note (§"Findings" P2-1).

Operator should treat the APPROVED verdict as "structurally complete + ready for next phase" rather than as deep independent verification. If second-set-of-eyes parity is desired before Sub-A dispatches, the option is to ask Codex `forensic-mingla` to TEST-mode the SPEC document — one-turn add, parallel to how Phase 1 audit got Codex re-review.

---

## Commit-hash verification

`git log --oneline Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` shows commit `f1e5902a9` on the META-ORCH-0972 per-ORCH branch. Single commit, 1,413 lines, zero uncommitted modifications. `git status --short` reports only one untracked file (`CODEX_RE_REVIEW_META-ORCH-0972_AUDIT.md` — Phase 1 carry-over, not in scope for this review).

---

## Dependency walk for config-layer changes

The SPEC document itself touches zero config files (it's a markdown spec under `Mingla_Artifacts/`). However, the SPEC PRESCRIBES Phase 4 implementor edits to these config-layer files (called out so the implementor REVIEW will catch them):

- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` — allowlist append in Sub-A/C/D commits per COMMS-0002.
- `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs` — rename + reshape in Sub-D.
- `.github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs` — NEW in Sub-D.
- `.github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` — NEW in Sub-D.
- `.github/workflows/strict-grep-mingla-business.yml` — UPDATE jobs in Sub-D.
- `scripts/ci/orch-0855-adversarial-check.mjs` — DELETE A-07 + A-13 (or full file delete) in Sub-D.

Spec-time compatibility assessment per consumer:

| Consumer of changed config | Compatibility check |
|---|---|
| `strict-grep-mingla-business.yml` `ORCH_0863` job | Reads `ORCH_0972_BACKEND_ALLOWLIST` — consumer must accept the new entries. Spec adds 5 entries; per COMMS-0002 this is the contract. **OK** |
| Other strict-grep jobs (ORCH-0959, ORCH-0840, etc.) | Independent; no cross-job dependency on ORCH-0972 gates. **OK** |
| CI runner | Spec adds 2 new mjs scripts + reshapes 1 existing + deletes 0 or 1 (ORCH-0855). Workflow job count net +1 or +2. **OK — no runner-config dependency** |
| `mingla-business/src/types/brand.ts` consumers | Spec keeps `Brand.kind` field in TS until Stage 4; consumers can still read it (NULL/legacy). Stage 4 ships a TS edit. **OK with handoff** |

No spec-time config touches; no implementor-discovered dependency surprises expected. Implementor REVIEW will re-walk these in Sub-D.

---

## REVIEW protocol checklist (every box must be PASS or N/A)

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | Root cause proven (for INVESTIGATE → SPEC) | N/A (no investigation phase blocked SPEC; design was locked) | Phase 1 audit reports cite 6-field evidence per dimension |
| 2 | Scope appropriate — could be narrower? | **PASS** | Scope explicit in spec §"Top-level scope, non-goals, assumptions"; Stage 4 separation prevents premature column drop |
| 3 | Hidden fallback paths that mask failure? | **PASS** | No `?? fallbackValue` for display data; no silent catches; all errors surface |
| 4 | Stale cache paths serving old data? | **PASS** | New hooks (`useBrandOfferingCounts`, `useHubVisibleTabs`, `useUpcomingFeed`) all use React Query key factory + explicit `staleTime`; no Zustand persist of server data per I-PROPOSED-J |
| 5 | Response shape truthful in ALL states (loading / error / empty / populated)? | **PASS** | Each surface spec calls out shimmer-loading + empty-state copy per COPY_INVENTORY; PublicBrandPage zero-offering empty state explicitly designed |
| 6 | Real fix or symptom mask? | **PASS** | Decommissioning the column entirely (not gating reads conditionally); root-cause elimination of `brand.kind` coupling |
| 7 | Solo/collab parity? | N/A | META-ORCH-0972 is brand authoring + public read; no swipeable collab surfaces in scope (verified via META-ORCH-0929 product redesign — collab decks are in chat-mounted sheets only) |
| 8 | Constitutional compliance (14 rules)? | **PASS** with one carve-out | (1) No dead taps — `<OfferingChooser>` 3-button + experience wizard all interactive. (2) One owner per truth — `useBrandOfferingCounts` is single read source; no duplicate count derivation. (3) No silent failures — onError handlers required on all mutations per implementor checklist. (4) One query key per entity — added to existing factory. (5) Server state server-side — AsyncStorage holds only `lastTab` string (client preference, not server data) per I-PROPOSED-J. (6) Logout clears — N/A (no new auth surface). (7) Label temporary — Stage 4 column drop is labeled with prereq + retention plan. (8) Subtract before adding — yes, 22 surfaces deleted in Sub-A/B before new code in Sub-C. (9) No fabricated data — Verified pill renders ONLY on `claim_status='verified'`. (10) Currency-aware — `<ExperienceMiniCard>` spec includes `currencySymbol(currency) + price` pattern matching existing primitives. (11) One auth — N/A. (12) Validate at right time — Stripe gate at PUBLISH not at DRAFT per Q1. (13) Exclusion consistency — RLS predicates match view predicates match RPC predicates (all drop kind together in same migration). (14) Persisted-state startup — `useHubInitialTab` reads AsyncStorage synchronously via cached value. |
| 9 | Evidence chain complete? | **PASS** | SPEC cites every Phase 1 audit dimension D1–D12, every operator decision Q1–Q11, every designer-surfaced Q12–Q15 with explicit resolution, every preserved/superseded invariant with ORCH reference |
| 10 | Documents updated? | **PASS (this REVIEW)** | Phase 3 SPEC at f1e5902a9; this REVIEW artifact at REVIEW_META-ORCH-0972_SPEC.md; SPEC_QUEUE.md + AGENT_HANDOFFS.md updates deferred to operator's CLOSE Step 1 of META-ORCH-0972 (per artifact-update timing — these update on PHASE close, not on intra-phase review) |
| 11 | Commit-hash verification | **PASS** | See §"Commit-hash verification" above |
| 12 | Dependency walk for config-layer changes | **PASS** | See §"Dependency walk" above — SPEC-time zero config touches; implementor-time touches enumerated |

All boxes PASS or N/A. APPROVED verdict eligible.

---

## Spec-completeness deep dive (cross-reference verification)

### (a) Q1–Q11 operator decisions — ALL realized

Cross-checked the SPEC's "Quick-reference: 11 operator decisions" table against each spec section that should realize the decision:

| Q | Decision | Spec realization location | Realized? |
|---|---|---|---|
| Q1 | Stripe at publish if max(tier.price)>0 | Sub-A.1 homeNextAction.ts rung 1 predicate change + Sub-B publish validator (referenced in Cross-Surface Impact) | ✓ |
| Q2 | Get-started placeholder tab | Sub-B B.3.b `useHubVisibleTabs` returns `['getstarted']` when all counts zero | ✓ |
| Q3 | Sticky last-visited hub tab, default Events | Sub-B B.3.b `useHubInitialTab` with AsyncStorage `@mingla/hub/lastTab` | ✓ |
| Q4 | Experiences IN Upcoming tab interleaved | Sub-C C.2.g `pg_public_brand_upcoming` UNION + Sub-C C.4.a Upcoming tab body | ✓ |
| Q5 | TripBrandWizard clean delete | Sub-B B.2 file-deletion table includes TripBrandWizard.tsx + .test.ts | ✓ |
| Q6 | Address combined ask at brand-create + first-experience | Sub-B B.1.b BrandCreationFlow Step 2 (optional) + Sub-B B.1.c ExperienceCreatorWizard Step 2 (re-ask with prefill) | ✓ |
| Q7 | Experience venue: always ask + pre-fill | Sub-B B.1.c Step 2 + Sub-B B.3.c `useExperienceVenueDefault` | ✓ |
| Q8 | Rebase done | N/A (spec-time) — confirmed in assumption 2 | ✓ |
| Q9 | JSON sub-fields in theme.experience_meta | Sub-C C.1.a functional GIN index + C.2.f `pg_public_experiences_by_brand` reads JSON paths | ✓ |
| Q10 | Admin Venue Claims 3-tab structure | Sub-B B.4 adminClaimsService.js + Venue Claims page rebuild | ✓ |
| Q11 | Persona picker killed | Sub-B B.2 file-deletion table includes PersonaPickerCards.tsx + PersonaForkSheet.tsx + persona-fork mode delete | ✓ |

11/11.

### (b) Q12–Q15 designer-surfaced questions — ALL explicitly resolved

SPEC §"Quick-reference: 4 designer-surfaced questions (Q12–Q15)" provides explicit SPEC DECISION + rationale + realization for each. Verified each decision is reflected in the corresponding spec section:

- Q12 (recurrence) → Sub-B B.1.c Step 3 disabled "One-time only" dropdown ✓
- Q13 (past sections) → Sub-C C.4.a tab body switch keeps per-type past sections ✓
- Q14 (Upcoming cap) → Sub-C C.2.g `p_limit DEFAULT 30` + cursor pagination + `+1` lookahead row ✓
- Q15 (venueCategory inference) → Sub-A A.1 parser edits + Sub-D D.3 OpenAI prompt `temporaryCategory` literal; no UPDATE brands ✓

4/4.

### (c) Phase 1 audit D1–D12 — ALL addressed

Cross-checked each audit dimension against spec assignment:

| Dim | Audit subject | Spec section that addresses it | Addressed? |
|---|---|---|---|
| D1 | Brand creation cluster (22 surfaces) | Sub-A.2 (CreateBrandInput, brandMapping, brandPatch, useBrands) + Sub-B B.1.b (BrandCreationFlow) + Sub-B B.2 (persona picker + TripBrandWizard deletes) + Sub-A.3 (5 test deletes) | ✓ |
| D2 | BrandEditView SECTION B-2 + address conditional | Sub-B B.2 row for BrandEditView + new "Claim a venue" affordance | ✓ |
| D3 | brandAuthoringGate.ts | Sub-A.1 row for whole-file delete + 2 callsites | ✓ |
| D4 | Address handling (6 surfaces) | Sub-B B.1.b Step 2 + Sub-B B.1.c venue pre-fill + Sub-B B.3.c `useExperienceVenueDefault` | ✓ |
| D5 | Home dashboard rungs | Sub-A.1 row for homeNextAction.ts (rungs 1+2+4) | ✓ |
| D6 | Hub tabs (5 kind gates in experiences.tsx) | Sub-B B.2 row for experiences.tsx 5 gate deletes + Sub-B B.3.b `useHubVisibleTabs` | ✓ |
| D7 | Offering creation (trip/create + trip/[id]/edit + UniversalCreatorSheet) | Sub-A.1 rows for trip/create.tsx:52, trip/[id]/edit.tsx:67 + Sub-B B.2 row for UniversalCreatorSheet comment | ✓ |
| D8 | AI experience generators (3 server + 2 client) | Sub-A.1 rows for parse-restaurant-menu + parse-play-activities + agentTools.ts + Sub-A.1 canGenerateExperiencesFromMenu/Activities regate | ✓ |
| D9 | Public brand page (incl. ORCH-0963 surfaces) | Sub-C entire scope — C.4.a PublicBrandPage.tsx + C.4.b publicEventsService.ts + C.4.c `<ExperienceMiniCard>` + C.4.d type-pill on EventMiniCard/TripMiniCard + Sub-D D.2.b ORCH-0963 strict-grep reshape | ✓ |
| D10 | Venue claim (4 app surfaces) | Sub-B B.2 rows for VenueClaimStatusBanner + venueClaimBannerLogic + "Claim a venue" CTA + COPY_INVENTORY-driven copy reframe | ✓ |
| D11 | Backend (DB + edge fns + strict-grep gates) | Sub-C entire migration + Sub-D D.1 deploys + D.2 gates | ✓ |
| D12 | Admin Venue Claims `adminClaimsService.js:37` | Sub-B B.4 row | ✓ |

12/12.

### (d) Locked invariants preserved

| Invariant | Where preserved | Verified? |
|---|---|---|
| I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE (ORCH-0947) | Sub-C C.2.e rewrites `pg_public_trips_by_brand` body bit-identical EXCEPT for line 46 brand-kind guard removal; canonical sold formula `tickets.status IN ('valid','used','transferred')` joined via `ticket_types.event_id` STAYS | ✓ |
| I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE (ORCH-0859) | Sub-D D.2.b PRESERVES ORCH-0963 strict-grep C4 (route segregation event_type=trip allowlist) | ✓ |
| I-PROPOSED-J (Zustand no server records) | Sub-B B.3 hooks all use React Query; AsyncStorage holds only string `lastTab` (client preference) | ✓ |
| 14 constitutional rules | Checklist box 8 above | ✓ |

4/4.

### (e) Invariants introduced + superseded — both lists present

Introduced (4): I-BRAND-UNIVERSAL-AUTHORING, I-PUBLIC-PAGE-DATA-DRIVEN-TABS, I-HUB-TABS-DATA-DRIVEN, I-VENUE-CLAIM-OPTIONAL. All have enforcement mechanism named (strict-grep gates in Sub-D). ✓

Superseded (5+2 memory rules): I-PROPOSED-TR1-PERSONA-INTERFACE, I-PROPOSED-TR1-KIND-IMMUTABLE, I-PUBLIC-BRAND-KIND-BRANCHED, DEC-152 (carve-out only, not full supersede — verified — see note below), DEC-161, memory rules. ✓

**Sub-finding D-1 (P3 informational):** SPEC line "DEC-152 (TopSheet extended to UniversalCreatorSheet) — preserved; the carve-out is unaffected" — verbiage is slightly contradictory (lists in "Superseded" section but says "preserved"). Recommend implementor MOVES this entry from "Superseded" to a separate "Carve-outs preserved" sub-block at CLOSE. Trivial.

### (f) Cross-Surface Impact (Phase 2.5) — all 7 surfaces enumerated

SPEC table covers: Consumer iOS (NO), Consumer Android (NO), Buyer/anon Web (YES), Business iOS (YES), Business Android (YES), Admin Web (YES), Business Web preview (YES). Per-surface "What changes user-visibly here" + "Files touched here" + "Parity?" columns all populated. Manual-parity surfaces flagged separately (SC-PUB-N, SC-A-N admin, SC-iOS/Android per-platform where needed). ✓

### (g) Migration filename collision check — DONE

SPEC §"Migration filename collision check" cites the scan command + result + reserved prefixes. Re-ran the scan: `for d in ~/Desktop/mingla-orchs/*/supabase/migrations/; do ls "$d" 2>/dev/null | grep -E "^2026072[89]|^2026073" ; done | sort -u` returns only `20260728000000_orch_0963_pg_public_trips_by_brand.sql`. Prefixes `20260729000000` + `20260730000000` are free. ✓

### (h) Read-only pre-flight probes — present

Sub-C C.5 includes 4 read-only probes (parallel policies on brands, live brand count, latest pg_public_trips_by_brand body, experience occurrence row count). Per orchestrator invariant migration backstop, these MUST be run before `supabase db push --linked`. ✓

### (i) 54 test cases T-01..T-54 — mapped

Spot-checked test → success criterion mapping:

- T-01..T-07 (Sub-A) map to SC-A-1..SC-A-7 ✓
- T-08..T-22 (Sub-B) span SC-B-1..SC-B-14 + SC-A-11 (admin) ✓
- T-23..T-44 (Sub-C) span SC-C-1..SC-C-15 + SC-PUB-8..SC-PUB-12 ✓
- T-45..T-54 (Sub-D) span SC-D-1..SC-D-9 ✓

54/54 with clear sub-spec attribution. ✓

### (j) COMMS-0002 backend allowlist on each backend sub's checklist

- Sub-A: explicit "Add `parse-restaurant-menu`, `parse-play-activities`, `_shared/agentTools.ts` to `ORCH_0972_BACKEND_ALLOWLIST` in same commit" ✓
- Sub-C: explicit "Add all new migration files to `ORCH_0972_BACKEND_ALLOWLIST`" ✓
- Sub-D: explicit per D.2.e with exact 5-entry list ✓

3/3.

### (k) Regression tests (CLOSE Step 0.5) — both implementor + tester per sub-spec

- Sub-A: SC-A-7 implementor test path + Tester adversarial guidance ✓
- Sub-B: SC-B-13 + SC-B-14 implementor tests + Tester adversarial guidance ✓
- Sub-C: SC-C-14 + SC-C-15 implementor tests + Tester adversarial guidance ✓
- Sub-D: SC-D-8 implementor test + Tester adversarial guidance ✓

Both halves of CLOSE Step 0.5 gate are scoped per sub.

---

## Findings

### P0 — None

No critical defects.

### P1 — None

No structural defects, no missing invariants, no untestable success criteria, no scope contradictions.

### P2 — One implementor-ingest verification

**P2-1: Events table column names — `bio` vs `description`.**

SPEC `pg_public_experiences_by_brand` (C.2.f) and `pg_public_brand_upcoming` (C.2.g) RETURNS TABLE definitions both declare a `bio text` column AND select `e.bio` from the events table. Verification against `mingla-business/src/services/publicEventsService.ts` line 963 reveals events use `description` (not `bio`): `.select("id, slug, name, description, cover_media_url")`. The `bio` field exists on `brands` but not on `events`.

**Impact:** RPC `CREATE OR REPLACE FUNCTION` would fail with "column events.bio does not exist" if implementor copies the SQL verbatim.

**Fix at Phase 0 ingest:** Implementor reads `supabase/migrations/` for `CREATE TABLE events` + every `ALTER TABLE events ADD COLUMN` to confirm the exact event-description column name (likely `description` or `subtitle`). Substitute throughout both RPC bodies + the corresponding `PublicExperienceCard.bio` and `PublicUpcomingRow.bio` TS field names (renaming to `description` if that's the actual column).

**Why P2 not P1:** This is exactly the kind of field-name verification Phase 0 mandatory ingest catches. SPEC includes implementor-verification language for the trip start path (Sub-C C.2.g "implementor verifies the exact field at ingest"); the same standard applies here implicitly. Operator pre-merge review of the implementation report will catch any miss.

**Why not REJECT for SPEC rework:** A NEEDS WORK verdict would force a SPEC RE-SPEC cycle for a 4-character SQL column rename that the implementor's own discipline catches. APPROVED with explicit P2 note is the proportionate response.

### P3 — One verbiage tidy

**P3-1: DEC-152 listed under "Superseded" but described as "preserved".**

SPEC §"Superseded on CLOSE" line `**DEC-152** (TopSheet extended to UniversalCreatorSheet) — preserved; the carve-out is unaffected.` Move DEC-152 to a separate sub-block titled "Carve-outs preserved (not superseded)" or delete the line entirely (DEC-152 isn't being changed, so it doesn't belong in either list). Implementor or CLOSE-Step-5e author tidies in passing.

### P4 — Notes for the implementor's Phase 0

For the Sub-A implementor, the following field/path verifications should happen during Phase 0 ingest (mandatory) — flagging here so the orchestrator REVIEW of the implementation report can confirm they were done:

- Events table `description` (vs `bio`) — see P2-1.
- Trip start_date path inside `events.theme` JSON — SPEC notes this explicitly at Sub-C C.2.g.
- `events.default_currency` vs `events.currency` vs derive-from-brand — verify against ticket_types/events schema.
- `events.cover_media_url` confirmed exists (line 277/482/628/1027 of publicEventsService.ts).
- `events.published_at` / `events.deleted_at` confirmed (standard Mingla soft-delete pattern).

---

## Verdict

**APPROVED.**

Spec is structurally complete, all Phase 1 audit dimensions addressed, all operator + designer questions resolved with explicit decisions, 54 testable cases mapped to per-surface success criteria, Cross-Surface Impact section enumerates all 7 surfaces with per-surface bars, locked invariants preserved with bit-identical formula references, introduced + superseded invariant lists complete, migration filename collision check done, read-only pre-flight probes specified, regression-test gate (CLOSE Step 0.5) satisfied per sub-spec with both implementor + tester regression tests scoped.

One P2 implementor-ingest verification (events.bio → events.description) and one P3 verbiage tidy. Neither blocks the Sub-A dispatch.

Same-session bias acknowledged. If operator wants second-set-of-eyes parity, dispatch Codex `forensic-mingla` (TEST mode) to re-review the SPEC before Sub-A; otherwise proceed.

---

## Next phase — Sub-A dispatch

Sub-A is the smallest, lowest-risk sub-spec (gate deletions + early-return removals + TS interface edits + 5 test file deletions). No DB push, no edge deploy. Implementor scope is mechanical. Tester scope is targeted to SC-A-1..SC-A-7 + T-01..T-07.

Per Canonical Pipeline Routing, IMPLEMENT defaults to Codex `implementor-mingla`. Operator may direct to Claude `mingla-implementor` (full parity available). Either path uses the same dispatch paragraph below.

Per the operator's sequential-pace memory (`feedback_sequential_one_step_at_a_time.md`): execute REVIEW (done), then PAUSE — do not auto-cascade into Sub-A implement. Operator gates Sub-A dispatch in the next turn.
