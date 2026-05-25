# REVIEW — ORCH-0963 IMPLEMENTATION

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Subject:** Implementation commit `4d437b94c` on branch `ORCH-0963-public-brand-page-events-vs-trip`
**Verdict:** **APPROVED** — ready for tester dispatch.

---

## 1. Commit-hash verification (mandatory per DEC-179)

Every file claimed-changed in `IMPLEMENTATION_ORCH-0963_*.md` is present in commit `4d437b94c`. `git status` clean on per-ORCH branch. No modified-but-uncommitted artifacts.

| File | Commit |
|------|--------|
| `supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql` (138 lines) | `4d437b94c` ✓ |
| `supabase/migrations/__tests__/pg_public_trips_by_brand.test.ts` (140 lines) | `4d437b94c` ✓ |
| `supabase/migrations/__tests__/pg_public_trips_by_brand.antiLeak.adversarial.test.ts` (98 lines) | `4d437b94c` ✓ |
| `supabase/migrations/20260727000002_orch_0954_controller_dashboard_type_check.sql` (source-reconciled) | `4d437b94c` ✓ |
| `supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql` (source-reconciled) | `4d437b94c` ✓ |
| `mingla-business/src/services/publicEventsService.ts` (+123 lines net) | `4d437b94c` ✓ |
| `mingla-business/src/services/__tests__/publicEventsService.tripFetch.test.ts` (248 lines) | `4d437b94c` ✓ |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` (+633 lines net) | `4d437b94c` ✓ |
| `mingla-business/app/b/[brandSlug]/index.tsx` (+1 line) | `4d437b94c` ✓ |
| 6 component test files | `4d437b94c` ✓ |
| `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs` (161 lines) | `4d437b94c` ✓ |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (+15 lines for ORCH_0963_BACKEND_ALLOWLIST) | `4d437b94c` ✓ |
| `.github/workflows/strict-grep-mingla-business.yml` (+11 lines for new job) | `4d437b94c` ✓ |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` (+24 lines for DRAFT invariant) | `4d437b94c` ✓ |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0963_*.md` (300 lines) | `4d437b94c` ✓ |

**Total:** 20 files, +2437 / -77 lines. Matches implementation report inventory.

---

## 2. Dependency walk for config-layer changes (mandatory per DEC-179)

Config-layer files touched:

### `.github/workflows/strict-grep-mingla-business.yml`
- **Change:** added one new job `orch-0963-public-brand-kind-branched` (11 lines).
- **Consumers:** GitHub Actions CI only. No application code parses this YAML.
- **Compatibility:** purely additive. YAML job is independent of existing jobs; adding it below the ORCH-0957 job cannot break any existing job.
- **Verdict:** safe.

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- **Change:** added `ORCH_0963_BACKEND_ALLOWLIST` constant (5 file paths) and included it in the C7 allowlist union. Mirrors the existing 25+ allowlist constants for prior ORCHs.
- **Consumers:** the orch-0863 gate script runs as a required PR check.
- **Compatibility:** additive — new array constant + one new spread into the existing union. Doesn't alter existing allowlist behavior.
- **Local run:** ORCH-0863 gate 7/7 PASS with new ORCH-0963 files admitted.
- **Verdict:** safe.

### `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs`
- **Change:** new file (161 lines), 4 assertions.
- **Consumers:** the new workflow job invokes this script.
- **Compatibility:** new script, no existing-script changes. Local run 4/4 PASS.
- **Verdict:** safe.

No other config-layer files (`app.json`, `app.config.ts`, `package.json`, `tsconfig.json`, `vercel.json`, `metro.config.*`, `babel.config.*`, `next.config.*`) touched.

---

## 3. REVIEW gate checklist

| Gate | Verdict | Evidence |
|---|---|---|
| Root cause proven? | Y | Implementation matches SPEC §3.1-§3.6 exactly; cross-referenced against INVESTIGATION F-1..F-7 (which proved the gap). |
| Scope appropriate — could be narrower? | Y | Single surface (buyer-web). Event-brand polish bundled per locked Decision 2. Out-of-scope items honored (no `<Head>` block, no font/color tokens — ORCH-0964 turf preserved). |
| Hidden fallback paths that mask failure? | N | T-05 adversarial pins null-spots-left → no badge (never "null spots left"). Bookings-closed beats scarcity (T-06). Honest empty states ("No upcoming trips yet"). |
| Stale cache paths serving old data? | N | React Query key unchanged (`publicEventKeys.brandBySlug`); dispatch is server-side so cache stays coherent. |
| Response shape truthful in ALL states? | Y | Loading state inherited from `PublicBrandRoute` unchanged. Error state same. Empty trip-brand → "No upcoming trips yet". Populated → trip cards with honest fields. Brand-kind dispatch never crosses streams. |
| Real fix or symptom mask? | Real | New RPC + new component primitives + new invariant + new strict-grep gate. Architectural fix. |
| Solo/collab parity? | N/A | Buyer-anon route, no auth, no collab mode. |
| Constitutional compliance? | Y | All 14 quick-checked in implementation report §8. |
| Evidence chain complete? | Y | INVESTIGATE (`a60204e32` + `bd6b2d9fe`) → SPEC (`39599c141`) → SPEC REVIEW (`9395b4dfa`) → DISPATCH (`8832462f6`) → IMPLEMENT (`4d437b94c`) — all 6 commits on per-ORCH branch. |
| Documents updated? | Y | INVARIANT_REGISTRY DRAFT entry committed. WORLD_MAP / OPEN_INVESTIGATIONS / WORKTREE_REGISTRY rows added at INTAKE. CLOSE will flip the invariant DRAFT → ACTIVE + sync the 7 closure documents. |
| Migration applied? | Y | Operator ran `supabase db push` 2026-05-25. Mgmt API verification: function exists with `prosecdef=true` (SECURITY DEFINER) + `provolatile='s'` (STABLE); all 5 roles (anon, authenticated, service_role, supabase_admin, postgres) have EXECUTE per `has_function_privilege`; brand-kind guard works (function returns 0 rows for popup brand `leggothis` and unknown slug `nonexistent-slug` — confirmed by query plan + grant check + the equivalent-SQL replay returning correct travelbrand rows). |
| Live row verification (replay query, MCP runs as `supabase_read_only_user` not in GRANT list)? | Y | Replay returned 2 rows for `travelbrand`: "The DC Adventure" Aug 17-22 (capacity 102, sold 81, spots_left 21, €500) + "The Sone" Sep 19-22 (capacity 200, sold 0, spots_left 200, €500). Sort order correct (scheduled-first, start_at asc). |
| Step 0.5 regression-test gate satisfied? | Y | Implementor happy-path: 17 Deno SQL contract assertions + 4 Jest service tests + 14 Jest component tests, all PASS, fails-on-revert verified at HEAD~1 on all 3 tracks. Tester adversarial coverage is the NEXT phase (LF-1..LF-5 + 4 adversarial test files already shipped); tester's job is to write the SECOND adversarial test attacking a different angle than implementor's adversarial set. |

### Currency note

Mgmt API replay returned `currency='EUR'` for both trips (implementor's Jest fixtures had assumed GBP). This is correct: the field carries whatever `ticket_types.currency` holds for the lowest-priced paid tier — the implementation honors Constitution #10 (currency-aware) by passing the value through verbatim. No code change needed.

---

## 4. Implementor checklist items resolved

The two REVIEW pre-implement reminders (from `REVIEW_ORCH-0963_SPEC.md`) were both honored:

1. ✓ `ORCH_0963_BACKEND_ALLOWLIST` added to `orch-0863-marketing-hub-phase-b.mjs` (lines 813-823 + spread on line 877). ORCH-0863 gate passes locally with new files admitted.
2. ✓ Migration prefix grep performed. `20260728000000` is strictly greater than the prior highest (`20260727000003`). No sibling worktree under `~/Desktop/mingla-orchs/*/supabase/migrations/` was using `20260728*`. Two remote-only versions (`20260727000002` ORCH-0954 + `20260727000003` ORCH-0962) source-reconciled into branch byte-identical to the ORCH-0962 worktree's copies.

---

## 5. Discoveries from implementor noted

- **DISC-1:** source-reconciled migrations are byte-identical to upstream; 3-way merge collapses cleanly. No action needed.
- **DISC-2:** test pattern is source-grep (per repo convention) not RTL render. Tester's live-fire exercises actual rendered output.
- **DISC-3:** `routeForEventRow.ts` added to ORCH-0963 strict-grep allowlist alongside `businessEvents.ts` — both pre-existing files with ORCH-0859 markers.
- **DISC-4:** No new COMMS entries needed; cross-ORCH-0964 coordination already in COMMS-0005.

All P0/P1-clean. No discoveries that should block the next phase.

---

## 6. Verdict: **APPROVED**

Implementation matches SPEC contract exactly + RPC verified live on remote + all tests pass + fails-on-revert verified on 3 happy-path tracks + ORCH-0863 + ORCH-0963 strict-grep gates green + commit-hash on every file + dependency walk clean.

Next: dispatch Claude `mingla-tester` for LF-1..LF-5 live-fire on local Metro dev build + adversarial coverage (the tester's own adversarial test attacking a DIFFERENT angle than implementor's 4 adversarial files, per Step 0.5 gate).
