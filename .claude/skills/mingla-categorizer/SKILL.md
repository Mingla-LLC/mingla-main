---
name: mingla-categorizer (RETIRED 2026-05-03)
description: |
  ⚠️ RETIRED — DO NOT INVOKE ⚠️

  This skill wrote to `place_pool.ai_primary_identity, ai_categories, ai_approved, ai_confidence,
  ai_reason` columns. ALL of those columns were dropped from `place_pool` on 2026-05-03 by
  ORCH-0700 Phase 3B (Migration 6). Running this skill against the live database would fail
  with "column does not exist" errors on every UPDATE.

  REPLACEMENT: Mingla category for any place is now derived at READ time:
  - Display contexts: matview `admin_place_pool_mv.primary_category` (filled by SQL helper
    `pg_map_primary_type_to_mingla_category(primary_type, types)`)
  - Scoring contexts: `place_scores.signal_id` rows (one per place per signal, written by
    the signal scorer per `signal_definition_versions.config`)
  - There is NO stored interpretation column to fill anymore (Constitution #2 — Google's
    raw type data is the single owner)

  If a future need arises for AI-assisted classification (e.g., a special filter), it must
  be a NEW system that does NOT write to place_pool's dropped columns. File a new ORCH and
  redesign from scratch.

  Cross-references:
  - `feedback_ai_categories_decommissioned.md` (status: ACTIVE) — the canonical decommission memory
  - `Mingla_Artifacts/DECISION_LOG.md` DEC-090, DEC-091
  - `Mingla_Artifacts/INVARIANT_REGISTRY.md` I-CATEGORY-DERIVED-ON-DROP, I-CATEGORY-SLUG-CANONICAL
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



# Mingla Place Categorizer

You are Mingla's deterministic place categorization engine. You read every active place from
the database, classify it into the correct Mingla categories, and write the results back.

## Working-Branch Discipline (updated 2026-05-24 — worktree-per-ORCH)

This skill is retired and must not be invoked for live categorization. If opened only for audit or decommission review, operate inside the orchestrator-spawned per-ORCH worktree at `~/Desktop/mingla-orchs/<ORCH_ID>-[<label>]/` on branch `<ORCH_ID>-<label>`. The anchor checkout at `~/Desktop/mingla-main` is on `main` permanently and is NEVER edited directly. Full strategy: `Mingla_Artifacts/WORKTREE_STRATEGY.md`. Memory rule: `feedback_worktree_per_orch_workflow.md`. Every handoff that asks Seth (the operator) to do something must include the exact worktree path being worked in, explain the action in layman terms before any command, and treat Seth as the doer. If invoked WITHOUT a worktree path in the dispatch, ASK the operator which worktree to attach to before doing any work — do NOT default to the anchor checkout or the deleted `Seth` branch.

You do NOT call any AI API. You ARE the classifier.

---

## Current Documentation System

- `README.md` is the repo snapshot/front door.
- `Mingla_Artifacts/ARTIFACT_MANIFEST.md` is the artifact classification authority.
- `Mingla_Artifacts/archive/` is historical evidence, not current operating instruction.
- `Mingla_Artifacts/prompts/` is private/ignored unless explicitly versioned.
- Root `outputs/` and root `clade transfer/` are legacy locations, not current destinations.

## Prime Directives

1. **Full sweep, every time.** Read ALL active places. Classify ALL of them. No exceptions.
2. **Retired working document.** This skill is retired. Do not create or update root `outputs/` files. Historical working material belongs under `Mingla_Artifacts/archive/` if it must be preserved.
3. **Category definitions are at `references/category-mapping.md` (v3).** Read this BEFORE classifying. Key rules:
   - **wellness = NO salons, NO beauty parlours.** Only resorts, spas, saunas, massage, getaways.
   - **casual_eats = NO fast food chains** (McDonald's, Burger King, etc.), NO food trucks.
   - **nature_views = EXPANDED** — includes tourist attractions, viewpoints, observation decks, waterfronts.
   - **picnic_park = Real parks with green space ONLY.** No zoos, no allotment gardens.
   - **6 categories require an actual website** (not just Google listing): fine_dining, watch, live_performance, creative_arts, play, wellness.
4. **When in doubt, exclude.** A false positive (wrong category) is worse than a false negative.
5. **Reject what doesn't belong.** Gas stations, churches, gyms, kids' venues, salons, fast food chains, retail stores — auto-reject.
6. **Web search verification is MANDATORY.** Every place must be individually web-searched. No pattern matching, no sampling, no shortcuts.

---

## Workflow

### Phase 0: Read and update the working document

1. Read manifest-mapped historical working evidence if the orchestrator explicitly asks for archival review.
2. Query current state:
   ```sql
   SELECT
     COUNT(*) as total_active,
     COUNT(*) FILTER (WHERE ai_approved IS NOT NULL) as already_classified,
     COUNT(*) FILTER (WHERE ai_approved IS NULL) as unclassified,
     COUNT(*) FILTER (WHERE ai_approved = true) as approved,
     COUNT(*) FILTER (WHERE ai_approved = false) as rejected
   FROM place_pool WHERE is_active = true;
   ```
3. Update the working document with the current snapshot
4. Proceed to Phase 1

### Phase 1: Read all places

```sql
SELECT id, name, primary_type, types, rating, review_count, price_level,
       address, editorial_summary, seeding_category
FROM place_pool
WHERE is_active = true
ORDER BY primary_type, name;
```

Process in batches of ~100 using `mcp__supabase__execute_sql`.

### Phase 2: Classify using the mapping

Read `references/category-mapping.md` for the full primary_type → category mapping table,
the 13 category definitions, automatic rejection rules, and multi-category rules.

For each place, assign:
- `ai_primary_identity` — what the place IS (1-3 words)
- `ai_categories` — array of Mingla category slugs. Can be empty (rejection).
- `ai_approved` — `true` if categories assigned, `false` if rejected
- `ai_confidence` — `1.0` for deterministic matches, `0.7` for judgment calls
- `ai_reason` — one sentence why

### Phase 3: Write results

Process in batches using SQL:

```sql
-- Approved example
UPDATE place_pool SET
  ai_approved = true,
  ai_primary_identity = 'Italian restaurant',
  ai_categories = ARRAY['casual_eats'],
  ai_confidence = 1.0,
  ai_reason = 'Italian restaurant, casual dining',
  ai_validated_at = now()
WHERE id = 'uuid-here';

-- Rejected example
UPDATE place_pool SET
  ai_approved = false,
  ai_primary_identity = 'gas station',
  ai_categories = ARRAY[]::text[],
  ai_confidence = 1.0,
  ai_reason = 'Gas station — utilitarian, not a date venue',
  ai_validated_at = now()
WHERE id = 'uuid-here';
```

For efficiency, batch by primary_type:

```sql
UPDATE place_pool SET
  ai_approved = true, ai_primary_identity = 'restaurant',
  ai_categories = ARRAY['casual_eats'], ai_confidence = 1.0,
  ai_reason = 'Restaurant, casual dining', ai_validated_at = now()
WHERE is_active = true AND primary_type IN ('restaurant', 'american_restaurant', ...);
```

### Phase 4: Handle ambiguous places

For places with `primary_type = null` or genuinely unclear types:
1. Read `types` array, `editorial_summary`, and `name`
2. If still unclear: `ai_confidence = 0.5`, `ai_reason = 'Ambiguous — needs manual review'`
3. List these in the working document for the user to decide

### Phase 5: Update working document and report

Update `Mingla_Artifacts/reports/WORKING_DOC_CATEGORIZATION.md` with:
- Timestamp of this run
- Total processed, approved, rejected
- Category distribution (counts per category)
- Recategorized places (where ai_categories differs from seeding_category)
- Ambiguous places flagged for manual review
- Any new primary_types encountered that aren't in the mapping

---

## Constraints

- Project ID: `gqnoajqerqhnvulmnyvv`
- Use `mcp__supabase__execute_sql` for all database operations
- Do NOT call any AI API
- Do NOT skip places — every active place must have a classification
- Do NOT add categories loosely — when in doubt, exclude
- ALWAYS update the working document before AND after the sweep
