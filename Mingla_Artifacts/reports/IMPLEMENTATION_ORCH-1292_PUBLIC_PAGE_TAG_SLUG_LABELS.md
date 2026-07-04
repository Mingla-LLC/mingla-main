# IMPLEMENTATION — ORCH-1292 [public-page-tag-slug-labels]

- **ORCH-ID:** ORCH-1292
- **Label:** [public-page-tag-slug-labels]
- **Skill:** mingla-implementor
- **SPEC (binding):** `Mingla_Artifacts/reports/INVESTIGATION_SPEC_ORCH-1292_PUBLIC_PAGE_TAG_SLUG_LABELS.md` §7–§8
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1292-[public-page-tag-slug-labels]/` on branch `ORCH-1292-public-page-tag-slug-labels`
- **Rebased on:** origin/main `a577cd34c` (ORCH-1278 admin Money console) — was spawned at `359ce621a`; rebased forward so the workflow edit lands on the current file
- **Status:** implemented and verified (source + gate + unit-test level; runtime pill screenshot deferred to tester per SPEC §3 live-fire note)
- **Date:** 2026-07-03

---

## 1. Summary

On the public event/RSVP pages the tag pills under the event name printed the raw
computer codes for each tag (`pool-party`, `afrobeats`, `hiphop-rap`, `rnb-soul`) instead
of the friendly names ("Pool Party", "Afrobeats", "Hip-Hop/Rap", "R&B/Soul"). This adds a
tiny, self-contained name-resolver inside the shared page-body package and calls it at the
three render sites, so all five public surfaces (buyer web, consumer iOS/Android, business
iOS/Android preview) show the friendly names from one shared fix. A CI drift-gate keeps the
in-package name list byte-identical to the canonical taxonomy and fails the build if any
render site reverts to the raw code. Unknown/future tags now Title-Case gracefully instead
of printing raw kebab-case. Display-only — no database, network, pricing, or filtering
logic was touched.

The RSVP "momentum" party chips previously showed a *lightly-humanized* label
("Rooftop party") that was wrong for multi-word/punctuated tags; they now route through the
same canonical resolver ("Rooftop Party", "Hip-Hop/Rap"), matching the pills row.

---

## 2. SPEC success-criteria coverage

All satisfied by commit `61dbece87` (single commit; see §3 for per-file `git log`).

| SC | Criterion (SPEC §7/§8) | Evidence | Status |
|----|------------------------|----------|--------|
| SC-1 | New dep-free `taxonomyLabels.ts` exports `TAXONOMY_LABELS` (45 canonical pairs verbatim) + `taxonomyLabel(slug)` with Title-Case fallback; empty→empty; no react/rn import | file has 0 imports; Deno + tsc strict typecheck exit 0; unit test 6/6 | ✓ |
| SC-2 | Barrel `index.ts` adds `export { taxonomyLabel, TAXONOMY_LABELS }`; existing `rsvpMomentum` export (incl. `partyTypeLabel`) unchanged | diff §7; ORCH-1157 test 15/15 green | ✓ |
| SC-3 | `EventOfferingBody.tsx` 3 pill children `{tag}`→`{taxonomyLabel(tag)}`; `.map`/`key`/`<Pill>`/`testID="orch-1167-pills-row"`/section comments byte-identical | diff §7; ORCH-1167 gate PASS | ✓ |
| SC-4 | `RsvpOfferingBody.tsx` 3 pill children `{tag}`→`{taxonomyLabel(tag)}`; `testID="orch-1167-pills-row"` + `<Pill>` intact | diff §7 | ✓ |
| SC-5 | `RsvpMomentumDecision.tsx` import drops `partyTypeLabel`, adds `taxonomyLabel`; chip `{partyTypeLabel(slug)}`→`{taxonomyLabel(slug)}`; `testID="orch-1157-rsvp-chips"` + chip structure intact | diff §7 | ✓ |
| SC-6 | New gate `orch-1292-taxonomy-label-parity.mjs` — drift (set-equality + byte-exact label parity) + render-site (fails-on-revert) + `--self-test` (GOOD passes, BAD fails) | self-test exit 0; real run exit 0; §5 | ✓ |
| SC-7 | New workflow job `orch-1292-taxonomy-label-parity` — self-test step BEFORE real-run step; one registry-comment line; no existing job modified | YAML valid (292 jobs, all prior intact); §6 | ✓ |
| SC-8 | New Deno unit test `orch_1292_taxonomy_labels.test.ts` — 7 slugs, per-taxonomy, unknown fallback, empty, all 45 pairs, fails-on-revert documented | 6/6 pass; §5 | ✓ |
| SC-9 | Existing gates stay green: ORCH-1167 section-order + ORCH-0824 taxonomy-parity; ORCH-1157 test; I-MOR-0827 isolation | all exit 0 / green; §5 | ✓ |
| SC-10 | I-MOR-0827-PACKAGE-ISOLATION preserved — package imports no app `src/` | `taxonomyLabels.ts` 0 imports; both isolation gates PASS | ✓ |

---

## 3. Files changed (exactly the §8 allowlist — 8 files)

All committed in one commit on `ORCH-1292-public-page-tag-slug-labels`.

| # | File | Type | Δ |
|---|------|------|---|
| 1 | `packages/offering-rendering/taxonomyLabels.ts` | NEW | +93 |
| 2 | `packages/offering-rendering/index.ts` | MOD | +8 |
| 3 | `packages/offering-rendering/EventOfferingBody.tsx` | MOD | +5 / −3 |
| 4 | `packages/offering-rendering/RsvpOfferingBody.tsx` | MOD | +5 / −3 |
| 5 | `packages/offering-rendering/RsvpMomentumDecision.tsx` | MOD | +5 / −2 |
| 6 | `.github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs` | NEW | +330 |
| 7 | `.github/workflows/strict-grep-mingla-business.yml` | MOD | +14 (1 job + 1 comment line) |
| 8 | `packages/offering-rendering/__tests__/orch_1292_taxonomy_labels.test.ts` | NEW | +175 |

NOT committed (pre-existing forensics artifacts, out of my allowlist, left for the
orchestrator): `Mingla_Artifacts/WORLD_MAP.md` (2-line note), `Mingla_Artifacts/reports/INVESTIGATION_SPEC_ORCH-1292_PUBLIC_PAGE_TAG_SLUG_LABELS.md`.

---

## 4. Data-model / edge-function changes

- **Data-model:** NONE. No migration, no table/column/RLS/index change. Display-only.
- **Edge functions:** NONE touched. (`supabase/functions/_shared/eventTaxonomy.ts` is READ
  only by the drift gate at CI time; the file itself is unchanged — ORCH-0824 parity intact.)

---

## 5. Regression tests + fails-on-revert proof

**CI-enforced guard (the teeth):** `.github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs`
(per SPEC §6c — the strict-grep registry is the ONLY CI that runs on `packages/**`).

**Developer unit test:** `packages/offering-rendering/__tests__/orch_1292_taxonomy_labels.test.ts` (Deno).

### Gate self-test (runs first in CI) + real run

```
$ node .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs --self-test
ORCH-1292 taxonomy-label-parity gate SELF-TEST PASS.
exit=0

$ node .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs
ORCH-1292 taxonomy-label-parity: clean — 45 canonical labels in set-equality + parity with TAXONOMY_LABELS; all 3 render sites resolve via taxonomyLabel.
exit=0
```

### Fails-on-revert (true render-site revert, then restore)

Reverted `EventOfferingBody.tsx` vibe pill child `{taxonomyLabel(tag)}` → `{tag}`:

```
$ node .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs
ORCH-1292 taxonomy-label-parity gate FAILED:
  ✗ EventOfferingBody.tsx: pills row still renders the RAW slug {tag} — reverted to unmapped kebab-case.
exit=1
```

Restored → `exit=0` (clean). The gate catches even a *partial* revert (party+music pills
still resolved, only vibe reverted — still failed). **fails-on-revert verified at commit `61dbece87`.**

### Deno unit test

```
$ deno test --allow-read packages/offering-rendering/__tests__/orch_1292_taxonomy_labels.test.ts
Check packages/offering-rendering/__tests__/orch_1292_taxonomy_labels.test.ts
running 6 tests ...
Seth's 7 example slugs resolve to their exact canonical labels ... ok
a representative slug from each taxonomy maps to its canonical label ... ok
an unknown slug Title-Cases every word (never raw kebab) ... ok
empty string in → empty string out (no throw) ... ok
TAXONOMY_LABELS covers all 45 canonical pairs, byte-exact ... ok
no canonical label is left as raw kebab-case ... ok
ok | 6 passed | 0 failed
```

### Existing gates + tests stay green (SPEC DO-NOT-BREAK)

```
$ node .github/scripts/strict-grep/orch-1167-canonical-9-section-order.mjs   → PASS (exit 0)
$ node .github/scripts/strict-grep/orch-0824-event-taxonomy-parity.mjs       → clean (exit 0)
$ node .github/scripts/strict-grep/meta-orch-0827-package-isolation.mjs      → PASS
$ node .github/scripts/strict-grep/orch-1138-mor-isolation.mjs               → OK
$ deno test .../orch_1157_rsvp_momentum.test.ts                              → 15 passed | 0 failed
   (incl. "partyTypeLabel humanizes canonical kebab slugs" — partyTypeLabel stays exported + tested)
```

### Typecheck

- Deno `Check` strict-type-checked `taxonomyLabels.ts` (via `deno test`) — pass.
- Repo `tsc` (mingla-business TypeScript) strict standalone check of `taxonomyLabels.ts` — exit 0.
- The three `.tsx` edits are type-preserving one-token swaps: `tag: string` → `taxonomyLabel(tag): string`
  (JSX child type unchanged); `taxonomyLabel(slug: string): string` has the identical signature to
  the dropped `partyTypeLabel`. No full-package RN `tsc` was run (needs the consuming app's
  `node_modules` to resolve `expo/tsconfig.base`; the package has none of its own) — the edits
  introduce no new types.

---

## 6. Workflow registration (self-test gates the real run — hard REVIEW requirement)

New job added at the top of `jobs:` (no existing job modified; YAML validated — 292 jobs, all
prior jobs incl. the rebased ORCH-1278 admin gates intact):

```yaml
  orch-1292-taxonomy-label-parity:
    name: "ORCH-1292: public event/RSVP pills resolve party/vibe/music slugs to canonical labels; in-package map stays in parity with eventTaxonomy.ts (I-PROPOSED-1292-TAXONOMY-LABEL-AT-RENDER)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Self-test the ORCH-1292 taxonomy-label-parity gate
        run: node .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs --self-test
      - name: Run ORCH-1292 taxonomy-label-parity gate
        run: node .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs
```

Plus one registry-comment line in the gate-list block (`I-PROPOSED-1292-TAXONOMY-LABEL-AT-RENDER
… DRAFT until CLOSE`).

---

## 7. Old → New receipts

### `taxonomyLabels.ts` (NEW)
- **Before:** did not exist.
- **After:** dep-free module exporting `TAXONOMY_LABELS` (45 verbatim party+vibe+music
  `slug→label` pairs from `eventTaxonomy.ts`) + `taxonomyLabel(slug)` returning the canonical
  label or a Title-Case fallback; empty→empty, no throw.
- **Why:** SPEC §7.1 — single in-package resolver (Option B), isolation-safe.

### `index.ts`
- **Before:** exported `rsvpMomentum` symbols + others; no taxonomy-label export.
- **After:** adds `export { taxonomyLabel, TAXONOMY_LABELS } from "./taxonomyLabels";`.
  `rsvpMomentum` export (incl. `partyTypeLabel`) untouched.
- **Why:** SPEC §7.2.

### `EventOfferingBody.tsx`
- **Before:** pills row rendered the raw slug `{tag}` for vibe/party/music.
- **After:** renders `{taxonomyLabel(tag)}` at all three; `+ import { taxonomyLabel }`.
  `(4) Pills row` comment, `testID="orch-1167-pills-row"`, `<Pill>` props, `.map`/`key` all
  byte-identical (ORCH-1167 gate PASS).
- **Why:** SPEC §7.3 Site 1 (F-1 root cause).

### `RsvpOfferingBody.tsx`
- **Before:** pills row rendered raw `{tag}` for vibe/party/music (inline single-line Pills).
- **After:** `{taxonomyLabel(tag)}` at all three; `+ import`. `testID="orch-1167-pills-row"` + `<Pill>` intact.
- **Why:** SPEC §7.3 Site 2 (F-2 root cause).

### `RsvpMomentumDecision.tsx`
- **Before:** import `{ deriveMomentum, partyTypeLabel }`; chip rendered `{partyTypeLabel(slug)}`
  (humanized: only first word capitalized → "Rooftop party", "Hiphop rap").
- **After:** import `{ deriveMomentum }` + `{ taxonomyLabel }`; chip renders `{taxonomyLabel(slug)}`
  (canonical: "Rooftop Party", "Hip-Hop/Rap"). `testID="orch-1157-rsvp-chips"` + chip structure intact.
  `partyTypeLabel` is now unused by components but stays exported + unit-tested (no regression).
- **Why:** SPEC §7.3 Site 3 (F-3 secondary root cause — canonical consistency).

---

## 8. Cross-surface impact

| Surface | Affected | For the end user | Parity |
|---------|:--------:|------------------|--------|
| Consumer iOS | YES | event/RSVP pills + RSVP party chips show friendly labels | shared code (auto) |
| Consumer Android | YES | same | shared code (auto) |
| Buyer/anon Web (`/e/…`) | YES | same (ships via Vercel `[deploy]`) | shared code (auto) |
| Business iOS | YES | preview pills show labels; rides next native build | shared code (auto) |
| Business Android | YES | same; rides next native build | shared code (auto) |
| Admin Web (adjacent) | NO | does not render these public-event pills | n/a |
| Business Web preview (adjacent) | YES | preview pills show labels (Vercel `[deploy]`) | shared code (auto) |

Parity is **automatic** — all five surfaces mount the SAME two shared bodies with no
per-surface fork and no `.web.tsx` variant. One change, every surface.

---

## 9. Smoke result

- Source-level + gate-level + unit-test-level verification complete (all commands in §5).
- No simulator/device runtime screenshot taken here: per SPEC §3, the authed business-web
  runtime is capped (`feedback_biz_web_authed_runtime_unreachable_cap_claims`) and the causal
  chain is proven at source (raw-`{tag}` render is unambiguous; `<Pill>` is a verbatim text
  wrapper). SPEC §7.6b routes a live-fire anon-web `/e/…` pill screenshot to the tester.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- `partyTypeLabel` (in `rsvpMomentum.ts`) is now unused by any component but intentionally
  retained (exported + unit-tested) for backward-compat, per SPEC §7.3 / §8. Not dead code by
  the SPEC's contract; a future cleanup ORCH may remove it.
- Runtime pill screenshot on the anon-web `/e/…` route = tester's job (SPEC §7.6b).

---

## 11. Operator action required

- **No migration** (`db push`) — none written.
- **No edge-function deploy** — none touched.
- **Web delivery:** buyer-web + business-web preview ship via Vercel `[deploy]` on merge (this
  is a pure-JS package change). Native (consumer + business iOS/Android) ride their next
  respective builds. **No OTA** — business OTA remains prohibited (COMMS-0052 acknowledged;
  this work does no OTA).
- **Orchestrator at CLOSE:** flip `I-PROPOSED-1292-TAXONOMY-LABEL-AT-RENDER` DRAFT→ACTIVE in
  `Mingla_Artifacts/INVARIANT_REGISTRY.md` + `README.md` registry table (out of implementor
  allowlist; the workflow comment marks it DRAFT until CLOSE). Also commit/handle the
  forensics artifacts (`WORLD_MAP.md`, the INVESTIGATION_SPEC) still uncommitted in the worktree.

---

## 12. Discoveries for Orchestrator

- **Origin/main advanced during the ORCH.** The worktree was spawned at `359ce621a`; origin/main
  moved to `a577cd34c` (ORCH-1278 admin Money console, which also edits
  `.github/workflows/strict-grep-mingla-business.yml`). I rebased forward so my one-job addition
  lands on the current workflow (both ORCH-1278's admin gates and my job now coexist — verified
  292 jobs, YAML valid). No file-overlap conflict with my allowlist otherwise.
- **No other in-flight ORCH touches the three render sites or the offering-rendering package**
  (COMMS ledger scanned; the offering-rendering mentions in COMMS-0058/0059 were cover-video /
  topsheet, disjoint from the pills).
- No unrelated bugs found in the touched files.
