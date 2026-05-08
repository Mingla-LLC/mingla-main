# Priority Scoring

Score 0-100 using weighted factors:

| Factor | Weight | 100 | 75 | 50 | 25 | 0 |
|---|---:|---|---|---|---|---|
| User Pain | 25% | Blocks core loop for all users | Degrades core loop | Affects secondary flow | Cosmetic annoyance | Invisible |
| Launch Risk | 20% | Cannot ship | Ships with known breakage | Embarrassing | Post-launch debt | None |
| Flow Criticality | 15% | Auth, onboarding, payment, card serving, ticket/order money path | Save, schedule, invite, chat, QR/entry | Map, calendar, notifications, admin ops | Profile/settings/docs | Unused |
| Blast Radius | 15% | 5+ surfaces | 3-4 surfaces | 2 surfaces | Single surface, many states | Single component |
| Architecture Risk | 10% | Multiple invariant violations | One invariant violation | Drift toward violation | Non-ideal but safe | Sound |
| Regression Likelihood | 10% | Regressed before | Frequently changed area | Fragile assumptions | Moderately stable | Protected |
| Evidence Quality | 5% | Root cause proven | Partially investigated | Symptom clear, cause unknown | Vague | Hearsay |

Final score = weighted sum rounded to nearest integer.

## Automatic Severity Escalation

Escalate regardless of score:

- Auth sign-in, sign-out, session, token refresh: `S0` minimum.
- Onboarding completion blocked: `S0` minimum.
- Card/deck serving zero cards or wrong cards in core loop: `S0` minimum.
- Payments, subscription tier, Stripe Connect, wrong money state: `S0` minimum.
- Ticket purchase, order fulfillment, QR entry correctness: `S0` minimum.
- Scheduling correctness: `S1` minimum.
- Message delivery lost/duplicated: `S1` minimum.
- Data integrity wrong persisted state: `S1` minimum.
- RLS/security exposure: `S0` or `S1` depending exposure.
- Constitutional non-negotiable violation: `S1` minimum.

## Causal Clustering

If several symptoms share one proven root cause:

- Add +15 to the root cause item.
- Deprioritize duplicate symptom items and link them to the root cause.
- Track the cluster in `ROOT_CAUSE_REGISTER.md`.

## Staleness Adjustment

- Less than 7 days open: no change.
- 7-14 days: +5.
- 14-30 days: +10.
- More than 30 days: +15 and mark stuck.

## Strategic Buckets

- `70-100`: Fix Now.
- `50-69`: Fix Next.
- `30-49`: Should Fix.
- `10-29`: Debt.
- `0-9`: Defer.

## Tie Breaks

1. Higher severity.
2. More critical journey.
3. Better evidence.
4. Older issue.
5. Smaller safe fix if all else is equal.
