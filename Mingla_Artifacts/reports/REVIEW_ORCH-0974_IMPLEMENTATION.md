# REVIEW — ORCH-0974 [Home (mingla-business mobile) section lock + spacing] — IMPLEMENTATION

**Reviewer:** Claude `mingla-orchestrator`
**Reviewed:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0974-[home-mobile-section-lock-and-spacing]/` on branch `ORCH-0974-home-mobile-section-lock-and-spacing`
**Implementation commit (primary):** `0d95a5da0` (ORCH-0974: lock mobile home upcoming pane)
**Implementation report:** `84bf01d62`
**Fails-on-revert pair:** `3e638c926` (revert) → `60ff97b0d` (restore)
**Reviewed artifacts:** SPEC + INVESTIGATION + REVIEW_ORCH-0974_SPEC + IMPLEMENTATION (all in worktree `Mingla_Artifacts/`).

---

## Verdict

**APPROVED WITH ONE PRE-PR CONDITION.** Cleared for tester dispatch. The condition is mechanical (a rebase that orchestrator owns at CLOSE-PR time, not implementor or tester) and does not block the test phase.

---

## Review checklist

| Item | Verdict | Notes |
|------|---------|-------|
| Root cause proven? | ✅ PASS | F-1 architectural + F-2 spacing both addressed at the structural level (outer ScrollView removed from mobile populated path; FlatList becomes the only scrollable surface; section header gains `paddingBottom: spacing.md`). |
| Scope appropriate? | ✅ PASS | Implementor's commit `0d95a5da0` touches exactly 14 files (per `git diff 8d9f5e651..HEAD --stat`): `home.tsx`, new `UpcomingListItem.tsx`, new test, new strict-grep gate, one workflow job addition, plus the 4 ORCH-0974 artifact files and 5 screenshots. No drift into `app-mobile/`, `mingla-admin/`, `mingla-marketing/`, `supabase/`, `packages/`, `designSystem.ts`, or any other ORCH's territory. Exact match to SPEC §4 edit list. |
| Hidden fallback paths? | ✅ PASS | F-5 RefreshControl migration is verified — `home.tsx:925` carries `refreshControl=` on the new mobile populated FlatList; `home.tsx:415` carries it on the new empty-state ScrollView; `home.tsx:740` carries it on the existing desktop ScrollView (unchanged). All three paths can pull-to-refresh. |
| Stale cache paths? | ✅ N/A | No cache changes; `handleRefresh` body preserved verbatim. |
| Response shape truthful in ALL states? | ✅ PASS | State matrix per SPEC §6 implemented: empty (`!currentBrand`) gets ScrollView; populated-no-live + populated-with-live share the locked-zone + FlatList; small-phone + live-hero + ladder-rung-4 carve-out renders the ladder card AFTER the FlatList via `!isSmallPhoneWithLiveHero` (locked branch) + `isSmallPhoneWithLiveHero` (foot branch). Mutually exclusive. |
| Real fix or symptom mask? | ✅ PASS | Architectural — the outer ScrollView wrapping both zones is replaced; the structural cause is gone, not patched. |
| Solo/collab parity? | ✅ N/A | mingla-business has no solo/collab concept. |
| Constitutional compliance? | ✅ PASS | No fab data, no silent failures (RefreshControl preserved), no auth/RLS touch, no inline color rule violations, Toast wrap untouched. |
| Evidence chain complete? | ✅ PASS | Investigation + SPEC + REVIEW + IMPLEMENTATION + 5 screenshots all committed on the per-ORCH branch; T-01..T-06 cited at exact paths with fails-on-revert commit hashes (`3e638c926` revert + `60ff97b0d` restore). |
| Documents updated? | ✅ PASS at IMPLEMENTATION stage | Registry row, INVESTIGATION, SPEC, REVIEW (spec-stage), IMPLEMENTATION report all committed. WORLD_MAP entry deferred to CLOSE commit per SYNC-deferred precedent. |
| **Commit-hash verification (DEC-179)** | ✅ PASS | Every claimed-changed file shows on the per-ORCH branch via `git log --oneline -- <file>`. Verified inline per file: `home.tsx` → `0d95a5da0` + revert/restore pair; `UpcomingListItem.tsx`, `home.orch_0974.test.tsx`, `orch-0974-home-mobile-lock-pane.mjs`, workflow addition, SPEC, INVESTIGATION, REVIEW_SPEC → all `0d95a5da0`; IMPLEMENTATION report → `84bf01d62`. Working tree clean except for symlinked `node_modules` (expected, not tracked). No "modified but uncommitted" product-file violations. |
| **Dependency walk for config-layer changes (DEC-179)** | ✅ PASS with one note | One config-layer file touched: `.github/workflows/strict-grep-mingla-business.yml` (additive, +12 lines for the new `ORCH-0974: Home mobile lock pane` job). **Dependency consumers:** (a) GitHub Actions runner — adds one new job to the strict-grep workflow; existing jobs in this workflow are unaffected (job entry is independent and follows the canonical registry pattern per `feedback_strict_grep_registry_pattern.md`); (b) branch protection / required-checks list — implementor explicitly states they did NOT modify branch protection, per operator's hard guard; (c) status-check listeners + CI dashboard — auto-enumerate, no breakage. **No other config-layer files touched** (no `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `expo.json`, `metro.config.*`, `babel.config.*`, `next.config.*` changes; only one additive job entry in one existing workflow file). |

---

## Independent verification I ran during REVIEW

| Check | Result |
|-------|--------|
| `node .github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` from worktree root | PASS — `[ORCH-0974] OK — Home mobile lock pane invariant holds.` |
| `node .github/scripts/strict-grep/orch-0965-home-uses-upcoming-hook.mjs` (regression guard for prior ORCH) | PASS — `[ORCH-0965] OK — home.tsx uses useUpcomingForBrand; no forbidden imports or CTA literals.` |
| `npx jest 'app/\(tabs\)/__tests__/home.orch_0974.test.tsx' --runInBand` from `mingla-business/` | PASS — **6 tests passed (T-01..T-06)** in 24.2 s. Implementor's claim verified at restore commit. |
| Spec-token compliance grep on `mingla-business/app/(tabs)/home.tsx` | PASS — `mobileKpiStack.gap: spacing.sm` (line 1034) + `mobileSectionHeaderRow.paddingTop: spacing.lg` (1041) + `paddingBottom: spacing.md` (1042) all present and exact. Lock-pane begin/end markers at lines 787 + 937. FlatList at 897. `isSmallPhoneWithLiveHero` carve-out at 383. Mutually-exclusive ladder placement at 790 (locked) + 931 (foot). |

---

## Critical pre-PR condition (NOT a blocker for tester dispatch)

**Branch is stale vs `origin/main` by 2 merge commits since spawn:**
- `dd49d6d2b` [deploy] Close ORCH-0963: public brand page kind-branched IA + pg_public_trips_by_brand RPC (#215) — merged after ORCH-0974 spawn.
- `1a882a076` [deploy] Close ORCH-0973: Home + Account top-bar mobile parity with Hub/Blasts (#216) — merged after ORCH-0974 spawn AND touches the same `mingla-business/app/(tabs)/home.tsx` file ORCH-0974 rewrites (ORCH-0973's lane was `barWrap` / `<TopBar>` per COMMS file-line disjoint-area declaration at INVESTIGATION §5).

**Impact:** if a PR is opened from `ORCH-0974-home-mobile-section-lock-and-spacing` → `main` AS-IS, GitHub will compute the diff against current `origin/main` and show a 56-file delta that appears to DELETE ORCH-0963 + ORCH-0973 work. This would be catastrophic if merged unrebased.

**ORCH-0974's own commits are clean** (verified via `git diff 8d9f5e651..HEAD --stat`: exactly 14 files all in ORCH-0974 scope, +1930/−278). The apparent deletion is purely a stale-base artifact.

**Resolution (owned by orchestrator at CLOSE-PR time, not implementor or tester):**
1. After tester PASS, before opening the close PR, run `git fetch origin main && git rebase origin/main` from the worktree.
2. Resolve the expected merge conflict in `home.tsx` — both ORCHs touched this file. ORCH-0973's lane is the top-bar / `barWrap` area (lines 377-391 in the pre-ORCH-0973 source); ORCH-0974's lane is the dashboard body (lines 393-722 in the pre-ORCH-0974 source). The lane-disjoint claim from INVESTIGATION §5 will be tested by the conflict markers. If lanes truly are disjoint, the merge is a straightforward two-region accept. If git reports conflicts beyond the boundary, escalate as a P0 cross-ORCH issue.
3. Re-run T-01..T-06 + both strict-grep gates after rebase to confirm no behavioural regression.
4. Then proceed to PR open + pre-merge gate.

**Why this is not a tester-dispatch blocker:** the tester verifies the implementation against the SPEC. The SPEC and the implementation both target the same code-path semantics that the rebase will preserve. Tester findings will remain valid post-rebase (because the rebase resolves only top-bar vs body lane separation, not anything tester touches).

---

## Native visual-smoke gap (preserved per operator guard)

Implementor flagged at IMPLEMENTATION §Verification + §Risks: `npx expo start --port 8092 --dev-client` bundled iOS + Android successfully, but launching the installed dev client opened Expo Router's welcome fallback instead of the Mingla Business app shell. Evidence committed:
- `Mingla_Artifacts/reports/screenshots/orch-0974/ios-17-pro-max-runtime-blocked-expo-router-welcome.png`
- `Mingla_Artifacts/reports/screenshots/orch-0974/ios-se-3rd-gen-runtime-blocked-expo-router-welcome.png`
- `Mingla_Artifacts/reports/screenshots/orch-0974/pixel-6-runtime-blocked-expo-router-welcome.png`

This is the EXACT blocker documented as **ORCH-0971** [Worktree-per-ORCH live-fire infrastructure unblock] (S2-medium, REGISTERED 2026-05-25): bracket characters in worktree paths (`ORCH-NNNN-[label]`) confuse Metro / Expo Router's `app/` directory walker. ORCH-0971 owns the fix path. No new ORCH needed; cross-reference the existing entry.

**Per operator's hard guard for this REVIEW:** preserve the noted native visual-smoke blocker as a tester / manual gate. Tester (Claude `mingla-tester`) should attempt the same dev-client launch; if blocked by the same Expo Router fallback, document as CONDITIONAL PASS with a deferred-eyeball condition (operator eyeballs on real iPhone via TestFlight or post-EAS-OTA). This is the same conditional-pass shape ORCH-0954 + ORCH-0961 + ORCH-0962 + ORCH-0963 used for similar live-fire infrastructure blockers.

---

## Strict-grep job NOT added to required checks (operator guard preserved)

Implementor IMPLEMENTATION §Files Changed line: *"Added one registry-pattern job: `ORCH-0974: Home mobile lock pane`; did not touch branch-protection required checks."* Verified by inspection of the only config-layer change. Operator's hard guard preserved.

---

## Spec compliance — per-section spot check

| Spec section | Implementation evidence |
|--------------|-------------------------|
| §3.2 layout (mobileBody → lockedZone + FlatList) | `home.tsx:788` outer `mobileBody`, `:789` lockedZone, `:897` FlatList. Lock-pane begin/end markers at `:787` / `:937` scope the strict-grep gate's C1 check. |
| §4.1 UpcomingListItem props interface | `src/components/home/UpcomingListItem.tsx` 223 lines, memoised, draft/trip/event/experience branches. Imported into `home.tsx`. |
| §5 spacing contract | Verified: `mobileKpiStack.gap: spacing.sm` ✓, `mobileSectionHeaderRow.paddingTop: spacing.lg` ✓, `paddingBottom: spacing.md` ✓, `mobileUpcomingContent.paddingBottom: spacing.xl * 4` ✓, `mobileUpcomingSep` (inter-card separator) present. |
| §6.A empty state preserved | `home.tsx` empty branch wraps existing `<View style={styles.emptyCol}>` JSX in a single `<ScrollView>` with RefreshControl (`:415`). No lock applied. |
| §6.B/C populated branches | Shared locked-zone + FlatList structure for both no-live and with-live; live-hero variant adds the existing hero `GlassCard` JSX inside the lockedZone. |
| §6.D ladder-rung placement | `home.tsx:383` `isSmallPhoneWithLiveHero` constant; `:790` locked-branch render (default); `:931` foot-branch render (carve-out). Mutually exclusive. |
| §8.A Step 0.5 happy-path tests | T-01..T-06 at `mingla-business/app/(tabs)/__tests__/home.orch_0974.test.tsx`. Independently re-run during this REVIEW: 6/6 PASS. Fails-on-revert verified by implementor on T-01 + T-02 + T-05 minimum (commit `3e638c926`); restore commit `60ff97b0d` restored green. |
| §10 strict-grep gate | `.github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` 170 lines. Independently run during this REVIEW: PASS. Wired into existing workflow via additive 12-line job entry. |
| §11 ORCH-0965 condition preservation | Preserved verbatim in source. ORCH-0965 strict-grep gate (`orch-0965-home-uses-upcoming-hook.mjs`) still passes — no regression. |
| §12 hard constraints | All honoured per file-list inspection. |

---

## Discoveries for orchestrator

**None new.** The branch-stale-vs-main observation is a process artifact for the orchestrator to handle at CLOSE-PR, not a discovered bug. The native visual-smoke blocker already has an existing ORCH (ORCH-0971) and need not be re-registered.

**COMMS impact:** none. COMMS-0001..0005 all remain N/A for ORCH-0974. No new COMMS entry required.

---

## Pipeline routing post-APPROVED

→ Dispatch to Claude `mingla-tester` for TEST on iPhone 17 Pro Max sim + Pixel emu + iPhone SE 3rd gen sim (small-phone carve-out) + business-web narrow viewport eyeball.
→ Tester writes A-01..A-05 adversarial per SPEC §8.B; minimum fails-on-revert on A-01 (pull-to-refresh hidden-flaw guard).
→ Native visual-smoke is a conditional-pass-acceptable gate per the ORCH-0971 blocker — tester may CONDITIONAL PASS with operator-eyeball deferred post-deploy.
→ On PASS / CONDITIONAL PASS → orchestrator CLOSE: **rebase onto `origin/main` FIRST**, resolve expected `home.tsx` conflict (lane-disjoint with ORCH-0973), re-run T-01..T-06 + strict-grep gates, then open PR with Vercel `[deploy]` tag (touches `mingla-business/src/`) + EAS OTA `--platform ios,android` + flip `I-PROPOSED-HOME-MOBILE-LOCK-PANE` DRAFT → ACTIVE in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
