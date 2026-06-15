# INVESTIGATE — ORCH-1144 Universal Experience-Parser Chooser

**Skill:** mingla-forensics · **Phase:** INVESTIGATE · **Date:** 2026-06-15
**Surface:** Mingla Business app (`mingla-business/`, RN iOS + Android; business web preview adjacent)
**Mode:** code audit (UI restructure with locked decisions; no reproducer-bound runtime bug — see "Live-fire exemption" below)

> **Decisions are LOCKED by the dispatch** (remove banner; add 3-option chooser flat/unconditional;
> decouple both parsers from `brand.venueCategory`; rebuild Experiences tab to Trips/Events parity).
> This investigation does NOT relitigate them — it proves the current structure, the exact hook point,
> the remove/keep/relocate boundary, and the gate-removal blast radius so the SPEC can be built without
> guessing. **No fix is proposed here.**

**Live-fire exemption:** This is a UI-restructure with no symptom/reproducer (nothing is "broken at
runtime" — the dispatch is a feature change with pre-locked decisions). Per Prime Directive 7's
exemption for "code audit only" investigations, no simulator repro is required. Confidence is bound to
source evidence (`proven` for structural facts read verbatim; the gate-removal verdict is `proven` from
reading both edge functions end-to-end).

---

## Symptom summary (current vs. desired)

| | Current behavior (proven from source) | Desired (locked by dispatch) |
|---|---|---|
| Reaching a parser | `experiences.tsx` route picks the parser from `currentBrand.venueCategory`: `restaurant`→Ve5 menu, `play`→Ve6 activities, `creative_and_arts`/everything-else→**neither** (only a "Create experience" manual CTA). | Every brand can reach BOTH parsers + manual, unconditionally, via a 3-option chooser. |
| The snap CTA | A banner `Pressable` (`experiences.tsx:263-278`) titled "Snap your menu to generate experiences", shown only when `canSnap` (= category match + verification). | Banner removed; the snap entry moves into the chooser off the top-bar `+` (and off the tab's create CTA). |
| Experiences tab list | Flat `ScrollView` with the banner on top, a "Your experiences" header, and a single un-pilled list. NO filter pills (unlike Trips/Events). | Plain drafts/live list at PARITY with Trips/Events (filter pills, buckets, empty states, multi-select). |
| Brands previously "neither" (`creative_and_arts`/null) | Saw NO snap CTA at all (`experiences.tsx:539-575`) — stranded from both parsers. | Can reach both parsers via the chooser. |

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `mingla-business/app/(tabs)/hub/experiences.tsx` | component | The screen to rebuild; banner + `venueCategory` branch live here |
| 2 | `mingla-business/src/components/ui/UniversalCreatorSheet.tsx` | component | The `+` create flow — where "Create experience" routes today |
| 3 | `mingla-business/app/(tabs)/hub/_layout.tsx` | component | Mounts the `+` button + the UniversalCreatorSheet; owns creator state |
| 4 | `mingla-business/src/store/hubCreatorStore.ts` | state | Shared flag a sub-route uses to open the chooser from the layout |
| 5 | `mingla-business/app/experience/coming-soon.tsx` | component | Dead placeholder route (UniversalCreatorSheet no longer points here) |
| 6 | `mingla-business/app/(tabs)/hub/trips.tsx` | component | PARITY reference #1 (filter pills + buckets + multi-select) |
| 7 | `mingla-business/app/(tabs)/hub/events.tsx` | component | PARITY reference #2 (5 pills + universal empty state) |
| 8 | `mingla-business/app/experience/create.tsx` | component | The manual wizard route (chooser option 3 target) |
| 9 | `mingla-business/src/hooks/usePendingExperiences.ts` | hook | `parseMode`-branched parse mutation; already an explicit param |
| 10 | `mingla-business/src/utils/canGenerateExperiencesFromMenu.ts` | util | Verification/category predicate (Ve5) |
| 11 | `mingla-business/src/utils/canGenerateExperiencesFromActivities.ts` | util | Verification/category predicate (Ve6) |
| 12 | `mingla-business/src/components/experience/MenuSnapInput.tsx` | component | Ve5 snap sheet (kept; prop shape) |
| 13 | `mingla-business/src/components/experience/ActivitiesSnapInput.tsx` | component | Ve6 snap sheet (kept; symmetric prop shape) |
| 14 | `mingla-business/src/components/experience/ExperienceListCard.tsx` | component | Parity list card (already exists, currency-aware) |
| 15 | `mingla-business/src/services/experienceGenerationService.ts` | service | parse/confirm/reject; `agent_pending_actions` write |
| 16 | `mingla-business/src/services/experiencesService.ts` | service | `VenueExperience` shape (currency/status/slug already present) |
| 17 | `supabase/functions/parse-restaurant-menu/index.ts` | edge fn | Ve5 server gate (ownership only — no category gate) |
| 18 | `supabase/functions/parse-play-activities/index.ts` | edge fn | Ve6 server gate (ownership only — no category gate) |
| 19 | `mingla-business/app/(tabs)/hub/__tests__/hubExperiences.contract.test.ts` | test | Asserts the EXACT branch being removed → must be rewritten |
| 20 | `mingla-business/src/types/brand.ts` | types | `VenueCategory` union + optional `venueCategory` field |
| 21 | `Mingla_Artifacts/design/ORCH-1144/COPY_ORCH-1144_EXPERIENCE_CREATE_CHOOSER.md` | copy | Named-slot strings (cross-referenced, not invented) |

---

## Q-scorecard

### Q1 — What does the top-bar `+` open, and where does "Create experience" route today?

**Verdict (proven):** The `+` (an `IconChrome icon="plus"`) is rendered in `app/(tabs)/hub/_layout.tsx:199-207`
and opens the lazy-loaded `UniversalCreatorSheet` (`_layout.tsx:203` sets `isUniversalCreatorOpen=true`;
mounted at `_layout.tsx:244-251`). The sheet (`UniversalCreatorSheet.tsx:58-85`) renders a fixed 3-row
list — `event`/`experience`/`trip`. The **"Create experience"** row routes **directly** to
`/experience/create` (`UniversalCreatorSheet.tsx:71-73`: `route: "/experience/create"`), via
`handleSelect → router.push(option.route)` (`UniversalCreatorSheet.tsx:94-105`). **This `/experience/create`
push is the exact hook point** for the new pre-step: instead of routing straight to the manual wizard,
choosing Experience must open the new 3-option chooser, whose three options route to Ve5 snap / Ve6 snap /
`/experience/create`.

> The same UniversalCreatorSheet is also mounted on Home (`home.tsx`), Account (`account.tsx`),
> Marketing (`marketing/_layout.tsx`), and reached from the Hub getstarted + the shared `hubCreatorStore`
> flag (`store/hubCreatorStore.ts`). Because the "Create experience" routing lives in ONE place
> (`UniversalCreatorSheet.tsx`), the hook is single-point and covers every `+` surface at once.

### Q2 — The Trips & Events Hub tabs: the parity pattern to copy

**Verdict (proven):** Both `trips.tsx` and `events.tsx` share one structural skeleton the Experiences tab
must adopt. Enumerated precisely (to copy):

1. **Root `<View style={styles.host}>` (flex:1)** — NOT a single ScrollView (`trips.tsx:258-259`,
   `events.tsx:578-579`).
2. **A horizontal filter-pills `ScrollView`** as the FIRST child, sibling to the list ScrollView, with
   `style={styles.pillsScroll}` carrying `flexGrow:0, flexShrink:0` (`trips.tsx:263-297` + `:537-543`;
   `events.tsx:583-627` + `:936-958`). The `flexGrow:0` is **mandatory** per
   `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` (cited in both files) — without it the
   two ScrollViews split vertical space and the list pushes ~200pt down.
3. **Pill spec shape:** `{ key, label, count }[]` derived from bucket counts (`trips.tsx:199-207`,
   `events.tsx:316-330`). Trips uses 4 pills (All/Upcoming/Past/Drafts); Events uses 5
   (All/Live/Upcoming/Drafts/Past with a live-pulse dot). Pill visual height 34pt + `hitSlop` top/bottom 5
   = 44pt touch target (`trips.tsx:281` + `:548-558`).
4. **Bucketing + sort:** Trips derives `upcoming/past/draft` buckets via `deriveTripFilterBucket`
   (`trips.tsx:94-104`), sorts upcoming asc / past desc / drafts by `updatedAt` desc (`:126-140`).
   Events buckets by `deriveCardStatus` into live/upcoming/past/draft (`events.tsx:227-313`).
5. **`defaultFilter` fallback chain** — first non-empty bucket wins (`trips.tsx:149-154`,
   `events.tsx:245-251`).
6. **List ScrollView** with `contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}`
   to clear the floating BottomNav (`trips.tsx:299-305`, `events.tsx:629-639`).
7. **Empty states** in a `GlassCard variant="elevated"` keyed off the active filter
   (`trips.tsx:306-318`, `events.tsx:641-689`). Events additionally has a **universal "Nothing created yet"**
   empty state via `useBrandOfferingCounts` (`events.tsx:185-190`, `:642-663`) whose CTA calls
   `openOfferingChooser` (the `hubCreatorStore` flag).
8. **Long-press multi-select + bulk delete (drafts only):** `useDraftMultiSelect` + `useDiscardOfferingDrafts`
   + `DraftSelectBar` + a count-aware `ConfirmDialog` + the `bulkToastMessage`/`bulkDeleteErrorMessage`
   helpers (`trips.tsx:161-189` + `:424-468`; `events.tsx:219-224` + `:544-571` + `:812-897`). The
   "Press and hold a draft to select multiple" hint (`trips.tsx:321-326`, `events.tsx:694-699`).
9. **Shared list card primitives:** `TripListCard` (`trips.tsx:335-354`) / `EventListCard`
   (`events.tsx:708-730`), each wired with `onOpen` (toggle in selection mode else route),
   `onManageOpen`, `selectionMode`, `selectable`, `selected`, `onLongPress`.
10. **Desktop grid:** `isWideDesktop && styles.desktopListGrid` + `desktopListCell` width
    `100/DESKTOP_HUB_GRID_COLUMNS %` (`trips.tsx:327-333` + `:526-536`; `events.tsx:700-707` + `:1030-1040`).
11. **Manage sheet + Share modal** lazy-loaded per row 3-dot (`trips.tsx:369-422`; events uses
    `EventManageMenu` `:745-770`).

**Crucial parity gap:** `experiences.tsx` TODAY has NONE of #2/#3/#4/#5/#7-pills — it is a flat single
ScrollView (`experiences.tsx:257-383`) with the banner on top and a single "Your experiences" header
(`:312`). The rebuild adds the pill+bucket skeleton. **The good news:** the Experiences tab ALREADY
consumes the shared multi-select stack (`useDraftMultiSelect`/`useDiscardOfferingDrafts`/`DraftSelectBar`/
`ExperienceListCard`/`OfferingManageSheet`) — `experiences.tsx:190-191`, `:336-380`, `:433-489` — so the
card-row, selection, and manage-sheet halves are already at parity. Only the **pill/bucket header +
empty-state structure** must be added, and the **banner + venueCategory router** removed.

### Q3 — Current Experiences-tab structure: REMOVE vs KEEP vs RELOCATE

**Verdict (proven):**

**REMOVE (delete from `experiences.tsx`):**
- The banner `Pressable` block (`experiences.tsx:263-278`) + `cta`/`ctaPressed`/`ctaDisabled`/`ctaTitle`/
  `ctaBody` styles (`:595-614`).
- `RESTAURANT_COPY` + `PLAY_COPY` constants (`:72-98`) — the `ctaTitle`/`ctaBody`/`ctaA11y`/`unverifiedHint`
  banner slots become dead. (The loading/empty/error sub-slots relocate — see below.)
- The `canSnap` prop + the `canGenerateExperiencesFromMenu`/`canGenerateExperiencesFromActivities` imports
  (`:52-53`) and their call sites (`:520`, `:533`) — the gate for *reaching* the parser.
- The `venueCategory`-branched `HubExperiencesRoute` body (`:494-575`): the `restaurant`→Ve5, `play`→Ve6,
  `creative_and_arts`→placeholder, else→placeholder branches collapse to ONE unconditional surface.

**KEEP (survives, in place or relocated within the file):**
- `ExperienceGenerationSurface`'s parse/review machinery: `usePendingExperiences(brandId, parseMode)`
  (`:166-173`), `handleFilesReady` (`:216-241`), the parsing spinner (`:280-285`), `ExperienceReviewCards`
  (`:287-310`), the snap sheet mount `<SnapInput …>` (`:385-389`).
- The whole multi-select + bulk-delete stack (`:190-214`, `:398-442`) and the `OfferingManageSheet`/
  `ShareModal` mounts (`:444-489`). These already match Trips/Events.
- `ExperienceListCard` rows (`:337-380`) — already the parity card.
- The `normalizeExperienceStatus` + `bulkToastMessage`/`bulkDeleteErrorMessage` helpers (`:103-138`).

**RELOCATE / RESHAPE:**
- `parseMode` must now come from the **chooser pick**, not `venueCategory`. Today `parseMode` is passed
  into `ExperienceGenerationSurface` by the route component (`:518`/`:531`). After the rebuild the snap flow
  is reached via the chooser (a dedicated route/sheet per parser) carrying an **explicit** `parseMode`.
- The non-banner `GenerationCopy` sub-slots that survive (loading/emptyParseToast/parseErrorFallback) move
  into the snap-flow screens (Section 3 of the copy doc), keyed by the explicit `parseMode` rather than by
  `RESTAURANT_COPY`/`PLAY_COPY` selected from category.
- The list rebuild: wrap the existing `ExperienceListCard` rows in the Trips-style pill+bucket skeleton; the
  empty-state `GlassCard` (`:315-327`) gets the new copy-doc Section-4 strings.

### Q4 — Snap flows post-decoupling: can `usePendingExperiences(brandId, parseMode)` take an explicit pick?

**Verdict (proven):** Yes — cleanly. `usePendingExperiences` ALREADY takes `parseMode` as a normal second
arg (`usePendingExperiences.ts:32-35`) and branches the parse mutation on it (`:48-58`:
`parseMode === "activities" ? parsePlayActivities(...) : parseRestaurantMenu(...)`). The hook itself NEVER
reads `venueCategory`. The ONLY two places `parseMode` is currently *derived* from `venueCategory` are
`experiences.tsx:518` (`parseMode="menu"`) and `:531` (`parseMode="activities"`) — both inside the
category-branched route component. A repo-wide grep confirms no other inference site
(`grep parseMode` → only the hook, the surface prop, and these two literals). After decoupling, the
chooser passes `parseMode="menu"` or `"activities"` based on which option the user tapped. The two snap
sheets are **prop-symmetric** (`MenuSnapInput.tsx:30-34` and `ActivitiesSnapInput.tsx:30-34` both expose
`{ visible, onFilesReady, onCancel }`), so a single generic snap-flow host can mount either by parseMode.

### Q5 — Verification-gate removal blast radius

**Verdict (proven):** The gate is a pure CATEGORY router, NOT a money/trust gate. Evidence:

- `canGenerateExperiencesFromMenu` (`canGenerateExperiencesFromMenu.ts:8-11`) returns
  `brand.venueCategory === "restaurant"`. `canGenerateExperiencesFromActivities`
  (`canGenerateExperiencesFromActivities.ts:8-11`) returns `brand.venueCategory === "play"`. Despite the
  legacy filename, neither checks verification status — they are one-line category equality checks.
- **Only consumer of either predicate is `experiences.tsx`** (`:520`, `:533`) plus the contract test
  (`hubExperiences.contract.test.ts:20`) and unit tests. Removing them from the create surface touches
  nothing else (`grep` proven — see "Blast radius" table below).
- **The real trust gate lives server-side and is preserved.** `parse-restaurant-menu/index.ts:145-157`
  selects the brand and **rejects unless `brand.account_id === userId`** (403 FORBIDDEN, `:155-157`). There
  is NO `venue_category` gate — `temporaryCategory` is a hardcoded `"restaurant"` constant (`:159`),
  `sourceCategory` is only logged (`:160`). Identical pattern in `parse-play-activities/index.ts:154-166`
  (hardcoded `"play"` `:166`). The parser's only effect is inserting **DRAFT proposals** into
  `agent_pending_actions` with `tool_name: "create_experience"` (`parse-restaurant-menu:205-218`) — no
  publish, no charge. Confirm/reject route through `confirmAgentAction`/`cancelAgentAction`
  (`experienceGenerationService.ts:124-135`), which create a DRAFT shell the brand must finish (stops +
  date + price) before publish (per the META-ORCH-1059 comment, `experiences.tsx:297-301`). Money is gated
  DOWNSTREAM at publish/checkout (`ticket-checkout-create`'s `stripe_account_not_ready` 409, per
  [[project_orch_1073_paid_publish_integrity_guards]]).

**Conclusion:** Removing the client `venueCategory` routing for *reaching* the parser removes ZERO genuine
money/trust gate. The brand-ownership 403 + the draft-only write + the downstream publish/paid gates are
all untouched.

### Q6 — Constitution check

**Verdict (proven):**
- **No dead taps:** all three chooser options route somewhere real — Ve5 snap flow, Ve6 snap flow,
  `/experience/create`. (Each must be wired; the SPEC enforces this as SC-3/SC-4/SC-5.)
- **No fabricated data:** the chooser describes three REAL, live paths (Ve5/Ve6 parsers + manual wizard all
  shipped under META-ORCH-1059). Copy stays honest ("suggests… accept, edit, or reject"), per copy doc.
- **Currency-aware:** prices appear only on `ExperienceListCard`, which already formats via `formatCurrency`
  from `VenueExperience.currency` (`experiencesService.ts:121-124`, `:143`). No new price surface; parity
  preserved.
- **Fixes the "neither" stranding exactly:** brands with `venueCategory === "creative_and_arts"` or `null`
  TODAY hit `experiences.tsx:539-575` and see NO snap CTA — only a manual "Create experience" button. The
  unconditional chooser gives them both parsers, fixing precisely the stranding the dispatch names.

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | Copy doc (`COPY_ORCH-1144_...md`) + memory ([[feedback_brand_kind_decommissioned]] — "universal authoring, Stripe gates money not authoring") say experience authoring is universal. | The category router contradicts the decommission doc — it gates *which* parser by category, a vestige of pre-decommission brand-kind thinking. **The router is the drift; the doc holds truth.** |
| **Schema** | `agent_pending_actions` accepts any owner's `create_experience` proposal; `brands.venue_category` is informational. | None. Schema never gated the parser by category. |
| **Code** | `experiences.tsx:513-537` routes parser by `venueCategory`; the edge fns do NOT. | **Contradiction between client and server:** the client over-gates (category), the server only gates ownership. The client is the source of the stranding. |
| **Runtime** | (Not run — code-audit exemption.) Ownership-gated parser returns draft proposals only. | n/a |
| **Data** | `VenueExperience` rows carry `currency`/`status`/`slug` (`experiencesService.ts:19-31`). | None — parity card has the data it needs. |

The load-bearing contradiction: **the client category-router is stale brand-kind logic that the
server never enforced.** Removing it aligns client to server + to the decommission invariant.

---

## Repro evidence

Not reproduced — code-audit investigation, no runtime symptom (UI restructure with locked decisions).
Negative-verdict honest: there is no "bug" to reproduce; the dispatch is a feature change. All structural
claims above are read verbatim from source with `path:line` citations.

---

## Blast radius / cross-surface map

| Surface | In scope? | Why |
|---|---|---|
| Business iOS | YES | Primary surface — chooser + tab rebuild + decouple |
| Business Android | YES | Same RN code; Android glass opaque-fallback policy applies to the new chooser sheet |
| Business Web preview (adjacent) | YES (preview-parity) | Same RN-web code path; snap sheets already use `browserFilePicker` (web-aware) — `MenuSnapInput.tsx:17-23` |
| Consumer iOS / Android | NO | `parse-restaurant-menu`/`parse-play-activities` are business-only (zero `app-mobile/` hits, prior finding aef23f9e re-confirmed); no consumer surface touched |
| Buyer/anon Web | NO | Public offering pages unaffected; this is a founder-only create flow |
| Admin Web | NO | No admin surface for experience creation |

**Grep-proven decouple blast radius (consumers to touch):**
- `canGenerateExperiencesFromMenu` → ONLY `experiences.tsx:53,520` + its unit test + `hubExperiences.contract.test.ts` (no other prod consumer).
- `canGenerateExperiencesFromActivities` → ONLY `experiences.tsx:52,533` + its unit test + `hubExperiences.contract.test.ts:20`.
- `parseMode` inference → ONLY `experiences.tsx:518,531`.
- Banner copy string "Snap your menu" / "Generate from your activities" → ONLY `experiences.tsx`.
- Other `venueCategory` consumers (`venue/create.tsx`, `PublicBrandPage.tsx`, `poolSearchService.ts`,
  `brandMapping.ts`, etc.) are UNRELATED to experience-parser reaching — **do NOT touch**.

---

## Invariant impact

- **Aligns with** I-BRAND-UNIVERSAL-AUTHORING (META-ORCH-0972, [[feedback_brand_kind_decommissioned]]):
  "every brand creates events/trips/experiences universally; Stripe gates money not authoring." The current
  category-router VIOLATES the spirit of this invariant (it gates *which authoring tool* by category);
  removing it strengthens compliance.
- **Preserves** the server ownership gate (`account_id === userId`) and the draft-only `agent_pending_actions`
  contract — no money/publish invariant touched.
- **Proposes (DRAFT, for the SPEC):** `I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC` — "the experience snap
  parsers (Ve5 menu, Ve6 activities) are reachable by EVERY brand unconditionally; no `venueCategory` or
  verification predicate may gate *reaching* a parser. parseMode is chosen explicitly by the user, never
  derived from the brand."

---

## Discoveries for Orchestrator (side issues)

1. **`hubExperiences.contract.test.ts` is a fails-on-this-change test.** Lines 13-21 assert the EXACT
   `venueCategory === "restaurant"` / `=== "play"` branch + `canGenerateExperiencesFromActivities` that
   ORCH-1144 removes. It MUST be rewritten (the SPEC replaces it with an inverse "no venueCategory branch in
   the create surface" guard). Not a defect — flagged so the implementor doesn't try to keep it green.
2. **`app/experience/coming-soon.tsx` is dead.** `UniversalCreatorSheet` routes to `/experience/create`,
   not `/experience/coming-soon`; nothing else pushes coming-soon (grep-proven). Its copy still markets an
   unshipped flow ("Coming soon… in a few weeks"). The copy doc (`:177`) flags it for retire/reconcile. The
   SPEC should either delete the route or leave it untouched as off-scope — flag for Seth.
3. **COMMS-0027 (OTA cache poisoning) + COMMS-0028 (GIPHY key in OTA)** are open `ALL`-WARN entries relevant
   at the IMPLEMENT/deploy stage (this feature is pure-JS RN → OTA-shippable per
   [[project_ota_deferred_until_new_build]]; concurrent OTA from symlinked worktrees poisons the Metro
   cache). Not a forensics action now; carry to the implementor/closer notify-list.
4. **Legacy predicate filenames** `canGenerateExperiencesFromMenu`/`...Activities` imply a verification gate
   that never existed in code (they're one-line category checks). On removal, delete the files + their unit
   tests rather than rewording.

---

## Confidence

**proven** for all structural facts (read verbatim, `path:line` cited) and for the gate-removal verdict
(both edge functions read end-to-end — ownership-only gate, draft-only write). No runtime repro needed
(code-audit exemption; no symptom).

## Recommended next phase + scope

**SPEC** (this dispatch is INVESTIGATE-then-SPEC). Recommended scope (direction only, NOT a fix):
(a) intercept the UniversalCreatorSheet "Create experience" route with a 3-option chooser; (b) wire the
chooser off BOTH the `+` flow and the Experiences-tab create CTA (banner gone); (c) make `parseMode`
explicit from the pick; (d) rebuild the Experiences tab to the Trips pill/bucket skeleton, reusing the
already-present `ExperienceListCard`/multi-select/manage stack; (e) delete the banner + `venueCategory`
router + the two predicate files; (f) rewrite the contract test to a fails-on-revert guard; (g) consume the
named copy slots from the copy doc verbatim. Keep the parse/review/confirm machinery + server functions
untouched.
