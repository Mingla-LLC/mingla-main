> Parity note: ported from `.claude/skills/mingla-implementor/references/constitutional-quick-check.md` during META-ORCH-0755-B so Codex implementor can load the same post-implementation constitution scan as Claude.

# Constitutional Quick-Check — Post-Implementation Scan

Scan your changes against each principle. Takes 60 seconds. Catches architectural violations
before the orchestrator review does.

---

## The Scan

For each principle, ask the ONE question. If the answer is wrong, fix it before reporting.

| # | Principle | Question | Pass? |
|---|-----------|----------|-------|
| 1 | No Dead Taps | Did I add any button/link/tap target? → Does every one respond? | |
| 2 | One Owner Per Truth | Did I add or move any data? → Is there exactly ONE authoritative source? | |
| 3 | No Silent Failures | Did I add any try/catch? → Does every catch surface the error? | |
| 4 | One Key Per Entity | Did I add/change React Query? → Is the key from a factory with all params? | |
| 5 | Server State Server-Side | Did I touch Zustand? → Am I storing only client-side state? | |
| 6 | Logout Clears All | Did I add persistent state? → Does sign-out clear it? | |
| 7 | Label Temporary | Did I leave anything imperfect? → Is it marked `[TRANSITIONAL]` with exit condition? | |
| 8 | Subtract Before Add | Did I fix a bug? → Did I remove broken code first, or layer on top? | |
| 9 | No Fabricated Data | Did I add any displayed number? → Is it from real data (not a fallback default)? | |
| 10 | Currency Aware | Did I add any price/cost display? → Does it use user's currency/locale? | |
| 11 | One Auth Instance | Did I touch auth? → Am I going through the centralized auth system? | |
| 12 | Validate Right Time | Did I add validation? → Is it at the moment the user expects feedback? | |
| 13 | Exclusion Consistency | Did I change card filtering? → Same rules in generation AND serving? | |
| 14 | Persisted-State Startup | Did I change persisted shapes? → Does cold start handle old shapes? | |

---

## Failure Response

- Any "No" → fix the code before reporting
- Any "Unsure" → investigate and decide, document in report
- All "Yes" or "N/A" → include "Constitutional compliance: passed" in report

---

## Common Traps

| Trap | Looks Like | Actually Violates |
|------|-----------|-------------------|
| Adding `?? []` to hide missing data | "Defensive coding" | #9 (fabrication) + #3 (silent failure) |
| New Zustand field for API data | "Easier than React Query" | #2 (ownership) + #5 (boundary) |
| Catch that returns fallback | "Graceful degradation" | #3 (silent failure) |
| New sync wrapper around stale data | "Fixing the race" | #8 (subtract first) + #2 (ownership) |
| Hardcoded `$` in price display | "Quick formatting" | #10 (currency) |
| Button with TODO handler | "Placeholder for later" | #1 (dead tap) |
