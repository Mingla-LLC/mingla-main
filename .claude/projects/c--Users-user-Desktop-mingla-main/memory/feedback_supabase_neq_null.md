---
name: Supabase .neq() excludes NULLs
description: Supabase .neq("col", "value") filters out NULL rows — use .or('col.neq.value,col.is.null') instead
type: feedback
---

Never use `.neq("column", "value")` in Supabase JS client when the column can be NULL. SQL `NULL != 'value'` evaluates to NULL (falsy), so NULL rows are silently excluded.

**Why:** We shipped `.neq("account_type", "admin")` which filtered out ALL users because every profile had `account_type = NULL`. The Users page showed zero results. Passed code review and 27/27 test checks because the tests were structural, not runtime-data-aware.

**How to apply:** Whenever filtering with `.neq()` on a nullable column, always use the NULL-safe alternative:
```
.or('column.neq.value,column.is.null')
```
This translates to `column != 'value' OR column IS NULL` — correct SQL semantics.

Also: specs must verify NULL behavior claims against actual SQL semantics, not assumptions about PostgREST. And test prompts should include a data-level check ("what does the actual data look like?") not just code-structure checks.
