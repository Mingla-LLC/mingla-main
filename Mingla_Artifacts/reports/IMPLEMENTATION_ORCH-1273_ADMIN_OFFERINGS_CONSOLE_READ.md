# IMPLEMENTATION — ORCH-1273 [Admin Offerings console — READ-ONLY]

**Parent:** META-ORCH-1237. **Foundation:** ORCH-1271 (gate + shells) + ORCH-1272 (page/service/nav pattern).
**Worktree:** `~/Desktop/mingla-orchs/1273-[admin-offerings-console]/` on branch `1273-admin-offerings-console`.
**Commit:** `d70b229582c85707fb866f53d34af7af51db293c` (fix + tests). **Pushed:** yes.
**Mode:** VISIBILITY-FIRST — READ-ONLY. Zero write path, zero deploy (orchestrator owns DEPLOY).
**Status:** implemented and self-verified (source + gates + build). Live-fire against PROD/dev-branch = tester.

---

## 1. Summary (plain English)

Built the admin **Offerings** + **Venues** consoles: read-only, cross-brand windows over every event, RSVP, trip, experience, and venue on the platform — **including drafts, private, and deleted rows** that a normal brand cannot see. An admin can filter/search/sort/CSV-export the unified offerings list, open any offering to a type-aware detail (ticket tiers + orders, RSVP guest list + counts, trip itinerary/pricing/inclusions, experience stops), and open any venue to its reservation config + reservations. Buyer/guest PII and money never leave the database as raw rows — they flow only through guard-first admin RPCs. Nothing can be edited (that is a later wave).

---

## 2. SPEC success-criteria coverage

All SC satisfied by commit `d70b229`. `HP` self-verified here; `ADV` (live-fire) is the tester's.

| SC | Verification | Result |
|---|---|---|
| AC-1.1 `admin_list_offerings` returns `{rows,total}`, total≥8, across event/rsvp/trip | RPC written per §3.2; PROD probe confirms 8 events (event 3 / rsvp 4 / trip 1) | ✓ source + data-confirmed (ADV live-fire = tester) |
| AC-1.2 type/status/brand/search filters + correct `total` | Filter/sort/count contract in `admin_list_offerings` (whitelisted sort, ILIKE search, pre-pagination `count(*) FROM filtered`) | ✓ source |
| AC-1.3 server lifecycle bucket (live/draft/scheduled) | §4.1 CASE implemented verbatim (live window `[start-4h, start+24h)`, draft/ended/cancelled short-circuits) | ✓ source |
| **AC-1.4 draft/private/cross-brand rows surfaced (#1 gate)** | `events admin can read` SELECT RLS (`USING is_admin_user()`) + RPC has NO brand-membership filter | ✓ source; **ADV live-fire = tester** |
| AC-1.5 non-admin → `not_authorized` | guard is the FIRST statement of every RPC | ✓ source; ADV = tester |
| **AC-1.6 fails-on-revert** | proven — see §6 | ✓ proven at `d70b229` |
| AC-2.1 `admin_get_offering` header bundle | RPC returns type/brand/lifecycle/child_summary + header fields | ✓ source |
| AC-2.2 ticket tiers RLS-direct + `admin_list_event_orders` `{rows,total,summary}` money in cents+currency | `getTicketTypes` + `admin_list_event_orders` (integer cents + currency, never pre-formatted) | ✓ source |
| AC-2.3 RSVP `{rows,total,counts}`, `confirmed=going∧approved`, `capacity=events.rsvp_capacity` | `admin_list_event_rsvps` counts block | ✓ source |
| AC-2.4 trip reads trip_days/pricing/inclusions RLS-direct, empty renders "none" | `getTripDetail` + graceful-empty panels | ✓ source |
| AC-2.5 detail RPCs RAISE for non-admin, are STABLE, no write | all `STABLE SECURITY DEFINER`, guard-first, mutation-free | ✓ source; ADV `pg_proc.provolatile='s'` = tester |
| AC-2.6 direct `from('orders'/'event_rsvps'/'reservations')` → 0 rows | those tables get NO admin RLS (intentional) | ✓ source; ADV = tester |
| AC-3.1 venues list RLS-direct, claim_status+category | `listVenues` reuses `venue_listings admin can read` | ✓ source |
| AC-3.2 venue detail reads the 5 reservation-stack tables + `admin_list_venue_reservations`, empty graceful | `VenueDetailView` + `venuesService` | ✓ source |
| **AC-3.3 5 venue-stack RLS fails-on-revert** | policies added + gate asserts them | ✓ source; fails-on-revert §6; ADV = tester |
| AC-4.1 build clean, nav shows Offerings+Venues, routes load | `npm run build` clean; nav + `App.jsx` routes | ✓ verified |
| AC-4.2 filters/sort/pagination/CSV/empty | `EntityListView` instance + filters/CSV/empty message | ✓ source |
| AC-4.3 row click → type-aware detail, back nav, NO action buttons | `OfferingDetailView`/`VenueDetailView`, `actions` never passed | ✓ source |
| **AC-4.4 no-write guard (fails-on-revert)** | `i-offerings-read-only.mjs` — 0 `.update/.insert/.delete/.upsert`, read RPCs only | ✓ gate PASS; fails-on-revert §6 |
| AC-5.1 2 DRAFT invariants + gate + fixture + workflow + gate-first registry | all added | ✓ verified |

---

## 3. Files changed (17 files, all in-allowlist)

**New — backend (2):**
- `supabase/migrations/20261206000000_orch_1273_offerings_admin_read_rls.sql` (~210 lines) — 14 `is_admin_user()` SELECT policies + `DO $$` SELECT-only self-assert.
- `supabase/migrations/20261206000001_orch_1273_offerings_read_rpcs.sql` (~430 lines) — 5 read RPCs + `admin_offering_stats`, least-privilege REVOKE/GRANT + `has_function_privilege` self-assert.

**New — frontend (6):**
- `mingla-admin/src/services/offeringsService.js` (~200 lines)
- `mingla-admin/src/services/venuesService.js` (~150 lines)
- `mingla-admin/src/pages/OfferingsConsolePage.jsx` (~210 lines)
- `mingla-admin/src/pages/OfferingDetailView.jsx` (~330 lines)
- `mingla-admin/src/pages/VenuesConsolePage.jsx` (~180 lines)
- `mingla-admin/src/pages/VenueDetailView.jsx` (~300 lines)

**New — gate + test (3):**
- `.github/scripts/strict-grep/i-offerings-read-only.mjs` (~230 lines, `--self-test` 6 cases)
- `.github/scripts/strict-grep/__tests__/i-offerings-read-only.test.mjs` (5 tests)
- `mingla-admin/src/__tests__/orch1273_offerings_console_read.test.js` (46 tests)

**Edited — minimal additive (6):**
- `mingla-admin/src/lib/constants.js` — +2 Business nav items (Offerings/Venues).
- `mingla-admin/src/App.jsx` — +2 imports, +2 `PAGES` routes.
- `mingla-admin/src/components/layout/Sidebar.jsx` — +2 lucide imports (`CalendarDays`, `Store`) + ICON_MAP entries.
- `.github/scripts/strict-grep/i-admin-gate-first-statement.mjs` — appended the 6 read RPCs to the registry + self-test fixtures (mirrors 1272's `admin_get_person` append).
- `.github/workflows/strict-grep-mingla-business.yml` — +1 job `orch-1273-offerings-read-only` (gate self-test + gate + fixture test + happy-path node:test).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — +2 DRAFT invariants.

**New — report (1):** this file.

---

## 4. Data-model changes (write .sql only — NOT applied)

**RLS (`20261206000000`):** 14 SELECT-only policies `"<table> admin can read" … USING (public.is_admin_user())` on `events, event_dates, ticket_types, trip_days, trip_pricing_tiers, trip_inclusions, trip_intake_schemas, experience_stops, experience_feedback, venue_reservation_settings, venue_capacity_rules, venue_tables, venue_blackouts, venue_waitlist`. DROP-then-CREATE (idempotent). Ends with a `DO $$` that aborts apply unless exactly 14 SELECT + 0 non-SELECT policies of that name exist. `venue_listings` + `brands` policies REUSED, untouched. `orders/order_line_items/tickets/order_installments/event_rsvps/event_rsvp_guests/reservations` deliberately get NO admin RLS (RPC-only PII posture).

**RPCs (`20261206000001`):** `admin_list_offerings`, `admin_get_offering`, `admin_list_event_orders`, `admin_list_event_rsvps`, `admin_list_venue_reservations`, `admin_offering_stats` — each `STABLE SECURITY DEFINER SET search_path TO 'public'`, guard-first `IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'`, `{rows,total[,summary|counts]}` shape, server-computed lifecycle bucket. Least-privilege: `REVOKE EXECUTE … FROM anon, PUBLIC; GRANT … TO authenticated;` per RPC + a `DO $$` `has_function_privilege` self-assert (anon=false, authenticated=true) that aborts apply if any RPC is anon-executable.

All column/table names verified against LIVE PROD `gqnoajqerqhnvulmnyvv` via read-only `execute_sql` this session (COMMS-0061 honored — SELECT-only, no writes).

---

## 5. Edge functions touched

None. No edge-function or service_role work in 1273.

---

## 6. Regression tests + fails-on-revert

- **Happy-path:** `mingla-admin/src/__tests__/orch1273_offerings_console_read.test.js` — **46 tests, all pass** (RLS 14 policies + SELECT-only + self-assert; 5 RPCs guard-first/STABLE/mutation-free/least-privilege; services read-only + no brand-kind; pages read-only + deep-links; nav/routing/ICON_MAP; gate+workflow+registry).
- **Gate fixture:** `.github/scripts/strict-grep/__tests__/i-offerings-read-only.test.mjs` — 5 tests pass; gate `--self-test` 6/6 pass.
- **fails-on-revert verified at `d70b229582c85707fb866f53d34af7af51db293c`** — TRUE LINE DELETION of the `events admin can read` CREATE POLICY:
  - `i-offerings-read-only.mjs` → **exit 1** ("missing … policy events admin can read").
  - regression suite → **44 pass / 2 fail** (events-policy test + count-14 test).
  - restore (`git checkout`) → gate **exit 0**, suite **46/46 pass**.
- Append-only respected: only NEW test files added; no existing test modified/deleted.

---

## 7. Old → New receipts (net-new surfaces)

Backend: no prior admin read path over offerings/venues existed → NEW 14 RLS policies + 6 read RPCs give admins cross-brand read of every offering/venue incl. draft/private/deleted, with PII/money shaped server-side.
Frontend: the "Business" nav group had People + Brands only → NOW also Offerings + Venues; each is an `EntityListView` list + an `EntityDetailView` detail (type-aware for offerings), read-only (empty `actions`).
Gate-first registry: had `admin_write_audit, admin_audit_probe, admin_get_person` → NOW also the 6 1273 read RPCs (guard-first enforced; NOT in the write-audit registry — they mutate nothing).

---

## 8. Cross-surface impact

| # | Surface | Affected | Note |
|---|---|---|---|
| 1 | Consumer iOS | No | admin-only backend + web |
| 2 | Consumer Android | No | " |
| 3 | Buyer/anon Web | No | " |
| 4 | Business iOS | No | " |
| 5 | Business Android | No | " |
| 6 | **Admin Web** | **Yes** | new Offerings + Venues consoles (single surface, no parity split) |
| 7 | Business Web preview | No | untouched |

Backend migrations are shared infra gating surface 6.

---

## 9. Gate results (self-verified, real output)

- `i-offerings-read-only.mjs --self-test` → **PASS (6/6)**; live → **PASS** (14 policies, 5 STABLE mutation-free RPCs, no write path).
- `i-admin-gate-first-statement.mjs --self-test` → **PASS (4/4)**; live → **PASS** (all 9 registered fns guard-first, incl. the 6 new).
- `meta-orch-0972-no-brand-kind-reads.mjs` → **PASS (N1-N4)**; `grep -rE '\.kind\b' mingla-admin/src` shows only legit non-brand kinds (`trip_inclusions.kind`, `venue_capacity_rules.kind`, pre-existing `signals`).
- **Least-privilege self-asserts (in-migration):** RPC migration `DO $$` loops all 6 signatures asserting `has_function_privilege('anon', …)=false` AND `has_function_privilege('authenticated', …)=true` (aborts apply otherwise). RLS migration `DO $$` asserts 14 SELECT-only policies.
- `i-1272-identity-admin-read.mjs` (regression) → **PASS**; self-test PASS — no foundation regression.
- `mingla-admin`: `npm run build` → **clean** (vite, 2969 modules); net-new lint on all 1273 files → **0 errors** (pre-existing App.jsx `motion` + Sidebar `useCallback` errors are baseline, not in this diff); `npm test` (defined script) → **19/19**.

---

## 10. Known issues / deferred (all per SPEC defaults)

- **SPEC count discrepancy (documented, not a defect):** SPEC prose says "13 policies" but §5 + §9.1 enumerate **14** named tables (events + event_dates + ticket_types + 4 trip + 2 experience + 5 venue-stack = 14). The "13" is an arithmetic miscount; **14** implemented (each backs a live read surface). Noted in the migration, invariant registry, and §12.
- **Detail hash format (deliberate deviation for correctness):** SPEC §3.4/§4.7 write `#/business-offerings/<id>`, but the shipped `getTabFromHash` splits on `?` (not `/`), so a path-segment id would break routing. Implemented the query-param form `#/business-offerings?offeringId=<id>` / `#/business-venues?venueId=<id>` — this MATCHES the mandated ORCH-1272 deep-link pattern exactly and is the only routing-compatible form. See §12.
- **admin_offering_stats shipped** (SPEC Q6 "ship if trivial") — registered in the gate-first registry (guard-first) alongside the 5 required RPCs (SPEC said "5"; the 6th is a new guard-first admin RPC so leaving it unregistered would let it escape the gate — registering it is the safer, in-spirit choice).
- **Wave-2 (design-only, NOT built):** trip installment sub-panel (Q3), experience feedback panel (Q4 — `experience_feedback` keys on `card_id text`, needs a confirmed `card_id ↔ events` mapping), date-range list filter (Q3). Marked in-UI as "Wave-2".
- **Test-data gap (Q5):** PROD has 0 experience events, 0 trip_days, 0 reservations — those panels can only be proven "renders empty gracefully" against PROD; "renders populated" needs seeded rows on a Supabase dev branch/clone (NEVER a PROD write, COMMS-0061). Standard-event, RSVP, and draft-surfacing paths ARE live-provable on PROD today.

---

## 11. Operator action required (orchestrator/operator — DEPLOY owns)

1. **Apply the 2 migrations** (monotonic `20261206*`, collision-checked vs origin/main + all sibling worktrees — clear):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/1273-[admin-offerings-console]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Both are idempotent (DROP-then-CREATE / CREATE OR REPLACE) and self-abort if the RLS SELECT-only or RPC least-privilege lockdown is missing. No `--include-all` needed. No pre-flight data guard (no backfill/destructive predicate) — the migrations only add policies + functions.
2. **No edge-function deploy** (none in 1273).
3. **Then dispatch the tester** for the §8 AC matrix — esp. ADV: AC-1.4 (draft/private/cross-brand surfaced as a non-team admin), AC-2.5/2.6 (PII stays RPC-gated: direct `from('orders'/'event_rsvps'/'reservations')` → 0 rows; RPCs `provolatile='s'`), AC-4.4 (no-write), AC-3.3 (venue-stack RLS fails-on-revert). Seed experience/trip_day/reservation rows on a dev branch per Q5.
4. **At CLOSE:** flip the 2 `I-PROPOSED-1273-*` invariants DRAFT→ACTIVE; one PR squash-merge; update WORLD_MAP.

---

## 12. Discoveries for Orchestrator

1. **SPEC "13 policies" is an arithmetic miscount** — its own enumeration names 14 tables (§5 table + §9.1 list). Implemented 14. No action needed beyond awareness; the invariant/gate/test all say 14.
2. **SPEC's literal detail-hash format (`#/business-offerings/<id>`) is incompatible with the shipped `getTabFromHash`** (splits on `?`, not `/`). Used the query-param form (matches 1272). If a future ORCH wants true path-segment routes, the admin router (`App.jsx getTabFromHash`) must change first — out of 1273 scope.
3. **The 0972 gate matches literal `brands.kind` in COMMENTS too** (no comment-stripping). Any file that documents "we don't read brands.kind" trips it — reworded my comments to "the brand kind column". Worth a note for 1274 (money console) which will also reference brands.
4. **`node --test` bare in mingla-admin surfaces 19 pre-existing failures** (stale ORCH-1008/1013/1014/1015 suites, per the workflow comment) — a separate cleanup ORCH. My CI job runs the specific 1273 test file only, matching the 1271/1272 pattern.
5. **COMMS ledger:** only OPEN row touching scope = COMMS-0061 (WARN→ALL, `gqnoajqerqhnvulmnyvv` is LIVE PROD). Honored by construction — every DB probe this session was read-only SELECT; 1273 ships SELECT-only RLS + STABLE read RPCs and mutates nothing. COMMS-0052 (BLOCK, business-app OTA freeze) is ACKNOWLEDGED and does not apply (no `mingla-business`/OTA touch). No ledger write needed.
