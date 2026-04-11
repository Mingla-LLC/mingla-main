# Investigation Report: ORCH-0368 — Bad Merge Artifact Audit

> Confidence: **HIGH** — all 88 files scanned with multiple detection methods
> Date: 2026-04-10
> Investigator: Forensics

---

## Executive Summary

The bad merge corruption was **isolated to a single file**: `MessageInterface.tsx`. All other 87 files touched by merges `d043c6a9` and `e394d1b8` are clean. No duplicate hooks, imports, const declarations, or style properties were found anywhere else in `app-mobile/`, `mingla-admin/`, or `supabase/`. The fix in commit `8bc694c6` resolved the only instance of corruption.

---

## Methodology

Four detection passes were run against the full file set:

| Pass | What It Scanned | Scope | Hits |
|------|----------------|-------|------|
| 1 — Consecutive duplicate lines | All lines with length > 3, excluding whitespace | All 88 files | 5 candidates → all false positives (legitimate nesting) |
| 2 — Duplicate import statements | Adjacent identical `import` lines | All 47 app-mobile TS/TSX files | 0 |
| 3 — Duplicate hook calls | Adjacent identical `useRef`, `useState`, `useCallback`, `useMemo`, `useEffect`, `useQuery`, `useMutation`, `useAppLayout`, `useKeyboard` | All 47 app-mobile TS/TSX files | 0 |
| 4 — Duplicate const declarations | Adjacent identical `const` lines | All 47 app-mobile TS/TSX files | 0 |
| 5 — Duplicate style properties | Adjacent identical `padding*`, `margin*`, `border*`, `fontSize`, `backgroundColor` | All TS/TSX files in app-mobile/src | 0 |
| 6 — Admin + supabase scan | All lines with length > 15 | 8 admin pages + all edge function index.ts + shared libs | 0 |

## False Positives Analyzed

| File | Line | Content | Verdict |
|------|------|---------|---------|
| DiscoverScreen.tsx:3708-3709 | `</View>` × 2 | **Legitimate** — closes two nested Views (coach-mark ref wrapper + flex:1 inner) opened at lines 3569-3570 |
| SwipeableCards.tsx:241-242 | `new Animated.Value(0)` × 2 | **Legitimate** — array initializer for 3-dot pulse animation `[Value(0), Value(0), Value(0)]` |
| SwipeableCards.tsx:1345-1346 | `}` × 2 | **Legitimate** — closes `if (isBoardSession)` then closes outer `else` block (non-curated path) |
| SwipeableCards.tsx:1789-1790 | `</View>` × 2 | **Legitimate** — closes `cardDetails` View then closes `cardInner` View |
| admin-seed-map-strangers:111-112 | `null,` × 2 | **Legitimate** — two separate null parameters in a function call |

## Corruption Summary

| Severity | Count | Files |
|----------|-------|-------|
| CRITICAL (duplicate hooks) | 0 | — (was 1: MessageInterface.tsx, already fixed) |
| HIGH (duplicate imports/consts) | 0 | — (was 1: MessageInterface.tsx, already fixed) |
| MEDIUM (duplicate style props) | 0 | — (was 1: MessageInterface.tsx, already fixed) |
| LOW (duplicate comments) | 0 | — |
| **Total remaining** | **0** | **All clean** |

## Files Confirmed Clean (87 of 88)

All files listed in the dispatch prompt have been scanned and confirmed free of merge artifacts. `MessageInterface.tsx` (the 88th file) was already fixed in commit `8bc694c6`.

## Root Cause of the Corruption

The merge `e394d1b8` ("Merge origin/dev into Seth") added exactly 10 duplicate lines to `MessageInterface.tsx`. The `dev` branch likely had changes to this file that conflicted with the `Seth` branch. During conflict resolution, lines were duplicated rather than merged. This is a common git merge resolution error where the developer accepts "both" sides of a conflict that contain the same code.

The earlier merge `d043c6a9` ("fixed merge conflict") touched 88 files but did NOT introduce duplicates — only `e394d1b8` did, and only in one file.

## Recommendation

**No further action needed.** The single corrupted file is already fixed. The audit confirms the damage was contained. Consider adding a pre-commit hook or CI lint step that detects consecutive duplicate non-trivial lines as a prevention measure.
