# IMPLEMENTATION REPORT — BIZ Cycle 17b (TopBar IA reset — structural-only + hardening-registry CI scaffold)

**Cycle:** 17b (BIZ — Refinement Pass mini-cycle 2)
**Status:** completed
**Verification:** passed (tsc clean + 4 checkpoints PASS + gate fixture tests 3/3 PASS)
**Generated:** 2026-05-05
**Effort:** ~1.5 hrs (well under SPEC's 4-5 hr estimate; drivers below)

---

## 1. Layman summary

Shipped 4 work items per binding SPEC. **Visual outcome on device is identical to today** — the events tab cluster `[search, bell, +]` renders the same way; the mechanism changed from inline-cluster to `extraRightSlot` composition. Latent benefit: future code that tries to break I-37 ("primary tabs must keep search + bell visible") will fail CI on PR — the new hardening-registry workflow is the first strict-grep gate ever in this repo, designed as a **registry pattern** so I-32 / I-34 / I-36 can plug in trivially as separate cycles.

**Effort came in ~1.5 hrs vs SPEC's 4-5 hr estimate.** Drivers: (a) all back-route consumers genuinely needed zero migration (forensics §2b read directly verified this); (b) `@babel/parser` + `@babel/traverse` already transitively present in `mingla-business/node_modules` (no CI install policy concern surfaced); (c) `!== undefined` render-branch logic worked first time on all 19 consumers without surprise.

**Test first:** open events tab on TestFlight or `npx expo start`. Confirm `[search, bell, +]` cluster renders identically to current behavior — tester verifies no visual regression.

---

## 2. Status

**Status:** completed · **Verification:** passed (static + tsc + gate fixtures)

| Verification surface | Result |
|---|---|
| `tsc --noEmit` from `mingla-business/` | ✅ clean (0 errors) |
| Grep: `topBarRightCluster` in events.tsx | ✅ 0 hits |
| Grep: `rightSlot=` in events.tsx | ✅ 0 hits |
| I-37 gate vs current code state | ✅ exit 0 (119 .tsx files scanned, 0 violations) |
| I-37 gate vs synthetic violation fixture | ✅ exit 1 + rich error output |
| I-37 gate vs allowlist comment fixture | ✅ exit 0 |
| Test fixture cleanup post-test | ✅ removed |

**Runtime visual smoke** UNVERIFIED — implementor cannot run device. Tester gates on T-6 (events tab cluster `[search, bell, +]` for high-rank operator) + T-7 (`[search, bell]` for low-rank).

---

## 3. Section A — Code changes (per SPEC item)

### §A.1 + §A.4 — TopBar.tsx `extraRightSlot` prop + JSDoc

**File:** `mingla-business/src/components/ui/TopBar.tsx`
**What it did before:** `TopBarProps` had `rightSlot?: React.ReactNode` with terse JSDoc ("If undefined, renders default search + bell IconChromes"). No way to ADD icons after the default cluster — pages had to REPLACE.
**What it does now:** Adds `extraRightSlot?: React.ReactNode` prop with verbatim JSDoc per SPEC §A.1 explaining I-37 enforcement. Updates `rightSlot` JSDoc per SPEC §A.4 documenting the 3 documented patterns (`null` suppress / `<View />` placeholder / page-specific replace) plus explicit cross-reference to CI gate workflow.
**Why:** Satisfies SC-A-1 (extraRightSlot exists) + SC-A-2 (rightSlot JSDoc updated) + closes D-CYCLE17B-FOR-1 (back-route patterns now explicitly documented).
**Lines changed:** +35 / -2 (mostly JSDoc expansion)

### §A.3 — DefaultRightSlot → DefaultRightSlotInner split

**File:** `mingla-business/src/components/ui/TopBar.tsx`
**What it did before:** `DefaultRightSlot` rendered search + bell IconChromes wrapped in `<View style={styles.rightCluster}>`. Couldn't compose with extras because the View terminated the parent flex row.
**What it does now:** Renamed to `DefaultRightSlotInner` returning `<>...</>` fragment (no outer View). Added JSDoc explaining the parent render branch wraps everything in one flex row.
**Why:** Satisfies SC-A-4. Composition with `extraRightSlot` requires a single shared flex container, not nested.
**Lines changed:** +6 / -3

### §A.2 — Render-branch logic with `!== undefined` check

**File:** `mingla-business/src/components/ui/TopBar.tsx`
**What it did before:** `{rightSlot ?? <DefaultRightSlot unreadCount={unreadCount} />}` — used nullish coalescing, treating `null` and `undefined` the same.
**What it does now:** `{rightSlot !== undefined ? rightSlot : (<View style={styles.rightCluster}><DefaultRightSlotInner.../>{extraRightSlot}</View>)}` — distinguishes `null` from `undefined` so back-route consumers passing `rightSlot={null}` still suppress the default cluster (preserves existing audit-log.tsx, team.tsx loading branch behavior).
**Why:** Satisfies SC-A-3. Back-route compatibility verified — `null` still triggers explicit suppression; `undefined` triggers compose path.
**Lines changed:** +6 / -1
**Also added:** `extraRightSlot` to destructured props in `TopBar` component signature (+1 line).

### §B.1 + §B.2 — events.tsx migration

**File:** `mingla-business/app/(tabs)/events.tsx`
**What it did before:** 17a tactical inline cluster — `rightSlot={<View style={styles.topBarRightCluster}>...</View>}` (24 lines including TRANSITIONAL marker comment) + custom `topBarRightCluster` style entry (7 lines).
**What it does now:** Single `extraRightSlot={canCreateEvent ? <IconChrome icon="plus" .../> : null}` block (8 lines including conditional rendering). Custom style entry deleted entirely — TopBar's own `rightCluster` style (in TopBar.tsx) takes over.
**Why:** Satisfies SC-B-1 through SC-B-7. Closes 17a tactical TRANSITIONAL marker EXIT condition. Visual outcome preserved (same `[search, bell, +]` cluster); mechanism switched from inline-replace to compose.
**Lines changed:** -24 (rightSlot block) -7 (style entry) +8 (new extraRightSlot block) = **net -23 LOC** (slightly more than SPEC's -19 estimate due to conservative whitespace handling).

### §C — INVARIANT_REGISTRY I-37 entry (DRAFT)

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`
**What it did before:** Latest entry was I-36 ROOT-ERROR-BOUNDARY at line 1670+.
**What it does now:** Appends NEW I-37 TOPBAR-DEFAULT-CLUSTER-ON-PRIMARY-TABS entry (verbatim per SPEC §C.1), positioned chronologically after I-36, with `status: DRAFT — flips to ACTIVE on Cycle 17b CLOSE`. Includes statement, scope, why, CI enforcement (cross-reference to workflow + gate script), established-by, EXIT condition, cross-references, and regression-test description.
**Why:** Satisfies SC-C-1 through SC-C-3. Operator (or orchestrator at CLOSE) flips DRAFT → ACTIVE in 17b CLOSE protocol step.
**Lines changed:** +20

### §D.1 — Hardening-registry CI workflow

**File:** `.github/workflows/strict-grep-mingla-business.yml` (NEW)
**What it does:** GitHub Actions workflow firing on PR against `main` + `Seth` branches. Includes top-level registry-pattern documentation comment (per operator D-17b-5 framing) listing currently-registered gates + future-gate placeholders. One job (`i37-topbar-default-cluster`) installs `@babel/parser` + `@babel/traverse` on-demand via `npm install --no-save` + runs `i37-topbar-cluster.mjs`. Pinned versions: `actions/checkout@v4` + `actions/setup-node@v4` matching existing repo workflows.
**Why:** Satisfies SC-D-1 + SC-D-7 (workflow YAML valid). Foundation for future invariant CI gates per registry pattern.
**Lines:** 41

### §D.2 — i37-topbar-cluster.mjs gate script

**File:** `.github/scripts/strict-grep/i37-topbar-cluster.mjs` (NEW)
**What it does:** AST-based gate script. Walks every .tsx file under `mingla-business/app/` + `mingla-business/src/`, parses via `@babel/parser` with `typescript` + `jsx` plugins, traverses via `@babel/traverse`. For every `<TopBar>` JSX element: extracts `leftKind` value (string literal only — dynamic values warn but don't fail), checks `rightSlot=` attribute presence, checks line-immediately-above for `// orch-strict-grep-allow leftKind-brand-rightSlot — <reason>` allowlist comment. VIOLATION when `leftKind="brand"` AND `rightSlot=` present AND no allowlist. Outputs rich error (file + line + suggested fix + cross-reference to INVARIANT_REGISTRY). Exit codes: 0 clean / 1 violation / 2 inconclusive (script error). Walks defensively past `node_modules`, `.git`, `.expo`. Uses Windows path normalization via `relative()` + `split(sep).join("/")` for consistent error output.
**Why:** Satisfies SC-D-2 + SC-D-4 + SC-D-5 + SC-D-6 (verified via 3 fixture tests — see Section B).
**Lines:** ~190

### §D.3 — Registry README

**File:** `.github/scripts/strict-grep/README.md` (NEW)
**What it does:** Documents the registry pattern. Lists active gates (I-37) + future gates (I-32 / I-34 / I-36). Step-by-step "How to add a new gate (4 steps)" with verbatim workflow YAML template + script structure mirror of i37-topbar-cluster.mjs. Allowlist comment pattern documented with examples. Conventions section (exit codes, error format, warning format, parse failures, no-new-deps rule). Cross-references back to workflow + INVARIANT_REGISTRY + DEC-101 + memory file.
**Why:** Satisfies SC-D-3 + closes operator's "register hardening changes moving forward" framing per D-17b-5.
**Lines:** ~75

### §D.4 — Local test harness — SKIPPED

**Reason:** No repo-root `package.json` exists (verified via direct `ls`). Per SPEC §D.4 fallback ("If no repo-root `package.json` exists, skip this — implementor flags as discovery for future repo-root tooling"), skipped + flagged in §F below as informational.

### Memory file pre-write — `feedback_strict_grep_registry_pattern.md`

**File:** `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_strict_grep_registry_pattern.md` (NEW)
**What it does:** Operator-readable pattern documentation. Future skill sessions discovering "new invariant needs CI gate" find this memory via MEMORY.md index, follow the 4-step pattern, don't invent ad-hoc approaches. Status: DRAFT — flips to ACTIVE on Cycle 17b CLOSE. Lists rule, why, how-to-apply, active gates, future gates queued, do-not list, and cross-references.
**Index entry added** to MEMORY.md under "Implementor Uses /ui-ux-pro-max" section.
**Why:** Satisfies SC-X-3.

---

## 4. Section B — Verification matrix

### TopBar primitive (§A) — 6 SCs

| SC | Method | Result |
|---|---|---|
| SC-A-1 | Read TopBar.tsx — `extraRightSlot?: React.ReactNode;` present in TopBarProps with verbatim JSDoc | **PASS** |
| SC-A-2 | Read TopBar.tsx — `rightSlot` JSDoc updated per §A.4; documents 3 patterns (null/View/replace) | **PASS** |
| SC-A-3 | Read TopBar.tsx render branch — `rightSlot !== undefined ?` (NOT `??`) | **PASS** |
| SC-A-4 | Read TopBar.tsx — `DefaultRightSlotInner` returns `<>...</>` (no outer View) | **PASS** |
| SC-A-5 | Read TopBar.tsx — `[TRANSITIONAL]` marker on default search + bell preserved verbatim | **PASS** |
| SC-A-6 | `cd mingla-business && npx tsc --noEmit` post-§A | **PASS** (0 errors) |

### events.tsx migration (§B) — 7 SCs

| SC | Method | Result |
|---|---|---|
| SC-B-1 | Read events.tsx:393-417 region — old rightSlot block DELETED | **PASS** |
| SC-B-2 | Read events.tsx styles object — `topBarRightCluster` entry DELETED | **PASS** |
| SC-B-3 | Read events.tsx — new `extraRightSlot={canCreateEvent ? <IconChrome plus.../> : null}` present | **PASS** |
| SC-B-4 | `grep -n "topBarRightCluster" events.tsx` | **PASS** (0 hits) |
| SC-B-5 | `grep -n "rightSlot=" events.tsx` | **PASS** (0 hits) |
| SC-B-6 | Visual outcome `[search, bell, +]` for canCreateEvent / `[search, bell]` otherwise | **PASS (code-level)** — runtime confirmation deferred to tester smoke |
| SC-B-7 | tsc --noEmit post-§B | **PASS** (0 errors) |

### INVARIANT_REGISTRY (§C) — 3 SCs

| SC | Method | Result |
|---|---|---|
| SC-C-1 | Read INVARIANT_REGISTRY — I-37 entry present with verbatim §C.1 text | **PASS** |
| SC-C-2 | Status line: `DRAFT — flips to ACTIVE on Cycle 17b CLOSE` | **PASS** |
| SC-C-3 | Position: chronologically after I-36 entry | **PASS** |

### CI workflow (§D) — 7 SCs

| SC | Method | Result |
|---|---|---|
| SC-D-1 | File `.github/workflows/strict-grep-mingla-business.yml` exists with structure per §D.1 (registry comments + i37 job + future-gate placeholder list) | **PASS** |
| SC-D-2 | File `.github/scripts/strict-grep/i37-topbar-cluster.mjs` exists implementing §D.2 contract | **PASS** |
| SC-D-3 | File `.github/scripts/strict-grep/README.md` exists per §D.3 (4-step add procedure + tables) | **PASS** |
| SC-D-4 | `node i37-topbar-cluster.mjs` against current code → exit 0 | **PASS** (119 .tsx scanned, 0 violations) |
| SC-D-5 | Synthetic violation fixture → exit 1 + rich error | **PASS** (verified via temporary `src/__test_fixtures__/i37-violation.tsx` containing `<TopBar leftKind="brand" rightSlot={<View />} />`; gate output included file path + line + suggested fix + INVARIANT_REGISTRY cross-reference) |
| SC-D-6 | Allowlist comment fixture → exit 0 | **PASS** (added `// orch-strict-grep-allow leftKind-brand-rightSlot — Test fixture` immediately above; gate skipped silently) |
| SC-D-7 | Workflow YAML valid | **PASS (manual review)** — UNVERIFIED via actionlint (see SPEC-DISCOVERY-4 in §E) |

### Cross-cutting (X) — 3 SCs

| SC | Method | Result |
|---|---|---|
| SC-X-1 | `git status -s --untracked-files=all` confirms only TopBar.tsx + events.tsx + INVARIANT_REGISTRY.md (in mingla-business + Mingla_Artifacts) modified beyond the new `.github/` files + memory file | **PASS** (15 back-route consumers untouched per audit) |
| SC-X-2 | tsc --noEmit final | **PASS** (0 errors) |
| SC-X-3 | Memory file `feedback_strict_grep_registry_pattern.md` exists at expected path with status=DRAFT; MEMORY.md index updated | **PASS** |

**Total: 26/26 SCs PASS or PASS-code-level (1 awaits runtime smoke per dispatch §3 OUT OF SCOPE acknowledgement).**

---

## 5. Section C — Operator-side checklist (CLOSE-time action)

These actions fire at 17b CLOSE protocol (NOT during this IMPL):

1. **Flip I-37 status DRAFT → ACTIVE** in `Mingla_Artifacts/INVARIANT_REGISTRY.md` — change line `(mingla-business — Cycle 17b — DRAFT, flips to ACTIVE post-Cycle-17b CLOSE)` to `(mingla-business — Cycle 17b — ACTIVE post-Cycle-17b CLOSE 2026-MM-DD)`.
2. **Flip `feedback_strict_grep_registry_pattern.md` status DRAFT → ACTIVE** — change last line from `status: DRAFT — flips to ACTIVE on Cycle 17b CLOSE` to `status: ACTIVE post-Cycle-17b CLOSE 2026-MM-DD`. Update MEMORY.md index entry to remove the DRAFT parenthetical.
3. **Lock DEC-101** in `Mingla_Artifacts/DECISION_LOG.md` — author DEC-101 entry citing the 6 D-17b-N decisions (D-17b-1 structural-only · D-17b-2 keep rightSlot escape-hatch · D-17b-3 search W1 · D-17b-4 bell W5 · D-17b-5 hardening-registry CI workflow · D-17b-6 I-37 leftKind="brand" only).
4. **Sync 7 close-protocol artifacts** per orchestrator CLOSE protocol Step 1 (WORLD_MAP + MASTER_BUG_LIST + COVERAGE_MAP + PRODUCT_SNAPSHOT + PRIORITY_BOARD + AGENT_HANDOFFS + OPEN_INVESTIGATIONS).
5. **Commit message** + **EAS dual-platform OTA** per Step 2 + 3 — separate `--platform ios` then `--platform android` (per memory rule, never combined).
6. **Announce next dispatch** — 17c WCAG audit (covers D-CYCLE17A-IMPL-5 36px touch target + 88 missing accessibilityLabels per master inventory).

---

## 6. Section D — Test plan for tester

The 20 SPEC §6 test cases. Static checks already verified by implementor; tester re-runs as independent verification. Runtime checks gated on device.

### Static (re-run after pulling latest)

- T-9 — `grep "topBarRightCluster" events.tsx` → 0 hits (verified PASS)
- T-10 — `grep "rightSlot=" events.tsx` → 0 hits (verified PASS)
- T-11 — `tsc --noEmit` clean (verified PASS)
- T-12 — Synthetic violation fixture → exit 1 (verified PASS via temp fixture deleted post-test)
- T-13 — Clean code state → exit 0 (verified PASS)
- T-14 — Allowlist comment → exit 0 (verified PASS)
- T-15 — Dynamic leftKind warns but exits 0 (UNVERIFIED — no runtime fixture covers this case; tester may skip or write fixture)
- T-16 — INVARIANT_REGISTRY I-37 entry exists, status=DRAFT (verified PASS)
- T-17 — Workflow YAML valid via `actionlint` (UNVERIFIED — see SPEC-DISCOVERY-4 in §E; tester runs actionlint if available, else GitHub Actions visual feedback after push)
- T-18 — README documents 4-step gate addition (verified PASS)
- T-19 — Memory file pre-write present (verified PASS)
- T-20 — `git diff` confirms only expected files modified (verified PASS — see SC-X-1 evidence)

### Runtime (tester-required)

**Most important per founder feedback:**
- **T-6** — Sign in as account_owner with brand selected, navigate to events tab → confirm right cluster shows `[search-icon, bell-icon, plus-icon]` in that order, gap=8px (spacing.sm), 3 icons visible.
- **T-7** — Sign in as scanner role (rank=10), navigate to events tab → confirm right cluster shows `[search-icon, bell-icon]` only (no plus).

### Adjacent runtime spot-checks (tester verifies no regression on back-routes)

- Open Edit Brand → confirm Save button still renders in right slot (no [search, bell] intrusion). `BrandEditView.tsx:339`.
- Open Audit Log → confirm right slot empty (rightSlot={null} suppression honored). `audit-log.tsx:108`.
- Open Brand Profile → confirm `<View />` placeholder unchanged (no [search, bell] intrusion). `BrandProfileView.tsx:350,384`.
- Open Brand Payments → confirm `<View />` placeholder unchanged. `BrandPaymentsView.tsx:198,242`.
- Open Brand Finance Reports → confirm decorative download icon renders in right slot. `BrandFinanceReportsView.tsx:305`.
- Open Event Detail → confirm Share + Manage cluster renders in right slot. `event/[id]/index.tsx:625`.
- Open Team list → confirm conditional `+` invite button renders (rank-gated). `team.tsx:233`.

### Visual parity check

- T-1 through T-5 — TopBar render in 5 modes (default / extraRightSlot / null suppress / View placeholder / page-specific replace). All preserved.

### Dev styleguide

- T-8 — Tap `+` on events tab with brand selected → navigates to `/event/create`. With no brand → "Create a brand first" toast + BrandSwitcherSheet opens. (Existing handler unchanged.)

---

## 7. Section E — SPEC-discovery actions

| Discovery | Action taken | Outcome |
|---|---|---|
| **SPEC-DISCOVERY-1** (type-safety: plain optional both, NOT discriminated union) | Already RESOLVED in SPEC §A.1 — implemented per SPEC verbatim (no implementor decision required) | ✅ |
| **SPEC-DISCOVERY-2** (`@babel/parser` CI install on-demand) | Verified workflow YAML uses `npm install --no-save @babel/parser @babel/traverse` step. Babel deps already transitively present in `mingla-business/node_modules` (Expo/Metro depends on them) — local-test ran from `mingla-business/` directory with NODE module resolution finding them. CI runner installs fresh per workflow step. | ✅ |
| **SPEC-DISCOVERY-3** (repo-root `package.json` existence unverified) | **Confirmed absent.** Verified via `ls c:/Users/user/Desktop/mingla-main/package.json` → "No such file or directory". Per SPEC §D.4 fallback, **skipped** the local test harness. Operator may add at next polish cycle if repo-root tooling becomes useful. | ✅ skip + flagged below |
| **SPEC-DISCOVERY-4** (`actionlint` availability for T-17) | Workflow YAML manually reviewed against existing `deploy-functions.yml` + `rotate-apple-jwt.yml` shapes. `actionlint` not installed locally; full YAML validation deferred to **GitHub Actions runtime** (push to feature branch will surface any parse errors). | ⚠️ tester should verify on PR |
| **SPEC-DISCOVERY-5** (workflow pinned versions match existing) | Used `actions/checkout@v4` + `actions/setup-node@v4` matching existing repo workflows | ✅ |
| **SPEC-DISCOVERY-6** (memory file path on Windows-style paths) | Confirmed path `C:\Users\user\.claude\projects\c--Users-user-Desktop-mingla-main\memory\feedback_strict_grep_registry_pattern.md` resolves correctly. Used absolute Windows path with backslashes for Write tool; runtime verified file exists post-write. | ✅ |
| **SPEC-DISCOVERY-7** (TopBar header comment refresh) | **NOT applied.** Existing TopBar.tsx file-header JSDoc is still informationally accurate post-17b (it documents leftKind variants + right slot configurability). The new `extraRightSlot` is documented in its own JSDoc on the prop; no header-level refresh needed. Defer indefinitely or pick up at 17c if accessibility audit naturally surfaces top-bar JSDoc work. | ✅ skipped per scope discipline |

---

## 8. Section F — Discoveries for orchestrator

**D-CYCLE17B-IMPL-1 — `npm install --no-save` from repo root succeeded despite no repo-root package.json.**
When testing locally, `cd c:/Users/user/Desktop/mingla-main && npm install --no-save @babel/parser @babel/traverse` reported "changed 551 packages, audited 552 packages in 1m." This is unexpected since no root package.json exists. npm appears to walk UP the directory tree to find a parent's package.json (likely the user's profile or another project). **No node_modules created at repo root.** Behavior is harmless for the workflow YAML (CI runner has clean working dir) but should NOT be used as evidence that "deps installed correctly" when running locally — verify deps are accessible via `node` resolution from a directory that DOES have node_modules. Recommend orchestrator note: future strict-grep gate scripts should explicitly document "run from `mingla-business/` directory" so local-test resolution works predictably.

**D-CYCLE17B-IMPL-2 — TopBar `unreadCount` prop pass-through unchanged.**
Forensics §3a recommended preserving `unreadCount?: number` prop (which passes through to `DefaultRightSlotInner` for bell badge display). No 17b change to this prop's behavior. **Observation:** the bell badge from `unreadCount` is currently inert (no consumer passes a non-undefined value at runtime per session-context grep). Per D-17b-4 (W5 stay decorative), no wiring; future cycle could add live count from `eventEditLogStore` or similar. Logged for awareness.

**D-CYCLE17B-IMPL-3 — Test fixture cleanup pattern.**
The Checkpoint 4 testing required creating a temporary fixture file at `mingla-business/src/__test_fixtures__/i37-violation.tsx`. Implementor manually deleted post-test. **Recommendation:** if future strict-grep gates need similar local testing, consider a permanent `tests/strict-grep-fixtures/` directory under `.github/scripts/strict-grep/` with both clean + violation + allowlist examples + a small test runner script. Adds structure to "how to verify a new gate works." Not a 17b regression — informational.

**D-CYCLE17B-IMPL-4 — `mingla-business/node_modules` already contains `@babel/parser` + `@babel/traverse` transitively.**
Confirmed via direct `ls` — both packages present (transitive deps from Expo/Metro). This means the workflow YAML's `npm install --no-save` step is **redundant when running from `mingla-business/`** but **necessary when running from repo root** (CI's `actions/checkout@v4` checks out at repo root + the workflow doesn't `cd` into mingla-business). Workflow YAML is correct as written. Logged for orchestrator awareness; no action needed.

**D-CYCLE17B-IMPL-5 — `.github/scripts/strict-grep/` directory has no `package.json` for npm metadata.**
Each gate script is a standalone `.mjs` file with `import` statements pointing at packages installed via the workflow's on-demand step. **No package.json means no `engines.node`, `type: "module"`, or version pin.** Scripts are self-contained ESM (file extension `.mjs` makes Node treat them as modules without needing `type: "module"`). Acceptable for now; if the registry grows to 5+ gates with shared utility code, consider adding `package.json` + a shared `_helpers.mjs` to reduce duplication. Out of 17b scope.

**D-CYCLE17B-IMPL-6 — Bable parser plugin set is `["typescript", "jsx"]`.**
The gate script uses these plugins. Other plugins (e.g., `decorators`, `classProperties`) may be needed if future Mingla Business code adopts them. Currently no decorator usage in TSX files. If a future cycle adds decorators (e.g., MobX or NestJS-style), the gate script will need plugin updates. Logged as forward-compat watch-point.

---

## 9. Section G — Files changed (consolidated)

### MOD code

| Path | Change |
|---|---|
| `mingla-business/src/components/ui/TopBar.tsx` | +47 / -6 (extraRightSlot prop + JSDoc + DefaultRightSlotInner + render-branch + destructured prop) |
| `mingla-business/app/(tabs)/events.tsx` | +8 / -31 (tactical block deleted + style entry deleted + extraRightSlot inserted) net -23 |

### MOD docs

| Path | Change |
|---|---|
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +20 (NEW I-37 entry, DRAFT status) |
| (CLOSE-time at 17b CLOSE) `Mingla_Artifacts/DECISION_LOG.md` | DEC-101 entry pending operator/orchestrator authoring at CLOSE |

### NEW files

| Path | Lines |
|---|---|
| `.github/workflows/strict-grep-mingla-business.yml` | 41 |
| `.github/scripts/strict-grep/i37-topbar-cluster.mjs` | ~190 |
| `.github/scripts/strict-grep/README.md` | ~75 |
| `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_strict_grep_registry_pattern.md` | ~50 |

### MOD memory

| Path | Change |
|---|---|
| `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md` | +2 (new section + index entry for strict-grep registry) |

**Net code delta:** ~+255 net lines across 7 files (5 NEW + 2 MOD code; 2 NEW + 2 MOD docs). No deps changed in `mingla-business/package.json`. No native modules touched. EAS OTA-able.

---

## 10. Section H — Test first / known limits

### Most-important manual test (T-6 + T-7)

Open events tab on TestFlight or `npx expo start` build, verify visual cluster:
- **As account_owner with brand selected:** `[search-icon, bell-icon, plus-icon]` (3 icons visible, evenly spaced).
- **As scanner role:** `[search-icon, bell-icon]` (no plus).
- Tap `+` (where visible) → navigate to event creator.
- Tap search or bell → no action (existing TRANSITIONAL behavior preserved).

### Second priority (T-1 through T-5 + adjacent regression sweep)

Verify all 5 TopBar render modes still work as expected on back-routes (Edit Brand Save button, Audit Log empty, Brand Profile View placeholder, Brand Finance Reports decorative download, Event Detail Share+Manage, Team list invite Plus). All should render IDENTICALLY to pre-17b (since back-route consumers are byte-untouched).

### Known limits (UNVERIFIED — tester runtime required)

- Visual parity of the 3-icon cluster on events tab vs default 2-icon on home tab (T-A.1.7-equivalent — pixel-level confirmation requires device)
- Workflow YAML validation via `actionlint` (T-17 — implementor used manual review against existing workflows; tester or CI will surface real parse errors)
- T-15 dynamic `leftKind` warning behavior — gate emits WARN line + continues but exit code path with warnings vs violations may be tested via fixture if tester wants

### Pre-existing patterns preserved (NOT changed by 17b)

- IconChrome size 36 — kit-wide pattern; 17c WCAG audit territory per D-CYCLE17A-IMPL-5
- TopBar visual styling — glass chrome / icon shapes / gap spacing all unchanged
- Bottom nav — D-17-13 declined; Account stays in bottom nav

---

## 11. Cross-references

- SPEC: `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md`
- IMPL dispatch: `Mingla_Artifacts/prompts/IMPLEMENTATION_BIZ_CYCLE_17B_TOPBAR_IA_RESET.md`
- 17b dispatch chain: forensics + SPEC dispatches at `Mingla_Artifacts/prompts/`
- 17a tactical anchor (closed by §B): `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17A_QUICK_WINS.md` §A.1
- Master inventory: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17_REFINEMENT_PASS.md`
- Operator decisions locked (DEC-101 source): D-17b-1 through D-17b-6
- Memory rule pre-write (DRAFT): `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_strict_grep_registry_pattern.md`

---

**END OF IMPLEMENTATION REPORT.** Hand back to operator for orchestrator REVIEW + tester dispatch.
