# Audit — Codex vs Claude Skill Sync

**Date:** 2026-05-10
**Mode:** Forensics — observational audit (no code changes proposed)
**Scope:** Compare working rules between `.codex/skills/` and `.claude/skills/`, identify gaps.
**Confidence:** H — all SKILL.md files read on both sides; reference filenames listed; material divergences quoted with line references.

---

## 1. Inventory

### Codex skills (`/Users/sethogieva/Desktop/mingla-main/.codex/skills/`)
| Skill | SKILL.md size | Subfolders |
|-------|---------------|-----------|
| forensic-mingla | 14,651 B | agents/, references/ |
| implementor-mingla | 9,639 B | agents/, references/ |
| orchestrator-mingla | 12,701 B | agents/, references/ |
| pmm-mingla | 11,246 B | agents/, assets/, references/ |
| tester-mingla | 10,672 B | agents/, references/ |
| ui-ux-mingla | 7,575 B | agents/, data/, references/, scripts/ |

(Global `~/.codex/skills/.system/` exists but contains only system shims, not Mingla skills.)

### Claude skills (`/Users/sethogieva/Desktop/mingla-main/.claude/skills/`)
| Skill | SKILL.md size | Subfolders |
|-------|---------------|-----------|
| mingla-categorizer | 7,032 B | references/ — RETIRED per memory |
| mingla-designer | 14,081 B | references/ |
| mingla-forensics | 19,748 B | references/ |
| mingla-implementor | 16,208 B | references/ |
| mingla-orchestrator | 26,172 B | references/, scripts/ |
| mingla-price-tiers | 5,717 B | references/ |
| mingla-product | 12,311 B | references/ |
| mingla-tester | 13,797 B | references/ |
| ui-ux-pro-max | 14,105 B | data/, scripts/ (no references/) |

### Pair mapping
| Codex | Claude | Status |
|-------|--------|--------|
| forensic-mingla | mingla-forensics | Paired |
| implementor-mingla | mingla-implementor | Paired |
| orchestrator-mingla | mingla-orchestrator | Paired |
| tester-mingla | mingla-tester | Paired |
| pmm-mingla | mingla-product | Paired (different naming convention) |
| ui-ux-mingla | ui-ux-pro-max + mingla-designer | Ambiguous — Codex tailored variant; Claude has BOTH the upstream generic AND a separate Mingla designer |
| (none) | mingla-categorizer | Claude-only — RETIRED |
| (none) | mingla-price-tiers | Claude-only — operational sweep skill |

**Codex has no skill without a Claude counterpart.**

---

## 2. Pair-by-pair deltas

### 2.1 forensic-mingla ↔ mingla-forensics

**Frontmatter:** Codex `name: forensics` (declares itself "upgraded version of Claude `mingla-forensics`"). Claude embeds trigger keywords in YAML; Codex defers to body.

**Prime Directives:** Codex has **15 numbered rules** (lines 41–58); Claude has **6 core directives** (lines 55–69). Codex codifies migration-chain authority and Claude-skill read-only boundary explicitly.

**Phase 0 — Mandatory Ingestion (Codex only, lines 96–124):**
> "WHY THIS EXISTS: On ORCH-0410, the forensics agent found the original subscriptions migration and reported `CHECK (tier IN ('free', 'pro', 'elite'))` as current DB truth. A later migration had already restructured everything to `('free', 'mingla_plus')`."

Claude has Phase 0, but lacks the historical precedent block enforcing why it's mandatory.

**Reference files:**
- Codex (8): `claude-forensics-audit.md`, `forensic-checklist.md`, `layer-inspection-guide.md`, `mingla-surface-map.md`, `report-template.md`, `spec-layer-guide.md`, `spec-template.md`, `static-analysis-checklist.md`
- Claude (7): `invariant-violations.md`, `investigation-report-template.md`, `layer-inspection-guide.md`, `recurring-patterns.md`, `spec-layer-guide.md`, `spec-template.md`, `static-analysis-checklist.md`
- **Missing on Codex:** `invariant-violations.md`, `recurring-patterns.md`
- **Missing on Claude:** `mingla-surface-map.md`, `forensic-checklist.md`, `claude-forensics-audit.md` (audit doc, expected to be Codex-only)
- Naming clash: Codex `report-template.md` vs Claude `investigation-report-template.md`

**Modes:** Codex adds explicit `REVIEW` mode; Claude has only INVESTIGATE / SPEC / IA.

---

### 2.2 implementor-mingla ↔ mingla-implementor

**Prime Directives:** Codex (13) vs Claude (7). Codex codifies three Codex-specific responsibilities Claude is silent on:
- Rule 12: "Claude skills read-only" (Codex must not edit Claude skill files)
- Rule 13 (lines 46–47): *"Codex runs Deno gates. For Supabase edge-function work, Codex must run the relevant `deno check` and `deno test` gates itself. Use `/Users/sethogieva/.deno/bin/deno` when PATH lacks `deno`."*
- Rule 14: *"Standing deploy split. The operator runs `supabase db push`; Codex deploys edge functions after the operator confirms the DB push/migration gate succeeded."*
- Rule 15: Migration-monotonic-naming.

**Reference files:**
- Codex (6): `claude-implementor-audit.md`, `code-patterns.md`, `error-query-state-contracts.md`, `execution-protocol.md`, `invariants-and-constitution.md`, `report-template.md`
- Claude (6): `code-patterns.md`, `constitutional-quick-check.md`, `error-handling-contracts.md`, `invariant-checklist.md`, `query-key-discipline.md`, `report-template.md`
- Codex consolidates Claude's four granular files (`constitutional-quick-check`, `error-handling-contracts`, `invariant-checklist`, `query-key-discipline`) into two broader docs (`execution-protocol`, `invariants-and-constitution`). **Material content drift risk.**

---

### 2.3 orchestrator-mingla ↔ mingla-orchestrator (LARGEST GAP)

**Modes:** Codex names BOOTSTRAP / INTAKE / TRIAGE / DISPATCH / REVIEW / CLOSE / SYNC / ANSWER. Claude additionally names INVESTIGATE / SPEC / IMPLEMENT / VERIFY / SWEEP as first-class modes (Codex treats those as dispatch targets, not orchestrator modes).

**🔴 Critical gap — CLOSE protocol extension (Codex lines 267–354, 88 lines):**
Codex has 8 numbered sub-steps (5a → 5h) for retirement/decommissioning work:
- 5a: Author persistent memory file with deprecation guidance
- 5b: Update `MEMORY.md` index
- 5c: Scan and refresh existing memory files for deprecated references
- 5d: Skill-definition reviews for deprecated identifiers
- 5e: Constitutional / invariant updates
- 5f: Decision log entries
- 5g: Product snapshot + root-cause register updates
- 5h: Backup snapshot retention reminder with drop SQL

> Codex prologue note: "codified 2026-05-01" (i.e. post-ORCH-0700 phase 3B retirement work).

**Claude orchestrator has none of this.** Standard CLOSE is documented; the extension protocol is not.

**Step 1.5 — DIAG-marker reaping (Codex lines 207–234):**
> "Before proceeding to Step 2 (commit message), grep the codebase for diagnostic markers tied to the CLOSING ORCH-ID … **Required outcome: ZERO matches.** If matches exist, the orchestrator MUST: (a) instruct the operator to remove them … BEFORE the CLOSE proceeds."

Claude does not enforce DIAG-marker cleanup at CLOSE.

**Reference files:**
- Codex (7): `agent-prompts.md`, `artifact-system.md`, `claude-skill-audit.md`, `mingla-journey-and-invariants.md`, `operating-system.md`, `priority-scoring.md`, `review-close-protocol.md`
- Claude (8): `agent-prompts.md`, `artifact-templates.md`, `bootstrap-sequence.md`, `constitutional-compliance.md`, `failure-patterns.md`, `invariant-registry.md`, `priority-scoring.md`, `user-journey-map.md`
- Only **2 of 7+8 references** share names. The rest are reorganized — high drift risk.

---

### 2.4 tester-mingla ↔ mingla-tester

**Prime Directives:** Codex (15) vs Claude (16). Both forbid `mcp__supabase__apply_migration`, but Codex is more explicit about why (lines 48–49):
> "Applying migrations via MCP creates remote-only timestamps that break the user's deployment pipeline."

Claude states the rule but not the rationale.

**Reference files:**
- Codex (7): adds `claude-tester-audit.md`, has `ux-accessibility-protocol.md`
- Claude (6): has `ux-coherence-protocol.md` (different name, possibly different content scope)
- Naming divergence: **`ux-accessibility-protocol.md` vs `ux-coherence-protocol.md`** — verify whether these cover the same scope or have actually drifted.

---

### 2.5 pmm-mingla ↔ mingla-product

**Naming convention:** "PMM" (Product Marketing Manager) vs "Product." Different framing, same underlying role.

**Artifact destination divergence (Codex lines 85–99):**
> Codex: "write to `Mingla_Roadmap/` unless the user explicitly asks for a chat-only artifact … Do not put PMM work in root `outputs/`. Do not put PMM prompts in `Mingla_Roadmap/`; specialist prompts stay under ignored `Mingla_Artifacts/prompts/`."

Claude `mingla-product` writes to `Mingla_Artifacts/reports/` and `Mingla_Artifacts/specs/`. **The two skills will produce artifacts in different folders for the same task.**

**Reference files:**
- Codex (6): `company-context.md`, `gtm-framework.md`, `positioning-framework.md`, `product-principles.md`, `roadmap-system.md`, `sales-enablement-framework.md`
- Claude (10): `aso-playbook.md`, `audience-model.md`, `brand-voice.md`, `copy-patterns.md`, `growth-system.md`, `gtm-playbook.md`, `positioning-frameworks.md`, `reality-check-protocol.md`, `story-format.md`, `strategy-frameworks.md`
- **Almost zero overlap by filename.** Singular vs plural ("framework" vs "frameworks"); "framework" vs "playbook." Either covers different ground or has heavily diverged.

---

### 2.6 ui-ux-mingla ↔ ui-ux-pro-max (+ mingla-designer)

**Genealogy:** Codex `ui-ux-mingla` declares itself a Mingla-tailored fork of `nextlevelbuilder/ui-ux-pro-max-skill`. Claude has the upstream `ui-ux-pro-max` AND a separate `mingla-designer` skill. **Three skills, two systems, unclear single mapping.**

**Codex `ui-ux-mingla` references (3):** `mingla-design-workflow.md`, `mingla-style-overlay.md`, `source-audit.md`
**Claude `ui-ux-pro-max` references:** EMPTY (no `references/` folder; only `data/` + `scripts/`)
**Claude `mingla-designer` references:** present (8 files, not enumerated in this pass)

The Mingla-specific overlay lives in Codex; Claude splits it across `mingla-designer` (with possibly equivalent content). Verify whether `mingla-designer` and Codex `ui-ux-mingla` agree on Mingla design tokens, surfaces, and patterns — they appear to be parallel descendants, not synced copies.

---

## 3. Claude-only skills

| Skill | Status | Codex coverage? |
|-------|--------|-----------------|
| mingla-categorizer | RETIRED 2026-05-03 (per memory) | None — should not be re-added |
| mingla-designer | Active | Partially overlapped by Codex `ui-ux-mingla` |
| mingla-price-tiers | Active operational sweep skill | None — Codex has no parallel |

**`mingla-price-tiers`** has no Codex equivalent. If the user runs Codex sessions for tier work, they must currently swap to Claude or run the sweep manually. Decide whether this should be ported.

---

## 4. Codex-only structural elements (across multiple skills)

These appear in EVERY Codex skill but in NO Claude skill:

1. **`agents/` subfolder** — Codex skills include sub-agent prompt files. Claude skills do not.
2. **`claude-*-audit.md`** — Each Codex skill ships an audit of its Claude counterpart. By design Codex-only.
3. **"Claude skills read-only"** Prime Directive — Codex enforces non-mutation of `.claude/`.
4. **"Codex runs Deno gates"** Prime Directive — explicit Deno responsibility on Codex.
5. **"Standing deploy split"** Prime Directive — operator runs `db push`, Codex deploys edge fns.
6. **"Migration monotonic-naming"** Prime Directive — explicit ordering rule.
7. **CLOSE Step 1.5 DIAG-marker reaping** (orchestrator only).
8. **CLOSE Step 5a–5h decommissioning protocol** (orchestrator only).

---

## 5. Top sync gaps — priority-ordered

### 🔴 P0 — Orchestrator decommissioning protocol absent from Claude
Codex orchestrator codifies an 88-line CLOSE extension (Step 5a–5h) for retiring features, sweeping memory, updating the Constitution, and recording decision-log entries. Claude orchestrator has no equivalent. Any retirement run through Claude will leave stale memory entries, missed invariants, and no decision log.
**Recommendation:** Port Step 5a–5h to `mingla-orchestrator/SKILL.md` verbatim, or document why it's Codex-only.

### 🔴 P0 — DIAG-marker reaping gate absent from Claude
Codex blocks CLOSE until ZERO `[ORCH-${ID}-DIAG]` markers remain in the codebase. Claude does not. Diagnostic instrumentation can leak into production through Claude-driven CLOSEs.
**Recommendation:** Port Step 1.5 verbatim to Claude orchestrator.

### 🟠 P1 — Deno-gate / deploy-split responsibility not specified in Claude
Codex implementor & tester explicitly own Deno gate execution and the operator/Codex deploy split. Claude is silent. If a Mingla session runs entirely in Claude, the gate question is unclear: who runs `deno test`? Who deploys the edge function?
**Recommendation:** Either (a) declare Claude has no Deno responsibility (operator runs gates manually), or (b) port the rule to Claude. Decide explicitly.

### 🟠 P1 — Phase 0 mandatory-ingestion rigor weaker on Claude
Codex forensics has a `MANDATORY, NEVER SKIP` Phase 0 with a documented historical incident (ORCH-0410). Claude forensics references Phase 0 but with weaker enforcement language.
**Recommendation:** Mirror the ORCH-0410 precedent block into Claude `mingla-forensics/SKILL.md` so the same discipline applies regardless of which side runs.

### 🟡 P2 — Reference-file divergence across most pairs
Forensics, implementor, orchestrator, and product all have different reference filenames between sides. Risk: content drift over time, single-side updates, contradictions between same-named concepts.
**Recommendation:** For each pair, decide one canonical structure and align both sides — OR document explicitly which side holds the authoritative reference for each topic.

### 🟡 P2 — Artifact destination split (`Mingla_Roadmap/` vs `Mingla_Artifacts/`)
Codex `pmm-mingla` writes to `Mingla_Roadmap/`; Claude `mingla-product` writes to `Mingla_Artifacts/reports/`. Same task, different folders.
**Recommendation:** Pick one destination per artifact type and align both skills.

### 🟡 P2 — UI/UX three-skill ambiguity
Codex `ui-ux-mingla` overlaps both Claude `ui-ux-pro-max` (upstream generic) AND Claude `mingla-designer` (tailored). Decide single source of truth for Mingla UI patterns.
**Recommendation:** Either consolidate Claude-side into one Mingla design skill mirroring Codex, or document the explicit split (e.g., `ui-ux-pro-max` = generic library, `mingla-designer` = workflow, neither is the Mingla-style canonical).

### 🟡 P2 — `mingla-price-tiers` has no Codex equivalent
If price-tier sweeps run from Codex sessions, port the skill. Otherwise document that this is Claude-only.

---

## 6. Discoveries for orchestrator

- Codex consistently treats itself as the "upgraded" or "tailored" variant ("Codex-native replacement for Claude's `…`") in every SKILL.md frontmatter. This implies Codex is the leading edge and Claude is the historical baseline. If that's the user's mental model, Claude needs scheduled back-ports of every Codex update. If it's not, the framing should be neutralized.
- No Codex skill is older than 2026-05-07; multiple Claude skills are dated 2026-05-07 (ui-ux-pro-max is older, 2026-05-06). Within a single week the divergence has reached the levels documented above. Without a sync gate, divergence will accelerate.
- The `agents/` subfolder pattern (sub-agent prompt files) is a Codex feature absent from Claude. If Claude's Agent tool relies on inline prompts only, this is fine; if Codex's sub-agents are doing structural work Claude doesn't have, Claude is the weaker side.

---

**End of audit.**
