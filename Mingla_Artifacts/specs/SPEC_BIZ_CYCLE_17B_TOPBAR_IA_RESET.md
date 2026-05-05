# SPEC — BIZ Cycle 17b (TopBar IA reset — structural-only + hardening-registry CI scaffold)

**Cycle:** 17b (BIZ — Refinement Pass mini-cycle 2)
**Status:** BINDING — implementor contract
**Authored:** 2026-05-05 from `INVESTIGATION_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md` + `SPEC_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md` dispatch
**Estimated IMPL effort:** ~4-5 hrs
**Codebase:** `mingla-business/` + `.github/workflows/` + `.github/scripts/strict-grep/`

---

## 1. Layman summary

Cycle 17b ships **two parallel structural pieces** plus closes 17a's tactical TRANSITIONAL marker:

1. **TopBar primitive gains `extraRightSlot` prop** that COMPOSES with the default `[search, bell]` cluster instead of REPLACING it. Existing `rightSlot=` stays as escape-hatch for back-route consumers (15 instances preserved untouched).
2. **events.tsx migrates** from 17a's tactical inline cluster to the new compose API. Net delta: **-19 LOC**.
3. **NEW hardening-registry CI workflow** at `.github/workflows/strict-grep-mingla-business.yml` + `.github/scripts/strict-grep/` directory. Designed as **registry pattern** per operator lock D-17b-5 — every future invariant CI gate adds one Node.js script + one workflow job. 17b's I-37 gate is the FIRST registered.
4. **I-37 invariant** ratified DRAFT → ACTIVE post-CLOSE. INVARIANT_REGISTRY entry pre-writes as DRAFT during this SPEC dispatch.

Search and bell stay decorative (W1+W5 locked). NO new screens. NO badge wiring. NO bottom nav changes. NO migration of back-route consumers.

---

## 2. Scope and non-goals

### 2a. In scope (4 work items)

| Item | File / Surface | Action |
|---|---|---|
| **§A** | `mingla-business/src/components/ui/TopBar.tsx` | Add `extraRightSlot` prop + render-branch update + JSDoc patterns documentation |
| **§B** | `mingla-business/app/(tabs)/events.tsx` | Migrate from inline tactical cluster to `extraRightSlot={<+>}` (net -19 LOC) |
| **§C** | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | NEW I-37 entry (DRAFT now; flips ACTIVE at CLOSE) |
| **§D** | `.github/workflows/strict-grep-mingla-business.yml` + `.github/scripts/strict-grep/` (NEW directory) | Hardening-registry workflow scaffold + I-37 gate script + README |

### 2b. Non-goals (explicit)

- **NO** wiring `onPress` for search or bell IconChromes (D-17b-3 + D-17b-4 lock W1 + W5)
- **NO** new search screen (`app/search.tsx`) or notifications screen (`app/notifications.tsx`)
- **NO** bell badge counting from local data sources (W7 rejected)
- **NO** TopBar visual redesign (no glass chrome / icon shapes / size changes / spacing changes)
- **NO** migration of `leftKind="back"` consumers (15 back-route instances across 8 files preserved verbatim)
- **NO** I-32 (rank parity) / I-34 (canManualCheckIn decommission) / I-36 (ROOT-ERROR-BOUNDARY) gate scripts — those stay PROPOSED; future cycles register via the new pattern shipped in §D
- **NO** changes to bottom nav (D-17-13 declined)
- **NO** schema migrations + NO new mingla-business dependencies (workflow uses `actions/setup-node@v4` + `@babel/parser` available via standard runners)
- **NO** TopBar header comment refresh (D-CYCLE17B-FOR-7 polish — out of 17b core scope; small enough to slip into SPEC §A.1 as bonus subtraction if implementor sees clean fit)

### 2c. Assumptions

- Babel parser (`@babel/parser` v7.x) is available either via dev dependency in `mingla-business/package.json` or installable on-demand via `npm install` in the CI runner. Implementor verifies; if neither, falls back to TypeScript compiler API (`ts-morph` or raw `typescript` package) — adds ~1 hr to §D effort.
- GitHub Actions `pull_request` trigger fires on PRs targeting both `main` and `Seth` branches. If repo branch protection differs, implementor flags as discovery.
- The 15 back-route consumers documented in investigation §2b genuinely all conform to the "intentional suppression / replace" pattern (read directly during forensics). No implementor re-verification required unless tsc surfaces unexpected drift.

---

## 3. Per-layer specifications

### §A. TopBar primitive — `extraRightSlot` prop

**File:** `mingla-business/src/components/ui/TopBar.tsx`

#### §A.1 — TopBarProps interface addition

Add `extraRightSlot?: React.ReactNode` to `TopBarProps`. Keep `rightSlot?: React.ReactNode` unchanged (escape-hatch per D-17b-2).

**Verbatim addition (insert after `rightSlot?: React.ReactNode;` line):**

```tsx
  /**
   * Optional icons composed AFTER the default `[search, bell]` cluster.
   * Use this for primary-tab page-specific extras (e.g., events tab `+`).
   * Renders inside the same flex row, gap=spacing.sm, in source order.
   *
   * Per I-37: ONLY honored when `rightSlot` is undefined. If both are
   * passed, `rightSlot` wins (preserves back-route compatibility);
   * the strict-grep CI gate flags `leftKind="brand"` consumers that
   * pass `rightSlot=` as I-37 violations.
   */
  extraRightSlot?: React.ReactNode;
```

**Type-safety decision (resolves dispatch §3d):** plain optional both — NO discriminated union. Reasoning:
- Discriminated unions on optional props become awkward in JSX (some TS configs force `extraRightSlot={undefined}` in back-route call sites)
- Back-route consumers today only pass `rightSlot=` (one prop, never both); type-system mutual exclusion adds zero value
- CI grep gate is the structural enforcement; type system is the convenience/documentation layer
- Render logic prefers `rightSlot` deterministically if both passed (single point of bug if it ever happens)

#### §A.2 — Render-branch update

**Current (TopBar.tsx:184):**

```tsx
{rightSlot ?? <DefaultRightSlot unreadCount={unreadCount} />}
```

**Target:**

```tsx
{rightSlot !== undefined ? rightSlot : (
  <View style={styles.rightCluster}>
    <DefaultRightSlotInner unreadCount={unreadCount} />
    {extraRightSlot}
  </View>
)}
```

**Note the `!== undefined` check** — distinguishes intentional `rightSlot={null}` (still suppresses default per existing back-route pattern at audit-log.tsx:108 + team.tsx:210) from "prop not passed at all" (use the new compose path). Preserves existing back-route behavior verbatim.

#### §A.3 — Internal `DefaultRightSlot` split

**Current `DefaultRightSlot` at TopBar.tsx:78-92** wraps the IconChromes in its own `<View style={styles.rightCluster}>`. Rename + split so the parent flex row composes everything in one container.

**Target structure:**

Replace the existing `DefaultRightSlot` with `DefaultRightSlotInner` (no outer View):

```tsx
const DefaultRightSlotInner: React.FC<{ unreadCount: number | undefined }> = ({
  unreadCount,
}) => (
  <>
    {/* // orch-strict-grep-allow leftKind-brand-rightSlot — N/A this is internal kit primitive, not a consumer */}
    {/* [TRANSITIONAL] right-slot icons render but onPress is unwired in
        Cycle 0a — Cycle 1+ wires search + notifications navigation. */}
    <IconChrome icon="search" size={36} accessibilityLabel="Search" />
    <IconChrome
      icon="bell"
      size={36}
      badge={unreadCount}
      accessibilityLabel="Notifications"
    />
  </>
);
```

(The wrapping `<View style={styles.rightCluster}>` moves to the render-branch in §A.2.)

The `// orch-strict-grep-allow` comment is preventive — if a future grep gate ever scans for "I-37 violations" inside `TopBar.tsx` itself, this allowlist marks the internal use as intentional.

#### §A.4 — JSDoc for `rightSlot` prop (D-CYCLE17B-FOR-1 closure)

Update `rightSlot?: React.ReactNode;` JSDoc to document the 3 patterns:

```tsx
  /**
   * Right slot content. If defined, REPLACES the default `[search, bell]`
   * cluster.
   *
   * Per I-37: `leftKind="brand"` consumers MUST NOT pass `rightSlot=` —
   * use `extraRightSlot` to ADD icons after the default cluster instead.
   *
   * For `leftKind="back"` consumers, `rightSlot=` is the canonical
   * suppress/replace mechanism. Three documented patterns:
   *   - `rightSlot={null}` → suppresses default cluster entirely
   *     (e.g., `app/brand/[id]/audit-log.tsx`, `app/brand/[id]/team.tsx`
   *      loading branch)
   *   - `rightSlot={<View />}` → empty placeholder for layout balance
   *     (e.g., `BrandProfileView.tsx`, `BrandPaymentsView.tsx` ready/loading
   *      branches)
   *   - `rightSlot={<page-specific-action>}` → page-specific replace
   *     (e.g., `BrandEditView.tsx` Save button, `event/[id]/index.tsx`
   *      Share + Manage cluster, `team.tsx` invite Plus)
   *
   * Strict-grep CI gate enforces I-37 — `.github/workflows/strict-grep-
   * mingla-business.yml` fails CI if any `<TopBar leftKind="brand">`
   * consumer passes `rightSlot=`.
   */
  rightSlot?: React.ReactNode;
```

#### §A.5 — Style block (no change required, but document)

`rightCluster` style at TopBar.tsx:218-223 is REUSED as the parent flex row in §A.2. NO style edits in this file.

### §B. events.tsx migration

**File:** `mingla-business/app/(tabs)/events.tsx`

#### §B.1 — Subtract 17a tactical pattern

**Subtract-1: rightSlot prop block (lines 393-417, ~24 lines)**

DELETE entirely. The full inline `rightSlot={<View style={styles.topBarRightCluster}>...</View>}` JSX block goes. Including the 17a TRANSITIONAL marker comment (lines 394-399) which becomes obsolete.

**Subtract-2: `topBarRightCluster` style entry (lines 632-638, ~7 lines)**

DELETE entirely. The new TopBar's own `rightCluster` style (in TopBar.tsx) takes over. Include the comment lines about "17b TopBar refactor will delete this when extraRightSlot prop ships" — they're satisfied now.

**Verification post-subtract:** `grep -n "topBarRightCluster" mingla-business/app/(tabs)/events.tsx` returns 0 hits.

#### §B.2 — Add `extraRightSlot` prop

**Insert at events.tsx:393** (where the deleted `rightSlot=` was), ~6 lines:

```tsx
          extraRightSlot={
            canCreateEvent ? (
              <IconChrome
                icon="plus"
                size={36}
                onPress={handleBuildEvent}
                accessibilityLabel="Build a new event"
              />
            ) : null
          }
```

(Note: `canCreateEvent` and `handleBuildEvent` are existing; no new imports needed. `IconChrome` import already present at line 32.)

#### §B.3 — Net delta

- DELETE: ~31 lines (24 JSX + 7 style)
- ADD: ~10 lines (6 prop block + 4 lines for safety from possible JSX width/wrapping)
- **Net: -19 LOC minimum, possibly -21**

#### §B.4 — Visual verification

Pre/post visual outcome MUST be byte-identical:
- Pre-17b: `[search, bell, +]` cluster on events tab (canCreateEvent) | `[search, bell]` (not canCreateEvent)
- Post-17b: `[search, bell, +]` cluster on events tab (canCreateEvent) | `[search, bell]` (not canCreateEvent)

The visual outcome is PRESERVED — implementation mechanism changes from inline composition to compose-via-extraRightSlot. NO user-visible change.

### §C. INVARIANT_REGISTRY entry

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`

#### §C.1 — Pre-write at SPEC time (DRAFT status)

Per memory rule `feedback_post_pass_protocol` extension Step 5a precedent, pre-write the I-37 entry NOW with `status: DRAFT — flips to ACTIVE on Cycle 17b CLOSE`. Operator flips status at CLOSE; orchestrator does NOT flip unilaterally during IMPL.

**Insert position:** after I-36 entry (chronological order). Find I-36 ROOT-ERROR-BOUNDARY entry (`INVARIANT_REGISTRY.md:1670+` per session context); insert I-37 directly below it.

**Verbatim entry text (matches I-32, I-35, I-36 format):**

```markdown
---

### I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS — `<TopBar leftKind="brand">` consumers MUST render the default `[search, bell]` cluster (mingla-business — Cycle 17b — DRAFT, flips to ACTIVE post-Cycle-17b CLOSE)

**Statement:** Every `mingla-business` `<TopBar>` consumer with `leftKind="brand"` (primary tab routes — currently `app/(tabs)/home.tsx`, `app/(tabs)/events.tsx`, `app/(tabs)/account.tsx`, plus dev `app/__styleguide.tsx` brand fixture) MUST render the default `[search, bell]` cluster on the right side of the top bar. Page-specific extras (e.g., the `+` icon on events tab) MUST compose via the NEW `extraRightSlot` prop, NOT replace via `rightSlot`.

**Scope:** `leftKind="brand"` consumers ONLY. `leftKind="back"` consumers (sub-route pages: Edit Brand, Audit Log, Brand Payments, Brand Profile, Brand Finance Reports, Event Detail, Team list, etc.) are OUT of scope — they intentionally suppress the default cluster via `rightSlot={null}` or `rightSlot={<View />}` for focused-task UX.

**Why this exists:** Pre-17a, `events.tsx` replaced the default cluster with a single `+` icon, removing search + bell from that tab — operator-flagged as broken founder UX. Cycle 17a tactical fix was an inline cluster within `rightSlot={<View>...</View>}`. Cycle 17b structural fix introduces `extraRightSlot` prop and codifies the rule. Founder feedback 2026-05-04: search + bell + `+` should all be present together on the events tab.

**CI enforcement:** `.github/workflows/strict-grep-mingla-business.yml` job `i37-topbar-default-cluster` running `.github/scripts/strict-grep/i37-topbar-cluster.mjs` — fails CI on PR if any `<TopBar leftKind="brand">` consumer passes `rightSlot=` (instead of `extraRightSlot=`). Allowlist via inline comment `// orch-strict-grep-allow leftKind-brand-rightSlot — <reason>` immediately above the offending JSX block.

**EXIT condition:** None — permanent invariant. If the design system ever pivots to per-tab top-bar variations, supersede via NEW invariant; do not silently relax.

**Cross-reference:** Cycle 17a §A.1 tactical fix (`events.tsx:393-417`) deleted at 17b CLOSE; Cycle 17b SPEC binding contract; D-CYCLE17A-FOR-3 anchor; founder feedback `Mingla_Artifacts/FOUNDER_FEEDBACK.md` 2026-05-04 sub-item 2; DEC-101 lock entry.
```

#### §C.2 — Status flip at CLOSE

Operator (or orchestrator at CLOSE protocol) flips `DRAFT — flips to ACTIVE` line to `ACTIVE post-Cycle-17b CLOSE 2026-MM-DD`. NOT an IMPL responsibility.

### §D. Hardening-registry CI workflow

**Operator framing (D-17b-5 lock):** this is a **registry pattern**. The workflow is the canonical place where every future invariant CI gate gets registered. Adding a new gate = add one script + one workflow job. NO scaffold rewrite.

#### §D.1 — Workflow YAML

**NEW file:** `.github/workflows/strict-grep-mingla-business.yml`

```yaml
name: Strict Grep Gates (Mingla Business)

on:
  pull_request:
    branches: [main, Seth]
    paths:
      - "mingla-business/**"
      - ".github/scripts/strict-grep/**"
      - ".github/workflows/strict-grep-mingla-business.yml"

# Registry pattern (per DEC-101 D-17b-5):
# Each invariant CI gate is its own modular Node.js script in
# .github/scripts/strict-grep/. Adding a new gate = add one script + one
# job below. Each job runs in parallel; any failure fails the PR.
#
# Currently registered gates:
#   - I-37 (i37-topbar-cluster.mjs) — primary-tab default cluster (Cycle 17b)
#
# Future gates to register (proposed but not yet implemented):
#   - I-32 rank parity (Cycle 13a proposal)
#   - I-34 canManualCheckIn decommission (Cycle 13b proposal)
#   - I-36 ROOT-ERROR-BOUNDARY (Cycle 16a proposal)
#
# When adding a new gate, follow the 4 steps in
# .github/scripts/strict-grep/README.md.

jobs:
  i37-topbar-default-cluster:
    name: "I-37: TopBar primary-tab default cluster"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install Babel parser
        run: npm install --no-save @babel/parser @babel/traverse
      - name: Run I-37 gate
        run: node .github/scripts/strict-grep/i37-topbar-cluster.mjs
```

#### §D.2 — I-37 gate script

**NEW file:** `.github/scripts/strict-grep/i37-topbar-cluster.mjs`

**Behavioral contract (the implementor writes the script per this spec):**

**Inputs:**
- Walks every `.tsx` file under `mingla-business/app/` and `mingla-business/src/`
- For each file: parse via `@babel/parser` with `plugins: ['typescript', 'jsx']`
- Traverse AST via `@babel/traverse`

**Detection logic:**
1. Find every `JSXElement` whose `openingElement.name.name === "TopBar"`
2. Read attributes:
   - `leftKind`: extract string literal value if `JSXAttribute.value` is a `StringLiteral`. If JSXExpressionContainer (dynamic), skip with warning (gate cannot statically verify; surfaces as informational note in output).
   - Presence of `rightSlot` attribute (whether value is null, `<View />`, conditional, etc.)
   - Presence of `extraRightSlot` attribute
3. **VIOLATION** if: `leftKind === "brand"` AND `rightSlot` attribute is present
4. **EXEMPTION** if: the line immediately above the `<TopBar` JSX opening contains an `// orch-strict-grep-allow leftKind-brand-rightSlot` comment (read source range; check leading-line trivia)

**Output (on violation):**
```
ERROR: I-37 violation in mingla-business/app/(tabs)/events.tsx:393
  <TopBar leftKind="brand" ... rightSlot={...}>
    Primary-tab consumers (leftKind="brand") MUST NOT pass rightSlot=.
    Use extraRightSlot= to compose with the default [search, bell] cluster.
    See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-37
    Allowlist: add // orch-strict-grep-allow leftKind-brand-rightSlot — <reason>
               immediately above the JSX block if the violation is intentional.
```

**Exit codes:**
- `0` — no violations
- `1` — at least one violation
- `2` — script error (parse failure, file system error)

**Edge cases the script MUST handle:**
- File parse failures: report file + reason; treat as inconclusive (exit `2`); does NOT mark as violation
- `leftKind` value is a JSXExpressionContainer (dynamic): warn but do NOT flag as violation (gate is static-only; runtime values can't be checked)
- `<TopBar />` self-closing with no props: skip (no `leftKind`, no `rightSlot`)
- File contains no `<TopBar>` at all: skip silently
- Allowlist comment present but malformed (e.g., wrong tag): treat as missing allowlist (still violation)

**Estimated effort:** ~150-200 LOC TypeScript-via-Node-mjs script + small fixture set (3-4 test files exercising violation, allowlist, dynamic leftKind, no-TopBar).

#### §D.3 — Registry README

**NEW file:** `.github/scripts/strict-grep/README.md`

**Content:**

```markdown
# Strict-Grep Hardening Registry — Mingla Business

This directory holds the modular CI gate scripts that enforce Mingla
Business invariants. Each script enforces ONE invariant. Each script is
registered as ONE job in
`.github/workflows/strict-grep-mingla-business.yml`.

Per **DEC-101 D-17b-5** (Cycle 17b), this is a **registry pattern**:
every future invariant CI gate adds one script + one workflow job. No
scaffold rewrite needed.

## Active gates registered

| Invariant | Script | Cycle | Cross-reference |
|---|---|---|---|
| I-37 | `i37-topbar-cluster.mjs` | 17b | `INVARIANT_REGISTRY.md` I-37 |

## Future gates (proposed but not yet implemented)

| Invariant | Proposed cycle | Notes |
|---|---|---|
| I-32 rank parity | 13a | Mobile UI rank thresholds mirror SQL `biz_role_rank` |
| I-34 canManualCheckIn decommission | 13b | Field stays gone post-Cycle-13b |
| I-36 ROOT-ERROR-BOUNDARY | 16a | `_layout.tsx` MUST wrap Stack with ErrorBoundary |

## How to add a new gate (4 steps)

1. **Write the gate script** at `.github/scripts/strict-grep/iN-name.mjs`.
   Mirror the structure of `i37-topbar-cluster.mjs`:
   - Walk relevant files
   - Parse via `@babel/parser` (or appropriate parser for non-TSX targets)
   - Apply detection logic
   - Honor allowlist comment pattern: `// orch-strict-grep-allow <gate-tag> — <reason>`
   - Output rich error format on violation
   - Exit `0` (clean), `1` (violation), `2` (inconclusive)

2. **Register the job** in `.github/workflows/strict-grep-mingla-business.yml`:
   ```yaml
   jobs:
     iN-name:
       name: "I-N: <description>"
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: "20"
         - name: Install dependencies
           run: npm install --no-save <parser-deps>
         - name: Run I-N gate
           run: node .github/scripts/strict-grep/iN-name.mjs
   ```

3. **Cross-reference in INVARIANT_REGISTRY.md** — add a "CI enforcement"
   line in the I-N entry pointing to the script + this README.

4. **Test locally** — run `node .github/scripts/strict-grep/iN-name.mjs`
   from the repo root with synthetic violation fixtures + clean fixtures.
   Verify exit codes + error message clarity.

## Allowlist comment pattern

If a violation is genuinely intentional (e.g., test fixtures, historical
migrations, internal kit primitives), add a comment IMMEDIATELY above the
offending code with this verbatim format:

```
// orch-strict-grep-allow <gate-tag> — <reason>
```

Examples:
- `// orch-strict-grep-allow leftKind-brand-rightSlot — N/A this is internal kit primitive, not a consumer`
- `// orch-strict-grep-allow canManualCheckIn — Cycle 13b migration removes this field; reference is part of the strip logic`

The gate script honors this comment and skips the next non-comment line.
Anything else (no comment, wrong tag, malformed) is still a violation.
```

#### §D.4 — Local test harness (recommended, not mandatory)

Add a top-level repo script `npm run strict-grep` (or `pnpm`/`yarn` equivalent — implementor matches repo convention):

```json
// package.json (repo root, if it exists; otherwise mingla-business/)
"scripts": {
  "strict-grep": "node .github/scripts/strict-grep/i37-topbar-cluster.mjs"
}
```

If no repo-root `package.json` exists, skip this — implementor flags as discovery for future repo-root tooling.

**Effort estimate for §D total:** ~2-3 hrs (workflow YAML + I-37 gate script + README + 3-4 test fixtures + optional local harness).

---

## 4. Success criteria (numbered, testable)

### TopBar primitive (§A)

- **SC-A-1** — `mingla-business/src/components/ui/TopBar.tsx` exports `TopBarProps` interface with `extraRightSlot?: React.ReactNode` prop documented per §A.1.
- **SC-A-2** — `rightSlot` prop JSDoc updated per §A.4 documenting 3 documented patterns (null / View placeholder / page-specific replace) with explicit `leftKind="brand"` exclusion + I-37 cross-reference.
- **SC-A-3** — Render logic at line ~184 follows §A.2: `rightSlot !== undefined ? rightSlot : <View><DefaultRightSlotInner/>{extraRightSlot}</View>` — distinguishes `null`/`undefined`.
- **SC-A-4** — `DefaultRightSlotInner` component renders search + bell IconChromes WITHOUT outer `<View>` wrapper (parent render branch wraps in `styles.rightCluster`).
- **SC-A-5** — Existing internal `[TRANSITIONAL]` marker on default search + bell IconChromes preserved verbatim.
- **SC-A-6** — `tsc --noEmit` from `mingla-business/` clean for TopBar.tsx changes (no new errors introduced).

### events.tsx migration (§B)

- **SC-B-1** — `mingla-business/app/(tabs)/events.tsx` rightSlot prop block (lines 393-417 per pre-17b state) DELETED.
- **SC-B-2** — `topBarRightCluster` style entry (lines 632-638) DELETED.
- **SC-B-3** — NEW `extraRightSlot={canCreateEvent ? <IconChrome icon="plus" .../> : null}` block inserted at the same prop position.
- **SC-B-4** — `grep -n "topBarRightCluster" mingla-business/app/(tabs)/events.tsx` returns 0 hits.
- **SC-B-5** — `grep -n "rightSlot=" mingla-business/app/(tabs)/events.tsx` returns 0 hits.
- **SC-B-6** — Visual outcome PRESERVED: `[search, bell, +]` for `canCreateEvent`, `[search, bell]` otherwise (verified at runtime smoke).
- **SC-B-7** — `tsc --noEmit` clean.

### INVARIANT_REGISTRY entry (§C)

- **SC-C-1** — `Mingla_Artifacts/INVARIANT_REGISTRY.md` contains a new I-37 section matching §C.1 verbatim.
- **SC-C-2** — Status line reads `DRAFT — flips to ACTIVE on Cycle 17b CLOSE` (NOT yet ACTIVE — flip happens at CLOSE protocol step 5e analog).
- **SC-C-3** — Position is chronologically after I-36 entry.

### CI workflow (§D)

- **SC-D-1** — `.github/workflows/strict-grep-mingla-business.yml` exists with structure per §D.1 (registry comments + I-37 job + future-gate placeholder list).
- **SC-D-2** — `.github/scripts/strict-grep/i37-topbar-cluster.mjs` exists implementing the behavioral contract in §D.2.
- **SC-D-3** — `.github/scripts/strict-grep/README.md` exists with content per §D.3.
- **SC-D-4** — Running `node .github/scripts/strict-grep/i37-topbar-cluster.mjs` on the post-§B-migration code state exits `0` (no violations).
- **SC-D-5** — Running the gate against a synthetic test fixture with `<TopBar leftKind="brand" rightSlot={...}>` exits `1` with rich error output (file + line + suggested fix).
- **SC-D-6** — Running the gate against a fixture with the allowlist comment immediately above exits `0` (allowlist honored).
- **SC-D-7** — Workflow YAML is valid (no parse errors via `actionlint` or GitHub's own validator).

### Combined / cross-cutting

- **SC-X-1** — Pre-existing 15 back-route TopBar consumers UNCHANGED post-§A/§B (verified via diff: no other `.tsx` files in `mingla-business/` modified beyond `events.tsx` + `TopBar.tsx`).
- **SC-X-2** — `tsc --noEmit` from `mingla-business/` clean overall (no new errors introduced anywhere).
- **SC-X-3** — Memory file `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_strict_grep_registry_pattern.md` created at SPEC time with `status: DRAFT — flips to ACTIVE on Cycle 17b CLOSE`. Documents the registry pattern for future skill awareness. Index entry added to `MEMORY.md`.

---

## 5. Invariants

### NEW invariant introduced

- **I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS** — see §C.1 for verbatim text. DRAFT during SPEC dispatch + IMPL; flips ACTIVE at 17b CLOSE.

### PRESERVED invariants

| ID | Description | How preserved |
|---|---|---|
| **I-32** (rank-mirror) | Mobile rank thresholds match SQL `biz_role_rank` | N/A — 17b doesn't touch permissions or `permissionGates.ts`; rank values unchanged |
| **I-34** (canManualCheckIn DECOMMISSIONED) | Field stays dropped | N/A — 17b doesn't touch `scannerInvitationsStore.ts` |
| **I-35** (creator_accounts.deleted_at soft-delete) | Recover-on-sign-in via SIGNED_IN gate | N/A — 17b doesn't touch AuthContext or delete flow |
| **I-36** (ROOT-ERROR-BOUNDARY) | `_layout.tsx` wraps Stack with ErrorBoundary | N/A — 17b doesn't touch `_layout.tsx` |

All 14 constitutional rules preserved (see §6 for compliance check).

---

## 6. Test cases

| Test | Scenario | Setup | Expected | Layer |
|---|---|---|---|---|
| **T-1** | TopBar default render (no rightSlot, no extraRightSlot) | Mount `<TopBar leftKind="brand" />` | Renders `[search, bell]` cluster (default) | UI |
| **T-2** | TopBar with extraRightSlot | Mount `<TopBar leftKind="brand" extraRightSlot={<+>} />` | Renders `[search, bell, +]` cluster (3 icons in row, gap=spacing.sm) | UI |
| **T-3** | TopBar with rightSlot=null (back-route suppress) | Mount `<TopBar leftKind="back" rightSlot={null} />` | NO right-slot content rendered | UI |
| **T-4** | TopBar with rightSlot=<View /> (back-route placeholder) | Mount `<TopBar leftKind="back" rightSlot={<View />} />` | Empty placeholder rendered, no default cluster | UI |
| **T-5** | TopBar with rightSlot=<custom> (back-route replace) | Mount `<TopBar leftKind="back" rightSlot={<SaveButton />} />` | Save button rendered, no default cluster | UI |
| **T-6** | events.tsx visual parity (high-rank) | Operator with brand selected, rank ≥ event_manager, opens events tab | TopBar shows `[search, bell, +]` cluster (3 icons in correct order, gap=spacing.sm) | UI |
| **T-7** | events.tsx visual parity (low-rank) | Operator as scanner role, opens events tab | TopBar shows `[search, bell]` cluster (no plus) | UI |
| **T-8** | events.tsx + tap → unchanged behavior | Tap `+` icon | `handleBuildEvent` fires (toast if no brand, navigate to `/event/create` if brand) | UI |
| **T-9** | events.tsx style entry deleted | Static grep | `topBarRightCluster` returns 0 hits in events.tsx | Static |
| **T-10** | events.tsx rightSlot deleted | Static grep | `rightSlot=` returns 0 hits in events.tsx | Static |
| **T-11** | tsc clean | Run `npx tsc --noEmit` from `mingla-business/` | 0 errors | Build |
| **T-12** | I-37 gate violation detected | Synthetic fixture file with `<TopBar leftKind="brand" rightSlot={<view/>} />`; run gate script | Exit code 1 + error message includes file + line + suggested fix | CI |
| **T-13** | I-37 gate clean code passes | Run gate against post-§B code state | Exit code 0 | CI |
| **T-14** | I-37 gate allowlist honored | Synthetic fixture with allowlist comment immediately above violation; run gate | Exit code 0 | CI |
| **T-15** | I-37 gate dynamic leftKind warning | Fixture with `<TopBar leftKind={someVar} ...>`; run gate | Exit code 0 with warning note in output | CI |
| **T-16** | INVARIANT_REGISTRY I-37 entry exists | Read `INVARIANT_REGISTRY.md` | I-37 section present, status=DRAFT, format matches I-32/I-35/I-36 | Static |
| **T-17** | Workflow YAML valid | `actionlint .github/workflows/strict-grep-mingla-business.yml` | No errors | CI |
| **T-18** | Registry README documents 4-step gate addition | Read `.github/scripts/strict-grep/README.md` | Section "How to add a new gate (4 steps)" present | Static |
| **T-19** | Memory file pre-write created | Read `~/.claude/projects/.../memory/feedback_strict_grep_registry_pattern.md` | File exists, status=DRAFT, documents registry pattern | Static |
| **T-20** | All back-routes preserved | `git diff` shows changes only in `TopBar.tsx`, `events.tsx`, `INVARIANT_REGISTRY.md`, + new files in `.github/` and memory dir | No `.tsx` file outside `events.tsx` and `TopBar.tsx` modified | Static |

---

## 7. Implementation order

Sequential per memory rule `feedback_sequential_one_step_at_a_time`. Each step has a verification checkpoint.

1. **Pre-flight** — Implementor reads SPEC + investigation; invokes `/ui-ux-pro-max` for §A render-branch design tokens (memory rule `feedback_implementor_uses_ui_ux_pro_max`).
2. **§A.1 + §A.4** — Add `extraRightSlot` prop + update `rightSlot` JSDoc in `TopBar.tsx`.
3. **§A.3** — Split `DefaultRightSlot` → `DefaultRightSlotInner`.
4. **§A.2** — Update render logic to compose default + extras when `rightSlot === undefined`.
5. **Checkpoint 1** — Run `tsc --noEmit` from `mingla-business/`. MUST be 0 errors. If fail, stop + flag.
6. **§B.1** — DELETE events.tsx rightSlot block (lines 393-417 + 394-399 comment) + style entry (lines 632-638).
7. **§B.2** — INSERT new `extraRightSlot=` block in events.tsx.
8. **Checkpoint 2** — Run `tsc --noEmit`. MUST be 0 errors.
9. **Checkpoint 3** — Run grep verifications: `topBarRightCluster` 0 hits, `rightSlot=` 0 hits in events.tsx.
10. **§C.1** — Pre-write I-37 entry in `INVARIANT_REGISTRY.md` with DRAFT status.
11. **§D.1** — Create `.github/workflows/strict-grep-mingla-business.yml` per §D.1 verbatim.
12. **§D.2** — Create `.github/scripts/strict-grep/i37-topbar-cluster.mjs` implementing the §D.2 behavioral contract.
13. **§D.3** — Create `.github/scripts/strict-grep/README.md` per §D.3 verbatim.
14. **Checkpoint 4** — Local-test the I-37 gate: (a) run against current code state → expect exit 0; (b) run against synthetic violation fixture → expect exit 1 with rich error; (c) run against allowlist fixture → expect exit 0.
15. **§D.4 (optional)** — Add `npm run strict-grep` script to repo root `package.json` if exists; otherwise skip + flag as discovery.
16. **Memory pre-write (SC-X-3)** — Create `feedback_strict_grep_registry_pattern.md` in memory dir with DRAFT status. Add MEMORY.md index entry.
17. **Final checkpoint** — Run all 20 test cases from §6. Smoke test events.tsx visually if device available (otherwise document as runtime-pending per 17a precedent).
18. **Write IMPL report** — `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17B_TOPBAR_IA_RESET_REPORT.md` with verification matrix.

**Operator-side action at 17b CLOSE (NOT implementor):**
- Flip I-37 status DRAFT → ACTIVE
- Flip `feedback_strict_grep_registry_pattern.md` status DRAFT → ACTIVE
- Operator commits + pushes 17b
- EAS dual-platform OTA (commands at CLOSE)

---

## 8. Regression prevention

**The CI gate IS the regression prevention.** Going forward:

1. **For I-37 specifically:** any future PR that adds `<TopBar leftKind="brand" rightSlot={...}>` (the broken pattern) FAILS CI immediately with rich error. PR cannot merge.
2. **For future invariants:** the registry pattern in §D.3 README documents the 4-step addition process. Each new invariant gets its own gate without rewriting scaffolds. Eliminates "invariant proposed but never enforced" pattern (3 instances pre-17b: I-32, I-34, I-36).
3. **Memory file pre-write** ensures future skill sessions know about the registry pattern + can discover it via MEMORY.md index without re-reading SPEC artifacts.

**Scaffolding for future I-32 / I-34 / I-36 implementation** (out of 17b scope, but the pattern enables):
- I-32 rank parity gate: read `permissionGates.ts` + `biz_role_rank()` SQL function, compare numeric thresholds. ~120 LOC.
- I-34 canManualCheckIn decommission gate: grep for the field name across `mingla-business/src/` (excluding migration v1→v2 in `scannerInvitationsStore.ts` which has explicit allowlist). ~80 LOC.
- I-36 ROOT-ERROR-BOUNDARY gate: AST-walk `mingla-business/app/_layout.tsx` and verify `<ErrorBoundary>` wraps `<Stack>`. ~100 LOC.

Each becomes a 2-3 hour task using the 17b scaffold.

---

## 9. Discoveries for orchestrator

**SPEC-DISCOVERY-1 — Type-safety decision resolved as NON-discriminated-union.**
Investigation §3d deferred this. SPEC §A.1 locks: plain `extraRightSlot?: React.ReactNode` (both optional, runtime preference for `rightSlot` if both passed). Reasoning in §A.1. No operator action required; surfacing for orchestrator awareness.

**SPEC-DISCOVERY-2 — `@babel/parser` dependency.**
The I-37 gate script depends on `@babel/parser` + `@babel/traverse`. These are installed on-demand in the workflow YAML via `npm install --no-save`. If repo policy forbids CI-time installs (e.g., security scanning), implementor flags + we pivot to `typescript`-package-based AST traversal (~+30 min effort). Recommend implementor verify CI policy at IMPL time.

**SPEC-DISCOVERY-3 — Repo-root `package.json` existence unverified.**
SPEC §D.4 local test harness assumes repo-root `package.json` exists. Implementor verifies; if absent, skip §D.4 + log as discovery. NOT a SPEC blocker.

**SPEC-DISCOVERY-4 — `actionlint` availability.**
Test case T-17 assumes `actionlint` available locally. If not installed, implementor uses GitHub's own workflow validator (push to a test branch and observe `Actions` tab) OR substitutes manual YAML validation. Document chosen verification path in IMPL report.

**SPEC-DISCOVERY-5 — Pre-existing `actions/checkout@v4` + `actions/setup-node@v4` pin.**
Other workflows in `.github/workflows/` use these same pinned versions per session-context grep. SPEC pins the same versions for consistency. If `deploy-functions.yml` or `rotate-apple-jwt.yml` use different versions, implementor surfaces drift — NOT a 17b regression but a polish item.

**SPEC-DISCOVERY-6 — Memory file pre-write requires Write tool from implementor.**
SC-X-3 memory file pre-write happens during IMPL, not SPEC dispatch authoring. Implementor must verify the memory directory path resolves correctly on Windows-style paths (`c--Users-user-Desktop-mingla-main` per session context). If path resolution fails, flag + use the path observed at runtime.

**SPEC-DISCOVERY-7 — TopBar header comment refresh deferred.**
D-CYCLE17B-FOR-7 (refresh TopBar.tsx file-header JSDoc once `extraRightSlot` ships) is documented as out of 17b core scope but small enough to slip in if implementor sees clean fit. Per scope discipline, default is DON'T do it; if implementor does, flag in IMPL report. Either way is acceptable.

---

## 10. Cross-references

- 17b investigation: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md`
- 17b SPEC dispatch: `Mingla_Artifacts/prompts/SPEC_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md`
- 17b forensics dispatch: `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md`
- 17a SPEC anchor (events.tsx tactical EXIT condition): `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17A_QUICK_WINS.md` §A.1
- 17a IMPL report (tactical TRANSITIONAL marker source): `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_17A_QUICK_WINS_REPORT.md` §2 §A.1
- TopBar primitive: `mingla-business/src/components/ui/TopBar.tsx`
- events.tsx tactical anchor: `mingla-business/app/(tabs)/events.tsx:393-417` + style at lines 632-638
- INVARIANT_REGISTRY (existing entries to mirror format): I-32, I-35, I-36
- Founder feedback (sub-item 2): `Mingla_Artifacts/FOUNDER_FEEDBACK.md` 2026-05-04 entry
- Operator decisions locked (DEC-101 source):
  - D-17b-1 structural-only (Small)
  - D-17b-2 keep `rightSlot=` as escape-hatch
  - D-17b-3 search W1 (decorative)
  - D-17b-4 bell W5 (decorative)
  - D-17b-5 hardening-registry CI workflow (NEW pattern; 17b's I-37 gate is first; additive-friendly for future invariants)
  - D-17b-6 I-37 coverage `leftKind="brand"` only
- Pre-existing unimplemented gate proposals (NOT in 17b scope; future cycles register via the new pattern):
  - I-32 rank parity (Cycle 13a)
  - I-34 canManualCheckIn decommission (Cycle 13b)
  - I-36 ROOT-ERROR-BOUNDARY (Cycle 16a)
- Memory file pre-write (DRAFT at SPEC dispatch): `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_strict_grep_registry_pattern.md`
- Memory rules referenced:
  - `feedback_implementor_uses_ui_ux_pro_max` — mandatory at §A render-branch edit
  - `feedback_orchestrator_never_executes` — orchestrator dispatches; operator runs
  - `feedback_sequential_one_step_at_a_time` — 17b before 17c
  - `feedback_post_pass_protocol` — DRAFT pre-write pattern preserved
  - `feedback_no_summary_paragraph` — IMPL report drops trailing prose

---

**END OF SPEC.** Implementor proceeds against this contract. Operator runs `/mingla-implementor take over` against the IMPL dispatch (orchestrator authors after this SPEC review).
