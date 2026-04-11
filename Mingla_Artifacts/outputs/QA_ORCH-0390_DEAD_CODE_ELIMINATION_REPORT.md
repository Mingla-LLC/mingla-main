# QA Report: Dead Code Elimination (ORCH-0390)

> Tester: Mingla Tester
> Date: 2026-04-11
> Mode: TARGETED (Orchestrator dispatch)

---

## Verdict: PASS

P0: 0 | P1: 0 | P2: 0 | P3: 1 | P4: 2

---

## Test Results

### SC-1: No broken imports in mobile app — PASS

Searched entire `app-mobile/` for import references to all 13 deleted files:

| Deleted File | Search Pattern | Matches | Result |
|---|---|---|---|
| aiSummaryService.ts | `aiSummaryService` | 0 | PASS |
| personalizedCardsService.ts | `personalizedCardsService` | 0 | PASS |
| useRealtimeSession.ts | `useRealtimeSession` | 0 | PASS |
| animations.ts | `from.*\/animations` | 0 | PASS |
| BoardPreferencesForm.tsx | `BoardPreferencesForm` | 0 | PASS |
| InviteCodeDisplay.tsx | `InviteCodeDisplay` | 0 | PASS |
| InviteLinkShare.tsx | `InviteLinkShare` | 0 | PASS |
| InviteMethodSelector.tsx | `InviteMethodSelector` | 0 | PASS |
| QRCodeDisplay.tsx | `QRCodeDisplay` | 0 | PASS |
| FriendSelectionModal.tsx | `FriendSelectionModal` | 0 | PASS |
| LanguagePickerModal.tsx | `LanguagePickerModal` | 0 | PASS |
| PersonCuratedCard.tsx | `PersonCuratedCard` | 0 | PASS |
| SingleCardDisplay.tsx | `SingleCardDisplay` | 0 | PASS |

**FriendSelectionModal disambiguation**: Confirmed zero matches anywhere in the codebase. No second file with a similar name exists. Safe.

**Dynamic imports**: Searched `import(...)` patterns for all deleted names — zero matches. No lazy loading references.

### SC-2: No broken imports for removed exports — PASS

| Removed Export | Matches in Code | Matches in Docs Only | Result |
|---|---|---|---|
| `shuffleArray` | 0 | 0 | PASS |
| `canAccessCuratedCards` | 0 | 1 (spec artifact) | PASS |
| `canSetCustomStartingPoint` | 0 | 1 (spec artifact) | PASS |
| `canPair` (word-boundary) | 0 | 3 (spec/forensic artifacts) | PASS |

Doc references are in historical ORCH-0372 spec/forensic reports — descriptive, not executable. No code breakage.

### SC-3: TypeScript compiles clean — PASS

```
cd app-mobile && npx tsc --noEmit
(exit code 0, zero output)
```

Zero errors, zero warnings.

### SC-4: Living file exports still work — PASS

**cardConverters.ts** — 4 remaining exports, all imported:

| Export | Imported By | Result |
|---|---|---|
| `normalizeDateTime` | RecommendationsContext, OnboardingFlow, useDeckCards, deckService | PASS |
| `roundRobinInterleave` | deckService | PASS |
| `curatedToRecommendation` | sessionDeckService | PASS |
| `computePrefsHash` | RecommendationsContext, AppHandlers | PASS |

**tierLimits.ts** — 4 remaining exports, all imported:

| Export | Imported By | Result |
|---|---|---|
| `TierLimits` (interface) | useFeatureGate | PASS |
| `TIER_LIMITS` (const) | (used by getTierLimits internally) | PASS |
| `getTierLimits` | SwipeableCards, useFeatureGate | PASS |
| `getSessionLimit` | useSessionCreationGate | PASS |

### SC-5: Edge function deletion safety — PASS

| Deleted Function | Code Invoke Matches | Doc-Only Matches | Result |
|---|---|---|---|
| `admin-feedback` | 0 (mobile), 0 (admin) | 4 (README) | PASS |
| `get-google-maps-key` | 0 (mobile), 0 (admin) | 1 (README) | PASS |
| `search-users` | 0 (mobile), 0 (admin) | 2 (README, World Map) | PASS |
| `backfill-place-websites` | 0 (mobile), 0 (admin) | 1 (README) | PASS |

No code invocations found. README references are stale documentation (see P3-1 below).

### SC-6: Migration is valid SQL — PASS

File: `supabase/migrations/20260411200001_drop_dead_rpc_functions.sql`

- Uses `DROP FUNCTION IF EXISTS` — safe, won't error if already gone: **PASS**
- Drops exactly 3 functions: `cleanup_old_location_history`, `cleanup_stale_impressions`, `cleanup_stale_presence`: **PASS**
- Does NOT drop `cleanup_expired_places_cache` (already dropped in 20260315000004): **PASS**
- Comment block explains provenance of each function: **PASS**

### SC-7: Comment cleanup correctness — PASS

| File | Check | Result |
|---|---|---|
| ShareModal.tsx:36 | Dead `useAppState` comment removed. Line now shows `const { t } = useTranslation(...)`. Functional code intact. | PASS |
| OnboardingFlow.tsx:22 | Clean informational comment: `// WhatsAppLogo: available from './ui/BrandIcons' if needed for OTP channel UI`. Not a broken import. | PASS |
| NavigationContext.tsx:55-65 | Three stubs with underscore-prefixed params (`_experienceId`, `_boardId`, `_sessionId`) and honest comments (`// Stub — requires stack navigation (not yet built)`). Compiles clean. | PASS |

---

## Regression Checks

### R-1: Card deck imports resolve — PASS

All 6 files importing from `cardConverters.ts` verified:
- `RecommendationsContext.tsx` — imports `computePrefsHash`, `normalizeDateTime`
- `AppHandlers.tsx` — imports `computePrefsHash`
- `OnboardingFlow.tsx` — imports `normalizeDateTime`
- `useDeckCards.ts` — imports `normalizeDateTime`
- `deckService.ts` — imports `normalizeDateTime`, `roundRobinInterleave`, `curatedToRecommendation`
- `sessionDeckService.ts` — imports `curatedToRecommendation`

### R-2: Tier gating imports resolve — PASS

All 3 files importing from `tierLimits.ts` verified:
- `SwipeableCards.tsx` — imports `getTierLimits`
- `useFeatureGate.ts` — imports `getTierLimits`, `TierLimits`
- `useSessionCreationGate.ts` — imports `getSessionLimit`

### R-3: Board components still exist — PASS

10 active board components remain in `app-mobile/src/components/board/`:
- BoardDiscussionTab.tsx, BoardSettingsDropdown.tsx, BoardTabs.tsx
- CardDiscussionModal.tsx, CardTagPopover.tsx, InviteParticipantsModal.tsx
- ManageBoardModal.tsx, MentionPopover.tsx, ParticipantAvatars.tsx
- SwipeableSessionCards.tsx

### R-4: Share modal intact — PASS

`ShareModal.tsx` imports section clean (lines 1-15). Component exports correctly. Dead comment removed without collateral damage.

### R-5: Onboarding intact — PASS

`OnboardingFlow.tsx` imports section clean (lines 1-50). No dangling references. WhatsApp comment is informational only. All functional imports resolve.

---

## Findings

### P3-1: Stale README references to deleted edge functions

**File**: `README.md` (root) and `app-mobile/README.md`

The root README still lists these deleted edge functions:
- `backfill-place-websites` (line 354)
- `search-users` (line 361)
- `get-google-maps-key` (line 395)

And `app-mobile/README.md` still documents `admin-feedback` (lines 60, 105, 212-213).

**Impact**: Documentation misleads readers into thinking these functions exist. Not a runtime issue.

**Fix**: Remove these entries from both READMEs during the documentation truth sweep (ORCH-0390 Phase 2).

### P4-1: Clean deletion execution (praise)

All 17 file deletions were genuinely dead. Zero false positives in the final verified set. The two-pass approach (initial scan → cross-repo verification) prevented 32 false positives from the edge function list. Disciplined methodology.

### P4-2: Living file surgery was precise (praise)

`cardConverters.ts` and `tierLimits.ts` had dead exports cleanly removed without damaging the 8 live exports. No accidental whitespace, no dangling commas, no broken JSDoc chains. TypeScript compiles clean on first try.

---

## Constitutional Compliance

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No UI changes |
| 2 | One owner per truth | N/A | No state changes |
| 3 | No silent failures | N/A | No error handling changes |
| 4 | One key per entity | N/A | No query key changes |
| 5 | Server state server-side | N/A | No state changes |
| 6 | Logout clears everything | N/A | No auth changes |
| 7 | Label temporary | N/A | No temporary code added |
| 8 | Subtract before adding | PASS | This IS a subtraction-only change |
| 9 | No fabricated data | N/A | No data changes |
| 10 | Currency-aware | N/A | No currency changes |
| 11 | One auth instance | N/A | No auth changes |
| 12 | Validate at right time | N/A | No validation changes |
| 13 | Exclusion consistency | N/A | No exclusion changes |
| 14 | Persisted-state startup | N/A | No persistence changes |

---

## Discoveries for Orchestrator

1. **README stale references** (P3-1) — 4 deleted edge functions still listed in READMEs. Queue for documentation truth sweep.
2. **ORCH-0080 in World Map** references `search-users` edge function which is now deleted. The World Map entry should be updated to reflect that the function was removed as dead code (the feature was never built).
