# QA — META-ORCH-1073 Sub-A — Global Search Sheet (Phase 1)

**ORCH:** META-ORCH-1073 Sub-A — "Global search sheet (Phase 1)" — Mingla Business app (`mingla-business/`).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1073-Sub-A-[global-search-sheet]/` on branch `META-ORCH-1073-Sub-A-global-search-sheet`.
**Under test:** commit `38ef11d3f`.
**Tester:** mingla-tester (Claude), 2026-06-04.
**Mode:** TARGETED + SPEC-COMPLIANCE (client-only greenfield UI feature).
**Binding contracts:** `SPEC_META-ORCH-1073_Sub-A_GLOBAL_SEARCH_SHEET.md` (§13 LOCKED + §12.1 rulings BINDING); `DESIGN_…`; `IMPLEMENTATION_…`.

> Assume-broken posture: every claim below is independently verified against the actual source, not the implementor's report.

---

## 0. COMMS-Ledger
Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` row targets this skill, META-ORCH-1073, or `ALL`. COMMS-0002 (backend strict-grep) + COMMS-0003 (external-API docs) are **N/A — client-only Phase 1** (no `supabase/functions/**`, no migration, no external API/SDK). No cross-ORCH discovery → no ledger write required.

---

## 1. VERDICT: CONDITIONAL PASS

The feature is functionally correct, type-safe, route-safe, role-gated, and COEXIST-clean. One **P2 robustness finding (F-1)** and two **P3 polish gaps (F-2, F-3)** are documented below; none is a live crash with type-faithful cache data, and none blocks ship. CONDITIONAL because (a) the live-fire iOS sim leg was obstructed by a multi-session Metro port-collision (infra, not Sub-A) and downgraded to `probable`, and (b) F-1 warrants a 2-line defensive fix the orchestrator should fold in before/at CLOSE.

- **P0:** 0 | **P1:** 0 | **P2:** 1 (F-1) | **P3:** 2 (F-2, F-3) | **P4:** 2 (praise)

---

## 2. Gate results (independently re-run)

| Gate | Result | Evidence |
|------|--------|----------|
| `tsc --noEmit` (full project) | **PASS for Sub-A** — 243 total pre-existing errors, **0 in any Sub-A file** (search lib / hooks / GlobalSearchSheet / TopBar / _layout / my test). Baseline errors live in `packages/brand-rendering` (100), `packages/event-rendering` (87), `packages/phone-input` (30), assorted app/checkout + Sheet.web + payments-native, all on `main`. | `/tmp/qa1073_TSC_FINAL.txt`, exit 2 |
| jest `src/lib/search` (shipped suites incl. my adversarial) | **PASS — 4 suites, 50 tests, 0 fail, exit 0** (`globalSearch.test.ts`, `globalSearch.adversarial.test.ts`, `sheetState.test.ts`, **`globalSearch.tester.adversarial.test.ts`** all PASS) | task bqdkoxua5, exit 0 |
| eslint (12 Sub-A files + my test) | **PASS — 0 problems** | task bybydyy4i, exit 0 |
| Independent sucrase verify of REAL source (my 61 assertions) | **PASS 61/61** | `/tmp/qa1073_verify.cjs` |
| Route strict-grep `i-proposed-tr2-route-by-event-type.mjs` | **PASS for Sub-A** (3 pre-existing `/scanner` violations in home.tsx / accept-scanner-invitation.tsx / ScannerHome.tsx are on `main`, untouched by this PR; ZERO new violations from the 16 search/wiring files) | exit 1 = baseline only |
| COEXIST byte-check (CommandPalette.web.tsx + useCommandPaletteState.ts) | **PASS — byte-identical to origin/main** | blob SHA match (see §4) |
| All 27 registry routes resolve to real `app/` screens (SC-12) | **PASS — 27/27** (incl. `[id]` dynamic-segment match) | §5 mapping |

---

## 3. Mandatory verification checklist (dispatch §1–§8)

### (1) Full gate re-run
- `tsc --noEmit`: 243 total errors, **0 in any Sub-A file**; the 243 are pre-existing baseline in shared `packages/*` + unrelated app screens (proven by file-path breakdown). Sub-A is type-clean.
- jest `src/lib/search`: **4 suites / 50 tests / 0 fail / exit 0** — incl. my `globalSearch.tester.adversarial.test.ts` PASS (note: `globalSearch.test.ts` took 477s to transform under the multi-session I/O load, then green — an environmental slowdown, not a failure).
- eslint (all 12 Sub-A files + my test): **0 problems, exit 0**.
- Independent logic re-verification via sucrase against the **actual** `globalSearch.ts` / `scoreMatch.ts` / `adapters.ts` / `registry.ts` / `sheetState.ts` / `routeForEventRow.ts` modules (type-only RN imports erased): **61/61 assertions green**, covering SC-2..SC-12, role gating across all 3 result paths, caps, diacritics, sheetState, recents, and route resolution. This is independent of the implementor's tests.

### (2) Client-only invariant (I-SEARCH-CLIENT-ONLY) — PASS
Static proof: `src/lib/search/**` imports only `./types`, `./normalize`, `./scoreMatch`, `./registry`, `./adapters`, `../../utils/routeForEventRow`, and type-only imports of the store/service types. No `supabase`, no `@supabase/supabase-js`, no `services/*` that fetch, no `fetch(` call. The hook `useGlobalSearchIndex` reads React-Query **caches** via existing list hooks (`.data`), never fetches new. Opening the sheet / typing fires zero network requests by construction. (Mirrors the implementor's T-11 import-scan, re-verified.)

### (3) Route safety — PASS
- All offering routes (`event`/`draft`/`trip`/`experience`) are produced by `routeForEventRow(...)` in `adapters.ts` — never string-built. Drafts → `/event|trip/{id}/edit`; experiences → `/experience/coming-soon` (no dead tap). Verified by sucrase test: trip→`/trip/t1`, experience→`/experience/coming-soon`, draft→`/event/d/edit`, all equal to `routeForEventRow` output.
- Registry routes are static strings in a **data array**, not inside any `router.push(` literal, so the strict-grep ban does not apply to them. The component calls `router.push(result.route as never)` with a **variable**.
- Strict-grep `i-proposed-tr2-route-by-event-type.mjs`: 3 violations, ALL pre-existing `/scanner` hits on `main` (out of scope per dispatch). NONE of the 16 Sub-A files flagged.

### (4) R-5 COEXIST byte-check — PASS
`git diff origin/main...HEAD` touches NEITHER `CommandPalette.web.tsx` NOR `useCommandPaletteState.ts`. Blob SHAs identical:
- `CommandPalette.web.tsx`: HEAD `453f3e8e…` === main `453f3e8e…`
- `useCommandPaletteState.ts`: HEAD `0ca7571a…` === main `0ca7571a…`
`(tabs)/_layout.tsx` adds the `<GlobalSearchSheet />` mount **next to** the untouched `{Platform.OS==="web" && isWideDesktop ? <CommandPalette/> : null}`. Two web surfaces coexist transitionally as ruled.

### (5) Role-gating — PASS (defense-in-depth verified)
`useGlobalSearchIndex` drops `minRank > rank` entries via `filterIndexByRank` BEFORE matching. Independently proven a **scanner (rank 10)**:
- index excludes `brand-team`(50), `brand-audit-log`(50), `pricing-defaults`(50), `account-delete`(60);
- `searchIndex("delete account")` → `[]`; `searchIndex("team")` → no `brand-team`;
- **AND** the empty-state `jumpToSuggestions` and the zero-result `nearestSuggestions` rescue paths also exclude all owner-only ids (my adversarial angle A — implementor only tested the `searchIndex` path).
- Boundary: `rank === minRank` is VISIBLE (`>=`, not `>`) — finance(30) sees `payments`(30) but not `pricing-defaults`(50).

### (6) All 27 registry routes resolve (SC-12) — PASS
Each of the 27 routes maps to a real `app/` file including `[id]` dynamic segments — full mapping in §5. The implementor's T-12 only asserts routes are non-empty `/`-prefixed strings; this independent check resolves each against the actual route tree (a gap the implementor's test did not close, now closed).

### (7) Tester adversarial regression test — DELIVERED
File: `mingla-business/src/lib/search/__tests__/globalSearch.tester.adversarial.test.ts`. Attacks FOUR angles distinct from the implementor's happy-path AND from the implementor's own adversarial suite:
- **A. Role-gate leak across ALL THREE result paths** (`searchIndex` + `jumpToSuggestions` + `nearestSuggestions`) + the `>=` boundary — implementor only tested `searchIndex`.
- **B. Throw-safety on malformed OFFERING data through the REAL adapters** (not a hand-faked `{searchText:null}` index entry) — surfaced FINDING F-1.
- **C. Per-group caps for `goto`+`settings` + the total cap of 20** — implementor only asserted the offerings cap of 8.
- **D. Diacritic query → plain registry synonym + multi-mark title both directions + uppercase.**
Passing run: jest PASS (in the 50-test suite, exit 0) AND independent sucrase+stub run 12/12. Committed `dd7141e63`.

### (8) Cross-surface live-fire — see §7. iOS = `probable` (Metro port-collision infra block, characterized + bundle request proven reaching Metro); web/Android summarized.

---

## 4. Constitution spot-check (relevant rules)
- **#1 No dead taps** — every result routes to a resolvable route (SC-12 27/27 + offerings via routeForEventRow). PASS.
- **#2 One owner per truth** — index reads React-Query caches (server state) through hooks; only ephemeral UI (open/query/recents) in Zustand, mirroring the approved `useCommandPaletteState` precedent. PASS.
- **#3 No silent failure** — `searchIndexSafe` returns `{ok:false}` → component renders a visible "Something went wrong searching" row (not a crash, not a swallow). PASS for the *search* path. **Caveat: the index BUILD (`buildSearchIndex` in the hook's useMemo) is NOT wrapped** — see F-1.
- **#5 Server-state-server-side** — confirmed; no server data in Zustand. PASS.
- **#9 No fabricated data** — trips omit location (no `location_text` field) rather than fabricate; missing subtitle hidden. PASS.

---

## 5. SC-12 — 27 registry routes resolved against `app/`
home→(tabs)/home.tsx · hub-events→(tabs)/hub/events.tsx · hub-trips→hub/trips.tsx · hub-experiences→hub/experiences.tsx · marketing-overview→marketing/index.tsx · marketing-campaigns→marketing/campaigns/index.tsx · marketing-audiences→marketing/audiences/index.tsx · marketing-templates→marketing/templates/index.tsx · account→(tabs)/account.tsx · brand-public-listing→brand/[id]/listing.tsx · brand-edit→brand/[id]/edit.tsx · brand-team→brand/[id]/team.tsx · brand-scanners→brand/[id]/scanners.tsx · brand-audit-log→brand/[id]/audit-log.tsx · brand-blasts→brand/[id]/blasts.tsx · payments→brand/[id]/payments/index.tsx · payments-onboard→brand/[id]/payments/onboard.tsx · payments-reports→brand/[id]/payments/reports.tsx · pricing-defaults→brand/[id]/pricing-defaults.tsx · tax-registrations→connect-tax-registrations/index.tsx · account-notifications→account/notifications.tsx · account-edit→account/edit-profile.tsx · account-delete→account/delete.tsx · create-event→event/create.tsx · create-trip→trip/create.tsx · create-experience→experience/create.tsx · connect-account-mgmt→connect-account-management.tsx. **All 27 resolve.** Offering routes `/event/{id}`, `/event/{id}/edit`, `/trip/{id}`, `/trip/{id}/edit`, `/experience/coming-soon` also all exist.

---

## 6. Findings

### F-1 (P2) — `buildSearchText` adapters throw on `undefined` (not `null`) title/description; index-build is unguarded
**File:** `mingla-business/src/lib/search/adapters.ts:62,68` (+ `normalize.ts:17`).
**Evidence:** Feeding the REAL adapters an offering object with `description: undefined` (omitted) or `name/title: undefined` makes `buildSearchText` call `parts.body.length` / `normalizeSearchText(parts.title)` on `undefined` → `TypeError: Cannot read properties of undefined`. Proven via sucrase against the actual module: `eventsToIndexEntries([{id:"z",name:"Z"}])` THROWS; `…([{id:"z",description:""}])` THROWS (missing name). `null` and `""` are handled correctly; only `undefined` throws. The asymmetry: `location`/`keywords` are defensively coalesced (`?? null`, `.filter`), but `body: ev.description` and `title: ev.name` are passed RAW.
**Why it matters:** SPEC §3.3 states "adapters return `[]` for null/empty inputs and NEVER throw," and the implementor's report claims the same — this is violated for `undefined`. Worse, `buildSearchIndex` runs inside `useGlobalSearchIndex`'s `useMemo` with NO try/catch, so an undefined-field offering would throw during render → sheet crash, NOT the graceful error state (which only wraps `searchIndex`, not the build).
**Live severity = P2, not P0/P1:** with type-faithful cache data this cannot fire. `LiveEvent.description: string` (mapper uses `row.description ?? ""`), `Trip.description: string | null`, `VenueExperience.description: string | null`, and all titles/names are required `string` — so real React-Query caches never deliver `undefined` here. The risk is latent: an optimistic update, partial hydration, or future type drift that introduces `undefined` would crash the sheet instead of degrading. The implementor's adversarial throw test only faked `{searchText:null}` directly into `searchIndexSafe`, bypassing the adapters — so this gap was untested.
**Fix (2 lines, defensive):** in `adapters.ts` coalesce raw inputs — `title: parts.title ?? ""` (or guard at call sites `body: ev.description ?? null`, `title: ev.name ?? "Untitled"`), and/or wrap the `buildSearchIndex(...)` call in `useGlobalSearchIndex`'s useMemo in try/catch returning `[]`. Recommend the orchestrator fold this into CLOSE.

### F-2 (P3) — Return key does not activate the first result row (DESIGN §4 unmet)
**File:** `GlobalSearchSheet.tsx:193` — `returnKeyType="search"` is set but there is no `onSubmitEditing` to activate the first/highlighted row. DESIGN §4 (line 109) specifies pressing Return "activates the first/highlighted result row if one exists." Currently Return just dismisses the keyboard. Keyboard-first parity gap; not a functional break. Defer or fold into a polish pass.

### F-3 (P3) — `subtitle` for events is status-only; SPEC §3.1.5 specified "status + next date"
**File:** `adapters.ts:105` — event subtitle = `statusLabel(ev.status)` only. SPEC §3.1.5 said subtitle should carry `status`+next date for events. Date omitted (the `LiveEvent` next-date derivation is non-trivial and the SPEC marks subtitle exact content OPEN). Acceptable Phase-1 reduction; noted for completeness.

### F-4 (P4 praise) — Clean pure/impure separation
All matching/ranking/gating logic is pure platform-agnostic TS in `src/lib/search/`; the component is a thin renderer over `sheetState.ts`. This is exactly the testable architecture the SPEC demanded and made independent verification trivial.

### F-5 (P4 praise) — Defense-in-depth role filter
Role filtering at the hook layer (before matching) means neither presentation shell can leak a gated entry, and ALL three result paths inherit it. Correct security-courtesy layering with RLS still the real boundary.

---

## 7. Cross-surface live-fire (Phase 0.A)

### iOS Simulator — `probable` (infra-blocked, characterized)
- Device: iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6`, iOS 26.4; business dev-client `com.sethogieva.minglabusiness` installed.
- **Blocker (infra, NOT Sub-A):** the multi-session machine had sibling Metro instances holding ports 8081 + 8095. The business dev-client connected to 127.0.0.1:8095 and requested the bundle, but 8095 was owned by a sibling `mingla-mobile-test-originmain/app-mobile` Metro (proven via `lsof` + the sim's `CFNetwork` log: `GET http://127.0.0.1:8095/ … error -1001 request timed out` after 60s) → black screen. A wrong-Metro bundle, not a Sub-A render failure.
- **Resolution attempts (good-faith, per the resolve-not-note rule):** (1) killed all my duplicate Metro/tsc/jest processes that were self-contending; (2) identified the root cause — macOS `fileproviderd` (iCloud file-sync daemon) oscillating 0–110% CPU + sibling-session Metro instances + near-full data volume — saturating disk I/O so NO bundler/transformer could make progress; (3) freed ports (8081/8095 held by sibling app-mobile Metros; rebound business Metro on the genuinely-free 8199/8222); (4) waited out the oscillation. `fileproviderd` is a system daemon that cannot be safely killed (manages file-sync integrity), and the sibling sessions must not be killed. Two bundle-load attempts were made; the first proved the dev-client reaches Metro (CFNetwork `GET http://127.0.0.1:8095/` then `-1001 timed out` against the WRONG sibling Metro). After freeing the port, Metro on 8199 remained I/O-starved at sheet-test time (alive, 0% CPU, never reached "Waiting on").
- **Third attempt (after I/O eased):** business Metro on 8199 reached full readiness ("Waiting on http://localhost:8199"), the dev-client connected to it (the dev-client error card explicitly read "Failed to load app from http://127.0.0.1:8199" — proving the handshake reached MY Metro, not a sibling), and Reload was tapped via Maestro — but the bundle BUILD never completed because `fileproviderd` re-saturated disk I/O (oscillating 0–110%), so Metro never advanced from "Starting Metro Bundler" to a served bundle. Screenshots: `/tmp/qa1073_sim_03.png` (dev-client "problem loading … 8199" error card), `/tmp/qa1073_sim_05.png`.
- Source-only + the mechanical proof (TopBar onPress→`useGlobalSearchSheet.getState().open()`; single `<GlobalSearchSheet/>` mount reads `isOpen`; `Sheet visible={isOpen}` via the canonical, already-shipped `Sheet` primitive) places the open-path at `probable`. The pure result/render data logic is `proven` at the unit level (jest 50/50 + 73 independent sucrase assertions). **No verdict-relevant finding hinges on the un-run sim leg** — the only finding (F-1) is a static, type-system-bounded latent issue, not a runtime symptom. The blocker is a system-owned daemon that cannot be safely killed; the tester exhausted port/process/cache recovery.

### Business Web preview — summarized
Same shared service + index + registry; web shell resolved by `Sheet.web` (`isWideDesktop` gate). No web-specific divergence in the data path. <FILL if exercised>.

### Android — summarized
Identical RN code path to iOS (shared `Sheet`→`SheetMobile`); Android opaque-glass fallback baked into the primitive. Emulator `emulator-5554` is booted. Parity is automatic at the data layer; shell is the shared primitive.

---

## 8. Discoveries for orchestrator
- **F-1** defensive fix recommended at CLOSE (latent crash class; 2 lines).
- **Infra:** multi-session Metro port-collision (8081/8095 held by sibling app-mobile sessions) obstructs business-app sim live-fire; use a high free port (e.g. 8199) and verify `lsof` ownership before deep-linking. Reinforces the stale-bundle / wrong-Metro hazard.
- The new invariants I-SEARCH-CLIENT-ONLY / I-SEARCH-ROLE-GATED / I-SEARCH-SINGLE-SURFACE(→COEXIST) are satisfied and ready to flip DRAFT→ACTIVE on CLOSE.

---

## 9. Regression-test gate
- **Implementor happy-path:** `src/lib/search/__tests__/globalSearch.test.ts` (T-02 event-title→route via routeForEventRow, score≥0.85). Implementor reports fails-on-revert verified at base `03e2145bb` (matcher→`return null` reds T-02). In the closing PR diff.
- **Tester adversarial (mine):** `src/lib/search/__tests__/globalSearch.tester.adversarial.test.ts` — 4 distinct angles (role-leak-all-paths / adapter-throw-safety / goto+settings+total caps / diacritic-synonym). NOT a rename of the implementor's test. In the PR diff after staging.
- Both present in `git diff origin/main...HEAD --name-only` once my file is staged/committed.
