# INVESTIGATION — META-ORCH-0954 [Cross-chat comms ledger + standardized 2-section output]

**Phase:** INVESTIGATE
**Owner:** mingla-orchestrator (Claude side)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0954-[cross-chat-comms-ledger-and-2-section-output]/`
**Branch:** `META-ORCH-0954-cross-chat-comms-ledger-and-2-section-output`
**Status:** Awaiting operator REVIEW before SPEC dispatch
**Date:** 2026-05-24

---

## 1. Scope (what we are designing)

Two independent but co-shipping process upgrades, both program-wide, both apply to every in-flight skill on both Claude and Codex sides.

**Requirement 1 — Communications Ledger (`Mingla_Artifacts/COMMS_LEDGER.md`).**
A single shared file that every skill reads on entry and writes to whenever it discovers something that affects another in-flight ORCH. Replaces ad-hoc "tell the operator and hope it routes" cross-chat coordination. Enforced by strict-grep CI gate that fails any SKILL.md missing the "read ledger on entry" stanza.

**Requirement 2 — Standardized 2-section output (every chat response, every skill, always).**
Section A: highly concise layman explanation from the user's perspective. Section B: handoff — operator to-do (numbered) OR skill-to-skill paragraph, chosen intelligently by the emitting skill. Supersedes `feedback_response_shape_conditional.md` and the deprecated `feedback_universal_skill_output_format.md`.

---

## 2. Affected surfaces

`Affected Surfaces: process/orchestration-only — no client surface`

**Files touched (concrete, enumerated):**

Claude-side SKILL.md files (9 total, all under `.claude/skills/`):
1. `mingla-orchestrator/SKILL.md` (875 lines)
2. `mingla-forensics/SKILL.md` (931 lines)
3. `mingla-implementor/SKILL.md` (575 lines)
4. `mingla-tester/SKILL.md` (509 lines)
5. `mingla-product/SKILL.md` (298 lines)
6. `mingla-designer/SKILL.md` (347 lines)
7. `ui-ux-pro-max/SKILL.md` (427 lines)
8. `mingla-price-tiers/SKILL.md` (187 lines)
9. `mingla-categorizer/SKILL.md` (170 lines — RETIRED but still loaded by harness)

Codex-side equivalents:
- `AGENTS.md` at repo root (the Codex entry-point) — 6 sections, currently has no per-agent skill files inside the repo
- **OPEN QUESTION 1:** Codex `orchestrator-mingla` / `implementor-mingla` / `forensic-mingla` / `tester-mingla` agent definitions are not in `/Users/sethogieva/.codex/skills/` and not in this repo. Operator must confirm the canonical file path for Codex-side agent definitions before SPEC can enumerate the strict-grep target set. Candidates: `AGENTS.md` sections, `~/.codex/AGENTS.md`, or a Codex routine config we have not yet seen.

CI / process artifacts:
- `.github/scripts/strict-grep/` — new script `meta-orch-0954-comms-ledger-stanza.mjs`
- `.github/workflows/strict-grep-mingla-business.yml` — register new job
- `Mingla_Artifacts/COMMS_LEDGER.md` — new file (the ledger itself)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — register new invariants (I-COMMS-LEDGER-ENTRY-STANZA, I-COMMS-LEDGER-WRITE-ON-DISCOVERY, I-RESPONSE-2-SECTION-SHAPE)

Memory updates:
- New: `feedback_comms_ledger_required.md`
- New: `feedback_response_2_section_universal.md`
- Update: `feedback_response_shape_conditional.md` → mark SUPERSEDED with pointer
- Update: `feedback_universal_skill_output_format.md` → already deprecated; add second supersession line
- `MEMORY.md` index updates

---

## 3. Prior art reviewed

| Artifact | Key takeaway for this work |
|---|---|
| `feedback_response_shape_conditional.md` (2026-05-15) | Current rule: 4-section conditional. Will be superseded — but PRESERVE the invariants that survive: layman-first, detail-in-files, ORCH-#### bracket-label citation, Seth-is-the-doer. |
| `feedback_universal_skill_output_format.md` (2026-05-14, deprecated) | Earlier "Non-Negotiable always-4-sections" attempt. Failed because it forced ceremony on casual/status/strategy turns. New 2-section rule must avoid that trap — Section A's "highly concise" wording is the safety. |
| Current orchestrator SKILL.md §"Response Protocol" (lines ~430-510) | 4-section template lives here verbatim. Section B's two-case logic (paste-into-skill vs Seth-todo) is already battle-tested — we're inheriting it, just renaming. |
| Strict-grep registry README (`.github/scripts/strict-grep/README.md`) | Registry pattern is one script + one workflow job per invariant. Follow it. I-PROPOSED-L precedent shows process-only invariants can register WITHOUT a script (skill-stanza-only enforcement). We will register WITH a script because the stanza grep is mechanical. |
| `AGENT_HANDOFFS.md` | Already tracks dispatches but is orchestrator-write-only. Not a substitute for a comms ledger — the ledger is peer-to-peer, multi-writer, real-time. |

---

## 4. Recommended design

### 4.1 COMMS_LEDGER.md schema

**File:** `Mingla_Artifacts/COMMS_LEDGER.md` (single file, append-mostly, table of entries).

**Entry record (one markdown row per entry):**

| Field | Type / values | Notes |
|---|---|---|
| `id` | `COMMS-NNNN` (zero-padded 4-digit) | Monotonic, assigned by writer |
| `created` | ISO date | UTC, day granularity sufficient |
| `from` | Skill name + side (`mingla-forensics (claude)`, `implementor-mingla (codex)`, `operator`) | Who wrote this entry |
| `to` | Skill name OR ORCH-ID OR literal `ALL` | Routing target (multiple comma-separated allowed) |
| `re_orch` | ORCH-ID(s) the entry concerns | Comma-separated if multiple |
| `severity` | `BLOCK` / `WARN` / `FYI` | BLOCK = recipient must act before proceeding; WARN = read and acknowledge; FYI = informational |
| `subject` | One-line plain-English summary | <80 chars |
| `body_link` | Relative path to a per-entry detail file under `Mingla_Artifacts/comms/COMMS-NNNN.md` OR `inline` | Detail goes in its own file when >2 lines |
| `status` | `OPEN` / `ACKNOWLEDGED` / `RESOLVED` / `STALE` | See §4.2 lifecycle |
| `acked_by` | Comma-list of skill+side that acknowledged | Append-only |
| `resolved_at` | ISO date or empty | Set by closer |
| `expires` | ISO date or `none` | Auto-stale trigger; default 14d for WARN/FYI, no auto-stale for BLOCK |

**File layout:**

```
# COMMS LEDGER

## Active entries (read on every skill entry)

| id | created | from | to | re_orch | sev | subject | body | status |
|---|---|---|---|---|---|---|---|---|
| COMMS-0001 | 2026-05-24 | mingla-forensics (claude) | mingla-implementor (claude), ORCH-0948 | ORCH-0948, ORCH-0950 | BLOCK | trip_capacity column renamed — update waitlist hook | comms/COMMS-0001.md | OPEN |

## Resolved / stale entries (archive — do not act on, kept for audit)

| id | created | resolved_at | from | to | re_orch | sev | subject |
| ... |
```

Active table goes on top so skills see it first when scanning. Resolved/stale entries move below the divider.

### 4.2 Status lifecycle

```
OPEN ──ack──► ACKNOWLEDGED ──action complete──► RESOLVED
  │                │
  └─expires hit────┴─► STALE  (auto, by orchestrator sweep)
```

- **OPEN:** writer just landed it; nobody has read it yet.
- **ACKNOWLEDGED:** recipient skill read it and recorded that it will act (or already acted) — appended their `skill+side` to `acked_by`. For `to: ALL` entries, only the affected skill needs to ack.
- **RESOLVED:** the underlying issue has been handled (fix shipped, decision made, ORCH closed). Closer sets `resolved_at`.
- **STALE:** entry exceeded its `expires` date with no action. Orchestrator sweep moves it below the divider and notes "STALE — no action taken; recheck if symptom recurs."

**Stale cleanup cadence:** orchestrator runs a sweep at the top of every SNAPSHOT / TRIAGE mode invocation, and as a step in BOOTSTRAP. Sweep promotes `OPEN` → `STALE` if `expires < today`, moves `RESOLVED` and `STALE` rows below the divider.

### 4.3 Read rule (every skill on entry)

Every skill `SKILL.md` carries this verbatim stanza near the top (line position: immediately after the skill's preamble, before any mode definitions):

```markdown
## Read the Comms Ledger on entry (MANDATORY)

Before doing ANY other work this turn, read `Mingla_Artifacts/COMMS_LEDGER.md` Active-entries table. For each row where `to` matches this skill name, OR matches the current ORCH-ID, OR is literally `ALL`:

1. If `severity: BLOCK` and `status: OPEN` — stop and act on it now. Honor the instruction in `body_link` before any other turn work. Append your skill+side to `acked_by` and set status to `ACKNOWLEDGED` (or `RESOLVED` if the act fully closes it).
2. If `severity: WARN` and `status: OPEN` — read the body, factor it into your work this turn, append your skill+side to `acked_by`.
3. If `severity: FYI` — read and continue.

If the ledger does not exist yet, create it from the template at `Mingla_Artifacts/COMMS_LEDGER.md.template`. Never skip this read step — the CI gate `meta-orch-0954-comms-ledger-stanza.mjs` will fail any SKILL.md that does not contain this exact heading.
```

Stanza heading text (exact, case-sensitive, single-line): `## Read the Comms Ledger on entry (MANDATORY)`. The CI gate greps for this literal string in every SKILL.md.

### 4.4 Write rule (when to write)

Any skill MUST write a new COMMS-NNNN entry when it discovers something that affects an in-flight ORCH other than its own. Examples:

- Forensics discovers during ORCH-0950 investigation that a shared helper used by ORCH-0948 has a stale assumption → entry `to: mingla-forensics (claude), ORCH-0948` severity BLOCK.
- Implementor finds a Supabase migration in `supabase/migrations/` from a parallel ORCH conflicts with theirs → entry `to: orchestrator (both sides), ALL` severity BLOCK.
- Tester observes a regression that crosses two ORCHs → entries to both affected ORCHs.
- Orchestrator decides at CLOSE time to defer a follow-up → entry `to: ALL` severity FYI with expires=14d.

**Write procedure:**

1. Allocate next `COMMS-NNNN` ID (scan ledger for max + 1).
2. Append row to Active table.
3. If body >2 lines, create `Mingla_Artifacts/comms/COMMS-NNNN.md` with full detail; otherwise put body in `body_link: inline` and put inline text in a column-friendly way (use `<br>` if needed; prefer a file).
4. Commit on the current ORCH's worktree branch — the entry ships in the same PR.

**Conflict / merge:** When two ORCHs both add a row simultaneously, the second-to-merge ORCH's PR will conflict on the table. Resolution: take both rows; renumber as needed; the orchestrator running the second close owns the renumber.

### 4.5 Acknowledgement protocol

Acknowledging is a one-line edit to an existing row — append to `acked_by`, change `status`. No new ID. Acks ship in the acknowledging ORCH's own commit.

### 4.6 Strict-grep CI gate

**Script:** `.github/scripts/strict-grep/meta-orch-0954-comms-ledger-stanza.mjs`

**Logic:**
- Glob every `.claude/skills/*/SKILL.md` (Claude side).
- For each file, verify it contains the literal heading `## Read the Comms Ledger on entry (MANDATORY)`.
- If any file is missing the heading → exit 1 with the file name(s).
- Codex-side targets to be added once OPEN QUESTION 1 is answered (the script accepts a configurable glob list).

**Job:** Register in `.github/workflows/strict-grep-mingla-business.yml` as `meta-orch-0954-comms-ledger-stanza`. Same pattern as I-37 etc.

**Registry README update:** add row to the active-gates table.

---

### 4.7 Standardized 2-section output template

Verbatim template every skill embeds (and operates by) on every chat response:

```markdown
## A. What just happened

[1–4 sentences, plain English from the user's perspective. Lead with the
outcome and what the user needs to know to make an informed decision.
No jargon, no file paths in this section unless the path IS the deliverable.
For shipped work: name what changed for end users. For mid-flight work:
name what just got decided / found / written and what it means for the
next step. For status / strategy / Q&A turns: just answer.]

## B. Handoff

[ONE of the two variants below — the skill picks based on who acts next.]

— VARIANT B1 (handoff to operator / Seth — numbered to-do):

NEXT STEPS — for you, Seth:
1. [Plain-English action with exact command, URL, or button name inline.]
2. [Next action.]
3. [Verification step that proves the action worked.]

— VARIANT B2 (handoff to another skill — paste paragraph):

NEXT HANDOFF — paste into [target skill name]:

[Single prose paragraph, 3–5 sentences, naming: (1) target skill + side,
(2) the goal, (3) inputs (artifact paths, ORCH-ID, worktree path + branch),
(4) hard constraints, (5) expected output (filename + folder), (6) downstream
routing. Self-contained — paste cold and the next agent knows exactly what to do.]

— VARIANT B3 (no next step):

NEXT HANDOFF — none; awaiting your direction.
```

**Skill detects which variant to emit by asking:** "Whose hands does the work go to next?"
- Seth's hands (deploy, merge, eyeball, run command, decide) → B1.
- Another skill's hands (investigate, spec, implement, test) → B2.
- Nothing pending → B3.

**Invariants preserved from prior shape rules (still apply inside Section A / B):**
- Layman-first wording.
- ORCH-#### references carry a `[bracketed label]` on first mention.
- Never address Seth in third person ("the operator").
- Detail in artifact files; chat is summary-grade.
- No emojis, no ASCII boxes.
- Smoke-test steps go INSIDE Section A when the turn shipped UI/runtime work users can touch — phrased as part of "what just happened, and here is how you can see it." When nothing shipped, no smoke-test.

**Why 2 sections beats 4:** The 4-section shape (Where we were / What we just did / Outcome + smoke-test / Handoff) front-loaded backstory the operator already knew. Collapsing Where-we-were + What-we-just-did + Outcome + smoke-test into a single Section-A "what just happened" paragraph forces the skill to lead with the punchline. Handoff becomes Section B unchanged.

**Unconditional, intelligent:** Every response, every skill, always uses sections A and B. The shape is unconditional. The CONTENT of section B is intelligent — B1 vs B2 vs B3 chosen per turn.

### 4.8 Memory + invariant updates

New memory:
- `feedback_comms_ledger_required.md` (type: feedback) — "Every skill reads `Mingla_Artifacts/COMMS_LEDGER.md` on entry; writes when discovering cross-ORCH impact. Strict-grep gate enforces stanza presence."
- `feedback_response_2_section_universal.md` (type: feedback) — "Every chat response from every skill uses Section A (what just happened, layman) + Section B (handoff: B1 numbered for Seth / B2 paragraph for skill / B3 none). Supersedes 4-section conditional."

Supersede:
- `feedback_response_shape_conditional.md` → add `status: SUPERSEDED by [[response-2-section-universal]] (META-ORCH-0954 CLOSE 2026-05-24)`.
- `feedback_universal_skill_output_format.md` → already deprecated, add second supersession line.

`MEMORY.md` index updates accordingly.

New invariants (register in `Mingla_Artifacts/INVARIANT_REGISTRY.md`):
- `I-COMMS-LEDGER-ENTRY-STANZA`: every SKILL.md contains the literal heading `## Read the Comms Ledger on entry (MANDATORY)`. Enforced by strict-grep gate.
- `I-COMMS-LEDGER-WRITE-ON-DISCOVERY`: any skill discovering cross-ORCH impact MUST add a `COMMS-NNNN` entry in the same commit as the discovery's report/artifact. Enforced by reviewer (no script).
- `I-RESPONSE-2-SECTION-SHAPE`: every chat response uses Sections A + B. Enforced socially (no script — chat output is not in CI).

---

## 5. Open questions (operator must answer before SPEC)

1. **Codex-side enforcement target.** Where do Codex `orchestrator-mingla` / `implementor-mingla` / `forensic-mingla` / `tester-mingla` skill definitions live as files (so the strict-grep gate can grep them)? Candidates: `AGENTS.md` sections, `~/.codex/AGENTS.md`, a Codex routine config we have not seen. If Codex agent text is not file-backed, the gate is Claude-side only and Codex compliance is operator-enforced via routine prompts.
2. **Smoke-test placement.** Is folding smoke-test steps INTO Section A (when applicable) the right call, or should we keep an explicit "C. How to smoke-test" subsection inside A? Operator preference matters — I recommend inside A for brevity, but C-subsection is more discoverable.
3. **Body-link convention.** When a `body_link` is `inline`, do we allow multi-line cells via `<br>`, or hard-require a `comms/COMMS-NNNN.md` file even for one-paragraph bodies? Recommend the latter for consistency; small cost.
4. **Ack visibility.** When a recipient skill acks a BLOCK entry mid-turn, do they emit a Section-B chat notice to Seth, or silently update the ledger? Recommend Section-A one-sentence mention so Seth sees that cross-ORCH coordination happened.
5. **Backfill scope.** Do we backfill the 9 Claude SKILL.md files in this single META-ORCH-0954 close, or split into 0954-A (ledger + 2 critical skills) and 0954-B (remaining 7 SKILLs)? Recommend single-close because the diff is mechanical and any partial state is worse than full rollout.

---

## 6. Recommended SPEC scope (preview only — for operator's SPEC dispatch decision)

If operator approves this investigation, SPEC dispatch (Claude `mingla-forensics`) writes:

- The verbatim 2-section template wording (Section A guidance, Section B1/B2/B3 templates).
- The verbatim "read the ledger on entry" stanza for each SKILL.md (with the exact heading the gate greps).
- `Mingla_Artifacts/COMMS_LEDGER.md` initial file + `COMMS_LEDGER.md.template`.
- The strict-grep script behavior contract (`meta-orch-0954-comms-ledger-stanza.mjs`).
- Per-SKILL.md insertion point map (one line per file naming exactly where the new stanza goes + which existing "Response Protocol" section becomes superseded text).
- Per-memory-file diff plan.
- Invariant registry text.
- Tester gates: SC-01 strict-grep passes after backfill; SC-02 each updated SKILL.md still self-renders cleanly; SC-03 ledger template parses as valid markdown table; SC-04 a synthetic OPEN BLOCK entry written from one skill is correctly read & acked by another in a follow-up turn (manual gate, operator-driven).

Implementor dispatch (Codex `implementor-mingla` default) then makes the edits in this worktree.

---

## 7. Locked decisions (operator-confirmed 2026-05-24)

1. **Ledger location (Q1):** `~/Desktop/mingla-main/COMMS_LEDGER.md` on the `main` branch. Every worktree reads it via absolute path; writers add entries via tiny direct-to-`main` one-file commits (explicit exception to per-ORCH-branch rule because the ledger IS the cross-ORCH coordination layer). Git-tracked → audit trail.
2. **Codex-side targets (Q1, follow-up):** Verified `~/.codex/skills/` contains only `.system/` skills (skill-creator, plugin-creator, etc.) — Codex Mingla skill definitions (`orchestrator-mingla`, `implementor-mingla`, `forensic-mingla`, `tester-mingla`) are NOT file-backed locally. Repo-root `AGENTS.md` is the only Codex-side file with Mingla-specific agent instruction. **Decision:** strict-grep gate enforces on `.claude/skills/*/SKILL.md` (9 files) + repo-root `AGENTS.md`. Codex per-skill compliance is operator-enforced through dispatch prompt content until Codex skill files materialize on disk.
3. **Smoke-test placement (Q2):** Labeled sub-section inside Section A. Heading: `### How to smoke-test on the app` — present when the turn shipped user-touchable work; omitted otherwise.
4. **Body-link convention (Q3):** Inline. Every comms entry's body lives in the ledger table row itself; no separate `comms/COMMS-NNNN.md` files. Multi-line bodies use `<br>` in the cell.
5. **Mid-turn ack visibility (Q4):** When a skill acks a ledger entry mid-turn, it mentions it in Section A — one short sentence ("Also handled COMMS-NNNN: <subject>") — so Seth sees that cross-ORCH coordination happened.
6. **Backfill scope (Q5):** All-at-once. Single CLOSE updates all 9 Claude SKILL.md files + repo-root `AGENTS.md` + ledger + strict-grep gate + memory updates.

---

**End of INVESTIGATE report. Proceeding to SPEC dispatch.**
