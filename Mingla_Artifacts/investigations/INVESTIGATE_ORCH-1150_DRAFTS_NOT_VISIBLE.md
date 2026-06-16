# INVESTIGATE — ORCH-1150 [snap-autodraft-navigate]: auto-drafts not visible on Hub after navigation

**Date:** 2026-06-15
**Mode:** INVESTIGATE (no code changes)
**Worktree:** `~/Desktop/mingla-orchs/orch-1150-[snap-autodraft-navigate]` on branch `orch-1150-snap-autodraft-navigate`
**DB:** project `gqnoajqerqhnvulmnyvv` (read-only)
**Confidence:** **PROVEN** (DB row evidence + RPC definition + deterministic redirect logic). The only un-run step is the on-sim render; the source dictates it unambiguously and the redirect is NOT a timing race.

---

## Symptom (expected vs actual)

Seth snapped a food menu for brand **"Leggo This"** on a real device. The ORCH-1150 auto-draft flow ran ("Creating your experiences…"), then navigated him back to the Hub. **The experiences/drafts did NOT appear.** Auto-create + navigation worked; the drafts were invisible on arrival.

- **Expected:** land on Hub > Experiences (Drafts) with the 20 new drafts listed.
- **Actual:** landed on the Hub but on the **Events** tab; the Experiences pill is not even shown; the 20 drafts exist in the DB but are unreachable.

---

## Root cause (single, proven)

**The data-driven Hub visible-tab gate counts only PUBLISHED offerings. Draft experiences do not increment the "experiences" count, so the "Experiences" tab is absent from `visibleTabs`. The hub layout's nav-lock redirect then bounces any `router.replace('/(tabs)/hub/experiences')` straight back off the experiences route onto the brand's default tab (Events) — before the user can see the drafts.**

Deciding chain (all `path:line` in `mingla-business/`):

1. **The counts RPC excludes drafts.** `pg_brand_offering_counts` (live prod definition):
   ```
   count(*) FILTER (WHERE event_type='experience') AS experiences
   FROM public.events
   WHERE brand_id = p_brand_id AND deleted_at IS NULL AND published_at IS NOT NULL;
   ```
   `AND published_at IS NOT NULL` → the 20 unpublished drafts contribute **0**.

2. **`deriveHubVisibleTabs` only adds "experiences" when the count > 0** — `src/hooks/useHubTabs.ts:45`:
   `if (counts.experiences > 0) visible.push("experiences");`
   For Leggo This this is `0 > 0` → false → **"experiences" is omitted** from `visibleTabs`.

3. **The hub layout redirect bounces off the experiences route** — `app/(tabs)/hub/_layout.tsx:168-188`:
   computes `active = "experiences"` (line 172-173), then
   `if (!visibleTabs.data.includes(active)) { … router.replace('/(tabs)/hub/' + initialTab) }` (line 178, 186-187).
   Since "experiences" ∉ `visibleTabs`, it `router.replace`s to `targetTab` — the brand's initial tab, which resolves to **`events`** (Leggo This has 13 published events).

4. **The HubSubNav doesn't even render an Experiences pill** — `src/components/hub/HubSubNav.tsx:99-102` maps pills from `visibleTabs`; with "experiences" absent there is no pill to tap back to.

Net: the drafts render fine *if* you reach `/hub/experiences`, but the data-driven tab system makes that route unreachable for a brand whose only experiences are unpublished drafts.

---

## DB evidence (read-only, project gqnoajqerqhnvulmnyvv)

Brand "Leggo This" = `22a18413-bfbf-4087-9ba7-45f70deba0f3`.

Experience rows (event_type='experience', not deleted) grouped:
```
status=draft, visibility=draft : 21   (earliest 2026-06-16 01:18, latest 2026-06-16 02:18)
```
Per-minute: `01:18 → 1`, `02:18 → 20` (the 02:18 batch = Seth's reported snap). All `has_when_draft=false` (undated), all `deleted_at=null`. **Zero non-draft / upcoming / past experiences.**

`pg_brand_offering_counts(22a18413…)` truth (published-only):
```
events=13, trips=0, experiences=0
```
→ `visibleTabs = ["events"]` (+ "venue" iff physical/placepool). **No "experiences" tab.**

---

## Q-scorecard

- **Q1 — Were the drafts created in the DB?** **YES.** 20 draft experiences at 02:18 (+1 prior at 01:18), all `status='draft'`, `deleted_at=null`. **Verdict: H1 RULED OUT as root cause — creation works.**
- **Q2 — Cache invalidation vs nav timing?** Ordering is correct: `snap.tsx:149-160` awaits `confirmAll` then `await invalidateExperienceList()` (`usePendingExperiences.ts:148-155`) BEFORE `router.replace`. The drafts-list query DOES refetch on mount. **Verdict: H2 RULED OUT — not a timing/ordering defect for the list query.** (Second-order: `confirmAll` does NOT invalidate `brandKeys.offeringCounts` — `usePendingExperiences.ts:63-68` — but invalidation wouldn't help because the RPC excludes drafts regardless.)
- **Q3 — Query-key mismatch (drafts list)?** **NO.** Both producer and consumer use `experienceKeys.listByBrand(brandId)` — `usePendingExperiences.ts:66/151` vs `useExperiencesByBrand.ts:23`. **Verdict: H3 RULED OUT.**
- **Q4 — Default bucket filter excludes undated drafts?** **NO.** `deriveExperienceFilterBucket` buckets on `status==='draft'` FIRST (`experiences.tsx:124`), so undated drafts always land in the `draft` bucket. With 0 upcoming/past, `defaultFilter` resolves to `draft` (`experiences.tsx:177-182`), and "All" also includes the draft bucket (`experiences.tsx:223-224`). Drafts would be visible under the default IF the screen were reached. **Verdict: H4 RULED OUT** (a real but separate `useState(defaultFilter)` mount-capture staleness exists — see Discoveries — but it is NOT this bug, since the user never reaches the screen).
- **Q5 — Navigation target doesn't mount/refresh the tab?** **YES — but not via refetch.** `router.replace('/(tabs)/hub/experiences')` is intercepted by the hub layout redirect (`_layout.tsx:178/186-187`) and replaced with `/hub/events` because "experiences" ∉ `visibleTabs`. The experiences screen never renders. **Verdict: H5 HOLDS (the deciding mechanism), with the precise cause being the visible-tab gate, not a focus/refetch gap.** (There is also no `useFocusEffect`/refetch-on-focus anywhere under `app/(tabs)/hub/` — confirmed by grep — but that's moot here.)
- **Q6 — Brand scope mismatch?** **NO.** Drafts are under the correct `brand_id=22a18413…`; the hub reads the same `currentBrand.id`. **Verdict: H6 RULED OUT.**

---

## Findings (six-field)

### F-1 — CONFIRMED ROOT CAUSE — Hub visible-tab gate counts published-only; drafts make "experiences" tab unreachable; layout redirect bounces off it
1. **Symptom:** after snap→auto-draft→navigate, brand lands on Hub **Events**, not Experiences; no Experiences pill; 20 drafts invisible though present in DB.
2. **Layer:** schema (RPC) + code (hub layout/tab gate) — cross-layer.
3. **Probe:**
   - `SELECT pg_get_functiondef('pg_brand_offering_counts'::regproc);`
   - `SELECT count(*) FILTER (WHERE event_type='experience') … WHERE brand_id='22a18413…' AND deleted_at IS NULL AND published_at IS NOT NULL;`
   - read `app/(tabs)/hub/_layout.tsx:155-189`, `src/hooks/useHubTabs.ts:34-69`, `src/components/hub/HubSubNav.tsx:99-102`.
4. **Evidence:**
   - RPC body: `… AS experiences FROM public.events WHERE brand_id = p_brand_id AND deleted_at IS NULL AND published_at IS NOT NULL;` (drafts excluded).
   - Counts for Leggo This: `events=13, trips=0, experiences=0`.
   - `useHubTabs.ts:45` — `if (counts.experiences > 0) visible.push("experiences");`
   - `_layout.tsx:178` — `if (!visibleTabs.data.includes(active)) {` then `:186-187` `router.replace('/(tabs)/hub/' + initialTab)`.
5. **Mechanism:** 20 unpublished drafts → RPC returns experiences=0 → "experiences" omitted from `visibleTabs` → on `router.replace('/(tabs)/hub/experiences')` the layout's nav-lock effect sees `active="experiences"` ∉ visibleTabs and immediately replaces the route with the brand's default tab (`events`). The user never lands on the experiences list, so the (correctly created, correctly cached, correctly bucketed) drafts are never rendered.
6. **Severity:** **CONFIRMED ROOT CAUSE.**

### F-2 — SECONDARY — `confirmAll` does not invalidate `brandKeys.offeringCounts`
- `usePendingExperiences.ts:63-68` invalidates `pendingExperienceKeys.byBrand` + `experienceKeys.listByBrand` only. The publish/discard paths DO invalidate `brandKeys.offeringCounts` (`useDiscardOfferingDrafts.ts:107-108`). **Severity: SECONDARY ROOT CAUSE** — but note: even with this invalidation, the RPC's `published_at IS NOT NULL` filter means draft creation can NEVER raise the count, so F-2 alone does not fix F-1. Both must be considered together; the gate (F-1) is the load-bearing one.

### F-3 — SUSPECTED CONTRIBUTOR — `filter` state never re-syncs to `defaultFilter` after data loads
- `experiences.tsx:184` — `const [filter, setFilter] = useState<ExperienceFilter>(defaultFilter)` captures `defaultFilter` only at first render; no `useEffect` re-syncs it when counts arrive. Same pattern in `trips.tsx:156` and `events.tsx:253`. NOT this bug (user never reaches the screen) but a latent staleness: a fresh mount while the list is still loading captures `filter="all"`, which happens to still show drafts here — fragile. **Severity: SUSPECTED CONTRIBUTOR** (out of scope for this fix; flagged for orchestrator).

---

## Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction |
|-------|---------|---------------|
| Docs | SPEC SC-1 / IMPLEMENT report claim "drafts visible on arrival" | **Contradicts runtime** — verified only by unit test that `router.replace` is *called*, not that the screen renders (IMPLEMENT report line 119: "No sim/device run performed"). |
| Schema | `pg_brand_offering_counts` excludes `published_at IS NULL` | Authoritative: drafts uncounted. |
| Code | Hub layout redirect bounces off non-visible tabs (`_layout.tsx:178`) | Consistent with schema: experiences=0 → bounce. |
| Runtime | Sim run BLOCKED (cross-worktree Metro module error, see below) | Mechanism is deterministic (not timing-dependent), so source dictates the outcome. |
| Data | 21 drafts present, all unpublished; counts experiences=0 | Confirms the gate evaluates to 0. |

The load-bearing contradiction is Docs vs Runtime: the success criterion "drafts visible" was never live-fired; the unit test proved only that navigation was *attempted*, masking the layout-redirect bounce.

---

## Repro evidence

- DB queried read-only (above) — drafts exist, counts experiences=0. **Positive proof of the gate input.**
- Sim repro **BLOCKED (named blocker):** the booted iPhone 17 Pro sim has the business app installed (`com.sethogieva.minglabusiness`) but it is wired to a Metro server from a DIFFERENT worktree (`ORCH-1142-[notif-read-delete]`) and red-screens with `Unable to resolve module expo-image-manipulator from …/mingla-business/src/utils/normalizeTripDayImage.ts`. Driving this build would validate the wrong code; a clean dev build for THIS worktree was not performed (heavy, and the snap parse path needs a real menu image + OpenAI). Per Prime Directive 9 this is a genuine environment blocker; it caps the *sim* step but NOT the conclusion, because the root cause is a deterministic data-driven redirect (no timing/animation/keyboard element), fully proven by the DB state + the source.

---

## Blast radius / cross-surface map

- **Business iOS / Android (in scope):** any brand whose ONLY experiences are unpublished drafts cannot reach `/hub/experiences` — the entire ORCH-1150 auto-draft→curate loop is dead-ended for them. This is the *common* case immediately after a snap (drafts are unpublished by definition).
- **Same gate affects Trips:** a brand with only draft trips and 0 published trips is equally bounced off `/hub/trips` (`useHubTabs.ts:44`, same `published_at` RPC filter). Auto-draft is experiences-only today, so the user-facing break is experiences, but the gate defect is general.
- **Out of scope:** consumer app (no hub), web buyer surfaces (no hub), admin.
- **Recurring pattern:** "data-driven tab visibility keyed on a published-only count" vs "a flow that produces drafts." Any future draft-producing flow that navigates to a count-gated tab inherits this.

---

## Invariant impact (flag only, no fix chosen)

- `I-PROPOSED-1144-PARSERS-CATEGORY-AGNOSTIC` — unaffected (this is about reaching a parser, not the tab gate).
- The hub data-driven-tab contract (ORCH-1038/1145 nav-lock redirect, `_layout.tsx:155-189`) is the load-bearing invariant in tension: it deliberately bounces off non-visible tabs to prevent 404s/ghost tabs. The fix must not break that guard — it must make "experiences" *visible* (or whitelist the post-snap navigation) rather than disable the redirect.

---

## Discoveries for orchestrator

1. **DISC-1150-A (SECONDARY):** `confirmAll` omits `brandKeys.offeringCounts` invalidation (`usePendingExperiences.ts:63-68`). Even fixed, the published-only RPC means it won't help — see fix rec.
2. **DISC-1150-B (UX/product decision):** The Hub visible-tab gate counts published-only. Decide whether DRAFT offerings should make a tab visible. If "yes," `pg_brand_offering_counts` must count drafts (drop/relax `published_at IS NOT NULL`) and every count consumer (tab visibility, To-Do tiles) must be re-validated — broad blast.
3. **DISC-1150-C (latent):** `experiences.tsx:184` / `trips.tsx:156` / `events.tsx:253` `useState(defaultFilter)` never re-syncs to recomputed `defaultFilter` after async counts load — a fresh mount while loading sticks on `"all"`. Not user-visible today; flag for a hardening pass.
4. **DISC-1150-D (process):** SC-1 "drafts visible" was marked ✓ on a unit test that only asserts `router.replace` is *called*, not that the destination renders the drafts. The layout-redirect bounce slipped through because no live-fire navigation test exists. Recommend a tester gate that drives snap→navigate→assert-drafts-rendered on a draft-only brand.

---

## Recommended next phase + scope (direction only — NOT a fix)

**Next: SPEC (forensics) → IMPLEMENT.** The fix must make the just-created drafts reachable. Two viable directions for the SPEC to choose between (Open Question for Seth):

- **(A) Make draft offerings count toward tab visibility.** Relax `pg_brand_offering_counts` to include drafts (or add a `*_including_drafts` count), AND have `confirmAll` invalidate `brandKeys.offeringCounts`. Pro: the Experiences tab becomes a real peer the moment drafts exist (matches the new auto-draft mental model). Con: broad — every count consumer must be re-checked; product decision per DISC-1150-B.
- **(B) Scope the gate to the post-snap navigation only.** Make the hub layout redirect NOT bounce when the user explicitly navigated to `/hub/experiences` from the snap flow (e.g. force-include the destination tab for one navigation, or skip the redirect when the route was an explicit `replace` target). Narrower blast; preserves the published-only semantics elsewhere.

Either way the SPEC must add a live-fire success criterion: *on a brand with only draft experiences, snap→auto-draft→navigate lands on `/hub/experiences` with the N drafts rendered* (closes DISC-1150-D). Do NOT disable the nav-lock redirect wholesale (ORCH-1145 nav-away protection).

**This investigation proposes no code.** Root cause is proven; the SPEC selects the fix within the scope above.
