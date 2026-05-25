# REVIEW — ORCH-0962 [Brand-edit → public-brand field rendering — truthful bundle]

**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode).
**Reviewed at:** 2026-05-25.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/` on branch `ORCH-0962-brand-edit-public-render-audit`.
**Implementation commit:** `52e37c2bc` (code + tests + migration + strict-grep gate). Report commit: `814bad30e`.
**Inputs reviewed:**
- `Mingla_Artifacts/specs/SPEC_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0962_BRAND_EDIT_PUBLIC_RENDER_AUDIT.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md`

---

## Verdict: APPROVED

Five render-truth gaps land cleanly with zero scope widening. Implementation matches SPEC §3.1–§3.3 layer-for-layer, regression-test discipline is exhaustive (9 happy-path tests with `fails-on-revert verified at 52e37c2bc` cited individually for T-01 through T-09), the strict-grep CI gate (`I-PROPOSED-BRAND-FIELD-MAP-COVERAGE`) ships with the same change so the bug class can't silently recur, Constitution #9 (no fabricated data) is restored for G-08 + G-09, and the migration handles view dependency ordering with a transactional drop/recreate after a `pg_depend` probe confirmed zero dependent rewrite rules. Ready to apply migration, then dispatch tester for A-01..A-05 adversarial regression + spec-compliance verification.

One noted-not-blocker: pre-existing typecheck baseline failures on unrelated `checkout/playwright/packages/native` files — implementor confirmed no ORCH-0962 file errors surfaced; baseline cleanup is a separate ORCH if Seth wants it. Acceptable.

## Commit-hash verification (mandatory per DEC-179)

| Claimed-changed file | Commit | Status |
|---|---|---|
| `mingla-business/src/services/publicEventsService.ts` | `52e37c2bc` | ✅ on branch |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | `52e37c2bc` | ✅ on branch |
| `mingla-business/src/services/__tests__/publicEventsService.orch_0962.test.ts` | `52e37c2bc` | ✅ on branch (new file) |
| `mingla-business/src/services/__tests__/publicEventsService.test.ts` | `52e37c2bc` | ✅ on branch (rewritten for new contract) |
| `mingla-business/src/components/brand/__tests__/PublicBrandPage.orch_0962.test.ts` | `52e37c2bc` | ✅ on branch (new file) |
| `supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql` | `52e37c2bc` | ✅ on branch (new migration) |
| `supabase/migrations/20260727000002_orch_0954_controller_dashboard_type_check.sql` | `52e37c2bc` | ✅ on branch (source-reconciled per hard guard) |
| `.github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` | `52e37c2bc` | ✅ on branch (new file) |
| `.github/workflows/strict-grep-mingla-business.yml` | `52e37c2bc` | ✅ on branch |
| `Mingla_Artifacts/specs/SPEC_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md` | `c84f302f0` | ✅ on branch |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0962_BRAND_EDIT_PUBLIC_RENDER_AUDIT.md` | `8fdc8a4d0` | ✅ on branch |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md` | `814bad30e` | ✅ on branch |

`git status --short` clean. `git diff --stat main...HEAD` = 12 files / 1840 insertions / 78 deletions — matches implementor's blast-radius claim exactly.

## Dependency walk for config-layer changes (mandatory per DEC-179)

Two config-layer files touched: `.github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` (new), `.github/workflows/strict-grep-mingla-business.yml` (modified +12 lines).

**Consumer 1 — GitHub Actions strict-grep workflow.** The workflow adds one new job `orch-0962-brand-field-map-coverage` as a sibling of the existing ~60 ORCH gates. Job uses the canonical pattern (checkout@v4 + setup-node@v4 + single `node ...mjs` invocation), matching the registry pattern memory rule `feedback_strict_grep_registry_pattern.md`. Header comment registry block updated with one new bullet for `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE`. No existing job touched, no existing trigger condition modified. Compatibility: ✅ compatible.

**Consumer 2 — strict-grep gate logic.** The new `.mjs` script imports `node:fs` + `node:path` + `node:url` (Node 20 built-ins per the workflow's `node-version: "20"`), reads 4 source files via fs.readFileSync, runs string + regex assertions, exits non-zero on failure. No external dependencies, no network calls. Logic is hermetic: encodes G-01 (contact fields editor↔view↔mapper coverage), G-02 (split + tagline/bio render slots), G-03 (facebook + linkedin editor↔public-page coverage), G-08 (event-detail brand_kind/address/cover_media_url plumbed), G-09 (venue mapper reads row.display_attendee_count). Failure mode: a future edit that removes any of these plumbing points fails CI with a labelled bullet list. Compatibility: ✅ compatible.

No other config-layer files (no `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `expo.json`, `metro.config.*`, `babel.config.*`, `next.config.*`) touched.

## SPEC compliance gate-by-gate

| Gate | SPEC reference | Implementation evidence | Verdict |
|---|---|---|---|
| Scope discipline (5 gaps only) | §1.1 | Diff scope = SPEC §1.1 verbatim; no widening into G-04/05/06/07 | ✅ PASS |
| Non-goals respected | §1.2 | No redesign, no new editor, no consumer-app surface, no PII layer, no `/b/` route in app-mobile | ✅ PASS |
| Cross-Surface Impact declaration | §2 | All 7 surfaces declared. Buyer-web primary; consumer event sheet automatic via shared `PublicEventPage`; consumer-app standalone surface explicitly deferred to ORCH-0964 | ✅ PASS |
| Migration safety (CREATE OR REPLACE pattern) | §3.1 | Implementor deviated from `CREATE OR REPLACE VIEW` to transactional `DROP VIEW IF EXISTS` + `CREATE VIEW` for the three views; rationale documented (Postgres can't insert columns mid-SELECT-list in REPLACE mode). Justified because `pg_depend` probe returned 0 dependent rewrite rows. Migration wraps in BEGIN/COMMIT. Permissions preserved via view recreate (security_invoker=true preserved on `claimed_venues_public_view`). | ✅ PASS — deviation accepted, technically sounder than the literal SPEC text |
| Service mapper additions (`extractBrandContact`, `splitBrandDescription` import) | §3.2.4–§3.2.7 | All 3 mappers updated; helper imported from `brandMapping` per SPEC | ✅ PASS |
| Component layer (facebook + linkedin entries, tagline+bio hierarchy, `taglineCentered` style) | §3.3.1–§3.3.2 | 36-line diff lands cleanly; both icons present in entries array; new style added | ✅ PASS |
| AboutTab contact block (no code change required) | §3.3.4 | Confirmed — existing guard at PublicBrandPage.tsx:574-577 now lights up because mapper produces non-undefined contact | ✅ PASS |
| Success criteria SC-01..SC-11 | §4 | All 11 cited in implementor traceability matrix with test refs | ✅ PASS |
| Invariants preserved/restored | §5 | I-17 preserved; I-PROPOSED-TR1-KIND-IMMUTABLE preserved (trip_planner now reads truthfully); Constitution #9 restored (G-08+G-09); new I-PROPOSED-BRAND-FIELD-MAP-COVERAGE gate ACTIVE on CLOSE | ✅ PASS |
| Step 0.5(a) implementor regression tests | §6 + §7 | 9 happy-path tests at real paths; `fails-on-revert verified at 52e37c2bc` cited for each (T-01 through T-09 in §12 + §"Fails-On-Revert Lines") | ✅ PASS |
| Step 0.5(b) tester adversarial tests | §6 A-01..A-05 | PENDING — next phase (tester dispatch) | ⏸ ROUTED |
| Migration backstop (apply command included) | n/a (orchestrator backstop) | Implementor included exact copy-paste command in §16 deploy notes per memory rule `feedback_migration_apply_backstop` | ✅ PASS |
| Migration chain integrity (`migration list --linked`) | n/a | Verified live: remote ends at `20260727000002`; local has `20260727000003` Local-only pending; no remote-only rows | ✅ PASS |
| Migration filename uniqueness across active worktrees | n/a (orchestrator backstop) | `20260727000003` claimed only by ORCH-0962; no collision with ORCH-0961/0963/0964/0965/0954 | ✅ PASS |
| Invariant migration backstop (read-only data probe) | n/a (orchestrator backstop) | Implementor §12 line 144 ran `SELECT COUNT(*) FROM brands WHERE contact_email IS NOT NULL OR contact_phone IS NOT NULL` → returned 11. No `RAISE EXCEPTION` guards in migration; transactional drop/recreate is safe per `pg_depend` probe. | ✅ PASS |

## Hard-guard compliance (per dispatch)

| Hard guard | Compliance evidence |
|---|---|
| Do not widen beyond G-01/G-02/G-03/G-08/G-09 | Diff scope ⊆ SPEC §1.1; split-out gaps (G-04/05/06/07) registered as separate ORCH-0966/0967/0968/0969; no incidental refactors | ✅ |
| Do not apply migrations from MCP | Implementor §16: `Operator only. Run exactly: <cd worktree && supabase db push --linked>`. No MCP `apply_migration` calls in branch | ✅ |
| Preserve ORCH-0954 source-reconciled migration (remote already has 20260727000002 applied) | `20260727000002_orch_0954_controller_dashboard_type_check.sql` present in branch, SHA-256 source-match confirmed in implementor §6 line 61, migration chain probe confirms remote has 20260727000002 applied without a remote-only row | ✅ |

## Comms ledger acknowledgements

- **COMMS-0001** (Stripe Tax → ORCH-0955): N/A — no Stripe surfaces touched.
- **COMMS-0002** (ORCH-0863 strict-grep blocking backend PRs): no new files under `supabase/functions/` so the C7 `no-new-backend-files` gate is not in scope. Migration files are exempt from C7. ack appended.
- **COMMS-0003** (External-API docs verification): N/A for product behavior — no external API integration. Memory rule [[external-api-docs-verified]] not triggered. ack appended.
- **COMMS-0004** (INTAKE must scan for REGISTERED-but-not-spawned IDs): ack appended; relevant for future INTAKEs not this REVIEW.

## Constitutional + invariant cross-check

| Rule | Relevant | Result |
|---|---|---|
| Constitution #1 (no dead taps) | Yes | facebook/linkedin icons now have working press handlers via existing `onSocialPress` callback — ✅ |
| Constitution #2 (one owner per truth) | Yes | Mapper is sole owner of UI Brand shape; no duplicate state — ✅ |
| Constitution #3 (no silent failures) | Yes | G-01 was a silent-failure pattern (save succeeded, render didn't); now restored — ✅ |
| Constitution #5 (server state via React Query) | Yes | All reads still flow through `usePublicBrandBySlug`/`usePublicEventBySlug` — ✅ |
| Constitution #9 (no fabricated data) | Yes | RESTORED — G-08 ends `kind:"popup"/address:null` hardcodes; G-09 ends `displayAttendeeCount:false` hardcode — ✅ |
| I-17 brand slug immutability | Yes | No slug write path touched — ✅ |
| I-PROPOSED-TR1-KIND-IMMUTABLE (ORCH-0855) | Yes | Mapper now reads `trip_planner` truthfully when present; BrandEditView kind toggle still gated unchanged — ✅ |
| I-PROPOSED-J Zustand-persist-no-server-snapshots | No | No Zustand touched |
| I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (COMMS-0003) | No | No external API integration |
| I-PROPOSED-BRAND-FIELD-MAP-COVERAGE (NEW) | Yes | Strict-grep gate landed at `.github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs`; ACTIVE on CLOSE — ✅ |

## Operator-decision callout for migration-apply moment

Implementor §12 line 144 reports `SELECT COUNT(*) FROM brands WHERE contact_email IS NOT NULL OR contact_phone IS NOT NULL = 11`. **The moment Seth runs `supabase db push --linked`, those 11 brands' contact email/phone become publicly visible at `/b/{brandSlug}`.** This was approved in SPEC §1.4 assumption ("exposing contact email/phone to anonymous web viewers is acceptable for this fix; spam-protection layer can come later via separate ORCH"). No action required, but flagging the moment of consequence at push-time so Seth pushes with eyes open.

## Discoveries for orchestrator (forwarded from implementor §15)

- **D-1 (supabase advisory — RLS disabled on unrelated backup/archive/system tables):** pre-existing, out of ORCH-0962 scope. Forward to security review as a standing item; do not block this CLOSE.
- **D-2 (ORCH-0954 source reconciliation):** noted and approved per dispatch hard guard. The reconciled migration file ships in ORCH-0962's PR; future ORCH-0954 promotion or main-side reconciliation can drop the local file if remote+main converge.

## Routing — next phases

1. **Operator applies migration** (no MCP, exact command in §16 of implementation report and repeated in handoff below).
2. **Tester dispatch** — Claude `mingla-tester` (canonical TEST owner per `feedback_tester_canonical_and_platform_parity.md`): A-01..A-05 adversarial regression per SPEC §6 + full SC-01..SC-11 spec-compliance verification on buyer-web Chromium with at least one real test brand seeded with the gap-exercising fixture (contact info populated, tagline+bio populated, facebook+linkedin URLs populated, physical-kind brand with non-empty address, verified-venue with `display_attendee_count` flipped from default).
3. **CLOSE** — after tester PASS or CONDITIONAL-PASS-with-accepted-conditions: full standard CLOSE protocol (artifact updates × 7 docs, Step 1.5 DIAG marker reap, Step 2 commit message with `[deploy]` tag since `mingla-business/src/` was touched, Step 3 EAS OTA not applicable (no app-mobile changes), Step 1.7 worktree reap).
