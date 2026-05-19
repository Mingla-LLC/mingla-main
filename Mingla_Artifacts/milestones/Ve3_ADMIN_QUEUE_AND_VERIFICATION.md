# Ve3 — Admin Queue + Verification Workflow

> **Track:** Track 2 — Physical venues
> **Duration:** 1 week
> **Depends on:** Ve1, Ve2 (in TestFlight)
> **Status:** implemented on branch `feat/ve3-admin-claims` (queue at `#/claims`)

---

## 1. User Outcome

You (Seth, as Mingla operator) open the admin queue in `mingla-admin`, see pending venue claims with the Google-listed phone number ready to dial. You phone the venue, ask "Did someone from your team sign up on Mingla?" If they confirm, you tap Approve. The brand's `claim_status` flips to `verified`, the venue goes live publicly, and an approval email fires to the operator. If they deny, you tap Reject; the operator gets a rejection email and the brand stays hidden.

The phone-callback validation is the identity proof for physical venues (in contrast to trip planners, who use Stripe Connect). 4-hour SLA, business-hours-aware. Duplicate claims for the same `google_place_id` are arbitrated during the call (the real business says which signup is theirs).

---

## 2. Smoke Test

1. Pending claim exists in queue from Ve1 + Ve2 smoke tests
2. Open `mingla-admin/admin/claims` (you must be authenticated as a Mingla admin)
3. See the queue: rows sorted by submission age, showing venue name + address + phone + countdown timer
4. **For pool-match claims:** phone shown is the `place_pool.contact_phone` (Google-derived)
5. **For off-pool claims:** phone shown is the operator-supplied phone with a "Verify via Google Maps lookup" note
6. Tap a row to expand: see full submission detail, prefilled-from-pool flag, photos preview
7. **Approve flow:** tap "Mark as called → Approve"
8. **Verify DB:**
   ```sql
   SELECT claim_status, verified_at, verified_by FROM public.brands WHERE id = <brand-id>;
   -- Expect: 'verified', timestamp, your account id
   ```
9. Operator receives approval email via Resend
10. Public page `/b/{slug}` now renders (next milestone Ve4 makes this complete)
11. **Reject flow:** test on a different claim. Tap "Reject."
12. Optional rejection reason captured + sent in email
13. `claim_status='rejected'`, no public visibility
14. **Duplicate arbitration:** with two pending claims for same `google_place_id`, approve one — the other auto-flags "Duplicate of approved claim; reject?" for admin action
15. **Audit log:** verify `agent_audit_log` (or equivalent) captures the approval/rejection action

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Admin route `/admin/claims` in `mingla-admin` lists pending claims |
| 2 | Auth-gated: only Mingla admins can access |
| 3 | Rows sorted by submission age, oldest first |
| 4 | Per-row: venue name, address, phone, submission age + 4h countdown timer |
| 5 | Pool-match indicator (badge or icon) if `place_pool_id` is set |
| 6 | Tap row to expand: full submission detail including photos, hours, description |
| 7 | Three primary actions: Mark as called → Approve / Reject / Need more info |
| 8 | Approve: writes `claim_status='verified'`, `verified_at=now()`, `verified_by=<admin-uid>` |
| 9 | Reject: writes `claim_status='rejected'`, optional rejection reason persisted |
| 10 | Need more info: leaves status `pending_review` with a "follow up" flag |
| 11 | Resend email templates: claim-approved + claim-rejected, both branded per ORCH-0785 |
| 12 | Duplicate handling: claiming an already-verified `google_place_id` auto-flags as duplicate |
| 13 | Audit log captures every admin action with timestamp + admin id |
| 14 | Brand owner notified in-app via OneSignal on status change |

---

## 4. Files Touched

**New:**
- `mingla-admin/src/pages/ClaimsPage.jsx` (extended; route `#/claims`)
- `mingla-admin/src/components/claims/ClaimRow.jsx`
- `mingla-admin/src/services/adminClaimsService.js`
- `mingla-admin/src/lib/claimsPhone.js`
- `supabase/functions/admin-review-venue-claim/index.ts`
- `supabase/functions/_shared/email/claimApprovedEmail.ts`
- `supabase/functions/_shared/email/claimRejectedEmail.ts`

**Modified:**
- `mingla-business/src/services/venueClaimService.ts` + `venueClaimBannerLogic.ts`
- `mingla-business/app/(tabs)/hub/_layout.tsx` (claim status banner)
- `supabase/migrations/20260619000000_ve3_admin_claim_review.sql`

---

## 5. Data Model Changes

No new tables (Ve1 already added `claim_status` + `verified_at` + `verified_by`).

Audit logging: extend existing `agent_audit_log` or `brand_audit_log` to capture admin actions. Pattern reference: existing `/brand/[id]/audit-log.tsx` audit log structure.

```sql
-- Add admin-action audit table or extend existing
-- (decision in SPEC)
```

---

## 6. Dependencies

- Upstream: Ve1 (schema), Ve2 (pool match)
- Downstream: Ve4 (public surface depends on `claim_status='verified'`)

---

## 7. Regression Tests

1. Existing admin pages unaffected
2. Approval idempotency — approving twice doesn't fire two emails or break state
3. Rejection idempotency
4. RLS — non-admin user can't call `admin-approve-claim` or `admin-reject-claim` edge functions
5. Email delivery via existing Resend sender constants (`tickets@`, `admin@`, `notifications@`)

---

## 8. Hard Guards

- Don't allow non-Mingla admins to approve claims (RLS + edge function auth)
- Don't auto-approve based on heuristic ("name matches Google exactly") — every claim requires explicit human approval
- Don't expose admin email or contact info on the public brand page
- Don't allow re-approving a rejected claim without a new submission — operator must re-submit
- Don't approve a claim with conflicting `google_place_id` to an already-verified brand without explicit duplicate-resolution flow

---

## 9. Open Polish

- 4-hour SLA countdown — what happens when it expires? (currently: just visual indicator, no auto-action)
- Operator can re-submit a rejected claim with corrections (defer; first version requires reaching out to admin)
- Bulk approval (defer; per-claim approval is the safe default)
- Admin notes field on claim row (helpful for "called, left voicemail; will retry tomorrow")
- Per-admin queue assignment (defer; one queue for now)

---

## 10. Pipeline Notes

**Seth-owned:** the admin queue is yours operationally. INVESTIGATE: confirm `mingla-admin` auth/role infrastructure supports a new admin route; verify Resend sender constants ready.

**Taofeek-owned:** mingla-admin is React 19 + Vite + JSX (no TS). Stack is different from business app. Read existing admin pages first. The actions (approve/reject) call new edge functions; build those first.
