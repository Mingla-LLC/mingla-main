# INVESTIGATION — ORCH-1138 Leg 3: implemented experience page vs the approved mockup

**Mode:** INVESTIGATE (no fix proposed). **Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` · branch `ORCH-1138-experience-page` · HEAD `dfac42cf3`.
**Contract under test:** `Mingla_Artifacts/design/ORCH-1138/EXPERIENCE_DIRECTION_A_RESPONSIVE.html` (Direction-A, approved).
**Trigger:** Seth tested the shipped-to-dev experience page (Leg 3) → "looks NOTHING like" the mockup; questions whether SCHEDULING has real parity.
**Comms:** scanned `COMMS_LEDGER.md` — no BLOCK/WARN row addressed to forensics, ORCH-1138, or ALL that is OPEN and applicable. No new cross-ORCH discovery to write.

---

## Symptom summary (expected vs actual)

| | Expected (approved mockup) | Actual (what Seth saw — consumer app) |
|---|---|---|
| Look | Brand-themed immersive parallax page with vibe chips, per-stop photo galleries, a map, restaurant-style booking | A near-default-dark detail sheet: city eyebrow + title, ONE city chip, brand row, about, generic "Stop N" list with a single photo each, a Reserve bar. No vibe chips, no map, no themed accent (brand has none set), no open-daily booking. |

The complaint is accurate **for the surface Seth actually touched (consumer app)**. The web/business surface is much closer to the mockup but still has concrete divergences. The scheduling intelligence is **structurally non-functional on prod** because its data supply (the recurrence materializer) was authored but never applied.

---

## Investigation manifest (every file read, in trace order)

1. `Mingla_Artifacts/design/ORCH-1138/EXPERIENCE_DIRECTION_A_RESPONSIVE.html` — the contract (1245 lines, full).
2. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1138_LEG3_EXPERIENCE_PAGE.md` — the implementor's claims.
3. `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` — web/business public route.
4. `mingla-business/src/components/experience/ExperiencePreview.tsx` — web/business renderer (FOUNDATION + LEGACY).
5. `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` — the NEW consumer screen (what Seth saw).
6. `mingla-business/src/components/experience/ExperienceReservePicker.tsx` — web adaptive picker (slots + open-daily).
7. `app-mobile/src/components/expandedCard/ExperienceOccurrencePicker.tsx` — consumer adaptive picker (ORCH-1072, pre-existing).
8. `supabase/migrations/20261005000000_orch_1138_experience_recurrence_materializer.sql` — the recurrence supply migration.
9. `app-mobile/src/types/mergedDiscover.ts` — consumer deck card supply shape.
10. `mingla-business/src/services/publicExperienceService.ts` — web read-path.
11. Live prod (`gqnoajqerqhnvulmnyvv`, read-only SQL): migration-applied check, live-experience inventory, theme/stop data.

---

## Q-scorecard

- **Q1 — Is the WEB/business page actually on the Direction-A foundation, or a flat/partial render?**
  **Verdict:** On the foundation (ParallaxCoverShell + palette + chrome + vibe chips + stop spine + count-aware gallery + map + float→dock TripReserveBar + desktop 2-column sticky panel). BUT with 6 concrete divergences from the mockup (F-1). `proven` (source-read; runtime render blocked, see Repro).

- **Q2 — Does the CONSUMER screen (what Seth saw) match the foundation/mockup, or is it divergent?**
  **Verdict:** Materially divergent and data-starved. It composes the parallax/chrome/scroll shell correctly but is MISSING vibe chips, per-stop photo galleries (single image only), the map, the date/availability meta chip, the state banner, real brand theming for the live brand, and the entire open-daily booking flow. `proven` (source-read; sim blocked — same blocker the implementor reported).

- **Q3 — single-date → straight to cart?**
  **Verdict:** Works (web + consumer). `proven` (source).

- **Q4 — multi-date / recurring → slot picker?**
  **Verdict:** The picker EXISTS and is wired, but it reads `event_dates`, and recurring experiences have only ONE materialized date on prod → the picker would show a single option. PARTIAL — UI present, data supply absent. `proven` (live prod: the one live recurring experience has `date_count=1`).

- **Q5 — open-daily → date + any-time-within-window + party-size?**
  **Verdict:** Web: the picker mode EXISTS (date list → time-in-window → party stepper) but only ever lists the single master date (no "any upcoming day"). Consumer: the open-daily flow is ENTIRELY ABSENT (consumer uses the flat ORCH-1072 slot list). Powered by NOTHING on prod (materializer unapplied). PARTIAL (web shell) / MISSING (consumer + data). `proven`.

- **Q6 — Does the authored materializer migration feed bookable slots the picker reads?**
  **Verdict:** NO. The migration is authored but NOT applied to prod; `pg_expand_experience_recurrence` does not exist and `biz_publish_experience` does not call it. The pickers are disconnected from real multi-occurrence supply. `proven` (live prod introspection).

---

## Findings (six-field evidence)

### F-1 — WEB/business page IS on the foundation, but diverges from the mockup in 6 concrete ways
- **Symptom:** Looks broadly like the mockup but not pixel/element-faithful.
- **Layer:** code.
- **Probe:** read `ExperiencePreview.tsx` (FOUNDATION branch) + `app/exp/.../[experienceSlug].tsx`.
- **Evidence:**
  1. **Eyebrow is wrong.** Mockup eyebrow = derived stop count ("3-stop experience"; mockup line 645/686). Impl eyebrow = `cityCountry` (`ExperiencePreview.tsx:357-361`, hero `:523-526`). The "N-stop experience" eyebrow is absent; City,Country is shown TWICE (eyebrow + meta chip `:375-379`).
  2. **Stop labels are generic.** Mockup uses "START HERE / THEN / END WITH" (lines 740/752/764). Impl renders `Stop {n}` (`ExperiencePreview.tsx:584-586`). The label helper EXISTS (`experienceWizardTypes.ts:65-67`) but the public renderer does not use it.
  3. **Map section title differs.** Mockup = "Where you'll start" (line 789). Impl = "Where you'll be" (`ExperiencePreview.tsx:444`).
  4. **Meta-row is thinner than the mockup.** Mockup meta-row has 4 chips incl. a "7:00 PM start" time chip and a "3 spots left · 12 max" seats chip (lines 691-697). Impl renders only `dateSubline` + `cityCountry` (`ExperiencePreview.tsx:369-380`) — no seats chip, no start-time chip.
  5. **Per-stop time pill rarely shows.** Impl renders a time pill only when `stop.start_time` is authored (`:587-589`); the live experience has `start_time=null` on both stops → no pills (vs the mockup's prominent "7:00 PM" pills). (Real-data condition, not a bug, but contributes to "looks different".)
  6. **Brand theming invisible for the only live brand.** The page resolves `resolveTheme(brand.theme, overrides)`, but Lantern & Vine has `theme_color=null, theme_font=null, theme_color_override=null` (live prod). So the "brand theming closes the gap" headline renders the DEFAULT palette — the page looks generically dark, not branded.
- **Mechanism:** the FOUNDATION render is real, but the eyebrow/label/title/chip choices and the (absent) brand-theme data make it read differently from the colorful, fully-populated mockup.
- **Severity:** SECONDARY ROOT CAUSE (the "looks different" gap on web is real but partial; web is the strongest surface).

### F-2 — CONSUMER screen is data-starved and missing major mockup sections (THE surface Seth saw)
- **Symptom:** Consumer experience detail "looks nothing like" the mockup.
- **Layer:** code + data-supply.
- **Probe:** read `ConsumerExperienceDetailScreen.tsx` + `mergedDiscover.ts` (`BusinessEventCard`) + grep for foundation features.
- **Evidence (all in `ConsumerExperienceDetailScreen.tsx` unless noted):**
  - **No vibe chips.** The screen reads from the deck `seed: BusinessEventCard`, which carries NO `experience_intents` (`mergedDiscover.ts:86-107` — `experienceStops` + `upcomingOccurrences` only). Grep confirms no vibe rendering; implementor admits this in §10 of the impl report.
  - **Per-stop media is a SINGLE image, not a count-aware gallery.** `BusinessEventCard.experienceStops[].imageUrl: string | null` (`mergedDiscover.ts:90`) — one image. The screen renders one `<Image>` (`:732-739`). The mockup + web both render 1/2/4-photo galleries (`CountAwareGallery`). Grep: `CountAwareGallery` NOT imported in the consumer screen.
  - **No map ("Where you'll be") section.** The consumer screen has no `buildStaticMapUrl` / map block (grep: NONE). The seed carries no stop coords (`experienceStops` has no lat/lng).
  - **No date / availability meta chip.** Only a single City chip renders (`:596-607`). No `dateSubline` chip (web has "5 dates · Next: Fri 20 Jun").
  - **No state banner** (sold out / ended) in the consumer body.
  - **Generic "Stop N" labels** (`:712-714`), no START HERE/THEN/END WITH, no time pill (seed carries no start_time).
  - **Brand theming likely default.** Theme via `useEventTheme(seed)`; `theme = themeQuery.data ?? resolveTheme(null,null)` (`:194`) → default palette when the deck signal carries no theme; the only live brand has no theme set anyway. A hardcoded `ACCENT="#FF6B35"` constant exists (`:98`).
  - **Adaptive Reserve uses the flat ORCH-1072 picker — NO open-daily.** `beginBooking` → `ExperienceOccurrencePicker` (`:776-782`), a flat "Pick a date" list. Grep for `open-daily|party|windowMinutes|ExperienceReservePicker` in the consumer screen: NONE.
- **Mechanism:** the consumer detail is fed by the deck card (`BusinessEventCard`), a thin signal that lacks intents, multi-image stops, coords, dates, and theme — so even though the screen composes the parallax shell, it cannot render the mockup's themed, gallery-rich, mapped, vibe-chipped, restaurant-booking page. This is exactly the surface that "couldn't run on sim during implement," and exactly where the divergence hid.
- **Severity:** CONFIRMED ROOT CAUSE (of Seth's complaint).

### F-3 — Recurrence/open-daily materializer is AUTHORED but NOT APPLIED → scheduling is non-functional on prod
- **Symptom:** "Pick a day & time" / "any upcoming day" booking has no real days to pick.
- **Layer:** schema / data (runtime supply).
- **Probe:** live prod SQL (read-only):
  ```sql
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='pg_expand_experience_recurrence') AS materializer_exists,
         (SELECT version FROM supabase_migrations.schema_migrations WHERE version='20261005000000') AS migration_applied,
         (SELECT pg_get_functiondef(oid) LIKE '%pg_expand_experience_recurrence%' FROM pg_proc WHERE proname='biz_publish_experience' LIMIT 1) AS publish_calls_expander;
  ```
- **Evidence:** `{"materializer_exists":false,"migration_applied":null,"publish_calls_expander":false}`. AND the only live experience:
  ```
  Raleigh Wine and Dine Crawl · is_recurring=true · recurrence_rules={preset:daily, termination:{kind:never}} · date_count=1
  ```
  This is exactly the "open daily, forever" case, yet it has ONE event_date (the master). The impl report itself flags the migration as "authored, NOT applied" (SC-9, §11).
- **Mechanism:** `ExperienceReservePicker`/`ExperienceOccurrencePicker` read `experience.dates` (= `event_dates`). Without the materializer, a recurring/open-daily experience has a single master date. So the multi/recurring slot picker would show ONE option, and the open-daily "any upcoming day" day-list shows ONE day. The scheduling intelligence is a UI shell over absent supply.
- **Severity:** CONFIRMED ROOT CAUSE (of the scheduling-parity doubt).

### F-4 — Consumer adaptive Reserve has NO open-daily mode at all (asymmetry vs web)
- **Symptom:** Even once supply exists, the consumer can't do the restaurant-style booking the mockup specifies.
- **Layer:** code.
- **Probe:** read `ExperienceOccurrencePicker.tsx` (the consumer picker) + grep the consumer screen.
- **Evidence:** `ExperienceOccurrencePicker` is a flat "Pick a date" list (`:124-190`) — no time-within-window, no party-size stepper, no `mode` prop. It is hardcoded dark (`#15181f`, white text — `:196-200`), NOT brand-themed. The web's `ExperienceReservePicker` has the open-daily mode (date → time-in-window → party); the consumer screen does not use it (I-MOR package isolation — it lives in mingla-business). So web and consumer have DIFFERENT, non-parity adaptive flows.
- **Mechanism:** two separate pickers; the consumer reuses the older ORCH-1072 slot list and never got the open-daily restaurant flow.
- **Severity:** SECONDARY ROOT CAUSE (scheduling parity gap, consumer surface).

### F-5 — Web open-daily "any upcoming day" is a partial promise even with supply
- **Symptom:** mockup open-daily sheet shows a rolling 14-day day-strip; impl lists only materialized `event_dates`.
- **Layer:** code + data.
- **Probe:** read `ExperienceReservePicker.tsx:237-309` (date list driven by `dates` prop) vs mockup `buildResv()` (lines 1142-1172, generates next 14 days client-side).
- **Evidence:** the impl day list = `dates.map(...)` (materialized occurrences). The mockup generates a continuous next-14-days strip. Even after the 52-cap materializer, a "never-ending daily" experience materializes 52 forward days at publish (no cron/rolling top-up — migration header, OQ-1), so the day list is bounded and ages without re-publish. The mockup's "any upcoming day" UX is approximated, not matched.
- **Mechanism:** discrete `event_dates` supply vs the mockup's open-ended generator.
- **Severity:** SUSPECTED CONTRIBUTOR (design-intent gap; flagged for scope decision, not a code defect).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|---|---|---|
| **Docs (mockup + impl report)** | Impl report claims SC-1..SC-12 all ✓ (incl. SC-3/SC-6 adaptive + open-daily). | Report's ✓ for SC-3/SC-6 is "code path exists," NOT "works on prod." Materializer SC-9 is honestly marked "authored, NOT applied" — which silently invalidates the working-ness of SC-3/SC-6 on prod. **Contradiction: SC-3/SC-6 marked ✓ while their data supply (SC-9) is unapplied.** Truth: code present, behavior absent. |
| **Schema (migration file)** | `pg_expand_experience_recurrence` + expander calls authored in `20261005000000`. | Not applied. |
| **Code (renderers/pickers)** | Web FOUNDATION is real; consumer is data-starved; two non-parity pickers. | Web ≠ consumer parity (F-2/F-4). |
| **Runtime (render)** | Web route could not be rendered headless (SPA stuck on "Loading experience…", async RQ fetch not settled in virtual-time; unmerged code not deployable without an `expo export web`). Consumer sim blocked (same blocker the implementor reported — dev client bound to anchor). | Render not achieved → confidence on the VISUAL match is source-grade, but the structural gaps (missing components/data) are proven by code+data reads regardless of pixels. |
| **Data (live prod)** | 1 live experience; recurring-daily-forever; 1 event_date; no brand theme; 2 single-image stops; intents=[first-date,romantic]. | The page will render unthemed, gallery-less per stop, and with one bookable day — i.e. the worst case for "looks like the mockup." |

---

## Repro evidence

- **Web headless render:** attempted via `Google Chrome --headless=new --virtual-time-budget=8000` against the LIVE prod URL `https://business.usemingla.com/exp/lanternvine/raleigh-wine-and-dine-crawl` (HTTP 200). Result: the RN-web SPA stayed on the "Loading experience…" spinner (default blue spinner on dark `#0c0e12`) — the async React-Query fetch did not settle within the virtual-time budget. Note: prod serves origin/main (the OLD flat page), NOT the unmerged Leg 3 code, so a settled prod shot would also be misleading. The unmerged worktree page is not renderable without a heavy `expo export web` (bundle-budget-gated) + a local server with JS settle. I did NOT ship a misleading screenshot. The loading-state shot was discarded.
- **Consumer sim:** BLOCKED by the same constraint the implementor documented (dev client `com.mingla.app.v2` bundle-bound to the anchor checkout, not the worktree; worktree has no `app-mobile/ios/` native project). Not resolvable without a full prebuild/anchor edit — out of bounds for INVESTIGATE.
- **Live DB introspection (the load-bearing evidence):** all SQL above ran read-only against prod and is pasted verbatim in F-1/F-3.

Confidence is `proven` for the STRUCTURAL findings (missing components, data-starvation, unapplied materializer — all from code + live-DB reads) and `probable` for the precise VISUAL delta on web (render not settled).

---

## Blast radius / cross-surface map

| Surface | State vs mockup | In scope for rework |
|---|---|---|
| Buyer/anon Web (`/exp/`) | On-foundation; 6 element divergences (F-1); unthemed for the only live brand (data) | YES — F-1 polish + F-5 open-daily day-supply decision |
| Business Web preview / Business iOS+Android (`/exp/`) | Same as web (shared `ExperiencePreview` FOUNDATION) | YES (automatic with web) |
| **Consumer iOS + Android** | **Materially divergent + data-starved (F-2); no open-daily (F-4)** | **YES — primary rework; needs deck-supply widening (intents, multi-image stops, coords, theme) + open-daily picker** |
| Backend (materializer) | Authored, unapplied (F-3) → all surfaces' scheduling is shell-only | YES — apply + verify; decide rolling top-up (F-5) |
| Admin Web | No experience buyer page | NO |
| Wizard Step-5 (LEGACY ExperiencePreview) | Byte-stable, intentionally unchanged | NO |

---

## Invariant impact (flagged, NOT resolved)

- **I-1 (one all-in ticket; party-size = quantity, never new line items):** the open-daily party stepper maps to `quantity` (web `ExperienceReservePicker.tsx:204`; consumer would need the same) — preserved on web; consumer lacks the flow entirely.
- **I-4 (publish-time materialization, no cron):** the migration honors it (expands at publish). F-5's "any upcoming day" ages without a top-up — a deliberate I-4 tradeoff to flag for Seth.
- **I-MOR-0827 (package isolation):** is WHY consumer can't reuse the mingla-business `ExperienceReservePicker` — the open-daily flow must be ported into a shared/app-mobile component.
- **I-7 (de-GBP):** preserved in the migration's currency guard.

---

## Discoveries for orchestrator

1. **The impl report's SC table overstates done-ness.** SC-3 (adaptive Reserve) and SC-6 (open-daily) are marked ✓ on the strength of code paths, while their sole data supply (SC-9 materializer) is unapplied — so neither works end-to-end on prod. Recommend the SC table be read as "code present," not "shipped."
2. **The one live experience is the worst-case render** (no theme, single-image stops, one date) — any visual QA against it will look bare even after rework. A synthetic richly-authored + themed experience fixture is needed to actually eyeball the mockup match (mirrors the ORCH-1147 "0/8 brands pass a fee → prod proves nothing" gotcha).
3. **Pre-existing test failure** carried in the impl report (`BaseBottomSheet.test.mjs` T-C) — unrelated to this divergence; already flagged by the implementor.

---

## Confidence level

`proven` for: web is on-foundation-with-divergences (F-1), consumer is divergent + data-starved (F-2), materializer unapplied → scheduling non-functional on prod (F-3), consumer has no open-daily (F-4). `probable` for the exact visual delta on web (headless render did not settle; sim blocked). No finding rests on the implementor's claims — each is from a direct code read or live-prod SQL.

---

## Recommended next phase + scope (direction only — NOT a fix)

Route to **SPEC** (or back to the implementor under a tightened SPEC). The rework scope, in priority order, is:
1. **Consumer parity (the surface Seth saw)** — widen the deck/detail supply so the consumer carries `experience_intents`, per-stop `image_urls[]` (not one), stop coords (for the map), the date model/availability, and the resolved theme; render vibe chips + count-aware galleries + map + meta chips + state banner; and port the open-daily restaurant picker into a shared/app-mobile component.
2. **Apply + verify the materializer (F-3)** so multi/recurring/open-daily actually have bookable occurrences; decide F-5 (rolling top-up vs publish-time 52-cap).
3. **Web element fidelity (F-1)** — stop-count eyebrow, START HERE/THEN/END WITH labels, "Where you'll start", seats/start-time meta chips.
4. **Author a synthetic themed, richly-populated experience fixture** to make the mockup match eyeball-verifiable.

This investigation proposes NO code. The above is scope direction for the SPEC.
