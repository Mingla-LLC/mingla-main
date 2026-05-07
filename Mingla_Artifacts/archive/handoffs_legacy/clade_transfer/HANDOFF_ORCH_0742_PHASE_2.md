# Handoff — ORCH-0742 Cycle 2 (currentBrand ID-only) — Mac continuation

**Authored:** 2026-05-06 by mingla-orchestrator on Windows session
**Branch:** `Seth`
**Last commit at handoff:** `497eaf59 feat(orch-0737-v6): pipeline redesign — URL transforms + parallel-12 prep + budget-loop`
**Working tree:** dirty (intentionally — see §3)
**Next action:** decide commit strategy (§3) → dispatch implementor Phase 2 (§5)

---

## 1. Where we are right now (one-paragraph)

The Mingla Business mobile + web bundle was crashing at boot due to a duplicate `const currentRank` declaration in two files (merge residue from `git pull --rebase origin Seth`). **Phase 1 hotfix is complete and verified** — bundle compiles cleanly on iOS Metro and Expo Web. The architectural fix (Phase 2 — convert `currentBrandStore` from "persisted full Brand snapshot" to "persisted ID + React Query for fresh data") is **specced and dispatched but not started**. You stopped the Windows session before deciding whether to bundle this commit with two unrelated in-flight streams (ORCH-0737 v6 follow-up + Android blur fix + Stripe Connect report) or split into separate commits. That decision is the first thing to make on Mac.

---

## 2. ORCH-0742 — what it is in plain English

**Problem:** when you pick a brand on Phone, the app saves the entire brand record (name, slug, logo, balances) to local storage. If you then delete or rename that brand from Tablet, Phone keeps showing the old snapshot until next foreground refresh — and on cold-start the app replays the stale data even before refresh runs. Cycle 1 (ORCH-0740, shipped yesterday) papered over the foreground case with `focusManager`, but the cold-start replay and the structural staleness are still there.

**Fix:** persist only the brand's **ID** in Zustand. Read the live brand record via React Query (`useBrand(brandId)`). Wrapper hook auto-clears the ID if the server says the brand was deleted. Cross-device delete and rename now propagate cleanly within ~30s+foreground (Cycle 1 wiring) AND cold-start can never replay phantom selection.

**Outcome after Phase 2:**
- Brand renamed on Phone → Tablet shows new name on next foreground
- Brand deleted on Phone → Tablet auto-clears selection (no phantom brand)
- Cold-start with a since-deleted brand → clean null, no flash, no crash
- Same code path on iOS / Android / Expo Web

---

## 3. Working tree state — three streams, not committed yet

You stopped just before deciding: one mega-commit vs two clean commits. Recommendation was **two commits**.

### 3.1 — Stream A: ORCH-0742 (this session)

| File | Status | Why |
|------|--------|-----|
| `mingla-business/app/event/[id]/door/index.tsx` | modified (-9 lines) | Phase 1 hotfix — deleted duplicate `currentRank` block |
| `mingla-business/app/event/[id]/scanners/index.tsx` | modified (-5 lines) | Phase 1 hotfix — deleted duplicate `currentRank` block |
| `mingla-business/src/store/currentBrandStore.ts` | modified (-10 lines) | Phase 1 hotfix — deleted dead `upgradeV11BrandToV12` referencing undefined `V11Brand` type |
| `Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md` | **new (untracked)** | Forensics SPEC for Phase 2 |

### 3.2 — Stream B: ORCH-0737 v6 follow-up (prior session, never committed)

| File | Status | Why |
|------|--------|-----|
| `supabase/functions/_shared/imageCollage.ts` | modified (+77 lines) | URL transform helper + tile-resolution param |
| `supabase/functions/run-place-intelligence-trial/index.ts` | modified (+403 lines) | Budget-loop + parallel-12 prep + self-invoke |
| `supabase/functions/_shared/imageCollage.test.ts` | **new (untracked)** | 8 deterministic unit tests |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V6_REPORT.md` | **new (untracked)** | Implementor report |
| `Mingla_Artifacts/AGENT_HANDOFFS.md` | modified (+1 line) | AH-181 status updated to CODE COMPLETE |
| `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | modified (+1 line) | ORCH-0737 v6 status updated |
| `Mingla_Artifacts/PRIORITY_BOARD.md` | modified (+1 line) | ORCH-0737 v6 row updated |

> Note: commit `497eaf59` already shipped the bulk of ORCH-0737 v6. These are leftover follow-up edits and untracked artifacts.

### 3.3 — Stream C: Android blur fix + Stripe Connect report

| File | Status | Why |
|------|--------|-----|
| `mingla-business/src/components/ui/GlassChrome.tsx` | modified (+11 lines) | Android branched off web's solid fallback (expo-blur reads near-transparent) |
| `mingla-business/src/components/ui/Sheet.tsx` | modified (+11 lines) | Same Android-blur pattern |
| `mingla-business/src/components/ui/TopSheet.tsx` | modified (+11 lines) | Same Android-blur pattern |
| `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md` | **new (untracked)** | Pre-existing Cycle B2a Stripe Connect report |

### 3.4 — Recommended commit split

**Commit A — ORCH-0742 hotfix + SPEC (4 files, clean, scoped):**

```bash
git add mingla-business/app/event/\[id\]/door/index.tsx \
        mingla-business/app/event/\[id\]/scanners/index.tsx \
        mingla-business/src/store/currentBrandStore.ts \
        Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md

git commit -m "$(cat <<'EOF'
fix(mingla-business): ORCH-0742 Phase 1 — restore bundle compile + lock Cycle 2 SPEC

Phase 1 hotfix (~15 lines deleted, zero added):
- door/index.tsx: delete duplicate currentRank block (lines 166-173 — merge
  residue from git pull --rebase origin Seth that kept both copies of an
  identical permission-gate block)
- scanners/index.tsx: same duplicate-block residue removed (lines 138-141)
- currentBrandStore.ts: delete dead upgradeV11BrandToV12 helper referencing
  undefined V11Brand type — would have blocked tsc=0 once Phase 1 unblocked
  the bundle and tsc could finally run end-to-end

Verification: tsc --noEmit exit 0; expo export -p web exit 0 (full route
table exported including /event/[id]/door + /event/[id]/scanners); grep
confirms exactly one currentRank declaration in each route; V11Brand has
zero hits across mingla-business.

Closes: ORCH-0742-HOTFIX (S0 bundle blocker)

Phase 2 SPEC locked: specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md (12
success criteria, 15-consumer cascade verification, persist v13→v14
migration, useCurrentBrand wrapper-around-useBrand, getBrandFromCache
helper, auto-clear on deleted brand). Implementor dispatch ready locally
in Mingla_Artifacts/prompts/ (gitignored). Phase 2 NOT started.
EOF
)"
```

**Commit B — Catch-up wave (10 files, multi-stream but honest):**

```bash
git add supabase/functions/_shared/imageCollage.ts \
        supabase/functions/_shared/imageCollage.test.ts \
        supabase/functions/run-place-intelligence-trial/index.ts \
        Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0737_V6_REPORT.md \
        Mingla_Artifacts/AGENT_HANDOFFS.md \
        Mingla_Artifacts/OPEN_INVESTIGATIONS.md \
        Mingla_Artifacts/PRIORITY_BOARD.md \
        mingla-business/src/components/ui/GlassChrome.tsx \
        mingla-business/src/components/ui/Sheet.tsx \
        mingla-business/src/components/ui/TopSheet.tsx \
        Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md

git commit -m "$(cat <<'EOF'
chore(catch-up): ORCH-0737 v6 follow-up + Android blur fallback + reports

ORCH-0737 v6 implementor follow-up (post-497eaf59):
- _shared/imageCollage.ts + .test.ts: URL transform helper at tile resolution
- run-place-intelligence-trial/index.ts: budget-loop + parallel-12 prep
- IMPLEMENTATION_ORCH-0737_V6_REPORT.md: implementor evidence

mingla-business UI Android-blur fallback:
- GlassChrome / Sheet / TopSheet: Android routed to solid fallback because
  expo-blur backdrop reads near-transparent against busy content. iOS keeps
  UIVisualEffectView; Web keeps CSS backdrop-filter when supported.

Artifact catch-up:
- AGENT_HANDOFFS / OPEN_INVESTIGATIONS / PRIORITY_BOARD: ORCH-0737 v6 status
  flipped to CODE COMPLETE awaiting operator deploy
- IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md: prior
  Cycle B2a evidence file landed
EOF
)"
```

**Push:**
```bash
git push origin Seth
```

> If you'd rather one mega-commit, fine — but list the streams honestly in the message.

---

## 4. Phase 1 verification evidence (already complete on Windows)

| Check | Command | Result |
|-------|---------|--------|
| TypeScript clean | `cd mingla-business && npx tsc --noEmit` | exit 0 ✅ |
| Web build clean | `cd mingla-business && npx expo export -p web` | exit 0 ✅ — full route table exported |
| `currentRank` x1 in door | `rg "const \{ rank: currentRank \}" mingla-business/app/event/\[id\]/door/` | 1 hit (line 160) ✅ |
| `currentRank` x1 in scanners | `rg "const \{ rank: currentRank \}" mingla-business/app/event/\[id\]/scanners/` | 1 hit (line 135) ✅ |
| `V11Brand` zero hits | `rg "V11Brand" mingla-business/` | 0 hits ✅ |

You should still run these on Mac after pulling, just to be safe across line-ending normalization.

---

## 5. Phase 2 dispatch — what to do next

The implementor dispatch was written but lives in the gitignored `Mingla_Artifacts/prompts/` directory. **It will not transfer via git.** You'll need to either:

- **Option A (recommended):** re-dispatch from the SPEC. The SPEC is committed (in Stream A). On Mac, after pulling: `/mingla-implementor take over` against `Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`. The SPEC has explicit Step 0 / Steps 1-9 ordering and a 15-consumer cascade table — the implementor can execute directly.

- **Option B:** copy the dispatch file across manually (e.g., via cloud sync or pasting). The dispatch content is reproduced in §5.2 below if you want to recreate it on Mac.

### 5.1 — Sequential discipline (don't skip)

The SPEC enforces **Step 0 = HOTFIX FIRST**. Step 0 is already done from this session, so on Mac the implementor should:

1. Read the SPEC fully
2. **Skip Step 0** (already shipped; verify with the §4 checks above)
3. Proceed Step 1 → Step 9 of SPEC §8
4. Stop at Step 9 (implementor report)
5. Hand back to orchestrator for REVIEW
6. Operator dispatches mingla-tester
7. Tester PASS → orchestrator CLOSE protocol → Cycle 3 dispatch

Per memory rule "Sequential Work — One Step at a Time", do NOT bundle Phase 2 with anything else.

### 5.2 — Dispatch prompt content (paste into Mac if needed)

Path on Windows machine (gitignored, will not transfer): `Mingla_Artifacts/prompts/IMPL_ORCH_0742_CURRENT_BRAND_ID_ONLY.md`

Content summary:

> Two-phase sequential implementation per operator's sequential-pace rule. Phase 1 = hotfix (already complete this session — verify on Mac and skip). Phase 2 = SPEC Steps 1-9, ~80-120 lines across 12 files, 12 success criteria, 15-consumer cascade verification, full implementation report at `reports/IMPLEMENTATION_ORCH_0742_REPORT.md`.
>
> UI-UX-Pro-Max exemption: pure logic/data work, no visible UI changes.
>
> Constraints: don't touch Cycle 1 work (focusManager, queryClient.clear, brandRoleKeys factory, 30s role TTL); don't touch events/draftEvent/liveEvent/doorSales/scannerInvitations stores (explicit OOS per ORCH-0739); no DB changes; cross-platform single code path.
>
> Failure modes documented: persist key bump trap (v13→v14 migrate must read `old.currentBrand?.id`, not `old.currentBrandId`); circular import risk (wrapper hook MUST relocate to `src/hooks/useCurrentBrand.ts`, NOT live in `currentBrandStore.ts`); `getBrandFromCache` import-path drift; wrapper auto-clear `useEffect` MUST gate on `isFetched` (not just `brand === null`) to avoid spurious clear during initial loading.

If you re-spawn the dispatch on Mac, the orchestrator skill knows the SPEC path and can recreate the prompt easily.

---

## 6. Files to read on Mac to get full context

In order:

1. **This file** — `clade transfer/HANDOFF_ORCH_0742_PHASE_2.md`
2. **The SPEC** — `Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md` (will be committed in Stream A; pull first)
3. **Predecessor evidence** (for context, not required):
   - `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0738_CROSS_DEVICE_SYNC_AUDIT.md`
   - `Mingla_Artifacts/reports/INVESTIGATION_ORCH_0739_EVENTS_AND_WEB_EXTENSION.md`
   - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0740_REPORT.md` (Cycle 1 Foundation, shipped 2026-05-05)
4. **Memory rules** — auto-load from `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md` on Mac. **You'll need the same path or the Mac equivalent.** If memory doesn't transfer, the most critical rules to remember are listed in §7 below.

---

## 7. Critical memory rules to honor on Mac (in case memory doesn't sync)

These are the non-negotiables that apply to any Phase 2 work:

1. **Sequential pace.** One step at a time. Finish Step N → operator approval → Step N+1. No parallel dispatches.
2. **Diagnose-first workflow.** For tasks without a formal spec, investigate fully + present findings in plain English BEFORE writing code. (Phase 2 has a formal SPEC, so this triggers only for unforeseen rework.)
3. **Layman first.** Every response leads with plain-English impact, then technicals.
4. **No Co-Authored-By in commits.** Never add AI attribution lines.
5. **Always offer commit after implementation.** Don't wait to be asked.
6. **Implementor uses /ui-ux-pro-max for visible UI changes.** Phase 2 is exempt (pure logic/data).
7. **Keyboard never blocks an input field.** N/A for Phase 2 but holds globally.
8. **RN inline-style colors hex/rgb/hsl/hwb only.** N/A for Phase 2.
9. **No summary paragraphs from sub-agents.** Just the artifact + a short chat reply.
10. **Detail in files, summary in chat (max 20 lines).** Reports go to `reports/`, not into chat.
11. **EAS Update: two separate platform commands, never combined.** N/A until tester PASS + CLOSE.
12. **Orchestrator never executes** — only writes prompts; user dispatches agents.
13. **Mingla is an experience app, not a dating app.** Positioning rule.

---

## 8. Pipeline state at handoff

```
ORCH-0742 — currentBrand ID-only architectural fix + bundle hotfix
├── INVESTIGATE   ✅ done (predecessors ORCH-0738/0739; this session re-verified cascade)
├── SPEC          ✅ done (specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md, untracked but ready to commit)
├── DISPATCH      ✅ done (prompts/IMPL_ORCH_0742_CURRENT_BRAND_ID_ONLY.md — gitignored, won't transfer)
├── IMPLEMENT     🟡 PARTIAL — Phase 1 done (hotfix verified); Phase 2 NOT started
├── TEST          ⏳ pending Phase 2
├── CLOSE         ⏳ pending tester PASS
└── EAS UPDATE    ⏳ pending CLOSE (then `cd mingla-business && eas update --branch production --platform ios` + separate Android invocation)
```

---

## 9. Cycles 3 + 4 (after ORCH-0742 closes — context for planning)

After ORCH-0742 ships and tester PASSes, the next two cycles in the cross-device sync wave are:

- **Cycle 3 — Realtime push.** Replace the 30s polling + foreground-refetch model with a Supabase Realtime subscription on `brands` and `brand_team_members`. Channel filter scoped to user's accountId. Cache update on event receipt + cleanup on unmount. Reduces propagation lag from ~30s+foreground to <2s steady-state.
- **Cycle 4 — Per-store Zustand classification.** Audit every persisted Zustand store in `mingla-business/src/store/*.ts` against the new I-PROPOSED-J invariant ("Zustand persist may hold IDs but not full server-derived objects"). Events / draftEvent / liveEvent / doorSales / scannerInvitations stores are currently TRANSITIONAL with documented exit; Cycle 4 confirms each meets the invariant or queues it for migration.

These cycles are queued, not specced. Do them in order, not parallel.

---

## 10. Quick-start sequence on Mac

```bash
# 1. Pull latest
cd ~/path/to/mingla-main
git checkout Seth
git pull origin Seth

# 2. Verify Phase 1 is intact (post-pull line-ending sanity check)
cd mingla-business && npx tsc --noEmit       # expect exit 0
cd mingla-business && npx expo export -p web # expect exit 0
cd ..

# 3. (If you didn't commit on Windows yet) handle the working tree per §3.4
#    — either run the two-commit sequence or split your way

# 4. Read the SPEC fully
open Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md

# 5. Dispatch implementor
#    Type: /mingla-implementor take over
#    Reference: Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md
#    Tell it Phase 1 is done; start at SPEC §8 Step 1

# 6. After implementor returns Phase 2 report:
#    /mingla-orchestrator take over
#    (REVIEW the impl report → dispatch mingla-tester → CLOSE)
```

---

**End of handoff.** Last sanity check before you switch machines: run `git status` on Windows and confirm the file list matches §3 above. If you see anything not listed there, investigate before committing.
