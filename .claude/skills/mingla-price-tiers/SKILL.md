---
name: mingla-price-tiers
description: |
  Mingla's price tier assignment engine. Reads every place in the pool, assigns the correct
  price tiers (chill/comfy/bougie/lavish) using deterministic rules, and writes results to
  the database.

  Respects Google's price_level as authoritative (single tier). For places without Google
  pricing, assigns based on primary_type with honest multi-tier ranges where the type
  genuinely spans price points.

  ALWAYS trigger for: "assign price tiers", "fill price tiers", "price tier sweep",
  "backfill prices", "fix price tiers", "update price tiers", "missing price tiers",
  any request about place_pool price_tier or price_tiers.

  This skill ALWAYS does a full sweep of ALL active places. No partial runs. No skipping.
---

## Read the Comms Ledger on entry (MANDATORY)

Before doing ANY other work this turn, read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. Scan the **Active entries** table. For each row where `to` matches THIS skill name, OR matches the current ORCH-ID, OR is literally `ALL`:

1. `severity: BLOCK` + `status: OPEN` → STOP. Execute the body now. Append your `skill+side` to `acked_by` and change status to `ACKNOWLEDGED` (or `RESOLVED` if the action fully closes it). Mention the ack in your chat response Section A.
2. `severity: WARN` + `status: OPEN` → read, factor into this turn's work, append `skill+side` to `acked_by`.
3. `severity: FYI` → read and continue.

When YOU discover something that affects another in-flight ORCH, write a new `COMMS-NNNN` entry via a direct-to-`main` one-file commit on the anchor checkout (procedure in the ledger file itself). Mention the new entry in your chat response Section A.

Reference: `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-COMMS-LEDGER-ENTRY-STANZA + I-COMMS-LEDGER-WRITE-ON-DISCOVERY.

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



# Mingla Price Tier Engine

You are Mingla's deterministic price tier assignment engine. You read every active place
from the database, assign the correct price tiers, and write the results back.

## Working-Branch Discipline (updated 2026-05-24 — worktree-per-ORCH)

When this skill edits Mingla artifacts, docs, pricing strategy, or product-facing copy, operate inside the orchestrator-spawned per-ORCH worktree at `~/Desktop/mingla-orchs/<ORCH_ID>-[<label>]/` on branch `<ORCH_ID>-<label>`. The anchor checkout at `~/Desktop/mingla-main` is on `main` permanently and is NEVER edited directly. Full strategy: `Mingla_Artifacts/WORKTREE_STRATEGY.md`. Memory rule: `feedback_worktree_per_orch_workflow.md`. Every handoff that asks Seth (the operator) to do something must include the exact worktree path being worked in, explain the action in layman terms before any command, and treat Seth as the doer. If invoked WITHOUT a worktree path, ASK the operator which worktree to attach to — do NOT default to the anchor or the deleted `Seth` branch.

---


## Current Documentation System

- `README.md` is the repo snapshot/front door.
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md` is the artifact classification authority.
- `Mingla_Artifacts/archive/` is historical evidence, not current operating instruction.
- `Mingla_Artifacts/prompts/` is private/ignored unless explicitly versioned.
- Root `outputs/` and root `clade transfer/` are legacy locations, not current destinations.

## Prime Directives

1. **Full sweep, every time.** Read ALL active places. Process ALL of them. No exceptions.
2. **Working evidence placement.** Do not create or update root `outputs/` files. Durable price-tier reports or working notes belong under `Mingla_Artifacts/reports/` or manifest-mapped archive paths.
3. **Google is authoritative.** If a place has `price_level` from Google, trust it. Single tier.
   Do NOT expand, override, or second-guess Google's data.
4. **Honest ranges for unknowns.** For places without Google price data, assign a multi-tier
   range ONLY when the place type genuinely spans tiers. Not as a hedge for uncertainty.
5. **Skip rejected places.** If `ai_approved = false`, do not assign price tiers.

---

## Mingla's Price Tiers

| Tier | Meaning | Google Equivalent |
|---|---|---|
| `chill` | Free or cheap — budget-friendly | PRICE_LEVEL_INEXPENSIVE / FREE |
| `comfy` | Mid-range — typical date spending | PRICE_LEVEL_MODERATE |
| `bougie` | Upscale — special occasion | PRICE_LEVEL_EXPENSIVE |
| `lavish` | Luxury — top-tier splurge | PRICE_LEVEL_VERY_EXPENSIVE |

---

## Workflow

### Phase 0: Read and update the working document

1. Read the current manifest and any manifest-mapped price-tier evidence.
2. Query current state:
   ```sql
   SELECT
     COUNT(*) as total_active,
     COUNT(*) FILTER (WHERE price_level IS NOT NULL) as has_google_price,
     COUNT(*) FILTER (WHERE price_level IS NULL) as no_google_price,
     COUNT(*) FILTER (WHERE price_tiers IS NOT NULL AND array_length(price_tiers, 1) > 0) as has_price_tiers,
     COUNT(*) FILTER (WHERE price_tiers IS NULL OR array_length(price_tiers, 1) IS NULL) as missing_price_tiers,
     COUNT(*) FILTER (WHERE ai_approved = false) as rejected_places
   FROM place_pool WHERE is_active = true;
   ```
3. Update the working document with the current snapshot
4. Proceed to Phase 1

### Phase 1: Check schema

Verify `price_tiers TEXT[]` column exists on `place_pool`. If not, the schema migration
from `references/price-tier-mapping.md` Part 0 must be run first. Flag this to the user
and stop.

### Phase 2: Backfill from Google price_level

For places with `price_level` but missing `price_tiers`:

```sql
UPDATE place_pool SET price_tiers = ARRAY['chill'], price_tier = 'chill'
  WHERE price_level = 'PRICE_LEVEL_INEXPENSIVE'
  AND (price_tiers IS NULL OR array_length(price_tiers, 1) IS NULL) AND is_active = true;
-- (repeat for MODERATE→comfy, EXPENSIVE→bougie, VERY_EXPENSIVE→lavish, FREE→chill)
```

### Phase 3: Deterministic mapping for places without Google price

Read `references/price-tier-mapping.md` for the full primary_type → price_tiers mapping.

Key rules:
- **Definitively one tier** (parks, coffee, fast food) → single tier
- **Genuinely ranges** (restaurants, spas, bars, theaters) → multi-tier
- **Only adjacent tiers** — never skip (no `['chill', 'bougie']`)
- **Do NOT touch places with Google price data** — those are authoritative

Process in batches by primary_type:

```sql
UPDATE place_pool SET price_tiers = ARRAY['chill', 'comfy'], price_tier = 'chill'
WHERE is_active = true AND (price_tiers IS NULL OR array_length(price_tiers, 1) IS NULL)
  AND ai_approved = true
  AND primary_type IN ('restaurant', 'american_restaurant', ...);
```

### Phase 4: Handle edge cases

For `primary_type = null` places:
1. Read `types` array, `editorial_summary`, and `name`
2. Assign best-guess tier
3. If ambiguous, default to `['comfy']` and flag in working document

### Phase 5: Update working document and report

Update `Mingla_Artifacts/reports/WORKING_DOC_PRICE_TIERS.md` with:
- Timestamp of this run
- Total processed
- Tier distribution (counts per tier, including multi-tier combos)
- Places still missing tiers (should be 0 for active approved places)
- Any new primary_types not in the mapping

---

## Constraints

- Project ID: `gqnoajqerqhnvulmnyvv`
- Use `mcp__supabase__execute_sql` for all database operations
- Always write BOTH `price_tiers` (array) and `price_tier` (first element) for backward compatibility
- Do NOT assign tiers to rejected places (`ai_approved = false`)
- Do NOT touch places with Google `price_level` data — they keep their single authoritative tier
- ALWAYS update the working document before AND after the sweep
