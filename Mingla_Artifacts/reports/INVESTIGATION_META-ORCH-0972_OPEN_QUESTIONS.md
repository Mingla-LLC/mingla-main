# INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access]
**Phase:** 1 of 4 — AUDIT (Open questions for operator before Phase 2 finalizes)
**Mode:** INVESTIGATE (read-only)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-25
**Companion to:** [Gap Audit](./INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md) + [Data Model Audit](./INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md) + [User Journey Gaps](./INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS.md)

This report consolidates the questions the operator (Seth) must answer before Phase 2 (user-journey design) can finalize the new flows. Each question carries: **status** (open / partially-answered / answered-pending-spec), **operator brainstorm-turn context** (where it was discussed), **why it matters** (what blocks if not answered), and **recommended default** (what Phase 2 designer assumes if operator stays silent).

Questions Q1–Q5 are from the orchestrator's brainstorm summary. Q6–Q7 are NEW from the operator's 2026-05-25 clarification on address handling + AI tools. Q8–Q11 are NEW discoveries from this audit.

---

## Q1 — Free vs paid contract: exact rule for when Stripe is required

**Status:** Partially answered (operator confirmed free offerings need no Stripe; exact rule still needs spec-level precision).

**Operator context:** Confirmed 2026-05-25 in turn 3: "Yes free offerrings should not need stripe."

**Why it matters:** Phase 4 Sub-B redesigns `homeNextAction.ts` rung 1 from a blanket "Stripe not active" blocker to a paid-offerings-only upsell. Phase 5 tester needs an unambiguous gate to verify.

**The 3 candidate rules** (Phase 2/3 must pick ONE):

- **Rule A — Per-offering price gate at publish.** Stripe-active required when publishing any offering with `price > 0` on ANY ticket tier. Free offerings (price=0 on all tiers, RSVP-only) publish without Stripe.
- **Rule B — Brand-level "has any paid intent" gate at publish.** Stripe-active required when publishing any offering that has EVER had a paid tier configured during drafting (even if currently 0). Prevents toggling-down-to-free as a Stripe bypass.
- **Rule C — Stripe required at publish ALWAYS.** Even free offerings need Stripe to publish (operator already rejected this).

**Recommended default:** **Rule A** — simplest, matches operator stated intent, easy to implement (check max tier price at publish time).

**Open sub-questions for Phase 3 spec:**
- Does an RSVP-with-deposit count as "free" or "paid"? (Recommendation: paid — deposit is money.)
- Does a free trip with optional add-ons count as "free" or "paid"? (Recommendation: paid if any add-on has price > 0.)
- Does the gate fire at draft creation (block draft) or at publish only (allow draft, block publish)? (Recommendation: publish-only; let users draft freely.)

---

## Q2 — Hub empty state: brand with literally zero offerings

**Status:** Open.

**Operator context:** Phase 2 designer territory; operator hasn't specified.

**Why it matters:** Under the new data-driven hub-tab rule (`I-HUB-TABS-DATA-DRIVEN`), a brand with zero events, zero trips, zero experiences would hide ALL hub tabs. The hub screen would be empty. UX dead-end.

**The 3 candidate behaviors:**

- **Option A — "Get started" placeholder tab.** Single placeholder tab labeled "Get started" with the same 3-button chooser (Event / Trip / Experience) as the home empty state. Mirrors home pattern.
- **Option B — Auto-redirect to home.** If user navigates to Hub with zero offerings, route them to Home. Avoids empty screen. Risk: feels jarring.
- **Option C — Show all 3 tabs (Events / Trips / Experiences) by default with per-tab empty state CTAs.** User can browse "what would this tab look like." Demonstrates capability. Risk: contradicts I-HUB-TABS-DATA-DRIVEN spirit.

**Recommended default:** **Option A** — placeholder tab with chooser. Matches the universal "3-button chooser as connective tissue" theme.

---

## Q3 — Default hub tab when multiple are visible

**Status:** Open.

**Operator context:** Phase 2 designer territory.

**Why it matters:** A brand with all 3 buckets populated (events + trips + experiences) needs a default tab on first navigation to Hub.

**The 5 candidate rules:**

- **Option A — Events always first.** Matches current default (Hub today opens Events). Familiar.
- **Option B — Most-recently-created-bucket.** Opens the tab matching whichever offering was most recently published.
- **Option C — Bucket with most upcoming items.** Opens the tab with the most upcoming/live offerings.
- **Option D — Bucket with most drafts (work-in-progress prompt).** Opens the tab with unfinished work to nudge completion.
- **Option E — Sticky to user's last-visited tab.** Persisted preference.

**Recommended default:** **Option E** (sticky last-visited, default to Events on first ever visit). Minimizes surprise, respects user agency.

---

## Q4 — Experiences in Upcoming tab on public brand page

**Status:** Open — blocked on data model decision (see Q9).

**Operator context:** Brainstorm turn 4 operator requirement: "One upcoming tab, that shows everything upcoming ordered by date." Implies experiences are in it. BUT data model audit reveals experiences have no occurrence date today.

**Why it matters:** The new "Upcoming" tab interleaves events + trips chronologically. Experiences need a sortable date to participate. If they have none, they either need a new field, get an arbitrary sort, or stay out of Upcoming.

**The 3 candidate behaviors:**

- **Option A — Experiences in Upcoming with new `next_occurrence_at` field.** Phase 3 spec adds the column (or theme sub-field) to experience rows. Maintenance burden: someone has to keep the field accurate.
- **Option B — Experiences in Upcoming as "always available" with no date sort.** Experiences appear interleaved but with a "Available now" or "Ongoing" label, sorted last in the chronological list.
- **Option C — Experiences NOT in Upcoming; only in Experiences tab.** Simplest. Upcoming = events + trips only.

**Recommended default:** **Option C** — simplest, matches current data model, can be upgraded to Option A later if operator validates experiences-in-Upcoming is a high-value UX signal.

---

## Q5 — TripBrandWizard collapse target

**Status:** Answered — clean delete + unify (confirmed by audit).

**Operator context:** Brainstorm turn 4 operator: "Kill it."

**Audit finding:** TripBrandWizard's 6-step flow (name → bio → cover → set default → set current → route to Stripe) is mechanically replicable in a unified `BrandCreationFlow`. No unique safety/UX behavior to preserve. The only "unique" UX is hardcoded `address: null` — which becomes the universal default in the new model.

**Action for Phase 2 designer:** define the unified `BrandCreationFlow` component. The 6 steps map 1:1. Cover picker step is preservable but can also be deferred to brand-edit (Phase 2 designer choice).

---

## Q6 — Where in the brand-creation flow do we ask for address? (NEW)

**Status:** Open — operator clarification request 2026-05-25.

**Operator context:** Brainstorm turn 5: "We need to also decide how to redesign the public brand pages to hold multiple options... We need to establish whether a brand has an address or not early in the flows (We need to decide where), so we can check if we extrapolate the location to the experience. we need to redesign the user journeys."

**Why it matters:** Address is the most-touched field across journeys (Journeys 1, 4, 6, 7, 8 all involve it). Phase 2 designer needs a coherent address-collection strategy. "Establish early" is operator preference, but "early" can mean (a) brand creation, (b) first offering, (c) ambient nudge.

**The 4 candidate behaviors:**

- **Option A — Asked during brand creation as optional input.** Single text field; can skip. Pre-fills downstream pre-existing address. Risk: most users skip it.
- **Option B — Skipped at brand creation; offered later as ambient nudge in Brand Edit.** Brand-edit screen shows a "Want to add an address?" banner. Lowest creation friction.
- **Option C — Only asked at first offering creation.** Experience creation asks per-experience venue; brand-level address is set via "Save this as your default brand location?" toggle.
- **Option D — Auto-populated only via opt-in venue claim.** Address is never directly typed; only arrives via Google Places match. Phase 2 must define what populates the address card for non-claimed brands (probably nothing — address card hidden).

**Recommended default:** **Option A + C combined** — ask once during brand creation as optional; if skipped, ask again at first experience-creation time (per Journey 4 / 8); from then on, pre-fill. Avoid Option B's risk of address never being collected. Avoid Option D's awkward "no address possible without a Google Places claim" implication for popup brands.

---

## Q7 — Experience venue defaulting rule (NEW)

**Status:** Open — operator clarification request 2026-05-25.

**Operator context:** Same turn as Q6: "The main idea is that when creating an experience, the venue of the experience should be put... so we can check if we extrapolate the location to the experience."

**Why it matters:** Experience offerings need venue data for buyer display + map placement. The data model audit revealed experience rows have no dedicated venue column today (lives in `theme` JSON or inherited from brand context).

**The 3 candidate behaviors:**

- **Option A — Always ask, always pre-fill if brand address present.** Experience creation form has a "Venue" field, defaulted to brand address if set. User can override per-experience (e.g., a touring chef holds different events at different venues).
- **Option B — Always ask, always blank by default.** No pre-fill. User explicitly types or selects each time. Verbose but unambiguous.
- **Option C — Default and let edit.** Pre-fill silently from brand address; user only edits if they need to override. Lower friction; risk: user doesn't notice and ships wrong venue.

**Recommended default:** **Option A** — explicit pre-fill, explicit field, user sees the value and can override. Best of both worlds: low friction + auditable.

**Phase 3 spec implications:**
- Add `theme.experience_venue: { address: string | null, place_id: string | null }` sub-object to experience rows OR add a new top-level `venue_text` column on events.
- Update experience creation flow to ask for venue field.
- Update buyer-side experience render to show venue (which doesn't exist today — experiences don't render on public page yet per Dim 9 audit).

---

## Q8 — Base-tree gap: rebase or stay (NEW)

**Status:** Operator decision needed before Phase 4.

**Audit discovery:** META-ORCH-0972 worktree is exactly 1 commit behind origin/main. The missing commit is `dd49d6d2b [deploy] Close ORCH-0963 (PR #215)` — the actual code merge for the kind-branched public-page IA. The orchestrator's spawn-time WORLD_MAP entry assumed ORCH-0963 was IN the worktree; the audit confirms it is NOT.

**Why it matters:**
- Phase 1 audit Dimension 9 catalogued the PRE-ORCH-0963 state (3-tab Upcoming/Past/About).
- Phase 4 implementation will land on a branch with `isTripBrand` branching, `<TripMiniCard>`, `<NextEventTeaser>`, `pg_public_trips_by_brand` RPC, and the ORCH-0963 strict-grep gate.
- If Phase 4 starts without a rebase, every PublicBrandPage / publicEventsService edit will conflict.

**The 2 options:**

- **Option A — Rebase now, before Phase 2 design.** Operator runs `cd ~/Desktop/mingla-main && git pull origin main`. META-ORCH-0972 worktree runs `git fetch origin && git rebase origin/main`. Phase 2 designer works against the post-rebase state. Phase 1 audit's Dimension 9 catalogue updated with the ORCH-0963 surfaces now actually in the worktree.
- **Option B — Defer rebase to Phase 4 start.** Phase 2 designer works against the pre-ORCH-0963 worktree. Phase 3 spec writer explicitly addresses both states (pre-rebase + post-rebase). Phase 4 implementor rebases before starting code.

**Recommended default:** **Option A** — rebase now. Lowest risk, fewest moving parts, designer + spec writer work against the same code state as implementor.

**Action items (if Option A):**
1. Operator: `cd ~/Desktop/mingla-main && git pull origin main`
2. Operator: confirm anchor is now on `dd49d6d2b` (PR #215 merge)
3. Forensics (next dispatch): `cd ~/Desktop/mingla-orchs/meta-orch-0972-[…] && git fetch origin && git rebase origin/main`
4. Forensics: re-spot-check `PublicBrandPage.tsx` and `publicEventsService.ts` to confirm `isTripBrand` is now present in this branch
5. Forensics: append a small supplemental note to Report 1 Dimension 9 confirming the ORCH-0963 surfaces are now in scope

---

## Q9 — Experience data-model enrichment: schema decision (NEW)

**Status:** Open — blocks Q4 and Phase 2 designer work on the new Upcoming tab.

**Audit discovery:** Experience rows live in `events` table with `event_type='experience'`. They carry `id, brand_id, title, description, slug, status, visibility, created_at, theme` — but NO occurrence date, NO venue address, NO recurrence rule. All structured data lives in `theme.experience_meta` JSON.

**Why it matters:**
- Q4 (experiences in Upcoming tab) needs an occurrence date to sort.
- Q7 (experience venue) needs a venue field.
- Public page experience render (currently nonexistent per Dim 9) needs both.

**The 3 candidate enrichment paths:**

- **Path A — Add explicit columns to `events` table.** New columns: `events.experience_next_occurrence_at timestamptz NULL`, `events.experience_venue_text text NULL`. Pro: queryable, indexable, type-safe. Con: column proliferation on the shared `events` table.
- **Path B — Add structured fields to `theme.experience_meta` JSON.** New fields: `theme.experience_meta.next_occurrence_at`, `theme.experience_meta.venue_text`. Pro: no schema change. Con: not natively queryable; requires JSONB indexing for sort/filter.
- **Path C — Create a dedicated `experience_instances` table.** Many-to-one with `events`. Each instance row has its own `start_at`, `end_at`, `venue_text`. Pro: rich recurrence semantics. Con: heavy lift; overkill if most experiences are single-instance.

**Recommended default:** **Path B for venue (theme.experience_meta.venue_text); Path A or Path B for occurrence date depending on Q4 answer.** Path C is overkill for the META-ORCH-0972 scope; can be a later upgrade.

**Cross-ref:** Phase 3 spec writer must pick one and define the migration + service-layer impact.

---

## Q10 — Admin Venue Claims filter signal replacement (NEW)

**Status:** Open — Phase 4 Sub-B implementation question.

**Audit discovery:** `mingla-admin/src/services/adminClaimsService.js:37` filters brands by `.eq("kind", "physical")` to populate the admin Venue Claims review queue. This is the ONLY remaining brand-kind dependency in the admin app (Dim 12 finding).

**Why it matters:** When `brands.kind` is dropped, this filter breaks. Admin venue claims queue would show zero brands.

**The 3 candidate replacements:**

- **Replacement A — `claim_status !== 'none'`.** Show any brand that has ever initiated a claim (pending, verified, or rejected). Matches the new opt-in claim flow (Journey 6).
- **Replacement B — `claim_status = 'pending_review'`.** Show only brands awaiting admin action. More focused queue; verified/rejected go to separate views.
- **Replacement C — Compound filter with sub-views.** Default view = pending_review only; sub-tabs for verified + rejected. Most powerful but more dev work.

**Recommended default:** **Replacement B for the queue itself, with a separate "All claims" view for verified+rejected.** Matches admin operational pattern of "queue = work to do."

---

## Q11 — Persona picker fate confirmation (already answered, included for completeness)

**Status:** Answered — kill it.

**Operator context:** Brainstorm turn 4: "Kill it."

**Audit finding:** Persona picker (PersonaPickerCards + PersonaForkSheet + BrandSwitcherSheet persona-fork mode) is mechanically deletable. No tests or callsites outside the brand-creation flow depend on it.

**Action for Phase 2 designer:** Replace BrandSwitcherSheet's persona fork with a single unified "Create brand" path. The 3-button chooser (Event / Trip / Experience) on Home empty state takes the educational role the persona picker used to play.

---

## Summary table — what's needed before each phase

| Phase | Blocked on |
|---|---|
| **Phase 2 (designer)** | Q1, Q2, Q3, Q4, Q6, Q7, Q8 (rebase decision), Q9 (experience schema), Q10 (admin filter), Q11 (already answered). Of these, Q5 and Q11 are already answered; the rest need operator input before designer can finalize. |
| **Phase 3 (spec writer)** | Phase 2 designer output + answers to all Qs |
| **Phase 4 Sub-A (universal authoring + DB constraint)** | Q8 (rebase) only — DB-side work is unblocked once rebase happens |
| **Phase 4 Sub-B (UX consolidation)** | Q2, Q3, Q6 (address collection), Q10 (admin filter), Q11 |
| **Phase 4 Sub-C (public page + experience data model)** | Q4, Q7, Q9 |
| **Phase 4 Sub-D (edge functions + tests + memory)** | Q1 (free vs paid rule) |
| **Phase 5 (tester)** | All Qs answered (testing needs unambiguous gates) |
| **Phase 6 (CLOSE)** | Phase 5 PASS + Step 5 decommission extension execution |

---

## Operator action items (in order)

1. **Answer Q8 (rebase decision)** — recommend Option A (rebase now). This unblocks Phase 1 supplemental refresh + Phase 2.
2. **Answer Q1 (free-vs-paid exact rule)** — recommend Rule A (per-offering price gate at publish).
3. **Answer Q2 (hub empty state)** — recommend Option A (placeholder tab with chooser).
4. **Answer Q3 (default hub tab)** — recommend Option E (sticky last-visited).
5. **Answer Q4 (experiences in Upcoming)** — recommend Option C (Experiences tab only; not in Upcoming). Cross-ref Q9 if Option A.
6. **Answer Q6 (address-collection location)** — recommend Option A+C combined.
7. **Answer Q7 (experience venue defaulting)** — recommend Option A (always ask + pre-fill if brand address present).
8. **Answer Q9 (experience schema path)** — recommend Path B (JSON theme sub-fields).
9. **Answer Q10 (admin filter replacement)** — recommend Replacement B with separate "All claims" view.

End of Report 4.
