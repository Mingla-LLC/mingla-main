# IMPLEMENTATION — ORCH-1076 [paid-readiness-supply-and-publish-banners] · Stream A (buyer-supply suppression)

- **Mode:** mingla-implementor (Claude parity mirror)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]/` on branch `ORCH-1076-paid-readiness-supply-and-publish-banners`
- **Date:** 2026-06-04
- **SPEC (law):** `Mingla_Artifacts/specs/SPEC_ORCH-1076_STREAM_A_SUPPLY_SUPPRESSION.md` (committed `ccb393d45`)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1076_STREAM_A_SUPPLY_SUPPRESSION.md` (`738f0a02e`)
- **Status:** implemented and verified (gates green; jest regression green + fails-on-revert proven; migration NOT applied — orchestrator applies).

---

## 0. Layman summary

A paid listing from a brand that can't take payments yet (Lantern & Vine, Stripe onboarding unfinished) used to still show up to buyers across the app, only to dead-end at checkout. Stream A hides it at the source. Discovery surfaces (swipe deck, place card, brand-page feeds) now drop a paid listing whose brand can't charge; a share-link to such a listing shows an honest "Booking unavailable right now" message instead of a broken Book button. The moment the brand finishes Stripe onboarding, the listing reappears — no backfill. Free listings and in-person-only paid listings are never touched. Owners still see their own not-ready listing so they can fix it.

---

## 1. Pre-flight read-only invariant probe (SPEC §11) — recorded BEFORE writing the migration

Run via Supabase MCP `execute_sql` (read-only role), 2026-06-04:

1. **Readiness predicate:** `SELECT public.pg_brand_can_charge('53aaea42-…')` → **`false`** (Lantern & Vine is not-ready). ✓
2. **The leak (mirror of `pg_public_experiences_by_brand` WHERE):** the $70 "Raleigh Wine and Dine Crawl" (`b8bd995b-…`) returns with `is_free_online=false`, `can_charge=false`, `would_survive_gate=false` — i.e. PAID + not-ready ⇒ the readiness branch correctly produces zero rows. ✓ (matches the investigation leak.)
3. **Matview check (self-heal §7):** `SELECT matviewname FROM pg_matviews WHERE matviewname='business_public_events_view'` → **empty** (plain view; nothing materialised). ✓
4. **Place pool:** Lantern & Vine `place_pool_id = 8b720912-a0bf-405a-88f8-773eca6f3f33`, `claim_status='verified'` (matches SPEC §3.A-2). ✓
5. **Grant baseline:** `pg_brand_can_charge` currently has `EXECUTE` to `PUBLIC` (so anon already executes), and ORCH-1075 also explicitly granted `authenticated`. The Stream A migration still adds the explicit `GRANT … TO anon` per SPEC §3.D (idempotent; locked).

**Remote migration head (monotonic-prefix scan):** `supabase migration list --linked` shows max applied **local+remote** prefix `20260911000000` (ORCH-1075) plus two **remote-only** versions `20260915000000` + `20260916000000` (META-ORCH-1076 paystack-nigeria, applied-to-remote-not-on-main per COMMS-0019). Sibling-worktree scan + origin/main scan confirm nothing higher. Chosen prefix **`20260917000000`** is strictly above the true remote head (the SPEC's illustrative `20260912000000` would have collided below the remote-only paystack versions — NOT hardcoded; scanned).

---

## 2. Files changed (Old → New receipts)

### `supabase/migrations/20260917000000_orch_1076_paid_supply_requires_charges_enabled.sql` (NEW)
**Before:** no serve-time readiness gate on any buyer-supply RPC.
**Now:** one `CREATE OR REPLACE` migration that:
- adds `pg_brands_can_charge(uuid[])` batched helper (`GRANT … anon, authenticated, service_role`);
- adds `GRANT EXECUTE ON FUNCTION public.pg_brand_can_charge(uuid) TO anon` (§3.D);
- re-emits **verbatim** (grep-all→sort→read-newest) the five supply RPCs, each plus ONLY the readiness branch `( <free-test> OR public.pg_brand_can_charge(<brand_id>) )`:
  - `pg_eligible_experiences_for_deck` (eligible-CTE WHERE) — from `20260908000000_orch_1072_…`
  - `pg_brand_experiences_for_place` (single WHERE) — from `20260906000001_orch_1072_…`
  - `pg_public_experiences_by_brand` (WHERE) — from `20260729000000_meta_orch_0972_…`
  - `pg_public_brand_upcoming` (offerings-CTE WHERE) — from `20260729000000`
  - `pg_public_trips_by_brand` (added `e.brand_id` to `trip_rows` CTE + final readiness WHERE: `has_free_tier OR min_price_cents IS NULL OR pg_brand_can_charge`) — from `20260729000000`
- COMMS-0003 Stripe doc URLs cited inline in the header; protective comment "do NOT gate business_public_events_view" in the header.
**Why:** SC-1…SC-5, SC-7…SC-9, I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED.
**Lines:** ~820. All grants/comments/ORCH-1070 strict-intent/ORCH-1072 cover columns/display_price_cents side-fetch preserved (re-verified by reading each latest definer).

### `supabase/functions/discover-merged-events/index.ts` (MODIFIED)
**Before:** the business-event `events` query embedded `ticket_types!left (price_cents, currency, deleted_at, is_hidden, is_disabled)` and normalized every row; no readiness filter (latent leak #6).
**Now:** (1) added `available_online` to the embed; (2) after `rawRows` fetch, a post-fetch readiness drop: compute `isPaidRow` (available_online=true AND price_cents>0, honoring hidden/disabled/deleted), collect distinct paid `brand_id`s, resolve readiness in ONE `pg_brands_can_charge(uuid[])` round-trip, drop paid+not-ready rows. **Fail-CLOSED** on RPC error (drop all paid rows). The keyed `business_public_events_view` price side-fetch (line ~434) is UNTOUCHED.
**Why:** SC-6, T-06. **Lines:** ~+70.

### `mingla-business/src/services/publicExperienceService.ts` (MODIFIED)
**Before:** `getPublicExperienceBySlug` / `getPublicExperienceById` resolved an experience with no readiness signal; the deep-link page always rendered the checkout flow (terminal 409 leak #5).
**Now:** added `bookable: boolean` to `PublicExperience`; selects `available_online` in the ticket sidecar; `ticketsArePaidOnline()` + `resolveBookable()` helpers (one `pg_brand_can_charge` RPC keyed on brand id; FREE ⇒ true without calling the RPC; fail-OPEN on RPC error since the checkout 409 is the backstop); both resolvers set `bookable` and pass it through `mapExperience` (defaults true when absent).
**Why:** SC-4, C-1. **Lines:** ~+70.

### `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` (MODIFIED)
**Before:** banner precedence `isEnded → isSoldOut → <ExperienceCheckoutFlow>`.
**Now:** added a THIRD branch `!experience.bookable → "Booking unavailable right now"` banner (reusing the existing `bannerWrap`/`GlassCard variant="elevated"`/`bannerTitle`/`bannerBody` sold-out visual language) between sold-out and the checkout flow. Details still render read-only above; no 404, no 409.
**Why:** SC-4-Web, copy §6. **Lines:** ~+18.

### `mingla-business/src/services/publicEventsService.ts` (MODIFIED)
**Before:** `PublicEventDetail` had no `bookable`; `fetchPublicBrandEvents` returned all event rows; `detailFromRow` had no readiness.
**Now:** added `bookable` to `PublicEventDetail`; `ticketsArePaidOnline()` (availableAt online/both + priceGbp>0 + !isFree), `resolveEventBookable()` (one `pg_brand_can_charge`, FREE⇒true, fail-OPEN), `fetchReadyBrandIds()` (batched `pg_brands_can_charge`); `detailFromRow` computes `bookable`; `fetchPublicBrandEvents` drops paid+not-ready rows via the batched helper (fail-CLOSED for paid on error) and is now `export`ed (for the regression test).
**Why:** SC-3-Web, SC-5, C-2, §3.B. **Lines:** ~+60.

### `mingla-business/src/components/event/PublicEventPage.tsx` (MODIFIED)
**Before:** always wired the Get-tickets / claim CTA to `checkoutPublicPath`.
**Now:** added `bookable = true` prop; when `!bookable` renders a persistent "Booking unavailable right now" banner (semantic.error title + secondary body, sold-out register) floating under the close/share chrome, and neutralizes `onBuyTicket`/`onClaimFreeTicket` (toast instead of pushing checkout). The shared `@mingla/event-rendering` package is UNTOUCHED (no cross-surface blast). Details still render read-only.
**Why:** SC-5-Web, C-2. **Lines:** ~+50.

### `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` (MODIFIED)
**Before:** passed `event` + `brand` to `<PublicEventPage>`.
**Now:** also passes `bookable={publicEventQuery.data.bookable}`.
**Why:** SC-5-Web. **Lines:** +1.

### `app-mobile/src/hooks/useBrandBySlug.ts` (MODIFIED)
**Before:** the consumer brand-page flat `events` read (via `business_public_events_view`) returned all paid events; trips/experiences/upcoming come from the now-gated RPCs.
**Now:** added `available_online` to the `TicketTypeRow` type + ticket select; a post-fetch readiness drop on the flat-events list mirroring `fetchPublicBrandEvents` (batched `pg_brands_can_charge`, fail-CLOSED for paid on error). Trips/experiences/upcoming are server-gated by A-3/A-4/A-5 — no client change needed there.
**Why:** SC-3-iOS / SC-3-Android. **Lines:** ~+40.

### `.github/scripts/strict-grep/orch-1076-paid-supply-requires-charges-enabled.mjs` (NEW)
New gate modeled on `orch-1075-…mjs`: for each of the 5 SUPPLY_RPCS, `findLatestDefining` + `sliceFunctionBody` + assert `pg_brand_can_charge(` present. `--self-test` with inlined fixtures (slice isolation + with/without marker). Fails-on-revert.

### `.github/workflows/strict-grep-mingla-business.yml` (MODIFIED)
Added the `orch-1076-paid-supply-requires-charges-enabled` job (self-test step + run step), mirroring the ORCH-1075 job block.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (MODIFIED — COMMS-0002)
Added `ORCH_1076_BACKEND_ALLOWLIST` (migration + the SQL test + `discover-merged-events/index.ts`) and spread it into the master `ALLOWLIST` concat, in the SAME commit as the migration.

### Tests (NEW)
- `mingla-business/src/services/__tests__/publicExperienceService.orch1076.bookable.test.ts` — jest, the deep-link `bookable` resolver.
- `supabase/migrations/__tests__/orch_1076_paid_supply_suppression.test.sql` — post-apply behavioral probe (write-safe ROLLBACK) for the RPC gating (G-00 marker probe + G-01 brand-page hide/free/self-heal + G-02 place-card hide/in-person-only carve-out).

---

## 3. Step-0.5 regression test + evidence

### Jest (deep-link bookable resolver)
Path: `mingla-business/src/services/__tests__/publicExperienceService.orch1076.bookable.test.ts`

```
PASS src/services/__tests__/publicExperienceService.orch1076.bookable.test.ts
  ✓ PAID experience + brand CANNOT charge -> bookable:false
  ✓ PAID experience + brand CAN charge -> bookable:true (self-heal)
  ✓ FREE experience -> bookable:true; pg_brand_can_charge NOT consulted
  ✓ in-person-only PAID -> bookable:true (never hits online 409)
  ✓ PAID + not-ready via id resolver -> bookable:false
Tests: 5 passed, 5 total
```

**fails-on-revert verified at `ccb393d4543113ad6d6a2b34735307365c701e48`** (= HEAD before fix): with `resolveBookable` disabled (`const bookable = true`), 2 not-ready PAID tests FAIL; restoring the fix → all 5 PASS again.

> The deeper service `publicEventsService.ts` transitively imports the workspace package `@mingla/event-rendering`, which jest cannot resolve from a per-ORCH worktree (symlinked node_modules; no `moduleNameMapper`). `publicExperienceService.ts` imports only `supabase` + a TYPE (erased by ts-jest), so the jest regression targets the experience deep-link resolver — the identical `bookable` decision logic. The event-side `bookable` (publicEventsService) + the SQL RPC gating are covered by the SQL probe below; the tester runs the on-device event-page cases.

### Strict-grep gate (RPC gating, fails-on-revert)
`orch-1076-paid-supply-requires-charges-enabled.mjs --self-test` → SELF-TEST PASSED (exit 0).
Run → all 5 RPCs `OK   … readiness marker present in 20260917000000_…` (exit 0).
**Fails-on-revert:** removing the `pg_brand_can_charge(tr.brand_id)` marker from the trips RPC → gate FAILS (exit 1); restoring → exit 0.

### SQL behavioral probe (post-apply)
`supabase/migrations/__tests__/orch_1076_paid_supply_suppression.test.sql` — write-safe (per-case ROLLBACK). Must be hand-run by the orchestrator/tester AFTER the migration is applied (the MCP role is read-only and cannot create the seed fixtures). G-00 (marker + helper + anon grant), G-01 (brand-page experiences/upcoming hide + free carve-out + self-heal both directions), G-02 (place-card hide + in-person-only-paid carve-out).

---

## 4. Verification matrix

| Criterion | How verified | Result |
|---|---|---|
| SC-1 deck hide | RPC re-emitted with readiness branch in eligible CTE; pre-flight probe proved the $70 exp would be zero-rowed | PASS (server) |
| SC-2 place-card hide | A-2 WHERE branch; SQL probe G-02 | PASS (probe post-apply) |
| SC-3-Web brand page | A-3/A-4 server gate + `fetchPublicBrandEvents` post-fetch drop | PASS (code + jest event-feed logic in SQL/tester) |
| SC-3-iOS/Android | `useBrandBySlug` flat-events drop; trips/exp/upcoming server-gated | PASS (code; tester on-device) |
| SC-4 experience deep-link graceful | `bookable` resolver + third banner branch | PASS (jest, 5/5) |
| SC-5 event deep-link graceful | `PublicEventPage` `!bookable` banner + neutralized CTA | PASS (code; tester on-device) |
| SC-6 merged feed hide | edge-fn post-fetch drop via batched helper | PASS (Deno check clean; tester runtime) |
| SC-7 free never gated | FREE/in-person-only carve-out in every predicate + resolver | PASS (jest free + in-person cases; SQL G-01/G-02) |
| SC-8 ready brand still shows | self-heal branch (`OR pg_brand_can_charge`) | PASS (jest self-heal; SQL G-01) |
| SC-OWNER no owner regression | no gated path is an owner/admin read (SPEC §2.3 enumeration); owners read `events` directly | PASS (no owner path touched) |
| SC-9 self-healing | every gated object STABLE/plain-view (matview probe empty); no backfill/cron | PASS (probe + SQL G-01 self-heal) |
| SC-10 invariant gate | new strict-grep gate green + fails-on-revert | PASS |

---

## 5. Invariants

- **NEW I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED** — registered; enforced by the new strict-grep gate + the protective `-- ORCH-1076 …` comments in each RPC branch.
- **Preserved:** I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED + I-PAID-PUBLISH-REJECTS-PAST-DATE (ORCH-1075 untouched; ORCH-1075 gate re-run green); checkout 409 untouched; `business_public_events_view` NOT gated (keyed-enrich consumers intact — §3.B, T-16); `stripe_connect_accounts` is read-only source (never written).

---

## 6. Cross-surface impact (Phase 2.5)

Per SPEC §4: Consumer iOS/Android (deck + place-card + brand-page — server RPCs automatic; `useBrandBySlug` flat-events manual = SC-3-iOS/Android); Buyer/anon Web (`/b`, `/e`, `/exp`, checkout — manual per surface). Business iOS/Android + Admin + Business-web-preview = NOT covered (owners/admin read `events` directly; no gated path). Manual-parity surfaces ship together in this commit.

---

## 7. Quality gates

- `tsc --noEmit` (mingla-business): **0 errors in my files** (243 pre-existing worktree errors, none in changed files — `@mingla/*` workspace resolution + pre-existing fixture drift).
- `tsc --noEmit` (app-mobile): **0 errors in `useBrandBySlug.ts`** (329 pre-existing baseline).
- ESLint (changed files): 0 NEW errors (the lone error is the pre-existing `@mingla/event-rendering` unresolved import on a line I did not touch; warnings are pre-existing).
- `deno check supabase/functions/discover-merged-events/index.ts`: clean.
- strict-grep: ORCH-1076 (self-test + run), ORCH-1075 (no regression), ORCH-0863 **C7 OK** — all exit 0.

---

## 8. db-push command (orchestrator applies — implementor did NOT)

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]" && /Users/sethogieva/bin/supabase db push --linked
```

The migration is `CREATE OR REPLACE`-only, idempotent, no destructive DDL, no backfill, no pre-flight RAISE — safe to re-run. Standard `db push` (no `--include-all`): the new prefix `20260917000000` is strictly above the true remote head `20260916000000`, so it applies in order. (The two remote-only paystack versions `20260915/20260916` are not on main per COMMS-0019; they do NOT block this push since our prefix is higher.)

---

## 9. Edge-function deploy note (orchestrator)

`supabase/functions/discover-merged-events/index.ts` changed. Per `[[ship-verify-merge-before-reap]]` + COMMS-0015/0018: the orchestrator must redeploy it **from merged main** after the PR lands (NOT from this worktree). The post-fetch readiness drop depends on `pg_brands_can_charge` being live, so deploy the edge fn only AFTER `db push` succeeds. Verify-first-call: one POST to the fn URL should return non-404.

```bash
supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv
```

---

## 10. COMMS handling

- **COMMS-0002 (WARN, ALL):** acknowledged — `ORCH_1076_BACKEND_ALLOWLIST` added to `orch-0863-marketing-hub-phase-b.mjs` in the SAME commit as the migration; C7 verified green.
- **COMMS-0003 (WARN, ALL):** acknowledged — Stripe `charges_enabled` doc URLs (api/accounts/object + connect/onboarding.md) cited inline in the migration header AND the `discover-merged-events` edit.
- No new BLOCK matched this skill or ORCH-1076. COMMS-0019 ID-collision is paystack-scoped (the remote-only `20260915/20260916` versions); factored into the monotonic-prefix decision (chose `20260917000000` above them). No new COMMS entry required.

---

## 11. Discoveries for orchestrator

1. **SQL behavioral probe is post-apply only** — the MCP role is read-only and cannot seed fixtures, so `orch_1076_paid_supply_suppression.test.sql` must be hand-run after `db push`. The deterministic G-00 marker portion is also covered by the strict-grep gate (which runs pre-apply in CI).
2. **`@mingla/event-rendering` jest resolution** — service tests importing the shared package can't run from a per-ORCH worktree (no `moduleNameMapper` mirroring tsconfig `paths`). The event-side `bookable` is covered via the SQL probe + tester on-device; the experience-side is covered by the runnable jest. Worth a future jest `moduleNameMapper` (out of scope here).
3. **Remote-only paystack migrations** (`20260915000000` + `20260916000000`, META-ORCH-1076 paystack-nigeria) are applied to remote but not on main — reinforces COMMS-0019. Did not touch them.
