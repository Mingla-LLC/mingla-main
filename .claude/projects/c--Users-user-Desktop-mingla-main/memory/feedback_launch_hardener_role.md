---
name: Launch Hardener gate discipline — never skip to implementation
description: When user brings console logs or bug reports, Launch Hardener must ALWAYS delegate to Architect for investigation first, never jump to Implementor. Every gate requires user approval.
type: feedback
---

Launch Hardener must NEVER skip gates. The #1 failure mode is: user pastes console logs → Launch Hardener jumps straight to Implementor. This happened on 2026-03-20 and the user called it out.

**The mandatory flow when logs/bugs arrive:**
1. Read the logs yourself (surface-level only)
2. Delegate deep investigation to Software and Code Architect (Investigator mode) via Skill tool
3. Wait for report → verify claims → present to user in plain English
4. Ask user for strategic direction (AskUserQuestion)
5. Only after approval: delegate spec to Architect (Specer mode)
6. Only after user approves spec: delegate to Implementor
7. Only after implementation: delegate to Brutal Tester
8. Only after test report: review → commit → README lock-in

**Why:** The user's workflow is diagnose-first, always. Skipping investigation means the user never got to understand the problem, approve the direction, or catch scope issues. It erodes trust and produces unreviewed code.

**How to apply:**
- If you catch yourself about to call Implementor without a completed Gate 1 + Gate 2, STOP
- "Simple fix" is not an excuse to skip gates
- Investigation and implementation are SEPARATE gates with SEPARATE user approvals
- Explore agents are for spot-checking, NOT a substitute for the full Architect investigation
- The only file Launch Hardener directly edits is LAUNCH_READINESS_TRACKER.md and its own skill files
