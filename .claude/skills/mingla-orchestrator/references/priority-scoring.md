# Priority Scoring Algorithm

How the orchestrator ranks issues for the Priority Board.

---

## Scoring Factors

Each issue is scored 0-100 across 7 weighted factors:

| Factor | Weight | Scoring Guide |
|--------|--------|--------------|
| **User Pain** | 25% | 100: blocks core loop for all users. 75: degrades core loop. 50: affects secondary flow. 25: cosmetic annoyance. 0: invisible to users. |
| **Launch Risk** | 20% | 100: cannot ship with this. 75: ships but with known breakage. 50: ships but embarrassing. 25: post-launch debt. 0: no launch impact. |
| **Flow Criticality** | 15% | 100: auth/onboarding/deck serving/scheduling. 75: save/share/chat/payment. 50: map/calendar/notifications. 25: profile/settings/admin. 0: unused feature. |
| **Blast Radius** | 15% | 100: affects 5+ surfaces. 75: affects 3-4 surfaces. 50: affects 2 surfaces. 25: single surface, multiple states. 0: single component. |
| **Architecture Risk** | 10% | 100: violates multiple invariants. 75: violates one invariant. 50: creates drift toward violation. 25: non-ideal but safe. 0: architecturally sound. |
| **Regression Likelihood** | 10% | 100: has already regressed before. 75: sits in frequently-changed code. 50: depends on fragile assumptions. 25: moderately stable area. 0: well-protected. |
| **Evidence Quality** | 5% | 100: fully investigated, root cause proven. 75: partially investigated. 50: symptoms clear but cause unknown. 25: vague report. 0: hearsay only. |

**Final score** = weighted sum, rounded to nearest integer.

---

## Automatic Severity Escalation

These conditions automatically raise severity regardless of score:

| Condition | Escalation |
|-----------|-----------|
| Affects auth (sign-in, sign-out, token refresh) | → S0 minimum |
| Affects onboarding completion | → S0 minimum |
| Affects deck serving (zero cards / wrong cards) | → S0 minimum |
| Affects scheduling correctness | → S1 minimum |
| Affects payment state (wrong tier, lost subscription) | → S0 minimum |
| Affects message delivery (messages lost/duplicated) | → S1 minimum |
| Affects data integrity (wrong data persisted) | → S1 minimum |
| Violates constitutional non-negotiable | → S1 minimum |

---

## Causal Clustering Bonus

When multiple symptoms share a proven root cause:
- The root cause issue gets +15 bonus points (fixing one fixes many)
- Symptom issues are deprioritized (they'll resolve when root cause is fixed)
- The cluster is noted in the Priority Board rationale

---

## Staleness Penalty

Issues that have been open too long get a penalty to prevent eternal deferral:

| Age | Adjustment |
|-----|-----------|
| < 7 days | No change |
| 7-14 days | +5 points |
| 14-30 days | +10 points |
| > 30 days | +15 points, flagged as "stuck" |

---

## Strategic Categories

After scoring, issues are bucketed:

| Category | Score Range | Action |
|----------|-----------|--------|
| **Fix Now** | 70-100 | Immediately dispatch to investigation/spec/implementation |
| **Fix Next** | 50-69 | Queue for next work wave |
| **Should Fix** | 30-49 | Schedule within 2 weeks |
| **Debt** | 10-29 | Track, fix opportunistically |
| **Defer** | 0-9 | Record and revisit post-launch |

---

## Tie-Breaking

When two issues have the same score:
1. Higher severity wins
2. If tied: issue on more critical flow wins
3. If still tied: issue with better evidence wins (easier to fix)
4. If still tied: older issue wins (longer neglected)
