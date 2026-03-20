---
name: Detail in Files, Summary in Chat
description: VS Code silently drops long responses — chat must be MAX 20 lines, all detail in output files
type: feedback
---

VS Code extension silently drops responses that are too long. The user sees NOTHING.

**Why:** Happened AGAIN on 2026-03-20 — Implementor sub-skill returned a long response and user saw blank. This is a recurring hard failure.

**How to apply:**
- Max ~20 lines of visible text per chat response (NOT 150 — that's still too much)
- ALL detailed content → write to `outputs/` files, chat gets summary + file link
- After implementation: 3 bullets what changed + commit message + link to report file
- Code blocks in chat: max ~10 lines. Longer code goes to files.
- Sub-agent results: summarize in 3-5 lines, never relay full output
- When in doubt, shorter is better. A terse response beats an invisible one.
- This applies to ALL skills and ALL responses, not just Implementor.
