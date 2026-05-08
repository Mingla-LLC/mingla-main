# Claude Orchestrator Skill Audit

## Source Inspected

- `.claude/skills/orchestrator-mingla/SKILL.md`
- `.claude/skills/orchestrator-mingla/references/priority-scoring.md`
- `.claude/skills/orchestrator-mingla/references/artifact-templates.md`
- `.claude/skills/orchestrator-mingla/references/user-journey-map.md`
- `.claude/skills/orchestrator-mingla/references/agent-prompts.md`
- `.claude/skills/orchestrator-mingla/references/failure-patterns.md`
- `.claude/skills/orchestrator-mingla/references/invariant-registry.md`
- `.claude/skills/orchestrator-mingla/references/bootstrap-sequence.md`
- `.claude/skills/orchestrator-mingla/references/constitutional-compliance.md`

## What The Claude Skill Got Right

- It understood that Mingla needs program memory, not one-off bug notes.
- It made `Mingla_Artifacts/WORLD_MAP.md` canonical for program-level state.
- It forced bugs, decisions, regressions, gaps, and closures into durable docs.
- It treated root cause, invariant violations, and source-of-truth drift as first-class work.
- It used a weighted priority algorithm instead of vibes.
- It preserved an end-to-end lifecycle: intake, investigate, review, spec, implement, test, retest, close, lock-in.
- It required evidence before status or grade changes.
- It provided good handoff prompt schemas for specialist agents.
- It encoded real Mingla failure patterns: lying UI, stale cache, auth gaps, masked errors, parity drift, fabricated data, query-key drift.
- It tied issues to the actual user journey instead of only folder paths.

## What Was Brittle Or Wrong For Codex

- **Role boundary drift:** The original prompt-only model was too rigid in some environments, but Mingla's current process intentionally restores a hard boundary for product work: orchestrator writes prompts, coordinates evidence, and closes; specialist roles investigate/spec, implement, and test.
- **Overbroad trigger language:** "Always trigger" for nearly every broad product phrase risks stealing work from more precise skills. This version uses program-level scope and composes with the forensic skill.
- **Document-first absolutism:** "Update documents FIRST, then continue analysis" can cause premature artifact churn before facts are proven. Codex should register durable facts early, but keep uncertain items labeled until evidence matures.
- **Stale stack facts:** The Claude source mentions 72 edge functions and GPT-4o-mini. Current `README.md` says 57 edge functions and OpenAI GPT-5.4-mini for card quality gate, GPT-4o-mini for AI reasons. This skill defers to `README.md` and live repo evidence.
- **No explicit business app surface:** The source stack lists mobile/admin/backend but the repo includes `mingla-business/`, which is central for organiser, Stripe Connect, orders, guest list, QR, and business cycles.
- **Missing Codex safety rules:** It does not account for dirty worktrees, sandbox approval, `apply_patch`, focused verification, or when to spawn subagents.
- **Artifact close checklist too rigid:** The seven-document close requirement is useful, but not every small operational update needs all documents touched. This version requires every relevant artifact, with the full close protocol for verified tracked items.
- **Weak distinction between canonical and historical docs:** Historical investigations and stale reports are evidence, not live truth. This version treats them as evidence trails and checks supersession.
- **Underdeveloped production deployment guidance:** OTA/migration/native-build guidance was mobile-heavy and should be tied to the actual changed surfaces.
- **No explicit anti-fabrication for program state:** It says proof matters, but this version makes "unknown" and "unverified" acceptable outcomes.

## Improvements In The Codex Skill

- Restores prompt-writing as the default orchestration mechanism for investigation, spec, implementation, testing, rework, and retest.
- Keeps orchestrator-owned execution limited to artifact hygiene, prompt files, lifecycle review, closeout, and explicit skill/process maintenance.
- Adds `mingla-business/` as a first-class surface.
- Defers volatile stack counts and model details to current repo docs.
- Adds live-evidence discipline: code/schema/tests win over stale reports; stale reports become context with dates.
- Adds a stricter production-readiness bar across mobile, business, admin, Supabase, RLS, integrations, tests, telemetry, and deploy path.
- Adds artifact hygiene rules that avoid noisy document churn while preserving the canonical World Map.
- Adds Codex-specific coordination rules: use existing skills, do not spawn agents unless explicitly requested, use focused verification, and protect user changes.

## Bottom Line

The Claude skill is a strong process skeleton with stale repo assumptions and a role boundary that needs to be explicit rather than incidental. The Codex version keeps the skeleton, adds current Mingla surfaces, makes prompt-based specialist dispatch the operating model, and keeps artifact updates proportional, verifiable, and safe.
