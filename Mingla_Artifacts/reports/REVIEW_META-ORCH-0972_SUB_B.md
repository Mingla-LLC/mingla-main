# REVIEW — META-ORCH-0972 Sub-B (Universal Creation + Hub Tabs)

**Reviewer:** Claude `mingla-orchestrator`
**Mode:** REVIEW (post-implementation, pre-tester)
**Date:** 2026-05-25
**Working tree:** `~/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]/`
**Branch:** `meta-orch-0972-brand-kind-decommission-universal-features`
**Reviewed commit:** `3414ea6b8` (amend of `6633be066` — only 8 lines of test/report annotation polish between them; no implementation delta)

---

## Verdict

**APPROVED — proceed to Claude `mingla-tester` TARGETED with Phase 0.A live-fire sim gate (iOS sim + Android emu + web preview) before Sub-C dispatch.**

Confidence: HIGH. Diff (29 files, +2,061 / -1,273) matches the locked implementor prompt and SPEC §Sub-spec B; hard guards held; mandatory tests pass at HEAD; Brand.kind preserved with `@deprecated` marker; three persona files deleted as planned; copy-inventory verbatim.

---

## Commit-hash verification (MANDATORY — codified DEC-179 / ORCH-0959)

All 14 sampled claimed-changed files resolve to a single commit `3414ea6b8` on `meta-orch-0972-brand-kind-decommission-universal-features`. No file is modified-but-uncommitted.

| File | Commit |
|---|---|
| `mingla-business/src/components/brand/BrandCreationFlow.tsx` | `3414ea6b8` |
| `mingla-business/src/components/brand/OfferingChooser.tsx` | `3414ea6b8` |
| `mingla-business/src/hooks/useHubTabs.ts` | `3414ea6b8` |
| `mingla-business/src/hooks/useBrandOfferingCounts.ts` | `3414ea6b8` |
| `mingla-business/app/experience/create.tsx` | `3414ea6b8` |
| `mingla-business/app/(tabs)/hub/getstarted.tsx` | `3414ea6b8` |
| `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` | `3414ea6b8` |
| `mingla-business/__tests__/hooks/useHubVisibleTabs.test.tsx` | `3414ea6b8` |
| `mingla-business/__tests__/components/BrandCreationFlow.test.tsx` | `3414ea6b8` |
| `mingla-business/src/types/brand.ts` | `3414ea6b8` |
| `mingla-business/src/services/venueClaimBannerLogic.ts` | `3414ea6b8` |
| `mingla-business/src/services/__tests__/venueClaimService.test.ts` | `3414ea6b8` |
| `mingla-admin/src/pages/ClaimsPage.jsx` | `3414ea6b8` |
| `mingla-admin/src/services/adminClaimsService.js` | `3414ea6b8` |

**Persona deletions confirmed:** `PersonaPickerCards.tsx`, `PersonaForkSheet.tsx`, `TripBrandWizard.tsx` are absent on filesystem and absent in `HEAD`.

**Working tree clean (Sub-B scope):** the only untracked file is the preserved `CODEX_RE_REVIEW_META-ORCH-0972_AUDIT.md` (Phase 1 audit artifact, intentionally not part of Sub-B and not part of the Sub-B PR).

---

## Dependency walk (MANDATORY — codified DEC-179 / ORCH-0959)

`git diff --name-only HEAD~1..HEAD` shows ZERO touches to any config-layer file:
- No `app.json` / `app.config.ts` / `vercel.json` / `package.json`
- No `tsconfig*.json` / `metro.config.*` / `babel.config.*` / `next.config.*`
- No `.github/workflows/**` / `.github/scripts/**`

**Dependency walk N/A — no config-layer changes.**

The sole new AsyncStorage key (`@mingla/hub/lastTab`) is namespaced and added inside `useHubTabs.ts`; not a config-layer change. The sole new React Query key (`brandKeys.offeringCounts(brandId)`) is added inside `useBrandOfferingCounts.ts` and follows the existing key-factory discipline.

---

## Hard-guard verification

| Guard | Status | Evidence |
|---|---|---|
| Zero DB / migrations | HELD | No `supabase/migrations/**` in diff. |
| Zero edge functions | HELD | No `supabase/functions/**` in diff. |
| No `PublicBrandPage.tsx` | HELD | Not in diff. |
| No `publicEventsService.ts` | HELD | Not in diff. |
| No `ExperienceMiniCard` | HELD | Not in diff. |
| No `useUpcomingFeed` | HELD | Not in diff. |
| No `meta-orch-0972-*` strict-grep script | HELD | No `.github/scripts/strict-grep/meta-orch-0972-*` in diff (deferred to Sub-C/D). |
| `Brand.kind` preserved | HELD | `mingla-business/src/types/brand.ts:182-183` retains the field with `@deprecated META-ORCH-0972 — kind is removed from DB in Sub-C; this field will be deleted next.` |
| No live `brand.kind` / `currentBrand.kind` references in touched files | HELD | grep on the 26-file business+admin diff returns empty. |

---

## Mandatory regression-test gate (Step 0.5 — implementor side only at this phase)

| Test path | Suite count | Result at HEAD | Fails-on-revert annotation |
|---|---|---|---|
| `mingla-business/__tests__/hooks/useHubVisibleTabs.test.tsx` | 4 tests (SC-B-13 ×3 + SC-B-6 ×1) | PASS | `// fails-on-revert verified at 6633be066` |
| `mingla-business/__tests__/components/BrandCreationFlow.test.tsx` | 3 tests (SC-B-1 + SC-B-2 + SC-B-5) | PASS | `// fails-on-revert verified at 6633be066` |

**Live re-run at HEAD:** `npx jest --runInBand __tests__/hooks/useHubVisibleTabs.test.tsx __tests__/components/BrandCreationFlow.test.tsx` → 2 suites, 7 tests, all PASS, 1.817s.

**Fails-on-revert lineage note (non-blocking):** the cited hash `6633be066` is the pre-amend HEAD@{1} of the same logical commit (subsequently amended to `3414ea6b8`). The amend touched only 8 lines across the implementation report and the two test-file annotation comments — zero implementation delta. The fails-on-revert claim is therefore still materially verifiable at HEAD by reverting the implementation files. **Tester must independently re-verify fails-on-revert as part of Phase 0.A live-fire and confirm the implementor's claim before CLOSE.**

**Step 0.5 adversarial half:** NOT YET satisfied. Tester-written adversarial regression test is required AT CLOSE (gate fires at CLOSE, not at REVIEW). Routing into tester TARGETED below explicitly assigns this deliverable. The adversarial test must attack a different angle than the implementor's happy-path tests — recommended angles: (a) stale `@mingla/hub/lastTab` value pointing at a removed tab when only `getstarted` is visible, (b) `OfferingChooser` route mapping under unexpected/null brand state, (c) `useBrandOfferingCounts` partial-failure (one of the 3 count queries fails) and hub tab visibility behavior, (d) BrandCreationFlow address-skip persistence as `null` (not empty string) when round-tripped to the brand service.

---

## Spec / SC traceability spot-check

| SC | Implemented at | Verified |
|---|---|---|
| SC-B-1 unified brand creation (one flow, no kind fork) | `BrandCreationFlow.tsx` (495 LOC new) replaces `PersonaForkSheet.tsx` + `TripBrandWizard.tsx` + `PersonaPickerCards.tsx` (all deleted). Locked copy preserved verbatim. | Test 1 (copy verbatim) |
| SC-B-2 optional/null address | `setAddress` action dispatches with `address: null` on skip; `BrandCreationFlow.tsx` source contract proves it. | Test 2 |
| SC-B-5 offering routes (event/trip/experience) | `routeForOffering` in `OfferingChooser.tsx:72-76` maps each offering to the right creator path. | Test 3 |
| SC-B-6 sticky valid hub tab + stale-fallback | `pickHubInitialTab` in `useHubTabs.ts` falls back to first-visible when stored tab not in current visible set. | Test 4 (`useHubVisibleTabs.test.tsx:41-45`) |
| SC-B-13 data-driven hub tabs (empty / single-bucket / all-buckets) | `deriveHubVisibleTabs` enforces fixed Events→Trips→Experiences order; empty returns `['getstarted']`. | Tests 1–3 (`useHubVisibleTabs.test.tsx:22-39`) |
| Venue claim kind-gate removed | `venueClaimBannerLogic.ts` is status-only; existing `venueClaimService.test.ts` updated in scope (legitimate — old test still encoded the removed gate). | `venueClaimService.test.ts` PASS |
| Admin Pending/Verified/Rejected tabs | `ClaimsPage.jsx` + `adminClaimsService.js` extended; admin Vite build PASS per implementor report §12. | Admin build pass |
| Brand.kind preserved in TS but deprecated | `brand.ts:182-183` `@deprecated META-ORCH-0972` JSDoc. | Direct read |

---

## Cross-ORCH / Comms-Ledger ack

Read on entry. No `BLOCK` rows. WARN entries scanned:

- **COMMS-0001** (→ ORCH-0955): N/A — not META-ORCH-0972 scope.
- **COMMS-0002** (ALL, ORCH-0863 backend strict-grep): N/A — Sub-B touches zero backend files. `git diff --name-only HEAD~1..HEAD | rg supabase/` returns empty.
- **COMMS-0003** (ALL, external-API docs gate): N/A — Sub-B touches zero external-API integrations.
- **COMMS-0004** (ALL, INTAKE collision-scan SOP): N/A — REVIEW phase, no new ORCH-ID assigned.
- **COMMS-0005** (→ ORCH-0964): N/A — Sub-B does not touch `PublicBrandPage.tsx` or `publicEventsService.ts`.

Orchestrator will append `mingla-orchestrator+claude (META-ORCH-0972 Sub-B REVIEW)` to COMMS-0002/0003/0004 `acked_by` lists in the same turn.

---

## Risks / transition items carried into Sub-C

| Item | Severity | Sub-C owner action |
|---|---|---|
| `useBrandOfferingCounts` runs 3 direct `events` count queries per brand instead of `pg_brand_offering_counts` RPC | Low (perf only; RPC absent until Sub-C) | Sub-C ships RPC; hook query-key contract already shaped for drop-in swap. |
| Experience rows ride on `events.event_type = "experience"` + additive `theme.experience_meta` JSON | Acceptable transitional | Sub-C formalizes public read path + RPC. |
| Repo-wide `tsc --noEmit` red (pre-existing, not Sub-B) | Background | Separate cleanup / orchestrator-owned tsc gate decision. |
| No implementor live-fire sim/web | Expected | **Tester TARGETED Phase 0.A is the gate (below).** |
| `Brand.kind` TS field still present | Intentional transitional | Sub-C DB DROP COLUMN + Sub-D TS field removal (per SPEC). |

---

## Routing

Forward → Claude `mingla-tester` TARGETED, Phase 0.A live-fire sim gate, all 3 surfaces (iOS sim + Android emu + web preview). Adversarial regression test is part of the dispatch deliverable.

**No NEEDS WORK, no REJECTED items.** Sub-C dispatch is BLOCKED on tester PASS at Phase 0.A.
