# IMPLEMENTATION — META-ORCH-1255 [multi-venue first-class creation] — LEG A

**Phase:** IMPLEMENT (Leg A: schema + RLS + RPCs + views + edge functions + SQL adversarial tests)
**Worktree:** `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on branch `orch-1255-venue-first-class-multi`
**Spec (binding):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md` (b236bfaf9)
**Commits:** `56185b101` (M1–M5 + 5 SQL test suites) · `bbb7e558f` (5 edge fns + 4 CI gates + workflow + M4 anon-gate fix) · this report.
**Status label:** implemented and verified (DB layer live-fired on a local full-chain Postgres; edge fns statically verified — see §9 honesty split).

## 1. Summary

Venues are now first-class rows. A new `public.venue_listings` table carries identity + the FULL claim lifecycle per venue (the D-4 machine byte-identical, re-keyed off `brands.claim_status`). The authoring pipeline, claim feedback, and the entire reservations suite (settings, tables, capacity rules, availability config, blackouts, waitlist, reservations) are re-keyed `venue_id NOT NULL`; the F-2 one-pipeline-row-per-brand lock and the R-1 `onConflict:"brand_id"` clobber are structurally dead. Creation goes through the new `biz_create_venue_listing` RPC (NEVER inserts a brand); the old hidden-brand RPC is a fail-soft stub. Anon venue reads flow only through the new SECURITY DEFINER `venue_public_view`. All 5 migrations were applied IN ORDER to a local Postgres carrying the full 295-migration prod chain, and 19 named behavioral/adversarial checks across 5 SQL test suites pass live.

## 2. SPEC success-criteria coverage (Leg A rows)

| SC | Status | Proof | Commit |
|----|--------|-------|--------|
| SC-1 (2 creates → 2 venue+pipeline rows, brands delta 0) | ✓ live | `orch_1255_venue_listings.test.sql` T-A1 (local run PASS) | 56185b101 |
| SC-2 (anon table denied; view verified-only) | ✓ live | `orch_1255_public_view_anon.test.sql` ANON-1/ANON-2 | 56185b101 |
| SC-3 (full D-4 walk + sibling isolation) | ✓ live | `orch_1255_claim_state_machine.test.sql` T-A7 (8-step walk incl. suspend/resubmit/re-approve; sibling `to_jsonb` byte-identical at every step) | 56185b101 |
| SC-4 (pipeline clobber dead) | ✓ structural + gate | UNIQUE moved to `venue_id` (STRUCT-2 live) + `onConflict:"venue_id"` + CI gate; end-to-end edge-fn run is the tester's T-A8 (needs deployed fn) | 56185b101/bbb7e558f |
| SC-5 (anon place gate follows venue claim; suspend revokes) | ✓ live | `orch_1255_public_view_anon.test.sql` ANON-3 | 56185b101 |
| SC-15 (3 orphans cleaned) | ✓ written, ⚠ prod-effect at apply | M5 predicate live-probed on PROD read-only: matches exactly 3 rows (Lumen Wine Bar, The Tuscanny Place, Lantern & Vine — 2 currently `is_servable=TRUE`). Local DB had no fixture rows (no-op). Post-apply verify query in §11 | 56185b101 |
| T-A2/T-A3/T-A4/T-A5/T-A6/T-A9 | ✓ live | see §6 | 56185b101 |
| T-C4 DB half (legacy shim 1-venue vs 2-venue) | ✓ live | ANON-4: 2-venue brand → 0 slots; 1-venue brand → slots; edge 409 `venue_ambiguous` implemented (static) | 56185b101/bbb7e558f |

## 3. Files changed

| File | Δ |
|------|---|
| `supabase/migrations/20261130000000_orch_1255_venue_listings_core.sql` | NEW (~170) |
| `supabase/migrations/20261130000001_orch_1255_pipeline_feedback_venue_rekey.sql` | NEW (~120) |
| `supabase/migrations/20261130000002_orch_1255_ops_rekey.sql` | NEW (~900) |
| `supabase/migrations/20261130000003_orch_1255_claim_rpcs_public_views.sql` | NEW (~1010) |
| `supabase/migrations/20261130000004_orch_1255_orphan_place_cleanup.sql` | NEW (~50) |
| `supabase/migrations/__tests__/orch_1255_{venue_listings,claim_state_machine,no_hidden_brand,ops_venue_not_null,public_view_anon}.test.sql` | NEW ×5 (~950 total) |
| `supabase/functions/run-business-place-authoring-pipeline/index.ts` | ~+90/−35 |
| `supabase/functions/admin-review-venue-claim/index.ts` | ~+95/−55 |
| `supabase/functions/admin-review-venue-claim/reviewLogic.ts` | +100 (venue-keyed normalizers appended; brand-keyed kept for append-only tests) |
| `supabase/functions/venue-claim-submitted-email/index.ts` | ~+35/−15 |
| `supabase/functions/venue-claim-decision-email/index.ts` | ~+40/−20 |
| `supabase/functions/venue-reservation-create/index.ts` | ~+85/−15 |
| `.github/scripts/strict-grep/orch-1255-{pipeline-no-brand-onconflict,no-hidden-brand-on-venue-create,venue-approval-per-venue-row,public-venue-anon-safe}.mjs` | NEW ×4 |
| `.github/workflows/strict-grep-mingla-business.yml` | +52 (4 jobs APPENDED; no existing job touched) |

NOT changed (deliberate): `venue-reservation-confirm/index.ts`, `venue-reservation-cancel/index.ts` — both are session/row-keyed; their venue behavior arrives entirely via the re-defined RPCs (`pg_finalize_guest_reservation`, `pg_cancel_my_reservation`). No redeploy strictly required for them, but redeploying is harmless.

## 4. Data-model changes

- **NEW `venue_listings`** (exact SPEC DDL): claim lifecycle columns, `UNIQUE (brand_id, slug)`, partial-unique `place_pool_id`, brand/claim-status indexes, `updated_at` trigger. RLS: member-read + admin-read SELECT only; grants `authenticated SELECT`, `service_role ALL`, `anon NONE`; NO client write policies.
- **NEW trigger fn `_orch1255_venue_belongs_to_brand()`** attached BEFORE INSERT/UPDATE to 11 tables (pipeline, feedback, brand_hours, settings, tables, capacity, availability, blackouts, waitlist, reservations, reservation_checkout_sessions).
- **Pipeline:** `venue_id NOT NULL` FK CASCADE; `brand_place_pipeline_state_brand_unique` DROPPED; `..._venue_unique UNIQUE (venue_id)` added.
- **Feedback:** `venue_id NOT NULL`; `idx_vcf_venue_round`; `venue_claim_active_feedback` view re-emitted grouped per venue (invoker=true preserved).
- **Ops tables:** `venue_id NOT NULL` + venue-scoped hot indexes on all 7; `venue_reservation_settings` PK moved brand→venue (+enabled partial index on venue); `venue_availability_config` UNIQUE moved brand→venue. `brand_hours.venue_id` NULLABLE with dual partial-unique (venue rows / legacy brand rows). `reservation_checkout_sessions.venue_id` NULLABLE (deviation, §10-D3).
- **RPCs re-defined (old signatures DROPPED where the key param renamed):** `biz_create_venue_listing` (NEW), `biz_review_venue_claim(p_venue_id,…)`, `admin_get_claim_review_bundle(p_venue_id)`, `admin_add_venue_claim_feedback(p_venue_id,…)`, `biz_resubmit_venue_claim(p_venue_id)`, `admin_suspend_listing`/`admin_soft_delete_listing`/`admin_restore_listing` (signatures unchanged, bodies venue-resolved), `pg_venue_available_slots(p_date,p_party_size,p_venue_id=NULL,p_brand_id=NULL)` (engine v4 + [TRANSITIONAL-1]), `biz_reservation_create(p_venue_id,…)`, `biz_reservation_transition` (venue-scoped guard/settings), `biz_waitlist_convert_to_reservation` (venue-scoped), `pg_create_guest_reservation(p_venue_id,…)`, `pg_finalize_guest_reservation` (session venue resolution + `venue_ambiguous`), `pg_cancel_guest_reservation`/`pg_cancel_my_reservation` (settings by venue), `biz_derive_service_periods_from_brand_hours(p_venue_id)`, `biz_upsert_brand_hours(p_venue_id,…)`, `pg_brand_experiences_for_place` (venue join), `pg_venue_reservable_for_place` (+additive `venue_id`).
- **Views:** NEW `venue_public_view` (definer, verified-only, anon+authenticated SELECT). `claimed_venues_public_view` untouched ([TRANSITIONAL-2]).
- **Decommissions:** `biz_create_venue_brand_authoring` → `RAISE 'venue_creation_moved:update_app'` stub; `biz_create_venue_brand_pending_review` DROPPED; place_pool anon-read policy re-keyed via NEW definer helper `_orch1255_place_has_verified_venue(uuid)` (§10-D1); `place_pool_business_owner_update` brand-pointer arm → venue arm.
- **M5:** 3-row orphan soft-delete (predicate self-limiting; `_orch1073` trigger force-unserves).

## 5. Edge functions touched (+ verify_jwt to preserve at deploy)

| Function | Changed | verify_jwt |
|---|---|---|
| `run-business-place-authoring-pipeline` | yes — `venue_id` required on every action; `loadOwnedVenue`; `onConflict:"venue_id"`; place-pointer writes → venue row; 6 fallbacks → `venue.place_pool_id`; context pipeline read by venue | default TRUE (no config.toml entry) — preserve |
| `admin-review-venue-claim` | yes — venue-keyed body on every action; venue-keyed RPC calls; email stamp/guard on venue row; per-venue deep links + idempotency key; per-venue email URL | default TRUE — preserve |
| `venue-claim-submitted-email` | yes — `{venue_id}` body; venue row asserted pending; ownership via parent brand | TRUE (config.toml) |
| `venue-claim-decision-email` | yes — `{venue_id}` body; per-venue public URL `/b/{brandSlug}/v/{venueSlug}` | TRUE (config.toml) |
| `venue-reservation-create` | yes — `venueId` (new) or legacy `brandId` ([TRANSITIONAL-1]; 409 `venue_ambiguous`); settings/rules/slots venue-keyed; session carries `venue_id`; pricing via DERIVED brand (D-1) | FALSE (config.toml) |
| `venue-reservation-confirm` | NO code change (RPC-side re-key) | FALSE |
| `venue-reservation-cancel` | NO code change (RPC-side re-key; refund stays brand-keyed per D-1) | FALSE |

All changed fns keep `x-client-info` in CORS (ORCH-1205 gate re-run: PASS).

## 6. Regression tests added (+ fails-on-revert proofs)

Paths (all `supabase/migrations/__tests__/`, house pattern; the spec's literal `supabase/migrations/orch_1255_*.test.sql` path would be executed as a migration by tooling — placed in `__tests__/` like every sibling):

- `orch_1255_venue_listings.test.sql` — T-A1, T-A2, T-A3, T-A1b (client-write denial / claim self-promotion), T-A1c (slug 23505). **5 PASS live.**
- `orch_1255_claim_state_machine.test.sql` — T-A7 (SC-3) + 3 negative arms. **PASS live.**
- `orch_1255_no_hidden_brand.test.sql` — T-A9 + INV-1 (functiondef) + INV-2 (dead RPC gone) + INV-3 (brands delta 0). **4 PASS live.**
- `orch_1255_ops_venue_not_null.test.sql` — STRUCT-1 (9× NOT NULL), STRUCT-2 (unique moved), T-A4 (splice), T-A6 (RETURNING probe ×7). **4 PASS live.**
- `orch_1255_public_view_anon.test.sql` — ANON-1..4 (incl. the [TRANSITIONAL-1] shim ambiguity arm) + AUTH-1. **5 PASS live.**

**fails-on-revert verified at bbb7e558f** — two TRUE reverts, both re-proven then restored:
1. Code revert: `onConflict:"venue_id"` → `"brand_id"` in the pipeline fn → `orch-1255-pipeline-no-brand-onconflict.mjs` FAILS (2 findings, exit 1); restore → PASS.
2. Schema revert (live DB): dropped `..._venue_unique`, restored `..._brand_unique` → `orch_1255_ops_venue_not_null.test.sql` STRUCT-2 FAILS ("R-1 venue clobber re-opened"); restored → full suite PASS.

CI gates (all `--self-test` GOOD+BAD fixtures pass; all pass against HEAD): the 4 new `.mjs` in §3, wired as 4 APPENDED jobs in `strict-grep-mingla-business.yml` (YAML parse OK). Existing affected gates re-run green: orch-1205 CORS, orch-1186 hours-single-owner, orch-1218 vendor-leak. Existing Deno suite for admin-review-venue-claim: **40/40 pass** (append-only tests untouched — venue-keyed normalizers were ADDED beside the brand-keyed ones the historical tests pin).

## 7. Old → New receipts

### 20261130000000–04 (M1–M5)
**Before:** a venue IS a hidden brand row; pipeline/ops keyed one-per-brand; anon venue reads via `claimed_venues_public_view`(brands). **Now:** venue rows under one brand; pipeline/ops one-per-venue with a brand-match trigger; anon reads via `venue_public_view`. **Why:** F-1/F-2/R-1/R-2, D-1..D-4. **Lines:** ~2250 new SQL.

### run-business-place-authoring-pipeline/index.ts
**Before:** brand-keyed; `onConflict:"brand_id"` (R-1); wrote `brands.place_pool_id`; pipeline read `.eq("brand_id").maybeSingle()`. **Now:** `venue_id` required + ownership-chained (`loadOwnedBrand`→`loadOwnedVenue`); `onConflict:"venue_id"`; writes the venue row's pointer/location; per-venue context read. **Why:** §4.A.7 keying-only contract. **Lines:** ~125.

### admin-review-venue-claim (index + reviewLogic)
**Before:** brand-keyed review/feedback/notify; email stamp + dedupe on the brand row. **Now:** venue-keyed end-to-end; once-per-venue email stamp (R-7); venue-scoped deep links + idempotency; per-venue approve URL; `runApproveGoLive` byte-identical (I-CLAIM-REBOUNCE-ON-APPROVE, I-SCORER-INVOKE-HAS-SIGNAL-ID). tweak_fields/score_override accept `venue_id`, brand derived (their RPCs stay brand-keyed — §12-D2). **Lines:** ~250.

### venue-claim-*-email
**Before:** `{brand_id}`; brand claim status; brand page URL. **Now:** `{venue_id}`; venue claim status; venue name in copy; approve links `/b/{brandSlug}/v/{venueSlug}`. **Lines:** ~110.

### venue-reservation-create
**Before:** `brandId` scope everywhere. **Now:** `venueId` scope (legacy `brandId` resolves iff exactly one venue, else 409 `venue_ambiguous` — [TRANSITIONAL-1]); session rows carry `venue_id`; fee/pricing unchanged via the venue's derived brand. **Lines:** ~100.

## 8. Cross-surface impact

| Surface | Leg A effect |
|---|---|
| Consumer iOS/Android | None until apply; post-apply, shipped binaries keep working via [TRANSITIONAL-1] (single-venue resolution; empty-slots/409 fail-soft on multi-venue brands). Resolver gains additive `venue_id`. Parity automatic (shared RN). |
| Buyer/anon Web | `venue_public_view` + place-gate re-key ready for Leg C. `claimed_venues_public_view` returns 0 rows post-apply → old `/b/{slug}` overlay degrades to plain brand page ([TRANSITIONAL-2]). |
| Business iOS/Android/Web preview | NONE until Leg B (old wizard hits the stub → sanitized generic error — intentional D-1 decommission; prod has 0 venue flows in use). |
| Admin Web | Claims queue is EMPTY-but-working until Leg C re-points it (brand rows will never be pending again; venue rows aren't read by the old queue). Sequenced by CLOSE applying everything together. |

## 9. Verification — local-proof vs static-only (brutal honesty)

**Proven LIVE (local Postgres carrying the full 295-migration prod chain, via a deduped scratch copy — `supabase start` cannot apply main's historical duplicate version prefixes, COMMS-0051):**
- M1–M5 apply cleanly IN ORDER on top of the full chain; M1/M4 re-apply idempotently.
- All 19 named checks in the 5 SQL suites (RLS denials, claim walk, splice trigger, RETURNING probe, anon view scoping, engine shim ambiguity arms).
- Both fails-on-revert proofs (§6).
- Post-apply schema state (constraints/PK/signatures/grants/view options) query-verified.

**Static-only (orchestrator MUST live-fire at deploy):**
- The 5 changed edge fns: `deno check` green + 40/40 existing Deno unit tests, but NO runtime invocation (no local edge runtime; authed edge calls unreachable from this session). Live-fire at CLOSE: one curl per fn (§11).
- T-A8 (tier-1 for venue B leaves venue A's pipeline row byte-identical THROUGH THE EDGE FN) — structurally guaranteed (venue-unique + venue conflict target, both live-proven) but the end-to-end edge path is untested. Tester angle per SPEC §9.
- M5's actual prod effect (local DB had no orphan fixtures; predicate + row identity live-probed READ-ONLY on prod: exactly 3 rows).
- Email rendering/Resend paths (copy changes only; not sent).

**Remote probes run (read-only, MCP execute_sql, 2026-07-02):** all 10 assert-empty guard tables = 0 rows; M5 predicate = exactly 3 rows (2 currently servable). Guards cannot abort at apply unless prod drifts after this probe.

## 10. Deviations from the SPEC (each forced, none silent)

- **D1 — anon place-gate needs a definer helper.** The SPEC's inline `EXISTS(venue_listings…)` USING clause on `place_pool` errors 42501 for anon (policy expressions run with the caller's privileges; anon rightly has no `venue_listings` grant). PROVEN live, fixed with `_orch1255_place_has_verified_venue()` SECURITY DEFINER (same mechanism as `is_admin_user()` in policies); semantics identical; ANON-3 proves SC-5.
- **D2 — `pg_venue_available_slots` "compat overload" is impossible in Postgres** (function identity = name + arg TYPES; the spec's two signatures have identical types). Implemented as ONE function with both named optional params — preserves BOTH PostgREST call shapes exactly; live-proven both ways (ANON-4).
- **D3 — `reservation_checkout_sessions.venue_id` (nullable) added** beyond the spec's 8-table list: without it a 2-venue brand's FEE reservation would charge, then fail/mis-key at `pg_finalize_guest_reservation`. Finalize falls back to single-venue resolution, else raises `venue_ambiguous`.
- **D4 — `pg_venue_turn_minutes_for_party` NOT re-keyed** (spec listed it): it is a pure fn of `(turn_times, party_size)` — no brand/venue key exists in it.
- **D5 — `biz_upsert_brand_hours` re-keyed to `p_venue_id`** (not in the spec's table but a forced cascade: the 1186-A bridge helper the spec re-keys per-venue is called from it; a brand-keyed hours upsert is wrong at 2 venues). Old signature dropped; 1186 hours-single-owner gate still green.
- **D6 — venue `verified_at`/`verified_by` stamps dropped** from the approve transition (SPEC M1 DDL has no such columns; every state/guard the machine READS is preserved).
- **D7 — `p_description` accepted but not persisted** on `venue_listings` (no column in SPEC DDL; flows to `place_pool.generative_summary` via tier-1 as before).
- **D8 — test files live in `supabase/migrations/__tests__/`** (house pattern), not bare `supabase/migrations/`.
- **D9 — brand-keyed `normalizeReviewBody`/`normalizeFeedbackBody` kept** (unused) because append-only historical Deno tests pin them; venue-keyed variants added beside them.
- **D10 — venue-approval gate's Leg-B rule ships dormant** (`LEG_B_ACTIVE=false` flag): the rule targets `venueClaimService.ts`, which by design still carries the pre-1255 call until Leg B. Leg B flips the flag in the re-key commit.

## 11. Operator action required — ORDERED apply plan (orchestrator, at CLOSE from MERGED main)

Do NOT `db push` (history drift). Apply via the Supabase Management API against `gqnoajqerqhnvulmnyvv`, in this exact order, one read-back verify each:

1. `20261130000000_orch_1255_venue_listings_core.sql`
   → `SELECT count(*) FROM pg_policies WHERE tablename='venue_listings';` (expect 2) and `SELECT has_table_privilege('anon','public.venue_listings','SELECT');` (expect f)
2. `20261130000001_orch_1255_pipeline_feedback_venue_rekey.sql`
   → `SELECT conname FROM pg_constraint WHERE conname LIKE 'brand_place_pipeline_state%unique';` (expect ONLY `..._venue_unique`)
3. `20261130000002_orch_1255_ops_rekey.sql`
   → `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='public.venue_reservation_settings'::regclass AND i.indisprimary;` (expect `venue_id`) and `SELECT pg_get_function_identity_arguments('public.pg_venue_available_slots'::regproc);` (expect `p_date date, p_party_size integer, p_venue_id uuid, p_brand_id uuid`)
4. `20261130000003_orch_1255_claim_rpcs_public_views.sql`
   → `SELECT has_table_privilege('anon','public.venue_public_view','SELECT');` (expect t) and `SELECT pg_get_functiondef('public.biz_create_venue_brand_authoring(text,text,text,text,double precision,double precision,text,text,text,text,text,text,text,text,jsonb,uuid)'::regprocedure) LIKE '%venue_creation_moved%';` (expect t)
5. `20261130000004_orch_1255_orphan_place_cleanup.sql`
   → `SELECT id,name,deleted_at,is_servable,is_active FROM place_pool WHERE deleted_reason LIKE 'orch-1255:%';` (expect 3 rows, all deleted + unservable + inactive)

Then deploy edge fns from MERGED main (`supabase functions deploy <fn> --project-ref gqnoajqerqhnvulmnyvv`), preserving §5's verify_jwt values: `run-business-place-authoring-pipeline`, `admin-review-venue-claim`, `venue-claim-submitted-email`, `venue-claim-decision-email`, `venue-reservation-create` (+ optionally confirm/cancel — no code delta). One curl each; cheapest live checks: pipeline fn with a missing `venue_id` → 400 `venue_id must be a uuid`; venue-reservation-create with a random legacy `brandId` → 409 `venue_ambiguous`.

Also at CLOSE: flip the 4 DRAFT invariants ACTIVE; Leg B must flip `LEG_B_ACTIVE` in `orch-1255-venue-approval-per-venue-row.mjs` when re-keying `venueClaimService.ts`.

## 12. Known issues / deferred ([TRANSITIONAL] ledger)

- **[TRANSITIONAL-1]** legacy consumer-binary shim: `pg_venue_available_slots.p_brand_id` param + venue-reservation-create legacy `brandId` + finalize's session fallback. Exit: next consumer native build + OTA unfreeze → follow-on migration drops them.
- **[TRANSITIONAL-2]** `claimed_venues_public_view` kept (permanently 0 rows). Exit: next business+consumer native builds supersede shipped binaries → drop view.
- **[TRANSITIONAL-3]** menus stay brand-level (spec non-goal; Leg B keeps `VenueMenuModule` brand-keyed).
- No shared TS type regeneration was needed for Leg B/C (the spec has Leg B define `VenueListing` service-level; no generated `database.types.ts` in the client path for these tables).

## 13. Discoveries for Orchestrator

1. **`resolve_brand_pricing_inputs` row-multiplication hazard (P2, pre-Leg-C):** it LEFT JOINs `venue_reservation_settings ON s.brand_id = b.id`; post-M3 a brand can hold N settings rows, so the resolver can return N rows with divergent `pass_*_override`s — `venue-reservation-create` takes `pricingRows[0]` (arbitrary winner). Spec marks the fn UNTOUCHED (D-1). Recommend a follow-on: keep it brand-keyed but drop the settings join (or make overrides venue-resolved by the caller).
2. **`admin_tweak_venue_claim_fields` / `admin_apply_score_override` are latently broken for NEW venues:** both resolve the place via `brands.place_pool_id`, which is legacy-inert (never written by venue flows). The edge wrapper now derives the brand from the venue, but these two RPCs' internals still look at the dead brand pointer. Admin's PLACE-keyed tuner actions (set/pin/preview) are unaffected. Needs a small follow-on ORCH or a Leg C amendment.
3. **`supabase start` cannot boot main's migration chain** — the historical duplicate version prefixes (20260612/0615/1012/1113/1116/1117) violate `schema_migrations_pkey`. Worked around here with a scratch deduped copy; any future local-stack testing hits the same wall. Worth a one-time doc note or repair decision.
4. **Two of the three M5 orphans are LIVE-SERVABLE on prod today** (Lumen Wine Bar, Lantern & Vine) — ownerless cards potentially in the consumer deck right now; M5's apply removes them.
5. **`biz_waitlist_mark_notified` untouched** (spec listed it "venue-scoped"; it has nothing venue-resolvable inside — row-keyed + brand-rank-gated).
