# IMPLEMENTOR DISPATCH — ORCH-0964 [Public-page theme customization + consumer-app brand screen + deep links]

**Dispatched:** 2026-05-25 by Claude `mingla-orchestrator` (SPEC REVIEW APPROVED `744057a83` / `9c43d157b` / `777ec9828`)
**Target skill:** Claude `mingla-implementor` (operator confirms or redirects to Codex `implementor-mingla`)
**Severity:** S2-medium
**Effort budget:** ~13–14 implementation days
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/`
**Branch:** `ORCH-0964-public-page-theme-customization`

---

## Goal

Build brand-owner-controllable public-page theming (single hex color + preset font + entrance animation) across buyer-web, consumer iOS, consumer Android, AND a new consumer-app brand profile screen, with Universal Link / App Link deep-link support so URLs open in the app when installed.

## Binding contract — READ ALL THREE

The contract is the SPEC + 2 amendments. They are cumulative — read in order:

1. `Mingla_Artifacts/specs/SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` — base contract (DB columns, resolver, edit UI, 15 success criteria, 4 new invariants)
2. `Mingla_Artifacts/specs/SPEC_ORCH-0964_AMENDMENT_POST_0961_0962_0963.md` — factors in ORCH-0961/0962/0963 closes (view-layer updates, kind-branched IA awareness, `hideFloatingChrome` coexistence)
3. `Mingla_Artifacts/specs/SPEC_ORCH-0964_AMENDMENT_2_CONSUMER_BRAND_SCREEN_AND_DEEP_LINKS.md` — adds the shared `packages/brand-rendering/` package, the consumer-app `/brand/[slug]` screen, the event-sheet tap entry point, and Universal/App Links

Supporting evidence: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` + `REVIEW_SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md`.

## Implementation order — 16 steps

Per Amendment 2 §6, executed in this exact order:

0. **Rebase per-ORCH branch onto `origin/main`** (~34 commits behind). `cd ~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization] && git fetch origin main && git rebase origin/main`. Conflicts most likely in `WORLD_MAP.md` + `WORKTREE_REGISTRY.md` — resolve by accepting main and re-applying ORCH-0964's INTAKE entry on top. Re-read PublicBrandPage.tsx, packages/event-rendering/PublicEventPage.tsx, types.ts, publicEventsService.ts AFTER rebase.
1. DB migration — typed columns on brands + events with CHECK constraints + view updates per Amendment 1 §3.
2. Create `packages/brand-rendering/` workspace package (scaffold).
3. Move `PublicBrandPage` + `TripMiniCard` + `NextEventTeaser` + `EventMiniCard` primitives from `mingla-business/src/components/brand/` into `packages/brand-rendering/`. Convert original location to thin adapter. Verify ORCH-0962 + ORCH-0963 tests still pass after import-path updates.
4. Wire theme prop into shared `packages/brand-rendering/PublicBrandPage.tsx` per original SPEC §4.7.
5. Wire theme prop into shared `packages/event-rendering/PublicEventPage.tsx` (coexists with `hideFloatingChrome` per Amendment 1 §5).
6. Create `packages/theme-animations/` with 9 Lottie JSON files + 14 `@expo-google-fonts/*` deps registered in both apps' root layouts.
7. Extend buyer-web hooks `usePublicBrandBySlug` + `usePublicEventBySlug` to read theme columns + call `resolveTheme()`.
8. Create consumer-app hook `app-mobile/src/hooks/useBrandBySlug.ts` + route `app-mobile/app/brand/[slug].tsx`.
9. Add event-sheet brand-identity tap target in `ExpandedBusinessEventSheet.tsx` → navigates to `/brand/<slug>`.
10. Universal/App Link config: `app-mobile/app.json` `associatedDomains` + `intentFilters`.
11. Universal/App Link files: `.well-known/apple-app-site-association` + `.well-known/assetlinks.json` deployed via Vercel. **ASK OPERATOR which Vercel project hosts which domain before adding to a repo.** Configure `vercel.json` Content-Type as `application/json`.
12. Theme Editor UI: `mingla-business/src/components/theme/ThemeEditorSection.tsx` + mounts in BrandEditView + event-edit screen.
13. Service-layer write paths: extend brand-update + event-update patches with theme columns. NEVER route through `events.theme` JSONB.
14. CI gates — 6 new strict-grep gates total (4 from original SPEC §6 + 2 from Amendment 2 §4) + extend `orch-0962-brand-field-map-coverage.mjs` expected-field list.
15. Step 0.5 regression tests — implementor happy-path + tester adversarial. Implementor writes happy-path; tester writes adversarial at TEST phase.
16. Native rebuild for both apps via `eas build` — Lottie + fonts + new route + universal links are config-layer changes, NOT OTA-compatible.

## Hard guards — DO NOT (14 total, cumulative)

From original SPEC §10 + Amendment 1 §9 + Amendment 2 §7:

1. DO NOT add theme keys to `events.theme` JSONB. Typed columns ONLY.
2. DO NOT mount any theme provider at `mingla-business/app/_layout.tsx` (would leak to checkout).
3. DO NOT import `lottie-react-native` from `mingla-admin/`.
4. DO NOT disable `useNativeDriver` on Lottie animations.
5. DO NOT skip `eas build` and try to ship via OTA.
6. DO NOT widen consumer-app theming surface beyond shared `PublicEventPage` + new brand screen.
7. DO NOT invoke `/ui-ux-pro-max` skill before writing `ThemeEditorSection.tsx` — required pre-flight per `feedback_implementor_uses_ui_ux_pro_max.md`.
8. DO NOT remove or weaken the `isTripBrand` kind-branching.
9. DO NOT apply theme to `TripMiniCard.bookingsClosed` or `EventMiniCard.soldOut` badges.
10. DO NOT mount entrance animation per-mini-card on brand page — once per session above tabs.
11. DO NOT touch the ORCH-0961 `hideFloatingChrome` opt-out path — theme is additive.
12. DO NOT leave any imports from `mingla-business/src/` inside `packages/brand-rendering/*` after the move.
13. DO NOT ship `.well-known/` files with `Content-Type: text/plain` — iOS Universal Links fail silently.
14. DO NOT touch ORCH-0961/0962/0963 ACTIVE invariants — preserve `I-PROPOSED-BRAND-FIELD-MAP-COVERAGE`, `I-PUBLIC-BRAND-KIND-BRANCHED`, `I-PROPOSED-HOME-MOBILE-LOCK-PANE`.

## Operator inputs needed mid-implementation

Implementor should ask in chat when these come up — not block:

- Which Vercel project hosts `usemingla.com` vs `business.usemingla.com`? Needed for `.well-known/` file repo location.
- Production Android keystore SHA256 fingerprint (Google Play Console → app integrity).
- Apple Team ID + iOS bundle identifier (likely readable from `app-mobile/app.json`; confirm).
- Confirm which 6–10 font weight subset within the 14 fonts to bundle (`@expo-google-fonts/inter/Inter_400Regular` etc. — Amendment 1 §5 candidate table shows ~3 weights per font as default; operator may want to narrow).

## Success criteria — 23 total

Original SPEC §5: SC-1..SC-15. Amendment 2 §3 adds SC-16..SC-23. All must verify at TEST phase.

## Expected outputs

1. **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` — full evidence trail per `feedback_close_commit_precommit_checks.md` + Step 0.5 happy-path test with `fails-on-revert verified at <commit>` proof.
2. **Migration apply command** reproduced verbatim for operator: `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && /Users/sethogieva/bin/supabase db push --linked`.
3. **6 new CI gate scripts** in `.github/scripts/strict-grep/` + workflow job registrations.
4. **Native rebuild artifacts** — `eas build` queue IDs for both apps.

## Downstream routing

After implementor return:
- Claude `mingla-orchestrator` REVIEW (commit-hash + dependency walk + scope sanity).
- Operator `supabase db push --linked`.
- Orchestrator verifies migration on remote (`mcp__supabase__list_migrations`).
- Orchestrator confirms no edge function deploys needed (none expected).
- Orchestrator verifies `.well-known/` files via `curl -I` (Content-Type check).
- Claude `mingla-tester` TEST with 4-device matrix: buyer-web Chromium + iOS sim + Android emu + operator's physical iPhone (Universal Link real-device verification SC-23).
- Claude `mingla-orchestrator` CLOSE with Vercel `[deploy]` tag (touches `mingla-business/src/` + `packages/` + new admin/marketing repo for .well-known) + EAS update or new native build artifact link.

## Pre-flight reminders

- `/ui-ux-pro-max` skill invocation REQUIRED before writing `ThemeEditorSection.tsx` (per `feedback_implementor_uses_ui_ux_pro_max.md`).
- Comms ledger: read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry. COMMS-0005 [ORCH-0963 overlap warning] is OPEN; this dispatch RESOLVES it on close — append ack.
- Stripe-best-practices skill: NOT required (no Stripe surface).
- External API docs (COMMS-0003): NOT required (no external API surface introduced).
- Migration timestamp: scan `~/Desktop/mingla-orchs/*/supabase/migrations/` for collisions; pick max + 1 second.
