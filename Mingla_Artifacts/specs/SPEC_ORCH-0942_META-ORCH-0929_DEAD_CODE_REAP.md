# SPEC — ORCH-0942 [META-ORCH-0929 dead-code reap — CollabSessionChatBanners + InChatDeckSheet + orphan banners + obsolete ORCH-0918 gates/tests]

**Date:** 2026-05-23
**Status:** SPEC READY for IMPLEMENT dispatch
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` at HEAD `4b967630`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` (READ FIRST — this spec is bound by its Verified-Dead and Verified-Alive registers and the 2 P0 orchestrator-hypothesis corrections)
**Operator directive:** chat surface exposes ONLY `Matches` / `Swipe` / `Plans` sub-tab pills; everything else dies.
**Severity:** P2 (no user-visible impact, but real tech debt + an unwireable strict-grep gate that would FAIL HARD if re-installed in CI; META-ORCH-0929 left the cleanup incomplete)

---

## §1 — Scope (ruthlessly specific)

### IN scope (the only things this SPEC ships)

1. Delete 3 dead exports + 1 dead helper inside `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`:
   - `CollabSessionChatBanners` function (lines 612-712)
   - `InChatDeckSheet` function (lines 511-606)
   - `BannerRow` helper (lines 255-296)
   - The corresponding `useSessionDeckMountStore` import (line 35) and `RecommendationsProvider` import (verified used only by dead `InChatDeckSheet`)
   - All style-block entries referenced only by deleted functions (audit method below at §3.1.3)
2. Delete 1 dead Zustand store + 1 test file:
   - `app-mobile/src/store/sessionDeckMountStore.ts` (whole file)
   - `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` (whole file — append-only override required)
3. Delete 3 dead CI/test files referencing dead JSX:
   - `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs`
   - `app-mobile/scripts/ci/orch-0918-regression-check.mjs`
   - `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs`
4. Delete 1 dead test file:
   - `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx` (whole file — append-only override required)
5. Remove 1 dead `package.json` script:
   - `app-mobile/package.json` line 56: `"test:orch-0918": "node ./scripts/ci/orch-0918-regression-check.mjs"`
6. Add `DEC-164` to `Mingla_Artifacts/DECISION_LOG.md` explicitly documenting the decommission of `CollabSessionChatBanners` + `InChatDeckSheet` + `useSessionDeckMountStore` per ORCH-0942 (supersession by META-ORCH-0929).

### NON-goals (explicit OUT-of-scope)

1. **DO NOT touch `app-mobile/src/components/MessageInterface.tsx`** — its 3-action dispatcher + 3 sheet mounts at lines 1162-1173, 2183, 2201, 2212 are the canonical end-state and must remain byte-identical.
2. **DO NOT touch `app-mobile/src/components/connections/CollabDeckSheet.tsx`** — Swipe sub-tab target, just-PASSed Retest 4.
3. **DO NOT delete `CompactCollabBottomSheet`** (CollabSessionChatBanners.tsx lines 297-371) — orchestrator hypothesis P0-1 correction: it has 2 live consumers (`ScheduleSheet` line 381, `SavedToSessionCardsSheet` line 479). KEEP.
4. **DO NOT delete `ScheduleSheet`, `SavedToSessionCardsSheet`, `useSessionSavedCardsForSheet`, `SavedSessionCard` interface** — all four are live consumers of MessageInterface.
5. **DO NOT delete `app-mobile/src/hooks/useSessionScheduledCards.ts`** — live consumer at MessageInterface.tsx:315.
6. **DO NOT delete `app-mobile/src/components/board/LockedPlanBanner.tsx`** or `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` — alive in unrelated paths.
7. **DO NOT delete `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx`** — tests still-live predicates.
8. **DO NOT delete `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts`** — tests still-live hook logic.
9. **DO NOT modify `Mingla_Artifacts/INVARIANT_REGISTRY.md`** — orchestrator hypothesis P0-2 correction: the 3 ORCH-0918 invariants do not exist in the registry; nothing to deprecate. META-ORCH-0929's 4 invariants at lines 3706, 3720, 3734, 3748 remain untouched and enforced.
10. **DO NOT modify any memory file** — zero memory entries reference the dead architecture (investigation OBS-2).
11. **DO NOT rename `CollabSessionChatBanners.tsx`** — keep the file name to avoid import-path churn. The file stays at the same path; only its dead contents are removed.
12. **DO NOT touch any META-ORCH-0929 strict-grep gate** — 4 gates enforce single-mount discipline and stay alive.
13. **DO NOT touch `.github/workflows/strict-grep-mingla-business.yml`** — confirmed no `orch-0918` wiring exists; nothing to remove there.
14. **DO NOT add new strict-grep CI gates** — META-0929's gates already enforce single-mount; structural deletion makes recurrence impossible.
15. **DO NOT add new invariants** — same reason.
16. **DO NOT add new regression tests** — `orch-0918-message-and-deck-contract.test.tsx` + `orch-0918-session-card-hooks.test.ts` continue to test live behavior; META-0929 has its own test suite. No new test needed.
17. **DO NOT run `supabase db push`** — no migration in scope.
18. **DO NOT deploy any edge function** — no edge function in scope.
19. **DO NOT publish EAS OTA** — no user-visible change; OTA is a wasted operator step.
20. **DO NOT include `[deploy]` tag in commit subject** — mobile-only diff, no Vercel-built surface touched.

### Assumptions

- The investigation's "Verified-Alive Register" is binding: every kept item has a cited live consumer at file:line. If implementor finds a consumer outside that register pointing at a "verified-dead" item, STOP and report — that's an investigation failure to fix BEFORE proceeding.
- Local `tsc --noEmit` continues to pass post-deletion if and only if no live consumer of the deleted symbols slipped through the audit. The investigation manifest covered this — re-verify in implementation.
- The append-only CI gate (`.github/workflows/tests-append-only.yml`) enforces the `[TEST-MOD-APPROVED ORCH-0942]` token grammar; without it, the PR will fail the gate.

---

## §2 — Cross-Surface Impact (MANDATORY, Phase 2.5)

| Surface | Covered? | User-visible behaviour required on this surface | File paths touched | Parity mechanism |
| --- | --- | --- | --- | --- |
| **Consumer iOS** (`app-mobile/` on iOS) | YES | No user-visible behaviour change. The chat-surface end-state (Matches/Swipe/Plans sub-tab pills) is already correct in production per Retest 4 evidence. Deletion is invisible to users. | All paths in §1 IN scope | Automatic (shared RN/JS) |
| **Consumer Android** (`app-mobile/` on Android) | YES | Same as iOS — no user-visible change. | Same as iOS | Automatic (shared RN/JS) |
| **Buyer/anonymous Web** (`mingla-business/` `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}`) | NO | Buyer-anon routes don't expose collab chat — no collab UI surface. |
| **Business iOS** (`mingla-business/` on iOS) | NO | Business app has no consumer collab session surface. |
| **Business Android** (`mingla-business/` on Android) | NO | Business app has no consumer collab session surface. |
| **Admin Web** (`mingla-admin/`) | NO | Admin doesn't render consumer chat or collab sessions. |
| **Business Web preview** (`mingla-business/` dev/web) | NO | No consumer collab surface. |

Parity is automatic. No per-platform SC split required.

---

## §3 — Per-Layer Specification

### §3.1 — Component layer

#### §3.1.1 — `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` (surgical edit)

**File path:** `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`
**Operation:** surgical multi-region delete; file name preserved
**Expected post-edit line count:** ~450 (down from ~840)

**Regions to DELETE (with line ranges current as of HEAD `4b967630`; implementor must verify before mutation):**

| Region | Start–end lines (current) | What it is |
| --- | --- | --- |
| `BannerRow` function | 255-296 | Internal helper — only consumed by dead `CollabSessionChatBanners` |
| `InChatDeckSheet` function | 511-606 | Dead export — single render site is line 703 inside dead `CollabSessionChatBanners` |
| `CollabSessionChatBanners` function | 612-712 | Dead export — zero live JSX render sites |
| Import line for `useSessionDeckMountStore` | line 35 (`import { useSessionDeckMountStore } from "../../store/sessionDeckMountStore";`) | Dead — store is being deleted |
| Import line for `RecommendationsProvider` (if present and used only by dead `InChatDeckSheet`) | verify before delete (search file for `RecommendationsProvider`) | Dead only-if no live consumer remains in the file |
| Import line for `Modal` (verify still needed by `CompactCollabBottomSheet`/`ScheduleSheet`/`SavedToSessionCardsSheet` before delete) | verify before delete | Conditional |
| Import line for `Haptics` (verify still needed by surviving functions) | verify before delete | Conditional |
| Import line for `Icon` (verify still needed by surviving functions) | verify before delete | Conditional |
| Style-block entries used only by deleted functions | per audit method §3.1.3 | Mixed |

**Regions to KEEP (binding):**

| Region | Start–end lines (current) | Why kept |
| --- | --- | --- |
| `SavedSessionCard` interface export | 61-~95 | Type used by `useSessionSavedCardsForSheet` return — consumed by MessageInterface |
| `useSessionSavedCardsForSheet` hook | 99-158 | Live consumer: `MessageInterface.tsx:354` |
| Helper functions `cardTitle`, `cardImage`, `toExpandedCard`, `formatScheduledAt` (lines 77-253 region) | verify | Used by surviving `ScheduleSheet` + `SavedToSessionCardsSheet` (audit consumer chain before assuming) |
| `CompactCollabBottomSheet` function | 297-371 | Live consumer: `ScheduleSheet` line 381 + `SavedToSessionCardsSheet` line 479. **DO NOT DELETE** — orchestrator hypothesis P0-1 correction. |
| `ScheduleSheet` function | 373-448 | Live consumer: `MessageInterface.tsx:2212` |
| `SavedToSessionCardsSheet` function | 450-509 | Live consumer: `MessageInterface.tsx:2201` |

**Top-level import audit (mandatory before commit):**

After deleting the 3 dead functions + `BannerRow`, run a per-symbol audit of every import at the top of the file. For each named import, grep the remaining file body for its identifier. If a named import has zero occurrences in the surviving code, delete the import line. Do NOT use bulk auto-fix tooling that may rename or rewrite identifiers — purely deletion-only audit.

Example audit walk:
- `import { useSessionDeckMountStore }` → used at line 525 (dead) + 630 (dead) → DELETE
- `import { RecommendationsProvider }` → search remaining body → if zero hits, DELETE
- `import { Modal }` → search remaining body → likely still used by `CompactCollabBottomSheet` + `InChatDeckSheet`; after `InChatDeckSheet` delete, verify `CompactCollabBottomSheet` still needs it → KEEP if used
- Continue for every named import.

#### §3.1.2 — Style-block audit method (§ "MEDIUM confidence" point from investigation)

The investigation flagged MEDIUM confidence on which style entries are dead vs alive. Implementor MUST run the following audit before mutating any style entry:

1. After completing the function deletions in §3.1.1, identify the surviving function bodies in `CollabSessionChatBanners.tsx`: `cardTitle`, `cardImage`, `toExpandedCard`, `formatScheduledAt`, `useSessionSavedCardsForSheet`, `CompactCollabBottomSheet`, `ScheduleSheet`, `SavedToSessionCardsSheet`.
2. Run: `grep -oE "styles\.[a-zA-Z_]+" app-mobile/src/components/chat/CollabSessionChatBanners.tsx | sort -u`
3. The output is the **canonical alive style-key set**. Every style-block entry whose key is NOT in this set is dead and must be deleted.
4. **Anticipated DEAD style keys** (per investigation enumeration, MUST verify via step 2 above before deleting):
   - `stack`, `banner`, `iconShell`, `bannerText`, `bannerTitle`, `bannerSubtitle` (used by deleted `BannerRow` + `CollabSessionChatBanners`)
   - `deckSheet`, `deckHeader`, `deckTitle`, `deckBody`, `headerButton` (used by deleted `InChatDeckSheet`)
5. **Anticipated ALIVE style keys** (MUST keep): `loading`, `emptyState`, `emptyText`, `verticalListContent`, `scheduleRow`, plus all keys consumed by `CompactCollabBottomSheet` / `ScheduleSheet` / `SavedToSessionCardsSheet`.
6. After style-block deletion, re-run step 2 to confirm zero `styles.<deletedKey>` references remain. If any survive, the function deletion in §3.1.1 was incomplete or this audit missed a consumer — STOP and investigate.

This audit method makes the MEDIUM-confidence area in the investigation deterministic at implementation time without requiring a separate investigation pass.

#### §3.1.3 — TypeScript verification post-edit

Immediately after the surgical edit, the implementor runs from `app-mobile/`:

```bash
cd /Users/sethogieva/Desktop/mingla-main/app-mobile
npx tsc --noEmit src/components/chat/CollabSessionChatBanners.tsx src/components/MessageInterface.tsx 2>&1 | grep -v "^Found 0 errors"
```

Acceptable outcomes:
- ZERO errors against the deletion target file and `MessageInterface.tsx` (proves no live consumer breakage).
- Pre-existing transitive errors elsewhere in the repo (e.g. `src/i18n/index.ts` JSON imports, `src/services/deckService.ts`) that ALSO exist on `origin/main` are acceptable and documented as pre-existing.

Unacceptable outcomes (FAIL implementation):
- Any new error in `CollabSessionChatBanners.tsx` referring to a deleted symbol.
- Any new error in `MessageInterface.tsx` referring to an import that no longer exports.
- Any new error in another file that imports a deleted export.

### §3.2 — Store layer

#### §3.2.1 — `app-mobile/src/store/sessionDeckMountStore.ts`

**Operation:** DELETE whole file.
**Justification:** Investigation §"Verified-Dead Register" entry 4. Only consumers are inside dead code (CollabSessionChatBanners lines 525 + 630). Zero HomePage / app/index / useAuthSimple references (orchestrator hypothesis cleaner-than-feared).

#### §3.2.2 — `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts`

**Operation:** DELETE whole file.
**Test override:** requires `[TEST-MOD-APPROVED ORCH-0942]` token in CLOSE commit body per `.github/workflows/tests-append-only.yml`.

### §3.3 — CI/strict-grep layer

#### §3.3.1 — `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs`

**Operation:** DELETE whole file.
**Justification:** Investigation §"Verified-Dead Register" entry 5. Workflow yml has zero references to this script; if re-wired, it would FAIL HARD because its primary assertion `(message.match(/<CollabSessionChatBanners/g) ?? []).length === 1` evaluates to `0 === 1 → false` against today's MessageInterface.

#### §3.3.2 — `app-mobile/scripts/ci/orch-0918-regression-check.mjs`

**Operation:** DELETE whole file.
**Justification:** 13 assertions all target dead `<CollabSessionChatBanners` / `<InChatDeckSheet` JSX patterns in MessageInterface that no longer exist post-META-0929.

#### §3.3.3 — `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs`

**Operation:** DELETE whole file.
**Justification:** 16 assertions same root cause.

#### §3.3.4 — `.github/workflows/strict-grep-mingla-business.yml`

**Operation:** NO CHANGE. Confirmed zero `orch-0918` matches via grep at HEAD `4b967630`. Already cleaned by META-ORCH-0929.

### §3.4 — Test layer

#### §3.4.1 — `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx`

**Operation:** DELETE whole file.
**Justification:** Investigation §"Verified-Dead Register" entry 8. `runOrch0918BannerExportFixture` references `InChatDeckSheet` (being deleted) — would error at runtime if kept.
**Test override:** requires `[TEST-MOD-APPROVED ORCH-0942]` token in CLOSE commit body.

#### §3.4.2 — KEEP-files (no operation)

- `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx` — KEEP (tests `isCollabSessionGroupChat` predicate + `sessionIdOverride` resolution — both alive in MessageInterface). Optional cosmetic rename of `runOrch0918*` identifiers to neutral names — implementor may skip if it adds risk.
- `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts` — KEEP (tests `runOrch0918ScheduledOrderingFixture` calendar-sort logic — alive alongside `useSessionScheduledCards`).

### §3.5 — Package layer

#### §3.5.1 — `app-mobile/package.json`

**Operation:** REMOVE line 56:
```json
"test:orch-0918": "node ./scripts/ci/orch-0918-regression-check.mjs"
```
**JSON syntax discipline:** the implementor must also remove the trailing comma from the previous-line entry if `test:orch-0918` was the last script in its block, OR ensure no orphan comma remains in the next entry. Run `npx jsonlint app-mobile/package.json` (or `node -e "JSON.parse(require('fs').readFileSync('app-mobile/package.json'))"`) post-edit to verify valid JSON.

### §3.6 — Documentation layer

#### §3.6.1 — `Mingla_Artifacts/DECISION_LOG.md`

**Operation:** APPEND `DEC-164` entry after the existing `DEC-163` block.

**Exact entry text the implementor inserts:**

```markdown
## DEC-164 — CollabSessionChatBanners + InChatDeckSheet + useSessionDeckMountStore DECOMMISSIONED per ORCH-0942 (2026-05-23)

**Decision:** Delete `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`'s three dead function exports (`CollabSessionChatBanners`, `InChatDeckSheet`, `BannerRow`), the entire `app-mobile/src/store/sessionDeckMountStore.ts` Zustand mutex, the strict-grep script `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs`, the regression + adversarial CI scripts under `app-mobile/scripts/ci/orch-0918-*-check.mjs`, the corresponding `CollabSessionChatBanners.test.tsx` + `sessionDeckMountStore.test.ts` test files, and the dead `test:orch-0918` `package.json` script entry. Keep `ScheduleSheet`, `SavedToSessionCardsSheet`, `useSessionSavedCardsForSheet`, `SavedSessionCard`, and `CompactCollabBottomSheet` — all live consumers of `MessageInterface.tsx`.

**Rationale:** META-ORCH-0929 [Collab decks live in group chat — Home is solo-only] (PR #179) replaced ORCH-0918's banner-row chat-body architecture with a 3-pill chat-header architecture (`Matches` / `Swipe` / `Plans` sub-tabs), but deleted only the `<CollabSessionChatBanners />` JSX render from MessageInterface — leaving the underlying components, hooks, stores, CI scripts, and tests orphaned in the source tree. The strict-grep gate `orch-0918-banners-only-on-session-conv.mjs` would fail hard if ever re-wired in CI because it asserts a JSX render count that has been 0 since 2026-05-23 PR #179. ORCH-0942 completes the META-ORCH-0929 cleanup by removing the orphaned files; no architecture change, no user-visible change.

**Citation:** ORCH-0942 SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`; investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md`. Live-fire confirmation via Retest 4 evidence at `Mingla_Artifacts/reports/evidence/ORCH-0939/retest_4/` (2026-05-23 14:06:59 — 3 sims + operator physical iPhone exercised only the chat-header pill paths, never the dead chat-body banners).

**Enforcement:** No new strict-grep gate required. META-ORCH-0929's existing `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT` invariant + CI gate already enforces single-mount discipline; the structural deletion in ORCH-0942 makes accidental re-introduction impossible because there is no surviving JSX render pattern to copy from.
```

**Insertion position:** immediately after the existing `DEC-163` block in `DECISION_LOG.md`. The implementor reads the current state of `DECISION_LOG.md` to confirm position before insertion.

### §3.7 — Layers NOT touched

| Layer | Status |
| --- | --- |
| Database / Migrations / RLS | N/A — no DB touch |
| Edge functions | N/A — no edge touch |
| Service layer | N/A — no service touch |
| Hook layer | `useSessionScheduledCards` and `useSessionSavedCardsForSheet` both KEPT — no hook touch |
| Realtime | N/A |
| INVARIANT_REGISTRY.md | NO CHANGE — orchestrator hypothesis P0-2 correction (3 expected invariants don't exist) |
| WORLD_MAP.md / MASTER_BUG_LIST.md / PRIORITY_BOARD.md / COVERAGE_MAP.md | NO CHANGE in this SPEC; orchestrator owns these on CLOSE |
| Memory files (`~/.claude/projects/.../memory/`) | NO CHANGE — investigation OBS-2 confirmed zero references to dead architecture |
| EAS OTA | NO PUBLISH — no user-visible change |
| Vercel `[deploy]` tag | NO — mobile-only diff |

---

## §4 — Success Criteria

Each criterion is observable, testable, unambiguous.

| # | Criterion | Verification |
| --- | --- | --- |
| **SC-01** | `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` contains zero references to `CollabSessionChatBanners` (the function name), `InChatDeckSheet`, or `BannerRow` after edit | `grep -nE "function CollabSessionChatBanners\|function InChatDeckSheet\|function BannerRow\|<BannerRow" app-mobile/src/components/chat/CollabSessionChatBanners.tsx` returns 0 lines |
| **SC-02** | `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` still exports `ScheduleSheet`, `SavedToSessionCardsSheet`, `useSessionSavedCardsForSheet`, `SavedSessionCard`, and `CompactCollabBottomSheet` is preserved as internal helper | `grep -nE "^export function (ScheduleSheet\|SavedToSessionCardsSheet\|useSessionSavedCardsForSheet)\|^export interface SavedSessionCard\|^function CompactCollabBottomSheet" app-mobile/src/components/chat/CollabSessionChatBanners.tsx` returns exactly 5 lines |
| **SC-03** | `app-mobile/src/store/sessionDeckMountStore.ts` does not exist | `ls app-mobile/src/store/sessionDeckMountStore.ts 2>&1` returns "No such file or directory" |
| **SC-04** | `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` does not exist | Same |
| **SC-05** | `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` does not exist | Same |
| **SC-06** | `app-mobile/scripts/ci/orch-0918-regression-check.mjs` does not exist | Same |
| **SC-07** | `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs` does not exist | Same |
| **SC-08** | `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx` does not exist | Same |
| **SC-09** | `app-mobile/package.json` does not contain a `test:orch-0918` script entry | `grep -n "test:orch-0918" app-mobile/package.json` returns 0 lines AND `node -e "JSON.parse(require('fs').readFileSync('app-mobile/package.json'))"` exits 0 |
| **SC-10** | `Mingla_Artifacts/DECISION_LOG.md` contains a new `## DEC-164` block referencing ORCH-0942 immediately after `DEC-163` | `grep -nE "^## DEC-16[34]" Mingla_Artifacts/DECISION_LOG.md` returns DEC-163 then DEC-164 in order |
| **SC-11** | `app-mobile/src/components/MessageInterface.tsx` is BYTE-IDENTICAL to its state at HEAD `4b967630` (no incidental edits) | `git diff 4b967630 -- app-mobile/src/components/MessageInterface.tsx` returns empty |
| **SC-12** | `app-mobile/src/components/connections/CollabDeckSheet.tsx` is BYTE-IDENTICAL to HEAD `4b967630` | Same |
| **SC-13** | `Mingla_Artifacts/INVARIANT_REGISTRY.md` is BYTE-IDENTICAL to HEAD `4b967630` | `git diff 4b967630 -- Mingla_Artifacts/INVARIANT_REGISTRY.md` returns empty |
| **SC-14** | No memory file under `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/` is modified | `git status` for that path returns clean (only modified files outside it allowed) |
| **SC-15** | Scoped TypeScript check on the edited file + MessageInterface produces ZERO new errors against `origin/main`'s baseline | `cd app-mobile && npx tsc --noEmit src/components/chat/CollabSessionChatBanners.tsx src/components/MessageInterface.tsx` — pre-existing transitive errors documented in IMPL report; new errors → FAIL |
| **SC-16** | Surviving live regression tests at `orch-0918-message-and-deck-contract.test.tsx` and `orch-0918-session-card-hooks.test.ts` still PASS post-edit | `cd app-mobile && npx tsc src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx src/hooks/__tests__/orch-0918-session-card-hooks.test.ts --target es2020 --module commonjs --jsx react-jsx --esModuleInterop --skipLibCheck --outDir /tmp/orch-0942-keep-tests` then `node /tmp/orch-0942-keep-tests/.../X.js` for each — exit 0 |
| **SC-17** | All META-ORCH-0929 strict-grep gates still PASS post-edit | `node .github/scripts/strict-grep/i-proposed-meta-0929-*.mjs` (each file) — exit 0 |
| **SC-18** | All ORCH-0939 + ORCH-0931 strict-grep gates still PASS post-edit | `node .github/scripts/strict-grep/i-proposed-orch-0939-collab-deck-has-per-session-provider.mjs` AND `node .github/scripts/strict-grep/i-proposed-orch-0931-no-pk-filter-realtime.mjs` — exit 0 |
| **SC-19** | `git status` shows ONLY the files named in §1 IN scope modified, deleted, or added | implementor cites the full `git status --short` output in the IMPL report |
| **SC-20** | No file under `supabase/`, `mingla-business/`, `mingla-admin/`, or `packages/` is modified | `git diff --name-only origin/main -- supabase/ mingla-business/ mingla-admin/ packages/` returns empty (or only pre-existing dirty files not staged) |

---

## §5 — Invariants

### §5.1 — Existing invariants this change must preserve

| Invariant ID | Description | How this change preserves it |
| --- | --- | --- |
| `I-PROPOSED-META-0929-CHOOSER-DISMISS-BEFORE-OPEN` | (INVARIANT_REGISTRY.md line 3706) | UNTOUCHED — strict-grep gate continues to PASS (verified by SC-17) |
| `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT` | (line 3720) — only one collab deck mount allowed | DELETION of `InChatDeckSheet` strengthens this — it removes a potential second mount path that was dead but still in source tree |
| `I-PROPOSED-META-0929-HOME-IS-SOLO-ONLY` | (line 3734) — HomePage cannot pass collab props to SwipeableCards | UNTOUCHED — no HomePage edits |
| `I-PROPOSED-META-0929-NO-GLOBAL-ACTIVE-SESSION` | (line 3748) — no global active-session concept | UNTOUCHED — `useSessionDeckMountStore` is NOT a global active-session concept (it was a single-mount mutex within the dead chain); deletion doesn't affect this invariant |
| `I-PROPOSED-ORCH-0939-COLLAB-DECK-HAS-PER-SESSION-PROVIDER` | per-session RecommendationsProvider wrap on CollabDeckSheet | UNTOUCHED — CollabDeckSheet not edited (SC-12) |
| `I-PROPOSED-ORCH-0931-NO-PK-FILTER-REALTIME` | no PK-filter on postgres_changes realtime listeners | UNTOUCHED |
| Constitution rule #8 (subtract before adding) | When new code lands, dead code dies | THIS CHANGE COMPLETES the META-ORCH-0929 violation of rule #8 — the META added the new architecture without subtracting the old; ORCH-0942 closes the violation |

### §5.2 — New invariants this change establishes

NONE. Structural deletion makes recurrence impossible without resurrecting the deleted code paths — META-ORCH-0929's existing single-mount invariant + gate already enforces against re-introduction.

---

## §6 — Test Cases

Note: This is a deletion-only ORCH. The "tests" verify that nothing live broke and that the deletion is complete. No new product behaviour to test.

| Test | Scenario | Input | Expected | Layer |
| --- | --- | --- | --- | --- |
| **T-01** | Surgical edit completes without TypeScript regression | Run `cd app-mobile && npx tsc --noEmit src/components/chat/CollabSessionChatBanners.tsx src/components/MessageInterface.tsx` | Zero new errors vs `origin/main` baseline; pre-existing transitive errors documented | Component / TypeScript |
| **T-02** | MessageInterface unchanged | `git diff 4b967630 -- app-mobile/src/components/MessageInterface.tsx` | Returns empty | Filesystem |
| **T-03** | CollabDeckSheet unchanged | `git diff 4b967630 -- app-mobile/src/components/connections/CollabDeckSheet.tsx` | Returns empty | Filesystem |
| **T-04** | Surviving in-file exports compile-test | Compile + run `runOrch0918MessagePredicateFixture` test fixture | PASS | Component |
| **T-05** | Surviving in-file hook test compile-run | Compile + run `runOrch0918ScheduledOrderingFixture` | PASS | Hook |
| **T-06** | All deleted files are gone | `find` against the 6 deleted file paths | All return "No such file" | Filesystem |
| **T-07** | All deleted symbols are gone from CollabSessionChatBanners.tsx | grep for `function CollabSessionChatBanners`, `function InChatDeckSheet`, `function BannerRow`, `<BannerRow`, `<InChatDeckSheet`, `<CollabSessionChatBanners` | All return 0 lines | Source |
| **T-08** | All surviving exports still export | grep for `export function ScheduleSheet`, `export function SavedToSessionCardsSheet`, `export function useSessionSavedCardsForSheet`, `export interface SavedSessionCard`, `function CompactCollabBottomSheet` | All return ≥1 line | Source |
| **T-09** | package.json is valid JSON post-edit | `node -e "JSON.parse(require('fs').readFileSync('app-mobile/package.json'))"` | exit 0 | Config |
| **T-10** | DECISION_LOG.md contains DEC-164 | `grep -c "^## DEC-164" Mingla_Artifacts/DECISION_LOG.md` | Returns ≥1 | Documentation |
| **T-11** | INVARIANT_REGISTRY.md untouched | `git diff 4b967630 -- Mingla_Artifacts/INVARIANT_REGISTRY.md` | Returns empty | Filesystem |
| **T-12** | All META-0929 strict-grep gates PASS | Run each `.github/scripts/strict-grep/i-proposed-meta-0929-*.mjs` script | exit 0 | CI |
| **T-13** | ORCH-0939 + ORCH-0931 strict-grep gates PASS | Run both | exit 0 | CI |
| **T-14** | No memory file modified | `git status -- ~/.claude/projects/.../memory/` returns clean | empty | Filesystem |
| **T-15** | No file under supabase/ mingla-business/ mingla-admin/ packages/ modified | `git diff --name-only origin/main -- supabase/ mingla-business/ mingla-admin/ packages/` | empty | Filesystem |
| **T-16** | App still launches on iOS sim post-edit (smoke) | Boot iPhone 17 Pro Max sim (UDID `2C3312D9-EE52-4EBD-9704-15811D49A2EC`), relaunch app, navigate to Friends → Testing stuff → tap Swipe sub-tab pill | CollabDeckSheet opens (black background, "Testing stuff" header) — no JS exception, no missing module error | Runtime |
| **T-17** | Matches sub-tab still works post-edit (smoke) | Same sim, tap Matches sub-tab pill | SavedToSessionCardsSheet opens with the live data | Runtime |
| **T-18** | Plans sub-tab still works post-edit (smoke) | Same sim, tap Plans sub-tab pill | ScheduleSheet opens with the live data | Runtime |

**T-16/T-17/T-18 are operator-witnessed smoke** at TEST mode time. The tester runs them on iOS sim + Android emulator + operator HITL on physical iPhone per the codified 3-sim + HITL posture.

---

## §7 — Implementation Order

The implementor performs these steps in this exact order. Each step is committable as a single atomic checkpoint; only the final commit goes through CLOSE.

1. **Pre-flight (read-only):** `git checkout Seth`, `git pull --ff-only origin Seth`, confirm HEAD is `4b967630` (or later artifact-sync commits). `git status --short` — abort if any product-code file under §1 IN scope is already dirty (operator must clean first).
2. **Delete 6 whole files** (in this order, easiest first so tooling errors surface):
   - `git rm .github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs`
   - `git rm app-mobile/scripts/ci/orch-0918-regression-check.mjs`
   - `git rm app-mobile/scripts/ci/orch-0918-adversarial-check.mjs`
   - `git rm app-mobile/src/store/sessionDeckMountStore.ts`
   - `git rm app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts`
   - `git rm app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx`
3. **Surgical edit `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`** per §3.1.1 + §3.1.2:
   - Delete the 3 dead function regions
   - Delete dead imports (per audit walk in §3.1.1)
   - Run style-key audit per §3.1.2 → delete dead style entries
   - Re-run style-key audit to confirm zero `styles.<deletedKey>` references remain
4. **Edit `app-mobile/package.json`** per §3.5.1:
   - Remove `"test:orch-0918"` line
   - Verify JSON validity (`node -e "JSON.parse(...)"`)
5. **Append DEC-164** to `Mingla_Artifacts/DECISION_LOG.md` per §3.6.1:
   - Read current state of `DECISION_LOG.md` to confirm DEC-163 is the most recent
   - Append the DEC-164 block with exact text from §3.6.1
6. **Run scoped local checks:**
   - `cd app-mobile && npx tsc --noEmit src/components/chat/CollabSessionChatBanners.tsx src/components/MessageInterface.tsx` — must produce ZERO new errors vs baseline
   - Compile + run the 2 surviving live regression tests (`orch-0918-message-and-deck-contract.test.tsx` + `orch-0918-session-card-hooks.test.ts`) — must PASS
   - Run all META-0929 strict-grep gates — must PASS
   - Run ORCH-0939 + ORCH-0931 strict-grep gates — must PASS
7. **Write implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` with: file-by-file old→new receipts (line counts, function counts), full `git status --short` output, every SC-XX status mapped to evidence, all T-XX test results with exact commands and exit codes, pre-existing transitive TypeScript errors documented as such, and explicit declaration that no file outside §1 IN scope was modified.
8. **Stage scoped files:**
   - `git add` only the files named in §1 IN scope
   - Run `git status --short` to confirm staged set matches IN scope exactly; if any unrelated dirty file is staged, unstage it
9. **Commit** with message:

   ```
   Close ORCH-0942: META-ORCH-0929 dead-code reap [TEST-MOD-APPROVED ORCH-0942]
   
   Delete orphaned CollabSessionChatBanners + InChatDeckSheet + BannerRow
   functions, the useSessionDeckMountStore Zustand mutex + its test, the
   orch-0918 strict-grep + regression + adversarial CI scripts, the
   CollabSessionChatBanners.test.tsx test file, and the dead test:orch-0918
   package.json script. Preserve ScheduleSheet + SavedToSessionCardsSheet +
   useSessionSavedCardsForSheet + SavedSessionCard + CompactCollabBottomSheet
   (all live consumers of MessageInterface).
   
   META-ORCH-0929 (PR #179) deleted the <CollabSessionChatBanners /> JSX
   render from MessageInterface and replaced banner-row chat-body
   architecture with chat-header sub-tab pills (Matches/Swipe/Plans), but
   left the underlying component files, hooks, stores, CI scripts, and
   tests orphaned. ORCH-0942 completes the cleanup. The orch-0918
   strict-grep gate would FAIL HARD if re-wired in CI because it asserts
   <CollabSessionChatBanners count === 1 in MessageInterface; today's
   count has been 0 since META-ORCH-0929 close on 2026-05-23.
   
   No user-visible change. No EAS OTA needed (the dead banners weren't
   visible to users anyway). Mobile-only diff — no [deploy] tag.
   
   Spec: Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
   Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md
   ```

   The `[TEST-MOD-APPROVED ORCH-0942]` token in the subject line satisfies the append-only CI gate for the 2 deleted test files. (If subject-line placement fails the CI parser, move it to the commit body — verify which the parser checks before commit.)
10. **Push Seth** → orchestrator opens PR per §7-handoff.

---

## §8 — Regression Prevention

**Why no new test, invariant, or strict-grep gate is required:**

1. The dead code is being **structurally deleted**, not renamed or feature-flagged.
2. META-ORCH-0929's `I-PROPOSED-META-0929-COLLAB-DECK-SINGLE-MOUNT` invariant + CI gate already enforces single collab-deck mount. If a future contributor re-introduces a chat-body banner with an embedded deck, that gate fails.
3. META-ORCH-0929's `I-PROPOSED-META-0929-HOME-IS-SOLO-ONLY` enforces that HomePage never re-introduces a collab-mode mount.
4. The product direction at `Mingla_Artifacts/PRODUCT_DIRECTION_COLLAB_SESSIONS_IN_CHAT.md` codifies the 3-pill architecture as the canonical end-state.
5. The `tests-append-only.yml` CI gate ensures the deletions stay deleted — re-introducing the deleted tests requires another `[TEST-MOD-APPROVED]` token.

If a future ORCH ever wants to add a chat-body banner architecture again, it must amend the product direction doc, write a new META, and re-introduce the surface — at which point a fresh strict-grep gate would be written from scratch, not reused.

---

## §9 — Discoveries forwarded from Investigation

Per investigation §"Discoveries for Orchestrator":

1. `package.json` `test:orch-0918` script — addressed by SC-09 + §3.5.1.
2. Two ORCH-0918 test fixture files test LIVE behaviour — addressed by §3.4.2 (KEEP, cosmetic rename optional and skipped by default).
3. DEC-162 + DEC-163 did NOT name CollabSessionChatBanners/InChatDeckSheet — addressed by DEC-164 in §3.6.1.
4. WORLD_MAP.md ORCH-0918 close banner contradicts INVARIANT_REGISTRY.md reality (3 claimed invariants don't exist) — non-blocking; documented in DEC-164 rationale. Orchestrator may optionally add a one-line correction note to the ORCH-0918 WORLD_MAP entry at CLOSE time, but this SPEC does NOT mandate it (out-of-scope edit risk).
5. `SwipeableSessionCards.tsx` audit forward-flag — out of scope; register as separate ORCH if operator wants the audit pass.

---

## §10 — Files Touched (consolidated)

| Operation | File | Bytes/Lines change |
| --- | --- | --- |
| DELETE | `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` | −4233 bytes |
| DELETE | `app-mobile/scripts/ci/orch-0918-regression-check.mjs` | −11571 bytes |
| DELETE | `app-mobile/scripts/ci/orch-0918-adversarial-check.mjs` | −19042 bytes |
| DELETE | `app-mobile/src/store/sessionDeckMountStore.ts` | whole file |
| DELETE | `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts` | whole file (TEST-MOD-APPROVED) |
| DELETE | `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx` | whole file (TEST-MOD-APPROVED) |
| EDIT | `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` | ~-390 lines (840 → ~450) |
| EDIT | `app-mobile/package.json` | -1 line |
| EDIT | `Mingla_Artifacts/DECISION_LOG.md` | +~20 lines (DEC-164 block) |
| NEW | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` | implementor's report |
| Untracked → tracked | `Mingla_Artifacts/specs/SPEC_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` (this file) | as-is |
| Untracked → tracked | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0942_META-ORCH-0929_DEAD_CODE_REAP.md` | as-is |

Total: 6 file deletions, 3 file edits, 3 file additions (spec, investigation, implementation report). Approximately 425 lines of dead code removed; 20 lines of decision documentation added; net diff ~-405 lines.

---

## §11 — Spec sign-off

This SPEC is bound by the verified-dead/verified-alive registers in the investigation. The implementor MUST treat the orchestrator's 2 P0 hypothesis corrections as binding:

- **P0-1:** `CompactCollabBottomSheet` is ALIVE — DO NOT DELETE.
- **P0-2:** The 3 ORCH-0918 invariants the orchestrator claimed exist DO NOT exist — DO NOT add `INVARIANT_REGISTRY.md` deprecation entries.

If the implementor finds a contradiction between this SPEC and the actual filesystem state at the time of implementation, STOP and report. Do NOT improvise.

---

## End of SPEC. Next phase: IMPLEMENT.
