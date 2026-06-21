# IMPLEMENTATION — ORCH-1190: Venue Suite Polish Batch (8 items)

**Date:** 2026-06-21 · **Implementor:** mingla-implementor+claude
**Worktree:** `~/Desktop/mingla-orchs/1190-[venue-polish]` · **Branch:** `1190-venue-polish`
**Commit:** `8e8b331de` (single scoped commit) · **Ledger ack:** COMMS-0051 acked on anchor main (`c80933213`)
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1190_VENUE_SUITE_POLISH.md`
**Status:** implemented and verified (source + jest; on-device QA pending Seth)

## 1. Summary

Eight polish fixes to the business-app venue suite (`mingla-business`), all UI-only
— no migrations, no edge functions, no consumer/buyer-web/admin surfaces. Found
after META-ORCH-1186 device QA. Highlights for an end user: every venue module
(Reservations/Waitlist/Menu/Settings) now fills the workspace like Overview/Tables;
the green toggles are now Mingla orange everywhere; "Smart capacity rules" is a
clear tap-to-expand accordion; service periods in Availability are read-only with a
"Edit hours in Settings" jump (no second hours editor); the "Blackout scope" block
and the "More rules are coming…" line are gone; the "Message your guests" button
moved from Settings to the top of Overview; and the cramped mobile table card now
lays out correctly.

## 2. SPEC success-criteria coverage

| Item | What changed | Commit |
|------|--------------|--------|
| #1 Full-width parity | Removed `venueSettingsMaxWidth` cap + isWideDesktop branch from Settings host; all modules share the ORCH-1184 full-width workspace | `8e8b331de` |
| #2 Service periods read-only + redirect | Availability periods read-only ("Pulled from your opening hours"); only affordance routes to Settings hours editor via `venueSuiteStore.selectModule("settings")`; removed Add button / edit Pressable / period handlers / orphaned sheet | `8e8b331de` |
| #3 Toggle color | New shared `ui/BrandSwitch` (accent.warm ON / neutral OFF); all 5 venue Switches routed through it incl. the bare green BrandHoursEditor one | `8e8b331de` |
| #4 Smart capacity → accordion | `VenueCapacityRulesPanel` header restyled to the Home To-do pattern (GlassCard + grid icon + bold title + chevron + LayoutAnimation) | `8e8b331de` |
| #5 Remove copy | Deleted "More rules are coming. These are the 3 we honour today." | `8e8b331de` |
| #6 Remove Blackout scope from Tables | Deleted the blackout_scope info block from the panel; scope selector already lives in `VenueBlackoutSheet` ("Applies to": whole venue / zone / table) | `8e8b331de` |
| #7 Move blast entry | Removed "Reach your guests" section from Settings; added manager-plus "Message your guests" button at top of Overview; reuse-only `buildComposeAudienceHref("brand", brandId)` | `8e8b331de` |
| #8 Mobile table card | Moved row layout off GlassCard wrapper to inner `tableRow` View; card `width:100%` + `minWidth:0` on flex children → text wraps instead of one-char-per-line | `8e8b331de` |

## 3. Files changed (12; +440 / −480)

- `mingla-business/src/components/ui/BrandSwitch.tsx` — NEW shared brand switch.
- `mingla-business/src/components/venue/VenueSettingsModule.tsx` — #1 (cap removal), #3 (BrandSwitch ×2), #7 (blast section removed).
- `mingla-business/src/components/venue/VenueIntelligenceModule.tsx` — #7 (blast button at top of Overview).
- `mingla-business/src/components/venue/VenueAvailabilityModule.tsx` — #2 (read-only periods + Settings redirect).
- `mingla-business/src/components/venue/VenueCapacityRulesPanel.tsx` — #3, #4 (accordion), #5 (copy), #6 (blackout block).
- `mingla-business/src/components/venue/VenueTablesModule.tsx` — #8 (card layout).
- `mingla-business/src/components/venue/VenueTableSheet.tsx` — #3 (BrandSwitch).
- `mingla-business/src/components/venue/MenuItemSheet.tsx` — #3 (BrandSwitch).
- `mingla-business/src/components/venue/BrandHoursEditor.tsx` — #3 (BrandSwitch; fixes the green toggle).
- `mingla-business/src/components/venue/VenueServicePeriodSheet.tsx` — DELETED (orphaned after #2).
- `mingla-business/src/components/venue/__tests__/venueSuitePolish.orch1190.test.ts` — NEW (18 assertions, all 8 items).
- `mingla-business/src/components/venue/__tests__/venueSettingsModule.orch1186d.blastEntry.render.tsx` — MODIFIED (retargeted: blast row left Settings) — `[TEST-MOD-APPROVED ORCH-1190]`.

## 4. Data-model changes

None. No migrations, no columns, no RLS.

## 5. Edge functions touched

None.

## 6. Regression tests

- **Happy-path:** `mingla-business/src/components/venue/__tests__/venueSuitePolish.orch1190.test.ts` — 18 source-text assertions (runs under the default node/ts-jest config, no RTL required — same pattern as the existing ORCH-1184/1186-A implementor tests). **18 passed.**
- **fails-on-revert verified at `8e8b331de`** — proven by TRUE LINE DELETION / re-introduction of each fix (automated script). Each revert flips exactly one item's assertion to FAIL; final restore is 18/18 green:
  - #1 (re-add maxWidth) → 1 failed · #2 (re-add add-period) → 1 failed · #3 (bare `<Switch` back) → 1 failed · #4 (remove grid icon) → 1 failed · #5 (footnote copy back) → 1 failed · #6 (blackout_scope back) → 1 failed · #7 (Settings blast back) → 1 failed · #8 (delete width:100%) → 1 failed · final restore → 18 passed.
- The tester writes a second, adversarial (mounted-render) test on the blast relocation + toggle color + table-card layout.

## 7. Old → New receipts (per surface)

### VenueSettingsModule.tsx
- **Before:** host capped to `venueSettingsMaxWidth` (720) on wide desktop; rendered a "Reach your guests / Message your guests" Section; reservation + fee toggles were raw `<Switch>`.
- **Now:** host fills full width (cap + isWideDesktop branch + import removed); blast Section + `handleBlast` + `buildComposeAudienceHref` import removed; both toggles use `BrandSwitch`.
- **Why:** #1, #3, #7. **Lines:** ~77 changed.

### VenueIntelligenceModule.tsx
- **Before:** no blast affordance.
- **Now:** manager-plus-gated "Message your guests" button at the top of the populated dashboard, reuse-only deep-link via `buildComposeAudienceHref("brand", brandId)`.
- **Why:** #7. **Lines:** ~42 added.

### VenueAvailabilityModule.tsx
- **Before:** Service periods had an "Add" button, tappable rows opening `VenueServicePeriodSheet` (add/edit/delete hours inline).
- **Now:** periods are read-only ("Pulled from your opening hours"); the only affordance is "Edit hours in Settings" → `venueSuiteStore.selectModule("settings")`; period handlers + sheet mount removed.
- **Why:** #2 (single hours owner). **Lines:** ~103 changed.

### VenueCapacityRulesPanel.tsx
- **Before:** subtle uppercase-caption header; rendered a blackout_scope info block + a "More rules are coming…" footnote; raw `<Switch>`.
- **Now:** GlassCard accordion with grid icon + bold title + chevron + LayoutAnimation; blackout_scope block + footnote removed; `BrandSwitch`.
- **Why:** #3, #4, #5, #6. **Lines:** ~88 changed.

### VenueTablesModule.tsx
- **Before:** `tableCard` carried `flexDirection:row` on the GlassCard wrapper (whose single clipped child shrank to min-content → one-char-per-line text on narrow widths).
- **Now:** row layout on an inner `tableRow` View; card `width:100%`; `minWidth:0` on `tableMain`/`tableText`.
- **Why:** #8. **Lines:** ~80 changed.

### VenueTableSheet.tsx / MenuItemSheet.tsx / BrandHoursEditor.tsx
- **Before:** raw `<Switch>` (BrandHoursEditor set NO trackColor → native green).
- **Now:** `BrandSwitch`. **Why:** #3.

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---------|----------|-------|
| Business iOS | YES | Venue suite UI; parity automatic (shared RN code). |
| Business Android | YES | Same shared code; GlassCard handles opaque fallback; BrandSwitch trackColor honored. |
| Business Web (preview) | YES | #1 full-width + #8 card layout are most visible on web. |
| Consumer iOS / Android | NO | Venue suite is business-only management UI. |
| Buyer/anonymous Web | NO | Not a buyer surface. |
| Admin Web | NO | Different app. |

Parity is AUTOMATIC across the three business surfaces (one RN codebase). No manual mirroring.

## 9. Smoke result

Not run on device/sim (no native build cut). Verified by jest + source assertions:
- `venueSuitePolish.orch1190` — 18/18 pass; fails-on-revert proven per item.
- Full `src/components/venue/__tests__` — 113 jest tests pass (the one failing suite is the pre-existing ORCH-1184 *adversarial render* test, which can't compile without the worktree-local RTL config + `@testing-library/react-native` provision — environmental, not a regression).
- `tsc --noEmit` — zero errors in any touched source file (remaining tsc errors are pre-existing, in unrelated checkout/marketing/search/payments files + RTL-missing test files).
- Strict-grep gates green: `orch-1186-hours-single-owner`, `orch-1148-no-buyer-tax-form-in-venue-settings`, `orch-1130-no-buyer-tax-form`, `orch-1148-booking-core-engine-and-money-seam`, `orch-1148-reserve-sheet-gate-mirrors-button`, `i-biz-venue-input-uses-mapbox`, `i-curated-hours-via-canonical-reader`, `orch-1186c-menu-display-only`, `orch-1186c-menu-not-experience-stops`, `orch-0768-brand-audience-identity-honesty`, `orch-0815-b-composer-and-send`, `orch-0864-composer-v2`, `orch-1105-web-glass-opaque-fallback`.
- `composeAudienceHref` roundtrip test — 4/4 pass.
- Append-only check — PASS (TEST-MOD override token recognized; both test files visible in the closing diff vs origin/main).

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- The ORCH-1184 adversarial RENDER test (`venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx`, NOT mine) fails to compile in this worktree only because `@testing-library/react-native` isn't provisioned — same condition as the existing 1186-D render config. Unchanged by this ORCH; CI runs it under its own render config. No action needed from me.
- `VenueServicePeriodSheet.tsx` deleted (subtract-before-adding) — it was orphaned by #2 and contradicted the single-hours-owner rule. No remaining references.

## 11. Operator action required

- **Migration `db push`:** none.
- **Edge-function deploy:** none.
- **Build/OTA:** pure-JS RN change → ship via `eas update` on the business channel at CLOSE (no native build needed). Business iOS/Android/web all covered by one OTA.
- Orchestrator owns REVIEW → tester dispatch → device QA → merge/OTA/CLOSE.

## 12. Discoveries for Orchestrator

1. **No shared toggle component existed** before this ORCH — every Switch hand-repeated (or omitted) the trackColor trio. `ui/BrandSwitch` is now the single owner for the venue suite. Other surfaces still use raw `<Switch>` with the right trackColor (trip/groupChat) — they render orange already, so not in scope, but a future sweep could route them through `BrandSwitch` for one owner app-wide.
2. **The green toggle root cause** was specifically `BrandHoursEditor.tsx`'s day-open Switch having NO `trackColor` (native green), not a "shared component" — the SPEC framed it as shared; there was none. Fixed at the source + unified.
3. **Item #6's scope selector was already present** in `VenueBlackoutSheet` ("Applies to") — only the redundant Tables-page info block needed removal; no new add-flow code required.
