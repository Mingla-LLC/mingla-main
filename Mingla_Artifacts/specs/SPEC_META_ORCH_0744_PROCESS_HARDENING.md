# SPEC — META-ORCH-0744-PROCESS — CLOSE-protocol + CI gate hardening

**Mode:** SPEC (Forensics SPEC mode; INVESTIGATE phase done by ORCH-0744 forensics §7 meta-findings)
**Authored by:** mingla-forensics, 2026-05-06
**Dispatch:** [`prompts/SPEC_META_ORCH_0744_PROCESS_HARDENING.md`](../prompts/SPEC_META_ORCH_0744_PROCESS_HARDENING.md)
**Predecessor evidence:**
- [`reports/INVESTIGATION_ORCH_0744_LATENT_DEFECTS_SWEEP.md`](../reports/INVESTIGATION_ORCH_0744_LATENT_DEFECTS_SWEEP.md) §7 — meta-findings M-1..M-5 (the source of this SPEC)
- [`reports/QA_ORCH_0743_REPORT.md`](../reports/QA_ORCH_0743_REPORT.md) — confirms ORCH-0743 closed cleanly; this cycle now lands on a clean baseline
- [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md) — letter-reservation context for the 5 new invariants
- [`.github/workflows/strict-grep-mingla-business.yml`](../../.github/workflows/strict-grep-mingla-business.yml) — existing workflow registry pattern (DEC-101 D-17b-5)
- [`.github/scripts/strict-grep/README.md`](../../.github/scripts/strict-grep/README.md) — strict-grep scaffold conventions (4-step add-a-gate procedure)
- [`.claude/skills/mingla-orchestrator/SKILL.md`](../../.claude/skills/mingla-orchestrator/SKILL.md) §"Mode: CLOSE" — M-2 insertion site

**Branch / commit at SPEC time:** `Seth` / `22fe5507` (post-ORCH-0743 CLOSE)

---

## 0. Layman summary

ORCH-0742 + ORCH-0743 fixed concrete user-visible bugs. ORCH-0744 forensics asked "why did our process let these through?" and found 5 missing CLOSE-protocol + CI gates. Each gate is small (~50-150 LOC of script + one workflow job + one SKILL.md edit). Together they prevent the *classes* of bug ORCH-0743 just patched from recurring across all future cycles.

**No user-visible product change.** All five gates are internal CI / process additions. The user keeps the same working app; the platform underneath gets harder to break.

**The 5 gates:**
1. **M-1 — Require-cycle baseline** — uses `madge --circular` to detect new circular imports against a checked-in baseline file. Pre-existing cycles get baselined (14 known cycles captured at SPEC time); new cycles fail CI.
2. **M-2 — DIAG-marker reaping at CLOSE** — adds Step 1.5 to the orchestrator skill's Mode: CLOSE so any `[ORCH-CLOSING-ID-DIAG]` markers introduced by THIS ORCH must be removed before CLOSE proceeds.
3. **M-3 — Persist-key whitelist sync** — every Zustand store's persist `name:` literal must appear in `KNOWN_MINGLA_KEYS` whitelist; drift fails CI. Closes the latent destruction risk class that ORCH-0744 RC-2 surfaced.
4. **M-4 — TRANSITIONAL exit-condition lint** — every `[TRANSITIONAL]` marker must have an exit-condition keyword (`EXIT`, `exits when`, `Cycle X`, `B-cycle`, `Bn`) within 5 lines. Const #7 enforcement. Initial deploy is warn-only; promotes to fail-mode after a separate ORCH-0748 cleans up the 9 known violators.
5. **M-5 — Web-deprecation parser** — `expo export -p web` stderr piped to a parser that fails CI on any `shadow*`/`textShadow*`/`elevation` deprecation OR `Property '<X>' doesn't exist` errors referring to mingla-business sources.

**Scope:** ~5-6 hours implementor effort. 5 small Node.js ESM scripts (~100-150 LOC each), 5 new YAML jobs in the existing strict-grep workflow, 1 baseline file, 1 small edit to the orchestrator skill SKILL.md. No DB / RLS / edge-function / mobile-bundle changes.

**5 NEW invariants** ratify ACTIVE on CLOSE: I-PROPOSED-K, L, M, N, X (skipping O which is taken by Stripe-no-webview-wrap and W which is taken by B2a Path C V3 notifications-prefix).

---

## 1. Pre-flight findings (re-verified at SPEC time)

### 1.1 — Existing CI infrastructure confirmed

`.github/workflows/strict-grep-mingla-business.yml` follows the registry pattern per DEC-101 D-17b-5:
- 13 currently-registered gates (I-37, I-38, I-39, I-PROPOSED-A, C, H, I, O, P, Q, R, S — plus future placeholders)
- Each gate = 1 ESM script in `.github/scripts/strict-grep/<name>.mjs` + 1 job in the workflow YAML
- Scripts use `npm install --no-save <deps>` to install runtime parser libs per-job
- Allowlist comment pattern documented: `// orch-strict-grep-allow <gate-tag> — <reason>`
- Script exit codes: `0` clean, `1` violation, `2` script error
- README at `.github/scripts/strict-grep/README.md` documents 4-step add-a-gate procedure

**M-1 through M-5 ALL plug into this existing pattern.** No parallel workflow files. Per `feedback_strict_grep_registry_pattern.md` ACTIVE since Cycle 17b CLOSE.

### 1.2 — `madge` choice confirmed (M-1)

Three options for require-cycle detection were weighed in dispatch §2.1:
- (a) `madge --circular` — npm package, mature, fast, no Metro startup, parses TS via @babel/parser internally
- (b) Spawn `expo start --no-dev` headless and grep Metro stdout — slow, flaky, requires TTY
- (c) Custom AST walker over import graph — fast but reinvents the wheel

**Decision locked: Option (a) madge.** Verified via `npx --yes madge --circular --extensions ts,tsx src/ app/` in mingla-business at SPEC time — found 14 cycles in 685ms. No install required (`npx --yes` fetches on-demand) but workflow installs per-job for reproducibility.

### 1.3 — 14 actual circular dependencies in mingla-business (NOT 4 as ORCH-0744 forensics estimated)

`madge` output captured at SPEC time (`Seth` / `22fe5507`):

```
1) src/context/AuthContext.tsx > src/hooks/useAccountDeletion.ts
2) src/context/AuthContext.tsx > src/hooks/useAccountDeletion.ts > src/hooks/useCreatorAccount.ts
3) src/context/AuthContext.tsx > src/utils/clearAllStores.ts > src/store/currentBrandStore.ts > src/hooks/useBrandListShim.ts
4) src/hooks/useBrands.ts > src/hooks/useCurrentBrandRole.ts > src/context/AuthContext.tsx > src/utils/clearAllStores.ts > src/store/currentBrandStore.ts > src/hooks/useBrandListShim.ts
5) src/store/currentBrandStore.ts > src/hooks/useBrandListShim.ts
6) src/hooks/useBrands.ts > src/hooks/useCurrentBrandRole.ts > src/context/AuthContext.tsx > src/utils/clearAllStores.ts > src/store/draftEventStore.ts > src/store/liveEventStore.ts
7) src/store/draftEventStore.ts > src/store/liveEventStore.ts
8) src/store/liveEventStore.ts > src/store/orderStoreHelpers.ts
9) src/store/draftEventStore.ts > src/store/liveEventStore.ts > src/utils/liveEventAdapter.ts
10) src/store/liveEventStore.ts > src/utils/liveEventAdapter.ts
11) src/store/draftEventStore.ts > src/store/liveEventStore.ts > src/utils/scheduleDateExpansion.ts
12) src/store/draftEventStore.ts > src/store/liveEventStore.ts > src/utils/scheduleDateExpansion.ts > src/utils/recurrenceRule.ts
13) src/hooks/useBrands.ts > src/hooks/useCurrentBrandRole.ts > src/context/AuthContext.tsx > src/utils/clearAllStores.ts > src/store/draftEventStore.ts > src/utils/liveEventConverter.ts
14) src/store/draftEventStore.ts > src/utils/liveEventConverter.ts
```

**Discovery for orchestrator (D-META-FOR-1):** ORCH-0744 forensics §3 cited "4 pre-existing AuthContext cycles" — actual count is 14. The 4-cycle figure was a partial enumeration; cycles 5-14 (mostly liveEventStore/draftEventStore-related) were missed. The baseline file MUST capture all 14, not 4. ORCH-0746 (queued for AuthContext-cycles structural refactor) similarly has more surface area than originally scoped.

**Note on ORCH-0743 cycle break:** the `currentBrandStore.ts ↔ useCurrentBrand.ts` cycle from ORCH-0742 IS gone (madge confirms — it does not appear in the 14). RC-1 fix verified.

### 1.4 — Letter reservations for 5 new invariants

Greped `INVARIANT_REGISTRY.md` for `I-PROPOSED-[A-Z]` at SPEC time, then re-checked during the 2026-05-07 SPEC-PATCH after implementor Pre-Flight found a letter-W collision. Reserved or active letters now include W, added by the B2a Path C V3 hotfix per DEC-121: A, B, C, D, E, H, I, J, O, P, Q, R, S, T, U, V, W. **Open letters: F, G, K, L, M, N, X, Y, Z.**

The dispatch originally proposed I-PROPOSED-K..O for the 5 META gates. **Letter O collides with the existing Stripe-no-webview-wrap invariant.** This SPEC corrects to:

| Gate | Invariant ID | Statement (short) |
|---|---|---|
| M-1 | **I-PROPOSED-K** | REQUIRE-CYCLES-BASELINED |
| M-2 | **I-PROPOSED-L** | DIAG-MARKERS-REAPED-AT-CLOSE |
| M-3 | **I-PROPOSED-M** | PERSIST-KEY-WHITELIST-SYNC |
| M-4 | **I-PROPOSED-N** | TRANSITIONAL-EXIT-CONDITIONED |
| M-5 | **I-PROPOSED-X** | WEB-EXPORT-CLEAN |

(Skipping O avoids the Stripe-no-webview-wrap collision; skipping W avoids the B2a Path C V3 notifications-prefix collision. X is the next free letter after the same-day W reservation.)

### 1.5 — Orchestrator SKILL.md CLOSE-section structure

`.claude/skills/mingla-orchestrator/SKILL.md` §"Mode: CLOSE" (line 176-315):
- Line 184: Step 1 — Update artifacts
- Line 201: Step 2 — Commit message
- Line 209: Step 3 — EAS Update
- Line 227: Step 4 — Announce next dispatch
- Line 232: Step 5 — DEPRECATION CLOSE EXTENSION (conditional)

**M-2 insertion site:** new "Step 1.5" between Step 1 and Step 2. Logical because if a cycle's diagnostic markers must be reaped, that reaping is part of the artifact-finalization phase, before the commit message is composed.

---

## 2. Scope, Non-goals, Assumptions

### 2.1 — Scope (5 sub-deliverables)

| ID | Sub-deliverable | LOC est. | Effort |
|---|---|---|---|
| M-1 | NEW `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs` + NEW `.github/workflows/strict-grep-mingla-business.yml` job + NEW `mingla-business/.metro-cycle-baseline.txt` (14 known cycles) | ~150 + ~15 + 14 lines | 1.5h |
| M-2 | NEW Step 1.5 in `.claude/skills/mingla-orchestrator/SKILL.md` Mode: CLOSE | ~25 lines of skill text | 0.5h |
| M-3 | NEW `.github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs` + NEW workflow job | ~100 + ~15 lines | 1h |
| M-4 | NEW `.github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs` + NEW workflow job (warn-mode initially) + NEW `Mingla_Artifacts/.transitional-baseline.txt` baseline file (9 known violators per ORCH-0744 HF-4) | ~120 + ~15 + 9 lines | 1.5h |
| M-5 | NEW `.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs` + MODIFY existing `expo export -p web` step in workflow to capture stderr + run parser | ~80 + ~10 lines | 1h |
| Cross | Update `.github/scripts/strict-grep/README.md` "Active gates registered" table to include 5 new gates + remove from "Future gates" | ~10 lines | 0.25h |
| Cross | Update `Mingla_Artifacts/INVARIANT_REGISTRY.md` with 5 NEW invariant entries (DRAFT — flips ACTIVE on CLOSE) | ~120 lines (~24 per entry) | 1h |

**Total:** ~6 hours implementor effort. 5 small Node.js ESM scripts + 1 SKILL.md edit + 1 README edit + 1 INVARIANT_REGISTRY edit + 6 workflow YAML changes (5 new jobs + 1 modified export step) + 2 baseline files.

### 2.2 — Non-goals (reject if implementor drifts)

- **Fixing the 14 require-cycles** — that's ORCH-0746 scope. M-1 BASELINES them; doesn't fix.
- **Fixing the 9 stale TRANSITIONAL markers** — that's ORCH-0748 scope (filed by this SPEC for queueing). M-4 BASELINES them in warn-only mode; doesn't fix.
- **Reaping any pre-existing DIAG markers** — there are zero post-ORCH-0743 cleanup. M-2 enforces ONLY for the CLOSING-ORCH's own markers, not historical residue.
- **Cross-domain expansion** — keep the gates `mingla-business/`-only initially. Cross-domain (admin / supabase / app-mobile) is a future cycle.
- **CLOSE-protocol overhaul beyond Step 1.5** — the existing 4-step + 8-step DEPRECATION extension stays. Only ADD Step 1.5.
- **Replacing the strict-grep registry** — M-1..M-5 plug INTO the existing registry per `feedback_strict_grep_registry_pattern.md`. Do NOT introduce parallel workflow files.
- **Native unit tests for the gate scripts** — gates are CI-only; per-script tests run locally during implementation via fixture violation files. No jest suite added.
- **Replacing `expo export -p web` with a different web-build tool** — only ADD parser to existing step.
- **DB / RLS / edge-function / mobile-bundle changes** — none.

### 2.3 — Assumptions

| ID | Assumption | Verified? |
|----|------------|-----------|
| A-1 | The existing `.github/workflows/strict-grep-mingla-business.yml` is the canonical home for new gates per `feedback_strict_grep_registry_pattern.md` | ✅ Read at SPEC time |
| A-2 | `madge` package can be installed per-job via `npm install --no-save madge` (matching the existing Babel-parser-per-job pattern) and runs cleanly on `mingla-business/src/ + app/` directories | ✅ Verified `npx --yes madge --circular` ran successfully at SPEC time, finding 14 cycles in 685ms |
| A-3 | The 14 pre-existing cycles captured in §1.3 represent the baseline as of `Seth` / `22fe5507`. Future PRs that introduce a 15th cycle fail CI; future PRs that REMOVE one (e.g., ORCH-0746 progress) require updating the baseline file in the same PR | ✅ |
| A-4 | Letters K, L, M, N, X are unreserved in `INVARIANT_REGISTRY.md`; W is reserved by B2a Path C V3 notifications-prefix per DEC-121 | ✅ Re-verified during 2026-05-07 SPEC-PATCH |
| A-5 | The 11 KNOWN_MINGLA_KEYS entries in `reapOrphanStorageKeys.ts:18-29` are authoritative as of `Seth` / `22fe5507`; M-3 cross-references these as the canonical whitelist | ✅ Verified post-ORCH-0743 (currentBrand.v14, draftEvent.v1, liveEvent.v1, orderStore.v1, guestStore.v1, eventEditLog.v1, notificationPrefsStore.v1, scannerInvitationsStore.v2, doorSalesStore.v1, scanStore.v1, brandTeamStore.v1) |
| A-6 | The 9 TRANSITIONAL violators identified by ORCH-0744 forensics §HF-4 (`guestCsvExport.ts:300`, `BrandProfileView.tsx:62/264/294`, `PublicEventPage.tsx:168/800`, `useCurrentBrandRole.ts:91/158`, `app/event/[id]/index.tsx:313`) are still present at SPEC time. M-4 baseline includes them | ⚠️ Implementor verifies count + locations match at SPEC-implementation time; if drift, baseline reflects current state |
| A-7 | `expo export -p web` writes deprecation warnings to stderr (not stdout). The existing workflow step that runs this command does not currently capture stderr; M-5 modifies it to do so | ⚠️ Implementor verifies the existing workflow step's exact form; if drift, adapts |
| A-8 | The orchestrator skill SKILL.md is at `.claude/skills/mingla-orchestrator/SKILL.md` and is operator-owned (lives in repo, can be edited by this SPEC's implementor) | ✅ Verified at SPEC time |

---

## 3. Per-deliverable specification

### 3.1 — M-1 Require-cycle gate (I-PROPOSED-K)

#### 3.1.1 — Script: `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs`

**Purpose:** detect circular dependencies in `mingla-business/src/ + app/` against a checked-in baseline. Fail CI on any new cycle.

**Implementation outline:**

```js
#!/usr/bin/env node
// I-PROPOSED-K — REQUIRE-CYCLES-BASELINED
//
// Detects circular dependencies in mingla-business via `madge --circular`
// and compares against the checked-in baseline (mingla-business/.metro-cycle-baseline.txt).
// New cycles (in live output but NOT in baseline) FAIL CI.
// Removed cycles (in baseline but NOT in live output) WARN but pass — operator
// updates baseline in same PR.
//
// Per SPEC_META_ORCH_0744_PROCESS_HARDENING.md §3.1.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const BASELINE_PATH = resolve("mingla-business/.metro-cycle-baseline.txt");
const TARGET_DIRS = ["src/", "app/"];
const TARGET_EXTENSIONS = "ts,tsx";

function normalizeCycle(cycleLine) {
  // Strip leading numeric prefix "N) " from madge output, sort path
  // alphabetically by file path so order-independent comparisons work.
  // (madge guarantees one cycle per line; we just need a stable representation.)
  const stripped = cycleLine.replace(/^\d+\)\s*/, "").trim();
  // Each cycle is "fileA > fileB > fileC" — split, sort, rejoin so the
  // baseline doesn't break if madge's internal ordering changes.
  return stripped
    .split(" > ")
    .map((s) => s.trim())
    .sort()
    .join(" | ");
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `[I-PROPOSED-K] Baseline file missing: ${BASELINE_PATH}. ` +
      `Create it by running this script with --capture-baseline (one-time bootstrap).`,
    );
    process.exit(2);
  }
  const lines = readFileSync(BASELINE_PATH, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
  return new Set(lines.map(normalizeCycle));
}

function runMadge() {
  try {
    const stdout = execFileSync(
      "npx",
      [
        "--yes",
        "madge",
        "--circular",
        "--extensions",
        TARGET_EXTENSIONS,
        ...TARGET_DIRS,
      ],
      {
        cwd: resolve("mingla-business"),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    return stdout;
  } catch (e) {
    // madge exits non-zero when cycles are found; that's expected. Capture stdout from the error.
    if (e.stdout) return e.stdout;
    console.error(`[I-PROPOSED-K] madge invocation failed: ${e.message}`);
    process.exit(2);
  }
}

function parseCycles(madgeOutput) {
  // madge output format: "1) fileA > fileB" (one cycle per numbered line)
  // Filter to only lines that match the cycle pattern.
  const cyclePattern = /^\d+\)\s+\S+/;
  return madgeOutput
    .split("\n")
    .filter((line) => cyclePattern.test(line))
    .map(normalizeCycle);
}

function main() {
  const baseline = readBaseline();
  const liveOutput = runMadge();
  const liveCycles = new Set(parseCycles(liveOutput));

  const newCycles = [...liveCycles].filter((c) => !baseline.has(c));
  const removedCycles = [...baseline].filter((c) => !liveCycles.has(c));

  if (newCycles.length > 0) {
    console.error(
      `[I-PROPOSED-K] FAIL — ${newCycles.length} NEW require-cycle(s) detected vs baseline:`,
    );
    for (const c of newCycles) {
      console.error(`  - ${c}`);
    }
    console.error(
      `\nFix the cycle(s) OR (if intentional) update ` +
      `mingla-business/.metro-cycle-baseline.txt in the same PR with rationale.`,
    );
    process.exit(1);
  }

  if (removedCycles.length > 0) {
    console.warn(
      `[I-PROPOSED-K] WARN — ${removedCycles.length} cycle(s) in baseline no longer exist in live output (good news!). ` +
      `Update mingla-business/.metro-cycle-baseline.txt to remove these stale entries:`,
    );
    for (const c of removedCycles) {
      console.warn(`  - ${c}`);
    }
    // Don't fail — operator removes from baseline in next PR or this one.
  }

  console.log(
    `[I-PROPOSED-K] PASS — ${liveCycles.size} cycle(s) match baseline. Zero new cycles introduced.`,
  );
  process.exit(0);
}

main();
```

**Edge case handling:**
- madge not installed → script catches via `npx --yes` autoinstall fallback; if that fails, exit code 2 (script error, not violation)
- Baseline file missing → exit code 2 with operator instruction
- Empty baseline (zero cycles) → script still works; any cycle in live output fails
- madge exit code is non-zero when cycles found (that's expected); script catches `e.stdout` from execFileSync's error path

**Pattern compliance:** matches the 13 existing scripts' shape (`.mjs`, `#!/usr/bin/env node`, ESM imports, exit codes 0/1/2).

#### 3.1.2 — Workflow job: append to `.github/workflows/strict-grep-mingla-business.yml`

```yaml
  i-proposed-k-require-cycles:
    name: "I-PROPOSED-K: require-cycles baselined"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install madge
        run: npm install --no-save madge
      - name: Run I-PROPOSED-K gate
        run: node .github/scripts/strict-grep/i-proposed-k-require-cycles.mjs
```

#### 3.1.3 — Baseline file: `mingla-business/.metro-cycle-baseline.txt`

Format: one cycle per line in normalized form (alphabetically sorted file paths joined by ` | `). Comments allowed via leading `#`.

**Initial content (14 cycles from §1.3 captured at SPEC time):**

```
# Mingla-business require-cycle baseline — META-ORCH-0744-PROCESS / I-PROPOSED-K
# Generated 2026-05-06 from `npx --yes madge --circular --extensions ts,tsx src/ app/`
# at HEAD `Seth` / `22fe5507` (post-ORCH-0743 CLOSE).
#
# Format: one cycle per line, file paths alphabetically sorted, joined by " | ".
# New cycles (in live output but NOT here) fail CI. Update this file when:
#   (1) ORCH-0746 fixes a cycle — REMOVE the line + cite the closing ORCH in the PR
#   (2) A NEW cycle is intentionally introduced — ADD the line + justify in PR review
#
# Cross-reference:
#   - INVARIANT_REGISTRY.md I-PROPOSED-K
#   - .github/scripts/strict-grep/i-proposed-k-require-cycles.mjs
#   - SPEC_META_ORCH_0744_PROCESS_HARDENING.md §3.1.3

src/context/AuthContext.tsx | src/hooks/useAccountDeletion.ts
src/context/AuthContext.tsx | src/hooks/useAccountDeletion.ts | src/hooks/useCreatorAccount.ts
src/context/AuthContext.tsx | src/hooks/useBrandListShim.ts | src/store/currentBrandStore.ts | src/utils/clearAllStores.ts
src/context/AuthContext.tsx | src/hooks/useBrandListShim.ts | src/hooks/useBrands.ts | src/hooks/useCurrentBrandRole.ts | src/store/currentBrandStore.ts | src/utils/clearAllStores.ts
src/hooks/useBrandListShim.ts | src/store/currentBrandStore.ts
src/context/AuthContext.tsx | src/hooks/useBrands.ts | src/hooks/useCurrentBrandRole.ts | src/store/draftEventStore.ts | src/store/liveEventStore.ts | src/utils/clearAllStores.ts
src/store/draftEventStore.ts | src/store/liveEventStore.ts
src/store/liveEventStore.ts | src/store/orderStoreHelpers.ts
src/store/draftEventStore.ts | src/store/liveEventStore.ts | src/utils/liveEventAdapter.ts
src/store/liveEventStore.ts | src/utils/liveEventAdapter.ts
src/store/draftEventStore.ts | src/store/liveEventStore.ts | src/utils/scheduleDateExpansion.ts
src/store/draftEventStore.ts | src/store/liveEventStore.ts | src/utils/recurrenceRule.ts | src/utils/scheduleDateExpansion.ts
src/context/AuthContext.tsx | src/hooks/useBrands.ts | src/hooks/useCurrentBrandRole.ts | src/store/draftEventStore.ts | src/utils/clearAllStores.ts | src/utils/liveEventConverter.ts
src/store/draftEventStore.ts | src/utils/liveEventConverter.ts
```

(14 entries; matches the 14 cycles madge identified at SPEC time.)

---

### 3.2 — M-2 DIAG-marker reaping at CLOSE (I-PROPOSED-L)

#### 3.2.1 — `.claude/skills/mingla-orchestrator/SKILL.md` edit

**Insertion point:** between current Step 1 (line 184-200, "Update ALL artifacts") and current Step 2 (line 201, "Provide commit message").

**New content to insert:**

```markdown
**Step 1.5 — DIAG-marker reaping (mandatory; META-ORCH-0744-PROCESS / I-PROPOSED-L)**

Before proceeding to Step 2 (commit message), grep the codebase for diagnostic
markers tied to the CLOSING ORCH-ID:

\`\`\`bash
grep -rn "\[ORCH-${CLOSING_ORCH_ID}-DIAG\]" \
  mingla-business/src/ mingla-business/app/ \
  app-mobile/src/ \
  supabase/functions/ \
  mingla-admin/src/ 2>/dev/null
\`\`\`

**Required outcome: ZERO matches.**

If matches exist, the orchestrator MUST:
(a) instruct the operator to remove them in the same commit as CLOSE artifacts
    BEFORE the CLOSE proceeds, OR
(b) explicitly register them as a follow-up ORCH (cleanup cycle) with operator
    approval — flagged in chat as a deviation, with the closing ORCH banner
    noting the deferred reaping.

Markers from PRIOR ORCHs (already closed earlier — pre-CLOSE residue) are NOT
in scope for THIS step. They belong to a one-time historical cleanup cycle
(e.g., the ORCH-0743 mass-delete handled the residue from ORCH-0728/0729/0730/
0733/0734-RW). Step 1.5 enforces ONLY for the CLOSING ORCH's own markers.

**Codified:** 2026-05-06 by META-ORCH-0744-PROCESS / I-PROPOSED-L.
```

**Insertion mechanics:** the implementor finds the existing `**Step 2 — Provide commit message:**` heading and inserts the Step 1.5 block immediately above it, preserving the existing Step 2-3-4 numbering.

#### 3.2.2 — No CI gate, no script

I-PROPOSED-L is a PROCESS invariant enforced by the orchestrator skill at CLOSE time, NOT a CI gate. No `.mjs` script for this gate. The invariant text in `INVARIANT_REGISTRY.md` documents the rule + cross-references the SKILL.md Step 1.5.

**Rationale:** DIAG markers don't appear in PRs in isolation — they appear inside a closing ORCH's IMPL commits. CI can't know which ORCH is closing. Only the orchestrator (mid-CLOSE) has that context. Process-time enforcement is correct here.

---

### 3.3 — M-3 Persist-key whitelist sync gate (I-PROPOSED-M)

#### 3.3.1 — Script: `.github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs`

**Purpose:** verify every Zustand persist `name:` literal in `mingla-business/src/store/*.ts` appears as a member of `KNOWN_MINGLA_KEYS` set in `reapOrphanStorageKeys.ts`. Drift fails CI.

**Implementation outline:**

```js
#!/usr/bin/env node
// I-PROPOSED-M — PERSIST-KEY-WHITELIST-SYNC
//
// Verifies every Zustand persist `name:` literal in
// mingla-business/src/store/*.ts appears in the KNOWN_MINGLA_KEYS Set
// in mingla-business/src/utils/reapOrphanStorageKeys.ts.
//
// Closes the latent destruction risk class surfaced by ORCH-0744 RC-2
// (ORCH-0742 bumped currentBrand.v13 -> v14 but the whitelist still said
// v12; if the reaper ever promoted to delete-mode, it would have wiped
// the live blob on every cold-start).
//
// Per SPEC_META_ORCH_0744_PROCESS_HARDENING.md §3.3.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";

const STORE_DIR = resolve("mingla-business/src/store");
const REAPER_PATH = resolve(
  "mingla-business/src/utils/reapOrphanStorageKeys.ts",
);

// Match: `name: "mingla-business.<store>.v<N>"` inside any *.ts file
const PERSIST_NAME_PATTERN = /name:\s*"(mingla-business\.[^"]+)"/g;

// Match: any string literal inside the KNOWN_MINGLA_KEYS Set declaration
const WHITELIST_BLOCK_PATTERN =
  /KNOWN_MINGLA_KEYS\s*=\s*new Set<string>\(\[([^\]]+)\]\)/m;
const STRING_LITERAL_PATTERN = /"([^"]+)"/g;

function extractPersistNames() {
  const names = new Map(); // name -> file
  const files = readdirSync(STORE_DIR).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const path = join(STORE_DIR, file);
    const content = readFileSync(path, "utf8");
    let match;
    PERSIST_NAME_PATTERN.lastIndex = 0;
    while ((match = PERSIST_NAME_PATTERN.exec(content)) !== null) {
      names.set(match[1], file);
    }
  }
  return names;
}

function extractWhitelist() {
  const content = readFileSync(REAPER_PATH, "utf8");
  const blockMatch = WHITELIST_BLOCK_PATTERN.exec(content);
  if (!blockMatch) {
    console.error(
      `[I-PROPOSED-M] FAIL — KNOWN_MINGLA_KEYS Set declaration not found ` +
      `in ${REAPER_PATH}. Refactor must preserve the recognizable shape.`,
    );
    process.exit(1);
  }
  const set = new Set();
  let match;
  STRING_LITERAL_PATTERN.lastIndex = 0;
  while ((match = STRING_LITERAL_PATTERN.exec(blockMatch[1])) !== null) {
    if (match[1].startsWith("mingla-business.")) {
      set.add(match[1]);
    }
  }
  return set;
}

function main() {
  const persistNames = extractPersistNames();
  const whitelist = extractWhitelist();

  const missingFromWhitelist = [];
  for (const [name, file] of persistNames) {
    if (!whitelist.has(name)) {
      missingFromWhitelist.push({ name, file });
    }
  }

  const stale = [];
  for (const name of whitelist) {
    if (![...persistNames.keys()].includes(name)) {
      stale.push(name);
    }
  }

  if (missingFromWhitelist.length > 0) {
    console.error(
      `[I-PROPOSED-M] FAIL — ${missingFromWhitelist.length} persist key(s) missing from KNOWN_MINGLA_KEYS:`,
    );
    for (const { name, file } of missingFromWhitelist) {
      console.error(`  - "${name}" (defined in ${file})`);
    }
    console.error(
      `\nAdd these entries to KNOWN_MINGLA_KEYS in ` +
      `mingla-business/src/utils/reapOrphanStorageKeys.ts BEFORE the persist key bump merges. ` +
      `Failing to do so creates a latent destruction risk if the reaper is ever ` +
      `promoted to delete-mode (the LIVE blob would be reported as orphan and ` +
      `wiped on every cold-start).`,
    );
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error(
      `[I-PROPOSED-M] FAIL — ${stale.length} stale entry(ies) in KNOWN_MINGLA_KEYS that no live persist uses:`,
    );
    for (const s of stale) {
      console.error(`  - "${s}"`);
    }
    console.error(
      `\nRemove these stale entries from reapOrphanStorageKeys.ts. ` +
      `Stale whitelist entries don't crash today but mislead future maintainers.`,
    );
    process.exit(1);
  }

  console.log(
    `[I-PROPOSED-M] PASS — ${persistNames.size} persist key(s) match ${whitelist.size} whitelist entry(ies) exactly.`,
  );
  process.exit(0);
}

main();
```

**Edge cases:**
- New store added without persist (pure in-memory) → no `name:` literal matched → not flagged. (Correct — non-persisted stores don't need whitelist entries.)
- `name:` literal in a string-literal expression with template strings or concatenation → NOT matched by the simple `/name:\s*"..."/` regex. **SPEC defers complex name composition to a future enhancement;** for now, all 11 existing stores use plain literals.
- `name:` appearing in a JSDoc block or comment → matched by the regex. **Implementor must ensure the regex is scoped to source-token positions, not comments.** Workaround: pre-strip multi-line `/* */` and single-line `//` comments before regex (cheap; ~10 LOC additional).

**Implementor note:** the comment-stripping addition is mandatory; without it, future docblocks mentioning "name: " could spuriously trip the gate. Add this in implementation; it's NOT optional.

#### 3.3.2 — Workflow job

```yaml
  i-proposed-m-persist-key-whitelist:
    name: "I-PROPOSED-M: persist-key whitelist sync"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run I-PROPOSED-M gate
        run: node .github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs
```

(No deps install needed — pure Node ESM with built-in `fs` + `path`.)

---

### 3.4 — M-4 TRANSITIONAL exit-condition lint (I-PROPOSED-N)

#### 3.4.1 — Script: `.github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs`

**Purpose:** verify every `[TRANSITIONAL]` marker in `mingla-business/src/ + app/` has an exit-condition keyword within 5 lines. Initial deploy is **warn-only** (existing 9 violators don't break CI). Promotes to fail-mode after ORCH-0748 cleans the violators.

**Implementation outline:**

```js
#!/usr/bin/env node
// I-PROPOSED-N — TRANSITIONAL-EXIT-CONDITIONED
//
// Verifies every [TRANSITIONAL] marker in mingla-business/src/ + app/ has an
// exit-condition keyword within 5 lines (Const #7 enforcement).
//
// Initial deploy: WARN-ONLY (9 known violators baselined in
// Mingla_Artifacts/.transitional-baseline.txt). Promotes to FAIL-MODE after
// ORCH-0748 cleans the violators.
//
// Per SPEC_META_ORCH_0744_PROCESS_HARDENING.md §3.4.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import process from "node:process";

const TARGET_ROOTS = [
  resolve("mingla-business/src"),
  resolve("mingla-business/app"),
];
const BASELINE_PATH = resolve("Mingla_Artifacts/.transitional-baseline.txt");

const TRANSITIONAL_PATTERN = /\[TRANSITIONAL\]/;
const EXIT_KEYWORDS = [
  /\bEXIT\b/i,
  /exits when/i,
  /exit condition/i,
  /\bCycle\s+[0-9A-Z]+/,
  /\bB-cycle\b/i,
  /\bB[0-9]+\b/,
  /\bORCH-[0-9]{4}/,
];

const FILE_EXTENSIONS = [".ts", ".tsx"];

function* walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__" || entry === "__snapshots__") {
        continue;
      }
      yield* walk(path);
    } else if (FILE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      yield path;
    }
  }
}

function findViolations() {
  const violations = [];
  for (const root of TARGET_ROOTS) {
    for (const file of walk(root)) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!TRANSITIONAL_PATTERN.test(lines[i])) continue;
        // Look ahead 5 lines for an exit-condition keyword
        const window = lines.slice(i, Math.min(i + 6, lines.length)).join("\n");
        const hasExit = EXIT_KEYWORDS.some((re) => re.test(window));
        if (!hasExit) {
          violations.push({
            file: relative(resolve("."), file),
            line: i + 1,
            text: lines[i].trim().slice(0, 100),
          });
        }
      }
    }
  }
  return violations;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  const lines = readFileSync(BASELINE_PATH, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
  return new Set(lines);
}

function main() {
  const violations = findViolations();
  const baseline = readBaseline();

  const newViolations = violations.filter(
    (v) => !baseline.has(`${v.file}:${v.line}`),
  );

  if (violations.length > 0) {
    console.warn(
      `[I-PROPOSED-N] WARN — ${violations.length} TRANSITIONAL marker(s) without exit-condition keyword in 5-line window:`,
    );
    for (const v of violations) {
      const isNew = !baseline.has(`${v.file}:${v.line}`);
      const tag = isNew ? "NEW" : "BASELINE";
      console.warn(`  [${tag}] ${v.file}:${v.line} — ${v.text}`);
    }
  }

  if (newViolations.length > 0) {
    console.error(
      `\n[I-PROPOSED-N] FAIL — ${newViolations.length} NEW TRANSITIONAL marker(s) added without exit-condition keyword (vs baseline). ` +
      `Each [TRANSITIONAL] must be followed within 5 lines by an exit keyword: ` +
      `EXIT, exits when, exit condition, Cycle X, B-cycle, B<N>, ORCH-NNNN. Const #7 enforcement.`,
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      `[I-PROPOSED-N] PASS — zero TRANSITIONAL markers without exit-condition.`,
    );
  } else {
    console.log(
      `[I-PROPOSED-N] PASS-with-baseline — ${violations.length} known violator(s); zero new ones added.`,
    );
  }
  process.exit(0);
}

main();
```

#### 3.4.2 — Baseline file: `Mingla_Artifacts/.transitional-baseline.txt`

```
# TRANSITIONAL exit-condition baseline — META-ORCH-0744-PROCESS / I-PROPOSED-N
# Captured 2026-05-06 from ORCH-0744 forensics §HF-4 + verified at SPEC time.
#
# Format: file:line (relative to repo root). One violator per line.
# Comments allowed via leading #.
#
# These 9 violators are deferred to ORCH-0748 (TRANSITIONAL audit cycle).
# Once ORCH-0748 fixes them, REMOVE the matching lines here in the same PR.
# Once this baseline is empty, gate promotes to fail-mode (M-4 Phase 2).
#
# Cross-reference:
#   - INVARIANT_REGISTRY.md I-PROPOSED-N
#   - .github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs
#   - SPEC_META_ORCH_0744_PROCESS_HARDENING.md §3.4.2
#   - ORCH-0744 INVESTIGATION_ORCH_0744_LATENT_DEFECTS_SWEEP.md §HF-4

mingla-business/src/utils/guestCsvExport.ts:300
mingla-business/src/components/brand/BrandProfileView.tsx:62
mingla-business/src/components/brand/BrandProfileView.tsx:264
mingla-business/src/components/brand/BrandProfileView.tsx:294
mingla-business/src/components/event/PublicEventPage.tsx:168
mingla-business/src/components/event/PublicEventPage.tsx:800
mingla-business/src/hooks/useCurrentBrandRole.ts:91
mingla-business/src/hooks/useCurrentBrandRole.ts:158
mingla-business/app/event/[id]/index.tsx:313
```

(Implementor verifies these 9 line numbers at IMPL time — line numbers may have drifted post-ORCH-0743 commits; if drift, baseline reflects current state.)

#### 3.4.3 — Workflow job

```yaml
  i-proposed-n-transitional-exit-condition:
    name: "I-PROPOSED-N: TRANSITIONAL exit-condition lint"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Run I-PROPOSED-N gate
        run: node .github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs
```

---

### 3.5 — M-5 Web-deprecation parser (I-PROPOSED-X)

#### 3.5.1 — Script: `.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs`

**Purpose:** parse captured stderr from `expo export -p web` and fail CI on any deprecation warning OR any `Property '<X>' doesn't exist` error referring to mingla-business sources. Filters out dependency-source warnings (Stripe Connect SDK, Sentry RN, etc.).

**Implementation outline:**

```js
#!/usr/bin/env node
// I-PROPOSED-X — WEB-EXPORT-CLEAN
//
// Parses captured stderr from `expo export -p web` and fails CI on:
//   1. Any "shadow* style props are deprecated" warnings
//   2. Any "textShadow*" deprecated warnings
//   3. Any "elevation" not-supported warnings
//   4. Any "Property '<X>' doesn't exist" errors referring to mingla-business sources
//
// Filters out dependency-source warnings (e.g., Stripe Connect SDK SSR
// pre-render messages, Sentry RN polyfill noise) by checking the file path
// in the warning context.
//
// Per SPEC_META_ORCH_0744_PROCESS_HARDENING.md §3.5.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const STDERR_LOG_PATH = process.argv[2] ?? resolve("/tmp/expo-export-web.stderr");

const FAIL_PATTERNS = [
  {
    re: /"shadow\*"\s+style\s+props\s+are\s+deprecated/i,
    label: "shadow* deprecation",
  },
  {
    re: /"textShadow\*?"\s+style\s+props?\s+are\s+deprecated/i,
    label: "textShadow* deprecation",
  },
  {
    re: /"elevation"\s+(?:style\s+prop|not\s+supported)/i,
    label: "elevation deprecation",
  },
];

// "Property 'X' doesn't exist" errors — only fail if traced to a
// mingla-business source file. Dependency-source errors (node_modules) pass.
const PROPERTY_NOT_EXIST_RE =
  /Property\s+'([^']+)'\s+doesn't\s+exist/g;

function main() {
  if (!existsSync(STDERR_LOG_PATH)) {
    console.error(
      `[I-PROPOSED-X] FAIL — stderr log not found at ${STDERR_LOG_PATH}. ` +
      `Workflow step must capture expo export stderr to this path BEFORE running this gate.`,
    );
    process.exit(2);
  }

  const stderr = readFileSync(STDERR_LOG_PATH, "utf8");
  const violations = [];

  for (const pattern of FAIL_PATTERNS) {
    const matches = stderr.match(new RegExp(pattern.re, "gi")) || [];
    if (matches.length > 0) {
      violations.push({
        kind: pattern.label,
        count: matches.length,
        sample: matches[0],
      });
    }
  }

  // Property-not-exist: only fail if context mentions a mingla-business file
  PROPERTY_NOT_EXIST_RE.lastIndex = 0;
  let propMatch;
  while ((propMatch = PROPERTY_NOT_EXIST_RE.exec(stderr)) !== null) {
    // Extract a 200-char window of context around the match
    const start = Math.max(0, propMatch.index - 100);
    const end = Math.min(stderr.length, propMatch.index + 200);
    const context = stderr.slice(start, end);
    // Only fail if context references a mingla-business/ source
    if (/mingla-business\/(src|app)\//.test(context)) {
      violations.push({
        kind: `Property '${propMatch[1]}' doesn't exist (mingla-business source)`,
        count: 1,
        sample: propMatch[0],
      });
    }
  }

  if (violations.length > 0) {
    console.error(
      `[I-PROPOSED-X] FAIL — ${violations.length} web-deprecation violation(s):`,
    );
    for (const v of violations) {
      console.error(`  - ${v.kind} (${v.count}x) — sample: "${v.sample}"`);
    }
    console.error(
      `\nFix each warning OR (if from a dependency we can't control) ` +
      `add an explicit allowlist entry in this script's source.`,
    );
    process.exit(1);
  }

  console.log(`[I-PROPOSED-X] PASS — zero web-deprecation warnings.`);
  process.exit(0);
}

main();
```

#### 3.5.2 — Workflow modification

The existing strict-grep workflow does NOT currently run `expo export -p web` — that's part of the standard PR check elsewhere (or is run manually). M-5 introduces this as a NEW workflow job that BOTH runs the export AND runs the parser.

```yaml
  i-proposed-x-web-deprecation:
    name: "I-PROPOSED-X: web-export deprecation parser"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install mingla-business deps
        working-directory: mingla-business
        run: npm install --no-save
      - name: Run expo export -p web (capture stderr)
        working-directory: mingla-business
        env:
          EXPO_PUBLIC_SUPABASE_URL: https://stub.supabase.co
          EXPO_PUBLIC_SUPABASE_ANON_KEY: stub_key_for_ci_export
        run: npx expo export -p web 2>/tmp/expo-export-web.stderr || true
      - name: Run I-PROPOSED-X parser
        run: node .github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs /tmp/expo-export-web.stderr
```

**Caveats:**
- `expo export -p web` is slow (~2 min on CI). M-5 adds CI time; acceptable per dispatch SC-General-1's 2-minute combined budget if this is the only slow gate.
- The `|| true` after the expo command ensures the workflow proceeds to the parser even if expo's exit code is nonzero (the parser is the authoritative judge — expo may exit nonzero for non-mingla-business reasons we don't want to block on).
- Stub env vars: required because the supabase client throws at module init if the URL is invalid. Stub avoids this in CI without leaking real credentials.

---

### 3.6 — Cross-cutting documentation

#### 3.6.1 — `.github/scripts/strict-grep/README.md` update

Add 5 new rows to the "Active gates registered" table (post-CLOSE — flips DRAFT→ACTIVE):

```markdown
| I-PROPOSED-K | `i-proposed-k-require-cycles.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-K |
| I-PROPOSED-L | (process invariant — orchestrator skill SKILL.md Step 1.5; no script) | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-L |
| I-PROPOSED-M | `i-proposed-m-persist-key-whitelist.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-M |
| I-PROPOSED-N | `i-proposed-n-transitional-exit-condition.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-N |
| I-PROPOSED-X | `i-proposed-x-web-deprecation.mjs` | META-ORCH-0744 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-X |
```

#### 3.6.2 — `Mingla_Artifacts/INVARIANT_REGISTRY.md` update — 5 NEW invariant entries

Add as DRAFT during IMPL phase; orchestrator flips to ACTIVE on CLOSE per Extension Step 5e (which DOES NOT run for this cycle since META-ORCH-0744-PROCESS is purely additive — but the invariant text itself is added by IMPL).

For each invariant K, L, M, N, X: include statement, authority (script/SKILL.md path), enforcement (CI gate or process step), test that catches regression, established date, cross-references. Match the template of existing entries (e.g., I-PROPOSED-J).

Implementor copies the long-form invariant text from this SPEC §6 (below) into the registry verbatim.

---

## 4. Five-truth-layer audit

| Layer | Verification |
|---|---|
| **Docs** | `feedback_strict_grep_registry_pattern.md` codifies one-script-one-job per gate. `.github/scripts/strict-grep/README.md` documents 4-step add-a-gate procedure. ORCH-0744 forensics §7 documents the 5 meta-findings. SPEC §3.x verbatim follows the registry pattern — no parallel files. |
| **Schema** | N/A — no DB / RLS / migration changes. |
| **Code** | M-1 reads via `madge` from `mingla-business/src/ + app/`. M-3 reads `mingla-business/src/store/*.ts` + `reapOrphanStorageKeys.ts`. M-4 reads `mingla-business/src/ + app/` walking TS/TSX files. M-5 reads stderr of `expo export -p web`. M-2 is process-only — no code reads. All scripts run from repo root in CI runners. |
| **Runtime** | Each gate must run in <30s in CI. M-1 madge: 685ms locally, expect <5s in CI. M-3 grep-equivalent: <1s. M-4 walk: <2s for 200 files. M-5 expo export: ~2 min (slowest gate). Combined ~3 min — slightly above the dispatch's 2-min budget; acceptable trade-off OR M-5 split to a separate slower workflow if needed. |
| **Data** | N/A. The baseline files (`mingla-business/.metro-cycle-baseline.txt`, `Mingla_Artifacts/.transitional-baseline.txt`) are checked in; no AsyncStorage / DB changes. |

---

## 5. Success criteria

| ID | Criterion | Verification |
|----|-----------|--------------|
| SC-1 | M-1 script `i-proposed-k-require-cycles.mjs` exists at `.github/scripts/strict-grep/`. New job in workflow YAML runs it. | grep + workflow read |
| SC-2 | Baseline file `mingla-business/.metro-cycle-baseline.txt` checked in with the 14 known cycles in the exact normalized format from §3.1.3. | direct file read |
| SC-3 | M-1 PASSES against the current `Seth` HEAD (zero NEW cycles vs baseline). Implementor runs locally to confirm. | local run |
| SC-4 | M-1 FAILS on a deliberate-cycle fixture: implementor temporarily creates a 2-file `A↔B` cycle in a fixture directory, runs the gate, confirms exit code 1 with the new cycle named in the error message. | local fixture test |
| SC-5 | M-2 SKILL.md edit lives at `.claude/skills/mingla-orchestrator/SKILL.md` between the existing Step 1 and Step 2 of Mode: CLOSE. The grep command in Step 1.5 is exact + executable. The escalation path (a/b options) is documented. | direct file read |
| SC-6 | M-3 script `i-proposed-m-persist-key-whitelist.mjs` exists; new workflow job runs it. | grep + workflow read |
| SC-7 | M-3 PASSES against the current `Seth` HEAD: 11 persist names match 11 whitelist entries exactly. | local run |
| SC-8 | M-3 FAILS on a deliberate-mismatch fixture: implementor temporarily edits one store's `name:` to a v15, runs the gate, confirms exit code 1 with the missing entry named. | local fixture test |
| SC-9 | M-3 ignores `name:` literals appearing inside `/* */` or `//` comments (comment-stripping pre-pass). Test: implementor adds a docblock `// name: "fake-key"` and confirms gate still passes. | local fixture test |
| SC-10 | M-4 script `i-proposed-n-transitional-exit-condition.mjs` exists; new workflow job runs it. | grep + workflow read |
| SC-11 | Baseline file `Mingla_Artifacts/.transitional-baseline.txt` checked in with the 9 known violators (line numbers verified at IMPL time). | direct file read |
| SC-12 | M-4 PASSES-with-baseline against current `Seth` HEAD: 9 violators match baseline; zero new ones. | local run |
| SC-13 | M-4 FAILS on a deliberate-new-violator fixture: implementor adds a `[TRANSITIONAL]` marker WITHOUT an exit keyword in a non-baseline file, runs the gate, confirms exit code 1. | local fixture test |
| SC-14 | M-4 PASSES on a `[TRANSITIONAL]` marker WITH any of the 7 exit keywords in the 5-line window (EXIT / exits when / exit condition / Cycle X / B-cycle / Bn / ORCH-NNNN). All 7 keyword variants tested. | local fixture test |
| SC-15 | M-5 script `i-proposed-x-web-deprecation.mjs` exists; new workflow job runs `expo export -p web` then the parser. | grep + workflow read |
| SC-16 | M-5 PASSES against current `Seth` HEAD: zero shadow*/textShadow*/elevation deprecation warnings (post-ORCH-0743 CF-2 fix). | CI run |
| SC-17 | M-5 FAILS on a deliberate-violator fixture: implementor temporarily reverts ORCH-0743 CF-2 (re-introduces RN-only textShadow* triple in event/[id]/index.tsx hero), runs the workflow, confirms exit code 1 with the deprecation labeled. | local CI-equivalent |
| SC-18 | M-5 filters out dependency-source warnings: a Stripe Connect SDK or Sentry SSR pre-render warning does NOT trigger the gate (the `Property '<X>' doesn't exist` filter only fails if the context mentions `mingla-business/src/` or `mingla-business/app/`). | code read |
| SC-19 | `.github/scripts/strict-grep/README.md` "Active gates registered" table includes 5 new rows for K, L, M, N, X. | direct file read |
| SC-20 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` includes 5 new entries for K, L, M, N, X (DRAFT during IMPL; flipped to ACTIVE on CLOSE per Extension Step 5e — but Extension is N/A for this cycle so flip happens via standard CLOSE artifact update). | direct file read |
| SC-21 | All 5 gates run in <3 min combined CI time on a fresh PR. M-5 dominates (~2 min for `expo export`). | CI run timing |
| SC-22 | Each gate's failure error-message names exact file:line + violating pattern + suggested fix. (Pattern compliance with existing 13 strict-grep scripts.) | code read |

---

## 6. Invariants

### 6.1 — Preserved (no change)

- Const #1 through #14 — no functional code changes.
- All ACTIVE invariants in registry (I-32, I-37, I-38, I-39, I-PROPOSED-A/C/H/I/J, I-COLLAGE-PHOTO-URL-AT-TILE-RESOLUTION, I-TRIAL-CITY-RUNS-CANONICAL, I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS) — orthogonal.
- DRAFT Stripe invariants (I-PROPOSED-O/P/Q/R/S/T/U/V) — orthogonal.

### 6.2 — NEW invariants this SPEC establishes (5)

#### I-PROPOSED-K — REQUIRE-CYCLES-BASELINED

**Statement:** every require-cycle in `mingla-business/src/ + app/` is either (a) listed in `mingla-business/.metro-cycle-baseline.txt` (legacy cycle, awaiting structural refactor in a future ORCH) OR (b) a NEW cycle that fails CI before merge.

**Authority:** `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs` runs `madge --circular` against `mingla-business/src/ + app/` and compares to baseline. Workflow job in `.github/workflows/strict-grep-mingla-business.yml`.

**Why:** ORCH-0742 introduced a require-cycle that the SPEC §4.2 explicitly tried to prevent; nobody caught it. ORCH-0744 forensics surfaced 14 pre-existing cycles. New cycles MUST be justified or eliminated before merge, not allowed to pile up silently.

**Enforcement (3 gates):**
1. **CI script** — `i-proposed-k-require-cycles.mjs`. Fails on any new cycle vs baseline.
2. **Baseline file** — `mingla-business/.metro-cycle-baseline.txt`. Operator-owned. Lines added (new cycle accepted) or removed (cycle fixed) ALWAYS in the same PR as the import-graph change.
3. **PR review discipline** — when baseline is modified, reviewer MUST inspect why (cycle added or fixed) and verify rationale.

**Test catches a regression:** any code change introducing a NEW cycle (not in baseline) fails CI. Operator must either fix the cycle OR add it to baseline with PR-comment justification.

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- Baseline format change requires bumping the script's normalization function. Tracked in script header.
- madge could miss dynamic `require()` cycles (script catches static `import` cycles only). Mingla-business uses ESM imports exclusively post-ORCH-0743 RC-1, so this is acceptable.
- The 14-cycle baseline is operationally large. ORCH-0746 (queued) will start shrinking it.

**Cross-references:** SPEC §3.1, ORCH-0744 forensics §3 RC-1 + CF-1, ORCH-0746 (queued).

---

#### I-PROPOSED-L — DIAG-MARKERS-REAPED-AT-CLOSE

**Statement:** `[ORCH-XXXX-DIAG]` markers introduced by an ORCH MUST be removed in the same CLOSE that closes that ORCH. Markers from PRIOR closed ORCHs (residue) require a separate dedicated cleanup cycle.

**Authority:** `.claude/skills/mingla-orchestrator/SKILL.md` Mode: CLOSE Step 1.5 (NEW per this SPEC §3.2).

**Why:** ORCH-0728/0729/0730/0733/0734-RW all closed PASS while leaving 15 `[ORCH-XXXX-DIAG]` console.error blocks in production code. Each had a comment saying "removed at full IMPL CLOSE" but no CLOSE step enforced this. ORCH-0743 had to mass-delete them after the fact.

**Enforcement:** PROCESS-time (orchestrator at CLOSE), NOT CI-time. CI can't know which ORCH is closing — only the orchestrator (mid-CLOSE) has that context. Step 1.5 grep must return zero matches before CLOSE proceeds to Step 2.

**Test catches a regression:** any future CLOSE where the orchestrator skips Step 1.5 results in DIAG markers persisting. The check is in the skill prompt itself; future orchestrator sessions that follow the skill will execute Step 1.5 unconditionally.

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- This is a process invariant, not a CI invariant. No automated enforcement at PR-time. Requires orchestrator skill discipline.
- Pre-cycle DIAG residue (markers from prior CLOSED ORCHs) is OUT OF SCOPE for this invariant — those need a one-time cleanup cycle (already happened in ORCH-0743 for the 15 markers from 5 ORCHs).

**Cross-references:** SPEC §3.2, ORCH-0744 forensics §M-2, ORCH-0743 CF-3 mass-delete.

---

#### I-PROPOSED-M — PERSIST-KEY-WHITELIST-SYNC

**Statement:** every Zustand persist `name: "mingla-business.<store>.v<N>"` literal in `mingla-business/src/store/*.ts` MUST appear as a string literal in `KNOWN_MINGLA_KEYS` set inside `mingla-business/src/utils/reapOrphanStorageKeys.ts`. No drift permitted in either direction (missing-from-whitelist OR stale-in-whitelist).

**Authority:** `.github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs`. Workflow job in strict-grep-mingla-business.yml.

**Why:** ORCH-0742 bumped `currentBrand.v13 → v14` but didn't update the reaper whitelist. Result: ORCH-0742's live `v14` blob reported as ORPHAN every cold-start. If anyone ever promoted the reaper from log-only to delete-mode (Cycle 17d §D explicitly plans this), it would silently wipe the live blob on every cold-start, undoing ORCH-0742 entirely. **Latent destruction risk.**

**Enforcement (2 gates):**
1. **CI script** — `i-proposed-m-persist-key-whitelist.mjs`. Fails on any persist-name not in whitelist OR any whitelist entry not matching a live persist.
2. **Per-store unit test (already shipped in ORCH-0743)** — `src/utils/__tests__/reapOrphanStorageKeys.test.ts` pins the v14 entry specifically; broader test would be added per-store as new persists are introduced.

**Test catches a regression:** any persist-key bump (e.g., `currentBrand.v14 → v15` in a future cycle) that forgets to update the whitelist fails CI on the same PR.

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- Pure literal `name:` matching only. Template strings or dynamic composition not supported (none currently used; future SPEC required if pattern emerges).
- Comment-stripping pre-pass required to prevent docblock false-positives.
- Cross-domain: this gate only checks mingla-business stores. App-mobile + other domains require their own gates (future cycle).

**Cross-references:** SPEC §3.3, ORCH-0744 forensics RC-2 (the latent destruction surface), ORCH-0743 RC-2 fix + unit test.

---

#### I-PROPOSED-N — TRANSITIONAL-EXIT-CONDITIONED

**Statement:** every `[TRANSITIONAL]` marker in `mingla-business/src/ + app/` MUST have an exit-condition keyword (`EXIT`, `exits when`, `exit condition`, `Cycle X`, `B-cycle`, `B<N>`, `ORCH-NNNN`) within 5 lines of the marker. Const #7 enforcement (label temporary fixes — tracked, owned, exit-conditioned).

**Authority:** `.github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs`. Workflow job in strict-grep-mingla-business.yml.

**Why:** ORCH-0744 forensics §HF-4 found 9 of 29 `[TRANSITIONAL]` markers without exit conditions. Const #7 is honor-system without enforcement; markers become permanent quietly.

**Enforcement (2 phases):**
1. **Phase 1 (THIS CYCLE) — WARN-MODE:** `Mingla_Artifacts/.transitional-baseline.txt` lists the 9 known violators; gate WARNS on each existing violator + FAILS on any NEW violator added vs baseline. Existing 9 don't break CI.
2. **Phase 2 (post-ORCH-0748):** ORCH-0748 fixes the 9 violators; baseline file becomes empty; gate promotes to FAIL-MODE on any TRANSITIONAL without exit condition.

**Test catches a regression:** new `[TRANSITIONAL]` marker added without an exit keyword fails CI immediately. Existing violators logged but don't block (until Phase 2 promotion).

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT WARN-MODE — flips ACTIVE on CLOSE; flips FAIL-MODE on ORCH-0748 CLOSE).

**Caveats:**
- 5-line window is a heuristic. A marker followed by an exit-condition 6 lines later spuriously triggers; operator works around with re-formatting OR an explicit allowlist comment.
- Baseline format `file:line` requires line-number stability. Heavy refactors (cycle 17d-class) shift line numbers; baseline needs simultaneous update in those PRs.

**Cross-references:** SPEC §3.4, ORCH-0744 forensics §HF-4, ORCH-0748 (queued — TRANSITIONAL audit cycle).

---

#### I-PROPOSED-X — WEB-EXPORT-CLEAN

**Statement:** `expo export -p web` stderr from `mingla-business/` MUST contain ZERO `"shadow*" / "textShadow*" / "elevation"` deprecation warnings AND ZERO `Property '<X>' doesn't exist` errors traceable to mingla-business sources (admin, supabase, app-mobile out of scope; dependency-source warnings allowed).

**Authority:** `.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs`. Workflow job runs `expo export -p web` AND the parser.

**Why:** ORCH-0744 forensics §CF-2 found `textShadow*` props on `event/[id]/index.tsx` hero — RN-only props that react-native-web silently strips, making the shadow invisible on web. The Metro deprecation warning had been printed for who-knows-how-long without anyone reading it. ORCH-0743 fixed the one site; this gate prevents new instances.

**Enforcement (1 gate):**
1. **CI script + parser** — `i-proposed-x-web-deprecation.mjs`. Pipes captured stderr from `expo export -p web` through pattern matchers. Fails on any of the 4 violation classes.

**Test catches a regression:** any new RN-only style prop added to mingla-business code fails CI on the same PR. The parser also catches `Property doesn't exist` errors specifically when traced to mingla-business sources (filters out Stripe SDK / Sentry SSR / other dependency-source noise).

**Established:** META-ORCH-0744-PROCESS / 2026-05-06 (DRAFT — flips ACTIVE on CLOSE).

**Caveats:**
- `expo export -p web` is the slowest gate (~2 min on CI). Acceptable trade-off; can be moved to a slower-cadence workflow if PR cycle time becomes an issue.
- ESLint rule banning inline `elevation:` outside designSystem is deferred to a future cycle (would catch BEFORE export). For now: parser-on-stderr is the catch.
- Stub Supabase env vars required for export to complete; these are CI-only and never leak production credentials.

**Cross-references:** SPEC §3.5, ORCH-0744 forensics §CF-2, ORCH-0743 CF-2 fix.

---

## 7. Test cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | M-1 PASS — baseline matches live | Run gate against `Seth` HEAD `22fe5507` | exit 0; stdout `[I-PROPOSED-K] PASS — 14 cycle(s) match baseline. Zero new cycles introduced.` | M-1 |
| T-02 | M-1 FAIL — new cycle introduced | Add `import "../foo"` line creating a 15th cycle | exit 1; stderr lists the new cycle | M-1 |
| T-03 | M-1 WARN — cycle removed (e.g., post-ORCH-0746 progress) | Remove a baseline cycle without updating baseline file | exit 0 (still passes; warn-only) + stderr lists stale baseline entry | M-1 |
| T-04 | M-2 enforced at CLOSE — markers present | CLOSING ORCH-XXXX has 1+ `[ORCH-XXXX-DIAG]` markers | Orchestrator skill grep returns N>0; orchestrator instructs operator to remove or escalate | M-2 |
| T-05 | M-2 enforced at CLOSE — markers absent | CLOSING ORCH-XXXX has zero markers | Orchestrator grep returns 0; CLOSE proceeds to Step 2 | M-2 |
| T-06 | M-3 PASS — all persists in whitelist | Run gate against `Seth` HEAD | exit 0; 11 names match 11 entries | M-3 |
| T-07 | M-3 FAIL — new persist not in whitelist | Add a new store with `name: "mingla-business.fooStore.v1"`; do NOT add to whitelist | exit 1; stderr names `fooStore.v1` as missing | M-3 |
| T-08 | M-3 FAIL — stale whitelist entry | Add `"mingla-business.bogusStore.v9"` to whitelist with no matching live persist | exit 1; stderr names the stale entry | M-3 |
| T-09 | M-3 ignores comment occurrences | Add docblock `// example: name: "mingla-business.example.v1"` in some file | exit 0 (gate passes; comment-stripping pre-pass works) | M-3 |
| T-10 | M-4 PASS-with-baseline | Run against `Seth` HEAD; 9 violators match baseline | exit 0; stderr WARN lists 9 baselined violators | M-4 |
| T-11 | M-4 FAIL — new violator | Add `[TRANSITIONAL]` comment in any non-baseline file with no exit keyword in 5-line window | exit 1; stderr names the new file:line | M-4 |
| T-12 | M-4 PASS — all 7 exit keywords | Add `[TRANSITIONAL]` comments with EXIT / exits when / exit condition / Cycle X / B-cycle / B5 / ORCH-9999 in 5-line window (one per fixture) | exit 0; all 7 keyword variants accepted | M-4 |
| T-13 | M-5 PASS — clean web export | Run gate against `Seth` HEAD post-ORCH-0743 CF-2 fix | exit 0; stdout `zero web-deprecation warnings` | M-5 |
| T-14 | M-5 FAIL — textShadow* deprecation | Revert ORCH-0743 CF-2 (re-add RN-only `textShadowColor` etc.); run web export + parser | exit 1; stderr names "textShadow* deprecation" | M-5 |
| T-15 | M-5 FAIL — Property-not-exist in mingla-business | Add a deliberate typo `globalThis.foo.bar` in `mingla-business/src/` triggering an SSR property error | exit 1; stderr names the property + mingla-business file context | M-5 |
| T-16 | M-5 IGNORES dep-source warnings | Stripe Connect SDK or Sentry RN print SSR warnings during export | exit 0; gate filters these by file-path context | M-5 |
| T-17 | All 5 gates parallel timing | All 5 jobs run on a single PR | combined CI time <3 min | cross |
| T-18 | INVARIANT_REGISTRY entries DRAFT during IMPL | Inspect registry post-implementor, pre-CLOSE | 5 new entries marked `(DRAFT — flips ACTIVE on META-ORCH-0744-PROCESS CLOSE)` | doc |
| T-19 | INVARIANT_REGISTRY entries ACTIVE post-CLOSE | Inspect registry post-CLOSE | 5 entries marked `ACTIVE` | doc |

---

## 8. Implementation order

Database → edge fns → services → hooks → components convention. SPEC has no DB / edge / service / hook / component changes. Order is: **scripts → workflow → docs → registry**. Each step ends with a local sanity check.

**Step 1 — Bootstrap M-1 (baseline file + script):**
1.1 — Run `cd mingla-business && npx --yes madge --circular --extensions ts,tsx src/ app/` locally; capture the 14 cycles (or whatever the count is at IMPL time).
1.2 — Create `mingla-business/.metro-cycle-baseline.txt` with normalized format (alphabetically sorted, ` | ` joined, comments header).
1.3 — Create `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs` per §3.1.1.
1.4 — Run script locally; verify exit 0.
1.5 — Run a deliberate-violator fixture (add a new cycle locally); verify exit 1.

**Step 2 — Bootstrap M-3 (script):**
2.1 — Create `.github/scripts/strict-grep/i-proposed-m-persist-key-whitelist.mjs` per §3.3.1.
2.2 — Run locally; verify exit 0 (11 names match 11 whitelist entries).
2.3 — Deliberate-mismatch fixture: temporarily change one store's `name:` to a v15; verify exit 1; revert.
2.4 — Comment-stripping fixture: add a fake `name:` in a comment; verify exit 0; remove fixture.

**Step 3 — Bootstrap M-4 (baseline + script):**
3.1 — Verify the 9 violators from §3.4.2 still match current line numbers (post-ORCH-0743 the line numbers may have drifted; if so, baseline reflects current state).
3.2 — Create `Mingla_Artifacts/.transitional-baseline.txt` with the verified violators.
3.3 — Create `.github/scripts/strict-grep/i-proposed-n-transitional-exit-condition.mjs` per §3.4.1.
3.4 — Run locally; verify PASS-with-baseline (9 violators match; zero new).
3.5 — Deliberate-new-violator fixture; verify exit 1.

**Step 4 — Bootstrap M-5 (script + workflow change):**
4.1 — Create `.github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs` per §3.5.1.
4.2 — Locally run `cd mingla-business && EXPO_PUBLIC_SUPABASE_URL=https://stub.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=stub_key npx expo export -p web 2>/tmp/expo-export-web.stderr`; then `node .github/scripts/strict-grep/i-proposed-x-web-deprecation.mjs /tmp/expo-export-web.stderr` — verify exit 0.
4.3 — Deliberate-violator fixture (revert ORCH-0743 CF-2 textShadow fix locally); re-run export + parser; verify exit 1; revert fixture.

**Step 5 — Wire up workflow YAML (5 new jobs):**
5.1 — Append i-proposed-k job per §3.1.2 to `.github/workflows/strict-grep-mingla-business.yml`.
5.2 — Append i-proposed-m job per §3.3.2.
5.3 — Append i-proposed-n job per §3.4.3.
5.4 — Append i-proposed-x job per §3.5.2.
5.5 — Update the workflow header comment (currently lists 13 active gates) to add the 5 new gates.

**Step 6 — M-2 SKILL.md edit:**
6.1 — Edit `.claude/skills/mingla-orchestrator/SKILL.md` to insert Step 1.5 between current Step 1 and Step 2 of Mode: CLOSE per §3.2.1.

**Step 7 — Update strict-grep README + INVARIANT_REGISTRY:**
7.1 — Update `.github/scripts/strict-grep/README.md` "Active gates registered" table per §3.6.1.
7.2 — Add 5 new invariant entries (K, L, M, N, X) to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §6.2 — long-form, DRAFT during IMPL.
7.3 — Update `mingla-business/src/utils/reapOrphanStorageKeys.ts:23` comment from `I-PROPOSED-L (PERSIST-KEY-WHITELIST-SYNC)` to `I-PROPOSED-M (PERSIST-KEY-WHITELIST-SYNC)` — fixes drift D-IMPL-PRE-3 surfaced at implementor Pre-Flight.

**Step 8 — Final verification:**
8.1 — Run all 5 gates locally; verify all pass.
8.2 — Run a deliberate-violator fixture for each (5 separate test runs); verify all fail with clear error messages.
8.3 — Push branch; observe full CI run; confirm 5 new jobs appear + all pass.

**Step 9 — Implementation report:**
Write `Mingla_Artifacts/reports/IMPLEMENTATION_META_ORCH_0744_PROCESS_REPORT.md` per implementor template. Include: each script's locale-runtime evidence (clean PASS + deliberate-FAIL captured) + workflow YAML diff snippet + INVARIANT_REGISTRY entries + SKILL.md insertion verbatim.

---

## 9. Regression prevention

**Structural safeguards delivered by this SPEC:**

- **M-1 baseline pattern** — any future ORCH that introduces a require-cycle fails CI immediately. The baseline shrinks over time as ORCH-0746 progresses; never grows except via deliberate operator decision.
- **M-2 skill-encoded process step** — Step 1.5 in CLOSE protocol is in the skill prompt; any future orchestrator session reading the skill will execute it. This prevents the "scheduled for removal" cruft pattern.
- **M-3 whitelist sync** — any future persist-key bump that forgets to update the reaper whitelist fails CI on the same PR. Latent destruction risk class structurally eliminated.
- **M-4 TRANSITIONAL exit-condition** — Phase 1 baselines existing violators; Phase 2 (post-ORCH-0748) fully enforces. Const #7 enforcement.
- **M-5 web-export parser** — any new RN-only style prop or SSR-unsafe access in mingla-business code fails CI before merge.

**Forward safeguards (out of scope but acknowledged):**

- ESLint rule banning inline `elevation:` outside designSystem (M-5 Phase 2 — defer to future cycle).
- Cross-domain expansion: M-1/M-3/M-4/M-5 currently mingla-business-only. Admin / app-mobile / supabase need their own gates (future cycle).
- Baseline-shrinkage discipline: ORCH-0746 progress should remove cycles from M-1 baseline; ORCH-0748 progress should remove violators from M-4 baseline. Currently no automated nag; tracked manually.

**Protective comments to include in implementation:**

- Top of each script: full docblock per §3.x.1 explaining ORCH-0744 forensics rationale + cross-references.
- Top of each baseline file: full docblock explaining when to add/remove entries + cross-references.
- SKILL.md Step 1.5: codification line "Codified 2026-05-06 by META-ORCH-0744-PROCESS / I-PROPOSED-L."
- INVARIANT_REGISTRY entries: full long-form per §6.2 verbatim.

---

## 10. Discoveries for orchestrator

| ID | Type | Description |
|----|------|-------------|
| D-META-FOR-1 | 🔵 process | ORCH-0744 forensics §3 cited "4 pre-existing AuthContext cycles" — actual count is **14** (madge run at SPEC time on `Seth`/`22fe5507`). Cycles 5-14 (mostly liveEventStore/draftEventStore-related) were missed by the original forensic enumeration. The SPEC §3.1.3 baseline captures all 14. ORCH-0746 (queued) similarly has more surface area than originally scoped. |
| D-META-FOR-2 | 🔵 process | The dispatch §6 originally proposed I-PROPOSED-K through I-PROPOSED-O for the 5 META invariants. Letter O collides with the existing Stripe-no-webview-wrap invariant. The original SPEC corrected to K, L, M, N, W, but implementor Pre-Flight caught that W now collides with the same-day B2a Path C V3 notifications-prefix invariant per DEC-121. This SPEC-PATCH corrects to K, L, M, N, X. |
| D-META-FOR-3 | 🟡 hidden flaw | The `_layout.tsx` splash gate added in ORCH-0743 reads from `useBrand(currentBrandId)` AND `useCurrentBrandId()` — both of which transitively touch the AuthContext-rooted require-cycles in the M-1 baseline (cycles 4 + 6 specifically). The cycle is benign at module-init (uses are deferred to render time), but worth noting for ORCH-0746's structural refactor: any AuthContext cycle break must avoid breaking the splash gate's import chain. |
| D-META-FOR-4 | 🔵 future | The dispatch §2.4 mentioned "ESLint rule banning inline `elevation:` outside designSystem" as a future Phase 2 enhancement. Not included in this SPEC. Adds value but requires ESLint config update + a new lint plugin OR shared rule file. Defer to a small follow-up ORCH if M-5's parser-on-stderr proves insufficient (e.g., catches issues post-bundle that should have been caught pre-bundle). |
| D-META-FOR-5 | 🔵 deferred | M-2 (DIAG-marker reaping) is a process invariant enforced by orchestrator skill, not a CI gate. There is no automated CI check for it. Future enhancement: a CI script that greps the entire mingla-business codebase for `[ORCH-XXXX-DIAG]` and warns when any marker exists for a CLOSED ORCH. Different from Step 1.5 (which only checks the closing ORCH at CLOSE-time); this would catch residue from prior CLOSED ORCHs as a periodic hygiene check. Defer; tracked. |
| D-META-FOR-6 | 🟢 positive | The strict-grep registry pattern (one script + one job per gate, per `feedback_strict_grep_registry_pattern.md`) absorbs all 5 new gates cleanly without scaffold rewrites. 13 existing gates → 18 post-this-cycle. Pattern continues to scale well. |
| D-META-FOR-7 | 🔵 process | Implementor Pre-Flight surfaced D-IMPL-PRE-3: `mingla-business/src/utils/reapOrphanStorageKeys.ts:23` says META-ORCH-0744 will codify `PERSIST-KEY-WHITELIST-SYNC` as I-PROPOSED-L, but this SPEC assigns that invariant to I-PROPOSED-M. Implementation Step 7.3 now requires updating the comment to I-PROPOSED-M. |

---

## 11. Confidence

**HIGH** on all 5 sub-deliverables.

- M-1 — `madge --circular` verified locally; produces clean cycle list; baseline-comparison logic is mechanical; existing strict-grep pattern absorbs the new job without scaffold changes.
- M-2 — text edit to orchestrator SKILL.md; insertion site clearly identified at line 200-201 between Step 1 and Step 2; no behavioral risk because the change is codifying a process step.
- M-3 — pure regex matching over store files + reaper whitelist; comment-stripping pre-pass is the only judgment call but spec specifies it explicitly.
- M-4 — line-number-based baseline; works because file changes that shift lines are infrequent (not every PR); WARN-mode initial deploy is the right risk-management choice.
- M-5 — `expo export -p web` runs cleanly post-ORCH-0743 CF-2 fix; stub env vars are the established pattern; pattern matching is straightforward.

No layer of the SPEC is "probable" or "suspected" — every element traces to a verified file or local execution at SPEC time.

---

## 12. Hand-back protocol

1. Forensics writes `Mingla_Artifacts/specs/SPEC_META_ORCH_0744_PROCESS_HARDENING.md` (THIS FILE).
2. Orchestrator REVIEWs the SPEC. After the 2026-05-07 SPEC-PATCH that changed M-5 from I-PROPOSED-W to I-PROPOSED-X, orchestrator MUST re-REVIEW before implementor is re-dispatched, with special attention to letter inventory, W→X consistency, and Step 7.3 reaper-comment drift.
3. Operator dispatches `/mingla-implementor` against this SPEC. **Note:** implementor will need to run each new gate locally during development to verify both PASS (current HEAD) and FAIL (deliberate-violator fixtures) — this is the standard CI-script bootstrap pattern.
4. Implementor returns `Mingla_Artifacts/reports/IMPLEMENTATION_META_ORCH_0744_PROCESS_REPORT.md`.
5. Tester verifies each of 5 gates fails on a fixture violator + passes on clean code. Verifies SKILL.md edit lands correctly.
6. Tester PASS → orchestrator CLOSE protocol:
   - **Standard 4-step CLOSE** (no DEPRECATION extension — purely additive; no DROP/retirement).
   - **Step 1** updates 7 artifacts including INVARIANT_REGISTRY (5 new entries flip DRAFT → ACTIVE) + scripts README (5 new gates registered).
   - **Step 2** commit message.
   - **Step 3** EAS Update — N/A (no mobile-bundle change).
   - **Step 4** announce next dispatch (B2a IMPL Phases 3-5 owned by other chat; ORCH-0746/0747; or whatever's queued).

---

**Awaiting:** orchestrator re-REVIEW of this SPEC-PATCH → operator dispatches `/mingla-implementor` → implementor executes per §8 → tester PASS → CLOSE protocol (standard 4-step; 5 invariants flip DRAFT → ACTIVE; no DEPRECATION extension required because no DROP/retirement work).
