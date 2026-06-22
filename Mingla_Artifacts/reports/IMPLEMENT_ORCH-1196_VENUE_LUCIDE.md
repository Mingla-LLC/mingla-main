# IMPLEMENTATION — ORCH-1196 [venue suite → lucide icons]

**Status:** implemented and verified (type-clean + regression green + fails-on-revert proven).
**Worktree:** `~/Desktop/mingla-orchs/1196-[venue-lucide-icons]` on branch `1196-venue-lucide-icons`.
**Commit:** `991ffb0379bdd76117bfb08a32917fb70497f38a`.
**Pure-JS** — no migration, no edge function. Web ships via Vercel; native rides the next business build (COMMS-0052 OTA hold).

---

## 1. Summary

The venue suite rendered its glyphs through the hand-rolled custom `Icon` component
(`mingla-business/src/components/ui/Icon.tsx`, hand-rolled SVG) plus one literal 🍽️ empty-state
emoji in `VenueMenuModule`. ORCH-1196 converts every venue-suite custom `<Icon name=...>` usage
and that emoji to `lucide-react-native` (already a dependency, used by the Ari surface + ORCH-1174
pills), for brand consistency. Sizes, colors, and a11y intent are preserved exactly — only the
glyph rendering path changes.

`ui/Icon.tsx` is untouched (it keeps serving its other app-wide consumers). The rest of the app was
not migrated. `VenueCreatorWizard`'s `IconChrome` is a shared glass-button primitive (it composes
the custom Icon internally) and is intentionally out of scope — converting it would change a
shared component beyond the venue suite.

## 2. SPEC success-criteria coverage

| SC | Description | Status | Evidence (commit `991ffb0`) |
|----|-------------|--------|------|
| SC-1 | Every venue custom `<Icon name>` → lucide equivalent | ✓ | grep: 0 `<Icon ` in `components/venue/*.tsx`; 0 `from "../ui/Icon"` |
| SC-2 | 🍽️ emoji → lucide `UtensilsCrossed` | ✓ | `VenueMenuModule.tsx` now renders `<UtensilsCrossed size={34} …>`; grep: 0 `🍽` |
| SC-3 | Sizes + colors preserved exactly | ✓ | each swap kept the prior `size=` / `color=` literal (receipts §7) |
| SC-4 | lucide exports verified to exist | ✓ | all 13 names resolved in `node_modules/lucide-react-native/dist/esm/icons/` |
| SC-5 | Venue modules typecheck | ✓ | `tsc --noEmit`: 0 errors in venue production source (pre-existing test-dep + cross-package errors only) |
| SC-6 | Regression test (import-lucide / no-Icon / no-emoji), fails-on-revert | ✓ | `venueLucideIcons.orch1196.test.ts` 11/11 pass; fails-on-revert verified |
| SC-7 | `ui/Icon.tsx` untouched; no app-wide migration | ✓ | diff scope = `components/venue/` only |

## 3. Files changed

```
mingla-business/src/components/venue/ReservationCard.tsx           4 +-
mingla-business/src/components/venue/VenueAvailabilityModule.tsx   4 +-
mingla-business/src/components/venue/VenueCapacityRulesPanel.tsx  10 +-
mingla-business/src/components/venue/VenueIntelligenceModule.tsx   4 +-
mingla-business/src/components/venue/VenueListingContent.tsx       4 +-
mingla-business/src/components/venue/VenueMenuModule.tsx          10 +-
mingla-business/src/components/venue/VenueModuleComingSoon.tsx    21 +-
mingla-business/src/components/venue/VenueReservationsModule.tsx   4 +-
mingla-business/src/components/venue/VenueTablesModule.tsx         6 +-
mingla-business/src/components/venue/VenueWaitlistModule.tsx       8 +-
mingla-business/src/components/venue/__tests__/venueLucideIcons.orch1196.test.ts  +78 (new)
mingla-business/src/components/venue/__tests__/venueSuitePolish.orch1190.test.ts   8 +- (TEST-MOD-APPROVED)
```

## 4. Data-model changes applied

None. No migration, no schema, no RLS.

## 5. Edge functions touched

None.

## 6. Regression tests added

- **New:** `mingla-business/src/components/venue/__tests__/venueLucideIcons.orch1196.test.ts` — 11 cases.
  Asserts each of the 9 converted files imports `lucide-react-native`, no longer imports `../ui/Icon`,
  no longer renders `<Icon `; that `VenueMenuModule` renders `UtensilsCrossed` and contains no 🍽️ emoji;
  and that `VenueModuleComingSoon`'s `MODULE_ICON` map now holds lucide component refs.
- **fails-on-revert verified at `991ffb0`:** deleted the `Calendar` lucide import and re-added
  `<Icon name="calendar" …>` in `VenueReservationsModule.tsx` (true line deletion, not comment-out) →
  the suite reported `1 failed, 10 passed`. Restored the fix → `11 passed`.
- Adjacent suite `venueSuitePolish.orch1190.test.ts` updated (see §10) and re-run → `18 passed`.
- Full venue jest run: `124 passed, 124 total`; 3 `.render.test.tsx` suites fail to *load* on
  missing `@testing-library/react-native` / `react-dom/server` types (env-only — those deps are not
  installed in this worktree's node_modules; 0 test cases failed). Pre-existing, unrelated.

## 7. Old → New receipts (icons swapped)

| File | Before (custom Icon / emoji) | After (lucide) | size/color preserved |
|------|------------------------------|----------------|----------------------|
| ReservationCard.tsx | `Icon name="chevR"` | `ChevronRight` | 18 / textTokens.tertiary |
| VenueCapacityRulesPanel.tsx | `Icon name="grid"`; `Icon name={open ? "chevU" : "chevD"}` | `LayoutGrid`; conditional `ChevronUp`/`ChevronDown` | 16 / accent.warm; 18 / textTokens.secondary |
| VenueAvailabilityModule.tsx | `Icon name="chevR"` | `ChevronRight` | 18 / textTokens.tertiary |
| VenueListingContent.tsx | `Icon name="arrowL"` | `ArrowLeft` | 22 / textTokens.primary |
| VenueReservationsModule.tsx | `Icon name="calendar"` | `Calendar` | 26 / textTokens.primary |
| VenueTablesModule.tsx | `Icon name="grid"`; `Icon name="chevR"` | `LayoutGrid`; `ChevronRight` | 28 / textTokens.primary; 18 / textTokens.tertiary |
| VenueIntelligenceModule.tsx | `Icon name="flag"` | `Flag` | 24 / semantic.error |
| VenueWaitlistModule.tsx | `clock`; `sms`; `close` | `Clock`; `MessageSquare`; `X` | 26 / textTokens.primary; 15 / #0c0e12; 15 / textTokens.tertiary |
| VenueModuleComingSoon.tsx | dynamic `MODULE_ICON: Record<…, IconName>` of name strings, rendered `Icon name={MODULE_ICON[module]}` | `Record<…, LucideIcon>` of refs (`LayoutGrid`/`Calendar`/`List`/`Clock`), rendered `<ModuleIcon size={28} …>` | 28 / textTokens.primary |
| VenueMenuModule.tsx | `<Text style={emptyEmoji}>🍽️</Text>` (fontSize 34) | `<View style={emptyEmoji}><UtensilsCrossed size={34} color={textTokens.primary} /></View>` (style → centered View) | 34 / textTokens.primary |

**lucide-name resolutions (all exports verified present):** calendar→`Calendar`, clock→`Clock`,
grid→`LayoutGrid`, flag→`Flag`, sms→`MessageSquare`, close→`X`, arrowL→`ArrowLeft`,
chevR→`ChevronRight`, emoji→`UtensilsCrossed`. **Additional names found in venue source beyond the
task map and resolved the same way:** chevU→`ChevronUp`, chevD→`ChevronDown` (the capacity-panel
accordion toggle), and `list`→`List` (in the `VenueModuleComingSoon` MODULE_ICON map, reservations
module).

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Business iOS | Yes | venue-suite glyphs render via lucide; parity automatic (shared `mingla-business/src`). Rides next native build. |
| Business Android | Yes | same shared code; same. |
| Business Web preview (adjacent) | Yes | same shared code; ships via Vercel. |
| Buyer/anonymous Web | No | venue suite is an authenticated business-operator surface, not a buyer route. |
| Consumer iOS | No | `app-mobile` untouched. |
| Consumer Android | No | `app-mobile` untouched. |
| Admin Web (adjacent) | No | `mingla-admin` untouched. |

Parity is automatic — one shared RN codebase across business iOS/Android/Web preview.

## 9. Smoke result

No sim/device run (env: business iOS build is team-wide blocked per COMMS-0030, and venue UX is an
operator surface). Verified by: lucide-export existence check (filesystem), `tsc --noEmit` clean on
venue production source, and the source-level regression test (11/11) + the updated ORCH-1190
suite (18/18). Visual smoke deferred to the next business native build (the glyphs are 1:1 size/color
swaps so visual risk is minimal).

## 10. Known issues / deferred

- **`venueSuitePolish.orch1190.test.ts` modify-with-deletion (`[TEST-MOD-APPROVED ORCH-1196]`):**
  that suite's case #4 asserted the OLD source strings `Icon name="grid"` and
  `Icon name={open ? "chevU" : "chevD"}` in `VenueCapacityRulesPanel`. My conversion makes those
  literal matches stale. I updated the two assertion lines to the lucide equivalents
  (`<LayoutGrid size={16}`, conditional `<ChevronUp`/`<ChevronDown size={18}`), preserving the test's
  intent (icon + chevron + bold-title cluster). Cited `[TEST-MOD-APPROVED ORCH-1196]` in the commit
  body per the append-only CI gate.
- **`emptyEmoji` style** in `VenueMenuModule` changed from `{ fontSize: 34 }` (a TextStyle prop,
  invalid on the new View wrapper) to `{ alignItems: "center", justifyContent: "center" }`; the
  glyph size moved onto the lucide `size={34}` prop. Visual size unchanged.

## 11. Operator action required

- None for deploy from this skill. Pure-JS; **no OTA** (COMMS-0052 business-app OTA hold in force).
- Route back to orchestrator for REVIEW → tester dispatch. The change ships on the next business
  native build alongside the queued ORCH-1190 / META-ORCH-1186 / META-ORCH-1187 work.
- No migration `db push`, no edge-fn deploy.

## 12. Discoveries for Orchestrator

- **ORCH-ID collision on 1196:** a sibling worktree `~/Desktop/mingla-orchs/ORCH-1196-[api-health-hub]`
  also carries the bare number 1196. This venue-lucide work used the `1196-venue-lucide-icons` branch
  (no on-disk file overlap — different domains). Flag for a discriminator like prior 1185/1186/1165
  collisions (COMMS-0045/0049/0051).
- **`IconChrome` (shared) still composes the custom `Icon`** (`ui/IconChrome.tsx:41`). If the goal is
  to fully retire the hand-rolled `Icon.tsx`, a follow-on ORCH would need to migrate `IconChrome` and
  its app-wide consumers (out of scope here — that's not venue-suite-only).
- **Comms acks:** COMMS-0052 (BLOCK, business OTA hold) is acknowledged — this skill does not OTA, and
  the work is pure-JS riding the next native build, fully compatible. COMMS-0051 (WARN, META-ORCH-1186
  venue-unify bookkeeping) acknowledged — no migration in this ORCH so the version-prefix-collision
  note does not apply. acked_by appends deferred to the orchestrator's ledger maintenance to avoid a
  concurrent-write race on the actively-moving shared anchor.
