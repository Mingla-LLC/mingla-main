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
| I-37 | `i37-topbar-cluster.mjs` | 17b | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-37 |
| I-38 | `i38-icon-chrome-touch-target.mjs` | 17c | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-38 |
| I-39 | `i39-pressable-label.mjs` | 17c | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-39 |
| I-PROPOSED-A | `i-proposed-a-brands-deleted-filter.mjs` | 17e-A | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-A |
| I-PROPOSED-C | `i-proposed-c-brand-crud-via-react-query.mjs` | 17e-A | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-PROPOSED-C |

## Future gates (proposed but not yet implemented)

| Invariant | Proposed cycle | Notes |
|---|---|---|
| I-32 rank parity | 13a | Mobile UI rank thresholds in `permissionGates.ts` MUST mirror SQL `biz_role_rank()` numeric values |
| I-34 canManualCheckIn decommission | 13b | Field stays gone; references only allowed in migration v1→v2 strip logic |
| I-36 ROOT-ERROR-BOUNDARY | 16a | `app/_layout.tsx` MUST wrap `<Stack>` with `<ErrorBoundary>` |

## How to add a new gate (4 steps)

1. **Write the gate script** at `.github/scripts/strict-grep/iN-name.mjs`.
   Mirror the structure of `i37-topbar-cluster.mjs`:
   - Walk relevant files
   - Parse via `@babel/parser` (or appropriate parser for non-TSX targets)
   - Apply detection logic
   - Honor allowlist comment pattern: `// orch-strict-grep-allow <gate-tag> — <reason>`
   - Output rich error format on violation (file + line + suggested fix + cross-reference)
   - Exit `0` (clean), `1` (violation), `2` (inconclusive — script error)

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

3. **Cross-reference in `Mingla_Artifacts/INVARIANT_REGISTRY.md`** — add a
   "CI enforcement" line in the I-N entry pointing to the script + this
   README. Update the "Active gates registered" table above with the new
   row, and remove from "Future gates" table.

4. **Test locally** — run `node .github/scripts/strict-grep/iN-name.mjs`
   from the repo root with synthetic violation fixtures + clean fixtures.
   Verify exit codes + error message clarity. Document the test in the
   IMPL report.

## Allowlist comment pattern

If a violation is genuinely intentional (e.g., test fixtures, historical
migrations, internal kit primitives), add a comment IMMEDIATELY above the
offending code with this verbatim format:

```
// orch-strict-grep-allow <gate-tag> — <reason>
```

The `<gate-tag>` is gate-specific. Examples:
- I-37: `// orch-strict-grep-allow leftKind-brand-rightSlot — <reason>`
- I-34 (future): `// orch-strict-grep-allow canManualCheckIn — <reason>`

Each gate script reads the line immediately above its detected violation
and skips if the verbatim allowlist tag is present. Anything else (no
comment, wrong tag, malformed) is still a violation.

Other registered gate tags:
- I-38: `// orch-strict-grep-allow icon-chrome-touch-target — <reason>`
- I-39: `// orch-strict-grep-allow pressable-no-label — <reason>`
- I-PROPOSED-A: `// orch-strict-grep-allow brands-deleted-filter — <reason>`
- I-PROPOSED-C: `// orch-strict-grep-allow setBrands-call — <reason>`

## Conventions

- **Exit codes:** `0` clean, `1` violation, `2` script error / inconclusive.
- **Error format:** rich (file path + line number + offending pattern +
  suggested fix + cross-reference to INVARIANT_REGISTRY).
- **Warning format:** for cases the gate cannot statically verify (e.g.,
  dynamic JSX attribute values), report `WARN:` line but do NOT exit
  non-zero. The reviewer manually verifies during PR review.
- **Parse failures:** report `PARSE-FAIL:` per file. Exit `2` ONLY if
  every file failed (scaffold broken). Exit `0` or `1` otherwise based
  on violations found.
- **No new mingla-business dependencies.** Gate scripts use CI-installed
  parser packages via `npm install --no-save` in the workflow YAML.

## Cross-references

- Workflow: `.github/workflows/strict-grep-mingla-business.yml`
- Active invariants: `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- Decision lock: `Mingla_Artifacts/DECISION_LOG.md` DEC-101 (Cycle 17b)
- Memory: `feedback_strict_grep_registry_pattern.md` (operator-readable
  pattern documentation for future skill sessions)
