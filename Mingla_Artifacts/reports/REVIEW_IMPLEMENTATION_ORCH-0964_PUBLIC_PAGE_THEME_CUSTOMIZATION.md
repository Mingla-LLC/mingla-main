# IMPLEMENTATION REVIEW — ORCH-0964 [Public-page theme customization + consumer-app brand screen + deep links]

**Reviewed by:** Claude `mingla-orchestrator` (REVIEW mode, "take over" execution posture)
**Reviewed:** 2026-05-26
**Implementor:** Codex `implementor-mingla` (parallel session)
**Verdict:** **NEEDS WORK — substantive implementation good, procedural gates fail. Two specific Codex actions required before APPROVED.**

## Verdict at a glance

| Gate | Status | Detail |
|---|---|---|
| Commit-hash verification (DEC-179) | **FAIL — hard block** | All 53 product-code changes UNCOMMITTED at branch HEAD `69b4e375f`. Implementation report itself untracked. |
| Step 0.5 fails-on-revert verification (ORCH-0840) | **FAIL — hard block** | Implementation report line 93 explicitly states "Fails-on-revert verification is not fully completed yet." |
| Hard guard G1 — no `events.theme` JSONB theme keys | **PASS** | Grep zero violations. Typed columns only. |
| Hard guard G2 — no business root theme provider | **PASS** | `mingla-business/app/_layout.tsx` registers fonts only; no `ThemeProvider`, no `resolveTheme`, no `ResolvedTheme`. |
| Hard guard G3 — no `brands.kind` branching | **PASS** | Zero `isTripBrand`, `brand.kind`, `brand_kind`, `b.kind` in shared `packages/brand-rendering/PublicBrandPage.tsx` or `mingla-business/.../PublicBrandPage.tsx` adapter. |
| Hard guard G4 — no `mingla-business/src` imports inside `packages/brand-rendering/` | **PASS** | Grep zero violations. Self-contained per Amendment 2 §1.A. |
| Hard guard G5 — no edge-function redeploys | **PASS** | `git status supabase/functions/` shows zero modifications. META-ORCH-0972 Sub-D function bumps untouched. |
| Hard guard G6 — META-ORCH-0972 data-driven tabs preserved | **PASS** | `packages/brand-rendering/PublicBrandPage.tsx` tab labels: Upcoming / Events / Trips / Experiences / About. ExperienceMiniCard included in package per Amendment 3 §2 Action 2. |
| Migration shape | **PASS** | `20260729000002_orch_0964_brand_event_theme_columns.sql` — typed columns + CHECK whitelists (14 fonts, 10 animations, hex regex) + view recreations preserving META-ORCH-0972 column shape minus `b.kind`. NULL-safe; no pre-flight probe needed. |
| Migration timestamp collision scan | **PASS** | `20260729000002` is +1 from META-ORCH-0972's `20260729000001`. No collision with other in-flight worktrees. |
| Package extraction (Amendment 2 §1.A) | **PASS** | `packages/brand-rendering/` scaffolded with PublicBrandPage + designTokens + index + types + tsconfig + package.json. `packages/theme-animations/` scaffolded with README + index + lottie dir. Original `mingla-business/src/components/brand/PublicBrandPage.tsx` converted to thin adapter (per implementation report line 22). |
| Consumer-app screen (Amendment 2 §1.B) | **PASS with note** | Two routes created: `app-mobile/app/brand/[slug].tsx` (canonical) AND `app-mobile/app/b/[slug].tsx` (deep-link target matching AASA path). Amendment 2 specified only the `/brand/[slug]` route; the `/b/[slug]` mirror is reasonable but underspecified. Verify both render the same screen via the same hook + props — flagged as P3 below. |
| Universal Links / App Links (Amendment 2 §1.D) | **PARTIAL** | iOS Associated Domains + Android intent filters added to `app-mobile/app.json`. `mingla-business/public/.well-known/apple-app-site-association` extended with `/b/*` + `/e/*` paths and consumer iOS app ID `782KVMY869.com.sethogieva.minglabusiness` (Apple Team ID + bundle ID resolved autonomously). **Android `assetlinks.json` NOT extended — SHA256 fingerprint blocker per Codex report line 107.** **`usemingla.com` host placement unresolved per Codex report line 108.** |
| 6 new strict-grep CI gates | **PASS** | All 6 ORCH-0964 gate scripts created in `.github/scripts/strict-grep/`: `orch-0964-{brand-rendering-self-contained,checkout-no-brand-theme,theme-foreground-computed,theme-resolver-canonical,theme-typed-columns,well-known-json-content-type}.mjs`. Workflow YAML modified to register jobs. |
| ORCH-0863 backend allowlist | **PASS** | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` updated to include the new migration per `feedback_close_commit_precommit_checks.md`. |
| META-ORCH-0972 data-driven-tabs gate retargeted | **PASS** | Per implementation report line 38, the META-ORCH-0972 gate now points at `packages/brand-rendering/PublicBrandPage.tsx` when the shared package exists — preserves the invariant after the package move. |
| Type checking | **CONDITIONAL** | Codex reports full `tsc --noEmit` red on broader repo debt (NOT ORCH-0964-specific files per implementation report line 84). Targeted resolver test passes. App-mobile shared-package module resolution noise needs follow-up but doesn't block this REVIEW — same broader-repo-debt pattern accepted at ORCH-0950 CLOSE. |

## Findings classified

### P0 — Hard blockers (must clear before APPROVED)

**F-01 — DEC-179 commit-hash verification failure.** All implementation work sits as `M` / `??` in working tree at branch HEAD `69b4e375f` (top-of-branch commit is SPEC Amendment 3, not implementation). The DEC-179 protocol explicitly states "if `git status` shows the file as modified-but-uncommitted, verdict is NEEDS WORK. No 'I'll commit it after review' path." 53 product files + 6 new strict-grep scripts + the implementation report + the migration file all need to land in commits on the per-ORCH branch before REVIEW can promote. **Recommended commit segmentation** (operator may chain to Codex):
- Commit A: migration `supabase/migrations/20260729000002_orch_0964_brand_event_theme_columns.sql` + ORCH-0863 allowlist + 6 strict-grep gates + workflow YAML.
- Commit B: `packages/brand-rendering/` + `packages/theme-animations/` + the `mingla-business/src/components/brand/PublicBrandPage.tsx` adapter conversion + `packages/event-rendering/` theme additions.
- Commit C: `mingla-business/` theme write paths (BrandEditView + EditPublishedScreen + brandMapping + businessEvents + publicEventsService + draftEventStore + liveEventStore + types/brand + liveEventAdapter + ThemeEditorSection).
- Commit D: `app-mobile/` (app.json + app/_layout.tsx + metro.config.js + tsconfig + package.json + new routes + new hooks + theme + ExpandedBusinessEventSheet brand-tap + font registration).
- Commit E: `mingla-business/public/.well-known/apple-app-site-association` extension + business-side app config.
- Commit F: implementation report + Step 0.5 test (after F-02 resolution).

**F-02 — Step 0.5 fails-on-revert verification missing.** Implementation report line 93 admits: *"Fails-on-revert verification is not fully completed yet."* Per ORCH-0840 enforcement, CLOSE will REJECT without this. Codex must:
1. Revert `packages/event-rendering/themeResolver.ts` (or the equivalent file) to pre-fix state at a known commit hash.
2. Run `npx jest mingla-business/src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand`.
3. Confirm the test FAILS on at least one assertion (proving it exercises the contract).
4. Restore the resolver to fixed state. Re-run and confirm PASS.
5. Record both commit hashes in implementation report Step 0.5 section with the `fails-on-revert verified at <commit hash>` phrase verbatim.

### P1 — High (must clear before TEST)

**F-03 — Android `assetlinks.json` not extended.** Production Android keystore SHA256 fingerprint blocker per Codex report line 107. Without this, the App Link path for Android won't resolve and SC-17 (Android cold-start deep link) will FAIL at TEST. Operator-input gap — surface to Seth.

**F-04 — `usemingla.com` `.well-known/` host placement unresolved.** Codex report line 108 — only `business.usemingla.com` AASA is wired today. If brand-share URLs ever point at `usemingla.com/b/<slug>` (marketing root rather than business subdomain), those links will browser-fallback even with the app installed. Operator-input gap.

### P3 — Low

**F-05 — Double-route pattern undocumented.** Codex created BOTH `app-mobile/app/brand/[slug].tsx` (canonical, per Amendment 2 §1.B) AND `app-mobile/app/b/[slug].tsx` (mirror matching AASA path). The mirror is reasonable because Universal Links target `/b/*`, but Amendment 2 specified only the `/brand/[slug]` route. Verify in next commit: both routes mount the same screen via the same hook with no divergent logic. If yes, mention in implementation report addendum. If they diverge, that's a P1.

### P4 — Observation (no action needed)

**F-06 — Apple Team ID + iOS bundle ID resolved autonomously.** Codex pulled `782KVMY869.com.sethogieva.minglabusiness` from existing `app-mobile/app.json` and wired AASA correctly. Closes one of the three operator-input items without operator burden. Good initiative.

**F-07 — META-ORCH-0972 data-driven-tabs gate retargeting handled correctly.** Codex updated the gate to follow the file when it moved into the shared package. Preserves the invariant cleanly.

**F-08 — Type checking noise is broader repo debt, not ORCH-0964 specific.** Same pattern accepted at ORCH-0950 CLOSE; not a block.

## Dependency walk (DEC-179)

Config-layer files touched, with consumer-compatibility assessment:

| File | Change | Consumer impact |
|---|---|---|
| `app-mobile/app.json` | Added `ios.associatedDomains` + `android.intentFilters` for `/b/*` | Native rebuild required (config bakes into Info.plist + AndroidManifest.xml). Codex flagged in report line 109. |
| `app-mobile/app/_layout.tsx` | Font registration via `useFonts` (no theme provider) | Cold-start font hydration ~500ms acceptable per SPEC §4.4. |
| `app-mobile/metro.config.js` | Likely workspace resolution updates for new packages | Implementor verification needed at commit; flag if non-additive. |
| `app-mobile/tsconfig.json` | Likely `paths` for new packages | Verify additive only. |
| `app-mobile/package.json` + `package-lock.json` | New deps: `lottie-react-native`, 14 `@expo-google-fonts/*` packages | Native rebuild required. Codex flagged report line 109. |
| `mingla-business/app/_layout.tsx` | Font registration only, no theme provider | Per G2 verification — clean. |
| `mingla-business/metro.config.js` + `tsconfig.json` + `package.json` + `package-lock.json` | Workspace resolution for new packages + new deps | Verify at commit. |
| `.github/workflows/strict-grep-mingla-business.yml` | Added 6 new ORCH-0964 gate jobs | Append-only per `feedback_strict_grep_registry_pattern.md`. Verified clean. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Backend allowlist updated for new migration | Compliant with `feedback_close_commit_precommit_checks.md`. |
| `mingla-business/public/.well-known/apple-app-site-association` | Added `/b/*` + `/e/*` paths + consumer iOS app ID | Vercel deploy required + Content-Type must remain `application/json` (enforced by new `orch-0964-well-known-json-content-type.mjs` gate). |

## What's good (worth surfacing)

- **All 6 hard guards CLEAN.** Implementation respects every architectural constraint set by the SPEC + Amendments 1/2/3.
- **Amendment 3 fully absorbed.** Data-driven tabs preserved, ExperienceMiniCard included in package, no `brand.kind` reads, META-ORCH-0972 invariants honored.
- **Workspace extraction pattern matches `packages/event-rendering/`** precedent. Thin adapter at original location. Self-contained imports.
- **Migration shape is conservative.** All columns NULL-safe with `ADD COLUMN IF NOT EXISTS`, CHECK constraints inside `DO $$ ... IF NOT EXISTS` guards. Re-runnable. No pre-flight probe risk.
- **CI gates created upfront** (not deferred). 6 new gates plus retargeting of one existing META-ORCH-0972 gate.
- **Codex was honest about gaps.** Self-flagged the Step 0.5 fails-on-revert miss, the Android SHA, and the usemingla.com host — three items I would have caught at REVIEW are pre-acknowledged in the report.

## Decision tree

| Outcome | Path |
|---|---|
| If Codex addresses F-01 + F-02 in this session | Re-REVIEW (this artifact updates to APPROVED), then operator runs migration, orchestrator verifies remote + `.well-known/` Content-Type, dispatch to Claude `mingla-tester` for 4-device matrix. |
| If F-03 + F-04 remain open through TEST | Tester returns CONDITIONAL PASS with Android deep-link verification + `usemingla.com` host explicitly deferred. CLOSE may proceed under operator-accepted condition (precedent: ORCH-0954, ORCH-0961). |
| If F-01 + F-02 are not addressed | CLOSE protocol Step 0.5 + DEC-179 will both REJECT regardless of TEST verdict. Hard block. |

## Verdict

**NEEDS WORK** — return to Codex `implementor-mingla` with these two specific actions:

1. **Commit all 53 product-code changes + report + migration + gates in scoped commits on `ORCH-0964-public-page-theme-customization` branch.** Suggested segmentation in F-01.
2. **Capture fails-on-revert proof for `themeResolver.orch_0964.test.ts`.** Add to implementation report Step 0.5 section.

After both: re-dispatch to orchestrator for final REVIEW. Expected to flip to APPROVED unless something surprising surfaces in the actual commits.

F-03 + F-04 do NOT block REVIEW promotion — they're TEST-phase concerns the orchestrator will manage via operator unblock when Seth has the SHA + host decision in hand.
