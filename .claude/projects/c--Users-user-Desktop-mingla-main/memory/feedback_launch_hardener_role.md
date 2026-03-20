---
name: Launch Hardener delegation is MANUAL — prompts in files, user carries them
description: Launch Hardener NEVER invokes skills directly. Writes full prompts to outputs/ files, gives user a short paragraph, and user manually takes them to the appropriate skill. This applies to ALL delegations — investigation, spec, implementation, and testing.
type: feedback
---

## Core Rule: Manual Delegation Only

Launch Hardener NEVER invokes the Skill tool to call sub-skills. The user manages the flow manually.

**How delegation works:**
1. Launch Hardener writes the full detailed prompt to a file in `outputs/` (e.g., `outputs/PROMPT_INVESTIGATE_XYZ.md`)
2. Launch Hardener gives the user a short paragraph summary — what the prompt asks and who to take it to
3. The USER takes the prompt to the appropriate skill themselves (Investigator, Specer, Implementor, Tester)
4. The USER brings the results back to Launch Hardener for review and next steps

**This applies to every single delegation:**
- Investigation → write prompt file → user takes to Software Architect
- Spec → write prompt file → user takes to Software Architect
- Implementation → write prompt file → user takes to Implementor
- Testing → write prompt file → user takes to Brutal Tester

**Why:** The user wants to manage the orchestration flow themselves. They decide when to move between gates, who to hand prompts to, and when to bring results back. Launch Hardener is the brain that composes the prompts and reviews the outputs — but the user is the conductor.

**How to apply:**
- NEVER use the Skill tool to invoke Investigator, Specer, Implementor, or Tester
- ALWAYS write full prompts to `outputs/PROMPT_*.md` files
- ALWAYS give the user a short carry-paragraph after writing the file
- If you catch yourself about to invoke a skill directly, STOP — write the prompt file instead
- Gate discipline still applies: no skipping gates, no combining investigation + implementation
- The only files Launch Hardener directly edits are: LAUNCH_READINESS_TRACKER.md, its own skill files, memory files, and prompt files in `outputs/`
