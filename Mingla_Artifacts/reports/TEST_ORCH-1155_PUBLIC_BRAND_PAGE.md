# TEST — ORCH-1155 · Public Brand Page — Direction-A Redesign + All-Surface Parity

**Mode:** mingla-tester (SPEC-COMPLIANCE + TARGETED)
**Date:** 2026-06-17
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1155-[brand-page-parity]/` · branch `ORCH-1155-brand-page-parity`
**HEAD at test:** `5f6a4c791` (impl HEAD `b9c2df303` + this tester's adversarial-test commit)
**Env verified:** Supabase project `gqnoajqerqhnvulmnyvv` (Mingla-dev) — migration `20261013000000` APPLIED + live-fire confirmed.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1155_PUBLIC_BRAND_PAGE.md` · **Impl report:** `…/reports/IMPLEMENT_ORCH-1155_PUBLIC_BRAND_PAGE.md`

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 · P3: 1 · P4: 2.

Every backend / data-path / structural success criterion is PROVEN at runtime (DB live-fire) or structurally at the source. The redesign correctly composes the shared Direction-A primitives, the two-data-path experience-video-cover trap is genuinely wired on BOTH paths (independently fails-on-revert proven), the consumer badge dead-taps are fixed with end-to-end slug threading + empty-slug guards, the theme is anon-safe, and both regression tests are on-branch, in-diff, and fails-on-revert verified.

The CONDITIONAL (not full PASS) is **solely** because the runtime VISUAL criteria — parallax pinning, the desktop two-column layout at ≥1024px, chrome-clears-notch on consumer native, and video actually PLAYING in the experience card — could not be live-fired by the tester: the bracket worktree path breaks Metro/expo, and the deployed buyer-web is `main` (pre-redesign), so no headless web screenshot of THIS branch was capturable. Per the tester confidence ladder, UI/runtime criteria sit at `probable` (source-proven, blocker named), not `proven`. These are **Seth's device/web eyeball** before CLOSE.

No defect blocks merge. The one P2 (no CI runner wired for the package/app-mobile tests) and one P3 (best-effort native scroll-into-view) are accepted-class items inherited from the implement report's known-issues, surfaced for the orchestrator.

---

## 2. SC-by-SC matrix

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | About first + default (all 5, AUTO) | PASS (struct) / probable (visual) | `PublicBrandPage.tsx:293` `const tabs: Tab[] = ["about"]`; `:243` `useState<Tab>("about")`; empty-tab guard `:311` snaps to `visibleTabs[0]`. Happy-path T-1 + adversarial fixtures green. Visual = Seth. |
| SC-2 | Tabs hide when empty (all 5, AUTO) | PASS (struct + DB data) | `:294-297` strict `> 0` guards. Adversarial executable fixtures: trips-only→`[about,trips]`, events-only→`[about,events]`, zero→`[about]`, full→`[about,upcoming,events,trips,experiences]`, past-only→tab still shows. Real brand slugs in §3. |
| SC-3 | About pane order tagline→bio(clamp+Read more)→contact (all 5) | PASS (struct) / probable (visual) | `AboutTab` `:1380-1428` renders tagline→`ClampedBio`→contact, each conditionally; `ClampedBio` `:1433` Read more/Show less. tagline/bio NOT in `identityBlock` (`:412-433` = avatar/verified/name/address only). |
| SC-4 | Parallax + seam + chrome (X·Share, Mute on video) | probable | `ParallaxCoverShell` composed `:607`; `showMute={coverType==="video"}` `:616`; mute state `:244`. Chrome top math `safeAreaTop+12` (shell `:286`/`:375`). Parallax/seam render = Seth device. |
| SC-5 | Desktop two-column ≥1024px (sticky Share+Next-up; no Reserve/Follow/contact) | PASS (struct) / probable (visual) | `useResponsiveLayout().isDesktop` `:242`; `stickyPanel` `:538-591` = avatar/name/address/socials+Share+Next-up, NO Reserve/Follow/contact; heroTitle desktop `:597`; 2-col `gridDesktop`. Layout render = Seth web ≥1024. |
| SC-6 | No fabricated Follow (all 5) | PASS | `grep -niE "follow|subscrib" PublicBrandPage.tsx` → 0 matches. Happy-path T-5 + adversarial sticky-panel isolation test green. |
| SC-7 | Theming parity via SHARED engine | PASS (struct) | `createThemePalette`/`offeringSurfaceStyles` imported from `@mingla/event-rendering` `:53-58`; NO file-local `createThemePalette`; `:252` `createThemePalette(resolvedTheme)`. Palette math untouched (parity-snapshot test unaffected). |
| SC-8 | Anon-safe (no `.from("brands")` in brand path) | PASS | Brand-page data path: consumer `useBrandBySlug.ts:315` `business_public_brands_view` + RPCs; business via public RPCs. The one `.from("brands")` (`publicEventsService.ts:1306`) is a PRE-EXISTING trip-detail resolver, NOT in the brand path, NOT touched by 1155 (`git diff` confirms). |
| SC-9-Web | Experience video cover via `publicEventsService` (surfaces 3-5) | PASS (data path) / probable (render) | RPC returns `cover_media_type` (DB live-fire); `experienceRowToCard` `:1112` maps `coverMediaType: row.cover_media_type`; `ExperienceMiniCard mediaType={experience.coverMediaType}` `:1295`. Video PLAYING render = Seth web. |
| SC-9-Native | Experience video cover via `useBrandBySlug` (surfaces 1-2) | PASS (data path) / probable (render) | Consumer `mapExperience` `:282` maps `coverMediaType: row.cover_media_type`; hook calls `pg_public_experiences_by_brand` `:331`. Adversarial test executes BOTH mappers over video/gif/image/null. |
| SC-10 | Swipe-badge → `/b/{slug}` (not dead tap) | PASS (wiring) / probable (device tap) | `CuratedExperienceSwipeCard` `onBrandPress` prop + `TrackedTouchableOpacity` wrapper; `SwipeableCards.tsx:2886` wires it w/ empty-slug guard; slug threaded RPC→discover-cards `:436`→deckService `:393`→currentRec. Device tap = Seth. |
| SC-11 | Detail "Presented by" → `/b/{slug}` | PASS (wiring) / probable (device tap) | `ConsumerExperienceDetailScreen.tsx:935-946` Pressable + empty-slug guard; `seed.brandSlug` mapped `:234`. |
| SC-12 | No curated regression (byte-identical) | PASS (struct) | `CuratedExperienceSwipeCard` `wrapped`-gated: absent `onBrandPress`→bare `<BrandChip>` (curated), present→wrapper owns button; adversarial-test path-shape asserted. |

**Notations:** "struct" = source-traced proven; "DB data" = live-fired against prod RPC; "probable" = source-proven but runtime visual blocked (bracket-path Metro / deployed-web-is-main) — reserved for Seth's device/web eyeball.

---

## 3. Tab hide/show proof — REAL brand slugs (SC-2)

Queried the actual brand offering data on `gqnoajqerqhnvulmnyvv`. Tab set is driven by the populated buckets (post paid-supply/publish gates), so these are the runtime-accurate expectations:

| Brand slug | events | trips | experiences | Expected tab set |
|---|---|---|---|---|
| `leggothis` (Leggo This) | 15 | 0 | 2 | `[About, (Upcoming?), Events, Experiences]` — **NO Trips chip** |
| `travelbrand` (Travel Brand) | 0 | 2 | 0 | `[About, (Upcoming?), Trips]` — no Events/Experiences |
| `teststripe` (Test Stripe) | 2 | 0 | 0 | `[About, Events]` — no Trips/Experiences |
| `lanternvine` (Lantern & Vine) | 0 | 0 | 1 | `[About, Experiences]` — and that experience has a **VIDEO cover** (SC-9) |
| `theonus` / `agloat` / `night-market` (zero-offering) | 0 | 0 | 0 | `[About]` only — identity/socials/contact still render |

The `experiences.length > 0` guard is strict-positive (adversarial test catches a `>= 0` regression that grep cannot). The empty-tab guard (`:311`) snaps `activeTab` back to About when the active bucket empties.

---

## 4. Experience video-cover two-path — TRULY wired (SC-9)

**DB live-fire (prod RPC):** `pg_public_experiences_by_brand('lanternvine')` returns:
```
experience_id b8bd995b-… | title "Raleigh Wine and Dine Crawl" | cover_media_type "video" | has_url true
```
- RPC result columns include `cover_media_type text` immediately after `cover_media_url` (`pg_get_function_result`).
- SECURITY DEFINER + STABLE; `proacl` = `anon=X, authenticated=X` (GRANT correct, anon-safe).

**Both source paths thread the field** (the spec's #1 miss-risk):
- Path 1 (web/business): `publicEventsService.ts` row `:348` + card `:368` + mapper `experienceRowToCard:1112` `coverMediaType: row.cover_media_type`; business adapter `mapExperience:121`.
- Path 2 (consumer): `useBrandBySlug.ts` row `:78` + mapper `mapExperience:282` `coverMediaType: row.cover_media_type`.
- Shared `PublicBrandExperience.coverMediaType: PublicMediaType | null` (`types.ts:100`); `ExperienceMiniCard` passes `mediaType={experience.coverMediaType}` (`:1295`, no longer hardcoded `"image"`).

**Adversarial proof the two paths cannot silently diverge:** my test extracts BOTH real mapper literals and executes them over `video/gif/image/null` rows; deleting `coverMediaType` from EITHER mapper fails the test (verified by line-deletion of the consumer mapper → "video cover would silently drop on this surface (SC-9 split)"). The remaining runtime gap is whether the card visually PLAYS the video — `EventCoverMedia` already does this on every other surface; Seth's web + consumer eyeball confirms it.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert + tester adversarial

**Implementor happy-path** `packages/brand-rendering/__tests__/orch_1155_brand_redesign.test.tsx`:
- Re-ran at HEAD `b9c2df303`: **10/10 PASS** (`cd mingla-business && npx jest --roots ../packages/brand-rendering`).
- Fails-on-revert (tester-run, TRUE line-deletion): deleted `const tabs: Tab[] = ["about"];` → **1 failed (T-1 About-first), 9 passed**; restored → 10/10. Confirmed at `b9c2df303`.

**Implementor consumer badge** `app-mobile/src/components/__tests__/orch_1155_brand_badge_nav.test.ts`:
- Re-ran: **PASS**. Fails-on-revert (tester-run): deleted the `onBrandPress` block at `SwipeableCards.tsx:2886` → test throws AssertionError (exit ≠ 0); restored → PASS.

**Implementor chrome inset** `app-mobile/src/screens/__tests__/orch_1155_brand_chrome_top_inset.test.ts`: re-ran → **PASS**.

**Relocated** `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx`: **4/4 PASS** (was 3/4-RED on origin/main — confirmed pre-existing, §9). Now green, assertions re-pointed at the shared package. Carries `[TEST-MOD-APPROVED ORCH-1155]` for its line-modifications.

---

## 6. Adversarial test added (tester-owned, DIFFERENT angle)

**Path:** `packages/brand-rendering/__tests__/orch_1155_brand_redesign.adversarial.test.tsx` — **commit `5f6a4c791`**, on-branch, in `git diff origin/main...HEAD --name-only`. **13/13 PASS.**

**Different angle** from the implementor's pure source-text grep: this test is **executable behavioral** —
- Lifts the REAL tab-build predicate from source and RUNS it against bucket fixtures (trips-only / events-only / experiences-only / zero / full / past-only) — catches a `> 0` → `>= 0` logic regression a grep misses.
- Executes BOTH real experience mappers (business + consumer) over video/gif/image/null rows — the two-path cover trap, the data side of SC-9.
- Mute-conditional as an executed predicate (image/gif/null ⇒ no Mute).
- Sticky-panel block isolation: Share + Next-up present, Follow/subscribe/Reserve absent.

**fails-on-revert verified at `b9c2df303`:** TRUE line-deletion of `coverMediaType: row.cover_media_type` from the consumer `mapExperience` → adversarial test FAILS (extractor throws on the missing field); restored → 13/13. Both the implementor's happy-path AND this adversarial test appear in the closing diff.

---

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | Swipe badge + "Presented by" lockup now Pressables → `/b/{slug}` with empty-slug guards. |
| 2 | One owner per truth | PASS | Single shared renderer; single shared palette engine (file-local deleted). |
| 3 | No silent failures | PASS | RPC error contract unchanged (throws on error); empty-slug guard is intentional no-nav, not a swallow. |
| 4 | One query key per entity | N/A | No new query keys; `useBrandBySlug` key unchanged. |
| 5 | Server state server-side | PASS | No Zustand server-state added; React Query path unchanged. |
| 6 | Logout clears everything | N/A | No auth/session state touched (anon page). |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional state introduced. |
| 8 | Subtract before adding | PASS | Renderer net −500 lines; deleted flat banner/local palette/hand-rolled chrome before composing the shell. |
| 9 | No fabricated data | PASS | Empty tabs/teaser/socials/contact/tagline/bio all hidden when absent; NO fabricated Follow. |
| 10 | Currency-aware | PASS | Price labels via `displayPriceCents`/existing all-in path; mapper `currency ?? "USD"` preserved (unchanged). |
| 11 | One auth instance | N/A | Anon page; no auth instance. |
| 12 | Validate at right time | N/A | No datetime validation in scope. |
| 13 | Exclusion consistency | PASS | Paid-supply gate preserved byte-for-byte in re-emitted RPC (ORCH-1076). |
| 14 | Persisted-state startup | N/A | No persisted store hydration in scope. |

No violations.

---

## 8. Device / parity matrix

| Surface | Verdict | Note |
|---|---|---|
| Consumer iOS | probable | Shared renderer (AUTO) + badge wiring + video cover via `useBrandBySlug` — source+data proven; device eyeball = Seth. |
| Consumer Android | probable | Same; opaque glass via shared `offeringSurfaceStyles`/`OfferingChrome` (reused, not re-implemented). |
| Buyer/anon Web | probable | Desktop two-column + phone parallax (AUTO) + video via `publicEventsService` — source+data proven; deployed web is `main`, branch headless render blocked by bracket path → Seth web eyeball. |
| Business iOS | probable | Shared renderer, phone single-column (AUTO). |
| Business Android | probable | Same; opaque glass. |
| Admin Web | N/A | No public brand page. |
| Business Web preview (adjacent) | N/A | The `/b` web route IS the buyer-web surface. |

**Physical iPhone (HITL):** not exercised this turn — the runtime visual checks are bundled into Seth's pre-CLOSE eyeball list (§ Device-only checks). No tester puppeteering of the physical device.

**Edge functions:** none touched (confirmed — no deploy). Migration `20261013000000` is APPLIED to `gqnoajqerqhnvulmnyvv` (live-fired). Must also be applied to PROD before the web/native CLOSE (orchestrator-owned).

---

## 9. NO REGRESSION — baseline-red confirmation

The implement report §12 flagged pre-existing RED suites/gates. Independently confirmed they are NOT caused by 1155:
- The 12 product files + 4 test files in `git diff origin/main...HEAD` do **NOT** include any of `serverDraftLifecycleGuards`, `TripVisualParity_adversarial`, `eventCoverVideoProcessingService`, `eventCoverMedia`, `orch_0893_*`, or `BrandSwitcherSheet.tsx`. The baseline-red files are untouched.
- The brand-page test signal itself is now GREEN (relocated dataDriven 4/4; was 3/4-red on main — the META-ORCH-0972 stale-symbol grep, OQ-1, owned + fixed by this spec).

These pre-existing reds are a separate triage ORCH (a Discovery, not a 1155 regression).

---

## 10. Findings

### P2-1 — No CI runner wired for the package / app-mobile regression tests
**Evidence:** `packages/brand-rendering/__tests__/*` and the app-mobile `node:assert` tests (`orch_1155_brand_badge_nav`, `orch_1155_brand_chrome_top_inset`) run only via the manual commands in the impl report §6 — no CI job executes `packages/**/__tests__` or app-mobile node tests (same gap as the existing `event-rendering`/app-mobile precedents). The relocated dataDriven test DOES run under business jest.
**Impact:** the new invariants (`I-PROPOSED-1155-*`) are not auto-enforced on future PRs; a regression could land unnoticed.
**Required fix:** orchestrator decision — add a CI step for the package/app-mobile tests (broader than 1155; affects all package tests). Not a 1155 product defect.
**Retest:** confirm a CI job globs and runs `packages/**/__tests__`.

### P3-1 — Active-chip scroll-into-view is best-effort on native (spec OQ-2)
**Evidence:** `TabBar` caches per-chip `onLayout` x-offsets and `scrollTo` on tab change (`:729-733`); spec OQ-2 declares this best-effort on native (chips fit a phone for ≤5 tabs). Load-bearing requirement (non-clipping horizontal ScrollView) is met (`:737`).
**Impact:** cosmetic; with ≤5 tabs no clipping. Confirm best-effort acceptance (spec OQ-2).
**Required fix:** none unless Seth wants guaranteed measured scroll-into-view on native.
**Retest:** N/A.

### P4-1 (praise) — Two-path cover field handled exactly to spec
The #1 miss-risk (experience video cover shipping on one surface only) is genuinely wired on both `publicEventsService` and `useBrandBySlug`, with the field name, null-safety, and shared type all consistent. The DB re-emit preserved the ORCH-1076 paid-supply gate byte-for-byte.

### P4-2 (praise) — Clean subtract-before-add refactor
Renderer net −500 lines: flat banner, local palette engine, and hand-rolled chrome all deleted before composing the shared shell. Single-palette-engine and no-dead-taps invariants are real, not cosmetic.

---

## 11. Discoveries for orchestrator

1. **Pre-existing RED jest suites + 2 strict-grep gates on origin/main** (impl §12) — confirmed not 1155-caused; worth a triage ORCH (`DraftEvent` type missing fields; missing `@testing-library/react-native`/`@mingla/payments-native` in default node jest env; `orch-0756a-active-brand-recovery` + `i-proposed-a-brands-deleted-filter` gate crashes).
2. **No CI runner for package/app-mobile tests** (P2-1) — program-wide gap, not 1155-specific.
3. **`hideFloatingChrome` prop now effectively unused** (kept for back-compat; both live callers pass it falsy) — future cleanup candidate.
4. **Migration must be applied to PROD** before web/native CLOSE — applied to dev `gqnoajqerqhnvulmnyvv` only so far.

## 12. Device-only checks remaining for Seth (the `probable` → `proven` gap)

1. **Buyer-web `/b/{slug}` at ≥1024px** (e.g. `leggothis`): contained 21:9 hero with verified eyebrow + name + address overlaid bottom-left; two-column — left tabs + 2-col card grid, right STICKY panel with Share + Next-up (no Reserve/Follow/contact). Resize <1024 collapses to single column.
2. **Buyer-web phone width + consumer native**: parallax cover pins, body slides over the 28px seam, chrome floats (X·Share); on `lanternvine` the experience card cover PLAYS VIDEO and a Mute button appears (image/gif/null covers = no Mute).
3. **Consumer native chrome clears the notch** (Known-Issue #1 fix): X/Share sit below the status bar on a home-indicator iPhone (effective `insets.top + 12`).
4. **Consumer badge taps**: tap the brand badge on a brand-experience swipe card AND the "Presented by" lockup on experience detail → both open `/b/{brandSlug}`; curated (AI) cards have no badge tap.
5. **Theme flip**: change a brand's theme color/font → accent + font recolor across eyebrow/tabs/cards/sticky-panel.

---

## 13. Accepted conditions (CONDITIONAL PASS)

Carried as `probable`-level deferrals to Seth's device/web eyeball (the runtime VISUAL criteria SC-1/3/4/5/9-render/10/11), plus:
- **P2-1** (no CI runner for package/app-mobile tests) — orchestrator decision, program-wide.
- **P3-1** (best-effort native scroll-into-view) — spec OQ-2, confirm acceptance.

No P0/P1. Once Seth confirms §12 on device + web, this upgrades to PASS → CLOSE.
