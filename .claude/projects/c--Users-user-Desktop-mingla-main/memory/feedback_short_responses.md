---
name: Short Chunked Responses
description: VS Code extension silently fails to render large responses — all skills must keep output under ~150 lines and break long content into files or multiple messages
type: feedback
---

All responses must be short enough for the VS Code extension to render. The extension silently drops responses that are too large — the user sees nothing.

**Why:** User repeatedly lost responses because VS Code couldn't render them. This wastes time and blocks the conversation.

**How to apply:**
- Max ~150 lines per chat response
- Long artifacts (reports, migrations, specs) → write to files, summarize in chat
- Diagnose-first responses: bullet points, no long tables, no walls of text
- Code blocks in chat: max ~30 lines. Longer code goes to files.
- When in doubt, shorter is better. A terse response beats an invisible one.
- This applies to ALL skills, not just the Implementor.
