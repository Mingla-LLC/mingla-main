# Implementation Report: Brand Field Render Truthful Bundle (ORCH-0962)

> Date: 2026-05-25
> Mode: Spec Execute
> Spec: Mingla_Artifacts/specs/SPEC_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md
> Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0962_BRAND_EDIT_PUBLIC_RENDER_AUDIT.md
> Status: implemented and verified
> Implementation commit: 52e37c2bc

## 1. Layman Summary

Public brand pages now show the brand fields operators already entered: contact email/phone, distinct tagline plus bio, Facebook and LinkedIn links, truthful physical-brand identity inside event detail, and verified-venue attendee-count settings in the mapper. No editor UI, edge function, or visual redesign was added.

## 2. Request And Context

- **Request:** Implement ORCH-0962 G-01, G-02, G-03, G-08, and G-09 only.
- **Source:** User dispatch with SPEC plus required investigation pre-read.
- **Affected surfaces:** Buyer-web `/b/{brandSlug}`, buyer-web `/e/{brandSlug}/{eventSlug}`, and consumer event sheet through shared `PublicEventPage` mapping.
- **Related artifacts:** SPEC_ORCH-0962, INVESTIGATION_ORCH-0962, commit `52e37c2bc`.

## 3. Scope

- **In scope:** One ORCH-0962 migration, public event/brand mapper updates, `PublicBrandPage` rendering updates, strict-grep gate, and 9 happy-path tests.
- **Out of scope:** Hours editor, custom links editor/renderer, phoneCountryIso persistence, attendee-count UI consumer, edge functions.
- **Assumptions:** Exposing contact email/phone publicly is approved by SPEC; no live dependent views block drop/recreate.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry read | COMMS-0002/0003/0004 WARN entries acknowledged/factored. |
| `SPEC_ORCH-0962_BRAND_FIELD_RENDER_TRUTHFUL_BUNDLE.md` | Contract | Five gaps only; no scope widening. |
| `INVESTIGATION_ORCH-0962_BRAND_EDIT_PUBLIC_RENDER_AUDIT.md` | Evidence | Source/view/mapper roots confirmed. |
| `publicEventsService.ts` | Mapper owner | Fabricated brand fields and missing contact/split logic. |
| `PublicBrandPage.tsx` | Render owner | Tagline fallback-only and missing social platforms. |
| `Icon.tsx` | Icon pre-flight | `facebook` and `linkedin` already in `IconName` and registry. |
| `strict-grep-mingla-business.yml` | CI registry | New gate wired as standalone job. |

## 5. Blast Radius

- **Direct changes:** Public view schemas, public mappers, public brand page social/tagline rendering.
- **Cascade changes:** Event detail brand context now receives true `kind`, `address`, and `coverMediaUrl`.
- **Parity surfaces:** Buyer web and consumer event sheet share the fixed mapper path for event-detail brand context.
- **Cache impact:** No query keys or invalidation behavior changed; existing public queries will receive wider row shapes after migration.
- **State boundaries:** React Query/server state ownership unchanged; no Zustand/AsyncStorage writes.
- **Auth/RLS/security:** No new policies. Supabase MCP `list_tables` surfaced pre-existing RLS-disabled advisory for unrelated backup/archive/system tables; not changed here.
- **Deploy path:** Operator applies DB migration only; no edge deploy.

## 6. Old To New Receipts

### `supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql`

- **Before:** Public brand/venue views dropped contact fields; event view dropped brand kind/address/cover.
- **After:** Views include the specified columns. Views are dropped/recreated in one transaction because Postgres cannot insert columns mid-view with `CREATE OR REPLACE VIEW`.
- **Why:** Restore public read truth while preserving SPEC column order.
- **Approx lines changed:** New 163-line migration.

### `supabase/migrations/20260727000002_orch_0954_controller_dashboard_type_check.sql`

- **Before:** Remote had this migration applied but this worktree lacked the local file.
- **After:** Exact source-reconciled file copied from ORCH-0954 worktree; SHA-256 `7aac0267ef163d914daf8bf9ba444bed25cbc01371ea7395958f2ac5c7cfb15c`.
- **Why:** Required migration backstop; `migration list --linked` must not show blank Local / populated Remote before handoff.
- **Approx lines changed:** 27-line already-applied reconciliation file.

### `mingla-business/src/services/publicEventsService.ts`

- **Before:** Contact never mapped, descriptions never split, event-detail brand context fabricated kind/address/cover, verified-venue `displayAttendeeCount` hardcoded false.
- **After:** `splitBrandDescription`, `extractBrandContact`, true event brand fields, and row-backed venue attendee setting.
- **Why:** Fix G-01/G-02/G-08/G-09.
- **Approx lines changed:** 159-line diff.

### `mingla-business/src/components/brand/PublicBrandPage.tsx`

- **Before:** Tagline rendered only when bio was empty; Facebook/LinkedIn omitted from social row.
- **After:** Tagline and bio render as separate centered text nodes; Facebook and LinkedIn social entries render with existing icons.
- **Why:** Fix G-02/G-03 without layout redesign.
- **Approx lines changed:** 36-line diff.

### Tests and strict grep

- **Before:** Old public-brand migration test protected contact exclusion; no ORCH-0962 regression tests/gate.
- **After:** 9 happy-path tests, old test rewritten for the new contract, and strict-grep gate added.
- **Why:** Keep behavior from regressing and encode field-map coverage.

## 7. Implementation Details

- **Architecture decisions:** Mapper owns read-shape repair; component only renders now-populated fields.
- **Data flow:** Edit Brand persists into `brands`; public views expose fields; `publicEventsService` maps into `Brand`; `PublicBrandPage` renders existing contact/about/social blocks.
- **Mutation/query behavior:** No mutation changes.
- **State handling:** No persisted client state changes.
- **Error handling:** Existing Supabase error propagation unchanged.
- **Copy/accessibility:** Existing social link accessibility labels used; no new visible explanatory copy.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| SC-01 contact renders | View + mapper now expose contact | T-02; existing AboutTab guard lights up | Pass |
| SC-02 empty contact hidden | Empty contact maps undefined | T-03 | Pass |
| SC-03 both tagline and bio distinct | Split mapper + two Text nodes | T-01, T-09 | Pass |
| SC-04 tagline-only | Split helper preserved | Covered by `splitBrandDescription` path | Pass |
| SC-05 bio-only | Split helper preserved | Existing helper behavior unchanged | Pass |
| SC-06 Facebook icon | SocialLinksRow entry added | T-07 | Pass |
| SC-07 LinkedIn icon | SocialLinksRow entry added | T-08 | Pass |
| SC-08 event brand true kind/address/cover | View + mapper fields added | T-05, T-06 | Pass |
| SC-09 venue displayAttendeeCount truth | View + mapper field added | T-04 | Pass |
| SC-10 parity | Shared service changed once | Grep + tests | Pass |
| SC-11 idempotency | Transactional drop/recreate | SQL shape reviewed; no dependents found | Pass |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| I-17 brand slug immutability | Yes | Yes | No slug write path touched. |
| I-PROPOSED-TR1-KIND-IMMUTABLE | Yes | Yes | No editor kind behavior touched; public mapper now reads `trip_planner` truthfully. |
| Constitution #9 no fabricated data | Yes | Restored | Event brand kind/address/cover and venue attendee setting now DB-backed. |
| I-PROPOSED-BRAND-FIELD-MAP-COVERAGE | Yes | Added | Strict-grep job/script shipped. |
| I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED | No | N/A | No external API calls. |

## 10. Parity Check

- **Mobile:** Consumer standalone brand profile remains out of scope; consumer event sheet benefits through shared event-detail mapper.
- **Business app:** Buyer/public shared code updated; Brand Edit write surface untouched.
- **Admin:** No admin changes.
- **Public/web:** `/b/` and `/e/` paths updated after migration.
- **Solo/collab:** Not relevant.
- **Gaps:** G-04/G-05/G-06/G-07 remain split-out ORCHs per SPEC.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** Public view rows gain columns; TypeScript interfaces updated.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Existing public fetches receive richer rows after migration; no client migration needed.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Comms ledger read | `sed -n '1,220p' COMMS_LEDGER.md` | Pass | COMMS-0002/0003/0004 acknowledged. |
| Event view pre-flight | `SELECT pg_get_viewdef('public.business_public_events_view'::regclass, true)` | Pass | Live definition captured before migration. |
| Safety probe | `SELECT COUNT(*) FROM brands WHERE contact_email IS NOT NULL OR contact_phone IS NOT NULL` | Pass | Returned 11. |
| Dependency probe | `pg_depend` read-only query for target views | Pass | 0 dependent rewrite rows for all three views. |
| Icon pre-flight | `rg "type IconName|facebook|linkedin" mingla-business/src` | Pass | Icon union and registry already include both. |
| Migration chain | `/Users/sethogieva/bin/supabase migration list --linked` | Pass | No remote-only rows after ORCH-0954 source reconcile; ORCH-0962 shows Local-only pending. |
| Strict grep | `node .github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` | Pass | `PASS [ORCH-0962 brand field map coverage]`. |
| 9 happy-path tests | `npx jest src/services/__tests__/publicEventsService.orch_0962.test.ts src/components/brand/__tests__/PublicBrandPage.orch_0962.test.ts --runInBand` | Pass | 9/9 passed at `52e37c2bc`. |
| Existing service regression | `npx jest src/services/__tests__/publicEventsService.test.ts --runInBand` | Pass | 9/9 passed. |
| Diff hygiene | `git diff --check` | Pass | No whitespace errors. |
| Typecheck | `npm run typecheck` | Fail, unrelated baseline | Fails on pre-existing checkout/playwright/packages/native type errors; no ORCH-0962 file errors surfaced in targeted Jest compile. |
| Fails-on-revert | Reverse-applied service+component patch from `52e37c2bc`, reran 9 tests, restored patch | Pass | All 9 tests failed on revert, then passed after restore. |

### Fails-On-Revert Lines

- T-01 `publicBrandViewRowToBrand splits tagline+bio`: fails-on-revert verified at `52e37c2bc`.
- T-02 `publicBrandViewRowToBrand produces contact`: fails-on-revert verified at `52e37c2bc`.
- T-03 `publicBrandViewRowToBrand empty contact contract`: fails-on-revert verified at `52e37c2bc`.
- T-04 `claimedVenueRowToBrand reads displayAttendeeCount`: fails-on-revert verified at `52e37c2bc`.
- T-05 `viewRowToBrand reads brand_kind/address`: fails-on-revert verified at `52e37c2bc`.
- T-06 `viewRowToBrand reads brand_cover_media_url`: fails-on-revert verified at `52e37c2bc`.
- T-07 `SocialLinksRow renders facebook`: fails-on-revert verified at `52e37c2bc`.
- T-08 `SocialLinksRow renders linkedin`: fails-on-revert verified at `52e37c2bc`.
- T-09 `PublicBrandPage renders tagline + bio distinctly`: fails-on-revert verified at `52e37c2bc`.

## 13. Regression Surface

1. Public brand page About tab contact block now becomes visible for brands with stored contact values.
2. Public event detail brand context now can render physical/trip planner identity instead of forced popup.
3. Migration drop/recreate preserves grants/comments but should be applied during normal operator migration window.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Public contact exposure | Bare email/phone visible to anonymous viewers | Separate contact-form/spam-protection ORCH if needed | Product follow-up |
| Remaining field gaps | G-04/G-05/G-06/G-07 still split out | Dedicated ORCHs | SPEC §1.3 |
| Typecheck baseline | Full `npm run typecheck` currently fails unrelated files | Separate cleanup ORCH | Verification log |
| Source-reconciled ORCH-0954 migration | Branch includes already-applied migration missing from main/worktree | ORCH-0954 promotion or main reconciliation | `20260727000002_*` |

## 15. Discoveries For Orchestrator

- Supabase MCP advisory reports RLS disabled on unrelated backup/archive/system tables. This is pre-existing and out of ORCH-0962 scope but should stay visible to orchestrator/security review.
- Remote migration `20260727000002` was already applied but absent locally; ORCH-0962 includes exact source reconciliation so operator migration apply does not hit a remote-only row.

## 16. Deploy Notes

- **Migrations:** Operator only. Run exactly:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]" && /Users/sethogieva/bin/supabase db push --linked
```

- **Edge functions:** None.
- **Mobile OTA/native:** None.
- **Business/admin web:** No manual build required for this report; tester should run targeted public-page QA after DB apply.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
ORCH-0962: render truthful public brand fields

Resolves: ORCH-0962
Evidence: ORCH-0962 happy-path Jest tests, strict-grep gate, migration list, fails-on-revert at 52e37c2bc
Deploy: operator applies supabase db push --linked from ORCH-0962 worktree
```

## Ready-To-Test Checklist

1. Apply migration with the command in Deploy Notes.
2. Open `/b/{brandSlug}` for a brand with contact values and confirm About shows email/phone.
3. Open `/b/{brandSlug}` for a brand with tagline plus bio and confirm two distinct lines render above socials.
4. Add Facebook/LinkedIn URLs to a brand and confirm both icons appear in compact row and About row.
5. Open an event under a physical brand and confirm event-detail brand context uses true kind/address/cover.
