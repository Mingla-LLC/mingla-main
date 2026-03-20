---
name: Always File + Short Chat Summary
description: EVERY structured response must write a detailed .md file FIRST, then give a max 15-line chat summary. No tables, no long code blocks, no large headers in chat. Applies to ALL skills.
type: feedback
---

Every response with structured content (investigations, specs, reports, audits, architecture) MUST follow the two-part pattern:

1. **Write detailed .md file first** — all tables, code, reasoning, file:line refs go here. No length limit.
2. **Chat summary second** — max 15 lines, plain text bullets, ends with link to the file.

**Why:** VS Code extension renders long structured content as fixed non-collapsible blocks that pin the user's question as a header and make the entire chat unscrollable. User has been burned by this repeatedly and explicitly demanded it never happen again.

**How to apply:**
- EVERY skill must follow this pattern — Architect, Implementor, Tester, Launch Hardener, PMM, all of them
- Chat must NEVER contain: markdown tables, code blocks >3 lines, headers beyond ##, or more than 15 lines total
- The file is the artifact. The chat is a pointer to it.
- Even "short" reports should go to a file if they contain any tables or structured content
- When in doubt, file it. A user can always open a file. They can't fix a broken chat window.
