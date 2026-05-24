# SPEC — META-ORCH-0954 [Cross-chat comms ledger + standardized 2-section output]

**Phase:** SPEC
**Owner:** mingla-orchestrator (Claude side) — to be implemented by Codex `implementor-mingla` (default) or Claude `mingla-implementor`
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0954-[cross-chat-comms-ledger-and-2-section-output]/`
**Branch:** `META-ORCH-0954-cross-chat-comms-ledger-and-2-section-output`
**Inputs:** `Mingla_Artifacts/INVESTIGATION_META-ORCH-0954_COMMS_LEDGER_AND_2_SECTION_OUTPUT.md` (read first)
**Date:** 2026-05-24
**Status:** Ready for IMPLEMENT dispatch

---

## 0. Why this exists (one paragraph)

Two parallel ORCHs touching shared code today have no programmatic way to warn each other. The fix is a shared, append-mostly comms ledger every skill reads on entry and writes to on cross-ORCH discovery. In the same spec we replace the conditional 4-section response shape with an unconditional 2-section shape (A: what just happened; B: handoff) that every skill emits on every chat response, every time.

---

## 1. Affected Surfaces

`Affected Surfaces: process/orchestration-only — no client surface`
`Surfaces explicitly NOT in scope: consumer-iOS, consumer-Android, business-iOS, business-Android, buyer-web, admin-web (no product code touched in this spec).`

---

## 2. Deliverables (file-by-file)

### 2.1 Canonical ledger file

**Path:** `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` (i.e. repo root on `main` branch — the anchor checkout).

**Created by:** implementor, in a direct-to-`main` one-file commit OUTSIDE the META-ORCH-0954 PR. This is the only file in this spec that does NOT land via the per-ORCH PR — the ledger must exist on `main` before SKILL.md backfill ships, otherwise the new entry-stanza will reference a missing file.

**Procedure:**
```bash
cd /Users/sethogieva/Desktop/mingla-main
git checkout main && git pull
# create the file with the template content (§2.2)
git add COMMS_LEDGER.md
git commit -m "META-ORCH-0954 prep: create canonical COMMS_LEDGER.md"
git push origin main
```

**Contents:** the template in §2.2 verbatim.

### 2.2 Ledger file template (verbatim content)

```markdown
# Mingla Comms Ledger

**Canonical path:** `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` (anchor `main`).
**Reachable from every worktree** via absolute path.
**Read on every skill entry.** Write on cross-ORCH discovery.

Reference contract: `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-COMMS-LEDGER-ENTRY-STANZA, I-COMMS-LEDGER-WRITE-ON-DISCOVERY.

---

## How to read this file

Every Claude or Codex skill, on entry, scans the Active-entries table below.
For each row where `to` matches your skill name, OR your current ORCH-ID,
OR is literally `ALL`:

- `severity: BLOCK` + `status: OPEN` → STOP. Do the body. Append your
  `skill+side` to `acked_by`. Set status to `ACKNOWLEDGED` (or `RESOLVED`
  if the action fully closes it). Mention the ack in your chat response
  Section A ("Also handled COMMS-NNNN: <subject>").
- `severity: WARN` + `status: OPEN` → read, factor into your turn,
  append `skill+side` to `acked_by`.
- `severity: FYI` → read and continue.

## How to write

When you discover something that affects another in-flight ORCH:
1. Allocate next `COMMS-NNNN` (max existing ID + 1, zero-pad to 4).
2. Append a row to the Active table.
3. Direct-to-`main` one-file commit:
   ```bash
   cd /Users/sethogieva/Desktop/mingla-main
   git checkout main && git pull
   # edit COMMS_LEDGER.md to append the row
   git add COMMS_LEDGER.md
   git commit -m "COMMS-NNNN: <one-line subject>"
   git push origin main
   ```
4. Mention the new entry in your chat response Section A.

Bodies are inline (column may use `<br>` for line breaks). No separate detail files.

## Stale cleanup

Orchestrator sweeps the table at the top of every SNAPSHOT / TRIAGE / BOOTSTRAP run:
- `OPEN` rows with `expires < today` → set status to `STALE`.
- `RESOLVED` and `STALE` rows → move below the `## Archive` divider.
- Default `expires`: 14 days for `WARN` and `FYI`; `none` for `BLOCK` (BLOCK never auto-stales).

---

## Active entries

| id | created | from | to | re_orch | sev | subject | body | status | acked_by | resolved_at | expires |
|---|---|---|---|---|---|---|---|---|---|---|---|

---

## Archive (resolved / stale — do not act on; kept for audit)

| id | created | resolved_at | from | to | re_orch | sev | subject | body | final_status |
|---|---|---|---|---|---|---|---|---|---|
```

### 2.3 Read-on-entry stanza (verbatim, inserted into every SKILL.md + AGENTS.md)

**Exact heading text the strict-grep gate enforces (case-sensitive, single line):**

```
## Read the Comms Ledger on entry (MANDATORY)
```

**Full stanza body to insert verbatim under that heading:**

```markdown
## Read the Comms Ledger on entry (MANDATORY)

Before doing ANY other work this turn, read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. Scan the **Active entries** table. For each row where `to` matches THIS skill name, OR matches the current ORCH-ID, OR is literally `ALL`:

1. `severity: BLOCK` + `status: OPEN` → STOP. Execute the body now. Append your `skill+side` to `acked_by` and change status to `ACKNOWLEDGED` (or `RESOLVED` if the action fully closes it). Mention the ack in your chat response Section A.
2. `severity: WARN` + `status: OPEN` → read, factor into this turn's work, append `skill+side` to `acked_by`.
3. `severity: FYI` → read and continue.

When YOU discover something that affects another in-flight ORCH, write a new `COMMS-NNNN` entry via a direct-to-`main` one-file commit on the anchor checkout (procedure in the ledger file itself). Mention the new entry in your chat response Section A.

Reference: `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-COMMS-LEDGER-ENTRY-STANZA + I-COMMS-LEDGER-WRITE-ON-DISCOVERY.
```

### 2.4 Per-file insertion-point map (10 files)

For each file below: **REMOVE** the existing 4-section response-shape language AND **INSERT** the §2.3 stanza + the §2.5 new 2-section template. Exact insertion point: immediately after the file's preamble / front-matter, BEFORE any mode definitions or detailed instructions. The two new sections must appear in this order: ledger stanza first, then 2-section template.

| # | File | Existing section(s) to delete | Existing reference to update |
|---|---|---|---|
| 1 | `.claude/skills/mingla-orchestrator/SKILL.md` | `## Response Protocol — 4-Section Output (CONDITIONAL …)` (~lines 430-510 region) | also update `references/operating-system.md` cross-link if present |
| 2 | `.claude/skills/mingla-forensics/SKILL.md` | "Universal Skill Output Format" / 4-section block | — |
| 3 | `.claude/skills/mingla-implementor/SKILL.md` | 4-section block | — |
| 4 | `.claude/skills/mingla-tester/SKILL.md` | 4-section block | — |
| 5 | `.claude/skills/mingla-product/SKILL.md` | 4-section block | — |
| 6 | `.claude/skills/mingla-designer/SKILL.md` | 4-section block | — |
| 7 | `.claude/skills/ui-ux-pro-max/SKILL.md` | 4-section block | — |
| 8 | `.claude/skills/mingla-price-tiers/SKILL.md` | 4-section block | — |
| 9 | `.claude/skills/mingla-categorizer/SKILL.md` | 4-section block (skill is retired but still loaded — backfill anyway) | — |
| 10 | `/Users/sethogieva/Desktop/mingla-main/AGENTS.md` | none to delete (no existing response-shape section) — INSERT both stanzas as new top-level sections after the "Company/Product Operating Context" section | — |

For files that do not contain a 4-section response-shape section verbatim (search for "4-Section Output" / "Section 1 — Where we were" / "Universal Skill Output Format"), simply INSERT the new sections without deleting anything; no existing block to remove.

### 2.5 Verbatim 2-section template (replaces every previous response-shape rule)

```markdown
## Standardized 2-Section Output (MANDATORY, every response, every turn)

Every chat response from this skill uses exactly two top-level sections: **A** and **B**. No exceptions, no skipping, no extra top-level sections.

### Section A — What just happened

1–4 short sentences in plain English from the user's perspective. Lead with the outcome and what Seth needs to know to make an informed decision. No jargon. No file paths unless the path IS the deliverable. ORCH-#### references carry a `[bracketed feature/bug label]` on first mention.

For shipped work: name what changed for end users.
For mid-flight work (investigation just finished, spec just written, prompt just drafted): name what just got decided/found/written and what it means for the next step.
For status / strategy / Q&A turns: just answer in plain English.

If you acknowledged a comms-ledger entry mid-turn, include a one-sentence mention: "Also handled COMMS-NNNN: <subject>".

If this turn shipped UI/runtime work Seth can touch, add a single labeled sub-section:

#### How to smoke-test on the app
1. [Open <app surface>, navigate to <screen>.]
2. [Specific tap / action.]
3. [What Seth should see.]
4. [Next action and expected result.]

The smoke-test sub-section is OMITTED entirely when the turn did not ship user-touchable work.

### Section B — Handoff

Exactly ONE of three variants, chosen by asking "whose hands does the work go to next?":

**B1 — Seth does the next thing himself (deploy, merge, eyeball, decide):**

```
NEXT STEPS — for you, Seth:

1. [Plain-English action with exact command, URL, or button name inline.]
2. [Next action.]
3. [Verification step that proves it worked.]
```

**B2 — Another skill takes the next phase:**

```
NEXT HANDOFF — paste into [target skill name + side]:

[Single prose paragraph, 3–5 sentences, self-contained. Names: (1) target skill + side, (2) the goal, (3) inputs (artifact paths, ORCH-ID, worktree path + branch), (4) hard constraints, (5) expected output (filename + folder), (6) downstream routing.]
```

**B3 — Nothing pending:**

```
NEXT HANDOFF — none; awaiting your direction.
```

### Hard rules (apply across both sections)

- Layman first. Plain-English impact before any technical detail.
- ORCH-#### bracket-label rule on first mention.
- Never refer to Seth in third person; never use "the operator".
- Detail in artifact files under `Mingla_Artifacts/`; chat is summary-grade.
- No emojis, no ASCII boxes, no decoration. Markdown headings + prose + tight bullets only.
- This format SUPERSEDES the prior 4-section conditional rule (`feedback_response_shape_conditional.md`) and the deprecated "Non-Negotiable always-4-sections" rule (`feedback_universal_skill_output_format.md`).

Canonical memory reference: `feedback_response_2_section_universal.md`.
```

### 2.6 Strict-grep CI gate

**Script path:** `.github/scripts/strict-grep/meta-orch-0954-comms-ledger-stanza.mjs`

**Behavior contract:**

```javascript
// Pseudocode behavior — implementor writes real ESM script.
const TARGETS = [
  '.claude/skills/mingla-orchestrator/SKILL.md',
  '.claude/skills/mingla-forensics/SKILL.md',
  '.claude/skills/mingla-implementor/SKILL.md',
  '.claude/skills/mingla-tester/SKILL.md',
  '.claude/skills/mingla-product/SKILL.md',
  '.claude/skills/mingla-designer/SKILL.md',
  '.claude/skills/ui-ux-pro-max/SKILL.md',
  '.claude/skills/mingla-price-tiers/SKILL.md',
  '.claude/skills/mingla-categorizer/SKILL.md',
  'AGENTS.md',
];

const REQUIRED_LEDGER_HEADING = '## Read the Comms Ledger on entry (MANDATORY)';
const REQUIRED_2SECTION_HEADING = '## Standardized 2-Section Output (MANDATORY, every response, every turn)';

const failures = [];
for (const t of TARGETS) {
  const text = readFileSync(t, 'utf8');
  if (!text.includes(REQUIRED_LEDGER_HEADING)) failures.push(`${t}: missing ledger stanza`);
  if (!text.includes(REQUIRED_2SECTION_HEADING)) failures.push(`${t}: missing 2-section template`);
}

if (failures.length) {
  console.error('META-ORCH-0954 stanza enforcement FAILED:');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`META-ORCH-0954 stanza enforcement PASSED for ${TARGETS.length} files.`);
```

**Workflow registration:** add new job to `.github/workflows/strict-grep-mingla-business.yml` named `meta-orch-0954-comms-ledger-stanza`. Pattern: identical to other jobs in that workflow (Node 20, run the .mjs file).

**Registry README update:** add row to `.github/scripts/strict-grep/README.md` active-gates table:
```
| I-COMMS-LEDGER-ENTRY-STANZA + I-RESPONSE-2-SECTION-SHAPE | `meta-orch-0954-comms-ledger-stanza.mjs` | META-ORCH-0954 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-COMMS-LEDGER-ENTRY-STANZA + I-RESPONSE-2-SECTION-SHAPE |
```

### 2.7 Invariant registry updates

Append to `Mingla_Artifacts/INVARIANT_REGISTRY.md`:

```markdown
### I-COMMS-LEDGER-ENTRY-STANZA
Every Claude skill `SKILL.md` and the repo-root `AGENTS.md` contain the literal heading `## Read the Comms Ledger on entry (MANDATORY)`. Enforced by `.github/scripts/strict-grep/meta-orch-0954-comms-ledger-stanza.mjs`. Codified META-ORCH-0954 2026-05-24.

### I-COMMS-LEDGER-WRITE-ON-DISCOVERY
Any skill that discovers something affecting another in-flight ORCH MUST add a `COMMS-NNNN` row to `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` in the same turn the discovery is made. Reviewer-enforced (no script). Codified META-ORCH-0954 2026-05-24.

### I-RESPONSE-2-SECTION-SHAPE
Every chat response from every skill uses Section A (what just happened) + Section B (handoff: B1 numbered Seth-todo / B2 paste paragraph for skill / B3 none). Section heading `## Standardized 2-Section Output (MANDATORY, every response, every turn)` present in every SKILL.md + AGENTS.md. Enforced by `.github/scripts/strict-grep/meta-orch-0954-comms-ledger-stanza.mjs`. Codified META-ORCH-0954 2026-05-24.
```

### 2.8 Memory updates

**Create (with frontmatter type: feedback):**

`feedback_comms_ledger_required.md`:
```markdown
---
name: comms-ledger-required
description: "Every Claude/Codex Mingla skill reads /Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md on entry; writes a COMMS-NNNN entry when discovering cross-ORCH impact. Strict-grep gate enforces stanza presence in every SKILL.md + AGENTS.md."
metadata:
  type: feedback
---

Canonical ledger at `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on `main`. Every skill reads it on entry per the `## Read the Comms Ledger on entry (MANDATORY)` stanza in its SKILL.md. Writers append entries via direct-to-main one-file commits. Bodies inline. Mid-turn acks mentioned in Section A.

**Why:** Parallel ORCHs were stepping on each other with no programmatic warning channel. Operator codified 2026-05-24 via META-ORCH-0954.

**How to apply:** On entry, read ledger; act on BLOCK rows addressed to your skill / current ORCH / ALL; write a row when you discover cross-ORCH impact; mention any ack in Section A of your chat response.

Related: [[response-2-section-universal]].
```

`feedback_response_2_section_universal.md`:
```markdown
---
name: response-2-section-universal
description: "Every chat response from every Claude/Codex Mingla skill uses Section A (what just happened, plain English) + Section B (handoff variant B1 Seth-todo / B2 paste-paragraph for skill / B3 none). Unconditional. Smoke-test is a labeled sub-section inside A when applicable. Supersedes the 4-section conditional rule."
metadata:
  type: feedback
---

Every chat response = Section A + Section B. Always. No conditions, no exceptions. Smoke-test goes inside A as a labeled `#### How to smoke-test on the app` sub-section when the turn shipped user-touchable work; omit otherwise.

**Why:** The 4-section conditional rule (2026-05-15) left too much shape-drift across skills. Operator codified the 2-section unconditional rule via META-ORCH-0954 2026-05-24.

**How to apply:** Open every response with `## A. What just happened` (or equivalent — see SKILL.md template). Pick Section B variant based on who acts next. ORCH-#### bracket-label rule still applies. Layman-first still applies. Detail-in-files still applies.

**Supersedes:** [[response-shape-conditional]], [[universal-skill-output-format]].

Related: [[comms-ledger-required]].
```

**Update existing:**

- `feedback_response_shape_conditional.md`: prepend `**STATUS: SUPERSEDED by [[response-2-section-universal]] (META-ORCH-0954 CLOSE 2026-05-24).**` Keep body for history.
- `feedback_universal_skill_output_format.md`: add second supersession line under the existing deprecation banner: `**Second supersession: META-ORCH-0954 2026-05-24 → [[response-2-section-universal]].**`

**MEMORY.md index updates:**

Add under "## Session Hygiene (Non-Negotiable)":
```markdown
- [Comms ledger required on entry](feedback_comms_ledger_required.md) — Every skill reads `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on entry + writes on cross-ORCH discovery. Strict-grep gate. Codified META-ORCH-0954 2026-05-24.
- [2-section response format universal](feedback_response_2_section_universal.md) — Every chat response = Section A (what just happened) + Section B (handoff). Smoke-test = labeled sub-section in A when applicable. Supersedes 4-section conditional. Codified META-ORCH-0954 2026-05-24.
```

Update existing index line for `response-shape-conditional` to append `(SUPERSEDED 2026-05-24)`.

### 2.9 Decision log entry

Append to `Mingla_Artifacts/DECISION_LOG.md`:

```markdown
## DEC-XXX (next sequential) — Cross-chat comms ledger + universal 2-section response shape (META-ORCH-0954)
**Date:** 2026-05-24
**Decision:** Adopt a single canonical comms ledger at `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` on `main`, read by every skill on entry, written to on cross-ORCH discovery. Adopt an unconditional 2-section chat output (A: what just happened, including a labeled smoke-test sub-section when applicable; B: handoff in one of three variants). Both enforced by a single strict-grep CI gate across all 9 Claude SKILL.md files + repo-root AGENTS.md.
**Why:** Parallel ORCHs had no programmatic warning channel; 4-section conditional shape produced drift across skills.
**Cross-references:** `Mingla_Artifacts/INVESTIGATION_META-ORCH-0954_*.md`, `Mingla_Artifacts/specs/SPEC_META-ORCH-0954_*.md`, I-COMMS-LEDGER-ENTRY-STANZA, I-COMMS-LEDGER-WRITE-ON-DISCOVERY, I-RESPONSE-2-SECTION-SHAPE.
```

---

## 3. Success criteria (tester-verifiable)

| SC | Criterion | Verification method |
|----|-----------|---------------------|
| SC-01 | All 10 target files (9 SKILL.md + AGENTS.md) contain both required headings verbatim. | `node .github/scripts/strict-grep/meta-orch-0954-comms-ledger-stanza.mjs` exits 0. |
| SC-02 | `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` exists on `main` with the §2.2 template. | `git -C ~/Desktop/mingla-main show main:COMMS_LEDGER.md \| head -5` shows the Mingla Comms Ledger header. |
| SC-03 | Each updated SKILL.md still renders cleanly (no orphan `---` separators, no broken markdown). | `markdown-link-check` or eyeball pass; no Read errors when harness loads the skill. |
| SC-04 | The strict-grep workflow job `meta-orch-0954-comms-ledger-stanza` is registered in `.github/workflows/strict-grep-mingla-business.yml` and runs green on the PR. | GitHub Actions UI shows the job passing. |
| SC-05 | The 3 new invariants (I-COMMS-LEDGER-ENTRY-STANZA, I-COMMS-LEDGER-WRITE-ON-DISCOVERY, I-RESPONSE-2-SECTION-SHAPE) are appended to `Mingla_Artifacts/INVARIANT_REGISTRY.md`. | `grep -c 'I-COMMS-LEDGER\|I-RESPONSE-2-SECTION' Mingla_Artifacts/INVARIANT_REGISTRY.md` returns 3. |
| SC-06 | The 2 new memory files exist with correct frontmatter; the 2 superseded memory files carry the SUPERSEDED banner. | Read each file; confirm frontmatter `type: feedback`; confirm banners. |
| SC-07 | `MEMORY.md` index has the 2 new entries and the updated supersession marker on the old entry. | `grep -E 'comms-ledger-required\|response-2-section-universal\|SUPERSEDED' ~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/MEMORY.md` returns ≥3. |
| SC-08 | DECISION_LOG.md carries the new DEC entry referencing META-ORCH-0954. | `grep META-ORCH-0954 Mingla_Artifacts/DECISION_LOG.md` returns ≥1. |
| SC-09 | **Live cross-skill smoke test (operator-driven).** Operator drafts a fake `COMMS-9999 BLOCK to: ALL` row in the ledger; invokes any Claude skill in a fresh chat; confirms the skill acknowledges the row (Section A mentions it) and updates the row's `acked_by` and `status`. | Operator pass/fail. |

---

## 4. Regression tests (Step 0.5 gate)

This is a process/orchestration close with ZERO product-code touch (no `app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/`, `supabase/functions/`, `packages/`). Implementor cites in the implementation report:

`BACKFILL-EXEMPT — reason: META-ORCH-0954 is process/orchestration-only; the strict-grep gate IS the regression test and ships in the same commit.`

The CLOSE banner cites the same exemption. The strict-grep gate itself serves as the "would fail before the change, passes after" proof — operator can verify by temporarily deleting the required heading from one SKILL.md, running the gate, watching it fail, restoring the heading, watching it pass.

---

## 5. Hard constraints

- DO NOT touch any product code (`app-mobile/`, `mingla-business/`, `mingla-admin/`, `supabase/`, `packages/`).
- DO NOT modify `MEMORY.md` to add anything other than the two new index lines + the supersession marker update.
- The ledger file commit goes direct to `main`, NOT on the META-ORCH-0954 branch. Use a separate prep commit (§2.1) on main.
- All other deliverables (SKILL.md edits, AGENTS.md edit, strict-grep script + workflow registration + registry README, invariant updates, memory file changes, decision log entry) ship on the META-ORCH-0954 branch in a single CLOSE commit.
- The exact heading strings in §2.3 and §2.5 are byte-exact — the gate greps for the literal strings. No paraphrasing, no synonyms, no extra whitespace inside the heading lines.
- Do not re-letter / re-number existing DEC entries in DECISION_LOG.md; allocate the next sequential DEC number based on what's currently in the file.
- Memory file edits go to `/Users/sethogieva/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/` (Seth's personal memory dir), not the repo.
- Run the strict-grep gate locally before committing to confirm it passes after backfill.

---

## 6. Out of scope

- Codex-side per-skill enforcement beyond `AGENTS.md` (Codex Mingla skills are not file-backed locally; deferred to a future ORCH if/when Codex skill files materialize).
- Programmatic ledger validation (schema check on rows). Manual sweep is sufficient v1.
- Auto-stale cron. Orchestrator manual sweep at SNAPSHOT/TRIAGE/BOOTSTRAP is sufficient v1.
- Per-entry detail files in a `Mingla_Artifacts/comms/` directory. Operator chose inline bodies; the directory is not created.
- Backfilling COMMS-NNNN entries for past cross-ORCH issues. Ledger starts empty.

---

## 7. Expected implementation report

Implementor writes `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0954_COMMS_LEDGER_AND_2_SECTION_OUTPUT.md` containing:

1. Direct-to-main prep commit hash creating the ledger file.
2. Per-target diff summary (10 files: 9 SKILL.md + AGENTS.md) — which 4-section block was removed, where the 2 new sections were inserted.
3. Strict-grep script + workflow job + registry README diff.
4. Invariant registry diff.
5. Memory file diffs (4 files: 2 new + 2 superseded).
6. DECISION_LOG.md diff.
7. Local strict-grep run output (pass).
8. BACKFILL-EXEMPT statement for Step 0.5 gate.
9. Smoke-test note: implementor manually verifies that opening any SKILL.md and grepping for both required headings returns a match.

---

## 8. Downstream routing

After implementation report returns:
- **TEST dispatch:** Claude `mingla-tester` runs SC-01 through SC-08 mechanically + flags SC-09 as operator-driven gate.
- **CLOSE dispatch:** Orchestrator (Claude or Codex) runs full CLOSE protocol including the deprecation extension Steps 5a-5h because this close supersedes two prior memory files + two skill response-shape rules.
- **PR:** Single PR from `META-ORCH-0954-cross-chat-comms-ledger-and-2-section-output` → `main`. No `[deploy]` tag (no Vercel-built web surface touched).
- **No EAS Update** (no mobile code touched).
- **No edge function deploy** (no Supabase functions touched).

---

**End of SPEC. Ready for IMPLEMENT dispatch.**
