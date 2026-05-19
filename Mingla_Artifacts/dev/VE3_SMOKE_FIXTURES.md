# Ve3 — Staging smoke fixtures

Use after Ve1+Ve2 onboarding paths are available. Ve3 queue is `#/claims` in mingla-admin.

## Required scenarios

| # | Scenario | How to create |
|---|----------|----------------|
| 1 | Pool-match pending claim | Submit via business app with pool match card → `place_pool_id` set |
| 2 | Off-pool pending claim | Submit without pool match → operator `contact_phone` only |
| 3 | Duplicate pair | Two accounts, same `google_place_id`, both `pending_review` |

## DB probes

```sql
SELECT id, name, claim_status, place_pool_id, google_place_id,
       marked_called_at, duplicate_of_brand_id, claim_follow_up_at
FROM brands
WHERE kind = 'physical' AND claim_status = 'pending_review' AND deleted_at IS NULL
ORDER BY created_at ASC;
```

## Post-approve

```sql
SELECT claim_status, verified_at, verified_by, rejection_reason
FROM brands WHERE id = '<brand-id>';
```
