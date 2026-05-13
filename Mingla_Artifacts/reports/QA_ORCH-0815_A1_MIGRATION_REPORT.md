# QA REPORT — ORCH-0815-A1 Marketing Hub Phase A Migration

**ORCH:** ORCH-0815-A1 (sub-ORCH of ORCH-0815)
**Sub-mode:** TARGETED (schema-only — no TS code exists yet)
**Scope:** `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0815_MARKETING_HUB_UI_PHASE_A.md` §6
**Design:** `Mingla_Artifacts/design/DESIGN_ORCH-0815_MARKETING_HUB_PHASE_A.md`
**Date:** 2026-05-12
**Tester:** Claude `mingla-forensics` (TEST mode)
**Project:** `gqnoajqerqhnvulmnyvv` (linked Supabase)

---

## Verdict

**PASS** — migration is production-ready; no blockers found.

| Severity | Count |
|---|---|
| P0 — CRITICAL | 0 |
| P1 — HIGH | 0 |
| P2 — MEDIUM | 0 |
| P3 — LOW | 3 (architectural notes, non-blocking) |
| P4 — NOTE | 4 (praise / observations) |

Recommendation: proceed to sub-ORCH-0815-A2 (TS layer + Customers tab + Buyers tab).

---

## Phase 0 — Context Ingest

Already in-session (this skill was dispatched mid-flow with full SPEC + design + migration in working memory). No additional ingestion required.

---

## Phase 1 — Scope Confirmation

What is being tested: **migration only**. No TS, no edge functions, no UI, no `marketing-send` cron yet (those are sub-ORCH-B / C).

What landed on remote (`gqnoajqerqhnvulmnyvv` via operator `supabase db push --linked`):
- 6 new tables (marketing_audiences / templates / campaigns / messages / clicks / unsubscribes)
- 1 new helper function `public.mkt_brand_min_rank(uuid, text)` — STABLE, non-SD
- 12 explicit indexes + 6 PK indexes + 1 explicit unique = 19 indexes total
- 15 RLS policies
- 13 CHECK constraints
- 13 foreign keys
- 5 starter-pack templates seeded
- 1 migration ledger row: `20260602000003 orch_0815_marketing_hub_phase_a`

---

## Phase 2 — Blast Radius

No downstream consumers exist yet (TS layer is sub-ORCH-A2). Verified:

- No existing migration touches table names `marketing_*` (no collision)
- No existing edge function imports anything from these tables (no `_shared/` already calls into them)
- The local helper `mkt_brand_min_rank` is namespaced (`mkt_*` prefix) and cannot collide with existing `biz_*` helpers
- Migration is **additive only** — no DROP / no ALTER on existing objects

---

## Phase 3 — Forensic Read Findings

Migration source `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql` (611 lines) — read in full.

### What it does (verified line-by-line):

1. **Local helper `mkt_brand_min_rank(uuid, text)`** — NOT SECURITY DEFINER (`prosecdef = false` verified live), `STABLE`, `PARALLEL SAFE`, `SET search_path TO public, pg_temp`. Body uses two `EXISTS` subqueries:
   - First: `b.account_id = auth.uid()` (brand owner direct check)
   - Second: active membership in `brand_team_members` with `biz_role_rank(m.role) >= biz_role_rank(p_min_rank)`
   - REVOKEd from PUBLIC, GRANTed only to `authenticated`.
2. **6 tables created with `CREATE TABLE IF NOT EXISTS`** (idempotent).
3. **All FKs correctly cascade:**
   - `marketing_campaigns.{account_id,brand_id,audience_id}` use `ON DELETE RESTRICT` (preserves campaign history if upstream rows soft-deleted)
   - `marketing_campaigns.template_id` uses `ON DELETE SET NULL` (templates can be deleted without breaking historical campaigns)
   - All other FKs use `ON DELETE CASCADE` appropriately
4. **All CHECK constraints in place** (live introspection confirms):
   - `marketing_audiences_query_kind_valid` — enforces `query_definition->>'kind' IN (...)` discriminated union (I-PROPOSED-BP)
   - `marketing_campaigns_payload_kind_valid` — enforces `channel_payload->>'kind' = channel` (I-PROPOSED-BQ — stronger than SPEC text alone, since it ties the discriminator to the channel column)
   - `marketing_messages_status_check` — includes `preview_skipped` for the live-broadcast gate
   - `marketing_templates_authorship_valid` — starter pack rows have `account_id IS NULL`, user rows have `account_id IS NOT NULL`
   - `marketing_unsubscribes_either_email_or_phone` — exactly one of contact_email / contact_phone is set
   - `marketing_unsubscribes_scope_keys` — scope/account/brand alignment
5. **RLS enabled on all 6 tables.** 15 policies total (counts per table: audiences 4, templates 4, campaigns 4, messages 1, clicks 1, unsubscribes 1).
6. **Apply-time `DO $$` probes** RAISE EXCEPTION on partial apply — all 7 probes passed (since `supabase db push` succeeded; any failure would have rolled back the transaction).
7. **Starter-pack seed** uses deterministic UUIDs (`00000815-0001-0000-0000-00000000000{1..5}`) + `ON CONFLICT (id) DO UPDATE` for idempotent re-apply.

---

## Phase 4 — Constitution Check (14 rules)

| # | Rule | Status | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No UI in this sub-ORCH |
| 2 | One owner per truth | PASS | Each marketing table has single ownership; helper is single-source |
| 3 | No silent failures | PASS | Apply-time probes RAISE EXCEPTION on partial apply; CHECK constraints reject malformed data at INSERT time |
| 4 | One key per entity | N/A | No React Query in this sub-ORCH |
| 5 | Server state server-side | N/A | No client state |
| 6 | Logout clears everything | N/A | No auth-side caches |
| 7 | Label temporary | PASS | No `[TRANSITIONAL]` code introduced |
| 8 | Subtract before adding | PASS | Pure additive migration; no DROP/ALTER on existing schema |
| 9 | No fabricated data | PASS | No `DEFAULT` that fakes values; all defaults are honest (zeros, timestamps, draft status) |
| 10 | Currency-aware UI | N/A | No currency in this sub-ORCH |
| 11 | One auth instance | N/A | No auth code |
| 12 | Validate at right time | PASS | CHECK constraints fire at INSERT time (not deferred to app code) |
| 13 | Exclusion consistency | PASS | Discriminated-union CHECKs enforce shape uniformly across all rows |
| 14 | Persisted-state startup | N/A | No client persistence |

**Verdict:** Constitution compliant where applicable. No violations.

---

## Phase 5 — Behavioral Contract Verification (SPEC §6)

Cross-checking every SPEC §6 contract against live database introspection:

| SPEC contract | Live state | PASS/FAIL |
|---|---|---|
| `marketing_audiences` table + columns | 8 cols (7 NOT NULL) — matches `id, account_id (NN), brand_id, name (NN), query_definition (NN), is_system_generated (NN), created_at (NN), updated_at (NN)` | PASS |
| `query_definition` discriminated-union CHECK with 4 kinds | `CHECK ((query_definition ->> 'kind') = ANY ARRAY['brand_buyers','event_buyers','brand_followers','custom_segment'])` | PASS |
| `marketing_templates` table + columns | 10 cols (7 NOT NULL) — matches spec | PASS |
| `marketing_templates_authorship_valid` (starter-pack vs user) | `((is_starter_pack AND account_id IS NULL) OR (NOT is_starter_pack AND account_id IS NOT NULL))` | PASS |
| `marketing_campaigns` table + columns | 14 cols (10 NOT NULL) — matches spec | PASS |
| `marketing_campaigns_payload_kind_valid` (discriminator = channel) | Live constraint additionally ties `kind = channel` column — STRONGER than spec text; this is correct and prevents a class of "email channel with sms payload" bugs | PASS+ (stronger) |
| `marketing_campaigns_status_check` (6 status values) | `draft, scheduled, sending, sent, failed, cancelled` | PASS |
| `marketing_messages.status` includes `preview_skipped` for env-flag gate | Constraint definition explicitly contains `preview_skipped` | PASS |
| `marketing_messages_recipient_present` | `recipient_email IS NOT NULL OR recipient_phone IS NOT NULL` | PASS |
| `marketing_clicks.tracking_id UNIQUE` | `marketing_clicks_tracking_id_key` unique index live | PASS |
| `marketing_unsubscribes_either_email_or_phone` XOR | Exact match | PASS |
| `marketing_unsubscribes_scope_keys` alignment | Scope/account/brand FK alignment enforced | PASS |
| `uq_unsub_email_channel_scope` partial unique with COALESCE | Live; also added `uq_unsub_phone_channel_scope` symmetric (good extension) | PASS+ |
| 12 explicit indexes | All 12 present + 6 PKs = 18; plus `marketing_clicks_tracking_id_key` from UNIQUE constraint = 19 | PASS |
| RLS enabled on all 6 tables | `relrowsecurity = true` for all 6 (`rls_enabled_count = 6`) | PASS |
| No SECURITY DEFINER helper in RLS (SPEC §6.5) | `mkt_brand_min_rank.prosecdef = false`; `biz_brand_effective_rank_for_caller` is NOT referenced anywhere in marketing policies | PASS |
| Apply-time `DO $$` probes (SPEC §6.6) | 7 probes present; all passed (migration applied without rollback) | PASS |
| 5 starter-pack templates seeded | 5 rows where `is_starter_pack = true AND channel = 'email'`; all have subject + body + `{first_name}` variable; 4 of 5 have `{{event:...}}` token (the post-event "Thank you" intentionally omits it) | PASS |

**All SPEC §6 contracts honored. PASS.**

---

## Phase 6 — Independent Tests

MCP probes ran in read-only transaction (`mcp__supabase__execute_sql` cannot INSERT). Negative-control inserts to verify CHECK rejection are NOT possible via MCP; however, the CHECK constraint definitions are themselves immutable contracts — once stored in `pg_constraint`, they fire on every INSERT without exception.

### Verified by introspection:

| Test | Method | Result |
|---|---|---|
| All 6 tables exist | `information_schema.tables` count | 6 ✓ |
| All 6 tables RLS-enabled | `pg_class.relrowsecurity` count | 6 ✓ |
| Helper exists + non-SD | `pg_proc.prosecdef = false` | confirmed (sd=false, volatile=s) ✓ |
| 5 starter-pack templates with correct fields | direct SELECT | confirmed all 5 ✓ |
| Migration ledger row | `supabase_migrations.schema_migrations` | `20260602000003 orch_0815_marketing_hub_phase_a` ✓ |
| Discriminator CHECK enforces shape | `pg_constraint.consrc` introspection | both kind CHECKs live ✓ |
| `preview_skipped` value allowed | constraint def `LIKE '%preview_skipped%'` | ✓ |
| All 12 explicit indexes present | `pg_indexes` enumeration | 12 ✓ |
| 13 FKs present + correct cascade modes | `pg_constraint` enumeration | 13 ✓ matches spec |
| No SECURITY DEFINER helpers in marketing RLS | scanned all 15 policy USING/WITH CHECK clauses | none reference `biz_brand_effective_rank_for_caller` ✓ |

### Cannot verify via MCP (deferred to integration tests in sub-ORCH-A2):
- RLS actually denies a non-member user from SELECT (MCP runs service-role which bypasses RLS)
- CHECK actually rejects a malformed INSERT at runtime (MCP is read-only)
- ON CONFLICT idempotency of seed re-apply (MCP is read-only)

These will be covered by sub-ORCH-A2 jest tests + sub-ORCH-A2 Supabase auth-context probes (operator-side run) per SPEC §11 T-16/T-17/T-18.

---

## Phase 7 — Parity Enforcement

- **Mobile/Business/Admin parity:** schema is shared — same tables visible to all 3 surfaces. No surface-specific drift.
- **iOS/Android parity:** schema is platform-agnostic. N/A for this sub-ORCH.
- **Solo/Collab parity:** N/A (no card flows).

---

## Phase 8 — UI/UX Coherence

N/A — no UI in this sub-ORCH. UI lands in sub-ORCH-A2 (Customers tab + Buyers tab + BuyerRow).

---

## Phase 9 — Cross-Domain Impact

- `mkt_brand_min_rank` helper is namespaced (`mkt_*` prefix) — no collision with existing `biz_*` helpers
- Marketing tables use `marketing_*` prefix — no collision with existing tables
- Migration adds nothing to existing tables (`brands`, `events`, `orders`, `brand_team_members`, `auth.users`) — zero risk of breaking existing consumers
- `biz_role_rank` is used (read-only) — function exists pre-baseline, no risk
- Migration timestamp `20260602000003` is the next sequential slot after recent ORCH commits (20260601000002 was last) — clean ordering

---

## Phase 10 — Pattern Compliance

Compared against recent neighbour migrations (`20260530000000_orch_0804_orders_tax_columns.sql`, `20260531000000_orch_0807_brand_avatars_storage.sql`, `20260601000000_orch_0808_appsflyer_devices_app_discriminator.sql`):

| Pattern | This migration | Neighbours | Compliance |
|---|---|---|---|
| `BEGIN ... COMMIT` wrapper | ✓ | ✓ | match |
| `DO $$ ... RAISE EXCEPTION` apply-time probes | ✓ (7 probes) | ✓ (ORCH-0805 has them) | match |
| `IF EXISTS` / `IF NOT EXISTS` idempotency | ✓ on tables + policies | ✓ | match |
| Header comment block explaining intent + cross-refs | ✓ | ✓ | match |
| RLS pattern (`DROP POLICY IF EXISTS` before `CREATE POLICY`) | ✓ | ✓ | match |
| Synthetic forward-dated timestamps | ✓ (20260602...) | ✓ | match |

**No pattern deviations.** Implementation is consistent with recent Mingla migrations.

---

## Findings — Detailed

### P3 — LOW (architectural notes, non-blocking)

**P3-1: `'brand_member'` is not a real role in `biz_role_rank`** — The SELECT-policy fallback predicate is `mkt_brand_min_rank(brand_id, 'brand_member')`. The `biz_role_rank` function returns `0` for unknown role strings (ELSE branch), and all valid roles (scanner=10, marketing_manager=20, finance_manager=30, event_manager=40, brand_admin=50, account_owner=60) return values ≥ 10. So the predicate effectively means "is an active team member" (since `biz_role_rank(active_role) >= 0` is always true). This is the SPEC's intent (§5.7: "Tab visible to anyone with brand_member rank"), but the implementation relies on the ELSE-branch behavior of an external helper.

- **Why it matters:** if a future migration changes `biz_role_rank` to RAISE on unknown role names, all marketing SELECT policies silently break.
- **Fix recommendation (low priority):** either (a) use `'scanner'` (the actual lowest valid role, rank 10) in the migration as the documented floor, OR (b) add `'brand_member'` as a real role with rank 5 in `biz_role_rank` via a separate ORCH.
- **Defer:** acceptable for sub-ORCH-A2 build; revisit if `biz_role_rank` changes.
- **Reference:** `supabase/migrations/20260602000003_orch_0815_marketing_hub_phase_a.sql:88, 174, 220, 271` (SELECT policies)

**P3-2: No explicit DENY policies on `marketing_messages` / `marketing_clicks` for `authenticated`** — These tables have only SELECT policies; INSERT/UPDATE/DELETE rely on service-role bypassing RLS. This is the established Mingla pattern (e.g. `notification_outbox`) and works correctly, but it's "defense-in-depth one layer thin": a future edge function bug that accidentally uses an `authenticated` client to write to these tables would be silently denied by absence-of-policy, but the error message would be "row violates row-level security policy" rather than a clear "this table is service-role only."

- **Fix recommendation (low priority):** explicit `CREATE POLICY ... FOR INSERT/UPDATE/DELETE TO authenticated USING (false)` policies would document the contract and produce clearer errors. Not blocking.
- **Reference:** §4 and §5 of migration (marketing_messages, marketing_clicks RLS sections)

**P3-3: `marketing_unsubscribes` token-based public unsubscribe path is not covered by RLS** — The SELECT policy gates authenticated reads. The anonymous "click unsubscribe link in email" flow will go through a public `marketing-unsubscribe` edge function (per SPEC §7.3) using a signed token — NOT direct table access. This is correct, but means a future bug that exposes anonymous SELECT on this table would leak unsubscribe history. SPEC §7.3 plans the edge function correctly; flagging only as a future security-review checkpoint.

- **Fix recommendation:** none for sub-ORCH-A1; ensure sub-ORCH-B edge function signs tokens correctly.

### P4 — NOTE (praise / observations)

**P4-1 (praise):** Apply-time `DO $$` probes RAISE EXCEPTION on partial apply — 7 probes covering helper non-SD status, table count, RLS count, both discriminator CHECKs, `preview_skipped` status value, seed count, and index count. This is exactly the right pattern for a multi-table migration.

**P4-2 (praise):** Starter-pack templates use deterministic UUIDs (`00000815-0001-0000-0000-00000000000{1..5}`) with `ON CONFLICT (id) DO UPDATE` — idempotent re-apply that also refreshes copy if seed text is edited in a future migration patch. Clean choice.

**P4-3 (praise):** `mkt_brand_min_rank` helper is:
- Local-scoped (`mkt_*` prefix won't collide with `biz_*`)
- `STABLE` + `PARALLEL SAFE` — query planner can cache + parallelise
- NOT `SECURITY DEFINER` (correctly avoids the RLS-RETURNING-OWNER-GAP class)
- `SET search_path TO public, pg_temp` (prevents search-path injection)
- REVOKEd from PUBLIC, GRANTed only to `authenticated`

**P4-4 (observation):** Migration timestamp `20260602000003` is in the future relative to today (2026-05-12). This is the codebase's established synthetic-forward-dated convention (recent ORCH commits: 20260530/20260531/20260601). Wall-clock chronological ordering in `supabase_migrations.schema_migrations` is broken by design — the codebase treats timestamps as monotonic identifiers, not real dates. Consistent with pattern.

---

## Discoveries for Orchestrator

1. **The `marketing_campaigns_payload_kind_valid` CHECK is stronger than SPEC §6.4 text.** SPEC says the discriminator is `kind`; live migration additionally enforces `channel_payload->>'kind' = channel`. This is *better* than spec because it prevents a class of cross-channel-payload bugs. Recommend updating SPEC §6.4 to document this strengthening (orchestrator decision).

2. **Migration adds `uq_unsub_phone_channel_scope` (phone-side mirror of email-side unique) which is not in SPEC §6.1 explicitly.** Symmetry with email is the obvious right call but should be documented in SPEC for completeness.

3. **ORCH-0815-A1 is now ready for CLOSE.** Standard CLOSE artifacts to update on orchestrator close: WORLD_MAP / MASTER_BUG_LIST / PRIORITY_BOARD / COVERAGE_MAP / AGENT_HANDOFFS. DIAG-marker reap: `grep -rn "[ORCH-0815-A1-DIAG]"` should be zero (no DIAG markers were introduced in the migration).

4. **`brand_member` role naming inconsistency** (P3-1 above) — could be the seed of a small follow-up ORCH (`ORCH-0815-A1-A` add `brand_member` to `biz_role_rank` as rank 5, OR rewrite marketing SELECT policies to use `'scanner'` as documented floor). Defer until sub-ORCH-A2 PR review reveals whether anyone hits the surface.

---

## Working Tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

---

## Confidence Level

**HIGH.** Every SPEC §6 contract verified live via MCP introspection. Helper, all 13 CHECK constraints, all 15 RLS policies, all 13 FKs, all 19 indexes, all 5 starter-pack rows, and the migration ledger row are observable and match the SPEC contract. Zero defects found at the schema layer. The only items deferred to runtime tests (RLS deny under non-member auth context, CHECK reject on malformed INSERT, ON CONFLICT idempotency) are inherent limitations of read-only MCP probing and will be naturally covered by sub-ORCH-A2's jest tests against the live database.
