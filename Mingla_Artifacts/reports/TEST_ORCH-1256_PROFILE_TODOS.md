# TEST — ORCH-1256 [brand profile completion to-dos]

**Verdict: PASS** — P0: 0 · P1: 0 · P2: 2 · P3: 0 · P4: 3
**Tester:** mingla-tester (claude) · **Date:** 2026-07-02
**Worktree:** `~/Desktop/mingla-orchs/orch-1256-[brand-profile-todos]` on `orch-1256-brand-profile-todos`
**Commits under test:** b343fe144 (impl) · 4ef5d8b1f (impl tests) · eabc9dd89 (CI gate) · **Tester commit:** d4610c9a4 (adversarial test)
**Regression gate:** implementor happy-path fails-on-revert @ b343fe144 (independently re-run) + tester adversarial test on-branch, in-diff, own fails-on-revert. Gate satisfied.
**Comms ledger:** scanned on entry; COMMS-0052 (BLOCK, business OTA frozen) honored — zero `eas update`, no deploy, no merge.

---

## 1. SC-by-SC matrix (runtime evidence: iOS sim iPhone 17 Pro Max 2C3312D9, fresh Debug dev build from THIS branch; web via worktree Metro RN-web in headless Chromium. Screenshots in `Mingla_Artifacts/evidence/ORCH-1256/` — local, dir is gitignored by policy)

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1 | Fresh brand → all 8 profile rows, §4.2 order, after structural rows; Home AND Hub | **PASS (proven)** | Created fresh brand "ORCH-1256 QA 702" via app UI → header "10 things to do" = create-offering + connect-Stripe + all 8 profile rows in exact order (`T11_qa_brand_home.png`, tail rows in `T11_internal_scroll.png`); Hub identical (`SC1_hub_parity.png`). Partially-filled brand "Smoke & Rhythm" showed exactly its 5 empty-field rows after the venue row (`15_cold_restart.png`) — no false positives. Unit T-1/T-2 corroborate order + routes. |
| SC-2 | Row tap → `/brand/{id}/edit?section=<key>` scrolled to section | **PASS (proven, 4 sections + web)** | about: `T10_tagline_about.png` (ABOUT + tagline input at top); social (lowest section): `T10_socials_social.png` (SOCIAL LINKS + all 8 inputs at top); address: `T10_address.png`; cover via cold external deep link `mingla-business://brand/{id}/edit?section=cover`: `T10_cover_deeplink.png`. Web: socials-row click → URL `.../edit?section=social`, page scrolled (SOCIAL LINKS at top, `web_12_socials_scrolled.png`; ABOUT measured at y=−1677). |
| SC-3 | Fill field + save → exactly that row vanishes on return, no restart | **PASS (proven), P2-1 caveat** | Save #1 (tagline typed on bio-less brand): count 10→9 instantly on return — but the DESCRIBE row vanished (see P2-1: data model persisted the text as bio). Save #2 (bio now present): tagline row vanished, 9→8 (`T12_qa_after_save.png`, `T12_qa_after_save2.png`). DB round-trip verified (`description = "…\n\n…"`). React Query invalidation instant, zero restarts. Failed save (RLS-denied on non-owned brand) correctly did NOT remove any row. |
| SC-4 | Whitespace-only counts EMPTY | **PASS (unit-proven)** | Implementor T-4 + tester adversarial suite A: NBSP/U+3000/U+2007/U+FEFF/U+2028/U+2029/mixed all blank; U+200B boundary pinned as filled. Runtime exemption: whitespace-only values not authorable via sim keyboard flow in-session; predicate layer fully covered. |
| SC-5 | Socials aggregation (all-8-empty → one row; any one filled → absent) | **PASS (unit + runtime half)** | Runtime: all-empty links → exactly one "Add your social links" row present (`T11_internal_scroll.png`). Suppression: implementor per-network matrix + tester 8-way `test.each` incl. whitespace-only network (no suppress) + `links.custom`-only (no suppress) + custom+one-network (suppress). |
| SC-6 | No loading flash | **PASS (proven to 1s frame resolution)** | Cold-start burst: frames 01–06 splash, frame 07 already the complete settled list, no frame with wrong/vanishing rows (`SC6_frame_01..12.png`). Brandless account rendered only `create_brand` — zero profile rows (`07_home_settled.png`). Builder-side leak attacked in tester suite E (profile supplied during hasNoBrands/noSelection/resolving → zero rows). |
| SC-7 | 9+ rows → maxHeight 320 internal scroll; dashboard reachable; true N | **PASS (proven)** | 10 rows: list visibly capped ≈6 rows (`T11_qa_brand_home.png`), internal swipe reveals tail rows with header pinned (`T11_internal_scroll.png`), Hub dashboard (pills + empty-state CTA) visible below the bounded list (`SC1_hub_parity.png`). Header count "10 things to do" = true N. |
| SC-8 | 3 existing suites pass UNMODIFIED | **PASS** | `git diff origin/main...HEAD` over `businessTodos.test.ts` + `businessTodos.invite.test.ts` + `BusinessTodoToggle.test.ts` = **0 lines**. All three green in the final run (115/115 across 7 suites). |
| SC-9 | BrandEditView :501–539 untouched | **PASS (3-way + runtime)** | (1) origin/main lines 501–539 found **byte-identical** in branch file (python verbatim search, at new line 561); (2) `diff -U0` hunk map: changed old-side lines {24,463,542,573,634,656,688} + pure insertions — none in 501–539; (3) CI gate asserts no anchor in the block; (4) runtime: PHYSICAL LOCATION toggle renders intact between photo and ABOUT (`SC10_bogus_section.png`). |
| SC-10 | `?section=bogus` / absent → top, no crash, no scroll | **PASS (proven)** | Cold deep link `...edit?section=bogus` → page at top, photo card first, no crash (`SC10_bogus_section.png`). Unit: closed-set validator (implementor T-9 + source-contract). |

## 2. Findings

**P2-1 — Tagline-only save on a bio-less brand vanishes the WRONG row (pre-existing data model, exposed by this feature).**
- Evidence: fresh brand, tap "Add a tagline", type, save → return: count 10→9 but "Describe your brand" vanished and "Add a tagline" persisted (`T12_qa_after_save.png`); DB shows `description = "QA tagline for ORCH-1256"` (single paragraph). Root cause `brandMapping.ts:159–181`: `joinBrandDescription(t, undefined)` returns bare `t`; `splitBrandDescription` maps a single paragraph to **bio** — a tagline-only brand is unrepresentable. Both functions predate ORCH-1256 and brandMapping is DO-NOT-TOUCH for this ORCH; the spec ratified the derive-side semantics (§4.1 F-7 note) but its own T-12 wording conflicts on this one path.
- Impact: on a fresh brand the user's first tagline-only save clears the description row instead; self-healing (once description is filled, tagline saves round-trip correctly — proven by save #2), monotonic (count always decreases), no data loss beyond the tagline→bio reclassification.
- Required fix: follow-up ORCH (forensics): either make tagline-only representable (join/split rule change — program-wide blast into every description consumer) or merge tagline+description into ONE "Tell your story" to-do row when both empty. NOT implementor rework — out of the §12 allowlist.
- Retest: fresh brand → tagline-only save → tagline row vanishes.

**P2-2 — Profile rows not gated on edit permission; non-owner hits RLS deny only at save.**
- Evidence: reviewer user is `event_manager` on "Smoke & Rhythm" (brand_team_members verified); rows render, deep-link works, save fails with generic "Couldn't save. Tap Save to try again." (RLS UPDATE deny — correct authorization, poor surfacing). Pre-existing: the edit page itself was already reachable for non-owners; band 6 now advertises it from Home/Hub.
- Impact: managers get to-dos they cannot complete. Required fix (follow-up): gate band 6 on an editable-role check or surface a permission-specific error. Retest: event_manager brand → no profile rows (or role-aware messaging).

**P4-1 (note, test-infra)** — Maestro synthetic taps do not fire the kit `Button` (Save/Continue variants) on this build; `idb ui tap` (real HID) fires them instantly — "Couldn't save…" toast proved the handler fires (no dead tap). To-do rows (plain Pressable) fire fine under Maestro. Sim-driving recipe: use idb for kit Buttons.
**P4-2 (note, env)** — Worktree symlinked `node_modules` breaks Metro lazy imports (posthog/ATT/google-fonts unresolved; brand-creation slug check hung). Real `npm ci` in the worktree fixed all of it — reconfirms `reference_ota_from_worktree_needs_real_npm_ci` for plain dev-Metro testing too.
**P4-3 (praise)** — Loading-gate truthfulness held in every observed frame; vanish-on-save is instant via the existing invalidation path; single `isBlank` predicate + local `SOCIAL_TODO_KEYS` mirror with sync comment is clean, drift-resistant work.

## 3. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- Test: `mingla-business/src/utils/__tests__/businessTodos.profile.test.ts` (commit 4ef5d8b1f). At HEAD: 14/14 pass.
- Revert: true line-deletion of the entire band-6 block (`businessTodos.ts` lines 289–369) at b343fe144's code → `Tests: 11 failed, 3 passed, 14 total` (T-1/T-1b/T-2 + all 8 T-3 rows failed). Restore via `git checkout --` → 14/14 pass. **fails-on-revert verified at b343fe144.**

## 4. Tester adversarial test (different angle)

- Path: `mingla-business/src/utils/__tests__/businessTodos.profile.orch1256.tester.test.ts` — commit **d4610c9a4** (`ORCH-1256(tester): …`), 28 tests.
- Angles (all distinct from the implementor's happy-path suites): (A) Unicode-whitespace predicate bypass — NBSP/ideographic/figure space/BOM/LS/PS must read EMPTY; U+200B boundary pinned as FILLED; (B) false-positive invariant END-TO-END — whitespace-padded real content in every field → zero `profile_*` rows through derive→build, and all-false profile output deep-equal to no-profile output; (C) socials permutation matrix — each of 8 networks alone suppresses; whitespace-only network does not; `links.custom` ignored alone and combined; (D) `contact: {}` / `links: {}` / `custom: []` container shapes; (E) degraded-state leak — profile supplied during hasNoBrands/hasBrandsButNoSelection/brandResolving leaks zero rows; (F) absent + explicitly-undefined profile → no profile ids, no `?section=` anywhere.
- Fails-on-revert (verified at b343fe144): `.trim()` dropped from `isBlank` → 9 failed/28; band-6 line-deleted → 2 failed/28; restored → 28/28.
- Both the implementor's tests and this file appear in `git diff origin/main...HEAD --name-only`.

## 5. Constitution (14 rules)

1 No dead taps — PASS (rows fire on device; Save fires via HID, P4-1 is driver-side) · 2 One owner per truth — PASS (single `isBlank`; ordering owned by builder) · 3 No silent failures — PASS (save errors toast; derivation pure) · 4 Query-key factory — N/A (no new queries) · 5 Server state server-side — PASS (no Zustand writes) · 6 Logout clears — N/A (untouched) · 7 TRANSITIONAL labels — PASS (none added) · 8 Subtract before adding — PASS (band appended; zero UI redesign) · 9 No fabricated data — PASS (rows derive from the real record) · 10 Currency-aware — N/A · 11 One auth instance — PASS (untouched) · 12 Validate at right time — N/A · 13 Exclusion consistency — PASS (`links.custom` exclusion consistent + documented + gate-locked) · 14 `_hasHydrated` startup — PASS (`!isBrandResolving` guard; SC-6 frames).

## 6. Device / parity matrix

| Surface | Result |
|---------|--------|
| Business iOS (sim, iPhone 17 Pro Max, fresh Debug build of THIS branch + worktree Metro) | **PASS — proven** (T-10 ×4 sections, T-11, T-12, SC-6 frames, SC-10) |
| Business Web (worktree Metro RN-web, headless Chromium 430×900) | **PASS — proven** (rows render, socials deep-link scroll, zero console errors on Home/edit; `web_11/12` evidence) |
| Business Android | SKIPPED — dispatch scoped runtime to iOS sim + web; no Android business dev build exists this session; parity automatic (shared RN), unit+gate coverage identical |
| Consumer iOS / Consumer Android / Buyer anon web / Admin web | N/A — feature does not ship there (spec §3) |
| Physical iPhone (HITL) | Not requested by dispatch; no physical-device-specific risk identified (no keyboard/hardware paths) |

Build/runtime notes: sim dev build was stale (predated `expo-image-manipulator`, Jun 12) — rebuilt from this worktree via the runbook (prebuild + pod install + xcodebuild + manual embed/sign; workspace is now `MinglaBusiness`, not `minglabusiness`). Metro required `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…` + `MINGLA_STRIPE_MODE=live` (backend handshake is live-mode; the pk_test sandbox fallback fail-closes — correct guard, local-dev gotcha). Tester-owned Metro on :8081 left running for smoke-testing (safe to kill; no other session owned that port — verified before start).

## 7. Regression sweep

- Existing to-do rows: `create_brand` (brandless), venue row (physical brand), offering + Stripe rows (fresh brand) all present, correctly ordered BEFORE profile rows; badges/copy untouched (unit suites unmodified + runtime screenshots).
- BrandEditView normal editing: open → edit → save → toast → auto-back → data persisted (QA brand, DB-verified). Danger-Zone delete flow intact (used for cleanup).
- ORCH-1255 boundary: byte-identical (SC-9, 3-way + runtime).
- CI gate: PASS + self-test 10/10; workflow diff is pure append (1 registry comment + 1 job, zero deletions). tsc: 870 baseline error lines, ZERO in any ORCH-1256 file (incl. the tester test).

## 8. Discoveries for Orchestrator

- **D-1:** Brands list fetch fails on the FIRST load after reviewer sign-in (iOS switcher "Couldn't load your brands.", web same + "We couldn't load your brand data" toast); recovers on cold restart / reload. Smells like residual ORCH-1251/1254 token-attach territory on the reviewer bypass path. Evidence `08_create_brand_sheet.png`, `web_06_home_brand.png`.
- **D-2:** Direct URL load of `/brand/{id}/edit` on web shows "Brand not found" until the brands cache populates (route resolves brand via `useBrandList()` with no own fetch/loading state) — pre-existing; affects any shared/bookmarked edit deep link on web (`web_13_bogus.png`).
- **D-3:** Memory note "Mingla Stripe still TEST mode end-to-end" is stale — the prod handshake now reports live-mode and rejects pk_test clients.
- **D-4:** P2-1 and P2-2 above (follow-up ORCH candidates).
- **Cleanup:** test brand "ORCH-1256 QA 702" created via UI and deleted via Danger Zone (soft-deleted, `deleted_at` set — DB-verified). "Smoke & Rhythm" untouched except no-op (its failed save persisted nothing; DB-verified). No migrations, no deploys, no OTA, no other sessions' processes touched.

## 9. Step-0.5 citations (verbatim, for the orchestrator)

(a) Implementor happy-path: `mingla-business/src/utils/__tests__/businessTodos.profile.test.ts` — 14/14 passing; independently re-ran the revert proof: band-6 line-deletion → `Tests: 11 failed, 3 passed, 14 total`; restore → `Tests: 14 passed, 14 total`. **fails-on-revert verified at b343fe144.**
(b) Tester adversarial: `mingla-business/src/utils/__tests__/businessTodos.profile.orch1256.tester.test.ts` (commit d4610c9a4) — attacks Unicode-whitespace predicate bypass, the end-to-end false-positive invariant (whitespace-padded content through derive→build), socials permutations incl. `links.custom`, empty-container shapes, degraded-state row leaks, and absent-input backward compat; own fails-on-revert: trim-drop → 9 failed/28, band-6 deletion → 2 failed/28, restore → 28/28.
