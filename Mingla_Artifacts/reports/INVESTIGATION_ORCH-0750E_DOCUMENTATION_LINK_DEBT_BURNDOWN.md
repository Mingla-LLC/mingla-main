# INVESTIGATION ORCH-0750E - Documentation Link Debt Burn-Down

**Date:** 2026-05-07
**Mode:** forensics
**Scope:** deterministic plan to reduce the Mingla documentation link baseline from known debt to zero.
**Evidence tree:** clean worktree at `origin/Seth` commit `733a9cf4`.
**Non-goal:** no link rewrites, deletes, archive moves, README prose rewrites, or skill edits in this investigation.

## Executive Verdict

The documentation system is now governed, but it is not fully clean.

Current CI truth is:

| Metric | Count |
|---|---:|
| Files checked | 392 |
| Total markdown links | 2,377 |
| Missing local links | 1,195 |
| Current baseline file | `scripts/docs/link_baseline.json` |
| Current baseline ceiling | 1,195 |

The burn-down is tractable because the debt is clustered. Five active/current ledger files account for **681 / 1,195** missing links:

| Source | Missing |
|---|---:|
| `Mingla_Artifacts/AGENT_HANDOFFS.md` | 225 |
| `Mingla_Artifacts/MASTER_BUG_LIST.md` | 199 |
| `Mingla_Artifacts/WORLD_MAP.md` | 172 |
| `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | 57 |
| `Mingla_Artifacts/PRIORITY_BOARD.md` | 28 |

Plain-English root cause: old artifacts often link as if they live at repo root. From inside `Mingla_Artifacts/`, links such as `app-mobile/...`, `supabase/...`, or `Mingla_Artifacts/...` resolve to the wrong place unless they are made relative, routed through the manifest, or converted to historical citations. The rest is mostly private prompt references and truly missing historical artifact names.

## Link Debt By Class

| Class | Count | Meaning | Fix Rule |
|---|---:|---|---|
| `MOVED_OR_ARCHIVED_CANDIDATE` | 596 | A file with the same basename exists elsewhere, or the target likely moved. | Resolve to the real path, archive path, or manifest entry. |
| `PROMPT_PRIVATE_OR_IGNORED` | 458 | Link points to ignored/private prompt storage. | Replace with report/spec evidence or mark as private text, not a markdown link. |
| `TRUE_MISSING_REFERENCE` | 123 | No plausible local target found. | Recover, rewrite as textual citation, or remove. |
| `HISTORICAL_SOURCE_MISSING` | 14 | Historical report/spec points to absent historical source. | Preserve as history; replace link with citation or archive note. |
| `GENERATED_OR_IGNORED_TARGET` | 4 | Link points into generated/ignored material. | Remove as durable evidence or rewrite to source-level explanation. |

## Root-Cause Findings

### F1 - Path Semantics Are The Largest Mechanical Source

**Classification:** confirmed documentation defect
**Evidence:** `MOVED_OR_ARCHIVED_CANDIDATE` = 596 links.

Within that class:

| Target family | Count |
|---|---:|
| `app-mobile/...` | 248 |
| `supabase/...` | 135 |
| `Mingla_Artifacts/...` | 149 |
| `mingla-business/...` | 15 |
| `mingla-admin/...` | 7 |
| `scripts/...` | 4 |
| other relative patterns | 38 |

Most of these are not "lost files." They are stale Markdown paths. Example: a link from `Mingla_Artifacts/WORLD_MAP.md` to `app-mobile/src/...` resolves as `Mingla_Artifacts/app-mobile/src/...`, not repo-root `app-mobile/src/...`.

**Fix direction:** implement a deterministic path-normalization pass, source file by source file, then ratchet the baseline down after each verified batch.

### F2 - Private Prompts Are Not Durable Evidence

**Classification:** confirmed source-of-truth gap
**Evidence:** `PROMPT_PRIVATE_OR_IGNORED` = 458 links across 145 source files.

Most prompt links point to `prompts/` or `Mingla_Artifacts/prompts/`. Those paths are private/ignored and cannot be used as durable README or artifact evidence.

**Fix direction:** replace prompt links with the returned report/spec/test artifact when one exists. If no durable artifact exists, keep the prompt name as plain text and mark `PRIVATE_PROMPT_NOT_VERSIONED`.

### F3 - True Missing References Are Concentrated

**Classification:** confirmed documentation defect
**Evidence:** `TRUE_MISSING_REFERENCE` = 123 links, but only 6 source files.

Primary sources:

| Source | Count |
|---|---:|
| `Mingla_Artifacts/MASTER_BUG_LIST.md` | 39 |
| `Mingla_Artifacts/WORLD_MAP.md` | 33 |
| `Mingla_Artifacts/AGENT_HANDOFFS.md` | 23 |
| `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` | 19 |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | 8 |
| `Mingla_Artifacts/ROOT_CAUSE_REGISTER.md` | 1 |

**Fix direction:** handle these after the mechanical path pass. Some targets may become valid once ledger links are normalized; remaining ones need artifact recovery or textual citation.

### F4 - Generated/Ignored Links Are Tiny And Should Be Removed First

**Classification:** confirmed documentation hygiene defect
**Evidence:** 4 links point to `app-mobile/node_modules/expo-router/build/ExpoRoot.js#L77-L83`.

**Fix direction:** replace these with a source-level explanation or remove the link. Docs should not cite `node_modules` as durable evidence.

## Deterministic Burn-Down Timeline

This is the recommended implementation sequence. Each phase must end with:

```bash
python3 scripts/docs/check_links.py --format markdown --baseline-file scripts/docs/link_baseline.json
python3 scripts/docs/check_artifact_placement.py
python3 scripts/docs/check_readme_snapshot.py
```

After each phase, lower `scripts/docs/link_baseline.json` to the new observed missing-link count.

| Phase | Target | Starting Count | Expected Result | Exit Gate |
|---|---:|---:|---|---|
| 0 | Lock report/spec for this burn-down | N/A | This investigation reviewed by orchestrator; spec written for implementor. | No code changes yet. |
| 1 | Generated/ignored targets | 4 | Remove all durable links into `node_modules` or generated roots. | Baseline <= 1,191. |
| 2 | Repo-root path normalization | 409 | Fix `app-mobile/`, `supabase/`, `mingla-business/`, `mingla-admin/`, `scripts/`, and `docs/` links from artifact files. | Baseline <= 782. |
| 3 | `Mingla_Artifacts/` self-link normalization | 149 | Fix artifact links that incorrectly include `Mingla_Artifacts/` from inside `Mingla_Artifacts/`. | Baseline <= 633. |
| 4 | Other moved/archive candidates | 38 | Resolve `../` and archive-relative stragglers through manifest/archive paths. | Baseline <= 595. |
| 5 | True missing references | 123 | Recover existing artifacts where possible; rewrite unrecoverable links as citations. | Baseline <= 472. |
| 6 | Private prompt references | 458 | Replace with durable reports/specs or plain-text `PRIVATE_PROMPT_NOT_VERSIONED` markers. | Baseline <= 14. |
| 7 | Historical source missing | 14 | Rewrite absent historical-memory/source paths as archive citations or plain text. | Baseline = 0. |
| 8 | Zero-clean lock | 0 target | Change CI from baseline ceiling to strict zero. | `python3 scripts/docs/check_links.py --max-missing 0` passes. |

## Why This Order

1. Generated links are tiny and uncontroversial.
2. Mechanical path normalization removes the biggest chunk without deciding product truth.
3. Artifact self-links are also mechanical but require more care because some should route through archive/manifest.
4. True missing references should wait until path mistakes are gone, so we do not chase ghosts.
5. Private prompt references are large and policy-heavy; they need artifact judgment, not blind path rewrites.
6. Historical source links are last because they are provenance, not active operating instructions.

## Confidence

**High** for counts, root causes, and phase order.
**Medium** for exact per-phase final counts because some links may change classification after earlier fixes. The baseline must therefore be ratcheted from actual checker output after every phase, not from predicted math alone.

## Next Required Output

Write a SPEC for ORCH-0750E implementation with:

- exact files/classes each phase may touch;
- no deletion unless manifest status allows it;
- baseline ratchet rule after each phase;
- mandatory final zero-clean gate;
- rule that private prompts become durable report/spec links or plain text, never README evidence;
- regression guard that fails CI if missing links increase.
