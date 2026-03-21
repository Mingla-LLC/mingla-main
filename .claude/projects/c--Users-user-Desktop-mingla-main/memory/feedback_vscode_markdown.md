---
name: VS Code Markdown Rendering
description: All markdown output must render correctly in VS Code's markdown preview — avoid rendering issues
type: feedback
---

Format all markdown files (outputs/, specs, prompts) so they render correctly in VS Code's built-in markdown preview.

**Why:** User reads all output files in VS Code. If markdown doesn't render, the user can't see the content.

**How to apply:** Ensure tables have proper alignment rows, avoid complex nesting that VS Code chokes on, test that headers/lists/tables/code blocks all render cleanly. Keep formatting simple and standard CommonMark.
