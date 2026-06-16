# SPEC — ORCH-1138 Leg 3: experience-page-vs-mockup REWORK contract

**Mode:** SPEC (contract; no code, no migration applied). **Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` · branch `ORCH-1138-experience-page` · HEAD `dfac42cf3`.
**Source investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1138_LEG3_EXPERIENCE_PAGE_VS_MOCKUP.md` (F-1..F-5, all `proven` for structure).
**Contract under build:** `Mingla_Artifacts/design/ORCH-1138/EXPERIENCE_DIRECTION_A_RESPONSIVE.html` (Direction-A, approved).
**Comms:** scanned `COMMS_LEDGER.md` Active table — no OPEN `BLOCK`/`WARN` row addressed to forensics, ORCH-1138, or `ALL` that is applicable to this SPEC. COMMS-0009 (security-definer-view anon-read pattern) is honored as a standing constraint, not an OPEN action. No new cross-ORCH discovery to write this turn.

> **Drift/clobber warning (read before IMPLEMENT):** `git fetch origin && git rebase origin/main` from this worktree currently CONFLICTS in `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` (origin/main advanced past spawn — ORCH-1147R2 + ORCH-1151 landed). The implementor MUST resolve that rebase first, keeping the Leg-3 checkout-experience changes, and re-run the Leg-3 gates after rebase. Do NOT edit the shared anchor.

---

## 1. Executive summary

Leg 3 shipped a public EXPERIENCE page that "looks nothing like" the approved mockup on the surface Seth actually touched (the consumer app), and whose restaurant-style scheduling is a UI shell over **absent data** (the recurrence materializer migration was authored but never applied). This rework closes the gap in four prioritized workstreams, **in this order**:

1. **CONSUMER PARITY (worst gap).** Widen the consumer experience data supply end-to-end (RPC → edge → `BusinessEventCard` → both seed mappers) so the consumer detail carries everything the mockup renders — `experience_intents`, per-stop `image_urls[]`, per-stop coords, the resolved brand theme, city, dates/availability, seats/start-time — then render vibe chips, count-aware per-stop galleries, the "Where you'll start" map, the meta chips, the state banner, real stop labels (START HERE / THEN / END WITH), brand theming + bold fonts, and the adaptive Reserve (incl. the open-daily restaurant flow ported into a shared/app-mobile picker).
2. **SCHEDULING — make it REAL.** Apply + verify the authored `20261005000000` recurrence materializer so multi/recurring/open-daily experiences have real bookable occurrences the pickers read. Keep the publish-time 52-cap, NO cron (orchestrator default; F-5 decided below).
3. **WEB/BUSINESS element fidelity (the 6 F-1 misses):** N-stop eyebrow, START HERE/THEN/END WITH stop labels, "Where you'll start", seats + start-time meta chips, themed render.
4. **SYNTHETIC FIXTURE:** author one clearly-labeled test brand + a richly-populated, THEMED, multi-stop, open-daily experience so the rework is eyeball-verifiable against the mockup on web + consumer sim (the one live experience is the worst-case render — proves nothing).

The investigation's confidence is `proven` for all structural gaps; this SPEC builds against those proven findings only — no new investigation is opened.

---

## 2. Scope & non-goals

### In scope
- The consumer experience-detail data-supply widening across all four chained layers (F-2/F-4).
- The consumer `ConsumerExperienceDetailScreen` render: vibe chips, count-aware galleries, map, meta chips (City,Country + dates + seats + start-time), state banner, stop labels, theming/bold-fonts, adaptive Reserve with a new shared/app-mobile open-daily picker.
- Apply + verify the `20261005000000` materializer (F-3); confirm publish + live-edit call the expander; 52-cap, no cron (F-5).
- Web/business `ExperiencePreview` fidelity fixes (F-1.1–F-1.4): N-stop eyebrow, START HERE/THEN/END WITH, "Where you'll start", seats + start-time meta chips.
- One synthetic THEMED test brand + experience fixture (seed script, clearly labeled, removable).

### Non-goals (explicit)
- **The wizard Step-5 LEGACY `ExperiencePreview` branch is OFF-LIMITS** — keep it byte-stable (the FOUNDATION branch is what the public route uses; do not touch the LEGACY render path).
- **The EBES deletion + chat repoint stay intact** — do NOT reintroduce `ExpandedBusinessEventSheet` for the experience flow; the deck/venue card opens `ConsumerExperienceDetailScreen` directly.
- **Checkout contract is frozen (I-1):** party-size maps to cart `quantity`; NO new line items, NO new money function; the `eventDateId` rides only when a slot is chosen (byte-identical request).
- **F-5 "rolling 14-day open-daily strip"** is NOT built — the publish-time 52-cap supply is the contract (open question OQ-2 documents the residual UX delta for Seth; no cron).
- No GBP introductions anywhere (I-7).
- No admin-web surface (no experience buyer page there).
- No trip/event detail screens are re-architected; they are the REFERENCE the consumer experience screen must match in richness (`ConsumerTripDetailScreen`, `ConsumerEventDetailScreen`).

### Assumptions
- The `20261005000000` migration body is correct as authored (Seth-approved header: 52-cap / fold-in / no cron; publish + live-edit both call `pg_expand_experience_recurrence` — verified at lines 688-692 and 1304-1310). The rework APPLIES and VERIFIES it; it does not rewrite the expander.
- `useEventTheme(seed)` already reads the anon-safe `business_public_events_view` (COMMS-0009 honored); the consumer theme gap is (a) the live brand carries no theme (data → fixed by fixture) and (b) the seed/hook must actually resolve and pass the palette to every section.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | YES (PRIMARY) | Themed immersive experience detail: vibe chips, count-aware per-stop galleries, "Where you'll start" map, meta chips (City,Country · dates · seats · start-time), state banner, START HERE/THEN/END WITH labels, bold themed fonts, adaptive Reserve incl. open-daily restaurant flow | `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`, `app-mobile/src/types/mergedDiscover.ts`, `app-mobile/src/services/deckService.ts`, `app-mobile/src/components/SwipeableCards.tsx` (mapper), `app-mobile/src/utils/venueExperienceMapping.ts`, `app-mobile/src/hooks/useVenueExperiences.ts`, NEW `app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx`, `supabase/functions/discover-cards/index.ts`, migrations (RPC widening) | Shared RN code → auto with Android |
| 2 | Consumer Android (`app-mobile/`) | YES | Same as iOS; Android opaque-glass fallback on every new chip/card/sheet surface | Same as #1 | Auto (shared) + manual Android glass check |
| 3 | Buyer/anon Web (`mingla-business/` `/exp/{brandSlug}/{experienceSlug}`) | YES | N-stop eyebrow, START HERE/THEN/END WITH labels, "Where you'll start", seats + start-time meta chips, themed render | `mingla-business/src/components/experience/ExperiencePreview.tsx` (FOUNDATION branch only) | Shared with #4/#5 |
| 4 | Business iOS (`/exp/`) | YES | Same as web (shared `ExperiencePreview` FOUNDATION) | Same as #3 | Auto (shared) |
| 5 | Business Android (`/exp/`) | YES | Same as web; Android opaque-glass on new chips | Same as #3 | Auto + manual Android glass check |
| 6 | Admin Web (`mingla-admin/`) | NO | No experience buyer page exists in admin | — | n/a |
| 7 | Business Web preview (wizard Step-5) | NO | LEGACY `ExperiencePreview` branch is byte-stable / out of scope | — | n/a |

Backend (the materializer + RPC widening) feeds ALL covered surfaces' scheduling and consumer supply.

---

## 4. Layered specification

### 4.A — Database / migrations

#### 4.A.1 — APPLY the authored recurrence materializer (F-3) — the load-bearing scheduling fix
- **Migration:** `supabase/migrations/20261005000000_orch_1138_experience_recurrence_materializer.sql` (already authored in the worktree; verified complete: `pg_expand_experience_recurrence` + `_pg_weekday_to_dow` + re-emitted `biz_publish_experience` calling the expander at L688-692 + re-emitted `biz_update_live_experience` calling it at L1304-1310 + `COMMIT;` at L1395).
- **Action:** APPLY to prod, then VERIFY. Do NOT rewrite the body. **Apply path:** NOT via MCP (read-only) and NOT `supabase db push` if CLI is drift-wedged — use the Supabase **Management API** with the browser-UA token per `feedback_edge_deploy_and_migration_apply_hazards.md` / `reference_supabase_db_write_paths.md`. The migration header itself warns: the RPC bodies are re-emitted from the live prod body (`20260911000000`) — **before applying, diff the live `biz_publish_experience` / `biz_update_live_experience` bodies against the migration's re-emitted bodies; if prod drifted since `20260911000000`, reconcile (re-emit current live body + the ONE expander call) before applying** (clobber risk: blindly applying would revert any post-0911 live patch).
- **Decision (F-5, OQ-1 already folded in header; orchestrator default RECOMMENDED):** keep the **publish-time 52-cap, NO cron**. A never-ending daily rule materializes up to 52 forward occurrences at publish; re-publish / live-edit re-materializes from "today". This is the contract. (Residual UX delta vs the mockup's open-ended day-strip → OQ-2, accepted unless Seth overrides.)
- **I-4 preserved:** materialization stays at publish/live-edit; no cron, no rolling top-up.
- **Verify (read-only SQL after apply):** `pg_expand_experience_recurrence` EXISTS; `schema_migrations.version='20261005000000'` present; `pg_get_functiondef(biz_publish_experience) LIKE '%pg_expand_experience_recurrence%'` true; re-publish the synthetic open-daily fixture (§4.D) and assert `event_dates` count > 1 (≈52 for daily-forever).

#### 4.A.2 — Widen `pg_eligible_experiences_for_deck` (deck supply RPC) — F-2 root
- **Latest definition:** `supabase/migrations/20260903000000_orch_1065_eligible_experiences_for_deck.sql` (RETURNS TABLE L52-68). The RPC ALREADY returns `experience_intents text[]` (L56), per-stop `lat`/`lng` in `stops` jsonb (L170-171), `image_urls` (L168), `brand_logo_url` (L63/L191). **It does NOT return brand theme, city, or per-occurrence availability.**
- **New migration** (`supabase/migrations/202610xxxxxxxx_orch_1138_rework_deck_supply.sql`) — `CREATE OR REPLACE FUNCTION public.pg_eligible_experiences_for_deck(...)` (signature UNCHANGED → no DROP needed; re-emit verbatim + add columns). **Add to RETURNS TABLE + SELECT:**
  - `brand_theme jsonb` — the anon-safe resolved theme the consumer needs WITHOUT a `.from('brands')` client read (COMMS-0009). Source it the same way the public page resolves it (read the `business_public_events_view` theme columns or the brand theme fields the view exposes; mirror what `useEventTheme` reads server-side). RE-ASSERT the `REVOKE ALL / GRANT EXECUTE` to the service-role caller only (the existing grant model; no anon grant).
  - `city text` — the first stop's `city` (so the consumer City,Country chip has real data instead of `null`).
  - (The expander from §4.A.1 makes `upcomingOccurrences` real; the per-occurrence supply is added by the ORCH-1072 detail-supply migration `20260908000000` — confirm the deck path actually carries `upcoming_occurrences` post-materializer; if the deck RPC does not yet aggregate them, add an `upcoming_occurrences jsonb` column mirroring the ORCH-1072 detail RPC so the consumer Reserve sees >1 slot.)
- **DROP-before-widen rule:** if any added column changes an EXISTING column's position/type, `DROP FUNCTION` first then `CREATE` (migration-baseline CI requires DROP before a widened `RETURNS TABLE`). Adding columns at the END with a fresh `CREATE OR REPLACE` of the same signature is acceptable only if Postgres accepts the new RETURNS shape; otherwise DROP first.

#### 4.A.3 — Widen `pg_brand_experiences_for_place` (venue "experiences here" supply RPC) — F-2 second path
- **Consumer read:** `app-mobile/src/hooks/useVenueExperiences.ts:50` calls `pg_brand_experiences_for_place`. Its row (`VenueExperienceRow`, L20-37) carries `theme` (L30) but NO stops, intents, coords, or occurrences → the venue→detail seed (`venueExperienceMapping.ts:experienceToBusinessEventCard`) produces a stops-less, intent-less card.
- **New/extended migration:** widen `pg_brand_experiences_for_place` RETURNS to ALSO carry `experience_intents text[]`, `stops jsonb` (stop_order/place_name/address/image_urls/ai_description/lat/lng/start_time), and `upcoming_occurrences jsonb` — identical shapes to the deck RPC §4.A.2 — so the venue seed path reaches mockup parity too. (Alternatively, converge: have the venue path resolve the same detail-supply RPC the deck uses. Implementor may choose convergence IF it does not change the venue list-row contract; default is the additive widening.)

### 4.B — Edge function: `supabase/functions/discover-cards/index.ts`
- **Current state (read):** the `ExperienceDeckCard` envelope (L145-199) + `fetchEligibleExperiences` mapper (L290-359) ALREADY carry `imageUrls[]` (L186/307), per-stop `lat`/`lng` (L188-189/309-310), and `experience_intents` (only as `experienceType` single — L321-328), plus `upcomingOccurrences` (L172-179/344). **The edge layer is NOT the narrowing point — it already supplies more than the client consumes.**
- **Change:** carry the FULL `experience_intents: string[]` array onto the envelope (not just `experienceType` the single first intent), so the consumer can render multiple vibe chips. Add `brandTheme` (from §4.A.2 `brand_theme`) and `city` to the envelope. No fabricated data (rule 9): empty array / null when absent.
- **`mapExperienceOccurrences` (L227-258):** unchanged (honest passthrough already).

### 4.C — Client (consumer)

#### 4.C.1 — `app-mobile/src/types/mergedDiscover.ts` — widen the `BusinessEventCard` experience shape
- `experienceStops[]` (L86-92): change `imageUrl: string | null` → ADD `imageUrls: string[]` (keep `imageUrl` for back-compat); ADD `lat: number | null`, `lng: number | null`, `startTime: string | null`, `stopLabel: 'Start Here' | 'Then' | 'End With'`.
- ADD top-level `experienceIntents?: string[]` (the canonical 4: `adventurous|first-date|romantic|group-fun`).
- ADD top-level `brandTheme?: Record<string, unknown> | null` (anon-safe resolved theme passthrough; the seed mappers feed it so `useEventTheme` has a synchronous fallback while the query settles — COMMS-0009: NEVER a client `.from('brands')`).
- `city` (L48) already exists — ensure it is POPULATED by the mappers (currently set `null`).

#### 4.C.2 — `app-mobile/src/services/deckService.ts:experienceCardToRecommendation` (L296-398)
- Carry the FULL intents array onto the Recommendation (add `experienceIntents: card.experienceIntents ?? []`); keep `experienceType` for the deck face.
- Stops already keep `imageUrls`, `lat`, `lng`, `aiDescription`, and `stopLabel` (L305 via `experienceStopLabel`). Add `startTime` passthrough. `experienceStopLabel` (L285-305) is the canonical consumer label helper — REUSE it (do not duplicate).
- Carry `brandTheme` + `city` onto the Recommendation.

#### 4.C.3 — `app-mobile/src/components/SwipeableCards.tsx:experienceRecToBusinessEventCard` (L130-213) — THE narrowing point
- **This mapper currently drops the mockup-critical fields.** Fix:
  - `experienceStops[].imageUrl` (L197) → ALSO carry `imageUrls: s.imageUrls ?? []`; carry `lat: s.lat`, `lng: s.lng`, `startTime: s.startTime ?? null`, `stopLabel: s.stopLabel`.
  - `city: null` (L172) → `rec.city ?? firstStop?.city ?? null`.
  - ADD `experienceIntents: rec.experienceIntents ?? []`.
  - ADD `brandTheme: rec.brandTheme ?? null`.
  - Keep `locationGeo` (L176-179) AND per-stop coords (the map uses stop-1 coords).

#### 4.C.4 — `app-mobile/src/utils/venueExperienceMapping.ts:experienceToBusinessEventCard` (L57-96) — second seed path
- Currently sets NO `experienceStops`, NO intents, NO occurrences. Populate `experienceStops` (from the widened `VenueExperienceRow.stops` §4.A.3), `experienceIntents` (from `row.experience_intents`), `upcomingOccurrences` (from `row.upcoming_occurrences`), `brandTheme: row.theme`, and `city: row.venue_text`. Update `VenueExperienceRow` (`useVenueExperiences.ts:20-37`) to declare the new fields.

#### 4.C.5 — `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` — render parity (mirror `ConsumerTripDetailScreen` richness)
Render the following NEW sections, all real-data-gated (rule 9), all using `palette`/`boldFamily` (theming) and Android opaque-glass fallback on every fill:
1. **Vibe chips** — beneath the brand chip, from `seed.experienceIntents` mapped to display labels; sparkle icon + `palette.accentWash` fill (mirror web `ExperiencePreview` vibe chips L382-400 + `ConsumerTripDetailScreen` chip pattern). Render only when the array is non-empty.
2. **Count-aware per-stop galleries** — replace the single `<Image>` (L732-739) with a count-aware gallery (1=full / 2=split / 3+=slider) reading `stop.imageUrls` (falls back to `[imageUrl]`). Use the consumer count-aware gallery component the trip/event detail screens use (do NOT import the mingla-business `CountAwareGallery` — I-MOR-0827; reuse/port the app-mobile equivalent the trip foundation uses).
3. **"Where you'll start" map** — new section after the itinerary, rendering a static map of stop-1 coords (gate on `lat`/`lng` present). Reuse the consumer static-map approach in `app-mobile/src/hooks/useConsumerEventFoundation.ts` (the consumer trip/event foundation already builds a static map URL) — do NOT import `mingla-business/src/utils/mapboxStaticImage.ts` (I-MOR-0827). Title is exactly **"Where you'll start"** (mockup L789).
4. **Meta chips** — extend the meta row (currently only City,Country at L596-607) to ALSO render: a dates chip (`dateSubline` from the occurrences/master date — "5 dates · Next: Fri 20 Jun"), a seats chip ("N spots left" / "N max" when occurrence remaining/capacity known — rule 9, only when known), and a per-experience start-time chip when a master start time exists. Mirror web meta-row + the mockup's 4-chip row (mockup L691-697).
5. **State banner** — sold-out / ended banner in the body (mirror `ConsumerEventDetailScreen` state banner) driven by the resolved CTA `variant`.
6. **Stop labels** — replace the generic `Stop {n}` (L712-714) with `stop.stopLabel` (START HERE / THEN / END WITH) — use the carried `stopLabel`; keep the numeric dot. Render a per-stop time pill when `stop.startTime` is present (rule 9).
7. **Theming + bold fonts** — every new section uses `palette` + `boldFamily` (already wired via `useEventTheme`/`createThemePalette` L194-199). Remove the dependence on the hardcoded `ACCENT="#FF6B35"` (L98) for content (keep only as a last-resort loading-spinner tint if needed). The seed's `brandTheme` is the synchronous fallback passed to `resolveTheme` so the page never flashes default before the query settles.
8. **Adaptive Reserve incl. open-daily** — `beginBooking` (L262-286) keeps the 0/1/>1 occurrence branching, BUT for a recurring/open-daily experience it must open the NEW open-daily picker (§4.C.6) instead of the flat `ExperienceOccurrencePicker`. Decide mode off the date model: single → straight to cart (unchanged); multi_date / discrete recurring → slot list; open-daily (daily/recurring with a within-window) → date → time-within-window → party-size. Party-size maps to cart `quantity` (I-1) — NO new line items. Checkout request stays byte-identical (`eventDateId` + `quantity` only).

#### 4.C.6 — NEW shared/app-mobile open-daily picker `app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx`
- **Why new:** the web open-daily flow lives in `mingla-business/src/components/experience/ExperienceReservePicker.tsx` (modes `"slots" | "open-daily"`, date → 30-min-step time-within-window → party stepper → `onConfirm({eventDateId, quantity})`, L39-204). I-MOR-0827 PACKAGE ISOLATION forbids importing it into `app-mobile`. PORT its logic into a new app-mobile component (or a `packages/` shared component if the implementor prefers; default = app-mobile-local to avoid a new package).
- **Contract:** props `{ visible, mode: 'slots'|'open-daily', occurrences, timezone, eventRemaining, onCancel, onConfirm({eventDateId, quantity}) }`. `slots` mode = today's `ExperienceOccurrencePicker` behavior (`quantity:1`). `open-daily` mode = mirror the web picker: "CHOOSE A DAY" date list → time-within-window (30-min step bounded by `[start_at,end_at]`, presentation-only) → party stepper bounded by `Math.min(partyMaxConst, eventRemaining)`. Themed via `palette` (NOT hardcoded `#15181f`); Android opaque-glass fallback. Reuses `BaseBottomSheet` (the sole gorhom consumer pattern, sheet-scroll structure preserved — `feedback_rn_sub_sheet_must_render_inside_parent`).
- **Data it reads:** `seed.upcomingOccurrences` (now real, post-materializer): each `{eventDateId, startAt, endAt, capacity, sold, remaining}`. For open-daily, the day list = the materialized occurrences (52-cap supply); the time picker derives from each occurrence's `[startAt,endAt]` window.
- `ExperienceOccurrencePicker.tsx` (existing) may be KEPT as the `slots` implementation or absorbed into the new component — implementor's choice; if absorbed, delete the old file and update imports.

### 4.D — Web/business fidelity: `mingla-business/src/components/experience/ExperiencePreview.tsx` (FOUNDATION branch ONLY)
The FOUNDATION branch is already on the Direction-A system (vibe chips L382-400, map L440-468, stop spine L562-617). Apply the 6 F-1 fixes:
1. **N-stop eyebrow** (F-1.1): the lead eyebrow (L357-361, hero ~L523-526) currently shows `cityCountry`. Change the EYEBROW to the derived stop count — "{stops.length}-stop experience" (mockup L645/686). Keep City,Country as a META CHIP only (it is currently shown twice; remove the eyebrow duplication).
2. **START HERE / THEN / END WITH** (F-1.2): `StopSpine` (L584-586) renders `Stop {n}`. Replace with the label helper `experienceStopLabel` from `experienceWizardTypes.ts:65-67` (`START HERE`/`THEN`/`END WITH`). Keep the numeric dot.
3. **"Where you'll start"** (F-1.3): the map title (L444) is "Where you'll be" → change to **"Where you'll start"** (mockup L789).
4. **Seats meta chip** (F-1.4): add a "N spots left · M max" chip to the meta row (L369-380) when occurrence remaining/capacity is known (rule 9; no chip when null/unlimited).
5. **Start-time meta chip** (F-1.4): add a "{time} start" chip when the master/first occurrence carries a start time (rule 9).
6. **Themed render** (F-1.6): no code change for the live brand (its theme is null = data) — the synthetic fixture (§4.E) proves themed render. Confirm `resolveTheme(brand.theme, overrides)` is the only theme source (no hardcoded accent fallback for content).

### 4.E — Synthetic fixture (eyeball-verification supply)
- **Deliverable:** a clearly-labeled, removable seed script `Mingla_Artifacts/fixtures/orch_1138_rework_themed_experience.sql` (or a `supabase/seeds/` script — NOT a migration; never auto-applied). It MUST be idempotent and clearly test-labeled.
- **Authors:** ONE test brand (e.g. slug `mingla-qa-experiences`, name "Mingla QA Experiences", non-prod-looking) with a **non-null theme** (`theme_color`, `theme_font` set to a vivid accent + a bold display font) so theming is visible; ONE experience with:
  - `whenMode='recurring'`, daily preset, `termination.kind='never'` (open-daily forever) — exercises the materializer (expect ~52 `event_dates` after publish).
  - 3–4 stops, each with `place_name`, `address`, real `lat`/`lng`, `ai_description`, and **2–4 `image_urls` each** (so count-aware galleries render multi-photo), with `start_time` set on at least one stop (time pill).
  - `experience_intents` = 2–3 of the canonical 4 (e.g. `{adventurous,first-date}`) — vibe chips.
  - a priced all-in `whole_price_cents` (NOT free) on a charges-enabled test brand, OR `is_free=true` if no charges-enabled test brand is available (avoids the ORCH-1075 paid-publish guard — `stripe_charges_disabled`). Currency in `USD` (I-7, never GBP).
  - publish it through `biz_publish_experience` (NOT direct row insert) so it goes through the real materializer + master-date trigger path.
- **No prod pollution:** the brand/experience are obviously test-labeled; document the cleanup (soft-delete or DELETE the brand) in the script header. Do NOT surface it in any prod deck query beyond the QA device's geo (place its stops at a QA-known lat/lng).
- **Why (Discovery #2 / ORCH-1147 gotcha):** the one live experience is the worst-case render (no theme, single-image stops, one date). Eyeballing prod proves nothing; the fixture is the contract's verification substrate.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1 (apply materializer):** After §4.A.1 apply, `pg_expand_experience_recurrence` exists; the synthetic open-daily fixture has > 1 (≈52) `event_dates` rows after publish. (Layer: DB.)
- **SC-2 (publish + live-edit call expander):** `pg_get_functiondef` of BOTH `biz_publish_experience` and `biz_update_live_experience` contains `pg_expand_experience_recurrence`. (DB.)
- **SC-3-Consumer:** On the consumer experience detail for the fixture, VIBE CHIPS render (≥2), one per intent. (iOS + Android.)
- **SC-4-Consumer:** Each stop with ≥2 `image_urls` renders a count-aware gallery (1=full/2=split/3+=slider), NOT a single image. (iOS + Android.)
- **SC-5-Consumer:** A "Where you'll start" map renders stop-1 location (when coords present). (iOS + Android.)
- **SC-6-Consumer:** The meta row shows City,Country + a dates chip + a seats chip (when remaining known) + a start-time chip (when authored) — no fabricated values. (iOS + Android.)
- **SC-7-Consumer:** Stops are labeled START HERE / THEN / END WITH (not "Stop N"); a time pill shows when `start_time` present. (iOS + Android.)
- **SC-8-Consumer:** Every section uses the resolved brand palette + bold font (fixture's vivid theme is visibly applied; no flash of `#FF6B35` default content). (iOS + Android.)
- **SC-9-Consumer (state banner):** A sold-out fixture variant shows a sold-out banner; an ended one shows ended. (iOS + Android.)
- **SC-10-Consumer (open-daily Reserve):** Reserve on the open-daily fixture opens date → time-within-window → party-size; confirming routes to the cart with the chosen `eventDateId` + `quantity` = party size. (iOS + Android.)
- **SC-11 (checkout byte-identical, I-1):** the open-daily/slot Reserve checkout request to `ticket-checkout-create` carries ONLY `eventDateId` + line `quantity` (party size); NO new line item, NO address/tax field. Diffed against the pre-rework EBES experience request. (Edge/runtime.)
- **SC-12-Web:** `/exp/{brand}/{experience}` eyebrow reads "N-stop experience"; stop labels read START HERE/THEN/END WITH; map title reads "Where you'll start"; meta row shows seats + start-time chips when known; City,Country shown once. (Web; auto to business iOS/Android.)
- **SC-13 (no LEGACY / EBES regression):** wizard Step-5 LEGACY `ExperiencePreview` render is byte-stable; no `ExpandedBusinessEventSheet` reintroduced for experiences; deck/venue experience card opens `ConsumerExperienceDetailScreen`. (Structural.)
- **SC-14 (mockup match):** Side-by-side of the fixture's consumer + web pages vs `EXPERIENCE_DIRECTION_A_RESPONSIVE.html` — vibe chips, galleries, map, meta chips, stop labels, theming all present and corresponding. (Manual visual, both surfaces.)
- **SC-15 (no GBP, I-7):** the fixture + all new currency paths resolve from brand default; no GBP introduced. (DB/code.)

---

## 6. Invariants

| Invariant | How preserved | Verifying test |
|---|---|---|
| **I-1** (one all-in ticket; party-size = cart quantity, never new line items) | open-daily party stepper → `quantity`; checkout request adds only `eventDateId`+`quantity` | SC-11 |
| **I-4** (publish-time materialization, no cron) | expander runs only inside `biz_publish_experience`/`biz_update_live_experience`; 52-cap; no cron/top-up | SC-1/SC-2 |
| **I-7** (de-GBP; resolve from brand default) | fixture + currency paths resolve from `brand.default_currency`; migration currency guard intact | SC-15 |
| **I-MOR-0827** (package isolation) | consumer open-daily picker + map + gallery are app-mobile/shared ports — NO import from `mingla-business/src` | grep gate (see §9) |
| **COMMS-0009 / anon-read** (theme via `business_public_events_view`, never client `.from('brands')`) | `brandTheme` resolved server-side in the RPC + `useEventTheme` reads the view | grep gate: no new `.from('brands')` in consumer experience path |
| **ANDROID-GLASS-OPAQUE** | every new chip/card/sheet fill uses the Platform.select opaque ≥0.92 Android fallback + overflow:hidden | manual Android check (SC-3..SC-10 on Android) |
| **EBES-DELETED / chat-repoint** (Leg 3) | no reintroduction of `ExpandedBusinessEventSheet` for experiences | SC-13 grep |

**Proposed new invariants (DRAFT — flip ACTIVE at CLOSE; orchestrator owns the flip):**
- **I-PROPOSED-1138-CONSUMER-EXPERIENCE-FULL-SUPPLY (DRAFT):** the consumer experience seed (`BusinessEventCard` for `event_type='experience'`) MUST carry `experienceIntents`, per-stop `imageUrls[]` + `lat`/`lng` + `stopLabel`, `brandTheme`, and `city` — both seed mappers (`experienceRecToBusinessEventCard`, `experienceToBusinessEventCard`) populate them; no mapper may silently drop them.
- **I-PROPOSED-1138-NO-CROSS-PACKAGE-EXPERIENCE-PICKER (DRAFT):** the consumer open-daily/slots picker, count-aware gallery, and static-map builder used by the experience detail MUST be app-mobile/shared — never imported from `mingla-business/src` (restates I-MOR-0827 for this surface).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 | materializer applied | publish open-daily fixture | ~52 `event_dates`; expander exists | DB |
| T-2 | expander wired both RPCs | `pg_get_functiondef` grep | both contain `pg_expand_experience_recurrence` | DB |
| T-3 | vibe chips happy | fixture intents `{adventurous,first-date}` | 2 chips render | Component (consumer) |
| T-4 | vibe chips empty | experience with no intents (draft-only impossible post-publish; force empty) | NO chip row (rule 9) | Component |
| T-5 | gallery count-aware | stop with 4 `image_urls` | slider gallery | Component |
| T-6 | gallery single | stop with 1 image | full single | Component |
| T-7 | map present | stop-1 lat/lng set | "Where you'll start" map renders | Component |
| T-8 | map absent | stop-1 coords null | NO map section | Component |
| T-9 | seats chip | occurrence remaining=3,capacity=12 | "3 spots left · 12 max" chip | Component |
| T-10 | seats chip unknown | remaining=null | NO seats chip | Component |
| T-11 | stop labels | 3 stops | START HERE / THEN / END WITH | Component |
| T-12 | theming applied | fixture vivid theme | accent + bold font visible; no `#FF6B35` content | Component |
| T-13 | open-daily Reserve | tap Reserve on open-daily fixture | date→time→party flow; confirm → cart with eventDateId+quantity | Runtime (sim) |
| T-14 | checkout byte-identical | confirm party=4 | request = `{eventId, lines:[{quantity:4}], eventDateId}` only | Edge/runtime |
| T-15 | I-MOR isolation | grep consumer experience files | no `mingla-business/src` import | Static |
| T-16 | web eyebrow | `/exp/` fixture | "3-stop experience" eyebrow; City,Country once | Web |
| T-17 | web stop labels + map title | `/exp/` fixture | START HERE/THEN/END WITH; "Where you'll start" | Web |
| T-18 | LEGACY byte-stable | wizard Step-5 render | unchanged | Static/snapshot |
| T-19 | no-GBP | fixture + currency paths | no GBP | Static |
| T-20 | rebase clobber guard | post-rebase Leg-3 gates | checkout-experience conflict resolved; gates green | CI |

---

## 8. Implementation order

1. **Rebase** the worktree on `origin/main`; resolve the `checkout-experience/[experienceEventId]/index.tsx` conflict (keep Leg-3 changes); re-run Leg-3 gates.
2. **DB §4.A.1** — diff live RPC bodies vs the re-emitted migration; reconcile if drifted; APPLY `20261005000000` via Management API; VERIFY (SC-1/SC-2).
3. **DB §4.A.2 / §4.A.3** — new migration widening `pg_eligible_experiences_for_deck` (+`brand_theme`,`city`,`upcoming_occurrences`) and `pg_brand_experiences_for_place` (+intents,stops,occurrences). Apply + verify.
4. **Edge §4.B** — `discover-cards`: carry full intents array + `brandTheme` + `city`. Deploy from MERGED main (clobber rule) at CLOSE, not from the worktree mid-flight.
5. **Types §4.C.1** — widen `BusinessEventCard` experience shape.
6. **Mappers §4.C.2/4.C.3/4.C.4** — `deckService` Recommendation + `SwipeableCards` seed mapper + `venueExperienceMapping` + `useVenueExperiences` row.
7. **Picker §4.C.6** — new app-mobile `ExperienceReservePicker` (slots + open-daily).
8. **Screen §4.C.5** — `ConsumerExperienceDetailScreen` render parity (chips, galleries, map, meta, banner, labels, theming, adaptive Reserve).
9. **Web §4.D** — `ExperiencePreview` FOUNDATION 6 fixes.
10. **Fixture §4.E** — seed script; publish via RPC; verify on web + consumer sim.
11. Run all gates + per-surface SC checks (iOS + Android + web).

---

## 9. Regression prevention (fails-on-revert contract)

- **`orch-1138-consumer-experience-supply.test`** (consumer): assert the seed mappers (`experienceRecToBusinessEventCard`, `experienceToBusinessEventCard`) output an experience card carrying non-empty `experienceIntents`, per-stop `imageUrls`, per-stop `lat`/`lng`, `stopLabel`, `brandTheme`, and `city` for a fixture input. MUST FAIL if a mapper reverts to dropping any field. (Protective comment: "ORCH-1138 rework — consumer experience parity died when the mapper narrowed the seed; these fields are mockup-load-bearing.")
- **`orch-1138-consumer-renders-all-sections.test`** (component): mount `ConsumerExperienceDetailScreen` with the fixture seed; assert vibe chips, count-aware gallery, map block, seats/start-time chips, START HERE/THEN/END WITH labels, and the open-daily picker entry all render. FAIL on revert of any section.
- **`orch-1138-materializer-expansion.test.sql`**: against the applied DB, publishing a daily-forever experience yields > 1 `event_dates` (≤52); both publish RPCs contain the expander call. FAIL if the migration is reverted/unapplied.
- **`orch-1138-checkout-byte-identical.test`**: the open-daily/slot Reserve produces a `ticket-checkout-create` request with ONLY `eventDateId` + line `quantity` — no address/tax/line-item additions (I-1). FAIL if a new line item or money path appears.
- **`orch-1138-mor-isolation.test` (grep gate):** the consumer experience files import nothing from `mingla-business/src`. FAIL on any such import.
- **`orch-1138-legacy-byte-stable.test`:** snapshot/grep the wizard Step-5 LEGACY `ExperiencePreview` branch + assert no `ExpandedBusinessEventSheet` import in the experience flow. FAIL on reintroduction.
- Each gate must demonstrably FAIL when its fix is reverted and PASS when restored (the implementor proves fails-on-revert in the report).

---

## 10. Open questions (need Seth or a decision)

- **OQ-1 (RECOMMENDED resolved):** F-5 supply model — publish-time **52-cap, NO cron** (orchestrator default; matches the migration header). Confirm this is acceptable vs the mockup's open-ended day-strip. Default = proceed with 52-cap.
- **OQ-2 (residual UX, accepted unless overridden):** a never-ending open-daily experience's bookable days are bounded to 52 forward occurrences and age without a re-publish (no cron). The mockup's "any upcoming day" is approximated. Acceptable for v1? Default = yes; revisit only if a brand reports stale day-lists.
- **OQ-3 (theme source):** confirm the deck RPC may read the brand theme via `business_public_events_view` (the anon-safe view) so COMMS-0009 holds without a `.from('brands')` — if the view does NOT expose the theme columns the consumer needs, the implementor must STOP-AND-AMEND (the alternative — exposing theme in the view — is a separate migration decision for Seth).
- **OQ-4 (fixture money path):** the synthetic fixture should be PAID to exercise the full all-in render, but that requires a charges-enabled test brand (ORCH-1075 guard). If none exists in the test environment, the fixture is `is_free=true`. Confirm which (paid is more faithful to the mockup's price block).

---

## 11. Downstream routing

NEXT = **mingla-implementor** (this worktree). Then **mingla-tester** (per-surface SC verification incl. live sim + physical-device + web + the materializer apply check). Then **mingla-orchestrator** CLOSE (flip the two `I-PROPOSED-1138-*` DRAFT invariants ACTIVE; deploy edge from merged main; OTA the consumer dev channel; sync World Map / artifacts).

**Working tree:** `~/Desktop/mingla-orchs/ORCH-1138-[experience-page]/` on branch `ORCH-1138-experience-page`.

### Scoped allowlist (implementor may modify)
- `supabase/migrations/20261005000000_orch_1138_experience_recurrence_materializer.sql` (APPLY only — do not rewrite the body unless reconciling live drift per §4.A.1)
- NEW `supabase/migrations/202610xxxxxxxx_orch_1138_rework_deck_supply.sql` (widen the two supply RPCs)
- `supabase/functions/discover-cards/index.ts`
- `app-mobile/src/types/mergedDiscover.ts`
- `app-mobile/src/services/deckService.ts`
- `app-mobile/src/components/SwipeableCards.tsx` (the mapper only)
- `app-mobile/src/utils/venueExperienceMapping.ts`
- `app-mobile/src/hooks/useVenueExperiences.ts`
- `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx`
- NEW `app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx` (and optionally absorb `ExperienceOccurrencePicker.tsx`)
- `mingla-business/src/components/experience/ExperiencePreview.tsx` (FOUNDATION branch ONLY)
- NEW fixture `Mingla_Artifacts/fixtures/orch_1138_rework_themed_experience.sql`
- NEW test files under the respective `__tests__/` dirs (§9)
- `mingla-business/app/checkout-experience/[experienceEventId]/index.tsx` (rebase conflict resolution ONLY)

### DO-NOT-TOUCH
- The wizard Step-5 **LEGACY** `ExperiencePreview` branch (byte-stable).
- `supabase/functions/ticket-checkout-create` (checkout contract frozen — I-1).
- Any `ExpandedBusinessEventSheet` reintroduction for experiences.
- `app-mobile/src/hooks/useEventTheme.ts` anon-read mechanism (must stay view-based — COMMS-0009).
- The shared anchor `~/Desktop/mingla-main` (never edit).
- The trip/event consumer detail screens (REFERENCE only — match their richness, do not modify).

The implementor must STOP-AND-AMEND (request a SPEC amendment) before touching anything outside the allowlist.
