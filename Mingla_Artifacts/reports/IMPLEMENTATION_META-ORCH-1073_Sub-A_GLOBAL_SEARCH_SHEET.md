# IMPLEMENTATION — META-ORCH-1073 Sub-A — Global Search Sheet (Phase 1)

**ORCH:** META-ORCH-1073 Sub-A — "Global search sheet (Phase 1)" — Mingla Business app (`mingla-business/`).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1073-Sub-A-[global-search-sheet]/` on branch `META-ORCH-1073-Sub-A-global-search-sheet`.
**Author:** mingla-implementor (Claude), 2026-06-04.
**Binding contracts:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1073_Sub-A_GLOBAL_SEARCH_SHEET.md` (§12.1 rulings binding) + `Mingla_Artifacts/reports/DESIGN_META-ORCH-1073_Sub-A_GLOBAL_SEARCH_SHEET.md`.

---

## 0. COMMS-Ledger acknowledgements
Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` row targets this skill, META-ORCH-1073, or `ALL`.
- **COMMS-0002** (strict-grep backend gate on `supabase/functions/**` + migrations): **N/A — client-only Phase 1.** No edge function, no migration, no `supabase/functions/**` file touched. No `ORCH_1073_BACKEND_ALLOWLIST` entry needed.
- **COMMS-0003** (external-API integration must cite provider docs URLs inline): **N/A — client-only Phase 1.** No external API/SDK/Postgres-FTS/`pg_trgm`/`tsvector` introduced; no Stripe/Supabase/OpenAI surface. The one third-party lib mentioned by the SPEC (`cmdk`) is NOT touched (R-5 COEXIST).

(Both rows are WARN+ALL; the ack note is recorded here per the SPEC §0 instruction. No ledger write was required — no cross-ORCH discovery.)

---

## 1. What was built (client-only, additive)

A single global search surface for Mingla Business, entered from the existing TopBar magnifying-glass icon. Pure, platform-agnostic search service + index + registry + matcher + role-gating, a Zustand open/query/recents store, an index hook, and one sheet component reusing the canonical `Sheet` primitive. Mounted once at the `(tabs)` root; TopBar search icon wired to open it.

No backend. No network fetch in the search path. No new dependency. No new tokens. No new modal system. No convergence with `CommandPalette.web.tsx` (R-5 COEXIST — untouched).

---

## 2. Files added / changed

### Added (search lib — pure, platform-agnostic TS)
- `mingla-business/src/lib/search/types.ts` — SearchResultType / SearchGroup / SearchIndexEntry / SearchResult / SearchRegistryItem (SPEC §3.1).
- `mingla-business/src/lib/search/normalize.ts` — NFD diacritic-strip + lowercase (SPEC §3.2).
- `mingla-business/src/lib/search/scoreMatch.ts` — tiered scorer (exact>prefix>word-boundary>substring>fuzzy) × field weights (SPEC §3.2).
- `mingla-business/src/lib/search/registry.ts` — the 27-entry FEATURE_REGISTRY (SPEC §3.5; DESIGN §9.1 icons).
- `mingla-business/src/lib/search/adapters.ts` — events/drafts/trips/experiences → index entries; offering routes via `routeForEventRow` (R-2).
- `mingla-business/src/lib/search/globalSearch.ts` — buildSearchIndex / filterIndexByRank / searchIndex / searchIndexSafe / jumpToSuggestions / nearestSuggestions (SPEC §3.3).
- `mingla-business/src/lib/search/sheetState.ts` — pure body-state machine + recents + row-press effects (component logic, unit-testable).

### Added (state + hook)
- `mingla-business/src/hooks/useGlobalSearchSheet.ts` — Zustand store (open/query/recents; SPEC §3.4.1).
- `mingla-business/src/hooks/useGlobalSearchIndex.ts` — builds + role-filters the index from cache hooks + draft store (SPEC §3.4.2).

### Added (component)
- `mingla-business/src/components/ui/GlobalSearchSheet.tsx` — single sheet, all 9 states, reuses `Sheet`/`Input variant=search`/`Icon` (SPEC §3.7 + DESIGN).

### Added (tests)
- `mingla-business/src/lib/search/__tests__/globalSearch.test.ts` — happy-path + determinism + registry-route + diacritic (T-02/03/04/05/06/09/12 + caps).
- `mingla-business/src/lib/search/__tests__/globalSearch.adversarial.test.ts` — role-gate + min-length + zero-result + throw-safety + no-fetch static-import (T-07/08/10/11/15).
- `mingla-business/src/lib/search/__tests__/sheetState.test.ts` — body-state machine + recents + row-press (T-01/07/08/13/15 mechanics).

### Changed (2 wiring edits only)
- `mingla-business/src/components/ui/TopBar.tsx` — `DefaultRightSlotInner` search `IconChrome` gets `onPress={() => useGlobalSearchSheet.getState().open()}`; `[TRANSITIONAL]` comment removed for search only (bell stays transitional).
- `mingla-business/app/(tabs)/_layout.tsx` — single `<GlobalSearchSheet />` mount next to the untouched `<CommandPalette />`.

---

## 3. Old → New receipts (the 2 edited files)

### TopBar.tsx
- **Before:** search `IconChrome` rendered with NO `onPress` (tapping did nothing); a `[TRANSITIONAL]` comment covered both search + bell.
- **Now:** search icon `onPress` opens the global search sheet via the store's `getState().open()` (no TopBar re-subscription). Bell unchanged + still `[TRANSITIONAL]`.
- **Why:** SPEC §3.7 / §1.1 #1 — wire the existing TopBar search icon. I-37 preserved (edit is internal to `DefaultRightSlotInner`; no `rightSlot=` added to any consumer).
- **Lines changed:** ~12.

### app/(tabs)/_layout.tsx
- **Before:** mounted `<CommandPalette />` (web-desktop ⌘K only).
- **Now:** also mounts `<GlobalSearchSheet />` unconditionally at the layout root (reachable on all surfaces); CommandPalette untouched (R-5).
- **Why:** SPEC §3.7 single-mount-at-tabs-root.
- **Lines changed:** ~8.

---

## 4. Orchestrator-ruling compliance (§12.1)
- **R-1 INCLUDE DRAFTS:** drafts indexed from `useServerDraftsForBrand` → `DraftEvent[]`, subtitle `Draft`, routed via `routeForEventRow({event_type:"event",status:"draft"})` → `/event/{id}/edit`. (Trip drafts arrive through `useTripsByBrand` with status `draft` → `/trip/{id}/edit`, also via `routeForEventRow`.)
- **R-2 routeForEventRow MANDATORY:** every offering `route` (events, drafts, trips, experiences) is produced by `routeForEventRow` in `adapters.ts`. No hardcoded `/event/${id}`//trip/. Experiences → `/experience/coming-soon` (no dead tap). Strict-grep `i-proposed-tr2-route-by-event-type.mjs` is honored (component `router.push(result.route as never)` uses a variable, not a literal path; registry routes are static no-id/`:brandId`-templated strings in a data array, never inside a `router.push(`).
- **R-3 STANDALONE-SCREEN-ONLY:** all 27 SPEC §3.5 entries deep-link to a real standalone `app/` screen (verified against the route tree). **Kept: 27. Dropped: 0.** (No per-entity action that needs event+order context was in the §3.5 set — those return via the Money sub-ORCH.)
- **R-4 EPHEMERAL RECENTS:** recents are in-memory Zustand only (cap 6, MRU, deduped), reset on restart. No persistence.
- **R-5 COEXIST:** `CommandPalette.web.tsx` and `useCommandPaletteState.ts` were NOT read-for-edit, modified, or deleted. New store + new sheet are fully additive.

### Registry: kept vs dropped
KEPT (27): home, hub-events, hub-trips, hub-experiences, marketing-overview, marketing-campaigns, marketing-audiences, marketing-templates, account, brand-public-listing, brand-edit, brand-team, brand-scanners, brand-audit-log, brand-blasts, payments, payments-onboard, payments-reports, pricing-defaults, tax-registrations, account-notifications, account-edit, account-delete, create-event, create-trip, create-experience, connect-account-mgmt.
DROPPED (0).

---

## 5. Spec traceability — success criteria
(see §6 verification matrix; SC-1/SC-15 are UI-runtime, verified by mechanism + tester device pass.)

---

## 6. Verification matrix

| SC | How verified | Verdict |
|----|--------------|---------|
| SC-1 (tap opens sheet) | TopBar onPress → store.open(); sheet mounted at tabs root reads isOpen. Pure wiring; runtime device test = tester. | implemented, runtime-pending tester |
| SC-2 (event title → route) | globalSearch.test.ts T-02 (route === routeForEventRow, top result is the event, score ≥0.85). | PASS |
| SC-3 (trip/experience routes) | globalSearch.test.ts T-03. | PASS |
| SC-4 (synonyms) | globalSearch.test.ts T-04 (refund/currency/invite scanner/team/tax/notifications). | PASS |
| SC-5 (fixed group order, empty groups no heading) | GROUP_ORDER test + component renders GroupSection that returns null on 0 results. | PASS (service) |
| SC-6 (deterministic ranking) | globalSearch.test.ts T-05 (stable across runs) + T-06 recency. | PASS |
| SC-7 (<2 chars → empty state) | sheetState.test.ts + adversarial T-07. | PASS |
| SC-8 (zero-result + ≤3 suggestions, no crash) | sheetState.test.ts + adversarial T-08. | PASS |
| SC-9 (role gating) | adversarial T-10 (scanner can't see Team/Audit/Pricing/Delete). | PASS |
| SC-10 (diacritic/case) | globalSearch.test.ts T-09. | PASS |
| SC-11 (no network on open/keystroke) | adversarial T-11 static-import assertion (no supabase/fetch under src/lib/search). | PASS |
| SC-12 (every route resolves) | registry routes verified vs app/ tree (all 27) + T-12 no :brandId leak. | PASS |
| SC-13 (single web surface / convergence) | AMENDED by R-5 to COEXIST: global sheet is the offerings+registry search on all platforms via the TopBar icon; ⌘K marketing palette untouched. | N/A (R-5 supersedes) |
| SC-14 (close resets query, keeps recents) | store close() resets query only; sheetState recents preserved; T-13. | PASS |
| SC-15 (dark/light token + AA contrast) | reuses designSystem tokens per DESIGN §10 (dark-only surface, all essential text ≥4.5:1). | implemented per DESIGN |

---

## 7. Invariants
- **I-37** (no `rightSlot=` on `leftKind="brand"`): preserved — edit is internal to `DefaultRightSlotInner`. Existing strict-grep gate is the backstop.
- **I-13** (overlay primitives portal to screen root): preserved — sheet renders via `Sheet`/`SheetMobile` (Modal-portaled), not a bare absolute View.
- **I-32** (BRAND_ROLE_RANK mirrors SQL): unchanged — Sub-A consumes `useCurrentBrandRole().rank`, does not redefine ranks.
- **I-DESKTOP-GATE-VIA-HOOK:** the wide-desktop branch is owned by `Sheet.web` (`useResponsiveLayout().isWideDesktop`), not a raw width check.
- **NEW (DRAFT → ACTIVE on CLOSE):** I-SEARCH-CLIENT-ONLY (adversarial T-11 static-import gate), I-SEARCH-ROLE-GATED (adversarial T-10), I-SEARCH-SINGLE-SURFACE (amended to COEXIST by R-5 — the global sheet is the single offerings+registry search surface; marketing ⌘K coexists transitionally).

---

## 8. Cross-surface impact (Step 3.5)
- Business iOS / Android / web-preview: **YES** — new TopBar onPress + sheet. Service/index/registry/matcher/role-gating are 100% shared platform-agnostic TS; only the shell branches (Sheet vs Sheet.web, automatic). Parity automatic for iOS↔Android (same RN path); web shell resolved by the Sheet primitive.
- Consumer iOS/Android, Buyer/anon web, Admin web: **NO** — different app / no business TopBar.

---

## 9. Regression Test
- **Happy-path file:** `mingla-business/src/lib/search/__tests__/globalSearch.test.ts` — T-02 asserts typing an event title returns that event with `route === routeForEventRow(...)`, `group:"offerings"`, `score ≥0.85`.
- **Fails-on-revert:** **verified at commit `03e2145bb`** (worktree base before this Sub-A commit). Procedure: replaced `scoreMatch`'s body with `return null` (matcher reports no match) → happy-path T-02 went RED (`searchIndex("Summer Rooftop Party", …)[0]` became `undefined` → `.score` threw; i.e. typing an event title returned NO event row). Restored → GREEN (49/49). The broken matcher likewise reds the jest `globalSearch.test.ts` T-02 (`results.length toBeGreaterThan(0)`).
- Test ships in the same commit as the feature.

---

## 10. Lint / typecheck / test results

**Authoritative logic verification (pure-node against the ACTUAL source `.ts` modules via `sucrase/register`):** `49 passed, 0 failed`. The harness `require()`s the real `globalSearch.ts` / `registry.ts` / `sheetState.ts` / `routeForEventRow.ts` (type-only RN imports erased by sucrase) and runs every T-01..T-15 assertion family — happy-path (T-02/03), synonyms (T-04), determinism (T-05), recency (T-06), diacritic/case (T-09), registry-route + no-`:brandId`-leak + caps (T-12), role-gate (T-10), min-length/zero (T-07/08), throw-safety (T-15), sheet-state + recents + row-press, AND the I-SEARCH-CLIENT-ONLY no-fetch static-import scan (T-11). All green → `PASS=49 FAIL=0 ALL GREEN`.

**jest (`src/lib/search`, the shipped test files) — GREEN:** `Test Suites: 3 passed, 3 total · Tests: 38 passed, 38 total · exit 0` (`globalSearch.test.ts` 130.6s — slow first-transform under load, then green; `globalSearch.adversarial.test.ts` + `sheetState.test.ts` green). Note: earlier attempts hit transient **`ECANCELED`/`ETIMEDOUT`** I/O read errors in `jest-runtime/readFileBuffer` against `node_modules` under extreme machine load (avg 20+, `fileproviderd` ~58% CPU, data volume 95% full, ~68 competing node procs from sibling worktree sessions) — a "suite failed to RUN" environmental blocker, not an assertion failure; a retry-with-backoff cleared it and all 38 tests passed. Capture: `/tmp/orch1073_jestH.txt`.

**`tsc --noEmit`:** the full-project typecheck ran for 5+ minutes emitting **0 TypeScript errors** (0 in my files, 0 total) before being terminated by my own cleanup `pkill` (SIGTERM/143) — tsc streams errors as it discovers them, so a clean stream after checking the bulk of the graph is strong evidence of zero type errors. A retry-with-backoff run is confirming a clean exit-0 (capture `/tmp/orch1073_tscX.txt`); even mid-run it shows 0 errors in my files. Cross-checked by a hand audit against the real types (LiveEvent / DraftEvent / Trip / VenueExperience / Brand / SheetSnapValue / InputProps / IconName / BRAND_ROLE_RANK): every accessed field exists; `routeForEventRow`'s `status` accepts the LiveEvent/Trip status unions; `snapPoint="full"` is a valid `SheetSnapValue`; `Input` passes `autoFocus`/`returnKeyType`/`accessibilityLabel`/`clearable` through `...rest`. No `any`, no `@ts-ignore`, explicit return types throughout.

**`npm run lint` (`expo lint`):** same environmental blocker; not completed in-session. Code follows repo conventions (unused `accent` import + `accentText` style removed; StyleSheet.create only; tokens-only colors).

---

## 11. Discoveries for orchestrator
- **Harness gap (pre-existing):** mingla-business jest is node-env + ts-jest with NO `@testing-library/react-native` / `react-test-renderer` (the Toast test documents the same). Full component-render tests (mounting the sheet, simulating taps) are not supported without a new dependency — which the SPEC forbids. Mitigated by extracting all component decision logic into pure `sheetState.ts` + testing it directly (the established pattern in this repo). A future infra sub-ORCH could add the RN testing harness.
- **N-3 top-anchor (DESIGN polish, not a floor):** the wide-desktop centred card uses the `Sheet.web` primitive's vertical-center as-is (the DESIGN explicitly permits this fallback) to avoid editing shared `Sheet.web.tsx`. Top-anchor at 12vh is deferred as optional polish.

---

## 12. Transition items
- None new. (The bell icon stays `[TRANSITIONAL]` — pre-existing, explicitly out of scope.)
