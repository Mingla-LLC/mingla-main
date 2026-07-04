# TEST — ORCH-1273 [Admin Offerings console — READ-ONLY]

**Verdict: CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2.
Every backend AC proven with live-fire against LIVE PROD `gqnoajqerqhnvulmnyvv`. Conditions are dispatch-sanctioned, NOT defects: (1) authed admin-web runtime is unreachable headlessly → UI interaction ACs capped at source+build ("suspected", per the dispatch's explicit allowance); (2) named PROD data gaps (0 experiences, 0 event orders, 0 reservations, 0 private-visibility, 0 soft-deleted rows) → those paths proven by mechanism (query runs, shape correct, guard holds), not by populated rows. The #1 gate — admin sees DRAFT/cross-brand that a non-admin cannot, and PII stays RPC-gated — is FULLY PROVEN with live evidence.

**Branch:** `1273-admin-offerings-console` · HEAD tested `d70b229582c85707fb866f53d34af7af51db293c` (+ tester test commit `902dc9550`). Worktree `~/Desktop/mingla-orchs/1273-[admin-offerings-console]`. NOT merged.
**COMMS:** COMMS-0061 (WARN→ALL: `gqnoajqerqhnvulmnyvv` is LIVE PROD, read-only) honored by construction — every probe was a rolled-back `execute_sql` SELECT / function-call. No ledger write (no cross-ORCH discovery).

---

## 1. Live-fire evidence — real rows used

Active admin (only one): `seth@usemingla.com` = uid `63835860-56bc-4ac9-a643-630558e111b5`. Non-admin sim uid `908786cf-4902-4757-bf01-940d9e7736f8` (a consumer, owns none of the draft brands). Admin/non-admin/anon simulated via `set_config('request.jwt.claims',…)` + `SET LOCAL ROLE`, all in `BEGIN…ROLLBACK`.

**8 events in PROD** (matches `admin_offering_stats.total=8`):

| id | type | status | visibility | brand |
|---|---|---|---|---|
| `e5d6c2e6-10e7-4493-8dcc-6722f2c8d657` | event | **draft** | draft | test Brand (`2731cd8b`) |
| `84f481d0-3455-489e-973f-b157212ad60c` | trip | **draft** | draft | test Brand (`2731cd8b`) |
| `c38359da-20f1-4851-aab3-0d8b8ee59a67` | rsvp | **draft** | draft | Party Life (`020cfcf9`) |
| `8cf2fdd9-b42d-454a-85ca-274b0d17fa4b` | rsvp | **draft** | draft | Party Life (`020cfcf9`) |
| `6976567a-de8a-41a3-ba1a-9e7cc5aaefd7` | rsvp | **draft** | draft | Sensei Nuggets (`383aafda`) |
| `699afd22-5f6f-4fcc-9d2f-ed3c161ba6d3` | event | live | public | The Party Block (`655ba0ef`) |
| `de1211d0-b8b7-4590-ba9f-cccaeb89ccc7` | event | scheduled | public | Smoke & Rhythm (`1ce63bf4`) |
| `8b84539d-cb88-43db-8d49-1af7e1ecfdf4` | rsvp | scheduled | public | Smoke & Rhythm (`1ce63bf4`) |

Cross-brand visibility is structurally membership-independent: the RLS qual is purely `is_admin_user()` (no brand clause), and the admin surfaces the draft of **Sensei Nuggets** (`6976567a`) — a brand seth plainly does not own.

---

## 2. AC-by-AC matrix

| AC | Verdict | Live evidence |
|---|---|---|
| **AC-1.1** list `{rows,total}` total≥8, mixed types | **PASS** | `admin_list_offerings()` → total=8; types event/rsvp/trip present. |
| **AC-1.2** filters + total=filtered-count | **PASS** | `p_event_type='rsvp'`→total=4, distinct types=`['rsvp']`; `p_status='draft'`→total=5; `p_search='Rooftop'`→total=1; `p_limit=1`→`rows` length=1 but `total=8` (pre-pagination). |
| **AC-1.3** lifecycle draft/live | **PASS (impl faithful; see P3-1)** | `'draft'` bucket proven for `e5d6c2e6`. `699afd22` computes `'upcoming'` NOT `'live'` — correct per §4.1 CASE because its date row is not `is_master` (`master_start_at=NULL`); spec's "live" example is stale vs PROD data. `by_lifecycle={draft:5, upcoming:3}`. |
| **AC-1.4 — #1 GATE: draft/cross-brand surfaced to admin** | **PASS** | `admin_list_offerings(p_status:='draft')` `rows` `@>` each of `e5d6c2e6`(event), `84f481d0`(trip), `c38359da`(rsvp) → `has_event_draft=has_trip_draft=has_rsvp_draft=true`. All 5 draft ids across 4 brands returned. |
| **AC-1.5** non-admin + anon RPC blocked | **PASS** | Non-admin (`908786cf`): `admin_list_offerings()`→`P0001: not_authorized` (guard line, first stmt). Anon: `42501: permission denied for function`. |
| **AC-1.6** fails-on-revert (list migration) | **PASS (covered)** | Implementor happy-path suite goes RED when the events policy is removed (Step 0.5); tester adversarial suite goes RED on a forced `visibility='public'` filter (§4 angle B). Strict-grep `i-offerings-read-only` FAILs-on-revert (self-test 6/6). |
| **AC-2.1** get_offering event bundle | **PASS** | `admin_get_offering('699afd22')` → `event_type='event'`, `brand_name='The Party Block'`, `child_summary.ticket_type_count=0`, `currency='USD'`; lifecycle `'upcoming'` (P3-1). |
| **AC-2.2** ticket_types RLS-direct + orders RPC shape | **PASS (shape) / COND (data)** | `admin_list_event_orders('699afd22')` → `{rows:[],total:0,summary:{gross_cents:0,refunded_cents:0,paid_count:0,refunded_count:0,ticket_count:0}}` — all keys, money in integer cents. 0 orders in PROD → populated rendering is mechanism-only. |
| **AC-2.3** rsvps counts (going∧approved; capacity) | **PASS (LIVE DATA)** | `admin_list_event_rsvps('8b84539d')` → `total=1`, `counts={going:1, approved:1, confirmed_attending:1, capacity:20, total_headcount:1, capacity_remaining:19, …}`. `counts.capacity=20` == `events.rsvp_capacity=20`; `confirmed=going∧approved`. |
| **AC-2.4** trip children RLS-direct (empty OK) | **PASS** | Draft trip `84f481d0`: `trip_days=0`, `trip_pricing_tiers=1` (real row), `trip_inclusions=0`. `getTripDetail` degrades empties to `[]`; detail renders "None" panels, no crash. |
| **AC-2.5** 4 detail RPCs raise for non-admin; STABLE; no write | **PASS** | All 6 RPCs `provolatile='s'` (STABLE), `prosecdef=true`, `search_path=public`. Non-admin: `admin_get_offering`/`admin_list_event_orders`/`admin_list_event_rsvps`/`admin_list_venue_reservations`/`admin_offering_stats` each → `not_authorized` at guard (first stmt). Bodies carry no INSERT/UPDATE/DELETE. |
| **AC-2.6** direct orders/event_rsvps/reservations as admin = 0 | **PASS** | As admin (RLS enforced): `events=8` but `orders=0, order_line_items=0, tickets=0, order_installments=0, event_rsvps=0, event_rsvp_guests=0, reservations=0`. PII reachable ONLY via definer RPCs. |
| **AC-3.1** venues list RLS-direct | **PASS** | Admin `from('venue_listings')` → 2 venues: "Academy Street Bistro" (restaurant/pending_review/Raleigh), "The Cluster Fuck" (play/pending_review/Raleigh). Both carry `venue_category`+`claim_status`. (Report said 1 — stale; 2 live.) |
| **AC-3.2** venue detail stack + reservations RPC | **PASS (shape) / COND (data)** | Reservation-stack tables all empty (settings/tables/capacity/blackouts/waitlist = 0); `admin_list_venue_reservations(venue)` → `{rows:[],total:0,counts:{}}` (all keys, no crash). 0 reservation-config + 0 reservations in PROD → populated rendering mechanism-only. |
| **AC-3.3** venue-stack RLS load-bearing / fails-on-revert | **PASS (equivalent) / COND** | Venue-stack tables empty → cannot show a row-visibility delta there. Proven on a **populated** new-policy table instead: admin sees `trip_pricing_tiers(84f481d0)=1`, non-admin sees `0`. RLS migration DO-block self-asserts 14 SELECT-only policies at apply time (fails-on-revert). |
| **AC-4.1** admin builds clean | **PASS** | `npm run build` → 2969 modules, `built in 3.51s`, 0 errors. Nav "Business" group + `#/business-offerings`/`#/business-venues` routes wired (source + implementor suite). |
| **AC-4.2** list filters/sort/paginate/CSV/empty | **SUSPECTED (source+build)** | Source-clean: `EntityListView` shell, 6 filters incl. draft/private/lifecycle, sortable columns, CSV config, `emptyMessage`. Authed admin runtime unreachable headlessly → interaction not runtime-fired. |
| **AC-4.3** row-click type-aware detail; no actions | **SUSPECTED (source+build)** | Source-clean: `onRowClick`→`?offeringId=` deep-link + `hashchange` back; `EntityDetailView` type-aware sections; EMPTY `actions` slot (read-only). Not runtime-fired (see AC-4.2). |
| **AC-4.4** no write path (grep + strict-grep) | **PASS** | `i-offerings-read-only.mjs` real-tree PASS + self-test 6/6 + node test 5/5. Services/pages contain zero `.update/.insert/.delete/.upsert`, zero `admin_write_audit`, only read RPCs. |
| **AC-5.1** invariants + gate registered | **PASS** | 2 `I-PROPOSED-1273-*` DRAFT in `INVARIANT_REGISTRY.md`; 6 RPCs appended to `i-admin-gate-first-statement` registry; workflow job `orch-1273-offerings-read-only` (self-test + gate + node-test); fixture present + PASS. |

---

## 3. Findings

**P3-1 — Orphan `status='live'` event with no master `event_date` shows lifecycle `'upcoming'`.**
Evidence: `699afd22` (Summer Rooftop Festival, status=live) has `total_dates=1` but `master_dates=0` (its date row isn't flagged `is_master`) → `master_start_at=NULL` → §4.1 CASE returns `'upcoming'`. Impact: none functional — the console faithfully computes per the §4.1 contract the implementor built to; but spec **AC-1.3's** "expected 'live' for 699afd22" is stale vs current PROD data, and the underlying row is a data-cleanliness anomaly (a "live" offering with no master date). Required fix: none in 1273 (impl is correct). Route to orchestrator as a DISCOVERY: (a) correct the stale AC-1.3 example; (b) investigate why a published/live event has no `is_master` date row (possible organiser-flow / post-wipe residue).

**P4-1 (praise).** Least-privilege is exemplary — every RPC `REVOKE anon,PUBLIC` + `GRANT authenticated` with an apply-time `has_function_privilege` self-assert; the RLS migration self-asserts 14 SELECT-only policies. PII posture (no admin RLS on the 7 money/PII tables; definer-RPC-only) is stricter than a blanket admin SELECT and is the correct support-console default — verified live (admin `from('orders')`=0).

**P4-2 (praise).** Services degrade-not-crash: `.maybeSingle()` everywhere (never `.single()`), primary reads throw into the shell's error+retry state, optional sub-reads log a warning + return `[]` (never fabricated), and `brands` reads select `id,name` only (respects the decommissioned `brands.kind`).

---

## 4. Step 0.5 — independent re-run of the implementor fails-on-revert

Checked out at HEAD `d70b229582`. Implementor happy-path suite (`orch1273_offerings_console_read.test.js`): **46/46 PASS** on the intact tree. True line-deletion of the `events admin can read` policy from `…_offerings_admin_read_rls.sql` → suite RED:
- `not ok 1 - adds an is_admin_user() SELECT policy on events`
- `not ok 15 - adds all 14 enumerated policies (the SPEC '13' is a miscount)` (`# fail 2`)
Restored via `git checkout HEAD -- <migration>` → worktree clean, suite green again. **Fails-on-revert verified.**

## 5. Adversarial test added (tester-owned, different angle)

Path: `mingla-admin/src/__tests__/orch1273_offerings_containment_adversarial.test.js` — commit `902dc9550` (on branch, in `git diff origin/main...HEAD`). **33/33 PASS.** Three angles the implementor's happy-path suite does NOT cover:
- **A — PII/money containment (negative):** asserts NO `CREATE POLICY … ON public.<pii_table>` exists for any of orders/order_line_items/tickets/order_installments/event_rsvps/event_rsvp_guests/reservations.
- **B — draft never silently filtered:** asserts `admin_list_offerings` body carries no forced `visibility='public'`/`status='published'`/`status<>'draft'` predicate, defaults `p_status`/`p_visibility` to NULL (opt-in filters), and keeps `'draft'` as a lifecycle bucket.
- **C — least-privilege + guard-first, file-derived:** parses EVERY `CREATE FUNCTION` in the RPC migration and asserts each is `REVOKE`d from anon+PUBLIC (and never `GRANT`ed back) and guards on `is_admin_user()` as its first statement — catches a future unrevoked/unguarded RPC a hard-coded list would miss.

**Fails-on-revert verified at `d70b229582c85707fb866f53d34af7af51db293c`** (true line-mutation, each restored):
- add `"orders admin can read"` policy → `not ok 1 - no admin (or any) RLS SELECT policy is created on public.orders`.
- force `AND visibility='public'` in `admin_list_offerings` → `not ok 2 - carries NO forced public/published/non-draft predicate`.
- remove `REVOKE … admin_offering_stats() FROM anon, PUBLIC` → `not ok 12 - admin_offering_stats: REVOKEd from anon + PUBLIC`.

Both the implementor happy-path test and this adversarial test appear in `git diff origin/main...HEAD --name-only`.

## 6. Constitution (14) — applicable rules

| # | Rule | Verdict |
|---|---|---|
| 1 | No dead taps | PASS (row-click / back / retry wired; source-level — admin web) |
| 2 | One owner per truth | PASS (offeringsService / venuesService are the single read authority) |
| 3 | No silent failures | PASS (primary reads throw→error+retry; sub-reads log+empty, not faked) |
| 7 | Label transitional | PASS (trip installments + experience feedback labelled "Wave-2") |
| 9 | No fabricated data | PASS (missing→"—"/"None"; empty states real, money from real cents) |
| 10 | Currency-aware | PASS (integer cents + currency code; client-side `Intl` formatter) |
| 13 | Exclusion consistency | PASS (`deleted_at` handling consistent; default excludes deleted) |
| 4,5,6,8,11,12,14 | — | N/A (no React Query factory / Zustand / auth-instance / datetime-validation surface in this admin-web read console) |

No violations.

## 7. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Backend (Supabase PROD `gqnoajqerqhnvulmnyvv`) | **PASS (live-fire)** | 14 SELECT policies + 6 STABLE SECURITY DEFINER RPCs verified DEPLOYED + behaviourally proven (admin/non-admin/anon sims). |
| Admin Web (`mingla-admin/`) — build | **PASS** | `npm run build` clean. |
| Admin Web — authed runtime interaction | **SUSPECTED / BLOCKED-headless** | Authed admin session JWT not injectable in a headless browser → AC-4.2/4.3 interaction not runtime-fired. Operator-unblock: load `mingla-admin` in a browser with an active admin session, open Offerings → filter by Lifecycle=Draft → confirm the 5 drafts list and a row opens the type-aware detail. |
| Consumer iOS / Android · Buyer Web · Business iOS / Android · Business Web preview | **N/A** | ORCH-1273 ships zero shipping-app surface (SPEC §7); admin-web + backend only. |

No edge functions in 1273. Migrations confirmed live on PROD (14 policies + 6 RPCs present with correct volatility/definer/grants).

## 8. Discoveries for orchestrator

- **DISC-1273-A (P3-1):** correct stale spec AC-1.3 ("live" for `699afd22`) and investigate the live event with no `is_master` `event_date` (data-cleanliness / organiser-flow).
- **Data gaps blocking full populated-path proof (dispatch-sanctioned CONDITIONAL):** PROD has 0 experiences, 0 event orders, 0 event RSVP-orders money, 0 reservations, 0 venue reservation-config, 0 private-visibility events, 0 soft-deleted events. Orders/reservations/experience-stops/trip-itinerary populated rendering is mechanism-proven only. To fully live-prove, seed rows on a Supabase dev branch/clone (NEVER PROD — COMMS-0061).
- **Venue count:** 2 venues live (report said 1).

## 9. Accepted conditions (CONDITIONAL PASS)

No P1/P2 to accept. The CONDITIONAL tier is driven solely by dispatch-sanctioned limits, not defects: (a) authed admin-web runtime unreachable headlessly → AC-4.2/AC-4.3 interaction capped at source+build; (b) named PROD data gaps → empty-surface ACs proven by mechanism. Core acceptance (draft/cross-brand visibility + PII containment + least-privilege + guard-first) is fully live-proven. Zero P0/P1 → not blocking; routes to CLOSE once Seth acknowledges the two conditions (or runtime-eyeballs the admin console per the §7 operator-unblock).

**Report path:** `/Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/reports/TEST_ORCH-1273_ADMIN_OFFERINGS_CONSOLE_READ.md`
